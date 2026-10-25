"use client";
import { cn } from "./cn";
import React, { useState, useRef, useEffect } from "react";
// Importing class-variance-authority for the built-in button component
import { cva, type VariantProps } from "class-variance-authority";
// Importing icons from lucide-react
import { ArrowRight, Mail, Gem, Lock, Eye, EyeOff, ArrowLeft, User, Smile, CalendarDays } from "lucide-react";
// Importing animation components from framer-motion
import { AnimatePresence, motion, Variants } from "framer-motion";
import type { Perms } from "./catalog";

// --- NHỊP ANIMATION CHUNG ---
// Mọi lớp trong một bước dùng cùng easing và thời lượng, chỉ lệch nhau STEP giây, và đều bắt đầu
// ngay khi bước trước biến mất xong (OUT). Nhờ vậy tiêu đề, mô tả và ô nhập hiện lên cùng một nhịp.
const EASE = [0.22, 1, 0.36, 1] as const;
const DUR = 0.45;
const OUT = 0.18;
const STEP = 0.06;
const BASE = 0.08;

// --- BUILT-IN BLUR FADE ANIMATION COMPONENT ---
// Không dùng useInView: IntersectionObserver báo muộn 1–2 khung hình làm các lớp lệch nhịp nhau.
interface BlurFadeProps { children: React.ReactNode; className?: string; delay?: number; yOffset?: number; blur?: string; }
function BlurFade({ children, className, delay = 0, yOffset = 8, blur = "6px" }: BlurFadeProps) {
  const variants: Variants = {
    hidden: { y: yOffset, opacity: 0, filter: `blur(${blur})`, transition: { duration: OUT, ease: "easeIn" } },
    visible: { y: 0, opacity: 1, filter: "blur(0px)", transition: { delay, duration: DUR, ease: EASE } },
  };
  return <motion.div initial="hidden" animate="visible" exit="hidden" variants={variants} className={className}>{children}</motion.div>;
}
const stepExit = { opacity: 0, filter: "blur(4px)", transition: { duration: OUT, ease: "easeIn" as const } };


// --- BUILT-IN GLASS BUTTON COMPONENT (WITH CLICK FIX) ---
const glassButtonVariants = cva("relative isolate all-unset cursor-pointer rounded-full transition-all", { variants: { size: { default: "text-base font-medium", sm: "text-sm font-medium", lg: "text-lg font-medium", icon: "h-10 w-10" } }, defaultVariants: { size: "default" } });
const glassButtonTextVariants = cva("glass-button-text relative block select-none tracking-tighter", { variants: { size: { default: "px-6 py-3.5", sm: "px-4 py-2", lg: "px-8 py-4", icon: "flex h-10 w-10 items-center justify-center" } }, defaultVariants: { size: "default" } });
export interface GlassButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof glassButtonVariants> { contentClassName?: string; }
const GlassButton = React.forwardRef<HTMLButtonElement, GlassButtonProps>(
  ({ className, children, size, contentClassName, onClick, ...props }, ref) => {
    const handleWrapperClick = (e: React.MouseEvent<HTMLDivElement>) => {
      // Chỉ "bấm hộ" khi người dùng bấm vào phần viền/bóng bên ngoài nút; bấm vào chữ bên trong nút
      // đã kích hoạt nút rồi, bấm hộ thêm sẽ gửi form hai lần.
      const button = e.currentTarget.querySelector('button');
      if (button && !button.contains(e.target as Node)) button.click();
    };
    return (
      <div className={cn("glass-button-wrap cursor-pointer rounded-full relative", className)} onClick={handleWrapperClick}>
        <button className={cn("glass-button relative z-10", glassButtonVariants({ size }))} ref={ref} onClick={onClick} {...props}>
          <span className={cn(glassButtonTextVariants({ size }), contentClassName)}>{children}</span>
        </button>
        <div className="glass-button-shadow rounded-full pointer-events-none"></div>
      </div>
    );
  }
);
GlassButton.displayName = "GlassButton";


// --- GPU-friendly background (no SVG blur filters; only transforms are animated) ---
const GradientBackground = () => (
    <div className="auth-bg" aria-hidden>
        <i className="b1" /><i className="b2" /><i className="b3" />
    </div>
);


