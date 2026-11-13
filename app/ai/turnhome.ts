// HOME riêng cho mỗi lượt Antigravity / Grok có công cụ (Blueprint G1, giải quyết K8). Hai CLI này chỉ đọc cầu nối MCP từ cấu hình trong thư mục nhà,
// nên trước đây mọi lượt có công cụ của cùng tài khoản phải xếp hàng sau một khóa ("Đang chờ lượt Antigravity khác của tài khoản này xong").
// Giờ mỗi lượt chạy với HOME = <thư mục đăng nhập>/.synchro-home-<mã>:
// - Chỉ các thư mục chứa tệp cấu hình riêng là thư mục thật của lượt (agy: .gemini, .gemini/config; grok: .grok).
// - Tệp cấu hình riêng của lượt (mcp_config.json + hooks.json của agy, config.toml của grok) được ghi mới từ cấu hình của tài khoản (bỏ mục synchro cũ) + cầu nối của lượt.
// - Mọi mục khác là liên kết về thư mục đăng nhập (phiên để nối tiếp, ảnh, bộ đệm…), nên lịch sử phiên vẫn ghi đúng chỗ.
// Tệp đăng nhập (tên kiểu token, auth, oauth…): mặc định LIÊN KẾT, không chép. Đã thử chép (đúng chữ của Blueprint): bản chép của lượt cũ đi ngay khi lượt khác làm mới
// token mà chưa đưa về, và với hãng xoay vòng refresh token có phát hiện dùng lại, lượt dùng bản cũ làm hãng thu hồi cả họ token (kiểm thử tests/api/turnhome.test.mjs, 40 lượt
// chồng nhau). Liên kết thì CLI luôn đọc token mới nhất, ghi đè tại chỗ thì về thẳng thư mục đăng nhập, y như trước. CLI ghi tệp tạm rồi đổi tên thì tệp thật thay liên kết
// trong HOME của lượt: lần đồng bộ trong lượt (mỗi SYNCHRO_TURN_HOME_SYNC_MS, mặc định 2 giây) đưa nó về thư mục đăng nhập và đặt lại liên kết; luật đưa về:
// thư mục đăng nhập chưa ai đổi thì thay; đã có lượt khác đưa về token khác thì giữ bản có mtime mới hơn (lần làm mới sau cùng mới là token hãng còn nhận).
// SYNCHRO_TURN_HOME_COPY=1: chép tệp đăng nhập như Blueprint ghi (đồng bộ hai chiều theo cùng luật trong lượt và lúc xong).
// Xong lượt (close): đưa về lần cuối, cả tệp mới, thư mục mới; đổi bằng rename (nguyên tử) dưới khóa mkdir của tài khoản, rồi bỏ HOME của lượt. Lượt mới của cùng tài khoản
// chờ các lần đưa về đang chạy xong rồi mới dựng HOME. Đăng xuất giữa lượt: không hồi sinh tệp đăng nhập.
// Mọi thao tác chạy bằng user của engine (thư mục đăng nhập 0700 của user đó) qua một tiến trình node ngắn; cấu hình (có token cầu nối) đi qua stdin, không qua tham số.
// SYNCHRO_CLI_TURN_HOME=0: tắt, về cách cũ (cấu hình chung + khóa tài khoản). Dựng HOME riêng lỗi thì lượt đó cũng về cách cũ (ghi nhật ký).
import crypto from "node:crypto";
import path from "node:path";
import type { TurnRequest } from "./engine";
import { spawnCli, TURN_HOME_PREFIX, turnHomeBase } from "./cli_runtime";

