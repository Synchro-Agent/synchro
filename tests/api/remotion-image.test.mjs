// Video Remotion trong image sandbox: ghim phiên bản và mã băm (workspace/Dockerfile, workspace/remotion/package*.json), setup.sh dựng lại image khi
// dự án đổi, 4 mẫu không mang tài sản có bản quyền riêng, hướng dẫn cho model (app/coderun.ts, app/videokit.ts) và khối video theo lượt.
// Không cần máy chủ. Phần dựng thật: bước "synchro-video selftest" lúc build image.
import fs from "node:fs";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 400)); };
const read = (p) => fs.readFileSync(p, "utf8");
const R = "workspace/remotion";
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (["node_modules", "bundle", ".synchro-video"].includes(e.name) ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));

console.log("1. Phiên bản ghim chính xác");
{
  const pkg = JSON.parse(read(`${R}/package.json`)), lock = JSON.parse(read(`${R}/package-lock.json`));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const rem = Object.entries(deps).filter(([k]) => k === "remotion" || k.startsWith("@remotion/"));
  ok(rem.length >= 10 && rem.every(([, v]) => v === "4.0.539"), "remotion và mọi @remotion/* đúng 4.0.539", JSON.stringify(rem));
  ok(Object.values(deps).every((v) => /^\d+\.\d+\.\d+$/.test(v)), "không có ^, ~, latest", JSON.stringify(deps));
  ok(deps.zod === "4.5.4" && deps.react === "19.3.1" && deps["react-dom"] === "19.3.1", "zod đúng bản Remotion 4.0.539 đòi, react 19.3.1");
  const lockRem = Object.entries(lock.packages).filter(([k]) => /node_modules\/(?:remotion|@remotion\/[^/]+)$/.test(k));
  ok(lockRem.length > 20 && lockRem.every(([, p]) => p.version === "4.0.539" && /^sha512-/.test(p.integrity ?? "")), "package-lock: mọi gói Remotion 4.0.539 có mã băm sha512");
  ok(lock.packages["node_modules/@remotion/compositor-linux-x64-gnu"]?.version === "4.0.539", "lockfile có bộ mã hóa cho Linux x64 (npm ci trong image)");
}

