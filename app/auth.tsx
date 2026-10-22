"use client";
import { cn } from "./cn";
import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle, useMemo, useCallback, createContext, Children } from "react";
// Importing class-variance-authority for the built-in button component
import { cva, type VariantProps } from "class-variance-authority";
// Importing icons from lucide-react
import { ArrowRight, Mail, Gem, Lock, Eye, EyeOff, ArrowLeft, X, AlertCircle, PartyPopper, Loader } from "lucide-react";
// Importing animation components from framer-motion
import { AnimatePresence, motion, Variants, Transition } from "framer-motion";

// --- CONFETTI LOGIC ---
import type { ReactNode } from "react"
import type { GlobalOptions as ConfettiGlobalOptions, CreateTypes as ConfettiInstance, Options as ConfettiOptions } from "canvas-confetti"
import confetti from "canvas-confetti"

type Api = { fire: (options?: ConfettiOptions) => void }
export type ConfettiRef = Api | null
const ConfettiContext = createContext<Api>({} as Api)

const Confetti = forwardRef<ConfettiRef, React.ComponentPropsWithRef<"canvas"> & { options?: ConfettiOptions; globalOptions?: ConfettiGlobalOptions; manualstart?: boolean }>((props, ref) => {
  const { options, globalOptions = { resize: true, useWorker: true }, manualstart = false, ...rest } = props
  const instanceRef = useRef<ConfettiInstance | null>(null)
  const canvasRef = useCallback((node: HTMLCanvasElement) => {
    if (node !== null) {
      if (instanceRef.current) return
      instanceRef.current = confetti.create(node, { ...globalOptions, resize: true })
    } else {
      if (instanceRef.current) {
        instanceRef.current.reset()
        instanceRef.current = null
      }
    }
  }, [globalOptions])
  const fire = useCallback((opts = {}) => instanceRef.current?.({ ...options, ...opts }), [options])
  const api = useMemo(() => ({ fire }), [fire])
  useImperativeHandle(ref, () => api, [api])
  useEffect(() => { if (!manualstart) fire() }, [manualstart, fire])
  return <canvas ref={canvasRef} {...rest} />
})
Confetti.displayName = "Confetti";

