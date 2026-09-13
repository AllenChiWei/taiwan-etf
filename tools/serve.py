# -*- coding: utf-8 -*-
u"""Static file server with correct MIME types, for local verification.

    python tools/serve.py <directory> [port]

Python's http.server reads MIME types from the Windows registry, where .js is often
registered as text/plain. Browsers refuse `<script type="module">` served that way
("Strict MIME type checking is enforced"), so the page renders blank and it looks like
an application bug. This sets the types explicitly instead.
"""
import os
import sys
import mimetypes
from functools import partial

try:
    from http.server import HTTPServer, SimpleHTTPRequestHandler
except ImportError:                                  # Python 2 fallback
    raise SystemExit('needs Python 3')

DIRECTORY = sys.argv[1] if len(sys.argv) > 1 else '.'
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8000

# mimetypes.add_type() alone is not enough: the module lazily calls init(), which
# re-reads the Windows registry and can clobber the entry. Overriding guess_type
# below is the part that actually decides, so this table is the source of truth.
TYPES = {
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.svg': 'image/svg+xml',
    '.map': 'application/json',
    '.woff2': 'font/woff2',
    '.html': 'text/html; charset=utf-8',
    '.png': 'image/png',
}
mimetypes.init()
for _ext, _ctype in TYPES.items():
    mimetypes.add_type(_ctype, _ext)


class Handler(SimpleHTTPRequestHandler):
    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        if ext in TYPES:
            return TYPES[ext]
        return SimpleHTTPRequestHandler.guess_type(self, path)

    def end_headers(self):
        # 本機驗證要看到的一定是剛建置出來的檔案
        self.send_header('Cache-Control', 'no-store')
        SimpleHTTPRequestHandler.end_headers(self)

    def log_message(self, *args):
        pass                                         # 安靜，不要洗版


def main():
    if not os.path.isdir(DIRECTORY):
        raise SystemExit('not a directory: %s' % DIRECTORY)
    handler = partial(Handler, directory=DIRECTORY)
    httpd = HTTPServer(('127.0.0.1', PORT), handler)
    print('serving %s at http://127.0.0.1:%d/' % (os.path.abspath(DIRECTORY), PORT))
    sys.stdout.flush()
    httpd.serve_forever()


main()
