// Chạy một lần khi máy chủ Next khởi động: cài sẵn các plugin studio cho cả tổ chức nếu chưa từng cài.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.SYNCHRO_DEFAULT_PLUGINS === "0") return;
  const { ensureDefaultPlugins } = await import("./app/plugins");
  setTimeout(() => { ensureDefaultPlugins().catch((e) => console.error("[plugins]", e)); }, 5000);
}
