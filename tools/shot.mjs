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

import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
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

// 設定檔放在專案底下（.cache/ 已 gitignore），不寫進系統暫存區。
// 這支工具曾經在使用者的系統碟留下 69 個設定檔、共 22 GB，把 C 碟塞滿 ——
// 每個 Edge 設定檔約 320 MB，而它原本從不清理。
const profileRoot = new URL('../.cache/shot-profiles/', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1');
const profile = `${profileRoot}${process.pid}`;
mkdirSync(profile, { recursive: true });

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
    // 互動測試（--js）常常要等動態載入的分頁與 PBKDF2，30 秒不夠
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`${method} 逾時`));
    }, 150000);
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

/**
 * 收尾：關掉整棵瀏覽器行程樹，再刪掉這次的設定檔。
 *
 * proc.kill() 只殺得掉啟動的那一個行程。Edge 會另外開數十個子行程（算繪、GPU、
 * 工具程序），那些孤兒行程會一直握著設定檔不放，於是檔案刪不掉、記憶體也收不回。
 * 這支工具曾經因此累積出 542 個殘留行程與 22 GB 設定檔，讓整台機器慢到
 * tsc 會卡住十幾分鐘、Python 行程被系統中止。Windows 必須用 taskkill /T。
 */
async function cleanup() {
  try { ws?.close(); } catch { /* 已關閉 */ }
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      // taskkill /T 只走得到父子關係，Edge 有些行程是另外派生的，抓不到。
      // 補一道以「命令列含我們這次的設定檔路徑」為條件的清除 —— 這個條件只會命中
      // 本次啟動的行程，不會誤殺使用者自己開著的瀏覽器視窗。
      spawnSync('powershell', ['-NoProfile', '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | ` +
        `Where-Object { $_.CommandLine -like '*${profile.replace(/\\/g, '/')}*' } | ` +
        `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
      ], { stdio: 'ignore' });
    } else {
      proc.kill('SIGKILL');
    }
  } catch { /* 行程可能已經結束 */ }

  // 等檔案控制代碼釋放後再刪，失敗就重試幾次
  await sleep(400);
  for (let i = 0; i < 3; i++) {
    try { rmSync(profile, { recursive: true, force: true }); break; }
    catch { await sleep(600); }
  }
}

main()
  .catch(err => { console.error('截圖失敗:', err.message); process.exitCode = 1; })
  .finally(cleanup);
