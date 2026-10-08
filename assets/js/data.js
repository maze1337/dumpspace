// Loading games: the game list, the five dump files per game, and lookups on top of them.
import { CONFIG } from './config.js';
import {
  unwrapFile, entryOf, readTypeMeta, parseTypeMembers, parseEnum, parseFunctions, toNum,
} from './format.js';

export const FILES = ['ClassesInfo', 'StructsInfo', 'FunctionsInfo', 'EnumsInfo', 'OffsetsInfo'];
export const TYPE_TABS = ['classes', 'structs', 'functions', 'enums'];

const games = new Map(); // hash -> info
const models = new Map(); // hash -> Promise<model>
const localSources = new Map(); // hash -> { FileKey: File }
let listPromise = null;
let localCount = 0;

// ---------------------------------------------------------------- game list

function normalizeInfo(g, extra = {}) {
  return {
    hash: String(g.hash),
    name: String(g.name || g.location || g.hash),
    engine: String(g.engine || ''),
    location: String(g.location || ''),
    uploaded: toNum(g.uploaded),
    uploader: g.uploader && typeof g.uploader === 'object'
      ? { name: String(g.uploader.name || ''), link: String(g.uploader.link || '') }
      : null,
    counts: g.counts && typeof g.counts === 'object' ? g.counts : null,
    sample: !!g.sample,
    local: false,
    ...extra,
  };
}

/** Load GameList.json once. Resolves to { games, error }. */
export function loadGameList() {
  if (!listPromise) {
    listPromise = (async () => {
      let error = null;
      try {
        const res = await fetch(CONFIG.gameList, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`${CONFIG.gameList} returned ${res.status}`);
        const json = await res.json();
        const list = Array.isArray(json) ? json : Array.isArray(json.games) ? json.games : [];
        for (const g of list) if (g && g.hash != null) games.set(String(g.hash), normalizeInfo(g));
      } catch (e) {
        error = e;
      }
      return { error };
    })();
  }
  return listPromise.then(({ error }) => ({ games: allGames(), error }));
}

export function allGames() {
  return [...games.values()];
}

export function gameInfo(hash) {
  return games.get(hash) || null;
}

// ---------------------------------------------------------------- reading files

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export async function decodeBytes(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This browser cannot unpack .gz files. Use a current Chrome, Edge, Firefox or Safari.');
    }
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
    return stripBom(await new Response(stream).text());
  }
  return stripBom(new TextDecoder().decode(u8));
}

function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

export function gameBaseUrl(info) {
  return `${CONFIG.dataRoot}${encodePath(info.engine)}/${encodePath(info.location)}/`;
}

/** Fetch Name.json.gz, falling back to Name.json. Returns null when neither exists. */
async function fetchDumpFile(base, name) {
  let lastError = null;
  for (const ext of ['.json.gz', '.json']) {
    const url = base + name + ext;
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      lastError = e;
      continue;
    }
    if (!res.ok) continue;
    const text = await decodeBytes(await res.arrayBuffer());
    // Some hosts answer a missing file with an HTML page; treat that as missing.
    if (text.trimStart().startsWith('<')) continue;
    try {
      return JSON.parse(text);
    } catch (e) {
      lastError = new Error(`${name}${ext} is not valid JSON: ${e.message}`);
    }
  }
  if (lastError) throw lastError;
  return null;
}

async function readLocalFile(file) {
  const text = await decodeBytes(await file.arrayBuffer());
  return JSON.parse(text);
}

// ---------------------------------------------------------------- model

function byName(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
}

function uniqueKey(map, name) {
  if (!map.has(name)) return name;
  let i = 2;
  while (map.has(`${name} (${i})`)) i++;
  return `${name} (${i})`;
}

