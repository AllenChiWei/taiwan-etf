/* 新聞的時間格式與篩選。時間相關的測試一律傳固定的 now/today 進去，
   不然每次跑的結果會不一樣 —— 這種測試比沒有測試更糟。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import {
  relativeTime, timeOfDay, dayKey, dayLabel, groupByDay,
  filterNews, filterFilings, sourcesOf,
  type NewsItem, type Filing, type NewsData,
} from '../src/lib/news.ts';

const NOW = Date.parse('2026-09-18T10:00:00+08:00');

function news(over: Partial<NewsItem> = {}): NewsItem {
  return {
    t: '台積電法說會', u: 'https://example.com/1', s: '鉅亨網',
    at: '2026-09-18T09:30:00+08:00', codes: ['2330'], all: ['2330'], cat: '台股',
    ...over,
  };
}

function filing(over: Partial<Filing> = {}): Filing {
  return {
    code: '2308', name: '台達電', subject: '公告取得機器設備',
    at: '2026-09-18T08:15:00+08:00', market: '上市', clause: '第20款',
    u: 'https://example.com/f', known: true,
    ...over,
  };
}

test('relativeTime', async (t) => {
  await t.test('一小時內給分鐘', () => {
    assert.equal(relativeTime('2026-09-18T09:30:00+08:00', NOW), '30 分鐘前');
  });

  await t.test('一分鐘內是「剛剛」', () => {
    assert.equal(relativeTime('2026-09-18T09:59:30+08:00', NOW), '剛剛');
  });

  await t.test('一天內給小時', () => {
    assert.equal(relativeTime('2026-09-18T02:00:00+08:00', NOW), '8 小時前');
  });

  await t.test('超過一天改給時刻 —— 「48 小時前」要自己換算，沒有幫助', () => {
    assert.equal(relativeTime('2026-09-16T13:45:00+08:00', NOW), '13:45');
  });

  await t.test('來源時鐘走快時不要出現負數', () => {
    assert.equal(relativeTime('2026-09-18T10:05:00+08:00', NOW), '剛剛');
  });

  await t.test('沒有時間或壞字串都回破折號', () => {
    assert.equal(relativeTime(null, NOW), '—');
    assert.equal(relativeTime('不是時間', NOW), '—');
  });
});

test('timeOfDay 取時分', () => {
  assert.equal(timeOfDay('2026-09-18T08:15:00+08:00'), '08:15');
  assert.equal(timeOfDay(null), '—');
});

test('日期標籤', async (t) => {
  const today = new Date('2026-09-18T10:00:00+08:00');

  await t.test('今天與昨天用字', () => {
    assert.equal(dayLabel('2026-09-18T01:00:00+08:00', today), '今天');
    assert.equal(dayLabel('2026-09-17T23:00:00+08:00', today), '昨天');
  });

  await t.test('更早的給月日與星期', () => {
    assert.equal(dayLabel('2026-09-16T10:00:00+08:00', today), '9/16（三）');
  });

  await t.test('台北凌晨時「今天」仍然是台北的今天，不是 UTC 的', () => {
    // 台北 2026-09-18 05:00 的時候，UTC 還是 09-17。用 UTC 判斷會讓今天的新聞
    // 被標上日期、昨天的反而變成「今天」。
    const dawn = new Date('2026-09-18T05:00:00+08:00');
    assert.equal(dayLabel('2026-09-18T04:00:00+08:00', dawn), '今天');
    assert.equal(dayLabel('2026-09-17T22:00:00+08:00', dawn), '昨天');
  });

  await t.test('沒有時間的說時間不明，不要假裝是今天', () => {
    assert.equal(dayLabel(null, today), '時間不明');
  });

  await t.test('日期直接取字串前綴，不經過 Date —— 否則人在美國看會差一天', () => {
    // 台北時間 00:30 的新聞，在 UTC-7 的瀏覽器上若經過 Date 會變成前一天
    assert.equal(dayKey('2026-09-18T00:30:00+08:00'), '2026-09-18');
  });
});

test('groupByDay', async (t) => {
  const today = new Date('2026-09-18T10:00:00+08:00');
  const rows = [
    news({ u: 'a', at: '2026-09-18T09:00:00+08:00' }),
    news({ u: 'b', at: '2026-09-17T18:00:00+08:00' }),
    news({ u: 'c', at: '2026-09-18T08:00:00+08:00' }),
    news({ u: 'd', at: null }),
  ];
  const groups = groupByDay(rows, today);

  await t.test('新的日期在前，沒有時間的排最後', () => {
    assert.deepEqual(groups.map(g => g.key),
      ['2026-09-18', '2026-09-17', '']);
  });

  await t.test('組內維持原順序', () => {
    assert.deepEqual(groups[0].rows.map(r => r.u), ['a', 'c']);
  });

  await t.test('標籤用的是那一組的日期', () => {
    assert.deepEqual(groups.map(g => g.label), ['今天', '昨天', '時間不明']);
  });
});

test('新聞篩選', async (t) => {
  const rows = [
    news({ u: 'a', t: '台積電法說會', s: '鉅亨網', codes: ['2330'], all: ['2330'] }),
    news({ u: 'b', t: '央行理監事會議', s: '中央社', codes: [], all: [] }),
    news({ u: 'c', t: '某未收錄個股大漲', s: '鉅亨網', codes: [], all: ['9999'] }),
  ];

  await t.test('來源', () => {
    assert.deepEqual(
      filterNews(rows, { source: '中央社', query: '', onlyTracked: false })
        .map(r => r.u), ['b']);
  });

  await t.test('只看清單標的 = 有掛到站上追蹤的代號', () => {
    assert.deepEqual(
      filterNews(rows, { source: '', query: '', onlyTracked: true })
        .map(r => r.u), ['a']);
  });

  await t.test('關鍵字比對標題，也比對來源掛的全部代號', () => {
    assert.deepEqual(
      filterNews(rows, { source: '', query: '央行', onlyTracked: false })
        .map(r => r.u), ['b']);
    assert.deepEqual(
      filterNews(rows, { source: '', query: '9999', onlyTracked: false })
        .map(r => r.u), ['c']);
  });

  await t.test('空條件不過濾任何東西', () => {
    assert.equal(
      filterNews(rows, { source: '', query: '   ', onlyTracked: false }).length, 3);
  });
});

test('重大訊息篩選', async (t) => {
  const rows = [
    filing({ code: '2308', market: '上市', known: true }),
    filing({ code: '6488', name: '環球晶', market: '上櫃', known: false,
             subject: '公告董事會決議' }),
  ];

  await t.test('市場', () => {
    assert.deepEqual(
      filterFilings(rows, { market: '上櫃', query: '', onlyKnown: false })
        .map(r => r.code), ['6488']);
  });

  await t.test('只看清單標的', () => {
    assert.deepEqual(
      filterFilings(rows, { market: '', query: '', onlyKnown: true })
        .map(r => r.code), ['2308']);
  });

  await t.test('關鍵字比對主旨、公司名與代號', () => {
    assert.equal(
      filterFilings(rows, { market: '', query: '環球', onlyKnown: false }).length, 1);
    assert.equal(
      filterFilings(rows, { market: '', query: '2308', onlyKnown: false }).length, 1);
    assert.equal(
      filterFilings(rows, { market: '', query: '機器設備', onlyKnown: false }).length, 1);
  });
});

test('sourcesOf 依出現順序去重', () => {
  assert.deepEqual(sourcesOf([
    news({ s: '鉅亨網' }), news({ s: '中央社' }), news({ s: '鉅亨網' }),
  ]), ['鉅亨網', '中央社']);
});

/* ── 對真實資料的檢查 ───────────────────────────────────── */

