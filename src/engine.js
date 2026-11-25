// 변환 엔진: 모든 처리는 브라우저 안에서 일어난다. 파일은 서버로 가지 않는다.
// run(entry, { files, text, opts, onProgress }) -> [{ name, blob, note? }]

const ROOT = new URL('../', import.meta.url).href;
const V = ROOT + 'vendor/';
const FFMPEG_CORES = [
  V + 'ffmpeg/core', // 우리 사이트에서 직접 제공 (막히면 아래 CDN 으로 넘어간다)
  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd',
  'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd',
];

const ALIAS = { jpeg: 'jpg', jfif: 'jpg', tif: 'tiff', heif: 'heic', htm: 'html', markdown: 'md' };
export function normExt(name) {
  const m = /\.([^.\\/]+)$/.exec(name || '');
  const e = m ? m[1].toLowerCase() : '';
  return ALIAS[e] || e;
}
const baseName = (name) => (name || 'file').replace(/\.[^.\\/]+$/, '');
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const PDF_MIME = 'application/pdf';
const PDF_ERR = '암호가 걸렸거나 손상된 PDF라서 열 수 없어요.';

// ───────── 취소
let cancelFlag = false;
let ffmpegInst = null;
const checkCancel = () => { if (cancelFlag) throw new Error('취소했어요.'); };
export function cancelRun() {
  cancelFlag = true;
  if (ffmpegInst) { try { ffmpegInst.terminate(); } catch { /* 이미 끝남 */ } ffmpegInst = null; ffmpegPromise = null; }
}

// ───────── 라이브러리 지연 로딩
const loaded = {};
function loadScript(src) {
  return (loaded[src] ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = () => { delete loaded[src]; s.remove(); rej(new Error('필요한 구성요소를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.')); };
    document.head.appendChild(s);
  }));
}

// ───────── 이미지 디코딩 → canvas
function canvasToBlob(canvas, mime, q) {
  return new Promise((res, rej) =>
    canvas.toBlob((b) => {
      if (!b) return rej(new Error('이미지를 만들지 못했습니다. 이 브라우저에서 지원하지 않는 형식이거나 이미지가 너무 클 수 있습니다.'));
      // Safari 등은 WebP 를 못 만들고 조용히 PNG 로 돌려준다
      if (mime === 'image/webp' && b.type !== 'image/webp') return rej(new Error('이 브라우저는 WebP 저장을 지원하지 않아요. PNG나 JPG로 변환해 보세요.'));
      res(b);
    }, mime, q));
}
function imgFromBlob(blob) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { res({ img, url }); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('이미지를 읽을 수 없습니다. 손상된 파일이거나 지원하지 않는 형식입니다.')); };
    img.src = url;
  });
}
function toCanvas(source, w, h, bg) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  g.drawImage(source, 0, 0, w, h);
  return c;
}
// 단계적으로 줄여서 작은 크기에서도 선명하게
function smoothScale(src, tw, th) {
  let cur = src;
  while (cur.width / 2 > tw && cur.height / 2 > th) cur = toCanvas(cur, Math.ceil(cur.width / 2), Math.ceil(cur.height / 2));
  const c = document.createElement('canvas');
  c.width = tw; c.height = th;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(cur, 0, 0, tw, th);
  return c;
}
// 기기가 만들 수 있는 캔버스 크기 한계 (아이폰 사파리는 약 1,600만 화소)
function maxPixels() {
  const phone = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return phone || coarse ? 16e6 : 120e6;
}
function drawFit(src, w, h, bg) {
  const k = w * h > maxPixels() ? Math.sqrt(maxPixels() / (w * h)) : 1;
  return toCanvas(src, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)), bg);
}
// 파일 앞부분으로 실제 형식을 알아낸다 (이름만 .heic 이고 실제는 JPG 인 경우 등)
async function sniff(file) {
  const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const s = (o, n) => String.fromCharCode(...b.slice(o, o + n));
  if (s(4, 4) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(s(8, 4))) return 'heic';
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a)) return 'tiff';
  return '';
}
export async function decodeImage(file, bg) {
  if (!file.size) throw new Error('빈 파일이에요.');
  let ext = normExt(file.name);
  if (ext !== 'svg') ext = (await sniff(file)) || (ext === 'heic' || ext === 'tiff' ? '' : ext);
  if (ext === 'heic') {
    await loadScript(V + 'heic2any.min.js');
    let out;
    try { out = await window.heic2any({ blob: file, toType: 'image/png' }); }
    catch (e) { throw new Error('HEIC 파일을 읽을 수 없어요. 손상되었거나 지원하지 않는 HEIC 일 수 있어요.'); }
    if (Array.isArray(out)) out = out[0];
    const bmp = await createImageBitmap(out);
    const c = drawFit(bmp, bmp.width, bmp.height, bg);
    bmp.close?.();
    return c;
  }
  if (ext === 'tiff') {
    await loadScript(V + 'pako.min.js');
    await loadScript(V + 'UTIF.js');
    const buf = await file.arrayBuffer();
    const ifds = window.UTIF.decode(buf);
    if (!ifds.length) throw new Error('TIFF 파일을 읽을 수 없습니다.');
    window.UTIF.decodeImage(buf, ifds[0]);
    const rgba = window.UTIF.toRGBA8(ifds[0]);
    const w = ifds[0].width, h = ifds[0].height;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer), w, h), 0, 0);
    g.drawImage(tmp, 0, 0);
    return c;
  }
  if (ext === 'svg') {
    const { img, url } = await imgFromBlob(new Blob([await file.text()], { type: 'image/svg+xml' }));
    let w = img.naturalWidth || 1024, h = img.naturalHeight || 1024;
    const s = w < 1024 ? 1024 / w : 1; // 작은 SVG 는 선명하게 키움
    w = Math.round(w * s); h = Math.round(h * s);
    const c = toCanvas(img, w, h, bg);
    URL.revokeObjectURL(url);
    return c;
  }
  try {
    const bmp = await createImageBitmap(file);
    const c = drawFit(bmp, bmp.width, bmp.height, bg);
    bmp.close?.();
    return c;
  } catch {
    const { img, url } = await imgFromBlob(file);
    const c = drawFit(img, img.naturalWidth, img.naturalHeight, bg);
    URL.revokeObjectURL(url);
    return c;
  }
}

