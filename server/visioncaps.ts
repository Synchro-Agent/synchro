// Model nào nhìn được ảnh: quyết định lượt thiết kế gửi ảnh mẫu tham chiếu hay chỉ gửi token và lời giải thích,
// định tuyến việc thiết kế ưu tiên model có mắt, và ai được làm người chấm bằng mắt. Không gọi mạng, không gọi hãng.
import "server-only";
import { splitKey } from "../shared/catalog";
import { codeOnly } from "../shared/modelrules";
import { modelParams } from "./modelreg";
import { deepseekVision } from "./llmcall";
import { vendorOf } from "../shared/vendor";
import { subCli } from "./ai/subs";

/**
 * Gói subscription (Claude Code, Codex, Antigravity, Grok CLI) đều nhận ảnh đính kèm (cli_engines.ts). Khóa API: theo
 * sổ model (vision === false là chỉ đọc chữ, lần thử của sổ model ghi lại); DeepSeek chỉ bản đọc được ảnh. Model chỉ
 * để viết code thì không tính, dù hãng nhận ảnh: nó không phải người dựng hay người chấm thiết kế.
 */
export function seesImages(key: string): boolean {
  if (!key || codeOnly(key)) return false;
  if (subCli(key)) return true;
  const { provider, id } = splitKey(key);
  let vision: boolean | undefined;
  try {
    vision = modelParams(provider, id)?.vision;
  } catch (e) {
    // Sổ model chưa mở được (lúc khởi động, kiểm thử không có DB): coi như chưa biết, theo hãng như bên dưới.
    console.warn(`[visioncaps] không đọc được sổ model cho ${key}: ${(e as Error).message}`);
  }
  if (vendorOf(key) === "deepseek") return vision === true || deepseekVision(id);
  return vision !== false;
}
