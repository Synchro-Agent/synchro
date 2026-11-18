"use client";
// Phía trình duyệt của Speech: gọi /api/speech, giữ gói ElevenLabs (credit, tính năng) dùng chung cho mọi công cụ và thanh bên.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { NO_SERVER } from "../apierr";
import { locale, tf } from "../i18n";
import { fmtClockOf, fmtDurOf, itemTitleKey, langLabelOf, micErrorOf } from "../../shared/speech/fmt";

// Kiểu dùng chung với phía bên kia: shared/types/speech.ts.
import type { Feat, ModelOut, Plan } from "../../shared/types/speech";
export type { Feat, ModelOut, Plan } from "../../shared/types/speech";
export type Voice = {
  lib?: boolean;
  id: string; name: string; desc: string; lang: string; langCode: string; accent: string; gender: string; age: string; use: string; category: string;
  preview: string | null; mine: boolean; owner?: string; canDelete?: boolean; holder?: string; free?: boolean; uses?: number; notice?: number | null; added?: boolean;
};
export type Item = { id: string; kind: string; title: string; meta: Record<string, unknown>; mime: string | null; size: number; createdAt: number; url: string | null };
export type Credits = Plan["credits"];
export type Dict = { id: string; name: string; desc: string; version: string; count: number; createdAt?: number; rules?: Rule[] };
export type Rule = { word: string; type: "alias" | "phoneme"; say: string; alphabet?: string; cs?: boolean };
export type Effects = { filters: { id: string; name: string }[]; spaces: { id: string; name: string }[]; noises: { id: string; name: string }[] };

export class SpeechError extends Error { constructor(msg: string, public code?: string, public status = 0) { super(msg); } }

export async function api<T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`/api/speech/${path}`, init).catch(() => { throw new SpeechError(NO_SERVER); });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string; code?: string; credits?: Credits };
  if (!r.ok) {
    // budget: vừa chạm hạn mức (của riêng mình hoặc chung của máy chủ): đọc lại để số credit ở đầu trang về đúng, không còn hiện số cũ.
    if (j.code === "plan" || j.code === "budget") void refreshPlan(false);
    throw new SpeechError(j.error ?? (r.status === 413 ? "Tệp quá lớn để tải lên (tối đa 40 MB). Dán liên kết thay vì tải lên." : `Lỗi ${r.status}`), j.code, r.status);
  }
  if (j.credits) setCredits(j.credits);
  return j;
}
export const post = <T = Record<string, unknown>>(op: string, body: unknown) => api<T>(op, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
export const postForm = <T = Record<string, unknown>>(op: string, fd: FormData) => api<T>(op, { method: "POST", body: fd });
export const del = (op: string, id: string) => api(`${op}?id=${encodeURIComponent(id)}`, { method: "DELETE" });

// ---- gói dùng chung (một lần quét cho cả trang) ----
let plan: Plan | null = null, loading: Promise<void> | null = null, planFailed = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export async function refreshPlan(fresh = false) {
  if (loading && !fresh) return loading;
  // Không đọc được gói (mất mạng, máy chủ lỗi): báo để trang hiện nút thử lại, không quay mãi.
  loading = fetch(`/api/speech/plan${fresh ? "?fresh=1" : ""}`).then(async (r) => { if (!r.ok) throw new Error(String(r.status)); plan = (await r.json()) as Plan; planFailed = false; emit(); }).catch(() => { planFailed = true; emit(); }).finally(() => { loading = null; });
  return loading;
}
export function setCredits(c: Credits) { if (plan) { plan = { ...plan, credits: c }; emit(); } }
export function usePlan(enabled = true) {
  const p = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => plan, () => null);
  useEffect(() => { if (enabled && !plan) void refreshPlan(); }, [enabled]);
  return p;
}
export const usePlanFailed = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => planFailed, () => false);
export const on = (p: Plan | null, f: Feat) => !!p?.connected && !!p.features[f];

