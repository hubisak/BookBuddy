'use strict';

/* ─────────────────────────────────────────────────────────────
   1. KONSTANTY
───────────────────────────────────────────────────────────── */

// Základní adresy a mapy, ze kterých aplikace skládá dotazy a popisky.
const API_URL = 'https://openlibrary.org/search.json';
const COVER_URL = 'https://covers.openlibrary.org/b';
const STORAGE_KEYS = {
  library: 'bb_library',
  prefs: 'bb_prefs',
};

const DEFAULT_PREFS = {
  name: '',
  genre: '',
  goal: 12,
  theme: 'dark',
};

const GENRES = [
  'Fantasy', 'Sci-Fi', 'Thriller', 'Romantika', 'Detektivka',
  'Horror', 'Historický román', 'Biografie', 'Filozofie',
  'Naučná literatura', 'Poezie', 'Humor',
];

const GENRE_EN = {
  'Fantasy': 'fantasy',
  'Sci-Fi': 'science fiction',
  'Thriller': 'thriller',
  'Romantika': 'romance',
  'Detektivka': 'detective',
  'Horror': 'horror',
  'Historický román': 'historical fiction',
  'Biografie': 'biography',
  'Filozofie': 'philosophy',
  'Naučná literatura': 'popular science',
  'Poezie': 'poetry',
  'Humor': 'humor',
};

const STATUS_LABEL = { read: 'Přečteno', reading: 'Právě čtu', want: 'Chci číst' };
const STATUS_ICON  = { read: '✓', reading: '📖', want: '🔖' };


/* ─────────────────────────────────────────────────────────────
   2. STAV APLIKACE
───────────────────────────────────────────────────────────── */

// Centrální stav aplikace: uložené knihy, nastavení i dočasná data obrazovek.
const state = {
  library: [],
  prefs: Object.assign({}, DEFAULT_PREFS),
  libFilter: 'all',
  libSort: 'added',
  addStars: 0,
  detailBook: null,
  detailStatus: 'want',
  detailStars: 0,
  searchDebounce: null,
  lastSuggestToken: 0,
};


/* ─────────────────────────────────────────────────────────────
   3. LOCALSTORAGE
───────────────────────────────────────────────────────────── */

// Načte knihovnu a nastavení z localStorage po spuštění aplikace.
function loadData() {
  try {
    const lib = localStorage.getItem(STORAGE_KEYS.library);
    const prefs = localStorage.getItem(STORAGE_KEYS.prefs);

    if (lib) state.library = JSON.parse(lib);
    if (prefs) Object.assign(state.prefs, DEFAULT_PREFS, JSON.parse(prefs));
  } catch (e) {
    console.warn('BookBuddy: chyba při načítání dat', e);
    state.library = [];
    state.prefs = Object.assign({}, DEFAULT_PREFS);
  }
}

// Uloží aktuální knihovnu do prohlížeče.
function saveLibrary() {
  localStorage.setItem(STORAGE_KEYS.library, JSON.stringify(state.library));
}

// Uloží uživatelské nastavení do prohlížeče.
function savePrefs() {
  localStorage.setItem(STORAGE_KEYS.prefs, JSON.stringify(state.prefs));
}


/* ─────────────────────────────────────────────────────────────
   4. TÉMA
───────────────────────────────────────────────────────────── */

// Přepne vzhled stránky podle zvoleného světlého nebo tmavého režimu.
function applyTheme() {
  document.body.classList.toggle('light', state.prefs.theme === 'light');
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = state.prefs.theme === 'light' ? '🌙' : '☀️';
}

// Změní téma a ihned ho uloží.
function toggleTheme() {
  state.prefs.theme = state.prefs.theme === 'dark' ? 'light' : 'dark';
  savePrefs();
  applyTheme();
  toast(state.prefs.theme === 'light' ? 'Světlý režim ☀️' : 'Tmavý režim 🌙');
}


/* ─────────────────────────────────────────────────────────────
   5. NAVIGACE
───────────────────────────────────────────────────────────── */

// Přepíná hlavní obrazovky aplikace přes spodní navigaci.
function showScreen(id, navBtn) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');

  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  if (navBtn) navBtn.classList.add('active');

  closeSuggestions();

  if (id === 'home') renderHome();
  if (id === 'library') renderLibrary();
  if (id === 'search') renderSearchScreen();
  if (id === 'profile') renderProfile();
}

// Po změně dat překreslí hlavní části aplikace, aby vše zůstalo synchronní.
function refreshAppViews() {
  renderHome();
  renderLibrary();
  renderProfile();
}

