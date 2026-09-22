import { useEtfData } from '../context/AppContext';

export function AboutPage() {
  const { meta } = useEtfData();

  const h2 = 'mt-6 mb-2 text-[17px] font-bold text-ink first:mt-0';
  const p = 'text-[14.5px] text-muted';
  const ul = 'my-2 list-disc space-y-1.5 pl-5 text-[14.5px] text-muted';

  return (
    <div className="max-w-[70ch] pt-6 pb-4">
      <h2 className={h2}>這是什麼</h2>
      <p className={p}>
        台灣掛牌 ETF 的總覽表，目前收錄 <strong className="text-ink">{meta.total}</strong> 檔，每日自動更新。
        可依代號、名稱或保管銀行搜尋，並用保管銀行、配息頻率、分類篩選。
      </p>

      <h2 className={h2}>資料來源與更新</h2>
      <ul className={ul}>
        <li>ETF 清單：證交所 TWSE 與櫃買中心 TPEx 公開資料</li>
        <li>
          績效曲線：兩個市場都來自 <strong className="text-ink">FinMind</strong> 的公開資料，
          畫的都是<strong className="text-ink">含息總報酬</strong>，不需要密碼。
          台股是日收盤價加上交易所公告配息自行還原；美股用的是 FinMind 已經含息還原的
          收盤價。表格裡的美股報酬率則仍來自 FinLab，那是<strong className="text-up">
          價格報酬、不含配息</strong> —— 三千七百檔逐檔請求不可行，所以那一欄沒有跟著換。
        </li>
        <li>
          報酬率：由 FinLab 的還原股價計算，是<strong className="text-ink">含息的總報酬</strong>、
          累積非年化
        </li>
        <li>保管銀行、配息頻率：MoneyDJ（每週更新一次，這兩個欄位幾乎不變）</li>
        <li>
          殖利率：<strong className="text-ink">自行計算</strong> ——
          近 12 個月交易所公告的配息合計 ÷ 當日收盤價，每個交易日更新。
          配息史不滿一年的改以<strong className="text-ink">年化推估</strong>
          （最近一次配息 × 每年次數），並在數字旁標
          <sup className="text-faint">*</sup>。
          沒有配息紀錄的標的才沿用 MoneyDJ 的數字。
        </li>
        <li>
          資料日期：<strong className="text-ink">{meta.updated}</strong>
          {meta.snapshot && <>　·　報酬率截至 {meta.snapshot}</>}
          {meta.yieldAsof && <>　·　殖利率截至 {meta.yieldAsof}</>}
        </li>
      </ul>

      <h2 className={h2}>欄位怎麼讀</h2>
      <ul className={ul}>
        <li>
          <strong className="text-ink">報酬率顏色</strong>沿用台股慣例：
          <span className="font-semibold text-up">紅色為正報酬</span>、
          <span className="font-semibold text-down">綠色為負報酬</span>，與美股習慣相反。
        </li>
        <li><strong className="text-ink">N/A</strong> 在報酬率欄代表該基金成立未滿該期間。</li>
        <li>
          <strong className="text-ink">殖利率 N/A</strong> 有兩種可能：完全不配息，或有配息機制但尚未發放過
          （今年才掛牌的基金多屬此類）。看「配息」欄才能分辨 —— 顯示
          <span className="mx-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold pill-none">—</span>
          的是前者。
        </li>
        <li><strong className="text-ink">報酬率是累積報酬</strong>，不是年化，且已含配息再投資。</li>
        <li>
          <strong className="text-ink">殖利率帶 <sup className="text-faint">*</sup> 是年化推估</strong>。
          今年才掛牌的基金只配過一兩次，用「近 12 個月實際配發」會低到失真
          —— 一檔月配、只配過兩次的，數字只有實際水準的六分之一。所以配息史
          不滿一年的改用最近一次配息乘上一年的次數，並標上記號；
          <strong className="text-ink">滿一年的一律用實際已配發的金額</strong>，
          不會被某一次加發灌水。
        </li>
      </ul>

      <h2 className={h2}>收藏功能</h2>
      <p className={p}>
        點每一列的 ☆ 可加入收藏。資料只存在你這台裝置的瀏覽器裡，不會上傳，
        換裝置或清除瀏覽資料就會消失。
      </p>

      <h2 className={h2}>免責聲明</h2>
      <p className={p}>
        本頁資料由公開來源自動彙整，可能有誤或延遲，
        <strong className="text-ink">僅供參考，不構成任何投資建議</strong>。
        實際資訊請以各基金公司公告與公開說明書為準。
      </p>
    </div>
  );
}
