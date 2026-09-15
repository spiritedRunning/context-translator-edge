import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = resolve(import.meta.dirname, '..');
const firefoxDir = resolve(projectRoot, 'dist', 'firefox');
const output = resolve(firefoxDir, 'context-translator-firefox.xpi');

// Keep a stable local-install filename directly beside the unpacked Firefox build. Excluding all
// XPI files prevents a previous package from being recursively embedded in the new archive.
rmSync(output, { force: true });
const result = spawnSync('zip', ['-q', '-r', output, '.', '-x', '*.xpi'], {
  cwd: firefoxDir,
  stdio: 'inherit',
});
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('Created dist/firefox/context-translator-firefox.xpi');