// Vygeneruje volby žánrů do selectu z jednoho společného zdroje.
function renderGenreSelect(selectId, includeEmptyOption) {
  var select = document.getElementById(selectId);
  if (!select) return;

  var options = GENRES.map(function(genre) {
    return '<option>' + escapeHtml(genre) + '</option>';
  }).join('');

  select.innerHTML = includeEmptyOption
    ? '<option value="">— Vyber žánr —</option>' + options
    : options;
}


/* ─────────────────────────────────────────────────────────────
   6. TOAST
───────────────────────────────────────────────────────────── */

let toastTimer = null;

// Krátká informační hláška ve spodní části obrazovky.
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}


/* ─────────────────────────────────────────────────────────────
   7. OPEN LIBRARY API
───────────────────────────────────────────────────────────── */

// Odešle hledání do Open Library a vrátí seznam nalezených knih.
async function searchOpenLibrary(query, maxResults) {
  maxResults = maxResults || 20;

  const fields = [
    'key',
    'title',
    'author_name',
    'cover_i',
    'subject',
    'first_publish_year',
    'number_of_pages_median',
    'edition_key',
    'isbn'
  ].join(',');

  const url = API_URL
    + '?q=' + encodeURIComponent(query)
    + '&limit=' + encodeURIComponent(maxResults)
    + '&fields=' + encodeURIComponent(fields);

  let response;

  try {
    response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
    });
  } catch (networkErr) {
    throw new Error('NETWORK_ERROR: ' + (networkErr.message || 'Failed to fetch'));
  }

  if (!response.ok) {
    let body = '';
    try {
      body = await response.text();
    } catch (e) {
      body = '';
    }
    throw new Error('HTTP_ERROR: ' + response.status + (body ? ' | ' + body : ''));
  }

  let json;
  try {
    json = await response.json();
  } catch (parseErr) {
    throw new Error('PARSE_ERROR: Neplatná odpověď API');
  }

  return json.docs || [];
}

// Složí adresu obálky knihy podle dostupných dat z API.
function buildCoverUrl(item, size) {
  size = size || 'M';

  if (item.cover_i) {
    return COVER_URL + '/id/' + item.cover_i + '-' + size + '.jpg';
  }

  if (item.isbn && item.isbn.length) {
    return COVER_URL + '/isbn/' + item.isbn[0] + '-' + size + '.jpg';
  }

  if (item.edition_key && item.edition_key.length) {
    return COVER_URL + '/olid/' + item.edition_key[0] + '-' + size + '.jpg';
  }

  return null;
}

// Převede technické předměty z API na jednodušší žánry pro uživatele.
function normalizeGenre(subjects) {
  if (!Array.isArray(subjects) || !subjects.length) return '';

  const lowered = subjects.map(function(s) { return String(s).toLowerCase(); });

  if (lowered.some(function(s) { return s.includes('fantasy'); })) return 'Fantasy';
  if (lowered.some(function(s) { return s.includes('science fiction') || s.includes('sci-fi'); })) return 'Sci-Fi';
  if (lowered.some(function(s) { return s.includes('thriller'); })) return 'Thriller';
  if (lowered.some(function(s) { return s.includes('romance'); })) return 'Romantika';
  if (lowered.some(function(s) { return s.includes('detective') || s.includes('mystery'); })) return 'Detektivka';
  if (lowered.some(function(s) { return s.includes('horror'); })) return 'Horror';
  if (lowered.some(function(s) { return s.includes('historical fiction') || s.includes('history'); })) return 'Historický román';
  if (lowered.some(function(s) { return s.includes('biography') || s.includes('memoir'); })) return 'Biografie';
  if (lowered.some(function(s) { return s.includes('philosophy'); })) return 'Filozofie';
  if (lowered.some(function(s) { return s.includes('science') || s.includes('popular science') || s.includes('nonfiction'); })) return 'Naučná literatura';
  if (lowered.some(function(s) { return s.includes('poetry'); })) return 'Poezie';
  if (lowered.some(function(s) { return s.includes('humor') || s.includes('comedy'); })) return 'Humor';

  return subjects[0] || '';
}

// Převede syrovou odpověď API na jednotný objekt knihy pro aplikaci.
function parseOpenLibraryBook(item) {
  return {
    openKey: item.key || null,
    editionKey: item.edition_key && item.edition_key.length ? item.edition_key[0] : null,
    title: item.title || 'Bez názvu',
    author: (item.author_name || []).join(', ') || '',
    cover: buildCoverUrl(item, 'M'),
    genre: normalizeGenre(item.subject),
    description: '',
    pages: item.number_of_pages_median || null,
    year: item.first_publish_year || null,
    status: null,
    rating: 0,
    note: '',
    subjects: item.subject || [],
    isbn: item.isbn && item.isbn.length ? item.isbn[0] : null,
  };
}

