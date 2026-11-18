// Ma trận tài khoản miễn phí trên bản giả lập (Blueprint H1.1–H1.3): một tài khoản thành viên mới (người dùng tạm, không phải quản trị viên),
// đăng nhập gói ChatGPT, Google (Antigravity), Grok như tài khoản miễn phí đã thử thật, KHÔNG có gói Claude. Chạy lại T1–T8, Word, video,
// Đọc văn bản, Chép lời ở chế độ Tự động; ghi model được chọn, thời gian và lời báo khi chạm hạn mức. Mỗi việc phải ra kết quả, hoặc chạm
// hạn mức với lời báo nói đủ: hạn mức nào, bao giờ hồi, cách thay thế (H1.2). Rồi cố ý chạm từng hạn mức: chi phí API của Synchro (cả
// thẻ lỗi trên trang thật, máy tính và 390px), gói ChatGPT, credit giọng AI (Đọc văn bản, Chép lời) — và kiểm không vượt hạn mức của hãng.
// Ma trận thật trên synchro.net.nz (synchro-work/h1-free-matrix.md, 2026-11-15) được dựng lại ở đây phần nào giả lập được: T2 bảy tệp có đáp án
// cài sẵn (cả pdf, docx), T3 sáu tệp khó (wav, m4a, webp, zip hỏng, .xyz chữ, md), mức giọng AI chung của máy chủ đã cạn (Đọc văn bản, Chép lời,
// hai tệp âm thanh cùng lúc trong chat, số credit ở đầu trang Speech), gói hết hạn mức giữa lượt Tự động (lời báo nói hạn mức gói nào, bao giờ hồi;
// vòng mức dùng hiện gói đang bị chặn), Tự động chạy bằng khóa API chung khi đã có gói (một dòng báo tính vào hạn mức chi phí API), vùng
// aria-live không giữ câu trả lời của trang trước.
// Bảng kết quả in ra cuối và ghi JSON vào <tmp>/synchro-ui/free-account.json (OUT để đổi). Chạy tay: BASE=http://localhost:3200 node tests/ui/free-account.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { openChrome, sleep, waitFor } from "../lib/cdp.mjs";
import { tempUser } from "../lib/tempuser.mjs";

const B = process.env.BASE ?? process.env.SYNCHRO_URL ?? "http://localhost:3200", M = process.env.MOCK ?? "http://127.0.0.1:4010";
const OUT = process.env.OUT ?? path.join(tmpdir(), "synchro-ui", "free-account.json");
const API_MODEL = "anthropic/claude-haiku-5-5";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 700)); return c; };

// Lời báo hạn mức đủ ba phần (cùng tiêu chí với server/limitmsg.ts limitParts, kiểm ở tests/api/limit-messages.test.mjs).
const parts = (msg = "") => ({
  which: /(phiên|tuần|hôm nay|mỗi giờ|mỗi ngày|Gói \S+|gói \S+|session|week|today|per hour|plan)/i.test(msg),
  when: /(sau (khoảng )?\d+ (phút|giờ|ngày)|ngày mai|in (about )?\d+ ?(min|h|days?)|tomorrow)/i.test(msg),
  alt: /(Trong lúc chờ|vẫn dùng được|chọn Tự động|Cài đặt → Providers|In the meantime|still work|choose Auto)/i.test(msg),
});
const complete = (msg) => Object.values(parts(msg)).every(Boolean);
const LIMIT = /hạn mức|giới hạn|limit/i;

// Như tài khoản miễn phí thật: quyền mặc định của thành viên mới (default_perms của máy chủ, KHÔNG cấp thêm model / tính năng) và email đã xác minh.
const u = await tempUser(B, "free-acct", { name: "Free Account", fullPerms: false, verified: true });
const row0 = (await u.admin("GET", "/api/admin")).j?.users?.find((x) => x.email === u.email) ?? {};
const me0 = (await u.api("GET", "/api/auth/me")).j?.user ?? {};
// Hồ sơ thật của lần chạy (in đầu bảng, ghi vào JSON): đã xác minh chưa, model / tính năng quyền mặc định cho phép. Máy giả lập chưa đặt
// default_perms thì quyền mặc định là toàn quyền; khác với máy thật thì bảng nói rõ, không ngầm coi là tài khoản miễn phí của synchro.net.nz.
const featOn = Object.entries(me0.perms?.features ?? {}).filter(([, v]) => v).map(([k]) => k);
const featOff = Object.entries(me0.perms?.features ?? {}).filter(([, v]) => !v).map(([k]) => k);
const profile = { verified: !!row0.verified, role: me0.role ?? "", models: me0.perms?.models ?? null, featuresOn: featOn, featuresOff: featOff, verifyLocked: !!me0.verifyLocked };
console.log(`Hồ sơ: ${u.email} · ${profile.role || "?"} · ${profile.verified ? "đã xác minh" : "CHƯA xác minh"} · model ${JSON.stringify(profile.models)} · tắt: ${featOff.join(", ") || "(không)"}`);
ok(profile.verified && !profile.verifyLocked, "tài khoản đã xác minh email như người dùng thật", profile);
ok(!me0.isAdmin && profile.role !== "admin", "không phải quản trị viên (quyền mặc định của thành viên, không cấp thêm)", profile);
const rows = [];
let plansOn = false;
const db = () => u.db();
const setUsageOver = (on) => {
  const d = db();
  try {
    if (on) {
      const now = Date.now();
      d.prepare("INSERT INTO usage_users (user_id, session_start, week_anchor, override) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET session_start = excluded.session_start, week_anchor = excluded.week_anchor, override = excluded.override")
        .run(u.uid, now - 60_000, now - 60_000, JSON.stringify({ session: 0.01, weekly: 1000 }));
      d.prepare("INSERT INTO usage_events (user_id, at, model, feature, input, output, cache_read, cache_write, cost) VALUES (?, ?, ?, ?, 0, 0, 0, 0, 1)").run(u.uid, now - 30_000, API_MODEL, "chat");
    } else {
      d.prepare("DELETE FROM usage_users WHERE user_id = ?").run(u.uid);
      d.prepare("DELETE FROM usage_events WHERE user_id = ?").run(u.uid);
    }
  } finally { d.close(); }
};
const setSpeechSpent = (credits) => {
  const d = db();
  try {
    d.exec("CREATE TABLE IF NOT EXISTS speech_budget (day TEXT NOT NULL, user_id TEXT NOT NULL, credits INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, user_id))");
    const day = new Date().toISOString().slice(0, 10);
    if (credits === null) d.prepare("DELETE FROM speech_budget WHERE day = ? AND user_id = ?").run(day, u.uid);
    else d.prepare("INSERT INTO speech_budget (day, user_id, credits) VALUES (?, ?, ?) ON CONFLICT(day, user_id) DO UPDATE SET credits = excluded.credits").run(day, u.uid, credits);
  } finally { d.close(); }
};

