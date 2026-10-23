// Thao tác file trong workspace, gọi bằng: node /opt/synchro/fsop.js <op> <path> [arg]
// Chạy trong thư mục của phiên (cwd). In ra một dòng JSON; nội dung ghi file đọc từ stdin.
const fs = require("fs");
const path = require("path");

const [op, rel = ".", arg] = process.argv.slice(2);
const SKIP = new Set([".git", "node_modules", ".next", "dist", "build", ".venv", "venv", "__pycache__", ".cache", ".turbo"]);
const out = (o) => process.stdout.write(JSON.stringify(o));
const fail = (m) => { out({ error: m }); process.exit(0); };

const root = process.cwd();
const p = path.resolve(root, rel);
if (p !== root && !p.startsWith(root + path.sep)) fail("Đường dẫn nằm ngoài thư mục làm việc");
const relOf = (x) => path.relative(root, x).split(path.sep).join("/");

function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

try {
  if (op === "list") {
    const ents = fs.readdirSync(p, { withFileTypes: true })
      .filter((e) => e.name !== ".git")
      .map((e) => {
        const full = path.join(p, e.name);
        let size = 0;
        try { size = e.isFile() ? fs.statSync(full).size : 0; } catch {}
        return { name: e.name, path: relOf(full), dir: e.isDirectory(), size };
      })
      .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    out({ entries: ents });
  } else if (op === "tree") {
    // Danh sách file (bỏ thư mục nặng), tối đa `arg` mục.
    const max = Number(arg) || 2000;
    const files = [];
    const walk = (d) => {
      if (files.length >= max) return;
      let ents = [];
      try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (files.length >= max) return;
        const full = path.join(d, e.name);
        if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(full); }
        else files.push(relOf(full));
      }
    };
    walk(p);
    out({ files: files.sort(), truncated: files.length >= max });
  } else if (op === "read") {
    const st = fs.statSync(p);
    if (st.isDirectory()) fail("Đây là thư mục");
    const max = Number(arg) || 1_000_000;
    const fd = fs.openSync(p, "r");
    const buf = Buffer.alloc(Math.min(st.size, max));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    if (isBinary(buf)) out({ binary: true, size: st.size });
    else out({ content: buf.toString("utf8"), size: st.size, truncated: st.size > max });
  } else if (op === "write") {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => {
      const data = Buffer.concat(chunks);
      let before = null;
      try { before = fs.readFileSync(p, "utf8"); } catch {}
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, data);
      out({ ok: true, size: data.length, created: before === null, before: arg === "prev" ? before : undefined });
    });
  } else if (op === "mkdir") {
    fs.mkdirSync(p, { recursive: true });
    out({ ok: true });
  } else if (op === "rm") {
    if (p === root) fail("Không thể xóa thư mục gốc");
    fs.rmSync(p, { recursive: true, force: true });
    out({ ok: true });
  } else if (op === "mv") {
    const to = path.resolve(root, arg || "");
    if (!to.startsWith(root + path.sep)) fail("Đích nằm ngoài thư mục làm việc");
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(p, to);
    out({ ok: true });
  } else fail("Thao tác không hợp lệ");
} catch (e) {
  fail(e.code === "ENOENT" ? "Không tìm thấy file" : String(e.message || e));
}