// Překládá technické chyby hledání na srozumitelnou zprávu pro uživatele.
function getSearchErrorMessage(err) {
  const msg = String(err && err.message ? err.message : err);

  if (msg.includes('HTTP_ERROR: 429')) {
    return {
      title: 'Příliš mnoho požadavků',
      text: 'Open Library je teď dočasně vytížené. Zkus hledání za chvíli znovu.',
    };
  }

  if (msg.includes('HTTP_ERROR: 500') || msg.includes('HTTP_ERROR: 503')) {
    return {
      title: 'Server je dočasně nedostupný',
      text: 'Open Library má momentálně problém. Zkus to znovu za chvíli.',
    };
  }

  if (msg.includes('NETWORK_ERROR')) {
    return {
      title: 'Nepodařilo se připojit',
      text: 'Aplikace se nedokázala spojit s Open Library. Zkontroluj síť nebo hosting aplikace.',
    };
  }

  if (msg.includes('PARSE_ERROR')) {
    return {
      title: 'Chybná odpověď serveru',
      text: 'Server vrátil neplatná data. Zkus hledání znovu.',
    };
  }

  return {
    title: 'Chyba hledání',
    text: 'Nepodařilo se načíst výsledky z Open Library.',
  };
}


/* ─────────────────────────────────────────────────────────────
   8. DOMÁCÍ OBRAZOVKA
───────────────────────────────────────────────────────────── */

// Složí domovskou obrazovku z několika menších sekcí.
function renderHome() {
  renderStats();
  renderCurrentlyReading();
  renderRecommendations();
  renderRecentlyAdded();
}

// Spočítá a vykreslí základní statistiky čtení.
function renderStats() {
  const read = state.library.filter(function(b) { return b.status === 'read'; }).length;
  const reading = state.library.filter(function(b) { return b.status === 'reading'; }).length;
  const want = state.library.filter(function(b) { return b.status === 'want'; }).length;
  const goal = state.prefs.goal || 12;
  const pct = Math.min(100, Math.round((read / goal) * 100));

  document.getElementById('stats-grid').innerHTML =
    '<div class="stat-card" data-icon="✓">' +
      '<div class="stat-num">' + read + '</div>' +
      '<div class="stat-label">Přečteno</div>' +
    '</div>' +
    '<div class="stat-card" data-icon="📖">' +
      '<div class="stat-num">' + reading + '</div>' +
      '<div class="stat-label">Čtu teď</div>' +
    '</div>' +
    '<div class="stat-card" data-icon="🔖">' +
      '<div class="stat-num">' + want + '</div>' +
      '<div class="stat-label">Chci přečíst</div>' +
    '</div>' +
    '<div class="stat-card" data-icon="🎯">' +
      '<div class="stat-num">' + pct + '%</div>' +
      '<div class="stat-label">Cíl ' + goal + '/rok</div>' +
      '<div class="stat-progress">' +
        '<div class="stat-progress-bar" style="width:' + pct + '%"></div>' +
      '</div>' +
    '</div>';
}

// Zobrazí knihy, které má uživatel právě rozčtené.
function renderCurrentlyReading() {
  const section = document.getElementById('home-reading');
  const books = state.library.filter(function(b) { return b.status === 'reading'; });

  if (!books.length) { section.innerHTML = ''; return; }

  section.innerHTML =
    '<div class="section-title" style="margin-bottom:12px">' +
      '📖 Právě čtu ' +
      '<span class="label-chip">' + books.length + '</span>' +
    '</div>';

  books.forEach(function(b) { section.appendChild(buildBookCard(b)); });
}

// Zobrazí naposledy přidané knihy v horizontálním seznamu.
function renderRecentlyAdded() {
  const section = document.getElementById('home-recent');
  const recent = state.library.slice().reverse().slice(0, 8);

  if (!recent.length) { section.innerHTML = ''; return; }

  section.innerHTML =
    '<div class="section-title" style="margin-bottom:12px">🕒 Naposledy přidáno</div>' +
    '<div class="h-scroll" id="recent-hscroll"></div>';

  const scroll = document.getElementById('recent-hscroll');
  recent.forEach(function(b) { scroll.appendChild(buildHCard(b)); });
}