// ───────── 이미지 계열
async function hImage(entry, { files, onProgress }) {
  const to = entry.output;
  const out = [];
  for (let i = 0; i < files.length; i++) {
    checkCancel();
    onProgress?.(i / files.length, `${i + 1}/${files.length} 변환 중`);
    const c = await decodeImage(files[i], to === 'jpg' ? '#ffffff' : null);
    out.push({ name: `${baseName(files[i].name)}.${to}`, blob: await canvasToBlob(c, MIME[to], 0.92) });
  }
  return out;
}
// 목표 용량(바이트) 이하가 되도록 화질을 이분탐색하고, 안 되면 크기를 줄여 다시 시도
async function encodeUnder(c0, targetBytes) {
  let c = c0;
  for (let attempt = 0; attempt < 6; attempt++) {
    let lo = 0.15, hi = 0.95, best = null;
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) / 2;
      const b = await canvasToBlob(c, 'image/jpeg', mid);
      if (b.size <= targetBytes) { best = b; lo = mid; } else hi = mid;
    }
    if (best) return best;
    c = toCanvas(c, Math.max(16, Math.round(c.width * 0.8)), Math.max(16, Math.round(c.height * 0.8)), '#ffffff');
  }
  return canvasToBlob(c, 'image/jpeg', 0.15);
}
async function hCompress(entry, { files, opts, onProgress }) {
  const q = (opts?.quality ?? 70) / 100;
  const target = (opts?.targetKB || 0) * 1024;
  const out = [];
  for (let i = 0; i < files.length; i++) {
    checkCancel();
    onProgress?.(i / files.length, `${i + 1}/${files.length} 압축 중`);
    const c = await decodeImage(files[i], '#ffffff');
    const blob = target ? await encodeUnder(c, target) : await canvasToBlob(c, 'image/jpeg', q);
    const src = normExt(files[i].name);
    // 압축했더니 오히려 커졌으면 원본 유지 (목표 용량을 지정한 경우는 결과를 그대로 줌)
    const keep = !target && blob.size >= files[i].size;
    out.push({ name: keep ? files[i].name : `${baseName(files[i].name)}_compressed.jpg`, blob: keep ? files[i] : blob,
      note: keep ? '이미 충분히 작아서 원본 그대로예요.'
        : (src === 'png' || src === 'webp') ? 'JPG로 저장돼서 투명한 배경은 흰색이 돼요.' : undefined });
  }
  return out;
}
async function hResize(entry, { files, opts, onProgress }) {
  const maxW = opts?.width ?? 1280;
  const out = [];
  for (let i = 0; i < files.length; i++) {
    checkCancel();
    onProgress?.(i / files.length, `${i + 1}/${files.length} 크기 조절 중`);
    const src = normExt(files[i].name);
    const to = src === 'png' || src === 'webp' ? src : 'jpg';
    const c0 = await decodeImage(files[i], to === 'jpg' ? '#ffffff' : null);
    const r = Math.min(1, maxW / c0.width);
    const c = r < 1 ? smoothScale(c0, Math.round(c0.width * r), Math.round(c0.height * r)) : c0;
    out.push({ name: `${baseName(files[i].name)}_${r < 1 ? `${maxW}px` : 'resized'}.${to}`, blob: await canvasToBlob(c, MIME[to], 0.92),
      note: r < 1 ? undefined : `이미 ${maxW}px보다 작아서 크기는 그대로예요. (확대는 하지 않아요)` });
  }
  return out;
}
// 다시 그리기만 하면 EXIF(위치·기기 정보)가 사라진다
async function hExif(entry, { files, onProgress }) {
  const out = [];
  for (let i = 0; i < files.length; i++) {
    checkCancel();
    onProgress?.(i / files.length, `${i + 1}/${files.length} 처리 중`);
    const src = normExt(files[i].name);
    const to = src === 'png' || src === 'webp' ? src : 'jpg';
    const c = await decodeImage(files[i], to === 'jpg' ? '#ffffff' : null);
    out.push({ name: `${baseName(files[i].name)}_clean.${to}`, blob: await canvasToBlob(c, MIME[to], 0.95) });
  }
  return out;
}
async function hStitch(entry, { files, opts, onProgress }) {
  if (files.length < 2) throw new Error('이어붙이려면 이미지를 2개 이상 올려 주세요.');
  const vertical = (opts?.dir ?? 'v') === 'v';
  const cs = [];
  for (let i = 0; i < files.length; i++) {
    checkCancel();
    onProgress?.(i / files.length / 2, `${i + 1}/${files.length} 읽는 중`);
    cs.push(await decodeImage(files[i], '#ffffff'));
  }
  const common = Math.min(Math.max(...cs.map((c) => (vertical ? c.width : c.height))), 3000);
  const parts = cs.map((c) => {
    const k = common / (vertical ? c.width : c.height);
    return { c, w: Math.round(c.width * k), h: Math.round(c.height * k) };
  });
  const total = parts.reduce((a, p) => a + (vertical ? p.h : p.w), 0);
  if (total > 30000) throw new Error('이어붙인 결과가 너무 커서 만들 수 없어요. 이미지 수를 줄이거나 나눠서 해 주세요.');
  const out = document.createElement('canvas');
  out.width = vertical ? common : total; out.height = vertical ? total : common;
  const g = out.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, out.width, out.height);
  g.imageSmoothingQuality = 'high';
  let pos = 0;
  for (const p of parts) {
    if (vertical) { g.drawImage(p.c, 0, pos, p.w, p.h); pos += p.h; } else { g.drawImage(p.c, pos, 0, p.w, p.h); pos += p.w; }
  }
  onProgress?.(0.9, '저장하는 중');
  return [{ name: 'merged.jpg', blob: await canvasToBlob(out, 'image/jpeg', 0.92) }];
}
async function hIco(entry, { files, opts, onProgress }) {
  const sizes = opts?.set === 'full' ? [16, 24, 32, 48, 64, 128, 256] : [16, 32, 48];
  const out = [];
  for (let i = 0; i < files.length; i++) {
    checkCancel();
    onProgress?.(i / files.length, `${i + 1}/${files.length} 만드는 중`);
    const c = await decodeImage(files[i], null);
    const pngs = [];
    for (const s of sizes) {
      const k = Math.min(s / c.width, s / c.height);
      const w = Math.max(1, Math.round(c.width * k)), h = Math.max(1, Math.round(c.height * k));
      const sq = document.createElement('canvas');
      sq.width = sq.height = s;
      sq.getContext('2d').drawImage(smoothScale(c, w, h), (s - w) / 2, (s - h) / 2);
      pngs.push(new Uint8Array(await (await canvasToBlob(sq, 'image/png')).arrayBuffer()));
    }
    const head = 6 + 16 * sizes.length;
    const buf = new ArrayBuffer(head + pngs.reduce((a, b) => a + b.length, 0));
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    dv.setUint16(2, 1, true); dv.setUint16(4, sizes.length, true);
    let off = head;
    sizes.forEach((s, j) => {
      const e = 6 + 16 * j;
      dv.setUint8(e, s >= 256 ? 0 : s); dv.setUint8(e + 1, s >= 256 ? 0 : s);
      dv.setUint16(e + 4, 1, true); dv.setUint16(e + 6, 32, true);
      dv.setUint32(e + 8, pngs[j].length, true); dv.setUint32(e + 12, off, true);
      u8.set(pngs[j], off); off += pngs[j].length;
    });
    out.push({ name: `${baseName(files[i].name)}.ico`, blob: new Blob([buf], { type: 'image/x-icon' }) });
  }
  return out;
}

