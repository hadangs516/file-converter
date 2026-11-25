@echo off
chcp 65001 >nul
rem dist 폴더를 내 컴퓨터에서 미리 보는 서버를 켭니다. (파일을 그냥 더블클릭해서 열면 동작하지 않아요)
cd /d "%~dp0"
if not exist dist\index.html (
  echo dist 폴더가 없어요. 먼저 "npm run build" 를 실행해 주세요.
  pause
  exit /b 1
)
start "" http://127.0.0.1:8080/
python -m http.server 8080 -d dist --bind 127.0.0.1
