# 台灣 ETF 總覽

可搜尋的台灣 ETF 清單（359 檔），含保管銀行、配息頻率、殖利率，以及近 3 月／6 月／1 年／3 年
的市價報酬率。支援搜尋、分類與配息篩選、排序與收藏，手機版為卡片式版面。

**線上瀏覽：** <https://allenchiwei.github.io/taiwan-etf/>

資料每個交易日自動更新（台灣時間 19:00），來源為證交所 TWSE、櫃買中心 TPEx 的公開資料
與 MoneyDJ。

## 專案結構

| 路徑 | 說明 |
| --- | --- |
| `app/` | 網站本體：React 19 ＋ TypeScript ＋ Vite ＋ Tailwind v4 |
| `app/public/data/etfs.json` | 網站讀取的資料檔（由管線產生，勿手改） |
| `scripts/` | Python 資料管線：抓取 → 產生 JSON 與舊版 HTML |
| `tools/` | 開發輔助：無頭截圖、靜態伺服器 |
| `taiwan_etf_list.html` | 最早的單檔版本，仍保留在原網址 |
| `.github/workflows/` | 每日更新資料、部署到 GitHub Pages |

## 開發

```bash
cd app
npm install
npm run dev      # http://localhost:5173/taiwan-etf/
npm test         # 篩選／排序／顏色慣例，含對真實資料的檢查
npm run build
```

## 更新資料

```bash
WORK=/tmp/etf && mkdir -p "$WORK"
cp app/public/data/etfs.json "$WORK/previous.json"
cp taiwan_etf_list.html      "$WORK/previous.html"

python scripts/fetch_universe.py "$WORK"
python scripts/scrape_moneydj.py "$WORK"
python scripts/scrape_returns.py "$WORK"
python scripts/build_data.py "$WORK" app/public/data/etfs.json
python scripts/build_page.py "$WORK" taiwan_etf_list.html
python scripts/verify_data.py app/public/data/etfs.json "$WORK/previous.json"
python scripts/verify_page.py taiwan_etf_list.html      "$WORK/previous.html"
```

平常不需要手動跑，GitHub Actions 會處理。驗證腳本會在資料異常時擋下提交，
所以抓取失敗不會覆蓋掉好的資料。

## 說明

報酬率為**市價**報酬（非淨值）且為累積報酬（非年化）。顏色沿用台股慣例：
**紅漲綠跌**，與美股相反。`N/A` 表示該基金成立未滿該期間。

殖利率的 `N/A` 有兩種可能：完全不配息，或有配息機制但尚未發放過；看「配息」欄才能分辨。

資料由公開來源自動彙整，可能有誤或延遲，**僅供參考，不構成投資建議**。
