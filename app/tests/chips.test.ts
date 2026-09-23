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
  contractAmount, joinDca, retailLatest, retailRatioSeries,
  type ChipsData, type DcaRow,
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

test('散戶未平倉推算', async (t) => {
  // 2026-09-22 小型臺指期貨的真實數字：三大法人列取自 futContractsDateDown，
  // 全市場 32,581 口是 futDataDown 一般時段各月份（含週契約、不含價差）的合計
  const row = (w: string, bn: number, sn: number) =>
    ({ c: '小型臺指期貨', w, n: bn - sn, a: 0, tn: 0, ta: 0, bn, sn });
  const rows = [row('自營商', 1304, 7356), row('投信', 88, 104), row('外資', 4162, 1006)];

  await t.test('多單、空單、淨額與多空比', () => {
    const r = retailLatest(rows, 32581)!;
    assert.equal(r.long, 32581 - 5554);
    assert.equal(r.short, 32581 - 8466);
    assert.equal(r.net, 2912);                    // = −(−6052 − 16 + 3156)
    assert.equal(r.ratio.toFixed(2), '8.94');
  });

  await t.test('少一家法人或沒有全市場量就不算', () => {
    assert.equal(retailLatest(rows.slice(1), 32581), null);
    assert.equal(retailLatest(rows, null), null);
  });

  await t.test('歷史多空比：缺任何一家的那天是 null', () => {
    const hist = {
      dates: ['a', 'b'],
      contracts: { 小型臺指期貨: { 外資: [3156, 100], 投信: [-16, null], 自營商: [-6052, 0] } },
      oi: { 小型臺指期貨: [32581, 30000] },
    };
    const s = retailRatioSeries(hist, '小型臺指期貨');
    assert.equal(s[0]!.toFixed(2), '8.94');
    assert.equal(s[1], null);
    assert.deepEqual(retailRatioSeries(hist, '臺股期貨'), []);
  });
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

    await t.test('至少有一段當日籌碼', () => {
      // fetch_chips.py 在每一段都失敗時不會寫檔，所以檔案存在就該有東西。
      const any = data.futures.length > 0 || data.options.length > 0
        || data.pc.dates.length > 0 || (data.sectors?.length ?? 0) > 0
        || data.top.twse !== null || data.top.tpex !== null;
      assert.ok(any, 'chips.json 存在卻沒有任何當日籌碼');
    });

    await t.test('三大法人期貨每個契約都齊三家', () => {
      // 期交所偶爾整段回 403（CI 的 IP 被擋過）。那天這一段會是空的，
      // 而這不該讓部署失敗 —— 頁面本來就是缺哪段就不顯示哪段。
      // 但只要有資料，形狀就必須是對的：那才是這個檢查要抓的東西。
      const byContract = new Map<string, Set<string>>();
      for (const r of data.futures) {
        if (!byContract.has(r.c)) byContract.set(r.c, new Set());
        byContract.get(r.c)!.add(r.w);
      }
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
      // 空的代表期交所那段沒拿到（403 過），不是資料壞掉 —— 見上面的說明
      const n = data.futHistory.dates.length;
      for (const [c, whos] of Object.entries(data.futHistory.contracts)) {
        for (const [who, values] of Object.entries(whos)) {
          assert.equal(values.length, n, `${c} ${who} 的長度不是 ${n}`);
        }
      }
      for (const [c, values] of Object.entries(data.futHistory.oi ?? {})) {
        assert.equal(values.length, n, `${c} 全市場未沖銷的長度不是 ${n}`);
      }
    });

    await t.test('全市場未沖銷不小於三大法人任一邊的合計', () => {
      // 小於的話是全市場量抓錯（例如漏了週契約），推算出的散戶會變成負的部位
      const oi = data.futHistory.oi ?? {};
      for (const [c, values] of Object.entries(oi)) {
        const total = values[values.length - 1];
        const rows = data.futures.filter(r => r.c === c);
        if (!total || rows.length === 0) continue;
        const bn = rows.reduce((a, r) => a + r.bn, 0);
        const sn = rows.reduce((a, r) => a + r.sn, 0);
        assert.ok(total >= bn && total >= sn, `${c}：全市場 ${total} 小於法人 ${bn}/${sn}`);
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

test('真實 chips.json 的選擇權明細',
  { skip: !existsSync(PATH) && '沒有 chips.json（部署時才產生）' }, async (t) => {
    const data = JSON.parse(readFileSync(PATH, 'utf8')) as ChipsData;

    await t.test('買權與賣權、三個身份別都齊', () => {
      if (data.options.length === 0) return;      // 期交所那段沒拿到
      for (const cp of ['CALL', 'PUT']) {
        for (const who of WHO_ORDER) {
          assert.ok(data.options.some(o => o.cp === cp && o.w === who),
            `缺少 ${cp} ${who}`);
        }
      }
    });

    // 契約金額允許 1 千元的誤差：期交所把買方、賣方、淨額三欄各自四捨五入到
    // 千元，所以「買 − 賣」與它公佈的淨額可以差 1（今天六列裡有兩列就差 1）。
    // 口數沒有這個問題，要精準相等。
    const AMOUNT_TOLERANCE = 1;

    await t.test('未平倉：買方 − 賣方 = 淨額', () => {
      for (const o of data.options) {
        assert.equal(o.bn - o.sn, o.n, `${o.cp} ${o.w} 的未平倉口數淨額對不上`);
        assert.ok(Math.abs((o.ba - o.sa) - o.a) <= AMOUNT_TOLERANCE,
          `${o.cp} ${o.w} 的未平倉金額淨額差太多：${o.ba - o.sa} vs ${o.a}`);
      }
    });

    await t.test('當日交易那一側同樣成立（舊格式沒有這幾欄就跳過）', () => {
      for (const o of data.options) {
        if (o.vn === undefined) continue;
        assert.equal((o.vbn ?? 0) - (o.vsn ?? 0), o.vn, `${o.cp} ${o.w} 交易口數對不上`);
        assert.ok(Math.abs(((o.vba ?? 0) - (o.vsa ?? 0)) - (o.va ?? 0)) <= AMOUNT_TOLERANCE,
          `${o.cp} ${o.w} 交易金額差太多`);
      }
    });

    await t.test('口數不會是負的 —— 買方與賣方各自都是部位，不是淨額', () => {
      for (const o of data.options) {
        assert.ok(o.bn >= 0 && o.sn >= 0, `${o.cp} ${o.w} 出現負的買賣方口數`);
      }
    });
  });

test('契約金額的顯示', async (t) => {
  await t.test('億為主', () => {
    assert.equal(contractAmount(877431), '8.77 億');
    assert.equal(contractAmount(-423449), '-4.23 億');
  });

  await t.test('不足 0.01 億改用萬元 —— 投信的部位常常只有幾十萬', () => {
    assert.equal(contractAmount(385), '38.5 萬');
    assert.equal(contractAmount(183), '18.3 萬');
  });

  await t.test('0 就是 0，不要寫成 0.0 萬', () => {
    assert.equal(contractAmount(0), '0 億');
  });

  await t.test('只有要求時才加正號', () => {
    assert.equal(contractAmount(877431, true), '+8.77 億');
    assert.equal(contractAmount(385, true), '+38.5 萬');
    assert.equal(contractAmount(-423449, true), '-4.23 億');
  });

  await t.test('缺值回破折號', () => {
    assert.equal(contractAmount(null), '—');
    assert.equal(contractAmount(undefined), '—');
  });
});

test('定期定額人氣榜', async (t) => {
  const rows: DcaRow[] = [
    { code: '0050', name: '元大台灣50', n: 1_280_028 },
    { code: '0056', name: '元大高股息', n: 338_456 },
    { code: '9999', name: '不在清單裡', n: 100_000 },
  ];
  const lookup = new Map([
    ['0050', { r12: '98.17', yield: '1.48' }],
    ['0056', { r12: 'N/A', yield: '7.25' }],
  ]);

  await t.test('比重加起來是 100%', () => {
    const out = joinDca(rows, lookup);
    const total = out.reduce((a, r) => a + r.share, 0);
    assert.ok(Math.abs(total - 100) < 1e-9);
    assert.ok(Math.abs(out[0].share - (1_280_028 / 1_718_484) * 100) < 1e-9);
  });

  await t.test('接得到的帶上報酬率與殖利率', () => {
    const out = joinDca(rows, lookup);
    assert.equal(out[0].r12, 98.17);
    assert.equal(out[0].yield, 1.48);
  });

  await t.test('N/A 與查不到都是 null，不要變成 0', () => {
    const out = joinDca(rows, lookup);
    assert.equal(out[1].r12, null);        // 'N/A'
    assert.equal(out[1].yield, 7.25);
    assert.equal(out[2].r12, null);        // 清單裡沒這一檔
    assert.equal(out[2].yield, null);
  });

  await t.test('空清單不會除以零', () => {
    assert.deepEqual(joinDca([], lookup), []);
  });
});
