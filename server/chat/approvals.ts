import "server-only";
// Phần duyệt công cụ của bộ xử lý chat (tách từ chatengine.ts, H3 bước 6a): lượt chờ duyệt giữ trong bộ nhớ (pending, hết hạn sau
// SYNCHRO_APPROVAL_TTL_MS), thẻ hỏi người dùng trước khi gọi connector (askConnector) và các hàm nhãn / biểu tượng của lời gọi connector.
import type { ToolRun } from "../skillruntime";
import { audit, getUser } from "../authstore";
import type { ChatTool } from "../connectors";
import { cxCard, cxHints, cxLabel } from "../composio";
import { appLogo, composioAppOf } from "../connlogos";
import { currentRun, inboxWaiting, onInbox, progress, runSignal } from "../runs";
import { resolveRefs, validateArgs } from "../../shared/connschema";
import { BRIDGE_CALL_MAX, destructiveLike } from "../mcp";
import { answer as answerAsk, newAskId, waitAnswer, type Ask } from "../approvals";
import { registerMemStat } from "../memstat";
import type { Adapter, Call, Exec } from "./tools";

export type Decision = "allow" | "chat" | "always" | "deny";
// Lượt chat đang chờ người dùng duyệt công cụ: giữ trong bộ nhớ máy chủ tối đa 30 phút.
// Mỗi lượt chờ giữ cả lịch sử và phiên connector: hết hạn thì tự bỏ bằng hẹn giờ riêng (unref), không đợi tới lần có người khác cần duyệt.
type Pending = { uid: string; model: string; ad: Adapter; m: unknown[]; calls: Call[]; used: ToolRun["used"][]; step: number; x: Exec; at: number; timer?: ReturnType<typeof setTimeout> };
const PENDING_TTL = Number(process.env.SYNCHRO_APPROVAL_TTL_MS) || 30 * 60_000;
export const pending = new Map<string, Pending>();
export function sweep() {
  for (const [k, p] of pending) if (Date.now() - p.at > PENDING_TTL) { pending.delete(k); if (p.timer) clearTimeout(p.timer); p.x.sess?.close(); }
}
export function parkApproval(id: string, p: Pending) {
  p.timer = setTimeout(() => { if (pending.get(id) === p) { pending.delete(id); p.x.sess?.close(); } }, PENDING_TTL + 1000);
  p.timer.unref?.();
  pending.set(id, p);
}
export const unparkApproval = (id: string) => { const p = pending.get(id); if (p?.timer) clearTimeout(p.timer); pending.delete(id); };
/** Số lượt chat đang chờ duyệt công cụ (theo dõi bộ nhớ). */
export const pendingApprovals = () => pending.size;
registerMemStat("approvals", () => ({ pending: pending.size }));
// Thẻ duyệt công cụ connector trong lượt chạy qua CLI (cùng cơ chế với hỏi dùng trình duyệt): CLI giữ lời gọi công cụ trong lúc chờ.
// Chờ tối đa 10 phút rồi coi như chưa được phép; bấm Dừng thì thôi chờ ngay.
const ASK_WAIT = 10 * 60_000;
const ASK_LATE = "__late__", ASK_TYPED = "__typed__";
// Người dùng nhắn thêm khi thẻ đang chờ: công cụ không chạy, model đọc tin nhắn (ghép ngay sau kết quả này) rồi quyết định lại.
const TYPED = "Người dùng vừa nhắn thêm thay vì trả lời thẻ duyệt nên công cụ này chưa chạy. Đọc tin nhắn của họ ngay sau đây rồi làm theo; nếu vẫn cần công cụ thì gọi lại với tham số đúng theo tin nhắn đó.";
// Sau khi được duyệt phải còn ít nhất chừng này để công cụ chạy.
export const TOOL_MIN = 60_000;
const CALL_CANCELLED = "CLI đã hủy lời gọi này nên công cụ chưa chạy.";
export const REFUSED = "Người dùng đã từ chối cho dùng công cụ này ở lượt này. Đừng thử lại bằng cách khác; hãy cho họ biết bạn cần quyền này để làm tiếp.";
// Logo cho thẻ duyệt / dòng công cụ: logo của connector; công cụ Composio chạy thao tác trong một ứng dụng (GMAIL_SEND_EMAIL…) thì logo của ứng dụng đó.
// uid: người dùng của phiên — logo, nhãn, thẻ duyệt và khóa quyền tách ứng dụng theo cùng toolkit Composio đã báo cho người này.
export function callLogo(ct: ChatTool, input: unknown, uid: string | undefined): { logo?: string; color?: string; icon?: string; site?: string } {
  const app = ct.composio ? composioAppOf(input, cxHints(uid)) : "";
  // Ứng dụng không có logo nào (không tệp sẵn, không có trang chủ trong bảng): giữ logo Composio thay vì chữ cái đầu.
  const own: { logo?: string; icon?: string } = app ? appLogo(app) : {};
  if (own.logo || own.icon) return own;
  return { logo: ct.logo, color: ct.color, ...(ct.icon ? { icon: ct.icon } : {}), ...(ct.site ? { site: ct.site } : {}) };
}
// Tên công cụ trong chat. Composio theo thao tác thật bên trong, bằng lời thường ("Google Docs · Tạo tài liệu", "Composio · Tìm công cụ"),
// không phải tên công cụ bọc ngoài ("Composio: Multi Execute Composio Tools"); connector khác: "<connector>: <công cụ>".
export const toolTitle = (ct: ChatTool) => ct.tool.title || ct.tool.annotations?.title || ct.tool.name;
export const cxOf = (ct: ChatTool, input: unknown, uid: string | undefined) => (ct.composio ? cxLabel(ct.tool.name, input, uid) : null);
export const usedName = (ct: ChatTool, input: unknown, uid: string | undefined) => { const l = cxOf(ct, input, uid); return l ? `${l.app} · ${l.act}` : `${ct.cname}: ${toolTitle(ct)}`; };
const askOf = (x: Exec, c: Call, id: string): Ask => {
  const ct = x.sess!.get(c.name)!;
  // Composio: thẻ nói ứng dụng (logo), tài khoản nếu biết, thao tác bằng lời thường và tham số chính; strict thì thẻ chỉ có "Cho phép một lần".
  const cx = ct.composio ? cxCard(ct.tool.name, c.input, x.sess!.uid) : null;
  const a: Ask = {
    id, kind: "connector", tool: ct.tool.name, key: `conn:${ct.fq}`, title: cx?.act ?? toolTitle(ct), detail: "",
    conn: (() => { const lg = callLogo(ct, c.input, x.sess!.uid); return { name: cx?.name ?? ct.cname, ...lg, ...(lg.icon && lg.icon.length >= 1500 ? { icon: undefined } : {}) }; })(),
    about: (ct.tool.description ?? "").slice(0, 300), destructive: destructiveLike(ct.tool), ...(cx ? { cx } : {}),
  };
  // Sự kiện của lượt giữ tối đa 6000 ký tự: cắt ngang JSON thì thẻ không hiện được và lượt treo tới hết giờ.
  // Tham số hiện đủ (không bị cắt) thì thẻ cho sửa; schema kèm theo khi còn chỗ để thẻ kiểm tra ngay lúc gõ (máy chủ luôn kiểm tra lại).
  const full = c.input && Object.keys(c.input).length ? JSON.stringify(c.input, null, 2) : "";
  for (let n = full.length; ; n = Math.floor(n * 0.7)) {
    a.detail = n >= full.length ? full : `${full.slice(0, n)}\n… (còn ${full.length - n} ký tự không hiện ở đây)`;
    if (JSON.stringify(a).length <= 5900 || !n) break;
  }
  if (a.detail === full) {
    const schema = resolveRefs(ct.tool.inputSchema ?? {});
    if (JSON.stringify({ ...a, schema }).length <= 5900) a.schema = schema;
  }
  return a;
};
// Tham số người dùng sửa trên thẻ duyệt: kiểm tra theo schema của công cụ (lỗi thì câu hỏi vẫn chờ, thẻ hiện lỗi).
const editCheck = (ct: ChatTool) => (a: { input?: Record<string, unknown> }) => { const e = a.input ? validateArgs(ct.tool.inputSchema ?? {}, a.input) : []; return e.length ? `Tham số chưa hợp lệ: ${e.slice(0, 5).join("; ")}` : null; };
/** Người dùng đã sửa tham số rồi cho phép: lời gọi đang chờ chạy với tham số mới (chỉ lời gọi này), ghi nhật ký bảo mật, model được báo ở kết quả. */
export function applyEdit(x: Exec, c: Call, input: Record<string, unknown>) {
  const ct = x.sess!.get(c.name)!;
  const before = c.input ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(input)])].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(input[k]));
  c.input = input;
  (x.edited ??= new Set()).add(c.id);
  audit("tool_args_edited", { actor: getUser(x.uid) ?? null, detail: JSON.stringify({ connector: ct.cname, tool: ct.tool.name, conv: x.conv ?? null, changed: keys.slice(0, 20) }).slice(0, 1000) });
}
export async function askConnector(x: Exec, c: Call): Promise<Decision> {
  // Nhiều lời gọi song song: hỏi lần lượt, để "Cho phép trong đoạn chat này" ở thẻ trước khỏi phải hỏi lại ở thẻ sau.
  const prev = x.asking ?? Promise.resolve();
  let release = () => {};
  x.asking = new Promise<void>((ok) => { release = ok; });
  await prev;
  const deny = (why: string): Decision => { (x.denied ??= new Map()).set(c.id, why); return "deny"; };
  try {
    const meta = x.calls?.get(c.id);
    if (meta?.cancel?.aborted) return deny(CALL_CANCELLED);
    if (!needsAsk(x, c)) return "allow";
    // Tin nhắn thêm chưa tới model (vừa gửi, hay thẻ trước vừa khép vì nó): model chưa biết người dùng muốn gì thì chưa hỏi duyệt tiếp.
    if (inboxWaiting()) return deny(TYPED);
    if (!currentRun()) return deny("Công cụ này cần người dùng duyệt nhưng lượt này không có khung chat để hỏi nên chưa chạy. Hãy báo người dùng nhắc lại yêu cầu trong khung chat để Synchro hỏi, hoặc đổi quyền công cụ thành \"Luôn cho phép\" trong Cài đặt → Connectors.");
    // Lời gọi của CLI gồm cả lúc chờ duyệt: chừa đủ thời gian để công cụ còn chạy được trước khi CLI tự cắt (nhiều thẻ song song thì thẻ sau còn ít thời gian hơn).
    const room = meta ? BRIDGE_CALL_MAX - (Date.now() - meta.at) - TOOL_MIN : ASK_WAIT;
    if (room <= 0) return deny("Lời gọi này đã chờ quá lâu nên công cụ chưa chạy. Hãy gọi lại nếu vẫn cần.");
    const id = newAskId();
    const run = runSignal();
    const stops = [run, meta?.cancel].filter((v): v is AbortSignal => !!v);
    const wait = waitAnswer(x.uid, id, stops.length > 1 ? AbortSignal.any(stops) : stops[0], editCheck(x.sess!.get(c.name)!));
    const late = setTimeout(() => answerAsk(x.uid, id, { ok: false, note: ASK_LATE }), Math.min(ASK_WAIT, room));
    const offMsg = onInbox(() => answerAsk(x.uid, id, { ok: false, note: ASK_TYPED }));
    progress("ask", JSON.stringify({ ...askOf(x, c, id), until: Date.now() + Math.min(ASK_WAIT, room) }));
    progress("step", "Đang chờ bạn duyệt");
    // Antigravity, Grok: lượt đang chờ người dùng thì nhả chỗ để đoạn chat khác của tài khoản này không phải xếp hàng sau nó.
    x.park?.();
    x.awaiting = (x.awaiting ?? 0) + 1;
    const a = await wait;
    x.awaiting = (x.awaiting ?? 1) - 1;
    clearTimeout(late);
    offMsg();
    const dropped = !!meta?.cancel?.aborted;
    const timedOut = a.note === ASK_LATE, typed = a.note === ASK_TYPED;
    progress("asked", JSON.stringify({ id, ok: a.ok, always: !!a.always, chat: !!a.chat, ...(timedOut || dropped ? { gone: true } : {}), ...(typed ? { typed: true } : {}), ...(a.ok && a.input && !dropped ? { edited: true } : {}) }));
    // CLI đã hủy lời gọi trong lúc chờ: không chạy dù người dùng có bấm cho phép, kết quả không còn ai nhận.
    if (dropped) return deny(CALL_CANCELLED);
    if (typed) return deny(TYPED);
    if (timedOut) return deny("Người dùng chưa trả lời yêu cầu duyệt sau 10 phút nên công cụ chưa chạy. Hãy báo họ biết; nếu vẫn cần thì nhắc lại yêu cầu để Synchro hỏi lại.");
    if (!a.ok) return deny(a.note && a.note !== "Người dùng đã dừng." ? `Người dùng từ chối công cụ này. Lời nhắn của họ: ${a.note}. Làm theo lời nhắn nếu được; đừng tìm cách khác để lách.` : REFUSED);
    // Máy chủ đã kiểm tra tham số khi nhận câu trả lời (editCheck); kiểm tra lại ngay trước khi dùng.
    if (a.input) { if (validateArgs(x.sess!.get(c.name)!.tool.inputSchema ?? {}, a.input).length) return deny("Tham số người dùng sửa không hợp lệ nên công cụ chưa chạy."); applyEdit(x, c, a.input); }
    if (a.always) { x.sess!.allowAlways(c.name, c.input); return "always"; }
    if (a.chat) { x.sess!.allowChat(c.name, c.input); return "chat"; }
    return "allow";
  } finally { release(); }
}
// D6: đang mở skill của danh mục (chưa kiểm chứng) và lời gọi connector là thao tác ghi → luôn hỏi, dù người dùng để "Luôn cho phép".
export const untrustedConnWrite = (x: Exec, c: Call) => !!x.untrusted && !!x.sess?.get(c.name) && x.sess.mutating(c.name, c.input) && (x.sess.perm(c.name, c.input) === "allow" || x.sess.perm(c.name, c.input) === "chat");
export const needsAsk = (x: Exec, c: Call) => !!x.sess?.get(c.name) && (x.sess.perm(c.name, c.input) === "ask" || untrustedConnWrite(x, c));
