// 변환 목록. 여기에 한 줄 추가하면 페이지가 자동으로 생긴다. (npm run build)
// kind: 엔진 종류 (src/engine.js 의 handlers 와 일치)
// chip: 메인 페이지 선택 버튼에 보일 짧은 이름 (없으면 자동)

export const IMG_IN = ['heic', 'jpg', 'png', 'webp', 'avif', 'gif', 'bmp', 'tiff', 'svg'];
export const AUDIO = ['mp3', 'wav', 'ogg', 'm4a', 'flac'];
export const AUDIO_IN = [...AUDIO, 'aac'];
export const VIDEO_IN = ['mp4', 'mov', 'mkv', 'webm', 'avi'];
const PHOTO = ['jpg', 'png', 'webp', 'heic'];

export const NAMES = {
  jpg: 'JPG', png: 'PNG', webp: 'WebP', heic: 'HEIC', avif: 'AVIF', gif: 'GIF', bmp: 'BMP',
  tiff: 'TIFF', svg: 'SVG', ico: 'ICO', pdf: 'PDF', mp3: 'MP3', wav: 'WAV', ogg: 'OGG', m4a: 'M4A', flac: 'FLAC',
  aac: 'AAC', wma: 'WMA', mp4: 'MP4', mov: 'MOV', avi: 'AVI', mkv: 'MKV', webm: 'WebM', wmv: 'WMV', flv: 'FLV',
  csv: 'CSV', json: 'JSON', xlsx: 'Excel(XLSX)', xls: 'Excel(XLS)', docx: 'Word(DOCX)', hwpx: '한글(HWPX)',
  txt: '텍스트(TXT)', html: 'HTML', text: '텍스트',
};

// 조사 처리 (받침 유무). 영문 이름은 읽는 소리 기준으로 직접 지정한다.
const FINAL = { JSON: 'c', FLAC: 'c', WebM: 'c', HTML: 'l', 'Excel(XLSX)': 'l', 'Excel(XLS)': 'l', '한글(HWPX)': 'l' };
function finalType(name) {
  if (FINAL[name]) return FINAL[name];
  const code = name.charCodeAt(name.length - 1);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const j = (code - 0xac00) % 28;
    return j === 0 ? 'v' : j === 8 ? 'l' : 'c';
  }
  return 'v';
}
export const eulReul = (name) => (finalType(name) === 'v' ? '를' : '을');
export const roEuro = (name) => (finalType(name) === 'c' ? '으로' : '로');

const list = [];
const add = (e) => list.push(e);

// ── 이미지 → 이미지
for (const from of IMG_IN) {
  for (const to of ['jpg', 'png', 'webp']) {
    if (from === to) continue;
    add({ slug: `${from}-to-${to}`, kind: 'image', inputs: [from], output: to, group: '이미지' });
  }
}

// ── 이미지 → PDF
for (const from of ['jpg', 'png', 'webp', 'heic']) {
  add({ slug: `${from}-to-pdf`, kind: 'imgpdf', inputs: [from], output: 'pdf', group: 'PDF' });
}
add({ slug: 'image-to-pdf', kind: 'imgpdf', inputs: IMG_IN, output: 'pdf', group: 'PDF', label: '이미지', multi: true });

// ── PDF
add({ slug: 'pdf-to-jpg', kind: 'pdfimg', inputs: ['pdf'], output: 'jpg', group: 'PDF' });
add({ slug: 'pdf-to-png', kind: 'pdfimg', inputs: ['pdf'], output: 'png', group: 'PDF' });
add({ slug: 'pdf-merge', kind: 'pdfmerge', inputs: ['pdf'], pageInputs: ['pdf', ...IMG_IN], output: 'pdf', group: 'PDF', multi: true,
  title: 'PDF 합치기', verb: '합치기', chip: '합치기' });
add({ slug: 'pdf-split', kind: 'pdfsplit', inputs: ['pdf'], output: 'pdf', group: 'PDF',
  title: 'PDF 나누기', verb: '나누기', chip: '나누기' });
add({ slug: 'pdf-organize', kind: 'pdfpages', mode: 'organize', inputs: ['pdf'], output: 'pdf', group: 'PDF',
  title: 'PDF 페이지 정리', verb: '저장', chip: '페이지 정리', goLabel: '저장하기' });
add({ slug: 'pdf-delete-pages', kind: 'pdfpages', mode: 'delete', inputs: ['pdf'], output: 'pdf', group: 'PDF',
  title: 'PDF 페이지 삭제', verb: '삭제', goLabel: '선택한 쪽 지우고 저장' });
