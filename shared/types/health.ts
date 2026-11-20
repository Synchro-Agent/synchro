// Số đo sức khỏe hệ thống (server/memstat.ts, server/loopdelay.ts, server/ops.ts) mà ui/healthui.tsx hiện.
// Chỉ có kiểu (xóa khi biên dịch): mô-đun gốc xuất lại các kiểu này nên mã đang nhập từ đó không đổi.

// Từ server/memstat.ts.
export type MemSample = { at: number; heapUsed: number; heapTotal: number; external: number; arrayBuffers: number; rss: number };

// Từ server/loopdelay.ts.
export type LoopSample = { at: number; p50: number; p99: number; max: number; windowSec: number };

// Từ server/ops.ts.
export type BackupStatus = { ok: boolean; at: number; lastOkAt?: number; snapshot?: string; sizeMB?: number; integrity?: string; tables?: number; users?: number; hasKey?: boolean; keyOk?: boolean | null; uploads?: number; missingUploads?: number; checked?: number; corrupt?: number; offsite?: boolean; offsiteOk?: boolean; error?: string };
export type WatchdogState = { at: number; fails: number; status: string; lastRestartAt?: number; restarts24?: number };
export type Problem = { code: string; level: "crit" | "warn"; n?: number; at?: number };

// Từ server/fileproc/mediacaps.ts. state: ok = đọc được; off = chưa bật (biến môi trường); missing = bật mà không
// thấy chương trình; broken = có chương trình nhưng chạy thử thất bại. version: phiên bản hay công cụ, khi đo được.
export type MediaCap = { state: "ok" | "off" | "missing" | "broken"; on: boolean; version?: string };
export type MediaCaps = { at: number; heic: MediaCap; office: MediaCap; ocr: MediaCap };
