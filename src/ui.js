import { conversions as ALL } from './registry.js';
import { run, normExt, zipAll, cancelRun } from './engine.js';

// Claude 아티팩트 안에서 열린 미리보기에서는 외부 CDN(영상·오디오 엔진)을 받을 수 없고, 저장은 아티팩트의 저장 기능으로 해야 한다
const IN_ARTIFACT = typeof window !== 'undefined' && !!window.claude?.use;
const NO_NET_KINDS = new Set(['audio', 'vidaudio', 'video', 'vidgif', 'vidcompress', 'trim', 'vidmute']);
const conversions = IN_ARTIFACT ? ALL.filter((c) => !NO_NET_KINDS.has(c.kind)) : ALL;
const SAVE_OK = new Set(['gif', 'png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'mov', 'txt', 'json', 'md', 'docx', 'pptx', 'epub', 'csv', 'ttf', 'html', 'svg', 'pdf', 'xlsx', 'zip', 'fig']);
let saver = null;
if (IN_ARTIFACT) window.claude.use('downloads').then((d) => { saver = d; }).catch(() => {});

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const kid of kids) e.append(kid);
  return e;
};

const EXT_ACCEPT = { jpg: '.jpg,.jpeg,.jfif', heic: '.heic,.heif', tiff: '.tif,.tiff' };
const acceptFor = (inputs) => inputs.map((x) => EXT_ACCEPT[x] || `.${x}`).join(',');
const fmtSize = (n) => (n < 1024 ? `${n}B` : n < 1048576 ? `${(n / 1024).toFixed(0)}KB` : `${(n / 1048576).toFixed(1)}MB`);
const coarse = matchMedia('(pointer: coarse)').matches;
const WARN_BIG = (coarse ? 80 : 200) * 1024 * 1024;
const ORDERED = new Set(['pdfmerge', 'imgpdf', 'stitch']); // 파일 순서가 결과에 영향을 주는 종류
const MIN_FILES = { pdfmerge: 2, stitch: 2 };
const SIZE_KINDS = new Set(['compress', 'resize', 'pdfcompress', 'vidcompress']); // 용량 변화를 보여줄 종류
const IMG_INPUTS = ALL.find((c) => c.slug === 'image-to-pdf').inputs;
const keyOf = (c) => `${c.kind}:${c.output}`;

const slug = document.body.dataset.slug;
const isMain = slug === 'main';
const fixed = isMain ? null : conversions.find((c) => c.slug === slug);

const state = { files: [], text: '', entry: fixed, results: [], urls: [], optsGet: null, optsKey: '', grid: null, gridKey: '', gridMsg: '', busy: false, done: false };

// 메인 페이지: 올린 파일의 확장자 → 가능한 변환 (같은 종류·결과는 하나만)
function targetsFor(exts) {
  const seen = new Set(), list = [];
  const add = (c) => { if (!seen.has(keyOf(c))) { seen.add(keyOf(c)); list.push(c); } };
  // 사진 폴더처럼 이미지 종류가 섞여 있으면 이미지끼리의 변환도 보여준다
  if (exts.length > 1 && exts.every((x) => IMG_INPUTS.includes(x))) {
    for (const o of ['jpg', 'png', 'webp']) { const c = conversions.find((x) => x.kind === 'image' && x.output === o); if (c) add(c); }
  }
  for (const c of conversions) if (exts.every((x) => c.inputs.includes(x))) add(c);
  return list;
}

// ───────── 화면 요소
const dz = $('#dropzone'), fileInput = $('#file'), listEl = $('#files'), textBox = $('#textbox');
const targetsEl = $('#targets'), optsEl = $('#opts'), goBtn = $('#go'), msgEl = $('#msg');
const barEl = $('#bar'), barWrap = $('#barwrap'), resEl = $('#results');
const cancelBtn = el('button', { id: 'cancel', class: 'cancel', type: 'button', hidden: '', onclick: () => cancelRun() }, '취소');
barWrap.after(cancelBtn);
barWrap.setAttribute('role', 'progressbar');
barWrap.setAttribute('aria-label', '진행률');
barWrap.setAttribute('aria-valuemin', '0');
barWrap.setAttribute('aria-valuemax', '100');

