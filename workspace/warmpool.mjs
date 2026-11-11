// Kho container khởi động sẵn cho lần chạy code (chat): bật một container của image synchro-ws mất khoảng một giây, lặp lại ở mỗi lần
// chạy. Dịch vụ giữ sẵn vài container rảnh (WS_WARM_POOL / SYNCHRO_WARM_POOL, mặc định 2, 0 = tắt) đang chạy "sleep infinity"; lần chạy
// lấy một cái và chạy lệnh bằng docker exec nên không phải chờ khởi động.
// An toàn: mỗi container chỉ dùng MỘT lần (không bao giờ trả lại kho, không dùng chung giữa người dùng hay giữa hai lần chạy), xóa ngay
// khi chạy xong; kho tự bù cái mới ở nền. Container trong kho chưa chạy code của ai, chỉ có thư mục rỗng riêng của nó.
// Bộ nhớ: không bù khi máy còn dưới WS_WARM_MIN_MB (mặc định 1536 MB) bộ nhớ khả dụng. Image đổi (build lại cùng tên) thì bỏ cả kho và
// dựng lại bằng image mới; dịch vụ tắt thì xóa hết.
import crypto from "node:crypto";
import fs from "node:fs";

/** Bộ nhớ khả dụng (MB): MemAvailable trên Linux (gồm bộ đệm trả lại được), nơi khác thì os.freemem. */
export async function memAvailableMB() {
  try {
    const m = /MemAvailable:\s+(\d+)\s+kB/.exec(fs.readFileSync("/proc/meminfo", "utf8"));
    if (m) return Math.round(Number(m[1]) / 1024);
  } catch { /* không phải Linux */ }
  const os = await import("node:os");
  return Math.round(os.freemem() / 1048576);
}

/**
 * o.docker(args, opts) → { code, out, err }: chạy lệnh docker. o.createArgs(name, ip, dir): đối số "docker run -d …" của một container rảnh.
 * o.pickIp() / o.releaseIp(ip): IP cố định trong mạng chạy code (container có mạng được nhận ra theo IP). o.dirOf(id): thư mục riêng gắn vào container.
 */
export function createWarmPool(o) {
  const size = Math.max(0, Math.min(8, Number.isFinite(o.size) ? o.size : 2));
  const minMemMB = o.minMemMB ?? 1536;
  const log = o.log ?? (() => {});
  const memMB = o.memMB ?? memAvailableMB;
  const idle = [];
  const stats = { started: 0, taken: 0, misses: 0, failed: 0, drained: 0, lowMem: 0 };
  let closed = size === 0, filling = null, imageId = "", imageAt = 0, timer = null, lowLogged = false;

  const imageNow = async () => {
    const r = await o.docker(["image", "inspect", "-f", "{{.Id}}", o.image], { timeout: 15_000 });
    return r.code ? "" : r.out.trim();
  };
  const removeOne = async (c) => {
    await o.docker(["rm", "-f", c.name], { timeout: 20_000 });
    o.releaseIp(c.ip);
    try { fs.rmSync(c.dir, { recursive: true, force: true }); } catch { /* đã xóa */ }
  };
  async function startOne() {
    const id = crypto.randomBytes(6).toString("hex"), name = "swarm-" + id, dir = o.dirOf(id);
    const ip = o.pickIp();
    if (!ip) return false;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { fs.chownSync(dir, Number(o.uid ?? 1500), Number(o.uid ?? 1500)); } catch { /* không chạy bằng root (kiểm thử) */ }
    const t0 = Date.now();
    const r = await o.docker(o.createArgs(name, ip, dir), { timeout: 90_000 });
    if (r.code) {
      stats.failed++;
      log("kho container: không bật được", (r.err || r.out).trim().slice(0, 200));
      await removeOne({ name, ip, dir });
      return false;
    }
    const c = { name, ip, dir, image: imageId, at: Date.now(), bootMs: Date.now() - t0 };
    if (closed) { await removeOne(c); return false; }
    idle.push(c);
    stats.started++;
    return true;
  }
  /** Bù cho đủ kho (một lượt mỗi lúc). Image đổi thì bỏ các container cũ trước. */
  function fill() {
    if (closed || filling) return filling ?? Promise.resolve();
    filling = (async () => {
      const img = await imageNow();
      imageAt = Date.now();
      if (img && imageId && img !== imageId) { log("image đổi: bỏ kho container cũ"); await drop(); }
      if (img) imageId = img;
      if (!img) return;
      // Container rảnh đã mất (Docker khởi động lại, ai đó xóa tay): bỏ khỏi kho.
      if (idle.length) {
        const r = await o.docker(["ps", "--filter", "label=synchro.run=_warm", "--format", "{{.Names}}"], { timeout: 15_000 });
        if (!r.code) {
          const alive = new Set(r.out.split("\n").map((x) => x.trim()).filter(Boolean));
          for (let i = idle.length - 1; i >= 0; i--) if (!alive.has(idle[i].name)) { const [c] = idle.splice(i, 1); stats.lost = (stats.lost ?? 0) + 1; o.releaseIp(c.ip); try { fs.rmSync(c.dir, { recursive: true, force: true }); } catch { /* đã xóa */ } }
        }
      }
      let fails = 0;
      while (!closed && idle.length < size && fails < 2) {
        if ((await memMB()) < minMemMB) {
          stats.lowMem++;
          if (!lowLogged) log(`kho container: bộ nhớ khả dụng dưới ${minMemMB} MB, tạm không bù`);
          lowLogged = true;
          break;
        }
        lowLogged = false;
        if (!(await startOne())) fails++;
      }
    })().catch((e) => log("kho container", e.message)).finally(() => { filling = null; });
    return filling;
  }
  async function drop() {
    const list = idle.splice(0);
    stats.drained += list.length;
    await Promise.all(list.map(removeOne));
  }
  return {
    size,
    /** Lấy một container rảnh (của image hiện tại) để dùng đúng một lần; null khi kho trống / đã tắt. Luôn bù ở nền. */
    take() {
      if (closed) return null;
      // Image vừa đổi mà chưa tới nhịp kiểm tra (60 giây): không phát container đã quá 90 giây chưa kiểm lại image.
      const c = Date.now() - imageAt < 90_000 ? idle.shift() : null;
      if (c) stats.taken++; else stats.misses++;
      setImmediate(() => { void fill(); });
      return c ?? null;
    },
    fill,
    /** Tắt dịch vụ: không bù nữa, xóa mọi container rảnh. */
    async drain() { closed = true; if (timer) clearInterval(timer); timer = null; await filling; await drop(); },
    /** Bỏ cả kho rồi dựng lại (image vừa build lại). */
    async refresh() { await filling; await drop(); imageId = ""; return fill(); },
    start(everyMs = 60_000) { if (closed) return; void fill(); timer = setInterval(() => { void fill(); }, everyMs); timer.unref?.(); },
    stats: () => ({ size, idle: idle.length, ...stats }),
  };
}