// ---- giọng của tài khoản (dùng chung) ----
let mine: Voice[] | null = null, mineLoading: Promise<void> | null = null;
const vsubs = new Set<() => void>();
export async function reloadVoices(fresh = false) {
  if (mineLoading && !fresh) return mineLoading;
  mineLoading = api<{ voices: Voice[] }>(`voices${fresh ? "?fresh=1" : ""}`).then((j) => { mine = j.voices; vsubs.forEach((f) => f()); }).catch(() => { mine = mine ?? []; vsubs.forEach((f) => f()); }).finally(() => { mineLoading = null; });
  return mineLoading;
}
export function useMyVoices(enabled = true) {
  const v = useSyncExternalStore((f) => { vsubs.add(f); return () => vsubs.delete(f); }, () => mine, () => null);
  useEffect(() => { if (enabled && !mine) void reloadVoices(); }, [enabled]);
  return enabled ? v : null;
}
/** Giọng mặc định: giọng tiếng Việt đầu tiên của tài khoản, không thì giọng đầu tiên. */
export const defaultVoice = (list: Voice[] | null) => list?.find((v) => v.langCode.startsWith("vi")) ?? list?.[0] ?? null;

// ---- lịch sử sản phẩm ----
export function useItems(kinds: string[], dep = 0) {
  const [items, setItems] = useState<Item[] | null>(null);
  const key = kinds.join(",");
  useEffect(() => {
    let dead = false;
    api<{ items: Item[] }>(`items?kinds=${key}&limit=40`).then((j) => !dead && setItems(j.items)).catch(() => !dead && setItems([]));
    return () => { dead = true; };
  }, [key, dep]);
  return [items, setItems] as const;
}

export const running = (x: Item) => ["dubbing", "converting"].includes(String(x.meta.status));
// Hỏi lại trạng thái các dự án đang chạy: 5 giây sau khi gửi, rồi mỗi 10 giây tới khi xong. Vòng hỏi chạy theo đồng hồ riêng, không theo danh sách:
// trước đây vòng sau chỉ được hẹn khi danh sách đổi, nên một lần hỏi lỗi hay chậm (lúc lồng tiếng xong máy chủ còn tải âm thanh về) là dừng hẳn,
// danh sách đứng ở “Đang dịch và lồng tiếng…” dù ElevenLabs đã xong, phải mở lại trang mới thấy (G6.5).
export function usePoll(items: Item[] | null, setItems: (f: (l: Item[] | null) => Item[] | null) => void, op: "dub" | "project" | "native", every = 10_000) {
  const ref = useRef(items);
  ref.current = items;
  const has = (items ?? []).some(running);
  useEffect(() => {
    if (!has) return;
    let dead = false, t: ReturnType<typeof setTimeout> | undefined;
    const round = async () => {
      for (const it of (ref.current ?? []).filter(running)) {
        if (dead) return;
        const j = await api<{ item: Item }>(`${op}?id=${it.id}`).catch(() => null);
        if (j && !dead) setItems((l) => l?.map((x) => (x.id === it.id ? j.item : x)) ?? null);
      }
      if (!dead) t = setTimeout(round, every);
    };
    t = setTimeout(round, Math.min(5_000, every));
    return () => { dead = true; clearTimeout(t); };
  }, [has, setItems, op, every]);
}
// ---- danh mục hiệu ứng và từ điển phát âm (dùng chung giữa Đọc văn bản và trang Từ điển) ----
let fxCat: Effects | null = null;
export function useEffectsCatalog(enabled: boolean) {
  const [v, setV] = useState<Effects | null>(fxCat);
  useEffect(() => { if (enabled && !fxCat) api<Effects>("effects").then((j) => { fxCat = j; setV(j); }).catch(() => {}); }, [enabled]);
  return v;
}
let dicts: Dict[] | null = null;
const dsubs = new Set<() => void>();
export async function reloadDicts() { try { dicts = (await api<{ dicts: Dict[] }>("dicts")).dicts; } catch { dicts = dicts ?? []; } dsubs.forEach((f) => f()); }
export function setDicts(f: (l: Dict[]) => Dict[]) { dicts = f(dicts ?? []); dsubs.forEach((x) => x()); }
export function useDicts(enabled: boolean) {
  const v = useSyncExternalStore((f) => { dsubs.add(f); return () => dsubs.delete(f); }, () => dicts, () => null);
  useEffect(() => { if (enabled && !dicts) void reloadDicts(); }, [enabled]);
  return v;
}

