// Đồng bộ danh mục skill của Claude (thư mục plugin công khai của Anthropic) thành catalog/claude-directory.json cho tab Khám phá.
// Chạy tay: node scripts/sync-claude-directory.mjs [bản tải sẵn.json]  (không có đối số thì tải trực tiếp, không cần đăng nhập).
// Chỉ lấy plugin có skill (Synchro cài skill, không cài MCP / lệnh / agent riêng của Claude Code). Mỗi plugin giữ nguồn GitHub đúng
// commit Anthropic đã duyệt (reviewed_commit), mục ngành nghề theo taxonomy của Claude, tên skill để tìm kiếm.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const API = "https://api.anthropic.com/api/directory/plugins";
async function fetchAll() {
  const out = []; let page = null;
  for (;;) {
    const q = new URLSearchParams({ visibility: "public", limit: "100", include: "description,launch" });
    if (page) q.set("page", page);
    let j = null;
    for (let t = 0; t < 5 && !j; t++) {
      try { const r = await fetch(`${API}?${q}`, { headers: { "user-agent": "SynchroDirectorySync/1.0" } }); if (r.ok) j = await r.json(); } catch {}
      if (!j) await new Promise((r) => setTimeout(r, 3000));
    }
    if (!j) throw new Error(`Không tải được trang ${out.length / 100 + 1} của thư mục.`);
    out.push(...j.data); page = j.next_page;
    if (!page || !j.data.length) return out;
    await new Promise((r) => setTimeout(r, 300));
  }
}

// taxonomy của Claude → khóa mục của Synchro (app/plugindir.ts PLUGIN_CATS). Hai mục riêng của Claude (claude-history, claude-settings)
// chuyển sang mục gần nhất của Synchro.
const MAP = {
  work_department: { engineering: "engineering", marketing: "marketing", sales: "sales", operations: "operations", product: "product", finance: "finance", data: "data", design: "design", legal: "legal", "it-security": "security", hr: "hr", "customer-support": "support" },
  object_acted_on: { code: "code", "files-documents": "docs", "designs-media": "media", "tickets-tasks": "tasks", "pipelines-jobs": "pipelines", apis: "apis", "notes-memory": "notes", "reference-docs": "reference", "ai-models-agents": "ai", websites: "websites", "claude-history": "notes", databases: "databases", "contacts-leads": "leads", "servers-cloud": "cloud", finances: "finance", "logs-errors": "logs", "email-messages": "messages", "pull-requests": "prs", "claude-settings": "ai", "dependencies-packages": "packages", "papers-articles": "research", "courses-lessons": "learning", "music-podcasts": "music", "events-tickets": "events", "problems-puzzles": "puzzles", "workouts-health-records": "fitness", trips: "travel", "recipes-meals": "food", books: "books" },
  industry: { "software-saas": "engineering", "financial-services": "finserv", legal: "legal", "retail-ecommerce": "ecommerce", "health-life-sciences": "health", "real-estate": "finserv", manufacturing: "operations", construction: "operations", "media-entertainment": "entertainment", government: "government", "research-academia": "research", education: "education", energy: "operations", "transportation-logistics": "operations", "travel-hospitality": "hospitality", "agencies-staffing": "hr", insurance: "finserv", telecommunications: "cloud", nonprofit: "nonprofit", "fitness-wellness": "fitness", agriculture: "food", events: "events" },
  life_area: { learning: "learning", "work-career": "career", research: "research", "social-media": "marketing", money: "personal-finance", writing: "writing", travel: "travel", music: "music", games: "games", shopping: "shopping", fitness: "fitness", "family-relationships": "family", "events-going-out": "events", sports: "sports", health: "fitness", faith: "faith", home: "home", "arts-crafts": "design", food: "food", "photos-videos": "media", "books-reading": "books", "beauty-grooming": "shopping", news: "entertainment", "film-tv": "entertainment", cars: "home", "maps-transit": "travel" },
  subject: { law: "legal", computing: "code", science: "research", education: "education", languages: "learning", medicine: "health", economics: "finance", "philosophy-religion": "faith", engineering: "engineering", "business-management": "operations", psychology: "health", maths: "learning", "the-arts": "design", "politics-government": "government", history: "learning" },
};
const ORDER = ["object_acted_on", "work_department", "industry", "life_area", "subject"];
// Plugin chưa được Anthropic gắn taxonomy: đoán theo tên và mô tả, mặc định Engineering (phần lớn là skill lập trình).
const GUESS = [[/\b(seo|marketing|campaign|brand|social|ads?)\b/i, "marketing"], [/\b(sales|crm|lead|prospect)\b/i, "sales"], [/\b(legal|contract|law|compliance)\b/i, "legal"],
  [/\b(financ|accounting|invoice|budget|tax)\w*/i, "finance"], [/\b(design|figma|ui|ux|brand)\b/i, "design"], [/\b(data|analytics|sql|dashboard)\b/i, "data"],
  [/\b(writ|blog|copy|essay|story)\w*/i, "writing"], [/\b(research|paper|scholar|science)\w*/i, "research"], [/\b(health|medical|clinic)\w*/i, "health"],
  [/\b(security|pentest|vuln|threat)\w*/i, "security"], [/\b(doc|pdf|docx|spreadsheet|slides?)\b/i, "docs"], [/\b(learn|course|tutor|study)\w*/i, "learning"]];

