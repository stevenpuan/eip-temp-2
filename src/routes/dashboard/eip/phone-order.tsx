import { createFileRoute } from "@tanstack/react-router";
import { RequirePerm } from "@/components/RequirePerm";
import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Phone, Lock, Unlock, Download, Save, Trash2, FileWarning, CalendarDays } from "lucide-react";
import * as XLSX from "xlsx";

// 資料表 / RPC 尚未進 src/integrations/supabase/types.ts，這裡用 any 版 client。
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useEipUser } from "@/lib/eip-user";
import { exportToExcel } from "@/lib/eip-export";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { humanizeError } from "@/lib/eip-error";

export const Route = createFileRoute("/dashboard/eip/phone-order")({
  component: () => (
    <RequirePerm module="eip_phone_order">
      <PhoneOrderPage />
    </RequirePerm>
  ),
});

const TENANT = "00000000-0000-0000-0000-000000000001";

/* 本地日期字串（YYYY-MM-DD），不走 toISOString().slice（會被 UTC 位移害到、且違反專案時區規範） */
const localDateStr = (d: Date) => d.toLocaleDateString("sv-SE");
const pad2 = (n: number) => String(n).padStart(2, "0");

type DailyRow = {
  id: string;
  user_id: string;
  log_date: string;
  order_count: number;
  error_count: number;
  error_reason: string | null;
  remark: string | null;
};

type SummaryRow = {
  user_id: string;
  user_name: string | null;
  department_id: string | null;
  department_name: string | null;
  total_orders: number;
  total_errors: number;
  days_recorded: number;
  work_days: number | null;
  avg_score: number | string | null;
  locked: boolean;
};

type ErrorRow = {
  log_date: string;
  user_id: string;
  user_name: string | null;
  department_name: string | null;
  error_count: number;
  error_reason: string | null;
  remark: string | null;
};

