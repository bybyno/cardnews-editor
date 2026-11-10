'use strict';
/* ===== 오브젝트 팩토리 & 템플릿 ===== */

let PLACEHOLDER = '';
let DEFAULT_LOGO = '';
const accent = () => state.settings.accent;
const getLogo = () => state.settings.logo || DEFAULT_LOGO;

function rgba(color, a) {
  const s = new fabric.Color(color || '#000').getSource();
  return `rgba(${s[0]},${s[1]},${s[2]},${a})`;
}
function toHex(c) {
  try { return '#' + new fabric.Color(c || '#000000').toHex().toLowerCase(); } catch (e) { return '#000000'; }
}
const sameColor = (a, b) => !!a && !!b && toHex(a) === toHex(b);

function base(kind, name) { return { kind, layerName: name, uid: uid(), originX: 'center', originY: 'center' }; }

function loadFabricImage(src) {
  return new Promise((res, rej) => fabric.Image.fromURL(src, (img, err) => (err || !img || !img.width) ? rej(new Error('이미지 로드 실패')) : res(img)));
}

/* 기본 로고 (사자 얼굴) — 설정에서 실제 로고로 교체 */
async function makeDefaultLogo() {
  // 기본 로고: assets/logo.png (김동댕 사자). 못 읽으면 아래 그림으로 대체
  try {
    const r = await fetch('assets/logo.png');
    if (r.ok) return await readAsDataURL(await r.blob());
  } catch (e) { /* file:// 등 */ }
  return makeFallbackLogo();
}
async function makeFallbackLogo() {
  const petals = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    petals.push(`<circle cx="${100 + Math.cos(a) * 66}" cy="${100 + Math.sin(a) * 66}" r="30"/>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 200 200">
    <g fill="#B8652A">${petals.join('')}<circle cx="100" cy="100" r="74"/></g>
    <circle cx="70" cy="70" r="13" fill="#FBE6C2"/><circle cx="130" cy="70" r="13" fill="#FBE6C2"/>
    <circle cx="100" cy="106" r="52" fill="#FBE6C2"/>
    <circle cx="83" cy="100" r="5.5" fill="#3a2414"/><circle cx="117" cy="100" r="5.5" fill="#3a2414"/>
    <ellipse cx="100" cy="116" rx="9" ry="6.5" fill="#3a2414"/>
    <path d="M100 121 q-7 11 -16 5 M100 121 q7 11 16 5" stroke="#3a2414" stroke-width="3.2" fill="none" stroke-linecap="round"/>
  </svg>`;
  const img = await loadHtmlImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  const c = document.createElement('canvas'); c.width = c.height = 300;
  c.getContext('2d').drawImage(img, 0, 0, 300, 300);
  return c.toDataURL('image/png');
}

/* 사진 자리표시 이미지 */
function makePlaceholder() {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#4a4f58'); g.addColorStop(1, '#22252a');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.strokeStyle = 'rgba(255,255,255,0.18)'; x.lineWidth = 6;
  x.strokeRect(W / 2 - 90, H * 0.36 - 70, 180, 140);
  x.beginPath(); x.arc(W / 2 - 30, H * 0.36 - 20, 18, 0, Math.PI * 2); x.stroke();
  x.beginPath(); x.moveTo(W / 2 - 90, H * 0.36 + 60); x.lineTo(W / 2 - 10, H * 0.36 - 5); x.lineTo(W / 2 + 90, H * 0.36 + 55); x.stroke();
  x.fillStyle = 'rgba(255,255,255,0.42)'; x.textAlign = 'center';
  x.font = '700 46px Pretendard, sans-serif';
  x.fillText('더블클릭해서 사진 넣기', W / 2, H * 0.36 + 150);
  x.font = '500 30px Pretendard, sans-serif';
  x.fillText('또는 사진 파일을 여기로 끌어다 놓기', W / 2, H * 0.36 + 205);
  return c.toDataURL('image/jpeg', 0.85);
}

/* ----- 이미지 ----- */
async function makeImage(src, o = {}) {
  const img = await loadFabricImage(src || PLACEHOLDER);
  const fit = o.fit || 'cover';
  const s = fit === 'cover' ? Math.max(W / img.width, H / img.height) : Math.min(W * 0.8 / img.width, H * 0.8 / img.height);
  img.set({ ...base('image', o.name || '이미지'), left: o.left ?? W / 2, top: o.top ?? H / 2, scaleX: s, scaleY: s });
  return img;
}
function fitImage(o, mode) {
  const s = mode === 'cover' ? Math.max(W / o.width, H / o.height) : Math.min(W / o.width, H / o.height);
  o.set({ scaleX: s, scaleY: s, angle: 0 });
  o.setPositionByOrigin(new fabric.Point(W / 2, H / 2), 'center', 'center');
  o.setCoords();
}

/* ----- 그라데이션 ----- */
// 그라데이션: 시작(투명) → 곡선을 따라 진해짐 → '완전 진하게' 지점부터 끝까지 꽉 찬 색
const GRAD_CURVES = {
  smooth: t => t * t * (3 - 2 * t),          // 부드럽게 (S자)
  linear: t => t,                            // 고르게
  fast: t => 1 - (1 - t) * (1 - t),          // 빨리 진해짐
  slow: t => t * t * t,                      // 천천히 진해지다 끝에서 확
};
const GRAD_PRESETS = {
  soft: { label: '은은하게', gradStart: 0.55, gradSolid: 1, gradStrength: 0.8, gradCurve: 'smooth' },
  normal: { label: '기본', gradStart: 0.42, gradSolid: 0.9, gradStrength: 1, gradCurve: 'smooth' },
  strong: { label: '진하게', gradStart: 0.3, gradSolid: 0.8, gradStrength: 1, gradCurve: 'fast' },
  black: { label: '아래 꽉 검정', gradStart: 0.45, gradSolid: 0.72, gradStrength: 1, gradCurve: 'smooth' },
};
function makeGradient(o = {}) {
  const r = new fabric.Rect({
    ...base('gradient', o.name || '그라데이션'), left: W / 2, top: H / 2, width: W, height: H, strokeWidth: 0,
    gradStart: o.start ?? 0.42, gradSolid: o.solid ?? 0.9, gradStrength: o.strength ?? 1, gradCurve: o.curve || 'smooth',
    gradColor: o.color || '#000000', gradDir: o.dir || 'bottom',
    lockedLayer: o.locked ?? false,
  });
  applyGradient(r);
  return r;
}
function applyGradient(r) {
  const c = r.gradColor || '#000000';
  const s = clamp(r.gradStart ?? 0.45, 0, 0.98), k = clamp(r.gradStrength ?? 0.95, 0, 1);
  const w = r.width, hh = r.height;
  const coords = {
    bottom: { x1: 0, y1: 0, x2: 0, y2: hh }, top: { x1: 0, y1: hh, x2: 0, y2: 0 },
    right: { x1: 0, y1: 0, x2: w, y2: 0 }, left: { x1: w, y1: 0, x2: 0, y2: 0 },
  }[r.gradDir || 'bottom'];
  let stops;
  if (r.gradSolid == null) {
    // 예전에 만든 그라데이션 (설정 추가 전) — 모양 그대로
    stops = [{ offset: 0, color: rgba(c, 0) }, { offset: s, color: rgba(c, 0) },
      { offset: s + (1 - s) * 0.45, color: rgba(c, k * 0.82) }, { offset: 1, color: rgba(c, k) }];
  } else {
    const e = clamp(r.gradSolid, s + 0.02, 1);
    const ease = GRAD_CURVES[r.gradCurve] || GRAD_CURVES.smooth;
    stops = [{ offset: 0, color: rgba(c, 0) }, { offset: s, color: rgba(c, 0) }];
    for (let i = 1; i <= 12; i++) {
      const t = i / 12;
      stops.push({ offset: s + (e - s) * t, color: rgba(c, round(k * ease(t), 3)) });
    }
    if (e < 1) stops.push({ offset: 1, color: rgba(c, k) });
  }
  r.set('fill', new fabric.Gradient({ type: 'linear', gradientUnits: 'pixels', coords, colorStops: stops }));
  r.dirty = true;
}

/* ----- 사진 프레임 (원형/사각, 안쪽 사진 이동·확대) ----- */
function frameSize(o) { return o.type === 'circle' ? [o.radius * 2, o.radius * 2] : [o.width, o.height]; }
function updateFrame(o) {
  const p = o.fill;
  if (!p || !p.source) return;
  const [fw, fh] = frameSize(o);
  const iw = p.source.naturalWidth || p.source.width, ih = p.source.naturalHeight || p.source.height;
  const s = Math.max(fw / iw, fh / ih) * (o.frameZoom || 1);
  const tx = (fw - iw * s) / 2 + (o.frameOffX || 0);
  const ty = (fh - ih * s) / 2 + (o.frameOffY || 0);
  p.repeat = 'no-repeat';
  p.patternTransform = [s, 0, 0, s, tx, ty];
  o.dirty = true;
}
async function setFrameImage(o, src) {
  const img = await loadHtmlImage(src || PLACEHOLDER);
  o.set('fill', new fabric.Pattern({ source: img, repeat: 'no-repeat' }));
  o.set({ frameZoom: 1, frameOffX: 0, frameOffY: 0 });
  updateFrame(o);
}
async function makeFrame(src, shape = 'circle', o = {}) {
  const common = {
    ...base('frame', o.name || (shape === 'circle' ? '원형 사진' : '사진 프레임')),
    left: o.left ?? W / 2, top: o.top ?? H / 2, stroke: o.stroke ?? accent(), strokeWidth: o.strokeWidth ?? 10,
    strokeUniform: true, frameZoom: 1, frameOffX: 0, frameOffY: 0,
  };
  const f = shape === 'circle'
    ? new fabric.Circle({ ...common, radius: o.radius || 200 })
    : new fabric.Rect({ ...common, width: o.width || 860, height: o.height || 640, rx: o.rx || 0, ry: o.rx || 0 });
  await setFrameImage(f, src);
  return f;
}

/* ----- 프레임(원형·사각) 안에 여러 사진 넣기 -----
   프레임 = 테두리 + 안쪽 배경. 안에 넣은 사진(frameId = 프레임 uid)은 레이어상 프레임 바로 위에 있고
   프레임 모양으로 잘려 보임(clipMode: inside 원 안에만 / popout 위로 튀어나오기 / free 자르지 않기). */
const FRAME_INNER_BG = '#1f2024';
const FRAME_BIG = 4000;
const isLegacyFrame = f => !!(f.fill && f.fill.source);   // 예전 방식(사진을 무늬로 채운 프레임)
const frameKids = (cv, f) => cv.getObjects().filter(o => o.frameId && o.frameId === f.uid);
const frameOf = (cv, o) => (o && o.frameId ? cv.getObjects().find(x => x.kind === 'frame' && x.uid === o.frameId) : null);
function frameCenter(f) { return fabric.util.transformPoint(new fabric.Point(0, 0), f.calcTransformMatrix()); }
function frameOuterSize(f) {
  return f.type === 'circle' ? [f.radius * 2 * f.scaleX, f.radius * 2 * f.scaleY] : [f.width * f.scaleX, f.height * f.scaleY];
}
function frameInnerShape(f) {
  const sw = f.strokeWidth || 0;
  if (f.type === 'circle') {
    return new fabric.Circle({ radius: Math.max(1, f.radius * Math.max(f.scaleX, f.scaleY) - sw / 2), originX: 'center', originY: 'center', left: 0, top: 0 });
  }
  const [w, hh] = frameOuterSize(f);
  return new fabric.Rect({ width: Math.max(1, w - sw), height: Math.max(1, hh - sw), rx: Math.max(0, (f.rx || 0) - sw / 2), ry: Math.max(0, (f.ry || 0) - sw / 2), originX: 'center', originY: 'center', left: 0, top: 0 });
}
function buildFrameClip(f, mode) {
  const c = frameCenter(f), ang = f.angle || 0, rad = fabric.util.degreesToRadians(ang);
  const inner = frameInnerShape(f);
  if (mode === 'popout') {
    // 프레임 안쪽 + 프레임 중심선보다 위쪽 전부 → 아래는 원에 잘리고 위로는 튀어나옴
    const rect = new fabric.Rect({ left: -FRAME_BIG, top: -FRAME_BIG, width: FRAME_BIG * 2, height: FRAME_BIG, originX: 'left', originY: 'top' });
    const g = new fabric.Group([inner, rect]);
    const halfH = inner.type === 'circle' ? inner.radius : inner.height / 2;
    const off = fabric.util.rotateVector({ x: 0, y: (halfH - FRAME_BIG) / 2 }, rad);
    g.set({ originX: 'center', originY: 'center', left: c.x + off.x, top: c.y + off.y, angle: ang, absolutePositioned: true });
    return g;
  }
  inner.set({ left: c.x, top: c.y, angle: ang, absolutePositioned: true });
  return inner;
}
// 프레임이 움직이면 안의 사진도 같이 옮기고, 잘라내는 모양(clipPath)을 최신으로
function syncFrames(cv) {
  const objs = cv.getObjects();
  objs.forEach(f => {
    if (f.kind !== 'frame') return;
    const kids = objs.filter(o => o.frameId === f.uid);
    const c = frameCenter(f);
    if (f._pos && (Math.abs(c.x - f._pos.x) > 0.01 || Math.abs(c.y - f._pos.y) > 0.01)) {
      const dx = c.x - f._pos.x, dy = c.y - f._pos.y;
      kids.forEach(k => { if (k.group) return; k.left += dx; k.top += dy; k.setCoords(); });
    }
    f._pos = { x: c.x, y: c.y };
    const sig = [Math.round(c.x * 10), Math.round(c.y * 10), f.radius, f.width, f.height, f.scaleX, f.scaleY, f.angle, f.strokeWidth, f.rx].join(',');
    kids.forEach(k => {
      const mode = k.clipMode || 'inside';
      if (k._clipSig === sig + mode) return;
      k._clipSig = sig + mode;
      k.clipPath = mode === 'free' ? null : buildFrameClip(f, mode);
      k.dirty = true;
    });
  });
}
// 안의 사진들을 항상 프레임 바로 위로 (레이어 순서 정리)
function restackFrames(cv) {
  const arr = cv._objects;   // 안의 사진끼리 순서는 유지한 채 프레임 바로 위로 모음
  arr.filter(o => o.kind === 'frame').forEach(f => {
    const kids = arr.filter(o => o.frameId === f.uid);
    if (!kids.length) return;
    kids.forEach(k => arr.splice(arr.indexOf(k), 1));
    arr.splice(arr.indexOf(f) + 1, 0, ...kids);
  });
}
function makeEmptyFrame(shape = 'circle', o = {}) {
  const common = {
    ...base('frame', o.name || (shape === 'circle' ? '원형 사진' : '사진 프레임')),
    left: o.left ?? W / 2, top: o.top ?? H / 2, stroke: o.stroke ?? accent(), strokeWidth: o.strokeWidth ?? 10,
    strokeUniform: true, fill: FRAME_INNER_BG,
  };
  return shape === 'circle'
    ? new fabric.Circle({ ...common, radius: o.radius || 200 })
    : new fabric.Rect({ ...common, width: o.width || 860, height: o.height || 640, rx: o.rx || 0, ry: o.rx || 0 });
}
// 프레임을 꽉 채우는 크기로 안에 넣을 사진 만들기 (캔버스에 넣기 전)
async function makeFramePic(f, src) {
  const img = await loadFabricImage(src || PLACEHOLDER);
  const c = frameCenter(f), [fw, fh] = frameOuterSize(f);
  const s = Math.max(fw / img.width, fh / img.height);
  img.set({ ...base('framepic', f.type === 'circle' ? '원 안 사진' : '프레임 안 사진'), left: c.x, top: c.y, scaleX: s, scaleY: s, frameId: f.uid, clipMode: 'inside' });
  return img;
}
// 예전 방식 프레임(무늬로 채운 사진) → 안에 든 사진 레이어로 바꿈
function convertLegacyFrame(cv, f) {
  if (!isLegacyFrame(f)) return null;
  const p = f.fill, img = new fabric.Image(p.source);
  const t = p.patternTransform || [1, 0, 0, 1, 0, 0], s = t[0];
  const [fw, fh] = frameSize(f);
  const lx = -fw / 2 + t[4] + img.width * s / 2, ly = -fh / 2 + t[5] + img.height * s / 2;
  const c = frameCenter(f);
  const off = fabric.util.rotateVector({ x: lx * f.scaleX, y: ly * f.scaleY }, fabric.util.degreesToRadians(f.angle || 0));
  img.set({ ...base('framepic', f.type === 'circle' ? '원 안 사진' : '프레임 안 사진'), left: c.x + off.x, top: c.y + off.y,
    scaleX: s * f.scaleX, scaleY: s * f.scaleY, angle: f.angle || 0, frameId: f.uid, clipMode: 'inside' });
  f.set('fill', FRAME_INNER_BG);
  cv.insertAt(img, cv.getObjects().indexOf(f) + 1, false);
  return img;
}
async function addImageToFrame(cv, f, src) {
  convertLegacyFrame(cv, f);
  const img = await makeFramePic(f, src);
  const objs = cv.getObjects();
  const top = Math.max(objs.indexOf(f), ...frameKids(cv, f).map(k => objs.indexOf(k)));
  cv.insertAt(img, top + 1, false);
  applyLock(img);
  syncFrames(cv);
  return img;
}
function fitToFrame(cv, o) {
  const f = frameOf(cv, o);
  if (!f) return;
  const c = frameCenter(f), [fw, fh] = frameOuterSize(f);
  const s = Math.max(fw / o.width, fh / o.height);
  o.set({ scaleX: s, scaleY: s, angle: 0 });
  o.setPositionByOrigin(c, 'center', 'center');
  o.setCoords();
}

/* ----- 글씨 텍스쳐 (PSD: 글씨에 클리핑된 마블 텍스쳐, 어둡게 20%) ----- */
const BUILTIN_TEXTURES = { marble: 'assets/texture-marble.jpg' };
const TEXTURES = {};   // 키 → 가공된 텍스쳐 캔버스 (검정 + 어두운 정도만큼 불투명)
const textureKey = src => (BUILTIN_TEXTURES[src] ? src : 'u_' + src.length + '_' + src.slice(-60));
async function loadTexture(src) {
  const key = textureKey(src);
  if (TEXTURES[key]) return TEXTURES[key];
  const img = await loadHtmlImage(BUILTIN_TEXTURES[src] || src);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  // 포토샵 '어둡게' 합성을 흉내: 밝은 부분은 투명, 어두운 부분일수록 진한 검정
  const d = x.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const L = 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2];
    d.data[i] = d.data[i + 1] = d.data[i + 2] = 0;
    d.data[i + 3] = 255 - L;
  }
  x.putImageData(d, 0, 0);
  TEXTURES[key] = c;
  return c;
}
// 글씨 모양 안에만 텍스쳐를 덮어 그림 (renderGlyphs = 원래 글씨 그리기 함수)
function drawTextTexture(t, ctx, renderGlyphs) {
  const tex = TEXTURES[textureKey(t.textureSrc)];
  if (!tex) {
    loadTexture(t.textureSrc).then(() => { t.dirty = true; if (t.canvas) t.canvas.requestRenderAll(); }).catch(() => {});
    return;
  }
  const m = ctx.getTransform();
  const sx = Math.hypot(m.a, m.b) || 1, sy = Math.hypot(m.c, m.d) || 1;
  const pad = (t.strokeWidth || 0) + 6;
  const w = t.width + pad * 2, hh = t.height + pad * 2;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w * sx)); c.height = Math.max(1, Math.ceil(hh * sy));
  const x = c.getContext('2d');
  x.scale(sx, sy); x.translate(w / 2, hh / 2);
  renderGlyphs.call(t, x);
  x.globalCompositeOperation = 'source-in';
  // 텍스쳐 한 장이 카드 폭(1080px)을 덮는 크기 (PSD와 동일한 비율)
  const k = (W / tex.width) / (t.scaleX || 1);
  x.save(); x.scale(k, k);
  x.fillStyle = x.createPattern(tex, 'repeat');
  x.fillRect(-w / 2 / k, -hh / 2 / k, w / k, hh / k);
  x.restore();
  ctx.save();
  ctx.globalAlpha *= t.textureOpacity;
  ctx.drawImage(c, -w / 2, -hh / 2, w, hh);
  ctx.restore();
}
// 김동댕 PSD 제목 스타일 (Paperlogy 7Bold · 자간 -20 · 그림자 70% · 마블 텍스쳐 20%)
const PSD_TITLE_STYLE = {
  font: 'Paperlogy', weight: '700', charSpacing: -20,
  shadow: { color: 'rgba(0,0,0,0.7)', blur: 10, offsetX: 0, offsetY: 5 },
  textureSrc: 'marble', textureOpacity: 0.2,
};

