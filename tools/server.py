"""Dev server: serves the project and accepts POST /result from tools/headless.html.

Usage:  python3 tools/server.py [port] [result_file]
Then:   firefox --headless --screenshot out.png "http://localhost:8765/tools/headless.html?ticks=30000"
"""
import http.server
import json
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
OUT = sys.argv[2] if len(sys.argv) > 2 else "headless_result.json"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        data = self.rfile.read(n)
        with open(OUT, "wb") as f:
            f.write(data)
        try:
            d = json.loads(data)
            print(f"result: {d.get('ticks')} ticks in {d.get('ms', 0):.0f} ms", flush=True)
        except Exception:
            pass
        self.send_response(200)
        self.end_headers()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
