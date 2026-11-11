"use client";
// Tô màu cú pháp (Shiki) cho khối code trong chat và tab Mã của artifact.
// - Tải chậm: lõi Shiki, bộ regex JavaScript (không WASM) và hai giao diện màu chỉ tải khi trang có khối code đầu tiên; mỗi ngôn ngữ là một
//   phần tải riêng, chỉ tải khi gặp ngôn ngữ đó. Phần tải đầu của trang chat không đổi.
// - Không chặn chữ đang chảy: chỉ tô khối đã đóng (```), chờ chữ đứng yên một nhịp, làm lúc trình duyệt rảnh.
// - Đang tải, ngôn ngữ lạ, khối quá dài: hiện như cũ (chữ đơn sắc). Màu sáng / tối theo biến CSS --shiki-light / --shiki-dark (globals.css).
import { useEffect, useState } from "react";
import type { HighlighterCore, LanguageRegistration } from "@shikijs/core";

type LangMod = Promise<{ default: LanguageRegistration[] }>;
// 22 ngôn ngữ thường gặp. Từ khóa là tên Shiki; ALIAS đổi tên hay gặp trong khối code (```py, ```sh…) về tên này.
const LANGS: Record<string, () => LangMod> = {
  javascript: () => import("@shikijs/langs/javascript"), typescript: () => import("@shikijs/langs/typescript"),
  tsx: () => import("@shikijs/langs/tsx"), jsx: () => import("@shikijs/langs/jsx"), python: () => import("@shikijs/langs/python"),
  shellscript: () => import("@shikijs/langs/shellscript"), json: () => import("@shikijs/langs/json"), html: () => import("@shikijs/langs/html"),
  css: () => import("@shikijs/langs/css"), sql: () => import("@shikijs/langs/sql"), go: () => import("@shikijs/langs/go"),
  rust: () => import("@shikijs/langs/rust"), java: () => import("@shikijs/langs/java"), c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"), csharp: () => import("@shikijs/langs/csharp"), yaml: () => import("@shikijs/langs/yaml"),
  diff: () => import("@shikijs/langs/diff"), swift: () => import("@shikijs/langs/swift"), kotlin: () => import("@shikijs/langs/kotlin"),
  php: () => import("@shikijs/langs/php"), xml: () => import("@shikijs/langs/xml"),
};
const ALIAS: Record<string, string> = {
  js: "javascript", mjs: "javascript", cjs: "javascript", node: "javascript", ts: "typescript", mts: "typescript", py: "python", python3: "python",
  sh: "shellscript", bash: "shellscript", zsh: "shellscript", shell: "shellscript", console: "shellscript", json5: "json", jsonc: "json",
  htm: "html", xhtml: "html", svg: "xml", rs: "rust", golang: "go", "c++": "cpp", cc: "cpp", hpp: "cpp", h: "c", cs: "csharp", "c#": "csharp",
  yml: "yaml", patch: "diff", kt: "kotlin", kts: "kotlin", react: "tsx", postgres: "sql", postgresql: "sql", mysql: "sql", sqlite: "sql",
};
/** Tên ngôn ngữ Shiki cho nhãn của khối code, hoặc null nếu không tô được (giữ chữ đơn sắc). */
export const shikiLang = (lang: string): string | null => { const l = lang.trim().toLowerCase(); const n = ALIAS[l] ?? l; return LANGS[n] ? n : null; };

// Khối quá dài: tô màu tốn thời gian và hàng chục nghìn thẻ <span>; để chữ đơn sắc.
const MAX_CHARS = 60_000, MAX_LINES = 2_500;
export type Tok = { t: string; l?: string; d?: string };

let core: Promise<HighlighterCore> | null = null;
const loaded = new Map<string, Promise<void>>();
function highlighter() {
  core ??= Promise.all([import("@shikijs/core"), import("@shikijs/engine-javascript")]).then(([{ createHighlighterCore }, { createJavaScriptRegexEngine }]) =>
    createHighlighterCore({ themes: [import("@shikijs/themes/github-light"), import("@shikijs/themes/github-dark")], langs: [], engine: createJavaScriptRegexEngine({ forgiving: true }) }));
  return core;
}
async function ensureLang(h: HighlighterCore, name: string) {
  let p = loaded.get(name);
  if (!p) { p = LANGS[name]().then((m) => h.loadLanguage(...m.default)); loaded.set(name, p); }
  return p;
}
// Kết quả theo (ngôn ngữ, code): mở lại đoạn chat hay vẽ lại tin không phải tô lại.
const memo = new Map<string, Tok[][]>();
export async function tokenize(code: string, lang: string): Promise<Tok[][] | null> {
  const name = shikiLang(lang);
  if (!name || !code || code.length > MAX_CHARS || code.split("\n", MAX_LINES + 1).length > MAX_LINES) return null;
  const key = `${name}\u0000${code}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const h = await highlighter();
  await ensureLang(h, name);
  const r = h.codeToTokens(code, { lang: name, themes: { light: "github-light", dark: "github-dark" }, defaultColor: false });
  const out = r.tokens.map((line) => line.map((tk) => ({ t: tk.content, l: tk.htmlStyle?.["--shiki-light"], d: tk.htmlStyle?.["--shiki-dark"] })));
  if (memo.size > 200) memo.delete(memo.keys().next().value!);
  memo.set(key, out);
  return out;
}

const idle = (f: () => void) => {
  const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (n: number) => void };
  if (w.requestIdleCallback) { const n = w.requestIdleCallback(f, { timeout: 800 }); return () => w.cancelIdleCallback?.(n); }
  const n = setTimeout(f, 30); return () => clearTimeout(n);
};
/** Dòng đã tô màu của khối code, hoặc null (chưa xong / không tô): khi null hiện chữ đơn sắc như trước. ready: khối đã đóng, chữ không còn chảy. */
export function useHighlight(code: string, lang: string, ready = true): Tok[][] | null {
  const name = ready ? shikiLang(lang) : null;
  const [res, setRes] = useState<{ key: string; toks: Tok[][] } | null>(null);
  const key = name ? `${name}\u0000${code}` : "";
  useEffect(() => {
    if (!name) return;
    const cached = memo.get(key);
    if (cached) { setRes({ key, toks: cached }); return; }
    let live = true, stop = () => {};
    // Chờ một nhịp cho chữ đứng yên (bản sửa artifact, khối vừa đóng), rồi tô lúc trình duyệt rảnh.
    const t = setTimeout(() => { stop = idle(() => { tokenize(code, name).then((toks) => { if (live && toks) setRes({ key, toks }); }, () => {}); }); }, 150);
    return () => { live = false; clearTimeout(t); stop(); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return res && res.key === key ? res.toks : null;
}

/** Một dòng đã tô màu. */
export function TokLine({ toks }: { toks: Tok[] }) {
  return <>{toks.map((k, i) => (k.l || k.d ? <span key={i} style={{ "--shiki-light": k.l, "--shiki-dark": k.d } as React.CSSProperties}>{k.t}</span> : k.t))}</>;
}