// 김동댕 PSD 본문 스타일 (Freesentation 7Bold 75px · 행간 75px · 자간 -20 · 그림자 70% · 마블 20%)
const PSD_BODY_STYLE = { ...PSD_TITLE_STYLE, font: 'Freesentation', weight: '700', size: 75, lineHeight: 0.885 };
// 인용 카드의 '-말한 사람' (Freesentation 1Thin 62.5px, 효과 없음)
const PSD_SPEAKER_STYLE = { font: 'Freesentation', weight: '100', size: 62.5, lineHeight: 1, charSpacing: -20, shadow: false };
const BODY_TOP = 966;
// 레이어 이름별 PSD 글씨 프리셋
const PSD_PRESETS = {
  title: { label: '제목', ...PSD_TITLE_STYLE, size: 104, lineHeight: 0.815 },
  body: { label: '본문', ...PSD_BODY_STYLE },
  speaker: { label: '말한 사람', ...PSD_SPEAKER_STYLE },
};
const PRESET_BY_NAME = { '제목': 'title', '본문': 'body', '인용문': 'body', '말한 사람': 'speaker' };
// 프리셋 → 텍스트 속성 (JSON에 그대로 넣을 수 있는 형태)
function presetProps(key) {
  const p = PSD_PRESETS[key];
  return {
    fontFamily: p.font, fontWeight: p.weight, fontSize: p.size, lineHeight: p.lineHeight, charSpacing: p.charSpacing,
    shadow: p.shadow === false ? null : { ...p.shadow, affectStroke: false, nonScaling: false },
    textureSrc: p.textureSrc || null, textureOpacity: p.textureOpacity ?? 0.2,
  };
}   // PSD 본문 글씨 시작 위치 (글씨 위끝 y≈972)
function makeBodyText(text, name = '본문') {
  const t = makeText(text || '본문 내용을\n*여기에* 입력하세요', { ...PSD_BODY_STYLE, name });
  fitText(t, 990);
  t.set({ top: BODY_TOP + t.height / 2 }); t.setCoords();
  return t;
}

