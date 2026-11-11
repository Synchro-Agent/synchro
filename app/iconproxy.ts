// Bộ đệm ảnh nhỏ do máy chủ tải hộ (favicon của nguồn trích dẫn, logo ứng dụng Composio): trình duyệt chỉ gọi /api/favicon cùng nguồn gốc,
// không gọi thẳng trang lạ hay máy chủ ảnh của bên thứ ba (không lộ IP, không cookie theo dõi). Ảnh tải qua safeFetch (chặn địa chỉ nội bộ),
// nhận diện bằng byte đầu tệp, giới hạn dung lượng. Lưu trong bộ nhớ (500 mục) và trên đĩa (<DATA_DIR>/iconcache, 7 ngày);
// không tải được cũng nhớ 6 giờ để trang lỗi không bị hỏi lại mỗi lần vẽ. Nhiều yêu cầu cùng lúc cho một ảnh chỉ tải một lần.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isIP } from "node:net";
import { DATA_DIR } from "./authstore";

export type Icon = { mime: string; buf: Buffer };
const TTL = 7 * 86_400_000, MISS_TTL = 6 * 3_600_000, MEM_MAX = 500;
const DIR = path.join(DATA_DIR, "iconcache");
type Entry = { at: number; icon: Icon | null };
const g = globalThis as unknown as { __synchroIcons?: { mem: Map<string, Entry>; inflight: Map<string, Promise<Icon | null>> } };
const st = (g.__synchroIcons ??= { mem: new Map(), inflight: new Map() });

const fileOf = (key: string) => path.join(DIR, crypto.createHash("sha256").update(key).digest("hex").slice(0, 40));
function readDisk(key: string): Entry | null {
  try {
    const f = fileOf(key);
    const meta = JSON.parse(fs.readFileSync(`${f}.json`, "utf8")) as { at: number; mime?: string };
    if (!meta.mime) return { at: meta.at, icon: null };
    return { at: meta.at, icon: { mime: meta.mime, buf: fs.readFileSync(`${f}.bin`) } };
  } catch { return null; }
}
function writeDisk(key: string, e: Entry) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const f = fileOf(key);
    if (e.icon) fs.writeFileSync(`${f}.bin`, e.icon.buf);
    fs.writeFileSync(`${f}.json`, JSON.stringify({ at: e.at, ...(e.icon ? { mime: e.icon.mime } : {}) }));
  } catch {}
}
const fresh = (e: Entry | null | undefined): e is Entry => !!e && Date.now() - e.at < (e.icon ? TTL : MISS_TTL);
function remember(key: string, e: Entry) {
  st.mem.delete(key);
  st.mem.set(key, e);
  if (st.mem.size > MEM_MAX) st.mem.delete(st.mem.keys().next().value!);
}

/** Ảnh theo khóa (vd. "site:example.com"), lấy từ bộ đệm hoặc tải bằng load(). */
export async function cachedIcon(key: string, load: () => Promise<Icon | null>): Promise<Icon | null> {
  const m = st.mem.get(key);
  if (fresh(m)) return m.icon;
  const d = readDisk(key);
  if (fresh(d)) { remember(key, d); return d.icon; }
  let p = st.inflight.get(key);
  if (!p) {
    p = load().catch(() => null).then((icon) => {
      const e = { at: Date.now(), icon };
      remember(key, e);
      writeDisk(key, e);
      return icon;
    }).finally(() => st.inflight.delete(key));
    st.inflight.set(key, p);
  }
  return p;
}

/** Tên miền công khai hợp lệ để hỏi favicon (không IP, không localhost / tên nội bộ, không cổng). null: không nhận. */
export function publicHost(raw: string): string | null {
  const h = raw.trim().toLowerCase().replace(/^www\./, "");
  if (!h || h.length > 253 || isIP(h) || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(h)) return null;
  if (h === "localhost" || (/\.(localhost|local|internal|lan|home|corp|test|invalid|example)$/.test(h) && !process.env.FAVICON_BASE)) return null;
  return h;
}

/** Phản hồi ảnh: không cho chạy script kể cả khi mở thẳng (SVG), trình duyệt giữ một ngày. */
export const iconResponse = (icon: Icon) => new Response(new Uint8Array(icon.buf), { headers: {
  "content-type": icon.mime, "content-length": String(icon.buf.length), "cache-control": "private, max-age=86400",
  "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
} });
