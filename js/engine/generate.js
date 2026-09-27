// Turning a wall pattern into a puzzle the pencil solver can finish, and grading what it
// took. Bands in TIERS are *measured* by tools/balance.mjs — see DESIGN.md before editing
// a number there by hand.

import { makeRng } from './rng.js';
import { createBoard, solve, OPEN, BULB, MARK, Rules, at } from './akari.js';
import { placeBulbs, cluesFrom } from './fill.js';

// `band` is a *selection* target, not a label. The measured first-accept distributions here
// (tools/balance.mjs) overlap heavily — 熟练 8×8 and 见习 8×8 sit at medians 12.2 and 11.2,
// and 老手 is nominally harder than 专家 at the same size. Tuning density alone did not fix
// that ordering, so each tier keeps drawing patterns until it gets one whose score falls in
// its own band, which is the only mechanism that makes "五档由浅入深" a checkable claim.
// The band edges are read off the measured p25/p75 of each tier, not chosen by taste.
export const TIERS = [
  { id: 'trainee', label: '见习', size: 8, density: 0.34, prune: 0.35, band: [4, 10] },
  { id: 'apprentice', label: '熟练', size: 8, density: 0.4, prune: 0.55, band: [10, 15.5] },
  { id: 'regular', label: '老手', size: 10, density: 0.34, prune: 0.7, band: [15.5, 21] },
  { id: 'expert', label: '专家', size: 10, density: 0.4, prune: 0.9, band: [21, 27] },
  { id: 'master', label: '大师', size: 12, density: 0.4, prune: 1, band: [27, 34] },
];

export function tierById(id) {
  return TIERS.find((t) => t.id === id) || TIERS[0];
}

const NAME_A = ['夜航', '灯塔', '苔径', '雪窗', '星港', '回廊', '雾堤', '纸伞', '石阶', '灯下', '旧站', '檐角'];
const NAME_B = ['下', '间', '旁', '之侧', '尽头', '转角', '深处', '长夜'];

// Wall patterns: independent per-cell noise, then one thinning sweep.
//
// Measurement is what picked this. Mirrored motif shapes (rect/diamond/ring/bar/blob) were
// tried first because real Akari boards look symmetric, and they produced 0 usable patterns
// out of 200 at size 10 — a motif lands on top of a motif, the light-runs become 15-cell
// corridors, and no pencil rule can pin a bulb inside a corridor. Uniform noise at the same
// 0.18–0.22 density fails for the same reason, which is why the first reading of "noise
// doesn't work" was wrong: the problem was density, not shape. At 0.34–0.40 noise breaks the
// board into short runs and 唯一光源 / 反证 get something to say; thinning each solid 2×2
// wall block back to three walls is what keeps the leftover open cells in runs of two or
// three instead of pockets.
export function noiseWalls(rng, w, h, p) {
  const wall = new Uint8Array(w * h);
  for (let i = 0; i < wall.length; i++) wall[i] = rng.next() < p ? 1 : 0;
  for (let y = 0; y + 1 < h; y++) {
    for (let x = 0; x + 1 < w; x++) {
      const q = [y * w + x, y * w + x + 1, (y + 1) * w + x, (y + 1) * w + x + 1];
      if (wall[q[0]] && wall[q[1]] && wall[q[2]] && wall[q[3]]) wall[q[3]] = 0;
    }
  }
  // A board with no numbered wall beside a run tells the player nothing; require that most
  // open cells sit next to at least one wall so clue pruning has material to remove.
  let lonely = 0;
  for (let i = 0; i < wall.length; i++) {
    if (wall[i]) continue;
    const x = i % w, y = (i / w) | 0;
    let nb = 0;
    if (x > 0 && wall[i - 1]) nb++;
    if (x + 1 < w && wall[i + 1]) nb++;
    if (y > 0 && wall[i - w]) nb++;
    if (y + 1 < h && wall[i + w]) nb++;
    if (!nb) lonely++;
  }
  if (lonely > wall.length * 0.06) return null;
  return wall;
}

