// Chạy code cho chat (Cài đặt → Khả năng → Chạy code và tạo tệp) và script của skill (chỉ chạy ở máy chủ).
// Mỗi lần chạy là một thư mục trống mới: chép tệp vào, chạy lệnh, lấy lại các tệp code ghi vào outputs/, rồi xóa hết.
// Nơi chạy, theo thứ tự ưu tiên (CODE_RUN đặt cứng một nơi, "off" để tắt):
//   e2b       sandbox đám mây E2B (cần E2B_API_KEY)
//   workspace container dùng một lần trên VPS qua dịch vụ workspace (workspace/agent.mjs, cần WS_AGENT_URL)
//   local     máy cục bộ trong sandbox-exec của macOS: chỉ cho npm run dev:mock (CODE_RUN=local)
// Mạng: tắt "Cho phép truy cập mạng" thì không ra được internet; bật thì tới được kho thư viện (PKG_DOMAINS), thêm "Mọi trang web
// công khai" (web) thì tới mọi trang công khai. Địa chỉ nội bộ (máy chủ, mạng riêng) luôn bị chặn.
// keep: thư mục làm việc giữ nguyên giữa các lần chạy trong cùng một đoạn chat (tệp tải về, khung hình, dự án dựng dở), outputs/ mỗi lần
// chỉ chứa tệp của lần đó. Không có keep (script của skill) thì mỗi lần một thư mục trống.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PKG_HOSTS } from "./catalog";
import { agent, wsConfigured } from "./workspace";

export type RunFile = { path: string; data: Buffer };
// signal: người dùng bấm Dừng thì dừng tiến trình ngay (chỉ máy cục bộ; nơi chạy khác thì bỏ chờ kết quả).
export type RunInput = { uid: string; files: RunFile[]; argv: string[]; stdin?: string; net: boolean; web?: boolean; keep?: string; timeout?: number; signal?: AbortSignal };
export type RunOutput = { exit: number; stdout: string; stderr: string; files: RunFile[]; timedOut: boolean };
export type Runner = "e2b" | "workspace" | "local";

// timeout: mặc định mỗi lần chạy; maxTimeout: model xin thêm khi dựng video, chuyển tài liệu lớn (tham số timeout của run_code).
export const RUN_LIMITS = { timeout: 120, maxTimeout: 600, out: 60_000, files: 20, fileSize: 100 * 1024 * 1024, total: 150 * 1024 * 1024 };

export function runner(): Runner | null {
  const v = process.env.CODE_RUN;
  if (v === "off") return null;
  if (v === "e2b" || v === "workspace" || v === "local") return v;
  if (process.env.E2B_API_KEY) return "e2b";
  if (wsConfigured()) return "workspace";
  return null;
}

export class RunError extends Error {}
const cut = (t: string) => (t.length > RUN_LIMITS.out ? t.slice(0, RUN_LIMITS.out) + "\n[Đã cắt bớt]" : t);
const okRel = (p: string) => !!p && !path.isAbsolute(p) && !p.split(/[\\/]/).some((x) => x === ".." || x === "") && p.length < 300;

export async function execRun(i: RunInput): Promise<RunOutput> {
  const r = runner();
  if (!r) throw new RunError("Máy chủ chưa có nơi chạy code.");
  for (const f of i.files) if (!okRel(f.path)) throw new RunError(`Đường dẫn tệp không hợp lệ: ${f.path}`);
  if (i.keep !== undefined && !/^[A-Za-z0-9_-]{1,80}$/.test(i.keep)) throw new RunError("Thư mục giữ lại không hợp lệ.");
  const timeout = Math.max(5, Math.min(i.timeout ?? RUN_LIMITS.timeout, RUN_LIMITS.maxTimeout));
  const out = r === "local" ? await runLocal(i, timeout) : r === "workspace" ? await runWorkspace(i, timeout) : await runE2b(i, timeout);
  return { ...out, stdout: cut(out.stdout), stderr: cut(out.stderr) };
}

