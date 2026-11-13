"use client";
// Các công cụ Speech ở thanh bên (chỉ hiện khi đang ở mục Speech): tách khỏi trang chủ để danh mục công cụ (speech/data.ts, hơn 30 KB)
// chỉ tải khi mở Speech, không nằm trong phần tải đầu (blueprint B3.3).
import { TOOL_ICON } from "./toolicons";
import { TOOLS, toolOn, type SpeechTool } from "./data";
import type { Plan } from "./client";

export function SpeechSideTools({ plan, tool, pick }: { plan: Plan | null; tool: SpeechTool; pick: (t: SpeechTool) => void }) {
  return <>{TOOLS.filter((t) => t.k !== "home" && toolOn(plan, t.k)).map((t) => { const Ic = TOOL_ICON[t.k]; return <button key={t.k} data-nav={`sp-${t.k}`} className={`nav-item ${tool === t.k ? "active" : ""}`} onClick={() => pick(t.k)}><Ic size={16} />{t.label}</button>; })}</>;
}
