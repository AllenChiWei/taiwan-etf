/* 主動式 ETF 換股：最新持股、每天的新增／剔除／加碼／減碼，以及幾檔一起買賣的股票。
 *
 * 計算都在 lib/active.ts。這裡要講清楚兩件事：
 * 1. 加碼減碼已經扣掉當天的資金進出（現金申購會讓所有持股同比例伸縮）。
 * 2. 國泰 00400A 不在裡面，因為國泰的網站拒絕程式存取 —— 照實寫出來。
 */

import { useEffect, useMemo, useState } from 'react';
import { fetchActive } from '../api/extras';
import {
  KIND_LABEL, groupChanges, latestChange, netChange, consensus, sharesLabel,
  type ActiveData, type ChangeDay, type ChangeItem, type ChangeKind,
} from '../lib/active';

const nf1 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 新增、加碼是買（紅）；剔除、減碼是賣（綠）—— 紅漲綠跌的同一套語言。 */
const KIND_TONE: Record<ChangeKind, string> = {
  new: 'bg-up text-white', add: 'text-up', out: 'bg-down text-white', cut: 'text-down',
};
const KIND_ORDER: ChangeKind[] = ['new', 'add', 'cut', 'out'];

function Chip({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
            className={`h-8 shrink-0 rounded-lg px-3 text-[12.5px] font-semibold transition-colors ${
              active ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted hover:text-ink'}`}>
      {children}
    </button>
  );
}

function ChangeRow({ it, day, kind }: { it: ChangeItem; day: ChangeDay; kind: ChangeKind }) {
  const [code, name, a, b, w] = it;
  const pct = netChange(it, day.f);
  return (
    <li className="grid grid-cols-[1fr_auto] items-baseline gap-2 border-b border-line/60 py-1 last:border-0">
      <span className="min-w-0 truncate text-[13px] text-ink">
        <span className="font-mono text-[12px] text-muted">{code}</span> {name}
      </span>
      <span className="text-right font-mono text-[12px] tabular-nums">
        {kind === 'new' && <span className="text-ink">{sharesLabel(code, b, name)} · {nf2.format(w)}%</span>}
        {kind === 'out' && <span className="text-muted">原 {sharesLabel(code, a, name)}</span>}
        {(kind === 'add' || kind === 'cut') && (
          <>
            <span className={KIND_TONE[kind]}>{pct! > 0 ? '+' : ''}{nf1.format(pct! * 100)}%</span>
            <span className="ml-1.5 text-faint">{sharesLabel(code, a, name)}→{sharesLabel(code, b, name).replace(/ .*/, '')}</span>
          </>
        )}
      </span>
    </li>
  );
}

