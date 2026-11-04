// Chạy một lần khi máy chủ Next khởi động: chạy lại các lượt trả lời bị gián đoạn khi máy chủ tắt,
// bật bộ hẹn giờ tác vụ nền, và cài sẵn các plugin studio cho cả tổ chức nếu chưa từng cài.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  setTimeout(async () => {
    try {
      await import("./app/chatengine");
      const { resumeInterrupted } = await import("./app/runs");
      const n = resumeInterrupted();
      if (n) console.log(`[runs] chạy lại ${n} lượt bị gián đoạn`);
      // Bộ hẹn giờ tác vụ nền (mỗi 30 giây xem tác vụ nào đến hạn).
      (await import("./app/tasks")).startScheduler(Number(process.env.SYNCHRO_TASK_TICK_MS) || 30_000);
      // Bộ não tổng hợp: chưng cất đoạn chat theo nhịp của bộ hẹn giờ.
      await import("./app/brain");
      // Connector: kiểm tra lại ở nền theo nhịp của bộ hẹn giờ (công cụ mới, token bị thu hồi, giữ refresh token còn sống).
      const { onTick } = await import("./app/tasks");
      const { recheckConnectors } = await import("./app/connectors");
      onTick("connectors", (now) => { void recheckConnectors(now).catch((e) => console.error("[connectors]", e)); });
      // Giữ kết nối GitHub luôn dùng được: làm mới token có hạn, dùng token định kỳ (mỗi 30 phút xem một lượt).
      const { keepLinksAlive } = await import("./app/github");
      const keep = () => keepLinksAlive().catch((e) => console.error("[github]", e));
      setTimeout(keep, 20_000); setInterval(keep, 30 * 60_000);
      // Pull request của Synchro Code: tự sửa CI lỗi / góp ý mới và tự lưu trữ phiên khi PR xong (theo cài đặt của từng người).
      (await import("./app/prwatch")).startPrWatch(Number(process.env.SYNCHRO_PR_TICK_MS) || 90_000);
    } catch (e) { console.error("[runs]", e); }
  }, 1500);
  // Tệp tạm của các lượt bị dừng đột ngột: dọn sau khi khởi động và mỗi ngày.
  const sweep = () => { import("./app/ai/cli_runtime").then((m) => m.sweepEngineTemp()).catch((e) => console.error("[engines]", e)); };
  setTimeout(sweep, 60_000); setInterval(sweep, 24 * 3600_000).unref?.();
  // Kiểm tra sẵn trạng thái đăng nhập gói (Claude, ChatGPT, Gemini, Grok): người mở trang đầu tiên sau deploy không phải chờ CLI mới
  // thấy danh sách model.
  setTimeout(() => { import("./app/ai/cli_auth").then((m) => m.warmStatuses()).catch((e) => console.error("[engines]", e)); }, 2000);
  // Skill và plugin có từ trước khi có tính năng tự xếp mục: xếp vào Tài liệu / Trình bày / Thiết kế bằng bộ luật (model xếp lại khi
  // người dùng mở Kho kỹ năng hoặc lưu skill).
  setTimeout(async () => {
    try { await (await import("./app/plugins")).ensurePluginTags(); (await import("./app/skillstore")).ensureAllStudioTags(); }
    catch (e) { console.error("[skill-studio]", e); }
  }, 4000);
  // Cài sẵn 3 studio (tắt bằng SYNCHRO_DEFAULT_PLUGINS=0), rồi cập nhật studio đã cài theo danh mục mới (luôn chạy: chỉ đụng tới studio đã cài).
  const { ensureDefaultPlugins, syncStudioCatalog } = await import("./app/plugins");
  const run = process.env.SYNCHRO_DEFAULT_PLUGINS === "0" ? syncStudioCatalog : ensureDefaultPlugins;
  setTimeout(() => { run().catch((e) => console.error("[plugins]", e)); }, 5000);
  // Đang cài hàng loạt từ danh mục skill của Claude thì máy chủ khởi động lại: chạy tiếp phần còn lại.
  // Toàn bộ danh mục skill của Claude là skill mặc định: lần đầu và mỗi khi danh mục cập nhật, cài phần còn thiếu ở nền.
  setTimeout(() => { import("./app/plugjob").then((m) => { m.resumeJob(); m.ensureCatalogDefaults(); }).catch((e) => console.error("[plugins]", e)); }, 8000);
}
