import "server-only";
// Phần định tuyến của bộ xử lý chat (tách từ chatengine.ts, H3 bước 6a): điểm vào chatPost / chatExec, chọn model và đường chạy của lượt
// (gói CLI, khóa API, đường nhanh, đổi model khi lỗi), khởi động sẵn (prewarmChat), chọn skill / studio / thư viện cho lượt (skillSet).
import { enabledSkills, recordUse, type Skill } from "../skillstore";
import { skillsPrompt, skillTools, type ToolRun } from "../skillruntime";
import { can, canModel, limit, modelDeniedMsg, permsOf, type UserRow } from "../authstore";
import { clampEffort, connPolicy, effortCap, isEffort, legacyModel } from "../../shared/catalog";
import { catalog, mainModels, pickDefault, resolveModel } from "../providers";
import { ConnectorSession, connectorsPrompt, listConnectors } from "../connectors";
import { notConnectLink } from "../composio";
import { browserDefault, capsState, skillsOn } from "../caps";
import { overLimit, usageScope } from "../usage";
import { addSpan, currentTrace, markPrompt, markProviderCall, noteModel, span, spanOn, spanSync } from "../tracing";
import { type Exec as RunExec, deltaStep, liveNow, progress, registerExec, takeInbox, toolUseSeen, turnSignal } from "../runs";
import { prepareHistory } from "../transpile";
import { expandFileRefs } from "../fileproc";
import { READ_REF_TOOL } from "../refs";
import { validateArgs } from "../../shared/connschema";
import { ARTCHECK_RULES, CHECK_ARTIFACT_TOOL, READ_ARTIFACT_TOOL } from "../artcheck";
import { cleanBase, type ArtState } from "../../shared/vfs";
import { ARTIFACT_RULES, ASK_RULES, VIZ_RULES } from "../../shared/artifacts";
import { AUTO, autoEffort, effortLabel, inputOfChat, needsNoTools, typedText, routeModel, taskLabel, taskOf as routeTask, type RouteInput } from "../router";
import { everywhereSkills, libraryPlugins, pluginCacheGen, STUDIOS, studioOf, studioSkills, type Studio } from "../plugins";
// descHash lấy từ skillroute (cùng cách tính với skillscan): skillscan nhập i18n-server, kéo cả từ điển VI→EN vào mọi lượt chat.
import { rank, candidateKey, descHash, ownSkillFits, prepareCandidates, suggestSemantic, type Hit } from "../skillroute";
import { ruleStudios } from "../studiorules";
import { PLUGIN_CATS, STUDIO_LABEL } from "../../shared/plugindir";
import { dirCats } from "../claudedir";
import { embeddingsConfigured, nearestSkills } from "../vecstore";
import { convUntrusted } from "../convtrust";
import { CODE_RULES, runCodeTool, runner } from "../coderun";
import type { OutFile } from "../outputs";
import { anthropicWebSearch } from "../../shared/modelrules";
import { untested } from "../modelreg";
import { chatOnce, HttpErr, toAnthropic, toOpenAI, toResponses, withPages } from "../llmcall";
import { prewarmClaude, sessionPlain, SUB, subCli, subTurn } from "../ai/subs";
import { planResetMsg, sharedKeyMsg } from "../limitmsg";
import { PROJECT_DOC_RULES, PROJECT_DOC_TOOL, projectDocsLong, projectIns } from "../projectdocs";
import { REJECTED_RULE, rejectedBlock, stripAppliedNotes, withProjectIns, withRejected } from "../../shared/turnctx";
import { IMAGE_RULES, imageTool } from "../ai/imagegen";
import { scrubServerPaths } from "../ai/imagefiles";
import { BRIDGE_HOLD, openBridge } from "../mcpbridge";
import { clearStall, noteStall, stalledModels, usableModels } from "../ai/anymodel";
import { learnFromTurn } from "../memory";
import { afterTurn, BRAIN_RULES, BRAIN_TOOLS, brainRecallHybrid, topRule, warmRecall } from "../brain";
import { DENIED_NUDGE, MAX_NUDGE, NUDGE, stalled } from "../stall";
import { CONT_JOB } from "../ai/helperquota";
import { TASK_TOOL, taskBrowser, taskOf, taskRules } from "../tasktools";
import { resolveTool } from "../connproxy";
import { getPrefs as codePrefs } from "../codestore";
import { BROWSER_RULES, BROWSER_TOOLS, chatFiles, releaseBrowser } from "../browsertools";
import { useProfile, lastUserText, DEFAULT_SYSTEM, FAST_RULES, contextOf, estimate, pinnedBlock, artifactMessages, QUALITY_RULES, BRIDGE_CLIS, brainOn, CLI_TOOLS_NOTE, NARRATE_RULES, holdNeedTools, withRecall, designOf, nowBlock, crisisBlock, ARTIFACT_SYSTEM, NEED_TOOLS, useMemory } from "./prompt";
import { sweep, pending, unparkApproval, type Decision, needsAsk, applyEdit } from "./approvals";
import { notePlan } from "./planmerge";
import {
  type Lib, fold, execute, reply, toolLoop, type Exec, connTools, PLAN_TOOL, announceOffline, bridgeCall, connProxy,
  CONN_CALL, live, keepImages, sayOut, deckGate, holdAnswer, settleGate, withTurnArts, usedLibs, GEMINI_WEB_TOOL,
  WEB_DESC, mockAdapter, anthropicAdapter, citeOf, responsesAdapter, openaiAdapter, healPatch, isAbort, patchHealAsk,
  patchHealMerge, priorArts,
} from "./tools";

// Gợi ý định tuyến cho lượt này: skill hợp nhất với yêu cầu (tìm trong toàn bộ kho, cả skill bên trong thư viện)
// và skill các lượt trước đã dùng. Model đọc thẳng skill bằng tên, không phải mở thư viện trước; không hợp thì bỏ qua.
function routingPrompt(hits: Hit[], recent: { name: string; lib?: Lib }[], picked: string[] = [], open?: { lib: Lib; skills: Skill[] }) {
  const picks = (open?.skills ?? []).filter((k) => !hits.some((h) => h.skill.name === k.name));
  if (!hits.length && !recent.length && !picked.length && !picks.length) return "";
  const where = (l?: Lib) => (l ? ` (thư viện ${l.label} · ${l.key})` : "");
  return `<skill_routing>
${picked.length ? `Người dùng đã tự chọn skill cho tin nhắn này (menu + ở ô chat): ${picked.join(", ")}. Bắt buộc đọc các skill này bằng load_skill trước khi trả lời và làm theo hướng dẫn trong đó.` : ""}
${hits.length ? `Hệ thống đã đối chiếu yêu cầu mới nhất với toàn bộ kho skill. Các skill có vẻ liên quan nhất (gợi ý tự động, có thể chưa đúng):
${hits.map((h) => `- ${h.skill.name}${where(h.lib)}: ${h.skill.description.replace(/\s+/g, " ").slice(0, 180)}`).join("\n")}` : ""}
${picks.length ? `Trong thư viện ${open!.lib.label} đang mở (${open!.lib.key}), các skill hợp yêu cầu này nhất:
${picks.map((k) => `- ${k.name}: ${k.description.replace(/\s+/g, " ").slice(0, 140)}`).join("\n")}` : ""}
${recent.length ? `Các lượt trước trong đoạn chat này đã dùng: ${recent.map((r) => `${r.name}${where(r.lib)}`).join(", ")}. Nếu yêu cầu mới sửa hoặc tiếp tục sản phẩm đó, hãy đọc lại các skill này để giữ cùng phong cách và nguyên tắc.` : ""}
Bạn tự quyết định: đọc ngay các skill hợp bằng load_skill (gọi thẳng tên skill, không cần mở thư viện), bỏ qua skill không hợp, hoặc dùng search_skills để tìm thêm.
</skill_routing>`.replace(/\n{2,}/g, "\n");
}

// Chế độ studio: model là chuyên gia của lĩnh vực, tự chọn skill trong thư viện và làm luôn, không hỏi lại những gì tự quyết được.
const STUDIO_TASK: Record<Studio, string> = {
  design: "Thiết kế (giao diện, trang web, ứng dụng, logo, banner, minh họa, chuyển động). Kết quả là artifact chạy được ngay (HTML, React hoặc SVG); ảnh chụp hay tranh đặt trong thiết kế thì tạo bằng generate_image rồi dùng đúng địa chỉ công cụ đó trả về trong src hay url(...), không để ảnh giữ chỗ.",
  slides: "Trình bày (bản trình bày, pitch deck, slide báo cáo). Kết quả mặc định là artifact HTML, mỗi slide một <section class=\"slide\"> 16:9 (Synchro tự lo chuyển slide, trình chiếu, xuất PDF), ảnh minh họa tạo bằng generate_image rồi dùng đúng địa chỉ công cụ đó trả về; khi người dùng cần tệp PowerPoint thì tạo .pptx bằng run_code, ảnh đã tạo nằm ở inputs/.",
  docs: "Tài liệu (báo cáo, đề xuất, kế hoạch, thư, quy trình). Kết quả mặc định là artifact Markdown trình bày đẹp; khi người dùng cần Word hoặc PDF thì tạo tệp bằng run_code. Markdown không hiện ảnh: tài liệu cần ảnh do AI tạo thì làm Word / PDF bằng run_code (ảnh đã tạo nằm ở inputs/) hoặc artifact HTML.",
};
// Thư viện lớn hơn số này thì available_skills chỉ có skill chọn lọc đầu thư viện (studioListed), skill hợp yêu cầu của từng lượt đi ở skill_routing (studioPicks), phần còn lại tìm bằng search_skills.
const STUDIO_DIRECT = 20;
const STUDIO_RULES = (s: Studio, plugins: string[], n: number) => `<studio name="${s}">
Người dùng đang ở chế độ ${STUDIO_TASK[s]}
${n ? `Bạn có thư viện ${n} skill chuyên môn${plugins.length ? ` (từ ${plugins.slice(0, 6).join(", ")})` : ""}${n > STUDIO_DIRECT ? `: available_skills chỉ có một phần thư viện, skill hợp nhất với yêu cầu mới nhất (nếu có) nằm trong skill_routing cạnh tin nhắn. Chưa thấy skill hợp thì gọi search_skills với từ khóa và library="studio-${s}" để tìm trong cả thư viện` : " trong available_skills"}. Trước khi làm, tự chọn 1-3 skill hợp nhất với yêu cầu và gọi load_skill để đọc (đọc thêm tài liệu tham khảo nếu skill chỉ dẫn), rồi áp dụng đúng nguyên tắc của skill.` : "Chưa có thư viện skill cho studio này: dùng kiến thức chuyên môn tốt nhất của bạn."}
Đừng hỏi lại người dùng về phong cách, màu sắc, bố cục hay giọng văn: hãy tự đưa ra lựa chọn có chủ đích, nhất quán và đẹp, rồi làm luôn bản hoàn chỉnh. Chỉ hỏi khi thiếu thông tin không thể tự đoán (ví dụ tên thương hiệu thật).
Sau sản phẩm, nêu ngắn gọn 2-3 quyết định chính bạn đã chọn và gợi ý hướng chỉnh sửa.
</studio>`;

