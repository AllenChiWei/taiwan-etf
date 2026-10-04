// @ts-nocheck
/* QB 策略層評價看板（本機 QB_Report\qb_dashboard.html 與網站 #/QB 共用這一份）。
 *
 * mountQbDashboard(root, data, echarts, loadWeek)：
 *   data      qb_dashboard.py 產生的主資料（設定清單、組合日損益、各策略月損益、各策略每週評價前損益…）
 *   echarts   ECharts 模組（網站：npm 打包、只在 QB 頁載入；本機：CDN 的全域 echarts）
 *   loadWeek  (設定代號) => Promise<number[][]>：該設定下各策略的每週損益（千元），點到才載入
 * 回傳 unmount()。
 *
 * 這支是從原本的單檔 HTML 搬過來的 DOM 程式，型別檢查關掉（ts-nocheck）：它不碰網站其他狀態，
 * 所有選取器都限定在 root 底下，樣式也全部包在 .qbd 裡，不會影響其他頁面。
 */

const CSS = `
.qbd { color-scheme: light; --bg:#f4f4f2; --surface:#fcfcfb; --sunken:#efeeea; --line:#e2e1dc; --line-strong:#c9c8c1;
  --ink:#0b0b0b; --ink-2:#52514e; --ink-3:#85847e; --a:#2a78d6; --b:#eb6834; --up:#c9302c; --down:#1f8a3b;
  background:var(--bg); color:var(--ink); font:14px/1.5 "Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif;
  border-radius:14px; padding:16px; }
.qbd * { box-sizing:border-box; }
.qbd h1 { font-size:20px; margin:0 0 4px; } .qbd h2 { font-size:15px; margin:0 0 2px; }
.qbd .sub { color:var(--ink-2); font-size:12.5px; } .qbd .note { color:var(--ink-3); font-size:12px; }
.qbd .card { background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
.qbd .grid { display:grid; gap:12px; } .qbd .g2 { grid-template-columns:repeat(auto-fit,minmax(min(100%,520px),1fr)); }
.qbd .filters { position:sticky; top:0; z-index:5; display:flex; flex-wrap:wrap; gap:10px 18px; align-items:center;
  background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:10px 14px; margin:14px 0; }
.qbd .filters label, .qbd .filters .lbl { display:flex; align-items:center; gap:6px; font-size:13px; color:var(--ink-2); }
.qbd select { font:inherit; font-size:13px; padding:4px 8px; border:1px solid var(--line-strong); border-radius:8px; background:var(--surface); color:var(--ink); max-width:100%; }
.qbd .seg { display:inline-flex; border:1px solid var(--line-strong); border-radius:8px; overflow:hidden; }
.qbd .seg button { font:inherit; font-size:13.5px; border:0; background:var(--surface); padding:6px 14px; min-height:36px; cursor:pointer; color:var(--ink-2); touch-action:manipulation; }
.qbd .seg button + button { border-left:1px solid var(--line); }
.qbd .filters label { min-width:0; max-width:100%; } .qbd .filters select { min-width:0; flex:1 1 auto; }
@media (max-width: 640px) {
  .qbd { padding:10px; }
  .qbd .seg button { min-height:40px; padding:8px 14px; } .qbd select { min-height:40px; }
  /* 手機上篩選列有半個螢幕高，固定在上方會擋住內容 → 不固定；選單撐滿一列 */
  .qbd .filters { position:static; }
  .qbd .filters label { width:100%; } .qbd .filters select { width:100%; }
}
.qbd .seg button[aria-pressed="true"] { background:var(--ink); color:var(--surface); }
.qbd .dot { display:inline-block; width:10px; height:10px; border-radius:50%; }
.qbd .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px; }
.qbd .kpi { background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:10px 12px; }
.qbd .kpi .k { font-size:12px; color:var(--ink-2); }
.qbd .kpi .v { display:flex; justify-content:space-between; gap:8px; font-variant-numeric:tabular-nums; margin-top:2px; }
.qbd .kpi .v span { font-size:13px; color:var(--ink-2); } .qbd .kpi .v b { font-size:16px; color:var(--ink); }
.qbd .kpi .d { font-size:12px; margin-top:2px; font-variant-numeric:tabular-nums; }
.qbd .better { color:var(--up); } .qbd .worse { color:var(--down); } .qbd .same { color:var(--ink-3); }
.qbd .chart { width:100%; height:320px; } .qbd .chart.tall { height:820px; } .qbd .chart.short { height:180px; }
.qbd .tbl-wrap { overflow-x:auto; }
.qbd table { border-collapse:collapse; width:100%; font-size:12.5px; font-variant-numeric:tabular-nums; }
.qbd th, .qbd td { padding:5px 8px; border-bottom:1px solid var(--line); text-align:right; white-space:nowrap; }
.qbd th { color:var(--ink-2); font-weight:600; cursor:pointer; user-select:none; background:var(--surface); }
.qbd th:first-child, .qbd td:first-child { text-align:left; }
.qbd tr.sel-a td:first-child { box-shadow:inset 3px 0 0 var(--a); } .qbd tr.sel-b td:first-child { box-shadow:inset 3px 0 0 var(--b); }
.qbd tr.clickable { cursor:pointer; } .qbd tr.clickable:hover td { background:var(--sunken); }
.qbd tr.cur td { background:#fff4ec; }
.qbd .pos { color:var(--up); } .qbd .neg { color:var(--down); }
.qbd .tag { font-size:11px; padding:1px 6px; border-radius:6px; background:var(--sunken); color:var(--ink-2); margin-left:4px; }
.qbd .verdict { border-left:4px solid var(--a); } .qbd .verdict ul { margin:6px 0 0; padding-left:18px; }
.qbd .legend-row { display:flex; gap:14px; flex-wrap:wrap; align-items:center; font-size:12.5px; color:var(--ink-2); margin:4px 0 6px; }
.qbd .mt { margin-top:12px; }
`;

