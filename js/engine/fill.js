// Finding *a* legal bulb placement for a wall pattern. This is a search — backtracking is
// allowed here and nowhere else: the player's path is js/engine/akari.js, whose rules must
// never guess. The generator needs some solution to hang clues on, and by construction a
// searcher that fails just retries with a different pattern.
//
// Model recap (see akari.js): a bulb sits on a cell, lights both of its runs, and makes
// every other cell in those two runs unusable for a second bulb. So a partial placement is
// a set of pairwise run-disjoint cells, and it fails as soon as one unlit cell has run out
// of hosts.

import { createBoard, at } from './akari.js';

export function runIds(board) {
  const runs = board.runs.map(() => ({ bulb: 0, hosts: [] }));
  for (const c of board.lightable) {
    runs[board.hs[c]].hosts.push(c);
    runs[board.vs[c]].hosts.push(c);
  }
  return runs;
}

// One solution attempt. `rng` shuffles the candidate order, so repeated calls over the
// same wall pattern walk different branches instead of returning the same board forever.
export function placeBulbs(w, h, wall, rng, { limit = 20000 } = {}) {
  const board = createBoard(w, h, wall, Int8Array.from(wall).fill(-1));
  const n = board.lightable.length;
  const bulbs = new Uint8Array(board.n);
  const runBulb = new Int32Array(board.runs.length).fill(-1);
  let steps = 0;

  // Cells a bulb already covers: they need no host, and a cell in a lit run cannot host.
  const litBy = (c) => runBulb[board.hs[c]] >= 0 || runBulb[board.vs[c]] >= 0;
  const hostable = (c) => !bulbs[c] && runBulb[board.hs[c]] < 0 && runBulb[board.vs[c]] < 0;

  const candidatesOf = (c) => {
    const out = [];
    for (const run of [board.hs[c], board.vs[c]]) {
      if (runBulb[run] >= 0) continue;
      for (const p of board.runs[run].cells) if (hostable(p) && !out.includes(p)) out.push(p);
    }
    return out;
  };

  const shine = (p, sign) => {
    for (const run of [board.hs[p], board.vs[p]]) runBulb[run] = sign > 0 ? p : -1;
    bulbs[p] = sign > 0 ? 1 : 0;
  };

  const search = () => {
    if (++steps > limit) return 'budget';
    let target = -1, fewest = Infinity, litCount = 0;
    for (const c of board.lightable) {
      if (litBy(c)) { litCount++; continue; }
      const k = candidatesOf(c).length;
      if (k === 0) return false;
      if (k < fewest) { fewest = k; target = c; if (k === 1) break; }
    }
    if (target < 0) return litCount === n;
    const options = rng.shuffle(candidatesOf(target));
    for (const p of options) {
      // Placing at p also has to leave the *other* unlit cells reachable, which the next
      // recursion's MRV scan reports; no separate lookahead needed.
      shine(p, 1);
      const r = search();
      if (r === true) return true;
      shine(p, -1);
      if (r === 'budget') return 'budget';
    }
    return false;
  };

  const ok = search();
  if (ok !== true) return null;
  return { board, bulbs };
}

// Clues read straight off the placement: every wall cell counts the bulbs beside it.
export function cluesFrom(w, h, wall, bulbs) {
  const clue = new Int8Array(w * h).fill(-1);
  for (let i = 0; i < w * h; i++) {
    if (!wall[i]) continue;
    const x = i % w, y = (i / w) | 0;
    let k = 0;
    if (x > 0 && bulbs[i - 1]) k++;
    if (x + 1 < w && bulbs[i + 1]) k++;
    if (y > 0 && bulbs[i - w]) k++;
    if (y + 1 < h && bulbs[i + w]) k++;
    clue[i] = k;
  }
  return clue;
}

export { at };
