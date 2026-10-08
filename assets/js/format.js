// Pure helpers for the Dumpspace JSON format: parsing, layout and C++ output.
// No DOM access here, so everything can be tested in Node.

export const KIND_NAME = { D: 'basic', C: 'class', S: 'struct', E: 'enum' };

export function toNum(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

export function hex(n, pad = 0) {
  if (n == null || Number.isNaN(n)) return '?';
  const neg = n < 0;
  const body = Math.abs(n).toString(16).toUpperCase().padStart(pad, '0');
  return (neg ? '-0x' : '0x') + body;
}

/** Digits needed to show offsets inside a type of this size, so columns line up. */
export function hexPad(size) {
  return Math.max(4, Math.max(0, size).toString(16).length);
}

/** Format a number in the user's chosen base. */
export function fmt(n, base, pad = 0) {
  if (n == null || Number.isNaN(n)) return '?';
  return base === 'dec' ? String(n) : hex(n, pad);
}

// ---------------------------------------------------------------- types

/** Raw type tuple [name, kind, ext, subtypes] -> TypeRef */
export function parseType(t) {
  if (!Array.isArray(t)) return { name: String(t ?? '?'), kind: 'D', ext: '', subs: [] };
  return {
    name: String(t[0] ?? '?'),
    kind: typeof t[1] === 'string' && t[1] ? t[1] : 'D',
    ext: typeof t[2] === 'string' ? t[2] : '',
    subs: Array.isArray(t[3]) ? t[3].map(parseType) : [],
  };
}

export function typeToString(tr) {
  let s = tr.name;
  if (tr.subs.length) s += '<' + tr.subs.map(typeToString).join(', ') + '>';
  return s + tr.ext;
}

/** Split a type into tokens; tokens with `ref` can link to a type definition. */
export function typeTokens(tr, out = []) {
  const linkable = tr.kind === 'C' || tr.kind === 'S' || tr.kind === 'E';
  out.push({ t: tr.name, ref: linkable ? tr.name : null, kind: linkable ? tr.kind : 'D' });
  if (tr.subs.length) {
    out.push({ t: '<' });
    tr.subs.forEach((s, i) => {
      if (i) out.push({ t: ', ' });
      typeTokens(s, out);
    });
    out.push({ t: '>' });
  }
  if (tr.ext) out.push({ t: tr.ext });
  return out;
}

// ---------------------------------------------------------------- files

/** Normalise one of the five JSON files into { data, version, updatedAt, credit }. */
export function unwrapFile(json) {
  if (json == null) return { data: [], version: 0, updatedAt: 0, credit: null };
  if (Array.isArray(json)) return { data: json, version: 0, updatedAt: 0, credit: null };
  return {
    data: Array.isArray(json.data) ? json.data : [],
    version: toNum(json.version),
    updatedAt: toNum(json.updated_at),
    credit: json.credit && typeof json.credit === 'object' ? json.credit : null,
  };
}

/** Each data item is a single-key object { Name: value }. */
export function entryOf(item) {
  if (!item || typeof item !== 'object') return null;
  for (const k in item) return [k, item[k]];
  return null;
}

/** Read inheritance and size from a class/struct entry without parsing members. */
export function readTypeMeta(members) {
  let parents = [];
  let size = 0;
  let found = 0;
  const scan = (obj) => {
    for (const k in obj) {
      if (k === '__InheritInfo') { parents = Array.isArray(obj[k]) ? obj[k].map(String) : []; found++; }
      else if (k === '__MDKClassSize') { size = toNum(obj[k]); found++; }
    }
  };
  if (!Array.isArray(members)) return { parents, size, count: 0 };
  // The metadata normally sits in the first two entries.
  for (let i = 0; i < Math.min(4, members.length) && found < 2; i++) scan(members[i]);
  if (found < 2) for (let i = 4; i < members.length && found < 2; i++) scan(members[i]);
  let count = 0;
  for (const m of members) {
    for (const k in m) if (!k.startsWith('__')) count++;
  }
  return { parents, size, count };
}

const BIT_SUFFIX = /\s*:\s*\d+$/;

/**
 * One member entry -> { name, type, offset, size, dim, bit }.
 * Format 10202: [type, offset, size, arrayDim, bitOffset?]
 * Format 10201: [type, offset, size, bitOffset?] and bitfield names end in " : 1".
 */
export function parseMember(key, v, version) {
  const arr = Array.isArray(v) ? v : [];
  const type = parseType(arr[0]);
  const offset = toNum(arr[1]);
  const size = toNum(arr[2]);
  let dim = 1;
  let bit = null;
  let name = key;
  const old = version ? version < 10202 : (arr.length === 3 || BIT_SUFFIX.test(key));
  if (old) {
    if (arr.length >= 4) { bit = toNum(arr[3]); name = key.replace(BIT_SUFFIX, ''); }
  } else {
    if (arr.length >= 4) dim = toNum(arr[3]) || 1;
    if (arr.length >= 5) bit = toNum(arr[4]);
  }
  return { name, type, offset, size, dim, bit };
}

export function parseTypeMembers(members, version) {
  const out = [];
  if (!Array.isArray(members)) return out;
  for (const obj of members) {
    const e = entryOf(obj);
    if (!e || e[0].startsWith('__')) continue;
    out.push(parseMember(e[0], e[1], version));
  }
  return out;
}

/** Enum entry value: [[{Name: value}, ...], underlyingType] */
export function parseEnum(value) {
  const arr = Array.isArray(value) ? value : [];
  const values = [];
  if (Array.isArray(arr[0])) {
    for (const obj of arr[0]) {
      const e = entryOf(obj);
      if (e) values.push({ name: e[0], value: toNum(e[1]) });
    }
  }
  return { underlying: typeof arr[1] === 'string' ? arr[1] : '', values };
}

/** Function entry value: [returnType, [[paramType, refFlag, paramName], ...], address, flags] */
export function parseFunction(name, value) {
  const arr = Array.isArray(value) ? value : [];
  const params = Array.isArray(arr[1])
    ? arr[1].map((p) => ({
        type: parseType(Array.isArray(p) ? p[0] : p),
        ref: Array.isArray(p) && typeof p[1] === 'string' ? p[1] : '',
        name: Array.isArray(p) && p[2] != null ? String(p[2]) : '',
      }))
    : [];
  const flagText = typeof arr[3] === 'string' ? arr[3] : '';
  return {
    name,
    ret: parseType(arr[0]),
    params,
    address: toNum(arr[2]),
    flags: flagText.split(/[|\s]+/).filter(Boolean),
  };
}

export function parseFunctions(list) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const obj of list) {
    const e = entryOf(obj);
    if (e) out.push(parseFunction(e[0], e[1]));
  }
  return out;
}

