// Gửi kết quả của Autopilot cho người dùng khi một lần chạy xong (tasks.ts keepResult gọi đúng một lần mỗi lần chạy):
// - Đoạn chat thường: tin của người dùng là yêu cầu của việc, câu trả lời là kết quả (kèm artifact, ảnh, tệp, nguồn,
//   model) như một lượt chat bình thường. Ghi thẳng vào kho đồng bộ đoạn chat (chatstore.ts) với một mã mới chưa thiết
//   bị nào dùng, nên mọi thiết bị nhận về ở lần đồng bộ sau và không bao giờ đè lên đoạn chat người dùng đang gõ.
//   Mở ra là hỏi tiếp được ngay.
// - Email (người dùng bật cho từng việc, chỉ tài khoản đã xác minh email): tóm tắt và nút mở đoạn chat.
// Lỗi ở đây chỉ ghi nhật ký: kết quả vẫn nằm trong danh sách Kết quả của Autopilot và vẫn có thông báo trong app.
import "server-only";
import { db, getUser, limit } from "./authstore";
import { pushItems, SYNC_LIMITS } from "./chatstore";
import { sendMail } from "./mailer";
import { autopilotMail, type MailLang } from "./mailtpl";
import { DEFAULT_TZ, localTime } from "./schedule";
import type { Schedule } from "./schedule";
import type { TaskRow } from "./tasks";

export const AUTOPILOT_TAG = "Autopilot";
/** Cột schedule của tasks giữ lịch cùng cách báo kết quả: hai thứ người dùng đặt chung trong một form và đổi cùng nhau.
 *  notify "email": gửi email cho chủ việc mỗi lần chạy xong (không có: chỉ thông báo trong app);
 *  lang: ngôn ngữ giao diện lúc đặt (ngôn ngữ của email). */
export type Stored = Schedule & { notify?: "email"; lang?: "vi" | "en" };
export const storedOf = (r: Pick<TaskRow, "schedule">) => JSON.parse(r.schedule) as Stored;
type Delivery = {
  uid: string; run: string; title: string; at: number; kind: string; task: TaskRow | null;
  status: string; result: unknown; doneAt?: number;
};
type R = Record<string, unknown>;
const arr = (x: unknown) => (Array.isArray(x) ? x : []);

/** Gửi kết quả; trả về mã đoạn chat đã tạo (null: lần chạy lỗi hay không tạo được). */
export function deliverResult(o: Delivery): number | null {
  let chat: number | null = null;
  if (o.status === "done") {
    try { chat = writeChat(o); } catch (e) { console.error("[autopilot] không tạo được đoạn chat kết quả", e); }
  }
  if (o.task && storedOf(o.task).notify === "email") {
    try { mailResult(o, chat); } catch (e) { console.error("[autopilot] không gửi được email kết quả", e); }
  }
  return chat;
}

// Mã đoạn chat là mốc thời gian (ms) như đoạn chat tạo ở trình duyệt; trùng thì lùi thêm 1 ms tới khi chưa có mục nào
// dùng (kể cả mục đã xóa: dùng lại mã đã xóa thì thiết bị khác coi như đoạn cũ sống lại).
function freeId(uid: string, at: number) {
  const q = db().prepare("SELECT 1 FROM user_items WHERE user_id = ? AND kind = 'chat' AND id = ?");
  let id = at;
  while (q.get(uid, String(id))) id++;
  return id;
}
const dd = (tz: string, t: number) => localTime(tz, t).split(" ").pop()!.slice(0, 5);

/** Câu trả lời của lượt (kết quả JSON của chatPost) → tin nhắn "ai" đúng dạng trình duyệt lưu sau một lượt chat
 *  (ui/home.tsx streamReply). */
