#!/usr/bin/env python3
"""
Reddit Media & Poster Scraper
Extracts high-resolution poster artwork and photography from subreddits (e.g. r/MoviePosterPorn).

Features:
- Dual-engine architecture:
  1. Live Sync Engine: RSS feed with Playwright fallback for zero-downtime daily updates.
  2. PullPush Archive Engine: Comprehensive historical backfill across the entire lifespan of a subreddit.
- Zero-CLS Aspect Ratio Extraction: Extracts natural width and height from title brackets ([WidthxHeight])
  or media preview metadata.
- Partitioned Storage: Complies with repository architecture (docs/titles/r_{subreddit}.json).
- Deterministic Sync: Merges and deduplicates posts by unique Reddit post ID.
"""

import os
import sys
import re
import json
import time
import html
import argparse
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from typing import List, Dict, Optional, Tuple, Set

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None

from common import (
    DOCS_DIR,
    TITLES_DIR,
    TITLES_JSON_PATH,
    USER_AGENT,
    log,
    rebuild_titles_registry,
)

# ---------------------------------------------------------------------------
# Resolution & Post Parser
# ---------------------------------------------------------------------------

def extract_resolution(title: str, preview: Optional[Dict] = None) -> Tuple[int, int]:
    """
    Extracts width and height from title tags like [2400x3000] or Reddit preview metadata.
    Defaults to 2:3 aspect ratio (2000x3000) if completely unspecified.
    """
    # 1. Check title bracket pattern [1234 x 5678] or (1234x5678)
    m = re.search(r'[\[\(]\s*(\d{3,5})\s*[\*xX×]\s*(\d{3,5})\s*[\]\)]', title)
    if m:
        try:
            w, h = int(m.group(1)), int(m.group(2))
            if w > 100 and h > 100:
                return w, h
        except Exception:
            pass

    # 2. Check preview image metadata if present
    if preview and isinstance(preview, dict):
        images = preview.get("images", [])
        if images and isinstance(images, list):
            source = images[0].get("source", {})
            w = source.get("width")
            h = source.get("height")
            if w and h and w > 100 and h > 100:
                return int(w), int(h)

    # 3. Default fallback for standard movie poster ratio (2:3)
    return 2000, 3000

def normalize_image_url(url: str) -> Optional[str]:
    """Normalizes image URL to direct master asset; returns None if non-image."""
    if not url or not isinstance(url, str):
        return None
    url = url.strip()

    # Unescape HTML entities (e.g. &amp; in query strings)
    url = html.unescape(url)

    # Imgur single image normalization
    if "imgur.com/" in url and not url.endswith((".jpg", ".jpeg", ".png", ".webp", ".gif")):
        if "/a/" not in url and "/gallery/" not in url:
            img_id = url.split("?")[0].rstrip("/").split("/")[-1]
            if img_id and len(img_id) <= 10:
                return f"https://i.imgur.com/{img_id}.jpg"

    # Only accept direct image files or i.redd.it links
    lower = url.lower()
    if "i.redd.it" in lower or lower.endswith((".jpg", ".jpeg", ".png", ".webp")):
        return url

    return None

def parse_pullpush_post(p: Dict) -> Optional[Dict]:
    """Converts a PullPush submission record into our standardized gallery item schema."""
    url = normalize_image_url(p.get("url", ""))
    title = p.get("title", "")
    if not url or not title:
        return None

    if p.get("removed_by_category") or p.get("is_self") or title in ("[deleted]", "[removed]"):
        return None

    post_id = p.get("id")
    if not post_id:
        return None

    w, h = extract_resolution(title, p.get("preview"))
    mime = "image/png" if url.lower().endswith(".png") else "image/webp" if url.lower().endswith(".webp") else "image/jpeg"

    created_utc = int(float(p.get("created_utc", 0)))
    score = int(p.get("score") or 0)
    author = p.get("author") or ""
    subreddit = p.get("subreddit") or ""
    permalink = p.get("permalink") or f"/r/{subreddit}/comments/{post_id}/"
    if not permalink.startswith("http"):
        permalink = f"https://www.reddit.com{permalink}"

    return {
        "id": post_id,
        "url": url,
        "type": "IMAGE",
        "mimeType": mime,
        "title": html.unescape(title),
        "width": w,
        "height": h,
        "metadata": {
            "source": "reddit",
            "subreddit": subreddit,
            "author": author,
            "score": score,
            "created_utc": created_utc,
            "permalink": permalink
        }
    }