const HTML = `
<h1>QB 策略層評價看板</h1>
<div class="sub" data-id="meta"></div>
<div class="note">資料：Export\\*.csv（每個策略拆成多方 _L、空方 _S；<b>Activate\\ 未使用</b>，避免事後挑選的偏差）。
  所有分數只用「前一天收盤以前」的資料。「QB 序位」「QB 分多空」照複製版 QB 規則逐日模擬（名次、名額、部位歸零才出、取整）；
  沒有計入 QB 專案層的動能配置上限。</div>
<div class="filters">
  <label><span class="dot" style="background:var(--a)"></span>A<select data-id="selA"></select></label>
  <label><span class="dot" style="background:var(--b)"></span>B<select data-id="selB"></select></label>
  <div class="lbl">期間 <span class="seg" data-id="segPeriod"></span></div>
  <div class="lbl">部位大小 <span class="seg" data-id="segScale"></span></div>
</div>
<div class="card verdict" data-id="verdict"></div>
<div class="card mt">
  <h2>QB 序位 × Sortino 回溯期（所選期間）</h2>
  <div class="note">每格：Sharpe ／ 淨利÷回撤 ／ 虧損月比例。紅字＝比評價前好、綠字＝比評價前差（台股慣例）。點格子設為 B。
    「門檻」＝最小動能門檻（分數 &gt; 0 才做）；「前 N」＝單一分類，策略有部位、名次 ≤ N、列表有空位就進入，部位歸零才移出。</div>
  <div class="tbl-wrap"><table data-id="tMatrix"></table></div>
  <h2 class="mt">QB 分多空（多方、空方兩個策略分類，各自序位）</h2>
  <div class="note">_L 策略放「多方」分類、_S 放「空方」分類，各自設序位 N（複製版 QB 已支援，不用改程式）。</div>
  <div class="tbl-wrap"><table data-id="tMatrixLS"></table></div>
</div>
<h2 class="mt">重點指標（A → B）</h2>
<div class="note" data-id="kpiNote"></div>
<div class="kpis mt" data-id="kpis"></div>
<div class="grid g2 mt">
  <div class="card"><h2>累積損益</h2><div class="note">單位：萬元</div><div data-id="cEquity" class="chart"></div></div>
  <div class="card"><h2>回撤（離前高多遠）</h2><div class="note">單位：萬元；越淺越好</div><div data-id="cDD" class="chart"></div></div>
  <div class="card"><h2>各年度損益</h2><div class="note">單位：萬元</div><div data-id="cYear" class="chart"></div></div>
  <div class="card"><h2>近 24 個月 每月損益</h2><div class="note">單位：萬元</div><div data-id="cMonth" class="chart"></div></div>
</div>
<div class="card mt" data-id="stratCard">
  <h2>單一策略績效曲線（評價前 vs 評價後）</h2>
  <div class="legend-row">
    <label>策略 <select data-id="selStrat"></select></label>
    <span>在下方「每個策略的貢獻」表格、或熱圖左邊的策略名稱點一下也可以切換</span>
  </div>
  <div class="note" data-id="stratNote"></div>
  <div data-id="cStrat" class="chart"></div>
  <div class="note">B 的動能倍數（每月平均；0＝關閉，沒在 QB 訊號列表裡）</div>
  <div data-id="cStratW" class="chart short"></div>
</div>
<div class="card mt">
  <h2>所有設定比較</h2>
  <div class="note">點欄位名稱排序；點列可設為 B。「同曝險」＝把平均在場倍數調成與評價前相同後的淨利與回撤（淨利才可比；Sharpe、淨利/回撤不受部位大小影響）。</div>
  <div class="tbl-wrap"><table data-id="tCfg"></table></div>
</div>
<div class="card mt">
  <h2>B 的策略開關時間軸</h2>
  <div class="note">每格＝該策略該月的平均動能倍數（0＝關閉；空白＝策略還沒開始）。游標移上去看該月評價前／評價後損益；點左邊策略名稱看曲線。</div>
  <div data-id="cOnOff" class="chart tall"></div>
</div>
<div class="card mt">
  <h2>每個策略每月損益（近 24 個月）</h2>
  <div class="legend-row"><span>顯示 <span class="seg" data-id="segHeat"></span></span><span>紅＝賺、綠＝賠（台股慣例），顏色越深金額越大</span></div>
  <div data-id="cHeat" class="chart tall"></div>
</div>
<div class="card mt">
  <h2>每個策略的貢獻（所選期間）</h2>
  <div class="note">評價前＝固定 1 倍；A、B＝套用該設定後的貢獻。開啟比例＝B 在期間內有給倍數的月份比例。點欄位名稱排序；<b>點列看該策略的績效曲線</b>。</div>
  <div class="tbl-wrap"><table data-id="tStrat"></table></div>
</div>
`;

