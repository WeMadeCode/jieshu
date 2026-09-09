import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import ts from 'typescript';

const inputs = process.argv.slice(2);
if (inputs.length !== 2) {
  throw new Error(
    'Usage: node benchmarks/comparison/inspect-instanceof-heap.mjs JIESHU.heapsnapshot MATCHING-JIESHU-BUNDLE.js',
  );
}
const filename = path.resolve(inputs[0]);
const bundleFilename = path.resolve(inputs[1]);
const environment = JSON.parse(await readFile(path.join(path.dirname(filename), 'environment.json'), 'utf8'));
const bundle = await readFile(bundleFilename, 'utf8');
const bundleSha256 = createHash('sha256').update(bundle).digest('hex');
if (bundleSha256 !== environment.revisions?.jieshu?.sha256) {
  throw new Error('Bundle SHA256 does not match this heap run’s recorded Jieshu build');
}

// Resolve lexical symbols in the actual measured bundle. Public property names
// describe the constructor-to-state relationship; minified bindings are derived
// afresh from that relationship rather than carried over from an older run.
const options = { allowJs: true, noLib: true, noEmit: true, target: ts.ScriptTarget.ESNext };
const host = ts.createCompilerHost(options);
host.getSourceFile = (file, languageVersion) =>
  file === bundleFilename ? ts.createSourceFile(file, bundle, languageVersion, true, ts.ScriptKind.JS) : undefined;
const program = ts.createProgram([bundleFilename], options, host);
const source = program.getSourceFile(bundleFilename);
if (!source || program.getSyntacticDiagnostics(source).length) {
  throw new Error('Cannot parse the matching bundle as JavaScript');
}
const checker = program.getTypeChecker();
const symbolFor = (node) => (ts.isIdentifier(node) ? checker.getSymbolAtLocation(node) : undefined);
const initializerFor = (node) => {
  if (!ts.isIdentifier(node)) {
    return node;
  }
  const declaration = symbolFor(node)?.valueDeclaration;
  return declaration && ts.isVariableDeclaration(declaration) ? declaration.initializer : undefined;
};
const isNew = (node, name) =>
  node && ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name;
const propertyValue = (object, name) => {
  const property = object.properties.find(
    (item) =>
      ts.isPropertyAssignment(item) &&
      (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) &&
      item.name.text === name,
  );
  return property && ts.isPropertyAssignment(property) ? property.initializer : undefined;
};
const assignments = new Map();
const privateStateSymbols = [];
const collectAllocations = (node) => {
  if (
    ts.isBinaryExpression(node) &&
    ts.isIdentifier(node.left) &&
    [
      ts.SyntaxKind.EqualsToken,
      ts.SyntaxKind.QuestionQuestionEqualsToken,
      ts.SyntaxKind.BarBarEqualsToken,
      ts.SyntaxKind.AmpersandAmpersandEqualsToken,
    ].includes(node.operatorToken.kind)
  ) {
    const symbol = symbolFor(node.left);
    if (symbol) {
      const writes = assignments.get(symbol) || [];
      writes.push({ offset: node.getStart(source), createsWeakMap: Boolean(isNew(node.right, 'WeakMap')) });
      assignments.set(symbol, writes);
    }
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer &&
    ts.isCallExpression(node.initializer) &&
    ts.isIdentifier(node.initializer.expression) &&
    node.initializer.expression.text === 'Symbol' &&
    node.initializer.arguments.length === 1 &&
    (ts.isStringLiteral(node.initializer.arguments[0]) ||
      ts.isNoSubstitutionTemplateLiteral(node.initializer.arguments[0])) &&
    node.initializer.arguments[0].text === 'jieshu.instanceof-state'
  ) {
    privateStateSymbols.push({ binding: node.name.text, declarationOffset: node.getStart(source) });
  }
  ts.forEachChild(node, collectAllocations);
};
collectAllocations(source);
const weakMapBinding = (identifier) => {
  const symbol = symbolFor(identifier);
  const declaration = symbol?.valueDeclaration;
  if (!declaration || !ts.isVariableDeclaration(declaration)) {
    return undefined;
  }
  const writes = assignments.get(symbol) || [];
  const eager = isNew(declaration.initializer, 'WeakMap');
  if (!eager && !writes.some((write) => write.createsWeakMap)) {
    return undefined;
  }
  return {
    symbol,
    binding: identifier.text,
    declarationOffset: declaration.getStart(source),
    initialization: eager ? 'eager-WeakMap' : declaration.initializer ? 'other-initializer' : 'initially-undefined',
    writes,
    allRecordedAssignmentsCreateWeakMap: writes.every((write) => write.createsWeakMap),
  };
};
const receiverBindings = (receiver) => {
  const bindings = new Map();
  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      const binding = weakMapBinding(node);
      if (binding) {
        bindings.set(binding.symbol, binding);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(receiver);
  return [...bindings.values()];
};
const registrySymbols = new Map();
const inspectSyntax = (node) => {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'set' &&
    node.arguments.length === 2
  ) {
    const bindings = receiverBindings(node.expression.expression);
    const state = initializerFor(node.arguments[1]);
    if (bindings.length === 1 && state && ts.isObjectLiteralExpression(state)) {
      const constructor = propertyValue(state, 'constructor');
      const peers = propertyValue(state, 'peers');
      const keySymbol = symbolFor(node.arguments[0]);
      if (
        constructor &&
        peers &&
        keySymbol &&
        symbolFor(constructor) === keySymbol &&
        isNew(initializerFor(peers), 'Map')
      ) {
        const { symbol, ...registry } = bindings[0];
        registrySymbols.set(symbol, {
          ...registry,
          stateRegistrationOffset: node.getStart(source),
        });
      }
    }
  }
  ts.forEachChild(node, inspectSyntax);
};
inspectSyntax(source);
const registries = [...registrySymbols.values()];
if (registries.length !== 1) {
  throw new Error(`Expected one constructor-to-state WeakMap in the measured bundle; found ${registries.length}`);
}

