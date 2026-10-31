import React from "react";

type P = { size?: number };
const S = ({ size = 18, children, fill }: P & { children: React.ReactNode; fill?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

// Biểu tượng vẽ trên lưới 24 (theo Lucide, giấy phép ISC): cùng độ dày nét nhìn thấy với bộ lưới 20 ở trên.
const S24 = ({ size = 18, children }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.68" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const Plus = (p: P) => <S {...p}><path d="M10 4v12M4 10h12" /></S>;
export const Minus = (p: P) => <S {...p}><path d="M4.5 10h11" /></S>;
export const Merge = (p: P) => <S {...p}><path d="M5 4v3.5c0 2 1.5 3 5 3.5M15 4v3.5c0 2-1.5 3-5 3.5v5M7.5 13.5L10 16l2.5-2.5" /></S>;
export const Calendar = (p: P) => <S {...p}><rect x="3.5" y="4.5" width="13" height="12" rx="2" /><path d="M3.5 8.5h13M7 3v3M13 3v3" /></S>;
export const Panel = (p: P) => <S {...p}><rect x="3" y="4" width="14" height="12" rx="2.5" /><path d="M8 4v12" /></S>;
export const Layers = (p: P) => <S {...p}><g className="ai-l1"><path d="M7 3.2h6" /></g><g className="ai-l2"><path d="M4.6 5.9h10.8" /></g><path d="M3.6 8.4h12.8M4.6 8.4l.8 6.9a1.8 1.8 0 001.8 1.6h5.6a1.8 1.8 0 001.8-1.6l.8-6.9" /></S>;
export const Shapes = (p: P) => <S {...p}><g className="ai-q"><path d="M7 2.4a5.4 5.4 0 015.4 5.4H7z" /></g><circle cx="5.6" cy="14" r="3.2" /><g className="ai-sq"><rect x="10.4" y="10.4" width="6.4" height="6.4" rx="1.3" /></g></S>;
// Skills / Connectors / Plugins: cùng bộ với mục Customize của Claude. Nhóm ai-* là phần chuyển động khi rê chuột (giữ nguyên tên để animation cũ vẫn chạy).
export const Scroll = (p: P) => <S {...p}><path d="M7.2 3.3h7.4a1.9 1.9 0 011.9 1.9v9.7" /><g className="ai-roll"><path d="M7.2 3.3a1.9 1.9 0 00-1.9 1.9v1.6h1.9M5.3 6.8V14" /><path d="M16.5 14.9v.9a1.9 1.9 0 01-1.9 1.9H5.2a1.9 1.9 0 01-1.9-1.9V14h9.3v1.8a1.9 1.9 0 001.9 1.9" /></g><g className="ai-ink"><path d="M8.6 9.4c.7-.8 1.4-.8 2.1 0s1.4.8 2.1 0" pathLength="1" /></g></S>;
export const Connectors = (p: P) => <S {...p}><path d="M3.3 8.6h5v5h5v5h-10z" /><path d="M3.3 13.6h5v5" /><g className="ai-snap"><rect x="11.4" y="3.3" width="5.3" height="5.3" rx="1.1" /></g></S>;
export const Plugins = (p: P) => <S {...p}><g className="ai-plug"><path d="M12.6 4.2l-2.3 2.3M15.8 7.4l-2.3 2.3" /><path d="M8.6 6.2l5.2 5.2-1.6 1.6a3.3 3.3 0 01-4.6 0l-.6-.6a3.3 3.3 0 010-4.6z" /></g><path d="M7 13.4l-3.5 3.5" /></S>;
export const Code = (p: P) => <S {...p}><g className="ai-lt"><path d="M6.8 6L2.8 10l4 4" /></g><g className="ai-rt"><path d="M13.2 6l4 4-4 4" /></g><g className="ai-sl"><path d="M11.8 4l-3.6 12" /></g></S>;
export const Brief = (p: P) => <S {...p}><g className="ai-br"><rect x="3" y="6" width="14" height="10" rx="2" /><path d="M7.5 6V4.5h5V6M3 10.5h14" /></g></S>;
export const Pencil = (p: P) => <S24 {...p}><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></S24>;
export const Grad = (p: P) => <S {...p}><path d="M2 8l8-4 8 4-8 4zM5 10v4c0 1 2.2 2 5 2s5-1 5-2v-4" /></S>;
export const Coffee = (p: P) => <S {...p}><path d="M4 8h9v5a3 3 0 01-3 3H7a3 3 0 01-3-3zM13 9h1.5a2 2 0 010 4H13M7 3.5c0 1-1 1-1 2M10 3.5c0 1-1 1-1 2" /></S>;
export const Bulb = (p: P) => <S {...p}><path d="M7 14h6M8 16.5h4M10 3a5 5 0 00-3 9c.6.5 1 1.2 1 2h4c0-.8.4-1.5 1-2a5 5 0 00-3-9z" /></S>;
// Micro kiểu Lucide (ISC): thân bo tròn, vòng ôm phía dưới và chân micro.
export const Mic = ({ size = 18 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="9" y="2" width="6" height="13" rx="3" /><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
  </svg>
);
// Sóng âm của nút trò chuyện bằng giọng nói: chấm, vạch vừa, vạch cao, vạch vừa, chấm. Rê chuột vào nút thì các vạch nhún theo nhịp (CSS .wv).
export const Wave = (p: P) => <S {...p} fill><g className="wv"><rect x="2.6" y="8.6" width="1.7" height="2.8" rx=".85" /><rect x="6" y="5.6" width="1.7" height="8.8" rx=".85" /><rect x="9.15" y="2.6" width="1.7" height="14.8" rx=".85" /><rect x="12.3" y="5.6" width="1.7" height="8.8" rx=".85" /><rect x="15.7" y="8.6" width="1.7" height="2.8" rx=".85" /></g></S>;
export const Chevron = (p: P) => <S {...p}><path d="M6 8l4 4 4-4" /></S>;
export const ChevronR = (p: P) => <S {...p}><path d="M8 5l5 5-5 5" /></S>;
export const Check = (p: P) => <S {...p}><path d="M4.2 10.6l4 4 7.6-8.6" /></S>;
export const X = (p: P) => <S {...p}><path d="M5 5l10 10M15 5L5 15" /></S>;
export const Search = (p: P) => <S {...p}><circle cx="9" cy="9" r="5" /><path d="M13 13l4 4" /></S>;
export const Sliders = (p: P) => <S {...p}><path d="M4 6h5M13 6h3M4 14h3M11 14h5M9 4v4M7 12v4" /></S>;
export const Grid = (p: P) => <S {...p}><rect x="3" y="3" width="6" height="6" rx="1.5" /><rect x="11" y="3" width="6" height="6" rx="1.5" /><rect x="3" y="11" width="6" height="6" rx="1.5" /><rect x="11" y="11" width="6" height="6" rx="1.5" /></S>;
export const Connect = (p: P) => <S {...p}><rect x="3" y="9.8" width="5.6" height="5.6" rx="1.4" /><rect x="10.4" y="9.8" width="5.6" height="5.6" rx="1.4" /><rect x="3" y="3" width="5.6" height="5.6" rx="1.4" /><rect x="11.2" y="2.6" width="5" height="5" rx="1.2" transform="rotate(12 13.7 5.1)" /></S>;
export const Ghost = (p: P) => <S {...p}><path d="M4 16V9a6 6 0 0112 0v7l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5zM8 9v1.5M12 9v1.5" /></S>;
export const Clip = (p: P) => <S {...p}><path d="M16.2 9.4l-6.3 6.3a3.9 3.9 0 01-5.5-5.5l7-7a2.6 2.6 0 013.7 3.7l-7 7a1.3 1.3 0 01-1.8-1.8l6.3-6.3" /></S>;
export const Camera = (p: P) => <S {...p}><path d="M3 7.6A1.6 1.6 0 014.6 6H6l1.1-1.7a1 1 0 01.8-.4h4.2a1 1 0 01.8.4L14 6h1.4A1.6 1.6 0 0117 7.6v6.8a1.6 1.6 0 01-1.6 1.6H4.6A1.6 1.6 0 013 14.4z" /><circle cx="10" cy="10.8" r="2.7" /></S>;
export const Globe = (p: P) => <S {...p}><circle cx="10" cy="10" r="7" /><path d="M3 10h14M10 3c2 2 3 4.5 3 7s-1 5-3 7c-2-2-3-4.5-3-7s1-5 3-7z" /></S>;
export const History = (p: P) => <S {...p}><path d="M3.5 10a6.5 6.5 0 106.5-6.5M3.5 4v3.5H7M7 11.5c1-1 2-1 3 0s2 1 3 0" /></S>;
export const Palette = (p: P) => <S {...p}><path d="M10 3a7 7 0 100 14c1.1 0 1.7-.9 1.3-1.8-.4-1 .2-2 1.3-2H14a3 3 0 003-3c0-4-3.1-7.2-7-7.2z" /><circle cx="6.4" cy="9.6" r=".5" fill="currentColor" /><circle cx="8.6" cy="6.6" r=".5" fill="currentColor" /><circle cx="12.4" cy="6.8" r=".5" fill="currentColor" /></S>;
export const Plug = (p: P) => <S {...p}><path d="M7.4 12.6L4 16M6.5 9.3l4.2 4.2c.5.5 1.4.5 2 0l.6-.6c.5-.5.5-1.4 0-2L9 6.7c-.5-.5-1.4-.5-2 0l-.5.6c-.5.5-.5 1.4 0 2zM9.5 8.4l-1.4-1.4M11.6 10.5L10.2 9.1M11.2 3.6l-1 1.7M16.4 8.8l-1.7 1M14.8 5.2l-1.2 1.2" /></S>;
export const Gear = (p: P) => <S {...p}><circle cx="10" cy="10" r="2.5" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /></S>;
export const User = (p: P) => <S {...p}><circle cx="10" cy="10" r="7" /><circle cx="10" cy="8.5" r="2.2" /><path d="M5.5 15c1-2 2.7-2.8 4.5-2.8s3.5.8 4.5 2.8" /></S>;
export const Shield = (p: P) => <S24 {...p}><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /></S24>;
export const Lock = (p: P) => <S {...p}><rect x="4.5" y="8.5" width="11" height="8.5" rx="2" /><path d="M7 8.5V6.5a3 3 0 016 0v2" /></S>;
export const Admin = (p: P) => <S {...p}><path d="M8.62 3.4Q10 2.4 11.38 3.4L16.22 6.9Q17.6 7.9 17.07 9.52L15.23 15.18Q14.7 16.8 13 16.8H7Q5.3 16.8 4.77 15.18L2.93 9.52Q2.4 7.9 3.78 6.9Z" /><circle cx="10" cy="8.9" r="2.1" /><path d="M6.7 16.7c.2-1.9 1.6-3.1 3.3-3.1s3.1 1.2 3.3 3.1" /></S>;
export const Card = (p: P) => <S {...p}><rect x="2.5" y="5" width="15" height="10" rx="2" /><path d="M2.5 8.5h15" /></S>;
export const Bell = (p: P) => <S {...p}><path d="M4.5 14.5h11l-1.5-2V9a4 4 0 10-8 0v3.5zM8.5 16.5h3" /></S>;
export const Moon = (p: P) => <S {...p}><path d="M16 12A6.5 6.5 0 018 4a6.5 6.5 0 108 8z" /></S>;
export const Sun = (p: P) => <S {...p}><circle cx="10" cy="10" r="3" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /></S>;
export const Monitor = (p: P) => <S {...p}><rect x="3" y="4" width="14" height="9.5" rx="1.5" /><path d="M7.5 16.5h5M10 13.5v3" /></S>;
export const Copy = (p: P) => <S {...p}><rect x="7" y="7" width="9" height="9" rx="2" /><path d="M13 7V5a1.5 1.5 0 00-1.5-1.5H5A1.5 1.5 0 003.5 5v6.5A1.5 1.5 0 005 13h2" /></S>;
export const Speaker = (p: P) => <S {...p}><path d="M3.5 8v4h3l4 3V5l-4 3zM13.5 7.5a3.5 3.5 0 010 5M15.5 5.5a6 6 0 010 9" /></S>;
export const ThumbUp = (p: P) => <S {...p}><path d="M7 9v7H4V9zM7 9l3-5.5c1.5 0 2 1 1.7 2.3L11 8h4a1.5 1.5 0 011.5 1.8l-1 5a2 2 0 01-2 1.6H7" /></S>;
export const ThumbDown = (p: P) => <S {...p}><path d="M7 11V4H4v7zM7 11l3 5.5c1.5 0 2-1 1.7-2.3L11 12h4a1.5 1.5 0 001.5-1.8l-1-5A2 2 0 0013.5 3.5H7" /></S>;
export const Retry = (p: P) => <S {...p}><path d="M16 10a6 6 0 11-2-4.5M16 3.5V6h-2.5" /></S>;
export const Stop = (p: P) => <S {...p} fill><rect x="5.5" y="5.5" width="9" height="9" rx="2" /></S>;
export const Arrow = (p: P) => <S {...p}><path d="M10 16V4M5 9l5-5 5 5" /></S>;
export const Sort = (p: P) => <S {...p}><path d="M6 4v12M3.5 13.5L6 16l2.5-2.5M14 16V4M11.5 6.5L14 4l2.5 2.5" /></S>;
export const List = (p: P) => <S {...p}><path d="M7 5h10M7 10h10M7 15h10M3.5 5h.01M3.5 10h.01M3.5 15h.01" /></S>;
export const Brain = (p: P) => <S {...p}><g className="ai-bn-c"><path d="M10 4v12" pathLength="1" /></g><g className="ai-bn-l"><path d="M7 4.5a2.5 2.5 0 00-2.5 2.5v.5A2.5 2.5 0 003 10a2.5 2.5 0 001.5 2.3V13A2.5 2.5 0 007 15.5" /></g><g className="ai-bn-r"><path d="M13 4.5A2.5 2.5 0 0115.5 7v.5A2.5 2.5 0 0117 10a2.5 2.5 0 01-1.5 2.3V13a2.5 2.5 0 01-2.5 2.5" /></g></S>;
export const Clock = (p: P) => <S {...p}><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 2" /></S>;
export const Pin = (p: P) => <S {...p}><g transform="translate(10 10) rotate(45) scale(.72) translate(-12 -12)" strokeWidth="2"><path d="M12 17v5M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V16a1 1 0 001 1h12a1 1 0 001-1v-.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V7a1 1 0 011-1 2 2 0 000-4H8a2 2 0 000 4 1 1 0 011 1z" /></g></S>;
export const PinOff = (p: P) => <S {...p}><g transform="translate(10 10) rotate(45) scale(.72) translate(-12 -12)" strokeWidth="2"><path d="M12 17v5M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V16a1 1 0 001 1h12a1 1 0 001-1v-.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V7a1 1 0 011-1 2 2 0 000-4H8a2 2 0 000 4 1 1 0 011 1z" /></g><path d="M3.5 3.5l13 13" /></S>;
export const Folder = (p: P) => <S {...p}><path d="M3 6.2A2.2 2.2 0 015.2 4h2.5c.5 0 1 .2 1.3.6l.9 1.2h4.9A2.2 2.2 0 0117 8v6.2a2.2 2.2 0 01-2.2 2.2H5.2A2.2 2.2 0 013 14.2z" /></S>;
export const Trash = (p: P) => <S {...p}><path d="M3.5 5.6h13M7.6 5.6V4.3c0-.4.3-.8.8-.8h3.2c.5 0 .8.4.8.8v1.3M5.1 5.6l.7 9.8a1.7 1.7 0 001.7 1.6h5a1.7 1.7 0 001.7-1.6l.7-9.8M8.3 8.8v5.2M11.7 8.8v5.2" /></S>;
export const Help = (p: P) => <S {...p}><circle cx="10" cy="10" r="7" /><path d="M8 8a2 2 0 114 0c0 1.5-2 1.5-2 3M10 13.5h.01" /></S>;
export const Out = (p: P) => <S {...p}><path d="M8 4H5a1.5 1.5 0 00-1.5 1.5v9A1.5 1.5 0 005 16h3M12 7l3 3-3 3M15 10H8" /></S>;

export const Cog = (p: P) => <S {...p}><path d="M8.70 3.73 L9.06 2.06 L10.94 2.06 L11.30 3.73 L13.51 4.65 L14.95 3.72 L16.28 5.05 L15.35 6.49 L16.27 8.70 L17.94 9.06 L17.94 10.94 L16.27 11.30 L15.35 13.51 L16.28 14.95 L14.95 16.28 L13.51 15.35 L11.30 16.27 L10.94 17.94 L9.06 17.94 L8.70 16.27 L6.49 15.35 L5.05 16.28 L3.72 14.95 L4.65 13.51 L3.73 11.30 L2.06 10.94 L2.06 9.06 L3.73 8.70 L4.65 6.49 L3.72 5.05 L5.05 3.72 L6.49 4.65Z" strokeWidth="1.5" /><circle cx="10" cy="10" r="2.6" strokeWidth="1.5" /></S>;
export const UpCircle = (p: P) => <S {...p}><circle cx="10" cy="10" r="7.2" /><path d="M10 13.5V7M7 9.8L10 6.8l3 3" /></S>;
export const AppsPlus = (p: P) => <S {...p}><circle cx="5.8" cy="5.8" r="2.6" /><rect x="11.2" y="3.2" width="5.2" height="5.2" rx="2.2" /><rect x="3.2" y="11.2" width="5.2" height="5.2" rx="2.2" /><path d="M13.8 11.4v5M11.3 13.9h5" /></S>;
export const InfoCircle = (p: P) => <S {...p}><circle cx="10" cy="10" r="7.2" /><path d="M10 9v4.5" /><circle cx="10" cy="6.6" r=".5" fill="currentColor" /></S>;
export const Alert = (p: P) => <S {...p}><path d="M10 3.5l7 12H3z" /><path d="M10 8.5v3.2" /><circle cx="10" cy="13.6" r=".4" fill="currentColor" /></S>;
export const Enter = (p: P) => <S {...p}><path d="M16 5v4.5a2 2 0 01-2 2H4.5M8 8l-3.5 3.5L8 15" /></S>;

export const Image = (p: P) => <S {...p}><rect x="3" y="4" width="14" height="12" rx="2.4" /><circle cx="7.4" cy="8.2" r="1.3" /><path d="M3.4 14l4-3.6 3 2.6 2.6-2.2 3.6 3.4" /></S>;

export const Eye = (p: P) => <S {...p}><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" /><circle cx="10" cy="10" r="2.3" /></S>;
export const Download = (p: P) => <S {...p}><path d="M10 3.5v9M6.5 9.5L10 13l3.5-3.5M4 16h12" /></S>;
// Synchro Code: nút góc trên phải và agent
export const Terminal = (p: P) => <S {...p}><rect x="2.8" y="3.8" width="14.4" height="12.4" rx="2.4" /><path d="M6 8l2.4 2L6 12M10.2 12.4h3.6" /></S>;
export const PanelR = (p: P) => <S {...p}><rect x="3" y="4" width="14" height="12" rx="2.5" /><path d="M12 4v12" /></S>;
export const Dots = (p: P) => <S {...p} fill><circle cx="10" cy="4.6" r="1.35" /><circle cx="10" cy="10" r="1.35" /><circle cx="10" cy="15.4" r="1.35" /></S>;
export const Branch = (p: P) => <S {...p}><circle cx="6" cy="4.8" r="1.8" /><circle cx="6" cy="15.2" r="1.8" /><circle cx="14" cy="7" r="1.8" /><path d="M6 6.6v6.8M14 8.8c0 3-3 3.2-6.6 4.9" /></S>;
export const External = (p: P) => <S {...p}><path d="M11 3.5h5.5V9M16.5 3.5l-7 7M14 12v3a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 014 15V8a1.5 1.5 0 011.5-1.5h3" /></S>;
export const Back = (p: P) => <S {...p}><path d="M12 5l-5 5 5 5" /></S>;
export const File = (p: P) => <S {...p}><path d="M5 3.5h6l4 4v9a1 1 0 01-1 1H5a1 1 0 01-1-1v-12a1 1 0 011-1zM11 3.5v4h4" /></S>;
export const GitHub = ({ size = 18 }: P) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
);
// Hộp thư (kết quả tác vụ nền).
export const Inbox = (p: P) => <S {...p}><g className="ai-mail"><path d="M7.6 7.4h4.8M8.3 9.4h3.4" /></g><path d="M3.5 11.5l2-6.2c.2-.5.6-.8 1.1-.8h6.8c.5 0 .9.3 1.1.8l2 6.2V15a1.5 1.5 0 01-1.5 1.5H5A1.5 1.5 0 013.5 15z" /><g className="ai-lip"><path d="M3.5 11.5h3.6l1 1.8h3.8l1-1.8h3.6" /></g></S>;
// Chỉ và sửa (chọn một phần tử trong artifact) và so sánh hai phiên bản.
export const Pointer = (p: P) => <S {...p}><path d="M5 3.5l9.5 5.6-4.2 1.1-2.2 4.1z" /><path d="M10.6 10.4l3.6 3.6" /><path d="M14.5 3.2v1.6M16.8 5.5h-1.6M16.2 3.8l-1 1" /></S>;
export const Compare = (p: P) => <S {...p}><rect x="2.8" y="4" width="6.2" height="12" rx="1.6" /><rect x="11" y="4" width="6.2" height="12" rx="1.6" /><path d="M5.2 8h1.6M13.4 8h1.6M5.2 11h1.6M13.4 11h1.6" /></S>;
// Ứng dụng nội bộ (artifact xuất bản) và phạm vi chia sẻ cho cả tổ chức.
export const Rocket = (p: P) => <S24 {...p}><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" /><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" /><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" /><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" /></S24>;
export const Users = (p: P) => <S {...p}><circle cx="7.5" cy="7" r="2.6" /><path d="M2.8 16c.5-2.6 2.4-4.1 4.7-4.1s4.2 1.5 4.7 4.1" /><path d="M13 4.6a2.4 2.4 0 010 4.7M14.6 11.9c1.4.5 2.4 1.8 2.7 4.1" /></S>;
// Menu Thêm của Kho kỹ năng: tải tệp skill lên, tạo cùng Synchro, duyệt danh mục thư viện.
export const FileUp = (p: P) => <S {...p}><path d="M11.5 2.75H6.25a1.5 1.5 0 00-1.5 1.5v11.5a1.5 1.5 0 001.5 1.5h7.5a1.5 1.5 0 001.5-1.5V6.5z" /><path d="M11.5 2.75V6.5h3.75M10 14.25V9.5M7.9 11.6L10 9.5l2.1 2.1" /></S>;
export const Sparkles = (p: P) => <S {...p}><path d="M8.5 3.25c.55 3.1 2.1 4.65 5.25 5.25-3.15.6-4.7 2.15-5.25 5.25-.55-3.1-2.1-4.65-5.25-5.25 3.15-.6 4.7-2.15 5.25-5.25z" /><path d="M14.75 12.25c.25 1.35.9 2 2.25 2.25-1.35.25-2 .9-2.25 2.25-.25-1.35-.9-2-2.25-2.25 1.35-.25 2-.9 2.25-2.25z" /></S>;
export const Library = (p: P) => <S {...p}><rect x="3.25" y="3.25" width="5.75" height="5.75" rx="1.6" /><rect x="11" y="3.25" width="5.75" height="5.75" rx="1.6" /><rect x="3.25" y="11" width="5.75" height="5.75" rx="1.6" /><path d="M13.9 11.25v5.25M11.25 13.9h5.25" /></S>;
export const Expand = (p: P) => <S {...p}><path d="M11.5 3.5h5v5M16.5 3.5l-5.5 5.5M8.5 16.5h-5v-5M3.5 16.5L9 11" /></S>;
export const Collapse = (p: P) => <S {...p}><path d="M16 9h-5V4M11 9l5.5-5.5M4 11h5v5M9 11l-5.5 5.5" /></S>;
// Speech (ElevenLabs)
export const Speech = (p: P) => <S {...p}><g className="ai-hd"><circle cx="8" cy="7" r="3" /></g><path d="M2.6 16.5c.6-3 2.7-4.6 5.4-4.6s4.8 1.6 5.4 4.6" /><g className="ai-sw1"><path d="M14.2 5.2c1 1 1 2.8 0 3.8" /></g><g className="ai-sw2"><path d="M16.3 3.4c2 2 2 5.4 0 7.4" /></g></S>;
export const Play = (p: P) => <S {...p} fill><path d="M6 4.2l10 5.8-10 5.8z" /></S>;
export const Pause = (p: P) => <S {...p} fill><rect x="5" y="4" width="3.4" height="12" rx="1" /><rect x="11.6" y="4" width="3.4" height="12" rx="1" /></S>;
export const Upload = (p: P) => <S {...p}><path d="M10 13V3.5M6.5 7L10 3.5 13.5 7M4 16h12" /></S>;
export const Heart = (p: P) => <S {...p}><path d="M10 15.5l-5.2-5a3.2 3.2 0 014.5-4.6l.7.7.7-.7a3.2 3.2 0 014.5 4.6z" /></S>;
export const Bars = (p: P) => <S {...p}><path d="M4 8v4M7 5v10M10 3v14M13 6v8M16 8.5v3" /></S>;
export const Chat2 = (p: P) => <S {...p}><path d="M3 5.5h9v6H7l-3 2.5v-2.5H3zM12 8.5h5v6h-1v2.3l-2.8-2.3H9v-2" /></S>;
export const Key = (p: P) => <S {...p}><circle cx="13.2" cy="6.8" r="3.6" /><circle cx="13.9" cy="6.1" r=".6" fill="currentColor" stroke="none" /><path d="M10.6 9.4 4 16v1.6h2.2l.6-.6v-1.4h1.4l.9-.9v-1.3h1.3l1.4-1.4" /></S>;
// Đồng hồ đo: thanh đo ngữ cảnh (bàn trộn).
export const Gauge = (p: P) => <S {...p}><path d="M3.6 14.2a6.6 6.6 0 1112.8 0" /><path d="M10 13.4l3.1-4.2" /><circle cx="10" cy="13.6" r=".9" fill="currentColor" stroke="none" /></S>;
export const Sparkle = (p: P) => <S {...p}><path d="M10 3l1.8 4.6L16.5 9l-4.7 1.4L10 15l-1.8-4.6L3.5 9l4.7-1.4z" /></S>;
export const Pulse = (p: P) => <S {...p}><path d="M3 10h2l2-5 3 10 2-6 1.5 3H17" /></S>;
export const Swap = (p: P) => <S {...p}><path d="M4 7h11l-3-3M16 13H5l3 3" /></S>;
export const Subtitle = (p: P) => <S {...p}><rect x="3" y="4.5" width="14" height="11" rx="2" /><path d="M6 12h3M11 12h3M6 9h8" /></S>;
export const Book = (p: P) => <S {...p}><path d="M4 4.5h5a2 2 0 012 2V16a1.5 1.5 0 00-1.5-1.5H4zM16 4.5h-5a2 2 0 00-2 2V16a1.5 1.5 0 011.5-1.5H16z" /></S>;
export const VoicePlus = (p: P) => <S {...p}><circle cx="10" cy="7" r="3" /><path d="M4.5 16.5c.7-2.8 2.8-4.3 5.5-4.3s4.8 1.5 5.5 4.3M15.5 2.5v4M13.5 4.5h4" /></S>;
export const Film = (p: P) => <S {...p}><rect x="3" y="4" width="14" height="12" rx="2.4" /><circle cx="10" cy="9" r="2.3" /><path d="M6.5 16c.6-2 1.9-3 3.5-3s2.9 1 3.5 3" /></S>;
export const ShieldCheck = (p: P) => <S24 {...p}><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="m9 12 2 2 4-4" /></S24>;

// Bộ icon của menu Cài đặt, vẽ trên lưới 24 theo kiểu Lucide (ISC), nét quy đổi bằng nét 1.4/20 của các icon khác để đứng cạnh nhau đều nhau.
const L = ({ size = 18, children }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);
export const SetGeneral = (p: P) => <L {...p}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></L>;
export const SetAdmin = (p: P) => <L {...p}><rect x="2.5" y="7" width="19" height="13" rx="2.5" /><path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7" /><path d="M2.5 12.5h19" /></L>;
export const SetAccount = (p: P) => <L {...p}><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5c.6-3.6 3.7-6 7.5-6s6.9 2.4 7.5 6" /></L>;
export const SetPrivacy = (p: P) => <L {...p}><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><rect x="9.25" y="11" width="5.5" height="4.5" rx="1" /><path d="M10.5 11V9.75a1.5 1.5 0 0 1 3 0V11" /></L>;
export const SetCapabilities = (p: P) => <L {...p}><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" /><path d="M20 3v4M22 5h-4" /></L>;
export const SetMemory = (p: P) => <L {...p}><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" /><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" /><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" /><path d="M17.599 6.5a3 3 0 0 0 .399-1.375M6.003 5.125A3 3 0 0 0 6.401 6.5M3.477 10.896a4 4 0 0 1 .585-.396M19.938 10.5a4 4 0 0 1 .585.396M6 18a4 4 0 0 1-1.967-.516M19.967 17.484A4 4 0 0 1 18 18" /></L>;
export const SetKey = (p: P) => <L {...p}><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" /><circle cx="16.5" cy="7.5" r=".6" fill="currentColor" /></L>;
// Cài đặt → Providers: con chip (ô vuông bo góc, lõi nhỏ ở giữa, mỗi cạnh hai chân).
export const SetChip = (p: P) => <L {...p}><rect x="5" y="5" width="14" height="14" rx="3" /><rect x="9.25" y="9.25" width="5.5" height="5.5" rx="1.2" /><path d="M9.5 2.5V5M14.5 2.5V5M9.5 19v2.5M14.5 19v2.5M2.5 9.5H5M2.5 14.5H5M19 9.5h2.5M19 14.5h2.5" /></L>;
// Menu tài khoản: tải ứng dụng (máy tính + điện thoại) và phím tắt.
export const GetApps = (p: P) => <L {...p}><rect x="2" y="4.5" width="13" height="10" rx="1.8" /><path d="M6.3 19h4.4M8.5 14.5V19" /><rect x="17" y="8.5" width="5" height="11" rx="1.3" /><path d="M19 17h1" /></L>;
export const Keyboard = (p: P) => <L {...p}><rect x="2" y="5" width="20" height="14" rx="2.5" /><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12.5h.01M18 12.5h.01M10 12.5h4M8 16h8" /></L>;
// Connectors dùng chung icon với mục Customize (giữ tên SetPlug cho chỗ cũ).
export const SetPlug = (p: P) => <Connectors {...p} />;
