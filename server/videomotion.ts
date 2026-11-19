// Đo chuyển động thật của video model vừa tạo bằng run_code (H1 T10): video logo 8 giây đứng yên từ giây thứ 2 trong khi câu trả lời tả
// "ba vòng tròn mờ lan ra rồi thu về". Ảnh xem trước chỉ là vài khung rời nên không thấy được video có chuyển động hay không.
// Sau lần chạy thành công có video trong outputs/, Synchro dựng lại khung xám 64×36 bằng ffmpeg trong sandbox (tối đa 4 khung/giây), tính mức thay đổi
// trung bình giữa hai khung liền nhau (0–255) theo từng giây, rồi báo trong <video_motion> để model đối chiếu với lời mình tả trước khi báo xong.
// Phần tính toán là hàm thuần: tests/api/video-motion.test.mjs.
import "server-only";
import { execRun, runner, RUN_LIMITS } from "./coderun";

export const MOTION_W = 64, MOTION_H = 36;
/** Dưới mức này (trung bình |khung sau − khung trước| trên thang 0–255, ở cỡ 64×36) coi là đứng yên: nén video tạo nhiễu ~0–0.2. */
export const STILL = 0.4;
const VIDEO = /\.(mp4|m4v|mov|webm|mkv|avi|gif)$/i;

/** Mức thay đổi giữa từng cặp khung liền nhau: t là thời điểm của khung sau (giây). */
export function frameDiffs(raw: Uint8Array, rate: number, w = MOTION_W, h = MOTION_H): { t: number; d: number }[] {
  const n = Math.floor(raw.length / (w * h)), px = w * h, out: { t: number; d: number }[] = [];
  for (let k = 1; k < n; k++) {
    let s = 0;
    for (let i = 0; i < px; i++) s += Math.abs(raw[k * px + i] - raw[(k - 1) * px + i]);
    out.push({ t: k / rate, d: s / px });
  }
  return out;
}

export type Motion = { duration: number; buckets: { from: number; to: number; d: number }[]; stillFrom: number | null; longestStill: { from: number; to: number } | null; flagged: boolean };

/** Hồ sơ chuyển động: trung bình theo từng khoảng (1 giây, video dài thì gộp để còn ≤ 24 khoảng), đoạn đứng yên dài nhất, thời điểm bắt đầu đứng yên tới hết. */
export function motionProfile(diffs: { t: number; d: number }[], duration: number, rate: number): Motion {
  const dur = duration > 0 ? duration : diffs.length ? diffs[diffs.length - 1].t + 1 / rate : 0;
  const step = Math.max(1, Math.ceil(dur / 24));
  const buckets: Motion["buckets"] = [];
  for (let a = 0; a < dur - 1e-6; a += step) {
    const xs = diffs.filter((x) => x.t > a + 1e-6 && x.t <= a + step + 1e-6).map((x) => x.d);
    if (xs.length) buckets.push({ from: a, to: Math.min(dur, a + step), d: xs.reduce((p, q) => p + q, 0) / xs.length });
  }
  // Đoạn đứng yên: các cặp khung liền nhau đều dưới ngưỡng. Một cặp phủ khoảng (t − 1/rate, t].
  let best: { from: number; to: number } | null = null, run: { from: number; to: number } | null = null;
  for (const x of diffs) {
    if (x.d < STILL) { run = run ? { from: run.from, to: x.t } : { from: x.t - 1 / rate, to: x.t }; if (!best || run.to - run.from > best.to - best.from) best = { ...run }; }
    else run = null;
  }
  // Tới hết video: khung cuối lấy mẫu sớm hơn thời lượng một chút.
  const tail = run && dur - run.to <= 1.5 / rate ? run.from : null;
  if (best && tail !== null && best.from === tail) best = { from: tail, to: dur };
  const len = best ? best.to - best.from : 0;
  return { duration: dur, buckets, stillFrom: tail, longestStill: best, flagged: dur >= 2 && len >= Math.max(3, 0.35 * dur) };
}