/* ----- 텍스트 (마크업: *강조*) ----- */
function setMarkup(t, markup) {
  const ac = accent();
  const styles = {};
  let on = false;   // 줄바꿈을 넘어 이어지는 강조(*…\n…*)도 유지
  const out = String(markup).replace(/\r/g, '').split('\n').map((line, li) => {
    let ci = 0, s = '';
    for (const ch of [...line]) {
      if (ch === '*') { on = !on; continue; }
      if (on) (styles[li] = styles[li] || {})[ci] = { fill: ac };
      s += ch; ci++;
    }
    return s;
  });
  t.set({ text: out.join('\n') });
  t.styles = styles;
  t.initDimensions();
  t.dirty = true;
  t.setCoords();
}
function getMarkup(t) {
  return t.text.split('\n').map((line, li) => {
    let s = '', on = false;
    [...line].forEach((ch, ci) => {
      const st = t.styles && t.styles[li] && t.styles[li][ci];
      const hl = !!(st && st.fill && sameColor(st.fill, accent()));
      if (hl !== on) { s += '*'; on = hl; }
      s += ch;
    });
    if (on) s += '*';
    return s;
  }).join('\n');
}
function makeText(markup, o = {}) {
  const t = new fabric.IText('', {
    ...base(o.kind || 'text', o.name || '텍스트'),
    left: o.left ?? W / 2, top: o.top ?? H / 2,
    fontFamily: o.font || 'Pretendard', fontWeight: o.weight ?? '800', fontSize: o.size || 64,
    fill: o.fill || '#ffffff', textAlign: o.align || 'center', lineHeight: o.lineHeight || 1.12, charSpacing: o.charSpacing ?? -20,
    shadow: o.shadow === false ? null : new fabric.Shadow(o.shadow || { color: 'rgba(0,0,0,0.5)', blur: 18, offsetX: 0, offsetY: 4 }),
    paintFirst: 'stroke', strokeWidth: 0, stroke: '#000000',
    textureSrc: o.textureSrc || null, textureOpacity: o.textureOpacity ?? 0.2,
  });
  setMarkup(t, markup);
  return t;
}
function fitText(t, maxW) {
  t.initDimensions();
  while (t.width > maxW && t.fontSize > 18) { t.set('fontSize', t.fontSize - 2); t.initDimensions(); }
  t.setCoords();
}