// 카카오톡·인스타그램 같은 앱 안의 브라우저는 파일 저장이 막히는 경우가 많다
if (/KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent)) {
  $('.card')?.prepend(el('p', { class: 'notice' }, '앱 안의 브라우저에서는 파일 저장이 안 될 수 있어요. 오른쪽 위 메뉴(⋮)에서 "다른 브라우저로 열기"를 눌러 주세요.'));
}

function setMsg(t, err, link) {
  msgEl.replaceChildren(t || '');
  if (link) msgEl.append(' ', el('a', { href: link.href }, link.text));
  msgEl.className = err ? 'msg err' : 'msg';
}

// ───────── 파일 목록 (순서 바꾸기 / 정렬)
function renderFiles() {
  const ordered = ORDERED.has(state.entry?.kind) && state.files.length > 1;
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= state.files.length) return;
    [state.files[i], state.files[j]] = [state.files[j], state.files[i]];
    renderFiles();
  };
  const rows = state.files.map((f, i) => el('li', {},
    ...(ordered ? [
      el('button', { class: 'mv', type: 'button', title: '위로', 'aria-label': `${f.name} 위로`, onclick: () => move(i, -1) }, '▲'),
      el('button', { class: 'mv', type: 'button', title: '아래로', 'aria-label': `${f.name} 아래로`, onclick: () => move(i, 1) }, '▼'),
    ] : []),
    el('span', { class: 'fn' }, f.name), el('span', { class: 'fs' }, fmtSize(f.size)),
    el('button', { class: 'x', type: 'button', title: '삭제', 'aria-label': `${f.name} 삭제`, onclick: () => { state.files.splice(i, 1); refresh(); dz.focus(); } }, '×')));
  if (ordered) {
    const sortBy = (fn) => { state.files.sort(fn); renderFiles(); };
    rows.unshift(el('li', { class: 'sortbar' }, el('span', { class: 'fs' }, '순서'),
      el('button', { class: 'pb wide', type: 'button', onclick: () => sortBy((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) }, '이름순'),
      el('button', { class: 'pb wide', type: 'button', onclick: () => sortBy((a, b) => a.lastModified - b.lastModified) }, '날짜순')));
  }
  listEl.replaceChildren(...rows);
}

// ───────── 옵션 컨트롤
function seg(items, def, onchange, label) {
  let val = def;
  const wrap = el('div', { class: 'seg', role: 'group', ...(label ? { 'aria-label': label } : {}) });
  const btns = items.map(([v, text]) => {
    const b = el('button', { type: 'button', class: 'segb' + (v === def ? ' on' : ''), 'aria-pressed': String(v === def) }, text);
    b.addEventListener('click', () => {
      val = v;
      btns.forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
      onchange?.(v);
    });
    return b;
  });
  wrap.append(...btns);
  return { el: wrap, get: () => val };
}
const row = (label, ...ctl) => el('div', { class: 'orow' }, el('span', { class: 'olbl' }, label), ...ctl);
const textIn = (ph, val = '', w = '', label = '') => el('input', { type: 'text', class: 'tin' + (w ? ` ${w}` : ''), placeholder: ph, value: val, autocomplete: 'off', 'aria-label': label || ph });

