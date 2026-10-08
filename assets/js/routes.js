// Hash routes, so the site works on GitHub Pages without server rewrites.
//   #/                                  home
//   #/g/<hash>                          game overview
//   #/g/<hash>/<tab>                    a tab (classes, structs, functions, enums, offsets)
//   #/g/<hash>/<tab>/<name>?m=<member>  one type, optionally with a member highlighted

export const TABS = ['overview', 'classes', 'structs', 'functions', 'enums', 'offsets'];

function decode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function parse(path) {
  const [p, query = ''] = String(path || '/').split('?');
  const parts = p.split('/').filter(Boolean);
  if (parts[0] !== 'g' || !parts[1]) return { page: 'home' };
  const tab = TABS.includes(parts[2]) ? parts[2] : 'overview';
  const params = new URLSearchParams(query);
  return {
    page: 'game',
    hash: decode(parts[1]),
    tab,
    name: parts[3] != null ? decode(parts.slice(3).join('/')) : null,
    member: params.get('m'),
  };
}

export function build({ hash, tab, name, member } = {}) {
  if (!hash) return '/';
  let path = `/g/${encodeURIComponent(hash)}`;
  if (tab && tab !== 'overview') path += `/${tab}`;
  if (tab && tab !== 'overview' && name != null) path += `/${encodeURIComponent(name)}`;
  if (member) path += `?m=${encodeURIComponent(member)}`;
  return path;
}

export function href(route) {
  return '#' + build(route);
}
