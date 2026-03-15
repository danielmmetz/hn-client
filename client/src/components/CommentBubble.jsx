export function CommentBubble({ count, scale = 1, variant = 'orange' }) {
  const n = count ?? 0;
  const label =
    n >= 10000 ? `${Math.round(n / 1000)}k`
    : n >= 1000 ? `${(n / 1000).toFixed(1)}k`
    : String(n);

  // Minimum width to fit 4 digits; use wider if needed
  const minW = 38;
  const W = minW;
  const tailH = 5;
  const BH = 22;          // body height (total height minus tail)
  const totalH = BH + tailH;
  const rx = Math.min(BH / 2, W / 2); // pill radius
  const tailW = 7;

  // For outline variant, shift tail to start at rx to avoid overlapping the arc
  const tailLeft = variant === 'grey' ? rx : 6;
  const tailRight = tailLeft + tailW;

  // Pill body with triangular tail
  const d = [
    `M${rx},0`,
    `H${W - rx}`,
    `A${rx},${rx} 0 0 1 ${W},${rx}`,
    `V${BH - rx}`,
    `A${rx},${rx} 0 0 1 ${W - rx},${BH}`,
    `H${tailRight}`,
    `L${tailLeft},${totalH}`,
    `L${tailLeft},${BH}`,
    `H${rx}`,
    `A${rx},${rx} 0 0 1 0,${BH - rx}`,
    `V${rx}`,
    `A${rx},${rx} 0 0 1 ${rx},0`,
    'Z',
  ].join(' ');

  return (
    <svg
      viewBox={`0 0 ${W} ${totalH}`}
      width={W * scale}
      height={totalH * scale}
      aria-hidden="true"
      style="overflow: visible"
    >
      <path d={d}
        fill={variant === 'grey' ? 'none' : 'rgba(255, 102, 0, 0.1)'}
        stroke={variant === 'grey' ? 'currentColor' : 'none'}
        stroke-width={variant === 'grey' ? '1.5' : '0'}
      />
      <text
        x={W / 2}
        y={BH / 2}
        dy="0.35em"
        text-anchor="middle"
        fill={variant === 'grey' ? 'currentColor' : '#ff6600'}
        font-size="12"
        font-weight="700"
      >
        {label}
      </text>
    </svg>
  );
}
