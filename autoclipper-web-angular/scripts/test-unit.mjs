import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
await build({ entryPoints: ['tests/client-entry.ts'], outfile: '.local/tests/client.mjs', bundle: true, packages: 'external', platform: 'node', format: 'esm', tsconfig: 'tsconfig.json' });
const files = (await readdir('tests/unit')).filter(file => file.endsWith('.test.mjs')).map(file => `tests/unit/${file}`);
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', windowsHide: true });
process.exitCode = result.status ?? 1;
