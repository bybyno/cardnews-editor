'use strict';
/* ===== 캔버스, 히스토리, 슬라이드 관리, 상호작용 ===== */

let canvas;
const cur = () => state.project.slides[state.current];
const slides = () => state.project.slides;

function initCanvas() {
  fabric.textureSize = 4096;
  // fabric 5.3의 잘못된 textBaseline('alphabetical') 경고 방지
  const origSetTextStyles = fabric.Text.prototype._setTextStyles;
  fabric.Text.prototype._setTextStyles = function (ctx, ...rest) {
    origSetTextStyles.call(this, ctx, ...rest);
    ctx.textBaseline = 'alphabetic';
  };
  // 큰 사진을 줄여 그릴 때 기본값(low)은 계단·뭉개짐이 심함 → 고품질 보간으로 (편집 화면·내보내기 모두)
  const hq = (proto, name) => {
    if (!Object.prototype.hasOwnProperty.call(proto, name)) return;
    const orig = proto[name];
    proto[name] = function (ctx, ...rest) {
      if (ctx) { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; }
      return orig.call(this, ctx, ...rest);
    };
  };
  [fabric.Object.prototype, fabric.Image.prototype].forEach(p => ['drawObject', 'drawCacheOnCanvas', '_render'].forEach(n => hq(p, n)));
  // 글씨 텍스쳐: 글씨를 그린 뒤 글씨 모양 안에만 텍스쳐를 덮음
  fabric.Text.prototype.cacheProperties = fabric.Text.prototype.cacheProperties.concat(['textureSrc', 'textureOpacity']);
  const origTextRender = fabric.Text.prototype._render;
  fabric.Text.prototype._render = function (ctx) {
    origTextRender.call(this, ctx);
    if (this.textureSrc && this.textureOpacity > 0) drawTextTexture(this, ctx, origTextRender);
  };
  Object.assign(fabric.Object.prototype, {
    transparentCorners: false, cornerColor: '#ffffff', cornerStrokeColor: '#2d8cff', borderColor: '#2d8cff',
    cornerSize: 11, cornerStyle: 'circle', borderScaleFactor: 1.6,
  });
  fabric.IText.prototype.cursorColor = '#2d8cff';
  fabric.IText.prototype.editingBorderColor = '#ff3d7f';
  fabric.IText.prototype.selectionColor = 'rgba(45,140,255,0.35)';

  canvas = new fabric.Canvas('c', {
    width: W, height: H, backgroundColor: '#111111', preserveObjectStacking: true,
    stopContextMenu: true, targetFindTolerance: 4, uniformScaling: true,
    altActionKey: null,   // Shift+옆면 핸들이 기울이기(skew)가 되지 않게 → Shift는 자유 변형으로만 사용
  });

  // '선택 레이어만 이동' 스위치: 켜져 있으면 선택된 레이어가 항상 드래그 대상 (위에 다른 이미지가 있어도)
  // Ctrl+클릭은 예전처럼 클릭한 곳의 맨 위 레이어를 선택. 잠긴 레이어·글자 편집 중에는 적용 안 함
  canvas.findTargetRaw = canvas.findTarget.bind(canvas);
  canvas.findTarget = function (e, skipGroup) {
    const a = this._activeObject;
    if (state.settings.lockToSelected && a && !a.lockedLayer && !a.isEditing && a.visible !== false
        && e && !(e.ctrlKey || e.metaKey || e.shiftKey) && !frameEdit) return a;   // Shift+클릭은 여러 개 선택
    return this.findTargetRaw(e, skipGroup);
  };

  canvas.on('object:added', () => commit());
  canvas.on('object:removed', () => commit());
  canvas.on('object:modified', e => {
    const t = e.target;
    if (t && t.type !== 'activeSelection') normalizeObject(t);
    commit(); renderProps();
  });
  canvas.on('text:changed', e => { commit(); syncTextarea(e.target); });
  canvas.on('text:editing:exited', () => commit());
  canvas.on('text:selection:changed', e => {
    const t = e.target;
    if (t.selectionStart !== t.selectionEnd) state.textSel = { obj: t, start: t.selectionStart, end: t.selectionEnd };
  });
  const onSel = () => {
    if (frameEdit && canvas.getActiveObject() !== frameEdit) exitFrameEdit();
    if (cropTarget && canvas.getActiveObject() !== cropTarget) exitCrop();
    renderProps(); renderLayers();
  };
  // 프레임(원형 사진) 안의 사진: 프레임 따라 이동 + 프레임 모양으로 잘라 보이기
  canvas.on('before:render', () => syncFrames(canvas));
  canvas.on('selection:created', onSel);
  canvas.on('selection:updated', onSel);
  canvas.on('selection:cleared', onSel);

  canvas.on('mouse:dblclick', e => {
    const t = e.target;
    if (!t) return;
    if (t.kind === 'frame') {
      if (isLegacyFrame(t)) { enterFrameEdit(t); return; }
      // 새 방식 프레임: 더블클릭하면 안에 든 맨 위 사진 선택 (없으면 사진 추가)
      const kids = frameKids(canvas, t).filter(k => k.visible !== false);
      if (kids.length) { canvas.setActiveObject(kids[kids.length - 1]); canvas.requestRenderAll(); }
      else openAddToFrame(t);
    } else if (t.type === 'image' && t.kind !== 'logo' && t !== cropTarget) replaceImage(t);
  });

  // 옆면 핸들(좌·우·위·아래)로 잡아도 비율 유지 — Shift를 누르고 끌면 자유 변형 (모서리 핸들도 동일)
  canvas.on('object:scaling', e => {
    const t = e.transform, o = e.target;
    if (!t || !t.original || (e.e && e.e.shiftKey)) return;
    const r = t.original.scaleY / t.original.scaleX;
    if (t.corner === 'ml' || t.corner === 'mr') o.set('scaleY', o.scaleX * r);
    else if (t.corner === 'mt' || t.corner === 'mb') o.set('scaleX', o.scaleY / r);
  });

  // 스냅 (캔버스 중앙선) — Alt 누르면 해제
  canvas.on('object:moving', e => {
    const o = e.target;
    guides.v = guides.h = false;
    if (e.e && e.e.altKey) return;
    const c = o.getCenterPoint(), th = 8 / state.zoom;
    guides.v = Math.abs(c.x - W / 2) < th;
    guides.h = Math.abs(c.y - H / 2) < th;
    if (guides.v || guides.h) o.setPositionByOrigin(new fabric.Point(guides.v ? W / 2 : c.x, guides.h ? H / 2 : c.y), 'center', 'center');
  });
  // 카드 바깥(작업 여백)은 어둡게 덮어서 희미하게 보이게 + 카드 테두리 + 스냅 가이드
  canvas.on('after:render', opt => {
    const ctx = opt && opt.ctx;
    if (!ctx || ctx !== canvas.contextContainer) return;   // 썸네일/내보내기 렌더에는 그리지 않음
    const v = canvas.viewportTransform;
    const z = state.zoom, big = 20000;
    ctx.save();
    ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
    // '바깥 보기'가 꺼져 있으면 카드 밖을 완전히 가림
    ctx.fillStyle = state.settings.showOutside === false ? '#111214' : 'rgba(17,18,20,0.72)';
    ctx.beginPath();
    ctx.rect(-big, -big, W + big * 2, H + big * 2);
    ctx.rect(0, 0, W, H);
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1 / z;
    ctx.strokeRect(0, 0, W, H);
    // 그라데이션 선택 중: '시작'과 '꽉 검정' 위치를 노란 선으로
    const ga = canvas.getActiveObject();
    if (ga && ga.kind === 'gradient' && ga.gradSolid != null && !ga.angle) {
      const b = ga.getBoundingRect(true, true), dir = ga.gradDir || 'bottom';
      const vertical = dir === 'bottom' || dir === 'top';
      const at = f => {
        const t = dir === 'top' || dir === 'left' ? 1 - f : f;
        return vertical ? b.top + b.height * t : b.left + b.width * t;
      };
      ctx.save();
      ctx.strokeStyle = '#ffc700'; ctx.fillStyle = '#ffc700'; ctx.lineWidth = 2 / z; ctx.setLineDash([10 / z, 6 / z]);
      ctx.font = `700 ${13 / z}px Pretendard, sans-serif`;
      [[ga.gradStart, '시작'], [ga.gradSolid, '꽉 검정']].forEach(([f, label]) => {
        const p = at(f);
        ctx.beginPath();
        if (vertical) { ctx.moveTo(b.left, p); ctx.lineTo(b.left + b.width, p); ctx.stroke(); ctx.fillText(label, b.left + 8 / z, p - 6 / z); }
        else { ctx.moveTo(p, b.top); ctx.lineTo(p, b.top + b.height); ctx.stroke(); ctx.fillText(label, p + 6 / z, b.top + 18 / z); }
      });
      ctx.restore();
    }
    // 자르기 중: 잘려나갈 부분(원본 전체 중 남는 영역 바깥)을 희미하게 보여줌
    if (cropTarget && canvas.getObjects().includes(cropTarget)) {
      const o = cropTarget, el = o._element;
      const IW = el.naturalWidth || el.width, IH = el.naturalHeight || el.height;
      const c = o.getCenterPoint();
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(fabric.util.degreesToRadians(o.angle || 0));
      ctx.scale(o.scaleX * (o.flipX ? -1 : 1), o.scaleY * (o.flipY ? -1 : 1));
      const fx = -o.width / 2 - o.cropX, fy = -o.height / 2 - o.cropY;
      ctx.beginPath();
      ctx.rect(fx, fy, IW, IH);
      ctx.rect(-o.width / 2, -o.height / 2, o.width, o.height);
      ctx.clip('evenodd');
      ctx.globalAlpha = 0.3;
      ctx.drawImage(el, fx, fy, IW, IH);
      ctx.restore();
    }
    if (guides.v || guides.h) {
      ctx.strokeStyle = '#ff3d7f'; ctx.lineWidth = 1.5 / z; ctx.setLineDash([8 / z, 6 / z]);
      ctx.beginPath();
      if (guides.v) { ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); }
      if (guides.h) { ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); }
      ctx.stroke();
    }
    ctx.restore();
  });

  // 프레임 내부 사진 이동/확대
  canvas.on('mouse:down', e => {
    if (!frameEdit) return;
    if (e.target !== frameEdit) { exitFrameEdit(); return; }
    feLast = canvas.getPointer(e.e);
  });
  canvas.on('mouse:move', e => {
    if (!frameEdit || !feLast) return;
    const p = canvas.getPointer(e.e);
    const d = fabric.util.rotateVector(new fabric.Point(p.x - feLast.x, p.y - feLast.y), fabric.util.degreesToRadians(-frameEdit.angle));
    frameEdit.frameOffX = (frameEdit.frameOffX || 0) + d.x / frameEdit.scaleX;
    frameEdit.frameOffY = (frameEdit.frameOffY || 0) + d.y / frameEdit.scaleY;
    feLast = p;
    updateFrame(frameEdit);
    canvas.requestRenderAll();
  });
  canvas.on('mouse:up', () => {
    if (guides.v || guides.h) { guides.v = guides.h = false; canvas.requestRenderAll(); }
    if (feLast) { feLast = null; commit(); renderProps(); }
  });
  canvas.on('mouse:wheel', e => {
    if (frameEdit && e.target === frameEdit) {
      frameEdit.frameZoom = clamp((frameEdit.frameZoom || 1) * (e.e.deltaY < 0 ? 1.06 : 1 / 1.06), 1, 8);
      updateFrame(frameEdit); canvas.requestRenderAll(); commit();
      e.e.preventDefault(); e.e.stopPropagation();
    }
  });
}

