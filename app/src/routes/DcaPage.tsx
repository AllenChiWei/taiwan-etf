/* 定期定額紀錄（#/dca，私人頁，密碼同 v18；2026-11-02 使用者要求）：記錄 ETF、扣款日、金額、券商（華南、永豐），
 * 記得現在在哪裡定期定額；可以切換角色（自己、莎莎、QQ…）看各自的扣款行事曆與每月總額。計算都在 lib/dca.ts。
 * 同日追加：記錄兩個小孩（莎莎、QQ）的持股，並並排比較兩人目前的差異（市值、成本報酬、年配息、每月定期定額、逐檔對照）；
 * 報價用網站 yields.json 的收盤價與「最近一次配息 × 一年配幾次」。對象可以改名（定期定額與持股跟著改）。
 *
 * 資料：app/public/data/holdings/dca.enc（私人頁密碼加密），和支出預估、私人持股同一套：瀏覽器直接讀寫 GitHub（lib/ghSync.ts），
 * 寫入用配息頁「⚙ 同步設定」那把權杖，各裝置共用、不用等部署。修改先留在畫面上，按「☁ 儲存」才寫回；別的裝置先存過會先問。
 * 版面（手機 390px）：行事曆 7 欄等分、格子只放金額，點一天在下方看明細；表格放 overflow-x-auto。 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Vault, type VaultManifest } from '../lib/vault';
import { useVaultExpiry } from '../hooks/useVaultExpiry';
import { Locked } from './QBPage';
import { ghWrite, readEncrypted, readToken, type Src } from '../lib/ghSync';
import {
  BROKERS, byBroker, byPerson, cleanDca, compareHoldings, daysInMonth, daysText, monthDeductions, monthlyOf, monthTotal, newId, parseDays, peopleOf,
  renamePerson, summarize, upcoming,
  type DcaData, type DcaHolding, type DcaPlan, type PersonSummary, type Quote,
} from '../lib/dca';

const vault = new Vault(`${import.meta.env.BASE_URL}data/holdings/`, 'twetf.v18.unlock');
const FILE = 'dca.enc';

const nf = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const money = (v: number) => nf.format(Math.round(v));
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
// 人別的顏色（依人名清單的位置；用站內分類色票，深淺主題都有定義）
const personColor = (i: number) => `var(--cat-${(i % 6) + 1})`;

function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

interface Loaded { data: DcaData; src: Src | null; token: string | null; tokenState: 'ok' | 'none' | 'error' }

export function DcaPage() {
  const [manifest, setManifest] = useState<VaultManifest | null>(null);
  const [state, setState] = useState<'loading' | 'missing' | 'locked' | 'ready' | 'error'>('loading');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [msg, setMsg] = useState('');
  const load = async () => {
    try {
      setState('loading');
      const tk = await readToken(vault);
      const r = await readEncrypted<unknown>(vault, FILE, tk.token);
      if (!r.data && !r.missing) throw new Error('暫時讀不到定期定額資料（GitHub 限制讀取次數），請過幾分鐘再重新整理');
      setLoaded({ data: cleanDca(r.data), src: r.src, token: tk.token, tokenState: tk.state });
      setState('ready');
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); setState('error'); }
  };
  useEffect(() => {
    vault.loadManifest().then(async m => {
      if (!m) { setState('missing'); return; }
      setManifest(m);
      if (await vault.restore(m)) await load(); else setState('locked');
    }).catch(e => { setMsg(String(e)); setState('error'); });
  }, []);
  useVaultExpiry(vault, state === 'ready', () => { setLoaded(null); setState('locked'); });

  if (state === 'loading') return <p className="py-16 text-center text-[13px] text-muted">載入中…</p>;
  if (state === 'missing') return <p className="py-16 text-center text-[13px] text-muted">還沒有資料。</p>;
  if (state === 'locked' && manifest) return <Locked vault={vault} title="定期定額" manifest={manifest} onUnlock={load} />;
  if (state === 'error' || !loaded) return <p className="py-16 text-center text-[13px] text-down">載入失敗：{msg}</p>;
  return <Board loaded={loaded} />;
}

type Draft = { id: string | null; who: string; code: string; name: string; days: string; amount: string; broker: string; note: string };

/** 網站的 ETF 清單：輸入代號自動帶名稱（公開資料，讀不到就算了） */
/** 報價：網站 yields.json 的收盤價、最近一次配息 × 一年配幾次（公開資料，讀不到的代號不算市值） */
function useQuotes(): { quotes: Map<string, Quote>; asof: string } {
  const [q, setQ] = useState<{ quotes: Map<string, Quote>; asof: string }>({ quotes: new Map(), asof: '' });
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/yields.json`).then(r => (r.ok ? r.json() : null))
      .then((j: { meta?: { asof?: string }; yields?: Record<string, { price?: number | null; last?: number | null; fpy?: number | null }> } | null) => {
        const m = new Map<string, Quote>();
        for (const [k, v] of Object.entries(j?.yields ?? {})) if (v.price) m.set(k.toUpperCase(), { price: v.price, perYear: (v.last ?? 0) * (v.fpy ?? 0) });
        setQ({ quotes: m, asof: j?.meta?.asof ?? '' });
      }).catch(() => { /* 讀不到就只是沒有市值 */ });
  }, []);
  return q;
}

function useEtfNames(): Map<string, string> {
  const [m, setM] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/etfs.json`).then(r => (r.ok ? r.json() : null)).then((j: { etfs?: { code?: string; name?: string }[] } | null) => {
      const out = new Map<string, string>();
      for (const e of j?.etfs ?? []) if (e.code && e.name) out.set(e.code.toUpperCase(), e.name);
      setM(out);
    }).catch(() => { /* 只是自動帶名稱，讀不到不影響 */ });
  }, []);
  return m;
}

