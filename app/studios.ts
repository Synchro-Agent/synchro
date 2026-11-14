"use client";
// Tách khỏi pluginsui.tsx và skillsui.tsx (nặng, tải chậm khi mở Kho kỹ năng) vì trang chủ luôn cần các nút studio.
import { useEffect, useState } from "react";
import { locale } from "./i18n";
import { cachedJson, clearJsonCache, seedJson } from "./jsoncache";
export { cachedJson, clearJsonCache, seedJson };

type Studio = "design" | "slides" | "docs";
type Lib = { name: string; skills: number; autoTotal?: number; catalogLibs?: number };
/** Số đếm có phân cách hàng nghìn theo ngôn ngữ giao diện (2.431 / 2,431). */
export const fmtCount = (n: number) => n.toLocaleString(locale());
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

// Bộ đệm JSON dùng chung (app/jsoncache.ts, tách riêng để kiểm thử không cần React): có thay đổi trong Kho kỹ năng thì bỏ bản đệm.
if (typeof window !== "undefined") for (const e of [PLUGINS_CHANGED, SKILLS_CHANGED, SKILL_STUDIOS]) window.addEventListener(e, () => clearJsonCache());
