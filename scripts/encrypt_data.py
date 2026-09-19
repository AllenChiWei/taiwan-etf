# -*- coding: utf-8 -*-
u"""Encrypt the FinLab-derived data so a public URL alone is not enough to read it.

    python scripts/encrypt_data.py

Encrypts, in place next to the originals:

    app/public/data/series/**/*.json  -> *.enc

and writes the public manifest `app/public/data/secure.json` that the browser needs
(salt + a check blob). Plaintext copies are deleted afterwards.

Why this rather than a login form: on a static host a password checked in JavaScript
protects nothing — the script is readable and `data/us_etfs.json` is fetchable by URL
without ever running it. Encrypting the payload is the part that actually works; without
the password the files are noise.

What is locked and what is not:

    locked    series/**          the actual price history — 1,052 tickers x ~1,900 days.
                                 This is the paid dataset itself.
    public    us_etfs.json       ticker/name/exchange come from Nasdaq Trader's public
                                 file; the five return figures and the dollar volume are
                                 statistics we computed. A derived aggregate, not the set.
    public    etfs.json          Taiwan, from public TWSE/TPEx/MoneyDJ pages.

What this is and is not: it stops someone who merely has the URL. It does not stop someone
who has the password from keeping a copy — nothing can.

Salt handling: the salt lives in the committed manifest and is reused as long as the
password still verifies against the stored check, so a routine rebuild does not log
everyone out. Change SITE_PASSWORD and the salt is regenerated, which invalidates every
existing session — that is the intended behaviour when you rotate the password.
"""
import base64
import gzip
import io
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from finlab_client import _read_dotenv           # 同一支 .env 解析，不重複造輪子

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'app', 'public', 'data')
MANIFEST = os.path.join(DATA, 'secure.json')

ENV_VAR = 'SITE_PASSWORD'
# PBKDF2 的次數。OWASP 目前對 PBKDF2-HMAC-SHA256 的建議是 60 萬次；
# 60 萬在手機上約三秒，而使用者只在輸入密碼時付一次這個成本（之後存的是
# 導出的金鑰，不是密碼）。
#
# 改這個數字會讓既有的解鎖工作階段失效一次：存下來的金鑰是用舊次數導出的，
# 解不開新的密文，使用者要再輸入一次密碼。manifest 會帶新的次數，所以
# 前端不需要改。
ITERATIONS = 600_000
# 工作階段效期。過期就要重新輸入密碼。
TTL_HOURS = 12
CHECK_PLAINTEXT = b'twetf-ok'


def b64(raw):
    return base64.b64encode(raw).decode('ascii')


def unb64(s):
    return base64.b64decode(s.encode('ascii'))


def load_password():
    pw = os.environ.get(ENV_VAR, '').strip()
    if not pw:
        pw = _read_dotenv(os.path.join(ROOT, '.env')).get(ENV_VAR, '').strip()
    if not pw:
        sys.exit(
            u'找不到 %s。\n'
            u'  本機：在 .env 加一行 %s=<你想設的密碼>\n'
            u'  CI  ：Settings → Secrets and variables → Actions 建立同名 secret\n'
            u'  這組密碼是訪客要看美股資料與績效圖時輸入的。' % (ENV_VAR, ENV_VAR))
    if len(pw) < 6:
        sys.exit('%s 太短（%d 字元），至少 6 個字元' % (ENV_VAR, len(pw)))
    return pw


def derive(password, salt):
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32,
                     salt=salt, iterations=ITERATIONS)
    return kdf.derive(password.encode('utf-8'))


def encrypt(key, plaintext):
    iv = os.urandom(12)
    return iv + AESGCM(key).encrypt(iv, plaintext, None)


def compress(raw):
    u"""密文是亂數，HTTP 的 gzip 壓不動它，所以得在加密前先壓。

    曲線檔是數字陣列，壓縮率很高（約 3 倍）。瀏覽器端用 DecompressionStream
    解回來。"""
    return gzip.compress(raw, 9)


def configured_salt():
    u"""SITE_SALT 環境變數（base64 的 16 bytes）。

    salt 本來就會隨 manifest 公開給瀏覽器，不是機密；把它固定下來的理由是
    每次部署都換 salt 會讓所有人的工作階段失效，等於每天都要重新輸入密碼。
    """
    raw = os.environ.get('SITE_SALT', '').strip()
    if not raw:
        raw = _read_dotenv(os.path.join(ROOT, '.env')).get('SITE_SALT', '').strip()
    if not raw:
        return None
    try:
        salt = unb64(raw)
    except Exception:
        sys.exit('SITE_SALT 不是合法的 base64')
    if len(salt) != 16:
        sys.exit('SITE_SALT 解出來是 %d bytes，應該是 16' % len(salt))
    return salt


