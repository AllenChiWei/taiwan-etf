/* 六人桌的座位圖：誰坐哪、按鈕與盲注在哪、這條街誰先講話。
 *
 * 點座位會切換上面選中的位置（跟開牌範圍表連動）。順序在 lib/ranges.ts。 */

import { useState } from 'react';
import { POSITIONS, SEAT_ORDER, actionRank } from '../lib/ranges';

type Street = 'preflop' | 'postflop';

// 座位的角度（度，0 = 右邊，順時針增加 —— SVG 的 y 軸朝下，角度變大就是順時針）。
// 按鈕放右下，依 BTN → SB → BB → UTG → HJ → CO 順時針排一圈。
const ANGLE: Record<string, number> = { btn: 60, sb: 120, bb: 180, utg: 240, hj: 300, co: 0 };

const W = 360;
const H = 250;
const CX = W / 2;
const CY = H / 2;

function at(angle: number, rx: number, ry: number) {
  const a = (angle * Math.PI) / 180;
  return { x: CX + rx * Math.cos(a), y: CY + ry * Math.sin(a) };
}

export function PokerTable({ selected, onSelect }: {
  selected: string; onSelect: (id: string) => void;
}) {
  const [street, setStreet] = useState<Street>('preflop');
  const first = street === 'preflop' ? 'UTG' : 'SB';
  const last = street === 'preflop' ? 'BB' : 'BTN';

  return (
    <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-ink">六人桌的位置</h2>
        <div className="flex gap-1 rounded-lg bg-sunken p-0.5">
          {([['preflop', '翻牌前'], ['postflop', '翻牌後']] as const).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={street === id} onClick={() => setStreet(id)}
                    className={`h-7 rounded-md px-2.5 text-[12px] font-semibold ${
                      street === id ? 'bg-surface text-ink shadow-sm' : 'text-muted'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto mt-2 block w-full max-w-[420px]"
           role="img" aria-label={`六人桌座位圖，${street === 'preflop' ? '翻牌前' : '翻牌後'}由 ${first} 先行動`}>
        {/* 桌面 */}
        <ellipse cx={CX} cy={CY} rx={118} ry={68} fill="#1f6b43" stroke="#14532d" strokeWidth={6} />
        <text x={CX} y={CY - 6} textAnchor="middle" fontSize="12" fill="#e7f5ec" fontWeight="bold">
          行動方向：順時針 ↻
        </text>
        <text x={CX} y={CY + 12} textAnchor="middle" fontSize="11" fill="#bfe3cc">
          {street === 'preflop' ? `翻牌前：${first} 先講、${last} 最後` : `翻牌後：${first} 先講、${last} 最後`}
        </text>

        {SEAT_ORDER.map(id => {
          const pos = POSITIONS.find(p => p.id === id)!;
          const seat = at(ANGLE[id], 150, 100);
          const chip = at(ANGLE[id], 95, 50);
          const n = actionRank(id, street);
          const on = id === selected;
          return (
            <g key={id} onClick={() => onSelect(id)} style={{ cursor: 'pointer' }}>
              <circle cx={seat.x} cy={seat.y} r={27}
                      fill={on ? 'var(--c-accent)' : 'var(--c-surface)'}
                      stroke={on ? 'var(--c-accent)' : 'var(--c-border-strong)'} strokeWidth={2} />
              <text x={seat.x} y={seat.y - 2} textAnchor="middle" fontSize="13" fontWeight="bold"
                    fill={on ? 'var(--c-accent-ink)' : 'var(--c-ink)'}>{pos.label}</text>
              <text x={seat.x} y={seat.y + 12} textAnchor="middle" fontSize="9.5"
                    fill={on ? 'var(--c-accent-ink)' : 'var(--c-muted)'}>{pos.name}</text>
              {/* 行動順序號碼 */}
              <circle cx={seat.x + 21} cy={seat.y - 21} r={10}
                      fill={n === 1 ? 'var(--c-up)' : 'var(--c-ink)'} />
              <text x={seat.x + 21} y={seat.y - 17.5} textAnchor="middle" fontSize="11" fontWeight="bold"
                    fill="var(--c-surface)">{n}</text>
              {/* 按鈕與盲注的籌碼，放在座位前面的桌上 */}
              {id === 'btn' && (
                <>
                  <circle cx={chip.x} cy={chip.y} r={11} fill="#ffffff" stroke="#333" strokeWidth={1.5} />
                  <text x={chip.x} y={chip.y + 4} textAnchor="middle" fontSize="12" fontWeight="bold" fill="#111">D</text>
                </>
              )}
              {(id === 'sb' || id === 'bb') && (
                <>
                  <circle cx={chip.x} cy={chip.y} r={11} fill="#f0a500" stroke="#8a5d00" strokeWidth={1.5} />
                  <text x={chip.x} y={chip.y + 3.5} textAnchor="middle" fontSize="9.5" fontWeight="bold" fill="#111">
                    {id === 'sb' ? '0.5' : '1'}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>

      <ul className="mt-2 space-y-1 text-[12px] leading-relaxed text-muted">
        <li>
          <strong className="text-ink">D 是按鈕（莊家位）</strong>，每手牌順時針移一格，所以大家輪流坐每個位置。
          按鈕左手邊依序是小盲（放 0.5 個大盲）、大盲（放 1 個）。
        </li>
        <li>
          <strong className="text-ink">翻牌前</strong>大小盲已經被迫下注，所以由大盲左邊的 UTG 先講話，大盲最後。
          <strong className="text-ink">翻牌後</strong>改從小盲開始，按鈕永遠最後。
        </li>
        <li>
          越晚行動越有利：你看得到前面每個人做了什麼才決定。所以 UTG 後面還有五個人、只能開很緊的範圍；
          BTN 翻牌後永遠最後，範圍可以開到最寬。紅色的 1 是這條街第一個行動的人。
        </li>
      </ul>
      <p className="mt-1.5 text-[11px] text-faint">點座位可以切換下面的開牌範圍。</p>
    </section>
  );
}