console.log("2. Dockerfile: tải về có mã băm, dựng sẵn, tự kiểm tra");
{
  const d = read("workspace/Dockerfile");
  ok(/remotion\.media\/chromium-headless-shell-linux-x64-157\.0\.8080\.0\.zip[\s\S]{0,200}7c4a2751b361aeb3cff3ed788fa18b7a0849371b983d478bb9205b6cc25a8c52/.test(d), "Chrome Headless Shell 157.0.8080.0 + sha256");
  ok(/whisper\.cpp\/archive\/refs\/tags\/v1\.9\.5\.tar\.gz[\s\S]{0,200}ff1a9053feb509ff9d7729703355541ae9690073a6b1c40eb692c962e0dc1720/.test(d), "whisper.cpp v1.9.5 + sha256");
  ok(/resolve\/5359861c739e955e79d9a303bcbc70fb988958b1\/ggml-small\.bin[\s\S]{0,200}1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b/.test(d), "mô hình ggml-small ghim revision + sha256");
  ok(d.includes("44dbfa01553d227bec76ba6446c5618870a76a4a3297f41630dde859d0650d02 ofl/bevietnampro/BeVietnamPro-ExtraBold.ttf") && d.includes("dd0ec461782da7f4a58698b431a67c455ced7c09deb9c40d7b47e61975d3ffdb ofl/bevietnampro/BeVietnamPro-Black.ttf"), "Be Vietnam Pro ExtraBold / Black + sha256");
  ok((d.match(/sha256sum -c/g) ?? []).length >= 5, "mọi tệp tải về đều kiểm sha256");
  ok(/apt-get install[^\n]*\bcmake\b/.test(d) && /libnss3[\s\S]{0,300}libatk-bridge2\.0-0/.test(d), "cmake và thư viện Chrome Headless Shell");
  ok(/-DGGML_NATIVE=OFF/.test(d), "whisper dựng với cờ CPU cố định (chạy được trên máy khác)");
  ok(/COPY remotion\/package\.json remotion\/package-lock\.json \/opt\/remotion\/\nRUN cd \/opt\/remotion && npm ci --omit=dev/.test(d), "npm ci theo lockfile");
  ok(/npx remotion bundle src\/index\.ts --out-dir bundle/.test(d) && /cp \/usr\/share\/fonts\/truetype\/synchro\/\*\.ttf public\/fonts\//.test(d), "đóng gói sẵn, phông Việt vào bundle");
  ok(/ln -sf \/opt\/remotion\/cli\/synchro-video\.mjs \/usr\/local\/bin\/synchro-video/.test(d), "lệnh synchro-video trong PATH");
  ok(/USER user\n[\s\S]*RUN cd \/tmp && synchro-video selftest/.test(d), "selftest chạy bằng người dùng của sandbox lúc build");
  ok(!/licenseKey|free-license/.test(d), "không có khóa giấy phép trong image");
  const ign = read("workspace/.dockerignore");
  ok(["remotion/node_modules", "remotion/bundle", "remotion/public/fonts"].every((x) => ign.includes(x)), ".dockerignore bỏ thư mục sinh ra");
}

console.log("3. setup.sh dựng lại image khi dự án Remotion đổi");
{
  const s = read("workspace/setup.sh");
  ok(/find remotion -type f/.test(s) && /HASH=\$\( \{ cat "\$APP\/workspace\/Dockerfile"[\s\S]{0,400}for f in \$REMOTION_FILES/.test(s), "HASH gồm mọi tệp của workspace/remotion");
  ok(/-not -path 'remotion\/node_modules\/\*'/.test(s), "bỏ node_modules khỏi HASH");
  ok(s.includes('IMAGE=synchro-ws:1'), "tag image không đổi");
}

console.log("4. Mã nguồn mẫu: không tài sản có bản quyền riêng, không cần mạng");
{
  const files = walk(R).filter((f) => !f.endsWith("package-lock.json"));
  // Chỉ xét mã (bỏ dòng chú thích: chú thích có nhắc tên thứ đã bỏ để người đọc biết vì sao).
  const src = files.filter((f) => /\.(?:tsx?|mjs|json|css)$/.test(f)).map((f) => [f, read(f).replace(/^\s*(?:\/\/|\/\*|\*).*$/gm, "")]);
  ok(!src.some(([, t]) => /@remotion\/google-fonts/.test(t)), "không dùng @remotion/google-fonts (cần mạng)");
  ok(!src.some(([f, t]) => !f.endsWith("ATTRIBUTION.md") && /licenseKey\s*:/.test(t)), "không truyền licenseKey (không gửi sự kiện tới remotion.pro)");
  ok(!files.some((f) => /octocat|smartsound|theme_music|\.mp3$|\.wav$|theboldfont|Seven Segment|sample-video|dialogue\.wav|podcast-cover|NextLogo|Mona-Sans/i.test(path.basename(f))), "không mang tệp nhạc, Octocat, TheBoldFont, logo Next.js, Mona Sans", files.join("\n"));
  ok(!src.some(([, t]) => /Supper Club|Ep 550/.test(t)), "bỏ tiêu đề tập cố định của audiogram gốc");
  const ex = JSON.parse(read(`${R}/src/examples.json`));
  ok(Object.keys(ex).join() === "tiktok,next-tailwind,audiogram,github-unwrapped", "ví dụ props cho đủ 4 mẫu");
  const root = read(`${R}/src/Root.tsx`);
  ok(["tiktok", "next-tailwind", "audiogram", "github-unwrapped"].every((id) => root.includes(`id="${id}"`)), "4 composition đúng id");
  const schemas = read(`${R}/src/schemas.mjs`);
  ok(/fps: z\.union\(\[z\.literal\(30\), z\.literal\(60\)\]\)\.default\(60\)/.test(schemas), "schema mặc định 60 fps");
  const attr = read(`${R}/ATTRIBUTION.md`);
  ok(["1d2bffac65db4938d2ac24884c0013624e6146e8", "b3339aedce09ea173fa4e3ee9fa4a148ce9083b1", "dee9f3619127b8853a1e6cf8882332d9d332c32d", "ece8397df97eb8e0578f8825058da2bf650b1f7d"].every((c) => attr.includes(c)), "ATTRIBUTION ghi commit nguồn của 4 mẫu");
  const cli = read(`${R}/cli/synchro-video.mjs`);
  ok(/browserExecutable: SHELL, chromeMode: "headless-shell"/.test(cli) && /"\/usr\/bin\/chromium", chromeMode: "chrome-for-testing"/.test(cli), "trình duyệt: headless shell đã ghim, Chromium hệ thống làm dự phòng");
  ok(/process\.exit\(EXIT_RESUME\)/.test(cli) && /makeCancelSignal/.test(cli), "dựng tiếp bằng mã 75, dừng sạch khi SIGTERM");
  ok(/sampleRate: 48000/.test(cli) && /"-ar", "48000"/.test(cli), "âm thanh 48 kHz");
}

console.log("5. Giấy phép");
{
  const doc = read("docs/remotion-license.md");
  ok(/up to 3 employees/i.test(doc) && /1 người/.test(doc) && /remotion\.dev\/license/.test(doc), "ghi chú giấy phép: công ty 1 người dùng Free License, trích đúng điều khoản");
  ok(/tải lên|upload/i.test(doc), "ghi rõ điều cấm: dựng dự án Remotion người dùng tải lên");
}

console.log("6. Hướng dẫn cho model");
{
  const rules = read("app/coderun.ts");
  ok(/synchro-video/.test(rules) && ["tiktok", "next-tailwind", "audiogram", "github-unwrapped"].every((id) => rules.includes(id)), "WS_TOOLS nêu synchro-video và 4 mẫu");
  ok(/synchro-video có chuẩn riêng \(60 khung\/giây, phông theo schema/.test(rules) && /Video tự dựng bằng ffmpeg đạt chuẩn: [^\n]*30 khung\/giây/.test(rules), "chuẩn 30 khung/giây, Noto Sans chỉ cho video tự dựng bằng ffmpeg, không mâu thuẫn với synchro-video 60 khung/giây");
  ok(/VIDEO_ROUTE[\s\S]*ffmpeg/.test(rules) && /runner\(\) === "workspace" \? VIDEO_ROUTE/.test(rules), "chỉ image workspace mới có hướng dẫn synchro-video; slideshow đơn giản vẫn ffmpeg");
  ok(/không dựng dự án Remotion người dùng tải lên/.test(rules), "nhắc điều khoản giấy phép");
  const { videokit: V } = await loadTs(["videokit"]);
  for (const q of ["Làm video TikTok 30 giây về mẹo ngủ ngon", "tạo video giới thiệu sản phẩm SaaS của công ty", "dựng audiogram cho tập podcast này", "Make a promo video for our app", "làm video tổng kết số liệu bán hàng năm 2026", "video reels có phụ đề nhảy chữ", "motion graphics cho ra mắt sản phẩm"])
    ok(V.wantsVideo(q), `nhận ra việc dựng video: "${q}"`);
  for (const q of ["xin chào", "video là gì?", "cách làm video tiktok", "tóm tắt video YouTube này", "tải video này về giúp mình", "làm bộ slide báo cáo quý", "viết email gửi sếp"])
    ok(!V.wantsVideo(q), `không phải dựng video: "${q}"`);
  // W23-3 (Blueprint G5.2: "video", "motion graphic", "logo animation", "intro" → Remotion): intro trần trong ngữ cảnh video, animate logo.
  for (const q of ["làm intro 8 giây cho kênh YouTube", "dựng đoạn intro cho podcast", "make a 10s intro for my channel", "animate logo của tôi", "Animate my logo for the launch",
    "Làm video giới thiệu quán", "tao mot motion graphic", "animation logo cho công ty", "dựng video intro cho kênh YouTube", "video TikTok 30 giây", "làm explainer video về sản phẩm", "tạo outro cho kênh"])
    ok(V.wantsVideo(q), `W23-3: nhận ra việc dựng video: "${q}"`);
  for (const q of ["làm intro cho bài luận", "viết intro cho bài luận", "create an intro paragraph for my essay", "make an introduction to Python for beginners", "write an introduction to machine learning",
    "Viết báo cáo tuần", "Thiết kế poster sự kiện", "một bài hát về mùa thu", "logo là gì"])
    ok(!V.wantsVideo(q), `W23-3: không phải dựng video: "${q}"`);
  const b = V.videoTurn({ typed: "làm video tiktok về cà phê", code: true, workspace: true });
  ok(b.startsWith("<video_kit>") && /synchro-video still/.test(b) && /outputs\/_preview/.test(b) && /60 fps|60 khung/.test(b) && /Mã thoát 75/.test(b) && /"audioHz": "48000"/.test(b), "khối có đủ bước: schema, check, still tự xem, render dựng tiếp, kiểm 60 fps / 48 kHz");
  ok(/Không dựng dự án \/ mã Remotion người dùng tải lên/.test(b), "khối nhắc điều khoản giấy phép");
  ok(V.videoTurn({ typed: "làm video tiktok", code: true, workspace: false }) === "" && V.videoTurn({ typed: "làm video tiktok", code: false, workspace: true }) === "", "không có run_code / không phải image workspace: không có khối");
  ok(V.videoTurn({ typed: "làm video tiktok #novideokit", code: true, workspace: true }) === "", "#novideokit tắt khối");
  ok(Buffer.byteLength(V.VIDEO_KIT) < 6144, "khối dưới 6 KB", Buffer.byteLength(V.VIDEO_KIT));
  const engine = read("app/chatengine.ts");
  ok(/videoTurn\(\{ typed, code: caps\.code, workspace: runner\(\) === "workspace" \}\)/.test(engine), "chatengine đặt khối cạnh tin nhắn mới nhất (không vào lời nhắc hệ thống)");
}

console.log("7. Hàng đợi dựng video ở dịch vụ workspace");
{
  const a = read("workspace/agent.mjs");
  ok(/WS_MEDIA_MAX", 0\)/.test(a) && /mediaMaxByRam/.test(a) && /os\.totalmem\(\)/.test(a) && /WS_MEDIA_CAP/.test(a) && /isMediaRun\(\{ files, argv, stdin, readScript \}\)/.test(a) && /SYNCHRO_RUN_TIMEOUT: String\(sec\)/.test(a) && /mediaQ\.close/.test(a) && /freeMedia\(\);/.test(a), "MEDIA_MAX theo RAM (đè bằng WS_MEDIA_MAX), nhả chỗ ở mọi đường thoát, đóng khi tắt dịch vụ");
  ok(/mediaQ\.acquire\(u, sec, signal, onWait\)/.test(a) && /video xếp hàng/.test(a), "xếp hàng dựng video báo vị trí cho người dùng");
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
