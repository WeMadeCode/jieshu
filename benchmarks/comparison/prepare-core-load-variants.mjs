import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import ts from 'typescript';
import { build } from 'vite';

const root = fileURLToPath(new URL('../..', import.meta.url));
const output = path.resolve(process.env.CORE_CAUSE_OUTPUT || path.join(root, 'test-results/core-load-causes'));
const repositories = {
  wujie: path.resolve(process.env.WUJIE_ROOT || path.join(root, '../wujie')),
  jieshu: root,
};
const priorMeasuredHashes = {
  wujie: '6a950d2373d9804976ceaca5e7b2085935629e10c1e66e373635b86dc00a6794',
  jieshu: '3aff6614cb7d47525cd662c87ebbeeae74c8ba76fd02f92a660d8ea403f8c84e',
};
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const sourceFingerprint = async (repository, framework) => {
  const sourceRoot = path.join(repository, 'packages', `${framework}-core`, 'src');
  const files = [];
  const visit = async (directory) => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, item.name);
      if (item.isDirectory()) {
        await visit(filename);
      } else if (item.isFile()) {
        files.push(filename);
      }
    }
  };
  await visit(sourceRoot);
  files.push(path.join(repository, 'packages', `${framework}-core`, 'package.json'));
  const hashes = [];
  for (const filename of files.sort()) {
    hashes.push([path.relative(repository, filename), sha256(await readFile(filename))]);
  }
  return sha256(JSON.stringify(hashes));
};

