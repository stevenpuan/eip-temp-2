
CREATE OR REPLACE FUNCTION public.eip_notify_announcement_published()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_setting public.notification_setting;
  v_user_ids uuid[] := '{}';
  v_msg text;
begin
  -- 只有在 published_at 從 null 變成有值時才發通知
  if NEW.published_at is null then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and OLD.published_at is not null then
    return NEW;
  end if;

  -- 取通知設定（全公司預設；若之後有部門覆寫也 ok，但公告本身不綁部門所以取 default）
  select * into v_setting
  from public.notification_setting s
  where s.tenant_id = NEW.tenant_id
    and s.event_code = 'announcement_published'
    and s.is_active
    and s.department_id is null
  limit 1;

  if not found or not v_setting.in_app_enabled then
    return NEW;
  end if;

  -- 依公告 audience 找收件人
  if NEW.audience_type = 'all' then
    v_user_ids := array(
      select id from public.app_user
      where tenant_id = NEW.tenant_id and status = 'active'
    );
  elsif NEW.audience_type = 'department' then
    v_user_ids := array(
      select u.id from public.app_user u
      join public.announcement_target t on t.department_id = u.department_id
      where t.announcement_id = NEW.id
        and u.tenant_id = NEW.tenant_id
        and u.status = 'active'
    );
  elsif NEW.audience_type = 'users' then
    v_user_ids := array(
      select u.id from public.app_user u
      join public.announcement_target t on t.user_id = u.id
      where t.announcement_id = NEW.id
        and u.tenant_id = NEW.tenant_id
        and u.status = 'active'
    );
  end if;

  v_msg := '新公告：' || NEW.title;

  insert into public.notification(tenant_id, user_id, type, entity_type, entity_id, message, line_pending)
  select NEW.tenant_id, uid, 'announcement'::notification_type, 'announcement'::notification_entity,
         NEW.id, v_msg, coalesce(v_setting.line_enabled, false)
  from unnest(v_user_ids) as uid
  where uid is not null
    and uid <> coalesce(NEW.created_by, '00000000-0000-0000-0000-000000000000'::uuid)
    and not exists (
      select 1 from public.notification n
      where n.user_id = uid and n.entity_id = NEW.id and n.type = 'announcement'::notification_type
    );

  return NEW;
end;
$function$;

DROP TRIGGER IF EXISTS trg_announcement_notify_ins ON public.announcement;
DROP TRIGGER IF EXISTS trg_announcement_notify_upd ON public.announcement;

CREATE TRIGGER trg_announcement_notify_ins
AFTER INSERT ON public.announcement
FOR EACH ROW EXECUTE FUNCTION public.eip_notify_announcement_published();

CREATE TRIGGER trg_announcement_notify_upd
AFTER UPDATE OF published_at ON public.announcement
FOR EACH ROW EXECUTE FUNCTION public.eip_notify_announcement_published();

-- 為既有已發布但沒有通知的公告補發一次
DO $$
declare a record;
begin
  for a in
    select * from public.announcement
    where published_at is not null
      and not exists (
        select 1 from public.notification n
        where n.entity_id = announcement.id
          and n.type = 'announcement'::notification_type
      )
  loop
    perform public.eip_notify_announcement_published_backfill(a.id);
  end loop;
exception when undefined_function then
  -- 沒有 backfill 函式時，直接 touch published_at 觸發 trigger
  update public.announcement
  set published_at = published_at
  where published_at is not null
    and not exists (
      select 1 from public.notification n
      where n.entity_id = announcement.id
        and n.type = 'announcement'::notification_type
    );
end$$;