// Mục "studio-…" trong available_skills của chat thường: mở ra là danh sách skill của thư viện kèm cách dùng.
const STUDIO_WHEN: Record<Studio, string> = {
  design: "thiết kế giao diện, trang web, landing page, ứng dụng, logo, banner, poster, minh họa, bảng màu, font, chuyển động / animation, UX",
  slides: "bản trình bày, slide, pitch deck, thuyết trình, báo cáo dạng slide",
  docs: "viết tài liệu, đề xuất, báo cáo, kế hoạch, thư, thông báo nội bộ, quy trình, văn bản cần trình bày đẹp",
};
// Nội dung chỉ dựng khi model mở thư viện. Cả thư viện dài quá CAT_BODY_MAX thì chỉ liệt kê skill chọn lọc: skill của danh mục Claude đứng sau theo tên thư viện,
// không theo độ hợp với yêu cầu, liệt kê tới hết giới hạn chỉ là ~10.000 token phần lớn không liên quan. Phần còn lại tìm bằng search_skills.
function studioIndex(s: Studio, plugins: string[], lib: Skill[], curated = lib.length): Skill {
  const body = () => {
    const line = (k: Skill) => `- ${k.name}: ${k.description.slice(0, 220)}`;
    const fits = lib.reduce((n, k) => n + line(k).length, 0) <= CAT_BODY_MAX;
    const lines: string[] = [];
    let size = 0;
    for (const k of fits ? lib : lib.slice(0, curated)) {
      const l = line(k);
      if (size + l.length > CAT_BODY_MAX) break;
      lines.push(l); size += l.length;
    }
    if (lines.length < lib.length) lines.push(`- … và ${lib.length - lines.length} skill nữa: gọi search_skills với từ khóa của việc cần làm và library="studio-${s}" để tìm trong cả thư viện.`);
    return `${STUDIO_RULES(s, plugins, lib.length)}

Thư viện gồm ${lib.length} skill (gọi load_skill với đúng tên để đọc skill bạn chọn):
${lines.join("\n")}`;
  };
  return indexSkill(`studio-${s}`, `Thư viện ${lib.length} skill chuyên môn cho ${STUDIO_WHEN[s]}. Khi yêu cầu thuộc loại này, gọi load_skill("studio-${s}") trước để chọn skill phù hợp trong thư viện.`, body);
}
// Bấm nút studio mà thư viện lớn: phần liệt kê trong prompt cố định, không phụ thuộc tin nhắn. Phần này nằm ở đầu prompt: đổi theo từng câu là mất bộ đệm của cả prompt lẫn lịch sử phía sau,
// đoạn chat mới không dùng lại được phần đầu của đoạn chat khác, và gói qua CLI phải gửi lại cả khối skill mỗi lượt. Không sắp theo số lần dùng vì số đó đổi theo từng lượt.
const studioListed = (st: ReturnType<typeof studioSkills>) => (st.skills.length <= STUDIO_DIRECT ? st.skills : st.skills.slice(0, Math.min(st.curated, STUDIO_DIRECT)));
// Skill hợp nhất với yêu cầu mới nhất (cùng cách chấm với định tuyến), đi ở skill_routing cạnh tin nhắn. Luôn chừa chỗ cho skill khớp trong danh mục Claude,
// để việc mà thư viện chọn lọc không có vẫn thấy skill đúng. Không có skill khớp thì không thêm gì: mỗi dòng ở đây còn lại trong lịch sử của đoạn chat.
const STUDIO_PICKS = 8, CATALOG_SLOTS = 4;
function studioPicks(typed: string, st: ReturnType<typeof studioSkills>): Skill[] {
  if (st.skills.length <= STUDIO_DIRECT) return [];
  const own = new Set(st.skills.slice(0, st.curated));
  const hits = rank(typed, st.skills.map((skill) => ({ skill, weight: own.has(skill) ? 1 : 0.5 })), STUDIO_PICKS * 3).map((h) => h.skill);
  const cat = hits.filter((k) => !own.has(k)).slice(0, CATALOG_SLOTS);
  return [...hits.filter((k) => own.has(k)).slice(0, STUDIO_PICKS - cat.length), ...cat];
}
// Plugin không gắn studio: một mục "lib-…" mô tả plugin và tên các skill bên trong. Plugin nhỏ (≤ 2 skill) hiện thẳng từng skill.
function libIndex(l: { slug: string; name: string; description: string; skills: Skill[] }): Skill {
  const names = l.skills.map((k) => k.name);
  // Nội dung chỉ dựng khi model mở thư viện: thư viện chung có thể có hàng nghìn thư viện, phần lớn không được mở trong một lượt.
  const body = () => `<library name="${l.slug}">
Thư viện skill của plugin ${l.name}. Chọn 1-3 skill hợp nhất với yêu cầu, gọi load_skill với đúng tên để đọc (đọc thêm tài liệu tham khảo nếu skill chỉ dẫn), rồi áp dụng đúng nguyên tắc của skill.
</library>

Thư viện gồm ${l.skills.length} skill:
${l.skills.map((k) => `- ${k.name}: ${k.description.slice(0, 220)}`).join("\n")}`;
  return indexSkill(`lib-${l.slug}`, `${l.description.slice(0, 240)} Thư viện ${names.length} skill: ${names.slice(0, 14).join(", ")}${names.length > 14 ? "…" : ""}. Khi yêu cầu liên quan, gọi load_skill("lib-${l.slug}") trước để chọn skill phù hợp.`, body);
}
// Thư viện cài từ danh mục skill của Claude: gom theo mục ngành nghề như thư mục của Claude, mỗi mục một dòng "cat-…" trong prompt
// (cả danh mục ~3.100 thư viện, liệt kê từng thư viện là hàng trăm nghìn token). Mở mục → danh sách thư viện của mục; mở thư viện → skill.
const CAT_BODY_MAX = 30_000;
function catIndex(key: string, label: string, ls: { slug: string; name: string; description: string; skills: Skill[] }[]): Skill {
  const n = ls.reduce((a, l) => a + l.skills.length, 0);
  const body = () => {
    const lines: string[] = [];
    let size = 0;
    for (const l of ls) {
      const line = l.skills.length <= 3 ? `- ${l.name}: ${l.description.slice(0, 140)} — skill: ${l.skills.map((k) => k.name).join(", ")}` : `- lib-${l.slug} (${l.name}, ${l.skills.length} skill): ${l.description.slice(0, 140)}`;
      if (size + line.length > CAT_BODY_MAX) { lines.push(`- … và ${ls.length - lines.length} thư viện nữa: gọi search_skills với từ khóa của việc cần làm để tìm trong cả mục.`); break; }
      lines.push(line); size += line.length;
    }
    return `<category name="${key}">
Mục ${label}: ${ls.length} thư viện, ${n} skill (danh mục skill của Claude). Chọn thư viện hoặc skill hợp nhất với yêu cầu: gọi load_skill("lib-…") để xem skill trong thư viện, hoặc load_skill với tên skill để đọc thẳng. Không thấy thứ phù hợp thì gọi search_skills.
</category>

${lines.join("\n")}`;
  };
  // Mô tả ngắn: cả 55 mục cùng nằm trong prompt (Claude cũng chỉ dành ~1% ngữ cảnh cho phần liệt kê skill).
  const top = ls.slice(0, 3).map((l) => l.name.slice(0, 24));
  return indexSkill(`cat-${key}`, `${label}: ${ls.length} thư viện, ${n} skill (${top.join(", ")}${ls.length > 3 ? "…" : ""})`, body);
}
const indexSkill = (name: string, description: string, body: string | (() => string)): Skill => {
  let b = typeof body === "string" ? body : null;
  return { id: name, user_id: "studio", name, description, get body() { return (b ??= (body as () => string)()); },
    storage_path: "", enabled: true, version: 1, versions: [1], created_at: "", updated_at: "", files: [], warnings: [], projects: [], use_count: 0, last_used_at: null, source: null };
};

