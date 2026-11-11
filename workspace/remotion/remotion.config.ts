// Cấu hình cho `remotion bundle` lúc dựng image (Dockerfile): rspack, khung JPEG, Tailwind v4 cho mẫu next-tailwind như mẫu gốc.
// Khi dựng bằng API Node (cli/synchro-video.mjs) tệp này không áp dụng: tùy chọn dựng truyền thẳng vào renderMedia.
import { Config } from "@remotion/cli/config";
import { enableTailwind } from "@remotion/tailwind-v4";

Config.setRspack(true);
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.overrideBundlerConfig((c) => enableTailwind(c));
