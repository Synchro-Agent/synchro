// Bộ icon của Synchro: Phosphor Regular (MIT, @phosphor-icons/core) — outline, lưới 256; ui/icons.tsx viền thêm 2 đơn vị cho dày bằng bộ icon cũ. Script này đọc SVG của các icon Synchro dùng
// và ghi ui/phosphor-data.ts (các phần tử SVG gốc, giữ nguyên toạ độ) để vẽ icon tĩnh sắc nét; icon cần biến hình được morphicons đọc từ
// cùng dữ liệu (ui/morph.tsx). Thêm / đổi icon: sửa NAMES rồi chạy lại: node tools/phosphor-icons.mjs
import fs from "node:fs";

// Tên trong app (I.Search…) → tên Phosphor. Thêm cả icon đích của các chuyển động biến hình (thanh bên…).
export const NAMES = {
  Plus: "plus", Minus: "minus", Merge: "git-merge", Calendar: "calendar-blank", Panel: "sidebar-simple", Layers: "stack", Shapes: "shapes",
  Scroll: "scroll", Connectors: "plugs-connected", Plugins: "puzzle-piece", Code: "code", Brief: "briefcase", Pencil: "pencil-simple",
  Grad: "graduation-cap", Coffee: "coffee", Bulb: "lightbulb", Mic: "microphone", Wave: "waveform", Chevron: "caret-down", ChevronR: "caret-right",
  Check: "check", X: "x", Search: "magnifying-glass", Sliders: "sliders-horizontal", Grid: "squares-four", Connect: "link-simple", Ghost: "ghost",
  Clip: "paperclip", Camera: "camera", Globe: "globe-simple", History: "clock-counter-clockwise", Palette: "palette", Plug: "plug", Gear: "gear-six",
  User: "user", Shield: "shield", Lock: "lock-simple", Admin: "user-gear", Card: "credit-card", Bell: "bell", Moon: "moon", Sun: "sun",
  Monitor: "monitor", Copy: "copy", Speaker: "speaker-high", ThumbUp: "thumbs-up", ThumbDown: "thumbs-down", Retry: "arrow-clockwise", Stop: "stop",
  Arrow: "arrow-up", Sort: "arrows-down-up", List: "list-bullets", Brain: "brain", Clock: "clock", Pin: "push-pin", PinOff: "push-pin-slash",
  Folder: "folder-simple", Trash: "trash", Help: "question", Out: "sign-out", Cog: "gear-six", UpCircle: "arrow-circle-up", AppsPlus: "squares-four",
  InfoCircle: "info", Alert: "warning-circle", Enter: "arrow-elbow-down-left", Image: "image", Eye: "eye", Download: "download-simple",
  Terminal: "terminal-window", PanelR: "sidebar-simple", Dots: "dots-three-vertical", Branch: "git-branch", External: "arrow-square-out",
  Back: "arrow-left", File: "file", GitHub: "github-logo", Inbox: "tray", Pointer: "cursor", Compare: "columns", Rocket: "rocket-launch",
  Users: "users", FileUp: "file-arrow-up", Sparkles: "magic-wand", Library: "books", Expand: "arrows-out-simple", Collapse: "arrows-in-simple",
  Speech: "user-sound", Play: "play", Pause: "pause", Upload: "upload-simple", Heart: "heart", Bars: "equalizer", Chat2: "chat-circle", Key: "key",
  Gauge: "gauge", Sparkle: "sparkle", Pulse: "pulse", Swap: "arrows-left-right", Subtitle: "subtitles", Book: "book-open", VoicePlus: "user-plus",
  Film: "film-strip", ShieldCheck: "shield-check", SetGeneral: "gear-six", SetAdmin: "users-three", SetAccount: "user-circle", SetPrivacy: "lock-key",
  SetCapabilities: "toolbox", SetMemory: "brain", SetKey: "key", SetChip: "cpu", GetApps: "download-simple", Keyboard: "keyboard", SetPlug: "plugs",
  // Đích của chuyển động biến hình khi rê chuột ở thanh bên.
  NotePencil: "note-pencil", FolderOpen: "folder-open", Cube: "cube", TrayIn: "tray-arrow-down", HeadCircuit: "head-circuit", CodeBlock: "code-block",
  // Thêm cho tiện ích Chrome / chỗ khác.
  ArrowRight: "arrow-right", Browser: "browser", Browsers: "browsers", Eraser: "eraser", SignOut: "sign-out", WarningCircle: "warning-circle",
  Archive: "archive", TextIn: "text-align-left", FileText: "file-text", Flow: "flow-arrow", FileDoc: "file-doc", CheckCircle: "check-circle",
  CircleDashed: "circle-dashed", SquaresFour: "squares-four",
  // Autopilot ở thanh bên: máy bay tự bay, nhẹ hơn tên lửa (tên lửa đã là icon của đề xuất "việc cần làm").
  Autopilot: "airplane-tilt",
  // Giao diện "Instrument": lối tắt ở trang chủ, sân khấu Artifacts, tab của trang dự án.
  Slides: "presentation-chart", PenNib: "pen-nib", Article: "article", ArrowUpRight: "arrow-up-right", ChatsCircle: "chats-circle",
  ChevronL: "caret-left",
  // Chọn hàng loạt: nút vào chế độ chọn, các thao tác trên thanh hàng loạt.
  ListChecks: "list-checks", Power: "power", Restore: "arrow-counter-clockwise", FolderPlus: "folder-simple-plus",
  // Thẻ (tag) của đoạn chat; nút Sửa tham số trên thẻ duyệt công cụ.
  Tag: "tag", BracesCode: "brackets-curly",
};

