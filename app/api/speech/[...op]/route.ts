import fs from "node:fs";
import { Readable } from "node:stream";
import { can, current, isAdmin, limit, sameOrigin, type UserRow } from "../../../authstore";
import {
  SpeechErr, audioOf, deleteItem, el, elJson, getItem, itemFile, jsonBody, langName, library, listItems, mintRealtime, myVoices, need, plan, saveItem,
  scribeToken, sideRead, sideWrite, spent, updateItem, voiceOut, type Feat, type Plan,
} from "../../../speechapi";

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
const voiceCache = { at: 0, list: [] as Awaited<ReturnType<typeof myVoices>> };
async function voices(fresh = false) {
  if (fresh || Date.now() - voiceCache.at > 10 * 60_000 || !voiceCache.list.length) { voiceCache.list = await myVoices(); voiceCache.at = Date.now(); }
  return voiceCache.list;
}
const forgetVoices = () => { voiceCache.at = 0; };
/** Giọng dùng được qua API với gói hiện tại (gói Free: bỏ giọng lấy từ Thư viện). */
async function usableVoices() {
  const [p, list] = await Promise.all([plan(), voices().catch(() => [] as Awaited<ReturnType<typeof voices>>)]);
  return p.library ? list : list.filter((v) => !v.lib);
}
// Ngôn ngữ của văn bản theo chữ viết (đủ để chọn giọng; model đa ngôn ngữ tự đọc đúng mọi ngôn ngữ nó hỗ trợ).
function textLang(t: string) {
  if (/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(t)) return "vi";
  if (/[\u3040-\u30ff]/.test(t)) return "ja";
  if (/[\uac00-\ud7af]/.test(t)) return "ko";
  if (/[\u4e00-\u9fff]/.test(t)) return "zh";
  if (/[\u0e00-\u0e7f]/.test(t)) return "th";
  if (/[\u0400-\u04ff]/.test(t)) return "ru";
  return "en";
}
// Giọng có sẵn nghe tự nhiên ở nhiều ngôn ngữ (model đa ngôn ngữ), dùng khi tài khoản không có giọng riêng cho ngôn ngữ đó.
const PREFER = ["Sarah", "Jessica", "Alice", "Matilda", "Laura", "George", "Brian"];
// Giọng đọc: giọng người dùng chọn nếu dùng được với gói; không thì giọng cùng ngôn ngữ với văn bản, rồi giọng có sẵn ưu tiên.
async function pickVoice(text: string, want?: string) {
  const list = await usableVoices();
  const p = await plan();
  if (want && (p.library || list.some((v) => v.id === want) || !(await voices().catch(() => [])).some((v) => v.id === want && v.lib))) return want;
  const lang = textLang(text);
  const byName = (n: string) => list.find((v) => v.category === "premade" && v.name.toLowerCase() === n.toLowerCase());
  return list.find((v) => v.langCode.toLowerCase().startsWith(lang) && v.category !== "premade")?.id
    ?? list.find((v) => v.langCode.toLowerCase().startsWith(lang))?.id
    ?? PREFER.map(byName).find(Boolean)?.id ?? list.find((v) => v.category === "premade")?.id ?? list[0]?.id ?? "JBFqnCBsd6RMkjVDRZzb";
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
    if (q.get("id")) { const v = await elJson<Parameters<typeof voiceOut>[0] & { fine_tuning?: unknown }>(`/v1/voices/${encodeURIComponent(q.get("id")!)}`); return Response.json({ voice: voiceOut(v), fineTuning: v.fine_tuning ?? null }); }
    const p = await plan();
    // Gói Free: giọng lấy từ Thư viện không dùng được qua API nên không hiện.
    const list = (await voices(q.get("fresh") === "1")).filter((v) => p.library || !v.lib);
    const s = str(q.get("q"), 80).toLowerCase();
    return Response.json({ voices: s ? list.filter((v) => `${v.name} ${v.desc} ${v.lang} ${v.accent} ${v.use}`.toLowerCase().includes(s)) : list });
  }
  if (op === "items") {
    if (q.get("id")) { const it = getItem(u, q.get("id")!); if (!it) throw new SpeechErr("Không tìm thấy mục này.", 404); return Response.json({ item: it, data: sideRead(u, it.id) }); }
    const kinds = str(q.get("kinds"), 200).split(",").filter(Boolean);
    return Response.json({ items: listItems(u, kinds, num(q.get("limit"), 1, 100, 40), num(q.get("before"), 0, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)) });
  }
  if (op === "file") return sendFile(req, u, q.get("id") ?? "", q.get("dl") === "1");
  if (op === "dub") return dubStatus(u, q.get("id") ?? "");
  if (op === "project") return projectStatus(u, q.get("id") ?? "");
  if (op === "pvc") {
    await need("pvc");
    const voice = str(q.get("voice"), 40);
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
  const voice = await pickVoice(text, str(b.voice, 40));
  const fmt = await fmtFor(b.format);
  const q = new URLSearchParams({ output_format: fmt });
  const body: Record<string, unknown> = { text, model_id: model.id, voice_settings: settingsOf(b), apply_text_normalization: ["on", "off"].includes(String(b.normalize)) ? b.normalize : "auto" };
  const lang = str(b.lang, 8);
  if (lang) body.language_code = lang;
  if (b.seed !== undefined && b.seed !== "" && Number.isFinite(Number(b.seed))) body.seed = Math.floor(Number(b.seed)) % 4294967295;
  const r = await el(`/v1/text-to-speech/${encodeURIComponent(voice)}?${q}`, { ...jsonBody(body), feat: "tts" });
  const cost = spent(r);
  const a = await audioOf(r, fmt);
  const item = saveItem(u, "tts", titleOf(text), { text: text.slice(0, 5000), voice, voiceName: str(b.voiceName, 80), model: model.id, modelName: model.name, format: fmt, chars: text.length, cost, settings: body.voice_settings, lang }, a);
  return ok({ item });
}
async function dialogue(u: UserRow, b: Record<string, unknown>) {
  const p = await need("dialogue");
  const lines = (Array.isArray(b.lines) ? b.lines : []).map((l: { text?: unknown; voice?: unknown; name?: unknown }) => ({ text: str(l.text, 5000), voice_id: str(l.voice, 40), name: str(l.name, 60) })).filter((l) => l.text && l.voice_id).slice(0, 200);
  if (!lines.length) throw new SpeechErr("Thêm ít nhất một lời thoại và chọn giọng cho người nói.");
  const model = p.tts.find((m) => m.id === b.model && /v3|v4/.test(m.id)) ?? p.tts.find((m) => m.id === "eleven_v3") ?? p.tts.find((m) => /v3|v4/.test(m.id));
  if (!model) throw new SpeechErr("Hội thoại nhiều giọng cần model Eleven v3 hoặc v4, khóa này chưa có.");
  const fmt = await fmtFor(b.format);
  const r = await el(`/v1/text-to-dialogue?output_format=${fmt}`, { ...jsonBody({ inputs: lines.map(({ text, voice_id }) => ({ text, voice_id })), model_id: model.id, ...(str(b.lang, 8) ? { language_code: str(b.lang, 8) } : {}) }), feat: "dialogue", timeout: 240_000 });
  const cost = spent(r);
  const a = await audioOf(r, fmt);
  const chars = lines.reduce((n, l) => n + l.text.length, 0);
  const item = saveItem(u, "dialogue", titleOf(lines.map((l) => l.text).join(" ")), { lines, model: model.id, modelName: model.name, format: fmt, chars, cost, speakers: [...new Set(lines.map((l) => l.name || l.voice_id))] }, a);
  return ok({ item });
}
// Đọc to trong khung chat và chế độ giọng nói: model nhanh nhất, phát dần khi âm thanh còn đang tạo, không lưu vào lịch sử.
async function speak(b: Record<string, unknown>) {
  const p = await need("tts");
  const text = str(b.text, 5000).replace(/```[\s\S]*?(```|$)/g, " ").replace(/[*_#>`|]/g, "").replace(/\s+/g, " ").trim();
  if (!text) throw new SpeechErr("Không có nội dung để đọc.");
  const model = ["eleven_v4_turbo", "eleven_flash_v2_5", "eleven_turbo_v2_5"].map((id) => p.tts.find((m) => m.id === id)).find(Boolean) ?? p.tts[0];
  const voice = await pickVoice(text, str(b.voice, 40));
  const speed = num(b.speed, 0.7, 1.2, 1);
  const r = await el(`/v1/text-to-speech/${encodeURIComponent(voice)}/stream?output_format=mp3_44100_128&optimize_streaming_latency=2`, {
    ...jsonBody({ text: text.slice(0, model?.max ?? 5000), model_id: model?.id, voice_settings: { stability: 0.5, similarity_boost: 0.75, speed } }), feat: "tts",
  });
  spent(r);
  return new Response(r.body, { headers: { "content-type": r.headers.get("content-type") ?? "audio/mpeg", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
async function stt(u: UserRow, form: FormData) {
  await need("stt");
  const f = await file(form, "file");
  const url = str(form.get("url"), 2000);
  if (!f && !url) throw new SpeechErr("Chọn tệp âm thanh / video hoặc dán liên kết.");
  if (url && !/^https?:\/\//i.test(url)) throw new SpeechErr("Liên kết phải bắt đầu bằng http:// hoặc https://");
  const fd = new FormData();
  fd.set("model_id", "scribe_v2");
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
  if (bool(form.get("entities"))) fd.set("entity_detection", "all");
  if (bool(form.get("redact"))) { fd.set("entity_redaction", "all"); fd.set("entity_redaction_mode", "entity_type"); }
  try { for (const k of (JSON.parse(String(form.get("keyterms") ?? "[]")) as string[]).slice(0, 100)) if (typeof k === "string" && k.trim()) fd.append("keyterms", k.trim().slice(0, 49)); } catch {}
  const r = await el("/v1/speech-to-text", { method: "POST", body: fd, feat: "stt", timeout: 290_000 });
  const j = (await r.json()) as { language_code?: string; language_probability?: number; text: string; words?: { text: string; start?: number; end?: number; type: string; speaker_id?: string }[]; entities?: unknown[] };
  const words = (j.words ?? []).map((w) => ({ t: w.text, s: w.start ?? 0, e: w.end ?? 0, k: w.type === "spacing" ? 0 : w.type === "audio_event" ? 2 : 1, sp: w.speaker_id ?? "" }));
  const dur = words.length ? words[words.length - 1].e : 0;
  const speakers = [...new Set(words.map((w) => w.sp).filter(Boolean))];
  const name = f?.name ?? url.replace(/^https?:\/\//, "").slice(0, 80);
  const item = saveItem(u, "stt", name, { lang: j.language_code ?? "", langName: langName(j.language_code ?? ""), prob: j.language_probability ?? 0, dur, speakers, words: words.length, preview: j.text.slice(0, 300), source: f ? "file" : "url", url: f ? null : url },
    f && f.size <= MAX_UP ? { buf: Buffer.from(await f.arrayBuffer()), mime: f.type || "audio/mpeg", ext: (f.name.split(".").pop() || "mp3").toLowerCase().slice(0, 5) } : undefined);
  sideWrite(u, item.id, { text: j.text, words, entities: j.entities ?? [] });
  return ok({ item, data: { text: j.text, words, entities: j.entities ?? [] } });
}
async function sfx(u: UserRow, b: Record<string, unknown>) {
  await need("sfx");
  const text = str(b.text, 450);
  if (!text) throw new SpeechErr("Mô tả âm thanh cần tạo.");
  const body: Record<string, unknown> = { text, loop: bool(b.loop), prompt_influence: num(b.influence, 0, 1, 0.3), model_id: "eleven_text_to_sound_v2" };
  if (b.duration) body.duration_seconds = num(b.duration, 0.5, 30, 5);
  const r = await el("/v1/sound-generation?output_format=mp3_44100_128", { ...jsonBody(body), feat: "sfx" });
  const cost = spent(r);
  const item = saveItem(u, "sfx", titleOf(text), { text, loop: body.loop, duration: body.duration_seconds ?? null, influence: body.prompt_influence, cost }, await audioOf(r));
  return ok({ item });
}
async function music(u: UserRow, b: Record<string, unknown>) {
  await need("music");
  const prompt = str(b.prompt, 2000);
  if (!prompt) throw new SpeechErr("Mô tả bản nhạc bạn muốn.");
  const body: Record<string, unknown> = { prompt, force_instrumental: bool(b.instrumental) };
  if (b.seconds) body.music_length_ms = Math.round(num(b.seconds, 3, 300, 30) * 1000);
  const r = await el("/v1/music?output_format=mp3_44100_128", { ...jsonBody(body), feat: "music", timeout: 290_000 });
  const cost = spent(r);
  const item = saveItem(u, "music", titleOf(prompt), { prompt, seconds: body.music_length_ms ? Number(body.music_length_ms) / 1000 : null, instrumental: body.force_instrumental, cost }, await audioOf(r));
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
  fd.set("voice_settings", JSON.stringify({ stability: num(form.get("stability"), 0, 1, 0.5), similarity_boost: num(form.get("similarity"), 0, 1, 0.75) }));
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
  return ok({ voiceId: j.voice_id, verify: j.requires_verification });
}
async function pvc(b: Record<string, unknown> | FormData, action: string) {
  await need("pvc");
  if (action === "create") {
    const o = b as Record<string, unknown>;
    const j = await elJson<{ voice_id: string }>("/v1/voices/pvc", { ...jsonBody({ name: str(o.name, 60) || "Giọng chuyên sâu", language: str(o.lang, 8) || "vi", description: str(o.desc, 500) || null }), feat: "pvc" });
    forgetVoices();
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

async function POSTop(req: Request, u: UserRow, op: string[]) {
  const key = op.join("/");
  const isForm = (req.headers.get("content-type") ?? "").includes("multipart/form-data");
  const form = isForm ? await req.formData().catch(() => { throw new SpeechErr("Không đọc được tệp tải lên (tệp quá lớn hoặc bị ngắt giữa chừng)."); }) : null;
  const b = isForm ? {} : ((await req.json().catch(() => ({}))) as Record<string, unknown>);
  if (key !== "speak" && key !== "live/token") { try { limit("speech:" + u.id, 120, 10 * 60_000); } catch { throw new SpeechErr("Bạn tạo quá nhiều trong thời gian ngắn. Thử lại sau ít phút.", 429); } }
  else { try { limit("speak:" + u.id, 400, 10 * 60_000); } catch { throw new SpeechErr("Đọc to quá nhiều lần trong thời gian ngắn.", 429); } }
  switch (key) {
    case "tts": return tts(u, b);
    case "dialogue": return dialogue(u, b);
    case "speak": return speak(b);
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
  }
  throw new SpeechErr("Không có thao tác này.", 404);
}

async function run(req: Request, ctx: Ctx, method: "GET" | "POST" | "DELETE") {
  const c = current(req);
  if (!c) return Response.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  if (method !== "GET") { try { sameOrigin(req); } catch { return Response.json({ error: "Yêu cầu không hợp lệ." }, { status: 403 }); } }
  if (!can(c.user, "speech")) return Response.json({ error: "Quản trị viên chưa cho phép tài khoản của bạn dùng Speech." }, { status: 403 });
  const { op } = await ctx.params;
  try {
    if (method === "GET") return await GETop(req, c.user, op.join("/"));
    if (method === "POST") return await POSTop(req, c.user, op);
    const q = new URL(req.url).searchParams;
    if (op[0] === "items") return Response.json({ ok: deleteItem(c.user, q.get("id") ?? "") });
    if (op[0] === "voices") {
      // Giọng thuộc tài khoản ElevenLabs dùng chung: chỉ quản trị viên được xóa.
      if (!isAdmin(c.user)) return Response.json({ error: "Chỉ quản trị viên được xóa giọng khỏi tài khoản ElevenLabs." }, { status: 403 });
      await el(`/v1/voices/${encodeURIComponent(q.get("id") ?? "")}`, { method: "DELETE" });
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
