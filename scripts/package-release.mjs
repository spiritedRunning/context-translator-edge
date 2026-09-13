import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'));
// package.json uses SemVer (1.0.0); browser UI and GitHub release artifacts use the requested 1.0.
const version = packageJson.version.endsWith('.0') ? packageJson.version.slice(0, -2) : packageJson.version;
const artifacts = [
  { target: 'edge', filename: `context-translator-edge-${version}.zip` },
  { target: 'chrome', filename: `context-translator-chrome-${version}.zip` },
  { target: 'firefox', filename: `context-translator-firefox-${version}.xpi` },
];

run('npm', ['run', 'build:all'], projectRoot);
mkdirSync(resolve(projectRoot, 'dist-zip'), { recursive: true });

for (const { target, filename } of artifacts) {
  const sourceDir = resolve(projectRoot, 'dist', target);
  const output = resolve(projectRoot, 'dist-zip', filename);
  rmSync(output, { force: true });
  // Store manifest.json at the archive root: Chromium users can unpack the zip directly and
  // Firefox/AMO expects this layout inside an XPI.
  run('zip', ['-q', '-r', output, '.'], sourceDir);
}

const checksumLines = artifacts.map(({ filename }) => {
  const bytes = readFileSync(resolve(projectRoot, 'dist-zip', filename));
  return `${createHash('sha256').update(bytes).digest('hex')}  ${filename}`;
});
writeFileSync(
  resolve(projectRoot, 'dist-zip', `SHA256SUMS-${version}.txt`),
  `${checksumLines.join('\n')}\n`,
);

for (const { filename } of artifacts) console.log(`Created dist-zip/${filename}`);
console.log(`Created dist-zip/SHA256SUMS-${version}.txt`);

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
