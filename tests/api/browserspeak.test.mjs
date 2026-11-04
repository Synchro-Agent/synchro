// Giọng của trình duyệt (browserspeak.ts) với speechSynthesis giả: đường đi của người chưa có khóa ElevenLabs. Không kẹt ở "đang đọc" khi máy không có giọng,
// báo khi thiếu giọng tiếng Việt, dừng giữa chừng không bị tính là lỗi. Không cần máy chủ.
import { loadTs } from "../lib/ts.mjs";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let voices = [], spoken = [], cancels = 0, mode = "ok";
globalThis.window = globalThis;
globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
const synth = {
  getVoices: () => voices,
  cancel: () => { cancels++; },
  speak: (u) => {
    spoken.push(u);
    if (mode === "ok") setTimeout(() => { u.onstart?.(); u.onend?.(); }, 1);
    if (mode === "error") setTimeout(() => u.onerror?.({ error: "synthesis-failed" }), 1);
    if (mode === "cancel") setTimeout(() => u.onerror?.({ error: "canceled" }), 1);
    // mode "silent": máy không có giọng nào, trình duyệt không báo gì cả
  },
};
Object.defineProperty(globalThis, "speechSynthesis", { value: synth, writable: true, configurable: true });
const reset = () => { spoken = []; cancels = 0; mode = "ok"; voices = []; };
const { browserspeak: B } = await loadTs(["browserspeak"]);
const run = (chunks, lang = "vi-VN") => { const r = { ended: 0, failed: [], notes: [], started: [] }; B.readBrowser(chunks, { lang, onStart: (c) => r.started.push(c), onEnd: () => r.ended++, onFail: (m) => r.failed.push(m), onNote: (m) => r.notes.push(m) }); return r; };

console.log("1. Chọn giọng");
const vi = { lang: "vi-VN", name: "Linh" }, en = { lang: "en-US", name: "Sam" }, android = { lang: "vi_VN", name: "Android" };
ok(B.voiceFor([en, vi], "vi-VN").voice === vi && !B.voiceFor([en, vi], "vi-VN").missing, "đúng giọng tiếng Việt");
ok(B.voiceFor([android], "vi-VN").voice === android, "nhận cách viết vi_VN");
ok(B.voiceFor([{ lang: "en-GB" }], "en-US").voice?.lang === "en-GB", "cùng tiếng khác vùng vẫn dùng được");
ok(B.voiceFor([en], "vi-VN").missing === true && !B.voiceFor([en], "vi-VN").voice, "máy không có giọng tiếng Việt: biết là thiếu");
ok(B.voiceFor([], "vi-VN").missing === false, "danh sách chưa nạp: chưa kết luận là thiếu");

console.log("2. Đọc bình thường");
reset(); voices = [vi];
let r = run(["Một.", "Hai."]);
await sleep(15);
ok(spoken.length === 2 && spoken[0].voice === vi && spoken[0].lang === "vi-VN", "đọc từng đoạn bằng đúng giọng", JSON.stringify(spoken.map((u) => u.text)));
ok(r.ended === 1 && !r.failed.length, "báo xong đúng một lần", JSON.stringify(r));
ok(r.started.length === 2, "báo đoạn đang đọc để hiện chữ");
reset();
r = run([]);
ok(r.ended === 1 && !spoken.length, "không có gì để đọc: xong ngay");

console.log("3. Thiếu giọng");
reset(); voices = [en];
r = run(["Xin chào."]);
ok(r.notes.length === 1 && /chưa có giọng/.test(r.notes[0]), "báo máy thiếu giọng tiếng này", JSON.stringify(r.notes));
ok(spoken.length === 1, "vẫn đọc bằng giọng mặc định, không bỏ cuộc");
await sleep(10);
reset(); voices = [en];
r = run(["Xin chào."]);
ok(!r.notes.length, "chỉ báo một lần mỗi phiên");
await sleep(10);

console.log("4. Không đọc được");
reset(); mode = "error";
r = run(["Một.", "Hai."]);
await sleep(15);
ok(r.failed.length === 1 && r.ended === 0, "giọng lỗi: báo một lần, không báo xong", JSON.stringify(r));
const realSet = globalThis.setTimeout;
reset(); mode = "silent";
// Rút ngắn đồng hồ canh: máy im lặng hoàn toàn không để lại trạng thái đang đọc.
globalThis.setTimeout = (f, ms, ...a) => realSet(f, ms === B.START_GUARD ? 10 : ms, ...a);
r = run(["Một."]);
await sleep(30);
globalThis.setTimeout = realSet;
ok(r.failed.length === 1 && cancels >= 1, "máy không có giọng và không báo gì: hết giờ chờ thì báo lỗi", JSON.stringify(r));
reset();
const none = globalThis.window.speechSynthesis;
Object.defineProperty(globalThis, "speechSynthesis", { value: undefined, writable: true, configurable: true });
r = run(["Một."]);
ok(r.failed.length === 1 && /không hỗ trợ/.test(r.failed[0]), "trình duyệt không có đọc to: báo rõ", JSON.stringify(r));
Object.defineProperty(globalThis, "speechSynthesis", { value: none, writable: true, configurable: true });

console.log("5. Dừng");
reset(); mode = "silent";
r = run(["Một."]);
B.stopBrowserRead();
ok(cancels >= 1, "dừng hủy giọng đang đọc");
spoken[0].onend?.();
ok(r.ended === 0 && !r.failed.length, "đã dừng thì không báo gì thêm", JSON.stringify(r));
reset(); mode = "cancel";
r = run(["Một."]);
await sleep(10);
ok(!r.failed.length, "bị hủy không tính là lỗi", JSON.stringify(r));
reset(); mode = "silent";
const first = run(["Câu cũ."]), second = run(["Câu mới."]);
spoken[0].onend?.();
ok(first.ended === 0, "câu mới chen vào: câu cũ không báo xong thay", JSON.stringify(first));
spoken[1].onstart?.(); spoken[1].onend?.();
ok(second.ended === 1, "câu mới vẫn báo xong", JSON.stringify(second));

console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
