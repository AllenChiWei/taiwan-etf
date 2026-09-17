/* 籌碼面純函式的測試，外加一份對真實 chips.json 的檢查。
 *
 * 單位換算是這一頁最容易出錯的地方（千元、元、股、口四種混在一起），
 * 所以每一個換算都用手算得出來的數字釘住。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import {
  toYi, yuanToYi, sharesToLots, netTone, sharePct,
  contractSeries, linePoints, linePath, zeroY, lastValue, WHO_ORDER, prepareLarge, bars,
  type ChipsData,
} from '../src/lib/chips.ts';

test('單位換算', async (t) => {
  await t.test('契約金額是千元 -> 億元', () => {
    assert.equal(toYi(100_000), 1);               // 10 萬千元 = 1 億元
    assert.equal(toYi(-703_395_432), -7033.95432);
  });

  await t.test('買賣超金額是元 -> 億元', () => {
    assert.equal(yuanToYi(100_000_000), 1);
    assert.equal(yuanToYi(1_605_579_327), 16.05579327);
  });

  await t.test('股數 -> 張數', () => {
    assert.equal(sharesToLots(53_222_717), 53222.717);
    assert.equal(sharesToLots(1000), 1);
  });
});

test('紅漲綠跌：買超與淨多單是 up', () => {
  assert.equal(netTone(2598), 'up');
  assert.equal(netTone(-76351), 'down');
  assert.equal(netTone(0), 'flat');
  assert.equal(netTone(Number.NaN), 'na');
});

test('大額交易人佔比', async (t) => {
  await t.test('佔全市場未沖銷部位的百分比', () => {
    assert.equal(sharePct(71502, 102997)?.toFixed(2), '69.42');
  });

  await t.test('全市場是 0 時回 null，不是 0 —— 沒部位跟集中度 0 是兩回事', () => {
    assert.equal(sharePct(0, 0), null);
  });
});

test('走勢線', async (t) => {
  const height = 50;

  await t.test('null 被跳過而不是當成 0', () => {
    const pts = linePoints([10, null, 20], 100, height);
    assert.equal(pts.length, 2);
    // 跳過的那天不佔位置：第二個點仍然畫在最右邊
    assert.equal(pts[1].x.toFixed(1), '98.0');
  });

  await t.test('值域固定含 0，翻空才看得出來', () => {
    // 全部是正數時，0 應該落在圖的底部
    const z = zeroY([10, 20, 30], height);
    assert.equal(z, height - 2);
  });

  await t.test('零軸在正負之間', () => {
    const z = zeroY([-10, 10], height)!;
    assert.ok(z > 2 && z < height - 2);
  });

  await t.test('沒有任何有效值時不畫線', () => {
    assert.deepEqual(linePoints([null, null], 100, height), []);
    assert.equal(linePath([]), '');
    assert.equal(zeroY([null], height), null);
  });

  await t.test('path 從 M 開始、其餘是 L', () => {
    const d = linePath(linePoints([1, 2, 3], 100, height));
    assert.ok(d.startsWith('M'));
    assert.equal(d.split('L').length, 3);
  });
});

test('lastValue 取最後一個有值的元素', () => {
  assert.equal(lastValue([1, 2, null]), 2);
  assert.equal(lastValue([null, null]), null);
});

test('contractSeries 找不到契約時回空物件', () => {
  const hist = { dates: ['2026-09-16'], contracts: { 臺股期貨: { 外資: [1] } } };
  assert.deepEqual(contractSeries(hist, '不存在'), {});
  assert.deepEqual(contractSeries(hist, '臺股期貨'), { 外資: [1] });
});

/* ── 對真實資料的檢查 ───────────────────────────────────── */

const PATH = new URL('../public/data/chips.json', import.meta.url);

