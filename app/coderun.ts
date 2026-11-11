// Chạy code cho chat (Cài đặt → Khả năng → Chạy code và tạo tệp) và script của skill (chỉ chạy ở máy chủ).
// Mỗi lần chạy là một thư mục trống mới: chép tệp vào, chạy lệnh, lấy lại các tệp code ghi vào outputs/, rồi xóa hết.
// Nơi chạy, theo thứ tự ưu tiên (CODE_RUN đặt cứng một nơi, "off" để tắt):
//   e2b       sandbox đám mây E2B (cần E2B_API_KEY)
//   workspace container dùng một lần trên VPS qua dịch vụ workspace (workspace/agent.mjs, cần WS_AGENT_URL)
//   local     máy cục bộ trong sandbox-exec của macOS: chỉ cho npm run dev:mock (CODE_RUN=local)
// Mạng: tắt "Cho phép truy cập mạng" thì không ra được internet; bật thì tới được kho thư viện (PKG_DOMAINS), thêm "Mọi trang web
// công khai" (web) thì tới mọi trang công khai. Địa chỉ nội bộ (máy chủ, mạng riêng) luôn bị chặn.
// keep: thư mục làm việc giữ nguyên giữa các lần chạy trong cùng một đoạn chat (tệp tải về, khung hình, dự án dựng dở), outputs/ mỗi lần
// chỉ chứa tệp của lần đó; hết lần chạy tệp chuyển sang .last_outputs/ để lần sau đọc, kiểm tra được. Không có keep (script của skill) thì
// mỗi lần một thư mục trống.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PKG_HOSTS } from "./catalog";
import { PREVIEW_MAX } from "./runpreview";
import { clipOut, clipSink, tidyLog } from "./runtext";
import { agent, wsConfigured } from "./workspace";

