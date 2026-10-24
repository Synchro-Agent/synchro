// Bộ icon riêng của Speech: lưới 24px, nét 1.6, đầu tròn. Các nhóm <g className="ti-*"> có chuyển động khi rê chuột
// (định nghĩa trong globals.css), dùng chung cho ô màu ở trang chính và mục con ở thanh bên.
import React from "react";

type P = { size?: number };
const S = ({ size = 20, children }: P & { children: React.ReactNode }) => (
  <svg className="ti" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

// Đọc văn bản: chữ T phát ra sóng âm.
export const TextToSpeech = (p: P) => <S {...p}><path d="M3.5 6.5h9M8 6.5v11" /><g className="ti-w1"><path d="M15.5 9.8a3 3 0 010 4.4" /></g><g className="ti-w2"><path d="M18.2 7.4a6.4 6.4 0 010 9.2" /></g></S>;
// Hội thoại: hai bong bóng lời thoại so le.
export const Dialogue = (p: P) => <S {...p}><g className="ti-b1"><path d="M4.5 5h8.5a2 2 0 012 2v4.2a2 2 0 01-2 2H9.2L6 15.8v-2.6H4.5a2 2 0 01-2-2V7a2 2 0 012-2z" /></g><g className="ti-b2"><path d="M17.5 10h1.9a2 2 0 012 2v4a2 2 0 01-2 2h-1v2.4L15.6 18H12a2 2 0 01-2-2v-.6" /></g></S>;
// Voice Agent: quả cầu có các vạch sóng bên trong và tia sáng trí tuệ.
export const Agent = (p: P) => <S {...p}><circle cx="11" cy="13" r="7.5" /><g className="ti-bar1"><path d="M8 11.5v3" /></g><g className="ti-bar2"><path d="M11 10v6" /></g><g className="ti-bar3"><path d="M14 11.5v3" /></g><g className="ti-spark"><path d="M19.5 2.5v3M18 4h3" /></g></S>;
// Chép lời: cột sóng chuyển thành dòng chữ.
export const SpeechToText = (p: P) => <S {...p}><g className="ti-bar1"><path d="M3.5 10v4" /></g><g className="ti-bar2"><path d="M6.5 7.5v9" /></g><g className="ti-bar3"><path d="M9.5 10.5v3" /></g><g className="ti-lines"><path d="M13.5 8h7M13.5 12h7M13.5 16h4.5" /></g></S>;
// Thiết kế giọng: đũa phép và lấp lánh.
export const VoiceDesign = (p: P) => <S {...p}><path d="M4 20l9.5-9.5M15 9l1.5-1.5" /><g className="ti-spark"><path d="M18 2.8l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z" /></g><g className="ti-dot"><path d="M8.5 4.5v2M7.5 5.5h2M20.5 13v2M19.5 14h2" /></g></S>;
// Nhân bản giọng: hai chân dung lồng nhau, bản sao mờ phía sau.
export const VoiceClone = (p: P) => <S {...p}><g className="ti-ghost"><circle cx="15.5" cy="7.5" r="3" strokeDasharray="1.6 2.2" /><path d="M19.5 17.5c-.4-2.6-2-4.1-4-4.6" strokeDasharray="1.6 2.2" /></g><circle cx="9" cy="9" r="3.4" /><path d="M3 20c.6-3.6 3-5.6 6-5.6s5.4 2 6 5.6" /></S>;
// Tiếng động: loa phát ra chùm tia.
export const SoundEffects = (p: P) => <S {...p}><path d="M4 9.5h2.8L11 6v12l-4.2-3.5H4z" /><g className="ti-burst"><path d="M15 12h5.5M14.6 7.6l3.6-2.4M14.6 16.4l3.6 2.4" /></g></S>;
// Lọc tạp âm: sóng nhiễu đi qua màng lọc thành đường sạch.
export const Isolator = (p: P) => <S {...p}><g className="ti-noise"><path d="M2.5 12l1.2-3 1.4 6 1.4-7 1.3 8 1.2-4" /></g><path d="M11.5 5v14" strokeDasharray="2 2" /><g className="ti-clean"><path d="M14 12c1.2-2.4 2.4-2.4 3.6 0s2.4 2.4 3.6 0" /></g></S>;
// Đổi giọng: hai mũi tên vòng hoán đổi.
export const VoiceChanger = (p: P) => <S {...p}><g className="ti-spin"><path d="M5 9.5A7.2 7.2 0 0118.2 7M18.6 3.6v3.8h-3.8M19 14.5A7.2 7.2 0 015.8 17M5.4 20.4v-3.8h3.8" /></g><circle cx="12" cy="12" r="1.2" /></S>;
// Lồng tiếng: quả địa cầu kèm bong bóng lời thoại.
export const Dubbing = (p: P) => <S {...p}><circle cx="10" cy="12" r="7" /><g className="ti-merid"><path d="M10 5c-2 2-2.8 4.4-2.8 7s.8 5 2.8 7c2-2 2.8-4.4 2.8-7S12 7 10 5z" /></g><path d="M3 12h14" /><g className="ti-b2"><path d="M17 3.5h3.5a1 1 0 011 1V7a1 1 0 01-1 1h-1.3L18 9.5V8h-1a1 1 0 01-1-1V4.5a1 1 0 011-1z" /></g></S>;
// Sách nói: sách mở, sóng âm bay lên.
export const Audiobook = (p: P) => <S {...p}><path d="M12 9.5c-2-1.4-4.6-1.8-8-1.4v10.4c3.4-.4 6 0 8 1.4 2-1.4 4.6-1.8 8-1.4V8.1c-3.4-.4-6 0-8 1.4zM12 9.5v10.4" /><g className="ti-w1"><path d="M9.6 5.2c1.4-1 3.4-1 4.8 0" /></g><g className="ti-w2"><path d="M7.8 2.8c2.4-1.6 6-1.6 8.4 0" /></g></S>;
// Podcast: micro thu âm có lưới.
export const Podcast = (p: P) => <S {...p}><rect x="8.5" y="2.8" width="7" height="11" rx="3.5" /><path d="M8.5 7h2.2M8.5 9.6h2.2M13.3 7h2.2M13.3 9.6h2.2M5.5 11.5a6.5 6.5 0 0013 0M12 18v3M9 21h6" /><g className="ti-w2"><path d="M20.6 6.2a4 4 0 010 4.6M3.4 6.2a4 4 0 000 4.6" /></g></S>;
// Trang chính của Speech: lưới ô.
export const Home = (p: P) => <S {...p}><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><g className="ti-spin"><rect x="13.5" y="13.5" width="7" height="7" rx="3.5" /></g></S>;

// Ô màu chuyển sắc cho trang chính: hai sắc liền kề (cách 28°) cùng một họ, có lớp bóng kính phía trên.
export function ToolTile({ hue, children, size = 40 }: { hue: number; children: React.ReactNode; size?: number }) {
  return <span className="ti-tile" style={{ width: size, height: size, "--th": `${hue}` } as React.CSSProperties}>{children}</span>;
}