// --- TEXT LOOP ANIMATION COMPONENT ---
type TextLoopProps = { children: React.ReactNode[]; className?: string; interval?: number; transition?: Transition; variants?: Variants; onIndexChange?: (index: number) => void; stopOnEnd?: boolean; };
export function TextLoop({ children, className, interval = 2, transition = { duration: 0.3 }, variants, onIndexChange, stopOnEnd = false }: TextLoopProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const items = Children.toArray(children);
  useEffect(() => {
    const intervalMs = interval * 1000;
    const timer = setInterval(() => {
      setCurrentIndex((current) => {
        if (stopOnEnd && current === items.length - 1) {
          clearInterval(timer);
          return current;
        }
        const next = (current + 1) % items.length;
        onIndexChange?.(next);
        return next;
      });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [items.length, interval, onIndexChange, stopOnEnd]);
  const motionVariants: Variants = {
    initial: { y: 20, opacity: 0 },
    animate: { y: 0, opacity: 1 },
    exit: { y: -20, opacity: 0 },
  };
  return (
    <div className={cn('relative inline-block whitespace-nowrap', className)}>
      <AnimatePresence mode='popLayout' initial={false}>
        <motion.div key={currentIndex} initial='initial' animate='animate' exit='exit' transition={transition} variants={variants || motionVariants}>
          {items[currentIndex]}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

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
      const button = e.currentTarget.querySelector('button');
      if (button && e.target !== button) button.click();
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

const signupSteps = ["Creating your account...", "Setting things up...", "Finalizing..."];
const loginSteps = ["Signing you in..."];
const TEXT_LOOP_INTERVAL = 0.9;
const PW_MIN = 8;

const DefaultLogo = () => ( <div className="bg-primary text-primary-foreground rounded-md p-1.5"> <Gem className="h-4 w-4" /> </div> );

// --- MAIN COMPONENT ---
export type AuthUser = { id: string; email: string; name: string; avatar: string | null; isAdmin: boolean; hasPassword: boolean; methods: string[]; createdAt: number };
export type Providers = Record<"google" | "github" | "apple", boolean>;
const PROVIDER_NAMES = { google: "Google", github: "GitHub", apple: "Apple" } as const;

interface AuthComponentProps {
  logo?: React.ReactNode;
  brandName?: string;
  providers?: Providers;
  onDone?: (user: AuthUser) => void;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Something went wrong. Please try again.");
  return j as T;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

export const AuthComponent = ({ logo = <DefaultLogo />, brandName = "EaseMize", providers, onDone }: AuthComponentProps) => {
  const [isLogin, setIsLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [authStep, setAuthStep] = useState("email");
  const [checking, setChecking] = useState(false);
  const [modalStatus, setModalStatus] = useState<'closed' | 'loading' | 'error' | 'success'>('closed');
  const [modalErrorMessage, setModalErrorMessage] = useState('');
  const confettiRef = useRef<ConfettiRef>(null);

  const isEmailValid = /\S+@\S+\.\S+/.test(email);
  const isPasswordValid = isLogin ? password.length > 0 : password.length >= PW_MIN;
  const isConfirmPasswordValid = confirmPassword.length >= PW_MIN;

  const passwordInputRef = useRef<HTMLInputElement>(null);
  const confirmPasswordInputRef = useRef<HTMLInputElement>(null);

  const fireSideCanons = () => {
    const fire = confettiRef.current?.fire;
    if (fire) {
        const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 100 };
        const particleCount = 50;
        fire({ ...defaults, particleCount, origin: { x: 0, y: 1 }, angle: 60 });
        fire({ ...defaults, particleCount, origin: { x: 1, y: 1 }, angle: 120 });
    }
  };

  const fail = (msg: string) => { setModalErrorMessage(msg); setModalStatus('error'); };

  // Gọi API; giữ hộp "đang xử lý" ít nhất minMs để các dòng chữ kịp chạy hết rồi mới báo thành công.
  const run = async (url: string, body: unknown, minMs: number) => {
    setModalStatus('loading');
    const t0 = Date.now();
    try {
        const { user } = await post<{ user: AuthUser }>(url, body);
        await wait(minMs - (Date.now() - t0));
        setModalStatus('success');
        setTimeout(() => onDone?.(user), 1100);
    } catch (e) { fail((e as Error).message); }
  };

  const handleFinalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (modalStatus !== 'closed') return;
    if (authStep === 'password' && isLogin) {
        if (isPasswordValid) await run("/api/auth/login", { email, password }, 700);
        return;
    }
    if (authStep !== 'confirmPassword') return;
    if (password !== confirmPassword) fail("Passwords do not match!");
    else await run("/api/auth/signup", { email, password }, signupSteps.length * TEXT_LOOP_INTERVAL * 1000);
  };

  const handleProgressStep = async () => {
    if (authStep === 'email') {
        if (!isEmailValid || checking) return;
        setChecking(true);
        try {
            const r = await post<{ exists: boolean; hasPassword: boolean; methods: (keyof Providers)[] }>("/api/auth/check", { email });
            if (r.exists && !r.hasPassword) { fail(`This account signs in with ${r.methods.map((m) => PROVIDER_NAMES[m] ?? m).join(", ")}. Use that button above.`); return; }
            setIsLogin(r.exists);
            setAuthStep("password");
        } catch (e) { fail((e as Error).message); }
        finally { setChecking(false); }
    } else if (authStep === 'password') {
        if (isPasswordValid && !isLogin) setAuthStep("confirmPassword");
    }
  };

  const social = (p: keyof Providers) => {
    if (modalStatus !== 'closed') return;
    if (!providers?.[p]) { fail(`${PROVIDER_NAMES[p]} sign-in isn't set up on the server yet.`); return; }
    window.location.href = `/api/auth/oauth/${p}`;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        handleProgressStep();
    }
  };

  const handleGoBack = () => {
    if (authStep === 'confirmPassword') {
        setAuthStep('password');
        setConfirmPassword('');
    }
    else if (authStep === 'password') { setAuthStep('email'); setPassword(''); }
  };

  const closeModal = () => {
    setModalStatus('closed');
    setModalErrorMessage('');
  };

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
    const ms = Math.round((OUT + 2 * STEP + DUR * 0.6) * 1000);
    if (authStep === 'password') { const t = setTimeout(() => passwordInputRef.current?.focus(), ms); return () => clearTimeout(t); }
    if (authStep === 'confirmPassword') { const t = setTimeout(() => confirmPasswordInputRef.current?.focus(), ms); return () => clearTimeout(t); }
}, [authStep]);

useEffect(() => {
    if (modalStatus === 'success') {
        fireSideCanons();
    }
}, [modalStatus]);

  const Modal = () => (
    <AnimatePresence>
        {modalStatus !== 'closed' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative bg-card/90 border border-border shadow-2xl rounded-2xl p-8 w-full max-w-sm flex flex-col items-center gap-4 mx-2">
                    {(modalStatus === 'error' || modalStatus === 'success') && <button onClick={closeModal} className="absolute top-2 right-2 p-1 text-muted-foreground hover:text-foreground transition-colors"><X className="w-5 h-5" /></button>}
                    {modalStatus === 'error' && <>
                        <AlertCircle className="w-12 h-12 text-destructive" />
                        <p className="text-lg font-medium text-foreground text-center">{modalErrorMessage}</p>
                        <GlassButton onClick={closeModal} size="sm" className="mt-4">Try Again</GlassButton>
                    </>}
                    {modalStatus === 'loading' &&
                        <TextLoop interval={TEXT_LOOP_INTERVAL} stopOnEnd={true}>
                            {(isLogin ? loginSteps : signupSteps).map((message, i) =>
                                <div key={i} className="flex flex-col items-center gap-4">
                                    <Loader className="w-12 h-12 text-primary animate-spin" />
                                    <p className="text-lg font-medium text-foreground">{message}</p>
                                </div>
                            )}
                        </TextLoop>
                    }
                    {modalStatus === 'success' &&
                        <div className="flex flex-col items-center gap-4">
                            <PartyPopper className="w-12 h-12 text-green-500" />
                            <p className="text-lg font-medium text-foreground">Welcome to Synchro!</p>
                        </div>
                    }
                </motion.div>
            </motion.div>
        )}
    </AnimatePresence>
  );

  return (
    <div className="auth-root bg-background min-h-screen w-screen flex flex-col fixed inset-0 z-[300]">
        <style>{`
            input[type="password"]::-ms-reveal, input[type="password"]::-ms-clear { display: none !important; } input[type="password"]::-webkit-credentials-auto-fill-button, input[type="password"]::-webkit-strong-password-auto-fill-button { display: none !important; } input:-webkit-autofill, input:-webkit-autofill:hover, input:-webkit-autofill:focus, input:-webkit-autofill:active { -webkit-box-shadow: 0 0 0 30px transparent inset !important; -webkit-text-fill-color: var(--foreground) !important; background-color: transparent !important; background-clip: content-box !important; transition: background-color 5000s ease-in-out 0s !important; color: var(--foreground) !important; caret-color: var(--foreground) !important; } input:autofill { background-color: transparent !important; background-clip: content-box !important; -webkit-text-fill-color: var(--foreground) !important; color: var(--foreground) !important; } input:-internal-autofill-selected { background-color: transparent !important; background-image: none !important; color: var(--foreground) !important; -webkit-text-fill-color: var(--foreground) !important; } input:-webkit-autofill::first-line { color: var(--foreground) !important; -webkit-text-fill-color: var(--foreground) !important; }
            @property --angle-1 { syntax: "<angle>"; inherits: false; initial-value: -75deg; } @property --angle-2 { syntax: "<angle>"; inherits: false; initial-value: -45deg; }
            .glass-button-wrap { --anim-time: 400ms; --anim-ease: cubic-bezier(0.25, 1, 0.5, 1); --border-width: clamp(1px, 0.0625em, 4px); position: relative; z-index: 2; transform-style: preserve-3d; transition: transform var(--anim-time) var(--anim-ease); } .glass-button-wrap:has(.glass-button:active) { transform: rotateX(25deg); } .glass-button-shadow { --shadow-cutoff-fix: 2em; position: absolute; width: calc(100% + var(--shadow-cutoff-fix)); height: calc(100% + var(--shadow-cutoff-fix)); top: calc(0% - var(--shadow-cutoff-fix) / 2); left: calc(0% - var(--shadow-cutoff-fix) / 2); filter: blur(clamp(2px, 0.125em, 12px)); transition: filter var(--anim-time) var(--anim-ease); pointer-events: none; z-index: 0; } .glass-button-shadow::after { content: ""; position: absolute; inset: 0; border-radius: 9999px; background: linear-gradient(180deg, oklch(from var(--foreground) l c h / 20%), oklch(from var(--foreground) l c h / 10%)); width: calc(100% - var(--shadow-cutoff-fix) - 0.25em); height: calc(100% - var(--shadow-cutoff-fix) - 0.25em); top: calc(var(--shadow-cutoff-fix) - 0.5em); left: calc(var(--shadow-cutoff-fix) - 0.875em); padding: 0.125em; box-sizing: border-box; mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; transition: all var(--anim-time) var(--anim-ease); opacity: 1; }
            .glass-button { -webkit-tap-highlight-color: transparent; backdrop-filter: blur(clamp(1px, 0.125em, 4px)); transition: all var(--anim-time) var(--anim-ease); background: linear-gradient(-75deg, oklch(from var(--background) l c h / 5%), oklch(from var(--background) l c h / 20%), oklch(from var(--background) l c h / 5%)); box-shadow: inset 0 0.125em 0.125em oklch(from var(--foreground) l c h / 5%), inset 0 -0.125em 0.125em oklch(from var(--background) l c h / 50%), 0 0.25em 0.125em -0.125em oklch(from var(--foreground) l c h / 20%), 0 0 0.1em 0.25em inset oklch(from var(--background) l c h / 20%), 0 0 0 0 oklch(from var(--background) l c h); } .glass-button:hover { transform: scale(0.975); backdrop-filter: blur(0.01em); box-shadow: inset 0 0.125em 0.125em oklch(from var(--foreground) l c h / 5%), inset 0 -0.125em 0.125em oklch(from var(--background) l c h / 50%), 0 0.15em 0.05em -0.1em oklch(from var(--foreground) l c h / 25%), 0 0 0.05em 0.1em inset oklch(from var(--background) l c h / 50%), 0 0 0 0 oklch(from var(--background) l c h); } .glass-button-text { color: oklch(from var(--foreground) l c h / 90%); text-shadow: 0em 0.25em 0.05em oklch(from var(--foreground) l c h / 10%); transition: all var(--anim-time) var(--anim-ease); } .glass-button:hover .glass-button-text { text-shadow: 0.025em 0.025em 0.025em oklch(from var(--foreground) l c h / 12%); } .glass-button-text::after { content: ""; display: block; position: absolute; width: calc(100% - var(--border-width)); height: calc(100% - var(--border-width)); top: calc(0% + var(--border-width) / 2); left: calc(0% + var(--border-width) / 2); box-sizing: border-box; border-radius: 9999px; overflow: clip; background: linear-gradient(var(--angle-2), transparent 0%, oklch(from var(--background) l c h / 50%) 40% 50%, transparent 55%); z-index: 3; mix-blend-mode: screen; pointer-events: none; background-size: 200% 200%; background-position: 0% 50%; transition: background-position calc(var(--anim-time) * 1.25) var(--anim-ease), --angle-2 calc(var(--anim-time) * 1.25) var(--anim-ease); } .glass-button:hover .glass-button-text::after { background-position: 25% 50%; } .glass-button:active .glass-button-text::after { background-position: 50% 15%; --angle-2: -15deg; } .glass-button::after { content: ""; position: absolute; z-index: 1; inset: 0; border-radius: 9999px; width: calc(100% + var(--border-width)); height: calc(100% + var(--border-width)); top: calc(0% - var(--border-width) / 2); left: calc(0% - var(--border-width) / 2); padding: var(--border-width); box-sizing: border-box; background: conic-gradient(from var(--angle-1) at 50% 50%, oklch(from var(--foreground) l c h / 50%) 0%, transparent 5% 40%, oklch(from var(--foreground) l c h / 50%) 50%, transparent 60% 95%, oklch(from var(--foreground) l c h / 50%) 100%), linear-gradient(180deg, oklch(from var(--background) l c h / 50%), oklch(from var(--background) l c h / 50%)); mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; transition: all var(--anim-time) var(--anim-ease), --angle-1 500ms ease; box-shadow: inset 0 0 0 calc(var(--border-width) / 2) oklch(from var(--background) l c h / 50%); pointer-events: none; } .glass-button:hover::after { --angle-1: -125deg; } .glass-button:active::after { --angle-1: -75deg; } .glass-button-wrap:has(.glass-button:hover) .glass-button-shadow { filter: blur(clamp(2px, 0.0625em, 6px)); } .glass-button-wrap:has(.glass-button:hover) .glass-button-shadow::after { top: calc(var(--shadow-cutoff-fix) - 0.875em); opacity: 1; } .glass-button-wrap:has(.glass-button:active) .glass-button-shadow { filter: blur(clamp(2px, 0.125em, 12px)); } .glass-button-wrap:has(.glass-button:active) .glass-button-shadow::after { top: calc(var(--shadow-cutoff-fix) - 0.5em); opacity: 0.75; } .glass-button-wrap:has(.glass-button:active) .glass-button-text { text-shadow: 0.025em 0.25em 0.05em oklch(from var(--foreground) l c h / 12%); } .glass-button-wrap:has(.glass-button:active) .glass-button { box-shadow: inset 0 0.125em 0.125em oklch(from var(--foreground) l c h / 5%), inset 0 -0.125em 0.125em oklch(from var(--background) l c h / 50%), 0 0.125em 0.125em -0.125em oklch(from var(--foreground) l c h / 20%), 0 0 0.1em 0.25em inset oklch(from var(--background) l c h / 20%), 0 0.225em 0.05em 0 oklch(from var(--foreground) l c h / 5%), 0 0.25em 0 0 oklch(from var(--background) l c h / 75%), inset 0 0.25em 0.05em 0 oklch(from var(--foreground) l c h / 15%); } @media (hover: none) and (pointer: coarse) { .glass-button::after, .glass-button:hover::after, .glass-button:active::after { --angle-1: -75deg; } .glass-button .glass-button-text::after, .glass-button:active .glass-button-text::after { --angle-2: -45deg; } }
            .glass-input-wrap { position: relative; z-index: 2; transform-style: preserve-3d; border-radius: 9999px; } .glass-input { display: flex; position: relative; width: 100%; align-items: center; gap: 0.5rem; border-radius: 9999px; padding: 0.25rem; -webkit-tap-highlight-color: transparent; backdrop-filter: blur(clamp(1px, 0.125em, 4px)); transition: all 400ms cubic-bezier(0.25, 1, 0.5, 1); background: linear-gradient(-75deg, oklch(from var(--background) l c h / 5%), oklch(from var(--background) l c h / 20%), oklch(from var(--background) l c h / 5%)); box-shadow: inset 0 0.125em 0.125em oklch(from var(--foreground) l c h / 5%), inset 0 -0.125em 0.125em oklch(from var(--background) l c h / 50%), 0 0.25em 0.125em -0.125em oklch(from var(--foreground) l c h / 20%), 0 0 0.1em 0.25em inset oklch(from var(--background) l c h / 20%), 0 0 0 0 oklch(from var(--background) l c h); } .glass-input-wrap:focus-within .glass-input { backdrop-filter: blur(0.01em); box-shadow: inset 0 0.125em 0.125em oklch(from var(--foreground) l c h / 5%), inset 0 -0.125em 0.125em oklch(from var(--background) l c h / 50%), 0 0.15em 0.05em -0.1em oklch(from var(--foreground) l c h / 25%), 0 0 0.05em 0.1em inset oklch(from var(--background) l c h / 50%), 0 0 0 0 oklch(from var(--background) l c h); } .glass-input::after { content: ""; position: absolute; z-index: 1; inset: 0; border-radius: 9999px; width: calc(100% + clamp(1px, 0.0625em, 4px)); height: calc(100% + clamp(1px, 0.0625em, 4px)); top: calc(0% - clamp(1px, 0.0625em, 4px) / 2); left: calc(0% - clamp(1px, 0.0625em, 4px) / 2); padding: clamp(1px, 0.0625em, 4px); box-sizing: border-box; background: conic-gradient(from var(--angle-1) at 50% 50%, oklch(from var(--foreground) l c h / 50%) 0%, transparent 5% 40%, oklch(from var(--foreground) l c h / 50%) 50%, transparent 60% 95%, oklch(from var(--foreground) l c h / 50%) 100%), linear-gradient(180deg, oklch(from var(--background) l c h / 50%), oklch(from var(--background) l c h / 50%)); mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; transition: all 400ms cubic-bezier(0.25, 1, 0.5, 1), --angle-1 500ms ease; box-shadow: inset 0 0 0 calc(clamp(1px, 0.0625em, 4px) / 2) oklch(from var(--background) l c h / 50%); pointer-events: none; } .glass-input-wrap:focus-within .glass-input::after { --angle-1: -125deg; } .glass-input-text-area { position: absolute; inset: 0; border-radius: 9999px; pointer-events: none; } .glass-input-text-area::after { content: ""; display: block; position: absolute; width: calc(100% - clamp(1px, 0.0625em, 4px)); height: calc(100% - clamp(1px, 0.0625em, 4px)); top: calc(0% + clamp(1px, 0.0625em, 4px) / 2); left: calc(0% + clamp(1px, 0.0625em, 4px) / 2); box-sizing: border-box; border-radius: 9999px; overflow: clip; background: linear-gradient(var(--angle-2), transparent 0%, oklch(from var(--background) l c h / 50%) 40% 50%, transparent 55%); z-index: 3; mix-blend-mode: screen; pointer-events: none; background-size: 200% 200%; background-position: 0% 50%; transition: background-position calc(400ms * 1.25) cubic-bezier(0.25, 1, 0.5, 1), --angle-2 calc(400ms * 1.25) cubic-bezier(0.25, 1, 0.5, 1); } .glass-input-wrap:focus-within .glass-input-text-area::after { background-position: 25% 50%; }
            .auth-root .glass-apple { --foreground: #faf9f5; --background: #121212; } .auth-root .glass-apple .glass-button { background: linear-gradient(-75deg, oklch(1 0 0 / 3%), oklch(1 0 0 / 10%), oklch(1 0 0 / 3%)), #161514; } .auth-root .glass-apple .glass-button-text { color: #fff; } .auth-root .glass-apple .glass-button-text::after { mix-blend-mode: screen; opacity: 1; } .auth-root .glass-apple .glass-button-shadow::after { background: linear-gradient(180deg, oklch(0 0 0 / 32%), oklch(0 0 0 / 14%)); } [data-theme="dark"] .auth-root .glass-apple { --foreground: #141413; --background: #fcfcfa; } [data-theme="dark"] .auth-root .glass-apple .glass-button { background: linear-gradient(-75deg, oklch(0 0 0 / 3%), oklch(0 0 0 / 8%), oklch(0 0 0 / 3%)), #f4f3ef; } [data-theme="dark"] .auth-root .glass-apple .glass-button-text { color: #141413; } [data-theme="dark"] .auth-root .glass-apple .glass-button-text::after { mix-blend-mode: normal; opacity: .5; } [data-theme="dark"] .auth-root .glass-apple .glass-button-shadow::after { background: linear-gradient(180deg, oklch(1 0 0 / 22%), oklch(1 0 0 / 10%)); }
        `}</style>

        <Confetti ref={confettiRef} manualstart className="fixed top-0 left-0 w-full h-full pointer-events-none z-[999]" />
        <Modal />

        <div className={cn( "fixed top-4 left-4 z-20 flex items-center gap-2", "md:left-1/2 md:-translate-x-1/2" )}>
            {logo}
            <h1 className="logo text-foreground" style={{ fontWeight: 400 }}>{brandName}</h1>
        </div>

        <div className={cn("flex w-full flex-1 h-full items-center justify-center bg-card", "relative overflow-hidden")}>
            <div className="absolute inset-0 z-0"><GradientBackground /></div>
            <fieldset disabled={modalStatus !== 'closed'} className="relative z-10 flex flex-col items-center gap-8 w-[280px] mx-auto p-4">
                <AnimatePresence mode="wait" initial={true}>
                    {authStep === "email" && <motion.div key="email-content" exit={stepExit} className="w-full flex flex-col items-center gap-4">
                        <BlurFade delay={BASE} className="w-full"><div className="text-center"><p className="font-serif font-light text-4xl sm:text-5xl md:text-6xl tracking-tight text-foreground whitespace-nowrap">Get started</p></div></BlurFade>
                        <BlurFade delay={BASE + STEP}><p className="text-sm font-medium text-muted-foreground">Continue with</p></BlurFade>
                        <BlurFade delay={BASE + STEP * 2}><div className="flex items-center justify-center gap-3 w-full">
                            <GlassButton type="button" onClick={() => social("google")} contentClassName="flex items-center justify-center gap-2 min-w-[112px]" size="sm"><GoogleIcon /><span className="font-semibold text-foreground">Google</span></GlassButton>
                            <GlassButton type="button" onClick={() => social("github")} contentClassName="flex items-center justify-center gap-2 min-w-[112px]" size="sm"><GitHubIcon /><span className="font-semibold text-foreground">GitHub</span></GlassButton>
                            <GlassButton type="button" onClick={() => social("apple")} className="glass-apple" contentClassName="flex items-center justify-center gap-2 min-w-[112px]" size="sm"><AppleIcon /><span className="font-semibold text-foreground">Apple</span></GlassButton>
                        </div></BlurFade>
                        <BlurFade delay={BASE + STEP * 3} className="w-[300px]"><div className="flex items-center w-full gap-2 py-2"><hr className="w-full border-border"/><span className="text-xs font-semibold text-muted-foreground">OR</span><hr className="w-full border-border"/></div></BlurFade>
                    </motion.div>}
                    {authStep === "password" && <motion.div key="password-title" exit={stepExit} className="w-full flex flex-col items-center text-center gap-4">
                        <BlurFade className="w-full"><div className="text-center"><p className="font-serif font-light text-4xl sm:text-5xl tracking-tight text-foreground whitespace-nowrap">{isLogin ? "Welcome back" : "Create your password"}</p></div></BlurFade>
                        <BlurFade delay={STEP}><p className="text-sm font-medium text-muted-foreground">{isLogin ? "Enter your password to sign in." : "Your password must be at least 8 characters long."}</p></BlurFade>
                    </motion.div>}
                     {authStep === "confirmPassword" && <motion.div key="confirm-title" exit={stepExit} className="w-full flex flex-col items-center text-center gap-4">
                         <BlurFade className="w-full"><div className="text-center"><p className="font-serif font-light text-4xl sm:text-5xl tracking-tight text-foreground whitespace-nowrap">One last step</p></div></BlurFade>
                         <BlurFade delay={STEP}><p className="text-sm font-medium text-muted-foreground">Confirm your password to continue</p></BlurFade>
                    </motion.div>}
                </AnimatePresence>

                <motion.form layout transition={{ layout: { duration: DUR, ease: EASE } }} onSubmit={handleFinalSubmit} className="w-[300px] space-y-6">
                     <AnimatePresence>
                        {authStep !== 'confirmPassword' && <motion.div key="email-password-fields" exit={stepExit} className="w-full space-y-6">
                            <BlurFade delay={authStep === 'email' ? BASE + STEP * 4 : 0} className="w-full">
                                <div className="relative w-full">
                                    <AnimatePresence>
                                        {authStep === "password" && <motion.div initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1, transition: { delay: OUT + STEP * 2, duration: DUR, ease: EASE } }} exit={{ opacity: 0, transition: { duration: OUT } }} className="absolute -top-6 left-4 z-10"><label className="text-xs text-muted-foreground font-semibold">Email</label></motion.div>}
                                    </AnimatePresence>
                                    <div className="glass-input-wrap w-full"><div className="glass-input">
                                        <span className="glass-input-text-area"></span>
                                        <div className={cn( "relative z-10 flex-shrink-0 flex items-center justify-center overflow-hidden transition-all duration-300 ease-in-out", email.length > 20 && authStep === 'email' ? "w-0 px-0" : "w-10 pl-2" )}><Mail className="h-5 w-5 text-foreground/80 flex-shrink-0" /></div>
                                        <input type="email" autoComplete="email" readOnly={authStep !== 'email'} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={handleKeyDown} className={cn("relative z-10 h-full w-0 flex-grow bg-transparent text-foreground placeholder:text-foreground/60 focus:outline-none transition-[padding-right] duration-300 ease-in-out delay-300", isEmailValid && authStep === 'email' ? "pr-2" : "pr-0")} />
                                        <div className={cn( "relative z-10 flex-shrink-0 overflow-hidden transition-all duration-300 ease-in-out", isEmailValid && authStep === 'email' ? "w-10 pr-1" : "w-0" )}><GlassButton type="button" onClick={handleProgressStep} size="icon" aria-label="Continue with email" contentClassName="text-foreground/80 hover:text-foreground">{checking ? <Loader className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}</GlassButton></div>
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
                                            <input ref={passwordInputRef} type={showPassword ? "text" : "password"} autoComplete={isLogin ? "current-password" : "new-password"} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (isLogin) handleFinalSubmit(e as unknown as React.FormEvent); else handleProgressStep(); } }} className="relative z-10 h-full w-0 flex-grow bg-transparent text-foreground placeholder:text-foreground/60 focus:outline-none" />
                                            <div className={cn( "relative z-10 flex-shrink-0 overflow-hidden transition-all duration-300 ease-in-out", isPasswordValid ? "w-10 pr-1" : "w-0" )}><GlassButton type={isLogin ? "submit" : "button"} onClick={isLogin ? undefined : handleProgressStep} size="icon" aria-label="Submit password" contentClassName="text-foreground/80 hover:text-foreground"><ArrowRight className="w-5 h-5" /></GlassButton></div>
                                        </div></div>
                                    </div>
                                    <BlurFade delay={OUT + STEP * 3}><button type="button" onClick={handleGoBack} className="mt-4 flex items-center gap-2 text-sm text-foreground/70 hover:text-foreground transition-colors"><ArrowLeft className="w-4 h-4" /> Go back</button></BlurFade>
                                </BlurFade>}
                            </AnimatePresence>
                        </motion.div>}
                    </AnimatePresence>
                    <AnimatePresence>
                        {authStep === 'confirmPassword' && <BlurFade key="confirm-password-field" delay={OUT + STEP * 2} className="w-full">
                            <div className="relative w-full">
                                <AnimatePresence>
                                    {confirmPassword.length > 0 && <motion.div initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1, transition: { duration: DUR * 0.7, ease: EASE } }} exit={{ opacity: 0, transition: { duration: OUT } }} className="absolute -top-6 left-4 z-10"><label className="text-xs text-muted-foreground font-semibold">Confirm Password</label></motion.div>}
                                </AnimatePresence>
                                <div className="glass-input-wrap w-[300px]"><div className="glass-input">
                                    <span className="glass-input-text-area"></span>
                                    <div className="relative z-10 flex-shrink-0 flex items-center justify-center w-10 pl-2">
                                        {isConfirmPasswordValid ? <button type="button" aria-label="Toggle confirm password visibility" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="text-foreground/80 hover:text-foreground transition-colors p-2 rounded-full">{showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}</button> : <Lock className="h-5 w-5 text-foreground/80 flex-shrink-0" />}
                                    </div>
                                    <input ref={confirmPasswordInputRef} type={showConfirmPassword ? "text" : "password"} autoComplete="new-password" placeholder="Confirm Password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="relative z-10 h-full w-0 flex-grow bg-transparent text-foreground placeholder:text-foreground/60 focus:outline-none" />
                                    <div className={cn( "relative z-10 flex-shrink-0 overflow-hidden transition-all duration-300 ease-in-out", isConfirmPasswordValid ? "w-10 pr-1" : "w-0" )}><GlassButton type="submit" size="icon" aria-label="Finish sign-up" contentClassName="text-foreground/80 hover:text-foreground"><ArrowRight className="w-5 h-5" /></GlassButton></div>
                                </div></div>
                            </div>
                            <BlurFade delay={OUT + STEP * 3}><button type="button" onClick={handleGoBack} className="mt-4 flex items-center gap-2 text-sm text-foreground/70 hover:text-foreground transition-colors"><ArrowLeft className="w-4 h-4" /> Go back</button></BlurFade>
                        </BlurFade>}
                    </AnimatePresence>
                </motion.form>
            </fieldset>
        </div>
    </div>
  );
};