// ───────── PDF
async function pdfLib() { await loadScript(V + 'pdf-lib.min.js'); return window.PDFLib; }
async function loadPdf(PDFDocument, file) {
  try { return await PDFDocument.load(await file.arrayBuffer()); }
  catch (e) { throw new Error(`${file.name}: ${PDF_ERR}`); }
}
// 글꼴이 안 들어 있는 한글 PDF 도 보이도록 글자 지도(cmaps)·표준 글꼴을 함께 배포해서 넘긴다
async function pdfjs() {
  const m = await import(V + 'pdfjs/pdf.min.js');
  m.GlobalWorkerOptions.workerSrc = V + 'pdfjs/pdf.worker.min.js';
  return m;
}
async function openPdfjs(file) {
  const lib = await pdfjs();
  try {
    return await lib.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      cMapUrl: V + 'pdfjs/cmaps/', cMapPacked: true,
      standardFontDataUrl: V + 'pdfjs/standard_fonts/', wasmUrl: V + 'pdfjs/wasm/', iccUrl: V + 'pdfjs/iccs/',
    }).promise;
  } catch (e) { throw new Error(`${file.name}: ${PDF_ERR}`); }
}
const closePdf = (pdf) => { try { pdf.loadingTask?.destroy?.(); } catch { /* 이미 닫힘 */ } };
// 썸네일용: 쪽 수와 쪽별 미리보기를 만든다.
export async function openPdf(file) {
  const pdf = await openPdfjs(file);
  return {
    n: pdf.numPages,
    async thumb(i, w) {
      const page = await pdf.getPage(i + 1);
      const v1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: w / v1.width });
      const c = document.createElement('canvas');
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      return c;
    },
    destroy() { closePdf(pdf); },
  };
}
async function addImagePage(doc, file) {
  const c = await decodeImage(file, '#ffffff');
  const jpg = await canvasToBlob(c, 'image/jpeg', 0.92);
  const img = await doc.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
  let w = c.width * 0.75, h = c.height * 0.75;
  const m = Math.max(w, h);
  if (m > 2000) { w *= 2000 / m; h *= 2000 / m; }
  const page = doc.addPage([w, h]);
  page.drawImage(img, { x: 0, y: 0, width: w, height: h });
}
async function hImgPdf(entry, { files, onProgress }) {
  const { PDFDocument } = await pdfLib();
  const doc = await PDFDocument.create();
  for (let i = 0; i < files.length; i++) {
    checkCancel();
    onProgress?.(i / files.length, `${i + 1}/${files.length} 처리 중`);
    await addImagePage(doc, files[i]);
  }
  const bytes = await doc.save();
  const name = files.length === 1 ? baseName(files[0].name) : 'images';
  return [{ name: `${name}.pdf`, blob: new Blob([bytes], { type: PDF_MIME }) }];
}
async function hPdfImg(entry, { files, onProgress }) {
  const to = entry.output;
  const out = [];
  for (const f of files) {
    const pdf = await openPdfjs(f);
    for (let p = 1; p <= pdf.numPages; p++) {
      checkCancel();
      onProgress?.((p - 1) / pdf.numPages, `${p}/${pdf.numPages} 페이지 변환 중`);
      const page = await pdf.getPage(p);
      const v1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(2, 4500 / Math.max(v1.width, v1.height)) });
      const c = document.createElement('canvas');
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const g = c.getContext('2d');
      if (to === 'jpg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
      await page.render({ canvasContext: g, viewport: vp }).promise;
      const nm = pdf.numPages === 1 ? baseName(f.name) : `${baseName(f.name)}_${String(p).padStart(2, '0')}`;
      out.push({ name: `${nm}.${to}`, blob: await canvasToBlob(c, MIME[to], 0.92) });
      c.width = c.height = 0;
    }
    closePdf(pdf);
  }
  return out;
}
async function hPdfMerge(entry, { files, onProgress }) {
  if (files.length < 2) throw new Error('합치려면 파일을 2개 이상 올려 주세요.');
  const { PDFDocument } = await pdfLib();
  const doc = await PDFDocument.create();
  for (let i = 0; i < files.length; i++) {
    checkCancel();
    onProgress?.(i / files.length, `${i + 1}/${files.length} 합치는 중`);
    if (normExt(files[i].name) === 'pdf') {
      const src = await loadPdf(PDFDocument, files[i]);
      (await doc.copyPages(src, src.getPageIndices())).forEach((p) => doc.addPage(p));
    } else {
      await addImagePage(doc, files[i]);
    }
  }
  return [{ name: 'merged.pdf', blob: new Blob([await doc.save()], { type: PDF_MIME }) }];
}

