/**
 * IMDb MediaViewer Gallery - Application Logic
 */

let titlesRegistry = [];
let selectedTitle = null;
let galleryData = [];
let currentFilter = 'all';
let searchQuery = '';
let currentLightboxIndex = 0;

// DOM Elements
const titleSelect = document.getElementById('title-select');
const gridContainer = document.getElementById('gallery-grid');
const countElement = document.getElementById('total-count');
const searchWrapper = document.getElementById('search-wrapper');
const searchInput = document.getElementById('search-input');
const searchClearBtn = document.getElementById('search-clear');
const filterBtns = document.querySelectorAll('.seg-btn');
const themeToggleBtn = document.getElementById('theme-toggle');
const themeIconMoon = document.getElementById('theme-icon-moon');
const themeIconSun = document.getElementById('theme-icon-sun');
const btnImdbLink = document.getElementById('btn-imdb-link');

// Lightbox Elements
const lightbox = document.getElementById('lightbox');
const lightboxBackdrop = document.getElementById('lightbox-backdrop');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxCounter = document.getElementById('lightbox-counter');
const lightboxMovieTitle = document.getElementById('lightbox-movie-title');
const lightboxCaption = document.getElementById('lightbox-caption');
const lightboxDownload = document.getElementById('lightbox-download');
const lightboxCopy = document.getElementById('lightbox-copy');
const copyBtnLabel = document.getElementById('copy-btn-label');
const btnClose = document.getElementById('btn-close');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');