function catsOf(p) {
  const out = [];
  for (const k of ORDER) for (const v of [].concat(p.taxonomy?.[k] ?? [])) { const c = MAP[k][v]; if (c && !out.includes(c)) out.push(c); }
  if (!out.length) { const t = `${p.name} ${p.summary ?? ""}`; out.push(GUESS.find(([re]) => re.test(t))?.[1] ?? "engineering"); }
  return out;
}

// Tên thư viện trong Synchro: [a-z0-9-], tối đa 41 ký tự, không trùng.
const used = new Set();
function slugOf(s) {
  let b = String(s).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 36).replace(/-$/, "") || "plugin";
  if (!/^[a-z0-9]/.test(b)) b = "p" + b;
  let x = b, i = 2;
  while (used.has(x)) x = `${b}-${i++}`;
  used.add(x);
  return x;
}

const src = process.argv[2];
const raw = src ? JSON.parse(fs.readFileSync(src, "utf8")) : await fetchAll();
const list = (Array.isArray(raw) ? raw : raw.data).filter((p) => (p.components ?? []).some((c) => c.type === "skill") && p.source?.repository?.url);
// Thứ tự như thư mục của Claude (phổ biến trước), plugin của Anthropic và đối tác lên đầu.
const TIER = { anthropic: 0, partner: 1 };
list.forEach((p, i) => (p._i = i));
list.sort((a, b) => (TIER[a.verified_tier] ?? 2) - (TIER[b.verified_tier] ?? 2) || a._i - b._i);
const plugins = list.map((p) => {
  const r = p.source.repository;
  const repo = r.url.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
  const comps = p.components.filter((c) => c.type === "skill");
  const skills = comps.map((c) => c.name);
  const lic = typeof p.license === "string" ? p.license : "";
  return {
    id: p.slug, slug: slugOf(p.slug), name: p.name, summary: String(p.summary ?? "").replace(/\s+/g, " ").trim().slice(0, 280),
    author: repo.split("/")[0],
    cats: catsOf(p), license: lic, repo, path: r.path && r.path !== "." ? r.path.replace(/^\.?\/|\/$/g, "") : "", commit: r.reviewed_commit ?? "",
    homepage: p.links?.homepage || `https://github.com/${repo}`, skills, verified: p.verified_tier || undefined,
    // D4: tên + mô tả từng skill để bộ phân loại bằng model xếp mục (không ghi ra JSON — xóa trước khi lưu).
    _skills: comps.map((c) => ({ name: c.name, description: String(c.description ?? c.summary ?? "").replace(/\s+/g, " ").trim() })),
  };
});
// Giấy phép đóng (thư mục ghi rõ: Proprietary, BUSL, PolyForm, SSAL, Commons Clause…): không sao chép (closed). Thư viện mở thay thế chọn tay
// trong catalog/alternatives.json: thư viện mở của chính danh mục (alt) và repo mở trên GitHub khi danh mục không có (thêm vào danh mục với
// id "gh/…", cùng mục ngành nghề). Không ghi giấy phép: đọc tệp LICENSE trong repo lúc cài (plugins.ts) như mọi repo khác.
const OPEN = /^\(?\s*(MIT|MIT-0|Apache|BSD|0BSD|ISC|MPL|CC-BY|CC0|Unlicense\b|Zlib|WTFPL|PSF|Python|EPL|BSL-1\.0|LGPL|GPL|AGPL|Artistic|Unicode|BlueOak)/i;
const isOpen = (l) => !l || l.split(/\s+(?:OR|AND|WITH)\s+/i).some((x) => OPEN.test(x.trim()));
const ALT = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "catalog", "alternatives.json"), "utf8"));
// Thư viện thư mục không ghi giấy phép nhưng lúc cài đọc ra giấy phép đóng (quản trị viên lấy từ GET /api/plugins/catalog?blocked=1, lưu thành catalog/license-blocked.json).
const blockedFile = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "catalog", "license-blocked.json");
const BLOCKED = fs.existsSync(blockedFile) ? JSON.parse(fs.readFileSync(blockedFile, "utf8")) : {};
const byId = new Map(plugins.map((p) => [p.id, p]));
const extra = new Map();
for (const p of plugins) {
  if (isOpen(p.license) && !BLOCKED[`cd:${p.id}`]) continue;
  p.closed = true;
  if (!p.license) p.license = "Độc quyền";
  const a = ALT[p.name] ?? {};
  const ids = (a.catalog ?? []).filter((id) => { const o = byId.get(id); if (!o) console.warn(`! ${p.name}: không có ${id} trong danh mục`); return o && isOpen(o.license); });
  for (const g of a.github ?? []) {
    const id = `gh/${g.repo}`;
    const e = extra.get(id) ?? { id, slug: slugOf(g.repo.replace("/", "-")), name: g.name, summary: g.summary, author: g.repo.split("/")[0], cats: [], license: "", repo: g.repo, path: "", commit: "", homepage: `https://github.com/${g.repo}`, skills: [], github: true, altFor: [] };
    for (const c of p.cats) if (!e.cats.includes(c)) e.cats.push(c);
    e.altFor.push(p.name);
    extra.set(id, e); ids.push(id);
  }
  // Không có trong alternatives.json (chưa ai xem): để trống alt, lúc chạy claudedir.ts tự tìm thư viện mở gần nhất. Có mà rỗng: đã xem, danh mục không có.
  if (ALT[p.name]) p.alt = [...new Set(ids)];
}

