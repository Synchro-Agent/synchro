// RunService: một dịch vụ lượt chạy cho cả tiến trình. Hai kho phía sau (store-sqlite.ts: lượt chat / tác vụ bền, chạy lại sau khi
// khởi động lại; store-memory.ts: lượt Code giữ trong bộ nhớ, lưu vào phiên), một bản đồ lượt sống (registry.ts), một vòng điều khiển
// từ tiến trình khác (remote.ts) và một định dạng luồng (stream.ts). Route và việc tắt êm đi qua đây; mã cũ nhập server/runs.ts,
// server/agentruns.ts (mặt tiền chuyển tiếp) vẫn chạy như trước.
import "server-only";
import { activeCount } from "./registry";
import { applyAllRemote } from "./remote";
import { runResponse, wireOf, afterOf } from "./stream";
import * as sqlite from "./store-sqlite";
import * as memory from "./store-memory";

export const RunService = {
  // ---- lượt chat / tác vụ (SQLite) ----
  start: sqlite.startRun,
  get: sqlite.getRun,
  list: sqlite.listRuns,
  cancel: sqlite.cancelRun,
  steer: sqlite.pushInbox,
  resume: sqlite.resumeInterrupted,
  sweep: sqlite.sweepRuns,
  persistPartials: sqlite.persistPartials,
  /** Luồng SSE của lượt chat / tác vụ id (đã kiểm chủ lượt). */
  stream: (id: string, req: Request, url = new URL(req.url)) => runResponse(sqlite.chatSource(id), { after: afterOf(req, url), signal: req.signal, wire: "sse" }),

  // ---- lượt Code (bộ nhớ) ----
  startCode: memory.startAgentRun,
  latestCode: memory.latestRun,
  activeCode: memory.activeRun,
  stopCode: (uid: string, sid: string) => memory.stopAgentRun(uid, sid) || memory.stopAgentElsewhere(uid, sid),
  codeElsewhere: memory.agentElsewhere,
  /** Luồng của lượt Code: SSE khi trình duyệt xin, NDJSON kiểu cũ cho thẻ mở trước bản phát hành này. */
  streamCode: (run: memory.AgentRun, req: Request, after = afterOf(req)) => runResponse(memory.codeSource(run), { after, signal: req.signal, wire: wireOf(req) }),

  // ---- cả tiến trình ----
  /** Số lượt đang chạy ở tiến trình này (tắt êm chờ số này về 0). */
  busy: () => activeCount(),
  describe: () => `${activeCount("sqlite")} lượt chat, ${activeCount("memory")} lượt Code`,
  /** Áp lệnh Dừng / nhắn thêm do tiến trình khác ghi (vòng hỏi tự gọi khi có lượt đang chạy). */
  applyRemote: applyAllRemote,
  /** Xóa tài khoản: dừng mọi lượt của người này ở cả hai kho. */
  stopUser: (uid: string) => { sqlite.cancelUserRuns(uid); memory.stopUserAgentRuns(uid); },
};
