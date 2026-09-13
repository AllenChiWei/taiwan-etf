# -*- coding: utf-8 -*-
u"""Print the ETFs that appear in the new dataset but not the old one.

    python scripts/diff_listings.py previous.json app/public/data/etfs.json

Used by the daily workflow to name newly listed ETFs in the commit message, so
`git log` answers "when did 00XXX show up?" without diffing a 65 KB JSON blob.

Prints one line like `00982A 主動群益台灣強棒, 00983A 主動野村臺灣優選` or nothing
at all. Delistings are deliberately not reported here — verify_data.py already
*fails* on a row that vanished, because that is almost always a broken scrape
rather than a real delisting.
"""
import io
import json
import sys

OLD = sys.argv[1] if len(sys.argv) > 1 else None
NEW = sys.argv[2] if len(sys.argv) > 2 else 'app/public/data/etfs.json'
LIMIT = 12                      # 一次上市十幾檔的情況不存在，但別讓訊息無限長


def codes(path):
    try:
        doc = json.load(io.open(path, encoding='utf-8'))
    except Exception:
        return {}
    return dict((e['code'], e.get('name', '')) for e in doc.get('etfs', []))


def main():
    if not OLD:
        return                  # 沒有前一版可比，安靜結束（第一次建置）

    old = codes(OLD)
    new = codes(NEW)
    if not old or not new:
        return

    added = sorted(set(new) - set(old))
    if not added:
        return

    shown = ', '.join('%s %s' % (c, new[c]) for c in added[:LIMIT])
    if len(added) > LIMIT:
        shown += u'… 共 %d 檔' % len(added)
    print(shown)


main()
