// 难度实测台. Reads the difficulty of each tier off generated boards — it does not set it.
//
// The numbers printed here are what TIERS[].band is supposed to contain. Changing grade()
// without re-running this is how a band becomes decoration and the README's measured table
// becomes a lie.

import { performance } from 'node:perf_hooks';
import { TIERS, makePuzzle, grade, solvableByPencil } from '../js/engine/generate.js';
import { createBoard, solve, verify, BULB, MARK } from '../js/engine/akari.js';
import { cluesFrom } from '../js/engine/fill.js';
import { countSolutions, UNIQUE } from '../js/engine/count.js';

const N = Number(process.env.SAMPLES || 40);

// 退出码就是结论。下面四段（阶梯 / 穷举复核 / 复解一致 / 填灯器合法性）以前只打印不表态，
// 所以任何一句「✗」都留 rc=0，doctest 的 D3a「balance 现场跑就是绿的」永远为真。
const fails = [];

function q(sorted, p) {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

let worst = 0;
const ladder = [];
for (const tier of TIERS) {
  const scores = [];
  const passes = [];
  const nishio = [];
  const only = [];
  const clues = [];
  let accepted = 0;
  let attempts = 0;
  let ms = 0;
  let inBand = 0;
  for (let s = 0; s < N; s++) {
    const t0 = performance.now();
    const p = makePuzzle(`balance|${s}`, tier.id);
    ms += performance.now() - t0;
    if (!p) continue;
    accepted++;
    if (p.stats.inBand) inBand++;
    attempts += p.stats.attempts;
    scores.push(p.score);
    passes.push(p.stats.passes);
    nishio.push(p.stats.nishio);
    only.push(p.stats.onlySource);
    clues.push(p.stats.clues);
  }
  // A tier that ships no board at all still prints a full row of NaN quantiles, and the
  // ladder below treats `accepted === 0` as a pass — the empty tier is invisible unless
  // this arm says it out loud.
  if (!accepted) fails.push(`${tier.label} 在 ${N} 个候选里一个盘都没出 —— 这一档的表是空的`);
  const sort = (a) => a.slice().sort((x, y) => x - y);
  const line = (label, arr, fmt = (v) => v) => {
    const a = sort(arr);
    console.log(`    ${label.padEnd(10)} p25 ${fmt(q(a, 0.25))}  中位 ${fmt(q(a, 0.5))}  p75 ${fmt(q(a, 0.75))}  max ${fmt(a[a.length - 1])}`);
  };
  console.log(`\n${tier.label} ${tier.size}×${tier.size}  (密度 ${tier.density}，留线索约 ${Math.round((1 - tier.prune) * 100)}%，目标分 ${tier.band[0]}–${tier.band[1]})`);
  console.log(`    出题成功率 ${accepted}/${N}，命中目标区间 ${inBand}/${accepted}，平均每档尝试 ${(attempts / Math.max(1, accepted)).toFixed(1)} 次，耗时 ${(ms / N).toFixed(0)} ms/局`);
  line('分数', scores, (v) => (v || 0).toFixed(1));
  line('pass 数', passes);
  line('唯一光源', only);
  line('反证', nishio);
  line('线索数', clues);
  ladder.push({ label: tier.label, median: q(sort(scores), 0.5) || 0, inBand, accepted });
  worst = Math.max(worst, ms / N);
}

// The ladder is the product promise: 见习 must read easier than 大师, and a tier that never
// lands in its own band means the band is decoration.
console.log('\n== 档位阶梯（中位分数必须单调，命中率不能是个位数）==');
{
  let prev = -Infinity;
  let mono = true;
  for (const l of ladder) {
    const okScore = l.median > prev;
    const okHit = l.accepted === 0 || l.inBand / l.accepted >= 0.8;
    if (!okScore || !okHit) mono = false;
    console.log(`  ${okScore && okHit ? '✓' : '✗'} ${l.label} 中位 ${l.median.toFixed(1)}  命中区间 ${l.inBand}/${l.accepted}`);
    prev = l.median;
  }
  console.log(mono ? '  阶梯成立' : '  阶梯不成立：band 需要重测');
  if (!mono) fails.push('档位阶梯不成立：某一档中位不比上一档高，或命中率低于八成');
}

// Cross-check: the pencil solver says "one solution, reachable"; the exhaustive counter is
// allowed to disagree and must not. Capped budgets count as "unverified", never as "ok".
console.log('\n== 独立计数复核（穷举解数，与小盘面口径一致）==');
const crossTiers = TIERS.slice(0, 3);
let tried = 0;
let checked = 0;
let bad = 0;
for (const tier of crossTiers) {
  for (let s = 0; s < 6; s++) {
    tried++;
    const p = makePuzzle(`cross|${s}`, tier.id);
    if (!p) continue;
    const c = countSolutions(p.w, p.h, p.wall, p.clue, { budget: 300000 });
    checked++;
    if (c.status !== UNIQUE) {
      bad++;
      console.log(`  ✗ ${tier.label} seed ${s}: 穷举解数 ${c.status === UNIQUE ? 1 : c.solutions}（铅笔求解器判定唯一）`);
    }
  }
}
console.log(`  ${checked - bad}/${checked} 局穷举复核与铅笔判定一致`);
// 复核的分子和分母一起缩水时，上面那行照样读成「k/k 一致」，所以这里对的是尝试过的盘数。
if (checked !== tried) fails.push(`穷举复核只解了 ${checked}/${tried} 盘 —— 出题器返回 null，这一轮的复核变窄了`);
if (bad) fails.push(`${bad}/${checked} 盘铅笔判定唯一、穷举判定不唯一`);

// A second, independent read on grade(): re-solving the accepted board must reproduce the
// same score, or the score is a property of the generator's state and not of the board.
{
  let drift = 0;
  let made = 0;
  for (const tier of TIERS) {
    const p = makePuzzle(`drift|1`, tier.id);
    if (!p) continue;
    made++;
    const board = createBoard(p.w, p.h, p.wall, Int8Array.from(p.clue));
    const r = solve(board);
    const g = grade(r, board);
    if (!r.solved || g.score !== p.score) { drift++; console.log(`  ✗ ${tier.label} 复解不一致`, r.solved, g.score, p.score); }
  }
  console.log(`  复解一致：${TIERS.length - drift}/${TIERS.length} 档`);
  // 这一段的分母是 TIERS.length 而不是出题成功数：漏一档就会打红字，但漏掉的那档此前无声。
  if (made !== TIERS.length) fails.push(`复解只覆盖了 ${made}/${TIERS.length} 档 —— 出题器对某档返回 null`);
  if (drift) fails.push(`${drift} 档复解出来的分数和出货分数不一致 —— 分数不是盘面的性质`);
}

// Sanity for the filler itself: whatever it produces must pass the rules-of-the-game check
// that has nothing to do with how it was built.
{
  let total = 0;
  let broken = 0;
  let missed = 0;
  for (let s = 0; s < 60; s++) {
    const p = makePuzzle(`filler|${s}`, 'apprentice');
    if (!p) { missed++; continue; }
    // Check the filler's output against the rules of the game, using the *full* clue set:
    // a pruned clue only ever loosens the count, so a board that verifies here verifies
    // under whatever subset of clues ships.
    const full = cluesFrom(p.w, p.h, p.wall, p.solution);
    const board = createBoard(p.w, p.h, p.wall, full);
    for (const c of board.lightable) board.open[c] = p.solution[c] ? BULB : MARK;
    total++;
    const bad = verify(board);
    if (bad.length) { broken++; if (broken <= 3) console.log('  ✗ 填灯器产出不合法:', bad.slice(0, 2).join('; ')); }
  }
  console.log(`  填灯器产出的盘面合法：${total - broken}/${total}`);
  if (broken) fails.push(`${broken}/${total} 个填灯器产出的盘面过不了游戏本身的规则检查`);
  if (missed) fails.push(`填灯器有 ${missed} 个候选没出盘（返回 null），这一段的样本变窄了`);
}

console.log(`\n最慢档位 ${(worst).toFixed(0)} ms/局`);

fails.forEach((f) => console.log(`FAIL balance: ${f}`));
process.exit(fails.length ? 1 : 0);
