// Bộ đệm ảnh nhỏ do máy chủ tải hộ (favicon của nguồn trích dẫn, logo ứng dụng Composio): trình duyệt chỉ gọi /api/favicon cùng nguồn gốc,
// không gọi thẳng trang lạ hay máy chủ ảnh của bên thứ ba (không lộ IP, không cookie theo dõi). Ảnh tải qua safeFetch (chặn địa chỉ nội bộ),
// nhận diện bằng byte đầu tệp, giới hạn dung lượng. Lưu trong bộ nhớ (500 mục) và trên đĩa (<DATA_DIR>/iconcache, 7 ngày);
// không tải được cũng nhớ 6 giờ để trang lỗi không bị hỏi lại mỗi lần vẽ. Nhiều yêu cầu cùng lúc cho một ảnh chỉ tải một lần.
// Thư mục trên đĩa có giới hạn (SYNCHRO_ICON_DISK_MAX ảnh, mặc định 3000): thỉnh thoảng xóa mục hết hạn rồi mục cũ nhất, để vòng lặp hỏi tên miền ngẫu nhiên không làm đầy đĩa.
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
const DISK_MAX = () => Number(process.env.SYNCHRO_ICON_DISK_MAX) || 3000;
let writes = 0;
function writeDisk(key: string, e: Entry) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const f = fileOf(key);
    if (e.icon) fs.writeFileSync(`${f}.bin`, e.icon.buf); else fs.rmSync(`${f}.bin`, { force: true });
    fs.writeFileSync(`${f}.json`, JSON.stringify({ at: e.at, ...(e.icon ? { mime: e.icon.mime } : {}) }));
    if (++writes % 50 === 0) pruneDisk();
  } catch {}
}
/** Xóa mục hết hạn (ảnh quá 7 ngày, lần không tải được quá 6 giờ), rồi mục cũ nhất cho tới khi còn tối đa DISK_MAX mục. */
export function pruneDisk(now = Date.now()) {
  let names: string[] = [];
  try { names = fs.readdirSync(DIR).filter((n) => n.endsWith(".json")); } catch { return; }
  const rows = names.map((n) => {
    const base = path.join(DIR, n.slice(0, -5));
    try { const m = JSON.parse(fs.readFileSync(`${base}.json`, "utf8")) as { at?: number; mime?: string }; return { base, at: Number(m.at) || 0, icon: !!m.mime }; } catch { return { base, at: 0, icon: false }; }
  });
  const drop = (b: string) => { fs.rmSync(`${b}.json`, { force: true }); fs.rmSync(`${b}.bin`, { force: true }); };
  const live = rows.filter((r) => { if (now - r.at < (r.icon ? TTL : MISS_TTL)) return true; drop(r.base); return false; });
  if (live.length > DISK_MAX()) live.sort((a, b) => a.at - b.at).slice(0, live.length - DISK_MAX()).forEach((r) => drop(r.base));
}
const fresh = (e: Entry | null | undefined): e is Entry => !!e && Date.now() - e.at < (e.icon ? TTL : MISS_TTL);
function remember(key: string, e: Entry) {
  st.mem.delete(key);
  st.mem.set(key, e);
  if (st.mem.size > MEM_MAX) st.mem.delete(st.mem.keys().next().value!);
}

/** Ảnh theo khóa (vd. "site:example.com"), lấy từ bộ đệm hoặc tải bằng load(). gate: gọi trước khi phải tải mới (giới hạn số lần tải của mỗi tài khoản; ném lỗi để từ chối). */
export async function cachedIcon(key: string, load: () => Promise<Icon | null>, gate?: () => void): Promise<Icon | null> {
  const m = st.mem.get(key);
  if (fresh(m)) return m.icon;
  const d = readDisk(key);
  if (fresh(d)) { remember(key, d); return d.icon; }
  let p = st.inflight.get(key);
  if (!p) {
    gate?.();
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
