// Tin người dùng nhắn thêm khi lượt chạy bằng gói subscription (CLI) đang làm: đưa tới model ở bước kế tiếp, không
// đợi CLI viết xong cả câu trả lời (trước đây tin nằm chờ tới hết lượt của CLI, có khi vài phút, giao diện chỉ hiện
// "đang đọc").
// Ba đường, theo thứ tự:
// 1. Công cụ của Synchro đang chạy qua cầu nối MCP: tin đi kèm kết quả công cụ đó (bridgeCall → takeFollowups),
//    không làm gì ở đây.
// 2. CLI có kênh nhắn thêm giữa lượt (Codex app-server: turn/steer): gửi thẳng vào lượt đang chạy.
// 3. Còn lại, với CLI nối tiếp phiên được (Claude Code, Codex): cắt lượt đang chạy như vòng lặp khóa API cắt bước
//    đang viết; phần đã viết vào nhật ký làm việc, vòng lặp của routing.ts làm tiếp ngay trong cùng phiên với tin mới.
//    Antigravity, Grok chỉ báo mã phiên khi xong lượt (cắt là mất phiên) nên vẫn đọc tin khi CLI xong lượt.
import "server-only";
import { currentRun, deltaStep, inRun, liveNow, onInbox, progress, takeInbox, turnSignal } from "../runs";

const CUT_OK = new Set(["claude", "codex"]);
export const followupBlock = (more: string[]) => `<user_followup>\n${more.join("\n\n")}\n</user_followup>`;

export type CliSteer = {
  /** Tín hiệu cho một lần gọi CLI: nút Dừng của lượt, hoặc cắt vì tin nhắn thêm. Gọi trước mỗi lần chạy CLI. */
  arm: () => AbortSignal | undefined;
  /** Lần gọi CLI vừa xong (kể cả lỗi): tin tới sau lúc này được vòng lặp đọc ở lần làm tiếp. */
  idle: () => void;
  /** Lần gọi vừa rồi bị cắt vì tin nhắn thêm (không phải nút Dừng). */
  cut: () => boolean;
  /** Kênh nhắn thêm giữa lượt của CLI (TurnRequest.onInject). */
  onInject: (send: ((text: string) => Promise<boolean>) | null) => void;
  /** Tin chờ ghép vào lần làm tiếp: tin của kênh giữa lượt bị CLI từ chối, rồi tới hộp thư của lượt. */
  take: () => string[];
  close: () => void;
};

/** say: đưa phần chữ đã viết của bước hiện tại vào nhật ký làm việc (sayOut của tools.ts). toolBusy: cầu nối đang
 *  chạy công cụ. */
export function cliSteer(cli: string, toolBusy: () => boolean, say: (text: string) => void): CliSteer {
  const run = currentRun(), stop = turnSignal();
  let ctl: AbortController | null = null, wasCut = false, send: ((text: string) => Promise<boolean>) | null = null;
  let sending: Promise<void> | null = null;
  const carry: string[] = [];
  // Tin tới từ yêu cầu HTTP của người gửi (hoặc nhịp đọc lệnh từ tiến trình khác), ngoài ngữ cảnh của lượt: mọi thao
  // tác chạy lại trong ngữ cảnh lượt (inRun) để progress / takeInbox ghi đúng lượt.
  const route = () => inRun(run, () => {
    if (!ctl || ctl.signal.aborted || stop?.aborted || toolBusy()) return;
    if (send) { sending ??= viaChannel(send).finally(() => { sending = null; }); return; }
    cutNow();
  });
  const cutNow = () => { if (ctl && !ctl.signal.aborted && CUT_OK.has(cli)) { wasCut = true; ctl.abort(); } };
  async function viaChannel(f: (text: string) => Promise<boolean>) {
    const more = takeInbox();
    if (!more.length) return;
    // Chữ model đã viết tới lúc này vào nhật ký trước, rồi mới tới tin của người dùng: khung chat hiện đúng thứ tự.
    const said = liveNow();
    const ok = await f(followupBlock(more)).catch((e) => {
      console.warn("[clisteer]", (e as Error).message);
      return false;
    });
    await inRun(run, async () => {
      if (ok) { say(said); deltaStep(); for (const t of more) progress("steer", t); return; }
      carry.push(...more);
      cutNow();
    });
  }
  const off = onInbox(route);
  return {
    arm: () => {
      wasCut = false;
      ctl = new AbortController();
      return stop ? AbortSignal.any([stop, ctl.signal]) : ctl.signal;
    },
    idle: () => { ctl = null; send = null; },
    cut: () => wasCut,
    onInject: (f) => { send = f; if (f) route(); },
    take: () => [...carry.splice(0), ...takeInbox()],
    close: off,
  };
}
