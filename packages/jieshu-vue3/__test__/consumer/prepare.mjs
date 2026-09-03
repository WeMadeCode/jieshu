import { mkdir, rm, symlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureRoot = dirname(fileURLToPath(import.meta.url));
const dependencyRoot = resolve(fixtureRoot, 'node_modules');
const packageRoot = resolve(fixtureRoot, '../..');
const packageLink = resolve(dependencyRoot, 'jieshu-vue3');

await mkdir(dependencyRoot, { recursive: true });
await rm(packageLink, { force: true, recursive: true });
await symlink(packageRoot, packageLink, process.platform === 'win32' ? 'junction' : 'dir');