// "1-3, 5, 8-" 같은 쪽 범위 → [[1,3],[5,5],[8,total]]
export function parseRanges(str, total) {
  const parts = String(str || '').replace(/[，、]/g, ',').split(/[,\s]+/).filter(Boolean);
  if (!parts.length) throw new Error('쪽 범위를 입력해 주세요. 예: 1-3, 5');
  const num = (s, d) => (s === '' || s === undefined ? d : /^last$/i.test(s) ? total : parseInt(s, 10));
  return parts.map((p) => {
    const m = /^(\d*|last)(?:-(\d*|last))?$/i.exec(p);
    if (!m || (m[1] === '' && !m[2])) throw new Error(`알 수 없는 형식이에요: ${p} (1-3, 5 처럼 입력해 주세요)`);
    const a = num(m[1], 1);
    const b = m[2] === undefined ? a : num(m[2], total);
    if (!(a >= 1 && b >= a && b <= total)) throw new Error(`범위가 올바르지 않아요: ${p} (이 PDF는 1~${total}쪽)`);
    return [a, b];
  });
}
async function hPdfSplit(entry, { files, opts, onProgress }) {
  const { PDFDocument } = await pdfLib();
  const mode = opts?.mode || 'range';
  const out = [];
  for (const f of files) {
    const src = await loadPdf(PDFDocument, f);
    const n = src.getPageCount();
    let groups; // [{ name, idx: [0-based...] }]
    const seq = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a - 1 + k);
    const base = baseName(f.name);
    if (mode === 'range') {
      const rs = parseRanges(opts?.range, n);
      if (opts?.join) groups = [{ name: `${base}_추출`, idx: rs.flatMap(([a, b]) => seq(a, b)) }];
      else groups = rs.map(([a, b]) => ({ name: `${base}_${a === b ? a : `${a}-${b}`}`, idx: seq(a, b) }));
    } else if (mode === 'every') {
      const k = Math.max(1, parseInt(opts?.every, 10) || 1);
      groups = [];
      for (let s = 1; s <= n; s += k) {
        const e = Math.min(n, s + k - 1);
        groups.push({ name: `${base}_${s === e ? s : `${s}-${e}`}`, idx: seq(s, e) });
      }
    } else if (mode === 'half') {
      const h = Math.ceil(n / 2);
      groups = n < 2 ? [{ name: base, idx: seq(1, n) }] : [{ name: `${base}_앞부분`, idx: seq(1, h) }, { name: `${base}_뒷부분`, idx: seq(h + 1, n) }];
    } else if (mode === 'parity') {
      groups = [{ name: `${base}_홀수쪽`, idx: seq(1, n).filter((i) => i % 2 === 0) }, { name: `${base}_짝수쪽`, idx: seq(1, n).filter((i) => i % 2 === 1) }].filter((g) => g.idx.length);
    } else {
      groups = seq(1, n).map((i) => ({ name: `${base}_${String(i + 1).padStart(2, '0')}`, idx: [i] }));
    }
    for (let gi = 0; gi < groups.length; gi++) {
      checkCancel();
      onProgress?.(gi / groups.length, `${gi + 1}/${groups.length} 만드는 중`);
      const d = await PDFDocument.create();
      (await d.copyPages(src, groups[gi].idx)).forEach((p) => d.addPage(p));
      out.push({ name: `${groups[gi].name}.pdf`, blob: new Blob([await d.save()], { type: PDF_MIME }) });
    }
  }
  return out;
}
// 화면에서 정리한 쪽 목록 [{src, rot, blank?}] 그대로 새 PDF 를 만든다.
async function hPdfPages(entry, { files, opts }) {
  const { PDFDocument, degrees } = await pdfLib();
  const f = files[0];
  const src = await loadPdf(PDFDocument, f);
  const pages = opts?.pages;
  if (!pages?.length) throw new Error('남길 쪽이 없어요.');
  const doc = await PDFDocument.create();
  let last = [595.28, 841.89];
  for (const pg of pages) {
    checkCancel();
    if (pg.blank) { doc.addPage(last); continue; }
    const [cp] = await doc.copyPages(src, [pg.src]);
    if (pg.rot) cp.setRotation(degrees((((cp.getRotation().angle + pg.rot) % 360) + 360) % 360));
    doc.addPage(cp);
    const s = cp.getSize(); last = [s.width, s.height];
  }
  const suffix = { delete: '_삭제', extract: '_추출' }[entry.mode] || '_정리';
  return [{ name: `${baseName(f.name)}${suffix}.pdf`, blob: new Blob([await doc.save()], { type: PDF_MIME }) }];
}
const PDF_PRESET = { small: { scale: 1.0, q: 0.5 }, normal: { scale: 1.4, q: 0.7 }, high: { scale: 2.0, q: 0.85 } };
async function hPdfCompress(entry, { files, opts, onProgress }) {
  const { PDFDocument } = await pdfLib();
  const pr = PDF_PRESET[opts?.preset] || PDF_PRESET.normal;
  const out = [];
  for (const f of files) {
    const pdf = await openPdfjs(f);
    const doc = await PDFDocument.create();
    for (let p = 1; p <= pdf.numPages; p++) {
      checkCancel();
      onProgress?.((p - 1) / pdf.numPages, `${p}/${pdf.numPages} 쪽 줄이는 중`);
      const page = await pdf.getPage(p);
      const v1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(pr.scale, 4000 / Math.max(v1.width, v1.height)) });
      const c = document.createElement('canvas');
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      const jpg = await canvasToBlob(c, 'image/jpeg', pr.q);
      c.width = c.height = 0;
      const img = await doc.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
      doc.addPage([v1.width, v1.height]).drawImage(img, { x: 0, y: 0, width: v1.width, height: v1.height });
    }
    closePdf(pdf);
    const blob = new Blob([await doc.save()], { type: PDF_MIME });
    if (blob.size >= f.size) out.push({ name: f.name, blob: f, note: '이미 충분히 작아서 원본 그대로예요.' });
    else out.push({ name: `${baseName(f.name)}_compressed.pdf`, blob });
  }
  return out;
}
// 보이는 방향 좌표(vx,vy)를 회전된 쪽의 실제 좌표로
function mapPoint(rot, W, H, vx, vy) {
  if (rot === 90) return [W - vy, vx];
  if (rot === 180) return [W - vx, H - vy];
  if (rot === 270) return [vy, H - vx];
  return [vx, vy];
}
async function hPdfNum(entry, { files, opts, onProgress }) {
  const { PDFDocument, StandardFonts, degrees, rgb } = await pdfLib();
  const pos = opts?.pos || 'bc', fmt = opts?.fmt || 'n', skip = !!opts?.skipCover;
  const base = { s: 9, m: 11, l: 14 }[opts?.size] || 11;
  const out = [];
  for (const f of files) {
    const doc = await loadPdf(PDFDocument, f);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    const total = skip ? pages.length - 1 : pages.length;
    pages.forEach((page, i) => {
      if (skip && i === 0) return;
      const num = skip ? i : i + 1;
      const text = fmt === 'n/t' ? `${num} / ${total}` : fmt === '-n-' ? `- ${num} -` : `${num}`;
      const rot = (((page.getRotation().angle % 360) + 360) % 360);
      const { width: W, height: H } = page.getSize();
      const VW = rot % 180 ? H : W, VH = rot % 180 ? W : H;
      const fs = base * Math.min(2, Math.max(0.7, Math.min(VW, VH) / 595));
      const tw = font.widthOfTextAtSize(text, fs);
      const margin = Math.min(VW, VH) * 0.04 + 6;
      const vx = pos[1] === 'l' ? margin : pos[1] === 'r' ? VW - margin - tw : (VW - tw) / 2;
      const vy = pos[0] === 'b' ? margin : VH - margin - fs;
      const [x, y] = mapPoint(rot, W, H, vx, vy);
      page.drawText(text, { x, y, size: fs, font, color: rgb(0.2, 0.2, 0.2), rotate: degrees(rot) });
    });
    onProgress?.(0.9, '저장하는 중');
    out.push({ name: `${baseName(f.name)}_번호.pdf`, blob: new Blob([await doc.save()], { type: PDF_MIME }) });
  }
  return out;
}
async function watermarkCanvas(opts) {
  if (opts?.image) {
    const c = await decodeImage(opts.image, null);
    const k = Math.min(1, 900 / c.width);
    return smoothScale(c, Math.round(c.width * k), Math.round(c.height * k));
  }
  const text = (opts?.text || '').trim() || '제출용 사본';
  const font = '700 140px "Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';
  const m = document.createElement('canvas').getContext('2d');
  m.font = font;
  const w = Math.ceil(m.measureText(text).width) + 80, h = 240;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.font = font; g.fillStyle = '#6b7280'; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillText(text, w / 2, h / 2);
  return c;
}
async function hPdfMark(entry, { files, opts, onProgress }) {
  const { PDFDocument, degrees } = await pdfLib();
  const wmc = await watermarkCanvas(opts);
  const wmBytes = new Uint8Array(await (await canvasToBlob(wmc, 'image/png')).arrayBuffer());
  const ratio = wmc.height / wmc.width;
  const opacity = opts?.opacity ?? 0.35;
  const tile = opts?.layout === 'tile';
  const isImg = !!opts?.image;
  const out = [];
  for (const f of files) {
    const doc = await loadPdf(PDFDocument, f);
    const img = await doc.embedPng(wmBytes);
    const pages = doc.getPages();
    pages.forEach((page, pi) => {
      checkCancel();
      onProgress?.(pi / pages.length, `${pi + 1}/${pages.length} 쪽에 넣는 중`);
      const rot = (((page.getRotation().angle % 360) + 360) % 360);
      const { width: W, height: H } = page.getSize();
      const VW = rot % 180 ? H : W, VH = rot % 180 ? W : H;
      const draw = (vcx, vcy, w, deg) => {
        const h = w * ratio;
        const [cx, cy] = mapPoint(rot, W, H, vcx, vcy);
        const d = deg + rot, t = (d * Math.PI) / 180;
        page.drawImage(img, {
          x: cx - ((w / 2) * Math.cos(t) - (h / 2) * Math.sin(t)),
          y: cy - ((w / 2) * Math.sin(t) + (h / 2) * Math.cos(t)),
          width: w, height: h, rotate: degrees(d), opacity,
        });
      };
      if (!tile) draw(VW / 2, VH / 2, isImg ? VW * 0.45 : Math.min(VW * 0.9, VH * 0.9), isImg ? 0 : -45);
      else {
        const cols = 3, rows = Math.max(3, Math.round((3 * VH) / VW * 1.3));
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          draw(((c + 0.5 + (r % 2 ? 0.5 : 0)) * VW) / cols, ((r + 0.5) * VH) / rows, VW * 0.26, isImg ? 0 : -30);
        }
      }
    });
    out.push({ name: `${baseName(f.name)}_워터마크.pdf`, blob: new Blob([await doc.save()], { type: PDF_MIME }) });
  }
  return out;
}