// Mức giọng AI chung của cả máy chủ hôm nay. Ma trận thật: mức chung cạn từ 10:06 UTC trong khi tài khoản miễn phí chưa dùng credit nào.
// Từ w9-integ 152c6509, mức chung (server/speechapi.ts spentToday) là tổng các dòng theo tài khoản KHÔNG phải quản trị viên của speech_budget;
// dòng user_id "*" không còn dùng để chặn. Nên làm cạn / làm trống mức chung bằng các dòng theo tài khoản: một dòng SHARED_ROW (không phải tài
// khoản thật, nên được cộng như tài khoản thường), tạm bỏ dòng của các tài khoản khác. Dòng của chính tài khoản thử (setSpeechSpent) để nguyên.
// Giữ các dòng cũ để trả lại đúng như trước khi chạy.
const DAY = () => new Date().toISOString().slice(0, 10);
const SHARED_ROW = "free-matrix-shared";
const otherRows = () => { const d = db(); try { return d.prepare("SELECT user_id, credits FROM speech_budget WHERE day = ? AND user_id NOT IN ('*', ?)").all(DAY(), u.uid); } catch { return []; } finally { d.close(); } };
const putShared = (rows) => {
  const d = db();
  try {
    d.exec("CREATE TABLE IF NOT EXISTS speech_budget (day TEXT NOT NULL, user_id TEXT NOT NULL, credits INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, user_id))");
    d.prepare("DELETE FROM speech_budget WHERE day = ? AND user_id NOT IN ('*', ?)").run(DAY(), u.uid);
    const ins = d.prepare("INSERT INTO speech_budget (day, user_id, credits) VALUES (?, ?, ?) ON CONFLICT(day, user_id) DO UPDATE SET credits = excluded.credits");
    for (const r of rows) ins.run(DAY(), r.user_id, r.credits);
  } finally { d.close(); }
};
const setSharedSpent = (credits) => putShared(credits ? [{ user_id: SHARED_ROW, credits }] : []);
const sharedBefore = otherRows();
let sharedTouched = false;
// Trong lúc chạy, mức chung bắt đầu từ 0 (mức chung của bản giả lập nhỏ, các lượt chạy trước cộng dồn credit thật sẽ chạm trần giữa chừng); xong trả lại như cũ.
const sharedOut = (on) => { sharedTouched = true; setSharedSpent(on ? 100_000_000 : 0); };
sharedOut(false);

// Tải một tệp lên như khung soạn (POST /api/files).
async function upload(name, data, type) {
  const fd = new FormData(); fd.set("file", new Blob([data], { type }), name);
  const r = await fetch(`${B}/api/files`, { method: "POST", headers: { origin: B, cookie: u.cookie }, body: fd });
  const j = await r.json().catch(() => ({}));
  return { name, s: r.status, j, why: String(j.error ?? j.note ?? "") };
}
// PDF một trang có một dòng chữ (đủ xref để trình đọc PDF mở như tệp thật).
function pdfWith(text) {
  const stream = `BT /F1 18 Tf 72 760 Td (${text}) Tj ET`;
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let out = "%PDF-1.4\n";
  const offs = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
// Word thật (thư viện docx của dự án): một đoạn có đáp án.
async function docxWith(text) {
  const { Document, Packer, Paragraph } = createRequire(path.join(process.cwd(), "package.json"))("docx");
  return Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("Biên bản giao nhận"), new Paragraph(text)] }] }));
}
// Âm thanh giả: WAV / M4A đúng phần đầu tệp (máy giả lập ElevenLabs chép lời bất kỳ nội dung nào). seed: đổi nội dung để không trùng tệp đã đọc.
const wav = (seed = "") => Buffer.concat([Buffer.from("RIFF\x24\x08\x00\x00WAVEfmt ", "latin1"), Buffer.from(`mock-audio-${seed}`)]);
const m4a = (seed = "") => Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypM4A \x00\x00\x02\x00isomiso2", "latin1"), Buffer.from(`mock-m4a-${seed}`)]);
const WEBP = "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";
// Lời báo hạn mức giọng AI chung của máy chủ (server/limitmsg.ts speechLimitMsg "all").
const SHARED_VOICE = /hạn mức chung của cả máy chủ/;
const BUSY = /đang đọc nhiều tệp cùng lúc/;

