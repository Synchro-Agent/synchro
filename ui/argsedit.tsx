"use client";
// Sửa tham số của công cụ trước khi cho phép (thẻ duyệt công cụ connector): ô JSON, kiểm tra ngay khi gõ theo schema của công cụ
// (shared/connschema.ts validateArgs, cùng hàm máy chủ dùng để kiểm tra lại). Lỗi hiện ngay dưới ô, nút cho phép tắt tới khi hợp lệ.
import { useId } from "react";
import { locale, tr } from "./i18n";
import { validateArgs } from "../shared/connschema";

export type ArgsState = { value: Record<string, unknown> | null; errors: string[]; changed: boolean };
/** Đọc và kiểm tra chữ trong ô: JSON đúng cú pháp, là đối tượng, khớp schema (nếu có). changed: khác tham số ban đầu. */
export function readArgs(text: string, orig: string, schema?: unknown): ArgsState {
  let v: unknown;
  try { v = JSON.parse(text.trim() || "{}"); } catch (e) { return { value: null, errors: [`${tr("JSON chưa đúng cú pháp")}: ${String((e as Error).message).slice(0, 120)}`], changed: true }; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return { value: null, errors: [tr("Tham số phải là một đối tượng JSON ({ … }).")], changed: true };
  let o: unknown = {};
  try { o = JSON.parse(orig || "{}"); } catch {}
  const errors = schema === undefined ? [] : validateArgs(schema, v, locale() === "en-US" ? "en" : "vi", { pattern: true });
  return { value: v as Record<string, unknown>, errors, changed: JSON.stringify(v) !== JSON.stringify(o) };
}

export function ArgsEditor({ text, onText, state, disabled }: { text: string; onText: (t: string) => void; state: ArgsState; disabled?: boolean }) {
  const id = useId();
  const rows = Math.min(16, Math.max(4, text.split("\n").length + 1));
  return (
    <div className="args-ed">
      <label htmlFor={id} className="sr-only">{tr("Tham số (JSON)")}</label>
      <textarea id={id} value={text} rows={rows} spellCheck={false} autoCapitalize="off" autoCorrect="off" disabled={disabled} autoFocus
        aria-invalid={state.errors.length > 0} aria-describedby={state.errors.length ? `${id}-e` : undefined} data-notr
        onChange={(e) => onText(e.target.value)}
        onKeyDown={(e) => {
          // Tab chèn hai dấu cách (sửa JSON thụt lề), Shift+Tab vẫn rời ô.
          if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); const t = e.currentTarget, a = t.selectionStart, b = t.selectionEnd; onText(text.slice(0, a) + "  " + text.slice(b)); requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = a + 2; }); }
        }} />
      {state.errors.length > 0
        ? <ul id={`${id}-e`} className="args-err" role="alert">{state.errors.slice(0, 6).map((e, i) => <li key={i} data-notr>{e}</li>)}</ul>
        : <p className="args-ok" role="status">{state.changed ? tr("Tham số hợp lệ. Cho phép sẽ chạy công cụ với tham số đã sửa.") : tr("Chưa sửa gì.")}</p>}
    </div>
  );
}
