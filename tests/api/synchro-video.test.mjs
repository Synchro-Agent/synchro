// Phần thuần của lệnh synchro-video (workspace/remotion/cli/lib.mjs): đọc tham số, chia đoạn và dựng tiếp, số tab theo cgroup, đường dẫn an toàn,
// chuyển phụ đề (whisper -ojf, edge-tts WordBoundary, .srt) thành Caption[]; và việc nhận ra lần chạy dựng video để xếp hàng riêng (workspace/safefs.mjs).
// Không cần máy chủ, không cần Remotion: phần dựng thật được kiểm ở bước tự kiểm tra lúc build image (synchro-video selftest).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as L from "../../workspace/remotion/cli/lib.mjs";
import { createRunQueue, isMediaRun, safeReadIn } from "../../workspace/safefs.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const throws = (f, re) => { try { f(); return false; } catch (e) { return e instanceof L.UsageError && (!re || re.test(e.message)); } };

console.log("1. Tham số dòng lệnh");
{
  const r = L.parseArgs(["render", "tiktok", "props.json", "outputs/a.mp4", "--fps", "30", "--size", "1080x1920", "--budget=120", "--crf", "22"]);
  ok(r.cmd === "render" && r.pos.join() === "tiktok,props.json,outputs/a.mp4" && r.opts.fps === 30 && r.opts.size === "1080x1920" && r.opts.budget === 120 && r.opts.crf === 22, "render đủ tham số", JSON.stringify(r));
  ok(L.parseArgs(["render", "audiogram", "p.json"]).opts.fps === undefined, "không ghi --fps thì để schema đặt mặc định (60)");
  ok(L.parseArgs(["still", "next-tailwind", "p.json", "--at", "0.5,3,8"]).opts.at.join() === "0.5,3,8", "--at nhiều mốc");
  ok(L.parseArgs(["check", "github-unwrapped", "p.json", "--size", "Vertical"]).opts.size === "vertical", "--size tên sẵn, không phân biệt hoa thường");
  ok(L.parseArgs([]).cmd === "help" && L.parseArgs(["--help"]).cmd === "help", "không tham số: in hướng dẫn");
  ok(throws(() => L.parseArgs(["render", "youtube", "p.json"]), /Không có mẫu "youtube"/), "mẫu không có");
  ok(throws(() => L.parseArgs(["dung", "tiktok"]), /Lệnh không có/), "lệnh không có");
  ok(throws(() => L.parseArgs(["render", "tiktok", "p.json", "--fps", "25"]), /30 hoặc 60/), "fps chỉ 30 hoặc 60");
  ok(throws(() => L.parseArgs(["render", "tiktok", "p.json", "--size", "1081x1920"]), /số chẵn/), "kích thước lẻ bị từ chối");
  ok(throws(() => L.parseArgs(["render", "tiktok", "p.json", "--size", "8k"]), /RỘNGxCAO/), "kích thước sai dạng");
  ok(throws(() => L.parseArgs(["render", "tiktok", "p.json", "--size", "3840x3840"]), /3840x2160/), "khung quá lớn cho 2 GB bộ nhớ bị từ chối (3840x3840 bị giết vì hết bộ nhớ)");
  ok(L.parseArgs(["render", "tiktok", "p.json", "--size", "3840x2160"]).opts.size === "3840x2160" && L.parseArgs(["render", "tiktok", "p.json", "--size", "2160x3840"]).opts.size === "2160x3840", "4K ngang và dọc vẫn được");
  // schemas.mjs cần zod (chỉ có trong image): kiểm bằng nội dung tệp.
  ok(/if \(w \* h > 3840 \* 2160\) throw/.test(fs.readFileSync(new URL("../../workspace/remotion/src/schemas.mjs", import.meta.url), "utf8")), "schema (props.size) cũng chặn khung quá 3840x2160");
  ok(throws(() => L.parseArgs(["render", "tiktok", "p.json", "out.mov"]), /\.mp4/), "tệp ra phải là .mp4");
  ok(throws(() => L.parseArgs(["render", "tiktok", "p.json", "--budget", "5"]), /20–3600/), "ngân sách quá nhỏ");
  ok(throws(() => L.parseArgs(["render", "tiktok", "p.json", "--crf", "50"]), /12–35/), "crf ngoài khoảng");
  ok(throws(() => L.parseArgs(["render", "tiktok", "p.json", "--lang", "vi"]), /không nhận --lang/), "cờ không thuộc lệnh");
  ok(throws(() => L.parseArgs(["render", "tiktok", "p.json", "--fps"]), /Thiếu giá trị/), "cờ thiếu giá trị");
  ok(throws(() => L.parseArgs(["render", "tiktok"]), /cần 2–3 tham số/), "thiếu tệp props");
  ok(throws(() => L.parseArgs(["captions", "a.mp3", "a.srt"]), /\.json/), "phụ đề ra phải là .json");
  ok(throws(() => L.parseArgs(["captions", "a.mp3", "a.json", "--lang", "vietnamese"]), /mã 2 chữ/), "--lang mã 2 chữ");
  ok(L.parseArgs(["selftest", "--skip-whisper"]).opts["skip-whisper"] === true, "cờ không giá trị");
  ok(L.TEMPLATE_IDS.join() === "tiktok,next-tailwind,audiogram,github-unwrapped", "đúng 4 mẫu, đúng tên chủ dịch vụ nêu");
  ok(L.DEFAULT_FPS === 60 && L.EXIT_RESUME === 75 && L.DEFAULT_BUDGET === 170, "mặc định 60 fps, mã dựng tiếp 75, ngân sách 170 giây");
}

