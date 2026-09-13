# -*- coding: utf-8 -*-
u"""Encrypt the FinLab-derived data so a public URL alone is not enough to read it.

    python scripts/encrypt_data.py

Encrypts, in place next to the originals:

    app/public/data/us_etfs.json      -> us_etfs.json.enc
    app/public/data/series/**/*.json  -> *.enc

and writes the public manifest `app/public/data/secure.json` that the browser needs
(salt + a check blob). Plaintext copies are deleted afterwards.

Why this rather than a login form: on a static host a password checked in JavaScript
protects nothing — the script is readable and `data/us_etfs.json` is fetchable by URL
without ever running it. Encrypting the payload is the part that actually works; without
the password the files are noise.

What this is and is not: it stops someone who merely has the URL. It does not stop someone
who has the password from keeping a copy — nothing can. Taiwan data stays in the clear
because it comes from public TWSE/TPEx/MoneyDJ pages; only the paid FinLab-derived files
are locked.

Salt handling: the salt lives in the committed manifest and is reused as long as the
password still verifies against the stored check, so a routine rebuild does not log
everyone out. Change SITE_PASSWORD and the salt is regenerated, which invalidates every
existing session — that is the intended behaviour when you rotate the password.
"""
import base64
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
# 200k 次 PBKDF2 在手機上約一秒 —— 使用者只在輸入密碼時付一次這個成本，
# 但暴力破解者每一次猜測都要付。
ITERATIONS = 200_000
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


def walk_targets():
    u"""要加密的檔案。台股那份不在其中：它來自公開來源。

    先把清單收集成 list 再回傳：加密迴圈會刪掉明文，而一邊 os.walk 一邊刪檔案
    會讓走訪漏掉大部分檔案（第一次寫成 generator，1055 個只處理了 87 個）。
    """
    targets = [os.path.join(DATA, 'us_etfs.json')]
    series = os.path.join(DATA, 'series')
    for dirpath, _dirs, files in os.walk(series):
        for f in files:
            if f.endswith('.json'):
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
    }, io.open(MANIFEST, 'w', encoding='utf-8'), indent=2)

    n = 0
    total_in = total_out = 0
    for path in walk_targets():
        if not os.path.exists(path):
            continue
        raw = io.open(path, 'rb').read()
        out = path + '.enc'
        io.open(out, 'wb').write(encrypt(key, raw))
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
        sys.exit('沒有任何檔案被加密 —— 先跑 fetch_us_etfs.py 與 fetch_series.py')


if __name__ == '__main__':
    main()
