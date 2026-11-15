// Kiểu dòng của bảng users / sessions (chỉ kiểu, không có mã chạy).
import "server-only";

export type UserRow = {
  id: string; email: string; name: string; avatar: string | null; password_hash: string | null; email_verified: number;
  status: "active" | "suspended"; created_at: number; last_login_at: number | null; last_seen_at: number | null;
  full_name: string | null; nickname: string | null; birth_date: string | null; occupation: string | null; perms: string | null;
  /** Hướng dẫn cho Synchro (Cài đặt → Tài khoản): áp dụng cho mọi lượt chat và Synchro Code của người này. */
  instructions: string | null;
  /** 'admin': quản trị viên do chủ sở hữu thêm từ giao diện; null: theo cấu hình máy chủ (ADMIN_EMAILS / OWNER_EMAILS) hoặc thành viên. */
  role?: string | null;
};
export type SessionRow = { id: string; user_id: string; method: string; created_at: number; last_seen_at: number; expires_at: number; ip: string | null; user_agent: string | null };
