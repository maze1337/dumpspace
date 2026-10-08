#!/usr/bin/env node
// Add, update, list and remove games. Needs Node 18 or newer, no packages.
//
//   node tools/games.mjs add <folder> [--engine Unreal-Engine-5] [--name "My Game"] [--uploader "Me"] [--link URL] [--keep-json]
//   node tools/games.mjs list
//   node tools/games.mjs remove <hash or name>
//
// <folder> can be:
//   - a game folder from Dumper-7, for example C:\Dumper-7\5.3.2-29314046+++UE5+Release-5.3-MyGame
//   - the whole Dumper-7 folder (C:\Dumper-7), which adds every game in it and skips the _OLD backups
//   - any folder with ClassesInfo, StructsInfo, FunctionsInfo, EnumsInfo and OffsetsInfo (.json or .json.gz)
// The game name, engine (UE4 or UE5) and engine version come from Dumper-7's folder name. When the
// folder name says nothing, the engine is read from the dump itself. --name and --engine override both.
// Adding a game with the same engine and name again updates it in place and keeps its hash.

import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDumperFolder, isDumperBackup, detectEngine } from '../assets/js/format.js';

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
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const lower = name.toLowerCase();
  const hit = entries.find((e) => e.toLowerCase() === `${lower}.json`) || entries.find((e) => e.toLowerCase() === `${lower}.json.gz`);
  return hit ? path.join(dir, hit) : null;
}

async function hasDump(dir) {
  for (const f of FILES) if (await findDumpFile(dir, f)) return true;
  return false;
}

/** Folders with dump files: the folder itself, its Dumpspace folder, or every game folder inside it. */
async function discover(dir) {
  if (await hasDump(dir)) return [dir];
  if (await hasDump(path.join(dir, 'Dumpspace'))) return [path.join(dir, 'Dumpspace')];
  let children = [];
  try {
    children = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const child of children.filter((c) => c.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    if (isDumperBackup(child.name)) continue;
    const sub = path.join(dir, child.name);
    if (await hasDump(path.join(sub, 'Dumpspace'))) found.push(path.join(sub, 'Dumpspace'));
    else if (await hasDump(sub)) found.push(sub);
  }
  return found;
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

async function addOne(dumpDir, args, single) {
  const gameFolder = path.basename(dumpDir).toLowerCase() === 'dumpspace' ? path.dirname(dumpDir) : dumpDir;
  const parsed = parseDumperFolder(path.basename(gameFolder));

  const files = {};
  for (const f of FILES) {
    const src = await findDumpFile(dumpDir, f);
    files[f] = src ? await loadJson(src) : null;
  }

  const name = (single && typeof args.name === 'string' && args.name.trim()) || (parsed && parsed.game) || path.basename(gameFolder);
  let engine = typeof args.engine === 'string' ? args.engine : (parsed && parsed.engine) || detectEngine(files);
  if (!engine) fail(`Could not tell which engine ${name} uses. Pass --engine with one of: ${ENGINES.join(', ')}`);
  if (/[\\/]|\.\./.test(engine)) fail('--engine cannot contain slashes or "..".');
  if (engine === 'Unreal-Engine') console.warn(`Note: could not tell UE4 from UE5 for ${name}. Pass --engine to choose.`);
  else if (!ENGINES.includes(engine)) console.warn(`Note: "${engine}" is not one of ${ENGINES.join(', ')}. It will still work.`);

  const location = single && typeof args.location === 'string' ? slug(args.location) : slug(name);
  const out = path.join(GAMES, engine, location);
  if (!inside(GAMES, out)) fail('The game folder would end up outside games/.');

  await mkdir(out, { recursive: true });
  console.log(`Adding ${name} (${engine}${parsed && parsed.shortVersion ? ` ${parsed.shortVersion}` : ''}) to games/${engine}/${location}/`);
  const counts = {};
  for (const f of FILES) {
    let json = files[f];
    if (json == null) {
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
  const version = parsed && (parsed.shortVersion || parsed.version);
  if (version) entry.engineVersion = version;
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

async function add(args) {
  const dirArg = args._[1];
  if (!dirArg) fail('Pass a folder: node tools/games.mjs add "C:\\Dumper-7\\<version>-<game>"');
  const dir = path.resolve(dirArg);
  const dumps = await discover(dir);
  if (!dumps.length) {
    fail(`No dump files found in ${dir}. Point at a Dumper-7 game folder, its Dumpspace folder, or the whole Dumper-7 folder.`);
  }
  if (dumps.length > 1 && (typeof args.name === 'string' || typeof args.location === 'string')) {
    fail(`Found ${dumps.length} games in ${dir}. --name and --location only work when adding one game.`);
  }
  if (dumps.length > 1) console.log(`Found ${dumps.length} games in ${dir}.\n`);
  for (const d of dumps) {
    await addOne(d, args, dumps.length === 1);
    if (dumps.length > 1) console.log('');
  }
}

async function listGames() {
  const list = await readList();
  if (!list.games.length) {
    console.log('No games yet. Add one with: node tools/games.mjs add <Dumper-7 game folder>');
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
  node tools/games.mjs add <folder> [--engine Unreal-Engine-5] [--name "My Game"] [--uploader "Me"] [--link URL] [--keep-json]
  node tools/games.mjs list
  node tools/games.mjs remove <hash or name>

Engines: ${ENGINES.join(', ')}`);
  if (command) process.exit(1);
}
