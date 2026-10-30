import { Graph, overlap, splicePoints, joinPoints, MIN_WORD_LEN } from './solver.js';
import { THEMES, THEME_ORDER, DEFAULT_THEME } from './themes.js';
import { load, save } from './storage.js';

// ---------- config ----------
const EPOCH = { y: 2026, m: 10, d: 25 }; // Daily #1 (local date). Month is 1-based.
const MAX_WORD_LEN = 15;
const SHOW_SPLICES = 4;

// ---------- state ----------
const S = {
  accepted: null, graph: null, puzzles: null,
  settings: { theme: DEFAULT_THEME, hard: false, seenHelp: false, ...load('settings', {}) },
  games: load('games', {}),
  practice: load('practice', { current: null }),
  game: null, typed: '', cache: new Map(),
};

const $ = id => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) n.append(c);
  return n;
};
const up = w => w.toUpperCase();
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---------- dates & puzzle numbers ----------
const dayIndex = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);
function todayNumber() {
  const now = new Date();
  return dayIndex(now.getFullYear(), now.getMonth() + 1, now.getDate()) - dayIndex(EPOCH.y, EPOCH.m, EPOCH.d) + 1;
}
function dateOf(n) {
  return new Date(Date.UTC(EPOCH.y, EPOCH.m - 1, EPOCH.d + n - 1));
}
const fmtDate = (n, opts = { weekday: 'short', month: 'short', day: 'numeric' }) =>
  dateOf(n).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });

function puzzleRow(kind, i) {
  const list = kind === 'practice' ? S.puzzles.practice : S.puzzles.daily;
  const idx = kind === 'practice' ? i : (i - 1);
  const [start, target, par, hardPar, solution, hardSolution] = list[((idx % list.length) + list.length) % list.length];
  return { start, target, par, hardPar, solution: solution.split(' '), hardSolution: hardSolution.split(' ') };
}

// ---------- game model ----------
// A game is built from both ends:
//   chain    = [start, ...words added going down]      overlaps[i] = overlap INTO chain[i] (overlaps[0] = 0)
//   tail     = [...words added going up, target]       tailK[i]    = overlap from tail[i] into tail[i+1]
//   history  = 'f' / 'b' per added word, for Undo
// It is solved when the last word of `chain` splices into the first word of `tail` (joinK).
const topLast = g => g.chain[g.chain.length - 1];
const bottomFirst = g => g.tail[0];
const addedCount = g => g.chain.length - 1 + g.tail.length - 1;
const movesOf = g => (g.status === 'solved' ? g.chain.length + g.tail.length - 1 : addedCount(g));
const usedWords = g => new Set([...g.chain, ...g.tail]);
function fullChain(g) {
  return { words: g.chain.concat(g.tail), ks: g.overlaps.slice(1).concat([g.joinK], g.tailK) };
}

function migrate(g) {
  if (!g.tail) { // games saved before two-way play: chain ended with the target when solved
    g.tail = [g.target]; g.tailK = [];
    if (g.status === 'solved' && g.chain.length > 1 && topLast(g) === g.target) {
      g.chain.pop(); g.joinK = g.overlaps.pop();
    }
    g.history = Array(g.chain.length - 1).fill('f');
  }
  if (!g.dir) g.dir = 'f';
  return g;
}
for (const g of Object.values(S.games)) migrate(g);

function applyMode(g) {
  const row = puzzleRow(g.kind, g.num);
  g.minK = S.settings.hard ? 3 : 2;
  g.par = S.settings.hard ? row.hardPar : row.par;
  g.solution = S.settings.hard ? row.hardSolution : row.solution;
}
function getGame(kind, num, onDay = false) {
  const key = (kind === 'practice' ? 'p' : 'd') + num;
  let g = S.games[key];
  if (!g) {
    const row = puzzleRow(kind, num);
    g = { key, kind, num, start: row.start, target: row.target,
          chain: [row.start], overlaps: [0], tail: [row.target], tailK: [], history: [], dir: 'f',
          hints: 0, status: 'playing', onDay };
    applyMode(g);
    S.games[key] = g;
  }
  if (g.status === 'playing' && addedCount(g) === 0) { applyMode(g); if (onDay) g.onDay = true; }
  return g;
}
const persist = () => save('games', S.games);

