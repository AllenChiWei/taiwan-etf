# -*- coding: utf-8 -*-
u"""FinLab 登入的共用進入點。

Token 來源依序是：
  1. 環境變數 FINLAB_API_TOKEN（GitHub Actions 用 secret 注入走這條）
  2. repo 根目錄的 .env

Token 永遠不會被印出來，錯誤訊息也只講長度與來源。這支不做任何資料查詢，
只負責登入 —— 其他腳本 `from finlab_client import login` 之後直接用 finlab.data。
"""
import io
import os
import sys

ENV_VAR = 'FINLAB_API_TOKEN'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read_dotenv(path):
    u"""極簡 .env 解析。不引入 python-dotenv，因為 CI 不該為了兩行邏輯多裝一個套件。"""
    if not os.path.exists(path):
        return {}
    out = {}
    for raw in io.open(path, encoding='utf-8'):
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        v = v.strip()
        # 允許值被引號包住
        if len(v) >= 2 and v[0] == v[-1] and v[0] in ('"', "'"):
            v = v[1:-1]
        out[k.strip()] = v
    return out


SETUP_HELP = (
    u'找不到 FinLab 憑證。三種來源任一即可：\n'
    u'  1. 環境變數 %s\n'
    u'  2. repo 根目錄的 .env（複製 .env.example 再填值）\n'
    u'  3. ~/.finlab/credentials.json —— 在本機用 finlab 套件登入過就會有\n'
    u'  CI 上只有第 1 種可行：Settings → Secrets and variables → Actions\n'
    u'  建立名為 %s 的 secret。Token 在 https://ai.finlab.tw/api_token 取得。'
    % (ENV_VAR, ENV_VAR))


def stored_credentials_path():
    return os.path.join(os.path.expanduser('~'), '.finlab', 'credentials.json')


def load_token():
    u"""-> (token, 來源說明)。沒有明確的 token 時回傳 (None, 說明)，
    代表要讓 finlab 自己去讀既有憑證，而不是視為錯誤。"""
    token = os.environ.get(ENV_VAR, '').strip()
    if token:
        return token, u'環境變數 %s' % ENV_VAR

    env_path = os.path.join(ROOT, '.env')
    token = _read_dotenv(env_path).get(ENV_VAR, '').strip()
    if token:
        return token, u'%s 的 %s' % (env_path, ENV_VAR)

    return None, u'未提供'


def login(quiet=False):
    u"""確保 FinLab 可用。回傳 finlab 模組本身，方便呼叫端直接用。

    有明確 token 就用它登入；沒有的話交給 finlab 讀 ~/.finlab/credentials.json
    （那是套件自己加密存放的位置，本機登入過一次就有）。兩者都沒有才算失敗 ——
    不先擋下來的話，finlab 2.x 會跳出互動式輸入提示，在 CI 上會直接卡住。
    """
    try:
        import finlab
    except ImportError:
        sys.exit('finlab 套件未安裝：pip install finlab')

    token, source = load_token()

    if token:
        try:
            finlab.login(token)
        except Exception as e:
            # 不要把 token 放進錯誤訊息
            sys.exit(u'FinLab 登入失敗（token 來自 %s，長度 %d）：%s'
                     % (source, len(token), e))
        if not quiet:
            print(u'FinLab 已登入（token 來自 %s，長度 %d）' % (source, len(token)))
        return finlab

    stored = stored_credentials_path()
    if not os.path.exists(stored):
        sys.exit(SETUP_HELP)

    if not quiet:
        print(u'FinLab 使用既有憑證（%s）' % stored)
    return finlab


if __name__ == '__main__':
    login()
