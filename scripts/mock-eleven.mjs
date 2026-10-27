// ElevenLabs giả lập cho npm run dev:mock: cùng đường dẫn, tham số, lỗi và giới hạn theo gói như API thật (đặc tả OpenAPI 10/2026),
// trả âm thanh WAV thật (tiếng ngân nhẹ theo nhịp âm tiết) để trình phát, tải xuống, dạng sóng đều chạy được.
// Đổi gói để thử giao diện theo gói: POST /_debug/el { tier: "free" | "starter" | "creator" | "pro", studio: true, lockMusic: true, used: 9990 }.
// Khóa giới hạn quyền như khóa thật: POST /_debug/el { noPerms: ["convai_write", "dubbing_write"] } (ElevenLabs kiểm tra quyền trước nội dung).
const TIER = {
  free: { chars: 10_000, voices: 3, pro: 0, ivc: false, pvc: false },
  starter: { chars: 30_000, voices: 10, pro: 0, ivc: true, pvc: false },
  creator: { chars: 121_000, voices: 30, pro: 1, ivc: true, pvc: true },
  pro: { chars: 600_000, voices: 160, pro: 1, ivc: true, pvc: true },
};
const MODELS = [
  ["eleven_v4", "Eleven v4", 94, 10_000, 1, true], ["eleven_v4_turbo", "Eleven v4 Turbo", 94, 10_000, 0.5, true], ["eleven_v3", "Eleven v3", 74, 5000, 1, true],
  ["eleven_multilingual_v2", "Eleven Multilingual v2", 29, 10_000, 1, true], ["eleven_flash_v2_5", "Eleven Flash v2.5", 32, 40_000, 0.5, true],
  ["eleven_multilingual_sts_v2", "Eleven Multilingual v2 (STS)", 29, 10_000, 1, false], ["eleven_english_sts_v2", "Eleven English v2 (STS)", 1, 5000, 1, false],
];
const PREMADE = [
  ["21m00Tcm4TlvDq8ikWAM", "Rachel - Calm narrator", "female", "young", "american", "narration", "en"], ["pNInz6obpgDQGcFmaJgB", "Adam - Deep, dominant", "male", "middle_aged", "american", "narration", "en"],
  ["EXAVITQu4vr4xnSDxMaL", "Sarah - Mature, reassuring", "female", "young", "american", "news", "en"], ["FGY2WhTYpPnrIDTdsKH5", "Laura - Enthusiast, quirky", "female", "young", "american", "social_media", "en"],
  ["CwhRBWXzGAHq8TQ4Fs17", "Roger - Laid-back, casual", "male", "middle_aged", "american", "conversational", "en"], ["foH7s9fX31wFFH2yqrFa", "Ngân - Ấm áp, kể chuyện", "female", "young", "northern", "narration", "vi"],
];
const LIB = [
  ["lib-vi-01", "owner-a", "Huyền", "female", "young", "northern", "conversational", "vi", "Trong trẻo, thân thiện", true, 12_400],
  ["lib-vi-02", "owner-b", "Minh Đức", "male", "middle_aged", "northern", "narration", "vi", "Trầm, đáng tin", true, 8_100],
  ["lib-vi-03", "owner-c", "Thảo Vy", "female", "young", "southern", "social_media", "vi", "Vui tươi, nói nhanh", true, 5_300],
  ["lib-vi-04", "owner-d", "Bác Ba", "male", "old", "central", "narration", "vi", "Ông kể chuyện miền Trung", false, 2_900],
  ["lib-en-01", "owner-e", "Brian", "male", "middle_aged", "american", "narration", "en", "Deep, resonant", true, 98_000],
  ["lib-en-02", "owner-f", "Alice", "female", "middle_aged", "british", "educational", "en", "Clear educator", true, 44_000],
  ["lib-ja-01", "owner-g", "Yuki", "female", "young", "tokyo", "characters", "ja", "Bright, anime", false, 21_000],
  ["lib-ko-01", "owner-h", "Jiwoo", "male", "young", "seoul", "conversational", "ko", "Soft, conversational", true, 9_700],
];
// Quyền của khóa theo đường dẫn (đúng tên quyền của ElevenLabs).
const PERMS = [
  [/^\/v1\/text-to-speech\//, "POST", "text_to_speech"], [/^\/v1\/text-to-dialogue/, "POST", "text_to_speech"], [/^\/v1\/speech-to-text$/, "POST", "speech_to_text"],
  [/^\/v1\/single-use-token\/realtime_scribe/, "POST", "speech_to_text"], [/^\/v1\/sound-generation/, "POST", "sound_generation"], [/^\/v1\/music/, "POST", "music_generation"],
  [/^\/v1\/audio-isolation/, "POST", "audio_isolation"], [/^\/v1\/speech-to-speech\//, "POST", "speech_to_speech"], [/^\/v1\/forced-alignment/, "POST", "forced_alignment"],
  [/^\/v1\/text-to-voice/, "POST", "voices_write"], [/^\/v1\/voices\/add/, "POST", "voices_write"], [/^\/v1\/dubbing/, "POST", "dubbing_write"],
  [/^\/v1\/pronunciation-dictionaries/, null, "pronunciation_dictionaries_write"], [/^\/v1\/audio-native/, null, "audio_native_write"],
];
// Hiệu ứng âm thanh (GET /v1/audio-effects/catalog) như API thật.
const FX = {
  filter_presets: [["old_radio", "Old Radio"], ["robot", "Robot"], ["cheap_microphone", "Cheap Microphone"], ["phone", "Phone"], ["low_quality_phone", "Low Quality Phone"], ["bright_phone", "Bright Phone"]].map(([filter_preset_id, name]) => ({ filter_preset_id, name, description: `${name} (giả lập)` })),
  environments: [["small_room", "Small Room"], ["big_room", "Big Room"], ["hall", "Hall"], ["tunnel", "Tunnel"], ["street", "Street"], ["valley", "Valley"], ["forest", "Forest"]].map(([environment_id, name]) => ({ environment_id, name, description: `${name} (giả lập)` })),
  background_noises: [["call_center", "Call center"], ["cafe", "Café"], ["city", "City"], ["keyboard", "Keyboard"]].map(([background_noise_id, name]) => ({ background_noise_id, name, description: `${name} (giả lập)` })),
};
// Kiểm tra audio_effects như API thật: ID lạ → 404 kèm tên trường; vang / lệch kênh với PCM / μ-law → 400.
function badEffects(res, fx, fmt) {
  if (!fx) return false;
  const chk = [["filter_preset_id", FX.filter_presets.map((x) => x.filter_preset_id)], ["environment_id", FX.environments.map((x) => x.environment_id)], ["background_noise_id", FX.background_noises.map((x) => x.background_noise_id)]];
  for (const [k, ids] of chk) if (fx[k] && !ids.includes(fx[k])) return err(res, 404, "not_found", `audio_effects.${k}: unknown id ${fx[k]}`);
  if ((fx.environment_id || fx.pan) && /^(pcm|ulaw|alaw)/.test(fmt)) return err(res, 400, "invalid", "Stereo effects are not supported for this output format.");
  return false;
}
export const EL = {
  cfg: { tier: "free", studio: false, lockMusic: false, noPerms: [] },
  used: 0, custom: [], dubs: new Map(), projects: new Map(), pvc: new Map(), calls: [], dicts: new Map(), natives: new Map(), last: {},
};
const t = () => TIER[EL.cfg.tier] ?? TIER.free;
const reset = () => { EL.used = 0; EL.custom = []; EL.dubs.clear(); EL.projects.clear(); EL.pvc.clear(); EL.calls = []; EL.dicts.clear(); EL.natives.clear(); EL.last = {}; };

// WAV 16 kHz mono: tiếng ngân có nhịp âm tiết, đủ để nghe thấy và vẽ dạng sóng.
export function wav(sec, seed = 1) {
  const rate = 16000, n = Math.max(1, Math.round(rate * Math.min(60, Math.max(0.3, sec)))), buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  const f0 = 150 + (seed % 7) * 18;
  for (let i = 0; i < n; i++) {
    const x = i / rate, syl = Math.max(0, Math.sin(x * Math.PI * 4.2 + seed)) ** 1.5, phrase = Math.min(1, Math.max(0, Math.sin(x * 0.9 + seed) + 0.6));
    const v = (Math.sin(2 * Math.PI * f0 * x) * 0.6 + Math.sin(2 * Math.PI * f0 * 2.01 * x) * 0.25 + Math.sin(2 * Math.PI * f0 * 3.02 * x) * 0.1) * syl * phrase;
    buf.writeInt16LE(Math.round(v * 9000), 44 + i * 2);
  }
  return buf;
}
const audio = (res, sec, seed, cost = 0) => { const b = wav(sec, seed); res.writeHead(200, { "content-type": "audio/wav", "content-length": b.length, ...(cost ? { "character-cost": String(cost) } : {}), "request-id": `req_${Math.random().toString(36).slice(2, 10)}` }); res.end(b); return true; };
const json = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); return true; };
const err = (res, code, status, message) => json(res, code, { detail: { status, message } });
const rid = (p) => `${p}${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 8)}`;
const voiceRaw = ([id, name, gender, age, accent, use, lang], cat = "premade") => ({
  voice_id: id, name, category: cat, labels: { gender, age, accent, use_case: use, language: lang, descriptive: name.split(" - ")[1] ?? "" }, description: name.split(" - ")[1] ?? null,
  preview_url: `http://127.0.0.1:4010/elevenlabs/_preview/${id}.wav`, available_for_tiers: [], settings: null, sharing: null, high_quality_base_model_ids: [], verified_languages: [{ language: lang, model_id: "eleven_v4", accent }],
  is_owner: cat !== "premade", is_legacy: false, is_mixed: false, created_at_unix: 1_700_000_000,
});
const allVoices = () => [...EL.custom, ...PREMADE.map((v) => voiceRaw(v))];
const findVoice = (id) => allVoices().find((v) => v.voice_id === id);
const libRaw = ([id, owner, name, gender, age, accent, use, lang, desc, free, uses]) => ({
  public_owner_id: owner, voice_id: id, date_unix: 1_700_000_000, name, accent, gender, age, descriptive: desc, use_case: use, category: "professional", language: lang, locale: null, description: desc,
  preview_url: `http://127.0.0.1:4010/elevenlabs/_preview/${id}.wav`, usage_character_count_1y: uses * 40, usage_character_count_7d: uses, cloned_by_count: uses, rate: 1, free_users_allowed: free,
  live_moderation_enabled: false, featured: uses > 20_000, notice_period: 30, is_added_by_user: EL.custom.some((v) => v.sharing?.original_voice_id === id),
});
// Hết credit như thật: yêu cầu vượt hạn mức còn lại bị từ chối với quota_exceeded.
function charge(res, chars, rate = 1) {
  const cost = Math.ceil(chars * rate);
  if (EL.used + cost > t().chars) { err(res, 401, "quota_exceeded", `This request exceeds your quota of ${t().chars}. You have ${Math.max(0, t().chars - EL.used)} credits remaining, while ${cost} credits are required for this request.`); return -1; }
  EL.used += cost;
  return cost;
}
const formOf = async (req, raw) => new Request("http://x", { method: "POST", headers: { "content-type": String(req.headers["content-type"] ?? "") }, body: raw, duplex: "half" }).formData();
const previews = (desc) => ({ text: `Xin chào, đây là bản nghe thử cho giọng: ${desc}. Synchro tạo ba bản để bạn chọn bản ưng nhất trước khi lưu vào tài khoản.`,
  previews: [0, 1, 2].map((i) => ({ audio_base_64: wav(2.5 + i * 0.4, i + 3).toString("base64"), generated_voice_id: rid("gen_"), media_type: "audio/wav", duration_secs: 2.5 + i * 0.4, language: "vi" })) });

