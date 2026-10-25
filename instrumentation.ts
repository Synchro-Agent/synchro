// Chạy một lần khi máy chủ Next khởi động: chạy lại các lượt trả lời bị gián đoạn khi máy chủ tắt,
// và cài sẵn các plugin studio cho cả tổ chức nếu chưa từng cài.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  setTimeout(async () => {
    try {
      await import("./app/chatengine");
      const { resumeInterrupted } = await import("./app/runs");
      const n = resumeInterrupted();
      if (n) console.log(`[runs] chạy lại ${n} lượt bị gián đoạn`);
    } catch (e) { console.error("[runs]", e); }
  }, 1500);
  if (process.env.SYNCHRO_DEFAULT_PLUGINS === "0") return;
  const { ensureDefaultPlugins } = await import("./app/plugins");
  setTimeout(() => { ensureDefaultPlugins().catch((e) => console.error("[plugins]", e)); }, 5000);
}