// Decode only standard v3 mappings. Original lines and columns are needed to
// identify the two entry calls independently of minified identifier spelling.
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const decodeSegment = (raw) => {
  const values = [];
  let value = 0;
  let shift = 0;
  for (const character of raw) {
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
  if (shift || ![1, 4, 5].includes(values.length)) {
    throw new Error('Invalid source-map VLQ segment');
  }
  return values;
};
const mappingLines = (map, code) => {
  if (map.version !== 3 || !Array.isArray(map.sourcesContent)) {
    throw new Error('Expected a v3 source map including original source contents');
  }
  let source = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let name = 0;
  const lines = code.split('\n');
  return map.mappings.split(';').map((line, lineIndex) => {
    let generatedColumn = 0;
    return line
      .split(',')
      .filter(Boolean)
      .map((raw) => {
        const segment = decodeSegment(raw);
        const previousColumn = generatedColumn;
        generatedColumn += segment[0];
        if (generatedColumn < previousColumn || generatedColumn > (lines[lineIndex]?.length ?? -1)) {
          throw new Error('Invalid generated source-map column');
        }
        if (segment.length === 1) {
          return { generatedColumn };
        }
        source += segment[1];
        originalLine += segment[2];
        originalColumn += segment[3];
        if (!map.sources[source] || originalLine < 0 || originalColumn < 0) {
          throw new Error('Invalid original source-map position');
        }
        if (segment.length === 5) {
          name += segment[4];
        }
        return { generatedColumn, source, originalLine, originalColumn, name: map.names[name] };
      });
  });
};
const parse = (code, filename) => {
  const source = ts.createSourceFile(filename, code, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const options = { allowJs: true, noLib: true, noEmit: true, target: ts.ScriptTarget.ESNext };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (file) => (file === filename ? source : undefined);
  const program = ts.createProgram([filename], options, host);
  if (program.getSyntacticDiagnostics(source).length) {
    throw new Error(`Invalid JavaScript: ${filename}`);
  }
  return source;
};
const unwrap = (node) => (ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node);
const coreInitializer = (source) => {
  const declarations = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .filter((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === 'ComparisonCore');
  if (declarations.length !== 1 || !declarations[0].initializer) {
    throw new Error('Expected one top-level ComparisonCore initializer');
  }
  const initializer = declarations[0].initializer;
  const call = unwrap(initializer);
  const factory = ts.isCallExpression(call) ? unwrap(call.expression) : undefined;
  if (!factory || !(ts.isFunctionExpression(factory) || ts.isArrowFunction(factory)) || !ts.isBlock(factory.body)) {
    throw new Error('ComparisonCore initializer is not an immediately invoked function');
  }
  return { initializer, body: factory.body };
};
const entryCalls = (code, map, source) => {
  const entries = map.sources
    .map((name, index) => ({ name, index }))
    .filter(({ name }) => name.replaceAll('\\', '/').endsWith('packages/jieshu-core/src/index.ts'));
  if (entries.length !== 1) {
    throw new Error('Cannot uniquely identify jieshu-core/src/index.ts in the source map');
  }
  const entry = entries[0];
  const originalCode = map.sourcesContent[entry.index];
  if (typeof originalCode !== 'string') {
    throw new Error('Entry source content is absent from the source map');
  }
  const original = ts.createSourceFile(entry.name, originalCode, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const expected = ['processAppForHrefJump', 'defineJieshuWebComponent'];
  const targets = expected.map((name) => {
    const candidates = original.statements
      .filter(ts.isExpressionStatement)
      .map((statement) => statement.expression)
      .filter(
        (expression) =>
          ts.isCallExpression(expression) &&
          ts.isIdentifier(expression.expression) &&
          expression.expression.text === name &&
          expression.arguments.length === 0,
      );
    if (candidates.length !== 1) {
      throw new Error(`Expected one original top-level ${name}() call`);
    }
    return { name, call: candidates[0], matches: [] };
  });
  const mappings = mappingLines(map, code);
  const locate = (position) => {
    const { line, character } = source.getLineAndCharacterOfPosition(position);
    const preceding = (mappings[line] || []).filter((item) => item.generatedColumn <= character).at(-1);
    if (preceding?.source !== entry.index) {
      return undefined;
    }
    const originalPosition = original.getPositionOfLineAndCharacter(preceding.originalLine, preceding.originalColumn);
    return { ...preceding, originalPosition, generatedLine: line, generatedColumn: character };
  };
  const visit = (node) => {
    // Only calls executed by the outer IIFE are candidates. A same-named call
    // inside a function declaration must never be suppressed by this probe.
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) {
      return;
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.arguments.length === 0) {
      const mapping = locate(node.getStart(source));
      if (mapping) {
        for (const target of targets) {
          if (
            mapping.originalPosition >= target.call.getStart(original) &&
            mapping.originalPosition < target.call.end
          ) {
            target.matches.push({ node, mapping });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(coreInitializer(source).body, visit);
  return targets.map((target) => {
    if (target.matches.length !== 1) {
      throw new Error(`Expected one mapped outer-IIFE call for ${target.name}; found ${target.matches.length}`);
    }
    const { node, mapping } = target.matches[0];
    return {
      name: target.name,
      start: node.getStart(source),
      end: node.end,
      originalCall: node.getText(source),
      originalSource: entry.name,
      originalLine: mapping.originalLine + 1,
      originalColumn: mapping.originalColumn + 1,
      generatedLine: mapping.generatedLine + 1,
      generatedColumn: mapping.generatedColumn + 1,
    };
  });
};
const cacheInitializers = (code, map, source) => {
  const entries = map.sources
    .map((name, index) => ({ name, index }))
    .filter(({ name }) => name.replaceAll('\\', '/').endsWith('packages/jieshu-core/src/entry.ts'));
  if (entries.length !== 1 || typeof map.sourcesContent[entries[0].index] !== 'string') {
    throw new Error('Cannot uniquely identify entry.ts and its source contents');
  }
  const entry = entries[0];
  const original = ts.createSourceFile(
    entry.name,
    map.sourcesContent[entry.index],
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );
  const declarations = original.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations);
  const targets = ['styleAssets', 'scriptAssets', 'htmlDocuments'].map((name) => {
    const candidates = declarations.filter(
      (declaration) =>
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === name &&
        declaration.initializer &&
        ts.isNewExpression(declaration.initializer) &&
        ts.isIdentifier(declaration.initializer.expression) &&
        declaration.initializer.expression.text === 'AssetCache',
    );
    if (candidates.length !== 1) {
      throw new Error(`Expected one original top-level new AssetCache initializer for ${name}`);
    }
    return { name, initializer: candidates[0].initializer, matches: [] };
  });
  const mappings = mappingLines(map, code);
  const visit = (node) => {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) {
      return;
    }
    if (ts.isNewExpression(node) && ts.isVariableDeclaration(node.parent) && node.parent.initializer === node) {
      const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
      const mapping = (mappings[line] || []).filter((item) => item.generatedColumn <= character).at(-1);
      if (mapping?.source === entry.index) {
        const position = original.getPositionOfLineAndCharacter(mapping.originalLine, mapping.originalColumn);
        for (const target of targets) {
          if (position >= target.initializer.getStart(original) && position < target.initializer.end) {
            target.matches.push({ node, mapping, line, character });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(coreInitializer(source).body, visit);
  return targets.map((target) => {
    if (target.matches.length !== 1) {
      throw new Error(`Expected one mapped AssetCache initializer for ${target.name}; found ${target.matches.length}`);
    }
    const { node, mapping, line, character } = target.matches[0];
    return {
      name: target.name,
      start: node.getStart(source),
      end: node.end,
      originalInitializer: node.getText(source),
      originalSource: entry.name,
      originalLine: mapping.originalLine + 1,
      originalColumn: mapping.originalColumn + 1,
      generatedLine: line + 1,
      generatedColumn: character + 1,
    };
  });
};
const insert = (code, insertions) => {
  const ordered = [...insertions].sort((left, right) => left.offset - right.offset);
  let position = 0;
  let result = '';
  const instrumentationOffsets = [];
  for (const item of ordered) {
    if (!Number.isInteger(item.offset) || item.offset < position || item.offset > code.length) {
      throw new Error('Invalid or overlapping instrumentation offsets');
    }
    result += code.slice(position, item.offset);
    instrumentationOffsets.push({
      baselineUtf16Offset: item.offset,
      baselineUtf8Offset: Buffer.byteLength(code.slice(0, item.offset)),
      variantUtf16Offset: result.length,
      insertedText: item.text,
      reason: item.reason,
    });
    result += item.text;
    position = item.offset;
  }
  result += code.slice(position);
  let reconstructed = result;
  for (const item of [...instrumentationOffsets].reverse()) {
    reconstructed =
      reconstructed.slice(0, item.variantUtf16Offset) +
      reconstructed.slice(item.variantUtf16Offset + item.insertedText.length);
  }
  if (reconstructed !== code) {
    throw new Error('Instrumentation changed original code instead of only inserting guards');
  }
  return { code: result, instrumentationOffsets };
};

await mkdir(path.dirname(output), { recursive: true });
await mkdir(output); // Refuse reuse, including an existing empty output directory.
await mkdir(path.join(output, 'bundles'));
const revisions = {};
const baselines = {};
const variants = [];
const saveVariant = async ({ id, framework, code, kind, explanation, exportExpected, ...details }) => {
  parse(code, `${id}.js`);
  const bytes = Buffer.from(code, 'utf8');
  const gzip = gzipSync(bytes);
  const file = `bundles/${id}.js`;
  const gzipFile = `${file}.gz`;
  await writeFile(path.join(output, file), bytes, { flag: 'wx' });
  await writeFile(path.join(output, gzipFile), gzip, { flag: 'wx' });
  variants.push({
    id,
    framework,
    file,
    gzipFile,
    sha256: sha256(bytes),
    rawBytes: bytes.length,
    gzipBytes: gzip.length,
    gzipSha256: sha256(gzip),
    exportExpected,
    kind,
    explanation,
    baselineSha256: baselines[framework].sha256,
    revision: revisions[framework].commit,
    instrumentationOffsets: [],
    ...details,
  });
};
for (const [framework, repository] of Object.entries(repositories)) {
  const before = await sourceFingerprint(repository, framework);
  const revision = {
    commit: git(repository, ['rev-parse', 'HEAD']),
    status: git(repository, ['status', '--short']),
    sourceSha256: before,
    package: JSON.parse(await readFile(path.join(repository, 'packages', `${framework}-core`, 'package.json'), 'utf8'))
      .version,
    packageManager: JSON.parse(await readFile(path.join(repository, 'package.json'), 'utf8')).packageManager,
  };
  const built = await build({
    configFile: false,
    root: repository,
    logLevel: 'error',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      target: 'es2018',
      write: false,
      minify: true,
      sourcemap: 'hidden',
      lib: {
        entry: path.join(repository, 'packages', `${framework}-core`, 'src/index.ts'),
        name: 'ComparisonCore',
        formats: ['iife'],
      },
    },
  });
  const chunks = (Array.isArray(built) ? built : [built])
    .flatMap((item) => item.output || [])
    .filter((item) => item.type === 'chunk');
  if (chunks.length !== 1 || !chunks[0].map) {
    throw new Error(`Expected one ${framework} core chunk and a hidden source map`);
  }
  const { code, map } = chunks[0];
  if (code.includes('sourceMappingURL=')) {
    throw new Error('Hidden source map must not add a footer to the measured bundle');
  }
  if (before !== (await sourceFingerprint(repository, framework))) {
    throw new Error(`${framework} sources changed during the build`);
  }
  const hash = sha256(code);
  revisions[framework] = {
    ...revision,
    sha256: hash,
    bundleBytes: Buffer.byteLength(code),
    gzipBytes: gzipSync(Buffer.from(code, 'utf8')).length,
    priorMeasuredSha256: priorMeasuredHashes[framework],
    matchesPriorMeasuredBundle: hash === priorMeasuredHashes[framework],
  };
  baselines[framework] = { code, map, sha256: hash };
  const sourceMapFile = `bundles/${framework}.js.map`;
  const sourceMapBytes = Buffer.from(map.toString(), 'utf8');
  await writeFile(path.join(output, sourceMapFile), sourceMapBytes, { flag: 'wx' });
  await saveVariant({
    id: framework,
    framework,
    code,
    kind: 'baseline',
    exportExpected: true,
    sourceMapFile,
    sourceMapSha256: sha256(sourceMapBytes),
    explanation: 'Production ES2018 minified IIFE with all public runtime exports; hidden source map adds no footer.',
  });
}

const paddingBytes = Buffer.byteLength(baselines.jieshu.code) - Buffer.byteLength(baselines.wujie.code);
if (paddingBytes < 4) {
  throw new Error('Jieshu must exceed Wujie by at least four UTF-8 bytes for the padding control');
}
const padding = `/*${'x'.repeat(paddingBytes - 4)}*/`;
const padded = `${baselines.wujie.code}${padding}`;
if (Buffer.byteLength(padded) !== Buffer.byteLength(baselines.jieshu.code)) {
  throw new Error('Padded Wujie does not match Jieshu raw byte length');
}
await saveVariant({
  id: 'wujie-padded',
  framework: 'wujie',
  code: padded,
  kind: 'raw-byte-padding-control',
  exportExpected: true,
  paddingBytes,
  instrumentationOffsets: [
    {
      baselineUtf16Offset: baselines.wujie.code.length,
      baselineUtf8Offset: Buffer.byteLength(baselines.wujie.code),
      insertedAsciiBytes: paddingBytes,
      reason: 'Append one ASCII block comment to match Jieshu raw UTF-8 size.',
    },
  ],
  explanation:
    'Wujie plus an ASCII block comment matching Jieshu raw size. Syntax work and compressed size are not matched.',
});
const jieshuSource = parse(baselines.jieshu.code, 'jieshu.js');
const calls = entryCalls(baselines.jieshu.code, baselines.jieshu.map, jieshuSource);
const entrySkipped = insert(
  baselines.jieshu.code,
  calls.flatMap((call) => [
    { offset: call.start, text: '(false&&', reason: `Skip only entry call ${call.name}().` },
    { offset: call.end, text: ')', reason: `End guard for entry call ${call.name}().` },
  ]),
);
await saveVariant({
  id: 'jieshu-entry-skipped',
  framework: 'jieshu',
  ...entrySkipped,
  kind: 'entry-side-effects-control',
  exportExpected: true,
  guardedCalls: calls,
  explanation:
    'Diagnostic only: suppress the two mapped entry calls for href routing and custom element registration; preserve all minified function bodies and exports.',
});
const caches = cacheInitializers(baselines.jieshu.code, baselines.jieshu.map, jieshuSource);
const cachesSkipped = insert(
  baselines.jieshu.code,
  caches.map((cache) => ({
    offset: cache.start,
    text: 'false&&',
    reason: `Do not construct the top-level ${cache.name} AssetCache.`,
  })),
);
await saveVariant({
  id: 'jieshu-caches-skipped',
  framework: 'jieshu',
  ...cachesSkipped,
  kind: 'asset-cache-initialization-control',
  exportExpected: true,
  guardedInitializers: caches,
  explanation:
    'Diagnostic only: suppress styleAssets, scriptAssets and htmlDocuments initialization and any compilation/allocation it triggers. Original text is retained but parsing/compilation policy may change. Exports retain their shape, but asset loading and clearAssetsCache are unusable.',
});
for (const framework of Object.keys(repositories)) {
  const { code } = baselines[framework];
  const source = parse(code, `${framework}.js`);
  const { initializer } = coreInitializer(source);
  const skipped = insert(code, [
    {
      offset: initializer.getStart(source),
      text: 'false&&',
      reason: 'Do not execute the unique ComparisonCore IIFE initializer.',
    },
  ]);
  await saveVariant({
    id: `${framework}-init-skipped`,
    framework,
    ...skipped,
    kind: 'initialization-skipped-control',
    exportExpected: false,
    explanation:
      'Diagnostic only: ComparisonCore becomes false. Original code text is retained, but the JavaScript engine may skip parsing or compilation through constant folding and lazy parsing.',
  });
}
for (const [framework, repository] of Object.entries(repositories)) {
  if (revisions[framework].sourceSha256 !== (await sourceFingerprint(repository, framework))) {
    throw new Error(`${framework} sources changed while preparing variants`);
  }
}
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  build: {
    target: 'es2018',
    minify: true,
    sourcemap: 'hidden',
    format: 'iife',
    mode: 'production',
    exports: 'all public runtime exports',
    vite: JSON.parse(await readFile(path.join(root, 'node_modules/vite/package.json'), 'utf8')).version,
    node: process.version,
  },
  revisions,
  variants,
  limitations: [
    'Variants are causal diagnostic controls, not production implementations or equivalent functional products.',
    'Padded Wujie matches raw bytes only; its comment is cheap to parse and compresses more than executable source.',
    'Skipping an IIFE changes engine optimization and lazy compilation decisions, so its timing is not a pure parse-time measurement.',
    'Entry-skipped retains API exports but intentionally omits routing listeners and custom-element registration; it must not run application correctness benchmarks.',
    'Caches-skipped retains API exports but asset loading and clearAssetsCache are unusable. Its difference includes initialization and any compilation/allocation it triggers; original text is retained but parsing/compilation policy may change.',
    'Source maps describe the two unmodified baselines only. Instrumentation offsets are provided separately for modified variants.',
    'Output files are UTF-8 and gzip files compress those exact bytes. Relative file paths resolve against this manifest directory.',
  ],
};
await writeFile(path.join(output, 'variants.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
console.log(
  JSON.stringify({
    output,
    variants: variants.map(({ id, rawBytes, gzipBytes, sha256 }) => ({ id, rawBytes, gzipBytes, sha256 })),
    matchesPriorMeasuredBundles: Object.values(revisions).every((revision) => revision.matchesPriorMeasuredBundle),
  }),
);
