import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarClock, ListTodo, Bell } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Task = { id: string; title: string; due_date: string; progress: number };
type Ev = { id: string; title: string; start_time: string | null; end_time: string | null };

export function DailyReminder() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);

  useEffect(() => {
    if (!user?.id) return;
    const _d = new Date(); const today = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, "0")}-${String(_d.getDate()).padStart(2, "0")}`;
    const key = `eip_daily_reminder:${user.id}:${today}`;
    try { if (localStorage.getItem(key)) return; } catch { /* ignore */ }

    let cancelled = false;
    (async () => {
      const [tRes, eRes] = await Promise.all([
        supabase.from("task").select("id,title,due_date,progress")
          .eq("owner_id", user.id).eq("due_date", today),
        supabase.from("personal_event").select("id,title,start_time,end_time,start_date,end_date")
          .eq("user_id", user.id).lte("start_date", today)
          .or(`end_date.gte.${today},end_date.is.null`),
      ]);
      if (cancelled) return;
      const t = ((tRes.data ?? []) as Task[]).filter((x) => (x.progress ?? 0) < 100);
      const e = (eRes.data ?? []) as Ev[];
      try { localStorage.setItem(key, "1"); } catch { /* ignore */ }
      if (t.length + e.length > 0) { setTasks(t); setEvents(e); setOpen(true); }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const dateLabel = new Date().toLocaleDateString("zh-TW", { month: "long", day: "numeric", weekday: "long" });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary" /> 今日提醒
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-1">{dateLabel}</p>

        <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
          <section>
            <div className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <ListTodo className="w-3.5 h-3.5" /> 今日到期任務（{tasks.length}）
            </div>
            {tasks.length === 0 ? (
              <div className="text-xs text-muted-foreground">無</div>
            ) : (
              <ul className="space-y-1">
                {tasks.map((t) => (
                  <li key={t.id} className="text-sm rounded-md border bg-card px-3 py-1.5">{t.title}</li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <div className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <CalendarClock className="w-3.5 h-3.5" /> 今日行事曆（{events.length}）
            </div>
            {events.length === 0 ? (
              <div className="text-xs text-muted-foreground">無</div>
            ) : (
              <ul className="space-y-1">
                {events.map((e) => (
                  <li key={e.id} className="text-sm rounded-md border bg-card px-3 py-1.5 flex justify-between gap-2">
                    <span className="min-w-0 truncate">{e.title}</span>
                    {e.start_time && <span className="text-xs text-muted-foreground shrink-0">{e.start_time.slice(0, 5)}{e.end_time ? `–${e.end_time.slice(0, 5)}` : ""}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" asChild>
            <Link to="/dashboard/eip/my-tasks" onClick={() => setOpen(false)}>前往我的工作</Link>
          </Button>
          <Button onClick={() => setOpen(false)}>知道了</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
