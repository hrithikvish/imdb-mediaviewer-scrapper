# AGENTS.md — Contributor & AI Agent Guide

Welcome to the **IMDb MediaViewer Scrapper & Gallery** repository. This document serves as the primary technical guide for AI agents, developers, and automated tools working on this codebase.

---

## 📌 1. Project Overview & Architecture

This repository is a Python scraper and static web application designed to extract and showcase full master-resolution photos, production stills, and posters from IMDb title galleries (`tt...`) and person galleries (`nm...`).

### Key Capabilities
- **Original Master Asset Extraction**: Cleans IMDb's dynamic resize and crop parameters down to uncompressed original master image URLs (often 2000px+ up to 4K).
- **Partitioned Static Architecture**: Stores extracted media in dedicated per-title JSON files (`docs/titles/{titleId}.json`) and indexes them in a lightweight registry (`docs/titles.json`).
- **Code and Data on Separate Branches**: `main` holds code only. Scraped data lives on the orphan `data` branch at the same `docs/` paths (gitignored on `main`); CI merges both into the Pages artifact, so the site still serves `titles.json` and `titles/*.json` from the same origin.
- **Zero-Backend Web Application**: Pure vanilla JS, CSS, and HTML application hosted statically via GitHub Pages from the `docs/` directory.
- **Python Playwright Scraper (`scraper.py`)**: Single-file, unbuffered scraper used locally and in GitHub Actions automation. Resolves titles via IMDb's Suggestion API, scrolls `/mediaindex/` galleries, and reads Next.js / GraphQL media payloads.
- **Wallpaper Studio**: In-browser collage generator (scattered, staggered, strips layouts; Polaroid frames) rendered on `<canvas>` from the same per-title JSON data.

---

## 🗂️ 2. Repository Structure

```
imdb-mediaviewer-scrapper/
├── .github/
│   ├── actions/
│   │   └── setup-scraper/
│   │       └── action.yml           # Shared environment setup composite action (Python, Playwright)
│   └── workflows/
│       ├── deploy-pages.yml         # GitHub Actions CI/CD IMDb scraper & deployment workflow
│       └── sync-subreddits.yml      # GitHub Actions scheduled & manual subreddit sync workflow
├── docs/                             # GitHub Pages static website root
│   ├── index.html                    # Single-page web viewer
│   ├── app.js                        # Client-side routing, filtering, rendering, lightbox, Wallpaper Studio
│   ├── style.css                     # Design system, layout, responsive breakpoints
│   ├── titles.html                   # Redirect to index.html (old catalog URL)
│   ├── titles.json                   # [data branch] Registry index of all scraped titles
│   ├── gallery.json                  # [data branch] Legacy single-title output (backwards compatibility)
│   └── titles/                       # [data branch] Partitioned per-title JSON data
│       ├── tt0056241.json
│       ├── r_MoviePosterPorn.json
│       └── ...                       # 500+ scraped title archives
├── common.py                         # Shared registry synchronization & path constants (stdlib only)
├── data.sh                           # pull | publish gallery data to/from the `data` branch
├── serve.py                          # Local preview server (data read from local disk / data branch)
├── scraper.py                        # Python Playwright scraper for IMDb
├── reddit_scraper.py                 # Python scraper for subreddits (r/MoviePosterPorn, etc.)
├── requirements.txt                  # Python dependencies (playwright)
├── README.md                         # Public repository documentation
└── AGENTS.md                         # Agent instructions & technical reference (this file)
```

---

## 🧩 3. Data Flow & Formats

### Title Data (`docs/titles/{id}.json`)
Each title is saved into its own file under `docs/titles/`:
```json
{
    "id": "tt0056241",
    "name": "The Miracle Worker (1962)",
    "targetUrl": "https://www.imdb.com/title/tt0056241/mediaindex/",
    "items": [
        {
            "url": "https://m.media-amazon.com/images/M/..._V1_.jpg",
            "type": "IMAGE",
            "mimeType": "image/jpeg",
            "title": "Anne Bancroft and Patty Duke in The Miracle Worker (1962)",
            "width": 2100,
            "height": 1723,
            "metadata": {
                "source": "gallery_dom"
            }
        }
    ],
    "durationMs": 1450,
    "timestamp": 1729320000000
}
```