export type HomeCli = "agy" | "grok";
/** Tệp riêng của lượt: write = ghi nguyên văn; json-mcp = mcp_config.json của tài khoản + mục name; toml-drop = config.toml của tài khoản bỏ bảng mcp_servers.name. */
export type OwnFile = { mode: "write"; text: string } | { mode: "json-mcp"; name: string; entry: Record<string, unknown> } | { mode: "toml-drop"; name: string };
type Layout = { real: string[]; ensure: string[] };
// ensure: thư mục phải có sẵn trong thư mục đăng nhập để thành liên kết: CLI tạo trong HOME của lượt thì hai lượt song song tạo hai bản (phiên, ảnh, đăng nhập của agy).
const LAYOUT: Record<HomeCli, Layout> = {
  agy: { real: [".gemini", ".gemini/config"], ensure: [".gemini/antigravity-cli/conversations", ".gemini/antigravity-cli/brain"] },
  grok: { real: [".grok"], ensure: [".grok/sessions"] },
};
export const turnHomeOn = () => process.env.SYNCHRO_CLI_TURN_HOME !== "0";
const syncMs = () => { const n = Number(process.env.SYNCHRO_TURN_HOME_SYNC_MS); return Number.isFinite(n) && n >= 100 ? n : 2000; };

/** Mã chạy bằng node của máy chủ dưới user của engine. Đọc JSON từ stdin, in JSON ra stdout. Không phụ thuộc gì ngoài thư viện chuẩn. */
export const TURN_HOME_JS = String.raw`"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const COPY_MAX = 256 * 1024, STABLE_MS = 300;
// Tệp đăng nhập: tên như dưới. Chép (chế độ copy) hay liên kết; tệp khác (chỉ mục phiên, cài đặt, cơ sở dữ liệu, nhật ký) luôn liên kết.
const LOGIN = /token|auth|cred|oauth|account|login|secret/i;
const own = Object.prototype.hasOwnProperty;
const lst = (f) => { try { return fs.lstatSync(f); } catch { return null; } };
const hash = (f) => { try { return crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex"); } catch { return null; } };
const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const join = (d, n) => (d ? d + "/" + n : n);
const tmpOf = (f) => f + ".synchro-" + crypto.randomBytes(4).toString("hex");
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", () => {
  try { process.stdout.write(JSON.stringify(main(JSON.parse(raw)))); }
  catch (e) { process.stderr.write(String((e && e.message) || e)); process.exit(1); }
});
function main(p) {
  if (path.dirname(p.turn) !== p.base || !path.basename(p.turn).startsWith(p.prefix) || path.basename(p.turn) === p.prefix + "lock") throw new Error("bad turn dir");
  process.umask(0o077);
  if (p.op === "drop") { fs.rmSync(p.turn, { recursive: true, force: true }); return {}; }
  if (p.op === "open") return open(p);
  return locked(p, () => (p.op === "sync" ? sync(p) : merge(p)));
}
function dropToml(text, name) {
  const head = new RegExp("^\\s*\\[\\s*mcp_servers\\.(\"" + name + "\"|" + name + ")\\s*(\\]|\\.)"), dotted = new RegExp("^\\s*mcp_servers\\.(\"" + name + "\"|" + name + ")\\.");
  let skip = false;
  return text.split("\n").filter((l) => { if (/^\s*\[/.test(l)) skip = head.test(l); return !skip && !dotted.test(l); }).join("\n");
}
function writeOwn(p, rel, o) {
  const dst = path.join(p.turn, rel), src = path.join(p.base, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true, mode: 0o700 });
  let text = "";
  if (o.mode === "write") text = o.text;
  else if (o.mode === "json-mcp") {
    let j = {};
    try { const v = JSON.parse(fs.readFileSync(src, "utf8")); if (v && typeof v === "object" && !Array.isArray(v)) j = v; } catch {}
    const servers = j.mcpServers && typeof j.mcpServers === "object" && !Array.isArray(j.mcpServers) ? { ...j.mcpServers } : {};
    servers[o.name] = o.entry;
    text = JSON.stringify({ ...j, mcpServers: servers }, null, 2);
  } else if (o.mode === "toml-drop") {
    try { text = dropToml(fs.readFileSync(src, "utf8"), o.name); } catch {}
  }
  fs.writeFileSync(dst, text, { mode: 0o600 });
}
function open(p) {
  for (const d of p.ensure) fs.mkdirSync(path.join(p.base, d), { recursive: true, mode: 0o700 });
  fs.mkdirSync(p.turn, { mode: 0o700 });
  const real = new Set(p.real), snap = {}, links = [];
  let copied = 0, linked = 0;
  for (const d of ["", ...p.real]) {
    const td = path.join(p.turn, d), bd = path.join(p.base, d);
    fs.mkdirSync(td, { recursive: true, mode: 0o700 });
    let names = [];
    try { names = fs.readdirSync(bd); } catch {}
    for (const n of names) {
      const rel = join(d, n);
      if (!d && n.startsWith(p.prefix)) continue;
      if (real.has(rel) || own.call(p.own, rel)) continue;
      const src = path.join(bd, n), dst = path.join(td, n), st = lst(src);
      if (!st) continue;
      const login = st.isFile() && LOGIN.test(n);
      if (login && p.copy && st.size <= COPY_MAX) {
        fs.copyFileSync(src, dst);
        fs.chmodSync(dst, st.mode & 0o700);
        fs.utimesSync(dst, st.atime, st.mtime);
        snap[rel] = hash(dst);
        copied++;
      } else { fs.symlinkSync(src, dst); linked++; if (login) links.push(rel); }
    }
  }
  for (const [rel, o] of Object.entries(p.own)) writeOwn(p, rel, o);
  return { snap, links, copied, linked };
}
function locked(p, fn) {
  const lk = path.join(p.base, p.prefix + "lock");
  let held = false;
  for (let i = 0; i < 500 && !held; i++) {
    try { fs.mkdirSync(lk, { mode: 0o700 }); held = true; }
    catch (e) {
      if (e.code !== "EEXIST") break;
      const st = lst(lk);
      if (st && Date.now() - st.mtimeMs > 30000) { try { fs.rmdirSync(lk); } catch {} continue; }
      nap(20);
    }
  }
  try { const r = fn(); r.locked = held; return r; }
  finally { if (held) { try { fs.rmdirSync(lk); } catch {} } }
}
// Chép src đè lên dst một cách nguyên tử (tệp tạm cùng thư mục rồi đổi tên), giữ quyền và mtime của src.
function copyOver(src, dst, st) {
  fs.mkdirSync(path.dirname(dst), { recursive: true, mode: 0o700 });
  const t = tmpOf(dst);
  fs.copyFileSync(src, t); fs.chmodSync(t, st.mode & 0o700); fs.utimesSync(t, st.atime, st.mtime); fs.renameSync(t, dst);
}
function relink(t, b) { const l = tmpOf(t); fs.symlinkSync(b, l); fs.renameSync(l, t); }
// Tệp thật trong thư mục thật của lượt (bỏ liên kết, tệp riêng của lượt).
function each(p, fn, d = "") {
  const real = new Set(p.real);
  let names = [];
  try { names = fs.readdirSync(path.join(p.turn, d)); } catch { return; }
  for (const n of names) {
    const rel = join(d, n);
    if (own.call(p.own, rel) || n.includes(".synchro-")) continue;
    const t = path.join(p.turn, rel), st = lst(t);
    if (!st || st.isSymbolicLink()) continue;
    if (st.isDirectory()) { if (real.has(rel)) each(p, fn, rel); else fn(rel, t, st, true); }
    else if (st.isFile()) fn(rel, t, st, false);
  }
}
/**
 * Một tệp đăng nhập của lượt so với thư mục đăng nhập. agreed: nội dung hai bên thống nhất lần trước. final: CLI đã thoát (không cần chờ tệp ổn định, không kéo về).
 * Trả về nội dung thống nhất mới (hoặc agreed nếu chưa làm gì).
 */
function reconcile(p, rel, t, st, agreed, final, log) {
  const b = path.join(p.base, rel), cur = lst(b);
  if (!cur) { log.push([rel, "base-gone"]); return agreed; }
  if (!cur.isFile()) return agreed;
  const th = hash(t), bh = hash(b);
  if (th === bh) return th;
  const tCh = th !== agreed, bCh = bh !== agreed;
  if (tCh && !final && Date.now() - st.mtimeMs < STABLE_MS) return agreed;
  if (tCh && (!bCh || st.mtimeMs > cur.mtimeMs)) { copyOver(t, b, st); log.push([rel, bCh ? "newer" : "updated"]); return th; }
  if (bCh && !final) { copyOver(b, t, cur); log.push([rel, "pulled"]); return bh; }
  if (tCh) log.push([rel, "kept-base"]);
  return agreed;
}
function sync(p) {
  const snap = { ...p.snap }, links = new Set(p.links), log = [];
  each(p, (rel, t, st, dir) => {
    if (dir) return;
    if (own.call(snap, rel)) { snap[rel] = reconcile(p, rel, t, st, snap[rel], false, log); return; }
    // Liên kết tới tệp đăng nhập bị thay bằng tệp thật (CLI ghi tệp tạm rồi đổi tên): đưa về thư mục đăng nhập nếu mới hơn, rồi đặt lại liên kết để mọi lần đọc sau thấy bản chung.
    if (!links.has(rel) || Date.now() - st.mtimeMs < STABLE_MS) return;
    const b = path.join(p.base, rel), cur = lst(b);
    if (!cur) { log.push([rel, "base-gone"]); return; }
    if (!cur.isFile()) return;
    if (st.mtimeMs > cur.mtimeMs) { copyOver(t, b, st); log.push([rel, "linked-back"]); } else log.push([rel, "relinked"]);
    relink(t, b);
  });
  return { snap, log };
}
function merge(p) {
  const links = new Set(p.links), log = [];
  const put = (t, b) => { fs.mkdirSync(path.dirname(b), { recursive: true, mode: 0o700 }); fs.renameSync(t, b); };
  const moveDir = (t, b, rel) => {
    const bs = lst(b);
    if (!bs) { put(t, b); log.push([rel, "new-dir"]); return; }
    if (!bs.isDirectory() || bs.isSymbolicLink()) return;
    for (const n of fs.readdirSync(t)) {
      const tt = path.join(t, n), bb = path.join(b, n), st = lst(tt), cur = lst(bb);
      if (!st || st.isSymbolicLink()) continue;
      if (st.isDirectory()) moveDir(tt, bb, join(rel, n));
      else if (st.isFile() && (!cur || (cur.isFile() && st.mtimeMs >= cur.mtimeMs))) { put(tt, bb); log.push([join(rel, n), "new"]); }
    }
  };
  each(p, (rel, t, st, dir) => {
    if (dir) { moveDir(t, path.join(p.base, rel), rel); return; }
    if (own.call(p.snap, rel)) { reconcile(p, rel, t, st, p.snap[rel], true, log); return; }
    const b = path.join(p.base, rel), cur = lst(b);
    // Tệp đăng nhập vốn là liên kết mà thư mục đăng nhập không còn tệp: đã đăng xuất giữa lượt, không hồi sinh.
    if (!cur && links.has(rel)) { log.push([rel, "base-gone"]); return; }
    if (!cur || (cur.isFile() && st.mtimeMs >= cur.mtimeMs)) { put(t, b); log.push([rel, links.has(rel) ? "linked-back" : "new"]); }
  });
  fs.rmSync(p.turn, { recursive: true, force: true });
  return { log };
}
`;

