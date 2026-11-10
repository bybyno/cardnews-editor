'use strict';
/* ===== 인터넷 이미지 찾기: 원본 역검색(Google Lens) · 키워드(Google 이미지) · 영화/인물(TMDB) ===== */

let PROXY_OK = false;
let SERVER_OLD = false;
const NEED_SERVER = 8;   // server.py의 SERVER_VERSION
async function checkProxy() {
  try {
    const r = await fetch('/proxy-ping', { cache: 'no-store' });
    PROXY_OK = r.ok && (await r.text()) === 'ok';
  } catch (e) { PROXY_OK = false; }
  if (!PROXY_OK) return;
  // 편집기 파일은 새것인데 서버(start.bat 창)가 예전 것이면 새 기능이 안 됨 → 다시 실행 안내
  try {
    const r = await fetch('/api/ping', { cache: 'no-store' });
    SERVER_OLD = !r.ok || ((await r.json()).version || 0) < NEED_SERVER;
  } catch (e) { SERVER_OLD = true; }
  if (SERVER_OLD) toast('⚠ 편집기 서버가 예전 버전이에요. start.bat 검은 창을 닫고 다시 실행해 주세요.', 10000);
}
function webFetch(url, opts = {}) {
  if (!PROXY_OK) throw new Error('인터넷 이미지 검색은 start.bat으로 앱을 실행해야 쓸 수 있어요 (로컬 서버가 필요해요).');
  const { noReferer, ...rest } = opts;
  return fetch('/proxy?url=' + encodeURIComponent(url) + (noReferer ? '&noref=1' : ''), rest);
}
async function webJSON(url, opts) {
  const r = await webFetch(url, opts);
  const txt = await r.text();
  let d;
  try { d = JSON.parse(txt); } catch (e) { throw new Error(`응답 오류 (${r.status}): ${txt.slice(0, 160)}`); }
  if (!r.ok || d.error) throw new Error(d.error || d.status_message || `HTTP ${r.status}`);
  return d;
}

const sr = { tab: 'lens', target: null, slideId: null, lensSrc: null, keywords: null, busy: false };

/* ----- 열기 ----- */
function replaceableTarget() {
  const o = canvas.getActiveObject();
  if (o && (o.kind === 'frame' || (o.type === 'image' && o.kind !== 'logo'))) return o;
  return null;
}
function slideBgImage() {
  return canvas.getObjects().find(o => o.type === 'image' && o.kind === 'image') || null;
}
function objectImageSrc(o) {
  if (!o) return null;
  if (o.kind === 'frame') return o.fill && o.fill.source ? o.fill.source.src : null;
  return o.getSrc ? o.getSrc() : null;
}
// opts.pick: 결과를 캔버스에 넣지 않고 이 함수로 넘김 (두 장 합치기 등) / opts.lensSrc / opts.label
function openSearch(tab, autoRun = false, opts = {}) {
  exitFrameEdit();
  sr.pick = opts.pick || null;
  sr.target = sr.pick ? null : replaceableTarget();
  sr.slideId = cur().id;
  const lensObj = sr.target || slideBgImage();
  sr.lensSrc = opts.lensSrc !== undefined ? opts.lensSrc : objectImageSrc(lensObj);
  if (sr.lensSrc === PLACEHOLDER) sr.lensSrc = null;
  $('#searchModal').classList.toggle('top', !!sr.pick);
  $('#srApplyRow').style.display = sr.pick ? 'none' : '';
  $('#srFile').style.display = sr.pick ? '' : 'none';
  $('#srLensImg').src = sr.lensSrc || '';
  $('#srLensImg').style.visibility = sr.lensSrc ? 'visible' : 'hidden';
  $('#srLensImg').title = '이 사진으로 역검색해요';
  $('#srTarget').textContent = opts.label ? `— ${opts.label}` : sr.target ? `— 선택: ${sr.target.layerName || '사진'}` : `— 슬라이드 ${state.current + 1}`;
  const apply = sr.target ? 'replace' : (slideBgImage() ? 'replace-bg' : 'bg');
  $$('input[name=srApply]').forEach(r => { r.checked = r.value === apply; });
  $('#srApplyReplace').style.display = sr.target ? '' : 'none';
  $('#srApplyReplaceBg').style.display = !sr.target && slideBgImage() ? '' : 'none';
  // 다른 사진/슬라이드로 열면 이전 검색어·결과·AI 키워드를 비움 (이전 검색이 남아 보이지 않게)
  const ctxKey = sr.slideId + '|' + (sr.lensSrc || '').length + '|' + (sr.lensSrc || '').slice(-80);
  if (ctxKey !== sr.ctxKey) {
    sr.ctxKey = ctxKey;
    $('#srQuery').value = '';
    $('#srLensQ').value = '';
    $('#srResults').innerHTML = '';
    sr.keywords = null; sr.pinNext = null; sr.count = 0;
    sr.tabResults = {}; sr.lastItems = null;
  }
  setSearchTab(tab || sr.tab);
  $('#srStatus').textContent = PROXY_OK ? '' : '⚠ 로컬 서버가 없어요. start.bat으로 실행해야 검색할 수 있어요.';
  $('#srStatus').classList.toggle('err', !PROXY_OK);
  renderKeywords();
  renderSearchHistory();
  openModal('searchModal');
  // 이미 찾아둔 결과(자동 원본 찾기 등)가 있으면 바로 보여주고 다시 검색하지 않음
  const cached = sr.tab === 'lens' && sr.lensSrc && !$('#srResults').children.length ? lensCacheGet(sr.lensSrc, $('#srLensType').value) : null;
  if (cached) {
    renderResults(cached.items);
    sr.count = cached.items.length;
    $('#srStatus').textContent = `미리 찾아둔 결과 ${cached.items.length}개 — 클릭하면 적용돼요 (새로 찾으려면 '검색')`;
    return;
  }
  // '원본 찾기' 버튼으로 열면 이 카드의 사진으로 바로 역검색
  if (autoRun && tab === 'lens' && sr.lensSrc && PROXY_OK && state.settings.serpApiKey) {
    $('#srLensQ').value = '';
    runSearch();
  }
}
function setSearchTab(tab) {
  sr.tab = tab;
  $$('#searchModal [data-src]').forEach(b => b.classList.toggle('on', b.dataset.src === tab));
  $('#srLensOpts').style.display = tab === 'lens' ? '' : 'none';
  $('#srQueryOpts').style.display = tab === 'lens' ? 'none' : '';
  $('#srLarge').parentElement.style.display = tab === 'google' ? '' : 'none';
  $('#srQuery').placeholder = {
    tmdb: '영화·드라마 제목이나 배우 이름 (예: Black Panther, Chadwick Boseman)',
    pinterest: '검색어 또는 핀 링크 붙여넣기 (예: black panther aesthetic, https://pin.it/...)',
  }[tab] || '검색어 (예: Black Panther Wakanda Forever still HD)';
}

