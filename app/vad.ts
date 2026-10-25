// Phát hiện người dùng nói chen (barge-in) ngay trên trình duyệt, từ mức âm micro đo mỗi khung hình (~16 ms).
// Không phải chờ máy chủ (thường 300–600 ms qua mạng) nên ngắt được trong khoảng 150 ms.
// Tiếng của chính Synchro lọt vào micro (loa ngoài) được trừ hao: đo đỉnh nền lúc vừa bắt đầu phát, theo dõi tiếp khi im,
// và khi biết mức âm đang phát (giọng realtime) thì ngưỡng nâng theo mức đó.

export type VadOpts = {
  minMs?: number;   // phải vượt ngưỡng liên tục bao lâu mới tính là đang nói
  calibMs?: number; // thời gian đo nền khi bắt đầu phát
  floor?: number;   // ngưỡng thấp nhất
  ratio?: number;   // ngưỡng = đỉnh nền × ratio
  echo?: number;    // ngưỡng ≥ mức đang phát × echo (+ nửa ngưỡng thấp nhất)
  hangMs?: number;  // khoảng lặng ngắn giữa các âm tiết vẫn tính là đang nói
};
export type Vad = { reset: (t: number) => void; feed: (mic: number, t: number, out?: number) => boolean; threshold: (out?: number) => number };

export function createVad({ minMs = 120, calibMs = 350, floor = 0.15, ratio = 1.5, echo = 0.6, hangMs = 60 }: VadOpts = {}): Vad {
  let t0 = -1, peak = 0, since = -1, last = -1, fired = false;
  const threshold = (out = 0) => Math.max(floor, peak * ratio, out * echo + floor / 2);
  return {
    reset(t) { t0 = t; peak = 0; since = -1; last = -1; fired = false; },
    threshold,
    /** Đưa vào mức micro (0–1) tại thời điểm t (ms); trả true đúng một lần khi phát hiện người dùng bắt đầu nói. */
    feed(mic, t, out = 0) {
      if (t0 < 0) t0 = t;
      if (fired) return false;
      if (t - t0 < calibMs) { peak = Math.max(peak, mic); return false; }
      const th = threshold(out);
      if (mic > th) {
        if (since < 0) since = t;
        last = t;
        if (t - since >= minMs) { fired = true; return true; }
      } else {
        if (since >= 0 && t - last > hangMs) since = -1;
        // Nền (tiếng ồn, tiếng vọng) đổi theo phòng: học dần khi không có ai nói, giảm chậm (nửa sau ~6 giây).
        if (since < 0) peak = Math.max(peak * 0.998, mic);
      }
      return false;
    },
  };
}
