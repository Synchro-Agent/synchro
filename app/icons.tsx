import React from "react";

type P = { size?: number };
const S = ({ size = 18, children, fill }: P & { children: React.ReactNode; fill?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const Plus = (p: P) => <S {...p}><path d="M10 4v12M4 10h12" /></S>;
export const Panel = (p: P) => <S {...p}><rect x="3" y="4" width="14" height="12" rx="2.5" /><path d="M8 4v12" /></S>;
export const Layers = (p: P) => <S {...p}><g className="ai-l1"><path d="M7 3.2h6" /></g><g className="ai-l2"><path d="M4.6 5.9h10.8" /></g><path d="M3.6 8.4h12.8M4.6 8.4l.8 6.9a1.8 1.8 0 001.8 1.6h5.6a1.8 1.8 0 001.8-1.6l.8-6.9" /></S>;
export const Shapes = (p: P) => <S {...p}><g className="ai-q"><path d="M7 2.4a5.4 5.4 0 015.4 5.4H7z" /></g><circle cx="5.6" cy="14" r="3.2" /><g className="ai-sq"><rect x="10.4" y="10.4" width="6.4" height="6.4" rx="1.3" /></g></S>;
export const Scroll = (p: P) => <S {...p}><path d="M5.2 3h7.3A1.8 1.8 0 0114.3 4.8V12" /><path d="M5.2 3a1.8 1.8 0 00-1.8 1.8v8.6M3.4 13.4h8.1v1.1a2.2 2.2 0 002.2 2.2H5.6a2.2 2.2 0 01-2.2-2.2zM11.5 13.4h5.1v1.1a2.2 2.2 0 01-2.9 2.1" /><path d="M7 7.3c.7-.7 1.3-.7 2 0s1.3.7 2 0" /></S>;
export const Code = (p: P) => <S {...p}><g className="ai-lt"><path d="M6.8 6L2.8 10l4 4" /></g><g className="ai-rt"><path d="M13.2 6l4 4-4 4" /></g><g className="ai-sl"><path d="M11.8 4l-3.6 12" /></g></S>;
export const Brief = (p: P) => <S {...p}><g className="ai-br"><rect x="3" y="6" width="14" height="10" rx="2" /><path d="M7.5 6V4.5h5V6M3 10.5h14" /></g></S>;
export const Pencil = (p: P) => <S {...p}><path d="M12.9 4a1.9 1.9 0 012.7 0l.4.4a1.9 1.9 0 010 2.7L7.6 15.5l-4 1 1-4zM11.2 5.8l3 3" /></S>;
export const Grad = (p: P) => <S {...p}><path d="M2 8l8-4 8 4-8 4zM5 10v4c0 1 2.2 2 5 2s5-1 5-2v-4" /></S>;
export const Coffee = (p: P) => <S {...p}><path d="M4 8h9v5a3 3 0 01-3 3H7a3 3 0 01-3-3zM13 9h1.5a2 2 0 010 4H13M7 3.5c0 1-1 1-1 2M10 3.5c0 1-1 1-1 2" /></S>;
export const Bulb = (p: P) => <S {...p}><path d="M7 14h6M8 16.5h4M10 3a5 5 0 00-3 9c.6.5 1 1.2 1 2h4c0-.8.4-1.5 1-2a5 5 0 00-3-9z" /></S>;
export const Mic = (p: P) => <S {...p}><rect x="7.5" y="3" width="5" height="9" rx="2.5" /><path d="M4.5 10a5.5 5.5 0 0011 0M10 15.5V18" /></S>;
export const Wave = (p: P) => <S {...p} fill><rect x="3" y="8" width="1.8" height="4" rx=".9" /><rect x="6.5" y="5" width="1.8" height="10" rx=".9" /><rect x="10" y="2.5" width="1.8" height="15" rx=".9" /><rect x="13.5" y="6" width="1.8" height="8" rx=".9" /><rect x="17" y="8.5" width="1.8" height="3" rx=".9" /></S>;
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
export const Shield = (p: P) => <S {...p}><path d="M10 2.5l6 2.3v4.7c0 3.5-2.5 6-6 8-3.5-2-6-4.5-6-8V4.8z" /></S>;
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
export const Brain = (p: P) => <S {...p}><path d="M10 4v12M7 4.5a2.5 2.5 0 00-2.5 2.5v.5A2.5 2.5 0 003 10a2.5 2.5 0 001.5 2.3V13A2.5 2.5 0 007 15.5M13 4.5A2.5 2.5 0 0115.5 7v.5A2.5 2.5 0 0117 10a2.5 2.5 0 01-1.5 2.3V13a2.5 2.5 0 01-2.5 2.5" /></S>;
export const Clock = (p: P) => <S {...p}><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 2" /></S>;
export const Spark = ({ size = 40 }: P) => (
  <svg width={size} height={size} viewBox="-4 -4 108 108" className="spark" aria-hidden>
    <defs>
      <linearGradient id="sk-f" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--sk-a)" /><stop offset="1" stopColor="var(--sk-b)" /></linearGradient>
      <linearGradient id="sk-r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--sk-r1)" /><stop offset=".5" stopColor="var(--sk-r2)" /><stop offset="1" stopColor="var(--sk-r1)" /></linearGradient>
      <filter id="sk-g" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="2.2" result="bl" />
        <feSpecularLighting in="bl" surfaceScale="5" specularConstant=".9" specularExponent="22" lightingColor="#fff" result="sp"><fePointLight x="10" y="-20" z="60" /></feSpecularLighting>
        <feComposite in="sp" in2="SourceAlpha" operator="in" result="sp2" />
        <feGaussianBlur in="SourceAlpha" stdDeviation="1.6" result="b2" />
        <feOffset in="b2" dy="2" result="o" />
        <feComposite in="SourceAlpha" in2="o" operator="out" result="inner" />
        <feFlood floodColor="var(--sk-sh)" result="fl" />
        <feComposite in="fl" in2="inner" operator="in" result="sh" />
        <feMerge><feMergeNode in="SourceGraphic" /><feMergeNode in="sh" /><feMergeNode in="sp2" /></feMerge>
      </filter>
    </defs>
    <path d="M99.9 17.3 63.4 29.8 60.7 30.0 58.8 29.1 58.2 28.5 57.1 26.7 56.0 22.1 54.9 12.6 54.5 11.2 54.2 10.9 53.4 10.9 52.7 11.4 51.5 12.9 48.4 17.6 38.1 31.8 36.8 33.3 35.6 34.0 34.1 34.3 32.6 34.2 22.8 32.2 10.4 30.3 7.9 29.7 6.4 29.7 6.1 30.0 6.1 30.7 19.8 50.2 21.0 49.9 32.4 45.0 40.8 41.7 43.2 41.4 44.2 42.2 44.2 43.5 43.8 44.6 42.6 46.2 39.4 49.3 35.6 52.3 32.1 54.5 3.6 71.5 0.0 73.9 1.8 73.6 20.7 67.2 23.4 67.0 24.1 67.3 25.0 68.2 25.7 70.3 28.4 87.7 29.2 88.8 29.8 88.9 30.2 88.8 31.2 87.7 37.8 78.9 45.4 68.1 47.3 66.4 48.4 66.1 50.0 66.1 53.1 66.9 74.3 70.5 76.5 70.3 76.6 69.3 75.1 66.7 63.2 50.1 53.7 54.1 50.7 55.1 46.9 56.9 42.4 58.6 40.9 58.9 39.4 58.6 38.8 57.7 39.0 56.5 40.3 54.1 42.4 51.7 47.8 47.7 54.3 44.0 69.2 34.9Z" fill="url(#sk-f)" stroke="url(#sk-r)" strokeWidth="1" strokeLinejoin="round" filter="url(#sk-g)" />
  </svg>
);
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
