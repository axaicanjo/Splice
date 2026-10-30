// Splice rules + solver. Shared by the web app and tools/generate_puzzles.mjs.
//
// Rules: a move from word P to word W is legal when, for some k >= minOverlap,
// the last k letters of P equal the first k letters of W, with k < len(P) and
// k < len(W) (an overlap can never be a whole word). Words must be >= 4 letters
// and may not repeat within a chain. The overlap credited for a move is the
// longest legal k (style points).

export const MIN_WORD_LEN = 4;

/** Longest legal overlap from prev to next, or 0 if the move is illegal. */
export function overlap(prev, next, minOverlap) {
  const max = Math.min(prev.length, next.length) - 1;
  for (let k = max; k >= minOverlap; k--) {
    if (prev.endsWith(next.slice(0, k))) return k;
  }
  return 0;
}

/** Suffixes of a word a next word could begin with, shortest first. */
export function splicePoints(word, minOverlap) {
  const out = [];
  for (let k = minOverlap; k < word.length; k++) out.push(word.slice(-k));
  return out;
}

/** Prefixes of a word a previous word could end with, shortest first. */
export function joinPoints(word, minOverlap) {
  const out = [];
  for (let k = minOverlap; k < word.length; k++) out.push(word.slice(0, k));
  return out;
}

export class Graph {
  /** @param {string[]} words  the puzzle (common) list */
  constructor(words) {
    this.words = words;
    this.byPrefix = new Map(); // proper prefix (len>=2) -> words starting with it
    this.bySuffix = new Map(); // proper suffix (len>=2) -> words ending with it
    for (const w of words) {
      for (let k = 2; k < w.length; k++) {
        push(this.byPrefix, w.slice(0, k), w);
        push(this.bySuffix, w.slice(-k), w);
      }
    }
  }

  /** Words reachable in one move from `word` (any string), with their overlap. */
  next(word, minOverlap) {
    const out = [];
    const seen = new Set();
    for (let k = word.length - 1; k >= minOverlap; k--) {
      const list = this.byPrefix.get(word.slice(-k));
      if (!list) continue;
      for (const w of list) if (!seen.has(w)) { seen.add(w); out.push([w, k]); }
    }
    return out; // longest overlap first, so each word carries its best k
  }

  /** Words that can come right BEFORE `word` (any string), with their overlap. */
  prev(word, minOverlap) {
    const out = [];
    const seen = new Set();
    for (let k = word.length - 1; k >= minOverlap; k--) {
      const list = this.bySuffix.get(word.slice(0, k));
      if (!list) continue;
      for (const p of list) if (!seen.has(p)) { seen.add(p); out.push([p, k]); }
    }
    return out;
  }

  /** BFS distances (in moves) from `start`. Each splice key is expanded once. */
  forward(start, minOverlap, maxDepth = Infinity) {
    const dist = new Map([[start, 0]]);
    const used = new Set();
    const q = [start];
    for (let i = 0; i < q.length; i++) {
      const p = q[i], d = dist.get(p);
      if (d >= maxDepth) continue;
      for (let k = minOverlap; k < p.length; k++) {
        const key = p.slice(-k);
        if (used.has(key)) continue;
        used.add(key);
        const list = this.byPrefix.get(key);
        if (!list) continue;
        for (const w of list) if (!dist.has(w)) { dist.set(w, d + 1); q.push(w); }
      }
    }
    return dist;
  }

  /** BFS distances (in moves) from every word TO `target`. */
  backward(target, minOverlap, maxDepth = Infinity) {
    const dist = new Map([[target, 0]]);
    const used = new Set();
    const q = [target];
    for (let i = 0; i < q.length; i++) {
      const w = q[i], d = dist.get(w);
      if (d >= maxDepth) continue;
      for (let k = minOverlap; k < w.length; k++) {
        const key = w.slice(0, k);
        if (used.has(key)) continue;
        used.add(key);
        const list = this.bySuffix.get(key);
        if (!list) continue;
        for (const p of list) if (!dist.has(p)) { dist.set(p, d + 1); q.push(p); }
      }
    }
    return dist;
  }

  /**
   * Solve start -> target through puzzle words.
   * Returns { par, paths, best: [words...], bestStyle } or null if unreachable.
   * `paths` = number of distinct shortest chains (capped at 1e6).
   */
  solve(start, target, minOverlap, maxDepth = 10) {
    const toT = this.backward(target, minOverlap, maxDepth);
    // start may be outside the graph: take its moves directly
    let par = Infinity;
    for (const [w] of this.next(start, minOverlap)) {
      const d = toT.get(w);
      if (d !== undefined && d + 1 < par) par = d + 1;
    }
    if (par === Infinity) return null;
    // layered DP over nodes on a shortest path: count paths, maximise overlap sum
    let layer = new Map([[start, { count: 1, style: 0, prev: null, k: 0 }]]);
    for (let step = 1; step <= par; step++) {
      const nextLayer = new Map();
      for (const [p, info] of layer) {
        for (const [w, k] of this.next(p, minOverlap)) {
          if (toT.get(w) !== par - step) continue;
          if (w === start) continue;
          const cur = nextLayer.get(w);
          const style = info.style + k;
          if (!cur) nextLayer.set(w, { count: info.count, style, prev: p, k, from: info });
          else {
            cur.count = Math.min(1e6, cur.count + info.count);
            if (style > cur.style) { cur.style = style; cur.prev = p; cur.k = k; cur.from = info; }
          }
        }
      }
      layer = nextLayer;
    }
    const end = layer.get(target);
    if (!end) return null;
    const best = [target], overlaps = [end.k];
    let node = end;
    while (node.from && node.prev !== start) {
      best.unshift(node.prev);
      overlaps.unshift(node.from.k);
      node = node.from;
    }
    best.unshift(start);
    return { par, paths: end.count, best, overlaps, bestStyle: end.style };
  }

  /**
   * Hint from the current last word: moves still needed (via puzzle words) and
   * the best next words. `toT` is a cached backward() map for the target.
   * `used` = words already in the chain (cannot repeat).
   */
  hint(current, target, minOverlap, toT, used) {
    let bestD = Infinity, options = [];
    for (const [w, k] of this.next(current, minOverlap)) {
      if (used.has(w)) continue;
      const d = toT.get(w);
      if (d === undefined) continue;
      if (d + 1 < bestD) { bestD = d + 1; options = [[w, k]]; }
      else if (d + 1 === bestD) options.push([w, k]);
    }
    if (bestD === Infinity) return null;
    options.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { movesLeft: bestD, options };
  }

  /**
   * Backward hint: best words to place right BEFORE `current` (the top of the
   * target-side chain). `fromS` is a cached forward() map from the start side.
   */
  hintBack(current, minOverlap, fromS, used) {
    let bestD = Infinity, options = [];
    for (const [p, k] of this.prev(current, minOverlap)) {
      if (used.has(p)) continue;
      const d = fromS.get(p);
      if (d === undefined) continue;
      if (d + 1 < bestD) { bestD = d + 1; options = [[p, k]]; }
      else if (d + 1 === bestD) options.push([p, k]);
    }
    if (bestD === Infinity) return null;
    options.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { movesLeft: bestD, options };
  }
}

function push(map, key, val) {
  const a = map.get(key);
  if (a) a.push(val); else map.set(key, [val]);
}