def try_existing_salt(password):
    u"""沿用舊 salt（維持既有工作階段），前提是密碼沒變。"""
    if not os.path.exists(MANIFEST):
        return None
    try:
        m = json.load(io.open(MANIFEST, encoding='utf-8'))
        salt = unb64(m['salt'])
        key = derive(password, salt)
        blob = unb64(m['check'])
        AESGCM(key).decrypt(blob[:12], blob[12:], None)
        return salt
    except Exception:
        return None                               # 密碼換了或檔案壞了 -> 重新產生


# **目前這支腳本沒有東西可以加密，這是刻意的。**
#
# 兩個市場的曲線都改用 FinMind 產生了（fetch_series_tw.py / fetch_series_us.py），
# 那是公開資料。加密的目的是保護 FinLab 的付費訂閱，不是把所有數字都鎖起來，
# 所以沒有付費資料上線時，就不該有任何東西被鎖住 —— 部署流程也已經不呼叫它。
#
# 機制整套留著（連同前端的解鎖畫面）：哪天又有付費資料要上線，把那個市場從
# 這個清單拿掉就接得回去。CLAUDE.md 有該一起改的清單。
PLAINTEXT_SERIES = ('tw', 'us')


def walk_targets():
    u"""只加密**美股**的價格序列。

    us_etfs.json 與 etfs.json 是公開的（見檔頭的表格），台股曲線現在也是。

    先把清單收集成 list 再回傳：加密迴圈會刪掉明文，而一邊 os.walk 一邊刪檔案
    會讓走訪漏掉大部分檔案（第一次寫成 generator，1055 個只處理了 87 個）。
    """
    targets = []
    series = os.path.join(DATA, 'series')
    for dirpath, _dirs, files in os.walk(series):
        rel = os.path.relpath(dirpath, series).replace('\\', '/')
        if rel.split('/')[0] in PLAINTEXT_SERIES:
            continue
        for f in files:
            if not f.endswith('.json'):
                continue
            # 市場層級的日曆：_tw.json 留明文、_us.json 要加密
            base = os.path.splitext(f)[0]
            if base.lstrip('_') in PLAINTEXT_SERIES:
                continue
            if base == 'index':
                continue                      # 只是各市場的檔數統計，不是價格
            targets.append(os.path.join(dirpath, f))
    return targets


def main():
    password = load_password()

    # 優先序：明確設定的 SITE_SALT > 既有 manifest（密碼沒變才算數）> 隨機
    salt = configured_salt()
    rotated = False
    if salt is None:
        salt = try_existing_salt(password)
        rotated = salt is None
        if rotated:
            salt = os.urandom(16)
    key = derive(password, salt)

    json.dump({
        'v': 1,
        'kdf': 'PBKDF2-SHA256',
        'iterations': ITERATIONS,
        'salt': b64(salt),
        'check': b64(encrypt(key, CHECK_PLAINTEXT)),
        'ttlHours': TTL_HOURS,
        # 前端據此決定解密後要不要先解壓縮
        'compressed': True,
    }, io.open(MANIFEST, 'w', encoding='utf-8'), indent=2)

    n = 0
    total_in = total_out = 0
    for path in walk_targets():
        if not os.path.exists(path):
            continue
        raw = io.open(path, 'rb').read()
        out = path + '.enc'
        io.open(out, 'wb').write(encrypt(key, compress(raw)))
        os.remove(path)                           # 明文不留在建置產物裡
        total_in += len(raw)
        total_out += os.path.getsize(out)
        n += 1

    print('加密 %d 個檔案：%.1f MB -> %.1f MB' % (n, total_in / 1e6, total_out / 1e6))
    print('manifest：%s' % os.path.relpath(MANIFEST, ROOT))
    print('salt %s，工作階段效期 %d 小時，PBKDF2 %s 次'
          % ('重新產生（密碼已變更，既有工作階段全部失效）' if rotated else '沿用（既有工作階段仍有效）',
             TTL_HOURS, format(ITERATIONS, ',')))
    if n == 0:
        # 目前的正常狀態就是這樣（見檔頭 PLAINTEXT_SERIES 的說明），所以
        # 不當成錯誤 —— 真的需要加密卻一個都沒加到時，是上面的清單被改壞了。
        print(u'沒有任何檔案需要加密（目前上線的資料都是公開來源）')
        return 0


if __name__ == '__main__':
    main()
