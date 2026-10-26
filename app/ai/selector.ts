// Chọn engine theo nhà cung cấp: "claude", "codex", "agy" (CLI chính chủ chạy bằng gói subscription),
// "api:<hãng>" (khóa API dự phòng, đăng ký ở api_engine.ts), "echo" (kiểm thử).
import { AntigravityEngine, ClaudeCodeEngine, CodexEngine } from "./cli_engines";
import { EchoEngine, type Engine } from "./engine";

const factories = new Map<string, () => Engine>([
  ["echo", () => new EchoEngine()],
  ["claude", () => new ClaudeCodeEngine()],
  ["codex", () => new CodexEngine()],
  ["agy", () => new AntigravityEngine()],
]);

/** Đăng ký engine cho một nhà cung cấp (mỗi lần gọi engineFor tạo engine mới). */
export function registerEngine(provider: string, make: () => Engine) {
  factories.set(provider, make);
}

export function engineFor(provider: string): Engine {
  const make = factories.get(provider);
  if (!make) throw new Error(`Chưa có engine cho nhà cung cấp "${provider}".`);
  return make();
}

export const engineProviders = () => [...factories.keys()];
