# -*- coding: utf-8 -*-
u"""從已上線的網站取回試算資料，當成 FinLab 失敗時的備援。

    python scripts/reuse_calc.py [base-url]

預設從 https://allenchiwei.github.io/taiwan-etf/ 抓，寫進 app/public/data/calc/。

## 為什麼需要這支

試算資料（月頻收盤價與配息）是部署時用 FinLab 產生的，而 FinLab 的每日流量
是按下載量計費的。額度用完、服務中斷、或套件改版時，整個部署會卡在那一步，
連完全不相關的新功能都上不去 —— 實際發生過。

備援有兩層：

1. GitHub Actions 的快取（deploy.yml 裡的 finlab-data-*）。快的那層。
2. 這一支：直接抓線上那份。快取被淘汰、或這個機制剛啟用還沒有快取時用。

兩層都是「拿昨天的資料」，不是重新計算 —— 資料舊一天遠好過整站不能部署。

## 為什麼只做試算資料

試算頁沒有資料就直接壞掉，而整份只有 0.5 MB／360 多個小檔，抓回來很便宜。

績效曲線（series/）是另一回事：那是付費資料集，上線的是加密檔，共 1000 多個
檔案、11 MB。它由密碼保護、不是每個訪客都看得到，缺了也只是圖表消失，所以
交給 Actions 快取那一層就好，不值得為它打一千次請求。
"""
import io
import json
import os
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = (sys.argv[1] if len(sys.argv) > 1
        else 'https://allenchiwei.github.io/taiwan-etf/').rstrip('/') + '/'
OUT = os.path.join(ROOT, 'app', 'public', 'data', 'calc')

UA = ('Mozilla/5.0 (compatible; TaiwanETF/1.0; '
      '+https://allenchiwei.github.io/taiwan-etf/) reusing our own published data')
TIMEOUT = 30
WORKERS = 12


def log(m):
    print(m, flush=True)


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    return urllib.request.urlopen(req, timeout=TIMEOUT).read()


def save(path, raw):
    d = os.path.dirname(path)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(path, 'wb') as fh:
        fh.write(raw)


def main():
    log(u'從 %s 取回試算資料' % BASE)

    try:
        index_raw = get(BASE + 'data/calc/index.json')
        index = json.loads(index_raw.decode('utf-8'))
    except Exception as e:                                    # noqa: BLE001
        log(u'線上也沒有試算資料（%s）' % str(e)[:80])
        return 1

    codes = sorted(index.get('codes') or {})
    if not codes:
        log(u'線上的 index.json 沒有任何標的，不用它')
        return 1
    log(u'  index.json 有 %d 個標的、%d 個月'
        % (len(codes), len(index.get('months') or [])))

    save(os.path.join(OUT, 'index.json'), index_raw)

    def fetch_one(code):
        # 代號來自我們自己產生的 index.json，但它會被接進網址與檔名，
        # 所以照樣擋一下奇怪的字元 —— 不能因為「來源是自己」就不檢查。
        if not code.replace('_', '').isalnum():
            return code, False
        try:
            raw = get('%sdata/calc/tw/%s.json' % (BASE, code))
        except urllib.error.HTTPError:
            return code, False
        except Exception:                                     # noqa: BLE001
            return code, False
        save(os.path.join(OUT, 'tw', code + '.json'), raw)
        return code, True

    ok = 0
    missing = []
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for code, done in pool.map(fetch_one, codes):
            if done:
                ok += 1
            else:
                missing.append(code)

    log(u'  取回 %d／%d 檔' % (ok, len(codes)))
    if missing:
        log(u'  抓不到 %d 檔：%s' % (len(missing), u'、'.join(missing[:8])))

    # 少數幾檔抓不到還能用（前端對缺檔是容錯的），但少一大半就不是備援而是壞資料
    if ok < len(codes) * 0.9:
        log(u'取回的比例太低，不當成可用的備援')
        return 1

    size = sum(os.path.getsize(os.path.join(dp, f))
               for dp, _, fs in os.walk(OUT) for f in fs) / 1024.0
    log(u'完成：%s（%.0f KB）。這是線上那份，日期可能比今天舊。' % (OUT, size))
    return 0


if __name__ == '__main__':
    sys.exit(main())