function renderOpts() {
  const e = state.entry;
  const key = e ? `${e.kind}:${e.mode || ''}:${e.targetKB || ''}` : '';
  if (key !== state.optsKey) { // 같은 도구면 사용자가 고른 옵션을 그대로 둔다
    state.optsKey = key;
    optsEl.replaceChildren();
    state.optsGet = null;
    if (e) buildOpts(e);
  }
  ensureGrid();
}
function buildOpts(e) {
  const k = e.kind;
  if (k === 'compress') {
    const out = el('output', {}, '70');
    const r = el('input', { type: 'range', min: '30', max: '95', value: '70', id: 'q', 'aria-label': '화질' });
    r.addEventListener('input', () => { out.textContent = r.value; });
    const q = el('label', { class: 'orow' }, el('span', { class: 'olbl' }, '화질'), r, out, '%');
    const def = e.targetKB ? String(e.targetKB) : 'q';
    q.hidden = def !== 'q';
    const m = seg([['q', '화질 지정'], ['100', '100KB 이하'], ['200', '200KB 이하'], ['500', '500KB 이하'], ['1024', '1MB 이하']], def, (v) => { q.hidden = v !== 'q'; }, '줄이는 방법');
    optsEl.append(row('줄이는 방법', m.el), q);
    state.optsGet = () => (m.get() === 'q' ? { quality: +r.value } : { targetKB: +m.get() });
  } else if (k === 'resize') {
    const s = el('select', { id: 'w', 'aria-label': '최대 가로 크기' }, ...[640, 800, 1080, 1280, 1920, 2560].map((w) => el('option', { value: w, ...(w === 1280 ? { selected: '' } : {}) }, `가로 ${w}px`)));
    optsEl.append(row('최대 크기', s));
    state.optsGet = () => ({ width: +s.value });
  } else if (k === 'ico') {
    const m = seg([['fav', '웹사이트 파비콘 (16·32·48)'], ['full', '윈도우 아이콘 (16~256)']], 'fav', null, '용도');
    optsEl.append(row('용도', m.el));
    state.optsGet = () => ({ set: m.get() });
  } else if (k === 'stitch') {
    const m = seg([['v', '세로로 (위→아래)'], ['h', '가로로 (왼쪽→오른쪽)']], 'v', null, '방향');
    optsEl.append(row('방향', m.el), el('p', { class: 'ohint' }, '위 목록의 순서대로 이어붙여요. ▲▼로 순서를 바꿀 수 있어요.'));
    state.optsGet = () => ({ dir: m.get() });
  } else if (k === 'pdfsplit') {
    const range = textIn('예: 1-3, 5, 8-', '', 'wide', '쪽 범위');
    const join = el('input', { type: 'checkbox', id: 'join' });
    const every = el('input', { type: 'number', class: 'tin', min: '1', value: '2', style: 'width:70px', 'aria-label': '몇 쪽씩' });
    const rangeBox = el('div', { class: 'orow' }, range, el('label', { class: 'chk' }, join, ' 한 파일로 합치기'));
    const everyBox = el('div', { class: 'orow' }, every, '쪽씩');
    const show = (v) => { rangeBox.hidden = v !== 'range'; everyBox.hidden = v !== 'every'; };
    const m = seg([['each', '낱장으로'], ['range', '쪽 범위로 뽑기'], ['every', 'N쪽씩'], ['half', '반으로'], ['parity', '홀수·짝수']], 'each', show, '나누는 방법');
    show('each');
    optsEl.append(row('나누는 방법', m.el), rangeBox, everyBox);
    state.optsGet = () => ({ mode: m.get(), range: range.value, join: join.checked, every: every.value });
  } else if (k === 'pdfnum') {
    const pos = el('select', { 'aria-label': '위치' }, ...[['bc', '아래 가운데'], ['br', '아래 오른쪽'], ['bl', '아래 왼쪽'], ['tc', '위 가운데'], ['tr', '위 오른쪽'], ['tl', '위 왼쪽']].map(([v, l]) => el('option', { value: v }, l)));
    const fmt = seg([['n', '1'], ['n/t', '1 / 10'], ['-n-', '- 1 -']], 'n', null, '모양');
    const size = seg([['s', '작게'], ['m', '보통'], ['l', '크게']], 'm', null, '크기');
    const skip = el('input', { type: 'checkbox' });
    optsEl.append(row('위치', pos), row('모양', fmt.el), row('크기', size.el), el('label', { class: 'chk' }, skip, ' 표지는 빼고 2쪽부터 1번'));
    state.optsGet = () => ({ pos: pos.value, fmt: fmt.get(), size: size.get(), skipCover: skip.checked });
  } else if (k === 'pdfmark') {
    const text = textIn('워터마크 글자', '제출용 사본', 'wide');
    let img = null;
    const imgName = el('span', { class: 'fs' }, '');
    const pick = el('input', { type: 'file', accept: 'image/*', hidden: '' });
    const pickBtn = el('button', { type: 'button', class: 'pb wide', onclick: () => pick.click() }, '이미지로 넣기');
    pick.addEventListener('change', () => { img = pick.files[0] || null; imgName.textContent = img ? img.name : ''; text.disabled = !!img; });
    const op = seg([[0.2, '연하게'], [0.35, '보통'], [0.55, '진하게']], 0.35, null, '진하기');
    const lay = seg([['diag', '가운데 대각선'], ['tile', '전체에 반복']], 'diag', null, '배치');
    optsEl.append(row('글자', text, pickBtn, imgName, pick), row('진하기', op.el), row('배치', lay.el));
    state.optsGet = () => ({ text: text.value, image: img, opacity: op.get(), layout: lay.get() });
  } else if (k === 'pdfcompress') {
    const m = seg([['small', '많이 줄이기'], ['normal', '보통'], ['high', '화질 유지']], 'normal', null, '줄이는 정도');
    optsEl.append(row('줄이는 정도', m.el), el('p', { class: 'ohint' }, '글자를 드래그해서 복사하는 기능은 없어지지만 용량이 크게 줄어요.'));
    state.optsGet = () => ({ preset: m.get() });
  } else if (k === 'vidcompress') {
    const m = seg([['msg', '카톡·메신저용'], ['normal', '화질 우선'], ['small', '최대한 작게']], 'msg', null, '용도');
    optsEl.append(row('용도', m.el), el('p', { class: 'ohint' }, '영상은 시간이 걸려요. 길이가 긴 영상은 기기에 따라 몇 분 걸릴 수 있어요.'));
    state.optsGet = () => ({ preset: m.get() });
  } else if (k === 'trim') {
    const start = textIn('0:00', '', 'sm', '시작 시간'), end = textIn('끝까지', '', 'sm', '끝 시간');
    const precise = el('input', { type: 'checkbox' });
    optsEl.append(row('시작', start), row('끝', end), el('label', { class: 'chk' }, precise, ' 정확하게 자르기 (느려요)'),
      el('p', { class: 'ohint' }, '1:30 또는 90 처럼 입력해요. 기본은 빠르게 자르는 방식이라 앞뒤로 1~2초 차이가 날 수 있어요.'));
    state.optsGet = () => ({ start: start.value, end: end.value, precise: precise.checked });
  } else if (k === 'vidgif') {
    const w = seg([[320, '작게'], [480, '보통'], [720, '크게']], 480, null, '크기');
    const fps = seg([[10, '10fps'], [15, '15fps']], 10, null, '부드러움');
    const start = textIn('0:00', '', 'sm', '시작 시간'), len = textIn('15', '15', 'sm', '길이(초)');
    optsEl.append(row('크기', w.el), row('부드러움', fps.el), row('시작', start), row('길이(초)', len));
    state.optsGet = () => ({ width: w.get(), fps: fps.get(), start: start.value, len: len.value });
  }
}