// ---------------------------------------------------------------- máy cục bộ (giả lập)
async function runLocal(i: RunInput, timeout: number): Promise<RunOutput> {
  if (process.platform !== "darwin") throw new RunError("CODE_RUN=local chỉ chạy được trên macOS (sandbox-exec).");
  const keepRoot = path.join(os.tmpdir(), "synchro-keep");
  // Thư mục giữ lại không dùng quá 24 giờ thì xóa (như dịch vụ workspace).
  for (const u of fs.existsSync(keepRoot) ? fs.readdirSync(keepRoot) : []) for (const k of fs.readdirSync(path.join(keepRoot, u))) {
    const p = path.join(keepRoot, u, k);
    try { if (Date.now() - fs.statSync(p).mtimeMs > 24 * 3_600_000) fs.rmSync(p, { recursive: true, force: true }); } catch {}
  }
  const keep = i.keep ? path.join(keepRoot, i.uid.replace(/[^\w-]/g, "_"), i.keep) : "";
  if (keep) { fs.mkdirSync(keep, { recursive: true }); fs.rmSync(path.join(keep, "outputs"), { recursive: true, force: true }); fs.utimesSync(keep, new Date(), new Date()); }
  const dir = fs.realpathSync(keep || fs.mkdtempSync(path.join(os.tmpdir(), "synchro-run-")));
  try {
    for (const f of i.files) { fs.mkdirSync(path.dirname(path.join(dir, f.path)), { recursive: true }); fs.writeFileSync(path.join(dir, f.path), f.data); }
    for (const d of ["outputs", ".tmp", ".pkgs"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
    const venv = path.join(process.cwd(), ".mkvenv");
    const nodeDir = path.dirname(process.execPath);
    const port = i.net ? await (await import("./egress")).egressPort(!!i.web) : 0;
    const q = (s: string) => JSON.stringify(s);
    // Mặc định cho phép, rồi chặn: mọi kết nối mạng (trừ proxy kho thư viện), ghi tệp ngoài thư mục chạy, đọc nội dung tệp trong thư mục cá nhân.
    const profile = [
      "(version 1)", "(allow default)",
      "(deny network*)",
      ...(port ? [`(allow network-outbound (remote ip "localhost:${port}"))`] : []),
      "(deny file-write*)",
      `(allow file-write* (subpath ${q(dir)}) (literal "/dev/null") (literal "/dev/zero") (regex #"^/dev/fd/") (regex #"^/dev/tty"))`,
      `(deny file-read-data (subpath ${q(fs.realpathSync(os.homedir()))}))`,
      `(allow file-read-data (subpath ${q(dir)}) (subpath ${q(fs.realpathSync(nodeDir))})${fs.existsSync(venv) ? ` (subpath ${q(fs.realpathSync(venv))})` : ""})`,
    ].join("\n");
    const proxy = port ? `http://127.0.0.1:${port}` : "";
    // Python của python.org trên macOS không tự có chứng chỉ gốc: dùng bộ chứng chỉ certifi trong venv nếu có.
    const lib = path.join(venv, "lib");
    const ca = fs.existsSync(lib) ? fs.readdirSync(lib).map((d) => path.join(lib, d, "site-packages", "certifi", "cacert.pem")).find((f) => fs.existsSync(f)) : undefined;
    const env: Record<string, string> = {
      PATH: [fs.existsSync(venv) ? path.join(venv, "bin") : "", nodeDir, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].filter(Boolean).join(":"),
      HOME: dir, TMPDIR: path.join(dir, ".tmp"), LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", MPLCONFIGDIR: path.join(dir, ".tmp"), MPLBACKEND: "Agg",
      PYTHONDONTWRITEBYTECODE: "1", PYTHONUNBUFFERED: "1", PIP_TARGET: path.join(dir, ".pkgs"), PYTHONPATH: path.join(dir, ".pkgs"), PIP_DISABLE_PIP_VERSION_CHECK: "1",
      npm_config_cache: path.join(dir, ".tmp", "npm"), npm_config_update_notifier: "false",
      ...(ca ? { SSL_CERT_FILE: ca, REQUESTS_CA_BUNDLE: ca } : {}),
      ...(proxy ? { HTTPS_PROXY: proxy, HTTP_PROXY: proxy, https_proxy: proxy, http_proxy: proxy } : {}),
    };
    const res = await spawnCapped("sandbox-exec", ["-p", profile, ...i.argv], { cwd: dir, env, stdin: i.stdin, timeout, signal: i.signal });
    const skipped: string[] = [], files = collect(dir, skipped);
    return { ...res, stderr: res.stderr + (skipped.length ? `\n[Không gửi được: ${skipped.join("; ")}]` : ""), files };
  } finally {
    fs.rmSync(keep ? path.join(dir, "outputs") : dir, { recursive: true, force: true });
  }
}

function spawnCapped(cmd: string, args: string[], o: { cwd: string; env: Record<string, string>; stdin?: string; timeout: number; signal?: AbortSignal }) {
  return new Promise<{ exit: number; stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
    const p = spawn(cmd, args, { cwd: o.cwd, env: o.env as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"], detached: true });
    const out: Buffer[] = [], err: Buffer[] = [];
    let n = 0, timedOut = false;
    const take = (a: Buffer[]) => (c: Buffer) => { if (n < RUN_LIMITS.out * 4) { a.push(c); n += c.length; } };
    p.stdout.on("data", take(out));
    p.stderr.on("data", take(err));
    const kill = () => { try { process.kill(-p.pid!, "SIGKILL"); } catch {} };
    const t = setTimeout(() => { timedOut = true; kill(); }, o.timeout * 1000);
    o.signal?.addEventListener("abort", kill, { once: true });
    p.on("error", (e) => { clearTimeout(t); resolve({ exit: 127, stdout: "", stderr: String(e), timedOut }); });
    p.on("close", (code) => {
      clearTimeout(t); kill();
      resolve({ exit: timedOut ? 124 : code ?? 1, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") + (timedOut ? `\n[Đã dừng: chạy quá ${o.timeout} giây]` : ""), timedOut });
    });
    p.stdin.on("error", () => {});
    p.stdin.end(o.stdin ?? "");
  });
}

// Tệp trong outputs/ (tối đa 3 cấp thư mục), bỏ liên kết tượng trưng, giới hạn số lượng và dung lượng.
function collect(dir: string, skipped: string[] = []): RunFile[] {
  const base = path.join(dir, "outputs");
  const out: RunFile[] = [];
  let total = 0;
  const walk = (d: string, depth: number) => {
    if (depth > 3 || !fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile() && out.length < RUN_LIMITS.files) {
        const size = fs.statSync(p).size;
        if (size > RUN_LIMITS.fileSize || total + size > RUN_LIMITS.total) { skipped.push(`${path.relative(base, p)}: ${Math.round(size / 1048576)} MB, quá giới hạn ${RUN_LIMITS.fileSize / 1048576} MB / tệp, ${RUN_LIMITS.total / 1048576} MB / lần chạy`); continue; }
        total += size;
        out.push({ path: path.relative(base, p), data: fs.readFileSync(p) });
      }
    }
  };
  walk(base, 0);
  return out;
}

// ---------------------------------------------------------------- container dùng một lần trên VPS
async function runWorkspace(i: RunInput, timeout: number): Promise<RunOutput> {
  const r = await agent<{ code: number; out: string; err: string; timedOut?: boolean; files?: { path: string; b64: string }[] }>("/run", {
    u: i.uid, argv: i.argv, stdin: i.stdin ?? null, net: i.net, web: !!i.web, keep: i.keep ?? null, timeout,
    files: i.files.map((f) => ({ path: f.path, b64: f.data.toString("base64") })),
  }, (timeout + 90) * 1000);
  return {
    exit: r.code, stdout: r.out ?? "", stderr: r.err ?? "", timedOut: !!r.timedOut,
    files: (r.files ?? []).filter((f) => okRel(f.path)).map((f) => ({ path: f.path, data: Buffer.from(f.b64, "base64") })),
  };
}

// ---------------------------------------------------------------- E2B
async function runE2b(i: RunInput, timeout: number): Promise<RunOutput> {
  const { Sandbox } = await import("@e2b/code-interpreter");
  const sbx = await Sandbox.create({
    timeoutMs: (timeout + 60) * 1000,
    ...(i.net && i.web ? { allowInternetAccess: true } : i.net ? { network: { denyOut: ["0.0.0.0/0"], allowOut: PKG_HOSTS } } : { allowInternetAccess: false }),
  });
  const base = "/home/user/run";
  try {
    if (i.files.length) await sbx.files.write(i.files.map((f) => ({ path: `${base}/${f.path}`, data: f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength) as ArrayBuffer })));
    const shq = (x: string) => `'${x.replace(/'/g, "'\\''")}'`;
    const cmd = `mkdir -p ${base}/outputs && cd ${base} && ${i.stdin !== undefined ? `printf %s ${shq(i.stdin)} | ` : ""}timeout -k 5 ${timeout} ${i.argv.map(shq).join(" ")}`;
    let r: { exitCode: number; stdout: string; stderr: string };
    try { r = await sbx.commands.run(cmd, { timeoutMs: (timeout + 15) * 1000 }); }
    catch (e) {
      const x = e as { exitCode?: number; stdout?: string; stderr?: string; message?: string };
      if (typeof x.exitCode !== "number") throw e;
      r = { exitCode: x.exitCode, stdout: x.stdout ?? "", stderr: x.stderr ?? x.message ?? "" };
    }
    const files: RunFile[] = [];
    let total = 0;
    const list = await sbx.files.list(`${base}/outputs`, { depth: 3 }).catch(() => []);
    for (const e of list) {
      if (e.type !== "file" || files.length >= RUN_LIMITS.files) continue;
      const data = Buffer.from(await sbx.files.read(e.path, { format: "bytes" }));
      if (data.length > RUN_LIMITS.fileSize || total + data.length > RUN_LIMITS.total) continue;
      total += data.length;
      files.push({ path: e.path.slice(`${base}/outputs/`.length), data });
    }
    return { exit: r.exitCode, stdout: r.stdout, stderr: r.stderr, files, timedOut: r.exitCode === 124 };
  } finally {
    await sbx.kill().catch(() => {});
  }
}

// ---------------------------------------------------------------- công cụ run_code cho model
export const LANGS = { python: { file: "main.py", argv: ["python3", "main.py"] }, javascript: { file: "main.js", argv: ["node", "main.js"] }, bash: { file: "main.sh", argv: ["bash", "main.sh"] } } as const;
export type Lang = keyof typeof LANGS;

// Công cụ có sẵn trong image workspace (workspace/Dockerfile): giữ hai nơi khớp nhau. Nơi chạy khác (E2B, máy giả lập) chỉ có phần chung.
const WS_TOOLS = "Có sẵn lệnh: ffmpeg / ffprobe, ImageMagick (convert, identify), LibreOffice (soffice --headless), pandoc, Poppler (pdftoppm, pdftotext), qpdf, Ghostscript, Tesseract OCR (tiếng Việt, tiếng Anh), edge-tts / gTTS (giọng đọc), Graphviz (dot), SoX, rsvg-convert, Chromium headless (Node: require(\"puppeteer-core\") với executablePath /usr/bin/chromium; tự chạy được trong sandbox và tự đi qua proxy khi có mạng). Python: pandas, numpy, scipy, scikit-learn, statsmodels, sympy, networkx, matplotlib, seaborn, plotly (+ kaleido xuất ảnh), Pillow, opencv, imageio, moviepy, pydub, python-docx, python-pptx, openpyxl, xlsxwriter, reportlab, pypdf, pdfplumber, PyMuPDF, cairosvg, pytesseract, beautifulsoup4, lxml, requests, qrcode, pyarrow.";
const BASE_TOOLS = "Python 3 có sẵn pandas, numpy, matplotlib, openpyxl, python-docx, python-pptx, reportlab; có Node.js và bash.";
const NET_NOTE = (net: boolean, web: boolean) => net && web ? "Có internet: tải ảnh, phông chữ, dữ liệu, gọi API công khai, pip / npm install gói còn thiếu (địa chỉ nội bộ của máy chủ bị chặn)."
  : net ? "Chỉ cài thêm gói được bằng pip / npm từ kho thư viện chính thức; mọi trang web khác bị chặn." : "Không có internet: không cài thêm gói được, không gọi được trang web nào; chỉ dùng công cụ có sẵn.";

export function runCodeTool(net: boolean, web = false) {
  return {
    name: "run_code",
    description: `Chạy code thật (Python, JavaScript, bash) trong sandbox Linux cô lập. Thư mục làm việc giữ nguyên giữa các lần chạy trong cùng đoạn chat (24 giờ): bước sau dùng lại được tệp bước trước tải về hay tạo ra. Tệp ghi vào outputs/ được gửi cho người dùng xem và tải về (tối đa ${RUN_LIMITS.files} tệp, ${RUN_LIMITS.fileSize / 1048576} MB mỗi tệp): Word, Excel, PowerPoint, PDF, CSV, ảnh, âm thanh, video MP4… ${runner() === "workspace" ? WS_TOOLS : BASE_TOOLS} Mặc định chạy tối đa ${RUN_LIMITS.timeout} giây; việc nặng (dựng video, chuyển tài liệu lớn) đặt timeout tới ${RUN_LIMITS.maxTimeout}. ${NET_NOTE(net, web)}`,
    input_schema: {
      type: "object",
      properties: {
        language: { type: "string", enum: Object.keys(LANGS), description: "Ngôn ngữ của code" },
        code: { type: "string", description: "Toàn bộ code cần chạy. Ghi tệp kết quả vào outputs/ (vd. outputs/bao-cao.xlsx, outputs/video.mp4)." },
        timeout: { type: "number", description: `Số giây tối đa cho lần chạy này (mặc định ${RUN_LIMITS.timeout}, tối đa ${RUN_LIMITS.maxTimeout}).` },
      },
      required: ["language", "code"],
    },
  };
}

export const CODE_RULES = (net: boolean, web = false) => `Bạn có công cụ run_code để chạy code thật (Python, JavaScript, bash) trong sandbox Linux.
Dùng nó khi cần tính toán chính xác, phân tích dữ liệu, kiểm tra code, hoặc khi người dùng muốn một tệp (Word, Excel, PowerPoint, PDF, CSV, ảnh, âm thanh, video): viết code tạo tệp vào outputs/ rồi chạy. Tệp trong outputs/ sẽ hiện trong tin nhắn (kèm nút tải, video phát ngay) để người dùng xem và tải về, nên đừng dán nội dung tệp vào câu trả lời và đừng viết link hay đường dẫn tới tệp (sandbox:/…, outputs/…); chỉ nói ngắn gọn tệp chứa gì.
Thư mục làm việc giữ nguyên giữa các lần chạy trong đoạn chat này: chia việc lớn thành nhiều lần chạy (chuẩn bị tài nguyên → dựng → kiểm tra) thay vì một script khổng lồ.
Tự xem kết quả: ảnh đầu tiên (PNG / JPEG / WebP) trong outputs/ của mỗi lần chạy được gửi lại cho bạn xem; ảnh chỉ để bạn xem (khung hình trích từ video, trang PDF chụp lại, ảnh ghép) thì lưu vào outputs/_preview/ — không thành tệp của người dùng.
Không tải tệp, ảnh hay dữ liệu của người dùng lên dịch vụ bên ngoài (host ảnh / tệp tạm, pastebin…) trừ khi người dùng yêu cầu rõ.
Video, hoạt hình: dựng khung hình (Pillow, matplotlib, cairosvg, hoặc chụp trang HTML / canvas / SVG động bằng Chromium headless qua puppeteer-core) rồi ghép bằng ffmpeg (-c:v libx264 -pix_fmt yuv420p -movflags +faststart) vào outputs/…mp4; âm thanh bằng ffmpeg, SoX hoặc pydub. Kiểm tra bằng ffprobe (thời lượng, kích thước, số khung) và trích vài khung xem thử trước khi báo xong. Đặt timeout 300–600 cho lần dựng. Video có lời (giới thiệu, hướng dẫn, quảng cáo, kể chuyện): lồng tiếng bằng edge-tts (hoặc python3 -m edge_tts; --write-media giong.mp3 --write-subtitles giong.srt cho luôn phụ đề khớp từng câu) — giọng tiếng Việt tự nhiên vi-VN-HoaiMyNeural (nữ) / vi-VN-NamMinhNeural (nam), tiếng Anh en-US-AriaNeural / en-US-GuyNeural; cần quyền web, luôn thêm --proxy "$HTTPS_PROXY" khi biến này có; lỗi mạng thì dùng gTTS (lang="vi"). Đo thời lượng từng câu bằng ffprobe rồi canh cảnh theo giọng; xuất phụ đề .srt (thư viện srt) và đốt vào video bằng ffmpeg -vf "subtitles=x.srt:force_style='FontName=Noto Sans,FontSize=22,Outline=2'"; nhạc nền nhẹ tự tổng hợp (numpy / SoX) đặt thấp hơn giọng ~18 dB. Hình ảnh: ảnh thật từ Wikimedia Commons hoặc khung hình dựng bằng HTML + Chromium, có chuyển cảnh mượt (xfade), không để khung tĩnh quá 4 giây.
Tệp Word / Excel / PowerPoint: TRƯỚC KHI GIAO luôn tự kiểm tra như người làm nghề, không giao tệp chưa mở: soffice --headless --convert-to pdf (cả .xlsx) rồi pdftoppm -png -r 70 -f 1 -l 3 vào outputs/_preview/ để tự xem bố cục, chữ tiếng Việt, biểu đồ; Excel: mở lại tệp đã tính lại (soffice --headless --convert-to xlsx sang thư mục khác, rồi openpyxl data_only=True) để chắc mọi công thức ra giá trị, không có #REF!, #NAME?, #DIV/0!. Thấy lỗi thì sửa rồi kiểm tra lại; chỉ báo đã kiểm tra khi đã thật sự làm.
Tải từ web: luôn đặt header User-Agent riêng (vd. "SynchroBot/1.0 (+https://synchro.net.nz)") — Wikimedia và nhiều trang chặn hoặc giới hạn (403 / 429) yêu cầu không có User-Agent; ảnh Wikimedia dùng cỡ thumbnail chuẩn (vd. 1280px) và tải lần lượt.
Nếu code lỗi, đọc stderr, sửa và chạy lại. Một cách bị chặn thì thử cách khác trong sandbox trước khi kết luận là không làm được. Không kết thúc lượt khi chưa có sản phẩm: nếu thật sự không tạo được đúng định dạng người dùng muốn, vẫn giao bản gần nhất (vd. artifact HTML chạy được thay cho video) và nói rõ còn thiếu gì. ${NET_NOTE(net, web)}`;
