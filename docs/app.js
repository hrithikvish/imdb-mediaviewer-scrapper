let galleryData = [];
let currentFilter = 'all';
let searchQuery = '';
let currentLightboxIndex = 0;

// DOM Elements
const gridContainer = document.getElementById('gallery-grid');
const countElement = document.getElementById('total-count');
const durationElement = document.getElementById('scrape-duration');
const searchInput = document.getElementById('search-input');
const filterBtns = document.querySelectorAll('.btn-filter');

// Lightbox Elements
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxCounter = document.getElementById('lightbox-counter');
const lightboxCaption = document.getElementById('lightbox-caption');
const lightboxDownload = document.getElementById('lightbox-download');
const btnClose = document.getElementById('btn-close');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');

// Fetch and initialize gallery data
async function loadGallery() {
  try {
    const response = await fetch('gallery.json');
    if (!response.ok) throw new Error('gallery.json not found');
    const data = await response.json();
    
    galleryData = data.items || [];
    if (countElement) countElement.textContent = galleryData.length;
    if (durationElement && data.durationMs) {
      durationElement.textContent = `${(data.durationMs / 1000).toFixed(1)}s`;
    }
  } catch (err) {
    console.warn('Could not load gallery.json, falling back to sample data:', err);
    galleryData = getFallbackData();
    if (countElement) countElement.textContent = galleryData.length;
  }

  renderGrid();
}

function getFilteredItems() {
  return galleryData.filter(item => {
    // Keep strictly movie media photos hosted on m.media-amazon.com/images
    if (!item.url || !item.url.startsWith('https://m.media-amazon.com/images')) {
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
    const title = item.title || 'IMDb Media Asset';

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
  lightboxCaption.textContent = item.title || `Asset ${currentLightboxIndex + 1}`;
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

// Event Listeners
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

// Keyboard navigation
window.addEventListener('keydown', (e) => {
  if (!lightbox.classList.contains('active')) return;

  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') prevImage();
  if (e.key === 'ArrowRight') nextImage();
});

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
}

function getFallbackData() {
  return [
    {
      url: "https://m.media-amazon.com/images/M/MV5BMDAyY2FhYjctNDc5OS00MDNlLThiMGUtY2UxYWVkNGY2ZjljXkEyXkFqcGc@._V1_.jpg",
      type: "IMAGE",
      width: 1200,
      height: 1800,
      title: "The Shawshank Redemption Master Poster"
    },
    {
      url: "https://m.media-amazon.com/images/M/MV5BNTQyNjllYTQtYjQyOC00MzJjLTlmYmYtMGQwYmE3ZDYwZWE2XkEyXkFqcGc@._V1_.jpg",
      type: "IMAGE",
      width: 2048,
      height: 2730,
      title: "Lawrence of Arabia Ultra High-Res Still"
    }
  ];
}

// Start
loadGallery();
