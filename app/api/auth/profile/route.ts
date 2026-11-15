import { handle, publicUser, requireUser, sameOrigin, updateProfile } from "../../../../server/authstore";
import { recordInstructions } from "../../../../server/brain";

export const runtime = "nodejs";

// Cập nhật hồ sơ (họ tên, tên gọi, ngày sinh, công việc, hướng dẫn cho Synchro); chỉ các trường được gửi lên mới bị đổi.
// Hướng dẫn bạn tự viết được ghi vào lịch sử làm bản gốc: Synchro tự cập nhật dựa trên bản này, không làm mất chữ của bạn.
export const POST = handle(async (req) => {
  sameOrigin(req);
  const { user } = requireUser(req);
  const { fullName, nickname, birthDate, occupation, avatar, instructions } = await req.json();
  const u = updateProfile(req, user, { fullName, nickname, birthDate, occupation, avatar, instructions });
  if (instructions !== undefined && (u.instructions ?? "") !== (user.instructions ?? "")) recordInstructions(u.id, "user", u.instructions ?? "");
  return Response.json({ user: publicUser(u) });
});