add({ slug: 'pdf-extract-pages', kind: 'pdfpages', mode: 'extract', inputs: ['pdf'], output: 'pdf', group: 'PDF',
  title: 'PDF 페이지 추출', verb: '추출', goLabel: '선택한 쪽만 남기고 저장' });
add({ slug: 'pdf-to-txt', kind: 'pdftext', inputs: ['pdf'], output: 'txt', group: 'PDF',
  title: 'PDF 텍스트 추출 (TXT 변환)', verb: '추출', chip: '텍스트 추출' });
add({ slug: 'pdf-compress', kind: 'pdfcompress', inputs: ['pdf'], output: 'pdf', group: 'PDF',
  title: 'PDF 용량 줄이기 (압축)', verb: '압축', chip: '용량 줄이기' });
add({ slug: 'pdf-page-numbers', kind: 'pdfnum', inputs: ['pdf'], output: 'pdf', group: 'PDF',
  title: 'PDF 페이지 번호 넣기', verb: '번호 넣기', chip: '페이지 번호' });
add({ slug: 'pdf-watermark', kind: 'pdfmark', inputs: ['pdf'], output: 'pdf', group: 'PDF',
  title: 'PDF 워터마크 넣기', verb: '워터마크 넣기', chip: '워터마크' });

// ── 이미지 도구
add({ slug: 'image-compress', kind: 'compress', inputs: PHOTO, output: 'jpg', group: '이미지',
  title: '이미지 용량 줄이기 (사진 압축)', verb: '압축', label: '이미지', chip: '용량 줄이기' });
add({ slug: 'image-resize', kind: 'resize', inputs: PHOTO, output: 'jpg', group: '이미지',
  title: '이미지 크기 조절', verb: '크기 조절', label: '이미지', chip: '크기 조절' });
for (const kb of [100, 200, 500, 1024]) {
  const lbl = kb >= 1024 ? '1MB' : `${kb}KB`;
  add({ slug: `image-compress-${kb >= 1024 ? '1mb' : kb + 'kb'}`, kind: 'compress', inputs: PHOTO, output: 'jpg', group: '이미지', targetKB: kb,
    title: `사진·이미지 용량 ${lbl} 이하로 줄이기`, verb: '압축', label: '이미지', chip: `${lbl} 이하로` });
}
add({ slug: 'exif-remove', kind: 'exif', inputs: PHOTO, output: 'jpg', group: '이미지',
  title: '사진 위치정보(EXIF) 지우기', verb: '정보 지우기', label: '사진', chip: '위치정보 지우기' });
add({ slug: 'image-merge', kind: 'stitch', inputs: PHOTO, output: 'jpg', group: '이미지', multi: true,
  title: '이미지 이어붙이기', verb: '이어붙이기', label: '이미지', chip: '이어붙이기' });
for (const from of ['png', 'jpg', 'svg']) {
  add({ slug: `${from}-to-ico`, kind: 'ico', inputs: [from], output: 'ico', group: '이미지' });
}

// ── 오디오
for (const from of AUDIO_IN) {
  for (const to of AUDIO) {
    if (from === to) continue;
    add({ slug: `${from}-to-${to}`, kind: 'audio', inputs: [from], output: to, group: '오디오' });
  }
}
add({ slug: 'wma-to-mp3', kind: 'audio', inputs: ['wma'], output: 'mp3', group: '오디오' });
add({ slug: 'audio-trim', kind: 'trim', inputs: AUDIO_IN, output: 'mp3', group: '오디오',
  title: '오디오 자르기', verb: '자르기', label: '오디오', chip: '자르기' });

// ── 영상 → 오디오
for (const from of VIDEO_IN) {
  add({ slug: `${from}-to-mp3`, kind: 'vidaudio', inputs: [from], output: 'mp3', group: '영상' });
}
for (const from of ['mp4', 'mov']) {
  add({ slug: `${from}-to-m4a`, kind: 'vidaudio', inputs: [from], output: 'm4a', group: '영상' });
}
add({ slug: 'mp4-to-wav', kind: 'vidaudio', inputs: ['mp4'], output: 'wav', group: '영상' });

// ── 영상 → 영상
for (const [from, to] of [['mov', 'mp4'], ['avi', 'mp4'], ['mkv', 'mp4'], ['webm', 'mp4'], ['wmv', 'mp4'],
  ['flv', 'mp4'], ['mp4', 'webm'], ['mp4', 'mov'], ['mp4', 'mkv'], ['mp4', 'avi']]) {
  add({ slug: `${from}-to-${to}`, kind: 'video', inputs: [from], output: to, group: '영상' });
}
add({ slug: 'gif-to-mp4', kind: 'video', inputs: ['gif'], output: 'mp4', group: '영상' });
for (const from of ['mp4', 'mov', 'webm']) {
  add({ slug: `${from}-to-gif`, kind: 'vidgif', inputs: [from], output: 'gif', group: '영상' });
}
add({ slug: 'video-compress', kind: 'vidcompress', inputs: VIDEO_IN, output: 'mp4', group: '영상',
  title: '동영상 용량 줄이기', verb: '줄이기', label: '영상', chip: '용량 줄이기' });