# ---------------------------------------------------------------------------
# Storage & Partition Helpers
# ---------------------------------------------------------------------------

def get_subreddit_file_path(subreddit: str) -> str:
    clean_name = re.sub(r'[^a-zA-Z0-9_]', '', subreddit)
    return os.path.join(TITLES_DIR, f"r_{clean_name}.json")

def load_subreddit_archive(subreddit: str) -> Dict:
    file_path = get_subreddit_file_path(subreddit)
    if os.path.exists(file_path):
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            log(f"⚠️ Error reading existing archive {file_path}: {e}")
    return {
        "id": f"r_{subreddit}",
        "name": f"r/{subreddit}",
        "targetUrl": f"https://www.reddit.com/r/{subreddit}/",
        "items": [],
        "durationMs": 0,
        "timestamp": int(time.time() * 1000)
    }

def save_subreddit_archive(data: Dict):
    os.makedirs(TITLES_DIR, exist_ok=True)
    subreddit_id = data.get("id", "r_subreddit")
    file_path = os.path.join(TITLES_DIR, f"{subreddit_id}.json")
    data["timestamp"] = int(time.time() * 1000)
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    log(f"💾 Saved {len(data['items'])} items to {file_path}")

# ---------------------------------------------------------------------------
# Live Feed Collector (RSS + Playwright Fallback)
# ---------------------------------------------------------------------------

def fetch_reddit_rss_posts(subreddit: str) -> List[Dict]:
    """Fetches up to 25 latest live posts from /new/.rss using standard library XML parsing."""
    url = f"https://www.reddit.com/r/{subreddit}/new/.rss"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            xml_data = resp.read()
    except Exception as e:
        log(f"ℹ️ RSS feed request ({url}) returned: {e}")
        return []

    try:
        root = ET.fromstring(xml_data)
    except Exception as e:
        log(f"⚠️ Failed to parse RSS XML: {e}")
        return []

    ns = {"atom": "http://www.w3.org/2005/Atom"}
    items = []

    for entry in root.findall("atom:entry", ns):
        title_el = entry.find("atom:title", ns)
        title = title_el.text if title_el is not None else ""
        id_el = entry.find("atom:id", ns)
        post_id = id_el.text.replace("t3_", "") if id_el is not None else ""
        content_el = entry.find("atom:content", ns)
        content = content_el.text if content_el is not None else ""

        img_m = re.search(r'<span><a href=\"([^\"]+)\">\[link\]</a></span>', content)
        img_url = normalize_image_url(img_m.group(1)) if img_m else None
        if not img_url:
            src_m = re.search(r'<img src=\"([^\"]+)\"', content)
            if src_m:
                img_url = normalize_image_url(src_m.group(1))

        if not img_url or not post_id or not title:
            continue

        w, h = extract_resolution(title)
        mime = "image/png" if img_url.lower().endswith(".png") else "image/webp" if img_url.lower().endswith(".webp") else "image/jpeg"

        author_el = entry.find("atom:author/atom:name", ns)
        author = author_el.text.replace("/u/", "") if author_el is not None else ""
        link_el = entry.find("atom:link", ns)
        permalink = link_el.get("href") if link_el is not None else f"https://www.reddit.com/r/{subreddit}/comments/{post_id}/"

        pub_el = entry.find("atom:published", ns) or entry.find("atom:updated", ns)
        created_utc = int(time.time())
        if pub_el is not None and pub_el.text:
            try:
                import datetime
                t_str = pub_el.text.replace("Z", "+00:00")
                dt = datetime.datetime.fromisoformat(t_str)
                created_utc = int(dt.timestamp())
            except Exception:
                pass

        items.append({
            "id": post_id,
            "url": img_url,
            "type": "IMAGE",
            "mimeType": mime,
            "title": html.unescape(title),
            "width": w,
            "height": h,
            "metadata": {
                "source": "reddit",
                "subreddit": subreddit,
                "author": author,
                "score": 1,
                "created_utc": created_utc,
                "permalink": permalink
            }
        })

    return items