// ───────── 오디오/영상 (ffmpeg.wasm)
let ffmpegPromise = null;
let ffmpegProgress = null;
async function getFFmpeg() {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      await loadScript(V + 'ffmpeg/ffmpeg.js');
      const ff = new window.FFmpegWASM.FFmpeg();
      ff.on('progress', ({ progress }) => ffmpegProgress?.(Math.min(1, Math.max(0, progress))));
      // 한 곳이 막혀 있으면 다른 곳에서 받는다
      const toBlobURL = async (file, type) => {
        let last;
        for (const base of FFMPEG_CORES) {
          try {
            const r = await fetch(`${base}/${file}`);
            if (r.ok) return URL.createObjectURL(new Blob([await r.arrayBuffer()], { type }));
            last = new Error('status ' + r.status);
          } catch (e) { last = e; }
        }
        throw new Error('변환 엔진(약 30MB)을 내려받지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
      };
      await ff.load({
        coreURL: await toBlobURL('ffmpeg-core.js', 'text/javascript'),
        wasmURL: await toBlobURL('ffmpeg-core.wasm', 'application/wasm'),
      });
      ffmpegInst = ff;
      return ff;
    })().catch((e) => { ffmpegPromise = null; throw e; });
  }
  return ffmpegPromise;
}
const A_ARGS = {
  mp3: ['-c:a', 'libmp3lame', '-q:a', '2'],
  wav: ['-c:a', 'pcm_s16le'],
  ogg: ['-c:a', 'libvorbis', '-q:a', '5'],
  m4a: ['-c:a', 'aac', '-b:a', '192k'],
  aac: ['-c:a', 'aac', '-b:a', '192k'],
  flac: ['-c:a', 'flac'],
};
const EVEN = ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2']; // 가로·세로가 홀수인 영상은 H.264 가 거부한다
const V_ARGS = {
  mp4: [...EVEN, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'],
  mov: [...EVEN, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k'],
  mkv: [...EVEN, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k'],
  webm: [...EVEN, '-c:v', 'libvpx', '-crf', '30', '-b:v', '1M', '-c:a', 'libvorbis'],
  avi: [...EVEN, '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'libmp3lame', '-q:a', '4'],
};
const FFMPEG_MAX = 1024 * 1024 * 1024;
const OUT_MIME = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
  mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm', avi: 'video/x-msvideo', gif: 'image/gif' };

// cfg: { args, preIn?, outExt?(f), suffix? }
async function runFfmpeg(entry, { files, onProgress }, cfg) {
  onProgress?.(0, '변환 엔진을 불러오는 중 (처음 한 번만 걸려요)');
  const ff = await getFFmpeg();
  checkCancel();
  const out = [];
  for (let i = 0; i < files.length; i++) {
    checkCancel();
    const f = files[i];
    const ext = cfg.outExt ? cfg.outExt(f) : entry.output;
    const inName = `in_${i}.${normExt(f.name) || 'bin'}`;
    const outName = `out_${i}.${ext}`;
    ffmpegProgress = (p) => onProgress?.((i + p) / files.length, `${i + 1}/${files.length} 변환 중 ${Math.round(p * 100)}%`);
    try {
      if (!f.size) throw new Error('빈 파일이에요.');
      if (f.size > FFMPEG_MAX) throw new Error('파일이 너무 커서 브라우저에서 처리할 수 없어요. (약 1GB 이하만 가능해요)');
      await ff.writeFile(inName, new Uint8Array(await f.arrayBuffer()));
      const args = typeof cfg.args === 'function' ? cfg.args(f) : cfg.args;
      const code = await ff.exec([...(cfg.preIn || []), '-i', inName, ...args, outName]);
      if (code !== 0) {
        throw new Error(entry.kind === 'vidaudio'
          ? '소리를 추출하지 못했습니다. 이 영상에 소리가 없거나 파일이 손상되었을 수 있습니다.'
          : '변환에 실패했습니다. 파일이 손상되었거나 지원하지 않는 코덱일 수 있습니다.');
      }
      const data = await ff.readFile(outName);
      out.push({ name: `${baseName(f.name)}${cfg.suffix || ''}.${ext}`, blob: new Blob([data.buffer], { type: OUT_MIME[ext] }) });
    } catch (e) {
      if (cancelFlag) throw new Error('취소했어요.');
      // 종료 코드가 아니라 예외로 죽었다면 엔진이 망가진 것이므로 다음 변환에서 새로 불러온다
      if (!(e instanceof Error) || /RuntimeError|Aborted|memory|out of bounds|terminate/i.test(`${e.name} ${e.message}`)) {
        try { ff.terminate(); } catch { /* 무시 */ }
        ffmpegPromise = null; ffmpegInst = null;
      }
      throw e;
    } finally {
      ffmpegProgress = null;
      await ff.deleteFile(inName).catch(() => {});
      await ff.deleteFile(outName).catch(() => {});
    }
  }
  return out;
}
export function parseTime(s) {
  s = String(s ?? '').trim();
  if (!s) return null;
  const parts = s.split(':').map((x) => Number(x));
  if (parts.length > 3 || parts.some((x) => !Number.isFinite(x) || x < 0)) throw new Error('시간은 1:30 또는 90 처럼 입력해 주세요.');
  return parts.reduce((a, b) => a * 60 + b, 0);
}
const VIDEO_EXTS = ['mp4', 'mov', 'mkv', 'webm', 'avi'];
const sameExt = (f) => normExt(f.name) || 'mp4';

// -vn: 앨범 아트(커버 이미지)가 든 음원이 M4A/OGG 변환에서 실패하는 것을 막는다
const hAudio = (e, ctx) => runFfmpeg(e, ctx, { args: ['-vn', ...A_ARGS[e.output]] });
const hVidAudio = (e, ctx) => runFfmpeg(e, ctx, { args: ['-vn', ...A_ARGS[e.output]] });
const hVideo = (e, ctx) => runFfmpeg(e, ctx, { args: V_ARGS[e.output] });
const hVidMute = (e, ctx) => runFfmpeg(e, ctx, { args: ['-c:v', 'copy', '-an'], outExt: sameExt, suffix: '_mute' });
function hVidGif(e, ctx) {
  const o = ctx.opts || {};
  const w = o.width || 480, fps = o.fps || 12;
  const start = parseTime(o.start) || 0, len = parseTime(o.len) || 15;
  return runFfmpeg(e, ctx, {
    preIn: start > 0 ? ['-ss', String(start)] : [],
    args: ['-t', String(len), '-vf', `fps=${fps},scale='min(${w},iw)':-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`, '-loop', '0'],
  });
}
const VC = { msg: { h: 480, crf: 30, ab: '96k' }, normal: { h: 720, crf: 26, ab: '128k' }, small: { h: 360, crf: 34, ab: '64k' } };
function hVidCompress(e, ctx) {
  const p = VC[ctx.opts?.preset] || VC.msg;
  return runFfmpeg(e, ctx, {
    args: ['-vf', `scale=-2:'min(${p.h},ih)'`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(p.crf), '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', p.ab, '-movflags', '+faststart'],
    outExt: () => 'mp4', suffix: '_compressed',
  });
}
function hTrim(e, ctx) {
  const o = ctx.opts || {};
  const start = parseTime(o.start) || 0, end = parseTime(o.end);
  if (end != null && end <= start) throw new Error('끝 시간은 시작 시간보다 커야 해요.');
  const precise = !!o.precise;
  const reenc = (f) => (VIDEO_EXTS.includes(normExt(f.name)) ? V_ARGS[normExt(f.name)] : A_ARGS[normExt(f.name)] || []);
  return runFfmpeg(e, ctx, {
    preIn: start > 0 ? ['-ss', String(start)] : [],
    args: (f) => [...(end != null ? ['-t', String(end - start)] : []), ...(precise ? reenc(f) : ['-c', 'copy', '-avoid_negative_ts', 'make_zero'])],
    outExt: sameExt, suffix: '_cut',
  });
}

// ───────── 데이터/문서
async function readTextSmart(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('euc-kr').decode(buf); } // 엑셀에서 저장한 한글 CSV
}
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const NUM_RE = /^(0|-?[1-9]\d{0,14})(\.\d+)?$/;
const pad2 = (n) => String(n).padStart(2, '0');
// 엑셀의 날짜·시간 칸은 CSV·JSON·HTML 에서 읽기 쉬운 글자(yyyy-mm-dd)로 바꾼다. (시간대 영향이 없게 엑셀 일련번호에서 직접 계산)
function stringifyDates(X, ws) {
  for (const k of Object.keys(ws)) {
    if (k[0] === '!') continue;
    const c = ws[k];
    if (!c || c.t !== 'n' || !c.z || !X.SSF.is_date(c.z)) continue;
    const d = X.SSF.parse_date_code(c.v);
    if (!d) continue;
    const hms = `${pad2(d.H)}:${pad2(d.M)}:${pad2(Math.floor(d.S))}`;
    const day = `${d.y}-${pad2(d.m)}-${pad2(d.d)}`;
    const text = c.v > 0 && c.v < 1 ? hms : (d.H || d.M || Math.floor(d.S)) ? `${day} ${hms}` : day;
    c.t = 's'; c.v = text; c.w = text; delete c.z;
  }
}
// CSV 는 글자 그대로 읽고(앞자리 0·긴 숫자 보존), 안전한 숫자만 숫자로 바꾼다
function fixCsvTypes(ws) {
  for (const k of Object.keys(ws)) {
    if (k[0] === '!') continue;
    const c = ws[k];
    if (c && c.t === 's' && NUM_RE.test(String(c.v).trim())) { c.t = 'n'; c.v = Number(c.v); delete c.w; }
  }
}
const flatRow = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v && typeof v === 'object' ? JSON.stringify(v) : v]));
function jsonRows(data) {
  if (Array.isArray(data)) return data.map((x) => (x && typeof x === 'object' && !Array.isArray(x) ? flatRow(x) : { value: Array.isArray(x) ? JSON.stringify(x) : x }));
  if (data && typeof data === 'object') {
    const arrs = Object.values(data).filter(Array.isArray); // {"data":[...]} 같은 감싸기
    return arrs.length === 1 ? jsonRows(arrs[0]) : [flatRow(data)];
  }
  return [{ value: data }];
}
async function hData(entry, { files, onProgress }) {
  await loadScript(V + 'xlsx.full.min.js');
  const X = window.XLSX;
  const from = entry.inputs[0], to = entry.output;
  const out = [];
  for (let i = 0; i < files.length; i++) {
    checkCancel();
    onProgress?.(i / files.length, `${i + 1}/${files.length} 변환 중`);
    const f = files[i];
    if (!f.size) throw new Error('빈 파일이에요.');
    const base = baseName(f.name);
    let wb;
    if (from === 'csv') {
      wb = X.read(await readTextSmart(f), { type: 'string', raw: true });
      wb.SheetNames.forEach((n) => fixCsvTypes(wb.Sheets[n]));
    } else if (from === 'json') {
      let data;
      try { data = JSON.parse(await readTextSmart(f)); } catch { throw new Error('JSON 형식이 올바르지 않아요. 괄호·쉼표·따옴표를 확인해 주세요.'); }
      wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, X.utils.json_to_sheet(jsonRows(data)), 'Sheet1');
    } else {
      const buf = await f.arrayBuffer();
      const h = new Uint8Array(buf.slice(0, 4));
      const zip = h[0] === 0x50 && h[1] === 0x4b, cfb = h[0] === 0xd0 && h[1] === 0xcf && h[2] === 0x11 && h[3] === 0xe0;
      if (!zip && !cfb) throw new Error('엑셀 파일이 아니거나 손상된 파일이에요.');
      wb = X.read(buf, { type: 'array', cellNF: true });
      if (to !== 'xlsx') wb.SheetNames.forEach((n) => stringifyDates(X, wb.Sheets[n]));
    }

    if (to === 'xlsx') {
      const bytes = X.write(wb, { bookType: 'xlsx', type: 'array' });
      out.push({ name: `${base}.xlsx`, blob: new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) });
    } else if (to === 'csv') {
      const names = wb.SheetNames;
      for (const sn of names) {
        const csv = '﻿' + X.utils.sheet_to_csv(wb.Sheets[sn]); // BOM: 엑셀에서 한글 안 깨지게
        out.push({ name: names.length === 1 ? `${base}.csv` : `${base}_${sn}.csv`, blob: new Blob([csv], { type: 'text/csv;charset=utf-8' }) });
      }
    } else if (to === 'html') {
      const one = wb.SheetNames.length === 1;
      const body = wb.SheetNames.map((sn) => (one ? '' : `<h2>${escHtml(sn)}</h2>`) + X.utils.sheet_to_html(wb.Sheets[sn], { header: '', footer: '' })).join('\n');
      const css = 'table{border-collapse:collapse;font:14px sans-serif}td,th{border:1px solid #ccc;padding:4px 8px}';
      const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'none'"><title>${escHtml(base)}</title><style>${css}</style><body>${body}</body></html>`;
      out.push({ name: `${base}.html`, blob: new Blob([html], { type: 'text/html;charset=utf-8' }) });
    } else if (to === 'json') {
      const rows = (sn) => X.utils.sheet_to_json(wb.Sheets[sn], { defval: '' });
      const obj = wb.SheetNames.length === 1 ? rows(wb.SheetNames[0]) : Object.fromEntries(wb.SheetNames.map((s) => [s, rows(s)]));
      const json = JSON.stringify(obj, null, 2);
      out.push({ name: `${base}.json`, blob: new Blob([json], { type: 'application/json' }) });
    }
  }
  return out;
}
async function hDocx(entry, { files, onProgress }) {
  await loadScript(V + 'mammoth.browser.min.js');
  const out = [];
  for (let i = 0; i < files.length; i++) {
    checkCancel();
    onProgress?.(i / files.length, `${i + 1}/${files.length} 변환 중`);
    const arrayBuffer = await files[i].arrayBuffer();
    if (entry.output === 'txt') {
      const r = await window.mammoth.extractRawText({ arrayBuffer });
      out.push({ name: `${baseName(files[i].name)}.txt`, blob: new Blob([r.value], { type: 'text/plain;charset=utf-8' }) });
    } else {
      const r = await window.mammoth.convertToHtml({ arrayBuffer });
      const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'none'"><title>${escHtml(baseName(files[i].name))}</title><body>${r.value}</body></html>`;
      out.push({ name: `${baseName(files[i].name)}.html`, blob: new Blob([html], { type: 'text/html;charset=utf-8' }) });
    }
  }
  return out;
}
async function hHwpx(entry, { files, onProgress }) {
  await loadScript(V + 'jszip.min.js');
  const out = [];
  for (let i = 0; i < files.length; i++) {
    checkCancel();
    onProgress?.(i / files.length, `${i + 1}/${files.length} 변환 중`);
    const zip = await window.JSZip.loadAsync(await files[i].arrayBuffer());
    const sections = Object.keys(zip.files)
      .filter((n) => /^Contents\/section\d+\.xml$/i.test(n))
      .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
    if (!sections.length) throw new Error('HWPX 파일 구조를 읽을 수 없습니다. (HWP 구버전 파일은 한글에서 HWPX로 저장 후 올려 주세요)');
    const lines = [];
    for (const sn of sections) {
      const xml = new DOMParser().parseFromString(await zip.files[sn].async('string'), 'application/xml');
      const groups = new Map();
      for (const t of xml.getElementsByTagNameNS('*', 't')) {
        let p = t.parentNode;
        while (p && p.localName !== 'p') p = p.parentNode;
        if (!p) continue;
        groups.set(p, (groups.get(p) || '') + t.textContent);
      }
      for (const v of groups.values()) lines.push(v);
    }
    out.push({ name: `${baseName(files[i].name)}.txt`, blob: new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }) });
  }
  return out;
}
// PDF 안의 글자(텍스트)만 뽑아 TXT 로. 스캔본(이미지) PDF 는 글자가 없어서 빈 결과가 된다.
async function hPdfText(entry, { files, onProgress }) {
  const out = [];
  for (const f of files) {
    const pdf = await openPdfjs(f);
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      checkCancel();
      onProgress?.((p - 1) / pdf.numPages, `${p}/${pdf.numPages} 쪽 읽는 중`);
      const tc = await (await pdf.getPage(p)).getTextContent();
      pages.push(tc.items.map((it) => it.str + (it.hasEOL ? '\n' : '')).join('').replace(/[ \t]+\n/g, '\n').trim());
    }
    closePdf(pdf);
    const text = pages.join('\n\n');
    if (!text.trim()) throw new Error(`${f.name}: 글자를 찾지 못했어요. 스캔한 이미지로 된 PDF는 글자 추출이 안 돼요.`);
    out.push({ name: `${baseName(f.name)}.txt`, blob: new Blob([text], { type: 'text/plain;charset=utf-8' }) });
  }
  return out;
}
// 인코딩을 알아내 UTF-8 로 다시 저장 (한글 깨짐 고치기)
async function hEncoding(entry, { files }) {
  const out = [];
  for (const f of files) {
    const b = new Uint8Array(await f.arrayBuffer());
    let text, how;
    if (b[0] === 0xff && b[1] === 0xfe) { text = new TextDecoder('utf-16le').decode(b); how = 'UTF-16'; }
    else if (b[0] === 0xfe && b[1] === 0xff) { text = new TextDecoder('utf-16be').decode(b); how = 'UTF-16'; }
    else {
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(b); how = 'UTF-8'; }
      catch { text = new TextDecoder('euc-kr').decode(b); how = 'EUC-KR(CP949)'; }
    }
    const ext = normExt(f.name) || 'txt';
    const bom = ext === 'csv' ? '﻿' : ''; // 엑셀에서 열 때 한글이 깨지지 않게
    out.push({ name: `${baseName(f.name)}_utf8.${ext}`, blob: new Blob([bom + text], { type: `text/${ext === 'csv' ? 'csv' : 'plain'};charset=utf-8` }),
      note: how === 'UTF-8' ? '이미 UTF-8 이었어요. 내용은 그대로예요.' : `${how} 로 읽어서 UTF-8 로 저장했어요.` });
  }
  return out;
}

