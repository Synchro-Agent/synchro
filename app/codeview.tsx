"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as I from "./icons";
import { Menu, Thinking } from "./ui";
import { Markdown, fileNameFor, type DevBlock } from "./md";
import { callLLM, hasLLM, type LLMMsg } from "./llm";
import { usePref } from "./store";
import { redact, unredact, analyzePaste, SLASH, balanceBraces, type Pill } from "./devtools";
import { useDev, type Panel } from "./devstore";
import { countTokens, loadEncoder, pickRelevantTS, runPython, runNode, runServer, nodeNeedsContainer, scrapeDoc, type RunResult } from "./heavy";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import { UploadModal } from "./modals";
import { FileCard } from "./fileicon";
import { useFileMenu, saveDoc } from "./filemenu";
import { ingestFile } from "./filestate";
const Monaco = dynamic(() => import("@monaco-editor/react"), { ssr: false, loading: () => <div className="cv-ed-load">Đang tải Monaco…</div> });

type Att = { k: "paste" | "error" | "quote"; name: string; text: string; pills?: Pill[] };
type Node = { id: number; parent: number; user: string; hid?: string; atts: Att[]; ai: string; done: boolean; stopped?: boolean; mode: string; time: number };
type Ctx = { id: number; name: string; text: string; size: number; kind: "file" | "doc"; pinned?: boolean; off?: boolean };
type Say = (m: string) => void;

const MAX_TOK = 128_000;
export const MODES = [
  { k: "plan", label: "Architect / Plan", short: "Plan", desc: "Chỉ phân tích cấu trúc và lập kế hoạch, không viết code dài." },
  { k: "code", label: "Write / Code", short: "Code", desc: "Tập trung sinh code hoàn chỉnh, sẵn sàng chạy ngay." },
  { k: "debug", label: "Debug", short: "Debug", desc: "Đọc lỗi, truy nguyên nhân gốc và đề xuất cách sửa." },
] as const;
const GUIDE_TABS = [
  { k: "start", l: "Bắt đầu", i: <I.Help size={16} /> },
  { k: "modes", l: "Chế độ", i: <I.Layers size={16} /> },
  { k: "cmd", l: "Lệnh & @", i: <I.Enter size={16} /> },
  { k: "keys", l: "Phím tắt", i: <I.Sliders size={16} /> },
  { k: "run", l: "Code & chạy thử", i: <I.Code size={16} /> },
  { k: "ctx", l: "Ngữ cảnh", i: <I.Folder size={16} /> },
  { k: "safe", l: "Bảo mật", i: <I.Shield size={16} /> },
];
const MODE_SYS: Record<string, string> = {
  plan: "Chế độ Architect/Plan: chỉ phân tích cấu trúc, đề xuất kế hoạch từng bước. TUYỆT ĐỐI không viết code dài (tối đa vài dòng minh họa).",
  code: "Chế độ Write/Code: sinh code hoàn chỉnh, chạy được, kèm ghi chú ngắn.",
  debug: "Chế độ Debug: đọc kỹ lỗi/log. Trước hết liệt kê 3 giả thuyết nguyên nhân (xếp theo khả năng), rồi mới đề xuất bản sửa nhỏ nhất.",
};
const RULES_SYS = [
  "Mọi code block PHẢI có dòng đầu tiên là `// filepath: đường/dẫn/tệp.ext` (dùng `# filepath:` cho Python/shell).",
  "Khi chỉ sửa một phần tệp có sẵn, được phép dùng `// ... existing code ...` cho phần không đổi.",
  "Nếu viết thuật toán, cuối câu trả lời thêm một dòng ẩn: <!-- meta:{\"time\":\"O(n)\",\"space\":\"O(1)\",\"canOptimize\":false} -->",
  "Các giá trị dạng <REDACTED_KEY_N> là bí mật đã được che; giữ nguyên chúng trong code, không đoán giá trị.",
].join("\n");
const STRICT_SYS = "CHỈ trả về code block, không giải thích, không lời dẫn.";
export const PRESETS = [
  { k: "next", label: "Next.js + Tailwind + TypeScript", rule: "Dùng Next.js App Router, Tailwind CSS và TypeScript strict. Ưu tiên Server Components, đặt tên file kebab-case." },
  { k: "vite", label: "React + Vite + TypeScript", rule: "Dùng React 19 function components + hooks, Vite, TypeScript strict, CSS Modules." },
  { k: "fastapi", label: "Python + FastAPI", rule: "Dùng Python 3.12, FastAPI, Pydantic v2, type hints đầy đủ, async/await." },
  { k: "express", label: "Node.js + Express", rule: "Dùng Node.js 20, Express, ES modules, xử lý lỗi bằng middleware tập trung." },
  { k: "go", label: "Go (net/http)", rule: "Dùng Go 1.22, net/http chuẩn, trả lỗi tường minh, không dùng global state." },
] as const;
const BIN_EXT = /\.(png|jpe?g|gif|webp|ico|pdf|mp4|mov|mp3|wav|woff2?|ttf|otf|eot|exe|dll|so|dylib|bin|class|jar|lock|map|svg)$/i;
const SUGGEST = [
  { t: "Sửa lỗi đăng nhập", d: "Viết hàm login có xử lý lỗi", q: "Viết hàm login bằng TypeScript gọi /api/login" },
  { t: "Dựng trang demo HTML", d: "Có nút bấm, chạy thử được ngay", q: "Tạo demo html có nút bấm để chạy thử" },
  { t: "Lập kế hoạch kiến trúc", d: "Chia module, luồng dữ liệu", q: "Lập kế hoạch kiến trúc cho app quản lý công việc" },
];

