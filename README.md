# Synchro

Synchro (https://synchro.net.nz) là một ứng dụng web để chat với mọi model AI, viết code, dùng giọng nói và tự động hoá công việc. Mỗi người dùng đăng nhập bằng tài khoản của chính mình, kể cả gói miễn phí của các hãng.

- **Chat**: nhiều model qua CLI của gói đăng ký (Claude, Codex, Antigravity, Grok) hoặc qua khóa API. Có artifact (tài liệu, bảng tính, slide, thiết kế, biểu đồ), skill, connector (MCP, Composio), bộ não ghi nhớ và tác vụ hẹn giờ.
- **Synchro Code**: mỗi tài khoản có một workspace Linux riêng gồm terminal, trình duyệt, cây file và git, cùng một agent làm việc trong đó.
- **Chrome của bạn**: tiện ích trình duyệt cho phép Synchro điều khiển Chrome / Edge / Brave của chính người dùng.
- **Giọng nói**: nói chuyện trực tiếp, đọc to câu trả lời, gõ bằng giọng nói.

Giao diện có tiếng Việt và tiếng Anh. Mã viết bằng Next.js 15 (app router) và React 19, dữ liệu nằm trong SQLite (`better-sqlite3`). Máy chủ là một VPS, chạy pm2 sau nginx.

## Video giới thiệu

Tài khoản mới xem một phim giới thiệu dài 43 giây (`ui/introfilm.tsx`). Phim nằm trong repo:

| Tệp | Cỡ | Dùng khi |
|---|---|---|
| `public/intro/synchro-intro-720.mp4` | 3,9 MB | mặc định, màn rộng và màn hẹp |
| `public/intro/synchro-intro.mp4` | 19 MB | chỉ khi xem toàn màn hình (1080p) |
| `public/intro/synchro-intro-poster.jpg` | | ảnh chờ |

Phim dựng bằng Remotion từ dự án riêng `synchro-intro-film`, dự án này không nằm trong repo. `next.config.ts` cho trình duyệt giữ `/intro/*` trong bộ nhớ đệm một tuần. Hai tệp mp4 chưa được chuyển ra R2 hay release asset. Khi chuyển, chỉ cần đổi `SRC_720` / `SRC_1080` trong `ui/introfilm.tsx` và đường dẫn trong `tests/ui/introfilm.mjs`.

## Chạy ở máy

Cần Node 22 (`"engines": { "node": "22.x" }`) và npm. Python 3 với các gói trong `requirements.txt` chỉ cần cho OCR và đọc PDF (`scripts/ocr.py`, `scripts/pdf_extract.py`).

```bash
npm ci
npm run dev:mock        # http://localhost:3200, mọi hãng đều là bản giả lập, không cần khóa thật
npm run dev:mock:fast   # như trên nhưng build bản production một lần rồi next start (nhanh hơn; sửa mã thì chạy lại)
```

`dev:mock` (`tools/dev-mock.mjs`):

- Mở các máy chủ giả lập: API của các hãng model ở cổng 4010 (`tools/mock-providers.mjs`), MCP / Composio ở 4011, workspace ở 4012, GitHub ở 4013. Ngoài ra còn CLI giả (`tools/mock-cli/`), tiện ích trình duyệt giả và các dịch vụ khác trong `tools/mock-*.mjs`.
- Dữ liệu nằm riêng ở `data-mock/`, bản build ở `.next-mock/`. Xóa `data-mock/` là về trạng thái trắng.
- Tài khoản quản trị thử nghiệm được in ra terminal, và chỉ tồn tại trong `data-mock/`.
- Mỗi máy chỉ chạy một bản mock, vì các cổng cố định. Muốn dừng thì dừng đúng tiến trình mình đã bật.

`npm run dev` chạy Next.js với Turbopack trên dữ liệu thật ở `data/`. Model thật cần biến môi trường: chép `.env.example` thành `.env.local` rồi bỏ comment các dòng cần dùng. Khi trống, `/api/llm` trả lời giả lập.

## Cấu trúc thư mục

| Thư mục | Nội dung |
|---|---|
| `app/` | Chỉ có tệp đặc biệt của Next.js: `layout.tsx`, `page.tsx`, `error.tsx`, `not-found.tsx`, `manifest.ts`, các trang con (`terms/`, `privacy/`, `share/`, `oauth/`…), ảnh metadata và 132 route API ở `app/api/**/route.ts`. Route chỉ đọc yêu cầu rồi gọi `server/`. `app/_shell/` là ranh giới client của layout và CSS tải đầu (`globals.css`, `tokens.css`, `synchro-ds.css`…). `app/deckpptx.ts` và `app/design-engine/fonts/` chỉ là bản sao cho bản trước H3 (bản đó đọc chúng theo đường dẫn lúc chạy, kể cả khi còn phục vụ trên cây mã mới lúc deploy hay sau rollback); mã thật ở `ui/deckpptx.ts` và `server/design-engine/fonts/`, bản sao bị xóa ở lần phát hành sau. |
| `server/` | Mã chỉ chạy ở máy chủ. Mỗi tệp mở đầu bằng `import "server-only";`. `chat/` gồm routing, tools, approvals, prompt. `runs/` là `RunService`: một bản đồ lượt đang chạy và một định dạng luồng SSE cho cả lượt chat lẫn lượt Code. `auth/` (người dùng, phiên, mật khẩu, OAuth), `db/` (kết nối, cài đặt), `ratelimit.ts`, `ai/` (CLI engine, chọn model, sinh ảnh), `fileproc/` (đọc tệp tải lên, sandbox), `design-engine/` (poster, font), `routes/`. `authstore.ts` và `chatengine.ts` chỉ còn là mặt tiền chuyển tiếp. |
| `ui/` | Mã giao diện (`"use client"` và phần chỉ trình duyệt dùng): `home.tsx`, `Sidebar.tsx`, `Thread.tsx`, các tệp `*ui.tsx`, worker (`*.worker.ts`), `speech/`, `legal/`, `download/`. CSS tải chậm và CSS vendor nằm ở `ui/styles/`. |
| `shared/` | Mã thuần, cả hai phía dùng chung: từ điển dịch (`i18n-*.ts`), `mdparse.ts`, catalog, dữ liệu thiết kế, kiểu dữ liệu (`shared/types/`). Không import `server/` và không import `ui/`. |
| `db/` | `migrate.mjs` và `migrations/NNN_*.sql` / `*.columns.json`, áp dụng theo `PRAGMA user_version` khi mở cơ sở dữ liệu. Quy tắc nằm trong `db/migrations/README.md`: chỉ thêm, không sửa, không bỏ, vì bản cũ và bản mới dùng chung một cơ sở dữ liệu lúc deploy. `schema.sql` không còn được đọc và sẽ bị xóa ở lần phát hành sau. |
| `ops/` | Script vận hành trên máy chủ, chạy bằng root: `server-build.sh` (deploy), `bluegreen-*.sh`, `setup.sh` (workspace, systemd, nginx, lịch sao lưu), `watchdog.sh`, `backup.sh`, `backup-offsite.sh`, `create-admin.mjs`, `uptime-worker/` (Cloudflare Worker). |
| `scripts/` | Tệp mà máy chủ chạy lúc phục vụ: `extract-worker.mjs`, `ocr.py`, `pdf_extract.py`, `zipguard.mjs`. Các `*.sh` / `create-admin.mjs` còn ở đây chỉ là lớp chuyển tiếp sang `ops/`, giữ một bản phát hành rồi xóa. |
| `tools/` | Công cụ dev: `dev-mock.mjs` và các `mock-*`, `qa.mjs`, `lint.mjs`, `budget.mjs`, các `css-*.mjs`, các bộ sinh (icon, vendor 3D, chart preset, danh mục skill Claude). |
| `tests/` | `api/*.test.mjs` (bộ API), `ui/*.mjs` (bộ giao diện chạy bằng Chrome ẩn qua CDP), `lib/` (`ts.mjs` dịch TS cho test, `srcroots.mjs`, `cdp.mjs`…), `fixtures/`, `evals/`. |
| `workspace/` | Dịch vụ workspace của Synchro Code: `Dockerfile`, `agent.mjs`, trình duyệt dùng chung (`browser-*.mjs`), mẫu tài liệu, Remotion, biểu đồ. |
| `extension/` | Tiện ích trình duyệt "Chrome của bạn" (Manifest V3). `build.mjs` đóng gói tiện ích cho `/api/browser/ext/download`. |
| `catalog/` | Danh mục skill Claude (`claude-directory.json`) và các lựa chọn thay thế. |
| `public/` | Tệp tĩnh: vendor JS (`public/vendor/`, có README ghi giấy phép), tree-sitter wasm, logo connector, phim giới thiệu. |
| `docs/` | `van-hanh.md` (vận hành, deploy, sao lưu, khôi phục), `backup-r2.md`, `adr/`, `score-rubric.md`. |

Ranh giới giữa các thư mục do test kiểm, không chỉ dựa vào quy ước:

- Tệp `"use client"` không được import (trừ `import type`) tệp nào trong `server/`.
- Tệp trong `server/` phải mở đầu bằng `import "server-only"`.
- `app/` chỉ chứa tệp đặc biệt của Next.js.
- Mọi đường dẫn mà test, script, CI hay `package.json` nhắc tới đều phải có thật.

Các điều trên nằm trong `tests/api/paths-guard.test.mjs`. Test đọc mã qua `tests/lib/srcroots.mjs` (`SRC_ROOTS = app, server, ui, shared`). `loadTs()` trong `tests/lib/ts.mjs` tìm mô-đun theo tên ở cả bốn gốc và báo lỗi khi không thấy hoặc thấy hai.

## Kiểm thử

```bash
./node_modules/.bin/tsc --noEmit -p .   # kiểu
npm run lint                            # ESLint cả repo; thoát khác 0 chỉ khi có lỗi (xem docs/van-hanh.md)
npm run build                           # next build (webpack), giống CI và máy chủ

# cần npm run dev:mock hoặc dev:mock:fast đang chạy ở :3200
node tests/run-all.mjs                  # toàn bộ bộ API
node tests/run-all.mjs runs plugins     # chỉ các bộ có tên bắt đầu như vậy
node tests/ui/audit.mjs                 # một bộ giao diện
npm run qa                              # mọi thứ trước khi deploy: ngân sách tải đầu, chỉ số CSS, bộ API, mọi tests/ui/*.mjs
node tools/qa.mjs --list                # danh sách bộ sẽ chạy
```

- `tests/run-all.mjs` tạm nâng hạn mức của tài khoản quản trị thử nghiệm rồi trả lại như cũ khi xong (mặc định `{"session":5,"weekly":40}`).
- `tools/qa.mjs` chạy mọi tệp trong `tests/ui/` trừ danh sách `SKIP`, mỗi mục có lý do. `tests/api/qa-plan.test.mjs` báo đỏ khi có tệp mới không chạy mà cũng không nằm trong `SKIP`.
- Nên chạy `npm run qa` trên `dev:mock:fast` được dựng từ đúng mã sẽ deploy. `tools/budget.mjs` từ chối đo bản build cũ hơn mã nguồn.

## Deploy

Đẩy lên `main` hoặc `staging` thì `.github/workflows/deploy.yml` chạy:

1. Job `verify` chặn deploy: `npm ci` → `tsc --noEmit` → `npm run lint` (đỏ khi có lỗi) → `npm run build` → `dev:mock:fast` → `node tests/run-all.mjs`.
2. Job `deploy`, chỉ khi `verify` xanh: rsync mã cùng bản build `.next-ci` của bước kiểm tra vào `/var/www/synchro-incoming/`, rồi chạy `ops/server-build.sh`. Hai lần deploy đạt cách nhau ít nhất 15 phút. Các lần đẩy liền nhau được gộp thành một lần deploy.

Bộ giao diện chạy ở workflow riêng `.github/workflows/ui-qa.yml` (mỗi tuần, hoặc bấm chạy tay) và chưa chặn deploy. `.github/workflows/uptime.yml` báo khi `/api/health` lỗi: ping mỗi phút do `ops/uptime-worker` làm.

`ops/server-build.sh` (chạy bằng root, mỗi lúc một lần nhờ `flock`):

- Build ở thư mục tạm, không có `data/`. Nếu bản build của CI khớp commit, khớp băm `package-lock.json` và khớp biến `NEXT_PUBLIC_` thì dùng luôn bản đó. `node_modules` chỉ cài lại khi `package-lock.json` đổi, cài vào `/var/www/.synchro-mods/<băm>/`.
- Chunk của các bản trước được chép sang bản mới, để tab đang mở từ bản cũ vẫn tải được trong khoảng một ngày.
- Lỗi ở bất kỳ bước nào trước khi chuyển bản thì web vẫn chạy bản cũ.

### Xanh/lam

Production chạy hai màu trong cùng thư mục `/var/www/synchro`, dùng chung `data/`:

| Màu | Cổng | Thư mục build | pm2 |
|---|---|---|---|
| blue | 3000 | `.next-blue` | `synchro-blue` |
| green | 3002 | `.next-green` | `synchro-green` |

Cổng 3001 là staging. Mỗi lần deploy:

1. Bản mới chạy ở màu đang nghỉ, cạnh bản cũ.
2. `/api/health` ở cổng mới phải báo đúng mã bản mới và `db: true`.
3. nginx được chuyển sang cổng mới (`/etc/nginx/snippets/synchro-upstream.conf`), rồi kiểm tra lại qua nginx. Màu đang sống được ghi vào `/var/lib/synchro-ops/live-color`.
4. Bản cũ nhận SIGTERM và tắt êm (`server/drain.ts`):
   - Các yêu cầu mới tới `/api/llm` và `/api/agent` nhận 503 kèm `Retry-After`, nên trình duyệt gửi lại tới bản mới.
   - Bản cũ chạy nốt các lượt đang dở trong tối đa 25 giây.
   - Lượt chat chưa xong được bản mới chạy lại. Lượt Code chỉ nằm trong bộ nhớ, nên dừng hẳn.

Không có lúc nào nginx trỏ vào một cổng chưa sẵn sàng, nên không có lỗi 502. Bản mới không đạt kiểm tra sức khỏe thì chỉ bị dừng, vì nginx chưa từng trỏ sang nó.

Chỉ một tiến trình giữ vai **primary** (`server/role.ts`, khóa `data/.primary.pid`). Primary chạy litestream, các bộ hẹn giờ và việc nền; tiến trình còn lại chỉ phục vụ yêu cầu.

Màu nghỉ giữ bản build trước. Cách trả lại bản trước bằng tay, cách chuyển một lần từ chế độ một tiến trình (`ops/bluegreen-migrate.sh`) và cách bỏ hẳn xanh/lam đều nằm trong `docs/van-hanh.md`. Cơ sở dữ liệu chỉ thay đổi theo kiểu thêm (xem `db/migrations/README.md`), nên quay lại bản trước không cần hạ lược đồ.

### Sao lưu

- `ops/backup.sh` chạy hằng đêm lúc 03:00.
- Litestream đẩy `data/synchro.db` lên Cloudflare R2 liên tục. Khóa R2 được nhập ở Cài đặt → Sức khỏe hệ thống, không nằm trong tệp môi trường. Xem `docs/backup-r2.md`.
- `ops/backup-offsite.sh` mã hóa tệp tải lên, tệp đã tạo và skill bằng age, rồi đẩy lên cùng bucket R2.

Cách khôi phục nằm trong `docs/van-hanh.md`.

## Tài khoản, đăng nhập và quản trị

Tài khoản lưu trong `data/synchro.db` (SQLite, không vào git, không bị deploy ghi đè). Mật khẩu băm bằng scrypt, phiên đăng nhập là cookie `httpOnly` lưu dạng băm SHA-256 trên máy chủ.

**Tạo tài khoản quản trị** (web không cho đăng ký bằng mật khẩu với email quản trị):

```bash
node ops/create-admin.mjs
```

Trên VPS: `su - synchro -c "cd /var/www/synchro && node ops/create-admin.mjs"`.

**Bật đăng nhập Google / GitHub / Apple**: thêm biến vào `.env.production` (xem `.env.example`) rồi khởi động lại app. Redirect URI cần khai báo ở mỗi nhà cung cấp:

| Nhà cung cấp | Nơi tạo | Redirect URI |
|---|---|---|
| Google | Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application) | `https://synchro.net.nz/api/auth/oauth/google/callback` |
| GitHub | GitHub → Settings → Developer settings → OAuth Apps | `https://synchro.net.nz/api/auth/oauth/github/callback` |
| Apple | Apple Developer → Certificates, IDs & Profiles: tạo App ID bật Sign in with Apple, một Services ID (= `APPLE_CLIENT_ID`) và một Key (.p8) | `https://synchro.net.nz/api/auth/oauth/apple/callback` |


