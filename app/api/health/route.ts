// Kiểm tra sức khỏe cho deploy (scripts/server-build.sh) và dịch vụ theo dõi ngoài: công khai nên chỉ trả cờ đúng / sai, không số liệu, đường dẫn hay lỗi chi tiết.
// build: mã bản build (vốn đã công khai trong đường dẫn /_next/static/<mã>). 200 khi mọi thứ ổn, 503 khi có cờ false; deploy chỉ xét build và db
// (đĩa gần đầy hay dịch vụ workspace tắt không phải lỗi của bản mới, trả bản cũ về cũng không hết).
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, setSetting } from "../../authstore";
import { agentAlive, wsConfigured } from "../../workspace";
import { BACKUP_MAX_AGE_H, backupAge } from "../../ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_FREE_MB = 1000;
const build = (() => { try { return fs.readFileSync(path.join(process.cwd(), process.env.NEXT_DIST_DIR || ".next", "BUILD_ID"), "utf8").trim(); } catch { return "dev"; } })();
// Ai cũng gọi được: giữ kết quả vài giây để không biến thành đường ghi đĩa không giới hạn.
let last: { at: number; body: { ok: boolean; build: string; db: boolean; disk: boolean; agent: boolean | null; backup: boolean | null } } | null = null;

async function check() {
  let db = false, disk = true;
  try { setSetting("health:at", String(Date.now())); db = true; } catch (e) { console.error("[health] db", e); }
  try { const v = fs.statfsSync(DATA_DIR); disk = (v.bavail * v.bsize) / 1048576 >= MIN_FREE_MB; } catch { /* không đọc được thì không kết luận */ }
  const agent = wsConfigured() ? await agentAlive() : null;
  // backup: sao lưu hằng đêm còn chạy không (null: máy này chưa từng sao lưu, như bản thử nghiệm). Dịch vụ theo dõi ngoài thấy 503 khi sao lưu ngừng.
  const age = backupAge(), backup = age === null ? null : age <= BACKUP_MAX_AGE_H;
  return { ok: db && disk && agent !== false && backup !== false, build, db, disk, agent, backup };
}

export async function GET() {
  if (!last || Date.now() - last.at > 5000) last = { at: Date.now(), body: await check() };
  return Response.json(last.body, { status: last.body.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
