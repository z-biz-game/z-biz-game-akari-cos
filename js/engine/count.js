// An exhaustive, capped count of legal finishes. This is deliberately *not* the pencil
// solver: it decides cell by cell whether a bulb sits there and checks the rules of the
// game at the leaves, with no deduction logic in sight.
//
// Why both exist: the pencil solver reaching a full board from an empty grid is the
// no-guess promise, and it is also what the generator accepts boards on. If that solver had
// a bug — writing a value its justification doesn't actually force — it could "prove" a
// board unique while the puzzle silently has a second finish. This counter answers the same
// question from the other direction, so the two have to agree for a board to ship.

import { createBoard } from './akari.js';

export const UNIQUE = 1;
export const NONE = 0; // provably no legal finish — distinct from MANY, which is "≥ 2"
export const MANY = 2; // the count stops here, uniqueness is all we ask
export const OVERBUDGET = -1;

export function countSolutions(w, h, wall, clue, { budget = 300000 } = {}) {
  const board = createBoard(w, h, wall, clue);
  const cells = Array.from(board.lightable);
  const n = cells.length;

  const runBulb = new Int32Array(board.runs.length);
  const runOpen = new Int32Array(board.runs.length);
  for (let r = 0; r < board.runs.length; r++) runOpen[r] = board.runs[r].cells.length;

  const clueIds = [];
  const clueBulbs = new Map();
  const clueOpen = new Map();
  for (let i = 0; i < board.n; i++) {
    if (!board.wall[i] || board.clue[i] < 0) continue;
    clueIds.push(i);
    clueBulbs.set(i, 0);
    clueOpen.set(i, board.adj[i].length);
  }
  // Which numbered walls does each cell feed? Built once, read at every node.
  const feeds = new Map();
  for (const i of clueIds) for (const nb of board.adj[i]) {
    if (!feeds.has(nb)) feeds.set(nb, []);
    feeds.get(nb).push(i);
  }

  let solutions = 0;
  let steps = 0;
  let truncated = false;

  const walk = (k) => {
    if (truncated || solutions >= MANY) return;
    if (++steps > budget) { truncated = true; return; }
    if (k === n) {
      // The mid-search prune only rejects cells that are already impossible; a cell whose
      // last chance was skipped further along still reaches here, so lighting is settled
      // once, at the leaf, against the final run table.
      for (const c of cells) {
        if (!runBulb[board.hs[c]] && !runBulb[board.vs[c]]) return;
      }
      for (const i of clueIds) if (clueBulbs.get(i) !== board.clue[i]) return;
      solutions++;
      return;
    }
    const c = cells[k];
    const hs = board.hs[c], vs = board.vs[c];
    runOpen[hs]--; runOpen[vs]--;
    const fed = feeds.get(c) || [];

    if (!runBulb[hs] && !runBulb[vs]) {
      runBulb[hs] = runBulb[vs] = 1;
      let dead = false;
      for (const i of fed) {
        clueBulbs.set(i, clueBulbs.get(i) + 1);
        clueOpen.set(i, clueOpen.get(i) - 1);
        if (clueBulbs.get(i) > board.clue[i]) dead = true;
      }
      if (!dead) walk(k + 1);
      for (const i of fed) {
        clueBulbs.set(i, clueBulbs.get(i) - 1);
        clueOpen.set(i, clueOpen.get(i) + 1);
      }
      runBulb[hs] = runBulb[vs] = 0;
    }

    // Skipping the bulb is only legal while the cell can still be reached: this run pair
    // is not already spent, and at least one of the two runs still has a cell left to
    // host a bulb. Everything else is settled at the leaf.
    const reachable = runBulb[hs] || runBulb[vs]
      || (!runBulb[hs] && runOpen[hs] > 0)
      || (!runBulb[vs] && runOpen[vs] > 0);
    if (reachable) {
      let dead = false;
      for (const i of fed) {
        clueOpen.set(i, clueOpen.get(i) - 1);
        if (clueOpen.get(i) < board.clue[i] - clueBulbs.get(i)) dead = true;
      }
      if (!dead) walk(k + 1);
      for (const i of fed) clueOpen.set(i, clueOpen.get(i) + 1);
    }

    runOpen[hs]++; runOpen[vs]++;
  };

  walk(0);
  if (truncated) return { status: OVERBUDGET, solutions, steps };
  return { status: solutions === 1 ? UNIQUE : solutions === 0 ? NONE : MANY, solutions, steps };
}
