// Icon của Synchro: Phosphor Regular (MIT) — outline, lưới 256, vẽ bằng currentColor, viền thêm 2 đơn vị (STROKE) để nét dày bằng bộ icon
// cũ (~1,27px ở cỡ 18). Dữ liệu sinh từ @phosphor-icons/core bằng
// scripts/phosphor-icons.mjs (app/phosphor-data.ts); tên trong app giữ như cũ (I.Search, I.Plus…) nên mọi chỗ dùng không đổi.
// Chuyển động: icon đổi theo trạng thái dùng <I.M icon="…"> (biến hình bằng morphicons, app/morph.tsx); icon ở thanh bên biến hình khi rê
// chuột bằng <I.Hover icon={["…", "…"]}>.
import React from "react";
import { NAMES, type IconName } from "./phosphor-data";
import { HoverMorph, Morph } from "./morph";
import { PhIcon } from "./phicon";

type P = { size?: number };

/** Icon tĩnh theo tên trong app. */
export function Icon({ name, size = 18 }: P & { name: IconName }) {
  return <PhIcon ph={NAMES[name]} size={size} />;
}
const mk = (name: IconName) => {
  const C = (p: P) => <Icon name={name} {...p} />;
  C.displayName = name;
  return C;
};
// Mọi icon theo tên trong NAMES (tạo một lần; xuất ra bên dưới bằng tên như cũ).
const A = Object.fromEntries((Object.keys(NAMES) as IconName[]).map((k) => [k, mk(k)])) as unknown as Record<IconName, (p: P) => React.JSX.Element>;

/** Icon biến hình khi đổi tên (vd. <I.M icon={copied ? "Check" : "Copy"} />): hai nhánh của phép chọn cùng là I.M nên React cập nhật
 *  thay vì dựng lại, morphicons biến icon cũ thành icon mới. */
export const M = ({ icon, size = 18 }: P & { icon: IconName }) => <Morph name={NAMES[icon]} size={size} />;
/** Icon biến hình khi rê chuột vào mục chứa nó (.nav-item, nút…): icon={[lúc thường, khi rê chuột]}. */
export const Hover = ({ icon, size = 18 }: P & { icon: [IconName, IconName] }) => <HoverMorph a={NAMES[icon[0]]} b={NAMES[icon[1]]} size={size} />;

export const Plus = A.Plus;
export const Minus = A.Minus;
export const Merge = A.Merge;
export const Calendar = A.Calendar;
export const Panel = A.Panel;
export const Layers = A.Layers;
export const Shapes = A.Shapes;
export const Scroll = A.Scroll;
export const Connectors = A.Connectors;
export const Plugins = A.Plugins;
export const Code = A.Code;
export const Brief = A.Brief;
export const Pencil = A.Pencil;
export const Grad = A.Grad;
export const Coffee = A.Coffee;
export const Bulb = A.Bulb;
export const Mic = A.Mic;
export const Wave = A.Wave;
export const Chevron = A.Chevron;
export const ChevronR = A.ChevronR;
export const Check = A.Check;
export const X = A.X;
export const Search = A.Search;
export const Sliders = A.Sliders;
export const Grid = A.Grid;
export const Connect = A.Connect;
export const Ghost = A.Ghost;
export const Clip = A.Clip;
export const Camera = A.Camera;
export const Globe = A.Globe;
export const History = A.History;
export const Palette = A.Palette;
export const Plug = A.Plug;
export const Gear = A.Gear;
export const User = A.User;
export const Shield = A.Shield;
export const Lock = A.Lock;
export const Admin = A.Admin;
export const Card = A.Card;
export const Bell = A.Bell;
export const Moon = A.Moon;
export const Sun = A.Sun;
export const Monitor = A.Monitor;
export const Copy = A.Copy;
export const Speaker = A.Speaker;
export const ThumbUp = A.ThumbUp;
export const ThumbDown = A.ThumbDown;
export const Retry = A.Retry;
export const Stop = A.Stop;
export const Arrow = A.Arrow;
export const Sort = A.Sort;
export const List = A.List;
export const Brain = A.Brain;
export const Clock = A.Clock;
export const Pin = A.Pin;
export const PinOff = A.PinOff;
export const Folder = A.Folder;
export const Trash = A.Trash;
export const Help = A.Help;
export const Out = A.Out;
export const Cog = A.Cog;
export const UpCircle = A.UpCircle;
export const AppsPlus = A.AppsPlus;
export const InfoCircle = A.InfoCircle;
export const Alert = A.Alert;
export const Enter = A.Enter;
export const Image = A.Image;
export const Eye = A.Eye;
export const Download = A.Download;
export const Terminal = A.Terminal;
const PR = A.PanelR;
export const PanelR = (p: P) => <span className="ph-flip"><PR {...p} /></span>;
export const Dots = A.Dots;
export const Branch = A.Branch;
export const External = A.External;
export const Back = A.Back;
export const File = A.File;
export const GitHub = A.GitHub;
export const Inbox = A.Inbox;
export const Pointer = A.Pointer;
export const Compare = A.Compare;
export const Rocket = A.Rocket;
export const Users = A.Users;
export const FileUp = A.FileUp;
export const Sparkles = A.Sparkles;
export const Library = A.Library;
export const Expand = A.Expand;
export const Collapse = A.Collapse;
export const Speech = A.Speech;
export const Play = A.Play;
export const Pause = A.Pause;
export const Upload = A.Upload;
export const Heart = A.Heart;
export const Bars = A.Bars;
export const Chat2 = A.Chat2;
export const Key = A.Key;
export const Gauge = A.Gauge;
export const Sparkle = A.Sparkle;
export const Pulse = A.Pulse;
export const Swap = A.Swap;
export const Subtitle = A.Subtitle;
export const Book = A.Book;
export const VoicePlus = A.VoicePlus;
export const Film = A.Film;
export const ShieldCheck = A.ShieldCheck;
export const SetGeneral = A.SetGeneral;
export const SetAdmin = A.SetAdmin;
export const SetAccount = A.SetAccount;
export const SetPrivacy = A.SetPrivacy;
export const SetCapabilities = A.SetCapabilities;
export const SetMemory = A.SetMemory;
export const SetKey = A.SetKey;
export const SetChip = A.SetChip;
export const GetApps = A.GetApps;
export const Keyboard = A.Keyboard;
export const SetPlug = A.SetPlug;
export const Archive = A.Archive;
export const TextIn = A.TextIn;
export const FileText = A.FileText;
export const Flow = A.Flow;
export const FileDoc = A.FileDoc;
export const CheckCircle = A.CheckCircle;
export const CircleDashed = A.CircleDashed;
export const AppWindow = A.Browser;
export const SquaresFour = A.SquaresFour;