const guides = { v: false, h: false };

/* ----- 사진 자르기: 핸들을 끌면 끈 만큼 잘림 (원본은 보존돼서 다시 늘릴 수 있음) ----- */
let cropTarget = null;
const CROP_MIN = 20;
function cropAction(eventData, t, px, py) {
  const o = t.target, key = t.corner;
  const el = o._element, IW = el.naturalWidth || el.width, IH = el.naturalHeight || el.height;
  const c = o.getCenterPoint(), rad = fabric.util.degreesToRadians(o.angle || 0);
  const v = fabric.util.rotateVector({ x: px - c.x, y: py - c.y }, -rad);
  const lx = v.x / o.scaleX, ly = v.y / o.scaleY;
  // 처음 잡을 때 어느 쪽 변을 끄는지 정해둠 (화면에 보이는 방향 기준)
  if (!t.cropEdges) {
    t.cropEdges = {
      x: ['tl', 'tr', 'bl', 'br', 'ml', 'mr'].includes(key) ? (lx < 0 ? 'L' : 'R') : null,
      y: ['tl', 'tr', 'bl', 'br', 'mt', 'mb'].includes(key) ? (ly < 0 ? 'T' : 'B') : null,
    };
  }
  let cx = o.cropX || 0, cy = o.cropY || 0, w = o.width, hh = o.height, sx = 0, sy = 0;
  const ex = t.cropEdges.x, ey = t.cropEdges.y;
  if (ex === 'L') {
    const avail = o.flipX ? IW - cx - w : cx;
    const d = clamp(lx, -w / 2 - avail, w / 2 - CROP_MIN) + w / 2;
    w -= d; if (!o.flipX) cx += d; sx += d / 2;
  } else if (ex === 'R') {
    const avail = o.flipX ? cx : IW - cx - w;
    const d = clamp(lx, -w / 2 + CROP_MIN, w / 2 + avail) - w / 2;
    w += d; if (o.flipX) cx -= d; sx += d / 2;
  }
  if (ey === 'T') {
    const avail = o.flipY ? IH - cy - hh : cy;
    const d = clamp(ly, -hh / 2 - avail, hh / 2 - CROP_MIN) + hh / 2;
    hh -= d; if (!o.flipY) cy += d; sy += d / 2;
  } else if (ey === 'B') {
    const avail = o.flipY ? cy : IH - cy - hh;
    const d = clamp(ly, -hh / 2 + CROP_MIN, hh / 2 + avail) - hh / 2;
    hh += d; if (o.flipY) cy -= d; sy += d / 2;
  }
  const off = fabric.util.rotateVector({ x: sx * o.scaleX, y: sy * o.scaleY }, rad);
  o.set({ cropX: cx, cropY: cy, width: w, height: hh, left: o.left + off.x, top: o.top + off.y });
  o.setCoords();
  o.dirty = true;
  return true;
}
function renderCropHandle(ctx, left, top) {
  ctx.save();
  ctx.fillStyle = '#ffc700'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
  ctx.fillRect(left - 7, top - 7, 14, 14); ctx.strokeRect(left - 7, top - 7, 14, 14);
  ctx.restore();
}
function makeCropControls() {
  const mk = (x, y, cursor) => new fabric.Control({ x, y, cursorStyle: cursor, actionName: 'crop', actionHandler: cropAction, render: renderCropHandle });
  return {
    tl: mk(-0.5, -0.5, 'nwse-resize'), tr: mk(0.5, -0.5, 'nesw-resize'), bl: mk(-0.5, 0.5, 'nesw-resize'), br: mk(0.5, 0.5, 'nwse-resize'),
    ml: mk(-0.5, 0, 'ew-resize'), mr: mk(0.5, 0, 'ew-resize'), mt: mk(0, -0.5, 'ns-resize'), mb: mk(0, 0.5, 'ns-resize'),
  };
}
function enterCrop(o) {
  exitCrop(); exitFrameEdit();
  cropTarget = o;
  o.controls = makeCropControls();
  o.set({ lockMovementX: true, lockMovementY: true, lockRotation: true, borderColor: '#ffc700' });
  canvas.setActiveObject(o);
  canvas.requestRenderAll();
  renderProps();
  toast('자르기: 노란 핸들을 끌면 그만큼 잘려요 (밖으로 끌면 다시 늘어나요). 끝내려면 Enter / Esc / 바깥 클릭', 4500);
}
function exitCrop() {
  if (!cropTarget) return;
  const o = cropTarget;
  cropTarget = null;
  delete o.controls;   // 원래 핸들로
  o.set({ lockMovementX: false, lockMovementY: false, lockRotation: false, borderColor: '#2d8cff' });
  o.setCoords();
  canvas.requestRenderAll();
  commit(); renderProps();
}
// 자르기 취소: 원본 전체로 되돌리기 (보이던 부분은 제자리 유지)
function resetCrop(o) {
  const el = o._element, IW = el.naturalWidth || el.width, IH = el.naturalHeight || el.height;
  const shiftX = (IW / 2 - ((o.cropX || 0) + o.width / 2)) * (o.flipX ? -1 : 1);
  const shiftY = (IH / 2 - ((o.cropY || 0) + o.height / 2)) * (o.flipY ? -1 : 1);
  const off = fabric.util.rotateVector({ x: shiftX * o.scaleX, y: shiftY * o.scaleY }, fabric.util.degreesToRadians(o.angle || 0));
  o.set({ cropX: 0, cropY: 0, width: IW, height: IH, left: o.left + off.x, top: o.top + off.y });
  o.setCoords(); o.dirty = true;
  canvas.requestRenderAll(); commit(); renderProps();
}

