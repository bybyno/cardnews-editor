'use strict';
/* ===== 시작 & UI 연결 ===== */

function isTyping(e) {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
    // fabric 텍스트 편집용 숨은 textarea는 제외
    return !(canvas && canvas.getActiveObject() && canvas.getActiveObject().hiddenTextarea === t);
  }
  return false;
}
const isEditingText = () => { const o = canvas.getActiveObject(); return !!(o && o.isEditing); };
const anyModalOpen = () => !!$('.modal.open');
// index.html 안의 js/css 버전(?v=수정시각) 목록 — 서버의 최신 버전과 비교용
const scriptVersions = html => (html.match(/(?:js|css)\/[a-z]+\.(?:js|css)\?v=\d+/g) || []).sort().join('|');

function bindUI() {
  // 상단
  $('#btnImport').onclick = openImport;
  $('#btnNew').onclick = newProject;
  $('#btnOpen').onclick = openProjectsModal;
  $('#btnSaveFile').onclick = () => saveNamedProject(false);
  $('#projName').onclick = () => saveNamedProject(true);   // 다른 이름으로 저장
  $('#projOpenFolder').onclick = () => fetch('/api/project-list').then(r => r.json()).then(d => fetch('/api/open-folder?abs=' + encodeURIComponent(d.folder)))
    .catch(() => toast('폴더를 열지 못했어요'));
  $('#projFromFile').onclick = openProjectFile;
  // 공유함 (구글 드라이브)
  $('#btnHubUpload').onclick = openHubUpload;
  $('#hubUpGo').onclick = doHubUpload;
  $('#btnHubInbox').onclick = openHubInbox;
  $('#hubInRefresh').onclick = openHubInbox;
  $('#btnUndo').onclick = undo;
  $('#btnRedo').onclick = redo;
  $('#btnZoomIn').onclick = () => setZoom(state.zoom * 1.15);
  $('#btnZoomOut').onclick = () => setZoom(state.zoom / 1.15);
  $('#btnZoomFit').onclick = zoomFit;
  $('#btnSettings').onclick = openSettings;
  $('#btnCaption').onclick = () => { $('#captionText').value = state.project.caption || ''; openModal('captionModal'); };
  $('#btnExportOne').onclick = exportCurrent;
  $('#btnExportAll').onclick = exportAll;
  $('#btnOpenExport').onclick = () => {
    const p = state.lastExportPath || state.settings.exportDir;
    if (!p) return toast('저장 폴더가 없어요 (⚙ 설정)');
    fetch('/api/open-folder?abs=' + encodeURIComponent(p)).then(r => r.ok || toast('폴더를 열지 못했어요'));
  };
  $('#exportFormat').value = state.settings.exportFormat || 'jpeg';
  $('#exportFormat').onchange = () => { state.settings.exportFormat = $('#exportFormat').value; saveSettings(); };

  // 슬라이드 추가
  $('#btnAddSlide').onclick = () => openModal('addSlideModal');
  $$('#addSlideModal [data-tpl]').forEach(b => b.onclick = async () => {
    closeModal('addSlideModal');
    busy(true, '슬라이드 만드는 중…');
    try { await addSlide(b.dataset.tpl); } finally { busy(false); }
  });

  // 도구
  $$('#toolbar [data-tool]').forEach(b => b.onclick = () => useTool(b.dataset.tool));

  // 카드 밖 이미지 보이기/숨기기
  const outsideBtn = $('#btnOutside');
  const syncOutside = () => outsideBtn.classList.toggle('on', state.settings.showOutside !== false);
  syncOutside();
  outsideBtn.onclick = () => {
    state.settings.showOutside = state.settings.showOutside === false;
    syncOutside(); saveSettings(); canvas.requestRenderAll();
    toast(state.settings.showOutside ? '카드 밖 이미지를 희미하게 보여줘요' : '카드 밖 이미지를 숨겼어요');
  };

  // 선택 레이어만 이동 스위치
  const lockBtn = $('#btnLockSel');
  const syncLock = () => lockBtn.classList.toggle('on', !!state.settings.lockToSelected);
  syncLock();
  lockBtn.onclick = () => {
    state.settings.lockToSelected = !state.settings.lockToSelected;
    syncLock(); saveSettings();
    toast(state.settings.lockToSelected
      ? '켜짐: 선택한 레이어는 어디를 드래그해도 그것만 움직여요 (다른 레이어는 레이어 목록 또는 Ctrl+클릭으로 선택)'
      : '꺼짐: 클릭한 곳의 맨 위 이미지를 잡아요', 4500);
  };

  // 레이어 버튼
  $('#lyUp').onclick = () => arrange('up');
  $('#lyDown').onclick = () => arrange('down');
  $('#lyDup').onclick = duplicateSelection;
  $('#lyDel').onclick = deleteSelection;

  // 모달 공통
  $$('.modal').forEach(m => {
    m.addEventListener('mousedown', e => { if (e.target === m) m.classList.remove('open'); });
    $$('[data-close]', m).forEach(b => b.onclick = () => m.classList.remove('open'));
  });

  // 가져오기 모달
  const drop = $('#impDrop');
  drop.onclick = async () => addImpFiles(await pickFiles(undefined, true));
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove('over')));
  // stopPropagation: 바깥 모달의 drop 처리기까지 올라가서 같은 파일이 두 번 들어가는 것 방지
  drop.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); addImpFiles([...e.dataTransfer.files]); });
  $('#importModal').addEventListener('dragover', e => e.preventDefault());
  $('#importModal').addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer.files.length) addImpFiles([...e.dataTransfer.files]); });
  $('#impGo').onclick = runImport;
  $('#impFetch').onclick = fetchIgByLink;
  $('#impUrl').addEventListener('keydown', e => { if (e.key === 'Enter') fetchIgByLink(); });
  const bm = $('#igBookmarklet');
  bm.href = bookmarkletCode();
  bm.addEventListener('click', e => { e.preventDefault(); toast('이 버튼을 브라우저 북마크바로 끌어다 놓으세요 (Ctrl+Shift+B로 북마크바 표시)', 4500); });
  // 북마크 버튼이 이미 열린 편집기 탭을 다시 쓰면 페이지가 새로고침되지 않아 예전 코드로 카드가 만들어짐
  // → 저장 후 새로고침해서 최신 코드로 처리 (주소의 #ig=… 는 그대로 남아 시작 시 처리됨)
  window.addEventListener('hashchange', async () => {
    if (!location.hash.startsWith('#ig=')) return;
    try { leaveCurrent(); await saveProjectToDB(); } catch (e) { /* 저장 실패해도 진행 */ }
    location.reload();
  });
  // 다른 창에 갔다 돌아왔을 때 편집기 파일이 새로 바뀌었으면 알려줌
  const loadedBuild = scriptVersions(document.documentElement.innerHTML);
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const html = await (await fetch('/', { cache: 'no-store' })).text();
      if (scriptVersions(html) !== loadedBuild) toast('편집기가 업데이트됐어요. F5를 눌러 새로고침하면 적용돼요 (작업은 저장돼 있어요)', 8000);
    } catch (e) { /* 서버 없음 */ }
  });

  // 설정 모달
  $('#setAccent').oninput = () => { $('#setAccentHex').value = $('#setAccent').value; };
  $('#setAccentHex').onchange = () => { $('#setAccent').value = toHex($('#setAccentHex').value); };
  $('#setLogoBtn').onclick = async () => {
    const [f] = await pickFiles();
    if (!f) return;
    pendingLogo = await fileToDataURL(f, 800);
    $('#setLogoPreview').src = pendingLogo;
  };
  $('#setLogoReset').onclick = () => { pendingLogo = null; $('#setLogoPreview').src = DEFAULT_LOGO; };
  $('#setFontBtn').onclick = addCustomFont;
  $('#setPromptReset').onclick = () => { $('#setPrompt').value = DEFAULT_PROMPT; };
  $('#setSave').onclick = applySettings;
  $('#shareMake').onclick = makeSharePackage;
  $('#btnUpdate').onclick = applyUpdate;
  $('#verCheck').onclick = () => checkForUpdate(true);
  $('#btnHelp').onclick = () => window.open('사용설명서.html', '_blank');

  // 캡션
  $('#captionText').addEventListener('input', () => { state.project.caption = $('#captionText').value; scheduleAutosave(); });
  $('#captionCopy').onclick = async () => {
    try { await navigator.clipboard.writeText($('#captionText').value); toast('캡션을 복사했어요'); }
    catch { $('#captionText').select(); document.execCommand('copy'); toast('캡션을 복사했어요'); }
  };

  // 스테이지: 드래그&드롭, Ctrl+휠 확대
  const stage = $('#stage');
  stage.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); stage.classList.add('drop-hover'); } });
  stage.addEventListener('dragleave', e => { if (e.target === stage) stage.classList.remove('drop-hover'); });
  stage.addEventListener('drop', e => {
    stage.classList.remove('drop-hover');
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    const inCanvas = e.target.tagName === 'CANVAS';
    addImageFilesAt([...e.dataTransfer.files], inCanvas ? e : null);
  });
  stage.addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom(state.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, { passive: false });
  stage.addEventListener('mousedown', e => {
    if (e.target === stage || e.target === $('#canvasWrap')) { exitFrameEdit(); canvas.discardActiveObject(); canvas.requestRenderAll(); }
  });
  window.addEventListener('resize', () => { if (state.fitMode) zoomFit(); else layoutCanvas(); });

  // 클립보드 이미지 붙여넣기
  document.addEventListener('paste', e => {
    const files = [...(e.clipboardData && e.clipboardData.files || [])].filter(isImageFile);
    if (!files.length) return;
    if ($('#importModal').classList.contains('open')) { e.preventDefault(); addImpFiles(files); return; }
    if (anyModalOpen() || isTyping(e) || isEditingText()) return;
    e.preventDefault();
    addImageFilesAt(files, null);
  });

  // 단축키
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (anyModalOpen()) {
        // 창이 겹쳐 있으면 맨 위 창(합치기 위의 검색 창 등)만 닫기
        const open = $$('.modal.open');
        (open.find(m => m.classList.contains('top')) || open[open.length - 1]).classList.remove('open');
        return;
      }
      if (cropTarget) { exitCrop(); return; }
      if (frameEdit) { exitFrameEdit(); renderProps(); return; }
      // 선택 해제 ('선택 레이어만 이동'이 켜져 있으면 빈 곳 클릭으로는 해제가 안 되니까)
      if (!isTyping(e) && !isEditingText() && canvas.getActiveObject()) { canvas.discardActiveObject(); canvas.requestRenderAll(); return; }
    }
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    // 속성/레이어 패널(슬라이더·숫자·색·선택 상자 등)에 포커스가 있어도 Ctrl+Z / Ctrl+Y는 편집기 실행 취소로
    // (글자 입력칸은 글자 단위 되돌리기를 위해 브라우저 기본 동작 유지)
    if (ctrl && (k === 'z' || k === 'y') && !anyModalOpen() && !isEditingText()) {
      const t = e.target;
      const inPanel = t && t.closest && t.closest('.right-panel');
      const textField = t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t.type === 'text' || t.type === 'password'));
      if (inPanel && !textField) {
        e.preventDefault();
        t.blur();
        if (k === 'y' || e.shiftKey) redo(); else undo();
        return;
      }
    }
    if (anyModalOpen() || isTyping(e) || isEditingText()) return;
    if (e.key === 'Enter' && cropTarget) { e.preventDefault(); exitCrop(); return; }
    if (ctrl && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (ctrl && k === 'c') { if (canvas.getActiveObject()) { e.preventDefault(); copySelection(); } }
    else if (ctrl && k === 'v') { if (state.clipboard) { e.preventDefault(); pasteClipboard(); } }
    else if (ctrl && k === 'd') { e.preventDefault(); duplicateSelection(); }
    else if (ctrl && k === 's') { e.preventDefault(); saveNamedProject(e.shiftKey); }   // Ctrl+Shift+S: 다른 이름으로
    else if (ctrl && k === 'a') { e.preventDefault(); const objs = canvas.getObjects().filter(o => o.selectable && o.visible !== false); if (objs.length) { canvas.setActiveObject(new fabric.ActiveSelection(objs, { canvas })); canvas.requestRenderAll(); } }
    else if (ctrl && e.key === ']') { e.preventDefault(); arrange(e.shiftKey ? 'top' : 'up'); }
    else if (ctrl && e.key === '[') { e.preventDefault(); arrange(e.shiftKey ? 'bottom' : 'down'); }
    else if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom(state.zoom * 1.15); }
    else if (ctrl && e.key === '-') { e.preventDefault(); setZoom(state.zoom / 1.15); }
    else if (ctrl && e.key === '0') { e.preventDefault(); zoomFit(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (canvas.getActiveObject()) { e.preventDefault(); deleteSelection(); } }
    else if (e.key.startsWith('Arrow') && canvas.getActiveObject()) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      nudge(e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0);
    }
    else if (e.key === 'PageDown') { e.preventDefault(); switchSlide(state.current + 1); }
    else if (e.key === 'PageUp') { e.preventDefault(); switchSlide(state.current - 1); }
  });
}