/* ----- AI 키워드 추출 ----- */
function slideTexts() {
  return canvas.getObjects().filter(o => o.type === 'i-text' && o.kind === 'text').map(o => o.text).join('\n');
}
async function extractKeywords() {
  const st = $('#srStatus');
  st.classList.remove('err');
  st.textContent = 'Claude가 내용을 분석해서 검색 키워드를 뽑는 중…';
  $('#srAI').disabled = true;
  try {
    const content = [];
    if (sr.lensSrc) {
      content.push({ type: 'text', text: '[현재 사진]' });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await downscaleForAI(sr.lensSrc, 900) } });
    }
    content.push({ type: 'text', text:
      `[이 슬라이드 문구]\n${slideTexts() || '(없음)'}\n\n[카드뉴스 캡션]\n${state.project.caption || '(없음)'}\n\n[원본 해외 게시물]\n${state.project.sourceText || '(없음)'}` });
    const system = `너는 카드뉴스 편집자를 돕는 이미지 리서처다. 주어진 사진·슬라이드 문구·원문을 해석해서 이 슬라이드에 쓸 고화질 이미지를 찾을 검색어를 만든다.
- 사진이 있으면 무엇인지(작품명, 장면, 인물) 최대한 구체적으로 식별한다. 확실하지 않으면 추정이라고 쓴다.
- google: 구글 이미지 검색어 4~6개. 해외 작품은 영어로. 글자 없는 원본을 찾도록 "still", "official image", "HD", "poster", "promo" 같은 단어를 적절히 섞는다. 원본 사진과 같은 것을 찾는 검색어를 먼저, 비슷한 대체 이미지 검색어를 뒤에.
- tmdb: TMDB(영화·드라마·배우 DB) 검색어 1~4개. 정확한 영어 작품명이나 배우 이름만.
JSON만 출력: {"identify":"사진/내용 설명 (한국어 한 문장)","google":["..."],"tmdb":["..."]}`;
    sr.keywords = await claudeJSON(system, content, 800);
    st.textContent = '';
    renderKeywords();
    const first = sr.keywords.google && sr.keywords.google[0];
    if (first && !$('#srQuery').value) $('#srQuery').value = first;
  } catch (e) {
    st.textContent = e.message; st.classList.add('err');
  } finally { $('#srAI').disabled = false; }
}
function renderKeywords() {
  const box = $('#srKeywords');
  box.innerHTML = '';
  const k = sr.keywords;
  if (!k) return;
  if (k.identify) box.append(h('div', { class: 'sr-identify' }, '🤖 ', k.identify));
  const chips = h('div', { class: 'sr-chips' });
  // 핀터레스트 탭에서는 같은 키워드를 핀터레스트로 검색
  (k.google || []).forEach(q => chips.append(h('button', { class: 'chip', title: 'Google 이미지 / 핀터레스트로 검색', onclick: () => { if (sr.tab !== 'pinterest') setSearchTab('google'); $('#srQuery').value = q; runSearch(); } }, '🔎 ' + q)));
  (k.tmdb || []).forEach(q => chips.append(h('button', { class: 'chip', title: 'TMDB로 검색', onclick: () => { setSearchTab('tmdb'); $('#srQuery').value = q; runSearch(); } }, '🎬 ' + q)));
  box.append(chips);
}