export function signature(fn) {
  const params = fn.params.map((p) => `${typeToString(p.type)}${p.ref} ${p.name}`.trim());
  return `${typeToString(fn.ret)} ${fn.name}(${params.join(', ')})`;
}

// ---------------------------------------------------------------- layout

/**
 * Rows for one type's own members between its parent's end and its own size.
 * Gaps are only reported when the dump has real sizes (Unreal dumps do, Unity dumps don't).
 */
export function ownLayout(type, parentEnd) {
  const placed = type.members
    .filter((m) => m.offset >= 0)
    .slice()
    .sort((a, b) => a.offset - b.offset || (a.bit ?? -1) - (b.bit ?? -1));
  const statics = type.members.filter((m) => m.offset < 0);
  const sized = type.size > 0 && placed.every((m) => m.size > 0);
  const rows = [];
  let cursor = parentEnd;
  for (const m of placed) {
    if (sized && m.offset > cursor) rows.push({ kind: 'gap', start: cursor, size: m.offset - cursor });
    rows.push({ kind: 'member', m });
    cursor = Math.max(cursor, m.offset + Math.max(m.size, 1));
  }
  if (sized && type.size > cursor) rows.push({ kind: 'gap', start: cursor, size: type.size - cursor });
  for (const m of statics) rows.push({ kind: 'static', m });
  return { rows, sized };
}

