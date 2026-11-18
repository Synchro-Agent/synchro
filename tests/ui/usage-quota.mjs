// Gói w10-quota (nhóm A) trên giao diện, bằng Chrome ẩn trên npm run dev:mock:
// 1. Tài khoản miễn phí (quyền mặc định) đăng nhập gói ChatGPT giả lập, đã có lượt dùng khóa API chung trong phiên: vòng mức dùng ở chế độ Tự động
//    có vòng trong cho phần hạn mức chi phí khóa API chung (lỗi 4), nhãn đọc được; Cài đặt → Usage: "Hôm nay: N tin nhắn" chỉ đếm tin của người
//    dùng, việc nền đếm riêng (lỗi 12).
// 2. Chủ sở hữu: Quản trị viên → Giới hạn sử dụng có hạn mức ngày, khóa API chung (cho / chặn, model cao nhất), và từng người có ô ngày + hai hộp
//    chọn khóa chung; máy tính 1280 và điện thoại 375, sáng / tối; không tràn, không cuộn ngang.
// Ảnh: SHOTS (mặc định <tmp>/synchro-ui/usage-quota). Chạy: node tests/ui/usage-quota.mjs (BASE, CDP_PORT).
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { openChrome, sleep, waitFor } from "../lib/cdp.mjs";
import { tempUser, adminClient } from "../lib/tempuser.mjs";

const B = process.env.BASE ?? process.env.SYNCHRO_URL ?? "http://localhost:3200", M = process.env.MOCK_URL ?? "http://127.0.0.1:4010";
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "synchro-ui", "usage-quota");
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 500)); return c; };
const db = () => { const d = new (createRequire(path.join(process.cwd(), "package.json"))("better-sqlite3"))(path.join(process.cwd(), "data-mock", "synchro.db")); d.pragma("busy_timeout = 5000"); return d; };

// Chỗ tràn / cuộn ngang trong khung đang xem (cùng ý với adminpanels.mjs).
const CHECK = `(() => {
  const out = [], vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw + 1) out.push("trang cuộn ngang " + document.documentElement.scrollWidth + " > " + vw);
  const body = document.querySelector(".modal.settings .s-body") || document.body, bb = body.getBoundingClientRect();
  for (const el of body.querySelectorAll("button,input,select,.adm-perm-row,.us-p,.us-p-x,.us-p-l,.api-sel,small")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue;
    if (r.right > Math.min(vw, bb.right) + 1.5 || r.left < Math.max(0, bb.left) - 1.5) out.push("tràn: " + (el.className || el.tagName) + " [" + (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 40) + "]");
  }
  return [...new Set(out)].slice(0, 10);
})()`;

