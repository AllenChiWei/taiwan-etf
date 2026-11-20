/* 選擇權結算價預測（週三、週五到期，含月選）。
 *
 * 結算日 12:55 起每 5 秒向轉接站要一次加權指數，在瀏覽器累積 13:00～13:25 每 5 秒的取樣，
 * 用期交所算法（300 筆＋收盤，共 301 筆平均）即時算出預測結算價；13:30 收盤後就是自算的最後結算價。
 * 網頁晚開時，漏掉的取樣點用證交所每分鐘資料內插。結算日來自 atm.json 的合約到期日（假日順延已含）。 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { fetchAtm } from '../api/atm';
import { fetchTaiex5s, fetchTaiexLive, type TaiexLive } from '../api/settle';
import {
  CLOSE_SEC, SLOT_FIRST, TOTAL, hmsSec, nextSettle, predictSettle, settleDates, taipeiNow, type Point,
} from '../lib/settle';
import { WEEKDAY_LABEL, weekdayOf } from '../lib/atm';

const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const START = 12 * 3600 + 55 * 60;                 // 12:55 開始抓（13:00:05 第一筆）
const POLL_MS = 5000;

function dayLabel(iso: string): string {
  const wd = weekdayOf(iso);
  return `${iso.slice(5).replace('-', '/')}${wd === null ? '' : `（${WEEKDAY_LABEL[wd]}）`}`;
}

/** 合約代號 → 系列名稱：202611W4 週三週選、202611F3 週五週選、202611 月選 */
function seriesOf(c: string): string {
  if (/W\d$/.test(c)) return `週三週選 ${c.slice(-2)}`;
  if (/F\d$/.test(c)) return `週五週選 ${c.slice(-2)}`;
  return '月選';
}

/** 籌碼頁價平和下方的入口（2026-11-21 改成獨立頁 #/settle 後留一行連結） */
export function SettleLink() {
  return (
    <Link to="/settle"
          className="mt-3 flex items-center justify-between rounded-xl border border-line bg-surface px-3.5 py-3 text-[13px] hover:border-accent">
      <span><b className="text-ink">結算價預測</b><span className="ml-2 text-muted">週三／週五結算日 13:00 起每 5 秒即時更新</span></span>
      <span className="font-semibold text-accent">前往 →</span>
    </Link>
  );
}

