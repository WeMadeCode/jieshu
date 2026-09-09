import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { build } from 'vite';

const root = fileURLToPath(new URL('../..', import.meta.url));
if (process.argv.length > 3) {
  throw new Error('Usage: node benchmarks/comparison/probe-bundle-candidates.mjs [analysis-directory]');
}
const input = path.resolve(process.argv[2] || path.join(root, 'test-results/footprint-bundle'));
const analysis = JSON.parse(await readFile(path.join(input, 'analysis.json'), 'utf8'));
const baseline = analysis.results?.find(
  (result) => result.framework === 'jieshu' && result.usage === 'whole-core' && result.target === 'es2018',
);
if (!baseline || !/^[a-f0-9]{64}$/.test(baseline.sha256)) {
  throw new Error('Analysis is missing the Jieshu whole-core ES2018 baseline SHA256');
}
const map = JSON.parse(await readFile(path.join(input, 'jieshu-whole-core-es2018.js.map'), 'utf8'));
const base = 'packages/jieshu-core/src/';
const originals = new Map();
for (let index = 0; index < map.sources.length; index += 1) {
  const source = map.sources[index];
  const position = source.indexOf(base);
  const content = map.sourcesContent[index];
  if (position < 0 || typeof content !== 'string') {
    throw new Error(`Source map contains an unsupported or missing original source: ${source}`);
  }
  const key = source.slice(position);
  if (originals.has(key)) {
    throw new Error(`Source map repeats an original module: ${key}`);
  }
  originals.set(key, content);
}

// Source maps omit re-export-only modules such as common.ts. Read those from
// the captured commit, never from a concurrently changing working tree. The
// complete baseline hash below also verifies this supplemental source choice.
const supplementalSources = new Map();
const readSupplementalSource = (module) => {
  const cached = supplementalSources.get(module);
  if (cached !== undefined) {
    return cached;
  }
  const commit = baseline.revision?.commit;
  if (typeof commit !== 'string' || !/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error(`Source map omits ${module} and has no captured commit to recover it`);
  }
  const source = execFileSync('git', ['show', `${commit}:${module}`], { cwd: root, encoding: 'utf8' });
  supplementalSources.set(module, source);
  return source;
};

const readSource = (sources, module) => {
  const source = sources.get(`${base}${module}`);
  if (typeof source !== 'string') {
    throw new Error(`Source map is missing ${module}`);
  }
  return source;
};

const flattenConstants = (original) => {
  let code = original;
  for (const object of ['elementProtocol', 'runtimeProtocol', 'diagnosticText']) {
    const expression = new RegExp(
      `const ${object} = \\{([\\s\\S]*?)\\} as const;[\\s]*export const \\{([\\s\\S]*?)\\} = ${object};`,
    );
    const matched = code.match(expression);
    if (!matched) {
      throw new Error(`Candidate no longer matches the private constant object: ${object}`);
    }
    const literalProperty = /\s*(\w+): ('[^']*'),?/g;
    const properties = [...matched[1].matchAll(literalProperty)];
    const values = new Map(properties.map((match) => [match[1], match[2]]));
    if (matched[1].replace(literalProperty, '').trim() || properties.length !== values.size) {
      throw new Error(`Candidate requires unique literal string properties only: ${object}`);
    }
    const declarations = matched[2]
      .split(',')
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const [key, name] = pair.split(':').map((part) => part.trim());
        const value = values.get(key);
        if (!value || !name) {
          throw new Error(`Candidate is missing a literal constant mapping: ${pair}`);
        }
        return `export const ${name} = ${value};`;
      });
    if (declarations.length !== values.size) {
      throw new Error(`Candidate requires all private properties to have one exported constant: ${object}`);
    }
    code = code.replace(expression, declarations.join('\n'));
  }
  return code;
};

const replaceOnce = (code, original, replacement) => {
  const first = code.indexOf(original);
  if (first < 0 || code.indexOf(original, first + original.length) >= 0) {
    throw new Error(`Candidate requires exactly one matching source fragment: ${original}`);
  }
  return code.replace(original, replacement);
};

