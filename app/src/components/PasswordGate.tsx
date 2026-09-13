/* 受保護內容的解鎖畫面。
   保護的是 FinLab 付費訂閱衍生的資料（美股清單、績效曲線）；
   台股那份來自公開的 TWSE／TPEx／MoneyDJ，不在保護範圍。 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  loadManifest, restoreSession, unlock, isUnlocked, sessionRemaining,
  type SecureManifest,
} from '../lib/secure';

type Status = 'checking' | 'locked' | 'unlocked' | 'unavailable';

interface Props {
  children: ReactNode;
  /** 說明這塊內容是什麼，讓使用者知道為什麼要輸入密碼 */
  what: string;
}

export function PasswordGate({ children, what }: Props) {
  const [status, setStatus] = useState<Status>(
    isUnlocked() ? 'unlocked' : 'checking');
  const [manifest, setManifest] = useState<SecureManifest | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === 'unlocked') return;
    let cancelled = false;
    loadManifest(import.meta.env.BASE_URL)
      .then(async m => {
        if (cancelled) return;
        setManifest(m);
        setStatus((await restoreSession(m)) ? 'unlocked' : 'locked');
      })
      .catch(() => { if (!cancelled) setStatus('unavailable'); });
    return () => { cancelled = true; };
  }, [status]);

  useEffect(() => {
    if (status === 'locked') inputRef.current?.focus();
  }, [status]);

  if (status === 'unlocked') return <>{children}</>;

  if (status === 'checking') {
    return <p className="py-16 text-center text-muted">檢查存取權限中…</p>;
  }

  if (status === 'unavailable') {
    return (
      <div className="mt-6 rounded-xl border border-line bg-surface px-4 py-8 text-center">
        <p className="text-sm text-muted">
          這個部署版本沒有包含{what}。<br />
          （資料是部署時產生的，需要在 GitHub Actions 設定 FinLab 憑證。）
        </p>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manifest || busy) return;
    setBusy(true);
    setError(null);
    try {
      // PBKDF2 二十萬次在手機上約一秒，這段等待是刻意的成本
      const ok = await unlock(password, manifest);
      if (ok) {
        setPassword('');
        setStatus('unlocked');
      } else {
        setError('密碼不正確');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const hours = manifest?.ttlHours ?? 12;

  return (
    <div className="mx-auto mt-8 max-w-md rounded-xl border border-line bg-surface p-5">
      <h2 className="text-base font-bold text-ink">需要密碼</h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
        {what}來自付費資料訂閱，因此是加密存放的 —— 沒有密碼的話，那些檔案只是一堆亂數。
        台股清單不受限制，可以直接看。
      </p>

      <form onSubmit={submit} className="mt-4">
        <label htmlFor="gate-pw" className="text-[11.5px] font-semibold text-muted">密碼</label>
        <input
          ref={inputRef}
          id="gate-pw"
          type="password"
          value={password}
          onChange={e => { setPassword(e.target.value); setError(null); }}
          autoComplete="current-password"
          disabled={busy}
          className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-base text-ink
                     focus:border-accent focus:ring-3 focus:ring-accent-soft focus:outline-none
                     disabled:opacity-60"
        />

        {error && <p className="mt-2 text-[13px] font-semibold text-up">{error}</p>}

        <button
          type="submit"
          disabled={busy || password.length === 0}
          className="mt-3 h-11 w-full rounded-lg bg-accent text-sm font-semibold text-accent-ink
                     transition-opacity disabled:opacity-40"
        >
          {busy ? '驗證中…' : '解鎖'}
        </button>
      </form>

      <p className="mt-3 text-[12px] text-faint">
        解鎖後這台裝置會記住 {hours} 小時，期間切換分頁不必重新輸入。
      </p>
    </div>
  );
}

/** 頁首用的小標示：顯示剩餘時間並可手動上鎖。 */
export function useSessionRemainingLabel(): string | null {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => {
      const ms = sessionRemaining();
      if (!ms || !isUnlocked()) { setLabel(null); return; }
      const h = Math.floor(ms / 3600_000);
      const m = Math.floor((ms % 3600_000) / 60_000);
      setLabel(h > 0 ? `${h} 小時 ${m} 分` : `${m} 分`);
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);
  return label;
}