def fetch_reddit_playwright_posts(subreddit: str) -> List[Dict]:
    """Fetches live posts using headless Chromium when RSS is rate-limited or blocked."""
    if not sync_playwright:
        return []

    log(f"🌐 Fetching live posts for r/{subreddit} via Playwright...")
    items = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            ctx = browser.new_context(user_agent=USER_AGENT)
            page = ctx.new_page()
            page.goto(f"https://www.reddit.com/r/{subreddit}/new/", wait_until="domcontentloaded", timeout=20000)
            page.wait_for_timeout(2000)

            raw_elements = page.evaluate("""() => {
                return Array.from(document.querySelectorAll('shreddit-post')).map(el => ({
                    id: (el.getAttribute('id') || '').replace('t3_', ''),
                    title: el.getAttribute('post-title'),
                    url: el.getAttribute('content-href'),
                    author: el.getAttribute('author'),
                    score: el.getAttribute('score'),
                    permalink: el.getAttribute('permalink'),
                    created: el.getAttribute('created-timestamp')
                }));
            }""")
            browser.close()

            for el in raw_elements:
                url = normalize_image_url(el.get("url"))
                post_id = el.get("id")
                title = el.get("title")
                if not url or not post_id or not title:
                    continue

                w, h = extract_resolution(title)
                mime = "image/png" if url.lower().endswith(".png") else "image/webp" if url.lower().endswith(".webp") else "image/jpeg"

                created_utc = int(time.time())
                if el.get("created"):
                    try:
                        import datetime
                        t_str = el["created"].replace("Z", "+00:00")
                        dt = datetime.datetime.fromisoformat(t_str)
                        created_utc = int(dt.timestamp())
                    except Exception:
                        pass

                items.append({
                    "id": post_id,
                    "url": url,
                    "type": "IMAGE",
                    "mimeType": mime,
                    "title": html.unescape(title),
                    "width": w,
                    "height": h,
                    "metadata": {
                        "source": "reddit",
                        "subreddit": subreddit,
                        "author": el.get("author") or "",
                        "score": int(el.get("score") or 1),
                        "created_utc": created_utc,
                        "permalink": f"https://www.reddit.com{el.get('permalink', '')}"
                    }
                })
    except Exception as e:
        log(f"⚠️ Playwright live fetch error: {e}")

    return items

def fetch_live_posts(subreddit: str) -> List[Dict]:
    """Tries RSS first; gracefully falls back to Playwright if RSS is rate-limited."""
    posts = fetch_reddit_rss_posts(subreddit)
    if posts:
        return posts
    return fetch_reddit_playwright_posts(subreddit)

# ---------------------------------------------------------------------------
# PullPush Archive Historical Backfill Engine
# ---------------------------------------------------------------------------

def fetch_pullpush_batch(subreddit: str, before: Optional[int] = None, after: Optional[int] = None, size: int = 100) -> List[Dict]:
    """Fetches a batch of historical submissions from api.pullpush.io."""
    params = [f"subreddit={subreddit}", f"size={size}"]
    if before is not None:
        params.append(f"before={before}")
    if after is not None:
        params.append(f"after={after}")

    url = f"https://api.pullpush.io/reddit/search/submission/?{'&'.join(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})

    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data.get("data", [])
        except Exception as e:
            wait = (attempt + 1) * 2
            log(f"⚠️ PullPush request error ({e}). Retrying in {wait}s...")
            time.sleep(wait)
    return []