/** page＝獨立頁面（#/settle）：數字放大、列出接下來的結算日；否則是籌碼頁裡的小卡 */
export function SettleSection({ page = false }: { page?: boolean }) {
  const [dates, setDates] = useState<string[] | null>(null);
  const [upcoming, setUpcoming] = useState<Array<{ e: string; c: string }>>([]);
  const [now, setNow] = useState(() => taipeiNow());
  const [live, setLive] = useState<TaiexLive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const samples = useRef(new Map<number, number>());   // 這頁開著時抓到的每 5 秒指數

  useEffect(() => {
    const ac = new AbortController();
    fetchAtm(ac.signal)
      .then(d => {
        if (ac.signal.aborted) return;
        const rows = d?.rows ?? [];
        setDates(settleDates(rows));
        const m = new Map<string, string>();
        for (const r of rows) if (r.e && r.c && !m.has(r.e)) m.set(r.e, r.c);
        setUpcoming([...m].map(([e, c]) => ({ e, c })).sort((x, y) => x.e.localeCompare(y.e)));
      })
      .catch(() => { if (!ac.signal.aborted) setDates([]); });
    return () => ac.abort();
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(taipeiNow()), POLL_MS);
    return () => clearInterval(id);
  }, []);

  // 驗證用：localStorage twetf.settleDemo=1 時把今天當結算日、接受轉接站最近一個交易日的資料（非結算日也能實測整條路）
  const demo = useMemo(() => { try { return localStorage.getItem('twetf.settleDemo') === '1'; } catch { return false; } }, []);
  const next = dates ? nextSettle(dates, now.date) : null;
  const isToday = demo || next === now.date;
  const liveToday = live && (demo || `${live.d.slice(0, 4)}-${live.d.slice(4, 6)}-${live.d.slice(6)}` === now.date) ? live : null;
  const finalDone = !!liveToday && hmsSec(liveToday.t) >= CLOSE_SEC;
  const polling = isToday && (demo || now.sec >= START) && !finalDone;

  useEffect(() => {
    if (!polling) return;
    let stop = false;
    const ac = new AbortController();
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const j = await fetchTaiexLive(ac.signal);
        if (stop) return;
        const sec = hmsSec(j.t);
        if (sec >= SLOT_FIRST - 5 && sec <= CLOSE_SEC && sec % 5 === 0) samples.current.set(sec, j.z);
        setLive(j);
        setError(null);
      } catch (e) {
        if (!stop && !ac.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => { stop = true; ac.abort(); clearInterval(id); };
  }, [polling]);

  const pred0 = useMemo(() => {
    if (!liveToday) return null;
    const pts: Point[] = liveToday.bars.map(([ts, v]) => ({ sec: hmsSec(ts), v }));
    for (const [sec, v] of samples.current) pts.push({ sec, v });
    return predictSettle(pts, { sec: hmsSec(liveToday.t), v: liveToday.z });
  }, [liveToday]);

  // 收盤後還有內插的：改用證交所每 5 秒資料（收盤後才公布）重算，和期交所一模一樣；還沒公布就每 2 分鐘再試
  const [exact, setExact] = useState<Point[] | null>(null);
  const needExact = !!pred0 && pred0.final && pred0.interpolated > 0 && !!liveToday;
  useEffect(() => {
    if (!needExact || !liveToday || exact) return;
    let stop = false;
    const ac = new AbortController();
    const tryOnce = () => fetchTaiex5s(liveToday.d, ac.signal).then(p => { if (!stop && p) setExact(p); }).catch(() => {});
    void tryOnce();
    const id = setInterval(tryOnce, 120_000);
    return () => { stop = true; ac.abort(); clearInterval(id); };
  }, [needExact, liveToday, exact]);

  const pred = useMemo(() => {
    if (!exact) return pred0;
    const close = exact.filter(p => p.sec >= CLOSE_SEC)[0];
    return close ? predictSettle(exact.filter(p => p.sec < CLOSE_SEC), close) : pred0;
  }, [exact, pred0]);

  if (dates === null) return null;

  return (
    <section id="sec-settle" className="mt-3 scroll-mt-16 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="flex items-baseline justify-between gap-2">
        {page ? <h1 className="text-base font-bold text-ink">結算價預測</h1> : <h2 className="text-sm font-bold text-ink">結算價預測</h2>}
        <span className="text-[11.5px] text-muted">週三／週五選擇權（含月選）</span>
      </div>

      {pred && liveToday ? (
        <div className="mt-2 rounded-lg border border-line bg-bg px-3 py-2.5">
          <div className="text-[11.5px] text-muted">
            {pred.final ? '今天的最後結算價（自算，以期交所公告為準）' : '預測最後結算價'}
          </div>
          <div className={`mt-0.5 font-mono font-bold tabular-nums text-ink ${page ? 'text-[48px] leading-tight' : 'text-[28px]'}`}>{nf0.format(pred.rounded)}</div>
          <div className="mt-1 text-[11.5px] text-faint">
            加權指數 <span className="font-mono tabular-nums text-muted">{nf2.format(liveToday.z)}</span>
            {' · '}{liveToday.t}
            {' · '}已確定 <span className="font-mono tabular-nums">{pred.fixed}</span>／{TOTAL} 筆
            {pred.interpolated > 0 && <>（{pred.interpolated} 筆用每分鐘資料內插{pred.final && '，證交所每 5 秒資料公布後自動校正'}）</>}
            {exact && pred.interpolated === 0 && '（證交所每 5 秒資料）'}
            {liveToday.src === 'yahoo' && ' · 來源 Yahoo'}
          </div>
          {error && <div className="mt-1 text-[11.5px] text-ink">⚠ {error}，5 秒後重試</div>}
        </div>
      ) : (
        <div className="mt-2 rounded-lg border border-line bg-bg px-3 py-2.5 text-[12.5px] text-muted">
          {error ? (
            <span className="text-ink">⚠ {error}，5 秒後重試</span>
          ) : isToday ? (
            now.sec >= START ? '抓取即時指數中…' : <>今天 {dayLabel(now.date)} 是結算日，<b className="text-ink">13:00</b> 起每 5 秒即時預測。</>
          ) : next ? (
            <>下一個結算日 <b className="text-ink">{dayLabel(next)}</b>，當天 13:00 起每 5 秒即時預測。</>
          ) : '目前查不到下一個結算日。'}
        </div>
      )}

      {page && upcoming.some(u => u.e >= now.date) && (
        <div className="mt-3">
          <h2 className="text-[13px] font-bold text-ink">接下來的結算日</h2>
          <ul className="mt-1 divide-y divide-line rounded-lg border border-line bg-bg text-[12.5px]">
            {upcoming.filter(u => u.e >= now.date).slice(0, 6).map(u => (
              <li key={u.e} className="flex items-baseline justify-between gap-2 px-3 py-1.5">
                <span className={u.e === now.date ? 'font-bold text-ink' : 'text-ink'}>{dayLabel(u.e)}{u.e === now.date && ' 今天'}</span>
                <span className="text-muted">{seriesOf(u.c)}<span className="ml-1.5 font-mono text-faint">{u.c}</span></span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-faint">來自期交所每日選擇權行情的合約到期日（遇假日順延已含），每個交易日收盤後更新。</p>
        </div>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        期交所算法：結算日 13:00（不含）～13:25（含）每 5 秒的加權指數 300 筆，加 13:30 收盤指數，
        共 301 筆平均、四捨五入到 1 點。預測＝已過的取樣＋目前指數 × 還沒到的筆數。
        用 2026-10-02～11-20 共 15 個結算日核對，算法和公告結算價全部相同；網頁 13:00 後才打開時，
        漏掉的部分先用每分鐘資料補（可能差幾點），收盤後證交所公布每 5 秒資料時自動校正。
      </p>
    </section>
  );
}
