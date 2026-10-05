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
  --ink:#0b0b0b; --ink-2:#52514e; --ink-3:#85847e; --a:#2a78d6; --b:#eb6834; --c:#4a3aa7; --up:#c9302c; --down:#1f8a3b;
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
.qbd input[type=number] { font:inherit; font-size:13px; padding:4px 8px; border:1px solid var(--line-strong); border-radius:8px;
  background:var(--surface); color:var(--ink); width:9.5em; min-height:34px; }
.qbd .calc { display:grid; gap:4px 16px; grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr)); margin-top:8px; font-size:13px; }
.qbd .calc b { font-variant-numeric:tabular-nums; }
.qbd .best td { background:#fff4ec; }
.qbd table.yr td:first-child, .qbd table.yr th:first-child { position:sticky; left:0; background:var(--surface); z-index:1; }
.qbd table.yr tr.tot td { font-weight:600; border-top:2px solid var(--line-strong); }
.qbd table.yr td.gap, .qbd table.yr th.gap { border-left:2px solid var(--line-strong); }
`;

const HTML = `
<h1 data-id="title">QB 策略層評價看板</h1>
<div class="sub" data-id="meta"></div>
<div class="note" data-id="srcNote">資料：Export\\*.csv（每個策略拆成多方 _L、空方 _S；<b>Activate\\ 未使用</b>，避免事後挑選的偏差）。
  所有分數只用「前一天收盤以前」的資料。「QB 序位」「QB 分多空」照複製版 QB 規則逐日模擬（名次、名額、部位歸零才出、取整）；
  沒有計入 QB 專案層的動能配置上限。</div>
<div class="filters">
  <label><span class="dot" style="background:var(--a)"></span>A<select data-id="selA"></select></label>
  <label><span class="dot" style="background:var(--b)"></span>B<select data-id="selB"></select></label>
  <div class="lbl">期間 <span class="seg" data-id="segPeriod"></span></div>
  <div class="lbl">部位大小 <span class="seg" data-id="segScale"></span></div>
</div>
<div class="card verdict" data-id="verdict"></div>
<div class="card mt" data-id="blendCard" hidden>
  <h2>v18 ＋ QB 組合（資金層級）</h2>
  <div class="note" data-id="blendNote"></div>
  <div class="legend-row"><span>QB 用 <span class="seg" data-id="segBlend"></span></span></div>
  <div class="tbl-wrap"><table data-id="tBlend"></table></div>
  <div class="note mt">組合權益（對數刻度，起點 = 1）</div>
  <div data-id="cBlend" class="chart"></div>
  <h2 class="mt">資金配置計算器</h2>
  <div class="note">依「兩邊年化波動的比例」算出 QB 專案的動能轉換率與大約口數（QB 為上面所選的設定）。</div>
  <div class="legend-row">
    <span>v18 資金 <input type="number" data-id="inV18" value="10000000" step="1000000"></span>
    <span>QB 專案資金 <input type="number" data-id="inQB" value="10000000" step="1000000"></span>
    <span>v18 佔波動 <select data-id="inW"><option value="0.8">80%</option><option value="0.7">70%</option>
      <option value="0.6">60%</option><option value="0.5" selected>50%</option><option value="0.4">40%</option></select></span>
  </div>
  <div class="calc" data-id="calcOut"></div>
</div>
<div class="card mt" data-id="levCard" hidden>
  <h2>總帳戶槓桿控制（Level-2）</h2>
  <div class="note" data-id="levNote"></div>
  <div class="legend-row"><label>方法 <select data-id="selLev"></select></label><span>點下表任一列也可以切換；灰線＝固定槓桿（基準）</span></div>
  <div class="grid g2">
    <div><div class="note">累積損益（帳戶資金的 %）</div><div data-id="cLevEq" class="chart"></div></div>
    <div><div class="note">回撤（帳戶資金的 %）</div><div data-id="cLevDD" class="chart"></div></div>
  </div>
  <div class="note mt">槓桿倍數（已縮放成平均 1 倍；0＝停止下單）</div>
  <div data-id="cLevL" class="chart short"></div>
  <div class="tbl-wrap mt"><table data-id="tLev"></table></div>
</div>
<div class="card mt">
  <h2>QB 序位 × Sortino 回溯期（所選期間）</h2>
  <div class="note">每格：Sharpe ／ 淨利÷回撤 ／ 虧損月比例。紅字＝比評價前好、綠字＝比評價前差（台股慣例）。點格子設為 B。
    「門檻」＝最小動能門檻（分數 &gt; 0 才做）；「前 N」＝單一分類，策略有部位、名次 ≤ N、列表有空位就進入，部位歸零才移出。</div>
  <div class="tbl-wrap"><table data-id="tMatrix"></table></div>
  <h2 class="mt">QB 分多空（多方、空方兩個策略分類，各自序位）</h2>
  <div class="note">_L 策略放「多方」分類、_S 放「空方」分類，各自設序位 N（複製版 QB 已支援，不用改程式）。</div>
  <div class="tbl-wrap"><table data-id="tMatrixLS"></table></div>
</div>
<h2 class="mt">重點指標（A → B → C）</h2>
<div class="note" data-id="kpiNote"></div>
<div class="kpis mt" data-id="kpis"></div>
<div class="grid g2 mt">
  <div class="card"><h2>累積損益</h2><div class="note">單位：萬元</div><div data-id="cEquity" class="chart"></div></div>
  <div class="card"><h2>回撤（離前高多遠）</h2><div class="note">單位：萬元；越淺越好</div><div data-id="cDD" class="chart"></div></div>
  <div class="card"><h2>各年度損益</h2><div class="note">單位：萬元</div><div data-id="cYear" class="chart"></div></div>
  <div class="card"><h2>近 24 個月 每月損益</h2><div class="note">單位：萬元</div><div data-id="cMonth" class="chart"></div></div>
</div>
<div class="card mt">
  <h2>每年績效（評價前 → A → B）</h2>
  <div class="note">整個策略組合每一年的淨利與當年最大回撤（萬元）。評價前＝每個策略固定 1 倍。紅＝賺、綠＝賠；「B − 評價前」紅字代表評價後比較好。部位大小跟著上方「原始／同曝險」。</div>
  <div class="tbl-wrap"><table class="yr" data-id="tYearTot"></table></div>
  <h2 class="mt">每個策略每年損益</h2>
  <div class="legend-row"><span>顯示 <span class="seg" data-id="segYMode"></span></span><span>單位：萬元；點策略名稱看績效曲線</span></div>
  <div class="tbl-wrap"><table class="yr" data-id="tStratYear"></table></div>
  <h2 class="mt">每個策略每月損益</h2>
  <div class="legend-row"><label>年度 <select data-id="selMYear"></select></label><span>顯示方式同上（評價前／B 評價後／B − 評價前）</span></div>
  <div class="tbl-wrap"><table class="yr" data-id="tStratMonth"></table></div>
  <div class="note">策略加總與上方組合數字可能差幾萬：QB 序位設定的組合損益含取整後的實際口數，策略明細用「動能倍數 × 原始損益」估算。</div>
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

export function mountQbDashboard(root, D, echarts, loadWeek, loadBlend, opts = {}) {
  const style = document.createElement('style');
  style.textContent = CSS;
  root.classList.add('qbd');
  root.innerHTML = HTML;
  root.prepend(style);
  const $ = id => root.querySelector(`[data-id="${id}"]`);
  // 同一份看板也給 Activate 版（#/QBA）用：標題與資料說明可以換
  if (opts.title) $('title').textContent = opts.title;
  if (opts.note) $('srcNote').innerHTML = opts.note;
  const cfgByKey = Object.fromEntries(D.configs.map(c => [c.key, c]));
  const KIND = { baseline: '評價前', x1: 'X1 設定', qb: 'QB 設定', theory: '理論（QB 未支援）' };
  const C = { a: '#2a78d6', b: '#eb6834', c: '#4a3aa7', up: '#c9302c', down: '#1f8a3b', ink2: '#52514e', ink3: '#85847e',
              line: '#e2e1dc', surface: '#fcfcfb', before: '#85847e' };
  const fmtW = v => v == null || !isFinite(v) ? '—' : (Math.round(v / 1e4) || 0).toLocaleString('zh-TW');   // || 0：不顯示「-0」
  const fmt2 = v => v == null || !isFinite(v) ? '—' : v.toFixed(2);
  const fmt1 = v => v == null || !isFinite(v) ? '—' : v.toFixed(1);
  const pct0 = v => v == null || !isFinite(v) ? '—' : (v * 100).toFixed(0) + '%';
  // 預設 B：使用者定案的設定（10/05：分多空各序位 15、Sortino 250），沒有就退回其他
  const defB = ['LS15_250', 'LS10_500', 'GATE15_250'].find(k => cfgByKey[k]) ?? D.configs[1].key;
  const state = { a: 'EQ', b: defB, period: '全期', scaled: false, heat: 'before', strat: 0, ymode: 'b', myear: D.months[D.months.length - 1].slice(0, 4) };
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
  // C＝B 再套用總帳戶自動槓桿（海龜風控，與 Release\@QB_Level2_Turtle.txt 同一套算法）：
  // 參考帳戶＝B 的權益；一階回撤＝參考帳戶「至今」年化波動 × 0.25；每階縮 10%，最低 0.2 倍；前 60 天不調整；只用前一天以前的資料
  const levCache = {};
  function autoLev(x) {
    const lev = new Array(x.length).fill(1);
    let eq = 0, pk = 0, s1 = 0, s2 = 0, cur = 1;
    for (let i = 0; i < x.length; i++) {
      lev[i] = cur;                                  // 今天用昨天算好的槓桿
      eq += x[i]; pk = Math.max(pk, eq); s1 += x[i]; s2 += x[i] * x[i];
      const n = i + 1;
      const vol = n > 1 ? Math.sqrt(Math.max(0, (s2 - s1 * s1 / n) / (n - 1))) * Math.sqrt(252) : 0;
      cur = n >= 60 && vol > 0 ? Math.max(0.2, 1 - 0.1 * Math.floor((pk - eq) / (vol * 0.25))) : 1;
    }
    return lev;
  }
  function seriesC(key) {
    const k = state.scaled ? cfgByKey[key].scale : 1;
    const ck = key + '|' + k;
    if (!levCache[ck]) { const full = D.daily[key].map(v => v * k); const lv = autoLev(full); levCache[ck] = { pnl: full.map((v, i) => v * lv[i]), lev: lv }; }
    const [i0, i1] = idxRange();
    return levCache[ck].pnl.slice(i0, i1);
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
    const A = metrics(series(state.a), dates), B = metrics(series(state.b), dates), Cm = metrics(seriesC(state.b), dates);
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

    $('kpiNote').textContent = `A＝${ca.name}；B＝${cb.name}（${cb.desc}）。${state.scaled ? '同曝險：部位已調整成與評價前相同的平均在場倍數（B ×' + cb.scale.toFixed(2) + '）。' : '原始：照設定的倍數，不調整。'}`
      + `C＝B 再加上總帳戶自動槓桿（海龜風控：參考帳戶回撤每滿「年化波動 × 0.25」縮小 10%，最低 0.2 倍，收復後恢復；MultiCharts 指標 @QB_Level2_Turtle 同算法），`
      + `所選期間平均槓桿 ${(() => { const l = levCache[state.b + '|' + (state.scaled ? cb.scale : 1)].lev; const [i0, i1] = idxRange(); const x = l.slice(i0, i1); return (x.reduce((t, v) => t + v, 0) / x.length).toFixed(2); })()} 倍。`;
    const kp = [['淨利（萬）', A.net, B.net, Cm.net, fmtW, true], ['最大回撤（萬）', A.mdd, B.mdd, Cm.mdd, fmtW, false],
                ['淨利 / 回撤', A.nd, B.nd, Cm.nd, fmt1, true], ['Sharpe', A.sharpe, B.sharpe, Cm.sharpe, fmt2, true],
                ['虧損月比例', A.loseM, B.loseM, Cm.loseM, pct0, false], ['最差單月（萬）', A.worstM, B.worstM, Cm.worstM, fmtW, true]];
    const delta = (x, y, hib, who, vs) => {
      const diff = (y ?? 0) - (x ?? 0);
      const good = hib ? diff > 0 : diff < 0;
      const cls = Math.abs(diff) < 1e-9 ? 'same' : good ? 'better' : 'worse';
      const rel = x ? ` (${(diff / Math.abs(x) * 100 >= 0 ? '+' : '')}${(diff / Math.abs(x) * 100).toFixed(1)}%)` : '';
      return `<div class="d ${cls}">${who} 比 ${vs}：${cls === 'same' ? '相同' : (good ? '▲ 較好' : '▼ 較差')}${cls === 'same' ? '' : rel}</div>`;
    };
    $('kpis').innerHTML = kp.map(([k, a, b, c, f, hib]) => `<div class="kpi"><div class="k">${k}</div>
        <div class="v"><span><span class="dot" style="background:var(--a)"></span> A</span><b>${f(a)}</b></div>
        <div class="v"><span><span class="dot" style="background:var(--b)"></span> B</span><b>${f(b)}</b></div>
        <div class="v"><span><span class="dot" style="background:var(--c)"></span> C</span><b>${f(c)}</b></div>
        ${delta(a, b, hib, 'B', 'A')}${delta(b, c, hib, 'C', 'B')}</div>`).join('');

    chart('cEquity').setOption({ animation: false, grid: { left: 54, right: 14, top: 28, bottom: 52 }, tooltip: tl, legend,
      xAxis: { type: 'category', data: dates, ...axisCommon, splitLine: { show: false } }, yAxis: yW,
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 8, borderColor: C.line }],
      series: [lineSeries('A ' + ca.name, A.cum, C.a), lineSeries('B ' + cb.name, B.cum, C.b), lineSeries('C B＋自動槓桿', Cm.cum, C.c)] }, true);
    chart('cDD').setOption({ animation: false, grid: { left: 54, right: 14, top: 28, bottom: 52 }, tooltip: tl, legend,
      xAxis: { type: 'category', data: dates, ...axisCommon, splitLine: { show: false } }, yAxis: { ...yW, max: 0 },
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 8, borderColor: C.line }],
      series: [lineSeries('A ' + ca.name, A.dd, C.a), lineSeries('B ' + cb.name, B.dd, C.b), lineSeries('C B＋自動槓桿', Cm.dd, C.c)] }, true);
    const yearAgg = x => { const m = new Map(); x.forEach((v, i) => { const y = dates[i].slice(0, 4); m.set(y, (m.get(y) || 0) + v); }); return m; };
    const ya = yearAgg(series(state.a)), yb = yearAgg(series(state.b)), yc = yearAgg(seriesC(state.b)), years = [...ya.keys()];
    chart('cYear').setOption({ animation: false, grid: { left: 54, right: 14, top: 28, bottom: 28 }, tooltip: tb, legend,
      xAxis: { type: 'category', data: years, ...axisCommon, splitLine: { show: false } }, yAxis: yW,
      series: [barS('A ' + ca.name, years.map(y => ya.get(y)), C.a), barS('B ' + cb.name, years.map(y => yb.get(y)), C.b),
               barS('C B＋自動槓桿', years.map(y => yc.get(y)), C.c)] }, true);
    const fullA = metrics(D.daily[state.a].map(v => v * (state.scaled ? ca.scale : 1)), D.dates).mon;
    const fullB = metrics(D.daily[state.b].map(v => v * (state.scaled ? cb.scale : 1)), D.dates).mon;
    const fullC = metrics(levCache[state.b + '|' + (state.scaled ? cb.scale : 1)].pnl, D.dates).mon;
    const m24 = [...fullA.keys()].slice(-24);
    chart('cMonth').setOption({ animation: false, grid: { left: 54, right: 14, top: 28, bottom: 28 }, tooltip: tb, legend,
      xAxis: { type: 'category', data: m24, ...axisCommon, splitLine: { show: false } }, yAxis: yW,
      series: [barS('A ' + ca.name, m24.map(m => fullA.get(m)), C.a), barS('B ' + cb.name, m24.map(m => fullB.get(m)), C.b),
               barS('C B＋自動槓桿', m24.map(m => fullC.get(m)), C.c)] }, true);

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
    renderYearly();
    renderStrat();
  }

  // ── 每年／每月明細（2026-10-05 使用者要求：每個策略每年評價前後、每年整體總和、每月）──
  function renderYearly() {
    seg($('segYMode'), [['before', '評價前'], ['b', 'B 評價後'], ['diff', 'B − 評價前']], () => state.ymode, v => state.ymode = v);
    const kOf = key => state.scaled ? cfgByKey[key].scale : 1;
    const money = v => `<span class="${v > 0.5 ? 'pos' : v < -0.5 ? 'neg' : ''}">${fmtW(v)}</span>`;
    // 組合：依年度切日損益，算淨利與當年最大回撤
    const yearly = key => {
      const k = kOf(key), out = new Map();
      D.daily[key].forEach((v, i) => {
        const y = D.dates[i].slice(0, 4);
        let r = out.get(y); if (!r) out.set(y, r = { net: 0, peak: 0, mdd: 0 });
        r.net += v * k; r.peak = Math.max(r.peak, r.net); r.mdd = Math.max(r.mdd, r.peak - r.net);
      });
      return out;
    };
    const e = yearly('EQ'), a = yearly(state.a), b = yearly(state.b), years = [...e.keys()];
    const ca = cfgByKey[state.a], cb = cfgByKey[state.b];
    const tot = (m, f) => years.reduce((t, y) => t + f(m.get(y)), 0);
    const nd = r => r.mdd > 0 ? fmt1(r.net / r.mdd) : '—';
    $('tYearTot').innerHTML = `<thead><tr><th>年度</th><th class="gap">評價前 淨利</th><th>回撤</th><th>淨利/回撤</th>
        <th class="gap" style="color:${C.a}">A 淨利</th><th>回撤</th><th class="gap" style="color:${C.b}">B 淨利</th><th>回撤</th><th>淨利/回撤</th>
        <th class="gap">B − 評價前</th><th>B − A</th></tr></thead>
      <tbody>${years.map(y => { const E = e.get(y), Ar = a.get(y), Br = b.get(y);
        return `<tr><td>${y}</td><td class="gap">${money(E.net)}</td><td>${fmtW(E.mdd)}</td><td>${nd(E)}</td>
          <td class="gap">${money(Ar.net)}</td><td>${fmtW(Ar.mdd)}</td><td class="gap">${money(Br.net)}</td><td>${fmtW(Br.mdd)}</td><td>${nd(Br)}</td>
          <td class="gap">${money(Br.net - E.net)}</td><td>${money(Br.net - Ar.net)}</td></tr>`; }).join('')}
      <tr class="tot"><td>合計</td><td class="gap">${money(tot(e, r => r.net))}</td><td></td><td></td>
        <td class="gap">${money(tot(a, r => r.net))}</td><td></td><td class="gap">${money(tot(b, r => r.net))}</td><td></td><td></td>
        <td class="gap">${money(tot(b, r => r.net) - tot(e, r => r.net))}</td><td>${money(tot(b, r => r.net) - tot(a, r => r.net))}</td></tr>
      <tr><td class="note" colspan="11" style="text-align:left">A＝${ca.name}；B＝${cb.name}；${years[years.length - 1]} 年只到 ${D.range[1]}；${years[0]} 年從 ${D.range[0]} 起</td></tr></tbody>`;

    // 策略 × 年／月：評價前 = strat_month_before；B = strat_month[B] × 同曝險倍數
    const kb = kOf(state.b), p0 = D.strat_month_before, pb = D.strat_month[state.b], S = D.strategies;
    const val = (j, mi) => state.ymode === 'before' ? p0[j][mi] : state.ymode === 'b' ? pb[j][mi] * kb : pb[j][mi] * kb - p0[j][mi];
    const yIdx = {};
    D.months.forEach((m, i) => (yIdx[m.slice(0, 4)] ||= []).push(i));
    const ys = Object.keys(yIdx);
    const sumIdx = (j, idx) => idx.reduce((t, i) => t + val(j, i), 0);
    const strRow = (j, cells, total) => `<tr class="clickable" data-j="${j}"><td>${S[j]}</td>${cells.map(v => `<td>${money(v)}</td>`).join('')}<td class="gap">${money(total)}</td></tr>`;
    const colTot = idxs => idxs.map(idx => S.reduce((t, _, j) => t + sumIdx(j, idx), 0));
    const yt = colTot(ys.map(y => yIdx[y]));
    $('tStratYear').innerHTML = `<thead><tr><th>策略</th>${ys.map(y => `<th>${y}</th>`).join('')}<th class="gap">合計</th></tr></thead>
      <tbody>${S.map((_, j) => { const c = ys.map(y => sumIdx(j, yIdx[y])); return strRow(j, c, c.reduce((t, v) => t + v, 0)); }).join('')}
      <tr class="tot"><td>全部策略</td>${yt.map(v => `<td>${money(v)}</td>`).join('')}<td class="gap">${money(yt.reduce((t, v) => t + v, 0))}</td></tr></tbody>`;

    const ySel = $('selMYear');
    if (ySel.options.length !== ys.length) {
      ySel.innerHTML = '';
      [...ys].reverse().forEach(y => ySel.add(new Option(y, y)));
      ySel.onchange = ev => { state.myear = ev.target.value; renderYearly(); };
    }
    if (!yIdx[state.myear]) state.myear = ys[ys.length - 1];
    ySel.value = state.myear;
    const mi = yIdx[state.myear];
    const mt = colTot(mi.map(i => [i]));
    $('tStratMonth').innerHTML = `<thead><tr><th>策略</th>${mi.map(i => `<th>${+D.months[i].slice(5)} 月</th>`).join('')}<th class="gap">${state.myear} 合計</th></tr></thead>
      <tbody>${S.map((_, j) => { const c = mi.map(i => val(j, i)); return strRow(j, c, c.reduce((t, v) => t + v, 0)); }).join('')}
      <tr class="tot"><td>全部策略</td>${mt.map(v => `<td>${money(v)}</td>`).join('')}<td class="gap">${money(mt.reduce((t, v) => t + v, 0))}</td></tr></tbody>`;
    for (const t of ['tStratYear', 'tStratMonth'])
      $(t).querySelectorAll('tbody tr[data-j]').forEach(tr => tr.onclick = () => selectStrategy(+tr.dataset.j));
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

  // ── v18 ＋ QB 組合（資料另外一檔，載得到才顯示）──
  let B = null, blendKey = 'LS15_250';
  function renderBlend() {
    if (!B) return;
    if (!B.data[blendKey]) blendKey = Object.keys(B.data)[0];
    const d = B.data[blendKey];
    seg($('segBlend'), Object.keys(B.data).map(k => [k, B.qb_labels?.[k] || k]), () => blendKey, v => { blendKey = v; });
    $('segBlend').querySelectorAll('button').forEach((b, i) => {
      const k = Object.keys(B.data)[i];
      b.onclick = () => { blendKey = k; renderBlend(); };
    });
    $('blendNote').textContent = `v18 與 ${B.qb_labels?.[blendKey] || blendKey} 的日報酬相關 ${d.corr.toFixed(2)}、月報酬相關 ${d.monthly_corr.toFixed(2)}。` +
      `比例是「波動度」的比例（QB 已縮放成與 v18 同波動），每日再平衡。${B.note}（產生於 ${B.generated}）`;
    // 比例的鍵是 Python 寫出的字串（"1.0"、"0.8"…），用原字串查、用數值排序
    const ws = Object.keys(d.results).sort((a, b) => +b - +a);
    const cell = r => `${r.cagr}% ／ ${r.mdd}% ／ <b>${r.calmar}</b>`;
    $('tBlend').innerHTML = `<thead><tr><th>v18 比例</th><th>2012–2017 年化／MDD／Calmar</th><th>2018–2026 年化／MDD／Calmar</th>
      <th>全期 年化／MDD／Calmar</th><th>Sharpe</th></tr></thead><tbody>${ws.map(w => {
        const r = d.results[w], x = +w;
        const lab = x === 1 ? '只做 v18' : x === 0 ? '只做 QB' : `v18 ${Math.round(x * 100)}%＋QB ${Math.round((1 - x) * 100)}%`;
        return `<tr class="${x === 0.5 ? 'best' : ''}"><td>${lab}</td><td>${cell(r['前半'])}</td><td>${cell(r['後半'])}</td><td>${cell(r['全期'])}</td><td>${r['全期'].sharpe}</td></tr>`;
      }).join('')}</tbody>`;
    const cols = { 1: '#85847e', 0.8: C.a, 0.5: C.b, 0: '#4a3aa7' };
    const names = { 1: '只做 v18', 0.8: 'v18 80%＋QB 20%', 0.5: 'v18 50%＋QB 50%', 0: '只做 QB' };
    chart('cBlend').setOption({ animation: false, grid: { left: 54, right: 14, top: 28, bottom: 52 }, legend,
      tooltip: { ...tooltipCommon, trigger: 'axis', valueFormatter: v => (+v).toFixed(2) + ' 倍' },
      xAxis: { type: 'category', data: d.weeks, ...axisCommon, splitLine: { show: false } },
      yAxis: { type: 'log', ...axisCommon, axisLabel: { ...axisCommon.axisLabel, formatter: v => v + '×' } },
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 8, borderColor: C.line }],
      // 春節等整週休市的週沒有資料，線接起來
      series: Object.keys(d.curves).map(w => ({ ...lineSeries(names[+w] || w, d.curves[w], cols[+w] || C.ink2), connectNulls: true })) }, true);
    renderCalc();
  }
  function renderCalc() {
    if (!B || !B.sizing) { $('calcOut').innerHTML = '<span class="note">（缺 QB 基準數字）</span>'; return; }
    const sz = B.sizing;
    const V = +$('inV18').value || 0, Q = +$('inQB').value || 0, w = +$('inW').value;
    const target = V * B.v18_ann_vol * (1 - w) / w;               // QB 年化損益波動目標（元）
    const K = target / sz.qb_k1_ann_vol;                          // QB 規模倍數（K = 資金 × 轉換率 ÷ 1 億）
    const conv = Q > 0 ? K * 1e8 / Q : NaN;
    const n = v => v.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
    const p95 = Math.ceil(K * sz.qb_k1_pos_p95_last250);
    $('calcOut').innerHTML = `
      <div>v18 年化波動 <b>${(B.v18_ann_vol * 100).toFixed(1)}%</b> → v18 年化損益波動約 <b>${n(V * B.v18_ann_vol)}</b> 元</div>
      <div>QB 年化損益波動目標 <b>${n(target)}</b> 元（v18 的 ${((1 - w) / w).toFixed(2)} 倍）</div>
      <div>QB 規模倍數 K ＝ <b>${K.toFixed(4)}</b></div>
      <div>QB 專案「動能轉換率」設 <b>${isFinite(conv) ? conv.toFixed(3) : '—'}</b>（%；專案資金 ${n(Q)} 元）</div>
      <div>平均部位約 <b>${(K * sz.qb_k1_pos_mean).toFixed(1)}</b> 口${sz.contract}；近一年 95% 時間 ≤ <b>${p95}</b> 口</div>
      <div>保證金估計（${p95} 口 × ${n(sz.margin_per_contract_est)}）約 <b>${n(p95 * sz.margin_per_contract_est)}</b> 元</div>
      <div class="note" style="grid-column:1/-1">${sz.margin_note}。口數小於 5 時取整影響大，可考慮在 QB 商品設定「大轉小」改用小台（×4 口）。
        回測的 QB 是樣本內，建議先用計算結果的一半上線。</div>`;
  }
  for (const id of ['inV18', 'inQB', 'inW']) $(id).addEventListener('input', renderCalc);
  if (loadBlend) {
    Promise.resolve(loadBlend()).then(b => {
      if (!b || !b.data) return;
      B = b; $('blendCard').hidden = false; renderBlend();
    }).catch(() => {});
  }

  // ── 總帳戶槓桿控制（lev2_study.py；資料另一檔，opts.loadLev 載得到才顯示）──
  let LV = null, levSel = 0;
  function renderLev() {
    if (!LV) return;
    const base = D.daily[LV.cfg], C = LV.capital, ms = LV.methods, m = ms[levSel], b0 = ms[0];
    const sel = $('selLev');
    if (sel.options.length !== ms.length) {
      sel.innerHTML = '';
      ms.forEach((x, i) => sel.add(new Option(x.name, String(i))));
      sel.onchange = e => { levSel = +e.target.value; renderLev(); };
    }
    sel.value = String(levSel);
    $('levNote').innerHTML = `對象：<b>${cfgByKey[LV.cfg]?.name || LV.cfg}</b> 的組合權益（評價後）。槓桿只看「槓桿固定 1 倍的參考帳戶」前一天以前的表現（不偷看）。`
      + `每個方法都縮放成平均槓桿 1 倍才比較；帳戶資金設成讓參考帳戶年化波動 20%（約 ${fmtW(C)} 萬，只影響 % 的尺度）。`
      + `前半／後半以 ${LV.half_date} 切開。紅字＝比基準好、綠字＝比基準差。方法來自原版 QB 文件「進階管理模式（Level-2）」，另加拉回加碼；`
      + `「海龜風控（MultiCharts 指標版）」就是 Release\\@QB_Level2_Turtle.txt 的算法。`
      + `<b>判讀：要兩個策略池（#/QB、#/QBA）、前後半都變好，而且鄰近參數（例如通道 15／20／30 日）也都變好才算數；`
      + `只有單一參數特別好的（如高低通道 20 日）多半是巧合。</b>（產生於 ${LV.generated}）`;
    const cumOf = lev => { let t = 0, pk = 0; const c = [], d = []; base.forEach((v, i) => { t += v * lev[i] / C * 100; pk = Math.max(pk, t); c.push(t); d.push(t - pk); }); return [c, d]; };
    const [c0, d0] = cumOf(b0.lev), [c1, d1] = cumOf(m.lev);
    const pct = v => (+v).toFixed(1) + '%';
    const tlp = { ...tooltipCommon, trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: C_.ink3 } }, valueFormatter: pct };
    const yP = { type: 'value', ...axisCommon, axisLabel: { ...axisCommon.axisLabel, formatter: v => v + '%' } };
    const xD = { type: 'category', data: D.dates, ...axisCommon, splitLine: { show: false } };
    const zoom = [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 8, borderColor: C_.line }];
    chart('cLevEq').setOption({ animation: false, grid: { left: 54, right: 14, top: 28, bottom: 52 }, tooltip: tlp, legend, xAxis: xD, yAxis: yP, dataZoom: zoom,
      series: [lineSeries('固定槓桿（基準）', c0, C_.before), ...(levSel ? [lineSeries(m.name, c1, C_.b)] : [])] }, true);
    chart('cLevDD').setOption({ animation: false, grid: { left: 54, right: 14, top: 28, bottom: 52 }, tooltip: tlp, legend, xAxis: xD, yAxis: { ...yP, max: 0 }, dataZoom: zoom,
      series: [lineSeries('固定槓桿（基準）', d0, C_.before), ...(levSel ? [lineSeries(m.name, d1, C_.b)] : [])] }, true);
    chart('cLevL').setOption({ animation: false, grid: { left: 54, right: 14, top: 10, bottom: 24 },
      tooltip: { ...tooltipCommon, trigger: 'axis', valueFormatter: v => (+v).toFixed(2) + ' 倍' },
      xAxis: xD, yAxis: { type: 'value', ...axisCommon, min: 0 },
      series: [{ ...lineSeries(m.name, m.lev, C_.b, 1.5), step: 'end', sampling: undefined }] }, true);
    const cmp = (v, b, hib = true) => v == null || b == null || Math.abs(v - b) < 0.05 ? '' : (hib ? v > b : v < b) ? 'pos' : 'neg';
    const f1 = v => v == null ? '—' : v.toFixed(1);
    $('tLev').innerHTML = `<thead><tr><th>方法</th><th>淨利/回撤</th><th>前半</th><th>後半</th><th>最大回撤</th><th>Sharpe</th><th>最差年</th><th>原始平均槓桿</th><th>停止下單天數</th></tr></thead>
      <tbody>${ms.map((x, i) => `<tr class="clickable${i === levSel ? ' cur' : ''}" data-i="${i}"><td>${x.name}</td>
        <td><b class="${cmp(x.nd, b0.nd)}">${f1(x.nd)}</b></td><td class="${cmp(x.nd1, b0.nd1)}">${f1(x.nd1)}</td><td class="${cmp(x.nd2, b0.nd2)}">${f1(x.nd2)}</td>
        <td class="${cmp(x.mdd, b0.mdd, false)}">${f1(x.mdd)}%</td><td class="${cmp(x.sharpe, b0.sharpe)}">${x.sharpe?.toFixed(2) ?? '—'}</td>
        <td>${f1(x.worst_y)}%</td><td>${x.avg?.toFixed(2) ?? '—'}</td><td>${x.off ? (x.off * 100).toFixed(0) + '%' : '—'}</td></tr>`).join('')}</tbody>`;
    $('tLev').querySelectorAll('tbody tr').forEach(tr => tr.onclick = () => { levSel = +tr.dataset.i; renderLev(); });
  }
  const C_ = C;
  if (opts.loadLev) {
    Promise.resolve(opts.loadLev()).then(l => {
      if (!l || !l.methods || !D.daily[l.cfg]) return;
      LV = l; $('levCard').hidden = false;
      levSel = Math.max(0, l.methods.findIndex(x => x.name.includes('MultiCharts')));   // 預設看建議的方法
      renderLev();
    }).catch(() => {});
  }

  render();
  return () => {
    window.removeEventListener('resize', onResize);
    Object.values(charts).forEach(c => c.dispose());
    root.innerHTML = '';
    root.classList.remove('qbd');
  };
}