export type RunFile = { path: string; data: Buffer };
// signal: người dùng bấm Dừng thì dừng ngay: máy cục bộ giết tiến trình, workspace ngắt kết nối để dịch vụ xóa container, E2B xóa sandbox.
// recalc: sau lần chạy thành công, tính lại công thức trong .xlsx ở outputs/ bằng LibreOffice và ghi giá trị vào chính tệp (chỉ image workspace có).
export type RunInput = { uid: string; files: RunFile[]; argv: string[]; stdin?: string; net: boolean; web?: boolean; keep?: string; timeout?: number; signal?: AbortSignal; recalc?: boolean };
// recalc: báo cáo của workspace/xlsx_recalc.py; không có nghĩa là lần chạy này không có sổ tính nào được tính lại.
export type RecalcBook = { path: string; prefixed?: number; formulas: number; filled: number; errors: { sheet: string; cell: string; value: string; formula?: string }[]; sample: string[] };
export type RecalcReport = { files?: RecalcBook[]; failed?: { path: string; reason: string }[]; error?: string };
// skipped: tệp không gửi được (quá dung lượng, quá số tệp): "đường-dẫn: lý do".
export type RunOutput = { exit: number; stdout: string; stderr: string; files: RunFile[]; timedOut: boolean; recalc?: RecalcReport; skipped?: string[] };
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
const cut = (t: string) => clipOut(tidyLog(t), RUN_LIMITS.out);
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
  if (keep) { fs.mkdirSync(keep, { recursive: true }); rotateOutputs(keep); fs.utimesSync(keep, new Date(), new Date()); }
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
    return { ...res, stderr: res.stderr + (skipped.length ? `\n[Không gửi được: ${skipped.join("; ")}]` : ""), files, skipped };
  } finally {
    if (keep) rotateOutputs(dir); else fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Hết lần chạy, tệp trong outputs/ chuyển sang .last_outputs/ (giữ giống workspace/agent.mjs). Lần chạy không ghi gì thì giữ nguyên bản trước;
// lần chỉ có _preview/ (chỉ để kiểm tra) thì giữ nguyên sản phẩm, chỉ thay ảnh xem, để kiểm tra nhiều lần trên cùng một tệp.
function rotateOutputs(dir: string) {
  const out = path.join(dir, "outputs"), last = path.join(dir, ".last_outputs");
  try {
    const names = fs.lstatSync(out, { throwIfNoEntry: false })?.isDirectory() ? fs.readdirSync(out) : [];
    if (names.some((n) => n !== "_preview")) { fs.rmSync(last, { recursive: true, force: true }); fs.renameSync(out, last); return; }
    if (names.length) {
      if (fs.lstatSync(last, { throwIfNoEntry: false })?.isDirectory() !== true) { fs.rmSync(last, { recursive: true, force: true }); fs.mkdirSync(last); }
      fs.rmSync(path.join(last, "_preview"), { recursive: true, force: true });
      fs.renameSync(path.join(out, "_preview"), path.join(last, "_preview"));
    }
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
}

function spawnCapped(cmd: string, args: string[], o: { cwd: string; env: Record<string, string>; stdin?: string; timeout: number; signal?: AbortSignal }) {
  return new Promise<{ exit: number; stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
    const p = spawn(cmd, args, { cwd: o.cwd, env: o.env as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"], detached: true });
    const out = clipSink(), err = clipSink();
    let timedOut = false;
    p.stdout.on("data", (c: Buffer) => out.push(c));
    p.stderr.on("data", (c: Buffer) => err.push(c));
    const kill = () => { try { process.kill(-p.pid!, "SIGKILL"); } catch {} };
    const t = setTimeout(() => { timedOut = true; kill(); }, o.timeout * 1000);
    o.signal?.addEventListener("abort", kill, { once: true });
    p.on("error", (e) => { clearTimeout(t); resolve({ exit: 127, stdout: "", stderr: String(e), timedOut }); });
    p.on("close", (code) => {
      clearTimeout(t); kill();
      resolve({ exit: timedOut ? 124 : code ?? 1, stdout: out.text(), stderr: err.text() + (timedOut ? `\n[Đã dừng: chạy quá ${o.timeout} giây]` : ""), timedOut });
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
      else if (e.isFile() && out.length >= RUN_LIMITS.files) skipped.push(`${path.relative(base, p)}: quá ${RUN_LIMITS.files} tệp`);
      else if (e.isFile()) {
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
  // Thêm 150 giây cho bước tính lại công thức (giới hạn riêng 120 giây ở dịch vụ workspace).
  const r = await agent<{ code: number; out: string; err: string; timedOut?: boolean; files?: { path: string; b64: string }[]; recalc?: RecalcReport; skipped?: string[] }>("/run", {
    u: i.uid, argv: i.argv, stdin: i.stdin ?? null, net: i.net, web: !!i.web, keep: i.keep ?? null, timeout, recalc: !!i.recalc,
    files: i.files.map((f) => ({ path: f.path, b64: f.data.toString("base64") })),
  }, (timeout + 90 + (i.recalc ? 150 : 0)) * 1000, i.signal);
  return {
    exit: r.code, stdout: r.out ?? "", stderr: r.err ?? "", timedOut: !!r.timedOut, ...(r.recalc ? { recalc: r.recalc } : {}), ...(r.skipped?.length ? { skipped: r.skipped } : {}),
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
  i.signal?.addEventListener("abort", () => { sbx.kill().catch(() => {}); }, { once: true });
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
    const files: RunFile[] = [], skipped: string[] = [];
    let total = 0;
    const list = await sbx.files.list(`${base}/outputs`, { depth: 3 }).catch(() => []);
    for (const e of list) {
      if (e.type !== "file") continue;
      const rel = e.path.slice(`${base}/outputs/`.length);
      if (files.length >= RUN_LIMITS.files) { skipped.push(`${rel}: quá ${RUN_LIMITS.files} tệp`); continue; }
      const data = Buffer.from(await sbx.files.read(e.path, { format: "bytes" }));
      if (data.length > RUN_LIMITS.fileSize || total + data.length > RUN_LIMITS.total) { skipped.push(`${rel}: ${Math.round(data.length / 1048576)} MB, quá giới hạn`); continue; }
      total += data.length;
      files.push({ path: rel, data });
    }
    return { exit: r.exitCode, stdout: r.stdout, stderr: r.stderr, files, timedOut: r.exitCode === 124, skipped };
  } finally {
    await sbx.kill().catch(() => {});
  }
}

// ---------------------------------------------------------------- công cụ run_code cho model
export const LANGS = { python: { file: "main.py", argv: ["python3", "main.py"] }, javascript: { file: "main.js", argv: ["node", "main.js"] }, bash: { file: "main.sh", argv: ["bash", "main.sh"] } } as const;
export type Lang = keyof typeof LANGS;

// Công cụ có sẵn trong image workspace (workspace/Dockerfile): giữ hai nơi khớp nhau. Nơi chạy khác (E2B, máy giả lập) chỉ có phần chung.
const WS_TOOLS = "Có sẵn lệnh: ffmpeg / ffprobe, ImageMagick (convert, identify), LibreOffice (soffice --headless), pandoc, Poppler (pdftoppm, pdftotext), qpdf, Ghostscript, Tesseract OCR (tiếng Việt, tiếng Anh), edge-tts / gTTS (giọng đọc qua mạng), espeak-ng (giọng máy, không cần mạng), Graphviz (dot), SoX, rsvg-convert, Chromium headless (Node: require(\"puppeteer-core\") với executablePath /usr/bin/chromium; tự chạy được trong sandbox và tự đi qua proxy khi có mạng). synchro-video: dựng video đồ họa chuyển động 60 khung/giây từ 4 mẫu Remotion có sẵn (tiktok, next-tailwind, audiogram, github-unwrapped) bằng props JSON, không cần mạng (synchro-video templates); whisper.cpp nhận dạng giọng tiếng Việt cho phụ đề (synchro-video captions). synchro-doc: tài liệu PDF / Word từ payload JSON theo 4 mẫu dựng sẵn (basic-report, ilm, charged-ieee, invoice; synchro-doc list). Typst 0.15 (typst compile; gói @preview basic-report 0.1.0, ilm 1.4.0, charged-ieee 0.1.3 có sẵn không cần mạng), WeasyPrint 70 (HTML + CSS → PDF có @page, số trang: import weasyprint). Python: pandas, numpy, scipy, scikit-learn, statsmodels, sympy, networkx, matplotlib, seaborn, plotly (+ kaleido xuất ảnh), Pillow, opencv, imageio, moviepy 1.x (from moviepy.editor import …), pydub, python-docx, python-pptx, openpyxl, xlsxwriter, reportlab, pypdf, pdfplumber, PyMuPDF, cairosvg, pytesseract, beautifulsoup4, lxml, requests, qrcode, pyarrow.";
const BASE_TOOLS = "Python 3 có sẵn pandas, numpy, matplotlib, openpyxl, python-docx, python-pptx, reportlab; có Node.js và bash.";
const NET_NOTE = (net: boolean, web: boolean) => net && web ? "Có internet: tải ảnh, phông chữ, dữ liệu, gọi API công khai, pip / npm install gói còn thiếu (địa chỉ nội bộ của máy chủ bị chặn)."
  : net ? "Chỉ cài thêm gói được bằng pip / npm từ kho thư viện chính thức và gọi được dịch vụ giọng đọc của edge-tts / gTTS; mọi trang web khác bị chặn." : "Không có internet: không cài thêm gói được, không gọi được trang web nào; chỉ dùng công cụ có sẵn.";

export function runCodeTool(net: boolean, web = false) {
  return {
    name: "run_code",
    description: `Chạy code thật (Python, JavaScript, bash) trong sandbox Linux cô lập. Thư mục làm việc giữ nguyên giữa các lần chạy trong cùng đoạn chat (24 giờ): bước sau dùng lại được tệp bước trước tải về hay tạo ra. Tệp người dùng gửi có sẵn ở inputs/<tên tệp>. Tệp ghi vào outputs/ được gửi cho người dùng xem và tải về (tối đa ${RUN_LIMITS.files} tệp, ${RUN_LIMITS.fileSize / 1048576} MB mỗi tệp): Word, Excel, PowerPoint, PDF, CSV, ảnh, âm thanh, video MP4… ${runner() === "workspace" ? WS_TOOLS : BASE_TOOLS} Mặc định chạy tối đa ${RUN_LIMITS.timeout} giây; việc nặng (dựng video, chuyển tài liệu lớn) đặt timeout tới ${RUN_LIMITS.maxTimeout}. ${NET_NOTE(net, web)}`,
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

// Đường video đồ họa: chi tiết từng bước nằm trong khối <video_kit> (app/videokit.ts) chỉ nạp ở lượt nhờ dựng video.
const VIDEO_ROUTE = "Video đồ họa chuyển động (TikTok / Reels có phụ đề nhảy theo giọng, video giới thiệu / quảng cáo sản phẩm, audiogram podcast, video tổng kết số liệu năm): ưu tiên synchro-video — 4 mẫu Remotion 60 khung/giây dựng sẵn, bạn chỉ viết props.json (synchro-video templates, schema, check, still để tự xem ảnh trong outputs/_preview/, render; mã thoát 75 thì gọi lại đúng lệnh để dựng tiếp). Chỉ dựng 4 mẫu này, không dựng dự án Remotion người dùng tải lên (giấy phép Remotion). Slideshow ảnh đơn giản và cắt ghép video thì làm bằng ffmpeg như dưới.\n";
// Đường tài liệu theo mẫu: chi tiết và hợp đồng JSON nằm trong khối <doc_kit> (app/dockit.ts) chỉ nạp ở lượt nhờ làm tệp tài liệu.
const DOC_ROUTE = "Tài liệu PDF theo mẫu (báo cáo doanh nghiệp có bìa và mục lục, đề xuất dự án / sách mỏng, bài nghiên cứu 2 cột kiểu IEEE, hóa đơn / báo giá A4): ưu tiên synchro-doc — 4 mẫu dựng sẵn (Typst: basic-report, ilm, charged-ieee; WeasyPrint: invoice), bạn chỉ viết payload JSON (synchro-doc example / schema <mẫu>, rồi synchro-doc typst <mẫu> payload.json outputs/x.pdf --png outputs/_preview, hay synchro-doc invoice …; cùng payload ra bản Word bằng synchro-doc docx <mẫu> payload.json outputs/x.docx). Không tự viết Typst cho các mẫu này; hóa đơn để synchro-doc tính tiền. Tài liệu không hợp mẫu thì làm như dưới.\n";
export const CODE_RULES = (net: boolean, web = false) => `Bạn có công cụ run_code để chạy code thật (Python, JavaScript, bash) trong sandbox Linux.
Dùng nó khi cần tính toán chính xác, phân tích dữ liệu, kiểm tra code, hoặc khi người dùng muốn một tệp (Word, Excel, PowerPoint, PDF, CSV, ảnh, âm thanh, video): viết code tạo tệp vào outputs/ rồi chạy. Tệp trong outputs/ sẽ hiện trong tin nhắn (kèm nút tải, video phát ngay) để người dùng xem và tải về, nên đừng dán nội dung tệp vào câu trả lời và đừng viết link hay đường dẫn tới tệp (sandbox:/…, outputs/…); chỉ nói ngắn gọn tệp chứa gì.
Tệp của đoạn chat có sẵn trong thư mục làm việc ở inputs/<đúng tên tệp>: tệp người dùng gửi (bản gốc đủ mọi dòng, công thức, định dạng, ảnh gốc chưa thu nhỏ) và ảnh generate_image đã tạo; không chắc tên thì liệt kê bằng ls inputs/. Phân tích, sửa, điền mẫu, ghép ảnh hay dựng video từ tệp của người dùng thì đọc bản gốc ở đó, không chép lại từ phần chữ trích trong tin nhắn (chỉ có một phần); kết quả ghi vào outputs/, không sửa trực tiếp trong inputs/. Thư mục làm việc giữ nguyên giữa các lần chạy trong đoạn chat này: chia việc lớn thành nhiều lần chạy (chuẩn bị tài nguyên → dựng → kiểm tra) thay vì một script khổng lồ. Hết mỗi lần chạy, outputs/ được dọn: tệp vừa tạo chuyển sang .last_outputs/ — lần kiểm tra sau đọc từ đó (ffprobe .last_outputs/video.mp4, soffice --convert-to pdf .last_outputs/bao-cao.xlsx…), không dựng lại; muốn người dùng nhận thêm tệp thì ghi lại vào outputs/. Chỉ lần chạy thành công (exit 0) mới gửi tệp: chạy lỗi hay quá giờ thì tệp không tới người dùng (vẫn nằm ở .last_outputs/, dùng được thì chép sang outputs/ ở lần sau). Tạo lại cùng đường dẫn trong outputs/ thì bản mới thay bản cũ của lượt này.
Tự xem kết quả: tối đa ${PREVIEW_MAX} ảnh (PNG / JPEG / WebP) của mỗi lần chạy, ưu tiên outputs/_preview/, được ghép thành một tấm gửi lại cho bạn; thẻ <preview> trong kết quả ghi đúng những ảnh nào có trong tấm đó. Ảnh chỉ để bạn xem (khung hình trích từ video, trang PDF chụp lại) lưu vào outputs/_preview/ — không thành tệp của người dùng. Chỉ nói đã xem những gì <preview> liệt kê; kết quả không có ảnh kèm thì kiểm tra bằng số liệu (ffprobe, pdftotext, openpyxl) và nói rõ là chưa xem bằng mắt.
Mỗi lần chạy có tối đa 2 GB bộ nhớ: mã thoát 137 nghĩa là hết bộ nhớ, hãy giảm độ phân giải hoặc xử lý từng phần (dựng video dài theo từng đoạn rồi ghép).
Không tải tệp, ảnh hay dữ liệu của người dùng lên dịch vụ bên ngoài (host ảnh / tệp tạm, pastebin…) trừ khi người dùng yêu cầu rõ.
${runner() === "workspace" ? VIDEO_ROUTE : ""}Video, hoạt hình: dựng khung hình (Pillow, matplotlib, cairosvg, hoặc chụp trang HTML / canvas / SVG động bằng Chromium headless qua puppeteer-core) rồi ghép bằng ffmpeg (-hide_banner -loglevel error -stats -c:v libx264 -crf 23 -preset veryfast -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 128k -ar 48000) vào outputs/…mp4; âm thanh bằng ffmpeg, SoX hoặc pydub. Luôn đặt -loglevel error -stats: log đầy đủ của ffmpeg dài hàng chục nghìn dòng che mất lỗi thật. Đĩa mỗi lần chạy khoảng 6 GB, thư mục làm việc giữ lại khoảng 3 GB một tài khoản, 60 giây khung PNG 1080p đã tốn 2–5 GB: dùng khung JPEG (-q:v 3) hoặc đẩy thẳng vào ffmpeg qua pipe (-f image2pipe), dựng xong đoạn nào xóa khung của đoạn đó. Mỗi tệp giao được tối đa ${RUN_LIMITS.fileSize / 1048576} MB, tổng ${RUN_LIMITS.total / 1048576} MB một lần chạy: 1080p -crf 23 thường 10–30 MB một phút, video dài thì tăng -crf (26–28) hoặc chia phần; tệp vượt giới hạn nằm trong thẻ <not_delivered> và người dùng không nhận được. Kiểm tra bằng ffprobe (thời lượng, kích thước, số khung) và trích vài khung xem thử trước khi báo xong. Đặt timeout 300–${RUN_LIMITS.maxTimeout} cho lần dựng; quá giờ thì lần chạy bị dừng, không có tệp nào tới người dùng: video dài thì dựng từng đoạn vào thư mục làm việc qua nhiều lần chạy rồi ghép. Có CLI ngừng chờ công cụ sau vài phút (đo được ở Antigravity khoảng 190 giây) trong khi code vẫn chạy: gặp kết quả hết thời gian chờ thì đừng chạy lại ngay cùng lệnh, lần sau chỉ xếp hàng sau lần cũ và bạn tưởng là lỗi; dựng thành các đoạn ngắn vào thư mục làm việc để lần sau dùng tiếp được. Video có lời (giới thiệu, hướng dẫn, quảng cáo, kể chuyện): lồng tiếng trước hết bằng edge-tts (edge-tts --proxy "$HTTPS_PROXY" --voice … -f loi.txt --write-media giong.mp3 --write-subtitles giong.srt, cho luôn phụ đề khớp từng câu; trong Python: edge_tts.Communicate(text, voice, proxy=os.environ.get("HTTPS_PROXY"))) — giọng tiếng Việt tự nhiên vi-VN-HoaiMyNeural (nữ) / vi-VN-NamMinhNeural (nam), tiếng Anh en-US-AriaNeural / en-US-GuyNeural. Chỉ cần bật truy cập mạng, không cần quyền mọi trang web; edge-tts không tự đọc biến proxy nên phải có --proxy khi có HTTPS_PROXY, thiếu là lỗi SkewAdjustmentError "No server date in headers". edge-tts vẫn lỗi thì dùng gTTS (lang="vi"; tự đi qua proxy, không có phụ đề theo câu). Cả hai đều cần mạng: không có mạng thì dùng espeak-ng (espeak-ng -v vi -w giong.wav -f loi.txt), giọng máy kém tự nhiên nên phải nói rõ với người dùng và đề nghị bật truy cập mạng để có giọng tự nhiên. Đo thời lượng từng câu bằng ffprobe rồi canh cảnh theo giọng. Phụ đề: có tệp .srt (edge-tts hoặc thư viện srt) thì chuyển bằng python3 /opt/synchro/subfit.py giong.srt phu-de.ass 1920x1080 (đúng kích thước video, 1080x1920 với video dọc; tự chọn cỡ chữ, chia câu dài thành nhiều phụ đề tối đa 2 dòng, 42 ký tự mỗi dòng) rồi đốt bằng ffmpeg -vf "ass=phu-de.ass". Không đốt trực tiếp .srt với force_style FontSize lớn: ffmpeg tính cỡ chữ theo khung cao 288 điểm nên FontSize=22 ra ~82 px ở 1080p, che gần hết hình; nhạc nền nhẹ tự tổng hợp (numpy / SoX) đặt thấp hơn giọng ~18 dB. Hình ảnh: ảnh người dùng gửi và ảnh generate_image ở inputs/, ảnh thật từ Wikimedia Commons hoặc khung hình dựng bằng HTML + Chromium, có chuyển cảnh mượt (xfade), không để khung tĩnh quá 4 giây.
Bảng tính đạt chuẩn người làm nghề: tiêu đề cột in đậm có nền, cố định hàng tiêu đề (freeze panes), độ rộng cột vừa nội dung, định dạng số đúng loại (tiền #,##0 "₫" — ký hiệu tiền phải nằm trong ngoặc kép; ngày dd/mm/yyyy, phần trăm 0.0%), dữ liệu dạng Excel Table có lọc, danh sách chọn (data validation) cho cột phân loại, tổng / tỉ lệ bằng công thức (SUM, SUMIFS, COUNTIFS, INDEX + MATCH, IFERROR…) — không ghi cứng số đã tính; không dùng hàm mới (XLOOKUP, FILTER, UNIQUE, SORT, LET, SEQUENCE…) vì LibreOffice ở đây không tính được và openpyxl ghi thiếu tiền tố _xlfn thì Excel báo #NAME? (hàm sau 2007 như IFS, SWITCH, MAXIFS, MINIFS, TEXTJOIN, CONCAT, IFNA dùng được, Synchro tự thêm tiền tố khi tính lại), biểu đồ có tiêu đề và nhãn, tên sheet tiếng Việt ngắn gọn, căn lề in vừa một trang ngang. Màu chữ theo vai trò: ô nhập tay xanh dương (0000FF), ô công thức đen; hàng tổng đậm, viền trên thin, viền dưới double; số âm #,##0;(#,##0);"-"; thanh trong ô và bản đồ nhiệt bằng định dạng có điều kiện thật (openpyxl DataBarRule, ColorScaleRule; xlsxwriter conditional_format), không vẽ bằng ký tự hay ảnh.
Video đạt chuẩn: 1920×1080 (hoặc 1080×1920 cho video dọc), 30 khung/giây, có cảnh mở đầu và kết thúc, ảnh tĩnh có chuyển động nhẹ (zoom / pan) và chuyển cảnh xfade, chữ trong vùng an toàn cách mép ≥ 5%, một bộ font (Noto Sans) cho cả video, âm thanh chuẩn hóa ffmpeg loudnorm=I=-16:TP=-1.5:LRA=11 kèm -ar 48000 (loudnorm tự nâng lên 96 kHz, nhiều máy phát và trang tải lên xử lý kém); trích 4–6 khung hình vào outputs/_preview/ và kiểm bằng ffprobe thời lượng, tần số âm thanh 48000 trước khi giao. Chữ trong video vẽ bằng Pillow hoặc phụ đề .ass: TextClip của moviepy cần quyền ImageMagick thường bị chặn.
${runner() === "workspace" ? DOC_ROUTE : ""}PDF dựng bằng reportlab: phông mặc định Helvetica làm mất dấu tiếng Việt (ti■ng Vi■t), phải đăng ký TTFont từ /usr/share/fonts/truetype/noto/NotoSans-Regular.ttf và NotoSans-Bold.ttf rồi dùng cho mọi chữ, kể cả bảng và đầu trang; hoặc dựng HTML rồi in PDF bằng Chromium.
PowerPoint bằng python-pptx: đặt 13.333 × 7.5 in mà giữ mẫu mặc định thì ô giữ chỗ vẫn nằm theo khung 4:3 (tiêu đề lệch trái, trống một phần ba bên phải): dùng layout trống (slide_layouts[6]) với vị trí tính rõ theo khung 16:9, hoặc co lại ô giữ chỗ của layout; biểu đồ, bảng là đối tượng thật (add_chart, add_table), không chụp ảnh; một bộ màu chủ đề và một phông có đủ dấu cho cả tệp. Người dùng gửi mẫu thì mở chính inputs/<tên mẫu>, giữ layout của mẫu.
Tệp Word / Excel / PowerPoint / PDF: TRƯỚC KHI GIAO luôn tự kiểm tra như người làm nghề, không giao tệp chưa mở: lần chạy sau đọc .last_outputs/, Office thì soffice --headless --convert-to pdf (cả .xlsx), rồi pdftoppm -png -r 70 -f 1 -l 3 vào outputs/_preview/ để tự xem bố cục, chữ tiếng Việt, biểu đồ. Excel: sau mỗi lần chạy thành công Synchro tự tính lại công thức trong outputs/*.xlsx bằng LibreOffice, ghi giá trị vào chính tệp và báo trong thẻ <excel_recalc> (số công thức, ô lỗi, vài giá trị): đối chiếu các giá trị đó với số bạn tự tính bằng Python (in ra stdout), ô lỗi #REF!, #NAME?, #DIV/0! hay số 0 bất thường đều phải sửa. Thấy lỗi thì sửa rồi kiểm tra lại; chỉ báo đã kiểm tra khi đã thật sự làm.
Ảnh chụp, tranh, minh họa do AI tạo: dùng generate_image nếu có công cụ đó, không dựng bằng code. Đồ họa dựng bằng mã (biểu đồ, infographic, slide, bìa, banner hay poster cần chữ chính xác, thẻ mạng xã hội): làm như người thiết kế nghề, không phải hình mặc định của thư viện. Dựng bằng HTML + CSS + SVG rồi chụp PNG bằng Chromium ở deviceScaleFactor 2 (đúng kích thước yêu cầu, Pillow chỉ để ghép ảnh); một ý chính, thứ bậc rõ (tiêu đề lớn gấp 3–4 lần chữ thường), bảng màu 2–3 màu có độ tương phản đạt, lưới và lề đều, khoảng trống rộng; chiều sâu bằng chuyển màu, bóng mềm, lớp chồng, hình học hay nét vẽ SVG có chủ đích; chữ tiếng Việt dùng phông có đủ dấu (có sẵn Noto Sans, Be Vietnam Pro, Inter, Plus Jakarta Sans, Playfair Display, Space Grotesk, JetBrains Mono). Không dùng biểu tượng cảm xúc thay cho hình, không giả ảnh chụp bằng hình vẽ. Luôn ghi vào outputs/_preview/ để tự xem rồi sửa ít nhất một lượt (chữ tràn, lệch lề, tương phản kém). Nói đúng đây là đồ họa dựng bằng mã, không phải ảnh do AI vẽ.
Tải từ web: luôn đặt header User-Agent riêng (vd. "SynchroBot/1.0 (+https://synchro.net.nz)") — Wikimedia và nhiều trang chặn hoặc giới hạn (403 / 429) yêu cầu không có User-Agent; ảnh Wikimedia dùng cỡ thumbnail chuẩn (vd. 1280px) và tải lần lượt.
Nếu code lỗi, đọc stderr, sửa và chạy lại. Một cách bị chặn thì thử cách khác trong sandbox trước khi kết luận là không làm được. Không kết thúc lượt khi chưa có sản phẩm: nếu thật sự không tạo được đúng định dạng người dùng muốn, vẫn giao bản gần nhất (vd. artifact HTML chạy được thay cho video) và nói rõ còn thiếu gì. ${NET_NOTE(net, web)}`;