function openGame(g) {
  S.game = g; S.typed = '';
  render();
}
function openToday() { openGame(getGame('daily', todayNumber(), true)); }
function openArchive(n) { openGame(getGame('daily', n, n === todayNumber())); }
function openPractice(next = false) {
  const n = S.puzzles.practice.length;
  let cur = S.practice.current;
  const curGame = cur != null && S.games['p' + cur];
  if (cur == null || next || (curGame && curGame.status !== 'playing')) {
    const open = [];
    for (let i = 0; i < n; i++) if (!S.games['p' + i] || S.games['p' + i].status === 'playing') open.push(i);
    const pool = open.filter(i => i !== cur);
    cur = pool.length ? pool[Math.floor(Math.random() * pool.length)] : Math.floor(Math.random() * n);
    S.practice.current = cur; save('practice', S.practice);
  }
  openGame(getGame('practice', cur));
}

// ---------- theme ----------
const VAR = { bg: '--bg', panel: '--panel', tile: '--tile', tileShadow: '--tile-shadow', text: '--text', muted: '--muted',
  shared: '--shared', sharedText: '--shared-text', sharedShadow: '--shared-shadow', key: '--key', keyAlt: '--key-alt',
  pipOn: '--pip-on', pipOff: '--pip-off', empty: '--empty', tileBorder: '--tile-border' };
function applyTheme(name) {
  const t = THEMES[name] || THEMES[DEFAULT_THEME];
  for (const [k, v] of Object.entries(VAR)) document.documentElement.style.setProperty(v, t[k]);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', t.bg);
}

// ---------- rendering ----------
function tileSize(len) {
  const w = $('chain-wrap').clientWidth - 34 || 320;
  return Math.max(16, Math.min(46, Math.floor((w - 5 * (len - 1)) / len)));
}
function tileRow(word, sharedStart, sharedEnd, { gutter = '', extra = [], cls = '', label } = {}) {
  const n = word.length + extra.length;
  const tiles = el('div', { class: 'tiles', 'aria-hidden': 'true' });
  [...word].forEach((ch, i) => {
    const shared = i < sharedStart || i >= word.length - sharedEnd;
    tiles.append(el('div', { class: 'tile' + (shared ? ' shared' : ''), text: ch }));
  });
  extra.forEach(c => tiles.append(el('div', { class: 'tile ' + c })));
  const row = el('li', { class: 'row ' + cls, 'aria-label': label || up(word) }, el('div', { class: 'gutter' }, gutter), tiles);
  row.style.setProperty('--ts', tileSize(n) + 'px');
  return row;
}
const badge = k => el('span', { class: 'badge', text: '+' + k });
function icon(path, cls) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('width', '18'); s.setAttribute('height', '18'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = path;
  s.classList.add('gutter-icon', cls);
  return s;
}
const startIcon = () => icon('<path d="M7 4l12 8-12 8z" fill="currentColor"/>', 'start-icon');
const targetIcon = () => icon('<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="12" cy="12" r="3" fill="currentColor"/>', 'target-icon');

// typed word going DOWN: its first k letters match the end of `prev`
function liveOverlap(prev, typed, minK) {
  for (let k = Math.min(prev.length - 1, typed.length); k >= minK; k--) {
    if (prev.endsWith(typed.slice(0, k))) return k;
  }
  return 0;
}
// typed word going UP: its last k letters match the start of `next`
function liveOverlapBack(next, typed, minK) {
  for (let k = Math.min(next.length - 1, typed.length); k >= minK; k--) {
    if (next.startsWith(typed.slice(-k))) return k;
  }
  return 0;
}

function helperLine(g) {
  const fwd = g.dir === 'f';
  const pts = fwd ? splicePoints(topLast(g), g.minK) : joinPoints(bottomFirst(g), g.minK);
  const li = el('li', { class: 'helper' + (fwd ? '' : ' up') });
  li.append(fwd ? 'Start with ' : 'End with ');
  pts.slice(0, SHOW_SPLICES).forEach((p, i) => { if (i) li.append(' · '); li.append(el('strong', { text: up(p) })); });
  if (pts.length > SHOW_SPLICES) li.append(' …');
  if (g.minK === 3) li.append(el('br'), 'Hard mode: overlaps of 3+ letters');
  return li;
}