// ───────── 텍스트 → PDF / 이미지
const PAGE_W = 1588, PAGE_H = 2246, MARGIN = 140, FONT_PX = 34, LINE_H = 56; // A4, 약 191dpi
const FONT = `${FONT_PX}px "Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif`;
function wrapLines(g, text, maxW) {
  const lines = [];
  for (const raw of text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')) {
    if (raw === '') { lines.push(''); continue; }
    let cur = '';
    for (const tok of raw.match(/\S+\s*|\s+/g) || []) { // 단어+뒤따르는 공백 (lookbehind 는 구형 사파리에서 안 돼서 쓰지 않음)
      if (g.measureText(cur + tok).width <= maxW) { cur += tok; continue; }
      if (cur) { lines.push(cur.trimEnd()); cur = ''; }
      if (g.measureText(tok).width <= maxW) { cur = tok; continue; }
      for (const ch of tok) { // 단어가 한 줄보다 길면 글자 단위로 자름
        if (g.measureText(cur + ch).width > maxW) { lines.push(cur); cur = ''; }
        cur += ch;
      }
    }
    lines.push(cur.trimEnd());
  }
  return lines;
}
async function hText(entry, { text, onProgress }) {
  if (!text || !text.trim()) throw new Error('변환할 텍스트를 입력해 주세요.');
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = FONT;
  const lines = wrapLines(probe, text, PAGE_W - MARGIN * 2);
  const perPage = Math.floor((PAGE_H - MARGIN * 2) / LINE_H);
  const pages = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  const to = entry.output;
  // 한 쪽씩 그려서 바로 인코딩하고 캔버스를 비운다 (긴 글에서도 메모리가 늘지 않게)
  const renderPage = async (pl, pi, q) => {
    checkCancel();
    onProgress?.(pi / pages.length, `${pi + 1}/${pages.length} 페이지 만드는 중`);
    const c = document.createElement('canvas');
    c.width = PAGE_W; c.height = PAGE_H;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, PAGE_W, PAGE_H);
    g.fillStyle = '#111'; g.font = FONT; g.textBaseline = 'top';
    pl.forEach((ln, li) => g.fillText(ln, MARGIN, MARGIN + li * LINE_H));
    const blob = await canvasToBlob(c, to === 'pdf' ? 'image/jpeg' : MIME[to], q);
    c.width = c.height = 0;
    return blob;
  };
  if (to === 'pdf') {
    const { PDFDocument } = await pdfLib();
    const doc = await PDFDocument.create();
    for (let i = 0; i < pages.length; i++) {
      const jpg = await renderPage(pages[i], i, 0.8);
      const img = await doc.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
      doc.addPage([595.28, 841.89]).drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
    }
    return [{ name: 'text.pdf', blob: new Blob([await doc.save()], { type: PDF_MIME }) }];
  }
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    out.push({ name: pages.length === 1 ? `text.${to}` : `text_${String(i + 1).padStart(2, '0')}.${to}`, blob: await renderPage(pages[i], i, 0.92) });
  }
  return out;
}

