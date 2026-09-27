/* 台股行事曆：交易所公告的除權息與股東會（calendar.json），加上依規則算出來的日子。
 *
 * 依規則算的有兩種，畫面上都標明「法定期限」「依規則推算」，不假裝是公告：
 * - 財報與月營收的**法定公告期限**（證券交易法第 36 條）：年度財報會計年度終了後三個月內
 *   （3/31）、第一～三季各季終了後 45 天內（5/15、8/14、11/14）；月營收每月 10 日前。
 *   這是一般產業的期限，金融保險業另有規定。公司可以提早，期限只是「最晚」。
 * - **台指期與台指選擇權的月結算日**：每月第三個星期三。遇到休市會順延，而這裡不知道
 *   休市日，所以標「遇假日順延」。週選（每週三、週五）太密，不列。
 *
 * 日期一律是 'YYYY-MM-DD' 字串，比較用字典序，不經過時區換算。
 */

export type EventKind = 'exdiv' | 'meeting' | 'report' | 'revenue' | 'settle';

export interface ExDivRow {
  d: string; code: string; name: string;
  /** '息' | '權' | '權息' */
  k: string;
  cash: number | null; stock: number | null; m: 'twse' | 'tpex';
}

export interface MeetingRow {
  d: string; code: string; name: string;
  /** '常會' | '臨時會' */
  k: string;
  elect: boolean; place: string; m: 'twse' | 'tpex';
}

export interface CalendarData {
  meta: { updated: string; until: string; source: string; errors: string[] };
  exdiv: ExDivRow[];
  meetings: MeetingRow[];
}

export interface CalEvent {
  d: string;
  kind: EventKind;
  code: string | null;
  title: string;
  detail: string;
}

export const KIND_LABEL: Record<EventKind, string> = {
  exdiv: '除權息', meeting: '股東會', report: '財報期限', revenue: '月營收期限', settle: '期貨結算',
};

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function* months(from: string, to: string): Generator<[number, number]> {
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    yield [y, m];
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
}

/** 某年某月的第三個星期三。 */
export function thirdWednesday(y: number, m: number): string {
  const dow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();   // 0 = 星期日
  const first = 1 + ((3 - dow + 7) % 7);
  return iso(y, m, first + 14);
}

const REPORTS: Array<[number, number, (y: number) => string]> = [
  [3, 31, y => `${y - 1} 年度財報`],
  [5, 15, y => `${y} 年第一季財報`],
  [8, 14, y => `${y} 年第二季財報`],
  [11, 14, y => `${y} 年第三季財報`],
];

/** from～to（含）之間依規則推得的日子：財報期限、月營收期限、期貨結算日。 */
export function ruleEvents(from: string, to: string): CalEvent[] {
  const out: CalEvent[] = [];
  for (const [y, m] of months(from, to)) {
    const prev = m === 1 ? 12 : m - 1;
    out.push({
      d: iso(y, m, 10), kind: 'revenue', code: null,
      title: `${prev} 月營收公告期限`,
      detail: '上市櫃公司須於每月 10 日前公告上月營收（法定期限，多數公司會提早）',
    });
    for (const [rm, rd, label] of REPORTS) {
      if (rm === m) {
        out.push({
          d: iso(y, m, rd), kind: 'report', code: null,
          title: `${label(y)}公告期限`,
          detail: '一般產業的法定期限（證券交易法第 36 條），金融保險業另有規定；公司可以提早公告',
        });
      }
    }
    out.push({
      d: thirdWednesday(y, m), kind: 'settle', code: null,
      title: `台指期・台指選 ${m} 月合約結算`,
      detail: '每月第三個星期三，依規則推算；遇假日順延，以期交所公告為準',
    });
  }
  return out.filter(e => e.d >= from && e.d <= to);
}

const fmtNum = (v: number) => (Math.round(v * 10000) / 10000).toString();

export function exdivEvent(r: ExDivRow): CalEvent {
  const parts: string[] = [];
  if (r.cash) parts.push(`現金 ${fmtNum(r.cash)} 元`);
  if (r.stock) parts.push(`配股率 ${fmtNum(r.stock)}`);
  if (!parts.length) parts.push(r.k.includes('息') ? '金額待公告' : '');
  return {
    d: r.d, kind: 'exdiv', code: r.code,
    title: `${r.name} 除${r.k}`,
    detail: parts.filter(Boolean).join('・') + `（${r.m === 'twse' ? '上市' : '上櫃'}）`,
  };
}

export function meetingEvent(r: MeetingRow): CalEvent {
  return {
    d: r.d, kind: 'meeting', code: r.code,
    title: `${r.name} 股東${r.k}`,
    detail: [r.elect ? '改選董監' : '', r.place].filter(Boolean).join('・'),
  };
}

/** 合併所有事件並依日期排序（同一天：公告事件在前、規則事件在後，再依代號）。 */
export function allEvents(data: CalendarData | null, from: string, to: string): CalEvent[] {
  const list: CalEvent[] = [];
  if (data) {
    for (const r of data.exdiv) list.push(exdivEvent(r));
    for (const r of data.meetings) list.push(meetingEvent(r));
  }
  list.push(...ruleEvents(from, to));
  const rank = (e: CalEvent) => (e.code ? 0 : 1);
  return list
    .filter(e => e.d >= from && e.d <= to)
    .sort((a, b) => a.d.localeCompare(b.d) || rank(a) - rank(b)
      || (a.code ?? '').localeCompare(b.code ?? ''));
}

export interface CalFilter {
  kinds: ReadonlySet<EventKind>;
  query: string;
  /** 只看這些代號（收藏＋配息持股）；null 表示不限。規則事件不受影響，一律顯示。 */
  mine: ReadonlySet<string> | null;
}

export function filterEvents(list: CalEvent[], f: CalFilter): CalEvent[] {
  const q = f.query.trim().toLowerCase();
  return list.filter(e => {
    if (!f.kinds.has(e.kind)) return false;
    if (f.mine && e.code && !f.mine.has(e.code)) return false;
    if (q && !(e.code ?? '').toLowerCase().includes(q) && !e.title.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });
}

export function groupByDate(list: CalEvent[]): Array<{ d: string; items: CalEvent[] }> {
  const out: Array<{ d: string; items: CalEvent[] }> = [];
  for (const e of list) {
    const last = out[out.length - 1];
    if (last && last.d === e.d) last.items.push(e);
    else out.push({ d: e.d, items: [e] });
  }
  return out;
}

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

/** '2026-10-08' -> '10/8（四）' */
export function dayLabel(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  return `${t.getUTCMonth() + 1}/${t.getUTCDate()}（${WEEKDAY[t.getUTCDay()]}）`;
}

/** 距今天幾天（今天 0、明天 1）。 */
export function daysUntil(d: string, today: string): number {
  return Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}
