// The load-bearing mechanism: the Akari board model and its pencil solver.
//
// Why segments are precomputed once: every rule below asks "how many bulbs / how many
// open cells does this run of lightable cells contain", and the answer must be the same
// for the solver, the hints, the generator's acceptance test and the on-screen conflict
// check. Deriving the runs lazily in four places is how they eventually disagree.
//
// A cell is identified by the pair (its horizontal run, its vertical run). Two bulbs may
// never share a run, and a cell is lit when either of its runs holds a bulb — so "light
// every cell" is a covering constraint over runs, and no rule needs to look at geometry
// again. Note what that implies and what it doesn't: a bulb shines *through* pencil
// marks, so marks never block light, and a run is NOT required to contain a bulb (its
// cells may all be lit from the crossing runs) — asserting either would be unsound.

export const OPEN = 0; // undetermined
export const BULB = 1;
export const MARK = 2; // pencil mark: a bulb may not go here

export const Rules = {
  clueNeed: '线索凑满',
  clueEmpty: '线索闭合',
  clueCluster: '线索成组',
  seeBulb: '灯光直照',
  onlySource: '唯一光源',
  nishio: '反证',
};

// Rule strength, highest first: the hint engine quotes the hardest rule that fires, so a
// board that only falls to 反证 reads as harder than one finished off by 线索闭合.
export const RuleWeight = {
  [Rules.nishio]: 4,
  [Rules.onlySource]: 3,
  [Rules.clueCluster]: 2,
  [Rules.clueNeed]: 1,
  [Rules.clueEmpty]: 0,
  [Rules.seeBulb]: 0,
};

export function at(w, i) {
  return `${(((i / w) | 0) + 1)}行${(i % w) + 1}列`;
}

function buildRuns(w, h, wall) {
  const runs = [];
  const hs = new Int32Array(w * h).fill(-1);
  const vs = new Int32Array(w * h).fill(-1);
  // dir 0 walks down a column (i = b*w + a), dir 1 walks along a row (i = a*w + b). The slot
  // names follow the geometry, not the loop order: a column run is the *vertical* one, and a
  // renderer that guesses from `dir` gets every beam rotated a quarter turn.
  for (let dir = 0; dir < 2; dir++) {
    const lane = dir === 0 ? w : h;
    const along = dir === 0 ? h : w;
    const slot = dir === 0 ? vs : hs;
    for (let a = 0; a < lane; a++) {
      let cells = [];
      for (let b = 0; b <= along; b++) {
        const i = dir === 0 ? b * w + a : a * w + b;
        if (b < along && !wall[i]) {
          cells.push(i);
          continue;
        }
        if (cells.length) {
          const id = runs.length;
          runs.push({ dir, cells: Int32Array.from(cells) });
          for (const c of cells) slot[c] = id;
        }
        cells = [];
      }
    }
  }
  return { runs, hs, vs };
}

