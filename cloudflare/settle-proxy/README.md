# settle-proxy（結算價預測的即時指數轉接）

網站「籌碼 → 選擇權 → 結算價預測」用的轉接站。證交所看盤（mis.twse.com.tw）與 Yahoo 的即時指數
沒有 CORS，網頁不能直接讀，所以放一支 Cloudflare Worker 代抓。程式只有 `worker.js` 一個檔。

- 只接受 `GET /taiex`；上游寫死（證交所看盤最新指數＋當天每分鐘走勢，失敗時改 Yahoo ^TWII）。
- CORS 只放行 `https://allenchiwei.github.io` 和本機預覽（127.0.0.1／localhost）。
- 不需要任何金鑰；KV 綁定（SETTLE_KV）可有可無，見下方「每 5 秒取樣」。

## 部署（Cloudflare 網頁，不用裝任何東西）
1. 登入 https://dash.cloudflare.com （沒有帳號就免費註冊）。
2. 左邊 **Workers & Pages** → **Create** → **Create Worker**（Hello World 範本）→ 名稱填 `twetf-settle` → **Deploy**。
3. 進去後按 **Edit code**，把 `worker.js` 全部內容貼上取代 → **Deploy**。
4. 網址會是 `https://twetf-settle.<你的子網域>.workers.dev`。打開 `…/taiex` 應該看到 `{"ok":true,"src":"mis",…}`。
5. 網址 `https://twetf-settle.weiwei840c.workers.dev`（2026-11-21 部署）已填進 `app/src/api/settle.ts` 的 `SETTLE_ORIGIN` 與 `app/vite-plugins.ts` 的 `connect-src`；換網址兩處一起改。

## 4 秒快取與每 5 秒取樣（2026-11-21）
- **快取**：不用設定。4 秒內的請求共用同一份（記憶體），看的人再多也只打證交所一次。
- **每 5 秒取樣（要在 Cloudflare 多設定）**：沒設定也能用，只是 13:00 後才打開網頁的人要靠每分鐘資料內插。
  1. Workers & Pages → **KV** → **Create namespace**，名稱 `twetf-settle-samples`。
  2. 回到 `twetf-settle` → **Settings → Bindings → Add → KV namespace**：Variable name 填 `SETTLE_KV`，選剛建的 namespace → Deploy。
  3. 同頁 **Settings → Trigger events（Triggers）→ Add → Cron Triggers**，加兩條（UTC，＝台北 12:59～13:30 平日）：`59 4 * * MON-FRI`、`0-30 5 * * MON-FRI`。
     **星期一定用英文縮寫**：Cloudflare 的星期是 1＝星期日、7＝星期六（和一般 cron 不同），2026-11-27 前寫的 `1-5` 其實是「週日～週四」，週五結算日整天沒取樣（11-27 週五 samples 0 筆、11-26 週四 92 筆）。
  4. 打開 `…/taiex` 看到 `"kv":true` 就是綁好了；平日 13:01 以後 `samples` 會開始有東西。
- 免費方案用量：排程每天 32 次、KV 寫 32 次、讀約 1 千次以內（額度：每天 10 萬次請求、KV 寫 1 千／讀 10 萬）。

## 本機測試
`node D:/ai/_tmp/settle/worker_test.mjs`（真實網路：來源、CORS、錯誤路徑）；`node D:/ai/_tmp/settle/worker_test2.mjs`（假上游＋假 KV＋假時鐘：快取次數、排程取樣、samples 讀回）。
