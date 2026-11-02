/* 定期定額紀錄（#/dca，私人頁）的純計算。2026-11-02 使用者要求：記錄 ETF 名稱、扣款日、金額、券商（華南、永豐），
 * 記得現在在哪裡定期定額；可以切換角色（自己、小孩…）看各自的扣款行事曆，並知道每個月要定期定額的總金額。
 * 一筆計畫＝某人在某券商、每月某幾天各扣一次固定金額買某檔 ETF。 */

export interface DcaPlan {
  id: string;
  /** 是誰的（例：我、小孩） */
  who: string;
  /** ETF 代號（可空，例如還沒查） */
  code: string;
  name: string;
  /** 每月扣款日（1～31，可多天；例：6、16、26） */
  days: number[];
  /** 每次扣款金額（元） */
  amount: number;
  broker: string;
  note?: string;
  /** 暫停：留著但不算進合計 */
  off?: boolean;
}

export interface DcaData { v: 1; generated: string; people: string[]; plans: DcaPlan[]; holdings: DcaHolding[] }

// 第一個是新增時的預設（2026-11-02 使用者：預設永豐）
export const BROKERS = ['永豐', '華南'];
// 2026-11-02 使用者：小孩改成莎莎和 QQ
export const DEFAULT_PEOPLE = ['我', '莎莎', 'QQ'];

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const active = (plans: readonly DcaPlan[], who: string | null) => plans.filter(p => !p.off && (who === null || p.who === who));

/** 這筆計畫每個月扣多少（每次金額 × 每月扣款天數）。 */
export const monthlyOf = (p: DcaPlan) => p.amount * p.days.length;

/** 每月定期定額總額；who＝null 表示所有人。 */
export const monthTotal = (plans: readonly DcaPlan[], who: string | null) => active(plans, who).reduce((a, p) => a + monthlyOf(p), 0);

function group(plans: readonly DcaPlan[], key: (p: DcaPlan) => string) {
  const m = new Map<string, { monthly: number; n: number }>();
  for (const p of plans) {
    const g = m.get(key(p)) ?? { monthly: 0, n: 0 };
    g.monthly += monthlyOf(p); g.n += 1;
    m.set(key(p), g);
  }
  return [...m].map(([k, g]) => ({ key: k, monthly: g.monthly, n: g.n })).sort((a, b) => b.monthly - a.monthly);
}

/** 各券商每月扣多少（大的在前）。 */
export const byBroker = (plans: readonly DcaPlan[], who: string | null) => group(active(plans, who), p => p.broker || '未填');

/** 各人每月扣多少。 */
export const byPerson = (plans: readonly DcaPlan[]) => group(active(plans, null), p => p.who || '未填');

/** 那個月有幾天。month 是 1～12。 */
export const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();

/** 扣款日落在這個月的哪一天：設定 31 日但這個月只有 30 天，就算月底那天（實際遇假日券商會順延到下一個營業日）。 */
export const actualDay = (day: number, year: number, month: number) => Math.min(day, daysInMonth(year, month));

export interface Deduction { plan: DcaPlan; date: string; day: number; amount: number }

/** 某年某月的每一筆扣款（依日期排）。 */
export function monthDeductions(plans: readonly DcaPlan[], who: string | null, year: number, month: number): Deduction[] {
  const out: Deduction[] = [];
  const p2 = (n: number) => String(n).padStart(2, '0');
  for (const p of active(plans, who)) {
    for (const d of new Set(p.days.map(x => actualDay(x, year, month)))) {
      out.push({ plan: p, day: d, date: `${year}-${p2(month)}-${p2(d)}`, amount: p.amount * p.days.filter(x => actualDay(x, year, month) === d).length });
    }
  }
  return out.sort((a, b) => a.day - b.day || a.plan.who.localeCompare(b.plan.who) || b.amount - a.amount);
}

/** 從 today（含）起接下來 n 筆扣款（最多看兩個月）。 */
export function upcoming(plans: readonly DcaPlan[], who: string | null, today: Date, n = 8): Deduction[] {
  const y = today.getFullYear(), m = today.getMonth() + 1, d = today.getDate();
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return [...monthDeductions(plans, who, y, m).filter(x => x.day >= d), ...monthDeductions(plans, who, ny, nm)].slice(0, n);
}

