/**
 * IMDb MediaViewer Gallery - Application Logic
 * Supports:
 * - Searchable Catalog of all scraped titles sorted A-Z with horizontal photo strips
 * - Single-title Gallery grid with resolution filters and caption search
 * - Custom Searchable Header Dropdown
 * - Fullscreen HQ Master Lightbox with keyboard navigation
 */

// Application State
let titlesRegistry = [];
const titleGalleryCache = new Map();
let currentView = 'catalog'; // 'catalog' | 'gallery' | 'wallpaper' | 'history'
let selectedTitle = null;
let galleryData = [];
let currentFilter = 'all';
let searchQuery = '';
let currentLightboxIndex = 0;
let titleRowObserver = null;
let catalogScrollY = 0;
const GITHUB_REPO = 'hrithikvish/imdb-mediaviewer-scrapper';
let lastViewedTitleId = null;
let currentKind = 'all';    // gallery photo type tab: 'all' | 'still' | 'poster' | 'bts' | 'event'
let decadeFilter = null;    // catalog: 1990, 'people' or null

// Stills only (experimental, off by default): hide event, poster and behind-the-scenes photos
// in the catalog strips and Wallpaper Studio
const STILLS_KEY = 'imdb_stills_only';
let stillsOnly = (() => {
  try { return localStorage.getItem(STILLS_KEY) === '1'; } catch (e) { return false; }
})();

// Core DOM Elements
const brandGroup = document.querySelector('.brand-group');
const totalCountEl = document.getElementById('total-count');
const counterLabelEl = document.querySelector('.counter-label');
const searchWrapper = document.getElementById('search-wrapper');
const searchInput = document.getElementById('search-input');
const searchClearBtn = document.getElementById('search-clear');
const segmentedControl = document.getElementById('segmented-control');
const filterBtns = segmentedControl ? segmentedControl.querySelectorAll('.seg-btn') : [];
const btnImdbLink = document.getElementById('btn-imdb-link');
const themeToggleBtn = document.getElementById('theme-toggle');
const themeIconMoon = document.getElementById('theme-icon-moon');
const themeIconSun = document.getElementById('theme-icon-sun');

// Views
const catalogView = document.getElementById('catalog-view');
const titlesList = document.getElementById('titles-list');
const galleryView = document.getElementById('gallery-view');
const galleryTitleBar = document.getElementById('gallery-title-bar');
const galleryBackBtn = document.getElementById('gallery-back-btn');
const activeMovieName = document.getElementById('active-movie-name');
const activeMovieCount = document.getElementById('active-movie-count');
const gridContainer = document.getElementById('gallery-grid');

// Wallpaper View Elements & State
const wallpaperView = document.getElementById('wallpaper-view');
const historyView = document.getElementById('history-view');
const btnNavWallpaper = document.getElementById('btn-nav-wallpaper');
const wallpaperBackBtn = document.getElementById('wallpaper-back-btn');
const wallpaperSubtitle = document.getElementById('wallpaper-subtitle');
const btnWallpaperShuffle = document.getElementById('btn-wallpaper-shuffle');
const btnWallpaperRescatter = document.getElementById('btn-wallpaper-rescatter');
const btnWallpaperDownload = document.getElementById('btn-wallpaper-download');
const wallpaperDownloadText = document.getElementById('wallpaper-download-text');
const btnWallpaperFullscreen = document.getElementById('btn-wallpaper-fullscreen');
const wallpaperAspectControl = document.getElementById('wallpaper-aspect-control');
const wallpaperResControl = document.getElementById('wallpaper-res-control');
const wallpaperLayoutControl = document.getElementById('wallpaper-layout-control');
const wallpaperGapControl = document.getElementById('wallpaper-gap-control');
const wallpaperCanvasFrame = document.getElementById('wallpaper-canvas-frame');
const wallpaperCanvas = document.getElementById('wallpaper-canvas');
const wallpaperHoverRect = document.getElementById('wallpaper-hover-rect');
const hoverSwapBtn = document.getElementById('hover-swap-btn');
const wallpaperTooltip = document.getElementById('wallpaper-tooltip');
const wallpaperTooltipTitle = document.getElementById('wallpaper-tooltip-title');
const wallpaperTooltipCaption = document.getElementById('wallpaper-tooltip-caption');
const wallpaperLoader = document.getElementById('wallpaper-loader');
const wallpaperLoaderStatus = document.getElementById('wallpaper-loader-status');
const wallpaperChips = document.getElementById('wallpaper-chips');

// Wallpaper Source Picker Elements
const btnWallpaperSource = document.getElementById('btn-wallpaper-source');
const wallpaperSourceWrapper = document.getElementById('wallpaper-source-wrapper');
const wallpaperSourcePopover = document.getElementById('wallpaper-source-popover');
const wallpaperSourceBtnText = document.getElementById('wallpaper-source-btn-text');
const wallpaperSourceSearch = document.getElementById('wallpaper-source-search');
const wallpaperSourceList = document.getElementById('wallpaper-source-list');
const btnSourceAll = document.getElementById('btn-source-all');
const btnSourceClear = document.getElementById('btn-source-clear');
const btnSourceApply = document.getElementById('btn-source-apply');
const sourceSelectedCount = document.getElementById('source-selected-count');
const wallpaperSelectedSources = document.getElementById('wallpaper-selected-sources');
const selectedSourcesTags = document.getElementById('selected-sources-tags');
const btnClearSources = document.getElementById('btn-clear-sources');

// Advanced scattered-layout settings. Defaults reproduce the stock layout.
const SCATTER_DEFAULTS = {
  count: null,      // photos; null = 24 landscape / 20 portrait
  sizeVariety: 10,  // % linear size spread around the average photo
  coverage: 125,    // % of canvas area covered by photos in total
  overlap: 100,     // % penalty for overlapping an already covered spot
  tilt: 5,          // max rotation in degrees
  bleed: 25,        // % of a photo allowed past the canvas edge
};
const SCATTER_MAX_COUNT = 40;
// Advanced row is hidden for now; flip to true to bring it back (saved tweaks are ignored while false)
const SCATTER_ADVANCED_ENABLED = false;
const SCATTER_SETTINGS_KEY = 'imdb_wallpaper_scatter';

function loadScatterSettings() {
  if (!SCATTER_ADVANCED_ENABLED) return { ...SCATTER_DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(SCATTER_SETTINGS_KEY) || 'null');
    if (saved && typeof saved === 'object') return { ...SCATTER_DEFAULTS, ...saved };
  } catch (e) { /* storage blocked or bad JSON: use defaults */ }
  return { ...SCATTER_DEFAULTS };
}

function saveScatterSettings() {
  try {
    localStorage.setItem(SCATTER_SETTINGS_KEY, JSON.stringify(wallpaperState.scatter));
  } catch (e) { /* storage blocked: settings last for this visit only */ }
}

// Raw randoms only; settings turn them into size and tilt, so sliders tweak the same arrangement.
// Seeded, so a shared link's seed rebuilds the exact same arrangement.
function generateScatterVariations(seed = Math.floor(Math.random() * 2 ** 31), count = SCATTER_MAX_COUNT) {
  const rand = mulberry32(seed);
  const variations = [];
  for (let i = 0; i < count; i++) {
    variations.push({
      rotU: rand() * 2 - 1, // -1..1, scaled by tilt
      sizeU: rand(),        // 0..1, scaled by size variety
      seed,
    });
  }
  // Largest first: big photos claim space, smaller ones fill the leftover gaps
  return variations.sort((a, b) => b.sizeU - a.sizeU);
}

// Deterministic PRNG so the same variations give the same layout on re-render
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Greedy gap-filling placement. Returns normalized {nx, ny, area, ratio} per item.
function computeScatterPlacement(vars, ratios, W, H, settings) {
  const rand = mulberry32(vars[0].seed);
  const variety = settings.sizeVariety / 100;
  const bleed = settings.bleed / 100;
  const overlapPenalty = settings.overlap / 100;
  const sizeOf = v => 1 - variety + v.sizeU * 2 * variety;
  const cell = Math.max(W, H) / 64;
  const GW = Math.ceil(W / cell);
  const GH = Math.ceil(H / cell);
  const covered = new Uint8Array(GW * GH);
  const sumSq = vars.reduce((sum, v) => sum + sizeOf(v) ** 2, 0);
  const baseArea = (W * H * settings.coverage / 100) / sumSq; // over 1x so edges and tilt gaps get covered

  return vars.map((v, i) => {
    const ratio = ratios[i];
    const uncovered = [];
    for (let k = 0; k < covered.length; k++) if (!covered[k]) uncovered.push(k);

    let best = null;
    for (let t = 0; t < 200; t++) {
      // Per-try size wiggle (grows with size variety) so a photo can still fit its hole
      const area = baseArea * sizeOf(v) ** 2 * (1 - 1.5 * variety + rand() * 3 * variety);
      const w = Math.min(Math.sqrt(area * ratio), W * 0.8);
      const h = Math.min(w / ratio, H * 0.8);
      let cx, cy;
      if (uncovered.length && t % 2 === 0) {
        // Aim at an empty spot
        const k = uncovered[Math.floor(rand() * uncovered.length)];
        cx = ((k % GW) + 0.5) * cell + (rand() - 0.5) * w * 0.8;
        cy = (Math.floor(k / GW) + 0.5) * cell + (rand() - 0.5) * h * 0.8;
      } else {
        cx = rand() * W;
        cy = rand() * H;
      }
      // Allow some bleed past the edges, never more than the bleed share of the photo
      cx = Math.max(w * (0.5 - bleed), Math.min(W - w * (0.5 - bleed), cx));
      cy = Math.max(h * (0.5 - bleed), Math.min(H - h * (0.5 - bleed), cy));

      const x0 = Math.max(0, Math.floor((cx - w / 2) / cell));
      const x1 = Math.min(GW - 1, Math.floor((cx + w / 2) / cell));
      const y0 = Math.max(0, Math.floor((cy - h / 2) / cell));
      const y1 = Math.min(GH - 1, Math.floor((cy + h / 2) / cell));
      let fresh = 0, overlap = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (covered[y * GW + x]) overlap++; else fresh++;
        }
      }
      const score = fresh - overlap * overlapPenalty;
      if (!best || score > best.score) best = { score, cx, cy, w, h, x0, x1, y0, y1 };
    }

    for (let y = best.y0; y <= best.y1; y++) {
      for (let x = best.x0; x <= best.x1; x++) covered[y * GW + x] = 1;
    }
    return { nx: best.cx / W, ny: best.cy / H, area: (best.w * best.h) / (W * H), ratio };
  });
}

// Polaroid frame geometry: side border is a fraction of the photo's short edge, bottom strip is 5x thicker
const POLAROID_SIDE = 0.045;
const POLAROID_BOTTOM = POLAROID_SIDE * 5;
function polaroidSide(photoW, photoH) {
  return Math.round(Math.min(photoW, photoH) * POLAROID_SIDE);
}

// Ratio of the whole print (photo + frame) for a photo ratio r
function polaroidOuterRatio(r) {
  return r >= 1
    ? (r + 2 * POLAROID_SIDE) / (1 + POLAROID_SIDE + POLAROID_BOTTOM)
    : (1 + 2 * POLAROID_SIDE) / (1 / r + POLAROID_SIDE + POLAROID_BOTTOM);
}

// Inner photo size that fills a print of outerW x outerH
function polaroidInnerSize(r, outerW, outerH) {
  if (r >= 1) {
    const h = outerH / (1 + POLAROID_SIDE + POLAROID_BOTTOM);
    return { w: h * r, h };
  }
  const w = outerW / (1 + 2 * POLAROID_SIDE);
  return { w, h: w / r };
}

let scatterPlacementCache = null;

const wallpaperState = {
  aspect: '16:9', // '16:9', '16:10', '1:1', '9:16' or '9:20'
  resName: '1080p',
  width: 1920,
  height: 1080,
  layout: 'scattered',
  gap: 6,
  frame: null, // 'polaroid' or null
  letterbox: null, // 1.85 or 2.39: photos matted to a projection ratio with black bars
  finish: new Set(), // 'grain', 'halation', 'bw'
  isLoading: false,
  isSwappingSingle: false,
  activeAnimId: null,
  selectedTitleIds: [], // Empty array = all catalog movies
  items: [], // Array of { titleMeta, item, img }
  renderedRects: [],
  currentHoverIndex: -1,
  scatterVariations: generateScatterVariations(),
  scatter: loadScatterSettings(),
};

// Tall phone screens (9:16 classic, 9:20 modern FHD+/QHD+) share the portrait layouts
function isPortraitAspect(aspect) {
  return aspect === '9:16' || aspect === '9:20';
}

function getWallpaperDimensions(aspect, resName) {
  if (aspect === '9:20') {
    switch (resName) {
      case '4k': return { w: 2160, h: 4800 };
      case '2k': return { w: 1440, h: 3200 };
      case '1080p':
      default: return { w: 1080, h: 2400 };
    }
  } else if (aspect === '9:16') {
    switch (resName) {
      case '4k': return { w: 2160, h: 3840 };
      case '2k': return { w: 1440, h: 2560 };
      case '1080p':
      default: return { w: 1080, h: 1920 };
    }
  } else if (aspect === '1:1') {
    switch (resName) {
      case '4k': return { w: 2160, h: 2160 };
      case '2k': return { w: 1440, h: 1440 };
      case '1080p':
      default: return { w: 1080, h: 1080 };
    }
  } else if (aspect === '16:10') {
    switch (resName) {
      case '4k': return { w: 3840, h: 2400 };
      case '2k': return { w: 2560, h: 1600 };
      case '1080p':
      default: return { w: 1920, h: 1200 };
    }
  } else {
    // 16:9
    switch (resName) {
      case '4k': return { w: 3840, h: 2160 };
      case '2k': return { w: 2560, h: 1440 };
      case '1080p':
      default: return { w: 1920, h: 1080 };
    }
  }
}

function updateDownloadButtonLabel() {
  if (!wallpaperDownloadText) return;
  const res = wallpaperState.resName.toUpperCase();
  const asp = wallpaperState.aspect;
  wallpaperDownloadText.textContent = `Download ${res} (${asp})`;
}

// Custom Searchable Dropdown Elements
const customSelectWrapper = document.getElementById('custom-select-wrapper');
const customSelectTrigger = document.getElementById('custom-select-trigger');
const customSelectDropdown = document.getElementById('custom-select-dropdown');
const selectedTitleText = document.getElementById('selected-title-text');
const dropdownSearchInput = document.getElementById('dropdown-search-input');
const dropdownSearchClear = document.getElementById('dropdown-search-clear');
const dropdownOptionsList = document.getElementById('dropdown-options-list');
const legacyTitleSelect = document.getElementById('title-select');

// Lightbox Elements
const lightbox = document.getElementById('lightbox');
const lightboxBackdrop = document.getElementById('lightbox-backdrop');
const lightboxStage = document.querySelector('.lightbox-stage');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxCounter = document.getElementById('lightbox-counter');
const lightboxMovieTitle = document.getElementById('lightbox-movie-title');
const lightboxCaption = document.getElementById('lightbox-caption');
const lightboxFullResBtn = document.getElementById('lightbox-fullres');
const fullResBtnLabel = document.getElementById('fullres-btn-label');
const lightboxDownload = document.getElementById('lightbox-download');
const downloadBtnLabel = document.getElementById('download-btn-label');
const lightboxCopy = document.getElementById('lightbox-copy');
const copyBtnLabel = document.getElementById('copy-btn-label');
const btnClose = document.getElementById('btn-close');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
let isCurrentFullRes = false;
let currentImageLoadId = 0;

/**
 * Returns a bandwidth-efficient preview URL constrained to maxDim (default 480p for thumbnails).
 * Uses IMDb / Amazon Media CDN's on-the-fly resizing engine (_V1_QL75_UX..._ / _V1_QL75_UY..._).
 * Original master uncompressed URL is preserved intact for downloading and full-res view.
 */
function getPreviewImageUrl(url, width, height, maxDim = 480) {
  if (!url || typeof url !== 'string') return url;
  if (!url.includes('m.media-amazon.com/images/M/')) return url;

  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (w > 0 && h > 0 && w <= maxDim && h <= maxDim) return url;

  const isPortrait = w > 0 && h > 0 && h > w;
  const resizeParam = isPortrait ? `UY${maxDim}` : `UX${maxDim}`;

  if (url.includes('._V1_')) {
    return url.replace(/\._V1_.*(\.[a-zA-Z]+)$/, `._V1_QL75_${resizeParam}_$1`);
  }
  const lastDot = url.lastIndexOf('.');
  if (lastDot > 0) {
    return `${url.substring(0, lastDot)}._V1_QL75_${resizeParam}_${url.substring(lastDot)}`;
  }
  return url;
}

// CDN sends Access-Control-Allow-Origin: *, so the wallpaper canvas stays exportable
function preloadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// IMDb captions follow fixed patterns: "X in Film (Year)" for stills, "X at an event for Film (Year)" for events.
// ponytail: caption heuristic (~9.5k events, ~8.6k posters in 141k photos); misses uncaptioned set photos.
const EVENT_CAPTION = /\bat an event for\b|\battend(s|ed|ing)?\b|\bpremiere\b|red carpet|\bfestival\b|\bgala\b|photocall|\barriv(es|ing)\b|\bacademy awards?\b|\boscars\b|golden globe|\bscreening\b|\binterview\b|\bpress (conference|junket|day)\b|comic-con|\bparticipates?\b|\bceremony\b/i;
const BTS_CAPTION = /\bon the set\b|\bset of\b|behind the scenes|\bfilming\b|\bdirect(s|ed|ing|or)\b|\bmaking of\b/i;

// 'still' | 'poster' | 'bts' | 'event', cached on the item
function classifyPhoto(item, titleName = '') {
  if (item._kind) return item._kind;
  const caption = (item.title || '').trim();
  const ratio = item.width && item.height ? item.width / item.height : 0;
  let kind = 'still';
  if (EVENT_CAPTION.test(caption)) kind = 'event';
  else if (BTS_CAPTION.test(caption)) kind = 'bts';
  // Posters carry no people in the caption, just the film name (with or without the year), and are ~2:3 portrait
  else if ((!caption || bareName(caption) === bareName(titleName)) && ratio > 0 && ratio < 0.8) kind = 'poster';
  Object.defineProperty(item, '_kind', { value: kind, enumerable: false });
  return kind;
}

function bareName(name) {
  return (name || '').replace(/\s*\(\d{4}[^)]*\)\s*$/, '').trim().toLowerCase();
}

// Film frames only (for strips and collages): stills that are landscape, since frames always are.
// Drops posters captioned with their cast and portrait publicity shots. Falls back to everything if none.
function isFilmFrame(item, titleName) {
  return classifyPhoto(item, titleName) === 'still' && (!(item.width && item.height) || item.width / item.height >= 1.1);
}

function stillsOf(items, titleName) {
  const stills = items.filter(it => it && it.url && isFilmFrame(it, titleName));
  return stills.length ? stills : items.filter(it => it && it.url);
}

// Short stable id for a photo inside its title (chars 4-20 of the MV5B... id are unique per title)
function photoKey(url) {
  const m = /\/M\/([^.]+)\./.exec(url || '');
  return m ? m[1].slice(4, 20) : '';
}

// ---------------------------------------------------------------------------
// App Initialization
// ---------------------------------------------------------------------------

async function init() {
  if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }
  initTheme();
  setupEventListeners();
  initCustomDropdown();
  await loadTitlesManifest();
}

// ---------------------------------------------------------------------------
// Theme Management
// ---------------------------------------------------------------------------

function initTheme() {
  const savedTheme = localStorage.getItem('imdb_gallery_theme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initialTheme = savedTheme || (prefersDark ? 'dark' : 'dark');
  applyTheme(initialTheme);
}

function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    themeIconMoon.classList.add('hidden');
    themeIconSun.classList.remove('hidden');
    themeToggleBtn.title = 'Switch to Dark Mode';
  } else {
    document.documentElement.removeAttribute('data-theme');
    themeIconMoon.classList.remove('hidden');
    themeIconSun.classList.add('hidden');
    themeToggleBtn.title = 'Switch to Light Mode';
  }
  localStorage.setItem('imdb_gallery_theme', theme);
}

function toggleTheme() {
  const root = document.documentElement;
  const current = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const next = current === 'light' ? 'dark' : 'light';

  // Thousands of cards each animating their own colors made the switch janky; switch instantly.
  // (A View Transition snapshot of this ~24k-node page froze phones for seconds, so none here.)
  root.classList.add('theme-switching');
  applyTheme(next);
  // Wait for the new colors to paint before transitions come back
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
}

