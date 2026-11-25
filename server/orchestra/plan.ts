// Kế hoạch của trưởng nhóm Orchestra: đồ thị việc dạng JSON (nhánh việc, vai trò, thế mạnh cần, đầu vào / đầu ra, phụ
// thuộc). Model viết JSON không phải lúc nào cũng sạch (khối ```json, chữ dẫn, dấu phẩy thừa, id trùng, phụ thuộc vòng
// tròn): hàm đọc ở đây sửa được thì sửa, không sửa được thì trả lý do cụ thể để Synchro nhờ trưởng nhóm viết lại một
// lần.
import "server-only";
import { isSkill, type Skill } from "./profile";
import type { OrchRole } from "../../shared/orchestra";

export type Size = "s" | "m" | "l";
export type PlanTask = {
  id: string; title: string; role: Exclude<OrchRole, "boss">; needs: Skill[]; size: Size; do: string; out: string;
  deps: string[];
};
export type Plan = { split: boolean; tasks: PlanTask[] };
export type PlanRead = { ok: true; plan: Plan } | { ok: false; why: string };

/** Số nhánh tối đa một lượt: nhiều hơn thì phần điều phối tốn hơn phần làm. */
export const MAX_TASKS = 10;
const ROLES = new Set(["manager", "staff", "intern"]);

/** Lấy đối tượng JSON đầu tiên trong chữ của model (bỏ chữ dẫn, khối ```json, dấu phẩy thừa trước } hoặc ]). */
export function jsonOf(text: string): unknown {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const src = fence ? fence[1] : text;
  const a = src.indexOf("{");
  if (a < 0) return null;
  // Tìm dấu } đóng đúng cặp (bỏ qua ngoặc trong chuỗi).
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = a; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === "\"") inStr = false;
      continue;
    }
    if (ch === "\"") inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) { end = i; break; }
  }
  if (end < 0) return null;
  const raw = src.slice(a, end + 1).replace(/,\s*([}\]])/g, "$1");
  try { return JSON.parse(raw); } catch { return null; }
}

const str = (x: unknown, max: number) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "");
const longStr = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");
const cleanId = (x: unknown, i: number) => {
  if (typeof x !== "string" && typeof x !== "number") return `t${i + 1}`;
  const s = String(x).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
  return s || `t${i + 1}`;
};

/**
 * Đọc và kiểm tra kế hoạch. split = false (hoặc dưới 2 nhánh) nghĩa là việc không có nhánh độc lập: chạy một model như
 * thường.
 */
export function parsePlan(text: string): PlanRead {
  const j = jsonOf(text) as { split?: unknown; tasks?: unknown } | null;
  if (!j || typeof j !== "object") return { ok: false, why: "Không đọc được JSON của kế hoạch." };
  if (j.split === false) return { ok: true, plan: { split: false, tasks: [] } };
  if (!Array.isArray(j.tasks)) return { ok: false, why: "Kế hoạch thiếu mảng \"tasks\"." };
  if (j.tasks.length > MAX_TASKS) {
    return { ok: false, why: `Kế hoạch có ${j.tasks.length} nhánh, tối đa ${MAX_TASKS}. Gộp các nhánh nhỏ lại.` };
  }
  const seen = new Map<string, number>();
  const tasks: PlanTask[] = [];
  const rawDeps: unknown[][] = [];
  for (let i = 0; i < j.tasks.length; i++) {
    const t = j.tasks[i] as Record<string, unknown>;
    if (!t || typeof t !== "object") return { ok: false, why: `Nhánh thứ ${i + 1} không phải đối tượng.` };
    let id = cleanId(t.id, i);
    // id trùng: thêm hậu tố, phụ thuộc trỏ tới id gốc vẫn hiểu là nhánh đầu tiên mang id đó.
    while (seen.has(id)) id = `${id}-${i + 1}`;
    seen.set(id, i);
    const doText = longStr(t.do ?? t.input ?? t.instruction, 4000);
    if (!doText) return { ok: false, why: `Nhánh "${id}" thiếu "do" (việc cần làm).` };
    const needs = [...new Set((Array.isArray(t.needs) ? t.needs : []).filter(isSkill))].slice(0, 3);
    const role = typeof t.role === "string" && ROLES.has(t.role) ? t.role as PlanTask["role"] : "staff";
    const size: Size = t.size === "s" || t.size === "l" ? t.size : "m";
    tasks.push({
      id, title: str(t.title, 80) || str(doText, 80), role, needs: needs.length ? needs : ["reason"], size, do: doText,
      out: longStr(t.out ?? t.output, 600), deps: [],
    });
    rawDeps.push(Array.isArray(t.deps) ? t.deps : []);
  }
  for (let i = 0; i < tasks.length; i++) {
    const deps = new Set<string>();
    for (const d of rawDeps[i]) {
      const k = seen.get(cleanId(d, -1));
      if (k === undefined) {
        return { ok: false, why: `Nhánh "${tasks[i].id}" phụ thuộc "${String(d)}" không có trong kế hoạch.` };
      }
      if (k === i) continue;
      deps.add(tasks[k].id);
    }
    tasks[i].deps = [...deps];
  }
  if (layers(tasks) === null) return { ok: false, why: "Các nhánh phụ thuộc nhau thành vòng tròn." };
  if (tasks.length < 2) return { ok: true, plan: { split: false, tasks } };
  return { ok: true, plan: { split: true, tasks } };
}

/**
 * Xếp nhánh theo tầng: tầng sau chỉ chạy khi mọi nhánh nó phụ thuộc đã xong; nhánh cùng tầng chạy song song. null nếu
 * có vòng.
 */
export function layers(tasks: Pick<PlanTask, "id" | "deps">[]): string[][] | null {
  const left = new Map(tasks.map((t) => [t.id, new Set(t.deps)]));
  const out: string[][] = [];
  while (left.size) {
    const ready = [...left].filter(([, d]) => [...d].every((x) => !left.has(x))).map(([id]) => id);
    if (!ready.length) return null;
    for (const id of ready) left.delete(id);
    out.push(ready);
  }
  return out;
}