function render() {
  const g = S.game;
  if (!g) return;
  const done = g.status !== 'playing';
  const solved = g.status === 'solved';
  const fwd = g.dir === 'f';
  $('par-pill').textContent = (g.minK === 3 ? 'HARD · ' : '') + 'PAR ' + g.par;
  const tn = todayNumber();
  $('puzzle-label').textContent = g.kind === 'practice' ? `Practice #${g.num + 1}`
    : (g.num === tn ? `Daily #${g.num} · ${fmtDate(g.num)}` : `Archive #${g.num} · ${fmtDate(g.num)}`);
  $('btn-new-practice').hidden = g.kind !== 'practice';

  // pips (next to the puzzle label)
  const moves = movesOf(g);
  const pips = $('pips'); pips.replaceChildren();
  for (let i = 0; i < Math.max(g.par, moves); i++) {
    pips.append(el('div', { class: 'pip' + (i < moves ? (i < g.par ? ' on' : ' over') : '') }));
  }
  pips.setAttribute('aria-label', `${plural(moves, 'move')} so far, par ${g.par}`);

  const typed = S.typed.toLowerCase();
  const liveF = !done && fwd ? liveOverlap(topLast(g), typed, g.minK) : 0;
  const liveB = !done && !fwd ? liveOverlapBack(bottomFirst(g), typed, g.minK) : 0;

  // top half: start and the words added going down
  const top = $('chain-top'); top.replaceChildren();
  g.chain.forEach((w, i) => {
    const isLast = i === g.chain.length - 1;
    const endK = !isLast ? g.overlaps[i + 1] : solved ? g.joinK : liveF;
    top.append(tileRow(w, g.overlaps[i], endK, {
      gutter: i === 0 ? startIcon() : badge(g.overlaps[i]),
      cls: i === 0 ? 'start-row' : '',
      label: i === 0 ? `Start: ${up(w)}` : `${up(w)}, overlap ${g.overlaps[i]}`,
    }));
  });

  // bottom half: words added going up, then the target
  const bottom = $('chain-bottom'); bottom.replaceChildren();
  g.tail.forEach((w, j) => {
    const isTarget = j === g.tail.length - 1;
    const inK = j > 0 ? g.tailK[j - 1] : solved ? g.joinK : liveB;
    const endK = isTarget ? 0 : g.tailK[j];
    const shownIn = j > 0 ? g.tailK[j - 1] : solved ? g.joinK : 0;
    bottom.append(tileRow(w, inK, endK, {
      gutter: shownIn ? badge(shownIn) : isTarget ? targetIcon() : '',
      cls: isTarget ? 'target-row' : '',
      label: isTarget ? `Target: ${up(w)}` : `${up(w)}, overlap ${g.tailK[j]} into the next word`,
    }));
  });

  // input row + helper, at whichever end is being built
  if (!done) {
    const label = typed ? `Typing ${up(typed)}` : fwd ? 'Type the next word' : 'Type a word that leads into the bottom word';
    const row = tileRow(typed, fwd ? liveF : 0, fwd ? 0 : liveB, { extra: ['caret'], cls: 'input-row', label });
    if (fwd) top.append(row, helperLine(g));
    else bottom.prepend(helperLine(g), row);
  }
  $('chain-wrap').classList.toggle('joined', done && solved);
  $('gap').hidden = solved;

  // direction switch + actions
  $('dir-row').hidden = done;
  $('dir-f').setAttribute('aria-pressed', String(fwd));
  $('dir-b').setAttribute('aria-pressed', String(!fwd));
  $('btn-undo').disabled = addedCount(g) === 0 && !S.typed;
  for (const id of ['btn-undo', 'btn-hint', 'btn-giveup']) $(id).hidden = done;
  $('btn-result').hidden = !done;
  $('btn-hint').textContent = g.hints ? `Hint (${g.hints})` : 'Hint';

  const focusRow = document.querySelector('.input-row');
  if (focusRow) focusRow.scrollIntoView({ block: 'nearest' });
  else $('chain-wrap').scrollTop = 0;
}

