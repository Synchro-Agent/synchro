// Speech chuyển sang nhà cung cấp dự phòng (Blueprint G6.4): el() gửi lại ĐÚNG MỘT LẦN ở dự phòng khi nhà cung cấp chính lỗi mạng, 5xx, khóa hỏng
// hoặc hết lượt — chỉ với đọc văn bản và chép lời, không bao giờ với nhân bản / xóa giọng. Không đặt SPEECH_FALLBACK_* thì như cũ. Không cần máy chủ.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-failover-"));
process.env.DATA_KEY = "failover-key";
process.env.ELEVENLABS_API_KEY = "khoa-chinh";
for (const k of ["BASE", "KEY", "ID", "LABEL", "HEADER"]) delete process.env[`SPEECH_FALLBACK_${k}`];

// Hai đích giả: api.elevenlabs.io (chính) và fallback.test (dự phòng). Mỗi đích trả theo kịch bản đặt trong T.
const realFetch = globalThis.fetch;
const T = { main: () => new Response("audio-main", { status: 200 }), spare: () => new Response("audio-spare", { status: 200 }), calls: [] };
const json = (o, status) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url)), h = new Headers(init.headers);
  const who = u.host === "api.elevenlabs.io" ? "main" : u.host === "fallback.test" ? "spare" : null;
  if (!who) throw new Error("đích lạ: " + u.host);
  let body = init.body;
  if (body instanceof FormData) body = Object.fromEntries([...body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : `file:${v.size}`]));
  T.calls.push({ who, method: init.method ?? "GET", path: u.pathname + u.search, xi: h.get("xi-api-key"), auth: h.get("authorization"), body });
  return T[who](u, init);
};
const reset = (main, spare = () => new Response("audio-spare", { status: 200, headers: { "character-cost": "7" } })) => { T.main = main; T.spare = spare; T.calls.length = 0; };
const { speechapi: S } = await loadTs(["speechapi"]);
const tts = (o = {}) => S.el("/v1/text-to-speech/v1?output_format=mp3_44100_128", { ...S.jsonBody({ text: "Xin chào", model_id: "eleven_v4" }), feat: "tts", ...o });
const caught = async (f) => { try { await f(); return null; } catch (e) { return e; } };

console.log("1. Không đặt SPEECH_FALLBACK_*: như cũ, chỉ ElevenLabs");
ok(S.speechProviders().providers.length === 1 && S.speechProviders().providers[0].id === "elevenlabs", "một nhà cung cấp", S.speechProviders());
reset(() => json({ detail: { status: "server_error", message: "boom" } }, 500));
let e = await caught(() => tts());
ok(e?.status === 502 && T.calls.length === 1 && T.calls[0].who === "main", "5xx: báo lỗi, không gửi lại", T.calls);
reset(() => new Response("audio-main", { status: 200, headers: { "character-cost": "3" } }));
let r = await tts();
ok(await r.text() === "audio-main" && S.servedBy(r) === "elevenlabs", "thành công: ghi nhận ElevenLabs đã phục vụ");

console.log("2. Có dự phòng: TTS chuyển sang khi chính lỗi");
process.env.SPEECH_FALLBACK_BASE = "https://fallback.test/";
process.env.SPEECH_FALLBACK_KEY = "khoa-du-phong";
process.env.SPEECH_FALLBACK_ID = "spare";
process.env.SPEECH_FALLBACK_HEADER = "authorization";
ok(S.speechProviders().providers.map((p) => p.id).join() === "elevenlabs,spare", "hai nhà cung cấp, chính đứng trước");
const worthy = [
  ["lỗi mạng", () => { throw new TypeError("fetch failed"); }],
  ["5xx", () => json({ detail: { status: "server_error", message: "boom" } }, 503)],
  ["429 bận", () => json({ detail: { status: "too_many_concurrent_requests", message: "busy" } }, 429)],
  ["401 khóa hỏng", () => json({ detail: { status: "invalid_api_key", message: "Invalid API key" } }, 401)],
  ["403 khóa hỏng", () => json({ detail: { status: "invalid_api_key", message: "Invalid API key" } }, 403)],
  ["hết credit", () => json({ detail: { status: "quota_exceeded", message: "This request exceeds your quota" } }, 401)],
];
for (const [name, main] of worthy) {
  reset(main);
  r = await tts();
  const [a, b] = T.calls;
  ok(await r.text() === "audio-spare" && S.servedBy(r) === "spare" && T.calls.length === 2 && a.who === "main" && b.who === "spare", `${name}: dự phòng phục vụ, gửi lại đúng một lần`, T.calls);
  ok(b.path === a.path && JSON.stringify(b.body) === JSON.stringify(a.body) && b.method === "POST", `${name}: cùng đường, cùng thân yêu cầu`);
  ok(b.auth === "khoa-du-phong" && b.xi === null && a.xi === "khoa-chinh", `${name}: khóa chính không đi theo sang dự phòng`, b);
}
const lf = S.speechProviders().lastFailover;
ok(lf?.from === "elevenlabs" && lf.to === "spare" && lf.ok && lf.path === "/v1/text-to-speech/v1", "ghi lại lần chuyển gần nhất", lf);
ok(S.speechProviders().providers.find((p) => p.id === "spare").served >= worthy.length, "đếm số lượt dự phòng đã phục vụ");

reset(() => json({ detail: { status: "server_error", message: "boom" } }, 500));
r = await S.el("/v1/text-to-speech/v1/stream?output_format=mp3_44100_128", { ...S.jsonBody({ text: "a" }), feat: "tts" });
ok(S.servedBy(r) === "spare" && T.calls[1].path.startsWith("/v1/text-to-speech/v1/stream"), "đọc to (/stream) cũng chuyển");

