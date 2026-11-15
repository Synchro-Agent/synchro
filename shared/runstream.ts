// Đọc luồng lượt chạy của RunService (server/runs/stream.ts) từ thân một fetch: EventSource chỉ gửi GET, còn lượt Code bắt đầu bằng POST
// nên trình duyệt đọc SSE bằng tay. Hiểu cả NDJSON kiểu cũ (máy chủ bản trước, hoặc thẻ đang nói chuyện với bản cũ khi quay lui):
// chọn theo Content-Type của câu trả lời.

/** Một khung SSE: event (mặc định "message"), id (nếu có), data (các dòng data nối bằng \n). */
export type SseFrame = { event: string; id?: string; data: string };

/** Tách các khung SSE trong buf. Trả các khung đã đủ và phần còn dở (chờ thêm dữ liệu). Bỏ dòng chú thích (":") và retry. */
export function splitSse(buf: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = [];
  const norm = buf.replace(/\r\n?/g, "\n");
  let at = 0;
  for (let i; (i = norm.indexOf("\n\n", at)) >= 0; at = i + 2) {
    let event = "message", id: string | undefined, data: string[] | null = null;
    for (const line of norm.slice(at, i).split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const c = line.indexOf(":");
      const field = c < 0 ? line : line.slice(0, c), value = c < 0 ? "" : line.slice(c + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "id") id = value;
      else if (field === "data") (data ??= []).push(value);
    }
    if (data) frames.push({ event, ...(id !== undefined ? { id } : {}), data: data.join("\n") });
  }
  return { frames, rest: norm.slice(at) };
}

/** Đọc hết thân câu trả lời theo từng khung SSE. */
export async function readSse(body: ReadableStream<Uint8Array>, on: (f: SseFrame) => void) {
  const rd = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const { frames, rest } = splitSse(buf);
    buf = rest;
    for (const f of frames) on(f);
  }
}

/** Đọc hết thân câu trả lời NDJSON kiểu cũ: mỗi dòng một JSON, dòng trống là ping. */
export async function readNdjson(body: ReadableStream<Uint8Array>, on: (v: Record<string, unknown>) => void) {
  const rd = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) { try { on(JSON.parse(line)); } catch {} }
    }
  }
}

/** Khung SSE của lượt Code → dòng kiểu cũ mà giao diện đang dùng ({ t: "run" } mở đầu, sự kiện kèm s, { t: "end" } kết thúc). null: khung
 *  không mang sự kiện (clock, delta…) hoặc hỏng. */
export function codeLine(f: SseFrame): Record<string, unknown> | null {
  let d: Record<string, unknown>;
  try { d = JSON.parse(f.data); } catch { return null; }
  if (!d || typeof d !== "object") return null;
  if (f.event === "run") return { t: "run", node: d.node ?? null, running: d.running === true, count: Number(d.count) || 0 };
  if (f.event === "step") return f.id !== undefined && Number(f.id) > 0 ? { ...d, s: Number(f.id) } : d;
  if (f.event === "done") return { t: "end", s: d.s, stopped: d.stopped };
  return null;
}

/** Thân câu trả lời của luồng lượt Code (SSE hay NDJSON kiểu cũ, theo Content-Type) → các dòng kiểu cũ. Như bộ đọc NDJSON trước đây, lỗi
 *  của bên nhận ở một dòng không cắt ngang luồng: luồng bị cắt thì trình duyệt tưởng lượt chưa xong, chờ 3 giây rồi nối lại. */
export async function readCodeStream(r: Response, on: (v: Record<string, unknown>) => void) {
  if (!r.body) return;
  if (/text\/event-stream/.test(r.headers.get("content-type") ?? "")) await readSse(r.body, (f) => { const l = codeLine(f); if (l) try { on(l); } catch {} });
  else await readNdjson(r.body, on);
}