// ---------- input ----------
let toastTimer;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}
function shake() {
  const row = document.querySelector('.input-row');
  if (!row) return;
  row.classList.remove('shake'); void row.offsetWidth; row.classList.add('shake');
}

function press(key) {
  const g = S.game;
  if (!g || g.status !== 'playing' || !$('sheet').hidden) return;
  if (key === 'enter') return submit();
  if (key === 'del') { S.typed = S.typed.slice(0, -1); return render(); }
  if (/^[a-z]$/.test(key) && S.typed.length < MAX_WORD_LEN) { S.typed += key; render(); }
}

function setDir(dir) {
  const g = S.game;
  if (!g || g.status !== 'playing' || g.dir === dir) return;
  g.dir = dir; S.typed = '';
  persist(); render();
}

function submit() {
  const g = S.game;
  const w = S.typed.toLowerCase();
  const fwd = g.dir === 'f';
  const anchor = fwd ? topLast(g) : bottomFirst(g);
  let err = null, k = 0;
  if (w.length < MIN_WORD_LEN) err = `Words need ${MIN_WORD_LEN}+ letters`;
  else if (!S.accepted.has(w)) err = 'Not in word list';
  else if (usedWords(g).has(w)) err = 'Already in your chain';
  else if (!(k = fwd ? overlap(anchor, w, g.minK) : overlap(w, anchor, g.minK))) {
    const pts = (fwd ? splicePoints(anchor, g.minK) : joinPoints(anchor, g.minK)).map(up);
    err = `Must ${fwd ? 'start' : 'end'} with ${pts.slice(0, 3).join(', ')}${pts.length > 3 ? '…' : ''}`;
  }
  if (err) { toast(err); shake(); return; }
  if (fwd) { g.chain.push(w); g.overlaps.push(k); }
  else { g.tail.unshift(w); g.tailK.unshift(k); }
  g.history.push(g.dir);
  S.typed = '';
  const j = overlap(topLast(g), bottomFirst(g), g.minK);
  if (j) { g.joinK = j; return finish('solved'); }
  persist(); render();
  const rows = document.querySelectorAll(fwd ? '#chain-top .row:not(.input-row)' : '#chain-bottom .row:not(.input-row)');
  (fwd ? rows[rows.length - 1] : rows[0])?.classList.add('pop');
}

function undo() {
  const g = S.game;
  if (!g || g.status !== 'playing') return;
  if (S.typed) S.typed = '';
  else if (g.history.length) {
    const side = g.history.pop();
    if (side === 'f') { g.chain.pop(); g.overlaps.pop(); }
    else { g.tail.shift(); g.tailK.shift(); }
    persist();
  }
  render();
}

function finish(status) {
  const g = S.game;
  g.status = status; g.finishedAt = Date.now(); S.typed = '';
  persist(); render();
  setTimeout(() => showResult(), status === 'solved' ? 500 : 0);
}