/* ----- 프레임에 사진 추가 (검색 · 내 파일) ----- */
function openAddToFrame(f) {
  const st = state.settings, circle = f.type === 'circle';
  openSearch(st.tmdbKey && circle ? 'tmdb' : st.serpApiKey ? 'google' : 'pinterest', false, {
    label: `${circle ? '원형 사진' : '사진 프레임'}에 넣을 사진 — 검색하거나 '📁 내 파일'`,
    lensSrc: null,
    pick: async url => {
      if (!canvas.getObjects().includes(f)) { toast('프레임이 지워져서 넣지 못했어요'); return; }
      const k = await addImageToFrame(canvas, f, url);
      canvas.setActiveObject(k); canvas.requestRenderAll(); commit(); renderLayers(); renderProps();
      toast('넣었어요. 레이어 목록에서 이 원 아래에 들어갔어요 (크기·위치·누끼·자르기 가능)', 4000);
    },
  });
}
let frameEdit = null, feLast = null;

function enterFrameEdit(o) {
  if (frameEdit === o) return;
  exitFrameEdit();
  frameEdit = o;
  o.set({ lockMovementX: true, lockMovementY: true, hasControls: false, borderColor: '#ff3d7f', hoverCursor: 'grab', moveCursor: 'grabbing' });
  canvas.setActiveObject(o);
  canvas.requestRenderAll();
  toast('프레임 안 사진 조정: 드래그 = 이동, 휠 = 확대/축소, Esc 또는 바깥 클릭 = 끝내기', 4000);
  renderProps();
}
function exitFrameEdit() {
  if (!frameEdit) return;
  frameEdit.set({ lockMovementX: false, lockMovementY: false, hasControls: true, borderColor: '#2d8cff', hoverCursor: null, moveCursor: null });
  frameEdit = null; feLast = null;
  canvas.requestRenderAll();
  commit();
}

