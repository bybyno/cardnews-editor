'use strict';
/* ===== 두 장 합치기: 사진 두 장을 경계가 부드럽게 섞이도록 한 장으로 (가로 / 세로) ===== */

const mg = {
  spec: null,      // { a, b, dir:'h'|'v', split, feather, za, zb, ax, ay, bx, by }
  imgs: { a: null, b: null },
  target: null,    // 다시 편집하는 기존 '합친 사진' 오브젝트
  drag: null,
};
const MERGE_SCALE = 2;   // 결과 이미지를 카드의 2배 해상도로 만들어서 확대해도 선명하게

function defaultMergeSpec() {
  return { a: null, b: null, dir: 'h', split: 0.5, feather: 0.22, za: 1, zb: 1, ax: 0, ay: 0, bx: 0, by: 0 };
}

/* 합성: outW×outH 캔버스에 그려서 반환 */
function drawMerge(spec, imgs, outW, outH) {
  const c = document.createElement('canvas');
  c.width = outW; c.height = outH;
  const x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.fillStyle = '#111'; x.fillRect(0, 0, outW, outH);
  const k = outW / W;   // 위치값은 카드(1080) 기준 → 출력 크기에 맞춰 환산
  const horiz = spec.dir !== 'v';
  const total = horiz ? outW : outH;
  const sp = spec.split * total, f = spec.feather * total;
  // 각 사진이 차지하는 영역 (경계 부분은 서로 겹침)
  const regA = horiz ? [0, 0, Math.min(outW, sp + f / 2), outH] : [0, 0, outW, Math.min(outH, sp + f / 2)];
  const regB = horiz ? [Math.max(0, sp - f / 2), 0, outW - Math.max(0, sp - f / 2), outH] : [0, Math.max(0, sp - f / 2), outW, outH - Math.max(0, sp - f / 2)];
  const cover = (ctx, img, [rx, ry, rw, rh], zoom, ox, oy) => {
    if (!img) { ctx.fillStyle = '#2a2d33'; ctx.fillRect(rx, ry, rw, rh); return; }
    const s = Math.max(rw / img.naturalWidth, rh / img.naturalHeight) * zoom;
    const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    ctx.save();
    ctx.beginPath(); ctx.rect(rx, ry, rw, rh); ctx.clip();
    ctx.drawImage(img, rx + (rw - dw) / 2 + ox * k, ry + (rh - dh) / 2 + oy * k, dw, dh);
    ctx.restore();
  };
  // 사진 2 (뒤)
  cover(x, imgs.b, regB, spec.zb, spec.bx, spec.by);
  // 사진 1 (앞) — 경계 쪽이 점점 투명해지는 마스크
  const la = document.createElement('canvas');
  la.width = outW; la.height = outH;
  const lx = la.getContext('2d');
  lx.imageSmoothingQuality = 'high';
  cover(lx, imgs.a, regA, spec.za, spec.ax, spec.ay);
  if (f >= 1) {
    const g = horiz ? lx.createLinearGradient(sp - f / 2, 0, sp + f / 2, 0) : lx.createLinearGradient(0, sp - f / 2, 0, sp + f / 2);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    lx.globalCompositeOperation = 'destination-in';
    lx.fillStyle = g;
    lx.fillRect(0, 0, outW, outH);
  } else {
    lx.globalCompositeOperation = 'destination-in';
    lx.fillStyle = '#000';
    horiz ? lx.fillRect(0, 0, sp, outH) : lx.fillRect(0, 0, outW, sp);
  }
  x.drawImage(la, 0, 0);
  return c;
}