/* ----- 구분선 / 로고 / 브랜드명 / 페이지 점 / 도형 ----- */
function makeDivider(y, o = {}) {
  const gap = o.gap ?? 150, margin = o.margin ?? 78, color = o.color || accent(), sw = o.width ?? 3;
  const l1 = new fabric.Line([margin, y, W / 2 - gap / 2, y], { stroke: color, strokeWidth: sw });
  const l2 = new fabric.Line([W / 2 + gap / 2, y, W - margin, y], { stroke: color, strokeWidth: sw });
  const g = new fabric.Group([l1, l2], { ...base('divider', '구분선') });
  g.set({ left: W / 2, top: y }); g.setCoords();
  return g;
}
async function makeLogo(o = {}) {
  const img = await loadFabricImage(getLogo());
  img.set({ ...base('logo', '로고'), left: o.left ?? W / 2, top: o.top ?? H / 2 });
  img.scaleToWidth(o.size || 110);
  return img;
}
function makeBrand(o = {}) {
  const t = makeText(state.settings.brandName || '브랜드', {
    kind: 'brand', name: '브랜드명', font: 'GmarketSansBold', weight: 'normal', size: o.size || 28,
    fill: o.fill || '#7a4318', shadow: false, charSpacing: -10, left: o.left, top: o.top,
  });
  return t;
}
function makeDots(total, active, o = {}) {
  const r = o.r || 4.5, gap = o.gap || 19;
  const act = o.active || '#ffffff', col = o.color || 'rgba(255,255,255,0.45)';
  const cs = [];
  for (let i = 0; i < Math.max(1, total); i++) {
    cs.push(new fabric.Circle({ radius: r, left: i * gap, top: 0, originX: 'center', originY: 'center', fill: i === active ? act : col }));
  }
  const g = new fabric.Group(cs, { ...base('dots', '페이지 점'), dotActive: act, dotColor: col });
  g.set({ left: o.left ?? W / 2, top: o.top ?? H - 34 }); g.setCoords();
  return g;
}
function refreshDots(cv, index, total) {
  cv.getObjects().slice().forEach(o => {
    if (o.kind !== 'dots') return;
    const idx = cv.getObjects().indexOf(o);
    const c = o.getCenterPoint();
    const g = makeDots(total, index, { active: o.dotActive, color: o.dotColor, left: c.x, top: c.y });
    g.set({ uid: o.uid, layerName: o.layerName, visible: o.visible, lockedLayer: o.lockedLayer, scaleX: o.scaleX, scaleY: o.scaleY, angle: o.angle, opacity: o.opacity });
    g.setCoords();
    cv.remove(o);
    cv.insertAt(g, idx, false);
    applyLock(g);
  });
}
function makeShape(type) {
  const common = { left: W / 2, top: H / 2, fill: accent(), stroke: '#ffffff', strokeWidth: 0, strokeUniform: true };
  return type === 'circle'
    ? new fabric.Circle({ ...base('shape', '원'), ...common, radius: 120 })
    : new fabric.Rect({ ...base('shape', '사각형'), ...common, width: 520, height: 140, rx: 0, ry: 0 });
}