### Registry Manifest (`docs/titles.json`)
List of all titles displayed on the catalog screen:
```json
[
    {
        "id": "tt0056241",
        "name": "The Miracle Worker (1962)",
        "targetUrl": "https://www.imdb.com/title/tt0056241/mediaindex/",
        "itemCount": 247,
        "posterUrl": "https://m.media-amazon.com/images/M/..._V1_.jpg",
        "file": "titles/tt0056241.json",
        "lastUpdated": 1729320000000
    }
]
```

### Image URL Cleaning
IMDb's CDN appends dynamic resizing parameters to image URLs:
```text
Original: https://m.media-amazon.com/images/M/MV5B..._V1_QL75_UX380_CR0,0,380,562_.jpg
Cleaned:  https://m.media-amazon.com/images/M/MV5B..._V1_.jpg
```
The regex `\._V1_.*(\.[a-zA-Z]+)$` $\rightarrow$ `._V1_\1` restores the original uncompressed master asset.

---

## 🎨 4. Frontend & Layout Engine (`docs/`)

The web frontend operates in two primary views:
1. **Catalog View (`#catalog-view`)**: A-Z listing of all scraped titles, each featuring a horizontal photo strip.
2. **Title Gallery View (`#gallery-view`)**: Full gallery view for a single selected title with search and resolution filtering.

### Layout Engines
To prevent photo cropping:
- Rather than forcing photos into square/4:3 boxes with `object-fit: cover`, images maintain their true natural aspect ratio (`width / height`).
- **Single Title Gallery Grid**:
  - Responsive equal-width columns (`.gallery-col`) adapt dynamically to device width (2 columns on mobile, up to 10+ columns on widescreen displays).
  - Variable card height according to each image's true aspect ratio (`aspect-ratio: var(--aspect-ratio)`).
  - Shortest-column greedy bin-packing ensures a balanced, seamless waterfall grid with zero Cumulative Layout Shift (CLS).
- **All Titles Catalog Strip**:
  - Fixed-height horizontal photo strip with CSS variable `--strip-card-height: 130px` (desktop), `118px` (tablet), `105px` (mobile).
  - Card width: `calc(var(--strip-card-height) * var(--aspect-ratio))`.
- **Zero CLS**: Card aspect ratios are calculated upfront in `app.js` using metadata `width` and `height`, preventing Cumulative Layout Shift during lazy loading.

### Lightbox / Carousel
- Click any photo to launch the full-screen carousel (`#lightbox`).
- Supports keyboard navigation: `←` / `→` arrows, `Esc` to close, `Z` for full master resolution view, `C` to copy URL.
- Previews default to $\le 720\text{p}$ (and thumbnails $\le 480\text{p}$) via IMDb CDN on-the-fly resizing (`_UX720_` / `_UY720_` and `_UX480_` / `_UY480_`) for high performance; original master asset loads on demand.

---

## ⚙️ 5. CI/CD & GitHub Actions Automation

The workflow file `.github/workflows/deploy-pages.yml` manages automated batch scraping and GitHub Pages deployments.

