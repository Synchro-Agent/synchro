// Đọc to ở trình duyệt (speak.ts) với fetch và Audio giả: đọc đủ mọi phần theo thứ tự, lỗi giữa chừng trả về phần chưa đọc, Dừng thì không đọc tiếp. Không cần máy chủ.
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let played = [], sent = [], failAt = -1, failWith = null, playFail = false;
class FakeAudio {
  constructor() { this.paused = false; }
  async play() { if (playFail) throw new Error("NotAllowedError"); played.push(this.src); const me = this.src; setTimeout(() => { if (this.src === me && !this.paused) this.onended?.(); }, 5); }
  pause() { this.paused = true; }
}
globalThis.Audio = FakeAudio;
globalThis.cancelAnimationFrame = () => {};
const blobs = new Map();
URL.createObjectURL = (b) => { const u = `blob:${blobs.size}`; blobs.set(u, b); return u; };
URL.revokeObjectURL = () => {};
globalThis.fetch = async (url, init) => {
  const b = JSON.parse(init.body);
  sent.push(b.text);
  if (sent.length - 1 === failAt) return new Response(JSON.stringify(failWith.body), { status: failWith.status, headers: { "content-type": "application/json" } });
  return new Response(new Blob(["x"]), { status: 200, headers: { "content-type": "audio/wav" } });
};
const reset = () => { played = []; sent = []; failAt = -1; failWith = null; playFail = false; };
const load = async () => (await loadTs(["speak", "voiceflow"]));

const long = Array.from({ length: 300 }, (_, i) => `Câu số ${i} nói về một chuyện đủ dài để đọc.`).join(" ");

console.log("1. Câu trả lời dài");
let { speak: S, voiceflow: V } = await load();
const parts = V.splitSpeech(long);
ok(parts.length >= 4, `chia thành ${parts.length} phần`, parts.length);
let v = await S.speakAI(long);
ok(!!v, "bắt đầu đọc");
ok((await v.done) === true, "đọc tới hết thì báo xong");
ok(sent.length === parts.length && sent.join(" ") === parts.join(" "), "gửi đủ mọi phần, đúng thứ tự", sent.length);
ok(played.length === parts.length, "phát đủ mọi phần", played.length);
ok(v.rest().length > 0 ? v.rest() === parts.at(-1) : true, "đọc xong thì nơi gọi không cần phần còn lại");

console.log("2. Lỗi giữa chừng");
reset();
failAt = 2; failWith = { status: 402, body: { error: "Đã hết credit", code: "quota" } };
v = await S.speakAI(long);
ok((await v.done) === false, "phần thứ ba lỗi: báo chưa xong, không giả vờ đã đọc hết");
ok(v.rest() === parts.slice(2).join(" "), "phần chưa đọc còn nguyên để giọng trình duyệt đọc nốt", v.rest().slice(0, 60));
ok(played.length === 2, "chỉ phát các phần đã lấy được", played.length);

console.log("3. Dừng");
reset();
v = await S.speakAI(long);
await sleep(2);
v.stop();
ok((await v.done) === false, "Dừng: báo chưa xong");
ok(v.rest() === "", "Dừng: không đọc nốt bằng giọng khác");
const n = played.length;
await sleep(30);
ok(played.length === n, "Dừng: không phát thêm phần nào", `${n} → ${played.length}`);

console.log("4. Không dùng được giọng AI");
reset();
playFail = true;
ok((await S.speakAI("Câu ngắn.")) === null, "trình duyệt chặn phát: trả null để dùng giọng trình duyệt");
reset();
failAt = 0; failWith = { status: 503, body: { error: "Chưa gắn khóa", code: "no_key" } };
ok((await S.speakAI("Câu ngắn.")) === null, "chưa gắn khóa ElevenLabs: trả null");
sent = [];
ok((await S.speakAI("Câu khác.")) === null && sent.length === 0, "cả phiên không hỏi lại", sent.length);

({ speak: S } = await load());
reset();
failAt = 0; failWith = { status: 429, body: { error: "Hết hạn mức hôm nay", code: "budget" } };
ok((await S.speakAI("Câu ngắn.")) === null && S.aiVoiceNote() === "Hết hạn mức hôm nay" && S.aiVoiceNote() === "", "hết hạn mức: có câu báo một lần");
sent = [];
ok((await S.speakAI("Câu khác.")) === null && sent.length === 0, "hết hạn mức: cả phiên dùng giọng trình duyệt", sent.length);

({ speak: S } = await load());
reset();
failAt = 0; failWith = { status: 402, body: { error: "Hết credit", code: "quota" } };
ok((await S.speakAI("Câu ngắn.")) === null, "hết credit: lần này giọng trình duyệt");
reset();
ok(!!(await S.speakAI("Câu ngắn.")), "hết credit: lần sau thử lại giọng AI");

console.log("5. Giọng đã lưu không còn dùng được");
{
  reset();
  const { speak: Sv } = await load();
  const voicesSent = [];
  const f0 = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const b = JSON.parse(init.body);
    voicesSent.push(b.voice ?? null);
    if (b.voice) return new Response(JSON.stringify({ error: "Giọng này chưa được gán cho tài khoản của bạn.", code: "voice" }), { status: 403, headers: { "content-type": "application/json" } });
    return new Response(new Blob(["x"]), { status: 200, headers: { "content-type": "audio/wav" } });
  };
  const sp = await Sv.speakAI("Một câu ngắn.", { voice: "giong-da-luu" });
  ok(!!sp && (await sp.done) === true, "vẫn đọc được bằng giọng AI mặc định");
  ok(voicesSent[0] === "giong-da-luu" && voicesSent[1] === null, "thử giọng đã lưu rồi bỏ giọng đó", voicesSent);
  ok(!Sv.aiVoiceOff(), "không tắt giọng AI cả phiên");
  globalThis.fetch = f0;
}
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