/* ----- 창 열기 ----- */
async function openMerge() {
  exitFrameEdit();
  const o = canvas.getActiveObject();
  mg.target = o && o.type === 'image' && o.mergeSpec ? o : null;
  if (mg.target) {
    mg.spec = JSON.parse(JSON.stringify(mg.target.mergeSpec));
  } else {
    mg.spec = defaultMergeSpec();
    // 사진을 선택한 상태면 그 사진을 사진 1로
    const src = o && o.type === 'image' && o.kind !== 'logo' ? o.getSrc() : null;
    if (src && src !== PLACEHOLDER) mg.spec.a = src;
  }
  mg.imgs = { a: mg.spec.a ? await loadHtmlImage(mg.spec.a) : null, b: mg.spec.b ? await loadHtmlImage(mg.spec.b) : null };
  // 미리보기도 카드 비율대로 (4:5 / 1:1)
  const pv = $('#mgPreview');
  pv.height = Math.round(pv.width * H / W);
  pv.style.height = Math.round(432 * H / W) + 'px';
  const hasBg = !!slideBgImage();
  $$('input[name=mgApply]').forEach(r => { r.checked = r.value === (mg.target ? 'replace' : hasBg ? 'bg' : 'add'); });
  $('#mgApplyReplace').style.display = mg.target ? '' : 'none';
  $('#mgApplyBg').style.display = hasBg ? '' : 'none';
  syncMergeUI();
  openModal('mergeModal');
}
function syncMergeUI() {
  const s = mg.spec;
  ['a', 'b'].forEach(k => {
    const slot = $(`#mergeModal .merge-slot[data-slot="${k}"]`);
    $('img', slot).src = s[k] || '';
    slot.classList.toggle('empty', !s[k]);
  });
  $$('#mergeModal [data-dir]').forEach(b => b.classList.toggle('on', b.dataset.dir === s.dir));
  $('#mgSlotA').textContent = s.dir === 'v' ? '사진 1 (위)' : '사진 1 (왼쪽)';
  $('#mgSlotB').textContent = s.dir === 'v' ? '사진 2 (아래)' : '사진 2 (오른쪽)';
  [['mgSplit', 'split', 100], ['mgFeather', 'feather', 100], ['mgZa', 'za', 1], ['mgZb', 'zb', 1]].forEach(([id, key, mul]) => {
    $('#' + id).value = round(s[key] * mul, 2);
    $('#' + id + 'N').value = round(s[key] * mul, 2);
  });
  renderMergePreview();
}
/* 사진이 최종 카드(1080×1350)에서 원본보다 몇 배 확대되는지 → 1배 넘으면 흐릿해짐 */
function mergeUpscale(side) {
  const img = mg.imgs[side], s = mg.spec;
  if (!img) return 0;
  const frac = side === 'a' ? Math.min(1, s.split + s.feather / 2) : Math.min(1, 1 - (s.split - s.feather / 2));
  const horiz = s.dir !== 'v';
  const rw = horiz ? W * frac : W, rh = horiz ? H : H * frac;
  return Math.max(rw / img.naturalWidth, rh / img.naturalHeight) * (side === 'a' ? s.za : s.zb);
}
// 이 칸을 확대 없이 채우려면 필요한 사진 크기 (가로×세로)
function mergeNeedSize(side) {
  const s = mg.spec, horiz = s.dir !== 'v';
  const frac = side === 'a' ? Math.min(1, s.split + s.feather / 2) : Math.min(1, 1 - (s.split - s.feather / 2));
  return `${Math.round(horiz ? W * frac : W)}×${Math.round(horiz ? H : H * frac)}`;
}
function updateMergeQuality() {
  ['a', 'b'].forEach(k => {
    const el = $('#mgQ' + k), img = mg.imgs[k];
    if (!img) { el.textContent = ''; el.className = 'slot-q'; return; }
    const up = mergeUpscale(k);
    const size = `${img.naturalWidth}×${img.naturalHeight}`;
    if (up <= 1.05) { el.textContent = `${size} · 선명해요`; el.className = 'slot-q good'; }
    else if (up <= 1.6) { el.textContent = `${size} · ${up.toFixed(1)}배 확대 (약간 흐릿)`; el.className = 'slot-q warn'; }
    else { el.textContent = `${size} · ${up.toFixed(1)}배 확대 → 흐릿해요. 더 큰/세로 사진 추천`; el.className = 'slot-q bad'; }
  });
}
let mgRaf = 0;
function renderMergePreview() {
  updateMergeQuality();
  cancelAnimationFrame(mgRaf);
  mgRaf = requestAnimationFrame(() => {
    const pv = $('#mgPreview');
    const c = drawMerge(mg.spec, mg.imgs, pv.width, pv.height);
    const x = pv.getContext('2d');
    x.clearRect(0, 0, pv.width, pv.height);
    x.drawImage(c, 0, 0);
    // 경계 위치 표시
    const horiz = mg.spec.dir !== 'v';
    const p = mg.spec.split * (horiz ? pv.width : pv.height);
    x.strokeStyle = 'rgba(255,61,127,0.7)'; x.setLineDash([5, 4]); x.lineWidth = 1;
    x.beginPath();
    horiz ? (x.moveTo(p, 0), x.lineTo(p, pv.height)) : (x.moveTo(0, p), x.lineTo(pv.width, p));
    x.stroke(); x.setLineDash([]);
    if (!mg.imgs.a || !mg.imgs.b) {
      x.fillStyle = 'rgba(255,255,255,0.6)'; x.font = '600 15px Pretendard, sans-serif'; x.textAlign = 'center';
      x.fillText('오른쪽에서 사진 두 장을 넣어주세요', pv.width / 2, pv.height / 2);
    }
  });
}
async function setMergeSlot(k, src) {
  if (!src) return;
  mg.spec[k] = src;
  mg.imgs[k] = await loadHtmlImage(src);
  if (k === 'a') { mg.spec.za = 1; mg.spec.ax = mg.spec.ay = 0; } else { mg.spec.zb = 1; mg.spec.bx = mg.spec.by = 0; }
  syncMergeUI();
}
async function pickMergeFile(k) {
  const [f] = await pickFiles();
  if (!f) return;
  busy(true, '사진 불러오는 중…');
  try { await setMergeSlot(k, await fileToDataURL(f)); } catch (e) { toast(e.message); } finally { busy(false); }
}
function pickMergeCurrent(k) {
  const o = canvas.getActiveObject();
  const src = o && o.type === 'image' && o.kind !== 'logo' ? o.getSrc() : objectImageSrc(slideBgImage());
  if (!src || src === PLACEHOLDER) { toast('현재 슬라이드에 쓸 사진이 없어요'); return; }
  setMergeSlot(k, src);
}

