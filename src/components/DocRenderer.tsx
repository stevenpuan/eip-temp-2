import {
  BookOpen,
  LogIn,
  LayoutDashboard,
  ListChecks,
  Repeat,
  Bell,
  CalendarDays,
  FolderKanban,
  FileText,
  Megaphone,
  BarChart3,
  Sparkles,
  Settings,
  HelpCircle,
  Target,
  Boxes,
  Users,
  Blocks,
  ShieldCheck,
  Wrench,
  Rocket,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { sanitizeHtml } from "@/lib/sanitize-html";

// Strip leading emoji / symbols / whitespace from a title line.
function stripLeadingEmoji(s: string): string {
  // Remove leading non-letter/number chars (emoji, punctuation, spaces)
  return s.replace(/^[\s\p{Extended_Pictographic}\p{Emoji_Presentation}\p{S}\p{P}]+/u, "").trim();
}

const ICON_MAP: Array<{ keys: string[]; icon: LucideIcon }> = [
  { keys: ["登入"], icon: LogIn },
  { keys: ["首頁", "概況", "概覽", "儀表"], icon: LayoutDashboard },
  { keys: ["任務"], icon: ListChecks },
  { keys: ["常態", "週期", "例行"], icon: Repeat },
  { keys: ["臨時", "回報"], icon: Bell },
  { keys: ["會議"], icon: CalendarDays },
  { keys: ["專案"], icon: FolderKanban },
  { keys: ["文件"], icon: FileText },
  { keys: ["公告"], icon: Megaphone },
  { keys: ["報表", "分析", "統計"], icon: BarChart3 },
  { keys: ["AI", "助理", "智能"], icon: Sparkles },
  { keys: ["個人", "設定", "偏好"], icon: Settings },
  { keys: ["協助", "問題", "FAQ", "常見"], icon: HelpCircle },
  { keys: ["定位"], icon: Target },
  { keys: ["架構", "技術"], icon: Boxes },
  { keys: ["角色", "權限"], icon: Users },
  { keys: ["模組"], icon: Blocks },
  { keys: ["安全"], icon: ShieldCheck },
  { keys: ["維運", "運維"], icon: Wrench },
  { keys: ["未來", "延伸", "規劃"], icon: Rocket },
];

function pickIcon(title: string): LucideIcon {
  for (const { keys, icon } of ICON_MAP) {
    if (keys.some((k) => title.includes(k))) return icon;
  }
  return BookOpen;
}

type Section = { title: string; rawTitle: string; lines: string[] };

function parseSections(content: string): Section[] {
  const blocks = content.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split("\n");
    const rawTitle = lines[0] ?? "";
    return {
      rawTitle,
      title: stripLeadingEmoji(rawTitle) || rawTitle,
      lines: lines.slice(1),
    };
  });
}

function renderBody(lines: string[]) {
  const items: { type: "bullet" | "text"; text: string }[] = [];
  for (const ln of lines) {
    const t = ln.trim();
    if (!t) continue;
    if (/^[-•*]\s+/.test(t)) {
      items.push({ type: "bullet", text: t.replace(/^[-•*]\s+/, "") });
    } else {
      items.push({ type: "text", text: t });
    }
  }
  const bullets = items.filter((i) => i.type === "bullet");
  const texts = items.filter((i) => i.type === "text");
  return (
    <div className="space-y-3">
      {texts.length > 0 && (
        <div className="space-y-2 text-sm leading-7 text-foreground/80">
          {texts.map((t, i) => (
            <p key={i}>{t.text}</p>
          ))}
        </div>
      )}
      {bullets.length > 0 && (
        <ul className="space-y-2">
          {bullets.map((b, i) => (
            <li key={i} className="flex gap-2 text-sm leading-7 text-foreground/85">
              <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary/60" />
              <span className="flex-1">{b.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DocRenderer({ content }: { content: string }) {
  if (!content?.trim()) {
    return <div className="text-sm text-muted-foreground">（尚無內容）</div>;
  }

  // Rich HTML document mode：內容以 HTML 標籤開頭時整段渲染（手冊自帶 .eip-manual
  // scoped 樣式）。使用者手冊 v4.0+ 走這條。
  //
  // 2026-08-29：這裡原本是 dangerouslySetInnerHTML 直接吃 content，理由是
  // 「只有有編輯權的人寫得進 doc_pages，算可信內容」。但可信不等於安全 ——
  // 那是 4 個帳號（系統設計師＋3 位管理者），其中任何一個被盜或一時大意貼錯東西，
  // 惡意腳本就會在全體員工（含系統設計師本人）已登入的瀏覽器裡執行。
  // 現在一律消毒後再渲染。sanitizeHtml 已支援 <style>，手冊排版不受影響
  // （實測 1156 個元素、49 個目錄錨點、6914 位元組 CSS 全數保留，
  //   唯一差異是 49 個 <a> 補上 rel="noreferrer noopener"）。
  if (content.trimStart().startsWith("<")) {
    return (
      <div
        className="eip-doc-html"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }}
      />
    );
  }

  const sections = parseSections(content);
  if (sections.length === 0) {
    return <div className="whitespace-pre-wrap text-sm leading-7 text-foreground/90">{content}</div>;
  }

  const [head, ...rest] = sections;
  const HeadIcon = pickIcon(head.title);

  return (
    <div className="space-y-6">
      <div className="space-y-2 border-b pb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <HeadIcon className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{head.title}</h1>
        </div>
        {head.lines.length > 0 && (
          <div className="pl-13 sm:pl-[52px] text-sm leading-7 text-muted-foreground">
            {head.lines.map((l, i) => (
              <p key={i}>{l.replace(/^[-•*]\s+/, "")}</p>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {rest.map((sec, idx) => {
          const Icon = pickIcon(sec.title);
          return (
            <Card key={idx} className="overflow-hidden">
              <CardContent className="space-y-4 p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Icon className="h-4.5 w-4.5 text-primary" strokeWidth={2} />
                  </div>
                  <h2 className="text-base font-semibold tracking-tight sm:text-lg">{sec.title}</h2>
                </div>
                {renderBody(sec.lines)}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