const s1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
/** Một dòng cho model. */
export function motionLine(name: string, m: Motion, rate: number): string {
  const prof = m.buckets.map((b) => `${s1(b.from).replace(/\.0$/, "")}–${s1(b.to).replace(/\.0$/, "")} s ${s1(b.d)}`).join(" · ");
  const still = m.longestStill && m.flagged
    ? ` GẦN NHƯ ĐỨNG YÊN ${m.stillFrom !== null && m.longestStill.from === m.stillFrom ? `từ ${s1(m.stillFrom)} s đến hết` : `từ ${s1(m.longestStill.from)} s đến ${s1(m.longestStill.to)} s`} (${s1(m.longestStill.to - m.longestStill.from)} s, ${Math.round((100 * (m.longestStill.to - m.longestStill.from)) / m.duration)}% thời lượng).`
    : "";
  return `${name} (${s1(m.duration)} s, đo ${s1(rate).replace(/\.0$/, "")} khung/giây): mức thay đổi giữa hai khung liền nhau (0–255, dưới ${STILL} là đứng yên) theo thời gian: ${prof || "không đủ khung để đo"}.${still}`;
}

// Chạy trong sandbox: mỗi video một tệp khung xám thô và một dòng meta (tên, thời lượng, số khung/giây đã lấy). Không cần mạng.
const SCRIPT = `set -u
mkdir -p outputs
for f in v*; do
  [ -f "$f" ] || continue
  d=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$f" 2>/dev/null | head -n1)
  r=$(awk -v d="\${d:-0}" 'BEGIN{ if (d+0 <= 0) d = 8; r = 240 / d; if (r > 4) r = 4; if (r < 0.25) r = 0.25; printf "%.4f", r }')
  echo "$f \${d:-0} $r" >> outputs/meta.txt
  ffmpeg -v error -nostdin -i "$f" -an -sn -vf "fps=$r,scale=${MOTION_W}:${MOTION_H},format=gray" -frames:v 400 -f rawvideo "outputs/$f.gray" || true
done
`;

/** Thẻ gửi model sau run_code: hồ sơ chuyển động của các video vừa tạo (rỗng nếu không có video hoặc không đo được). */
export async function videoMotionNote(uid: string, files: { path: string; data: Buffer }[], signal?: AbortSignal): Promise<string> {
  const vids = files.filter((f) => VIDEO.test(f.path) && !/(?:^|\/)_preview\//.test(f.path) && f.data.length > 1024 && f.data.length <= Math.min(RUN_LIMITS.fileSize, 80 * 1048576)).slice(0, 2);
  if (!vids.length || !runner()) return "";
  const names = new Map(vids.map((f, i) => [`v${i}${(/\.[^.]+$/.exec(f.path)?.[0] ?? ".mp4").toLowerCase()}`, f.path.replace(/^outputs\//, "")]));
  const r = await execRun({ uid, net: false, timeout: 90, signal, argv: ["bash", "motion.sh"], files: [{ path: "motion.sh", data: Buffer.from(SCRIPT) }, ...vids.map((f, i) => ({ path: [...names.keys()][i], data: f.data }))] });
  const meta = r.files.find((f) => f.path === "meta.txt")?.data.toString("utf8") ?? "";
  const rows: string[] = [];
  let flagged = false;
  for (const line of meta.split("\n")) {
    const [file, d, rt] = line.trim().split(/\s+/);
    const name = names.get(file), raw = r.files.find((f) => f.path === `${file}.gray`)?.data, rate = Number(rt);
    if (!name || !raw || !(rate > 0)) continue;
    const diffs = frameDiffs(raw, rate);
    if (diffs.length < 2) continue;
    const m = motionProfile(diffs, Number(d) || 0, rate);
    flagged ||= m.flagged;
    rows.push(motionLine(name, m, rate));
  }
  if (!rows.length) return "";
  return `\n<video_motion>\nSynchro đã đo chuyển động thật của video vừa tạo:\n${rows.join("\n")}\nĐối chiếu với điều bạn định tả cho người dùng: chỉ tả chuyển động ở đoạn số đo có thay đổi.${flagged ? " Đoạn GẦN NHƯ ĐỨNG YÊN mà không phải chủ ý (giữ khung logo cuối 1–2 giây là bình thường): thêm chuyển động cho đoạn đó (vòng lặp nhẹ, zoom chậm, hạt, chữ hiện dần) rồi dựng lại và xem lại thẻ này, hoặc nói đúng với người dùng là đoạn đó là ảnh tĩnh." : ""}\n</video_motion>`;
}
