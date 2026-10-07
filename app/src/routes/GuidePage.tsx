/* QB 設定說明書（#/QBG，私人頁，密碼同 v18；2026-10-08 使用者要求放到網站私人區）。
 * 內容是 D:\ai\QuantBrainsAIO\Release\_rebuild\QB_GuideBook.html，由 DashBoard_AI\guide_export.py 加密成 data/guide/guide.enc。
 *
 * 顯示方式（2026-10-08 改）：原本用 iframe srcDoc，但有些瀏覽器（手機）會把整個網站載進框架，只看到 noscript 提示。
 * 改成放進 Shadow DOM：樣式一樣與網站隔離，所有瀏覽器行為一致。
 *   - 說明書的 :root／html／body 樣式換成 :host／.gb-body（Shadow DOM 裡沒有 :root）
 *   - 深淺色：把網站 <html data-theme> 複製到宿主元素，:host([data-theme=…]) 生效；沒設定時跟系統
 *   - 目錄連結（#flow）會被網站的 hash 路由吃掉 → 攔下來，改成捲動到說明書裡的章節 */

import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Vault, type VaultManifest } from '../lib/vault';
import { useVaultExpiry } from '../hooks/useVaultExpiry';
import { Locked } from './QBPage';
import { toShadowHtml } from '../lib/guideShadow';

const vault = new Vault(`${import.meta.env.BASE_URL}data/guide/`, 'twetf.v18.unlock');
interface Guide { generated: string; title: string; html: string }

export function GuidePage() {
  const [manifest, setManifest] = useState<VaultManifest | null>(null);
  const [state, setState] = useState<'loading' | 'missing' | 'locked' | 'ready' | 'error'>('loading');
  const [g, setG] = useState<Guide | null>(null);
  const [msg, setMsg] = useState('');
  const host = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const el = host.current;
    if (!el || !g) return;
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
    root.innerHTML = toShadowHtml(g.html);
    const sync = () => {
      const t = document.documentElement.dataset.theme;
      if (t) el.dataset.theme = t; else delete el.dataset.theme;
    };
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const onClick = (e: Event) => {
      const a = (e.target as Element | null)?.closest?.('a');
      const href = a?.getAttribute('href') ?? '';
      if (!href.startsWith('#')) return;
      e.preventDefault();
      root.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ block: 'start' });
    };
    root.addEventListener('click', onClick);
    return () => { mo.disconnect(); root.removeEventListener('click', onClick); };
  }, [g]);

  if (state === 'loading') return <p className="py-16 text-center text-[13px] text-muted">載入中…</p>;
  if (state === 'missing') return <p className="py-16 text-center text-[13px] text-muted">還沒有說明書資料。</p>;
  if (state === 'locked' && manifest) return <Locked vault={vault} title="QB 設定說明書" manifest={manifest} onUnlock={load} />;
  if (state === 'error' || !g) return <p className="py-16 text-center text-[13px] text-down">載入失敗：{msg}</p>;
  return (
    <div className="mt-3 min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <h1 className="text-base font-bold text-ink">{g.title}</h1>
        <span className="text-[11.5px] text-faint">更新於 {g.generated}　·　<Link to="/me" className="hover:text-ink">← 我的工具</Link></span>
      </div>
      <div ref={host} className="overflow-clip rounded-xl border border-line" />
    </div>
  );
}