## Workspace của Synchro Code

Mỗi tài khoản có một container Linux riêng (Docker trên VPS) để agent và người dùng làm việc như trong Claude Code:
terminal thật, trình duyệt Chromium dùng chung giữa người dùng và agent, cây file + Monaco, git (clone / commit / push / tạo PR).

- `workspace/Dockerfile`: image `synchro-ws:1` (Node 22, Python 3, git, Chromium…), người dùng không có quyền root.
- `workspace/agent.mjs`: dịch vụ `synchro-ws` (root, chỉ nghe 127.0.0.1:3555) quản lý container, chạy lệnh, PTY và CDP.
  Container bị chặn khỏi mạng nội bộ / máy chủ; tối đa `WS_MAX_RUNNING` (mặc định 4) container chạy cùng lúc, tự dừng sau 20 phút rảnh.
- `ops/setup.sh`: deploy gọi sau mỗi lần build — build lại image khi thay đổi, cài systemd, nginx (`/ws-agent/term`, `/ws-agent/screen`).
- `app/api/agent`: vòng lặp agent (model + công cụ bash, file, trình duyệt, danh sách việc), trả sự kiện NDJSON.
  Chưa có `LLM_API_KEY` thì chạy kịch bản mô phỏng.
- Quyền: tài khoản cần tính năng **Synchro Code** và **Cloud sandbox** (quản trị viên bật/tắt trong tab Quản trị viên).