// Numbered walls that touch the same cells are one constraint, not two. Reading them
// together is what lets 1-2 pairs force cells neither clue forces alone.
function buildClusters(board, adj) {
  const clues = [];
  for (let i = 0; i < board.n; i++) if (board.wall[i] && board.clue[i] >= 0) clues.push(i);
  const parent = new Map(clues.map((c) => [c, c]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const byCell = new Map();
  for (const c of clues) {
    for (const nb of adj[c]) {
      if (byCell.has(nb)) {
        const a = find(c), b = find(byCell.get(nb));
        if (a !== b) parent.set(a, b);
      } else byCell.set(nb, c);
    }
  }
  const groups = new Map();
  for (const c of clues) {
    const root = find(c);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(c);
  }
  const out = [];
  for (const members of groups.values()) {
    const cells = new Set();
    for (const c of members) for (const nb of adj[c]) cells.add(nb);
    out.push({ clues: Int32Array.from(members), cells: Int32Array.from(cells) });
  }
  return out;
}

export function createBoard(w, h, wall, clue) {
  const n = w * h;
  const { runs, hs, vs } = buildRuns(w, h, wall);
  const adj = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (!wall[i] || clue[i] < 0) continue;
    const x = i % w, y = (i / w) | 0;
    const list = [];
    if (x > 0 && !wall[i - 1]) list.push(i - 1);
    if (x + 1 < w && !wall[i + 1]) list.push(i + 1);
    if (y > 0 && !wall[i - w]) list.push(i - w);
    if (y + 1 < h && !wall[i + w]) list.push(i + w);
    adj[i] = Int32Array.from(list);
  }
  const board = {
    w, h, n, wall, clue, runs, hs, vs, adj,
    open: new Uint8Array(n).fill(OPEN),
    lightable: Int32Array.from(Array.from({ length: n }, (_, i) => i).filter((i) => !wall[i])),
  };
  board.clusters = buildClusters(board, adj);
  return board;
}

function tallies(board) {
  const bulbs = new Int32Array(board.runs.length);
  const open = new Int32Array(board.runs.length);
  for (let r = 0; r < board.runs.length; r++) {
    for (const c of board.runs[r].cells) {
      const s = board.open[c];
      if (s === BULB) bulbs[r]++;
      else if (s === OPEN) open[r]++;
    }
  }
  return { bulbs, open };
}

export function isLit(board, i, bulbs) {
  return bulbs[board.hs[i]] > 0 || bulbs[board.vs[i]] > 0;
}

// Places that could still hold a bulb inside `run`: a run already lit has none, since a
// second bulb there is illegal by the rules of the game.
function hosts(board, run, tally) {
  if (tally.bulbs[run] > 0) return [];
  const out = [];
  for (const c of board.runs[run].cells) if (board.open[c] === OPEN) out.push(c);
  return out;
}

export function candidates(board, cell, tally) {
  const seen = [];
  for (const run of [board.hs[cell], board.vs[cell]]) {
    for (const p of hosts(board, run, tally)) if (!seen.includes(p)) seen.push(p);
  }
  return seen;
}

// Every write goes through here so a rule can never "quietly" contradict another one.
// `events` is what the hint engine and the test oracle read: each carries the rule name
// that justified it, which is why an explanation can never be invented after the fact.
function commit(board, events, cells, value, rule) {
  const written = [];
  for (const c of cells) {
    if (board.open[c] === value) continue;
    if (board.open[c] !== OPEN) {
      return { conflict: `${rule}：${at(board.w, c)} 已被另一种记号占住` };
    }
    board.open[c] = value;
    written.push(c);
  }
  if (written.length) events.push({ rule, cells: written, value });
  return { changed: written.length };
}

function clueRules(board, events) {
  let changed = 0;
  for (let i = 0; i < board.n; i++) {
    if (!board.wall[i] || board.clue[i] < 0) continue;
    const list = board.adj[i];
    let need = board.clue[i];
    const open = [];
    for (const c of list) {
      if (board.open[c] === BULB) need--;
      else if (board.open[c] === OPEN) open.push(c);
    }
    if (need < 0 || need > open.length) {
      return { conflict: `线索 ${board.clue[i]} 在 ${at(board.w, i)}：还差 ${need} 盏，可放格只剩 ${open.length}` };
    }
    if (!open.length) continue;
    const rule = need === 0 ? Rules.clueEmpty : need === open.length ? Rules.clueNeed : null;
    if (!rule) continue;
    const r = commit(board, events, open, need === 0 ? MARK : BULB, rule);
    if (r.conflict) return r;
    changed += r.changed;
  }

  // Clue clusters: enumerate the admissible bulb subsets of the cells that feed a group
  // of touching clues. A cell present in every subset must be a bulb, one in none can be
  // marked — that is the whole content of the rule, and it costs one 2^k sweep per pass.
  for (const cl of board.clusters) {
    if (cl.clues.length < 2) continue;
    const open = [];
    for (const c of cl.cells) if (board.open[c] === OPEN) open.push(c);
    if (!open.length || open.length > 12) continue;
    const targets = [];
    for (const cell of cl.clues) {
      let have = 0;
      for (const c of board.adj[cell]) if (board.open[c] === BULB) have++;
      // `targets` is the clue's own value, and a candidate subset is counted the same way
      // (already-placed bulbs included), so the two must never be mixed scales.
      if (have > board.clue[cell]) return { conflict: `线索 ${board.clue[cell]} 在 ${at(board.w, cell)} 已被超出` };
      targets.push(board.clue[cell]);
    }
    const inCluster = new Map(open.map((c, k) => [c, k]));
    const ok = (mask) => {
      for (let k = 0; k < cl.clues.length; k++) {
        let n = 0;
        for (const c of board.adj[cl.clues[k]]) {
          if (board.open[c] === BULB) n++;
          else if (board.open[c] === OPEN) {
            const p = inCluster.get(c);
            if (p !== undefined && mask & (1 << p)) n++;
          }
        }
        if (n !== targets[k]) return false;
      }
      // Two cells of the chosen set must never share a run.
      for (let a = 0; a < open.length; a++) {
        if (!(mask & (1 << a))) continue;
        for (let b = a + 1; b < open.length; b++) {
          if (!(mask & (1 << b))) continue;
          if (board.hs[open[a]] === board.hs[open[b]] || board.vs[open[a]] === board.vs[open[b]]) return false;
        }
      }
      return true;
    };
    let total = 0;
    const hits = open.map(() => 0);
    for (let mask = 0; mask < 1 << open.length; mask++) {
      if (!ok(mask)) continue;
      total++;
      for (let k = 0; k < open.length; k++) if (mask & (1 << k)) hits[k]++;
    }
    if (!total) return { conflict: `线索成组在 ${at(board.w, cl.clues[0])} 无可行摆法` };
    // A cell in every admissible arrangement is a bulb; one in none can be marked.
    const forced = open.filter((_, k) => hits[k] === total);
    const banned = open.filter((_, k) => hits[k] === 0);
    if (forced.length) {
      const r = commit(board, events, forced, BULB, Rules.clueCluster);
      if (r.conflict) return r;
      changed += r.changed;
    }
    if (banned.length) {
      const r = commit(board, events, banned, MARK, Rules.clueCluster);
      if (r.conflict) return r;
      changed += r.changed;
    }
  }
  return { changed };
}

// One pass of every rule. Order does not affect the fixed point (each rule only ever
// writes what its own justification forces), but it decides which rule a hint cites
// first, so the cheap rules run before the expensive covering rule.
function pass(board, events) {
  const t = tallies(board);

  const cr = clueRules(board, events);
  if (cr.conflict) return cr;

  // A bulb makes its whole two runs bulb-free.
  for (let i = 0; i < board.n; i++) {
    if (board.open[i] !== BULB) continue;
    const cells = [];
    for (const run of [board.hs[i], board.vs[i]]) {
      for (const c of board.runs[run].cells) if (c !== i && board.open[c] === OPEN) cells.push(c);
    }
    const r = commit(board, events, cells, MARK, Rules.seeBulb);
    if (r.conflict) return r;
  }

  // An unlit cell must be reached from one of its two runs. If the set of places that
  // could reach it has one member, that cell is a bulb — this is the rule that carries a
  // puzzle after the clues run dry, so it is also the difficulty signal.
  //
  // The tally is updated as bulbs are written, not read once per pass: a candidate set
  // computed before a sibling cell got its bulb is *larger* than the real one, and "only
  // one place left" decided from a stale superset can light a cell that is already lit by
  // a bulb placed moments earlier — an unforced write wearing a rule's clothes.
  const after = tallies(board);
  for (const c of board.lightable) {
    if (board.open[c] !== OPEN) continue;
    if (isLit(board, c, after.bulbs)) continue;
    const seen = candidates(board, c, after);
    if (!seen.length) return { conflict: `${at(board.w, c)} 再也照不亮了` };
    if (seen.length === 1) {
      const r = commit(board, events, [seen[0]], BULB, Rules.onlySource);
      if (r.conflict) return r;
      if (r.changed) {
        after.bulbs[board.hs[seen[0]]]++;
        after.bulbs[board.vs[seen[0]]]++;
      }
    }
  }
  return { changed: 1 };
}

function unitSweep(board, events, maxPasses) {
  let passes = 0;
  for (; passes < maxPasses; passes++) {
    const before = events.length;
    const r = pass(board, events);
    if (r.conflict) return { conflict: r.conflict, passes };
    if (events.length === before) break;
  }
  return { passes };
}

// 反证 (nishio): "put a bulb here and the board becomes impossible — so no bulb goes
// here", and its mirror "leave this cell empty and something can never be lit — so it must
// hold a bulb". Both are proofs, not guesses, and they are the technique Akari is actually
// finished with once the visible counts run out: without them even a fully-clued 10×10
// stalls, because every single cell still has several possible light sources.
//
// The bulb-assumption direction is the productive one — a hypothetical bulb deletes whole
// runs of candidates, which is what makes another cell's source unique. Marking alone
// rarely contradicts anything, so both directions are tried per cell.
//
// It is deliberately kept out of the inner loop: unit propagation runs to its own fixed
// point first, and this only fires when that has stalled, so a board's nishio count is a
// real difficulty reading rather than an artefact of the search order.
function nishioSearch(board, { trials = 400, depth = 12 } = {}) {
  const snapshot = board.open.slice();
  let tried = 0;
  for (const c of board.lightable) {
    if (tried++ >= trials) break;
    if (board.open[c] !== OPEN) continue;
    for (const assume of [BULB, MARK]) {
      board.open.set(snapshot);
      board.open[c] = assume;
      const probe = [];
      const r = unitSweep(board, probe, depth);
      if (r.conflict) {
        board.open.set(snapshot);
        return { cell: c, value: assume === BULB ? MARK : BULB, why: r.conflict };
      }
    }
  }
  board.open.set(snapshot);
  return null;
}

export function solve(board, { maxPasses = 100, useNishio = true, nishioTrials = 400 } = {}) {
  const events = [];
  const ruleUse = {};
  let passes = 0;
  let conflict = null;
  for (let round = 0; round < 500; round++) {
    const before = events.length;
    const u = unitSweep(board, events, maxPasses);
    passes += u.passes;
    if (u.conflict) { conflict = u.conflict; break; }
    for (const e of events.slice(before)) ruleUse[e.rule] = (ruleUse[e.rule] || 0) + 1;
    let left = 0;
    for (const c of board.lightable) if (board.open[c] === OPEN) left++;
    if (!left || !useNishio) break;
    const n = nishioSearch(board, { trials: nishioTrials });
    if (!n) break;
    board.open[n.cell] = n.value;
    events.push({ rule: Rules.nishio, cells: [n.cell], value: n.value, why: n.why });
    ruleUse[Rules.nishio] = (ruleUse[Rules.nishio] || 0) + 1;
  }
  const undetermined = [];
  for (const c of board.lightable) if (board.open[c] === OPEN) undetermined.push(c);
  const t = tallies(board);
  const unlit = [];
  for (const c of board.lightable) if (!isLit(board, c, t.bulbs)) unlit.push(c);
  let deepest = 0;
  for (const e of events) deepest = Math.max(deepest, RuleWeight[e.rule] || 0);
  return {
    events,
    ruleUse,
    passes,
    conflict,
    undetermined,
    unlit,
    bulbs: t.bulbs,
    deepest,
    nishio: ruleUse[Rules.nishio] || 0,
    solved: !conflict && !undetermined.length && !unlit.length && !verify(board, t).length,
  };
}

// The independent legality check: what a finish must satisfy, written straight from the
// rules of the game rather than from the solver's bookkeeping.
export function verify(board, tallyIn) {
  const t = tallyIn || tallies(board);
  const bad = [];
  for (let r = 0; r < board.runs.length; r++) if (t.bulbs[r] > 1) bad.push(`同一线上有两盏灯`);
  for (const c of board.lightable) if (!isLit(board, c, t.bulbs)) bad.push(`${at(board.w, c)} 没被照亮`);
  for (let i = 0; i < board.n; i++) {
    if (!board.wall[i] || board.clue[i] < 0) continue;
    let k = 0;
    for (const c of board.adj[i]) if (board.open[c] === BULB) k++;
    if (k !== board.clue[i]) bad.push(`${at(board.w, i)} 线索 ${board.clue[i]} 实为 ${k}`);
  }
  return bad;
}

// The next single deduction the player could make, as {rule, cells, value, why}. This is
// the same code path the acceptance sweep runs, which is what makes "hints are always
// correct" and "the board needs no guessing" one property instead of two.
export function nextDeduction(board, { useNishio = true } = {}) {
  const snapshot = board.open.slice();
  const events = [];
  const r = pass(board, events);
  board.open.set(snapshot);
  if (r.conflict) return { conflict: r.conflict };
  if (events.length) {
    let best = events[0];
    for (const e of events) if ((RuleWeight[e.rule] || 0) > (RuleWeight[best.rule] || 0)) best = e;
    return best;
  }
  if (!useNishio) return null;
  const n = nishioSearch(board);
  if (!n) return null;
  return { rule: Rules.nishio, cells: [n.cell], value: n.value, why: n.why };
}

export { tallies, hosts, pass };
