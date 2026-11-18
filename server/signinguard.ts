// Trang đăng nhập của bên thứ ba (Google, Microsoft, Apple, GitHub, Facebook…) không được mở trong trình duyệt của Synchro.
// Trình duyệt của Synchro chạy trên máy chủ và giữ cookie giữa các lần: tài khoản Google / Microsoft… đăng nhập ở đó thành phiên nằm trên
// máy chủ, model đọc và bấm được trong mọi lượt sau (kể cả lượt bị trang web chèn lời dụ dỗ), và người dùng phải gõ mật khẩu vào trang
// do model mở ra. Việc cần tài khoản của người dùng ở các dịch vụ này đi qua connector (Cài đặt → Connectors, Composio), hoặc Chrome của
// chính người dùng (browser="user", tài khoản họ đã đăng nhập sẵn, họ xem trên máy mình). Người dùng tự gõ địa chỉ ở thanh địa chỉ của
// khung trình duyệt thì không bị chặn: chỉ thao tác của model đi qua đây (browsertools.ts runBrowserTool).

type Rule = { host: RegExp; path?: RegExp; name: string };
// Đuôi tên miền quốc gia của Google / Zoho / Amazon (accounts.google.com.vn, accounts.google.co.uk…), không nhận đuôi dài tùy ý
// (accounts.google.com.evil.example là trang của người khác).
const TLD = "(com|[a-z]{2}|co\\.[a-z]{2}|com\\.[a-z]{2})";
// host: tên miền đầy đủ (kể cả tên miền con), không phân biệt hoa thường. path: chỉ chặn đường dẫn đăng nhập của tên miền chung (github.com…), trọn một đoạn đường dẫn (/login, /login/oauth…, /login.php; không chặn /loginator).
const RULES: Rule[] = [
  { host: new RegExp(`^accounts\\.google\\.${TLD}$`), name: "Google" },
  { host: /^(accounts\.youtube\.com|myaccount\.google\.com)$/, name: "Google" },
  { host: /^(login\.microsoftonline\.com|login\.microsoft\.com|login\.live\.com|login\.windows\.net|account\.live\.com|account\.microsoft\.com|login\.microsoftonline\.us|login\.partner\.microsoftonline\.cn)$/, name: "Microsoft" },
  { host: /^(appleid\.apple\.com|idmsa\.apple\.com|account\.apple\.com|signin\.apple\.com)$/, name: "Apple" },
  { host: /^github\.com$/, path: /^\/(login|session|sessions|password_reset)(?=[/.]|$)/i, name: "GitHub" },
  { host: /^(www\.|m\.|web\.)?facebook\.com$/, path: /^\/(login|dialog\/oauth|v\d+(\.\d+)?\/dialog\/oauth|recover)(?=[/.]|$)/i, name: "Facebook" },
  { host: /^login\.yahoo\.com$/, name: "Yahoo" },
  { host: /^(www\.)?(x|twitter)\.com$/, path: /^\/(i\/flow\/login|login|oauth|i\/oauth2)(?=[/.]|$)/i, name: "X" },
  { host: /^api\.(x|twitter)\.com$/, path: /^\/oauth/i, name: "X" },
  { host: /^(www\.)?linkedin\.com$/, path: /^\/(login|uas\/login|checkpoint\/lg|oauth)(?=[/.]|$)/i, name: "LinkedIn" },
  { host: /^id\.atlassian\.com$/, name: "Atlassian" },
  { host: /^(www\.)?dropbox\.com$/, path: /^\/(login|oauth2\/authorize)(?=[/.]|$)/i, name: "Dropbox" },
  { host: /^(slack\.com|[a-z0-9-]+\.slack\.com)$/, path: /^\/(signin|sign_in_with_password|oauth)(?=[/.]|$)/i, name: "Slack" },
  { host: /^(www\.)?notion\.so$/, path: /^\/login(?=[/.]|$)/i, name: "Notion" },
  { host: /^login\.salesforce\.com$/, name: "Salesforce" },
  { host: new RegExp(`^accounts\\.zoho\\.${TLD}$`), name: "Zoho" },
  { host: new RegExp(`^(www\\.)?amazon\\.${TLD}$`), path: /^\/ap\/signin/i, name: "Amazon" },
  { host: /^auth\.openai\.com$/, name: "OpenAI" },
];