function DayDetail({ day }: { day: ChangeDay }) {
  const groups = groupChanges(day);
  if (day.items.length === 0) {
    return <p className="mt-1 text-[12.5px] text-muted">這天沒有換股（只有資金進出造成的同比例增減）。</p>;
  }
  return (
    <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
      {KIND_ORDER.filter(k => groups[k].length).map(k => (
        <div key={k} className="rounded-lg border border-line bg-bg p-2.5">
          <div className="flex items-baseline justify-between">
            <span className={`rounded px-1.5 py-px text-[11.5px] font-bold ${
              k === 'new' || k === 'out' ? KIND_TONE[k] : `bg-sunken ${KIND_TONE[k]}`}`}>
              {KIND_LABEL[k]}
            </span>
            <span className="text-[11px] text-faint">{groups[k].length} 檔</span>
          </div>
          <ul className="mt-1">
            {groups[k].slice(0, 12).map(it => <ChangeRow key={it[0]} it={it} day={day} kind={k} />)}
          </ul>
          {groups[k].length > 12 && (
            <p className="mt-1 text-[11px] text-faint">另有 {groups[k].length - 12} 檔</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function ActiveHoldings() {
  const [data, setData] = useState<ActiveData | null | undefined>(undefined);
  const [code, setCode] = useState('');
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    fetchActive(ac.signal).then(d => {
      if (ac.signal.aborted) return;
      setData(d);
      if (d) setCode(Object.keys(d.etfs)[0] ?? '');
    }).catch(() => { if (!ac.signal.aborted) setData(null); });
    return () => ac.abort();
  }, []);

  const cons = useMemo(() => (data ? consensus(data) : null), [data]);

  if (data === undefined) return <p className="py-10 text-center text-[13px] text-muted">載入持股資料中…</p>;
  if (data === null || !data.etfs[code]) {
    return <p className="py-10 text-center text-[13px] text-muted">還沒有主動式 ETF 的持股資料。</p>;
  }

  const etf = data.etfs[code];
  const last = latestChange(etf);
  const history = [...etf.changes].reverse().slice(0, 15);
  const holdings = showAll ? etf.holdings : etf.holdings.slice(0, 15);

  return (
    <div className="pt-4">
      {cons && cons.rows.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-3.5 sm:p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 className="text-sm font-bold text-ink">幾檔一起動的股票</h2>
            <span className="text-[11.5px] text-faint">{cons.date} · 各檔最新一次換股</span>
          </div>
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {cons.rows.slice(0, 10).map(r => (
              <li key={r.code} className="flex items-baseline justify-between gap-2 rounded-lg border border-line bg-bg px-2.5 py-1.5">
                <span className="min-w-0 truncate text-[13px] text-ink">
                  <span className="font-mono text-[12px] text-muted">{r.code}</span> {r.name}
                </span>
                <span className="shrink-0 text-[11.5px]">
                  {r.buy.length > 0 && <span className="text-up">買 {r.buy.join('、')}</span>}
                  {r.buy.length > 0 && r.sell.length > 0 && <span className="text-faint"> · </span>}
                  {r.sell.length > 0 && <span className="text-down">賣 {r.sell.join('、')}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="主動式 ETF">
          {Object.entries(data.etfs).map(([c, e]) => (
            <Chip key={c} active={c === code} onClick={() => { setCode(c); setOpenDay(null); setShowAll(false); }}>
              {c} {e.name.replace(/^主動/, '')}
            </Chip>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 className="text-[15px] font-bold text-ink">{code} {etf.name}</h2>
          <span className="text-[11.5px] text-faint">
            {etf.issuer} · 持股 {etf.holdings.length} 檔 · {etf.asof} 收盤後
          </span>
        </div>

        {last && (
          <>
            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3">
              <h3 className="text-[13px] font-bold text-ink">
                最新換股 <span className="font-mono font-normal text-muted">{last.p} → {last.d}</span>
              </h3>
              {Math.abs(last.f) >= 0.001 && (
                <span className="text-[11.5px] text-faint">
                  當天資金{last.f > 0 ? '流入' : '流出'}，持股同比例{last.f > 0 ? '增加' : '減少'}
                  {' '}{nf1.format(Math.abs(last.f) * 100)}%（已扣除）
                </span>
              )}
            </div>
            <DayDetail day={last} />
          </>
        )}

        <h3 className="mt-4 text-[13px] font-bold text-ink">近期換股紀錄</h3>
        <ul className="mt-1">
          {history.map(day => {
            const g = groupChanges(day);
            const open = openDay === day.d;
            return (
              <li key={day.d} className="border-b border-line/60 last:border-0">
                <button type="button" onClick={() => setOpenDay(open ? null : day.d)}
                        aria-expanded={open}
                        className="flex w-full items-baseline justify-between gap-2 py-1.5 text-left">
                  <span className="font-mono text-[12.5px] text-ink">{day.d}</span>
                  <span className="text-[11.5px]">
                    {KIND_ORDER.map(k => g[k].length > 0 && (
                      <span key={k} className={`ml-2 ${k === 'new' || k === 'add' ? 'text-up' : 'text-down'}`}>
                        {KIND_LABEL[k]} {g[k].length}
                      </span>
                    ))}
                    {day.items.length === 0 && <span className="text-faint">沒有換股</span>}
                    <span className="ml-2 text-faint">{open ? '▲' : '▼'}</span>
                  </span>
                </button>
                {open && <div className="pb-2"><DayDetail day={day} /></div>}
              </li>
            );
          })}
        </ul>

        <h3 className="mt-4 text-[13px] font-bold text-ink">目前持股（依權重）</h3>
        <ul className="mt-1">
          {holdings.map(([c, n, sh, w]) => (
            <li key={c} className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 border-b border-line/60 py-1 last:border-0">
              <span className="min-w-0 truncate text-[13px] text-ink">
                <span className="font-mono text-[12px] text-muted">{c}</span> {n}
              </span>
              <span className="font-mono text-[11.5px] tabular-nums text-faint">{sharesLabel(c, sh, n)}</span>
              <span className="w-[4.5em] text-right font-mono text-[12.5px] tabular-nums text-ink">{nf2.format(w)}%</span>
            </li>
          ))}
        </ul>
        {etf.holdings.length > 15 && (
          <button type="button" onClick={() => setShowAll(v => !v)}
                  className="mt-1.5 text-[12.5px] font-semibold text-accent">
            {showAll ? '收起' : `顯示全部 ${etf.holdings.length} 檔`}
          </button>
        )}
      </section>

      <p className="mt-3 text-[11px] leading-relaxed text-faint">
        資料來源：{data.meta.source}，每天收盤後更新。加碼／減碼會扣掉資金進出：主動式 ETF 是現金申購，如果某天所有持股都同比例增減，
        那是資金進出而不是看好哪一檔，所以只有偏離整體比例超過 {nf1.format(data.meta.minChange * 100)}% 的才算
        （目前這幾檔多數日子股數完全不動，這個調整幾乎沒有作用）。
        {data.meta.blocked.map(b => (
          <span key={b.code}> {b.code} {b.name} 不在清單裡：{b.reason}。</span>
        ))}
      </p>
    </div>
  );
}
