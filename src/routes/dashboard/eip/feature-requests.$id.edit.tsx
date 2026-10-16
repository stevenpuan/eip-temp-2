import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Bold, Italic, Underline, List, ListOrdered, Link as LinkIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { sanitizeHtml } from "@/lib/sanitize-html";
import { useEipUser } from "@/lib/eip-user";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { humanizeError } from "@/lib/eip-error";

export const Route = createFileRoute("/dashboard/eip/feature-requests/$id/edit")({
  component: EditFeatureRequestPage,
});

const SCOPE_OPTIONS = ["前台", "後台", "全站", "其他"];
const TYPE_OPTIONS = ["新增功能", "修改功能", "修正問題", "其他"];

function EditFeatureRequestPage() {
  const navigate = useNavigate();
  const { id } = useParams({ from: "/dashboard/eip/feature-requests/$id/edit" });
  const { appUser } = useEipUser();
  const { can } = useAuth();
  const canManage = can("eip_feature_pool", "edit");

  const [title, setTitle] = useState("");
  const [scope, setScope] = useState("");
  const [requestType, setRequestType] = useState("");
  const [area, setArea] = useState("");
  const [points, setPoints] = useState(1);
  const editorRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const q = useQuery({
    queryKey: ["eip", "feature-request", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eip_feature_request")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (q.data && !loaded) {
      setTitle(q.data.title ?? "");
      setScope(q.data.scope ?? "");
      setRequestType(q.data.request_type ?? "");
      setArea(q.data.area ?? "");
      setPoints(q.data.points_cost ?? 1);
      // 先消毒再放進編輯器：直接 innerHTML 會讓別人存進去的 <img onerror> 在編輯者的瀏覽器執行（2026-10-17 總檢查）
      if (editorRef.current) editorRef.current.innerHTML = sanitizeHtml(q.data.description ?? "");
      setLoaded(true);
    }
  }, [q.data, loaded]);

  const exec = (cmd: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
  };
  const insertLink = () => {
    const url = window.prompt("請輸入連結網址", "https://");
    if (url) exec("createLink", url);
  };

  if (q.isLoading) return <div className="text-muted-foreground py-8">載入中…</div>;
  if (!q.data) return <div className="text-muted-foreground py-8">找不到此需求</div>;

  const isOwner = appUser && q.data.submitter_id === appUser.id;
  if (!isOwner && !canManage) {
    return <div className="text-muted-foreground py-8">無權限編輯此需求</div>;
  }

  const submit = async () => {
    if (!title.trim()) return toast.error("請輸入需求標題");
    if (!scope) return toast.error("請選擇應用範圍");
    if (!requestType) return toast.error("請選擇需求類型");
    if (!area.trim()) return toast.error("請輸入區塊 / 功能名稱");
    const html = editorRef.current?.innerHTML ?? "";
    const plain = (editorRef.current?.innerText ?? "").trim();
    if (!plain) return toast.error("請輸入詳細描述");

    setBusy(true);
    try {
      const { error } = await supabase
        .from("eip_feature_request")
        .update({
          title: title.trim(),
          scope,
          request_type: requestType,
          area: area.trim(),
          points_cost: Math.max(1, Math.floor(points || 1)),
          description: html,
        })
        .eq("id", id);
      if (error) throw error;
      toast.success("已更新需求");
      navigate({ to: "/dashboard/eip/feature-requests" });
    } catch (e) {
      toast.error(humanizeError(e, "更新需求"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <Link
          to="/dashboard/eip/feature-requests"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          返回需求清單
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold">編輯需求單</h1>
      </div>

      <Card>
        <CardContent className="p-6 grid gap-4">
          <Field label="需求標題" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>

          <div className="grid md:grid-cols-2 gap-4">
            <Field label="應用範圍" required>
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger><SelectValue placeholder="請選擇" /></SelectTrigger>
                <SelectContent>
                  {SCOPE_OPTIONS.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="需求類型" required>
              <Select value={requestType} onValueChange={setRequestType}>
                <SelectTrigger><SelectValue placeholder="請選擇" /></SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Field label="區塊 / 功能名稱" required>
              <Input value={area} onChange={(e) => setArea(e.target.value)} />
            </Field>
            <Field label="消耗點數">
              <Input type="number" min={1} value={points} onChange={(e) => setPoints(Number(e.target.value))} />
            </Field>
          </div>

          <Field label="詳細描述" required>
            <div className="border rounded-md overflow-hidden">
              <div className="flex flex-wrap items-center gap-1 border-b bg-muted/40 px-2 py-1">
                <ToolBtn onClick={() => exec("bold")} title="粗體"><Bold className="w-4 h-4" /></ToolBtn>
                <ToolBtn onClick={() => exec("italic")} title="斜體"><Italic className="w-4 h-4" /></ToolBtn>
                <ToolBtn onClick={() => exec("underline")} title="底線"><Underline className="w-4 h-4" /></ToolBtn>
                <div className="w-px h-4 bg-border mx-1" />
                <ToolBtn onClick={() => exec("insertUnorderedList")} title="項目清單"><List className="w-4 h-4" /></ToolBtn>
                <ToolBtn onClick={() => exec("insertOrderedList")} title="編號清單"><ListOrdered className="w-4 h-4" /></ToolBtn>
                <div className="w-px h-4 bg-border mx-1" />
                <ToolBtn onClick={insertLink} title="插入連結"><LinkIcon className="w-4 h-4" /></ToolBtn>
              </div>
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                className="min-h-[180px] p-3 text-sm focus:outline-none prose prose-sm max-w-none"
              />
            </div>
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" type="button" onClick={() => navigate({ to: "/dashboard/eip/feature-requests" })} disabled={busy}>
              取消
            </Button>
            <Button onClick={submit} disabled={busy}>儲存變更</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-sm">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      {children}
    </div>
  );
}

function ToolBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
    >
      {children}
    </button>
  );
}
