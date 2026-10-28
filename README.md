This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Tài khoản, đăng nhập và quản trị

Tài khoản lưu trong `data/synchro.db` (SQLite, không vào git, không bị deploy ghi đè). Mật khẩu băm bằng scrypt, phiên đăng nhập là cookie `httpOnly` lưu dạng băm SHA-256 trên máy chủ.

**Tạo tài khoản quản trị** (web không cho đăng ký bằng mật khẩu với email quản trị):

```bash
node scripts/create-admin.mjs
```

Trên VPS: `su - synchro -c "cd /var/www/synchro && node scripts/create-admin.mjs"`.

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
- `workspace/setup.sh`: deploy gọi sau mỗi lần build — build lại image khi thay đổi, cài systemd, nginx (`/ws-agent/term`, `/ws-agent/screen`).
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
- dev:mock: bản giải nén sẵn ở `data-mock/extension` (Load unpacked trong Chrome của bạn), hoặc tiện ích giả lập `node scripts/mock-extension.mjs --code <mã>`
  (đúng mã của tiện ích trên Chrome thật, cửa sổ riêng). Kiểm thử: `node tests/run-all.mjs ext browser`.
