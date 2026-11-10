'use strict';
/* ===== 속성 패널 & 레이어 패널 ===== */

const fmt = v => (typeof v === 'number' ? round(v, 2) : v);
function afterEdit() {
  const o = canvas.getActiveObject();
  if (o) o.setCoords();
  canvas.requestRenderAll();
  commit();
}
function section(title, ...rows) {
  const t = typeof title === 'string' ? h('div', { class: 'sec-title' }, title) : title;
  return h('div', { class: 'sec' }, t, ...rows);
}
function row(label, ...ctrls) { return h('div', { class: 'row' }, h('label', {}, label), h('div', { class: 'ctrl' }, ...ctrls)); }
function numInput(get, set, opt = {}) {
  const i = h('input', { type: 'number', step: opt.step || 1, value: fmt(get()) });
  if (opt.min != null) i.min = opt.min;
  if (opt.max != null) i.max = opt.max;
  i.addEventListener('input', () => { const v = parseFloat(i.value); if (!isFinite(v)) return; set(v); afterEdit(); });
  return i;
}
function slider(get, set, { min, max, step = 1, scale = 1 }) {
  const r = h('input', { type: 'range', min, max, step, value: get() });
  const n = h('input', { type: 'number', min, max, step, value: fmt(get()), class: 'mini' });
  r.addEventListener('input', () => { n.value = r.value; set(parseFloat(r.value)); afterEdit(); });
  n.addEventListener('input', () => { const v = parseFloat(n.value); if (!isFinite(v)) return; r.value = v; set(v); afterEdit(); });
  return [r, n];
}
function colorInput(get, set) {
  const c = h('input', { type: 'color', value: toHex(get()) });
  const t = h('input', { type: 'text', value: get() || '', class: 'hex' });
  c.addEventListener('input', () => { t.value = c.value; set(c.value); afterEdit(); });
  t.addEventListener('change', () => { set(t.value); c.value = toHex(t.value); afterEdit(); });
  return [c, t];
}
function selectInput(options, get, set) {
  const s = h('select', {}, options.map(([v, l]) => h('option', { value: v }, l)));
  s.value = String(get());
  s.addEventListener('change', () => { set(s.value); afterEdit(); });
  return s;
}
function btn(label, onclick, title) { return h('button', { onclick, title }, label); }

/* ----- 속성 패널 ----- */
function renderProps() {
  const el = $('#props');
  if (!el || !canvas) return;
  const keepScroll = el.parentElement.scrollTop;
  el.innerHTML = '';
  const o = canvas.getActiveObject();
  if (!o) { el.append(slideSection()); return; }
  if (o.type === 'activeSelection') {
    el.append(section(`${o.size()}개 선택됨`, alignButtons(o),
      h('div', { class: 'btn-row' }, btn('복제', duplicateSelection), btn('삭제', deleteSelection))));
    el.parentElement.scrollTop = keepScroll;
    return;
  }
  el.append(section('레이어', row('이름', (() => {
    const i = h('input', { type: 'text', value: o.layerName || '' });
    i.addEventListener('change', () => { o.layerName = i.value; commit(); renderLayers(); });
    return i;
  })())));
  if (o.type === 'i-text' || o.type === 'text' || o.type === 'textbox') el.append(textSection(o));
  if (o.kind === 'frame') el.append(frameSection(o));
  else if (o.type === 'image') el.append(o.kind === 'logo' ? logoSection(o) : imageSection(o));
  if (o.kind === 'gradient') el.append(gradientSection(o));
  if (o.kind === 'shape') el.append(shapeSection(o));
  if (o.kind === 'divider') el.append(dividerSection(o));
  if (o.kind === 'dots') el.append(dotsSection(o));
  el.append(transformSection(o));
  el.append(effectSection(o));
  el.parentElement.scrollTop = keepScroll;
}

function slideSection() {
  return h('div', {},
    section(`슬라이드 ${state.current + 1} / ${slides().length}`,
      row('배경색', ...colorInput(() => canvas.backgroundColor, v => { canvas.backgroundColor = v; })),
      h('p', { class: 'hint' }, '오브젝트를 클릭하면 여기서 세부 속성을 편집할 수 있어요. 잠긴 레이어(🔒)는 레이어 목록에서 선택하세요.'),
    ),
    section('카드 크기',
      h('div', { class: 'btn-row' },
        ...[[BASE_H, '4:5 세로 (1080×1350)'], [1080, '1:1 정사각 (1080×1080)']].map(([hh, label]) => {
          const b = btn(label, () => convertProjectSize(hh), hh === H ? '지금 크기' : '모든 카드를 이 크기로 바꾸기');
          if (hh === H) b.classList.add('on');
          return b;
        })),
      h('p', { class: 'hint' }, '누르면 모든 카드가 한 번에 바뀌어요. 아래쪽 글씨·로고는 아래에 붙은 채로 올라가고, 배경 사진은 꽉 채워져요. 원본은 프로젝트 폴더에 따로 남겨둬요.'),
    ),
    section('글씨 스타일 한 번에',
      h('div', { class: 'btn-row' }, btn('모든 카드 글씨를 김동댕 PSD 스타일로', applyPsdStyleToAllSlides)),
      h('p', { class: 'hint' }, "제목·본문·인용문·말한 사람 레이어의 폰트·크기·행간·자간·그림자·텍스쳐를 PSD 값으로 맞춰요."),
    ),
    section('단축키', h('div', { class: 'kbd-list', html: '' },
      ...[
        ['Ctrl+Z / Ctrl+Shift+Z', '실행 취소 / 다시'],
        ['Ctrl+C / V / D', '복사 / 붙여넣기 / 복제'],
        ['Del', '삭제'],
        ['방향키 (+Shift)', '1px (10px) 이동'],
        ['Ctrl+] / [', '앞으로 / 뒤로'],
        ['Ctrl+휠, Ctrl+0', '확대·축소 / 맞춤'],
        ['더블클릭', '텍스트 편집 · 사진 교체 · 프레임 안 사진 조정'],
        ['Alt+드래그', '중앙 스냅 끄기'],
        ['Ctrl+V (이미지)', '클립보드 사진 붙여넣기'],
        ['PageUp / PageDown', '이전 / 다음 슬라이드'],
      ].map(([k, d]) => h('div', {}, h('kbd', {}, k), ' ', d)),
    )),
  );
}

