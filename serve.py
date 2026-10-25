#!/usr/bin/env python3
"""
Local preview server.

Serves docs/ from the working tree, but the gallery data (titles.json, gallery.json,
titles/*.json) straight from the `data` branch, so no data files need to exist on disk.

Usage: python3 serve.py [port]      (default 8000)
Refresh data: git fetch origin data  (picked up on the next request, no restart needed)
"""

import http.server
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(ROOT, "docs")


def git(*args) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", ROOT, *args], capture_output=True)


def data_ref() -> str:
    # origin/data is what CI and `./data.sh publish` update; local `data` is the fallback before the first push
    for ref in ("origin/data", "data"):
        if git("rev-parse", "--verify", "-q", ref).returncode == 0:
            return ref
    sys.exit("No data branch found. Run: git fetch origin data")


def is_data_path(path: str) -> bool:
    return path in ("titles.json", "gallery.json") or (path.startswith("titles/") and path.endswith(".json"))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DOCS, **kwargs)

    def do_GET(self):
        path = self.path.split("?", 1)[0].lstrip("/")
        if not is_data_path(path):
            return super().do_GET()
        # If local data file exists on disk (e.g. freshly scraped), serve it directly
        local_file = os.path.join(DOCS, path)
        if os.path.exists(local_file):
            return super().do_GET()
        # Otherwise read from git objects on data branch
        blob = git("show", f"{REF}:docs/{path}")
        if blob.returncode != 0:
            return self.send_error(404, f"{path} not on {REF}")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(blob.stdout)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(blob.stdout)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    if git("fetch", "-q", "origin", "data").returncode != 0:
        print("Note: could not fetch origin/data (offline or not pushed yet); using what is local.", flush=True)
    REF = data_ref()
    count = git("ls-tree", "--name-only", f"{REF}:docs/titles").stdout.decode().count(".json")
    print(f"Serving docs/ on http://localhost:{port}  (gallery data: {count} titles from {REF})", flush=True)
    http.server.ThreadingHTTPServer(("", port), Handler).serve_forever()
