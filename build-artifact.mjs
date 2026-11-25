// Claude 아티팩트용 미리보기 빌드: 메인 페이지 하나 + 필요한 파일들을 artifact/ 에 만든다.
// (실제 배포는 build.mjs 의 dist/ 를 쓴다. 이건 사이트를 미리 써 보기 위한 용도)
// 사용: node build-artifact.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { conversions } from './src/registry.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, 'artifact');
const NM = path.join(ROOT, 'node_modules');
fs.mkdirSync(OUT, { recursive: true });
for (const e of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, e), { recursive: true, force: true });
const w = (rel, data) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
const cp = (from, rel) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.copyFileSync(path.join(NM, from), f); };

// 라이브러리 (영상·오디오 엔진은 외부 CDN 이 필요해서 미리보기에서는 뺀다)
for (const [a, b] of [
  ['heic2any/dist/heic2any.min.js', 'vendor/heic2any.min.js'],
  ['utif/UTIF.js', 'vendor/UTIF.js'],
  ['pako/dist/pako.min.js', 'vendor/pako.min.js'],
  ['pdf-lib/dist/pdf-lib.min.js', 'vendor/pdf-lib.min.js'],
  ['pdfjs-dist/legacy/build/pdf.min.mjs', 'vendor/pdfjs/pdf.min.js'],
  ['pdfjs-dist/legacy/build/pdf.worker.min.mjs', 'vendor/pdfjs/pdf.worker.min.js'],
  ['jszip/dist/jszip.min.js', 'vendor/jszip.min.js'],
  ['mammoth/mammoth.browser.min.js', 'vendor/mammoth.browser.min.js'],
  ['xlsx/dist/xlsx.full.min.js', 'vendor/xlsx.full.min.js'],
]) cp(a, b);
for (const dir of ['standard_fonts', 'wasm', 'iccs']) fs.cpSync(path.join(NM, 'pdfjs-dist', dir), path.join(OUT, 'vendor/pdfjs', dir), { recursive: true });
// 한국어 PDF 에 필요한 글자 지도만 (파일 수를 줄이려고)
const cm = path.join(NM, 'pdfjs-dist/cmaps');
for (const f of fs.readdirSync(cm)) if (/^(Adobe-Korea1|KSC|UniKS|Identity|Adobe-Identity)/.test(f)) {
  fs.mkdirSync(path.join(OUT, 'vendor/pdfjs/cmaps'), { recursive: true });
  fs.copyFileSync(path.join(cm, f), path.join(OUT, 'vendor/pdfjs/cmaps', f));
}

for (const f of ['engine.js', 'ui.js', 'pdfgrid.js']) w(`js/${f}`, fs.readFileSync(path.join(ROOT, 'src', f)));
w('js/registry.js', `export const conversions = ${JSON.stringify(conversions)};\n`);

let css = fs.readFileSync(path.join(ROOT, 'src/style.css'), 'utf8');
// 아티팩트의 라이트/다크 전환(data-theme)을 따르도록 다크 토큰 블록을 두 가지 선택자로 만든다
css = css.replace(/@media \(prefers-color-scheme: dark\) \{\s*:root \{([^}]*)\}\s*\}/, (m, body) =>
  `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {${body}} }
:root[data-theme="dark"] {${body}}`);
const html = `<title>모두의 파일 변환기</title>
<style>${css}
.notice a { color: inherit; text-decoration: underline; }</style>
<header class="top"><span class="logo">모두의 파일 변환기</span></header>
<main class="wrap">
<h1>무료 파일 변환기</h1>
<p class="sub">파일을 올리고 바꿀 형식만 고르세요. 파일은 서버로 올라가지 않아요.</p>
<div class="card">
<p class="notice">미리보기 버전이에요. 이미지·PDF·문서(엑셀·CSV·워드·한글) 변환은 모두 되고, 영상·오디오 변환은 실제 사이트에서만 돼요. 저장할 때마다 확인창이 떠요.</p>
<div id="dropzone" tabindex="0" role="button" aria-label="파일 선택">
<div class="dz-main"><span class="dz-fine">파일을 여기에 끌어다 놓으세요</span><span class="dz-touch">파일을 선택하세요</span></div>
<div class="dz-sub">또는 클릭해서 선택 · 붙여넣기(Ctrl+V)도 돼요</div>
<span class="pick">파일 선택</span>
<ul class="files" id="files"></ul>
</div>
<input type="file" id="file" hidden multiple>
<details class="paste"><summary>텍스트를 붙여넣어 PDF·이미지로 만들기</summary>
<textarea id="textbox" placeholder="여기에 텍스트를 붙여넣으세요" aria-label="텍스트 입력"></textarea></details>
<div id="targets"></div>
<div id="opts"></div>
<button id="go" type="button" disabled>변환하기</button>
<div id="barwrap" hidden><div id="bar"></div></div>
<p class="msg" id="msg" role="status" aria-live="polite"></p>
<ul class="results" id="results"></ul>
</div>
</main>
<script>document.body.dataset.slug = 'main';</script>
<script type="module" src="js/ui.js"></script>
`;
w('index.html', html);
let n = 0;
(function count(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? count(path.join(d, e.name)) : n++; })(OUT);
console.log(`artifact/ 완성: 파일 ${n}개`);