console.log("2. Chia đoạn và dựng tiếp");
{
  const p = L.planChunks(1800, 60, 8);
  ok(p.length === 4 && p[0].start === 0 && p[0].end === 479 && p[3].end === 1799, "30 giây 60 fps = 4 đoạn 8 giây (đoạn cuối 6 giây)", JSON.stringify(p));
  ok(p.every((c, i) => i === 0 || c.start === p[i - 1].end + 1), "các đoạn liền nhau, không chồng, không hở");
  const q = L.planChunks(500, 60, 8);
  ok(q.length === 1 && q[0].end === 499, "đoạn cuối quá ngắn (20 khung) gộp vào đoạn trước", JSON.stringify(q));
  ok(L.planChunks(1, 30).length === 1, "video 1 khung");
  ok(p[2].file === "chunk-0002.ts", "tên tệp đoạn cố định để lần sau nhận ra");
  ok(L.pendingChunks(p, new Set(["chunk-0000.ts", "chunk-0002.ts"])).map((c) => c.i).join() === "1,3", "chỉ dựng lại các đoạn chưa xong");
  ok(L.shouldContinue({ elapsedSec: 500, budgetSec: 170, doneThisRun: 0, framesPerSec: 0, nextFrames: 480 }), "lần chạy nào cũng dựng ít nhất một đoạn");
  ok(!L.shouldContinue({ elapsedSec: 120, budgetSec: 170, doneThisRun: 2, framesPerSec: 10, nextFrames: 480 }), "không đủ ngân sách cho đoạn sau: dừng (mã 75)");
  ok(L.shouldContinue({ elapsedSec: 40, budgetSec: 170, doneThisRun: 1, framesPerSec: 12, nextFrames: 480 }), "còn đủ ngân sách: dựng tiếp");
  ok(L.stateKey(["a", { x: 1 }]) === L.stateKey(["a", { x: 1 }]) && L.stateKey(["a", { x: 1 }]) !== L.stateKey(["a", { x: 2 }]), "đổi props là thư mục đoạn mới, giữ nguyên là dùng lại");
}