// Icon chỉ dùng theo tên Phosphor (bộ công cụ Speech: ui/speech/toolicons.tsx, cặp icon biến hình khi rê chuột).
export const EXTRA = [
  "text-aa", "speaker-high", "chats-circle", "chat-circle-dots", "headset", "robot", "waveform", "text-align-left", "magic-wand", "sparkle",
  "user-sound", "users", "speaker-simple-high", "funnel-simple", "user-switch", "arrows-clockwise", "globe-hemisphere-west", "translate",
  "book-open", "headphones", "microphone-stage", "broadcast", "squares-four", "house-simple", "music-notes", "vinyl-record", "book-bookmark",
  "browser", "play-circle", "users-three",
];

const DIR = "node_modules/@phosphor-icons/core/assets/regular";
const TAGS = new Set(["path", "circle", "rect", "line", "polyline", "polygon", "ellipse"]);
const data = {};
// Các phần tử SVG của một icon Phosphor Regular (bỏ khung bao trong suốt, bỏ fill để tô bằng currentColor).
function read(ph) {
  const svg = fs.readFileSync(`${DIR}/${ph}.svg`, "utf8");
  const els = [];
  for (const m of svg.matchAll(/<(path|circle|rect|line|polyline|polygon|ellipse)\b([^>]*?)\/?>/g)) {
    if (!TAGS.has(m[1])) continue;
    const attrs = {};
    for (const a of m[2].matchAll(/([a-zA-Z-:]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    if (attrs.fill === "none" && !attrs.stroke) continue; // khung bao trong suốt
    delete attrs.fill;
    els.push([m[1], attrs]);
  }
  if (!els.length) throw new Error(`Không đọc được ${ph}`);
  return els;
}
for (const ph of [...Object.values(NAMES), ...EXTRA]) data[ph] ??= read(ph);
const out = `// Sinh bởi tools/phosphor-icons.mjs từ @phosphor-icons/core (Phosphor Regular, MIT) — đừng sửa tay.
// NAMES: tên icon trong app → tên Phosphor; PH: các phần tử SVG gốc (lưới 256, tô bằng currentColor).
export const NAMES = ${JSON.stringify(NAMES)} as const;
export type IconName = keyof typeof NAMES;
export const PH: Record<string, [string, Record<string, string>][]> = ${JSON.stringify(data)};
`;
fs.writeFileSync("ui/phosphor-data.ts", out);

// Tiện ích Chrome (cửa sổ extension/popup.js, dải điều khiển trong trang extension/overlay.js): cùng bộ icon, chỉ những icon nó dùng.
export const EXT = { arrow: "arrow-right", open: "arrow-square-out", leave: "sign-out", tab: "browser", tabs: "browsers", group: "folder-simple", alert: "warning-circle",
  globe: "globe-simple", link: "link-simple", pause: "pause", play: "play", stop: "stop", check: "check" };
const ext = Object.fromEntries(Object.entries(EXT).map(([k, ph]) => [k, data[ph] ?? read(ph)]));
fs.writeFileSync("extension/phosphor.js", `// Sinh bởi tools/phosphor-icons.mjs từ @phosphor-icons/core (Phosphor Regular, MIT) — đừng sửa tay.\n// Icon của cửa sổ tiện ích: các phần tử SVG gốc trên lưới 256 (tô bằng currentColor, viền 2 đơn vị như app).\nexport const PH = ${JSON.stringify(ext)};\n`);
console.log(`Đã ghi ${Object.keys(data).length} icon Phosphor Regular vào ui/phosphor-data.ts (${(out.length / 1024).toFixed(0)} KB)`);
