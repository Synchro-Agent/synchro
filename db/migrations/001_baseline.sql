-- 001 — lược đồ gốc: mọi bảng, chỉ mục, trigger mà mã trước khi có bộ chạy migration tạo ra (db/schema.sql cũ cộng phần mỗi mô-đun tự
-- tạo lúc dùng lần đầu), cột của từng bảng đúng thứ tự như cơ sở dữ liệu đang chạy: cột khai lúc tạo, rồi tới các cột bản cũ thêm sau
-- bằng ALTER TABLE (002 thêm những cột đó cho bảng cũ còn thiếu).
-- Cơ sở dữ liệu có sẵn: mọi thứ ở đây đều đã có thì bộ chạy chỉ ghi user_version, không chạy câu nào; thiếu bảng nào (mô-đun chưa
-- từng được dùng) thì chạy, và mọi câu đều IF NOT EXISTS nên không đụng vào bảng đã có. Không sửa tệp này nữa: thay đổi mới là tệp mới.

-- ---- tài khoản, phiên, nhật ký, skill, GitHub (trước đây db/schema.sql) ----
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
  perms          TEXT, -- JSON quyền riêng (NULL = theo mặc định do quản trị đặt)
  instructions   TEXT,
  role           TEXT
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
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);

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

-- Đường dẫn đặt lại mật khẩu do quản trị viên tạo (chưa có dịch vụ gửi email). Chỉ lưu băm của mã, dùng một lần, hết hạn sau 24 giờ.
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_by TEXT
);

-- Xác minh email khi đăng ký: lưu băm của mã, mỗi tài khoản một mã còn hiệu lực.
CREATE TABLE IF NOT EXISTS email_verifications (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

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
  created_at INTEGER NOT NULL,
  refresh    TEXT,
  expires_at INTEGER,
  refresh_expires_at INTEGER,
  checked_at INTEGER,
  broken     INTEGER NOT NULL DEFAULT 0
);

-- ---- server/ai/replicate.ts ----
CREATE TABLE IF NOT EXISTS replicate_budget (day TEXT NOT NULL, user_id TEXT NOT NULL, images INTEGER NOT NULL DEFAULT 0, usd REAL NOT NULL DEFAULT 0, PRIMARY KEY (day, user_id));

-- ---- server/ai/subs.ts ----
CREATE TABLE IF NOT EXISTS engine_sessions (user_id TEXT NOT NULL, conv TEXT NOT NULL, cli TEXT NOT NULL, session_id TEXT NOT NULL, turns INTEGER NOT NULL, updated_at INTEGER NOT NULL, tooled INTEGER, sys_parts TEXT, PRIMARY KEY (user_id, conv, cli));
CREATE TABLE IF NOT EXISTS engine_turns (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, cli TEXT NOT NULL, at INTEGER NOT NULL, via TEXT NOT NULL, model TEXT);
CREATE INDEX IF NOT EXISTS engine_turns_user ON engine_turns(user_id, cli, at);
CREATE TABLE IF NOT EXISTS engine_api_optin (user_id TEXT NOT NULL, cli TEXT NOT NULL, until INTEGER NOT NULL, PRIMARY KEY (user_id, cli));
CREATE TABLE IF NOT EXISTS engine_session_log (user_id TEXT NOT NULL, conv TEXT NOT NULL, cli TEXT NOT NULL, session_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, conv, cli, session_id));

-- ---- server/appstore.ts ----
CREATE TABLE IF NOT EXISTS apps (id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, type TEXT NOT NULL, content TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'private', conv TEXT NOT NULL, ident TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      opens INTEGER NOT NULL DEFAULT 0, UNIQUE(owner, conv, ident));
CREATE INDEX IF NOT EXISTS apps_owner ON apps(owner, updated_at);
CREATE TABLE IF NOT EXISTS app_data (ref TEXT NOT NULL, owner TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, size INTEGER NOT NULL,
      updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (ref, owner, key));
CREATE TABLE IF NOT EXISTS app_visits (app TEXT NOT NULL, user_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (app, user_id));
CREATE INDEX IF NOT EXISTS app_visits_user ON app_visits(user_id);

-- ---- server/artifactstore.ts ----
CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, conv TEXT NOT NULL, ident TEXT NOT NULL, title TEXT NOT NULL,
      type TEXT NOT NULL, lang TEXT, versions TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(user_id, conv, ident));
CREATE INDEX IF NOT EXISTS artifacts_user ON artifacts(user_id, updated_at);

-- ---- server/auth/flows.ts ----
CREATE TABLE IF NOT EXISTS email_changes (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, new_email TEXT NOT NULL, expires_at INTEGER NOT NULL);

