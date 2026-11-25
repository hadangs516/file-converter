// dist/ 를 GitHub 의 gh-pages 브랜치에 올려 GitHub Pages 로 배포한다.
// 사용: npm run build  →  npm run deploy
// (gh-pages 는 매번 새로 덮어쓴다. 원본 소스는 main 브랜치에 있다)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('dist/ 가 없어요. 먼저 npm run build 를 실행하세요.'); process.exit(1); }

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const remote = git(ROOT, 'remote', 'get-url', 'origin');
const name = git(ROOT, 'config', 'user.name');
const email = git(ROOT, 'config', 'user.email');
const stamp = git(ROOT, 'log', '-1', '--format=%h %s');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-'));
try {
  fs.cpSync(DIST, tmp, { recursive: true });
  git(tmp, 'init', '-q', '-b', 'gh-pages');
  git(tmp, 'config', 'core.autocrlf', 'false');
  git(tmp, 'config', 'user.name', name);
  git(tmp, 'config', 'user.email', email);
  git(tmp, 'add', '-A');
  git(tmp, 'commit', '-q', '-m', `deploy: ${stamp}`);
  git(tmp, 'remote', 'add', 'origin', remote);
  git(tmp, 'push', '-q', '--force', 'origin', 'gh-pages');
  console.log('gh-pages 에 올렸어요. 반영까지 1~2분 걸릴 수 있어요.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