// ---------------------------------------------------------------------------
// Manifest & Data Loading
// ---------------------------------------------------------------------------

async function loadTitlesManifest() {
  const cacheBuster = Date.now();
  try {
    const res = await fetch(`titles.json?v=${cacheBuster}`);
    if (res.ok) {
      const data = await res.json();
      // Sort in ascending order by name (A to Z)
      titlesRegistry = (data || []).sort((a, b) => {
        const nameA = (a.name || a.id || '').trim();
        const nameB = (b.name || b.id || '').trim();
        return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
      });
    }
  } catch (err) {
    console.warn('Could not load titles.json:', err);
  }

  renderCatalogFilters();

  // Populate legacy title select for compatibility
  if (legacyTitleSelect) {
    legacyTitleSelect.innerHTML = '';
    titlesRegistry.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.file || `titles/${t.id}.json`;
      opt.dataset.id = t.id;
      opt.textContent = `${t.name || t.id} (${t.itemCount || 0})`;
      legacyTitleSelect.appendChild(opt);
    });
  }

  // Re-render dropdown options
  renderDropdownOptions('');
  updateWallpaperSourceUI();

  // Determine initial view from URL
  const params = new URLSearchParams(window.location.search);
  const requestedView = params.get('view');
  const requestedId = params.get('title');
  const matchingTitle = titlesRegistry.find(t => t.id === requestedId);

  if (requestedView === 'history') {
    switchToHistoryView(false);
  } else if (requestedView === 'wallpaper' && params.get('p')) {
    await restoreSharedWallpaper(params);
  } else if (requestedView === 'wallpaper') {
    if (matchingTitle) {
      wallpaperState.selectedTitleIds = [matchingTitle.id];
      updateWallpaperSourceUI();
    }
    await switchToWallpaperView(false);
  } else if (matchingTitle) {
    await switchToGalleryView(matchingTitle.id, false);
  } else {
    switchToCatalogView(false);
  }
}

// ---------------------------------------------------------------------------
// Custom Searchable Dropdown
// ---------------------------------------------------------------------------

function initCustomDropdown() {
  if (!customSelectTrigger) return;

  // Toggle open / close
  customSelectTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = customSelectWrapper.classList.toggle('open');
    customSelectTrigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    if (isOpen) {
      dropdownSearchInput.value = '';
      dropdownSearchClear.classList.remove('visible');
      renderDropdownOptions('');
      setTimeout(() => dropdownSearchInput.focus(), 60);
    }
  });

  // Dropdown search input
  dropdownSearchInput.addEventListener('input', (e) => {
    const q = e.target.value;
    dropdownSearchClear.classList.toggle('visible', q.trim().length > 0);
    renderDropdownOptions(q);
  });

  dropdownSearchClear.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdownSearchInput.value = '';
    dropdownSearchClear.classList.remove('visible');
    renderDropdownOptions('');
    dropdownSearchInput.focus();
  });

  // Keyboard navigation within dropdown
  dropdownSearchInput.addEventListener('keydown', (e) => {
    const options = Array.from(dropdownOptionsList.querySelectorAll('.dropdown-option'));
    if (!options.length) return;

    const currentHighlighted = dropdownOptionsList.querySelector('.dropdown-option.highlighted');
    let idx = options.indexOf(currentHighlighted);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      idx = (idx + 1) % options.length;
      highlightDropdownOption(options, idx);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      idx = (idx - 1 + options.length) % options.length;
      highlightDropdownOption(options, idx);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (currentHighlighted) {
        currentHighlighted.click();
      } else if (options.length > 0) {
        options[0].click();
      }
    } else if (e.key === 'Escape') {
      closeCustomDropdown();
      customSelectTrigger.focus();
    }
  });

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!customSelectWrapper.contains(e.target)) {
      closeCustomDropdown();
    }
  });
}

function closeCustomDropdown() {
  customSelectWrapper.classList.remove('open');
  customSelectTrigger.setAttribute('aria-expanded', 'false');
}

function highlightDropdownOption(options, index) {
  options.forEach((opt, i) => {
    opt.classList.toggle('highlighted', i === index);
    if (i === index) {
      opt.scrollIntoView({ block: 'nearest' });
    }
  });
}

function renderDropdownOptions(filterText = '') {
  const query = filterText.trim().toLowerCase();
  dropdownOptionsList.innerHTML = '';

  // 1. "All Titles (Catalog)" option
  const showAllMatch = !query || 'all titles catalog overview'.includes(query);
  if (showAllMatch) {
    const allOpt = document.createElement('button');
    allOpt.type = 'button';
    allOpt.className = `dropdown-option ${currentView === 'catalog' ? 'selected' : ''}`;
    allOpt.setAttribute('role', 'option');
    allOpt.setAttribute('aria-selected', currentView === 'catalog');
    allOpt.innerHTML = `
      <span class="dropdown-option-title">📚 All Titles (Catalog)</span>
      <span class="dropdown-option-count">${titlesRegistry.length}</span>
    `;
    allOpt.addEventListener('click', () => {
      closeCustomDropdown();
      if (currentView === 'catalog') {
        window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
      } else {
        switchToCatalogView(true);
      }
    });
    dropdownOptionsList.appendChild(allOpt);

    const separator = document.createElement('div');
    separator.className = 'dropdown-separator';
    dropdownOptionsList.appendChild(separator);
  }

  // 1b. "Wallpaper Studio" option
  const showWallpaperMatch = !query || 'wallpaper studio collage poster 1080p 2k 4k random cinema'.includes(query);
  if (showWallpaperMatch) {
    const wallOpt = document.createElement('button');
    wallOpt.type = 'button';
    wallOpt.className = `dropdown-option ${currentView === 'wallpaper' ? 'selected' : ''}`;
    wallOpt.setAttribute('role', 'option');
    wallOpt.setAttribute('aria-selected', currentView === 'wallpaper');
    wallOpt.innerHTML = `
      <span class="dropdown-option-title">🎨 Wallpaper Studio</span>
      <span class="dropdown-option-count">1080p / 2K</span>
    `;
    wallOpt.addEventListener('click', () => {
      closeCustomDropdown();
      if (currentView === 'wallpaper') {
        window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
      } else {
        switchToWallpaperView(true);
      }
    });
    dropdownOptionsList.appendChild(wallOpt);

    const separator = document.createElement('div');
    separator.className = 'dropdown-separator';
    dropdownOptionsList.appendChild(separator);
  }

  // 2. Filter matching titles
  const matching = titlesRegistry.filter(t => {
    if (!query) return true;
    const name = (t.name || '').toLowerCase();
    const id = (t.id || '').toLowerCase();
    return name.includes(query) || id.includes(query);
  });

  if (matching.length === 0 && !showAllMatch && !showWallpaperMatch) {
    dropdownOptionsList.innerHTML = `
      <div class="dropdown-empty-state">
        No titles found matching "${escapeHtml(filterText)}"
      </div>
    `;
    return;
  }

  matching.forEach((title) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const isSelected = currentView === 'gallery' && selectedTitle && (selectedTitle.id === title.id);
    btn.className = `dropdown-option ${isSelected ? 'selected' : ''}`;
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', isSelected);
    btn.dataset.id = title.id;
    btn.innerHTML = `
      <span class="dropdown-option-title" title="${escapeHtml(title.name || title.id)}">${escapeHtml(title.name || title.id)}</span>
      <span class="dropdown-option-count">${(title.itemCount || 0).toLocaleString()}</span>
    `;
    btn.addEventListener('click', () => {
      closeCustomDropdown();
      switchToGalleryView(title.id, true);
    });
    dropdownOptionsList.appendChild(btn);
  });
}

// ---------------------------------------------------------------------------
// Catalog View: Render All Titles (A-Z) with Horizontal Scroll Rows
// ---------------------------------------------------------------------------

function renderCatalogView() {
  titlesList.innerHTML = '';

  if (titleRowObserver) {
    titleRowObserver.disconnect();
  }

  // IntersectionObserver to lazy-load preview photos per title
  titleRowObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const row = entry.target;
        const titleId = row.dataset.id;
        loadTitleRowPhotos(titleId, row);
        observer.unobserve(row);
      }
    });
  }, {
    rootMargin: '300px 0px',
    threshold: 0.01
  });

  if (titlesRegistry.length === 0) {
    titlesList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎬</div>
        <h3>No Scraped Titles Found</h3>
        <p>Run the scraper workflow to populate titles and their photos.</p>
      </div>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();

  titlesRegistry.forEach(title => {
    const titleName = title.name || title.id;
    const count = title.itemCount || 0;
    const isPerson = title.id.startsWith('nm');
    const imdbLink = title.targetUrl || (isPerson ? `https://www.imdb.com/name/${title.id}/` : `https://www.imdb.com/title/${title.id}/`);

    const row = document.createElement('section');
    row.className = 'title-row';
    row.dataset.id = title.id;
    row.dataset.name = titleName;

    row.innerHTML = `
      <div class="title-row-header">
        <div class="title-row-info">
          <button type="button" class="title-row-title-btn" data-id="${title.id}" title="Open full gallery for ${escapeHtml(titleName)}">
            <span class="title-row-name">${escapeHtml(titleName)}</span>
            <span class="title-row-count">${count.toLocaleString()} photos</span>
          </button>
          <a href="${escapeHtml(imdbLink)}" target="_blank" rel="noopener noreferrer" class="title-row-imdb-link" title="Open ${escapeHtml(titleName)} on IMDb">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            <span>IMDb</span>
          </a>
        </div>
        <div class="title-row-actions">
          <button type="button" class="title-row-view-all" data-id="${title.id}" title="Browse full gallery">
            <span>View Gallery</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="title-row-strip-wrapper">
        <button type="button" class="strip-scroll-btn strip-scroll-prev hidden" aria-label="Scroll photos left" title="Scroll left">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>

        <div class="title-row-strip" tabindex="0" role="region" aria-label="Photos preview for ${escapeHtml(titleName)}">
          ${Array.from({ length: 5 }).map(() => '<div class="strip-skeleton-card"></div>').join('')}
        </div>

        <button type="button" class="strip-scroll-btn strip-scroll-next" aria-label="Scroll photos right" title="Scroll right">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>
    `;

    // Click handler for opening the full gallery from title name or "View Gallery"
    const openGalleryHandler = () => switchToGalleryView(title.id, true);
    row.querySelector('.title-row-title-btn').addEventListener('click', openGalleryHandler);
    row.querySelector('.title-row-view-all').addEventListener('click', openGalleryHandler);

    // Setup scroll button events
    const strip = row.querySelector('.title-row-strip');
    const prevBtn = row.querySelector('.strip-scroll-prev');
    const nextBtn = row.querySelector('.strip-scroll-next');

    const updateScrollButtons = () => {
      const maxScroll = strip.scrollWidth - strip.clientWidth;
      prevBtn.classList.toggle('hidden', strip.scrollLeft <= 5);
      nextBtn.classList.toggle('hidden', strip.scrollLeft >= maxScroll - 5);
    };

    strip.addEventListener('scroll', updateScrollButtons, { passive: true });
    prevBtn.addEventListener('click', () => {
      strip.scrollBy({ left: -360, behavior: 'smooth' });
    });
    nextBtn.addEventListener('click', () => {
      strip.scrollBy({ left: 360, behavior: 'smooth' });
    });

    fragment.appendChild(row);
    titleRowObserver.observe(row);
  });

  titlesList.appendChild(fragment);
  filterCatalogRows();
}

