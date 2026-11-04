// Proxy ra internet cho code chạy trên máy cục bộ (giả lập, CODE_RUN=local): chỉ cho tới các kho thư viện trong PKG_DOMAINS, hoặc
// mọi trang web công khai khi bật "Mọi trang web công khai" (proxy thứ hai, cổng riêng).
// Code trong sandbox bị chặn mọi kết nối mạng trừ tới proxy này; pip/npm/curl đi qua proxy nhờ biến HTTPS_PROXY.
// Proxy tự phân giải tên miền và từ chối địa chỉ nội bộ, nên không dùng được để vào máy chủ hay mạng nội bộ.
import http from "node:http";
import net from "node:net";
import { lookup } from "node:dns/promises";
import { pkgHostAllowed } from "./catalog";
import { isPrivate } from "./safefetch";

type G = { __synchroEgress?: Promise<number>; __synchroEgressWeb?: Promise<number> };
const g = globalThis as G;

// Giữ giống DROP_HOSTS trong workspace/agent.mjs: dịch vụ nhận tệp / dữ liệu ẩn danh luôn bị chặn.
const DROP_HOSTS = ["tmpfiles.org", "file.io", "transfer.sh", "0x0.st", "catbox.moe", "gofile.io", "pixeldrain.com", "filebin.net", "termbin.com", "paste.rs", "ix.io",
  "sprunge.us", "bashupload.com", "temp.sh", "uguu.se", "tempfile.org", "webhook.site", "requestbin.net", "pipedream.net", "hookbin.com", "beeceptor.com", "oast.fun", "interact.sh"];
async function target(host: string, port: number, web: boolean) {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (DROP_HOSTS.some((d) => h === d || h.endsWith("." + d))) throw new Error(`blocked: ${h} is a file / data drop service`);
  if (!web && !pkgHostAllowed(host)) throw new Error(`blocked: ${host} is not an allowed package registry or voice service`);
  if (port !== 443 && port !== 80) throw new Error(`blocked: port ${port}`);
  const ips = (await lookup(host, { all: true })).map((x) => x.address);
  if (!ips.length || ips.some(isPrivate)) throw new Error(`blocked: ${host} resolves to a private address`);
  return ips.find((x) => net.isIP(x) === 4) ?? ips[0];
}

function start(web: boolean): Promise<number> {
  const srv = http.createServer(async (req, res) => {
    // Yêu cầu HTTP thường (apt, một số gói cũ): chuyển tiếp nếu tên miền được phép.
    try {
      const u = new URL(req.url ?? "");
      const ip = await target(u.hostname, Number(u.port || 80), web);
      const up = http.request({ host: ip, port: Number(u.port || 80), path: u.pathname + u.search, method: req.method, headers: { ...req.headers, host: u.host } }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      });
      up.on("error", () => { res.writeHead(502); res.end(); });
      req.pipe(up);
    } catch (e) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end(String((e as Error).message ?? e));
    }
  });
  srv.on("connect", async (req, sock, head) => {
    sock.on("error", () => {});
    const [host, p] = String(req.url ?? "").split(":");
    try {
      const ip = await target(host, Number(p || 443), web);
      const up = net.connect(Number(p || 443), ip, () => {
        sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head?.length) up.write(head);
        up.pipe(sock); sock.pipe(up);
      });
      up.on("error", () => sock.destroy());
      sock.on("close", () => up.destroy());
    } catch (e) {
      sock.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\n\r\n${String((e as Error).message ?? e)}`);
    }
  });
  return new Promise((ok, fail) => {
    srv.once("error", fail);
    srv.listen(0, "127.0.0.1", () => ok((srv.address() as net.AddressInfo).port));
  });
}

// Cổng của proxy (khởi động một lần cho cả tiến trình).
export function egressPort(web = false): Promise<number> {
  if (web) return (g.__synchroEgressWeb ??= start(true).catch((e) => { g.__synchroEgressWeb = undefined; throw e; }));
  return (g.__synchroEgress ??= start(false).catch((e) => { g.__synchroEgress = undefined; throw e; }));
}