const handlers = {
  image: hImage, compress: hCompress, resize: hResize, exif: hExif, stitch: hStitch, ico: hIco,
  imgpdf: hImgPdf, pdfimg: hPdfImg, pdfmerge: hPdfMerge, pdfsplit: hPdfSplit, pdfpages: hPdfPages,
  pdfcompress: hPdfCompress, pdfnum: hPdfNum, pdfmark: hPdfMark, pdftext: hPdfText,
  audio: hAudio, vidaudio: hVidAudio, video: hVideo, vidgif: hVidGif, vidcompress: hVidCompress, trim: hTrim, vidmute: hVidMute,
  data: hData, docx: hDocx, hwpx: hHwpx, encoding: hEncoding, text: hText,
};
// 파일마다 따로 처리해도 되는 종류: 하나가 실패해도 나머지는 계속한다.
const PERFILE = new Set(['image', 'compress', 'resize', 'exif', 'ico', 'pdfimg', 'pdfsplit', 'pdfcompress', 'pdfnum', 'pdfmark', 'pdftext',
  'audio', 'vidaudio', 'video', 'vidgif', 'vidcompress', 'trim', 'vidmute', 'data', 'docx', 'hwpx', 'encoding']);

// 라이브러리가 내는 영어·내부 오류를 알아보기 쉬운 한국어로 (원문은 콘솔에 남김)
export function friendly(e) {
  const msg = String(e?.message ?? e ?? '');
  const raw = `${e?.name || ''} ${msg}`;
  if (/[가-힣]/.test(msg)) return msg; // 이미 한국어 안내
  console.error(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(raw)) return '변환에 필요한 구성요소를 내려받지 못했어요. 인터넷 연결을 확인해 주세요.';
  if (/RuntimeError|Aborted|out of memory|memory access|out of bounds/i.test(raw)) return '기기의 메모리가 부족하거나 처리 중 문제가 생겼어요. 파일 크기를 줄이거나 컴퓨터에서 시도해 보세요.';
  if (/central directory|zip file|end of central/i.test(raw)) return '문서 파일이 손상됐거나 올바른 형식이 아니에요.';
  if (/JSON|Unexpected token/i.test(raw)) return 'JSON 형식이 올바르지 않아요.';
  if (/PDF|Invalid PDF|No PDF header/i.test(raw)) return 'PDF를 읽을 수 없어요. 손상되었거나 암호가 걸린 파일일 수 있어요.';
  if (/heic|libheif/i.test(raw)) return 'HEIC 파일을 읽을 수 없어요. 손상되었거나 지원하지 않는 형식일 수 있어요.';
  return '변환하지 못했어요. 파일이 손상되었거나 지원하지 않는 형식일 수 있어요.';
}

