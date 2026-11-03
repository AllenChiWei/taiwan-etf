# 策略產生器結果（#/GEN，私人頁）

2026-11-02 使用者要求：用 QT 策略產生器做 10 支空方策略（風險平價口數），在網站私人區看淨利、淨利÷MDD、獲利因子、績效曲線、每年績效。

- 頁面：`app/src/routes/GenPage.tsx`（只負責排版與畫圖；ECharts 只在這頁載入）。入口在「我的工具」（#/me）。
- 資料：`app/public/data/gen/gen.enc`＋`secure.json`，用 v18 的密碼與 salt 加密（解鎖一次私人頁就能看，localStorage 鍵 `twetf.v18.unlock`）。
- 2026-11-03 起換成**多 15＋空 15 支**，頁面分「多+空／多單／空單」三個分頁，各有 Portfolio（每日損益直接相加）、權益曲線、每年績效；多+空分頁可疊加三條組合曲線。
- 產生：使用者電腦（QT 研究腳本都在 `QuantBrainsAIO\Release\_rebuild\research\`）
  1. `gen_ls15.py`（從 `D:\ai\_tmp\sgen_1103` 全量結果挑候選）→ `--sgen-robust`（6 項防過擬合，`D:\ai\_tmp\scripts_iso\gls_robust.py`）→ `gen_ls15_final.py`（6 項過 4 項的前 15 支）
  2. `--sgen-pool` 與 `--sgen-pl` 輸出到 `QuantBrainsAIO\BlindTest\Export_Gen_20261103_多空15`（中文參數要用 Python subprocess 傳，Git Bash 會亂碼）
  3. `gen_ls15_payload.py` → `D:\ai\_tmp\gen_ls15\payload.json`（所有數字都在這裡算好）
  4. `cd D:\ai\DashBoard_AI && uv run --python 3.12 gen_export.py D:\ai\_tmp\gen_ls15\payload.json`（加密、只提交 data/gen/、推送；會重設這個 worktree，先提交自己的修改）
- 資料格式：`dates`（共用日期）、`strategies[]`（id、side、sess、組合、stats.all/is/os、years[]、eq[] 累計萬元、robust、pl 程式碼）、
  `combos.long/short/both`（n、stats、years、eq、相關；both 多一個 corrLS＝多單組合 vs 空單組合）。舊格式（只有 `combo`、沒有 side）也能顯示，當成空單一組。
- 2026-11-03 站主：每列前面有勾選框，可以把策略移出組合，組合在前端重算（`lib/genPortfolio.ts`，`tests/genPortfolio.test.ts`），上方顯示「全部開著 → 現在」的變化，曲線多一條全開虛線；關掉的記在 localStorage `twetf.gen.off|<generated>`。詳細區多了統計卡（樣本內外每年淨利、賺錢年份、最好最差年、SQN 或相關）與每年淨利長條圖。資料每段、每年要有 `gp`／`gl`（萬，獲利／虧損交易合計）才能重算獲利因子，舊資料顯示「—」；QT「一鍵組合」的 portfolio.json 也有（2026.11.3.2 之後的版本）。
- 本機實測私人頁：`D:\ai\_tmp\scripts_iso\gen_verify.py`（v18 金鑰由程式從 .env 讀、塞進 localStorage 跑 site_verify，結束後還原 data/gen 並刪掉含金鑰的 Edge 設定檔）。
- 私人頁不記「更新」頁（changelog）。