async function loadTitleRowPhotos(titleId, rowElement) {
  const strip = rowElement.querySelector('.title-row-strip');
  const prevBtn = rowElement.querySelector('.strip-scroll-prev');
  const nextBtn = rowElement.querySelector('.strip-scroll-next');
  if (!strip) return;

  try {
    let titleData = titleGalleryCache.get(titleId);
    if (!titleData) {
      const targetTitle = titlesRegistry.find(t => t.id === titleId);
      const jsonPath = targetTitle && targetTitle.file ? targetTitle.file : `titles/${titleId}.json`;
      const res = await fetch(`${jsonPath}?v=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      titleData = await res.json();
      titleGalleryCache.set(titleId, titleData);
    }

    const items = stillsOnly ? stillsOf(titleData.items || [], titleData.name) : (titleData.items || []);
    strip.innerHTML = '';

    if (items.length === 0) {
      strip.innerHTML = `
        <div style="padding: 1.5rem 1rem; color: var(--text-muted); font-size: 0.75rem;">
          No photos found for this title yet.
        </div>
      `;
      prevBtn.classList.add('hidden');
      nextBtn.classList.add('hidden');
      return;
    }

    // Limit preview cards in strip for lightweight DOM (e.g. up to 24 photos)
    const previewItems = items.slice(0, 24);
    const fragment = document.createDocumentFragment();

    previewItems.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'strip-card';
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
      card.setAttribute('aria-label', `View photo ${index + 1} of ${titleData.name || titleId}`);

      const badge = getResolutionBadge(item);
      const caption = item.title || (titleData.name || titleId);
      const previewUrl = getPreviewImageUrl(item.url, item.width, item.height, 480);

      // Staggered horizontal strip: fixed height, variable width matching image aspect ratio (no cropping)
      const width = Number(item.width) || 0;
      const height = Number(item.height) || 0;
      const aspectRatio = (width > 0 && height > 0) ? (width / height) : 1.5;

      card.style.setProperty('--aspect-ratio', aspectRatio.toFixed(4));
      card.style.width = `calc(var(--strip-card-height, 130px) * ${aspectRatio.toFixed(4)})`;

      card.innerHTML = `
        <div class="strip-thumb-wrapper">
          <img class="strip-thumb" src="${previewUrl}" alt="${escapeHtml(caption)}" loading="lazy">
          <span class="strip-badge ${badge.isHigh ? 'high-res' : ''}" title="${badge.dim}">${badge.label}</span>
        </div>
      `;

      const img = card.querySelector('.strip-thumb');
      const onImgLoaded = () => {
        img.classList.add('loaded');
        if (!width || !height) {
          if (img.naturalWidth && img.naturalHeight) {
            const naturalRatio = (img.naturalWidth / img.naturalHeight).toFixed(4);
            card.style.setProperty('--aspect-ratio', naturalRatio);
            card.style.width = `calc(var(--strip-card-height, 130px) * ${naturalRatio})`;
          }
        }
      };

      if (img.complete) {
        onImgLoaded();
      } else {
        img.addEventListener('load', onImgLoaded);
        img.addEventListener('error', () => {
          img.classList.add('loaded');
        });
      }

      // Clicking a photo in the strip opens that photo in the master lightbox
      const openPhoto = () => {
        selectedTitle = titleData;
        galleryData = items;
        currentFilter = 'all';
        openLightbox(index);
      };

      card.addEventListener('click', openPhoto);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openPhoto();
        }
      });

      fragment.appendChild(card);
    });

    // If there are more photos, append a "View all" card
    if (items.length > previewItems.length) {
      const moreCard = document.createElement('div');
      moreCard.className = 'strip-card-more';
      moreCard.setAttribute('role', 'button');
      moreCard.tabIndex = 0;
      moreCard.title = `View all ${items.length} photos`;
      moreCard.innerHTML = `
        <div class="strip-card-more-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
        <span>+${items.length - previewItems.length} more</span>
      `;
      moreCard.addEventListener('click', () => switchToGalleryView(titleId, true));
      fragment.appendChild(moreCard);
    }

    strip.appendChild(fragment);

    // Update scroll buttons state
    setTimeout(() => {
      const maxScroll = strip.scrollWidth - strip.clientWidth;
      prevBtn.classList.toggle('hidden', strip.scrollLeft <= 5);
      nextBtn.classList.toggle('hidden', maxScroll <= 10);
    }, 50);

  } catch (err) {
    console.warn(`Could not load preview photos for ${titleId}:`, err);
    strip.innerHTML = `
      <div style="padding: 1.5rem 1rem; color: var(--text-muted); font-size: 0.75rem;">
        Preview unavailable. Click "View Gallery" to inspect.
      </div>
    `;
    prevBtn.classList.add('hidden');
    nextBtn.classList.add('hidden');
  }
}

function filterCatalogRows() {
  const query = searchQuery.trim().toLowerCase();
  const rows = titlesList.querySelectorAll('.title-row');
  let visibleCount = 0;

  rows.forEach(row => {
    const name = (row.dataset.name || '').toLowerCase();
    const id = (row.dataset.id || '').toLowerCase();
    const matches = (!query || name.includes(query) || id.includes(query))
      && (!decadeFilter || titleDecade(row.dataset.id, row.dataset.name) === decadeFilter);
    row.classList.toggle('hidden', !matches);
    if (matches) visibleCount++;
  });

  if (totalCountEl) {
    totalCountEl.textContent = visibleCount.toLocaleString();
  }
  if (counterLabelEl) {
    counterLabelEl.textContent = visibleCount === 1 ? 'title' : 'titles';
  }

  // Handle empty search results state in catalog
  let catalogEmpty = titlesList.querySelector('.catalog-empty-search');
  if (visibleCount === 0 && rows.length > 0) {
    if (!catalogEmpty) {
      catalogEmpty = document.createElement('div');
      catalogEmpty.className = 'empty-state catalog-empty-search';
      titlesList.appendChild(catalogEmpty);
    }
    catalogEmpty.innerHTML = query ? `
      <div class="empty-icon">🔍</div>
      <h3>No titles match "${escapeHtml(searchQuery)}"</h3>
      <p>Try clearing your search to view all ${titlesRegistry.length} scraped titles.</p>
    ` : `
      <div class="empty-icon">🔍</div>
      <h3>No titles match these filters</h3>
      <p>Try another decade to view more of the ${titlesRegistry.length} scraped titles.</p>
    `;
  } else if (catalogEmpty) {
    catalogEmpty.remove();
  }
}

// ---------------------------------------------------------------------------
// Gallery View: Single Title Full Grid
// ---------------------------------------------------------------------------

async function switchToGalleryView(titleId, updateHistory = true) {
  // If leaving catalog view, remember exact scroll position & title
  if (currentView === 'catalog') {
    catalogScrollY = window.scrollY;
    lastViewedTitleId = titleId;
    if (window.history.replaceState) {
      window.history.replaceState({ view: 'catalog', scrollY: catalogScrollY }, '', window.location.pathname + (window.location.search.includes('title=') ? '' : window.location.search));
    }
  }

  currentView = 'gallery';

  // Toggle views
  catalogView.classList.add('hidden');
  wallpaperView.classList.add('hidden');
  historyView.classList.add('hidden');
  galleryView.classList.remove('hidden');
  if (btnNavWallpaper) btnNavWallpaper.classList.remove('active');
  segmentedControl.classList.remove('hidden');
  searchWrapper.classList.remove('hidden');
  searchInput.placeholder = 'Filter captions...';

  // Ensure gallery page starts right at the top
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });

  // Find metadata
  const titleMeta = titlesRegistry.find(t => t.id === titleId);
  const displayName = titleMeta ? (titleMeta.name || titleMeta.id) : titleId;

  // Update header and title bar
  selectedTitleText.textContent = displayName;
  activeMovieName.textContent = displayName;
  activeMovieCount.textContent = `${(titleMeta ? titleMeta.itemCount || 0 : 0).toLocaleString()} photos`;

  // Update IMDb external link
  if (btnImdbLink) {
    const isPerson = titleId.startsWith('nm');
    const entityType = isPerson ? 'name' : 'title';
    btnImdbLink.href = titleMeta && titleMeta.targetUrl ? titleMeta.targetUrl : `https://www.imdb.com/${entityType}/${titleId}/`;
    btnImdbLink.title = `View on IMDb`;
    btnImdbLink.style.display = 'flex';
  }

  // Update URL history without reloading
  if (updateHistory) {
    const url = new URL(window.location.href);
    url.searchParams.delete('view');
    url.searchParams.set('title', titleId);
    window.history.pushState({ view: 'gallery', titleId }, '', url.toString());
  }

  // Render skeleton while loading
  renderGallerySkeleton();

  // Load Title Gallery JSON
  try {
    let data = titleGalleryCache.get(titleId);
    if (!data) {
      const jsonPath = titleMeta && titleMeta.file ? titleMeta.file : `titles/${titleId}.json`;
      const res = await fetch(`${jsonPath}?v=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} loading ${jsonPath}`);
      data = await res.json();
      titleGalleryCache.set(titleId, data);
    }

    selectedTitle = data;
    galleryData = data.items || [];
    activeMovieCount.textContent = `${galleryData.length.toLocaleString()} photos`;

    const hasStills = galleryData.some(it => classifyPhoto(it, data.name) === 'still');
    currentKind = stillsOnly && hasStills ? 'still' : 'all';
    updateKindTabs();
    renderGrid();
  } catch (err) {
    console.error('Failed to load gallery for', titleId, err);
    gridContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <h3>Could not load gallery</h3>
        <p>${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}

function switchToCatalogView(updateHistory = true) {
  currentView = 'catalog';

  // Toggle views
  galleryView.classList.add('hidden');
  wallpaperView.classList.add('hidden');
  historyView.classList.add('hidden');
  catalogView.classList.remove('hidden');
  if (btnNavWallpaper) btnNavWallpaper.classList.remove('active');
  segmentedControl.classList.add('hidden');
  searchWrapper.classList.remove('hidden');
  searchInput.placeholder = 'Filter titles...';

  // Update header labels
  selectedTitleText.textContent = `All Titles (${titlesRegistry.length})`;
  if (btnImdbLink) {
    btnImdbLink.style.display = 'none';
  }

  // Update URL
  if (updateHistory) {
    const url = new URL(window.location.href);
    url.searchParams.delete('title');
    url.searchParams.delete('view');
    window.history.pushState({ view: 'catalog', scrollY: catalogScrollY }, '', url.toString());
  }

  // Render catalog only if not yet populated (preserves scroll position & loaded preview strips)
  if (!titlesList.children || titlesList.children.length === 0) {
    renderCatalogView();
  } else {
    filterCatalogRows();
  }

  // Restore scroll position to where user was in catalog
  const restoreScroll = () => {
    if (catalogScrollY > 0) {
      window.scrollTo({ top: catalogScrollY, left: 0, behavior: 'instant' });
    } else if (lastViewedTitleId) {
      const targetRow = titlesList.querySelector(`.title-row[data-id="${lastViewedTitleId}"]`);
      if (targetRow) {
        targetRow.scrollIntoView({ block: 'start', behavior: 'instant' });
      }
    }
  };

  restoreScroll();
  requestAnimationFrame(restoreScroll);
}

async function switchToWallpaperView(updateHistory = true) {
  if (currentView === 'catalog') {
    catalogScrollY = window.scrollY;
    if (window.history.replaceState) {
      window.history.replaceState({ view: 'catalog', scrollY: catalogScrollY }, '', window.location.pathname + (window.location.search.includes('title=') ? '' : window.location.search));
    }
  }

  currentView = 'wallpaper';

  // Toggle views
  catalogView.classList.add('hidden');
  galleryView.classList.add('hidden');
  historyView.classList.add('hidden');
  wallpaperView.classList.remove('hidden');

  if (btnNavWallpaper) btnNavWallpaper.classList.add('active');
  segmentedControl.classList.add('hidden');
  searchWrapper.classList.add('hidden');
  selectedTitleText.textContent = 'Wallpaper Studio';

  if (btnImdbLink) {
    btnImdbLink.style.display = 'none';
  }

  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });

  // Update URL history
  if (updateHistory) {
    const url = new URL(window.location.href);
    url.searchParams.delete('title');
    url.searchParams.set('view', 'wallpaper');
    window.history.pushState({ view: 'wallpaper' }, '', url.toString());
  }

  if (totalCountEl) {
    totalCountEl.textContent = wallpaperState.items.length.toString();
  }
  if (counterLabelEl) {
    counterLabelEl.textContent = 'photos';
  }

  syncWallpaperControls();

  // If no wallpaper has been generated yet, generate one automatically
  if (wallpaperState.items.length === 0) {
    await generateWallpaper(true);
  }
}

let currentGalleryColCount = 0;
let galleryResizeTimer = null;

function getGalleryColumnCount() {
  const containerWidth = gridContainer ? gridContainer.clientWidth : 0;
  const w = containerWidth > 0 ? containerWidth : window.innerWidth;
  if (!w || w <= 0) return 4;
  if (w < 520) return 2;
  if (w < 820) return 3;
  if (w < 1180) return 4;
  return 5;
}

function handleGalleryResize() {
  if (currentView !== 'gallery') return;
  const newCols = getGalleryColumnCount();
  if (newCols !== currentGalleryColCount) {
    currentGalleryColCount = newCols;
    renderGrid();
  }
}

function renderGallerySkeleton() {
  const numCols = getGalleryColumnCount();
  currentGalleryColCount = numCols;
  const sampleAspects = [1.33, 0.75, 1.5, 0.67, 1.25, 0.8];

  let html = '';
  for (let c = 0; c < numCols; c++) {
    html += '<div class="gallery-col">';
    for (let r = 0; r < 4; r++) {
      const ratio = sampleAspects[(c * 4 + r) % sampleAspects.length];
      html += `<div class="skeleton-card" style="aspect-ratio: ${ratio};"></div>`;
    }
    html += '</div>';
  }
  gridContainer.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Filtering & Gallery Grid Rendering
// ---------------------------------------------------------------------------

function getFilteredGalleryItems() {
  return galleryData.filter(item => {
    if (!item.url) return false;

    // Search query filter against captions
    const matchesSearch = !searchQuery || (item.title && item.title.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesKind = currentKind === 'all' || classifyPhoto(item, selectedTitle && selectedTitle.name) === currentKind;
    if (!matchesKind) return false;

    // High-res filter (1080p+)
    let matchesResolution = true;
    if (currentFilter === 'high') {
      matchesResolution = (item.width && item.width >= 1080) || (item.height && item.height >= 1080);
    }

    return matchesSearch && matchesResolution;
  });
}

function getResolutionBadge(item) {
  const w = item.width || 0;
  const h = item.height || 0;
  const maxDim = Math.max(w, h);
  const dimStr = (w && h) ? `${w} × ${h} px` : 'Master Image';

  if (maxDim >= 3840) return { label: '4K', isHigh: true, dim: dimStr };
  if (maxDim >= 2560) return { label: '2K', isHigh: true, dim: dimStr };
  if (maxDim >= 1080) return { label: '1080p', isHigh: true, dim: dimStr };
  if (w && h) return { label: `${w}×${h}`, isHigh: false, dim: dimStr };
  return { label: 'HQ', isHigh: false, dim: dimStr };
}

function renderGrid() {
  const filtered = getFilteredGalleryItems();
  gridContainer.innerHTML = '';

  if (totalCountEl) {
    totalCountEl.textContent = filtered.length.toLocaleString();
  }
  if (counterLabelEl) {
    counterLabelEl.textContent = filtered.length === 1 ? 'photo' : 'photos';
  }

  if (filtered.length === 0) {
    if (galleryData.length === 0) {
      gridContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🎬</div>
          <h3>No photos yet</h3>
          <p>Run the scraper workflow to populate photos for this title.</p>
        </div>
      `;
    } else {
      gridContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <h3>No photos match your filter</h3>
          <p>Try clearing your caption search or switching to "All".</p>
        </div>
      `;
    }
    return;
  }

  // Equal-width column masonry: number of columns adapts to device width,
  // card heights vary according to natural image aspect ratios.
  const numCols = getGalleryColumnCount();
  currentGalleryColCount = numCols;

  const colElements = [];
  const colHeights = [];

  for (let c = 0; c < numCols; c++) {
    const col = document.createElement('div');
    col.className = 'gallery-col';
    gridContainer.appendChild(col);
    colElements.push(col);
    colHeights.push(0);
  }

  filtered.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'media-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `View photo ${index + 1}`);

    const badge = getResolutionBadge(item);
    const caption = item.title || (selectedTitle ? (selectedTitle.name || selectedTitle.id) : 'IMDb Master Photo');
    const previewUrl = getPreviewImageUrl(item.url, item.width, item.height, 480);

    const width = Number(item.width) || 0;
    const height = Number(item.height) || 0;
    const aspectRatio = (width > 0 && height > 0) ? (width / height) : 1.5;

    card.style.setProperty('--aspect-ratio', aspectRatio.toFixed(4));

    card.innerHTML = `
      <div class="media-thumb-wrapper" style="--aspect-ratio: ${aspectRatio.toFixed(4)}">
        <img class="media-thumb" src="${previewUrl}" alt="${escapeHtml(caption)}" loading="lazy">
        <span class="card-badge ${badge.isHigh ? 'high-res' : ''}" title="${badge.dim}">${badge.label}</span>
        <div class="card-info">
          <div class="card-title" title="${escapeHtml(caption)}">${escapeHtml(caption)}</div>
        </div>
      </div>
    `;

    const img = card.querySelector('.media-thumb');
    const thumbWrapper = card.querySelector('.media-thumb-wrapper');
    const onImgLoaded = () => {
      img.classList.add('loaded');
      if (!width || !height) {
        if (img.naturalWidth && img.naturalHeight) {
          const naturalRatio = (img.naturalWidth / img.naturalHeight).toFixed(4);
          card.style.setProperty('--aspect-ratio', naturalRatio);
          if (thumbWrapper) {
            thumbWrapper.style.setProperty('--aspect-ratio', naturalRatio);
          }
        }
      }
    };

    if (img.complete) {
      onImgLoaded();
    } else {
      img.addEventListener('load', onImgLoaded);
      img.addEventListener('error', () => {
        img.classList.add('loaded');
      });
    }

    card.addEventListener('click', () => openLightbox(index));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openLightbox(index);
      }
    });

    // Shortest-column greedy bin-packing
    let shortestCol = 0;
    let minH = colHeights[0];
    for (let c = 1; c < numCols; c++) {
      if (colHeights[c] < minH) {
        minH = colHeights[c];
        shortestCol = c;
      }
    }

    colElements[shortestCol].appendChild(card);
    colHeights[shortestCol] += (1 / aspectRatio);
  });
}

// ---------------------------------------------------------------------------
// Lightbox Modal
// ---------------------------------------------------------------------------

function openLightbox(index) {
  const items = currentView === 'gallery' ? getFilteredGalleryItems() : galleryData;
  if (index < 0 || index >= items.length) return;

  currentLightboxIndex = index;
  lightboxImg.classList.remove('loaded');
  if (lightboxStage) {
    lightboxStage.classList.add('is-loading');
  }

  lightbox.classList.add('active');
  document.body.style.overflow = 'hidden';

  updateLightboxContent();
}

function closeLightbox() {
  currentImageLoadId++;
  lightbox.classList.remove('active');
  document.body.style.overflow = '';
  lightboxImg.classList.remove('loaded');
  lightboxImg.src = '';
  if (lightboxStage) {
    lightboxStage.classList.remove('is-loading');
  }
  isCurrentFullRes = false;
}

function updateLightboxContent() {
  const items = currentView === 'gallery' ? getFilteredGalleryItems() : galleryData;
  const item = items[currentLightboxIndex];
  if (!item) return;

  const badge = getResolutionBadge(item);
  const isDownscaled = (item.width && item.width > 720) || (item.height && item.height > 720) || (!item.width && !item.height);

  if (downloadBtnLabel) {
    downloadBtnLabel.textContent = 'Original';
  }

  // Instantly hide previous image and show stage spinner
  lightboxImg.classList.remove('loaded');
  if (lightboxStage) {
    lightboxStage.classList.add('is-loading');
  }

  // Load preview <= 720p by default for fast, lightweight rendering
  const previewUrl = getPreviewImageUrl(item.url, item.width, item.height, 720);
  const loadId = ++currentImageLoadId;

  const preloader = new Image();
  preloader.onload = () => {
    if (loadId !== currentImageLoadId) return;
    lightboxImg.src = previewUrl;
    lightboxImg.classList.add('loaded');
    if (lightboxStage) {
      lightboxStage.classList.remove('is-loading');
    }
  };
  preloader.onerror = () => {
    if (loadId !== currentImageLoadId) return;
    lightboxImg.src = previewUrl;
    lightboxImg.classList.add('loaded');
    if (lightboxStage) {
      lightboxStage.classList.remove('is-loading');
    }
  };
  preloader.src = previewUrl;

  if (preloader.complete && preloader.naturalWidth > 0) {
    lightboxImg.src = previewUrl;
    lightboxImg.classList.add('loaded');
    if (lightboxStage) {
      lightboxStage.classList.remove('is-loading');
    }
  }

  if (isDownscaled) {
    isCurrentFullRes = false;
    if (lightboxFullResBtn) {
      lightboxFullResBtn.classList.remove('active-fullres');
      lightboxFullResBtn.title = `View Full Master Resolution (${badge.dim}) [Z]`;
    }
    if (fullResBtnLabel) {
      fullResBtnLabel.textContent = badge.label && badge.label !== 'HQ' ? `Full-Res (${badge.label})` : 'Full-Res';
    }
  } else {
    // Already served at native uncompressed resolution because native image is <= 720p
    isCurrentFullRes = true;
    if (lightboxFullResBtn) {
      lightboxFullResBtn.classList.add('active-fullres');
      lightboxFullResBtn.title = `Already showing native full resolution (${badge.dim})`;
    }
    if (fullResBtnLabel) {
      fullResBtnLabel.textContent = `Active ${badge.label}`;
    }
  }

  lightboxCounter.textContent = `${currentLightboxIndex + 1} / ${items.length}`;

  const movieName = (item && item._wallpaperTitleMeta)
    ? (item._wallpaperTitleMeta.name || item._wallpaperTitleMeta.id)
    : (selectedTitle ? (selectedTitle.name || selectedTitle.id) : 'IMDb Master Photo');
  lightboxMovieTitle.textContent = movieName;

  const captionText = item.title || movieName;
  const statusPrefix = isDownscaled ? 'Master' : 'Active Master';
  const dims = item.width && item.height ? ` · ${statusPrefix}: ${item.width} × ${item.height}` : '';
  lightboxCaption.textContent = `${captionText}${dims}`;
}

function loadFullResImage() {
  const items = currentView === 'gallery' ? getFilteredGalleryItems() : galleryData;
  const item = items[currentLightboxIndex];
  if (!item || !item.url) return;

  if (isCurrentFullRes) return;
  isCurrentFullRes = true;

  const badge = getResolutionBadge(item);
  const targetLabel = badge.label && badge.label !== 'HQ' ? badge.label : 'Full-Res';

  if (fullResBtnLabel) fullResBtnLabel.textContent = `Loading ${targetLabel}...`;

  const masterImg = new Image();
  const currentToken = currentImageLoadId;
  masterImg.onload = () => {
    if (currentToken !== currentImageLoadId) return;
    if (lightbox.classList.contains('active')) {
      lightboxImg.src = item.url;
      lightboxImg.classList.add('loaded');
      if (lightboxFullResBtn) {
        lightboxFullResBtn.classList.add('active-fullres');
        lightboxFullResBtn.title = `Active Full Resolution (${badge.dim})`;
      }
      if (fullResBtnLabel) fullResBtnLabel.textContent = `Active ${targetLabel}`;
      const dims = item.width && item.height ? ` · Active Master: ${item.width} × ${item.height}` : '';
      const titleObj = (item && item._wallpaperTitleMeta) ? item._wallpaperTitleMeta : selectedTitle;
      const cap = item.title || (titleObj ? (titleObj.name || titleObj.id) : '');
      lightboxCaption.textContent = `${cap}${dims}`;
    }
  };
  masterImg.onerror = () => {
    if (currentToken !== currentImageLoadId) return;
    if (fullResBtnLabel) fullResBtnLabel.textContent = `Full-Res (${targetLabel})`;
    isCurrentFullRes = false;
  };
  masterImg.src = item.url;
}

async function downloadOriginalImage() {
  const items = currentView === 'gallery' ? getFilteredGalleryItems() : galleryData;
  const item = items[currentLightboxIndex];
  if (!item || !item.url) return;

  // Also upgrade the current viewer to the full-res master image
  loadFullResImage();

  if (downloadBtnLabel) downloadBtnLabel.textContent = 'Saving...';

  try {
    const res = await fetch(item.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);

    const titleObj = (item && item._wallpaperTitleMeta) ? item._wallpaperTitleMeta : selectedTitle;
    const movieSlug = (titleObj ? (titleObj.name || titleObj.id) : 'imdb')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .toLowerCase();
    const filename = `${movieSlug}_photo_${currentLightboxIndex + 1}.jpg`;

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

    if (downloadBtnLabel) downloadBtnLabel.textContent = 'Saved!';
    setTimeout(() => {
      if (downloadBtnLabel) downloadBtnLabel.textContent = 'Original';
    }, 1500);
  } catch (err) {
    console.warn('Direct blob download failed, falling back to window.open:', err);
    window.open(item.url, '_blank');
    if (downloadBtnLabel) downloadBtnLabel.textContent = 'Original';
  }
}

async function copyImageUrl() {
  const items = currentView === 'gallery' ? getFilteredGalleryItems() : galleryData;
  const item = items[currentLightboxIndex];
  if (!item || !item.url) return;

  try {
    await navigator.clipboard.writeText(item.url);
    if (lightboxCopy && copyBtnLabel) {
      lightboxCopy.classList.add('copied');
      const originalText = copyBtnLabel.textContent;
      copyBtnLabel.textContent = 'Copied!';
      setTimeout(() => {
        lightboxCopy.classList.remove('copied');
        copyBtnLabel.textContent = originalText;
      }, 1500);
    }
  } catch (err) {
    console.warn('Clipboard write failed:', err);
  }
}

function prevImage() {
  const items = currentView === 'gallery' ? getFilteredGalleryItems() : galleryData;
  if (items.length <= 1) return;
  currentLightboxIndex = (currentLightboxIndex - 1 + items.length) % items.length;
  updateLightboxContent();
}

function nextImage() {
  const items = currentView === 'gallery' ? getFilteredGalleryItems() : galleryData;
  if (items.length <= 1) return;
  currentLightboxIndex = (currentLightboxIndex + 1) % items.length;
  updateLightboxContent();
}

// ---------------------------------------------------------------------------
// Wallpaper Studio: Random Cinema Collage Generator
// ---------------------------------------------------------------------------

function getRequiredSlotCount(layout, aspect = wallpaperState.aspect) {
  if (layout === 'lobby') return 4;
  if (layout === 'poster') return 1;
  if (layout === 'contact' || layout === 'filmstrip') {
    const d = getWallpaperDimensions(aspect, '1080p');
    return getWallpaperLayoutRects(layout, d.w, d.h, 0).length;
  }
  if (isPortraitAspect(aspect)) {
    switch (layout) {
      case 'scattered': return wallpaperState.scatter.count || 20;
      case 'staggered': return 8;
      case 'strips': return 7;
      default: return 20;
    }
  }
  switch (layout) {
    case 'scattered': return wallpaperState.scatter.count || 24;
    case 'staggered': return 10;
    case 'strips': return 7;
    default: return 24;
  }
}