async function applyMerge() {
  const s = mg.spec;
  if (!mg.imgs.a || !mg.imgs.b) { toast('사진 두 장을 모두 넣어주세요'); return; }
  busy(true, '합치는 중…');
  try {
    const url = drawMerge(s, mg.imgs, W * MERGE_SCALE, H * MERGE_SCALE).toDataURL('image/jpeg', 0.96);
    const spec = JSON.parse(JSON.stringify(s));
    const mode = $$('input[name=mgApply]').find(r => r.checked).value;
    let obj;
    if (mode === 'replace' && mg.target && canvas.getObjects().includes(mg.target)) {
      obj = mg.target;
      await setImageSrc(obj, url); fitImage(obj, 'cover');
    } else if (mode === 'bg' && slideBgImage()) {
      obj = slideBgImage();
      await setImageSrc(obj, url); fitImage(obj, 'cover');
    } else {
      obj = await makeImage(url, { name: '합친 사진' });
      canvas.insertAt(obj, 0, false); applyLock(obj);
    }
    obj.mergeSpec = spec;
    obj.layerName = obj.layerName === '배경 사진' ? '배경 사진 (합침)' : obj.layerName || '합친 사진';
    canvas.setActiveObject(obj);
    canvas.requestRenderAll(); commit(true);
    closeModal('mergeModal');
    renderProps(); renderLayers();
    toast('두 장을 합쳤어요. 사진을 선택하고 "합친 사진 다시 편집"으로 언제든 고칠 수 있어요', 4000);
  } catch (e) { console.error(e); toast('합치기 실패: ' + e.message); } finally { busy(false); }
}

