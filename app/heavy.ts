"use client";
// Các thư viện nặng, tải lười: js-tiktoken, web-tree-sitter, Pyodide, WebContainers, E2B.
import { useDev } from "./devstore";
import { extractSymbols } from "./devtools";

// ------------------------------------------------------------ TOKENS (js-tiktoken)
// Đếm ở luồng phụ (app/tokens.worker.ts): đọc bảng cl100k và dựng bộ mã hóa ở luồng chính chặn giao diện ~200ms (lần đầu ~480ms) lúc mở
// Synchro Code. countTokens vẫn trả ngay: số đã đếm, hoặc ước lượng (chữ / 4) trong lúc gửi đi đếm; có kết quả thì encVer tăng để UI tính lại.
// Không mở được luồng phụ thì dựng bộ mã hóa ở luồng chính như trước.
type Enc = { encode: (s: string) => number[] };
let enc: Enc | null = null;
let encLoading = false;
let tw: Worker | null | undefined;
const tcache = new Map<string, number>(), asked = new Set<string>();
let queue: [string, string][] = [], flushing = false;
function loadOnMain() {
  if (enc || encLoading) return;
  encLoading = true;
  Promise.all([import("js-tiktoken/lite"), import("js-tiktoken/ranks/cl100k_base")])
    .then(([{ Tiktoken }, ranks]) => { enc = new Tiktoken(ranks.default); useDev.getState().bumpEnc(); })
    .catch(() => { encLoading = false; });
}
export function loadEncoder() {
  if (enc || encLoading || tw !== undefined || typeof window === "undefined") return;
  try {
    tw = new Worker(new URL("./tokens.worker.ts", import.meta.url));
    tw.onmessage = (e: MessageEvent<[string, number][]>) => {
      if (tcache.size > 2000) tcache.clear();
      for (const [k, n] of e.data) { tcache.set(k, n); asked.delete(k); }
      useDev.getState().bumpEnc();
    };
    tw.onerror = () => { tw?.terminate(); tw = null; queue = []; asked.clear(); loadOnMain(); };
    // Lần vẽ trước chỉ có ước lượng (luồng phụ chưa mở): vẽ lại để gửi các chữ đi đếm.
    useDev.getState().bumpEnc();
  } catch { tw = null; loadOnMain(); }
}
const keyOf = (s: string) => (s.length < 400 ? s : s.length + ":" + s.slice(0, 40) + s.slice(-40));
export function countTokens(s: string): number {
  const k = keyOf(s);
  if (enc) {
    if (s.length < 400) { try { return enc.encode(s).length; } catch { return Math.ceil(s.length / 4); } }
    let n = tcache.get(k);
    if (n === undefined) {
      try { n = enc.encode(s).length; } catch { n = Math.ceil(s.length / 4); }
      if (tcache.size > 2000) tcache.clear();
      tcache.set(k, n);
    }
    return n;
  }
  const n = tcache.get(k);
  if (n !== undefined) return n;
  if (tw && s && !asked.has(k)) {
    asked.add(k); queue.push([k, s]);
    // Gom các chữ của một lần vẽ thành một lần gửi.
    if (!flushing) { flushing = true; queueMicrotask(() => { flushing = false; const q = queue; queue = []; tw?.postMessage(q); }); }
  }
  return Math.ceil(s.length / 4);
}

// ------------------------------------------------------------ TREE-SITTER
const GRAMMAR: Record<string, string> = { js: "javascript", jsx: "javascript", mjs: "javascript", ts: "typescript", tsx: "tsx", py: "python", go: "go", rs: "rust" };
const DECL = new Set(["function_declaration", "generator_function_declaration", "class_declaration", "method_definition", "function_definition", "class_definition", "method_declaration", "function_item", "struct_item", "impl_item", "interface_declaration", "type_alias_declaration"]);
type TSParser = import("web-tree-sitter").Parser;
let tsReady: Promise<typeof import("web-tree-sitter")> | null = null;
const langs = new Map<string, Promise<import("web-tree-sitter").Language | null>>();
let tsParser: TSParser | null = null;

// /ts/*.wasm có tên cố định và được giữ đệm một tuần (next.config.ts, blueprint B3.6), còn phần JS của web-tree-sitter đi theo gói npm đã băm.
// Hai phần phải cùng phiên bản: URL mang phiên bản (?v=) để lần nâng web-tree-sitter sau không đọc .wasm cũ còn trong bộ đệm.
// Nâng web-tree-sitter / tree-sitter-wasms: chép lại public/ts từ node_modules và đổi TS_REV (tests/api/bootstrap.test.mjs kiểm cả hai).
export const TS_REV = "0.27.1-0.1.13"; // web-tree-sitter - tree-sitter-wasms
const tsUrl = (f: string) => `/ts/${f}?v=${TS_REV}`;
function initTS() {
  return (tsReady ??= import("web-tree-sitter").then(async (m) => {
    await m.Parser.init({ locateFile: (f: string) => tsUrl(f) });
    tsParser = new m.Parser();
    return m;
  }));
}
export type Sym = { name: string; file: string; code: string };
export async function symbolsTS(name: string, text: string): Promise<Sym[]> {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const g = GRAMMAR[ext];
  if (!g) return extractSymbols(name, text);
  try {
    const m = await initTS();
    let lp = langs.get(g);
    if (!lp) { lp = m.Language.load(tsUrl(`tree-sitter-${g}.wasm`)).catch(() => null); langs.set(g, lp); }
    const lang = await lp;
    if (!lang || !tsParser) return extractSymbols(name, text);
    tsParser.setLanguage(lang);
    const tree = tsParser.parse(text);
    if (!tree) return extractSymbols(name, text);
    const out: Sym[] = [];
    const visit = (n: import("web-tree-sitter").Node) => {
      let nm = "";
      if (DECL.has(n.type)) nm = n.childForFieldName("name")?.text ?? n.childForFieldName("type")?.text ?? "";
      else if (n.type === "variable_declarator" && /arrow_function|function_expression/.test(n.childForFieldName("value")?.type ?? "")) nm = n.childForFieldName("name")?.text ?? "";
      if (nm) out.push({ name: nm, file: name, code: n.text.split("\n").slice(0, 60).join("\n") });
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c); }
    };
    visit(tree.rootNode);
    tree.delete();
    return out.length ? out : extractSymbols(name, text);
  } catch (e) { console.warn("tree-sitter fallback", e); return extractSymbols(name, text); }
}
export async function pickRelevantTS(files: { name: string; text: string }[], query: string, k = 5): Promise<Sym[]> {
  const words = Array.from(new Set(query.toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) ?? []));
  const all = (await Promise.all(files.slice(0, 80).map((f) => symbolsTS(f.name, f.text)))).flat();
  return all
    .map((s) => ({ s, sc: words.reduce((a, w) => a + (s.name.toLowerCase().includes(w) ? 3 : 0) + (s.code.toLowerCase().includes(w) ? 1 : 0), 0) }))
    .filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, k).map((x) => x.s);
}