## Chrome của bạn (tiện ích Synchro)

Ngoài trình duyệt riêng trong workspace, Synchro điều khiển được cả Chrome / Edge / Brave của chính người dùng (giống Claude trong Chrome), với mọi model.

- `extension/`: tiện ích Manifest V3. `control.js` chạy thao tác bằng `chrome.debugger` với đúng lõi thao tác của trình duyệt Synchro
  (`workspace/browser-act.mjs`, chép vào tiện ích thành `act.js`); `link.js` giữ kết nối tới Synchro; `overlay.js` là dải "Synchro đang điều khiển tab này" + nút Dừng.
  Mặc định toàn quyền (mọi tab); người dùng chọn "Chỉ nhóm tab Synchro" trong cửa sổ tiện ích. Không bao giờ điều khiển chính trang Synchro.
- Người dùng tải bản đóng gói ở **Cài đặt → Khả năng → Trình duyệt của bạn** (`/api/browser/ext/download`, gắn sẵn địa chỉ máy chủ), cài bằng Developer mode → Load unpacked
  (hướng dẫn trong app và trong `extension/README.md`), rồi ghép nối bằng mã 8 ký tự dùng một lần. Mỗi tài khoản ghép nối trình duyệt của mình; máy chủ chỉ giữ bản băm của khóa.