const PATH = new URL('../public/data/news.json', import.meta.url);

test('真實 news.json', { skip: !existsSync(PATH) && '沒有 news.json（部署時才產生）' },
  async (t) => {
    const data = JSON.parse(readFileSync(PATH, 'utf8')) as NewsData;

    await t.test('每則都有標題與可連出去的網址', () => {
      for (const r of data.news) {
        assert.ok(r.t.trim().length > 0, '出現沒有標題的新聞');
        assert.match(r.u, /^https:\/\//, `連結不是 https：${r.u}`);
      }
    });

    await t.test('沒有把內文存進來 —— 這一頁只做索引', () => {
      for (const r of data.news as Array<NewsItem & Record<string, unknown>>) {
        assert.equal(r.content, undefined);
        assert.equal(r.summary, undefined);
        // 標題不該長到像一段內文
        assert.ok(r.t.length < 200, `標題異常長，可能混進了內文：${r.t.slice(0, 40)}…`);
      }
    });

    await t.test('時間是 ISO 而且已排序（新到舊）', () => {
      const times = data.news.map(r => r.at).filter((v): v is string => Boolean(v));
      for (const at of times) assert.match(at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
      assert.deepEqual(times, [...times].sort().reverse());
    });

    await t.test('連結不重複', () => {
      const urls = data.news.map(r => r.u);
      assert.equal(new Set(urls).size, urls.length);
    });

    await t.test('重大訊息的代號都是可信的格式，市場只有上市與上櫃', () => {
      for (const r of data.filings) {
        assert.match(r.code, /^[0-9]{4,6}[A-Z]?$/, `奇怪的代號：${r.code}`);
        assert.ok(['上市', '上櫃'].includes(r.market), `奇怪的市場：${r.market}`);
        assert.match(r.u, /^https:\/\/mopsov\.twse\.com\.tw\//);
      }
    });

    await t.test('主旨已經壓成一行，前端不必處理換行', () => {
      for (const r of data.filings) {
        assert.ok(!/[\r\n]/.test(r.subject), `主旨仍有換行：${r.code}`);
      }
    });

    await t.test('meta 的計數與實際筆數相符', () => {
      assert.equal(data.meta.news, data.news.length);
      assert.equal(data.meta.filings, data.filings.length);
    });
  });
