/* 策略頁（#/GEN、#/MAINT）共用：數字格式與 ECharts 掛載。2026-11-05 從 GenPage 搬出來給 MaintPage 共用。 */

import { useEffect, useRef } from 'react';

export const wan = (x: number) => x.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
export const r2 = (x: number | null | undefined) => (x == null ? '—' : x.toFixed(2));
export const sign = (x: number | null) => (x == null ? 'text-muted' : x >= 0 ? 'text-up' : 'text-down');
/** ECharts 畫在 canvas 上，不認得 var(--x)：從目前主題取實際色值 */
export const cssVar = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v.replace(/^var\((.*)\)$/, '$1')).trim() || '#888';

type Chart = { setOption: (o: unknown, notMerge?: boolean) => void; resize: () => void; dispose: () => void };

/** ECharts 共用：只建立一次，選項變了就 setOption */
export function useEChart(opt: unknown) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<Chart | null>(null);
  const last = useRef(opt);
  useEffect(() => {
    let disposed = false;
    import('echarts').then(ec => {
      if (disposed || !el.current) return;
      chart.current = ec.init(el.current) as unknown as Chart;
      chart.current.setOption(last.current, true);
    });
    const onResize = () => chart.current?.resize();
    window.addEventListener('resize', onResize);
    return () => { disposed = true; window.removeEventListener('resize', onResize); chart.current?.dispose(); chart.current = null; };
  }, []);
  // 圖表是非同步載入的：最新選項先記著，載入完成時用它畫
  useEffect(() => { last.current = opt; chart.current?.setOption(opt, true); }, [opt]);
  return el;
}