const parse = (raw: string): URL | null => {
  const s = String(raw ?? "").trim();
  if (!s || /^(back|forward|reload)$/i.test(s)) return null;
  // Như browser-act.mjs: chữ có khoảng trắng hoặc không có dấu chấm là từ khóa tìm Google, không phải địa chỉ.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s) && (/\s/.test(s) || !/\./.test(s))) return null;
  try { return new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`); } catch { return null; }
};

/** Địa chỉ là trang đăng nhập của dịch vụ nào (tên dịch vụ), hoặc null. */
export function signInService(url: unknown): string | null {
  const u = parse(String(url ?? ""));
  if (!u || !/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  for (const r of RULES) if (r.host.test(host) && (!r.path || r.path.test(u.pathname))) return r.name;
  return null;
}

/** Các địa chỉ mà một lời gọi công cụ trình duyệt sẽ mở (browser_navigate, browser_tabs op="new", và các bước đó trong browser_batch). */
export function urlsOf(name: string, input: Record<string, unknown>): string[] {
  const one = (action: string, a: Record<string, unknown>) => (action === "navigate" || (action === "tabs" && a.op === "new")) && typeof a.url === "string" ? [a.url] : [];
  if (name === "browser_batch") return (Array.isArray(input.actions) ? input.actions : []).flatMap((x) => (x && typeof x === "object" ? one(String((x as Record<string, unknown>).action ?? ""), x as Record<string, unknown>) : []));
  return one(name.replace(/^browser_/, ""), input);
}

/** Lời dặn cho model khi chặn. how: "blocked" (chưa mở), "closed" (vừa tới trang đăng nhập do thao tác của model, Synchro đã đóng),
 *  "present" (trang đang mở sẵn là trang đăng nhập, có thể do người dùng tự mở: không đọc, không thao tác, không đóng). */
export function signInRefusal(service: string, url: string, how: "blocked" | "closed" | "present") {
  const u = url.slice(0, 160);
  const head = how === "blocked" ? `Không mở ${u}: đây là trang đăng nhập ${service}.`
    : how === "closed" ? `Thao tác vừa rồi dẫn tới trang đăng nhập ${service} (${u}) nên Synchro đã đóng trang đó.`
    : `Trang đang mở (${u}) là trang đăng nhập ${service}: Synchro không đọc hay thao tác trên trang này.`;
  return `${head} Trình duyệt của Synchro chạy trên máy chủ nên không dùng để đăng nhập tài khoản ${service} hay dịch vụ bên thứ ba khác; đừng thử lại bằng địa chỉ khác, nút "Đăng nhập bằng ${service}" hay browser_eval.
Việc cần dữ liệu trong tài khoản của người dùng (Google Docs / Drive / Gmail / Lịch, Outlook, GitHub, Slack, Notion…):
- Đã có connector cho dịch vụ đó: dùng công cụ của connector.
- Chưa có: nói ngắn gọn với người dùng rằng cần kết nối dịch vụ này trong Cài đặt → Connectors (liên kết Composio để dùng Google Docs, Gmail, Drive… và hơn 1000 ứng dụng); nếu có công cụ connector_reconnect thì gọi nó với connector "Composio" để hiện nút liên kết ngay trong khung chat. Kết nối xong thì người dùng nhắc lại yêu cầu.
- Người dùng nói rõ muốn làm trên Chrome của họ (đã đăng nhập sẵn) thì dùng browser="user".
Không bảo người dùng đăng nhập trong trình duyệt của Synchro.`;
}
