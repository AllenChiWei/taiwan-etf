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
.qbd .grid { display:grid; gap:12px; } .qbd .g2 { grid-template-columns:minmax(0,1fr); }
@media (min-width: 1100px) { .qbd .g2 { grid-template-columns:minmax(0,1fr) minmax(0,1fr); } }
.qbd .filters { position:sticky; top:0; z-index:5; display:flex; flex-wrap:wrap; gap:10px 18px; align-items:center;
  background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:10px 14px; margin:14px 0; }
.qbd .filters label, .qbd .filters .lbl { display:flex; align-items:center; gap:6px; font-size:13px; color:var(--ink-2); }
.qbd select { font:inherit; font-size:13px; padding:4px 8px; border:1px solid var(--line-strong); border-radius:8px; background:var(--surface); color:var(--ink); max-width:100%; }
.qbd .seg { display:inline-flex; border:1px solid var(--line-strong); border-radius:8px; overflow:hidden; }
.qbd .seg button { font:inherit; font-size:13.5px; border:0; background:var(--surface); padding:6px 14px; min-height:36px; cursor:pointer; color:var(--ink-2); touch-action:manipulation; }
.qbd .seg button + button { border-left:1px solid var(--line); }
.qbd .filters label { min-width:0; max-width:100%; white-space:nowrap; } .qbd .filters select { min-width:0; flex:1 1 auto; }
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
.qbd .calc { display:grid; gap:4px 16px; grid-template-columns:minmax(0,1fr); margin-top:8px; font-size:13px; }
@media (min-width: 700px) { .qbd .calc { grid-template-columns:minmax(0,1fr) minmax(0,1fr); } }
.qbd .calc b { font-variant-numeric:tabular-nums; }
.qbd .best td { background:#fff4ec; }
.qbd table.yr td:first-child, .qbd table.yr th:first-child { position:sticky; left:0; background:var(--surface); z-index:1; }
.qbd table.yr tr.tot td { font-weight:600; border-top:2px solid var(--line-strong); }
.qbd table.yr td.gap, .qbd table.yr th.gap { border-left:2px solid var(--line-strong); }
.qbd .ov { display:grid; gap:12px; grid-template-columns:minmax(0,5fr) minmax(0,6fr); align-items:start; }
@media (max-width: 980px) { .qbd .ov { grid-template-columns:minmax(0,1fr); } }
.qbd table.kpi th, .qbd table.kpi td { padding:6px 8px; font-size:13px; }
.qbd table.kpi td b { font-size:14px; }
.qbd table.kpi .d { font-size:12px; white-space:nowrap; }
.qbd .tabs { display:flex; flex-wrap:wrap; gap:4px; margin:16px 0 10px; border-bottom:1px solid var(--line); }
.qbd .tabs button { font:inherit; font-size:14px; font-weight:600; border:0; background:none; color:var(--ink-2); padding:8px 14px;
  border-bottom:3px solid transparent; margin-bottom:-1px; cursor:pointer; min-height:40px; }
.qbd .tabs button[aria-selected="true"] { color:var(--ink); border-bottom-color:var(--b); }
.qbd .chart.mid { height:270px; } .qbd .chart.dd { height:170px; }
.qbd th.sortable { white-space:nowrap; }
.qbd .dinl { display:none; }
@media (max-width: 640px) {
  .qbd .tabs { flex-wrap:nowrap; overflow-x:auto; -webkit-overflow-scrolling:touch; }
  .qbd .tabs button { flex:0 0 auto; padding:8px 12px; }
  .qbd table.kpi .dcol { display:none; }
  .qbd .dinl { display:block; font-size:11px; font-weight:400; white-space:nowrap; }
  .qbd table.kpi th, .qbd table.kpi td { padding:5px 6px; font-size:12.5px; }
}
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
  <label><span class="dot" style="background:var(--c)"></span>C＝B＋<select data-id="selC"></select></label>
  <div class="lbl">期間 <span class="seg" data-id="segPeriod"></span></div>
  <div class="lbl">部位大小 <span class="seg" data-id="segScale"></span></div>
</div>
<div class="ov">
  <div class="card">
    <h2>重點指標（A → B → C）</h2>
    <div class="tbl-wrap"><table class="kpi" data-id="tKpi"></table></div>
    <div class="note mt" data-id="kpiNote"></div>
  </div>
  <div class="card">
    <h2>累積損益與回撤</h2><div class="note">單位：萬元；回撤＝離前高多遠，越淺越好</div>
    <div data-id="cEquity" class="chart mid"></div>
    <div data-id="cDD" class="chart dd"></div>
  </div>
</div>
<div class="tabs" role="tablist" data-id="tabs"></div>

<div data-tab="year">
  <div class="grid g2">
    <div class="card"><h2>各年度損益</h2><div class="note">單位：萬元</div><div data-id="cYear" class="chart"></div></div>
    <div class="card"><h2>近 24 個月 每月損益</h2><div class="note">單位：萬元</div><div data-id="cMonth" class="chart"></div></div>
  </div>
  <div class="card mt">
    <h2>每年績效（評價前 → A → B → C）</h2>
    <div class="note">整個策略組合每一年的淨利與當年最大回撤（萬元）。評價前＝每個策略固定 1 倍。紅＝賺、綠＝賠；差額欄紅字代表比較好。部位大小跟著上方「原始／同曝險」。</div>
    <div class="tbl-wrap"><table class="yr" data-id="tYearTot"></table></div>
    <h2 class="mt">每個策略每年損益</h2>
    <div class="legend-row"><span>顯示 <span class="seg" data-id="segYMode"></span></span><span>單位：萬元；點策略名稱看績效曲線</span></div>
    <div class="tbl-wrap"><table class="yr" data-id="tStratYear"></table></div>
    <h2 class="mt">每個策略每月損益</h2>
    <div class="legend-row"><label>年度 <select data-id="selMYear"></select></label><span>顯示方式同上（評價前／B 評價後／B − 評價前）</span></div>
    <div class="tbl-wrap"><table class="yr" data-id="tStratMonth"></table></div>
    <div class="note">策略加總與上方組合數字可能差幾萬：QB 序位設定的組合損益含取整後的實際口數，策略明細用「動能倍數 × 原始損益」估算。</div>
  </div>
</div>

<div data-tab="lev" hidden>
  <div class="card">
    <h2>總帳戶自動槓桿（Level-2）：套在目前的 B 上</h2>
    <div class="note" data-id="levNote"></div>
    <div class="tbl-wrap mt"><table data-id="tLev"></table></div>
    <div class="note mt">目前 C 的槓桿倍數（0＝停止下單）</div>
    <div data-id="cLevL" class="chart short"></div>
  </div>
  <div class="card mt" data-id="levResCard" hidden>
    <h2>研究結論：哪一類自動槓桿在兩種 QB 都有效</h2>
    <div class="note" data-id="levResNote"></div>
    <div class="legend-row"><span>篩選 <span class="seg" data-id="segLevRes"></span></span><span>點欄位名稱排序</span></div>
    <div class="tbl-wrap"><table data-id="tLevRes"></table></div>
    <ul class="note mt" data-id="levResDefs" style="padding-left:18px;margin:6px 0 0"></ul>
  </div>
</div>

<div data-tab="strat" hidden>
  <div class="card" data-id="stratCard">
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
    <h2>每個策略的貢獻（所選期間）</h2>
    <div class="note">評價前＝固定 1 倍；A、B＝套用該設定後的貢獻。開啟比例＝B 在期間內有給倍數的月份比例。點欄位名稱排序；<b>點列看該策略的績效曲線</b>。</div>
    <div class="tbl-wrap"><table data-id="tStrat"></table></div>
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
</div>

<div data-tab="cfg" hidden>
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
  <div class="card mt">
    <h2>所有設定比較</h2>
    <div class="note">點欄位名稱排序；點列可設為 B。「同曝險」＝把平均在場倍數調成與評價前相同後的淨利與回撤（淨利才可比；Sharpe、淨利/回撤不受部位大小影響）。</div>
    <div class="tbl-wrap"><table data-id="tCfg"></table></div>
  </div>
</div>

<div data-tab="blend" hidden>
  <div class="card" data-id="blendCard">
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
  const state = { a: 'EQ', b: defB, period: '全期', scaled: false, heat: 'before', strat: 0, ymode: 'b', c: 'slow', tab: 'year', myear: D.months[D.months.length - 1].slice(0, 4) };
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
  const TABS = [['year', '年度／月度'], ['lev', '自動槓桿'], ['strat', '策略明細'], ['cfg', '設定比較'], ['blend', 'v18＋QB']];
  function showTab(t) {
    state.tab = t;
    root.querySelectorAll('[data-tab]').forEach(el => { el.hidden = el.dataset.tab !== t; });
    $('tabs').querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.t === t)));
    requestAnimationFrame(() => Object.values(charts).forEach(c => c.resize()));   // 隱藏時建立的圖要重算大小
    saveState?.();
  }
  for (const [t, label] of TABS) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.t = t; b.textContent = label; b.setAttribute('role', 'tab');
    if (t === 'blend') b.hidden = true;
    b.onclick = () => showTab(t);
    $('tabs').appendChild(b);
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
  // ── C＝B 再套用總帳戶自動槓桿（Level-2）。全部在瀏覽器即時算，所以任何 B 都能套任何方法。──
  // 參考帳戶＝B 的權益（槓桿 1 倍）；回撤門檻以「參考帳戶至今的年化波動」為單位（0.25 ≈ 年化波動 20% 時的 5%）；
  // 每天只用前一天收盤以前的資料。「慢速恢復海龜」＝ MultiCharts 指標 @QB_Level2_Turtle 預設（2026-10-05 lev3_study 選定）。
  function refWalk(x, fn) {
    const lev = new Array(x.length).fill(1);
    let eq = 0, pk = 0, s1 = 0, s2 = 0, cur = 1;
    for (let i = 0; i < x.length; i++) {
      lev[i] = cur;
      eq += x[i]; pk = Math.max(pk, eq); s1 += x[i]; s2 += x[i] * x[i];
      const n = i + 1, vol = n > 1 ? Math.sqrt(Math.max(0, (s2 - s1 * s1 / n) / (n - 1))) * Math.sqrt(252) : 0;
      cur = n >= 60 && vol > 0 ? fn({ i, eq, dd: pk - eq, ddv: (pk - eq) / vol, cur, vol }) : 1;
    }
    return lev;
  }
  const turtle = (step, cut, up = 1) => x => refWalk(x, r => {
    const tgt = Math.max(0.2, 1 - cut * Math.floor(r.ddv / step));
    return tgt < r.cur ? tgt : Math.min(tgt, r.cur + up);
  });
  const linearDD = k => x => refWalk(x, r => Math.max(0.2, 1 - k * r.ddv));
  // 拉回減碼＋上漲加碼：沒有回撤（未滿一階）時 up 倍，回撤中照海龜往下縮（lev3_study「海龜＋順勢加碼」）
  const turtleBoost = (step, cut, up) => x => refWalk(x, r => {
    const k = Math.floor(r.ddv / step);
    return k === 0 ? up : Math.max(0.2, 1 - cut * k);
  });
  const nearHigh = (near, up) => x => refWalk(x, r => (r.ddv < near ? up : 1));
  const dipAdd = (step, add, cap) => x => refWalk(x, r => Math.min(cap, 1 + add * Math.floor(r.ddv / step)));
  const breaker = (off, on) => x => { let st = 1; return refWalk(x, r => (st = st ? (r.ddv >= off ? 0 : 1) : (r.ddv <= on ? 1 : 0))); };
  const cumEq = x => { let t = 0; return x.map(v => (t += v)); };
  // ── 第三輪（lev5_study.py）新增的方法 ──
  const tgtOf = (r, step, cut) => Math.max(0.2, 1 - cut * Math.floor(r.ddv / step));
  const hwmRestore = (step, cut) => x => refWalk(x, r => (r.dd <= 0 ? 1 : Math.min(r.cur, tgtOf(r, step, cut))));
  const coolDown = (step, cut, days) => x => { let hold = 0; return refWalk(x, r => {
    const t = tgtOf(r, step, cut);
    if (t < r.cur) { hold = days; return t; }
    if (hold > 0) { hold--; return r.cur; }
    return t; }); };
  const cppiRule = (fv, m) => x => refWalk(x, r => Math.min(1, Math.max(0.2, m * (fv - r.ddv) / fv)));
  function crashBrake(n, k, low, days = 5) {           // 近 n 天損益 < −k × 年化波動 × √(n/252) → low 倍、維持 days 天
    return x => { const cs = [0]; x.forEach(v => cs.push(cs[cs.length - 1] + v)); let hold = 0;
      return refWalk(x, r => { const t = r.i;
        if (t + 1 >= n && cs[t + 1] - cs[t + 1 - n] < -k * r.vol * Math.sqrt(n / 252)) hold = days;
        if (hold > 0) { hold--; return low; } return 1; }); };
  }
  const lossStreak = (n, low) => x => { let st = 0; return refWalk(x, r => { st = x[r.i] < 0 ? st + 1 : 0; return st >= n ? low : 1; }); };
  function volSpike(ns, nl, th, low) {
    return x => x.map((_, i) => (i <= nl ? 1 : (sdOf(x.slice(i - ns, i)) / sdOf(x.slice(i - nl, i)) > th ? low : 1)));
  }
  const prodLev = (f, g) => x => { const a = f(x), b = g(x); return a.map((v, i) => v * b[i]); };
  function bandRule(x, n, low, lower, mid) {           // 權益跌破下緣 → low 倍；回到中線以上恢復（只用前一天）
    const eq = cumEq(x), lev = new Array(x.length).fill(1);
    let on = true;
    for (let i = 0; i < x.length; i++) {
      lev[i] = on ? 1 : low;
      if (i < n) continue;
      const w = eq.slice(i - n, i);
      if (on && eq[i] < lower(w)) on = false;
      else if (!on && eq[i] > mid(w)) on = true;
    }
    return lev;
  }
  const meanOf = w => w.reduce((t, v) => t + v, 0) / w.length;
  const sdOf = w => { const m = meanOf(w); return Math.sqrt(w.reduce((t, v) => t + (v - m) ** 2, 0) / (w.length - 1)); };
  const chan = (n, low) => x => bandRule(x, n, low, w => Math.min(...w), w => (Math.min(...w) + Math.max(...w)) / 2);
  const boll = (n, k, low) => x => bandRule(x, n, low, w => meanOf(w) - k * sdOf(w), meanOf);
  const maRule = (n, low) => x => { const eq = cumEq(x); return x.map((_, i) => i <= n ? 1 : (eq[i - 1] < meanOf(eq.slice(i - n, i)) ? low : 1)); };
  function volTarget(n) {
    return x => { const lev = new Array(x.length).fill(1); let sum = 0, cnt = 0;
      for (let i = n + 1; i < x.length; i++) { const s = sdOf(x.slice(i - n, i)); if (!(s > 0)) continue; sum += s; cnt++; lev[i] = Math.min(1.5, Math.max(0.5, (sum / cnt) / s)); }
      return lev; };
  }
  const LEV = [
    ['off', '關閉（C＝B）', x => x.map(() => 1)],
    ['slow', '拉回減碼｜慢速恢復海龜（MultiCharts 指標版：一階 0.20、縮 20%、每日 +0.03）', turtle(0.20, 0.20, 0.03)],
    ['slow10', '拉回減碼｜慢速恢復海龜（一階 0.10、縮 20%、每日 +0.03）', turtle(0.10, 0.20, 0.03)],
    ['t25', '拉回減碼｜海龜（舊版指標：一階 0.25、縮 10%、立刻恢復）', turtle(0.25, 0.10)],
    ['t10', '拉回減碼｜海龜（一階 0.10、縮 10%、立刻恢復）', turtle(0.10, 0.10)],
    ['lin', '拉回減碼｜線性（回撤越深越小，k＝1）', linearDD(1)],
    ['slowAgg', '拉回減碼｜慢速恢復海龜（積極：一階 0.15、縮 30%、每日 +0.01）', turtle(0.15, 0.30, 0.01)],
    ['hwm', '拉回減碼｜新高才恢復（一階 0.20、縮 20%）', hwmRestore(0.20, 0.20)],
    ['cool', '拉回減碼｜冷卻期（一階 0.15、縮 20%，縮完維持 20 天）', coolDown(0.15, 0.20, 20)],
    ['cppi', '拉回減碼｜CPPI（底線＝高點 −1 年化波動）', cppiRule(1.0, 1.0)],
    ['slowVs', '拉回減碼×波動突升｜慢速恢復海龜 × 10/60 日波動比 > 1.5 → 0.5', prodLev(turtle(0.20, 0.20, 0.03), volSpike(10, 60, 1.5, 0.5))],
    ['crash', '短期煞車｜急跌：近 5 日跌幅 > 2σ → 0.5 倍 5 天', crashBrake(5, 2.0, 0.5)],
    ['streak', '短期煞車｜連虧 4 天 → 0.5 倍', lossStreak(4, 0.5)],
    ['vspike', '短期煞車｜波動突升：10/60 日波動比 > 1.5 → 0.5 倍', volSpike(10, 60, 1.5, 0.5)],
    ['tb15', '拉回減碼＋上漲加碼｜海龜（一階 0.20、縮 15%）＋無回撤時 1.25 倍', turtleBoost(0.20, 0.15, 1.25)],
    ['tb10', '拉回減碼＋上漲加碼｜海龜（一階 0.20、縮 10%）＋無回撤時 1.25 倍', turtleBoost(0.20, 0.10, 1.25)],
    ['ma20', '權益曲線｜均線 20 日以下 → 0.5 倍', maRule(20, 0.5)],
    ['ma60', '權益曲線｜均線 60 日以下 → 0.5 倍', maRule(60, 0.5)],
    ['ch15', '權益曲線｜高低通道 15 日破低 → 0.5 倍', chan(15, 0.5)],
    ['ch20', '權益曲線｜高低通道 20 日破低 → 0.5 倍', chan(20, 0.5)],
    ['ch30', '權益曲線｜高低通道 30 日破低 → 0.5 倍', chan(30, 0.5)],
    ['bb20', '權益曲線｜布林 20 日 −2σ → 0.5 倍', boll(20, 2, 0.5)],
    ['bb60', '權益曲線｜布林 60 日 −2σ → 0.5 倍', boll(60, 2, 0.5)],
    ['near', '上漲加碼｜離高點 < 0.25 年化波動時 1.5 倍', nearHigh(0.25, 1.5)],
    ['dip', '拉回加碼｜每回撤 0.25 年化波動 +0.5 倍（上限 2）', dipAdd(0.25, 0.5, 2)],
    ['vol', '波動目標｜20 日（0.5～1.5 倍）', volTarget(20)],
    ['brk', '熔斷｜回撤 ≥ 0.5 年化波動停止，≤ 0.25 恢復', breaker(0.5, 0.25)],
  ];
  const levByKey = Object.fromEntries(LEV.map(([k, n, f]) => [k, { name: n, f }]));
  const levCache = {};
  function levOf(key, method) {                       // 全期（含暖機前的歷史）算好再切期間
    const k = state.scaled ? cfgByKey[key].scale : 1, ck = key + '|' + k + '|' + method;
    if (!levCache[ck]) { const full = D.daily[key].map(v => v * k); const lv = levByKey[method].f(full); levCache[ck] = { pnl: full.map((v, i) => v * lv[i]), lev: lv }; }
    return levCache[ck];
  }
  function seriesC(key, method = state.c) { const [i0, i1] = idxRange(); return levOf(key, method).pnl.slice(i0, i1); }
  const narrow = () => root.clientWidth < 700;
  const cName = () => narrow() ? 'C' : 'C B＋' + levByKey[state.c].name;
  const sName = (tag, cfg) => narrow() ? tag : tag + ' ' + cfg.name;
  LEV.forEach(([k, n]) => $('selC').add(new Option(n, k)));
  $('selC').onchange = e => { state.c = e.target.value; render(); };
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
    if (state.tab !== 'strat') showTab('strat');
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
    $('selA').value = state.a; $('selB').value = state.b; $('selC').value = state.c;
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

    const lc = levOf(state.b, state.c).lev, [li0, li1] = idxRange(), lseg = lc.slice(li0, li1);
    $('kpiNote').innerHTML = `<span style="color:${C.a}">A</span>＝${ca.name}；<span style="color:${C.b}">B</span>＝${cb.name}（${cb.desc}）；`
      + `<span style="color:${C.c}">C</span>＝B＋${levByKey[state.c].name}（所選期間平均槓桿 ${(lseg.reduce((t, v) => t + v, 0) / lseg.length).toFixed(2)} 倍；`
      + `在「自動槓桿」分頁點任一方法就會換成 C）。${state.scaled ? '同曝險：部位已調整成與評價前相同的平均在場倍數。' : '原始部位，不調整。'}`;
    const kp = [['淨利（萬）', A.net, B.net, Cm.net, fmtW, true], ['最大回撤（萬）', A.mdd, B.mdd, Cm.mdd, fmtW, false],
                ['淨利 / 回撤', A.nd, B.nd, Cm.nd, fmt1, true], ['Sharpe', A.sharpe, B.sharpe, Cm.sharpe, fmt2, true],
                ['虧損月比例', A.loseM, B.loseM, Cm.loseM, pct0, false], ['最差單月（萬）', A.worstM, B.worstM, Cm.worstM, fmtW, true]];
    const delta = (x, y, hib) => {
      const diff = (y ?? 0) - (x ?? 0);
      if (x == null || y == null || Math.abs(diff) < 1e-9) return '<td class="d same">相同</td>';
      const good = hib ? diff > 0 : diff < 0;
      const rel = x ? `${diff / Math.abs(x) * 100 >= 0 ? '+' : ''}${(diff / Math.abs(x) * 100).toFixed(1)}%` : '';
      return `<td class="d ${good ? 'better' : 'worse'}">${good ? '▲' : '▼'} ${rel}</td>`;
    };
    const inl = (x, y, hib) => delta(x, y, hib).replace(/^<td class="d ([a-z]+)">(.*)<\/td>$/, '<span class="dinl $1">$2</span>');
    $('tKpi').innerHTML = `<thead><tr><th>指標</th><th style="color:${C.a}">A</th><th style="color:${C.b}">B</th><th style="color:${C.c}">C</th>
        <th class="dcol">B 比 A</th><th class="dcol">C 比 B</th></tr></thead>
      <tbody>${kp.map(([k, a, b, c, f, hib]) => `<tr><td>${k}</td><td>${f(a)}</td><td><b>${f(b)}</b>${inl(a, b, hib)}</td><td><b>${f(c)}</b>${inl(b, c, hib)}</td>
        ${delta(a, b, hib).replace('<td class="d', '<td class="dcol d')}${delta(b, c, hib).replace('<td class="d', '<td class="dcol d')}</tr>`).join('')}</tbody>`;

    chart('cEquity').setOption({ animation: false, grid: { left: 70, right: 14, top: 28, bottom: 52 }, tooltip: tl, legend,
      xAxis: { type: 'category', data: dates, ...axisCommon, splitLine: { show: false } }, yAxis: yW,
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 8, borderColor: C.line }],
      series: [lineSeries(sName('A', ca), A.cum, C.a), lineSeries(sName('B', cb), B.cum, C.b), lineSeries(cName(), Cm.cum, C.c)] }, true);
    chart('cDD').setOption({ animation: false, grid: { left: 70, right: 14, top: 28, bottom: 52 }, tooltip: tl, legend,
      xAxis: { type: 'category', data: dates, ...axisCommon, splitLine: { show: false } }, yAxis: { ...yW, max: 0 },
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 8, borderColor: C.line }],
      series: [lineSeries(sName('A', ca), A.dd, C.a), lineSeries(sName('B', cb), B.dd, C.b), lineSeries(cName(), Cm.dd, C.c)] }, true);
    const yearAgg = x => { const m = new Map(); x.forEach((v, i) => { const y = dates[i].slice(0, 4); m.set(y, (m.get(y) || 0) + v); }); return m; };
    const ya = yearAgg(series(state.a)), yb = yearAgg(series(state.b)), yc = yearAgg(seriesC(state.b)), years = [...ya.keys()];
    chart('cYear').setOption({ animation: false, grid: { left: 54, right: 14, top: 28, bottom: 28 }, tooltip: tb, legend,
      xAxis: { type: 'category', data: years, ...axisCommon, splitLine: { show: false } }, yAxis: yW,
      series: [barS(sName('A', ca), years.map(y => ya.get(y)), C.a), barS(sName('B', cb), years.map(y => yb.get(y)), C.b),
               barS(cName(), years.map(y => yc.get(y)), C.c)] }, true);
    const fullA = metrics(D.daily[state.a].map(v => v * (state.scaled ? ca.scale : 1)), D.dates).mon;
    const fullB = metrics(D.daily[state.b].map(v => v * (state.scaled ? cb.scale : 1)), D.dates).mon;
    const fullC = metrics(levOf(state.b, state.c).pnl, D.dates).mon;
    const m24 = [...fullA.keys()].slice(-24);
    chart('cMonth').setOption({ animation: false, grid: { left: 54, right: 14, top: 28, bottom: 28 }, tooltip: tb, legend,
      xAxis: { type: 'category', data: m24, ...axisCommon, splitLine: { show: false } }, yAxis: yW,
      series: [barS(sName('A', ca), m24.map(m => fullA.get(m)), C.a), barS(sName('B', cb), m24.map(m => fullB.get(m)), C.b),
               barS(cName(), m24.map(m => fullC.get(m)), C.c)] }, true);

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
    renderLev();
    renderStrat();
    saveState?.();
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
    const yearlyC = () => { const out = new Map(); levOf(state.b, state.c).pnl.forEach((v, i) => {
        const y = D.dates[i].slice(0, 4); let r = out.get(y); if (!r) out.set(y, r = { net: 0, peak: 0, mdd: 0 });
        r.net += v; r.peak = Math.max(r.peak, r.net); r.mdd = Math.max(r.mdd, r.peak - r.net); }); return out; };
    const e = yearly('EQ'), a = yearly(state.a), b = yearly(state.b), cc = yearlyC(), years = [...e.keys()];
    const ca = cfgByKey[state.a], cb = cfgByKey[state.b];
    const tot = (m, f) => years.reduce((t, y) => t + f(m.get(y)), 0);
    const nd = r => r.mdd > 0 ? fmt1(r.net / r.mdd) : '—';
    $('tYearTot').innerHTML = `<thead><tr><th>年度</th><th class="gap">評價前 淨利</th><th>回撤</th><th>淨利/回撤</th>
        <th class="gap" style="color:${C.a}">A 淨利</th><th>回撤</th><th class="gap" style="color:${C.b}">B 淨利</th><th>回撤</th><th>淨利/回撤</th>
        <th class="gap" style="color:${C.c}">C 淨利</th><th>回撤</th><th>淨利/回撤</th>
        <th class="gap">B − 評價前</th><th>B − A</th><th>C − B</th></tr></thead>
      <tbody>${years.map(y => { const E = e.get(y), Ar = a.get(y), Br = b.get(y), Cr = cc.get(y);
        return `<tr><td>${y}</td><td class="gap">${money(E.net)}</td><td>${fmtW(E.mdd)}</td><td>${nd(E)}</td>
          <td class="gap">${money(Ar.net)}</td><td>${fmtW(Ar.mdd)}</td><td class="gap">${money(Br.net)}</td><td>${fmtW(Br.mdd)}</td><td>${nd(Br)}</td>
          <td class="gap">${money(Cr.net)}</td><td>${fmtW(Cr.mdd)}</td><td>${nd(Cr)}</td>
          <td class="gap">${money(Br.net - E.net)}</td><td>${money(Br.net - Ar.net)}</td><td>${money(Cr.net - Br.net)}</td></tr>`; }).join('')}
      <tr class="tot"><td>合計</td><td class="gap">${money(tot(e, r => r.net))}</td><td></td><td></td>
        <td class="gap">${money(tot(a, r => r.net))}</td><td></td><td class="gap">${money(tot(b, r => r.net))}</td><td></td><td></td>
        <td class="gap">${money(tot(cc, r => r.net))}</td><td></td><td></td>
        <td class="gap">${money(tot(b, r => r.net) - tot(e, r => r.net))}</td><td>${money(tot(b, r => r.net) - tot(a, r => r.net))}</td><td>${money(tot(cc, r => r.net) - tot(b, r => r.net))}</td></tr>
      <tr><td class="note" colspan="15" style="text-align:left">A＝${ca.name}；B＝${cb.name}；C＝B＋${levByKey[state.c].name}；${years[years.length - 1]} 年只到 ${D.range[1]}；${years[0]} 年從 ${D.range[0]} 起</td></tr></tbody>`;

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
      B = b; $('tabs').querySelector('[data-t="blend"]').hidden = false; renderBlend();
    }).catch(() => {});
  }

  // ── 自動槓桿分頁：所有方法套在目前的 B、所選期間；點欄位排序、點列設為 C ──
  let levSort = { col: 'nd', dir: -1 };
  function renderLev() {
    const dates = curDates(), h = Math.floor(dates.length / 2);
    const rows = LEV.map(([k, name]) => {
      const p = seriesC(state.b, k), m = metrics(p, dates), m1 = metrics(p.slice(0, h), dates.slice(0, h)), m2 = metrics(p.slice(h), dates.slice(h));
      const [i0, i1] = idxRange(), l = levOf(state.b, k).lev.slice(i0, i1);
      return { k, name, nd: m.nd, nd1: m1.nd, nd2: m2.nd, mdd: m.mdd, net: m.net, sharpe: m.sharpe,
               avg: l.reduce((t, v) => t + v, 0) / l.length, low: l.filter(v => v < 0.999).length / l.length };
    });
    const b0 = rows[0];
    rows.forEach(r => { r.gain = b0.nd ? r.nd / b0.nd - 1 : null; });
    rows.sort((x, y) => { const a = x[levSort.col], b = y[levSort.col];
      return typeof a === 'string' ? a.localeCompare(b) * levSort.dir : ((a ?? -1e18) - (b ?? -1e18)) * levSort.dir; });
    const cmp = (v, b, hib = true) => v == null || b == null || Math.abs(v - b) < 1e-6 ? '' : (hib ? v > b : v < b) ? 'pos' : 'neg';
    const cols = [['name', '方法'], ['nd', '淨利/回撤'], ['gain', '比 B'], ['nd1', '前半'], ['nd2', '後半'], ['mdd', '最大回撤(萬)'],
                  ['net', '淨利(萬)'], ['sharpe', 'Sharpe'], ['avg', '平均槓桿'], ['low', '降槓桿天數']];
    const cell = (r, c) => {
      const v = r[c];
      if (c === 'name') return `${v}${r.k === state.c ? '<span class="tag">目前 C</span>' : ''}`;
      if (c === 'nd') return `<b class="${cmp(v, b0.nd)}">${fmt1(v)}</b>`;
      if (c === 'gain') return r.k === 'off' ? '—' : `<span class="${cmp(v, 0)}">${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%</span>`;
      if (c === 'nd1') return `<span class="${cmp(v, b0.nd1)}">${fmt1(v)}</span>`;
      if (c === 'nd2') return `<span class="${cmp(v, b0.nd2)}">${fmt1(v)}</span>`;
      if (c === 'mdd') return `<span class="${cmp(v, b0.mdd, false)}">${fmtW(v)}</span>`;
      if (c === 'net') return fmtW(v);
      if (c === 'sharpe') return `<span class="${cmp(v, b0.sharpe)}">${fmt2(v)}</span>`;
      if (c === 'avg') return v.toFixed(2);
      if (c === 'low') return v > 0 ? pct0(v) : '—';
      return v;
    };
    $('tLev').innerHTML = `<thead><tr>${cols.map(([c, l]) => `<th class="sortable" data-c="${c}">${l}${levSort.col === c ? (levSort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr class="clickable${r.k === state.c ? ' cur' : ''}" data-k="${r.k}">${cols.map(([c]) => `<td>${cell(r, c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
    $('tLev').querySelectorAll('th').forEach(th => th.onclick = () => {
      const c = th.dataset.c; levSort = { col: c, dir: levSort.col === c ? -levSort.dir : (c === 'name' ? 1 : -1) }; renderLev(); });
    $('tLev').querySelectorAll('tbody tr').forEach(tr => tr.onclick = () => { state.c = tr.dataset.k; render(); });
    $('levNote').innerHTML = `B＝<b>${cfgByKey[state.b].name}</b>，期間：${state.period}。每列＝把該方法套在 B 上的結果；<b>點任一列就設為上方的 C</b>，點欄位名稱排序。`
      + `「比 B」＝淨利/回撤相對 B（關閉）的變化；淨利/回撤與 Sharpe 不受槓桿大小影響，淨利與回撤會隨平均槓桿縮放。`
      + `分類：<b>拉回減碼</b>＝回撤時縮小部位（海龜）；<b>上漲加碼</b>＝接近新高時放大；<b>拉回加碼</b>＝回撤時放大（攤平）；<b>權益曲線</b>＝均線／通道濾網；<b>短期煞車</b>＝急跌、連虧、波動突升。`
      + `研究結論（lev3／lev5_study，兩池 × 前後半都改善才算數）：拉回減碼類最穩，目前指標（慢速恢復 0.20）綜合最平衡；短期煞車與市場狀態類在兩池都沒有穩定改善。`
      + `回撤門檻以參考帳戶「至今年化波動」為單位（0.25 ≈ 年化波動 20% 時的 5%）；只用前一天收盤以前的資料。`
      + `<b>判讀：要 #/QB、#/QBA 兩個策略池、前後半都變好，且鄰近參數也變好才算數</b>（研究見 research\\lev3_study.py：慢速恢復海龜整族最穩）。`;
    const [i0, i1] = idxRange();
    chart('cLevL').setOption({ animation: false, grid: { left: 54, right: 14, top: 10, bottom: 24 },
      tooltip: { ...tooltipCommon, trigger: 'axis', valueFormatter: v => (+v).toFixed(2) + ' 倍' },
      xAxis: { type: 'category', data: dates, ...axisCommon, splitLine: { show: false } }, yAxis: { type: 'value', ...axisCommon, min: 0 },
      series: [{ ...lineSeries(levByKey[state.c].name, levOf(state.b, state.c).lev.slice(i0, i1), C.c, 1.5), step: 'end', sampling: undefined }] }, true);
  }

  // 換策略池（#/QB ↔ #/QBA）時沿用 A、B、C、期間、分頁：QBPage 傳入上次的選擇，每次重畫回存
  const init = opts.initState || {};
  if (cfgByKey[init.a]) state.a = init.a;
  if (cfgByKey[init.b]) state.b = init.b;
  if (levByKey[init.c]) state.c = init.c;
  if (PERIODS.includes(init.period)) state.period = init.period;
  if (typeof init.scaled === 'boolean') state.scaled = init.scaled;
  if (['year', 'lev', 'strat', 'cfg'].includes(init.tab)) state.tab = init.tab;
  const saveState = () => opts.onState?.({ a: state.a, b: state.b, c: state.c, period: state.period, scaled: state.scaled, tab: state.tab });

  // ── 自動槓桿研究結論（lev_summary.py → lev.enc；載得到才顯示）──
  let LR = null, lrSort = { col: 'ok4', dir: -1 }, lrFilter = 'all';
  function renderLevRes() {
    if (!LR) return;
    $('levResCard').hidden = false;
    const c = LR.current;
    $('levResNote').innerHTML = `三輪研究共 ${LR.families.reduce((t, f) => t + f.n, 0)} 組參數。目前使用：<b>${c.name}</b> —
      改善 原本 Export ${(c.g0 * 100).toFixed(1)}%、Export＋Activate ${(c.g1 * 100).toFixed(1)}%，3 年視窗勝率 ${(c.win0 * 100).toFixed(0)}%／${(c.win1 * 100).toFixed(0)}%，平均槓桿 ${c.avg}。
      <b>結論：只有「拉回減碼」類在兩種 QB 穩定有效；短期煞車、市場狀態、拉回加碼、QB inc 都沒有幫助或變差。</b>（產生於 ${LR.generated}）`;
    seg($('segLevRes'), [['all', '全部'], ['good', '有效'], ['bad', '無效／變差']], () => lrFilter, v => { lrFilter = v; renderLevRes(); });
    $('segLevRes').querySelectorAll('button').forEach((b, i) => { b.onclick = () => { lrFilter = ['all', 'good', 'bad'][i]; renderLevRes(); }; });
    let rows = LR.families.slice();
    if (lrFilter === 'good') rows = rows.filter(r => r.verdict === '穩定有效' || r.verdict === '部分有效');
    if (lrFilter === 'bad') rows = rows.filter(r => !(r.verdict === '穩定有效' || r.verdict === '部分有效'));
    const order = { '穩定有效': 4, '部分有效': 3, '無效': 2, '一池好一池壞': 1, '兩池都變差': 0 };
    rows.sort((x, y) => { const k = lrSort.col; const a = k === 'verdict' ? order[x.verdict] : x[k], b = k === 'verdict' ? order[y.verdict] : y[k];
      return typeof a === 'string' ? a.localeCompare(b) * lrSort.dir : ((a ?? -1e9) - (b ?? -1e9)) * lrSort.dir; });
    const pc = v => v == null ? '—' : `<span class="${v > 0.005 ? 'pos' : v < -0.005 ? 'neg' : ''}">${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%</span>`;
    const p0 = v => v == null ? '—' : (v * 100).toFixed(0) + '%';
    const vcls = v => v === '穩定有效' ? 'pos' : v === '部分有效' ? '' : 'neg';
    const cols = [['family', '方法'], ['kind', '類型'], ['round', '輪次'], ['n', '組數'], ['ok4', '四段全改善'], ['g0', '原本 Export'],
                  ['g1', 'Export＋Activate'], ['oos', '前推樣本外'], ['win0', '視窗勝率（原）'], ['win1', '視窗勝率（合）'], ['verdict', '判斷']];
    $('tLevRes').innerHTML = `<thead><tr>${cols.map(([k, l]) => `<th class="sortable" data-c="${k}">${l}${lrSort.col === k ? (lrSort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr><td>${r.family}${r.note ? `<div class="note">${r.note}</div>` : ''}</td><td>${r.kind}</td><td>${r.round}</td><td>${r.n}</td>
        <td><b>${p0(r.ok4)}</b></td><td>${pc(r.g0)}</td><td>${pc(r.g1)}</td><td>${pc(r.oos)}</td><td>${p0(r.win0)}</td><td>${p0(r.win1)}</td>
        <td><b class="${vcls(r.verdict)}">${r.verdict}</b></td></tr>`).join('')}</tbody>`;
    $('tLevRes').querySelectorAll('th').forEach(th => th.onclick = () => {
      const k = th.dataset.c; lrSort = { col: k, dir: lrSort.col === k ? -lrSort.dir : (['family', 'kind', 'round'].includes(k) ? 1 : -1) }; renderLevRes(); });
    $('levResDefs').innerHTML = LR.notes.map(n => `<li>${n}</li>`).join('');
  }
  if (opts.loadLev) {
    Promise.resolve(opts.loadLev()).then(l => { if (l && l.families) { LR = l; renderLevRes(); } }).catch(() => {});
  }

  render();
  showTab(state.tab);
  return () => {
    window.removeEventListener('resize', onResize);
    Object.values(charts).forEach(c => c.dispose());
    root.innerHTML = '';
    root.classList.remove('qbd');
  };
}