/** Xử lý đường dẫn /elevenlabs/… (trừ Realtime, nằm ở mock-providers). Trả true nếu đã trả lời. */
export async function elevenHandler(req, res, p, b, raw, valid, elevenNo) {
  if (p === "/_debug/el") {
    if (req.method === "POST") { EL.cfg = { ...EL.cfg, ...b }; if (b.used !== undefined) EL.used = Number(b.used) || 0; if (b.reset) reset(); }
    return json(res, 200, { cfg: EL.cfg, used: EL.used, custom: EL.custom.map((v) => v.voice_id), dubs: [...EL.dubs.keys()], calls: EL.calls.slice(-30), last: EL.last });
  }
  if (!p.startsWith("/elevenlabs/")) return false;
  if (p.startsWith("/elevenlabs/_preview/")) return audio(res, 2, p.length);
  if (p.startsWith("/elevenlabs/v1/convai/realtime")) return false;
  const key = req.headers["xi-api-key"];
  if (!valid(key)) return err(res, 401, "invalid_api_key", "Invalid API key");
  const ep = p.replace(/^\/elevenlabs/, ""), m = req.method;
  EL.calls.push(`${m} ${ep}`);
  const missing = (perm) => err(res, 401, "missing_permissions", `The API key you used is missing the permission ${perm} to execute this operation.`);
  const need = PERMS.find(([re, meth]) => re.test(ep) && (!meth || meth === m))?.[2];
  if (need && (EL.cfg.noPerms ?? []).includes(need)) return missing(need);

  if (ep === "/v1/user") return elevenNo(req, "user") ? missing("user_read") : json(res, 200, { subscription: { tier: EL.cfg.tier }, user_id: "mock-user" });
  if (ep === "/v1/user/subscription") {
    if (elevenNo(req, "user")) return missing("user_read");
    const x = t();
    return json(res, 200, { tier: EL.cfg.tier, status: EL.cfg.tier === "free" ? "free" : "active", character_count: EL.used, character_limit: x.chars, next_character_count_reset_unix: Math.floor(Date.now() / 1000) + 12 * 86400,
      // Như thật: giọng thêm từ thư viện, thiết kế, nhân bản nhanh đều dùng chỗ lưu giọng; giọng nhân bản chuyên sâu tính riêng.
      voice_slots_used: EL.custom.filter((v) => !v.fine_tuning).length, voice_limit: x.voices, professional_voice_slots_used: EL.custom.filter((v) => v.fine_tuning).length,
      professional_voice_limit: x.pro, can_use_instant_voice_cloning: x.ivc, can_use_professional_voice_cloning: x.pvc, max_voice_add_edits: 54, voice_add_edit_counter: 0, can_extend_character_limit: false });
  }
  if (ep === "/v1/models") return json(res, 200, MODELS.map(([id, name, nl, max, rate, tts]) => ({ model_id: id, name, description: `${name} (giả lập)`, can_do_text_to_speech: tts, can_do_voice_conversion: !tts,
    can_use_style: tts, can_use_speaker_boost: true, requires_alpha_access: false, max_characters_request_free_user: max, max_characters_request_subscribed_user: max * 4, maximum_text_length_per_request: max * 4,
    languages: [["vi", "Vietnamese"], ["en", "English"], ["ja", "Japanese"]].slice(0, nl > 2 ? 3 : 1).map(([language_id, name]) => ({ language_id, name })), model_rates: { character_cost_multiplier: rate } })));
  if (ep === "/v1/studio/projects" && m === "GET") return EL.cfg.studio ? json(res, 200, { projects: [] }) : err(res, 403, "", "Access to the Studio API requires your account to be explicitly whitelisted to use it. Please contact our sales team.");

  // ---- giọng ----
  if (ep === "/v2/voices" && m === "GET") {
    const u = new URL(req.url, "http://x"), q = (u.searchParams.get("search") ?? "").toLowerCase();
    const list = allVoices().filter((v) => !q || `${v.name} ${v.description ?? ""}`.toLowerCase().includes(q));
    return json(res, 200, { voices: list, has_more: false, total_count: list.length, next_page_token: null });
  }
  let mm = /^\/v1\/voices\/([\w-]+)$/.exec(ep);
  if (mm && m === "GET") { const v = findVoice(mm[1]); return v ? json(res, 200, v) : err(res, 404, "voice_not_found", "A voice with the voice_id was not found."); }
  if (mm && m === "DELETE") { const n = EL.custom.length; EL.custom = EL.custom.filter((v) => v.voice_id !== mm[1]); return n === EL.custom.length ? err(res, 404, "voice_not_found", "A voice with the voice_id was not found.") : json(res, 200, { status: "ok" }); }
  if (ep === "/v1/shared-voices") {
    const u = new URL(req.url, "http://x"), q = (u.searchParams.get("search") ?? "").toLowerCase(), lang = u.searchParams.get("language"), gender = u.searchParams.get("gender");
    const list = LIB.map(libRaw).filter((v) => (!q || `${v.name} ${v.descriptive}`.toLowerCase().includes(q)) && (!lang || v.language === lang) && (!gender || v.gender === gender));
    return json(res, 200, { voices: list, has_more: false, total_count: list.length });
  }
  mm = /^\/v1\/voices\/add\/([\w-]+)\/([\w-]+)$/.exec(ep);
  if (mm && m === "POST") {
    const lib = LIB.find((x) => x[0] === mm[2]);
    if (!lib) return err(res, 404, "voice_not_found", "Voice not found in the library.");
    if (EL.cfg.tier === "free" && !lib[9]) return err(res, 403, "free_users_not_allowed", "Free users cannot use this library voice. Please upgrade your subscription.");
    if (EL.custom.length >= t().voices) return err(res, 400, "voice_limit_reached", `You have reached your maximum amount of custom voices (${t().voices}).`);
    const v = voiceRaw([rid("v"), b.new_name || lib[2], lib[3], lib[4], lib[5], lib[6], lib[7]], "professional");
    // Như API thật: giọng thêm từ Thư viện không thuộc sở hữu của tài khoản (gói Free không đọc được bằng giọng này qua API).
    v.is_owner = false;
    v.sharing = { original_voice_id: lib[0], public_owner_id: lib[1] };
    EL.custom.unshift(v);
    return json(res, 200, { voice_id: v.voice_id });
  }
  if (ep === "/v1/voices/add" && m === "POST") {
    if (!t().ivc) return err(res, 403, "can_not_use_instant_voice_cloning", "Your subscription does not have access to instant voice cloning. Please upgrade your subscription.");
    const f = await formOf(req, raw);
    if (!f.getAll("files").length) return err(res, 422, "invalid", "files: field required");
    if (EL.custom.length >= t().voices) return err(res, 400, "voice_limit_reached", "You have reached your maximum amount of custom voices.");
    const v = voiceRaw([rid("ivc"), String(f.get("name")), "male", "young", "", "personal", "vi"], "cloned");
    EL.custom.unshift(v);
    return json(res, 200, { voice_id: v.voice_id, requires_verification: false });
  }
  if (ep === "/v1/voices/pvc" && m === "POST") {
    if (!t().pvc) return err(res, 403, "can_not_use_professional_voice_cloning", "Your subscription does not have access to professional voice cloning. Please upgrade.");
    const v = voiceRaw([rid("pvc"), b.name || "PVC", "male", "young", "", "personal", b.language || "vi"], "professional");
    v.fine_tuning = { state: { eleven_v4: "not_started" }, is_allowed_to_fine_tune: true, verification_attempts_count: 0 };
    EL.custom.unshift(v); EL.pvc.set(v.voice_id, { samples: 0, verified: false });
    return json(res, 200, { voice_id: v.voice_id });
  }
  mm = /^\/v1\/voices\/pvc\/([\w-]+)\/(samples|captcha|train)$/.exec(ep);
  if (mm) {
    const st = EL.pvc.get(mm[1]);
    if (!st) return err(res, 404, "voice_not_found", "PVC voice not found.");
    if (mm[2] === "samples") { const f = await formOf(req, raw); const files = f.getAll("files"); st.samples += files.length; return json(res, 200, files.map((x) => ({ sample_id: rid("s"), file_name: x.name, mime_type: x.type, size_bytes: x.size, hash: "h", duration_secs: 60 }))); }
    if (mm[2] === "captcha" && m === "GET") return json(res, 200, { text: "Hôm nay trời Hà Nội se lạnh, tôi pha một ấm trà và đọc câu này." });
    if (mm[2] === "captcha") { st.verified = true; return json(res, 200, { status: "ok" }); }
    if (!st.verified || !st.samples) return err(res, 400, "verification_required", "Voice must be verified and have samples before training.");
    const v = findVoice(mm[1]); if (v) v.fine_tuning = { ...v.fine_tuning, state: { eleven_v4: "fine_tuning" }, progress: { eleven_v4: 0.1 } };
    return json(res, 200, { status: "ok" });
  }
  if (ep === "/v1/text-to-voice/design" && m === "POST") {
    if (!b.voice_description || b.voice_description.length < 20) return err(res, 422, "invalid", "voice_description must be at least 20 characters");
    if (charge(res, 300) < 0) return true;
    return json(res, 200, previews(b.voice_description));
  }
  mm = /^\/v1\/text-to-voice\/([\w-]+)\/remix$/.exec(ep);
  if (mm && m === "POST") {
    const v = findVoice(mm[1]);
    if (!v) return err(res, 404, "voice_not_found", "Voice not found.");
    if (v.category === "premade") return err(res, 400, "voice_not_remixable", "Only voices you own can be remixed.");
    if (charge(res, 300) < 0) return true;
    return json(res, 200, previews(b.voice_description));
  }
  if (ep === "/v1/text-to-voice" && m === "POST") {
    if (!b.generated_voice_id) return err(res, 422, "invalid", "generated_voice_id: field required");
    if (EL.custom.length >= t().voices) return err(res, 400, "voice_limit_reached", "You have reached your maximum amount of custom voices.");
    const v = voiceRaw([rid("gen"), b.voice_name, "female", "young", "", "characters", "vi"], "generated");
    v.description = b.voice_description;
    EL.custom.unshift(v);
    return json(res, 200, v);
  }

  // ---- tạo âm thanh ----
  mm = /^\/v1\/text-to-speech\/([\w-]+)(\/stream)?$/.exec(ep);
  if (mm && m === "POST") {
    if (!findVoice(mm[1]) && !LIB.some((x) => x[0] === mm[1])) return err(res, 404, "voice_not_found", "A voice with the voice_id was not found.");
    const fv = findVoice(mm[1]);
    if (EL.cfg.tier === "free" && (LIB.some((x) => x[0] === mm[1]) || (fv?.category === "professional" && !fv.is_owner)))
      return err(res, 402, "payment_required", "Free users cannot use library voices via the API. Please upgrade your subscription to use this voice.");
    const model = MODELS.find((x) => x[0] === (b.model_id ?? "eleven_v4"));
    if (!model || !model[5]) return err(res, 400, "model_not_found", "Model does not support text to speech.");
    const text = String(b.text ?? "");
    const max = EL.cfg.tier === "free" ? model[3] : model[3] * 4;
    if (!text) return err(res, 422, "invalid", "text: field required");
    if (text.length > max) return err(res, 400, "max_character_limit_exceeded", `Text is too long (${text.length} > ${max}).`);
    const fmt = new URL(req.url, "http://x").searchParams.get("output_format") ?? "mp3_44100_128";
    if (/192/.test(fmt) && !["creator", "pro"].includes(EL.cfg.tier)) return err(res, 403, "output_format_not_allowed", "mp3_44100_192 requires a Creator subscription or above. Please upgrade.");
    if (badEffects(res, b.audio_effects, fmt)) return true;
    for (const d of b.pronunciation_dictionary_locators ?? []) if (!EL.dicts.has(d.pronunciation_dictionary_id)) return err(res, 404, "not_found", "pronunciation dictionary not found");
    EL.last.tts = { model_id: b.model_id, audio_effects: b.audio_effects ?? null, dicts: b.pronunciation_dictionary_locators ?? null };
    const cost = charge(res, text.length, model[4]);
    if (cost < 0) return true;
    return audio(res, text.length / 14, text.length, cost);
  }
  if (ep === "/v1/text-to-dialogue" && m === "POST") {
    if (badEffects(res, b.audio_effects, new URL(req.url, "http://x").searchParams.get("output_format") ?? "mp3_44100_128")) return true;
    EL.last.dialogue = { audio_effects: b.audio_effects ?? null };
    const inputs = Array.isArray(b.inputs) ? b.inputs : [];
    if (!inputs.length) return err(res, 422, "invalid", "inputs: field required");
    for (const x of inputs) if (!findVoice(x.voice_id)) return err(res, 404, "voice_not_found", `Voice ${x.voice_id} not found.`);
    const chars = inputs.reduce((n, x) => n + String(x.text ?? "").length, 0), cost = charge(res, chars);
    if (cost < 0) return true;
    return audio(res, chars / 14, chars, cost);
  }
  if (ep === "/v1/speech-to-text" && m === "POST") {
    const f = await formOf(req, raw);
    if (!f.get("file") && !f.get("source_url")) return err(res, 422, "invalid", "Either file or source_url must be provided.");
    if (!["scribe_v2", "scribe_v2_turbo", "scribe_v2_medical", "scribe_v1"].includes(String(f.get("model_id")))) return err(res, 422, "invalid", `model_id: unknown ${f.get("model_id")}`);
    EL.last.stt = { model_id: f.get("model_id"), detect_speaker_roles: f.get("detect_speaker_roles"), use_speaker_library: f.get("use_speaker_library"), transcript_edit: f.get("transcript_edit") };
    const lines = [[0, "Xin chào, cảm ơn chị Hà đã dành thời gian cho buổi phỏng vấn hôm nay."], [1, "Dạ không có gì, tôi rất vui được chia sẻ về dự án ở Đà Nẵng."], [0, "Dự án bắt đầu từ khi nào ạ?"], [1, "Chúng tôi bắt đầu từ tháng 3 năm 2025."]];
    let at = 0;
    const words = lines.flatMap(([sp, line]) => line.split(" ").flatMap((w, i, a) => { const s = at; at += 0.32; const out = [{ text: w, start: s, end: s + 0.28, type: "word", speaker_id: `speaker_${sp}`, logprob: -0.1 }]; if (i < a.length - 1) out.push({ text: " ", start: s + 0.28, end: s + 0.32, type: "spacing", speaker_id: `speaker_${sp}` }); return out; }).concat([{ text: " ", start: at, end: at + 0.4, type: "spacing", speaker_id: `speaker_${sp}` }]));
    const redact = f.get("entity_redaction");
    const text = lines.map(([, l]) => l).join(" ");
    return json(res, 200, { language_code: f.get("language_code") || "vie", language_probability: 0.98, text: redact ? text.replace("Đà Nẵng", "{LOCATION}").replace("chị Hà", "{PERSON_NAME}") : text, words,
      ...(f.get("transcript_edit") ? { edited_transcript: { text: `${text} (đã chỉnh: ${f.get("transcript_edit")})` } } : {}),
      ...(f.get("entity_detection") && !redact ? { entities: [{ text: "chị Hà", entity_type: "person_name", start_char: 17, end_char: 23 }, { text: "Đà Nẵng", entity_type: "location", start_char: 120, end_char: 127 }] } : {}) });
  }
  if (ep === "/v1/sound-generation" && m === "POST") {
    if (!b.text) return err(res, 422, "invalid", "text: field required");
    if (b.model_id && !["eleven_text_to_sound_v2", "eleven_text_to_sound_v3"].includes(b.model_id)) return err(res, 422, "invalid", `model_id: unknown ${b.model_id}`);
    EL.last.sfx = { model_id: b.model_id ?? null };
    const sec = b.duration_seconds ?? 4;
    const cost = charge(res, Math.round(sec * 40));
    if (cost < 0) return true;
    return audio(res, sec, String(b.text).length, cost);
  }
  if (ep === "/v1/music" && m === "POST") {
    if (EL.cfg.lockMusic) return err(res, 403, "subscription_required", "Music generation is not available on your plan. Please upgrade your subscription.");
    if (b.model_id && !["music_v1", "music_v2", "music_v2_5"].includes(b.model_id)) return err(res, 422, "invalid", `model_id: unknown ${b.model_id}`);
    if (b.lyrics_text && b.force_instrumental) return err(res, 422, "invalid", "lyrics_text cannot be used with force_instrumental");
    EL.last.music = { model_id: b.model_id ?? null, lyrics_text: b.lyrics_text ?? null };
    const sec = (b.music_length_ms ?? 15000) / 1000, cost = charge(res, Math.round(sec * 30));
    if (cost < 0) return true;
    return audio(res, sec, 9, cost);
  }
  if (ep === "/v1/music/video-to-music" && m === "POST") {
    const f = await formOf(req, raw);
    if (!f.getAll("videos").length) return err(res, 422, "invalid", "videos: field required");
    EL.last.videoMusic = { description: f.get("description"), tags: f.getAll("tags"), add_sfx: f.get("add_sfx") };
    const cost = charge(res, 600); if (cost < 0) return true;
    return audio(res, 8, 11, cost);
  }
  if (ep === "/v1/music/stem-separation" && m === "POST") {
    const f = await formOf(req, raw);
    if (!f.get("file")) return err(res, 422, "invalid", "file: field required");
    if (!["two_stems_v1", "six_stems_v1"].includes(String(f.get("stem_variation_id")))) return err(res, 422, "invalid", "stem_variation_id: invalid");
    const cost = charge(res, 300); if (cost < 0) return true;
    // ZIP rỗng hợp lệ (chỉ cần để trình duyệt tải về).
    const zip = Buffer.from("504b0506000000000000000000000000000000000000", "hex");
    res.writeHead(200, { "content-type": "application/zip", "content-length": zip.length, "character-cost": String(cost) }); res.end(zip); return true;
  }
  // ---- từ điển phát âm ----
  if (ep === "/v1/audio-effects/catalog" && m === "GET") return json(res, 200, FX);
  const dictOut = (d) => ({ id: d.id, name: d.name, description: d.description ?? null, latest_version_id: d.version, latest_version_rules_num: d.rules.length, creation_time_unix: d.at, created_by: "mock-user", permission_on_resource: "admin", archived_time_unix: null, rules: d.rules });
  if (ep === "/v1/pronunciation-dictionaries/add-from-rules" && m === "POST") {
    if (!b.name || !Array.isArray(b.rules)) return err(res, 422, "invalid", "name and rules are required");
    for (const r of b.rules) if (!r.string_to_replace || !["alias", "phoneme"].includes(r.type) || (r.type === "alias" ? !r.alias : !r.phoneme)) return err(res, 422, "invalid", "invalid rule");
    const d = { id: rid("pd_"), name: b.name, description: b.description ?? null, version: rid("v_"), rules: b.rules, at: Math.floor(Date.now() / 1000) };
    EL.dicts.set(d.id, d);
    return json(res, 200, { id: d.id, name: d.name, created_by: "mock-user", creation_time_unix: d.at, version_id: d.version, version_rules_num: d.rules.length, description: d.description, permission_on_resource: "admin" });
  }
  if (ep === "/v1/pronunciation-dictionaries" && m === "GET") return json(res, 200, { pronunciation_dictionaries: [...EL.dicts.values()].filter((d) => !d.archived).reverse().map(dictOut), next_cursor: null, has_more: false });
  mm = /^\/v1\/pronunciation-dictionaries\/([\w-]+)(?:\/(set-rules))?$/.exec(ep);
  if (mm) {
    const d = EL.dicts.get(mm[1]);
    if (!d) return err(res, 404, "not_found", "Pronunciation dictionary not found");
    if (mm[2] && m === "POST") { d.rules = b.rules ?? []; d.version = rid("v_"); return json(res, 200, { id: d.id, version_id: d.version, version_rules_num: d.rules.length }); }
    if (m === "PATCH") { if (b.archived) d.archived = true; if (b.name) d.name = b.name; return json(res, 200, dictOut(d)); }
    if (m === "GET") return json(res, 200, dictOut(d));
  }
  // ---- Audio Native ----
  if (ep === "/v1/audio-native" && m === "POST") {
    const f = await formOf(req, raw);
    if (!f.get("name") || !f.get("file")) return err(res, 422, "invalid", "name and file are required");
    const id = rid("an_");
    EL.natives.set(id, { polls: 0, title: f.get("title") });
    return json(res, 200, { project_id: id, converting: true, html_snippet: `<div id="elevenlabs-audionative-widget" data-height="90" data-width="100%" data-frameborder="no" data-scrolling="no" data-publicuserid="mock-user" data-playerurl="https://elevenlabs.io/player/index.html" data-projectid="${id}">Loading the <a href="https://elevenlabs.io/text-to-speech" target="_blank" rel="noopener">Elevenlabs Text to Speech</a> AudioNative Player...</div><script src="https://elevenlabs.io/player/audioNativeHelper.js" type="text/javascript"></script>` });
  }
  mm = /^\/v1\/audio-native\/([\w-]+)\/settings$/.exec(ep);
  if (mm && m === "GET") {
    const n = EL.natives.get(mm[1]);
    if (!n) return err(res, 404, "not_found", "Project not found");
    n.polls++;
    return json(res, 200, { enabled: true, snapshot_id: n.polls > 1 ? rid("snap_") : null, settings: { title: n.title, image: null, author: null, small: false, text_color: "#000000", background_color: "#ffffff", sessionization: 0, audio_path: null, audio_url: n.polls > 1 ? `http://127.0.0.1:4010/elevenlabs/_preview/${mm[1]}.wav` : null, status: n.polls > 1 ? "ready" : "processing" } });
  }
  if (ep === "/v1/audio-isolation" && m === "POST") { const f = await formOf(req, raw); if (!f.get("audio")) return err(res, 422, "invalid", "audio: field required"); return audio(res, 3, 5, 100); }
  mm = /^\/v1\/voice-changer\/([\w-]+)$/.exec(ep);
  if (mm && m === "POST") { if (!findVoice(mm[1])) return err(res, 404, "voice_not_found", "Voice not found."); const f = await formOf(req, raw); if (!f.get("audio")) return err(res, 422, "invalid", "audio: field required"); return audio(res, 3, 7, 300); }
  if (ep === "/v1/forced-alignment" && m === "POST") {
    const f = await formOf(req, raw), text = String(f.get("text") ?? "");
    if (!f.get("file") || !text) return err(res, 422, "invalid", "file and text are required");
    let at = 0;
    const words = text.split(/\s+/).filter(Boolean).map((w) => { const s = at; at += 0.3 + w.length * 0.03; return { text: w, start: +s.toFixed(2), end: +(at - 0.04).toFixed(2), loss: 0.1 }; });
    return json(res, 200, { words, characters: [], loss: 0.12 });
  }
  if (ep === "/v1/single-use-token/realtime_scribe" && m === "POST") return json(res, 200, { token: rid("sut_") });

  // ---- lồng tiếng (lần hỏi đầu: đang xử lý; lần sau: xong) ----
  if (ep === "/v1/dubbing" && m === "POST") {
    const f = await formOf(req, raw);
    if (!f.get("file") && !f.get("source_url")) return err(res, 422, "invalid", "Either file or source_url must be provided.");
    if (EL.cfg.tier === "free" && f.get("watermark") !== "true") return err(res, 403, "watermark_required", "Free plan dubbing requires watermark to be enabled. Please upgrade to remove the watermark.");
    const id = rid("dub_");
    EL.dubs.set(id, { polls: 0, target: f.get("target_lang") });
    return json(res, 200, { dubbing_id: id, expected_duration_sec: 20 });
  }
  mm = /^\/v1\/dubbing\/([\w-]+)$/.exec(ep);
  if (mm && m === "GET") { const d = EL.dubs.get(mm[1]); if (!d) return err(res, 404, "dubbing_not_found", "Dubbing not found."); d.polls++; return json(res, 200, { dubbing_id: mm[1], name: "mock", status: d.polls > 1 ? "dubbed" : "dubbing", target_languages: [d.target], media_metadata: { content_type: "audio/wav", duration: 4 }, error: null }); }
  mm = /^\/v1\/dubbing\/([\w-]+)\/audio\/([\w-]+)$/.exec(ep);
  if (mm) return EL.dubs.get(mm[1])?.polls > 1 ? audio(res, 4, 11) : err(res, 425, "dubbing_not_ready", "Dubbing is not ready yet.");

  // ---- Studio (chỉ khi tài khoản được duyệt) ----
  if (ep.startsWith("/v1/studio/") && !EL.cfg.studio) return err(res, 403, "", "Access to the Studio API requires your account to be explicitly whitelisted to use it. Please contact our sales team.");
  if ((ep === "/v1/studio/podcasts" || ep === "/v1/studio/projects") && m === "POST") {
    const id = rid("proj_");
    EL.projects.set(id, { polls: 0 });
    return json(res, 200, { project: { project_id: id, name: ep.endsWith("podcasts") ? "Podcast mới" : "Sách nói", state: "converting" } });
  }
  mm = /^\/v1\/studio\/projects\/([\w-]+)(\/snapshots(?:\/([\w-]+)\/stream)?)?$/.exec(ep);
  if (mm) {
    const pr = EL.projects.get(mm[1]);
    if (!pr) return err(res, 404, "project_not_found", "Project not found.");
    if (!mm[2]) { pr.polls++; return json(res, 200, { project_id: mm[1], state: pr.polls > 1 ? "default" : "converting", chapters: [{ name: "Chương 1", state: pr.polls > 1 ? "default" : "converting" }] }); }
    if (!mm[3]) return json(res, 200, { snapshots: pr.polls > 1 ? [{ project_snapshot_id: "snap_1" }] : [] });
    return audio(res, 6, 13);
  }
  return err(res, 404, "not_found", `Không có đường dẫn ${ep} trên ElevenLabs giả lập`);
}

