// 빌드: src/registry.mjs 의 변환 목록으로 dist/ 에 사이트 전체를 만든다.
// 사용: npm run build   →  dist/ 폴더를 도메인의 원하는 하위경로(예: /convert/)에 그대로 올리면 된다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { conversions, roEuro } from './src/registry.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
const NM = path.join(ROOT, 'node_modules');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
const BASE = (process.env.BASE_URL || cfg.baseUrl).replace(/\/$/, '');
const PROD = process.argv.includes('--prod');
if (/YOUR-DOMAIN/.test(BASE)) {
  const msg = '⚠ baseUrl 이 아직 자리표시자(YOUR-DOMAIN.com)예요. site.config.json 을 고치거나 BASE_URL 환경변수로 실제 주소를 주세요.';
  if (PROD) { console.error(msg + ' (--prod 빌드는 여기서 멈춥니다)'); process.exit(1); }
  console.warn(msg);
}
if (!cfg.contactEmail) console.warn('⚠ contactEmail 이 비어 있어요. 소개·개인정보처리방침 페이지에 문의처가 없습니다. (애드센스 심사·개인정보보호법에 필요)');
const today = new Date().toISOString().slice(0, 10);
const SITE_RAW = cfg.siteName;
// 초안 모드: 노란 안내 박스·파란 광고 자리·왼쪽 위 스위치를 넣는다. 정식 오픈 때는 site.config.json 의 draftMode 를 false 로.
const DRAFT = cfg.draftMode !== false;
if (PROD && DRAFT) console.warn('⚠ draftMode 가 켜져 있어요. 정식 오픈이면 site.config.json 에서 "draftMode": false 로 바꾸세요. (초안 박스·광고 자리가 남고, 검색 노출도 막혀 있어요)');