const u = await tempUser(B, "usage-quota", { name: "Usage Quota", fullPerms: false, verified: true });
const admin = await adminClient(B);
let t = null, restoreTop = null;
try {
  console.log("━━ 1. Tài khoản miễn phí: vòng mức dùng có phần khóa API chung, tin nhắn hôm nay chỉ đếm tin của người dùng");
  const st = await u.api("POST", "/api/engines/codex/login/start", {});
  await fetch(`${M}/mock-login/codex/approve?code=${st.j?.userCode}`).catch(() => {});
  ok(!!(await waitFor(async () => (await u.api("GET", "/api/engines/codex/status?fresh=1")).j?.loggedIn, 20_000, { every: 500 })), "đăng nhập gói ChatGPT giả lập");
  // Lượt dùng khóa API chung trong phiên này ($0.50 trên hạn mức phiên mặc định $2), 2 tin nhắn của người dùng và 3 việc nền trên gói.
  const d = db(), now = Date.now();
  d.prepare("INSERT INTO usage_users (user_id, session_start, week_anchor) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET session_start = excluded.session_start, week_anchor = excluded.week_anchor").run(u.uid, now - 60_000, now - 60_000);
  d.prepare("INSERT INTO usage_events (user_id, at, model, feature, input, output, cache_read, cache_write, cost) VALUES (?, ?, ?, 'chat', 1000, 500, 0, 0, 0.5)").run(u.uid, now - 30_000, "anthropic/claude-sonnet-5-5");
  for (const via of ["codex", "codex", "job:title", "job:brain", "job:critic-auto"]) d.prepare("INSERT INTO engine_turns (user_id, cli, at, via, model) VALUES (?, 'codex', ?, ?, 'sub-codex/gpt-6-luna')").run(u.uid, now - 20_000, via);
  d.close();
  const us = (await u.api("GET", "/api/usage?all=1")).j;
  const cx = us?.vendors?.find((v) => v.cli === "codex")?.sub;
  ok(cx?.turnsToday === 2 && cx?.helpersToday === 3, "API: 2 tin nhắn hôm nay (không tính 3 việc nền), việc nền đếm riêng", cx);

  t = await openChrome({ base: B, port: Number(process.env.CDP_PORT ?? 9376), name: "usage-quota", shots: SHOTS });
  await t.P("Network.setCookie", { name: "synchro_session", value: u.cookie.split("=")[1], url: B });
  // Chế độ Tự động như tài khoản miễn phí trên production (bản giả lập có model mặc định riêng): lựa chọn model lưu ở u:<uid>:model.
  await t.P("Page.navigate", { url: `${B}/?uq=seed` });
  await t.until(`!!document.querySelector("textarea")`, 180_000);
  await t.ev(`localStorage.setItem(${JSON.stringify(`u:${u.uid}:model`)}, "auto")`);
  // Vòng mức dùng nằm ở thanh dưới của đoạn chat đang mở: gửi một tin ở chế độ Tự động (bản giả lập trả lời bằng model khóa API nhanh) rồi mở lại đoạn chat đó.
  await t.P("Page.navigate", { url: `${B}/?uq=chat` });
  await t.until(`!!document.querySelector("textarea")`, 180_000);
  const tb = await t.ev(`(() => { const r = document.querySelector("textarea").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  await t.click(tb[0], tb[1]); await t.type("Xin chào"); await t.key("Enter", "Enter", 13);
  ok(await t.until(`location.hash.startsWith("#c=") && !!document.querySelector(".dock .us-ring")`, 120_000), "gửi một tin: đoạn chat mở, có vòng mức dùng");
  await t.until(`!document.querySelector(".msg .typing, .stop-btn, [aria-label='Dừng']")`, 120_000);
  const chatHash = await t.ev("location.hash");
  for (const [w, h, label] of [[1280, 860, "máy tính"], [375, 812, "điện thoại"]]) {
    await t.size(w, h, w < 600);
    for (const th of ["light", "dark"]) {
      await t.P("Page.navigate", { url: `${B}/?uq=${w}${th}${chatHash}` });
      if (!ok(await t.until(`!!document.querySelector(".dock .us-ring")`, 180_000), `${label} ${th}: đoạn chat mở được, có vòng mức dùng`)) { await t.shot(`chat-missing-${w}-${th}`); continue; }
      await t.theme(th);
      const ring = await waitFor(() => t.ev(`(() => { const b = document.querySelector(".dock .us-ring"); if (!b) return null; const a = b.querySelector("circle.api"); return a ? { label: b.getAttribute("aria-label"), dash: a.getAttribute("stroke-dasharray"), r: a.getAttribute("r") } : null; })()`), 30_000, { every: 400 });
      if (!ok(!!ring && /khóa API chung (2[5-9]|3\d)%|shared API key (2[5-9]|3\d)%/.test(ring.label), `${label} ${th}: vòng mức dùng có vòng trong cho khóa API chung (≈25% hạn mức phiên), nhãn đọc được`,
        await t.ev(`({ ring: document.querySelector(".dock .us-ring")?.outerHTML?.slice(0, 400) ?? null, model: localStorage.getItem(${JSON.stringify(`u:${u.uid}:model`)}) })`))) { await t.shot(`ring-missing-${w}-${th}`); continue; }
      ok(await t.ev(`(() => { const b = document.querySelector(".dock .us-ring"); const r = b?.getBoundingClientRect(); return !!r && r.right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1; })()`), `${label} ${th}: vòng nằm trọn màn hình, không cuộn ngang`);
      await t.ev(`(() => { const b = document.querySelector(".dock .us-ring"); b.scrollIntoView({ block: "center" }); })()`);
      await sleep(300);
      await t.shot(`ring-${w}-${th}`);
      // Phóng to vùng vòng tròn để xem vòng trong rõ.
      const rc = await t.ev(`(() => { const r = document.querySelector(".dock .us-ring").getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()`);
      const { data } = await t.P("Page.captureScreenshot", { format: "png", clip: { x: Math.max(0, rc[0] - 6), y: Math.max(0, rc[1] - 6), width: rc[2] + 12, height: rc[3] + 12, scale: 6 } });
      (await import("node:fs")).writeFileSync(`${SHOTS}/ring-zoom-${w}-${th}.png`, Buffer.from(data, "base64"));
    }
  }
  // Cài đặt → Usage: thẻ ChatGPT ghi 2 tin nhắn và 3 việc nền.
  await t.size(1280, 860);
  await t.P("Page.navigate", { url: `${B}/#s=Usage` });
  await t.until(`!!document.querySelector("textarea")`, 120_000);
  await t.ev(`location.hash = "#s=Usage"`);
  const card = await waitFor(() => t.ev(`(() => { const c = [...document.querySelectorAll(".us-vc-f")].map((e) => e.innerText).find((x) => /việc nền|background job/.test(x)); return c || null; })()`), 30_000, { every: 400 });
  // Tin "Xin chào" ở trên đi bằng khóa API (không thêm tin nhắn của gói) nhưng có thể thêm việc nền (đặt tên đoạn chat): so với số máy chủ đang báo.
  const now2 = (await u.api("GET", "/api/usage?all=1")).j?.vendors?.find((v) => v.cli === "codex")?.sub;
  ok(!!card && /Hôm nay: 2 tin nhắn|Today: 2 messages/.test(card) && new RegExp(`${now2?.helpersToday} (việc nền|background jobs?)`).test(card) && now2?.helpersToday >= 3,
    "Cài đặt → Usage: \"Hôm nay: 2 tin nhắn\" và số việc nền riêng", JSON.stringify({ card, now2: { turns: now2?.turnsToday, helpers: now2?.helpersToday } }));
  await t.shot("settings-usage");
  t.close(); t = null;

  console.log("━━ 2. Chủ sở hữu: Giới hạn sử dụng (hạn mức ngày, khóa API chung)");
  // Bản giả lập cho tới hạng mạnh (tools/dev-mock.mjs); đặt về mặc định của máy chủ thật trong lúc kiểm rồi trả lại như cũ.
  const prev = (await admin.api("GET", "/api/admin/usage")).j?.config ?? {};
  restoreTop = () => admin.api("PATCH", "/api/admin/usage", { config: { sharedTop: prev.sharedTop ?? "balanced", sharedKey: prev.sharedKey !== false } });
  await admin.api("PATCH", "/api/admin/usage", { config: { sharedTop: "balanced", sharedKey: true } });
  const a = await admin.api("GET", "/api/admin/usage");
  ok(a.s === 200 && a.j?.config?.sharedTop === "balanced" && a.j.config.sharedKey === true, "khóa chung cho dùng, tới hạng cân bằng (không Opus)", a.j?.config);
  const ms = (await u.api("GET", "/api/models")).j;
  const keys = (ms?.providers ?? []).flatMap((p) => p.models.map((m) => m.key));
  ok(!keys.includes("anthropic/claude-opus-5-5") && keys.some((k) => /sonnet/.test(k)), "bộ chọn model của tài khoản thường: không có Opus trên khóa chung, vẫn có Sonnet", keys.filter((k) => /anthropic/.test(k)));
  ok(a.j?.users?.find((x) => x.id === u.uid)?.shared?.top === "balanced", "từng người có quy tắc khóa chung đang áp", a.j?.users?.find((x) => x.id === u.uid));
  t = await openChrome({ base: B, port: Number(process.env.CDP_PORT ?? 9376) + 1, name: "usage-quota-admin", shots: SHOTS });
  await t.P("Network.setCookie", { name: "synchro_session", value: admin.cookie().split("=")[1], url: B });
  for (const [w, h, label] of [[1280, 860, "máy tính"], [375, 812, "điện thoại"]]) {
    await t.size(w, h, w < 600);
    for (const th of ["light", "dark"]) {
      await t.P("Page.navigate", { url: `${B}/?uqa=${w}${th}` });
      if (!ok(await t.until(`!!document.querySelector("textarea")`, 180_000), `${label} ${th}: trang chủ mở được (quản trị)`)) continue;
      await t.theme(th);
      await t.ev(`location.hash = "#s=Administrator"`);
      const found = await t.until(`[...document.querySelectorAll(".modal.settings .adm-card-h b")].some((e) => /Khóa API chung cho tài khoản thường|Shared API key for regular accounts/.test(e.textContent))`, 40_000);
      if (!ok(found, `${label} ${th}: thấy phần Khóa API chung cho tài khoản thường`)) { await t.shot(`admin-missing-${w}-${th}`); continue; }
      await t.ev(`[...document.querySelectorAll(".modal.settings .adm-card-h b")].find((e) => /Hạn mức mặc định|Default limits|Giới hạn mặc định/.test(e.textContent))?.scrollIntoView({ block: "start" })`);
      await sleep(500);
      let probs = await t.ev(CHECK);
      ok(!probs.length, `${label} ${th}: hạn mức mặc định + khóa chung không tràn`, probs.join(" | "));
      await t.shot(`admin-limits-${w}-${th}`);
      const row = await t.ev(`(() => { const sel = document.querySelector(".us-p-x select[aria-label]"); const p = sel?.closest(".us-p") ?? sel?.closest(".us-ppl > *"); if (!p) return null; p.scrollIntoView({ block: "center" }); return { selects: p.querySelectorAll(".us-p-x select").length, day: !!p.querySelector(".us-p-x input") }; })()`);
      ok(!!row && row.selects === 2 && row.day, `${label} ${th}: mỗi người có ô hạn mức ngày và hai hộp chọn khóa chung`, row);
      await sleep(400);
      probs = await t.ev(CHECK);
      ok(!probs.length, `${label} ${th}: dòng của từng người không tràn`, probs.join(" | "));
      await t.shot(`admin-people-${w}-${th}`);
    }
  }
  ok(!t.logs.length, "không có lỗi JavaScript", t.logs.slice(0, 3));
} catch (e) {
  ok(false, "chạy hết bộ kiểm", e.stack ?? String(e));
} finally {
  t?.close();
  await restoreTop?.();
  await u.remove();
}
console.log(`\nẢnh: ${SHOTS}\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
