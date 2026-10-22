// Runtime skill: prompt hệ thống, định nghĩa tool, và xử lý tool cho vòng lặp của model (server).
import { enabledSkills, getSkill, readSkillFile, SkillError, type Skill } from "./skillstore";

export const MAX_STEPS = 10;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function skillsPrompt(list: Skill[]): string {
  if (!list.length) return "";
  return `Bạn có thể dùng các skill sau. Mỗi skill là bộ hướng dẫn cho một loại công việc.
Khi yêu cầu của người dùng khớp với mô tả của một skill, hãy gọi load_skill để đọc hướng dẫn đầy đủ TRƯỚC KHI làm, rồi làm đúng theo hướng dẫn đó.
Nếu hướng dẫn nhắc tới file đi kèm (ví dụ references/...), hãy gọi read_skill_file để đọc khi cần. Chỉ dùng skill khi thực sự phù hợp; nếu không có skill nào phù hợp thì trả lời bình thường.

<available_skills>
${list.map((s) => `  <skill><name>${esc(s.name)}</name><description>${esc(s.description)}</description></skill>`).join("\n")}
</available_skills>`;
}

export const SKILL_TOOLS = [
  {
    name: "load_skill",
    description: "Đọc hướng dẫn đầy đủ (SKILL.md) của một skill. Trả về nội dung và danh sách file đi kèm.",
    input_schema: { type: "object", properties: { name: { type: "string", description: "Tên skill trong available_skills" } }, required: ["name"] },
  },
  {
    name: "read_skill_file",
    description: "Đọc một file đi kèm trong skill (ví dụ references/voice.md).",
    input_schema: { type: "object", properties: { name: { type: "string" }, path: { type: "string", description: "Đường dẫn file trong danh sách của skill" } }, required: ["name", "path"] },
  },
];

export type ToolRun = { content: string; is_error: boolean; used: { kind: "skill" | "file"; name: string; path?: string } };

// Trả về lỗi rõ ràng dạng text để model tự sửa; không bao giờ ném lỗi ra ngoài vòng lặp.
export async function runSkillTool(tool: string, input: Record<string, unknown>): Promise<ToolRun> {
  const name = String(input?.name ?? "");
  const used = { kind: (tool === "load_skill" ? "skill" : "file") as "skill" | "file", name, path: input?.path ? String(input.path) : undefined };
  try {
    if (tool !== "load_skill" && tool !== "read_skill_file") return { content: `Không có tool "${tool}"`, is_error: true, used };
    const s = await getSkill(name);
    if (!s || !s.enabled) {
      const names = (await enabledSkills()).map((x) => x.name).join(", ");
      return { content: `Skill "${name}" không tồn tại hoặc đang tắt. Skill đang bật: ${names || "(không có)"}`, is_error: true, used };
    }
    if (tool === "load_skill") {
      const files = s.files.length ? s.files.map((f) => `- ${f.path} (${f.kind}, ${f.size} bytes)`).join("\n") : "(không có file đi kèm)";
      return { content: `<skill name="${esc(s.name)}" version="${s.version}">\n${s.body}\n</skill>\n\nFile đi kèm (đọc bằng read_skill_file):\n${files}`, is_error: false, used };
    }
    const p = String(input?.path ?? "");
    if (!p) return { content: "Thiếu tham số path", is_error: true, used };
    const f = await readSkillFile(s, p);
    if (f.binary) return { content: `File "${p}" là file nhị phân (${f.size} bytes), không đọc được dưới dạng văn bản.`, is_error: false, used };
    return { content: `<skill_file skill="${esc(s.name)}" path="${esc(p)}">\n${f.text}\n</skill_file>${f.truncated ? "\n[Đã cắt bớt vì file quá dài]" : ""}`, is_error: false, used };
  } catch (e) {
    return { content: e instanceof SkillError ? e.message : "Lỗi khi đọc skill", is_error: true, used };
  }
}