export type TurnHome = { dir: string; base: string; env: Record<string, string>; info: { copied: number; linked: number }; close: () => Promise<void> };
type Op = { op: "open" | "sync" | "merge" | "drop"; base: string; turn: string; prefix: string; copy: boolean; real: string[]; ensure: string[]; own: Record<string, OwnFile | true>; snap?: Record<string, string | null>; links?: string[] };

/** Chạy TURN_HOME_JS bằng user của engine (spawnCli: sudo / bwrap như CLI). */
async function runOp(env: Record<string, string>, o: Op): Promise<Record<string, unknown>> {
  const p = spawnCli(process.execPath, ["-e", TURN_HOME_JS], { env, cwd: o.base, stdin: JSON.stringify(o), timeoutMs: 30_000 });
  let out = "";
  for await (const l of p.lines) out += l;
  const e = await p.done;
  if (e.code !== 0) throw new Error(p.stderr().trim().slice(0, 200) || `mã thoát ${e.code}`);
  return JSON.parse(out) as Record<string, unknown>;
}
// Không ghi đường dẫn đầy đủ hay nội dung: chỉ tên tệp tương đối và quyết định.
const note = (cli: HomeCli, what: string, m: Record<string, unknown>) => {
  const log = (m.log ?? []) as [string, string][];
  if (log.length) console.log(`[turnhome] ${cli} ${what}: ${log.map(([f, a]) => `${f}=${a}`).join(" ").slice(0, 400)}${m.locked === false ? " (không lấy được khóa)" : ""}`);
};

