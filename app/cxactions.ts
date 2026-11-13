// Thao tác Composio bằng lời thường, dùng chung cho máy chủ và trình duyệt (không phụ thuộc Node):
//  - tách ứng dụng khỏi tên thao tác: GOOGLEDOCS_CREATE_DOCUMENT → ứng dụng googledocs, thao tác CREATE_DOCUMENT;
//  - thao tác đọc hay ghi: động từ đọc (GET, LIST, FETCH…) đứng ngay sau tên ứng dụng là đọc, mọi thao tác khác là ghi;
//  - nhãn tiếng Việt cho dòng công cụ và thẻ duyệt ("Google Docs · Tạo tài liệu"), kèm bản tiếng Anh cho từ điển giao diện (i18n-dict.ts).

/** Động từ đọc: đứng ngay sau tên ứng dụng thì thao tác là đọc (chạy không cần hỏi). */
export const READ_VERBS = new Set(["GET", "LIST", "FETCH", "SEARCH", "FIND", "READ", "RETRIEVE", "DESCRIBE", "QUERY", "VIEW"]);
// Động từ ghi rõ ràng ở bất cứ đâu sau động từ đọc (GMAIL_GET_AND_DELETE…) thì vẫn là ghi.
const WRITE_ANY = new Set(["CREATE", "DELETE", "REMOVE", "WRITE", "INSERT", "REPLACE", "EDIT", "EXECUTE", "DROP", "CANCEL", "DESTROY", "PURGE", "UPSERT", "OVERWRITE", "TRUNCATE", "ALTER", "GRANT", "REVOKE", "SEND", "UPDATE", "MODIFY", "UPLOAD", "TRASH"]);
// Vừa là động từ vừa là danh từ: chỉ tính là ghi khi nối sau AND / OR / THEN (FIND_AND_UPDATE, GET_OR_SET).
const WRITE_NOUN = new Set(["POST", "RUN", "SET", "PATCH", "PUT", "PUBLISH", "ADD", "SAVE", "STORE", "MOVE", "RENAME", "ARCHIVE", "ASSIGN", "APPROVE", "REJECT", "MARK", "LOCK", "MERGE", "DEPLOY", "TRIGGER", "IMPORT", "APPLY", "COMMIT", "PUSH", "START", "STOP"]);
const LINK_WORD = new Set(["AND", "OR", "THEN"]);
// Động từ vừa là danh từ, một mình không nói đọc cái gì (QUERY / FIND đứng một mình có thể là câu lệnh bất kỳ): coi là ghi (hỏi trước), như VAGUE_ALONE ở mcp.ts.
const VAGUE_ALONE = new Set(["QUERY", "FIND"]);
// Mọi động từ (đọc + ghi): dùng để dò ranh giới tên ứng dụng ↔ tên thao tác khi không có MULTI_KITS / toolkit.
const ALL_VERBS = new Set([...READ_VERBS, ...WRITE_ANY, ...WRITE_NOUN]);
// Tham số có dấu hiệu chạy lệnh / truy vấn tùy ý: không coi là đọc dù tên có động từ đọc.
const RISKY_PARAM = /^(sql|sql_?query|query_?sql|statement|stmt|command|cmd|mutation|shell|script|code)$/i;
// Tham số của QUERY mang câu lệnh: trị của query / q / sql có từ khóa đổi dữ liệu thì coi là ghi.
const QUERY_KEYS = ["query", "q", "sql"];
const RISKY_SQL = /\b(insert|update|delete|drop|alter|truncate|create|replace|merge|grant)\b/i;
// Ứng dụng có tên hai từ (GOOGLE_MAPS_GET_ROUTE): biết trước thì tách đúng; không biết thì tên ứng dụng là từ đầu và thao tác bị coi là ghi (hỏi trước).
const MULTI_KITS = new Set(["google_maps", "google_analytics", "google_ads", "google_tasks", "google_photos", "google_bigquery", "microsoft_teams", "one_drive", "share_point"]);