function alignButtons(o) {
  const a = how => () => alignObj(o, how);
  return h('div', {},
    h('div', { class: 'btn-row' }, btn('⇤ 왼쪽', a('left')), btn('↔ 가로 중앙', a('hcenter')), btn('오른쪽 ⇥', a('right'))),
    h('div', { class: 'btn-row' }, btn('⤒ 위', a('top')), btn('↕ 세로 중앙', a('vcenter')), btn('아래 ⤓', a('bottom'))),
  );
}

let ratioLock = true;
function transformSection(o) {
  const c = () => o.getCenterPoint();
  const setC = (x, y) => o.setPositionByOrigin(new fabric.Point(x, y), 'center', 'center');
  const sw = () => o.width * o.scaleX, sh = () => o.height * o.scaleY;
  const setW = v => {
    if (v <= 0) return;
    const r = o.scaleY / o.scaleX;
    o.scaleX = v / o.width;
    if (ratioLock) o.scaleY = o.scaleX * r;
    normalizeObject(o);
  };
  const setH = v => {
    if (v <= 0) return;
    const r = o.scaleX / o.scaleY;
    o.scaleY = v / o.height;
    if (ratioLock) o.scaleX = o.scaleY * r;
    normalizeObject(o);
  };
  const wIn = numInput(sw, setW), hIn = numInput(sh, setH);
  // 크기 게이지: 중심을 유지한 채 가로세로 같은 비율로 확대/축소
  const setSizePct = p => {
    const k = (W * p / 100) / sw();
    if (!isFinite(k) || k <= 0) return;
    const c0 = o.getCenterPoint();
    o.scaleX *= k; o.scaleY *= k;
    normalizeObject(o);
    o.setPositionByOrigin(c0, 'center', 'center');
    wIn.value = fmt(sw()); hIn.value = fmt(sh());
  };
  const lockBtn = btn(ratioLock ? '🔗' : '⛓', () => { ratioLock = !ratioLock; renderProps(); }, '비율 고정');
  if (ratioLock) lockBtn.classList.add('on');
  return section('위치 · 크기',
    h('div', { class: 'grid2c' },
      row('X', numInput(() => c().x, v => setC(v, c().y))),
      row('Y', numInput(() => c().y, v => setC(c().x, v))),
      row('W', wIn),
      row('H', hIn),
    ),
    row('비율', lockBtn, h('span', { class: 'muted' }, `중심 기준 좌표 · 캔버스 ${W}×${H}`)),
    row('크기 %', ...slider(() => round(sw() / W * 100, 1), setSizePct, { min: 2, max: 300, step: 0.5 })),
    h('p', { class: 'hint', style: 'margin-top:-2px' }, '크기 % = 카드 폭(1080px) 대비 · 비율은 항상 유지돼요'),
    row('회전', ...slider(() => o.angle || 0, v => { o.rotate(v); }, { min: -180, max: 180, step: 1 })),
    alignButtons(o),
    h('div', { class: 'btn-row' },
      btn('좌우 반전', () => { o.flipX = !o.flipX; afterEdit(); }),
      btn('상하 반전', () => { o.flipY = !o.flipY; afterEdit(); }),
      btn('맨 앞', () => arrange('top')), btn('맨 뒤', () => arrange('bottom')),
    ),
  );
}

function effectSection(o) {
  const blends = [['source-over', '보통'], ['multiply', '곱하기'], ['screen', '스크린'], ['overlay', '오버레이'], ['soft-light', '소프트 라이트'],
    ['hard-light', '하드 라이트'], ['darken', '어둡게'], ['lighten', '밝게'], ['color-dodge', '닷지'], ['color-burn', '번'],
    ['difference', '차이'], ['luminosity', '광도'], ['color', '색상'], ['saturation', '채도']];
  const rows = [
    row('불투명도', ...slider(() => Math.round((o.opacity ?? 1) * 100), v => { o.opacity = v / 100; }, { min: 0, max: 100 })),
    row('혼합', selectInput(blends, () => o.globalCompositeOperation || 'source-over', v => { o.globalCompositeOperation = v; })),
  ];
  const shadowOn = !!o.shadow;
  const toggle = h('label', { style: 'display:flex;gap:5px;align-items:center;font-weight:normal;color:#ccc' },
    h('input', { type: 'checkbox', checked: shadowOn, onchange: e => {
      o.shadow = e.target.checked ? new fabric.Shadow({ color: 'rgba(0,0,0,0.55)', blur: 20, offsetX: 0, offsetY: 5 }) : null;
      o.dirty = true; afterEdit(); renderProps();
    } }), '그림자');
  rows.push(row('', toggle));
  if (shadowOn) {
    const s = o.shadow;
    const upd = () => { o.dirty = true; };
    rows.push(
      row('색', ...colorInput(() => s.color, v => { s.color = v; upd(); })),
      row('흐림', ...slider(() => s.blur, v => { s.blur = v; upd(); }, { min: 0, max: 100 })),
      row('X', ...slider(() => s.offsetX, v => { s.offsetX = v; upd(); }, { min: -60, max: 60 })),
      row('Y', ...slider(() => s.offsetY, v => { s.offsetY = v; upd(); }, { min: -60, max: 60 })),
    );
  }
  return section('효과', ...rows);
}