// ---------- sheets ----------
let lastFocus = null;
function openSheet(title, ...body) {
  lastFocus = document.activeElement;
  $('sheet-title').textContent = title;
  $('sheet-body').replaceChildren(...body.flat());
  $('sheet').hidden = false; $('scrim').hidden = false;
  $('btn-sheet-close').focus();
}
function closeSheet() {
  $('sheet').hidden = true; $('scrim').hidden = true;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

function menuSheet() {
  const tn = todayNumber();
  const item = (label, sub, fn) => el('li', {}, el('button', { type: 'button', class: 'menu-item', onclick: () => { closeSheet(); fn(); } },
    el('span', { text: label }), sub ? el('small', { text: sub }) : null));
  openSheet('Menu', el('ul', { class: 'menu-list' },
    item("Today's puzzle", `#${tn}`, openToday),
    item('Practice', 'unlimited', () => openPractice(false)),
    item('Archive', 'past dailies', archiveSheet),
    item('Statistics', '', statsSheet),
    item('How to play', '', helpSheet),
    item('Settings', 'themes · hard mode', settingsSheet),
  ));
}

function settingsSheet() {
  const grid = el('div', { class: 'themes' });
  for (const key of THEME_ORDER) {
    const t = THEMES[key];
    const btn = el('button', { type: 'button', class: 'theme-btn', 'aria-pressed': String(S.settings.theme === key),
      onclick: () => { S.settings.theme = key; save('settings', S.settings); applyTheme(key); settingsSheet(); } },
      el('span', { class: 'mini', 'aria-hidden': 'true' },
        ...['S', 'P', 'L'].map((c, i) => {
          const s = el('span', { text: c });
          s.style.background = i < 2 ? t.shared : t.tile; s.style.color = i < 2 ? t.sharedText : t.text;
          if (t.tileBorder !== 'none') s.style.border = t.tileBorder;
          return s;
        })),
      el('span', { text: t.name }));
    btn.style.background = t.bg; btn.style.color = t.text;
    if (key === S.settings.theme) btn.style.borderColor = t.text;
    grid.append(btn);
  }
  const g = S.game;
  const locked = g && g.status === 'playing' && addedCount(g) > 0;
  const sw = el('input', { type: 'checkbox', class: 'switch', id: 'hard-switch', role: 'switch' });
  sw.checked = S.settings.hard;
  sw.addEventListener('change', () => {
    S.settings.hard = sw.checked; save('settings', S.settings);
    if (S.game && S.game.status === 'playing' && addedCount(S.game) === 0) { applyMode(S.game); persist(); }
    render();
  });
  openSheet('Settings',
    el('h3', { text: 'GAME' }),
    el('div', { class: 'switch-row' },
      el('label', { for: 'hard-switch' }, 'Hard mode',
        el('small', { text: 'Every overlap must be at least 3 letters.' + (locked ? ' Applies from your next puzzle.' : '') })),
      sw),
    el('h3', { text: 'THEME' }), grid);
}

function helpSheet() {
  const ex = el('ol', { class: 'chain how-example', 'aria-label': 'Example: CARPET to PETAL to TALON to ONSET' });
  const words = ['carpet', 'petal', 'talon', 'onset'], ks = [0, 3, 3, 2];
  words.forEach((w, i) => {
    const r = tileRow(w, ks[i], ks[i + 1] || 0, { gutter: i ? badge(ks[i]) : '' });
    r.style.setProperty('--ts', '30px'); ex.append(r);
  });
  S.settings.seenHelp = true; save('settings', S.settings);
  openSheet('How to play',
    el('p', { text: 'Get from the start word (top) to the target (bottom). Each new word must begin with the last 2 or more letters of the word before it.' }),
    ex,
    el('p', {}, 'CARPET → PETAL → TALON → ONSET is ', el('strong', { text: '3 moves' }), '.'),
    el('p', {}, el('strong', { text: 'Work from either end. ' }),
      'Tap ', el('strong', { text: '↑ From target' }), ' to build upward: a word placed above the target must end with its first 2+ letters (TALON ends with ON, so it fits above ONSET). The puzzle is solved as soon as the two halves splice together.'),
    el('ul', {},
      el('li', { text: 'Words need at least 4 letters, and can’t repeat.' }),
      el('li', { text: 'An overlap can’t be a whole word.' }),
      el('li', { text: 'Fewer moves wins. Ties go to the longer total overlap — style points.' }),
      el('li', { text: 'Par is the fewest moves using common words. Know rarer words? You can beat it.' }),
      el('li', { text: 'Hard mode needs overlaps of 3+ letters.' })),
    el('p', { class: 'kbd-hint', text: 'A new daily puzzle every day. Practice and the archive are unlimited.' }),
    el('button', { type: 'button', class: 'big-btn', text: 'Play', onclick: closeSheet }));
}

function dailyStats() {
  const tn = todayNumber();
  const fin = Object.values(S.games).filter(g => g.kind === 'daily' && g.status !== 'playing');
  const solved = fin.filter(g => g.status === 'solved');
  const delta = g => movesOf(g) - g.par;
  const dist = { 'Under par': 0, 'Par': 0, '+1': 0, '+2': 0, '+3+': 0, 'Gave up': 0 };
  for (const g of fin) {
    if (g.status === 'gaveup') dist['Gave up']++;
    else { const d = delta(g); dist[d < 0 ? 'Under par' : d === 0 ? 'Par' : d === 1 ? '+1' : d === 2 ? '+2' : '+3+']++; }
  }
  const ok = n => { const g = S.games['d' + n]; return g && g.status === 'solved' && g.onDay; };
  let cur = 0;
  for (let n = ok(tn) ? tn : tn - 1; n >= 1 && ok(n); n--) cur++;
  let max = 0, run = 0;
  for (let n = 1; n <= tn; n++) { run = ok(n) ? run + 1 : 0; max = Math.max(max, run); }
  const parOrBetter = solved.filter(g => delta(g) <= 0).length;
  return { played: fin.length, solved: solved.length, parPct: fin.length ? Math.round(100 * parOrBetter / fin.length) : 0, cur, max, dist,
    practice: Object.values(S.games).filter(g => g.kind === 'practice' && g.status === 'solved').length };
}

function statsBlock(highlight) {
  const s = dailyStats();
  const top = Math.max(1, ...Object.values(s.dist));
  return [
    el('div', { class: 'stat-grid' },
      ...[[s.played, 'Played'], [s.parPct + '%', 'Par or better'], [s.cur, 'Streak'], [s.max, 'Best streak']]
        .map(([v, l]) => el('div', {}, el('b', { text: String(v) }), el('span', { text: l })))),
    el('h3', { text: 'DAILY RESULTS' }),
    el('div', { class: 'dist' }, ...Object.entries(s.dist).map(([k, v]) => {
      const bar = el('div', { class: 'bar' + (k === highlight ? ' hi' : ''), text: String(v) });
      bar.style.width = `calc(${Math.round(100 * v / top)}% - 72px)`;
      return el('div', { class: 'dist-row' }, el('span', { class: 'lbl', text: k }), bar);
    })),
    el('p', { class: 'kbd-hint', text: `Practice puzzles solved: ${s.practice}` }),
  ];
}
function statsSheet() { openSheet('Statistics', statsBlock()); }

function archiveSheet() {
  const tn = todayNumber();
  const list = el('ul', { class: 'archive' });
  for (let n = tn; n >= 1; n--) {
    const g = S.games['d' + n];
    const cls = g ? (g.status === 'solved' ? ' solved' : g.status === 'gaveup' ? ' gaveup' : '') : '';
    const state = g ? (g.status === 'solved' ? `solved in ${movesOf(g)}` : g.status === 'gaveup' ? 'gave up' : 'in progress') : 'not played';
    list.append(el('li', {}, el('button', { type: 'button', class: 'arch-btn' + cls, 'aria-label': `Daily ${n}, ${fmtDate(n)}, ${state}`,
      onclick: () => { closeSheet(); openArchive(n); } },
      el('span', { text: '#' + n }), el('small', { text: fmtDate(n, { month: 'short', day: 'numeric' }) }))));
  }
  openSheet('Archive', el('p', { class: 'kbd-hint', text: 'Archive games count toward your results, not your streak.' }), list);
}

function miniChain(words, minK) {
  const box = el('div', { class: 'mini-chain' });
  words.forEach((w, i) => {
    const kIn = i ? overlap(words[i - 1], w, minK) : 0;
    const kOut = i + 1 < words.length ? overlap(w, words[i + 1], minK) : 0;
    const span = el('span', { class: 'w' });
    const a = up(w);
    if (kIn) span.append(el('mark', { text: a.slice(0, kIn) }));
    span.append(a.slice(kIn, a.length - kOut));
    if (kOut) span.append(el('mark', { text: a.slice(a.length - kOut) }));
    if (i) box.append(el('span', { class: 'arrow', 'aria-hidden': 'true', text: '→' }));
    box.append(span);
  });
  return box;
}

function shareText(g) {
  const moves = movesOf(g);
  const name = g.kind === 'practice' ? `Splice practice #${g.num + 1}` : `Splice #${g.num}`;
  const line = g.status === 'solved' ? fullChain(g).ks.join('·') : 'X';
  const extras = [g.minK === 3 ? 'hard' : '', g.hints ? plural(g.hints, 'hint') : ''].filter(Boolean).join(' · ');
  const url = location.origin + location.pathname;
  return `${name}\n${line} — par ${g.par}${g.status === 'solved' && moves < g.par ? ' (under!)' : ''}${extras ? '\n' + extras : ''}\n${url}`;
}

async function share(g) {
  const text = shareText(g);
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ text }); return; }
  } catch { /* fall back to clipboard */ }
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
  catch { toast('Copy failed — select the text above'); }
}