const tok = countTokens;
const fmtK = (n: number) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(n));
const isErr = (t: string) => /(Traceback \(most recent|Exception|Error:|^\s+at\s+\S+|FATAL|panic:|Uncaught)/m.test(t);
const closeFences = (t: string) => {
  if ((t.match(/```/g) ?? []).length % 2 === 0) return t;
  const i = t.lastIndexOf("```");
  return t.slice(0, i) + balanceBraces(t.slice(i)) + "\n```";
};
const blocksOf = (t: string): DevBlock[] => Array.from(t.matchAll(/```(\w*)\n([\s\S]*?)```/g)).map((m) => ({ lang: m[1], code: m[2].replace(/\n$/, "") }));

function useClickAway(fn: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const f = useRef(fn); f.current = fn;
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as HTMLElement)) f.current(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return ref;
}

const V1 = `// src/lib/auth.ts
export async function login(email: string, password: string) {
  const res = await fetch("/api/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return res.json();
}`;
const V2 = `// src/lib/auth.ts
export class AuthError extends Error {}

export async function login(email: string, password: string) {
  if (!email || !password) throw new AuthError("Thiếu email hoặc mật khẩu");
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new AuthError(\`Đăng nhập thất bại (\${res.status})\`);
  return res.json();
}`;

function mockReply(mode: string, text: string, hasPrev: boolean, atts: Att[], rules: string, ctx: Ctx[]): string {
  const head = [rules && `Quy tắc dự án: ${rules.slice(0, 70)}${rules.length > 70 ? "…" : ""}`, ctx.length && `Ngữ cảnh: ${ctx.length} tệp đang bật`].filter(Boolean).join("\n");
  const pre = head ? head + "\n\n" : "";
  const t = text.toLowerCase();
  if (mode === "plan")
    return pre + "Đây là kế hoạch kiến trúc đề xuất:\n\n### 1. Phân lớp\n- **UI**: các component thuần hiển thị\n- **Domain**: logic nghiệp vụ, không phụ thuộc framework\n- **Data**: client gọi API, cache bằng `SWR`\n\n### 2. Luồng dữ liệu\n1. Người dùng thao tác trên UI\n2. Action gọi service trong `src/lib`\n3. Service trả dữ liệu đã chuẩn hóa về UI\n\n### 3. Các bước thực hiện\n1. Dựng khung thư mục và cấu hình lint\n2. Viết service và kiểu dữ liệu\n3. Làm màn hình chính, rồi kiểm thử\n\nBạn muốn tôi chuyển sang chế độ **Code** để viết bước 2 không?";
  if (mode === "debug") {
    const e = atts.find((a) => a.k === "error");
    return pre + (e ? "Tôi đã đọc log lỗi bạn gửi. " : "") + "**Nguyên nhân gốc:** hàm `login` không kiểm tra `res.ok` và không gửi header `content-type`, nên server trả 400 nhưng code vẫn cố parse JSON.\n\n**Cách sửa nhỏ nhất:**\n\n```ts\n" + V2 + "\n```\n\nSau khi sửa, lỗi sẽ được ném ra dưới dạng `AuthError` để UI hiển thị thông báo rõ ràng.";
  }
  if (/cài|install|npm|pip/.test(t)) return pre + "Cài các gói sau:\n\n```bash\nnpm install axios zod @synchro/ghost-pkg-xyz\n```\n\nLịch chạy job dọn dẹp:\n\n```bash\n# crontab\n30 2 * * 1-5 node clean.js\n```\n\n<!-- meta:{\"time\":\"O(n)\",\"space\":\"O(1)\",\"canOptimize\":true} -->";
  if (/node|require/.test(t)) return pre + "Script Node chạy trong WebContainer:\n\n```js\n// os.js\nconst os = require(\"os\");\nconsole.log(\"Nền tảng:\", os.platform());\n```\n";
  if (/python|\bpy\b/.test(t)) return pre + "Script Python chạy thử ngay trong trình duyệt (Pyodide):\n\n```python\n# calc.py\nxs = [1, 2, 3]\nprint(\"Tổng:\", sum(xs))\nprint(undefined_var)\n```\n";
  if (/sơ đồ|mermaid|diagram|flow/.test(t)) return pre + "Luồng đăng nhập:\n\n```mermaid\nflowchart TD\n  A[Người dùng] --> B{Hợp lệ?}\n  B -- Có --> C[Vào app]\n  B -- Không --> D[Báo lỗi]\n```\n";
  const wantsHtml = /html|demo|giao diện|preview|nút/.test(t);
  const wantsJs = /\bjs\b|javascript|script|chạy/.test(t);
  const edit = hasPrev || /sửa|fix|refactor|cải thiện|thêm|update/.test(t);
  let out = pre + (edit ? "Tôi đã cập nhật hàm theo yêu cầu. Bấm **Diff** để xem chính xác dòng nào được thêm hoặc xóa:\n\n" : "Đây là bản triển khai đầu tiên:\n\n");
  out += "```ts\n" + (edit ? V2 : V1) + "\n```\n";
  if (wantsHtml) out += "\nBản demo có thể bấm **Chạy** để xem ngay:\n\n```html\n<!-- demo.html -->\n<button id=\"b\" style=\"padding:8px 14px;font:14px system-ui\">Bấm thử</button>\n<p id=\"o\" style=\"font:14px system-ui\"></p>\n<script>b.onclick=()=>o.textContent=\"Xin chào từ Synchro Code · \"+new Date().toLocaleTimeString()</script>\n```\n";
  if (wantsJs) out += "\nĐoạn script chạy thử trong sandbox:\n\n```js\n// sum.js\nconst xs = [1, 2, 3, 4];\nconsole.log(\"Tổng:\", xs.reduce((a, b) => a + b, 0));\n```\n";
  return out + "\nBạn muốn tôi thêm kiểm thử đơn vị hoặc tách thành hook `useAuth`?";
}

function ErrView({ text }: { text: string }) {
  return (
    <pre className="cv-trace">
      {text.split("\n").map((l, i) => {
        const bad = /(error|exception|traceback|fatal|panic|uncaught|failed)/i.test(l);
        const parts = l.split(/([\w./\\-]+\.(?:tsx?|jsx?|py|go|rs|java|rb):\d+(?::\d+)?)/g);
        return <div key={i} className={bad ? "bad" : ""}>{parts.map((p, k) => (k % 2 ? <mark key={k}>{p}</mark> : p))}{"\n"}</div>;
      })}
    </pre>
  );
}

function isTextEntry(path: string): boolean {
  const seg = path.split("/");
  return seg.length > 0;
}

async function readEntry(en: FileSystemEntry, base: string, out: { path: string; file: File }[], skip: { n: number }) {
  if (en.isFile) {
    const f = await new Promise<File>((res, rej) => (en as FileSystemFileEntry).file(res, rej));
    const p = base + en.name;
    if (isTextEntry(p)) out.push({ path: p, file: f }); else skip.n++;
  } else if (en.isDirectory) {
    const rd = (en as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => rd.readEntries(res, rej));
      if (!batch.length) break;
      for (const c of batch) await readEntry(c, base + en.name + "/", out, skip);
    }
  }
}

export function CodeView({ say, sid, onCreate, onNew, onEmpty }: { say: Say; onEmpty: (e: boolean) => void; sid: number | null; onCreate: (id: number, title: string) => void; onNew: () => void }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [sel, setSel] = useState<Record<number, number>>({});
  const [ctx, setCtx] = useState<Ctx[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = usePref("codeMode", "code");
  const [cf] = usePref("codeFont", "");
  const [csz] = usePref("codeSize", "13");
  const [rules, setRules] = usePref("codeRules", { preset: "next", custom: "" });
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState("");
  const [atts, setAtts] = useState<Att[]>([]);
  const panel = useDev((s) => s.panel);
  const setPanel = useDev((s) => s.setPanel);
  useDev((s) => s.encVer);
  useEffect(() => { loadEncoder(); }, []);
  const snapRef = useRef<Map<number, Ctx[]>>(new Map());
  const [menu, setMenu] = useState<"" | "plus" | "mode" | "ctx" | "rules" | "err">("");
  const [mention, setMention] = useState<{ q: string; start: number } | null>(null);
  const [mi, setMi] = useState(0);
  const [docMode, setDocMode] = useState(false);
  const [viewer, setViewer] = useState<Att | null>(null);
  const [errText, setErrText] = useState("");
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const [selBox, setSelBox] = useState<{ x: number; y: number; text: string; line: number } | null>(null);
  const [dragOn, setDragOn] = useState(false);
  const [si, setSi] = useState(0);
  const [guide, setGuide] = useState(false);
  const [gt, setGt] = useState("start");
  const [pal, setPal] = useState<{ q: string; i: number } | null>(null);
  const [inl, setInl] = useState<{ x: number; y: number; text: string; v: string } | null>(null);
  const strictRef = useRef(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const genRef = useRef(0);
  const activeRef = useRef<number | null>(null);
  const nodesRef = useRef<Node[]>([]); nodesRef.current = nodes;
  const ctxRef = useRef<Ctx[]>([]); ctxRef.current = ctx;
  const fileIn = useRef<HTMLInputElement>(null);
  const dirIn = useRef<HTMLInputElement>(null);
  const zipIn = useRef<HTMLInputElement>(null);
  const away = useClickAway(() => { setMenu(""); setMention(null); });

  useEffect(() => { if (loaded) onEmpty(nodes.length === 0); }, [loaded, nodes.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadedSid = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (loadedSid.current === sid) return;
    loadedSid.current = sid;
    stopGen();
    setAtts([]); setV(""); setPanel(null);
    try {
      const s = sid === null ? null : JSON.parse(localStorage.getItem("codeS:" + sid) ?? "null");
      setNodes(s ? (s.nodes ?? []).map((n: Node) => ({ ...n, done: true })) : []);
      setSel(s?.sel ?? {}); setCtx(s?.ctx ?? []);
    } catch { setNodes([]); setSel({}); setCtx([]); }
    setLoaded(true);
  }, [sid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!loaded || loadedSid.current !== sid) return;
    let id = sid;
    if (id === null) {
      if (!nodes.length) return;
      id = Date.now();
      loadedSid.current = id;
      onCreate(id, nodes[0].user.replace(/\s+/g, " ").trim().slice(0, 40) || "Phiên code");
    }
    try { localStorage.setItem("codeS:" + id, JSON.stringify({ nodes, sel, ctx })); } catch {}
  }, [nodes, sel, ctx, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const rule = rules.preset === "custom" ? rules.custom : PRESETS.find((p) => p.k === rules.preset)?.rule ?? "";
  const ruleLabel = rules.preset === "custom" ? "Luật tùy chỉnh" : rules.preset === "none" ? "Không có luật" : PRESETS.find((p) => p.k === rules.preset)?.label ?? "";

  const childrenOf = useCallback((p: number) => nodes.filter((n) => n.parent === p), [nodes]);
  const path = useMemo(() => {
    const out: Node[] = [];
    let p = 0;
    for (;;) {
      const kids = nodes.filter((n) => n.parent === p);
      if (!kids.length) break;
      const n = kids.find((k) => k.id === sel[p]) ?? kids[kids.length - 1];
      out.push(n); p = n.id;
    }
    return out;
  }, [nodes, sel]);

  const activeCtx = ctx.filter((c) => !c.off);
  const ctxTok = activeCtx.reduce((a, c) => a + tok(c.text), 0);
  const histTok = path.reduce((a, n) => a + tok(n.user) + tok(n.ai) + n.atts.reduce((b, x) => b + tok(x.text), 0), 0);
  const draftTok = tok(v) + atts.reduce((a, x) => a + tok(x.text), 0);
  const total = ctxTok + histTok + draftTok;
  const pct = Math.min(100, (total / MAX_TOK) * 100);

  useEffect(() => {
    const el = threadRef.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: busy ? "auto" : "smooth" });
  }, [path, busy]);
  useEffect(() => {
    if (!ta.current) return;
    ta.current.style.height = "auto";
    ta.current.style.height = Math.min(ta.current.scrollHeight, 200) + "px";
  }, [v]);

  const patchNode = (id: number, fn: (n: Node) => Node) => setNodes((ns) => ns.map((n) => (n.id === id ? fn(n) : n)));

  const stopGen = useCallback(() => {
    genRef.current++;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    const id = activeRef.current;
    activeRef.current = null;
    setBusy(false);
    if (id !== null) setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ai: closeFences(n.ai), done: true, stopped: !!n.ai && n.stopped !== false ? true : n.stopped } : n)));
  }, []);

  const run = (id: number, hist: Node[], userText: string, userAtts: Att[], md: string) => {
    const gen = ++genRef.current;
    activeRef.current = id;
    setBusy(true);
    const live = ctxRef.current.filter((c) => !c.off);
    const messages: LLMMsg[] = [];
    hist.forEach((n) => {
      messages.push({ role: "user", content: n.user + (n.hid ? "\n\n" + n.hid : "") + n.atts.map((a) => `\n\n[${a.name}]\n${a.text}`).join("") });
      if (n.ai && n.id !== id) messages.push({ role: "assistant", content: n.ai });
    });
    const buildSystem = (snips: { file: string; name: string; code: string }[]) => [
      "Bạn là Synchro Code, trợ lý lập trình.",
      MODE_SYS[md],
      RULES_SYS,
      strictRef.current && STRICT_SYS,
      SLASH.find((x) => userText.trimStart() === x.cmd || userText.trimStart().startsWith(x.cmd + " "))?.sys,
      snips.length > 0 && "Đoạn code liên quan (@Codebase):\n" + snips.map((x) => `--- ${x.file} · ${x.name} ---\n${x.code}`).join("\n"),
      rule && `Luật dự án: ${rule}`,
      live.length && "Tệp ngữ cảnh:\n" + live.map((c) => `--- ${c.name} ---\n${c.text.slice(0, 6000)}`).join("\n"),
    ].filter(Boolean).join("\n\n");
    (async () => {
      let reply: string;
      const snips = /@codebase\b/i.test(userText) ? await pickRelevantTS(live, userText, 5) : [];
      const system = buildSystem(snips);
      if (hasLLM) { try { reply = await callLLM(system, messages, 2500, { task: /^\s*\/commit\b/.test(userText) ? "commit" : undefined, tokens: tok(system) + messages.reduce((a, m) => a + tok(typeof m.content === "string" ? m.content : ""), 0) }); } catch { reply = "Không thể kết nối tới model. Vui lòng thử lại."; } }
      else {
        await new Promise((r) => setTimeout(r, 650));
        const hasPrev = hist.slice(0, -1).some((n) => blocksOf(n.ai).length > 0);
        reply = mockReply(md, userText, hasPrev, userAtts, rule ? ruleLabel : "", live);
      }
      if (gen !== genRef.current) return;
      let i = 0;
      timer.current = setInterval(() => {
        i += 16;
        const done = i >= reply.length;
        patchNode(id, (n) => ({ ...n, ai: reply.slice(0, i), done }));
        if (done) { if (timer.current) clearInterval(timer.current); timer.current = null; activeRef.current = null; setBusy(false); }
      }, 26);
    })();
  };

  const send = (text = v, extra: Att[] = atts, hid?: string, strict = false) => {
    if (busy) return;
    strictRef.current = strict;
    let cnt = 0;
    const rt = redact(text.trim()); cnt += rt.count;
    const t = rt.text;
    extra = extra.map((a) => { const r = redact(a.text); cnt += r.count; return { ...a, text: r.text, pills: undefined }; });
    if (cnt) say(`🛡️ Đã bảo vệ ${cnt} thông tin nhạy cảm tại trình duyệt`);
    if (!t && !extra.length) return;
    stick.current = true;
    const parent = path.length ? path[path.length - 1].id : 0;
    const n: Node = { id: Date.now(), parent, user: t || "Xem nội dung đính kèm", hid, atts: extra, ai: "", done: false, mode, time: Date.now() };
    snapRef.current.set(n.id, ctxRef.current);
    setNodes((ns) => [...ns, n]);
    setSel((s) => ({ ...s, [parent]: n.id }));
    setV(""); setAtts([]); setMention(null);
    run(n.id, [...path, n], n.user, n.atts, mode);
  };

  const branch = (old: Node, text: string) => {
    if (busy || !text.trim()) return;
    const n: Node = { id: Date.now(), parent: old.parent, user: text.trim(), atts: old.atts, ai: "", done: false, mode: old.mode, time: Date.now() };
    const upto: Node[] = [];
    for (const p of path) { if (p.id === old.id) break; upto.push(p); }
    snapRef.current.set(n.id, ctxRef.current);
    setNodes((ns) => [...ns, n]);
    setSel((s) => ({ ...s, [old.parent]: n.id }));
    setEditing(null);
    stick.current = true;
    run(n.id, [...upto, n], n.user, n.atts, n.mode);
  };

  const retry = () => {
    const last = path[path.length - 1];
    if (!last || busy) return;
    patchNode(last.id, (n) => ({ ...n, ai: "", done: false, stopped: undefined }));
    run(last.id, path, last.user, last.atts, last.mode);
  };

  const newSession = () => { onNew(); say("Đã tạo phiên mới"); };

  const addCtx = (items: { name: string; text: string; size: number; kind?: "file" | "doc" }[]) => {
    if (!items.length) return;
    items.forEach((it) => saveDoc(it.name.split("/").pop() ?? it.name, it.text));
    setCtx((c) => {
      const next = [...c];
      items.forEach((it, k) => {
        const i = next.findIndex((x) => x.name === it.name);
        const row = { id: Date.now() + k, kind: it.kind ?? "file", ...it } as Ctx;
        if (i >= 0) next[i] = { ...row, id: next[i].id, pinned: next[i].pinned }; else next.push(row);
      });
      return next;
    });
  };

  const ingest = async (list: { path: string; file: File }[], skipped: number) => {
    const out: { name: string; text: string; size: number }[] = [];
    let junk = skipped;
    for (const { path: p, file } of list) {
      if (file.size > 400_000 || BIN_EXT.test(p)) { ingestFile(file); out.push({ name: p, text: "", size: file.size }); continue; }
      try { { const r = redact((await file.text()).slice(0, 200_000)); if (r.count) say(`🛡️ Đã bảo vệ ${r.count} thông tin nhạy cảm trong ${p}`); out.push({ name: p, text: r.text, size: file.size }); } } catch { junk++; }
    }
    addCtx(out);
    say(`Đã thêm ${out.length} tệp vào ngữ cảnh${junk ? ` · bỏ qua ${junk} mục rác` : ""}`);
  };

  const ingestZip = async (f: File) => {
    try {
      const JSZip = (await import("jszip")).default;
      const z = await JSZip.loadAsync(f);
      const list: { path: string; file: File }[] = [];
      let skipped = 0;
      const root = f.name.replace(/\.zip$/i, "");
      for (const [name, e] of Object.entries(z.files)) {
        if (e.dir) continue;
        if (!isTextEntry(name)) { skipped++; continue; }
        const blob = await e.async("blob");
        list.push({ path: root + "/" + name, file: new File([blob], name.split("/").pop() ?? name) });
      }
      await ingest(list, skipped);
    } catch { say("Không đọc được tệp .zip"); }
  };

  const [upl, setUpl] = useState(false);
  const fm = useFileMenu(say);
  const onFiles = async (files: FileList | File[] | null) => {
    if (!files?.length) return;
    const arr = Array.from(files);
    const zips = arr.filter((f) => /\.zip$/i.test(f.name));
    const rest = arr.filter((f) => !/\.zip$/i.test(f.name));
    let skipped = 0;
    const list = rest.map((f) => ({ path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, file: f })).filter((x) => { const ok = isTextEntry(x.path); if (!ok) skipped++; return ok; });
    if (list.length || skipped) await ingest(list, skipped);
    for (const z of zips) await ingestZip(z);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setDragOn(false);
    const items = Array.from(e.dataTransfer.items ?? []);
    const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
    if (!entries.length) return onFiles(e.dataTransfer.files);
    const out: { path: string; file: File }[] = [];
    const skip = { n: 0 };
    for (const en of entries) {
      if (en.isFile && /\.zip$/i.test(en.name)) { const f = await new Promise<File>((res, rej) => (en as FileSystemFileEntry).file(res, rej)); await ingestZip(f); continue; }
      await readEntry(en, "", out, skip);
    }
    if (out.length || skip.n) await ingest(out, skip.n);
  };

  const mentionItems = useMemo(() => {
    if (!mention) return [] as { g: string; label: string; ins: string; ctxId?: number }[];
    const q = mention.q.toLowerCase();
    const items: { g: string; label: string; ins: string; ctxId?: number }[] = [];
    const files = ctx.filter((c) => c.kind === "file");
    files.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 6).forEach((c) => items.push({ g: "File", label: c.name, ins: c.name.split("/").pop() ?? c.name, ctxId: c.id }));
    const folders = Array.from(new Set(files.filter((c) => c.name.includes("/")).map((c) => c.name.split("/").slice(0, -1).join("/"))));
    folders.filter((f) => f.toLowerCase().includes(q)).slice(0, 4).forEach((f) => items.push({ g: "Folder", label: f + "/", ins: f + "/" }));
    if (q.length) files.forEach((c) => {
      for (const m of c.text.matchAll(/(?:function\s+|def\s+|func\s+)(\w+)|(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/g)) {
        const fn = m[1] || m[2];
        const short = c.name.split("/").pop() ?? c.name;
        if ((fn + short).toLowerCase().includes(q) && items.filter((x) => x.g === "Hàm").length < 5) items.push({ g: "Hàm", label: `${fn}()  ·  ${short}`, ins: `${short}#${fn}`, ctxId: c.id });
      }
    });
    if (files.length && (!q || "codebase".startsWith(q))) items.push({ g: "Codebase", label: "Codebase — tự chọn đoạn liên quan", ins: "codebase" });
    if (!q || "docs".startsWith(q)) items.push({ g: "Docs", label: "Dán link tài liệu…", ins: "" });
    return items;
  }, [mention, ctx]);

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setV(val);
    const m = val.slice(0, e.target.selectionStart).match(/(^|\s)@([\w.#\-/]*)$/);
    if (m) { setMention({ q: m[2], start: e.target.selectionStart - m[2].length - 1 }); setMi(0); } else { setMention(null); setDocMode(false); }
  };

  const pickMention = (it: { g: string; ins: string; ctxId?: number }) => {
    if (it.g === "Docs") { setDocMode(true); return; }
    if (!mention || !ta.current) return;
    const caret = ta.current.selectionStart;
    const next = v.slice(0, mention.start) + "@" + it.ins + " " + v.slice(caret);
    setV(next); setMention(null);
    if (it.ctxId) setCtx((c) => c.map((x) => (x.id === it.ctxId ? { ...x, off: false } : x)));
    setTimeout(() => { ta.current?.focus(); const p = mention.start + it.ins.length + 2; ta.current?.setSelectionRange(p, p); }, 0);
  };

  const addDoc = async (url: string) => {
    const u = url.trim();
    if (!u) return;
    let name = u;
    try { const x = new URL(/^https?:/.test(u) ? u : "https://" + u); name = x.hostname + (x.pathname !== "/" ? x.pathname : ""); } catch {}
    say("Đang tải tài liệu…");
    let text = `(Tài liệu liên kết) ${u}`;
    try { text = redact(await scrapeDoc(u)).text; } catch { say("Không tải được nội dung, chỉ lưu liên kết"); }
    addCtx([{ name, text, size: text.length, kind: "doc" }]);
    if (mention && ta.current) {
      const caret = ta.current.selectionStart;
      setV(v.slice(0, mention.start) + "@docs:" + name.slice(0, 30) + " " + v.slice(caret));
    }
    setMention(null); setDocMode(false);
    say("Đã thêm tài liệu vào ngữ cảnh");
  };

  const slashItems = /^\/[a-z]*$/.test(v) && !mention ? SLASH.filter((x) => x.cmd.startsWith(v)) : [];
  const onKey = (e: React.KeyboardEvent) => {
    if (slashItems.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSi((si + 1) % slashItems.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSi((si - 1 + slashItems.length) % slashItems.length); return; }
      if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); setV(slashItems[Math.min(si, slashItems.length - 1)].cmd + " "); return; }
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); send(v, atts, undefined, true); return; }
    if (mention && mentionItems.length && !docMode) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMi((mi + 1) % mentionItems.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMi((mi - 1 + mentionItems.length) % mentionItems.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(mentionItems[mi]); return; }
      if (e.key === "Escape") { setMention(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const t = e.clipboardData.getData("text");
    if (!t) return;
    const lines = t.split("\n").length;
    const r = redact(t);
    if (r.count) say(`🛡️ Đã bảo vệ ${r.count} thông tin nhạy cảm tại trình duyệt`);
    if (lines <= 15) {
      if (!r.count) return;
      e.preventDefault();
      const el = e.target as HTMLTextAreaElement;
      setV(v.slice(0, el.selectionStart) + r.text + v.slice(el.selectionEnd));
      return;
    }
    e.preventDefault();
    const info = analyzePaste(r.text);
    setAtts((a) => [...a, { k: info.type === "Stack trace" ? "error" : "paste", name: `${info.type} | Đã dán: ${lines} dòng`, text: r.text, pills: info.pills }]);
  };

  const addErr = () => {
    if (!errText.trim()) return;
    setAtts((a) => [...a, { k: "error", name: `Stack trace | Đã dán: ${errText.trim().split("\n").length} dòng`, text: redact(errText).text }]);
    setErrText(""); setMenu("");
    say("Đã phân tích log lỗi");
  };

  const openPanel = (b: { lang: string; code: string; name: string; run?: boolean }) => {
    const runnable = /^(html|js|javascript|py|python)$/i.test(b.lang);
    setPanel({ name: b.name, lang: b.lang, code: unredact(b.code), tab: b.run && runnable ? "preview" : "code", runnable });
  };
  const fixRef = useRef(0);
  const autoFix = (err: string, code: string, name: string) => {
    if (busy) return;
    fixRef.current = (panel?.fix ?? 0) + 1;
    send("🔧 Auto-Fix: code chạy bị lỗi", [], `Code trong ${name} chạy bị lỗi:\n${err}\n\nCode hiện tại:\n\`\`\`\n${redact(code).text}\n\`\`\`\nHãy trả về bản sửa hoàn chỉnh trong một code block.`);
  };
  useEffect(() => {
    if (busy || !fixRef.current) return;
    const last = path[path.length - 1];
    const b = last && last.done ? blocksOf(last.ai).filter((x) => /^(html|js|javascript|py|python)$/i.test(x.lang)).pop() : null;
    const n = fixRef.current; fixRef.current = 0;
    if (b) setPanel({ name: "fixed." + (/html/i.test(b.lang) ? "html" : /py/i.test(b.lang) ? "py" : "js"), lang: b.lang, code: unredact(b.code), tab: "preview", runnable: true, fix: n });
  }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps

  const onThreadUp = () => {
    setTimeout(() => {
      const s = window.getSelection();
      const text = s?.toString().trim();
      if (!s || s.isCollapsed || !text) return setSelBox(null);
      const el = s.anchorNode instanceof Element ? s.anchorNode : s.anchorNode?.parentElement;
      if (!el?.closest("[data-cb] pre")) return setSelBox(null);
      const r = s.getRangeAt(0).getBoundingClientRect();
      const full = el.closest("pre")?.textContent ?? "";
      const at = full.indexOf(text);
      setSelBox({ x: r.left + r.width / 2, y: r.top, text, line: at >= 0 ? full.slice(0, at).split("\n").length : 1 });
    }, 0);
  };
  const quote = (kind: "explain" | "fix" | "bug") => {
    if (!selBox) return;
    const n = selBox.text.split("\n").length;
    const a = selBox.line, b = a + n - 1;
    setAtts((x) => [...x, { k: "quote", name: `Trích dẫn: dòng ${a === b ? a : a + "-" + b}`, text: selBox.text.split("\n").map((l, i) => `${a + i}: ${l}`).join("\n") }]);
    setV(kind === "explain" ? "Giải thích đoạn này giúp tôi" : kind === "bug" ? "Dòng này bị lỗi, hãy tìm nguyên nhân và sửa: " : "Sửa lại đoạn này: ");
    setSelBox(null); window.getSelection()?.removeAllRanges();
    setTimeout(() => ta.current?.focus(), 0);
  };
  useEffect(() => {
    const h = () => setSelBox(null);
    const el = threadRef.current;
    el?.addEventListener("scroll", h, { passive: true });
    return () => el?.removeEventListener("scroll", h);
  }, [loaded]);

  const onScroll = () => {
    const el = threadRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const pickBranch = (parent: number, id: number) => {
    setSel((s) => ({ ...s, [parent]: id }));
    const snap = snapRef.current.get(id);
    if (snap) { setCtx(snap); say("Đã khôi phục tệp theo nhánh này"); }
  };
  const acceptFile = (name: string, code: string) => {
    setCtx((c) => c.some((x) => x.name === name || x.name.endsWith("/" + name)) ? c.map((x) => (x.name === name || x.name.endsWith("/" + name) ? { ...x, text: redact(code).text } : x)) : c);
  };
  const expandHidden = (name: string, code: string) => {
    send(`Viết đầy đủ tệp ${name}, thay mọi chỗ "existing code" bằng code thật.`, [], "Chỉ trả về tệp hoàn chỉnh trong một code block, không dùng placeholder.\n" + code.slice(0, 4000));
  };
  const summarize = () => {
    if (!path.length) return;
    const body = "**Tóm tắt phiên trước (đã làm gọn):**\n" + path.map((n) => "- " + unredact(n.user).replace(/\s+/g, " ").slice(0, 90)).join("\n") + (ctx.length ? `\n\nTệp trong ngữ cảnh: ${ctx.map((c) => c.name.split("/").pop()).join(", ")}` : "");
    const nd: Node = { id: Date.now(), parent: 0, user: "Tóm tắt & làm gọn luồng chat", atts: [], ai: body, done: true, mode, time: Date.now() };
    setNodes([nd]); setSel({}); setMenu("");
    say("Đã làm gọn luồng chat để giải phóng ngữ cảnh");
  };
  const lastCode = () => { for (let i = path.length - 1; i >= 0; i--) { const b = blocksOf(path[i].ai); if (b.length) return unredact(b[b.length - 1].code); } return ""; };
  const exportMd = () => {
    const md = path.map((n) => `## Bạn\n\n${unredact(n.user)}\n\n## Synchro Code\n\n${unredact(n.ai)}\n`).join("\n");
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    const a = document.createElement("a"); a.href = url; a.download = "synchro-code-chat.md"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
    say("Đã xuất cuộc trò chuyện .md");
  };
  const palItems = useMemo(() => {
    const q = (pal?.q ?? "").toLowerCase();
    const list: { t: string; d: string; f: () => void }[] = [
      ...MODES.map((x) => ({ t: "Chuyển chế độ: " + x.short, d: x.desc, f: () => { setMode(x.k); say("Chế độ " + x.short); } })),
      ...PRESETS.map((x) => ({ t: "Đổi luật: " + x.label, d: x.rule, f: () => { setRules({ ...rules, preset: x.k }); say("Đã áp dụng: " + x.label); } })),
      { t: "Xuất cuộc trò chuyện (.md)", d: "Tải về toàn bộ hội thoại", f: exportMd },
      { t: "Phiên mới", d: "Bắt đầu phiên code mới", f: newSession },
      ...path.filter((n) => n.user).map((n) => ({ t: "Tìm: " + unredact(n.user).slice(0, 60), d: "Nhảy tới tin nhắn này", f: () => document.getElementById("cv-n" + n.id)?.scrollIntoView({ behavior: "smooth", block: "center" }) })),
    ];
    return list.filter((x) => !q || (x.t + x.d).toLowerCase().includes(q)).slice(0, 9);
  }, [pal?.q, path, rules, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const hk = useRef<(e: KeyboardEvent) => void>(() => {});
  hk.current = (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault(); e.stopImmediatePropagation();
      const t = window.getSelection()?.toString().trim();
      if (t) {
        const r = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
        setInl({ x: Math.max(12, r.left), y: r.bottom + 8, text: t, v: "" });
      } else setPal({ q: "", i: 0 });
    } else if (mod && e.shiftKey && e.key.toLowerCase() === "c") {
      const c = lastCode();
      if (c) { e.preventDefault(); navigator.clipboard?.writeText(c); say("Đã sao chép code block cuối cùng"); }
    } else if (mod && e.shiftKey && e.key === "Backspace") {
      e.preventDefault(); setAtts([]); say("Đã xóa các tệp đính kèm");
    } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const bl = Array.from(document.querySelectorAll<HTMLElement>(".cv [data-cb]"));
      if (!bl.length) return;
      e.preventDefault();
      const mid = window.innerHeight / 2;
      const cur = bl.findIndex((b) => b.getBoundingClientRect().top > mid - 10);
      const idx = e.key === "ArrowDown" ? Math.min(bl.length - 1, cur < 0 ? bl.length - 1 : cur) : Math.max(0, (cur < 0 ? bl.length : cur) - 1);
      bl[idx].scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (e.key === "Escape") { setPal(null); setInl(null); setGuide(false); }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => hk.current(e);
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, []);
  const submitInline = () => {
    if (!inl || !inl.v.trim()) return;
    send(`Viết lại đoạn code đã chọn theo yêu cầu: ${inl.v}`, [{ k: "quote", name: "Trích dẫn: Inline Edit", text: inl.text }], "Trả về kết quả dạng một code block có dòng `// filepath:` để so sánh Diff.");
    setInl(null); window.getSelection()?.removeAllRanges();
  };

  const lastId = path.length ? path[path.length - 1].id : -1;
  const m = MODES.find((x) => x.k === mode) ?? MODES[1];
  const modeIcon = (k: string, s = 16) => (k === "plan" ? <I.Layers size={s} /> : k === "debug" ? <I.Alert size={s} /> : <I.Code size={s} />);
  const grp = (g: string) => mentionItems.filter((x) => x.g === g);

  return (
    <div className="cv" style={{ "--cv-font": cf ? `${cf}, ui-monospace, Menlo, monospace` : undefined, "--cv-fs": `${csz}px` } as React.CSSProperties} onDragOver={(e) => { e.preventDefault(); setDragOn(true); }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOn(false); }} onDrop={onDrop}>
      <div className="cv-col">
        <div className="cv-bar">
          <div className="cv-title"><I.Code size={16} />Synchro Code</div>
          <div className="cv-bar-r">
            <button className="chip cv-round" title="Hướng dẫn" aria-label="Hướng dẫn" onClick={() => setGuide(true)}><I.Help size={15} /><span className="cv-lb">Hướng dẫn</span></button>
            <div style={{ position: "relative" }} ref={menu === "rules" ? away : undefined}>
              <button className="chip cv-rule cv-round" title={ruleLabel} aria-label="Luật dự án" onClick={() => setMenu(menu === "rules" ? "" : "rules")}><I.Sliders size={15} /></button>
              <Menu open={menu === "rules"} className="cv-rules" style={{ top: 42, right: 0, width: 340 }}>
                <div className="cv-mh">Luật dự án cho phiên này</div>
                {PRESETS.map((p) => (
                  <button key={p.k} className={`menu-item cv-opt ${rules.preset === p.k ? "sel" : ""}`} onClick={() => { setRules({ ...rules, preset: p.k }); setMenu(""); say("Đã áp dụng: " + p.label); }}>
                    <span className="cv-opt-t">{p.label}<small>{p.rule}</small></span>{rules.preset === p.k && <span className="ck"><I.Check /></span>}
                  </button>
                ))}
                <hr />
                <div className="cv-custom">
                  <textarea rows={3} value={rules.custom} placeholder="Tự viết luật riêng, ví dụ: luôn dùng pnpm, comment bằng tiếng Việt…" onChange={(e) => setRules({ preset: "custom", custom: e.target.value })} />
                  <div className="cv-custom-r">
                    <button className="btn" onClick={() => { setRules({ preset: "none", custom: "" }); setMenu(""); }}>Bỏ luật</button>
                    <button className="btn dark" onClick={() => { setRules({ ...rules, preset: "custom" }); setMenu(""); say("Đã lưu luật tùy chỉnh"); }}>Lưu</button>
                  </div>
                </div>
              </Menu>
            </div>
            <button className="chip cv-round" title="Phiên mới" aria-label="Phiên mới" onClick={newSession}><I.Plus size={15} /><span className="cv-lb">Phiên mới</span></button>
          </div>
        </div>

        <div className="thread cv-thread" ref={threadRef} onScroll={onScroll} onMouseUp={onThreadUp}>
          {path.length === 0 ? (
            <div className="cv-empty">
              <div className="cv-hello"><I.Spark size={30} />Hôm nay bạn muốn xây dựng gì?</div>
              <div className="cv-sugg">
                {SUGGEST.map((s) => (
                  <button key={s.t} className="cv-card" onClick={() => { setV(s.q); ta.current?.focus(); }}><b>{s.t}</b><span>{s.d}</span></button>
                ))}
              </div>
            </div>
          ) : (
            <div className="thread-in cv-in">
              {path.map((n, i) => {
                const sibs = childrenOf(n.parent);
                const si = sibs.findIndex((x) => x.id === n.id);
                const prev = i > 0 ? blocksOf(path[i - 1].ai) : [];
                const prevAny = path.slice(0, i).reverse().map((x) => blocksOf(x.ai)).find((b) => b.length);
                return (
                  <div key={n.id} id={"cv-n" + n.id} className="cv-turn">
                    <div className="user-wrap">
                      {n.atts.length > 0 && <div className="cv-atts end">{n.atts.map((a, k) => <button key={k} className={`cv-att ${a.k}`} onClick={() => setViewer(a)}>{a.k === "error" ? <I.Alert size={14} /> : <I.Code size={14} />}{a.name}</button>)}</div>}
                      {editing?.id === n.id ? (
                        <div className="cv-edit">
                          <textarea autoFocus value={editing.text} rows={Math.min(6, editing.text.split("\n").length + 1)} onChange={(e) => setEditing({ id: n.id, text: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) branch(n, editing.text); if (e.key === "Escape") setEditing(null); }} />
                          <div className="cv-edit-r"><span>Gửi lại sẽ tạo nhánh mới, bản cũ vẫn được giữ.</span><button className="btn" onClick={() => setEditing(null)}>Hủy</button><button className="btn dark" onClick={() => branch(n, editing.text)}>Gửi nhánh mới</button></div>
                        </div>
                      ) : (
                        <div className="cv-user-row">
                          {!busy && <button className="icon-btn cv-edit-btn" onClick={() => setEditing({ id: n.id, text: n.user })} aria-label="Sửa và rẽ nhánh" title="Sửa và rẽ nhánh"><I.Pencil size={15} /></button>}
                          <div className="user-msg">{unredact(n.user)}</div>
                        </div>
                      )}
                      {sibs.length > 1 && (
                        <div className="cv-pager">
                          <button disabled={si === 0} onClick={() => pickBranch(n.parent, sibs[si - 1].id)} aria-label="Nhánh trước"><span style={{ display: "inline-flex", transform: "rotate(180deg)" }}><I.ChevronR size={13} /></span></button>
                          <span>{si + 1}/{sibs.length}</span>
                          <button disabled={si === sibs.length - 1} onClick={() => pickBranch(n.parent, sibs[si + 1].id)} aria-label="Nhánh sau"><I.ChevronR size={13} /></button>
                        </div>
                      )}
                    </div>
                    <div className="cv-ai">
                      <div className="cv-ai-h"><span className={`cv-mode m-${n.mode}`}>{modeIcon(n.mode, 13)}{MODES.find((x) => x.k === n.mode)?.short}</span></div>
                      <div className="ai-msg">{n.ai ? <Markdown text={n.ai} say={say} dev={{ prev: prev.length ? prev : prevAny, onPanel: openPanel, files: ctx, onAccept: acceptFile, onExpand: expandHidden }} /> : !n.done ? <Thinking label="Đang suy nghĩ…" /> : null}</div>
                      {n.stopped && <div className="cv-stopped"><I.Stop size={11} />Đã dừng · giữ lại phần đã viết</div>}
                      {n.done && n.ai && (
                        <div className="actions in">
                          <button className="icon-btn" onClick={() => { navigator.clipboard?.writeText(unredact(n.ai)); say("Đã sao chép"); }} aria-label="Sao chép"><I.Copy size={16} /></button>
                          {n.id === lastId && <button className="icon-btn" onClick={retry} aria-label="Thử lại"><I.Retry size={16} /></button>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="dock cv-dock" ref={away}>
          <div className="cv-wrap">
            {slashItems.length > 0 && (
              <div className="cv-mention">
                <div className="cv-mh">Lệnh nhanh</div>
                {slashItems.map((x, k) => (
                  <button key={x.cmd} className={`menu-item ${k === Math.min(si, slashItems.length - 1) ? "act" : ""}`} onMouseEnter={() => setSi(k)} onMouseDown={(e) => { e.preventDefault(); setV(x.cmd + " "); }}><b className="cv-cmd">{x.cmd}</b><span className="cv-ell">{x.desc}</span></button>
                ))}
              </div>
            )}
            {mention && (
              <div className="cv-mention">
                {docMode ? (
                  <div className="cv-doc"><div className="cv-mh">Thêm tài liệu từ link</div>
                    <input autoFocus placeholder="https://docs.example.com/api" onKeyDown={(e) => { if (e.key === "Enter") addDoc((e.target as HTMLInputElement).value); if (e.key === "Escape") { setDocMode(false); setMention(null); ta.current?.focus(); } }} />
                    <small>Nhấn Enter để thêm · Esc để hủy</small></div>
                ) : mentionItems.length === 0 ? <div className="cv-none">Chưa có tệp nào. Dùng + để tải tệp, thư mục hoặc .zip.</div> : (
                  ["Codebase", "File", "Hàm", "Folder", "Docs"].map((g) => grp(g).length > 0 && (
                    <div key={g}><div className="cv-mh">@{g === "Hàm" ? "Function" : g}</div>
                      {grp(g).map((it) => { const idx = mentionItems.indexOf(it); return (
                        <button key={it.g + it.label} className={`menu-item ${idx === mi ? "act" : ""}`} onMouseEnter={() => setMi(idx)} onMouseDown={(e) => { e.preventDefault(); pickMention(it); }}>
                          {g === "Codebase" ? <I.Layers size={16} /> : g === "Folder" ? <I.Folder size={16} /> : g === "Docs" ? <I.Globe size={16} /> : g === "Hàm" ? <I.Code size={16} /> : <I.Clip size={16} />}<span className="cv-ell">{it.label}</span>
                        </button>); })}
                    </div>
                  ))
                )}
              </div>
            )}
            <div className="composer cv-composer" data-drag={dragOn ? "1" : undefined}>
              {(ctx.length > 0 || atts.length > 0) && (
                <div className="cv-pills">
                  {ctx.length > 0 && (
                    <div className="attach cv-attach">{fm.node}
                      {ctx.map((c) => (
                        <div key={c.id} className={`cv-fc ${c.off ? "off" : ""} ${c.pinned ? "pin" : ""}`}>
                          <FileCard name={c.name.split("/").pop() ?? c.name} onContextMenu={(e) => fm.open(e, c.name.split("/").pop() ?? c.name)} onRemove={() => setCtx((x) => x.filter((y) => y.id !== c.id))} />
                          {c.pinned && <span className="cv-fc-pin"><I.Pin size={11} /></span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {atts.map((a, k) => (
                    <div key={k} className={`cv-pill att ${a.k}`}>
                      <button className="n" onClick={() => setViewer(a)} title="Xem lại">{a.k === "error" ? <I.Alert size={13} /> : <I.Code size={13} />}{a.name}</button>
                      <button onClick={() => setAtts((x) => x.filter((_, j) => j !== k))} aria-label="Xóa"><I.X size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
              {atts.some((a) => a.pills?.length) && (
                <div className="cv-acts">
                  {atts.flatMap((a) => a.pills ?? []).map((p) => <button key={p.label} onClick={() => send(p.label, atts, p.prompt)}>{p.label}</button>)}
                </div>
              )}
              <textarea ref={ta} rows={1} value={v} onChange={onChange} onKeyDown={onKey} onPaste={onPaste} placeholder="Viết tin nhắn…  gõ @ để chọn tệp, hàm hoặc tài liệu" />
              <div className="cv-tools">
                <div style={{ position: "relative" }}>
                  <button className="icon-btn" onClick={() => setMenu(menu === "plus" ? "" : "plus")} aria-label="Thêm ngữ cảnh"><I.Plus /></button>
                  {upl && <UploadModal say={say} onClose={() => setUpl(false)} onFiles={(f) => { setUpl(false); onFiles(f); }} />}
                  <Menu open={menu === "plus"} style={{ bottom: 42, left: 0, width: 258 }}>
                    <input ref={fileIn} type="file" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
                    <input ref={dirIn} type="file" hidden {...({ webkitdirectory: "", directory: "" } as object)} multiple onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
                    <input ref={zipIn} type="file" accept=".zip" hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
                    <button className="menu-item" onClick={() => { setMenu(""); setUpl(true); }}><I.Clip />Tải tệp lên</button>
                    <button className="menu-item" onClick={() => { setMenu(""); dirIn.current?.click(); }}><I.Folder />Tải cả thư mục</button>
                    <button className="menu-item" onClick={() => { setMenu(""); zipIn.current?.click(); }}><I.Layers />Tải tệp .zip</button>
                    <hr />
                    <div className="cv-hint">Tải lên mọi loại tệp, không tự lọc. Có thể kéo thả vào khung chat.</div>
                  </Menu>
                </div>
                <div style={{ position: "relative" }}>
                  <button className="cv-modebtn" onClick={() => setMenu(menu === "mode" ? "" : "mode")}>{modeIcon(mode, 15)}{m.short}<I.Chevron size={13} /></button>
                  <Menu open={menu === "mode"} className="cv-modes" style={{ bottom: 44, left: 0, width: 340 }}>
                    {MODES.map((x) => (
                      <button key={x.k} className={`cv-mode-item ${mode === x.k ? "sel" : ""}`} onClick={() => { setMode(x.k); setMenu(""); }}>
                        <span className={`cv-mode-ic m-${x.k}`}>{modeIcon(x.k, 18)}</span>
                        <span className="cv-opt-t">{x.label}<small>{x.desc}</small></span>
                        {mode === x.k && <span className="ck"><I.Check /></span>}
                      </button>
                    ))}
                  </Menu>
                </div>
                <div className="cv-sp" />
                <div style={{ position: "relative" }}>
                  <button className="icon-btn" title="Dán lỗi / stack trace" onClick={() => setMenu(menu === "err" ? "" : "err")} aria-label="Dán lỗi"><I.Alert size={18} /></button>
                  <Menu open={menu === "err"} className="cv-err" style={{ bottom: 44, right: -60, width: 440 }}>
                    <div className="cv-mh">Dán log lỗi / stack trace</div>
                    <textarea autoFocus rows={7} value={errText} onChange={(e) => setErrText(e.target.value)} placeholder={"TypeError: Cannot read properties of undefined\n    at login (src/lib/auth.ts:12:18)"} />
                    <div className="cv-custom-r"><button className="btn" onClick={() => { setErrText(""); setMenu(""); }}>Hủy</button><button className="btn dark" onClick={addErr} disabled={!errText.trim()}>Phân tích</button></div>
                  </Menu>
                </div>
                <div style={{ position: "relative" }}>
                  <button className={`cv-meter ${pct > 80 ? "hot" : pct > 50 ? "mid" : ""}`} onClick={() => setMenu(menu === "ctx" ? "" : "ctx")} title="Quản lý ngữ cảnh">
                    <span className="cv-ring" style={{ ["--p" as string]: pct }} />{fmtK(total)} / {fmtK(MAX_TOK)}
                  </button>
                  <Menu open={menu === "ctx"} className="cv-ctx" style={{ bottom: 44, right: 0, width: 360 }}>
                    <div className="cv-mh">Ngữ cảnh phiên chat</div>
                    <div className="cv-bar2"><i style={{ width: pct + "%" }} /></div>
                    {pct > 50 && <div className={`cv-warn ${pct > 80 ? "red" : "yel"}`}>{pct > 80 ? "Ngữ cảnh gần đầy." : "Ngữ cảnh đã dùng hơn một nửa."}<button onClick={summarize}>Tóm tắt & Làm gọn luồng chat</button></div>}
                    <div className="cv-stat"><span>Tệp {fmtK(ctxTok)}</span><span>Hội thoại {fmtK(histTok)}</span><span>Đang gõ {fmtK(draftTok)}</span></div>
                    {ctx.length === 0 ? <div className="cv-none">Chưa có tệp nào trong ngữ cảnh.</div> : (
                      <div className="cv-list">
                        {ctx.map((c) => (
                          <div key={c.id} className="cv-row">
                            <button className={`cv-sw ${c.off ? "" : "on"}`} onClick={() => setCtx((a) => a.map((x) => (x.id === c.id ? { ...x, off: !x.off } : x)))} aria-label="Bật/tắt"><i /></button>
                            <span className="cv-ell">{c.name}</span><em>{fmtK(tok(c.text))}</em>
                            <button className="icon-btn" onClick={() => setCtx((a) => a.map((x) => (x.id === c.id ? { ...x, pinned: !x.pinned } : x)))} aria-label="Ghim">{c.pinned ? <I.PinOff size={14} /> : <I.Pin size={14} />}</button>
                            <button className="icon-btn" onClick={() => setCtx((a) => a.filter((x) => x.id !== c.id))} aria-label="Xóa"><I.Trash size={14} /></button>
                          </div>
                        ))}
                      </div>
                    )}
                    {ctx.length > 0 && <div className="cv-custom-r"><button className="btn" onClick={() => setCtx((a) => a.filter((x) => x.pinned))}>Xóa tệp chưa ghim</button></div>}
                  </Menu>
                </div>
                <button className="send" disabled={!busy && !v.trim() && !atts.length} onClick={busy ? stopGen : () => send()} aria-label={busy ? "Dừng và giữ lại" : "Gửi"} title={busy ? "Dừng & giữ lại" : "Gửi"}>{busy ? <I.Stop /> : <I.Enter />}</button>
              </div>
              {dragOn && <div className="cv-drop">Thả tệp, thư mục hoặc .zip để thêm vào ngữ cảnh</div>}
            </div>
          </div>
          <div className="disclaimer dock-note"><span>Synchro Code có thể mắc lỗi. Hãy kiểm tra trước khi chạy code.</span></div>
        </div>
      </div>

      {panel && <SidePanel key={panel.name + panel.code.length} panel={panel} setPanel={setPanel} say={say} onFix={autoFix} />}

      {selBox && (
        <div className="cv-sel" style={{ left: selBox.x, top: selBox.y }} onMouseDown={(e) => e.preventDefault()}>
          <button onClick={() => quote("explain")}><I.Bulb size={14} />Giải thích đoạn này</button>
          <button onClick={() => { setInl({ x: selBox.x - 120, y: selBox.y + 28, text: selBox.text, v: "" }); setSelBox(null); }}><I.Pencil size={14} />Viết lại (Inline Edit)</button>
          <button onClick={() => quote("bug")}><I.Alert size={14} />Báo lỗi dòng này</button>
        </div>
      )}
      {inl && (
        <div className="cv-inl" style={{ left: inl.x, top: inl.y }}>
          <input autoFocus value={inl.v} placeholder="Bạn muốn sửa đoạn này thế nào?" onChange={(e) => setInl({ ...inl, v: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") submitInline(); if (e.key === "Escape") setInl(null); }} />
          <button onClick={submitInline}><I.Enter size={14} /></button>
        </div>
      )}
      {guide && typeof document !== "undefined" && createPortal(
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setGuide(false); }}>
          <div className="modal cv-guide">
            <div className="cvg-head">
              <span className="cvg-logo"><I.Code size={20} /></span>
              <div><h2>Hướng dẫn sử dụng Synchro Code</h2><p>Mọi thứ bạn cần để làm việc hiệu quả với trợ lý lập trình</p></div>
              <button className="icon-btn" onClick={() => setGuide(false)} aria-label="Đóng"><I.X size={18} /></button>
            </div>
            <div className="cvg-main">
              <nav className="cvg-nav">
                {GUIDE_TABS.map((t) => <button key={t.k} className={gt === t.k ? "on" : ""} onClick={() => setGt(t.k)}>{t.i}<span>{t.l}</span></button>)}
              </nav>
              <div className="cvg-body" key={gt}>
                {gt === "start" && <>
                  <div className="cvg-hero"><b>Bắt đầu chỉ với 3 bước</b><span>Mô tả việc cần làm — Synchro Code lo phần còn lại.</span></div>
                  <div className="cvg-steps">
                    <div><i>1</i><b>Mô tả yêu cầu</b><span>Gõ vào khung chat, nhấn <kbd>↵</kbd> để gửi, <kbd>Shift</kbd>+<kbd>↵</kbd> để xuống dòng.</span></div>
                    <div><i>2</i><b>Đính kèm ngữ cảnh</b><span>Nút <b>+</b> để thêm tệp, thư mục hoặc .zip. Có thể kéo thả thẳng vào khung chat.</span></div>
                    <div><i>3</i><b>Xem &amp; chạy kết quả</b><span>Code hiện trong khung xem trước, chạy thử ngay và tự sửa lỗi nếu có.</span></div>
                  </div>
                  <div className="cvg-card"><h4><I.Folder size={16} />Phiên làm việc</h4><p>Nút <b>Phiên mới</b> tạo phiên code mới. Mọi phiên được lưu ở thanh bên theo thứ tự <b>Đã ghim → Code → Đoạn chat</b>, đổi tên, ghim hay xóa như hội thoại thường.</p></div>
                  <div className="cvg-card"><h4><I.Sliders size={16} />Luật dự án</h4><p>Nút bên trái <b>Phiên mới</b> cho chọn stack có sẵn hoặc tự viết luật riêng (ví dụ “luôn dùng pnpm”). Luật được gắn vào mọi yêu cầu.</p></div>
                </>}
                {gt === "modes" && <>
                  <div className="cvg-hero"><b>3 chế độ làm việc</b><span>Chọn bằng nút chế độ cạnh khung chat.</span></div>
                  <div className="cvg-grid3">
                    <div className="cvg-mode"><span className="ic b"><I.Layers size={20} /></span><b>Plan</b><span>Chỉ phân tích cấu trúc và lập kế hoạch từng bước, không viết code. Hợp khi bắt đầu dự án.</span></div>
                    <div className="cvg-mode"><span className="ic g"><I.Code size={20} /></span><b>Code</b><span>Sinh code hoàn chỉnh, chạy được, kèm ghi chú ngắn. Chế độ mặc định.</span></div>
                    <div className="cvg-mode"><span className="ic r"><I.Alert size={20} /></span><b>Debug</b><span>Đọc kỹ lỗi/log, liệt kê 3 giả thuyết nguyên nhân rồi mới đề xuất cách sửa.</span></div>
                  </div>
                  <div className="cvg-card"><h4><I.Enter size={16} />Chế độ nghiêm ngặt</h4><p>Nhấn <kbd>Ctrl/⌘</kbd>+<kbd>↵</kbd> để gửi — Synchro chỉ trả lời đúng yêu cầu, không giải thích thừa.</p></div>
                </>}
                {gt === "cmd" && <>
                  <div className="cvg-hero"><b>Lệnh nhanh &amp; nhắc đến</b><span>Gõ <code>/</code> hoặc <code>@</code> vào khung chat để mở menu.</span></div>
                  <h4 className="cvg-h">Lệnh <code>/</code></h4>
                  <div className="cvg-list">{SLASH.map((x) => <div key={x.cmd}><code>{x.cmd}</code><span>{x.desc}</span></div>)}</div>
                  <h4 className="cvg-h">Nhắc đến <code>@</code></h4>
                  <div className="cvg-list">
                    <div><code>@Codebase</code><span>Tự chọn các hàm/lớp liên quan nhất trong tệp đã đính kèm (phân tích bằng tree-sitter).</span></div>
                    <div><code>@Docs</code><span>Dán URL tài liệu, Synchro tải nội dung về làm ngữ cảnh.</span></div>
                    <div><code>@tên-tệp</code><span>Nhắc đến một tệp trong ngữ cảnh.</span></div>
                  </div>
                  <p className="cvg-tip">Dùng <kbd>↑</kbd> <kbd>↓</kbd> để chọn, <kbd>Tab</kbd> hoặc <kbd>↵</kbd> để chèn vào khung chat.</p>
                </>}
                {gt === "keys" && <>
                  <div className="cvg-hero"><b>Phím tắt</b><span>Trên Windows/Linux dùng <kbd>Ctrl</kbd>, trên Mac dùng <kbd>⌘</kbd>.</span></div>
                  <div className="cvg-keys">
                    {([["↵", "Gửi tin nhắn"], ["Shift ↵", "Xuống dòng"], ["Ctrl/⌘ ↵", "Gửi ở chế độ nghiêm ngặt"], ["Ctrl/⌘ K", "Đang bôi chọn: Inline Edit · Không: bảng lệnh nhanh"], ["Ctrl/⌘ Shift C", "Sao chép code block gần nhất"], ["Ctrl/⌘ Shift ⌫", "Dừng/xóa luồng đang chạy"], ["Alt ↑ / ↓", "Nhảy giữa các code block"], ["Tab ↑ ↓", "Chọn mục trong menu / và @"], ["Esc", "Đóng bảng/menu đang mở"]] as [string, string][]).map(([k, d]) => (
                      <div key={k}><span>{k.split(" ").map((x, i) => <kbd key={i}>{x}</kbd>)}</span><em>{d}</em></div>
                    ))}
                  </div>
                </>}
                {gt === "run" && <>
                  <div className="cvg-hero"><b>Code block &amp; chạy thử</b><span>Mỗi khối code đều có thanh công cụ riêng.</span></div>
                  <div className="cvg-grid2">
                    <div className="cvg-card"><h4><I.Code size={16} />Tên tệp &amp; diff</h4><p>Tên tệp lấy từ dòng <code>// filepath:</code>. Có nút sao chép, tải xuống và <b>Chấp nhận / Từ chối</b> thay đổi.</p></div>
                    <div className="cvg-card"><h4><I.Layers size={16} />Ghép code tự động</h4><p><code>// ... existing code ...</code> được tự ghép vào tệp gốc; <b>Bung đoạn code bị ẩn</b> để xem đầy đủ.</p></div>
                    <div className="cvg-card"><h4><I.Check size={16} />Chạy ngay</h4><p><b>HTML/JS</b> trong khung xem trước · <b>Python</b> bằng Pyodide · <b>Node</b> bằng WebContainer · tùy chọn <b>sandbox server</b> (E2B).</p></div>
                    <div className="cvg-card"><h4><I.Alert size={16} />Auto-Fix</h4><p>Khi chạy lỗi, thanh <b>🔧 Auto-Fix</b> tự sửa và chạy lại tối đa 3 lần.</p></div>
                    <div className="cvg-card"><h4><I.Search size={16} />Bôi chọn code</h4><p>Bôi chọn để <b>Giải thích</b>, <b>Inline Edit</b> hoặc <b>Báo lỗi dòng này</b> (kèm số dòng).</p></div>
                    <div className="cvg-card"><h4><I.Folder size={16} />Sơ đồ Mermaid</h4><p>Khối <code>mermaid</code> được vẽ thành sơ đồ, phóng to/thu nhỏ, tải SVG/PNG.</p></div>
                  </div>
                </>}
                {gt === "ctx" && <>
                  <div className="cvg-hero"><b>Ngữ cảnh &amp; nhánh hội thoại</b><span>Kiểm soát những gì Synchro nhìn thấy.</span></div>
                  <div className="cvg-grid2">
                    <div className="cvg-card"><h4><I.Layers size={16} />Thanh token</h4><p>Hiển thị mức dùng ngữ cảnh. Khi đầy, bấm <b>Tóm tắt &amp; Làm gọn luồng chat</b>.</p></div>
                    <div className="cvg-card"><h4><I.Folder size={16} />Tệp ngữ cảnh</h4><p>Tắt/bật từng tệp đã đính kèm để tiết kiệm token.</p></div>
                    <div className="cvg-card"><h4><I.Enter size={16} />Nhánh hội thoại</h4><p>Sửa tin nhắn cũ để tạo nhánh mới, chuyển qua lại bằng <b>‹ 1/2 ›</b>.</p></div>
                    <div className="cvg-card"><h4><I.Search size={16} />Bảng lệnh</h4><p><kbd>Ctrl/⌘</kbd>+<kbd>K</kbd> để tìm lịch sử, đổi model/chế độ, xuất <code>.md</code>.</p></div>
                  </div>
                </>}
                {gt === "safe" && <>
                  <div className="cvg-hero"><b>Bảo mật &amp; tiện ích</b><span>Synchro tự bảo vệ dữ liệu nhạy cảm của bạn.</span></div>
                  <div className="cvg-grid2">
                    <div className="cvg-card"><h4><I.Shield size={16} />Secret Vault</h4><p>API key, token, mật khẩu được thay bằng thẻ <code>&lt;REDACTED_KEY_N&gt;</code> trước khi gửi và chỉ hiện lại trên máy bạn.</p></div>
                    <div className="cvg-card"><h4><I.Check size={16} />Kiểm tra gói</h4><p>Gói <code>npm</code>/<code>pip</code>/<code>cargo</code> được kiểm tra có tồn tại để phát hiện gói giả.</p></div>
                    <div className="cvg-card"><h4><I.Code size={16} />Dán nhiều dòng</h4><p>Dán hơn 15 dòng sẽ gom thành thẻ gọn kèm gợi ý hành động.</p></div>
                    <div className="cvg-card"><h4><I.Sliders size={16} />Tiện ích</h4><p>Giải nghĩa cron, thử regex, huy hiệu độ phức tạp thời gian/bộ nhớ cho thuật toán.</p></div>
                  </div>
                </>}
              </div>
            </div>
          </div>
        </div>,
        document.body)}
      {pal && (
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setPal(null); }}>
          <div className="cv-pal">
            <input autoFocus value={pal.q} placeholder="Gõ lệnh: chuyển model/chế độ, tìm lịch sử, xuất .md…" onChange={(e) => setPal({ q: e.target.value, i: 0 })}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setPal({ ...pal, i: (pal.i + 1) % Math.max(1, palItems.length) }); }
                if (e.key === "ArrowUp") { e.preventDefault(); setPal({ ...pal, i: (pal.i - 1 + palItems.length) % Math.max(1, palItems.length) }); }
                if (e.key === "Enter") { palItems[pal.i]?.f(); setPal(null); }
              }} />
            {palItems.map((x, k) => <button key={x.t + k} className={k === pal.i ? "act" : ""} onMouseEnter={() => setPal({ ...pal, i: k })} onClick={() => { x.f(); setPal(null); }}><b>{x.t}</b><small>{x.d}</small></button>)}
          </div>
        </div>
      )}

      {viewer && (
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setViewer(null); }}>
          <div className="modal cv-modal">
            <div className="cv-mh big">{viewer.k === "error" ? <I.Alert size={16} /> : <I.Code size={16} />}{viewer.name}<button className="icon-btn" onClick={() => setViewer(null)} aria-label="Đóng"><I.X size={16} /></button></div>
            {viewer.k === "error" ? <ErrView text={viewer.text} /> : <pre className="cv-trace plain">{viewer.text}</pre>}
          </div>
        </div>
      )}
    </div>
  );
}

const MONACO_LANG: Record<string, string> = { ts: "typescript", tsx: "typescript", typescript: "typescript", js: "javascript", jsx: "javascript", javascript: "javascript", py: "python", python: "python", html: "html", css: "css", json: "json", go: "go", rust: "rust", rs: "rust", sh: "shell", bash: "shell", sql: "sql", yaml: "yaml", java: "java", md: "markdown" };
type Tier = "frame" | "pyodide" | "webcontainer";

function SidePanel({ panel, setPanel, say, onFix }: { panel: Panel; setPanel: (p: Panel | null) => void; say: Say; onFix: (err: string, code: string, name: string) => void }) {
  const [code, setCode] = useState(panel.code);
  const [nonce, setNonce] = useState(0);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<(RunResult & { tier: string }) | null>(null);
  const [running, setRunning] = useState(false);
  const isPy = /^(py|python)$/i.test(panel.lang);
  const tier: Tier = isPy ? "pyodide" : /^(html)$/i.test(panel.lang) ? "frame" : nodeNeedsContainer(code) ? "webcontainer" : "frame";
  const [edTheme] = usePref("codeEdTheme", "Auto");
  const [edFont] = usePref("codeFont", "");
  const [edSize] = usePref("codeSize", "13");
  const dark = edTheme === "Dark" || (edTheme === "Auto" && typeof document !== "undefined" && document.documentElement.dataset.theme === "dark");

  useEffect(() => {
    const h = (e: MessageEvent) => { if (e.data?.nx === "err") setErr((x) => x || String(e.data.m).slice(0, 400)); };
    window.addEventListener("message", h);
    return () => window.removeEventListener("message", h);
  }, []);
  useEffect(() => { if (err && (panel.fix ?? 0) > 0 && (panel.fix ?? 0) < 3) onFix(err, code, panel.name); }, [err]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setErr(""); setRes(null); }, [nonce, code]);

  const execute = async (server = false) => {
    setRunning(true); setErr(""); setRes(null);
    const r = server ? await runServer(panel.lang, code) : tier === "pyodide" ? await runPython(code) : await runNode(code);
    setRes({ ...r, tier: server ? "E2B (server)" : tier === "pyodide" ? "Pyodide" : "WebContainer" });
    if (r.err) setErr(r.err.slice(0, 400));
    setRunning(false);
  };
  useEffect(() => {
    if (panel.tab === "preview" && tier !== "frame") execute();
  }, [nonce, panel.tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const doc = useMemo(() => {
    const hook = `<script>addEventListener("error",e=>parent.postMessage({nx:"err",m:e.message},"*"));const __ce=console.error;console.error=(...a)=>{parent.postMessage({nx:"err",m:a.join(" ")},"*");__ce(...a)}<\/script>`;
    if (/^html$/i.test(panel.lang)) return hook + code;
    const safe = code.replace(/<\/script/gi, "<\\/script");
    return `<body style="font:13px ui-monospace,Menlo,monospace;padding:14px;color:#222"><pre id="o" style="margin:0;white-space:pre-wrap"></pre><script>const o=document.getElementById("o");const lg=(...a)=>{o.textContent+=a.map(x=>typeof x==="object"?JSON.stringify(x):String(x)).join(" ")+"\\n"};console.log=lg;console.error=(...a)=>{lg("✖",...a);parent.postMessage({nx:"err",m:a.join(" ")},"*")};try{${safe}\n}catch(e){lg("✖",e.message);parent.postMessage({nx:"err",m:e.message},"*")}<\/script></body>`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, nonce, panel.lang]);
  const download = () => {
    const url = URL.createObjectURL(new Blob([code], { type: "text/plain" }));
    const a = document.createElement("a"); a.href = url; a.download = panel.name.split("/").pop() || panel.name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  };
  const lines = code.split("\n").length;
  const goPreview = () => { setNonce((n) => n + 1); setPanel({ ...panel, tab: "preview" }); };
  return (
    <aside className="cv-panel">
      <div className="cv-ph">
        <div className="cv-pn"><I.Code size={15} /><b>{panel.name}</b></div>
        {panel.runnable && (
          <div className="cv-tabs">
            <button className={panel.tab === "code" ? "on" : ""} onClick={() => setPanel({ ...panel, tab: "code" })}>Mã</button>
            <button className={panel.tab === "preview" ? "on" : ""} onClick={goPreview}>{tier === "frame" ? "Xem trước" : "Chạy"}</button>
          </div>
        )}
        <div className="cv-ph-r">
          {panel.runnable && <button className="icon-btn" onClick={goPreview} aria-label="Chạy lại" title="Chạy lại"><I.Retry size={16} /></button>}
          <button className="icon-btn" onClick={() => { navigator.clipboard?.writeText(code); say("Đã sao chép mã"); }} aria-label="Sao chép"><I.Copy size={16} /></button>
          <button className="icon-btn" onClick={download} aria-label="Tải về"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M8 2v8M5 7l3 3 3-3M3 13h10" /></svg></button>
          <button className="icon-btn" onClick={() => setPanel(null)} aria-label="Đóng"><I.X size={16} /></button>
        </div>
      </div>
      {panel.tab === "preview" && err && (
        <div className="cv-fixbar"><span title={err}>✖ {err.slice(0, 90)}</span><button onClick={() => onFix(err, code, panel.name)}>🔧 Auto-Fix</button></div>
      )}
      {panel.tab === "preview" ? (
        tier === "frame" ? <iframe key={nonce} className="cv-frame" sandbox="allow-scripts" srcDoc={doc} title="Xem trước" /> : (
          <div className="cv-term">
            <div className="cv-term-h">{running ? "Đang chạy…" : res ? `Chạy bằng ${res.tier}` : ""}{!running && (res?.err || tier === "webcontainer") && <button onClick={() => execute(true)}>Chạy trên sandbox server</button>}</div>
            <pre>{res ? res.out + (res.err ? "\n" : "") : ""}{res?.err && <span className="bad">{res.err}</span>}{res && !res.out && !res.err ? "(không có đầu ra)" : ""}</pre>
          </div>
        )
      ) : (
        <div className="cv-ed mon">
          <Monaco height="100%" theme={dark ? "vs-dark" : "light"} language={MONACO_LANG[panel.lang.toLowerCase()] ?? "plaintext"} value={code} onChange={(v) => setCode(v ?? "")} options={{ minimap: { enabled: false }, fontSize: Number(edSize) || 13, fontFamily: edFont ? `${edFont}, ui-monospace, Menlo, monospace` : undefined, scrollBeyondLastLine: false, automaticLayout: true, wordWrap: "on", padding: { top: 10 } }} />
        </div>
      )}
      <div className="cv-pf"><span>{panel.lang || "text"} · {lines} dòng{panel.runnable && tier !== "frame" ? ` · ${tier === "pyodide" ? "Pyodide" : "WebContainer"}` : ""}</span><span>{code !== panel.code ? "Đã chỉnh sửa" : "Có thể chỉnh sửa trực tiếp"}</span></div>
    </aside>
  );
}

export { fileNameFor };