function PhoneOrderPage() {
  const qc = useQueryClient();
  const { roles, isAdmin, can } = useAuth();
  const { appUser } = useEipUser();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-12

  const ymFirst = `${year}-${pad2(month)}-01`;
  const monthValue = `${year}-${pad2(month)}`; // <input type="month">

  // 部門清單（給人資彙總篩選、判斷本人部門是否為人事課）
  const deptsQ = useQuery({
    queryKey: ["eip", "departments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("department").select("id,name").order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const myDeptName = useMemo(
    () => deptsQ.data?.find((d) => d.id === appUser?.department_id)?.name ?? "",
    [deptsQ.data, appUser?.department_id],
  );

  // 人資＝人事課成員，或系統管理層（admin/manager 角色）。與後端 eip_is_phone_order_hr 對應。
  const canHR = isAdmin || roles.includes("manager") || myDeptName === "人事課";
  // 能看彙總＝人資，或有匯出權（部門主管）
  const canSummary = canHR || can("eip_phone_order", "export");

  /* ---------- 月鎖定狀態 ---------- */
  const lockQ = useQuery({
    queryKey: ["eip", "phone-order-lock", ymFirst],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("phone_order_lock").select("locked").eq("ym", ymFirst).maybeSingle();
      if (error) throw error;
      return !!(data as any)?.locked;
    },
  });
  const locked = !!lockQ.data;

  /* ---------- 我的每日紀錄 ---------- */
  const monthStart = ymFirst;
  const monthEnd = localDateStr(new Date(year, month, 0)); // 該月最後一天

  const myDailyQ = useQuery({
    enabled: !!appUser?.id,
    queryKey: ["eip", "phone-order-daily", appUser?.id, monthStart],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("phone_order_daily").select("*")
        .eq("user_id", appUser!.id)
        .gte("log_date", monthStart).lte("log_date", monthEnd)
        .order("log_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as DailyRow[];
    },
  });

  const myWorkDaysQ = useQuery({
    enabled: !!appUser?.id,
    queryKey: ["eip", "phone-order-workdays", appUser?.id, ymFirst],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("phone_order_month").select("work_days").eq("user_id", appUser!.id).eq("ym", ymFirst).maybeSingle();
      if (error) throw error;
      return (data as any)?.work_days as number | null ?? null;
    },
  });

  /* 我的當月合計（本人視角） */
  const mySummary = useMemo(() => {
    const rows = myDailyQ.data ?? [];
    const total = rows.reduce((s, r) => s + Number(r.order_count ?? 0), 0);
    const errs = rows.reduce((s, r) => s + Number(r.error_count ?? 0), 0);
    const wd = myWorkDaysQ.data ?? 0;
    const avg = wd && wd > 0 ? (total / wd).toFixed(2) : "—";
    return { total, errs, days: rows.length, wd, avg };
  }, [myDailyQ.data, myWorkDaysQ.data]);

  /* ---------- 每日輸入表單 ---------- */
  const [entryDate, setEntryDate] = useState(localDateStr(now));
  const [orderCount, setOrderCount] = useState("");
  const [errorCount, setErrorCount] = useState("");
  const [errorReason, setErrorReason] = useState("");
  const [remark, setRemark] = useState("");

  // 切換月份時，把輸入日期夾回所選月份內：當月→今天(在範圍內)，其他月→該月第一天
  useEffect(() => {
    if (entryDate < monthStart || entryDate > monthEnd) {
      const t = localDateStr(now);
      setEntryDate(t >= monthStart && t <= monthEnd ? t : monthStart);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthStart, monthEnd]);

  const saveDaily = useMutation({
    mutationFn: async () => {
      if (!appUser?.id) throw new Error("尚未載入使用者");
      if (!entryDate) throw new Error("請選擇日期");
      // 日期必須落在所選月份內（避免月份選當月卻存到別月，誤植資料）
      if (entryDate < monthStart || entryDate > monthEnd) {
        throw new Error(`日期需在所選月份（${monthValue}）內`);
      }
      const payload = {
        tenant_id: appUser.tenant_id ?? TENANT,
        user_id: appUser.id,
        log_date: entryDate,
        order_count: Number(orderCount || 0),
        error_count: Number(errorCount || 0),
        error_reason: errorReason.trim() || null,
        remark: remark.trim() || null,
        created_by: appUser.id,
      };
      const { error } = await supabase
        .from("phone_order_daily").upsert(payload, { onConflict: "user_id,log_date" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("已儲存當日紀錄");
      setOrderCount(""); setErrorCount(""); setErrorReason(""); setRemark("");
      qc.invalidateQueries({ queryKey: ["eip", "phone-order-daily"] });
    },
    onError: (e) => toast.error(humanizeError(e, "儲存")),
  });

  // 儲存前檢查：日期需在月份內；若當天已有紀錄，跳出確認再覆蓋
  const handleSaveDaily = () => {
    if (locked || saveDaily.isPending) return;
    // 當日紀錄還沒載完就存，exists 會是 false → 不跳確認直接覆蓋掉當天原本的資料
    if (myDailyQ.isLoading) { toast.error("資料還在載入，請稍候再存"); return; }
    if (!entryDate) { toast.error("請選擇日期"); return; }
    if (entryDate < monthStart || entryDate > monthEnd) {
      toast.error(`日期需在所選月份（${monthValue}）內`);
      return;
    }
    const exists = (myDailyQ.data ?? []).some((r) => r.log_date === entryDate);
    if (exists) {
      // eslint-disable-next-line no-alert
      if (!window.confirm(`${entryDate} 已經有紀錄了。\n再次儲存會「覆蓋」當天原本的接單數、失誤與備註，確定要覆蓋嗎？`)) {
        return;
      }
    }
    saveDaily.mutate();
  };

  const delDaily = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("phone_order_daily").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("已刪除");
      qc.invalidateQueries({ queryKey: ["eip", "phone-order-daily"] });
    },
    onError: (e) => toast.error(humanizeError(e, "刪除")),
  });

  const [workDaysInput, setWorkDaysInput] = useState<string>("");
  // 切換月份時把輸入框換成「該月已存的值」。少了這段，在 8 月填了 22 再切到 7 月，
  // 框裡仍顯示 22，按下儲存就把 7 月的上班天數改成 22，整月平均分數全錯。
  useEffect(() => {
    setWorkDaysInput(myWorkDaysQ.data != null ? String(myWorkDaysQ.data) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ymFirst, myWorkDaysQ.data]);
  const saveWorkDays = useMutation({
    mutationFn: async () => {
      if (!appUser?.id) throw new Error("尚未載入使用者");
      const payload = {
        tenant_id: appUser.tenant_id ?? TENANT,
        user_id: appUser.id,
        ym: ymFirst,
        work_days: workDaysInput === "" ? null : Number(workDaysInput),
        created_by: appUser.id,
      };
      const { error } = await supabase
        .from("phone_order_month").upsert(payload, { onConflict: "user_id,ym" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("已儲存本月上班天數");
      qc.invalidateQueries({ queryKey: ["eip", "phone-order-workdays"] });
    },
    onError: (e) => toast.error(humanizeError(e, "儲存上班天數")),
  });

  /* ---------- 人資：一鍵上鎖 / 解鎖 ---------- */
  const toggleLock = useMutation({
    mutationFn: async (next: boolean) => {
      const payload = {
        tenant_id: appUser?.tenant_id ?? TENANT,
        ym: ymFirst,
        locked: next,
        locked_by: appUser?.id ?? null,
        locked_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("phone_order_lock").upsert(payload, { onConflict: "tenant_id,ym" });
      if (error) throw error;
    },
    onSuccess: (_d, next) => {
      toast.success(next ? "已鎖定當月，全員不可修改" : "已解鎖當月");
      qc.invalidateQueries({ queryKey: ["eip", "phone-order-lock"] });
    },
    onError: (e) => toast.error(humanizeError(e, "鎖定")),
  });

  /* ---------- 彙總（主管 / 人資）---------- */
  const [deptFilter, setDeptFilter] = useState("all");
  const summaryQ = useQuery({
    enabled: canSummary,
    queryKey: ["eip", "phone-order-summary", year, month],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("eip_phone_order_summary", {
        p_year: year, p_month: month,
      });
      if (error) throw error;
      return (data ?? []) as SummaryRow[];
    },
  });

  const summaryRows = useMemo(() => {
    const all = summaryQ.data ?? [];
    return deptFilter === "all" ? all : all.filter((r) => r.department_id === deptFilter);
  }, [summaryQ.data, deptFilter]);

  const summaryDeptOptions = useMemo(() => {
    const m = new Map<string, string>();
    (summaryQ.data ?? []).forEach((r) => { if (r.department_id) m.set(r.department_id, r.department_name ?? "—"); });
    return Array.from(m, ([id, name]) => ({ id, name }));
  }, [summaryQ.data]);

  const exportMonthly = () => {
    exportToExcel({
      filename: `電話訂單月報_${monthValue}`,
      sheetName: "月報",
      rows: summaryRows,
      columns: [
        { header: "姓名", key: "user_name", map: (r: SummaryRow) => r.user_name ?? "" },
        { header: "部門", key: "department_name", map: (r: SummaryRow) => r.department_name ?? "" },
        { header: "總接單數", key: "total_orders" },
        { header: "上班天數", key: "work_days", map: (r: SummaryRow) => r.work_days ?? "" },
        { header: "平均分數", key: "avg_score", map: (r: SummaryRow) => (r.avg_score == null ? "" : Number(r.avg_score)) },
        { header: "失誤數", key: "total_errors" },
        { header: "紀錄天數", key: "days_recorded" },
      ],
    });
  };

  const exportErrors = async () => {
    try {
      const { data, error } = await supabase.rpc("eip_phone_order_error_detail", {
        p_year: year, p_month: month,
      });
      if (error) throw error;
      // 與「匯出月報」「下載每日明細表」一致，套用上方的部門篩選；
      // 原本這顆不吃 deptFilter，人資篩了部門仍會拿到全公司的失誤明細。
      // eip_phone_order_error_detail 只回 department_name，所以改用已套篩選的
      // summaryRows 取人員白名單來過濾（同名部門也不會誤判）。
      const all = (data ?? []) as ErrorRow[];
      const allowed = new Set(summaryRows.map((r) => r.user_id));
      const rows = deptFilter === "all" ? all : all.filter((r) => allowed.has(r.user_id));
      if (!rows.length) { toast.info(deptFilter === "all" ? "本月沒有失誤紀錄" : "所選部門本月沒有失誤紀錄"); return; }
      exportToExcel({
        filename: `電話訂單失誤明細_${monthValue}`,
        sheetName: "失誤明細",
        rows,
        columns: [
          { header: "日期", key: "log_date" },
          { header: "姓名", key: "user_name", map: (r: ErrorRow) => r.user_name ?? "" },
          { header: "部門", key: "department_name", map: (r: ErrorRow) => r.department_name ?? "" },
          { header: "失誤數", key: "error_count" },
          { header: "失誤原因", key: "error_reason", map: (r: ErrorRow) => r.error_reason ?? "" },
          { header: "備註", key: "remark", map: (r: ErrorRow) => r.remark ?? "" },
        ],
      });
    } catch (e) {
      toast.error(humanizeError(e, "匯出失誤明細"));
    }
  };

  // 一鍵下載「當月每日明細表」——每人一張工作表，月曆式版面(對照紙本)，全員同一檔案
  const exportDailyDetail = async () => {
    try {
      const people = summaryRows;
      if (!people.length) { toast.info("本月尚無資料可匯出"); return; }
      const daysInMonth = new Date(year, month, 0).getDate();
      // 取當月所有(權限範圍內)每日紀錄
      const { data: daily, error } = await supabase
        .from("phone_order_daily")
        .select("user_id,log_date,order_count,error_count,error_reason,remark")
        .gte("log_date", monthStart).lte("log_date", monthEnd);
      if (error) throw error;
      // user_id -> (日 -> 該日資料)
      const byUser = new Map<string, Map<number, any>>();
      (daily ?? []).forEach((r: any) => {
        const day = Number(String(r.log_date).slice(8, 10));
        if (!byUser.has(r.user_id)) byUser.set(r.user_id, new Map());
        byUser.get(r.user_id)!.set(day, r);
      });

      const wb = XLSX.utils.book_new();
      const rocYear = year - 1911;
      const usedNames = new Set<string>();
      people.forEach((p) => {
        const cells = byUser.get(p.user_id) ?? new Map<number, any>();
        const dayCols = Array.from({ length: daysInMonth }, (_, i) => i + 1);
        const rowValue = (pick: (d: any) => unknown) =>
          dayCols.map((d) => { const c = cells.get(d); return c ? (pick(c) ?? "") : ""; });

        const aoa: unknown[][] = [];
        aoa.push([`${rocYear}年 艾士實業有限公司 電話訂單 ${month}月 紀錄表`]);
        aoa.push([`姓名：${p.user_name ?? ""}`, `部門：${p.department_name ?? ""}`]);
        aoa.push(["日", ...dayCols]);
        aoa.push(["電話接單數量", ...rowValue((c) => c.order_count)]);
        aoa.push(["備註", ...rowValue((c) => c.remark)]);
        aoa.push(["查核", ...dayCols.map(() => "")]);
        aoa.push(["前日訂單失誤數量", ...rowValue((c) => c.error_count)]);
        aoa.push(["失誤原因", ...rowValue((c) => c.error_reason)]);
        aoa.push([]);
        aoa.push([
          `總通數(${p.total_orders ?? 0})/上班天數(${p.work_days ?? ""})=`,
          p.avg_score == null ? "" : Number(p.avg_score),
          "", "填表人：", "", "主管：", "", "人事：",
        ]);
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws["!cols"] = [{ wch: 16 }, ...dayCols.map(() => ({ wch: 5 }))];
        // 工作表名稱：人名去掉 Excel 不允許的字元、避免重名、限 31 字
        let nm = (p.user_name ?? "未命名").replace(/[\\/?*[\]:]/g, "").slice(0, 28) || "未命名";
        let suffix = 1;
        while (usedNames.has(nm)) { nm = `${nm.slice(0, 27)}_${suffix++}`; }
        usedNames.add(nm);
        XLSX.utils.book_append_sheet(wb, ws, nm);
      });
      XLSX.writeFile(wb, `電話訂單每日明細表_${monthValue}.xlsx`);
    } catch (e) {
      toast.error(humanizeError(e, "匯出每日明細表"));
    }
  };

  const onMonthChange = (v: string) => {
    const [y, m] = v.split("-").map(Number);
    if (y && m) { setYear(y); setMonth(m); }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="電話訂單紀錄"
        description="每日記錄電話接單數量與前日訂單失誤；月底以「總接單數 ÷ 上班天數」計算平均分數。上班天數由本人填寫；人資可一鍵鎖定當月資料。"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-sm text-muted-foreground">月份</Label>
        <Input type="month" className="w-40" value={monthValue} onChange={(e) => onMonthChange(e.target.value)} />
        {locked && (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-destructive/10 text-destructive">
            <Lock className="w-3.5 h-3.5" /> 本月已鎖定，資料不可修改
          </span>
        )}
        <div className="flex-1" />
        {canHR && (
          locked ? (
            <Button size="sm" variant="outline" onClick={() => toggleLock.mutate(false)} disabled={toggleLock.isPending}>
              <Unlock className="w-4 h-4" /> 解鎖當月
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => toggleLock.mutate(true)} disabled={toggleLock.isPending}>
              <Lock className="w-4 h-4" /> 一鍵鎖定當月
            </Button>
          )
        )}
      </div>

      {/* ===== 我的紀錄 ===== */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="font-medium text-sm">我的紀錄（{monthValue}）</div>

          {/* 本月合計 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Tile label="總接單數" value={mySummary.total} />
            <Tile label="上班天數" value={mySummary.wd || "—"} />
            <Tile label="平均分數" value={mySummary.avg} hint="總接單 ÷ 上班天數" />
            <Tile label="失誤數" value={mySummary.errs} tone={mySummary.errs > 0 ? "text-destructive" : ""} />
          </div>

          {/* 本月上班天數 */}
          <div className="flex flex-wrap items-end gap-2 border-t pt-3">
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">本月上班天數（由本人填）</Label>
              <Input type="number" min={0} className="w-32" placeholder={mySummary.wd ? String(mySummary.wd) : "例如 22"}
                value={workDaysInput} onChange={(e) => setWorkDaysInput(e.target.value)} disabled={locked} />
            </div>
            <Button size="sm" onClick={() => saveWorkDays.mutate()} disabled={locked || saveWorkDays.isPending}>
              <Save className="w-4 h-4" /> 儲存上班天數
            </Button>
          </div>

          {/* 每日輸入 */}
          <div className="border-t pt-3 space-y-2">
            <div className="text-sm font-medium">新增／更新單日紀錄</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              <Field label="日期">
                <Input type="date" value={entryDate} min={monthStart} max={monthEnd}
                  onChange={(e) => setEntryDate(e.target.value)} disabled={locked} />
              </Field>
              <Field label="電話接單數量">
                <Input type="number" min={0} value={orderCount} onChange={(e) => setOrderCount(e.target.value)} disabled={locked} />
              </Field>
              <Field label="前日訂單失誤數量">
                <Input type="number" min={0} value={errorCount} onChange={(e) => setErrorCount(e.target.value)} disabled={locked} />
              </Field>
              <Field label="失誤原因">
                <Input value={errorReason} onChange={(e) => setErrorReason(e.target.value)} placeholder="有失誤才填" disabled={locked} />
              </Field>
            </div>
            <Field label="備註">
              <Textarea rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} disabled={locked} />
            </Field>
            <div>
              <Button size="sm" onClick={handleSaveDaily} disabled={locked || saveDaily.isPending}>
                <Save className="w-4 h-4" /> 儲存當日
              </Button>
              <span className="text-xs text-muted-foreground ml-2">
                日期限所選月份內；同一天已有紀錄時，再存會先跳出確認再覆蓋。
              </span>
            </div>
          </div>

          {/* 本月已填列表 */}
          <div className="border-t pt-3">
            <div className="text-sm font-medium mb-2">本月已填</div>
            {myDailyQ.isLoading ? (
              <div className="text-sm text-muted-foreground py-4 text-center">載入中…</div>
            ) : (myDailyQ.data ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">本月尚無紀錄。</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>日期</TableHead>
                      <TableHead className="text-right">接單數</TableHead>
                      <TableHead className="text-right">失誤數</TableHead>
                      <TableHead>失誤原因</TableHead>
                      <TableHead>備註</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(myDailyQ.data ?? []).map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.log_date}</TableCell>
                        <TableCell className="text-right">{r.order_count}</TableCell>
                        <TableCell className={`text-right ${r.error_count > 0 ? "text-destructive" : ""}`}>{r.error_count}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.error_reason ?? ""}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.remark ?? ""}</TableCell>
                        <TableCell>
                          {!locked && (
                            <button onClick={() => delDaily.mutate(r.id)} className="text-muted-foreground hover:text-destructive" aria-label="刪除">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ===== 彙總（主管 / 人資）===== */}
      {canSummary && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="font-medium text-sm">月彙總（{monthValue}）</div>
              {summaryDeptOptions.length > 1 && (
                <Select value={deptFilter} onValueChange={setDeptFilter}>
                  <SelectTrigger className="w-40 h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部部門</SelectItem>
                    {summaryDeptOptions.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <div className="flex-1" />
              <Button size="sm" variant="outline" onClick={exportMonthly}
                disabled={summaryQ.isLoading || summaryRows.length === 0}>
                <Download className="w-4 h-4" /> 匯出月報 Excel
              </Button>
              <Button size="sm" variant="outline" onClick={exportErrors} disabled={summaryQ.isLoading}>
                <FileWarning className="w-4 h-4" /> 匯出失誤明細 Excel
              </Button>
              <Button size="sm" onClick={exportDailyDetail}
                disabled={summaryQ.isLoading || summaryRows.length === 0}>
                <CalendarDays className="w-4 h-4" /> 下載每日明細表（全員）
              </Button>
            </div>

            {summaryQ.isLoading ? (
              <div className="text-sm text-muted-foreground py-6 text-center">載入中…</div>
            ) : summaryQ.isError ? (
              <div className="text-sm text-center py-6 space-y-2">
                <div className="text-destructive">彙總載入失敗</div>
                <Button size="sm" variant="outline" onClick={() => summaryQ.refetch()}>重試</Button>
              </div>
            ) : summaryRows.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">本月尚無人填寫電話訂單紀錄。</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>姓名</TableHead>
                      <TableHead>部門</TableHead>
                      <TableHead className="text-right">總接單數</TableHead>
                      <TableHead className="text-right">上班天數</TableHead>
                      <TableHead className="text-right">平均分數</TableHead>
                      <TableHead className="text-right">失誤數</TableHead>
                      <TableHead className="text-right">紀錄天數</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summaryRows.map((r) => (
                      <TableRow key={r.user_id}>
                        <TableCell className="font-medium">{r.user_name ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.department_name ?? "—"}</TableCell>
                        <TableCell className="text-right">{r.total_orders}</TableCell>
                        <TableCell className="text-right">{r.work_days ?? <span className="text-muted-foreground">未填</span>}</TableCell>
                        <TableCell className="text-right font-medium">{r.avg_score == null ? "—" : Number(r.avg_score).toFixed(2)}</TableCell>
                        <TableCell className={`text-right ${r.total_errors > 0 ? "text-destructive" : ""}`}>{r.total_errors}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{r.days_recorded}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              平均分數 = 總接單數 ÷ 上班天數（上班天數由本人填寫；未填則不計算平均）。失誤僅供參考，不影響分數。「匯出失誤明細」為含失誤原因的獨立報表，與月報分開。
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: number | string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${tone ?? ""}`}>{value}</div>
      {hint && <div className="text-[12.5px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