// Bộ skill của một lượt: skill đã bật (dự án, mọi nơi), thư viện studio và plugin (mục lục, mở khi cần), gợi ý định tuyến theo yêu cầu mới nhất.
// Dùng chung cho model khóa API (vòng lặp công cụ) và gói subscription (cầu nối MCP).
async function skillSet(user: UserRow, body: Record<string, any>, messages: unknown, studio: Studio | null, st: ReturnType<typeof studioSkills> | null) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const c = { user };
  const { skills, project } = body;
  const list = skills && can(c.user, "skills") && skillsOn(c.user) ? [...await enabledSkills(c.user.id, project ? String(project) : null), ...everywhereSkills(c.user.id)] : [];
  // Chỉ chữ người dùng gõ: từ khóa nằm trong tệp đính kèm không được kéo theo skill và studio không liên quan.
  const typed = typedText((Array.isArray(messages) ? (messages as { role?: string; content?: unknown }[]) : []).filter((m) => m?.role === "user").pop());
  // Skill của studio luôn có khi người dùng chủ động bấm nút studio. Skill cá nhân trùng tên được ưu tiên.
  // Thư viện lớn: prompt chỉ có phần cố định; cả thư viện vẫn nằm trong list (ẩn) để load_skill và search_skills dùng được.
  const direct = st ? studioListed(st) : [];
  const names = new Set<string>();
  for (let i = 0; i < list.length; i++) { if (names.has(list[i].name)) list.splice(i--, 1); else names.add(list[i].name); }
  // Skill người dùng tự bật / dùng ở mọi nơi (kể cả skill tự xếp vào một studio): không bao giờ bị bộ lọc studio bên dưới bỏ khỏi gợi ý.
  const own = new Set(list.map((k) => k.name));
  for (const k of direct) if (!names.has(k.name)) { names.add(k.name); list.push(k); }
  // Mọi thư viện đã cài đều tự dùng được: mỗi studio là một mục "studio-…", mỗi plugin khác là một mục "lib-…" trong available_skills.
  // Model tự mở thư viện khi việc cần tới (load_skill), rồi chọn skill cụ thể bên trong. Prompt chỉ thêm một dòng mỗi thư viện,
  // các skill trong thư viện không chiếm chỗ cho tới khi được mở. Khi bấm nút studio, thư viện của studio đó đã mở sẵn.
  const visible = [...list];
  const hidden = (ks: Skill[]) => { for (const k of ks) if (!names.has(k.name)) { names.add(k.name); list.push(k); } };
  // Một skill có thể nằm trong nhiều thư viện (theme-factory ở cả Thiết kế và Trình bày): giữ đủ để gán đúng thư viện đã mở.
  const libs: Record<string, Lib[]> = {};
  // Skill của danh mục Claude: lớp dự phòng rộng; khi cùng hợp, skill người dùng tự cài / studio được ưu tiên trong gợi ý định tuyến.
  const catSkills = new Set<Skill>();
  const tag = (lib: Lib, ks: Skill[]) => { libs[lib.key] = [lib]; for (const k of ks) (libs[k.name] ??= []).push(lib); };
  if (studio) {
    tag({ key: `studio-${studio}`, label: STUDIO_LABEL[studio] }, st!.skills);
    // Thư viện đang bấm không có mục lục riêng trong prompt: mọi yêu cầu đều thuộc thư viện này nên mô tả "mở trước" sẽ khiến model đọc mục lục ở mọi lượt. Lối xem phần chưa liệt kê là search_skills (STUDIO_RULES).
    if (direct.length < st!.skills.length) hidden(st!.skills);
  }
  if (skills && can(c.user, "skills") && skillsOn(c.user)) {
    for (const s of STUDIOS) {
      const lib = s === studio ? null : studioSkills(c.user.id, s);
      if (!lib?.skills.length) continue;
      visible.push(studioIndex(s, lib.plugins, lib.skills, lib.curated));
      hidden(lib.skills);
      tag({ key: `studio-${s}`, label: STUDIO_LABEL[s] }, lib.skills);
    }
    const cats = new Map<string, { slug: string; name: string; description: string; skills: Skill[] }[]>();
    for (const l of libraryPlugins(c.user.id)) {
      const fresh = l.skills.filter((k) => !names.has(k.name));
      // Như thư mục của Claude, một thư viện nằm ở mọi mục của nó (mục chính trước), với đủ skill — kể cả skill Synchro đã xếp thêm
      // vào một studio (Tài liệu / Trình bày / Thiết kế).
      const lc = dirCats(l.catalogId);
      if (lc.length) {
        tag({ key: `lib-${l.slug}`, label: l.name }, l.skills);
        const idx = libIndex(l);
        // Mọi skill của danh mục đều tính nhẹ trong định tuyến, kể cả skill đã xếp vào một studio (nằm ngoài fresh): không để hàng trăm skill của danh mục chen trước thư viện chọn lọc.
        for (const k of [idx, ...l.skills]) catSkills.add(k);
        for (const cat of lc) { const g = cats.get(cat) ?? []; cats.set(cat, g); g.push(l); }
        hidden([idx]); hidden(fresh); continue;
      }
      if (!fresh.length) continue;
      tag({ key: `lib-${l.slug}`, label: l.name }, fresh);
      if (fresh.length <= 2) { visible.push(...fresh); hidden(fresh); continue; }
      visible.push(libIndex({ ...l, skills: fresh }));
      hidden(fresh);
    }
    const label = new Map(PLUGIN_CATS.map((x) => [x.key, x.label]));
    for (const [key, ls] of [...cats].sort((a, b) => b[1].length - a[1].length)) {
      const idx = catIndex(key, label.get(key) ?? key, ls);
      visible.push(idx); names.add(idx.name);
      libs[idx.name] = [{ key: idx.name, label: label.get(key) ?? key }];
    }
  }
  // Không có gì để liệt kê thì không có công cụ skill: giữ một mục để model vẫn tìm được trong thư viện đang bấm.
  if (studio && !visible.length && st!.skills.length) visible.push(studioIndex(studio, st!.plugins, st!.skills, st!.curated));
  // Định tuyến: chấm điểm toàn bộ kho skill theo yêu cầu mới nhất. Skill có ở nhiều thư viện được gán vào thư viện
  // mà các gợi ý khác cùng thuộc về (đề xuất dự án → Tài liệu, không phải Trình bày).
  let route = "";
  let ownSuggested = false;
  const prefer: Record<string, string> = {};
  if (list.length) {
    // Yêu cầu thuộc rõ một studio ("làm slide thuyết trình" → Trình bày): skill của studio đó được cộng thêm, skill của danh mục Claude
    // giảm bớt, để thư viện chọn lọc đứng trước hàng nghìn skill na ná của danh mục.
    const want = ruleStudios("", typed).scores;
    const inStudio = (k: Skill) => (libs[k.name] ?? []).some((l) => l.key.startsWith("studio-") && want[l.key.slice(7) as Studio] > 0);
    // D4: nhớ đệm tập ứng viên theo (người dùng, thế hệ bộ đệm plugin) để không dựng lại cả kho mỗi lượt; trọng số phụ thuộc câu hỏi nên áp lên trên.
    const prep = prepareCandidates(candidateKey(c.user.id, pluginCacheGen()), list.map((k) => ({ skill: k })), descHash);
    // Câu chỉ thuộc một studio ("Soạn kế hoạch ra mắt sản phẩm mới" → Tài liệu): skill chỉ nằm trong thư viện của studio khác không được gợi ý,
    // dù trùng chữ — "product" trong mô tả UI/UX Pro Max từng đưa skill Thiết kế lên đầu và model trả trang web thay cho tài liệu.
    // Chỉ bỏ khỏi gợi ý: thư viện studio kia vẫn có trong available_skills, model tự mở được (load_skill / search_skills).
    // Không lọc: skill riêng của người dùng (own), skill của studio đang bấm, skill của plugin khác và của danh mục Claude;
    // câu thuộc nhiều studio (hoặc không rõ) thì không lọc.
    const asked = STUDIOS.filter((k) => want[k] > 0);
    const offStudio = (k: Skill) => asked.length === 1 && !own.has(k.name) && !!libs[k.name]?.length
      && libs[k.name]!.every((l) => l.key.startsWith("studio-") && l.key !== `studio-${asked[0]}` && l.key !== `studio-${studio}`);
    const cands = prep.names.map((n) => prep.byName.get(n)!).filter((b) => !offStudio(b.skill)).map((b) => ({ skill: b.skill, weight: (catSkills.has(b.skill) ? 0.5 : 1) * (inStudio(b.skill) ? 1.3 : 1) }));
    // Có provider embedding: lấy ~50 skill gần nhất theo nghĩa rồi chấm lại; không có thì suggestSemantic tự lùi về bộ chấm từ khóa. Skill riêng (không thuộc danh mục) luôn được giữ.
    const keep = new Set(cands.filter((x) => !catSkills.has(x.skill)).map((x) => x.skill.name));
    const raw = await suggestSemantic(typed, cands, { keep, nearest: embeddingsConfigured() ? (q, _names, k) => nearestSkills(c.user.id, q, k) : undefined });
    // Có gợi ý từ skill riêng (không thuộc danh mục Claude): skillsPrompt bỏ mục lục ngành nghề cat-… cho lượt này.
    ownSuggested = raw.some((h) => !catSkills.has(h.skill));
    const votes = new Map<string, number>();
    for (const h of raw) for (const l of libs[h.skill.name] ?? []) votes.set(l.key, (votes.get(l.key) ?? 0) + h.score / (libs[h.skill.name]!.length));
    // Skill ở nhiều thư viện (Synchro tự xếp một skill vào 2–3 mục) mà phiếu ngang nhau: nghiêng về mục chính câu yêu cầu nói tới
    // ("làm slide thuyết trình" → Trình bày). Điểm nhỏ, chỉ để phân định khi gần bằng nhau.
    const intent = want;
    for (const k of STUDIOS) if (intent[k] > 0) votes.set(`studio-${k}`, (votes.get(`studio-${k}`) ?? 0) + intent[k] * 0.01);
    const pick = (n: string) => (libs[n] ?? []).slice().sort((a, b) => (votes.get(b.key) ?? 0) - (votes.get(a.key) ?? 0))[0];
    const hits = raw.map((h) => ({ ...h, lib: pick(h.skill.name) }));
    for (const h of hits) if (h.lib) prefer[h.skill.name] = h.lib.key;
    const recentNames = Array.isArray(body.recentSkills) ? [...new Set((body.recentSkills as unknown[]).filter((n): n is string => typeof n === "string"))].slice(0, 6) : [];
    const recent = recentNames.filter((n) => list.some((k) => k.name === n) && !hits.some((h) => h.skill.name === n)).map((n) => ({ name: n, lib: libs[n]?.[0] }));
    // Skill người dùng tự chọn ở menu + (tên skill, hoặc lib-… để mở cả thư viện): chỉ nhận tên có trong kho đang bật.
    const known = new Set([...list.map((k) => k.name), ...Object.values(libs).flat().map((l) => l.key)]);
    const picked = Array.isArray(body.pickedSkills) ? [...new Set((body.pickedSkills as unknown[]).filter((n): n is string => typeof n === "string" && known.has(n)))].slice(0, 8) : [];
    route = routingPrompt(hits, recent, picked, studio ? { lib: libs[`studio-${studio}`][0], skills: studioPicks(typed, st!) } : undefined);
  }
  return { list, visible, libs, prefer, route, ownSuggested };
}

type Who = { user: UserRow };
// Bộ não tổng hợp: kéo vài ghi chú liên quan nhất tới câu hỏi vào tầng động (chat lẫn Synchro Code; không trong đoạn chat ẩn danh / khi tắt Bộ nhớ).
// Câu chào, cảm ơn không có gì để nhớ lại. Đo riêng để biết phần chuẩn bị của lượt nằm ở đâu.
// Kết hợp từ khóa và nghĩa (embedding bằng khóa OpenAI / Gemini sẵn có), có ngân sách thời gian; không có khóa thì như trước, chỉ từ khóa.
const recallOf = async (body: Record<string, any>, u: UserRow, conv?: string) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!useProfile(body) || body.memory === false || body.incognito || routeTask(routeInput(body)) === "chat") return "";
  const t0 = Date.now();
  const out = await span("brain recall", "retrieval", () => brainRecallHybrid(u, lastUserText(body.messages), conv, { trace: (tr) => { if (tr.ms > 20 || tr.mode === "hybrid") console.log(`[timing] chat recall=${tr.ms}ms mode=${tr.mode}${tr.vecMs !== undefined ? ` vec=${tr.vecMs}ms` : ""}${tr.reranked ? ` rerank=${tr.reranked}` : ""} hits=${tr.ids.length}`); } })).catch(() => "");
  if (Date.now() - t0 > 20) console.log(`[timing] chat recall total=${Date.now() - t0}ms`);
  return out;
};
/** Lượt này đi đường nhanh được không: chat thường, không tệp, không skill tự chọn, không dự án hay hướng dẫn riêng, phiên của CLI chưa từng gọi công cụ, và câu hỏi rõ ràng không cần công cụ. */
async function fastTurn(body: Record<string, any>, user: UserRow, cli: NonNullable<ReturnType<typeof subCli>>, conv?: string): Promise<boolean> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (process.env.SYNCHRO_FAST_CHAT === "0" || body.noFast || !body.skills || body.feature === "code" || body.feature === "artifact" || body.project || body.studio || taskOf(body)) return false;
  if ((body.system && body.system !== DEFAULT_SYSTEM) || (Array.isArray(body.pinned) && body.pinned.length) || (Array.isArray(body.pickedSkills) && body.pickedSkills.length)) return false;
  return needsNoTools(routeInput(body)) && !mentionsConnector(user.id, body.messages) && !/\bref_[\w-]{6,}/.test(JSON.stringify(body.messages ?? "")) && sessionPlain(user.id, conv, cli) && !(await hasOwnSkill(user, body.messages));
}
// Đường nhanh không có mục lục skill: người dùng cài skill giọng văn thương hiệu mà "viết email xin nghỉ phép" vẫn đi đường nhanh thì model không biết có skill đó, skill bị bỏ qua đúng ở việc nó được viết ra. Chỉ xét skill người dùng tự bật, không xét kho danh mục dùng chung (kho lớn thì câu nào cũng khớp).
async function hasOwnSkill(user: UserRow, messages: unknown) {
  if (!can(user, "skills") || !skillsOn(user)) return false;
  const text = lastUserText(messages), own = [...await enabledSkills(user.id, null), ...everywhereSkills(user.id)];
  return !!text && ownSkillFits(text, own);
}
// Câu ngắn nhắc tên connector của chính người dùng ("Notion của mình có gì mới?") là việc cần connector, dù trông như câu hỏi nhỏ: đường nhanh không có công cụ, cũng không có nút kết nối lại khi connector mất đăng nhập.
function mentionsConnector(uid: string, messages: unknown) {
  const text = fold(lastUserText(messages));
  return !!text && listConnectors(uid).some((c) => { const n = fold(c.name); return n.length >= 3 && text.includes(n); });
}
// Lựa chọn của người dùng ở bộ chọn: model, nỗ lực, nút Bộ nhớ. Từng chỉ khởi động sẵn theo Tự động và bộ nhớ bật, nên ai chọn tay Sonnet, đổi nỗ lực hay tắt Bộ nhớ thì tiến trình đợi sẵn không bao giờ khớp (khóa của hồ gồm cả model, nỗ lực, hướng dẫn).
export type WarmPick = { model?: unknown; effort?: unknown; memory?: unknown };
const prewarmed = new Map<string, { at: number; sig: string; pick: WarmPick }>();
// Khởi động thật cách nhau ít nhất chừng này, dù lựa chọn có đổi: không có nó, đổi vòng 4 tổ hợp model, nỗ lực là mỗi lần một CLI mới, tiến trình cũ bị bỏ mà vẫn đang thoát nên không được tính vào mức của máy.
const WARM_GAP_MS = Number(process.env.SYNCHRO_WARM_GAP_MS) || 15_000;
const warmLater = new Set<string>();
const QUICK_ASKS = ["xin chào", "viết email xin nghỉ phép"];
/** Mở trang, quay lại tab, đổi model: khởi động sẵn tiến trình cho câu kế tiếp, đúng model, nỗ lực và hướng dẫn đường nhanh sẽ dùng. Mỗi lựa chọn tối đa một lần mỗi phút; không tốn lượt nào của gói. */
export async function prewarmChat(user: UserRow, o: WarmPick & { force?: boolean } = {}) {
  if (process.env.SYNCHRO_FAST_CHAT === "0") return;
  const now = Date.now(), had = prewarmed.get(user.id);
  // Lời gọi không nói gì (mở bộ chọn model, /api/models): giữ lựa chọn đã biết thay vì quay về Tự động.
  const pick: WarmPick = o.model === undefined && o.effort === undefined && o.memory === undefined ? had?.pick ?? {} : { model: o.model, effort: o.effort, memory: o.memory };
  const sig = JSON.stringify([pick.model, pick.effort, pick.memory]);
  if (!o.force && had?.sig === sig && now - had.at < 60_000) return;
  if (!o.force && had && now - had.at < WARM_GAP_MS) {
    // Vừa khởi động xong: ghi nhớ lựa chọn mới nhất, tới hẹn mới khởi động một lần cho nó, các lựa chọn ở giữa thì bỏ.
    prewarmed.set(user.id, { ...had, pick });
    if (!warmLater.has(user.id)) { warmLater.add(user.id); setTimeout(() => { warmLater.delete(user.id); void prewarmChat(user).catch(() => {}); }, had.at + WARM_GAP_MS - now).unref?.(); }
    return;
  }
  if (prewarmed.size > 2000) prewarmed.clear();
  prewarmed.set(user.id, { at: now, sig, pick });
  try { warmRecall(user.id); } catch {}
  const { usable } = await usableModels(user);
  const body = { skills: true, feature: "chat", memory: pick.memory === false ? false : undefined };
  const pc = capsState(user).caps;
  if (!pc) return;
  const system = [`${topRule(user.id)}\n\n${DEFAULT_SYSTEM}`, FAST_RULES, contextOf(body, user)].filter(Boolean).join("\n\n");
  const chosen = typeof pick.model === "string" && pick.model !== AUTO ? legacyModel(pick.model) : null;
  // Chọn tay model mà model đó chưa dùng được thì lượt thật cũng không chạy trên đó: không khởi động gì.
  if (chosen && !usable.includes(chosen)) return;
  // Hai kiểu câu mở đầu hay gặp nhất: câu chào, câu hỏi (nỗ lực thấp) và nhờ viết ngắn (nỗ lực vừa). Tiến trình gắn chặt với model và nỗ lực nên mỗi kiểu một tiến trình; cùng model và mức thì chỉ một.
  const seen = new Set<string>();
  for (const text of QUICK_ASKS) {
    const q: RouteInput = { text, attachments: 0, turns: 1, studio: false };
    const r = routeModel(q, usable);
    const model = chosen ?? r?.model;
    // Nỗ lực đúng như lượt thật sẽ tính: chọn tay thì giữ, "Tự động" thì theo câu; Tự động còn chọn cả model thì chưa chọn tay nỗ lực cũng theo câu.
    const effort = isEffort(pick.effort) ? pick.effort : chosen && pick.effort !== "auto" ? undefined : autoEffort(q);
    // Codex: app-server của tài khoản (G2.3) phục vụ mọi model và nỗ lực, một lần là đủ.
    if (!model || (subCli(model) !== "claude" && subCli(model) !== "codex") || seen.has(subCli(model) === "codex" ? "codex" : `${model}|${effort}`)) continue;
    seen.add(subCli(model) === "codex" ? "codex" : `${model}|${effort}`);
    prewarmClaude({ user, model, effort, system });
  }
}
/** Bộ nhớ vừa đổi thì hướng dẫn hệ thống đổi: tiến trình đợi sẵn không còn khớp với lượt sau. Khởi động lại đúng lựa chọn đã biết của người dùng. */
export const rewarmAfterMemory = (user: UserRow) => prewarmChat(user, { force: true });
/** Một lượt gọi model: body là JSON trình duyệt gửi lên /api/llm. scope.feature được đặt lại theo loại lượt (tính mức dùng).
 *  model = "auto": Synchro chọn model theo độ khó của yêu cầu (router.ts) trong các model tài khoản được dùng, rồi chạy như bình thường. */
