#!/usr/bin/env python3
"""
IMDb MediaViewer Scraper (Python Edition)
High-performance scraper for IMDb media galleries:
- Extracts master quality uncompressed images, true captions, and dimensions
- Intercepts Next.js __NEXT_DATA__ and GraphQL TitleMediaIndexPagination responses
- Automatically manages docs/titles/{id}.json, docs/titles.json, and docs/gallery.json
"""

import sys
import os
import re
import json
import time
import argparse
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from typing import List, Dict, Optional, Tuple, Set
from playwright.sync_api import sync_playwright, Browser, BrowserContext, Page

# Force real-time unbuffered output in CI runners and terminals
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(line_buffering=True)

def log(msg: str = "", **kwargs):
    """Outputs text immediately with automatic flushing."""
    print(msg, flush=True, **kwargs)

DOCS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "docs"))
TITLES_DIR = os.path.join(DOCS_DIR, "titles")
TITLES_JSON_PATH = os.path.join(DOCS_DIR, "titles.json")
GALLERY_JSON_PATH = os.path.join(DOCS_DIR, "gallery.json")

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# ---------------------------------------------------------------------------
# Helpers & Title Resolution
# ---------------------------------------------------------------------------

def clean_imdb_image_url(url: str) -> str:
    """Strips IMDb resize/crop parameters to get original master uncompressed image."""
    return re.sub(r"\._V1_.*(\.[a-zA-Z]+)$", r"._V1_\1", url)

def resolve_title_by_id(title_id: str) -> Optional[str]:
    """Fetches canonical title name and year from IMDb Suggestion API."""
    prefix = title_id[0].lower()
    url = f"https://v3.sg.media-imdb.com/suggestion/{prefix}/{title_id}.json"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            items = data.get("d", [])
            for item in items:
                if item.get("id") == title_id:
                    name = item.get("l", "")
                    year = item.get("y", "")
                    return f"{name} ({year})" if year else name
            if items:
                first = items[0]
                name = first.get("l", "")
                year = first.get("y", "")
                return f"{name} ({year})" if year else name
    except Exception:
        pass
    return None

def resolve_title_from_query(query: str) -> Optional[Tuple[str, str]]:
    """Resolves a free-text movie query (e.g. 'miracle worker') to (id, name)."""
    sanitized = re.sub(r"[^a-zA-Z0-9 ]", " ", query).strip()
    sanitized = re.sub(r"\s+", "_", sanitized).lower()
    if not sanitized:
        return None
    first_char = sanitized[0]
    url = f"https://v3.sg.media-imdb.com/suggestion/{first_char}/{sanitized}.json"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            for item in data.get("d", []):
                item_id = item.get("id", "")
                if item_id.startswith("tt") or item_id.startswith("nm"):
                    name = item.get("l", "")
                    year = item.get("y", "")
                    title_name = f"{name} ({year})" if year else name
                    return item_id, title_name
    except Exception:
        pass
    return None

