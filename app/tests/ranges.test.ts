/* 開牌與防守範圍的一致性檢查。
 *
 * 這些範圍是手寫的字串，最容易出的錯不是「寫錯字」（那會被 parseRange 擋下來），
 * 而是「寫出不合理的組合」—— 同一手牌同時出現在 3-bet 與跟注裡、或是面對
 * UTG 的防守比面對 BTN 還寬。那種錯誤解析得過、畫得出來，只有靠斷言抓。 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { POSITIONS, VS_OPEN, resolve, resolveDefense } from '../src/lib/ranges.ts';

describe('開牌範圍（RFI）', () => {
  test('每個位置的範圍都解析得出來', () => {
    for (const p of POSITIONS) {
      if (!p.rfi) continue;
      assert.doesNotThrow(() => resolve(p.rfi!), `${p.label} 的範圍解析失敗`);
    }
  });

  test('BB 沒有開牌範圍', () => {
    const bb = POSITIONS.find(p => p.id === 'bb');
    assert.ok(bb, '應該要有 BB');
    assert.equal(bb!.rfi, undefined,
      'BB 前面全蓋牌時直接免費看翻牌，沒有開牌這個動作');
  });

  test('位置越後面開得越寬', () => {
    const order = ['utg', 'hj', 'co'];
    const pct = order.map(id => resolve(POSITIONS.find(p => p.id === id)!.rfi!).percent);
    for (let i = 1; i < pct.length; i++) {
      assert.ok(pct[i] > pct[i - 1],
        `${order[i]} (${pct[i].toFixed(1)}%) 應該比 ${order[i - 1]} (${pct[i - 1].toFixed(1)}%) 寬`);
    }
    // BTN 是最寬的位置
    const btn = resolve(POSITIONS.find(p => p.id === 'btn')!.rfi!).percent;
    assert.ok(btn > pct[pct.length - 1], 'BTN 應該是最寬的');
    // SB 比 BTN 窄（翻牌後位置最差），但比 CO 寬（只剩一個人要過）
    const sb = resolve(POSITIONS.find(p => p.id === 'sb')!.rfi!).percent;
    assert.ok(sb < btn && sb > pct[2], `SB ${sb.toFixed(1)}% 應介於 CO 與 BTN 之間`);
  });

  test('範圍寬度落在合理區間', () => {
    for (const p of POSITIONS) {
      if (!p.rfi) continue;
      const { percent } = resolve(p.rfi);
      assert.ok(percent > 5 && percent < 60,
        `${p.label} 開牌 ${percent.toFixed(1)}%，超出合理範圍`);
    }
  });
});

describe('面對開牌的應對', () => {
  test('所有範圍都解析得出來', () => {
    for (const v of VS_OPEN) {
      for (const d of v.defenses) {
        assert.doesNotThrow(() => resolve(d.threeBet), `${v.vs}/${d.hero} 的 3-bet 解析失敗`);
        assert.doesNotThrow(() => resolve(d.call), `${v.vs}/${d.hero} 的跟注解析失敗`);
      }
    }
  });

  test('解析後 3-bet 與跟注一定互斥 —— 重疊的算 3-bet', () => {
    for (const v of VS_OPEN) {
      for (const d of v.defenses) {
        const r = resolveDefense(d);
        const both = [...r.threeBet.hands].filter(h => r.call.hands.has(h));
        assert.deepEqual(both, [], `${v.vs} vs ${d.hero} 仍有重疊：${both.join(', ')}`);
      }
    }
  });

  test('跟注範圍不會被 3-bet 吃光', () => {
    // 扣掉 3-bet 之後如果跟注空了，代表那組資料寫錯了（例如跟注範圍
    // 整個被 3-bet 涵蓋），畫出來會是一張只有 3-bet 的表。
    for (const v of VS_OPEN) {
      for (const d of v.defenses) {
        const r = resolveDefense(d);
        assert.ok(r.call.hands.size > 0,
          `${v.vs} vs ${d.hero}：跟注範圍扣掉 3-bet 之後空了`);
        assert.ok(r.call.percent > 1,
          `${v.vs} vs ${d.hero}：跟注只剩 ${r.call.percent.toFixed(2)}%，太少了`);
      }
    }
  });

  test('每個開牌位置都有對應的防守，且只列出真的能行動的位置', () => {
    const ids = VS_OPEN.map(v => v.vs);
    assert.deepEqual(ids, ['utg', 'hj', 'co', 'btn', 'sb'],
      '開牌者必須涵蓋 BB 以外的五個位置');

    for (const v of VS_OPEN) {
      const spots = v.defenses.map(d => d.hero);
      assert.ok(spots.includes('bb'), `${v.vs}：BB 一定有機會行動`);
      // BTN 與 SB 開牌時，前面的位置已經蓋牌了，沒有 ip 這一組
      if (v.vs === 'btn' || v.vs === 'sb') {
        assert.ok(!spots.includes('ip'), `${v.vs} 開牌時不該有「有位置」那一組`);
        assert.deepEqual(v.ipPositions, []);
      } else {
        assert.ok(spots.includes('ip'), `${v.vs}：後面還有位置可以有位置地應對`);
        assert.ok(v.ipPositions.length > 0);
      }
      // SB 開牌時只剩 BB
      if (v.vs === 'sb') assert.deepEqual(spots, ['bb']);
    }
  });

  test('大盲的防守一定比小盲寬 —— 底池賠率好而且行動到他就結束', () => {
    for (const v of VS_OPEN) {
      const sb = v.defenses.find(d => d.hero === 'sb');
      const bb = v.defenses.find(d => d.hero === 'bb');
      if (!sb || !bb) continue;
      const total = (d: typeof sb) => resolveDefense(d).defendPercent;
      assert.ok(total(bb) > total(sb),
        `面對 ${v.vs}：BB 防守 ${total(bb).toFixed(1)}% 應該比 SB ${total(sb).toFixed(1)}% 寬`);
    }
  });

  test('開牌者位置越後面，防守範圍越寬', () => {
    const bbWidth = (vs: string) => {
      const d = VS_OPEN.find(v => v.vs === vs)!.defenses.find(x => x.hero === 'bb')!;
      return resolveDefense(d).defendPercent;
    };
    const seq = ['utg', 'hj', 'co', 'btn'];
    for (let i = 1; i < seq.length; i++) {
      assert.ok(bbWidth(seq[i]) > bbWidth(seq[i - 1]),
        `BB 面對 ${seq[i]}（${bbWidth(seq[i]).toFixed(1)}%）應比面對 `
        + `${seq[i - 1]}（${bbWidth(seq[i - 1]).toFixed(1)}%）防守得寬`);
    }
  });

  test('防守總和不會超過 100%，BB 面對偷雞時要防守得夠寬', () => {
    for (const v of VS_OPEN) {
      for (const d of v.defenses) {
        const total = resolveDefense(d).defendPercent;
        assert.ok(total <= 100, `${v.vs}/${d.hero} 防守 ${total.toFixed(1)}% 超過 100%`);
      }
    }
    const vsBtn = VS_OPEN.find(v => v.vs === 'btn')!.defenses.find(d => d.hero === 'bb')!;
    const w = resolveDefense(vsBtn).defendPercent;
    assert.ok(w > 40, `BB 面對 BTN 只防守 ${w.toFixed(1)}%，太容易被偷`);
  });
});
