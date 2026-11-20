// pm2 của production khi deploy xanh/lam (docs/van-hanh.md, "Deploy xanh/lam"). Chạy bằng web user:
//   pm2 startOrRestart /var/www/synchro/ecosystem.config.cjs --only synchro-green --update-env
// Hai màu dùng chung thư mục app, data/ và .cache/; mỗi màu một thư mục build (NEXT_DIST_DIR) và một cổng. 3001 là staging, không dùng ở đây.
// - Chạy thẳng node + bin của next, không qua npm: tín hiệu dừng tới đúng tiến trình Next, không bị npm nuốt hay giết trước.
// - NEXT_MANUAL_SIG_HANDLE: Next không tự đóng máy chủ khi nhận SIGTERM; server/drain.ts chờ lượt đang chạy (tối đa 25 giây) rồi mới thoát.
// - kill_timeout 30000: pm2 chờ chừng đó trước khi SIGKILL. treekill false: pm2 không gửi tín hiệu cho CLI con đang trả lời (claude, codex…),
//   để lượt chạy xong trong lúc chờ.
// - SYNCHRO_ROLE=secondary: bật lên chỉ phục vụ yêu cầu; nhận vai primary (việc nền, litestream) khi tệp màu sống chỉ tới màu này và bản cũ
//   đã thoát (server/role.ts).
// - SYNCHRO_SOFFICE_BIN, SYNCHRO_OCR: đọc tệp Office cũ (.doc/.xls/.ppt) bằng LibreOffice và OCR trang PDF scan.
//   Chương trình cài bằng ops/install-media-deps.sh; chưa cài thì tệp đó bị từ chối kèm lý do, trang Sức khỏe hệ
//   thống báo thiếu.
const path = require("node:path");
const APP = __dirname;
const COLORS = { blue: 3000, green: 3002 };

module.exports = {
  apps: Object.entries(COLORS).map(([color, port]) => ({
    name: `synchro-${color}`,
    cwd: APP,
    // Thư viện riêng của màu (.next-<màu>/node_modules → kho theo băm package-lock): deploy đổi package-lock không đổi next dưới chân màu đang chạy.
    script: path.join(APP, `.next-${color}`, "node_modules/next/dist/bin/next"),
    args: ["start", "-p", String(port)],
    interpreter: "node",
    exec_mode: "fork",
    instances: 1,
    autorestart: true,
    kill_signal: "SIGTERM",
    kill_timeout: 30000,
    treekill: false,
    listen_timeout: 60000,
    min_uptime: 10000,
    max_restarts: 10,
    restart_delay: 2000,
    env: {
      NODE_ENV: "production",
      PORT: String(port),
      NEXT_DIST_DIR: `.next-${color}`,
      NEXT_MANUAL_SIG_HANDLE: "1",
      SYNCHRO_ROLE: "secondary",
      SYNCHRO_COLOR: color,
      SYNCHRO_LIVE_FILE: "/var/lib/synchro-ops/live-color",
      SYNCHRO_SOFFICE_BIN: "/usr/bin/soffice",
      SYNCHRO_OCR: "1",
    },
  })),
};
