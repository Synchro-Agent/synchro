// Điều khiển lượt từ tiến trình khác (deploy xanh/lam): nginx đã đưa yêu cầu Dừng / nhắn thêm sang bản mới trong khi bản cũ còn chạy nốt lượt.
// Tiến trình nhận yêu cầu ghi vào cơ sở dữ liệu dùng chung (runs.cancel_req / steer_req cho lượt chat, agent_owner.stop cho lượt Code);
// tiến trình đang chạy lượt đọc lại mỗi 1,5 giây bằng MỘT vòng hỏi chung cho cả hai kho, chỉ chạy khi nó có lượt đang chạy.
import "server-only";
import { activeCount, type Store } from "./registry";

const POLL_MS = Number(process.env.SYNCHRO_REMOTE_POLL_MS) || 1500;
type Applier = { store: Store; apply: () => number };
const g = globalThis as unknown as { __synchroRemoteAppliers?: Map<string, Applier>; __synchroRemotePoll?: ReturnType<typeof setInterval> | null };
const appliers = (g.__synchroRemoteAppliers ??= new Map<string, Applier>());

/** Mỗi kho đăng ký cách áp lệnh của mình (trả số lượt đã xử lý). Đăng ký lại cùng tên (nạp lại module) thì thay bản cũ. */
export function onRemote(name: string, store: Store, apply: () => number) { appliers.set(name, { store, apply }); }

/** Áp lệnh đang chờ cho mọi kho có lượt đang chạy ở tiến trình này. Kho không có lượt nào thì không đọc cơ sở dữ liệu của nó. */
export function applyAllRemote(): number {
  let n = 0;
  for (const [name, a] of appliers) {
    if (!activeCount(a.store)) continue;
    try { n += a.apply(); } catch (e) { console.error(`[runs] ${name}`, e); }
  }
  return n;
}

/** Bật vòng hỏi (một cho cả tiến trình); tự tắt khi không còn lượt nào đang chạy. */
export function remotePoll() {
  if (g.__synchroRemotePoll) return;
  g.__synchroRemotePoll = setInterval(() => {
    if (!activeCount()) { clearInterval(g.__synchroRemotePoll ?? undefined); g.__synchroRemotePoll = null; return; }
    applyAllRemote();
  }, POLL_MS);
  g.__synchroRemotePoll.unref?.();
}