console.log("3. Số tab theo cgroup");
{
  const files = { "/sys/fs/cgroup/cpu.max": "200000 100000\n", "/sys/fs/cgroup/memory.max": String(2 * 1024 ** 3), "/sys/fs/cgroup/memory.current": String(200 * 1024 ** 2) };
  const cg = L.readCgroup((p) => files[p] ?? null);
  ok(cg.cpuQuota === 2 && cg.memMax === 2 * 1024 ** 3, "đọc cpu.max và memory.max", JSON.stringify(cg));
  ok(L.pickConcurrency({ cpus: 2, ...cg }) === 2, "2 vCPU, 2 GB còn trống: 2 tab");
  ok(L.pickConcurrency({ cpus: 8, cpuQuota: null }) === 2, "máy nhiều CPU vẫn tối đa 2 tab");
  ok(L.pickConcurrency({ cpus: 4, cpuQuota: 1 }) === 1, "--cpus 1: 1 tab");
  ok(L.pickConcurrency({ cpus: 2, cpuQuota: 2, memMax: 2 * 1024 ** 3, memCurrent: 900 * 1024 ** 2 }) === 1, "còn dưới 1,5 GB bộ nhớ: 1 tab");
  ok(L.readCgroup((p) => (p.endsWith("cpu.max") ? "max 100000" : "max")).cpuQuota === null, "không giới hạn (max)");
  ok(L.pickConcurrency({ cpus: 2, ...cg, width: 3840, height: 2160 }) === 1, "khung 4K: 1 tab dù còn bộ nhớ");
  ok(L.pickConcurrency({ cpus: 2, ...cg, width: 1920, height: 1080 }) === 2, "Full HD: vẫn 2 tab");
  const oom = "Error: FFmpeg quit with code 1 (signal SIGKILL) while piping frame 24. Stderr: ffmpeg version n7.1 Copyright (c) 2000-2024 the FFmpeg developers\n  configuration: --prefix=remotion --enable-gpl " + "--enable-x ".repeat(300) + "\n  libavutil 59.";
  ok(L.isOomError(oom) && L.isOomError("whisper-cli lỗi (mã SIGKILL): ") && !L.isOomError("Error: Composition not found"), "nhận ra lỗi hết bộ nhớ (SIGKILL) của Remotion / ffmpeg");
  const t = L.trimError(oom);
  ok(t.length < 800 && t.startsWith("Error: FFmpeg quit") && !t.includes("--enable-x --enable-x"), "lỗi in gọn, bỏ bản cấu hình ffmpeg", t.length);
  ok(L.pickBudget(undefined, undefined) === 170 && L.pickBudget(undefined, "120") === 95 && L.pickBudget(undefined, "600") === 170 && L.pickBudget(300, "600") === 300 && L.pickBudget(3600, "30") === 10,
    "ngân sách luôn dưới thời gian lần chạy (120 giây → 95 giây, thoát 75 trước khi bị ngắt)");
}

