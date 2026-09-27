// The playable state machine: what a tap does, what an undo takes back, when a board counts
// as solved, and what a hint is allowed to say.
//
// Two deliberate bindings to js/engine/akari.js:
//   * cell states live in `board.open`, the same array the solver reads. A renderer with its
//     own copy of the board is how a lit cell and a "must be a bulb" cell drift apart.
//   * the win check is the engine's independent `verify()`, written from the rules of the
//     game rather than from this file's bookkeeping, so "the UI said I won" and "the board is
//     legal" cannot both be true and disagree.

import {
  createBoard,
  verify,
  tallies,
  isLit,
  nextDeduction,
  at,
  OPEN,
  BULB,
  MARK,
  Rules,
} from '../engine/akari.js';

export { OPEN, BULB, MARK };

// Per-cell diagnostics for the renderer. This is the same arithmetic `verify()` does, only
// kept per-cell instead of per-board because a player needs to see *which* lamp is wrong —
// the verdict itself still comes from verify().
function diagnose(board) {
  const t = tallies(board);
  const conflict = new Set();
  for (let r = 0; r < board.runs.length; r++) {
    if (t.bulbs[r] < 2) continue;
    for (const c of board.runs[r].cells) if (board.open[c] === BULB) conflict.add(c);
  }
  const clueBad = new Set();
  const clueDone = new Set();
  for (let i = 0; i < board.n; i++) {
    if (!board.wall[i] || board.clue[i] < 0) continue;
    let k = 0;
    for (const c of board.adj[i]) if (board.open[c] === BULB) k++;
    if (k === board.clue[i]) clueDone.add(i);
    else if (k > board.clue[i]) clueBad.add(i);
  }
  const unlit = new Set();
  for (const c of board.lightable) if (!isLit(board, c, t.bulbs)) unlit.add(c);
  // Lamps are counted per cell, not per lit run: one bulb sits at the crossing of two runs,
  // so a run-based tally would read 2 灯 for the first lamp the player places.
  let lampCount = 0;
  for (const c of board.lightable) if (board.open[c] === BULB) lampCount++;
  return { conflict, clueBad, clueDone, unlit, tally: t, bulbs: lampCount };
}

export class Game {
  constructor(puzzle) {
    this.puzzle = puzzle;
    this.w = puzzle.w;
    this.h = puzzle.h;
    this.board = createBoard(puzzle.w, puzzle.h, puzzle.wall, Int8Array.from(puzzle.clue));
    this.steps = [];
    this.moves = 0;
    this.hints = 0;
    this.status = 'playing';
    this.mode = 'bulb';
    this.lastHint = null;
    this.recompute();
  }

  recompute() {
    this.diag = diagnose(this.board);
    return this.diag;
  }

  cellAt(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    return y * this.w + x;
  }

  isLightable(c) {
    return c >= 0 && !this.board.wall[c];
  }

  valueFor(mode) {
    return mode === 'mark' ? MARK : BULB;
  }

  // One committed action: `writes` are the cells it touched, recorded with their prior state
  // so undo is an exact reverse rather than a re-derivation.
  commit(writes, kind) {
    if (!writes.length) return null;
    const step = { writes, kind };
    this.steps.push(step);
    if (kind === 'hint') this.hints++;
    else this.moves++;
    this.recompute();
    this.checkWin();
    return step;
  }

  setCell(c, value) {
    if (!this.isLightable(c) || this.status === 'won') return null;
    if (this.board.open[c] === value) return null;
    const from = this.board.open[c];
    this.board.open[c] = value;
    return this.commit([{ cell: c, from, to: value }], 'tap');
  }

  tap(c, mode = this.mode) {
    if (!this.isLightable(c) || this.status === 'won') return null;
    const want = this.valueFor(mode);
    // One predictable rule for both modes: tapping the mark that is already there erases it,
    // tapping anything else puts this mode's mark there.
    return this.setCell(c, this.board.open[c] === want ? OPEN : want);
  }

  // A drag paints one value. Cells the drag passes over are set, never toggled — otherwise
  // sweeping back across your own line erases it mid-gesture. The whole gesture is one step,
  // so 撤销 undoes a stroke rather than a pixel of it. The caller picks the value (which is
  // OPEN when the gesture started on an already-marked cell, i.e. an erase stroke).
  stroke(cells, value) {
    if (this.status === 'won') return null;
    const writes = [];
    const seen = new Set();
    for (const c of cells) {
      if (!this.isLightable(c) || seen.has(c)) continue;
      seen.add(c);
      if (this.board.open[c] === value) continue;
      writes.push({ cell: c, from: this.board.open[c], to: value });
      this.board.open[c] = value;
    }
    return this.commit(writes, 'stroke');
  }