// Podle nejčastějšího žánru načte doporučené knihy z API.
function renderRecommendations() {
  const section = document.getElementById('home-recs');
  const readBooks = state.library.filter(function(b) {
    return b.status === 'read' || b.status === 'reading';
  });

  if (!readBooks.length) {
    section.innerHTML =
      '<div class="section-title" style="margin-bottom:12px">✨ Doporučení</div>' +
      '<div class="empty-state" style="padding:32px 16px">' +
        '<div class="empty-icon">🔭</div>' +
        '<div class="empty-text">Přidej a označ pár knih jako přečtené — doporučíme ti další!</div>' +
      '</div>';
    return;
  }

  const genreCount = {};
  readBooks.forEach(function(b) {
    if (b.genre) genreCount[b.genre] = (genreCount[b.genre] || 0) + 1;
  });

  const genreEntries = Object.entries(genreCount);
  if (!genreEntries.length) {
    section.innerHTML =
      '<div class="section-title" style="margin-bottom:12px">✨ Doporučení</div>' +
      '<div class="empty-state" style="padding:32px 16px">' +
        '<div class="empty-icon">📚</div>' +
        '<div class="empty-text">Zatím není dost dat pro doporučení.</div>' +
      '</div>';
    return;
  }

  const topGenre = genreEntries.sort(function(a, b) { return b[1] - a[1]; })[0][0];
  const query = GENRE_EN[topGenre] || topGenre;

  section.innerHTML =
    '<div class="section-title" style="margin-bottom:4px">✨ Doporučeno pro tebe</div>' +
    '<p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">' +
      'Podle žánru: <strong style="color:var(--accent)">' + escapeHtml(topGenre) + '</strong>' +
    '</p>' +
    '<div class="spinner-wrap"><div class="spinner"></div>Načítám…</div>';

  searchOpenLibrary(query, 12)
    .then(function(items) {
      const myIds = new Set(state.library.map(function(b) { return b.openKey || b.id; }).filter(Boolean));
      const fresh = items
        .map(parseOpenLibraryBook)
        .filter(function(book) { return !myIds.has(book.openKey); })
        .slice(0, 8);
      const spinner = section.querySelector('.spinner-wrap');

      if (!fresh.length) {
        spinner.innerHTML = '<p style="color:var(--text-muted);font-size:13px;text-align:center">Nic nového k doporučení.</p>';
        return;
      }

      const scroll = document.createElement('div');
      scroll.className = 'h-scroll';
      fresh.forEach(function(book) { scroll.appendChild(buildHCard(book)); });
      spinner.replaceWith(scroll);
    })
    .catch(function(err) {
      console.error('Chyba doporučení:', err);
      const spinner = section.querySelector('.spinner-wrap');
      if (spinner) {
        spinner.innerHTML = '<p style="color:var(--text-muted);font-size:13px;text-align:center">Doporučení teď nelze načíst.</p>';
      }
    });
}


/* ─────────────────────────────────────────────────────────────
   9. KNIHOVNA
───────────────────────────────────────────────────────────── */

// Nastaví filtr knihovny podle stavu knihy.
function setLibFilter(filter, btn) {
  state.libFilter = filter;
  document.querySelectorAll('#lib-tabs .filter-tab').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  refreshAppViews();
}

// Nastaví způsob řazení knih v knihovně.
function setLibSort(val) {
  state.libSort = val;
  refreshAppViews();
}

// Vykreslí seznam knih v knihovně podle filtru a řazení.
function renderLibrary() {
  const list = document.getElementById('library-list');

  var books = state.library.filter(function(b) {
    return state.libFilter === 'all' || b.status === state.libFilter;
  });

  if (state.libSort === 'title') {
    books = books.slice().sort(function(a, b) { return a.title.localeCompare(b.title, 'cs'); });
  } else if (state.libSort === 'rating') {
    books = books.slice().sort(function(a, b) { return (b.rating || 0) - (a.rating || 0); });
  } else {
    books = books.slice().reverse();
  }

  var n = books.length;
  var countEl = document.getElementById('lib-count');
  if (countEl) countEl.textContent = n + (n === 1 ? ' kniha' : n < 5 ? ' knihy' : ' knih');

  if (!books.length) {
    list.innerHTML =
      '<div class="empty-state">' +
        '<div class="empty-icon">📭</div>' +
        '<div class="empty-title">Prázdná polička</div>' +
        '<div class="empty-text">' +
          (state.libFilter === 'all'
            ? 'Přidej svoji první knihu tlačítkem ＋ nebo ji najdi přes Hledat.'
            : 'Nemáš žádné knihy ve stavu „' + STATUS_LABEL[state.libFilter] + '".') +
        '</div>' +
      '</div>';
    return;
  }

  list.innerHTML = '';
  books.forEach(function(b) { list.appendChild(buildBookCard(b)); });
}


/* ─────────────────────────────────────────────────────────────
   10. HLEDÁNÍ
───────────────────────────────────────────────────────────── */

// Připraví vyhledávací obrazovku po jejím otevření.
function renderSearchScreen() {
  renderGenreChips();
}

