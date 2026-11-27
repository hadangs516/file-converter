// 수정 전 버전 보관: 소스를 '버전 보관/v1', 'v2' ... 로 그대로 복사한다.
// 사용: node snapshot.mjs  (또는 npm run snapshot) — 코드를 고치기 직전에 실행한다.
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const vaultDir = join(root, '버전 보관');
const targets = [
  'src', 'build.mjs', 'build-artifact.mjs', 'deploy.mjs', 'snapshot.mjs',
  'site.config.json', 'package.json', 'README.md', '인수인계.md', '배포 체크리스트.md', '미리보기 실행.bat',
];

mkdirSync(vaultDir, { recursive: true });
const last = readdirSync(vaultDir)
  .map((n) => /^v(\d+)$/.exec(n))
  .filter(Boolean)
  .reduce((m, r) => Math.max(m, Number(r[1])), 0);
const name = `v${last + 1}`;
const dest = join(vaultDir, name);
mkdirSync(dest);

for (const t of targets) {
  const from = join(root, t);
  if (existsSync(from)) cpSync(from, join(dest, t), { recursive: true });
}
const note = process.argv.slice(2).join(' ');
writeFileSync(join(dest, '_메모.txt'), `${name} — ${new Date().toLocaleString('ko-KR')}\n${note}\n`, 'utf8');
console.log(`저장 완료: 버전 보관/${name}${note ? ' (' + note + ')' : ''}`);
