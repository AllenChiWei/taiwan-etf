# -*- coding: utf-8 -*-
"""Domain knowledge for the ETF list: MoneyDJ page parsing, bank-name normalisation,
section classification. Imported by build_page.py; edit THIS file when a new bank
spelling or a new fund category shows up.
"""
import re, os, collections

DASH = u'—'          # the em dash the page uses for "no data"

# --- MoneyDJ Basic0004 parsing ------------------------------------------------
# The page is a label/value table. After stripping tags we get a flat token list
# like  [..., '保管機構', '', '華南商業銀行', '', '配息頻率', '', '季配', ...].
# A field is blank when the NEXT token is another label - that is why every
# neighbouring label must appear in LABELS, or a blank 配息頻率 silently picks up
# the 經理費 value sitting after it.
WANTED = [u'ETF名稱', u'發行公司', u'上市日期', u'投資標的', u'投資區域',
          u'保管機構', u'配息頻率', u'殖利率(%)', u'追蹤指數', u'計價幣別',
          u'經理人', u'成立日期', u'ETF規模', u'交易所代碼', u'交易所']

NEIGHBOURS = [u'經理費(%)', u'總管理費用(%)', u'投資風格', u'經銷商',
              u'官方網站連結', u'週轉率', u'成分股數', u'成交量(股)', u'流通股數',
              u'淨值幣別', u'交易單位', u'英文名稱', u'基準指數', u'投資策略',
              u'法人持有比例', u'槓桿多空註記', u'年化標準差(%)', u'折溢價(%)',
              u'ETF淨值', u'ETF市價', u'融資交易', u'放空交易', u'選擇權交易',
              u'文件下載', u'查看淨值', u'歷史配息', u'查看持股', u'查看績效']

LABELS = set(WANTED) | set(NEIGHBOURS)


def flatten(raw):
    t = raw.decode('utf-8', 'ignore')
    t = re.sub(r'(?is)<script.*?</script>', ' ', t)
    t = re.sub(r'(?is)<style.*?</style>', ' ', t)
    t = re.sub(r'<[^>]+>', '|', t)
    t = (t.replace('&nbsp;', ' ').replace('&amp;', '&')
          .replace('&lt;', '<').replace('&gt;', '>'))
    t = re.sub(r'[ \t\r\n　]+', ' ', t)
    return [x.strip() for x in t.split('|')]


def parse_page(path):
    """-> {label: value} for the fields in WANTED that the page actually fills in."""
    toks = [t for t in flatten(open(path, 'rb').read()) if t]
    out = {}
    for i, t in enumerate(toks):
        if t not in LABELS:
            continue
        for j in range(i + 1, min(i + 4, len(toks))):
            v = toks[j]
            if v in LABELS:
                break                      # next label reached -> field is blank
            if v and v != '-->':
                out[t] = v
                break
    return dict((k, v) for k, v in out.items() if k in WANTED)


# --- custodian bank names -----------------------------------------------------
# MoneyDJ spells banks inconsistently. These mappings were derived by diffing
# MoneyDJ against the 204 hand-curated rows the page already had, and produce an
# exact match on every one of them. Add a line when a new spelling appears -
# never invent a bank that is not in the page's filter list without checking.
CUST_NORM = {
    u'玉山銀行': u'玉山商業銀行',
    u'華南銀行': u'華南商業銀行',
    u'彰化銀行': u'彰化商業銀行',
    u'第一銀行': u'第一商業銀行',
    u'元大銀行': u'元大商業銀行',
    u'台中銀行': u'台中商業銀行',
    u'中國信託銀行': u'中國信託商業銀行',
    u'台新銀行': u'台新國際商業銀行',
    u'國泰世華銀行': u'國泰世華商業銀行',
    u'合作金庫銀行': u'合作金庫商業銀行',
    u'兆豐銀行': u'兆豐國際商業銀行',
    u'兆豐商業銀行': u'兆豐國際商業銀行',
    u'富邦銀行': u'台北富邦商業銀行',
    u'富邦商業銀行': u'台北富邦商業銀行',
    u'台北富邦銀行': u'台北富邦商業銀行',
    u'新光銀行': u'台灣新光商業銀行',
    u'臺灣新光商業銀行': u'台灣新光商業銀行',
    u'土地銀行': u'臺灣土地銀行',
    u'台灣土地銀行': u'臺灣土地銀行',
    u'台灣銀行': u'臺灣銀行',
    u'臺灣中小企業銀行': u'台灣中小企銀',
    u'台灣中小企業銀行': u'台灣中小企銀',
    u'中小企業銀行': u'台灣中小企銀',
}


