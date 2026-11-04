---
name: data-block
description: 在 TaiwanETF 網站加一份「每天累積的歷史資料」（官方端點只給近期、要靠每天累積的那種：融資維持率、融券／借券、追繳、臺指 VIX、正逆價差、漲跌家數、可轉債走勢…）的固定流程：FinLab 或官方回補種子並跟官方對帳 → fetch 腳本每天接官方資料 → 種子＋Actions 快取＋線上那份三層合併防遺失 → 前端折線圖 → 測試、site-data-check 的 FILES、文件、更新頁 → site_verify 手機實測 → 推送與確認上線。使用者說「網站加上某某的歷史」「這個資料也幫我每天累積」「加一張某某的走勢圖」「回補某某歷史」時使用；改既有累積資料（換來源、修種子、補缺日）也用。
---

# 網站累積式資料區塊

2026-11-04 一天裡做了七份（可轉債走勢、追繳、融資維持率、融券、借券、臺指 VIX、正逆價差、漲跌家數），
步驟都一樣、坑也一樣。照順序做，不要跳步驟——尤其是第 3 步，漏掉它累積的歷史會在某次部署時整段消失。

在 worktree `D:\ai\_cache\taiwanetf-pub` 做（detached：先 `git fetch -q && git checkout -q --detach origin/main`），
推送 `git push origin HEAD:main`。網站資料流程細節看 `docs/claude/chips.md`、`docs/claude/cb.md`。

## 1. 先找來源、確認歷史有多長
- 官方端點（證交所 rwd、櫃買 www/zh-tw、期交所 CSV／月檔）多半只給近期：BFIJ3U 60 天、期交所 VIX 3 個月、三大法人 3 年。
  **先實測最舊能查到哪天**（查太舊時常回 HTML、302 或「沒有符合條件的資料」，不是錯誤訊息）。
- 回補來源優先 FinLab（`D:\ai\DashBoard_AI\.agents\skills\finlab\data-reference.md` 查資料集名稱），
  研究腳本放 `D:\ai\DashBoard_AI\research_*.py`，**先 `import fl_storage; fl_storage.research_mode()`**（不落 C 槽、不重複下載）。
- 沒有回補來源的（追繳、VIX）：把當下線上已累積的那段存成種子，之後靠累積。

## 2. 回補種子＋跟官方對帳（必做）
- 種子放 `scripts/data/<名稱>_seed.json`：`{"cols": [...], "source": "來源與對帳結果", "rows": [[日期, ...], ...]}`，日期 `YYYY-MM-DD`。
- **拿最近一天跟官方逐筆對帳**，對上才寫種子。踩過的：
  - 借券賣出：官方合計有六成是 ETF（造市避險），FinLab 只收部分 ETF → 只算個股（四碼、不以 0 開頭）後逐檔一致。
  - 融券、融資張數：FinLab `margin_balance` 跟 MI_MARGN、櫃買合計列一致。
  - 漲跌家數：FinLab 收盤價對前一日，跟 MI_INDEX「漲跌證券數合計」股票欄每天差 0～4 家（參考價差異），可接受。
- **檢查缺資料的日子**：合計比前後 5 天中位數低兩成以上的當缺資料剔除（借券 2022 年有 9 天少了部分個股，畫出往下的尖刺）。
- FinLab 的某些資料集會停更（加權指數 2026-10-16 之後被 ffill），尾段用官方補，並在 source 註明。
- 研究結果只印在畫面，不另存（使用者 11-04：研究資料佔空間）。

## 3. 每天接著抓＋三層合併（防遺失）
在 `scripts/fetch_chips.py`（籌碼頁）或對應的 fetch 腳本：
- 今天的值：官方端點，上市＋上櫃要**兩邊都拿到才加**（只有一半就跟歷史不是同一個口徑）。
- 合併用 `_seed_and_live(SEED, key, conv, section)`：版控種子 → Actions 快取 `.cache/chips_hist.json` → 線上那份 chips.json，後蓋前。
  新的 key 要加進 `HIST_KEYS`，`save_hist_cache(...)` 才會存。
- **不要只靠線上那份**：某次部署讀不到它，產出就只剩種子＋今天，還會把線上那份蓋掉（追繳那份證交所只給 60 天＝永久遺失）。
- 新資料要掛到 `deploy.yml` 的哪個步驟、快取 restore／save 有沒有涵蓋，順手確認。
- 交易所公布時間：融資、維持率、追繳最晚約 21:30；19:05 的每日更新抓不到的，靠 21:45 的晚間部署補（`site-data-check` 的 trigger_site.py）。
- 本機跑 `python -I -X utf8 scripts/fetch_chips.py`（`-I` 會忽略 PYTHONIOENCODING，cp950 印不出 ⚠）。CBOE 憑證錯誤是這台電腦的問題，CI 正常。
  **重跑前刪掉本機 `.cache/chips_hist.json`**，不然改過的種子會被舊快取蓋回去。

## 4. 前端：折線圖，不要一堆數字
- 使用者 2026-11-04：「做折線圖看趨勢，我不要一堆數字」。用 `ChipsPage.tsx` 的 `TrendChart`（標題旁只放最新一個值）、
  跟同區塊共用 1 年／5 年／全部切換；統計格、表格欄位、券資比之類的衍生數字不要主動加。
- 型別與純函式放 `app/src/lib/chips.ts`，`app/tests/chips.test.ts` 加測試；舊版 chips.json 沒有新欄位，前端要能沒有它照常顯示。
- 有雜訊的序列先想清楚口徑：正逆價差用收盤相減會被「期貨 13:45、指數 13:30 收」帶著跳，改 5 日平均並在標題註明。
- 季節性要寫在說明：融券 4～8 月股東會／除權息強制回補、正逆價差 6～8 月除息逆價差。
- 籌碼頁有頁首捷徑 `JUMPS`，新區塊要加一個。

## 5. 收尾（每一項都要做）
- `cd app && npx tsc -b && npm test`。
- `D:\ai\.claude\skills\site-data-check\check.py` 的 `FILES` 加一行，日期看資料最後一天（`_last_row(...)`），不要看 updated。
- `docs/claude/chips.md`（或對應主題文件）記來源、對帳結果、坑；`app/src/lib/changelog.ts` 加一條（使用者要求：看得到的改動都要記）。
- `python -I D:/ai/.claude/skills/site-data-check/site_verify.py --route chips --expect "<具體的值>"`，長頁加 `--height 16000`，
  截圖用 `D:\ai\_tmp\scripts_iso\crop_shot.py` 切段後真的看一眼；本機產生的 `app/public/data/chips.json` 驗完刪掉。
- 推送後背景等 `version.json` 變成這次的提交、`data/chips.json` 有新欄位，才回報上線。
- 交接檔用 handoff.py 記；改了 skill／規則跑 `python -I D:/ai/ai-handoff/evals/run_checks.py`。
