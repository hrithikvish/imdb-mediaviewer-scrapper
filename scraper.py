#!/usr/bin/env python3
"""
IMDb MediaViewer Scraper
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
try:
    from playwright.sync_api import sync_playwright, Browser, BrowserContext, Page
except ImportError:
    sync_playwright = None
    Browser = BrowserContext = Page = None

from common import (
    DOCS_DIR,
    TITLES_DIR,
    TITLES_JSON_PATH,
    GALLERY_JSON_PATH,
    USER_AGENT,
    log,
    rebuild_titles_registry,
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

def find_images_block(obj):
    """Finds the main gallery images block with pageInfo and edges in Next.js state."""
    # First, direct check in standard Next.js path: props.pageProps.contentData.data.(title|name).(all_images|images)
    if isinstance(obj, dict):
        try:
            content_data = obj.get("props", {}).get("pageProps", {}).get("contentData", {}).get("data", {})
            for entity_key in ("name", "title"):
                entity = content_data.get(entity_key, {})
                for img_key in ("all_images", "images"):
                    blk = entity.get(img_key)
                    if isinstance(blk, dict) and ("pageInfo" in blk or len(blk.get("edges", [])) > 1):
                        return blk
        except Exception:
            pass

    # Recursive fallback prioritizing blocks with pageInfo and multiple edges
    candidates = []
    def _search(o):
        if isinstance(o, dict):
            for k in ("all_images", "images"):
                if k in o and isinstance(o[k], dict):
                    blk = o[k]
                    if "edges" in blk or "total" in blk:
                        candidates.append(blk)
            for v in o.values():
                _search(v)
        elif isinstance(o, list):
            for item in o:
                _search(item)

    _search(obj)
    # Pick the block with pageInfo and edges first
    for c in candidates:
        if "pageInfo" in c and len(c.get("edges", [])) > 1:
            return c
    for c in candidates:
        if "pageInfo" in c:
            return c
    for c in candidates:
        if len(c.get("edges", [])) > 1:
            return c
    return candidates[0] if candidates else None

def scrape_single_title_gallery(
    context: BrowserContext,
    title_id: str,
    title_name: str,
    timeout_ms: int = 45000
) -> List[Dict]:
    """Scrapes all master images for a title or person using Playwright with GraphQL interception."""
    entity_type = "name" if title_id.startswith("nm") else "title"
    is_person = title_id.startswith("nm")
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
                img_data = entity_data.get("all_images", {}) or entity_data.get("images", {})
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
        page.goto(mediaindex_url, wait_until="load", timeout=timeout_ms)
        # Wait for page to settle past any AWS WAF challenge reload
        for _ in range(20):
            t = page.title()
            if t and "verification" not in t.lower() and "challenge" not in t.lower() and ("photos" in t.lower() or "imdb" in t.lower()):
                break
            page.wait_for_timeout(1000)

        try:
            page.wait_for_selector(
                "a[href*='/mediaviewer/rm'] img, [data-testid='sub-section-images'] img, #__NEXT_DATA__",
                state="attached",
                timeout=15000
            )
        except Exception:
            pass

        # 1. Extract metadata from Next.js __NEXT_DATA__ directly from DOM
        next_data_items = []
        images_block = None
        for _ in range(5):
            try:
                raw_next_data = page.evaluate("() => { const el = document.getElementById('__NEXT_DATA__'); return el ? el.textContent : null; }")
                if raw_next_data:
                    raw_data = json.loads(raw_next_data)
                    images_block = find_images_block(raw_data)
                    if images_block:
                        if images_block.get("total") and not tracker["total"]:
                            tracker["total"] = int(images_block["total"])
                            log(f"   ℹ️ Detected total photos from metadata: {tracker['total']}")
                        traverse_json_for_media(images_block, next_data_items)
                        break
            except Exception:
                page.wait_for_timeout(500)

        # 2. Fast in-page GraphQL pagination
        page_info = images_block.get("pageInfo", {}) if images_block else {}
        edges = images_block.get("edges", []) if images_block else []
        last_cursor = edges[-1].get("cursor") if (edges and isinstance(edges[-1], dict)) else None
        initial_cursor = page_info.get("endCursor") or last_cursor
        has_next = page_info.get("hasNextPage") if "hasNextPage" in page_info else ((tracker.get("total") or 0) > len(edges))

        if has_next and initial_cursor:
            log(f"   🚀 Fast-paginating GraphQL API for {tracker['total'] or 'all'} photos...")
            raw_gql = page.evaluate('''async (args) => {
                const { isPerson, constId, initialCursor } = args;
                let endCursor = initialCursor;
                let hasNext = true;
                const items = [];
                const seen = new Set();
                const operationName = isPerson ? 'NameMediaIndexPagination' : 'TitleMediaIndexPagination';
                const sha256 = isPerson 
                    ? '6590d686f516dbd5ec06eab4efa37b7f8c8ce40b9aacf9b80889969e90c9e826'
                    : '8e72690e71c52fea1216d1c88c4c2d75d8051f2cd3e4d4eb62c169ed8a84e61e';

                let pages = 0;
                while (hasNext && endCursor && pages < 150) {
                    pages++;
                    const variables = {
                        after: endCursor,
                        const: constId,
                        filter: isPerson ? { galleryConstraints: {}, nameConstraints: {}, titleConstraints: {} } : { galleryConstraints: {}, nameConstraints: {} },
                        first: 50,
                        firstFacets: 250,
                        locale: 'en-US',
                        originalTitleText: false
                    };
                    const extensions = {
                        persistedQuery: { sha256Hash: sha256, version: 1 }
                    };
                    const fetchUrl = 'https://caching.graphql.imdb.com/?operationName=' + operationName +
                        '&variables=' + encodeURIComponent(JSON.stringify(variables)) +
                        '&extensions=' + encodeURIComponent(JSON.stringify(extensions));
                        
                    try {
                        const res = await fetch(fetchUrl, {
                            headers: {
                                'content-type': 'application/json',
                                'x-imdb-client-name': 'imdb-web-next-localized',
                                'x-imdb-user-country': 'US',
                                'x-imdb-user-language': 'en-US'
                            }
                        });
                        if (!res.ok) break;
                        const json = await res.json();
                        const imgData = json?.data?.title?.images || json?.data?.name?.images;
                        if (!imgData || !imgData.edges || imgData.edges.length === 0) break;
                        
                        for (const edge of imgData.edges) {
                            const node = edge?.node;
                            if (!node || !node.url) continue;
                            const url = node.url.replace(/\\._V1_.*(\\.[a-zA-Z]+)$/, '._V1_$1');
                            if (seen.has(url)) continue;
                            seen.add(url);
                            items.push({
                                url: url,
                                caption: node.caption?.plainText || null,
                                width: node.width || null,
                                height: node.height || null
                            });
                        }
                        endCursor = imgData.pageInfo?.endCursor;
                        hasNext = imgData.pageInfo?.hasNextPage;
                    } catch (err) {
                        break;
                    }
                }
                return items;
            }''', {'isPerson': is_person, 'constId': title_id, 'initialCursor': initial_cursor})

            if raw_gql:
                graphql_items.extend(raw_gql)
                log(f"   ✨ Collected {len(next_data_items) + len(graphql_items)} photos via Next.js + GraphQL.")

        # 3. Smoothly scroll gallery if we haven't reached the total yet
        total_target = tracker["total"]
        already_collected = len(next_data_items) + len(graphql_items)
        if not total_target or already_collected < total_target:
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
                        return (txt.includes('load more') || txt.includes('see more') || txt === 'more');
                    });
                    if (loadBtn) {
                        loadBtn.click();
                    }

                    // 2. Scroll to bottom to trigger IntersectionObserver
                    window.scrollTo(0, document.body.scrollHeight);
                """)
                page.wait_for_timeout(1000)

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
        json.dump(title_payload, f, indent=2, ensure_ascii=False)

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
        json.dump(updated_registry, f, indent=2, ensure_ascii=False)

    # 3. Write legacy docs/gallery.json for backwards compatibility
    gallery_payload = {
        "targetUrl": target_url,
        "items": items,
        "durationMs": duration_ms,
        "strategyUsed": "NETWORK_SNIFFER",
        "timestamp": timestamp
    }
    with open(GALLERY_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(gallery_payload, f, indent=2, ensure_ascii=False)

    log(f"💾 [SAVED] {title_name} ({len(items)} photos) -> {title_file}")

# ---------------------------------------------------------------------------
# Main Execution CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="IMDb MediaViewer Scraper (Python)")
    parser.add_argument("-i", "--input", help="Path to input text file containing IMDb links or queries")
    parser.add_argument("-f", "--force", action="store_true", help="Force re-scrape existing titles")
    parser.add_argument("--rebuild-index", action="store_true", help="Rebuild docs/titles.json from all docs/titles/*.json")
    parser.add_argument("query", nargs="*", help="Optional free-text title name, URL, or IMDb ID")
    args = parser.parse_args()

    if args.rebuild_index:
        rebuild_titles_registry()
        sys.exit(0)

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
