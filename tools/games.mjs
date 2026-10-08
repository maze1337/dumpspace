#!/usr/bin/env node
// Add, update, list and remove games. Needs Node 18 or newer, no packages.
//
//   node tools/games.mjs add <dump-folder> --engine Unreal-Engine-5 [--name "My Game"] [--uploader "Me"] [--link URL] [--keep-json]
//   node tools/games.mjs list
//   node tools/games.mjs remove <hash or name>
//
// <dump-folder> is the folder with ClassesInfo, StructsInfo, FunctionsInfo, EnumsInfo and
// OffsetsInfo (.json or .json.gz), for example the "Dumpspace" folder Dumper-7 writes, or its parent.
// Adding a game with the same engine and name again updates it in place and keeps its hash.

import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAMES = path.join(ROOT, 'games');
const LIST = path.join(GAMES, 'GameList.json');
const FILES = ['ClassesInfo', 'StructsInfo', 'FunctionsInfo', 'EnumsInfo', 'OffsetsInfo'];
const ENGINES = ['Unreal-Engine-5', 'Unreal-Engine-4', 'Unreal-Engine-3', 'Unity'];

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else {
        args[key] = next;
        i++;
      }
    } else args._.push(a);
  }
  return args;
}

async function readList() {
  try {
    const json = JSON.parse(await readFile(LIST, 'utf8'));
    return { games: Array.isArray(json.games) ? json.games : [] };
  } catch (e) {
    if (e.code === 'ENOENT') return { games: [] };
    fail(`${LIST} is not valid JSON: ${e.message}`);
  }
}

async function writeList(list) {
  await mkdir(GAMES, { recursive: true });
  await writeFile(LIST, `${JSON.stringify(list, null, 2)}\n`);
}

function slug(name) {
  return name.trim().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}._-]+/gu, '') || 'Game';
}

function hashFor(engine, location) {
  return createHash('sha1').update(`${engine}/${location}`).digest('hex').slice(0, 8);
}

async function findDumpFile(dir, name) {
  for (const d of [dir, path.join(dir, 'Dumpspace')]) {
    let entries;
    try {
      entries = await readdir(d);
    } catch {
      continue;
    }
    const lower = name.toLowerCase();
    const hit = entries.find((e) => e.toLowerCase() === `${lower}.json`) || entries.find((e) => e.toLowerCase() === `${lower}.json.gz`);
    if (hit) return path.join(d, hit);
  }
  return null;
}

async function loadJson(file) {
  let buf = await readFile(file);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    return JSON.parse(text);
  } catch (e) {
    fail(`${file} is not valid JSON: ${e.message}`);
  }
}

function entries(json) {
  if (Array.isArray(json)) return json;
  return json && Array.isArray(json.data) ? json.data : [];
}

