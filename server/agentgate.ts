// Chốt chặn trước mỗi công cụ của một lượt (agent Synchro Code, hay lượt chat): chế độ quyền (sửa tệp, chạy lệnh) và trang web được phép
// (công cụ trình duyệt). Dùng chung cho model khóa API lẫn gói subscription (gói gọi công cụ qua cầu nối MCP, cùng đi qua chốt này).
import "server-only";
import { isBrowserTool } from "./browsertools";
import { needAsk, newAskId, rememberSite, siteOf, siteRule, waitAnswer, type Answer, type Ask, type Perm } from "./approvals";
import { getPrefs } from "./codestore";

/** Lời đáp "không có giao diện để hỏi" (lượt chat không chạy nền, việc chạy nền không người xem). */
export const NO_UI = "__no_ui__";
/** Lời đáp "đã gửi yêu cầu duyệt vào mục Cần duyệt của Autopilot" (việc tự động chạy nền: người dùng duyệt sau, lần
 *  chạy sau dùng được). */
export const QUEUED = "__queued__";
export type Gate = {
  /** null: được làm; chuỗi: lý do không được làm (gửi cho model thay cho kết quả công cụ). */
  check: (name: string, input: Record<string, unknown>) => Promise<string | null>;
  /** Trang trình duyệt đang mở sau một thao tác (để thao tác sau trên trang đó cũng theo quy tắc trang được phép). */
  seen: (url?: string) => void;
};

export function makeGate(o: {
  uid: string; perm?: Perm; signal?: AbortSignal;
  ask: (a: Ask) => void; asked: (id: string, a: Answer) => void;
  /** Người dùng chọn "Luôn cho phép trong phiên này": lưu khóa vào phiên. */
  allowed?: (key: string) => void;
  /** Địa chỉ trang đang mở của trình duyệt (khi lượt chưa mở trang nào mà đã thao tác trên trang có sẵn). */
  probe?: () => Promise<string | undefined>;
  /** D6: điều kiện hỏi thêm tùy lượt cho công cụ trình duyệt (vd. đang mở skill chưa kiểm chứng + Chrome của người dùng). Trả về Ask (chưa có id)
   *  thì hỏi một lần cho mỗi khóa trong lượt; null thì bỏ qua. Đọc trạng thái lượt lúc gọi nên bật được giữa chừng lượt. */
  gateExtra?: (name: string, input: Record<string, unknown>) => Omit<Ask, "id"> | null;
}): Gate {
  const site = { current: null as string | null, once: new Set<string>(), probed: false };
  const askUser = async (a: Omit<Ask, "id">) => {
    const id = newAskId();
    // Chờ trước rồi mới hỏi: nơi hỏi trả lời ngay được (lượt không có giao diện để hỏi thì từ chối luôn bằng NO_UI).
    const wait = waitAnswer(o.uid, id, o.signal);
    o.ask({ ...a, id });
    const r = await wait;
    o.asked(id, r);
    return r;
  };
  const note = (r: Answer) => (r.note && r.note !== "Người dùng đã dừng." && r.note !== NO_UI && r.note !== QUEUED ? ` Lời nhắn của người dùng: ${r.note}` : "");
  return {
    seen: (url) => { if (url) site.current = siteOf("browser_navigate", { url }, site.current); },
    check: async (name, input) => {
      if (isBrowserTool(name)) {
        // D6: điều kiện hỏi thêm của lượt (skill chưa kiểm chứng đang mở + Chrome của người dùng). Hỏi một lần cho mỗi khóa trong lượt.
        if (o.gateExtra) {
          const a = o.gateExtra(name, input);
          if (a && !site.once.has(a.key)) {
            const r = await askUser(a);
            if (!r.ok && r.note === QUEUED) return `Việc này cần người dùng duyệt trước (${a.title}). Synchro đã gửi yêu cầu duyệt vào mục Cần duyệt của Autopilot. Không lách; làm tiếp phần không cần duyệt và ghi rõ trong kết quả.`;
            if (!r.ok && r.note === NO_UI) return `${a.title} — lượt này không hỏi được người dùng. Báo người dùng nhờ lại trong khung chat để Synchro hỏi, hoặc làm phần không cần tới bước này.`;
            if (!r.ok) return `Người dùng không cho phép: ${a.title}.${note(r)} Đừng thử lại cách này; làm theo lời nhắn nếu có, hoặc hỏi người dùng muốn làm thế nào.`;
            site.once.add(a.key);
          }
        }
        let h = siteOf(name, input, site.current);
        // Thao tác trên trang đang mở mà lượt này chưa biết là trang nào: hỏi trình duyệt một lần (chỉ khi có quy tắc trang).
        if (h === null && !site.probed && o.probe && !(name === "browser_tabs" && (input.op ?? "list") === "list")) {
          site.probed = true;
          const p = getPrefs(o.uid);
          if (p.siteAsk || p.blocked.length) { const u = await o.probe().catch(() => undefined); if (u) h = site.current = siteOf("browser_navigate", { url: u }, null); }
        }
        const rule = siteRule(o.uid, h, site.once);
        if (rule === "blocked") return `Trang ${h} nằm trong danh sách chặn của người dùng (Cài đặt → Synchro Code → Trình duyệt). Không mở hay thao tác trên trang này; báo người dùng nếu việc cần tới nó.`;
        if (rule === "ask") {
          const r = await askUser({ kind: "site", tool: name, key: `site:${h}`, host: h!, title: `Dùng trình duyệt trên ${h}`, detail: name === "browser_navigate" ? String(input.url ?? "") : "" });
          if (!r.ok && r.note === QUEUED) return `Trang ${h} chưa có trong danh sách trang được phép của người dùng. Synchro đã gửi yêu cầu cho phép trang này vào mục Cần duyệt của Autopilot (người dùng duyệt thì các lần chạy sau dùng được). Không thử lại trang này ở lượt này; dùng nguồn khác và ghi rõ trong kết quả.`;
          if (!r.ok && r.note === NO_UI) return `Trang ${h} chưa có trong danh sách trang được phép (Cài đặt → Synchro Code → Trình duyệt) và lượt này không hỏi được người dùng. Báo người dùng thêm trang này vào danh sách, hoặc nhờ lại trong khung chat để Synchro hỏi.`;
          if (!r.ok) return `Người dùng không cho phép dùng trình duyệt trên ${h}.${note(r)} Không thử lại trang này; hỏi người dùng muốn làm thế nào.`;
          if (r.always) rememberSite(o.uid, h!); else site.once.add(h!);
        }
        return null;
      }
      if (!o.perm) return null;
      const q = needAsk(o.perm, name, input);
      if (!q) return null;
      const r = await askUser(q);
      if (!r.ok && r.note === QUEUED) return `Việc này cần người dùng duyệt trước (${q.title}). Synchro đã gửi yêu cầu duyệt vào mục Cần duyệt của Autopilot; người dùng duyệt thì Synchro làm đúng việc đó. Không tìm cách khác để lách; làm tiếp phần không cần duyệt và ghi rõ trong kết quả.`;
      if (!r.ok) return `Người dùng không cho phép: ${q.title}.${note(r)} Đừng thử lại cách này; làm theo lời nhắn nếu có, hoặc dừng và hỏi người dùng muốn làm thế nào.`;
      if (r.always && !o.perm.allow.includes(q.key)) { o.perm.allow.push(q.key); o.allowed?.(q.key); }
      return null;
    },
  };
}