// Lượt chạy bền như giao diện: nhận mã lượt rồi đọc tới khi xong.
async function run(body, ms = 240_000) {
  const t0 = Date.now();
  const r0 = await u.api("POST", "/api/llm", { async: true, skills: true, system: "", conv: `free-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, ...body });
  const id = typeof r0.j?.run === "string" ? r0.j.run : r0.j?.run?.id ?? r0.j?.id;
  if (!id) return { http: r0.s, res: r0.j ?? {}, ms: Date.now() - t0 };
  let rn = null;
  await waitFor(async () => { rn = (await u.api("GET", `/api/runs/${id}?json=1`)).j?.run; return rn && !["running", "queued", "pending"].includes(rn.status); }, ms, { every: 500 });
  return { http: rn?.http ?? 0, res: rn?.result ?? {}, status: rn?.status, events: rn?.events ?? [], ms: Date.now() - t0 };
}
const filesOf = (res) => (res?.files ?? res?.outputs ?? []).map((f) => f?.name).filter(Boolean);
// Một dòng của ma trận: ra kết quả, hoặc chạm hạn mức với lời báo đủ ý. Không có kết quả mà cũng không phải lời báo hạn mức là lỗi.
function record(id, ask, r, extra = {}) {
  const err = r.res?.error ?? (r.http >= 400 ? JSON.stringify(r.res).slice(0, 200) : "");
  const limit = r.http === 429 || (!!err && LIMIT.test(err)) ? String(r.res?.error ?? err) : "";
  const row = { id, ask, model: r.res?.model ?? extra.model ?? "", auto: r.res?.auto ? `${r.res.auto.tier ?? ""}/${r.res.auto.vendor ?? ""}` : "", seconds: Math.round(r.ms / 100) / 10, http: r.http, files: filesOf(r.res), notice: r.res?.notice ?? "", limit, error: limit ? "" : err };
  row.keyNote = r.res?.keyNote ?? "";
  rows.push(row);
  // Tự động chạy bằng khóa API chung trong khi tài khoản đã có gói (T10 trên máy thật: Claude Opus 5.5 không một lời báo): phải có dòng báo.
  if (r.http === 200 && plansOn && r.res?.auto && row.model && !/^sub-/.test(row.model))
    ok(/khóa API chung của Synchro/.test(row.keyNote) && /hạn mức chi phí API/.test(row.keyNote), `${id}: chạy bằng khóa API chung (${row.model}) có dòng báo tính vào hạn mức chi phí API`, row);
  const answered = r.http === 200 && !err && (String(r.res?.text ?? "").trim().length > 0 || row.files.length > 0 || extra.done === true);
  ok(answered || (!!limit && complete(limit)), `${id} ${ask}: ${answered ? `${row.model || "?"} · ${row.seconds}s${row.files.length ? ` · ${row.files.join(", ")}` : ""}` : limit ? `chạm hạn mức, lời báo đủ ý` : "không có kết quả"}`, row);
  return row;
}

const code = async (cli) => /id="code"[^>]*>([^<]+)</.exec(await fetch(`${M}/mock-login/${cli}`).then((x) => x.text()).catch(() => ""))?.[1];
async function loginPlan(cli) {
  if (cli === "agy") {
    await u.api("POST", "/api/engines/agy/login/start", {});
    await u.api("POST", "/api/engines/agy/login/code", { code: await code("agy") });
  } else {
    const st = await u.api("POST", `/api/engines/${cli}/login/start`, {});
    await fetch(`${M}/mock-login/${cli}/approve?code=${st.j?.userCode}`).catch(() => {});
  }
  return !!(await waitFor(async () => (await u.api("GET", `/api/engines/${cli}/status?fresh=1`)).j?.loggedIn, 15_000, { every: 500 }));
}

let t = null;
try {
  console.log("━━ 1. Thẻ lỗi khi hết hạn mức chi phí API, trên trang thật (chưa đăng nhập gói nào)");
  setUsageOver(true);
  {
    const r = await u.api("POST", "/api/llm", { system: "", model: API_MODEL, skills: true, messages: [{ role: "user", content: "Xin chào" }] });
    ok(r.s === 429 && r.j?.usageLimit && complete(r.j.error) && /phiên này/.test(r.j.error), "API: chọn tay model khóa API khi hết hạn mức → 429, lời báo nói phiên 5 giờ, giờ hồi, cách thay thế", r.j);
    rows.push({ id: "L1", ask: "Hết hạn mức chi phí API (chọn tay model khóa API)", model: API_MODEL, seconds: 0, http: r.s, limit: r.j?.error ?? "" });
  }
  t = await openChrome({ base: B, port: Number(process.env.CDP_PORT ?? 9371), name: "free-account", shots: process.env.SHOTS });
  // Giao diện mặc định để Tự động; chuyển lượt gửi sang một model khóa API để chắc chắn đi đúng nhánh "hết hạn mức" của máy chủ (không phụ thuộc gói).
  t.on("Fetch.requestPaused", (p) => {
    let post = p.request?.postData;
    if (p.request?.method === "POST" && post) try { const b = JSON.parse(post); b.model = API_MODEL; post = JSON.stringify(b); } catch {}
    t.P("Fetch.continueRequest", { requestId: p.requestId, ...(post ? { postData: Buffer.from(post).toString("base64") } : {}) }).catch(() => {});
  });
  await t.P("Network.setCookie", { name: "synchro_session", value: u.cookie.split("=")[1], url: B });
  for (const [w, h, label] of [[1280, 860, "máy tính"], [390, 844, "điện thoại 390px"]]) {
    await t.size(w, h, w < 600);
    await t.P("Fetch.enable", { patterns: [{ urlPattern: "*/api/llm*", requestStage: "Request" }] });
    await t.P("Page.navigate", { url: `${B}/?free=${w}` });
    // Bản giả lập chế độ dev biên dịch trang lần đầu rất lâu khi máy bận (đo được 70 giây): chờ tới 3 phút; không mở được thì bỏ khung này, không dừng cả bộ.
    if (!ok(await t.until(`!!document.querySelector("textarea")`, 180_000), `${label}: trang chủ mở được`)) { await t.P("Fetch.disable"); continue; }
    const box = await t.ev(`(() => { const r = document.querySelector("textarea").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    await t.click(box[0], box[1]);
    await t.type(`Xin chào ${label}`);
    await t.key("Enter", "Enter", 13);
    // Lượt đầu tiên gọi /api/llm: chế độ dev biên dịch route lần đầu (đo được 86 giây khi máy bận) nên chờ tới 3 phút.
    const shown = await waitFor(() => t.ev(`(() => { const e = [...document.querySelectorAll(".msg-err")].at(-1); return e ? e.innerText : ""; })()`), 180_000, { every: 250 });
    ok(!!shown && complete(shown) && /phiên này/.test(shown) && !/gặp lỗi ở máy chủ/.test(shown), `${label}: thẻ lỗi hiện đúng lời báo (hạn mức nào, bao giờ hồi, cách thay thế), không bị thay bằng câu chung`, shown);
    ok(await t.ev(`!![...document.querySelectorAll(".msg-err button")].length`), `${label}: thẻ lỗi có nút làm tiếp (Thử lại / mở Providers)`);
    ok(await t.ev(`document.documentElement.scrollWidth <= innerWidth + 1 && [...document.querySelectorAll(".msg-err")].every((e) => e.getBoundingClientRect().right <= innerWidth + 1)`), `${label}: thẻ lỗi nằm trọn màn hình, không cuộn ngang`);
    await t.shot(`free-limit-${w}`);
    await t.P("Fetch.disable");

    // Lỗi 5 trên giao diện: hai tệp ghi âm đính kèm cùng lúc ở ô soạn. Thẻ tệp đầu "Đang chép lời…", thẻ sau "Đang chờ tệp trước…" (không báo
    // máy chủ bận), rồi cả hai xong. Máy giả lập chép lời tệp có chữ "slow-stt" mất 2 giây. Xem cả ở bề ngang điện thoại (390px).
    for (const [w, h, tag] of [[1280, 860, "desktop"], [390, 844, "phone"]]) {
      await t.size(w, h);
      await t.P("Page.navigate", { url: `${B}/?b5=${tag}` });
      if (!(await t.until(`!!document.querySelector("input[type=file][multiple]")`, 60_000))) { ok(false, `B5 (giao diện ${tag}): ô soạn có chỗ đính kèm`); continue; }
      const dir = path.join(tmpdir(), "synchro-ui"); mkdirSync(dir, { recursive: true });
      const seed = `slow-stt-ui-${tag}-${Date.now()}`;
      const fa = path.join(dir, `ghi-am-1-${tag}.wav`), fb = path.join(dir, `ghi-am-2-${tag}.m4a`);
      writeFileSync(fa, wav(seed)); writeFileSync(fb, m4a(seed));
      const inp = await t.P("Runtime.evaluate", { expression: `document.querySelector("input[type=file][multiple]")` });
      await t.P("DOM.setFileInputFiles", { files: [fa, fb], objectId: inp.result.objectId });
      const cards = `[...document.querySelectorAll(".ft")].map((c) => ({ name: c.querySelector(".ft-name")?.textContent ?? "", sub: c.querySelector(".ft-sub")?.textContent ?? "", err: c.classList.contains("ft-err"), msg: c.querySelector(".ft-err-msg")?.textContent ?? "", busy: !!c.querySelector(".ft-prog") }))`;
      const seen = new Set();
      const waitNote = await waitFor(async () => { const cs = await t.ev(cards); for (const c of cs ?? []) if (c.sub) seen.add(c.sub); return seen.has("Đang chờ tệp trước…") && seen.has("Đang chép lời…") ? cs : null; }, 20_000, { every: 100 });
      if (waitNote) await t.shot(`free-b5-queue-${tag}`);
      ok(!!waitNote, `B5 (giao diện ${tag}): thẻ tệp hiện "Đang chép lời…" và "Đang chờ tệp trước…" trong lúc xếp hàng`, [...seen]);
      const done = await waitFor(async () => { const cs = await t.ev(cards); return cs?.length >= 2 && cs.every((c) => !c.busy) ? cs : null; }, 60_000, { every: 300 });
      ok(!!done && done.every((c) => !c.err), `B5 (giao diện ${tag}): cả hai tệp ghi âm chép lời xong, không thẻ nào báo lỗi`, done);
      const wide = await t.ev(`document.documentElement.scrollWidth > innerWidth + 1`);
      ok(!wide, `B5 (giao diện ${tag}): không cuộn ngang`);
      await t.shot(`free-b5-done-${tag}`);
    }
    await t.size(1280, 860);
    if (w < 600) continue;
    // Lỗi 13 của ma trận: vùng trạng thái cho trình đọc màn hình (aria-live) vẫn giữ câu trả lời của đoạn chat cũ sau khi sang trang khác.
    // Lỗi 1: mức giọng AI chung đã cạn mà đầu trang Speech vẫn ghi "3.000 credit hôm nay".
    const live = `(document.querySelector(".sr-only[role=status][data-notr]")?.textContent ?? "").trim()`;
    const before = await waitFor(() => t.ev(live), 5_000, { every: 250 });
    sharedOut(true);
    await t.ev(`location.hash = "#v=speech"`);
    const credit = await waitFor(() => t.ev(`(document.querySelector(".sp-credit-n")?.textContent ?? "").trim()`), 60_000, { every: 300 });
    ok(!(await t.ev(live)), `${label}: sang Speech thì vùng aria-live không còn lời báo của đoạn chat trước`, { before, after: await t.ev(live) });
    ok(/^0\b/.test(credit), `${label}: mức giọng AI chung đã cạn → đầu trang Speech hiện còn 0 credit, không hiện số riêng còn nguyên (${credit || "không hiện thẻ credit"})`, credit);
    ok(/hạn mức chung|shared limit/.test(await t.ev(`document.querySelector(".sp-credit")?.title ?? ""`)), `${label}: chú thích thẻ credit nói hạn mức chung của máy chủ đã hết`);
    await t.shot("free-speech-shared");
    sharedOut(false);
  }
  t.close(); t = null;
  setUsageOver(false);

  console.log("━━ 2. Đăng nhập gói như tài khoản miễn phí: ChatGPT, Google (Antigravity), Grok — không có Claude");
  const plans = {};
  for (const cli of ["codex", "agy", "grok"]) plans[cli] = await loginPlan(cli);
  ok(plans.codex, "đăng nhập gói ChatGPT (giả lập)", plans);
  plansOn = Object.values(plans).some(Boolean);
  ok(!(await u.api("GET", "/api/engines/claude/status?fresh=1")).j?.loggedIn, "không có gói Claude (đúng hồ sơ tài khoản miễn phí)");

  console.log("━━ 3. Ma trận T1–T8, Word, video, Đọc văn bản, Chép lời (chế độ Tự động)");
  const auto = (content) => ({ model: "auto", messages: [{ role: "user", content }] });
  record("T1", "2+2 bằng mấy", await run(auto("2+2 bằng mấy")));
  {
    // T2 (như máy thật): 7 tệp có đáp án cài sẵn, tải lên như giao diện (POST /api/files); phần chữ đọc được phải chứa đúng đáp án, rồi gửi chữ + ảnh kèm 6 câu hỏi.
    const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const files = [
      ["kho.md", "# Kho\nMã kho: KHO-7319\nTồn kho bút: 120 cây", "text/markdown", /KHO-7319/],
      ["tonkho.csv", "mat_hang,so_luong,don_gia\nbut,120,5000\nvo,30,8000", "text/csv", /vo\W+30\W+8\.?000/],
      ["duan.json", JSON.stringify({ du_an: "Synchro", han_chot: "2026-12-24" }), "application/json", /2026-12-24/],
      ["ghichu.txt", "Món bánh khách đặt: Bơ Sữa.", "text/plain", /Bơ Sữa/],
      ["anh.png", Buffer.from(PNG, "base64"), "image/png", null],
      // PDF ngắn đi thẳng tới model dưới dạng tài liệu (không có bản chữ trong preview): chỉ kiểm tải lên được.
      ["hopdong.pdf", pdfWith("Hop dong so HD-5521"), "application/pdf", null],
      ["bienban.docx", await docxWith("Người ký nhận: Trần Văn Bình"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", /Trần Văn Bình/],
    ];
    const up = [];
    for (const [name, data, type, want] of files) up.push({ ...(await upload(name, data, type)), want });
    ok(up.every((x) => x.s === 200), "T2: 7 tệp (md, csv, json, txt, png, pdf, docx) tải lên được", up.map((x) => `${x.name}:${x.s} ${x.why}`).join(" | "));
    for (const x of up.filter((f) => f.want)) ok(x.want.test(x.j?.preview ?? ""), `T2: ${x.name} đọc ra đúng đáp án cài sẵn (${x.want.source})`, String(x.j?.preview ?? x.why).slice(0, 300));
    const content = [...up.filter((x) => x.j?.preview).map((x) => ({ type: "text", text: `Tệp ${x.name}:\n${x.j.preview}` })), { type: "image", media_type: "image/png", data: PNG },
      { type: "text", text: "Đọc các tệp đính kèm và trả lời: mã kho là gì; tiền vở trong tonkho.csv là bao nhiêu; hạn chót dự án; món bánh khách đặt; số hợp đồng; người ký nhận?" }];
    record("T2", "Đọc 7 tệp, 6 câu hỏi có đáp án", await run({ model: "auto", messages: [{ role: "user", content }] }));
  }
  {
    // T3 (như máy thật): 6 tệp khó — wav, m4a, webp, zip hỏng, .xyz là chữ, md. Mỗi tệp được đọc hoặc bị từ chối kèm lý do rõ, không im lặng.
    const odd = [["tieng.wav", wav("t3"), "audio/wav"], ["ghiam.m4a", m4a("t3"), "audio/mp4"], ["hinh.webp", Buffer.from(WEBP, "base64"), "image/webp"],
      ["hong.zip", Buffer.from("PK\x03\x04hong", "latin1"), "application/zip"], ["dulieu.xyz", Buffer.from("du lieu la: 12345\n"), "application/octet-stream"], ["sukien.md", "# Sự kiện\nMã: ONG-VANG-12", "text/markdown"]];
    const t0 = Date.now(), res = [];
    for (const [name, data, type] of odd) res.push(await upload(name, data, type));
    ok(res.every((x) => x.s === 200 || (x.s === 422 && x.why.length > 15)), "T3: tệp khó được đọc hoặc bị từ chối kèm lý do", res.map((x) => `${x.name}:${x.s} ${x.why}`));
    const by = Object.fromEntries(res.map((x) => [x.name, x]));
    ok(by["hinh.webp"].s === 200, "T3: ảnh webp tải lên được", by["hinh.webp"]);
    ok(by["dulieu.xyz"].s === 200 && /12345/.test(by["dulieu.xyz"].j?.preview ?? ""), "T3: tệp đuôi lạ .xyz mà là chữ thì đọc như văn bản", by["dulieu.xyz"]);
    ok(/ONG-VANG-12/.test(by["sukien.md"].j?.preview ?? ""), "T3: md đọc đúng", by["sukien.md"]);
    ok(by["hong.zip"].s === 422 && /hỏng|không mở được|damaged/i.test(by["hong.zip"].why), "T3: zip hỏng bị từ chối, lý do nói tệp nén bị hỏng", by["hong.zip"]);
    rows.push({ id: "T3", ask: "Tệp khó: wav, m4a, webp, zip hỏng, .xyz, md", model: "(tải lên)", seconds: Math.round((Date.now() - t0) / 100) / 10, http: 200, limit: "", files: [], notice: res.map((x) => `${x.name}: ${x.s} ${x.why.slice(0, 80)}`).join(" | ") });
  }
  {
    // Lỗi 2 và 5 của ma trận: mức giọng AI chung của máy chủ đã cạn (tài khoản này chưa dùng credit nào). Hai tệp âm thanh chọn cùng lúc trong chat:
    // CẢ HAI phải báo đúng lý do (hạn mức chung, giờ hồi, dùng micro của trình duyệt), không tệp nào nhận câu "máy chủ đang đọc nhiều tệp".
    sharedOut(true);
    const pair = await Promise.all([upload("cung-luc.wav", wav(`pair-${Date.now()}`), "audio/wav"), upload("cung-luc.m4a", m4a(`pair-${Date.now()}`), "audio/mp4")]);
    for (const x of pair) ok(x.s === 422 && SHARED_VOICE.test(x.why) && complete(x.why) && /micro/.test(x.why) && !BUSY.test(x.why), `T3: ${x.name} gửi cùng lúc khi mức giọng chung đã cạn → báo đúng hạn mức (không phải "máy chủ bận")`, x.why || x.s);
    const t0 = Date.now();
    const tts = await u.api("POST", "/api/speech/tts", { text: "Xin chào đây là bài thử đọc văn bản tiếng Việt của Synchro nhé." });
    const fd = new FormData(); fd.set("file", new Blob([wav("t13")], { type: "audio/wav" }), "clip3s.wav");
    const r = await fetch(`${B}/api/speech/stt`, { method: "POST", headers: { origin: B, cookie: u.cookie }, body: fd });
    const stt = await r.json().catch(() => ({}));
    ok(tts.s === 429 && tts.j?.code === "budget" && SHARED_VOICE.test(tts.j?.error ?? "") && complete(tts.j.error), "T12: Đọc văn bản khi mức chung đã cạn: báo hạn mức chung, giờ hồi, giọng trình duyệt", tts.j);
    ok(r.status === 429 && stt.code === "budget" && SHARED_VOICE.test(stt.error ?? "") && complete(stt.error) && /micro/.test(stt.error), "T13: Chép lời khi mức chung đã cạn: báo hạn mức chung, giờ hồi, micro của trình duyệt", stt);
    // Lỗi 1: số credit ở đầu trang Speech chỉ tính hạn mức riêng ("3.000 credit hôm nay" trước và sau khi bị chặn).
    const pl = (await u.api("GET", "/api/speech/plan")).j ?? {};
    if (pl.connected && pl.credits?.limit > 0) ok(pl.credits.shared === true, "Speech: /api/speech/plan báo mức chung đã cạn (credits.shared) để đầu trang hiện còn 0", pl.credits);
    rows.push({ id: "T12", ask: "Đọc văn bản khi mức giọng chung đã cạn", model: "Eleven v4", seconds: Math.round((Date.now() - t0) / 100) / 10, http: tts.s, limit: tts.j?.error ?? "" });
    rows.push({ id: "T13", ask: "Chép lời khi mức giọng chung đã cạn", model: "Scribe v2", seconds: 0, http: r.status, limit: stt.error ?? "" });
    sharedOut(false);
    const pl2 = (await u.api("GET", "/api/speech/plan")).j ?? {};
    ok(!pl2.credits?.shared, "Speech: mức chung còn thì không còn cờ shared", pl2.credits);
  }
  {
    // Lỗi 5, phần xếp hàng: hai tệp ghi âm trong một tin nhắn khi còn hạn mức. Máy chủ chép lời mỗi người một tệp một lúc; tệp thứ hai phải CHỜ
    // tới lượt rồi đọc xong, không bị báo "máy chủ đang đọc nhiều tệp" (máy giả lập ElevenLabs chép lời tệp có chữ "slow-stt" mất 2 giây).
    const seed = `slow-stt-${Date.now()}`, t0 = Date.now();
    const timed = async (name, data, type) => { const r = await upload(name, data, type); return { ...r, at: Date.now() - t0 }; };
    const pair = await Promise.all([timed("hang-doi.wav", wav(seed), "audio/wav"), timed("hang-doi.m4a", m4a(seed), "audio/mp4")]);
    for (const x of pair) ok(x.s === 200 && /Đà Nẵng|phỏng vấn/.test(x.j?.preview ?? "") && !BUSY.test(x.why), `Lỗi 5: ${x.name} gửi cùng lúc với tệp kia → xếp hàng rồi chép lời xong (${x.at} ms)`, `${x.s} ${x.why}`);
    const [a, b] = pair.map((x) => x.at).sort((m, n) => m - n);
    ok(b - a >= 1500, `Lỗi 5: hai tệp chép lời lần lượt, không chạy chồng (xong lúc ${a} ms và ${b} ms)`, pair.map((x) => x.at));
    rows.push({ id: "B5", ask: "Hai tệp ghi âm cùng lúc (còn hạn mức): xếp hàng", model: "Scribe v2", seconds: Math.round(b / 100) / 10, http: Math.max(...pair.map((x) => x.s)), limit: "", files: [], notice: pair.map((x) => `${x.name}: ${x.s} @${x.at}ms`).join(" | ") });
  }
  record("T4", "Markdown 14 thành phần", await run(auto("Viết một ví dụ Markdown có tiêu đề, danh sách 3 cấp, ô tích, bảng căn phải, code, công thức KaTeX, sơ đồ mermaid, trích dẫn, gạch ngang, chú thích.")));
  record("T5", "Excel bảng lương 5 người", await run(auto("Tạo file Excel bảng lương 5 người, có công thức và biểu đồ")));
  record("T6", "Tỷ giá USD Vietcombank hôm nay", await run(auto("Tỷ giá USD bán ra Vietcombank hôm nay")));
  record("T7", "3 Google Docs gần nhất qua connector", await run(auto("Liệt kê 3 Google Docs gần nhất của tôi")));
  record("T8", "Bộ slide gọi vốn 6 trang", await run(auto("Làm bộ slide gọi vốn 6 trang, thiết kế thật đẹp")));
  record("Word", "Thư mời hợp tác .docx 1 trang", await run(auto("Viết thư mời hợp tác dạng .docx, 1 trang, có bảng và chỗ ký")));
  record("Video", "Video motion graphic 8 giây", await run(auto("Làm video motion graphic 8 giây cho logo chữ SYNCHRO")));
  {
    const t0 = Date.now();
    const r = await u.api("POST", "/api/speech/tts", { text: "Xin chào, đây là bản đọc thử của tài khoản miễn phí." });
    record("TTS", "Speech → Đọc văn bản", { http: r.s, res: r.s === 200 ? { model: r.j?.item?.meta?.model ?? "ElevenLabs", text: r.j?.item?.url ?? "" } : r.j ?? {}, ms: Date.now() - t0 }, { done: !!r.j?.item?.url });
  }
  {
    const t0 = Date.now();
    const fd = new FormData(); fd.set("file", new Blob([Buffer.from("RIFF0000WAVEfmt mock-audio")], { type: "audio/wav" }), "loi-noi.wav");
    const r = await fetch(`${B}/api/speech/stt`, { method: "POST", headers: { origin: B, cookie: u.cookie }, body: fd });
    const j = await r.json().catch(() => ({}));
    record("STT", "Speech → Chép lời tệp WAV", { http: r.status, res: r.status === 200 ? { model: j?.item?.meta?.model ?? "Scribe", text: j?.data?.text ?? "" } : j, ms: Date.now() - t0 });
  }

  console.log("━━ 3b. Gói hết hạn mức giữa lượt Tự động (T8 trên máy thật: \"Grok 4.7 hit its limit, so Synchro answered with GPT-5.6 Terra.\")");
  {
    // Lượt dò: Tự động chọn gói nào cho câu này, rồi gửi lại đúng câu đó kèm dấu [mock:quota:<cli>] để CHỈ gói đó báo hết hạn mức.
    const ASK = "Tóm tắt ngắn gọn trong hai câu: Synchro là trợ lý AI làm việc cùng bạn.";
    const probe = await run(auto(ASK));
    const cli = /^sub-([a-z]+)\//.exec(probe.res?.model ?? "")?.[1];
    if (ok(!!cli, `Tự động chọn model của gói cho câu dò (${probe.res?.model ?? probe.res?.error})`, probe.res)) {
      const r = await run(auto(`${ASK} [mock:quota:${cli}]`));
      const sw = r.res?.switched ?? "";
      ok(r.http === 200 && !new RegExp(`^sub-${cli}/`).test(r.res?.model ?? ""), `gói ${cli} hết hạn mức: Tự động trả lời bằng gói khác (${r.res?.model ?? r.res?.error})`, r.res);
      ok(/đã hết hạn mức, nên Synchro đã trả lời bằng/.test(sw) && complete(sw) && /Hạn mức (gói|riêng của) .+ hồi lại sau \d+/.test(sw), "lời báo dưới câu trả lời nói đủ: hạn mức gói nào, bao giờ hồi, đang dùng gì thay", sw);
      rows.push({ id: "T8q", ask: `Gói ${cli} hết hạn mức giữa lượt Tự động`, model: r.res?.model ?? "", seconds: Math.round(r.ms / 100) / 10, http: r.http, notice: sw, limit: "" });
      // Lỗi 3 (phần sau): vòng mức dùng và Cài đặt → Usage không hiện gói đang bị chặn dù máy chủ biết giờ hồi.
      const us = (await u.api("GET", "/api/usage?all=1")).j ?? {};
      const v = us.vendors?.find((x) => x.sub?.cli === cli || x.cli === cli);
      const w = v?.sub?.windows?.find((x) => x.status === "rejected");
      ok(!!w && Number(w.resetsAt) > Date.now(), `vòng mức dùng: gói ${cli} hiện đã chạm giới hạn kèm giờ hồi (${w ? new Date(w.resetsAt).toISOString() : "không có"})`, v ?? us);
    }
  }

  console.log("━━ 4. Chạm từng hạn mức: lời báo đủ ý, không vượt hạn mức của hãng");
  setUsageOver(true);
  {
    const r = await run(auto("Xin chào sau khi hết hạn mức"));
    const viaPlan = r.http === 200 && /^sub-/.test(r.res?.model ?? "") && /hết hạn mức API/.test(r.res?.notice ?? "");
    ok(viaPlan || (r.http === 429 && complete(r.res?.error)), `hết hạn mức chi phí API + Tự động: trả lời bằng gói đã kết nối kèm lời báo, hoặc báo đủ ý (${r.res?.model ?? r.res?.error})`, r.res);
    ok(!/^(anthropic|openai|google|xai|deepseek)\//.test(r.res?.model ?? ""), "không dùng khóa API khi đã hết hạn mức chi phí API", r.res?.model);
    rows.push({ id: "L1b", ask: "Hết hạn mức chi phí API, Tự động", model: r.res?.model ?? "", seconds: Math.round(r.ms / 100) / 10, http: r.http, notice: r.res?.notice ?? "", limit: r.res?.error ?? "" });
  }
  setUsageOver(false);
  if (plans.codex) {
    const models = (await u.api("GET", "/api/models")).j?.providers?.flatMap((p) => p.models ?? []) ?? [];
    const cx = models.find((m) => /^sub-codex\//.test(m.key ?? m.id ?? ""))?.key ?? "sub-codex/gpt-6.1-sol";
    const r = await run({ model: cx, messages: [{ role: "user", content: "Viết một đoạn ngắn [mock:quota]" }] });
    const e = r.res ?? {};
    const told = /ChatGPT/.test(e.error ?? "") && Number(e.resetsAt) > Date.now() && !!(e.switchTo || e.apiModel || e.apiModelName);
    ok(told || (r.http === 200 && !!e.switched), `gói ChatGPT hết hạn mức: nói gói nào, giờ hồi (resetsAt), cách thay thế (đổi model / khóa API) — ${e.error ?? e.switched ?? ""}`, e);
    rows.push({ id: "L2", ask: "Gói ChatGPT hết hạn mức", model: cx, seconds: Math.round(r.ms / 100) / 10, http: r.http, limit: e.error ?? "", notice: e.resetsAt ? `hồi lúc ${new Date(e.resetsAt).toISOString()}` : "" });
    const after = await run(auto("Viết code Python in ra số 5"));
    // Hết cả gói: Tự động không gọi model nào của gói đó nữa; hết riêng một model: không gọi lại đúng model đó.
    const blocked = e.quota === "plan" ? /^sub-codex\//.test(after.res?.model ?? "") : after.res?.model === cx;
    ok(!blocked, `sau khi gói ChatGPT hết hạn mức (${e.quota ?? "?"}), Tự động không gọi lại (không vượt hạn mức của hãng): ${after.res?.model ?? after.res?.error}`, after.res);
  }
  {
    // bp.md:275 / T10 trên máy thật: mọi gói đã kết nối tạm hết hạn mức (hoặc Tự động chọn model khóa API) → lượt chạy bằng khóa API chung của
    // chủ máy chủ. Được chạy (còn hạn mức chi phí API) nhưng phải có một dòng báo lượt này tính vào hạn mức chi phí API, không phải gói.
    const keys = (await u.api("GET", "/api/models")).j?.providers?.flatMap((p) => p.models ?? []).map((m) => m.key ?? m.id).filter(Boolean) ?? [];
    for (const cli of ["codex", "agy", "grok"].filter((c) => plans[c])) {
      const k = keys.find((x) => x.startsWith(`sub-${cli}/`) && (cli !== "agy" || /gemini/.test(x)));
      if (k) await run({ model: k, messages: [{ role: "user", content: "Chào [mock:quota]" }] });
    }
    record("T10k", "Mọi gói tạm hết hạn mức, Tự động dùng khóa API chung", await run(auto("Viết một câu chào ngắn cho đội ngũ Synchro")));
    const last = rows.at(-1);
    ok(plansOn && !!last.model && !/^sub-/.test(last.model) && /khóa API chung/.test(last.keyNote), `Tự động sang khóa API chung (${last.model}) kèm dòng báo: ${last.keyNote.slice(0, 80)}`, last);
  }
  setSpeechSpent(10_000_000);
  {
    const tts = await u.api("POST", "/api/speech/tts", { text: "Câu này không được đọc vì đã hết credit hôm nay." });
    ok(tts.s === 429 && tts.j?.code === "budget" && complete(tts.j.error) && /giọng của trình duyệt/.test(tts.j.error), "Đọc văn bản hết credit giọng AI hôm nay: báo hạn mức nào, giờ hồi, dùng giọng trình duyệt", tts.j);
    const fd = new FormData(); fd.set("file", new Blob([Buffer.from("RIFF0000WAVEfmt mock-audio")], { type: "audio/wav" }), "het-credit.wav");
    const r = await fetch(`${B}/api/speech/stt`, { method: "POST", headers: { origin: B, cookie: u.cookie }, body: fd });
    const j = await r.json().catch(() => ({}));
    ok(r.status === 429 && j.code === "budget" && complete(j.error) && /micro/.test(j.error), "Chép lời hết credit: cách thay thế đúng việc (micro của trình duyệt), không bảo dùng giọng đọc", j);
    rows.push({ id: "L3", ask: "Hết credit giọng AI (Đọc văn bản / Chép lời)", model: "ElevenLabs", seconds: 0, http: tts.s, limit: `${tts.j?.error ?? ""} || ${j.error ?? ""}` });
  }
  setSpeechSpent(null);

  console.log("━━ 5. T11 tạo Google Docs khi chưa có connector; T14 đổi giao diện sáng / tối bằng ⌘K ở Speech và Artifacts");
  {
    // T11 (bp.md:177): chưa có connector (Composio chưa liên kết). Giả lập đúng cách model thật đã làm ở T7: mở trang đăng nhập Google trong trình
    // duyệt của Synchro. Synchro phải chặn trước khi mở, lời dặn trỏ tới Cài đặt → Connectors, và khung chat hiện nút "Liên kết Composio".
    const ASK11 = `Tạo một Google Docs mới tên Kế hoạch quý 1 (${Date.now().toString(36)})`;
    const TOOL11 = ` #tool=browser_navigate #args={"url":"https://accounts.google.com/v3/signin/identifier?continue=https://docs.google.com/document/create"}`;
    const cx = (await u.api("GET", "/api/connectors")).j ?? {};
    ok(!(cx.connectors ?? []).some((c) => c.status === "ok") && cx.composio?.state !== "linked", "T11: tài khoản chưa có connector nào (Composio chưa liên kết)", { n: cx.connectors?.length, composio: cx.composio?.state });
    const r11 = await run({ model: API_MODEL, messages: [{ role: "user", content: ASK11 + TOOL11 }] });
    const ev11 = JSON.stringify(r11.events ?? []);
    const conn = (r11.events ?? []).filter((e) => e.kind === "conn").map((e) => { try { return JSON.parse(e.text); } catch { return {}; } });
    const hist = await fetch(`${M}/_debug/hist`).then((x) => x.json()).catch(() => ({}));
    const sent = [...(hist.anthropic ?? [])].reverse().find((x) => JSON.stringify(x.messages ?? []).includes(ASK11) && JSON.stringify(x.messages ?? []).includes("tool_result"));
    const toolOut = JSON.stringify(sent?.messages ?? []);
    ok(/Không mở https:\/\/accounts\.google\.com/.test(toolOut) && /Cài đặt → Connectors/.test(toolOut), "T11: trình duyệt của Synchro không mở trang đăng nhập Google; kết quả công cụ trỏ model tới Cài đặt → Connectors (Composio)", toolOut.slice(0, 600) || ev11.slice(0, 400));
    ok(conn.some((c) => c.link === true && /Composio/.test(c.name ?? "")), "T11: khung chat tự hiện nút Liên kết Composio (không chờ model nhớ gọi connector_reconnect)", ev11.slice(0, 500));
    ok(/Đã chặn trang đăng nhập/.test(ev11), "T11: bước công cụ ghi rõ đã chặn trang đăng nhập", ev11.slice(0, 500));
    rows.push({ id: "T11", ask: "Tạo Google Docs mới khi chưa có connector", model: r11.res?.model ?? API_MODEL, seconds: Math.round(r11.ms / 100) / 10, http: r11.http, limit: "", files: [], notice: conn.length ? "nút Liên kết Composio + Cài đặt → Connectors" : "KHÔNG có nút liên kết" });

    t = await openChrome({ base: B, port: Number(process.env.CDP_PORT ?? 9371), name: "free-account-t11", shots: process.env.SHOTS });
    await t.P("Network.setCookie", { name: "synchro_session", value: u.cookie.split("=")[1], url: B });
    await t.size(1280, 860);
    // Giao diện để Tự động; lượt gửi đi bằng model khóa API để mock ép đúng lời gọi công cụ như ở trên.
    t.on("Fetch.requestPaused", (p) => {
      let post = p.request?.postData;
      if (p.request?.method === "POST" && post) try { const b = JSON.parse(post); b.model = API_MODEL; post = JSON.stringify(b); } catch {}
      t.P("Fetch.continueRequest", { requestId: p.requestId, ...(post ? { postData: Buffer.from(post).toString("base64") } : {}) }).catch(() => {});
    });
    await t.P("Fetch.enable", { patterns: [{ urlPattern: "*/api/llm*", requestStage: "Request" }] });
    await t.P("Page.navigate", { url: `${B}/?t11=1` });
    if (ok(await t.until(`!!document.querySelector("textarea")`, 180_000), "T11 (giao diện): trang chủ mở được")) {
      const box = await t.ev(`(() => { const r = document.querySelector("textarea").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
      await t.click(box[0], box[1]);
      await t.type(`${ASK11} UI${TOOL11}`);
      await t.key("Enter", "Enter", 13);
      const card = await waitFor(() => t.ev(`(() => { const c = [...document.querySelectorAll(".cn-rc")].at(-1); return c ? [...c.querySelectorAll("button")].map((b) => b.textContent.trim()) : null; })()`), 180_000, { every: 300 });
      ok(Array.isArray(card) && card.includes("Liên kết Composio") && card.includes("Mở Cài đặt → Connectors"), "T11 (giao diện): thẻ trong khung chat có nút Liên kết Composio và Mở Cài đặt → Connectors", card);
      await t.shot("free-t11-card");
      await t.ev(`[...document.querySelectorAll(".cn-rc button")].find((b) => b.textContent.trim() === "Mở Cài đặt → Connectors")?.click()`);
      ok(await t.until(`!!document.querySelector(".modal.settings .s-item.on[title=Connectors]")`, 15_000), "T11 (giao diện): bấm nút thì mở Cài đặt đúng mục Connectors");
      await t.shot("free-t11-settings");
      await t.key("Escape", "Escape", 27);
    }
    await t.P("Fetch.disable");

    // T14 (bp.md:179): đổi giao diện bằng ⌘K ("Chuyển sang giao diện tối / sáng") ở Speech và Artifacts. Giao diện lưu ở trình duyệt (localStorage
    // "theme"), không phải tùy chọn đồng bộ của tài khoản. Trang phải đổi màu thật (nền, chữ đủ tương phản), không cuộn ngang; xong trả về sáng.
    const lum = `((c) => { const m = c.match(/[\\d.]+/g) ?? [0, 0, 0]; const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(+m[0]) + 0.7152 * f(+m[1]) + 0.0722 * f(+m[2]); })`;
    const look = `(() => { const L = ${lum}; const bgOf = (e) => { for (; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(c)) return c; } return getComputedStyle(document.body).backgroundColor; };
      const main = document.querySelector("main, .main") ?? document.body, bg = L(bgOf(main));
      const texts = [...main.querySelectorAll("h1,h2,h3,p,button,span,label")].filter((e) => e.childElementCount === 0 && e.textContent.trim() && e.getBoundingClientRect().width > 0).slice(0, 60);
      const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const low = texts.filter((e) => ratio(L(getComputedStyle(e).color), L(bgOf(e))) < 3).map((e) => e.textContent.trim().slice(0, 30));
      return { theme: document.documentElement.dataset.theme, bg, n: texts.length, low, wide: document.documentElement.scrollWidth > innerWidth + 1 }; })()`;
    const palette = async (q) => {
      for (const mod of [4, 2]) { await t.key("k", "KeyK", 75, mod); if (await t.until(`!!document.querySelector(".pal input")`, 3000)) break; }
      await t.ev(`(() => { const i = document.querySelector(".pal input"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, ${JSON.stringify(q)}); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
      await sleep(400);
      const rows = await t.ev(`[...document.querySelectorAll(".pal .s-row")].map((r) => r.textContent.trim())`);
      await t.key("Enter", "Enter", 13);
      await t.until(`!document.querySelector(".pal input")`, 3000);
      return rows;
    };
    for (const [view, hash] of [["Speech", "#v=speech"], ["Artifacts", "#v=artifacts"]]) {
      await t.ev(`location.hash = ${JSON.stringify(hash)}`);
      await sleep(1500);
      const before = await t.ev(look);
      const want = before.theme === "dark" ? "light" : "dark";
      const rows14 = await palette(want === "dark" ? "giao dien toi" : "giao dien sang");
      const after = await waitFor(async () => { const x = await t.ev(look); return x.theme === want ? x : null; }, 5_000, { every: 200 });
      ok(!!after && (want === "dark" ? after.bg < 0.1 : after.bg > 0.6), `T14: ${view}: ⌘K "${rows14?.[0] ?? "?"}" đổi sang ${want === "dark" ? "tối" : "sáng"}, nền đổi theo (độ sáng ${before.bg.toFixed(2)} → ${after?.bg?.toFixed(2)})`, { before, after, rows14 });
      ok(!!after && !after.low.length && !after.wide, `T14: ${view} ở giao diện ${want === "dark" ? "tối" : "sáng"}: chữ đủ tương phản (${after?.n ?? 0} chữ), không cuộn ngang`, after);
      await t.shot(`free-t14-${view.toLowerCase()}-${want}`);
      const back = await palette(want === "dark" ? "giao dien sang" : "giao dien toi");
      const again = await waitFor(async () => { const x = await t.ev(look); return x.theme === before.theme ? x : null; }, 5_000, { every: 200 });
      ok(!!again && !again.low.length, `T14: ${view}: ⌘K đổi lại ${before.theme === "dark" ? "tối" : "sáng"} được, chữ vẫn đủ tương phản`, { again, back });
    }
    rows.push({ id: "T14", ask: "Đổi sáng / tối bằng ⌘K ở Speech và Artifacts", model: "-", seconds: 0, http: 200, limit: "", files: [], notice: "localStorage theme, không đổi tùy chọn tài khoản" });
    t.close(); t = null;
  }
} catch (e) {
  ok(false, "chạy hết kịch bản", e?.stack ?? String(e));
} finally {
  try { t?.close(); } catch {}
  try { setUsageOver(false); setSpeechSpent(null); if (sharedTouched) putShared(sharedBefore); } catch {}
  await u.remove();
}

console.log(`\n━━ Ma trận tài khoản miễn phí (giả lập) · ${profile.verified ? "đã xác minh" : "chưa xác minh"} · model ${JSON.stringify(profile.models)} · tính năng tắt: ${profile.featuresOff.join(", ") || "(không)"}`);
for (const r of rows) console.log(`${String(r.id).padEnd(5)} ${String(r.ask).padEnd(46).slice(0, 46)} ${String(r.model || "-").padEnd(28).slice(0, 28)} ${String(r.seconds ?? "-").padStart(6)}s  ${r.limit ? `HẠN MỨC: ${String(r.limit).slice(0, 140)}` : r.error ? `LỖI: ${String(r.error).slice(0, 120)}` : r.notice ? String(r.notice).slice(0, 120) : r.keyNote ? `KHÓA API CHUNG: ${String(r.keyNote).slice(0, 100)}` : "ok"}`);
try { mkdirSync(path.dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), base: B, profile, rows }, null, 2)); console.log(`\nBảng JSON: ${OUT}`); } catch {}
console.log(`\n${pass}/${pass + fail} đạt`);
await sleep(10);
process.exit(fail ? 1 : 0);