function getWallpaperLayoutRects(layout, W, H, gap, items = []) {
  const rects = [];
  const g = Math.max(0, gap);
  const isPortrait = H > W;

  if (layout === 'scattered') {
    // Gap-filling collage: variable sizes, low overlap, cached so a single swap keeps the rest in place
    const required = getRequiredSlotCount('scattered', isPortrait ? '9:16' : '16:9');
    const n = Math.min(required, items.length || required);
    const vars = (wallpaperState.scatterVariations || generateScatterVariations()).slice(0, n);
    const ratios = vars.map((v, i) => {
      const entry = items[i];
      let ratio = 1.6;
      if (entry && entry.img && entry.img.naturalWidth && entry.img.naturalHeight) {
        ratio = entry.img.naturalWidth / entry.img.naturalHeight;
      } else if (entry && entry.item && entry.item.width && entry.item.height) {
        ratio = Number(entry.item.width) / Number(entry.item.height);
      }
      return Math.max(0.55, Math.min(2.8, ratio));
    });

    // Polaroid: place the whole print (photo + frame) so the thick bottom strip is part of the footprint
    const isPolaroid = wallpaperState.frame === 'polaroid';
    const outerRatios = isPolaroid ? ratios.map(polaroidOuterRatio) : ratios;

    const aspectKey = (W / H).toFixed(3);
    const settings = wallpaperState.scatter;
    const settingsKey = JSON.stringify(settings);
    const c = scatterPlacementCache;
    if (!c || c.vars !== wallpaperState.scatterVariations || c.aspectKey !== aspectKey
      || c.isPolaroid !== isPolaroid || c.settingsKey !== settingsKey || c.placement.length !== n) {
      scatterPlacementCache = {
        vars: wallpaperState.scatterVariations,
        aspectKey,
        isPolaroid,
        settingsKey,
        placement: computeScatterPlacement(vars, outerRatios, W, H, settings),
      };
    }

    scatterPlacementCache.placement.forEach((p, i) => {
      // Swapped photo: keep its spot and area, adapt the shape to the new ratio
      const area = p.area * W * H;
      const outerW = Math.sqrt(area * outerRatios[i]);
      const outerH = outerW / outerRatios[i];
      let w = Math.round(outerW);
      let h = Math.round(outerH);
      const cx = Math.round(p.nx * W);
      let cy = Math.round(p.ny * H);
      if (isPolaroid) {
        const inner = polaroidInnerSize(ratios[i], outerW, outerH);
        w = Math.round(inner.w);
        h = Math.round(inner.h);
        // Photo sits in the upper part of the print: shift its center up from the print center
        cy = Math.round(p.ny * H - outerH / 2 + polaroidSide(w, h) + h / 2);
      }
      rects.push({
        x: cx - Math.round(w / 2),
        y: cy - Math.round(h / 2),
        w,
        h,
        cx,
        cy,
        rot: Number((vars[i].rotU * settings.tilt).toFixed(1)),
        isRotated: true,
        uncropped: true,
      });
    });
  } else if (layout === 'staggered') {
    if (isPortrait) {
      // 9:16 Portrait: 2 vertical columns with 4 items each (8 items total)
      const colCounts = [4, 4];
      const widthRatios = [0.49, 0.51];
      const availW = W - g * (colCounts.length + 1);
      let curX = g;
      let allocatedW = 0;
      let itemIdx = 0;

      colCounts.forEach((count, c) => {
        let colW = Math.round(availW * widthRatios[c]);
        if (c === colCounts.length - 1) {
          colW = availW - allocatedW;
        }

        const availH = H - g * (count + 1);
        const invRatios = [];
        for (let i = 0; i < count; i++) {
          const entry = items[itemIdx + i];
          let ratio = 1.5;
          if (entry && entry.img && entry.img.naturalWidth && entry.img.naturalHeight) {
            ratio = entry.img.naturalWidth / entry.img.naturalHeight;
          } else if (entry && entry.item && entry.item.width && entry.item.height) {
            ratio = Number(entry.item.width) / Number(entry.item.height);
          } else {
            const fallbackPresets = c === 0 ? [1.4, 1.1, 1.5, 1.2] : [1.2, 1.5, 1.1, 1.4];
            ratio = fallbackPresets[i] || 1.3;
          }
          const clampedRatio = Math.min(2.8, Math.max(0.65, ratio));
          invRatios.push(1 / clampedRatio);
        }

        const totalInv = invRatios.reduce((sum, v) => sum + v, 0);
        let curY = g;
        let allocatedH = 0;
        for (let i = 0; i < count; i++) {
          let h = Math.round(availH * (invRatios[i] / totalInv));
          if (i === count - 1) {
            h = availH - allocatedH;
          }
          rects.push({ x: curX, y: curY, w: colW, h });
          curY += h + g;
          allocatedH += h;
          itemIdx++;
        }

        curX += colW + g;
        allocatedW += colW;
      });
    } else {
      // 16:9 Landscape: 4 vertical columns with alternating 2 and 3 items (10 items total)
      const firstEntry = items[0];
      let firstRatio = 1.5;
      if (firstEntry && firstEntry.img && firstEntry.img.naturalWidth && firstEntry.img.naturalHeight) {
        firstRatio = firstEntry.img.naturalWidth / firstEntry.img.naturalHeight;
      } else if (firstEntry && firstEntry.item && firstEntry.item.width && firstEntry.item.height) {
        firstRatio = Number(firstEntry.item.width) / Number(firstEntry.item.height);
      }

      const startWithTwo = firstRatio < 1.35;
      const colCounts = startWithTwo ? [2, 3, 2, 3] : [3, 2, 3, 2];
      const widthRatios = startWithTwo ? [0.22, 0.28, 0.23, 0.27] : [0.27, 0.23, 0.28, 0.22];

      const availW = W - g * (colCounts.length + 1);
      let curX = g;
      let allocatedW = 0;
      let itemIdx = 0;

      colCounts.forEach((count, c) => {
        let colW = Math.round(availW * widthRatios[c]);
        if (c === colCounts.length - 1) {
          colW = availW - allocatedW;
        }

        const availH = H - g * (count + 1);

        const invRatios = [];
        for (let i = 0; i < count; i++) {
          const entry = items[itemIdx + i];
          let ratio = 1.5;
          if (entry && entry.img && entry.img.naturalWidth && entry.img.naturalHeight) {
            ratio = entry.img.naturalWidth / entry.img.naturalHeight;
          } else if (entry && entry.item && entry.item.width && entry.item.height) {
            ratio = Number(entry.item.width) / Number(entry.item.height);
          } else {
            const fallbackPresets = (count === 2)
              ? (c % 2 === 0 ? [1.3, 0.85] : [0.85, 1.3])
              : [1.4, 1.0, 1.5];
            ratio = fallbackPresets[i] || 1.4;
          }

          const clampedRatio = Math.min(2.8, Math.max(0.65, ratio));
          invRatios.push(1 / clampedRatio);
        }

        const totalInv = invRatios.reduce((sum, v) => sum + v, 0);

        let curY = g;
        let allocatedH = 0;
        for (let i = 0; i < count; i++) {
          let h = Math.round(availH * (invRatios[i] / totalInv));
          if (i === count - 1) {
            h = availH - allocatedH;
          }

          rects.push({ x: curX, y: curY, w: colW, h });
          curY += h + g;
          allocatedH += h;
          itemIdx++;
        }

        curX += colW + g;
        allocatedW += colW;
      });
    }
  } else if (layout === 'contact') {
    contactSheetGeometry(W, H).frames.forEach(f => rects.push(roundRect(f)));
  } else if (layout === 'filmstrip') {
    filmstripGeometry(W, H).frames.forEach(f => rects.push(roundRect(f)));
  } else if (layout === 'lobby') {
    const geo = lobbyGeometry(W, H);
    [geo.hero, ...geo.insets].forEach(f => rects.push(roundRect(f)));
  } else if (layout === 'poster') {
    rects.push(roundRect(posterCardGeometry(W, H).photo));
  } else {
    // 'strips'
    if (isPortrait) {
      // 9:16 Portrait Cinema Strips (7 items in 5 tiers: 1, 2, 1, 2, 1)
      const availH = H - g * 6;
      const weightSingle = 1.25;
      const weightDouble = 1.0;
      const totalWeight = weightSingle * 3 + weightDouble * 2;
      const hSingle = Math.round(availH * (weightSingle / totalWeight));
      const hDouble = Math.round(availH * (weightDouble / totalWeight));

      const wFull = W - g * 2;
      const wHalf = Math.floor((W - g * 3) / 2);

      let curY = g;

      // Tier 0 (1 item)
      rects.push({ x: g, y: curY, w: wFull, h: hSingle });
      curY += hSingle + g;

      // Tier 1 (2 items)
      rects.push({ x: g, y: curY, w: wHalf, h: hDouble });
      rects.push({ x: g + wHalf + g, y: curY, w: W - g - (g + wHalf + g), h: hDouble });
      curY += hDouble + g;

      // Tier 2 (1 item)
      rects.push({ x: g, y: curY, w: wFull, h: hSingle });
      curY += hSingle + g;

      // Tier 3 (2 items)
      rects.push({ x: g, y: curY, w: wHalf, h: hDouble });
      rects.push({ x: g + wHalf + g, y: curY, w: W - g - (g + wHalf + g), h: hDouble });
      curY += hDouble + g;

      // Tier 4 (1 item - remaining height)
      const hLast = H - g - curY;
      rects.push({ x: g, y: curY, w: wFull, h: hLast });
    } else {
      // 16:9 Landscape (7 items, 3 horizontal cinematic rows: 2, 3, 2)
      const rowH = Math.floor((H - g * 4) / 3);

      // Row 0 (top 2)
      const y0 = g;
      const h0 = rowH;
      const w0 = Math.floor((W - g * 3) / 2);
      rects.push({ x: g, y: y0, w: w0, h: h0 });
      rects.push({ x: g + w0 + g, y: y0, w: W - g - (g + w0 + g), h: h0 });

      // Row 1 (mid 3)
      const y1 = g + rowH + g;
      const h1 = rowH;
      const w1 = Math.floor((W - g * 4) / 3);
      rects.push({ x: g, y: y1, w: w1, h: h1 });
      rects.push({ x: g + w1 + g, y: y1, w: w1, h: h1 });
      rects.push({ x: g + (w1 + g) * 2, y: y1, w: W - g - (g + (w1 + g) * 2), h: h1 });

      // Row 2 (bot 2)
      const y2 = y1 + rowH + g;
      const h2 = H - g - y2;
      rects.push({ x: g, y: y2, w: w0, h: h2 });
      rects.push({ x: g + w0 + g, y: y2, w: W - g - (g + w0 + g), h: h2 });
    }
  }

  return rects;
}

function drawImageCover(ctx, img, x, y, w, h) {
  if (!img || !img.naturalWidth || !img.naturalHeight) {
    ctx.fillStyle = '#141722';
    ctx.fillRect(x, y, w, h);
    return;
  }

  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const targetAspect = w / h;
  const imageAspect = nw / nh;

  let sx = 0, sy = 0, sw = nw, sh = nh;

  if (imageAspect > targetAspect) {
    // Image is wider than slot: crop horizontal sides
    sw = Math.round(nh * targetAspect);
    sx = Math.round((nw - sw) / 2);
  } else {
    // Image is taller than slot: crop vertical sides
    sh = Math.round(nw / targetAspect);
    sy = Math.round((nh - sh) / 2);
  }

  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

// Letterbox: matte the photo to a wide projection ratio with black bars, inside its own slot
function drawPhoto(ctx, img, x, y, w, h) {
  const lb = wallpaperState.letterbox;
  if (!lb || w / h >= lb) {
    drawImageCover(ctx, img, x, y, w, h);
    return;
  }
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, w, h);
  ctx.shadowColor = 'transparent'; // only the slot casts a shadow, not the picture inside it
  const bandH = w / lb;
  drawImageCover(ctx, img, x, y + (h - bandH) / 2, w, bandH);
}

function drawWallpaperScene(rects, lift = 0) {
  if (!wallpaperCanvas) return;
  const ctx = wallpaperCanvas.getContext('2d');
  if (!ctx) return;

  const W = wallpaperState.width;
  const H = wallpaperState.height;
  wallpaperCanvas.width = W;
  wallpaperCanvas.height = H;

  drawLayoutBackground(ctx, W, H);

  // Scaled gap based on 1080p reference
  const scale = Math.min(W, H) / 1080;
  const scaledGap = Math.round(wallpaperState.gap * scale);
  const items = wallpaperState.items;

  rects.forEach((rect, i) => {
    const entry = items[i];
    if (entry && entry.img) {
      if (rect.isRotated) {
        ctx.save();
        ctx.translate(rect.cx, rect.cy);
        ctx.rotate((rect.rot * Math.PI) / 180);

        const shadowScale = Math.min(W, H) / 1080;
        const liftScale = 1 + lift * 0.035;
        const curW = rect.w * liftScale;
        const curH = rect.h * liftScale;

        // Rich realistic drop shadow (expands dynamically when lifted during flight)
        const baseBlur = 24 + lift * 24;
        const baseOffsetY = 8 + lift * 14;
        ctx.shadowColor = `rgba(0, 0, 0, ${0.72 + lift * 0.15})`;
        ctx.shadowBlur = Math.round(baseBlur * shadowScale);
        ctx.shadowOffsetX = Math.round(3 * shadowScale);
        ctx.shadowOffsetY = Math.round(baseOffsetY * shadowScale);

        // Frame border according to user's gap setting:
        // gap 0: pure uncropped photo casting shadow on black canvas
        // gap 6: 3px crisp white studio border
        // gap 14: 8px photo print frame
        if (wallpaperState.frame === 'polaroid') {
          // Polaroid print: thin sides, thick bottom strip with the movie name
          const side = polaroidSide(curW, curH);
          const bottom = Math.round(Math.min(curW, curH) * POLAROID_BOTTOM);
          ctx.fillStyle = '#f4f1ea';
          ctx.fillRect(-curW / 2 - side, -curH / 2 - side, curW + side * 2, curH + side + bottom);

          ctx.shadowColor = 'transparent';
          drawPhoto(ctx, entry.img, -curW / 2, -curH / 2, curW, curH);

          const label = (entry.titleMeta && (entry.titleMeta.name || entry.titleMeta.id)) || '';
          if (label) {
            const maxTextW = curW - side * 2;
            let fontSize = Math.round(bottom * 0.62);
            ctx.font = `600 ${fontSize}px Caveat, 'Segoe Print', cursive`;
            const textW = ctx.measureText(label).width;
            if (textW > maxTextW) {
              fontSize = Math.max(8, Math.floor(fontSize * maxTextW / textW));
              ctx.font = `600 ${fontSize}px Caveat, 'Segoe Print', cursive`;
            }
            ctx.fillStyle = '#2b2b30';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, 0, curH / 2 + bottom / 2, maxTextW);
          }
        } else if (scaledGap > 0) {
          const borderThick = (wallpaperState.gap >= 14) ? Math.round(8 * shadowScale) : Math.round(3 * shadowScale);
          ctx.fillStyle = '#f8f8f6';
          ctx.fillRect(-curW / 2 - borderThick, -curH / 2 - borderThick, curW + borderThick * 2, curH + borderThick * 2);

          // Clear shadow to draw clean crisp uncropped image
          ctx.shadowColor = 'transparent';
          drawPhoto(ctx, entry.img, -curW / 2, -curH / 2, curW, curH);
        } else {
          drawPhoto(ctx, entry.img, -curW / 2, -curH / 2, curW, curH);
          ctx.shadowColor = 'transparent';
        }

        ctx.restore();
      } else {
        drawPhoto(ctx, entry.img, rect.x, rect.y, rect.w, rect.h);
      }
    } else {
      ctx.fillStyle = '#161922';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
  });

  drawLayoutOverlay(ctx, W, H, rects);
  applyFinish(ctx, W, H);
}

const SCATTER_UNITS = { count: '', sizeVariety: '%', coverage: '%', overlap: '%', tilt: '°', bleed: '%' };

// Push current scatter settings into the Advanced sliders and their value labels
function syncScatterControls() {
  const grid = document.getElementById('wallpaper-advanced-grid');
  if (!grid) return;
  grid.querySelectorAll('input[data-setting]').forEach(input => {
    const key = input.dataset.setting;
    const value = key === 'count' ? getRequiredSlotCount('scattered') : wallpaperState.scatter[key];
    input.value = value;
    const out = grid.querySelector(`output[data-for="${key}"]`);
    if (out) out.textContent = `${value}${SCATTER_UNITS[key]}`;
  });
}

// Photo count changed: fetch more photos if needed, otherwise just re-layout
async function applyScatterCount() {
  if (wallpaperState.layout !== 'scattered') return;
  if (wallpaperState.items.length < getRequiredSlotCount('scattered')) {
    await generateWallpaper(false);
  } else {
    animateScatterTweak();
  }
}

function renderWallpaperCanvas() {
  if (wallpaperState.activeAnimId) {
    cancelAnimationFrame(wallpaperState.activeAnimId);
    wallpaperState.activeAnimId = null;
  }

  const W = wallpaperState.width;
  const H = wallpaperState.height;
  const scale = Math.min(W, H) / 1080;
  const scaledGap = Math.round(wallpaperState.gap * scale);
  const items = wallpaperState.items;
  const rects = getWallpaperLayoutRects(wallpaperState.layout, W, H, scaledGap, items);
  wallpaperState.renderedRects = rects;
  hideWallpaperHover();

  drawWallpaperScene(rects, 0);
  renderWallpaperChips();
  ensureCanvasFont();
  scheduleHistoryRecord();
}

function renderWallpaperChips() {
  if (!wallpaperChips) return;
  wallpaperChips.innerHTML = '';

  const activeCount = wallpaperState.renderedRects && wallpaperState.renderedRects.length > 0
    ? Math.min(wallpaperState.renderedRects.length, wallpaperState.items.length)
    : wallpaperState.items.length;
  const activeEntries = wallpaperState.items.slice(0, activeCount);

  const movieMap = new Map();
  activeEntries.forEach(entry => {
    if (entry && entry.titleMeta && !movieMap.has(entry.titleMeta.id)) {
      movieMap.set(entry.titleMeta.id, entry.titleMeta);
    }
  });

  if (movieMap.size === 0) {
    wallpaperChips.innerHTML = '<span style="color:var(--text-muted);font-size:0.75rem;">No movies loaded yet</span>';
    return;
  }

  const fragment = document.createDocumentFragment();
  movieMap.forEach((meta) => {
    const chip = document.createElement('a');
    chip.className = 'movie-chip';
    chip.href = `?title=${encodeURIComponent(meta.id)}`;
    chip.title = `Open full gallery for ${meta.name || meta.id}`;

    chip.innerHTML = `
      <span class="movie-chip-name">${escapeHtml(meta.name || meta.id)}</span>
      <span class="movie-chip-arrow">↗</span>
    `;

    chip.addEventListener('click', (e) => {
      e.preventDefault();
      switchToGalleryView(meta.id, true);
    });

    fragment.appendChild(chip);
  });

  wallpaperChips.appendChild(fragment);

  if (wallpaperSubtitle) {
    const asp = wallpaperState.aspect;
    const res = wallpaperState.resName.toUpperCase();
    if (wallpaperState.selectedTitleIds && wallpaperState.selectedTitleIds.length === 1) {
      const meta = titlesRegistry.find(t => t.id === wallpaperState.selectedTitleIds[0]);
      const titleName = meta ? (meta.name || meta.id) : 'Selected Title';
      wallpaperSubtitle.textContent = `${activeCount} stills from "${titleName}" (${res} • ${asp})`;
    } else if (wallpaperState.selectedTitleIds && wallpaperState.selectedTitleIds.length > 1) {
      wallpaperSubtitle.textContent = `${activeCount} stills from ${wallpaperState.selectedTitleIds.length} selected titles (${res} • ${asp})`;
    } else {
      wallpaperSubtitle.textContent = `${activeCount} stills from ${movieMap.size} titles (${res} • ${asp})`;
    }
  }
}

async function fetchRandomWallpaperItems(count, titleIds = wallpaperState.selectedTitleIds) {
  if (!titlesRegistry || !titlesRegistry.length) return [];

  // Check if specific titles are selected by user (or one film for single-film layouts)
  if (titleIds && titleIds.length > 0) {
    const selectedMetas = titleIds
      .map(id => titlesRegistry.find(t => t.id === id))
      .filter(Boolean);

    if (selectedMetas.length > 0) {
      // Load gallery data for all selected titles
      const loadedGalleries = await Promise.all(
        selectedMetas.map(async (titleMeta) => {
          try {
            let data = titleGalleryCache.get(titleMeta.id);
            if (!data) {
              const jsonPath = titleMeta.file || `titles/${titleMeta.id}.json`;
              const res = await fetch(`${jsonPath}?v=${Date.now()}`);
              if (res.ok) {
                data = await res.json();
                titleGalleryCache.set(titleMeta.id, data);
              }
            }

            if (data && data.items && data.items.length > 0) {
              const itemsToUse = wallpaperPhotoPool(data);
              return { titleMeta, items: itemsToUse };
            }
          } catch (e) {
            console.warn('Error fetching selected title items for wallpaper:', titleMeta.id, e);
          }
          return { titleMeta, items: [] };
        })
      );

      const activePools = loadedGalleries.filter(g => g.items.length > 0);
      if (activePools.length > 0) {
        // Create shuffled copies of each title's items
        const pools = activePools.map(p => {
          const shuffled = [...p.items];
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
          return { titleMeta: p.titleMeta, items: shuffled, cursor: 0 };
        });

        // Round-robin pick distinct photos distributed across selected titles
        const results = [];
        let pIdx = 0;
        while (results.length < count && pools.some(p => p.items.length > 0)) {
          const pool = pools[pIdx % pools.length];
          if (pool.items.length > 0) {
            const item = pool.items[pool.cursor % pool.items.length];
            pool.cursor++;
            results.push({
              titleMeta: pool.titleMeta,
              item,
            });
          }
          pIdx++;
          if (pIdx > count * 8) break;
        }

        return results.slice(0, count);
      }
    }
  }

  // Default: Shuffle and select random titles across the full catalog
  const pool = [...titlesRegistry];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const selectedTitles = pool.slice(0, Math.min(count, pool.length));
  while (selectedTitles.length < count) {
    selectedTitles.push(titlesRegistry[Math.floor(Math.random() * titlesRegistry.length)]);
  }

  const results = [];
  await Promise.all(
    selectedTitles.map(async (titleMeta) => {
      try {
        let data = titleGalleryCache.get(titleMeta.id);
        if (!data) {
          const jsonPath = titleMeta.file || `titles/${titleMeta.id}.json`;
          const res = await fetch(`${jsonPath}?v=${Date.now()}`);
          if (res.ok) {
            data = await res.json();
            titleGalleryCache.set(titleMeta.id, data);
          }
        }

        if (data && data.items && data.items.length > 0) {
          const itemsToUse = wallpaperPhotoPool(data);
          if (itemsToUse.length > 0) {
            const randItem = itemsToUse[Math.floor(Math.random() * itemsToUse.length)];
            results.push({
              titleMeta,
              item: randItem,
            });
          }
        }
      } catch (e) {
        console.warn('Error fetching title items for wallpaper:', titleMeta.id, e);
      }
    })
  );

  return results.slice(0, count);
}

