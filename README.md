# 모두의 파일 변환기

설치·가입 없이 브라우저에서 이미지·PDF·영상·오디오·문서를 변환하는 무료 정적 사이트. 파일은 서버로 올라가지 않고 모두 브라우저 안에서 처리된다.

- 변환 120개 (페이지 1개 = 변환 1개, 메인 페이지에서 한 번에 선택 가능)
- 순수 정적 파일이라 서버가 필요 없고, 도메인의 하위 경로(예: `/convert/`)에 그대로 올릴 수 있다

## 구조
| 경로 | 설명 |
|---|---|
| `src/registry.mjs` | 변환 목록. 한 줄 추가하면 페이지가 자동으로 생긴다 |
| `src/engine.js` | 변환 엔진 (이미지·PDF·영상·오디오·문서) |
| `src/ui.js`, `src/pdfgrid.js`, `src/style.css` | 화면 |
| `build.mjs` | `dist/` 에 사이트 전체를 만든다 |
| `site.config.json` | 주소·문의 메일·광고·**초안 모드** 설정 |
| `build-artifact.mjs` | (선택) Claude 아티팩트용 미리보기 빌드 |

## 사용
```
npm install
npm run build          # dist/ 생성
npm run serve          # http://127.0.0.1:8080 에서 미리보기 (file:// 로는 동작하지 않음)
```

## 초안 모드
`site.config.json` 의 `"draftMode": true` 이면 노란 초안 박스, 파란 광고 자리, 왼쪽 위 숨김 스위치가 들어가고 검색엔진 노출은 막힌다 (`noindex`).
정식 오픈 때 `false` 로 바꾸고 `npm run build -- --prod` 로 빌드하면 그 요소가 전부 빠진다.
주소 뒤에 `?draft=0` / `?draft=1` 로 숨김·표시를 바꾸고, `?draft=clean` 은 스위치까지 숨긴다.

자세한 배포 순서는 `배포 체크리스트.md` 참고.