/** Where the inherited part of a type ends: the parent's size, or the first member if the parent isn't in the dump. */
export function parentEndOf(type, parent) {
  if (parent && parent.size > 0) return parent.size;
  if (!type.parents.length) return 0;
  const first = type.members.filter((m) => m.offset >= 0).reduce((min, m) => Math.min(min, m.offset), Infinity);
  return Number.isFinite(first) ? first : 0;
}

// ---------------------------------------------------------------- C++ output
// Lines are arrays of tokens { t, c } so the viewer can colour them and copy plain text.

function cppTypeTokens(tr) {
  return typeTokens(tr).map((tok) => (tok.ref ? { t: tok.t, c: 'k-' + (KIND_NAME[tok.kind] || 'basic'), ref: tok.ref, kind: tok.kind } : { t: tok.t, c: tok.kind === 'D' ? 'k-basic' : null }));
}

function line(...parts) {
  return parts.flat().filter(Boolean);
}

export function linesToText(lines) {
  return lines.map((l) => l.map((tok) => tok.t).join('')).join('\n');
}

function padComments(decls) {
  // decls: [{ tokens, comment }] -> aligned lines
  const width = Math.min(64, decls.reduce((w, d) => Math.max(w, d.tokens.reduce((n, t) => n + t.t.length, 0)), 0));
  return decls.map((d) => {
    if (!d.comment) return d.tokens;
    const len = d.tokens.reduce((n, t) => n + t.t.length, 0);
    return [...d.tokens, { t: ' '.repeat(Math.max(1, width - len + 2)) }, { t: '// ' + d.comment, c: 'cm' }];
  });
}

export function typeToCpp(type, kindWord, parentEnd, opts = {}) {
  const pad = hexPad(type.size);
  const { rows, sized } = ownLayout(type, parentEnd);
  const out = [];
  const header = [];
  if (sized) header.push(`Size ${hex(type.size)}`);
  if (type.parents.length && sized) header.push(`inherited ${hex(parentEnd)}`);
  if (header.length) out.push([{ t: '// ' + header.join(', '), c: 'cm' }]);
  const decl = [{ t: kindWord, c: 'kw' }, { t: ' ' }, { t: type.name, c: 'k-' + kindWord }];
  if (type.parents.length) decl.push({ t: ' : ' }, { t: 'public', c: 'kw' }, { t: ' ' }, { t: type.parents[0], c: 'k-' + kindWord, ref: type.parents[0], kind: kindWord === 'class' ? 'C' : 'S' });
  out.push(decl);
  out.push([{ t: '{' }]);
  out.push([{ t: 'public', c: 'kw' }, { t: ':' }]);

  const decls = [];
  let bitByte = null;
  let nextBit = 0;
  const tab = { t: '\t' };
  for (const row of rows) {
    if (row.kind === 'gap') {
      bitByte = null;
      decls.push({
        tokens: [tab, { t: 'uint8', c: 'k-basic' }, { t: ` Pad_${row.start.toString(16).toUpperCase()}[` }, { t: hex(row.size), c: 'num' }, { t: '];' }],
        comment: `${hex(row.start, pad)}(${hex(row.size, 4)}) unknown`,
      });
      continue;
    }
    const m = row.m;
    if (row.kind === 'static') {
      decls.push({ tokens: [tab, { t: 'static', c: 'kw' }, { t: ' ' }, ...cppTypeTokens(m.type), { t: ` ${m.name};` }], comment: 'static' });
      continue;
    }
    if (m.bit != null) {
      if (bitByte !== m.offset) {
        if (bitByte !== null) decls.push({ tokens: [tab, ...cppTypeTokens(m.type), { t: ' : ' }, { t: '0', c: 'num' }, { t: ';' }], comment: 'next byte' });
        bitByte = m.offset;
        nextBit = 0;
      }
      if (m.bit > nextBit) {
        decls.push({
          tokens: [tab, ...cppTypeTokens(m.type), { t: ` BitPad_${m.offset.toString(16).toUpperCase()}_${nextBit} : ` }, { t: String(m.bit - nextBit), c: 'num' }, { t: ';' }],
          comment: m.bit - 1 === nextBit ? `${hex(m.offset, pad)} bit ${nextBit} unknown` : `${hex(m.offset, pad)} bits ${nextBit}-${m.bit - 1} unknown`,
        });
      }
      nextBit = m.bit + 1;
      decls.push({
        tokens: [tab, ...cppTypeTokens(m.type), { t: ` ${m.name} : ` }, { t: '1', c: 'num' }, { t: ';' }],
        comment: `${hex(m.offset, pad)}(${hex(m.size, 4)}) bit ${m.bit}`,
      });
      continue;
    }
    bitByte = null;
    const arr = m.dim > 1 ? [{ t: '[' }, { t: String(m.dim), c: 'num' }, { t: ']' }] : [];
    decls.push({
      tokens: [tab, ...cppTypeTokens(m.type), { t: ` ${m.name}` }, ...arr, { t: ';' }],
      comment: sized || m.size > 0 ? `${hex(m.offset, pad)}(${hex(m.size, 4)})` : hex(m.offset, pad),
    });
  }
  out.push(...padComments(decls));
  out.push([{ t: '};' }]);
  if (sized && opts.asserts !== false) {
    out.push([]);
    out.push([{ t: 'static_assert', c: 'kw' }, { t: '(' }, { t: 'sizeof', c: 'kw' }, { t: `(${type.name}) == ` }, { t: hex(type.size), c: 'num' }, { t: `, "Wrong size on ${type.name}");` }]);
  }
  if (!sized && type.members.length) out.splice(0, 0, [{ t: '// Sizes are not in this dump, so no padding is generated.', c: 'cm' }]);
  return out;
}

