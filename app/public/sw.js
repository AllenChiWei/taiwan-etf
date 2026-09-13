/* Service worker：離線可看、二次開啟更快。
 *
 * 策略依資源性質分開，因為它們的更新節奏完全不同：
 *   /assets/*   Vite 產生的檔名帶內容雜湊，同名內容就不會變 → cache-first
 *   etfs.json   每天更新 → network-first，離線時退回上次成功的版本
 *   其他（含導覽請求）→ network-first，離線時退回快取，再不行退回首頁
 *
 * HTML 刻意不用 cache-first：那會讓使用者卡在舊版的 index.html，
 * 進而載入已經不存在的舊雜湊檔名，畫面直接空白。
 */

const VERSION = 'v1';
const ASSETS = `twetf-assets-${VERSION}`;
const RUNTIME = `twetf-runtime-${VERSION}`;

self.addEventListener('install', () => {
  // 不預先快取任何東西：資產檔名每次建置都變，預快取清單很快就過期。
  // 第一次瀏覽時自然填入即可。
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== ASSETS && k !== RUNTIME).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;      // 外部連結交給瀏覽器

  if (url.pathname.includes('/assets/')) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirst(request));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    if (request.mode === 'navigate') {
      const shell = await cache.match(new URL('./', self.location).href);
      if (shell) return shell;
    }
    throw err;
  }
}