// Vygeneruje klikací žánrové štítky pro rychlé hledání.
function renderGenreChips() {
  var wrap = document.getElementById('genre-chips');
  if (!wrap) return;
  wrap.innerHTML = GENRES.map(function(g) {
    return '<span class="genre-chip" onclick="searchByGenre(\'' + escapeJsString(g) + '\')">' + escapeHtml(g) + '</span>';
  }).join('');
}

// Naplní selecty žánrů ve formulářích profilu a ručního přidání.
function renderGenreFields() {
  renderGenreSelect('pref-genre', true);
  renderGenreSelect('add-genre', true);
}

// Spustí hledání po kliknutí na konkrétní žánr.
function searchByGenre(genre) {
  document.getElementById('search-input').value = genre;
  closeSuggestions();
  var q = GENRE_EN[genre] || genre;
  runSearch(q);
}

// Ověří vstup uživatele a spustí hledání knih.
function doSearch() {
  var q = document.getElementById('search-input').value.trim();
  closeSuggestions();
  if (!q) { toast('⚠️ Zadej název nebo autora'); return; }
  runSearch(q);
}

// Načte a vykreslí výsledky vyhledávání do seznamu.
function runSearch(query) {
  var results = document.getElementById('search-results');
  results.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>Hledám…</div>';

  searchOpenLibrary(query, 20)
    .then(function(items) {
      if (!items.length) {
        results.innerHTML =
          '<div class="empty-state">' +
            '<div class="empty-icon">🔍</div>' +
            '<div class="empty-title">Nic nenalezeno</div>' +
            '<div class="empty-text">Zkus jiný název nebo autora.</div>' +
          '</div>';
        return;
      }

      results.innerHTML = '<p class="result-count" style="margin-bottom:12px">Nalezeno: ' + items.length + ' knih</p>';
      items.forEach(function(item) {
        var book = parseOpenLibraryBook(item);
        results.appendChild(buildBookCard(book));
      });
    })
    .catch(function(err) {
      console.error('Chyba hledání:', err);
      var errorInfo = getSearchErrorMessage(err);

      results.innerHTML =
        '<div class="empty-state">' +
          '<div class="empty-icon">📡</div>' +
          '<div class="empty-title">' + escapeHtml(errorInfo.title) + '</div>' +
          '<div class="empty-text">' + escapeHtml(errorInfo.text) + '</div>' +
        '</div>';
    });
}

// Načte krátké našeptávání během psaní do vyhledávání.
async function updateSuggestions() {
  var input = document.getElementById('search-input');
  var box = document.getElementById('search-suggestions');
  if (!input || !box) return;

  var q = input.value.trim();
  var token = ++state.lastSuggestToken;

  if (q.length < 3) {
    closeSuggestions();
    return;
  }

  try {
    const items = await searchOpenLibrary(q, 4);

    if (token !== state.lastSuggestToken) return;

    if (!items.length) {
      closeSuggestions();
      return;
    }

    box.innerHTML = '';
    items.forEach(function(item) {
      var book = parseOpenLibraryBook(item);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'search-suggestion-item';
      btn.innerHTML =
        '<div class="search-suggestion-title">' + escapeHtml(book.title) + '</div>' +
        '<div class="search-suggestion-meta">' + escapeHtml(book.author || 'Neznámý autor') + '</div>';

      btn.addEventListener('click', function() {
        input.value = book.title;
        closeSuggestions();
        runSearch(book.title);
      });

      box.appendChild(btn);
    });

    box.classList.add('show');
  } catch (err) {
    console.error('Chyba našeptávání:', err);
    closeSuggestions();
  }
}

// Schová a vyčistí nabídku našeptávání.
function closeSuggestions() {
  var box = document.getElementById('search-suggestions');
  if (!box) return;
  box.classList.remove('show');
  box.innerHTML = '';
}

// Debounce logika, aby se API nevolalo při každém stisku klávesy.
function handleSearchInput() {
  clearTimeout(state.searchDebounce);

  var input = document.getElementById('search-input');
  var q = input ? input.value.trim() : '';

  if (q.length < 3) {
    closeSuggestions();
    return;
  }

  state.searchDebounce = setTimeout(function() {
    updateSuggestions();
  }, 350);
}


/* ─────────────────────────────────────────────────────────────
   11. PROFIL
───────────────────────────────────────────────────────────── */

// Vyplní profil uživatele a jeho základní statistiky.
function renderProfile() {
  document.getElementById('pref-name').value = state.prefs.name || '';
  document.getElementById('pref-genre').value = state.prefs.genre || '';
  document.getElementById('pref-goal').value = state.prefs.goal || 12;

  var read = state.library.filter(function(b) { return b.status === 'read'; }).length;
  document.getElementById('profile-name').textContent = state.prefs.name || 'Můj profil';
  document.getElementById('profile-stats').textContent = state.library.length + ' knih celkem · ' + read + ' přečtených';

  renderGenreBreakdown();
}

