import { route } from "../../../server/route";
// Cào tài liệu từ URL thành markdown: Firecrawl nếu có FIRECRAWL_API_KEY, không thì Jina Reader (miễn phí).
// Giới hạn theo tài khoản: mỗi lần là một lời gọi dịch vụ ngoài (có thể tốn hạn mức / tiền).
export const POST = route({ feature: "web", json: true, limit: { key: "scrape", max: 120, windowMs: 3_600_000 } }, async ({ req }) => {
  const { url } = await req.json();
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) return Response.json({ error: "URL không hợp lệ" }, { status: 400 });
  try {
    const fc = process.env.FIRECRAWL_API_KEY;
    if (fc) {
      const r = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: { Authorization: `Bearer ${fc}`, "content-type": "application/json" },
        body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
      });
      if (r.ok) { const j = await r.json(); const t = j.data?.markdown; if (t) return Response.json({ text: String(t).slice(0, 40000), via: "firecrawl" }); }
    }
    const jk = process.env.JINA_API_KEY;
    const r = await fetch("https://r.jina.ai/" + url, { headers: { Accept: "text/plain", ...(jk ? { Authorization: `Bearer ${jk}` } : {}) } });
    if (!r.ok) return Response.json({ error: "Jina " + r.status }, { status: 502 });
    return Response.json({ text: (await r.text()).slice(0, 40000), via: "jina" });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 });
  }
});