/* 텍스트 */
function syncTextarea(t) {
  const ta = $('#textContent');
  if (ta && canvas.getActiveObject() === t && document.activeElement !== ta) ta.value = getMarkup(t);
}
function textRange(o) {
  if (o.isEditing && o.selectionStart !== o.selectionEnd) return [o.selectionStart, o.selectionEnd];
  if (state.textSel && state.textSel.obj === o && state.textSel.start !== state.textSel.end) return [state.textSel.start, state.textSel.end];
  return null;
}
function applySelStyle(o, style) {
  const r = textRange(o);
  if (!r) { toast('캔버스에서 텍스트를 더블클릭한 뒤, 바꿀 글자를 드래그해서 선택하세요', 3500); return; }
  o.setSelectionStyles(style, r[0], r[1]);
  o.initDimensions(); o.dirty = true;
  afterEdit(); syncTextarea(o);
}
function resetSelFill(o) {
  const r = textRange(o);
  if (!r) { toast('캔버스에서 텍스트를 더블클릭한 뒤, 글자를 드래그해서 선택하세요', 3500); return; }
  for (let i = r[0]; i < r[1]; i++) {
    const loc = o.get2DCursorLocation(i);
    const st = o.styles[loc.lineIndex] && o.styles[loc.lineIndex][loc.charIndex];
    if (st) delete st.fill;
  }
  o.dirty = true; afterEdit(); syncTextarea(o);
}
function textSection(o) {
  const ta = h('textarea', { id: 'textContent', class: 'text-content', rows: Math.min(8, Math.max(3, o.text.split('\n').length + 1)), value: getMarkup(o) });
  ta.addEventListener('input', () => {
    if (o.isEditing) o.exitEditing();
    setMarkup(o, ta.value); afterEdit();
  });
  const fonts = allFonts();
  const fi = fontInfo(o.fontFamily);
  const weights = fi ? fi.weights : ['normal', '400', '700', '900'];
  const weightLabel = w => ({ normal: '기본', '300': '300 얇게', '400': '400 보통', '500': '500', '600': '600', '700': '700 굵게', '800': '800', '900': '900 아주 굵게' }[w] || w);
  const setFont = async v => {
    const info = fontInfo(v);
    let w = String(o.fontWeight);
    if (info && !info.weights.includes(w)) w = info.weights[info.weights.length - 1];
    await loadFont(v, w);
    fabric.util.clearFabricFontCache(v);
    o.set({ fontFamily: v, fontWeight: w });
    o.initDimensions(); afterEdit(); renderProps();
  };
  const fontSel = h('select', {}, fonts.map(f => h('option', { value: f.family }, f.label)));
  if (!fi) fontSel.append(h('option', { value: o.fontFamily }, o.fontFamily));
  fontSel.value = o.fontFamily;
  fontSel.addEventListener('change', () => setFont(fontSel.value));
  const alignBtns = [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']].map(([v, l]) => {
    const b = btn(l, () => { o.set('textAlign', v); afterEdit(); renderProps(); });
    if (o.textAlign === v) b.classList.add('on');
    return b;
  });
  const selColor = h('input', { type: 'color', value: '#ff4d4d', title: '선택 글자 색' });
  selColor.addEventListener('change', () => applySelStyle(o, { fill: selColor.value }));
  return h('div', {},
    section('텍스트',
      ta,
      h('p', { class: 'hint' }, h('b', {}, '*별표*'), '로 감싼 글자는 강조색이 됩니다. 캔버스에서 더블클릭해 직접 고칠 수도 있어요.'),
      row('폰트', fontSel),
      row('굵기', selectInput(weights.map(w => [w, weightLabel(w)]), () => String(o.fontWeight), async v => { await loadFont(o.fontFamily, v); fabric.util.clearFabricFontCache(o.fontFamily); o.set('fontWeight', v); o.initDimensions(); afterEdit(); })),
      row('글자크기', ...slider(() => o.fontSize, v => { o.set('fontSize', v); o.initDimensions(); }, { min: 10, max: 300 })),
      row('줄간격', ...slider(() => o.lineHeight, v => { o.set('lineHeight', v); o.initDimensions(); }, { min: 0.6, max: 2.5, step: 0.01 })),
      row('자간', ...slider(() => o.charSpacing, v => { o.set('charSpacing', v); o.initDimensions(); }, { min: -200, max: 600, step: 5 })),
      row('정렬', ...alignBtns),
      row('글자색', ...colorInput(() => o.fill, v => { o.set('fill', v); })),
    ),
    section('부분 강조 (선택한 글자)',
      h('p', { class: 'hint' }, '텍스트를 더블클릭 → 글자 드래그 선택 → 버튼'),
      h('div', { class: 'btn-row' },
        btn('강조색 적용', () => applySelStyle(o, { fill: accent() })),
        btn('기본색으로', () => resetSelFill(o)),
      ),
      row('다른 색', selColor, h('span', { class: 'muted' }, '고르면 선택 글자에 적용')),
      h('div', { class: 'btn-row' },
        btn('선택 글자 크게', () => { const r = textRange(o); if (!r) return applySelStyle(o, {}); const s = o.getSelectionStyles(r[0], r[0] + 1)[0] || {}; applySelStyle(o, { fontSize: Math.round((s.fontSize || o.fontSize) * 1.15) }); }),
        btn('선택 글자 작게', () => { const r = textRange(o); if (!r) return applySelStyle(o, {}); const s = o.getSelectionStyles(r[0], r[0] + 1)[0] || {}; applySelStyle(o, { fontSize: Math.round((s.fontSize || o.fontSize) / 1.15) }); }),
      ),
    ),
    section('김동댕 PSD 스타일',
      h('div', { class: 'btn-row' },
        ...Object.entries(PSD_PRESETS).map(([k, p]) => btn(p.label, () => applyPresetToText(o, k), `${p.label} 스타일 (${fontInfo(p.font) ? fontInfo(p.font).label : p.font} ${p.size}px)`)),
      ),
    ),
    textureSection(o),
    section('스타일 전체 적용',
      h('p', { class: 'hint' }, `폰트·굵기·자간·행간·그림자·외곽선·텍스쳐를 모든 카드의 '${o.layerName || '텍스트'}' 레이어에 똑같이 적용해요. (글자 내용·크기·강조색은 그대로)`),
      h('div', { class: 'btn-row' }, btn('모든 카드에 이 글씨 스타일 적용', () => applyTextStyleToAll(o))),
    ),
    section('외곽선',
      row('색', ...colorInput(() => o.stroke || '#000000', v => { o.set('stroke', v); })),
      row('두께', ...slider(() => o.strokeWidth || 0, v => { o.set({ strokeWidth: v, paintFirst: 'stroke', strokeLineJoin: 'round' }); o.initDimensions(); }, { min: 0, max: 30, step: 0.5 })),
    ),
  );
}