function bindMergeUI() {
  $$('#mergeModal .merge-slot').forEach(slot => {
    const k = slot.dataset.slot;
    $('[data-pick=file]', slot).onclick = () => pickMergeFile(k);
    $('[data-pick=current]', slot).onclick = () => pickMergeCurrent(k);
    // 인터넷 검색(원본 찾기·구글·핀터레스트·TMDB)으로 고른 사진을 이 칸에 넣기
    $('[data-pick=search]', slot).onclick = () => {
      const other = k === 'a' ? 'b' : 'a';
      openSearch(state.settings.serpApiKey ? 'google' : 'pinterest', false, {
        label: `두 장 합치기 · ${k === 'a' ? '사진 1' : '사진 2'}에 넣을 사진 (선명하려면 ${mergeNeedSize(k)} 이상)`,
        lensSrc: mg.spec[k] || mg.spec[other] || objectImageSrc(slideBgImage()),
        pick: async url => { await setMergeSlot(k, url); toast(`${k === 'a' ? '사진 1' : '사진 2'}에 넣었어요`); },
      });
    };
    $('img', slot).onclick = () => pickMergeFile(k);
    slot.addEventListener('dragover', e => { e.preventDefault(); slot.classList.add('over'); });
    slot.addEventListener('dragleave', () => slot.classList.remove('over'));
    slot.addEventListener('drop', async e => {
      e.preventDefault(); e.stopPropagation(); slot.classList.remove('over');
      const f = [...e.dataTransfer.files].find(isImageFile);
      if (f) { busy(true, '사진 불러오는 중…'); try { await setMergeSlot(k, await fileToDataURL(f)); } finally { busy(false); } }
    });
  });
  $('#mgSwap').onclick = () => {
    const s = mg.spec;
    [s.a, s.b] = [s.b, s.a]; [s.za, s.zb] = [s.zb, s.za]; [s.ax, s.bx] = [s.bx, s.ax]; [s.ay, s.by] = [s.by, s.ay];
    [mg.imgs.a, mg.imgs.b] = [mg.imgs.b, mg.imgs.a];
    syncMergeUI();
  };
  $$('#mergeModal [data-dir]').forEach(b => b.onclick = () => { mg.spec.dir = b.dataset.dir; syncMergeUI(); });
  [['mgSplit', 'split', 100], ['mgFeather', 'feather', 100], ['mgZa', 'za', 1], ['mgZb', 'zb', 1]].forEach(([id, key, mul]) => {
    const r = $('#' + id), n = $('#' + id + 'N');
    const set = v => { if (!isFinite(v)) return; mg.spec[key] = v / mul; r.value = v; n.value = v; renderMergePreview(); };
    r.addEventListener('input', () => set(parseFloat(r.value)));
    n.addEventListener('input', () => set(parseFloat(n.value)));
  });
  $('#mgGo').onclick = applyMerge;

  // 미리보기에서 드래그 = 그쪽 사진 이동, 휠 = 그쪽 사진 확대
  const pv = $('#mgPreview');
  const sideAt = e => {
    const r = pv.getBoundingClientRect();
    const t = mg.spec.dir === 'v' ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
    return t < mg.spec.split ? 'a' : 'b';
  };
  pv.addEventListener('pointerdown', e => {
    mg.drag = { side: sideAt(e), x: e.clientX, y: e.clientY };
    pv.setPointerCapture(e.pointerId);
  });
  pv.addEventListener('pointermove', e => {
    if (!mg.drag) return;
    const r = pv.getBoundingClientRect(), k = W / r.width;   // 화면 픽셀 → 카드 단위
    const d = mg.drag;
    mg.spec[d.side + 'x'] += (e.clientX - d.x) * k;
    mg.spec[d.side + 'y'] += (e.clientY - d.y) * k;
    d.x = e.clientX; d.y = e.clientY;
    renderMergePreview();
  });
  pv.addEventListener('pointerup', () => { mg.drag = null; });
  pv.addEventListener('wheel', e => {
    e.preventDefault();
    const key = sideAt(e) === 'a' ? 'za' : 'zb';
    mg.spec[key] = clamp(mg.spec[key] * (e.deltaY < 0 ? 1.06 : 1 / 1.06), 1, 5);
    syncMergeUI();
  }, { passive: false });
}
