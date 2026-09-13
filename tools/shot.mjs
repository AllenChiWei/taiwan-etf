/* 用 DevTools Protocol 對本機頁面截圖，支援真正的手機模擬。
 *
 *   node tools/shot.mjs <url> <out.png> [寬x高] [--full] [--dsf=2] [--js=檔案]
 *
 * --js 指向一個 JS 檔，內容會在頁面情境中執行，回傳值印到主控台後才截圖 ——
 * 用來驗證互動（篩選後還剩幾列、排序後第一列是誰）而不只是靜態外觀。
 *
 * 為什麼不用 --screenshot：Windows 上 Edge 的最小視窗寬度約 492px，
 * --window-size=390 會得到 492px 的 CSS 視窗配上 390px 的畫布，
 * 截出來的圖是被裁掉的，看起來像版面爆版其實不是。
 * Emulation.setDeviceMetricsOverride 不受視窗大小限制，才是準的。
 *
 * Node 22+ 內建 WebSocket，所以不需要任何 npm 套件。
 */

import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];

const [url, out, size = '390x844', ...rest] = process.argv.slice(2);
if (!url || !out) {
  console.error('用法: node tools/shot.mjs <url> <out.png> [寬x高] [--full] [--dsf=2]');
  process.exit(1);
}
const [width, height] = size.split('x').map(Number);
const full = rest.includes('--full');
const dsf = Number((rest.find(a => a.startsWith('--dsf=')) || '--dsf=2').slice(6));
const mobile = width <= 820;

const browser = EDGE_CANDIDATES.find(p => existsSync(p));
if (!browser) {
  console.error('找不到 Edge 或 Chrome');
  process.exit(1);
}

const PORT = 9222 + (process.pid % 500);
const profile = `${process.env.TEMP || '/tmp'}/shot-profile-${process.pid}`;

const proc = spawn(browser, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

let ws;
let nextId = 1;
const pending = new Map();

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`${method} 逾時`));
    }, 30000);
  });
}

const events = new Map();
function once(eventName) {
  return new Promise(resolve => events.set(eventName, resolve));
}

// 頁面的主控台訊息與未攔截的例外 —— 空白畫面幾乎都是這裡有東西
const logs = [];
function recordEvent(method, params) {
  if (method === 'Runtime.consoleAPICalled' && /error|warning/.test(params.type)) {
    logs.push(`[console.${params.type}] ` +
      params.args.map(a => a.description ?? a.value ?? a.type).join(' '));
  } else if (method === 'Runtime.exceptionThrown') {
    const d = params.exceptionDetails;
    logs.push(`[例外] ${d.exception?.description ?? d.text}`);
  } else if (method === 'Log.entryAdded' && params.entry.level === 'error') {
    logs.push(`[${params.entry.source}] ${params.entry.text} ${params.entry.url ?? ''}`);
  }
}

async function main() {
  // 等偵錯埠開起來
  let target = null;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
      target = list.find(t => t.type === 'page');
      if (target?.webSocketDebuggerUrl) break;
    } catch { /* 還沒起來 */ }
    await sleep(250);
  }
  if (!target) throw new Error('連不上 DevTools，瀏覽器可能沒啟動');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      recordEvent(msg.method, msg.params);
      if (events.has(msg.method)) {
        events.get(msg.method)(msg.params);
        events.delete(msg.method);
      }
    }
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');

  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: dsf, mobile,
    screenWidth: width, screenHeight: height,
  });
  if (mobile) {
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setUserAgentOverride', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
               + '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
  }

  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url });
  await Promise.race([loaded, sleep(15000)]);
  await sleep(600);                       // 讓 fetch/rAF 收尾

  // 順手回報版面是否橫向溢出 —— 手機版最常見的毛病
  const probe = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const vw = document.documentElement.clientWidth;
      const sw = document.documentElement.scrollWidth;
      const over = [...document.querySelectorAll('body *')]
        .map(e => [e, e.getBoundingClientRect()])
        .filter(([, r]) => r.right > vw + 1)
        .sort((a, b) => b[1].right - a[1].right)
        .slice(0, 5)
        .map(([e, r]) => (e.tagName.toLowerCase()
          + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().replace(/ +/g, '.') : ''))
          .slice(0, 50) + ' +' + Math.round(r.right - vw) + 'px');
      return { vw, sw, over };
    })()`,
  });
  const r = probe.result.value;
  if (logs.length) {
    console.log(`  頁面錯誤 ${logs.length} 則：`);
    const firstLine = (s) => s.split(String.fromCharCode(10))[0].slice(0, 200);
    for (const l of logs.slice(0, 8)) console.log('    ' + firstLine(l));
  }
  console.log(`  視窗 ${r.vw}px  內容 ${r.sw}px  ${r.sw > r.vw + 1 ? '橫向溢出！' : '無橫向溢出'}`);
  for (const o of r.over) console.log(`    溢出: ${o}`);

  const jsArg = rest.find(a => a.startsWith('--js='));
  if (jsArg) {
    const code = readFileSync(jsArg.slice(5), 'utf8');
    const res = await send('Runtime.evaluate', {
      expression: code, returnByValue: true, awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error('頁面腳本錯誤: ' + (res.exceptionDetails.exception?.description
                                          || res.exceptionDetails.text));
    }
    const v = res.result.value;
    console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
    await sleep(250);
  }

  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: full,
  });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`  已存 ${out}`);
}

main()
  .catch(err => { console.error('截圖失敗:', err.message); process.exitCode = 1; })
  .finally(() => { try { ws?.close(); } catch {} proc.kill(); });
