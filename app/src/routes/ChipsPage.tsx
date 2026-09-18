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
  contractSeries, bars, zeroY, lastValue, prepareLarge,
  type ChipsData, type LargeRow, type TopByWho, type TopRow,
} from '../lib/chips';
import { TONE_CLASS } from '../lib/format';
import { EmptyState } from '../components/EmptyState';
import { AtmSection } from '../components/AtmSection';

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
      </div>

      <p className="mt-2 text-[11px] text-faint">
        正數是淨多單、負數是淨空單（紅多綠空）。虛線是零軸，跨過它就是翻多或翻空。
      </p>
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

/* ── 三大法人選擇權未平倉 ───────────────────────────────── */

function OptionsSection({ data }: { data: ChipsData }) {
  if (data.options.length === 0) return null;
  const sides = ['CALL', 'PUT'];
  return (
    <Section title="三大法人臺指選擇權未平倉" hint="口數與契約金額（億元）">
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {sides.map(cp => (
          <div key={cp} className="rounded-lg border border-line bg-bg p-2.5">
            <div className="text-[12.5px] font-semibold text-ink">
              {cp === 'CALL' ? '買權 CALL' : '賣權 PUT'}
            </div>
            <ul className="mt-1.5 space-y-1.5">
              {WHO_ORDER.map(who => {
                const r = data.options.find(o => o.cp === cp && o.w === who);
                if (!r) return null;
                return (
                  <li key={who} className="grid grid-cols-[3.5em_1fr_auto] items-baseline gap-2">
                    <span className="text-[12.5px] text-muted">{who}</span>
                    <span className={`font-mono text-[13.5px] font-semibold tabular-nums
                                      ${TONE_CLASS[netTone(r.n)]}`}>
                      {signed(r.n)} 口
                    </span>
                    <span className="font-mono text-[12px] tabular-nums text-muted">
                      {signedYi(toYi(r.a))} 億
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-faint">
        數字是「買方未平倉 − 賣方未平倉」。選擇權的買賣方風險不對稱，
        金額大不等於部位大，兩欄要一起看。
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

function TopList({ rows, side }: { rows: TopRow[]; side: 'buy' | 'sell' }) {
  if (rows.length === 0) {
    return <p className="py-3 text-center text-[12.5px] text-muted">沒有資料。</p>;
  }
  const tone = side === 'buy' ? 'text-up' : 'text-down';
  return (
    <ol className="mt-1.5 space-y-1">
      {rows.map((r, i) => (
        <li key={r.code}
            className="grid grid-cols-[1.4em_1fr_auto] items-baseline gap-2 border-b
                       border-line/60 py-1 last:border-0">
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

function TopSection({ data }: { data: ChipsData }) {
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
            <TopList rows={side.buy} side="buy" />
          </div>
          <div className="rounded-lg border border-line bg-bg p-2.5">
            <div className="text-[12.5px] font-semibold text-down">賣超前十</div>
            <TopList rows={side.sell} side="sell" />
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

export function ChipsPage() {
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

  if (state === 'loading') {
    return <p className="py-16 text-center text-[13px] text-muted">載入籌碼資料中…</p>;
  }
  if (state === 'missing') {
    return (
      <EmptyState title="今天還沒有籌碼資料"
                  hint="資料在每個交易日收盤後更新，假日與收盤前會是空的。" />
    );
  }
  if (state === 'error' || !data) {
    return <EmptyState title="籌碼資料載入失敗" hint={message} />;
  }

  return (
    <>
      <h1 className="sr-only">籌碼</h1>
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
      <TopSection data={data} />

      <p className="mt-4 mb-2 text-[11.5px] leading-relaxed text-faint">
        籌碼資料為交易所與期交所的公開統計，僅供參考，不構成投資建議。
        未平倉與買賣超反映的是已經發生的部位，不預測後市。
      </p>
    </>
  );
}