console.log("4. Đường dẫn tệp an toàn");
{
  const T = fs.mkdtempSync(path.join(os.tmpdir(), "svideo-"));
  const root = path.join(T, "work"), outside = path.join(T, "secret.txt");
  fs.mkdirSync(path.join(root, "inputs"), { recursive: true });
  fs.writeFileSync(path.join(root, "inputs", "a.mp3"), "x");
  fs.writeFileSync(outside, "bí mật");
  fs.symlinkSync(outside, path.join(root, "inputs", "lienket.mp3"));
  fs.symlinkSync(T, path.join(root, "thumuc"));
  ok(L.safeResolve(root, "inputs/a.mp3") === fs.realpathSync(path.join(root, "inputs", "a.mp3")), "tệp trong thư mục làm việc");
  ok(throws(() => L.safeResolve(root, "../secret.txt"), /"\.\."/), "chặn ..");
  ok(throws(() => L.safeResolve(root, "/etc/passwd"), /tuyệt đối/), "chặn đường dẫn tuyệt đối");
  ok(throws(() => L.safeResolve(root, "inputs/lienket.mp3"), /ra ngoài/), "chặn liên kết tượng trưng trỏ ra ngoài");
  ok(throws(() => L.safeResolve(root, "thumuc/secret.txt"), /ra ngoài/), "chặn thư mục liên kết ra ngoài");
  ok(throws(() => L.safeResolve(root, "https://x.com/a.mp4"), /Tải tệp về trước/), "không nhận URL: tải về trước");
  ok(throws(() => L.safeResolve(root, "inputs/khong-co.mp3"), /Không thấy tệp/), "tệp không có");
  const rr = fs.realpathSync(root);
  ok(L.safeOut(root, "outputs/video.mp4", "outputs") === path.join(rr, "outputs", "video.mp4"), "tệp ra trong outputs/ (thư mục chưa có vẫn được)");
  ok(L.safeOut(root, "outputs/_preview", "outputs") === path.join(rr, "outputs", "_preview"), "thư mục ảnh xem trước trong outputs/");
  ok(throws(() => L.safeOut(root, "video.mp4", "outputs"), /outputs\/.*tới tay người dùng/), "render ra ngoài outputs/ bị từ chối (người dùng không nhận được)");
  ok(throws(() => L.safeOut(root, "../../../tmp/esc", "outputs"), /"\.\."/), "--out có .. bị từ chối");
  ok(throws(() => L.safeOut(root, "/tmp/abs.json"), /tương đối/), "tệp phụ đề ra đường dẫn tuyệt đối bị từ chối");
  ok(L.safeOut(root, "phu-de.json") === path.join(rr, "phu-de.json"), "tệp phụ đề ra trong thư mục làm việc");
  fs.symlinkSync(T, path.join(root, "outputs"));
  ok(throws(() => L.safeOut(root, "outputs/video.mp4", "outputs"), /liên kết/), "outputs/ là liên kết ra ngoài: từ chối");
  ok(throws(() => L.safeOut(root, "thumuc/a.json"), /liên kết/), "thư mục liên kết ra ngoài: từ chối");
  fs.unlinkSync(path.join(root, "outputs")); fs.mkdirSync(path.join(root, "outputs"));
  fs.symlinkSync(outside, path.join(root, "outputs", "x.mp4"));
  ok(throws(() => L.safeOut(root, "outputs/x.mp4", "outputs"), /liên kết/), "tệp ra là liên kết có sẵn: từ chối");
  fs.writeFileSync(path.join(root, "render.sh"), "synchro-video render tiktok p.json");
  ok(safeReadIn(root, "render.sh")?.toString() === "synchro-video render tiktok p.json" && safeReadIn(root, "thumuc/secret.txt") === null && safeReadIn(root, "outputs/x.mp4") === null && safeReadIn(root, "../secret.txt") === null,
    "đọc script trong thư mục giữ lại, không đi theo liên kết");
  fs.rmSync(T, { recursive: true, force: true });
  const seen = [];
  const m = L.mapFiles({ video: "a.mp4", images: ["b.jpg", "c.jpg"], music: { src: "n.mp3" }, brand: { logo: "l.png", name: "logo.png" }, scenes: [{ type: "screenshot", image: "s.png", title: "image" }], captions: "phu-de.json" }, (v, at) => { seen.push(at); return `U(${v})`; });
  ok(m.video === "U(a.mp4)" && m.images[1] === "U(c.jpg)" && m.music.src === "U(n.mp3)" && m.brand.logo === "U(l.png)" && m.brand.name === "logo.png" && m.scenes[0].image === "U(s.png)" && m.scenes[0].title === "image" && m.captions === "phu-de.json",
    "chỉ đổi trường tệp của schema (chữ thường giữ nguyên)", JSON.stringify(m));
  ok(seen.includes("scenes[0].image") && seen.includes("images[1]"), "báo đúng đường dẫn JSON của trường", seen.join());
}