/* 스케일을 실제 크기로 바꿔서 테두리/패턴/그라데이션이 늘어나지 않게 */
function normalizeObject(o) {
  if (o.type === 'circle' && (o.scaleX !== 1 || o.scaleY !== 1)) {
    o.set({ radius: o.radius * Math.max(o.scaleX, o.scaleY), scaleX: 1, scaleY: 1 });
  } else if (o.type === 'rect' && (o.scaleX !== 1 || o.scaleY !== 1)) {
    o.set({ width: o.width * o.scaleX, height: o.height * o.scaleY, scaleX: 1, scaleY: 1 });
  }
  if (o.kind === 'frame') updateFrame(o);
  if (o.kind === 'gradient') applyGradient(o);
  o.setCoords();
}

/* ----- 줌 ----- */
// 캔버스는 작업 영역 전체를 덮고, 카드(1080×1350)는 가운데에 놓임 → 카드 밖으로 나간 부분도 보이고 잡을 수 있음
function layoutCanvas() {
  const st = $('#stage'), z = state.zoom, pad = 80;
  const cw = Math.floor(Math.max(st.clientWidth, W * z + pad * 2));
  const ch = Math.floor(Math.max(st.clientHeight, H * z + pad * 2));
  state.offX = Math.round((cw - W * z) / 2);
  state.offY = Math.round((ch - H * z) / 2);
  canvas.setDimensions({ width: cw, height: ch });
  canvas.setViewportTransform([z, 0, 0, z, state.offX, state.offY]);
  canvas.calcOffset();
  canvas.requestRenderAll();
}
function setZoom(z, fit = false) {
  state.zoom = clamp(z, 0.08, 3);
  state.fitMode = fit;
  layoutCanvas();
  $('#zoomLabel').textContent = Math.round(state.zoom * 100) + '%';
}
function zoomFit() {
  const st = $('#stage');
  // 카드 둘레에 여백을 남겨서 카드 밖으로 나간 사진과 조절 핸들이 보이게
  setZoom(Math.min((st.clientWidth - 160) / W, (st.clientHeight - 160) / H), true);
}

