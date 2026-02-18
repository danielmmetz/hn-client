export function CommentBubble({ count }) {
  const n = count ?? 0;
  const label =
    n >= 10000 ? `${Math.round(n / 1000)}k`
    : n >= 1000 ? `${(n / 1000).toFixed(1)}k`
    : String(n);

  // Bubble body dimensions
  const W = 34;   // width
  const BH = 22;  // body height
  const rx = 5;   // corner radius
  const tailH = 6;
  const tx1 = 7;  // tail left base x
  const tx2 = 13; // tail right base x
  const tip = 2;  // tail tip x

  const totalH = BH + tailH;

  // Rounded rect with bottom-left tail
  const d = [
    `M${rx},0`,
    `H${W - rx}`,
    `Q${W},0 ${W},${rx}`,
    `V${BH - rx}`,
    `Q${W},${BH} ${W - rx},${BH}`,
    `H${tx2}`,
    `L${tip},${totalH}`,
    `L${tx1},${BH}`,
    `H${rx}`,
    `Q0,${BH} 0,${BH - rx}`,
    `V${rx}`,
    `Q0,0 ${rx},0`,
    'Z',
  ].join(' ');

  return (
    <svg
      viewBox={`0 0 ${W} ${totalH}`}
      width={W}
      height={totalH}
      aria-hidden="true"
      style="overflow: visible"
    >
      <path d={d} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
      <text
        x={W / 2}
        y={BH / 2}
        dy="0.35em"
        text-anchor="middle"
        fill="currentColor"
        font-size="10"
        font-weight="700"
      >
        {label}
      </text>
    </svg>
  );
}
