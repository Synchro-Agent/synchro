import fs from "node:fs";
import { Readable } from "node:stream";
import { audit, can, current, findByEmail, getUser, isAdmin, limit, sameOrigin, VERIFY_FIRST, verifyLocked, type UserRow } from "../../../authstore";
import {
  SpeechErr, addSpend, audioOf, checkBudget, deleteItem, effectsCatalog, el, elJson, getItem, itemFile, jsonBody, langName, library, listItems, mintRealtime, myVoices, need, plan, saveItem,
  scribeToken, sideRead, sideWrite, spender, spent, updateItem, voiceOut, backfillVoiceOwners, defaultVoice, forgetVoiceOwner, isPrivateVoice, MAX_OWN_VOICES, ownedVoices, setVoiceOwner, voiceGen, voiceOpenTo, voiceOwner, VOICE_ORPHAN, VOICE_PURGE, VOICE_SHARED, type Feat, type Plan,
} from "../../../speechapi";
import { quickCall } from "../../../ai/anymodel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Speech (ElevenLabs): một đường API cho mọi công cụ. Khóa ElevenLabs nằm ở máy chủ; trình duyệt chỉ nhận âm thanh, chữ và khóa tạm.
type Ctx = { params: Promise<{ op: string[] }> };
const MB = 1024 * 1024, MAX_UP = 40 * MB;
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown, lo: number, hi: number, d: number) => { if (v === null || v === undefined || v === "") return d; const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const bool = (v: unknown, d = false) => (v === undefined || v === null || v === "" ? d : v === true || v === "true" || v === "1" || v === 1);
const credits = (p: Plan) => ({ used: p.credits.used, limit: p.credits.limit, resetAt: p.credits.resetAt });
const ok = async (o: Record<string, unknown>) => Response.json({ ...o, credits: credits(await plan()) });
const voiceCache = { at: 0, gen: 0, list: [] as Awaited<ReturnType<typeof myVoices>> };
async function voices(fresh = false) {
  if (fresh || voiceCache.gen !== voiceGen() || Date.now() - voiceCache.at > 10 * 60_000 || !voiceCache.list.length) {
    voiceCache.list = await myVoices(); voiceCache.at = Date.now(); voiceCache.gen = voiceGen();
    try { backfillVoiceOwners(voiceCache.list); } catch (e) { console.error("[speech] gán chủ giọng cũ", e); }
  }
  return voiceCache.list;
}
const forgetVoices = () => { voiceCache.at = 0; };
/** Giọng dùng được qua API với gói hiện tại (gói Free: bỏ giọng lấy từ Thư viện). */
async function usableVoices() {
  const [p, list] = await Promise.all([plan(), voices().catch(() => [] as Awaited<ReturnType<typeof voices>>)]);
  return p.library ? list : list.filter((v) => !v.lib);
}
// Giọng đọc: giọng người dùng chọn nếu dùng được với gói; không thì speechapi.defaultVoice.
async function pickVoice(u: UserRow, text: string, want?: string) {
  const list = await usableVoices();
  const p = await plan();
  if (want && (p.library || list.some((v) => v.id === want) || !(await voices().catch(() => [])).some((v) => v.id === want && v.lib))) return want;
  return defaultVoice(list, text, u.id);
}
async function file(form: FormData, key: string, max = MAX_UP) {
  const f = form.get(key);
  if (!(f instanceof File) || !f.size) return null;
  if (f.size > max) throw new SpeechErr(`Tệp "${f.name}" lớn hơn ${Math.round(max / MB)} MB. Dán liên kết tới tệp thay vì tải lên, hoặc cắt ngắn tệp.`, 413);
  return f;
}
const titleOf = (t: string, n = 70) => { const s = t.replace(/\[[^\]]{1,30}\]/g, "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s || "Không tên"; };
const settingsOf = (b: Record<string, unknown>) => {
  const s = (b.settings ?? {}) as Record<string, unknown>;
  return {
    stability: num(s.stability, 0, 1, 0.5), similarity_boost: num(s.similarity, 0, 1, 0.75), style: num(s.style, 0, 1, 0),
    speed: num(s.speed, 0.7, 1.2, 1), use_speaker_boost: bool(s.boost, true),
  };
};
async function fmtFor(want: unknown) {
  const p = await plan();
  const f = typeof want === "string" && p.formats.some((x) => x.id === want) ? want : "mp3_44100_128";
  return f;
}

// Hiệu ứng âm thanh của Đọc văn bản / Hội thoại: { filter, space, noise, distance (0–1), send (0–1), pan (-1–1) } → audio_effects.
async function effectsOf(b: Record<string, unknown>) {
  const e = (b.effects && typeof b.effects === "object" ? b.effects : null) as Record<string, unknown> | null;
  if (!e) return undefined;
  const cat = await effectsCatalog();
  const pick = (v: unknown, list: { id: string }[]) => (typeof v === "string" && list.some((x) => x.id === v) ? v : undefined);
  const out: Record<string, unknown> = {};
  const f = pick(e.filter, cat.filters), sp = pick(e.space, cat.spaces), no = pick(e.noise, cat.noises);
  if (f) out.filter_preset_id = f;
  if (sp) { out.environment_id = sp; out.send_level = num(e.send, 0, 1, 1); }
  if (no) out.background_noise_id = no;
  const dist = num(e.distance, 0, 1, 0), pan = num(e.pan, -1, 1, 0);
  if (dist > 0) out.distance = dist;
  if (pan !== 0) out.pan = pan;
  return Object.keys(out).length ? out : undefined;
}
// Từ điển phát âm áp vào lúc đọc: [{ id, version }] → pronunciation_dictionary_locators (tối đa 3 từ điển, như ElevenLabs).
function dictsOf(b: Record<string, unknown>) {
  const list = (Array.isArray(b.dicts) ? b.dicts : []).map((d: { id?: unknown; version?: unknown }) => ({ pronunciation_dictionary_id: str(d.id, 60), version_id: str(d.version, 60) }))
    .filter((d) => d.pronunciation_dictionary_id && d.version_id).slice(0, 3);
  return list.length ? list : undefined;
}
// Định dạng có vang / lệch kênh cần âm thanh stereo: PCM / μ-law không dùng được với hiệu ứng đó.
const stereoOk = (fmt: string, fx?: Record<string, unknown>) => !fx || (!fx.environment_id && !fx.pan) || /^(mp3|opus|wav)/.test(fmt);

// Giọng riêng đã có chủ chỉ chủ của nó và quản trị viên dùng được, dù biết mã giọng. Không đọc được danh sách giọng thì lời gọi ElevenLabs sau đó cũng sẽ báo lỗi.
// Câu báo không khẳng định giọng của ai: chủ suy từ lịch sử có thể sai, người tạo thật cần biết nhờ quản trị viên gán lại. Mã "voice": đọc to bỏ giọng đã lưu, đọc bằng giọng mặc định.
async function gateVoices(u: UserRow, ids: string[]) {
  if (isAdmin(u) || !ids.length) return;
  const list = await voices().catch(() => []);
  for (const id of ids) {
    const v = list.find((x) => x.id === id);
    if (v && isPrivateVoice(v) && !voiceOpenTo(id, u.id)) throw new SpeechErr("Giọng này chưa được gán cho tài khoản của bạn. Hãy chọn giọng khác, hoặc nhờ quản trị viên gán lại nếu đây là giọng bạn đã tạo.", 403, "voice");
  }
}
const voiceIds = (b: Record<string, unknown>, form: FormData | null) => {
  const lines = Array.isArray(b.lines) ? (b.lines as { voice?: unknown }[]).map((l) => l?.voice) : [];
  return [b.voice, b.host, b.guest, ...lines, form?.get("voice")].filter((x): x is string => typeof x === "string" && !!x);
};
/** Quản trị viên xem chủ của giọng riêng: email, hoặc trạng thái. */
const voiceHolder = (id: string) => {
  const o = voiceOwner(id);
  return o === null ? "none" : o === VOICE_SHARED ? "shared" : o === VOICE_ORPHAN ? "orphan" : o === VOICE_PURGE ? "purge" : getUser(o)?.email ?? "orphan";
};
/** Gán chủ cho giọng không rõ chủ hoặc gán sai, hoặc đánh dấu cho mọi thành viên. Giọng đang chờ xóa thì không: chủ của nó đã yêu cầu xóa khi xóa tài khoản. */
function assignVoice(u: UserRow, b: Record<string, unknown>) {
  if (!isAdmin(u)) throw new SpeechErr("Chỉ quản trị viên mới gán được chủ của giọng.", 403);
  const id = str(b.id, 60), who = str(b.owner, 254).toLowerCase();
  if (!id || !who) throw new SpeechErr("Thiếu giọng hoặc người được gán.");
  if (voiceOwner(id) === VOICE_PURGE) throw new SpeechErr("Giọng này đang chờ xóa cùng tài khoản đã xóa.", 409);
  const t = who === "shared" ? null : findByEmail(who);
  if (who !== "shared" && !t) throw new SpeechErr("Không tìm thấy tài khoản có email này.", 404);
  setVoiceOwner(id, t?.id ?? VOICE_SHARED);
  audit("speech_voice_owner", { actor: u, target: t, detail: `${id}${t ? "" : " shared"}` });
  return Response.json({ ok: true, holder: voiceHolder(id) });
}
const claimVoice = (voice: string) => { const uid = spender.getStore(); if (uid) setVoiceOwner(voice, uid); };

async function GETop(req: Request, u: UserRow, op: string) {
  const q = new URL(req.url).searchParams;
  if (op === "plan") return Response.json(await plan({ fresh: q.get("fresh") === "1" }));
  if (op === "voices") {
    if (q.get("lib") === "1") {
      await need("tts");
      const p = await plan();
      if (!p.library) throw new SpeechErr("Gói ElevenLabs Free không dùng được giọng Thư viện qua API.", 403, "plan");
      const r = await library({ search: str(q.get("q"), 80), language: str(q.get("lang"), 10), gender: str(q.get("gender"), 20), age: str(q.get("age"), 20), use: str(q.get("use"), 40),
        sort: str(q.get("sort"), 30) || "trending", page: num(q.get("page"), 0, 50, 0), free: p.tier === "free" });
      return Response.json(r);
    }
    if (q.get("id")) { await gateVoices(u, [q.get("id")!]); const v = await elJson<Parameters<typeof voiceOut>[0] & { fine_tuning?: unknown }>(`/v1/voices/${encodeURIComponent(q.get("id")!)}`); return Response.json({ voice: voiceOut(v), fineTuning: v.fine_tuning ?? null }); }
    const p = await plan();
    // Gói Free: giọng lấy từ Thư viện không dùng được qua API nên không hiện.
    const admin = isAdmin(u);
    const list = (await voices(q.get("fresh") === "1")).filter((v) => (p.library || !v.lib) && (admin || !isPrivateVoice(v) || voiceOpenTo(v.id, u.id)))
      .map((v) => ({ ...v, canDelete: admin || voiceOwner(v.id) === u.id, ...(admin && isPrivateVoice(v) ? { holder: voiceHolder(v.id) } : {}) }));
    const s = str(q.get("q"), 80).toLowerCase();
    return Response.json({ voices: s ? list.filter((v) => `${v.name} ${v.desc} ${v.lang} ${v.accent} ${v.use}`.toLowerCase().includes(s)) : list });
  }
  if (op === "items") {
    if (q.get("id")) { const it = getItem(u, q.get("id")!); if (!it) throw new SpeechErr("Không tìm thấy mục này.", 404); return Response.json({ item: it, data: sideRead(u, it.id) }); }
    const kinds = str(q.get("kinds"), 200).split(",").filter(Boolean);
    return Response.json({ items: listItems(u, kinds, num(q.get("limit"), 1, 100, 40), num(q.get("before"), 0, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)) });
  }
  if (op === "file") return sendFile(req, u, q.get("id") ?? "", q.get("dl") === "1");
  if (op === "effects") { await need("tts"); return Response.json(await effectsCatalog()); }
  if (op === "dicts") {
    await need("dict");
    if (q.get("id")) {
      const d = await elJson<{ id: string; name: string; description?: string | null; latest_version_id: string; latest_version_rules_num: number; rules?: Rule[] }>(`/v1/pronunciation-dictionaries/${encodeURIComponent(q.get("id")!)}`, { feat: "dict" });
      return Response.json({ dict: { id: d.id, name: d.name, desc: d.description ?? "", version: d.latest_version_id, count: d.latest_version_rules_num, rules: (d.rules ?? []).map(ruleOut) } });
    }
    const j = await elJson<{ pronunciation_dictionaries: { id: string; name: string; description?: string | null; latest_version_id: string; latest_version_rules_num: number; creation_time_unix: number }[] }>("/v1/pronunciation-dictionaries?page_size=50&sort=creation_time_unix&sort_direction=DESCENDING", { feat: "dict" });
    return Response.json({ dicts: j.pronunciation_dictionaries.map((d) => ({ id: d.id, name: d.name, desc: d.description ?? "", version: d.latest_version_id, count: d.latest_version_rules_num, createdAt: d.creation_time_unix * 1000 })) });
  }
  if (op === "native") return nativeStatus(u, q.get("id") ?? "");
  if (op === "dub") return dubStatus(u, q.get("id") ?? "");
  if (op === "project") return projectStatus(u, q.get("id") ?? "");
  if (op === "pvc") {
    await need("pvc");
    const voice = str(q.get("voice"), 40);
    await gateVoices(u, [voice]);
    const r = await el(`/v1/voices/pvc/${encodeURIComponent(voice)}/captcha`, { feat: "pvc" });
    const ct = r.headers.get("content-type") ?? "";
    if (/image/.test(ct)) return Response.json({ image: `data:${ct};base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}` });
    return Response.json(await r.json().catch(() => ({})));
  }
  throw new SpeechErr("Không có thao tác này.", 404);
}

function sendFile(req: Request, u: UserRow, id: string, dl: boolean) {
  const f = itemFile(u, id);
  if (!f) throw new SpeechErr("Không tìm thấy tệp âm thanh.", 404);
  const size = fs.statSync(f.path).size;
  const h: Record<string, string> = { "content-type": f.mime, "accept-ranges": "bytes", "cache-control": "private, max-age=86400" };
  if (dl) h["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`;
  // Hỗ trợ tua (Range) để trình phát nhảy tới mốc thời gian trong bản chép lời.
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") ?? "");
  if (m) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2])), end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    return new Response(Readable.toWeb(fs.createReadStream(f.path, { start, end })) as ReadableStream, { status: 206, headers: { ...h, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
  }
  return new Response(Readable.toWeb(fs.createReadStream(f.path)) as ReadableStream, { headers: { ...h, "content-length": String(size) } });
}

// ---- tạo âm thanh ----
async function tts(u: UserRow, b: Record<string, unknown>) {
  const p = await need("tts");
  const text = str(b.text, 50_000);
  if (!text) throw new SpeechErr("Hãy nhập văn bản cần đọc.");
  const model = p.tts.find((m) => m.id === b.model) ?? p.tts.find((m) => m.id === "eleven_v4") ?? p.tts[0];
  if (!model) throw new SpeechErr("ElevenLabs chưa trả về model đọc văn bản nào cho khóa này.", 502);
  if (text.length > model.max) throw new SpeechErr(`Văn bản dài ${text.length.toLocaleString("vi-VN")} ký tự, quá giới hạn ${model.max.toLocaleString("vi-VN")} ký tự mỗi lần của ${model.name} trong gói này. Chia nhỏ văn bản hoặc chọn model khác.`);
  const voice = await pickVoice(u, text, str(b.voice, 40));
  const fmt = await fmtFor(b.format);
  const q = new URLSearchParams({ output_format: fmt });
  const vs = settingsOf(b);
  // Eleven v3 / v4 chỉ nhận độ ổn định 0 (Sáng tạo), 0,5 (Tự nhiên) hoặc 1 (Ổn định).
  if (/v3|v4/.test(model.id)) vs.stability = Math.round(vs.stability * 2) / 2;
  const body: Record<string, unknown> = { text, model_id: model.id, voice_settings: vs, apply_text_normalization: ["on", "off"].includes(String(b.normalize)) ? b.normalize : "auto" };
  const lang = str(b.lang, 8);
  if (lang) body.language_code = lang;
  if (b.seed !== undefined && b.seed !== "" && Number.isFinite(Number(b.seed))) body.seed = Math.floor(Number(b.seed)) % 4294967295;
  const fx = await effectsOf(b), dicts = dictsOf(b);
  if (fx && !stereoOk(fmt, fx)) throw new SpeechErr("Hiệu ứng vang và lệch kênh cần định dạng MP3, Opus hoặc WAV. Đổi định dạng rồi thử lại.");
  if (fx) body.audio_effects = fx;
  if (dicts) body.pronunciation_dictionary_locators = dicts;
  const r = await el(`/v1/text-to-speech/${encodeURIComponent(voice)}?${q}`, { ...jsonBody(body), feat: "tts" });
  const cost = spent(r);
  const a = await audioOf(r, fmt);
  const item = saveItem(u, "tts", titleOf(text), { text: text.slice(0, 5000), voice, voiceName: str(b.voiceName, 80), model: model.id, modelName: model.name, format: fmt, chars: text.length, cost, settings: body.voice_settings, lang, effects: fx ?? null, dicts: dicts?.length ?? 0 }, a);
  return ok({ item });
}
async function dialogue(u: UserRow, b: Record<string, unknown>) {
  const p = await need("dialogue");
  const lines = (Array.isArray(b.lines) ? b.lines : []).map((l: { text?: unknown; voice?: unknown; name?: unknown }) => ({ text: str(l.text, 5000), voice_id: str(l.voice, 40), name: str(l.name, 60) })).filter((l) => l.text && l.voice_id).slice(0, 200);
  if (!lines.length) throw new SpeechErr("Thêm ít nhất một lời thoại và chọn giọng cho người nói.");
  const model = p.tts.find((m) => m.id === b.model && /v3|v4/.test(m.id)) ?? p.tts.find((m) => m.id === "eleven_v3") ?? p.tts.find((m) => /v3|v4/.test(m.id));
  if (!model) throw new SpeechErr("Hội thoại nhiều giọng cần model Eleven v3 hoặc v4, khóa này chưa có.");
  const fmt = await fmtFor(b.format);
  const fx = await effectsOf(b), dicts = dictsOf(b);
  if (fx && !stereoOk(fmt, fx)) throw new SpeechErr("Hiệu ứng vang và lệch kênh cần định dạng MP3, Opus hoặc WAV. Đổi định dạng rồi thử lại.");
  const r = await el(`/v1/text-to-dialogue?output_format=${fmt}`, { ...jsonBody({ inputs: lines.map(({ text, voice_id }) => ({ text, voice_id })), model_id: model.id, ...(str(b.lang, 8) ? { language_code: str(b.lang, 8) } : {}), ...(fx ? { audio_effects: fx } : {}), ...(dicts ? { pronunciation_dictionary_locators: dicts } : {}) }), feat: "dialogue", timeout: 240_000 });
  const cost = spent(r);
  const a = await audioOf(r, fmt);
  const chars = lines.reduce((n, l) => n + l.text.length, 0);
  const item = saveItem(u, "dialogue", titleOf(lines.map((l) => l.text).join(" ")), { lines, model: model.id, modelName: model.name, format: fmt, chars, cost, speakers: [...new Set(lines.map((l) => l.name || l.voice_id))] }, a);
  return ok({ item });
}
// Đọc to trong khung chat và chế độ giọng nói: model nhanh nhất, phát dần khi âm thanh còn đang tạo, không lưu vào lịch sử.
async function speak(u: UserRow, b: Record<string, unknown>) {
  const p = await need("tts");
  const text = str(b.text, 5000).replace(/```[\s\S]*?(```|$)/g, " ").replace(/[*_#>`|]/g, "").replace(/\s+/g, " ").trim();
  if (!text) throw new SpeechErr("Không có nội dung để đọc.");
  const model = ["eleven_v4_turbo", "eleven_flash_v2_5", "eleven_turbo_v2_5"].map((id) => p.tts.find((m) => m.id === id)).find(Boolean) ?? p.tts[0];
  const voice = await pickVoice(u, text, str(b.voice, 40));
  const speed = num(b.speed, 0.7, 1.2, 1);
  // Tham số chờ ngắn chỉ các model v2 nhận; model v4 trả lỗi 400 nên nút đọc to hỏng hẳn trên gói có model này.
  const r = await el(`/v1/text-to-speech/${encodeURIComponent(voice)}/stream?output_format=mp3_44100_128${/_v2/.test(model?.id ?? "") ? "&optimize_streaming_latency=2" : ""}`, {
    ...jsonBody({ text: text.slice(0, model?.max ?? 5000), model_id: model?.id, voice_settings: { stability: 0.5, similarity_boost: 0.75, speed } }), feat: "tts",
  });
  spent(r, text.length);
  return new Response(r.body, { headers: { "content-type": r.headers.get("content-type") ?? "audio/mpeg", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
async function stt(u: UserRow, form: FormData) {
  await need("stt");
  const f = await file(form, "file");
  const url = str(form.get("url"), 2000);
  if (!f && !url) throw new SpeechErr("Chọn tệp âm thanh / video hoặc dán liên kết.");
  if (url && !/^https?:\/\//i.test(url)) throw new SpeechErr("Liên kết phải bắt đầu bằng http:// hoặc https://");
  const fd = new FormData();
  // Scribe v2 (chính xác nhất), v2 Turbo (nhanh, rẻ hơn), v2 Medical (thuật ngữ y khoa: thuốc, bệnh, giải phẫu).
  const model = ["scribe_v2", "scribe_v2_turbo", "scribe_v2_medical"].find((m) => m === form.get("model")) ?? "scribe_v2";
  fd.set("model_id", model);
  if (f) fd.set("file", f, f.name); else fd.set("source_url", url);
  const lang = str(form.get("lang"), 8);
  if (lang) fd.set("language_code", lang);
  const diar = bool(form.get("diarize"), true);
  fd.set("diarize", String(diar));
  const ns = Number(form.get("speakers"));
  if (diar && ns >= 1 && ns <= 32) fd.set("num_speakers", String(Math.floor(ns)));
  fd.set("tag_audio_events", String(bool(form.get("events"), true)));
  fd.set("timestamps_granularity", ["none", "word", "character"].includes(String(form.get("granularity"))) ? String(form.get("granularity")) : "word");
  if (bool(form.get("noVerbatim"))) fd.set("no_verbatim", "true");
  if (diar && bool(form.get("roles"))) fd.set("detect_speaker_roles", "true");
  if (diar && bool(form.get("speakerLibrary"))) fd.set("use_speaker_library", "true");
  const edit = str(form.get("edit"), 2000);
  if (edit) fd.set("transcript_edit", edit);
  if (bool(form.get("entities"))) fd.set("entity_detection", "all");
  if (bool(form.get("redact"))) { fd.set("entity_redaction", "all"); fd.set("entity_redaction_mode", "entity_type"); }
  try { for (const k of (JSON.parse(String(form.get("keyterms") ?? "[]")) as string[]).slice(0, 100)) if (typeof k === "string" && k.trim()) fd.append("keyterms", k.trim().slice(0, 49)); } catch {}
  const r = await el("/v1/speech-to-text", { method: "POST", body: fd, feat: "stt", timeout: 290_000 });
  const j = (await r.json()) as { language_code?: string; language_probability?: number; text: string; words?: { text: string; start?: number; end?: number; type: string; speaker_id?: string }[]; entities?: unknown[];
    edited_transcript?: string | { text?: string; edited_text?: string; error?: string } | null };
  // Bản đã chỉnh theo câu lệnh của người dùng (transcript_edit), nếu có.
  const et = j.edited_transcript;
  const edited = typeof et === "string" ? et : et?.text ?? et?.edited_text ?? "";
  const words = (j.words ?? []).map((w) => ({ t: w.text, s: w.start ?? 0, e: w.end ?? 0, k: w.type === "spacing" ? 0 : w.type === "audio_event" ? 2 : 1, sp: w.speaker_id ?? "" }));
  const dur = words.length ? words[words.length - 1].e : 0;
  const speakers = [...new Set(words.map((w) => w.sp).filter(Boolean))];
  const name = f?.name ?? url.replace(/^https?:\/\//, "").slice(0, 80);
  const item = saveItem(u, "stt", name, { lang: j.language_code ?? "", langName: langName(j.language_code ?? ""), prob: j.language_probability ?? 0, dur, speakers, words: words.length, preview: j.text.slice(0, 300), source: f ? "file" : "url", url: f ? null : url, model, edited: !!edited },
    f && f.size <= MAX_UP ? { buf: Buffer.from(await f.arrayBuffer()), mime: f.type || "audio/mpeg", ext: (f.name.split(".").pop() || "mp3").toLowerCase().slice(0, 5) } : undefined);
  sideWrite(u, item.id, { text: j.text, words, entities: j.entities ?? [], edited });
  return ok({ item, data: { text: j.text, words, entities: j.entities ?? [], edited } });
}
async function sfx(u: UserRow, b: Record<string, unknown>) {
  await need("sfx");
  const text = str(b.text, 450);
  if (!text) throw new SpeechErr("Mô tả âm thanh cần tạo.");
  // Model hiệu ứng v3 (bám câu lệnh tốt hơn) mặc định; v2 khi người dùng chọn.
  const body: Record<string, unknown> = { text, loop: bool(b.loop), prompt_influence: num(b.influence, 0, 1, 0.3), model_id: b.model === "eleven_text_to_sound_v2" ? "eleven_text_to_sound_v2" : "eleven_text_to_sound_v3" };
  if (b.duration) body.duration_seconds = num(b.duration, 0.5, 30, 5);
  const r = await el("/v1/sound-generation?output_format=mp3_44100_128", { ...jsonBody(body), feat: "sfx" });
  const cost = spent(r);
  const item = saveItem(u, "sfx", titleOf(text), { text, loop: body.loop, duration: body.duration_seconds ?? null, influence: body.prompt_influence, model: body.model_id, cost }, await audioOf(r));
  return ok({ item });
}
async function music(u: UserRow, b: Record<string, unknown>) {
  await need("music");
  const prompt = str(b.prompt, 2000);
  if (!prompt) throw new SpeechErr("Mô tả bản nhạc bạn muốn.");
  // Lời bài hát: tự viết theo mô tả (mặc định), không lời, hoặc lời người dùng tự soạn.
  const lyrics = str(b.lyrics, 4000);
  const body: Record<string, unknown> = { prompt, force_instrumental: !lyrics && bool(b.instrumental), model_id: ["music_v1", "music_v2", "music_v2_5"].find((m) => m === b.model) ?? "music_v2_5" };
  if (lyrics) body.lyrics_text = lyrics;
  if (b.seconds) body.music_length_ms = Math.round(num(b.seconds, 3, 300, 30) * 1000);
  const r = await el("/v1/music?output_format=mp3_44100_128", { ...jsonBody(body), feat: "music", timeout: 290_000 });
  const cost = spent(r);
  const item = saveItem(u, "music", titleOf(prompt), { prompt, seconds: body.music_length_ms ? Number(body.music_length_ms) / 1000 : null, instrumental: body.force_instrumental, lyrics: !!lyrics, model: body.model_id, cost }, await audioOf(r));
  return ok({ item });
}
// Nhạc cho video: ElevenLabs xem video rồi sáng tác nhạc nền khớp nhịp, có thể thêm tiếng động theo cảnh.
async function videoMusic(u: UserRow, form: FormData) {
  await need("music");
  const f = await file(form, "file");
  if (!f) throw new SpeechErr("Chọn video cần làm nhạc nền.");
  const fd = new FormData();
  fd.append("videos", f, f.name);
  const desc = str(form.get("prompt"), 4000);
  if (desc) fd.set("description", desc);
  for (const t of str(form.get("tags"), 300).split(",").map((x) => x.trim()).filter(Boolean).slice(0, 10)) fd.append("tags", t);
  fd.set("model_id", ["music_v1", "music_v2", "music_v2_5"].find((m) => m === form.get("model")) ?? "music_v2_5");
  fd.set("add_sfx", String(bool(form.get("sfx"))));
  const r = await el("/v1/music/video-to-music?output_format=mp3_44100_128", { method: "POST", body: fd, feat: "music", timeout: 290_000 });
  const cost = spent(r);
  const item = saveItem(u, "music", `Nhạc cho ${f.name}`.slice(0, 120), { prompt: desc, video: f.name, sfx: bool(form.get("sfx")), cost }, await audioOf(r));
  return ok({ item });
}
// Tách stem: tách bài hát thành giọng hát và nhạc (2 stem) hoặc giọng, trống, bass, guitar, piano, khác (6 stem). Kết quả là tệp ZIP.
async function stems(u: UserRow, form: FormData) {
  await need("music");
  const f = await file(form, "file");
  if (!f) throw new SpeechErr("Chọn bài hát hoặc tệp âm thanh cần tách.");
  const fd = new FormData();
  fd.set("file", f, f.name);
  const six = form.get("stems") === "6";
  fd.set("stem_variation_id", six ? "six_stems_v1" : "two_stems_v1");
  const r = await el("/v1/music/stem-separation", { method: "POST", body: fd, feat: "music", timeout: 290_000 });
  const cost = spent(r);
  const ct = (r.headers.get("content-type") ?? "application/zip").split(";")[0];
  const buf = Buffer.from(await r.arrayBuffer());
  const zip = /zip/.test(ct) || buf.subarray(0, 2).toString() === "PK";
  const item = saveItem(u, "stems", `${six ? "6" : "2"} stem · ${f.name}`.slice(0, 120), { source: f.name, stems: six ? 6 : 2, cost }, { buf, mime: zip ? "application/zip" : ct, ext: zip ? "zip" : "mp3" });
  return ok({ item });
}
async function isolate(u: UserRow, form: FormData) {
  await need("isolate");
  const f = await file(form, "file");
  if (!f) throw new SpeechErr("Chọn tệp âm thanh hoặc video cần lọc.");
  const fd = new FormData(); fd.set("audio", f, f.name);
  const r = await el("/v1/audio-isolation", { method: "POST", body: fd, feat: "isolate", timeout: 290_000 });
  const cost = spent(r);
  const item = saveItem(u, "isolate", f.name, { source: f.name, size: f.size, cost }, await audioOf(r));
  return ok({ item });
}
async function changer(u: UserRow, form: FormData) {
  const p = await need("changer");
  const f = await file(form, "file");
  const voice = str(form.get("voice"), 40);
  if (!f) throw new SpeechErr("Chọn hoặc ghi âm đoạn giọng cần đổi.");
  if (!voice) throw new SpeechErr("Chọn giọng muốn đổi sang.");
  const model = p.sts.find((m) => m.id === form.get("model")) ?? p.sts.find((m) => /multilingual/.test(m.id)) ?? p.sts[0];
  const fd = new FormData();
  fd.set("audio", f, f.name); fd.set("model_id", model?.id ?? "eleven_multilingual_sts_v2");
  fd.set("voice_settings", JSON.stringify({ stability: num(form.get("stability"), 0, 1, 0.5), similarity_boost: num(form.get("similarity"), 0, 1, 0.75), style: num(form.get("style"), 0, 1, 0), use_speaker_boost: bool(form.get("boost"), true) }));
  fd.set("remove_background_noise", String(bool(form.get("denoise"))));
  const fmt = await fmtFor(form.get("format"));
  const r = await el(`/v1/voice-changer/${encodeURIComponent(voice)}?output_format=${fmt}`, { method: "POST", body: fd, feat: "changer", timeout: 290_000 });
  const cost = spent(r);
  const item = saveItem(u, "changer", f.name, { source: f.name, voice, voiceName: str(form.get("voiceName"), 80), model: model?.id, cost }, await audioOf(r, fmt));
  return ok({ item });
}
async function align(u: UserRow, form: FormData) {
  await need("align");
  const f = await file(form, "file");
  const text = str(form.get("text"), 100_000);
  if (!f || !text) throw new SpeechErr("Cần cả tệp âm thanh và văn bản để căn.");
  const fd = new FormData(); fd.set("file", f, f.name); fd.set("text", text);
  const j = await elJson<{ words: { text: string; start: number; end: number }[]; characters?: unknown[]; loss?: number }>("/v1/forced-alignment", { method: "POST", body: fd, feat: "align", timeout: 290_000 });
  const item = saveItem(u, "align", f.name, { words: j.words.length, loss: j.loss ?? null, preview: text.slice(0, 200) });
  const words = j.words.map((w) => ({ t: w.text, s: w.start, e: w.end }));
  sideWrite(u, item.id, { words, text });
  return ok({ item, data: { words, text } });
}

// ---- giọng ----
type Preview = { audio_base_64: string; generated_voice_id: string; media_type?: string; duration_secs?: number };
const previews = (j: { previews: Preview[]; text: string }) => ({ text: j.text, previews: j.previews.map((x) => ({ id: x.generated_voice_id, audio: `data:${x.media_type || "audio/mpeg"};base64,${x.audio_base_64}`, dur: x.duration_secs ?? 0 })) });
async function design(b: Record<string, unknown>) {
  await need("design");
  const desc = str(b.desc, 1000);
  if (desc.length < 20) throw new SpeechErr("Mô tả giọng cần ít nhất 20 ký tự.");
  const text = str(b.text, 1000);
  if (text && (text.length < 100)) throw new SpeechErr("Câu nghe thử cần 100–1000 ký tự, hoặc bật “Tự viết câu nghe thử”.");
  const j = await elJson<{ previews: Preview[]; text: string }>("/v1/text-to-voice/design?output_format=mp3_44100_128", {
    ...jsonBody({ voice_description: desc, model_id: b.model === "eleven_multilingual_ttv_v2" ? b.model : "eleven_ttv_v3", ...(text ? { text } : { auto_generate_text: true }), guidance_scale: num(b.guidance, 0, 100, 5), should_enhance: bool(b.enhance) }),
    feat: "design", timeout: 180_000,
  });
  return ok(previews(j));
}
async function remix(b: Record<string, unknown>) {
  await need("remix");
  const voice = str(b.voice, 40), desc = str(b.desc, 1000);
  if (!voice || desc.length < 5) throw new SpeechErr("Chọn giọng gốc và mô tả cách đổi.");
  const text = str(b.text, 1000);
  const j = await elJson<{ previews: Preview[]; text: string }>(`/v1/text-to-voice/${encodeURIComponent(voice)}/remix?output_format=mp3_44100_128`, {
    ...jsonBody({ voice_description: desc, ...(text.length >= 100 ? { text } : { auto_generate_text: true }), guidance_scale: num(b.guidance, 0, 100, 5), prompt_strength: num(b.strength, 0, 1, 0.5) }),
    feat: "remix", timeout: 180_000,
  });
  return ok(previews(j));
}
async function saveDesigned(b: Record<string, unknown>) {
  const id = str(b.id, 80), name = str(b.name, 60) || "Giọng mới", desc = str(b.desc, 1000) || name;
  if (!id) throw new SpeechErr("Chọn bản nghe thử muốn lưu.");
  const v = await elJson<Parameters<typeof voiceOut>[0]>("/v1/text-to-voice", { ...jsonBody({ voice_name: name, voice_description: desc.length >= 20 ? desc : `${desc} (Synchro)`.padEnd(20, "."), generated_voice_id: id }), feat: "design" });
  forgetVoices();
  claimVoice(v.voice_id);
  return ok({ voice: voiceOut(v) });
}
async function ivc(form: FormData) {
  await need("ivc");
  const name = str(form.get("name"), 60);
  if (!name) throw new SpeechErr("Đặt tên cho giọng.");
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0).slice(0, 25);
  if (!files.length) throw new SpeechErr("Thêm ít nhất một đoạn âm thanh mẫu.");
  for (const f of files) if (f.size > 10 * MB) throw new SpeechErr(`Mẫu "${f.name}" lớn hơn 10 MB.`);
  const fd = new FormData();
  fd.set("name", name);
  for (const f of files) fd.append("files", f, f.name);
  fd.set("remove_background_noise", String(bool(form.get("denoise"))));
  const desc = str(form.get("desc"), 500);
  if (desc) fd.set("description", desc);
  const j = await elJson<{ voice_id: string; requires_verification: boolean }>("/v1/voices/add", { method: "POST", body: fd, feat: "ivc", timeout: 180_000 });
  forgetVoices();
  claimVoice(j.voice_id);
  return ok({ voiceId: j.voice_id, verify: j.requires_verification });
}
async function pvc(b: Record<string, unknown> | FormData, action: string) {
  await need("pvc");
  if (action === "create") {
    const o = b as Record<string, unknown>;
    const j = await elJson<{ voice_id: string }>("/v1/voices/pvc", { ...jsonBody({ name: str(o.name, 60) || "Giọng chuyên sâu", language: str(o.lang, 8) || "vi", description: str(o.desc, 500) || null }), feat: "pvc" });
    forgetVoices();
    claimVoice(j.voice_id);
    return ok({ voiceId: j.voice_id });
  }
  const form = b as FormData, voice = encodeURIComponent(str(form.get("voice"), 40));
  if (action === "samples") {
    const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0).slice(0, 25);
    if (!files.length) throw new SpeechErr("Thêm tệp âm thanh mẫu.");
    const fd = new FormData();
    for (const f of files) fd.append("files", f, f.name);
    fd.set("remove_background_noise", String(bool(form.get("denoise"))));
    const j = await elJson<{ sample_id: string; duration_secs?: number }[]>(`/v1/voices/pvc/${voice}/samples`, { method: "POST", body: fd, feat: "pvc", timeout: 290_000 });
    return ok({ samples: j.map((s) => ({ id: s.sample_id, dur: s.duration_secs ?? 0 })) });
  }
  if (action === "verify") {
    const f = await file(form, "recording", 20 * MB);
    if (!f) throw new SpeechErr("Ghi âm câu xác minh trước.");
    const fd = new FormData(); fd.set("recording", f, f.name);
    const j = await elJson<{ status: string }>(`/v1/voices/pvc/${voice}/captcha`, { method: "POST", body: fd, feat: "pvc" });
    return ok({ status: j.status });
  }
  if (action === "train") {
    const j = await elJson<{ status: string }>(`/v1/voices/pvc/${voice}/train`, { ...jsonBody({}), feat: "pvc" });
    return ok({ status: j.status });
  }
  throw new SpeechErr("Không có thao tác này.", 404);
}
async function addLibrary(b: Record<string, unknown>) {
  await need("tts");
  const owner = str(b.owner, 80), id = str(b.id, 40), name = str(b.name, 60) || "Giọng thư viện";
  if (!owner || !id) throw new SpeechErr("Thiếu thông tin giọng.");
  const j = await elJson<{ voice_id: string }>(`/v1/voices/add/${encodeURIComponent(owner)}/${encodeURIComponent(id)}`, { ...jsonBody({ new_name: name }), feat: "tts" });
  forgetVoices();
  return ok({ voiceId: j.voice_id });
}

// ---- lồng tiếng và Studio (chạy lâu ở ElevenLabs: tạo xong thì hỏi lại trạng thái) ----
async function dub(u: UserRow, form: FormData) {
  const p = await need("dub");
  const f = await file(form, "file");
  const url = str(form.get("url"), 2000);
  const target = str(form.get("target"), 10);
  if (!f && !url) throw new SpeechErr("Chọn video / âm thanh hoặc dán liên kết.");
  if (!target) throw new SpeechErr("Chọn ngôn ngữ muốn lồng tiếng sang.");
  const fd = new FormData();
  if (f) fd.set("file", f, f.name); else fd.set("source_url", url);
  fd.set("target_lang", target);
  fd.set("source_lang", str(form.get("source"), 10) || "auto");
  const ns = Number(form.get("speakers"));
  fd.set("num_speakers", String(ns >= 1 && ns <= 32 ? Math.floor(ns) : 0));
  // Gói chưa có lồng tiếng không watermark thì luôn gắn watermark (ElevenLabs bắt buộc).
  fd.set("watermark", String(!p.features.dubClean || bool(form.get("watermark"), true)));
  fd.set("drop_background_audio", String(!bool(form.get("keepBackground"), true)));
  // Tùy chọn nâng cao: độ phân giải cao nhất, dùng giọng thư viện thay vì nhân bản giọng gốc, cắt đoạn (giây).
  if (bool(form.get("hd"))) fd.set("highest_resolution", "true");
  if (bool(form.get("noClone"))) fd.set("disable_voice_cloning", "true");
  const st = num(form.get("start"), 0, 86400, 0), en = num(form.get("end"), 0, 86400, 0);
  if (st > 0) fd.set("start_time", String(Math.floor(st)));
  if (en > st) fd.set("end_time", String(Math.floor(en)));
  const name = f?.name ?? url.replace(/^https?:\/\//, "").slice(0, 80);
  fd.set("name", name.slice(0, 100));
  const j = await elJson<{ dubbing_id: string; expected_duration_sec?: number }>("/v1/dubbing", { method: "POST", body: fd, feat: "dub", timeout: 290_000 });
  const item = saveItem(u, "dub", name, { dubbingId: j.dubbing_id, target, targetName: langName(target), status: "dubbing", expected: j.expected_duration_sec ?? null, video: !!f?.type.startsWith("video") || /youtu|tiktok|vimeo|\.mp4/i.test(url) });
  return ok({ item });
}
async function dubStatus(u: UserRow, id: string) {
  const it = getItem(u, id);
  if (!it || it.kind !== "dub") throw new SpeechErr("Không tìm thấy dự án lồng tiếng.", 404);
  const m = it.meta as { dubbingId: string; target: string; status: string };
  if (m.status === "dubbed" && it.url) return Response.json({ item: it });
  const j = await elJson<{ status: string; error?: string | null; media_metadata?: { duration?: number } | null }>(`/v1/dubbing/${encodeURIComponent(m.dubbingId)}`, { feat: "dub" });
  if (j.status === "dubbed") {
    const r = await el(`/v1/dubbing/${encodeURIComponent(m.dubbingId)}/audio/${encodeURIComponent(m.target)}`, { feat: "dub", timeout: 290_000 });
    const a = await audioOf(r);
    return Response.json({ item: updateItem(u, id, { meta: { status: "dubbed", duration: j.media_metadata?.duration ?? null }, file: a }) });
  }
  return Response.json({ item: updateItem(u, id, { meta: { status: j.status === "failed" ? "failed" : "dubbing", error: j.error ?? null } }) });
}
async function podcast(u: UserRow, b: Record<string, unknown>) {
  const p = await need("podcast");
  const src = b.source as { type?: string; text?: string; url?: string } | undefined;
  const source = src?.type === "url" ? { type: "url", url: str(src.url, 2000) } : { type: "text", text: str(src?.text, 100_000) };
  if (!("url" in source ? source.url : source.text)) throw new SpeechErr("Thêm nội dung nguồn cho podcast.");
  const host = str(b.host, 40), guest = str(b.guest, 40);
  if (!host || (b.mode !== "bulletin" && !guest)) throw new SpeechErr("Chọn giọng người dẫn" + (b.mode !== "bulletin" ? " và khách mời." : "."));
  const mode = b.mode === "bulletin" ? { type: "bulletin", bulletin: { host_voice_id: host } } : { type: "conversation", conversation: { host_voice_id: host, guest_voice_id: guest } };
  const model = p.tts.find((m) => m.id === "eleven_v3") ?? p.tts.find((m) => /multilingual/.test(m.id)) ?? p.tts[0];
  const j = await elJson<{ project: { project_id: string; name?: string } }>("/v1/studio/podcasts", {
    ...jsonBody({ model_id: model?.id, mode, source, duration_scale: ["short", "long"].includes(String(b.length)) ? b.length : "default", ...(str(b.lang, 8) ? { language: str(b.lang, 8) } : {}), ...(str(b.focus, 1000) ? { instructions_prompt: str(b.focus, 1000) } : {}) }),
    feat: "podcast", timeout: 120_000,
  });
  const item = saveItem(u, "podcast", j.project.name || titleOf("url" in source ? String(source.url) : String(source.text)), { projectId: j.project.project_id, status: "converting" });
  return ok({ item });
}
async function book(u: UserRow, form: FormData) {
  const p = await need("book");
  const f = await file(form, "file");
  const voice = str(form.get("voice"), 40);
  if (!f) throw new SpeechErr("Chọn tệp sách (EPUB, PDF, DOCX, TXT, HTML).");
  if (!voice) throw new SpeechErr("Chọn giọng người đọc.");
  const model = p.tts.find((m) => m.id === "eleven_multilingual_v2") ?? p.tts[0];
  const fd = new FormData();
  fd.set("name", f.name.replace(/\.[^.]+$/, "").slice(0, 100));
  fd.set("default_model_id", model?.id ?? "eleven_multilingual_v2");
  fd.set("default_title_voice_id", voice); fd.set("default_paragraph_voice_id", voice);
  fd.set("from_document", f, f.name);
  fd.set("auto_convert", "true");
  fd.set("quality_preset", ["standard", "high", "ultra", "ultra_lossless"].includes(String(form.get("quality"))) ? String(form.get("quality")) : "high");
  const j = await elJson<{ project: { project_id: string; name?: string } }>("/v1/studio/projects", { method: "POST", body: fd, feat: "book", timeout: 290_000 });
  const item = saveItem(u, "book", j.project.name || f.name, { projectId: j.project.project_id, status: "converting", voice });
  return ok({ item });
}
async function projectStatus(u: UserRow, id: string) {
  const it = getItem(u, id);
  if (!it || !["podcast", "book"].includes(it.kind)) throw new SpeechErr("Không tìm thấy dự án.", 404);
  const m = it.meta as { projectId: string; status: string };
  if (m.status === "done" && it.url) return Response.json({ item: it });
  const feat: Feat = it.kind === "book" ? "book" : "podcast";
  const pid = encodeURIComponent(m.projectId);
  const j = await elJson<{ state?: string; can_be_downloaded?: boolean; chapters?: { name: string; state?: string }[] }>(`/v1/studio/projects/${pid}`, { feat });
  const snaps = await elJson<{ snapshots: { project_snapshot_id: string }[] }>(`/v1/studio/projects/${pid}/snapshots`, { feat }).catch(() => ({ snapshots: [] }));
  const chapters = (j.chapters ?? []).map((c) => ({ name: c.name, state: c.state ?? "" }));
  if (snaps.snapshots.length && j.state !== "converting") {
    const r = await el(`/v1/studio/projects/${pid}/snapshots/${encodeURIComponent(snaps.snapshots[0].project_snapshot_id)}/stream`, { ...jsonBody({ convert_to_mpeg: true }), feat, timeout: 290_000 });
    return Response.json({ item: updateItem(u, id, { meta: { status: "done", chapters }, file: await audioOf(r) }) });
  }
  return Response.json({ item: updateItem(u, id, { meta: { status: j.state === "failed" ? "failed" : "converting", chapters } }) });
}

// ---- từ điển phát âm ----
// Quy tắc: thay một từ bằng cách đọc khác (alias, ví dụ "AI" → "ây ai") hoặc phiên âm IPA / CMU (phoneme, chỉ một số model hỗ trợ).
type Rule = { string_to_replace: string; type: "alias" | "phoneme"; alias?: string; phoneme?: string; alphabet?: string; case_sensitive?: boolean; word_boundaries?: boolean };
const ruleOut = (r: Rule) => ({ word: r.string_to_replace, type: r.type, say: (r.type === "alias" ? r.alias : r.phoneme) ?? "", alphabet: r.alphabet ?? "", cs: r.case_sensitive ?? false });
function rulesIn(v: unknown): Rule[] {
  const out: Rule[] = [];
  for (const x of (Array.isArray(v) ? v : []).slice(0, 1000) as { word?: unknown; type?: unknown; say?: unknown; alphabet?: unknown; cs?: unknown }[]) {
    const word = str(x.word, 100), say = str(x.say, 200);
    if (!word || !say) continue;
    if (x.type === "phoneme") out.push({ string_to_replace: word, type: "phoneme", phoneme: say, alphabet: x.alphabet === "cmu-arpabet" ? "cmu-arpabet" : "ipa", case_sensitive: bool(x.cs, false) });
    else out.push({ string_to_replace: word, type: "alias", alias: say, case_sensitive: bool(x.cs, false) });
  }
  return out;
}
type DictRes = { id: string; name?: string; version_id: string; version_rules_num: number };
async function dictCreate(b: Record<string, unknown>) {
  await need("dict");
  const name = str(b.name, 100), rules = rulesIn(b.rules);
  if (!name) throw new SpeechErr("Đặt tên cho từ điển.");
  if (!rules.length) throw new SpeechErr("Thêm ít nhất một quy tắc: từ cần đọc và cách đọc.");
  const j = await elJson<DictRes>("/v1/pronunciation-dictionaries/add-from-rules", { ...jsonBody({ name, description: str(b.desc, 500) || null, rules }), feat: "dict" });
  return Response.json({ dict: { id: j.id, name, desc: str(b.desc, 500), version: j.version_id, count: j.version_rules_num, rules: rules.map(ruleOut) } });
}
async function dictRules(b: Record<string, unknown>) {
  await need("dict");
  const id = str(b.id, 60), rules = rulesIn(b.rules);
  if (!id) throw new SpeechErr("Thiếu từ điển.");
  const j = await elJson<DictRes>(`/v1/pronunciation-dictionaries/${encodeURIComponent(id)}/set-rules`, { ...jsonBody({ rules }), feat: "dict" });
  return Response.json({ dict: { id, version: j.version_id, count: j.version_rules_num, rules: rules.map(ruleOut) } });
}
async function dictArchive(b: Record<string, unknown>) {
  await need("dict");
  const id = str(b.id, 60);
  if (!id) throw new SpeechErr("Thiếu từ điển.");
  await el(`/v1/pronunciation-dictionaries/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ archived: true }), feat: "dict" });
  return Response.json({ ok: true });
}

// ---- Audio Native: trình phát nhúng vào trang web, tự đọc bài viết cho người xem ----
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
async function native(u: UserRow, b: Record<string, unknown>) {
  await need("native");
  const title = str(b.title, 200), text = str(b.text, 200_000);
  if (!text) throw new SpeechErr("Dán nội dung bài viết cần đọc.");
  // Định dạng HTML ElevenLabs yêu cầu: <html><body><div> các đoạn <p> </div></body></html>.
  const html = `<html><body><div>${text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("")}</div></body></html>`;
  const fd = new FormData();
  fd.set("name", (title || titleOf(text)).slice(0, 100));
  if (title) fd.set("title", title);
  const author = str(b.author, 100);
  if (author) fd.set("author", author);
  const voice = str(b.voice, 40);
  if (voice) fd.set("voice_id", voice);
  const model = str(b.model, 60);
  if (model) fd.set("model_id", model);
  for (const [k, f] of [["text_color", "textColor"], ["background_color", "bgColor"]] as const) { const c = str(b[f], 9); if (/^#[0-9a-f]{3,8}$/i.test(c)) fd.set(k, c); }
  fd.set("auto_convert", "true");
  fd.set("file", new Blob([html], { type: "text/html" }), "article.html");
  const j = await elJson<{ project_id: string; converting: boolean; html_snippet: string }>("/v1/audio-native", { method: "POST", body: fd, feat: "native", timeout: 120_000 });
  const item = saveItem(u, "native", title || titleOf(text), { projectId: j.project_id, snippet: j.html_snippet, status: j.converting ? "converting" : "ready", voice, voiceName: str(b.voiceName, 80), chars: text.length, preview: text.slice(0, 300) });
  return ok({ item });
}
async function nativeStatus(u: UserRow, id: string) {
  const it = getItem(u, id);
  if (!it || it.kind !== "native") throw new SpeechErr("Không tìm thấy trình phát Audio Native.", 404);
  const m = it.meta as { projectId: string; status: string };
  if (m.status === "ready") return Response.json({ item: it });
  const j = await elJson<{ enabled: boolean; settings?: { status?: string; audio_url?: string | null } | null }>(`/v1/audio-native/${encodeURIComponent(m.projectId)}/settings`, { feat: "native" });
  const st = String(j.settings?.status ?? "").toLowerCase();
  const ready = !!j.settings?.audio_url || /ready|done|complete|converted/.test(st);
  return Response.json({ item: updateItem(u, id, { meta: { status: /fail|error/.test(st) ? "failed" : ready ? "ready" : "converting", audioUrl: j.settings?.audio_url ?? null } }) });
}

// ---- đoạn văn đọc khi ghi âm mẫu nhân bản giọng ----
// Như ElevenLabs: mỗi lần ghi âm, người dùng đọc to một đoạn văn mới (đủ thanh điệu, âm, nhịp, cảm xúc nhẹ) để mẫu giọng phong phú.
// AI viết đoạn mới theo chủ đề ngẫu nhiên; chưa có model hoặc lỗi thì lấy đoạn có sẵn.
const SCRIPT_TOPICS = ["một buổi sáng ở chợ quê", "chuyến du lịch biển đáng nhớ", "cách nấu một món ăn gia đình", "kỷ niệm ngày đầu đi học", "một cuốn sách yêu thích", "dự báo thời tiết cuối tuần",
  "giới thiệu một sản phẩm công nghệ", "lời chúc mừng sinh nhật bạn thân", "câu chuyện về chú chó nhỏ", "hướng dẫn trồng cây trong chậu", "một trận bóng đá kịch tính", "lời chào khách đến thăm thành phố"];
const SCRIPT_BANK: Record<"vi" | "en", string[]> = {
  vi: [
    "Sáng nay trời trong xanh, gió nhẹ thổi qua hàng cây trước nhà. Tôi pha một tách cà phê, mở cửa sổ và nghe tiếng chim ríu rít. Bạn có bao giờ để ý rằng những buổi sáng yên tĩnh như thế này giúp mình suy nghĩ rõ ràng hơn không? Hôm nay tôi có ba việc cần làm: gọi điện cho mẹ, đi chợ mua rau, và viết xong bản kế hoạch còn dang dở. Nghe thì đơn giản, nhưng nếu không sắp xếp thời gian hợp lý, mọi thứ sẽ rối tung lên ngay. Thôi, bắt đầu thôi nào!",
    "Chào mừng các bạn đến với chương trình hôm nay! Chúng ta sẽ cùng khám phá một vùng đất tuyệt đẹp ở miền Trung, nơi có biển xanh, cát trắng và những món ăn khiến ai cũng phải nhớ mãi. Buổi sáng, bạn có thể dạo bộ dọc bờ biển, ngắm thuyền đánh cá trở về. Buổi trưa, hãy thử một tô mì Quảng nóng hổi. Và khi hoàng hôn buông xuống, đừng quên ngồi lại bên những người bạn, kể cho nhau nghe một câu chuyện thật vui. Còn chần chừ gì nữa, lên đường thôi!",
    "Ông tôi thường kể rằng, ngày xưa làng mình chỉ có một con đường đất nhỏ chạy ven sông. Mỗi mùa nước lên, cả làng lại cùng nhau đắp đê, người khiêng đất, người nấu cơm, tiếng cười nói vang cả một vùng. Có năm nước lớn quá, đến tận nửa đêm mọi người vẫn chưa nghỉ. Thế mà sáng hôm sau, ai nấy vẫn tươi cười chào nhau. Mỗi lần nghe kể, tôi lại tự hỏi: điều gì đã giúp họ vững vàng đến vậy? Có lẽ chính là tình làng nghĩa xóm.",
    "Xin chào, tôi là trợ lý ảo của cửa hàng. Hôm nay chúng tôi có chương trình ưu đãi đặc biệt: giảm hai mươi phần trăm cho tất cả sản phẩm trong tuần lễ vàng, từ thứ hai đến chủ nhật. Nếu bạn đặt hàng trước mười giờ sáng, đơn hàng sẽ được giao ngay trong ngày. Bạn cần tư vấn thêm về kích cỡ, màu sắc hay cách thanh toán? Đừng ngại, hãy nhắn cho chúng tôi bất cứ lúc nào. Cảm ơn bạn đã tin tưởng và đồng hành cùng chúng tôi!",
  ],
  en: [
    "This morning the sky was clear and a light breeze moved through the trees outside my window. I made a cup of coffee, opened the curtains and listened to the birds. Have you ever noticed how quiet mornings help you think more clearly? Today I have three things to do: call my mother, pick up some groceries, and finally finish the plan I started last week. It sounds simple, but without a little planning, everything quickly falls apart. Well, let's get started!",
    "Welcome to today's show! We're exploring a beautiful stretch of coastline, with turquoise water, white sand and food you'll remember for years. In the morning, take a slow walk along the beach and watch the fishing boats come home. At lunch, try a steaming bowl of noodles from a small family stall. And when the sun goes down, sit with friends and share a story or two. So what are you waiting for? Pack your bags and let's go!",
    "My grandfather used to say that our village once had just one narrow dirt road along the river. Every flood season, everyone worked together to build up the banks: some carried soil, others cooked rice, and the laughter could be heard for miles. One year the water rose so high that nobody rested until midnight. Yet the next morning, they all greeted each other with a smile. Whenever I hear that story, I wonder: what made them so strong? Maybe it was simply each other.",
  ],
};
async function script(u: UserRow, b: Record<string, unknown>) {
  const lang = str(b.lang, 8) === "en" ? "en" : "vi";
  const avoid = str(b.avoid, 3000);
  const bank = () => { const list = SCRIPT_BANK[lang].filter((t) => t !== avoid); return list[Math.floor(Math.random() * list.length)]; };
  let ai = true;
  try { limit("script:" + u.id, 60, 60 * 60_000); } catch { ai = false; }
  if (ai) {
    const topic = SCRIPT_TOPICS[Math.floor(Math.random() * SCRIPT_TOPICS.length)];
    const system = lang === "en"
      ? "Write one natural English paragraph of 110 to 150 words for someone to read aloud while recording a voice sample. Use varied sentence lengths, one question, one exclamation, a number, and everyday words with a wide range of sounds. Output only the paragraph: no title, no quotes, no markdown, no brackets."
      : "Viết một đoạn văn tiếng Việt tự nhiên dài 110 đến 150 từ để người dùng đọc to khi ghi âm mẫu giọng. Câu dài ngắn xen kẽ, có một câu hỏi, một câu cảm thán, một con số viết bằng chữ, dùng từ ngữ đời thường có đủ các thanh điệu và vần. Chỉ trả về đoạn văn: không tiêu đề, không dấu ngoặc kép bao quanh, không markdown, không ngoặc vuông.";
    try {
      const { text } = await quickCall(u, system, lang === "en" ? `Topic: ${topic}` : `Chủ đề: ${topic}`, { maxTokens: 600 });
      // Chỉ nhận một đoạn văn thuần: có định dạng Markdown, danh sách hay nhiều đoạn thì dùng đoạn có sẵn.
      if (/\*\*|^#|\n\s*(?:\d+[.)]|[-*•])\s|\n\s*\n/m.test(text.trim())) throw new Error("not a paragraph");
      const t = text.replace(/^[\s"“”'#*]+|[\s"“”'*]+$/g, "").replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
      if (t.length >= 160 && t.length <= 1600) return Response.json({ text: t, source: "ai" });
    } catch {}
  }
  return Response.json({ text: bank(), source: "bank" });
}

// ---- trò chuyện giọng nói ----
async function agentSession(u: UserRow, b: Record<string, unknown>) {
  const p = await need("agent");
  try { limit("voice:" + u.id, 30, 60 * 60_000); } catch { throw new SpeechErr("Bạn đã mở quá nhiều cuộc gọi thử. Hãy thử lại sau.", 429); }
  // Khóa chưa có quyền Realtime (convai_write) hoặc gói hết phút Realtime: trình duyệt gọi bằng chế độ nối tiếp
  // (Scribe nghe → model chat trả lời → giọng ElevenLabs đọc), vẫn là giọng AI thật.
  if (!p.realtime) return Response.json({ cascade: true });
  const instructions = [str(b.prompt, 8000) || "Bạn là trợ lý giọng nói thân thiện.", "Đây là hội thoại bằng giọng nói: trả lời tự nhiên như người thật, câu ngắn; không dùng Markdown, danh sách hay ký hiệu."].join("\n\n");
  try {
    const s = await mintRealtime({ model: str(b.model, 40), voice: str(b.voice, 40), instructions, language: str(b.lang, 8) || undefined,
      eagerness: (["low", "medium", "high"] as const).find((x) => x === b.eagerness) ?? "medium", interrupt: bool(b.interrupt, true), maxSeconds: num(b.maxMin, 1, 60, 10) * 60 });
    return Response.json(s);
  } catch (e) {
    const err = e as SpeechErr;
    if (err.code === "key" || err.code === "net" || err.code === "no_key") throw e;
    return Response.json({ cascade: true });
  }
}

// Thao tác tốn credit của ElevenLabs. Số là ước lượng credit cho thao tác hãng không báo chi phí trong header (spent() tính phần còn lại theo số thật).
const BUDGET_EST: Record<string, number> = { tts: 0, dialogue: 0, speak: 0, sfx: 0, music: 0, "music/video": 0, "music/stems": 0, isolate: 0, changer: 0, align: 0, stt: 300, "live/token": 300, "agent/session": 1000, dub: 3000, podcast: 3000, book: 3000, native: 1000, design: 300, remix: 300 };

async function POSTop(req: Request, u: UserRow, op: string[]) {
  const key = op.join("/");
  const est = BUDGET_EST[key];
  if (est !== undefined) checkBudget(u);
  const res = await POSTrun(req, u, op);
  if (est && res.ok) addSpend(u.id, est);
  return res;
}
async function POSTrun(req: Request, u: UserRow, op: string[]) {
  const key = op.join("/");
  const isForm = (req.headers.get("content-type") ?? "").includes("multipart/form-data");
  const form = isForm ? await req.formData().catch(() => { throw new SpeechErr("Không đọc được tệp tải lên (tệp quá lớn hoặc bị ngắt giữa chừng)."); }) : null;
  const b = isForm ? {} : ((await req.json().catch(() => ({}))) as Record<string, unknown>);
  await gateVoices(u, voiceIds(b, form));
  if (/^(ivc|voices\/save|pvc\/create)$/.test(key) && !isAdmin(u) && ownedVoices(u.id) >= MAX_OWN_VOICES) throw new SpeechErr(`Mỗi tài khoản giữ tối đa ${MAX_OWN_VOICES} giọng riêng. Hãy xóa bớt một giọng rồi tạo lại.`, 403);
  if (key !== "speak" && key !== "live/token") { try { limit("speech:" + u.id, 120, 10 * 60_000); } catch { throw new SpeechErr("Bạn tạo quá nhiều trong thời gian ngắn. Thử lại sau ít phút.", 429); } }
  else { try { limit("speak:" + u.id, 400, 10 * 60_000); } catch { throw new SpeechErr("Đọc to quá nhiều lần trong thời gian ngắn.", 429); } }
  switch (key) {
    case "tts": return tts(u, b);
    case "dialogue": return dialogue(u, b);
    case "speak": return speak(u, b);
    case "stt": return stt(u, form ?? new FormData());
    case "sfx": return sfx(u, b);
    case "music": return music(u, b);
    case "isolate": return isolate(u, form ?? new FormData());
    case "changer": return changer(u, form ?? new FormData());
    case "align": return align(u, form ?? new FormData());
    case "design": return design(b);
    case "remix": return remix(b);
    case "voices/save": return saveDesigned(b);
    case "voices/add": return addLibrary(b);
    case "voices/owner": return assignVoice(u, b);
    case "ivc": return ivc(form ?? new FormData());
    case "pvc/create": return pvc(b, "create");
    case "pvc/samples": case "pvc/verify": case "pvc/train": return pvc(form ?? new FormData(), op[1]);
    case "dub": return dub(u, form ?? new FormData());
    case "podcast": return podcast(u, b);
    case "book": return book(u, form ?? new FormData());
    case "live/token": await need("live"); return Response.json(await scribeToken());
    case "live/save": {
      // Lưu bản chép lời trực tiếp hoặc lời thoại của cuộc gọi thử Voice Agent vào lịch sử.
      const kind = b.kind === "call" ? "call" : "live";
      const lines = (Array.isArray(b.lines) ? b.lines : []).map((l: { who?: unknown; text?: unknown }) => ({ who: str(l.who, 20), text: str(l.text, 4000) })).filter((l) => l.text).slice(0, 2000);
      if (!lines.length) throw new SpeechErr("Chưa có lời nào để lưu.");
      const text = lines.map((l) => l.text).join(kind === "call" ? "\n" : " ");
      const item = saveItem(u, kind, str(b.title, 120) || titleOf(text), { lines: lines.length, preview: text.slice(0, 300), seconds: num(b.seconds, 0, 86400, 0), lang: str(b.lang, 8) });
      sideWrite(u, item.id, { text, lines });
      return Response.json({ item });
    }
    case "agent/session": return agentSession(u, b);
    case "music/video": return videoMusic(u, form ?? new FormData());
    case "music/stems": return stems(u, form ?? new FormData());
    case "dicts": return dictCreate(b);
    case "dicts/rules": return dictRules(b);
    case "dicts/archive": return dictArchive(b);
    case "native": return native(u, b);
    case "script": return script(u, b);
  }
  throw new SpeechErr("Không có thao tác này.", 404);
}

async function run(req: Request, ctx: Ctx, method: "GET" | "POST" | "DELETE") {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  if (method !== "GET") { try { sameOrigin(req); } catch { return Response.json({ error: "Yêu cầu không hợp lệ." }, { status: 403 }); } }
  if (!can(c.user, "speech")) return Response.json({ error: verifyLocked(c.user) ? VERIFY_FIRST : "Quản trị viên chưa cho phép tài khoản của bạn dùng Speech." }, { status: 403 });
  const { op } = await ctx.params;
  try {
    if (method === "GET") return await GETop(req, c.user, op.join("/"));
    if (method === "POST") return await spender.run(c.user.id, () => POSTop(req, c.user, op));
    const q = new URL(req.url).searchParams;
    if (op[0] === "items") return Response.json({ ok: deleteItem(c.user, q.get("id") ?? "") });
    if (op[0] === "voices") {
      // Giọng nằm trong tài khoản ElevenLabs dùng chung: người tạo xóa được giọng của mình, còn lại chỉ quản trị viên.
      const vid = q.get("id") ?? "";
      if (!isAdmin(c.user) && voiceOwner(vid) !== c.user.id) return Response.json({ error: "Bạn chỉ xóa được giọng do chính mình tạo." }, { status: 403 });
      await el(`/v1/voices/${encodeURIComponent(vid)}`, { method: "DELETE" });
      forgetVoiceOwner(vid);
      forgetVoices();
      return ok({ ok: true });
    }
    return Response.json({ error: "Không có thao tác này." }, { status: 404 });
  } catch (e) {
    if (e instanceof SpeechErr) return Response.json({ error: e.message, code: e.code }, { status: e.status });
    console.error("[speech]", op.join("/"), e);
    return Response.json({ error: "Lỗi máy chủ khi xử lý âm thanh. Thử lại sau." }, { status: 500 });
  }
}
export const GET = (req: Request, ctx: Ctx) => run(req, ctx, "GET");
export const POST = (req: Request, ctx: Ctx) => run(req, ctx, "POST");
export const DELETE = (req: Request, ctx: Ctx) => run(req, ctx, "DELETE");