- Đường đi: tiện ích xin vé (`/api/browser/ext/connect`) → WebSocket `/ws-agent/ext` của dịch vụ workspace (`workspace/ext-relay.mjs`, nginx mở thêm đường này)
  → máy chủ Next gửi lệnh `browser_*` qua HTTP `/ext`. Model chọn trình duyệt bằng tham số `browser` ("user" khi người dùng nói "Chrome của tôi"); không nói thì theo lựa chọn ở khung trình duyệt.
- dev:mock: bản giải nén sẵn ở `data-mock/extension` (Load unpacked trong Chrome của bạn), hoặc tiện ích giả lập `node tools/mock-extension.mjs --code <mã>`
  (đúng mã của tiện ích trên Chrome thật, cửa sổ riêng). Kiểm thử: `node tests/run-all.mjs ext browser`; `ext-lab` chạy mọi thao tác như người thật
  (gõ từng phím, chọn, chuột, cuộn, kéo thả, tải lên / về, hộp thoại, khung con, shadow DOM, tab, biểu mẫu…) trên trang `tests/fixtures/browser-lab.html`
  ở tiện ích giả lập, tiện ích thật trong Chrome thật (màn hình tỉ lệ 2) và trình duyệt của Synchro.
- Làm như người thật để người dùng chỉ việc ngồi chờ: khung con khác nguồn (biểu mẫu nhúng) đọc và bấm được như trang thường (phiên CDP con);
  nút "Tải lên" mở ô chọn tệp ẩn thì hộp chọn tệp của máy bị chặn và Synchro điền tệp vào (tệp đính kèm trong chat, tệp Synchro tạo ra, hay tệp trên máy),
  vùng kéo thả tệp nhận tệp kéo vào; tải về rồi đọc nội dung (`browser_downloads`); ô ngày / giờ / ô chọn của trình duyệt đặt giá trị thẳng, không mở
  cửa sổ bật lên của hệ điều hành; ctrl+a / c / v chạy đúng trên mọi máy; chuột phải chỗ không có menu riêng không để menu của trình duyệt che màn hình;
  cửa sổ đăng nhập bật lên tự đóng thì quay về tab trước; hộp hỏi quyền của trang (vị trí, thông báo, micro / camera, bộ nhớ tạm) trả lời bằng
  `browser_permission`; tab ở nền hay cửa sổ thu nhỏ vẫn chạy (giữ trang "đang hiện" bằng luồng hình nhỏ, không chuyển tab của người dùng);
  service worker của tiện ích bị Chrome tắt giữa chừng thì thao tác đang chạy báo rõ, thao tác sau đợi tiện ích nối lại rồi làm tiếp đúng tab.