// Remove clues while the board stays pencil-solvable, in a randomised order: fewer clues
// means the covering rule has to carry more of the board, which is the whole difficulty
// dial for this game.
function pruneClues(w, h, wall, clueIn, rng, { fraction, accept }) {
  const clue = Int8Array.from(clueIn);
  const cells = [];
  for (let i = 0; i < w * h; i++) if (wall[i] && clue[i] >= 0) cells.push(i);
  for (const i of rng.shuffle(cells)) {
    if (rng.next() > fraction) continue;
    const before = clue[i];
    clue[i] = -1;
    if (!accept(w, h, wall, clue)) clue[i] = before;
  }
  return clue;
}

export function solvableByPencil(w, h, wall, clue) {
  const board = createBoard(w, h, wall, Int8Array.from(clue));
  const r = solve(board);
  return r.solved ? r : null;
}

// The score is a reading of the accepted solve, not a guess about the board: how many
// sweeps it needed, how often the player had to reason about lighting rather than counts,
// and how much of the board stayed undetermined after the first look.
export function grade(result, board) {
  if (!result) return null;
  const use = result.ruleUse;
  const cluster = use[Rules.clueCluster] || 0;
  const only = use[Rules.onlySource] || 0;
  const cells = board.lightable.length;
  let firstPassUnknown = 0;
  {
    const probe = createBoard(board.w, board.h, board.wall, board.clue);
    const r = solve(probe, { maxPasses: 1 });
    firstPassUnknown = probe.lightable.length - r.events.reduce((a, e) => a + e.cells.length, 0);
  }
  return {
    score: Math.round((result.passes * 1.4 + only * 1.1 + cluster * 0.8
      + Math.min(firstPassUnknown / Math.max(1, cells), 1) * 14) * 10) / 10,
    passes: result.passes,
    onlySource: only,
    cluster,
    nishio: result.nishio || 0,
    firstPassUnknown,
    bulbs: board.lightable.reduce((a, c) => a + (board.open[c] === BULB ? 1 : 0), 0),
  };
}

export function makePuzzle(seed, tierId, { tries = 240 } = {}) {
  const tier = tierById(tierId);
  const w = tier.size, h = tier.size;
  const base = `${seed}|${tier.id}|${w}`;
  const rng = makeRng(base);
  // Distance to the band, so a search that runs out of tries still reports the board that
  // came closest to the tier's intended difficulty instead of the flukiest hard one.
  const offBand = (score) => (score < tier.band[0] ? tier.band[0] - score : Math.max(0, score - tier.band[1]));
  let best = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    const wall = noiseWalls(rng, w, h, tier.density);
    if (!wall) continue;
    const placed = placeBulbs(w, h, wall, rng);
    if (!placed) continue;
    const full = cluesFrom(w, h, wall, placed.bulbs);
    const clue = pruneClues(w, h, wall, full, rng, {
      fraction: tier.prune,
      accept: (a, b, c, d) => !!solvableByPencil(a, b, c, d),
    });
    const board = createBoard(w, h, wall, clue);
    const result = solve(board);
    if (!result.solved) continue;
    const g = grade(result, board);
    const dist = offBand(g.score);
    if (!best || dist < best.dist || (dist === best.dist && g.score > best.g.score)) {
      best = { board, result, g, attempt, dist, solution: placed.bulbs };
    }
    if (!dist) break;
  }
  if (!best) return null;
  let clues = 0;
  for (let i = 0; i < best.board.n; i++) if (best.board.wall[i] && best.board.clue[i] >= 0) clues++;
  const nameRng = makeRng(`${base}|name`);
  return {
    w, h,
    wall: best.board.wall,
    clue: best.board.clue,
    solution: best.solution,
    seed: base,
    originSeed: seed,
    tier: tier.id,
    name: `${nameRng.pick(NAME_A)}${nameRng.pick(NAME_B)}`,
    score: best.g.score,
    stats: { ...best.g, clues, attempts: best.attempt + 1, density: tier.density, inBand: best.dist === 0 },
  };
}

export { OPEN, BULB, MARK, at, createBoard, solve };