// ------------------------------------------------------------ SANDBOX
export type RunResult = { out: string; err: string };

const PYO = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
let pyodide: Promise<{ runPythonAsync: (c: string) => Promise<unknown>; setStdout: (o: { batched: (s: string) => void }) => void; setStderr: (o: { batched: (s: string) => void }) => void; loadPackagesFromImports: (c: string) => Promise<void> }> | null = null;
let pyLock: Promise<unknown> = Promise.resolve();
export function runPython(code: string): Promise<RunResult> {
  const r = pyLock.then(() => runPythonNow(code));
  pyLock = r.catch(() => {});
  return r;
}
async function runPythonNow(code: string): Promise<RunResult> {
  let out = "", err = "";
  try {
    pyodide ??= (import(/* webpackIgnore: true */ /* @vite-ignore */ PYO + "pyodide.mjs") as Promise<{ loadPyodide: (o: { indexURL: string }) => Promise<never> }>).then((m) => m.loadPyodide({ indexURL: PYO }));
    const py = await pyodide;
    py.setStdout({ batched: (s) => { out += s + "\n"; } });
    py.setStderr({ batched: (s) => { err += s + "\n"; } });
    await py.loadPackagesFromImports(code);
    await py.runPythonAsync(code);
  } catch (e) { const m = String((e as Error).message ?? e); const i = m.indexOf('File "<exec>"'); err += (i >= 0 ? m.slice(i) : m.split("\n").slice(-6).join("\n")).trim(); }
  return { out, err };
}

let wc: Promise<import("@webcontainer/api").WebContainer> | null = null;
export const nodeNeedsContainer = (code: string) => /\brequire\(|^\s*import\s.+from\s|process\.|node:|\bfs\b/m.test(code);
export async function runNode(code: string): Promise<RunResult> {
  if (!window.crossOriginIsolated) return { out: "", err: "WebContainer cần trang cô lập (COOP/COEP). Hãy tải lại trang hoặc dùng sandbox server." };
  try {
    wc ??= import("@webcontainer/api").then((m) => m.WebContainer.boot());
    const c = await wc;
    const esm = /^\s*import\s/m.test(code);
    await c.mount({ "package.json": { file: { contents: JSON.stringify({ name: "synchro-run", type: esm ? "module" : "commonjs" }) } }, "index.js": { file: { contents: code } } });
    const deps = Array.from(code.matchAll(/(?:require\(|from\s+)["']([^./"'][^"']*)["']/g)).map((m) => m[1].startsWith("@") ? m[1].split("/").slice(0, 2).join("/") : m[1].split("/")[0]).filter((d) => !/^node:|^(fs|path|os|http|https|crypto|util|url|events|stream|child_process|readline|assert|buffer|zlib)$/.test(d));
    let out = "";
    const run = async (cmd: string, args: string[]) => {
      const p = await c.spawn(cmd, args);
      p.output.pipeTo(new WritableStream({ write(d) { out += d; } }));
      return p.exit;
    };
    if (deps.length) { const ec = await run("npm", ["i", "--no-audit", "--no-fund", ...Array.from(new Set(deps))]); if (ec) return { out: "", err: out }; out = ""; }
    const ec = await run("node", ["index.js"]);
    const clean = out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
    return ec ? { out: "", err: clean } : { out: clean, err: "" };
  } catch (e) { return { out: "", err: String((e as Error).message ?? e) }; }
}

export async function runServer(lang: string, code: string): Promise<RunResult> {
  try {
    const r = await fetch("/api/sandbox", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lang, code }) });
    const j = await r.json();
    if (!r.ok) return { out: "", err: j.error ?? "Sandbox server lỗi" };
    return { out: j.out ?? "", err: j.err ?? "" };
  } catch (e) { return { out: "", err: String(e) }; }
}

// ------------------------------------------------------------ DOCS
export async function scrapeDoc(url: string): Promise<string> {
  const u = /^https?:/.test(url) ? url : "https://" + url;
  try {
    const r = await fetch("/api/scrape", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: u }) });
    if (r.ok) { const j = await r.json(); if (j.text) return String(j.text); }
  } catch { /* thử trực tiếp */ }
  const r = await fetch("https://r.jina.ai/" + u, { headers: { Accept: "text/plain" } });
  if (!r.ok) throw new Error("scrape " + r.status);
  return (await r.text()).slice(0, 40000);
}