function kb(n) {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function inside(parent, child) {
  const rel = path.relative(parent, child);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

async function add(args) {
  const dirArg = args._[1];
  if (!dirArg) fail('Pass the dump folder: node tools/games.mjs add <dump-folder> --engine Unreal-Engine-5');
  const dir = path.resolve(dirArg);
  const engine = typeof args.engine === 'string' ? args.engine : '';
  if (!engine) fail(`Pass --engine with one of: ${ENGINES.join(', ')}`);
  if (!ENGINES.includes(engine)) console.warn(`Note: "${engine}" is not one of ${ENGINES.join(', ')}. It will still work.`);
  if (/[\\/]|\.\./.test(engine)) fail('--engine cannot contain slashes or "..".');

  let name = typeof args.name === 'string' ? args.name.trim() : '';
  if (!name) {
    const base = path.basename(dir);
    name = base.toLowerCase() === 'dumpspace' ? path.basename(path.dirname(dir)) : base;
  }
  const location = typeof args.location === 'string' ? slug(args.location) : slug(name);
  const out = path.join(GAMES, engine, location);
  if (!inside(GAMES, out)) fail('The game folder would end up outside games/.');

  const found = {};
  for (const f of FILES) found[f] = await findDumpFile(dir, f);
  if (!Object.values(found).some(Boolean)) fail(`No dump files in ${dir}. Expected ${FILES.map((f) => `${f}.json`).join(', ')}.`);

  await mkdir(out, { recursive: true });
  console.log(`Adding ${name} to games/${engine}/${location}/`);
  const counts = {};
  for (const f of FILES) {
    let json;
    if (found[f]) json = await loadJson(found[f]);
    else {
      console.warn(`  ${f}: not found, writing an empty file`);
      json = { data: [], updated_at: String(Date.now()), version: 10202 };
    }
    const text = JSON.stringify(json);
    const gz = gzipSync(Buffer.from(text), { level: 9 });
    await writeFile(path.join(out, `${f}.json.gz`), gz);
    if (args['keep-json']) await writeFile(path.join(out, `${f}.json`), text);
    else await rm(path.join(out, `${f}.json`), { force: true });
    counts[f] = entries(json).length;
    console.log(`  ${f.padEnd(14)} ${String(counts[f]).padStart(7)} entries  ${kb(text.length).padStart(8)} -> ${kb(gz.length)} gzipped`);
  }

  const list = await readList();
  const hash = hashFor(engine, location);
  const entry = {
    hash,
    name,
    engine,
    location,
    uploaded: Date.now(),
    uploader: { name: typeof args.uploader === 'string' ? args.uploader : '', link: typeof args.link === 'string' ? args.link : '' },
    counts: {
      classes: counts.ClassesInfo, structs: counts.StructsInfo, functions: counts.FunctionsInfo,
      enums: counts.EnumsInfo, offsets: counts.OffsetsInfo,
    },
  };
  if (args.sample) entry.sample = true;
  const i = list.games.findIndex((g) => g.hash === hash);
  if (i >= 0) {
    list.games[i] = entry;
    console.log(`Updated ${name} (hash ${hash}).`);
  } else {
    list.games.push(entry);
    console.log(`Added ${name} (hash ${hash}).`);
  }
  await writeList(list);
  console.log(`Open it at index.html#/g/${hash}`);
}

async function listGames() {
  const list = await readList();
  if (!list.games.length) {
    console.log('No games yet. Add one with: node tools/games.mjs add <dump-folder> --engine Unreal-Engine-5');
    return;
  }
  for (const g of list.games) console.log(`${g.hash}  ${String(g.engine).padEnd(16)} ${g.name}${g.sample ? '  (sample)' : ''}`);
}

async function remove(args) {
  const key = args._.slice(1).join(' ').trim();
  if (!key) fail('Pass the hash or name of the game to remove.');
  const list = await readList();
  const game = list.games.find((g) => g.hash === key) || list.games.find((g) => String(g.name).toLowerCase() === key.toLowerCase());
  if (!game) fail(`No game with the hash or name "${key}". Run "node tools/games.mjs list" to see them.`);
  const dir = path.join(GAMES, String(game.engine), String(game.location));
  if (game.engine && game.location && inside(GAMES, dir) && path.dirname(dir) !== GAMES) {
    await rm(dir, { recursive: true, force: true });
    try {
      const left = await readdir(path.dirname(dir));
      if (!left.length) await rm(path.dirname(dir), { recursive: true, force: true });
    } catch {
      /* engine folder already gone */
    }
  }
  list.games = list.games.filter((g) => g !== game);
  await writeList(list);
  console.log(`Removed ${game.name} (${game.hash}).`);
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];
if (command === 'add') await add(args);
else if (command === 'list') await listGames();
else if (command === 'remove') await remove(args);
else {
  console.log(`Usage:
  node tools/games.mjs add <dump-folder> --engine Unreal-Engine-5 [--name "My Game"] [--uploader "Me"] [--link URL] [--keep-json]
  node tools/games.mjs list
  node tools/games.mjs remove <hash or name>

Engines: ${ENGINES.join(', ')}`);
  if (command) process.exit(1);
}