export async function chatPost(body: Record<string, any>, c: Who, scope: { feature: string }): Promise<Response> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return scrubApplied(await chatPostTurn(body, c, scope));
}
/** Lọc đầu ra: model bắt chước dòng "_Đã áp dụng hướng dẫn của bạn: “…”_" kiểu cũ (trích lại hướng dẫn cá nhân) thì bỏ dòng đó khỏi câu trả lời cuối. */
async function scrubApplied(res: Response): Promise<Response> {
  const j = (await res.clone().json().catch(() => null)) as Record<string, unknown> | null;
  if (!j || typeof j.text !== "string") return res;
  const text = stripAppliedNotes(j.text);
  return text === j.text ? res : Response.json({ ...j, text }, { status: res.status });
}
async function chatPostTurn(body: Parameters<typeof chatPost>[0], c: Who, scope: { feature: string }): Promise<Response> {
  // Tệp của các lượt trước đi cùng lịch sử: model nào trả lời lượt này (kể cả model vừa đổi) cũng thấy đúng tài liệu đang bàn.
  if (Array.isArray(body.messages)) { const msgs = body.messages; body = { ...body, messages: await span("file refs", "history", () => expandFileRefs(msgs, lastUserText(msgs), c.user.id)) }; }
  // Hướng dẫn của dự án luôn có trong lời nhắc hệ thống, ở mọi đường đi của lượt (turnctx.withProjectIns): trình duyệt chỉ có bản rút gọn của dự án
  // thì lấy bản đã đồng bộ lên máy chủ. Làm trước khi chọn model và đường nhanh / đầy đủ, nên đường nào cũng có.
  if (body.project !== undefined && body.project !== null && useProfile(body) && body.feature !== "code") {
    const sys = withProjectIns(typeof body.system === "string" ? body.system : "", projectIns(c.user.id, body.project), { clientFull: body.pjFull === true, base: DEFAULT_SYSTEM });
    if (sys !== body.system) body = { ...body, system: sys };
  }
  // Tệp đính kèm bị từ chối (thẻ tệp báo lỗi ở khung soạn): khối <attachments_rejected> đứng đầu tin nhắn mới nhất và một dòng trong hướng dẫn hệ thống,
  // để model nói đúng tệp nào không đọc được và vì sao, không trả lời như thể tin nhắn không có tệp. Có khối thì không đi đường nhanh (hướng dẫn khác mặc định).
  const rej = Array.isArray(body.messages) ? rejectedBlock(body.rejected) : "";
  if (rej) body = { ...body, messages: withRejected(body.messages as unknown[], rej), system: `${body.system || DEFAULT_SYSTEM}\n\n${REJECTED_RULE}` };
  if (typeof body.resume === "string") return chatTurn(body, c, scope);
  if (body.model !== AUTO) return withSwitch(await chatTurn(body, c, scope), body, c.user, [String(body.model)]);
  // Chọn trong đúng các model bộ chọn model đang hiện: nhóm của hãng đang dùng gói subscription thì chọn model của gói,
  // không tự chuyển sang khóa API (tierOf xếp hạng được cả "sub-claude/opus", "sub-claude/haiku"…). Gói hết hạn mức thì không chọn.
  const r0 = Date.now();
  const all = await usableModels(c.user);
  const { groups } = all;
  // plansOnly: hết hạn mức chi phí API (usage.ts overLimit) mà đang để Tự động: hạ xuống gói subscription đã kết nối thay vì khóa chat.
  const plansOnly = typeof body.plansOnly === "string" ? body.plansOnly : "";
  const allowed = plansOnly ? all.allowed.filter((k) => !!subCli(k)) : all.allowed, usable = plansOnly ? all.usable.filter((k) => !!subCli(k)) : all.usable;
  if (plansOnly && !usable.length) return Response.json({ error: plansOnly, usageLimit: true }, { status: 429 });
  const blocked = new Set(allowed.filter((k) => !usable.includes(k)));
  // Tên model như ở bộ chọn model ("Claude Sonnet 4.5"), không phải mã thô ("claude-sonnet-4-5-20250929").
  const shown = (k: string) => groups.flatMap((g) => g.models).find((m) => m.key === k)?.name ?? k.split("/").pop();
  const q = routeInput(body);
  // avoidModel: người dùng bấm "Chạy lại bằng model khác" dưới câu trả lời của chế độ Tự động: vẫn Tự động, chỉ tránh model vừa trả lời.
  const pool = usable.length ? usable : allowed;
  const skip = typeof body.avoidModel === "string" && pool.includes(body.avoidModel) ? [body.avoidModel] : [];
  // Nhật ký định tuyến (D1.6) chỉ ghi ở đây — lượt chat thật; rerun khi người dùng bấm "Chạy lại bằng model khác".
  const r = routeModel(q, pool, { avoid: [...skip, ...stalledModels(c.user.id, pool)], log: { rerun: typeof body.avoidModel === "string" && !!body.avoidModel } });
  addSpan("routing", "routing", r0, Date.now(), r ? { "synchro.route.model": r.model, "synchro.route.task": r.task } : undefined);
  if (!r) return Response.json({ error: "Tài khoản của bạn chưa được dùng model nào. Hãy liên hệ quản trị viên." }, { status: 403 });
  // Nỗ lực: người dùng để "Tự động" (hoặc chưa chọn) thì theo độ khó của việc; chọn tay thì giữ lựa chọn đó.
  const effort = body.effort === "auto" || !isEffort(body.effort) ? r.effort : body.effort;
  if (plansOnly) progress("note", PLANS_ONLY_NOTE);
  progress("note", `Tự động chọn ${shown(r.model)} · việc ${taskLabel(r.task)} · nỗ lực ${effortLabel(effort)}`);
  const fromSub = !!subCli(r.model);
  // Còn model của CLI khác để chuyển thì không chờ lâu khi tài khoản đang chạy lượt Antigravity / Grok khác; không còn thì chờ như chọn tay.
  const auto = r.alt.some((k) => !blocked.has(k) && !!subCli(k) && subCli(k) !== subCli(r.model));
  let res = await chatTurn({ ...body, model: r.model, effort }, c, scope, { auto });
  let used = r.model;
  const tried = [r.model];
  // Model lỗi / quá tải / hết hạn mức / cần đăng nhập lại / treo: thử lần lượt các model dự phòng (ưu tiên hãng khác) mà người dùng không phải
  // làm gì. Gói subscription chỉ chuyển sang gói khác, không tự sang khóa API (luôn hỏi người dùng trước khi dùng khóa API).
  // Không bao giờ chạy lại khi lượt đã làm việc không đọc được kết quả (gửi thư, chạy code…): trả phần đã có để người dùng quyết.
  const out = new Set<string>();
  // Lý do đã chuyển model (để báo lại cho người dùng sau khi lượt xong, không chỉ trong dòng tiến trình lúc chạy).
  let switchedWhy = "";
  // Model đầu hết hạn mức gói: hạn mức nào và bao giờ hồi (H1.2), nối sau câu "đã trả lời bằng …".
  let resetNote = "";
  while ([409, 429, 500, 502, 503, 504, 529].includes(res.status) && !turnSignal()?.aborted && tried.length < 5) {
    const j0 = (await res.clone().json().catch(() => ({}))) as { usageLimit?: boolean; partialWork?: boolean; quota?: string; planLimit?: string; rate?: boolean; stalled?: boolean; busy?: boolean; resetsAt?: number | null };
    // Treo, lỗi phía hãng: nhớ vài phút. Mỗi tin nhắn tiếp theo từng chọn lại đúng model đang treo, chờ thêm 60-90 giây rồi mới chuyển.
    if ((j0.stalled || res.status === 504 || res.status >= 500) && !j0.busy && !j0.usageLimit && subCli(used)) noteStall(c.user.id, subCli(used)!);
    if (j0.usageLimit || j0.partialWork) break;
    // Hết hạn mức riêng của một model thì các model khác cùng gói vẫn thử được; lỗi khác (đăng nhập, treo, hết cả gói) thì bỏ cả CLI đó trong lượt này.
    if (j0.quota !== "model" && subCli(used)) out.add(subCli(used)!);
    const fresh = new Set((await usableModels(c.user).catch(() => ({ usable: [] as string[] }))).usable);
    const next = r.alt.find((k) => !tried.includes(k) && fresh.has(k) && (!fromSub || !!subCli(k)) && (!plansOnly || !!subCli(k)) && !out.has(subCli(k) ?? ""));
    if (!next) break;
    const why = j0.quota || j0.planLimit ? "đã hết hạn mức" : j0.rate ? "đang giới hạn tốc độ" : res.status === 409 ? "cần đăng nhập lại" : j0.busy ? "đang chạy lượt khác" : j0.stalled || res.status === 504 ? "không phản hồi" : "đang gặp lỗi";
    progress("note", `${shown(used)} ${why}, chuyển sang ${shown(next)}`);
    if (!switchedWhy) {
      switchedWhy = `${shown(used)} ${why}`;
      const cli = subCli(used);
      if ((j0.quota || j0.planLimit) && cli && Number(j0.resetsAt) > Date.now()) resetNote = planResetMsg(j0.quota === "model" ? "model" : "plan", j0.quota === "model" ? shown(used) ?? used : SUB[cli].name, Number(j0.resetsAt));
    }
    deltaStep();
    used = next; tried.push(next);
    res = await chatTurn({ ...body, model: next, effort }, c, scope, { auto: true });
  }
  if (res.status === 200 && subCli(used)) clearStall(c.user.id, subCli(used)!);
  const j = await (await withSwitch(res, body, c.user, tried)).json().catch(() => ({}));
  // Hết hạn mức ở mọi gói đã kết nối: nói thẳng là hết cả và lúc sớm nhất có lại (thẻ lỗi hiện giờ theo múi giờ của người dùng), đừng để người dùng tưởng đổi gói khác là được.
  if (res.status === 429 && (j.planLimit || j.quota)) {
    const now = await usableModels(c.user).catch(() => null);
    if (now && !now.usable.length && now.plansOut.count > 1) { j.error = "Các gói đã kết nối đều đã hết hạn mức."; if (now.plansOut.resets) j.resetsAt = now.plansOut.resets; delete j.switchTo; }
  }
  // Tự động đã chuyển model trong lượt này: nói rõ ở câu trả lời (switched) và một lần trên thanh thông báo (notice).
  const switched = res.status === 200 && used !== r.model && switchedWhy ? `${switchedWhy}, nên Synchro đã trả lời bằng ${shown(used)}.${resetNote ? ` ${resetNote}` : ""}` : "";
  // Tự động chọn model chạy bằng khóa API chung trong khi tài khoản đã kết nối gói (kể cả gói đang tạm hết hạn mức): một dòng nói lượt này tính vào hạn mức chi phí API (H1 bổ sung).
  const keyNote = res.status === 200 && !subCli(used) && allowed.some((k) => !!subCli(k)) ? sharedKeyMsg(shown(used) ?? used) : "";
  return Response.json({ ...j, model: j.model ?? used, ...(switched ? { switched, ...(j.notice ? {} : { notice: switched }) } : {}), ...(keyNote ? { keyNote, ...(j.notice || switched ? {} : { notice: keyNote }) } : {}), ...(plansOnly && res.status === 200 && !j.notice && !switched ? { notice: PLANS_ONLY_NOTE } : {}), ...(res.status !== 200 && tried.length > 1 ? { tried: tried.map(shown) } : {}), auto: { tier: r.tier, vendor: r.vendor, task: r.task, effort, why: r.why, ...(used !== r.model ? { fallback: used } : {}) } }, { status: res.status });
}
const PLANS_ONLY_NOTE = "Đã hết hạn mức API của bạn trên Synchro, nên Tự động đang dùng gói đã kết nối (Claude, ChatGPT, Gemini, Grok) thay vì khóa chat.";
// Lỗi của gói mà còn model của gói khác dùng được: gợi ý sẵn để người dùng đổi bằng một lần bấm (máy chủ thật không có khóa API để đề nghị thay).
async function withSwitch(res: Response, body: Record<string, any>, user: UserRow, tried: string[]): Promise<Response> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (![409, 429, 500, 502, 503, 504, 529].includes(res.status) || !body.skills || body.feature === "artifact") return res;
  const j = (await res.clone().json().catch(() => null)) as { usageLimit?: boolean; quota?: string; partialWork?: boolean } | null;
  if (!j || j.usageLimit) return res;
  const { usable, groups } = await usableModels(user).catch(() => ({ usable: [] as string[], groups: [] as { models: { key: string; name: string }[] }[] }));
  const cli = subCli(tried[tried.length - 1]);
  // Gói subscription: chỉ gợi ý gói khác (không tự đưa sang khóa API). Model chạy bằng khóa API mà người dùng chọn tay: gợi ý model của hãng khác
  // đang dùng được, để thẻ lỗi có nút "Dùng model khác" thay vì tự đổi sau lưng người dùng.
  const vendor = (k: string) => k.split("/")[0];
  const list = cli
    ? usable.filter((k) => !tried.includes(k) && !!subCli(k) && (j.quota === "model" || subCli(k) !== cli))
    : usable.filter((k) => !tried.includes(k) && !subCli(k) && vendor(k) !== vendor(tried[tried.length - 1]));
  const next = routeModel(routeInput(body), list);
  if (!next) return res;
  return Response.json({ ...j, switchTo: { model: next.model, name: groups.flatMap((g) => g.models).find((m) => m.key === next.model)?.name ?? next.model.split("/").pop() } }, { status: res.status });
}
// Thông tin của yêu cầu mới nhất cho bộ định tuyến (router.inputOfChat).
function routeInput(body: Record<string, any>): RouteInput { // eslint-disable-line @typescript-eslint/no-explicit-any
  return inputOfChat(body.messages, { studio: !!studioOf(body.studio), prev: typeof body.prevModel === "string" ? body.prevModel : null });
}