/* ----- 슬라이드 로드/저장 ----- */
async function loadSlideToCanvas(i) {
  state.loading = true;
  try {
    const s = slides()[i];
    await ensureFontsFor(s.json);
    cropTarget = null;
    await new Promise(r => canvas.loadFromJSON(s.json, r));
    canvas.getObjects().forEach(applyLock);
    syncFrames(canvas);
    refreshDots(canvas, i, slides().length);
    canvas.requestRenderAll();
  } finally {
    state.loading = false;
  }
}
function saveCurrent() {
  if (!state.project) return;
  cur().json = canvas.toJSON(PROPS);
}
function leaveCurrent() {
  exitFrameEdit();
  exitCrop();
  if (canvas.getActiveObject() && canvas.getActiveObject().isEditing) canvas.getActiveObject().exitEditing();
  canvas.discardActiveObject();
  flushCommit();
  saveCurrent();
  updateThumb(state.current);
}
async function switchSlide(i) {
  if (i === state.current || i < 0 || i >= slides().length) return;
  leaveCurrent();
  state.current = i;
  await loadSlideToCanvas(i);
  if (!cur().hist) pushHistory();
  renderAll();
}
function renderAll() {
  renderSlideList(); renderLayers(); renderProps(); updateUndoButtons();
}

/* ----- 히스토리 / 커밋 ----- */
let commitTimer, commitPending = false;
function commit(immediate) {
  if (state.loading || !state.project) return;
  clearTimeout(commitTimer);
  commitPending = true;
  commitTimer = setTimeout(doCommit, immediate ? 0 : 200);
}
function doCommit() {
  commitPending = false;
  saveCurrent();
  pushHistory();
  updateThumb(state.current);
  renderLayers();
  scheduleAutosave();
}
function pushHistory() {
  const s = cur();
  const snap = JSON.stringify(s.json || canvas.toJSON(PROPS));
  if (s.hist && s.hist[s.hi] === snap) return;
  s.hist = (s.hist || []).slice(0, (s.hi ?? -1) + 1);
  s.hist.push(snap);
  if (s.hist.length > 60) s.hist.shift();
  s.hi = s.hist.length - 1;
  updateUndoButtons();
}
// 방금 바꾼 값이 아직 기록 대기 중이면 먼저 기록해서, 실행 취소가 그 변경을 정확히 되돌리게
function flushCommit() {
  if (!commitPending) return;
  clearTimeout(commitTimer);
  doCommit();
}
async function undo() {
  flushCommit();
  const s = cur();
  if (!s.hist || s.hi <= 0) return;
  s.hi--; await restoreHist(s);
}
async function redo() {
  flushCommit();
  const s = cur();
  if (!s.hist || s.hi >= s.hist.length - 1) return;
  s.hi++; await restoreHist(s);
}
async function restoreHist(s) {
  exitFrameEdit();
  clearTimeout(commitTimer);
  commitPending = false;
  s.json = JSON.parse(s.hist[s.hi]);
  await loadSlideToCanvas(state.current);
  updateThumb(state.current);
  renderLayers(); renderProps(); updateUndoButtons();
  scheduleAutosave();
}
function updateUndoButtons() {
  const s = state.project && cur();
  $('#btnUndo').disabled = !s || !s.hist || s.hi <= 0;
  $('#btnRedo').disabled = !s || !s.hist || s.hi >= s.hist.length - 1;
}