console.log("5. Phụ đề → Caption[]");
{
  const wj = { transcription: [{ tokens: [
    { text: "[_BEG_]", offsets: { from: 0, to: 0 }, t_dtw: -1, p: 1 },
    { text: " Xin", offsets: { from: 0, to: 300 }, t_dtw: 12, p: 0.9 },
    { text: " ch", offsets: { from: 300, to: 420 }, t_dtw: 35, p: 0.8 },
    { text: "ào", offsets: { from: 420, to: 600 }, t_dtw: 48, p: 0.8 },
    { text: " các", offsets: { from: 600, to: 800 }, t_dtw: 66, p: 0.7 },
    { text: "[_TT_40]", offsets: { from: 800, to: 800 }, t_dtw: -1, p: 1 },
  ] }] };
  const c = L.whisperToCaptions(wj);
  ok(c.map((x) => x.text).join("|") === " Xin| chào| các", "token đặc biệt bị bỏ, token tách giữa từ được ghép lại", c.map((x) => x.text).join("|"));
  ok(c[1].startMs === 300 && c[1].endMs === 600 && c[0].timestampMs === 120, "thời gian theo offsets, t_dtw đổi ra mili giây", JSON.stringify(c[1]));
  const wb = L.wordBoundaryToCaptions([{ type: "WordBoundary", offset: 1_000_000, duration: 4_000_000, text: "Ngủ" }, { type: "SentenceBoundary", offset: 0, duration: 1, text: "x" }, { offset: 5_500_000, duration: 2_000_000, text: "đủ" }]);
  ok(wb.length === 2 && wb[0].text === "Ngủ" && wb[0].startMs === 100 && wb[0].endMs === 500 && wb[1].text === " đủ" && wb[1].startMs === 550, "edge-tts WordBoundary (đơn vị 100 ns)", JSON.stringify(wb));
  ok(L.wordBoundaryToCaptions({ words: [{ offset: 0, duration: 10_000, text: "a" }] }).length === 1, "nhận cả dạng {words: [...]}");
  ok(throws(() => L.wordBoundaryToCaptions({ foo: 1 }), /WordBoundary/), "dạng lạ báo lỗi rõ");
  const srt = "1\n00:00:00,000 --> 00:00:02,000\nNgủ đủ bảy tiếng\n\n2\r\n00:00:02,500 --> 00:00:04,000\r\n<i>mỗi đêm</i>\r\n";
  const s = L.srtToCaptions(srt);
  ok(s.length === 6 && s[0].text === "Ngủ" && s[1].text === " đủ" && s[4].text === " mỗi" && s[4].startMs === 2500 && Math.round(s[5].endMs) === 4000, "srt chia từng từ, bỏ thẻ, đọc cả \\r\\n", JSON.stringify(s.map((x) => [x.text, x.startMs, x.endMs])));
  ok(s.every((x, i) => i === 0 || x.startMs >= s[i - 1].startMs), "thời gian tăng dần");
  ok(L.srtToCaptions(srt, { words: false }).length === 2, "giữ nguyên câu khi words=false");
  const sh = L.shiftCaptions([{ text: "a", startMs: 1000, endMs: 1500, timestampMs: 1200 }, { text: "b", startMs: 5000, endMs: 6000, timestampMs: null }, { text: "c", startMs: 9000, endMs: 9500, timestampMs: null }], 4, 8);
  ok(sh.length === 1 && sh[0].text === "b" && sh[0].startMs === 1000 && sh[0].endMs === 2000, "audiogram clip: cắt và dời phụ đề", JSON.stringify(sh));
  ok(L.captionsEndSec(s) === 4, "thời lượng phụ đề");
}

console.log("6. Lỗi schema dễ đọc");
{
  const lines = L.formatIssues([{ code: "invalid_type", expected: "string", path: ["scenes", 2, "title"], message: "x" }, { code: "too_big", maximum: 6, path: ["scenes", 0, "items"], message: "x" }, { code: "invalid_value", values: ["fade", "slide"], path: ["transition"], message: "x" }]);
  ok(lines[0] === "props.scenes[2].title: sai kiểu (cần string)" && /tối đa 6/.test(lines[1]) && /fade, slide/.test(lines[2]), "chỉ đúng trường sai, tiếng Việt", lines.join(" / "));
}