/** o.auto: chế độ Tự động còn model khác để chuyển: không chờ lâu khi tài khoản đang bận lượt khác. */
async function chatTurn(body: Record<string, any>, c: Who, scope: { feature: string }, o: { auto?: boolean } = {}): Promise<Response> { // eslint-disable-line @typescript-eslint/no-explicit-any
  // feature: "chat" | "code"; picked: khóa model đang chọn ("openai/gpt-5.1"); project: id dự án (để bật skill theo dự án)
  // Tiếp tục lượt chat đang chờ duyệt công cụ: { resume, decisions: { id lượt gọi: "allow" | "always" | "deny" } }.
  if (typeof body.resume === "string") {
    sweep();
    const p = pending.get(body.resume);
    if (!p || p.uid !== c.user.id) return Response.json({ error: "Yêu cầu chờ duyệt đã hết hạn. Hãy gửi lại tin nhắn." }, { status: 410 });
    unparkApproval(body.resume);
    const raw = (body.decisions && typeof body.decisions === "object" ? body.decisions : {}) as Record<string, unknown>;
    // inputs: tham số người dùng sửa trên thẻ duyệt, theo id lời gọi; kiểm tra lại theo schema, sai thì lời gọi đó không chạy.
    const edits = (body.inputs && typeof body.inputs === "object" && !Array.isArray(body.inputs) ? body.inputs : {}) as Record<string, unknown>;
    const d: Record<string, Decision> = {};
    for (const call of p.calls) if (needsAsk(p.x, call)) {
      const v = raw[call.id];
      d[call.id] = v === "allow" || v === "chat" || v === "always" ? v : "deny";
      const e = edits[call.id];
      if (d[call.id] !== "deny" && e !== undefined) {
        const ct = p.x.sess!.get(call.name)!;
        const bad = !e || typeof e !== "object" || Array.isArray(e) || JSON.stringify(e).length > 100_000 ? ["Tham số phải là một đối tượng JSON."] : validateArgs(ct.tool.inputSchema ?? {}, e);
        if (bad.length) { d[call.id] = "deny"; (p.x.denied ??= new Map()).set(call.id, `Tham số người dùng sửa không hợp lệ nên công cụ chưa chạy (${bad.slice(0, 3).join("; ")}). Báo người dùng.`); continue; }
        applyEdit(p.x, call, e as Record<string, unknown>);
      }
      if (v === "always") p.x.sess!.allowAlways(call.name, call.input);
      if (v === "chat") p.x.sess!.allowChat(call.name, call.input);
    }
    try {
      await execute(p.ad, p.m, p.x, p.calls, p.used, d);
      return reply(c, p.model, await toolLoop(p.ad, p.m, p.x, p.used, c.user.id, p.model, p.step + 1), p.x);
    } catch (e) {
      p.x.sess?.close();
      if (e instanceof HttpErr) return Response.json({ error: e.message }, { status: e.status >= 500 ? 502 : e.status });
      return Response.json({ error: String((e as Error).message ?? e) }, { status: 502 });
    }
  }
  const { messages, max_tokens = 1500, skills, model: picked, feature, project, effort: wanted, conv } = body;
  // Quy tắc hàng đầu (ghim trong bộ não) mở đầu lời nhắc hệ thống của mọi lượt người dùng trò chuyện: chat, Synchro Code, việc tự động,
  // giọng nói nối tiếp; gói subscription lẫn khóa API. Lời gọi nội bộ (đặt tên, rút bộ nhớ…) và artifact không kèm.
  const system: string = useProfile(body) ? `${topRule(c.user.id)}\n\n${body.system || DEFAULT_SYSTEM}` : body.system;
  scope.feature = feature === "artifact" ? "artifact" : feature === "code" ? "code" : skills ? "chat" : "internal";
  if (feature === "code" && !can(c.user, "code")) return Response.json({ error: "Quản trị viên chưa cho phép tài khoản của bạn dùng Synchro Code." }, { status: 403 });
  const model = (typeof picked === "string" && picked ? legacyModel(picked) : null) || pickDefault(await catalog(), mainModels());
  if (model && skills) noteModel(model);
  // Model của gói subscription (Cài đặt → Providers): chạy CLI chính chủ bằng gói của chính người dùng, không qua khóa API.
  if (model && subCli(model)) {
    if (feature === "artifact" && !capsState(c.user).caps.ai) return Response.json({ error: "Artifact dùng AI đang tắt. Bật trong Cài đặt → Khả năng." }, { status: 403 });
    if (body.estimate === true) return estimate([system], [], [contextOf(body, c.user), pinnedBlock(body.pinned)].filter(Boolean).join("\n\n"), prepareHistory(messages, [], {}));
    const am = feature === "artifact" ? artifactMessages(body.prompt) : null;
    if (feature === "artifact" && !am) return Response.json({ error: "Nội dung gửi tới model không hợp lệ." }, { status: 400 });
    // Hướng dẫn thuần văn bản theo Cài đặt → Khả năng (hỏi lại, artifact, hình minh họa trong chat).
    const pc = skills ? capsState(c.user).caps : null;
    const fast = !!pc && !am && await fastTurn(body, c.user, subCli(model)!, typeof conv === "string" && conv.length <= 64 ? conv : undefined);
    const planSys = fast ? FAST_RULES : pc ? [QUALITY_RULES, feature !== "code" ? ASK_RULES : "", pc.art ? ARTIFACT_RULES(pc.ai) : "", pc.inl ? VIZ_RULES : ""].filter(Boolean).join("\n\n") : "";
    // Công cụ của Synchro cho gói (Claude Code, Codex, Antigravity): skill, thư viện plugin, connector, chạy code, dữ liệu đã lưu, danh sách việc —
    // CLI gọi qua cầu nối MCP nội bộ, mở riêng cho lượt này và đóng khi xong.
    const cli = subCli(model)!;
    const convId = typeof conv === "string" && conv.length <= 64 ? conv : undefined;
    let bridge: { url: string; close: () => void; alive: () => number; park: () => void; onPark: (f: () => void) => void; pendingJobs: () => { id: string; name: string }[]; live?: { url: string; key: string } } | null = null, x: Exec | null = null, sess: ConnectorSession | null = null, toolSys = "", route = "";
    const usedAll: ToolRun["used"][] = [];
    let bridged = 0;
    const webs = new Map<string, { title: string; url: string }>();
    // Ảnh Antigravity tự tạo ở lượt đường nhanh (chưa có Exec).
    const natOuts: OutFile[] = [];
    // Trình duyệt chỉ gửi 60 tin gần nhất: số tin đã cắt bớt, để so nối tiếp phiên CLI với số tin thật.
    const cut = typeof body.histTotal === "number" && Array.isArray(messages) && body.histTotal > messages.length ? body.histTotal - messages.length : 0;
    try {
      if (pc && !am && !fast && BRIDGE_CLIS.has(cli)) {
        const studio = can(c.user, "skills") ? studioOf(body.studio) : null;
        const st = studio ? studioSkills(c.user.id, studio) : null;
        const ss = await span("skills", "retrieval", () => skillSet(c.user, body, messages, studio, st));
        route = ss.route;
        markPrompt();
        if (can(c.user, "connectors")) { sess = new ConnectorSession(c.user.id, { conv: convId, project: !!project, pol: connPolicy(permsOf(c.user)) }); if (!sess.tools.length && !sess.offline.length) sess = null; }
        const code = pc.code;
        const refs = !!sess || code || /\bref_[\w-]{6,}/.test(JSON.stringify(messages));
        // Công cụ và hướng dẫn trình duyệt luôn có khi tính năng bật (phần đầu prompt ổn định, đọc lại từ bộ đệm).
        const browse = !!pc.browse && feature !== "artifact";
        const bst = capsState(c.user);
        const task = taskOf(body);
        // Đọc lại / tự kiểm tra artifact (Artifacts bật): kiểm tra hiển thị cần Chromium của workspace.
        const arts = !!pc.art, check = arts && runner() === "workspace";
        // Tạo ảnh: lượt chat thường của mọi model, gói nào đăng nhập thì công cụ tự chọn (Synchro Code có cách làm việc riêng).
        const image = feature !== "code";
        const pdocs = feature !== "code" && !!project && projectDocsLong(c.user.id, project);
        const tools = [...(pdocs ? [PROJECT_DOC_TOOL] : []), ...(task ? [TASK_TOOL] : []), ...(code ? [runCodeTool(pc.net, !!pc.web)] : []), ...(arts ? [READ_ARTIFACT_TOOL] : []), ...(check ? [CHECK_ARTIFACT_TOOL] : []), ...(ss.visible.length ? skillTools(ss.visible.length, code) : []), ...(sess ? connTools(sess, cli === "agy") : []), ...(refs ? [READ_REF_TOOL] : []), ...(brainOn(body, c.user) ? BRAIN_TOOLS : []), ...(browse ? BROWSER_TOOLS : []), ...(image ? [imageTool()] : []), PLAN_TOOL];
        const xx: Exec = { project: pdocs ? project : undefined, image, msgs: messages, toolSync: subCli(model) === "claude", list: [...ss.visible, ...ss.list.filter((k) => !ss.visible.includes(k))], scripts: code, sess, uid: c.user.id, code, net: pc.net, web: !!pc.web, art: arts ? { messages, base: body.artBase } : undefined, outs: [], libs: ss.libs, studio: studio ? ss.libs[`studio-${studio}`][0] : undefined, prefer: ss.prefer, trace: [], conv: convId, untrusted: convUntrusted(c.user.id, convId), browse, task, bctx: browse ? { def: task ? taskBrowser(task) : browserDefault(bst), synchro: !bst.locks.browse, user: bst.locks.mine !== "admin", scope: convId ? `chat:${convId}` : undefined, cookies: codePrefs(c.user.id).cookies, files: chatFiles(messages, c.user.id, () => xx.outs) } : undefined };
        x = xx;
        announceOffline(xx, messages);
        const trc = currentTrace();
        // conv: địa chỉ sống theo cuộc trò chuyện (G2.2) cho tiến trình dựng sẵn / thread đã nạp; đoạn chat ẩn danh không giữ gì qua lượt.
        bridge = openBridge({ uid: c.user.id, conv: body.incognito === true ? undefined : convId, tools: tools as { name: string; description: string; input_schema: unknown }[], ...(cli === "agy" ? { hold: BRIDGE_HOLD.agy } : {}), call: (name, input, cancel) => { bridged++; return spanOn(trc, `tool ${name}`, "tool", () => bridgeCall(xx, name, input, usedAll, cancel), { "tool.name": name }); }, route: sess && connProxy(sess) ? (name, input) => { const ct = resolveTool(sess!.tools, name); return ct ? { name: CONN_CALL, input: { tool: ct.fq, input } } : null; } : undefined });
        xx.park = bridge.park;
        toolSys = [studio ? STUDIO_RULES(studio, st!.plugins, st!.skills.length) : "", code ? CODE_RULES(pc.net, !!pc.web) : "", image ? IMAGE_RULES : "", pdocs ? PROJECT_DOC_RULES : "", arts ? ARTCHECK_RULES(check) : "", skillsPrompt(ss.visible, code, ss.ownSuggested), sess ? connectorsPrompt(sess, connProxy(sess)) : "", CLI_TOOLS_NOTE(cli, body.web === true, image), NARRATE_RULES, brainOn(body, c.user) ? BRAIN_RULES : "", browse ? BROWSER_RULES : "", task ? taskRules(task, browse) : ""].filter(Boolean).join("\n\n");
      }
      // Gợi ý định tuyến skill đổi theo từng tin nhắn: đặt cạnh tin nhắn mới nhất, không trong hướng dẫn hệ thống. Hướng dẫn hệ thống giữ
      // nguyên từng chữ giữa các lượt và các đoạn chat thì model đọc lại từ bộ nhớ đệm (~15.000 token): câu đầu của đoạn chat mới từng
      // chờ hơn 10 giây chỉ để đọc lại phần này.
      markPrompt();
      const say0 = am ? undefined : fast ? holdNeedTools(live()) : live();
      // Antigravity trả cả câu trả lời một lần nên làm sạch được ngay; CLI khác làm sạch ở câu trả lời cuối (đường dẫn có thể bị cắt giữa hai đoạn chữ).
      const say = say0 && cli === "agy" ? (t: string) => say0(scrubServerPaths(t)) : say0;
      const turnMsgs = am ?? withRecall(withRecall(messages, await recallOf(body, c.user, convId)), [route, fast || !pc ? "" : designOf(body, { art: !!pc.art, code: !!pc.code, image: BRIDGE_CLIS.has(subCli(model)!) && feature !== "code" }, can(c.user, "skills") ? studioOf(body.studio) : null, convId), nowBlock(body), crisisBlock(body)].filter(Boolean).join("\n\n"));
      // cont: lượt làm tiếp trong cùng tin nhắn (nhắc làm tiếp, chờ kết quả công cụ): ghi "job:cont", không đếm thành tin nhắn mới (helperquota.ts CONT_JOB).
      let cont = false;
      const turn = (msgs: unknown, fresh = false) => subTurn({
        job: cont ? CONT_JOB : undefined,
        user: c.user, model, system: am ? ARTIFACT_SYSTEM : [system || (planSys || toolSys ? "Bạn là một trợ lý AI hữu ích." : ""), planSys, toolSys, contextOf(body, c.user), pinnedBlock(body.pinned)].filter(Boolean).join("\n\n"),
        ephemeral: body.incognito === true, messages: msgs, conv: am ? undefined : convId, effort: isEffort(wanted) ? wanted : wanted === "auto" ? autoEffort(routeInput(body)) : undefined, signal: turnSignal(), onDelta: say, onToolUse: am ? undefined : toolUseSeen,
        older: typeof body.olderDigest === "string" ? body.olderDigest.slice(0, 8000) : undefined, fast, awaitingUser: () => !!x?.awaiting, mcp: bridge ? { url: bridge.url, alive: bridge.alive, onPark: bridge.onPark, live: bridge.live } : undefined, web: !fast && body.web === true, fresh,
        total: Array.isArray(msgs) ? msgs.length + cut : undefined, lockMs: o.auto ? 10_000 : undefined,
        onStatus: am ? undefined : (t) => { progress("step", t); },
        onNativeImages: am ? undefined : (files) => { keepImages(c.user.id, files, x?.outs ?? natOuts); },
        // Tìm web bằng công cụ dựng sẵn của CLI: hiện trong nhật ký làm việc như công cụ khác, nguồn gửi kèm kết quả.
        onSearch: am ? undefined : (q) => { const seq = progress("tool", q.url ? `Đang đọc trang ${q.url.slice(0, 120)}` : q.query ? `Đang tìm trên web: ${q.query.slice(0, 120)}` : "Đang tìm trên web"); if (seq) progress("res", JSON.stringify({ ref: seq, ok: true })); },
        // Connect Link của Composio không phải nguồn: không vào hàng chip "Nguồn" dù CLI báo nó là link trong câu trả lời.
        onSources: am ? undefined : (items) => { for (const s of items) if (webs.size < 12 && !webs.has(s.url) && notConnectLink(s.url)) webs.set(s.url, s); },
        // Codex có update_plan dựng sẵn bên cạnh update_plan của Synchro: model dùng cái nào thì danh sách việc trong khung chat cũng cập nhật (lỗi 8 của ma trận H1:
        // "Tasks 0/3" đứng yên tới cuối lượt dù model đã xong bước 1). Một danh sách mỗi lượt: notePlan (tools.ts) ưu tiên danh sách của Synchro.
        onPlan: am ? undefined : (items) => { const shown = notePlan(x, "native", items); if (shown) progress("plan", JSON.stringify(shown)); },
      });
      // Bấm Dừng: CLI trả về mọi chữ đã viết trong lượt, kể cả các câu dẫn đã nằm trong nhật ký làm việc (ghép lại thành một đoạn dài
      // không dấu cách, trông như câu trả lời cụt rồi dừng). Câu trả lời chỉ giữ phần của bước đang viết dở, như lượt chạy bằng khóa API.
      const once = async (msgs: unknown, fresh = false) => {
        markProviderCall();
        const r = await turn(msgs, fresh);
        return r.status === 200 && (r.json as { cancelled?: boolean }).cancelled ? { ...r, json: { ...(r.json as Record<string, unknown>), text: liveNow() } } : r;
      };
      // Lỗi tạm thời của CLI (không phải đăng nhập, hạn mức, quá giờ hay người dùng bấm Dừng) khi chưa kịp dùng công cụ nào: thử lại một
      // lần ở phiên mới kèm toàn bộ lịch sử (nối tiếp phiên ngay sau lượt trước có lúc hỏng) — tin nhắn nào cũng phải chạy được.
      const pause = (ms: number) => new Promise<void>((ok) => { const sig = turnSignal(), t = setTimeout(ok, ms); sig?.addEventListener("abort", () => { clearTimeout(t); ok(); }, { once: true }); });
      const tryOnce = async (msgs: unknown) => {
        const before = bridged;
        let res = await once(msgs);
        if (bridged !== before || turnSignal()?.aborted) return res;
        const j = res.json as { rate?: boolean; retryAfterMs?: number | null; noRetry?: boolean };
        // Giới hạn tốc độ: chờ đúng thời gian hãng bảo rồi thử lại một lần. Chờ lâu quá (hoặc Tự động còn model khác) thì trả về luôn.
        if (j.rate) {
          const wait = j.retryAfterMs ?? 5000;
          if (wait > (o.auto ? 8000 : 30_000)) return res;
          progress("step", `Đang chờ ${Math.ceil(wait / 1000)} giây rồi thử lại`);
          await pause(wait);
          if (turnSignal()?.aborted) return res;
          deltaStep();
          return once(msgs);
        }
        // Lượt treo, hoặc đang bận lượt khác: thử lại chỉ khiến người dùng chờ thêm chừng ấy.
        if (res.status >= 500 && res.status !== 504 && !j.noRetry) {
          // Đường nhanh lỗi: lượt đầy đủ bên dưới tự thử lại, không thử thêm ở đây.
          if (fast) return res;
          await pause(1500);
          if (turnSignal()?.aborted) return res;
          // Chữ của lần thử trước (nếu có) không nối vào chữ của lần này.
          deltaStep();
          res = await once(msgs, true);
        }
        return res;
      };
      type J = { text?: unknown; denied?: string[]; error?: unknown; cancelled?: boolean };
      let hist = turnMsgs as unknown[];
      let r = await tryOnce(hist);
      // Đường nhanh không đủ: model báo cần công cụ, hoặc CLI lỗi (kể cả phiên cũ không nhận lượt không công cụ). Chưa có chữ nào tới người dùng: chạy lượt đầy đủ.
      const needFull = () => fast && !turnSignal()?.aborted && ((r.status === 200 && String((r.json as J).text ?? "").trim().startsWith(NEED_TOOLS)) || (r.status >= 500 && r.status !== 504 && !(r.json as { noRetry?: boolean }).noRetry));
      if (needFull()) { deltaStep(); return chatTurn({ ...body, noFast: true }, c, scope, o); }
      // good: câu trả lời tốt gần nhất — lượt nhắc / tin nhắn thêm sau đó có lỗi thì vẫn giữ phần đã trả lời.
      let good: typeof r | null = null;
      // Lượt của CLI xong mà còn tin nhắn thêm chưa đọc: làm tiếp ngay trong cùng phiên của CLI (không chờ lượt sau). Gói mới báo
      // "Mình sẽ…" mà chưa gọi công cụ nào của Synchro: nhắc làm tiếp (stall.ts). agy tự chặn công cụ: nhắc dùng công cụ được phép.
      let gate: string | null = null;
      // Bản sửa artifact còn khối không khớp khi CLI định trả lời xong: nhắc gửi lại đúng các khối đó (một lần), rồi
      // ghép vào câu trả lời. healing: câu trả lời đang chờ ghép; câu đó vẫn là câu người dùng nhận.
      let priorSt: ArtState | undefined;
      const art = x?.art, prior = art ? () => (priorSt ??= priorArts(art.messages, cleanBase(art.base))) : null;
      let healing: string | null = null, healAsked = false;
      for (let k = 0, nudged = 0, nd = 0; k < 6 && !am && r.status === 200; k++) {
        good = r;
        const j = r.json as J;
        // Người dùng đã dừng: không nhắc làm tiếp, không ghép tin nhắn thêm (tin đó được gửi thành lượt mới).
        if (j.cancelled) break;
        const said = String(j.text ?? "");
        const more = takeInbox();
        let next: string;
        if (more.length) { for (const t of more) progress("steer", t); next = `<user_followup>\n${more.join("\n\n")}\n</user_followup>`; }
        else if (j.denied?.length && nd < MAX_NUDGE) { nd++; next = DENIED_NUDGE(j.denied); }
        else if (bridge?.pendingJobs().length) next = `Còn công cụ chưa lấy kết quả (${bridge.pendingJobs().map((p) => `${p.name}: job_id ${p.id}`).join("; ")}). Gọi wait_for_result với từng job_id tới khi có kết quả thật rồi mới trả lời tiếp; đừng báo thất bại khi chưa có kết quả.`;
        else if (bridge && !bridged && nudged < MAX_NUDGE && stalled(said)) { nudged++; next = NUDGE; }
        // Bộ slide trong câu trả lời: Synchro tự kiểm bản cuối (tràn khung 1280×720, đánh số lệch), có lỗi thì CLI sửa trước khi giao (một lần mỗi lượt).
        // Câu trả lời đã viết được giữ cho người dùng (không đưa vào nhật ký); cuối lượt gộp phần sửa vào đó (settleGate).
        else if (x && prior && !x.held && !healAsked && (gate = patchHealAsk(prior, x, said))) {
          healAsked = true;
          healing = said;
          next = gate;
        }
        else if (x && !x.deckGated && (gate = await deckGate(x, said))) { holdAnswer(x, said); next = gate; }
        else break;
        if (healing === null && x?.held?.text !== said) sayOut(x, said);
        hist = [...hist, { role: "assistant", content: said }, { role: "user", content: next }];
        // Tin người dùng nhắn thêm là lượt của họ; nhắc làm tiếp / chờ kết quả công cụ thì không.
        cont = !more.length;
        r = await tryOnce(hist);
        if (healing !== null && prior && r.status === 200) {
          const j = r.json as J;
          const text = j.cancelled ? healing : patchHealMerge(prior, x, healing, String(j.text ?? ""));
          r = { ...r, json: { ...(r.json as Record<string, unknown>), text } };
        }
        healing = null;
        // Tin nhắn thêm trong lúc đi đường nhanh mà cần công cụ: chạy lượt đầy đủ với cả tin nhắn đó.
        if (needFull()) { deltaStep(); return chatTurn({ ...body, messages: hist, noFast: true }, c, scope, o); }
      }
      if (r.status !== 200 && good && r.status !== 499) {
        // Lượt sửa theo lời nhắc <auto_check> lỗi: câu trả lời tốt gần nhất chính là câu đang giữ, giao nguyên câu đó.
        if (x?.held && String((good.json as J).text ?? "") === x.held.text) settleGate(x, "", true);
        const g = good.json as J;
        r = { status: 200, json: { ...(good.json as Record<string, unknown>), denied: undefined, text: `${String(g.text ?? "").trim()}\n\n_(${String((r.json as J).error ?? "Lượt làm tiếp bị lỗi").slice(0, 300)})_` } };
      }
      // Nhắc hết lượt mà agy vẫn tự chặn công cụ và chưa làm được gì: báo rõ (không trả mỗi câu dẫn rồi im lặng).
      const left = (r.json as J).denied;
      if (r.status === 200 && left?.length && (!String((r.json as J).text ?? "").trim() || stalled(String((r.json as J).text))))
        r = { status: 502, json: { error: `Antigravity tự chặn công cụ (${left.join(", ")}) nên lượt này chưa làm được gì. Hãy gửi lại yêu cầu hoặc chọn model khác (để Tự động thì Synchro tự chuyển model).` } };
      else if (r.status === 200 && left) r = { ...r, json: { ...(r.json as Record<string, unknown>), denied: undefined } };
      const sources = webs.size ? { webSources: [...webs.values()] } : {};
      if (!am && typeof (r.json as J).text === "string") r = { ...r, json: { ...(r.json as Record<string, unknown>), text: scrubServerPaths(String((r.json as J).text)) } };
      if (!x && r.status === 200) return Response.json({ ...(r.json as Record<string, unknown>), ...sources, ...(natOuts.length ? { files: natOuts } : {}) });
      // Như lượt khóa API: skill / thư viện đã dùng, tệp đã tạo, dấu vết công cụ (lượt sau model nào cũng biết đã làm gì).
      const names = usedAll.filter((u) => u.kind === "skill").map((u) => u.name);
      if (x && r.status === 200) recordUse(c.user.id, names);
      // Lỗi giữa chừng (hết hạn mức, treo…): phần đã viết, tệp đã tạo, dấu vết công cụ không bị bỏ; partialWork: đã làm việc không chạy lại được.
      if (r.status !== 200) {
        const partial = am ? "" : scrubServerPaths(x?.held ? settleGate(x, "", true) : liveNow() || String((r.json as J).text ?? ""));
        return Response.json({ ...(r.json as Record<string, unknown>), ...sources, ...(partial.trim() ? { text: withTurnArts(x, partial) } : { text: undefined }), ...(x?.outs.length || natOuts.length ? { files: x?.outs ?? natOuts } : {}), ...(x?.trace.length ? { trace: x.trace } : {}), ...(usedAll.length ? { skills: usedAll, libs: usedLibs(x!, names) } : {}), ...(x?.effects?.length ? { partialWork: true } : {}) }, { status: r.status });
      }
      return Response.json({ ...(r.json as Record<string, unknown>), ...sources, text: withTurnArts(x, scrubServerPaths(settleGate(x, String((r.json as J).text ?? ""), !!(r.json as J).cancelled))), skills: usedAll, files: x!.outs, libs: usedLibs(x!, names), ...(x!.trace.length ? { trace: x!.trace } : {}) });
    } finally { bridge?.close(); sess?.close(); if (x) releaseBrowser(c.user.id, x.bctx); }
  }
  if (!model) return Response.json({ error: "Synchro chưa được kết nối với model nào. Quản trị viên cần nhập khóa API ở Cài đặt → Providers." }, { status: 503 });
  if (!canModel(c.user, model)) return Response.json({ error: modelDeniedMsg(c.user, model) }, { status: 403 });
  if (untested(model)) return Response.json({ error: "Model này mới ra và Synchro chưa thử xong nên chưa dùng được. Hãy chọn model khác." }, { status: 400 });
  const t = await resolveModel(model);
  if (!t) return Response.json({ error: "Model này không còn dùng được (khóa API của nhà cung cấp đã bị gỡ). Hãy chọn model khác." }, { status: 400 });
  // Mức nỗ lực người dùng chọn, hạ xuống giới hạn quản trị viên đặt cho model này (quản trị viên không bị giới hạn).
  // "auto": mức nỗ lực theo độ khó của yêu cầu (việc dễ trả lời nhanh, việc khó suy nghĩ kỹ).
  const want = wanted === "auto" ? autoEffort(routeInput(body)) : wanted;
  const effort = isEffort(want) ? clampEffort(want, effortCap(permsOf(c.user).effort, model), t.kind) : undefined;
  if (feature === "artifact") {
    if (!capsState(c.user).caps.ai) return Response.json({ error: "Artifact dùng AI đang tắt. Bật trong Cài đặt → Khả năng." }, { status: 403 });
    limit("artai:" + c.user.id, 120, 10 * 60_000);
    const am = artifactMessages(body.prompt);
    if (!am) return Response.json({ error: "Nội dung gửi tới model không hợp lệ." }, { status: 400 });
    try {
      if (t.kind === "mock") return Response.json({ model, text: `[mock] ${am[am.length - 1].content.slice(0, 200)}` });
      return Response.json({ model, text: await chatOnce(t, ARTIFACT_SYSTEM, am, Math.min(Number(max_tokens) || 2000, 4000), undefined, effort) });
    } catch (e) {
      if (e instanceof HttpErr) return Response.json({ error: e.message }, { status: e.status >= 500 ? 502 : e.status });
      return Response.json({ error: String((e as Error).message ?? e) }, { status: 502 });
    }
  }
  // Lượt chat chính (skills = true) áp dụng Cài đặt → Khả năng: Artifacts, hình minh họa trong chat, chạy code.
  const cs = skills ? capsState(c.user) : null;
  // Nút Thiết kế / Trình bày / Tài liệu (studio): nạp thư viện skill của plugin gắn với studio đó.
  const studio = skills && can(c.user, "skills") ? studioOf(body.studio) : null;
  const st = studio ? studioSkills(c.user.id, studio) : null;
  const image = !!skills && t.kind !== "mock" && feature !== "code";
  const pdocs = !!skills && t.kind !== "mock" && feature !== "code" && !!project && projectDocsLong(c.user.id, project);
  const capSys = cs ? [QUALITY_RULES, feature !== "code" ? ASK_RULES : "", cs.caps.art ? ARTIFACT_RULES(cs.caps.ai) : "", cs.caps.inl ? VIZ_RULES : "", cs.caps.code ? CODE_RULES(cs.caps.net, cs.caps.web) : "", image ? IMAGE_RULES : "", pdocs ? PROJECT_DOC_RULES : "", studio ? STUDIO_RULES(studio, st!.plugins, st!.skills.length) : ""].filter(Boolean).join("\n\n") : "";
  // Bàn trộn ngữ cảnh (trình duyệt gửi): tắt khối tầng động, chỉ gửi N tin gần nhất, tóm tắt các lượt cũ đã nén.
  const mixer = (body.mixer && typeof body.mixer === "object" ? body.mixer : {}) as { artifacts?: unknown; tools?: unknown; recent?: unknown };
  const base = cleanBase(body.artBase);
  const mix = { artifacts: mixer.artifacts !== false, tools: mixer.tools !== false, recent: typeof mixer.recent === "number" ? mixer.recent : undefined, summary: typeof body.summary === "string" ? body.summary : undefined, base };
  // Tài liệu ghim và bộ nhớ của người dùng: tầng tĩnh, ngay sau hướng dẫn hệ thống và danh mục skill (ít đổi nên đọc từ bộ đệm prompt).
  const pinned = [contextOf(body, c.user), pinnedBlock(body.pinned)].filter(Boolean).join("\n\n");
  const convId = typeof conv === "string" && conv.length <= 64 ? conv : undefined;
  let sess: ConnectorSession | null = null;
  try {
    const { list, visible, libs, prefer, route, ownSuggested } = await span("skills", "retrieval", () => skillSet(c.user, body, messages, studio, st));
    // Lịch sử theo chuẩn Synchro → tin nhắn sẵn sàng cho mọi hãng. Gợi ý skill theo câu hỏi mới nhất đổi mỗi lượt nên ở tầng động
    // (cuối prompt), không ở phần đầu: phần đầu (hướng dẫn, danh mục skill, tài liệu ghim) giữ nguyên để đọc từ bộ đệm.
    const dyn = [route, cs ? designOf(body, { art: !!cs.caps.art, code: !!cs.caps.code, image }, studio, convId) : "", await recallOf(body, c.user, convId), nowBlock(body), crisisBlock(body)];
    const prep = spanSync("history", "history", () => prepareHistory(messages, dyn, mix));
    markPrompt();
    // Connector chỉ dùng trong lượt chat chính (skills = true), không dùng cho các lệnh nội bộ như tóm tắt bộ nhớ.
    if (skills && t.kind !== "mock" && can(c.user, "connectors")) { sess = new ConnectorSession(c.user.id, { conv: convId, project: !!project, pol: connPolicy(permsOf(c.user)) }); if (!sess.tools.length && !sess.offline.length) sess = null; }
    const code = !!cs?.caps.code && t.kind !== "mock";
    // read_ref: đọc dữ liệu lớn đã lưu theo tham chiếu (ở lượt này hoặc các lượt trước, kể cả khi đổi model).
    const refs = !!skills && t.kind !== "mock" && (!!sess || code || /\bref_[\w-]{6,}/.test(JSON.stringify(prep.messages)));
    // "Tìm kiếm trên web" ở khung soạn: công cụ tìm web phía máy chủ của Anthropic / OpenAI; Gemini dùng web_search của Synchro
    // (Google Search qua API gốc của Gemini).
    // Grok / DeepSeek dùng web_search của Synchro (API Responses của chính hãng có công cụ tìm web).
    const synWeb = t.kind === "google" || t.kind === "xai" || t.kind === "deepseek";
    const web = !!skills && body.web === true && (t.kind === "anthropic" || t.kind === "openai" || synWeb);
    const brain = t.kind !== "mock" && brainOn(body, c.user);
    // Trình duyệt của Synchro (Cài đặt → Khả năng → Điều khiển trình duyệt): model nào cũng thao tác được trên web khi người dùng nhờ.
    // Luôn kèm khi bật, không đoán theo từng câu hỏi: công cụ nằm ở phần đầu prompt, đổi qua lại sẽ làm hỏng bộ đệm prompt.
    const browse = !!skills && t.kind !== "mock" && !!cs?.caps.browse;
    const task = skills && t.kind !== "mock" ? taskOf(body) : null;
    // Đọc lại / tự kiểm tra artifact (Artifacts bật): kiểm tra hiển thị cần Chromium của workspace.
    const arts = !!skills && t.kind !== "mock" && !!cs?.caps.art, check = arts && runner() === "workspace";
    if (visible.length || sess || code || refs || web || brain || browse || task || arts || image) {
      // Chạy script của skill chỉ khi máy chủ có nơi chạy code và người dùng bật "Chạy code và tạo tệp".
      const scripts = code;
      const sk = [capSys, arts ? ARTCHECK_RULES(check) : "", skillsPrompt(visible, scripts, ownSuggested), sess ? connectorsPrompt(sess, connProxy(sess)) : "", skills ? NARRATE_RULES : "", brain ? BRAIN_RULES : "", browse ? BROWSER_RULES : "", task ? taskRules(task, browse) : "", pinned].filter(Boolean).join("\n\n");
      const tools = [...(pdocs ? [PROJECT_DOC_TOOL] : []), ...(code ? [runCodeTool(!!cs?.caps.net, !!cs?.caps.web)] : []), ...(arts ? [READ_ARTIFACT_TOOL] : []), ...(check ? [CHECK_ARTIFACT_TOOL] : []), ...(visible.length ? skillTools(visible.length, scripts) : []), ...(sess ? connTools(sess, t.kind === "google") : []), ...(refs ? [READ_REF_TOOL] : []), ...(brain ? BRAIN_TOOLS : []), ...(browse ? BROWSER_TOOLS : []), ...(task ? [TASK_TOOL] : []), ...(image ? [imageTool()] : []), ...(skills ? [PLAN_TOOL] : []), ...(web && synWeb ? [{ ...GEMINI_WEB_TOOL, description: t.kind === "google" ? GEMINI_WEB_TOOL.description : WEB_DESC }] : [])];
      // Phiên bản công cụ tìm web theo model (bản có lọc động cho dòng mới; model cũ dùng bản cơ bản).
      const webTool = { type: anthropicWebSearch(t.model), name: "web_search", max_uses: 5 };
      if (body.estimate === true) { sess?.close(); return estimate([system, capSys], [skillsPrompt(visible, scripts, ownSuggested), sess ? connectorsPrompt(sess, connProxy(sess)) : "", JSON.stringify(tools)], pinned, prep); }
      const x: Exec = { project: pdocs ? project : undefined, image, msgs: messages, list: [...visible, ...list.filter((k) => !visible.includes(k))], scripts, sess, uid: c.user.id, code, net: !!cs?.caps.net, web: !!cs?.caps.web, art: arts ? { messages, base: body.artBase } : undefined, outs: [], libs, studio: studio ? libs[`studio-${studio}`][0] : undefined, prefer, trace: [], conv: convId, untrusted: convUntrusted(c.user.id, convId), heal: scripts ? t : undefined, search: web && synWeb ? t : undefined, browse, task, bctx: browse && cs ? { def: task ? taskBrowser(task) : browserDefault(cs), synchro: !cs.locks.browse, user: cs.locks.mine !== "admin", scope: convId ? `chat:${convId}` : undefined, cookies: codePrefs(c.user.id).cookies, files: chatFiles(messages, c.user.id, () => x.outs) } : undefined };
      if (sess) announceOffline(x, messages);
      const msgs = prep.messages;
      const ad = t.kind === "mock" ? mockAdapter(list)
        : t.kind === "anthropic" ? anthropicAdapter(t, system, sk, max_tokens, web ? [...tools, webTool] : tools, effort, prep.historyEnd, web ? citeOf(x) : undefined)
        : t.kind === "openai" ? responsesAdapter(t, `${system}\n\n${sk}`, max_tokens, tools, effort, web, web ? citeOf(x) : undefined)
        : openaiAdapter(t, `${system}\n\n${sk}`, max_tokens, tools, effort);
      const m0: unknown[] = t.kind === "mock" ? [...msgs] : t.kind === "anthropic" ? msgs.map((m) => ({ ...m, content: toAnthropic(m.content) }))
        : t.kind === "openai" ? msgs.map((m) => ({ ...m, content: toResponses(m.content) })) : msgs.map((m) => ({ ...m, content: toOpenAI(withPages(m.content)) }));
      // Kiểm tra bản sửa trên lịch sử gốc (bản đã rút gọn không còn nội dung artifact cũ).
      const raw = (Array.isArray(messages) ? messages : []) as { role: string; content: unknown }[];
      const out = await healPatch(ad, m0, x, raw, await toolLoop(ad, m0, x, [], c.user.id, model), base);
      return reply(c, model, out, x);
    }
    if (body.estimate === true) return estimate([system, capSys], [], pinned, prep);
    if (t.kind === "mock") return Response.json({ model, text: "[mock] Không có skill nào đang bật." });
    let text: string, cancelled = false;
    const sys0 = [capSys ? `${system || "Bạn là một trợ lý AI hữu ích."}\n\n${capSys}` : system, pinned].filter(Boolean).join("\n\n");
    try { text = await chatOnce(t, sys0, prep.messages, max_tokens, turnSignal(), effort, live()); }
    catch (e) { if (!isAbort(e)) throw e; text = liveNow(); cancelled = true; }
    return Response.json({ model, text, effort, ...(cancelled ? { cancelled: true } : {}) });
  } catch (e) {
    sess?.close();
    if (e instanceof HttpErr) return Response.json({ error: e.message }, { status: e.status >= 500 ? 502 : e.status });
    return Response.json({ error: String((e as Error).message ?? e) }, { status: 502 });
  }
}