/* ----- 최근 검색어 (최대 10개, 최신순) ----- */
const TAB_ICON = { google: '🌐', pinterest: '📌', tmdb: '🎬' };
function addSearchHistory(q, tab) {
  if (!q || !TAB_ICON[tab] || isPinUrl(q)) return;
  const list = (state.settings.searchHistory || []).filter(x => !(x.q === q && x.tab === tab));
  list.unshift({ q, tab });
  state.settings.searchHistory = list.slice(0, 10);
  saveSettings();
  renderSearchHistory();
}
function renderSearchHistory() {
  const box = $('#srHistory');
  if (!box) return;
  box.innerHTML = '';
  const list = state.settings.searchHistory || [];
  if (!list.length) return;
  box.append(h('span', { class: 'lab' }, '최근 검색'));
  list.forEach((it, i) => {
    box.append(h('span', { class: 'hchip', title: '다시 검색' },
      h('button', { onclick: () => { setSearchTab(it.tab); $('#srQuery').value = it.q; runSearch(); } }, `${TAB_ICON[it.tab]} ${it.q}`),
      h('button', { class: 'del', title: '지우기', onclick: () => {
        state.settings.searchHistory = list.filter((_, j) => j !== i); saveSettings(); renderSearchHistory();
      } }, '✕')));
  });
}

/* ----- 검색 ----- */
async function runSearch(more = false) {
  if (sr.busy) return;
  const st = $('#srStatus');
  st.classList.remove('err');
  sr.busy = true; $('#srGo').disabled = true;
  if (!more) { $('#srResults').innerHTML = ''; sr.pinNext = null; sr.count = 0; }
  try {
    let items;
    const q = $('#srQuery').value.trim();
    if (more && sr.pinNext) items = await searchPinterest(sr.pinNext.q, sr.pinNext.bookmark);
    else if (sr.tab === 'lens') items = await searchLens();
    else if (sr.tab === 'google') items = await searchGoogle(q);
    else if (sr.tab === 'pinterest') items = await searchPinterest(q);
    else items = await searchTMDB(q);
    if (!more) addSearchHistory(q, sr.tab);
    sr.lastItems = more && sr.lastItems ? sr.lastItems.concat(items) : items;   // 탭 전환 때 다시 보여주기용
    sr.lastQ = tabQuery(sr.tab);
    sr.count = (sr.count || 0) + items.length;
    st.textContent = sr.count ? `${sr.count}개 찾음 — 클릭하면 적용돼요` : '결과가 없어요. 다른 검색어나 탭을 써보세요.';
    renderResults(items, more);
  } catch (e) {
    console.error(e);
    st.textContent = e.message; st.classList.add('err');
  } finally { sr.busy = false; $('#srGo').disabled = false; }
}

function needSerp() {
  const k = state.settings.serpApiKey;
  if (!k) throw new Error('설정(⚙)에 SerpApi 키를 넣어주세요. (serpapi.com 무료 가입 → API Key)');
  return k;
}
async function searchGoogle(q) {
  if (!q) throw new Error('검색어를 입력하거나 "AI 키워드 추출"을 눌러주세요.');
  const key = needSerp();
  $('#srStatus').textContent = `Google 이미지 검색 중… "${q}"`;
  const ko = /[가-힣]/.test(q);
  const p = new URLSearchParams({ engine: 'google_images', q, api_key: key, hl: ko ? 'ko' : 'en', gl: ko ? 'kr' : 'us' });
  if ($('#srLarge').checked) p.set('imgsz', 'l');
  const d = await webJSON('https://serpapi.com/search.json?' + p);
  return (d.images_results || []).filter(r => r.original).map(r => ({
    thumb: r.thumbnail, full: r.original, w: r.original_width, h: r.original_height, title: r.title, source: r.source, link: r.link,
  }));
}
async function lensUploadBlob(src) {
  // SerpApi 업로드 한도 500KB 이하로 줄이기
  const img = await loadHtmlImage(src);
  for (const [max, q] of [[1200, 0.85], [1000, 0.8], [800, 0.75], [640, 0.7]]) {
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const b = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
    if (b.size < 490 * 1024) return b;
  }
  throw new Error('이미지를 500KB 이하로 줄이지 못했어요');
}
async function searchLens() {
  if (!sr.lensSrc) throw new Error('역검색할 사진이 없어요. 사진을 선택한 뒤 다시 열어주세요.');
  const type = $('#srLensType').value;
  const q = $('#srLensQ').value.trim();
  const items = await lensSearch(sr.lensSrc, type, q, msg => { $('#srStatus').textContent = msg; });
  if (!q) lensCacheSet(sr.lensSrc, type, items);
  return items;
}
/* 사진 한 장으로 Google Lens 검색 (화면과 무관하게 호출 가능) */
async function lensSearch(src, type = 'visual_matches', q = '', onStatus = () => {}) {
  const key = needSerp();
  onStatus('사진 올리는 중…');
  const fd = new FormData();
  fd.append('image', await lensUploadBlob(src), 'image.jpg');
  fd.append('api_key', key);
  const up = await webJSON('https://serpapi.com/image', { method: 'POST', body: fd });
  if (!up.image_id) throw new Error('사진 업로드 실패');
  onStatus('Google Lens로 원본·비슷한 이미지 찾는 중…');
  const p = new URLSearchParams({ engine: 'google_lens', image_id: up.image_id, type, api_key: key, hl: 'ko' });
  if (q && type !== 'exact_matches') p.set('q', q);
  const d = await webJSON('https://serpapi.com/search.json?' + p);
  const list = d[type] || d.visual_matches || d.exact_matches || [];
  return list.map(r => ({
    thumb: r.thumbnail || r.image, full: r.image || r.original || null,
    w: r.image_width || r.original_width, h: r.image_height || r.original_height,
    title: r.title, source: r.source, link: r.link,
  })).filter(r => r.full || r.thumb);
}

