'use strict';
/* ===== 공통: 상수, 상태, 유틸, 저장소 ===== */

const W = 1080;
const BASE_H = 1350;   // 템플릿은 항상 4:5(1080×1350) 기준으로 만든 뒤 카드 크기에 맞춰 변환
let H = BASE_H;        // 지금 프로젝트의 카드 높이 (1350 = 4:5, 1080 = 1:1)
function setCardHeight(h) {
  H = h || BASE_H;
  document.documentElement.style.setProperty('--card-ratio', `${W} / ${H}`);
  if (typeof canvas !== 'undefined' && canvas) { if (state.fitMode) zoomFit(); else layoutCanvas(); }
}
// fabric 직렬화 시 함께 저장할 사용자 속성
const PROPS = ['kind', 'layerName', 'uid', 'lockedLayer', 'gradStart', 'gradStrength', 'gradColor', 'gradDir', 'gradSolid', 'gradCurve',
  'frameZoom', 'frameOffX', 'frameOffY', 'dotActive', 'dotColor', 'mergeSpec', 'textureSrc', 'textureOpacity', 'frameId', 'clipMode'];

const FONTS = [
  { family: 'Paperlogy', label: '페이퍼로지 (김동댕 제목)', weights: ['400', '500', '600', '700', '800', '900'] },
  { family: 'Freesentation', label: '프리젠테이션 (김동댕 본문)', weights: ['100', '200', '300', '400', '500', '600', '700', '800', '900'] },
  { family: 'GmarketSansBold', label: 'G마켓 산스 Bold', weights: ['normal'] },
  { family: 'GmarketSansMedium', label: 'G마켓 산스 Medium', weights: ['normal'] },
  { family: 'Pretendard', label: '프리텐다드', weights: ['400', '500', '600', '700', '800', '900'] },
  { family: 'SBAggroB', label: '어그로체 B', weights: ['normal'] },
  { family: 'Black Han Sans', label: '검은고딕', weights: ['normal'] },
  { family: 'Do Hyeon', label: '도현', weights: ['normal'] },
  { family: 'Jua', label: '주아', weights: ['normal'] },
  { family: 'Cafe24Ssurround', label: '카페24 써라운드', weights: ['normal'] },
  { family: 'Noto Sans KR', label: '본고딕 (Noto Sans KR)', weights: ['400', '500', '700', '900'] },
  { family: 'Nanum Myeongjo', label: '나눔명조', weights: ['700', '800'] },
];

const DEFAULT_PROMPT = `너는 해외 인스타그램 게시물(영화·드라마·연예·이슈 뉴스)을 한국 인스타그램 카드뉴스로 재구성하는 전문 에디터다.

[카드뉴스 구성 규칙]
- 1장(cover): 스크롤을 멈추게 하는 후킹 제목. 2~4줄, 한 줄 9자 이내. 핵심 키워드는 *별표*로 감싸 노란색 강조.
- 2장부터(body): 한 장에 정보 하나. 2~3줄, 한 줄 15자 이내. 강조는 장마다 1~2곳만 *별표*로.
- 인물의 발언을 그대로 옮기는 장은 type "quote": text에는 따옴표 없이 발언만, "speaker"에 말한 사람 이름(한국어).
- 줄바꿈은 의미 단위로 직접 넣는다(\\n).
- 문체: 본문(body)의 모든 문장은 "~니다/~습니다"로 끝나는 합쇼체 (예: ~했습니다, ~예정입니다, ~라고 합니다, ~예상됩니다). "~했다", "~이다" 같은 반말 끝맺음 금지. 커버는 짧은 후킹 문장.
- 원문에 없는 사실은 절대 지어내지 않는다. 숫자·날짜는 원문 그대로. 루머는 루머라고 밝힌다.
- 고유명사는 국내 통용 표기 (예: 어벤져스: 둠스데이, 로버트 다우니 주니어, 마블 스튜디오).
- 카드 수는 원본 게시물의 카드(사진) 수와 같게. 원본 1장 = 카드뉴스 1장. 원문에 없는 설명이나 마무리 장을 덧붙이지 않는다.
- 각 장에 가장 어울리는 이미지 번호(image)를 고른다. 같은 이미지를 여러 번 써도 된다.
- 커버에 넣을 인물 얼굴 사진이 따로 있으면 inset에 그 번호를, 없으면 null.

[출력 형식] 아래 JSON만 출력한다. 설명·코드블록 금지.
{"slides":[{"type":"cover","text":"2003년 헐크\\n어벤져스에\\n복귀한다는 *루머*","image":0,"inset":1},{"type":"body","text":"개봉 첫 주에만\\n*흥행 수익 10억 달러*를\\n거둘 것으로 예상됩니다","image":2,"inset":null}],"caption":"인스타 게시물 본문 캡션 (한국어 3~6문장 + 해시태그 5개 내외)"}`;

