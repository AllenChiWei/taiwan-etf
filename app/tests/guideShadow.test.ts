import test from 'node:test';
import assert from 'node:assert/strict';
import { toShadowHtml } from '../src/lib/guideShadow.ts';

test('說明書轉 Shadow DOM：:root／深淺色／body 改寫，去掉 title 與外部連結', () => {
  const src = '<title>QB</title><link rel="stylesheet" href="x"><style>:root { --ink: #111; }\n'
    + '@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --ink: #eee; } }\n'
    + ':root[data-theme="dark"] { --ink: #eee; }\nbody { margin: 0; }\nhtml { scroll-behavior: smooth; }</style><main>內容</main>';
  const out = toShadowHtml(src);
  assert.ok(out.includes(':host { --ink: #111; }'));
  assert.ok(out.includes(':host(:not([data-theme="light"]))'));
  assert.ok(out.includes(':host([data-theme="dark"])'));
  assert.ok(out.includes('.gb-body { margin: 0; }'));
  assert.ok(!out.includes(':root'));
  assert.ok(!out.includes('<title>') && !out.includes('<link'));
  assert.ok(out.includes('<div class="gb-body"><main>內容</main></div>'));
});