console.log("3. STT (FormData có tệp) chuyển sang và gửi lại đủ tệp");
reset(() => json({ detail: { status: "server_error", message: "boom" } }, 502), () => json({ text: "xin chào" }, 200));
const fd = new FormData();
fd.set("model_id", "scribe_v2"); fd.set("file", new Blob([Buffer.from("RIFF-audio-123")], { type: "audio/wav" }), "a.wav");
r = await S.el("/v1/speech-to-text", { method: "POST", body: fd, feat: "stt" });
ok((await r.json()).text === "xin chào" && S.servedBy(r) === "spare", "dự phòng chép lời");
ok(T.calls[1].body?.file === "file:14" && T.calls[1].body?.model_id === "scribe_v2", "tệp và tham số gửi lại nguyên vẹn", T.calls[1].body);

console.log("4. Không chuyển khi không nên");
reset(() => json({ detail: { status: "invalid", message: "text is required" } }, 422));
e = await caught(() => tts());
ok(e && T.calls.length === 1, "lỗi nội dung (422): không gửi lại, dự phòng cũng sẽ từ chối", T.calls);
reset(() => json({ detail: { status: "missing_permissions", message: "The API key is missing the permission text_to_speech" } }, 401));
e = await caught(() => tts());
ok(e?.code === "perm" && T.calls.length === 1, "khóa thiếu quyền: báo để sửa khóa, không gửi lại", e?.code);
const boom = () => json({ detail: { status: "server_error", message: "boom" } }, 500);
reset(boom);
e = await caught(() => S.el("/v1/voices/add", { method: "POST", body: new FormData(), feat: "ivc" }));
ok(e && T.calls.length === 1, "nhân bản giọng: không bao giờ gửi sang dự phòng", T.calls);
reset(boom);
e = await caught(() => S.el("/v1/voices/abc", { method: "DELETE" }));
ok(e && T.calls.length === 1, "xóa giọng: không bao giờ gửi sang dự phòng");
reset(boom);
e = await caught(() => S.el("/v1/text-to-voice/design", S.jsonBody({ voice_description: "x" })));
ok(e && T.calls.length === 1, "thiết kế giọng: không gửi sang dự phòng");
reset(boom);
e = await caught(() => S.el("/v1/speech-to-text/realtime", S.jsonBody({})));
ok(e && T.calls.length === 1, "đường con khác của STT: không gửi sang dự phòng");
reset(boom);
e = await caught(() => S.el("/v1/text-to-speech/v1", { method: "GET" }));
ok(e && T.calls.length === 1, "chỉ yêu cầu tạo (POST) mới chuyển");
reset(boom);
e = await caught(() => S.el("/v1/text-to-speech/v1", { method: "POST", body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); c.close(); } }), duplex: "half" }));
ok(e && T.calls.length === 1, "thân là luồng đọc một lần: không gửi lại");
reset(boom);
const ac = new AbortController();
reset(() => { ac.abort(); throw new DOMException("aborted", "AbortError"); });
e = await caught(() => tts({ signal: ac.signal }));
ok(e?.code === "net" && T.calls.length === 1, "người gọi đã hủy: không gửi lại", T.calls);

console.log("5. Cả hai cùng lỗi: báo lỗi của nhà cung cấp chính");
reset(() => json({ detail: { status: "invalid_api_key", message: "Invalid API key" } }, 401), () => json({ detail: { status: "server_error", message: "spare down" } }, 500));
const elog = console.error; console.error = () => {};
e = await caught(() => tts());
console.error = elog;
ok(e?.code === "key" && T.calls.length === 2, "lỗi khóa của ElevenLabs để quản trị viên sửa", e?.code);
ok(S.speechProviders().lastFailover?.ok === false, "ghi lại lần chuyển không thành");

console.log("6. Credit của gói ElevenLabs và gói khi chính mất kết nối");
T.main = (u) => u.pathname === "/v1/user/subscription" ? json({ tier: "creator", status: "active", character_count: 100, character_limit: 1000, voice_limit: 30, voice_slots_used: 0, professional_voice_limit: 1, professional_voice_slots_used: 0, can_use_instant_voice_cloning: true, can_use_professional_voice_cloning: true }, 200)
  : u.pathname === "/v1/models" ? json([{ model_id: "eleven_v4", name: "Eleven v4", can_do_text_to_speech: true, languages: [] }], 200) : json({}, 200);
let p = await S.plan({ fresh: true });
ok(p.connected && p.credits.used === 100, "quét gói ở nhà cung cấp chính", p.note);
reset(boom);
S.spent(await tts());
ok((await S.plan()).credits.used === 100, "lượt do dự phòng phục vụ không trừ credit của gói ElevenLabs");
reset(() => new Response("a", { status: 200, headers: { "character-cost": "5" } }));
S.spent(await tts());
ok((await S.plan()).credits.used === 105, "lượt do ElevenLabs phục vụ vẫn trừ");
reset(() => { throw new TypeError("fetch failed"); });
p = await S.plan({ fresh: true });
ok(p.connected && p.tts.length === 1, "chính mất kết nối nhưng có dự phòng: giữ gói lần trước để đọc văn bản vẫn chạy", p.note);
delete process.env.SPEECH_FALLBACK_BASE;
p = await S.plan({ fresh: true });
ok(!p.connected, "không có dự phòng: như cũ, báo chưa kết nối");

globalThis.fetch = realFetch;
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
