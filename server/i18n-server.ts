// Dịch ở máy chủ (route API, thông báo trả về theo ngôn ngữ người dùng): i18n.tsx là "use client" và tải từ điển động nên máy chủ không gọi được tr().
// Tệp này nhập thẳng từ điển VI→EN nên chỉ dùng ở máy chủ; giao diện dùng tr / tf trong i18n.tsx (kiểm thử chặn tệp giao diện nhập tệp này).
import "server-only";
import { type Dict, type Lang, type Vars, tfWith, trWith } from "../shared/i18n-core";
import { RULES_EN, VI2EN } from "../shared/i18n-dict";

const EN: Dict = { map: VI2EN, rules: RULES_EN };
// Chữ gốc ở máy chủ là tiếng Việt: chỉ cần chiều sang tiếng Anh.
const pick = (lang: Lang) => (lang === "en" ? EN : undefined);

/** Như tr() nhưng chạy được ở máy chủ, ngôn ngữ truyền vào (thường lấy từ yêu cầu). */
export const trOn = (s: string, lang: Lang) => trWith(pick(lang), s, lang);
/** Như tf() nhưng chạy được ở máy chủ. */
export const tfOn = (key: string, vars: Vars, lang: Lang) => tfWith(pick(lang), key, vars, lang);