// --- CHILD COMPONENTS ---
const GoogleIcon = (props: React.SVGProps<SVGSVGElement>) => ( <svg {...props} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" className="w-6 h-6"> <g fillRule="evenodd" fill="none"> <g fillRule="nonzero" transform="translate(3, 2)"> <path fill="#4285F4" d="M57.8123233,30.1515267 C57.8123233,27.7263183 57.6155321,25.9565533 57.1896408,24.1212666 L29.4960833,24.1212666 L29.4960833,35.0674653 L45.7515771,35.0674653 C45.4239683,37.7877475 43.6542033,41.8844383 39.7213169,44.6372555 L39.6661883,45.0037254 L48.4223791,51.7870338 L49.0290201,51.8475849 C54.6004021,46.7020943 57.8123233,39.1313952 57.8123233,30.1515267"></path> <path fill="#34A853" d="M29.4960833,58.9921667 C37.4599129,58.9921667 44.1456164,56.3701671 49.0290201,51.8475849 L39.7213169,44.6372555 C37.2305867,46.3742596 33.887622,47.5868638 29.4960833,47.5868638 C21.6960582,47.5868638 15.0758763,42.4415991 12.7159637,35.3297782 L12.3700541,35.3591501 L3.26524241,42.4054492 L3.14617358,42.736447 C7.9965904,52.3717589 17.959737,58.9921667 29.4960833,58.9921667"></path> <path fill="#FBBC05" d="M12.7159637,35.3297782 C12.0932812,33.4944915 11.7329116,31.5279353 11.7329116,29.4960833 C11.7329116,27.4640054 12.0932812,25.4976752 12.6832029,23.6623884 L12.6667095,23.2715173 L3.44779955,16.1120237 L3.14617358,16.2554937 C1.14708246,20.2539019 0,24.7439491 0,29.4960833 C0,34.2482175 1.14708246,38.7380388 3.14617358,42.736447 L12.7159637,35.3297782"></path> <path fill="#EB4335" d="M29.4960833,11.4050769 C35.0347044,11.4050769 38.7707997,13.7975244 40.9011602,15.7968415 L49.2255853,7.66898166 C44.1130815,2.91684746 37.4599129,0 29.4960833,0 C17.959737,0 7.9965904,6.62018183 3.14617358,16.2554937 L12.6832029,23.6623884 C15.0758763,16.5505675 21.6960582,11.4050769 29.4960833,11.4050769"></path> </g> </g></svg> );
const GitHubIcon = (props: React.SVGProps<SVGSVGElement>) => ( <svg {...props} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" className="w-6 h-6"> <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/> </svg> );

const AppleIcon = () => ( <svg xmlns="http://www.w3.org/2000/svg" viewBox="-143 -50 1100 1100" className="w-6 h-6" aria-hidden> <path fill="currentColor" d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"/> </svg> );

const SUCCESS_HOLD = 1900; // thời gian giữ màn hình chúc mừng trước khi vào app

const DefaultLogo = () => ( <div className="bg-primary text-primary-foreground rounded-md p-1.5"> <Gem className="h-4 w-4" /> </div> );

// --- TYPES + API ---
export type AuthProfile = { fullName: string | null; nickname: string | null; birthDate: string | null; occupation: string | null };
export type AuthUser = { id: string; email: string; name: string; avatar: string | null; isAdmin: boolean; hasPassword: boolean; methods: string[]; createdAt: number; profile: AuthProfile; needsProfile: boolean; perms: Perms };
export type Providers = Record<"google" | "github" | "apple", boolean>;
const PROVIDER_NAMES = { google: "Google", github: "GitHub", apple: "Apple" } as const;
// Cùng danh sách với Cài đặt → Tài khoản để hai nơi hiển thị khớp nhau.
export const OCCUPATIONS = ["Student", "Engineering", "Design", "Product management", "Data science", "Marketing", "Sales", "Finance", "Operations", "Human resources", "Legal", "Other"];

type Kind = "login" | "profile";
type Stage = "form" | "loading" | "success" | "error";
const STATUS: Record<Kind, string[]> = {
  login: ["Signing you in…"],
  profile: ["Saving your profile…"],
};

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Something went wrong. Please try again.");
  return j as T;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

// Tên gọi mặc định: tên cuối trong họ tên Việt ("Nguyễn Hữu Lâm Tùng" → "Tùng").
const lastWord = (s: string) => s.trim().split(/\s+/).pop() ?? "";
const callName = (u: AuthUser | null, fallback = "") => u?.profile.nickname || lastWord(u?.profile.fullName ?? "") || u?.name || fallback;
// "DD/MM/YYYY" ↔ "YYYY-MM-DD"
function maskDob(raw: string) {
  const d = raw.replace(/\D/g, "").slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join("/");
}
function dobToIso(s: string) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd));
  return d.getUTCFullYear() === +yyyy && d.getUTCMonth() === +mm - 1 && d.getUTCDate() === +dd ? `${yyyy}-${mm}-${dd}` : null;
}
const isoToDob = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split("-").reverse().join("/") : "");

// --- STAGE: quả cầu kính cho đang xử lý / thành công / lỗi ---
function Orb({ stage }: { stage: Stage }) {
  return (
    <motion.div className={`auth-orb ${stage}`} initial={{ scale: 0.5, opacity: 0, filter: "blur(10px)" }} animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }} transition={{ duration: 0.6, ease: EASE }}>
      <span className="auth-orb-glow" aria-hidden />
      <AnimatePresence>
        {stage === "success" && <motion.span key="ring" className="auth-orb-ring" initial={{ scale: 1, opacity: 0.6 }} animate={{ scale: 2.6, opacity: 0 }} transition={{ duration: 1.3, ease: [0.16, 1, 0.3, 1] }} />}
        {stage === "success" && <motion.span key="ring2" className="auth-orb-ring" initial={{ scale: 1, opacity: 0.35 }} animate={{ scale: 1.9, opacity: 0 }} transition={{ duration: 1.3, delay: 0.18, ease: [0.16, 1, 0.3, 1] }} />}
      </AnimatePresence>
      <AnimatePresence mode="wait">
        {stage === "loading" && (
          <motion.svg key="spark" className="auth-spark" viewBox="0 0 40 40" aria-hidden exit={{ scale: 0.15, opacity: 0, rotate: 120, transition: { duration: 0.32, ease: "easeIn" } }}>
            {Array.from({ length: 12 }, (_, i) => <rect key={i} x="18.5" y="3.5" width="3" height="10.5" rx="1.5" transform={`rotate(${i * 30} 20 20)`} style={{ animationDelay: `${(i - 12) * 0.1}s` }} />)}
          </motion.svg>
        )}
        {stage === "success" && (
          <motion.svg key="check" className="auth-check" viewBox="0 0 40 40" aria-hidden initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.35, ease: EASE }}>
            <motion.path d="M11.5 20.8l5.7 5.7L28.8 14.6" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.55, delay: 0.1, ease: EASE }} />
          </motion.svg>
        )}
        {stage === "error" && (
          <motion.svg key="err" className="auth-alert" viewBox="0 0 40 40" aria-hidden initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1, x: [0, -6, 6, -3, 3, 0] }} transition={{ duration: 0.5, ease: "easeOut" }}>
            <path d="M20 11.5v10.5" fill="none" strokeWidth="3" strokeLinecap="round" /><circle cx="20" cy="28.2" r="1.9" stroke="none" />
          </motion.svg>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// Các dòng trạng thái lần lượt thay nhau, chữ có vệt sáng chạy qua.