// ---- Scribe Realtime giả lập (WebSocket): nhận âm thanh, trả câu tạm rồi câu chốt như API thật ----
export function scribeConnect(ws, req) {
  const u = new URL(req.url, "http://x");
  if (!u.searchParams.get("token")) { ws.send(JSON.stringify({ message_type: "auth_error", error: "Missing token" })); ws.close(4001); return; }
  // Không đặt language_code: tự nhận ngôn ngữ; lượt thứ hai nói tiếng Anh để thử đổi tiếng giữa chừng.
  const fixed = u.searchParams.get("language_code");
  const lines = fixed === "en" ? ["Hello Synchro", "what's the weather today", "and remind me about the meeting at three"] : fixed ? ["Xin chào Synchro", "hôm nay thời tiết thế nào", "và nhắc mình họp lúc ba giờ chiều nhé"]
    : ["Xin chào Synchro", "what's the weather in London today", "và nhắc mình họp lúc ba giờ chiều nhé"];
  const stamps = u.searchParams.get("include_timestamps") === "true";
  const langOf = (s) => (/[ăâđêôơưàảãạáằẳẵặắầẩẫậấèẻẽẹéềểễệếìỉĩịíòỏõọóồổỗộốờởỡợớùủũụúừửữựứỳỷỹỵý]/i.test(s) ? "vi" : "en");
  let chunks = 0, n = 0;
  ws.send(JSON.stringify({ message_type: "session_started", session_id: rid("ses_"), config: { sample_rate: 16000, model_id: u.searchParams.get("model_id"), language_code: u.searchParams.get("language_code") } }));
  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(String(raw)); } catch { return; }
    if (m.message_type !== "input_audio_chunk") return;
    chunks++;
    if (n >= lines.length) return;
    if (chunks % 6 === 3) ws.send(JSON.stringify({ message_type: "partial_transcript", text: lines[n].split(" ").slice(0, 2).join(" ") }));
    if (chunks % 6 === 0 || m.commit) {
      const text = lines[n++];
      ws.send(JSON.stringify({ message_type: "committed_transcript", text }));
      // Như API thật: bật mốc thời gian thì gửi thêm bản có mốc kèm ngôn ngữ nhận ra (null khi đã đặt ngôn ngữ cố định).
      if (stamps) ws.send(JSON.stringify({ message_type: "committed_transcript_with_timestamps", text, language_code: fixed ? null : langOf(text), words: [] }));
    }
  });
}
