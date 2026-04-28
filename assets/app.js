const STORAGE_KEY = 'jazzys-books-v2';
const COVER_CACHE_KEY = 'jazzys-cover-cache-v1';

let books = [];
let activeView = 'library';
let cleanupFilter = 'none';
const coverQueue = new Set();
let pumpingCovers = false;

const els = {
  viewContainer: document.getElementById('viewContainer'),
  dashboard: document.getElementById('dashboardCards'),
  search: document.getElementById('searchInput'),
  statusFilter: document.getElementById('statusFilter'),
  ratingFilter: document.getElementById('ratingFilter'),
  favoriteFilter: document.getElementById('favoriteFilter'),
  cleanupControls: document.getElementById('cleanupControls')
};

const coverCache = JSON.parse(localStorage.getItem(COVER_CACHE_KEY) || '{}');

function normalizeBook(book = {}) {
  return {
    id: book.id || crypto.randomUUID(),
    title: (book.title || 'Untitled').trim(),
    author: (book.author || '').trim(),
    series: (book.series || '').trim(),
    status: ['read', 'need-to-finish', 'dnf'].includes(book.status) ? book.status : 'need-to-finish',
    rating: Number.isFinite(Number(book.rating)) ? Number(book.rating) : null,
    favorite: Boolean(book.favorite),
    comments: book.comments || '',
    cover_url: book.cover_url || '',
    cover_source: book.cover_source || '',
    isbn: (book.isbn || '').trim(),
    openlibrary_key: book.openlibrary_key || '',
    google_books_id: book.google_books_id || '',
    cover_checked_at: book.cover_checked_at || ''
  };
}

function saveBooks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(books));
  localStorage.setItem(COVER_CACHE_KEY, JSON.stringify(coverCache));
}

async function loadBooks() {
  const local = localStorage.getItem(STORAGE_KEY);
  if (local) {
    books = JSON.parse(local).map(normalizeBook);
    renderAll();
    return;
  }
  const res = await fetch('dylan_books_partially_filled.json');
  const data = await res.json();
  books = data.map(normalizeBook);
  saveBooks();
  renderAll();
}

function filteredBooks() {
  const search = els.search.value.toLowerCase().trim();
  return books.filter((book) => {
    const searchHit = !search || [book.title, book.author, book.series].some(v => (v || '').toLowerCase().includes(search));
    const statusHit = els.statusFilter.value === 'all' || book.status === els.statusFilter.value;
    const ratingValue = els.ratingFilter.value;
    const ratingHit = ratingValue === 'all' || (ratingValue === 'missing' ? !book.rating : Number(ratingValue) === book.rating);
    const favoriteHit = !els.favoriteFilter.checked || book.favorite;
    const cleanupHit = matchesCleanup(book);
    return searchHit && statusHit && ratingHit && favoriteHit && cleanupHit;
  });
}

function matchesCleanup(book) {
  if (cleanupFilter === 'none') return true;
  if (cleanupFilter === 'missing-author') return !book.author;
  if (cleanupFilter === 'missing-series') return !book.series;
  if (cleanupFilter === 'missing-rating') return !book.rating;
  if (cleanupFilter === 'missing-cover') return !book.cover_url;
  if (cleanupFilter === 'need-to-finish') return book.status === 'need-to-finish';
  if (cleanupFilter === 'dnf') return book.status === 'dnf';
  return true;
}

function renderAll() {
  renderDashboard();
  renderView();
}

function renderDashboard() {
  const metrics = {
    'Total books': books.length,
    'Read books': books.filter(b => b.status === 'read').length,
    'Need finish / DNF': books.filter(b => ['need-to-finish', 'dnf'].includes(b.status)).length,
    'Favorites': books.filter(b => b.favorite).length,
    'Missing author': books.filter(b => !b.author).length,
    'Missing series': books.filter(b => !b.series).length,
    'Unrated': books.filter(b => !b.rating).length,
    'Missing cover': books.filter(b => !b.cover_url).length
  };
  els.dashboard.innerHTML = Object.entries(metrics).map(([label, value]) => `
    <article class="metric-card glass-card"><div class="metric-label">${label}</div><div class="metric-value">${value}</div></article>
  `).join('');
}

