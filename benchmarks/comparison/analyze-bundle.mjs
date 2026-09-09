import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { build } from 'vite';

const root = fileURLToPath(new URL('../..', import.meta.url));
const output = path.resolve(process.env.BENCH_OUTPUT || path.join(root, 'test-results/footprint-bundle'));
const repositories = {
  jieshu: root,
  wujie: path.resolve(process.env.WUJIE_ROOT || path.join(root, '../wujie')),
};
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const decodeSegment = (segment) => {
  const values = [];
  let value = 0;
  let shift = 0;
  for (const character of segment) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) {
      throw new Error(`Invalid source-map VLQ character: ${character}`);
    }
    value += (digit & 31) * 2 ** shift;
    if (digit & 32) {
      shift += 5;
    } else {
      values.push(value & 1 ? -Math.floor(value / 2) : value / 2);
      value = 0;
      shift = 0;
    }
  }
  if (shift) {
    throw new Error('Incomplete source-map VLQ value');
  }
  return values;
};

// Attribute each generated span to its nearest preceding mapping on that line.
// This measures minified output bytes, not original source length. Mapping gaps,
// wrappers, and newlines stay unattributed. Cross-module minifier rewrites mean
// these allocations are descriptive, not independently removable byte counts.
const attributeGeneratedBytes = (code, map) => {
  const allocated = new Map();
  const add = (source, text) => {
    allocated.set(source, (allocated.get(source) || 0) + Buffer.byteLength(text));
  };
  let sourceIndex = 0;
  const lines = code.split('\n');
  const mappingLines = map.mappings.split(';');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    let column = 0;
    let previousColumn = 0;
    let owner = '[unmapped]';
    for (const raw of (mappingLines[lineIndex] || '').split(',')) {
      if (!raw) {
        continue;
      }
      const segment = decodeSegment(raw);
      column += segment[0];
      if (column < previousColumn || column > line.length || ![1, 4, 5].includes(segment.length)) {
        throw new Error('Invalid generated source-map position');
      }
      add(owner, line.slice(previousColumn, column));
      if (segment.length > 1) {
        sourceIndex += segment[1];
        if (!map.sources[sourceIndex]) {
          throw new Error('Invalid source-map source index');
        }
        owner = map.sources[sourceIndex];
      } else {
        owner = '[unmapped]';
      }
      previousColumn = column;
    }
    add(owner, line.slice(previousColumn));
    if (lineIndex < lines.length - 1) {
      add('[unmapped]', '\n');
    }
  }
  const total = [...allocated.values()].reduce((sum, bytes) => sum + bytes, 0);
  if (total !== Buffer.byteLength(code)) {
    throw new Error(`Source-map allocation mismatch: ${total} !== ${Buffer.byteLength(code)}`);
  }
  return allocated;
};

const shortName = (file, framework) => {
  const marker = `packages/${framework}-core/src/`;
  const position = file.indexOf(marker);
  return position < 0 ? file : file.slice(position + marker.length);
};