/* ----- 썸네일 ----- */
function updateThumb(i) {
  const s = slides()[i];
  if (!s || i !== state.current) return;
  try {
    s.thumb = canvas.toDataURL({
      format: 'jpeg', quality: 0.7, multiplier: 180 / (W * state.zoom),
      left: state.offX, top: state.offY, width: W * state.zoom, height: H * state.zoom,   // 카드 부분만
    });
    const img = $(`#slideList [data-i="${i}"] img`);
    if (img) img.src = s.thumb;
  } catch (e) { console.warn(e); }
}
async function renderSlideImage(i, { format = 'png', multiplier = 1, quality = 0.95 } = {}) {
  if (i === state.current) saveCurrent();
  const json = slides()[i].json;
  await ensureFontsFor(json);
  const el = document.createElement('canvas');
  const sc = new fabric.StaticCanvas(el, { width: W, height: H, enableRetinaScaling: false });
  await new Promise(r => sc.loadFromJSON(json, r));
  syncFrames(sc);
  refreshDots(sc, i, slides().length);
  sc.renderAll();
  const url = sc.toDataURL({ format, quality, multiplier });
  sc.dispose();
  return url;
}
async function ensureThumbs(force) {
  for (let i = 0; i < slides().length; i++) {
    const s = slides()[i];
    if (s.thumb && !force) continue;
    if (i === state.current) { updateThumb(i); continue; }
    s.thumb = await renderSlideImage(i, { format: 'jpeg', multiplier: 180 / W, quality: 0.7 });
    const img = $(`#slideList [data-i="${i}"] img`);
    if (img) img.src = s.thumb;
  }
}

/* ----- 슬라이드 목록 ----- */
let slideDragFrom = null;
function renderSlideList() {
  const list = $('#slideList');
  list.innerHTML = '';
  slides().forEach((s, i) => {
    const item = h('div', { class: 'slide-item' + (i === state.current ? ' active' : ''), 'data-i': i, draggable: 'true' },
      h('img', { src: s.thumb || '', alt: '' }),
      h('span', { class: 'num' }, i + 1),
      s.lens ? h('span', { class: 'lens-badge', title: '원본 찾기 결과가 준비돼 있어요' }, `🔍 ${s.lens.count}`) : null,
      h('div', { class: 'acts' },
        h('button', { title: '복제', onclick: e => { e.stopPropagation(); duplicateSlide(i); } }, '⧉'),
        h('button', { title: '삭제', onclick: e => { e.stopPropagation(); deleteSlide(i); } }, '✕'),
      ),
    );
    item.addEventListener('click', () => switchSlide(i));
    item.addEventListener('dragstart', e => { slideDragFrom = i; e.dataTransfer.effectAllowed = 'move'; });
    item.addEventListener('dragover', e => { if (slideDragFrom == null) return; e.preventDefault(); item.classList.add('drag-over'); });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', e => {
      e.preventDefault(); item.classList.remove('drag-over');
      if (slideDragFrom != null && slideDragFrom !== i) moveSlide(slideDragFrom, i);
      slideDragFrom = null;
    });
    list.append(item);
  });
}
async function addSlide(type, data = {}) {
  leaveCurrent();
  const json = await buildSlideJSON(type, data);
  const idx = state.current + 1;
  slides().splice(idx, 0, { id: uid(), json });
  state.current = idx;
  await loadSlideToCanvas(idx);
  pushHistory();
  renderAll();
  updateThumb(idx);
  scheduleAutosave();
}
async function duplicateSlide(i) {
  leaveCurrent();
  const src = slides()[i];
  slides().splice(i + 1, 0, { id: uid(), json: JSON.parse(JSON.stringify(src.json)), thumb: src.thumb });
  state.current = i + 1;
  await loadSlideToCanvas(state.current);
  pushHistory();
  renderAll();
  scheduleAutosave();
}
async function deleteSlide(i) {
  if (slides().length <= 1) { toast('마지막 슬라이드는 지울 수 없어요'); return; }
  if (!confirm(`${i + 1}번 슬라이드를 삭제할까요?`)) return;
  leaveCurrent();
  slides().splice(i, 1);
  state.current = Math.min(state.current >= i ? Math.max(0, state.current - 1) : state.current, slides().length - 1);
  await loadSlideToCanvas(state.current);
  if (!cur().hist) pushHistory();
  renderAll();
  scheduleAutosave();
}
async function moveSlide(from, to) {
  leaveCurrent();
  const curId = cur().id;
  const [s] = slides().splice(from, 1);
  slides().splice(to, 0, s);
  state.current = slides().findIndex(x => x.id === curId);
  await loadSlideToCanvas(state.current);
  renderAll();
  scheduleAutosave();
}