### Pipeline
1. **Checkout `main`** (`fetch-depth: 0`). Runs triggered by a push to `data` still check out `main` for code.
2. **`./data.sh pull`** unpacks the `data` branch into `docs/` (needed for the scraper's skip-existing logic and for the deploy).
3. **Scrape** on `workflow_dispatch`, or on an `issues: opened` event whose title starts with `[scrape]` / `[scrape:force]` and whose author is `OWNER`, `MEMBER`, or `COLLABORATOR` (job-level `if`; other issues skip the job). The site's **+** button opens such a pre-filled issue. Issue text reaches the shell only via `env:`, never `${{ }}` interpolation inside `run:`.
4. **`./data.sh publish`** merges with the latest remote `data` branch, rebuilds the registry, commits to `data` with `[skip ci]`, and pushes (5 retries on rejection). CI never commits to `main`.
5. **Upload `docs/`** (code + data) as the Pages artifact and deploy.
6. For issue-triggered runs: comment the added / re-scraped titles on the issue and close it (or comment the failure and leave it open).

### Concurrency & Data Safety
- A single concurrency group (`${{ github.workflow }}`) serializes all runs across `main` and `data`.
- **Newest scrape wins**: when the same title exists locally and on the remote `data` branch, `data.sh` keeps the copy with the larger JSON `timestamp`, never file mtimes. Titles are only added or updated, never deleted.
- **Deterministic Registry Synchronization**: `python3 scraper.py --rebuild-index` scans `docs/titles/*.json` and regenerates `docs/titles.json` and `docs/gallery.json` using the Python standard library only, so registry conflicts are resolved by regeneration, not by merging.
- Deploys triggered by a push to `data` require `data` to be allowed in the `github-pages` environment's deployment branch policy.

---

## 🛠️ 6. Common Developer Commands

### Python Scraper

```bash
# Setup virtual environment
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium

# Scrape a single title by ID or URL
python3 scraper.py "https://www.imdb.com/title/tt0056241/"

# Scrape from input text file
python3 scraper.py --input movies.txt

# Force re-scraping of titles even if already scraped
python3 scraper.py --force --input movies.txt

# Scrape titles in parallel (default 4 workers, one Chromium each); titles stream in as they resolve
python3 scraper.py --workers 8 --input movies.csv

# Rebuild docs/titles.json registry from docs/titles/*.json
python3 scraper.py --rebuild-index
```

### Reddit Scraper

```bash
# Incremental sync (fetch new posts since last run)
python3 reddit_scraper.py --sync --subreddit MoviePosterPorn

# Historical backfill (paginate backwards down to beginning or limit)
python3 reddit_scraper.py --backfill --subreddit MoviePosterPorn --limit 2000

# Multiple subreddits sequentially
python3 reddit_scraper.py --sync --subreddits MoviePosterPorn CinemaPorn
```

### Gallery Data (`data` branch)

```bash
# Fetch the scraped data into docs/ (only needed for local scraping; the preview reads the branch)
./data.sh pull

# Publish locally scraped titles to the data branch (merges with remote, newest scrape wins)
./data.sh publish "chore: add titles"
```

### Local Frontend Preview

```bash
# Code from docs/, gallery data straight from origin/data (falls back to local `data`); no data files on disk
python3 serve.py
# Open http://localhost:8000 — `git fetch origin data` refreshes data without a restart
```

---

## 🚨 7. Rules & Conventions for AI Agents

1. **Do Not Commit or Push Without Explicit User Approval**:
   - Always make edits in the working directory and allow the user to test/verify first.
   - Only execute `git commit` or `git push` when the user explicitly commands it.
2. **Never Break Independent Title Partitioning**:
   - Each title must be stored in `docs/titles/{id}.json`.
   - Never commit gallery data to `main`. `docs/titles/`, `docs/titles.json`, and `docs/gallery.json` belong on the `data` branch (use `./data.sh publish`).
   - Never store full image item arrays directly in `docs/titles.json` — keep `docs/titles.json` strictly as a lightweight catalog index.
3. **Preserve Master URL Cleaning Logic**:
   - `clean_imdb_image_url()` in `scraper.py` is the single source of truth for stripping resize/crop parameters.
   - Never apply resize/crop filters to master assets stored in `items[].url`.
4. **Preserve Uncropped Layout Rules**:
   - Movie gallery grid uses an uncropped responsive masonry layout with equal-width columns and natural variable height proportional to each image's true aspect ratio.
   - Catalog horizontal strips preserve `--strip-card-height` and uncropped aspect ratios.
   - Do not reintroduce fixed square/4:3 boxes with cropping (`object-fit: cover` with fixed aspect-ratios).
   - Always preserve the `--aspect-ratio` calculation.
5. **Keep `--rebuild-index` Free of External Dependencies**:
   - `rebuild_titles_registry()` in `scraper.py` must only use the Python standard library (`os`, `sys`, `json`, `time`, `argparse`).
   - Do not require `playwright` for registry rebuilding.
