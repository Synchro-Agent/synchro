// Lỗi tìm thấy khi thử Speech trên bản thật (G6.5), kiểm không cần máy chủ (fetch giả cho ElevenLabs):
// chi phí thật của Nhạc / Nhạc cho video / Tách stem (ElevenLabs không báo trong header: đo độ tăng credit của gói), thanh credit cập nhật sau các công cụ đó,
// trạng thái lồng tiếng giữ thời gian dự kiến cho thanh tiến độ; và phần giao diện thuần: đồng hồ âm thanh dưới một giây, tên ngôn ngữ, số nhiều tiếng Anh,
// dấu thập phân của định dạng tải xuống, tiêu đề do Synchro đặt theo ngôn ngữ giao diện, hướng dẫn Tạo giọng khớp số thẻ, lời báo micro bị chặn.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-g65-"));
process.env.DATA_KEY = "g65-key"; process.env.SYNCHRO_RELAX_LIMITS = "1";
process.env.ADMIN_EMAILS = "owner@g65.test"; process.env.OWNER_EMAILS = "owner@g65.test";
process.env.ELEVENLABS_API_KEY = "khoa-gia";
for (const k of ["BASE", "KEY", "ID", "LABEL", "HEADER"]) delete process.env[`SPEECH_FALLBACK_${k}`];

// ElevenLabs giả: số credit đã dùng của gói (used) tăng khi tạo; Nhạc / Tách stem không báo character-cost như bản thật.
const EL = { used: 1000, music: 375, stems: 120, video: 200, other: 0 /* việc của người khác cùng lúc (Nhạc, Tách stem) */, header: 0, subFail: false, dub: 0, calls: [] };
const realFetch = globalThis.fetch;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const mp3 = (sec) => new Response(Buffer.alloc(Math.round((sec * 128_000) / 8)), { status: 200, headers: { "content-type": "audio/mpeg", ...(EL.header ? { "character-cost": String(EL.header) } : {}) } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url)), m = init.method ?? "GET";
  EL.calls.push(`${m} ${u.pathname}`);
  if (u.pathname === "/v1/user/subscription") return EL.subFail ? json({ detail: { status: "missing_permissions", message: "missing the permission user_read" } }, 401)
    : json({ tier: "creator", status: "active", character_count: EL.used, character_limit: 100_000, voice_limit: 30, voice_slots_used: 0, professional_voice_limit: 1, professional_voice_slots_used: 0, can_use_instant_voice_cloning: true, can_use_professional_voice_cloning: true });
  if (u.pathname === "/v1/models") return json([{ model_id: "eleven_v4", name: "Eleven v4", can_do_text_to_speech: true, requires_alpha_access: false, max_characters_request_subscribed_user: 10_000, languages: [], model_rates: { character_cost_multiplier: 1 } }]);
  if (u.pathname === "/v1/studio/projects") return json({ projects: [] });
  if (m === "POST" && u.pathname === "/v1/music" && typeof init.body === "string" && JSON.parse(init.body).prompt) {
    const b = JSON.parse(init.body); EL.used += EL.music + EL.other;
    return mp3(b.music_length_ms ? b.music_length_ms / 1000 : 42);
  }
  if (m === "POST" && u.pathname === "/v1/music/video-to-music") { EL.used += EL.video; return mp3(8); }
  if (m === "POST" && u.pathname === "/v1/music/stem-separation") { EL.used += EL.stems + EL.other; return new Response(Buffer.from("504b0506000000000000000000000000000000000000", "hex"), { status: 200, headers: { "content-type": "application/zip" } }); }
  if (m === "POST" && u.pathname === "/v1/dubbing" && init.body instanceof FormData && init.body.get("target_lang")) return json({ dubbing_id: "dub_1", expected_duration_sec: 63 });
  if (m === "GET" && u.pathname === "/v1/dubbing/dub_1") { EL.dub++; return json({ status: EL.dub > 1 ? "dubbed" : "dubbing", media_metadata: { duration: 63 }, error: null }); }
  if (m === "GET" && u.pathname === "/v1/dubbing/dub_1/audio/en") return mp3(63);
  if (m === "POST") return json({ detail: { status: "invalid", message: "thiếu dữ liệu" } }, 422); // dò quyền của khóa: yêu cầu rỗng
  throw new Error("đường chưa giả lập: " + m + " " + u.pathname);
};
// Log [speech-cost] của spentMeasured: giữ lại để kiểm, không in ra.
const warns = []; const realWarn = console.warn; console.warn = (...a) => { if (String(a[0]).startsWith("[speech-cost]")) warns.push(a.join(" ")); else realWarn(...a); };
const { speechapi: S, authstore: AS, "api/speech/[...op]/route": R } = await loadTs(["speechapi", "authstore", "api/speech/[...op]/route"]);
const mk = (email) => AS.createUser({ email, name: "U", verified: true });
const owner = mk("owner@g65.test"), M1 = mk("m1@g65.test");
const O = "http://localhost:3200";
const cookie = (u) => AS.createSession(u, new Request(O + "/", { headers: { host: "localhost:3200" } }), "password").split(";")[0];
const call = async (u, method, op, body) => {
  const form = body instanceof FormData;
  const req = new Request(`${O}/api/speech/${op}`, { method, headers: { origin: O, host: "localhost:3200", cookie: cookie(u), ...(form ? {} : { "content-type": "application/json" }) }, ...(body ? { body: form ? body : JSON.stringify(body) } : {}) });
  const r = await R[method](req, { params: Promise.resolve({ op: op.split("?")[0].split("/") }) });
  return { s: r.status, j: /json/.test(r.headers.get("content-type") ?? "") ? await r.json() : null };
};
// size: số byte của tệp (mặc định 6 giây MP3 128 kbps = 96.000 byte, để ước lượng Tách stem theo thời lượng có nghĩa).
const fileForm = (fields, name = "song.mp3", type = "audio/mpeg", size = 96_000) => { const fd = new FormData(); fd.set("file", new File([Buffer.alloc(size)], name, { type })); for (const [k, v] of Object.entries(fields)) fd.set(k, v); return fd; };

