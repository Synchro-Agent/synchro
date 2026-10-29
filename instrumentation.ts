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
      // Giữ kết nối GitHub luôn dùng được: làm mới token có hạn, dùng token định kỳ (mỗi 30 phút xem một lượt).
      const { keepLinksAlive } = await import("./app/github");
      const keep = () => keepLinksAlive().catch((e) => console.error("[github]", e));
      setTimeout(keep, 20_000); setInterval(keep, 30 * 60_000);
      // Pull request của Synchro Code: tự sửa CI lỗi / góp ý mới và tự lưu trữ phiên khi PR xong (theo cài đặt của từng người).
      (await import("./app/prwatch")).startPrWatch(Number(process.env.SYNCHRO_PR_TICK_MS) || 90_000);
    } catch (e) { console.error("[runs]", e); }
  }, 1500);
  if (process.env.SYNCHRO_DEFAULT_PLUGINS === "0") return;
  const { ensureDefaultPlugins } = await import("./app/plugins");
  setTimeout(() => { ensureDefaultPlugins().catch((e) => console.error("[plugins]", e)); }, 5000);
}