add({ slug: 'video-trim', kind: 'trim', inputs: VIDEO_IN, output: 'mp4', group: '영상',
  title: '동영상 자르기', verb: '자르기', label: '영상', chip: '자르기' });
add({ slug: 'video-mute', kind: 'vidmute', inputs: VIDEO_IN, output: 'mp4', group: '영상',
  title: '동영상 소리 없애기', verb: '소리 없애기', label: '영상', chip: '소리 없애기' });

// ── 데이터/문서
for (const [from, to] of [['csv', 'json'], ['json', 'csv'], ['csv', 'xlsx'], ['xlsx', 'csv'], ['xlsx', 'json'],
  ['json', 'xlsx'], ['xls', 'xlsx'], ['xls', 'csv'], ['xlsx', 'html'], ['csv', 'html']]) {
  add({ slug: `${from}-to-${to}`, kind: 'data', inputs: [from], output: to, group: '문서' });
}
add({ slug: 'docx-to-txt', kind: 'docx', inputs: ['docx'], output: 'txt', group: '문서' });
add({ slug: 'docx-to-html', kind: 'docx', inputs: ['docx'], output: 'html', group: '문서' });
add({ slug: 'hwpx-to-txt', kind: 'hwpx', inputs: ['hwpx'], output: 'txt', group: '문서' });
add({ slug: 'txt-encoding-fix', kind: 'encoding', inputs: ['txt', 'csv'], output: 'txt', group: '문서',
  title: '텍스트·CSV 한글 깨짐 고치기', verb: '고치기', label: '텍스트 파일', chip: '한글 깨짐 고치기' });

// ── 텍스트 → 파일 (붙여넣기)
add({ slug: 'text-to-pdf', kind: 'text', inputs: ['text'], output: 'pdf', group: '텍스트', title: '텍스트를 PDF로 만들기' });
add({ slug: 'text-to-png', kind: 'text', inputs: ['text'], output: 'png', group: '텍스트', title: '텍스트를 PNG 이미지로 만들기' });
add({ slug: 'text-to-jpg', kind: 'text', inputs: ['text'], output: 'jpg', group: '텍스트', title: '텍스트를 JPG 이미지로 만들기' });

const n = (x) => NAMES[x] || x.toUpperCase();

// 여러 파일을 한 번에 올릴 수 있는 종류 (PDF 나누기·페이지 정리는 파일 하나씩)
const MULTI = new Set(['image', 'imgpdf', 'pdfimg', 'compress', 'resize', 'exif', 'ico', 'stitch', 'pdfmerge', 'pdfcompress',
  'pdfnum', 'pdfmark', 'pdftext', 'audio', 'vidaudio', 'video', 'vidgif', 'vidcompress', 'trim', 'vidmute', 'data', 'docx', 'hwpx', 'encoding']);

export const conversions = list.map((e) => {
  const fromName = e.label || (e.inputs.length === 1 ? n(e.inputs[0]) : '파일');
  const toName = n(e.output);
  const title = e.title || `${fromName} ${toName} 변환`;
  const h1 = e.title || `${fromName}${eulReul(fromName)} ${toName}${roEuro(toName)} 변환`;
  return {
    ...e,
    multi: e.multi ?? MULTI.has(e.kind),
    // 아이폰은 HEIC 를 올릴 때 JPG 로 바꿔서 넘기는 경우가 있어서 HEIC 전용 페이지는 JPG·PNG 도 받아 준다
    pageInputs: e.pageInputs ?? (e.inputs.length === 1 && e.inputs[0] === 'heic' ? ['heic', 'jpg', 'png'] : undefined),
    goLabel: e.goLabel || (e.verb ? (/기$/.test(e.verb) ? e.verb : `${e.verb}하기`)
      : e.kind === 'text' ? `${toName}${roEuro(toName)} 만들기` : `${toName}${roEuro(toName)} 변환하기`),
    fromName,
    toName,
    title,
    h1,
    description: `${title} - 설치·가입·용량 제한 없이 브라우저에서 바로. 파일이 서버로 업로드되지 않아 안전하고 무료입니다.`,
  };
});
