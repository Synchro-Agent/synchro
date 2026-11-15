"use client";
// Phía trình duyệt của Speech: gọi /api/speech, giữ gói ElevenLabs (credit, tính năng) dùng chung cho mọi công cụ và thanh bên.
import { useEffect, useState, useSyncExternalStore } from "react";
import { NO_SERVER } from "../apierr";
import { locale } from "../../app/i18n";

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
    if (j.code === "plan") void refreshPlan(false);
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
export const fmtDur = (s: number) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
export function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "Vừa xong";
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} ngày trước`;
  return new Date(t).toLocaleDateString(locale());
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
