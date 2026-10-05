/* 私人頁的「QB 架構流程」：從 MultiCharts 策略到下單、加上 Level-2 槓桿回授與研究回饋兩條支線。
 * 內容以 2026-10-05 定案的設定為準（X1_v3 Sortino 250、分多空各序位 15、海龜風控指標）；設定改了要一起改這裡。
 * 純 HTML／CSS 方塊，手機上直排也看得清楚。 */

interface Step {
  where: string;
  title: string;
  lines: string[];
}

const MAIN: Step[] = [
  { where: 'MultiCharts', title: '圖 A｜原始策略（每個策略一張圖）',
    lines: ['策略本身已做風險平價（與 X1 的 GetRPASharesFC 相同），所以 X1 的 RiskParity_Auto＝0'] },
  { where: 'MultiCharts', title: 'Pass｜靜態回測濾鏡',
    lines: ['DD 管理照原設定；保險絲全部關閉（10/04 決定）', 'putMCDataD 寫出部位乘數'] },
  { where: 'MultiCharts', title: '圖 B｜靜態回測（同商品、同策略）',
    lines: ['每根 K 棒：圖 A 部位 × Pass 乘數'] },
  { where: 'MultiCharts', title: 'X1_v3 × 2（多方、空方各一個）',
    lines: ['EVA_Mode 7：Sortino 250 天、Sortino_Full 5.5、Base_W 1、Weight_Cap 2 → 動能約 0.25～1.25',
            'outputfile DLL 寫出策略檔（部位 × 動能）', 'QB_ExportDailyPL 另外匯出每日損益 CSV（研究用）'] },
  { where: '複製版 QB', title: '商品層｜排序與整合',
    lines: ['多方、空方兩個策略分類，各自序位 15；最小動能門檻 0',
            '名次含空手策略；有部位、名次 ≤ 15、列表有空位就進入，部位歸零才移出',
            '整合口數 E＝Σ 動能 × 部位 × 分類權重'] },
  { where: '複製版 QB', title: '專案層｜資金與槓桿',
    lines: ['建議部位＝整合口數 × 專案資金 × 動能轉換率 ÷（2000 萬 × 5）× 動能配置',
            '最小有效變量、無條件捨去', '動能轉換率：由外部檔輸入（見下方 Level-2）'] },
  { where: '交易電腦', title: '訊號輸出 → 下單大師 → 期貨商',
    lines: ['下單檔資料夾指到下單大師讀取的位置'] },
];

const LEVEL2: Step[] = [
  { where: '複製版 QB', title: 'EquityServer（DDE）', lines: ['=QuantBrains|帳號!accountall：總體帳戶金額'] },
  { where: 'MultiCharts', title: '指標 @QB_Level2_Turtle（海龜風控）',
    lines: ['帳戶損益 ÷ 當天槓桿 → 還原成槓桿 1 倍的參考帳戶（避免回授）',
            '參考帳戶回撤每滿「年化波動 × 0.25」縮小 10%，最低 0.2 倍；收復後恢復',
            '寫出 conv_rate.txt ＝ 基準動能轉換率 × 槓桿倍數'] },
];

const RESEARCH: Step[] = [
  { where: '這台電腦', title: '回測研究', lines: ['Export\\*.csv（＋Activate）→ qb_sim.py／qb_dashboard.py 逐日模擬複製版 QB',
    'lev2_study.py：總帳戶槓桿控制比較'] },
  { where: '網站', title: '#/QB、#/QBA 看板', lines: ['評價前 → B → C（自動槓桿）、每年／每月明細 → 回頭調整 X1／QB 參數'] },
];

const TAG: Record<string, string> = {
  MultiCharts: 'bg-[color-mix(in_srgb,var(--cat-1)_14%,transparent)] text-ink',
  '複製版 QB': 'bg-[color-mix(in_srgb,var(--cat-2)_14%,transparent)] text-ink',
  '交易電腦': 'bg-sunken text-muted',
  '這台電腦': 'bg-sunken text-muted',
  '網站': 'bg-sunken text-muted',
};

function Box({ s, dashed }: { s: Step; dashed?: boolean }) {
  return (
    <div className={`rounded-lg border bg-surface px-3 py-2 ${dashed ? 'border-dashed border-line-strong' : 'border-line'}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`rounded px-1.5 py-px text-[10.5px] font-semibold ${TAG[s.where] ?? 'bg-sunken text-muted'}`}>{s.where}</span>
        <span className="text-[13px] font-bold text-ink">{s.title}</span>
      </div>
      <ul className="mt-1 space-y-0.5 text-[12px] leading-snug text-muted">
        {s.lines.map(l => <li key={l}>{l}</li>)}
      </ul>
    </div>
  );
}

const Arrow = ({ label }: { label?: string }) => (
  <div className="flex items-center gap-2 py-0.5 pl-5 text-[11px] text-faint" aria-hidden="true">
    <span className="text-[15px] leading-none text-line-strong">↓</span>{label}
  </div>
);

export function QbFlow() {
  return (
    <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-sm font-bold text-ink">QB 架構流程</h2>
        <span className="text-[11.5px] text-faint">2026-10-05 定案設定</span>
      </div>
      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div>
          <div className="mb-1.5 text-[12px] font-semibold text-muted">主流程（每個策略一套，全部進同一個 QB）</div>
          {MAIN.map((s, i) => (
            <div key={s.title}>
              {i > 0 && <Arrow label={i === 4 ? '策略檔（每個策略 _L、_S 兩個）' : i === 6 ? '下單檔' : undefined} />}
              <Box s={s} />
            </div>
          ))}
        </div>
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-muted">Level-2 總帳戶槓桿（回授到「專案層」）</div>
            {LEVEL2.map((s, i) => (
              <div key={s.title}>{i > 0 && <Arrow label="QuoteManager Universal DDE 帳戶商品" />}<Box s={s} dashed /></div>
            ))}
            <Arrow label="conv_rate.txt → QB「由外部輸入動能轉換率」" />
            <div className="rounded-lg bg-sunken px-3 py-1.5 text-[12px] text-muted">回到主流程的「專案層」</div>
          </div>
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-muted">研究回饋（離線）</div>
            {RESEARCH.map((s, i) => (
              <div key={s.title}>{i > 0 && <Arrow />}<Box s={s} dashed /></div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
