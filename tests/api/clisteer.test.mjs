// Tin nhắn thêm khi lượt gói (CLI) đang chạy (server/chat/clisteer.ts), không cần dev:mock:
// - Cắt lượt chỉ khi model đang làm: CLI còn khởi động (chưa có sự kiện đầu) hay đang chạy công cụ dựng sẵn (tìm web)
//   thì tin chờ; có sự kiện đầu / công cụ xong là cắt ngay.
// - Bước ẩn của Synchro (hold): không cắt, tin chờ vòng lặp đọc sau bước đó.
// - Kênh giữa lượt (turn/steer): tin tới trong lúc lần gửi trước còn chờ CLI vẫn được gửi ngay khi lần đó xong; phần đã
//   viết vào nhật ký đúng lúc engine báo ranh giới (atEdge), rồi mới tới tin của người dùng.
// - Kênh từ chối: tin giữ lại cho lần làm tiếp, lượt bị cắt.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => {
  c ? pass++ : fail++;
  console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 600));
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-clisteer-"));
process.env.DATA_DIR = path.join(tmp, "data"); process.env.SYNCHRO_ENGINE_HOME = path.join(tmp, "engine");
process.env.DATA_KEY = "k";
delete process.env.SYNCHRO_ENGINE_USER; delete process.env.WS_AGENT_URL;
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
const M = await loadTs(["authstore", "runs", "server/chat/clisteer"]);
const { authstore: AS, runs: RN } = M;
const { cliSteer } = M["server/chat/clisteer"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const u = AS.createUser({ email: "cs@clisteer.test", name: "CS", verified: true });

/** Chạy f(ctx) trong một lượt thật (ngữ cảnh lượt, hộp thư); ctx.push gửi tin nhắn thêm như yêu cầu HTTP. */
async function inTurn(kind, f) {
  let id = null, out;
  const ready = new Promise((r) => { RN.registerExec(kind, async () => {
    while (!id) await sleep(5);
    out = await f({ push: (t) => RN.pushInbox(id, u.id, t) });
    r();
    return { http: 200, json: { text: "xong" } };
  }); });
  id = RN.startRun(u, kind, {}, `c-${kind}`);
  await ready;
  await sleep(50);
  return { out, run: RN.getRun(id, u.id) };
}

try {
  console.log("1. CLI còn khởi động: tin chờ tới sự kiện đầu của model rồi mới cắt");
  {
    const { out } = await inTurn("cs-start", async ({ push }) => {
      const s = cliSteer("claude", () => false, () => {});
      const sig = s.arm();
      push("thêm một ý");
      await sleep(80);
      const before = sig.aborted;
      s.onPhase("working");
      await sleep(10);
      const after = sig.aborted, cut = s.cut(), left = s.take();
      s.close();
      return { before, after, cut, left };
    });
    ok(out.before === false, "chưa có sự kiện đầu: không cắt (CLI chưa đọc tin, chưa ghi phiên)", out);
    ok(out.after && out.cut && out.left.join() === "thêm một ý", "có sự kiện đầu: cắt ngay, tin chờ lần làm tiếp", out);
  }

  console.log("2. Công cụ dựng sẵn của CLI đang chạy (tìm web): không cắt ngang");
  {
    const { out } = await inTurn("cs-native", async ({ push }) => {
      const s = cliSteer("claude", () => false, () => {});
      const sig = s.arm();
      s.onPhase("working");
      s.onPhase("native");
      push("đổi ý");
      await sleep(80);
      const during = sig.aborted;
      s.onPhase("working");
      await sleep(10);
      const r = { during, after: sig.aborted };
      s.close();
      return r;
    });
    ok(out.during === false && out.after === true, "đang tìm web: chờ; tìm xong: cắt ở ranh giới bước", out);
  }

  console.log("3. Bước ẩn (bản sửa artifact, sửa slide): không cắt, tin đọc sau bước đó");
  {
    const { out } = await inTurn("cs-hold", async ({ push }) => {
      const s = cliSteer("claude", () => false, () => {});
      s.hold(true);
      const sig = s.arm();
      s.onPhase("working");
      push("tin trong lúc sửa");
      await sleep(80);
      const during = sig.aborted;
      s.hold(false);
      s.idle();
      const r = { during, cut: s.cut(), left: s.take() };
      s.close();
      return r;
    });
    ok(out.during === false && out.cut === false, "bước ẩn chạy hết, không bị cắt (không ghép nửa bản sửa)", out);
    ok(out.left.join() === "tin trong lúc sửa", "tin vẫn còn cho vòng sau", out);
  }

  console.log("4. Kênh giữa lượt: hai tin liền nhau, tin thứ hai không chờ hết lượt");
  {
    const { out, run } = await inTurn("cs-chan", async ({ push }) => {
      const said = [], sent = [];
      const s = cliSteer("codex", () => false, (t) => said.push(t));
      s.arm();
      // Kênh giả: CLI mất 300 ms mới trả lời một lần gửi; ranh giới tới ngay khi nhận (không có tin đang viết).
      s.onInject(async (text, atEdge) => {
        await sleep(300);
        sent.push({ text, at: Date.now() });
        atEdge();
        return true;
      });
      RN.delta("Phần đã viết");
      const t0 = Date.now();
      push("tin một");
      await sleep(60);
      push("tin hai");
      for (let i = 0; i < 40 && sent.length < 2; i++) await sleep(25);
      const r = { sent: sent.map((x) => ({ text: x.text, ms: x.at - t0 })), said, left: s.take() };
      s.idle(); s.close();
      return r;
    });
    ok(out.sent.length === 2 && /tin một/.test(out.sent[0].text) && /tin hai/.test(out.sent[1].text),
      "tin thứ hai được gửi ngay sau khi lần gửi đầu xong", out);
    ok(out.sent[1]?.ms < 900, "tin thứ hai tới CLI dưới 0,9 giây (không đợi CLI xong lượt)", out.sent);
    ok(out.said[0] === "Phần đã viết" && !out.left.length,
      "phần đã viết vào nhật ký ở ranh giới, không tin nào còn sót", out);
    const kinds = (run?.events ?? []).filter((e) => e.kind === "steer").map((e) => e.text);
    ok(kinds.join() === "tin một,tin hai", "mỗi tin một sự kiện steer, đúng thứ tự", kinds);
  }

  console.log("5. Kênh từ chối (bản CLI cũ, lượt vừa xong): giữ tin, cắt lượt khi model đang làm");
  {
    const { out } = await inTurn("cs-reject", async ({ push }) => {
      const s = cliSteer("codex", () => false, () => {});
      const sig = s.arm();
      s.onPhase("working");
      s.onInject(async () => false);
      push("tin bị từ chối");
      for (let i = 0; i < 20 && !sig.aborted; i++) await sleep(20);
      const r = { cut: s.cut(), left: s.take() };
      s.close();
      return r;
    });
    ok(out.cut && out.left.join() === "tin bị từ chối", "tin không mất, lượt cắt để làm tiếp với tin đó", out);
  }

  console.log("6. Antigravity / Grok: không cắt (cắt là mất phiên), tin đọc khi CLI xong lượt");
  {
    const { out } = await inTurn("cs-agy", async ({ push }) => {
      const s = cliSteer("agy", () => false, () => {});
      const sig = s.arm();
      s.onPhase("working");
      push("tin cho agy");
      await sleep(80);
      const r = { aborted: sig.aborted, left: s.take() };
      s.close();
      return r;
    });
    ok(!out.aborted && out.left.join() === "tin cho agy", "không cắt, tin chờ cuối lượt", out);
  }
} catch (e) {
  fail++;
  console.log("  ✗", e.stack ?? e.message);
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
