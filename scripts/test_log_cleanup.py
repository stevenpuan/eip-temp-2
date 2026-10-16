"""Run against a disposable local PostgreSQL instance, never a hosted database."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

INSTALLER = Path(__file__).with_name("install_log_cleanup.sql").read_text()
FUNCTION_SQL = INSTALLER[INSTALLER.index("create or replace function"):INSTALLER.index("do $schedule$")]
SCHEDULE_SQL = INSTALLER[INSTALLER.index("do $schedule$"):INSTALLER.index("commit;")]


class CleanupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix="eip-log-tests-", dir="/tmp")
        cls.root = cls.directory.name
        os.chmod(cls.root, 0o777)
        cls.port = "55439"
        cls.as_user = ["setpriv", "--reuid=1000", "--regid=1000", "--clear-groups", "--"]
        subprocess.run(cls.as_user + ["initdb", "-D", cls.root + "/data", "-A", "trust", "-U", "postgres"], check=True, stdout=subprocess.DEVNULL)
        subprocess.run(cls.as_user + ["pg_ctl", "-D", cls.root + "/data", "-l", cls.root + "/server.log", "-o", f"-k {cls.root} -p {cls.port} -h ''", "-w", "start"], check=True, stdout=subprocess.DEVNULL)
        cls.sql("""
          create role anon; create role authenticated; create role service_role;
          create schema cron;
          create table cron.job(jobid serial primary key, jobname text unique, schedule text,
            command text, active boolean default true, username text default current_user);
          create function cron.schedule(text, text, text) returns bigint language sql as $$
            insert into cron.job(jobname,schedule,command) values ($1,$2,$3)
            on conflict(jobname) do update set schedule=$2,command=$3,active=true returning jobid::bigint $$;
          create function cron.alter_job(job_id bigint, schedule text default null,
            command text default null, active boolean default null) returns void language sql as $$
            update cron.job set schedule=coalesce($2,job.schedule), command=coalesce($3,job.command),
              active=coalesce($4,job.active) where jobid=$1 $$;
          create table public.eip_purge_policy(key text primary key, days integer, is_active boolean);
          create table public.eip_purge_run_log(id bigserial, ran_at timestamptz default now(),
            dry_run boolean, ok boolean, duration_ms integer, detail jsonb, error text);
          create table public.error_logs(id serial, created_at timestamptz);
          create table public.activity_logs(id serial, created_at timestamptz);
          create table public.audit_logs(id serial, created_at timestamptz);
          create table public.task(id serial, created_at timestamptz);
        """)
        cls.sql(FUNCTION_SQL)

    @classmethod
    def tearDownClass(cls):
        subprocess.run(cls.as_user + ["pg_ctl", "-D", cls.root + "/data", "-m", "immediate", "stop"], check=True, stdout=subprocess.DEVNULL)
        cls.directory.cleanup()

    @classmethod
    def sql(cls, statement, succeeds=True):
        # Explicit socket, user, port, database: ignores any hosted PG* defaults.
        result = subprocess.run(["psql", "-X", "-h", cls.root, "-p", cls.port, "-U", "postgres",
            "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-c", statement], capture_output=True, text=True)
        if succeeds and result.returncode:
            raise AssertionError(result.stderr)
        if not succeeds:
            if result.returncode == 0:
                raise AssertionError("Expected SQL failure")
            return result.stderr
        return result.stdout.strip()

    def setUp(self):
        self.sql("truncate error_logs,activity_logs,audit_logs,task,eip_purge_policy,eip_purge_run_log,cron.job;")

    def test_default_retention_90_days_and_boundary(self):
        result = self.sql("""begin;
          insert into error_logs(created_at) values(now()-interval '91 days'),(now()-interval '90 days'),(now()),(null);
          select public.eip_cleanup_system_logs(false,5000);
          select count(*) from error_logs;
          rollback;""")
        self.assertEqual(result.splitlines()[-2], "3")

    def test_preserves_policy_and_disabled_table(self):
        self.sql("""insert into eip_purge_policy values('error_logs',120,true),('activity_logs',90,false);
          insert into error_logs(created_at) values(now()-interval '100 days'),(now()-interval '121 days');
          insert into activity_logs(created_at) values(now()-interval '200 days');
          select eip_cleanup_system_logs(false,5000);""")
        self.assertEqual(self.sql("select count(*) from error_logs"), "1")
        self.assertEqual(self.sql("select count(*) from activity_logs"), "1")
        self.assertEqual(self.sql("select days from eip_purge_policy where key='error_logs'"), "120")

    def test_dry_run_does_not_delete(self):
        self.sql("insert into audit_logs(created_at) values(now()-interval '100 days'); select eip_cleanup_system_logs(true,5000)")
        self.assertEqual(self.sql("select count(*) from audit_logs"), "1")
        self.assertEqual(self.sql("select dry_run and ok from eip_purge_run_log"), "t")

    def test_batch_size_and_business_data_untouched(self):
        self.sql("""insert into error_logs(created_at) select now()-interval '100 days' from generate_series(1,5001);
          insert into task(created_at) values(now()-interval '1000 days'); select eip_cleanup_system_logs(false,5000);""")
        self.assertEqual(self.sql("select count(*) from error_logs"), "1")
        self.assertEqual(self.sql("select count(*) from task"), "1")

    def test_invalid_input_rejected(self):
        for args in ["false,0", "false,50001", "null,5000", "false,null"]:
            self.sql(f"select eip_cleanup_system_logs({args})", succeeds=False)

    def test_rpc_denied_to_ordinary_users(self):
        for role in ["anon", "authenticated"]:
            self.assertEqual(self.sql(f"select has_function_privilege('{role}','eip_cleanup_system_logs(boolean,integer)','EXECUTE')"), "f")
        self.assertEqual(self.sql("select has_function_privilege('service_role','eip_cleanup_system_logs(boolean,integer)','EXECUTE')"), "t")

    def test_partial_failure_is_not_reported_as_success(self):
        self.sql("insert into eip_purge_policy values('audit_logs',0,true); select eip_cleanup_system_logs(false,5000)")
        self.assertEqual(self.sql("select ok from eip_purge_run_log"), "f")

    def test_schedule_daily_taipei_0600_and_idempotent(self):
        self.sql(SCHEDULE_SQL)
        self.sql(SCHEDULE_SQL)
        self.assertEqual(self.sql("select count(*) from cron.job"), "1")
        self.assertEqual(self.sql("select schedule from cron.job"), "0 22 * * *")
        self.assertEqual(self.sql("select command from cron.job"), "select public.eip_cleanup_system_logs(false, 5000);")

    def test_comprehensive_job_preserved(self):
        command = "select public.eip_cron_guarded('eip_purge_maintenance')"
        self.sql(f"insert into cron.job(jobname,schedule,command) values('eip-log-purge-daily','0 18 * * *',$${command}$$)")
        self.sql(SCHEDULE_SQL)
        self.assertEqual(self.sql("select command from cron.job"), command)
        self.assertEqual(self.sql("select schedule from cron.job"), "0 22 * * *")

    def test_unknown_job_not_overwritten(self):
        self.sql("insert into cron.job(jobname,schedule,command) values('eip-log-purge-daily','0 18 * * *','select unknown_job()')")
        self.sql(SCHEDULE_SQL, succeeds=False)
        self.assertEqual(self.sql("select command from cron.job"), "select unknown_job()")


if __name__ == "__main__":
    unittest.main(verbosity=2)