/** 扣款日的文字：「每月 6、16、26 日」。 */
export const daysText = (days: readonly number[]) => `每月 ${[...days].sort((a, b) => a - b).join('、')} 日`;

/** 「6,16 26」「6、16、26」都可以：解析成 1～31 的整數、去重、排序；不合法回傳 null。 */
export function parseDays(text: string): number[] | null {
  const parts = text.split(/[^0-9]+/).filter(Boolean).map(Number);
  if (parts.length === 0 || parts.some(x => !Number.isInteger(x) || x < 1 || x > 31)) return null;
  return [...new Set(parts)].sort((a, b) => a - b);
}

/** 人名清單：存檔裡的在前，計畫或持股裡出現但清單沒有的補在後；都沒有時用預設（我、莎莎、QQ）。 */
export function peopleOf(data: Pick<DcaData, 'people' | 'plans'> & { holdings?: readonly DcaHolding[] }): string[] {
  const out = data.people.length ? [...data.people] : [...DEFAULT_PEOPLE];
  for (const p of data.plans) if (p.who && !out.includes(p.who)) out.push(p.who);
  for (const h of data.holdings ?? []) if (h.who && !out.includes(h.who)) out.push(h.who);
  return out;
}

/** 從加密檔解出來的資料逐欄檢查；格式不對的計畫丟掉，不讓一筆壞資料弄壞整頁。 */
export function cleanDca(raw: unknown): DcaData {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as { generated?: unknown; people?: unknown; plans?: unknown; holdings?: unknown };
  const plans: DcaPlan[] = [];
  for (const x of Array.isArray(r.plans) ? r.plans : []) {
    if (typeof x !== 'object' || x === null) continue;
    const o = x as Record<string, unknown>;
    const amount = Number(o.amount);
    const days = Array.isArray(o.days) ? [...new Set(o.days.map(Number).filter(d => Number.isInteger(d) && d >= 1 && d <= 31))].sort((a, b) => a - b) : [];
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    const code = typeof o.code === 'string' ? o.code.trim().toUpperCase() : '';
    if ((!name && !code) || !Number.isFinite(amount) || amount < 0 || days.length === 0) continue;
    plans.push({
      id: typeof o.id === 'string' && o.id ? o.id : newId(),
      who: typeof o.who === 'string' && o.who.trim() ? o.who.trim() : DEFAULT_PEOPLE[0],
      code, name: name || code, days, amount,
      broker: typeof o.broker === 'string' && o.broker.trim() ? o.broker.trim() : '未填',
      ...(typeof o.note === 'string' && o.note.trim() ? { note: o.note.trim() } : {}),
      ...(o.off === true ? { off: true } : {}),
    });
  }
  const people = Array.isArray(r.people) ? [...new Set(r.people.filter((p): p is string => typeof p === 'string' && p.trim() !== '').map(p => p.trim()))] : [];
  return { v: 1, generated: typeof r.generated === 'string' ? r.generated : '', people, plans, holdings: cleanHoldings(r.holdings) };
}

/* ── 小孩的持股與比較（2026-11-02 使用者：小孩改成莎莎和 QQ，記錄兩個小孩的持股，分析兩個人目前的差異）── */

export interface DcaHolding {
  id: string;
  who: string;
  code: string;
  name: string;
  /** 股數（1 張＝1,000 股） */
  shares: number;
  /** 投入成本（元，可不填） */
  cost?: number;
}

/** 報價：股價與「最近一次配息 × 一年配幾次」估的每股年配息（網站 yields.json） */
export interface Quote { price: number; perYear: number }

export interface PersonSummary {
  who: string;
  /** 有報價的市值合計 */
  mv: number;
  /** 有填成本的那幾筆的成本合計，與同樣那幾筆的市值（算報酬率用） */
  cost: number;
  mvWithCost: number;
  /** 預估年配息 */
  div: number;
  /** 每月定期定額（沒暫停的） */
  monthly: number;
  n: number;
  /** 缺報價的代號（市值沒算進去） */
  noQuote: string[];
  /** 各檔市值（大的在前） */
  rows: { code: string; name: string; shares: number; mv: number; share: number }[];
}

