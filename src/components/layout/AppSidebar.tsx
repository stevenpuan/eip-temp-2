import { Link, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import { LogOut, Menu, ChevronDown } from "lucide-react";
import { supabase } from "@/lib/supabase";

import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";

interface MenuRow {
  id: string;
  menu_key: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  route: string | null;
  module_key: string | null;
  sort_order: number;
  is_active: boolean;
}

const OPEN_KEY = "eip.sidebar.open";

function loadOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) || "{}");
  } catch {
    return {};
  }
}

function Icon({ name, className }: { name: string | null; className?: string }) {
  const Cmp = ((Icons as any)[name ?? "Circle"] ?? Icons.Circle) as React.ComponentType<{
    className?: string;
  }>;
  return <Cmp className={className} />;
}

function SidebarInner({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const { profile, roleNames, signOut, can } = useAuth();

  const [openMap, setOpenMap] = useState<Record<string, boolean>>(loadOpen);
  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(openMap));
    } catch {
      /* ignore */
    }
  }, [openMap]);

  const { data: menus = [] } = useQuery({
    queryKey: ["menus"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("menus")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data as MenuRow[];
    },
  });

  const groups = menus.filter((m) => !m.parent_id);
  const childrenOf = (id: string) => menus.filter((m) => m.parent_id === id);
  const visible = (m: MenuRow) => !m.module_key || can(m.module_key, "view");

  // 群組是否展開：使用者設過就依設定；沒設過則預設收合，但含當前頁的群組自動展開
  const isOpen = (key: string, kids: MenuRow[]) => {
    if (key in openMap) return openMap[key];
    return kids.some((k) => k.route === pathname);
  };
  const toggle = (key: string, kids: MenuRow[]) =>
    setOpenMap((prev) => ({ ...prev, [key]: !isOpen(key, kids) }));

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="px-5 py-4 border-b flex items-center gap-3">
        <img src="/logo.svg" alt="艾士實業" className="w-10 h-10 object-contain shrink-0" />
        <div className="min-w-0">
          <h1 className="text-sm font-bold text-primary truncate">艾士實業</h1>
          <p className="text-[12.5px] text-muted-foreground mt-0.5 truncate">內部管理平台</p>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {groups.map((g) => {
          if (g.route) {
            if (!visible(g)) return null;
            return (
              <SideLink
                key={g.id}
                to={g.route}
                icon={g.icon}
                title={g.title}
                active={pathname === g.route}
                onNavigate={onNavigate}
              />
            );
          }
          const kids = childrenOf(g.id).filter(visible);
          if (!kids.length) return null;
          const open = isOpen(g.menu_key, kids);
          return (
            <div key={g.id} className="pt-1">
              <button
                type="button"
                onClick={() => toggle(g.menu_key, kids)}
                aria-expanded={open}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-base font-semibold text-foreground/80 hover:bg-accent/50 transition-colors"
              >
                <Icon name={g.icon} className="w-5 h-5 shrink-0" />
                <span className="flex-1 text-left truncate">{g.title}</span>
                <ChevronDown
                  className={cn(
                    "w-4 h-4 shrink-0 transition-transform",
                    open ? "rotate-0" : "-rotate-90"
                  )}
                />
              </button>
              {open && (
                <div className="mt-0.5 space-y-0.5">
                  {kids.map((k) => (
                    <SideLink
                      key={k.id}
                      to={k.route!}
                      icon={k.icon}
                      title={k.title}
                      active={pathname === k.route}
                      onNavigate={onNavigate}
                      indent
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="border-t p-3">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold shrink-0">
            {(profile?.full_name ?? profile?.email ?? "U").slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">
              {profile?.full_name ?? profile?.email}
            </div>
            <div className="text-xs text-muted-foreground truncate">{roleNames[0] ?? "—"}</div>
          </div>
          <button
            onClick={signOut}
            className="p-2 rounded-md hover:bg-accent text-muted-foreground"
            title="登出"
            aria-label="登出"
          >
            <LogOut className="w-4 h-4" />
          </button>

        </div>
      </div>
    </div>
  );
}

export function AppSidebar() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  // Close drawer when route changes
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-40 flex items-center justify-between h-12 px-3 border-b bg-card">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button
              className="p-2 -ml-2 rounded-md hover:bg-accent"
              aria-label="開啟選單"
            >
              <Menu className="w-5 h-5" />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-72 max-w-[85vw]">
            <SheetTitle className="sr-only">主選單</SheetTitle>
            <SidebarInner onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="艾士實業" className="w-6 h-6 object-contain" />
          <h1 className="text-sm font-bold text-primary">艾士 內部管理平台</h1>
        </div>
        <span className="w-9" />
      </header>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 border-r bg-card flex-col">
        <SidebarInner />
      </aside>
    </>
  );
}

function SideLink({
  to,
  icon,
  title,
  active,
  onNavigate,
  indent,
}: {
  to: string;
  icon: string | null;
  title: string;
  active: boolean;
  onNavigate?: () => void;
  indent?: boolean;
}) {
  return (
    <Link
      to={to as any}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-md text-base transition-colors",
        indent && "ml-2",
        active
          ? "bg-accent text-accent-foreground font-medium"
          : "text-foreground/80 hover:bg-accent/50"
      )}
    >
      <Icon name={icon} className="w-5 h-5 shrink-0" />
      <span className="truncate">{title}</span>
    </Link>
  );
}