console.log("1. Nhạc: chi phí thật theo độ tăng credit của gói (bản thật trả cost 0)");
await S.plan({ fresh: true });
let r = await call(owner, "POST", "music", { prompt: "bài hát vui", seconds: 30 });
ok(r.s === 200 && r.j.item.meta.cost === 375, "Nhạc 30 giây ghi đúng 375 credit vào mục", r.j);
ok(r.j.credits.used === 1375, "thanh credit (chủ sở hữu: credit của gói) tăng ngay sau Nhạc, không phải quét lại", r.j.credits);
ok((await S.plan()).credits.used === 1375, "gói trong bộ nhớ cũng cập nhật");
EL.music = 125;
r = await call(M1, "POST", "music", { prompt: "nhạc nền ngắn", seconds: 10 });
ok(r.s === 200 && r.j.item.meta.cost === 125 && r.j.credits.used === 125, "thành viên: mục ghi 125 credit, hạn mức trong ngày của họ tăng 125", r.j);
EL.other = 9000;
r = await call(owner, "POST", "music", { prompt: "lần đo lẫn người khác", seconds: 10 });
ok(r.j.item.meta.cost === 125, "gói tăng lệch quá xa ước lượng (người khác dùng chung khóa cùng lúc): ghi ước lượng 12,5 credit/giây", r.j.item.meta);
// Lẫn ít hơn (gói tăng 2× ước lượng): trước đây vẫn nhận (tới 4×) và tính vào hạn mức của người gọi. Giá Nhạc đã đo nên chỉ chừa 50%.
EL.music = 125; EL.other = 125;
let b0 = S.spentToday(M1.id);
r = await call(M1, "POST", "music", { prompt: "lẫn một lần đọc của người khác", seconds: 10 });
ok(r.j.item.meta.cost === 125 && S.spentToday(M1.id) - b0 === 125, "gói tăng 250 cho bài 10 giây (≈125): mục và hạn mức trong ngày của người gọi chỉ tính 125", [r.j.item.meta.cost, S.spentToday(M1.id) - b0]);
EL.other = 50; b0 = S.spentToday(M1.id);
r = await call(M1, "POST", "music", { prompt: "giá lệch nhẹ", seconds: 10 });
ok(r.j.item.meta.cost === 175 && S.spentToday(M1.id) - b0 === 175, "gói tăng trong khoảng 1,5× ước lượng: ghi đúng số đo (175)", r.j.item.meta);
EL.other = 0; EL.music = 0;
r = await call(owner, "POST", "music", { prompt: "gói chưa kịp tăng", seconds: 20 });
ok(r.j.item.meta.cost === 250, "gói chưa tăng: ghi ước lượng theo thời lượng", r.j.item.meta);
r = await call(owner, "POST", "music", { prompt: "AI tự chọn độ dài" });
ok(r.j.item.meta.cost === Math.round(42 * 12.5), "AI tự chọn độ dài: ước lượng theo thời lượng tệp MP3 trả về", r.j.item.meta);
EL.header = 77; EL.music = 300;
r = await call(owner, "POST", "music", { prompt: "header có số", seconds: 30 });
ok(r.j.item.meta.cost === 77, "ElevenLabs có báo character-cost: dùng số trong header", r.j.item.meta);
EL.header = 0; EL.subFail = true; EL.music = 375;
const calls0 = EL.calls.length;
r = await call(owner, "POST", "music", { prompt: "khóa thiếu quyền User", seconds: 30 });
ok(r.s === 200 && r.j.item.meta.cost === 375, "khóa không đọc được gói: vẫn ghi ước lượng (375), không lỗi", r.j);
ok(EL.calls.slice(calls0).filter((c) => c.endsWith("/v1/user/subscription")).length === 1, "không đọc được trước khi gọi thì không đọc lại sau");
EL.subFail = false;