  // Restoring a saved board. Walls and clues are re-generated from the origin seed, so a
  // resume only has to replay the player's own marks — and nothing here counts as a move,
  // because the run's cost comes from the save instead.
  load(states) {
    for (const c of this.board.lightable) {
      const v = states[c];
      this.board.open[c] = v === BULB || v === MARK ? v : OPEN;
    }
    this.recompute();
    this.checkWin();
    return this;
  }

  undo() {
    const step = this.steps.pop();
    if (!step) return null;
    for (const w of step.writes) this.board.open[w.cell] = w.from;
    // A hint that is taken back is still a hint that was taken: records rank runs by help
    // used, so refunding the counter would let a player undo their way to a clean 0. Only a
    // hand-made step can be un-made.
    if (step.kind !== 'hint') this.moves = Math.max(0, this.moves - 1);
    this.recompute();
    return step;
  }

  // The engine's own next step, so a hint can only ever be a deduction the board actually
  // supports — and if there is none, the hint costs nothing and says so.
  hint() {
    if (this.status === 'won') return null;
    const d = nextDeduction(this.board);
    if (d && d.conflict) return { conflict: d.conflict };
    if (!d) return { stalled: true, text: '当前没有可推导的格：棋盘需要的是重新想一遍，不是提示。' };
    const writes = [];
    for (const c of d.cells) {
      if (this.board.open[c] === d.value) continue;
      if (this.board.open[c] !== OPEN) continue;
      writes.push({ cell: c, from: OPEN, to: d.value });
      this.board.open[c] = d.value;
    }
    this.commit(writes, 'hint');
    const info = {
      rule: d.rule,
      value: d.value,
      cells: writes.map((w) => w.cell),
      why: d.why || describe(d, this.board),
      charged: true,
    };
    this.lastHint = info;
    return info;
  }

  checkWin() {
    const bad = verify(this.board, this.diag.tally);
    if (bad.length) return false;
    let left = 0;
    for (const c of this.board.lightable) if (this.board.open[c] === OPEN) left++;
    if (left) return false;
    this.status = 'won';
    return true;
  }

  // Only used by the verification harness and the "看解" affordance: drive the player's own
  // solver to its end. It goes through hint(), so it can never light a cell the pencil
  // rules would not justify.
  solveWithLogic({ cap = 400 } = {}) {
    let k = 0;
    while (this.status !== 'won' && k++ < cap) {
      const before = this.steps.length;
      const h = this.hint();
      if (!h || h.stalled || h.conflict) break;
      if (this.steps.length === before) break;
    }
    return { status: this.status, steps: k };
  }

  state() {
    return {
      tier: this.puzzle.tier,
      name: this.puzzle.name,
      seed: this.puzzle.seed,
      originSeed: this.puzzle.originSeed,
      moves: this.moves,
      hints: this.hints,
      status: this.status,
      bulbs: this.diag.bulbs,
      conflicts: this.diag.conflict.size,
      unlit: this.diag.unlit.size,
      open: this.board.lightable.filter((c) => this.board.open[c] === OPEN).length,
      steps: this.steps.length,
    };
  }
}

// A hint has to say something a player can act on. The text is composed from the deduction
// the engine just made (rule, cells, board), never from a template picked after the fact.
function describe(d, board) {
  const where = d.cells.map((c) => at(board.w, c)).join('、');
  const what = d.value === BULB ? '必须放灯' : '不能放灯';
  if (d.rule === Rules.clueEmpty) return `${where}${what}：这处线索的灯已经凑满。`;
  if (d.rule === Rules.clueNeed) return `${where}${what}：线索要求的数量，正好等于还能放的空格数量。`;
  if (d.rule === Rules.clueCluster) return `${where}${what}：相邻的几处线索共用这些格，能同时满足它们的摆法只有这一种。`;
  if (d.rule === Rules.seeBulb) return `${where}${what}：这条线上已经有一盏灯。`;
  if (d.rule === Rules.onlySource) return `${where}${what}：这些空格里只剩一处能照亮还没亮的格。`;
  return `${where}${what}。`;
}