def extract_imdb_titles_from_text(raw_text: str) -> List[Tuple[str, str]]:
    """
    Extracts all unique IMDb IDs and titles from arbitrary text, file content, or query strings.
    Supports both movies/series (tt...) and persons/actors (nm...).
    Resolves canonical names and release years concurrently using a thread pool.
    """
    token_pattern = re.compile(r'(https?://[^\s,"\'<>]+|\b(?:tt|nm)\d{7,8}\b)')
    id_pattern = re.compile(r"((?:tt|nm)\d{7,8})")
    find_pattern = re.compile(r"find[/?].*?[?&]q=([^&\s]+)")

    tokens = token_pattern.findall(raw_text)
    tasks = []
    seen_tokens = set()

    if tokens:
        for token in tokens:
            id_match = id_pattern.search(token)
            if id_match:
                tid = id_match.group(1)
                if tid not in seen_tokens:
                    seen_tokens.add(tid)
                    tasks.append(("id", tid))
                continue

            find_match = find_pattern.search(token)
            if find_match:
                q = urllib.parse.unquote(find_match.group(1)).strip(".)];")
                if q not in seen_tokens:
                    seen_tokens.add(q)
                    tasks.append(("query", q))
    else:
        for line in raw_text.splitlines():
            line = line.strip()
            if not line:
                continue
            if line not in seen_tokens:
                seen_tokens.add(line)
                tasks.append(("query", line))

    if not tasks:
        return []

    def resolve_task(task):
        t_type, t_val = task
        if t_type == "id":
            name = resolve_title_by_id(t_val) or t_val
            return (t_val, name)
        elif t_type == "query":
            return resolve_title_from_query(t_val)
        return None

    # Resolve all titles in parallel (100 titles in < 1 second)
    with ThreadPoolExecutor(max_workers=20) as executor:
        resolved_items = list(executor.map(resolve_task, tasks))

    results = []
    seen_ids = set()
    for item in resolved_items:
        if item and item[0] not in seen_ids:
            seen_ids.add(item[0])
            results.append(item)

    return results

# ---------------------------------------------------------------------------
# Deep JSON Traversal for High-Res Media & True Captions
# ---------------------------------------------------------------------------

def traverse_json_for_media(obj, results: list):
    """Recursively walks arbitrary JSON (Next.js __NEXT_DATA__ or GraphQL response) to extract image metadata."""
    if isinstance(obj, dict):
        url = obj.get("url") or obj.get("src")
        if not url and isinstance(obj.get("image"), dict):
            url = obj["image"].get("url")

        if isinstance(url, str) and "m.media-amazon.com/images/M/" in url:
            img_obj = obj.get("image") if isinstance(obj.get("image"), dict) else {}
            width = obj.get("width") or img_obj.get("width")
            height = obj.get("height") or img_obj.get("height")

            caption = None
            cap_obj = obj.get("caption") or img_obj.get("caption")
            if isinstance(cap_obj, str):
                caption = cap_obj
            elif isinstance(cap_obj, dict):
                caption = cap_obj.get("plainText") or cap_obj.get("text")
            if not caption:
                caption = obj.get("title")

            if caption and caption.strip().lower() == "view poster":
                caption = None

            results.append({
                "url": clean_imdb_image_url(url),
                "caption": caption.strip() if caption else None,
                "width": int(width) if width else None,
                "height": int(height) if height else None
            })

        for v in obj.values():
            traverse_json_for_media(v, results)

    elif isinstance(obj, list):
        for item in obj:
            traverse_json_for_media(item, results)

# ---------------------------------------------------------------------------
# Core Playwright Scraper
# ---------------------------------------------------------------------------