function renderView() {
  const list = filteredBooks();
  els.cleanupControls.classList.toggle('hidden', activeView !== 'cleanup');
  if (activeView === 'library') renderLibrary(list);
  if (activeView === 'cards') renderCards(list);
  if (activeView === 'series') renderSeries(list);
  if (activeView === 'cleanup') renderCleanup(list);
  if (activeView === 'taste') renderTaste();
  queueVisibleCovers();
}

function coverHTML(book) {
  const safeAlt = `Cover for ${book.title} by ${book.author || 'Unknown Author'}`;
  if (book.cover_url) {
    return `<div class="cover-wrap"><img loading="lazy" src="${book.cover_url}" alt="${safeAlt}" onerror="window.__coverError('${book.id}')"></div>`;
  }
  const text = `${book.title}\n${book.author || 'Unknown Author'}`;
  return `<div class="cover-wrap loading" data-cover-id="${book.id}"><div class="cover-placeholder"><div class="cover-inner">${text}</div></div></div>`;
}

function renderLibrary(list) {
  els.viewContainer.innerHTML = `<section class="library-list">${list.map((book) => `
    <article class="library-item" data-book-id="${book.id}">
      ${coverHTML(book)}
      <div>
        <h3>${book.title}</h3>
        <div class="small">${book.author || 'Unknown Author'}${book.series ? ` · ${book.series}` : ''}</div>
        <div class="row-meta">
          <span class="pill">${book.status}</span>
          <span class="pill">${book.rating ? `${book.rating}★` : 'No rating'}</span>
        </div>
        <input data-field="comments" placeholder="Comments" value="${escapeHtml(book.comments)}" />
      </div>
      <div class="actions">
        <button class="icon-btn favorite ${book.favorite ? 'active' : ''}" data-action="favorite">❤</button>
        <button class="icon-btn" data-action="refresh-cover">Refresh cover</button>
      </div>
    </article>
  `).join('')}</section>`;
}

function renderCards(list) {
  els.viewContainer.innerHTML = `<section class="cards-grid">${list.map((book) => `
    <article class="book-card" data-book-id="${book.id}">
      ${coverHTML(book)}
      <strong>${book.title}</strong>
      <span class="small">${book.author || 'Unknown Author'}</span>
      <span class="small">${book.series || 'Standalone'}</span>
      <div class="row-meta"><span class="pill">${book.status}</span><span class="pill">${book.rating ? `${book.rating}★` : 'Unrated'}</span></div>
      <div class="actions">
        <button class="icon-btn favorite ${book.favorite ? 'active' : ''}" data-action="favorite">❤</button>
        <button class="icon-btn" data-action="refresh-cover">Refresh cover</button>
      </div>
    </article>
  `).join('')}</section>`;
}

function renderSeries(list) {
  const groups = new Map();
  list.forEach(b => {
    const key = b.series || 'Unsorted / Standalone';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  });
  els.viewContainer.innerHTML = `<section class="series-grid">${[...groups.entries()].map(([name, group], idx) => {
    const read = group.filter(b => b.status === 'read').length;
    const ntf = group.filter(b => b.status === 'need-to-finish').length;
    const dnf = group.filter(b => b.status === 'dnf').length;
    const complete = ntf === 0 ? 'Complete-ish' : 'Incomplete';
    const collage = group.slice(0, 4).map(b => b.cover_url
      ? `<img src="${b.cover_url}" alt="${escapeHtml(b.title)} cover" loading="lazy">`
      : `<div class="mini-placeholder"></div>`).join('');
    return `<article class="series-card">
      <div class="series-header" data-series-toggle="${idx}">
        <div><h3>${name}</h3><div class="small">${group.length} books · ${complete}</div></div>
        <div class="series-collage">${collage}</div>
      </div>
      <div class="row-meta"><span class="pill">Read ${read}</span><span class="pill">Need ${ntf}</span><span class="pill">DNF ${dnf}</span></div>
      <div id="series-${idx}" class="series-books hidden">${group.map(b => `<div>${b.title} <span class="small">${b.author || 'Unknown Author'} · ${b.status}</span></div>`).join('')}</div>
    </article>`;
  }).join('')}</section>`;
}