/* 글씨 텍스쳐 */
function textureSection(o) {
  const setTex = async src => {
    if (src) { busy(true, '텍스쳐 준비 중…'); try { await loadTexture(src); } finally { busy(false); } }
    o.set('textureSrc', src || null);
    afterEdit(); renderProps();
  };
  const sel = h('select', {},
    h('option', { value: '' }, '없음'),
    h('option', { value: 'marble' }, '마블 (김동댕 PSD)'),
    o.textureSrc && !BUILTIN_TEXTURES[o.textureSrc] ? h('option', { value: '__custom' }, '내가 올린 텍스쳐') : null,
    h('option', { value: '__upload' }, '이미지 올리기…'));
  sel.value = !o.textureSrc ? '' : BUILTIN_TEXTURES[o.textureSrc] ? o.textureSrc : '__custom';
  sel.addEventListener('change', async () => {
    if (sel.value === '__upload') {
      const [f] = await pickFiles();
      if (!f) { renderProps(); return; }
      await setTex(await fileToDataURL(f, 1200));
    } else if (sel.value !== '__custom') await setTex(sel.value);
  });
  return section('글씨 텍스쳐',
    row('종류', sel),
    o.textureSrc ? row('진하기', ...slider(() => Math.round((o.textureOpacity ?? 0.2) * 100), v => o.set('textureOpacity', v / 100), { min: 0, max: 100 })) : null,
    h('p', { class: 'hint' }, '글씨 모양 안에만 무늬가 은은하게 깔려요 (PSD 원본: 마블 20%)'),
  );
}
/* 김동댕 PSD 프리셋 적용 */
async function applyPresetToText(o, key) {
  const p = presetProps(key);
  await loadFont(p.fontFamily, p.fontWeight);
  fabric.util.clearFabricFontCache(p.fontFamily);
  const c = o.getCenterPoint();
  o.set({ ...p, shadow: p.shadow ? new fabric.Shadow(p.shadow) : null });
  o.initDimensions();
  o.setPositionByOrigin(c, 'center', 'center');
  afterEdit(); renderProps();
}
async function applyPsdStyleToAllSlides() {
  if (!confirm("모든 카드의 '제목·본문·인용문·말한 사람' 글씨를 김동댕 PSD 스타일(폰트·크기·행간·자간·그림자·텍스쳐)로 바꿀까요?\n글자 내용과 노란 강조, 위치는 그대로예요. (Ctrl+Z로 카드별 되돌리기 가능)")) return;
  leaveCurrent();
  let n = 0;
  slides().forEach(sl => {
    let changed = false;
    walkObjs(sl.json.objects, o => {
      const key = o.type === 'i-text' && PRESET_BY_NAME[o.layerName];
      if (!key) return;
      Object.assign(o, presetProps(key));
      changed = true; n++;
    });
    if (changed && sl !== cur()) {
      sl.thumb = null;
      sl.hist = (sl.hist || []).slice(0, (sl.hi ?? -1) + 1);
      sl.hist.push(JSON.stringify(sl.json)); sl.hi = sl.hist.length - 1;
    }
  });
  await loadSlideToCanvas(state.current);
  pushHistory(); renderAll(); scheduleAutosave();
  ensureThumbs();
  toast(`${n}개의 글씨를 김동댕 PSD 스타일로 바꿨어요`);
}

