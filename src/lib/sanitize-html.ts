// 輕量 HTML 消毒（無外部相依）——防止儲存型 XSS。
//
// 用途：文件中心內文、許願池描述、線上手冊／系統文件（DocRenderer 的 HTML 模式），
//   這些都會被 dangerouslySetInnerHTML 渲染。若不消毒，有寫入權的人可貼入
//   <script>、<img onerror>、javascript: 連結等，在其他人（含管理者）已登入的
//   瀏覽器裡執行 —— 竊取工作階段、代替對方送出任何操作。
//
// 作法：用瀏覽器內建 DOMParser 解析成 DOM，再依白名單保留標籤/屬性，
//   丟掉 script/事件處理器(onXXX)/危險 URL。採後序處理，被展開的節點也會先被清。
//   DOMParser 解析時不會執行任何腳本，所以解析階段本身是安全的。
//
// 2026-08-29：新增 <style> 支援。線上使用手冊(47KB)自帶一段 6.9KB 的 .eip-manual
//   scoped 樣式，原本因為 <style> 不在白名單而會被展開成一大段可見文字，
//   所以整份手冊當初才「不敢消毒」。現在改成保留 <style> 但過濾 CSS 內容
//   （見 sanitizeCss），手冊排版不受影響，也不再有未消毒的渲染路徑。
//
// 註：理想上改用 DOMPurify（更完整、對付各種繞過），但那需要新增相依與更新 lock；
//   此版本涵蓋主要向量，作為內部系統的務實加固。若日後加 DOMPurify，替換此函式即可。

const ALLOWED_TAGS = new Set([
  "p", "br", "b", "strong", "i", "em", "u", "s", "strike", "span", "div", "a",
  "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre",
  "code", "hr", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
  "img", "figure", "figcaption", "section", "article", "header", "footer",
  "nav", "main", "small", "sup", "sub", "dl", "dt", "dd",
]);
// 2026-10-17 總檢查：<style> 會影響整個頁面（可用來遮蓋畫面、做假登入框），
//   只開放給管理者維護的線上手冊／系統文件（DocRenderer 傳 allowStyleTag），
//   一般同仁可寫入的欄位（文件內文、許願池描述）一律不保留 <style>。
let allowStyleTag = false;

const ALLOWED_ATTR: Record<string, Set<string>> = {
  a: new Set(["href", "target", "rel"]),
  img: new Set(["src", "alt", "width", "height", "loading", "decoding"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan", "scope"]),
};
// class/id 是手冊排版與目錄錨點要用的；style 逐值檢查（見 cleanAttrs）。
const GLOBAL_ATTR = new Set(["class", "id", "title", "lang", "dir", "style"]);

// 這些標籤整棵砍掉，不是「展開保留文字」——否則 <script>alert(1)</script>
// 會在畫面上留下 alert(1) 這行字（雖然不會執行，但很難看，也讓人誤以為沒清乾淨）。
const DROP_TAGS = new Set([
  "script", "iframe", "object", "embed", "applet", "form", "input", "textarea",
  "select", "button", "link", "meta", "base", "noscript", "template",
  "frame", "frameset", "svg", "math",
]);

// 允許的 URL 開頭：http(s)/mailto/tel/file、站內相對、錨點、以及 base64 圖片。
const SAFE_URL = /^(https?:|mailto:|tel:|file:|\/|#|data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,)/i;

// style 屬性值與 <style> 內容共用的危險樣式判定
const DANGEROUS_CSS = /(expression\s*\(|javascript\s*:|behavior\s*:|-moz-binding|@import)/i;

// <style> 區塊的內容過濾。
// 保留一般樣式與 @media；拿掉會執行程式或往外連的東西：
//   @import      → 可載入外部樣式表
//   expression() → 舊 IE 的執行式
//   behavior / -moz-binding → 舊瀏覽器的行為繫結
//   url(...)     → 只留 data:image；其餘一律拿掉，避免用屬性選擇器把內容外傳
function sanitizeCss(css: string): string {
  return css
    .replace(/<\/?\s*style/gi, "")
    .replace(/@import[^;]*;?/gi, "")
    .replace(/expression\s*\(/gi, "(")
    .replace(/behavior\s*:[^;}]*/gi, "")
    .replace(/-moz-binding\s*:[^;}]*/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/url\(\s*(['"]?)(?!data:image\/)[^)]*\1\s*\)/gi, "none");
}

function cleanAttrs(el: Element, tag: string) {
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const value = attr.value ?? "";
    if (name.startsWith("on")) { el.removeAttribute(attr.name); continue; } // 事件處理器一律拿掉
    const allowed = GLOBAL_ATTR.has(name) || (ALLOWED_ATTR[tag]?.has(name) ?? false);
    if (!allowed) { el.removeAttribute(attr.name); continue; }
    if ((name === "href" || name === "src") && !SAFE_URL.test(value.trim())) { el.removeAttribute(attr.name); continue; }
    if (name === "style" && (DANGEROUS_CSS.test(value) || /url\s*\(/i.test(value))) {
      el.removeAttribute(attr.name); continue;
    }
  }
  if (tag === "a") el.setAttribute("rel", "noreferrer noopener");
}

function walk(el: Element) {
  for (const child of Array.from(el.children)) {
    const tag = child.tagName.toLowerCase();

    if (DROP_TAGS.has(tag)) {
      child.remove();
      continue;
    }

    if (tag === "style" && !allowStyleTag) {
      child.remove();
      continue;
    }
    if (tag === "style") {
      // 只留過濾後的 CSS 文字，屬性全部丟掉（media/nonce 等一律不需要）
      const css = sanitizeCss(child.textContent ?? "");
      for (const attr of Array.from(child.attributes)) child.removeAttribute(attr.name);
      child.textContent = css;
      continue;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      walk(child); // 先清子樹，確保被提升上來的孫節點也已消毒
      child.replaceWith(...Array.from(child.childNodes)); // 保留文字內容、丟掉不允許的標籤
      continue;
    }

    cleanAttrs(child, tag);
    walk(child);
  }
}

export function sanitizeHtml(dirty: string | null | undefined, opts?: { allowStyleTag?: boolean }): string {
  if (!dirty) return "";
  if (typeof window === "undefined" || typeof window.DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(String(dirty), "text/html");
  allowStyleTag = !!opts?.allowStyleTag;
  try { walk(doc.body); } finally { allowStyleTag = false; }
  return doc.body.innerHTML;
}