const shareAttributes = (sources) => {
  let entry = readSource(sources, 'entry.ts');
  let template = readSource(sources, 'template.ts');
  const pattern = /function escapeAttributeValue\(value: string\): string \{[\s\S]*?\n\}/;
  const helper = entry.match(pattern)?.[0];
  if (!helper || template.match(pattern)?.[0] !== helper) {
    throw new Error('Candidate requires identical attribute escaping implementations');
  }
  const attributes =
    "const STYLE_ATTRIBUTE_NAMES = ['media', 'nonce', 'title', 'type', 'blocking', 'disabled'] as const;";
  entry = replaceOnce(entry, helper, '');
  entry = replaceOnce(entry, attributes, '');
  entry = replaceOnce(
    entry,
    'genLinkReplaceSymbol, getInlineStyleReplaceSymbol',
    'genLinkReplaceSymbol, getInlineStyleReplaceSymbol, escapeAttributeValue, STYLE_ATTRIBUTE_NAMES',
  );
  template = replaceOnce(template, attributes, `export ${attributes}`);
  template = replaceOnce(template, helper, `export ${helper}`);
  sources.set(`${base}entry.ts`, entry);
  sources.set(`${base}template.ts`, template);
};

// Each invocation gets its own directory; previous what-if results and source
// maps remain untouched. Candidate transformations exist only in this process.
const output = await mkdtemp(path.join(input, 'candidates-'));
console.log(`Candidate output: ${output}`);
const results = [];
for (const candidate of ['frozen-baseline', 'flatten-constants', 'share-attributes', 'both']) {
  const sources = new Map(originals);
  if (candidate === 'flatten-constants' || candidate === 'both') {
    sources.set(`${base}constant.ts`, flattenConstants(readSource(sources, 'constant.ts')));
  }
  if (candidate === 'share-attributes' || candidate === 'both') {
    shareAttributes(sources);
  }
  const built = await build({
    configFile: false,
    root,
    logLevel: 'error',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    plugins: [
      {
        name: 'frozen-diagnostic-source',
        enforce: 'pre',
        load: (id) => {
          const module = path.relative(root, id).split(path.sep).join('/');
          if (!module.startsWith(base)) {
            return undefined;
          }
          const source = sources.get(module);
          if (typeof source !== 'string') {
            return readSupplementalSource(module);
          }
          return source;
        },
      },
    ],
    build: {
      target: 'es2018',
      minify: true,
      write: false,
      sourcemap: false,
      lib: {
        entry: path.join(root, base, 'index.ts'),
        name: 'ComparisonCore',
        formats: ['iife'],
      },
    },
  });
  const chunks = (Array.isArray(built) ? built : [built])
    .flatMap((item) => item.output)
    .filter((item) => item.type === 'chunk');
  if (chunks.length !== 1) {
    throw new Error(`Expected one candidate chunk, received ${chunks.length}`);
  }
  const { code } = chunks[0];
  const sha256 = createHash('sha256').update(code).digest('hex');
  if (candidate === 'frozen-baseline' && sha256 !== baseline.sha256) {
    throw new Error(`Frozen baseline SHA256 differs from analysis: ${sha256} !== ${baseline.sha256}`);
  }
  const result = {
    candidate,
    bundleBytes: Buffer.byteLength(code),
    gzipBytes: gzipSync(code).length,
    sha256,
    file: `${candidate}.js`,
  };
  results.push(result);
  await writeFile(path.join(output, result.file), code, { flag: 'wx' });
  console.log(`${candidate}: ${result.bundleBytes} bytes, ${result.gzipBytes} gzip bytes, SHA256 ${sha256}`);
}
await writeFile(
  path.join(output, 'candidate-analysis.json'),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      input,
      node: process.version,
      vite: JSON.parse(await readFile(path.join(root, 'node_modules/vite/package.json'), 'utf8')).version,
      baselineRevision: baseline.revision,
      baselineSha256: baseline.sha256,
      baselineVerified: true,
      supplementalSources: [...supplementalSources].map(([module, source]) => ({
        module,
        sha256: createHash('sha256').update(source).digest('hex'),
      })),
      method: 'Four in-memory transformations of frozen source-map originals; identical production ES2018 IIFE build.',
      limitations: [
        'These candidates match the captured source structure and deliberately fail when that structure differs.',
        'Successful byte comparison is not behavioral validation of a future source change.',
        'No browser load-time or heap measurement is performed.',
      ],
      results,
    },
    null,
    2,
  )}\n`,
  { flag: 'wx' },
);
