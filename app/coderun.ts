// Chạy code cho chat (Cài đặt → Khả năng → Chạy code và tạo tệp) và script của skill (chỉ chạy ở máy chủ).
// Mỗi lần chạy là một thư mục trống mới: chép tệp vào, chạy lệnh, lấy lại các tệp code ghi vào outputs/, rồi xóa hết.
// Nơi chạy, theo thứ tự ưu tiên (CODE_RUN đặt cứng một nơi, "off" để tắt):
//   e2b       sandbox đám mây E2B (cần E2B_API_KEY)
//   workspace container dùng một lần trên VPS qua dịch vụ workspace (workspace/agent.mjs, cần WS_AGENT_URL)
//   local     máy cục bộ trong sandbox-exec của macOS: chỉ cho npm run dev:mock (CODE_RUN=local)
// Mạng: tắt "Cho phép truy cập mạng" thì không ra được internet; bật thì chỉ tới được kho thư viện (PKG_DOMAINS).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PKG_HOSTS } from "./catalog";
import { agent, wsConfigured } from "./workspace";

export type RunFile = { path: string; data: Buffer };
export type RunInput = { uid: string; files: RunFile[]; argv: string[]; stdin?: string; net: boolean; timeout?: number };
export type RunOutput = { exit: number; stdout: string; stderr: string; files: RunFile[]; timedOut: boolean };
export type Runner = "e2b" | "workspace" | "local";

export const RUN_LIMITS = { timeout: 120, out: 60_000, files: 10, fileSize: 20 * 1024 * 1024, total: 40 * 1024 * 1024 };

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
  const timeout = Math.max(5, Math.min(i.timeout ?? RUN_LIMITS.timeout, RUN_LIMITS.timeout));
  const out = r === "local" ? await runLocal(i, timeout) : r === "workspace" ? await runWorkspace(i, timeout) : await runE2b(i, timeout);
  return { ...out, stdout: cut(out.stdout), stderr: cut(out.stderr) };
}

// ---------------------------------------------------------------- máy cục bộ (giả lập)
async function runLocal(i: RunInput, timeout: number): Promise<RunOutput> {
  if (process.platform !== "darwin") throw new RunError("CODE_RUN=local chỉ chạy được trên macOS (sandbox-exec).");
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "synchro-run-")));
  try {
    for (const f of i.files) { fs.mkdirSync(path.dirname(path.join(dir, f.path)), { recursive: true }); fs.writeFileSync(path.join(dir, f.path), f.data); }
    for (const d of ["outputs", ".tmp", ".pkgs"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
    const venv = path.join(process.cwd(), ".mkvenv");
    const nodeDir = path.dirname(process.execPath);
    const port = i.net ? await (await import("./egress")).egressPort() : 0;
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
    const res = await spawnCapped("sandbox-exec", ["-p", profile, ...i.argv], { cwd: dir, env, stdin: i.stdin, timeout });
    return { ...res, files: collect(dir) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function spawnCapped(cmd: string, args: string[], o: { cwd: string; env: Record<string, string>; stdin?: string; timeout: number }) {
  return new Promise<{ exit: number; stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
    const p = spawn(cmd, args, { cwd: o.cwd, env: o.env as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"], detached: true });
    const out: Buffer[] = [], err: Buffer[] = [];
    let n = 0, timedOut = false;
    const take = (a: Buffer[]) => (c: Buffer) => { if (n < RUN_LIMITS.out * 4) { a.push(c); n += c.length; } };
    p.stdout.on("data", take(out));
    p.stderr.on("data", take(err));
    const kill = () => { try { process.kill(-p.pid!, "SIGKILL"); } catch {} };
    const t = setTimeout(() => { timedOut = true; kill(); }, o.timeout * 1000);
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
function collect(dir: string): RunFile[] {
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
        if (size > RUN_LIMITS.fileSize || total + size > RUN_LIMITS.total) continue;
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
    u: i.uid, argv: i.argv, stdin: i.stdin ?? null, net: i.net, timeout,
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
    ...(i.net ? { network: { denyOut: ["0.0.0.0/0"], allowOut: PKG_HOSTS } } : { allowInternetAccess: false }),
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

export function runCodeTool(net: boolean) {
  return {
    name: "run_code",
    description: `Chạy code trong sandbox cô lập, mỗi lần một thư mục trống mới (không giữ lại gì giữa các lần chạy). Python 3 có sẵn pandas, numpy, matplotlib, openpyxl, python-docx, python-pptx, reportlab; có Node.js và bash. Tệp ghi vào thư mục outputs/ được gửi cho người dùng tải về: dùng để tạo Word (.docx), Excel (.xlsx), PowerPoint (.pptx), PDF, CSV, ảnh biểu đồ (.png)… Tối đa ${RUN_LIMITS.timeout} giây. ${net ? "Có thể cài thêm gói bằng pip/npm từ kho thư viện chính thức; mọi trang web khác bị chặn." : "Không có internet: không cài thêm gói được, không gọi được trang web nào."}`,
    input_schema: {
      type: "object",
      properties: {
        language: { type: "string", enum: Object.keys(LANGS), description: "Ngôn ngữ của code" },
        code: { type: "string", description: "Toàn bộ code cần chạy. Ghi tệp kết quả vào outputs/ (vd. outputs/bao-cao.xlsx)." },
      },
      required: ["language", "code"],
    },
  };
}

export const CODE_RULES = (net: boolean) => `Bạn có công cụ run_code để chạy code thật (Python, JavaScript, bash) trong sandbox.
Dùng nó khi cần tính toán chính xác, phân tích dữ liệu, kiểm tra code, hoặc khi người dùng muốn một tệp (Word, Excel, PowerPoint, PDF, CSV, ảnh biểu đồ): viết code tạo tệp vào outputs/ rồi chạy. Tệp trong outputs/ sẽ hiện trong tin nhắn để người dùng tải về, nên đừng dán nội dung tệp vào câu trả lời; chỉ nói ngắn gọn tệp chứa gì.
Nếu code lỗi, đọc stderr, sửa và chạy lại (tối đa vài lần). ${net ? "Có thể pip install / npm install gói còn thiếu (chỉ kho thư viện chính thức)." : "Sandbox không có internet nên không cài thêm gói được; chỉ dùng thư viện có sẵn."}`;