export function summarize(who: string, holdings: readonly DcaHolding[], plans: readonly DcaPlan[], quotes: ReadonlyMap<string, Quote>): PersonSummary {
  const hs = holdings.filter(h => h.who === who);
  const byCode = new Map<string, { name: string; shares: number }>();
  for (const h of hs) {
    const k = h.code || h.name;
    const g = byCode.get(k) ?? { name: h.name, shares: 0 };
    g.shares += h.shares;
    byCode.set(k, g);
  }
  let mv = 0, div = 0, cost = 0, mvWithCost = 0;
  const noQuote: string[] = [];
  const rows: PersonSummary['rows'] = [];
  for (const [code, g] of byCode) {
    const q = quotes.get(code.toUpperCase());
    if (!q) { noQuote.push(code); rows.push({ code, name: g.name, shares: g.shares, mv: 0, share: 0 }); continue; }
    mv += g.shares * q.price; div += g.shares * q.perYear;
    rows.push({ code, name: g.name, shares: g.shares, mv: g.shares * q.price, share: 0 });
  }
  for (const h of hs) {
    const q = quotes.get(h.code.toUpperCase());
    if (h.cost !== undefined && q) { cost += h.cost; mvWithCost += h.shares * q.price; }
  }
  for (const r of rows) r.share = mv > 0 ? r.mv / mv : 0;
  rows.sort((a, b) => b.mv - a.mv);
  return { who, mv, cost, mvWithCost, div, monthly: monthTotal(plans, who), n: byCode.size, noQuote, rows };
}

/** 兩個人的持股逐檔對照：兩人都有、只有 a、只有 b（依兩人市值合計排序） */
export function compareHoldings(a: PersonSummary, b: PersonSummary) {
  const codes = [...new Set([...a.rows.map(r => r.code), ...b.rows.map(r => r.code)])];
  const get = (s: PersonSummary, c: string) => s.rows.find(r => r.code === c);
  const rows = codes.map(c => {
    const x = get(a, c), y = get(b, c);
    return { code: c, name: (x ?? y)!.name, a: x ?? null, b: y ?? null };
  }).sort((p, q) => ((q.a?.mv ?? 0) + (q.b?.mv ?? 0)) - ((p.a?.mv ?? 0) + (p.b?.mv ?? 0)));
  return { rows, both: rows.filter(r => r.a && r.b).length, onlyA: rows.filter(r => r.a && !r.b).map(r => r.code), onlyB: rows.filter(r => !r.a && r.b).map(r => r.code) };
}

/** 從加密檔解出來的持股逐筆檢查 */
export function cleanHoldings(raw: unknown): DcaHolding[] {
  const out: DcaHolding[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    if (typeof x !== 'object' || x === null) continue;
    const o = x as Record<string, unknown>;
    const shares = Number(o.shares), cost = o.cost === undefined || o.cost === null || o.cost === '' ? undefined : Number(o.cost);
    const code = typeof o.code === 'string' ? o.code.trim().toUpperCase() : '';
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    if ((!code && !name) || !Number.isFinite(shares) || shares <= 0) continue;
    out.push({
      id: typeof o.id === 'string' && o.id ? o.id : newId(),
      who: typeof o.who === 'string' && o.who.trim() ? o.who.trim() : DEFAULT_PEOPLE[0],
      code, name: name || code, shares,
      ...(cost !== undefined && Number.isFinite(cost) && cost >= 0 ? { cost } : {}),
    });
  }
  return out;
}

/** 改名：計畫、持股、人名清單一起改 */
export function renamePerson(d: Pick<DcaData, 'people' | 'plans' | 'holdings'>, from: string, to: string): Pick<DcaData, 'people' | 'plans' | 'holdings'> {
  const t = to.trim();
  if (!t || t === from) return d;
  const people = d.people.includes(t) ? d.people.filter(p => p !== from) : d.people.map(p => (p === from ? t : p));
  return {
    people,
    plans: d.plans.map(p => (p.who === from ? { ...p, who: t } : p)),
    holdings: d.holdings.map(h => (h.who === from ? { ...h, who: t } : h)),
  };
}