# ---------------------------------------------------------------------------
# Sync & Backfill Workflows
# ---------------------------------------------------------------------------

def sync_subreddit(subreddit: str, rebuild_registry: bool = True) -> int:
    """
    Incremental sync:
    1. Fetches live posts (RSS or Playwright)
    2. Also fetches any intermediate posts from PullPush
    3. Prepends new posts to the archive and updates registry index
    """
    log(f"🔄 Syncing r/{subreddit} (checking for new posts)...")
    t0 = time.time()
    archive = load_subreddit_archive(subreddit)
    existing_items = archive.get("items", [])
    existing_ids = {it["id"] for it in existing_items if "id" in it}

    new_items = []

    # 1. Fetch live posts
    live_posts = fetch_live_posts(subreddit)
    for it in live_posts:
        if it["id"] not in existing_ids:
            new_items.append(it)
            existing_ids.add(it["id"])

    # 2. Query PullPush to fill any gap between archive and live
    if existing_items:
        newest_utc = max((it.get("metadata", {}).get("created_utc", 0) for it in existing_items), default=0)
        if newest_utc > 0:
            pp_batch = fetch_pullpush_batch(subreddit, after=newest_utc, size=100)
            for p in pp_batch:
                parsed = parse_pullpush_post(p)
                if parsed and parsed["id"] not in existing_ids:
                    new_items.append(parsed)
                    existing_ids.add(parsed["id"])
    else:
        # Initial sync for an empty archive: fetch latest PullPush batch as well
        pp_batch = fetch_pullpush_batch(subreddit, size=100)
        for p in pp_batch:
            parsed = parse_pullpush_post(p)
            if parsed and parsed["id"] not in existing_ids:
                new_items.append(parsed)
                existing_ids.add(parsed["id"])

    if not new_items:
        log(f"✨ r/{subreddit} is already up to date ({len(existing_items)} items).")
        return 0

    log(f"📥 Discovered {len(new_items)} new post(s) for r/{subreddit}!")

    # Combine: newest posts first (sorted by created_utc descending)
    all_items = new_items + existing_items
    all_items.sort(key=lambda x: x.get("metadata", {}).get("created_utc", 0), reverse=True)

    archive["items"] = all_items
    archive["durationMs"] = int((time.time() - t0) * 1000)
    save_subreddit_archive(archive)

    if rebuild_registry:
        rebuild_titles_registry()

    return len(new_items)

