// Ba cảnh hoạt hình của "sân khấu" Tạo mới ở trang Artifacts (Tài liệu, Trình bày, Thiết kế), chỉ dùng tông Carbon / Ivory.
// Mỗi cảnh dài 7,2 giây (bằng một lượt luân phiên của sân khấu, ui/studio.tsx) và lặp lại khi người dùng dừng ở đó:
// - Tài liệu: con trỏ Synchro viết từng dòng, biểu đồ dâng lên, một đồng nghiệp đánh dấu câu và để lại bình luận.
// - Trình bày: bộ slide tự dựng, khung chọn ở dải ảnh nhỏ chạy qua ba trang (trang bìa, biểu đồ, con số lớn).
// - Thiết kế: khung vẽ có bản điện thoại và bản máy tính nối với nhau; con trỏ Synchro kéo khung chọn phóng to ảnh, chọn màu, hiện số đo.
// Chuyển động ở app/_shell/synchro-ds.css (.st-*); người dùng chọn giảm chuyển động thì cảnh đứng yên ở trạng thái đã dựng xong.

const W = 640, H = 300;

function Cursor({ cls }: { cls: string }) {
  return (
    <g className={cls}>
      <path className="st-cur" d="M0 0 L0 17 L4.8 12.6 L8.6 20.4 L11.8 19 L8 11.2 L14.6 10.8 Z" />
      <rect className="st-tag" x={12} y={21} width={56} height={18} rx={6} />
      <text className="st-tagt" x={40} y={33.5} textAnchor="middle">Synchro</text>
    </g>
  );
}

function Doc() {
  const lines = [244, 232, 240, 212, 150];
  return (
    <>
      <rect className="st-shadow" x={156} y={34} width={300} height={300} rx={14} />
      <rect className="st-paper" x={150} y={26} width={300} height={300} rx={14} />
      <rect className="st-ink d-title" x={178} y={56} width={170} height={14} rx={7} />
      <rect className="st-faint d-meta" x={178} y={80} width={96} height={6} rx={3} />
      <rect className="st-hl d-hl" x={174} y={121} width={140} height={14} rx={4} />
      {lines.map((w, i) => <rect key={i} className={`st-line d-l d-l${i + 1}`} x={178} y={102 + i * 12} width={w} height={6} rx={3} />)}
      <rect className="st-sunk d-chart" x={178} y={176} width={244} height={98} rx={10} />
      {[34, 52, 44, 66, 58, 78].map((h, i) => <rect key={i} className={`st-ink d-bar d-bar${i + 1}${i % 2 ? " o6" : ""}`} x={196 + i * 34} y={262 - h} width={18} height={h} rx={4} />)}
      <path className="st-trend d-trend" pathLength={1} d="M205 230 L239 214 L273 222 L307 196 L341 204 L375 180" />
      <path className="st-link d-link" pathLength={1} d="M314 128 C 380 128, 420 120, 468 112" />
      <g className="d-note">
        <rect className="st-paper" x={468} y={84} width={150} height={76} rx={14} />
        <circle className="st-sunk" cx={490} cy={106} r={11} />
        <circle className="st-ink o6" cx={490} cy={103} r={4} />
        <path className="st-ink o6" d="M482.5 113 a7.5 6 0 0 1 15 0 Z" />
        <rect className="st-ink" x={508} y={99} width={64} height={6} rx={3} />
        <rect className="st-faint" x={508} y={110} width={36} height={5} rx={2.5} />
        <rect className="st-line" x={482} y={128} width={120} height={6} rx={3} />
        <rect className="st-line" x={482} y={140} width={84} height={6} rx={3} />
      </g>
      <Cursor cls="d-cur" />
    </>
  );
}

function Slides() {
  const thumbs = [146, 218, 290, 362, 434];
  return (
    <>
      <rect className="st-shadow" x={126} y={36} width={400} height={208} rx={14} />
      <rect className="st-paper" x={120} y={28} width={400} height={208} rx={14} />
      <g className="s-a">
        <rect className="st-ink" x={150} y={96} width={230} height={18} rx={9} />
        <rect className="st-ink" x={150} y={122} width={168} height={18} rx={9} />
        <rect className="st-faint" x={150} y={156} width={120} height={7} rx={3.5} />
        <circle className="st-sunk" cx={438} cy={132} r={58} />
        <g className="s-orbit"><circle className="st-ink" cx={438} cy={74} r={9} /></g>
        <circle className="st-paper2" cx={438} cy={132} r={30} />
      </g>
      <g className="s-b">
        <rect className="st-ink" x={150} y={56} width={150} height={12} rx={6} />
        <rect className="st-faint" x={150} y={76} width={96} height={6} rx={3} />
        <path className="st-axis" d="M150 208 H490" />
        {[48, 70, 58, 98, 84, 120].map((h, i) => <rect key={i} className={`st-ink s-bar s-bar${i + 1}${i === 5 ? "" : " o6"}`} x={168 + i * 52} y={206 - h} width={26} height={h} rx={5} />)}
        <g className="s-call"><rect className="st-ink" x={398} y={58} width={70} height={22} rx={11} /><text className="st-num-s" x={433} y={73.5} textAnchor="middle">+38%</text></g>
      </g>
      <g className="s-c">
        <text className="st-num" x={150} y={150}>+42%</text>
        <rect className="st-faint" x={152} y={170} width={150} height={7} rx={3.5} />
        <rect className="st-line" x={152} y={184} width={110} height={7} rx={3.5} />
        <circle className="st-ring" cx={430} cy={132} r={46} />
        <circle className="st-arc s-arc" pathLength={1} cx={430} cy={132} r={46} />
      </g>
      {thumbs.map((x, i) => (
        <g key={i}>
          <rect className="st-paper" x={x} y={252} width={60} height={34} rx={6} />
          <rect className={i % 2 ? "st-line" : "st-faint"} x={x + 8} y={262} width={i === 1 ? 26 : 34} height={4} rx={2} />
          <rect className="st-line" x={x + 8} y={270} width={22} height={4} rx={2} />
        </g>
      ))}
      <rect className="st-sel s-sel" x={146} y={252} width={60} height={34} rx={6} />
    </>
  );
}