console.log("2. Tách stem, Nhạc cho video");
let used0 = EL.used;
r = await call(owner, "POST", "music/stems", fileForm({ stems: "2" }));
ok(r.s === 200 && r.j.item.meta.cost === 120 && r.j.item.meta.stems === 2 && r.j.item.meta.source === "song.mp3", "Tách stem ghi đúng 120 credit (trước đây 0)", r.j);
ok(r.j.credits.used === used0 + 120, "thanh credit cập nhật sau Tách stem", r.j.credits);
ok(warns.some((w) => /music\/stems: gói tăng 120 credit, ước lượng 100 \(6 giây\) → ghi số đo/.test(w)), "Tách stem (giá chưa đo trên bản thật): ghi log số đo để chủ máy chủ chỉnh giá", warns);
EL.stems = 0;
r = await call(owner, "POST", "music/stems", fileForm({ stems: "2" }));
ok(r.s === 200 && r.j.item.meta.cost === 100, "Tách stem, gói chưa kịp tăng: ghi ước lượng theo thời lượng bài (6 giây ≈ 100), không còn 0", r.j.item.meta);
EL.subFail = true;
r = await call(owner, "POST", "music/stems", fileForm({ stems: "6" }, "dai.mp3", "audio/mpeg", 960_000));
ok(r.s === 200 && r.j.item.meta.cost === 1000, "Tách stem, khóa không đọc được gói: ước lượng 60 giây ≈ 1.000 credit", r.j.item.meta);
EL.subFail = false;
EL.stems = 120; EL.other = 9000;
const t0 = S.spentToday(M1.id);
r = await call(M1, "POST", "music/stems", fileForm({ stems: "2" }));
ok(r.s === 200 && r.j.item.meta.cost === 100 && S.spentToday(M1.id) - t0 === 100, "Tách stem lẫn việc người khác (gói tăng 9.120): mục và hạn mức trong ngày của người gọi chỉ tính ước lượng 100", [r.j.item.meta, S.spentToday(M1.id) - t0]);
ok(warns.some((w) => /music\/stems: gói tăng 9120 credit, ước lượng 100 .*bỏ số đo/.test(w)), "độ tăng bị bỏ có ghi log", warns.slice(-2));
EL.other = 0;
// WAV: thời lượng đọc từ header (không theo kích thước như MP3).
const wav = (sec, rate = 8000) => { const n = Math.round(sec * rate), b = Buffer.alloc(44 + n * 2); b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40); return b; };
ok(Math.abs(S.audioSecOf(wav(6)) - 6) < 1e-9 && Math.abs(S.audioSecOf(wav(2.5, 44100)) - 2.5) < 1e-9 && S.audioSecOf(Buffer.alloc(16_000)) === 1, "thời lượng tệp tải lên: WAV theo header, định dạng khác theo 128 kbps", [S.audioSecOf(wav(6)), S.audioSecOf(wav(2.5, 44100))]);
r = await call(owner, "POST", "music/video", fileForm({ prompt: "" }, "sunrise.webm", "video/webm"));
ok(r.s === 200 && r.j.item.meta.cost === 200 && r.j.item.meta.video === "sunrise.webm", "Nhạc cho video ghi đúng 200 credit, giữ tên video trong meta để dựng tiêu đề theo ngôn ngữ", r.j);
EL.video = 600;
r = await call(owner, "POST", "music/video", fileForm({ prompt: "" }, "sunrise.webm", "video/webm"));
ok(r.s === 200 && r.j.item.meta.cost === 600, "Nhạc cho video (giá chưa đo): 600 credit cho 8 giây vẫn được ghi, không bị thay bằng ước lượng theo giá Nhạc (100)", r.j.item.meta);
ok(warns.some((w) => /music\/video: gói tăng 600 credit, ước lượng 100 \(8 giây\) → ghi số đo/.test(w)), "Nhạc cho video: log giá thật mỗi lần đo", warns.slice(-1));

