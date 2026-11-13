"use client";
// Tách khỏi pluginsui.tsx và skillsui.tsx (nặng, tải chậm khi mở Kho kỹ năng) vì trang chủ luôn cần các nút studio.
import { useEffect, useState } from "react";
import { getLang } from "./i18n";

type Studio = "design" | "slides" | "docs";
type Lib = { name: string; skills: number; autoTotal?: number; catalogLibs?: number };
/** Số đếm có phân cách hàng nghìn theo ngôn ngữ giao diện (2.431 / 2,431). */
export const fmtCount = (n: number) => n.toLocaleString(getLang() === "en" ? "en-US" : "vi-VN");
// Báo cho thanh nhập và trang Artifacts biết plugin vừa đổi (studio có thêm skill).
export const PLUGINS_CHANGED = "synchro:plugins";
export const HUB_SEARCH = "synchro:hub-search";
export const HUB_DISCOVER = "synchro:hub-discover";
export const SKILLS_CHANGED = "skills:changed";
export const SKILL_STUDIOS = "skills:studios";

// Plugin đang gắn với các studio (để trang Artifacts và thanh chế độ hiện số skill).
export function useStudios(on = true) {
  const [m, setM] = useState<Partial<Record<Studio, Lib>>>({});
  useEffect(() => {
    if (!on) return;
    // Qua cachedJson (blueprint A3.6): trang chủ, nút Thêm skill (ghadd.tsx) và Kho kỹ năng (skillsui.tsx) dùng chung một lần hỏi; lần mở trang đầu
    // đã có sẵn từ gói khởi động (seedMeta), không hỏi lại.
    const load = () => cachedJson<PluginsMeta>(META).then((j) => {
      if (!j || (!j.studios && !j.plugins)) return;
      // Máy chủ đếm sẵn (gồm skill Synchro tự nhận diện thuộc mục — từ Kho kỹ năng và plugin khác); máy chủ cũ thì tự đếm plugin studio.
      if (j.studios) { setM(j.studios); return; }
      const o: Partial<Record<Studio, Lib>> = {};
      for (const p of j.plugins ?? []) if (p.studio && p.enabled && p.mine.enabled) { const c = o[p.studio]; o[p.studio] = { name: c ? `${c.name}, ${p.name}` : p.name, skills: (c?.skills ?? 0) + p.skillCount }; }
      setM(o);
    }).catch(() => {});
    load();
    // Skill thêm / sửa / xóa trong Kho kỹ năng có thể vào hoặc ra khỏi một mục (Synchro tự nhận diện): đếm lại.
    const evs = [PLUGINS_CHANGED, SKILLS_CHANGED, SKILL_STUDIOS];
    for (const e of evs) window.addEventListener(e, load);
    return () => { for (const e of evs) window.removeEventListener(e, load); };
  }, [on]);
  return m;
}

/** Quyền và số skill của các studio (/api/plugins?view=meta). */
export const META = "/api/plugins?view=meta";
export type PluginsMeta = { admin?: boolean; canInstall?: boolean; plugins?: { studio: Studio | null; enabled: boolean; mine: { enabled: boolean }; name: string; skillCount: number }[]; studios?: Partial<Record<Studio, Lib>> };
/** Gieo /api/plugins?view=meta từ gói khởi động dựng sẵn ở máy chủ (app/bootdata.ts): lần hỏi đầu của trang dùng bản này. */
export function seedMeta(j: PluginsMeta | null | undefined) { if (j) seedJson(META, j); }

// Danh sách skill và thư viện (cả trăm KB): menu + và bảng lệnh ⌘K mỗi lần mở từng tải lại từ đầu. Giữ 5 phút, gọi trùng thì dùng chung,
// có thay đổi trong Kho kỹ năng thì bỏ bản đệm. Lần tải lỗi không được giữ.
const jsonCache = new Map<string, { at: number; p: Promise<unknown> }>();
if (typeof window !== "undefined") for (const e of [PLUGINS_CHANGED, SKILLS_CHANGED, SKILL_STUDIOS]) window.addEventListener(e, () => jsonCache.clear());
export function cachedJson<T>(url: string, ttl = 300_000): Promise<T> {
  const hit = jsonCache.get(url);
  if (hit && Date.now() - hit.at < ttl) return hit.p as Promise<T>;
  const p = fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).catch(() => { jsonCache.delete(url); return {}; });
  jsonCache.set(url, { at: Date.now(), p });
  return p as Promise<T>;
}
/** Đặt sẵn một kết quả vào bộ đệm của cachedJson (dữ liệu dựng ở máy chủ), giữ như một lần tải thật. */
export function seedJson(url: string, data: unknown) { jsonCache.set(url, { at: Date.now(), p: Promise.resolve(data) }); }