/* ----- 역검색 결과 저장 (같은 사진은 다시 검색하지 않음 → 검색 횟수 절약) ----- */
function strHash(s) {
  let hsh = 5381;
  const step = Math.max(1, Math.floor(s.length / 30000));
  for (let i = 0; i < s.length; i += step) hsh = ((hsh << 5) + hsh + s.charCodeAt(i)) | 0;
  return (hsh >>> 0).toString(36) + '_' + s.length;
}
function lensCacheGet(src, type = 'visual_matches') {
  const c = state.project.lensCache || {};
  return c[strHash(src) + '|' + type] || null;
}
function lensCacheSet(src, type, items) {
  state.project.lensCache = state.project.lensCache || {};
  state.project.lensCache[strHash(src) + '|' + type] = { items, at: Date.now() };
  scheduleAutosave();
}

/* ----- 포스트 가져온 뒤: 모든 카드 배경 사진을 자동으로 역검색 (비슷한 이미지) ----- */
function slideBgSrc(slide) {
  const o = (slide.json.objects || []).find(x => x.type === 'image' && x.kind === 'image');
  return o && o.src && o.src !== PLACEHOLDER ? o.src : null;
}
function replaceBgInJson(json, oldSrc, url, w, hh) {
  let done = false;
  (json.objects || []).forEach(o => {
    if (o.type !== 'image' || o.kind !== 'image' || o.src !== oldSrc) return;
    const s = Math.max(W / w, H / hh);
    Object.assign(o, { src: url, width: w, height: hh, scaleX: s, scaleY: s, left: W / 2, top: H / 2,
      originX: 'center', originY: 'center', angle: 0, cropX: 0, cropY: 0, flipX: false, flipY: false });
    done = true;
  });
  return done;
}
/* Claude가 후보 사진들을 보고 '글씨 없는 깨끗한 같은 장면/인물 사진'을 고름 */
async function pickCleanWithAI(origSrc, items) {
  const cands = items.filter(it => it.full && (!it.w || it.w >= 900 || it.h >= 900)).slice(0, 8);
  const content = [{ type: 'text', text: '[원본 사진 — 인스타 게시물이라 사진 위에 글씨가 덧씌워져 있을 수 있음]' },
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await downscaleForAI(origSrc, 640) } }];
  const shown = [];
  for (const c of cands) {
    try {
      const data = await downscaleForAI('/proxy?url=' + encodeURIComponent(c.thumb || c.full), 384);
      content.push({ type: 'text', text: `[후보 ${shown.length}] ${c.w ? c.w + '×' + c.h : '크기 모름'}` });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } });
      shown.push(c);
    } catch (e) { /* 미리보기를 못 받은 후보는 제외 */ }
  }
  content.push({ type: 'text', text: shown.length
    ? '위 후보 중 카드뉴스 배경으로 쓸 사진 하나를 골라줘.'
    : '후보가 없어. 원본 사진이 어떤 작품/인물인지만 알려줘.' });
  const system = `너는 카드뉴스 배경 사진을 고르는 편집자다.
- 원본과 같은 사진의 '글씨 없는 원본'이 후보에 있으면 최우선으로 고른다.
- 없으면 같은 작품·같은 인물·비슷한 장면의 다른 사진 중 고른다.
- 사진 위에 덧씌운 글자, 제목, 자막, 로고, 워터마크, 말풍선, 테두리, 여러 장을 붙인 콜라주가 있는 것은 고르지 않는다 (포스터처럼 큰 제목 글씨가 있는 것도 제외).
- 해상도가 크고 선명한 것을 우선. 세로로 긴 사진이면 더 좋다.
- 적합한 후보가 없으면 pick은 -1.
- tmdb에는 이 사진의 작품명(영어 원제) 또는 인물 이름(영어)을 넣는다.
JSON만 출력: {"pick":번호,"reason":"짧게","tmdb":"..."}`;
  const r = await claudeJSON(system, content, 300);
  return { item: Number.isInteger(r.pick) && r.pick >= 0 ? shown[r.pick] || null : null, tmdb: r.tmdb || '' };
}
/* TMDB에서 글씨 없는(언어 없음) 포스터·스틸컷 */
async function tmdbCleanImage(query) {
  if (!state.settings.tmdbKey || !query) return null;
  const d = await tmdb('/search/multi', { query, include_adult: 'false' });
  const hit = (d.results || []).find(x => x.media_type === 'movie' || x.media_type === 'tv') || (d.results || [])[0];
  if (!hit) return null;
  const T = fp => 'https://image.tmdb.org/t/p/original' + fp;
  if (hit.media_type === 'person') {
    const im = await tmdb(`/person/${hit.id}/images`);
    const p = (im.profiles || [])[0];
    return p ? { full: T(p.file_path), w: p.width, h: p.height } : null;
  }
  const im = await tmdb(`/${hit.media_type}/${hit.id}/images`, { include_image_language: 'null' });
  const clean = arr => (arr || []).filter(x => !x.iso_639_1).sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
  const p = clean(im.posters)[0] || clean(im.backdrops)[0];   // 세로 포스터(글씨 없음) 우선
  return p ? { full: T(p.file_path), w: p.width, h: p.height } : null;
}