/* ----- 오브젝트 조작 ----- */
function addObject(o, select = true) {
  canvas.add(o);
  applyLock(o);
  if (select && o.selectable) canvas.setActiveObject(o);
  canvas.requestRenderAll();
}
function deleteSelection() {
  const objs = canvas.getActiveObjects();
  if (!objs.length) return;
  exitCrop();
  canvas.discardActiveObject();
  // 프레임을 지우면 안에 든 사진도 같이
  const all = new Set(objs);
  objs.forEach(o => { if (o.kind === 'frame') frameKids(canvas, o).forEach(k => all.add(k)); });
  all.forEach(o => canvas.remove(o));
  canvas.requestRenderAll();
}
function cloneObj(o) { return new Promise(res => o.clone(res, PROPS)); }
async function pasteFrom(src, offset = 30) {
  const c = await cloneObj(src);
  canvas.discardActiveObject();
  c.set({ left: c.left + offset, top: c.top + offset, evented: true });
  if (c.type === 'activeSelection') {
    c.canvas = canvas;
    c.forEachObject(ob => { ob.uid = uid(); canvas.add(ob); });
    c.setCoords();
  } else {
    const oldUid = c.uid;
    c.uid = uid();
    canvas.add(c);
    applyLock(c);
    // 프레임을 복제하면 안에 든 사진들도 함께 복제
    if (c.kind === 'frame') {
      const kids = canvas.getObjects().filter(o => o.frameId === oldUid);
      for (const k of kids) {
        const kc = await cloneObj(k);
        kc.set({ uid: uid(), frameId: c.uid, left: kc.left + offset, top: kc.top + offset });
        kc._clipSig = null;
        canvas.add(kc); applyLock(kc);
      }
      restackFrames(canvas);
    }
  }
  canvas.setActiveObject(c);
  canvas.requestRenderAll();
}
async function copySelection() {
  const o = canvas.getActiveObject();
  if (!o) return;
  state.clipboard = await cloneObj(o);
  toast('복사됨');
}
async function pasteClipboard() {
  if (!state.clipboard) return;
  await pasteFrom(state.clipboard, 0);   // 복사한 그 자리에 그대로 붙여넣기 (다른 슬라이드에서도 같은 위치)
}
async function duplicateSelection() {
  const o = canvas.getActiveObject();
  if (o) await pasteFrom(o);
}
function nudge(dx, dy) {
  const o = canvas.getActiveObject();
  if (!o) return;
  o.set({ left: o.left + dx, top: o.top + dy }); o.setCoords();
  canvas.requestRenderAll(); commit(); renderProps();
}
function arrange(dir) {
  const o = canvas.getActiveObject();
  if (!o) return;
  const objs = o.type === 'activeSelection' ? o.getObjects() : [o];
  objs.forEach(ob => {
    if (dir === 'up') canvas.bringForward(ob);
    if (dir === 'down') canvas.sendBackwards(ob);
    if (dir === 'top') canvas.bringToFront(ob);
    if (dir === 'bottom') canvas.sendToBack(ob);
  });
  restackFrames(canvas);   // 프레임을 옮겼으면 안의 사진도 같이
  canvas.requestRenderAll(); commit(); renderLayers();
}
function alignObj(o, how) {
  const b = o.getBoundingRect(true, true);
  let dx = 0, dy = 0;
  if (how === 'left') dx = -b.left;
  if (how === 'right') dx = W - (b.left + b.width);
  if (how === 'hcenter') dx = W / 2 - (b.left + b.width / 2);
  if (how === 'top') dy = -b.top;
  if (how === 'bottom') dy = H - (b.top + b.height);
  if (how === 'vcenter') dy = H / 2 - (b.top + b.height / 2);
  o.set({ left: o.left + dx, top: o.top + dy });
  o.setCoords();
  canvas.requestRenderAll(); commit(); renderProps();
}

