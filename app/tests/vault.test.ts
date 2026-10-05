/* lib/vault.ts 的加密／解密來回（2026-10-06 私人持股同步：網站端也要能加密寫回）。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vault, type VaultManifest } from '../src/lib/vault.ts';

const enc = new TextEncoder();
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

async function makeManifest(password: string, compressed: boolean): Promise<VaultManifest> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const raw = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1000 }, base, 256);
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode('ok')));
  const check = new Uint8Array(12 + ct.length);
  check.set(iv); check.set(ct, 12);
  return { v: 1, kdf: 'PBKDF2-SHA256', iterations: 1000, salt: b64(salt), check: b64(check), ttlHours: 6, compressed };
}

for (const compressed of [false, true]) {
  test(`encryptJson → decryptJson 來回一致（compressed=${compressed}）`, async () => {
    const m = await makeManifest('pw', compressed);
    const v = new Vault('/x/', 'test.unlock');
    assert.equal(await v.unlock('pw', m), true);
    (v as unknown as { manifest: VaultManifest }).manifest = m;     // loadManifest 平常由 fetch 設定
    const obj = { v: 1, accounts: ['永豐'], holdings: [{ code: '0056', shares: 500, acct: '永豐' }] };
    const bytes = await v.encryptJson(obj);
    assert.ok(bytes.length > 12);
    assert.deepEqual(await v.decryptJson(bytes), obj);
  });
}

test('錯的密碼解不開', async () => {
  const m = await makeManifest('pw', true);
  const v = new Vault('/x/', 'test.unlock');
  assert.equal(await v.unlock('wrong', m), false);
  await assert.rejects(() => v.encryptJson({ a: 1 }));
});

test('unlockTransient：密碼對才解得開、不寫工作階段', async () => {
  const m = await makeManifest('pw', true);
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); }, clear: () => store.clear(), key: () => null, length: 0,
  } as Storage;
  const v = new Vault('/x/', 'test.transient');
  assert.equal(await v.unlockTransient('wrong', m), false);
  assert.equal(v.unlocked, false);
  assert.equal(await v.unlockTransient('pw', m), true);
  assert.equal(store.has('test.transient'), false);                // 不寫工作階段
  const obj = { holdings: [{ code: '2330', shares: 20 }] };
  assert.deepEqual(await v.decryptJson(await v.encryptJson(obj)), obj);
  v.forget();
  assert.equal(v.unlocked, false);
});