async function generateWallpaper(forceNew = true, filmId = null) {
  if (wallpaperState.isLoading) return;
  wallpaperState.isLoading = true;

  if (btnWallpaperShuffle) {
    btnWallpaperShuffle.classList.add('shuffling');
  }

  if (wallpaperLoader) {
    wallpaperLoader.classList.add('active');
    if (wallpaperLoaderStatus) {
      wallpaperLoaderStatus.textContent = 'Selecting random cinema titles...';
    }
  }

  const neededSlots = getRequiredSlotCount(wallpaperState.layout);

  try {
    if (!forceNew && wallpaperState.items.length >= neededSlots) {
      renderWallpaperCanvas();
      if (wallpaperLoader) wallpaperLoader.classList.remove('active');
      wallpaperState.isLoading = false;
      if (btnWallpaperShuffle) btnWallpaperShuffle.classList.remove('shuffling');
      return;
    }

    if (wallpaperLoaderStatus) {
      wallpaperLoaderStatus.textContent = `Gathering stills for ${neededSlots} collage slots...`;
    }

    let titleIds = wallpaperState.selectedTitleIds;
    if (SINGLE_FILM_LAYOUTS.has(wallpaperState.layout)) {
      // A lobby card shows one film: the given one, a random selected one, or a random film
      const candidates = titleIds.length ? titleIds
        : titlesRegistry.filter(t => t.id.startsWith('tt') && (t.itemCount || 0) >= 8).map(t => t.id);
      titleIds = [filmId || candidates[Math.floor(Math.random() * candidates.length)]];
    }
    const fetchedItems = await fetchRandomWallpaperItems(neededSlots, titleIds);

    if (wallpaperLoaderStatus) {
      wallpaperLoaderStatus.textContent = `Loading high-resolution images...`;
    }

    const previewDim = wallpaperPreviewDim();

    const loadedEntries = await Promise.all(
      fetchedItems.map(async (entry) => {
        const item = entry.item;
        const targetUrl = getPreviewImageUrl(item.url, item.width, item.height, previewDim);
        const img = await preloadImage(targetUrl);
        return {
          titleMeta: entry.titleMeta,
          item: entry.item,
          img: img,
        };
      })
    );

    wallpaperState.items = loadedEntries.filter(e => e.img !== null);
    if (wallpaperState.layout === 'lobby') {
      // The hero slot is wide: lead with the widest still
      const ratio = e => e.img.naturalWidth / e.img.naturalHeight;
      const widest = wallpaperState.items.reduce((best, e, i, all) => (ratio(e) > ratio(all[best]) ? i : best), 0);
      wallpaperState.items.unshift(...wallpaperState.items.splice(widest, 1));
    }
    wallpaperState.scatterVariations = generateScatterVariations();

    renderWallpaperCanvas();

    if (totalCountEl && currentView === 'wallpaper') {
      totalCountEl.textContent = wallpaperState.items.length.toString();
    }
  } catch (err) {
    console.error('Failed to generate wallpaper:', err);
  } finally {
    if (wallpaperLoader) {
      wallpaperLoader.classList.remove('active');
    }
    if (btnWallpaperShuffle) {
      setTimeout(() => btnWallpaperShuffle.classList.remove('shuffling'), 600);
    }
    wallpaperState.isLoading = false;
  }
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// Tween every photo from start to end rect (position, size, tilt), then settle on targetRects.
// liftAmount scales the mid-flight lift: 1 for a full rescatter, smaller for gentle tweaks.
function animateWallpaperRects(animPairs, targetRects, duration, liftAmount = 1) {
  if (wallpaperState.activeAnimId) {
    cancelAnimationFrame(wallpaperState.activeAnimId);
    wallpaperState.activeAnimId = null;
  }
  hideWallpaperHover();

  const startTime = performance.now();

  function animate(now) {
    const elapsed = now - startTime;
    const rawProgress = Math.min(1, elapsed / duration);
    const progress = easeOutCubic(rawProgress);

    // Physical lift curve: peaks at mid-flight, settles at landing
    const lift = Math.sin(rawProgress * Math.PI) * liftAmount;

    // Interpolate every photo rect
    const currentRects = animPairs.map(({ start, end }) => {
      const isRotated = end.isRotated || start.isRotated;
      const rect = {
        ...end,
        x: start.x + (end.x - start.x) * progress,
        y: start.y + (end.y - start.y) * progress,
        w: start.w + (end.w - start.w) * progress,
        h: start.h + (end.h - start.h) * progress,
        isRotated,
      };

      if (isRotated) {
        const startCx = start.cx !== undefined ? start.cx : (start.x + start.w / 2);
        const endCx = end.cx !== undefined ? end.cx : (end.x + end.w / 2);
        const startCy = start.cy !== undefined ? start.cy : (start.y + start.h / 2);
        const endCy = end.cy !== undefined ? end.cy : (end.y + end.h / 2);
        const startRot = start.rot || 0;
        const endRot = end.rot || 0;

        rect.cx = startCx + (endCx - startCx) * progress;
        rect.cy = startCy + (endCy - startCy) * progress;
        rect.rot = startRot + (endRot - startRot) * progress;
      }

      return rect;
    });

    wallpaperState.renderedRects = currentRects;
    drawWallpaperScene(currentRects, lift);

    if (rawProgress < 1) {
      wallpaperState.activeAnimId = requestAnimationFrame(animate);
    } else {
      wallpaperState.activeAnimId = null;
      wallpaperState.renderedRects = targetRects;
      drawWallpaperScene(targetRects, 0);
      renderWallpaperChips();
      scheduleHistoryRecord();
    }
  }

  wallpaperState.activeAnimId = requestAnimationFrame(animate);
}

// Advanced setting changed: glide each slot from where it is drawn now (even mid-animation) to its new spot
function animateScatterTweak() {
  if (wallpaperState.layout !== 'scattered' || !wallpaperState.items.length) return;
  const W = wallpaperState.width;
  const H = wallpaperState.height;
  const scaledGap = Math.round(wallpaperState.gap * Math.min(W, H) / 1080);
  const targetRects = getWallpaperLayoutRects(wallpaperState.layout, W, H, scaledGap, wallpaperState.items);
  const prev = wallpaperState.renderedRects || [];
  const animPairs = targetRects.map((end, i) => ({ start: prev[i] ? { ...prev[i] } : end, end }));
  animateWallpaperRects(animPairs, targetRects, 320, 0.35);
}

function rescatterWallpaper() {
  if (wallpaperState.isLoading || !wallpaperState.items.length || wallpaperState.layout === 'poster') return;

  if (btnWallpaperRescatter) {
    btnWallpaperRescatter.classList.add('rescattering');
    setTimeout(() => btnWallpaperRescatter.classList.remove('rescattering'), 450);
  }

  // Cancel any running animation
  if (wallpaperState.activeAnimId) {
    cancelAnimationFrame(wallpaperState.activeAnimId);
    wallpaperState.activeAnimId = null;
  }

  // 1. Snapshot start rects for each item currently rendered
  const prevRectMap = new Map();
  wallpaperState.items.forEach((entry, i) => {
    if (wallpaperState.renderedRects && wallpaperState.renderedRects[i]) {
      prevRectMap.set(entry, { ...wallpaperState.renderedRects[i] });
    }
  });

  // 2. Shuffle current items array (Fisher-Yates)
  for (let i = wallpaperState.items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [wallpaperState.items[i], wallpaperState.items[j]] = [wallpaperState.items[j], wallpaperState.items[i]];
  }

  // 3. Generate new organic tilt & positional shifts for scattered layout
  wallpaperState.scatterVariations = generateScatterVariations();

  // 4. Calculate target rects for the new arrangement
  const W = wallpaperState.width;
  const H = wallpaperState.height;
  const scale = Math.min(W, H) / 1080;
  const scaledGap = Math.round(wallpaperState.gap * scale);
  const targetRects = getWallpaperLayoutRects(wallpaperState.layout, W, H, scaledGap, wallpaperState.items);

  // 5. Build animation pairs (start -> end for each item)
  // Map over target rects, not items: after an aspect switch there can be more items than slots
  const animPairs = targetRects.map((end, i) => {
    const start = prevRectMap.get(wallpaperState.items[i]) || end;
    return { start, end };
  });

  animateWallpaperRects(animPairs, targetRects, 460, 1);
}

function downloadWallpaper() {
  if (!wallpaperCanvas) return;
  if (wallpaperState.activeAnimId) {
    cancelAnimationFrame(wallpaperState.activeAnimId);
    wallpaperState.activeAnimId = null;
    drawWallpaperScene(wallpaperState.renderedRects, 0);
  }
  const resLabel = wallpaperState.resName.toUpperCase();
  let aspectSlug = 'Landscape_16x9';
  if (wallpaperState.aspect === '9:16') {
    aspectSlug = 'Portrait_9x16';
  } else if (wallpaperState.aspect === '9:20') {
    aspectSlug = 'Portrait_9x20';
  } else if (wallpaperState.aspect === '16:10') {
    aspectSlug = 'Landscape_16x10';
  } else if (wallpaperState.aspect === '1:1') {
    aspectSlug = 'Square_1x1';
  }
  const filename = `IMDb_Wallpaper_${aspectSlug}_${resLabel}_${Date.now()}.jpg`;

  wallpaperCanvas.toBlob((blob) => {
    if (!blob) {
      console.error('Failed to create wallpaper blob');
      return;
    }
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    }, 200);
  }, 'image/jpeg', 0.95);
}

function toggleWallpaperFullscreen() {
  if (!wallpaperCanvasFrame) return;
  if (!document.fullscreenElement) {
    if (wallpaperCanvasFrame.requestFullscreen) {
      wallpaperCanvasFrame.requestFullscreen();
    } else if (wallpaperCanvasFrame.webkitRequestFullscreen) {
      wallpaperCanvasFrame.webkitRequestFullscreen();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }
}

function openWallpaperLightbox(index) {
  if (index < 0 || index >= wallpaperState.items.length) return;
  const entry = wallpaperState.items[index];
  if (!entry) return;

  selectedTitle = entry.titleMeta;
  galleryData = wallpaperState.items.map(e => ({
    ...e.item,
    _wallpaperTitleMeta: e.titleMeta,
  }));

  currentLightboxIndex = index;
  lightboxImg.classList.remove('loaded');
  if (lightboxStage) {
    lightboxStage.classList.add('is-loading');
  }

  lightbox.classList.add('active');
  document.body.style.overflow = 'hidden';

  updateLightboxContent();
}

function pointInRotatedRect(px, py, r) {
  if (!r.isRotated || !r.rot) {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }
  const rad = (r.rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = px - r.cx;
  const dy = py - r.cy;
  const rx = dx * cos + dy * sin;
  const ry = -dx * sin + dy * cos;
  return Math.abs(rx) <= r.w / 2 && Math.abs(ry) <= r.h / 2;
}

function updateHoverRectForIndex(index) {
  if (index < 0 || index >= wallpaperState.items.length) {
    hideWallpaperHover();
    return;
  }
  const rects = wallpaperState.renderedRects;
  if (!rects || !rects[index]) return;

  const entry = wallpaperState.items[index];
  const r = rects[index];
  wallpaperState.currentHoverIndex = index;
  if (wallpaperCanvasFrame) wallpaperCanvasFrame.style.cursor = 'pointer';

  const W = wallpaperCanvas.width;
  const H = wallpaperCanvas.height;

  // Position hover frame box in %
  if (wallpaperHoverRect) {
    if (r.isRotated) {
      const leftPct = (r.cx / W) * 100;
      const topPct = (r.cy / H) * 100;
      const widthPct = (r.w / W) * 100;
      const heightPct = (r.h / H) * 100;

      wallpaperHoverRect.style.left = `${leftPct}%`;
      wallpaperHoverRect.style.top = `${topPct}%`;
      wallpaperHoverRect.style.width = `${widthPct}%`;
      wallpaperHoverRect.style.height = `${heightPct}%`;
      wallpaperHoverRect.style.transform = `translate(-50%, -50%) rotate(${r.rot}deg)`;
      wallpaperHoverRect.classList.add('visible');
    } else {
      const leftPct = (r.x / W) * 100;
      const topPct = (r.y / H) * 100;
      const widthPct = (r.w / W) * 100;
      const heightPct = (r.h / H) * 100;

      wallpaperHoverRect.style.left = `${leftPct}%`;
      wallpaperHoverRect.style.top = `${topPct}%`;
      wallpaperHoverRect.style.width = `${widthPct}%`;
      wallpaperHoverRect.style.height = `${heightPct}%`;
      wallpaperHoverRect.style.transform = 'none';
      wallpaperHoverRect.classList.add('visible');
    }
  }

  // Position Swap Button at Top-Right of photo, guaranteed strictly inside the canvas frame
  if (hoverSwapBtn) {
    let cornerTR_X, cornerTR_Y;
    if (r.isRotated) {
      const rad = ((r.rot || 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const hw = r.w / 2;
      const hh = r.h / 2;

      // Top-right corner of rotated rect in canvas coordinates
      cornerTR_X = r.cx + (hw * cos + hh * sin);
      cornerTR_Y = r.cy + (hw * sin - hh * cos);
    } else {
      cornerTR_X = r.x + r.w;
      cornerTR_Y = r.y;
    }

    const scale = Math.min(W, H) / 1080;
    const inset = 14 * scale;
    const btnW = 86 * scale;
    const btnH = 34 * scale;
    const margin = 12 * scale;

    const targetX = cornerTR_X - inset;
    const targetY = cornerTR_Y + inset;

    // Clamp target coordinates so the button is guaranteed to be completely inside canvas frame
    const clampedX = Math.max(btnW + margin, Math.min(W - margin, targetX));
    const clampedY = Math.max(margin, Math.min(H - btnH - margin, targetY));

    const btnLeftPct = (clampedX / W) * 100;
    const btnTopPct = (clampedY / H) * 100;

    hoverSwapBtn.style.left = `${btnLeftPct.toFixed(2)}%`;
    hoverSwapBtn.style.top = `${btnTopPct.toFixed(2)}%`;
    hoverSwapBtn.classList.add('visible');
  }

  // Update floating tooltip content
  if (wallpaperTooltip && wallpaperTooltipTitle) {
    const titleName = entry.titleMeta ? (entry.titleMeta.name || entry.titleMeta.id) : 'IMDb Title';
    wallpaperTooltipTitle.textContent = titleName;

    const caption = entry.item && entry.item.title ? entry.item.title.trim() : '';
    if (wallpaperTooltipCaption) {
      if (caption && caption.toLowerCase() !== titleName.toLowerCase()) {
        wallpaperTooltipCaption.textContent = caption;
        wallpaperTooltipCaption.style.display = '-webkit-box';
      } else {
        wallpaperTooltipCaption.textContent = '';
        wallpaperTooltipCaption.style.display = 'none';
      }
    }
  }
}

function onWallpaperMouseMove(e) {
  if (wallpaperState.isLoading || wallpaperState.activeAnimId || !wallpaperCanvas || !wallpaperCanvasFrame) return;

  // If hovering directly over the Swap button, preserve the current active photo hover
  if (e.target === hoverSwapBtn || (hoverSwapBtn && hoverSwapBtn.contains(e.target))) {
    return;
  }

  const rects = wallpaperState.renderedRects;
  if (!rects || !rects.length || !wallpaperState.items.length) {
    hideWallpaperHover();
    return;
  }

  const canvasRect = wallpaperCanvas.getBoundingClientRect();
  const frameRect = wallpaperCanvasFrame.getBoundingClientRect();

  const scaleX = wallpaperCanvas.width / canvasRect.width;
  const scaleY = wallpaperCanvas.height / canvasRect.height;
  const mouseCanvasX = (e.clientX - canvasRect.left) * scaleX;
  const mouseCanvasY = (e.clientY - canvasRect.top) * scaleY;

  // Search in reverse so top overlapping photos receive hover first
  let hitIdx = -1;
  for (let i = rects.length - 1; i >= 0; i--) {
    if (pointInRotatedRect(mouseCanvasX, mouseCanvasY, rects[i])) {
      hitIdx = i;
      break;
    }
  }

  if (hitIdx !== -1 && hitIdx < wallpaperState.items.length) {
    updateHoverRectForIndex(hitIdx);

    // Position floating tooltip
    if (wallpaperTooltip) {
      const frameX = e.clientX - frameRect.left;
      const frameY = e.clientY - frameRect.top;

      const clampedX = Math.max(140, Math.min(frameRect.width - 140, frameX));
      const isTopOverflow = frameY < 90;

      wallpaperTooltip.style.left = `${clampedX}px`;
      wallpaperTooltip.style.top = `${frameY}px`;
      wallpaperTooltip.classList.toggle('flip-bottom', isTopOverflow);
      wallpaperTooltip.classList.add('visible');
    }
  } else {
    hideWallpaperHover();
  }
}

function hideWallpaperHover() {
  wallpaperState.currentHoverIndex = -1;
  if (wallpaperCanvasFrame) wallpaperCanvasFrame.style.cursor = '';
  if (wallpaperHoverRect) {
    wallpaperHoverRect.classList.remove('visible');
    wallpaperHoverRect.classList.remove('swapping-flash');
    wallpaperHoverRect.style.transform = 'none';
  }
  if (hoverSwapBtn) {
    hoverSwapBtn.classList.remove('visible');
  }
  if (wallpaperTooltip) wallpaperTooltip.classList.remove('visible');
}

function onWallpaperClick(e) {
  if (wallpaperState.isLoading || wallpaperState.activeAnimId || wallpaperState.isSwappingSingle) return;
  if (wallpaperState.currentHoverIndex !== -1) {
    openWallpaperLightbox(wallpaperState.currentHoverIndex);
  }
}

async function swapSingleWallpaperItem(index) {
  if (wallpaperState.isLoading || wallpaperState.isSwappingSingle || wallpaperState.activeAnimId) return;
  if (index < 0 || index >= wallpaperState.items.length) return;

  wallpaperState.isSwappingSingle = true;
  if (hoverSwapBtn) {
    hoverSwapBtn.classList.add('swapping');
  }

  try {
    const currentEntry = wallpaperState.items[index];
    const currentUrls = new Set(wallpaperState.items.map(e => e && e.item && e.item.url).filter(Boolean));
    const currentItemUrl = currentEntry?.item?.url;

    let chosenTitleMeta = null;
    let chosenItem = null;

    const getGallery = async (meta) => {
      if (!meta) return null;
      let data = titleGalleryCache.get(meta.id);
      if (!data) {
        try {
          const jsonPath = meta.file || `titles/${meta.id}.json`;
          const res = await fetch(`${jsonPath}?v=${Date.now()}`);
          if (res.ok) {
            data = await res.json();
            titleGalleryCache.set(meta.id, data);
          }
        } catch (e) {
          console.warn('Error fetching gallery for single swap:', meta.id, e);
          return null;
        }
      }
      return data;
    };

    // Mode A: User has selected specific source titles (lobby card / polaroid poster: the shown film)
    const sameFilm = SINGLE_FILM_LAYOUTS.has(wallpaperState.layout) || wallpaperState.layout === 'poster';
    const singleFilm = sameFilm && wallpaperState.items[0];
    const sourceIds = singleFilm ? [wallpaperState.items[0].titleMeta.id] : wallpaperState.selectedTitleIds;
    if (sourceIds && sourceIds.length > 0) {
      const selectedMetas = sourceIds
        .map(id => titlesRegistry.find(t => t.id === id))
        .filter(Boolean);

      if (selectedMetas.length > 0) {
        const shuffled = [...selectedMetas].sort(() => Math.random() - 0.5);
        for (const meta of shuffled) {
          const gallery = await getGallery(meta);
          if (gallery && gallery.items && gallery.items.length > 0) {
            const pool = wallpaperPhotoPool(gallery);

            let candidates = pool.filter(it => !currentUrls.has(it.url));
            if (candidates.length === 0) {
              candidates = pool.filter(it => it.url !== currentItemUrl);
            }
            if (candidates.length > 0) {
              chosenTitleMeta = meta;
              chosenItem = candidates[Math.floor(Math.random() * candidates.length)];
              break;
            }
          }
        }
      }
    }

    // Mode B: All catalog random titles
    if (!chosenItem && !singleFilm && titlesRegistry && titlesRegistry.length > 0) {
      const shuffled = [...titlesRegistry].sort(() => Math.random() - 0.5);
      for (const meta of shuffled.slice(0, 10)) {
        const gallery = await getGallery(meta);
        if (gallery && gallery.items && gallery.items.length > 0) {
          const pool = wallpaperPhotoPool(gallery);

          let candidates = pool.filter(it => !currentUrls.has(it.url));
          if (candidates.length === 0) {
            candidates = pool.filter(it => it.url !== currentItemUrl);
          }
          if (candidates.length > 0) {
            chosenTitleMeta = meta;
            chosenItem = candidates[Math.floor(Math.random() * candidates.length)];
            break;
          }
        }
      }
    }

    if (!chosenItem || !chosenTitleMeta) {
      console.warn('Unable to find alternative photo for swap');
      return;
    }

    // Preload replacement image preview
    const previewDim = wallpaperPreviewDim();
    const targetUrl = getPreviewImageUrl(chosenItem.url, chosenItem.width, chosenItem.height, previewDim);
    const newImg = await preloadImage(targetUrl);

    if (!newImg) {
      console.warn('Replacement image failed to load');
      return;
    }

    // Update only the single target slot
    wallpaperState.items[index] = {
      titleMeta: chosenTitleMeta,
      item: chosenItem,
      img: newImg,
    };

    // Recalculate layout rects with updated aspect ratio
    const W = wallpaperState.width;
    const H = wallpaperState.height;
    const scale = Math.min(W, H) / 1080;
    const scaledGap = Math.round(wallpaperState.gap * scale);
    const rects = getWallpaperLayoutRects(wallpaperState.layout, W, H, scaledGap, wallpaperState.items);
    wallpaperState.renderedRects = rects;

    // Redraw canvas with the swapped photo
    drawWallpaperScene(rects, 0);
    renderWallpaperChips();
    scheduleHistoryRecord();

    // Pulse/flash highlight on hover rect to indicate swap completed
    if (wallpaperHoverRect) {
      wallpaperHoverRect.classList.remove('swapping-flash');
      void wallpaperHoverRect.offsetWidth;
      wallpaperHoverRect.classList.add('swapping-flash');
      setTimeout(() => {
        if (wallpaperHoverRect) wallpaperHoverRect.classList.remove('swapping-flash');
      }, 500);
    }

    // Update hover frame and tooltip for the newly swapped image
    if (wallpaperState.currentHoverIndex === index) {
      updateHoverRectForIndex(index);
    }
  } catch (err) {
    console.error('Error swapping single wallpaper image:', err);
  } finally {
    wallpaperState.isSwappingSingle = false;
    if (hoverSwapBtn) {
      hoverSwapBtn.classList.remove('swapping');
    }
  }
}

// ---------------------------------------------------------------------------
// Photo Types, Decades & Film Colors
// ---------------------------------------------------------------------------

function wallpaperPhotoPool(data) {
  const items = (data.items || []).filter(it => it && it.url);
  // Polaroid posters always show a scene from the film, never a poster or premiere photo
  return stillsOnly || wallpaperState.layout === 'poster' ? stillsOf(items, data.name) : items;
}

function wallpaperPreviewDim() {
  return Math.max(1200, Math.round(Math.max(wallpaperState.width, wallpaperState.height) * 0.6));
}

async function loadTitleData(meta) {
  let data = titleGalleryCache.get(meta.id);
  if (!data) {
    try {
      const res = await fetch(`${meta.file || `titles/${meta.id}.json`}?v=${Date.now()}`);
      if (!res.ok) return null;
      data = await res.json();
      titleGalleryCache.set(meta.id, data);
    } catch (e) {
      return null;
    }
  }
  return data;
}

function titleYear(name) {
  const m = /\((\d{4})/.exec(name || '');
  return m ? Number(m[1]) : null;
}

// 1990 for "Heat (1995)", 'people' for person galleries
function titleDecade(id, name) {
  if (id.startsWith('nm')) return 'people';
  const year = titleYear(name);
  return year ? Math.floor(year / 10) * 10 : null;
}

function renderCatalogFilters() {
  const decadeChips = document.getElementById('decade-chips');
  if (!decadeChips) return;

  const counts = new Map();
  titlesRegistry.forEach(t => {
    const d = titleDecade(t.id, t.name);
    if (d !== null) counts.set(d, (counts.get(d) || 0) + 1);
  });
  const decades = [...counts.keys()].filter(d => d !== 'people').sort((a, b) => a - b);
  if (counts.has('people')) decades.push('people');
  decadeChips.innerHTML = [
    `<button type="button" class="filter-chip active" data-decade="">All</button>`,
    ...decades.map(d => `<button type="button" class="filter-chip" data-decade="${d}">${d === 'people' ? 'People' : `${d}s`}<span class="chip-count">${counts.get(d)}</span></button>`),
  ].join('');
  decadeChips.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const v = chip.dataset.decade;
      decadeFilter = v === '' || String(decadeFilter) === v ? null : (v === 'people' ? 'people' : Number(v));
      decadeChips.querySelectorAll('.filter-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.decade === (decadeFilter === null ? '' : String(decadeFilter)));
      });
      filterCatalogRows();
    });
  });

}

