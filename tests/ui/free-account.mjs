// Ma trận tài khoản miễn phí trên bản giả lập (Blueprint H1.1–H1.3): một tài khoản thành viên mới (người dùng tạm, không phải quản trị viên),
// đăng nhập gói ChatGPT, Google (Antigravity), Grok như tài khoản miễn phí đã thử thật, KHÔNG có gói Claude. Chạy lại T1–T8, Word, video,
// Đọc văn bản, Chép lời ở chế độ Tự động; ghi model được chọn, thời gian và lời báo khi chạm hạn mức. Mỗi việc phải ra kết quả, hoặc chạm
// hạn mức với lời báo nói đủ: hạn mức nào, bao giờ hồi, cách thay thế (H1.2). Rồi cố ý chạm từng hạn mức: chi phí API của Synchro (cả
// thẻ lỗi trên trang thật, máy tính và 390px), gói ChatGPT, credit giọng AI (Đọc văn bản, Chép lời) — và kiểm không vượt hạn mức của hãng.
// Bảng kết quả in ra cuối và ghi JSON vào <tmp>/synchro-ui/free-account.json (OUT để đổi). Chạy tay: BASE=http://localhost:3200 node tests/ui/free-account.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openChrome, sleep, waitFor } from "../lib/cdp.mjs";
import { tempUser } from "../lib/tempuser.mjs";

const B = process.env.BASE ?? process.env.SYNCHRO_URL ?? "http://localhost:3200", M = process.env.MOCK ?? "http://127.0.0.1:4010";
const OUT = process.env.OUT ?? path.join(tmpdir(), "synchro-ui", "free-account.json");
const API_MODEL = "anthropic/claude-haiku-5-5";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 700)); };

// Lời báo hạn mức đủ ba phần (cùng tiêu chí với app/limitmsg.ts limitParts, kiểm ở tests/api/limit-messages.test.mjs).
const parts = (msg = "") => ({
  which: /(phiên|tuần|hôm nay|mỗi giờ|mỗi ngày|Gói \S+|gói \S+|session|week|today|per hour|plan)/i.test(msg),
  when: /(sau (khoảng )?\d+ (phút|giờ|ngày)|ngày mai|in (about )?\d+ ?(min|h|days?)|tomorrow)/i.test(msg),
  alt: /(Trong lúc chờ|vẫn dùng được|chọn Tự động|Cài đặt → Providers|In the meantime|still work|choose Auto)/i.test(msg),
});
const complete = (msg) => Object.values(parts(msg)).every(Boolean);
const LIMIT = /hạn mức|giới hạn|limit/i;

const u = await tempUser(B, "free-acct", { name: "Free Account" });
const rows = [];
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

