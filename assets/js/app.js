// Entry point: routing, shared preferences, keyboard shortcuts and drag and drop.
import { h, store, toast } from './dom.js';
import { loadGameList, gameInfo, addLocalGames } from './data.js';
import { parse, build } from './routes.js';
import { GameShell } from './game.js';
import { renderHome } from './home.js';
import { SearchDialog } from './search.js';

const root = document.getElementById('app');
let current = location.hash.slice(1) || '/';
let shell = null;

const ctx = {
  prefs: {
    base: store.get('oa.base', 'hex') === 'dec' ? 'dec' : 'hex',
    inherited: store.get('oa.inherited', false) === true,
    code: store.get('oa.code', false) === true,
    mapScale: ['whole', 'own'].includes(store.get('oa.mapScale', 'auto')) ? store.get('oa.mapScale', 'auto') : 'auto',
  },
  setPref(key, value) {
    this.prefs[key] = value;
    store.set(`oa.${key}`, value);
  },
  navigate,
  refresh() {
    if (shell) shell.refresh();
  },
  openLocal,
};
ctx.search = new SearchDialog(ctx);

function navigate(path) {
  current = path || '/';
  try {
    if (location.hash.slice(1) !== current) location.hash = current;
  } catch {
    /* sandboxed frames may refuse; rendering below still works */
  }
  render();
}

window.addEventListener('hashchange', () => {
  const path = location.hash.slice(1) || '/';
  if (path === current) return;
  current = path;
  render();
});

// Handle in-app links ourselves so navigation also works where the URL cannot change.
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest && e.target.closest('a[href^="#/"]');
  if (!a) return;
  e.preventDefault();
  navigate(a.getAttribute('href').slice(1));
});

let renderId = 0;
async function render() {
  const id = ++renderId;
  const route = parse(current);
  if (ctx.search.isOpen) ctx.search.close();
  if (route.page === 'home') {
    shell = null;
    document.body.dataset.page = 'home';
    await renderHome(root, ctx);
    return;
  }
  document.body.dataset.page = 'game';
  await loadGameList();
  if (id !== renderId) return;
  const info = gameInfo(route.hash);
  if (!info) {
    shell = null;
    root.replaceChildren(h('div', { class: 'home' }, h('main', { class: 'home-main' }, h('div', { class: 'empty' },
      h('p', { class: 'empty-title' }, route.hash.startsWith('local-') ? 'Local dumps are kept only while the page is open.' : 'This game is not in the game list.'),
      h('p', { class: 'muted' }, route.hash.startsWith('local-') ? 'Open the dump files again to view them.' : `No entry with the hash ${route.hash} was found in GameList.json.`),
      h('p', null, h('a', { href: '#/' }, 'Back to all games'))))));
    document.body.dataset.page = 'home';
    return;
  }
  if (!shell || shell.hash !== route.hash) shell = new GameShell(root, info, ctx);
  await shell.show(route);
}

function openLocal(files) {
  const added = addLocalGames(files);
  if (!added.length) {
    toast('No dump files found. Choose a Dumper-7 output folder, its Dumpspace folder, or the files ClassesInfo, StructsInfo, FunctionsInfo, EnumsInfo and OffsetsInfo (.json or .json.gz).');
    return;
  }
  if (added.length === 1) {
    navigate(build({ hash: added[0].hash }));
    return;
  }
  toast(`Opened ${added.length} dumps: ${added.map((g) => g.name).join(', ')}`);
  if (parse(current).page === 'home') render();
  else navigate('/');
}

// "/" or Ctrl+K opens search on a game page.
document.addEventListener('keydown', (e) => {
  const typing = e.target && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
  const wantsSearch = (e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k');
  if (wantsSearch && shell && shell.model && !ctx.search.isOpen) {
    e.preventDefault();
    shell.openSearch();
  }
});

// Drop dump files or a dump folder anywhere on the page.
const dropHint = h('div', { class: 'drop-hint', hidden: true, 'aria-hidden': 'true' }, h('p', null, 'Drop the dump files to open them'));
document.body.append(dropHint);
let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  dropHint.hidden = false;
});
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropHint.hidden = true;
});
window.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
window.addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropHint.hidden = true;
  openLocal(await filesFromDrop(e.dataTransfer));
});

async function filesFromDrop(dt) {
  const entries = [...(dt.items || [])].map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
  if (!entries.length) return [...(dt.files || [])];
  const out = [];
  const walk = async (entry, path) => {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      try {
        Object.defineProperty(file, 'webkitRelativePath', { value: path + file.name });
      } catch {
        /* read-only in some browsers */
      }
      out.push(file);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const child of batch) await walk(child, `${path}${entry.name}/`);
      }
    }
  };
  for (const entry of entries) await walk(entry, '');
  return out;
}

render();