fs.rmSync(DIST, { recursive: true, force: true });
const w = (rel, data) => { const f = path.join(DIST, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
const cp = (from, rel) => { const f = path.join(DIST, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.copyFileSync(path.join(NM, from), f); };

// ── 라이브러리 복사 (CDN 없이 우리 도메인에서 직접 제공)
const vendor = [
  ['heic2any/dist/heic2any.min.js', 'vendor/heic2any.min.js'],
  ['utif/UTIF.js', 'vendor/UTIF.js'],
  ['pako/dist/pako.min.js', 'vendor/pako.min.js'],
  ['pdf-lib/dist/pdf-lib.min.js', 'vendor/pdf-lib.min.js'],
  ['pdfjs-dist/legacy/build/pdf.min.mjs', 'vendor/pdfjs/pdf.min.js'],
  ['pdfjs-dist/legacy/build/pdf.worker.min.mjs', 'vendor/pdfjs/pdf.worker.min.js'],
  ['jszip/dist/jszip.min.js', 'vendor/jszip.min.js'],
  ['mammoth/mammoth.browser.min.js', 'vendor/mammoth.browser.min.js'],
  ['xlsx/dist/xlsx.full.min.js', 'vendor/xlsx.full.min.js'],
  ['@ffmpeg/ffmpeg/dist/umd/ffmpeg.js', 'vendor/ffmpeg/ffmpeg.js'],
  ['@ffmpeg/ffmpeg/dist/umd/814.ffmpeg.js', 'vendor/ffmpeg/814.ffmpeg.js'],
  // 영상·오디오 변환 엔진(약 30MB). 외부 CDN 없이 우리 사이트에서 직접 내려준다
  ['@ffmpeg/core/dist/umd/ffmpeg-core.js', 'vendor/ffmpeg/core/ffmpeg-core.js'],
  ['@ffmpeg/core/dist/umd/ffmpeg-core.wasm', 'vendor/ffmpeg/core/ffmpeg-core.wasm'],
];
for (const [a, b] of vendor) cp(a, b);
// pdf.js 가 한글 PDF 를 그리는 데 쓰는 글자 지도·표준 글꼴·디코더
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  fs.cpSync(path.join(NM, 'pdfjs-dist', dir), path.join(DIST, 'vendor/pdfjs', dir), { recursive: true });
}

// ── 우리 코드 복사
for (const f of ['engine.js', 'ui.js', 'pdfgrid.js']) w(`js/${f}`, fs.readFileSync(path.join(ROOT, 'src', f)));
w('css/style.css', fs.readFileSync(path.join(ROOT, 'src/style.css')));
w('js/registry.js', `export const conversions = ${JSON.stringify(conversions)};\n`);

// ── HTML 조각
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SITE = esc(cfg.siteName);
const groups = ['이미지', 'PDF', '오디오', '영상', '문서', '텍스트'];

function head({ title, desc, url, p, extra = '' }) {
  const verify = (cfg.naverVerification ? `<meta name="naver-site-verification" content="${esc(cfg.naverVerification)}">\n` : '') +
    (cfg.googleVerification ? `<meta name="google-site-verification" content="${esc(cfg.googleVerification)}">\n` : '');
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:locale" content="ko_KR">
<meta property="og:site_name" content="${esc(cfg.siteName)}">
<meta property="og:image" content="${BASE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="robots" content="${DRAFT ? 'noindex,nofollow' : 'index,follow,max-image-preview:large'}">
<meta name="theme-color" content="#2563eb">
${verify}<link rel="icon" href="${p}favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${p}css/style.css">
${DRAFT_HEAD}${extra}<script>if(location.protocol==='file:')addEventListener('DOMContentLoaded',function(){var m=document.getElementById('msg');if(m){m.className='msg err';m.textContent='이 파일은 웹 서버로 열어야 동작해요. 폴더의 미리보기 실행.bat 을 더블클릭하세요.';}});</script>
</head>`;
}
const footer = (p) => `<footer>
<a href="${p}about/">소개</a><a href="${p}privacy/">개인정보처리방침</a>
<div style="margin-top:8px">© ${SITE}</div>
${cfg.contactEmail ? '' : draftBox('문의 메일·사업자 정보 자리 — 도메인 메일을 만들면 여기에 표시돼요')}
</footer>`;
const header = (p, showOther) => `<header class="top">
<a class="logo" href="${p}">${SITE}</a>
${showOther ? `<a class="other" href="${p}">다른 형식도 변환하기</a>` : ''}
</header>`;
const links = (list, p) => list.map((c) => `<a href="${p}${c.slug}/">${esc(c.title)}</a>`).join('\n');

// ── 초안 표시 부품 (DRAFT 가 꺼지면 전부 빈 문자열이라 최종 화면에는 흔적이 없다)
const draftBox = (html) => (DRAFT ? `<div class="draft"><b class="dtag">초안</b>${html}</div>` : '');
const AD = {
  banner: ['배너 광고', '가로형 · PC 728×90 / 모바일 320×100'],
  video: ['영상 광고', '16:9 · 소리 없이 자동 재생되는 형태'],
  native: ['본문 광고', '반응형 디스플레이 · 글 사이에 들어감'],
  side: ['사이드 배너', '세로형 160×600 · PC 화면에서만'],
};
const adSlot = (type, cls = '') => (DRAFT ? `<div class="adslot ad-${type}${cls ? ' ' + cls : ''}" role="note"><b class="atag">광고 자리</b><span class="afmt">${AD[type][0]}</span><span class="asize">${AD[type][1]}</span></div>` : '');
const draftBar = () => (DRAFT ? `<div class="draftbar"><label class="dswitch" title="초안 표시 켜기/끄기"><input type="checkbox" id="draftToggle" checked aria-label="초안 표시 켜기/끄기"><i></i><span class="dlabel">초안 표시</span></label><span class="dmsg">🚧 제작 중인 초안 화면이에요. <b class="y">노란 박스</b>는 정식 오픈 때 사라지고, <b class="b">파란 박스</b>는 광고가 들어갈 자리예요.</span></div>
<script>(function(){var h=document.documentElement,c=document.getElementById('draftToggle');if(!c)return;c.checked=h.dataset.draft!=='off';c.addEventListener('change',function(){h.dataset.draft=c.checked?'on':'off';try{localStorage.setItem('draft',c.checked?'1':'0')}catch(e){}})})();</script>` : '');
const DRAFT_HEAD = DRAFT ? `<script>(function(){var h=document.documentElement,v='1';try{var m=/[?&]draft=(0|1|clean)/.exec(location.search);if(m){if(m[1]==='clean'){h.dataset.draft='off';h.dataset.clean='1';return}v=m[1];localStorage.setItem('draft',v)}else v=localStorage.getItem('draft')||'1'}catch(e){}h.dataset.draft=v==='0'?'off':'on'})();</script>\n` : '';

const dropzone = (accept, multi) => `<div id="dropzone" tabindex="0" role="button" aria-label="파일 선택">
<div class="dz-main"><span class="dz-fine">파일을 여기에 끌어다 놓으세요</span><span class="dz-touch">파일을 선택하세요</span></div>
<div class="dz-sub">또는 클릭해서 선택 · 붙여넣기(Ctrl+V)도 돼요</div>
<span class="pick">파일 선택</span>
<ul class="files" id="files"></ul>
</div>
<input type="file" id="file" hidden ${multi ? 'multiple' : ''} ${accept ? `accept="${accept}"` : ''}>`;

const toolTail = `<div id="targets"></div>
<div id="opts"></div>
<button id="go" type="button" disabled>변환하기</button>
<div id="barwrap" hidden><div id="bar"></div></div>
<p class="msg" id="msg" role="status" aria-live="polite"></p>
<ul class="results" id="results"></ul>`;

// ── 변환별 페이지
const FAQ_COMMON = [
  ['파일이 서버에 올라가나요?', '아니요. 변환은 내 브라우저 안에서만 처리되고, 파일은 어디로도 전송되지 않습니다.'],
  ['무료인가요? 횟수나 용량 제한이 있나요?', '무료이고 회원가입도 필요 없습니다. 횟수 제한은 없고, 파일 크기는 내 기기의 성능에 따라 달라집니다.'],
];
const FAQ_KIND = {
  compress: [['화질은 얼마가 적당한가요?', '보통 70% 안팎이면 눈으로 구분하기 어려우면서 용량은 크게 줄어듭니다. 메일·사이트 업로드 용량 제한이 있다면 "500KB 이하"처럼 목표 용량을 고르세요.']],
  pdfcompress: [['글자를 선택할 수 없게 되나요?', '네. 쪽을 이미지로 다시 만들어 용량을 줄이기 때문에 글자 선택·검색은 되지 않습니다. 대신 스캔본이나 사진이 많은 PDF는 용량이 크게 줄어듭니다. 이미 작은 파일은 원본 그대로 돌려드립니다.']],
  exif: [['EXIF가 뭔가요?', '사진에 몰래 들어 있는 정보입니다. 찍은 날짜·기기 이름·GPS 위치가 담길 수 있어서, 사진을 올리기 전에 지우면 집 위치 같은 개인정보가 새는 것을 막을 수 있습니다.']],
  ico: [['어떤 크기를 골라야 하나요?', '웹사이트 파비콘이라면 16·32·48 크기면 충분합니다. 윈도우 프로그램 아이콘이라면 256까지 담는 쪽을 고르세요. 정사각형 이미지로 시작하는 것이 가장 깔끔합니다.']],
  stitch: [['크기가 다른 이미지는 어떻게 되나요?', '세로로 붙이면 가장 넓은 이미지의 가로 폭에, 가로로 붙이면 가장 큰 높이에 맞춰 크기를 맞춥니다.']],
  pdfmerge: [['합치는 순서는 어떻게 되나요?', '목록의 순서대로 합쳐집니다. ▲▼ 버튼이나 이름순·날짜순 정렬로 순서를 바꿀 수 있고, 이미지 파일도 함께 올려 섞을 수 있습니다.']],
  pdfsplit: [['쪽 범위는 어떻게 입력하나요?', '"1-3, 5, 8-" 처럼 쉼표로 구분해 입력합니다. "8-"은 8쪽부터 끝까지라는 뜻입니다. 여러 구간을 한 파일로 합치려면 "한 파일로 합치기"를 켜세요.']],
  pdfpages: [['원본 파일이 바뀌나요?', '아니요. 원본은 그대로 두고 결과를 새 파일로 저장합니다.']],
  pdfnum: [['어떤 글자로 들어가나요?', '숫자(1, 2, 3...)만 넣기 때문에 글꼴 문제 없이 모든 PDF에 깔끔하게 들어갑니다.']],
  pdfmark: [['워터마크를 나중에 지울 수 있나요?', '결과 PDF에는 워터마크가 이미지로 들어가므로 쉽게 지울 수 없습니다. 원본은 따로 보관해 두세요.']],
  vidcompress: [['어떤 용도를 고르면 되나요?', '카톡·메신저로 보낼 때는 "카톡·메신저용", 화질을 최대한 지키고 싶다면 "화질 우선", 용량이 가장 중요하면 "최대한 작게"를 고르세요.']],
  trim: [['정확한 시점에서 잘리지 않아요.', '기본 방식은 다시 인코딩하지 않아 빠른 대신 앞뒤로 1~2초 차이가 날 수 있습니다. 정확하게 자르려면 "정확하게 자르기"를 켜세요. 시간이 더 걸립니다.']],
  vidmute: [['화질이 떨어지나요?', '아니요. 영상 부분은 다시 만들지 않고 소리만 빼기 때문에 화질 변화 없이 금방 끝납니다.']],
  encoding: [['한글이 깨져 보이는 이유가 뭔가요?', '파일이 EUC-KR(CP949) 같은 옛 방식으로 저장되었는데 UTF-8로 읽으면 글자가 깨집니다. 올리면 자동으로 알아내 UTF-8로 다시 저장합니다. CSV는 엑셀에서 바로 열리도록 처리합니다.']],
  hwpx: [['HWP 파일은 안 되나요?', '구버전 HWP는 아직 지원하지 않습니다. 한글에서 HWPX로 저장한 뒤 올려 주세요.']],
};
function faqFor(c) {
  const media = ['video', 'vidgif', 'vidaudio', 'audio', 'vidcompress', 'trim', 'vidmute'].includes(c.kind);
  const f = [...FAQ_COMMON];
  // 영상·오디오는 파일 하나당 약 1GB 까지만 처리하므로 "용량 제한 없음"으로 보이지 않게 따로 안내한다
  if (media) f[1] = [FAQ_COMMON[1][0], '무료이고 회원가입도 필요 없습니다. 횟수 제한은 없습니다. 다만 영상·오디오는 파일 하나당 약 1GB 이하만 처리할 수 있고, 큰 파일은 기기 성능에 따라 오래 걸리거나 실패할 수 있습니다.'];
  if (c.output === 'jpg' && !['text', 'compress', 'resize', 'exif', 'stitch', 'pdfimg'].includes(c.kind)) f.push(['투명한 배경은 어떻게 되나요?', 'JPG는 투명 배경을 지원하지 않아 흰색으로 채워집니다. 투명을 유지하려면 PNG나 WebP로 변환하세요.']);
  if (media) f.push([`${c.h1}, 왜 오래 걸리나요?`, '내 기기에서 직접 처리하기 때문에 영상은 길이와 용량에 따라 시간이 걸릴 수 있습니다. 처음 한 번은 변환 엔진을 내려받는 시간이 추가됩니다. 도중에 "취소"를 눌러 멈출 수 있습니다.']);
  f.push(...(FAQ_KIND[c.kind] || []));
  return f;
}

// 형식 설명 (페이지 본문에 들어가는 짧은 안내)
const FACTS = {
  jpg: 'JPG는 사진에 가장 널리 쓰이는 형식으로, 용량이 작고 어디서나 열립니다. 다만 투명 배경을 지원하지 않고, 저장할 때마다 화질이 조금씩 줄어듭니다.',
  png: 'PNG는 화질 손실 없이 저장하는 형식으로 투명 배경을 지원해 로고·캡처 화면에 많이 쓰입니다. 사진은 JPG보다 용량이 커지는 편입니다.',
  webp: 'WebP는 구글이 만든 웹용 형식으로 JPG·PNG보다 용량이 작습니다. 최신 브라우저는 대부분 지원하지만 오래된 프로그램에서는 열리지 않을 수 있습니다.',
  heic: 'HEIC는 아이폰이 기본으로 쓰는 사진 형식입니다. 용량이 작지만 윈도우나 일부 사이트에서는 바로 열리지 않아 JPG로 바꿔 쓰는 경우가 많습니다.',
  avif: 'AVIF는 최신 이미지 형식으로 같은 화질에서 용량이 매우 작지만, 지원하는 프로그램이 아직 많지 않습니다.',
  gif: 'GIF는 짧게 움직이는 이미지에 쓰이는 형식입니다. 색이 256가지로 제한되어 사진에는 적합하지 않습니다.',
  bmp: 'BMP는 압축하지 않은 옛 이미지 형식이라 용량이 큽니다.',
  tiff: 'TIFF는 스캔·인쇄·사진 작업에서 쓰는 고화질 형식으로 용량이 큽니다.',
  svg: 'SVG는 확대해도 깨지지 않는 벡터 이미지 형식으로 로고·아이콘에 많이 쓰입니다. 일반 이미지로 변환하면 점(픽셀) 이미지가 됩니다.',
  ico: 'ICO는 윈도우 아이콘과 웹사이트 파비콘에 쓰는 형식입니다. 한 파일에 여러 크기를 담을 수 있습니다.',
  pdf: 'PDF는 기기와 프로그램이 달라도 모양이 그대로 유지되는 문서 형식입니다. 제출·인쇄용 문서에 가장 널리 쓰입니다.',
  mp3: 'MP3는 가장 널리 쓰이는 오디오 형식으로 거의 모든 기기에서 재생됩니다.',
  wav: 'WAV는 압축하지 않은 고음질 오디오 형식이라 용량이 큽니다. 녹음·편집 작업에 많이 쓰입니다.',
  ogg: 'OGG는 누구나 무료로 쓸 수 있는 오디오 형식입니다. 일부 기기에서는 재생되지 않을 수 있습니다.',
  m4a: 'M4A는 애플 기기에서 많이 쓰는 오디오 형식으로, 같은 용량에서 MP3보다 음질이 좋은 편입니다.',
  flac: 'FLAC은 음질 손실 없이 압축하는 오디오 형식입니다. 음원 보관에 쓰이지만 MP3보다 용량이 큽니다.',
  wma: 'WMA는 마이크로소프트(윈도우 미디어 플레이어)가 만든 오디오 형식입니다. 스마트폰과 일부 기기에서는 재생되지 않아 MP3로 바꿔 쓰는 경우가 많습니다.',
  aac: 'AAC는 MP3의 후속으로 만들어진 오디오 형식으로 스트리밍에서 많이 쓰입니다.',
  mp4: 'MP4는 가장 널리 쓰이는 영상 형식으로 스마트폰·컴퓨터·TV 어디서나 재생됩니다.',
  mov: 'MOV는 애플(퀵타임)에서 만든 영상 형식입니다. 아이폰으로 찍은 영상이 이 형식인 경우가 많습니다.',
  mkv: 'MKV는 여러 음성·자막을 한 파일에 담을 수 있는 영상 형식입니다. 일부 기기에서는 재생되지 않습니다.',
  webm: 'WebM은 웹 전용으로 만든 영상 형식입니다. 브라우저에서는 잘 재생되지만 다른 프로그램에서는 열리지 않을 수 있습니다.',
  avi: 'AVI는 오래된 영상 형식으로 용량이 큰 편입니다.',
  wmv: 'WMV는 윈도우 미디어 플레이어용 영상 형식입니다.',
  flv: 'FLV는 플래시 시절 쓰던 영상 형식입니다.',
  csv: 'CSV는 쉼표로 칸을 나눈 단순한 표 형식입니다. 엑셀로 열 수 있고 프로그램 사이 데이터 전달에 많이 쓰입니다.',
  json: 'JSON은 프로그램이 데이터를 주고받을 때 쓰는 텍스트 형식입니다.',
  xlsx: 'XLSX는 엑셀(2007 이후)의 기본 파일 형식입니다.',
  xls: 'XLS는 엑셀 2003 이전의 옛 파일 형식입니다.',
  docx: 'DOCX는 워드(2007 이후)의 기본 문서 형식입니다.',
  hwpx: 'HWPX는 한컴오피스 한글의 개방형 문서 형식입니다.',
  html: 'HTML은 웹페이지를 만드는 문서 형식으로 브라우저에서 바로 열립니다.',
  txt: 'TXT는 서식 없는 순수 글자 파일입니다.',
};

// 관련 링크: 같은 입력 / 같은 결과 / 같은 분야의 도구
function relatedFor(c) {
  const used = new Set([c.slug]);
  const pick = (arr, n) => { const o = []; for (const x of arr) { if (o.length >= n) break; if (used.has(x.slug)) continue; used.add(x.slug); o.push(x); } return o; };
  const sections = [];
  const fromExt = c.inputs.length === 1 && c.inputs[0] !== 'text' ? c.inputs[0] : null;
  const a = fromExt ? pick(conversions.filter((x) => x.inputs.includes(fromExt)), 10) : [];
  if (a.length) sections.push([`${c.fromName} 파일로 할 수 있는 다른 작업`, a]);
  const b = c.output === 'pdf' || ['jpg', 'png', 'webp'].includes(c.output) || c.kind !== 'text'
    ? pick(conversions.filter((x) => x.output === c.output && x.kind !== 'text'), 8) : [];
  if (b.length) sections.push([`${c.toName}${roEuro(c.toName)} 바꾸는 다른 변환`, b]);
  const t = pick(conversions.filter((x) => x.verb && x.group === c.group), 6);
  const g = pick(conversions.filter((x) => x.group === c.group), t.length ? 4 : 10);
  if (t.length + g.length) sections.push([`다른 ${c.group} 도구`, [...t, ...g]]);
  return sections;
}

// 형식 쌍마다 다른 문장이 되도록 (사용 상황 + 형식 특징)
const USE = {
  heic: '아이폰 사진이 윈도우·갤럭시·사이트에서 안 열릴 때', webp: '웹에서 받은 이미지가 저장·업로드가 안 될 때', avif: '새 형식 이미지가 열리지 않을 때',
  png: '로고·캡처 이미지를 다른 형식으로 바꿀 때', jpg: '사진 파일 형식을 바꿀 때', gif: '움직이는 이미지를 다룰 때', svg: '로고·아이콘을 일반 이미지로 쓸 때',
  bmp: '용량이 큰 BMP 이미지를 줄일 때', tiff: '스캔·고화질 TIFF 파일을 가볍게 바꿀 때',
};
const KIND_USE = {
  compress: '메일·사이트 업로드 용량 제한에 걸릴 때', resize: '업로드 규격에 맞춰 크기를 줄일 때', exif: '사진 속 위치·기기 정보를 지우고 올리고 싶을 때',
  stitch: '여러 장의 사진·캡처를 한 장으로 합칠 때', ico: '웹사이트 파비콘이나 윈도우 아이콘이 필요할 때',
  pdfmerge: '여러 PDF나 사진을 제출용 한 파일로 묶을 때', pdfsplit: '필요한 쪽만 따로 뽑거나 나눌 때', pdfpages: '쪽 순서를 바꾸고 필요 없는 쪽을 정리할 때',
  pdfcompress: '이메일·시스템 업로드 용량 제한에 걸릴 때', pdfnum: '보고서·제출 서류에 쪽 번호가 필요할 때', pdfmark: '사본에 "제출용" 같은 워터마크를 넣을 때',
  pdftext: 'PDF 안의 글자를 복사해 쓰고 싶을 때', pdfimg: 'PDF 쪽을 이미지로 저장하고 싶을 때', imgpdf: '사진·스캔 이미지를 PDF 한 파일로 만들 때',
  vidcompress: '카톡·메일로 보내기엔 영상이 너무 클 때', trim: '긴 파일에서 필요한 구간만 남기고 싶을 때', vidmute: '영상에서 소리만 빼고 싶을 때',
  vidgif: '짧은 영상을 움직이는 GIF로 만들 때', vidaudio: '영상에서 소리만 뽑아 저장할 때', encoding: '메모장·CSV 파일의 한글이 깨져 보일 때',
  video: '기기에서 재생이 안 되는 영상 형식을 바꿀 때', audio: '플레이어에서 재생이 안 되는 음악 형식을 바꿀 때',
  data: '엑셀·표 데이터를 다른 프로그램에서 쓰려고 바꿀 때', docx: '워드 문서의 내용만 꺼내 쓰고 싶을 때', hwpx: '한글 문서의 글자만 텍스트로 꺼내고 싶을 때',
  text: '긴 글을 PDF나 이미지로 저장하고 싶을 때',
};
function descFor(c) {
  const use = c.kind === 'image' ? (USE[c.inputs[0]] || '파일 형식을 바꿀 때') : (KIND_USE[c.kind] || USE[c.inputs[0]] || '파일 형식을 바꿀 때');
  return `${c.title} - ${use} 설치·가입 없이 브라우저에서 바로 하세요. 파일은 서버로 올라가지 않고 무료예요.`;
}

function toolPage(c) {
  const p = '../';
  const url = `${BASE}/${c.slug}/`;
  const faq = faqFor(c);
  const ld = [
    { '@context': 'https://schema.org', '@type': 'WebApplication', name: c.title, url, applicationCategory: 'UtilitiesApplication', operatingSystem: 'Any', inLanguage: 'ko', offers: { '@type': 'Offer', price: '0', priceCurrency: 'KRW' } },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: cfg.siteName, item: `${BASE}/` },
      { '@type': 'ListItem', position: 2, name: `${c.group} 변환`, item: `${BASE}/` },
      { '@type': 'ListItem', position: 3, name: c.title, item: url }] },
  ].map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>\n`).join('');
  const isText = c.kind === 'text';
  const noun = /파일$/.test(c.fromName) ? c.fromName : `${c.fromName} 파일`;
  const sub = isText ? '텍스트를 붙여넣고 버튼만 누르세요.' : `${noun}을 올리고 버튼만 누르세요. 설치·가입 없이 바로 됩니다.`;
  const OPT_KINDS = ['compress', 'resize', 'ico', 'stitch', 'pdfsplit', 'pdfnum', 'pdfmark', 'pdfcompress', 'vidcompress', 'trim', 'vidgif'];
  const step2 = c.kind === 'pdfpages' ? '쪽을 끌어서 순서를 바꾸거나 선택합니다.' : OPT_KINDS.includes(c.kind) ? '옵션을 고르고 버튼을 누릅니다.' : '변환하기 버튼을 누릅니다.';
  const facts = [...new Set([c.inputs[0], c.output])].filter((x) => FACTS[x] && !isText);
  const rel = relatedFor(c);
  const body = `<body data-slug="${c.slug}">
${draftBar()}
${header(p, true)}
${adSlot('side', 'l')}${adSlot('side', 'r')}
<main class="wrap">
${adSlot('banner')}
<h1>${esc(c.h1)}</h1>
<p class="sub">${esc(sub)}</p>
<div class="card">
${isText ? `<textarea id="textbox" placeholder="여기에 텍스트를 붙여넣으세요" aria-label="텍스트 입력"></textarea><div id="dropzone" hidden><ul class="files" id="files"></ul></div><input type="file" id="file" hidden>` : dropzone('', c.multi)}
${toolTail.replace('<div id="targets"></div>', '<div id="targets" hidden></div>')}
</div>
${adSlot('video')}
<noscript><p class="msg err">이 도구는 자바스크립트가 켜져 있어야 사용할 수 있어요.</p></noscript>
<section class="info">
<h2>사용 방법</h2>
<ol><li>${isText ? '텍스트를 붙여넣습니다.' : '파일을 끌어다 놓거나 선택합니다.'}</li><li>${esc(step2)}</li><li>완성된 파일을 다운로드합니다.</li></ol>
</section>
${facts.length ? `<section class="info">
<h2>파일 형식 알아보기</h2>
${facts.map((x) => `<p class="fact">${esc(FACTS[x])}</p>`).join('\n')}
</section>` : ''}
${adSlot('native')}
<section class="info">
<h2>자주 묻는 질문</h2>
${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n')}
</section>
${rel.map(([h, l]) => `<section class="info"><h2>${esc(h)}</h2>
<div class="grid">${links(l, p)}</div></section>`).join('\n')}
</main>
${footer(p)}
<script type="module" src="${p}js/ui.js"></script>
</body>
</html>`;
  return head({ title: `${c.title} - 무료 온라인 | ${cfg.siteName}`, desc: descFor(c), url, p, extra: ld }) + '\n' + body;
}

for (const c of conversions) w(`${c.slug}/index.html`, toolPage(c));

// ── 메인 페이지
{
  const p = './';
  const url = `${BASE}/`;
  const desc = '이미지·PDF·오디오·영상·문서 변환을 한 곳에서. 파일을 올리거나 텍스트를 붙여넣고 원하는 형식만 고르면 끝. 가입·설치 없이 무료, 파일은 서버로 전송되지 않아요.';
  const ld = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebSite', name: cfg.siteName, url, inLanguage: 'ko' })}</script>\n`;
  const all = groups.map((g) => {
    const l = conversions.filter((c) => c.group === g);
    return l.length ? `<h3 class="gt">${g}</h3><div class="grid">${links(l, p)}</div>` : '';
  }).join('\n');
  const html = head({ title: `무료 파일 변환기 - 이미지·PDF·동영상·오디오 변환 | ${cfg.siteName}`, desc, url, p, extra: ld }) + `
<body data-slug="main">
${draftBar()}
${header(p, false)}
${adSlot('side', 'l')}${adSlot('side', 'r')}
<main class="wrap">
${adSlot('banner')}
<h1>무료 파일 변환기</h1>
<p class="sub">파일을 올리고 바꿀 형식만 고르세요. 설치·가입 없이 무료.</p>
${draftBox('지금은 임시 주소(GitHub Pages)에서 보는 초안이에요. 도메인을 연결하면 주소가 바뀌고, 그때까지는 검색에 나오지 않게 막아 두었어요(noindex).')}
<div class="card">
${dropzone('', true)}
<details class="paste"><summary>텍스트를 붙여넣어 PDF·이미지로 만들기</summary>
<textarea id="textbox" placeholder="여기에 텍스트를 붙여넣으세요" aria-label="텍스트 입력"></textarea></details>
${toolTail}
</div>
${adSlot('video')}
<noscript><p class="msg err">이 도구는 자바스크립트가 켜져 있어야 사용할 수 있어요.</p></noscript>
${adSlot('native')}
<section class="info"><h2>모든 변환</h2>
${all}
</section>
</main>
${footer(p)}
<script type="module" src="${p}js/ui.js"></script>
</body>
</html>`;
  w('index.html', html);
}

// ── 소개 / 개인정보처리방침
function docPage(slug, title, inner) {
  const p = '../';
  const url = `${BASE}/${slug}/`;
  w(`${slug}/index.html`, head({ title: `${title} | ${cfg.siteName}`, desc: `${cfg.siteName} ${title}`, url, p }) +
    `\n<body>\n${draftBar()}\n${header(p, true)}\n<main class="wrap doc"><h1>${title}</h1>\n${inner}\n</main>\n${footer(p)}\n</body>\n</html>`);
}
docPage('about', '소개', `<p>${SITE}는 이미지, PDF, 오디오, 영상, 문서 파일을 설치나 가입 없이 브라우저에서 바로 변환·편집할 수 있는 무료 도구입니다.</p>
<h2>할 수 있는 일</h2>
<p>JPG·PNG·WebP·HEIC 같은 이미지 변환과 용량 줄이기, PDF 합치기·나누기·페이지 정리·용량 줄이기·워터마크, 동영상·오디오 변환과 자르기, 엑셀·CSV·JSON 변환 등을 지원합니다.</p>
<h2>파일은 어디로도 올라가지 않습니다</h2>
<p>모든 변환은 이용자의 기기 안(브라우저)에서 처리됩니다. 선택한 파일은 사이트 서버로 전송되지 않고 저장되지도 않습니다. 영상·오디오 변환을 처음 사용할 때에만 변환 엔진(약 32MB)을 이 사이트에서 내려받으며, 이때에도 파일 내용은 어디로도 전송되지 않습니다.</p>
${cfg.contactEmail ? `<h2>문의</h2><p>${esc(cfg.contactEmail)}</p>` : `<h2>문의</h2>${draftBox('문의 메일 주소 자리 — 도메인 메일을 만들면 이 자리에 들어가요 (site.config.json 의 contactEmail)')}`}`);
docPage('privacy', '개인정보처리방침', `<p>${SITE}(이하 "사이트")는 이용자의 이름·연락처 같은 개인정보를 수집하지 않으며, 회원가입이 없습니다.</p>
<h2>파일 처리</h2><p>이용자가 선택한 파일은 이용자의 브라우저 안에서만 처리되며, 사이트 서버로 전송되거나 저장되지 않습니다.</p>
<h2>접속 기록</h2><p>사이트를 제공하는 호스팅 서비스에서 접속 기록(IP 주소, 접속 시각, 이용 기기 정보 등)이 자동으로 생성될 수 있습니다. 영상·오디오 변환 엔진은 이 사이트에서 직접 내려받으며, 드물게 사이트에서 받지 못하면 외부 CDN(jsDelivr 또는 unpkg)에서 받을 수 있고 이때 해당 CDN에 이용자의 IP 주소가 전달될 수 있습니다.</p>
${cfg.adsenseClient ? `<h2>쿠키와 광고</h2><p>사이트는 광고 제공을 위해 Google 등 제3자 광고 서비스를 사용하며, 이 경우 해당 서비스가 쿠키를 사용해 이용자의 관심사에 맞는 광고를 보여줄 수 있습니다. 이용자는 <a href="https://adssettings.google.com">Google 광고 설정</a>에서 맞춤 광고를 끄거나 브라우저 설정에서 쿠키를 차단·삭제할 수 있습니다.</p>` : ''}
${cfg.contactEmail ? `<h2>문의</h2><p>${esc(cfg.contactEmail)}</p>` : ''}
${cfg.adsenseClient ? '' : draftBox('"쿠키와 광고" 항목 자리 — 애드센스 승인을 받으면 광고·쿠키 안내가 이 자리에 자동으로 들어가요')}
<p>시행일: ${esc(cfg.policyDate || today)}</p>
${cfg.policyDate ? '' : draftBox('시행일은 지금 빌드한 날짜로 들어가 있어요. 정식 오픈 날짜로 site.config.json 의 policyDate 에 적어 주세요')}`);

// ── 404 (호스팅에서 없는 주소일 때 보여줄 페이지. 어느 깊이에서 떠도 되게 주소는 절대경로)
{
  const root = new URL(BASE + '/').pathname;
  const pop = ['heic-to-jpg', 'png-to-jpg', 'jpg-to-pdf', 'pdf-merge', 'pdf-compress', 'image-compress', 'mp4-to-mp3', 'video-compress']
    .map((x) => conversions.find((c) => c.slug === x)).filter(Boolean);
  w('404.html', `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>페이지를 찾을 수 없어요 | ${esc(cfg.siteName)}</title><meta name="robots" content="noindex">
<link rel="stylesheet" href="${root}css/style.css"></head>
<body><main class="wrap" style="text-align:center;padding-top:60px"><h1>페이지를 찾을 수 없어요</h1>
<p class="sub">주소가 바뀌었거나 없는 페이지예요.</p>
<p><a class="dl" href="${root}">파일 변환기 메인으로</a></p>
<section class="info"><h2>자주 쓰는 변환</h2><div class="grid" style="justify-content:center">${pop.map((c) => `<a href="${root}${c.slug}/">${esc(c.title)}</a>`).join('')}</div></section></main></body></html>`);
}

// ── 기타
w('favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2563eb"/><path d="M18 24h24l-6-6M46 40H22l6 6" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`);
const urls = ['', ...conversions.map((c) => `${c.slug}/`), 'about/', 'privacy/'];
w('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${BASE}/${u}</loc></url>`).join('\n')}\n</urlset>\n`);
w('robots.txt', DRAFT ? `User-agent: *\nDisallow: /\n` : `User-agent: *\nAllow: /\nSitemap: ${BASE}/sitemap.xml\n`);
w('.nojekyll', '');
fs.copyFileSync(path.join(ROOT, 'src/assets/og.png'), path.join(DIST, 'og.png'));

// ── 자체 점검: 모든 페이지에 들어오는 링크가 있는지, 사이트맵과 페이지 수가 맞는지
{
  const inbound = new Map(conversions.map((c) => [c.slug, 0]));
  for (const c of conversions) {
    const html = fs.readFileSync(path.join(DIST, c.slug, 'index.html'), 'utf8');
    for (const m of html.matchAll(/<a href="\.\.\/([^/"]+)\/">/g)) if (m[1] !== c.slug && inbound.has(m[1])) inbound.set(m[1], inbound.get(m[1]) + 1);
  }
  const orphans = [...inbound].filter(([, n]) => n === 0).map(([s]) => s);
  const pages = fs.readdirSync(DIST).filter((d) => fs.existsSync(path.join(DIST, d, 'index.html'))).length;
  console.log(`점검: 변환 ${conversions.length}개 / 페이지 폴더 ${pages}개 / 사이트맵 ${urls.length}개 URL / 다른 페이지에서 링크가 없는 변환 ${orphans.length}개${orphans.length ? ' → ' + orphans.join(', ') : ''}`);
}
console.log(`빌드 완료: 변환 페이지 ${conversions.length}개 + 메인/소개/개인정보 → ${DIST}`);