def backfill_subreddit(
    subreddit: str,
    limit: Optional[int] = None,
    min_score: int = 0,
    rebuild_registry: bool = True
) -> int:
    """
    Historical backfill:
    Paginates backwards from the oldest post in the existing archive down to the
    beginning of the subreddit (or limit).
    """
    log(f"🚀 Starting historical backfill for r/{subreddit} (limit={limit or 'all'}, min_score={min_score})...")
    t0 = time.time()
    archive = load_subreddit_archive(subreddit)
    existing_items = archive.get("items", [])
    existing_ids = {it["id"] for it in existing_items if "id" in it}

    # First, make sure recent posts are in the archive before going backwards
    if not existing_items:
        sync_subreddit(subreddit, rebuild_registry=False)
        archive = load_subreddit_archive(subreddit)
        existing_items = archive.get("items", [])
        existing_ids = {it["id"] for it in existing_items if "id" in it}

    # Determine starting cursor (before)
    if existing_items:
        oldest_utc = min((it.get("metadata", {}).get("created_utc", int(time.time())) for it in existing_items), default=int(time.time()))
        log(f"ℹ️ Archive currently has {len(existing_items)} posts. Resuming backwards from {time.strftime('%Y-%m-%d', time.gmtime(oldest_utc))}...")
        cursor_before = oldest_utc
    else:
        cursor_before = int(time.time())

    collected_new = 0
    batch_num = 0
    stagnant_count = 0

    while True:
        batch_num += 1
        raw_posts = fetch_pullpush_batch(subreddit, before=cursor_before, size=100)
        if not raw_posts:
            log(f"🏁 Reached end of historical submissions for r/{subreddit}.")
            break

        oldest_in_batch = None
        batch_valid = 0

        for p in raw_posts:
            post_utc = int(float(p.get("created_utc", 0)))
            if oldest_in_batch is None or post_utc < oldest_in_batch:
                oldest_in_batch = post_utc

            if int(p.get("score") or 0) < min_score:
                continue

            parsed = parse_pullpush_post(p)
            if parsed and parsed["id"] not in existing_ids:
                existing_items.append(parsed)
                existing_ids.add(parsed["id"])
                collected_new += 1
                batch_valid += 1

        date_str = time.strftime('%Y-%m-%d', time.gmtime(oldest_in_batch or cursor_before))
        log(f"Batch {batch_num:3d}: +{batch_valid:2d} valid images (total new: {collected_new:5d}, archive total: {len(existing_items):5d}) | reached {date_str}")

        if oldest_in_batch is None or oldest_in_batch >= cursor_before:
            stagnant_count += 1
            cursor_before -= 86400  # Shift back 1 day to escape stagnation
            if stagnant_count > 5:
                log("🛑 Stagnant cursor detected; stopping backfill.")
                break
        else:
            stagnant_count = 0
            cursor_before = oldest_in_batch

        if limit and collected_new >= limit:
            log(f"🎯 Reached target limit of {limit} posts.")
            break

        # Save checkpoint every 10 batches (1000 posts checked)
        if batch_num % 10 == 0:
            existing_items.sort(key=lambda x: x.get("metadata", {}).get("created_utc", 0), reverse=True)
            archive["items"] = existing_items
            archive["durationMs"] = int((time.time() - t0) * 1000)
            save_subreddit_archive(archive)
            if rebuild_registry:
                rebuild_titles_registry()

        # Respect API rate limits
        time.sleep(0.5)

    # Final save
    existing_items.sort(key=lambda x: x.get("metadata", {}).get("created_utc", 0), reverse=True)
    archive["items"] = existing_items
    archive["durationMs"] = int((time.time() - t0) * 1000)
    save_subreddit_archive(archive)

    if rebuild_registry:
        rebuild_titles_registry()

    log(f"✅ Finished backfill for r/{subreddit}: added {collected_new} new items in {time.time()-t0:.1f}s.")
    return collected_new

# ---------------------------------------------------------------------------
# CLI Entry Point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Reddit Media & Poster Scraper: Scrapes and incrementally syncs subreddits."
    )
    parser.add_argument(
        "--subreddit", "-s",
        type=str,
        default="MoviePosterPorn",
        help="Subreddit to scrape (default: MoviePosterPorn)"
    )
    parser.add_argument(
        "--subreddits",
        type=str,
        nargs="+",
        help="Multiple subreddits to process sequentially"
    )
    parser.add_argument(
        "--sync",
        action="store_true",
        help="Incremental sync: fetch only new posts since the last run (ideal for CI workflow cron)"
    )
    parser.add_argument(
        "--backfill",
        action="store_true",
        help="Historical backfill: paginate backwards through the subreddit's entire archive"
    )
    parser.add_argument(
        "--limit", "-l",
        type=int,
        default=None,
        help="Maximum number of new posts to add in this run (default: unlimited)"
    )
    parser.add_argument(
        "--min-score",
        type=int,
        default=0,
        help="Minimum upvote score required for historical posts (default: 0)"
    )
    parser.add_argument(
        "--rebuild-index",
        action="store_true",
        help="Rebuild docs/titles.json registry without scraping"
    )

    args = parser.parse_args()

    if args.rebuild_index:
        rebuild_titles_registry()
        return

    subreddits = args.subreddits or [args.subreddit]

    for sub in subreddits:
        sub = sub.lstrip("r/").strip()
        if not sub:
            continue
        if args.backfill:
            backfill_subreddit(sub, limit=args.limit, min_score=args.min_score)
        else:
            # Default is incremental sync
            sync_subreddit(sub)

if __name__ == "__main__":
    main()