await mkdir(output, { recursive: true });
const results = [];
for (const [framework, repository] of Object.entries(repositories)) {
  const entry = path.join(repository, 'packages', `${framework}-core`, 'src/index.ts');
  const git = (args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
  const revision = { commit: git(['rev-parse', 'HEAD']), status: git(['status', '--short']) };
  for (const target of ['es2018', 'es2022']) {
    for (const usage of ['whole-core', 'start-only-consumer']) {
      const consumerEntry = path.join(output, `${framework}-consumer.mjs`);
      if (usage === 'start-only-consumer') {
        await writeFile(
          consumerEntry,
          `import { startApp } from ${JSON.stringify(entry)}; window.__comparisonStartApp = startApp;\n`,
        );
      }
      const built = await build({
        configFile: false,
        root: repository,
        logLevel: 'error',
        define: { 'process.env.NODE_ENV': JSON.stringify('production') },
        build: {
          target,
          write: false,
          minify: true,
          sourcemap: 'hidden',
          lib: {
            entry: usage === 'whole-core' ? entry : consumerEntry,
            name: 'ComparisonCore',
            formats: ['iife'],
          },
        },
      });
      const chunks = (Array.isArray(built) ? built : [built])
        .flatMap((item) => item.output)
        .filter((item) => item.type === 'chunk');
      if (chunks.length !== 1 || !chunks[0].map) {
        throw new Error('Expected one chunk with a source map');
      }
      const chunk = chunks[0];
      const allocation = attributeGeneratedBytes(chunk.code, chunk.map);
      const modules = [...allocation].map(([source, generatedBytes]) => {
        const sourceIndex = chunk.map.sources.indexOf(source);
        const original = chunk.map.sourcesContent[sourceIndex];
        const module = Object.entries(chunk.modules).find(
          ([id]) => shortName(id, framework) === shortName(source, framework),
        );
        return {
          module: shortName(source, framework),
          generatedBytes,
          originalSourceBytes: original === undefined || original === null ? null : Buffer.byteLength(original),
          preMinifyRenderedBytes: module ? Buffer.byteLength(module[1].code) : null,
        };
      });
      modules.sort((left, right) => right.generatedBytes - left.generatedBytes);
      const label = `${framework}-${usage}-${target}`;
      const result = {
        framework,
        usage,
        target,
        revision,
        bundleBytes: Buffer.byteLength(chunk.code),
        gzipBytes: gzipSync(chunk.code).length,
        sha256: createHash('sha256').update(chunk.code).digest('hex'),
        exports: chunk.exports,
        modules,
      };
      results.push(result);
      await writeFile(path.join(output, `${label}.js`), chunk.code);
      await writeFile(path.join(output, `${label}.js.map`), chunk.map.toString());
      console.log(`${label}: ${result.bundleBytes} bytes, ${result.gzipBytes} gzip bytes`);
    }
  }
}

const metadata = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  vite: JSON.parse(await readFile(path.join(root, 'node_modules/vite/package.json'), 'utf8')).version,
  method: {
    entry: 'Local checkout core source; identical production minifier, IIFE format, and target for both frameworks.',
    wholeCore: 'All public runtime exports retained, matching run.mjs.',
    startOnlyConsumer:
      'ESM consumer imports only startApp and stores it on window; ordinary tree shaking, same IIFE output.',
    es2022: 'Diagnostic counterfactual only; supported ES2018 build target is unchanged.',
    generatedBytes:
      'UTF-8 generated spans assigned by preceding source-map segment on each line; totals reconcile exactly.',
    preMinifyRenderedBytes:
      'Bundler module code after tree shaking and target lowering but before whole-chunk minification.',
    gzipBytes: 'Whole output gzip only. Module gzip cannot be added because compression shares a dictionary.',
    limitations: [
      'Source-map attribution is approximate near generated helpers and cross-module rewrites.',
      'Module generated spans are not the bytes saved by removing that module.',
      'Source consumers do not measure published package metadata or downstream prebuilt ESM behavior.',
      'This script does not measure browser startup or heap memory.',
    ],
  },
  results,
};
await writeFile(path.join(output, 'analysis.json'), `${JSON.stringify(metadata, null, 2)}\n`);
const baseline = results.filter((item) => item.target === 'es2018' && item.usage === 'whole-core');
const byModule = new Map();
for (const item of baseline) {
  for (const module of item.modules) {
    const values = byModule.get(module.module) || { module: module.module, jieshu: 0, wujie: 0 };
    values[item.framework] = module.generatedBytes;
    byModule.set(module.module, values);
  }
}
const differences = [...byModule.values()]
  .map((item) => ({ ...item, delta: item.jieshu - item.wujie }))
  .sort((left, right) => right.delta - left.delta);
await writeFile(path.join(output, 'module-differences.json'), `${JSON.stringify(differences, null, 2)}\n`);
