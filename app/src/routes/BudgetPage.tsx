/* 支出預估（#/budget，私人頁，密碼同 v18；2026-11-01 使用者要求）：記錄每月／每年的各種開銷、可新增修改，
 * 看每個月可能要付多少、預抓一年的花費。計算都在 lib/budget.ts。
 *
 * 資料：app/public/data/holdings/budget.enc（用私人頁密碼加密），和私人持股一樣由瀏覽器直接讀寫 GitHub（lib/ghSync.ts），
 * 寫入用同一把同步權杖（配息頁「⚙ 同步設定」設定一次），所以各裝置共用、不用等網站部署。
 * 修改先留在畫面上，按「儲存」才寫回；別的裝置在這之間存過，會先問要不要覆蓋。
 * 解鎖沿用私人頁的工作階段（holdings 與 v18 同一個 salt），6 小時後上鎖；上鎖時有沒存的修改會先提醒。
 * 版面（手機 390px）：月份長條用 flex 等分、表格放 overflow-x-auto（見記憶 taiwanetf-mobile-layout）。 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Vault, type VaultManifest } from '../lib/vault';
import { useVaultExpiry } from '../hooks/useVaultExpiry';
import { Locked } from './QBPage';
import { ghWrite, readEncrypted, readToken, type Src } from '../lib/ghSync';
import {
  byCategory, categories, cleanBudget, EVERY, monthTotals, newId, paysIn, perYear, PRESETS, scheduleText, yearTotal,
  type BudgetData, type BudgetItem, type Every,
} from '../lib/budget';

const vault = new Vault(`${import.meta.env.BASE_URL}data/holdings/`, 'twetf.v18.unlock');
const FILE = 'budget.enc';

const nf = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const money = (v: number) => nf.format(Math.round(v));

function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

interface Loaded { data: BudgetData; src: Src | null; token: string | null; tokenState: 'ok' | 'none' | 'error' }

export function BudgetPage() {
  const [manifest, setManifest] = useState<VaultManifest | null>(null);
  const [state, setState] = useState<'loading' | 'missing' | 'locked' | 'ready' | 'error'>('loading');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [msg, setMsg] = useState('');
  const load = async () => {
    try {
      setState('loading');
      const tk = await readToken(vault);
      const r = await readEncrypted<unknown>(vault, FILE, tk.token);
      if (!r.data && !r.missing) throw new Error('暫時讀不到支出資料（GitHub 限制讀取次數），請過幾分鐘再重新整理');
      setLoaded({ data: cleanBudget(r.data), src: r.src, token: tk.token, tokenState: tk.state });
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
  if (state === 'locked' && manifest) return <Locked vault={vault} title="支出預估" manifest={manifest} onUnlock={load} />;
  if (state === 'error' || !loaded) return <p className="py-16 text-center text-[13px] text-down">載入失敗：{msg}</p>;
  return <Board loaded={loaded} />;
}

type Draft = { id: string | null; name: string; cat: string; amount: string; every: Every; month: number; note: string };
const blank = (): Draft => ({ id: null, name: '', cat: '其他', amount: '', every: 1, month: new Date().getMonth() + 1, note: '' });

function Board({ loaded }: { loaded: Loaded }) {
  const [items, setItems] = useState<BudgetItem[]>(loaded.data.items);
  const [base, setBase] = useState<BudgetData>(loaded.data);
  const [src, setSrc] = useState(loaded.src);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const dirty = JSON.stringify(items) !== JSON.stringify(base.items);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const months = useMemo(() => monthTotals(items), [items]);
  const total = useMemo(() => yearTotal(items), [items]);
  const cats = useMemo(() => byCategory(items), [items]);
  const catList = useMemo(() => categories(items), [items]);
  const peak = months.reduce((a, x) => (x.total > a.total ? x : a), months[0]);
  const fixed = months[0].fixed;
  const max = Math.max(1, ...months.map(x => x.total));
  const inMonth = items.filter(x => !x.off && paysIn(x, month)).sort((a, b) => b.amount - a.amount);
  const sorted = useMemo(() => [...items].sort((a, b) =>
    catList.indexOf(a.cat) - catList.indexOf(b.cat) || perYear(b) - perYear(a)), [items, catList]);
  const presets = PRESETS.filter(p => !items.some(x => x.name === p.name));

  const submit = () => {
    if (!draft) return;
    const amount = Number(draft.amount.replace(/,/g, ''));
    if (!draft.name.trim()) { setMsg('請輸入項目名稱。'); return; }
    if (!Number.isFinite(amount) || amount < 0) { setMsg('金額要是 0 以上的數字。'); return; }
    const next: BudgetItem = {
      id: draft.id ?? newId(), name: draft.name.trim(), cat: draft.cat.trim() || '其他', amount,
      every: draft.every, month: draft.month,
      ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
      ...(draft.id && items.find(x => x.id === draft.id)?.off ? { off: true } : {}),
    };
    setItems(xs => (draft.id ? xs.map(x => (x.id === draft.id ? next : x)) : [...xs, next]));
    setDraft(null); setMsg('');
  };

  const edit = (x: BudgetItem) => {
    setDel(null); setMsg('');
    setDraft({ id: x.id, name: x.name, cat: x.cat, amount: String(x.amount), every: x.every, month: x.month, note: x.note ?? '' });
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
        const g = cur.data ? cleanBudget(cur.data).generated : '';
        if (g && g !== base.generated) { setConflict(g); return; }
      }
      const data: BudgetData = { v: 1, generated: nowStamp(), items };
      await ghWrite(FILE, await vault.encryptJson(data), loaded.token, `資料：支出預估（網站儲存，${items.length} 項，已加密）`);
      setBase(data); setSrc('api');
      setMsg(`已儲存（${items.length} 項）。其他裝置重新整理這一頁就會看到。`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const tile = 'rounded-xl border border-line bg-surface px-3 py-2.5';
  const btn = 'h-9 rounded-lg px-2 text-[12.5px] font-semibold text-accent hover:underline disabled:opacity-40';
  const input = 'h-10 min-w-0 rounded-lg border border-line bg-bg px-2 text-base text-ink sm:text-[13px]';

  return (
    <div className="mt-4 min-w-0">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3">
        <h1 className="text-base font-bold text-ink">支出預估</h1>
        <Link to="/me" className="text-[12px] text-muted hover:text-ink">← 我的工具</Link>
      </div>
      <p className="text-[11.5px] text-faint">
        每一項記一次金額與多久付一次，自動攤到 12 個月。資料用私人頁密碼加密後存在 GitHub，各裝置共用。
        {base.generated ? `最後儲存 ${base.generated}。` : '還沒有儲存過。'}
        {src && src !== 'api' && <span className="text-up">這次讀到的是備援版本，可能不是最新；過幾分鐘重新整理較保險。</span>}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className={tile}><div className="text-[11.5px] text-muted">全年預估</div><div className="font-mono text-lg font-bold text-ink">{money(total)}</div></div>
        <div className={tile}><div className="text-[11.5px] text-muted">平均每月</div><div className="font-mono text-lg font-bold text-ink">{money(total / 12)}</div></div>
        <div className={tile}><div className="text-[11.5px] text-muted">每月固定</div><div className="font-mono text-lg font-bold text-ink">{money(fixed)}</div></div>
        <div className={tile}>
          <div className="text-[11.5px] text-muted">最多的月份</div>
          <div className="font-mono text-lg font-bold text-ink">{peak.total > 0 ? <>{peak.m} 月 <span className="text-[13px]">{money(peak.total)}</span></> : '—'}</div>
        </div>
      </div>

      <section className="mt-4 rounded-xl border border-line bg-surface p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 className="text-sm font-bold text-ink">每月要付多少</h2>
          <span className="text-[11px] text-faint">
            <span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: 'var(--cat-1)' }} />每月固定
            <span className="ml-3 mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: 'var(--cat-4)' }} />集中在某幾個月的
          </span>
        </div>
        <div className="mt-2 flex h-36 items-end gap-1" role="list" aria-label="各月支出">
          {months.map(x => (
            <button key={x.m} type="button" role="listitem" onClick={() => setMonth(x.m)}
                    title={`${x.m} 月 ${money(x.total)}`}
                    className={`flex h-full min-w-0 flex-1 flex-col justify-end rounded-md px-0.5 ${month === x.m ? 'bg-sunken ring-1 ring-line-strong' : 'hover:bg-hover'}`}>
              <div className="w-full rounded-t-sm" style={{ height: `${((x.total - x.fixed) / max) * 100}%`, background: 'var(--cat-4)' }} />
              <div className="w-full" style={{ height: `${(x.fixed / max) * 100}%`, background: 'var(--cat-1)' }} />
            </button>
          ))}
        </div>
        <div className="mt-1 flex gap-1 text-center text-[11px] text-muted">
          {months.map(x => <div key={x.m} className="min-w-0 flex-1">{x.m}</div>)}
        </div>

        <div className="mt-3 border-t border-line pt-2">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] font-bold text-ink">{month} 月要付</span>
            <span className="font-mono text-[13px] font-bold text-ink">{money(months[month - 1].total)}</span>
          </div>
          {inMonth.length === 0 ? <p className="text-[12px] text-faint">這個月沒有要付的項目。</p> : (
            <ul className="mt-1 space-y-0.5 text-[12.5px]">
              {inMonth.map(x => (
                <li key={x.id} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-ink">{x.name}<span className="ml-1.5 text-[11px] text-faint">{x.cat}・{x.every === 1 ? '每月' : scheduleText(x)}</span></span>
                  <span className="shrink-0 font-mono text-muted">{money(x.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {cats.length > 0 && (
        <section className="mt-4 rounded-xl border border-line bg-surface p-3">
          <h2 className="text-sm font-bold text-ink">分類</h2>
          <div className="mt-1 overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-[11px] text-muted">
                <th className="py-1 pr-2 font-normal">分類</th><th className="py-1 pr-2 text-right font-normal">全年</th>
                <th className="py-1 pr-2 text-right font-normal">平均每月</th><th className="w-1/3 py-1 font-normal">占比</th>
              </tr></thead>
              <tbody>
                {cats.map(c => (
                  <tr key={c.cat} className="border-t border-line">
                    <td className="py-1 pr-2 text-ink">{c.cat}<span className="ml-1 text-[11px] text-faint">{c.n} 項</span></td>
                    <td className="py-1 pr-2 text-right font-mono text-ink">{money(c.year)}</td>
                    <td className="py-1 pr-2 text-right font-mono text-muted">{money(c.year / 12)}</td>
                    <td className="py-1">
                      <div className="flex items-center gap-1.5">
                        <div className="h-2 min-w-0 flex-1 rounded-sm bg-sunken">
                          <div className="h-2 rounded-sm" style={{ width: `${c.share * 100}%`, background: 'var(--cat-1)' }} />
                        </div>
                        <span className="w-10 shrink-0 text-right font-mono text-[11px] text-muted">{(c.share * 100).toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="mt-4 rounded-xl border border-line bg-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-ink">項目（{items.length}）</h2>
          <button type="button" className={btn} onClick={() => { setDel(null); setMsg(''); setDraft(blank()); }}>＋ 新增項目</button>
        </div>

        {draft && !draft.id && <ItemForm draft={draft} setDraft={setDraft} cats={catList} onOk={submit} onCancel={() => setDraft(null)} input={input} btn={btn} />}

        {presets.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px]">
            <span className="text-faint">常見項目：</span>
            {presets.map(p => (
              <button key={p.name} type="button" onClick={() => { setDel(null); setMsg(''); setDraft({ ...blank(), ...p, amount: '' }); }}
                      className="h-7 rounded-full border border-line px-2.5 text-muted hover:border-line-strong hover:text-ink">＋ {p.name}</button>
            ))}
          </div>
        )}

        {items.length === 0 && !draft && <p className="mt-3 text-[12.5px] text-muted">還沒有項目。按「＋ 新增項目」或點上面的常見項目開始。</p>}

        <ul className="mt-2 divide-y divide-line">
          {sorted.map(x => draft?.id === x.id ? (
            <li key={x.id} className="py-1">
              <ItemForm draft={draft} setDraft={setDraft} cats={catList} onOk={submit} onCancel={() => setDraft(null)} input={input} btn={btn} />
            </li>
          ) : (
            <li key={x.id} className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 ${x.off ? 'opacity-50' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-ink">
                  {x.name}<span className="ml-1.5 rounded bg-sunken px-1.5 py-0.5 text-[11px] text-muted">{x.cat}</span>
                  {x.off && <span className="ml-1.5 text-[11px] text-faint">暫停中・不算進合計</span>}
                </div>
                <div className="flex flex-wrap gap-x-2.5 text-[11.5px] text-muted">
                  <span>{scheduleText(x)} <span className="font-mono text-ink">{money(x.amount)}</span></span>
                  {x.every !== 1 && <span>月均 <span className="font-mono">{money(perYear(x) / 12)}</span></span>}
                  <span>全年 <span className="font-mono">{money(perYear(x))}</span></span>
                </div>
                {x.note && <div className="text-[11px] text-faint">{x.note}</div>}
              </div>
              <div className="flex shrink-0 items-center">
                {del === x.id ? (
                  <>
                    <span className="text-[12px] text-ink">刪除？</span>
                    <button type="button" className="h-9 px-2 text-[12.5px] font-semibold text-up"
                            onClick={() => { setItems(xs => xs.filter(y => y.id !== x.id)); setDel(null); }}>確定</button>
                    <button type="button" className="h-9 px-2 text-[12.5px] text-muted" onClick={() => setDel(null)}>取消</button>
                  </>
                ) : (
                  <>
                    <button type="button" className={btn} onClick={() => edit(x)}>編輯</button>
                    <button type="button" className="h-9 px-2 text-[12.5px] text-muted hover:text-ink"
                            onClick={() => setItems(xs => xs.map(y => (y.id === x.id ? { ...y, off: y.off ? undefined : true } : y)))}>
                      {x.off ? '恢復' : '暫停'}
                    </button>
                    <button type="button" className="h-9 px-2 text-[12.5px] text-muted hover:text-ink" onClick={() => { setDraft(null); setDel(x.id); }}>刪除</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

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
                                onClick={() => { setItems(base.items); setDraft(null); setDel(null); setMsg(''); }}>放棄修改</button>}
            </div>
          )}
          {msg && <p className="mt-1 text-[12px] text-muted">{msg}</p>}
        </div>
      )}
    </div>
  );
}

function ItemForm({ draft, setDraft, cats, onOk, onCancel, input, btn }: {
  draft: Draft; setDraft: (d: Draft) => void; cats: string[]; onOk: () => void; onCancel: () => void; input: string; btn: string;
}) {
  const set = (p: Partial<Draft>) => setDraft({ ...draft, ...p });
  return (
    <form className="mt-2 rounded-lg border border-line bg-bg p-2" onSubmit={e => { e.preventDefault(); onOk(); }}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        <label className="col-span-2 flex flex-col text-[11.5px] text-muted sm:col-span-2">項目
          <input className={input} value={draft.name} onChange={e => set({ name: e.target.value })} autoFocus placeholder="例如：房屋稅" />
        </label>
        <label className="flex flex-col text-[11.5px] text-muted">分類
          <input className={input} value={draft.cat} onChange={e => set({ cat: e.target.value })} list="budget-cats" />
          <datalist id="budget-cats">{cats.map(c => <option key={c} value={c} />)}</datalist>
        </label>
        <label className="flex flex-col text-[11.5px] text-muted">每次金額
          <input className={`${input} font-mono`} value={draft.amount} onChange={e => set({ amount: e.target.value })}
                 inputMode="numeric" placeholder="0" />
        </label>
        <label className="flex flex-col text-[11.5px] text-muted">多久付一次
          <select className={input} value={draft.every} onChange={e => set({ every: Number(e.target.value) as Every })}>
            {EVERY.map(f => <option key={f.every} value={f.every}>{f.label}</option>)}
          </select>
        </label>
        {draft.every !== 1 && (
          <label className="flex flex-col text-[11.5px] text-muted">{draft.every === 12 ? '哪個月付' : '第一次在幾月'}
            <select className={input} value={draft.month} onChange={e => set({ month: Number(e.target.value) })}>
              {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} 月</option>)}
            </select>
          </label>
        )}
        <label className="col-span-2 flex flex-col text-[11.5px] text-muted sm:col-span-6">備註（可不填）
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
