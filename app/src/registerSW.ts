/* Service worker 註冊。
   只在 https（線上）註冊 —— 本機 http 開發時掛著 SW 會讓「改了卻沒變」變成常態。
   localhost 是例外，但開發用 vite dev server 沒有 sw.js，所以直接排除更單純。 */

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:') return;

  addEventListener('load', () => {
    const url = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker.register(url, { scope: import.meta.env.BASE_URL })
      .catch((err: unknown) => {
        // 註冊失敗不該影響網站本身，只是少了離線能力
        console.warn('Service worker 註冊失敗', err);
      });
  });
}
