// Connect Link của Composio (đường link đăng nhập một ứng dụng chưa liên kết, do Composio Connect trả về): dùng chung cho máy chủ và trình duyệt.
// Máy chủ: chỉ link của Composio mới thành nút "Kết nối <Ứng dụng>" trong khung chat; link này không phải nguồn trích dẫn (Sources).
// Trình duyệt: câu trả lời lỡ chép link thành Markdown thì hiện thành nút, không hiện link trần, và không lặp lại dưới mục "Sources:".

// Máy chủ của Composio có thể trả Connect Link (connect.composio.dev/link/…, backend.composio.dev/api/v3/s/…, app.composio.dev/…). Trang tài liệu,
// trang chủ, máy chủ MCP và trang đăng nhập OAuth của Composio không phải Connect Link.
const HOSTS = new Set(["connect.composio.dev", "backend.composio.dev", "app.composio.dev"]);
const NOT_LINK = /^\/(?:$|mcp\b|login\b|oauth2?\b|\.well-known\b|docs\b)/i;

/** local: chấp nhận Connect Link của Composio giả lập (http://127.0.0.1|localhost/composio/link/…) — chỉ khi máy chủ / trang đang chạy bản giả lập. */
export function isConnectUrl(raw: string, local = false): boolean {
  if (typeof raw !== "string" || raw.length > 2000) return false;
  try {
    const u = new URL(raw);
    if (u.username || u.password) return false;
    if (local && (u.hostname === "127.0.0.1" || u.hostname === "localhost") && /^https?:$/.test(u.protocol) && /^\/composio\/link\/[\w-]+$/.test(u.pathname)) return true;
    return u.protocol === "https:" && !u.port && HOSTS.has(u.hostname) && !NOT_LINK.test(u.pathname);
  } catch { return false; }
}

/** Tên ứng dụng từ nhãn link model viết ("👉 Kết nối Gmail", "Connect Slack"): bỏ ký hiệu và động từ ở đầu. */
export function connectName(label: string): string {
  // Link trần (nhãn chính là địa chỉ): không có tên ứng dụng.
  if (/^\s*(?:https?:\/\/|www\.)/i.test(label)) return "";
  const s = label.replace(/^[^\p{L}\p{N}]+/u, "").replace(/^(?:kết nối|liên kết|đăng nhập|connect|link|sign in to|authorize)\s+/i, "").replace(/\s+(?:qua|via|with)\s+composio$/i, "").trim();
  return s.slice(0, 40);
}

const MD_LINK = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)|<?(https?:\/\/[^\s)>\]"']+)>?/g;
const SOURCES = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:sources?|nguồn(?: tham khảo)?|references?|tham khảo)\s*:?\s*(?:\*\*|__)?\s*:?\s*$/i;
const LIST = /^\s*(?:[-*+]|\d+[.)])\s+/;
const HEADING = /^\s*(?:#{1,6}\s+\S|(?:\*\*|__)[^*_]+(?:\*\*|__)\s*:?\s*$)/;

/**
 * Câu trả lời có Connect Link của Composio: bỏ dòng chỉ chứa link đó nằm dưới mục "Sources:" / "Nguồn:" (và cả mục nếu không còn gì), bỏ dòng lặp lại
 * đúng một link đã có ở trên. Link còn lại (lần đầu) vẫn ở chỗ cũ để trang hiện thành nút. Không có Connect Link nào thì trả nguyên văn.
 */
export function tidyConnectLinks(text: string, local = false): string {
  if (!text || (!/composio\.dev/i.test(text) && !(local && /\/composio\/link\//.test(text)))) return text;
  const lines = text.split("\n");
  const seen = new Set<string>();
  const out: (string | null)[] = [];
  let inSrc = false, blank = false, fence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) { out.push(line); continue; }
    if (SOURCES.test(line)) { inSrc = true; blank = false; out.push(line); continue; }
    // Mục nguồn kết thúc ở tiêu đề khác, hoặc ở đoạn văn thường sau một dòng trống.
    if (inSrc && (HEADING.test(line) || (blank && line.trim() && !LIST.test(line)))) inSrc = false;
    blank = !line.trim();
    const urls: string[] = [];
    const rest = line.replace(MD_LINK, (m, _l, a, b) => { const u = String(a ?? b ?? "").replace(/[.,;:]+$/, ""); if (isConnectUrl(u, local)) { urls.push(u); return ""; } return m; });
    if (!urls.length) { out.push(line); continue; }
    // Dòng chỉ có link (kèm dấu đầu dòng, ký hiệu, chữ "Kết nối"…): trong mục nguồn hoặc lặp lại link đã có thì bỏ.
    const only = !rest.replace(/^\s*(?:[-*+]|\d+[.)])?\s*/, "").replace(/[^\p{L}\p{N}]+/gu, "").replace(/^(?:kếtnối|liênkết|connect|link)$/i, "");
    if (only && (inSrc || urls.every((u) => seen.has(u)))) { out.push(null); for (const u of urls) seen.add(u); continue; }
    for (const u of urls) seen.add(u);
    out.push(line);
  }
  // Mục "Sources:" chỉ còn dòng trống (mọi dòng đã bỏ là Connect Link): bỏ luôn tiêu đề.
  const keep = out.slice();
  for (let i = 0; i < keep.length; i++) {
    if (keep[i] === null || !SOURCES.test(keep[i]!)) continue;
    let dropped = false, left = false, gap = false;
    for (let j = i + 1; j < keep.length; j++) {
      const l = keep[j];
      if (l === null) { dropped = true; continue; }
      if (HEADING.test(l) || SOURCES.test(l)) break;
      if (!l.trim()) { gap = true; continue; }
      if (gap && !LIST.test(l)) break;
      left = true; break;
    }
    if (dropped && !left) keep[i] = null;
  }
  const res = keep.filter((l): l is string => l !== null).join("\n").replace(/\n{3,}/g, "\n\n");
  return text.endsWith("\n") ? res : res.trimEnd();
}