const data = JSON.parse(await readFile(filename, 'utf8'));
const meta = data.snapshot?.meta;
const nodeFields = meta?.node_fields;
const edgeFields = meta?.edge_fields;
if (!Array.isArray(nodeFields) || !Array.isArray(edgeFields)) {
  throw new Error('Heap snapshot is missing node/edge metadata');
}
const schema = (fields, required) =>
  Object.fromEntries(
    required.map((name) => {
      const index = fields.indexOf(name);
      if (index < 0) {
        throw new Error(`Heap schema is missing ${name}`);
      }
      return [name, index];
    }),
  );
const ni = schema(nodeFields, ['type', 'name', 'id', 'self_size', 'edge_count']);
const ei = schema(edgeFields, ['type', 'name_or_index', 'to_node']);
const nodeTypes = meta.node_types[ni.type];
const edgeTypes = meta.edge_types[ei.type];
const width = nodeFields.length;
const edgeWidth = edgeFields.length;
if (
  !Array.isArray(data.nodes) ||
  !Array.isArray(data.edges) ||
  !Array.isArray(data.strings) ||
  data.nodes.length % width ||
  data.edges.length % edgeWidth
) {
  throw new Error('Heap snapshot has invalid flat tables');
}
const count = data.nodes.length / width;
const nodes = [];
let edgeOffset = 0;
for (let index = 0; index < count; index += 1) {
  const offset = index * width;
  const outgoing = [];
  const edgeCount = data.nodes[offset + ni.edge_count];
  if (!Number.isSafeInteger(edgeCount) || edgeCount < 0) {
    throw new Error(`Invalid edge count at node ${index}`);
  }
  for (let position = 0; position < edgeCount; position += 1) {
    const edge = edgeOffset + position * edgeWidth;
    const type = edgeTypes[data.edges[edge + ei.type]];
    const rawName = data.edges[edge + ei.name_or_index];
    const to = data.edges[edge + ei.to_node] / width;
    const name = type === 'element' || type === 'hidden' ? rawName : data.strings[rawName];
    if (typeof type !== 'string' || name === undefined || !Number.isInteger(to) || to < 0 || to >= count) {
      throw new Error(`Invalid edge at flat offset ${edge}`);
    }
    outgoing.push({ type, name, to });
  }
  nodes.push({
    id: data.nodes[offset + ni.id],
    type: nodeTypes[data.nodes[offset + ni.type]],
    name: data.strings[data.nodes[offset + ni.name]],
    bytes: data.nodes[offset + ni.self_size],
    outgoing,
    incoming: [],
  });
  edgeOffset += edgeCount * edgeWidth;
}
if (
  edgeOffset !== data.edges.length ||
  (data.snapshot.node_count !== undefined && data.snapshot.node_count !== count)
) {
  throw new Error('Heap counts do not reconcile');
}
for (let index = 0; index < count; index += 1) {
  for (const edge of nodes[index].outgoing) {
    nodes[edge.to].incoming.push({ from: index, ...edge });
  }
}
const preview = (index) => ({
  index,
  id: nodes[index].id,
  type: nodes[index].type,
  name: nodes[index].name.length > 160 ? `${nodes[index].name.slice(0, 160)}…` : nodes[index].name,
  selfBytes: nodes[index].bytes,
});
const ids = new Map(nodes.map((node, index) => [node.id, index]));
const isEphemeron = (edge) => typeof edge.name === 'string' && edge.name.includes('pair in WeakMap');
const isStrong = (edge) => edge.type !== 'weak' && !isEphemeron(edge);