export function aiMessage(result: unknown, time: number, dur: number) {
  const j = (result ?? {}) as R;
  const used = arr(j.skills) as { kind?: string; name?: string }[];
  const libs = arr(j.libs) as { key?: string; skills?: string[] }[];
  // Skill nằm trong thư viện đã hiện ở chip thư viện, không hiện riêng (như home.tsx).
  const inLib = new Set(libs.flatMap((l) => [l.key, ...arr(l.skills)]));
  const names = (k: string) => {
    const hit = used.filter((u) => u.kind === k && typeof u.name === "string" && !inLib.has(u.name));
    return [...new Set(hit.map((u) => u.name!))];
  };
  const skills = names("skill"), tools = names("tool");
  return {
    role: "ai", text: String(j.text ?? ""), done: true, time, dur,
    ...(j.auto && typeof j.model === "string" ? { via: j.model } : {}),
    ...(skills.length ? { skills } : {}), ...(libs.length ? { libs } : {}), ...(tools.length ? { tools } : {}),
    ...(arr(j.files).length ? { outs: j.files } : {}),
    ...(arr(j.trace).length ? { trace: j.trace } : {}),
    ...(arr(j.sources).length ? { webs: j.sources } : {}),
  };
}

function writeChat(o: Delivery): number | null {
  const user = getUser(o.uid);
  if (!user || user.status !== "active") return null;
  const tz = o.task ? storedOf(o.task).tz : DEFAULT_TZ;
  const end = o.doneAt ?? Date.now();
  const id = freeId(o.uid, end);
  // Lần chạy theo lịch thì tin của người dùng là yêu cầu của việc; việc đã duyệt (action) thì là tên việc đã duyệt.
  const ask = o.kind === "run" && o.task ? o.task.prompt : o.title;
  const chat = {
    id, title: `${o.task?.title ?? o.title} · ${dd(tz, o.at)}`.slice(0, 80), named: true, tags: [AUTOPILOT_TAG],
    msgs: [{ role: "user", text: ask, time: o.at }, aiMessage(o.result, end, Math.max(0, end - o.at))],
  };
  const r = pushItems(o.uid, [{ kind: "chat", id: String(id), upd: end, data: JSON.stringify(chat) }],
    user.email_verified ? undefined : { total: SYNC_LIMITS.lockedTotal });
  if (!r[0]?.ok) {
    console.error(`[autopilot] kho đoạn chat từ chối kết quả ${o.run}: ${r[0]?.error ?? "?"}`);
    return null;
  }
  return id;
}

const base = () => (process.env.APP_URL ?? "https://synchro.net.nz").replace(/\/$/, "");
// Văn bản thuần ngắn cho email: bỏ artifact, ký hiệu Markdown, gộp khoảng trắng.
const plain = (t: string) =>
  t.replace(/<artifact[\s\S]*?(<\/artifact>|$)/g, "").replace(/[#*_`>|]/g, "").replace(/\n{3,}/g, "\n\n").trim();
function mailResult(o: Delivery, chat: number | null) {
  const user = getUser(o.uid);
  if (!user || user.status !== "active" || !user.email_verified) return;
  // Chặn email dồn dập khi người dùng đặt nhiều việc chạy dày: tối đa 48 thư mỗi ngày cho mỗi tài khoản.
  try { limit(`autopilot-mail:${o.uid}`, 48, 24 * 3600_000); } catch {
    console.warn(`[autopilot] bỏ email kết quả ${o.run}: quá 48 thư trong ngày`);
    return;
  }
  const lang: MailLang = o.task && storedOf(o.task).lang === "en" ? "en" : "vi";
  const tz = o.task ? storedOf(o.task).tz : DEFAULT_TZ;
  const ok = o.status === "done" && chat !== null;
  const res = (o.result ?? {}) as R;
  const raw = ok ? plain(String(res.text ?? "")) : String(res.error ?? "");
  const summary = raw.length > 700 ? `${raw.slice(0, 700).trimEnd()}…` : raw;
  const url = ok ? `${base()}/#c=${chat}` : `${base()}/#v=autopilot`;
  const when = localTime(tz, o.doneAt ?? Date.now());
  sendMail(user.email, autopilotMail({ base: base(), lang, title: o.task?.title ?? o.title, when, ok, summary, url }));
}
