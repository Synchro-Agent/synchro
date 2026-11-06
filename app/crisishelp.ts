// Đầu mối trợ giúp theo nơi người dùng sống. Lấy mẫu trên CLI thật: người Việt nói muốn tự tử mà model chỉ đưa số 988 của Mỹ, dù hướng dẫn chung có liệt kê số Việt Nam.
// Liệt kê cả danh sách rồi để model chọn là không đủ: Synchro tự xác định nơi rồi chỉ đưa đúng số của nơi đó vào lượt này. Không bịa số: chỉ dùng số đã có nguồn; chưa có thì nói người dùng gọi cấp cứu và nhờ người ở gần.
import { wantsCrisisHelp } from "./router";

export type Region = "vn" | "us" | "nz" | "other" | "unknown";
const US_TZ = /^(?:America\/(?:New_York|Chicago|Denver|Phoenix|Los_Angeles|Anchorage|Juneau|Sitka|Metlakatla|Yakutat|Nome|Adak|Boise|Detroit|Menominee|Indiana\/\w+|Kentucky\/\w+|North_Dakota\/\w+)|Pacific\/Honolulu)$/;
const VI_CHARS = /[ăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;
// Gõ không dấu: nhận qua các cụm tiếng Việt thường gặp trong lời cầu cứu.
const VI_BARE = /(?<![a-z])(?:khong|muon|song|chet|nua|minh|toi|em|tu tu|cuoc doi|cuoc song|danh|nuot|thuoc)(?![a-z])/gi;
export const looksVietnamese = (s: string) => VI_CHARS.test(s.normalize("NFC")) || new Set(s.toLowerCase().match(VI_BARE) ?? []).size >= 2;

/** Múi giờ của trình duyệt là dấu hiệu tốt nhất về nơi đang sống; không có thì mới đoán theo ngôn ngữ. Người Việt ở Mỹ cần số của Mỹ, người viết tiếng Anh ở Việt Nam cần số của Việt Nam. */
export function regionOf(text: string, tz?: string): Region {
  // Trình duyệt chống theo dõi báo UTC cho mọi người: không nói gì về nơi ở.
  if (tz && !/^(?:UTC|GMT|Etc\/)/i.test(tz)) {
    if (/^Asia\/(?:Ho_Chi_Minh|Saigon)$/.test(tz)) return "vn";
    if (/^Pacific\/(?:Auckland|Chatham)$/.test(tz)) return "nz";
    if (US_TZ.test(tz)) return "us";
    return "other";
  }
  return looksVietnamese(text) ? "vn" : "unknown";
}

const HELP: Record<Region, string> = {
  vn: "Nhiều khả năng họ đang ở Việt Nam. Nêu đúng đầu mối ở Việt Nam, không nêu số của nước khác: gọi ngay 115 (cấp cứu y tế) nếu đang nguy hiểm, đã uống thuốc hay đã tự làm đau; 111 (Tổng đài quốc gia bảo vệ trẻ em) nếu người gặp nguy là trẻ em; và nhờ ngay một người đang ở gần đến ở cùng họ. Đừng tự nêu số đường dây tâm lý nào khác nếu không chắc chắn số đó có thật.",
  us: "Nhiều khả năng họ đang ở Mỹ: gọi hoặc nhắn 988 (đường dây khủng hoảng), 911 nếu đang nguy hiểm tức thời; và nhờ một người đang ở gần đến ở cùng họ.",
  nz: "Nhiều khả năng họ đang ở New Zealand: gọi 111 nếu đang nguy hiểm tức thời, gọi hoặc nhắn 1737 để được tư vấn; và nhờ một người đang ở gần đến ở cùng họ.",
  other: "Họ không ở Việt Nam, Mỹ hay New Zealand (theo múi giờ), Synchro không có sẵn số của nơi đó: đừng mặc định số của Mỹ hay Việt Nam. Bảo họ gọi ngay số cấp cứu nơi họ đang ở nếu đang nguy hiểm và nhờ một người ở gần đến ở cùng; hỏi họ đang ở đâu; chỉ nêu số của nước đó nếu biết chắc số đó có thật.",
  unknown: "Chưa rõ họ đang ở đâu: đừng mặc định số của Mỹ. Bảo họ gọi ngay số cấp cứu nơi họ đang ở nếu đang nguy hiểm và nhờ một người ở gần đến ở cùng; hỏi họ đang ở nước nào; chỉ nêu số của nước đó nếu biết chắc số đó có thật.",
};

/** Khối gửi kèm tin nhắn mới nhất khi tin đó có dấu hiệu nguy hiểm; không có thì rỗng. Viết có điều kiện vì bộ dò có thể nhầm (trích dẫn, viết truyện). */
export function crisisHelp(text: string, tz?: string): string {
  if (!wantsCrisisHelp(text)) return "";
  return `<crisis_help>\nNếu tin nhắn này đúng là người dùng hoặc người thân của họ đang gặp nguy (không phải viết truyện, dịch thuật hay hỏi kiến thức): trả lời bằng đúng ngôn ngữ của họ, quan tâm thật, không phán xét, không nêu cách làm hại, hỏi họ có đang an toàn không. ${HELP[regionOf(text, tz)]}\n</crisis_help>`;
}
