// Engine unit tests, run in plain Node: `node tools/engine-test.mjs`.
//
// The risk in this repo is not arithmetic but *soundness*: one rule that wrote a cell the
// rules of the game do not force, and every generated board would still ship, the hints would
// still be self-consistent, and the whole "no guessing" promise would be a caption on a coin
// flip. So the deductions below are checked against boards worked out by hand and against
// expectations written as literals — never against the solver's own output.

import {
  createBoard,
  solve,
  verify,
  nextDeduction,
  tallies,
  pass as passOnce,
  isLit,
  at,
  Rules,
  OPEN,
  BULB,
  MARK,
} from '../js/engine/akari.js';
import { countSolutions, UNIQUE, NONE } from '../js/engine/count.js';
import { TIERS, tierById, makePuzzle, grade } from '../js/engine/generate.js';
import { Game } from '../js/ui/game.js';
import { Store } from '../js/store.js';

let pass = 0;
let fail = 0;
const eq = (name, got, want) => {
  if (String(got) === String(want)) pass++;
  else {
    fail++;
    console.log(`  FAIL ${name}\n       got  ${got}\n       want ${want}`);
  }
};
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

const board = (w, h, wall, clue = []) =>
  createBoard(w, h, Uint8Array.from(wall), (() => {
    const c = new Int8Array(w * h).fill(-1);
    for (const [i, v] of clue) c[i] = v;
    return c;
  })());

// ---------- geometry ----------

const clueArray = (n, pairs) => {
  const c = new Int8Array(n).fill(-1);
  for (const [i, v] of pairs) c[i] = v;
  return c;
};


{
  const b = board(3, 1, [1, 0, 1]);
  eq('墙把横线切断，只剩中间一段', b.runs.filter((r) => r.dir === 1).length, 1);
  eq('中间那格自有一条纵线', b.runs.filter((r) => r.dir === 0).length, 1);
  eq('可点亮的格只剩中间', b.lightable.length, 1);
  eq('坐标按行、列读', at(3, 0), '1行1列');
}

// ---------- a 1-cell run forces its own bulb ----------

{
  const b = board(3, 1, [1, 0, 1]);
  const r = solve(b);
  ok('单格线唯一光源成立', r.solved, JSON.stringify(r.conflict));
  eq('单格线放了一盏灯', b.open[1], BULB);
  eq('穷举计数也认为是唯一解', countSolutions(3, 1, Uint8Array.from([1, 0, 1]), b.clue).status, UNIQUE);
}

// ---------- clue 0 marks, and marks still have to be lit ----------

{
  const b = board(3, 1, [1, 0, 0], [[0, 0]]);
  const r = solve(b);
  ok('0 号线索的链条能纯逻辑走完', r.solved, r.conflict || `${r.undetermined.length} 格未定`);
  eq('墙旁的空格被划掉', b.open[1], MARK);
  eq('剩下的空格必须放灯', b.open[2], BULB);
  ok('划掉的格也被照亮：铅笔不挡光', isLit(b, 1, tallies(b).bulbs));
  eq('独立合法性检查无话可说', verify(b).length, 0);
}

// ---------- a run is NOT required to hold a bulb ----------

{
  // 2×3, wall at index 3 with clue 2 → both neighbours (0 and 4) must be bulbs; cells 2 and 5
  // then share a vertical run that holds nothing, yet both are lit from their rows.
  const b = board(3, 2, [0, 0, 0, 1, 0, 0], [[3, 2]]);
  const r = solve(b);
  ok('这盘能推到底', r.solved, r.conflict || `${r.undetermined.length} 格未定`);
  const t = tallies(b);
  const empty = t.bulbs.findIndex((n, run) => n === 0 && b.runs[run].dir === 0 && b.runs[run].cells.length === 2);
  ok('存在一条没有灯的纵线', empty >= 0);
  ok('那条线上的格仍被照亮', empty >= 0 && b.runs[empty].cells.every((c) => isLit(b, c, t.bulbs)));
  eq('求解器没有因此多放灯', b.open.reduce((a, v) => a + (v === BULB ? 1 : 0), 0), 2);
  eq('穷举复核唯一', countSolutions(3, 2, b.wall, b.clue).status, UNIQUE);
}

