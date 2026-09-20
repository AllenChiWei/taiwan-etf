/* 百分位雷達圖。純 SVG，沒有圖表套件。
 *
 * 每一軸都是 0–100 的百分位，**刻度一致所以形狀是有意義的** —— 這是雷達圖唯一
 * 說得過去的用法。把「營收成長 50 億」跟「殖利率 5%」硬塞進同一張雷達，
 * 那個多邊形的面積不代表任何東西，只是好看。
 *
 * 軸少於三條就不畫：兩條軸的雷達是一條線，看不出形狀。
 */

export interface RadarAxis {
  label: string;
  /** 0–100；沒有資料傳 null，那一軸會縮到圓心並畫成空心點 */
  value: number | null;
}

interface Props {
  axes: RadarAxis[];
  /** 邊長，正方形 */
  size?: number;
}

const RINGS = [25, 50, 75, 100];

export function Radar({ axes, size = 200 }: Props) {
  if (axes.length < 3) return null;
  const cx = size / 2;
  const cy = size / 2;
  // 標籤是四個字的中文，畫在 r 的 1.2 倍處 —— 邊留太少左右兩軸會被畫布切掉
  // （實測「累計年增」只剩「計年增」）。留 40 是實際量出來剛好的值。
  const r = size / 2 - 40;

  // 從正上方開始，順時針
  const angle = (i: number) => (Math.PI * 2 * i) / axes.length - Math.PI / 2;
  const at = (i: number, frac: number) => ({
    x: cx + Math.cos(angle(i)) * r * frac,
    y: cy + Math.sin(angle(i)) * r * frac,
  });

  const poly = axes
    .map((a, i) => {
      const p = at(i, (a.value ?? 0) / 100);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-auto w-full max-w-[260px]"
         role="img" aria-label="各項百分位雷達圖">
      {RINGS.map(ring => (
        <polygon
          key={ring}
          points={axes.map((_, i) => {
            const p = at(i, ring / 100);
            return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
          }).join(' ')}
          fill="none"
          className="stroke-line"
          strokeWidth={ring === 100 ? 1 : 0.5}
        />
      ))}
      {axes.map((_, i) => {
        const p = at(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y}
                     className="stroke-line" strokeWidth="0.5" />;
      })}

      <polygon points={poly} className="fill-accent/25 stroke-accent" strokeWidth="1.5" />

      {axes.map((a, i) => {
        const p = at(i, (a.value ?? 0) / 100);
        return (
          <circle key={i} cx={p.x} cy={p.y} r="2.5"
                  className={a.value === null ? 'fill-bg stroke-line' : 'fill-accent'}
                  strokeWidth="1" />
        );
      })}

      {axes.map((a, i) => {
        const p = at(i, 1.2);
        // 靠左的標籤靠右對齊，否則會被畫布切掉
        const anchor = p.x < cx - 4 ? 'end' : p.x > cx + 4 ? 'start' : 'middle';
        return (
          <text key={i} x={p.x} y={p.y} textAnchor={anchor} dominantBaseline="middle"
                className="fill-muted text-[8px]">
            {a.label}
          </text>
        );
      })}
    </svg>
  );
}

/* ── 環形圖 ─────────────────────────────────────────────── */

interface DonutProps {
  /** 0–100 */
  value: number;
  label: string;
  /** 中間顯示的字；預設是百分比 */
  text?: string;
  size?: number;
}

/** 單一比例的環形圖。用在「外資持股 69%」這種一個數字的場合。 */
export function Donut({ value, label, text, size = 84 }: DonutProps) {
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="flex flex-col items-center">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-auto w-full max-w-[84px]"
           role="img" aria-label={`${label} ${v}%`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
                className="stroke-sunken" strokeWidth="7" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
                className="stroke-accent" strokeWidth="7" strokeLinecap="round"
                strokeDasharray={`${(c * v) / 100} ${c}`}
                transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central"
              className="fill-ink text-[13px] font-bold">
          {text ?? `${Math.round(v)}%`}
        </text>
      </svg>
      <span className="mt-0.5 text-center text-[11px] leading-tight text-muted">{label}</span>
    </div>
  );
}