// Uloží upravený profil a znovu vykreslí související data.
function saveProfile() {
  state.prefs.name = document.getElementById('pref-name').value.trim();
  state.prefs.genre = document.getElementById('pref-genre').value;
  state.prefs.goal = parseInt(document.getElementById('pref-goal').value, 10) || 12;
  savePrefs();
  refreshAppViews();
  toast('Profil uložen ✓');
}

// Ukáže jednoduchý přehled, jaké žánry má uživatel v knihovně nejčastěji.
function renderGenreBreakdown() {
  var container = document.getElementById('genre-breakdown');
  if (!container) return;

  var counts = {};
  state.library.forEach(function(b) {
    if (b.genre) counts[b.genre] = (counts[b.genre] || 0) + 1;
  });

  var sorted = Object.entries(counts).sort(function(a, b) { return b[1] - a[1]; });

  if (!sorted.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Žádná data zatím.</p>';
    return;
  }

  var max = sorted[0][1];
  container.innerHTML = sorted.map(function(entry) {
    var genre = entry[0];
    var count = entry[1];
    var pct = Math.round((count / max) * 100);
    return (
      '<div class="genre-bar-wrap">' +
        '<div class="genre-bar-header">' +
          '<span style="font-size:13px;color:var(--text-secondary)">' + escapeHtml(genre) + '</span>' +
          '<span style="font-size:12px;color:var(--text-muted)">' + count + '</span>' +
        '</div>' +
        '<div class="genre-bar-bg">' +
          '<div class="genre-bar-fill" style="width:' + pct + '%"></div>' +
        '</div>' +
      '</div>'
    );
  }).join('');
}


/* ─────────────────────────────────────────────────────────────
   12. DETAIL KNIHY
───────────────────────────────────────────────────────────── */

// Otevře detail knihy v overlay okně a připraví editaci statusu, hvězdiček i poznámky.
function openDetail(book) {
  state.detailBook = book;
  var existing = findInLibrary(book);
  var display = existing || book;
  state.detailStatus = display.status || 'want';
  state.detailStars = display.rating || 0;

  var coverHtml = display.cover
    ? '<img class="detail-cover" src="' + display.cover + '" alt="' + escapeHtml(display.title) + '" />'
    : '<div class="detail-cover-ph">📗</div>';

  var pills = '';
  if (display.genre) pills += '<span class="badge badge-genre">' + escapeHtml(display.genre) + '</span>';
  if (display.year) pills += '<span class="badge badge-genre" style="color:var(--text-muted);border-color:var(--border-normal);background:transparent">' + display.year + '</span>';
  if (display.pages) pills += '<span class="badge badge-genre" style="color:var(--text-muted);border-color:var(--border-normal);background:transparent">' + display.pages + ' str.</span>';

  var starsHtml = '';
  for (var i = 1; i <= 5; i++) {
    starsHtml += '<button type="button" class="star-btn ' + (state.detailStars >= i ? 'lit' : '') + '" onclick="setDetailStar(' + i + ')">★</button>';
  }

  var wantActive = state.detailStatus === 'want' ? 'active' : '';
  var readingActive = state.detailStatus === 'reading' ? 'active' : '';
  var readActive = state.detailStatus === 'read' ? 'active' : '';

  var descHtml = '';
  if (display.description) {
    var desc = display.description.substring(0, 260);
    if (display.description.length > 260) desc += '…';
    descHtml = '<div class="detail-desc">' + escapeHtml(desc) + '</div>';
  }

  var actionHtml = existing
    ? '<button class="btn btn-primary" onclick="saveDetailBook()">Uložit změny</button>' +
      '<button class="btn btn-danger" onclick="removeFromLibrary()">Odebrat z knihovny</button>'
    : '<button class="btn btn-primary" onclick="saveDetailBook()">＋ Přidat do knihovny</button>';

  document.getElementById('sheet-detail-content').innerHTML =
    '<div class="detail-top">' +
      coverHtml +
      '<div class="detail-meta-info">' +
        '<div class="detail-title">' + escapeHtml(display.title) + '</div>' +
        '<div class="detail-author">' + escapeHtml(display.author || 'Neznámý autor') + '</div>' +
        '<div class="detail-pills">' + pills + '</div>' +
        '<div class="star-row">' + starsHtml + '</div>' +
      '</div>' +
    '</div>' +
    descHtml +
    '<div class="status-picker">' +
      '<button class="status-opt ' + wantActive + '" onclick="setDetailStatus(\'want\', this)"><span class="s-icon">🔖</span>Chci číst</button>' +
      '<button class="status-opt ' + readingActive + '" onclick="setDetailStatus(\'reading\', this)"><span class="s-icon">📖</span>Čtu teď</button>' +
      '<button class="status-opt ' + readActive + '" onclick="setDetailStatus(\'read\', this)"><span class="s-icon">✓</span>Přečteno</button>' +
    '</div>' +
    '<div class="sheet-body">' +
      '<label class="form-label">Poznámka / dojmy</label>' +
      '<textarea class="form-textarea" id="detail-note" placeholder="Co tě zaujalo?">' + escapeHtml(display.note || '') + '</textarea>' +
      actionHtml +
    '</div>';

  document.getElementById('overlay-detail').classList.add('open');
}