// Lần đưa về cuối của từng thư mục đăng nhập: lượt mới chờ xong mới dựng HOME.
const g = globalThis as unknown as { __synchroTurnHomes?: Map<string, Promise<void>> };
const merging = (g.__synchroTurnHomes ??= new Map());
/** Chờ mọi lần đưa về đang chạy của tài khoản (lượt mới trước khi dựng HOME, và kiểm thử). */
export const settled = async (base: string) => { for (let p = merging.get(base); p; p = merging.get(base)) { await p; if (merging.get(base) === p) break; } };

/**
 * Dựng HOME riêng cho một lượt của cli (xem đầu tệp). own: tệp riêng của lượt theo đường dẫn tương đối. Ném lỗi nếu không dựng được (bên gọi về cách cũ).
 * close(): dừng đồng bộ, đưa tệp đăng nhập / tệp mới về thư mục đăng nhập rồi bỏ HOME của lượt; không bao giờ ném lỗi.
 */
export async function openTurnHome(cli: HomeCli, req: Pick<TurnRequest, "env">, own: Record<string, OwnFile>): Promise<TurnHome> {
  const env = req.env ?? {};
  const base = env.HOME ? turnHomeBase(env.HOME) : "";
  if (!base) throw new Error("thiếu thư mục đăng nhập");
  await settled(base);
  const dir = path.join(base, `${TURN_HOME_PREFIX}${Date.now().toString(36)}${crypto.randomBytes(4).toString("hex")}`);
  const L = LAYOUT[cli];
  const op: Op = { op: "open", base, turn: dir, prefix: TURN_HOME_PREFIX, copy: process.env.SYNCHRO_TURN_HOME_COPY === "1", real: L.real, ensure: L.ensure, own };
  const benv = { ...env, HOME: base };
  let r: Record<string, unknown>;
  try { r = await runOp(benv, op); }
  catch (e) {
    // Dựng dở: bỏ phần đã tạo (CLI chưa chạy, không có gì để đưa về).
    await runOp(benv, { ...op, op: "drop" }).catch(() => null);
    throw e;
  }
  const marks = Object.fromEntries(Object.keys(own).map((k) => [k, true as const]));
  const links = (r.links ?? []) as string[];
  let snap = (r.snap ?? {}) as Record<string, string | null>;
  // Đồng bộ trong lượt: chỉ khi có tệp đăng nhập để theo dõi. Lần sau chờ lần trước (snap đi tiếp).
  let chain: Promise<void> = Promise.resolve(), stop = false;
  const tick = Object.keys(snap).length || links.length ? setInterval(() => {
    chain = chain.then(async () => {
      if (stop) return;
      try { const m = await runOp(benv, { ...op, op: "sync", own: marks, snap, links }); snap = (m.snap ?? snap) as typeof snap; note(cli, "đồng bộ", m); }
      catch (e) { console.warn(`[turnhome] ${cli}: đồng bộ tệp đăng nhập lỗi: ${(e as Error).message.slice(0, 200)}`); }
    });
  }, syncMs()) : null;
  tick?.unref?.();
  let closed: Promise<void> | null = null;
  const close = () => {
    if (closed) return closed;
    stop = true;
    if (tick) clearInterval(tick);
    const prev = merging.get(base) ?? Promise.resolve();
    closed = Promise.all([prev, chain]).then(async () => {
      try { note(cli, "đưa về", await runOp(benv, { ...op, op: "merge", own: marks, snap, links })); }
      catch (e) { console.warn(`[turnhome] ${cli}: không đưa được tệp của lượt về thư mục đăng nhập: ${(e as Error).message.slice(0, 200)}`); }
    });
    const mine = closed;
    merging.set(base, mine);
    void mine.finally(() => { if (merging.get(base) === mine) merging.delete(base); });
    return mine;
  };
  const tenv: Record<string, string> = { ...env, HOME: dir, ...(cli === "grok" ? { GROK_HOME: path.join(dir, ".grok") } : {}) };
  return { dir, base, env: tenv, info: { copied: Number(r.copied) || 0, linked: Number(r.linked) || 0 }, close };
}
