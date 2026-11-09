// Audius read-only REST API. Search and stream endpoints are public; no Telegram account or token is used.
const AUDIUS_API = 'https://api.audius.co/v1';
const PAGE_SIZE = 20;
const form = document.querySelector('#search-form');
const queryInput = document.querySelector('#query');
const searchButton = document.querySelector('#search-button');
const results = document.querySelector('#results');
const statusPanel = document.querySelector('#status-panel');
const resultsTitle = document.querySelector('#results-title');
const resultCount = document.querySelector('#result-count');
const pagination = document.querySelector('#pagination');
const previousPageButton = document.querySelector('#previous-page');
const nextPageButton = document.querySelector('#next-page');
const pageLabel = document.querySelector('#page-label');
const audio = document.querySelector('#audio');
const playToggle = document.querySelector('#play-toggle');
const progress = document.querySelector('#progress');
const toast = document.querySelector('#toast');
let tracks = [];
let activeIndex = -1;
let toastTimer;
let currentQuery = '';
let pages = [];
let pageIndex = -1;
let seenTrackIds = new Set();
let isLoadingPage = false;

function say(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
}
function durationText(value) {
  const seconds = Number(value) || 0;
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
function coverFor(track) {
  const artwork = track.artwork || {};
  return artwork._480x480 || artwork['480x480'] || artwork._150x150 || artwork['150x150'] || track.artwork_url || '';
}
function normalizeTrack(track) {
  const user = track.user || {};
  return {
    id: track.id,
    title: track.title || 'Untitled track',
    artist: user.name || user.handle || track.artist || 'Unknown artist',
    album: track.genre || '',
    duration: track.duration,
    coverUrl: coverFor(track),
    streamUrl: `${AUDIUS_API}/tracks/${encodeURIComponent(track.id)}/stream`,
    sourceUrl: track.permalink || `https://audius.co/track/${encodeURIComponent(track.id)}`,
  };
}

function renderTracks(rawTracks) {
  tracks = rawTracks.map(normalizeTrack);
  results.replaceChildren();
  tracks.forEach((track, index) => {
    const row = document.createElement('div');
    row.className = 'track';
    row.dataset.index = index;
    const number = document.createElement('span'); number.className = 'track-number'; number.textContent = String((pageIndex * PAGE_SIZE) + index + 1).padStart(2, '0');
    const cover = document.createElement('div'); cover.className = 'track-cover';
    if (track.coverUrl) { const img = document.createElement('img'); img.src = track.coverUrl; img.alt = ''; img.loading = 'lazy'; cover.append(img); }
    else cover.textContent = '♪';
    const info = document.createElement('div'); info.className = 'track-info';
    const title = document.createElement('strong'); title.textContent = track.title;
    const artist = document.createElement('span'); artist.textContent = [track.artist, track.album].filter(Boolean).join(' · ');
    info.append(title, artist);
    const length = document.createElement('span'); length.className = 'track-duration'; length.textContent = durationText(track.duration);
    const play = document.createElement('button'); play.className = 'track-play'; play.textContent = '▶'; play.setAttribute('aria-label', `Play ${track.title}`);
    play.addEventListener('click', () => playTrack(index));
    row.append(number, cover, info, length, play);
    row.addEventListener('dblclick', () => playTrack(index));
    results.append(row);
  });
  results.hidden = false;
  statusPanel.hidden = true;
  pagination.hidden = false;
  resultsTitle.textContent = 'Search results';
  resultCount.textContent = `${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'} on this page`;
  pageLabel.textContent = `Page ${pageIndex + 1}`;
  previousPageButton.disabled = pageIndex <= 0 || isLoadingPage;
  nextPageButton.disabled = !pages[pageIndex]?.hasMore || isLoadingPage;
}

async function fetchUniquePage(offset, alreadySeen) {
  let scanOffset = offset;
  let hasMore = true;
  const collected = [];
  const localSeen = new Set(alreadySeen);
  while (collected.length < PAGE_SIZE && hasMore) {
    const url = new URL(`${AUDIUS_API}/tracks/search`);
    url.searchParams.set('query', currentQuery);
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('offset', String(scanOffset));
    url.searchParams.set('sort_method', 'relevant');
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      if (response.status === 429) throw new Error('Audius rate limit reached. Wait a moment, then try again.');
      throw new Error(`Audius search failed (${response.status}).`);
    }
    const payload = await response.json();
    if (!Array.isArray(payload.data)) throw new Error('Audius returned an unexpected response.');
    const batch = payload.data;
    for (const track of batch) {
      const id = String(track.id || '');
      if (!id || localSeen.has(id)) continue;
      localSeen.add(id);
      collected.push(track);
      if (collected.length === PAGE_SIZE) break;
    }
    scanOffset += batch.length;
    hasMore = batch.length === PAGE_SIZE;
    if (batch.length === 0) hasMore = false;
  }
  return { tracks: collected, nextOffset: scanOffset, hasMore };
}