async function applyTextStyleToAll(src) {
  const name = src.layerName;
  const style = {
    fontFamily: src.fontFamily, fontWeight: src.fontWeight, charSpacing: src.charSpacing, lineHeight: src.lineHeight,
    stroke: src.stroke, strokeWidth: src.strokeWidth, paintFirst: src.paintFirst,
    shadow: src.shadow ? src.shadow.toObject() : null,
    textureSrc: src.textureSrc || null, textureOpacity: src.textureOpacity,
  };
  leaveCurrent();
  let n = 0;
  slides().forEach(sl => walkObjs(sl.json.objects, o => {
    if (o.type !== 'i-text' || o.layerName !== name) return;
    Object.assign(o, JSON.parse(JSON.stringify(style)));
    sl.thumb = null; n++;
  }));
  await loadSlideToCanvas(state.current);
  pushHistory(); renderAll(); scheduleAutosave();
  ensureThumbs();
  toast(`${n}개의 '${name}' 텍스트에 같은 스타일을 적용했어요`);
}

/* 이미지 */
function getFilter(o, type) { return (o.filters || []).find(f => f && f.type === type); }
function setFilter(o, type, key, value, neutral) {
  let f = getFilter(o, type);
  if (!f) {
    if (value === neutral) return;
    f = new fabric.Image.filters[type]();
    o.filters.push(f);
  }
  f[key] = value;
  if (value === neutral) o.filters = o.filters.filter(x => x !== f);
  o.applyFilters();
}
function imageSection(o) {
  const fval = (type, key, d) => { const f = getFilter(o, type); return f ? f[key] : d; };
  const cropping = cropTarget === o;
  const frame = frameOf(canvas, o);
  return h('div', {},
    frame ? section(frame.type === 'circle' ? '원형 사진 안의 사진' : '프레임 안의 사진',
      row('보이는 범위', selectInput([['inside', '원 안에만'], ['popout', '위로 튀어나오기'], ['free', '자르지 않기']],
        () => o.clipMode || 'inside', v => { o.clipMode = v; o._clipSig = null; syncFrames(canvas); })),
      h('p', { class: 'hint' }, "'위로 튀어나오기'는 아래쪽은 원에 잘리고 위쪽은 원 밖으로 나와요 (누끼 딴 인물에 딱). 원보다 크게 키워도 돼요."),
      h('div', { class: 'btn-row' },
        btn('원에 꽉 채우기', () => { fitToFrame(canvas, o); afterEdit(); renderProps(); }),
        btn('＋ 이 원에 사진 더 넣기', () => openAddToFrame(frame)),
        btn('원에서 빼기', () => { o.frameId = null; o.clipPath = null; o._clipSig = null; if (o.kind === 'framepic') o.kind = 'image'; afterEdit(); renderLayers(); renderProps(); }),
      ),
    ) : null,
    section('자르기',
      h('div', { class: 'btn-row' },
        cropping ? btn('✔ 자르기 완료 (Enter)', exitCrop) : btn('✂ 이미지 자르기', () => enterCrop(o), '핸들을 끄는 만큼 잘려요'),
        btn('자르기 취소 (원본 전체)', () => resetCrop(o)),
      ),
      cropping ? h('p', { class: 'hint' }, '노란 핸들을 안으로 끌면 잘리고, 바깥으로 끌면 잘린 부분이 다시 나와요. 희미하게 보이는 부분이 잘려나간 곳이에요.') : null,
    ),
    section('사진',
      h('div', { class: 'btn-row' },
        btn('사진 교체', () => replaceImage(o)),
        btn('화면 꽉 채우기', () => { fitImage(o, 'cover'); afterEdit(); renderProps(); }),
        btn('화면에 맞추기', () => { fitImage(o, 'contain'); afterEdit(); renderProps(); }),
      ),
      h('div', { class: 'btn-row' },
        btn('🔍 원본 찾기', () => openSearch('lens', true)),
        btn('🌐 비슷한 이미지 검색', () => openSearch('google')),
        btn('📌 핀터레스트', () => openSearch('pinterest')),
      ),
      h('div', { class: 'btn-row' },
        btn(o.mergeSpec ? '◧ 합친 사진 다시 편집' : '◧ 다른 사진과 두 장 합치기', openMerge),
      ),
      row('누끼',
        btn('✂ 누끼 따기', () => cutoutImage(o), '배경을 지운 사진을 새 레이어로 만들어요 (내 컴퓨터에서 무료)'),
        selectInput([['birefnet-general', '일반 (고품질)'], ['birefnet-portrait', '인물 전용'], ['isnet-general-use', '빠름 (저품질)']],
          () => state.settings.cutoutModel || 'birefnet-general', v => { state.settings.cutoutModel = v; saveSettings(); }),
      ),
      h('p', { class: 'hint' }, '사진을 더블클릭하거나, 파일을 사진 위로 끌어다 놓아도 교체돼요.'),
    ),
    section(h('div', { class: 'sec-title' }, '보정', btn('초기화', () => { o.filters = []; o.applyFilters(); afterEdit(); renderProps(); })),
      row('밝기', ...slider(() => fval('Brightness', 'brightness', 0), v => setFilter(o, 'Brightness', 'brightness', v, 0), { min: -0.6, max: 0.6, step: 0.01 })),
      row('대비', ...slider(() => fval('Contrast', 'contrast', 0), v => setFilter(o, 'Contrast', 'contrast', v, 0), { min: -0.6, max: 0.6, step: 0.01 })),
      row('채도', ...slider(() => fval('Saturation', 'saturation', 0), v => setFilter(o, 'Saturation', 'saturation', v, 0), { min: -1, max: 1, step: 0.01 })),
      row('흐림', ...slider(() => fval('Blur', 'blur', 0), v => setFilter(o, 'Blur', 'blur', v, 0), { min: 0, max: 0.6, step: 0.01 })),
    ),
  );
}
function logoSection() {
  return section('로고',
    h('p', { class: 'hint' }, '로고 이미지는 설정에서 바꾸면 모든 슬라이드에 한 번에 적용돼요.'),
    h('div', { class: 'btn-row' }, btn('로고 바꾸기 (설정)', openSettings)),
  );
}