function pickBestLens(items) {
  // 검색 순위(비슷한 정도)를 유지하면서 1080px 이상인 첫 결과
  return items.find(it => it.full && (it.w >= 1080 || it.h >= 1350)) || null;
}
let autoLensRunning = false;
async function runAutoLens(slideIds, autoReplace) {
  if (autoLensRunning) return;
  const st0 = state.settings;
  if (!PROXY_OK || !(st0.serpApiKey || (st0.tmdbKey && st0.apiKey))) return;
  autoLensRunning = true;
  const task = $('#taskState');
  const setTask = t => { task.textContent = t; task.style.display = t ? '' : 'none'; };
  try {
    saveCurrent();
    // 같은 사진은 한 번만 검색
    const groups = new Map();
    slideIds.forEach(id => {
      const s = slides().find(x => x.id === id);
      const src = s && slideBgSrc(s);
      if (!src) return;
      if (!groups.has(src)) groups.set(src, []);
      groups.get(src).push(id);
    });
    let n = 0, replaced = 0;
    for (const [src, ids] of groups) {
      n++;
      setTask(`🔍 원본 찾는 중 ${n}/${groups.size}`);
      let items = [];
      if (st0.serpApiKey) {
        try {
          const cached = lensCacheGet(src);
          items = cached ? cached.items : await lensSearch(src, 'visual_matches');
          if (!cached) lensCacheSet(src, 'visual_matches', items);
        } catch (e) {
          console.warn('자동 원본 찾기 실패', e);
          if (/키|key|account|credit|searches/i.test(e.message)) { toast('자동 원본 찾기 중단: ' + e.message, 6000); break; }
        }
        ids.forEach(id => { const s = slides().find(x => x.id === id); if (s) s.lens = { count: items.length }; });
        renderSlideList();
      }
      if (!autoReplace) continue;
      // 글씨 없는 깨끗한 사진 고르기: Claude 판단 → (없으면) TMDB 글씨 없는 포스터/스틸 → (Claude 없으면) 가장 비슷한 큰 사진
      setTask(`🧹 글씨 없는 사진 고르는 중 ${n}/${groups.size}`);
      const tryList = [];
      let tmdbQ = '';
      if (st0.apiKey) {
        try {
          const r = await pickCleanWithAI(src, items);
          if (r.item) tryList.push(r.item);
          tmdbQ = r.tmdb;
        } catch (e) { console.warn('AI 사진 고르기 실패', e); tryList.push(...items.filter(it => it.w >= 1080 || it.h >= 1350).slice(0, 1)); }
      } else {
        const b = pickBestLens(items);
        if (b) tryList.push(b);
      }
      let url = null;
      for (const cand of tryList) {
        try {
          const u = await fetchBestImage(cand);
          const im = await loadHtmlImage(u);
          if (im.naturalWidth >= 1000 || im.naturalHeight >= 1000) { url = u; break; }   // 작은 미리보기는 쓰지 않음
        } catch (e) { /* 다음 후보 */ }
      }
      if (!url && tmdbQ) {
        try { const t = await tmdbCleanImage(tmdbQ); if (t) url = await fetchBestImage(t); } catch (e) { console.warn('TMDB 대체 실패', e); }
      }
      if (!url) continue;
      const img = await loadHtmlImage(url);
      for (const id of ids) {
        const s = slides().find(x => x.id === id);
        if (!s) continue;
        if (s === cur()) {
          const bg = canvas.getObjects().find(o => o.type === 'image' && o.kind === 'image' && o.getSrc() === src);
          if (bg) { await setImageSrc(bg, url); fitImage(bg, 'cover'); canvas.requestRenderAll(); commit(true); replaced++; }
        } else if (replaceBgInJson(s.json, src, url, img.naturalWidth, img.naturalHeight)) {
          s.hist = (s.hist || []).slice(0, (s.hi ?? -1) + 1);
          s.hist.push(JSON.stringify(s.json)); s.hi = s.hist.length - 1;   // 그 카드에서 Ctrl+Z로 되돌릴 수 있게
          s.thumb = null; replaced++;
        }
      }
    }
    scheduleAutosave();
    await ensureThumbs();
    renderSlideList();
    toast(autoReplace
      ? `배경 사진 정리 완료! ${replaced}장을 글씨 없는 고화질 사진으로 바꿨어요. 마음에 안 들면 그 카드에서 Ctrl+Z`
      : '원본 찾기 완료! 카드를 고르고 "🔍 원본 찾기"를 누르면 결과가 바로 보여요 (추가 검색 없음)', 6000);
  } finally {
    autoLensRunning = false;
    setTask('');
  }
}

