// Hình minh họa ba loại tạo mới ở trang Artifacts (Tài liệu, Trình bày, Thiết kế): bản thu nhỏ có lớp mảng màu của chính sản phẩm,
// chỉ dùng tông Carbon / Ivory của Synchro (app/synchro-ui.css: --sy-*). Rê chuột thì các phần chuyển động nhẹ (CSS .sy-tpl:hover …):
// chữ đang được viết, bình luận trượt vào, cột biểu đồ dâng lên, khung chọn kéo bảng vẽ — không vọt quá, không lặp mãi.

const W = 248, H = 132;

function Doc() {
  return (
    <>
      <rect className="s-paper" x={58} y={16} width={118} height={130} rx={8} />
      <rect className="s-ink" x={72} y={30} width={54} height={7} rx={3.5} />
      <g className="s-type">
        <rect className="s-line" x={72} y={45} width={88} height={4} rx={2} />
        <rect className="s-line" x={72} y={53} width={76} height={4} rx={2} />
        <rect className="s-line" x={72} y={61} width={82} height={4} rx={2} />
      </g>
      <rect className="s-block" x={72} y={73} width={90} height={38} rx={5} />
      <g className="s-bars">
        <rect className="s-ink o5" x={80} y={92} width={9} height={13} rx={2} />
        <rect className="s-ink o7" x={94} y={86} width={9} height={19} rx={2} />
        <rect className="s-ink" x={108} y={80} width={9} height={25} rx={2} />
        <rect className="s-ink o5" x={122} y={89} width={9} height={16} rx={2} />
      </g>
      <rect className="s-line" x={72} y={119} width={84} height={4} rx={2} />
      <rect className="s-line" x={72} y={127} width={60} height={4} rx={2} />
      <g className="s-note">
        <rect className="s-ink" x={152} y={40} width={70} height={34} rx={9} />
        <circle className="s-paperfill" cx={164} cy={52} r={5} />
        <rect className="s-paperfill o7" x={174} y={49} width={38} height={4} rx={2} />
        <rect className="s-paperfill o5" x={162} y={61} width={48} height={4} rx={2} />
      </g>
    </>
  );
}

function Slides() {
  return (
    <>
      <rect className="s-paper" x={44} y={14} width={160} height={90} rx={8} />
      <rect className="s-ink" x={58} y={28} width={62} height={8} rx={4} />
      <rect className="s-line" x={58} y={42} width={44} height={4} rx={2} />
      <g className="s-cols">
        <rect className="s-ink o5" x={130} y={70} width={11} height={22} rx={2} />
        <rect className="s-ink o7" x={146} y={60} width={11} height={32} rx={2} />
        <rect className="s-ink" x={162} y={48} width={11} height={44} rx={2} />
        <rect className="s-ink o5" x={178} y={64} width={11} height={28} rx={2} />
      </g>
      <rect className="s-line" x={58} y={58} width={54} height={4} rx={2} />
      <rect className="s-line" x={58} y={66} width={48} height={4} rx={2} />
      <rect className="s-line" x={58} y={74} width={52} height={4} rx={2} />
      {[0, 1, 2, 3].map((i) => <rect key={i} className="s-paper" x={62 + i * 32} y={112} width={26} height={16} rx={3} />)}
      <rect className="s-sel" x={62} y={112} width={26} height={16} rx={3} />
    </>
  );
}

function Design() {
  return (
    <>
      <defs>
        <pattern id="sy-tpl-dots" width={10} height={10} patternUnits="userSpaceOnUse"><circle className="s-dot" cx={1.5} cy={1.5} r={1} /></pattern>
      </defs>
      <rect x={0} y={0} width={W} height={H} fill="url(#sy-tpl-dots)" />
      <rect className="s-paper" x={40} y={14} width={62} height={108} rx={11} />
      <rect className="s-line" x={62} y={21} width={18} height={3} rx={1.5} />
      <rect className="s-block" x={49} y={32} width={44} height={30} rx={5} />
      <rect className="s-ink" x={49} y={70} width={32} height={5} rx={2.5} />
      <rect className="s-line" x={49} y={80} width={42} height={4} rx={2} />
      <rect className="s-line" x={49} y={88} width={36} height={4} rx={2} />
      <rect className="s-ink" x={49} y={104} width={44} height={10} rx={5} />
      <path className="s-link" d="M102 58 H128" />
      <g className="s-board">
        <rect className="s-paper" x={130} y={34} width={82} height={58} rx={7} />
        <rect className="s-ink" x={140} y={45} width={38} height={6} rx={3} />
        <rect className="s-line" x={140} y={57} width={60} height={4} rx={2} />
        <rect className="s-line" x={140} y={65} width={48} height={4} rx={2} />
        <rect className="s-block" x={140} y={75} width={26} height={9} rx={4.5} />
        <rect className="s-sel" x={127} y={31} width={88} height={64} rx={9} />
        {[[127, 31], [215, 31], [127, 95], [215, 95]].map(([x, y]) => <rect key={`${x}-${y}`} className="s-handle" x={x - 3} y={y - 3} width={6} height={6} rx={1} />)}
        <path className="s-cursor" d="M206 88 l0 16 l4.5 -4.2 l3.6 7.4 l3 -1.4 l-3.6 -7.3 l6.2 -.4 z" />
      </g>
    </>
  );
}

/** Ba loại tạo mới ở trang Artifacts: tài liệu, trang trình bày, thiết kế. */
export function TplArt({ k }: { k: "doc" | "slides" | "design" }) {
  return (
    <svg className={`sy-tplsvg ${k}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
      {k === "doc" ? <Doc /> : k === "slides" ? <Slides /> : <Design />}
    </svg>
  );
}
