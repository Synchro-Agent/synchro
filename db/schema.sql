-- Schema tài khoản Synchro (SQLite). Chạy lại mỗi lần mở DB nên mọi lệnh phải idempotent.
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name           TEXT NOT NULL DEFAULT '',
  avatar         TEXT,
  password_hash  TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at     INTEGER NOT NULL,
  last_login_at  INTEGER,
  last_seen_at   INTEGER,
  full_name      TEXT,
  nickname       TEXT,
  birth_date     TEXT,
  occupation     TEXT,
  perms          TEXT  -- JSON quyền riêng (NULL = theo mặc định do quản trị đặt)
);

-- Tài khoản liên kết từ Google / GitHub / Apple
CREATE TABLE IF NOT EXISTS identities (
  provider   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email      TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX IF NOT EXISTS identities_user ON identities(user_id);

-- id = sha256(token cookie); token gốc không bao giờ được lưu
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method       TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS audit (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           INTEGER NOT NULL,
  action       TEXT NOT NULL,
  actor_id     TEXT,
  actor_email  TEXT,
  target_id    TEXT,
  target_email TEXT,
  ip           TEXT,
  detail       TEXT
);
CREATE INDEX IF NOT EXISTS audit_at ON audit(at);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Skill của từng người dùng. Bản hiện hành nằm ở đây; file gốc ở data/skills/<user_id>/<skill_id>/v<N>/
CREATE TABLE IF NOT EXISTS skills (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL,
  body         TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1,
  version      INTEGER NOT NULL,
  versions     TEXT NOT NULL DEFAULT '[]',
  warnings     TEXT NOT NULL DEFAULT '[]',
  use_count    INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  source       TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS skill_files (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id  TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  path      TEXT NOT NULL,
  size      INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  kind      TEXT NOT NULL CHECK (kind IN ('reference', 'script', 'asset')),
  UNIQUE (skill_id, path)
);

-- Bật skill riêng cho một dự án (scope = 'project', scope_id = id dự án của người dùng).
-- Bật cho toàn tài khoản dùng cột skills.enabled.
CREATE TABLE IF NOT EXISTS skill_enablement (
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  scope    TEXT NOT NULL CHECK (scope IN ('user', 'project')),
  scope_id TEXT NOT NULL,
  PRIMARY KEY (skill_id, scope, scope_id)
);

-- Kết nối GitHub để làm việc với repo trong Synchro Code (token mã hóa AES-GCM, không bao giờ gửi về trình duyệt)
CREATE TABLE IF NOT EXISTS github_links (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  gh_id      TEXT NOT NULL,
  login      TEXT NOT NULL,
  token      TEXT NOT NULL,
  scopes     TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
