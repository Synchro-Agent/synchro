"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as I from "./icons";
import { Menu, Thinking } from "./ui";
import { SideToggle } from "./brand";
import { Markdown, fileNameFor, type DevBlock } from "./md";
import { callLLM, getActiveEffort, hasLLM, LLMError, takeSkillsUsed, type LLMMsg } from "./llm";
import { ls } from "./userscope";
import { tr } from "./i18n";
import { usePref, useApp } from "./store";
import { redact, unredact, analyzePaste, SLASH, balanceBraces, type Pill } from "./devtools";
import { useDev, type Panel } from "./devstore";
import { countTokens, loadEncoder, pickRelevantTS, runPython, runNode, runServer, nodeNeedsContainer, scrapeDoc, type RunResult } from "./heavy";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import { UploadModal } from "./modals";
import { FileCard } from "./fileicon";
import { useFileMenu, saveDoc } from "./filemenu";
import { capFiles, fileContext, getStatus, ingestFile, readyFiles } from "./filestate";
import { AgentSteps, GitHubButton, StatusLine, stripPhases, TaskCard, TVIEW_LABEL, type AStep, type OnAnswer, type TView } from "./agentui";
import { answerAsk, codePrefsNow, getServerSession, mergeSession, pushSession, sessionBase, setSessionBase, useCodePrefs, type SessionState } from "./codesync";
import { STYLE_DESC, STYLE_LABEL, STYLE_SYS, isStyle, type CodeStyle } from "./codestyle";
import type { PermMode } from "./codestore";
import { refreshUsage, UsageRing } from "./usageui";
import { BrowserPane, FilesPane, SessionRail, TerminalPane } from "./codepanes";
import { gitOp, streamAgent, useCodeUi, wsStatus, type PaneKind, type PlanItem } from "./wsclient";
import { QueueChips, type Queued } from "./worklog";
const Monaco = dynamic(() => import("@monaco-editor/react"), { ssr: false, loading: () => <div className="cv-ed-load">Đang tải Monaco…</div> });

type Att = { k: "paste" | "error" | "quote"; name: string; text: string; pills?: Pill[] };
// steps/plan: lượt trả lời do agent (có workspace) làm: đoạn văn xen kẽ công cụ, và danh sách việc.
/** files: tệp / thư mục gửi kèm (tên trong filestate; Synchro Code chép nguyên vào workspace .synchro/uploads). */
type Sent = { name: string; folder?: boolean; count?: number; id?: string };
type Node = { id: number; parent: number; user: string; hid?: string; atts: Att[]; files?: Sent[]; ai: string; done: boolean; stopped?: boolean; mode: string; time: number; skills?: string[]; steps?: AStep[]; plan?: PlanItem[]; usage?: { input: number; output: number }; auto?: boolean };
// Chế độ quyền của phiên: hỏi trước mọi thay đổi / tự sửa tệp (hỏi trước khi chạy lệnh) / tự động (không hỏi).
const PERMS: { k: PermMode; label: string; short: string; desc: string }[] = [
  { k: "ask", label: "Hỏi trước", short: "Hỏi trước", desc: "Hỏi bạn trước mỗi lần sửa tệp hay chạy lệnh (lệnh chỉ đọc như xem, tìm, git status thì không hỏi)." },
  { k: "edits", label: "Tự sửa tệp", short: "Tự sửa tệp", desc: "Tự sửa tệp, chỉ hỏi trước khi chạy lệnh có thể thay đổi máy (cài gói, xóa, push…)." },
  { k: "auto", label: "Tự động", short: "Tự động", desc: "Không hỏi gì: Synchro tự sửa tệp và chạy lệnh để làm xong việc." },
];
const permIcon = (k: PermMode, s = 14) => (k === "ask" ? <I.Shield size={s} /> : k === "edits" ? <I.M icon="Pencil" size={s} /> : <I.M icon="Rocket" size={s} />);
export type CodeMeta = { state?: SessionState; reason?: string | null; running?: boolean };
type Ctx = { id: number; name: string; text: string; size: number; kind: "file" | "doc"; pinned?: boolean; off?: boolean };
type Say = (m: string) => void;

const MAX_TOK = 128_000;
export const MODES = [
  { k: "auto", label: "Tự động", short: "Auto", desc: "Tự lập kế hoạch, viết code hay gỡ lỗi theo từng việc, và chuyển qua lại khi đang làm." },
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
  // Tự động: làm như một kỹ sư giàu kinh nghiệm, tự chọn và đổi giai đoạn theo diễn biến công việc.
  auto: [
    "Chế độ Tự động: tự quyết cách làm cho từng yêu cầu như một kỹ sư phần mềm giàu kinh nghiệm, và chuyển giai đoạn bất cứ lúc nào công việc đòi hỏi.",
    "- Lập kế hoạch (plan): yêu cầu lớn, mơ hồ, chạm nhiều tệp hoặc cần chọn kiến trúc → nêu kế hoạch ngắn gọn từng bước (dùng update_plan nếu có), rồi thực hiện ngay, không chờ hỏi lại trừ khi thật sự thiếu thông tin quan trọng.",
    "- Viết code (code): việc đã rõ → viết code hoàn chỉnh, chạy được; có workspace thì sửa tệp và chạy thử để chắc chắn.",
    "- Gỡ lỗi (debug): có lỗi, log, stack trace, test hỏng, hoặc chạy thử thấy sai → đọc kỹ lỗi, nêu các giả thuyết theo khả năng, kiểm chứng, sửa nhỏ nhất, chạy lại để xác nhận đã hết lỗi.",
    "- Chuyển linh hoạt trong cùng một lượt: viết xong chạy thử thấy lỗi thì gỡ lỗi luôn; đang làm mà phát hiện việc lớn hơn dự tính thì dừng lại lập kế hoạch rồi làm tiếp. Không dừng giữa chừng chỉ để hỏi xin chuyển chế độ.",
    "- Mỗi khi bắt đầu hoặc đổi giai đoạn, đặt một dòng ẩn riêng đúng dạng <!-- mode:plan -->, <!-- mode:code --> hoặc <!-- mode:debug --> ngay trước phần đó để giao diện hiện đúng giai đoạn.",
  ].join("\n"),
  plan: "Chế độ Architect/Plan: chỉ phân tích cấu trúc, đề xuất kế hoạch từng bước. TUYỆT ĐỐI không viết code dài (tối đa vài dòng minh họa).",
  code: "Chế độ Write/Code: sinh code hoàn chỉnh, chạy được, kèm ghi chú ngắn.",
  debug: "Chế độ Debug: đọc kỹ lỗi/log. Trước hết liệt kê 3 giả thuyết nguyên nhân (xếp theo khả năng), rồi mới đề xuất bản sửa nhỏ nhất.",
};
/** Giai đoạn mở đầu đoán từ yêu cầu (model vẫn tự đổi khi làm). */
export function guessMode(text: string, atts: { k?: string; text?: string }[] = []): "plan" | "code" | "debug" {
  const t = text.toLowerCase();
  if (atts.some((a) => a.k === "error") || /(lỗi|error|exception|traceback|stack ?trace|bug|crash|fail|không chạy|ko chạy|chạy sai|bị sai|undefined is not|cannot read|segfault|panic|debug|sửa lỗi|fix)/.test(t)) return "debug";
  if (/(kế hoạch|lập kế hoạch|kiến trúc|thiết kế hệ thống|plan\b|architect|roadmap|nên dùng|so sánh|phân tích|đề xuất cách|cấu trúc dự án|how should|trade-?off|chiến lược)/.test(t) || (t.length > 600 && (t.match(/\n\s*[-*\d]/g)?.length ?? 0) >= 4)) return "plan";
  return "code";
}
const PHASE_RE = /<!--\s*mode:\s*(plan|code|debug)\s*-->/g;
/** Các giai đoạn model đã đi qua trong câu trả lời, theo thứ tự (bỏ trùng liền kề). */
export const phasesOf = (text: string) => [...text.matchAll(PHASE_RE)].map((m) => m[1]).filter((x, i, a) => x !== a[i - 1]);

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