// Lượt chạy bền như giao diện: nhận mã lượt rồi đọc tới khi xong.
async function run(body, ms = 240_000) {
  const t0 = Date.now();
  const r0 = await u.api("POST", "/api/llm", { async: true, skills: true, system: "", conv: `free-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, ...body });
  const id = typeof r0.j?.run === "string" ? r0.j.run : r0.j?.run?.id ?? r0.j?.id;
  if (!id) return { http: r0.s, res: r0.j ?? {}, ms: Date.now() - t0 };
  let rn = null;
  await waitFor(async () => { rn = (await u.api("GET", `/api/runs/${id}?json=1`)).j?.run; return rn && !["running", "queued", "pending"].includes(rn.status); }, ms, { every: 500 });
  return { http: rn?.http ?? 0, res: rn?.result ?? {}, status: rn?.status, ms: Date.now() - t0 };
}
const filesOf = (res) => (res?.files ?? res?.outputs ?? []).map((f) => f?.name).filter(Boolean);
// Một dòng của ma trận: ra kết quả, hoặc chạm hạn mức với lời báo đủ ý. Không có kết quả mà cũng không phải lời báo hạn mức là lỗi.
function record(id, ask, r, extra = {}) {
  const err = r.res?.error ?? (r.http >= 400 ? JSON.stringify(r.res).slice(0, 200) : "");
  const limit = r.http === 429 || (!!err && LIMIT.test(err)) ? String(r.res?.error ?? err) : "";
  const row = { id, ask, model: r.res?.model ?? extra.model ?? "", auto: r.res?.auto ? `${r.res.auto.tier ?? ""}/${r.res.auto.vendor ?? ""}` : "", seconds: Math.round(r.ms / 100) / 10, http: r.http, files: filesOf(r.res), notice: r.res?.notice ?? "", limit, error: limit ? "" : err };
  rows.push(row);
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
    ok(await t.until(`!!document.querySelector("textarea")`, 60_000), `${label}: trang chủ mở được`);
    const box = await t.ev(`(() => { const r = document.querySelector("textarea").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    await t.click(box[0], box[1]);
    await t.type(`Xin chào ${label}`);
    await t.key("Enter", "Enter", 13);
    const shown = await waitFor(() => t.ev(`(() => { const e = [...document.querySelectorAll(".msg-err")].at(-1); return e ? e.innerText : ""; })()`), 30_000);
    ok(!!shown && complete(shown) && /phiên này/.test(shown) && !/gặp lỗi ở máy chủ/.test(shown), `${label}: thẻ lỗi hiện đúng lời báo (hạn mức nào, bao giờ hồi, cách thay thế), không bị thay bằng câu chung`, shown);
    ok(await t.ev(`!![...document.querySelectorAll(".msg-err button")].length`), `${label}: thẻ lỗi có nút làm tiếp (Thử lại / mở Providers)`);
    ok(await t.ev(`document.documentElement.scrollWidth <= innerWidth + 1 && [...document.querySelectorAll(".msg-err")].every((e) => e.getBoundingClientRect().right <= innerWidth + 1)`), `${label}: thẻ lỗi nằm trọn màn hình, không cuộn ngang`);
    await t.shot(`free-limit-${w}`);
    await t.P("Fetch.disable");
  }
  t.close(); t = null;
  setUsageOver(false);

  console.log("━━ 2. Đăng nhập gói như tài khoản miễn phí: ChatGPT, Google (Antigravity), Grok — không có Claude");
  const plans = {};
  for (const cli of ["codex", "agy", "grok"]) plans[cli] = await loginPlan(cli);
  ok(plans.codex, "đăng nhập gói ChatGPT (giả lập)", plans);
  ok(!(await u.api("GET", "/api/engines/claude/status?fresh=1")).j?.loggedIn, "không có gói Claude (đúng hồ sơ tài khoản miễn phí)");

  console.log("━━ 3. Ma trận T1–T8, Word, video, Đọc văn bản, Chép lời (chế độ Tự động)");
  const auto = (content) => ({ model: "auto", messages: [{ role: "user", content }] });
  record("T1", "2+2 bằng mấy", await run(auto("2+2 bằng mấy")));
  {
    // T2: tải lên như giao diện (POST /api/files), rồi gửi chữ đã đọc + ảnh kèm câu hỏi.
    const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const files = [["ghi-chu.md", "# Kho\nTồn kho bút: 120 cây", "text/markdown"], ["kho.csv", "mat_hang,so_luong,don_gia\nbut,120,5000\nvo,80,12000", "text/csv"],
      ["cau-hinh.json", JSON.stringify({ cua_hang: "Synchro", mo_cua: "08:00" }), "application/json"], ["loi-nhan.txt", "Giao hàng trước thứ Sáu.", "text/plain"], ["mau.png", Buffer.from(PNG, "base64"), "image/png"]];
    const up = [];
    for (const [name, data, type] of files) {
      const fd = new FormData(); fd.set("file", new Blob([data], { type }), name);
      const r = await fetch(`${B}/api/files`, { method: "POST", headers: { origin: B, cookie: u.cookie }, body: fd });
      up.push({ name, s: r.status, j: await r.json().catch(() => ({})) });
    }
    ok(up.every((x) => x.s === 200), "T2: 5 tệp (md, csv, json, txt, png) tải lên được", up.map((x) => `${x.name}:${x.s}`).join(" "));
    const content = [...up.filter((x) => x.j?.preview).map((x) => ({ type: "text", text: `Tệp ${x.name}:\n${x.j.preview}` })), { type: "image", media_type: "image/png", data: PNG },
      { type: "text", text: "Đọc các tệp đính kèm: tổng tiền hàng trong kho.csv là bao nhiêu, cửa hàng mở cửa lúc mấy giờ?" }];
    record("T2", "Đọc 5 tệp, câu hỏi có đáp án", await run({ model: "auto", messages: [{ role: "user", content }] }));
  }
  {
    // T3: tệp khó (âm thanh, zip hỏng, đuôi lạ): mỗi tệp được đọc hoặc bị từ chối kèm lý do rõ, không im lặng.
    const odd = [["ghi-am.wav", Buffer.from("RIFF0000WAVEfmt mock-audio"), "audio/wav"], ["hong.zip", Buffer.from("PK\x03\x04hong"), "application/zip"], ["du-lieu.xyz", Buffer.from([0, 1, 2, 3, 250, 251]), "application/octet-stream"]];
    const t0 = Date.now(), res = [];
    for (const [name, data, type] of odd) {
      const fd = new FormData(); fd.set("file", new Blob([data], { type }), name);
      const r = await fetch(`${B}/api/files`, { method: "POST", headers: { origin: B, cookie: u.cookie }, body: fd });
      const j = await r.json().catch(() => ({}));
      res.push({ name, s: r.status, why: j.error ?? j.note ?? j.kind ?? "" });
    }
    ok(res.every((x) => x.s === 200 || (x.s === 422 && String(x.why).length > 15)), "T3: tệp khó được đọc hoặc bị từ chối kèm lý do", res);
    rows.push({ id: "T3", ask: "Tệp khó: wav, zip hỏng, đuôi .xyz", model: "(tải lên)", seconds: Math.round((Date.now() - t0) / 100) / 10, http: 200, limit: "", files: [], notice: res.map((x) => `${x.name}: ${x.s} ${String(x.why).slice(0, 80)}`).join(" | ") });
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
} catch (e) {
  ok(false, "chạy hết kịch bản", e?.stack ?? String(e));
} finally {
  try { t?.close(); } catch {}
  try { setUsageOver(false); setSpeechSpent(null); } catch {}
  await u.remove();
}

console.log("\n━━ Ma trận tài khoản miễn phí (giả lập)");
for (const r of rows) console.log(`${String(r.id).padEnd(5)} ${String(r.ask).padEnd(46).slice(0, 46)} ${String(r.model || "-").padEnd(28).slice(0, 28)} ${String(r.seconds ?? "-").padStart(6)}s  ${r.limit ? `HẠN MỨC: ${String(r.limit).slice(0, 140)}` : r.error ? `LỖI: ${String(r.error).slice(0, 120)}` : r.notice ? String(r.notice).slice(0, 120) : "ok"}`);
try { mkdirSync(path.dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), base: B, rows }, null, 2)); console.log(`\nBảng JSON: ${OUT}`); } catch {}
console.log(`\n${pass}/${pass + fail} đạt`);
await sleep(10);
process.exit(fail ? 1 : 0);