// PDF 쪽 그리드 (정리·삭제·추출) — 이 도구에서만 필요해서 그때 불러온다
async function ensureGrid() {
  const e = state.entry, f = state.files[0];
  if (!e || e.kind !== 'pdfpages') { dropGrid(); return; }
  if (!f) { dropGrid(); optsEl.replaceChildren(); state.optsGet = null; return; }
  const key = `${f.name}|${f.size}|${f.lastModified}|${e.mode}`;
  if (state.gridKey === key && state.grid) {
    if (!optsEl.contains(state.grid.el)) optsEl.replaceChildren(state.grid.el);
    state.optsGet = () => ({ pages: state.grid.pages() });
    return;
  }
  dropGrid();
  state.gridKey = key;
  optsEl.replaceChildren(el('p', { class: 'ohint' }, '쪽 미리보기를 만드는 중…'));
  try {
    const { createGrid } = await import('./pdfgrid.js');
    const g = await createGrid(f, e.mode, refreshGo);
    if (state.gridKey !== key) { g.destroy(); return; }
    state.grid = g;
    optsEl.replaceChildren(g.el);
    state.optsGet = () => ({ pages: g.pages() });
  } catch (err) {
    if (state.gridKey === key) { optsEl.replaceChildren(); setMsg(err?.message || 'PDF를 열 수 없어요.', true); }
  }
  refreshGo();
}
function dropGrid() { state.grid?.destroy(); state.grid = null; state.gridKey = ''; }