export function enumToCpp(name, en) {
  const out = [];
  const head = [{ t: 'enum class', c: 'kw' }, { t: ' ' }, { t: name, c: 'k-enum' }];
  if (en.underlying) head.push({ t: ' : ' }, { t: en.underlying, c: 'k-basic' });
  out.push(head);
  out.push([{ t: '{' }]);
  for (const v of en.values) out.push([{ t: `\t${v.name} = ` }, { t: String(v.value), c: 'num' }, { t: ',' }]);
  out.push([{ t: '};' }]);
  return out;
}

export function offsetsToCpp(offsets) {
  const out = [];
  out.push([{ t: 'namespace', c: 'kw' }, { t: ' Offsets' }]);
  out.push([{ t: '{' }]);
  for (const o of offsets) {
    if (typeof o.value !== 'number') continue;
    out.push([{ t: '\t' }, { t: 'constexpr', c: 'kw' }, { t: ' ' }, { t: 'uint64_t', c: 'k-basic' }, { t: ` ${o.name.replace(/[^A-Za-z0-9_]/g, '_')} = ` }, { t: hex(o.value), c: 'num' }, { t: ';' }]);
  }
  out.push([{ t: '}' }]);
  return out;
}

export function functionsToCpp(owner, fns) {
  const out = [[{ t: `// ${owner}: ${fns.length} function${fns.length === 1 ? '' : 's'}`, c: 'cm' }]];
  for (const fn of fns) {
    const params = [];
    fn.params.forEach((p, i) => {
      if (i) params.push({ t: ', ' });
      params.push(...cppTypeTokens(p.type), { t: `${p.ref} ${p.name}` });
    });
    out.push([...cppTypeTokens(fn.ret), { t: ` ${fn.name}(` }, ...params, { t: ');' }, { t: '  ' }, { t: `// ${hex(fn.address)}${fn.flags.length ? ' ' + fn.flags.join('|') : ''}`, c: 'cm' }]);
  }
  return out;
}

// ---------------------------------------------------------------- Dumper-7

const ENGINE_BY_MAJOR = { 3: 'Unreal-Engine-3', 4: 'Unreal-Engine-4', 5: 'Unreal-Engine-5' };
const BACKUP_SUFFIX = /_(OLD|\d{9,})$/i;