// D5: repo mở thêm từ GitHub (gh/…) chưa có commit — thư mục của Claude ghim commit đã duyệt, các repo này thì chưa. Phân giải HEAD của nhánh
// mặc định thành một SHA cụ thể và ghim lại, để không bao giờ cài theo nhánh trôi. Không phân giải được (hết hạn ngạch, mạng…) thì để trống:
// claudedir.ts từ chối cài thư viện không có commit, nên không có nguy cơ cài theo HEAD.
async function resolveHead(repo) {
  const headers = { "user-agent": "SynchroDirectorySync/1.0", accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}/commits/HEAD`, { headers });
      if (r.ok) { const j = await r.json(); if (typeof j.sha === "string" && /^[0-9a-f]{40}$/.test(j.sha)) return j.sha; return ""; }
      if (r.status === 404) return "";
      if (r.status === 403) await new Promise((x) => setTimeout(x, 2000));
    } catch { await new Promise((x) => setTimeout(x, 1500)); }
  }
  return "";
}
{
  let pinned = 0;
  for (const e of extra.values()) {
    if (e.commit) continue;
    e.commit = await resolveHead(e.repo);
    if (e.commit) pinned++; else console.warn(`! ${e.repo}: không phân giải được HEAD — sẽ không cài được tới khi ghim được commit.`);
    await new Promise((x) => setTimeout(x, 150));
  }
  if (extra.size) console.log(`Ghim commit cho repo mở thêm: ${pinned}/${extra.size}.`);
}
plugins.push(...extra.values());

// ---------------------------------------------------------------- D4: xếp mục Artifacts (docs/slides/design) bằng model, một lần lúc đồng bộ
// Bật bằng SYNCHRO_CLASSIFY_STUDIOS=1 và có ANTHROPIC_API_KEY. Mặc định TẮT: không gọi mạng, không đổi hành vi — khi thiếu nhãn, lúc cài
// skillstudio.classifyCatalog lùi về bộ luật từ khóa. Dùng chung đúng prompt với máy chủ (studiorules.ts) qua bộ nạp TypeScript của kiểm thử,
// nên định nghĩa mục không bị lệch giữa lúc đồng bộ và lúc chạy.
async function classifyStudios(all) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { console.warn("! SYNCHRO_CLASSIFY_STUDIOS=1 nhưng thiếu ANTHROPIC_API_KEY — bỏ qua phân loại, lúc cài dùng bộ luật."); return 0; }
  let R;
  try { const { loadTs } = await import(pathToFileURL(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "tests", "lib", "ts.mjs")).href); ({ studiorules: R } = await loadTs(["studiorules"])); }
  catch (e) { console.warn("! Không nạp được studiorules để phân loại:", e.message); return 0; }
  const model = process.env.SYNCHRO_CLASSIFY_MODEL || "claude-3-5-haiku-latest";
  const ask = async (name, description) => {
    const body = { model, max_tokens: 300, system: R.STUDIO_SYSTEM, messages: [{ role: "user", content: R.studioAsk(name, description, "") }] };
    for (let t = 0; t < 4; t++) {
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify(body) });
        if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 2000 * (t + 1))); continue; }
        if (!res.ok) return null;
        const j = await res.json();
        const text = (j.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
        return R.parseStudios(text);
      } catch { await new Promise((r) => setTimeout(r, 2000 * (t + 1))); }
    }
    return null;
  };
  const PAR = Math.max(1, Math.min(16, Number(process.env.SYNCHRO_CLASSIFY_PAR) || 6));
  const jobs = [];
  for (const p of all) for (const s of p._skills ?? []) jobs.push({ p, s });
  let done = 0, tagged = 0, next = 0;
  const worker = async () => {
    for (let i = next++; i < jobs.length; i = next++) {
      const { p, s } = jobs[i];
      const r = await ask(s.name, s.description);
      if (r) { (p.studios ??= {})[s.name] = r.studios; tagged++; }
      if (++done % 500 === 0) console.log(`  phân loại ${done}/${jobs.length}…`);
    }
  };
  await Promise.all(Array.from({ length: PAR }, worker));
  console.log(`Đã xếp mục ${tagged}/${jobs.length} skill bằng model (${model}).`);
  return tagged;
}
if (process.env.SYNCHRO_CLASSIFY_STUDIOS === "1") await classifyStudios(plugins);
for (const p of plugins) delete p._skills; // trường riêng, không ghi ra JSON

const out = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "catalog", "claude-directory.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ synced: new Date().toISOString(), source: API, plugins }));
const n = plugins.reduce((a, p) => a + p.skills.length, 0);
console.log(`${plugins.length} plugin, ${n} skill → ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
const closed = plugins.filter((p) => p.closed);
console.log(`${closed.length} thư viện giấy phép đóng, ${closed.filter((p) => p.alt.length).length} có thư viện mở thay thế; thêm ${extra.size} repo mở từ GitHub`);
for (const p of closed.filter((x) => !x.alt.length)) console.log(`  chưa có thay thế mở: ${p.name}`);
