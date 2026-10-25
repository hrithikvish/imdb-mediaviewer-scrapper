#!/usr/bin/env python3
"""
Common Constants & Registry Utilities
Shared across scrapers (IMDb scraper.py, Reddit reddit_scraper.py, serve.py).
Strictly uses the Python standard library only (no external dependencies).
"""

import os
import sys
import json
import time

# Force unbuffered stdout/stderr in CI runners and terminals
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(line_buffering=True)

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
DOCS_DIR = os.path.join(ROOT_DIR, "docs")
TITLES_DIR = os.path.join(DOCS_DIR, "titles")
TITLES_JSON_PATH = os.path.join(DOCS_DIR, "titles.json")
GALLERY_JSON_PATH = os.path.join(DOCS_DIR, "gallery.json")

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

def log(msg: str = "", **kwargs):
    """Outputs text immediately with automatic flushing."""
    print(msg, flush=True, **kwargs)

def rebuild_titles_registry() -> int:
    """
    Scans all docs/titles/*.json files and regenerates a synchronized docs/titles.json and docs/gallery.json.
    Standard library only: free of external dependencies.
    """
    os.makedirs(TITLES_DIR, exist_ok=True)
    os.makedirs(DOCS_DIR, exist_ok=True)

    files = [f for f in os.listdir(TITLES_DIR) if f.endswith(".json")]
    registry = []
    latest_title_data = None
    latest_timestamp = -1

    for f in files:
        file_path = os.path.join(TITLES_DIR, f)
        try:
            with open(file_path, "r", encoding="utf-8") as fp:
                data = json.load(fp)
                t_id = data.get("id")
                if not t_id:
                    continue
                items = data.get("items", [])
                poster_url = items[0]["url"] if items else None
                ts = data.get("timestamp", 0)
                name = data.get("name", t_id)
                target_url = data.get("targetUrl", f"https://www.imdb.com/title/{t_id}/mediaindex/")
                registry.append({
                    "id": t_id,
                    "name": name,
                    "targetUrl": target_url,
                    "itemCount": len(items),
                    "posterUrl": poster_url,
                    "file": f"titles/{t_id}.json",
                    "lastUpdated": ts
                })
                if ts > latest_timestamp:
                    latest_timestamp = ts
                    latest_title_data = data
        except Exception as e:
            log(f"⚠️ Error reading {file_path} during registry rebuild: {e}")

    registry.sort(key=lambda x: x.get("lastUpdated", 0), reverse=True)
    with open(TITLES_JSON_PATH, "w", encoding="utf-8") as fp:
        json.dump(registry, fp, indent=2, ensure_ascii=False)

    if latest_title_data:
        gallery_payload = {
            "targetUrl": latest_title_data.get("targetUrl", ""),
            "items": latest_title_data.get("items", []),
            "durationMs": latest_title_data.get("durationMs", 0),
            "strategyUsed": "NETWORK_SNIFFER",
            "timestamp": latest_title_data.get("timestamp", 0)
        }
        with open(GALLERY_JSON_PATH, "w", encoding="utf-8") as fp:
            json.dump(gallery_payload, fp, indent=2, ensure_ascii=False)

    log(f"📋 [REGISTRY] Synchronized docs/titles.json with {len(registry)} titles.")
    return len(registry)
