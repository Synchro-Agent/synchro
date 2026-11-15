// Lõi tô màu cú pháp (Shiki) dùng chung cho luồng chính (ui/highlight.tsx) và luồng phụ (ui/highlight.worker.ts): không React, không DOM.
import type { GrammarState, HighlighterCore, LanguageRegistration } from "@shikijs/core";

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

const CHUNK_LINES = 24, SLICE_MS = 30;
/** Dòng đã tô của code (name: tên Shiki từ shikiLang). Tô từng đoạn vài chục dòng, nối trạng thái ngữ pháp của đoạn trước (grammarState) nên
 *  màu y như tô một lần; pause (luồng chính): sau mỗi ~30ms trả lượt cho trình duyệt. Lần đầu gặp một ngôn ngữ, Shiki dựng bộ regex của
 *  ngữ pháp ngay trong dòng đầu (HTML có CSS, JS bên trong: ~200ms cho một dòng), nên luồng chính chỉ dùng cách này khi không mở được luồng phụ. */
export async function tokensOf(code: string, name: string, pause?: () => Promise<void>): Promise<Tok[][]> {
  const h = await highlighter();
  await ensureLang(h, name);
  const lines = code.split("\n"), out: Tok[][] = [];
  let state: GrammarState | undefined, t0 = performance.now();
  for (let i = 0; i < lines.length; i += CHUNK_LINES) {
    const r = h.codeToTokens(lines.slice(i, i + CHUNK_LINES).join("\n"), { lang: name, themes: { light: "github-light", dark: "github-dark" }, defaultColor: false, grammarState: state });
    state = r.grammarState;
    for (const line of r.tokens) out.push(line.map((tk) => ({ t: tk.content, l: tk.htmlStyle?.["--shiki-light"], d: tk.htmlStyle?.["--shiki-dark"] })));
    if (pause && performance.now() - t0 > SLICE_MS && i + CHUNK_LINES < lines.length) { await pause(); t0 = performance.now(); }
  }
  return out;
}
