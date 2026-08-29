import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ListTodo, AlertCircle, UserMinus, type LucideIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { EipDashboardSummary } from "@/components/eip/EipDashboardSummary";


export const Route = createFileRoute("/dashboard/")({ component: DashboardHome });


function DashboardHome() {
  const { profile, roleNames, can } = useAuth();
  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const [todos, issues] = await Promise.all([
        supabase.from("dev_todos").select("*", { count: "exact", head: true }).eq("status", "todo"),
        supabase.from("issue_reports").select("*", { count: "exact", head: true }).eq("status", "open"),
      ]);
      // 原本 error 被丟掉，失敗時兩張卡都顯示 0，看起來像「今天沒事」。
      // 拋出去讓 useQuery 進 isError，與 EipDashboardSummary 的處理一致。
      if (todos.error) throw todos.error;
      if (issues.error) throw issues.error;
      return {
        todos: todos.count ?? 0,
        issues: issues.count ?? 0,
      };
    },
  });

  // 指派給我、尚未處理的交接待辦（RLS 已限定可見範圍）
  const { data: pendingHandover = 0 } = useQuery({
    queryKey: ["eip", "handover-pending-count", profile?.id],
    enabled: !!profile?.id && can("eip_handover", "view"),
    queryFn: async () => {
      const { count, error } = await supabase
        .from("eip_handover_item")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending")
        .eq("assignee_id", profile!.id);
      // 這張卡是 count > 0 才渲染，所以查詢失敗＝卡片整張消失，主管不會發現有待辦。
      if (error) throw error;
      return count ?? 0;
    },
  });

  const showTodos = can("dev_todos", "view");
  const showIssues = can("issue_reports", "view");
  const showHandover = pendingHandover > 0;

  return (
    <div className="space-y-8">
      <div className="border-b border-border/70 pb-5">
        <h1 className="text-2xl font-bold tracking-tight">
          歡迎回來，{profile?.full_name ?? profile?.email}
        </h1>
        <p className="text-muted-foreground text-sm mt-1.5">
          角色：{roleNames.join("、") || "—"}
        </p>
      </div>
      {(showTodos || showIssues || showHandover) && (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">

          {showHandover && (
            <StatCard
              title="交接待辦"
              value={pendingHandover}
              icon={UserMinus}
              accent="accent"
              to="/dashboard/eip/handover"
            />
          )}
          {showTodos && (
            <StatCard title="待辦事項" value={stats?.todos} icon={ListTodo} accent="primary" to="/dashboard/dev-todos" />
          )}
          {showIssues && (
            <StatCard title="待處理問題" value={stats?.issues} icon={AlertCircle} accent="destructive" to="/dashboard/issue-reports" />
          )}
        </div>
      )}

      <EipDashboardSummary />
    </div>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  accent = "primary",
  to,
}: {
  title: string;
  value?: number;
  icon: LucideIcon;
  accent?: "primary" | "accent" | "destructive";
  to?: string;
}) {
  const borderClass =
    accent === "accent"
      ? "border-l-accent"
      : accent === "destructive"
        ? "border-l-destructive"
        : "border-l-primary";
  const iconWrap =
    accent === "accent"
      ? "bg-accent/10 text-accent"
      : accent === "destructive"
        ? "bg-destructive/10 text-destructive"
        : "bg-primary/10 text-primary";
  const card = (
    <Card className={cn("h-full border-l-4 shadow-sm transition-all duration-200", to && "hover:-translate-y-0.5 hover:shadow-lg cursor-pointer", borderClass)}>
      <CardContent className="p-6 flex items-center gap-5">
        <div className={cn("h-12 w-12 rounded-2xl flex items-center justify-center shrink-0", iconWrap)}>
          <Icon className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-muted-foreground">{title}</div>
          <div className="text-3xl font-bold mt-1 leading-none tabular">{value ?? "—"}</div>
        </div>
      </CardContent>
    </Card>
  );

  if (to) return <Link to={to as any} className="block">{card}</Link>;
  return card;
}