function showResult() {
  const g = S.game;
  const moves = movesOf(g);
  const d = moves - g.par;
  const full = fullChain(g);
  const style = g.status === 'solved' ? full.ks.reduce((a, b) => a + b, 0) : 0;
  let big, bucket;
  if (g.status === 'gaveup') { big = 'Gave up'; bucket = 'Gave up'; }
  else if (d < 0) { big = 'Under par!'; bucket = 'Under par'; }
  else if (d === 0) { big = 'Par!'; bucket = 'Par'; }
  else { big = `+${d} over par`; bucket = d >= 3 ? '+3+' : '+' + d; }
  const body = [
    el('div', { class: 'result-head' },
      el('div', { class: 'big', text: big }),
      el('div', { class: 'sub', text: g.status === 'solved'
        ? `${moves} moves · style ${style} · par ${g.par}${g.minK === 3 ? ' (hard)' : ''}${g.hints ? ` · ${plural(g.hints, 'hint')}` : ''}`
        : `Par was ${g.par}` })),
  ];
  if (g.status === 'solved') body.push(el('h3', { text: 'YOUR CHAIN' }), miniChain(full.words, g.minK));
  body.push(el('h3', { text: 'A PAR SOLUTION' }), miniChain(g.solution, g.minK));
  body.push(el('div', { class: 'share-box', text: shareText(g) }));
  const buttons = [el('button', { type: 'button', class: 'big-btn', text: 'Share', onclick: () => share(g) })];
  if (g.kind === 'practice') buttons.push(el('button', { type: 'button', class: 'big-btn secondary', text: 'Next puzzle', onclick: () => { closeSheet(); openPractice(true); } }));
  else if (g.num !== todayNumber()) buttons.push(el('button', { type: 'button', class: 'big-btn secondary', text: "Today's puzzle", onclick: () => { closeSheet(); openToday(); } }));
  else buttons.push(el('button', { type: 'button', class: 'big-btn secondary', text: 'Practice', onclick: () => { closeSheet(); openPractice(false); } }));
  body.push(el('div', { class: 'btn-row' }, buttons));
  if (g.kind === 'daily') body.push(el('h3', { text: 'STATISTICS' }), ...statsBlock(bucket));
  openSheet(g.status === 'solved' ? 'Solved' : 'Result', body);
}