// Initial entry point
async function init() {
  initTheme();
  setupEventListeners();
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
// Data Fetching
// ---------------------------------------------------------------------------

async function loadTitlesManifest() {
  const cacheBuster = Date.now();
  try {
    const res = await fetch(`titles.json?v=${cacheBuster}`);
    if (res.ok) {
      titlesRegistry = await res.json();
    }
  } catch (err) {
    console.warn('Could not load titles.json:', err);
  }

  titleSelect.innerHTML = '';

  if (titlesRegistry.length > 0) {
    titlesRegistry.forEach(title => {
      const option = document.createElement('option');
      option.value = title.file || `titles/${title.id}.json`;
      option.dataset.id = title.id;
      option.dataset.targetUrl = title.targetUrl || `https://www.imdb.com/title/${title.id}/`;
      option.textContent = `${title.name || title.id} (${title.itemCount || 0})`;
      titleSelect.appendChild(option);
    });

    // Check query param for preselected title (e.g. ?title=tt0038650)
    const params = new URLSearchParams(window.location.search);
    const requestedId = params.get('title');
    const matchingTitle = titlesRegistry.find(t => t.id === requestedId);

    if (matchingTitle) {
      titleSelect.value = matchingTitle.file || `titles/${matchingTitle.id}.json`;
    }

    await loadTitleGallery(titleSelect.value);
  } else {
    // Fallback directly to gallery.json if titles.json not yet populated
    const option = document.createElement('option');
    option.value = 'gallery.json';
    option.textContent = 'Default IMDb Gallery';
    titleSelect.appendChild(option);

    await loadTitleGallery('gallery.json');
  }
}

async function loadTitleGallery(jsonPath) {
  renderSkeleton();

  const cacheBuster = Date.now();
  try {
    const res = await fetch(`${jsonPath}?v=${cacheBuster}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} loading ${jsonPath}`);
    const data = await res.json();

    selectedTitle = data;
    galleryData = data.items || [];

    if (countElement) {
      countElement.textContent = galleryData.length.toLocaleString();
    }

    // Update external IMDb link button
    const currentOpt = titleSelect.selectedOptions[0];
    const titleId = currentOpt ? currentOpt.dataset.id : (data.id || null);
    if (btnImdbLink) {
      if (titleId) {
        btnImdbLink.href = `https://www.imdb.com/title/${titleId}/`;
        btnImdbLink.style.display = 'flex';
      } else {
        btnImdbLink.style.display = 'none';
      }
    }

    // Sync URL without reloading
    if (titleId) {
      const url = new URL(window.location.href);
      url.searchParams.set('title', titleId);
      window.history.replaceState({}, '', url.toString());
    }
  } catch (err) {
    console.error('Failed to load gallery JSON:', err);
    gridContainer.innerHTML = `
      <div class="empty-state">
        <h3>Could not load gallery</h3>
        <p>${escapeHtml(err.message)}</p>
      </div>
    `;
    return;
  }

  renderGrid();
}

function renderSkeleton() {
  gridContainer.innerHTML = `
    <div class="skeleton-grid" style="grid-column: 1 / -1;">
      ${Array.from({ length: 8 }).map(() => '<div class="skeleton-card"></div>').join('')}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Filtering & Grid Rendering
// ---------------------------------------------------------------------------

function getFilteredItems() {
  return galleryData.filter(item => {
    if (!item.url) return false;

    // Search query filter
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
  const filtered = getFilteredItems();
  gridContainer.innerHTML = '';

  if (countElement) {
    countElement.textContent = filtered.length.toLocaleString();
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

    card.innerHTML = `
      <div class="media-thumb-wrapper">
        <img class="media-thumb" src="${item.url}" alt="${escapeHtml(caption)}" loading="lazy">
        <span class="card-badge ${badge.isHigh ? 'high-res' : ''}" title="${badge.dim}">${badge.label}</span>
      </div>
      <div class="card-info">
        <div class="card-title" title="${escapeHtml(caption)}">${escapeHtml(caption)}</div>
      </div>
    `;

    // Image load fade-in
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
  const filtered = getFilteredItems();
  if (index < 0 || index >= filtered.length) return;

  currentLightboxIndex = index;
  updateLightboxContent();

  lightbox.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  lightbox.classList.remove('active');
  document.body.style.overflow = '';
}

function updateLightboxContent() {
  const filtered = getFilteredItems();
  const item = filtered[currentLightboxIndex];
  if (!item) return;

  lightboxImg.src = item.url;
  lightboxCounter.textContent = `${currentLightboxIndex + 1} / ${filtered.length}`;

  const movieName = selectedTitle ? (selectedTitle.name || selectedTitle.id) : 'IMDb Gallery';
  lightboxMovieTitle.textContent = movieName;

  const captionText = item.title || movieName;
  const dims = item.width && item.height ? ` · ${item.width} × ${item.height}` : '';
  lightboxCaption.textContent = `${captionText}${dims}`;

  lightboxDownload.href = item.url;
}

async function copyImageUrl() {
  const filtered = getFilteredItems();
  const item = filtered[currentLightboxIndex];
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
  const filtered = getFilteredItems();
  if (filtered.length <= 1) return;
  currentLightboxIndex = (currentLightboxIndex - 1 + filtered.length) % filtered.length;
  updateLightboxContent();
}

function nextImage() {
  const filtered = getFilteredItems();
  if (filtered.length <= 1) return;
  currentLightboxIndex = (currentLightboxIndex + 1) % filtered.length;
  updateLightboxContent();
}

// ---------------------------------------------------------------------------
// Event Listeners
// ---------------------------------------------------------------------------

function setupEventListeners() {
  titleSelect.addEventListener('change', () => {
    loadTitleGallery(titleSelect.value);
  });

  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    if (searchWrapper) {
      searchWrapper.classList.toggle('has-value', searchQuery.length > 0);
    }
    if (searchClearBtn) {
      searchClearBtn.classList.toggle('visible', searchQuery.length > 0);
    }
    renderGrid();
  });

  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      if (searchWrapper) {
        searchWrapper.classList.remove('has-value');
      }
      searchClearBtn.classList.remove('visible');
      renderGrid();
      searchInput.focus();
    });
  }

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderGrid();
    });
  });

  btnClose.addEventListener('click', closeLightbox);
  lightboxBackdrop.addEventListener('click', closeLightbox);
  btnPrev.addEventListener('click', prevImage);
  btnNext.addEventListener('click', nextImage);

  if (lightboxCopy) {
    lightboxCopy.addEventListener('click', copyImageUrl);
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', toggleTheme);
  }

  // Keyboard Navigation
  window.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('active')) {
      // Focus search shortcut with '/'
      if (e.key === '/' && document.activeElement !== searchInput) {
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
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}

// Run
init();