def norm_cust(c):
    c = (c or '').strip()
    c = re.sub(u'股份有限公司$', '', c)
    c = re.sub(u'\\(股\\)公司$', '', c)
    c = re.sub(u'信託部$', '', c)
    return CUST_NORM.get(c, c) or DASH


# --- payout frequency ---------------------------------------------------------
FREQ_CLASS = {
    u'月配':   'freq-monthly',
    u'雙月配': 'freq-bimonthly',
    u'季配':   'freq-quarterly',
    u'半年配': 'freq-semi',
    u'年配':   'freq-annual',
    DASH:      'freq-unknown',
}
FREQ_ORDER = [u'月配', u'雙月配', u'季配', u'半年配', u'年配']


def norm_freq(f):
    """Blank on MoneyDJ means the fund makes no distribution -> the page's em dash."""
    return (f or '').strip() or DASH


# --- yield (殖利率, also on Basic0004) ------------------------------------------
# MoneyDJ writes it as "7.38（09/11）" or "N/A（09/11）" - the trailing quote date is
# the same for every fund, so it is stripped here and stamped once in the header.
# N/A covers both "no distribution" and "pays, but has not distributed yet" (a fund
# listed this year); those are genuinely different situations that MoneyDJ does not
# distinguish, so neither does the page. 配息 is the column that tells them apart.
_YIELD = re.compile(u'^(-?[\\d.]+)\\s*(?:（(\\d\\d/\\d\\d)）)?')


def parse_yield(v):
    """-> (value, asof). value is the number as a string, or NA."""
    v = (v or '').strip()
    m = _YIELD.match(v)
    if not m:
        d = re.search(u'（(\\d\\d/\\d\\d)）', v)
        return NA, (d.group(1) if d else '')
    return m.group(1), (m.group(2) or '')


# --- period returns (MoneyDJ Basic0008 報酬分析) --------------------------------
# The page holds one label row (項目(單位: %) / 一日 / 一週 / 一個月 / 三個月 / 六個月 /
# 一年 / 三年 / 五年 / 十年 / 成立日) followed by a 市價 row and a 淨值 row.
# We take 市價 (market price) - that is the return someone holding the ETF actually
# realised. 淨值 (NAV) sits in the row right after if it is ever wanted instead.
RETURN_PERIODS = [u'三個月', u'六個月', u'一年', u'三年', u'五年']
NA = 'N/A'


def parse_returns(path):
    """-> {'三個月': '8.52', '六個月': ..., '一年': ..., 'asof': '09/11'} ; {} if unparsable.

    Young funds legitimately report N/A for the longer periods - that is data, not
    a parse failure, so it is passed through untouched.
    """
    toks = [t for t in flatten(open(path, 'rb').read()) if t]
    start = next((k for k, t in enumerate(toks) if t.startswith(u'項目')), -1)
    if start < 0:
        return {}
    labels, k = [], start + 1
    while k < len(toks) and not toks[k].startswith(u'市價'):
        labels.append(toks[k])
        k += 1
        if len(labels) > 15:            # ran past the table - layout changed
            return {}
    if k >= len(toks):
        return {}
    values = toks[k + 1:k + 1 + len(labels)]
    if len(values) != len(labels):
        return {}
    row = dict(zip(labels, values))
    if not all(p in row for p in RETURN_PERIODS):
        return {}
    out = dict((p, row[p]) for p in RETURN_PERIODS)
    m = re.search(r'\((\d\d/\d\d)\)', toks[k])
    out['asof'] = m.group(1) if m else ''
    return out