function renderTargets() {
  if (!isMain) return;
  targetsEl.replaceChildren();
  let ents = [];
  if (state.text.trim() && !state.files.length) ents = conversions.filter((c) => c.kind === 'text');
  else if (state.files.length) {
    const exts = [...new Set(state.files.map((f) => normExt(f.name)))];
    ents = targetsFor(exts);
    if (!ents.length) {
      setMsg(exts.length > 1 ? `서로 다른 종류의 파일은 한 번에 변환할 수 없어요. (${exts.map((x) => x || '?').join(', ')}) 같은 종류끼리 올려 주세요.`
        : IN_ARTIFACT && ALL.some((c) => NO_NET_KINDS.has(c.kind) && c.inputs.includes(exts[0])) ? '이 미리보기에서는 영상·오디오 변환을 쓸 수 없어요. (실제 사이트에서는 돼요)'
        : exts[0] ? `.${exts[0]} 파일은 아직 지원하지 않아요.` : '형식을 알 수 없는 파일이에요.', true);
    }
  }
  // 파일을 더 올려도 고른 변환은 유지한다
  const prev = state.entry && ents.find((c) => keyOf(c) === keyOf(state.entry));
  state.entry = prev || ents[0] || null;
  if (ents.length) targetsEl.append(el('p', { class: 'lbl', id: 'tlbl' }, '무엇으로 바꿀까요?'));
  for (const c of ents) {
    const label = c.chip || (c.kind === 'text' ? c.toName : c.verb ? c.title.replace(/^이미지 /, '') : c.toName);
    targetsEl.append(el('button', {
      class: 'chip' + (c === state.entry ? ' on' : ''), type: 'button', 'aria-pressed': String(c === state.entry),
      onclick: () => { state.entry = c; clearResults(); renderTargets(); renderFiles(); renderOpts(); refreshGo(); targetsEl.querySelector('.chip.on')?.focus(); },
    }, label));
  }
}

function canGo() {
  const e = state.entry;
  if (!e || state.busy) return false;
  if (e.kind === 'text') return !!state.text.trim();
  if (state.files.length < (MIN_FILES[e.kind] || 1)) return false;
  if (e.kind === 'pdfpages') return !!state.grid && !state.grid.error();
  return true;
}
function refreshGo() {
  const e = state.entry;
  goBtn.disabled = !canGo();
  goBtn.textContent = e ? e.goLabel : '변환하기';
  if (state.busy) return;
  const need = e && state.files.length && state.files.length < (MIN_FILES[e.kind] || 1);
  if (need) { setMsg(`${MIN_FILES[e.kind]}개 이상 올려 주세요.`); state.gridMsg = ''; return; }
  if (e?.kind === 'pdfpages' && state.grid && state.files.length) {
    const er = state.grid.error();
    if (er) { setMsg(er); state.gridMsg = er; }
    else if (state.gridMsg && msgEl.textContent === state.gridMsg) { setMsg(''); state.gridMsg = ''; }
  }
}

function refresh() {
  if (state.busy) return;
  setMsg('');
  clearResults();
  if (!state.files.length) dropGrid();
  renderFiles();
  renderTargets();
  renderOpts();
  refreshGo();
  dz.classList.toggle('has', state.files.length > 0);
}

function clearResults() {
  state.urls.forEach((u) => URL.revokeObjectURL(u));
  state.urls = [];
  state.results = [];
  state.done = false;
  resEl.replaceChildren();
}