test('真實 chips.json', { skip: !existsSync(PATH) && '沒有 chips.json（部署時才產生）' },
  async (t) => {
    const data = JSON.parse(readFileSync(PATH, 'utf8')) as ChipsData;

    await t.test('meta 有日期與來源', () => {
      assert.match(data.meta.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(data.meta.source.length > 0);
    });

    await t.test('三大法人期貨每個契約都齊三家', () => {
      const byContract = new Map<string, Set<string>>();
      for (const r of data.futures) {
        if (!byContract.has(r.c)) byContract.set(r.c, new Set());
        byContract.get(r.c)!.add(r.w);
      }
      assert.ok(byContract.size > 0, '沒有任何期貨契約');
      for (const [c, whos] of byContract) {
        for (const who of WHO_ORDER) {
          assert.ok(whos.has(who), `${c} 缺少 ${who}`);
        }
      }
    });

    await t.test('未平倉淨額 = 多方 − 空方', () => {
      for (const r of data.futures) {
        assert.equal(r.n, r.bn - r.sn, `${r.c} ${r.w} 的淨額對不上多空`);
      }
    });

    await t.test('歷史數列長度與日期一致', () => {
      const n = data.futHistory.dates.length;
      assert.ok(n > 0);
      for (const [c, whos] of Object.entries(data.futHistory.contracts)) {
        for (const [who, values] of Object.entries(whos)) {
          assert.equal(values.length, n, `${c} ${who} 的長度不是 ${n}`);
        }
      }
    });

    await t.test('Put/Call Ratio 三個數列等長且是正的百分比', () => {
      const { dates, vol, oi } = data.pc;
      assert.equal(vol.length, dates.length);
      assert.equal(oi.length, dates.length);
      for (const v of vol.concat(oi)) assert.ok(v > 0 && v < 1000, `比率超出範圍：${v}`);
    });

    await t.test('大額交易人的前十大不小於前五大', () => {
      for (const r of data.large.fut.concat(data.large.opt)) {
        assert.ok(r.b10 >= r.b5, `${r.name} 的前十大買方比前五大小`);
        assert.ok(r.s10 >= r.s5, `${r.name} 的前十大賣方比前五大小`);
        assert.ok(r.oi >= r.b10, `${r.name} 的全市場部位小於前十大買方`);
      }
    });

    await t.test('買賣超前十大：買超為正、賣超為負，且已排序', () => {
      for (const market of [data.top.twse, data.top.tpex]) {
        if (!market) continue;
        for (const who of WHO_ORDER) {
          const side = market[who];
          assert.ok(side, `缺少 ${who}`);
          for (const r of side.buy) assert.ok(r.shares > 0, `${who} 買超出現非正數`);
          for (const r of side.sell) assert.ok(r.shares < 0, `${who} 賣超出現非負數`);
          const buys = side.buy.map(r => r.shares);
          assert.deepEqual(buys, [...buys].sort((a, b) => b - a), `${who} 買超沒排序`);
          const sells = side.sell.map(r => r.shares);
          assert.deepEqual(sells, [...sells].sort((a, b) => a - b), `${who} 賣超沒排序`);
        }
      }
    });
  });

test('prepareLarge', async (t) => {
  const base = {
    id: 'TX', name: '臺股期貨', cp: null, who: '全部交易人',
    b5: 10, s5: 20, b10: 30, s10: 40, oi: 100,
  };

  await t.test('數字與「所有契約」相同的月份列被併掉', () => {
    const rows = prepareLarge([
      { ...base, term: '202610' },
      { ...base, term: '所有契約', oi: 101 },
    ]);
    assert.deepEqual(rows.map(r => r.term), ['所有契約']);
  });

  await t.test('數字不同的月份列要留著', () => {
    const rows = prepareLarge([
      { ...base, term: '202610', b5: 9 },
      { ...base, term: '所有契約' },
    ]);
    assert.deepEqual(rows.map(r => r.term), ['所有契約', '202610']);
  });

  await t.test('台指排在電子、金融前面', () => {
    const rows = prepareLarge([
      { ...base, id: 'TF', name: '金融期貨', term: '所有契約' },
      { ...base, term: '所有契約' },
      { ...base, id: 'TE', name: '電子期貨', term: '所有契約' },
    ]);
    assert.deepEqual(rows.map(r => r.name), ['臺股期貨', '電子期貨', '金融期貨']);
  });

  await t.test('同一契約的兩種交易人類別不會互相併掉', () => {
    const rows = prepareLarge([
      { ...base, term: '所有契約' },
      { ...base, term: '202610', who: '特定法人', b5: 1, s5: 2, b10: 3, s10: 4 },
      { ...base, term: '所有契約', who: '特定法人', b5: 1, s5: 2, b10: 3, s10: 4 },
    ]);
    assert.equal(rows.length, 2);
  });
});

test('柱狀圖', async (t) => {
  const H = 50;

  await t.test('正負分邊，零軸在中間', () => {
    const b = bars([10, -10], 100, H);
    assert.equal(b.length, 2);
    assert.equal(b[0].up, true);
    assert.equal(b[1].up, false);
    // 兩根等長、分別在零軸上下
    assert.ok(Math.abs(b[0].h - b[1].h) < 0.01);
    assert.ok(b[0].y < b[1].y, '正值的柱子要在上面');
  });

  await t.test('全部是負數時零軸在頂端，柱子往下長', () => {
    const b = bars([-5, -10], 100, H);
    assert.ok(b.every(x => x.up === false));
    assert.ok(b[1].h > b[0].h, '越負的柱子越長');
  });

  await t.test('null 不畫柱子，也不佔掉別人的位置', () => {
    const b = bars([10, null, 20], 120, H);
    assert.equal(b.length, 2);
    assert.ok(b[1].x > b[0].x + b[0].w, '第三天的柱子要在第一天右邊、隔一個空位');
  });

  await t.test('接近零的值仍然畫得出來（至少 0.8px）', () => {
    const b = bars([1000, 1], 100, H);
    assert.ok(b[1].h >= 0.8);
  });

  await t.test('沒有有效值就不畫', () => {
    assert.deepEqual(bars([null, null], 100, H), []);
  });
});