def return_class(v):
    """Taiwan convention: red for gains, green for losses."""
    if not v or v == NA:
        return 'ret-na'
    try:
        f = float(v.replace(',', ''))
    except ValueError:
        return 'ret-na'
    return 'ret-up' if f > 0 else ('ret-down' if f < 0 else 'ret-flat')


# --- section classification ---------------------------------------------------
# Reproduces the page's own categorisation on 203 of its original 204 rows.
# Existing codes keep whatever section they are already in (build_page.py only
# calls this for codes that are NOT yet on the page) - that preserves curated
# calls such as 00735 國泰臺韓科技 sitting in 海外 despite MoneyDJ saying 台灣.
SECTIONS = [
    ('cat-domestic',          u'台股ETF'),
    ('cat-foreign',           u'海外ETF'),
    ('cat-bond',              u'債券ETF'),
    ('cat-leveraged',         u'槓桿/反向ETF'),
    ('cat-futures',           u'期貨ETF'),
    ('cat-leveraged-futures', u'槓桿期貨ETF'),
]
SECTION_IDS = [s for s, _ in SECTIONS]


def section(code, name, target, area):
    """target = MoneyDJ 投資標的, area = MoneyDJ 投資區域."""
    suffix = re.sub(r'^\d+', '', code)          # 00679B -> B, 00631L -> L, 0050 -> ''
    if suffix == 'U':
        return 'cat-futures'                     # 期貨 ETF (00635U 期元大S&P黃金 ...)
    if suffix in ('L', 'R'):                     # 正2 / 反1
        return 'cat-leveraged-futures' if name.startswith(u'期') else 'cat-leveraged'
    if code.endswith('B') or u'債' in (target or ''):
        return 'cat-bond'                        # B suffix, plus D-suffix active bond ETFs
    return 'cat-domestic' if area == u'台灣' else 'cat-foreign'


def load_rows(work, universe, current_sections):
    """universe: [(code, name, market)]; current_sections: {code: section_id}.
    -> rows, missing_basic, missing_returns, asof

    Each row: {code, name, cust, freq, sec, ret: {三個月, 六個月, 一年}}.
    A missing/unparsable returns page yields N/A cells rather than blocking the
    build - basic data is the page's backbone, returns are an extra."""
    rows, missing, no_ret, asof = [], [], [], collections.Counter()
    yld_asof = collections.Counter()
    for code, name, _market in universe:
        path = os.path.join(work, 'pages', code + '.html')
        d = parse_page(path) if os.path.exists(path) else {}
        if not d:
            missing.append(code)
        yld, ya = parse_yield(d.get(u'殖利率(%)', ''))
        if ya:
            yld_asof[ya] += 1

        rpath = os.path.join(work, 'returns', code + '.html')
        r = parse_returns(rpath) if os.path.exists(rpath) else {}
        if not r:
            no_ret.append(code)
        elif r.get('asof'):
            asof[r['asof']] += 1

        rows.append({
            'code': code,
            'name': name,
            'cust': norm_cust(d.get(u'保管機構', '')),
            'freq': norm_freq(d.get(u'配息頻率', '')),
            'yield': yld,
            'ret': dict((p, r.get(p) or NA) for p in RETURN_PERIODS),
            'sec': current_sections.get(code) or section(
                code, name, d.get(u'投資標的', ''), d.get(u'投資區域', '')),
        })
    top = lambda c: (c.most_common(1)[0][0] if c else '')
    return rows, missing, no_ret, top(asof), top(yld_asof)