function setStillsOnly(on) {
  stillsOnly = on;
  try { localStorage.setItem(STILLS_KEY, on ? '1' : '0'); } catch (e) { /* storage blocked: this visit only */ }
  const toggle = document.getElementById('stills-only-toggle');
  if (toggle) toggle.checked = on;
  syncWallpaperControls();
  // Refill the strips that are already loaded; the rest pick it up when they scroll into view
  titlesList.querySelectorAll('.title-row').forEach(row => {
    if (titleGalleryCache.has(row.dataset.id)) loadTitleRowPhotos(row.dataset.id, row);
  });
}

function updateKindTabs() {
  const tabs = document.getElementById('kind-tabs');
  if (!tabs) return;
  const counts = { all: galleryData.length, still: 0, poster: 0, bts: 0, event: 0 };
  galleryData.forEach(it => { counts[classifyPhoto(it, selectedTitle && selectedTitle.name)]++; });
  tabs.querySelectorAll('.seg-btn').forEach(btn => {
    const kind = btn.dataset.kind;
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.innerHTML = `${btn.dataset.label}<span class="seg-count">${counts[kind].toLocaleString()}</span>`;
    btn.hidden = kind !== 'all' && counts[kind] === 0;
    btn.classList.toggle('active', kind === currentKind);
  });
}

// ---------------------------------------------------------------------------
// Wallpaper Layouts: Contact Sheet, Film Strip, Lobby Card, Polaroid Poster
// ---------------------------------------------------------------------------

const SINGLE_FILM_LAYOUTS = new Set(['lobby']);
const FRAMED_LAYOUTS = new Set(['scattered', 'staggered', 'strips']); // the ones the Borders control applies to
const FILM_INK = '#d9a54a'; // amber edge print on film stock

function roundRect(r) {
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
}

function layoutSeed() {
  return wallpaperState.scatterVariations[0].seed;
}

// 35mm contact sheet: rows of 3:2 frames on strips of film, printed on paper
function contactSheetGeometry(W, H) {
  const u = Math.min(W, H);
  const cols = W > H ? 6 : 3;
  const m = u * 0.05, gap = u * 0.006, rowGap = u * 0.022;
  const fw = (W - 2 * m - (cols - 1) * gap) / cols;
  const fh = fw / 1.5;
  const edge = fh * 0.17;
  const stripH = fh + 2 * edge;
  const rows = Math.max(1, Math.floor((H - 2 * m + rowGap) / (stripH + rowGap)));
  const top = (H - rows * stripH - (rows - 1) * rowGap) / 2;
  const strips = [], frames = [];
  for (let r = 0; r < rows; r++) {
    const y = top + r * (stripH + rowGap);
    strips.push({ x: m - gap * 3, y, w: W - 2 * m + gap * 6, h: stripH });
    for (let c = 0; c < cols; c++) frames.push({ x: m + c * (fw + gap), y: y + edge, w: fw, h: fh });
  }
  return { strips, frames, edge, fw, fh, m };
}

// Film strips running edge to edge (horizontal on landscape, vertical on portrait), each offset at random
function filmstripGeometry(W, H) {
  const horizontal = W >= H;
  const len = horizontal ? W : H;
  const across = horizontal ? H : W;
  const count = horizontal ? 3 : 2;
  const gapS = across * 0.05;
  const T = (across - (count + 1) * gapS) / count;
  const band = T * 0.15;
  const fCross = T - 2 * band;
  const fAlong = horizontal ? fCross * 1.5 : fCross / 1.5; // frames stay 3:2 landscape either way
  const pitch = fAlong + fCross * 0.06;
  const n = Math.ceil(len / pitch) + 1; // one extra so any offset still reaches the far edge
  const rand = mulberry32(layoutSeed());
  const strips = [], frames = [];
  for (let s = 0; s < count; s++) {
    const a = gapS + s * (T + gapS);
    const offset = rand() * pitch;
    strips.push({ a, offset });
    for (let i = 0; i < n; i++) {
      const p = -offset + i * pitch;
      frames.push(horizontal ? { x: p, y: a + band, w: fAlong, h: fCross } : { x: a + band, y: p, w: fCross, h: fAlong });
    }
  }
  return { horizontal, strips, frames, T, band, pitch, fAlong, len };
}

// Lobby card: one hero still, a title block and three inset stills
function lobbyGeometry(W, H) {
  const u = Math.min(W, H), m = u * 0.05, g = u * 0.03;
  if (W >= H) {
    const heroW = (W - 2 * m - g) * 0.64;
    const hero = { x: m, y: m, w: heroW, h: H - 2 * m };
    const cx = m + heroW + g, cw = W - m - cx;
    const text = { x: cx, y: m, w: cw, h: (H - 2 * m) * 0.4, align: 'left' };
    const y1 = text.y + text.h + g;
    const h1 = (H - m - y1 - g) * 0.55;
    const y2 = y1 + h1 + g, w2 = (cw - g) / 2;
    return { m, hero, text, insets: [
      { x: cx, y: y1, w: cw, h: h1 },
      { x: cx, y: y2, w: w2, h: H - m - y2 },
      { x: cx + w2 + g, y: y2, w: cw - w2 - g, h: H - m - y2 },
    ] };
  }
  const hero = { x: m, y: m, w: W - 2 * m, h: (H - 2 * m) * 0.5 };
  const text = { x: m, y: hero.y + hero.h + g, w: W - 2 * m, h: (H - 2 * m) * 0.22, align: 'center' };
  const y = text.y + text.h + g, w = (W - 2 * m - 2 * g) / 3;
  return { m, hero, text, insets: [0, 1, 2].map(i => ({ x: m + i * (w + g), y, w, h: H - m - y })) };
}

// Polaroid poster: the whole canvas is the card, with a square still like instant film.
// Portrait: still on top, credits below. Landscape: still on the left, credits beside it.
function posterCardGeometry(W, H) {
  if (W >= H) {
    const pad = H * 0.07;
    const side = Math.min(H - 2 * pad, W * 0.62);
    const photo = { x: pad, y: (H - side) / 2, w: side, h: side };
    const tx = photo.x + photo.w + pad;
    return { photo, text: { x: tx, y: pad, w: W - tx - pad, h: H - 2 * pad } };
  }
  const pad = W * 0.07;
  const side = Math.min(W - 2 * pad, H * 0.62);
  const photo = { x: (W - side) / 2, y: pad, w: side, h: side };
  const ty = photo.y + photo.h + pad * 0.9;
  return { photo, text: { x: pad, y: ty, w: W - 2 * pad, h: H - pad - ty } };
}

// TITLE (bold condensed) with a small year after it, then a "starring" credit row
function drawPosterCardText(ctx, box, meta) {
  const name = (meta.name || meta.id).replace(/\s*\(\d{4}[^)]*\)\s*$/, '').toUpperCase();
  const year = titleYear(meta.name);
  const cast = filmCast(meta.id);
  const titleSize = box.w * 0.105;
  const yearSize = titleSize * 0.5;
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#26252a';

  // Title wraps to two lines; the year rides on the last line when it fits
  let size = titleSize, lines;
  for (; size > 6; size *= 0.92) {
    ctx.font = `700 ${size}px Oswald, 'Arial Narrow', sans-serif`;
    lines = wrapWords(ctx, name, box.w);
    if (lines.length <= 2 && lines.every(l => ctx.measureText(l).width <= box.w)) break;
  }
  let y = box.y + size * 0.95;
  lines.forEach((l, i) => {
    ctx.font = `700 ${size}px Oswald, 'Arial Narrow', sans-serif`;
    ctx.fillText(l, box.x, y);
    if (i === lines.length - 1 && year) {
      const after = ctx.measureText(l).width + size * 0.15;
      ctx.font = `500 ${yearSize}px Oswald, 'Arial Narrow', sans-serif`;
      if (after + ctx.measureText(String(year)).width <= box.w) ctx.fillText(String(year), box.x + after, y);
      else { y += yearSize * 1.2; ctx.fillText(String(year), box.x, y); }
    }
    y += size * 1.02;
  });

  if (cast.length) {
    const label = box.w * 0.032;
    const valueSize = box.w * 0.036;
    y += label * 1.6;
    ctx.font = `500 ${label}px 'Plus Jakarta Sans', sans-serif`;
    ctx.fillStyle = '#4a4850';
    ctx.fillText('starring', box.x, y);
    const indent = box.w * 0.24;
    ctx.font = `500 ${valueSize}px Oswald, 'Arial Narrow', sans-serif`;
    ctx.fillStyle = '#26252a';
    wrapWords(ctx, cast.join('   ').toUpperCase(), box.w - indent).slice(0, 2).forEach(l => {
      ctx.fillText(l, box.x + indent, y);
      y += valueSize * 1.35;
    });
  }
  ctx.restore();
}

// Most-captioned people in the film's stills ("A and B in Film (Year)")
function filmCast(id, max = 3) {
  const data = titleGalleryCache.get(id);
  if (!data) return [];
  const counts = new Map();
  (data.items || []).forEach(it => {
    if (classifyPhoto(it, data.name) !== 'still') return;
    const m = /^(.+?) in /.exec(it.title || '');
    if (!m) return;
    m[1].split(/,\s*(?:and\s+)?|\s+and\s+/).forEach(n => {
      n = n.trim();
      if (n && n.length < 40) counts.set(n, (counts.get(n) || 0) + 1);
    });
  });
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, max).map(([n]) => n);
}

function wrapWords(ctx, text, maxW) {
  const lines = [];
  text.split(/\s+/).forEach(word => {
    const last = lines[lines.length - 1];
    if (last !== undefined && ctx.measureText(`${last} ${word}`).width <= maxW) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  });
  return lines;
}

function drawLobbyText(ctx, box, meta, u) {
  const name = (meta.name || meta.id).replace(/\s*\(\d{4}[^)]*\)\s*$/, '').toUpperCase();
  const year = titleYear(meta.name);
  const cast = filmCast(meta.id);
  const small = u * 0.026;
  const footer = small * 3.4;

  // Largest title size that wraps into 3 lines inside the box
  let size = box.h * 0.32, lines = [name];
  for (; size > 10; size *= 0.92) {
    ctx.font = `${size}px Limelight, Georgia, serif`;
    lines = wrapWords(ctx, name, box.w);
    if (lines.length <= 3 && lines.every(l => ctx.measureText(l).width <= box.w) && lines.length * size * 1.08 + footer <= box.h) break;
  }
  const total = lines.length * size * 1.08 + footer;
  const x = box.align === 'center' ? box.x + box.w / 2 : box.x;
  let y = box.align === 'center' ? box.y + (box.h - total) / 2 : box.y;

  ctx.save();
  ctx.fillStyle = '#f3e6c8';
  ctx.textAlign = box.align;
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = u * 0.01;
  ctx.font = `${size}px Limelight, Georgia, serif`;
  lines.forEach(l => { ctx.fillText(l, x, y); y += size * 1.08; });
  ctx.shadowColor = 'transparent';
  y += small * 0.5;
  ctx.fillRect(box.align === 'center' ? x - box.w * 0.15 : x, y, box.w * 0.3, Math.max(1, u * 0.002));
  y += small * 0.6;
  ctx.font = `700 ${small * 1.1}px 'Plus Jakarta Sans', sans-serif`;
  if (year) ctx.fillText(String(year), x, y, box.w);
  if (cast.length) {
    ctx.globalAlpha = 0.85;
    ctx.font = `600 ${small * 0.8}px 'Plus Jakarta Sans', sans-serif`;
    ctx.fillText(`STARRING ${cast.join(' · ').toUpperCase()}`, x, y + small * 1.45, box.w);
  }
  ctx.restore();
}

// Hand-drawn red grease-pencil ring around a chosen frame
function greasePencilRing(ctx, r, rand, u) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const start = rand() * Math.PI * 2;
  ctx.beginPath();
  for (let t = 0; t <= 1.1; t += 0.01) {
    const a = start + t * Math.PI * 2;
    const k = 1 + t * 0.05 + Math.sin(t * 9 + start) * 0.015; // slight spiral and wobble, like a quick stroke
    ctx.lineTo(cx + Math.cos(a) * r.w * 0.58 * k, cy + Math.sin(a) * r.h * 0.62 * k);
  }
  ctx.stroke();
}

