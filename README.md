# 台灣 ETF 總覽

可搜尋的台灣 ETF 清單（359 檔），含保管銀行、配息頻率、殖利率與近 3 月／6 月／1 年報酬率，
並連結至 MoneyDJ 個別頁面。

**線上瀏覽：** https://allenchiwei.github.io/taiwan-etf/

## 內容

- `taiwan_etf_list.html` — 整份清單，單一自包含檔案（HTML／CSS／JS 全部內嵌，無需 build）
- `index.html` — 轉址至上述頁面
- `.claude/skills/update-etf-list/` — 從 TWSE／TPEx 開放資料與 MoneyDJ 重建表格的更新腳本

## 更新資料

資料來源為 FinLab／MoneyDJ。更新方式見 `CLAUDE.md`；請勿手動編輯表格列。
更新後 `git commit` 並 `git push`，GitHub Pages 會自動重新部署。

## 說明

報酬率為**市價**報酬（非淨值），顏色沿用台股慣例：紅漲綠跌。`N/A` 表示該基金成立未滿該期間。
資料僅供參考，不構成投資建議。
