// Chạy một lần khi máy chủ Next khởi động: chạy lại các lượt trả lời bị gián đoạn khi máy chủ tắt,
// bật bộ hẹn giờ tác vụ nền, và cài sẵn các plugin studio cho cả tổ chức nếu chưa từng cài.
// Deploy xanh/lam (docs/van-hanh.md): việc nền chỉ chạy ở tiến trình primary (app/role.ts). Một tiến trình (SYNCHRO_ROLE trống) là primary ngay;
// bản mới (SYNCHRO_ROLE=secondary) chỉ phục vụ yêu cầu tới khi nginx đã chuyển sang nó và bản cũ đã thoát, rồi mới chạy các việc dưới đây đúng một lần.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Lỗi máy chủ hiện ở Cài đặt → Sức khỏe hệ thống; bật sớm nhất để không sót lỗi lúc khởi động.
  const ops = await import("./app/ops");
  ops.captureConsole();
  // Độ trễ vòng lặp sự kiện: dòng [timing] loop mỗi 60 giây, số mới nhất ở Cài đặt → Sức khỏe hệ thống (app/loopdelay.ts).
  (await import("./app/loopdelay")).startLoopMonitor(Number(process.env.SYNCHRO_LOOP_LOG_MS) || 60_000);
  // Tắt êm (NEXT_MANUAL_SIG_HANDLE, ecosystem.config.cjs): SIGTERM → lượt mới nhận 503 + Retry-After, chờ tối đa 25 giây cho lượt đang chạy, dừng litestream, thoát.
  const { installShutdown, onDrain } = await import("./app/drain");
  const { releasePrimary, startRole } = await import("./app/role");
  // Lượt chat (runs.ts) và lượt Code (agentruns.ts) đang chạy: bản đồ lượt sống dùng chung qua globalThis giữa các gói route.
  let busy = () => 0;
  void Promise.all([import("./app/runs"), import("./app/agentruns")]).then(([r, a]) => { busy = () => r.liveRunCount() + a.activeAgentCount(); }).catch((e) => console.error("[deploy]", e));
  installShutdown({
    busy: () => busy(),
    timeoutMs: Number(process.env.SYNCHRO_DRAIN_MS) || undefined,
    stop: async () => { await (await import("./app/litestream")).stopLitestream(); releasePrimary(); },
  });
  // Ở mọi tiến trình (kể cả secondary): bảng chat sẵn sàng cho yêu cầu đầu tiên.
  setTimeout(async () => {
    try {
      await import("./app/chatengine");
      // Bảng + chỉ mục phủ của đoạn chat: dựng sẵn ở đây để lần /api/chats đầu sau deploy không dựng chỉ mục đồng bộ giữa lúc có tải (A2).
      (await import("./app/chatstore")).ensureStore();
    } catch (e) { console.error("[runs]", e); }
  }, 1500);
  // Kiểm tra sẵn trạng thái đăng nhập gói (Claude, ChatGPT, Gemini, Grok): người mở trang đầu tiên sau deploy không phải chờ CLI mới
  // thấy danh sách model. Chỉ đọc, chạy ở mọi tiến trình.
  setTimeout(() => { import("./app/ai/cli_auth").then((m) => m.warmStatuses()).catch((e) => console.error("[engines]", e)); }, 2000);
  startRole(() => primaryDuties(ops.noteBoot, onDrain));
}