const defaultSettings = () => ({
  accent: '#FFC700',
  brandName: '김동댕',
  logo: null,
  apiKey: '',
  model: 'claude-sonnet-5-5',
  serpApiKey: '',
  tmdbKey: '',
  prompt: DEFAULT_PROMPT,
  customFonts: [],
  exportFormat: 'jpeg',
  exportDir: '',   // 비우면 서버 기본값: 문서\insta_auto_upload\업로드폴더 (없으면 문서\카드뉴스 저장)
  exportWithCaption: false,   // 켜면 caption.txt까지 저장 → 자동 업로드 프로그램이 바로 게시
});

const state = {
  settings: defaultSettings(),
  project: null,      // { caption, sourceUrl, slides: [{ id, json, thumb }] }
  current: 0,
  zoom: 0.5,
  fitMode: true,
  loading: false,
  clipboard: null,
  textSel: null,
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => Math.random().toString(36).slice(2, 10);
const round = (v, d = 1) => { const p = 10 ** d; return Math.round(v * p) / p; };

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (['value', 'checked', 'selected', 'disabled', 'multiple', 'title'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function busy(on, text) {
  $('#busy').classList.toggle('show', !!on);
  if (text) $('#busyText').textContent = text;
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

function walkObjs(objs, fn) {
  (objs || []).forEach(o => { fn(o); if (o.objects) walkObjs(o.objects, fn); });
}

/* ----- 폰트 ----- */
function allFonts() {
  return FONTS.concat((state.settings.customFonts || []).map(f => ({ family: f.name, label: f.name + ' (내 폰트)', weights: ['normal'] })));
}
function fontInfo(family) { return allFonts().find(f => f.family === family); }
function loadFont(family, weight = 'normal') {
  return withTimeout(document.fonts.load(`${weight} 40px "${family}"`, '가A1'), 6000).catch(() => {});
}
async function preloadFonts() {
  const jobs = [];
  FONTS.forEach(f => f.weights.forEach(w => jobs.push(loadFont(f.family, w))));
  await Promise.all(jobs);
}
async function registerCustomFonts() {
  for (const f of state.settings.customFonts || []) {
    try {
      const ff = new FontFace(f.name, `url(${f.data})`);
      document.fonts.add(await ff.load());
    } catch (e) { console.warn('폰트 등록 실패', f.name, e); }
  }
}
async function ensureFontsFor(json) {
  const set = new Set();
  const addStyle = (st, o) => { if (st && st.fontFamily) set.add(`${st.fontWeight || o.fontWeight || 'normal'}|${st.fontFamily}`); };
  walkObjs(json.objects, o => {
    if (o.fontFamily) set.add(`${o.fontWeight || 'normal'}|${o.fontFamily}`);
    if (Array.isArray(o.styles)) o.styles.forEach(s => addStyle(s.style, o));
    else if (o.styles) Object.values(o.styles).forEach(l => Object.values(l).forEach(s => addStyle(s, o)));
  });
  await Promise.all([...set].map(k => { const [w, f] = k.split('|'); return loadFont(f, w); }));
  fabric.util.clearFabricFontCache();
  // 글씨 텍스쳐 이미지도 미리 준비 (내보내기에서 빠지지 않게)
  const tex = new Set();
  walkObjs(json.objects, o => { if (o.textureSrc) tex.add(o.textureSrc); });
  await Promise.all([...tex].map(s => loadTexture(s).catch(() => {})));
}

/* ----- 이미지 파일 읽기 (HEIC 변환 + 축소) ----- */
function loadHtmlImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('이미지를 읽을 수 없어요'));
    i.src = src;
  });
}
async function decodeBlob(blob) {
  const url = URL.createObjectURL(blob);
  try { return await loadHtmlImage(url); } finally { URL.revokeObjectURL(url); }
}
async function fileToDataURL(file, maxSide = 4096) {
  let blob = file;
  let img;
  try {
    // 확장자가 .heic여도 실제로는 JPEG인 경우가 많아서 먼저 그대로 읽어봄
    img = await decodeBlob(blob);
  } catch (e) {
    const isHeic = /hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name || '');
    if (!isHeic) throw new Error(`${file.name || '이미지'}: 읽을 수 없는 형식이에요`);
    if (typeof heic2any !== 'function') throw new Error('HEIC 변환기를 불러오지 못했어요');
    try {
      blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.93 });
    } catch (err) {
      throw new Error(`HEIC 변환 실패: ${(err && err.message) || err}`);
    }
    if (Array.isArray(blob)) blob = blob[0];
    img = await decodeBlob(blob);
  }
  // 충분히 작으면(4096px 이하) 다시 압축하지 않고 원본 파일 그대로 사용 → 화질 손실 없음
  const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  if (s === 1 && /^image\/(jpeg|png|webp|gif)$/i.test(blob.type || '')) return readAsDataURL(blob);
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, c.width, c.height);
  const keepAlpha = /png|webp|gif|svg/i.test(blob.type || '');
  return c.toDataURL(keepAlpha ? 'image/png' : 'image/jpeg', 0.96);
}
function isImageFile(f) { return /^image\//.test(f.type) || /\.(heic|heif|jpe?g|png|webp|gif|avif)$/i.test(f.name || ''); }

function pickFiles(accept = 'image/*,.heic,.heif', multiple = false) {
  return new Promise(res => {
    const inp = h('input', { type: 'file', accept, multiple });
    inp.style.display = 'none';
    inp.addEventListener('change', () => { res([...inp.files]); inp.remove(); });
    document.body.append(inp);
    inp.click();
  });
}
function readAsDataURL(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}
function readAsText(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); });
}
function downloadURL(url, name) {
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  downloadURL(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function stamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/* ----- IndexedDB 저장소 ----- */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('cardnews-editor', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  get(k) {
    return new Promise((res, rej) => {
      if (!this.db) return res(undefined);
      const q = this.db.transaction('kv').objectStore('kv').get(k);
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
  },
  set(k, v) {
    return new Promise((res, rej) => {
      if (!this.db) return res();
      const tx = this.db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(v, k);
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });
  },
};

let autosaveTimer;
function scheduleAutosave() {
  $('#saveState').textContent = '저장 중…';
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(saveProjectToDB, 900);
}
async function saveProjectToDB() {
  try {
    const p = state.project;
    await DB.set('project', {
      name: p.name || '', cardH: H, caption: p.caption || '', sourceUrl: p.sourceUrl || '', sourceText: p.sourceText || '',
      slides: p.slides.map(s => ({ id: s.id, json: s.json, thumb: s.thumb, lens: s.lens })),
      lensCache: p.lensCache || {},
      current: state.current,
    });
    $('#saveState').textContent = '자동 저장됨';
  } catch (e) {
    console.error(e);
    $('#saveState').textContent = '저장 실패 (용량?)';
  }
}
function saveSettings() { return DB.set('settings', state.settings).catch(console.error); }
