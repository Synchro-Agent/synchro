// Speech dùng thật (ElevenLabs giả lập trong npm run dev:mock): quét gói, ẩn / hiện tính năng theo gói, nhớ tính năng bị gói từ chối,
// đọc văn bản / hội thoại / chép lời / tiếng động / nhạc / lọc tạp âm / đổi giọng / căn phụ đề, giọng (thư viện, thiết kế, nhân bản),
// lồng tiếng chạy nền, Studio chỉ khi được duyệt, hết credit, khóa tạm cho chép lời trực tiếp và Voice Agent, đọc to trong chat, quyền.
const B = process.env.SYNCHRO_URL ?? "http://localhost:3200", M = "http://127.0.0.1:4010";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 500)); };
const client = (cookie = "") => {
  const f = async (method, p, body, o = {}) => {
    const form = body instanceof FormData;
    const r = await fetch(B + p, { method, headers: { ...(form ? {} : { "content-type": "application/json" }), origin: B, cookie, ...(o.headers ?? {}) }, body: body === undefined ? undefined : form ? body : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith("synchro_session=")) cookie = c.split(";")[0];
    if (o.raw) return r;
    let j = null; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
  return f;
};
const el = (body) => fetch(`${M}/_debug/el`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
const admin = client(process.env.SYNCHRO_ADMIN_COOKIE ?? "");
if (!process.env.SYNCHRO_ADMIN_COOKIE) await admin("POST", "/api/auth/login", { email: "admin@synchro.test", password: "synchro-mock-123" });
const wav = () => new Blob([Buffer.from("RIFF0000WAVEfmt mock-audio")], { type: "audio/wav" });

// Gắn khóa ElevenLabs giả lập (dev:mock đã gắn sẵn; bộ khác có thể đã đổi khóa) và bắt đầu ở gói Free sạch.
await admin("POST", "/api/admin/apikeys", { id: "elevenlabs", kind: "elevenlabs", key: "sk_mock_eleven_0001", baseUrl: `${M}/elevenlabs` });
await el({ tier: "free", studio: false, lockMusic: false, used: 0, reset: true });

console.log("1. Quét gói Free");
let p = (await admin("GET", "/api/speech/plan?fresh=1")).j;
ok(p?.connected && p.readPlan && p.tier === "free" && p.credits.limit === 10000 && p.voices.limit === 3, "đọc đúng gói, credit, chỗ lưu giọng", JSON.stringify(p).slice(0, 300));
ok(p.features.tts && p.features.stt && p.features.sfx && p.features.music && p.features.dub && p.features.design, "gói Free có đọc, chép lời, tiếng động, nhạc, lồng tiếng, thiết kế giọng");
ok(!p.features.ivc && !p.features.pvc && !p.features.dubClean, "gói Free ẩn nhân bản và lồng tiếng không watermark");
ok(!p.features.podcast && !p.features.book, "Studio chưa được ElevenLabs duyệt → ẩn podcast, sách nói");
ok(!p.formats.some((f) => f.id === "mp3_44100_192" || f.id === "wav_44100") && p.formats.some((f) => f.id === "mp3_44100_128"), "định dạng chất lượng cao chỉ hiện ở gói cao hơn");
ok(p.tts.some((m) => m.id === "eleven_v4" && m.max === 10000) && p.sts.length > 0, "model đọc và đổi giọng lấy từ ElevenLabs, giới hạn ký tự theo gói", JSON.stringify(p.tts.slice(0, 2)));

console.log("2. Giọng");
let r = await admin("GET", "/api/speech/voices");
const mine = r.j?.voices ?? [];
const ngan = mine.find((v) => v.langCode === "vi");
ok(r.s === 200 && mine.length >= 5 && ngan?.gender === "Nữ" && ngan.preview, "giọng của tài khoản, nhãn tiếng Việt, có bản nghe thử", JSON.stringify(mine[0]));
r = await admin("GET", "/api/speech/voices?lib=1&lang=vi");
const lib = r.j?.voices ?? [];
ok(r.s === 200 && lib.length >= 3 && lib.every((v) => v.free !== false), "thư viện ở gói Free chỉ có giọng cho phép người dùng miễn phí", JSON.stringify(lib.map((v) => [v.name, v.free])));
r = await admin("POST", "/api/speech/voices/add", { owner: lib[0].owner, id: lib[0].id, name: lib[0].name });
ok(r.s === 200 && r.j.voiceId && r.j.credits, "thêm giọng thư viện vào tài khoản", JSON.stringify(r.j));
p = (await admin("GET", "/api/speech/plan?fresh=1")).j;
ok(p.voices.used === 1, "dùng một chỗ lưu giọng", JSON.stringify(p.voices));

console.log("3. Đọc văn bản và lịch sử");
const viIds = ((await admin("GET", "/api/speech/voices")).j?.voices ?? []).filter((v) => v.langCode === "vi").map((v) => v.id);
r = await admin("POST", "/api/speech/tts", { text: "Xin chào, đây là bản đọc thử.", model: "eleven_v4", settings: { stability: 0.4, speed: 1.1 } });
const item = r.j?.item;
ok(r.s === 200 && item?.url && viIds.includes(item.meta.voice) && item.meta.cost === 29 && r.j.credits.used >= 29, "tạo được âm thanh, tự chọn giọng tiếng Việt, trừ đúng credit", JSON.stringify(r.j).slice(0, 300));
const f = await admin("GET", item.url, undefined, { raw: true });
const buf = Buffer.from(await f.arrayBuffer());
ok(f.status === 200 && /audio/.test(f.headers.get("content-type")) && buf.subarray(0, 4).toString() === "RIFF", "tải được tệp âm thanh");
const part = await admin("GET", item.url, undefined, { raw: true, headers: { range: "bytes=0-99" } });
ok(part.status === 206 && (await part.arrayBuffer()).byteLength === 100, "tua được (Range)");
ok((await admin("GET", "/api/speech/items?kinds=tts")).j?.items?.[0]?.id === item.id, "nằm trong lịch sử của người tạo");
r = await admin("POST", "/api/speech/tts", { text: "x".repeat(10001) });
ok(r.s === 400 && /10\.000/.test(r.j.error), "quá giới hạn ký tự mỗi lần của gói → báo rõ", JSON.stringify(r.j));
r = await admin("POST", "/api/speech/tts", { text: "Định dạng cao", format: "mp3_44100_192" });
ok(r.s === 200 && r.j.item.meta.format === "mp3_44100_128", "định dạng gói chưa có → dùng định dạng mặc định thay vì lỗi", JSON.stringify(r.j?.item?.meta));
r = await admin("POST", "/api/speech/dialogue", { lines: [{ text: "Chào bạn!", voice: mine[0].id, name: mine[0].name }, { text: "Chào lại nhé.", voice: mine[1].id, name: mine[1].name }] });
ok(r.s === 200 && r.j.item.kind === "dialogue" && r.j.item.meta.speakers.length === 2, "hội thoại hai giọng", JSON.stringify(r.j).slice(0, 200));

console.log("4. Chép lời, căn phụ đề, âm thanh");
let fd = new FormData(); fd.set("file", wav(), "phong-van.wav"); fd.set("diarize", "true"); fd.set("entities", "true");
r = await admin("POST", "/api/speech/stt", fd);
ok(r.s === 200 && r.j.data.words.length > 20 && r.j.item.meta.speakers.length === 2 && r.j.data.entities.length === 2 && r.j.item.url, "chép lời có người nói, mốc thời gian, thực thể, giữ âm thanh để phát lại", JSON.stringify(r.j).slice(0, 300));
const sttId = r.j.item.id;
r = await admin("GET", `/api/speech/items?id=${sttId}`);
ok(r.s === 200 && r.j.data.words.length > 20, "mở lại bản chép lời từ lịch sử");
fd = new FormData(); fd.set("url", "https://example.com/a.mp3"); fd.set("redact", "true"); fd.set("entities", "true");
r = await admin("POST", "/api/speech/stt", fd);
ok(r.s === 200 && /\{PERSON_NAME\}/.test(r.j.data.text) && !r.j.item.url, "chép từ liên kết, che thông tin nhạy cảm", JSON.stringify(r.j?.data?.text));
fd = new FormData(); fd.set("file", wav(), "bai-hat.wav"); fd.set("text", "Chào mừng bạn đến với Synchro");
r = await admin("POST", "/api/speech/align", fd);
ok(r.s === 200 && r.j.data.words.length === 6 && r.j.data.words[1].s > 0, "căn phụ đề từng từ", JSON.stringify(r.j?.data));
r = await admin("POST", "/api/speech/sfx", { text: "Mưa rơi trên mái tôn", duration: 3, loop: true });
ok(r.s === 200 && r.j.item.kind === "sfx" && r.j.item.meta.loop === true, "tiếng động");
fd = new FormData(); fd.set("file", wav(), "on-ao.wav");
r = await admin("POST", "/api/speech/isolate", fd);
ok(r.s === 200 && r.j.item.kind === "isolate", "lọc tạp âm");
fd = new FormData(); fd.set("file", wav(), "giong.wav"); fd.set("voice", mine[0].id); fd.set("voiceName", mine[0].name);
r = await admin("POST", "/api/speech/changer", fd);
ok(r.s === 200 && r.j.item.kind === "changer", "đổi giọng");
r = await admin("POST", "/api/speech/music", { prompt: "Nhạc lo-fi để học", seconds: 10 });
ok(r.s === 200 && r.j.item.kind === "music", "tạo nhạc");

console.log("5. Gói từ chối một tính năng → nhớ và ẩn");
await el({ lockMusic: true });
r = await admin("POST", "/api/speech/music", { prompt: "Nhạc nền", seconds: 10 });
ok(r.s === 403 && r.j.code === "plan", "ElevenLabs báo gói chưa có → lỗi rõ ràng", JSON.stringify(r.j));
p = (await admin("GET", "/api/speech/plan")).j;
ok(p.features.music === false && p.locked.music, "nhạc bị ẩn ngay, nhớ lý do", JSON.stringify(p.locked));
p = (await admin("GET", "/api/speech/plan?fresh=1")).j;
ok(p.features.music === false, "quét lại gói vẫn nhớ (cùng gói)");
r = await admin("POST", "/api/speech/music", { prompt: "Nhạc nền" });
ok(r.s === 403 && r.j.code === "plan", "gọi thẳng API cũng bị chặn ở Synchro");

console.log("6. Thiết kế giọng, nhân bản theo gói");
r = await admin("POST", "/api/speech/design", { desc: "Nữ miền Nam, ngoài 20 tuổi, giọng ngọt, nói nhanh" });
ok(r.s === 200 && r.j.previews.length === 3 && r.j.previews[0].audio.startsWith("data:audio/"), "thiết kế cho 3 bản nghe thử", JSON.stringify(r.j).slice(0, 160));
r = await admin("POST", "/api/speech/voices/save", { id: r.j.previews[1].id, name: "Cô gái miền Tây", desc: "Nữ miền Nam, ngoài 20 tuổi, giọng ngọt" });
ok(r.s === 200 && r.j.voice.category === "generated", "lưu bản ưng ý vào tài khoản", JSON.stringify(r.j));
const designed = r.j.voice.id;
r = await admin("POST", "/api/speech/remix", { voice: designed, desc: "trầm hơn, nói chậm" });
ok(r.s === 200 && r.j.previews.length === 3, "remix giọng tự tạo");
fd = new FormData(); fd.set("name", "Giọng tôi"); fd.append("files", wav(), "mau.wav");
r = await admin("POST", "/api/speech/ivc", fd);
ok(r.s === 403 && r.j.code === "plan", "gói Free không nhân bản được (Synchro chặn trước khi gọi)", JSON.stringify(r.j));

console.log("7. Lồng tiếng chạy nền");
fd = new FormData(); fd.set("url", "https://youtube.com/watch?v=abc"); fd.set("target", "en"); fd.set("watermark", "false");
r = await admin("POST", "/api/speech/dub", fd);
ok(r.s === 200 && r.j.item.meta.status === "dubbing" && r.j.item.meta.targetName === "Tiếng Anh", "gói Free tự gắn watermark, bắt đầu lồng tiếng", JSON.stringify(r.j));
const dub = r.j.item.id;
r = await admin("GET", `/api/speech/dub?id=${dub}`);
ok(r.s === 200 && r.j.item.meta.status === "dubbing", "lần hỏi đầu: đang xử lý");
r = await admin("GET", `/api/speech/dub?id=${dub}`);
ok(r.s === 200 && r.j.item.meta.status === "dubbed" && r.j.item.url, "xong: có tệp để nghe / tải", JSON.stringify(r.j));
r = await admin("POST", "/api/speech/podcast", { source: { type: "text", text: "Nội dung" }, mode: "conversation", host: mine[0].id, guest: mine[1].id });
ok(r.s === 403, "podcast bị chặn khi tài khoản chưa có Studio");

console.log("8. Nâng gói → tính năng tự hiện");
await el({ tier: "creator", studio: true, lockMusic: false });
p = (await admin("GET", "/api/speech/plan?fresh=1")).j;
ok(p.tierName === "Creator" && p.features.ivc && p.features.pvc && p.features.dubClean && p.features.podcast && p.features.book && p.features.music, "gói Creator + Studio: nhân bản, Studio, nhạc (khóa cũ bỏ khi đổi gói)", JSON.stringify(p.features));
ok(p.formats.some((f) => f.id === "mp3_44100_192") && !p.formats.some((f) => f.id === "wav_44100"), "MP3 192 kbps hiện từ Creator, WAV 44,1 kHz vẫn cần Pro");
fd = new FormData(); fd.set("name", "Giọng tôi"); fd.append("files", wav(), "mau.wav"); fd.set("denoise", "true");
r = await admin("POST", "/api/speech/ivc", fd);
ok(r.s === 200 && r.j.voiceId, "nhân bản nhanh", JSON.stringify(r.j));
r = await admin("POST", "/api/speech/podcast", { source: { type: "url", url: "https://example.com/bai-viet" }, mode: "conversation", host: mine[0].id, guest: mine[1].id, length: "short" });
ok(r.s === 200 && r.j.item.meta.status === "converting", "podcast: bắt đầu", JSON.stringify(r.j));
const pod = r.j.item.id;
await admin("GET", `/api/speech/project?id=${pod}`);
r = await admin("GET", `/api/speech/project?id=${pod}`);
ok(r.s === 200 && r.j.item.meta.status === "done" && r.j.item.url, "podcast: xong, có âm thanh", JSON.stringify(r.j));

console.log("9. Hết credit");
await el({ tier: "free", studio: false, used: 9990 });
r = await admin("POST", "/api/speech/tts", { text: "Câu này dài hơn số credit còn lại." });
ok(r.s === 402 && r.j.code === "quota" && /hết credit/.test(r.j.error), "báo hết credit kèm ngày hồi lại", JSON.stringify(r.j));
await el({ used: 0 });

console.log("10. Trò chuyện, chép lời trực tiếp, đọc to trong chat");
r = await admin("POST", "/api/speech/live/token", {});
ok(r.s === 200 && r.j.token && r.j.url === "ws://127.0.0.1:4010/elevenlabs/v1/speech-to-text/realtime", "khóa dùng một lần cho Scribe Realtime", JSON.stringify(r.j));
await fetch(`${M}/_debug/rt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tools: true }) });
r = await admin("POST", "/api/speech/agent/session", { model: "eleven_realtime_v1_mini", voice: ngan.id, prompt: "Bạn là trợ lý đặt lịch.", lang: "vi", eagerness: "high" });
let dbg = await fetch(`${M}/_debug/rt`).then((x) => x.json());
const sess = dbg.sessions.at(-1);
ok(r.s === 200 && r.j.value && sess?.model === "eleven_realtime_v1_mini" && sess.voice === ngan.id && sess.language === "vi" && /trợ lý đặt lịch/.test(sess.instructions), "Voice Agent: đúng model, giọng, ngôn ngữ, hướng dẫn", JSON.stringify(sess));
r = await admin("POST", "/api/voice/session", { lang: "vi", voice: ngan.id });
dbg = await fetch(`${M}/_debug/rt`).then((x) => x.json());
ok(r.s === 200 && r.j.value && dbg.sessions.at(-1).language === "vi" && dbg.sessions.at(-1).voice === ngan.id, "trò chuyện bằng giọng nói nghe đúng tiếng Việt, dùng giọng đã chọn", JSON.stringify(dbg.sessions.at(-1)));
const sp = await admin("POST", "/api/speech/speak", { text: "Đây là **câu trả lời** có `code`.", speed: 1.1 }, { raw: true });
ok(sp.status === 200 && /audio/.test(sp.headers.get("content-type")) && sp.headers.get("x-accel-buffering") === "no" && (await sp.arrayBuffer()).byteLength > 1000, "đọc to câu trả lời bằng giọng ElevenLabs (phát dần)");
r = await admin("POST", "/api/speech/live/save", { kind: "call", lines: [{ who: "ai", text: "Xin chào" }, { who: "me", text: "Chào bạn" }], seconds: 12 });
ok(r.s === 200 && r.j.item.kind === "call" && r.j.item.meta.lines === 2, "lưu lời thoại cuộc gọi thử vào lịch sử");

console.log("11. Quyền");
const anon = client();
ok((await anon("GET", "/api/speech/plan")).s === 401, "chưa đăng nhập → 401");
const member = client();
await member("POST", "/api/auth/signup", { email: "sp-member@synchro.test", password: "Member-pass-123", profile: { fullName: "Speech Member", birthDate: "2000-01-01" } });
await member("POST", "/api/auth/login", { email: "sp-member@synchro.test", password: "Member-pass-123" });
ok((await member("GET", `/api/speech/items?id=${sttId}`)).s === 404 && (await member("GET", `/api/speech/file?id=${item.id}`, undefined, { raw: true })).status === 404, "không xem được sản phẩm của người khác");
ok((await member("DELETE", `/api/speech/voices?id=${designed}`)).s === 403, "thành viên không xóa được giọng của tài khoản ElevenLabs");
ok((await admin("POST", "/api/speech/tts", { text: "x" }, { headers: { origin: "https://evil.example" } })).s === 403, "POST khác nguồn → 403");
r = await admin("DELETE", `/api/speech/voices?id=${designed}`);
ok(r.s === 200, "quản trị viên xóa được giọng tự tạo");
r = await admin("DELETE", `/api/speech/items?id=${item.id}`);
ok(r.s === 200 && (await admin("GET", item.url, undefined, { raw: true })).status === 404, "xóa sản phẩm xóa luôn tệp");

await el({ tier: "free", studio: false, lockMusic: false, used: 0, reset: true });
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