def scrape_single_title_gallery(
    context: BrowserContext,
    title_id: str,
    title_name: str,
    timeout_ms: int = 35000
) -> List[Dict]:
    """Scrapes all master images for a title or person using Playwright with GraphQL interception."""
    entity_type = "name" if title_id.startswith("nm") else "title"
    mediaindex_url = f"https://www.imdb.com/{entity_type}/{title_id}/mediaindex/"
    page = context.new_page()

    graphql_items = []
    tracker = {"total": None, "has_next": True}

    def on_response(res):
        if "MediaIndexPagination" in res.url or "graphql" in res.url:
            try:
                data = res.json()
                data_root = data.get("data", {})
                entity_data = data_root.get(entity_type, {}) or data_root.get("title", {}) or data_root.get("name", {})
                img_data = entity_data.get("images", {})
                if img_data.get("total"):
                    tracker["total"] = img_data["total"]
                if "pageInfo" in img_data:
                    tracker["has_next"] = img_data["pageInfo"].get("hasNextPage", True)
                if img_data:
                    traverse_json_for_media(img_data, graphql_items)
            except Exception:
                pass

    page.on("response", on_response)

    try:
        page.goto(mediaindex_url, wait_until="domcontentloaded", timeout=timeout_ms)
        try:
            page.wait_for_selector(
                "a[href*='/mediaviewer/rm'] img, [data-testid='sub-section-images'] img",
                state="attached",
                timeout=10000
            )
        except Exception:
            pass

        # 1. Extract metadata from Next.js __NEXT_DATA__ (scoped strictly to gallery images block)
        next_data_items = []
        try:
            static_res = context.request.get(mediaindex_url, timeout=15000)
            m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', static_res.text(), re.DOTALL)
            if m:
                raw_data = json.loads(m.group(1))

                # Locate the entity's images block only (ignoring 'More Like This' / recommendations)
                def find_images_block(obj):
                    if isinstance(obj, dict):
                        if "images" in obj and isinstance(obj["images"], dict) and ("edges" in obj["images"] or "total" in obj["images"]):
                            return obj["images"]
                        for v in obj.values():
                            found = find_images_block(v)
                            if found:
                                return found
                    elif isinstance(obj, list):
                        for item in obj:
                            found = find_images_block(item)
                            if found:
                                return found
                    return None

                images_block = find_images_block(raw_data)
                if images_block:
                    if images_block.get("total") and not tracker["total"]:
                        tracker["total"] = int(images_block["total"])
                        log(f"   ℹ️ Detected total photos from metadata: {tracker['total']}")
                    traverse_json_for_media(images_block, next_data_items)
        except Exception:
            pass

        # 2. Smoothly scroll gallery to trigger pagination until all photos are loaded
        last_count = 0
        no_growth = 0
        max_scroll_iterations = 250
        for iteration in range(1, max_scroll_iterations + 1):
            cur = page.evaluate("document.querySelectorAll(\"a[href*='/mediaviewer/rm'] img\").length")

            if tracker["total"] and cur >= tracker["total"]:
                log(f"   ✅ All {cur}/{tracker['total']} photos loaded from gallery.")
                break

            if not tracker["has_next"] and cur > 50:
                log(f"   ✅ Reached end of gallery pagination ({cur} photos).")
                break

            if cur == last_count and cur > 0:
                no_growth += 1
                max_no_growth = 12 if (tracker["total"] and cur < tracker["total"]) else 7
                if no_growth >= max_no_growth:
                    log(f"   ℹ️ Pagination settled with {cur} photos.")
                    break
            else:
                no_growth = 0
                last_count = cur
                if iteration % 5 == 0 or (tracker["total"] and cur >= tracker["total"] * 0.9):
                    total_str = f" / {tracker['total']}" if tracker["total"] else ""
                    log(f"   ... scrolling gallery: {cur}{total_str} photos loaded")

            page.evaluate("""
                // 1. Click any "Load More" / "See more" button if present
                const buttons = Array.from(document.querySelectorAll("button, a"));
                const loadBtn = buttons.find(b => {
                    const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
                    return (txt.includes('load more') || txt.includes('see more') || txt === 'more') && b.offsetParent !== null;
                });
                if (loadBtn) {
                    loadBtn.click();
                }

                // 2. Scroll pagination loader or window down
                const loader = document.querySelector('.img_gallery_pagination_loader');
                if (loader) loader.scrollIntoView({ behavior: 'smooth', block: 'end' });
                else window.scrollBy(0, window.innerHeight * 3);
            """)
            page.wait_for_timeout(500)

        # 3. Extract official gallery elements from DOM
        dom_elements = page.eval_on_selector_all(
            "[data-testid='sub-section-images'] a[href*='/mediaviewer/rm'] img, "
            "[data-testid='section-images'] a[href*='/mediaviewer/rm'] img, "
            "a[href*='/mediaviewer/rm'] img",
            """elements => elements.map(el => ({
                url: el.src || el.getAttribute("data-src"),
                caption: el.alt && el.alt.toLowerCase() !== "view poster" ? el.alt : null,
                width: el.naturalWidth || parseInt(el.getAttribute("width") || 0) || null,
                height: el.naturalHeight || parseInt(el.getAttribute("height") || 0) || null
            }))"""
        )

        # 4. Merge metadata (prioritizing true captions and high dimensions from GraphQL / Next.js)
        all_metadata = {}
        for item in (next_data_items + graphql_items):
            curl = clean_imdb_image_url(item["url"])
            if curl not in all_metadata or (item["caption"] and not all_metadata[curl].get("caption")):
                all_metadata[curl] = item

        # 5. Enrich DOM elements to produce final master photo list
        final_items = []
        seen = set()
        for el in dom_elements:
            if not el.get("url"):
                continue
            curl = clean_imdb_image_url(el["url"])
            if curl in seen:
                continue
            seen.add(curl)

            meta = all_metadata.get(curl, {})
            caption = meta.get("caption") or el.get("caption")
            width = meta.get("width") or el.get("width")
            height = meta.get("height") or el.get("height")

            final_items.append({
                "url": curl,
                "type": "IMAGE",
                "mimeType": "image/jpeg",
                "title": caption,
                "width": width,
                "height": height,
                "metadata": {"source": "gallery_dom"}
            })

        # Append any additional items captured via GraphQL / Next.js that weren't in DOM
        for item in (graphql_items + next_data_items):
            if not item.get("url"):
                continue
            curl = clean_imdb_image_url(item["url"])
            if curl in seen:
                continue
            seen.add(curl)
            final_items.append({
                "url": curl,
                "type": "IMAGE",
                "mimeType": "image/jpeg",
                "title": item.get("caption"),
                "width": item.get("width"),
                "height": item.get("height"),
                "metadata": {"source": "graphql_intercept"}
            })

        return final_items

    finally:
        try:
            page.close()
        except Exception:
            pass