const words = (slug: string) => slug.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
/** Ứng dụng (slug Composio, chữ thường) và phần còn lại của tên thao tác.
 *  toolkit: tên ứng dụng do lời gọi khai báo (trường toolkit / app); có thì tách theo nó.
 *  Không có thì tìm động từ trong 1–3 từ đầu (mọi từ trước động từ là tên ứng dụng), cuối cùng mới dùng MULTI_KITS. */
export function slugParts(slug: string, toolkit?: string): { kit: string; rest: string[] } {
  const w = words(slug);
  let n = 0;
  const tk = toolkit ? words(toolkit) : [];
  if (tk.length && tk.length < w.length && tk.every((x, i) => x === w[i])) n = tk.length;
  if (!n) {
    const i = w.findIndex((x, k) => k > 0 && k <= 3 && ALL_VERBS.has(x));
    n = i >= 1 ? i : w.length > 2 && MULTI_KITS.has(`${w[0]}_${w[1]}`.toLowerCase()) ? 2 : 1;
  }
  return { kit: w.slice(0, n).join("_").toLowerCase(), rest: w.slice(n) };
}
/** Thao tác Composio có phải chỉ đọc không: động từ đọc ngay sau tên ứng dụng, không kèm động từ ghi, tham số không có dấu hiệu chạy lệnh. Không chắc thì là ghi. */
export function slugIsRead(slug: string, args?: unknown, toolkit?: string): boolean {
  const { rest } = slugParts(slug, toolkit);
  if (!rest.length || !READ_VERBS.has(rest[0])) return false;
  // QUERY / FIND đứng một mình sau tên ứng dụng (SUPABASE_QUERY, GOOGLEBIGQUERY_QUERY): không rõ đọc cái gì → coi là ghi.
  if (rest.length === 1 && VAGUE_ALONE.has(rest[0])) return false;
  // Động từ ghi rõ ràng ở bất cứ đâu; hoặc sau từ nối (AND / OR / THEN) bất kỳ động từ không phải động từ đọc
  // (FORWARD, SHARE, STAR, INVITE, REPLY, SUBMIT, ENROLL…): coi là ghi (fail-closed). LIST_AND_FORWARD, GET_OR_CREATE.
  if (rest.some((x, i) => i > 0 && (WRITE_ANY.has(x) || (LINK_WORD.has(rest[i - 1]) && !READ_VERBS.has(x))))) return false;
  const a = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : undefined;
  if (a && Object.keys(a).some((k) => RISKY_PARAM.test(k))) return false;
  // QUERY kèm câu lệnh đổi dữ liệu (…_QUERY { query: "DELETE …" }): coi là ghi.
  if (a && rest[0] === "QUERY" && QUERY_KEYS.some((k) => typeof a[k] === "string" && RISKY_SQL.test(a[k] as string))) return false;
  return true;
}

