import { access, cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const siteRoot = join(repositoryRoot, 'site');

const outputs = [
  ['main-react-webpack', 'examples/main-react-webpack/build', 'demo-main-react-webpack'],
  ['main-react-rspack', 'examples/main-react-rspack/dist', 'demo-main-react-rspack'],
  ['main-vue-vite', 'examples/main-vue-vite/dist', 'demo-main-vue-vite'],
  ['react16', 'examples/react16/build', 'demo-react16'],
  ['react17', 'examples/react17/build', 'demo-react17'],
  ['vue2', 'examples/vue2/dist', 'demo-vue2'],
  ['vue3', 'examples/vue3/dist', 'demo-vue3'],
  ['vite', 'examples/vite/dist', 'demo-vite'],
  ['angular12', 'examples/angular12/dist', 'demo-angular12'],
  ['docs', 'docs/.vitepress/dist', 'doc'],
];

const missingOutputs = [];
for (const [name, relativeSource] of outputs) {
  const source = join(repositoryRoot, relativeSource);
  try {
    await access(join(source, 'index.html'));
  } catch {
    missingOutputs.push(`${name}: ${relativeSource}/index.html`);
  }
}

if (missingOutputs.length > 0) {
  throw new Error(
    `Cannot assemble examples; build outputs are missing:\n- ${missingOutputs.join('\n- ')}\nRun pnpm build:examples.`,
  );
}

await rm(siteRoot, { recursive: true, force: true });
await mkdir(siteRoot, { recursive: true });

for (const [name, relativeSource, relativeTarget] of outputs) {
  const source = join(repositoryRoot, relativeSource);
  const target = join(siteRoot, relativeTarget);
  await cp(source, target, { recursive: true });
  console.log(`${name}: ${relativeSource} -> site/${relativeTarget}`);
}

await writeFile(
  join(siteRoot, 'index.html'),
  '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/demo-main-react/"><title>Jieshu examples</title><a href="/demo-main-react/">Open Jieshu examples</a>\n',
);

console.log(`Assembled ${outputs.length} outputs in site/`);
