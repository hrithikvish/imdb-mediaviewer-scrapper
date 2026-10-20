# AGENTS.md — Contributor & AI Agent Guide

Welcome to the **IMDb MediaViewer Scrapper & Gallery** repository. This document serves as the primary technical guide for AI agents, developers, and automated tools working on this codebase.

---

## 📌 1. Project Overview & Architecture

This repository is a Python scraper and static web application designed to extract and showcase full master-resolution photos, production stills, and posters from IMDb title galleries (`tt...`) and person galleries (`nm...`).

### Key Capabilities
- **Original Master Asset Extraction**: Cleans IMDb's dynamic resize and crop parameters down to uncompressed original master image URLs (often 2000px+ up to 4K).
- **Partitioned Static Architecture**: Stores extracted media in dedicated per-title JSON files (`docs/titles/{titleId}.json`) and indexes them in a lightweight registry (`docs/titles.json`).
- **Zero-Backend Web Application**: Pure vanilla JS, CSS, and HTML application hosted statically via GitHub Pages from the `docs/` directory.
- **Python Playwright Scraper (`scraper.py`)**: Single-file, unbuffered scraper used locally and in GitHub Actions automation. Resolves titles via IMDb's Suggestion API, scrolls `/mediaindex/` galleries, and reads Next.js / GraphQL media payloads.
- **Wallpaper Studio**: In-browser collage generator (scattered, staggered, strips layouts; Polaroid frames) rendered on `<canvas>` from the same per-title JSON data.

---

## 🗂️ 2. Repository Structure

```
imdb-mediaviewer-scrapper/
├── .github/
│   └── workflows/
│       └── deploy-pages.yml         # GitHub Actions CI/CD automation workflow
├── docs/                             # GitHub Pages static website root
│   ├── index.html                    # Single-page web viewer
│   ├── app.js                        # Client-side routing, filtering, rendering, lightbox
│   ├── style.css                     # Design system, layout, responsive breakpoints
│   ├── titles.html                   # Redirect to index.html (old catalog URL)
│   ├── titles.json                   # Registry index of all scraped titles
│   ├── gallery.json                  # Legacy single-title output (backwards compatibility)
│   └── titles/                       # Partitioned per-title JSON data
│       ├── tt0056241.json
│       ├── tt0816692.json
│       └── ...                       # 300+ scraped title archives
├── scraper.py                        # Python Playwright scraper (local CLI & CI runner)
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

### Staggered Fixed-Height / Variable-Width Layout
To prevent photo cropping:
- Rather than forcing photos into square/4:3 boxes with `object-fit: cover`, rows have a **fixed height** and items have a **variable width** proportional to each image's true aspect ratio (`width = height * (imageWidth / imageHeight)`).
- **Single Title Gallery Grid**:
  - CSS variable: `--gallery-thumb-height: 220px` (desktop), `190px` (tablet), `150px` (mobile).
  - Width: `calc(var(--gallery-thumb-height) * var(--aspect-ratio))`.
- **All Titles Catalog Strip**:
  - CSS variable: `--strip-card-height: 130px` (desktop), `118px` (tablet), `105px` (mobile).
  - Width: `calc(var(--strip-card-height) * var(--aspect-ratio))`.
- **Zero CLS**: Card widths and aspect ratios are calculated upfront in `app.js` using metadata `width` and `height`, preventing Cumulative Layout Shift during lazy loading.

### Lightbox / Carousel
- Click any photo to launch the full-screen carousel (`#lightbox`).
- Supports keyboard navigation: `←` / `→` arrows, `Esc` to close, `Z` for full master resolution view, `C` to copy URL.
- Previews default to $\le 720\text{p}$ via IMDb CDN on-the-fly resizing (`_UX720_` / `_UY720_`) for high performance; original master asset loads on demand.

---

## ⚙️ 5. CI/CD & GitHub Actions Automation

The workflow file `.github/workflows/deploy-pages.yml` manages automated batch scraping and GitHub Pages deployments.

### Concurrency & Queueing Safety
- **Explicit Branch Checkout**: Uses `actions/checkout@v4` with `ref: ${{ github.ref_name }}` and `fetch-depth: 0`. This prevents queued `workflow_dispatch` runs from checking out stale commits from when the action was initially queued.
- **Deterministic Registry Synchronization**:
  - Running `python3 scraper.py --rebuild-index` scans `docs/titles/*.json` and regenerates `docs/titles.json` and `docs/gallery.json` in $\approx 0.15\text{s}$ using Python standard library only.
  - The commit & push step uses a retry loop with automated rebase conflict resolution: if `docs/titles.json` conflicts during rebase, the rebase resets the shared registry and regenerates it directly from all on-disk `docs/titles/*.json` files, preventing merge failure.

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

# Rebuild docs/titles.json registry from docs/titles/*.json
python3 scraper.py --rebuild-index
```

### Local Frontend Preview

```bash
# Serve docs/ directory locally
python3 -m http.server 8000 -d docs
# Open http://localhost:8000 in your browser
```

---

## 🚨 7. Rules & Conventions for AI Agents

1. **Do Not Commit or Push Without Explicit User Approval**:
   - Always make edits in the working directory and allow the user to test/verify first.
   - Only execute `git commit` or `git push` when the user explicitly commands it.
2. **Never Break Independent Title Partitioning**:
   - Each title must be stored in `docs/titles/{id}.json`.
   - Never store full image item arrays directly in `docs/titles.json` — keep `docs/titles.json` strictly as a lightweight catalog index.
3. **Preserve Master URL Cleaning Logic**:
   - `clean_imdb_image_url()` in `scraper.py` is the single source of truth for stripping resize/crop parameters.
   - Never apply resize/crop filters to master assets stored in `items[].url`.
4. **Preserve Uncropped Staggered Layout Rules**:
   - Do not reintroduce fixed column widths (`grid-template-columns: repeat(...)`) or fixed aspect ratios (`4/3` or `1/1` with `object-fit: cover`) to gallery grids or catalog strips.
   - Always preserve the `--aspect-ratio` calculation and CSS variables `--gallery-thumb-height` / `--strip-card-height`.
5. **Keep `--rebuild-index` Free of External Dependencies**:
   - `rebuild_titles_registry()` in `scraper.py` must only use the Python standard library (`os`, `sys`, `json`, `time`, `argparse`).
   - Do not require `playwright` for registry rebuilding.
