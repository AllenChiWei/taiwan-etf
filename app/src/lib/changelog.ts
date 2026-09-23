/* 更新日誌：使用者看得到的功能改動。純資料＋純函式，沒有 React。
 *
 * **只記功能，不記每天的資料更新**（那每天都有，會把真正的改動洗掉）。
 * 新增或改動畫面上看得到的東西時，在最上面加一條；同一天的放在同一個日期底下。
 * 文字寫給瀏覽者看：講「能做什麼、看到什麼」，不講檔名與實作。
 * tests/changelog.test.ts 盯著日期格式與排序。
 */

export type ChangeKind = 'new' | 'improve' | 'fix';

export const KIND_LABEL: Record<ChangeKind, string> = {
  new: '新功能',
  improve: '改進',
  fix: '修正',
};

/** 站內分頁。寫成聯集而不是 string，打錯路徑時型別檢查就會擋下來。 */
export type SitePath = '/' | '/us' | '/favorites' | '/calc' | '/dividend' | '/futures'
  | '/chips' | '/news' | '/stock' | '/poker' | '/about' | '/changelog';

export interface ChangeItem {
  kind: ChangeKind;
  text: string;
  /** 站內連結，例如 '/chips' */
  to?: SitePath;
}

export interface ChangeDay {
  /** YYYY-MM-DD，台北日期 */
  date: string;
  items: ChangeItem[];
}