console.log("3. Lồng tiếng: thời gian dự kiến và trạng thái");
r = await call(owner, "POST", "dub", fileForm({ target: "en" }, "clip.mp4", "video/mp4"));
const dubId = r.j?.item?.id;
ok(r.s === 200 && r.j.item.meta.expected === 63 && r.j.item.meta.target === "en" && r.j.item.meta.status === "dubbing", "dự án lồng tiếng lưu expected_duration_sec cho thanh tiến độ", r.j);
r = await call(owner, "GET", `dub?id=${dubId}`);
ok(r.j.item.meta.status === "dubbing" && r.j.item.meta.expected === 63, "đang lồng: vẫn giữ thời gian dự kiến", r.j.item.meta);
r = await call(owner, "GET", `dub?id=${dubId}`);
ok(r.j.item.meta.status === "dubbed" && !!r.j.item.url, "xong: có âm thanh ngay ở lần hỏi kế tiếp", r.j.item);

console.log("4. Giao diện: định dạng, ngôn ngữ, số nhiều");
const { "speech/fmt": F, "i18n-core": C, "i18n-dict": D, "speech/data": SD } = await loadTs(["speech/fmt", "i18n-core", "i18n-dict", "speech/data"]);
const dict = { map: D.VI2EN, rules: D.RULES_EN };
const en = (s) => C.trWith(dict, s, "en"), tfe = (k, v) => C.tfWith(dict, k, v, "en"), tfv = (k, v) => C.tfWith(undefined, k, v, "vi");
ok(F.fmtClockOf(0, 0.48, "en-US") === "0:00.0" && F.fmtClockOf(0.48, 0.48, "en-US") === "0:00.5", "âm thanh 0,48 giây: “0:00.0 / 0:00.5”, không còn “0:00 / 0:00”", [F.fmtClockOf(0, 0.48, "en-US"), F.fmtClockOf(0.48, 0.48, "en-US")]);
ok(F.fmtClockOf(0.48, 0.48, "vi-VN") === "0:00,5" && F.fmtClockOf(4.5, 7, "en-US") === "0:04.5", "dấu thập phân theo ngôn ngữ giao diện");
ok(F.fmtClockOf(65, 70, "en-US") === "1:05" && F.fmtClockOf(0, 0, "en-US") === "0:00", "bản dài và chưa biết thời lượng: như cũ");
// 9,95–10 giây làm tròn thành 10,0: trước đây hiện “0:010.0”.
const c997 = [F.fmtClockOf(0, 9.97, "en-US"), F.fmtClockOf(9.97, 9.97, "en-US"), F.fmtClockOf(9.96, 9.97, "vi-VN")];
ok(c997.join(" ") === "0:00 0:10 0:10", "tiếng động 9,97 giây: “0:00 / 0:10”, không còn “0:010.0”", c997);
const c994 = [F.fmtClockOf(9.94, 9.94, "en-US"), F.fmtClockOf(9.96, 9.94, "en-US"), F.fmtClockOf(4.96, 9.94, "en-US")];
ok(c994.join(" ") === "0:09.9 0:09.9 0:05.0", "9,94 giây vẫn có phần mười; vị trí làm tròn trước khi định dạng (4,96 → “0:05.0”)", c994);
ok(tfe("{n} bản", { n: 1 }) === "1 item" && tfe("{n} bản", { n: 3 }) === "3 items" && en("1 bản") === "1 item" && en("12 bản") === "12 items" && tfv("{n} bản", { n: 1 }) === "1 bản", "số bản trong Kết quả: “1 item”, “3 items” (không còn “1 items”)", [tfe("{n} bản", { n: 1 }), en("1 bản")]);
const estEn = tfe("≈ {n} credit · ước tính theo thời lượng", { n: (1000).toLocaleString("en-US") }), estVi = tfv("≈ {n} credit · ước tính theo thời lượng", { n: (3750).toLocaleString("vi-VN") });
ok(estEn === "≈ 1,000 credits · estimated by length" && estVi === "≈ 3.750 credit · ước tính theo thời lượng", "ước tính Nhạc theo ngôn ngữ giao diện: “≈ 1,000 credits” (không còn “≈ 1.000”)", [estEn, estVi]);
ok(tfe("Ghi âm {time}", { time: "14-05" }) === "Recording 14-05" && tfv("Ghi âm {time}", { time: "14-05" }) === "Ghi âm 14-05", "tên tệp ghi âm theo ngôn ngữ giao diện: “Recording 14-05”");
ok(en("Trợ lý Synchro") === "Synchro assistant" && SD.AGENT_TEMPLATES.every((t) => ["name", "first", "prompt"].every((k) => !/[ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹđ]/i.test(en(t[k])))), "mẫu agent (tên mặc định “Trợ lý Synchro”, lời chào, hướng dẫn) đều có bản tiếng Anh");
ok(F.langLabelOf("vie", "en-US") === "Vietnamese" && F.langLabelOf("en", "en-US") === "English" && F.langLabelOf("en", "vi-VN") === "Tiếng Anh", "tên ngôn ngữ theo giao diện (không còn “Tiếng Anh” ở giao diện tiếng Anh)");
ok(F.langLabelOf("", "en-US", "x") === "x" && F.langLabelOf("zz", "en-US", "Khác") === "Khác", "mã trống / lạ: dùng tên dự phòng");
const [k1, v1] = F.itemTitleKey({ kind: "stems", meta: { source: "song.mp3", stems: 2 } });
ok(tfe(k1, v1) === "2 stems · song.mp3" && tfe(k1, { ...v1, n: 1 }) === "1 stem · song.mp3", "Tách stem: “2 stems”, không còn “2 stem”", tfe(k1, v1));
ok(tfv(k1, v1) === "Tách 2 stem · song.mp3", "giao diện tiếng Việt giữ chữ Việt", tfv(k1, v1));
const [k2, v2] = F.itemTitleKey({ kind: "music", meta: { video: "sunrise.webm" } });
ok(tfe(k2, v2) === "Music for sunrise.webm" && tfv(k2, v2) === "Nhạc cho sunrise.webm", "Nhạc cho video: “Music for sunrise.webm” ở giao diện tiếng Anh");
ok(F.itemTitleKey({ kind: "music", meta: { prompt: "x" } }) === null, "tiêu đề từ nội dung người dùng giữ nguyên");
ok(tfe("{n} quy tắc", { n: 1 }) === "1 rule" && tfe("{n} quy tắc", { n: 2 }) === "2 rules" && en("1 quy tắc") === "1 rule", "“1 rule”, “2 rules” (không còn “1 rules”)", [tfe("{n} quy tắc", { n: 1 }), en("1 quy tắc")]);
const fmts = ["MP3 44,1 kHz · 128 kbps", "MP3 44,1 kHz · 192 kbps", "WAV 44,1 kHz", "PCM 44,1 kHz (thô)"].map(en);
ok(fmts.every((x) => x.includes("44.1") && !x.includes("44,1")), "định dạng tải xuống ở giao diện tiếng Anh dùng dấu chấm thập phân", fmts);
ok(en("Nghe bài viết này") === "Listen to this article", "xem trước Audio Native có bản tiếng Anh");