/* 핀터레스트: 공식 API가 아니라 웹사이트 내부 검색을 쓰므로 핀터레스트 사정에 따라 막힐 수 있음 */
const PIN_HEADERS = {
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'X-Fwd-X-Requested-With': 'XMLHttpRequest',
  'X-Fwd-X-Pinterest-PWS-Handler': 'www/search/[scope].js',
  'X-Fwd-Referer': 'https://www.pinterest.com/',
};
const isPinUrl = q => /^https?:\/\/([a-z]+\.)?(pinterest\.[a-z.]+|pin\.it)\//i.test(q);
function pinItem(p) {
  const im = p.images || {};
  const big = im.orig || im['736x'];
  if (!big || !big.url) return null;
  const small = im['474x'] || im['236x'] || big;
  return {
    thumb: small.url, full: big.url, alt: im['736x'] && im['736x'].url,
    w: big.width, h: big.height, title: p.grid_title || p.title || p.seo_alt_text || p.auto_alt_text || '',
    source: (p.pinner && p.pinner.username) ? '📌 ' + p.pinner.username : '📌 Pinterest',
    link: /^\d+$/.test(String(p.id)) ? `https://www.pinterest.com/pin/${p.id}/` : p.link || null,
  };
}
async function searchPinterest(q, bookmark) {
  if (!q) throw new Error('검색어나 핀 링크를 입력하세요.');
  if (isPinUrl(q)) return pinFromUrl(q);
  $('#srStatus').textContent = `핀터레스트에서 "${q}" 찾는 중…`;
  const options = { query: q, scope: 'pins', page_size: 30 };
  if (bookmark) options.bookmarks = [bookmark];
  const url = 'https://www.pinterest.com/resource/BaseSearchResource/get/?source_url=' +
    encodeURIComponent('/search/pins/?q=' + encodeURIComponent(q)) + '&data=' + encodeURIComponent(JSON.stringify({ options, context: {} }));
  let d;
  try { d = await webJSON(url, { headers: PIN_HEADERS }); }
  catch (e) { throw new Error('핀터레스트 검색이 막혔어요 (' + e.message + '). 잠시 뒤 다시 하거나 핀 링크를 붙여넣어 보세요.'); }
  const rr = d.resource_response || {};
  sr.pinNext = rr.bookmark && rr.bookmark !== '-end-' ? { q, bookmark: rr.bookmark } : null;
  return ((rr.data && rr.data.results) || []).map(pinItem).filter(Boolean);
}
async function pinFromUrl(u) {
  $('#srStatus').textContent = '핀 페이지에서 이미지 찾는 중…';
  sr.pinNext = null;
  const r = await webFetch(u, { headers: { Accept: 'text/html' } });
  const html = await r.text();
  const urls = new Set();
  const og = html.match(/property="og:image"[^>]*content="([^"]+)"/i) || html.match(/content="([^"]+)"[^>]*property="og:image"/i);
  if (og) urls.add(og[1].replace(/&amp;/g, '&'));
  (html.match(/https:\/\/i\.pinimg\.com\/(originals|736x)\/[0-9a-f/]+\.(jpg|jpeg|png|webp|gif)/gi) || []).slice(0, 12).forEach(x => urls.add(x));
  if (!urls.size) throw new Error('핀 페이지에서 이미지를 찾지 못했어요. 비공개 핀이거나 핀터레스트가 막았을 수 있어요.');
  return [...urls].map(x => {
    const full = x.replace(/\/(\d+x|\d+x\d+)\//, '/originals/');
    return { thumb: x.replace(/\/originals\//, '/474x/'), full, alt: x.replace(/\/originals\//, '/736x/'), title: '핀 이미지', source: '📌 Pinterest', link: u };
  });
}

async function tmdb(path, params = {}) {
  const key = state.settings.tmdbKey;
  if (!key) throw new Error('설정(⚙)에 TMDB API 키를 넣어주세요. (themoviedb.org 무료 가입 → 설정 → API)');
  const u = new URL('https://api.themoviedb.org/3' + path);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  const headers = { Accept: 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key;
  else u.searchParams.set('api_key', key);
  return webJSON(u.toString(), { headers });
}
async function searchTMDB(q) {
  if (!q) throw new Error('작품명이나 배우 이름을 입력하세요.');
  $('#srStatus').textContent = `TMDB에서 "${q}" 찾는 중…`;
  const d = await tmdb('/search/multi', { query: q, include_adult: 'false', language: 'ko-KR' });
  const hits = (d.results || []).filter(x => ['movie', 'tv', 'person'].includes(x.media_type)).slice(0, 3);
  const T = (fp, size) => `https://image.tmdb.org/t/p/${size}${fp}`;
  const items = [];
  for (const x of hits) {
    const name = x.title || x.name;
    if (x.media_type === 'person') {
      const im = await tmdb(`/person/${x.id}/images`);
      (im.profiles || []).slice(0, 16).forEach(p => items.push({ group: `👤 ${name} · 인물 사진`, thumb: T(p.file_path, 'w300'), full: T(p.file_path, 'original'), w: p.width, h: p.height, title: name, source: 'TMDB' }));
    } else {
      const im = await tmdb(`/${x.media_type}/${x.id}/images`, { include_image_language: 'en,null,ko' });
      (im.backdrops || []).slice(0, 30).forEach(p => items.push({ group: `🎬 ${name} · 스틸컷`, thumb: T(p.file_path, 'w300'), full: T(p.file_path, 'original'), w: p.width, h: p.height, title: name, source: 'TMDB' }));
      (im.posters || []).slice(0, 12).forEach(p => items.push({ group: `🎬 ${name} · 포스터`, thumb: T(p.file_path, 'w300'), full: T(p.file_path, 'original'), w: p.width, h: p.height, title: name, source: 'TMDB' }));
    }
  }
  return items;
}

/* ----- 결과 & 적용 ----- */
function renderResults(items, append = false) {
  const box = $('#srResults');
  if (!append) box.innerHTML = '';
  const oldMore = $('#srMore');
  if (oldMore) oldMore.remove();
  let group = null;
  items.forEach(it => {
    if (it.group && it.group !== group) { group = it.group; box.append(h('div', { class: 'sr-group' }, group)); }
    const big = it.w >= 1080 || it.h >= 1350;
    const card = h('div', { class: 'sr-item', title: (it.title || '') + '\n클릭해서 적용' },
      // 일부 사이트는 직접 링크를 막아서 미리보기도 로컬 서버를 거쳐 받음
      h('img', { src: PROXY_OK && it.thumb && !it.thumb.startsWith('data:') ? '/proxy?url=' + encodeURIComponent(it.thumb) : it.thumb, loading: 'lazy', alt: '' }),
      h('div', { class: 'sr-meta' },
        it.w ? h('span', { class: big ? 'sz big' : 'sz' }, `${it.w}×${it.h}`) : h('span', { class: 'sz', title: '원본 크기 정보 없음 — 출처 페이지에서 원본을 찾아봐요' }, '크기?'),
        h('span', { class: 'src' }, it.source || ''),
        it.link ? h('a', { href: it.link, target: '_blank', rel: 'noopener noreferrer', title: '출처 페이지 열기', onclick: e => e.stopPropagation() }, '↗') : null,
      ));
    card.addEventListener('click', () => applyResult(it, card));
    box.append(card);
  });
  if (sr.pinNext) box.append(h('button', { id: 'srMore', class: 'sr-more', onclick: () => runSearch(true) }, '더 보기'));
}
/* 원본 화질을 최대한 받기: 원본 → (Referer 없이) 원본 → 출처 페이지의 대표 이미지(og:image) → 중간 크기 → 미리보기 */
async function fetchBestImage(it) {
  const tries = [];
  if (it.full && it.full !== it.thumb) {
    tries.push(['원본', () => fetchImageDataURL(it.full)]);
    tries.push(['원본', () => fetchImageDataURL(it.full, true)]);
  }
  if (it.link && !/pinterest\.|tmdb|themoviedb/i.test(it.link)) tries.push(['출처 페이지 이미지', () => ogImageFrom(it.link)]);
  if (it.alt && it.alt !== it.full) tries.push(['중간 크기', () => fetchImageDataURL(it.alt)]);
  let lastErr;
  for (const [label, fn] of tries) {
    try {
      $('#srStatus').textContent = `${label} 받는 중…`;
      return await fn();
    } catch (e) { lastErr = e; }
  }
  if (it.thumb) {
    toast('원본을 받을 수 없어서 작은 미리보기 이미지로 넣었어요. 다른 결과를 써보세요.', 4500);
    return fetchImageDataURL(it.thumb);
  }
  throw lastErr || new Error('이미지를 받지 못했어요');
}
async function ogImageFrom(pageUrl) {
  const r = await webFetch(pageUrl, { headers: { Accept: 'text/html' } });
  const html = (await r.text()).slice(0, 600000);
  const m = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::src)?["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i);
  if (!m) throw new Error('출처 페이지에 대표 이미지가 없어요');
  const img = new URL(m[1].replace(/&amp;/g, '&'), pageUrl).toString();
  return fetchImageDataURL(img);
}
async function fetchImageDataURL(url, noReferer = false) {
  const r = await webFetch(url, { headers: { Accept: 'image/avif,image/webp,image/*,*/*' }, noReferer });
  if (!r.ok) throw new Error(`이미지를 받지 못했어요 (HTTP ${r.status})`);
  const b = await r.blob();
  if (!/^image\//.test(b.type) && b.size < 2000) throw new Error('이미지가 아니에요 (사이트가 막았을 수 있어요)');
  return fileToDataURL(new File([b], 'web', { type: b.type }));
}
async function applyResult(it, card) {
  card.classList.add('loading');
  $('#srStatus').classList.remove('err');
  $('#srStatus').textContent = '고화질 이미지 받는 중…';
  try {
    const url = await fetchBestImage(it);
    if (sr.pick) {   // 두 장 합치기 등: 고른 사진을 넘겨주고 검색 창 닫기
      const pick = sr.pick;
      sr.pick = null;
      $('#searchModal').classList.remove('top');
      closeModal('searchModal');
      await pick(url);
      return;
    }
    if (cur().id !== sr.slideId) { toast('슬라이드가 바뀌어서 새 이미지로 추가해요'); }
    const mode = $$('input[name=srApply]').find(r => r.checked).value;
    const onCanvas = o => o && canvas.getObjects().includes(o);
    if (mode === 'replace' && onCanvas(sr.target) && cur().id === sr.slideId) {
      if (sr.target.kind === 'frame' && isLegacyFrame(sr.target)) { await setFrameImage(sr.target, url); canvas.requestRenderAll(); commit(); }
      else if (sr.target.kind === 'frame') {   // 새 방식 원형 사진: 안에 사진 추가
        const k = await addImageToFrame(canvas, sr.target, url);
        canvas.setActiveObject(k); canvas.requestRenderAll(); commit();
      } else await setImageSrc(sr.target, url);
      sr.lensSrc = url;
    } else if (mode === 'replace-bg' && slideBgImage()) {
      const bg = slideBgImage();
      await setImageSrc(bg, url);
      fitImage(bg, 'cover'); canvas.requestRenderAll(); commit();
    } else if (mode === 'bg') {
      const o = await makeImage(url, { name: '배경 사진' });
      canvas.insertAt(o, 0, false); applyLock(o); canvas.setActiveObject(o); canvas.requestRenderAll();
    } else {
      addObject(await makeImage(url, { fit: 'contain', name: it.title ? it.title.slice(0, 24) : '웹 이미지' }));
    }
    const got = await loadHtmlImage(url);
    const res = `${got.naturalWidth}×${got.naturalHeight}`;
    $('#srStatus').textContent = got.naturalWidth < 1000 && got.naturalHeight < 1000
      ? `적용했어요. 다만 받은 사진이 ${res}로 작아서 흐릿할 수 있어요. 해상도가 초록색인 결과를 골라보세요.`
      : `적용했어요! (${res}) 다른 결과를 눌러 바꿔볼 수도 있어요.`;
    renderProps(); renderLayers();
  } catch (e) {
    console.error(e);
    $('#srStatus').textContent = e.message + ' — 다른 결과를 눌러보세요.';
    $('#srStatus').classList.add('err');
  } finally { card.classList.remove('loading'); }
}

// 탭 바꾸기: 같은 검색어로 그 탭에서 바로 검색 (이미 검색한 탭이면 저장해둔 결과를 바로 보여줌)
const tabQuery = tab => (tab === 'lens' ? 'lens|' + $('#srLensQ').value.trim() : $('#srQuery').value.trim());
function switchSearchTab(tab) {
  if (tab === sr.tab) return;
  sr.tabResults = sr.tabResults || {};
  if (sr.lastItems) sr.tabResults[sr.tab] = { q: sr.lastQ, items: sr.lastItems, pinNext: sr.pinNext, count: sr.count };
  setSearchTab(tab);
  const st = $('#srStatus');
  st.classList.remove('err');
  const q = tabQuery(tab), c = sr.tabResults[tab];
  sr.lastItems = null; sr.pinNext = null; sr.count = 0;
  $('#srResults').innerHTML = '';
  if (c && c.q === q) {
    sr.lastItems = c.items; sr.lastQ = c.q; sr.pinNext = c.pinNext; sr.count = c.count;
    renderResults(c.items);
    st.textContent = `${c.items.length}개 (아까 검색한 결과) — 클릭하면 적용돼요`;
  } else if (tab !== 'lens' && $('#srQuery').value.trim()) {
    runSearch();
  } else {
    st.textContent = tab === 'lens' ? "'검색'을 누르면 이 사진으로 원본·비슷한 이미지를 찾아요" : '검색어를 넣고 검색하세요';
  }
}

function bindSearchUI() {
  $$('#searchModal [data-src]').forEach(b => b.onclick = () => switchSearchTab(b.dataset.src));
  $('#srGo').onclick = runSearch;
  $('#srAI').onclick = extractKeywords;
  // 사진 고르기 모드(원형 사진·두 장 합치기)에서 검색 대신 내 파일 넣기
  $('#srFile').onclick = async () => {
    if (!sr.pick) return;
    const [f] = await pickFiles();
    if (!f) return;
    busy(true, '사진 불러오는 중…');
    try {
      const url = await fileToDataURL(f);
      const pick = sr.pick;
      sr.pick = null;
      closeModal('searchModal');
      await pick(url);
    } catch (e) { toast(e.message); } finally { busy(false); }
  };
  $('#srQuery').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
  $('#srLensQ').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
}