// ---------- two bulbs on one run is a conflict, not a win ----------

{
  const b = board(3, 1, [0, 0, 0]);
  b.open[0] = BULB;
  b.open[2] = BULB;
  ok('同线两盏灯被抓到', verify(b).some((m) => m.includes('同一线上')));
  // The whole corridor painted with lamps is the "looks finished, is not" case: no rule that
  // reads "every cell has something in it" can catch it, only the run check can.
  const full = board(3, 1, [0, 0, 0]);
  for (const c of full.lightable) full.open[c] = BULB;
  eq('满盘点灯的独立检查报冲突', verify(full).length > 0, true);
  eq('满盘点灯不是解', solve(board(3, 1, [0, 0, 0])).solved, false);
}

// ---------- clues that touch are one constraint ----------

{
  // 2×2, walls on the diagonal, both clue 1: cells 0 and 3 each feed both clues, so exactly one
  // of them is a bulb — the clues alone cannot say which.
  const wall = [0, 1, 1, 0];
  const clue = [[1, 1], [2, 1]];
  const b = board(2, 2, wall, clue);
  eq('两处线索被并成一组', b.clusters.filter((cl) => cl.clues.length === 2).length, 1);
  // Hand-check the shape: each of the two walls sees both open cells, so the clues alone allow
  // "bulb at 0" or "bulb at 3". But each cell lights only itself here (the walls cut every run
  // to one cell), so a solution needs bulbs at both — which over-satisfies both clues. The
  // board is unsolvable, and the two independent engines must both say so.
  const cnt = countSolutions(2, 2, Uint8Array.from(wall), clueArray(4, clue));
  eq('穷举判定这盘无解', cnt.solutions, 0);
  eq('无解被写成无解而不是多解', cnt.status, NONE);
  ok('铅笔求解器也没有把它判成有解', !solve(board(2, 2, wall, clue)).solved);

  // Regression: the enumeration counts bulbs already on the board in the same units as the
  // clue value. Mix the scales and a satisfied cluster answers "无可行摆法" — which this repo
  // hit on 57 of 60 boards before the fix.
  const b3 = board(2, 2, wall, clue);
  b3.open[0] = BULB;
  const ev3 = [];
  const r3 = passOnce(b3, ev3);
  ok('已放的灯不会被成组规则当成矛盾', !r3.conflict, r3.conflict || '');
  ok('线索被满足后另一格划掉', b3.open[3] === MARK, `${b3.open[3]}`);

  // The 1-2 pair: 3×3 with walls at index 1 (clue 1) and index 3 (clue 2). Their open
  // neighbours are s=0, m=4, x=2 for the first and s=0, m=4, y=6 for the second, and x is
  // already marked. Clue 1 wants one of {s,m}; clue 2 wants two of {s,m,y}. Neither clue can
  // decide alone, but y is in every admissible arrangement — only the cluster sees that.
  const b4 = board(3, 3, [0, 1, 0, 1, 0, 0, 0, 0, 0], [[1, 1], [3, 2]]);
  b4.open[2] = MARK;
  eq('两处线索共用两格', b4.clusters.filter((cl) => cl.clues.length === 2).length, 1);
  const ev4 = [];
  passOnce(b4, ev4);
  const cluster = ev4.find((e) => e.rule === Rules.clueCluster && e.value === BULB);
  ok('成组规则单独指出必放的格', !!cluster && cluster.cells.includes(6), JSON.stringify(ev4.map((e) => [e.rule, e.cells])));
  ok('那一格不是别的规则先说的', !ev4.some((e) => e.rule !== Rules.clueCluster && e.cells.includes(6)));
}

// ---------- 反证 has to be the rule that finishes the hardest tier ----------