/* 프레임 */
function frameSection(o) {
  const [fw, fh] = frameSize(o);
  if (!isLegacyFrame(o)) {
    // 새 방식: 사진 담는 틀 (안의 사진은 레이어 목록에서 이 원 아래에)
    const kids = frameKids(canvas, o);
    const rows = [
      h('div', { class: 'btn-row' }, btn('＋ 사진 추가 (검색 · 내 파일)', () => openAddToFrame(o))),
      h('p', { class: 'hint' }, kids.length
        ? `안에 사진 ${kids.length}장 — 레이어 목록에서 이 원 아래에 있어요. 원을 더블클릭하면 맨 위 사진이 선택돼요. 원을 옮기면 같이 따라와요.`
        : '아직 사진이 없어요. 사진을 추가하면 이 원 모양으로 잘려 보여요.'),
      row('안쪽 배경', ...colorInput(() => (typeof o.fill === 'string' ? o.fill : FRAME_INNER_BG), v => o.set('fill', v))),
      row('테두리색', ...colorInput(() => o.stroke, v => o.set('stroke', v))),
      row('테두리', ...slider(() => o.strokeWidth || 0, v => o.set('strokeWidth', v), { min: 0, max: 40 })),
    ];
    if (o.type === 'rect') rows.push(row('둥글게', ...slider(() => o.rx || 0, v => o.set({ rx: v, ry: v }), { min: 0, max: Math.round(Math.min(fw, fh) / 2) })));
    return section(o.type === 'circle' ? '원형 사진' : '사진 프레임', ...rows);
  }
  const upd = () => updateFrame(o);
  const editing = frameEdit === o;
  const rows = [
    h('div', { class: 'btn-row' },
      btn('사진 교체', () => replaceFrameImage(o)),
      btn(editing ? '조정 끝내기' : '안쪽 사진 위치 조정', () => editing ? (exitFrameEdit(), renderProps()) : enterFrameEdit(o)),
    ),
    h('div', { class: 'btn-row' },
      btn('🔍 원본 찾기', () => openSearch('lens', true)),
      btn('🌐 비슷한 이미지', () => openSearch('google')),
      btn('📌 핀터레스트', () => openSearch('pinterest')),
      btn('🎬 인물·스틸', () => openSearch('tmdb')),
    ),
    h('div', { class: 'btn-row' }, btn('＋ 사진 여러 장 넣기 (새 방식으로 바꾸기)', () => {
      const k = convertLegacyFrame(canvas, o);
      if (k) { canvas.setActiveObject(k); canvas.requestRenderAll(); commit(); renderLayers(); renderProps(); }
      openAddToFrame(o);
    })),
    h('p', { class: 'hint' }, '프레임을 더블클릭하면 드래그로 사진 위치를, 휠로 확대를 조정할 수 있어요.'),
    row('확대', ...slider(() => o.frameZoom || 1, v => { o.frameZoom = v; upd(); }, { min: 1, max: 6, step: 0.01 })),
    row('가로', ...slider(() => Math.round(o.frameOffX || 0), v => { o.frameOffX = v; upd(); }, { min: -Math.round(fw * 2), max: Math.round(fw * 2) })),
    row('세로', ...slider(() => Math.round(o.frameOffY || 0), v => { o.frameOffY = v; upd(); }, { min: -Math.round(fh * 2), max: Math.round(fh * 2) })),
    row('테두리색', ...colorInput(() => o.stroke, v => o.set('stroke', v))),
    row('테두리', ...slider(() => o.strokeWidth || 0, v => o.set('strokeWidth', v), { min: 0, max: 40 })),
  ];
  if (o.type === 'rect') rows.push(row('둥글게', ...slider(() => o.rx || 0, v => o.set({ rx: v, ry: v }), { min: 0, max: Math.round(Math.min(fw, fh) / 2) })));
  return section(o.type === 'circle' ? '원형 사진' : '사진 프레임', ...rows);
}

