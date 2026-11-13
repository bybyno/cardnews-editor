'use strict';
/* ===== 가져오기(AI/수동), 내보내기, 프로젝트 파일, 설정 ===== */

function openModal(id) { $('#' + id).classList.add('open'); }
function closeModal(id) { $('#' + id).classList.remove('open'); }

/* ----- 포스트 가져오기 ----- */
const imp = { images: [], inset: null, dragFrom: null };

function openImport() {
  $('#impStatus').textContent = '';
  $('#impStatus').classList.remove('err');
  renderImpThumbs();
  $('#impCount').value = state.settings.slideCount || 'same';
  const st = state.settings;
  const can = !!(st.serpApiKey || (st.tmdbKey && st.apiKey));
  $('#impAutoLens').checked = can && st.autoLens !== false;
  $('#impAutoReplace').checked = can && st.autoLensReplace !== false;   // 기본: 켜짐
  $('#impAutoLens').disabled = $('#impAutoReplace').disabled = !can;
  $('#impAutoNote').textContent = !can ? '설정에 SerpApi 키(또는 TMDB+Claude 키)를 넣으면 쓸 수 있어요'
    : st.apiKey ? '사진 1장당 SerpApi 검색 1회 + Claude가 글씨 없는 사진 고르기'
    : 'Claude 키가 없으면 가장 비슷한 큰 사진으로 교체 (글씨 여부는 판단 못 함)';
  openModal('importModal');
  setTimeout(() => $('#impText').focus(), 50);
}
async function addImpFiles(files) {
  const imgs = files.filter(isImageFile);
  if (!imgs.length) return;
  $('#impStatus').textContent = `이미지 ${imgs.length}장 불러오는 중… (HEIC는 변환에 몇 초 걸려요)`;
  for (const f of imgs) {
    try {
      const src = await fileToDataURL(f);
      if (!imp.images.includes(src)) imp.images.push(src);   // 같은 이미지 중복 추가 방지
      renderImpThumbs();
    } catch (e) { console.error(e); toast(`${f.name}: ${e.message}`); }
  }
  $('#impStatus').textContent = '';
}
function renderImpThumbs() {
  const box = $('#impThumbs');
  box.innerHTML = '';
  imp.images.forEach((src, i) => {
    const t = h('div', { class: 'imp-thumb' + (imp.inset === i ? ' inset' : ''), draggable: 'true' },
      h('img', { src }), h('span', { class: 'n' }, i + 1),
      h('button', { class: 'star', title: '커버 원형 인물사진으로 사용', onclick: () => { imp.inset = imp.inset === i ? null : i; renderImpThumbs(); } }, '★'),
      h('button', { class: 'x', title: '빼기', onclick: () => {
        imp.images.splice(i, 1);
        if (imp.inset === i) imp.inset = null; else if (imp.inset > i) imp.inset--;
        renderImpThumbs();
      } }, '✕'));
    t.addEventListener('dragstart', () => { imp.dragFrom = i; });
    t.addEventListener('dragover', e => { if (imp.dragFrom != null) e.preventDefault(); });
    t.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation();
      if (imp.dragFrom == null || imp.dragFrom === i) return;
      const insetSrc = imp.inset != null ? imp.images[imp.inset] : null;
      const [m] = imp.images.splice(imp.dragFrom, 1);
      imp.images.splice(i, 0, m);
      imp.inset = insetSrc ? imp.images.indexOf(insetSrc) : null;
      imp.dragFrom = null;
      renderImpThumbs();
    });
    box.append(t);
  });
}