{
  let found = null;
  for (let s = 0; s < 30 && !found; s++) {
    const p = makePuzzle(`nishio|${s}`, 'master');
    if (!p) continue;
    const plain = solve(createBoard(p.w, p.h, p.wall, Int8Array.from(p.clue)), { useNishio: false });
    if (plain.solved || plain.conflict) continue;
    const b = createBoard(p.w, p.h, p.wall, Int8Array.from(p.clue));
    const full = solve(b);
    if (full.solved && full.nishio > 0) found = { p, n: full.nishio, stalled: plain.undetermined.length, b };
  }
  ok('有一局大师盘只能靠反证收口', !!found);
  if (found) {
    ok('不用反证时它确实卡住', found.stalled > 0, `${found.stalled} 格未定`);
    eq('反证补完之后独立检查无话可说', verify(found.b, tallies(found.b)).length, 0);
    ok('反证写下的格带着矛盾的理由', found.p.stats.nishio >= 0);
  }
}

// ---------- generated boards keep the three promises ----------

{
  const p = makePuzzle('unit|gen', 'regular');
  ok('同一颗种子复现同一张图', makePuzzle('unit|gen', 'regular').seed === p.seed);
  let mismatch = 0;
  for (let i = 0; i < p.wall.length; i++) {
    if (!p.wall[i] || p.clue[i] < 0) continue;
    let k = 0;
    const x = i % p.w, y = (i / p.w) | 0;
    if (x > 0 && p.solution[i - 1]) k++;
    if (x + 1 < p.w && p.solution[i + 1]) k++;
    if (y > 0 && p.solution[i - p.w]) k++;
    if (y + 1 < p.h && p.solution[i + p.w]) k++;
    if (k !== p.clue[i]) mismatch++;
  }
  eq('出货数字与那盏解的邻灯数一致', mismatch, 0);
  const b = createBoard(p.w, p.h, p.wall, Int8Array.from(p.clue));
  for (const c of b.lightable) b.open[c] = p.solution[c] ? BULB : MARK;
  eq('填出来的灯盘通过独立检查', verify(b).length, 0);
  const r = solve(createBoard(p.w, p.h, p.wall, Int8Array.from(p.clue)));
  ok('出货盘面能被铅笔解完', r.solved, r.conflict || `${r.undetermined.length} 格未定`);
  eq('复解分数与出货分数一致', grade(r, createBoard(p.w, p.h, p.wall, Int8Array.from(p.clue))).score, p.score);
  const band = tierById(p.tier).band;
  ok('出货落在本档实测区间', p.score >= band[0] && p.score <= band[1], `${p.score} 不在 ${band}`);
  ok('解数被独立穷举确认（老手盘）', countSolutions(p.w, p.h, p.wall, p.clue, { budget: 300000 }).status === UNIQUE);
}

{
  const counts = TIERS.map((t) => {
    const p = makePuzzle(`ladder|${t.id}`, t.id);
    return p ? p.score : NaN;
  });
  ok('五档分数单调递增', counts.every((v, i) => i === 0 || v > counts[i - 1]), counts.join(' → '));
}

// ---------- the play layer: one gesture = one undo, and help is never refunded ----------

{
  // nextDeduction is what a hint previews: it must report a step without taking it.
  const p = makePuzzle('unit|next', 'trainee');
  const b = createBoard(p.w, p.h, p.wall, Int8Array.from(p.clue));
  const before = Array.from(b.open).join('');
  const d = nextDeduction(b);
  eq('预告下一步不会偷偷改盘', Array.from(b.open).join(''), before);
  ok('预告里有规则名和格子', !!d && !!d.rule && d.cells.length > 0, JSON.stringify(d));
}

