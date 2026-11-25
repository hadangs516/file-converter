// PDF 쪽 썸네일 그리드: 순서 바꾸기·회전·복제·삭제(정리) / 클릭 선택(삭제·추출)
import { openPdf } from './engine.js';

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

// mode: 'organize' | 'delete' | 'extract'
export async function createGrid(file, mode, onChange) {
  const handle = await openPdf(file);
  const n = handle.n;
  const pages = Array.from({ length: n }, (_, i) => ({ src: i, rot: 0, sel: false }));
  const ready = new Map(); // src -> 썸네일 canvas
  const pending = new Set();
  let chain = Promise.resolve();
  let dead = false;
  const selectMode = mode !== 'organize';

  const root = el('div', { class: 'pgrid' });
  const bar = el('div', { class: 'pbar' });
  const info = el('span', { class: 'pinfo' });
  const grid = el('div', { class: 'pcards' });

  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      io.unobserve(en.target);
      ensure(+en.target.dataset.src).then(() => { if (!dead) paint(en.target); });
    }
  }, { rootMargin: '300px' });

  function ensure(src) {
    if (ready.has(src)) return Promise.resolve();
    if (pending.has(src)) return chain;
    pending.add(src);
    chain = chain.then(async () => {
      if (dead) return;
      try { ready.set(src, await handle.thumb(src, 220)); } catch { ready.set(src, null); }
      pending.delete(src);
    });
    return chain;
  }

  function paint(card) {
    const cv = card.querySelector('canvas');
    const pg = pages[+card.dataset.i];
    if (!pg || !cv) return;
    const g = cv.getContext('2d');
    if (pg.blank) {
      cv.width = 220; cv.height = 311;
      g.fillStyle = '#fff'; g.fillRect(0, 0, 220, 311);
      return;
    }
    const s = ready.get(pg.src);
    if (!s) return;
    const w = s.width, h = s.height;
    const sw = pg.rot % 180 ? h : w, sh = pg.rot % 180 ? w : h;
    cv.width = sw; cv.height = sh;
    g.save();
    g.translate(sw / 2, sh / 2);
    g.rotate((pg.rot * Math.PI) / 180);
    g.drawImage(s, -w / 2, -h / 2);
    g.restore();
  }

  const btn = (label, title, fn, wide) => el('button', { type: 'button', class: 'pb' + (wide ? ' wide' : ''), title, 'aria-label': title, onclick: (e) => { e.stopPropagation(); fn(); } }, label);
  const changed = () => { render(); onChange?.(); };
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= pages.length) return;
    [pages[i], pages[j]] = [pages[j], pages[i]];
    changed();
  };

  function finalPages() {
    if (mode === 'delete') return pages.filter((p) => !p.sel);
    if (mode === 'extract') return pages.filter((p) => p.sel);
    return pages;
  }

  let dragFrom = -1, lastSel = -1;
  function render() {
    io.disconnect();
    grid.replaceChildren(...pages.map((pg, i) => {
      const cv = el('canvas', { 'aria-hidden': 'true' });
      const card = el('div', { class: 'pcard' + (pg.sel ? ' sel' : ''), 'data-i': String(i), 'data-src': String(pg.src) },
        el('div', { class: 'pth' }, cv), el('span', { class: 'pno' }, String(i + 1)));
      if (selectMode) {
        card.append(el('span', { class: 'pchk', 'aria-hidden': 'true' }, '✓'));
        card.tabIndex = 0;
        card.setAttribute('role', 'checkbox');
        card.setAttribute('aria-checked', String(pg.sel));
        const toggle = (shift) => {
          if (shift && lastSel >= 0) {
            const [a, b] = [Math.min(lastSel, i), Math.max(lastSel, i)];
            for (let k = a; k <= b; k++) pages[k].sel = true;
          } else pg.sel = !pg.sel;
          lastSel = i;
          changed();
        };
        card.addEventListener('click', (e) => toggle(e.shiftKey));
        card.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(false); } });
      } else {
        card.draggable = true;
        card.addEventListener('dragstart', (e) => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); card.classList.add('drag'); });
        card.addEventListener('dragend', () => card.classList.remove('drag'));
        card.addEventListener('dragover', (e) => { if (dragFrom >= 0) { e.preventDefault(); card.classList.add('over'); } });
        card.addEventListener('dragleave', () => card.classList.remove('over'));
        card.addEventListener('drop', (e) => {
          e.preventDefault(); e.stopPropagation();
          if (dragFrom < 0 || dragFrom === i) return;
          const [m] = pages.splice(dragFrom, 1);
          pages.splice(i, 0, m);
          dragFrom = -1;
          changed();
        });
        card.append(el('div', { class: 'pctl' },
          btn('◀', '앞으로', () => move(i, -1)),
          btn('↻', '오른쪽으로 돌리기', () => { pg.rot = (pg.rot + 90) % 360; changed(); }),
          btn('⧉', '복제', () => { pages.splice(i + 1, 0, { ...pg }); changed(); }),
          btn('✕', '삭제', () => { pages.splice(i, 1); changed(); }),
          btn('▶', '뒤로', () => move(i, 1))));
      }
      if (ready.has(pg.src) || pg.blank) paint(card); else io.observe(card);
      return card;
    }));
    info.textContent = selectMode
      ? `${pages.filter((p) => p.sel).length}쪽 선택 · 전체 ${n}쪽`
      : `${pages.length}쪽${pages.length !== n ? ` (원래 ${n}쪽)` : ''}`;
  }

  // 도구 모음
  if (mode === 'organize') {
    bar.append(
      btn('전체 돌리기', '모든 쪽을 오른쪽으로 돌리기', () => { pages.forEach((p) => { p.rot = (p.rot + 90) % 360; }); changed(); }, true),
      btn('순서 뒤집기', '순서를 거꾸로', () => { pages.reverse(); changed(); }, true),
      btn('빈 쪽 추가', '맨 뒤에 빈 쪽 추가', () => { pages.push({ blank: true, rot: 0, sel: false }); changed(); }, true),
    );
  } else {
    const setSel = (f) => { pages.forEach((p, i) => { p.sel = f(i); }); lastSel = -1; changed(); };
    bar.append(
      btn('홀수 쪽', '홀수 쪽만 선택', () => setSel((i) => i % 2 === 0), true),
      btn('짝수 쪽', '짝수 쪽만 선택', () => setSel((i) => i % 2 === 1), true),
      btn('전체 선택', '전체 선택', () => setSel(() => true), true),
      btn('선택 해제', '선택 해제', () => setSel(() => false), true),
    );
  }
  bar.append(info);
  const hint = el('p', { class: 'phint' }, selectMode
    ? '쪽을 눌러 선택하세요. Shift+클릭으로 여러 쪽을 한 번에 고를 수 있어요.'
    : '쪽을 끌어서 순서를 바꾸세요. 버튼으로 돌리거나 복제·삭제할 수 있어요.');
  root.append(bar, hint, grid);
  render();

  return {
    el: root,
    pages: () => finalPages().map((p) => ({ src: p.src, rot: p.rot, blank: !!p.blank })),
    error() {
      const k = finalPages().length;
      if (mode === 'delete') return k === 0 ? '모든 쪽을 지울 수는 없어요.' : pages.some((p) => p.sel) ? '' : '지울 쪽을 눌러 선택해 주세요.';
      if (mode === 'extract') return k === 0 ? '남길 쪽을 눌러 선택해 주세요.' : '';
      return k === 0 ? '쪽이 하나도 없어요.' : '';
    },
    destroy() { dead = true; io.disconnect(); handle.destroy(); },
  };
}