export function mountQbDashboard(root, D, echarts, loadWeek) {
  const style = document.createElement('style');
  style.textContent = CSS;
  root.classList.add('qbd');
  root.innerHTML = HTML;
  root.prepend(style);
  const $ = id => root.querySelector(`[data-id="${id}"]`);
  const cfgByKey = Object.fromEntries(D.configs.map(c => [c.key, c]));
  const KIND = { baseline: '評價前', x1: 'X1 設定', qb: 'QB 設定', theory: '理論（QB 未支援）' };
  const C = { a: '#2a78d6', b: '#eb6834', up: '#c9302c', down: '#1f8a3b', ink2: '#52514e', ink3: '#85847e',
              line: '#e2e1dc', surface: '#fcfcfb', before: '#85847e' };
  const fmtW = v => v == null || !isFinite(v) ? '—' : (v / 1e4).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
  const fmt2 = v => v == null || !isFinite(v) ? '—' : v.toFixed(2);
  const fmt1 = v => v == null || !isFinite(v) ? '—' : v.toFixed(1);
  const pct0 = v => v == null || !isFinite(v) ? '—' : (v * 100).toFixed(0) + '%';
  const defB = cfgByKey.LS10_500 ? 'LS10_500' : (cfgByKey.GATE15_250 ? 'GATE15_250' : D.configs[1].key);
  const state = { a: 'EQ', b: defB, period: '全期', scaled: false, heat: 'before', strat: 0 };
  const PERIODS = ['全期', '近5年', '近2年', '近1年'];
  const weekCache = {};
  const getWeek = key => (weekCache[key] ||= loadWeek(key));

  $('meta').textContent = `評估期 ${D.range[0]} ～ ${D.range[1]}（${D.warmup_start} 起的前 500 個交易日當暖機）　·　策略 ${D.strategies.length} 個（多空分拆）　·　產生於 ${D.generated}`;

  for (const id of ['selA', 'selB']) {
    const sel = $(id);
    const groups = {};
    for (const c of D.configs) {
      const g = c.key.startsWith('GATE') ? 'QB 序位（單一分類）' : c.key.startsWith('LS') ? 'QB 分多空序位'
        : c.key.startsWith('CUT') ? 'QB 最小動能門檻' : KIND[c.kind];
      if (!groups[g]) { groups[g] = document.createElement('optgroup'); groups[g].label = g; sel.appendChild(groups[g]); }
      groups[g].appendChild(new Option(c.name, c.key));
    }
  }
  $('selA').onchange = e => { state.a = e.target.value; render(); };
  $('selB').onchange = e => { state.b = e.target.value; render(); };
  D.strategies.forEach((s, j) => $('selStrat').add(new Option(s, String(j))));
  $('selStrat').onchange = e => { state.strat = +e.target.value; renderStrat(); };

  function seg(el, opts, getv, setv) {
    el.innerHTML = '';
    for (const [v, label] of opts) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label;
      b.setAttribute('aria-pressed', String(getv() === v));
      b.onclick = () => {
        if (getv() === v) return;
        setv(v);
        el.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        requestAnimationFrame(() => setTimeout(render, 0));   // 先讓按下的狀態畫出來
      };
      el.appendChild(b);
    }
  }
  function periodStart(p) {
    const y = { '近5年': 5, '近2年': 2, '近1年': 1 }[p];
    if (!y) return D.range[0];
    const d = new Date(D.range[1]); d.setFullYear(d.getFullYear() - y);
    return d.toISOString().slice(0, 10);
  }
  function idxRange() {
    const s = periodStart(state.period);
    let i0 = D.dates.findIndex(d => d >= s); if (i0 < 0) i0 = 0;
    return [i0, D.dates.length];
  }
  function series(key) {
    const k = state.scaled ? cfgByKey[key].scale : 1;
    const [i0, i1] = idxRange();
    return D.daily[key].slice(i0, i1).map(v => v * k);
  }
  function metrics(x, dates) {
    let eq = 0, peak = 0, mdd = 0, s = 0, s2 = 0;
    const cum = [], dd = [];
    for (const v of x) { eq += v; peak = Math.max(peak, eq); mdd = Math.max(mdd, peak - eq); cum.push(eq); dd.push(eq - peak); s += v; s2 += v * v; }
    const n = x.length, mean = s / n, sd = Math.sqrt(Math.max(0, (s2 - n * mean * mean) / (n - 1)));
    const mon = new Map();
    x.forEach((v, i) => { const m = dates[i].slice(0, 7); mon.set(m, (mon.get(m) || 0) + v); });
    const mv = [...mon.values()].filter(v => v !== 0);
    return { net: eq, mdd, nd: mdd > 0 ? eq / mdd : null, sharpe: sd > 0 ? mean / sd * Math.sqrt(252) : null,
             loseM: mv.length ? mv.filter(v => v < 0).length / mv.length : null,
             worstM: mv.length ? Math.min(...mv) : null, cum, dd, mon };
  }
  const curDates = () => { const [i0, i1] = idxRange(); return D.dates.slice(i0, i1); };

  const charts = {};
  const chart = id => (charts[id] ||= echarts.init($(id), null, { renderer: 'canvas' }));
  const onResize = () => Object.values(charts).forEach(c => c.resize());
  window.addEventListener('resize', onResize);
  const axisCommon = { axisLine: { lineStyle: { color: C.line } }, axisTick: { show: false },
    axisLabel: { color: C.ink3, fontSize: 11 }, splitLine: { lineStyle: { color: C.line } } };
  const tooltipCommon = { backgroundColor: C.surface, borderColor: C.line, textStyle: { color: '#0b0b0b', fontSize: 12 } };
  const legend = { top: 0, right: 0, textStyle: { color: C.ink2, fontSize: 12 }, icon: 'circle', itemWidth: 9, itemHeight: 9 };
  const lineSeries = (name, data, color, width = 2) => ({ name, type: 'line', data, showSymbol: false, sampling: 'lttb',
    lineStyle: { width, color }, itemStyle: { color }, emphasis: { disabled: true } });
  const barS = (name, data, color) => ({ name, type: 'bar', data, barGap: '8%', barMaxWidth: 18, itemStyle: { color, borderRadius: [3, 3, 0, 0] } });
  const tl = { ...tooltipCommon, trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: C.ink3 } }, valueFormatter: v => fmtW(v) + ' 萬' };
  const tb = { ...tooltipCommon, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: v => fmtW(v) + ' 萬' };
  const yW = { type: 'value', ...axisCommon, axisLabel: { ...axisCommon.axisLabel, formatter: v => fmtW(v) } };

  function selectStrategy(j, scroll = true) {
    state.strat = j;
    $('selStrat').value = String(j);
    renderStrat();
    renderStratTableHighlight();
    if (scroll) $('stratCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  let stratToken = 0;
  async function renderStrat() {
    const token = ++stratToken;
    const j = state.strat, s = D.strategies[j];
    const ps = periodStart(state.period);
    const wi = D.weeks.map((w, i) => [w, i]).filter(([w]) => w >= ps).map(([, i]) => i);
    $('stratNote').textContent = `${s}：載入中…`;
    let wa, wb;
    try { [wa, wb] = await Promise.all([getWeek(state.a), getWeek(state.b)]); }
    catch (e) { $('stratNote').textContent = `載入失敗：${e.message || e}`; return; }
    if (token !== stratToken) return;
    const cum = arr => { let t = 0; return wi.map(i => (t += arr[i]) * 1e3); };
    const before = cum(D.strat_week_before[j]), A = cum(wa[j]), B = cum(wb[j]);
    const last = a => a.length ? a[a.length - 1] : 0;
    const mdd = a => { let p = 0, m = 0; for (const v of a) { p = Math.max(p, v); m = Math.max(m, p - v); } return m; };
    $('stratNote').innerHTML = `${s}　·　${state.period}　·　評價前 ${fmtW(last(before))} 萬（回撤 ${fmtW(mdd(before))}）`
      + `　·　<span style="color:${C.a}">A ${fmtW(last(A))} 萬（回撤 ${fmtW(mdd(A))}）</span>`
      + `　·　<span style="color:${C.b}">B ${fmtW(last(B))} 萬（回撤 ${fmtW(mdd(B))}）</span>`
      + `　·　單位：萬元，原始部位（不做同曝險調整）`;
    const x = wi.map(i => D.weeks[i]);
    chart('cStrat').setOption({
      animation: false, grid: { left: 54, right: 14, top: 28, bottom: 52 }, tooltip: tl, legend,
      xAxis: { type: 'category', data: x, ...axisCommon, splitLine: { show: false } }, yAxis: yW,
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 8, borderColor: C.line }],
      series: [lineSeries('評價前（固定 1 倍）', before, C.before), lineSeries('A ' + cfgByKey[state.a].name, A, C.a),
               lineSeries('B ' + cfgByKey[state.b].name, B, C.b)],
    }, true);
    const pm0 = ps.slice(0, 7);
    const mIdx = D.months.map((m, i) => [m, i]).filter(([m]) => m >= pm0).map(([, i]) => i);
    chart('cStratW').setOption({
      animation: false, grid: { left: 54, right: 14, top: 10, bottom: 24 },
      tooltip: { ...tooltipCommon, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: v => (+v).toFixed(2) + ' 倍' },
      xAxis: { type: 'category', data: mIdx.map(i => D.months[i]), ...axisCommon, splitLine: { show: false } },
      yAxis: { type: 'value', ...axisCommon, min: 0 },
      series: [{ type: 'bar', name: 'B 動能倍數', data: mIdx.map(i => D.strat_weight[state.b][j][i]), barMaxWidth: 8,
                 itemStyle: { color: C.b, borderRadius: [2, 2, 0, 0] } }],
    }, true);
  }

  function render() {
    seg($('segPeriod'), PERIODS.map(p => [p, p]), () => state.period, v => state.period = v);
    seg($('segScale'), [[false, '原始'], [true, '同曝險']], () => state.scaled, v => state.scaled = v);
    seg($('segHeat'), [['before', '評價前'], ['b', 'B 評價後'], ['diff', 'B − 評價前']], () => state.heat, v => state.heat = v);
    $('selA').value = state.a; $('selB').value = state.b;
    const dates = curDates();
    const A = metrics(series(state.a), dates), B = metrics(series(state.b), dates);
    const ca = cfgByKey[state.a], cb = cfgByKey[state.b];
    const all = D.configs.map(c => ({ c, m: metrics(series(c.key), dates) }));
    const base = all.find(r => r.c.key === 'EQ').m;
    const beat = all.filter(r => r.c.key !== 'EQ' && r.m.sharpe > base.sharpe);
    const bestND = [...all].sort((x, y) => (y.m.nd ?? -1e9) - (x.m.nd ?? -1e9))[0];
    const bestSh = [...all].sort((x, y) => (y.m.sharpe ?? -1e9) - (x.m.sharpe ?? -1e9))[0];
    $('verdict').innerHTML = `<h2>${state.period}：評價後有沒有比較好？</h2><ul>
      <li>評價前（平均分配）：淨利 ${fmtW(base.net)} 萬、最大回撤 ${fmtW(base.mdd)} 萬、淨利/回撤 ${fmt1(base.nd)}、Sharpe ${fmt2(base.sharpe)}、虧損月 ${pct0(base.loseM)}。</li>
      <li>Sharpe 贏過評價前的設定：${beat.length} 組（共 ${all.length - 1} 組）。</li>
      <li>淨利/回撤最好：<b>${bestND.c.name}</b>（${fmt1(bestND.m.nd)}）；Sharpe 最好：<b>${bestSh.c.name}</b>（${fmt2(bestSh.m.sharpe)}）。</li>
      <li class="note">提醒：設定越多、期間切得越短，排名越容易只是運氣；要看前半、後半、近期是否都成立。</li></ul>`;

    $('kpiNote').textContent = `A＝${ca.name}；B＝${cb.name}（${cb.desc}）。${state.scaled ? '同曝險：部位已調整成與評價前相同的平均在場倍數（B ×' + cb.scale.toFixed(2) + '）。' : '原始：照設定的倍數，不調整。'}`;
    const kp = [['淨利（萬）', A.net, B.net, fmtW, true], ['最大回撤（萬）', A.mdd, B.mdd, fmtW, false],
                ['淨利 / 回撤', A.nd, B.nd, fmt1, true], ['Sharpe', A.sharpe, B.sharpe, fmt2, true],
                ['虧損月比例', A.loseM, B.loseM, pct0, false], ['最差單月（萬）', A.worstM, B.worstM, fmtW, true]];
    $('kpis').innerHTML = kp.map(([k, a, b, f, hib]) => {
      const diff = (b ?? 0) - (a ?? 0);
      const good = hib ? diff > 0 : diff < 0;
      const cls = Math.abs(diff) < 1e-9 ? 'same' : good ? 'better' : 'worse';
      const rel = a ? ` (${(diff / Math.abs(a) * 100 >= 0 ? '+' : '')}${(diff / Math.abs(a) * 100).toFixed(1)}%)` : '';
      return `<div class="kpi"><div class="k">${k}</div>
        <div class="v"><span><span class="dot" style="background:var(--a)"></span> A</span><b>${f(a)}</b></div>
        <div class="v"><span><span class="dot" style="background:var(--b)"></span> B</span><b>${f(b)}</b></div>
        <div class="d ${cls}">${cls === 'same' ? '相同' : (good ? '▲ B 較好' : '▼ B 較差')}${rel}</div></div>`;
    }).join('');

    chart('cEquity').setOption({ animation: false, grid: { left: 54, right: 14, top: 28, bottom: 52 }, tooltip: tl, legend,
      xAxis: { type: 'category', data: dates, ...axisCommon, splitLine: { show: false } }, yAxis: yW,
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 8, borderColor: C.line }],
      series: [lineSeries('A ' + ca.name, A.cum, C.a), lineSeries('B ' + cb.name, B.cum, C.b)] }, true);
    chart('cDD').setOption({ animation: false, grid: { left: 54, right: 14, top: 28, bottom: 52 }, tooltip: tl, legend,
      xAxis: { type: 'category', data: dates, ...axisCommon, splitLine: { show: false } }, yAxis: { ...yW, max: 0 },
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 8, borderColor: C.line }],
      series: [lineSeries('A ' + ca.name, A.dd, C.a), lineSeries('B ' + cb.name, B.dd, C.b)] }, true);
    const yearAgg = x => { const m = new Map(); x.forEach((v, i) => { const y = dates[i].slice(0, 4); m.set(y, (m.get(y) || 0) + v); }); return m; };
    const ya = yearAgg(series(state.a)), yb = yearAgg(series(state.b)), years = [...ya.keys()];
    chart('cYear').setOption({ animation: false, grid: { left: 54, right: 14, top: 28, bottom: 28 }, tooltip: tb, legend,
      xAxis: { type: 'category', data: years, ...axisCommon, splitLine: { show: false } }, yAxis: yW,
      series: [barS('A ' + ca.name, years.map(y => ya.get(y)), C.a), barS('B ' + cb.name, years.map(y => yb.get(y)), C.b)] }, true);
    const fullA = metrics(D.daily[state.a].map(v => v * (state.scaled ? ca.scale : 1)), D.dates).mon;
    const fullB = metrics(D.daily[state.b].map(v => v * (state.scaled ? cb.scale : 1)), D.dates).mon;
    const m24 = [...fullA.keys()].slice(-24);
    chart('cMonth').setOption({ animation: false, grid: { left: 54, right: 14, top: 28, bottom: 28 }, tooltip: tb, legend,
      xAxis: { type: 'category', data: m24, ...axisCommon, splitLine: { show: false } }, yAxis: yW,
      series: [barS('A ' + ca.name, m24.map(m => fullA.get(m)), C.a), barS('B ' + cb.name, m24.map(m => fullB.get(m)), C.b)] }, true);

    renderMatrix(all, base);
    renderCfgTable(all, base);

    const pm0 = periodStart(state.period).slice(0, 7);
    const mIdx = D.months.map((m, i) => [m, i]).filter(([m]) => m >= pm0).map(([, i]) => i);
    const S = D.strategies, wB = D.strat_weight[state.b], pB = D.strat_month[state.b], p0 = D.strat_month_before;
    const onData = [];
    S.forEach((s, j) => mIdx.forEach((mi, k) => {
      if (p0[j].slice(0, mi + 1).some(v => v !== 0) || wB[j][mi] > 0) onData.push([k, j, wB[j][mi]]);
    }));
    const yCat = { type: 'category', data: S, ...axisCommon, inverse: true, triggerEvent: true,
                   axisLabel: { ...axisCommon.axisLabel, fontSize: 11, interval: 0 } };
    const heatGrid = { left: 150, right: 20, top: 8, bottom: 70 };
    chart('cOnOff').setOption({ animation: false, grid: heatGrid,
      tooltip: { ...tooltipCommon, formatter: p => p.componentType !== 'series' ? '' : (() => { const j = p.value[1], mi = mIdx[p.value[0]];
        return `${S[j]}　${D.months[mi]}<br>平均倍數 ${p.value[2].toFixed(2)}<br>評價前 ${fmtW(p0[j][mi])} 萬　·　B ${fmtW(pB[j][mi])} 萬`; })() },
      xAxis: { type: 'category', data: mIdx.map(i => D.months[i]), ...axisCommon, splitLine: { show: false } }, yAxis: yCat,
      visualMap: { min: 0, max: 2, calculable: false, orient: 'horizontal', left: 'center', bottom: 6, itemWidth: 12, itemHeight: 140,
        text: ['2 倍', '0（關）'], textStyle: { color: C.ink2, fontSize: 11 },
        inRange: { color: ['#efeeea', '#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'] } },
      series: [{ type: 'heatmap', progressive: 0, data: onData, itemStyle: { borderColor: C.surface, borderWidth: 1 } }] }, true);
    const last24 = D.months.map((m, i) => i).slice(-24);
    const src = state.heat === 'before' ? p0 : state.heat === 'b' ? pB : pB.map((r, j) => r.map((v, i) => v - p0[j][i]));
    const hd = []; let mx = 1;
    S.forEach((s, j) => last24.forEach((mi, k) => { const v = src[j][mi]; hd.push([k, j, v]); mx = Math.max(mx, Math.abs(v)); }));
    mx = Math.min(mx, [...hd].map(r => Math.abs(r[2])).sort((a, b) => a - b)[Math.floor(hd.length * 0.97)] || mx);
    chart('cHeat').setOption({ animation: false, grid: heatGrid,
      tooltip: { ...tooltipCommon, formatter: p => p.componentType !== 'series' ? '' : (() => { const j = p.value[1], mi = last24[p.value[0]];
        return `${S[j]}　${D.months[mi]}<br>評價前 ${fmtW(p0[j][mi])} 萬　·　B ${fmtW(pB[j][mi])} 萬　·　B 倍數 ${wB[j][mi].toFixed(2)}`; })() },
      xAxis: { type: 'category', data: last24.map(i => D.months[i]), ...axisCommon, splitLine: { show: false } }, yAxis: yCat,
      visualMap: { min: -mx, max: mx, calculable: false, orient: 'horizontal', left: 'center', bottom: 6, itemWidth: 12, itemHeight: 160,
        text: ['賺', '賠'], textStyle: { color: C.ink2, fontSize: 11 },
        inRange: { color: ['#0f5c27', '#1f8a3b', '#8fc79c', '#f0efec', '#f2a29f', '#c9302c', '#7f1d1a'] } },
      series: [{ type: 'heatmap', progressive: 0, data: hd, itemStyle: { borderColor: C.surface, borderWidth: 1 } }] }, true);
    for (const id of ['cOnOff', 'cHeat']) {
      chart(id).off('click');
      chart(id).on('click', p => {
        if (p.componentType === 'yAxis') selectStrategy(S.indexOf(p.value));
        else if (p.componentType === 'series') selectStrategy(p.value[1]);
      });
    }
    renderStratTable(mIdx);
    renderStrat();
  }

  function renderMatrix(all, base) {
    const m = Object.fromEntries(all.map(r => [r.c.key, r.m]));
    const cls = (v, b, hib = true) => v == null || b == null ? '' : (hib ? v > b : v < b) ? 'pos' : (hib ? v < b : v > b) ? 'neg' : '';
    const cell = key => {
      const r = m[key]; if (!r) return '<td>—</td>';
      const sel = key === state.b ? ' style="outline:2px solid var(--b);outline-offset:-2px;cursor:pointer"' : ' style="cursor:pointer"';
      return `<td data-k="${key}"${sel}><span class="${cls(r.sharpe, base.sharpe)}">${fmt2(r.sharpe)}</span> ／ `
        + `<span class="${cls(r.nd, base.nd)}">${fmt1(r.nd)}</span> ／ <span class="${cls(r.loseM, base.loseM, false)}">${pct0(r.loseM)}</span></td>`;
    };
    const keys = D.configs.filter(c => c.key.startsWith('GATE'));
    const looks = [...new Set(keys.map(c => +c.key.split('_')[1]))];
    const tops = [...new Set(keys.map(c => +c.key.slice(4).split('_')[0]))].sort((a, b) => a - b);
    $('tMatrix').innerHTML = `<thead><tr><th>Sortino 回溯</th><th>X1_v2 倍數</th><th>門檻</th>${tops.map(n => `<th>前 ${n}</th>`).join('')}</tr></thead>
      <tbody><tr><td>評價前</td><td colspan="${tops.length + 2}" style="text-align:left">${fmt2(base.sharpe)} ／ ${fmt1(base.nd)} ／ ${pct0(base.loseM)}（對照基準）</td></tr>
      ${looks.map(L => `<tr><td>${L} 天${L === 250 ? '<span class="tag">現行</span>' : ''}</td>${cell('X1V2_' + L)}${cell('CUT_' + L)}${tops.map(n => cell(`GATE${n}_${L}`)).join('')}</tr>`).join('')}</tbody>`;
    const ls = D.configs.filter(c => c.key.startsWith('LS'));
    const lsLooks = [...new Set(ls.map(c => +c.key.split('_')[1]))];
    const lsTops = [...new Set(ls.map(c => +c.key.slice(2).split('_')[0]))].sort((a, b) => a - b);
    $('tMatrixLS').innerHTML = `<thead><tr><th>Sortino 回溯</th>${lsTops.map(n => `<th>各前 ${n}</th>`).join('')}</tr></thead>
      <tbody>${lsLooks.map(L => `<tr><td>${L} 天</td>${lsTops.map(n => cell(`LS${n}_${L}`)).join('')}</tr>`).join('')}</tbody>`;
    for (const t of ['tMatrix', 'tMatrixLS'])
      $(t).querySelectorAll('td[data-k]').forEach(td => td.onclick = () => { state.b = td.dataset.k; render(); });
  }

  let cfgSort = { col: 'nd', dir: -1 };
  function renderCfgTable(all, base) {
    const cols = [['name', '設定'], ['kind', '類型'], ['net', '淨利(萬)'], ['mdd', '最大回撤(萬)'], ['nd', '淨利/回撤'],
                  ['sharpe', 'Sharpe'], ['loseM', '虧損月'], ['worstM', '最差月(萬)'], ['scale', '同曝險倍數']];
    const rows = all.map(r => ({ key: r.c.key, name: r.c.name, kind: KIND[r.c.kind], scale: r.c.scale, ...r.m }));
    rows.sort((x, y) => { const a = x[cfgSort.col], b = y[cfgSort.col];
      return typeof a === 'string' ? a.localeCompare(b) * cfgSort.dir : ((a ?? -1e18) - (b ?? -1e18)) * cfgSort.dir; });
    const cell = (r, c) => {
      const v = r[c];
      if (c === 'name') return `${v}<span class="tag">${r.key}</span>`;
      if (c === 'kind') return v;
      if (c === 'net' || c === 'mdd' || c === 'worstM') return fmtW(v);
      if (c === 'loseM') return pct0(v);
      if (c === 'scale') return v.toFixed(2);
      if (c === 'nd') return `<span class="${v > base.nd ? 'pos' : v < base.nd ? 'neg' : ''}">${fmt1(v)}</span>`;
      if (c === 'sharpe') return `<span class="${v > base.sharpe ? 'pos' : v < base.sharpe ? 'neg' : ''}">${fmt2(v)}</span>`;
      return v;
    };
    $('tCfg').innerHTML = `<thead><tr>${cols.map(([c, l]) => `<th data-c="${c}">${l}${cfgSort.col === c ? (cfgSort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr data-k="${r.key}" class="clickable ${r.key === state.a ? 'sel-a' : ''} ${r.key === state.b ? 'sel-b' : ''}">
        ${cols.map(([c]) => `<td>${cell(r, c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
    $('tCfg').querySelectorAll('th').forEach(th => th.onclick = () => {
      const c = th.dataset.c; cfgSort = { col: c, dir: cfgSort.col === c ? -cfgSort.dir : -1 }; render(); });
    $('tCfg').querySelectorAll('tbody tr').forEach(tr => tr.onclick = () => { state.b = tr.dataset.k; render(); });
  }

  let stSort = { col: 'diff', dir: -1 };
  function renderStratTableHighlight() {
    $('tStrat').querySelectorAll('tbody tr[data-j]').forEach(tr => tr.classList.toggle('cur', +tr.dataset.j === state.strat));
  }
  function renderStratTable(mIdx) {
    const S = D.strategies, p0 = D.strat_month_before, pa = D.strat_month[state.a], pb = D.strat_month[state.b], wb = D.strat_weight[state.b];
    const ka = state.scaled ? cfgByKey[state.a].scale : 1, kb = state.scaled ? cfgByKey[state.b].scale : 1;
    const last12 = D.months.map((m, i) => i).slice(-12);
    const sum = (arr, idx) => idx.reduce((s, i) => s + arr[i], 0);
    const rows = S.map((s, j) => {
      const before = sum(p0[j], mIdx), a = sum(pa[j], mIdx) * ka, b = sum(pb[j], mIdx) * kb;
      const live = mIdx.filter(i => p0[j].slice(0, i + 1).some(v => v !== 0));
      const on = live.length ? live.filter(i => wb[j][i] > 0).length / live.length : null;
      const avgw = live.length ? live.reduce((t, i) => t + wb[j][i], 0) / live.length : null;
      return { j, s, before, a, b, diff: b - a, on, avgw, r12b: sum(p0[j], last12), r12: sum(pb[j], last12) * kb };
    });
    const cols = [['s', '策略'], ['before', '評價前(萬)'], ['a', 'A(萬)'], ['b', 'B(萬)'], ['diff', 'B − A(萬)'],
                  ['on', 'B 開啟比例'], ['avgw', 'B 平均倍數'], ['r12b', '近12月 評價前'], ['r12', '近12月 B']];
    rows.sort((x, y) => { const a = x[stSort.col], b = y[stSort.col];
      return typeof a === 'string' ? a.localeCompare(b) * stSort.dir : ((a ?? -1e18) - (b ?? -1e18)) * stSort.dir; });
    const money = v => `<span class="${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${fmtW(v)}</span>`;
    const tot = k => rows.reduce((t, r) => t + (r[k] || 0), 0);
    $('tStrat').innerHTML = `<thead><tr>${cols.map(([c, l]) => `<th data-c="${c}">${l}${stSort.col === c ? (stSort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr class="clickable" data-j="${r.j}"><td>${r.s}</td><td>${money(r.before)}</td><td>${money(r.a)}</td><td>${money(r.b)}</td><td>${money(r.diff)}</td>
        <td>${pct0(r.on)}</td><td>${r.avgw == null ? '—' : r.avgw.toFixed(2)}</td><td>${money(r.r12b)}</td><td>${money(r.r12)}</td></tr>`).join('')}
        <tr style="font-weight:600"><td>合計</td><td>${money(tot('before'))}</td><td>${money(tot('a'))}</td><td>${money(tot('b'))}</td><td>${money(tot('diff'))}</td>
        <td></td><td></td><td>${money(tot('r12b'))}</td><td>${money(tot('r12'))}</td></tr></tbody>`;
    $('tStrat').querySelectorAll('th').forEach(th => th.onclick = () => {
      const c = th.dataset.c; stSort = { col: c, dir: stSort.col === c ? -stSort.dir : -1 }; render(); });
    $('tStrat').querySelectorAll('tbody tr[data-j]').forEach(tr => tr.onclick = () => selectStrategy(+tr.dataset.j));
    renderStratTableHighlight();
  }

  render();
  return () => {
    window.removeEventListener('resize', onResize);
    Object.values(charts).forEach(c => c.dispose());
    root.innerHTML = '';
    root.classList.remove('qbd');
  };
}
