"use client";
// Tách khỏi pluginsui.tsx và skillsui.tsx (nặng, tải chậm khi mở Kho kỹ năng) vì trang chủ luôn cần các nút studio.
import { useEffect, useState } from "react";

type Studio = "design" | "slides" | "docs";
// Báo cho thanh nhập và trang Artifacts biết plugin vừa đổi (studio có thêm skill).
export const PLUGINS_CHANGED = "synchro:plugins";
export const HUB_SEARCH = "synchro:hub-search";
export const HUB_DISCOVER = "synchro:hub-discover";
export const SKILLS_CHANGED = "skills:changed";
export const SKILL_STUDIOS = "skills:studios";

// Plugin đang gắn với các studio (để trang Artifacts và thanh chế độ hiện số skill).
export function useStudios(on = true) {
  const [m, setM] = useState<Partial<Record<Studio, { name: string; skills: number }>>>({});
  useEffect(() => {
    if (!on) return;
    const load = () => fetch("/api/plugins?view=meta").then((r) => (r.ok ? r.json() : null)).then((j: { plugins?: { studio: Studio | null; enabled: boolean; mine: { enabled: boolean }; name: string; skillCount: number }[]; studios?: Partial<Record<Studio, { name: string; skills: number }>> } | null) => {
      if (!j) return;
      // Máy chủ đếm sẵn (gồm skill Synchro tự nhận diện thuộc mục — từ Kho kỹ năng và plugin khác); máy chủ cũ thì tự đếm plugin studio.
      if (j.studios) { setM(j.studios); return; }
      const o: Partial<Record<Studio, { name: string; skills: number }>> = {};
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