// Root reachability is shown as an explicit edge chain. Conditional ephemeron
// edges are excluded, so this cannot invent a strong path through a weak key.
const parents = new Int32Array(count).fill(-1);
const parentEdges = new Array(count);
const queue = [0];
parents[0] = 0;
for (let cursor = 0; cursor < queue.length; cursor += 1) {
  const from = queue[cursor];
  for (const edge of nodes[from].outgoing) {
    if (isStrong(edge) && parents[edge.to] === -1) {
      parents[edge.to] = from;
      parentEdges[edge.to] = edge;
      queue.push(edge.to);
    }
  }
}
const pathTo = (index) => {
  if (parents[index] === -1) {
    return null;
  }
  const result = [];
  for (let current = index; current !== 0; current = parents[current]) {
    const edge = parentEdges[current];
    result.push({ from: preview(parents[current]), edge: { type: edge.type, name: edge.name }, to: preview(current) });
  }
  return result.reverse();
};

const scripts = nodes.flatMap((node, index) => {
  const sourceEdge = node.outgoing.find((edge) => edge.type === 'internal' && edge.name === 'source');
  const nameEdge = node.outgoing.find((edge) => edge.name === 'name');
  if (!sourceEdge || !nameEdge || !node.name.startsWith('system / Script')) {
    return [];
  }
  const url = nodes[nameEdge.to].name;
  const prefix = nodes[sourceEdge.to].name;
  return /\/jieshu\.js(?:[?#]|$)/.test(url) && prefix.length >= 100 && bundle.startsWith(prefix)
    ? [{ index, url, sourcePrefixBytes: Buffer.byteLength(prefix) }]
    : [];
});
if (scripts.length !== 1) {
  throw new Error(`Expected one Jieshu script matching the measured bundle prefix; found ${scripts.length}`);
}
const locationFields = meta.location_fields;
if (!Array.isArray(locationFields) || !Array.isArray(data.locations)) {
  throw new Error('Heap snapshot lacks function locations needed to associate contexts with the core script');
}
const li = schema(locationFields, ['object_index', 'script_object_index', 'line', 'column']);
const locations = new Map();
for (let offset = 0; offset < data.locations.length; offset += locationFields.length) {
  locations.set(data.locations[offset + li.object_index] / width, {
    script: data.locations[offset + li.script_object_index] / width,
    line: data.locations[offset + li.line],
    column: data.locations[offset + li.column],
  });
}
const contextEvidence = (index) =>
  nodes[index].incoming
    .filter(
      (edge) =>
        edge.type === 'internal' && edge.name === 'context' && locations.get(edge.from)?.script === scripts[0].index,
    )
    .slice(0, 3)
    .map((edge) => ({ closure: preview(edge.from), location: locations.get(edge.from) }));

const bindingEvidence = (names) =>
  nodes.flatMap((node, index) => {
    const entries = node.outgoing.filter((edge) => edge.type === 'context' && names.includes(edge.name));
    if (!entries.length) {
      return [];
    }
    const evidence = contextEvidence(index);
    if (!evidence.length) {
      return [];
    }
    return entries.map((edge) => ({
      owner: preview(index),
      binding: edge.name,
      value: preview(edge.to),
      valueEdges: nodes[edge.to].outgoing
        .slice(0, 5)
        .map((item) => ({ type: item.type, name: item.name, to: preview(item.to) })),
      scriptEvidence: evidence,
      strongRootPath: [
        ...(pathTo(index) || []),
        { from: preview(index), edge: { type: edge.type, name: edge.name }, to: preview(edge.to) },
      ],
    }));
  });
const registryBindings = bindingEvidence([registries[0].binding]);
const stateSymbolBindings = bindingEvidence(privateStateSymbols.map((item) => item.binding));

const tableDetails = (index) => {
  const table = nodes[index];
  let holes = 0;
  let livePairs = 0;
  const unknownEdges = [];
  const examples = [];
  for (const edge of table.outgoing) {
    if (edge.type === 'internal' && edge.name === 'map') {
      continue;
    }
    const pair =
      typeof edge.name === 'string'
        ? edge.name.match(/key \((.*) @(\d+)\) -> value \((.*) @(\d+)\) pair in WeakMap/)
        : null;
    if (pair) {
      const key = ids.get(Number(pair[2]));
      const value = ids.get(Number(pair[4]));
      if (
        key !== undefined &&
        value !== undefined &&
        nodes[key].type === 'native' &&
        nodes[value].type === 'native' &&
        nodes[key].name === 'system / Hole' &&
        nodes[value].name === 'system / Hole'
      ) {
        holes += 1;
      } else {
        livePairs += 1;
      }
      if (examples.length < 3) {
        examples.push({ annotation: edge.name, target: preview(edge.to) });
      }
    } else {
      unknownEdges.push({ type: edge.type, name: edge.name, target: preview(edge.to) });
    }
  }
  return {
    table: preview(index),
    holePairRecords: holes,
    nonHolePairRecords: livePairs,
    weakEdges: table.outgoing.filter((edge) => edge.type === 'weak').length,
    otherPayloadEdges: unknownEdges.length,
    emptyUnderRecognizedSchema: livePairs === 0 && unknownEdges.length === 0,
    pairExamples: examples,
    otherPayloadExamples: unknownEdges.slice(0, 3),
  };
};
const weakMaps = nodes.flatMap((node, index) => {
  if (node.type !== 'object' || node.name !== 'WeakMap') {
    return [];
  }
  const table = node.outgoing.find((edge) => edge.type === 'internal' && edge.name === 'table');
  if (!table) {
    return [];
  }
  const bindings = node.incoming
    .filter((edge) => edge.type === 'context' && edge.name === registries[0].binding)
    .map((edge) => ({ owner: preview(edge.from), binding: edge.name, scriptEvidence: contextEvidence(edge.from) }))
    .filter((entry) => entry.scriptEvidence.length > 0);
  return [
    {
      weakMap: preview(index),
      ...tableDetails(table.to),
      bindings,
      strongRootPath: bindings.length ? pathTo(table.to) : undefined,
    },
  ];
});
const candidates = weakMaps.filter((item) => item.bindings.length > 0);
const lazy = registries[0].initialization === 'initially-undefined';
const observedUndefined =
  lazy &&
  registryBindings.length === 1 &&
  ['undefined', 'system / Undefined'].includes(registryBindings[0].value.name) &&
  registryBindings[0].value.type === 'native';
const allocationState = observedUndefined
  ? 'fallback-is-undefined'
  : candidates.length === 1 && registryBindings.length === 1
    ? lazy
      ? 'fallback-WeakMap-allocated'
      : 'eager-WeakMap-allocated'
    : 'unresolved-or-ambiguous';
const report = {
  input: filename,
  bundle: { filename: bundleFilename, sha256: bundleSha256 },
  run: { cycles: environment.cycles, memoryRounds: environment.memoryRounds, revision: environment.revisions.jieshu },
  identification: observedUndefined
    ? 'unique-fallback-undefined-binding'
    : candidates.length === 1
      ? 'unique-structural-match'
      : 'unresolved-or-ambiguous',
  sourceRegistry: registries[0],
  sourcePrivateSymbols: privateStateSymbols,
  heapScript: scripts[0],
  allocationState,
  registryBindings,
  stateSymbolBindings,
  candidates,
  largestWeakMapTables: weakMaps.sort((left, right) => right.table.selfBytes - left.table.selfBytes).slice(0, 8),
  limitations: [
    'Identification uses the measured bundle AST, its run SHA256, current context binding and heap script locations; no old minified binding is hard-coded.',
    'Heap source text may be truncated. Full bundle identity relies on the supplied run metadata; the heap script prefix is an additional check.',
    'Table self_size is allocated backing storage, not retained size or a portable bucket count.',
    'Ephemeron record counts are snapshot records, not a portable WeakMap.size API. Unknown layouts are not classified as empty.',
    'The root path excludes weak and conditional ephemeron edges; it demonstrates reachability rather than computing dominators.',
    'An empty retained backing table is storage overhead, not proof that child constructors, states or Windows remain alive.',
    'A lazy fallback is reported as undefined only when its measured-bundle Context binding explicitly points to the native Undefined node; a missing binding is inconclusive.',
  ],
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