console.log("7. Lần chạy dựng video xếp hàng riêng (mỗi máy một lần)");
{
  const b64 = (s) => Buffer.from(s).toString("base64");
  ok(isMediaRun({ files: [{ path: "main.sh", b64: b64("synchro-video render tiktok props.json outputs/a.mp4") }] }), "script bash gọi render");
  ok(isMediaRun({ files: [{ path: "main.py", b64: b64("import subprocess\nsubprocess.run(['synchro-video', 'still', 'audiogram', 'p.json'])") }] }), "Python gọi bằng danh sách tham số");
  ok(isMediaRun({ files: [{ path: "main.py", b64: b64("os.system('synchro-video captions inputs/a.mp3 c.json')") }] }), "Python gọi qua os.system");
  ok(!isMediaRun({ files: [{ path: "main.sh", b64: b64("synchro-video schema tiktok; synchro-video check tiktok p.json") }] }), "schema / check nhẹ: không cần chỗ dựng");
  ok(!isMediaRun({ files: [{ path: "inputs/ghi-chu.txt", b64: b64("synchro-video render tiktok") }] }), "tệp dữ liệu (không phải script) không tính");
  ok(isMediaRun({ argv: ["bash", "-lc", "synchro-video render next-tailwind p.json"] }), "lệnh trong argv");
  ok(isMediaRun({ argv: ["node", "/opt/remotion/cli/synchro-video.mjs", "render", "tiktok", "p.json"] }), "gọi thẳng synchro-video.mjs bằng node");
  ok(isMediaRun({ argv: ["bash", "-lc", "node /opt/remotion/cli/synchro-video.mjs render tiktok p.json"] }), "node …/synchro-video.mjs render trong bash");
  ok(isMediaRun({ files: [{ path: "main.py", b64: b64('SV = "synchro-video"\nsubprocess.run([SV, "render", "tiktok", "p.json"])') }] }), "Python: tên lệnh trong biến");
  ok(isMediaRun({ argv: ["bash", "-lc", "CMD=render; synchro-video $CMD tiktok p.json"] }), "bash: lệnh con trong biến");
  ok(isMediaRun({ argv: ["bash", "-c", "bash render.sh"], readScript: (r) => (r === "render.sh" ? "synchro-video render tiktok p.json" : null) }), "script có sẵn trong thư mục giữ lại (lần trước ghi)");
  ok(!isMediaRun({ argv: ["bash", "-c", "bash render.sh"], readScript: () => null }), "script không có: không đoán bừa");
  ok(isMediaRun({ files: [{ path: "run.sh", b64: b64("python3 tools/make.py") }, { path: "tools/make.py", b64: b64("os.system('synchro-video still tiktok p.json')") }] , argv: ["bash", "run.sh"] }), "script gọi script khác gửi kèm");
  ok(!isMediaRun({ argv: ["bash", "-lc", "ls -la .synchro-video/ && du -sh .synchro-video"] }), "xem thư mục trạng thái .synchro-video/ không phải dựng");
  ok(!isMediaRun({ argv: ["bash", "-lc", "synchro-video words a.srt c.json && synchro-video example tiktok"] }), "words / example nhẹ: không cần chỗ dựng");
  const mq = createRunQueue({ max: 1, queue: 5, perUser: 5, waitMs: 2000, shortSec: 0 });
  const a = await mq.acquire("u1", 600);
  let got = false;
  const wait = mq.acquire("u2", 600).then((free) => { got = true; return free; });
  await new Promise((r) => setTimeout(r, 30));
  ok(!got && mq.running === 1 && mq.queued === 1, "lần dựng thứ hai chờ lần đầu");
  a();
  (await wait)();
  ok(got && mq.running === 0, "lần đầu xong thì lần sau chạy");
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
