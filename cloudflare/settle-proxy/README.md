# settle-proxy（結算價預測的即時指數轉接）

網站「籌碼 → 選擇權 → 結算價預測」用的轉接站。證交所看盤（mis.twse.com.tw）與 Yahoo 的即時指數
沒有 CORS，網頁不能直接讀，所以放一支 Cloudflare Worker 代抓。程式只有 `worker.js` 一個檔。

- 只接受 `GET /taiex`；上游寫死（證交所看盤最新指數＋當天每分鐘走勢，失敗時改 Yahoo ^TWII）。
- CORS 只放行 `https://allenchiwei.github.io` 和本機預覽（127.0.0.1／localhost）。
- 不需要任何金鑰或環境變數；免費方案每天 10 萬次請求，一個人看一場結算約 400 次。

## 部署（Cloudflare 網頁，不用裝任何東西）
1. 登入 https://dash.cloudflare.com （沒有帳號就免費註冊）。
2. 左邊 **Workers & Pages** → **Create** → **Create Worker**（Hello World 範本）→ 名稱填 `twetf-settle` → **Deploy**。
3. 進去後按 **Edit code**，把 `worker.js` 全部內容貼上取代 → **Deploy**。
4. 網址會是 `https://twetf-settle.<你的子網域>.workers.dev`。打開 `…/taiex` 應該看到 `{"ok":true,"src":"mis",…}`。
5. 網址 `https://twetf-settle.weiwei840c.workers.dev`（2026-11-21 部署）已填進 `app/src/api/settle.ts` 的 `SETTLE_ORIGIN` 與 `app/vite-plugins.ts` 的 `connect-src`；換網址兩處一起改。

## 本機測試
`node D:/ai/_tmp/settle/worker_test.mjs`（用 Node 直接呼叫 worker 的 fetch，檢查來源、CORS、錯誤路徑）。
