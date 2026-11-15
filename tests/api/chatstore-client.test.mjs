// Kho đoạn chat ở trình duyệt (ui/chatstore.client.ts, blueprint B2) và chỗ giữ cho Ô soạn tin không vẽ lại lúc chữ chảy. Tự chạy được, không cần dev:mock.
// 1. Hàm đặt giá trị bỏ qua giá trị giống hệt (Object.is) nên không báo cho nơi đăng ký; setBusy giữ nguyên Set khi không đổi; reset về trạng thái đầu.
// 2. Đọc mã home.tsx: giá trị AppCtx không phụ thuộc danh sách đoạn chat, prop của Composer không có hàm / phần tử dựng mới mỗi lần vẽ.
//    Bài đo thật trên trình duyệt là tests/ui/render-perf.mjs (cần dev:mock); bài này là lưới chặn không cần máy chủ.
import fs from "node:fs";
import { loadTs } from "../lib/ts.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(typeof x === "string" ? x : JSON.stringify(x)).slice(0, 400)); };

// "client-only" chỉ báo lỗi dưới điều kiện react-server; Node thường nạp được bản rỗng.
const { "chatstore.client": M } = await loadTs(["chatstore.client"]);
const S = M.useChatStore;
let hits = 0;
const unsub = S.subscribe(() => hits++);
const fresh = (fn) => { hits = 0; fn(); return hits; };
const st = () => S.getState();

console.log("── trạng thái đầu");
ok(Array.isArray(st().chats) && !st().chats.length && !st().projects.length && st().cur === null && st().running.size === 0 && !st().queued.length, "rỗng: chats, projects, queued trống; cur null; running trống");

console.log("── bỏ qua giá trị giống hệt (Object.is)");
{
  const same = st().chats;
  ok(fresh(() => st().setChats(same)) === 0, "setChats cùng mảng: không báo");
  ok(fresh(() => st().setChats((cs) => cs)) === 0, "setChats hàm trả lại mảng cũ: không báo");
  const list = [{ id: 1, title: "A", msgs: [] }, { id: 2, title: "B", msgs: [{ role: "user", text: "x" }] }];
  ok(fresh(() => st().setChats(list)) === 1 && st().chats === list, "setChats mảng mới: báo đúng một lần, giữ đúng mảng");
  ok(fresh(() => st().setCur(1)) === 1 && st().cur === 1, "setCur(1): báo");
  ok(fresh(() => st().setCur(1)) === 0, "setCur(1) lần nữa: không báo");
  ok(fresh(() => st().setCur((p) => p)) === 0, "setCur hàm giữ nguyên: không báo");
  ok(fresh(() => st().setCur(null)) === 1 && st().cur === null, "setCur(null): báo");
  ok(fresh(() => st().setQueued(st().queued)) === 0 && fresh(() => st().setProjects(st().projects)) === 0, "setQueued / setProjects cùng giá trị: không báo");
  // Đổi một khóa không chạm khóa khác.
  const before = st().chats;
  st().setCur(2);
  ok(st().chats === before, "đổi cur không dựng lại mảng chats");
}

console.log("── setBusy");
{
  const r0 = st().running;
  ok(fresh(() => st().setBusy(7, true)) === 1 && st().running.has(7), "bật 7: báo, running có 7");
  const r1 = st().running;
  ok(r1 !== r0 && !r0.has(7), "Set mới, Set cũ không bị sửa");
  ok(fresh(() => st().setBusy(7, true)) === 0 && st().running === r1, "bật 7 lần nữa: không báo, giữ nguyên Set");
  ok(fresh(() => st().setBusy(8, false)) === 0 && st().running === r1, "tắt 8 (vốn không chạy): không báo, giữ nguyên Set");
  ok(fresh(() => st().setBusy(7, false)) === 1 && !st().running.has(7) && r1.has(7), "tắt 7: báo, Set mới, Set trước vẫn còn 7");
}

console.log("── các hành động trên đoạn chat");
{
  const b = st().chats.find((c) => c.id === 2), a = st().chats.find((c) => c.id === 1);
  st().patch(2, (ms) => [...ms, { role: "ai", text: "y" }]);
  const b2 = st().chats.find((c) => c.id === 2);
  ok(b2.msgs.length === 2 && b2 !== b && st().chats.find((c) => c.id === 1) === a, "patch: chỉ đoạn chat 2 đổi, đoạn 1 giữ nguyên tham chiếu");
  st().patchChat(1, { title: "A2" });
  ok(st().chats.find((c) => c.id === 1).title === "A2", "patchChat đổi trường");
  st().togglePin(1);
  ok(st().chats.find((c) => c.id === 1).pinned === true, "togglePin bật ghim");
  st().setChatTags(1, ["x"]);
  ok(JSON.stringify(st().chats.find((c) => c.id === 1).tags) === '["x"]', "setChatTags gán nhãn");
  st().setChatTags(1, []);
  ok(st().chats.find((c) => c.id === 1).tags === undefined, "setChatTags rỗng bỏ trường tags");
  st().removeChats([1]);
  ok(st().chats.length === 1 && st().chats[0].id === 2, "removeChats bỏ đúng đoạn chat");
}