export function buildModel(info, files) {
  const model = {
    info,
    version: 0,
    updatedAt: 0,
    credit: null,
    classes: new Map(),
    structs: new Map(),
    enums: new Map(),
    functions: new Map(),
    names: { classes: [], structs: [], enums: [], functions: [] },
    offsets: [],
    missing: FILES.filter((f) => files[f] == null),
    parsed: new Map(),
    childIndex: null,
    search: null,
  };

  const note = (f) => {
    if (f.version > model.version) model.version = f.version;
    if (f.updatedAt > model.updatedAt) model.updatedAt = f.updatedAt;
    if (f.credit) model.credit = f.credit;
  };

  for (const [fileKey, mapKey] of [['ClassesInfo', 'classes'], ['StructsInfo', 'structs']]) {
    const f = unwrapFile(files[fileKey]);
    note(f);
    const map = model[mapKey];
    for (const item of f.data) {
      const e = entryOf(item);
      if (!e) continue;
      const meta = readTypeMeta(e[1]);
      map.set(uniqueKey(map, e[0]), { name: e[0], raw: Array.isArray(e[1]) ? e[1] : [], size: meta.size, parents: meta.parents, count: meta.count, version: f.version });
    }
  }

  {
    const f = unwrapFile(files.EnumsInfo);
    note(f);
    for (const item of f.data) {
      const e = entryOf(item);
      if (!e) continue;
      const count = Array.isArray(e[1]) && Array.isArray(e[1][0]) ? e[1][0].length : 0;
      model.enums.set(uniqueKey(model.enums, e[0]), { name: e[0], raw: e[1], count });
    }
  }

  {
    const f = unwrapFile(files.FunctionsInfo);
    note(f);
    for (const item of f.data) {
      const e = entryOf(item);
      if (!e || !Array.isArray(e[1])) continue;
      const existing = model.functions.get(e[0]);
      if (existing) {
        existing.raw = existing.raw.concat(e[1]);
        existing.count = existing.raw.length;
      } else {
        model.functions.set(e[0], { name: e[0], raw: e[1], count: e[1].length });
      }
    }
  }

  {
    const f = unwrapFile(files.OffsetsInfo);
    note(f);
    for (const row of f.data) {
      if (Array.isArray(row) && row.length >= 2) model.offsets.push({ name: String(row[0]), value: typeof row[1] === 'number' ? row[1] : toNum(row[1]) });
      else {
        const e = entryOf(row);
        if (e) model.offsets.push({ name: e[0], value: toNum(e[1]) });
      }
    }
  }

  for (const k of TYPE_TABS) model.names[k] = [...model[k].keys()].sort(byName);
  return model;
}

/** Load (and cache) the model for a game. onProgress receives { step, total, file }. */
export function loadGame(hash, onProgress = () => {}) {
  if (models.has(hash)) return models.get(hash);
  const p = (async () => {
    const info = games.get(hash);
    if (!info) throw new Error('not-found');
    const files = {};
    let step = 0;
    if (info.local) {
      const src = localSources.get(hash) || {};
      for (const name of FILES) {
        onProgress({ step: ++step, total: FILES.length, file: name });
        files[name] = src[name] ? await readLocalFile(src[name]) : null;
      }
    } else {
      const base = gameBaseUrl(info);
      for (const name of FILES) {
        onProgress({ step: ++step, total: FILES.length, file: name });
        files[name] = await fetchDumpFile(base, name);
      }
    }
    if (FILES.every((f) => files[f] == null)) {
      throw new Error(info.local ? 'None of the selected files could be read.' : `No dump files were found in ${gameBaseUrl(info)}`);
    }
    return buildModel(info, files);
  })();
  models.set(hash, p);
  p.catch(() => models.delete(hash));
  return p;
}

// ---------------------------------------------------------------- local dumps

const FILE_RE = /^(ClassesInfo|StructsInfo|FunctionsInfo|EnumsInfo|OffsetsInfo)\.json(\.gz)?$/i;

/** Register dump files picked or dropped by the user. Returns the new game info, or null. */
export function addLocalGame(fileList) {
  const picked = {};
  let label = '';
  for (const file of fileList) {
    const m = FILE_RE.exec(file.name);
    if (!m) continue;
    const key = FILES.find((k) => k.toLowerCase() === m[1].toLowerCase());
    if (!picked[key] || !m[2]) picked[key] = file;
    if (!label && file.webkitRelativePath) {
      const parts = file.webkitRelativePath.split('/');
      const dir = parts[parts.length - 2];
      label = dir && dir.toLowerCase() === 'dumpspace' && parts.length > 2 ? parts[parts.length - 3] : dir || '';
    }
  }
  if (!Object.keys(picked).length) return null;
  localCount += 1;
  const hash = `local-${localCount}`;
  const info = normalizeInfo(
    { hash, name: label || `Local dump ${localCount}`, engine: 'Local', location: '', uploaded: Date.now() },
    { local: true, fileCount: Object.keys(picked).length },
  );
  games.set(hash, info);
  localSources.set(hash, picked);
  return info;
}

// ---------------------------------------------------------------- lookups

/** Parsed class or struct: { name, kind, size, parents, members }. kind is 'classes' or 'structs'. */
export function getType(model, kind, key) {
  const cacheKey = `${kind}:${key}`;
  if (model.parsed.has(cacheKey)) return model.parsed.get(cacheKey);
  const entry = model[kind] && model[kind].get(key);
  if (!entry) return null;
  const t = {
    key,
    name: entry.name,
    kind,
    size: entry.size,
    parents: entry.parents,
    members: parseTypeMembers(entry.raw, entry.version || model.version),
  };
  model.parsed.set(cacheKey, t);
  return t;
}