// Přepne stav knihy v detailu.
function setDetailStatus(status, el) {
  state.detailStatus = status;
  document.querySelectorAll('.status-opt').forEach(function(b) { b.classList.remove('active'); });
  if (el) el.classList.add('active');
}

// Nastaví počet hvězdiček v detailu knihy.
function setDetailStar(n) {
  state.detailStars = n;
  document.querySelectorAll('#sheet-detail-content .star-btn').forEach(function(btn, i) {
    btn.classList.toggle('lit', i < n);
  });
}

// Přidá novou knihu do knihovny nebo uloží změny u existující knihy.
function saveDetailBook() {
  var book = state.detailBook;
  var note = document.getElementById('detail-note').value;
  var existing = findInLibrary(book);

  if (existing) {
    existing.status = state.detailStatus;
    existing.rating = state.detailStars;
    existing.note = note;
    toast('Změny uloženy ✓');
  } else {
    state.library.push({
      id: Date.now(),
      openKey: book.openKey || null,
      editionKey: book.editionKey || null,
      title: book.title,
      author: book.author || '',
      cover: book.cover || null,
      genre: book.genre || '',
      year: book.year || null,
      pages: book.pages || null,
      description: book.description || '',
      status: state.detailStatus,
      rating: state.detailStars,
      note: note,
      isbn: book.isbn || null,
      subjects: book.subjects || [],
    });
    toast('Přidáno do knihovny 📚');
  }

  saveLibrary();
  closeOverlay('overlay-detail');
  refreshAppViews();
}

// Odebere vybranou knihu z knihovny.
function removeFromLibrary() {
  var existing = findInLibrary(state.detailBook);
  if (!existing) return;
  state.library = state.library.filter(function(b) { return b.id !== existing.id; });
  saveLibrary();
  toast('Odebráno z knihovny');
  closeOverlay('overlay-detail');
  renderLibrary();
}


/* ─────────────────────────────────────────────────────────────
   13. PŘIDAT RUČNĚ
───────────────────────────────────────────────────────────── */

// Otevře formulář pro ruční přidání knihy a vyresetuje jeho hodnoty.
function openAddManual() {
  ['add-title', 'add-author', 'add-note'].forEach(function(id) {
    document.getElementById(id).value = '';
  });
  document.getElementById('add-genre').value = '';
  document.getElementById('add-status').value = 'want';
  state.addStars = 0;
  updateAddStars(0);
  document.getElementById('overlay-add').classList.add('open');
}

// Nastaví hodnocení při ručním přidání knihy.
function setAddStar(n) {
  state.addStars = n;
  updateAddStars(n);
}

// Vizuálně rozsvítí hvězdičky ve formuláři podle vybrané hodnoty.
function updateAddStars(n) {
  document.querySelectorAll('#add-stars .star-btn').forEach(function(btn, i) {
    btn.classList.toggle('lit', i < n);
  });
}

// Uloží ručně zadanou knihu do knihovny.
function saveManualBook() {
  var title = document.getElementById('add-title').value.trim();
  if (!title) { toast('⚠️ Zadej název knihy'); return; }

  state.library.push({
    id: Date.now(),
    openKey: null,
    editionKey: null,
    title: title,
    author: document.getElementById('add-author').value.trim(),
    genre: document.getElementById('add-genre').value,
    status: document.getElementById('add-status').value,
    rating: state.addStars,
    note: document.getElementById('add-note').value.trim(),
    cover: null,
    year: null,
    pages: null,
    description: '',
    isbn: null,
    subjects: [],
  });

  saveLibrary();
  toast('Kniha přidána ✓');
  closeOverlay('overlay-add');
  renderLibrary();
}


/* ─────────────────────────────────────────────────────────────
   14. OVERLAY
───────────────────────────────────────────────────────────── */

// Zavře overlay okno podle jeho ID.
function closeOverlay(id) {
  document.getElementById(id).classList.remove('open');
}