function StatusLines({ lines }: { lines: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (lines.length < 2) return;
    const t = setInterval(() => setI((x) => Math.min(x + 1, lines.length - 1)), 1150);
    return () => clearInterval(t);
  }, [lines]);
  return (
    <div className="auth-status" role="status" aria-live="polite">
      <AnimatePresence mode="wait">
        <motion.p key={i} className="auth-shimmer" initial={{ opacity: 0, y: 6, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -6, filter: "blur(4px)" }} transition={{ duration: 0.32, ease: EASE }}>{lines[i]}</motion.p>
      </AnimatePresence>
    </div>
  );
}

// Lời chào: dòng đầu mờ dần lên, tên hiện từng chữ.
function Welcome({ kind, name }: { kind: Kind; name: string }) {
  return (
    <div className="auth-welcome" role="status">
      <motion.p className="auth-welcome-pre" initial={{ opacity: 0, y: 8, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.5, delay: 0.2, ease: EASE }}>{kind === "login" ? "Welcome back," : "Welcome to Synchro,"}</motion.p>
      <p className="auth-welcome-name" data-notr aria-label={name}>
        {Array.from(name).map((ch, i) => (
          <motion.span key={i} aria-hidden initial={{ opacity: 0, y: 16, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.6, delay: 0.42 + i * 0.035, ease: EASE }}>{ch === " " ? " " : ch}</motion.span>
        ))}
      </p>
    </div>
  );
}

function AuthStage({ stage, kind, user, fallbackName, error, onRetry }: { stage: Stage; kind: Kind; user: AuthUser | null; fallbackName: string; error: string; onRetry: () => void }) {
  return (
    <motion.div key="stage" className="auth-stage" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.97, filter: "blur(6px)", transition: { duration: 0.25 } }}>
      <Orb stage={stage} />
      <div className="auth-stage-text">
        <AnimatePresence mode="wait">
          {stage === "loading" && <motion.div key="l" exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.2 } }}><StatusLines lines={STATUS[kind]} /></motion.div>}
          {stage === "success" && <motion.div key="s"><Welcome kind={kind} name={callName(user, fallbackName)} /></motion.div>}
          {stage === "error" && (
            <motion.div key="e" className="auth-error" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}>
              <p className="auth-error-msg" role="alert">{error}</p>
              <GlassButton type="button" onClick={onRetry} size="sm">Try Again</GlassButton>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// Ô nhập kính có nhãn nổi phía trên khi đã có nội dung.
function GlassField({ icon, label, show, children }: { icon: React.ReactNode; label: string; show: boolean; children: React.ReactNode }) {
  return (
    <div className="relative w-full">
      <AnimatePresence>
        {show && <motion.div initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1, transition: { duration: DUR * 0.7, ease: EASE } }} exit={{ opacity: 0, transition: { duration: OUT } }} className="absolute -top-6 left-4 z-10"><label className="text-xs text-muted-foreground font-semibold">{label}</label></motion.div>}
      </AnimatePresence>
      <div className="glass-input-wrap w-full"><div className="glass-input">
        <span className="glass-input-text-area"></span>
        <div className="relative z-10 flex-shrink-0 flex items-center justify-center w-10 pl-2 text-foreground/80">{icon}</div>
        {children}
      </div></div>
    </div>
  );
}
const fieldInput = "relative z-10 h-full w-0 flex-grow bg-transparent text-foreground placeholder:text-foreground/60 focus:outline-none pr-3";

// --- MAIN COMPONENT ---
interface AuthComponentProps {
  logo?: React.ReactNode;
  brandName?: string;
  providers?: Providers;
  // "profile": người đã đăng nhập (thường qua Google/GitHub) nhưng chưa điền hồ sơ
  mode?: "auth" | "profile";
  user?: AuthUser | null;
  // true: app đã sẵn sàng phía dưới, màn hình này tan dần rồi gọi onLeft
  leaving?: boolean;
  onDone?: (user: AuthUser) => void;
  onLeft?: () => void;
  onSignOut?: () => void;
}

