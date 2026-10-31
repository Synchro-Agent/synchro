# ADR 0001: Dùng gói subscription qua "CLI engine"

- **Trạng thái:** Đã chấp nhận. Đã làm bước 2–6 (engine, runtime, đăng nhập, ba engine, dự phòng API), tab Providers và vòng tròn usage. Công cụ của Synchro qua MCP còn để sau.
- **Ngày:** 26/10/2026
- **Phạm vi:** Cài đặt → Providers, bộ chọn model, lõi chat, vòng tròn usage
- **Mã nguồn:** `app/ai/` (engine, selector, errors, cli_runtime, cli_auth, cli_engines, api_engine, subs), `app/api/engines/`, `app/providersui.tsx`, `scripts/mock-cli/`, `scripts/setup-engine-user.sh`

## Bối cảnh

Chủ Synchro đã có gói Claude, ChatGPT và Gemini. Anh muốn đăng nhập các tài khoản đó vào Synchro, để Synchro tự nhận model và dùng các tính năng như bình thường. Synchro có nhiều thành viên: mỗi người tự đăng nhập gói của mình, còn khóa API do quản trị viên nhập thì dùng chung cho toàn hệ thống.

Chính sách của các hãng (kiểm tra ngày 26/10/2026):

- **Anthropic:**
  - Cấm ứng dụng bên thứ ba cung cấp đăng nhập Claude.ai hoặc tự gửi yêu cầu bằng thông tin đăng nhập gói.
  - Cho phép người dùng chạy **Claude Code bản gốc** bằng gói của chính mình, kể cả trên máy chủ ([Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)).
  - `claude setup-token` và biến `CLAUDE_CODE_OAUTH_TOKEN` được tài liệu chính thức hướng dẫn cho chạy theo kịch bản.
