// Dịch lỗi NỘI DUNG của ElevenLabs (độ dài âm thanh dưới/vượt mức, kích thước tệp) sang tiếng Việt, kèm số theo kiểu Việt.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 300)); };

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-speech-"));
const { speechapi } = await loadTs(["speechapi"]);
const { translateContentErr, explain } = speechapi;

const minMsg = "Audio duration is 3.07 seconds, which is below the minimum of 4.6 seconds";
const tMin = translateContentErr(minMsg);
ok(/^Âm thanh dài 3[.,]07 giây, dưới mức tối thiểu 4[.,]6 giây\./.test(tMin ?? ""), "dịch lỗi độ dài dưới mức tối thiểu", tMin);

const tMax = translateContentErr("Audio duration is 700 seconds, which is above the maximum of 600 seconds");
ok(/vượt mức tối đa 600 giây/.test(tMax ?? ""), "dịch lỗi vượt mức tối đa", tMax);

ok(/quá dài/.test(translateContentErr("The file is too long for this model") ?? ""), "lỗi tệp quá dài", translateContentErr("The file is too long for this model"));
ok(/kích thước tối đa/.test(translateContentErr("Maximum file size exceeded") ?? ""), "lỗi vượt kích thước tệp");
ok(translateContentErr("Something unrelated happened") === null, "lỗi không liên quan: trả null");

// explain(): bọc lỗi ElevenLabs thành SpeechErr tiếng Việt, mã "input".
const e = explain(400, JSON.stringify({ detail: { status: "invalid_content", message: minMsg } }));
ok(/dưới mức tối thiểu 4[.,]6 giây/.test(e.message) && e.code === "input", "explain: trả câu tiếng Việt + mã input", `${e.code} ${e.message}`);

// Lỗi gói vẫn phải giữ nguyên nhánh cũ (không bị nhánh dịch nội dung nuốt mất).
const plan = explain(403, JSON.stringify({ detail: { status: "subscription_required", message: "This feature requires a paid plan" } }), "music");
ok(plan.code === "plan", "explain: lỗi do gói vẫn trả mã plan", plan.code);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