function applyLock(o) {
  const l = !!o.lockedLayer;
  o.selectable = !l; o.evented = !l;
  if (o.type === 'circle') o.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false });
}

/* ----- 슬라이드 템플릿 ----- */
const TEMPLATES = {
  async cover(d) {
    const out = [await makeImage(d.image, { name: '배경 사진' })];
    out.push(makeGradient({ name: '하단 그라데이션', start: 0.4, solid: 0.92, strength: 1, locked: true }));
    if (d.inset) {
      const f = makeEmptyFrame('circle', { name: '인물 사진', left: 842, top: 282, radius: 208 });
      out.push(f, await makeFramePic(f, d.inset));
    }
    // PSD 수치: 104px, 행간 약 96px, 글씨 아래끝 y≈1255, 구분선 y≈908
    const t = makeText(d.text || '제목을\n입력하세요\n*강조 키워드*', {
      ...PSD_TITLE_STYLE, name: '제목', size: 104, lineHeight: 0.815,
    });
    fitText(t, 980);
    const bottom = 1258;
    t.set({ top: bottom - t.height / 2 }); t.setCoords();
    const divY = bottom - t.height - 60;
    out.push(makeDivider(divY));
    out.push(await makeLogo({ top: divY, size: 112 }));
    out.push(t);
    out.push(makeDots(d.total || 8, 0));
    return out;
  },
  async body(d) {
    const out = [await makeImage(d.image, { name: '배경 사진' })];
    out.push(makeGradient({ name: '하단 그라데이션', start: 0.45, solid: 0.88, strength: 1, locked: true }));
    out.push(makeBodyText(d.text));
    return out;
  },
  // 인용형: 큰 따옴표 + 인용문 + '-말한 사람' (김동댕 PSD 2.psd)
  async quote(d) {
    const out = [await makeImage(d.image, { name: '배경 사진' })];
    out.push(makeGradient({ name: '하단 그라데이션', start: 0.45, solid: 0.88, strength: 1, locked: true }));
    const q = await loadFabricImage('assets/quote.png');
    q.set({ ...base('deco', '따옴표'), left: W / 2, top: 896,
      shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.41)', blur: 24, offsetX: 0, offsetY: 0 }) });
    out.push(q);
    const t = makeBodyText(d.text || '인용문을\n*여기에* 입력하세요', '인용문');
    out.push(t);
    const sp = makeText('-' + String(d.speaker || '말한 사람').replace(/^\s*[-–—]\s*/, ''), { ...PSD_SPEAKER_STYLE, name: '말한 사람' });
    sp.set({ top: t.top + t.height / 2 + 24 + sp.height / 2 }); sp.setCoords();
    out.push(sp);
    return out;
  },
  async photo(d) {
    const out = [await makeImage(d.image, { name: '배경 사진' })];
    out.push(await makeLogo({ left: 62, top: 60, size: 82 }));
    out.push(makeBrand({ left: 62, top: 118, size: 25 }));
    if (d.text) {
      out.push(makeGradient({ name: '하단 그라데이션', start: 0.5, solid: 0.92, strength: 1, locked: true }));
      out.push(makeBodyText(d.text));
    }
    return out;
  },
  async white(d) {
    const bg = new fabric.Rect({ ...base('shape', '배경'), left: W / 2, top: H / 2, width: W, height: H, fill: '#f2f2f2', strokeWidth: 0 });
    const out = [bg];
    if (d.image) {
      const img = await makeImage(d.image, { fit: 'contain', name: '이미지' });
      const s = Math.min(900 / img.width, 820 / img.height);
      img.set({ scaleX: s, scaleY: s, top: 620 });
      out.push(img);
    }
    out.push(await makeLogo({ left: 62, top: 60, size: 82 }));
    out.push(makeBrand({ left: 62, top: 118, size: 25 }));
    const t = makeText(d.text || '설명을 *입력*하세요', { name: '본문', size: 56, fill: '#111111', shadow: false, lineHeight: 1.1 });
    fitText(t, 980); t.set({ top: 1180 - t.height / 2 }); t.setCoords();
    out.push(t);
    return out;
  },
  async blank() { return []; },
};

async function buildSlideJSON(type, data = {}) {
  // 템플릿은 4:5 기준 수치로 만들고, 카드가 다른 크기면 변환
  const cardH = H;
  H = BASE_H;
  let json;
  try {
    const objs = await (TEMPLATES[type] || TEMPLATES.blank)(data);
    json = {
      version: fabric.version,
      objects: objs.map(o => o.toObject(PROPS)),
      background: type === 'white' ? '#f2f2f2' : '#111111',
    };
  } finally { H = cardH; }
  return cardH === BASE_H ? json : convertSlideJSON(json, BASE_H, cardH);
}

/* ----- 카드 크기 바꾸기 (4:5 ↔ 1:1) -----
   아래쪽 요소(제목·본문·구분선·로고·페이지 점·말한 사람)는 '아래에서의 거리'를 유지하고,
   위쪽 요소(원형 사진·좌상단 로고)는 그대로. 배경 사진은 꽉 찬 상태로 살짝만 올림(얼굴이 덜 잘리게).
   그라데이션은 글씨를 따라 진해지는 위치를 옮김. */
function convertSlideJSON(json, oldH, newH) {
  const dh = newH - oldH;
  const objs = json.objects || [];
  const dispH = o => (o.height || 0) * Math.abs(o.scaleY || 1);
  const dispW = o => (o.width || 0) * Math.abs(o.scaleX || 1);
  const frameShift = new Map();
  const isBg = o => o.type === 'image' && (o.kind === 'image' || o.kind === 'cutout') && !o.frameId
    && dispH(o) >= oldH * 0.95 && dispW(o) >= W * 0.95;
  objs.forEach(o => {
    if (o.frameId) return;
    // 카드 전체를 덮는 사각형 (그라데이션·밝은 배경)
    if (o.type === 'rect' && (o.kind === 'gradient' || o.kind === 'shape') && dispH(o) >= oldH - 2) {
      o.height = newH / Math.abs(o.scaleY || 1);
      o.top = newH / 2;
      if (o.kind === 'gradient' && (o.gradDir || 'bottom') === 'bottom') {
        const remap = f => clamp((f * oldH + dh) / newH, 0, 1);
        if (o.gradStart != null) o.gradStart = Math.min(remap(o.gradStart), 0.95);
        if (o.gradSolid != null) o.gradSolid = Math.max(remap(o.gradSolid), (o.gradStart || 0) + 0.02);
      }
      return;
    }
    // 배경 사진: 위쪽 기준으로 살짝만 이동 + 새 카드를 꽉 채우게
    if (isBg(o)) {
      o.top += dh * 0.3;
      let hh = dispH(o);
      if (hh < newH) {
        const f = newH / hh;
        o.scaleX *= f; o.scaleY *= f; hh = newH;
      }
      const topEdge = o.top - hh / 2;
      if (topEdge > 0) o.top -= topEdge;
      if (o.top + hh / 2 < newH) o.top = newH - hh / 2;
      return;
    }
    const dy = o.top > oldH * 0.5 ? dh : 0;
    o.top += dy;
    if (o.kind === 'frame') frameShift.set(o.uid, dy);
  });
  // 원형 사진 안의 사진은 원과 똑같이
  objs.forEach(o => {
    if (!o.frameId) return;
    o.top += frameShift.has(o.frameId) ? frameShift.get(o.frameId) : (o.top > oldH * 0.5 ? dh : 0);
    delete o.clipPath;
  });
  return json;
}
