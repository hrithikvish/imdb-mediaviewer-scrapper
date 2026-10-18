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
const durationElement = document.getElementById('scrape-duration');
const searchInput = document.getElementById('search-input');
const filterBtns = document.querySelectorAll('.btn-filter');
const themeToggleBtn = document.getElementById('theme-toggle');
const themeIcon = document.getElementById('theme-icon');

// Lightbox Elements
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxCounter = document.getElementById('lightbox-counter');
const lightboxCaption = document.getElementById('lightbox-caption');
const lightboxDownload = document.getElementById('lightbox-download');
const btnClose = document.getElementById('btn-close');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');

// Initial entry point
async function init() {
  initTheme();
  await loadTitlesManifest();
  setupEventListeners();
}

// Theme handling
function initTheme() {
  const savedTheme = localStorage.getItem('imdb_gallery_theme');
  const initialTheme = savedTheme || 'dark';
  applyTheme(initialTheme);
}

function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    if (themeIcon) themeIcon.textContent = '☀️';
    if (themeToggleBtn) themeToggleBtn.title = 'Switch to Dark Theme';
  } else {
    document.documentElement.removeAttribute('data-theme');
    if (themeIcon) themeIcon.textContent = '🌙';
    if (themeToggleBtn) themeToggleBtn.title = 'Switch to Light Theme';
  }
  localStorage.setItem('imdb_gallery_theme', theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const next = current === 'light' ? 'dark' : 'light';
  applyTheme(next);
}

// 1. Load Master titles.json
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

  // Populate title dropdown
  titleSelect.innerHTML = '';

  if (titlesRegistry.length > 0) {
    titlesRegistry.forEach(title => {
      const option = document.createElement('option');
      option.value = title.file || `titles/${title.id}.json`;
      option.dataset.id = title.id;
      option.textContent = `${title.name || title.id} (${title.itemCount || 0} photos)`;
      titleSelect.appendChild(option);
    });

    // Check URL query param: e.g. ?title=tt0056241
    const params = new URLSearchParams(window.location.search);
    const requestedId = params.get('title');
    const matchingTitle = titlesRegistry.find(t => t.id === requestedId);

    if (matchingTitle) {
      titleSelect.value = matchingTitle.file || `titles/${matchingTitle.id}.json`;
    }

    await loadTitleGallery(titleSelect.value);
  } else {
    // Fallback directly to gallery.json if titles.json not yet generated
    const option = document.createElement('option');
    option.value = 'gallery.json';
    option.textContent = 'Default IMDb Gallery';
    titleSelect.appendChild(option);

    await loadTitleGallery('gallery.json');
  }
}

// 2. Load specific title gallery (e.g. titles/tt0056241.json)
async function loadTitleGallery(jsonPath) {
  gridContainer.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;"><p>⏳ Loading gallery photos...</p></div>';
  const cacheBuster = Date.now();

  try {
    const res = await fetch(`${jsonPath}?v=${cacheBuster}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} loading ${jsonPath}`);
    const data = await res.json();

    selectedTitle = data;
    galleryData = data.items || [];

    if (countElement) countElement.textContent = galleryData.length;
    if (durationElement) {
      durationElement.textContent = data.durationMs ? `${(data.durationMs / 1000).toFixed(1)}s` : '--';
    }

    // Update browser URL query param cleanly without reloading
    const currentOpt = titleSelect.selectedOptions[0];
    const currentId = currentOpt ? currentOpt.dataset.id : null;
    if (currentId) {
      const url = new URL(window.location.href);
      url.searchParams.set('title', currentId);
      window.history.replaceState({}, '', url.toString());
    }
  } catch (err) {
    console.error('Failed to load gallery JSON:', err);
    gridContainer.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <h3>Could not load gallery data</h3>
        <p>${err.message}</p>
      </div>
    `;
    return;
  }

  renderGrid();
}

function getFilteredItems() {
  return galleryData.filter(item => {
    // Allow Amazon Media assets or valid image URLs
    if (!item.url || (!item.url.includes('m.media-amazon.com/images/M/') && !item.url.includes('m.media-amazon.com/images'))) {
      return false;
    }

    // Search query filter
    const titleMatch = !searchQuery || (item.title && item.title.toLowerCase().includes(searchQuery.toLowerCase()));

    // Resolution filter
    let resMatch = true;
    if (currentFilter === 'high') {
      resMatch = (item.width && item.width >= 1080) || (item.height && item.height >= 1080);
    }

    return titleMatch && resMatch;
  });
}

function renderGrid() {
  const filtered = getFilteredItems();
  gridContainer.innerHTML = '';

  if (filtered.length === 0) {
    gridContainer.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <h3>No photos match your filter</h3>
        <p>Try clearing your search query or resolution filter.</p>
      </div>
    `;
    return;
  }

  filtered.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'media-card';
    card.onclick = () => openLightbox(index);

    const dims = item.width && item.height ? `${item.width} × ${item.height}` : 'Master Res';
    const title = item.title || (selectedTitle ? selectedTitle.name : 'IMDb Media Asset');

    card.innerHTML = `
      <div class="media-thumb-wrapper">
        <img class="media-thumb" src="${item.url}" alt="${escapeHtml(title)}" loading="lazy">
        <div class="card-overlay">
          <span class="resolution-badge">${dims}</span>
        </div>
      </div>
      <div class="card-info">
        <div class="card-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
      </div>
    `;

    gridContainer.appendChild(card);
  });
}

// Lightbox / Carousel logic
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
  lightboxCaption.textContent = item.title || (selectedTitle ? selectedTitle.name : `Asset ${currentLightboxIndex + 1}`);
  lightboxDownload.href = item.url;
}

function prevImage() {
  const filtered = getFilteredItems();
  currentLightboxIndex = (currentLightboxIndex - 1 + filtered.length) % filtered.length;
  updateLightboxContent();
}

function nextImage() {
  const filtered = getFilteredItems();
  currentLightboxIndex = (currentLightboxIndex + 1) % filtered.length;
  updateLightboxContent();
}

// Event Listeners setup
function setupEventListeners() {
  titleSelect.addEventListener('change', () => {
    loadTitleGallery(titleSelect.value);
  });

  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    renderGrid();
  });

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderGrid();
    });
  });

  btnClose.onclick = closeLightbox;
  btnPrev.onclick = prevImage;
  btnNext.onclick = nextImage;

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', toggleTheme);
  }

  // Keyboard navigation
  window.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('active')) return;

    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') prevImage();
    if (e.key === 'ArrowRight') nextImage();
  });
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
}

// Run
init();
