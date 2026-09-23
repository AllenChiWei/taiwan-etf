/* 籌碼面：期交所的三大法人與大額交易人，加上交易所的法人買賣超前十大。
 *
 * 資料全部來自 scripts/fetch_chips.py 產生的 chips.json，這一頁只負責呈現。
 *
 * 五個區塊的順序是照「從大盤到個股」排的：期貨未平倉 → Put/Call Ratio →
 * 選擇權未平倉 → 大額交易人 → 個股買賣超。看籌碼的人通常是先看大盤方向，
 * 再看誰在買什麼。
 */

import { useEffect, useMemo, useState } from 'react';
import { fetchChips } from '../api/chips';
import {
  WHO_ORDER, toYi, yuanToYi, sharesToLots, netTone, sharePct,
  contractSeries, bars, zeroY, lastValue, prepareLarge, contractAmount, joinDca,
  retailLatest, retailRatioSeries,
  type ChipsData, type LargeRow, type TopByWho, type TopRow, type DcaJoined,
} from '../lib/chips';
import { TONE_CLASS } from '../lib/format';
import { EmptyState } from '../components/EmptyState';
import { useEtfData } from '../context/AppContext';
import { AtmSection } from '../components/AtmSection';
import { StockSheet } from '../components/StockSheet';

const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 });

/** 帶正負號：籌碼的數字看的是方向，+2,598 與 2,598 讀起來不一樣。 */
const signed = (n: number) => (n > 0 ? `+${nf0.format(n)}` : nf0.format(n));
const signedYi = (n: number) => (n > 0 ? `+${nf2.format(n)}` : nf2.format(n));

/* ── 共用的小元件 ───────────────────────────────────────── */