export const AuthComponent = ({ logo = <DefaultLogo />, brandName = "EaseMize", providers, mode = "auth", user = null, leaving = false, onDone, onLeft, onSignOut }: AuthComponentProps) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [authStep, setAuthStep] = useState(mode === "profile" ? "profile" : "email");
  const [checking, setChecking] = useState(false);
  const [stage, setStage] = useState<Stage>("form");
  const [kind, setKind] = useState<Kind>("login");
  const [errorMsg, setErrorMsg] = useState("");
  const [doneUser, setDoneUser] = useState<AuthUser | null>(null);
  // hồ sơ
  const initialName = user?.profile.fullName || (user && user.name !== user.email.split("@")[0] ? user.name : "");
  const [fullName, setFullName] = useState(initialName);
  const [nickname, setNickname] = useState(user?.profile.nickname || lastWord(initialName));
  const [nickTouched, setNickTouched] = useState(!!user?.profile.nickname);
  const [dob, setDob] = useState(isoToDob(user?.profile.birthDate ?? null));
  const [occupation, setOccupation] = useState(user?.profile.occupation || "");
  const [profileErr, setProfileErr] = useState("");

  const isEmailValid = /\S+@\S+\.\S+/.test(email);
  const isPasswordValid = password.length > 0;

  const passwordInputRef = useRef<HTMLInputElement>(null);
  const fullNameRef = useRef<HTMLInputElement>(null);

  const fail = (msg: string) => { setErrorMsg(msg); setStage("error"); };
  const busy = useRef(false); // chặn gửi trùng khi state chưa kịp cập nhật

  // Gọi API; giữ trạng thái đang xử lý ít nhất minMs cho mượt, rồi chúc mừng và vào app.
  const run = async (k: Kind, url: string, body: unknown, minMs: number) => {
    if (busy.current) return;
    busy.current = true;
    setKind(k);
    setStage("loading");
    const t0 = Date.now();
    try {
      const { user: u } = await post<{ user: AuthUser }>(url, body);
      await wait(minMs - (Date.now() - t0));
      // Chưa có hồ sơ (vd. tài khoản cũ): bỏ qua lời chào, chuyển thẳng sang bước điền hồ sơ.
      if (u.needsProfile) { busy.current = false; onDone?.(u); return; }
      setDoneUser(u);
      setStage("success");
      setTimeout(() => onDone?.(u), SUCCESS_HOLD);
    } catch (e) { busy.current = false; fail((e as Error).message); }
  };

  const submitProfile = async () => {
    const name = fullName.replace(/\s+/g, " ").trim();
    const iso = dobToIso(dob);
    if (name.length < 2) { setProfileErr("Please enter your full name."); return; }
    if (!iso) { setProfileErr("Please enter a valid date of birth (DD/MM/YYYY)."); return; }
    setProfileErr("");
    const profile = { fullName: name, nickname: nickname.trim() || lastWord(name), birthDate: iso, occupation };
    await run("profile", "/api/auth/profile", profile, 900);
  };

  const handleFinalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (stage !== "form") return;
    if (authStep === "password") {
      if (isPasswordValid) await run("login", "/api/auth/login", { email, password }, 900);
      return;
    }
    if (authStep === "profile") await submitProfile();
  };

  const handleProgressStep = async () => {
    if (authStep === "email") {
      if (!isEmailValid || checking) return;
      setChecking(true);
      try {
        // Web dùng cá nhân: chỉ email của chủ sở hữu đăng nhập được, không có đăng ký.
        const r = await post<{ owner: boolean; exists: boolean; hasPassword: boolean; methods: (keyof Providers)[] }>("/api/auth/check", { email });
        if (!r.owner) { fail("Synchro is a personal app. Only its owner can sign in."); return; }
        if (!r.exists) { fail("Sign in with Google the first time, or create your account on the server (scripts/create-admin.mjs)."); return; }
        if (!r.hasPassword) { fail(`This account signs in with ${r.methods.map((m) => PROVIDER_NAMES[m] ?? m).join(", ")}. Use that button above.`); return; }
        setAuthStep("password");
      } catch (e) { fail((e as Error).message); }
      finally { setChecking(false); }
    }
  };

  const socials = (["google", "github", "apple"] as const).filter((p) => providers?.[p]);
  const social = (p: keyof Providers) => {
    if (stage !== "form") return;
    if (!providers?.[p]) { fail(`${PROVIDER_NAMES[p]} sign-in isn't set up on the server yet.`); return; }
    window.location.href = `/api/auth/oauth/${p}`;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); handleProgressStep(); }
  };

  const handleGoBack = () => {
    if (authStep === "password") { setAuthStep("email"); setPassword(""); }
  };

  // Trang cha đổi mode: vào bước hồ sơ (đã đăng nhập nhưng thiếu hồ sơ) hoặc quay về từ đầu (đăng xuất).
  const prevMode = useRef(mode);
  useEffect(() => {
    const prev = prevMode.current;
    prevMode.current = mode;
    if (mode === "profile" && prev !== "profile" && user) {
      const n = user.profile.fullName || (user.name !== user.email.split("@")[0] ? user.name : "");
      setFullName(n); setNickname(user.profile.nickname || lastWord(n)); setNickTouched(!!user.profile.nickname);
      setDob(isoToDob(user.profile.birthDate)); setOccupation(user.profile.occupation || "");
      setAuthStep("profile"); setStage("form");
    } else if (mode === "auth" && prev === "profile" && !user) {
      setAuthStep("email"); setPassword(""); setStage("form");
    }
  }, [mode, user]);

  // Lỗi từ đăng nhập Google/GitHub/Apple được máy chủ trả về qua ?auth_error=
  useEffect(() => {
    const u = new URL(window.location.href);
    const err = u.searchParams.get("auth_error");
    if (!err) return;
    fail(err);
    u.searchParams.delete("auth_error");
    window.history.replaceState(null, "", u.pathname + u.search + u.hash);
  }, []);

  useEffect(() => {
    if (stage !== "form") return;
    const ms = Math.round((OUT + 2 * STEP + DUR * 0.6) * 1000);
    const el = authStep === "password" ? passwordInputRef.current : authStep === "profile" && !fullName ? fullNameRef.current : null;
    if (!el) return;
    const t = setTimeout(() => el.focus(), ms);
    return () => clearTimeout(t);
  }, [authStep, stage]); // eslint-disable-line react-hooks/exhaustive-deps

  const titles: Record<string, [string, string]> = {
    email: ["Get started", socials.length ? "Continue with" : "Sign in with the owner's email"],
    password: ["Welcome back", "Enter your password to sign in."],
    profile: ["Tell us about you", "Synchro uses this to make your experience feel personal."],
  };

  return (
    <motion.div className="auth-root bg-background min-h-screen w-screen flex flex-col fixed inset-0 z-[300]" initial={false} animate={leaving ? { opacity: 0, scale: 1.04, filter: "blur(14px)" } : { opacity: 1, scale: 1, filter: "blur(0px)" }} transition={{ duration: 0.75, ease: EASE }} onAnimationComplete={() => { if (leaving) onLeft?.(); }} style={{ pointerEvents: leaving ? "none" : undefined }}>
        <style>{`
            input[type="password"]::-ms-reveal, input[type="password"]::-ms-clear { display: none !important; } input[type="password"]::-webkit-credentials-auto-fill-button, input[type="password"]::-webkit-strong-password-auto-fill-button { display: none !important; } input:-webkit-autofill, input:-webkit-autofill:hover, input:-webkit-autofill:focus, input:-webkit-autofill:active { -webkit-box-shadow: 0 0 0 30px transparent inset !important; -webkit-text-fill-color: var(--foreground) !important; background-color: transparent !important; background-clip: content-box !important; transition: background-color 5000s ease-in-out 0s !important; color: var(--foreground) !important; caret-color: var(--foreground) !important; } input:autofill { background-color: transparent !important; background-clip: content-box !important; -webkit-text-fill-color: var(--foreground) !important; color: var(--foreground) !important; } input:-internal-autofill-selected { background-color: transparent !important; background-image: none !important; color: var(--foreground) !important; -webkit-text-fill-color: var(--foreground) !important; } input:-webkit-autofill::first-line { color: var(--foreground) !important; -webkit-text-fill-color: var(--foreground) !important; }
            @property --angle-1 { syntax: "<angle>"; inherits: false; initial-value: -75deg; } @property --angle-2 { syntax: "<angle>"; inherits: false; initial-value: -45deg; }
            .glass-button-wrap { --anim-time: 400ms; --anim-ease: cubic-bezier(0.25, 1, 0.5, 1); --border-width: clamp(1px, 0.0625em, 4px); position: relative; z-index: 2; transform-style: preserve-3d; transition: transform var(--anim-time) var(--anim-ease); } .glass-button-wrap:has(.glass-button:active) { transform: rotateX(25deg); } .glass-button-shadow { --shadow-cutoff-fix: 2em; position: absolute; width: calc(100% + var(--shadow-cutoff-fix)); height: calc(100% + var(--shadow-cutoff-fix)); top: calc(0% - var(--shadow-cutoff-fix) / 2); left: calc(0% - var(--shadow-cutoff-fix) / 2); filter: blur(clamp(2px, 0.125em, 12px)); transition: filter var(--anim-time) var(--anim-ease); pointer-events: none; z-index: 0; } .glass-button-shadow::after { content: ""; position: absolute; inset: 0; border-radius: 9999px; background: linear-gradient(180deg, oklch(from var(--foreground) l c h / 20%), oklch(from var(--foreground) l c h / 10%)); width: calc(100% - var(--shadow-cutoff-fix) - 0.25em); height: calc(100% - var(--shadow-cutoff-fix) - 0.25em); top: calc(var(--shadow-cutoff-fix) - 0.5em); left: calc(var(--shadow-cutoff-fix) - 0.875em); padding: 0.125em; box-sizing: border-box; mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; transition: all var(--anim-time) var(--anim-ease); opacity: 1; }
            .glass-button { -webkit-tap-highlight-color: transparent; backdrop-filter: blur(clamp(1px, 0.125em, 4px)); transition: all var(--anim-time) var(--anim-ease); background: linear-gradient(-75deg, oklch(from var(--background) l c h / 5%), oklch(from var(--background) l c h / 20%), oklch(from var(--background) l c h / 5%)); box-shadow: inset 0 0.125em 0.125em oklch(from var(--foreground) l c h / 5%), inset 0 -0.125em 0.125em oklch(from var(--background) l c h / 50%), 0 0.25em 0.125em -0.125em oklch(from var(--foreground) l c h / 20%), 0 0 0.1em 0.25em inset oklch(from var(--background) l c h / 20%), 0 0 0 0 oklch(from var(--background) l c h); } .glass-button:hover { transform: scale(0.975); backdrop-filter: blur(0.01em); box-shadow: inset 0 0.125em 0.125em oklch(from var(--foreground) l c h / 5%), inset 0 -0.125em 0.125em oklch(from var(--background) l c h / 50%), 0 0.15em 0.05em -0.1em oklch(from var(--foreground) l c h / 25%), 0 0 0.05em 0.1em inset oklch(from var(--background) l c h / 50%), 0 0 0 0 oklch(from var(--background) l c h); } .glass-button-text { color: oklch(from var(--foreground) l c h / 90%); text-shadow: 0em 0.25em 0.05em oklch(from var(--foreground) l c h / 10%); transition: all var(--anim-time) var(--anim-ease); } .glass-button:hover .glass-button-text { text-shadow: 0.025em 0.025em 0.025em oklch(from var(--foreground) l c h / 12%); } .glass-button-text::after { content: ""; display: block; position: absolute; width: calc(100% - var(--border-width)); height: calc(100% - var(--border-width)); top: calc(0% + var(--border-width) / 2); left: calc(0% + var(--border-width) / 2); box-sizing: border-box; border-radius: 9999px; overflow: clip; background: linear-gradient(var(--angle-2), transparent 0%, oklch(from var(--background) l c h / 50%) 40% 50%, transparent 55%); z-index: 3; mix-blend-mode: screen; pointer-events: none; background-size: 200% 200%; background-position: 0% 50%; transition: background-position calc(var(--anim-time) * 1.25) var(--anim-ease), --angle-2 calc(var(--anim-time) * 1.25) var(--anim-ease); } .glass-button:hover .glass-button-text::after { background-position: 25% 50%; } .glass-button:active .glass-button-text::after { background-position: 50% 15%; --angle-2: -15deg; } .glass-button::after { content: ""; position: absolute; z-index: 1; inset: 0; border-radius: 9999px; width: calc(100% + var(--border-width)); height: calc(100% + var(--border-width)); top: calc(0% - var(--border-width) / 2); left: calc(0% - var(--border-width) / 2); padding: var(--border-width); box-sizing: border-box; background: conic-gradient(from var(--angle-1) at 50% 50%, oklch(from var(--foreground) l c h / 50%) 0%, transparent 5% 40%, oklch(from var(--foreground) l c h / 50%) 50%, transparent 60% 95%, oklch(from var(--foreground) l c h / 50%) 100%), linear-gradient(180deg, oklch(from var(--background) l c h / 50%), oklch(from var(--background) l c h / 50%)); mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; transition: all var(--anim-time) var(--anim-ease), --angle-1 500ms ease; box-shadow: inset 0 0 0 calc(var(--border-width) / 2) oklch(from var(--background) l c h / 50%); pointer-events: none; } .glass-button:hover::after { --angle-1: -125deg; } .glass-button:active::after { --angle-1: -75deg; } .glass-button-wrap:has(.glass-button:hover) .glass-button-shadow { filter: blur(clamp(2px, 0.0625em, 6px)); } .glass-button-wrap:has(.glass-button:hover) .glass-button-shadow::after { top: calc(var(--shadow-cutoff-fix) - 0.875em); opacity: 1; } .glass-button-wrap:has(.glass-button:active) .glass-button-shadow { filter: blur(clamp(2px, 0.125em, 12px)); } .glass-button-wrap:has(.glass-button:active) .glass-button-shadow::after { top: calc(var(--shadow-cutoff-fix) - 0.5em); opacity: 0.75; } .glass-button-wrap:has(.glass-button:active) .glass-button-text { text-shadow: 0.025em 0.25em 0.05em oklch(from var(--foreground) l c h / 12%); } .glass-button-wrap:has(.glass-button:active) .glass-button { box-shadow: inset 0 0.125em 0.125em oklch(from var(--foreground) l c h / 5%), inset 0 -0.125em 0.125em oklch(from var(--background) l c h / 50%), 0 0.125em 0.125em -0.125em oklch(from var(--foreground) l c h / 20%), 0 0 0.1em 0.25em inset oklch(from var(--background) l c h / 20%), 0 0.225em 0.05em 0 oklch(from var(--foreground) l c h / 5%), 0 0.25em 0 0 oklch(from var(--background) l c h / 75%), inset 0 0.25em 0.05em 0 oklch(from var(--foreground) l c h / 15%); } @media (hover: none) and (pointer: coarse) { .glass-button::after, .glass-button:hover::after, .glass-button:active::after { --angle-1: -75deg; } .glass-button .glass-button-text::after, .glass-button:active .glass-button-text::after { --angle-2: -45deg; } }
            .glass-input-wrap { position: relative; z-index: 2; transform-style: preserve-3d; border-radius: 9999px; } .glass-input { display: flex; position: relative; width: 100%; align-items: center; gap: 0.5rem; border-radius: 9999px; padding: 0.25rem; -webkit-tap-highlight-color: transparent; backdrop-filter: blur(clamp(1px, 0.125em, 4px)); transition: all 400ms cubic-bezier(0.25, 1, 0.5, 1); background: linear-gradient(-75deg, oklch(from var(--background) l c h / 5%), oklch(from var(--background) l c h / 20%), oklch(from var(--background) l c h / 5%)); box-shadow: inset 0 0.125em 0.125em oklch(from var(--foreground) l c h / 5%), inset 0 -0.125em 0.125em oklch(from var(--background) l c h / 50%), 0 0.25em 0.125em -0.125em oklch(from var(--foreground) l c h / 20%), 0 0 0.1em 0.25em inset oklch(from var(--background) l c h / 20%), 0 0 0 0 oklch(from var(--background) l c h); } .glass-input-wrap:focus-within .glass-input { backdrop-filter: blur(0.01em); box-shadow: inset 0 0.125em 0.125em oklch(from var(--foreground) l c h / 5%), inset 0 -0.125em 0.125em oklch(from var(--background) l c h / 50%), 0 0.15em 0.05em -0.1em oklch(from var(--foreground) l c h / 25%), 0 0 0.05em 0.1em inset oklch(from var(--background) l c h / 50%), 0 0 0 0 oklch(from var(--background) l c h); } .glass-input::after { content: ""; position: absolute; z-index: 1; inset: 0; border-radius: 9999px; width: calc(100% + clamp(1px, 0.0625em, 4px)); height: calc(100% + clamp(1px, 0.0625em, 4px)); top: calc(0% - clamp(1px, 0.0625em, 4px) / 2); left: calc(0% - clamp(1px, 0.0625em, 4px) / 2); padding: clamp(1px, 0.0625em, 4px); box-sizing: border-box; background: conic-gradient(from var(--angle-1) at 50% 50%, oklch(from var(--foreground) l c h / 50%) 0%, transparent 5% 40%, oklch(from var(--foreground) l c h / 50%) 50%, transparent 60% 95%, oklch(from var(--foreground) l c h / 50%) 100%), linear-gradient(180deg, oklch(from var(--background) l c h / 50%), oklch(from var(--background) l c h / 50%)); mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; transition: all 400ms cubic-bezier(0.25, 1, 0.5, 1), --angle-1 500ms ease; box-shadow: inset 0 0 0 calc(clamp(1px, 0.0625em, 4px) / 2) oklch(from var(--background) l c h / 50%); pointer-events: none; } .glass-input-wrap:focus-within .glass-input::after { --angle-1: -125deg; } .glass-input-text-area { position: absolute; inset: 0; border-radius: 9999px; pointer-events: none; } .glass-input-text-area::after { content: ""; display: block; position: absolute; width: calc(100% - clamp(1px, 0.0625em, 4px)); height: calc(100% - clamp(1px, 0.0625em, 4px)); top: calc(0% + clamp(1px, 0.0625em, 4px) / 2); left: calc(0% + clamp(1px, 0.0625em, 4px) / 2); box-sizing: border-box; border-radius: 9999px; overflow: clip; background: linear-gradient(var(--angle-2), transparent 0%, oklch(from var(--background) l c h / 50%) 40% 50%, transparent 55%); z-index: 3; mix-blend-mode: screen; pointer-events: none; background-size: 200% 200%; background-position: 0% 50%; transition: background-position calc(400ms * 1.25) cubic-bezier(0.25, 1, 0.5, 1), --angle-2 calc(400ms * 1.25) cubic-bezier(0.25, 1, 0.5, 1); } .glass-input-wrap:focus-within .glass-input-text-area::after { background-position: 25% 50%; }
        `}</style>

        <div className={cn( "fixed top-4 left-4 z-20 flex items-center gap-2", "md:left-1/2 md:-translate-x-1/2" )}>
            {logo}
            <h1 className="logo text-foreground" style={{ fontWeight: 360 }}>{brandName}</h1>
        </div>

        <div className={cn("flex w-full flex-1 h-full items-center justify-center bg-card", "relative overflow-hidden")}>
            <div className="absolute inset-0 z-0"><GradientBackground /></div>
            <AnimatePresence mode="wait">
            {stage === "form" ? (
            <motion.fieldset key="form" exit={{ opacity: 0, scale: 0.96, filter: "blur(10px)", transition: { duration: 0.35, ease: EASE } }} className="relative z-10 flex flex-col items-center gap-8 w-[280px] mx-auto p-4">
                <AnimatePresence mode="wait" initial={true}>
                    {authStep === "email" && <motion.div key="email-content" exit={stepExit} className="w-full flex flex-col items-center gap-4">
                        <BlurFade delay={BASE} className="w-full"><div className="text-center"><p className="font-serif font-light text-4xl sm:text-5xl md:text-6xl tracking-tight text-foreground whitespace-nowrap">{titles.email[0]}</p></div></BlurFade>
                        <BlurFade delay={BASE + STEP}><p className="text-sm font-medium text-muted-foreground">{titles.email[1]}</p></BlurFade>
                        {/* Chỉ hiện cách đăng nhập máy chủ đã thiết lập (web cá nhân thường chỉ dùng một cách). */}
                        {socials.length > 0 && <>
                        <BlurFade delay={BASE + STEP * 2}><div className="flex items-center justify-center gap-3 w-full">
                            {socials.includes("google") && <GlassButton type="button" onClick={() => social("google")} contentClassName="flex items-center justify-center gap-2 min-w-[112px]" size="sm"><GoogleIcon /><span className="font-semibold text-foreground">Google</span></GlassButton>}
                            {socials.includes("github") && <GlassButton type="button" onClick={() => social("github")} contentClassName="flex items-center justify-center gap-2 min-w-[112px]" size="sm"><GitHubIcon /><span className="font-semibold text-foreground">GitHub</span></GlassButton>}
                            {socials.includes("apple") && <GlassButton type="button" onClick={() => social("apple")} contentClassName="flex items-center justify-center gap-2 min-w-[112px]" size="sm"><AppleIcon /><span className="font-semibold text-foreground">Apple</span></GlassButton>}
                        </div></BlurFade>
                        <BlurFade delay={BASE + STEP * 3} className="w-[300px]"><div className="flex items-center w-full gap-2 py-2"><hr className="w-full border-border"/><span className="text-xs font-semibold text-muted-foreground">OR</span><hr className="w-full border-border"/></div></BlurFade>
                        </>}
                    </motion.div>}
                    {authStep !== "email" && <motion.div key={`${authStep}-title`} exit={stepExit} className="w-full flex flex-col items-center text-center gap-4">
                        <BlurFade className="w-full"><div className="text-center"><p className="font-serif font-light text-4xl sm:text-5xl tracking-tight text-foreground whitespace-nowrap">{titles[authStep][0]}</p></div></BlurFade>
                        <BlurFade delay={STEP}><p className="text-sm font-medium text-muted-foreground">{titles[authStep][1]}</p></BlurFade>
                        {mode === "profile" && user && <BlurFade delay={STEP * 2}><p className="auth-signed-as"><span>Signed in as</span> <b data-notr>{user.email}</b></p></BlurFade>}
                    </motion.div>}
                </AnimatePresence>

                <motion.form layout transition={{ layout: { duration: DUR, ease: EASE } }} onSubmit={handleFinalSubmit} className="w-[300px] space-y-6">
                     <AnimatePresence>
                        {(authStep === "email" || authStep === "password") && <motion.div key="email-password-fields" exit={stepExit} className="w-full space-y-6">
                            <BlurFade delay={authStep === "email" ? BASE + STEP * 4 : 0} className="w-full">
                                <div className="relative w-full">
                                    <AnimatePresence>
                                        {authStep === "password" && <motion.div initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1, transition: { delay: OUT + STEP * 2, duration: DUR, ease: EASE } }} exit={{ opacity: 0, transition: { duration: OUT } }} className="absolute -top-6 left-4 z-10"><label className="text-xs text-muted-foreground font-semibold">Email</label></motion.div>}
                                    </AnimatePresence>
                                    <div className="glass-input-wrap w-full"><div className="glass-input">
                                        <span className="glass-input-text-area"></span>
                                        <div className={cn( "relative z-10 flex-shrink-0 flex items-center justify-center overflow-hidden transition-all duration-300 ease-in-out", email.length > 20 && authStep === "email" ? "w-0 px-0" : "w-10 pl-2" )}><Mail className="h-5 w-5 text-foreground/80 flex-shrink-0" /></div>
                                        <input type="email" autoComplete="email" readOnly={authStep !== "email"} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={handleKeyDown} className={cn("relative z-10 h-full w-0 flex-grow bg-transparent text-foreground placeholder:text-foreground/60 focus:outline-none transition-[padding-right] duration-300 ease-in-out delay-300", isEmailValid && authStep === "email" ? "pr-2" : "pr-0")} />
                                        <div className={cn( "relative z-10 flex-shrink-0 overflow-hidden transition-all duration-300 ease-in-out", isEmailValid && authStep === "email" ? "w-10 pr-1" : "w-0" )}><GlassButton type="button" onClick={handleProgressStep} size="icon" aria-label="Continue with email" contentClassName="text-foreground/80 hover:text-foreground">{checking ? <span className="auth-mini-spin" aria-hidden /> : <ArrowRight className="w-5 h-5" />}</GlassButton></div>
                                    </div></div>
                                </div>
                            </BlurFade>
                            <AnimatePresence>
                                {authStep === "password" && <BlurFade key="password-field" delay={OUT + STEP * 2} className="w-full">
                                    <div className="relative w-full">
                                        <AnimatePresence>
                                            {password.length > 0 && <motion.div initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1, transition: { duration: DUR * 0.7, ease: EASE } }} exit={{ opacity: 0, transition: { duration: OUT } }} className="absolute -top-6 left-4 z-10"><label className="text-xs text-muted-foreground font-semibold">Password</label></motion.div>}
                                        </AnimatePresence>
                                        <div className="glass-input-wrap w-full"><div className="glass-input">
                                            <span className="glass-input-text-area"></span>
                                            <div className="relative z-10 flex-shrink-0 flex items-center justify-center w-10 pl-2">
                                                {isPasswordValid ? <button type="button" aria-label="Toggle password visibility" onClick={() => setShowPassword(!showPassword)} className="text-foreground/80 hover:text-foreground transition-colors p-2 rounded-full">{showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}</button> : <Lock className="h-5 w-5 text-foreground/80 flex-shrink-0" />}
                                            </div>
                                            <input ref={passwordInputRef} type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleFinalSubmit(e as unknown as React.FormEvent); } }} className="relative z-10 h-full w-0 flex-grow bg-transparent text-foreground placeholder:text-foreground/60 focus:outline-none" />
                                            <div className={cn( "relative z-10 flex-shrink-0 overflow-hidden transition-all duration-300 ease-in-out", isPasswordValid ? "w-10 pr-1" : "w-0" )}><GlassButton type="submit" size="icon" aria-label="Submit password" contentClassName="text-foreground/80 hover:text-foreground"><ArrowRight className="w-5 h-5" /></GlassButton></div>
                                        </div></div>
                                    </div>
                                    <BlurFade delay={OUT + STEP * 3}><button type="button" onClick={handleGoBack} className="mt-4 flex items-center gap-2 text-sm text-foreground/70 hover:text-foreground transition-colors"><ArrowLeft className="w-4 h-4" /> Go back</button></BlurFade>
                                </BlurFade>}
                            </AnimatePresence>
                        </motion.div>}
                    </AnimatePresence>
                    <AnimatePresence>
                        {authStep === "profile" && <motion.div key="profile-fields" exit={stepExit} className="w-full space-y-7 pt-1">
                            <BlurFade delay={OUT + STEP * 2} className="w-full">
                                <GlassField icon={<User className="h-5 w-5" />} label="Full name" show={fullName.length > 0}>
                                    <input ref={fullNameRef} autoComplete="name" placeholder="Full name" value={fullName} maxLength={80} onChange={(e) => { const v = e.target.value; setFullName(v); if (!nickTouched) setNickname(lastWord(v)); }} className={fieldInput} />
                                </GlassField>
                            </BlurFade>
                            <BlurFade delay={OUT + STEP * 3} className="w-full">
                                <GlassField icon={<Smile className="h-5 w-5" />} label="What should Synchro call you?" show={nickname.length > 0}>
                                    <input autoComplete="nickname" placeholder="What should Synchro call you?" value={nickname} maxLength={40} onChange={(e) => { setNickname(e.target.value); setNickTouched(true); }} className={fieldInput} />
                                </GlassField>
                            </BlurFade>
                            <BlurFade delay={OUT + STEP * 4} className="w-full">
                                <GlassField icon={<CalendarDays className="h-5 w-5" />} label="Date of birth" show={dob.length > 0}>
                                    <input inputMode="numeric" autoComplete="bday" placeholder="Date of birth (DD/MM/YYYY)" value={dob} onChange={(e) => setDob(maskDob(e.target.value))} className={fieldInput} />
                                </GlassField>
                            </BlurFade>
                            <BlurFade delay={OUT + STEP * 5} className="w-full">
                                <p className="auth-chips-label">What best describes your work? <span>(optional)</span></p>
                                <div className="auth-chips">
                                    {OCCUPATIONS.map((o) => <button key={o} type="button" className={cn("auth-chip", occupation === o && "on")} aria-pressed={occupation === o} onClick={() => setOccupation(occupation === o ? "" : o)}>{o}</button>)}
                                </div>
                            </BlurFade>
                            <BlurFade delay={OUT + STEP * 6} className="w-full">
                                <AnimatePresence>{profileErr && <motion.p key="perr" className="auth-field-err" role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{profileErr}</motion.p>}</AnimatePresence>
                                <GlassButton type="submit" className="w-full [&>button]:w-full" contentClassName="flex items-center justify-center gap-2 w-full"><span className="font-semibold text-foreground">Continue</span><ArrowRight className="w-4 h-4" /></GlassButton>
                                {mode === "profile"
                                  ? <button type="button" onClick={onSignOut} className="mt-4 flex items-center gap-2 text-sm text-foreground/70 hover:text-foreground transition-colors"><ArrowLeft className="w-4 h-4" /> Sign out</button>
                                  : <button type="button" onClick={handleGoBack} className="mt-4 flex items-center gap-2 text-sm text-foreground/70 hover:text-foreground transition-colors"><ArrowLeft className="w-4 h-4" /> Go back</button>}
                            </BlurFade>
                        </motion.div>}
                    </AnimatePresence>
                </motion.form>
            </motion.fieldset>
            ) : (
              <AuthStage key="stage" stage={stage} kind={kind} user={doneUser} fallbackName={email.split("@")[0]} error={errorMsg} onRetry={() => setStage("form")} />
            )}
            </AnimatePresence>
        </div>
    </motion.div>
  );
};