/** 新到舊。 */
export const CHANGELOG: ChangeDay[] = [
  {
    date: '2026-09-23',
    items: [
      { kind: 'new', to: '/poker',
        text: '撲克頁新增六人桌位置圖：座位、按鈕與盲注，翻牌前／翻牌後誰先行動，點座位切換開牌範圍。' },
      { kind: 'new', to: '/poker',
        text: '撲克頁：勝率試算可以選「對手範圍」（直接用站上的開牌、3-bet、跟注範圍），'
          + '並加上「跟注值不值」（需要勝率與 EV）和「聽牌出路」（出路、中牌率、2／4 法則對照）。' },
      { kind: 'new', to: '/poker',
        text: '撲克頁新增「範圍測驗」：隨機出位置與手牌，選開牌／3-bet／跟注／蓋牌，立刻對答案，記錄成績與錯題。' },
      { kind: 'improve',
        text: '網站更新後，開著的頁面會自動重新整理：切回分頁時直接更新，正在看時提示 10 秒後更新'
          + '（對帳單頁只提示，不會清掉你上傳的分析）。' },
      { kind: 'new', to: '/',
        text: '台股清單點 ETF 名稱，跳出前十大持股（投信投顧公會月報，所有投信都有；'
          + '站上追蹤的主動式 ETF 用每天的持股）。' },
      { kind: 'new', to: '/',
        text: '台股頁新增「主動式換股」：市值前十大主動式 ETF（每天重算）加上指定的幾檔，每天的'
          + '新增、剔除、加碼、減碼，以及前十大合計持股排行（權重 × 市值）。' },
      { kind: 'new', to: '/',
        text: '台股頁新增「即將上市」：列出募集中與待上市的 ETF（例如 00412A、00415A），'
          + '附開募日、投信與相關新聞；上市前一天換成證交所的完整規格。已上市的不列。' },
      { kind: 'new', to: '/chips',
        text: '籌碼頁最上面新增每日摘要：外資台指期、散戶多空比、P/C 比、融資餘額與維持率、'
          + 'VIX、恐懼貪婪，一排看完，每格都跟前一天比。' },
      { kind: 'new', to: '/chips',
        text: '三大法人期貨新增「台指期合計（大台約當）」：大台＋小台÷4＋微台÷20 合成一個數字，不必自己心算。' },
      { kind: 'new', to: '/chips',
        text: '新增融資融券區塊：上市融資餘額走勢、每日增減，以及自算的大盤融資維持率。' },
      { kind: 'new', to: '/chips',
        text: '新增市場情緒區塊：VIX 恐慌指數，以及仿 CNN 方法自算的恐懼貪婪指數'
          + '（CNN 的資料不開放給程式抓，所以數字會跟 CNN 不同）。' },
      { kind: 'new', to: '/chips',
        text: '籌碼頁新增「散戶多空比準不準」：小台、微台近三年的散戶多空比分成五組，'
          + '看各組之後 5 日／20 日加權指數的漲跌，並跟全部日子的平均比較。' },
      { kind: 'new', to: '/chips',
        text: '週選價平和新增「支撐與壓力」：價外 Call／Put 未平倉最多的履約價，'
          + '附上過去每次到期時有沒有收在兩者之間。' },
      { kind: 'new', to: '/chips',
        text: '三大法人期貨未平倉：小台、微台加上散戶未平倉（推算）與多空比走勢。' },
      { kind: 'new', to: '/changelog', text: '新增這個更新日誌頁。' },
      { kind: 'improve', to: '/',
        text: '殖利率一律年化（最近一次配息 × 每年配息次數 ÷ 股價），'
          + '今年才上市的主動式 ETF 不再因為配息次數少而被低估。' },
      { kind: 'fix', to: '/', text: '殖利率不再把已公告但還沒除息的配息算進去。' },
      { kind: 'improve',
        text: '每日更新分成獨立的幾塊，其中一塊出錯時其他資料照常更新，網站不會整個停在舊的一天。' },
    ],
  },
  {
    date: '2026-09-22',
    items: [
      { kind: 'fix', to: '/', text: '修正 9/17 起台股清單沒有更新的問題。' },
    ],
  },
  {
    date: '2026-09-20',
    items: [
      { kind: 'new', to: '/', text: '台股清單點任一檔，直接滑出個股儀表板。' },
      { kind: 'new', to: '/stock',
        text: '個股頁：相對位置雷達圖、籌碼環形圖、多空能量條、位階面板與三大法人每日買賣超。' },
      { kind: 'new', to: '/futures',
        text: '期貨對帳單分析：上傳元大期貨的已實現損益，算勝率、賠率、期望值與最大回撤。'
          + '檔案只在你的瀏覽器裡計算，不會上傳。' },
      { kind: 'new', to: '/calc', text: '試算頁：定期定額與一次投入同樣金額的對照。' },
      { kind: 'new', to: '/chips', text: '籌碼頁：定期定額人氣榜（證交所月報）。' },
    ],
  },
  {
    date: '2026-09-19',
    items: [
      { kind: 'new', to: '/chips',
        text: '週選價平和：預估區間與事後驗收，以及每個星期幾「現在 vs 過去」的比較。' },
      { kind: 'improve', to: '/favorites',
        text: '台股、美股績效曲線改用公開資料，不再需要密碼；美股曲線改成含息報酬。' },
      { kind: 'improve', to: '/favorites', text: '收藏頁：勾了卻沒有曲線的標的，會列出是哪幾檔。' },
      { kind: 'improve', to: '/', text: '殖利率改成每天自行計算。' },
    ],
  },
  {
    date: '2026-09-18',
    items: [
      { kind: 'new', to: '/chips', text: '新增週選價平和；網站改名「職業賭徒日誌」。' },
      { kind: 'new', to: '/stock', text: '新增個股頁：搜尋任一上市櫃公司的財報與籌碼。' },
      { kind: 'new', to: '/stock',
        text: '營收排行、創 150／200／250 日新高、漲跌幅排行、各類股成交比重。' },
      { kind: 'new', to: '/news', text: '新增新聞分頁：財經媒體標題與公開資訊觀測站重大訊息。' },
      { kind: 'new', to: '/dividend',
        text: '配息試算獨立成分頁：依一年可領金額排序，並有年配息來源的圓餅圖。' },
      { kind: 'improve', to: '/chips',
        text: '選擇權區塊攤開買方／賣方的未平倉與交易明細；三大法人未平倉改成柱狀圖。' },
      { kind: 'fix', to: '/', text: '篩選與排序不再把畫面捲回頂端。' },
    ],
  },
  {
    date: '2026-09-17',
    items: [
      { kind: 'new', to: '/chips',
        text: '新增籌碼分頁：期交所三大法人、大額交易人、交易所法人買賣超前十大。' },
      { kind: 'new', to: '/calc', text: '新增試算分頁：定期定額／單筆投入回測與退休推估。' },
      { kind: 'new', to: '/dividend', text: '新增配息試算：持股每月與每年可領多少。' },
      { kind: 'new', to: '/poker', text: '新增撲克頁：6 人桌開牌範圍、面對開牌的應對、勝率計算機。' },
      { kind: 'new', to: '/', text: '新增「主動 ETF」篩選。' },
      { kind: 'improve', to: '/favorites', text: '收藏頁顯示六個指標並可排序。' },
      { kind: 'improve', text: '標的選單可以打字搜尋，手機上的下拉選單也拉得動了。' },
      { kind: 'fix', to: '/dividend',
        text: '配息試算：股票股利不再被當成現金，配息頻率改以交易所公告為準。' },
    ],
  },
  {
    date: '2026-09-14',
    items: [
      { kind: 'new', to: '/us', text: '新增美股 ETF 清單、績效比較圖與近 5 年報酬率。' },
      { kind: 'improve', text: '載入更快：分頁按需載入，長清單只畫看得到的部分。' },
      { kind: 'fix', to: '/us', text: '美股報酬率照實標示為價格報酬（不含配息）。' },
    ],
  },
  {
    date: '2026-09-13',
    items: [
      { kind: 'new', to: '/',
        text: '網站上線：台灣 ETF 總覽，含保管銀行、配息頻率、殖利率與各期間報酬率，每個交易日自動更新。' },
      { kind: 'new', text: '手機版改成卡片版面，並支援離線瀏覽（加入主畫面）。' },
    ],
  },
];

/** 最新一條的日期。沒有任何條目時回 null。 */
export function latestDate(log: ChangeDay[] = CHANGELOG): string | null {
  return log.length ? log[0].date : null;
}

/**
 * 有沒有瀏覽者還沒看過的更新。lastSeen 是上次打開更新日誌頁時的最新日期
 * （存在 localStorage，可能不存在）。第一次來的人不顯示提示 —— 對他來說
 * 每一條都是新的，亮一個點沒有資訊。
 */
export function hasUnseen(lastSeen: string | null, log: ChangeDay[] = CHANGELOG): boolean {
  const latest = latestDate(log);
  if (!latest || !lastSeen) return false;
  return latest > lastSeen;
}