/** Chạy chat ở nền (lượt chạy bền): kiểm tra hạn mức như /api/llm rồi dùng chung chatPost. runs.ts lấy thẳng hàm này từ bản mô-đun
 *  của chính gói đang chạy lượt (chatExec); đăng ký vào bảng toàn cục chỉ còn cho gói không nạp được chatengine. */
export const chatExec: RunExec = async (body, user) => {
  // Gói subscription của chính người dùng không tính vào hạn mức chi phí API của Synchro.
  const over = subCli(body.model) ? null : overLimit(user);
  if (over && body.model === AUTO) body = { ...body, plansOnly: overLimit(user, "plans") ?? over };
  else if (over) return { http: 429, json: { error: over, usageLimit: true } };
  const scope = { uid: user.id, feature: "chat" };
  const res = await usageScope.run(scope, () => chatPost(body, { user }, scope));
  const json = await res.json();
  // Việc tự động chạy theo lịch không phải đoạn chat: không rút bộ nhớ hay chưng cất vào bộ não (kết quả các lần trước đã đi cùng lần chạy sau).
  if (taskOf(body)) return { http: res.status, json };
  // Rút bộ nhớ từ lượt vừa xong ở nền (không làm chậm câu trả lời).
  if (res.status === 200 && useMemory(body, user) && typeof json?.text === "string") void learnFromTurn(user, lastUserText(body.messages), json.text).then((n) => (n ? rewarmAfterMemory(user) : undefined)).catch(() => {});
  // Bộ não tổng hợp: ghi nhận đoạn chat để chưng cất thành một nhánh (chạy nền, không làm chậm câu trả lời).
  if (res.status === 200 && json && typeof json === "object") try { afterTurn(user, body, json); } catch (e) { console.error("[brain]", e); }
  return { http: res.status, json };
};
registerExec("chat", chatExec);
