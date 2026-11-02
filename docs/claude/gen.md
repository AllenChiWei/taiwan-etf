# 策略產生器結果（#/GEN，私人頁）

2026-11-02 使用者要求：用 QT 策略產生器做 10 支空方策略（風險平價口數），在網站私人區看淨利、淨利÷MDD、獲利因子、績效曲線、每年績效。

- 頁面：`app/src/routes/GenPage.tsx`（只負責排版與畫圖；ECharts 只在這頁載入）。入口在「我的工具」（#/me）。
- 資料：`app/public/data/gen/gen.enc`＋`secure.json`，用 v18 的密碼與 salt 加密（解鎖一次私人頁就能看，localStorage 鍵 `twetf.v18.unlock`）。
- 產生：使用者電腦
  1. `QuantBrainsAIO\Release\_rebuild\research\gen_short10_payload.py` → `D:\ai\_tmp\gen_short10_payload.json`（所有數字都在這裡算好）
  2. `cd D:\ai\DashBoard_AI && uv run --python 3.12 gen_export.py D:\ai\_tmp\gen_short10_payload.json`（加密、只提交 data/gen/、推送）
- 資料格式：`dates`（共用日期）、`strategies[]`（id、組合、stats.all/is/os、years[]、eq[] 累計萬元、robust、pl 程式碼）、`combo`（合計）。換一批策略只要重產 JSON，網頁不用改。
- 私人頁不記「更新」頁（changelog）。