function renderCleanup(list) {
  const chips = [
    ['none', 'All'], ['missing-author', 'Missing author'], ['missing-series', 'Missing series'],
    ['missing-rating', 'Missing rating'], ['missing-cover', 'Missing cover'], ['need-to-finish', 'Need to finish'], ['dnf', 'DNF']
  ];
  els.cleanupControls.innerHTML = `<div class="cleanup-wrap">${chips.map(([k, label]) => `<button class="cleanup-chip ${cleanupFilter===k?'active':''}" data-cleanup="${k}">${label}</button>`).join('')}</div>`;
  renderLibrary(list);
}

function renderTaste() {
  const top = (items) => Object.entries(items).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const countBy = (arr, pick) => arr.reduce((acc, item)=>{ const k = pick(item) || 'Unknown'; acc[k]=(acc[k]||0)+1; return acc; }, {});
  const byAuthor = countBy(books, b => b.author || 'Unknown');
  const bySeries = countBy(books, b => b.series || 'Standalone');
  const fav = books.filter(b => b.favorite);
  const rating = countBy(books.filter(b=>b.rating), b => `${b.rating}★`);
  const status = countBy(books, b => b.status);
  const coverage = books.length ? Math.round((books.filter(b=>b.cover_url).length / books.length) * 100) : 0;
  const box = (title, rows) => `<article class="taste-box"><h3>${title}</h3>${rows.map(r=>`<div class="small">${r[0]}: <strong>${r[1]}</strong></div>`).join('')}</article>`;
  els.viewContainer.innerHTML = `<section class="taste-grid">
    ${box('Most common authors', top(byAuthor))}
    ${box('Most common series', top(bySeries))}
    ${box('Favorite authors', top(countBy(fav, b => b.author || 'Unknown')))}
    ${box('Favorite series', top(countBy(fav, b => b.series || 'Standalone')))}
    ${box('Status breakdown', Object.entries(status))}
    ${box('Rating breakdown', Object.entries(rating))}
    <article class="taste-box"><h3>Cover coverage</h3><div class="metric-value">${coverage}%</div></article>
  </section>`;
}

function queueVisibleCovers() {
  document.querySelectorAll('[data-cover-id]').forEach(node => {
    coverQueue.add(node.dataset.coverId);
  });
  pumpCoverQueue();
}

async function pumpCoverQueue() {
  if (pumpingCovers) return;
  pumpingCovers = true;
  while (coverQueue.size) {
    const id = [...coverQueue][0];
    coverQueue.delete(id);
    const book = books.find(b => b.id === id);
    if (book && !book.cover_url) await fetchAndSetCover(book, false);
    await new Promise(r => setTimeout(r, 40));
  }
  pumpingCovers = false;
}

async function fetchAndSetCover(book, forceRefresh = false) {
  try {
    const cacheKey = `${book.title}|${book.author}|${book.isbn}`;
    if (!forceRefresh && coverCache[cacheKey]) {
      Object.assign(book, coverCache[cacheKey]);
      saveBooks();
      renderAll();
      return;
    }
    let result = await fetchFromOpenLibrary(book);
    if (!result) result = await fetchFromGoogle(book);
    if (!result) result = { cover_url: '', cover_source: 'placeholder' };
    Object.assign(book, result, { cover_checked_at: new Date().toISOString() });
    coverCache[cacheKey] = { cover_url: book.cover_url, cover_source: book.cover_source, openlibrary_key: book.openlibrary_key, google_books_id: book.google_books_id, cover_checked_at: book.cover_checked_at };
    saveBooks();
    renderAll();
  } catch {
    book.cover_checked_at = new Date().toISOString();
    saveBooks();
  }
}