// Zavře overlay jen při kliknutí mimo samotný obsah okna.
function overlayClick(event, id) {
  if (event.target === document.getElementById(id)) closeOverlay(id);
}


/* ─────────────────────────────────────────────────────────────
   15. STAVBA KARET
───────────────────────────────────────────────────────────── */

// Vytvoří jednu klasickou kartu knihy pro seznamy.
function buildBookCard(book) {
  var div = document.createElement('div');
  div.className = 'book-card';
  div.onclick = function() { openDetail(book); };

  var coverHtml = book.cover
    ? '<img class="book-cover" src="' + book.cover + '" alt="' + escapeHtml(book.title) + '" loading="lazy" />'
    : '<div class="book-cover-placeholder">📗</div>';

  var inLib = findInLibrary(book);
  var status = (inLib && inLib.status) || book.status;
  var rating = (inLib && inLib.rating) || book.rating || 0;

  var starsHtml = '';
  if (rating) {
    for (var i = 0; i < rating; i++) starsHtml += '★';
    for (var j = rating; j < 5; j++) starsHtml += '☆';
    starsHtml = '<div class="stars-row">' + starsHtml + '</div>';
  }

  var badges = '';
  if (book.genre) badges += '<span class="badge badge-genre">' + escapeHtml(book.genre) + '</span>';
  if (status) badges += '<span class="badge badge-' + status + '">' + STATUS_ICON[status] + ' ' + STATUS_LABEL[status] + '</span>';
  else if (inLib) badges += '<span class="badge badge-inlib">✓ V knihovně</span>';

  div.innerHTML =
    coverHtml +
    '<div class="book-info">' +
      '<div class="book-title">' + escapeHtml(book.title) + '</div>' +
      '<div class="book-author">' + escapeHtml(book.author || 'Neznámý autor') + '</div>' +
      '<div class="book-meta">' + badges + '</div>' +
      starsHtml +
    '</div>';

  return div;
}

// Vytvoří menší vodorovnou kartu knihy pro carousel sekce.
function buildHCard(book) {
  var div = document.createElement('div');
  div.className = 'h-card';
  div.onclick = function() { openDetail(book); };

  div.innerHTML = book.cover
    ? '<img class="h-cover" src="' + book.cover + '" alt="' + escapeHtml(book.title) + '" loading="lazy" /><div class="h-title">' + escapeHtml(book.title) + '</div>'
    : '<div class="h-cover-ph">📘</div><div class="h-title">' + escapeHtml(book.title) + '</div>';

  return div;
}


/* ─────────────────────────────────────────────────────────────
   16. POMOCNÉ FUNKCE
───────────────────────────────────────────────────────────── */

// Zjistí, jestli už daná kniha v knihovně existuje.
function findInLibrary(book) {
  if (!book) return null;

  var title = String(book.title || '').trim().toLowerCase();
  var author = String(book.author || '').trim().toLowerCase();

  for (var i = 0; i < state.library.length; i++) {
    var b = state.library[i];
    if (book.openKey && b.openKey === book.openKey) return b;
    if (book.editionKey && b.editionKey === book.editionKey) return b;
    if (book.id && b.id === book.id) return b;

    if (
      title &&
      author &&
      title === String(b.title || '').trim().toLowerCase() &&
      author === String(b.author || '').trim().toLowerCase()
    ) {
      return b;
    }
  }

  return null;
}

// Ochrana proti vložení HTML znaků do generovaného obsahu.
function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Ošetří text vložený do inline JavaScript atributů.
function escapeJsString(str) {
  return String(str)
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'");
}


/* ─────────────────────────────────────────────────────────────
   17. INICIALIZACE
───────────────────────────────────────────────────────────── */

// Spouštěcí funkce: načte data, nastaví vzhled a naváže hlavní události.
function init() {
  loadData();
  applyTheme();
  renderGenreFields();
  renderGenreChips();
  refreshAppViews();

  var searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') doSearch();
    });

    searchInput.addEventListener('input', handleSearchInput);

    searchInput.addEventListener('focus', function() {
      if (searchInput.value.trim().length >= 3) {
        handleSearchInput();
      }
    });
  }

  document.addEventListener('click', function(e) {
    var wrap = document.querySelector('.search-wrap');
    if (wrap && !wrap.contains(e.target)) {
      closeSuggestions();
    }
  });

  setTimeout(function() {
    var splash = document.getElementById('splash');
    if (!splash) return;
    splash.style.opacity = '0';
    splash.style.pointerEvents = 'none';
    setTimeout(function() { splash.remove(); }, 500);
  }, 1400);
}

window.addEventListener('DOMContentLoaded', init);
