// Generate Splice puzzles: node tools/generate_puzzles.mjs <puzzle_freq.tsv> <inflections.tsv> [nDaily] [nPractice]
// Writes data/puzzles.json. Deterministic (seeded).
//
// Selection rules (from the spec):
//  - start and target: common base words (top 12k bases), 5–7 letters, not inflections
//  - normal par (min overlap 2) is 3–5 moves, computed through puzzle words only
//  - several distinct shortest solutions (>= 3)
//  - also solvable in hard mode (min overlap 3), hard par at most 9
//  - no word is used as start or target twice within the daily set (or within practice)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Graph } from '../js/solver.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [freqTsv, inflTsv, nDailyArg, nPracticeArg] = process.argv.slice(2);
const N_DAILY = +(nDailyArg || 1095);
const N_PRACTICE = +(nPracticeArg || 1500);
const SEED = 20261025;
const PAR_MIX = [[3, 0.5], [4, 0.4], [5, 0.1]];
const MIN_PATHS = 3, MAX_HARD_PAR = 8, MAX_BASE_RANK = 12000;

const words = fs.readFileSync(path.join(ROOT, 'data/puzzle.txt'), 'utf8').trim().split('\n');
const g = new Graph(words);

const infl = new Set(fs.readFileSync(inflTsv, 'utf8').trim().split('\n').slice(1).map(l => l.split('\t')[0]));
const pool = [];
for (const line of fs.readFileSync(freqTsv, 'utf8').trim().split('\n').slice(1)) {
  const [w, , rank] = line.split('\t');
  if (rank && +rank <= MAX_BASE_RANK && w.length >= 5 && w.length <= 7 && !infl.has(w)) pool.push(w);
}
console.error(`pool: ${pool.length} candidate start/target words`);

let s = SEED;
const rand = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rand() * a.length)];
const wantPar = () => { let r = rand(); for (const [p, w] of PAR_MIX) { if ((r -= w) < 0) return p; } return 3; };

const usedDaily = new Set(), usedPractice = new Set();
const out = [];
const total = N_DAILY + N_PRACTICE;
let tries = 0;
const t0 = Date.now();
while (out.length < total && tries < total * 20) {
  tries++;
  const usedWords = out.length < N_DAILY ? usedDaily : usedPractice;
  const start = pick(pool);
  if (usedWords.has(start)) continue;
  const par = wantPar();
  const fwd = g.forward(start, 2, par);
  const targets = pool.filter(w => fwd.get(w) === par && !usedWords.has(w) && w !== start);
  if (!targets.length) continue;
  const target = pick(targets);
  const n = g.solve(start, target, 2, par);
  if (!n || n.par !== par || n.paths < MIN_PATHS) continue;
  const h = g.solve(start, target, 3, MAX_HARD_PAR);
  if (!h) continue;
  usedWords.add(start); usedWords.add(target);
  out.push([start, target, n.par, h.par, n.best.join(' '), h.best.join(' ')]);
  if (out.length % 200 === 0) console.error(`${out.length}/${total}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

const daily = out.slice(0, N_DAILY), practice = out.slice(N_DAILY);
const hist = (rows, i) => rows.reduce((h, r) => ((h[r[i]] = (h[r[i]] || 0) + 1), h), {});
console.error('daily par', hist(daily, 2), 'hard', hist(daily, 3));
console.error('practice par', hist(practice, 2), 'hard', hist(practice, 3));
fs.writeFileSync(path.join(ROOT, 'data/puzzles.json'), JSON.stringify({
  version: 1,
  fields: ['start', 'target', 'par', 'hardPar', 'solution', 'hardSolution'],
  daily, practice,
}));
console.error(`wrote ${daily.length} daily + ${practice.length} practice`);
