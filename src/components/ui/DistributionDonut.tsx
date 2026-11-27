export interface DonutSlice {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly color: string;
}

interface DistributionDonutProps {
  readonly slices: readonly DonutSlice[];
  readonly total: number;
  readonly centerLabel?: string;
  readonly title?: string;
  readonly emptyLabel?: string;
  readonly formatValue?: (value: number) => string;
}

const INNER_RATIO = 0.65;
const GAP_PX = 3.5;

interface Arc {
  readonly key: string;
  readonly d: string;
  readonly color: string;
}

function buildArcs(
  slices: readonly DonutSlice[],
  sum: number,
  cx: number,
  cy: number,
  outer: number,
  gapPx: number,
): {arcs: Arc[]; mids: Array<{key: string; mid: number; color: string; value: number; label: string}>} {
  const inner = outer * INNER_RATIO;
  const gap = gapPx / outer;
  const polar = (radius: number, angle: number) => ({
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  });

  const arcs: Arc[] = [];
  const mids: Array<{key: string; mid: number; color: string; value: number; label: string}> = [];
  let cursor = -Math.PI / 2;

  slices.forEach((slice) => {
    if (slice.value <= 0 || sum <= 0) return;
    const sweep = (slice.value / sum) * Math.PI * 2;
    const start = cursor;
    const end = cursor + sweep;
    cursor = end;

    const a0 = start + gap / 2;
    const a1 = Math.max(a0 + 0.004, end - gap / 2);
    const os = polar(outer, a0);
    const oe = polar(outer, a1);
    const is = polar(inner, a0);
    const ie = polar(inner, a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;

    arcs.push({
      key: slice.key,
      color: slice.color,
      d: [
        `M ${is.x.toFixed(2)} ${is.y.toFixed(2)}`,
        `L ${os.x.toFixed(2)} ${os.y.toFixed(2)}`,
        `A ${outer} ${outer} 0 ${large} 1 ${oe.x.toFixed(2)} ${oe.y.toFixed(2)}`,
        `L ${ie.x.toFixed(2)} ${ie.y.toFixed(2)}`,
        `A ${inner} ${inner} 0 ${large} 0 ${is.x.toFixed(2)} ${is.y.toFixed(2)}`,
        'Z',
      ].join(' '),
    });
    mids.push({key: slice.key, mid: (start + end) / 2, color: slice.color, value: slice.value, label: slice.label});
  });

  return {arcs, mids};
}

export function DistributionDonut({
  slices,
  total,
  centerLabel = 'الإجمالي',
  title,
  emptyLabel = 'لا توجد بيانات للعرض',
  formatValue = (value) => value.toLocaleString('ar-EG'),
}: DistributionDonutProps) {
  const sum = slices.reduce((acc, slice) => acc + Math.max(0, slice.value), 0);
  const pct = (value: number) => (sum > 0 ? Math.round((value / sum) * 100) : 0);

  const big = {cx: 380, cy: 168, outer: 118};
  const {arcs, mids} = buildArcs(slices, sum, big.cx, big.cy, big.outer, GAP_PX);

  const small = {cx: 110, cy: 110, outer: 96};
  const compact = buildArcs(slices, sum, small.cx, small.cy, small.outer, GAP_PX);

  const ringWidth = big.outer - big.outer * INNER_RATIO;
  const compactRingWidth = small.outer - small.outer * INNER_RATIO;

  return (
    <div className="w-full">
      {title ? <p className="text-center text-xs font-semibold tracking-wide text-slate-500">{title}</p> : null}

      {/* Wide layout: hollow ring, leader lines and pill labels outside the ring. */}
      <div className="hidden sm:block">
        <svg
          viewBox="0 0 760 340"
          role="img"
          aria-label={`${centerLabel}: ${formatValue(total)}`}
          className="mx-auto h-auto w-full max-w-[680px] overflow-visible"
        >
          {sum <= 0 ? (
            <circle
              cx={big.cx}
              cy={big.cy}
              r={big.outer - ringWidth / 2}
              fill="none"
              stroke="#e8ebf0"
              strokeWidth={ringWidth}
            />
          ) : (
            arcs.map((arc) => <path key={arc.key} d={arc.d} fill={arc.color} shapeRendering="geometricPrecision" />)
          )}

          <text x={big.cx} y={big.cy - 2} textAnchor="middle" fontSize="40" fontWeight="800" fill="#0f172a">
            {formatValue(total)}
          </text>
          <text x={big.cx} y={big.cy + 24} textAnchor="middle" fontSize="13" fontWeight="600" fill="#64748b">
            {centerLabel}
          </text>

          {mids.map((slice) => {
            const dir = Math.cos(slice.mid) >= 0 ? 1 : -1;
            const p0 = {x: big.cx + (big.outer + 6) * Math.cos(slice.mid), y: big.cy + (big.outer + 6) * Math.sin(slice.mid)};
            const p1 = {x: big.cx + (big.outer + 26) * Math.cos(slice.mid), y: big.cy + (big.outer + 26) * Math.sin(slice.mid)};
            const p2 = {x: p1.x + dir * 26, y: p1.y};
            const text = `${formatValue(slice.value)} · ${pct(slice.value)}%`;
            const width = Math.min(150, Math.max(64, text.length * 7.4 + 20));
            const rectX = dir > 0 ? p2.x : p2.x - width;
            return (
              <g key={slice.key}>
                <polyline
                  points={`${p0.x},${p0.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`}
                  fill="none"
                  stroke="#cbd5e1"
                  strokeWidth="1"
                />
                <rect x={rectX} y={p2.y - 13} width={width} height={26} rx={13} fill={slice.color} />
                <text
                  x={rectX + width / 2}
                  y={p2.y + 4}
                  textAnchor="middle"
                  fontSize="11.5"
                  fontWeight="700"
                  fill="#ffffff"
                >
                  {text}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Compact layout for narrow screens: ring only, details in the legend. */}
      <div className="sm:hidden">
        <svg viewBox="0 0 220 220" role="img" aria-label={`${centerLabel}: ${formatValue(total)}`} className="mx-auto h-auto w-48">
          {sum <= 0 ? (
            <circle
              cx={small.cx}
              cy={small.cy}
              r={small.outer - compactRingWidth / 2}
              fill="none"
              stroke="#e8ebf0"
              strokeWidth={compactRingWidth}
            />
          ) : (
            compact.arcs.map((arc) => <path key={arc.key} d={arc.d} fill={arc.color} />)
          )}
          <text x={small.cx} y={small.cy + 2} textAnchor="middle" fontSize="30" fontWeight="800" fill="#0f172a">
            {formatValue(total)}
          </text>
          <text x={small.cx} y={small.cy + 22} textAnchor="middle" fontSize="11" fontWeight="600" fill="#64748b">
            {centerLabel}
          </text>
        </svg>
      </div>

      <ul className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
        {slices.map((slice) => (
          <li key={slice.key} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-[2px]" style={{backgroundColor: slice.color}} aria-hidden="true" />
            <span className="text-xs font-semibold text-slate-600">{slice.label}</span>
            <span className="text-[11px] font-bold tabular-nums text-slate-400">
              {formatValue(slice.value)} · {pct(slice.value)}%
            </span>
          </li>
        ))}
      </ul>

      {sum <= 0 ? <p className="mt-3 text-center text-xs text-slate-400">{emptyLabel}</p> : null}
    </div>
  );
}
