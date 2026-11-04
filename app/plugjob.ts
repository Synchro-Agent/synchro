// Cài hàng loạt từ danh mục skill của Claude (chỉ chạy ở máy chủ): quản trị viên bấm "Cài tất cả" (cả danh mục hoặc một mục ngành nghề),
// máy chủ cài lần lượt vào Thư viện cho mọi người, ở nền. Trang có thể đóng; máy chủ khởi động lại thì tự chạy tiếp (instrumentation.ts).
// Hai thư viện cùng lúc (máy chủ 2 vCPU, còn phục vụ chat); xếp theo repo để các thư viện cùng repo dùng lại bản zip vừa tải.
// Thư viện không cài được (giấy phép đóng, repo đã xóa…) ghi lại lý do, không chặn phần còn lại.
import { db } from "./authstore";
import { installPlugin, isNetErr, PluginError, setBulk } from "./plugins";
import { altsOf, CD, closedReason, dirDef, dirEntries, dirEntry, dirSynced, type DirEntry } from "./claudedir";

export type JobFail = { id: string; name: string; reason: string; kind: "license" | "missing" | "network" | "other" };
export type Job = { by: string; auto?: boolean; pass?: number; paused?: number | null; cat: string | null; started: number; finished: number | null; stopped: boolean; total: number; done: number; installed: number; skills: number; failed: JobFail[]; current: string[] };

