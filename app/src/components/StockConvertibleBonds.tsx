import { useEffect, useState } from 'react';
import { fetchCb } from '../api/extras';
import type { CbBond } from '../lib/cb';
import { Section } from './StockBoard';

const n2 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n1 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const price = (v: number | null) => v === null ? '—' : n2.format(v);
const percent = (v: number | null) => v === null ? '—' : `${n1.format(v)}%`;
const date = (v: string | null) => v ? `${v.slice(0, 4)}/${Number(v.slice(5, 7))}/${Number(v.slice(8, 10))}` : '—';

export function StockConvertibleBonds({ code }: { code: string }) {
  const [result, setResult] = useState<{ date: string; bonds: CbBond[] } | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    fetchCb().then(data => {
      if (active) setResult(data ? { date: data.meta.date, bonds: data.bonds.filter(b => b.s === code && !b.exch) } : null);
    }).catch(() => { if (active) setResult(null); });
    return () => { active = false; };
  }, [code]);

  if (result === undefined) {
    return <Section title="這家公司的可轉債"><p className="mt-2 text-[12px] text-muted">載入可轉債資料中…</p></Section>;
  }
  if (result === null) {
    return <Section title="這家公司的可轉債"><p className="mt-2 text-[12px] text-muted">可轉債資料暫時讀不到。</p></Section>;
  }

  return (
    <Section title="這家公司的可轉債" hint="僅列掛牌中、標的為本公司的轉換公司債">
      {result.bonds.length === 0 ? (
        <p className="mt-2 text-[12px] text-muted">目前沒有符合條件的掛牌可轉債。</p>
      ) : (
        <div className="mt-2 space-y-2">
          {result.bonds.map(b => (
            <article key={b.c} className="rounded-lg border border-line bg-bg p-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="min-w-0">
                  <span className="font-mono text-[11.5px] text-muted">{b.c}</span>
                  <span className="ml-1.5 text-[13px] font-semibold text-ink">{b.n}</span>
                </div>
                <span className="text-[11px] text-faint">資料日期 {date(result.date)}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11.5px] sm:grid-cols-3 lg:grid-cols-5">
                <Metric label="價格" value={price(b.px)} />
                <Metric label="溢價率" value={percent(b.prem)} />
                <Metric label="轉換價" value={price(b.cp)} />
                <Metric label={`近月餘額減少估算${b.cvM ? `（${b.cvM}）` : ''}`} value={b.cv1 == null ? '—' : `${b.cv1.toLocaleString('zh-TW')} 張`} />
                <Metric label="賣回／到期" value={`${date(b.putE)}／${date(b.mat)}`} />
              </div>
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-faint">
                月減少張數包含轉換、賣回或買回，櫃買資料未拆分；並非純轉換量。賣回日期為申請迄日。
              </p>
            </article>
          ))}
        </div>
      )}
    </Section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><div className="text-faint">{label}</div><div className="break-words font-mono tabular-nums text-ink">{value}</div></div>;
}
