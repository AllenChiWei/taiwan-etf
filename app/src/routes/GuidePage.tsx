/* QB 設定說明書（#/QBG，私人頁，密碼同 v18；2026-10-08 使用者要求放到網站私人區）。
 * 內容是 D:\ai\QuantBrainsAIO\Release\_rebuild\QB_GuideBook.html，由 DashBoard_AI\guide_export.py 加密成 data/guide/guide.enc。
 * 用 iframe srcDoc 顯示：說明書自帶樣式，與網站隔離；sandbox 不允許腳本，只允許同源以便套用網站目前的深淺色（data-theme）。
 * 框架高度＝視窗高度扣掉頂端，說明書的目錄在框架內維持固定、錨點連結照常捲動。 */

import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Vault, type VaultManifest } from '../lib/vault';
import { useVaultExpiry } from '../hooks/useVaultExpiry';
import { Locked } from './QBPage';

const vault = new Vault(`${import.meta.env.BASE_URL}data/guide/`, 'twetf.v18.unlock');
interface Guide { generated: string; title: string; html: string }

export function GuidePage() {
  const [manifest, setManifest] = useState<VaultManifest | null>(null);
  const [state, setState] = useState<'loading' | 'missing' | 'locked' | 'ready' | 'error'>('loading');
  const [g, setG] = useState<Guide | null>(null);
  const [msg, setMsg] = useState('');
  const frame = useRef<HTMLIFrameElement>(null);

  const load = async () => {
    try { setState('loading'); setG(await vault.fetchJson<Guide>('guide.enc')); setState('ready'); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); setState('error'); }
  };
  useEffect(() => {
    vault.loadManifest().then(async m => {
      if (!m) { setState('missing'); return; }
      setManifest(m);
      if (await vault.restore(m)) await load(); else setState('locked');
    }).catch(e => { setMsg(String(e)); setState('error'); });
  }, []);
  useVaultExpiry(vault, state === 'ready', () => { setG(null); setState('locked'); });

  // 讓說明書跟著網站目前的深淺色（網站切換主題時也同步）
  useEffect(() => {
    const sync = () => {
      const doc = frame.current?.contentDocument;
      if (!doc?.documentElement) return;
      const t = document.documentElement.dataset.theme;
      if (t) doc.documentElement.dataset.theme = t; else delete doc.documentElement.dataset.theme;
    };
    // 目錄連結（#flow 等）在 srcDoc 框架裡會依「網站首頁」的網址解析，點了會把整個網站載進框架（禁用腳本 → 只顯示 noscript 提示）。
    // 攔下來改成在框架內捲動；外部連結開新分頁。（2026-10-08 使用者回報）
    const onClick = (e: MouseEvent) => {
      const doc = frame.current?.contentDocument;
      const a = (e.target as Element | null)?.closest?.('a');
      if (!doc || !a) return;
      const href = a.getAttribute('href') ?? '';
      e.preventDefault();
      if (href.startsWith('#')) {
        const target = doc.getElementById(decodeURIComponent(href.slice(1)));
        const se = doc.scrollingElement;
        // 只捲動框架內（scrollIntoView 會連外層網頁一起捲）
        if (target && se) se.scrollTo({ top: target.getBoundingClientRect().top + se.scrollTop - 8 });
      } else if (/^https?:/.test(href)) {
        window.open(href, '_blank', 'noopener');
      }
    };
    const hook = () => { sync(); frame.current?.contentDocument?.addEventListener('click', onClick); };
    const el = frame.current;
    el?.addEventListener('load', hook);
    hook();
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { el?.removeEventListener('load', hook); el?.contentDocument?.removeEventListener('click', onClick); mo.disconnect(); };
  }, [g]);

  if (state === 'loading') return <p className="py-16 text-center text-[13px] text-muted">載入中…</p>;
  if (state === 'missing') return <p className="py-16 text-center text-[13px] text-muted">還沒有說明書資料。</p>;
  if (state === 'locked' && manifest) return <Locked vault={vault} title="QB 設定說明書" manifest={manifest} onUnlock={load} />;
  if (state === 'error' || !g) return <p className="py-16 text-center text-[13px] text-down">載入失敗：{msg}</p>;
  return (
    <div className="mt-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <h1 className="text-base font-bold text-ink">{g.title}</h1>
        <span className="text-[11.5px] text-faint">更新於 {g.generated}　·　<Link to="/me" className="hover:text-ink">← 我的工具</Link></span>
      </div>
      <iframe ref={frame} title={g.title} srcDoc={'<base href="about:srcdoc">' + g.html} sandbox="allow-same-origin"
              className="block h-[calc(100dvh-140px)] min-h-[480px] w-full rounded-xl border border-line bg-surface" />
    </div>
  );
}