console.log("── reset");
{
  st().setBusy(3, true); st().setQueued([{ id: 1, chat: 2, text: "t", mode: "later" }]); st().setProjects([{ id: 9, name: "P" }]); st().setCur(2);
  const runningBefore = st().running;
  ok(fresh(() => st().reset()) === 1, "reset: báo một lần");
  ok(!st().chats.length && !st().projects.length && st().cur === null && st().running.size === 0 && !st().queued.length, "reset: về trạng thái đầu");
  ok(runningBefore.has(3), "reset không sửa Set cũ (nơi còn giữ tham chiếu vẫn thấy đúng)");
  ok(typeof st().setChats === "function" && typeof st().setBusy === "function" && typeof st().reset === "function", "reset giữ các hàm hành động");
  const r = st().running;
  st().reset();
  ok(st().running !== r, "mỗi lần reset là một Set mới (không dùng chung Set giữa các lần gắn Home)");
  st().setBusy(4, true); st().reset();
  ok(st().running.size === 0, "chạy lại sau reset không mang dấu cũ");
  ok(fresh(() => st().setChats(st().chats)) === 0, "sau reset vẫn bỏ qua giá trị giống hệt");
}
unsub();
ok(typeof M.useChatState === "function" && typeof M.useChats === "function", "xuất useChatState và useChats");

console.log("── home.tsx: Ô soạn tin và AppCtx không vẽ lại theo chữ chảy");
{
  const src = fs.readFileSync("ui/home.tsx", "utf8");
  ok(/const Composer = memo\(function Composer\(/.test(src), "Composer bọc memo");
  const api = src.match(/const api = useMemo\(\(\) => \(\{[\s\S]*?\}\), \[([^\]]*)\]\)/);
  ok(api && !/\bchats\b|\bchat\b|\bbusy\b|\bcur\b/.test(api[1]), "giá trị AppCtx (api) không phụ thuộc chats / chat / busy / cur", api?.[1]);
  ok(api && !/\bchats\b/.test(api[0].replace(/\/\/.*$/gm, "")), "giá trị AppCtx không chứa danh sách đoạn chat (đọc bằng useChats())");
  ok(/<AppCtx\.Provider value=\{api\}>/.test(src), "AppCtx.Provider dùng đúng giá trị api đã memo");
  // Thân composerProps (useMemo(() => ({ … }), [deps]) từ B2 bước 7, để khối soạn tin ở đáy đoạn chat là phần tử đã memo): bỏ các lời gọi
  // useEvent(...) (cân ngoặc) và chuỗi mẫu; phần còn lại không được có hàm viết tại chỗ. Hàm qua useEvent đặt ngay trên (hook không gọi trong useMemo).
  const at = src.indexOf("const composerProps = useMemo(() => ({");
  ok(at > 0, "có composerProps (useMemo)");
  let i = at + "const composerProps = useMemo(() => (".length, depth = 0, body = "";
  for (; i < src.length; i++) { const ch = src[i]; body += ch; if (ch === "{") depth++; else if (ch === "}" && --depth === 0) break; }
  const deps = /^\), \[([^\]]*)\]\)/.exec(src.slice(i + 1))?.[1] ?? "";
  ok(deps && !/\bchats\b|\bchat\b/.test(deps), "composerProps chỉ dựng lại theo giá trị của nó (không theo danh sách đoạn chat)", deps);
  const fns = [...body.matchAll(/\b(onSend|onSteer|onStop|goCustom|goConnectors|openUpload|onVoice|onProject)\b(?:: (\w+))?/g)].map((m) => m[2] ?? m[1]);
  ok(fns.length >= 8 && fns.every((f) => new RegExp(`\\b${f} = useEvent\\(|, ${f} = useEvent\\(`).test(src)), "các hàm của composerProps đều là useEvent", fns);
  let rest = "", k = 0;
  while (k < body.length) {
    if (body.startsWith("useEvent(", k)) { let d = 0; for (; k < body.length; k++) { if (body[k] === "(") d++; else if (body[k] === ")" && --d === 0) { k++; break; } } rest += "useEvent()"; continue; }
    if (body[k] === "`") { const e = body.indexOf("`", k + 1); rest += "``"; k = e + 1; continue; }
    rest += body[k++];
  }
  ok(!/=>/.test(rest), "composerProps: mọi hàm đi qua useEvent (không có hàm viết tại chỗ)", rest.match(/[^\n]*=>[^\n]*/)?.[0]);
  const uses = [...src.matchAll(/<Composer \{\.\.\.composerProps\}([^\n]*?)\/>/g)].map((m) => m[1]);
  ok(uses.length >= 3, `các chỗ vẽ Composer dùng composerProps (${uses.length})`);
  for (const u of uses) {
    ok(!/\w+=\{\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/.test(u) && !/\w+=\{\s*</.test(u), `Composer không nhận hàm / phần tử dựng tại chỗ: ${u.trim().slice(0, 80)}`);
  }
  ok(/const dockMixer = useMemo\(/.test(src), "bàn trộn trong ô soạn (extra) là phần tử đã memo");
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