function gradientSection(o) {
  // 예전 그라데이션도 새 설정으로 조절할 수 있게 기본값 채움
  if (o.gradSolid == null) { o.gradSolid = 1; o.gradCurve = 'smooth'; }
  const upd = () => applyGradient(o);
  const pct = v => Math.round(v * 100);
  return section('그라데이션',
    h('div', { class: 'btn-row' }, ...Object.values(GRAD_PRESETS).map(p => btn(p.label, () => {
      Object.assign(o, p); delete o.label; upd(); afterEdit(); renderProps();
    }))),
    row('시작', ...slider(() => pct(o.gradStart ?? 0.42), v => {
      o.gradStart = v / 100;
      if (o.gradSolid < o.gradStart + 0.02) o.gradSolid = Math.min(1, o.gradStart + 0.02);
      upd();
    }, { min: 0, max: 95 })),
    row('꽉 검정', ...slider(() => pct(o.gradSolid), v => {
      o.gradSolid = Math.max(v / 100, (o.gradStart ?? 0) + 0.02); upd();
    }, { min: 5, max: 100 })),
    h('p', { class: 'hint' }, "시작: 투명→진해지기 시작하는 위치 / 꽉 검정: 여기부터 끝까지 완전히 진한 색 (%, 위→아래). 선택하면 캔버스에 노란 선으로 보여요."),
    row('진하기', ...slider(() => pct(o.gradStrength ?? 1), v => { o.gradStrength = v / 100; upd(); }, { min: 0, max: 100 })),
    row('곡선', selectInput([['smooth', '부드럽게 (S자)'], ['linear', '고르게'], ['fast', '빨리 진해짐'], ['slow', '천천히 → 끝에서 확']],
      () => o.gradCurve || 'smooth', v => { o.gradCurve = v; upd(); })),
    row('색', ...colorInput(() => o.gradColor || '#000000', v => { o.gradColor = v; upd(); })),
    row('방향', selectInput([['bottom', '아래로 진하게'], ['top', '위로 진하게'], ['right', '오른쪽으로'], ['left', '왼쪽으로']], () => o.gradDir || 'bottom', v => { o.gradDir = v; upd(); })),
  );
}
function shapeSection(o) {
  const rows = [
    row('채우기', ...colorInput(() => typeof o.fill === 'string' ? o.fill : '#ffffff', v => o.set('fill', v))),
    row('테두리색', ...colorInput(() => o.stroke || '#ffffff', v => o.set('stroke', v))),
    row('테두리', ...slider(() => o.strokeWidth || 0, v => o.set('strokeWidth', v), { min: 0, max: 40 })),
  ];
  if (o.type === 'rect') rows.push(row('둥글게', ...slider(() => o.rx || 0, v => o.set({ rx: v, ry: v }), { min: 0, max: Math.round(Math.min(o.width, o.height) / 2) })));
  return section('도형', ...rows);
}
function dividerSection(o) {
  const lines = o.getObjects();
  return section('구분선',
    row('색', ...colorInput(() => lines[0].stroke, v => { lines.forEach(l => l.set('stroke', v)); o.dirty = true; })),
    row('두께', ...slider(() => lines[0].strokeWidth, v => { lines.forEach(l => l.set('strokeWidth', v)); o.dirty = true; }, { min: 1, max: 12, step: 0.5 })),
  );
}
function dotsSection(o) {
  const rebuild = () => {
    const id = o.uid;
    refreshDots(canvas, state.current, slides().length);
    const n = canvas.getObjects().find(x => x.uid === id);
    if (n) canvas.setActiveObject(n);
    canvas.requestRenderAll(); commit();
  };
  return section('페이지 점',
    h('p', { class: 'hint' }, '점 개수와 현재 위치는 슬라이드 수·순서에 맞춰 자동으로 바뀌어요.'),
    row('현재', ...colorInput(() => o.dotActive, v => { o.dotActive = v; rebuild(); })),
    row('나머지', ...colorInput(() => o.dotColor, v => { o.dotColor = v; rebuild(); })),
  );
}