console.log("5. Hướng dẫn Tạo giọng khớp số thẻ đang hiện");
const trv = (s) => s, tfvi = (k, v) => C.tfWith(undefined, k, v, "vi");
const full = SD.GUIDES.create.what;
const has = (list) => (f) => list.includes(f);
ok(F.createWhatOf(null, full, trv, tfvi) === full && F.createWhatOf(has(["ivc", "pvc", "design", "remix"]), full, trv, tfvi) === full, "chưa biết gói hoặc đủ bốn cách: giữ câu gốc");
const three = F.createWhatOf(has(["ivc", "design", "remix"]), full, en, tfe);
ok(/three ways/.test(three) && !/four|professional/i.test(three) && /instant cloning/.test(three) && /or remixing an existing voice\.$/.test(three), "gói Starter (không có nhân bản chuyên sâu): “three ways”, không nhắc cách đang ẩn", three);
const threeVi = F.createWhatOf(has(["ivc", "design", "remix"]), full, trv, tfvi);
ok(/theo ba cách/.test(threeVi) && !/chuyên sâu/.test(threeVi), "tiếng Việt: “theo ba cách”", threeVi);
ok(/^Make your own voice two ways: voice design from a description or remixing an existing voice\.$/.test(F.createWhatOf(has(["design", "remix"]), full, en, tfe)), "hai cách");
ok(/^Make your own voice with voice design/.test(F.createWhatOf(has(["design"]), full, en, tfe)), "một cách");

console.log("6. Micro bị chặn: lời báo rõ, có bản tiếng Anh");
for (const n of ["NotAllowedError", "SecurityError", "NotFoundError", "NotReadableError", "TimeoutError", "NoMic", ""]) {
  const m = F.micErrorOf(n), e = en(m);
  ok(m.length > 30 && e !== m && !/[ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹđ]/i.test(e), `${n || "lỗi lạ"}: ${e.slice(0, 60)}…`, e);
}
ok(/Allow|allow/.test(en(F.micErrorOf("NotAllowedError"))) && /address bar/.test(en(F.micErrorOf("NotAllowedError"))), "bị chặn: chỉ cách cho phép micro ở thanh địa chỉ");

globalThis.fetch = realFetch; console.warn = realWarn;
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
