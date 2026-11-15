// Mẫu poster / ảnh chia sẻ 1200×630 của chủ dự án (mục 6.2 "master-poster-template.tsx"), giữ nguyên từng dòng: chỉ dùng flex, radial-gradient,
// letterSpacing theo em, textTransform — đúng phần CSS Satori hỗ trợ. Model chỉ điền 5 trường (generate_image với template "poster-master-og"), không viết JSX.
// Thêm duy nhất lớp lưới nền mà mô tả poster của chủ dự án nhắc tới ("lưới nền"), giống bản HTML (.sx-tpl-poster-grid của designtemplates.ts): đường kẻ màu chữ
// (#F8FAFC) 7%, ô 56px, mờ dần ra mép theo quầng ellipse nên không nằm dưới chữ đậm đặc; lớp tuyệt đối, không đổi bố cục của mẫu.
import "server-only";
export function MasterPosterTemplate({ tag, title, metricValue, metricLabel, author }: {
  tag: string;
  title: string;
  metricValue: string;
  metricLabel: string;
  author: string;
}) {
  return (
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: "#08090E",
        backgroundImage: "radial-gradient(circle at 85% 15%, rgba(99, 102, 241, 0.35), transparent 45%), radial-gradient(circle at 15% 85%, rgba(16, 185, 129, 0.2), transparent 50%)",
        padding: "64px",
        color: "#F8FAFC",
        fontFamily: "Plus Jakarta Sans",
        position: "relative"
      }}
    >
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        display: "flex",
        backgroundImage: "linear-gradient(rgba(248, 250, 252, 0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(248, 250, 252, 0.07) 1px, transparent 1px)",
        backgroundSize: "56px 56px",
        maskImage: "radial-gradient(ellipse at 60% 35%, #000 20%, transparent 72%)"
      }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{
          padding: "8px 18px",
          backgroundColor: "rgba(99, 102, 241, 0.15)",
          border: "1px solid rgba(99, 102, 241, 0.4)",
          borderRadius: "9999px",
          color: "#818CF8",
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase"
        }}>
          {tag}
        </div>
        <div style={{ fontSize: 20, color: "#94A3B8" }}>{author}</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "40px" }}>
        <div style={{ fontSize: 60, fontWeight: 800, lineHeight: 1.12, letterSpacing: "-0.03em", maxWidth: "700px" }}>
          {title}
        </div>
        <div style={{
          display: "flex",
          flexDirection: "column",
          padding: "28px 36px",
          backgroundColor: "rgba(255, 255, 255, 0.04)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: "24px"
        }}>
          <span style={{ fontSize: 56, fontWeight: 800, color: "#34D399", letterSpacing: "-0.04em" }}>
            {metricValue}
          </span>
          <span style={{ fontSize: 18, color: "#94A3B8", marginTop: "4px" }}>
            {metricLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
