// Mặt tiền chuyển tiếp (H3 bước 6c): lượt Code nay là kho bộ nhớ của RunService (server/runs/store-memory.ts). Giữ đúng các tên export cũ
// một bản phát hành để nơi gọi và loadTs("agentruns") không đổi.
import "server-only";
export { activeAgentCount, activeRun, agentElsewhere, applyAgentStops, latestRun, liveCount, MAX_LIVE_RUNS, runStats, runStream, saveGap, startAgentRun, stopAgentElsewhere, stopAgentRun, stopUserAgentRuns, type AgentRun } from "./runs/store-memory";
