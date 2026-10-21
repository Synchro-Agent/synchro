// Logic thuần (không React) cho Synchro Code: Secret Vault, phân tích paste, lệnh /, gói npm, cron, meta độ phức tạp.

// ---------------------------------------------------------------- SECRET VAULT
const vault = new Map<string, string>();
const rev = new Map<string, string>();
let seq = 0;

const SECRET_RES: RegExp[] = [
  /\b(?:postgres(?:ql)?|mongodb(?:\+srv)?|redis|mysql|amqp):\/\/[^\s'"`<>]+/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
];
const ENV_RE = /^(\s*(?:export\s+)?[A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD)[A-Z0-9_]*\s*=\s*)(["']?)([^\s"'#]{4,})\2/gm;

function tag(secret: string): string {
  const old = rev.get(secret);
  if (old) return old;
  const t = `<REDACTED_KEY_${++seq}>`;
  vault.set(t, secret); rev.set(secret, t);
  return t;
}

export function redact(text: string): { text: string; count: number } {
  let count = 0;
  let out = text;
  const sub = (s: string) => { count++; return tag(s); };
  out = out.replace(ENV_RE, (_m, pre: string, q: string, val: string) => (val.startsWith("<REDACTED") ? _m : pre + q + sub(val) + q));
  for (const re of SECRET_RES) out = out.replace(re, (m) => sub(m));
  return { text: out, count };
}
export const unredact = (text: string) => (vault.size ? text.replace(/<REDACTED_KEY_\d+>/g, (t) => vault.get(t) ?? t) : text);

// ---------------------------------------------------------------- SMART PASTE
export type Pill = { label: string; prompt: string };
export type PasteInfo = { type: string; pills: Pill[] };

export function analyzePaste(t: string): PasteInfo {
  const s = t.trim();
  if (/^[[{][\s\S]*[\]}]$/.test(s)) {
    try {
      JSON.parse(s);
      return { type: "JSON", pills: [
        { label: "Tạo TS Interface", prompt: "Từ JSON đã dán, hãy tạo TypeScript interface tương ứng." },
        { label: "Tạo Zod Schema", prompt: "Từ JSON đã dán, hãy tạo Zod schema tương ứng." },
        { label: "Format", prompt: "Format lại JSON đã dán cho đẹp, thụt lề 2 spaces." },
      ] };
    } catch { /* không phải JSON hợp lệ */ }
  }
  if (/^\s*curl\s/i.test(s)) return { type: "cURL", pills: [
    { label: "Chuyển sang Fetch/Axios", prompt: "Chuyển lệnh cURL đã dán sang fetch và axios (TypeScript)." },
    { label: "Chuyển sang Python Requests", prompt: "Chuyển lệnh cURL đã dán sang Python requests." },
  ] };
  if (/^\s*(select|insert|update|delete|create\s+table|with)\b[\s\S]*\b(from|into|set|table|as)\b/i.test(s)) return { type: "SQL", pills: [
    { label: "Tối ưu & gợi ý Index", prompt: "Tối ưu câu SQL đã dán và gợi ý index cần thiết." },
    { label: "Chuyển sang Prisma/Drizzle", prompt: "Chuyển câu SQL đã dán sang Prisma và Drizzle ORM." },
  ] };
  if (/(Traceback \(most recent|Exception|Error:|^\s+at\s+\S+|FATAL|panic:|Uncaught)/m.test(s)) return { type: "Stack trace", pills: [
    { label: "Tìm nguyên nhân gốc", prompt: "Phân tích stack trace đã dán và tìm nguyên nhân gốc." },
    { label: "Viết try-catch xử lý", prompt: "Viết đoạn try-catch xử lý đúng lỗi trong stack trace đã dán." },
  ] };
  if (/[.#]?[\w-]+\s*\{[^}]*:[^}]*;/.test(s) && !/\bfunction\b|=>/.test(s)) return { type: "CSS", pills: [
    { label: "Chuyển sang Tailwind", prompt: "Chuyển đoạn CSS đã dán sang Tailwind CSS classes." },
    { label: "Tách CSS variables", prompt: "Tách các giá trị lặp trong CSS đã dán thành CSS variables." },
  ] };
  return { type: "Code", pills: [] };
}

// ---------------------------------------------------------------- SLASH
export const SLASH = [
  { cmd: "/commit", desc: "Viết commit message (Conventional Commits)", sys: "Viết commit message theo chuẩn Conventional Commits từ các thay đổi trong ngữ cảnh. Chỉ trả về message." },
  { cmd: "/review", desc: "Review code: bug, bảo mật, hiệu năng", sys: "Review code: liệt kê bug, lỗ hổng bảo mật và vấn đề hiệu năng, kèm gợi ý sửa ngắn gọn." },
  { cmd: "/test", desc: "Viết unit test", sys: "Viết unit test đầy đủ (happy path, edge case, lỗi) cho code trong ngữ cảnh." },
  { cmd: "/docs", desc: "Viết tài liệu / JSDoc", sys: "Viết tài liệu và JSDoc/docstring cho code trong ngữ cảnh." },
  { cmd: "/refactor", desc: "Refactor cho sạch và gọn hơn", sys: "Refactor code cho sạch, dễ đọc hơn, giữ nguyên hành vi. Giải thích ngắn thay đổi." },
] as const;

// ---------------------------------------------------------------- CODEBASE
export function extractSymbols(name: string, text: string): { name: string; file: string; code: string }[] {
  const lines = text.split("\n");
  const out: { name: string; file: string; code: string }[] = [];
  const re = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?\s+(\w+)|class\s+(\w+)|(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>|def\s+(\w+)|func\s+(\w+))/;
  lines.forEach((l, i) => {
    const m = l.match(re);
    const nm = m && (m[1] || m[2] || m[3] || m[4] || m[5]);
    if (nm) out.push({ name: nm, file: name, code: lines.slice(i, i + 40).join("\n") });
  });
  return out;
}
export function pickRelevant(files: { name: string; text: string }[], query: string, k = 5) {
  const words = Array.from(new Set(query.toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) ?? []));
  const all = files.flatMap((f) => extractSymbols(f.name, f.text));
  return all
    .map((s) => ({ s, sc: words.reduce((a, w) => a + (s.name.toLowerCase().includes(w) ? 3 : 0) + (s.code.toLowerCase().includes(w) ? 1 : 0), 0) }))
    .filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, k).map((x) => x.s);
}

// ---------------------------------------------------------------- CODE BLOCK
export function filepathOf(code: string): string | null {
  const m = code.split("\n", 1)[0].match(/^(?:\/\/|#|<!--|\/\*)\s*(?:filepath:\s*)?([\w@./\\-]+\.[a-z]{1,5})\b/i);
  return m ? m[1] : null;
}

export const EXISTING_RE = /^[ \t]*(?:\/\/|#|\/\*|<!--)\s*\.\.\.\s*(?:existing|rest of|unchanged)[^\n]*$/gim;
export const hasHidden = (code: string) => { EXISTING_RE.lastIndex = 0; return EXISTING_RE.test(code); };

/** Thay `// ... existing code ...` bằng đoạn gốc tương ứng (0 token). Trả null nếu không có bản gốc. */
export function autoMerge(code: string, original: string | undefined): string | null {
  if (!original || !hasHidden(code)) return null;
  const orig = original.split("\n");
  const lines = code.split("\n");
  const isMark = (l: string) => { EXISTING_RE.lastIndex = 0; return EXISTING_RE.test(l); };
  const out: string[] = [];
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!isMark(lines[i])) {
      out.push(lines[i]);
      const at = orig.indexOf(lines[i], pos);
      if (at >= 0) pos = at + 1;
      continue;
    }
    const next = lines.slice(i + 1).find((l) => l.trim() && !isMark(l));
    let end = next ? orig.indexOf(next, pos) : orig.length;
    if (end < 0) end = orig.length;
    out.push(...orig.slice(pos, end));
    pos = end;
  }
  return out.join("\n");
}

export function balanceBraces(code: string): string {
  const stack: string[] = [];
  const pair: Record<string, string> = { "{": "}", "[": "]", "(": ")" };
  let str = "";
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (str) { if (c === "\\") i++; else if (c === str) str = ""; continue; }
    if (c === '"' || c === "'" || c === "`") str = c;
    else if (pair[c]) stack.push(pair[c]);
    else if (stack.length && c === stack[stack.length - 1]) stack.pop();
  }
  return code + (stack.length ? "\n" + stack.reverse().join("") : "");
}

// ---------------------------------------------------------------- META
export type Complexity = { time: string; space: string; canOptimize?: boolean };
const META_RE = /<!--\s*meta:\s*(\{[\s\S]*?\})\s*-->/g;
export function splitMeta(text: string): { text: string; meta: Complexity | null } {
  let meta: Complexity | null = null;
  const clean = text.replace(META_RE, (_m, j: string) => { try { meta = JSON.parse(j); } catch { /* bỏ qua */ } return ""; }).replace(/<!--\s*meta:[^>]*$/, "");
  return { text: clean, meta };
}

// ---------------------------------------------------------------- PACKAGES
export type Pkg = { eco: "npm" | "pypi" | "crates"; name: string };
export function parsePackages(cmd: string): Pkg[] {
  const out: Pkg[] = [];
  for (const line of cmd.split("\n")) {
    const l = line.trim().replace(/^[$>]\s*/, "");
    const m = l.match(/^(npm\s+(?:i|install|add)|yarn\s+add|pnpm\s+(?:add|i|install)|bun\s+add|pip3?\s+install|cargo\s+add)\s+(.*)$/);
    if (!m) continue;
    const eco = /^(pip)/.test(m[1]) ? "pypi" : m[1].startsWith("cargo") ? "crates" : "npm";
    for (const a of m[2].split(/\s+/)) {
      if (!a || a.startsWith("-") || a.startsWith(".") || a.startsWith("/") || /^(git|https?):/.test(a)) continue;
      let n = a.replace(/^['"]|['"]$/g, "");
      n = eco === "npm" ? n.replace(/^(@[^/]+\/[^@]+|[^@]+)@.*$/, "$1") : n.replace(/[=<>~!\[;].*$/, "");
      if (n) out.push({ eco, name: n });
    }
  }
  return out;
}
const pkgCache = new Map<string, Promise<"ok" | "deprecated" | "missing" | "unknown">>();
export function checkPkg(p: Pkg): Promise<"ok" | "deprecated" | "missing" | "unknown"> {
  const key = p.eco + ":" + p.name;
  const hit = pkgCache.get(key);
  if (hit) return hit;
  const url = p.eco === "npm" ? `https://registry.npmjs.org/${p.name.replace("/", "%2F")}`
    : p.eco === "pypi" ? `https://pypi.org/pypi/${encodeURIComponent(p.name)}/json`
    : `https://crates.io/api/v1/crates/${encodeURIComponent(p.name)}`;
  const pr = fetch(url).then(async (r) => {
    if (r.status === 404) return "missing" as const;
    if (!r.ok) return "unknown" as const;
    const j = await r.json();
    if (p.eco === "npm") { const lt = j["dist-tags"]?.latest; return j.versions?.[lt]?.deprecated ? "deprecated" as const : "ok" as const; }
    if (p.eco === "pypi") return /inactive/i.test(JSON.stringify(j.info?.classifiers ?? [])) ? "deprecated" as const : "ok" as const;
    return "ok" as const;
  }).catch(async () => {
    if (p.eco !== "npm") return "unknown" as const;
    // registry trả 404 không kèm CORS -> hỏi search API (có CORS)
    try {
      const j = await (await fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(p.name)}&size=5`)).json();
      return j.objects?.some((o: { package: { name: string } }) => o.package.name === p.name) ? "ok" as const : "missing" as const;
    } catch { return "unknown" as const; }
  });
  pkgCache.set(key, pr);
  return pr;
}

// ---------------------------------------------------------------- CRON
const DOW = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];
function parseField(f: string, min: number, max: number): number[] | null {
  const set = new Set<number>();
  for (const part of f.split(",")) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) return null;
    const step = m[2] ? +m[2] : 1;
    let a = min, b = max;
    if (m[1] !== "*") { const [x, y] = m[1].split("-"); a = +x; b = y !== undefined ? +y : m[2] ? max : +x; }
    if (a < min || b > max || step < 1) return null;
    for (let i = a; i <= b; i += step) set.add(i);
  }
  return [...set].sort((x, y) => x - y);
}
export function cronInfo(expr: string): { text: string; next: Date[] } | null {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) return null;
  const f = [parseField(p[0], 0, 59), parseField(p[1], 0, 23), parseField(p[2], 1, 31), parseField(p[3], 1, 12), parseField(p[4].replace(/\b7\b/g, "0"), 0, 6)];
  if (f.some((x) => !x)) return null;
  const [mi, hr, dom, mon, dow] = f as number[][];
  const bits: string[] = [];
  if (p[0].startsWith("*/") && p[1] === "*") bits.push(`Mỗi ${p[0].slice(2)} phút`);
  else if (p[0] === "*" && p[1] === "*") bits.push("Mỗi phút");
  else if (mi.length === 1 && hr.length === 1) bits.push(`Lúc ${String(hr[0]).padStart(2, "0")}:${String(mi[0]).padStart(2, "0")}`);
  else bits.push(`Phút ${p[0]}, giờ ${p[1]}`);
  bits.push(p[4] === "*" ? (p[2] === "*" ? "hằng ngày" : `ngày ${p[2]} hằng tháng`) : "vào " + dow.map((d) => DOW[d]).join(", "));
  if (p[3] !== "*") bits.push(`tháng ${p[3]}`);
  const next: Date[] = [];
  const d = new Date(); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 600000 && next.length < 3; i++, d.setMinutes(d.getMinutes() + 1)) {
    if (!mon.includes(d.getMonth() + 1) || !hr.includes(d.getHours()) || !mi.includes(d.getMinutes())) continue;
    const dm = p[2] !== "*", dw = p[4] !== "*";
    const okDay = dm && dw ? dom.includes(d.getDate()) || dow.includes(d.getDay()) : dm ? dom.includes(d.getDate()) : dw ? dow.includes(d.getDay()) : true;
    if (okDay) next.push(new Date(d));
  }
  return { text: bits.join(" "), next };
}
export const findCron = (code: string) => code.match(/(?:^|["'`\s])((?:[\d*/,-]+\s+){4}[\d*/,-]+)(?=["'`\s]|$)/m)?.[1] ?? null;
