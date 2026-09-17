/* CSP 的雜湊必須是從 HTML 算出來的，不是寫死的。
 *
 * 寫死的話，改動主題腳本的一個空白就會讓正式站的所有腳本被擋掉、畫面全白，
 * 而且開發模式沒有 CSP，本機完全看不出來。這組測試盯的就是這件事。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { buildCsp, scriptHash } from '../vite-plugins.ts';

const INDEX = new URL('../index.html', import.meta.url);

test('buildCsp', async (t) => {
  await t.test('內嵌腳本用自己的雜湊放行，不用 unsafe-inline', () => {
    const html = '<head><script>var a = 1;</script></head>';
    const csp = buildCsp(html);
    const expected = createHash('sha256').update('var a = 1;', 'utf8').digest('base64');
    assert.ok(csp.includes(`'sha256-${expected}'`), csp);
    assert.ok(!csp.includes("script-src 'self' 'unsafe-inline'"), 'script 不該允許 unsafe-inline');
  });

  await t.test('帶 src 的外部腳本不需要雜湊（由 self 涵蓋）', () => {
    const csp = buildCsp('<script type="module" src="/src/main.tsx"></script>');
    assert.equal(csp.match(/sha256-/g), null);
  });

  await t.test('沒有寫 frame-ancestors 與 report-uri —— meta 裡會被忽略', () => {
    const csp = buildCsp('<head></head>');
    assert.ok(!csp.includes('frame-ancestors'));
    assert.ok(!csp.includes('report-uri'));
  });

  await t.test('預設封鎖：object-src none、form-action none、base-uri self', () => {
    const csp = buildCsp('<head></head>');
    for (const d of ["default-src 'self'", "object-src 'none'",
                     "form-action 'none'", "base-uri 'self'"]) {
      assert.ok(csp.includes(d), `缺少 ${d}`);
    }
  });
});

test('真實 index.html 的內嵌腳本都被放行', () => {
  const html = readFileSync(INDEX, 'utf8');
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(inline.length >= 1, 'index.html 應該有主題那段內嵌腳本');
  const csp = buildCsp(html);
  for (const m of inline) {
    assert.ok(csp.includes(scriptHash(m[1])), '有內嵌腳本沒有出現在 CSP 裡');
  }
});