function Section({ title, hint, children }: {
  title: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-bold text-ink">{title}</h2>
        {hint && <span className="text-[11.5px] text-faint">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/** 區塊內的切換鈕。手機上會換行，所以用 flex-wrap 而不是等分的格線。 */
function Switch<T extends string>({ options, value, onChange, label }: {
  options: readonly T[]; value: T; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="mt-2 flex flex-wrap gap-1.5">
      {options.map(o => (
        <button
          key={o}
          type="button"
          role="tab"
          aria-selected={o === value}
          onClick={() => onChange(o)}
          className={`h-8 rounded-lg px-3 text-[12.5px] font-semibold transition-colors ${
            o === value ? 'bg-accent text-accent-ink'
              : 'bg-sunken text-muted hover:text-ink'}`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

/**
 * 柱狀圖。每天一根，從零軸長出來，紅多綠空。
 *
 * 用柱子而不是折線：每天的未平倉淨額是一個獨立的量，不是連續變化的軌跡；
 * 而且正負一眼要分得出來，折線跨越零軸時反而看不出來。
 *
 * preserveAspectRatio="none" 讓它橫向填滿，所以柱寬會被拉伸 —— 這裡只看形狀
 * 與正負，不需要等比例。
 */
function Bars({ values, height = 56 }: {
  values: (number | null)[]; height?: number;
}) {
  const W = 320;
  const rects = bars(values, W, height);
  const z = zeroY(values, height);
  if (rects.length === 0) return null;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" role="presentation"
         className="h-14 w-full">
      {z !== null && (
        <line x1="0" x2={W} y1={z} y2={z} stroke="currentColor"
              className="text-line" strokeWidth="1" strokeDasharray="3 3" />
      )}
      {rects.map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h}
              className={b.up ? 'fill-up' : 'fill-down'} />
      ))}
    </svg>
  );
}

function Stat({ label, value, sub, tone }: {
  label: string; value: string; sub?: string; tone?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-bg px-3 py-2">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className={`mt-0.5 font-mono text-[17px] font-bold tabular-nums ${tone ?? 'text-ink'}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

/* ── 三大法人期貨未平倉 ─────────────────────────────────── */

function FuturesSection({ data }: { data: ChipsData }) {
  const contracts = useMemo(() => {
    const seen: string[] = [];
    for (const r of data.futures) if (!seen.includes(r.c)) seen.push(r.c);
    // 歷史裡有、但今天沒有部位的契約也要能選
    for (const c of Object.keys(data.futHistory.contracts)) {
      if (!seen.includes(c)) seen.push(c);
    }
    return seen;
  }, [data]);
  const [contract, setContract] = useState(contracts[0] ?? '');
  const rows = data.futures.filter(r => r.c === contract);
  const series = contractSeries(data.futHistory, contract);
  const dates = data.futHistory.dates;
  const oiLine = data.futHistory.oi?.[contract];
  // 取最後一天而不是 lastValue：法人列是最新一日的，全市場量也必須是同一天
  const retail = retailLatest(rows, oiLine?.[oiLine.length - 1] ?? null);
  const retailLine = retailRatioSeries(data.futHistory, contract);

  return (
    <Section title="三大法人期貨未平倉"
             hint={`未平倉淨額 · 近 ${dates.length} 個交易日`}>
      <Switch options={contracts} value={contract} onChange={setContract} label="期貨契約" />

      <div className="mt-2.5 space-y-2.5">
        {WHO_ORDER.map(who => {
          const row = rows.find(r => r.w === who);
          const line = series[who] ?? [];
          const latest = row ? row.n : lastValue(line);
          if (latest === null) return null;
          return (
            <div key={who} className="rounded-lg border border-line bg-bg p-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                {/* 不再給每家法人一個代表色：柱子的顏色現在表示多空（紅多綠空），
                    旁邊再放一個不同色的點只會讓人以為那是這條資料的顏色 */}
                <span className="text-[13px] font-semibold text-ink">{who}</span>
                <span className={`font-mono text-[15px] font-bold tabular-nums
                                  ${TONE_CLASS[netTone(latest)]}`}>
                  {signed(latest)} 口
                </span>
              </div>
              {row && (
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11.5px] text-muted">
                  <span>契約金額 {signedYi(toYi(row.a))} 億</span>
                  <span>多 {nf0.format(row.bn)} / 空 {nf0.format(row.sn)}</span>
                  <span>當日淨 {signed(row.tn)} 口</span>
                </div>
              )}
              <Bars values={line} />
            </div>
          );
        })}

        {retail && (
          <div className="rounded-lg border border-dashed border-line bg-bg p-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-[13px] font-semibold text-ink">
                散戶 <span className="text-[11px] font-normal text-faint">推算</span>
              </span>
              <span className={`font-mono text-[15px] font-bold tabular-nums
                                ${TONE_CLASS[netTone(retail.net)]}`}>
                {signed(retail.net)} 口
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11.5px] text-muted">
              <span className={TONE_CLASS[netTone(retail.ratio)]}>
                多空比 {retail.ratio > 0 ? '+' : ''}{nf2.format(retail.ratio)}%
              </span>
              <span>多 {nf0.format(retail.long)} / 空 {nf0.format(retail.short)}</span>
              <span>全市場未平倉 {nf0.format(retail.oi)} 口</span>
            </div>
            <div className="mt-1 text-[10.5px] text-faint">多空比走勢</div>
            <Bars values={retailLine} />
          </div>
        )}
      </div>

      <p className="mt-2 text-[11px] text-faint">
        正數是淨多單、負數是淨空單（紅多綠空）。虛線是零軸，跨過它就是翻多或翻空。
      </p>
      {retail && (
        <p className="mt-1 text-[11px] text-faint">
          散戶是推算的，期交所不公佈：散戶多單＝全市場未平倉 − 三大法人多單，空單同理；
          多空比＝散戶淨額 ÷ 全市場未平倉。這裡的「散戶」是三大法人以外的所有人。
        </p>
      )}
    </Section>
  );
}

/* ── Put/Call Ratio ─────────────────────────────────────── */

function PcSection({ data }: { data: ChipsData }) {
  const { dates, vol, oi } = data.pc;
  const lastVol = vol.length ? vol[vol.length - 1] : null;
  const lastOi = oi.length ? oi[oi.length - 1] : null;
  // 100% 是多空平衡點，圖上要看得出在它的哪一邊，所以畫的是與 100 的差
  const volRel = vol.map(v => v - 100);
  const oiRel = oi.map(v => v - 100);

  return (
    <Section title="Put/Call Ratio" hint={`近 ${dates.length} 個交易日`}>
      <div className="mt-2 grid grid-cols-2 gap-2.5">
        <Stat label="成交量比" value={lastVol === null ? '—' : `${nf2.format(lastVol)}%`}
              sub="賣權成交量 ÷ 買權成交量" />
        <Stat label="未平倉量比" value={lastOi === null ? '—' : `${nf2.format(lastOi)}%`}
              sub="賣權未平倉 ÷ 買權未平倉" />
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-bg p-2.5">
          <div className="text-[11.5px] text-muted">成交量比走勢（虛線 = 100%）</div>
          <Bars values={volRel} />
        </div>
        <div className="rounded-lg border border-line bg-bg p-2.5">
          <div className="text-[11.5px] text-muted">未平倉量比走勢（虛線 = 100%）</div>
          <Bars values={oiRel} />
        </div>
      </div>
      <p className="mt-2 text-[11px] text-faint">
        比率高於 100% 代表賣權多於買權。未平倉量比變動慢、被當成偏中期的指標，
        成交量比每天跳動大。兩者都是統計，不是訊號。
      </p>
    </Section>
  );
}

/* ── 三大法人選擇權 ─────────────────────────────────────── */

/** 未平倉 / 當日交易。期交所那一頁兩側並列，這裡用切換，手機才排得下。 */
const OPT_SIDES = ['未平倉', '當日交易'] as const;

/**
 * 一個身份別的一組數字：口數在上、契約金額在下（億元）。
 *
 * 只有淨額帶正負號。買方與賣方是各自的部位，一律是正數 —— 給它們加上「+」
 * 會讓人以為那是淨額的方向。
 */
function OptTriple({ label, lots, amount, net = false }: {
  label: string; lots: number | undefined; amount: number | undefined; net?: boolean;
}) {
  const tone = net && lots !== undefined ? TONE_CLASS[netTone(lots)] : 'text-ink';
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] text-faint">{label}</div>
      <div className={`font-mono text-[12.5px] font-semibold tabular-nums ${tone}`}>
        {lots === undefined ? '—'
          : `${net ? signed(lots) : nf0.format(lots)} 口`}
      </div>
      <div className="font-mono text-[10.5px] tabular-nums text-muted">
        {contractAmount(amount, net)}
      </div>
    </div>
  );
}

function OptionsSection({ data }: { data: ChipsData }) {
  const [side, setSide] = useState<(typeof OPT_SIDES)[number]>('未平倉');
  if (data.options.length === 0) return null;
  const oi = side === '未平倉';
  // 舊版資料沒有交易側，那就不要給一個切了也沒東西的按鈕
  const hasVol = data.options.some(o => o.vn !== undefined);

  return (
    <Section title="三大法人臺指選擇權"
             hint={oi ? '未平倉口數與契約金額' : '當日交易口數與契約金額'}>
      {hasVol && (
        <Switch options={OPT_SIDES} value={side} onChange={setSide} label="資料類型" />
      )}

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {['CALL', 'PUT'].map(cp => (
          <div key={cp} className="rounded-lg border border-line bg-bg p-2.5">
            <div className="text-[12.5px] font-semibold text-ink">
              {cp === 'CALL' ? '買權 CALL' : '賣權 PUT'}
            </div>
            <ul className="mt-1.5 space-y-2">
              {WHO_ORDER.map(who => {
                const r = data.options.find(o => o.cp === cp && o.w === who);
                if (!r) return null;
                const buyLots = oi ? r.bn : r.vbn;
                const buyAmt = oi ? r.ba : r.vba;
                const sellLots = oi ? r.sn : r.vsn;
                const sellAmt = oi ? r.sa : r.vsa;
                const netLots = oi ? r.n : r.vn;
                const netAmt = oi ? r.a : r.va;
                return (
                  <li key={who}
                      className="border-t border-line/60 pt-1.5 first:border-0 first:pt-0">
                    <div className="text-[12px] font-semibold text-muted">{who}</div>
                    <div className="mt-0.5 grid grid-cols-3 gap-x-2">
                      <OptTriple label="買方" lots={buyLots} amount={buyAmt} />
                      <OptTriple label="賣方" lots={sellLots} amount={sellAmt} />
                      <OptTriple label="買賣淨額" lots={netLots} amount={netAmt} net />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        欄位對應期交所「三大法人－臺指選擇權買賣權分計」。買方與賣方是各自的部位，
        不是同一筆的兩端；買賣淨額 = 買方 − 賣方。選擇權的買賣方風險不對稱，
        金額大不等於部位大，口數與金額要一起看。
      </p>
    </Section>
  );
}

/* ── 大額交易人 ─────────────────────────────────────────── */

/** 口數與佔比固定分兩行 —— 五位數的口數會把佔比擠到下一行，
    有的列換行有的不換，整欄看起來就是歪的。 */
function Side({ label, lots: n, pct, tone }: {
  label: string; lots: number; pct: number | null; tone: string;
}) {
  return (
    <span className={`font-mono tabular-nums ${tone}`}>
      {label} {nf0.format(n)} 口
      <span className="block text-[11px] opacity-80">
        {pct === null ? '' : `${nf1.format(pct)}%`}
      </span>
    </span>
  );
}

function LargeTable({ rows }: { rows: LargeRow[] }) {
  if (rows.length === 0) {
    return <p className="mt-2 py-4 text-center text-[12.5px] text-muted">這個分類今天沒有資料。</p>;
  }
  return (
    <ul className="mt-2 space-y-2">
      {rows.map((r, i) => {
        const b5 = sharePct(r.b5, r.oi);
        const s5 = sharePct(r.s5, r.oi);
        const b10 = sharePct(r.b10, r.oi);
        const s10 = sharePct(r.s10, r.oi);
        return (
          <li key={`${r.id}-${r.cp ?? ''}-${r.term}-${r.who}-${i}`}
              className="rounded-lg border border-line bg-bg p-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="text-[13px] font-semibold text-ink">
                {r.name}{r.cp ? ` ${r.cp}` : ''}
              </span>
              <span className="text-[11.5px] text-muted">
                {r.term} · {r.who} · 全市場 {nf0.format(r.oi)} 口
              </span>
            </div>
            {/* 三欄（項目／買方／賣方）而不是四格：390px 下「前五大買方」這種
                五個字的標籤會被折成兩行，數字跟著錯位。 */}
            <div className="mt-1.5 grid grid-cols-[3.2em_1fr_1fr] gap-x-2 gap-y-1
                            text-[12.5px]">
              <span className="text-muted">前五大</span>
              <Side label="買" lots={r.b5} pct={b5} tone="text-up" />
              <Side label="賣" lots={r.s5} pct={s5} tone="text-down" />
              <span className="text-muted">前十大</span>
              <Side label="買" lots={r.b10} pct={b10} tone="text-up" />
              <Side label="賣" lots={r.s10} pct={s10} tone="text-down" />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const LARGE_KIND = ['期貨', '選擇權'] as const;
const LARGE_WHO = ['全部交易人', '特定法人'] as const;

function LargeSection({ data }: { data: ChipsData }) {
  const [kind, setKind] = useState<(typeof LARGE_KIND)[number]>('期貨');
  const [who, setWho] = useState<(typeof LARGE_WHO)[number]>('全部交易人');
  const all = kind === '期貨' ? data.large.fut : data.large.opt;
  const rows = useMemo(
    () => prepareLarge(all.filter(r => r.who === who)), [all, who]);

  return (
    <Section title="大額交易人未沖銷部位" hint="括號是佔全市場未沖銷部位的比例">
      <Switch options={LARGE_KIND} value={kind} onChange={setKind} label="商品類別" />
      <Switch options={LARGE_WHO} value={who} onChange={setWho} label="交易人類別" />
      <LargeTable rows={rows} />
      <p className="mt-2 text-[11px] text-faint">
        「特定法人」是大額交易人裡的法人部分，與「全部交易人」是包含關係，不能相減。
        期交所的臺股期貨含小型臺指與微型臺指的換算口數。
      </p>
    </Section>
  );
}

/* ── 各類股成交比重 ─────────────────────────────────────── */

function SectorSection({ data }: { data: ChipsData }) {
  const rows = data.sectors ?? [];
  if (rows.length === 0) return null;
  const details = rows.filter(r => !r.agg);
  const aggregates = rows.filter(r => r.agg);
  const max = Math.max(...details.map(r => r.pct), 1);

  return (
    <Section title="各類股成交比重" hint="上市，依成交金額">
      {aggregates.length > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-2.5">
          {aggregates.map(a => (
            <Stat key={a.n} label={`${a.n}（彙總）`} value={`${nf1.format(a.pct)}%`}
                  sub={`${nf0.format(Math.round(a.v / 1e8))} 億`} />
          ))}
        </div>
      )}

      <ul className="mt-2 space-y-1">
        {details.slice(0, 15).map(r => (
          <li key={r.n} className="grid grid-cols-[5.5em_1fr_4em] items-center gap-2">
            <span className="truncate text-[12px] text-muted">{r.n}</span>
            <span className="h-4 rounded bg-sunken">
              <span className="block h-4 rounded bg-accent/70"
                    style={{ width: `${Math.max(2, (r.pct / max) * 100)}%` }} />
            </span>
            <span className="text-right font-mono text-[11.5px] tabular-nums text-ink">
              {nf2.format(r.pct)}%
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[11px] text-faint">
        比重的分母是各細類的合計。「電子」與「化學生技醫療」是彙總類（等於底下幾個
        細類的總和），另外列出以免被算兩次 —— 一起算的話半導體會從 36% 被稀釋成 19%。
        櫃買沒有對應的公開端點，所以這份只有上市。
      </p>
    </Section>
  );
}

/* ── 法人買賣超前十大 ───────────────────────────────────── */

function TopList({ rows, side, onPick }: {
  rows: TopRow[]; side: 'buy' | 'sell'; onPick: (code: string) => void;
}) {
  if (rows.length === 0) {
    return <p className="py-3 text-center text-[12.5px] text-muted">沒有資料。</p>;
  }
  const tone = side === 'buy' ? 'text-up' : 'text-down';
  return (
    <ol className="mt-1.5 space-y-1">
      {rows.map((r, i) => (
        <li key={r.code}
            onClick={() => onPick(r.code)}
            role="button" tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault(); onPick(r.code); } }}
            className="grid cursor-pointer grid-cols-[1.4em_1fr_auto] items-baseline gap-2
                       border-b border-line/60 py-1 last:border-0 hover:bg-sunken/50">
          <span className="font-mono text-[11.5px] text-faint">{i + 1}</span>
          <span className="min-w-0">
            <span className="font-mono text-[13px] font-bold text-ink">{r.code}</span>
            <span className="ml-1.5 truncate text-[12.5px] text-muted">{r.name}</span>
          </span>
          <span className="text-right">
            <span className={`block font-mono text-[13px] font-semibold tabular-nums ${tone}`}>
              {nf0.format(Math.abs(sharesToLots(r.shares)))} 張
            </span>
            <span className="block font-mono text-[11px] tabular-nums text-faint">
              {r.amount === null ? '—' : `${nf2.format(Math.abs(yuanToYi(r.amount)))} 億`}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

const MARKETS = ['上市', '上櫃'] as const;

function TopSection({ data, onPick }: {
  data: ChipsData; onPick: (code: string) => void;
}) {
  const [market, setMarket] = useState<(typeof MARKETS)[number]>('上市');
  const [who, setWho] = useState<string>(WHO_ORDER[0]);
  const table: TopByWho | null = market === '上市' ? data.top.twse : data.top.tpex;
  const side = table?.[who];

  return (
    <Section title="三大法人買賣超前十大" hint="張數為主，金額為估算">
      <Switch options={MARKETS} value={market} onChange={setMarket} label="市場" />
      <Switch options={WHO_ORDER} value={who} onChange={setWho} label="身份別" />

      {!side ? (
        <p className="mt-2 py-4 text-center text-[12.5px] text-muted">
          {market}的資料這次沒有取得。
        </p>
      ) : (
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-line bg-bg p-2.5">
            <div className="text-[12.5px] font-semibold text-up">買超前十</div>
            <TopList onPick={onPick} rows={side.buy} side="buy" />
          </div>
          <div className="rounded-lg border border-line bg-bg p-2.5">
            <div className="text-[12.5px] font-semibold text-down">賣超前十</div>
            <TopList onPick={onPick} rows={side.sell} side="sell" />
          </div>
        </div>
      )}

      <p className="mt-2 text-[11px] text-faint">
        金額是估算：交易所只公佈股數，這裡用當日成交均價（成交金額÷成交股數）推估，
        不是法人的實際成交均價。外資含外資自營商，自營商含自行買賣與避險。
      </p>
    </Section>
  );
}

/* ── 頁面 ───────────────────────────────────────────────── */

/** 定期定額人氣榜：這一頁唯一一份「散戶在買什麼」的官方數字。 */
function DcaSection({ data, onPick }: {
  data: ChipsData; onPick: (code: string) => void;
}) {
  const [tab, setTab] = useState<'etfs' | 'stocks'>('etfs');
  const etfData = useEtfData();
  const dca = data.dca;

  // 清單只有 ETF，所以個股榜接不到報酬率 —— 那一欄會是「—」，這是預期內的
  const lookup = useMemo(() => {
    const m = new Map<string, { r12: string | null; yield: string | null }>();
    for (const e of etfData.etfs) m.set(e.code, { r12: e.r12 ?? null, yield: e.yield ?? null });
    return m;
  }, [etfData]);

  const rows = useMemo(
    () => (dca ? joinDca(tab === 'etfs' ? dca.etfs : dca.stocks, lookup) : []),
    [dca, tab, lookup]);

  if (!dca || rows.length === 0) return null;
  const top = rows[0];

  return (
    <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-bold text-ink">定期定額人氣榜</h2>
        <span className="text-[11.5px] text-faint">證交所月報 · 前 {rows.length} 名</span>
      </div>
      <p className="mt-1 text-[11.5px] leading-snug text-muted">
        有多少人設定了每月扣款買這一檔。這一頁其他數字講的是機構部位，
        這一份講的是真的有人在定期買進 —— 比較接近人氣，不是籌碼。
        {top && (
          <>
            {' '}目前 {top.name} 以 {nf0.format(top.n)} 戶居首，
            佔榜上合計的 {nf1.format(top.share)}%。
          </>
        )}
      </p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {([['etfs', 'ETF'], ['stocks', '個股']] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
            className={`h-8 shrink-0 rounded-lg px-3 text-[12.5px] font-semibold transition-colors ${
              tab === id ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <ol className="mt-2">
        {rows.map((r: DcaJoined, i: number) => (
          <li key={r.code}
              onClick={() => onPick(r.code)}
              role="button" tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault(); onPick(r.code); } }}
              className="grid cursor-pointer grid-cols-[1.4rem_1fr_auto] items-baseline gap-x-2
                         border-b border-line/60 py-1.5 last:border-0 hover:bg-sunken/50">
            <span className="font-mono text-[11.5px] tabular-nums text-faint">{i + 1}</span>
            <span className="min-w-0">
              <span className="font-mono text-[12.5px] text-muted">{r.code}</span>
              <span className="ml-1.5 text-[12.5px] text-ink">{r.name}</span>
              {/* 比重條：同一份榜內的相對大小，0050 一檔就吃掉四成 */}
              <span className="mt-1 block h-1 w-full max-w-[220px] rounded-full bg-sunken">
                <span className="block h-full rounded-full bg-accent"
                      style={{ width: `${Math.max(2, (r.n / rows[0].n) * 100)}%` }} />
              </span>
            </span>
            <span className="text-right">
              <span className="block font-mono text-[13px] font-bold tabular-nums text-ink">
                {nf0.format(r.n)}
              </span>
              <span className="block font-mono text-[10.5px] tabular-nums text-faint">
                {nf1.format(r.share)}%
                {r.r12 !== null && (
                  <span className={`ml-1 ${TONE_CLASS[r.r12 >= 0 ? 'up' : 'down']}`}>
                    1年 {r.r12 >= 0 ? '+' : ''}{nf1.format(r.r12)}%
                  </span>
                )}
              </span>
            </span>
          </li>
        ))}
      </ol>

      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        戶數是「有設定定期定額的帳戶數」，不是投入金額，所以一檔便宜的 ETF
        會比一檔貴的容易衝高。近一年報酬取自台股 ETF 清單，個股榜沒有這一欄。
        {dca.modified && `　資料更新：${dca.modified}`}
      </p>
    </section>
  );
}

export function ChipsPage() {
  // 買賣超與人氣榜的每一列都可以點開個股儀表板，關掉之後停在原來的位置
  const [sheet, setSheet] = useState<string | null>(null);
  const [data, setData] = useState<ChipsData | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const ac = new AbortController();
    fetchChips(ac.signal)
      .then(d => {
        if (ac.signal.aborted) return;
        setData(d);
        setState(d ? 'ready' : 'missing');
      })
      .catch((e: Error) => {
        if (ac.signal.aborted) return;
        setMessage(e.message);
        setState('error');
      });
    return () => ac.abort();
  }, []);

  // 價平和是另一份資料（atm.json，進版控），所以就算籌碼那份缺席也要照樣顯示 ——
  // 第一版寫成早退，結果某次部署沒產生 chips.json，連價平和整區都跟著消失。
  if (state === 'loading') {
    return (
      <>
        <p className="py-16 text-center text-[13px] text-muted">載入籌碼資料中…</p>
        <AtmSection />
      </>
    );
  }
  if (state === 'missing' || state === 'error' || !data) {
    return (
      <>
        {state === 'missing' ? (
          <EmptyState title="今天還沒有籌碼資料"
                      hint="資料在每個交易日收盤後更新，假日與收盤前會是空的。" />
        ) : (
          <EmptyState title="籌碼資料載入失敗" hint={message} />
        )}
        <AtmSection />
      </>
    );
  }

  return (
    <>
      <h1 className="sr-only">籌碼</h1>
      <StockSheet code={sheet} onClose={() => setSheet(null)} />
      <div className="mt-4 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-sm font-bold text-ink">{data.meta.date} 收盤籌碼</h2>
          <span className="text-[11.5px] text-faint">{data.meta.source}</span>
        </div>
        <p className="mt-1 text-[11.5px] text-muted">{data.meta.note}</p>
      </div>

      <FuturesSection data={data} />
      <PcSection data={data} />
      <OptionsSection data={data} />
      <AtmSection />
      <LargeSection data={data} />
      <SectorSection data={data} />
      <TopSection data={data} onPick={setSheet} />
      <DcaSection data={data} onPick={setSheet} />

      <p className="mt-4 mb-2 text-[11.5px] leading-relaxed text-faint">
        籌碼資料為交易所與期交所的公開統計，僅供參考，不構成投資建議。
        未平倉與買賣超反映的是已經發生的部位，不預測後市。
      </p>
    </>
  );
}