function cached(key, fn) {
  if (!S.cache.has(key)) S.cache.set(key, fn());
  return S.cache.get(key);
}

function hintSheet() {
  const g = S.game;
  if (!S.graph) { toast('Still loading the word graph…'); return; }
  const a = topLast(g), b = bottomFirst(g), used = usedWords(g), fwd = g.dir === 'f';
  // distances measured between the two open ends, through common words
  const toB = cached(`b|${b}|${g.minK}`, () => S.graph.backward(b, g.minK));
  const hf = S.graph.hint(a, b, g.minK, toB, used);
  let suggestion = null;
  if (fwd) suggestion = hf && hf.options[0];
  else {
    const fromA = cached(`f|${a}|${g.minK}`, () => S.graph.forward(a, g.minK));
    const hb = S.graph.hintBack(b, g.minK, fromA, used);
    suggestion = hb && hb.options[0];
  }
  const out = el('p', { 'aria-live': 'polite' });
  const use = () => { g.hints++; persist(); render(); };
  const noRoute = 'No route between your two ends using common words. Try Undo.';
  openSheet('Hint',
    el('p', { class: 'kbd-hint', text: 'Hints show up in your result.' }),
    el('div', { class: 'btn-row' },
      el('button', { type: 'button', class: 'big-btn secondary', text: 'Moves left?', onclick: () => {
        use();
        out.textContent = hf ? `${up(a)} is ${plural(hf.movesLeft, 'move')} from ${up(b)} — ${plural(hf.movesLeft - 1, 'more word')} to find.` : noRoute;
      } }),
      el('button', { type: 'button', class: 'big-btn secondary', text: 'Suggest a word', onclick: () => {
        use();
        if (!hf || !suggestion) { out.textContent = noRoute; return; }
        const [w, k] = suggestion;
        const after = hf.movesLeft - 2;
        out.replaceChildren('Try ', el('strong', { text: up(w) }),
          fwd ? ` after ${up(a)} (overlap ${k})` : ` above ${up(b)} (overlap ${k})`,
          after > 0 ? ` — then ${plural(after, 'more word')}.` : ' — that completes the chain.');
      } })),
    out);
}