/** Mọi việc chỉ được chạy ở một tiến trình: gọi đúng một lần, lúc khởi động (một tiến trình) hoặc khi secondary nhận vai primary. */
function primaryDuties(noteBoot: (detail?: string) => void, onDrain: (f: () => void) => void) {
  noteBoot(process.env.SYNCHRO_COLOR ?? "");
  // Sao lưu liên tục lên Cloudflare R2 (Cài đặt → Sức khỏe hệ thống): chỉ chạy khi quản trị viên đã bật và máy có litestream.
  setTimeout(() => { import("./app/litestream").then((m) => m.startOnBoot()).catch((e) => console.error("[backup]", e)); }, 3000);
  setTimeout(async () => {
    try {
      await import("./app/chatengine");
      // CLI mồ côi của máy chủ trước phải dừng trước khi chạy lại lượt của nó, không để hai lần chạy cùng tiêu hạn mức.
      const orphans = (await import("./app/ai/cli_runtime")).sweepOrphanClis();
      if (orphans) console.log(`[cli] đã dừng ${orphans} CLI mồ côi`);
      const { resumeInterrupted } = await import("./app/runs");
      const n = resumeInterrupted();
      if (n) console.log(`[runs] chạy lại ${n} lượt bị gián đoạn`);
      // Bộ hẹn giờ tác vụ nền (mỗi 30 giây xem tác vụ nào đến hạn). Tắt êm thì dừng ngay: không mở việc tự động mới trong lúc chờ.
      const tasks = await import("./app/tasks");
      tasks.startScheduler(Number(process.env.SYNCHRO_TASK_TICK_MS) || 30_000);
      onDrain(tasks.stopScheduler);
      // Bộ não tổng hợp: chưng cất đoạn chat theo nhịp của bộ hẹn giờ.
      await import("./app/brain");
      // Connector: kiểm tra lại ở nền theo nhịp của bộ hẹn giờ (công cụ mới, token bị thu hồi, giữ refresh token còn sống).
      const { onTick } = tasks;
      const { recheckConnectors } = await import("./app/connectors");
      // Vấn đề nghiêm trọng (đĩa, thư, sao lưu, nhiều người mất đăng nhập gói): báo quản trị viên, kiểm tra mỗi giờ.
      let opsAt = 0;
      onTick("ops", (now) => { if (now - opsAt < 3_600_000) return; opsAt = now; void import("./app/ops").then((m) => m.opsWatch()).catch((e) => console.error("[ops]", e)); });
      // Dọn mỗi ngày những gì đã hứa giữ có hạn: tệp do code tạo, lượt chạy, kết quả công cụ. Máy chủ có thể chạy hàng tháng không khởi động lại.
      let sweptAt = Date.now();
      onTick("sweep", (now) => {
        if (now - sweptAt < 86_400_000) return;
        sweptAt = now;
        void Promise.all([import("./app/outputs"), import("./app/runs"), import("./app/refs")]).then(([o, r, f]) => { o.sweepOutputs(); r.sweepRuns(); f.sweepRefs(); }).catch((e) => console.error("[sweep]", e));
      });
      // Giọng của tài khoản đã xóa mà lần xóa trên ElevenLabs bị lỗi: thử lại mỗi giờ.
      let voicePurgeAt = 0;
      onTick("voice-purge", (now) => { if (now - voicePurgeAt < 3_600_000) return; voicePurgeAt = now; void import("./app/speechapi").then((m) => m.retryVoicePurges()).catch((e) => console.error("[speech]", e)); });
      // Bộ nhớ của máy chủ: một dòng [timing] mem mỗi 30 phút (cả lần đầu ngay khi khởi động) để thấy nó có lớn dần không.
      const { sampleMem } = await import("./app/memstat");
      let memAt = 0;
      onTick("mem", (now) => { if (now - memAt < 30 * 60_000) return; memAt = now; sampleMem(); });
      onTick("connectors", (now) => { void recheckConnectors(now).catch((e) => console.error("[connectors]", e)); });
      // Model mới của các hãng: dò lúc khởi động (sau 1-3 phút) và mỗi 6 giờ, thử tự động rồi mới cho dùng (app/modelreg.ts).
      (await import("./app/modelreg")).scheduleDiscovery(onTick);
      // CLI của các gói: cập nhật hằng tuần lúc 04:00, kiểm tra trước khi dùng, tự trả về bản trước nếu lượt thật đầu tiên lỗi (app/ai/cliupdate.ts).
      (await import("./app/ai/cliupdate")).startCliUpdates();
      // Giữ kết nối GitHub luôn dùng được: làm mới token có hạn, dùng token định kỳ (mỗi 30 phút xem một lượt).
      const { keepLinksAlive } = await import("./app/github");
      const keep = () => keepLinksAlive().catch((e) => console.error("[github]", e));
      setTimeout(keep, 20_000);
      const keepTimer = setInterval(keep, 30 * 60_000);
      onDrain(() => clearInterval(keepTimer));
      // Pull request của Synchro Code: tự sửa CI lỗi / góp ý mới và tự lưu trữ phiên khi PR xong (theo cài đặt của từng người).
      (await import("./app/prwatch")).startPrWatch(Number(process.env.SYNCHRO_PR_TICK_MS) || 90_000);
    } catch (e) { console.error("[runs]", e); }
  }, 1500);
  // Tệp tạm của các lượt bị dừng đột ngột: dọn sau khi khởi động và mỗi ngày.
  const sweep = () => { import("./app/ai/cli_runtime").then((m) => m.sweepEngineTemp()).catch((e) => console.error("[engines]", e)); };
  setTimeout(sweep, 60_000); setInterval(sweep, 24 * 3600_000).unref?.();
  // Skill và plugin có từ trước khi có tính năng tự xếp mục: xếp vào Tài liệu / Trình bày / Thiết kế bằng bộ luật (model xếp lại khi
  // người dùng mở Kho kỹ năng hoặc lưu skill).
  setTimeout(async () => {
    try { await (await import("./app/plugins")).ensurePluginTags(); (await import("./app/skillstore")).ensureAllStudioTags(); }
    catch (e) { console.error("[skill-studio]", e); }
  }, 4000);
  // Cài sẵn 3 studio (tắt bằng SYNCHRO_DEFAULT_PLUGINS=0), rồi cập nhật studio đã cài theo danh mục mới (luôn chạy: chỉ đụng tới studio đã cài).
  setTimeout(() => {
    import("./app/plugins").then((m) => (process.env.SYNCHRO_DEFAULT_PLUGINS === "0" ? m.syncStudioCatalog : m.ensureDefaultPlugins)()).catch((e) => console.error("[plugins]", e));
  }, 5000);
  // Đang cài hàng loạt từ danh mục skill của Claude thì máy chủ khởi động lại: chạy tiếp phần còn lại.
  // Toàn bộ danh mục skill của Claude là skill mặc định: lần đầu và mỗi khi danh mục cập nhật, cài phần còn thiếu ở nền.
  setTimeout(() => { import("./app/plugjob").then((m) => { m.resumeJob(); m.ensureCatalogDefaults(); }).catch((e) => console.error("[plugins]", e)); }, 8000);
}