/* ----- 인스타 게시물 → 사진·캡션 자동 불러오기 ----- */
// 인스타 화면(로그인 상태)에서 실행되는 북마크 버튼 코드: 게시물 정보를 읽어 편집기로 보냄
function bookmarkletCode() {
  const app = location.origin;
  const src = `(async()=>{try{
const m=location.pathname.match(/\\/(?:p|reel|reels|tv)\\/([A-Za-z0-9_-]+)/);
if(!m){alert('인스타 게시물 화면에서 눌러주세요');return;}
const code=m[1],A='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';let id=0n;
for(const c of code.slice(0,11))id=id*64n+BigInt(A.indexOf(c));
const r=await fetch('/api/v1/media/'+id+'/info/',{headers:{'X-IG-App-ID':'936619743392459'},credentials:'include'});
if(!r.ok)throw new Error('인스타 응답 '+r.status+' (로그인 상태인지 확인)');
const it=(await r.json()).items[0];
const pick=x=>{const c=((x.image_versions2||{}).candidates||[]).slice().sort((a,b)=>b.width-a.width);return c[0]&&c[0].url;};
const media=(it.carousel_media||[it]).map(x=>({url:pick(x),video:x.media_type===2})).filter(x=>x.url);
const d={code,user:(it.user||{}).username||'',caption:(it.caption||{}).text||'',media,link:'https://www.instagram.com/p/'+code+'/'};
const e=btoa(unescape(encodeURIComponent(JSON.stringify(d)))).replace(/\\+/g,'-').replace(/\\//g,'_');
window.open('${app}/#ig='+e,'cardnews');
}catch(err){alert('카드뉴스로 보내기 실패: '+err.message)}})();`;
  return 'javascript:' + encodeURIComponent(src.replace(/\n/g, ''));
}
async function loadIgResult(res) {
  const st = $('#impStatus');
  st.classList.remove('err');
  st.textContent = `사진 ${res.files.length}장 불러오는 중…`;
  imp.images = []; imp.inset = null;
  for (const f of res.files) {
    try {
      const b = await (await fetch(f)).blob();
      imp.images.push(await fileToDataURL(new File([b], f.split('/').pop(), { type: b.type })));
      renderImpThumbs();
    } catch (e) { console.warn(e); }
  }
  if (res.caption) $('#impText').value = res.caption;
  if (res.link) $('#impUrl').value = res.link;
  st.innerHTML = '';
  st.append(`✅ @${res.user || '게시물'} — 사진 ${imp.images.length}장과 캡션을 불러왔어요. 저장 폴더: 받은 포스트\\${res.folder} `,
    h('a', { onclick: () => fetch('/api/open-folder?path=' + encodeURIComponent(res.folder)) }, '[폴더 열기]'));
}
async function fetchIgByLink() {
  const url = $('#impUrl').value.trim();
  const st = $('#impStatus');
  st.classList.remove('err');
  if (!PROXY_OK) { st.textContent = 'start.bat으로 편집기를 실행해야 쓸 수 있어요.'; st.classList.add('err'); return; }
  if (!/instagram\.com\/(?:[^/?#]+\/)?(?:p|reel|reels|tv)\//.test(url)) { st.textContent = '인스타 게시물 링크를 넣어주세요 (instagram.com/p/...)'; st.classList.add('err'); return; }
  st.textContent = '인스타에서 게시물 읽는 중…';
  $('#impFetch').disabled = true;
  try {
    const r = await fetch('/api/ig-fetch?url=' + encodeURIComponent(url));
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || r.status);
    await loadIgResult(d);
  } catch (e) {
    st.textContent = e.message; st.classList.add('err');
  } finally { $('#impFetch').disabled = false; }
}
// 북마크 버튼이 편집기를 '#ig=...' 주소로 열면 처리
async function handleIgHash() {
  if (!location.hash.startsWith('#ig=')) return;
  const enc = location.hash.slice(4);
  history.replaceState(null, '', location.pathname);
  try {
    const json = decodeURIComponent(escape(atob(enc.replace(/-/g, '+').replace(/_/g, '/'))));
    openImport();
    $('#impStatus').textContent = '인스타 게시물 사진 내려받는 중…';
    const r = await fetch('/api/ig-save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || r.status);
    await loadIgResult(d);
  } catch (e) {
    $('#impStatus').textContent = SERVER_OLD
      ? '인스타 게시물을 받지 못했어요: 편집기 서버가 예전 버전이에요. start.bat 검은 창을 닫고 다시 실행한 뒤, 인스타에서 북마크를 다시 눌러주세요.'
      : '인스타 게시물을 받지 못했어요: ' + e.message;
    $('#impStatus').classList.add('err');
  }
}

function manualPlan(text, n) {
  const paras = text.replace(/\r/g, '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  // 문단이 없으면 이미지 한 장당 슬라이드 한 장
  const count = paras.length || Math.max(1, n);
  const out = Array.from({ length: count }, (_, i) => {
    const p = paras[i] || '';
    // 인용 문단: 따옴표로 시작하거나, 마지막 줄이 '-이름'이면 인용형 카드로
    const lines = p.split('\n');
    const last = lines[lines.length - 1].trim();
    if (i > 0 && lines.length > 1 && /^[-–—]\s*\S/.test(last)) {
      const text = lines.slice(0, -1).join('\n').replace(/^\s*["“”']+|["“”']+\s*$/g, '');
      return { type: 'quote', text, speaker: last.replace(/^[-–—]\s*/, ''), image: n ? i % n : null, inset: null };
    }
    return { type: i === 0 ? 'cover' : 'body', text: p || (i === 0 ? '' : '내용을 *입력*하세요'), image: n ? i % n : null, inset: null };
  });
  return { slides: out, caption: '' };
}

async function downscaleForAI(src, max = 1024) {
  const img = await loadHtmlImage(src);
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85).split(',')[1];
}

// 만들 카드 수: '원본과 같게'면 원본 게시물 사진 수 (사진이 없으면 자동)
function targetSlideCount(nImages) {
  const v = $('#impCount') ? $('#impCount').value : 'same';
  if (v === 'auto') return 0;
  if (v === 'same') return nImages || 0;
  return parseInt(v, 10) || 0;
}
async function callClaude(text, images, url, count) {
  const st = state.settings;
  if (!st.apiKey) throw new Error('설정(⚙)에서 Claude API 키를 먼저 넣어주세요. 키 없이 쓰려면 "수동" 모드를 고르세요.');
  const content = [];
  for (let i = 0; i < Math.min(images.length, 10); i++) {
    content.push({ type: 'text', text: `[이미지 ${i}]` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await downscaleForAI(images[i]) } });
  }
  content.push({ type: 'text', text:
    `아래 해외 인스타그램 게시물을 한국어 카드뉴스로 만들어줘.\n사용 가능한 이미지: ${images.length}장 (번호 0~${Math.max(0, images.length - 1)})${images.length ? '' : ' — 이미지 없음, image는 null'}\n` +
    (url ? `게시물 링크: ${url}\n` : '') +
    (count
      ? `\n[카드 수 — 가장 중요] 반드시 정확히 ${count}장만 만든다 (커버 포함). 원본 게시물의 카드 구성을 그대로 따라 원본 1장 = 카드뉴스 1장으로 옮긴다. 원문에 없는 설명·배경지식·마무리 장을 덧붙여 장수를 늘리지 않는다. 내용이 많으면 줄여서 요약한다.\n`
      : `\n[카드 수] 원본 내용에 꼭 필요한 만큼만 (보통 3~6장). 불필요한 장을 덧붙이지 않는다.\n`) +
    `\n[카드 종류] cover(첫 장) / body(일반 본문) / quote(인물의 발언을 그대로 옮기는 장 — text에는 따옴표 없이 발언만, "speaker"에 말한 사람 한국어 이름, 예: {"type":"quote","text":"저도 출연하고 싶습니다\\n*하지만 그럴 계획은*\\n*없는 것 같아요*","speaker":"킷 해링턴","image":1}). 본문은 한 줄 15자 안팎, 2~3줄.\n` +
    `\n[말투 — 꼭 지킬 것] body 카드의 문장은 전부 "~니다/~습니다"로 끝낸다 (예: ~했습니다, ~예정입니다, ~라고 합니다). "~했다/~이다/~한다" 끝맺음 금지. quote는 말한 사람의 말투 그대로.\n` +
    `\n[원문]\n${text || '(캡션 없음 — 이미지 내용을 보고 구성)'}` });
  const plan = await claudeJSON(st.prompt || DEFAULT_PROMPT, content, 4000);
  if (!Array.isArray(plan.slides) || !plan.slides.length) throw new Error('AI 응답에 슬라이드가 없어요');
  // 그래도 많이 만들었으면 지정한 장수로 자름 (커버는 유지)
  if (count && plan.slides.length > count) plan.slides = plan.slides.slice(0, count);
  return plan;
}

/* Claude 호출 → 응답 속 JSON 객체 반환 */
async function claudeJSON(system, content, maxTokens = 2000) {
  const st = state.settings;
  if (!st.apiKey) throw new Error('설정(⚙)에서 Claude API 키를 먼저 넣어주세요.');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': st.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: st.model || 'claude-sonnet-5-5', max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Claude API 오류 (${res.status}): ${(data.error && data.error.message) || res.statusText}`);
  const out = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI 응답에서 JSON을 찾지 못했어요:\n' + out.slice(0, 300));
  return JSON.parse(m[0]);
}

async function runImport() {
  const text = $('#impText').value.trim();
  const url = $('#impUrl').value.trim();
  const imgs = imp.images.slice();
  const mode = $$('input[name=impMode]').find(r => r.checked).value;
  const replace = $('#impReplace').checked;
  if (!text && !imgs.length) { toast('캡션이나 이미지를 넣어주세요'); return; }
  const status = $('#impStatus');
  status.classList.remove('err');
  $('#impGo').disabled = true;
  try {
    let plan;
    if (mode === 'ai') {
      status.textContent = 'Claude가 번역·요약해서 카드뉴스를 구성하는 중… (보통 10~40초)';
      state.settings.slideCount = $('#impCount').value; saveSettings();
      plan = await callClaude(text, imgs, url, targetSlideCount(imgs.length));
    } else {
      plan = manualPlan(text, imgs.length);
    }
    if (imp.inset != null && plan.slides[0]) plan.slides[0].inset = imp.inset;
    status.textContent = '슬라이드 만드는 중…';
    const n = imgs.length;
    const pick = (v, i) => (Number.isInteger(v) && v >= 0 && v < n) ? imgs[v] : (n ? imgs[i % n] : null);
    const built = [];
    for (let i = 0; i < plan.slides.length; i++) {
      const s = plan.slides[i];
      const type = ['cover', 'body', 'quote', 'photo', 'white'].includes(s.type) ? s.type : (i === 0 ? 'cover' : 'body');
      const inset = Number.isInteger(s.inset) && s.inset >= 0 && s.inset < n ? imgs[s.inset] : null;
      built.push({ id: uid(), json: await buildSlideJSON(type, { image: pick(s.image, i), inset, text: s.text, speaker: s.speaker, total: plan.slides.length }) });
    }
    leaveCurrent();
    if (replace) {
      state.project.slides = built;
      state.current = 0;
      state.project.caption = plan.caption || state.project.caption || '';
      state.project.name = '';   // 새 게시물 → 새 프로젝트 (저장할 때 이름 정하기)
      state.project.lensCache = {};
      updateProjName();
    } else {
      const at = slides().length;
      state.project.slides.push(...built);
      state.current = at;
      if (plan.caption) state.project.caption = (state.project.caption ? state.project.caption + '\n\n' : '') + plan.caption;
    }
    if (url) state.project.sourceUrl = url;
    if (text) state.project.sourceText = text;   // 이미지 검색 키워드 추출에 사용
    await loadSlideToCanvas(state.current);
    pushHistory();
    renderAll();
    closeModal('importModal');
    scheduleAutosave();
    toast(plan.caption ? `${built.length}장 완성! 캡션도 만들었어요 (상단 '캡션' 버튼)` : `${built.length}장 완성!`, 4000);
    const enabled = !$('#impAutoLens').disabled;
    const autoReplace = enabled && $('#impAutoReplace').checked;
    const autoLens = enabled && ($('#impAutoLens').checked || autoReplace);
    if (!$('#impAutoLens').disabled) {
      state.settings.autoLens = $('#impAutoLens').checked;
      state.settings.autoLensReplace = $('#impAutoReplace').checked;
      saveSettings();
    }
    await ensureThumbs();
    if (autoLens) runAutoLens(built.map(b => b.id), autoReplace);   // 뒤에서 진행 (편집은 계속 가능)
  } catch (e) {
    console.error(e);
    status.textContent = e.message;
    status.classList.add('err');
  } finally {
    $('#impGo').disabled = false;
  }
}

/* ----- 내보내기 ----- */
async function exportCurrent() {
  const fmt = $('#exportFormat').value;
  busy(true, '이미지 만드는 중…');
  try {
    leaveCurrent();
    const url = await renderSlideImage(state.current, { format: fmt });
    downloadURL(url, `card-${String(state.current + 1).padStart(2, '0')}.${fmt === 'png' ? 'png' : 'jpg'}`);
  } catch (e) { toast('내보내기 실패: ' + e.message); } finally { busy(false); }
}
/* 전체 저장: 저장 폴더\오늘날짜(번호)\01.jpg … (자동 업로드 프로그램의 업로드폴더) — 서버가 없거나 Shift+클릭이면 ZIP */
async function exportAll(e) {
  if (e && e.shiftKey) return exportZip();
  if (!PROXY_OK || SERVER_OLD) {
    toast(SERVER_OLD ? 'start.bat을 다시 실행해야 폴더 저장이 돼요. 이번엔 ZIP으로 받아요.' : '폴더 저장은 start.bat으로 실행해야 돼요. 이번엔 ZIP으로 받아요.', 5000);
    return exportZip();
  }
  const fmt = $('#exportFormat').value;
  const st = state.settings;
  leaveCurrent();
  try {
    const images = [];
    for (let i = 0; i < slides().length; i++) {
      busy(true, `이미지 만드는 중… ${i + 1}/${slides().length}`);
      images.push(await renderSlideImage(i, { format: fmt }));
    }
    busy(true, '폴더에 저장 중…');
    const r = await fetch('/api/save-export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: st.exportDir || '', images, withCaption: !!st.exportWithCaption, caption: state.project.caption || '' }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || r.status);
    state.lastExportPath = d.path;
    toast(`✅ ${d.count}장 저장: ${d.path}${st.exportWithCaption && state.project.caption ? ' (캡션 포함 → 자동 업로드 시작)' : ''}`, 7000);
  } catch (err) {
    console.error(err); toast('저장 실패: ' + err.message, 6000);
  } finally { busy(false); }
}
async function exportZip() {
  const fmt = $('#exportFormat').value;
  const ext = fmt === 'png' ? 'png' : 'jpg';
  leaveCurrent();
  try {
    const zip = new JSZip();
    for (let i = 0; i < slides().length; i++) {
      busy(true, `이미지 만드는 중… ${i + 1}/${slides().length}`);
      const url = await renderSlideImage(i, { format: fmt });
      zip.file(`${String(i + 1).padStart(2, '0')}.${ext}`, url.split(',')[1], { base64: true });
    }
    const p = state.project;
    if (p.caption || p.sourceUrl) zip.file('caption.txt', (p.caption || '') + (p.sourceUrl ? `\n\n출처: ${p.sourceUrl}` : ''));
    busy(true, 'ZIP 압축 중…');
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, `cardnews-${stamp()}.zip`);
  } catch (e) { console.error(e); toast('내보내기 실패: ' + e.message); } finally { busy(false); }
}

/* ----- 프로젝트 폴더 (이름 붙여 저장 · 목록에서 열기) ----- */
function projectData() {
  const p = state.project;
  return {
    app: 'insta-cardnews-editor', version: 1, savedAt: new Date().toISOString(), name: p.name || '', cardH: H,
    settings: { accent: state.settings.accent, brandName: state.settings.brandName, logo: state.settings.logo },
    project: { caption: p.caption || '', sourceUrl: p.sourceUrl || '', sourceText: p.sourceText || '', slides: p.slides.map(s => ({ id: s.id, json: s.json })) },
    thumbs: p.slides.map(s => s.thumb || ''),   // 공유함에서 카드 미리보기로 보여줌
  };
}
/* ----- 공유함 (구글 드라이브 + Apps Script) ----- */
async function hubCall(payload) {
  const url = state.settings.hubUrl;
  if (!url) throw new Error('⚙ 설정에 공유함 주소가 없어요');
  const body = JSON.stringify(payload);
  let r;
  try {
    // text/plain 이면 브라우저가 사전 확인 없이 바로 보냄 (Apps Script 가 받아줌)
    r = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
  } catch (e) {
    if (!PROXY_OK) throw new Error('공유함에 연결하지 못했어요 (인터넷 연결 확인)');
    r = await fetch('/proxy?url=' + encodeURIComponent(url), { method: 'POST', body, headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
  }
  let d;
  try { d = await r.json(); } catch (e) { throw new Error('공유함 응답을 읽지 못했어요 (주소가 맞는지, 배포할 때 "모든 사용자"로 했는지 확인)'); }
  if (d.error) throw new Error(d.error);
  return d;
}
function syncHubButtons() {
  const s = state.settings;
  $('#btnHubUpload').style.display = s.hubUrl && (s.hubKey || s.hubAdminKey) ? '' : 'none';
  $('#btnHubInbox').style.display = s.hubUrl && s.hubAdminKey ? '' : 'none';
}
function hubStrip(box, thumbs, cardH) {
  box.innerHTML = '';
  box.style.setProperty('--r', cardH === 1080 ? '1 / 1' : '4 / 5');
  (thumbs || []).filter(t => /^data:image\/(jpeg|png|webp);base64,/.test(t || '')).forEach(t => box.append(h('img', { src: t, alt: '' })));
}
async function openHubUpload() {
  leaveCurrent();
  busy(true, '미리보기 만드는 중…');
  try { await ensureThumbs(); } finally { busy(false); }
  $('#hubUpDesc').textContent = `'${firstCardTitle()}' · 카드 ${slides().length}장을 공유함에 올려요.`;
  hubStrip($('#hubUpStrip'), slides().map(s => s.thumb), H);
  $('#hubUpStatus').textContent = ''; $('#hubUpStatus').classList.remove('err');
  openModal('hubUpModal');
}
async function doHubUpload() {
  const st = $('#hubUpStatus'), btn = $('#hubUpGo');
  st.classList.remove('err');
  const data = JSON.stringify(projectData());
  if (data.length > 45 * 1048576) { st.textContent = '파일이 너무 커요 (45MB 넘음). 사진이 아주 큰 카드를 줄여주세요.'; st.classList.add('err'); return; }
  btn.disabled = true;
  st.textContent = `올리는 중… (${(data.length / 1048576).toFixed(1)}MB)`;
  try {
    await hubCall({
      action: 'upload', key: state.settings.hubKey || state.settings.hubAdminKey,
      name: firstCardTitle(),
      slides: slides().length, cardH: H, thumbs: slides().slice(0, 6).map(s => s.thumb || ''), data,
    });
    closeModal('hubUpModal');
    toast('📤 공유함에 올렸어요', 4000);
  } catch (e) { st.textContent = '올리지 못했어요: ' + e.message; st.classList.add('err'); } finally { btn.disabled = false; }
}
async function openHubInbox() {
  openModal('hubInModal');
  const st = $('#hubInStatus'), list = $('#hubInList');
  st.classList.remove('err'); st.textContent = '불러오는 중…';
  list.innerHTML = '';
  try {
    const d = await hubCall({ action: 'list', key: state.settings.hubAdminKey });
    st.textContent = d.items.length ? `${d.items.length}개` : '아직 올라온 카드뉴스가 없어요';
    d.items.forEach(it => {
      const dt = new Date(it.createdAt);
      const strip = h('div', { class: 'hub-strip' }); hubStrip(strip, it.thumbs, it.cardH);
      const openBtn = h('button', { class: 'primary' }, '열기');
      const delBtn = h('button', {}, '휴지통으로');
      openBtn.onclick = () => openHubItem(it, openBtn);
      delBtn.onclick = async () => {
        if (!confirm(`'${it.name}'을(를) 구글 드라이브 휴지통으로 옮길까요? (30일 안에 드라이브에서 되살릴 수 있어요)`)) return;
        delBtn.disabled = true;
        try { await hubCall({ action: 'delete', key: state.settings.hubAdminKey, id: it.id }); openHubInbox(); }
        catch (e) { toast('지우지 못했어요: ' + e.message, 5000); delBtn.disabled = false; }
      };
      list.append(h('div', { class: 'hub-item' },
        strip,
        h('div', { class: 'meta' },
          h('div', {}, h('div', { class: 't' }, it.name || '이름 없음'),
            h('div', { class: 'd' }, `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')} · 카드 ${it.slides}장 · ${((it.size || 0) / 1048576).toFixed(1)}MB`)),
          h('div', { class: 'acts' }, openBtn, delBtn))));
    });
  } catch (e) { st.textContent = '목록을 못 불러왔어요: ' + e.message; st.classList.add('err'); }
}
async function openHubItem(it, btn) {
  if (!state.project.name && !confirm('지금 작업은 이름 붙여 저장되지 않았어요. 그래도 받은 카드뉴스를 열까요?\n(지금 작업을 남기려면 취소 → 💾 저장)')) return;
  btn.disabled = true;
  busy(true, '받은 카드뉴스 여는 중…');
  try {
    const d = await hubCall({ action: 'get', key: state.settings.hubAdminKey, id: it.id });
    const data = JSON.parse(d.data);
    await applyProjectData(data, it.name);
    closeModal('hubInModal');
    toast(`'${it.name}' 열었어요. 💾 저장하면 내 프로젝트 폴더에도 들어가요`, 5000);
  } catch (e) { toast('열지 못했어요: ' + e.message, 6000); } finally { busy(false); btn.disabled = false; }
}
// 내 편집기 전용 설정 파일(hub_config.json: 주소·업로드 코드·관리자 코드)이 있으면 반영
async function loadHubConfig() {
  try {
    const r = await fetch('hub_config.json', { cache: 'no-store' });
    if (!r.ok) return;
    const c = await r.json();
    ['hubUrl', 'hubKey', 'hubAdminKey'].forEach(k => { if (c[k]) state.settings[k] = c[k]; });
    saveSettings();
  } catch (e) { /* 없음 */ }
}

function updateProjName() {
  const el = $('#projName');
  if (!el || !state.project) return;
  el.textContent = state.project.name || '이름 없음';
  el.classList.toggle('unsaved', !state.project.name);
}
// 첫 장 문구 (제목 레이어 → 없으면 첫 글자 레이어) — 공유함 제목용
function firstCardTitle() {
  let t = '', any = '';
  walkObjs((slides()[0] && slides()[0].json.objects) || [], o => {
    if (o.type !== 'i-text' && o.type !== 'textbox') return;
    if (!t && o.layerName === '제목') t = o.text;
    if (!any && (o.text || '').trim()) any = o.text;
  });
  t = (t || any || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const d = new Date();
  return (t || `카드뉴스 ${d.getMonth() + 1}.${d.getDate()}`) + (H === 1080 ? ' (1:1)' : '');
}
function suggestProjectName() {
  // 첫 카드 제목 첫 줄 (별표 빼고) → 없으면 날짜
  let t = '';
  walkObjs((slides()[0] && slides()[0].json.objects) || [], o => { if (!t && o.type === 'i-text' && o.layerName === '제목') t = o.text; });
  t = (t || '').replace(/\*/g, '').replace(/\n/g, ' ').trim().slice(0, 40);
  const d = new Date();
  return t || `카드뉴스 ${d.getMonth() + 1}.${d.getDate()}`;
}
async function saveNamedProject(saveAs = false) {
  if (!PROXY_OK || SERVER_OLD) { toast('프로젝트 폴더 저장은 start.bat을 (다시) 실행해야 돼요. 대신 파일로 받을게요.', 5000); return saveProjectFile(); }
  leaveCurrent();
  let name = state.project.name;
  if (!name || saveAs) {
    name = prompt('프로젝트 이름', name || suggestProjectName());
    if (!name || !name.trim()) return;
    name = name.trim();
  }
  const send = async overwrite => {
    const prev = state.project.name;
    state.project.name = name;
    const r = await fetch('/api/project-save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, overwrite, data: projectData(), thumb: (slides()[0] && slides()[0].thumb) || '' }),
    });
    const d = await r.json();
    if (r.status === 409 && d.exists) { state.project.name = prev; return d; }
    if (!r.ok) { state.project.name = prev; throw new Error(d.error || r.status); }
    state.project.name = d.name;
    return d;
  };
  busy(true, '프로젝트 저장 중…');
  try {
    // 같은 이름으로 다시 저장(덮어쓰기)은 묻지 않음. 다른 프로젝트와 이름이 겹치면 확인
    let d = await send(name === state.project.name && !saveAs);
    if (d.exists) {
      busy(false);
      if (!confirm(`'${d.name}' 프로젝트가 이미 있어요. 덮어쓸까요?`)) return;
      busy(true, '프로젝트 저장 중…');
      d = await send(true);
    }
    updateProjName(); scheduleAutosave();
    toast(`💾 '${d.name}' 저장했어요 (프로젝트 폴더)`);
  } catch (e) { toast('저장 실패: ' + e.message, 6000); } finally { busy(false); }
}
async function openProjectsModal() {
  if (!PROXY_OK || SERVER_OLD) { toast('프로젝트 폴더는 start.bat을 (다시) 실행해야 써요. 파일에서 열게요.', 5000); return openProjectFile(); }
  const list = $('#projList');
  list.innerHTML = '<p class="hint">불러오는 중…</p>';
  openModal('projectsModal');
  try {
    const d = await (await fetch('/api/project-list', { cache: 'no-store' })).json();
    $('#projFolder').textContent = '— ' + d.folder;
    list.innerHTML = '';
    if (!d.items.length) list.append(h('p', { class: 'hint' }, "아직 저장한 프로젝트가 없어요. 상단 '💾 저장'으로 이름을 붙여 저장하면 여기에 모여요."));
    d.items.forEach(it => {
      const dt = new Date(it.mtime * 1000);
      const card = h('div', { class: 'proj-item' + (it.name === state.project.name ? ' current' : ''), title: it.name },
        h('img', { src: it.thumb || '', alt: '' }),
        h('div', { class: 'pn' }, it.name),
        h('div', { class: 'pd' }, `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')} · ${(it.size / 1048576).toFixed(1)}MB`));
      card.addEventListener('click', () => loadNamedProject(it.name));
      list.append(card);
    });
  } catch (e) { list.innerHTML = ''; list.append(h('p', { class: 'status err' }, '목록을 못 불러왔어요: ' + e.message)); }
}
async function loadNamedProject(name) {
  if (state.project.name !== name && !state.project.name &&
      !confirm('지금 작업은 이름 붙여 저장되지 않았어요. 그래도 다른 프로젝트를 열까요?\n(지금 작업을 남기려면 취소 → 💾 저장)')) return;
  busy(true, '프로젝트 여는 중…');
  try {
    const r = await fetch('/api/project-load?name=' + encodeURIComponent(name));
    if (!r.ok) throw new Error((await r.json()).error || r.status);
    await applyProjectData(await r.json(), name);
    closeModal('projectsModal');
    toast(`'${name}' 열었어요`);
  } catch (e) { toast('열기 실패: ' + e.message, 6000); } finally { busy(false); }
}
async function applyProjectData(data, name) {
  if (!data.project || !Array.isArray(data.project.slides)) throw new Error('카드뉴스 프로젝트 파일이 아니에요');
  exitFrameEdit(); exitCrop();
  if (data.settings) {
    ['accent', 'brandName', 'logo'].forEach(k => { if (data.settings[k] !== undefined) state.settings[k] = data.settings[k]; });
    saveSettings();
  }
  state.project = {
    name: name || data.name || '', caption: data.project.caption || '', sourceUrl: data.project.sourceUrl || '', sourceText: data.project.sourceText || '',
    slides: data.project.slides.map(s => ({ id: s.id || uid(), json: s.json })),
  };
  setCardHeight(data.cardH || BASE_H);
  state.current = 0;
  await loadSlideToCanvas(0);
  pushHistory(); renderAll(); updateProjName();
  scheduleAutosave();
  ensureThumbs(true);
}

/* ----- 카드 크기 바꾸기 (원본은 그대로 저장해두고, 바꾼 버전을 새 이름으로) ----- */
async function convertProjectSize(newH) {
  if (newH === H) return;
  const label = newH === 1080 ? '1:1 정사각형 (1080×1080)' : '4:5 세로 (1080×1350)';
  const useFolder = PROXY_OK && !SERVER_OLD;
  if (!confirm(`모든 카드를 ${label}로 바꿀까요?\n\n` + (useFolder
    ? '지금 버전은 프로젝트 폴더에 그대로 저장해두고, 바뀐 버전은 새 이름으로 따로 저장해요.'
    : '(로컬 서버가 없어서 지금 프로젝트를 바로 바꿔요. 원래대로 돌리려면 반대로 다시 바꾸세요.)'))) return;
  leaveCurrent();
  const save = async (name, overwrite) => {
    const r = await fetch('/api/project-save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, overwrite, data: projectData(), thumb: (slides()[0] && slides()[0].thumb) || '' }),
    });
    const d = await r.json();
    if (r.status === 409 && d.exists) {   // 이름 없던 작업에 정한 이름이 이미 다른 프로젝트에 있음
      busy(false);
      if (!confirm(`'${d.name}' 프로젝트가 이미 있어요. 덮어쓸까요?`)) throw new Error('취소했어요');
      busy(true, '카드 크기 바꾸는 중…');
      return save(name, true);
    }
    if (!r.ok) throw new Error(d.error || r.status);
    return d.name;
  };
  busy(true, '카드 크기 바꾸는 중…');
  try {
    let baseName = state.project.name;
    const hadName = !!baseName;
    if (useFolder) {
      if (!baseName) {
        busy(false);
        baseName = prompt('지금 버전(원본)을 저장할 이름', suggestProjectName());
        if (!baseName || !baseName.trim()) return;
        busy(true, '카드 크기 바꾸는 중…');
        baseName = baseName.trim();
        state.project.name = baseName;
      }
      baseName = await save(baseName, hadName);   // 원본 보관
      state.project.name = baseName;
    }
    const oldH = H;
    slides().forEach(s => { s.json = convertSlideJSON(s.json, oldH, newH); s.thumb = null; s.hist = null; s.hi = undefined; s.lens = s.lens; });
    setCardHeight(newH);
    if (useFolder) {
      const plain = baseName.replace(/\s*\((1080x1080|1080x1350)\)$/, '');
      state.project.name = await save(`${plain} (${W}x${newH})`, true);
    }
    await loadSlideToCanvas(state.current);
    pushHistory(); zoomFit(); renderAll(); updateProjName();
    scheduleAutosave();
    await ensureThumbs(true);
    if (useFolder) await save(state.project.name, true);   // 미리보기 넣어서 다시 저장
    toast(useFolder ? `✅ ${label}로 바꿨어요. 원본은 '${baseName}', 이 버전은 '${state.project.name}'로 프로젝트 폴더에 있어요` : `✅ ${label}로 바꿨어요`, 7000);
  } catch (e) { console.error(e); toast('바꾸기 실패: ' + e.message, 6000); } finally { busy(false); }
}

/* ----- 프로젝트 파일 ----- */
function saveProjectFile() {
  leaveCurrent();
  downloadBlob(new Blob([JSON.stringify(projectData())], { type: 'application/json' }), `${state.project.name || 'cardnews-' + stamp()}.cardnews.json`);
}
async function openProjectFile() {
  const [f] = await pickFiles('.json,application/json');
  if (!f) return;
  busy(true, '프로젝트 여는 중…');
  try {
    const data = JSON.parse(await readAsText(f));
    await applyProjectData(data, data.name || f.name.replace(/(\.cardnews)?\.json$/i, ''));
    closeModal('projectsModal');
    ensureThumbs(true);
  } catch (e) { toast('열기 실패: ' + e.message); } finally { busy(false); }
}
async function newProject() {
  if (!confirm('새 프로젝트를 시작할까요? 지금 작업이 화면에서 사라져요. (남기려면 취소 → 💾 저장)')) return;
  exitFrameEdit(); exitCrop();
  setCardHeight(BASE_H);   // 새 프로젝트는 4:5
  state.project = await sampleProject();
  state.current = 0;
  await loadSlideToCanvas(0);
  pushHistory();
  renderAll(); updateProjName();
  scheduleAutosave();
  ensureThumbs(true);
}
async function sampleProject() {
  return {
    caption: '', sourceUrl: '',
    slides: [
      { id: uid(), json: await buildSlideJSON('cover', { text: '2003년 헐크\n어벤져스에\n복귀한다는 *루머*', total: 2 }) },
      { id: uid(), json: await buildSlideJSON('body', { text: '개봉 첫 주에만\n*흥행 수익 10억 달러*를\n거둘 것으로 예상됩니다' }) },
    ],
  };
}

/* ----- 설정 ----- */
let pendingLogo;
function openSettings() {
  const s = state.settings;
  $('#setAccent').value = toHex(s.accent);
  $('#setAccentHex').value = s.accent;
  $('#setBrand').value = s.brandName;
  $('#setApiKey').value = s.apiKey || '';
  $('#setModel').value = s.model || 'claude-sonnet-5-5';
  $('#setSerpKey').value = s.serpApiKey || '';
  $('#setHubUrl').value = s.hubUrl || '';
  $('#setHubKey').value = s.hubKey || '';
  $('#setHubAdminKey').value = s.hubAdminKey || '';
  $('#setExportDir').value = s.exportDir || '';
  $('#setExportCaption').checked = !!s.exportWithCaption;
  $('#setTmdbKey').value = s.tmdbKey || '';
  $('#setPrompt').value = s.prompt || DEFAULT_PROMPT;
  pendingLogo = undefined;
  $('#setLogoPreview').src = getLogo();
  $('#setFontList').textContent = (s.customFonts || []).map(f => f.name).join(', ') || '없음';
  checkForUpdate();
  openModal('settingsModal');
}
async function applySettings() {
  const s = state.settings;
  const newAccent = $('#setAccentHex').value.trim() || $('#setAccent').value;
  const newBrand = $('#setBrand').value.trim();
  const oldAccent = s.accent;
  s.apiKey = $('#setApiKey').value.trim();
  s.model = $('#setModel').value.trim() || 'claude-sonnet-5-5';
  s.serpApiKey = $('#setSerpKey').value.trim();
  s.hubUrl = $('#setHubUrl').value.trim();
  s.hubKey = $('#setHubKey').value.trim();
  s.hubAdminKey = $('#setHubAdminKey').value.trim();
  syncHubButtons();
  s.exportDir = $('#setExportDir').value.trim();
  s.exportWithCaption = $('#setExportCaption').checked;
  s.tmdbKey = $('#setTmdbKey').value.trim();
  s.prompt = $('#setPrompt').value.trim() || DEFAULT_PROMPT;

  leaveCurrent();
  let changed = false;
  if (!sameColor(newAccent, oldAccent)) {
    // 모든 슬라이드에서 이전 강조색을 새 강조색으로
    const variants = new Set([oldAccent, oldAccent.toUpperCase(), oldAccent.toLowerCase(), toHex(oldAccent), toHex(oldAccent).toUpperCase()]);
    slides().forEach(sl => {
      let str = JSON.stringify(sl.json);
      variants.forEach(v => { str = str.split(`"${v}"`).join(`"${newAccent}"`); });
      sl.json = JSON.parse(str);
    });
    s.accent = newAccent; changed = true;
  }
  if (newBrand && newBrand !== s.brandName) {
    s.brandName = newBrand;
    slides().forEach(sl => walkObjs(sl.json.objects, o => { if (o.kind === 'brand') { o.text = newBrand; o.styles = {}; } }));
    changed = true;
  }
  if (pendingLogo !== undefined) {
    s.logo = pendingLogo;
    await replaceLogoInSlides(getLogo());
    changed = true;
  }
  await saveSettings();
  closeModal('settingsModal');
  if (changed) {
    await loadSlideToCanvas(state.current);
    pushHistory();
    renderAll();
    scheduleAutosave();
    ensureThumbs(true);
  }
  toast('설정을 저장했어요');
}
/* ----- 깃허브 자동 업데이트 ----- */
let updateInfo = null;
async function checkForUpdate(manual = false) {
  if (!PROXY_OK || SERVER_OLD) { if (manual) toast('start.bat으로 (다시) 실행한 편집기에서 확인할 수 있어요'); return; }
  try {
    updateInfo = await (await fetch('/api/update-check', { cache: 'no-store' })).json();
  } catch (e) { updateInfo = { error: e.message }; }
  const u = updateInfo;
  const info = $('#verInfo');
  if (info) {
    info.textContent = u.dev ? `원본(배포용) 폴더 · 버전 ${u.current}${u.latest ? ` (깃허브: ${u.latest})` : ''}`
      : u.available ? `버전 ${u.current} → 새 버전 ${u.latest} 있음`
      : u.error ? `버전 ${u.current || '?'} · ${u.error}` : `버전 ${u.current} · 최신이에요`;
  }
  $('#btnUpdate').style.display = u.available ? '' : 'none';
  if (u.available) $('#btnUpdate').title = `새 버전 ${u.latest}${u.notes ? '\n' + u.notes : ''}`;
  if (manual && !u.available && !u.error) toast(u.dev ? '원본 폴더라 자동 업데이트는 하지 않아요' : '이미 최신 버전이에요');
  if (manual && u.error) toast(u.error, 5000);
}
async function applyUpdate() {
  if (!updateInfo || !updateInfo.available) return;
  if (!confirm(`새 버전(${updateInfo.latest})으로 업데이트할까요?${updateInfo.notes ? '\n\n' + updateInfo.notes : ''}\n\n작업 중인 내용·프로젝트·키는 그대로 남아요.`)) return;
  busy(true, '업데이트 받는 중…');
  try {
    leaveCurrent(); await saveProjectToDB();
    const r = await fetch('/api/update-apply', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || r.status);
    if (d.restart) {
      busy(true, '편집기를 다시 시작하는 중…');
      await new Promise(res => setTimeout(res, 1500));
      for (let i = 0; i < 40; i++) {   // 서버가 다시 켜질 때까지 (최대 20초)
        try { if ((await fetch('/proxy-ping', { cache: 'no-store' })).ok) break; } catch (e) { /* 아직 */ }
        await new Promise(res => setTimeout(res, 500));
      }
    }
    toast(`✅ 업데이트 완료 (${d.version}) — 새로고침합니다`);
    setTimeout(() => location.reload(), 800);
  } catch (e) { busy(false); toast('업데이트 실패: ' + e.message, 7000); }
}

/* 공유용 압축파일 (편집기 폴더 옆에 '카드뉴스편집기_공유_날짜.zip') */
async function makeSharePackage() {
  if (!PROXY_OK || SERVER_OLD) { toast('start.bat을 (다시) 실행한 편집기에서 만들 수 있어요', 5000); return; }
  const withKeys = $('#shareKeys').checked;
  const s = state.settings;
  if (withKeys && !confirm('압축파일 안에 내 API 키가 들어가요.\n받은 사람이 쓰는 만큼 내 계정으로 요금이 나가요. 계속할까요?\n\n(공유용 키를 따로 발급하고, Anthropic 콘솔에서 월 사용 한도를 걸어두는 걸 추천해요)')) return;
  busy(true, '압축파일 만드는 중…');
  try {
    const r = await fetch('/api/make-share', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ includeKeys: withKeys, config: { apiKey: s.apiKey, serpApiKey: s.serpApiKey, tmdbKey: s.tmdbKey, model: s.model, prompt: s.prompt } }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || r.status);
    toast(`📦 만들었어요: ${d.path} (${(d.size / 1048576).toFixed(1)}MB) — 이 파일을 보내주면 돼요`, 9000);
  } catch (e) { toast('만들기 실패: ' + e.message, 6000); } finally { busy(false); }
}
// 공유받은 편집기: shared_config.json 의 키를 비어 있는 설정에 채움
async function applySharedConfig() {
  try {
    const r = await fetch('shared_config.json', { cache: 'no-store' });
    if (!r.ok) return;
    const cfg = await r.json();
    // 공유함 주소·업로드 코드는 비어 있으면 언제든 채움 (나중에 추가된 기능이라)
    ['hubUrl', 'hubKey'].forEach(k => { if (cfg[k] && !state.settings[k]) { state.settings[k] = cfg[k]; saveSettings(); } });
    // 처음 한 번만 적용 (이후 받은 사람이 설정에서 바꾼 값은 그대로 둠). 키는 비어 있을 때만 채움
    if (state.settings.sharedApplied) return;
    ['apiKey', 'serpApiKey', 'tmdbKey'].forEach(k => { if (cfg[k] && !state.settings[k]) state.settings[k] = cfg[k]; });
    ['model', 'prompt'].forEach(k => { if (cfg[k]) state.settings[k] = cfg[k]; });
    state.settings.sharedApplied = true;
    saveSettings();
  } catch (e) { /* 공유 설정 없음 */ }
}

/* 모든 슬라이드의 로고 이미지를 바꿈 (보이는 크기는 비슷하게 유지) */
async function replaceLogoInSlides(src) {
  const img = await loadHtmlImage(src);
  const nw = img.naturalWidth, nh = img.naturalHeight;
  slides().forEach(sl => walkObjs(sl.json.objects, o => {
    if (o.kind !== 'logo') return;
    const area = (o.width * o.scaleX) * (o.height * o.scaleY);
    const sc = Math.sqrt(area / (nw * nh));
    Object.assign(o, { src, width: nw, height: nh, scaleX: sc * Math.sign(o.scaleX || 1), scaleY: sc, cropX: 0, cropY: 0 });
    sl.thumb = null;
  }));
}

async function addCustomFont() {
  const [f] = await pickFiles('.ttf,.otf,.woff,.woff2');
  if (!f) return;
  const name = prompt('폰트 이름 (목록에 보일 이름)', f.name.replace(/\.[^.]+$/, ''));
  if (!name) return;
  try {
    const data = await readAsDataURL(f);
    const ff = new FontFace(name, `url(${data})`);
    document.fonts.add(await ff.load());
    state.settings.customFonts = (state.settings.customFonts || []).filter(x => x.name !== name).concat({ name, data });
    await saveSettings();
    $('#setFontList').textContent = state.settings.customFonts.map(x => x.name).join(', ');
    renderProps();
    toast(`'${name}' 폰트를 추가했어요`);
  } catch (e) { toast('폰트를 읽지 못했어요: ' + e.message); }
}