/* ----- 레이어 패널 ----- */
const KIND_ICON = { framepic: '🖼', cutout: '✂', deco: '❝', text: 'T', brand: 'Aa', image: '🖼', frame: '◉', gradient: '▤', logo: '★', dots: '•••', divider: '—', shape: '■' };
let layerDragFrom = null;
let lastLayerClick = null;   // Shift 범위 선택의 기준
function renderLayers() {
  const el = $('#layers');
  if (!el || !canvas) return;
  el.innerHTML = '';
  const objs = canvas.getObjects();
  const active = new Set(canvas.getActiveObjects());
  // 표시 순서: 위(앞)부터. 프레임 안의 사진은 그 프레임 바로 아래에 들여써서
  const frameUids = new Set(objs.filter(o => o.kind === 'frame').map(o => o.uid));
  const rows = [];
  for (let i = objs.length - 1; i >= 0; i--) {
    const o = objs[i];
    if (o.frameId && frameUids.has(o.frameId)) continue;
    rows.push([o, i, false]);
    if (o.kind === 'frame') {
      for (let j = objs.length - 1; j >= 0; j--) if (objs[j].frameId === o.uid) rows.push([objs[j], j, true]);
    }
  }
  for (const [o, i, isChild] of rows) {
    const name = o.layerName || (o.type === 'i-text' ? o.text.replace(/\n/g, ' ').slice(0, 20) : o.type);
    const eye = h('button', { class: 'tg' + (o.visible !== false ? ' on' : ''), title: '보이기/숨기기' }, o.visible !== false ? '👁' : '◌');
    const lock = h('button', { class: 'tg' + (o.lockedLayer ? ' on' : ''), title: '잠금' }, o.lockedLayer ? '🔒' : '🔓');
    const nm = h('span', { class: 'nm', title: '더블클릭: 이름 바꾸기' }, name);
    const modeMark = isChild && o.clipMode && o.clipMode !== 'inside' ? h('span', { class: 'ic', title: o.clipMode === 'popout' ? '위로 튀어나오기' : '자르지 않기' }, o.clipMode === 'popout' ? '⤴' : '⤢') : null;
    const item = h('div', { class: 'layer' + (isChild ? ' child' : '') + (active.has(o) ? ' sel' : '') + (o.visible === false ? ' hidden' : ''), draggable: 'true' },
      eye, lock, isChild ? h('span', { class: 'tree' }, '└') : null, h('span', { class: 'ic' }, KIND_ICON[o.kind] || '◇'), nm, modeMark);
    eye.addEventListener('click', e => {
      e.stopPropagation();
      o.visible = o.visible === false;
      if (o.kind === 'frame') frameKids(canvas, o).forEach(k => { k.visible = o.visible; });   // 원과 안의 사진 함께
      if (!o.visible && active.has(o)) canvas.discardActiveObject();
      canvas.requestRenderAll(); commit(); renderLayers();
    });
    lock.addEventListener('click', e => {
      e.stopPropagation();
      o.lockedLayer = !o.lockedLayer; applyLock(o);
      if (o.lockedLayer && active.has(o)) canvas.discardActiveObject();
      canvas.requestRenderAll(); commit(); renderLayers();
    });
    // 클릭: 하나 선택 / Shift+클릭: 마지막으로 누른 레이어부터 여기까지 범위 선택 / Ctrl+클릭: 하나씩 추가·빼기
    item.addEventListener('click', e => {
      if (o.visible === false) return;
      exitFrameEdit(); exitCrop();
      let sel;
      const order = rows.map(r => r[0]);
      if (e.shiftKey && lastLayerClick && order.includes(lastLayerClick)) {
        const a = order.indexOf(lastLayerClick), b = order.indexOf(o);
        sel = order.slice(Math.min(a, b), Math.max(a, b) + 1);
      } else if (e.ctrlKey || e.metaKey) {
        const cur = new Set(canvas.getActiveObjects());
        if (cur.has(o)) cur.delete(o); else cur.add(o);
        sel = [...cur];
        lastLayerClick = o;
      } else {
        sel = [o];
        lastLayerClick = o;
      }
      // 여러 개 고를 때는 숨김·잠금 레이어 제외 (하나만 고를 땐 잠긴 것도 선택해서 속성 편집 가능)
      if (sel.length > 1) sel = sel.filter(x => x.visible !== false && !x.lockedLayer);
      canvas.discardActiveObject();
      if (sel.length === 1) canvas.setActiveObject(sel[0]);
      else if (sel.length > 1) canvas.setActiveObject(new fabric.ActiveSelection(sel, { canvas }));
      canvas.requestRenderAll();
      renderLayers(); renderProps();
    });
    nm.addEventListener('dblclick', e => {
      e.stopPropagation();
      const inp = h('input', { type: 'text', value: o.layerName || '' });
      nm.replaceWith(inp); inp.focus(); inp.select();
      const done = () => { o.layerName = inp.value || o.layerName; commit(); renderLayers(); renderProps(); };
      inp.addEventListener('blur', done);
      inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') { inp.value = o.layerName; inp.blur(); } });
    });
    item.addEventListener('dragstart', e => { layerDragFrom = i; e.dataTransfer.effectAllowed = 'move'; });
    item.addEventListener('dragover', e => { if (layerDragFrom == null) return; e.preventDefault(); item.classList.add('drag-over'); });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', e => {
      e.preventDefault(); item.classList.remove('drag-over');
      if (layerDragFrom == null || layerDragFrom === i) return;
      const ob = objs[layerDragFrom];
      layerDragFrom = null;
      // 사진을 원형 사진(프레임) 줄에 떨구면 → 그 원 안에 넣기
      if (o.kind === 'frame' && ob.type === 'image' && ob.kind !== 'logo' && ob.frameId !== o.uid) {
        ob.frameId = o.uid; ob.clipMode = 'inside'; ob._clipSig = null;
        if (ob.kind === 'image') ob.kind = 'framepic';
        restackFrames(canvas);
        canvas.requestRenderAll(); commit(); renderLayers(); renderProps();
        toast('원 안에 넣었어요');
        return;
      }
      // 목록은 위가 앞(높은 index). 드롭한 항목 위로 올리기
      const to = objs.indexOf(ob) < i ? i : i + 1;
      canvas.moveTo(ob, Math.min(to, objs.length - 1));
      restackFrames(canvas);
      canvas.requestRenderAll(); commit(); renderLayers();
    });
    el.append(item);
  }
  if (!objs.length) el.append(h('p', { class: 'hint', style: 'padding:8px' }, '레이어가 없어요. 왼쪽 도구로 추가하세요.'));
}