/** Find where a referenced type is defined. Returns { kind, key } or null. */
export function resolveType(model, name, kindLetter = 'C') {
  const order = kindLetter === 'E' ? ['enums'] : kindLetter === 'S' ? ['structs', 'classes'] : ['classes', 'structs', 'enums'];
  for (const k of order) if (model[k].has(name)) return { kind: k, key: name };
  return null;
}

/** The type a class/struct inherits from directly, if it is in the dump. */
export function parentOf(model, type) {
  if (!type || !type.parents.length) return null;
  const ref = resolveType(model, type.parents[0], type.kind === 'structs' ? 'S' : 'C');
  return ref && ref.kind !== 'enums' ? getType(model, ref.kind, ref.key) : null;
}

export function childrenOf(model, kind, name) {
  if (!model.childIndex) {
    const idx = new Map();
    for (const k of ['classes', 'structs']) {
      for (const [key, entry] of model[k]) {
        const p = entry.parents[0];
        if (!p) continue;
        const id = `${k}:${p}`;
        if (!idx.has(id)) idx.set(id, []);
        idx.get(id).push(key);
      }
    }
    for (const list of idx.values()) list.sort(byName);
    model.childIndex = idx;
  }
  return model.childIndex.get(`${kind}:${name}`) || [];
}

export function getEnum(model, key) {
  const entry = model.enums.get(key);
  return entry ? { key, name: entry.name, ...parseEnum(entry.raw) } : null;
}

export function getFunctions(model, owner) {
  const entry = model.functions.get(owner);
  return entry ? parseFunctions(entry.raw) : [];
}

// ---------------------------------------------------------------- search

export function getSearchIndex(model) {
  if (model.search) return model.search;
  const keys = [];
  const items = [];
  const add = (key, item) => {
    keys.push(key.toLowerCase());
    items.push(item);
  };
  for (const k of ['classes', 'structs', 'enums']) for (const key of model[k].keys()) add(key, { k, name: key });
  for (const [owner, f] of model.functions) {
    for (const obj of f.raw) {
      const e = entryOf(obj);
      if (e) add(e[0], { k: 'function', owner, name: e[0] });
    }
  }
  for (const kind of ['classes', 'structs']) {
    for (const [owner, t] of model[kind]) {
      for (const obj of t.raw) {
        for (const key in obj) {
          if (key.startsWith('__')) continue;
          add(key, { k: 'member', kind, owner, name: key.replace(/\s*:\s*\d+$/, '') });
        }
      }
    }
  }
  for (const [owner, en] of model.enums) {
    const values = Array.isArray(en.raw) && Array.isArray(en.raw[0]) ? en.raw[0] : [];
    for (const obj of values) for (const key in obj) add(key, { k: 'value', owner, name: key, value: toNum(obj[key]) });
  }
  model.search = { keys, items };
  return model.search;
}

const GROUP = { classes: 0, structs: 0, enums: 0, function: 1, member: 2, value: 3 };

/**
 * Search everything. "Owner::name" narrows to one type.
 * Single-character queries only match type names, to keep results useful.
 */
export function runSearch(index, query, limit = 60) {
  let q = query.trim().toLowerCase();
  if (!q) return { results: [], total: 0 };
  let ownerQ = null;
  const sep = q.indexOf('::');
  if (sep >= 0) {
    ownerQ = q.slice(0, sep);
    q = q.slice(sep + 2);
  }
  const typesOnly = ownerQ === null && q.length < 2;
  const scored = [];
  const { keys, items } = index;
  for (let i = 0; i < keys.length; i++) {
    const it = items[i];
    const group = GROUP[it.k];
    if (typesOnly && group !== 0) continue;
    const pos = q ? keys[i].indexOf(q) : 0;
    if (pos < 0) continue;
    if (ownerQ !== null && (!it.owner || !it.owner.toLowerCase().includes(ownerQ))) continue;
    const exact = keys[i] === q ? 0 : pos === 0 ? 1 : 2;
    scored.push(exact * 10 + group + Math.min(keys[i].length, 999) / 1000, i);
  }
  const total = scored.length / 2;
  const order = [];
  for (let j = 0; j < scored.length; j += 2) order.push(j);
  order.sort((a, b) => scored[a] - scored[b]);
  const results = order.slice(0, limit).map((j) => items[scored[j + 1]]);
  return { results, total };
}
