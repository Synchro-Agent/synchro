-- Thư viện mẫu thiết kế (server/designrefs.ts, server/designstyles.ts).
-- design_history: bản trộn của từng sản phẩm thiết kế (mẫu đã dùng, khóa bảng màu, cặp phông, token).
-- Sản phẩm sau đọc nó để không lặp lại 3 sản phẩm gần nhất; "Lưu làm phong cách của tôi" tìm lại token theo mã
-- bản trộn.
-- Giữ 50 dòng mới nhất mỗi người.
CREATE TABLE IF NOT EXISTS design_history (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, conv TEXT,
  mix_id TEXT NOT NULL, domain TEXT NOT NULL, brand TEXT, ref_ids TEXT NOT NULL, palette_key TEXT NOT NULL,
  font_pair TEXT NOT NULL, preset TEXT NOT NULL, tokens TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS design_history_user ON design_history(user_id, created_at);
CREATE INDEX IF NOT EXISTS design_history_mix ON design_history(user_id, mix_id);
-- design_styles: phong cách người dùng đưa vào. kind "follow": đọc từ liên kết hay ảnh, hết hạn sau 30 ngày;
-- kind "mine": đã lưu, tối đa 20 mỗi người. Ảnh WebP ở DATA_DIR/design-styles/<user_id>/, cột image là tên tệp.
CREATE TABLE IF NOT EXISTS design_styles (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL,
  name TEXT NOT NULL, source TEXT NOT NULL, source_url TEXT, tokens TEXT NOT NULL, image TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER);
CREATE INDEX IF NOT EXISTS design_styles_user ON design_styles(user_id, kind, updated_at);
