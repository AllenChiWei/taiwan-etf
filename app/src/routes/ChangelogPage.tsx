/* 更新日誌：網站什麼時候多了什麼功能。內容在 lib/changelog.ts。 */

import { Link } from '@tanstack/react-router';
import { CHANGELOG, KIND_LABEL, type ChangeKind } from '../lib/changelog';
import { weekdayOf, WEEKDAY_LABEL } from '../lib/atm';

const KIND_CLASS: Record<ChangeKind, string> = {
  new: 'bg-accent text-accent-ink',
  improve: 'bg-sunken text-ink',
  fix: 'border border-line text-muted',
};

export function ChangelogPage() {
  return (
    <div className="max-w-[70ch] pt-6 pb-4">
      <h2 className="text-[17px] font-bold text-ink">更新日誌</h2>
      <p className="mt-1 text-[13px] text-muted">
        網站新增或改動了什麼功能。每個交易日的資料更新不列在這裡。
      </p>

      <ol className="mt-4 space-y-5">
        {CHANGELOG.map(day => {
          const wd = weekdayOf(day.date);
          return (
            <li key={day.date}>
              <h3 className="font-mono text-[13.5px] font-bold tabular-nums text-ink">
                {day.date}
                {wd !== null && (
                  <span className="ml-1.5 font-sans text-[12px] font-normal text-faint">
                    {WEEKDAY_LABEL[wd]}
                  </span>
                )}
              </h3>
              <ul className="mt-1.5 space-y-2 border-l-2 border-line pl-3">
                {day.items.map((it, i) => (
                  <li key={i} className="text-[14px] leading-relaxed text-muted">
                    <span className={`mr-1.5 inline-block rounded px-1.5 py-px align-[1px]
                                      text-[11px] font-semibold ${KIND_CLASS[it.kind]}`}>
                      {KIND_LABEL[it.kind]}
                    </span>
                    {it.text}
                    {it.to && it.to !== '/changelog' && (
                      <Link to={it.to} className="ml-1 whitespace-nowrap text-[12.5px] text-accent hover:underline">
                        前往 →
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