function addFiles(fl) {
  if (state.busy) return;
  const incoming = [...fl].filter((f) => !f.name.startsWith('.'));
  if (!incoming.length) return;
  if (state.done) { state.files = []; dropGrid(); } // 변환이 끝난 뒤 새 파일을 올리면 새로 시작
  const same = (a, b) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
  const fresh = incoming.filter((f) => !state.files.some((x) => same(x, f)));
  if (fixed) {
    const allowed = fixed.pageInputs || fixed.inputs;
    const ok = fresh.filter((f) => allowed.includes(normExt(f.name)));
    const badExts = [...new Set(fresh.filter((f) => !allowed.includes(normExt(f.name))).map((f) => normExt(f.name) || '?'))];
    if (fixed.multi) state.files.push(...ok);
    else if (ok.length) { state.files = [ok[0]]; dropGrid(); }
    refresh();
    if (badExts.length) setMsg(`${fixed.fromName} 파일만 올릴 수 있어요. (.${badExts.join(', .')} 파일은 제외했어요)`, true, { href: '../', text: '다른 형식은 메인에서 →' });
    else if (!fixed.multi && ok.length > 1) setMsg('이 도구는 파일 하나씩만 돼요. 첫 번째 파일만 올렸어요.');
  } else {
    state.files.push(...fresh);
    refresh();
  }
}

// 폴더를 통째로 끌어다 놓아도 안의 파일을 모두 꺼낸다
async function filesFromDrop(dt) {
  const ents = [...(dt.items || [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean); // 이벤트 안에서 동기로 얻어야 함
  if (!ents.some((e) => e.isDirectory)) return [...dt.files];
  const out = [];
  const walk = async (e) => {
    if (e.isFile) out.push(await new Promise((res, rej) => e.file(res, rej)));
    else if (e.isDirectory) {
      const r = e.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => r.readEntries(res, rej));
        for (const c of batch) await walk(c);
      } while (batch.length);
    }
  };
  for (const e of ents) await walk(e);
  return out;
}

// ───────── 이벤트
dz.addEventListener('click', (e) => { if (e.target.closest('button') || e.target.closest('li')) return; fileInput.click(); });
dz.addEventListener('keydown', (e) => { if (e.target === dz && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); fileInput.click(); } });
fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
let dragDepth = 0;
window.addEventListener('dragenter', () => { dragDepth++; dz.classList.add('drag'); });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dz.classList.remove('drag'); });
// 창의 어디에 놓아도 브라우저가 파일을 열어 버리지 않고 받아 준다
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault(); dragDepth = 0; dz.classList.remove('drag');
  if (fixed?.kind === 'text' || e.target.closest?.('.pgrid')) return;
  addFiles(await filesFromDrop(e.dataTransfer));
});
window.addEventListener('paste', (e) => {
  const fs = e.clipboardData?.files;
  if (fs && fs.length && !(fixed?.kind === 'text') && !e.target.closest?.('input,textarea')) addFiles(fs);
});
if (textBox) textBox.addEventListener('input', () => { state.text = textBox.value; clearResults(); renderTargets(); refreshGo(); });
const pasteBox = $('details.paste');
pasteBox?.addEventListener('toggle', () => { if (pasteBox.open) textBox?.focus(); });

function setBusy(b) {
  state.busy = b;
  for (const x of [listEl, targetsEl, optsEl]) x.toggleAttribute('inert', b);
  dz.classList.toggle('busy', b);
  dz.setAttribute('aria-disabled', String(b));
  barWrap.hidden = !b; cancelBtn.hidden = !b;
}

goBtn.addEventListener('click', async () => {
  const e = state.entry;
  if (!e || !canGo()) return;
  if (e.kind !== 'text' && state.files.some((f) => f.size > WARN_BIG) && !confirm('파일이 매우 커서 오래 걸리거나 브라우저가 멈출 수 있어요. 계속할까요?')) return;
  const opts = state.optsGet ? state.optsGet() : {};
  const files = [...state.files];
  clearResults(); setMsg('');
  setBusy(true); refreshGo();
  const bar = (p) => { const v = Math.max(0.03, Math.min(1, p)); barEl.style.transform = `scaleX(${v})`; barWrap.setAttribute('aria-valuenow', String(Math.round(v * 100))); };
  bar(0.03);
  const leave = (ev) => { ev.preventDefault(); ev.returnValue = ''; };
  window.addEventListener('beforeunload', leave);
  try {
    const out = await run(e, { files, text: state.text, opts, onProgress: (p, m) => { bar(p); if (m) setMsg(m); } });
    showResults(out, files);
    setMsg(out.errors?.length ? `${out.length}개 완료, ${out.errors.length}개는 실패했어요.` : '완료! 아래에서 내려받으세요.');
  } catch (err) {
    console.error(err);
    const cancelled = err?.message === '취소했어요.';
    setMsg(err?.message || '변환 중 오류가 발생했어요.', !cancelled);
  } finally {
    window.removeEventListener('beforeunload', leave);
    setBusy(false); refreshGo();
  }
});