let ready = false;
function init() {
  const d = db();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS plugin_jobs (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS plugin_catalog_removed (catalog_id TEXT PRIMARY KEY, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS plugin_catalog_blocked (catalog_id TEXT PRIMARY KEY, name TEXT NOT NULL, reason TEXT NOT NULL, commit_sha TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS plugin_catalog_failed (catalog_id TEXT PRIMARY KEY, name TEXT NOT NULL, reason TEXT NOT NULL, kind TEXT NOT NULL, commit_sha TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL)`);
    ready = true;
  }
  return d;
}
const G = globalThis as unknown as { __plugJob?: { job: Job; running: boolean } };
const save = (j: Job) => init().prepare("INSERT OR REPLACE INTO plugin_jobs (key, value) VALUES ('catalog', ?)").run(JSON.stringify(j));
export function getJob(): Job | null {
  if (G.__plugJob) return G.__plugJob.job;
  const r = init().prepare("SELECT value FROM plugin_jobs WHERE key = 'catalog'").get() as { value: string } | undefined;
  return r ? (JSON.parse(r.value) as Job) : null;
}
export const jobRunning = () => !!G.__plugJob?.running;

/** catalogId của các thư viện tổ chức đã cài. */
export function orgInstalled(uid?: string): Map<string, string> {
  const rows = init().prepare("SELECT catalog_id, id FROM plugins WHERE (owner = 'org' OR owner = ?) AND catalog_id IS NOT NULL ORDER BY owner = 'org'").all(uid ?? "org") as { catalog_id: string; id: string }[];
  return new Map(rows.map((r) => [r.catalog_id, r.id]));
}
// Thư viện đọc giấy phép lúc cài mới biết là đóng (thư mục của Claude không ghi): nhớ lại theo mã danh mục, để nó không còn trông như cài được, với mọi người.
// Danh mục đổi sang commit khác thì xét lại (tác giả có thể đã đổi giấy phép). Lần đầu chạy bản này: nhận luôn các lỗi giấy phép đã ghi trong lần cài hàng loạt trước.
let backfilled = false;
export function blockedLibs(): Map<string, { reason: string; name: string }> {
  const d = init();
  if (!backfilled) {
    backfilled = true;
    for (const f of getJob()?.failed ?? []) if (f.kind === "license") markBlocked(CD + f.id, f.name, f.reason);
  }
  const cur = (d.prepare("SELECT catalog_id, name, reason, commit_sha FROM plugin_catalog_blocked").all() as { catalog_id: string; name: string; reason: string; commit_sha: string }[]);
  return new Map(cur.filter((r) => { const e = dirEntry(r.catalog_id); return !!e && (e.commit || "") === r.commit_sha; }).map((r) => [r.catalog_id, { reason: r.reason, name: r.name }]));
}
export function markBlocked(catalogId: string, name: string, reason: string) {
  const e = dirEntry(catalogId);
  if (e) init().prepare("INSERT OR REPLACE INTO plugin_catalog_blocked (catalog_id, name, reason, commit_sha, at) VALUES (?, ?, ?, ?, ?)").run(catalogId, name, reason.slice(0, 400), e.commit || "", Date.now());
}
// Thư viện cài lỗi vì lý do khác giấy phép (repo đã xóa, không có skill nào…), không phải lỗi mạng tạm thời: nhớ lại để nó không còn trông như cài được
// với mọi người, và không bị đếm là còn phải cài. Danh mục đổi commit thì xét lại; quản trị viên thử lại được; cài được thì xóa bản ghi.
export function failedLibs(): Map<string, { reason: string; name: string; kind: string }> {
  const d = init();
  if (!backfilledFail) {
    backfilledFail = true;
    for (const f of getJob()?.failed ?? []) if (f.kind !== "license" && f.kind !== "network") markFailed(CD + f.id, f.name, f.reason);
  }
  const cur = d.prepare("SELECT catalog_id, name, reason, kind, commit_sha FROM plugin_catalog_failed").all() as { catalog_id: string; name: string; reason: string; kind: string; commit_sha: string }[];
  return new Map(cur.filter((r) => { const e = dirEntry(r.catalog_id); return !!e && (e.commit || "") === r.commit_sha; }).map((r) => [r.catalog_id, { reason: r.reason, name: r.name, kind: r.kind }]));
}
let backfilledFail = false;
export function markFailed(catalogId: string, name: string, reason: string) {
  const e = dirEntry(catalogId), kind = kindOf(reason);
  if (e) init().prepare("INSERT OR REPLACE INTO plugin_catalog_failed (catalog_id, name, reason, kind, commit_sha, at) VALUES (?, ?, ?, ?, ?, ?)").run(catalogId, name, reason.slice(0, 400), kind, e.commit || "", Date.now());
}
export function clearFailed(catalogId?: string) {
  if (catalogId) init().prepare("DELETE FROM plugin_catalog_failed WHERE catalog_id = ?").run(catalogId);
  else init().exec("DELETE FROM plugin_catalog_failed");
}
/** Lỗi khi cài một thư viện của danh mục: lỗi giấy phép và lỗi của chính thư viện thì nhớ lại; lỗi mạng tạm thời thì không. */
export function noteInstallError(catalogId: string | undefined, name: string, msg: string) {
  if (!catalogId?.startsWith(CD)) return;
  const k = kindOf(msg);
  if (k === "license") markBlocked(catalogId, name, msg);
  else if (k !== "network") markFailed(catalogId, name, msg);
}
const kindOf = (m: string): JobFail["kind"] => (isNetErr(m) ? "network" : /độc quyền|giấy phép/i.test(m) ? "license" : /Không tìm thấy|Không tải được|404/i.test(m) ? "missing" : "other");

// Tên thư viện (slug) đã có trong thư viện chung nhưng là thư viện khác (vd. plugin dựng sẵn "taste"): đổi tên, không ghi đè.
export function freeSlug(e: DirEntry, owner = "org") {
  const st = init().prepare("SELECT catalog_id FROM plugins WHERE owner = ? AND slug = ?");
  for (const s of [e.slug, `${e.slug.slice(0, 37)}-cd`, ...[2, 3, 4, 5].map((i) => `${e.slug.slice(0, 36)}-cd${i}`)]) {
    const r = st.get(owner, s) as { catalog_id: string | null } | undefined;
    if (!r || r.catalog_id === CD + e.id) return s;
  }
  return null;
}

// Thư viện cần cài: chưa có trong thư viện chung, thuộc mục (nếu chọn mục), cộng thư viện mở thay cho thư viện đóng của mục.
// auto (cài mặc định khi máy chủ khởi động): bỏ qua thư viện quản trị viên đã tự gỡ.
function pending(cat: string | null, auto: boolean, skip = new Set<string>()) {
  const failed = failedLibs();
  const have = orgInstalled(), all = dirEntries();
  const removed = auto ? new Set((init().prepare("SELECT catalog_id FROM plugin_catalog_removed").all() as { catalog_id: string }[]).map((r) => r.catalog_id)) : new Set<string>();
  const inCat = all.filter((e) => !cat || e.cats.includes(cat));
  const ids = new Set(inCat.map((e) => e.id));
  const blocked = blockedLibs();
  for (const e of inCat) for (const a of e.closed || blocked.has(CD + e.id) || failed.has(CD + e.id) ? altsOf(e) : []) ids.add(a);
  return all.filter((e) => ids.has(e.id) && !have.has(CD + e.id) && !removed.has(CD + e.id) && !skip.has(e.id) && !blocked.has(CD + e.id) && !failed.has(CD + e.id));
}
/** Quản trị viên gỡ một thư viện của danh mục: lần cài mặc định sau (danh mục cập nhật) không tự cài lại. */
export function markRemoved(catalogId: string | null) { if (catalogId?.startsWith(CD)) init().prepare("INSERT OR REPLACE INTO plugin_catalog_removed (catalog_id, at) VALUES (?, ?)").run(catalogId, Date.now()); }
export function clearRemoved(catalogId: string) { init().prepare("DELETE FROM plugin_catalog_removed WHERE catalog_id = ?").run(catalogId); }

export function startJob(by: string, cat: string | null, auto = false, pass = 0, retry = false): Job {
  const cur = getJob();
  if (jobRunning() && cur) return cur;
  // Quản trị viên bấm thử lại: quên các lỗi đã nhớ (của mục đang chọn) để chúng vào hàng cài như thư viện mới.
  if (retry) for (const id of failedLibs().keys()) if (!cat || dirEntry(id)?.cats.includes(cat)) clearFailed(id);
  const list = pending(cat, auto);
  if (!auto) for (const e of list) clearRemoved(CD + e.id);
  const job: Job = { by, auto, pass, paused: null, cat, started: Date.now(), finished: null, stopped: false, total: list.length, done: 0, installed: 0, skills: 0, failed: [], current: [] };
  save(job);
  void run(job);
  return job;
}
export function stopJob() {
  const j = G.__plugJob;
  if (j?.running) { j.job.stopped = true; save(j.job); }
  return getJob();
}
/**
 * Toàn bộ danh mục skill của Claude là skill mặc định của Synchro: khi máy chủ khởi động lần đầu, và mỗi khi danh mục được cập nhật
 * (catalog/claude-directory.json đổi "synced"), tự cài mọi thư viện còn thiếu vào Thư viện cho mọi người, ở nền. Tắt bằng SYNCHRO_DEFAULT_PLUGINS=0.
 */
export function ensureCatalogDefaults() {
  if (process.env.SYNCHRO_DEFAULT_PLUGINS === "0") return;
  const synced = dirSynced();
  if (!synced) return;
  const d = init();
  d.exec("CREATE TABLE IF NOT EXISTS plugin_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const done = (d.prepare("SELECT value FROM plugin_meta WHERE key = 'catalog-synced'").get() as { value: string } | undefined)?.value;
  if (done === synced || jobRunning()) return;
  d.prepare("INSERT OR REPLACE INTO plugin_meta (key, value) VALUES ('catalog-synced', ?)").run(synced);
  const j = startJob("system", null, true);
  console.log(`[plugins] cài mặc định danh mục skill của Claude: ${j.total} thư viện`);
}
/** Máy chủ khởi động lại khi đang cài: chạy tiếp phần còn lại. */
export function resumeJob() {
  const j = getJob();
  if (j && !j.finished && !j.stopped && !jobRunning()) void run(j);
}

const MEM_SOFT = 2.5 * 1024 ** 3;
async function run(job: Job) {
  G.__plugJob = { job, running: true };
  // Thư viện lỗi mạng không tính là đã thử: chạy tiếp (sau khi máy chủ khởi động lại) thì thử lại.
  job.failed = job.failed.filter((f) => f.kind !== "network");
  const tried = new Set(job.failed.map((f) => f.id));
  const retries = new Map<string, number>();
  let netRun = 0;
  const queue = pending(job.cat, !!job.auto, tried).sort((a, b) => a.repo.localeCompare(b.repo));
  let last = 0;
  setBulk(true);
  const worker = async () => {
    for (let e = queue.shift(); e && !job.stopped; e = queue.shift()) {
      // Repo lớn (zip tới 500MB) được giải nén trong bộ nhớ: khi tiến trình đã dùng nhiều, chờ thư viện kia cài xong để máy chủ vẫn phục vụ chat mượt.
      for (let t = 0; t < 120 && process.memoryUsage().rss > MEM_SOFT && job.current.length; t++) await new Promise((ok) => setTimeout(ok, 1000));
      job.current.push(e.name);
      try {
        if (e.closed) throw new PluginError(closedReason(e));
        const slug = freeSlug(e);
        if (!slug) throw new PluginError("Tên thư viện đã được dùng.");
        const p = await installPlugin("org", { ...dirDef(e), slug });
        job.installed++; job.skills += p.skills.length;
        netRun = 0;
        clearFailed(CD + e.id);
      } catch (err) {
        const reason = (err as Error).message || String(err);
        const kind = kindOf(reason);
        if (kind === "network" && (retries.get(e.id) ?? 0) < 3) {
          // Lỗi mạng: đưa về cuối hàng để thử lại; nhiều lỗi mạng liền nhau (GitHub chặn tạm) thì nghỉ 1 → 2 → 4… tối đa 15 phút rồi chạy tiếp.
          retries.set(e.id, (retries.get(e.id) ?? 0) + 1);
          queue.push(e); job.done--;
          if (++netRun >= 4) {
            const wait = Math.min(60_000 * 2 ** Math.min(netRun - 4, 4), 15 * 60_000);
            job.paused = Date.now() + wait; save(job);
            await new Promise((ok) => setTimeout(ok, wait));
            job.paused = null;
          }
        } else { job.failed.push({ id: e.id, name: e.name, reason: reason.slice(0, 400), kind }); if (kind === "license" && !e.closed) markBlocked(CD + e.id, e.name, reason); else if (kind !== "license" && kind !== "network") markFailed(CD + e.id, e.name, reason); }
      }
      job.current = job.current.filter((n) => n !== e!.name);
      job.done++;
      if (Date.now() - last > 2000) { save(job); last = Date.now(); }
    }
  };
  try { await Promise.all([worker(), worker()]); }
  finally {
    setBulk(false);
    if (!job.stopped) job.finished = Date.now();
    job.current = [];
    save(job);
    G.__plugJob = { job, running: false };
  }
  // Còn thư viện chưa tải được vì mạng: 10 phút sau tự cài lại phần còn thiếu (tối đa 6 lượt), để "cài sẵn" là cài đủ, không cần ai bấm.
  if (!job.stopped && job.failed.some((f) => f.kind === "network") && (job.pass ?? 0) < 6)
    setTimeout(() => { if (!jobRunning()) startJob(job.by, job.cat, !!job.auto, (job.pass ?? 0) + 1); }, 10 * 60_000);
}