// Đọc cả thư mục được kéo thả (giữ nguyên mọi tệp và cấu trúc, chỉ bỏ tệp rác của hệ điều hành).
async function readEntry(en: FileSystemEntry, base: string, out: { path: string; file: File }[]) {
  if (en.isFile) {
    if (en.name === ".DS_Store" || en.name === "Thumbs.db") return;
    out.push({ path: base + en.name, file: await new Promise<File>((res, rej) => (en as FileSystemFileEntry).file(res, rej)) });
  } else if (en.isDirectory) {
    const rd = (en as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => rd.readEntries(res, rej));
      if (!batch.length) break;
      for (const c of batch) await readEntry(c, base + en.name + "/", out);
    }
  }
}

// Việc agent đã làm ở một lượt cũ (đọc / sửa tệp, lệnh, trình duyệt): gửi kèm câu trả lời trong lịch sử, để model khác tiếp quản
// (chế độ Tự động đổi model giữa các câu) vẫn biết đã làm gì, không hỏi lại hay làm lại từ đầu.
function workLog(steps?: AStep[]) {
  const ts = (steps ?? []).filter((x): x is Extract<AStep, { k: "tool" }> => x.k === "tool" && x.name !== "update_plan").slice(-40);
  if (!ts.length) return "";
  const one = (v: unknown) => String(v).replace(/\s+/g, " ").slice(0, 140);
  const arg = (t: (typeof ts)[number]) => (typeof t.input.path === "string" ? ` ${one(t.input.path)}` : typeof t.input.command === "string" ? ` \`${one(t.input.command)}\`` : typeof t.input.url === "string" ? ` ${one(t.input.url)}` : typeof t.input.pattern === "string" ? ` "${one(t.input.pattern)}"` : "");
  const rows = ts.map((t) => `- ${t.name}${arg(t)} → ${t.ok === false ? "lỗi" : "xong"}${t.diff ? ` (+${t.diff.add} −${t.diff.del})` : ""}${t.summary && !t.diff ? `: ${one(t.summary)}` : ""}`);
  return `\n\n<tool_activity>\nỞ lượt này đã dùng công cụ trong workspace (tóm tắt, không cần làm lại):\n${rows.join("\n")}\n</tool_activity>`;
}

