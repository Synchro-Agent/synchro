// H2.5 (ESLint chặn deploy), sau review:
// 1. eslint-config-next ghim đúng phiên bản của next (không ^/~): luật ESLint đi theo đúng bản Next đang chạy; package-lock cùng ý.
// 2. Bước ESLint của deploy.yml: khi lint đỏ, lỗi (error) phải hiện trong ci.txt dù lint.log dài hơn 150 dòng cảnh báo. Chạy thật hai khối
//    lệnh "ESLint" và "Gói kết quả kiểm tra" bằng bash (-e như mặc định của GitHub, và -eo pipefail) với npm giả.
// 3. tools/i18n-audit.mjs giải mã thực thể JSX (&quot; &apos; &amp;) như React và tests/lib/i18n-scan.mjs: chữ viết &quot;…&quot; để qua
//    react/no-unescaped-entities không bị báo thiếu bản dịch nhầm. Không cần máy chủ.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { decodeJsxEntities } from "../lib/i18n-scan.mjs";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✓" : "  ✗", n, c ? "" : String(x).slice(0, 1500)); };
const R = createRequire(path.join(process.cwd(), "package.json"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synchro-lint-ci-"));

try {
  console.log("1. eslint-config-next ghim đúng phiên bản next");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
  const next = pkg.dependencies?.next, cfg = pkg.devDependencies?.["eslint-config-next"];
  ok(/^\d+\.\d+\.\d+$/.test(next ?? ""), "next ghim một phiên bản cụ thể", next);
  ok(cfg === next, "package.json: eslint-config-next = next (không ^ / ~)", `${cfg} ≠ ${next}`);
  ok(lock.packages?.[""]?.devDependencies?.["eslint-config-next"] === next, "package-lock (gốc): eslint-config-next = next", lock.packages?.[""]?.devDependencies?.["eslint-config-next"]);
  for (const m of ["eslint-config-next", "@next/eslint-plugin-next", "next"]) {
    ok(lock.packages?.[`node_modules/${m}`]?.version === next, `package-lock: ${m} giải ra ${next}`, lock.packages?.[`node_modules/${m}`]?.version);
  }

  console.log("2. Lỗi ESLint hiện trong ci.txt");
  const yaml = R("js-yaml");
  const wf = yaml.load(fs.readFileSync(".github/workflows/deploy.yml", "utf8"));
  const steps = wf.jobs.verify.steps;
  const lintStep = steps.find((s) => s.name === "ESLint"), packStep = steps.find((s) => s.name === "Gói kết quả kiểm tra");
  ok(lintStep && !lintStep["continue-on-error"] && !lintStep.shell, "bước ESLint có, chặn deploy, dùng shell mặc định", JSON.stringify(lintStep));
  ok(packStep?.if === "always()", "bước Gói kết quả kiểm tra luôn chạy", JSON.stringify(packStep));
  const packRun = String(packStep?.run ?? "").replace(/\$\{\{\s*github\.sha\s*\}\}/g, "abc123").replace(/\$\{\{\s*job\.status\s*\}\}/g, "failure");
  ok(!/\$\{\{/.test(packRun), "khối ci.txt không còn biểu thức GitHub chưa thay", packRun);

  // npm giả: "npm run lint" in một lỗi ở tệp đầu danh sách rồi 1.300 dòng cảnh báo (như repo thật: 567 cảnh báo); "-- --quiet" chỉ in lỗi.
  const bin = path.join(tmp, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "npm"), `#!/usr/bin/env bash
echo "$*" >> "$LINT_CALLS"
if [ "$LINT_MODE" = pass ]; then
  for i in $(seq 1 1300); do echo "  $i:1  warning  Expected an assignment or function call  no-unused-expressions"; done
  echo "✖ 1300 problems (0 errors, 1300 warnings)"; exit 0
fi
if [[ " $* " == *" --quiet "* ]]; then
  printf '\\n/repo/app/zz-first.tsx\\n  2:7  error  ZZ_LINT_ERROR prefer-const\\n\\n✖ 1 problem (1 error, 0 warnings)\\n'; exit 1
fi
printf '\\n/repo/app/zz-first.tsx\\n  2:7  error  ZZ_LINT_ERROR prefer-const\\n'
for i in $(seq 1 1300); do echo "  $i:1  warning  Expected an assignment or function call  no-unused-expressions"; done
echo "✖ 1301 problems (1 error, 1300 warnings)"; exit 1
`, { mode: 0o755 });
  fs.writeFileSync(path.join(tmp, "lint.sh"), String(lintStep?.run ?? ""));
  fs.writeFileSync(path.join(tmp, "pack.sh"), packRun);

  const run = (shellArgs, mode) => {
    const dir = fs.mkdtempSync(path.join(tmp, `${mode}-`));
    // Như trên CI: bước npm audit và tsc chạy trước ESLint nên audit.log / tsc.log luôn có (vòng ci.txt kết thúc bằng [ -f audit.log ]).
    fs.writeFileSync(path.join(dir, "audit.log"), "found 0 vulnerabilities\n");
    fs.writeFileSync(path.join(dir, "tsc.log"), "");
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, LINT_MODE: mode, LINT_CALLS: path.join(dir, "calls.txt") };
    const lint = spawnSync("bash", [...shellArgs, path.join(tmp, "lint.sh")], { cwd: dir, env, encoding: "utf8" });
    const pack = spawnSync("bash", ["-e", path.join(tmp, "pack.sh")], { cwd: dir, env, encoding: "utf8" });
    const read = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), "utf8") : null);
    return { lint, pack, ci: read("ci.txt") ?? "", calls: (read("calls.txt") ?? "").trim().split("\n"), errLog: read("lint-errors.log"), lintLog: read("lint.log") ?? "" };
  };

  for (const sh of [["-e"], ["--noprofile", "--norc", "-eo", "pipefail"]]) {
    const tag = `bash ${sh.join(" ")}`;
    const f = run(sh, "fail");
    ok(f.lint.status === 1, `${tag}: lint lỗi → bước ESLint đỏ (thoát 1)`, `${f.lint.status} ${f.lint.stderr}`);
    // Bài kiểm có nghĩa: 150 dòng cuối của lint.log (cách cũ) không chứa lỗi.
    ok(/ZZ_LINT_ERROR/.test(f.lintLog) && !/ZZ_LINT_ERROR/.test(f.lintLog.split("\n").slice(-151).join("\n")), `${tag}: lỗi nằm ngoài 150 dòng cuối của lint.log`);
    ok(f.calls.length === 2 && /--quiet/.test(f.calls[1] ?? ""), `${tag}: chạy lại với --quiet khi đỏ`, f.calls.join(" | "));
    ok(/ZZ_LINT_ERROR/.test(f.errLog ?? "") && !/\swarning\s/.test(f.errLog ?? ""), `${tag}: lint-errors.log chỉ chứa lỗi`, f.errLog);
    ok(f.pack.status === 0 && /━━ lint-errors\.log[\s\S]*app\/zz-first\.tsx[\s\S]*ZZ_LINT_ERROR[\s\S]*━━ lint\.log/.test(f.ci),
      `${tag}: ci.txt có tên tệp và dòng lỗi, trước lint.log`, `${f.pack.status} ${f.pack.stderr}\n${f.ci.slice(0, 600)}`);
    const p = run(sh, "pass");
    ok(p.lint.status === 0, `${tag}: chỉ có cảnh báo → bước ESLint xanh`, `${p.lint.status} ${p.lint.stderr}`);
    ok(p.calls.length === 1 && p.errLog === null && !/lint-errors\.log/.test(p.ci) && /━━ lint\.log/.test(p.ci), `${tag}: không chạy lại, không có lint-errors.log`, p.calls.join(" | "));
  }

  console.log("3. tools/i18n-audit.mjs giải mã thực thể JSX");
  ok(decodeJsxEntities('quyền &quot;luôn cho phép&quot;') === 'quyền "luôn cho phép"', "&quot; → \"");
  ok(decodeJsxEntities("can&apos;t &#39;x&#39; a&nbsp;b &lt;c&gt;") === "can't 'x' a b <c>", "&apos; &#39; &nbsp; &lt; &gt;");
  ok(decodeJsxEntities("Tên tệp &amp; diff") === "Tên tệp & diff" && decodeJsxEntities("&amp;quot;") === "&quot;", "&amp; giải mã sau cùng (không giải mã hai lần)");
  const fx = path.join(tmp, "fx");
  fs.mkdirSync(fx);
  fs.writeFileSync(path.join(fx, "Probe.tsx"), `export function Probe({ n }: { n: number }) {
  return <div>
    <button>Bỏ {n} quyền &quot;luôn cho phép&quot;</button>
    <h4>Tên tệp &amp; diff</h4>
    <span title="Tên tệp &amp; diff">x</span>
    <p>Chữ thử zzq &quot;chưa dịch&quot; nhé</p>
  </div>;
}
`);
  const out = path.join(tmp, "audit.json");
  const a = spawnSync(process.execPath, ["tools/i18n-audit.mjs", "--files", fx, "--json", out], { encoding: "utf8" });
  const res = a.status === 0 && fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : { vi: [], en: [] };
  const vi = res.vi.map((x) => x.t);
  ok(a.status === 0, "i18n-audit chạy được", a.stderr);
  ok(!vi.some((t) => /&(quot|amp|apos);/.test(t)), "không báo chữ còn nguyên thực thể", JSON.stringify(vi));
  ok(!vi.includes('quyền "luôn cho phép"') && !vi.includes("Tên tệp & diff"), "chữ đã có trong từ điển (sau giải mã) không bị báo thiếu", JSON.stringify(vi));
  ok(vi.includes('Chữ thử zzq "chưa dịch" nhé'), "chữ thật sự thiếu vẫn bị báo, ở dạng đã giải mã", JSON.stringify(vi));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