(async function boot() {
  busy(true, '불러오는 중…');
  try {
    if (typeof fabric === 'undefined') throw new Error('편집 라이브러리를 불러오지 못했어요. 인터넷 연결을 확인하세요.');
    await DB.open().catch(e => console.warn('IndexedDB 사용 불가', e));
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    const saved = await DB.get('settings').catch(() => null);
    state.settings = Object.assign(defaultSettings(), saved || {});
    // 예전 기본 지시문(4~8장)을 저장해둔 경우 → 원본 카드 수를 따르도록 그 줄만 교체
    const OLD_COUNT_LINE = '- 총 4~8장. 마지막 장은 여운이 남는 한 줄이나 질문으로 마무리.';
    if (state.settings.prompt && state.settings.prompt.includes(OLD_COUNT_LINE)) {
      state.settings.prompt = state.settings.prompt.replace(OLD_COUNT_LINE,
        '- 카드 수는 원본 게시물의 카드(사진) 수와 같게. 원본 1장 = 카드뉴스 1장. 원문에 없는 설명이나 마무리 장을 덧붙이지 않는다.');
      saveSettings();
    }
    // 예전 기본 지시문의 문체 줄 → '~니다' 합쇼체 규칙으로
    const OLD_TONE_LINE = '- 문체: 짧고 단정한 뉴스체. "~했다", "~예정이다", "~라고 합니다", "~예상됩니다"를 자연스럽게 섞는다.';
    if (state.settings.prompt && state.settings.prompt.includes(OLD_TONE_LINE)) {
      state.settings.prompt = state.settings.prompt.replace(OLD_TONE_LINE,
        '- 문체: 본문(body)의 모든 문장은 "~니다/~습니다"로 끝나는 합쇼체 (예: ~했습니다, ~예정입니다, ~라고 합니다, ~예상됩니다). "~했다", "~이다" 같은 반말 끝맺음 금지. 커버는 짧은 후킹 문장.');
      saveSettings();
    }
    await applySharedConfig();   // 공유받은 편집기면 공유자의 키 채우기
    await loadHubConfig();       // 내 편집기면 공유함 관리자 설정
    await registerCustomFonts();
    await preloadFonts();
    await loadTexture('marble').catch(() => {});
    PLACEHOLDER = makePlaceholder();
    DEFAULT_LOGO = await makeDefaultLogo();

    initCanvas();
    bindUI();
    bindSearchUI();
    bindMergeUI();

    const proj = await DB.get('project').catch(() => null);
    if (proj && proj.slides && proj.slides.length) {
      state.project = { name: proj.name || '', caption: proj.caption || '', sourceUrl: proj.sourceUrl || '', sourceText: proj.sourceText || '', slides: proj.slides, lensCache: proj.lensCache || {} };
      state.current = clamp(proj.current || 0, 0, proj.slides.length - 1);
      setCardHeight(proj.cardH || BASE_H);
    } else {
      state.project = await sampleProject();
      state.current = 0;
    }
    // 로고를 새 기본 로고(assets/logo.png)로 한 번 교체 — 기존 슬라이드 포함
    if ((state.settings.logoVersion || 1) < 2) {
      state.settings.logo = null;
      await replaceLogoInSlides(DEFAULT_LOGO);
      state.settings.logoVersion = 2;
      saveSettings();
      scheduleAutosave();
    }
    await loadSlideToCanvas(state.current);
    pushHistory();
    zoomFit();
    renderAll();
    ensureThumbs();
    $('#saveState').textContent = '자동 저장됨';
    updateProjName();
    syncHubButtons();
    await checkProxy();
    checkForUpdate();   // 새 버전이 있으면 상단에 '업데이트 하기' 버튼
    handleIgHash();   // 북마크 버튼으로 열렸으면 인스타 게시물 받기
  } catch (e) {
    console.error(e);
    toast('시작 오류: ' + e.message, 8000);
  } finally {
    busy(false);
  }
})();