function Board({ loaded }: { loaded: Loaded }) {
  const [plans, setPlans] = useState<DcaPlan[]>(loaded.data.plans);
  const [holdings, setHoldings] = useState<DcaHolding[]>(loaded.data.holdings);
  const [hDraft, setHDraft] = useState<HDraft | null>(null);
  const [hDel, setHDel] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const { quotes, asof } = useQuotes();
  const [people, setPeople] = useState<string[]>(peopleOf(loaded.data));
  const [base, setBase] = useState<DcaData>(loaded.data);
  const [src, setSrc] = useState(loaded.src);
  const [who, setWho] = useState<string | null>(null);
  const today = new Date();
  const [ym, setYm] = useState({ y: today.getFullYear(), m: today.getMonth() + 1 });
  const [day, setDay] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const [newPerson, setNewPerson] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const etfNames = useEtfNames();

  const basePeople = peopleOf(base);
  const dirty = JSON.stringify(plans) !== JSON.stringify(base.plans) || JSON.stringify(people) !== JSON.stringify(basePeople)
    || JSON.stringify(holdings) !== JSON.stringify(base.holdings);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const total = useMemo(() => monthTotal(plans, who), [plans, who]);
  const brokers = useMemo(() => byBroker(plans, who), [plans, who]);
  const persons = useMemo(() => byPerson(plans), [plans]);
  const deds = useMemo(() => monthDeductions(plans, who, ym.y, ym.m), [plans, who, ym]);
  const next = useMemo(() => upcoming(plans, who, today, 6), [plans, who]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = plans.filter(p => who === null || p.who === who)
    .sort((a, b) => people.indexOf(a.who) - people.indexOf(b.who) || a.days[0] - b.days[0] || b.amount - a.amount);
  const nActive = shown.filter(p => !p.off).length;
  const colorOf = (w: string) => personColor(Math.max(0, people.indexOf(w)));

  const perDay = new Map<number, number>();
  for (const d of deds) perDay.set(d.day, (perDay.get(d.day) ?? 0) + d.amount);
  const first = new Date(ym.y, ym.m - 1, 1).getDay();
  const nDays = daysInMonth(ym.y, ym.m);
  const isThisMonth = ym.y === today.getFullYear() && ym.m === today.getMonth() + 1;
  const shift = (k: number) => { setDay(null); setYm(({ y, m }) => { const t = m + k; return { y: y + Math.floor((t - 1) / 12), m: ((t - 1) % 12 + 12) % 12 + 1 }; }); };

  const blank = (): Draft => ({ id: null, who: who ?? people[0] ?? '我', code: '', name: '', days: '', amount: '', broker: BROKERS[0], note: '' });
  const submit = () => {
    if (!draft) return;
    const amount = Number(draft.amount.replace(/,/g, ''));
    const days = parseDays(draft.days);
    const code = draft.code.trim().toUpperCase();
    const name = draft.name.trim() || etfNames.get(code) || code;
    if (!name) { setMsg('請輸入 ETF 代號或名稱。'); return; }
    if (!days) { setMsg('扣款日要是 1～31 的日子，可以填多天，例如 6、16、26。'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { setMsg('每次金額要大於 0。'); return; }
    const next: DcaPlan = {
      id: draft.id ?? newId(), who: draft.who.trim() || people[0] || '我', code, name, days, amount,
      broker: draft.broker.trim() || '未填',
      ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
      ...(draft.id && plans.find(x => x.id === draft.id)?.off ? { off: true } : {}),
    };
    if (!people.includes(next.who)) setPeople(ps => [...ps, next.who]);
    setPlans(xs => (draft.id ? xs.map(x => (x.id === draft.id ? next : x)) : [...xs, next]));
    setDraft(null); setMsg('');
  };
  const edit = (p: DcaPlan) => {
    setDel(null); setMsg('');
    setDraft({ id: p.id, who: p.who, code: p.code, name: p.name, days: p.days.join('、'), amount: String(p.amount), broker: p.broker, note: p.note ?? '' });
  };

  const save = async (force = false) => {
    setMsg(''); setConflict(null);
    if (!loaded.token) {
      setMsg(loaded.tokenState === 'error'
        ? '暫時讀不到同步權杖（GitHub 限制讀取次數），請過幾分鐘再按儲存；權杖已經設定好，不用重新貼。'
        : '還沒設定同步權杖：到配息頁按「⚙ 同步設定」貼一次就好（和私人持股共用同一把）。');
      return;
    }
    setBusy(true);
    try {
      if (!force) {
        const cur = await readEncrypted<unknown>(vault, FILE, loaded.token);
        const g = cur.data ? cleanDca(cur.data).generated : '';
        if (g && g !== base.generated) { setConflict(g); return; }
      }
      const data: DcaData = { v: 1, generated: nowStamp(), people, plans, holdings };
      await ghWrite(FILE, await vault.encryptJson(data), loaded.token, `資料：定期定額（網站儲存，${plans.length} 筆、持股 ${holdings.length} 筆，已加密）`);
      setBase(data); setSrc('api');
      setMsg(`已儲存（定期定額 ${plans.length} 筆、持股 ${holdings.length} 筆）。其他裝置重新整理這一頁就會看到。`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const tile = 'rounded-xl border border-line bg-surface px-3 py-2.5';
  const btn = 'h-9 rounded-lg px-2 text-[12.5px] font-semibold text-accent hover:underline disabled:opacity-40';
  const input = 'h-10 min-w-0 rounded-lg border border-line bg-bg px-2 text-base text-ink sm:text-[13px]';
  const chip = (on: boolean) => `h-8 rounded-full border px-3 text-[12.5px] ${on ? 'border-accent bg-accent text-accent-ink' : 'border-line text-muted hover:border-line-strong hover:text-ink'}`;
  const dayList = day === null ? [] : deds.filter(d => d.day === day);

  return (
    <div className="mt-4 min-w-0">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3">
        <h1 className="text-base font-bold text-ink">定期定額</h1>
        <Link to="/me" className="text-[12px] text-muted hover:text-ink">← 我的工具</Link>
      </div>
      <p className="text-[11.5px] text-faint">
        記每一筆定期定額：誰、哪一檔、每月幾號扣、每次多少、在哪家券商。資料用私人頁密碼加密後存在 GitHub，各裝置共用。
        {base.generated ? `最後儲存 ${base.generated}。` : '還沒有儲存過。'}
        {src && src !== 'api' && <span className="text-up">這次讀到的是備援版本，可能不是最新；過幾分鐘重新整理較保險。</span>}
      </p>

      {/* 角色切換 */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button type="button" className={chip(who === null)} onClick={() => setWho(null)}>全部</button>
        {people.map(p => (
          <button key={p} type="button" className={chip(who === p)} onClick={() => setWho(p)}>
            <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: colorOf(p) }} />{p}
          </button>
        ))}
        <button type="button" className="h-8 px-2 text-[12.5px] text-muted hover:text-ink" onClick={() => setManaging(m => !m)}>✎ 改名</button>
        {newPerson === null ? (
          <button type="button" className="h-8 px-2 text-[12.5px] text-muted hover:text-ink" onClick={() => setNewPerson('')}>＋ 新增對象</button>
        ) : (
          <form className="flex items-center gap-1" onSubmit={e => {
            e.preventDefault();
            const n = newPerson.trim();
            if (n && !people.includes(n)) { setPeople(ps => [...ps, n]); setWho(n); }
            setNewPerson(null);
          }}>
            <input className={`${input} h-8 w-28`} value={newPerson} onChange={e => setNewPerson(e.target.value)} placeholder="例如：老大" autoFocus />
            <button type="submit" className={btn}>加入</button>
            <button type="button" className="h-8 px-1 text-[12.5px] text-muted" onClick={() => setNewPerson(null)}>取消</button>
          </form>
        )}
      </div>

      {managing && (
        <PeopleEditor people={people} plans={plans} holdings={holdings} input={input} btn={btn}
                      onRename={(from, to) => {
                        const r = renamePerson({ people, plans, holdings }, from, to);
                        setPeople(r.people); setPlans(r.plans); setHoldings(r.holdings);
                        if (who === from) setWho(to.trim() || from);
                      }}
                      onDelete={n => { setPeople(ps => ps.filter(p => p !== n)); if (who === n) setWho(null); }}
                      onClose={() => setManaging(false)} />
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className={tile}><div className="text-[11.5px] text-muted">{who ?? '全部'}・每月定期定額</div><div className="font-mono text-lg font-bold text-ink">{money(total)}</div></div>
        <div className={tile}><div className="text-[11.5px] text-muted">一年合計</div><div className="font-mono text-lg font-bold text-ink">{money(total * 12)}</div></div>
        <div className={tile}><div className="text-[11.5px] text-muted">扣款中的檔數</div><div className="font-mono text-lg font-bold text-ink">{nActive}</div></div>
        <div className={tile}>
          <div className="text-[11.5px] text-muted">各券商每月</div>
          {brokers.length === 0 ? <div className="font-mono text-lg font-bold text-ink">—</div> : (
            <div className="mt-0.5 space-y-0.5 text-[12.5px]">
              {brokers.map(b => <div key={b.key} className="flex justify-between gap-2"><span className="text-ink">{b.key}</span><span className="font-mono text-ink">{money(b.monthly)}</span></div>)}
            </div>
          )}
        </div>
      </div>

      {who === null && persons.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted">
          {persons.map(p => (
            <span key={p.key}><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: colorOf(p.key) }} />{p.key} 每月 <span className="font-mono text-ink">{money(p.monthly)}</span>（{p.n} 筆）</span>
          ))}
        </div>
      )}

      {/* 行事曆 */}
      <section className="mt-4 rounded-xl border border-line bg-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-ink">扣款行事曆</h2>
          <div className="flex items-center gap-1 text-[12.5px]">
            <button type="button" className="h-8 w-8 rounded-lg text-muted hover:bg-hover" onClick={() => shift(-1)} aria-label="上個月">‹</button>
            <span className="min-w-[6.5rem] text-center font-semibold text-ink">{ym.y} 年 {ym.m} 月</span>
            <button type="button" className="h-8 w-8 rounded-lg text-muted hover:bg-hover" onClick={() => shift(1)} aria-label="下個月">›</button>
            {!isThisMonth && <button type="button" className="h-8 px-2 text-muted hover:text-ink" onClick={() => { setDay(null); setYm({ y: today.getFullYear(), m: today.getMonth() + 1 }); }}>本月</button>}
          </div>
        </div>
        <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[11px] text-muted">
          {WEEK.map(w => <div key={w}>{w}</div>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {Array.from({ length: first }, (_, i) => <div key={`b${i}`} />)}
          {Array.from({ length: nDays }, (_, i) => i + 1).map(d => {
            const amt = perDay.get(d) ?? 0;
            const whoHere = [...new Set(deds.filter(x => x.day === d).map(x => x.plan.who))];
            const isToday = isThisMonth && d === today.getDate();
            return (
              <button key={d} type="button" onClick={() => setDay(day === d ? null : d)}
                      className={`flex min-h-[3.4rem] min-w-0 flex-col items-stretch rounded-md border px-0.5 py-0.5 text-left ${day === d ? 'border-line-strong bg-sunken' : amt > 0 ? 'border-line bg-bg hover:bg-hover' : 'border-transparent hover:bg-hover'}`}>
                <span className={`text-[11px] ${isToday ? 'font-bold text-accent' : 'text-muted'}`}>{d}</span>
                {amt > 0 && (
                  <>
                    <span className="truncate font-mono text-[10.5px] font-semibold text-ink sm:text-[12px]">{amt >= 10000 ? `${(amt / 10000).toFixed(amt % 10000 ? 1 : 0)}萬` : money(amt)}</span>
                    <span className="mt-auto flex gap-0.5">{whoHere.map(w => <span key={w} className="h-1.5 w-1.5 rounded-full" style={{ background: colorOf(w) }} />)}</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-3 border-t border-line pt-2">
          {day === null ? (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-bold text-ink">{isThisMonth ? '接下來的扣款' : `${ym.m} 月的扣款`}</span>
                <span className="font-mono text-[13px] font-bold text-ink">本月合計 {money(deds.reduce((a, x) => a + x.amount, 0))}</span>
              </div>
              <DedList list={isThisMonth ? next : deds} colorOf={colorOf} showDate />
              <p className="mt-1 text-[11px] text-faint">點行事曆的某一天看當天明細。設定的扣款日這個月沒有（例如 31 日）就算月底；遇到假日券商會順延到下一個營業日。</p>
            </>
          ) : (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-bold text-ink">{ym.m} 月 {day} 日</span>
                <span className="font-mono text-[13px] font-bold text-ink">{money(perDay.get(day) ?? 0)}</span>
              </div>
              {dayList.length === 0 ? <p className="text-[12px] text-faint">這天沒有扣款。</p> : <DedList list={dayList} colorOf={colorOf} />}
            </>
          )}
        </div>
      </section>

      {/* 清單 */}
      <section className="mt-4 rounded-xl border border-line bg-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-ink">定期定額（{shown.length}）</h2>
          <button type="button" className={btn} onClick={() => { setDel(null); setMsg(''); setDraft(blank()); }}>＋ 新增</button>
        </div>
        {draft && !draft.id && <PlanForm draft={draft} setDraft={setDraft} people={people} etfNames={etfNames} onOk={submit} onCancel={() => setDraft(null)} input={input} btn={btn} />}
        {shown.length === 0 && !draft && <p className="mt-3 text-[12.5px] text-muted">還沒有紀錄。按「＋ 新增」開始。</p>}
        <ul className="mt-2 divide-y divide-line">
          {shown.map(p => draft?.id === p.id ? (
            <li key={p.id} className="py-1">
              <PlanForm draft={draft} setDraft={setDraft} people={people} etfNames={etfNames} onOk={submit} onCancel={() => setDraft(null)} input={input} btn={btn} />
            </li>
          ) : (
            <li key={p.id} className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 ${p.off ? 'opacity-50' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-ink">
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: colorOf(p.who) }} />
                  {p.code && <span className="mr-1 font-mono text-muted">{p.code}</span>}{p.name}
                  <span className="ml-1.5 rounded bg-sunken px-1.5 py-0.5 text-[11px] text-muted">{p.broker}</span>
                  <span className="ml-1 text-[11px] text-faint">{p.who}</span>
                  {p.off && <span className="ml-1.5 text-[11px] text-faint">暫停中・不算進合計</span>}
                </div>
                <div className="flex flex-wrap gap-x-2.5 text-[11.5px] text-muted">
                  <span>{daysText(p.days)}，每次 <span className="font-mono text-ink">{money(p.amount)}</span></span>
                  <span>每月 <span className="font-mono">{money(monthlyOf(p))}</span></span>
                  <span>一年 <span className="font-mono">{money(monthlyOf(p) * 12)}</span></span>
                </div>
                {p.note && <div className="text-[11px] text-faint">{p.note}</div>}
              </div>
              <div className="flex shrink-0 items-center">
                {del === p.id ? (
                  <>
                    <span className="text-[12px] text-ink">刪除？</span>
                    <button type="button" className="h-9 px-2 text-[12.5px] font-semibold text-up" onClick={() => { setPlans(xs => xs.filter(y => y.id !== p.id)); setDel(null); }}>確定</button>
                    <button type="button" className="h-9 px-2 text-[12.5px] text-muted" onClick={() => setDel(null)}>取消</button>
                  </>
                ) : (
                  <>
                    <button type="button" className={btn} onClick={() => edit(p)}>編輯</button>
                    <button type="button" className="h-9 px-2 text-[12.5px] text-muted hover:text-ink"
                            onClick={() => setPlans(xs => xs.map(y => (y.id === p.id ? { ...y, off: y.off ? undefined : true } : y)))}>{p.off ? '恢復' : '暫停'}</button>
                    <button type="button" className="h-9 px-2 text-[12.5px] text-muted hover:text-ink" onClick={() => { setDraft(null); setDel(p.id); }}>刪除</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <HoldingsSection people={people} who={who} holdings={holdings} quotes={quotes} asof={asof} etfNames={etfNames}
                       draft={hDraft} setDraft={setHDraft} del={hDel} setDel={setHDel} colorOf={colorOf} input={input} btn={btn}
                       onSave={h => {
                         if (!people.includes(h.who)) setPeople(ps => [...ps, h.who]);
                         setHoldings(xs => (xs.some(x => x.id === h.id) ? xs.map(x => (x.id === h.id ? h : x)) : [...xs, h]));
                       }}
                       onDelete={id => setHoldings(xs => xs.filter(x => x.id !== id))} setMsg={setMsg} />

      <Compare people={people} holdings={holdings} plans={plans} quotes={quotes} asof={asof} colorOf={colorOf} />

      {(dirty || msg || conflict) && (
        // 右邊留給全站的「↑」回頂端按鈕，不要疊在一起
        <div className="sticky bottom-3 z-10 mr-14 mt-4 rounded-xl border border-line-strong bg-surface p-3 shadow-lg">
          {conflict ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
              <span className="text-ink">別的裝置在 {conflict} 存過一版，比這裡載入的新。用這裡的內容覆蓋？</span>
              <button type="button" className="h-9 px-2 font-semibold text-up" disabled={busy} onClick={() => save(true)}>覆蓋</button>
              <button type="button" className="h-9 px-2 text-muted" onClick={() => { setConflict(null); setMsg('沒有儲存。重新整理這一頁可以載入那一版（這裡的修改會不見）。'); }}>取消</button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {dirty && <span className="text-[12.5px] font-semibold text-ink">有修改還沒儲存</span>}
              {dirty && <button type="button" className="h-9 rounded-lg bg-accent px-4 text-[13px] font-semibold text-accent-ink disabled:opacity-50"
                                disabled={busy} onClick={() => save()}>{busy ? '儲存中…' : '☁ 儲存'}</button>}
              {dirty && <button type="button" className="h-9 px-2 text-[12.5px] text-muted hover:text-ink" disabled={busy}
                                onClick={() => { setPlans(base.plans); setHoldings(base.holdings); setPeople(basePeople); setDraft(null); setHDraft(null); setDel(null); setHDel(null); setMsg(''); }}>放棄修改</button>}
            </div>
          )}
          {msg && <p className="mt-1 text-[12px] text-muted">{msg}</p>}
        </div>
      )}
    </div>
  );
}

function DedList({ list, colorOf, showDate }: { list: { plan: DcaPlan; date: string; amount: number }[]; colorOf: (w: string) => string; showDate?: boolean }) {
  if (list.length === 0) return <p className="text-[12px] text-faint">沒有扣款。</p>;
  return (
    <ul className="mt-1 space-y-0.5 text-[12.5px]">
      {list.map((d, i) => (
        <li key={`${d.plan.id}-${d.date}-${i}`} className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-ink">
            {showDate && <span className="mr-1.5 font-mono text-[11.5px] text-muted">{d.date.slice(5).replace('-', '/')}</span>}
            <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: colorOf(d.plan.who) }} />
            {d.plan.code && <span className="mr-1 font-mono text-muted">{d.plan.code}</span>}{d.plan.name}
            <span className="ml-1.5 text-[11px] text-faint">{d.plan.who}・{d.plan.broker}</span>
          </span>
          <span className="shrink-0 font-mono text-muted">{money(d.amount)}</span>
        </li>
      ))}
    </ul>
  );
}

function PlanForm({ draft, setDraft, people, etfNames, onOk, onCancel, input, btn }: {
  draft: Draft; setDraft: (d: Draft) => void; people: string[]; etfNames: Map<string, string>; onOk: () => void; onCancel: () => void; input: string; btn: string;
}) {
  const set = (p: Partial<Draft>) => setDraft({ ...draft, ...p });
  const onCode = (v: string) => {
    const c = v.trim().toUpperCase();
    const n = etfNames.get(c);
    set({ code: v, ...(n && (!draft.name || draft.name === etfNames.get(draft.code.trim().toUpperCase())) ? { name: n } : {}) });
  };
  return (
    <form className="mt-2 rounded-lg border border-line bg-bg p-2" onSubmit={e => { e.preventDefault(); onOk(); }}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        <label className="flex flex-col text-[11.5px] text-muted">對象
          <input className={input} value={draft.who} onChange={e => set({ who: e.target.value })} list="dca-people" />
          <datalist id="dca-people">{people.map(p => <option key={p} value={p} />)}</datalist>
        </label>
        <label className="flex flex-col text-[11.5px] text-muted">ETF 代號
          <input className={`${input} font-mono`} value={draft.code} onChange={e => onCode(e.target.value)} placeholder="例如 0050" autoFocus />
        </label>
        <label className="col-span-2 flex flex-col text-[11.5px] text-muted">名稱
          <input className={input} value={draft.name} onChange={e => set({ name: e.target.value })} placeholder="輸入代號會自動帶出" />
        </label>
        <label className="flex flex-col text-[11.5px] text-muted">券商
          <input className={input} value={draft.broker} onChange={e => set({ broker: e.target.value })} list="dca-brokers" />
          <datalist id="dca-brokers">{BROKERS.map(b => <option key={b} value={b} />)}</datalist>
        </label>
        <label className="flex flex-col text-[11.5px] text-muted">每次金額
          <input className={`${input} font-mono`} value={draft.amount} onChange={e => set({ amount: e.target.value })} inputMode="numeric" placeholder="3000" />
        </label>
        <label className="col-span-2 flex flex-col text-[11.5px] text-muted sm:col-span-3">扣款日（每月，可多天）
          <input className={`${input} font-mono`} value={draft.days} onChange={e => set({ days: e.target.value })} inputMode="numeric" placeholder="例如：6、16、26" />
        </label>
        <label className="col-span-2 flex flex-col text-[11.5px] text-muted sm:col-span-3">備註（可不填）
          <input className={input} value={draft.note} onChange={e => set({ note: e.target.value })} />
        </label>
      </div>
      <div className="mt-1 flex justify-end gap-1">
        <button type="button" className="h-9 px-2 text-[12.5px] text-muted hover:text-ink" onClick={onCancel}>取消</button>
        <button type="submit" className={btn}>{draft.id ? '確定修改' : '加入'}</button>
      </div>
    </form>
  );
}

// ───── 對象改名／刪除 ─────

function PeopleEditor({ people, plans, holdings, input, btn, onRename, onDelete, onClose }: {
  people: string[]; plans: DcaPlan[]; holdings: DcaHolding[]; input: string; btn: string;
  onRename: (from: string, to: string) => void; onDelete: (n: string) => void; onClose: () => void;
}) {
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(people.map(p => [p, p])));
  return (
    <div className="mt-2 rounded-lg border border-line bg-bg p-2">
      <p className="text-[11.5px] text-muted">改名會連同這個人的定期定額與持股一起改；改成已經有的名字＝合併。有紀錄的對象不能刪除。</p>
      <ul className="mt-1 space-y-1">
        {people.map(p => {
          const used = plans.some(x => x.who === p) || holdings.some(x => x.who === p);
          return (
            <li key={p} className="flex flex-wrap items-center gap-1.5">
              <input className={`${input} h-8 w-32`} value={names[p] ?? p} onChange={e => setNames(n => ({ ...n, [p]: e.target.value }))} />
              <button type="button" className={btn} disabled={!(names[p] ?? '').trim() || names[p] === p} onClick={() => onRename(p, names[p])}>改名</button>
              <button type="button" className="h-9 px-2 text-[12.5px] text-muted hover:text-ink disabled:opacity-40" disabled={used}
                      title={used ? '這個人還有定期定額或持股紀錄' : ''} onClick={() => onDelete(p)}>刪除</button>
            </li>
          );
        })}
      </ul>
      <div className="mt-1 text-right"><button type="button" className="h-8 px-2 text-[12.5px] text-muted hover:text-ink" onClick={onClose}>完成</button></div>
    </div>
  );
}

// ───── 持股（2026-11-02：記錄兩個小孩的持股）─────

type HDraft = { id: string | null; who: string; code: string; name: string; shares: string; cost: string };

function HoldingsSection({ people, who, holdings, quotes, asof, etfNames, draft, setDraft, del, setDel, colorOf, input, btn, onSave, onDelete, setMsg }: {
  people: string[]; who: string | null; holdings: DcaHolding[]; quotes: Map<string, Quote>; asof: string; etfNames: Map<string, string>;
  draft: HDraft | null; setDraft: (d: HDraft | null) => void; del: string | null; setDel: (id: string | null) => void;
  colorOf: (w: string) => string; input: string; btn: string; onSave: (h: DcaHolding) => void; onDelete: (id: string) => void; setMsg: (m: string) => void;
}) {
  const shown = holdings.filter(h => who === null || h.who === who)
    .sort((a, b) => people.indexOf(a.who) - people.indexOf(b.who) || (b.shares * (quotes.get(b.code)?.price ?? 0)) - (a.shares * (quotes.get(a.code)?.price ?? 0)));
  const kid = who ?? people.find(p => p !== '我') ?? people[0] ?? '我';
  const blank = (): HDraft => ({ id: null, who: kid, code: '', name: '', shares: '', cost: '' });
  const submit = () => {
    if (!draft) return;
    const code = draft.code.trim().toUpperCase();
    const name = draft.name.trim() || etfNames.get(code) || code;
    const shares = Number(draft.shares.replace(/,/g, ''));
    const cost = draft.cost.trim() === '' ? undefined : Number(draft.cost.replace(/,/g, ''));
    if (!name) { setMsg('請輸入代號或名稱。'); return; }
    if (!Number.isFinite(shares) || shares <= 0) { setMsg('股數要大於 0（1 張＝1,000 股）。'); return; }
    if (cost !== undefined && (!Number.isFinite(cost) || cost < 0)) { setMsg('投入成本要是 0 以上的數字，不知道可以空白。'); return; }
    onSave({ id: draft.id ?? newId(), who: draft.who.trim() || kid, code, name, shares, ...(cost !== undefined ? { cost } : {}) });
    setDraft(null); setMsg('');
  };
  const form = (d: HDraft) => {
    const set = (p: Partial<HDraft>) => setDraft({ ...d, ...p });
    return (
      <form className="mt-2 rounded-lg border border-line bg-bg p-2" onSubmit={e => { e.preventDefault(); submit(); }}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <label className="flex flex-col text-[11.5px] text-muted">對象
            <input className={input} value={d.who} onChange={e => set({ who: e.target.value })} list="dca-people" />
          </label>
          <label className="flex flex-col text-[11.5px] text-muted">代號
            <input className={`${input} font-mono`} value={d.code} autoFocus placeholder="例如 0050"
                   onChange={e => { const c = e.target.value.trim().toUpperCase(); const n = etfNames.get(c); set({ code: e.target.value, ...(n ? { name: n } : {}) }); }} />
          </label>
          <label className="col-span-2 flex flex-col text-[11.5px] text-muted sm:col-span-1">名稱
            <input className={input} value={d.name} onChange={e => set({ name: e.target.value })} placeholder="輸入代號會自動帶出" />
          </label>
          <label className="flex flex-col text-[11.5px] text-muted">股數（1 張＝1,000）
            <input className={`${input} font-mono`} value={d.shares} onChange={e => set({ shares: e.target.value })} inputMode="numeric" />
          </label>
          <label className="flex flex-col text-[11.5px] text-muted">投入成本（元，可空白）
            <input className={`${input} font-mono`} value={d.cost} onChange={e => set({ cost: e.target.value })} inputMode="numeric" />
          </label>
        </div>
        <div className="mt-1 flex justify-end gap-1">
          <button type="button" className="h-9 px-2 text-[12.5px] text-muted hover:text-ink" onClick={() => setDraft(null)}>取消</button>
          <button type="submit" className={btn}>{d.id ? '確定修改' : '加入'}</button>
        </div>
      </form>
    );
  };
  return (
    <section className="mt-4 rounded-xl border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-ink">持股（{shown.length}）</h2>
        <button type="button" className={btn} onClick={() => { setDel(null); setMsg(''); setDraft(blank()); }}>＋ 新增持股</button>
      </div>
      <p className="text-[11px] text-faint">市值用網站收盤價{asof ? `（${asof}）` : ''}；年配息用最近一次配息 × 一年配幾次估。網站沒有報價的代號不算市值。</p>
      {draft && !draft.id && form(draft)}
      {shown.length === 0 && !draft && <p className="mt-2 text-[12.5px] text-muted">還沒有持股。按「＋ 新增持股」記下每個人目前持有的 ETF 與股數。</p>}
      <ul className="mt-1 divide-y divide-line">
        {shown.map(h => {
          if (draft?.id === h.id) return <li key={h.id} className="py-1">{form(draft)}</li>;
          const q = quotes.get(h.code);
          const mv = q ? h.shares * q.price : null;
          const pnl = mv !== null && h.cost !== undefined ? mv - h.cost : null;
          return (
            <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-ink">
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: colorOf(h.who) }} />
                  {h.code && <span className="mr-1 font-mono text-muted">{h.code}</span>}{h.name}<span className="ml-1.5 text-[11px] text-faint">{h.who}</span>
                </div>
                <div className="flex flex-wrap gap-x-2.5 text-[11.5px] text-muted">
                  <span><span className="font-mono text-ink">{money(h.shares)}</span> 股（{(h.shares / 1000).toFixed(h.shares % 1000 ? 3 : 0)} 張）</span>
                  {mv !== null ? <span>市值 <span className="font-mono text-ink">{money(mv)}</span></span> : <span className="text-faint">沒有報價</span>}
                  {h.cost !== undefined && <span>成本 <span className="font-mono">{money(h.cost)}</span></span>}
                  {pnl !== null && h.cost! > 0 && <span className={pnl >= 0 ? 'text-up' : 'text-down'}>{pnl >= 0 ? '+' : ''}{money(pnl)}（{((pnl / h.cost!) * 100).toFixed(1)}%）</span>}
                  {q && q.perYear > 0 && <span>年配息約 <span className="font-mono">{money(h.shares * q.perYear)}</span></span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center">
                {del === h.id ? (
                  <>
                    <span className="text-[12px] text-ink">刪除？</span>
                    <button type="button" className="h-9 px-2 text-[12.5px] font-semibold text-up" onClick={() => { onDelete(h.id); setDel(null); }}>確定</button>
                    <button type="button" className="h-9 px-2 text-[12.5px] text-muted" onClick={() => setDel(null)}>取消</button>
                  </>
                ) : (
                  <>
                    <button type="button" className={btn} onClick={() => { setDel(null); setMsg(''); setDraft({ id: h.id, who: h.who, code: h.code, name: h.name, shares: String(h.shares), cost: h.cost === undefined ? '' : String(h.cost) }); }}>編輯</button>
                    <button type="button" className="h-9 px-2 text-[12.5px] text-muted hover:text-ink" onClick={() => { setDraft(null); setDel(h.id); }}>刪除</button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ───── 兩人比較（2026-11-02：知道兩個小孩目前的差異）─────

function Compare({ people, holdings, plans, quotes, asof, colorOf }: {
  people: string[]; holdings: DcaHolding[]; plans: DcaPlan[]; quotes: Map<string, Quote>; asof: string; colorOf: (w: string) => string;
}) {
  const kids = people.filter(p => p !== '我');
  const [a, setA] = useState(kids[0] ?? people[0] ?? '');
  const [b, setB] = useState(kids[1] ?? people[1] ?? '');
  if (people.length < 2) return null;
  const A = summarize(a, holdings, plans, quotes), B = summarize(b, holdings, plans, quotes);
  const cmp = compareHoldings(A, B);
  const ret = (s: PersonSummary) => (s.cost > 0 ? (s.mvWithCost - s.cost) / s.cost : null);
  const rows: [string, (s: PersonSummary) => string, (s: PersonSummary) => number | null][] = [
    ['持股市值', s => money(s.mv), s => s.mv],
    ['投入成本（有填的）', s => (s.cost > 0 ? money(s.cost) : '—'), s => (s.cost > 0 ? s.cost : null)],
    ['損益', s => (s.cost > 0 ? `${s.mvWithCost - s.cost >= 0 ? '+' : ''}${money(s.mvWithCost - s.cost)}` : '—'), s => (s.cost > 0 ? s.mvWithCost - s.cost : null)],
    ['報酬率', s => { const r = ret(s); return r === null ? '—' : `${(r * 100).toFixed(1)}%`; }, s => ret(s)],
    ['預估年配息', s => money(s.div), s => s.div],
    ['每月定期定額', s => money(s.monthly), s => s.monthly],
    ['持有檔數', s => String(s.n), s => s.n],
    ['一年後累計投入（成本＋12 個月定期定額）', s => money(s.cost + s.monthly * 12), s => s.cost + s.monthly * 12],
  ];
  const sel = 'h-8 rounded-lg border border-line bg-bg px-2 text-[13px] text-ink';
  const diff = A.mv - B.mv;
  return (
    <section className="mt-4 rounded-xl border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-ink">兩人比較</h2>
        <div className="flex items-center gap-1.5 text-[12.5px] text-muted">
          <select className={sel} value={a} onChange={e => setA(e.target.value)}>{people.map(p => <option key={p} value={p}>{p}</option>)}</select>
          <span>vs</span>
          <select className={sel} value={b} onChange={e => setB(e.target.value)}>{people.map(p => <option key={p} value={p}>{p}</option>)}</select>
        </div>
      </div>
      {A.mv + B.mv > 0 && (
        <p className="mt-1 text-[12.5px] text-ink">
          目前 {diff === 0 ? '兩人市值一樣' : <>{diff > 0 ? a : b} 的市值多 <span className="font-mono font-semibold">{money(Math.abs(diff))}</span> 元</>}
          {A.monthly !== B.monthly && <>；每月定期定額 {A.monthly > B.monthly ? a : b} 多 <span className="font-mono font-semibold">{money(Math.abs(A.monthly - B.monthly))}</span> 元</>}。
        </p>
      )}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead><tr className="text-left text-[11px] text-muted">
            <th className="py-1 pr-2 font-normal">項目</th>
            <th className="py-1 pr-2 text-right font-normal"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: colorOf(a) }} />{a}</th>
            <th className="py-1 pr-2 text-right font-normal"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: colorOf(b) }} />{b}</th>
            <th className="py-1 text-right font-normal">差距（{a}−{b}）</th>
          </tr></thead>
          <tbody>
            {rows.map(([label, fmt, val]) => {
              const x = val(A), y = val(B);
              const d = x !== null && y !== null ? x - y : null;
              const isPct = label === '報酬率';
              return (
                <tr key={label} className="border-t border-line">
                  <td className="py-1 pr-2 text-ink">{label}</td>
                  <td className="py-1 pr-2 text-right font-mono text-ink">{fmt(A)}</td>
                  <td className="py-1 pr-2 text-right font-mono text-ink">{fmt(B)}</td>
                  <td className={`py-1 text-right font-mono ${d === null || d === 0 ? 'text-muted' : d > 0 ? 'text-up' : 'text-down'}`}>
                    {d === null ? '—' : isPct ? `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)} 點` : `${d >= 0 ? '+' : ''}${money(d)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {cmp.rows.length > 0 && (
        <>
          <h3 className="mt-3 text-[13px] font-bold text-ink">逐檔對照</h3>
          <p className="text-[11.5px] text-muted">
            兩人都有 {cmp.both} 檔
            {cmp.onlyA.length > 0 && <>；只有{a}有：{cmp.onlyA.join('、')}</>}
            {cmp.onlyB.length > 0 && <>；只有{b}有：{cmp.onlyB.join('、')}</>}
          </p>
          <div className="mt-1 overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-[11px] text-muted">
                <th className="py-1 pr-2 font-normal">ETF</th>
                <th className="py-1 pr-2 text-right font-normal">{a} 股數／市值／占比</th>
                <th className="py-1 text-right font-normal">{b} 股數／市值／占比</th>
              </tr></thead>
              <tbody>
                {cmp.rows.map(r => (
                  <tr key={r.code} className="border-t border-line">
                    <td className="py-1 pr-2 text-ink"><span className="font-mono text-muted">{r.code}</span> {r.name}</td>
                    {[r.a, r.b].map((x, i) => (
                      <td key={i} className="py-1 pr-2 text-right font-mono text-ink">
                        {x ? <>{money(x.shares)}<span className="text-muted">／{x.mv > 0 ? money(x.mv) : '—'}／{(x.share * 100).toFixed(0)}%</span></> : <span className="text-faint">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {(A.noQuote.length > 0 || B.noQuote.length > 0) && (
        <p className="mt-1 text-[11px] text-faint">沒有報價、市值沒算進去：{[...A.noQuote, ...B.noQuote].join('、')}</p>
      )}
      <p className="mt-1 text-[11px] text-faint">市值與年配息用網站收盤價{asof ? `（${asof}）` : ''}與最近一次配息估；報酬率只算有填成本的持股。</p>
    </section>
  );
}