function Design() {
  return (
    <>
      <path className="st-flow g-link" pathLength={1} d="M246 150 C 268 150, 278 144, 300 144" />
      <g className="g-phone">
        <rect className="st-shadow" x={114} y={42} width={136} height={250} rx={24} />
        <rect className="st-paper" x={110} y={34} width={136} height={250} rx={24} />
        <rect className="st-line" x={160} y={44} width={36} height={5} rx={2.5} />
        <rect className="st-sunk" x={124} y={60} width={108} height={86} rx={12} />
        <rect className="st-ink g-tone" x={124} y={160} width={80} height={10} rx={5} />
        <rect className="st-line" x={124} y={178} width={104} height={6} rx={3} />
        <rect className="st-line" x={124} y={190} width={86} height={6} rx={3} />
        <rect className="st-ink" x={124} y={252} width={108} height={20} rx={10} />
      </g>
      <g className="g-desk">
        <rect className="st-shadow" x={304} y={62} width={250} height={170} rx={12} />
        <rect className="st-paper" x={300} y={54} width={250} height={170} rx={12} />
        <circle className="st-line" cx={314} cy={67} r={3} /><circle className="st-line" cx={324} cy={67} r={3} /><circle className="st-line" cx={334} cy={67} r={3} />
        <path className="st-axis" d="M300 78 H550" />
        <rect className="st-ink g-tone" x={316} y={94} width={92} height={11} rx={5.5} />
        <rect className="st-ink g-tone o6" x={316} y={111} width={64} height={11} rx={5.5} />
        <rect className="st-line" x={316} y={132} width={86} height={6} rx={3} />
        <rect className="st-ink" x={316} y={150} width={52} height={16} rx={8} />
        <rect className="st-sunk g-img" x={428} y={92} width={104} height={74} rx={10} />
        {[316, 392, 468].map((x) => <rect key={x} className="st-sunk" x={x} y={182} width={66} height={30} rx={7} />)}
      </g>
      <g className="g-selw">
        <rect className="st-sel g-sel" x={425} y={89} width={110} height={80} rx={11} />
        <rect className="st-handle" x={421.5} y={85.5} width={7} height={7} rx={1.5} />
        <rect className="st-handle g-h2" x={531.5} y={85.5} width={7} height={7} rx={1.5} />
        <rect className="st-handle g-h3" x={421.5} y={165.5} width={7} height={7} rx={1.5} />
        <rect className="st-handle g-h4" x={531.5} y={165.5} width={7} height={7} rx={1.5} />
      </g>
      <g className="g-guide">
        <path className="st-red" d="M246 112 H300" />
        <path className="st-red" d="M246 107 V117 M300 107 V117" />
        <rect className="st-ink" x={259} y={92} width={28} height={15} rx={7.5} />
        <text className="st-num-s" x={273} y={102.8} textAnchor="middle">54</text>
      </g>
      <g className="g-sw">
        <rect className="st-paper" x={412} y={244} width={148} height={38} rx={19} />
        <circle className="sw sw1" cx={434} cy={263} r={9} /><circle className="sw sw2" cx={460} cy={263} r={9} />
        <circle className="sw sw3" cx={486} cy={263} r={9} /><circle className="sw sw4" cx={512} cy={263} r={9} />
        <circle className="st-swring" cx={460} cy={263} r={13} />
        <rect className="st-line" x={530} y={259} width={18} height={8} rx={4} />
      </g>
      <Cursor cls="g-cur" />
    </>
  );
}

/** Một cảnh của sân khấu Tạo mới. */
export function StudioScene({ k }: { k: "doc" | "slides" | "design" }) {
  return (
    <svg className={`st-scene st-${k}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
      {k === "doc" ? <Doc /> : k === "slides" ? <Slides /> : <Design />}
    </svg>
  );
}