# ---------------------------------------------------------------------------
# Export & Manifest Updaters
# ---------------------------------------------------------------------------

def save_title_gallery(title_id: str, title_name: str, items: List[Dict], duration_ms: int):
    """Saves docs/titles/{title_id}.json and updates docs/titles.json and docs/gallery.json."""
    os.makedirs(TITLES_DIR, exist_ok=True)
    os.makedirs(DOCS_DIR, exist_ok=True)

    timestamp = int(time.time() * 1000)
    entity_type = "name" if title_id.startswith("nm") else "title"
    target_url = f"https://www.imdb.com/{entity_type}/{title_id}/mediaindex/"

    # 1. Save docs/titles/{title_id}.json
    title_payload = {
        "id": title_id,
        "name": title_name,
        "targetUrl": target_url,
        "items": items,
        "durationMs": duration_ms,
        "timestamp": timestamp
    }
    title_file = os.path.join(TITLES_DIR, f"{title_id}.json")
    with open(title_file, "w", encoding="utf-8") as f:
        json.dump(title_payload, f, indent=4, ensure_ascii=False)

    # 2. Update docs/titles.json registry
    existing_registry = []
    if os.path.exists(TITLES_JSON_PATH):
        try:
            with open(TITLES_JSON_PATH, "r", encoding="utf-8") as f:
                existing_registry = json.load(f)
        except Exception:
            existing_registry = []

    poster_url = items[0]["url"] if items else None
    new_entry = {
        "id": title_id,
        "name": title_name,
        "targetUrl": target_url,
        "itemCount": len(items),
        "posterUrl": poster_url,
        "file": f"titles/{title_id}.json",
        "lastUpdated": timestamp
    }

    # Prepend new entry, replace if existing
    updated_registry = [new_entry] + [t for t in existing_registry if t.get("id") != title_id]
    with open(TITLES_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(updated_registry, f, indent=4, ensure_ascii=False)

    # 3. Write legacy docs/gallery.json for backwards compatibility
    gallery_payload = {
        "targetUrl": target_url,
        "items": items,
        "durationMs": duration_ms,
        "strategyUsed": "NETWORK_SNIFFER",
        "timestamp": timestamp
    }
    with open(GALLERY_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(gallery_payload, f, indent=4, ensure_ascii=False)

    log(f"💾 [SAVED] {title_name} ({len(items)} photos) -> {title_file}")

# ---------------------------------------------------------------------------
# Main Execution CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="IMDb MediaViewer Scraper (Python)")
    parser.add_argument("-i", "--input", help="Path to input text file containing IMDb links or queries")
    parser.add_argument("-f", "--force", action="store_true", help="Force re-scrape existing titles")
    parser.add_argument("query", nargs="*", help="Optional free-text title name, URL, or IMDb ID")
    args = parser.parse_args()

    log("================================================================")
    log("🚀 Starting IMDb Media Scraper (Python Edition)")
    log("================================================================")

    if args.force:
        log("⚡ [FORCE] Force re-scrape active: existing titles will be re-scraped and updated.")

    raw_input = ""
    if args.input:
        if not os.path.exists(args.input):
            log(f"❌ Input file not found: {args.input}", file=sys.stderr)
            sys.exit(1)
        with open(args.input, "r", encoding="utf-8") as f:
            raw_input = f.read()
    elif args.query:
        raw_input = " ".join(args.query)
    else:
        raw_input = "https://www.imdb.com/title/tt0038650/"

    extracted_titles = extract_imdb_titles_from_text(raw_input)
    if not extracted_titles:
        log("❌ No valid IMDb IDs, titles, or links found in input text!", file=sys.stderr)
        sys.exit(1)

    log("\n================================================================")
    log(f"📋 Discovered {len(extracted_titles)} Unique IMDb Titles from Input:")
    log("================================================================")
    for idx, (tid, name) in enumerate(extracted_titles, start=1):
        log(f" [{idx:3d}] {tid} — {name}")
    log("================================================================\n")

    # Filter out already scraped titles unless --force is set
    titles_to_scrape = []
    for tid, name in extracted_titles:
        title_file = os.path.join(TITLES_DIR, f"{tid}.json")
        if not args.force and os.path.exists(title_file) and os.path.getsize(title_file) > 500:
            log(f"⏩ [SKIP] {name} ({tid}) already scraped.")
        else:
            titles_to_scrape.append((tid, name))

    if not titles_to_scrape:
        log("\n✨ All titles are already scraped and up-to-date!")
        log("💡 Pass --force to re-scrape.")
        sys.exit(0)

    log(f"⚡ Starting scrape for {len(titles_to_scrape)} title(s)...\n")
    success_count = 0
    fail_count = 0

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-setuid-sandbox"
            ]
        )
        try:
            context = browser.new_context(
                user_agent=USER_AGENT,
                viewport={"width": 1440, "height": 900}
            )
            # Bypass navigator.webdriver detection for AWS WAF
            context.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

            for idx, (tid, name) in enumerate(titles_to_scrape, start=1):
                log(f"🎬 [{idx}/{len(titles_to_scrape)}] Scraping gallery for {name} ({tid})...")
                start_time = time.time()
                try:
                    items = scrape_single_title_gallery(context, tid, name)
                    duration_ms = int((time.time() - start_time) * 1000)
                    if items:
                        save_title_gallery(tid, name, items, duration_ms)
                        success_count += 1
                    else:
                        log(f"⚠️ [{idx}/{len(titles_to_scrape)}] [EMPTY] No media images found for {name} ({tid})")
                        fail_count += 1
                except Exception as e:
                    log(f"❌ [{idx}/{len(titles_to_scrape)}] [ERROR] Failed to scrape {name} ({tid}): {e}", file=sys.stderr)
                    fail_count += 1

                # Polite pause between titles
                time.sleep(0.3)
        finally:
            browser.close()

    log("\n================================================================")
    log("🎉 Scraping Finished!")
    log(f"   - Successfully scraped: {success_count} title(s)")
    log(f"   - Skipped / Failed:     {fail_count} title(s)")
    log(f"   - Total input titles:   {len(extracted_titles)}")
    log("================================================================")

if __name__ == "__main__":
    main()