async function goToPage(targetIndex) {
  if (targetIndex < 0 || isLoadingPage) return;
  if (pages[targetIndex]) {
    pageIndex = targetIndex;
    renderTracks(pages[pageIndex].tracks);
    return;
  }
  const previous = pages[targetIndex - 1];
  if (!previous?.hasMore) return;
  isLoadingPage = true;
  nextPageButton.disabled = true;
  previousPageButton.disabled = true;
  pageLabel.textContent = 'Loading…';
  try {
    const page = await fetchUniquePage(previous.nextOffset, seenTrackIds);
    if (!page.tracks.length) {
      pages[targetIndex - 1].hasMore = false;
      renderTracks(pages[targetIndex - 1].tracks);
      return;
    }
    page.tracks.forEach((track) => seenTrackIds.add(String(track.id)));
    pages[targetIndex] = page;
    pageIndex = targetIndex;
    renderTracks(page.tracks);
  } catch (error) {
    say(error.message);
    pageLabel.textContent = `Page ${pageIndex + 1}`;
    previousPageButton.disabled = pageIndex <= 0;
    nextPageButton.disabled = !pages[pageIndex]?.hasMore;
  } finally {
    isLoadingPage = false;
    previousPageButton.disabled = pageIndex <= 0;
    nextPageButton.disabled = !pages[pageIndex]?.hasMore;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const q = queryInput.value.trim();
  if (!q) { queryInput.focus(); return; }
  currentQuery = q;
  pages = [];
  pageIndex = -1;
  seenTrackIds = new Set();
  searchButton.disabled = true;
  searchButton.innerHTML = 'Searching <span>…</span>';
  results.hidden = true;
  pagination.hidden = true;
  statusPanel.hidden = false;
  statusPanel.querySelector('strong').textContent = 'Looking through Audius';
  statusPanel.querySelector('p').textContent = `Searching for “${q}”…`;
  resultCount.textContent = '';
  try {
    const page = await fetchUniquePage(0, seenTrackIds);
    if (!page.tracks.length) {
      resultsTitle.textContent = 'No tracks found';
      statusPanel.querySelector('strong').textContent = 'Nothing came up';
      statusPanel.querySelector('p').textContent = 'Try another title or artist.';
      return;
    }
    page.tracks.forEach((track) => seenTrackIds.add(String(track.id)));
    pages[0] = page;
    pageIndex = 0;
    renderTracks(page.tracks);
  } catch (error) {
    resultsTitle.textContent = 'Search unavailable';
    statusPanel.querySelector('strong').textContent = 'Couldn’t reach Audius';
    statusPanel.querySelector('p').textContent = error.message.includes('Failed to fetch')
      ? 'Check your connection, or try again in a moment.'
      : error.message;
  } finally {
    searchButton.disabled = false;
    searchButton.innerHTML = 'Search <span>↗</span>';
  }
});

previousPageButton.addEventListener('click', () => goToPage(pageIndex - 1));
nextPageButton.addEventListener('click', () => goToPage(pageIndex + 1));

function playTrack(index) {
  const track = tracks[index];
  if (!track) return;
  activeIndex = index;
  audio.src = track.streamUrl;
  audio.play().then(() => {
    document.querySelector('#player-title').textContent = track.title;
    document.querySelector('#player-artist').textContent = track.artist;
    const cover = document.querySelector('#player-cover');
    cover.replaceChildren();
    if (track.coverUrl) { const img = document.createElement('img'); img.src = track.coverUrl; img.alt = ''; img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:5px'; cover.append(img); }
    else cover.textContent = '♪';
    playToggle.disabled = false;
    playToggle.textContent = 'Ⅱ';
    document.querySelectorAll('.track').forEach((row) => row.classList.toggle('selected', Number(row.dataset.index) === index));
  }).catch(() => say('This track could not play. It may be unavailable or access-gated on Audius.'));
}
playToggle.addEventListener('click', () => {
  if (audio.paused) audio.play().catch(() => {}); else audio.pause();
});
audio.addEventListener('play', () => { playToggle.textContent = 'Ⅱ'; });
audio.addEventListener('pause', () => { playToggle.textContent = '▶'; });
audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  progress.value = String(Math.round((audio.currentTime / audio.duration) * 1000));
  document.querySelector('#current-time').textContent = durationText(audio.currentTime);
  document.querySelector('#duration').textContent = durationText(audio.duration);
});
audio.addEventListener('error', () => { if (activeIndex >= 0) say('Audius could not stream this track. Try another result.'); });
progress.addEventListener('input', () => { if (audio.duration) audio.currentTime = (Number(progress.value) / 1000) * audio.duration; });
document.querySelector('#volume').addEventListener('input', (event) => { audio.volume = Number(event.target.value); });
document.querySelector('#next').addEventListener('click', () => { if (activeIndex < tracks.length - 1) playTrack(activeIndex + 1); });
document.querySelector('#previous').addEventListener('click', () => { if (activeIndex > 0) playTrack(activeIndex - 1); });
audio.addEventListener('ended', () => { if (activeIndex < tracks.length - 1) playTrack(activeIndex + 1); });
document.querySelector('.save-button').addEventListener('click', () => say('Library saving can be added later.'));