function giveUpSheet() {
  openSheet('Give up?',
    el('p', { text: 'You’ll see a par solution and this puzzle will count as given up.' }),
    el('div', { class: 'btn-row' },
      el('button', { type: 'button', class: 'big-btn secondary', text: 'Keep playing', onclick: closeSheet }),
      el('button', { type: 'button', class: 'big-btn', text: 'Give up', onclick: () => { closeSheet(); finish('gaveup'); } })));
}

// ---------- keyboard ----------
function buildKeyboard() {
  const kb = $('keyboard');
  const rows = ['qwertyuiop', 'asdfghjkl', '+zxcvbnm-'];
  for (const r of rows) {
    const row = el('div', { class: 'krow' });
    for (const c of r) {
      if (c === '+') row.append(el('button', { type: 'button', class: 'key wide', 'data-key': 'enter', text: 'ENTER' }));
      else if (c === '-') row.append(el('button', { type: 'button', class: 'key wide', 'data-key': 'del', 'aria-label': 'Delete', text: 'DEL' }));
      else row.append(el('button', { type: 'button', class: 'key', 'data-key': c, text: c }));
    }
    kb.append(row);
  }
  kb.addEventListener('click', e => { const b = e.target.closest('[data-key]'); if (b) press(b.dataset.key); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('sheet').hidden) { closeSheet(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey || !$('sheet').hidden) return;
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (e.key === 'Enter') { e.preventDefault(); press('enter'); }
    else if (e.key === 'Backspace') press('del');
    else if (e.key === 'ArrowUp') setDir('b');
    else if (e.key === 'ArrowDown') setDir('f');
    else if (/^[a-zA-Z]$/.test(e.key)) press(e.key.toLowerCase());
  });
}

// ---------- boot ----------
async function boot() {
  applyTheme(S.settings.theme);
  buildKeyboard();
  $('btn-menu').addEventListener('click', menuSheet);
  $('btn-sheet-close').addEventListener('click', closeSheet);
  $('scrim').addEventListener('click', closeSheet);
  $('btn-undo').addEventListener('click', undo);
  $('btn-hint').addEventListener('click', hintSheet);
  $('btn-giveup').addEventListener('click', giveUpSheet);
  $('btn-result').addEventListener('click', showResult);
  $('btn-new-practice').addEventListener('click', () => openPractice(true));
  $('dir-f').addEventListener('click', () => setDir('f'));
  $('dir-b').addEventListener('click', () => setDir('b'));
  window.addEventListener('resize', () => render());
  try {
    const [acc, puz, pz] = await Promise.all([
      fetch('data/accepted.txt').then(r => r.text()),
      fetch('data/puzzle.txt').then(r => r.text()),
      fetch('data/puzzles.json').then(r => r.json()),
    ]);
    S.accepted = new Set(acc.trim().split('\n'));
    S.puzzles = pz;
    openToday();
    if (!S.settings.seenHelp) helpSheet();
    setTimeout(() => { S.graph = new Graph(puz.trim().split('\n')); }, 50);
  } catch (e) {
    $('puzzle-label').textContent = 'Could not load the word lists. Check your connection and reload.';
    console.error(e);
  }
}
boot();