// ---- định dạng ----
export const fmtNum = (n: number) => Math.round(n).toLocaleString(locale());
export const fmtDur = fmtDurOf;
/** Đồng hồ của trình phát (shared/speech/fmt.ts): bản dưới 10 giây có một chữ số thập phân, không còn “0:00 / 0:00”. */
export const fmtClock = (t: number, total: number) => fmtClockOf(t, total, locale());
/** Tên ngôn ngữ theo ngôn ngữ giao diện từ mã ISO (vi, en, vie…). */
export const langLabel = (code: unknown, fallback = "") => langLabelOf(code, locale(), fallback);
/** Tiêu đề hiển thị của một sản phẩm: tiêu đề do Synchro đặt dựng lại theo ngôn ngữ giao diện; tiêu đề từ nội dung người dùng giữ nguyên. */
export function itemTitle(it: Item) {
  const k = itemTitleKey(it);
  return k ? tf(k[0], k[1]) : it.title;
}
export function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "Vừa xong";
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} ngày trước`;
  return new Date(t).toLocaleDateString(locale());
}
// ---- micro ----
/** Lời báo khi không mở được micro, theo lỗi của trình duyệt, kèm cách cho phép micro. */
export const micError = (e: unknown): string => micErrorOf((e as { name?: string } | null)?.name ?? "");
/** Mở thử micro trước khi gọi: null khi dùng được, không thì lời báo (micError). Quyền đã bị chặn, khung nhúng không có quyền micro,
 *  hay trình duyệt không hỏi gì (lời hỏi bị ẩn, chờ mãi) đều thành lời báo rõ ràng thay vì nút đứng im. */
export async function checkMic(waitMs = 20_000): Promise<string | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return micError({ name: "NoMic" });
  try {
    const st = await navigator.permissions?.query({ name: "microphone" as PermissionName });
    if (st?.state === "denied") return micError({ name: "NotAllowedError" });
  } catch {}
  let late = false, timer: ReturnType<typeof setTimeout> | undefined;
  const ask = navigator.mediaDevices.getUserMedia({ audio: true });
  // Hết giờ chờ mà trình duyệt mới cho phép: tắt luôn micro vừa mở, không để đèn micro sáng.
  ask.then((s) => { if (late) s.getTracks().forEach((t) => t.stop()); }, () => {});
  try {
    const stream = await Promise.race([ask, new Promise<never>((_, no) => { timer = setTimeout(() => { late = true; no({ name: "TimeoutError" }); }, waitMs); })]);
    stream.getTracks().forEach((t) => t.stop());
    return null;
  } catch (e) { return micError(e); } finally { clearTimeout(timer); }
}
// Màu quả cầu của giọng: ổn định theo id, không phụ thuộc thứ tự.
export const hueOf = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360; return h; };
export const LANGS: [string, string][] = [["", "Tự nhận diện"], ["vi", "Tiếng Việt"], ["en", "Tiếng Anh"], ["ja", "Tiếng Nhật"], ["ko", "Tiếng Hàn"], ["zh", "Tiếng Trung"], ["fr", "Tiếng Pháp"],
  ["de", "Tiếng Đức"], ["es", "Tiếng Tây Ban Nha"], ["th", "Tiếng Thái"], ["id", "Tiếng Indonesia"], ["hi", "Tiếng Hindi"], ["pt", "Tiếng Bồ Đào Nha"], ["it", "Tiếng Ý"], ["ru", "Tiếng Nga"]];
export const KIND_LABEL: Record<string, string> = { tts: "Đọc văn bản", dialogue: "Hội thoại", stt: "Chép lời", sfx: "Tiếng động", music: "Nhạc", isolate: "Lọc tạp âm", changer: "Đổi giọng",
  align: "Căn phụ đề", dub: "Lồng tiếng", podcast: "Podcast", book: "Sách nói", call: "Cuộc gọi thử", live: "Chép lời trực tiếp", stems: "Tách stem", native: "Audio Native" };
/** Công cụ mở lại một sản phẩm trong lịch sử. */
export const KIND_TOOL: Record<string, string> = { tts: "tts", dialogue: "tts", stt: "stt", live: "stt", align: "stt", sfx: "sfx", music: "music", stems: "music", isolate: "isolate", changer: "changer",
  dub: "dub", podcast: "studio", book: "studio", call: "agent", native: "native" };
export const CAT_LABEL: Record<string, string> = { premade: "Có sẵn", cloned: "Nhân bản nhanh", generated: "Thiết kế", professional: "Thư viện / chuyên sâu", famous: "Nổi tiếng", high_quality: "Chất lượng studio" };
export const download = (url: string) => { const a = document.createElement("a"); a.href = url + (url.includes("?") ? "&" : "?") + "dl=1"; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove(); };
export const saveText = (name: string, text: string, mime = "text/plain") => {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};