-- ---- server/brain.ts ----
CREATE TABLE IF NOT EXISTS brain_notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, tkey TEXT NOT NULL, conv TEXT,
        body TEXT NOT NULL DEFAULT '', props TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(user_id, tkey));
CREATE INDEX IF NOT EXISTS brain_notes_conv ON brain_notes(user_id, conv);
CREATE INDEX IF NOT EXISTS brain_notes_updated ON brain_notes(user_id, updated_at);
CREATE TABLE IF NOT EXISTS brain_links (user_id TEXT NOT NULL, src TEXT NOT NULL, dkey TEXT NOT NULL, dtitle TEXT NOT NULL, PRIMARY KEY (src, dkey));
CREATE INDEX IF NOT EXISTS brain_links_dst ON brain_links(user_id, dkey);
CREATE TABLE IF NOT EXISTS brain_queue (user_id TEXT NOT NULL, conv TEXT NOT NULL, feature TEXT NOT NULL, snapshot TEXT NOT NULL, updated_at INTEGER NOT NULL,
        tries INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, conv));
CREATE TABLE IF NOT EXISTS brain_state (user_id TEXT PRIMARY KEY, dirty INTEGER NOT NULL DEFAULT 0, hub_at INTEGER NOT NULL DEFAULT 0, garden_at INTEGER NOT NULL DEFAULT 0, merge_at INTEGER NOT NULL DEFAULT 0, maps_at INTEGER NOT NULL DEFAULT 0, ins_at INTEGER NOT NULL DEFAULT 0, profile_dirty INTEGER NOT NULL DEFAULT 0, maps_n INTEGER NOT NULL DEFAULT 0, learn_err TEXT, learn_err_at INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS brain_log (user_id TEXT NOT NULL, at INTEGER NOT NULL, text TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS brain_log_user ON brain_log(user_id, at);
CREATE TABLE IF NOT EXISTS instructions_history (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, at INTEGER NOT NULL, source TEXT NOT NULL, text TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS instructions_history_user ON instructions_history(user_id, at);

-- ---- server/browserext.ts ----
CREATE TABLE IF NOT EXISTS browser_devices (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      browser TEXT, created_at INTEGER NOT NULL, last_seen INTEGER);
CREATE INDEX IF NOT EXISTS browser_devices_user ON browser_devices(user_id);
CREATE TABLE IF NOT EXISTS browser_pair_codes (code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);

-- ---- server/caps.ts ----
CREATE TABLE IF NOT EXISTS user_caps (user_id TEXT PRIMARY KEY, caps TEXT NOT NULL, updated_at INTEGER NOT NULL);

-- ---- server/chatstore.ts ----
CREATE TABLE IF NOT EXISTS user_items (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, id TEXT NOT NULL, upd INTEGER NOT NULL, rev INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0, data TEXT, size INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, kind, id));
CREATE INDEX IF NOT EXISTS user_items_rev ON user_items(user_id, rev);
CREATE INDEX IF NOT EXISTS user_items_meta ON user_items(user_id, rev, kind, id, upd, deleted, size);

-- ---- server/codestore.ts ----
CREATE TABLE IF NOT EXISTS code_prefs (user_id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS code_sessions (
      user_id TEXT NOT NULL, id INTEGER NOT NULL, title TEXT NOT NULL, data TEXT, pinned INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
      state TEXT, reason TEXT, suggest TEXT, running INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, touched_at INTEGER NOT NULL, PRIMARY KEY (user_id, id));
CREATE TABLE IF NOT EXISTS code_prs (
      user_id TEXT NOT NULL, sid INTEGER NOT NULL, repo TEXT NOT NULL, number INTEGER NOT NULL, url TEXT, branch TEXT, base TEXT, head_sha TEXT,
      state TEXT NOT NULL DEFAULT 'open', fixed_sha TEXT, seen_comment INTEGER NOT NULL DEFAULT 0, busy INTEGER NOT NULL DEFAULT 0, fixes INTEGER NOT NULL DEFAULT 0, ci_fixes INTEGER NOT NULL DEFAULT 0,
      note TEXT, checked_at INTEGER, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, repo, number));
CREATE INDEX IF NOT EXISTS code_prs_state ON code_prs(state);

-- ---- server/collab.ts ----
CREATE TABLE IF NOT EXISTS app_comments (id TEXT PRIMARY KEY, app TEXT NOT NULL, user_id TEXT NOT NULL, body TEXT NOT NULL,
      mentions TEXT NOT NULL DEFAULT '[]', resolved INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS app_comments_app ON app_comments(app, created_at);

-- ---- server/connectors.ts ----
CREATE TABLE IF NOT EXISTS connectors (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL, dir TEXT, enabled INTEGER NOT NULL DEFAULT 1, era TEXT,
      status TEXT NOT NULL DEFAULT 'needs_auth', error TEXT, server_name TEXT, enc_auth TEXT NOT NULL, tools TEXT NOT NULL DEFAULT '[]', perms TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, checked_at INTEGER, icon TEXT, settings TEXT NOT NULL DEFAULT '{}', last_error TEXT, tools_total INTEGER, perms_gone TEXT, empty_seen INTEGER, app_perms TEXT);
CREATE INDEX IF NOT EXISTS connectors_user ON connectors(user_id);
CREATE TABLE IF NOT EXISTS connector_auth (state TEXT PRIMARY KEY, user_id TEXT NOT NULL, connector_id TEXT NOT NULL, enc TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS connector_grants (user_id TEXT NOT NULL, conv TEXT NOT NULL, connector_id TEXT NOT NULL, tool TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, conv, connector_id, tool));

-- ---- server/convtrust.ts ----
CREATE TABLE IF NOT EXISTS conv_untrusted (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, conv TEXT NOT NULL, at INTEGER NOT NULL,
      PRIMARY KEY (user_id, conv));

-- ---- server/feedback.ts ----
CREATE TABLE IF NOT EXISTS skill_votes (user_id TEXT NOT NULL, msg TEXT NOT NULL, skill TEXT NOT NULL, value INTEGER NOT NULL, at INTEGER NOT NULL,
      PRIMARY KEY (user_id, msg, skill));
CREATE INDEX IF NOT EXISTS skill_votes_skill ON skill_votes(skill);

-- ---- server/fileproc/owners.ts ----
CREATE TABLE IF NOT EXISTS file_owners (file_id TEXT NOT NULL, user_id TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, name TEXT, PRIMARY KEY (file_id, user_id));
CREATE INDEX IF NOT EXISTS file_owners_user ON file_owners(user_id);

-- ---- server/memory.ts ----
CREATE TABLE IF NOT EXISTS user_memory (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'chat', created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS user_memory_user ON user_memory(user_id, created_at);

-- ---- server/mfa.ts ----
CREATE TABLE IF NOT EXISTS user_mfa (user_id TEXT PRIMARY KEY, secret TEXT NOT NULL, enabled_at INTEGER, last_step INTEGER NOT NULL DEFAULT 0, recovery TEXT NOT NULL DEFAULT '[]');

-- ---- server/modelreg.ts ----
CREATE TABLE IF NOT EXISTS model_registry (
      key TEXT PRIMARY KEY, provider TEXT NOT NULL, kind TEXT NOT NULL, model_id TEXT NOT NULL, name TEXT NOT NULL, family TEXT NOT NULL, version TEXT NOT NULL DEFAULT '',
      tier TEXT NOT NULL, created INTEGER, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, status TEXT NOT NULL, baseline INTEGER NOT NULL DEFAULT 0,
      caps TEXT NOT NULL DEFAULT '{}', learned TEXT NOT NULL DEFAULT '{}', ctx INTEGER, max_out INTEGER, price TEXT, sources TEXT NOT NULL DEFAULT '{}',
      test TEXT, attempts INTEGER NOT NULL DEFAULT 0, next_test INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0,
      gone_at INTEGER, replaced_by TEXT, notified INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS model_registry_provider ON model_registry(provider);

-- ---- server/ops.ts ----
CREATE TABLE IF NOT EXISTS ops_events (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, first_at INTEGER NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL,
        detail TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 1, user_id TEXT);
CREATE INDEX IF NOT EXISTS ops_kind_at ON ops_events(kind, at);
CREATE TABLE IF NOT EXISTS ops_runs (hour INTEGER NOT NULL, engine TEXT NOT NULL, ok INTEGER NOT NULL DEFAULT 0, fail INTEGER NOT NULL DEFAULT 0, auth INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (hour, engine));

-- ---- server/outputs.ts ----
CREATE TABLE IF NOT EXISTS outputs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS outputs_user ON outputs(user_id, created_at);
CREATE INDEX IF NOT EXISTS outputs_name ON outputs(user_id, name, created_at);

-- ---- server/passkeys.ts ----
CREATE TABLE IF NOT EXISTS user_passkeys (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, public_key BLOB NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0, transports TEXT NOT NULL DEFAULT '[]', device_type TEXT NOT NULL DEFAULT '', backed_up INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, last_used_at INTEGER);
CREATE INDEX IF NOT EXISTS user_passkeys_user ON user_passkeys(user_id);

-- ---- server/plugins.ts ----
CREATE TABLE IF NOT EXISTS plugins (id TEXT PRIMARY KEY, owner TEXT NOT NULL, slug TEXT NOT NULL, catalog_id TEXT, name TEXT NOT NULL, description TEXT NOT NULL,
        author TEXT, homepage TEXT, color TEXT, studio TEXT, everywhere INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1, sources TEXT NOT NULL,
        commits TEXT NOT NULL DEFAULT '{}', size INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, checked_at INTEGER, latest TEXT, auto_tag INTEGER NOT NULL DEFAULT 1, UNIQUE(owner, slug));
CREATE TABLE IF NOT EXISTS plugin_skills (id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT NOT NULL,
        body TEXT NOT NULL, storage_path TEXT NOT NULL, files TEXT NOT NULL, report TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, use_count INTEGER NOT NULL DEFAULT 0,
        last_used_at INTEGER, UNIQUE(plugin_id, name));
CREATE TABLE IF NOT EXISTS plugin_prefs (user_id TEXT NOT NULL, plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE, enabled INTEGER, everywhere INTEGER, PRIMARY KEY (user_id, plugin_id));
CREATE TABLE IF NOT EXISTS plugin_removed (plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE, name TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (plugin_id, name));
CREATE TABLE IF NOT EXISTS skill_studio_user (user_id TEXT NOT NULL, studio TEXT NOT NULL, name TEXT NOT NULL, added INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, studio, name));
CREATE TABLE IF NOT EXISTS plugin_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- ---- server/plugjob.ts ----
CREATE TABLE IF NOT EXISTS plugin_jobs (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plugin_catalog_removed (catalog_id TEXT PRIMARY KEY, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS plugin_catalog_blocked (catalog_id TEXT PRIMARY KEY, name TEXT NOT NULL, reason TEXT NOT NULL, commit_sha TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS plugin_catalog_failed (catalog_id TEXT PRIMARY KEY, name TEXT NOT NULL, reason TEXT NOT NULL, kind TEXT NOT NULL, commit_sha TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL);

-- ---- server/providers.ts ----
CREATE TABLE IF NOT EXISTS api_providers (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, base_url TEXT, enc_key TEXT NOT NULL, key_hint TEXT NOT NULL,
      models TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'ok', error TEXT, info TEXT, checked_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, workspace_id TEXT);

-- ---- server/refs.ts ----
CREATE TABLE IF NOT EXISTS tool_refs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, conv TEXT, name TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS tool_refs_user ON tool_refs(user_id, created_at);

-- ---- server/runs/store-memory.ts ----
CREATE TABLE IF NOT EXISTS agent_owner (uid TEXT NOT NULL, sid TEXT NOT NULL, pid INTEGER NOT NULL, started INTEGER NOT NULL, ended INTEGER NOT NULL DEFAULT 0, stop INTEGER NOT NULL DEFAULT 0, boot TEXT, start TEXT, node INTEGER, PRIMARY KEY (uid, sid));

-- ---- server/runs/store-sqlite.ts ----
CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, conv TEXT, kind TEXT NOT NULL DEFAULT 'chat',
      status TEXT NOT NULL, req TEXT, result TEXT, http INTEGER, events TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 1, effects TEXT, ephemeral INTEGER, cancel_req INTEGER, steer_req TEXT, partial TEXT);
CREATE INDEX IF NOT EXISTS runs_user ON runs(user_id, created_at);
CREATE INDEX IF NOT EXISTS runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS runs_updated ON runs(updated_at);
CREATE INDEX IF NOT EXISTS runs_conv ON runs(user_id, conv);
CREATE TABLE IF NOT EXISTS run_events (
      run_id TEXT NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL,
      PRIMARY KEY (run_id, seq));
CREATE TRIGGER IF NOT EXISTS runs_drop_events AFTER DELETE ON runs BEGIN DELETE FROM run_events WHERE run_id = OLD.id; END;

-- ---- server/sharestore.ts ----
CREATE TABLE IF NOT EXISTS shares (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, conv TEXT NOT NULL, title TEXT NOT NULL,
        snap TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(user_id, conv));
CREATE INDEX IF NOT EXISTS shares_user ON shares(user_id, updated_at);
CREATE TABLE IF NOT EXISTS share_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL, title TEXT NOT NULL, owner TEXT NOT NULL, reason TEXT NOT NULL, ip TEXT NOT NULL, created_at INTEGER NOT NULL);

-- ---- server/skillheal.ts ----
CREATE TABLE IF NOT EXISTS skill_patches (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, skill_id TEXT NOT NULL, skill_name TEXT NOT NULL, path TEXT NOT NULL,
      base_hash TEXT NOT NULL, content TEXT NOT NULL, error TEXT NOT NULL, status TEXT NOT NULL, mutating INTEGER NOT NULL, attempts INTEGER NOT NULL,
      created_at INTEGER NOT NULL, used_at INTEGER, uses INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS skill_patches_by ON skill_patches(user_id, skill_id, path, status);

-- ---- server/skillscan.ts ----
CREATE TABLE IF NOT EXISTS skill_scans (user_id TEXT PRIMARY KEY, at INTEGER NOT NULL, data TEXT NOT NULL);

-- ---- server/skillstudio.ts ----
CREATE TABLE IF NOT EXISTS skill_studios (key TEXT PRIMARY KEY, studios TEXT NOT NULL, src TEXT NOT NULL, sig TEXT NOT NULL, why TEXT, model_at INTEGER, at INTEGER NOT NULL);

-- ---- server/speechapi.ts ----
CREATE TABLE IF NOT EXISTS speech_budget (day TEXT NOT NULL, user_id TEXT NOT NULL, credits INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, user_id));
CREATE TABLE IF NOT EXISTS speech_voice_owner (voice_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, source TEXT);
CREATE TABLE IF NOT EXISTS speech_items (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}',
      file TEXT, mime TEXT, size INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS speech_items_user ON speech_items(user_id, created_at DESC);

-- ---- server/tasks.ts ----
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, prompt TEXT NOT NULL, schedule TEXT NOT NULL,
      model TEXT, enabled INTEGER NOT NULL DEFAULT 1, next_run_at INTEGER, last_run_at INTEGER, created_at INTEGER NOT NULL, browser TEXT NOT NULL DEFAULT 'auto', memory INTEGER NOT NULL DEFAULT 1, wait_since INTEGER, retries INTEGER NOT NULL DEFAULT 0, engine TEXT NOT NULL DEFAULT 'chat');
CREATE INDEX IF NOT EXISTS tasks_due ON tasks(enabled, next_run_at);
CREATE TABLE IF NOT EXISTS task_runs (run_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, owner TEXT NOT NULL, title TEXT NOT NULL, at INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0, kind TEXT NOT NULL DEFAULT 'run', note TEXT, retried INTEGER NOT NULL DEFAULT 0, result TEXT);
CREATE INDEX IF NOT EXISTS task_runs_owner ON task_runs(owner, at);
CREATE TABLE IF NOT EXISTS notices (id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL, link TEXT, at INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS notices_owner ON notices(owner, at);
CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, owner TEXT NOT NULL, task_id TEXT, run_id TEXT, kind TEXT NOT NULL, key TEXT NOT NULL, title TEXT NOT NULL,
        summary TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', result TEXT, at INTEGER NOT NULL, decided_at INTEGER);
CREATE INDEX IF NOT EXISTS proposals_owner ON proposals(owner, status, at);

-- ---- server/tracing.ts ----
CREATE TABLE IF NOT EXISTS trace_daily (day TEXT NOT NULL, stage TEXT NOT NULL, provider TEXT NOT NULL, n INTEGER NOT NULL, samples TEXT NOT NULL, PRIMARY KEY (day, stage, provider));

-- ---- server/usage.ts ----
CREATE TABLE IF NOT EXISTS usage_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, at INTEGER NOT NULL, model TEXT NOT NULL, feature TEXT NOT NULL,
        input INTEGER NOT NULL, output INTEGER NOT NULL, cache_read INTEGER NOT NULL, cache_write INTEGER NOT NULL, cost REAL NOT NULL);
CREATE INDEX IF NOT EXISTS usage_events_user ON usage_events(user_id, at);
CREATE INDEX IF NOT EXISTS usage_events_at ON usage_events(at);
CREATE TABLE IF NOT EXISTS usage_users (user_id TEXT PRIMARY KEY, session_start INTEGER, week_anchor INTEGER, override TEXT);
CREATE TABLE IF NOT EXISTS usage_config (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);

-- ---- server/vecstore.ts ----
CREATE TABLE IF NOT EXISTS vec_items (scope TEXT NOT NULL, owner TEXT NOT NULL, item TEXT NOT NULL, user_id TEXT NOT NULL, model TEXT NOT NULL,
        dim INTEGER NOT NULL, hash TEXT NOT NULL, src_at INTEGER NOT NULL, vec BLOB, at INTEGER NOT NULL, PRIMARY KEY (scope, item));
DROP INDEX IF EXISTS vec_items_owner;
CREATE INDEX IF NOT EXISTS vec_items_own ON vec_items(scope, owner, model, dim, at);