export async function run(entry, ctx) {
  const h = handlers[entry.kind];
  if (!h) throw new Error('지원하지 않는 변환입니다.');
  cancelFlag = false;
  const files = ctx.files || [];
  if (!PERFILE.has(entry.kind) || files.length < 2) {
    try { return await h(entry, ctx); } catch (e) { throw cancelFlag ? new Error('취소했어요.') : new Error(friendly(e)); }
  }
  const out = [], errors = [];
  for (let i = 0; i < files.length; i++) {
    checkCancel();
    try {
      const r = await h(entry, {
        ...ctx, files: [files[i]],
        onProgress: (p, m) => ctx.onProgress?.((i + p) / files.length, m ? `(${i + 1}/${files.length}) ${m}` : undefined),
      });
      out.push(...r);
    } catch (e) {
      if (cancelFlag) throw new Error('취소했어요.');
      const m = friendly(e);
      errors.push(m.startsWith(files[i].name) ? m : `${files[i].name}: ${m}`);
    }
  }
  if (!out.length) throw new Error(errors.length > 1 ? `모든 파일이 실패했어요. ${errors[0]}` : errors[0]);
  out.errors = errors;
  return out;
}

export async function zipAll(items) {
  await loadScript(V + 'jszip.min.js');
  const zip = new window.JSZip();
  const used = new Set();
  for (const it of items) {
    let n = it.name, k = 1;
    while (used.has(n)) n = it.name.replace(/(\.[^.]+)?$/, `_${k++}$1`);
    used.add(n);
    zip.file(n, it.blob);
  }
  return zip.generateAsync({ type: 'blob' });
}