async function replaceImage(o) {
  const [f] = await pickFiles();
  if (!f) return;
  busy(true, '사진 불러오는 중…');
  try {
    const url = await fileToDataURL(f);
    await setImageSrc(o, url);
  } catch (e) { toast(e.message); } finally { busy(false); }
}
async function setImageSrc(o, url) {
  const wasCover = o.getScaledWidth() >= W - 2 && o.getScaledHeight() >= H - 2;
  const dispW = o.getScaledWidth();
  if (o.kind === 'image') cur().lens = null;   // 사진이 바뀌면 미리 찾아둔 원본 찾기 표시 제거
  await new Promise(r => o.setSrc(url, r));
  if (wasCover) fitImage(o, 'cover');
  else { const s = dispW / o.width; o.set({ scaleX: s, scaleY: s }); }
  o.setCoords(); canvas.requestRenderAll(); commit(); renderProps();
}
/* 누끼 따기: 배경을 지운 사진을 원본 바로 위에 새 레이어로 (원본은 숨겨서 보관) */
async function cutoutImage(o) {
  if (!PROXY_OK || SERVER_OLD) { toast('누끼는 start.bat으로 (다시) 실행한 편집기에서 돼요', 5000); return; }
  const src = o.getSrc();
  if (!src || src === PLACEHOLDER) { toast('먼저 사진을 넣어주세요'); return; }
  const model = state.settings.cutoutModel || 'birefnet-general';
  busy(true, '누끼 따는 중… (처음 한 번은 AI 모델 준비로 30초~1분 걸려요)');
  try {
    const r = await fetch('/api/cutout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: src, model }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || r.status);
    const cut = await loadFabricImage(d.image);
    // 원본과 같은 위치·크기·회전·반전·효과
    // 누끼 결과는 원본 파일과 같은 크기 → 자르기 상태까지 그대로 옮김
    const el = o._element, IW = el.naturalWidth || el.width;
    const k = cut.width / IW;
    cut.set({
      kind: o.kind === 'image' ? 'cutout' : o.kind, layerName: (o.layerName || '사진') + ' (누끼)', uid: uid(),
      originX: o.originX, originY: o.originY, left: o.left, top: o.top,
      cropX: (o.cropX || 0) * k, cropY: (o.cropY || 0) * k, width: o.width * k, height: o.height * k,
      scaleX: o.scaleX / k, scaleY: o.scaleY / k,
      angle: o.angle, flipX: o.flipX, flipY: o.flipY, opacity: o.opacity,
      shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.45)', blur: 30, offsetX: 0, offsetY: 8 }),
      // 원형 사진 안의 사진이었으면 그대로 안에 두고, 위로 튀어나오게
      frameId: o.frameId || null, clipMode: o.frameId ? 'popout' : undefined,
    });
    const idx = canvas.getObjects().indexOf(o);
    canvas.insertAt(cut, idx + 1, false);
    applyLock(cut);
    o.visible = false;
    if (canvas.getActiveObject() === o) canvas.discardActiveObject();
    canvas.setActiveObject(cut);
    canvas.requestRenderAll(); commit(true);
    renderLayers(); renderProps();
    toast('누끼 완료! 원본 사진은 레이어 목록에 숨겨서 남겨뒀어요 (👁로 다시 켜기)', 4500);
  } catch (e) {
    console.error(e); toast('누끼 실패: ' + e.message, 6000);
  } finally { busy(false); }
}

async function replaceFrameImage(o) {
  const [f] = await pickFiles();
  if (!f) return;
  busy(true, '사진 불러오는 중…');
  try {
    await setFrameImage(o, await fileToDataURL(f));
    canvas.requestRenderAll(); commit(); renderProps();
  } catch (e) { toast(e.message); } finally { busy(false); }
}

/* ----- 도구 ----- */
async function useTool(tool) {
  if (tool === 'search') { openSearch(); return; }
  if (tool === 'merge') { openMerge(); return; }
  exitFrameEdit();
  try {
    if (tool === 'text') {
      const t = makeText('새 텍스트를\n*입력*하세요', { ...PSD_BODY_STYLE });
      addObject(t);
    } else if (tool === 'image') {
      const files = await pickFiles(undefined, true);
      if (!files.length) return;
      busy(true, '사진 불러오는 중…');
      for (const f of files) addObject(await makeImage(await fileToDataURL(f), { fit: 'contain', name: f.name.replace(/\.[^.]+$/, '') }));
    } else if (tool === 'circleFrame' || tool === 'rectFrame') {
      // 빈 프레임을 먼저 놓고, 이미지 찾기 창(검색 · 내 파일)에서 고른 사진을 안에 넣음
      const circle = tool === 'circleFrame';
      const f = makeEmptyFrame(circle ? 'circle' : 'rect', circle ? { left: 842, top: 282, radius: 208 } : {});
      addObject(f);
      openAddToFrame(f);
    } else if (tool === 'rect' || tool === 'circle') {
      addObject(makeShape(tool));
    } else if (tool === 'gradient') {
      addObject(makeGradient({ name: '그라데이션' }));
    } else if (tool === 'divider') {
      addObject(makeDivider(H / 2), false);
      addObject(await makeLogo({ top: H / 2, size: 112 }));
    } else if (tool === 'logo') {
      addObject(await makeLogo({ size: 140 }));
    } else if (tool === 'brand') {
      addObject(makeBrand({ size: 40 }));
    } else if (tool === 'dots') {
      const d = makeDots(slides().length, state.current);
      addObject(d);
    }
  } catch (e) {
    console.error(e); toast('실패: ' + e.message);
  } finally { busy(false); }
}

async function addImageFilesAt(files, e) {
  const imgs = files.filter(isImageFile);
  if (!imgs.length) return;
  busy(true, '사진 불러오는 중…');
  try {
    const target = e ? canvas.findTargetRaw(e, false) : null;   // 파일을 떨군 곳의 실제 사진
    if (target && target.kind === 'frame' && imgs.length === 1) {
      await setFrameImage(target, await fileToDataURL(imgs[0]));
      canvas.requestRenderAll(); commit(); return;
    }
    if (target && target.type === 'image' && target.kind !== 'logo' && imgs.length === 1) {
      await setImageSrc(target, await fileToDataURL(imgs[0])); return;
    }
    for (const f of imgs) {
      const o = await makeImage(await fileToDataURL(f), { fit: 'contain', name: (f.name || '이미지').replace(/\.[^.]+$/, '') });
      if (e) { const p = canvas.getPointer(e); o.set({ left: p.x, top: p.y }); }
      addObject(o);
    }
  } catch (err) { toast(err.message); } finally { busy(false); }
}