- **Google:**
  - Dùng đăng nhập Gemini CLI trong công cụ khác bị coi là vi phạm; nhiều tài khoản trả phí đã bị khóa ([diễn đàn Google AI](https://discuss.ai.google.dev/t/urgent-mass-403-tos-bans-on-gemini-api-antigravity-for-open-source-cli-users-paid-tier/124508)).
  - Antigravity CLI (`agy`) là CLI chính chủ cho tài khoản cá nhân.
- **OpenAI:**
  - Codex CLI đăng nhập bằng tài khoản ChatGPT là đường chính thức.
  - Riêng "Sign in with ChatGPT" cho web chạy trên máy chủ thì phải được OpenAI duyệt ([OpenAI](https://developers.openai.com/siwc/website)).

## Quyết định

1. **Không dùng OAuth của gói để Synchro tự gọi API.** Không lấy token ra để gọi API, không giả danh ứng dụng của hãng.
2. **CLI engine:**
   - Cài CLI chính chủ vào thư mục nhà riêng của engine (`SYNCHRO_ENGINE_HOME`, mặc định `<DATA_DIR>/engine`):
     - `claude`: npm `@anthropic-ai/claude-code`
     - `codex`: npm `@openai/codex`
     - `agy`: script cài chính thức của Google, có kiểm SHA-512
   - CLI nằm trong `<home>/.local/bin`; `find()` chỉ nhận CLI nằm trong thư mục nhà đó.
   - Quản trị viên bấm Cài trong Cài đặt → Providers.
3. **Đăng nhập bằng lệnh của chính CLI.** Synchro chỉ hiện liên kết, mã thiết bị và nhận mã người dùng dán vào.

   | Hãng | Lệnh | Cách hoàn tất |
   |---|---|---|
   | Claude | `claude setup-token` (mặc định), hoặc `claude auth login --claudeai` | Cần pty; in liên kết, chờ dán mã. Token dài hạn được mã hóa AES-256-GCM trong dữ liệu Synchro và chỉ truyền cho Claude Code qua `CLAUDE_CODE_OAUTH_TOKEN` |
   | ChatGPT | `codex login --device-auth` | In liên kết và mã một lần; CLI tự hoàn tất khi người dùng cho phép |
   | Gemini | `agy` không tham số, chạy trong pty | Tự chọn "Google OAuth", in liên kết, chờ dán mã. Xác nhận bằng `agy models` |

4. **Mỗi tài khoản Synchro một thư mục cấu hình riêng**, quyền 0700: `<home>/logins/<cli>/<uid>`.
   - Biến môi trường dùng để trỏ tới: Claude `CLAUDE_CONFIG_DIR`, Codex `CODEX_HOME`, Antigravity `HOME`.
   - Token Claude nằm ở `<DATA_DIR>/engine-tokens/` (0600), ngoài thư mục của CLI.
   - Gói chỉ dùng cho đúng tài khoản đã đăng nhập.
   - Đăng xuất xóa hẳn thư mục đó và token.
5. **Lớp Engine chung** (`app/ai/engine.ts`):
   - `TurnRequest`: `prompt`, `system`, `model`, `sessionId`, `workdir`, `env`, `history`, `signal`.
   - Luồng sự kiện: `text`, `session`, `usage` (kèm `limits` của gói), `final` (kèm `via`), `error` (`code`: quota / auth / other / aborted / timeout).
   - `engineFor(provider)` chọn `claude`, `codex`, `agy`, `api:<hãng>` hoặc `echo`.
6. **Đọc đầu ra** (đã kiểm với Claude Code 2.1.310, Codex CLI 0.164.0, agy 1.4.7):

   | CLI | Lệnh chạy | Phiên | Hạn mức |
   |---|---|---|---|
   | Claude | `claude -p --output-format stream-json --verbose --include-partial-messages --tools "" [--append-system-prompt] [--model] [--resume]`, prompt qua stdin. `api_retry` 401/403 thì dừng ngay | `system/init` | `rate_limit_event.rate_limit_info.unifiedWindows` (`five_hour`, `seven_day`, `seven_day_overage_included`: `utilization` 0–1, `resetsAt` tính bằng giây, `status`) |
   | ChatGPT | `codex exec [resume <id>] --json --skip-git-repo-check -c sandbox_mode="read-only" [-m] -`; 401 thì dừng ngay | `thread.started` | `codex app-server`: `account/rateLimits/read` (`primary` / `secondary`: `usedPercent`, `windowDurationMins`, `resetsAt`; `planType`, `credits`); `model/list` lấy model |
   | Gemini | `agy --output-format json [--model] [--conversation <id>] -p <prompt>` | `conversation_id` | Bảng `/usage` (`/quota`) trong phiên tương tác: "Five Hour Limit Remaining" và "Weekly Limit Remaining" cho từng nhóm model, đọc qua pty |

7. **Công cụ của Synchro qua MCP: chưa làm.** Hiện lượt chat bằng gói chỉ có văn bản; skill, connector, chạy code và artifact vẫn chạy bằng engine API.
   - Công cụ có sẵn của CLI bị tắt: `claude --tools ""`, Codex chạy sandbox chỉ đọc.
   - Bước sau: máy chủ MCP nội bộ, mỗi lượt một mã riêng, nối vào `claude --mcp-config --strict-mcp-config`, `codex -c mcp_servers…` và `mcp_config.json` của `agy`.
8. **An toàn tiến trình** (`app/ai/cli_runtime.ts`):
   - Biến môi trường chỉ giữ `LANG`, `TZ`, `HOME`, `PATH`, `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_OAUTH_TOKEN`, `CODEX_HOME`. Riêng khi chạy pty thì thêm `TERM`.
   - Đầu ra gửi về trình duyệt và ghi log đều đi qua `redact()`. Mã người dùng dán (terminal in lại) cũng được che.
   - Lệnh mở trình duyệt (`open`, `xdg-open`…) bị thay bằng lệnh giả: CLI trên máy chủ không bao giờ tự mở trình duyệt.
   - Mỗi tiến trình là một process group riêng. Bấm Dừng hoặc chạy quá 30 phút thì kill cả nhóm.
   - `SYNCHRO_ENGINE_USER` chạy CLI bằng user hệ thống riêng qua `sudo -n -u <user> -- env -i …`, nên CLI không đọc được cơ sở dữ liệu hay khóa của Synchro. Root chạy `scripts/setup-engine-user.sh` một lần để tạo user và quy tắc sudo.
9. **Engine khóa API làm dự phòng** (`app/ai/api_engine.ts`):
   - Gói báo hết hạn mức trước khi kịp trả chữ nào: chuyển sang khóa API cùng hãng (claude → Anthropic, codex → OpenAI, agy → Google), nếu quản trị viên đã thêm khóa và người dùng còn hạn mức chi phí API.
   - Lỗi đăng nhập không chuyển sang API: Synchro nhắc người dùng đăng nhập lại.
   - Khóa API chỉ quản trị viên nhập và dùng chung toàn hệ thống. ElevenLabs chỉ dùng khóa API.
10. **Giao diện:** tab "API" trong Cài đặt đổi thành **Providers**, icon con chip.
    - Mọi người thấy "Gói của bạn" với Claude, ChatGPT, Gemini.
    - Quản trị viên thấy thêm nút Cài CLI, khóa API dùng chung và số dư API đã nạp.
    - Model của gói hiện trong bộ chọn model dưới nhóm "Gói của bạn", chỉ cho người đã đăng nhập. Thành viên dùng gói của mình được kể cả khi quản trị viên không cấp model API nào.
    - Lượt chat bằng gói không tính vào hạn mức chi phí API của Synchro.
11. **Vòng tròn usage theo hãng và theo phương thức.** Mốc đặt lại luôn lấy từ hãng. Khi mốc đã qua mà chưa có số mới thì áp quy tắc của hãng:
    - Phiên 5 giờ về 0% và bắt đầu lại ở tin nhắn sau.
    - Hạn mức tuần về 0%, mốc kế tiếp đúng 7 ngày sau mốc cũ.

    | Hãng · phương thức | Quy tắc của hãng | Vòng tròn hiện |
    |---|---|---|
    | Claude · gói | Phiên 5 giờ tính từ tin nhắn đầu tiên. Tuần đặt lại vào một mốc cố định riêng của tài khoản. Max có thêm giới hạn tuần theo model ([Claude Help](https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans)) | Phiên hiện tại, Hằng tuần · mọi model, giới hạn theo model (nếu có) |
    | ChatGPT · gói | Plus: phiên 5 giờ cuốn chiếu và hạn mức tuần. Pro: chỉ hạn mức tuần | Từ `codex app-server`, kèm tên gói và credits |
    | Gemini · gói | Pro, Ultra: hồi mỗi 5 giờ cho tới khi chạm hạn mức tuần; gói khác chỉ có hạn mức tuần. Hai nhóm quota: Gemini, và Claude/GPT ([Antigravity plans](https://antigravity.google/docs/plans), [Models](https://antigravity.google/docs/models)) | Bốn thanh: 2 nhóm × (5 giờ, tuần) |
    | Mọi hãng · API | Hạn mức chi phí của Synchro (phiên 5 giờ, tuần), hạn mức gọi do hãng báo, số dư đã nạp | Số dư = số tiền quản trị viên nhập trừ chi phí thật kể từ lúc nhập. Báo khi còn 20%, 5% và khi hết |

12. **Mô phỏng:** `npm run dev:mock` chép CLI giả (`scripts/mock-cli`) vào `data-mock/engine`. Bản giả lập đủ đăng nhập, chạy lượt, resume, hạn mức theo đúng định dạng thật, và trang đăng nhập giả ở máy chủ mock. Bộ kiểm thử:
    - `tests/api/engine.test.mjs`: tự chạy, không cần máy chủ.
    - `tests/api/providers.test.mjs`: chạy qua API web.

## Hệ quả

**Được:**
- Dùng đúng hạn mức của gói qua CLI chính chủ. Synchro không giữ mật khẩu của hãng nào.
- Model và gói được nhận đúng như trong ứng dụng chính hãng: Claude theo tên viết tắt, Codex theo `model/list`, Gemini theo `agy models`.

**Đánh đổi:**
- Mỗi lượt chậm hơn khoảng 1–3 giây vì phải khởi động tiến trình.
- Hạn mức dùng chung với ứng dụng chính hãng trên máy khác của người dùng.
- Phụ thuộc phiên bản CLI; nên cố định bằng `SYNCHRO_CLAUDE_VERSION` / `SYNCHRO_CODEX_VERSION` khi cài.
- Lượt chat bằng gói chưa có công cụ của Synchro (quyết định 7). Ảnh đính kèm chưa gửi qua CLI.

**Rủi ro:**
- Token `setup-token` được lưu, dù đã mã hóa và chỉ trao cho Claude Code. Nếu Anthropic coi đó là "lưu token gói", hãy đổi mặc định sang `claude auth login --claudeai` (đã có sẵn trong giao diện).
- Anthropic định đặt `--bare` (không dùng đăng nhập gói) làm mặc định cho `-p`. Khi đó phải thêm cờ tắt nó.
- Bảng `/usage` của `agy` là giao diện terminal: định dạng có thể đổi giữa các phiên bản. Khi không đọc được, Synchro ghi rõ là chưa đọc được hạn mức.
- Hãng có thể đổi điều khoản bất cứ lúc nào.

## Phương án đã loại

- **Lấy OAuth token của gói rồi tự gọi API, hoặc giả danh client của CLI:** trái điều khoản của Anthropic và Google; đã có tài khoản bị khóa.
- **"Sign in with ChatGPT":** cần OpenAI duyệt cho web chạy trên máy chủ. Xem lại khi được duyệt.
- **Chỉ dùng khóa API:** không đáp ứng yêu cầu dùng gói đã mua.

## Việc còn mở

- Máy chủ MCP nội bộ để lượt chat bằng gói dùng được skill, connector, chạy code và artifact.
- Kiểm định dạng bảng `/usage` của `agy` và cách đặt tên model của `agy models` bằng tài khoản thật.
- Chạy `scripts/setup-engine-user.sh` trên VPS, rồi đặt `SYNCHRO_ENGINE_HOME` và `SYNCHRO_ENGINE_USER`.

## Bổ sung 2026-10-31: Grok (xAI) và DeepSeek

- **Grok** có CLI chính chủ (xAI Grok Build, lệnh `grok`) đăng nhập bằng gói SuperGrok / X Premium+, nên được nối như ba gói trên:
  - Cài bằng script chính thức `https://x.ai/cli/install.sh` với `GROK_BIN_DIR=<home>/.local/bin` (bản build nằm trong `<home>/.grok`).
  - Đăng nhập: `grok login --device-auth` in link và mã thiết bị ra stderr; CLI tự thoát khi người dùng cho phép. Mỗi tài khoản `HOME` + `GROK_HOME` riêng (`logins/grok/<id>/.grok/auth.json`). Kiểm tra bằng `grok models` ("You are logged in with …", danh sách "* mã (default)" / "- mã").
  - Lượt chat: `grok --prompt-file <tệp> --output-format streaming-json --always-approve --no-memory --no-subagents --no-auto-update --tools search_tool,use_tool[,web_search] --deny Bash|Read|Edit|Write|Grep|Glob|WebFetch[|WebSearch] [--rules <system>] [-m] [--effort] [--resume <id>]`. Sự kiện `text`, `tool_call`, `end` (`sessionId`, `usage`), `error`.
  - Công cụ của Synchro: `grok mcp add --transport http synchro <url>` trước lượt, `grok mcp remove synchro` sau lượt (lần lượt theo từng tài khoản); model gọi qua `use_tool` với tên `synchro__<tên>`. Tệp đính kèm tham chiếu bằng `@<đường dẫn>`.
  - Grok CLI không báo hạn mức còn lại: Synchro chỉ biết khi hãng báo đã chạm giới hạn (khi đó hỏi người dùng có dùng khóa API xAI không).
- **DeepSeek** không cho ứng dụng khác đăng nhập bằng tài khoản (chat trên web miễn phí, API tính theo token), nên chỉ có khóa API.
- Khóa API của cả hai hãng qua `/chat/completions`: Grok nhận `reasoning_effort` từ 4.5 trở lên; DeepSeek ở chế độ suy nghĩ có công cụ đòi gửi lại `reasoning_content` của mọi lượt trả lời trước (lượt cũ trong lịch sử gửi chuỗi rỗng, vẫn bị từ chối thì gửi lại một lần với chế độ suy nghĩ tắt). Tìm web qua công cụ `web_search` của API Responses của chính hãng đó.