function drawLayoutBackground(ctx, W, H) {
  const layout = wallpaperState.layout;
  const u = Math.min(W, H);
  const bg = { contact: '#ebe7dd', filmstrip: '#efede8', lobby: '#2a1d15', poster: '#dcd8cf' }[layout] || '#090a0f';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);


  if (layout === 'contact') {
    const geo = contactSheetGeometry(W, H);
    const rand = mulberry32(layoutSeed());
    const roll = 1 + Math.floor(rand() * 36);
    let frameNo = 1 + Math.floor(rand() * 8);
    ctx.font = `600 ${u * 0.034}px Caveat, cursive`;
    ctx.fillStyle = 'rgba(40,40,46,0.75)';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Roll ${roll}`, geo.m, geo.strips[0].y / 2);
    ctx.font = `500 ${geo.edge * 0.36}px 'JetBrains Mono', monospace`;
    geo.strips.forEach((st, r) => {
      ctx.fillStyle = '#151311';
      ctx.fillRect(st.x, st.y, st.w, st.h);
      ctx.fillStyle = FILM_INK;
      ctx.fillText('KODAK  SAFETY  FILM  5063', st.x + geo.fw * (r % 2 ? 1.2 : 0.3), st.y + geo.edge / 2);
      geo.frames.slice(r * (geo.frames.length / geo.strips.length)).slice(0, geo.frames.length / geo.strips.length).forEach(f => {
        ctx.fillText(`${frameNo}  ▸ ${frameNo}A`, f.x + f.w * 0.06, f.y + f.h + geo.edge / 2);
        frameNo++;
      });
    });
  } else if (layout === 'filmstrip') {
    // Light table: soft glow behind the strips
    const glow = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    glow.addColorStop(0, '#fbfaf6');
    glow.addColorStop(1, '#d9d5cc');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    const geo = filmstripGeometry(W, H);
    const perfs = geo.horizontal ? 8 : 4; // 35mm stills: 8 perforations per frame; vertical motion picture: 4
    const holePitch = geo.pitch / perfs;
    const rand = mulberry32(layoutSeed() + 1);
    geo.strips.forEach(({ a, offset }) => {
      ctx.fillStyle = '#121110';
      if (geo.horizontal) ctx.fillRect(0, a, W, geo.T); else ctx.fillRect(a, 0, geo.T, H);
      ctx.fillStyle = glow;
      const holeAlong = holePitch * 0.48, holeAcross = geo.band * 0.36;
      for (let p = -offset - holePitch; p < geo.len + holePitch; p += holePitch) {
        [a + geo.band * 0.32, a + geo.T - geo.band * 0.32].forEach(c => {
          if (geo.horizontal) ctx.fillRect(p, c - holeAcross / 2, holeAlong, holeAcross);
          else ctx.fillRect(c - holeAcross / 2, p, holeAcross, holeAlong);
        });
      }
      // Edge print between the perforations and the frames
      let n = 1 + Math.floor(rand() * 30);
      ctx.fillStyle = FILM_INK;
      ctx.font = `500 ${geo.band * 0.2}px 'JetBrains Mono', monospace`;
      ctx.textBaseline = 'middle';
      for (let i = 0, p = -offset; p < geo.len; i++, p += geo.pitch, n++) {
        const label = i % 3 === 1 ? `KODAK 5219   ${n}` : `▸ ${n}   ${n}A`;
        const c = a + geo.T - geo.band * 0.8;
        if (geo.horizontal) {
          ctx.fillText(label, p + geo.pitch * 0.1, c);
        } else {
          ctx.save();
          ctx.translate(c, p + geo.pitch * 0.1);
          ctx.rotate(Math.PI / 2);
          ctx.fillText(label, 0, 0);
          ctx.restore();
        }
      }
    });
  }
}

function drawLayoutOverlay(ctx, W, H, rects) {
  const layout = wallpaperState.layout;
  const u = Math.min(W, H);
  const lead = wallpaperState.items[0] && wallpaperState.items[0].titleMeta;

  if (layout === 'contact' && rects.length >= 6) {
    // Picks marked in red grease pencil: two circled, one crossed out
    const rand = mulberry32(layoutSeed() + 7);
    const picks = new Set();
    while (picks.size < 3) picks.add(Math.floor(rand() * rects.length));
    const [a, b, x] = [...picks];
    ctx.save();
    ctx.strokeStyle = 'rgba(214, 38, 46, 0.9)';
    ctx.lineWidth = u * 0.006;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    greasePencilRing(ctx, rects[a], rand, u);
    greasePencilRing(ctx, rects[b], rand, u);
    const r = rects[x], i = r.w * 0.18;
    ctx.beginPath();
    ctx.moveTo(r.x + i, r.y + i); ctx.lineTo(r.x + r.w - i, r.y + r.h - i);
    ctx.moveTo(r.x + r.w - i, r.y + i); ctx.lineTo(r.x + i, r.y + r.h - i);
    ctx.stroke();
    ctx.restore();
  } else if (layout === 'lobby' && lead) {
    const geo = lobbyGeometry(W, H);
    ctx.save();
    ctx.strokeStyle = '#f3e6c8';
    ctx.lineWidth = Math.max(1, u * 0.003);
    rects.forEach(r => ctx.strokeRect(r.x - ctx.lineWidth, r.y - ctx.lineWidth, r.w + ctx.lineWidth * 2, r.h + ctx.lineWidth * 2));
    ctx.globalAlpha = 0.6;
    ctx.strokeRect(geo.m * 0.45, geo.m * 0.45, W - geo.m * 0.9, H - geo.m * 0.9);
    ctx.restore();
    drawLobbyText(ctx, geo.text, lead, u);
  } else if (layout === 'poster') {
    if (lead) drawPosterCardText(ctx, posterCardGeometry(W, H).text, lead);
  }
}

// Film finish applied over the finished frame: halation glow, then black & white, then grain
let grainTile = null;
let halationCanvas = null;
function applyFinish(ctx, W, H) {
  const fx = wallpaperState.finish;
  if (!fx.size) return;

  if (fx.has('halation')) {
    // Shrinking the frame blurs it; multiplying it by itself keeps only the highlights; red tint, screened back on
    halationCanvas = halationCanvas || document.createElement('canvas');
    const small = halationCanvas;
    small.width = Math.max(1, Math.round(W / 20));
    small.height = Math.max(1, Math.round(H / 20));
    const sc = small.getContext('2d');
    sc.drawImage(ctx.canvas, 0, 0, small.width, small.height);
    sc.globalCompositeOperation = 'multiply';
    sc.drawImage(small, 0, 0);
    sc.drawImage(small, 0, 0);
    sc.fillStyle = 'rgb(255, 72, 30)';
    sc.fillRect(0, 0, small.width, small.height);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.5;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, W, H);
    ctx.restore();
  }
  if (fx.has('bw')) {
    ctx.save();
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  if (fx.has('grain')) {
    if (!grainTile) {
      grainTile = document.createElement('canvas');
      grainTile.width = grainTile.height = 256;
      const g = grainTile.getContext('2d');
      const d = g.createImageData(256, 256);
      for (let i = 0; i < d.data.length; i += 4) {
        const v = 128 + (Math.random() + Math.random() + Math.random() - 1.5) * 85;
        d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
        d.data[i + 3] = 255;
      }
      g.putImageData(d, 0, 0);
    }
    const pattern = ctx.createPattern(grainTile, 'repeat');
    pattern.setTransform(new DOMMatrix().scale(Math.max(1, Math.min(W, H) / 1080)));
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

// Canvas text needs its web font loaded; redraw once it arrives (one try per font)
const requestedCanvasFonts = new Set();
function ensureCanvasFont() {
  const s = wallpaperState;
  const font = s.layout === 'lobby' ? '40px Limelight'
    : s.layout === 'poster' ? '700 40px Oswald'
    : (s.frame === 'polaroid' && s.layout === 'scattered') || s.layout === 'contact' ? '600 40px Caveat' : null;
  if (!font || !document.fonts || document.fonts.check(font) || requestedCanvasFonts.has(font)) return;
  requestedCanvasFonts.add(font);
  document.fonts.load(font).then(() => { if (!s.activeAnimId) renderWallpaperCanvas(); }).catch(() => {});
}

// Push wallpaperState into every control (after a layout change or a shared link)
function syncWallpaperControls() {
  const s = wallpaperState;
  const setActive = (control, key, value) => {
    if (control) control.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset[key] === value));
  };
  setActive(wallpaperAspectControl, 'aspect', s.aspect);
  setActive(wallpaperResControl, 'res', s.resName);
  setActive(wallpaperLayoutControl, 'layout', s.layout);
  setActive(document.getElementById('wallpaper-letterbox-control'), 'letterbox', s.letterbox ? String(s.letterbox) : '');
  setActive(document.getElementById('wallpaper-photos-control'), 'stills', stillsOnly ? '1' : '0');
  const finishControl = document.getElementById('wallpaper-finish-control');
  if (finishControl) {
    finishControl.querySelectorAll('.seg-btn').forEach(b => {
      b.classList.toggle('active', s.finish.has(b.dataset.finish));
      b.setAttribute('aria-pressed', String(s.finish.has(b.dataset.finish)));
    });
  }

  // Polaroid prints only exist in the scattered layout; fall back to Framed elsewhere
  const polaroidBtn = wallpaperGapControl && wallpaperGapControl.querySelector('[data-frame="polaroid"]');
  if (polaroidBtn) polaroidBtn.hidden = s.layout !== 'scattered';
  if (s.layout !== 'scattered' && s.frame === 'polaroid') s.frame = null;
  if (wallpaperGapControl) {
    wallpaperGapControl.querySelectorAll('.seg-btn').forEach(b => {
      b.classList.toggle('active', Number(b.dataset.gap) === s.gap && (b.dataset.frame || null) === s.frame);
    });
  }

  const show = (id, visible) => { const el = document.getElementById(id); if (el) el.hidden = !visible; };
  show('wallpaper-borders-unit', FRAMED_LAYOUTS.has(s.layout));
  show('wallpaper-advanced', SCATTER_ADVANCED_ENABLED && s.layout === 'scattered');
  // Nothing to rescatter on a single-photo poster
  if (btnWallpaperRescatter) btnWallpaperRescatter.hidden = s.layout === 'poster';

  if (wallpaperCanvasFrame) {
    wallpaperCanvasFrame.classList.toggle('portrait', isPortraitAspect(s.aspect));
    wallpaperCanvasFrame.classList.toggle('ratio-16-10', s.aspect === '16:10');
    wallpaperCanvasFrame.classList.toggle('ratio-1-1', s.aspect === '1:1');
    wallpaperCanvasFrame.classList.toggle('ratio-9-20', s.aspect === '9:20');
  }
  updateDownloadButtonLabel();
}

// ---------------------------------------------------------------------------
// Shareable Collage Links
// ---------------------------------------------------------------------------

const WALLPAPER_LAYOUTS = ['scattered', 'staggered', 'strips', 'contact', 'filmstrip', 'lobby', 'poster'];
const WALLPAPER_FINISHES = ['grain', 'halation', 'bw'];

// Photos are "titleId~photoKey" in slot order; the seed rebuilds tilt, sizes and placement
function wallpaperShareUrl() {
  const s = wallpaperState;
  const url = new URL(window.location.href);
  url.search = '';
  const p = url.searchParams;
  p.set('view', 'wallpaper');
  p.set('layout', s.layout);
  p.set('aspect', s.aspect);
  p.set('res', s.resName);
  p.set('border', s.frame || String(s.gap));
  if (s.letterbox) p.set('lb', String(s.letterbox));
  if (s.finish.size) p.set('fx', [...s.finish].join('.'));
  p.set('seed', String(layoutSeed()));
  const count = Math.min(s.items.length, s.renderedRects.length || s.items.length);
  p.set('p', s.items.slice(0, count).map(e => `${e.titleMeta.id}~${photoKey(e.item.url)}`).join('.'));
  if (s.selectedTitleIds.length) p.set('t', s.selectedTitleIds.join('.'));
  // Single swaps keep the old placement, so the seed alone can't rebuild it: send the placement itself
  const c = scatterPlacementCache;
  if (s.layout === 'scattered' && c && c.vars === s.scatterVariations && c.placement.length === count) {
    p.set('sp', c.placement.map(encodePlacement).join(''));
  }
  return url.toString();
}

// Base36 fixed width per photo: center x, y (2 chars each) and area (3 chars), all normalized to the canvas
const PLACEMENT_CHARS = 7;
function encodePlacement(pl) {
  const q = (v, n) => Math.round(Math.max(0, Math.min(1, v)) * (36 ** n - 1)).toString(36).padStart(n, '0');
  return q(pl.nx, 2) + q(pl.ny, 2) + q(pl.area, 3);
}

function decodePlacement(str) {
  const out = [];
  for (let i = 0; i + PLACEMENT_CHARS <= str.length; i += PLACEMENT_CHARS) {
    const d = (a, n) => parseInt(str.slice(i + a, i + a + n), 36) / (36 ** n - 1);
    out.push({ nx: d(0, 2), ny: d(2, 2), area: d(4, 3) });
  }
  return out.every(pl => Number.isFinite(pl.nx + pl.ny + pl.area)) ? out : [];
}

async function copyWallpaperLink() {
  if (!wallpaperState.items.length) return;
  const label = document.getElementById('wallpaper-share-text');
  const url = wallpaperShareUrl();
  try {
    await navigator.clipboard.writeText(url);
    if (label) label.textContent = 'Link copied!';
  } catch (e) {
    window.prompt('Copy this link:', url);
  }
  if (label) setTimeout(() => { label.textContent = 'Copy Link'; }, 1600);
}

async function restoreSharedWallpaper(params) {
  const s = wallpaperState;
  const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);
  s.layout = pick(params.get('layout'), WALLPAPER_LAYOUTS, 'scattered');
  s.aspect = pick(params.get('aspect'), ['16:9', '16:10', '1:1', '9:16', '9:20'], '16:9');
  s.resName = pick(params.get('res'), ['1080p', '2k', '4k'], '1080p');
  const border = params.get('border');
  s.frame = border === 'polaroid' ? 'polaroid' : null;
  s.gap = border === 'polaroid' ? 14 : Number(pick(border, ['0', '6', '14'], '6'));
  s.letterbox = Number(pick(params.get('lb'), ['1.85', '2.39'], '')) || null;
  s.finish = new Set((params.get('fx') || '').split('.').filter(f => WALLPAPER_FINISHES.includes(f)));
  const dims = getWallpaperDimensions(s.aspect, s.resName);
  s.width = dims.w;
  s.height = dims.h;
  const seed = Number(params.get('seed'));
  s.scatterVariations = generateScatterVariations(Number.isInteger(seed) && seed >= 0 ? seed : undefined);
  const refs = (params.get('p') || '').split('.').filter(Boolean).map(ref => ref.split('~'));
  s.selectedTitleIds = (params.get('t') || '').split('.').filter(id => titlesRegistry.some(t => t.id === id));
  updateWallpaperSourceUI();
  const placement = decodePlacement(params.get('sp') || '');

  // Show the studio with its loader; isLoading keeps the view switch from generating a random collage
  s.isLoading = true;
  await switchToWallpaperView(false);
  if (wallpaperLoader) wallpaperLoader.classList.add('active');
  if (wallpaperLoaderStatus) wallpaperLoaderStatus.textContent = 'Rebuilding the shared collage...';

  const entries = await Promise.all(refs.map(async ([id, key]) => {
    const meta = titlesRegistry.find(t => t.id === id);
    const data = meta && await loadTitleData(meta);
    const item = data && (data.items || []).find(it => photoKey(it.url) === key);
    if (!item) return null; // re-scraped or removed since the link was made
    const img = await preloadImage(getPreviewImageUrl(item.url, item.width, item.height, wallpaperPreviewDim()));
    return img ? { titleMeta: meta, item, img } : null;
  }));
  s.items = entries.filter(Boolean);
  // Missing photos would shift every slot after them: fall back to recomputing from the seed
  if (s.layout === 'scattered' && placement.length === refs.length && s.items.length === refs.length) {
    scatterPlacementCache = {
      vars: s.scatterVariations,
      aspectKey: (s.width / s.height).toFixed(3),
      isPolaroid: s.frame === 'polaroid',
      settingsKey: JSON.stringify(s.scatter),
      placement,
    };
  }
  if (wallpaperLoader) wallpaperLoader.classList.remove('active');
  s.isLoading = false;
  if (s.items.length) renderWallpaperCanvas();
  else await generateWallpaper(true);
  if (totalCountEl) totalCountEl.textContent = s.items.length.toString();
}

// ---------------------------------------------------------------------------
// Wallpaper History (this tab only: sessionStorage)
// ---------------------------------------------------------------------------

// Each entry: { url: share link that rebuilds it, image: small JPEG preview, title, layout, aspect, time }
const HISTORY_KEY = 'imdb_wallpaper_history';
const HISTORY_MAX = 60;
const HISTORY_THUMB = 360; // px on the long edge
let historyTimer = null;

function loadHistory() {
  try {
    const list = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

// sessionStorage holds ~5 MB: drop the oldest previews until the list fits
function saveHistory(list) {
  while (true) {
    try {
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(list));
      return;
    } catch (e) {
      if (!list.length) return;
      list.pop();
    }
  }
}

// Wait for the frame to settle (font loads, quick setting clicks) before taking a preview
function scheduleHistoryRecord() {
  clearTimeout(historyTimer);
  historyTimer = setTimeout(recordWallpaperHistory, 600);
}

function recordWallpaperHistory() {
  const s = wallpaperState;
  if (!s.items.length || s.isLoading || s.activeAnimId || !wallpaperCanvas) return;
  const url = wallpaperShareUrl();
  const scale = HISTORY_THUMB / Math.max(wallpaperCanvas.width, wallpaperCanvas.height);
  const thumb = document.createElement('canvas');
  thumb.width = Math.round(wallpaperCanvas.width * scale);
  thumb.height = Math.round(wallpaperCanvas.height * scale);
  thumb.getContext('2d').drawImage(wallpaperCanvas, 0, 0, thumb.width, thumb.height);
  let image;
  try {
    image = thumb.toDataURL('image/jpeg', 0.72);
  } catch (e) {
    return; // tainted canvas: nothing to preview
  }
  const shown = s.items.slice(0, s.renderedRects.length || s.items.length);
  const films = new Set(shown.map(e => e.titleMeta && e.titleMeta.id));
  const title = films.size === 1 ? (shown[0].titleMeta.name || shown[0].titleMeta.id) : `${films.size} films`;
  // Same wallpaper made again moves to the top instead of repeating
  const list = loadHistory().filter(h => h.url !== url);
  list.unshift({ url, image, title, layout: s.layout, aspect: s.aspect, time: Date.now() });
  saveHistory(list.slice(0, HISTORY_MAX));
  if (currentView === 'history') renderHistoryView();
}

function renderHistoryView() {
  const grid = document.getElementById('history-grid');
  const list = loadHistory().filter(h => typeof h.image === 'string' && h.image.startsWith('data:image/jpeg'));
  document.getElementById('history-count').textContent = `${list.length} wallpaper${list.length === 1 ? '' : 's'}`;
  document.getElementById('btn-history-clear').hidden = list.length === 0;
  if (!list.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🕘</div>
        <h3>No wallpapers yet</h3>
        <p>Wallpapers you make in Wallpaper Studio show up here until you close this tab.</p>
      </div>
    `;
    return;
  }
  const layoutName = id => {
    const btn = wallpaperLayoutControl && wallpaperLayoutControl.querySelector(`[data-layout="${id}"]`);
    return btn ? btn.textContent.trim() : id;
  };
  grid.innerHTML = list.map(h => {
    const time = new Date(h.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `
      <a class="history-card" href="${escapeHtml(h.url)}" title="Rebuild this wallpaper">
        <img class="history-thumb" src="${h.image}" alt="${escapeHtml(h.title)}" loading="lazy">
        <span class="history-meta">
          <span class="history-title">${escapeHtml(h.title)}</span>
          <span class="history-sub">${escapeHtml(layoutName(h.layout))} · ${escapeHtml(h.aspect)} · ${time}</span>
        </span>
      </a>
    `;
  }).join('');
}

function switchToHistoryView(updateHistory = true) {
  if (currentView === 'catalog') catalogScrollY = window.scrollY;
  currentView = 'history';
  catalogView.classList.add('hidden');
  galleryView.classList.add('hidden');
  wallpaperView.classList.add('hidden');
  historyView.classList.remove('hidden');
  if (btnNavWallpaper) btnNavWallpaper.classList.add('active');
  segmentedControl.classList.add('hidden');
  searchWrapper.classList.add('hidden');
  selectedTitleText.textContent = 'Wallpaper History';
  if (btnImdbLink) btnImdbLink.style.display = 'none';
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  if (updateHistory) {
    const url = new URL(window.location.href);
    url.search = '?view=history';
    window.history.pushState({ view: 'history' }, '', url.toString());
  }
  // Header counter: number of saved wallpapers
  if (totalCountEl) totalCountEl.textContent = loadHistory().length.toString();
  if (counterLabelEl) counterLabelEl.textContent = 'saved';
  renderHistoryView();
}

// ---------------------------------------------------------------------------
// Wallpaper Source Title Selector
// ---------------------------------------------------------------------------

let workingSourceSet = new Set();

function updateWallpaperSourceUI() {
  if (!wallpaperSourceBtnText) return;

  const count = wallpaperState.selectedTitleIds ? wallpaperState.selectedTitleIds.length : 0;
  if (count === 0) {
    wallpaperSourceBtnText.textContent = `All Catalog (${titlesRegistry.length})`;
    if (btnWallpaperSource) btnWallpaperSource.classList.remove('has-selection');
    if (wallpaperSelectedSources) wallpaperSelectedSources.classList.add('hidden');
    if (selectedSourcesTags) selectedSourcesTags.innerHTML = '';
  } else if (count === 1) {
    const meta = titlesRegistry.find(t => t.id === wallpaperState.selectedTitleIds[0]);
    const name = meta ? (meta.name || meta.id) : '1 Title';
    wallpaperSourceBtnText.textContent = name;
    if (btnWallpaperSource) btnWallpaperSource.classList.add('has-selection');
    renderSourceTags();
  } else {
    wallpaperSourceBtnText.textContent = `${count} Titles Selected`;
    if (btnWallpaperSource) btnWallpaperSource.classList.add('has-selection');
    renderSourceTags();
  }
}

function renderSourceTags() {
  if (!wallpaperSelectedSources || !selectedSourcesTags) return;

  const count = wallpaperState.selectedTitleIds.length;
  if (count === 0) {
    wallpaperSelectedSources.classList.add('hidden');
    selectedSourcesTags.innerHTML = '';
    return;
  }

  wallpaperSelectedSources.classList.remove('hidden');
  selectedSourcesTags.innerHTML = '';

  const fragment = document.createDocumentFragment();
  wallpaperState.selectedTitleIds.forEach(id => {
    const meta = titlesRegistry.find(t => t.id === id);
    if (!meta) return;

    const tag = document.createElement('span');
    tag.className = 'source-tag';

    const posterUrl = meta.posterUrl ? getPreviewImageUrl(meta.posterUrl, 40, 40, 60) : '';
    const imgHtml = posterUrl
      ? `<img class="source-tag-thumb" src="${posterUrl}" alt="" loading="lazy">`
      : `<span>🎬</span>`;

    tag.innerHTML = `
      ${imgHtml}
      <span>${escapeHtml(meta.name || meta.id)}</span>
      <button type="button" class="source-tag-remove" data-id="${meta.id}" title="Remove title">✕</button>
    `;

    tag.querySelector('.source-tag-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      removeSelectedSourceTitle(meta.id);
    });

    fragment.appendChild(tag);
  });

  selectedSourcesTags.appendChild(fragment);
}