export function CodeView({ say, sid, title, model, modelPicker, sideOpen, onSide, onCreate, onNew, onEmpty, onMeta }: { say: Say; onEmpty: (e: boolean) => void; sid: number | null; title: string; model: string; modelPicker: React.ReactNode; sideOpen: boolean; onSide: () => void; onCreate: (id: number, title: string) => void; onNew: () => void; onMeta?: (id: number, m: CodeMeta) => void }) {
  const app = useApp();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [sel, setSel] = useState<Record<number, number>>({});
  const [ctx, setCtx] = useState<Ctx[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = usePref("codeMode", "auto");
  // Chế độ quyền, kiểu trả lời, kiểu xem của phiên (null: theo mặc định ở Cài đặt → Synchro Code); gợi ý câu nhắn tiếp sau mỗi lượt.
  const cp = useCodePrefs();
  const cpRef = useRef(cp); cpRef.current = cp;
  const [perm, setPerm] = useState<{ mode: PermMode; allow: string[] } | null>(null);
  const [style, setStyle] = useState<CodeStyle | null>(null);
  const [viewDef] = usePref<TView>("codeView", "normal");
  const [view, setView] = useState<TView | null>(null);
  const [suggest, setSuggest] = useState("");
  const permNow = perm ?? { mode: cp ? (cp.permMode === "auto" && !cp.allowBypass ? "edits" : cp.permMode) : "auto", allow: [] };
  const permRef = useRef(permNow); permRef.current = permNow;
  const styleNow: CodeStyle = style ?? cp?.style ?? "default";
  const viewNow: TView = view ?? viewDef;
  const titleRef = useRef(title); titleRef.current = title;
  const skipPush = useRef(false), pushed = useRef("");
  // Tin nhắn gửi trong lúc agent đang làm (ghép vào lượt / gửi sau) và phiên của lượt agent đang chạy.
  const [cq, setCq] = useState<Queued[]>([]);
  const agentSid = useRef<number | string | null>(null);
  const [cf] = usePref("codeFont", "");
  const [csz] = usePref("codeSize", "13");
  const [rules, setRules] = usePref("codeRules", { preset: "next", custom: "" });
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState("");
  const [atts, setAtts] = useState<Att[]>([]);
  // Tệp / thư mục / .zip đính kèm tin nhắn đang soạn (thẻ giống Claude), gửi đi cùng tin nhắn rồi dọn khỏi khung soạn.
  const [files, setFiles] = useState<string[]>([]);
  const panel = useDev((s) => s.panel);
  const setPanel = useDev((s) => s.setPanel);
  useDev((s) => s.encVer);
  useEffect(() => { loadEncoder(); }, []);
  const snapRef = useRef<Map<number, Ctx[]>>(new Map());
  const [menu, setMenu] = useState<"" | "plus" | "mode" | "ctx" | "rules" | "more" | "perm">("");
  const menuRef = useRef(menu); menuRef.current = menu;
  const [errOpen, setErrOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  // Workspace (container trên máy chủ): pane bên phải, session rail, trạng thái git của phiên.
  const status = useCodeUi((s) => s.status);
  const setStatus = useCodeUi((s) => s.setStatus);
  const gitMap = useCodeUi((s) => s.git);
  const setGit = useCodeUi((s) => s.setGit);
  const showTerm = useCodeUi((s) => s.showTerm);
  const showFile = useCodeUi((s) => s.showFile);
  const [pane, setPane] = useState<PaneKind | null>(null);
  const [mountedP, setMountedP] = useState<PaneKind[]>([]);
  const [paneW, setPaneW] = usePref("codePaneW", 560);
  const [dragW, setDragW] = useState<number | null>(null);
  const [rail, setRail] = usePref("codeRail", false);
  const [paneMax, setPaneMax] = useState(false);
  const [autoBrowser, setAutoBrowser] = usePref("codeAutoBrowser", true);
  const autoBrowserRef = useRef(autoBrowser); autoBrowserRef.current = autoBrowser;
  const [wsUsed, setWsUsed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Khung chat nổi trên luồng tin nhắn: chừa đúng chiều cao của nó (thay đổi khi có danh sách việc, tệp đính kèm…).
  const colRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const col = colRef.current, dock = col?.querySelector(".cv-dock");
    if (!col || !dock) return;
    const ro = new ResizeObserver(() => col.style.setProperty("--dock-h", `${Math.round(dock.getBoundingClientRect().height) + 28}px`));
    ro.observe(dock);
    return () => ro.disconnect();
  }, [loaded]);
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
  const TOP_MENUS = ["rules", "more"];
  const away = useClickAway(() => { if (!TOP_MENUS.includes(menuRef.current)) setMenu(""); setMention(null); });
  const awayTop = useClickAway(() => { if (TOP_MENUS.includes(menuRef.current)) setMenu(""); });

  useEffect(() => { if (loaded) onEmpty(nodes.length === 0); }, [loaded, nodes.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // Nạp nội dung một phiên (từ trình duyệt hay máy chủ). Lượt đã dừng giữa chừng coi như xong; câu hỏi duyệt cũ không còn chờ.
  // Lượt chạy nền ở máy chủ (auto) giữ nguyên trạng thái: máy chủ còn đang cập nhật nó.
  const applyData = (s: Record<string, unknown> | null) => {
    skipPush.current = true;
    const ns = (s?.nodes as Node[] | undefined) ?? [];
    setNodes(ns.map((n) => (n.auto && !n.done ? n : { ...n, done: true, steps: n.steps?.map((x) => (x.k === "tool" ? { ...x, done: true } : x.k === "ask" && x.state === "wait" ? { ...x, state: "gone" as const } : x)) })));
    setSel((s?.sel as Record<number, number>) ?? {}); setCtx((s?.ctx as Ctx[]) ?? []); setWsUsed(!!s?.ws);
    const pm = s?.perm as { mode?: PermMode; allow?: string[] } | undefined;
    setPerm(pm?.mode ? { mode: pm.mode, allow: pm.allow ?? [] } : null);
    setStyle(isStyle(s?.style) ? s.style : null);
    setView(s?.view === "normal" || s?.view === "thinking" || s?.view === "verbose" ? s.view : null);
    setSuggest(typeof s?.suggest === "string" ? s.suggest : "");
  };
  const busyRef = useRef(false); busyRef.current = busy;
  const loadedSid = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (loadedSid.current === sid) return;
    loadedSid.current = sid;
    stopGen();
    setAtts([]); setFiles([]); setV(""); setPanel(null); setMountedP([]);
    if (sid === null) setPane(null);
    let s: Record<string, unknown> | null = null;
    try { s = sid === null ? null : JSON.parse(ls.get("codeS:" + sid) ?? "null"); } catch {}
    applyData(s);
    // Phiên chưa có ở thiết bị này (mở từ thiết bị khác, hay vừa tự sửa PR ở máy chủ): tải từ máy chủ.
    if (sid !== null && !s && codePrefsNow()?.sync !== false) getServerSession(sid).then((r) => {
      if (!r?.data || loadedSid.current !== sid) return;
      setSessionBase(sid, r.updated);
      applyData(r.data);
      if (r.suggest) setSuggest(r.suggest);
    });
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
    // Ảnh chụp màn hình của agent chỉ giữ trong bộ nhớ, không lưu vào trình duyệt.
    const lean = nodes.map((n) => (n.steps ? { ...n, steps: n.steps.map((x) => (x.k === "tool" && x.image ? { ...x, image: undefined } : x)) } : n));
    const data = { nodes: lean, sel, ctx, ws: wsUsed || undefined, perm: perm ?? undefined, style: style ?? undefined, view: view ?? undefined, suggest: suggest || undefined, model: model || undefined };
    const json = JSON.stringify(data);
    ls.set("codeS:" + id, json);
    // Đồng bộ lên máy chủ (Cài đặt → Synchro Code → Đồng bộ phiên): chỉ khi nội dung thật sự đổi, không gửi lại bản vừa tải về.
    if (skipPush.current) { skipPush.current = false; pushed.current = json; return; }
    if (!cpRef.current?.sync || json === pushed.current) return;
    pushed.current = json;
    const sidNow = id;
    pushSession(id, titleRef.current || nodes[0]?.user.slice(0, 40) || "Phiên code", data as Record<string, unknown>, (merged) => {
      if (loadedSid.current !== sidNow || busyRef.current) return;
      applyData(merged);
    });
  }, [nodes, sel, ctx, loaded, wsUsed, perm, style, view, suggest, model]); // eslint-disable-line react-hooks/exhaustive-deps
  // Phiên đang mở: nhận lượt mới từ máy chủ (thiết bị khác, lượt tự sửa PR chạy nền) khi không có lượt nào đang chạy ở đây.
  useEffect(() => {
    if (sid === null || !cp?.sync) return;
    let stop = false;
    const tick = async () => {
      if (stop || busyRef.current || document.hidden || loadedSid.current !== sid) return;
      const r = await getServerSession(sid, sessionBase(sid));
      if (!r || stop || busyRef.current || loadedSid.current !== sid || r.same || !r.data) return;
      setSessionBase(sid, r.updated);
      const cur = JSON.parse(ls.get("codeS:" + sid) ?? "null") as Record<string, unknown> | null;
      applyData(mergeSession(cur, r.data));
      if (r.suggest) setSuggest(r.suggest);
    };
    const t = setInterval(tick, 5000);
    return () => { stop = true; clearInterval(t); };
  }, [sid, cp?.sync]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tạo phiên ngay khi cần thư mục workspace (mở terminal, clone repo, gửi tin nhắn đầu tiên).
  const ensureSid = useCallback((t = "Phiên code mới") => {
    if (loadedSid.current != null) return loadedSid.current;
    const id = Date.now();
    loadedSid.current = id;
    onCreate(id, t.replace(/\s+/g, " ").trim().slice(0, 40) || "Phiên code mới");
    return id;
  }, [onCreate]);
  useEffect(() => { wsStatus().then(setStatus).catch(() => setStatus({ available: false, reason: "Không kiểm tra được workspace." })); }, [setStatus]);
  const git = sid !== null ? gitMap[sid] : undefined;
  const refreshGit = useCallback(async (id: number | null | undefined) => {
    if (id == null || !useCodeUi.getState().status?.available) return;
    try { setGit(id, await gitOp(id, "status")); } catch {}
  }, [setGit]);
  useEffect(() => { if (sid !== null && wsUsed && status?.available && !gitMap[sid]) refreshGit(sid); }, [sid, wsUsed, status?.available]); // eslint-disable-line react-hooks/exhaustive-deps
  const openPane = useCallback((k: PaneKind) => {
    setPane(k);
    setMountedP((m) => (m.includes(k) ? m : [...m, k]));
    if (k !== "block") {
      setWsUsed(true);
      // Mở pane sẽ bật container: cập nhật trạng thái hiển thị trong session rail.
      setTimeout(() => wsStatus().then(setStatus).catch(() => {}), 4000);
    }
  }, [setStatus]);
  const wsPane = (k: PaneKind) => {
    if (pane === k) { setPane(null); return; }
    if (k !== "block" && !status?.available) { say(status?.reason ?? "Workspace chưa sẵn sàng"); return; }
    ensureSid();
    openPane(k);
  };
  useEffect(() => { if (panel) openPane("block"); else setPane((p) => (p === "block" ? null : p)); }, [panel]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // Lời nhắc hệ thống (ước lượng): chế độ, quy tắc, luật dự án và phần mô tả công cụ khi có workspace.
  const sysTok = tok(MODE_SYS[mode] ?? "") + tok(RULES_SYS) + tok(rule) + (status?.available ? 2400 : 0);
  const total = ctxTok + histTok + draftTok + sysTok;
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
    abortRef.current?.abort();
    abortRef.current = null;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    const id = activeRef.current;
    activeRef.current = null;
    setBusy(false);
    if (id !== null) setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ai: closeFences(n.ai), done: true, stopped: (!!n.ai || !!n.steps?.length) && n.stopped !== false ? true : n.stopped, steps: n.steps?.map((x) => (x.k === "tool" && !x.done ? { ...x, done: true, ok: false, summary: x.summary ?? "Đã dừng" } : x)) } : n)));
  }, []);

  // Có workspace: agent tự thao tác (lệnh, file, trình duyệt) và gửi từng bước về theo thời gian thực.
  const runAgent = (id: number, hist: Node[], userText: string, md: string) => {
    const gen = ++genRef.current;
    activeRef.current = id;
    setBusy(true);
    const s = ensureSid(userText);
    agentSid.current = s;
    setWsUsed(true);
    const live = ctxRef.current.filter((c) => !c.off);
    // Tệp gửi kèm ở các lượt trước đã nằm trong workspace: chỉ nhắc đường dẫn (lượt hiện tại do máy chủ ghép mô tả và nội dung).
    const sentNote = (n: Node) => (n.id !== id && n.files?.length ? `\n\n[Đã gửi kèm, nằm trong workspace: ${n.files.map((f) => `.synchro/uploads/${f.name}${f.folder ? "/" : ""}`).join(", ")}]` : "");
    const messages = hist.flatMap((n) => [
      { role: "user", content: n.user + (n.hid ? "\n\n" + n.hid : "") + n.atts.map((a) => `\n\n[${a.name}]\n${a.text}`).join("") + sentNote(n) },
      ...(n.ai && n.id !== id ? [{ role: "assistant", content: n.ai + workLog(n.steps) }] : []),
    ]);
    const system = [
      MODE_SYS[md],
      md === "auto" && `Gợi ý giai đoạn mở đầu cho yêu cầu này: ${guessMode(userText)} (tự đổi nếu thấy cần).`,
      STYLE_SYS[styleNow],
      strictRef.current && STRICT_SYS,
      SLASH.find((x) => userText.trimStart() === x.cmd || userText.trimStart().startsWith(x.cmd + " "))?.sys,
      rule && `Luật dự án: ${rule}`,
      "Các giá trị dạng <REDACTED_KEY_N> là bí mật đã được che; giữ nguyên, không đoán giá trị.",
      live.length && "Tệp người dùng đính kèm làm ngữ cảnh (không nằm trong workspace):\n" + live.map((c) => `--- ${c.name} ---\n${c.text.slice(0, 6000)}`).join("\n"),
    ].filter(Boolean).join("\n\n");
    const ac = new AbortController();
    abortRef.current = ac;
    const addText = (n: Node, text: string): Node => ({ ...n, steps: [...(n.steps ?? []), { k: "text", text }], ai: n.ai ? `${n.ai}\n\n${text}` : text });
    patchNode(id, (n) => ({ ...n, steps: [] }));
    onMeta?.(s, { running: true, state: null, reason: null });
    const setAsk = (aid: string, st: "ok" | "always" | "no" | "gone") => patchNode(id, (n) => ({ ...n, steps: (n.steps ?? []).map((x) => (x.k === "ask" && x.id === aid ? { ...x, state: st } : x)) }));
    (async () => {
      try {
        const cur = hist[hist.length - 1];
        const names = cur?.id === id ? (cur.files ?? []).map((f) => f.name) : [];
        const up = names.length ? await readyFiles(names) : { ok: [], errors: [] };
        // Nhớ mã tệp trên máy chủ: thẻ ảnh của tin này vẫn hiện ảnh sau khi tải lại trang.
        if (up.ok.length) patchNode(id, (n) => ({ ...n, files: n.files?.map((f) => ({ ...f, id: up.ok.find((o) => o.name === f.name)?.id ?? f.id })) }));
        for (const err of up.errors) patchNode(id, (n) => addText(n, `⚠️ ${err}`));
        if (gen !== genRef.current) return;
        await streamAgent({ sid: String(s), system, messages, model, skills: true, effort: getActiveEffort(), files: up.ok, perm: permRef.current }, (e) => {
          if (gen !== genRef.current) return;
          if (e.t === "text") patchNode(id, (n) => addText(n, e.text));
          else if (e.t === "think") patchNode(id, (n) => ({ ...n, steps: [...(n.steps ?? []), { k: "think", text: e.text }] }));
          else if (e.t === "ask") {
            patchNode(id, (n) => ({ ...n, steps: [...(n.steps ?? []), { k: "ask", id: e.id, kind: e.kind, title: e.title, detail: e.detail, host: e.host, state: "wait" }] }));
            onMeta?.(s, { running: true, state: "blocked", reason: `Chờ bạn duyệt: ${e.title}` });
            say("Synchro đang chờ bạn duyệt");
          }
          else if (e.t === "asked") { setAsk(e.id, e.ok ? (e.always ? "always" : "ok") : "no"); onMeta?.(s, { running: true, state: null, reason: null }); }
          else if (e.t === "perm") setPerm({ mode: permRef.current.mode, allow: e.allow });
          else if (e.t === "meta") { if (e.suggest) setSuggest(e.suggest); onMeta?.(s, { state: e.state as SessionState, reason: e.reason, running: false }); }
          else if (e.t === "tool") patchNode(id, (n) => ({ ...n, steps: [...(n.steps ?? []), { k: "tool", id: e.id, name: e.name, input: e.input }] }));
          else if (e.t === "result") patchNode(id, (n) => ({ ...n, steps: (n.steps ?? []).map((x) => (x.k === "tool" && x.id === e.id ? { ...x, done: true, ok: e.ok, summary: e.summary, output: e.output, diff: e.diff, image: e.image } : x)) }));
          else if (e.t === "plan") patchNode(id, (n) => ({ ...n, plan: e.items }));
          else if (e.t === "usage") patchNode(id, (n) => ({ ...n, usage: { input: e.input, output: (n.usage?.output ?? 0) + e.output } }));
          else if (e.t === "ui") {
            if (e.open === "browser" && !autoBrowserRef.current) return;
            openPane(e.open);
            if (e.open === "terminal") showTerm(e.tab ?? "log");
            if (e.open === "files" && e.path) showFile(e.path);
          } else if (e.t === "steer") {
            patchNode(id, (n) => ({ ...n, steps: [...(n.steps ?? []), { k: "steer", text: e.text }] }));
            setCq((q) => { const k = q.findIndex((x) => x.mode === "steer" && x.text === e.text); return k < 0 ? q : q.filter((_, j) => j !== k); });
          } else if (e.t === "done") {
            if (e.skills.length) patchNode(id, (n) => ({ ...n, skills: e.skills }));
            refreshUsage();
            // Tin nhắn thêm tới sau bước cuối: gửi thành lượt mới ngay khi xong.
            const left = e.steer ?? [];
            setCq((q) => [...q.map((x) => (x.mode === "steer" ? { ...x, mode: "later" as const } : x)), ...left.filter((t) => !q.some((x) => x.text === t)).map((t, k) => ({ id: Date.now() + k, chat: 0, text: t, mode: "later" as const }))]);
          }
          else if (e.t === "error") patchNode(id, (n) => addText(n, `⚠️ ${e.error}`));
        }, ac.signal);
      } catch (e) {
        if (!ac.signal.aborted && gen === genRef.current) patchNode(id, (n) => addText(n, `⚠️ ${(e as Error).message || "Không kết nối được agent."}`));
      }
      if (gen !== genRef.current) return;
      activeRef.current = null;
      abortRef.current = null;
      patchNode(id, (n) => ({ ...n, done: true, steps: n.steps?.map((x) => (x.k === "tool" && !x.done ? { ...x, done: true } : x.k === "ask" && x.state === "wait" ? { ...x, state: "gone" as const } : x)) }));
      setBusy(false);
      onMeta?.(s, { running: false });
      refreshGit(s);
      wsStatus().then(setStatus).catch(() => {});
    })();
  };

  const run = (id: number, hist: Node[], userText: string, userAtts: Att[], md: string) => {
    if (status?.available) return runAgent(id, hist, userText, md);
    const gen = ++genRef.current;
    activeRef.current = id;
    setBusy(true);
    const live = ctxRef.current.filter((c) => !c.off);
    const messages: LLMMsg[] = [];
    hist.forEach((n) => {
      messages.push({ role: "user", content: n.user + (n.hid ? "\n\n" + n.hid : "") + n.atts.map((a) => `\n\n[${a.name}]\n${a.text}`).join("") });
      if (n.ai && n.id !== id) messages.push({ role: "assistant", content: n.ai + workLog(n.steps) });
    });
    const buildSystem = (snips: { file: string; name: string; code: string }[]) => [
      "Bạn là Synchro Code, trợ lý lập trình.",
      MODE_SYS[md],
      STYLE_SYS[styleNow],
      md === "auto" && `Gợi ý giai đoạn mở đầu cho yêu cầu này: ${guessMode(userText, userAtts)} (tự đổi nếu thấy cần).`,
      RULES_SYS,
      strictRef.current && STRICT_SYS,
      SLASH.find((x) => userText.trimStart() === x.cmd || userText.trimStart().startsWith(x.cmd + " "))?.sys,
      snips.length > 0 && "Đoạn code liên quan (@Codebase):\n" + snips.map((x) => `--- ${x.file} · ${x.name} ---\n${x.code}`).join("\n"),
      rule && `Luật dự án: ${rule}`,
      live.length && "Tệp ngữ cảnh:\n" + live.map((c) => `--- ${c.name} ---\n${c.text.slice(0, 6000)}`).join("\n"),
    ].filter(Boolean).join("\n\n");
    (async () => {
      let reply: string;
      // Không có workspace: ảnh, PDF, nội dung tệp gửi thẳng cho model như khung chat.
      const cur = hist[hist.length - 1];
      if (cur?.id === id && cur.files?.length) {
        const fc = await fileContext(cur.files.map((f) => f.name), userText);
        patchNode(id, (n) => ({ ...n, files: n.files?.map((f) => ({ ...f, id: getStatus(f.name)?.id ?? f.id })) }));
        if (fc.errors.length) say(fc.errors[0]);
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && fc.blocks.length) lastMsg.content = [{ type: "text", text: String(lastMsg.content) }, ...fc.blocks];
      }
      const snips = /@codebase\b/i.test(userText) ? await pickRelevantTS(live, userText, 5) : [];
      const system = buildSystem(snips);
      let usedSk: string[] = [];
      if (hasLLM) {
        try {
          reply = await callLLM(system, messages, 2500, { task: /^\s*\/commit\b/.test(userText) ? "commit" : undefined, tokens: tok(system) + messages.reduce((a, m) => a + tok(typeof m.content === "string" ? m.content : ""), 0) }, true, { feature: "code" });
          usedSk = [...new Set(takeSkillsUsed().filter((u) => u.kind === "skill").map((u) => u.name))];
        } catch (e) { reply = e instanceof LLMError && e.message && !/^(LLM|Run|Lỗi) \d+$/.test(e.message) ? e.message : "Không thể kết nối tới model. Vui lòng thử lại."; }
      }
      else reply = "Synchro chưa được kết nối với model nào. Quản trị viên vào Cài đặt → Providers để đăng nhập gói Claude / ChatGPT / Gemini / Grok hoặc thêm khóa API.";
      if (gen !== genRef.current) return;
      if (usedSk.length) patchNode(id, (n) => ({ ...n, skills: usedSk }));
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
    // Tệp đính kèm chỉ đi cùng tin nhắn người dùng gõ (không đi cùng lệnh tự động như Auto-Fix, Inline Edit).
    const typed = extra === atts;
    strictRef.current = strict;
    let cnt = 0;
    const rt = redact(text.trim()); cnt += rt.count;
    const t = rt.text;
    extra = extra.map((a) => { const r = redact(a.text); cnt += r.count; return { ...a, text: r.text, pills: undefined }; });
    if (cnt) say(`🛡️ Đã bảo vệ ${cnt} thông tin nhạy cảm tại trình duyệt`);
    const sent: Sent[] = typed ? files.map((name) => ({ name, folder: getStatus(name)?.folder || undefined, count: getStatus(name)?.count })) : [];
    if (!t && !extra.length && !sent.length) return;
    stick.current = true;
    setSuggest("");
    const parent = path.length ? path[path.length - 1].id : 0;
    const n: Node = { id: Date.now(), parent, user: t || "Xem nội dung đính kèm", hid, atts: extra, files: sent.length ? sent : undefined, ai: "", done: false, mode, time: Date.now() };
    snapRef.current.set(n.id, ctxRef.current);
    setNodes((ns) => [...ns, n]);
    setSel((s) => ({ ...s, [parent]: n.id }));
    setV(""); setAtts([]); if (sent.length) setFiles([]); setMention(null);
    run(n.id, [...path, n], n.user, n.atts, mode);
  };

  const branch = (old: Node, text: string) => {
    if (busy || !text.trim()) return;
    const n: Node = { id: Date.now(), parent: old.parent, user: text.trim(), atts: old.atts, files: old.files, ai: "", done: false, mode: old.mode, time: Date.now() };
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
    patchNode(last.id, (n) => ({ ...n, ai: "", done: false, stopped: undefined, steps: undefined, plan: undefined }));
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

  const [upl, setUpl] = useState(false);
  const fm = useFileMenu(say);
  // Như Claude: mọi loại tệp đều đính kèm được (tệp không đọc được chữ vẫn được chép nguyên vào workspace cho agent dùng).
  const addFiles = (list: File[]) => {
    const ok = list.filter((f) => f.name !== ".DS_Store");
    if (!ok.length) return;
    ok.forEach((f) => ingestFile(f, say, { raw: true }));
    setFiles((cur) => capFiles(cur.filter((n) => !ok.some((f) => f.name === n)), ok.map((f) => f.name), say));
  };
  // Cả thư mục tải lên nguyên khối: nén ngay trong trình duyệt (giữ cấu trúc), hiện là một thẻ thư mục, chép nguyên vào workspace khi gửi.
  const addFolder = async (name: string, list: { path: string; file: File }[]) => {
    if (!list.length) { say(`Thư mục "${name}" trống`); return; }
    try {
      const JSZip = (await import("jszip")).default;
      const z = new JSZip();
      for (const { path: p, file } of list) z.file(p.split("/").slice(1).join("/") || file.name, file);
      const blob = await z.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      ingestFile(new File([blob], `${name}.zip`, { type: "application/zip" }), say, { raw: true, key: name, folder: true, count: list.length });
      setFiles((cur) => capFiles(cur.filter((n) => n !== name), [name], say));
    } catch { say(`Không nén được thư mục "${name}"`); }
  };
  const onFiles = async (picked: FileList | File[] | null, dir = false) => {
    if (!picked?.length) return;
    const arr = Array.from(picked);
    if (!dir) { addFiles(arr); return; }
    // Chọn thư mục: gom theo thư mục gốc (webkitRelativePath = "thu-muc/…").
    const groups = new Map<string, { path: string; file: File }[]>();
    for (const f of arr) {
      const p = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      if (f.name === ".DS_Store") continue;
      const root = p.includes("/") ? p.split("/")[0] : "";
      if (!root) { addFiles([f]); continue; }
      groups.set(root, [...(groups.get(root) ?? []), { path: p, file: f }]);
    }
    for (const [root, list] of groups) await addFolder(root, list);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setDragOn(false);
    const items = Array.from(e.dataTransfer.items ?? []);
    const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
    if (!entries.length) return onFiles(e.dataTransfer.files);
    const loose: File[] = [];
    for (const en of entries) {
      if (en.isFile) { loose.push(await new Promise<File>((res, rej) => (en as FileSystemFileEntry).file(res, rej))); continue; }
      const out: { path: string; file: File }[] = [];
      await readEntry(en, "", out);
      await addFolder(en.name, out);
    }
    if (loose.length) addFiles(loose);
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
  // Đang chạy mà gõ thêm: Enter ghép vào việc agent đang làm, ⌘/Ctrl + Enter gửi sau khi xong (giống khung chat chính).
  const steer = async (text: string, later: boolean) => {
    const qid = Date.now() + Math.random();
    setV("");
    if (later || !agentSid.current || !activeRef.current || !status?.available) { setCq((q) => [...q, { id: qid, chat: 0, text, mode: "later" }]); return; }
    setCq((q) => [...q, { id: qid, chat: 0, text, mode: "steer" }]);
    const ok = await fetch("/api/agent/steer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sid: String(agentSid.current), text }) })
      .then((r) => r.json()).then((j) => !!j.queued, () => false);
    if (!ok) setCq((q) => q.map((x) => (x.id === qid ? { ...x, mode: "later" } : x)));
  };
  useEffect(() => {
    if (busy) return;
    const next = cq.find((x) => x.mode === "later");
    if (!next) return;
    const t = setTimeout(() => { setCq((q) => q.filter((x) => x.id !== next.id)); send(next.text, []); }, 250);
    return () => clearTimeout(t);
  }, [busy, cq]); // eslint-disable-line react-hooks/exhaustive-deps
  const onKey = (e: React.KeyboardEvent) => {
    if (busy && v.trim() && e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void steer(v.trim(), e.metaKey || e.ctrlKey); return; }
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
    // Gợi ý câu nhắn tiếp (hiện mờ trong ô soạn tin): Tab để dùng.
    if (e.key === "Tab" && !e.shiftKey && !v && suggest && !busy) { e.preventDefault(); setV(suggest); return; }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
  };
  // Trả lời câu hỏi duyệt của lượt đang chạy.
  const onAnswer: OnAnswer = (aid, ok, o) => {
    answerAsk(aid, ok, o).then((err) => {
      if (!err) return;
      say(err);
      setNodes((ns) => ns.map((n) => (n.steps?.some((x) => x.k === "ask" && x.id === aid) ? { ...n, steps: n.steps.map((x) => (x.k === "ask" && x.id === aid ? { ...x, state: "gone" as const } : x)) } : n)));
    });
  };

  const onPaste = (e: React.ClipboardEvent) => {
    // Dán ảnh chụp màn hình / tệp đã sao chép: thành tệp đính kèm như Claude.
    const pasted = Array.from(e.clipboardData.files ?? []);
    if (pasted.length) {
      e.preventDefault();
      addFiles(pasted.map((f) => (f.name && f.name !== "image.png" ? f : new File([f], `anh-dan-${new Date().toTimeString().slice(0, 8).replace(/:/g, "")}.${(f.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: f.type }))));
      return;
    }
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
    setErrText(""); setErrOpen(false);
    say("Đã đính kèm log lỗi");
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
  const m = MODES.find((x) => x.k === mode) ?? MODES[0];
  const modeIcon = (k: string, s = 16) => (k === "auto" ? <I.Sparkle size={s} /> : k === "plan" ? <I.Layers size={s} /> : k === "debug" ? <I.M icon="Alert" size={s} /> : <I.M icon="Code" size={s} />);
  const grp = (g: string) => mentionItems.filter((x) => x.g === g);
  // Kéo đường chia để đổi độ rộng khung bên phải.
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const railW = rail ? 300 : 0;
    const clamp = (x: number) => Math.max(320, Math.min(window.innerWidth - railW - 380, x));
    let w = paneW;
    const move = (ev: MouseEvent) => { w = clamp(window.innerWidth - ev.clientX - 8); setDragW(w); };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); document.body.classList.remove("cv-dragging"); setPaneW(w); setDragW(null); };
    document.body.classList.add("cv-dragging");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  // Bảng ngữ cảnh kiểu Claude: thanh nhiều màu + chú thích từng phần (dùng chung cho vòng tròn và session rail).
  const pctOf = (x: number) => `${((x / MAX_TOK) * 100).toFixed(1)}%`;
  const segs = [
    { k: "Hội thoại", v: histTok, c: "#4a7fe0" },
    { k: "Tệp đính kèm", v: ctxTok, c: "#e0784a" },
    { k: "Lời nhắc hệ thống", v: sysTok, c: "#4fae7d" },
    { k: "Đang soạn", v: draftTok, c: "#e3a83b" },
  ];
  const free = Math.max(0, MAX_TOK - total);
  const ctxPanel = (
    <div className="ctxp">
      <div className="ctxp-top"><span>{Math.round(pct)}% đã dùng</span><em data-notr>{fmtK(total)} / {fmtK(MAX_TOK)}</em></div>
      <div className="ctxp-bar">{segs.map((x) => <i key={x.k} style={{ width: `${(x.v / MAX_TOK) * 100}%`, background: x.c }} />)}</div>
      <div className="ctxp-rows">
        {segs.map((x) => <div key={x.k} className="ctxp-row"><b style={{ background: x.c }} /><span>{x.k}</span><em data-notr>{fmtK(x.v)}</em><strong data-notr>{pctOf(x.v)}</strong></div>)}
        <div className="ctxp-row free"><b /><span>Còn trống</span><em data-notr>{fmtK(free)}</em><strong data-notr>{pctOf(free)}</strong></div>
      </div>
      {ctx.length > 0 && (
        <>
          <button className="ctxp-sub" onClick={() => setFilesOpen(!filesOpen)}><span className={`ag-chev ${filesOpen ? "on" : ""}`}><I.ChevronR size={12} /></span>Tệp trong ngữ cảnh<em>{ctx.length}</em></button>
          {filesOpen && (
            <div className="cv-list">
              {ctx.map((c) => (
                <div key={c.id} className="cv-row">
                  <button className={`cv-sw ${c.off ? "" : "on"}`} onClick={() => setCtx((a) => a.map((x) => (x.id === c.id ? { ...x, off: !x.off } : x)))} aria-label="Bật/tắt"><i /></button>
                  <span className="cv-ell">{c.name}</span><em>{fmtK(tok(c.text))}</em>
                  <button className="icon-btn" onClick={() => setCtx((a) => a.map((x) => (x.id === c.id ? { ...x, pinned: !x.pinned } : x)))} aria-label="Ghim">{c.pinned ? <I.M icon="PinOff" size={14} /> : <I.M icon="Pin" size={14} />}</button>
                  <button className="icon-btn" onClick={() => setCtx((a) => a.filter((x) => x.id !== c.id))} aria-label="Xóa"><I.Trash size={14} /></button>
                </div>
              ))}
              <button className="ctxp-btn" onClick={() => setCtx((a) => a.filter((x) => x.pinned))}>Xóa tệp chưa ghim</button>
            </div>
          )}
        </>
      )}
      <div className="ctxp-foot"><span className="cv-ell">Còn {fmtK(free)} trước khi đầy</span><button className="ctxp-btn" disabled={path.length < 2} onClick={summarize}>Làm gọn phiên</button></div>
    </div>
  );

  return (
    <div className="cv" style={{ "--cv-font": cf ? `${cf}, ui-monospace, Menlo, monospace` : undefined, "--cv-fs": `${csz}px` } as React.CSSProperties} onDragOver={(e) => { e.preventDefault(); setDragOn(true); }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOn(false); }} onDrop={onDrop}>
      <div className={`cv-body ${pane && paneMax ? "pane-max" : ""}`}>
      <div className="cv-col" ref={colRef}>
      <div className="cv-bar">
        <div className="cv-bar-l">
          {!sideOpen && <SideToggle onClick={onSide} />}
          <div className="cv-title" title={title}><I.Code size={16} /><span className="cv-ell" data-notr>{title}</span></div>
        </div>
        <div className="cv-bar-r" ref={TOP_MENUS.includes(menu) ? awayTop : undefined}>
          <button className={`icon-btn cv-tb ${rail ? "on" : ""}`} onClick={() => setRail(!rail)} aria-label="Ẩn/hiện session rail" title="Session rail"><I.PanelR /></button>
          <button className={`icon-btn cv-tb ${pane === "terminal" ? "on" : ""}`} onClick={() => wsPane("terminal")} aria-label="Terminal" title="Terminal"><I.Terminal /></button>
          <button className={`icon-btn cv-tb ${pane === "browser" ? "on" : ""}`} onClick={() => wsPane("browser")} aria-label="Trình duyệt" title="Trình duyệt / xem trước"><I.Globe /></button>
          <button className={`icon-btn cv-tb ${pane === "files" ? "on" : ""}`} onClick={() => wsPane("files")} aria-label="File" title="File"><I.Folder /></button>
          <div style={{ position: "relative" }}>
            <button className={`icon-btn cv-tb ${menu === "more" || menu === "rules" ? "on" : ""}`} onClick={() => setMenu(menu === "more" ? "" : "more")} aria-label="Thêm" title="Thêm"><I.Dots /></button>
            <Menu open={menu === "more"} style={{ top: 38, right: 0, width: 250 }}>
              <button className="menu-item" onClick={() => { setMenu(""); newSession(); }}><I.Plus />Phiên mới</button>
              <button className="menu-item" onClick={() => setMenu("rules")}><I.Sliders />Luật dự án<span className="cv-mi-r cv-ell">{ruleLabel}</span></button>
              <button className="menu-item" onClick={() => { setMenu(""); exportMd(); }}><I.Download />Xuất cuộc trò chuyện (.md)</button>
              <hr />
              <div className="cv-mh">Kiểu xem</div>
              {(["normal", "thinking", "verbose"] as TView[]).map((k) => (
                <button key={k} className="menu-item cv-mi-opt" onClick={() => { setView(k === viewDef ? null : k); setMenu(""); }}>{TVIEW_LABEL[k]}{viewNow === k && <span className="ck"><I.Check /></span>}</button>
              ))}
              <div className="cv-mh">Kiểu trả lời</div>
              {(["default", "explain", "learn"] as CodeStyle[]).map((k) => (
                <button key={k} className="menu-item cv-mi-opt" title={STYLE_DESC[k]} onClick={() => { setStyle(k); setMenu(""); say(`Kiểu trả lời: ${STYLE_LABEL[k]}`); }}>{STYLE_LABEL[k]}{styleNow === k && <span className="ck"><I.Check /></span>}</button>
              ))}
              <hr />
              <button className="menu-item" onClick={() => { setMenu(""); setGuide(true); }}><I.Help />Hướng dẫn</button>
            </Menu>
            <Menu open={menu === "rules"} className="cv-rules" style={{ top: 38, right: 0, width: 340 }}>
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
        </div>
      </div>
      <div className="cv-cols">
      <div className="cv-main">
        <div className="thread cv-thread" ref={threadRef} onScroll={onScroll} onMouseUp={onThreadUp}>
          {path.length === 0 ? (
            <div className="cv-empty">
              <div className="cv-hello">Hôm nay bạn muốn xây dựng gì?</div>
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
                      {n.files?.length ? <div className="attach sent">{n.files.map((f) => <FileCard key={f.name} name={f.name} folder={f.folder} count={f.count} fid={f.id} onOpen={() => fm.show(f.name, f.id)} onContextMenu={(e) => fm.open(e, f.name)} />)}</div> : null}
                      {n.atts.length > 0 && <div className="cv-atts end">{n.atts.map((a, k) => <button key={k} className={`cv-att ${a.k}`} onClick={() => setViewer(a)}>{a.k === "error" ? <I.M icon="Alert" size={14} /> : <I.M icon="Code" size={14} />}{a.name}</button>)}</div>}
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
                      <div className="cv-ai-h">{n.mode === "auto" ? (() => { const ph = phasesOf(n.ai); const list = ph.length ? ph : [guessMode(n.user, n.atts)]; return <span className="cv-mode m-auto" title="Synchro tự chọn và chuyển giai đoạn">{modeIcon("auto", 13)}Auto{list.map((k, i) => <span key={i} className={`cv-phase m-${k}`}>{i ? <I.ChevronR size={10} /> : null}{modeIcon(k, 11)}{MODES.find((x) => x.k === k)?.short}</span>)}</span>; })() : <span className={`cv-mode m-${n.mode}`}>{modeIcon(n.mode, 13)}{MODES.find((x) => x.k === n.mode)?.short}</span>}</div>
                      <div className="ai-msg">{n.skills?.length ? <div className="skill-used">{n.skills.map((k) => <span key={k} className="skill-chip"><I.Scroll size={13} />{tr("Đang dùng skill")}: {k}</span>)}</div> : null}{n.steps ? <>{n.steps.length > 0 && <AgentSteps steps={n.steps} live={!n.done} say={say} view={viewNow} onAnswer={onAnswer} />}{!n.done && n.plan?.length ? <TaskCard plan={n.plan} /> : null}{!n.done && <StatusLine steps={n.steps} start={n.time} tokens={n.usage ? n.usage.input + n.usage.output : total} />}</> : n.ai ? <Markdown text={stripPhases(n.ai)} say={say} dev={{ prev: prev.length ? prev : prevAny, onPanel: openPanel, files: ctx, onAccept: acceptFile, onExpand: expandHidden }} /> : !n.done ? <Thinking label="Đang suy nghĩ…" /> : null}</div>
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
                          {g === "Codebase" ? <I.Layers size={16} /> : g === "Folder" ? <I.Folder size={16} /> : g === "Docs" ? <I.Globe size={16} /> : g === "Hàm" ? <I.M icon="Code" size={16} /> : <I.M icon="Clip" size={16} />}<span className="cv-ell">{it.label}</span>
                        </button>); })}
                    </div>
                  ))
                )}
              </div>
            )}
            <QueueChips items={cq} onCancel={(qid) => setCq((q) => q.filter((x) => x.id !== qid))} />
            <div className="composer cv-composer" data-drag={dragOn ? "1" : undefined}>
              {errOpen && (
                <div className="cv-errbox">
                  <div className="cv-mh"><I.Alert size={14} />Dán log lỗi / stack trace</div>
                  <textarea autoFocus rows={6} value={errText} onChange={(e) => setErrText(e.target.value)} placeholder={"TypeError: Cannot read properties of undefined\n    at login (src/lib/auth.ts:12:18)"} />
                  <div className="cv-custom-r"><button className="btn" onClick={() => { setErrText(""); setErrOpen(false); }}>Hủy</button><button className="btn dark" onClick={addErr} disabled={!errText.trim()}>Đính kèm</button></div>
                </div>
              )}
              {(files.length > 0 || atts.length > 0) && (
                <div className="cv-pills">
                  {files.length > 0 && (
                    <div className="attach cv-attach">
                      {files.map((f) => <FileCard key={f} name={f} onOpen={() => fm.show(f)} onContextMenu={(e) => fm.open(e, f)} onRemove={() => setFiles((x) => x.filter((y) => y !== f))} />)}
                    </div>
                  )}
                  {atts.map((a, k) => (
                    <div key={k} className={`cv-pill att ${a.k}`}>
                      <button className="n" onClick={() => setViewer(a)} title="Xem lại">{a.k === "error" ? <I.M icon="Alert" size={13} /> : <I.M icon="Code" size={13} />}{a.name}</button>
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
              <textarea ref={ta} rows={1} value={v} onChange={onChange} onKeyDown={onKey} onPaste={onPaste} placeholder={busy ? "Nhắn thêm: ↵ ghép vào việc đang làm, ⌘↵ gửi sau khi xong" : suggest ? `${suggest}    ⇥ Tab` : "Viết tin nhắn…  gõ @ để chọn tệp, hàm hoặc tài liệu"} className={!busy && suggest && !v ? "cv-sugg-on" : undefined} title={!busy && suggest && !v ? "Gợi ý: bấm Tab để dùng" : undefined} />
              <div className="cv-tools">
                <div style={{ position: "relative" }}>
                  <button className="icon-btn" onClick={() => setMenu(menu === "plus" ? "" : "plus")} aria-label="Thêm ngữ cảnh"><I.Plus /></button>
                  {upl && <UploadModal say={say} onClose={() => setUpl(false)} onFiles={(f) => { setUpl(false); onFiles(f); }} />}
                  <Menu open={menu === "plus"} style={{ bottom: 42, left: 0, width: 258 }}>
                    <input ref={fileIn} type="file" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
                    <input ref={dirIn} type="file" hidden {...({ webkitdirectory: "", directory: "" } as object)} multiple onChange={(e) => { onFiles(e.target.files, true); e.target.value = ""; }} />
                    <input ref={zipIn} type="file" accept=".zip" hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
                    <button className="menu-item" onClick={() => { setMenu(""); setUpl(true); }}><I.Clip />Tải tệp lên</button>
                    <button className="menu-item" onClick={() => { setMenu(""); dirIn.current?.click(); }}><I.Folder />Tải cả thư mục</button>
                    <button className="menu-item" onClick={() => { setMenu(""); zipIn.current?.click(); }}><I.Layers />Tải tệp .zip</button>
                    <button className="menu-item" onClick={() => { setMenu(""); setErrOpen(true); }}><I.Alert />Dán log lỗi / stack trace</button>
                    <hr />
                    <div className="cv-hint">Tải lên mọi loại tệp, không tự lọc. Có thể kéo thả vào khung chat.</div>
                  </Menu>
                </div>
                <div className="cv-sp" />
                <button className="send" disabled={!busy && !v.trim() && !atts.length && !files.length} onClick={busy ? stopGen : () => send()} aria-label={busy ? "Dừng và giữ lại" : "Gửi"} title={busy ? "Dừng & giữ lại" : "Gửi"}>{busy ? <I.M icon="Stop" /> : <I.M icon="Enter" />}</button>
              </div>
              {dragOn && <div className="cv-drop">Thả tệp, thư mục hoặc .zip để gửi kèm tin nhắn</div>}
              {fm.node}
            </div>
            <div className="cv-under">
              <GitHubButton git={git} available={!!status?.available} reason={status?.reason} ensureSid={() => ensureSid()} say={say}
                onCloned={(g) => { const id = ensureSid(); setGit(id, g); setWsUsed(true); openPane("files"); }} />
              <div style={{ position: "relative" }}>
                <button className="cv-modebtn" onClick={() => setMenu(menu === "mode" ? "" : "mode")}>{modeIcon(mode, 14)}{m.short}<I.Chevron size={12} /></button>
                <Menu open={menu === "mode"} className="cv-modes" style={{ bottom: 36, left: 0, width: 340 }}>
                  {MODES.map((x) => (
                    <button key={x.k} className={`cv-mode-item ${mode === x.k ? "picked" : ""}`} onClick={() => { setMode(x.k); setMenu(""); }}>
                      <span className={`cv-mode-ic m-${x.k}`}>{modeIcon(x.k, 18)}</span>
                      <span className="cv-opt-t">{x.label}<small>{x.desc}</small></span>
                      {mode === x.k && <span className="ck"><I.Check /></span>}
                    </button>
                  ))}
                </Menu>
              </div>
              {/* Chế độ quyền của phiên: hỏi trước / tự sửa tệp / tự động (Cài đặt → Synchro Code đặt mặc định và cho phép chế độ tự động). */}
              <div style={{ position: "relative" }}>
                <button className={`cv-modebtn cv-perm p-${permNow.mode}`} onClick={() => setMenu(menu === "perm" ? "" : "perm")} title="Chế độ quyền">{permIcon(permNow.mode)}{PERMS.find((x) => x.k === permNow.mode)?.short}<I.Chevron size={12} /></button>
                <Menu open={menu === "perm"} className="cv-modes" style={{ bottom: 36, left: 0, width: 340 }}>
                  <div className="cv-mh">Quyền của Synchro trong phiên này</div>
                  {PERMS.map((x) => {
                    const off = x.k === "auto" && !!cp && !cp.allowBypass;
                    return (
                      <button key={x.k} disabled={off} className={`cv-mode-item ${permNow.mode === x.k ? "picked" : ""}`} onClick={() => { setPerm({ mode: x.k, allow: permNow.allow }); setMenu(""); say(`Chế độ quyền: ${x.label}`); }}>
                        <span className={`cv-mode-ic p-${x.k}`}>{permIcon(x.k, 18)}</span>
                        <span className="cv-opt-t">{x.label}<small>{off ? "Đang tắt ở Cài đặt → Synchro Code (Cho phép chế độ Tự động)." : x.desc}</small></span>
                        {permNow.mode === x.k && <span className="ck"><I.Check /></span>}
                      </button>
                    );
                  })}
                  {permNow.allow.length > 0 && <><hr /><button className="menu-item" onClick={() => { setPerm({ mode: permNow.mode, allow: [] }); setMenu(""); say("Đã bỏ các quyền \"luôn cho phép\" của phiên"); }}><I.Retry />Bỏ {permNow.allow.length} quyền "luôn cho phép"</button></>}
                </Menu>
              </div>
              <div className="cv-sp" />
              {/* Bộ chọn model + mức nỗ lực dùng chung với khung chat thường (khóa model quản trị viên chưa cho phép). */}
              <div className="cv-model" data-notr>{modelPicker}</div>
              <div style={{ position: "relative" }}>
                {/* Mức dùng API (giới hạn phiên, tuần, hạn mức nhà cung cấp) kèm ngữ cảnh của phiên code này. */}
                <UsageRing model={model} onDetails={() => app.openSettings?.("Usage")} extra={<div className="us-ctx"><div className="us-sub">Ngữ cảnh phiên chat · {Math.round(pct)}%</div>{ctxPanel}</div>} />
              </div>
            </div>
          </div>
        </div>
        </div>
        {rail && <SessionRail sid={sid} status={status} git={git} onGit={(g) => sid !== null && setGit(sid, g)} say={say} context={ctxPanel} onClose={() => setRail(false)} />}
      </div>
      </div>

      {pane && <div className="cv-split" onMouseDown={startDrag} onDoubleClick={() => setPaneW(560)} />}
      <div className={`cv-side ${pane ? "" : "hide"}`} style={{ width: dragW ?? paneW }}>
        <div className="cv-side-h" hidden={pane === "browser"}>
          {(["terminal", "browser", "files", "block"] as PaneKind[]).filter((k) => mountedP.includes(k) && (k !== "block" || panel)).map((k) => (
            <button key={k} className={`cv-side-tab ${pane === k ? "on" : ""}`} onClick={() => setPane(k)}>
              {k === "terminal" ? <><I.Terminal size={14} />Terminal</> : k === "browser" ? <><I.Globe size={14} />Trình duyệt</> : k === "files" ? <><I.Folder size={14} />File</> : <><I.Code size={14} /><span className="cv-ell" data-notr>{panel?.name}</span></>}
            </button>
          ))}
          <div className="cv-sp" />
          <button className="icon-btn" onClick={() => setPaneMax(!paneMax)} aria-label={paneMax ? "Thu nhỏ" : "Phóng to"} title={paneMax ? "Thu nhỏ" : "Phóng to"}>{paneMax ? <I.M icon="Collapse" size={15} /> : <I.M icon="Expand" size={15} />}</button>
          <button className="icon-btn" onClick={() => { setPane(null); setPaneMax(false); }} aria-label="Đóng khung" title="Đóng khung"><I.X size={15} /></button>
        </div>
        <div className="cv-side-b">
          {sid !== null && mountedP.includes("terminal") && <div className="cv-pane" hidden={pane !== "terminal"}><TerminalPane sid={sid} visible={pane === "terminal"} /></div>}
          {sid !== null && mountedP.includes("browser") && <div className="cv-pane" hidden={pane !== "browser"}><BrowserPane sid={sid} visible={pane === "browser"} say={say} onClose={() => { setPane(null); setPaneMax(false); }} onExpand={() => setPaneMax(!paneMax)} expanded={paneMax} autoOpen={autoBrowser} setAutoOpen={setAutoBrowser} /></div>}
          {sid !== null && mountedP.includes("files") && <div className="cv-pane" hidden={pane !== "files"}><FilesPane sid={sid} visible={pane === "files"} say={say} /></div>}
          {panel && <div className="cv-pane" hidden={pane !== "block"}><SidePanel key={panel.name + panel.code.length} panel={panel} setPanel={setPanel} say={say} onFix={autoFix} /></div>}
        </div>
      </div>
      </div>

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
                  <div className="cvg-hero"><b>4 chế độ làm việc</b><span>Chọn bằng nút chế độ cạnh khung chat. Mặc định là Tự động.</span></div>
                  <div className="cvg-card"><h4><I.Sparkle size={16} />Tự động</h4><p>Synchro tự lập kế hoạch khi việc lớn, viết code khi việc đã rõ, gỡ lỗi khi gặp lỗi, và chuyển qua lại ngay trong một lượt (ví dụ viết xong chạy thử thấy lỗi thì sửa luôn). Các giai đoạn đã đi qua hiện ở đầu câu trả lời.</p></div>
                  <div className="cvg-grid3">
                    <div className="cvg-mode"><span className="ic b"><I.Layers size={20} /></span><b>Plan</b><span>Chỉ phân tích cấu trúc và lập kế hoạch từng bước, không viết code. Hợp khi bắt đầu dự án.</span></div>
                    <div className="cvg-mode"><span className="ic g"><I.Code size={20} /></span><b>Code</b><span>Sinh code hoàn chỉnh, chạy được, kèm ghi chú ngắn.</span></div>
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
            <div className="cv-mh big">{viewer.k === "error" ? <I.M icon="Alert" size={16} /> : <I.M icon="Code" size={16} />}{viewer.name}<button className="icon-btn" onClick={() => setViewer(null)} aria-label="Đóng"><I.X size={16} /></button></div>
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
          <button className="icon-btn" onClick={download} aria-label="Tải về"><I.Download size={16} /></button>
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
