# -*- coding: utf-8 -*-
u"""Dev helper: copy the page with an overflow probe injected, for headless screenshots.

    python tools/make_diag.py taiwan_etf_list.html __diag.html

Lists every element whose right edge is past the viewport, widest overflow first -
the fast way to find what is making a page scroll sideways on a phone.
Not part of the build; __diag.html is gitignored.
"""
import io, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'taiwan_etf_list.html'
DST = sys.argv[2] if len(sys.argv) > 2 else '__diag.html'

# Joined with <br> via innerHTML so the script needs no backslash escapes at all.
PROBE = u"""
<div id="__diag" style="position:absolute;top:0;left:0;width:384px;z-index:99999;background:#000;
color:#0f0;font:11px/1.5 monospace;padding:5px"></div>
<script>
(function () {
  var vw = document.documentElement.clientWidth;
  var out = ['vw=' + vw + ' body.sw=' + document.body.scrollWidth +
             ' html.sw=' + document.documentElement.scrollWidth];
  var bad = [];
  var all = document.querySelectorAll('body *');
  for (var i = 0; i < all.length; i++) {
    var e = all[i];
    if (e.id === '__diag') continue;
    var r = e.getBoundingClientRect();
    if (r.right > vw + 1) bad.push([Math.round(r.right - vw), Math.round(r.width), e]);
  }
  bad.sort(function (a, b) { return b[0] - a[0]; });
  var seen = {};
  for (var j = 0; j < bad.length && out.length < 14; j++) {
    var el = bad[j][2];
    var cn = (typeof el.className === 'string' && el.className)
             ? '.' + el.className.trim().replace(/ +/g, '.') : '';
    var key = el.tagName.toLowerCase() + cn;
    if (seen[key]) continue;
    seen[key] = 1;
    out.push('over=' + bad[j][0] + ' w=' + bad[j][1] + ' ' + key.slice(0, 52));
  }
  if (!bad.length) out.push('NO OVERFLOW');
  document.getElementById('__diag').innerHTML = out.join('<br>');
})();
</script>
"""

html = io.open(SRC, encoding='utf-8').read()
if u'</body>' not in html:
    raise SystemExit('no </body> in %s' % SRC)
io.open(DST, 'w', encoding='utf-8').write(html.replace(u'</body>', PROBE + u'</body>', 1))
print('%s -> %s' % (SRC, DST))
