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
let currentView = 'catalog'; // 'catalog' | 'gallery'
let selectedTitle = null;
let galleryData = [];
let currentFilter = 'all';
let searchQuery = '';
let currentLightboxIndex = 0;
let titleRowObserver = null;
let catalogScrollY = 0;
let lastViewedTitleId = null;

// Core DOM Elements
const brandGroup = document.querySelector('.brand-group');
const totalCountEl = document.getElementById('total-count');
const counterLabelEl = document.querySelector('.counter-label');
const searchWrapper = document.getElementById('search-wrapper');
const searchInput = document.getElementById('search-input');
const searchClearBtn = document.getElementById('search-clear');
const segmentedControl = document.getElementById('segmented-control');
const filterBtns = document.querySelectorAll('.seg-btn');
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
 * Returns a bandwidth-efficient, high-performance preview URL constrained to max 720p.
 * Uses IMDb / Amazon Media CDN's on-the-fly resizing engine (_V1_QL75_UX720_ / _V1_QL75_UY720_).
 * Original master uncompressed URL is preserved intact for downloading and full-res view.
 */
function getPreviewImageUrl(url, width, height, maxDim = 720) {
  if (!url || typeof url !== 'string') return url;
  if (!url.includes('m.media-amazon.com/images/M/')) return url;
  if (width && height && width <= maxDim && height <= maxDim) return url;

  const isPortrait = height && width && height > width;
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
  const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  applyTheme(current === 'light' ? 'dark' : 'light');
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

  // Determine initial view from URL
  const params = new URLSearchParams(window.location.search);
  const requestedId = params.get('title');
  const matchingTitle = titlesRegistry.find(t => t.id === requestedId);

  if (matchingTitle) {
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

  // 2. Filter matching titles
  const matching = titlesRegistry.filter(t => {
    if (!query) return true;
    const name = (t.name || '').toLowerCase();
    const id = (t.id || '').toLowerCase();
    return name.includes(query) || id.includes(query);
  });

  if (matching.length === 0 && !showAllMatch) {
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
    const imdbLink = title.targetUrl || `https://www.imdb.com/title/${title.id}/`;

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

    const items = titleData.items || [];
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

      card.innerHTML = `
        <div class="strip-thumb-wrapper">
          <img class="strip-thumb" src="${previewUrl}" alt="${escapeHtml(caption)}" loading="lazy">
          <span class="strip-badge ${badge.isHigh ? 'high-res' : ''}" title="${badge.dim}">${badge.label}</span>
        </div>
      `;

      const img = card.querySelector('.strip-thumb');
      if (img.complete) {
        img.classList.add('loaded');
      } else {
        img.addEventListener('load', () => img.classList.add('loaded'));
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
    const matches = !query || name.includes(query) || id.includes(query);
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
    catalogEmpty.innerHTML = `
      <div class="empty-icon">🔍</div>
      <h3>No titles match "${escapeHtml(searchQuery)}"</h3>
      <p>Try clearing your search to view all ${titlesRegistry.length} scraped titles.</p>
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
  galleryView.classList.remove('hidden');
  segmentedControl.classList.remove('hidden');
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
    btnImdbLink.href = `https://www.imdb.com/title/${titleId}/`;
    btnImdbLink.style.display = 'flex';
  }

  // Update URL history without reloading
  if (updateHistory) {
    const url = new URL(window.location.href);
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
  catalogView.classList.remove('hidden');
  segmentedControl.classList.add('hidden');
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

function renderGallerySkeleton() {
  gridContainer.innerHTML = `
    <div class="skeleton-grid" style="grid-column: 1 / -1;">
      ${Array.from({ length: 8 }).map(() => '<div class="skeleton-card"></div>').join('')}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Filtering & Gallery Grid Rendering
// ---------------------------------------------------------------------------

function getFilteredGalleryItems() {
  return galleryData.filter(item => {
    if (!item.url) return false;

    // Search query filter against captions
    const matchesSearch = !searchQuery || (item.title && item.title.toLowerCase().includes(searchQuery.toLowerCase()));

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

  const fragment = document.createDocumentFragment();

  filtered.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'media-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `View photo ${index + 1}`);

    const badge = getResolutionBadge(item);
    const caption = item.title || (selectedTitle ? (selectedTitle.name || selectedTitle.id) : 'IMDb Master Photo');
    const previewUrl = getPreviewImageUrl(item.url, item.width, item.height, 720);

    card.innerHTML = `
      <div class="media-thumb-wrapper">
        <img class="media-thumb" src="${previewUrl}" alt="${escapeHtml(caption)}" loading="lazy">
        <span class="card-badge ${badge.isHigh ? 'high-res' : ''}" title="${badge.dim}">${badge.label}</span>
      </div>
      <div class="card-info">
        <div class="card-title" title="${escapeHtml(caption)}">${escapeHtml(caption)}</div>
      </div>
    `;

    const img = card.querySelector('.media-thumb');
    if (img.complete) {
      img.classList.add('loaded');
    } else {
      img.addEventListener('load', () => img.classList.add('loaded'));
    }

    card.addEventListener('click', () => openLightbox(index));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openLightbox(index);
      }
    });

    fragment.appendChild(card);
  });

  gridContainer.appendChild(fragment);
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

  const movieName = selectedTitle ? (selectedTitle.name || selectedTitle.id) : 'IMDb Master Photo';
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
      const captionText = item.title || (selectedTitle ? selectedTitle.name : '');
      lightboxCaption.textContent = `${captionText}${dims}`;
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

    const movieSlug = (selectedTitle ? (selectedTitle.name || selectedTitle.id) : 'imdb')
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
    const titleId = params.get('title');
    if (titleId) {
      switchToGalleryView(titleId, false);
    } else {
      if (e.state && typeof e.state.scrollY === 'number') {
        catalogScrollY = e.state.scrollY;
      }
      switchToCatalogView(false);
    }
  });

  // Global Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('active')) {
      // Focus search shortcut with '/'
      if (e.key === '/' && document.activeElement !== searchInput && document.activeElement !== dropdownSearchInput) {
        e.preventDefault();
        searchInput.focus();
      }
      return;
    }

    if (e.key === 'Escape') closeLightbox();
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