// 아티팩트에서는 저장 확인창을 거쳐 저장한다. 허용되지 않는 확장자(ico·bmp 등)는 ZIP 에 담아서 저장한다.
async function saveBlob(blob, name) {
  if (!saver) { download(blob, name); return; }
  let data = blob, fname = name;
  if (!SAVE_OK.has((name.split('.').pop() || '').toLowerCase())) { data = await zipAll([{ name, blob }]); fname = `${name}.zip`; }
  try {
    await saver.save({ filename: fname, data });
    setMsg(`${fname} 저장했어요.`);
  } catch (e) {
    if (e?.code !== 'declined') setMsg(`저장하지 못했어요. (${e?.message || e?.code || '알 수 없는 오류'})`, true);
  }
}
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function showResults(out, inputs) {
  state.results = out;
  state.done = true;
  const sizeInfo = SIZE_KINDS.has(state.entry?.kind) && out.length === inputs.length && !out.errors?.length;
  const rows = out.map((o, i) => {
    const url = URL.createObjectURL(o.blob);
    state.urls.push(url);
    let sz = fmtSize(o.blob.size);
    if (sizeInfo) {
      const before = inputs[i].size;
      const pct = Math.round((1 - o.blob.size / before) * 100);
      sz = `${fmtSize(before)} → ${fmtSize(o.blob.size)}${pct > 0 ? ` (${pct}% 줄었어요)` : ''}`;
    }
    return el('li', {},
      el('span', { class: 'fn' }, o.name),
      el('span', { class: 'fs' }, sz),
      IN_ARTIFACT ? el('button', { class: 'dl', type: 'button', onclick: () => saveBlob(o.blob, o.name) }, '저장') : el('a', { class: 'dl', href: url, download: o.name }, '다운로드'),
      ...(o.note ? [el('span', { class: 'note' }, o.note)] : []));
  });
  resEl.replaceChildren(...rows);
  for (const er of out.errors || []) resEl.append(el('li', { class: 'errli' }, er));
  const acts = el('li', { class: 'zipli' });
  const asFiles = out.map((o) => new File([o.blob], o.name, { type: o.blob.type }));
  if (out.length > 1) {
    const b = el('button', { class: 'zip', type: 'button' }, `전체 ZIP으로 받기 (${out.length}개)`);
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await saveBlob(await zipAll(out), 'converted.zip'); }
      catch (err) { console.error(err); setMsg('ZIP 파일을 만들지 못했어요. 파일을 하나씩 받아 주세요.', true); }
      finally { b.disabled = false; }
    });
    acts.append(b);
  }
  // 휴대폰에서는 공유 시트로 사진 앱·파일 앱에 바로 저장할 수 있다
  if (!IN_ARTIFACT && (coarse || out.length === 1) && navigator.canShare?.({ files: asFiles })) {
    acts.append(el('button', { class: 'zip', type: 'button', onclick: () => navigator.share({ files: asFiles }).catch(() => {}) }, out.length > 1 ? '모두 공유·저장하기' : '공유·저장하기'));
  }
  acts.append(el('button', { class: 'again', type: 'button', onclick: () => {
    state.files = []; state.text = ''; if (textBox) textBox.value = '';
    if (isMain) state.entry = null;
    refresh();
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  } }, '다른 파일 변환하기'));
  resEl.append(acts);
  resEl.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

if (fixed) {
  if (fixed.kind !== 'text') fileInput.setAttribute('accept', acceptFor(fixed.pageInputs || fixed.inputs));
  if (fixed.multi) fileInput.multiple = true;
}
if (isMain) fileInput.multiple = true;
refresh();
