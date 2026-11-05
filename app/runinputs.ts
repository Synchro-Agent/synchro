// Tệp của đoạn chat trong thư mục chạy code: model từng chỉ thấy phần chữ trích ra (200 dòng đầu của bảng tính, không ảnh, không công thức), nên "thêm cột vào tệp này",
// "điền mẫu này", "làm video từ ảnh của tôi" đều phải dựng lại từ đầu hoặc từ chối. run_code nhận bản gốc ở inputs/<tên tệp>.
import path from "node:path";
import { chatFiles, type ChatFile } from "./browsertools";
import type { RunFile } from "./coderun";
import { outputByName } from "./outputs";

// Dịch vụ workspace nhận tối đa 160 MB JSON một lần chạy, base64 làm to thêm 1/3.
export const INPUTS_MAX = 100 * 1048576;
const TRACED_MAX = 30;

/** Tên trong inputs/: giữ nguyên tiếng Việt và dấu cách để model gọi đúng tên người dùng thấy, chỉ bỏ thứ không đặt được trong đường dẫn. Giữ đuôi khi phải cắt. */
export function inputName(name: string): string {
  return name.normalize("NFC").replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim().replace(/^\.+/, "").slice(-180).trim() || "tep";
}
type Traced = { role?: string; trace?: unknown };
/** Tệp Synchro đã giao ở các lượt trước (ảnh generate_image, tệp run_code), đọc từ dấu vết công cụ trong lịch sử; mới nhất trước. */
export function tracedOutputs(msgs: unknown): string[] {
  const out: string[] = [];
  for (const m of [...(Array.isArray(msgs) ? msgs : [])].reverse() as Traced[]) {
    if (m?.role !== "assistant" || !Array.isArray(m.trace)) continue;
    for (const t of [...m.trace].reverse() as { name?: string; status?: string; summary?: string }[]) {
      if (t?.status !== "ok" || (t.name !== "generate_image" && t.name !== "run_code")) continue;
      for (const l of [...String(t.summary ?? "").matchAll(/^(.+?) \([^()\n]*\) — đã gửi cho người dùng$/gm)].reverse()) {
        const n = path.basename(l[1]);
        if (!out.includes(n)) out.push(n);
      }
    }
  }
  return out.slice(0, TRACED_MAX);
}
/**
 * Tệp cần chép vào thư mục chạy lần này. sent: tệp đã chép trong lượt này (thư mục được giữ giữa các lần chạy), không có thì chép hết (mỗi lần một thư mục trống).
 * Mỗi lượt chép lại một lần: thư mục giữ lại có thể đã bị dọn (24 giờ, hạn mức 3 GB). made: id ảnh vừa tạo trong lượt này.
 */
export async function runInputs(uid: string, msgs: unknown, made: string[], sent?: Set<string>): Promise<{ files: RunFile[]; names: string[]; over: string[] }> {
  const all: ChatFile[] = await chatFiles(msgs, uid, () => made.map((id) => ({ id })))().catch(() => []);
  const seen = new Set(all.map((f) => f.name));
  for (const n of tracedOutputs(msgs)) {
    if (seen.has(n)) continue;
    const o = outputByName(uid, n);
    if (o) { seen.add(n); all.push({ name: o.name, mime: o.mime, data: o.data }); }
  }
  const files: RunFile[] = [], names: string[] = [], over: string[] = [];
  let room = INPUTS_MAX;
  const used = new Set<string>();
  for (const f of all) {
    const name = inputName(f.name), key = `${name}:${f.data.length}`;
    if (used.has(name)) continue;
    used.add(name);
    if (sent?.has(key)) continue;
    if (f.data.length > room) { over.push(name); sent?.add(key); continue; }
    room -= f.data.length;
    files.push({ path: `inputs/${name}`, data: f.data });
    names.push(name);
    sent?.add(key);
  }
  return { files, names, over };
}