// ---- tên ứng dụng ----
const NAMES: Record<string, string> = {
  github: "GitHub", gitlab: "GitLab", googledrive: "Google Drive", googlesheets: "Google Sheets", googledocs: "Google Docs", googlecalendar: "Google Calendar",
  googleslides: "Google Slides", googlemeet: "Google Meet", googlemaps: "Google Maps", hubspot: "HubSpot", linkedin: "LinkedIn", youtube: "YouTube", clickup: "ClickUp",
  onedrive: "OneDrive", outlook: "Outlook", sharepoint: "SharePoint", whatsapp: "WhatsApp", paypal: "PayPal", quickbooks: "QuickBooks", zoho: "Zoho", posthog: "PostHog",
  microsoftteams: "Microsoft Teams", one_drive: "OneDrive", share_point: "SharePoint",
};
export const appName = (slug: string) => NAMES[slug] ?? slug.split(/[_-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

// ---- nhãn bằng lời thường ----
// [từ trong tên thao tác, tiếng Việt, tiếng Anh]. Cùng một chữ tiếng Việt thì cùng một bản tiếng Anh.
const VERBS: [string[], string, string][] = [
  [["CREATE", "MAKE", "GENERATE"], "Tạo", "Create"], [["ADD", "APPEND"], "Thêm", "Add"], [["INSERT"], "Chèn", "Insert"],
  [["GET", "VIEW"], "Xem", "View"], [["FETCH", "RETRIEVE"], "Lấy", "Get"], [["READ"], "Đọc", "Read"], [["DESCRIBE"], "Xem chi tiết", "Describe"],
  [["LIST"], "Liệt kê", "List"], [["SEARCH", "FIND"], "Tìm", "Find"], [["QUERY"], "Truy vấn", "Query"],
  [["UPDATE", "PATCH"], "Cập nhật", "Update"], [["MODIFY", "EDIT"], "Sửa", "Edit"], [["REPLACE"], "Thay", "Replace"],
  [["DELETE", "DESTROY", "PURGE"], "Xóa", "Delete"], [["REMOVE"], "Gỡ", "Remove"], [["TRASH"], "Chuyển vào thùng rác", "Move to trash"], [["CLEAR"], "Xóa nội dung", "Clear"],
  [["SEND"], "Gửi", "Send"], [["REPLY"], "Trả lời", "Reply to"], [["FORWARD"], "Chuyển tiếp", "Forward"], [["POST"], "Đăng", "Post"], [["PUBLISH"], "Xuất bản", "Publish"],
  [["UPLOAD"], "Tải lên", "Upload"], [["DOWNLOAD", "EXPORT"], "Tải xuống", "Download"], [["MOVE"], "Di chuyển", "Move"], [["COPY", "DUPLICATE"], "Sao chép", "Copy"],
  [["RENAME"], "Đổi tên", "Rename"], [["SHARE"], "Chia sẻ", "Share"], [["INVITE"], "Mời", "Invite"], [["ARCHIVE"], "Lưu trữ", "Archive"], [["STAR"], "Gắn sao", "Star"],
  [["MARK"], "Đánh dấu", "Mark"], [["MERGE"], "Gộp", "Merge"], [["CLOSE"], "Đóng", "Close"], [["OPEN"], "Mở", "Open"], [["RUN", "EXECUTE", "TRIGGER"], "Chạy", "Run"],
  [["START"], "Bắt đầu", "Start"], [["STOP"], "Dừng", "Stop"], [["CANCEL"], "Hủy", "Cancel"], [["SCHEDULE"], "Lên lịch", "Schedule"], [["SET"], "Đặt", "Set"],
  [["ASSIGN"], "Giao", "Assign"], [["APPROVE"], "Duyệt", "Approve"], [["IMPORT"], "Nhập", "Import"],
];
const NOUNS: [string[], string, string][] = [
  [["DOCUMENT", "DOC"], "tài liệu", "document"], [["EMAIL", "MAIL"], "email", "email"], [["MESSAGE"], "tin nhắn", "message"], [["THREAD"], "chuỗi thư", "thread"],
  [["DRAFT"], "thư nháp", "draft"], [["LABEL"], "nhãn", "label"], [["FILE"], "tệp", "file"], [["FOLDER", "DIRECTORY"], "thư mục", "folder"], [["EVENT"], "sự kiện", "event"],
  [["CALENDAR"], "lịch", "calendar"], [["SPREADSHEET"], "bảng tính", "spreadsheet"], [["SHEET", "WORKSHEET"], "trang tính", "sheet"], [["ROW"], "hàng", "row"], [["CELL"], "ô", "cell"],
  [["VALUE"], "giá trị", "values"], [["PAGE"], "trang", "page"], [["DATABASE"], "cơ sở dữ liệu", "database"], [["BLOCK"], "khối", "block"], [["COMMENT"], "bình luận", "comment"],
  [["ISSUE"], "issue", "issue"], [["REPOSITORY", "REPO"], "kho mã", "repository"], [["BRANCH"], "nhánh", "branch"], [["COMMIT"], "commit", "commit"], [["CHANNEL"], "kênh", "channel"],
  [["USER"], "người dùng", "user"], [["CONTACT"], "liên hệ", "contact"], [["TASK"], "việc", "task"], [["PROJECT"], "dự án", "project"], [["PRESENTATION"], "bài trình chiếu", "presentation"],
  [["SLIDE"], "trang chiếu", "slide"], [["MEETING"], "cuộc họp", "meeting"], [["VIDEO"], "video", "video"], [["IMAGE", "PHOTO"], "ảnh", "image"], [["TEXT"], "văn bản", "text"],
  [["CONTENT"], "nội dung", "content"], [["TABLE"], "bảng", "table"], [["RECORD"], "bản ghi", "record"], [["NOTE"], "ghi chú", "note"], [["REMINDER"], "lời nhắc", "reminder"],
  [["ATTACHMENT"], "tệp đính kèm", "attachment"], [["CARD"], "thẻ", "card"], [["BOARD"], "bảng làm việc", "board"], [["TWEET", "POST"], "bài đăng", "post"], [["LINK"], "liên kết", "link"],
  [["PERMISSION"], "quyền", "permission"], [["INVITATION"], "lời mời", "invitation"], [["RELEASE"], "bản phát hành", "release"], [["PROFILE"], "hồ sơ", "profile"],
  [["ACCOUNT"], "tài khoản", "account"], [["CUSTOMER"], "khách hàng", "customer"], [["INVOICE"], "hóa đơn", "invoice"], [["ORDER"], "đơn hàng", "order"], [["PRODUCT"], "sản phẩm", "product"],
  [["FORM"], "biểu mẫu", "form"], [["RESPONSE"], "câu trả lời", "response"], [["WORKSPACE"], "không gian làm việc", "workspace"], [["TEAM"], "đội", "team"], [["GROUP"], "nhóm", "group"],
  [["MEMBER"], "thành viên", "member"], [["REACTION"], "biểu cảm", "reaction"], [["STATUS"], "trạng thái", "status"], [["WEBHOOK"], "webhook", "webhook"], [["DEAL"], "thương vụ", "deal"],
  [["TICKET"], "phiếu hỗ trợ", "ticket"], [["PULLREQUEST", "PR"], "pull request", "pull request"],
];
const VERB_OF = new Map(VERBS.flatMap(([ks, vi]) => ks.map((k) => [k, vi] as const)));
const NOUN_OF = new Map(NOUNS.flatMap(([ks, vi]) => ks.map((k) => [k, vi] as const)));
const FILLER = new Set(["A", "AN", "THE", "NEW", "BY", "ID", "IDS", "FROM", "TO", "IN", "INTO", "FOR", "OF", "WITH", "ON", "AT", "MY", "ALL", "SINGLE", "MULTIPLE", "BATCH", "BULK", "DETAILS", "INFO", "USING", "MARKDOWN", "JSON", "V2", "V3"]);
const single = (w: string) => (w.endsWith("IES") ? `${w.slice(0, -3)}Y` : w.endsWith("SES") || w.endsWith("XES") ? w.slice(0, -2) : w.endsWith("S") && !w.endsWith("SS") ? w.slice(0, -1) : w);
const lookup = (m: Map<string, string>, w: string) => m.get(w) ?? m.get(single(w));

/** Tên thao tác bằng lời thường (tiếng Việt): CREATE_DOCUMENT_MARKDOWN → "Tạo tài liệu", SENDS_A_MESSAGE_TO_A_CHANNEL → "Gửi tin nhắn". */
export function actionWords(rest: string[]): string {
  let w = rest.filter((x) => x !== "BATCH" && x !== "BULK");
  const human = (xs: string[]) => xs.join(" ").toLowerCase();
  const verb = w.length ? lookup(VERB_OF, w[0]) : undefined;
  if (!verb) { const h = human(w); return h ? h[0].toUpperCase() + h.slice(1) : ""; }
  w = w.slice(1);
  // Danh từ hai từ (PULL_REQUEST) ghép lại trước khi tra.
  const joined = w.map((x, i) => (x === "PULL" && /^REQUESTS?$/.test(w[i + 1] ?? "") ? "PULLREQUEST" : x)).filter((x, i, a) => !(i > 0 && a[i - 1] === "PULLREQUEST" && /^REQUESTS?$/.test(x)));
  const noun = joined.map((x) => lookup(NOUN_OF, x)).find(Boolean);
  if (noun) return `${verb} ${noun}`;
  const left = joined.filter((x) => !FILLER.has(x));
  return left.length ? `${verb} ${human(left.slice(0, 3))}` : verb;
}

// Công cụ meta của Composio: tên bằng lời thường.
const META: Record<string, [string, string]> = {
  COMPOSIO_SEARCH_TOOLS: ["Tìm công cụ", "Find tools"], COMPOSIO_GET_TOOL_SCHEMAS: ["Xem tham số công cụ", "View tool parameters"],
  COMPOSIO_MANAGE_CONNECTIONS: ["Quản lý kết nối", "Manage connections"], COMPOSIO_WAIT_FOR_CONNECTIONS: ["Chờ kết nối", "Wait for connections"],
  COMPOSIO_REMOTE_BASH_TOOL: ["Chạy lệnh bash", "Run a bash command"], COMPOSIO_REMOTE_WORKBENCH: ["Chạy code", "Run code"],
  COMPOSIO_MULTI_EXECUTE_TOOL: ["Chạy thao tác", "Run actions"], COMPOSIO_PROXY_EXECUTE: ["Gọi API", "Call API"],
};
export const metaWords = (tool: string): string | undefined => META[tool]?.[0];

/** Thẻ duyệt / dòng công cụ của một lời gọi Composio: ứng dụng, thao tác bằng lời thường, tham số chính.
 *  strict: luôn hỏi mỗi lần (bash, workbench, gọi API không phải GET), thẻ không có "Luôn cho phép" / "Cho phép trong cuộc trò chuyện này".
 *  apps: ứng dụng có thao tác ghi trong lời gọi (quyền ghi theo từng ứng dụng).
 *  writes: khi lời gọi có nhiều thao tác ghi, liệt kê từng thao tác (ứng dụng · thao tác · tham số chính · tài khoản). */
export type CxWrite = { name: string; act: string; main?: string; account?: string };
export type CxCard = { app: string; name: string; act: string; main?: string; account?: string; params?: [string, string][]; more?: number; strict?: boolean; apps?: string[]; writes?: CxWrite[] };

// ---- bản tiếng Anh cho từ điển giao diện ----
/** Chữ tiếng Việt → tiếng Anh của mọi động từ và công cụ meta (gộp vào VI2EN). Động từ + danh từ dịch bằng CX_RULE_EN. */
export const CX_VI2EN: Record<string, string> = Object.fromEntries([...VERBS.map(([, vi, en]) => [vi, en] as const), ...Object.values(META)]);
const VERB_EN = new Map(VERBS.map(([, vi, en]) => [vi, en] as const));
const NOUN_EN = new Map(NOUNS.map(([, vi, en]) => [vi, en] as const));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const alt = (xs: Iterable<string>) => [...xs].sort((a, b) => b.length - a.length).map(esc).join("|");
/** Nhãn thao tác "động từ + danh từ" ("Tạo tài liệu" → "Create document"); phần sau động từ là chữ ASCII lấy từ tên thao tác thì giữ nguyên. */
export const CX_RULE_EN: [RegExp, (m: RegExpMatchArray) => string] = [
  new RegExp(`^(${alt(VERB_EN.keys())}) (${alt(NOUN_EN.keys())}|[a-z0-9][a-z0-9 ]{0,80})$`),
  (m) => `${VERB_EN.get(m[1]) ?? m[1]} ${NOUN_EN.get(m[2]) ?? m[2]}`,
];
/** Nhãn thao tác Composio sang tiếng Anh — một chỗ duy nhất, dùng cho cả bộ dịch giao diện (i18n.tsx trCx) và luật "Đang dùng X · Y" của từ điển (i18n-dict.ts).
 *  dict: bản dịch chung (từ điển + luật, kể cả "Gọi API GET"); dịch được thì lấy, không thì áp CX_RULE_EN cho phần chữ đã bỏ khoảng trắng hai đầu. */
export function cxActEn(s: string, dict: (s: string) => string): string {
  const base = dict(s);
  if (base !== s) return base;
  const t = s.trim();
  const m = t.match(CX_RULE_EN[0]);
  return m ? s.replace(t, () => CX_RULE_EN[1](m)) : s;
}
