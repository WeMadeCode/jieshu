import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const inputs = process.argv.slice(2);
if (inputs.length !== 2) {
  throw new Error('Usage: node benchmarks/comparison/inspect-heap.mjs WUJIE.heapsnapshot JIESHU.heapsnapshot');
}

const limit = 50;
const categories = ['code', 'string', 'closure', 'object', 'other'];
const categoryFor = (type) => {
  if (type === 'code' || type === 'closure') {
    return type;
  }
  if (type === 'string' || type === 'concatenated string' || type === 'sliced string') {
    return 'string';
  }
  if (type === 'object' || type === 'array' || type === 'object shape' || type === 'regexp') {
    return 'object';
  }
  return 'other';
};
const emptySize = () => ({ count: 0, bytes: 0 });
const increment = (total, selfSize) => {
  total.count += 1;
  total.bytes += selfSize;
};
const isIndex = (value, length) => Number.isInteger(value) && value >= 0 && value < length;

const readNodeSchema = (data, filename) => {
  const fields = data.snapshot?.meta?.node_fields;
  const types = data.snapshot?.meta?.node_types;
  const nodes = data.nodes;
  const strings = data.strings;
  if (!Array.isArray(fields) || fields.length === 0 || !Array.isArray(types)) {
    throw new Error(`${filename}: missing heap node schema`);
  }
  const indexOf = (field) => {
    const index = fields.indexOf(field);
    if (index < 0) {
      throw new Error(`${filename}: node schema is missing ${field}`);
    }
    return index;
  };
  const typeIndex = indexOf('type');
  const nameIndex = indexOf('name');
  const sizeIndex = indexOf('self_size');
  const typeNames = types[typeIndex];
  if (!Array.isArray(typeNames) || types[nameIndex] !== 'string' || types[sizeIndex] !== 'number') {
    throw new Error(`${filename}: unsupported type/name/self_size schema`);
  }
  if (!Array.isArray(nodes) || !Array.isArray(strings) || nodes.length % fields.length !== 0) {
    throw new Error(`${filename}: invalid flat node table or string table`);
  }
  const nodeCount = nodes.length / fields.length;
  if (data.snapshot.node_count !== undefined && data.snapshot.node_count !== nodeCount) {
    throw new Error(`${filename}: node_count does not match the flat node table`);
  }

  return { fields, nodes, strings, typeIndex, nameIndex, sizeIndex, typeNames };
};

const readSnapshot = async (input) => {
  const filename = path.resolve(input);
  const data = JSON.parse(await readFile(filename, 'utf8'));
  const { fields, nodes, strings, typeIndex, nameIndex, sizeIndex, typeNames } = readNodeSchema(data, filename);

  const total = emptySize();
  const byCategory = new Map(categories.map((category) => [category, emptySize()]));
  const groups = new Map();
  for (let offset = 0; offset < nodes.length; offset += fields.length) {
    const typeId = nodes[offset + typeIndex];
    const nameId = nodes[offset + nameIndex];
    const selfSize = nodes[offset + sizeIndex];
    if (!isIndex(typeId, typeNames.length) || !isIndex(nameId, strings.length)) {
      throw new Error(`${filename}: invalid node type/name at node ${offset / fields.length}`);
    }
    if (!Number.isSafeInteger(selfSize) || selfSize < 0) {
      throw new Error(`${filename}: invalid self_size at node ${offset / fields.length}`);
    }
    const type = typeNames[typeId];
    const name = strings[nameId];
    if (typeof type !== 'string' || typeof name !== 'string') {
      throw new Error(`${filename}: node type/name must resolve to strings`);
    }
    const category = categoryFor(type);
    increment(total, selfSize);
    increment(byCategory.get(category), selfSize);
    // Group using the full name; output previews never merge distinct names.
    const key = JSON.stringify([type, name]);
    let group = groups.get(key);
    if (!group) {
      group = { category, type, name, ...emptySize() };
      groups.set(key, group);
    }
    increment(group, selfSize);
  }
  return { filename, fields, total, byCategory, groups };
};

const [wujie, jieshu] = await Promise.all(inputs.map(readSnapshot));
const compareSize = (left, right) => ({
  wujie: { count: left.count, bytes: left.bytes },
  jieshu: { count: right.count, bytes: right.bytes },
  delta: { count: right.count - left.count, bytes: right.bytes - left.bytes },
  bytesChangePercent: left.bytes === 0 ? null : ((right.bytes - left.bytes) / left.bytes) * 100,
});
const keys = new Set([...wujie.groups.keys(), ...jieshu.groups.keys()]);
const groups = [...keys].map((key) => {
  const left = wujie.groups.get(key);
  const right = jieshu.groups.get(key);
  const group = right || left;
  return {
    category: group.category,
    type: group.type,
    name: group.name,
    ...compareSize(left || emptySize(), right || emptySize()),
  };
});
const descendingMagnitude = (left, right) => {
  return (
    Math.abs(right.delta.bytes) - Math.abs(left.delta.bytes) ||
    Math.abs(right.delta.count) - Math.abs(left.delta.count) ||
    left.type.localeCompare(right.type) ||
    left.name.localeCompare(right.name)
  );
};
const displayGroup = (group) => {
  if (group.name.length <= 200) {
    return group;
  }
  return {
    ...group,
    name: `${group.name.slice(0, 200)}…`,
    nameLength: group.name.length,
    nameSha256: createHash('sha256').update(group.name).digest('hex'),
  };
};
const largestDeltas = (entries) => {
  return entries
    .filter((entry) => entry.delta.bytes !== 0 || entry.delta.count !== 0)
    .sort(descendingMagnitude)
    .slice(0, limit)
    .map(displayGroup);
};

const report = {
  inputs: { wujie: wujie.filename, jieshu: jieshu.filename },
  nodeFields: { wujie: wujie.fields, jieshu: jieshu.fields },
  interpretation: {
    delta: 'jieshu minus wujie; positive means more in the Jieshu snapshot',
    bytes: 'Sum of V8 node self_size; not retained size, total browser RSS, or necessarily Performance.JSHeapUsedSize',
    grouping: 'Exact node type and full name; names longer than 200 characters display a preview plus SHA-256',
    ranking: 'Top 50 changed groups by absolute byte delta, then absolute count delta',
    categories: {
      code: ['code'],
      string: ['string', 'concatenated string', 'sliced string'],
      closure: ['closure'],
      object: ['object', 'array', 'object shape', 'regexp'],
      other: 'All remaining node types, including native and synthetic nodes',
    },
    limitation: 'Group differences identify allocation candidates, not retention paths or proof of a leak',
  },
  total: compareSize(wujie.total, jieshu.total),
  top50: largestDeltas(groups),
  byCategory: categories.map((category) => ({
    category,
    ...compareSize(wujie.byCategory.get(category), jieshu.byCategory.get(category)),
    top50: largestDeltas(groups.filter((group) => group.category === category)),
  })),
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