{
  const p = makePuzzle('unit|play', 'trainee');
  const g = new Game(p);
  const start = p.solution.findIndex((v, i) => v && !p.wall[i]);
  eq('开局没有步数', g.state().moves, 0);
  g.tap(start, 'bulb');
  eq('一次点击记一步', g.state().moves, 1);
  eq('点击落下的是灯', g.board.open[start], BULB);
  g.undo();
  eq('撤销带走那一步', g.state().moves, 0);
  eq('撤销后格子是空的', g.board.open[start], OPEN);

  const stroke = [start, p.solution.findIndex((v, i) => v && !p.wall[i] && i !== start)];
  g.stroke(stroke, BULB);
  eq('一整笔只算一步', g.state().moves, 1);
  eq('一笔落下两盏灯', g.board.open[stroke[0]] === BULB && g.board.open[stroke[1]] === BULB, true);
  // 灯数按格计，不按被点亮的线计：一盏灯站在横纵两条线的交点上，按线数会读成两盏。
  eq('灯数读数是灯的实际颗数', g.state().bulbs, 2);
  g.undo();
  ok('撤销整笔把两盏都带走', g.board.open[stroke[0]] === OPEN && g.board.open[stroke[1]] === OPEN);

  // A wall is not a cell: clicking it must not create a step.
  const wallCell = p.wall.findIndex((v) => v);
  eq('点在墙上没有反应', g.tap(wallCell, 'bulb'), null);
  eq('点在墙上不多记一步', g.state().moves, 0);
}

{
  const p = makePuzzle('unit|hint', 'trainee');
  const g = new Game(p);
  const h = g.hint();
  ok('提示给出的是规则名', !!h && !!h.rule, JSON.stringify(h));
  ok('提示的格子确实被写了', h && g.board.open[h.cells[0]] === h.value);
  ok('提示文案带着规则的依据', h && h.why.length > 4, (h && h.why) || '');
  eq('提示计入求助次数', g.state().hints, 1);
  eq('提示不算玩家的一步', g.state().moves, 0);
  g.undo();
  eq('撤销提示不退款', g.state().hints, 1);
}

{
  // Covering the whole board with lamps is the classic "looks finished, is not" case.
  const p = makePuzzle('unit|flood', 'trainee');
  const g = new Game(p);
  for (const c of g.board.lightable) g.board.open[c] = BULB;
  g.recompute();
  ok('满盘点灯被抓为冲突', g.state().conflicts > 0);
  eq('满盘点灯不算赢', g.checkWin(), false);
  eq('满盘点灯没有落定胜利状态', g.status, 'playing');
}

{
  const p = makePuzzle('unit|logic', 'apprentice');
  const g = new Game(p);
  const r = g.solveWithLogic();
  eq('只吃提示也能把这盘推完', r.status, 'won');
  eq('推完之后独立检查无话可说', verify(g.board).length, 0);
  ok('每一步提示都写了格', g.state().hints > 0);
}

// ---------- storage: the run's cost travels with the board ----------

{
  Store.reset();
  const p = makePuzzle('unit|store', 'regular');
  Store.saveResume(p, new Uint8Array(p.w * p.h).fill(MARK), 61_000, { moves: 9, hints: 2 });
  const r = Store.resume();
  eq('存档带上步数', r.moves, 9);
  eq('存档带上提示数', r.hints, 2);
  eq('存档带计时', r.elapsedMs, 61000);
  eq('游程编码往返一致', r.board.reduce((a, v) => a + v), MARK * p.w * p.h);
  eq('存档记的是原始种子', r.seed, p.originSeed);

  eq('首个纪录直接成立', Store.recordBest('regular', { ms: 50000, hints: 1, moves: 20, size: '10×10' }), true);
  eq('更快但更靠提示的不算破纪录', Store.recordBest('regular', { ms: 1000, hints: 2, moves: 5, size: '10×10' }), false);
  eq('同样求助次数下省步数的算破纪录', Store.recordBest('regular', { ms: 60000, hints: 1, moves: 12, size: '10×10' }), true);
  eq('步数也相同时才比时间', Store.recordBest('regular', { ms: 90000, hints: 1, moves: 12, size: '10×10' }), false);
  eq('纪录里存的是最好的那一次', Store.best('regular').moves, 12);
  Store.clearResume();
  eq('清档之后没有续局', Store.resume(), null);
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
