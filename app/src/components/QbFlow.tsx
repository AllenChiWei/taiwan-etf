/* 私人頁的「QB 運作流程」：給別人看的版本 —— 一眼看出「策略層」與「管理層」各自控制什麼。
 * 五層由上往下，每層一個問題（做什麼／誰來做／做多大／該不該縮／怎麼下單），技術細節縮成小字。
 * 內容以 2026-10-05 定案設定為準（X1_v3 Sortino 250、分多空各序位 15、慢速恢復海龜、大轉小）；設定改了要一起改這裡。
 * 純 HTML／CSS，手機上直排。 */

interface Step { title: string; detail: string }
interface Layer {
  key: string;
  band: string;          // 層名
  question: string;      // 這一層回答的問題
  where: string;         // 在哪裡執行
  color: string;         // CSS 色（類別色）
  steps: Step[];
  control: string;       // 控制重點
}

const LAYERS: Layer[] = [
  {
    key: 'strategy', band: '策略層', question: '做什麼？', where: 'MultiCharts（每個策略一套）', color: 'var(--cat-1)',
    steps: [
      { title: '策略訊號', detail: '圖 A：進出場規則；口數已做風險平價（指數越高、每口風險越大，口數越少）' },
      { title: '單一策略風控', detail: 'Pass：DD 管理（保險絲關閉）→ 圖 B 靜態回測' },
      { title: '策略評價', detail: 'X1_v3：近 250 天 Sortino → 動能 0.25～1.25；多方、空方分開評價' },
      { title: '策略檔', detail: '輸出「部位 × 動能」給 QB；另匯出每日損益做研究' },
    ],
    control: '每個策略自己決定進出場與基本口數；X1 只看「這個策略最近表現好不好」，給出動能分數。',
  },
  {
    key: 'commodity', band: '管理層①　商品層', question: '誰來做？', where: '複製版 QB', color: 'var(--cat-2)',
    steps: [
      { title: '分類排名', detail: '所有策略分成「多方」「空方」兩類，各自依動能排名' },
      { title: '名額篩選', detail: '每類只取前 15 名；有部位才進名單，部位歸零才移出' },
      { title: '整合口數', detail: '名單內策略：Σ 動能 × 部位 → 台指期的整合口數（多空互相抵銷）' },
    ],
    control: '跨策略比較：表現好的策略才能下單、表現差的暫停。這一步是回測中改善最多的（淨利/回撤 約 +40%）。',
  },
  {
    key: 'project', band: '管理層②　專案層', question: '做多大？', where: '複製版 QB', color: 'var(--cat-2)',
    steps: [
      { title: '資金換算', detail: '建議口數 ＝ 整合口數 × 專案資金 × 動能轉換率 ÷（2000 萬 × 5）' },
      { title: '下單規格', detail: '大轉小（× 4，下小台）、無條件捨去、最小有效變量' },
    ],
    control: '「動能轉換率」就是總槓桿：決定整個帳戶承擔多少風險（依可接受的最大回撤來設）。',
  },
  {
    key: 'level2', band: '管理層③　總帳戶（Level-2）', question: '現在該不該縮？', where: 'MultiCharts 指標 → QB', color: 'var(--cat-6)',
    steps: [
      { title: '帳戶權益', detail: 'QB EquityServer 用 DDE 把帳戶金額送進 MultiCharts' },
      { title: '慢速恢復海龜', detail: '回撤每深一階（年化波動 × 0.20）槓桿立刻縮 20%；收復後每天最多回升 0.03，最低 0.2 倍' },
      { title: '回授', detail: '寫出新的動能轉換率 → QB「由外部輸入動能轉換率」→ 回到專案層' },
    ],
    control: '整個帳戶在回撤時自動降槓桿、回升後慢慢恢復（回測：淨利/回撤 再 +13～15%，兩種策略池都成立）。',
  },
  {
    key: 'exec', band: '執行層', question: '怎麼下單？', where: '交易電腦', color: 'var(--c-faint)',
    steps: [
      { title: '下單檔', detail: 'QB 輸出 $Position（小台口數）' },
      { title: '下單大師 → 期貨商', detail: '商品對應小台（MXF），送出委託' },
    ],
    control: '只負責照建議口數下單，不做判斷。',
  },
];

const SIDE = [
  { title: '每日監控', detail: '元大 API 每天 13:50 記錄帳戶權益 → 私人頁「實盤權益」，對照回測的波動與回撤' },
  { title: '定期研究', detail: '策略每日損益 → 逐日模擬複製版 QB → 看板比較 A（評價前）→ B（QB 評價後）→ C（加自動槓桿）' },
];

const tint = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;
const ARROW: Record<string, string> = {
  commodity: '每個策略的「部位 × 動能」（多方 _L、空方 _S 分開）',
  project: '台指期整合口數',
  level2: '帳戶權益（含所有部位的損益）',
  exec: '建議口數（小台）',
};

export function QbFlow() {
  return (
    <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-sm font-bold text-ink">QB 運作流程：策略層 → 管理層 → 執行層</h2>
        <span className="text-[11.5px] text-faint">2026-10-05 定案設定</span>
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
        每個策略只管自己（策略層）；QB 決定哪些策略可以下單、整個帳戶下多大（管理層）；
        帳戶回撤時再由總帳戶控制自動降槓桿。所有決策只用前一天收盤以前的資料。
      </p>

      <ol className="mt-3">
        {LAYERS.map((L, i) => (
          <li key={L.key}>
            {i > 0 && (
              <div className="flex items-center gap-2 py-1 pl-6 text-[11px] text-faint" aria-hidden="true">
                <span className="text-[16px] leading-none text-line-strong">↓</span>{ARROW[L.key]}
              </div>
            )}
            <div className="overflow-hidden rounded-lg border" style={{ borderColor: tint(L.color, 45) }}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-1.5" style={{ background: tint(L.color, 14) }}>
                <span className="text-[13.5px] font-bold text-ink">{L.band}</span>
                <span className="text-[13.5px] font-bold text-ink">— {L.question}</span>
                <span className="ml-auto text-[11px] text-muted">{L.where}</span>
              </div>
              <div className="flex flex-col gap-1.5 px-3 py-2 sm:flex-row sm:items-stretch">
                {L.steps.map((s, j) => (
                  <div key={s.title} className="flex min-w-0 flex-1 items-stretch gap-1.5">
                    {j > 0 && <span className="hidden self-center text-[15px] text-line-strong sm:block" aria-hidden="true">→</span>}
                    <div className="min-w-0 flex-1 rounded-md bg-sunken px-2.5 py-1.5">
                      <div className="text-[12.5px] font-semibold text-ink">{s.title}</div>
                      <div className="mt-0.5 text-[11.5px] leading-snug text-muted">{s.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t px-3 py-1.5 text-[12px] leading-snug text-ink" style={{ borderColor: tint(L.color, 30) }}>
                <span className="font-semibold">控制重點：</span>{L.control}
              </div>
            </div>
            {L.key === 'level2' && (
              <div className="mt-1 rounded-md border border-dashed px-3 py-1 text-[11.5px] text-muted" style={{ borderColor: tint(L.color, 60) }}>
                ↺ 回授迴圈：Level-2 算出的動能轉換率會回到「管理層② 專案層」，改變之後的建議口數。
              </div>
            )}
          </li>
        ))}
      </ol>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {SIDE.map(s => (
          <div key={s.title} className="rounded-lg border border-dashed border-line-strong px-3 py-2">
            <div className="text-[12.5px] font-semibold text-ink">{s.title}</div>
            <div className="mt-0.5 text-[11.5px] leading-snug text-muted">{s.detail}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