function removeSelectedSourceTitle(id) {
  wallpaperState.selectedTitleIds = wallpaperState.selectedTitleIds.filter(tId => tId !== id);
  workingSourceSet = new Set(wallpaperState.selectedTitleIds);
  updateWallpaperSourceUI();
  updateSourcePopoverList();
  generateWallpaper(true);
}

function initWallpaperSourceSelector() {
  if (!btnWallpaperSource || !wallpaperSourcePopover) return;

  // Toggle popover
  btnWallpaperSource.addEventListener('click', (e) => {
    e.stopPropagation();
    const isClosed = wallpaperSourcePopover.classList.contains('hidden');
    if (isClosed) {
      openSourcePopover();
    } else {
      closeSourcePopover();
    }
  });

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (wallpaperSourcePopover && !wallpaperSourcePopover.classList.contains('hidden')) {
      if (wallpaperSourceWrapper && !wallpaperSourceWrapper.contains(e.target)) {
        closeSourcePopover();
      }
    }
  });

  // Filter input
  if (wallpaperSourceSearch) {
    wallpaperSourceSearch.addEventListener('input', () => {
      renderSourcePopoverOptions(wallpaperSourceSearch.value.trim().toLowerCase());
    });
  }

  // All Catalog link
  if (btnSourceAll) {
    btnSourceAll.addEventListener('click', () => {
      workingSourceSet.clear();
      updateSourcePopoverSelectionCount();
      renderSourcePopoverOptions(wallpaperSourceSearch ? wallpaperSourceSearch.value.trim().toLowerCase() : '');
    });
  }

  // Clear link
  if (btnSourceClear) {
    btnSourceClear.addEventListener('click', () => {
      workingSourceSet.clear();
      updateSourcePopoverSelectionCount();
      renderSourcePopoverOptions(wallpaperSourceSearch ? wallpaperSourceSearch.value.trim().toLowerCase() : '');
    });
  }

  // Apply & Generate button
  if (btnSourceApply) {
    btnSourceApply.addEventListener('click', () => {
      wallpaperState.selectedTitleIds = Array.from(workingSourceSet);
      closeSourcePopover();
      updateWallpaperSourceUI();
      generateWallpaper(true);
    });
  }

  // Reset to All button in tag strip
  if (btnClearSources) {
    btnClearSources.addEventListener('click', () => {
      wallpaperState.selectedTitleIds = [];
      workingSourceSet.clear();
      updateWallpaperSourceUI();
      updateSourcePopoverList();
      generateWallpaper(true);
    });
  }

  updateWallpaperSourceUI();
}

function openSourcePopover() {
  workingSourceSet = new Set(wallpaperState.selectedTitleIds || []);
  if (wallpaperSourceSearch) wallpaperSourceSearch.value = '';
  renderSourcePopoverOptions('');
  updateSourcePopoverSelectionCount();
  if (wallpaperSourcePopover) wallpaperSourcePopover.classList.remove('hidden');
  if (btnWallpaperSource) btnWallpaperSource.classList.add('open');
  if (wallpaperSourceSearch) {
    setTimeout(() => wallpaperSourceSearch.focus(), 50);
  }
}

function closeSourcePopover() {
  if (wallpaperSourcePopover) wallpaperSourcePopover.classList.add('hidden');
  if (btnWallpaperSource) btnWallpaperSource.classList.remove('open');
}

function updateSourcePopoverSelectionCount() {
  if (!sourceSelectedCount) return;
  const count = workingSourceSet.size;
  if (count === 0) {
    sourceSelectedCount.textContent = 'All catalog selected';
  } else if (count === 1) {
    sourceSelectedCount.textContent = '1 title selected';
  } else {
    sourceSelectedCount.textContent = `${count} titles selected`;
  }
}

function updateSourcePopoverList() {
  const query = wallpaperSourceSearch ? wallpaperSourceSearch.value.trim().toLowerCase() : '';
  renderSourcePopoverOptions(query);
}

function renderSourcePopoverOptions(filterQuery = '') {
  if (!wallpaperSourceList || !titlesRegistry) return;
  wallpaperSourceList.innerHTML = '';

  const filteredTitles = titlesRegistry.filter(title => {
    if (!filterQuery) return true;
    const name = (title.name || '').toLowerCase();
    const id = (title.id || '').toLowerCase();
    return name.includes(filterQuery) || id.includes(filterQuery);
  });

  if (filteredTitles.length === 0) {
    wallpaperSourceList.innerHTML = `
      <div style="padding: 1.5rem 1rem; text-align: center; color: var(--text-muted); font-size: 0.75rem;">
        No movies match "${escapeHtml(filterQuery)}"
      </div>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();
  filteredTitles.forEach(title => {
    const isSelected = workingSourceSet.has(title.id);
    const itemEl = document.createElement('div');
    itemEl.className = `source-option-item ${isSelected ? 'selected' : ''}`;
    itemEl.dataset.id = title.id;

    const posterUrl = title.posterUrl ? getPreviewImageUrl(title.posterUrl, 60, 60, 100) : '';
    const imgHtml = posterUrl
      ? `<img class="source-thumb" src="${posterUrl}" alt="" loading="lazy">`
      : `<span class="source-thumb" style="display:flex;align-items:center;justify-content:center;font-size:12px;">🎬</span>`;

    itemEl.innerHTML = `
      <input type="checkbox" class="source-checkbox" ${isSelected ? 'checked' : ''} tabindex="-1">
      ${imgHtml}
      <div class="source-info">
        <span class="source-name" title="${escapeHtml(title.name || title.id)}">${escapeHtml(title.name || title.id)}</span>
        <span class="source-meta">${title.itemCount || 0} photos</span>
      </div>
    `;

    itemEl.addEventListener('click', (e) => {
      if (workingSourceSet.has(title.id)) {
        workingSourceSet.delete(title.id);
      } else {
        workingSourceSet.add(title.id);
      }
      updateSourcePopoverSelectionCount();
      const checkbox = itemEl.querySelector('.source-checkbox');
      if (checkbox) checkbox.checked = workingSourceSet.has(title.id);
      itemEl.classList.toggle('selected', workingSourceSet.has(title.id));
    });

    fragment.appendChild(itemEl);
  });

  wallpaperSourceList.appendChild(fragment);
}

// ---------------------------------------------------------------------------
// Event Listeners
// ---------------------------------------------------------------------------

function setupEventListeners() {
  // Brand Logo Click -> Return to Catalog View
  if (brandGroup) {
    brandGroup.addEventListener('click', () => switchToCatalogView(true));
  }

  // Gallery Back Button -> Return to Catalog View
  if (galleryBackBtn) {
    galleryBackBtn.addEventListener('click', () => switchToCatalogView(true));
  }

  // Window & Container resize handling for Movie Gallery Grid
  window.addEventListener('resize', () => {
    clearTimeout(galleryResizeTimer);
    galleryResizeTimer = setTimeout(handleGalleryResize, 80);
  });

  if (window.ResizeObserver && gridContainer) {
    const ro = new ResizeObserver(() => {
      handleGalleryResize();
    });
    ro.observe(gridContainer);
  }

  // Wallpaper Source Title Selector
  initWallpaperSourceSelector();

  // Wallpaper Navigation & Controls
  if (btnNavWallpaper) {
    btnNavWallpaper.addEventListener('click', async () => {
      if (currentView === 'wallpaper') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        const fromGallery = currentView === 'gallery' && selectedTitle && selectedTitle.id;
        if (fromGallery) {
          wallpaperState.selectedTitleIds = [selectedTitle.id];
          updateWallpaperSourceUI();
        }
        await switchToWallpaperView(true);
        if (fromGallery) {
          await generateWallpaper(true);
        }
      }
    });
  }

  if (wallpaperBackBtn) {
    wallpaperBackBtn.addEventListener('click', () => switchToCatalogView(true));
  }

  if (btnWallpaperShuffle) {
    btnWallpaperShuffle.addEventListener('click', () => generateWallpaper(true));
  }

  if (btnWallpaperRescatter) {
    btnWallpaperRescatter.addEventListener('click', rescatterWallpaper);
  }

  if (btnWallpaperDownload) {
    btnWallpaperDownload.addEventListener('click', downloadWallpaper);
  }

  if (btnWallpaperFullscreen) {
    btnWallpaperFullscreen.addEventListener('click', toggleWallpaperFullscreen);
  }

  // Wallpaper Canvas Hover & Lightbox Click
  if (wallpaperCanvasFrame) {
    wallpaperCanvasFrame.addEventListener('mousemove', onWallpaperMouseMove);
    wallpaperCanvasFrame.addEventListener('mouseleave', hideWallpaperHover);
    wallpaperCanvasFrame.addEventListener('click', onWallpaperClick);
  }

  // Hover Swap Single Image Button
  if (hoverSwapBtn) {
    hoverSwapBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (wallpaperState.currentHoverIndex !== -1) {
        swapSingleWallpaperItem(wallpaperState.currentHoverIndex);
      }
    });

    hoverSwapBtn.addEventListener('mouseenter', () => {
      if (wallpaperTooltip) {
        wallpaperTooltip.classList.remove('visible');
      }
    });
  }

  // Wallpaper Aspect Ratio Buttons (16:9 Landscape vs 9:16 Portrait)
  if (wallpaperAspectControl) {
    wallpaperAspectControl.querySelectorAll('.seg-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const newAspect = btn.dataset.aspect;
        if (wallpaperState.aspect === newAspect) return;

        wallpaperAspectControl.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        wallpaperState.aspect = newAspect;
        const dims = getWallpaperDimensions(newAspect, wallpaperState.resName);
        wallpaperState.width = dims.w;
        wallpaperState.height = dims.h;

        if (wallpaperCanvasFrame) {
          wallpaperCanvasFrame.classList.toggle('portrait', isPortraitAspect(newAspect));
          wallpaperCanvasFrame.classList.toggle('ratio-16-10', newAspect === '16:10');
          wallpaperCanvasFrame.classList.toggle('ratio-1-1', newAspect === '1:1');
          wallpaperCanvasFrame.classList.toggle('ratio-9-20', newAspect === '9:20');
        }

        updateDownloadButtonLabel();

        syncScatterControls();
        const needed = getRequiredSlotCount(wallpaperState.layout, newAspect);
        if (wallpaperState.items.length < needed) {
          await generateWallpaper(false);
        } else {
          renderWallpaperCanvas();
        }
      });
    });
  }

  // Wallpaper Resolution Buttons
  if (wallpaperResControl) {
    wallpaperResControl.querySelectorAll('.seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        wallpaperResControl.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const resName = btn.dataset.res;
        wallpaperState.resName = resName;
        const dims = getWallpaperDimensions(wallpaperState.aspect, resName);
        wallpaperState.width = dims.w;
        wallpaperState.height = dims.h;
        updateDownloadButtonLabel();
        renderWallpaperCanvas();
      });
    });
  }

  // Wallpaper Layout Buttons
  if (wallpaperLayoutControl) {
    wallpaperLayoutControl.querySelectorAll('.seg-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        wallpaperLayoutControl.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const newLayout = btn.dataset.layout;
        const leadFilm = wallpaperState.items[0] && wallpaperState.items[0].titleMeta;
        wallpaperState.layout = newLayout;
        syncWallpaperControls();

        if (newLayout === 'poster') {
          // The poster shows the first photo: lead with a film frame from the current set, or fetch a new one
          const i = wallpaperState.items.findIndex(e => e.titleMeta && isFilmFrame(e.item, e.titleMeta.name));
          if (i === -1) {
            await generateWallpaper(true);
            return;
          }
          wallpaperState.items.unshift(...wallpaperState.items.splice(i, 1));
        }
        if (SINGLE_FILM_LAYOUTS.has(newLayout)) {
          // One film per lobby card: keep the film the current collage leads with
          await generateWallpaper(true, leadFilm && leadFilm.id);
          return;
        }
        const needed = getRequiredSlotCount(newLayout);
        if (wallpaperState.items.length < needed) {
          await generateWallpaper(false);
        } else {
          renderWallpaperCanvas();
        }
      });
    });
  }

  // Wallpaper Gap Buttons
  if (wallpaperGapControl) {
    wallpaperGapControl.querySelectorAll('.seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        wallpaperGapControl.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        wallpaperState.gap = parseInt(btn.dataset.gap, 10);
        wallpaperState.frame = btn.dataset.frame || null;
        renderWallpaperCanvas();
      });
    });
  }

  // Letterbox, finish and photo-type controls
  const letterboxControl = document.getElementById('wallpaper-letterbox-control');
  if (letterboxControl) {
    letterboxControl.querySelectorAll('.seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        wallpaperState.letterbox = Number(btn.dataset.letterbox) || null;
        syncWallpaperControls();
        renderWallpaperCanvas();
      });
    });
  }
  const finishControl = document.getElementById('wallpaper-finish-control');
  if (finishControl) {
    finishControl.querySelectorAll('.seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const fx = btn.dataset.finish;
        if (wallpaperState.finish.has(fx)) wallpaperState.finish.delete(fx);
        else wallpaperState.finish.add(fx);
        syncWallpaperControls();
        renderWallpaperCanvas();
      });
    });
  }
  const photosControl = document.getElementById('wallpaper-photos-control');
  if (photosControl) {
    photosControl.querySelectorAll('.seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const on = btn.dataset.stills === '1';
        if (on === stillsOnly) return;
        setStillsOnly(on);
        const lead = wallpaperState.items[0] && wallpaperState.items[0].titleMeta;
        generateWallpaper(true, SINGLE_FILM_LAYOUTS.has(wallpaperState.layout) && lead ? lead.id : null);
      });
    });
  }
  const btnWallpaperShare = document.getElementById('btn-wallpaper-share');
  if (btnWallpaperShare) btnWallpaperShare.addEventListener('click', copyWallpaperLink);
  document.getElementById('btn-wallpaper-history').addEventListener('click', () => switchToHistoryView(true));
  document.getElementById('history-back-btn').addEventListener('click', () => switchToWallpaperView(true));
  document.getElementById('btn-history-clear').addEventListener('click', () => {
    saveHistory([]);
    renderHistoryView();
  });

  // Catalog stills-only switch
  const stillsToggle = document.getElementById('stills-only-toggle');
  if (stillsToggle) {
    stillsToggle.checked = stillsOnly;
    stillsToggle.addEventListener('change', () => setStillsOnly(stillsToggle.checked));
  }

  // Gallery photo type tabs
  const kindTabs = document.getElementById('kind-tabs');
  if (kindTabs) {
    kindTabs.querySelectorAll('.seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentKind = btn.dataset.kind;
        updateKindTabs();
        renderGrid();
      });
    });
  }


  // Advanced Scattered Settings
  const advancedGrid = document.getElementById('wallpaper-advanced-grid');
  if (advancedGrid) {
    syncScatterControls();
    advancedGrid.querySelectorAll('input[data-setting]').forEach(input => {
      const key = input.dataset.setting;
      input.addEventListener('input', () => {
        const value = Number(input.value);
        const out = advancedGrid.querySelector(`output[data-for="${key}"]`);
        if (out) out.textContent = `${value}${SCATTER_UNITS[key]}`;
        if (key === 'count') return; // applied on release, since it may fetch photos
        wallpaperState.scatter[key] = value;
        saveScatterSettings();
        animateScatterTweak();
      });
      if (key === 'count') {
        input.addEventListener('change', () => {
          wallpaperState.scatter.count = Number(input.value);
          saveScatterSettings();
          applyScatterCount();
        });
      }
    });

    const btnScatterReset = document.getElementById('btn-scatter-reset');
    if (btnScatterReset) {
      btnScatterReset.addEventListener('click', () => {
        wallpaperState.scatter = { ...SCATTER_DEFAULTS };
        saveScatterSettings();
        syncScatterControls();
        applyScatterCount();
      });
    }
  }

  // Main Header Search Input
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    const hasValue = searchQuery.trim().length > 0;
    if (searchWrapper) {
      searchWrapper.classList.toggle('has-value', hasValue);
    }
    if (searchClearBtn) {
      searchClearBtn.classList.toggle('visible', hasValue);
    }

    if (currentView === 'catalog') {
      filterCatalogRows();
    } else {
      renderGrid();
    }
  });

  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      if (searchWrapper) {
        searchWrapper.classList.remove('has-value');
      }
      searchClearBtn.classList.remove('visible');

      if (currentView === 'catalog') {
        filterCatalogRows();
      } else {
        renderGrid();
      }
      searchInput.focus();
    });
  }

  // Segmented Resolution Filters
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      if (currentView === 'gallery') {
        renderGrid();
      }
    });
  });

  // Lightbox Buttons
  btnClose.addEventListener('click', closeLightbox);
  lightboxBackdrop.addEventListener('click', closeLightbox);
  btnPrev.addEventListener('click', prevImage);
  btnNext.addEventListener('click', nextImage);

  if (lightboxFullResBtn) {
    lightboxFullResBtn.addEventListener('click', loadFullResImage);
  }

  if (lightboxDownload) {
    lightboxDownload.addEventListener('click', downloadOriginalImage);
  }

  if (lightboxCopy) {
    lightboxCopy.addEventListener('click', copyImageUrl);
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', toggleTheme);
  }

  // Browser Navigation (Back / Forward)
  window.addEventListener('popstate', (e) => {
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view');
    const titleId = params.get('title');
    if (view === 'history') {
      switchToHistoryView(false);
    } else if (view === 'wallpaper') {
      switchToWallpaperView(false);
    } else if (titleId) {
      switchToGalleryView(titleId, false);
    } else {
      if (e.state && typeof e.state.scrollY === 'number') {
        catalogScrollY = e.state.scrollY;
      }
      switchToCatalogView(false);
    }
  });

  // Scrape Request: pre-filled "[scrape]" issue; the deploy workflow scrapes, redeploys and closes it
  const scrapeDialog = document.getElementById('scrape-dialog');
  const btnScrapeRequest = document.getElementById('btn-scrape-request');
  if (scrapeDialog && btnScrapeRequest && scrapeDialog.showModal) {
    const scrapeInput = document.getElementById('scrape-input');
    btnScrapeRequest.addEventListener('click', () => {
      scrapeDialog.showModal();
      scrapeInput.focus();
    });
    document.getElementById('btn-scrape-cancel').addEventListener('click', () => scrapeDialog.close());
    document.getElementById('scrape-form').addEventListener('submit', () => {
      const text = scrapeInput.value.trim();
      if (!text) return;
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      const tag = document.getElementById('scrape-force').checked ? '[scrape:force]' : '[scrape]';
      const summary = lines[0].length > 60 ? `${lines[0].slice(0, 57)}...` : lines[0];
      const title = `${tag} ${summary}${lines.length > 1 ? ` (+${lines.length - 1} more)` : ''}`;
      // Body must be only the requested titles: the scraper parses all of it as free-form input
      const url = `https://github.com/${GITHUB_REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`;
      window.open(url, '_blank', 'noopener');
      scrapeInput.value = '';
    });
  }

  // Global Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    // If user is currently typing in an input or textarea, never trigger any shortcut
    const isInput = e.target && (
      e.target.tagName === 'INPUT' ||
      e.target.tagName === 'TEXTAREA' ||
      e.target.isContentEditable
    );
    if (isInput) {
      if (e.key === 'Escape') {
        e.target.blur();
        if (wallpaperSourcePopover && !wallpaperSourcePopover.classList.contains('hidden')) {
          wallpaperSourcePopover.classList.add('hidden');
        }
      }
      return;
    }

    if (lightbox.classList.contains('active')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeLightbox();
        return;
      }
      if (e.key === 'ArrowLeft') prevImage();
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        nextImage();
      }
      if (e.key === 'c' || e.key === 'C') {
        copyImageUrl();
      }
      if (e.key === 'z' || e.key === 'Z' || e.key === 'f' || e.key === 'F') {
        loadFullResImage();
      }
      if (e.key === 'd' || e.key === 'D') {
        downloadOriginalImage();
      }
      return;
    }

    if (currentView === 'history') return;

    // When in Wallpaper Studio
    if (currentView === 'wallpaper') {
      if (e.key === 'Escape') {
        if (wallpaperSourcePopover && !wallpaperSourcePopover.classList.contains('hidden')) {
          e.preventDefault();
          wallpaperSourcePopover.classList.add('hidden');
        }
      }
      return;
    }

    // Focus search shortcut with '/'
    if (e.key === '/' && document.activeElement !== searchInput && document.activeElement !== dropdownSearchInput) {
      e.preventDefault();
      searchInput.focus();
    }
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}

// Start application
init();