/** Dumper-7 keeps the previous dump of a game as "<folder>_OLD" or "<folder>_<timestamp>". */
export function isDumperBackup(folder) {
  return BACKUP_SUFFIX.test(String(folder || ''));
}

/**
 * Dumper-7 names each output folder "<engine version>-<game name>",
 * for example "5.3.2-29314046+++UE5+Release-5.3-MyGame".
 * Returns { game, version, shortVersion, engine } or null when the name does not look like that.
 */
export function parseDumperFolder(folder) {
  if (!folder) return null;
  const clean = String(folder).replace(BACKUP_SUFFIX, '');
  const i = clean.lastIndexOf('-');
  if (i <= 0 || i === clean.length - 1) return null;
  const version = clean.slice(0, i);
  const game = clean.slice(i + 1).trim();
  if (!game || (!/^\d+\.\d+/.test(version) && !/\+UE\d\+|\+\+|Release-/i.test(version))) return null;
  const major = /^(\d+)\.\d+/.exec(version) || /\+UE(\d)\+/i.exec(version);
  const short = /^(\d+\.\d+(?:\.\d+)?)/.exec(version);
  return {
    game,
    version,
    shortVersion: short ? short[1] : null,
    engine: major ? ENGINE_BY_MAJOR[major[1]] || null : null,
  };
}

/**
 * Work out the engine from the dump itself, for dumps whose folder name says nothing.
 * Unreal Engine 5 stores FVector as doubles, Unreal Engine 4 as floats.
 */
export function detectEngine(files) {
  const classes = unwrapFile(files.ClassesInfo).data;
  const structs = unwrapFile(files.StructsInfo).data;
  const offsets = unwrapFile(files.OffsetsInfo).data;
  const offsetNames = new Set(offsets.map((o) => (Array.isArray(o) ? String(o[0]) : (entryOf(o) || [''])[0])));
  let unreal = offsetNames.has('OFFSET_GOBJECTS') || offsetNames.has('OFFSET_GNAMES');
  let unity = false;
  for (const item of classes) {
    const e = entryOf(item);
    if (!e) continue;
    if (e[0] === 'UObject') unreal = true;
    if (!unity && Array.isArray(e[1])) {
      const meta = e[1][0] && e[1][0].__InheritInfo;
      if (e[0] === 'MonoBehaviour' || (Array.isArray(meta) && meta.includes('MonoBehaviour'))) unity = true;
    }
    if (unreal) break;
  }
  if (!unreal) return unity ? 'Unity' : null;
  for (const item of structs) {
    const e = entryOf(item);
    if (!e || e[0] !== 'FVector' || !Array.isArray(e[1])) continue;
    for (const m of e[1]) {
      const me = entryOf(m);
      if (me && me[0] === 'X' && Array.isArray(me[1])) {
        const t = parseType(me[1][0]);
        if (t.name === 'double') return 'Unreal-Engine-5';
        if (t.name === 'float') return 'Unreal-Engine-4';
      }
    }
  }
  return 'Unreal-Engine';
}

// ---------------------------------------------------------------- misc

export function plural(n, one, many = one + 's') {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

export function relativeTime(ms, now = Date.now()) {
  if (!ms) return '';
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 31) return d === 1 ? 'yesterday' : `${d} days ago`;
  return new Date(ms).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function engineLabel(engine) {
  const map = {
    'Unreal-Engine-5': 'Unreal Engine 5',
    'Unreal-Engine-4': 'Unreal Engine 4',
    'Unreal-Engine-3': 'Unreal Engine 3',
    'Unreal-Engine': 'Unreal Engine',
    Unity: 'Unity',
  };
  return map[engine] || String(engine || 'Unknown engine').replace(/-/g, ' ');
}

export function engineShort(engine) {
  const map = { 'Unreal-Engine-5': 'UE5', 'Unreal-Engine-4': 'UE4', 'Unreal-Engine-3': 'UE3', 'Unreal-Engine': 'UE', Unity: 'Unity' };
  return map[engine] || String(engine || '?').slice(0, 6);
}
