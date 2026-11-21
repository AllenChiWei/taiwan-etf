/* 選擇權結算價預測（週三、週五到期，含月選）。
 *
 * 結算日 12:55 起每 5 秒向轉接站要一次加權指數，在瀏覽器累積 13:00～13:25 每 5 秒的取樣，
 * 用期交所算法（300 筆＋收盤，共 301 筆平均）即時算出預測結算價；13:30 收盤後就是自算的最後結算價。
 * 網頁晚開時，漏掉的取樣點用證交所每分鐘資料內插。結算日來自 atm.json 的合約到期日（假日順延已含）。 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { fetchAtm } from '../api/atm';
import { fetchSettleHistory, fetchTaiex5s, fetchTaiexLive, type SettleHistRow, type TaiexLive } from '../api/settle';
import {
  CLOSE_SEC, SLOT_FIRST, TOTAL, driftStats, hmsSec, nextSettle, predictSettle, secLabel, settleCurve, settleHistory, settleDates, strikeNeed, strikesAround,
  taipeiNow, type Point, type Prediction,
} from '../lib/settle';
import { SettleChart } from './SettleChart';
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
  const [hist, setHist] = useState<SettleHistRow[]>([]);

  useEffect(() => {
    const ac = new AbortController();
    fetchSettleHistory(ac.signal).then(r => { if (!ac.signal.aborted) setHist(r); }).catch(() => {});
    return () => ac.abort();
  }, []);

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
  // 驗證用：再加 twetf.settleDemoAt=13:15:00 時，把資料截到那個時間（看收盤前才有的履約價表與半條曲線）
  const demoAt = useMemo(() => {
    try {
      const at = demo ? localStorage.getItem('twetf.settleDemoAt') : null;
      return at ? hmsSec(at) : NaN;              // 注意 hmsSec('') 是 0，沒設定要明確給 NaN
    } catch { return NaN; }
  }, [demo]);
  const liveToday = useMemo(() => {
    if (!live || !(demo || `${live.d.slice(0, 4)}-${live.d.slice(4, 6)}-${live.d.slice(6)}` === now.date)) return null;
    if (!Number.isFinite(demoAt)) return live;
    const bars = live.bars.filter(b => hmsSec(b[0]) <= demoAt);
    return { ...live, t: secLabel(demoAt), z: bars.at(-1)?.[1] ?? live.z, bars,
             samples: (live.samples ?? []).filter(s => hmsSec(s[0]) <= demoAt) };
  }, [live, demo, demoAt, now.date]);
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

  // 已知的指數：每分鐘資料 → 轉接站排程存的每 5 秒（13:00 後才打開也有）→ 這頁自己抓到的（後蓋前）
  const livePts = useMemo(() => {
    if (!liveToday) return null;
    const pts: Point[] = liveToday.bars.map(([ts, v]) => ({ sec: hmsSec(ts), v }));
    for (const [ts, v] of liveToday.samples ?? []) pts.push({ sec: hmsSec(ts), v });
    for (const [sec, v] of samples.current) pts.push({ sec, v });
    return pts;
  }, [liveToday]);
  const pred0 = useMemo(
    () => (livePts && liveToday ? predictSettle(livePts, { sec: hmsSec(liveToday.t), v: liveToday.z }) : null),
    [livePts, liveToday]);

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

  // 小圖：今天有 13:00 以後的資料就畫今天；否則畫前一次結算日（settle.json）
  const todayCurve = useMemo(() => {
    if (exact) return settleCurve(exact, CLOSE_SEC);
    if (!livePts || !liveToday) return [];
    const cur = { sec: hmsSec(liveToday.t), v: liveToday.z };
    return settleCurve([...livePts, cur], cur.sec);
  }, [exact, livePts, liveToday]);
  const lastHist = useMemo(() => {
    const r = [...hist].reverse().find(h => h.v?.length === 361 && h.d < now.date);
    return r ? { row: r, curve: settleCurve(r.v!.map((v, i) => ({ sec: 13 * 3600 + i * 5, v })), CLOSE_SEC) } : null;
  }, [hist, now.date]);

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
          {!pred.final && <StrikeTable pred={pred} z={liveToday.z} />}
          {todayCurve.length > 1 && <SettleChart curve={todayCurve} />}
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

      {!(pred && liveToday && todayCurve.length > 1) && lastHist && (
        <div className="mt-3">
          <h2 className="text-[13px] font-bold text-ink">
            前次結算 {dayLabel(lastHist.row.d)}：<span className="font-mono tabular-nums">{nf0.format(lastHist.row.settle)}</span>
          </h2>
          <p className="text-[11.5px] text-muted">
            {lastHist.row.fsp === undefined ? '期交所公告還沒抓到'
              : lastHist.row.fsp === lastHist.row.settle ? `期交所公告 ${nf0.format(lastHist.row.fsp)}，和自算相同`
              : `期交所公告 ${nf0.format(lastHist.row.fsp)}（自算不同，以公告為準）`}
            {' · '}{lastHist.row.c.join('／')}
          </p>
          <SettleChart curve={lastHist.curve} />
          <p className="mt-0.5 text-[11px] text-faint">
            細線是加權指數，粗線是站在當時看的預測結算價：越接近 13:25 越定，最後一點就是結算價。
          </p>
        </div>
      )}

      {page && hist.length > 0 && <SettleHistTable hist={hist} />}

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
        用 2025-12-12～2026-11-20 共 95 個結算日核對，算法和公告結算價全部相同。網頁 13:00 後才打開時，
        前面每 5 秒的指數由轉接站補上（轉接站平日 13:00～13:30 自己每 5 秒記一次）；轉接站也沒有的部分
        用每分鐘資料補（整分那一筆不一定有代表性，最多可能差 30 點），收盤後證交所公布每 5 秒資料時自動校正。
      </p>
    </section>
  );
}

/** 附近履約價：結算價現在在哪一邊、剩下的指數平均要多少才會翻過去。 */
function StrikeTable({ pred, z }: { pred: Prediction; z: number }) {
  const per100 = Math.round((pred.remaining / TOTAL) * 100);
  const diff = (v: number) => {
    const d = Math.round(v - z);
    return `${d >= 0 ? '+' : '−'}${nf0.format(Math.abs(d))}`;
  };
  return (
    <div className="mt-2.5 border-t border-line pt-2">
      <p className="text-[11.5px] text-muted">
        還沒到的有 <b className="font-mono tabular-nums text-ink">{pred.remaining}</b>／{TOTAL} 筆：
        剩下的指數平均每差 100 點，結算價只差約 <b className="font-mono tabular-nums text-ink">{per100}</b> 點。
      </p>
      <table className="mt-1.5 w-full text-[12px]">
        <thead>
          <tr className="text-left text-[11px] text-faint">
            <th className="py-0.5 font-normal">履約價</th>
            <th className="py-0.5 font-normal">現在預測</th>
            <th className="py-0.5 text-right font-normal">剩下的指數平均要（比目前）</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {strikesAround(pred.rounded).map(K => {
            const n = strikeNeed(pred, K);
            if (!n) return null;
            const side = pred.rounded > K ? '高於' : pred.rounded < K ? '低於' : '等於';
            return (
              <tr key={K}>
                <td className="py-1 font-mono tabular-nums text-ink">{nf0.format(K)}</td>
                <td className={`py-1 ${side === '高於' ? 'text-up' : side === '低於' ? 'text-down' : 'text-muted'}`}>
                  {side}{side === '高於' ? '（買權價內）' : side === '低於' ? '（賣權價內）' : ''}
                </td>
                <td className="py-1 text-right font-mono tabular-nums text-muted">
                  {/* 結算價 > K ⇔ 平均 ≥ above；結算價 < K ⇔ 平均 < below */}
                  {side === '高於' && <>&lt; {nf0.format(n.above)}（{diff(n.above)}）才不高於</>}
                  {side === '低於' && <>≥ {nf0.format(n.below)}（{diff(n.below)}）才不低於</>}
                  {side === '等於' && <>≥ {nf0.format(n.above)}（{diff(n.above)}）才高於<br />
                    &lt; {nf0.format(n.below)}（{diff(n.below)}）才低於</>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 結算價歷史：每次的結算價、和期交所公告是否相同、13:00 指數到結算價拉了多少。 */
function SettleHistTable({ hist }: { hist: SettleHistRow[] }) {
  const [all, setAll] = useState(false);
  const list = useMemo(() => settleHistory(hist), [hist]);
  const st = useMemo(() => driftStats(list), [list]);
  const same = list.filter(r => r.fsp !== undefined && r.fsp === r.settle).length;
  const withFsp = list.filter(r => r.fsp !== undefined).length;
  const shown = all ? list : list.slice(0, 10);
  const sign = (v: number) => `${v >= 0 ? '+' : '−'}${nf0.format(Math.abs(Math.round(v)))}`;
  return (
    <div className="mt-3">
      <h2 className="text-[13px] font-bold text-ink">歷次結算價</h2>
      <p className="mt-0.5 text-[11.5px] text-muted">
        {list.length} 次，有期交所公告的 {withFsp} 次中自算相同 <b className="text-ink">{same}</b> 次。
        {st && <>「13:00 起」＝結算價 − 13:00 的加權指數：最近 {st.n} 次平均差 <b className="font-mono text-ink">{nf0.format(st.meanAbs)}</b> 點、
          最大 {nf0.format(st.maxAbs)} 點（結算價比 13:00 高 {st.up} 次、低 {st.down} 次）。</>}
      </p>
      <table className="mt-1.5 w-full text-[12px]">
        <thead>
          <tr className="text-right text-[11px] text-faint">
            <th className="py-0.5 pr-2 text-left font-medium">結算日</th>
            <th className="py-0.5 pr-2 font-medium">結算價</th>
            <th className="py-0.5 pr-2 font-medium">13:00 起</th>
            <th className="py-0.5 font-medium">公告</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {shown.map(r => (
            <tr key={r.d} className="text-right font-mono tabular-nums">
              <td className="py-1 pr-2 text-left font-sans text-ink">
                {dayLabel(r.d)}
                <span className="ml-1 font-mono text-[10.5px] text-faint">{r.c.map(seriesShort).join('/')}</span>
              </td>
              <td className="py-1 pr-2 font-semibold text-ink">{nf0.format(r.fsp ?? r.settle)}</td>
              <td className={`py-1 pr-2 ${r.drift === undefined ? 'text-faint' : r.drift >= 0 ? 'text-up' : 'text-down'}`}>
                {r.drift === undefined ? '—' : sign(r.drift)}
              </td>
              <td className="py-1 font-sans text-[11.5px] text-muted">
                {r.fsp === undefined ? '未抓到' : r.fsp === r.settle ? '相同' : <b className="text-ink">自算 {nf0.format(r.settle)}</b>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.length > 10 && (
        <button type="button" onClick={() => setAll(v => !v)}
                className="mt-1.5 text-[12px] font-semibold text-accent">
          {all ? '只看最近 10 次' : `顯示全部 ${list.length} 次`}
        </button>
      )}
      <p className="mt-1 text-[11px] text-faint">
        13:00 的指數只留最近 30 個結算日的走勢，更早的只有結算價。
      </p>
    </div>
  );
}

/** 202611W4 → W4、202611F3 → F3、202611 → 月 */
function seriesShort(c: string): string {
  return /[WF]\d$/.test(c) ? c.slice(-2) : '月';
}