async function fetchFromOpenLibrary(book) {
  if (book.isbn) {
    const url = `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(book.isbn)}-L.jpg`;
    const ok = await imageExists(url);
    if (ok) return { cover_url: url, cover_source: 'openlibrary_isbn' };
  }
  const q = `https://openlibrary.org/search.json?title=${encodeURIComponent(book.title)}&author=${encodeURIComponent(book.author || '')}`;
  const res = await fetch(q);
  if (!res.ok) return null;
  const data = await res.json();
  const doc = data.docs?.find(d => d.cover_i);
  if (!doc?.cover_i) return null;
  return {
    cover_url: `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`,
    cover_source: 'openlibrary_search',
    openlibrary_key: doc.key || ''
  };
}

async function fetchFromGoogle(book) {
  const q = `https://www.googleapis.com/books/v1/volumes?q=intitle:${encodeURIComponent(book.title)}+inauthor:${encodeURIComponent(book.author || '')}`;
  const res = await fetch(q);
  if (!res.ok) return null;
  const data = await res.json();
  const item = data.items?.[0];
  const thumb = item?.volumeInfo?.imageLinks?.thumbnail;
  if (!thumb) return null;
  return {
    cover_url: thumb.replace('http://', 'https://'),
    cover_source: 'google_books',
    google_books_id: item.id || ''
  };
}

function imageExists(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

function bindEvents() {
  document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => {
    activeView = btn.dataset.view;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === btn));
    renderView();
  }));
  [els.search, els.statusFilter, els.ratingFilter, els.favoriteFilter].forEach(el => el.addEventListener('input', renderView));

  document.body.addEventListener('click', (e) => {
    const card = e.target.closest('[data-book-id]');
    const id = card?.dataset.bookId;
    const book = books.find(b => b.id === id);
    if (!book) return;
    if (e.target.dataset.action === 'favorite') { book.favorite = !book.favorite; saveBooks(); renderAll(); }
    if (e.target.dataset.action === 'refresh-cover') fetchAndSetCover(book, true);
    if (e.target.dataset.cleanup) { cleanupFilter = e.target.dataset.cleanup; renderView(); }
    const toggle = e.target.closest('[data-series-toggle]');
    if (toggle) document.getElementById(`series-${toggle.dataset.seriesToggle}`)?.classList.toggle('hidden');
  });

  document.body.addEventListener('change', (e) => {
    const input = e.target.closest('input[data-field="comments"]');
    const card = e.target.closest('[data-book-id]');
    if (!input || !card) return;
    const book = books.find(b => b.id === card.dataset.bookId);
    if (book) { book.comments = input.value; saveBooks(); }
  });

  document.getElementById('addBookForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    books.unshift(normalizeBook(Object.fromEntries(form.entries())));
    e.target.reset();
    saveBooks();
    renderAll();
  });

  document.getElementById('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(books, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'jazzys-books-export.json'; a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('importInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const json = JSON.parse(await file.text());
    books = json.map(normalizeBook);
    saveBooks();
    renderAll();
  });

  document.getElementById('refreshMissingCoversBtn').addEventListener('click', async () => {
    const missing = books.filter(b => !b.cover_url).slice(0, 60);
    for (const b of missing) {
      await fetchAndSetCover(b, true);
      await new Promise(r => setTimeout(r, 80));
    }
  });
}

function escapeHtml(str) {
  return (str || '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}

window.__coverError = (id) => {
  const book = books.find(b => b.id === id);
  if (!book) return;
  book.cover_url = '';
  book.cover_source = 'placeholder';
  saveBooks();
  renderAll();
};

bindEvents();
loadBooks().catch(() => {
  books = [];
  renderAll();
});
