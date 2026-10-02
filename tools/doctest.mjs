// 文档是被断言的面：README / DESIGN 里印出去的每一个「现值」都必须等于代码或本仓闸的现在值。
//
// 为什么要有这个文件：这个仓的文档里印着 五档 / 六条规则 / 8×8 / 4–10 / 8.5 / 40/40 / 18/18 /
// 60/60 / 77 项 / 154 项 / 5247 / 5173 / 30 万 / 2^12 / 18–52 px。引擎断言由 tools/engine-test.mjs
// 复测、难度读数由 tools/balance.mjs 复测、画面读数由 tools/scenarios.js 复测 —— 只有
// "文档抄的数 == 代码或闸的现值"这一条没有命令守着。散文可以一直抄下去，直到某天代码改了字、
// 文档还在引用上一个世界的数。
//
// 五条规矩（照 z-biz-game-kurotto-cos / z-biz-game-nurikabe-cos 的 doctest 机制走，不自创一套）：
//   1. 每一条等式都配一条「解析到几行」的反空转断言 —— 正则没命中不是绿，是红；
//   2. 只比现值，不复测读数：ms/秒这类本机墙钟量在这里只以「方向 + 文档自己写明这一列会漂」
//      的关系出现（D14），绝不重新计时，也绝不把新测的毫秒写回文档；能逐位复现的结构数字
//      （分位、入选、断言数、档位、band、端口、行数、常量）才比数值 —— 而且用**仓自己的工具**
//      （balance / engine-test）现场跑一遍再对表，不是拿文档当基准；
//   3. 文档改形状（表格列、句子措辞、引用格式）不算通过的理由：解析不到就是红；
//   4. 引用 `file:NN` 的每一条都跑一次范围与锚点检查 —— 只要代码改一个字，行号就漂；
//   5. 本闸自己发出的组数与项数都自钉 —— 加一项、删一项都得同时改这里的钉，否则红。
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TIERS } from '../js/engine/generate.js';
import { Rules, RuleWeight } from '../js/engine/akari.js';
import { Cell } from '../js/theme.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
// 行数一律按 wc -l 的口径（末尾换行不另计一行），否则文档里那些数与现算差一个常数
const lines = (s) => (s.endsWith('\n') ? s.split('\n').length - 1 : s.split('\n').length);
const lineCount = (p) => lines(read(p));

// 本闸的自钉（D16 与 verify.sh 的 LOGIC_EXPECTS 都读这两个数）：改一项就要改这里，否则红。
const EXPECT_GROUPS = 16;
const EXPECT_ROWS = 165; // 首次跑出来是多少就是多少，之后由它守体量

const fail = [];
const emitted = new Set();
let rows = 0;
const ok = (cond, label, detail) => {
  rows++;
  const m = label.match(/^D\d+/);
  if (!m) throw new Error(`断言标签必须以 D<N> 开头：${label}`);
  emitted.add(m[0]);
  if (!cond) fail.push(label);
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label} · ${detail}`);
};
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const num = (s) => Number(String(s).replace(/,/g, ''));
const TIER_LABELS = TIERS.map((t) => t.label);

const README = read('README.md');
const DESIGN = read('DESIGN.md');
const DOCS = README + '\n' + DESIGN;
const CI = read('.github/workflows/ci.yml');
const VERIFY = read('tools/verify.sh');
const PKG = JSON.parse(read('package.json'));
const BAL_SRC = read('tools/balance.mjs');
const ENG_SRC = read('tools/engine-test.mjs');
const SAB_SRC = existsSync(join(ROOT, 'tools/sabotage.mjs')) ? read('tools/sabotage.mjs') : '';
const SCEN = read('tools/scenarios.js');
const GEN_SRC = read('js/engine/generate.js');
const AKARI_SRC = read('js/engine/akari.js');
const COUNT_SRC = read('js/engine/count.js');
const STORE_SRC = read('js/store.js');
const THEME_SRC = read('js/theme.js');
const HTML = read('index.html');
const SERVER_SRC = read('server.cjs');

const run = (cmd, env, ms) => {
  const r = spawnSync('bash', ['-c', cmd], { cwd: ROOT, encoding: 'utf8', timeout: ms, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } });
  return { rc: r.status === null ? -1 : r.status, out: (r.stdout || '') + (r.stderr || '') };
};
// 本闸用**仓自己的工具**做现值来源 —— balance 与 engine-test 都是纯逻辑跑，秒级，不开浏览器
const BAL = run('node tools/balance.mjs', {}, 180000);
const ENG = run('node tools/engine-test.mjs', {}, 120000);

// ---- D1 档位表：README 那五行逐格等于 TIERS 现值（档名/盘面/墙密度/留线索/目标分）----
const tierRows = [...README.matchAll(/^\| (见习|熟练|老手|专家|大师) \| (\d+)×(\d+) \| ([\d.]+) \| ~(\d+)% \| ([\d.]+)–([\d.]+) \| ([\d.]+) \| (\d+)\/(\d+) \| (\d+) \| (\d+) \|$/gm)];
ok(tierRows.length === TIERS.length, `D1a README 难度表解析到 ${TIERS.length} 行（解析不到不等于通过：表格形状改了就是红）`,
  `解析 ${tierRows.length} 行 vs TIERS ${TIERS.length} 档`);
for (const t of TIERS) {
  const row = tierRows.find((m) => m[1] === t.label);
  ok(!!row, `D1 ${t.label}（${t.id}）那一行在文档的档位表里`, row ? `| ${row[1]} | ${row[2]}×${row[3]} |` : '文档里没有这一档');
  if (!row) continue;
  ok(+row[2] === t.size && +row[3] === t.size, `D1b ${t.label} 的盘面 ${row[2]}×${row[3]} == TIERS 现值 size ${t.size}`,
    `文档 ${row[2]}×${row[3]} vs 代码 ${t.size}×${t.size}`);
  ok(+row[4] === t.density, `D1c ${t.label} 的墙密度 ${row[4]} == TIERS 现值 density ${t.density}`,
    `文档 ${row[4]} vs 代码 ${t.density}`);
  ok(+row[5] === Math.round((1 - t.prune) * 100), `D1d ${t.label} 的留线索 ~${row[5]}% == round((1-prune)×100)（prune=${t.prune}，balance 同款口径）`,
    `文档 ~${row[5]}% vs 代码 ${Math.round((1 - t.prune) * 100)}%`);
  ok(+row[6] === t.band[0] && +row[7] === t.band[1], `D1e ${t.label} 的目标分 ${row[6]}–${row[7]} == TIERS 现值 band [${t.band}]`,
    `文档 ${row[6]}–${row[7]} vs 代码 [${t.band}]`);
}
const shared = DESIGN.match(/相邻档共享边界（见习上限 ([\d.]+)、熟练下限 ([\d.]+)）/) || [];
ok(shared.length === 3 && +shared[1] === TIERS[0].band[1] && +shared[2] === TIERS[1].band[0],
  `D1f DESIGN 那句「见习上限 ${shared[1] || '未解析'}、熟练下限 ${shared[2] || '?'}」== TIERS 现值 ${TIERS[0].band[1]} / ${TIERS[1].band[0]}`,
  `文档 ${shared[1]}/${shared[2]} vs 代码 ${TIERS[0].band[1]}/${TIERS[1].band[0]}`);
const tierMentions = [...DOCS.matchAll(/(^|[^这每上下相同相该第哪])([一二三四五六七八九十]) ?档/g)].map((m) => CN[m[2]]).filter(Boolean);
ok(tierMentions.length >= 4 && tierMentions.every((v) => v === TIERS.length),
  `D1g 文档里所有「N 档」都等于 ${TIERS.length}（解析到 ${tierMentions.length} 处；冒出别的档位数字就是这里红）`, tierMentions.join('/'));

// ---- D2 六条铅笔规则：Rules 现值 == 文档「六条」== index.html 的规则说明逐条同字 ----
const ruleNames = Object.values(Rules);
const docSix = [...DOCS.matchAll(/([一二三四五六七八九十]) ?条(?:铅笔规则|规则的入门说明)/g)].map((m) => CN[m[1]]);
ok(docSix.length >= 2 && docSix.every((v) => v === ruleNames.length),
  `D2a 文档里所有「N 条铅笔规则 / N 条规则的入门说明」都等于 Rules 现值 ${ruleNames.length}（解析 ${docSix.length} 处：${docSix.join('/')}）`,
  `Rules ${ruleNames.length} 条`);
const htmlRuleItems = [...HTML.matchAll(/<li><b>([^<]+)<\/b>：/g)].map((m) => m[1]);
const htmlRuleSet = [...new Set(htmlRuleItems)];
ok(htmlRuleSet.length === ruleNames.length, `D2b index.html 的规则说明解析到 ${htmlRuleSet.length} 个不重复名字（应等于 Rules 的 ${ruleNames.length} 条）`,
  htmlRuleSet.join(' / '));
ruleNames.forEach((name, i) => {
  ok(htmlRuleSet[i] === name, `D2c 第 ${i + 1} 条规则「${name}」在 index.html 里逐字同、且顺序与 Rules 现值一致`,
    `代码 ${name} vs 页面 ${htmlRuleSet[i] || '解析不到'}`);
});
ok(Object.keys(RuleWeight).length === ruleNames.length, `D2d RuleWeight 给每一条规则都配了强度（${Object.keys(RuleWeight).length} 条 vs Rules ${ruleNames.length} 条）`,
  `RuleWeight ${Object.keys(RuleWeight).length} · Rules ${ruleNames.length}`);
const strongest = Object.entries(RuleWeight).sort((a, b) => b[1] - a[1])[0];
ok(strongest[0] === Rules.nishio, 'D2e DESIGN §3 说「只用反证收尾的盘读起来更难」—— RuleWeight 现值确实把反证排在第一',
  `最强=${strongest[0]}(${strongest[1]})`);
const gameRuleItems = (README.slice(README.indexOf('规则口径'), README.indexOf('## 五档')).match(/^\d+\. /gm) || []);
ok(gameRuleItems.length === 5, `D2f README「规则口径」的编号条目解析到 ${gameRuleItems.length} 条（游戏规则 5 条与铅笔规则 6 条是两件事；!=5 就是列表被改）`,
  `${gameRuleItems.length} 条`);
const inferences = [...DESIGN.slice(0, DESIGN.indexOf('## 2')).matchAll(/^(\d+)\. \*\*(铅笔叉不挡光|一条线不要求有自己的灯)\*\*/gm)];
ok(inferences.length === 2, `D2g DESIGN §1「两条推论」解析到 ${inferences.length} 条（模型的反直觉推论，正好对上 akari.js 头注的两个否定）`,
  inferences.map((m) => m[2]).join(' / '));
ok(/marks never block light/.test(AKARI_SRC) && /run is NOT required to contain a bulb/.test(AKARI_SRC),
  'D2h 那两条推论在引擎头注里是代码级承诺（marks never block light / a run is NOT required to contain a bulb），不是文档单方面说的',
  `两条都在=${/marks never block light/.test(AKARI_SRC) && /run is NOT required/.test(AKARI_SRC)}`);

// ---- D3 balance 的实测表：文档那五行的中位/入选/唯一光源/反证全部由 balance 现场跑出来对 ----
ok(BAL.rc === 0, `D3a balance 现场跑就是绿的（rc=${BAL.rc}）—— 不绿的读数不是现值`, `rc=${BAL.rc}`);
const bal = {};
let cur = null;
for (const ln of BAL.out.split('\n')) {
  const h = ln.match(/^(见习|熟练|老手|专家|大师) (\d+)×(\d+)  \(密度 ([\d.]+)，留线索约 (\d+)%，目标分 ([\d.]+)–([\d.]+)\)$/);
  if (h) { cur = h[1]; bal[cur] = { size: +h[2], density: h[4], keep: +h[5], band: `${h[6]}–${h[7]}` }; continue; }
  if (!cur) continue;
  const s = ln.match(/^\s*出题成功率 (\d+)\/(\d+)，命中目标区间 (\d+)\/(\d+)，平均每档尝试 ([\d.]+) 次，耗时 (\d+) ms\/局$/);
  if (s) { Object.assign(bal[cur], { accepted: `${s[1]}/${s[2]}`, inBand: `${s[3]}/${s[4]}`, attempts: +s[5], ms: +s[6] }); continue; }
  const q = ln.match(/^\s*(分数|pass 数|唯一光源|反证|线索数)\s+p25 (\S+)  中位 (\S+)  p75 (\S+)  max (\S+)$/);
  if (q) {
    const key = { 分数: 'score', 'pass 数': 'passes', 唯一光源: 'only', 反证: 'nishio', 线索数: 'clues' }[q[1]];
    bal[cur][key] = { p25: q[2], med: q[3], p75: q[4], max: q[5] };
  }
}
ok(Object.keys(bal).length === TIERS.length, `D3b balance 的分位表解析到 ${Object.keys(bal).length} 行（每档一行；解析不到就是 balance 换了列名或措辞）`,
  Object.keys(bal).join('/'));
for (const m of tierRows) {
  const b = bal[m[1]];
  ok(!!b, `D3 ${m[1]} 在 balance 的现场表里还在`, b ? '在' : 'balance 打印里没有这一档');
  if (!b) continue;
  ok(+m[8] === +b.score.med, `D3c ${m[1]} 实测中位 ${m[8]} == balance 现场分数中位 ${b.score.med}`, `文档 ${m[8]} vs balance ${b.score.med}`);
  ok(`${m[9]}/${m[10]}` === b.inBand, `D3d ${m[1]} 入选 ${m[9]}/${m[10]} == balance 现场「命中目标区间」${b.inBand}（分母是每档 N 局，不是命中数）`,
    `文档 ${m[9]}/${m[10]} vs balance ${b.inBand}`);
  ok(+m[11] === +b.only.med, `D3e ${m[1]} 唯一光源次数 ${m[11]} == balance 现场中位 ${b.only.med}`, `文档 ${m[11]} vs balance ${b.only.med}`);
  ok(+m[12] === +b.nishio.med, `D3f ${m[1]} 反证次数 ${m[12]} == balance 现场中位 ${b.nishio.med}`, `文档 ${m[12]} vs balance ${b.nishio.med}`);
  ok(+m[2] === b.size && +m[4] === +b.density && +m[5] === b.keep && `${m[6]}–${m[7]}` === b.band,
    `D3g ${m[1]} 的盘面/密度/留线索/目标分四格与 balance 自己那一行表头同源`, `${m[2]}×${m[2]} ${m[4]} ~${m[5]}% ${m[6]}–${m[7]}`);
}
const designMed = DESIGN.match(/中位 ([\d.]+) → ([\d.]+) → ([\d.]+) → ([\d.]+) → ([\d.]+)/);
const designMedArr = designMed ? designMed.slice(1).map(Number) : [];
ok(designMedArr.length === TIERS.length && TIER_LABELS.every((l, i) => designMedArr[i] === +bal[l].score.med),
  `D3h DESIGN §4 那句五连中位 ${designMedArr.join('→') || '解析不到'} == balance 现场逐档中位`,
  `balance ${TIER_LABELS.map((l) => bal[l] && bal[l].score.med).join('→')}`);
const designHit = DESIGN.match(/现在五档 ([\d/]+) 命中（老手 ([\d/]+)）/) || [];
ok(designHit.length === 3 && designHit[1] === bal.见习.inBand && designHit[2] === bal.老手.inBand,
  `D3i DESIGN 那句「五档 ${designHit[1] || '?'} 命中（老手 ${designHit[2] || '?'}）」== balance 现场`,
  `文档 ${designHit[1]}/${designHit[2]} vs balance ${bal.见习 && bal.见习.inBand} / ${bal.老手 && bal.老手.inBand}`);

// ---- D4 复核、阶梯、抽盘次数：都由 balance 现场跑出来对（抽盘次数是结构数字，ms 不是）----
const cross = BAL.out.match(/^\s*(\d+)\/(\d+) 局穷举复核与铅笔判定一致$/m) || [];
ok(cross.length === 3 && +cross[1] === +cross[2], `D4a balance 的穷举复核读数自相一致（${cross[1]}/${cross[2]}：每档 6 局 × 覆盖的档数）`, cross.slice(1).join('/'));
const docCross = README.match(/穷举复核：\*\*(\d+)\/(\d+) 局\*\*/);
ok(!!docCross && docCross[0].includes(`${cross[1]}/${cross[2]}`), `D4b README「穷举复核：N/N 局」== balance 现场 ${cross[1]}/${cross[2]}`,
  `README ${docCross ? `${docCross[1]}/${docCross[2]}` : '解析不到'}`);
const docRun18 = DESIGN.match(/复核在 `balance\.mjs` 里跑 (\d+) 局/);
ok(!!docRun18 && +docRun18[1] === +cross[1], `D4c DESIGN §2「这条复核在 balance.mjs 里跑 N 局」== balance 现场 ${cross[1]} 局`,
  `DESIGN ${docRun18 ? docRun18[1] : '解析不到'}`);
const refix = BAL.out.match(/复解一致：(\d+)\/(\d+) 档/) || [];
ok(refix.length === 3 && +refix[1] === +refix[2] && +refix[2] === TIERS.length,
  `D4d 复解一致 ${refix.slice(1).join('/')} 档 == TIERS 现值 ${TIERS.length} 档（README 那句「五档的复解全部一致」的数）`, refix.slice(1).join('/'));
const filler = BAL.out.match(/填灯器产出的盘面合法：(\d+)\/(\d+)/) || [];
const docFiller = README.match(/填灯器产出的 (\d+)\/(\d+) 个盘面合法/);
ok(filler.length === 3 && !!docFiller && docFiller[1] === filler[1] && docFiller[2] === filler[2],
  `D4e README「填灯器产出的 N/N 个盘面合法」== balance 现场 ${filler.slice(1).join('/')}`, `README ${docFiller ? `${docFiller[1]}/${docFiller[2]}` : '解析不到'}`);
const fillerSamples = (BAL_SRC.match(/for \(let s = 0; s < (\d+); s\+\+\) \{\s*const p = makePuzzle\(`filler\|\$\{s\}`/) || [])[1];
ok(+fillerSamples === +filler[2], `D4f 那 ${filler[2]} 局的样本量写在 balance 源码里（filler 循环上界 ${fillerSamples || '?'}）而不是文档手抄`, `BAL_SRC 循环上界=${fillerSamples}`);
ok(/阶梯成立/.test(BAL.out) && TIER_LABELS.every((l, i) => i === 0 || +bal[l].score.med > +bal[TIER_LABELS[i - 1]].score.med),
  'D4g balance 的档位阶梯门禁现场成立（中位严格单调）—— 文档「五档由浅入深」有闸背书', TIER_LABELS.map((l) => bal[l] && bal[l].score.med).join('<'));
const slowest = TIER_LABELS.slice().sort((a, b) => bal[b].ms - bal[a].ms)[0];
const docSlow = README.match(/最慢档位 \*\*(\d+) ms\/局\*\*（([^，]+)，含 (\d+) 次尝试）/);
ok(slowest === '大师' && !!docSlow && docSlow[2] === '大师',
  `D4h 「最慢档位是大师」只比方向：balance 现场 argmax = ${slowest}，文档也写大师（绝对毫秒不进门禁，见 D14）`,
  TIER_LABELS.map((l) => `${l}:${bal[l].ms}ms`).join(' '));
const masterAtt = Math.floor(bal.大师.attempts);
ok(!!docSlow && +docSlow[3] === masterAtt && +docSlow[1] > 0,
  `D4i README 那句「含 ${docSlow ? docSlow[3] : '?'} 次尝试」== balance 现场 floor(大师平均尝试)=${masterAtt}（同一句里的 ms 是墙钟读数，只钉方向）`,
  `balance ${bal.大师.attempts} 次`);
const docDraw = DESIGN.match(/大师档平均要抽 (\d+) 次盘[\s\S]*?见习档为了\*\*压低\*\*分数要抽 (\d+) 次/) || [];
ok(docDraw.length === 3 && +docDraw[1] === Math.floor(bal.大师.attempts) && +docDraw[2] === Math.floor(bal.见习.attempts),
  `D4j DESIGN §8 的抽盘次数（大师 ${docDraw[1]} / 见习 ${docDraw[2]}）== balance 现场 ${bal.大师.attempts} / ${bal.见习.attempts}`,
  `文档 ${docDraw.slice(1).join(' / ')}`);
const triesSrc = (GEN_SRC.match(/\{ tries = (\d+) \}/) || [])[1];
ok(!!triesSrc && +triesSrc === 240 && DESIGN.includes('`tries: 240`'), `D4k DESIGN 说的抽盘上限 tries: 240 == makePuzzle 的默认 tries=${triesSrc}`,
  `generate.js tries=${triesSrc}`);

// ---- D5 引擎断言数：README 与 DESIGN 抄的 77 项 == engine-test 现场跑 ----
const engLine = ENG.out.match(/^(\d+) 通过 \/ (\d+) 失败$/m);
ok(!!engLine && ENG.rc === 0, `D5a engine-test 现场跑 rc=${ENG.rc} 且打了「N 通过 / M 失败」那一句`, engLine ? `${engLine[1]} 通过 / ${engLine[2]} 失败` : '解析不到');
const engPass = engLine ? +engLine[1] : -1;
ok(engLine && +engLine[2] === 0, `D5b engine-test 现场 0 失败（有失败时本闸不复测其读数，只报现跑）`, `fail=${engLine ? engLine[2] : '?'}`);
const docAssertions = [...DOCS.matchAll(/引擎断言 (\d+) 项|(\d+) 项引擎断言/g)].map((m) => +(m[1] || m[2]));
ok(docAssertions.length >= 2 && docAssertions.every((v) => v === engPass),
  `D5c README 与 DESIGN 的「引擎断言 N 项」都等于 engine-test 现跑的 ${engPass}（解析 ${docAssertions.length} 处：${docAssertions.join('/')}）`,
  `现跑 ${engPass}`);
const engTail = lineOfAt('tools/engine-test.mjs', /console\.log\(`\\n\$\{pass\} 通过/);
ok(engTail > 0 && ENG_SRC.split('\n').slice(engTail - 1, engTail + 1).join('\n').includes('process.exit(fail ? 1 : 0)'),
  `D5d engine-test 的结论行与退出码解析到了（第 ${engTail} 行）—— 本闸读的就是这个出口，它换了形状就是这里红`,
  `tools/engine-test.mjs:${engTail}`);

// ---- D6 端口：README == verify.sh == package.json == server.cjs == ci.yml 五处口径 ----
const httpWant = (VERIFY.match(/^HTTP=\$\{HTTP_PORT:-(\d+)\}/m) || [])[1];
const cdpWant = (VERIFY.match(/^PORT=\$\{CDP_PORT:-(\d+)\}/m) || [])[1];
const devM = (PKG.scripts?.dev || '').match(/server\.cjs\s+(\d+)/);
const startDefault = (SERVER_SRC.match(/Number\(process\.argv\[2\]\) \|\| Number\(process\.env\.PORT\) \|\| (\d+)/) || [])[1];
ok(!!httpWant && !!cdpWant && !!devM && !!startDefault,
  `D6a 四处端口都解析到（verify HTTP ${httpWant} · CDP ${cdpWant} · package dev ${devM && devM[1]} · server 默认 ${startDefault}）`,
  `verify=${httpWant}/${cdpWant} · dev=${devM && devM[1]} · server=${startDefault}`);
const docDev = README.match(/本项目专用端口 (\d+)/);
ok(httpWant === devM?.[1] && !!docDev && +docDev[1] === +httpWant, `D6b HTTP 默认号三处同源：verify.sh ${httpWant} == package.json dev ${devM && devM[1]} == README 明写的 ${docDev && docDev[1]}`,
  `verify=${httpWant} · dev=${devM && devM[1]} · 文档=${docDev && docDev[1]}`);
const docStart = (README.match(/零依赖静态服务 → http:\/\/127\.0\.0\.1:(\d+)/) || [])[1];
ok(!!docStart && +docStart === +startDefault, `D6c README 那句「npm start → 127.0.0.1:${docStart || '?'}」== server.cjs 的默认端口 ${startDefault}`,
  `文档 ${docStart} vs 代码 ${startDefault}`);
ok(+cdpWant === 9349 && !/CDP[^0-9]{0,12}9[0-9]{3}/.test(DOCS),
  `D6d verify.sh 的 CDP 默认号 ${cdpWant} 是本仓自己的：文档没有另抄一个 CDP 号（改这里不会留下文档孤儿）`, `verify.sh PORT=${cdpWant}`);
const ciPort = (CI.match(/http\.server (\d+)/) || [])[1];
ok(!!ciPort && (CI.match(new RegExp(`127\\.0\\.0\\.1:${ciPort}`, 'g')) || []).length >= 3,
  `D6e ci.yml 前缀形态的临时端口 ${ciPort} 在起服务与三处探活里同值（只改其中一处就是这里红）`, `http.server ${ciPort}`);
ok(+httpWant !== +startDefault && VERIFY.includes(String(startDefault)),
  `D6f 起服务的两个号是刻意分开的两件事：verify.sh 的 ${httpWant} 与 npm start 的 ${startDefault} 不同，且 verify.sh 的注释里点名了 ${startDefault} 为什么不能用`,
  `verify=${httpWant} · server 默认=${startDefault}`);

// ---- D7 规模：README 那行「多少个模块 / 多少行」全部现算 ----
const listJs = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
  const p = `${dir}/${e.name}`;
  return e.isDirectory() ? listJs(p) : p.endsWith('.js') ? [p] : [];
});
const JS = listJs('js');
const jsLines = JS.reduce((a, f) => a + lineCount(f), 0);
const SCRIPTS = ['tools/balance.mjs', 'tools/engine-test.mjs', 'tools/doctest.mjs', 'tools/sabotage.mjs', 'tools/playtest.cjs', 'tools/scenarios.js', 'tools/verify.sh'];
const scriptLines = SCRIPTS.reduce((a, f) => a + lineCount(f), 0);
const styleLines = ['css/game.css', 'index.html'].reduce((a, f) => a + lineCount(f), 0);
const sizeDoc = README.match(/规模：(\d+) 个 ES Module \/ ([\d,]+) 行 JS \+ (\d+) 个验证脚本 \/ ([\d,]+) 行 \+ ([\d,]+) 行 CSS\/HTML，\*\*运行时依赖 (\d+) 个\*\*/) || [];
ok(sizeDoc.length === 7, `D7a README 的规模那一句解析成功（7 格；解析不到就是这句话被改写）`, sizeDoc.slice(1).join(' | ') || '未解析');
ok(+sizeDoc[1] === JS.length, `D7b ES Module 数 ${sizeDoc[1] || '?'} == 现数 js/**/*.js = ${JS.length} 个`, `文档 ${sizeDoc[1]} vs 磁盘 ${JS.length}`);
ok(num(sizeDoc[2]) === jsLines, `D7c 文档写的 js 行数 ${sizeDoc[2] || '?'} == 现算 ${jsLines}（${JS.length} 个文件逐个 wc 口径）`, `文档 ${sizeDoc[2]} vs 现算 ${jsLines}`);
ok(+sizeDoc[3] === SCRIPTS.length, `D7d 验证脚本数 ${sizeDoc[3] || '?'} == 本闸点名的 ${SCRIPTS.length} 个脚本`, `文档 ${sizeDoc[3]} vs 名单 ${SCRIPTS.length}`);
ok(num(sizeDoc[4]) === scriptLines, `D7e 验证脚本行数 ${sizeDoc[4] || '?'} == 现算 ${scriptLines}（含本闸与台账）`, `文档 ${sizeDoc[4]} vs 现算 ${scriptLines}`);
ok(num(sizeDoc[5]) === styleLines, `D7f CSS/HTML 行数 ${sizeDoc[5] || '?'} == 现算 css/game.css + index.html = ${styleLines}`, `文档 ${sizeDoc[5]} vs 现算 ${styleLines}`);
const rtDeps = Object.keys(PKG.dependencies || {}).length;
ok(+sizeDoc[6] === rtDeps && rtDeps === 0, `D7g 「运行时依赖 ${sizeDoc[6] || '?'} 个」== package.json 的 dependencies 现值 ${rtDeps} 个`,
  `文档 ${sizeDoc[6]} vs package ${rtDeps}`);
const moduleDocList = (README.slice(README.indexOf('## 目录'), README.indexOf('## 验证在验证什么')).match(/^js\/[\w./-]+/gm) || []);
ok(moduleDocList.length === JS.length, `D7h README「目录」里点名的 js 文件有 ${moduleDocList.length} 个 == 磁盘上的 ${JS.length} 个（新增模块必须同时写进目录）`,
  `目录 ${moduleDocList.length} · 磁盘 ${JS.length}`);

// ---- D8 浏览器场景表：verify.sh 默认集 == scenarios.js 注册表 == 文档抄的那七行 ----
const scenDefault = (VERIFY.match(/for s in \$\{SCENARIOS:-(.*?)\}/) || [, ''])[1].trim().split(/\s+/).filter(Boolean);
const registry = ((SCEN.match(/w\.__ng = \{([^}]+)\}/) || [])[1] || '').split(',').map((s) => s.trim()).filter(Boolean);
ok(scenDefault.length === 7 && registry.length === 7,
  `D8a 场景集解析到 ${scenDefault.length}（verify.sh 默认）/ ${registry.length}（scenarios.js 注册表），钉在 7`, `${scenDefault.join(' ')} || ${registry.join(' ')}`);
ok(scenDefault.join('|') === registry.join('|'), `D8b verify.sh 默认跑的 7 个场景与 scenarios.js 的注册名逐字同序`,
  `verify ${scenDefault.join(' ')} · registry ${registry.join(' ')}`);
const outRows = [...README.matchAll(/^=== (\w+) ===\s+(\d+) checks, (\d+) failed\s+(\{.*\})$/gm)].map((m) => ({ name: m[1], checks: +m[2], bad: +m[3], extra: m[4] }));
ok(outRows.length === scenDefault.length && outRows.every((r, i) => r.name === scenDefault[i]),
  `D8c README 贴的那份输出块有 ${outRows.length} 行场景，名字与顺序 == verify.sh 的默认场景集`, outRows.map((r) => r.name).join(' '));
const sumChecks = outRows.reduce((a, r) => a + r.checks, 0);
const docSums = [...DOCS.matchAll(/(\d+) 项断言/g)].map((m) => +m[1]);
ok(docSums.length >= 2 && docSums.every((v) => v === sumChecks),
  `D8d 文档两处「N 项断言」== README 那份输出块逐行相加 ${sumChecks}（两处文档与求和必须同值；改了任何一行读数就得同步）`, `${docSums.join('/')} vs Σ=${sumChecks}`);
ok(outRows.every((r) => r.bad === 0), `D8e README 那份输出块每一行都是 0 failed（抄一份带失败的历史输出就是红）`,
  outRows.map((r) => `${r.name}:${r.bad}`).join(' '));
const hintRow = outRows.find((r) => r.name === 'hint') || { extra: '' };
const saveRow = outRows.find((r) => r.name === 'save') || { extra: '' };
const docHints = (README.match(/(\d+) 次提示逐格核对/) || [])[1];
const hintsLive = +(hintRow.extra.match(/hintsGiven: (\d+)/) || [])[1];
ok(+docHints === hintsLive && hintsLive > 0, `D8f README 正文那句「${docHints} 次提示逐格核对」== 同一份输出块里 hint 场景报的 hintsGiven ${hintsLive}`,
  `正文 ${docHints} vs 输出块 ${hintsLive}`);
const docBytes = [...DOCS.matchAll(/(\d+) 字节能装下|(\d+) 字节\）/g)].map((m) => +(m[1] || m[2]));
const bytesLive = +(saveRow.extra.match(/storedBytes: (\d+)/) || [])[1];
ok(docBytes.length >= 2 && bytesLive > 0 && docBytes.every((v) => v === bytesLive),
  `D8g 文档两处「N 字节」（README 与 DESIGN §6）== 输出块 save 的 storedBytes ${bytesLive}（两处文档必须同值）`, `${docBytes.join('/')} vs ${bytesLive}`);
const resumeRow = outRows.find((r) => r.name === 'resume') || { extra: '' };
const docResumeName = (resumeRow.extra.match(/\{name: ([^,]+),/) || [])[1];
ok(!!docResumeName && DOCS.includes(docResumeName), `D8h 输出块 resume 那行的局名「${docResumeName}」在文档里也是同一颗种子跑出来的名字`,
  docResumeName || '解析不到');

// ---- D9 文档里的引擎常量口径：一句一个，都要坐在代码现值上 ----
const gradeDoc = DESIGN.match(/`grade\(\)` 的分数 = `pass 数 ×([\d.]+) \+ 唯一光源次数 ×([\d.]+) \+ 成组次数 ×([\d.]+) \+ 首遍未定比例 ×(\d+)`/) || [];
const gradeSrc = GEN_SRC.match(/result\.passes \* ([\d.]+) \+ only \* ([\d.]+) \+ cluster \* ([\d.]+)[\s\S]{0,120}?, 1\) \* (\d+)/) || [];
ok(gradeDoc.length === 5 && gradeSrc.length === 5 && gradeDoc.slice(1).join('|') === gradeSrc.slice(1).join('|'),
  `D9a DESIGN §4 的评分公式 ×${gradeDoc.slice(1).join(' / ×') || '?'} == generate.js grade() 现值`, `文档 ${gradeDoc.slice(1).join('/')} vs 代码 ${gradeSrc.slice(1).join('/')}`);
const clusterDoc = (DESIGN.match(/上限 `2\^(\d+)`/) || [])[1];
const clusterSrc = (AKARI_SRC.match(/open\.length > (\d+)/) || [])[1];
ok(!!clusterDoc && !!clusterSrc && +clusterDoc === +clusterSrc, `D9b DESIGN §8 的成组枚举上限 2^${clusterDoc || '?'} == akari.js 的 open.length > ${clusterSrc || '?'}`,
  `文档 2^${clusterDoc} vs 代码 ${clusterSrc}`);
const lonelyDoc = (DESIGN.match(/lonely > (\d+)%/) || [])[1];
const lonelySrc = (GEN_SRC.match(/lonely > wall\.length \* (0\.\d+)/) || [])[1];
ok(!!lonelyDoc && !!lonelySrc && +lonelyDoc === Math.round(+lonelySrc * 100), `D9c DESIGN 那句「lonely > ${lonelyDoc || '?'}% 直接丢弃」== generate.js 的 ${lonelySrc || '?'}`,
  `文档 ${lonelyDoc}% vs 代码 ${lonelySrc}`);
const budgetDoc = (DESIGN.match(/步数预算（默认 (\d+) 万）/) || [])[1];
const budgetSrc = (COUNT_SRC.match(/budget = (\d+)/) || [])[1];
ok(!!budgetDoc && !!budgetSrc && +budgetDoc * 10000 === +budgetSrc, `D9d DESIGN §8 的穷举预算「默认 ${budgetDoc || '?'} 万」== count.js 的 budget = ${budgetSrc || '?'}`,
  `文档 ${budgetDoc} 万 vs 代码 ${budgetSrc}`);
const statusDoc = (DESIGN.match(/判定值有([一二三四五六七八九十])个：`UNIQUE \/ MANY \/ NONE \/ OVERBUDGET`/) || [])[1];
const statusSrc = ['UNIQUE', 'NONE', 'MANY', 'OVERBUDGET'].filter((k) => new RegExp(`export const ${k} =`).test(COUNT_SRC));
ok(!!statusDoc && CN[statusDoc] === 4 && statusSrc.length === 4,
  `D9e DESIGN §2「判定值有${statusDoc || '?'}个」== count.js 现在导出的 ${statusSrc.length} 个（${statusSrc.join('/')}）`, `${CN[statusDoc]} vs ${statusSrc.length}`);
const cellDoc = [...DOCS.matchAll(/(\d+)–(\d+) px/g)].map((m) => [+m[1], +m[2]]);
ok(cellDoc.length >= 2 && cellDoc.every(([a, b]) => a === Cell.min && b === Cell.max),
  `D9f 文档两处「${cellDoc[0] ? `${cellDoc[0][0]}–${cellDoc[0][1]} px` : '解析不到'}」== theme.js 的 Cell.min/max = ${Cell.min}/${Cell.max}`,
  cellDoc.map(([a, b]) => `${a}-${b}`).join(' / '));
const coverDoc = DESIGN.match(/穷举复核只覆盖 ≤(\d+)×(\d+)/) || [];
const covered = TIERS.filter((t) => t.size <= +coverDoc[1]).length;
ok(coverDoc.length === 3 && +coverDoc[1] === +coverDoc[2] && covered === 4 && TIERS[4].size > +coverDoc[1],
  `D9g DESIGN §8「穷举复核只覆盖 ≤${coverDoc[1] || '?'}×${coverDoc[2] || '?'}」与 TIERS 现值吻合（4 档在此尺寸内、大师 ${TIERS[4].size} 不在）`,
  TIERS.map((t) => `${t.label}${t.size}`).join(' '));
const keyDoc = (DESIGN.match(/`store\.js` 一个键（`([\w.]+)`）/) || [])[1];
const keySrc = (STORE_SRC.match(/const KEY = '([\w.]+)'/) || [])[1];
ok(!!keyDoc && keyDoc === keySrc, `D9h DESIGN §6 的存档键 ${keyDoc || '?'} == store.js 的 KEY 现值 ${keySrc || '?'}`, `文档 ${keyDoc} vs 代码 ${keySrc}`);
const threeImpl = [...DESIGN.matchAll(/`engine\/([\w.]+\.js)` `(\w+)\(\)`/g)].map((m) => ({ f: m[1], fn: m[2] }));
ok(threeImpl.length === 3 && threeImpl.every((x) => new RegExp(`export function ${x.fn}\\b`).test(read(`js/engine/${x.f}`))),
  `D9i DESIGN §2 那张「三份互不信任的代码」表解析到 ${threeImpl.length} 行，且每行点名的函数真的在对应文件里导出`,
  threeImpl.map((x) => `${x.f}#${x.fn}`).join(' · '));
const rleDoc = DESIGN.match(/续局存的是\s*\n`(\{[^`]+\})`/);
const rleFields = rleDoc ? rleDoc[1].split(',').map((s) => s.trim().replace(/[{}]/g, '').split('(')[0].trim()) : [];
const storeSrc = STORE_SRC;
ok(!!rleDoc && rleFields.length === 6 && rleFields.every((f) => storeSrc.includes(f)),
  `D9j DESIGN §6 列的续局字段 ${rleFields.join('/') || '解析不到'} 逐个在 store.js 里（多一个少一个都是文档与代码分家）`, `${rleFields.length} 个字段`);
const synthBlock = read('js/audio/synth.js').slice(read('js/audio/synth.js').indexOf('export const Sound = {'));
const soundEffects = [...synthBlock.matchAll(/^  (\w+)\(\) \{/gm)].map((m) => m[1]);
const docSfx = (README.match(/js\/audio\/synth\.js\s+([一二三四五六七八九十])个合成音效/) || [])[1];
ok(!!docSfx && CN[docSfx] === soundEffects.length, `D9k README 目录那句「${docSfx || '?'}个合成音效」== synth.js 的 Sound 现在导出的 ${soundEffects.length} 个音效`,
  `文档 ${CN[docSfx] || '?}'} vs 代码 ${soundEffects.length}（${soundEffects.join('/')}）`);

// ---- D10 符号锚点：文档为某个文件写的 `file:NN` 必须坐在该符号现在的行上 ----
function lineOfAt(file, re) {
  const a = read(file).split('\n');
  for (let i = 0; i < a.length; i++) if (re.test(a[i])) return i + 1;
  return -1;
}
const fileRanges = (file) => {
  const esc = file.replace(/[./]/g, '\\$&');
  return [...DOCS.matchAll(new RegExp('`' + esc + ':(\\d+)(?:-(\\d+))?`', 'g'))].map((m) => [+(m[1]), +(m[2] || m[1])]);
};
const ANCHORS = [
  ['js/engine/generate.js', 'TIERS 整段', /export const TIERS/],
  ['js/engine/akari.js', 'Rules 整段', /export const Rules/],
  ['js/engine/akari.js', '成组上限那行', /if \(!open\.length \|\| open\.length > 12\) continue;/],
  ['tools/verify.sh', 'HTTP 默认号那行', /^HTTP=\$\{HTTP_PORT:-\d+\}/],
  ['.github/workflows/ci.yml', 'Engine tests 那一步', /run: node tools\/engine-test\.mjs/],
];
for (const [file, what, srcRe] of ANCHORS) {
  const real = lineOfAt(file, srcRe);
  const ranges = fileRanges(file);
  const hits = ranges.filter(([a, b]) => real >= a && real <= b);
  ok(real > 0, `D10 代码侧「${what}」（${file}）解析到了（找不到就是空转）`, `${file}:${real}`);
  ok(hits.length >= 1, `D10 文档为 ${file} 写的某处 \`file:NN\` 真的覆盖到「${what}」现在的第 ${real} 行`,
    ranges.length ? `文档范围 ${ranges.map(([a, b]) => (a === b ? String(a) : `${a}-${b}`)).join(' / ')} · 代码现在 ${real}` : '文档里解析不到这个文件的行引用');
}

// ---- D11 泛引用范围：README + DESIGN 里每一条 path:NN 都落在真实文件的行数内 ----
const cites = [...DOCS.matchAll(/((?:\.github\/workflows\/|js\/|tools\/|css\/)?[\w./-]+\.(?:js|mjs|cjs|sh|json|html|yml)):(\d+)(?:-(\d+))?/g)];
const resolve = (p) => {
  if (existsSync(join(ROOT, p))) return p;
  const base = p.split('/').pop();
  for (const d of ['tools/', 'js/engine/', 'js/', 'js/ui/', 'js/render/', 'css/', '.github/workflows/', '']) if (existsSync(join(ROOT, d + base))) return d + base;
  return null;
};
const bad = [];
const drift = [];
for (const c of cites) {
  const rp = resolve(c[1]);
  if (!rp) { bad.push(`${c[1]}:${c[2]}（文件不存在）`); continue; }
  const n = lines(read(rp));
  if (+c[2] > n || (+c[3] && +c[3] > n)) bad.push(`${c[1]}:${c[2]}${c[3] ? '-' + c[3] : ''}（该文件只有 ${n} 行）`);
  // 行号引用最容易犯的错不是越界，是漂到邻行（插了几行之后 :12 指的已经是空行了）。
  // 所以引用的落点必须含字母：空行、单独的 `};` / `{` 都算漂。
  const at = (read(rp).split('\n')[+c[2] - 1] || '').trim();
  if (!/[A-Za-z]/.test(at)) drift.push(`${c[1]}:${c[2]} 落在「${at || '空行'}」`);
}
const EXPECT_CITES = 9;
ok(cites.length === EXPECT_CITES, `D11a 文档里的 path:NN 引用解析到 ${cites.length} 条（钉在 ${EXPECT_CITES}：删一条引用或改了引用格式都是这里红）`,
  `${cites.length} 条`);
ok(bad.length === 0, `D11 每一条 path:NN 引用都落在真实文件的行数内（改了代码不重编行号就是这里红）`,
  bad.length ? `越界：${bad.slice(0, 5).join('，')}${bad.length > 5 ? ` …共 ${bad.length} 条` : ''}` : `${cites.length} 条全部在范围内`);
ok(drift.length === 0, `D11b 每一条 path:NN 引用都落在含字母的那一行（漂到空行 / 单独的 }; 上就是这里红）`,
  drift.length ? `漂移：${drift.slice(0, 5).join('，')}${drift.length > 5 ? ` …共 ${drift.length} 条` : ''}` : `${cites.length} 条落点都有代码/配置文本`);

// 台账的刀与组：D12 与 D13 都要读，先解析一次
const knifeIds = [...SAB_SRC.matchAll(/id: '(K\d+)'/g)].map((m) => m[1]);
const knifeGroups = [...SAB_SRC.matchAll(/id: '(K\d+)', group: '(D\d+)'/g)].map((m) => ({ id: m[1], group: m[2] }));

// ---- D12 接线：doctest 与 sabotage 进了 verify.sh 的逻辑段、ci.yml 的 check job、package.json ----
const pkgHas = (k) => (PKG.scripts?.[k] || '').includes(`tools/${k}.mjs`);
ok(pkgHas('doctest'), 'D12a package.json 有 doctest 这条 script 且指向本仓 tools/', `doctest=${PKG.scripts && PKG.scripts.doctest}`);
ok(pkgHas('sabotage'), 'D12b package.json 有 sabotage 这条 script 且指向本仓 tools/', `sabotage=${PKG.scripts && PKG.scripts.sabotage}`);
ok(/node "\$HERE\/tools\/doctest\.mjs"/.test(VERIFY) && /node "\$HERE\/tools\/sabotage\.mjs"/.test(VERIFY),
  'D12c verify.sh 里接了这两道逻辑闸（npm run verify 与 bash tools/verify.sh 跑同一件事）', `两条都在=${/doctest/.test(VERIFY) && /sabotage/.test(VERIFY)}`);
const oneLineVerify = VERIFY.replace(/\n/g, ' ');
ok(/doctest\.mjs[\s\S]{0,400}?FAILED=1/.test(oneLineVerify) && /sabotage\.mjs[\s\S]{0,400}?FAILED=1/.test(oneLineVerify),
  'D12d 两道逻辑闸的 rc 都折进 FAILED（跑完不折叠 = 白跑）', 'rc → FAILED=1 两条齐');
const logicAt = VERIFY.indexOf('node "$HERE/tools/doctest.mjs"');
const browserAt = VERIFY.indexOf('$CHROME" --headless');
ok(logicAt > 0 && browserAt > 0 && logicAt < browserAt, 'D12e 逻辑闸排在启动 Chrome 之前（逻辑坏了不必等浏览器）', `doctest@${logicAt} < chrome@${browserAt}`);
ok(/node tools\/doctest\.mjs/.test(CI) && /node tools\/sabotage\.mjs/.test(CI),
  'D12f ci.yml 里同时接了 doctest 与 sabotage（本地绿＝CI 绿；不许有只在一侧跑的那道）', 'ci.doctest · ci.sabotage');
const ciCheckBlock = CI.slice(CI.indexOf('  check:'), CI.indexOf('  browser:'));
ok(/doctest/.test(ciCheckBlock) && /sabotage/.test(ciCheckBlock) && !/verify\.sh/.test(ciCheckBlock),
  'D12g 两条闸都在 ci.yml 的 check job 里（不是塞进 browser job 靠 Chrome）', `check job 内两条齐=${/doctest/.test(ciCheckBlock) && /sabotage/.test(ciCheckBlock)}`);
const expectRow = (VERIFY.match(/LOGIC_EXPECTS="([^"]+)"/) || [])[1];
const expectMap = {};
for (const kv of (expectRow || '').split(/\s+/)) { const [k, v] = kv.split(':'); if (k && v) expectMap[k] = v; }
ok(expectMap.doctest === `${EXPECT_GROUPS}/${EXPECT_ROWS}` && expectMap.sabotage === `${knifeIds.length}`,
  `D12h verify.sh 的 LOGIC_EXPECTS 钉住了本闸体量与刀数（${expectMap.doctest || '缺'} · ${expectMap.sabotage || '缺'}）—— 必须等于源码里的钉`,
  `LOGIC_EXPECTS=${expectRow || '未解析'}`);
ok(expectMap['engine-test'] === `${engPass}`, `D12i LOGIC_EXPECTS 里 engine-test 的钉等于现跑的 ${engPass} 条`, `钉=${expectMap['engine-test']}`);

// ---- D13 台账本身：文档说的刀数 == sabotage.mjs 里 KNIVES 条数；刀与刀打的组不许重叠 ----
ok(knifeIds.length >= 4, `D13a sabotage.mjs 里至少 4 把刀（当前 ${knifeIds.length} 把：${knifeIds.join(' ')}）`, `${knifeIds.length} 把：${knifeIds.join(' ')}`);
const knifeCountDoc = (README.match(/破坏试验台账（(\d+) 把刀）/) || [])[1];
ok(!!knifeCountDoc && +knifeCountDoc === knifeIds.length, `D13b README 那句「台账（N 把刀）」等于 sabotage.mjs 里的刀数`,
  `文档 ${knifeCountDoc ?? '未解析'} vs 脚本 ${knifeIds.length}`);
ok(knifeGroups.length === knifeIds.length && new Set(knifeGroups.map((k) => k.group)).size === knifeGroups.length,
  `D13c 每把刀打的是不同的组（${knifeGroups.map((k) => `${k.id}→${k.group}`).join(' ')}）`, `组数 ${new Set(knifeGroups.map((k) => k.group)).size} / 刀数 ${knifeIds.length}`);
const rcCells = knifeIds.map((id) => { const m = SAB_SRC.match(new RegExp(`id: '${id}'[\\s\\S]*?rc: '(\\d+|\\?)'`)); return m ? m[1] : null; });
ok(rcCells.every((x) => x && /^\d+$/.test(x)), `D13d 台账每一格 rc 都是从闸里读回来的数字（? 表示这一版还没整跑过）`, rcCells.join(' / '));
const knifeFiles = knifeGroups.map((k) => { const m = SAB_SRC.match(new RegExp(`id: '${k.id}'[\\s\\S]*?file: '([^']+)'`)); return m && m[1]; });
ok(new Set(knifeFiles).size === knifeFiles.length && knifeFiles.every((f) => existsSync(join(ROOT, f))),
  `D13e 刀与刀改的是不同文件、且都是真文件（同一文件上两把刀会互相掩盖）`, knifeFiles.join(' · '));
const knifeAtLine = knifeFiles.map((f) => f === 'tools/verify.sh' || f === '.github/workflows/ci.yml');
ok(!knifeAtLine.some(Boolean), 'D13f 没有一把刀去切 verify.sh 或 ci.yml 本身（闸在 verify.sh 里跑，切它会动到正在执行的脚本）',
  knifeFiles.join(' · '));

// ---- D14 墙钟那类：只比方向与来源、绝不重测、也绝不把新测的毫秒写回文档 ----
const msNotes = [...DOCS.matchAll(/(本机墙钟|不设 `budgetMs` 门禁|会随机器漂)/g)].map((m) => m[1]);
ok(msNotes.length >= 3, `D14a 文档里三处以上写明「出题 ms 是本机墙钟、会随机器漂、不设 budgetMs 门禁」（少了就是有人把这一列又当成现值抄）`,
  `${msNotes.length} 处：${msNotes.join('/')}`);
ok(!/budgetMs/.test(BAL_SRC), `D14b balance.mjs 里没有任何 budgetMs 判定路径（文档那句「不设 budgetMs」有代码背书）`, `BAL_SRC 命中 budgetMs=${/budgetMs/.test(BAL_SRC)}`);
ok(/耗时 \d+ ms\/局/.test(BAL.out) && /最慢档位 \d+ ms\/局/.test(BAL.out), 'D14c balance 确实现场打了 ms（本闸只取其 argmax 方向，不取绝对值）', 'ms 在 stdout');
const msLine = (README.match(/^-\s*出题耗时.*$/m) || [''])[0];
ok(/本机墙钟/.test(msLine) && /\d+ ms\/局/.test(msLine), 'D14d 「出题耗时」那一句自己就写明是本机墙钟读数（同一行内绑定，不是别处的免责声明）',
  msLine.slice(0, 74));

// ---- D15 UNPINNED 清单：文档抄的、需要探针或本机跑才有值的读数不进等式；但每条都要"还在文档里" ----
const UNPINNED = [
  ['U1', 'README 那份 verify.sh 输出的每行 checks 数（14/39/29/16/20/17/19）', /14 checks, 0 failed/],
  ['U2', '出题耗时 49 ms/局 这类本机墙钟读数（只钉方向，不钉数值）', /最慢档位 \*\*49 ms\/局\*\*/],
  ['U3', '100 格往返与 420 px 视口那两条浏览器内读数', /全跑\*\*（100 格）|420 px 视口/],
  ['U4', 'DESIGN §4 那批「首次入选」中位（熟练 12.2 vs 见习 11.2，未经 band 选取，与 D3 的两个数是两件事）', /12\.2 vs 见习 11\.2/],
  ['U5', 'DESIGN §4 那段镜像图案 200 次尝试 0 可用图案的历史读数', /200 次尝试产出 \*\*0 个可用图案\*\*/],
];
UNPINNED.forEach(([id, what, re]) => {
  const hits = (DOCS.match(re) || []).length;
  ok(hits >= 1, `D15 ${id}「${what}」还写在文档里（钉不住 ≠ 可以删；删了就是这一条红）`, `${hits} 处`);
});
ok(UNPINNED.filter(([, , re]) => re.test(DOCS)).length === UNPINNED.length, `D15a 反空转：${UNPINNED.length} 条 unpinned 逐条在文档里找到 needle`,
  `${UNPINNED.length}/${UNPINNED.length}`);
const samples = (README.match(/`npm run balance`（每档 (\d+) 局）/) || [])[1];
ok(+samples === +(BAL.out.match(/出题成功率 \d+\/(\d+)/) || [])[1], `D15b README 那句「每档 ${samples} 局」== balance 现场的分母（N 是配置不是手抄）`,
  `balance ${BAL.out.match(/出题成功率 \d+\/(\d+)/)?.[1]}`);
ok(!/SAMPLES=/.test(README + DESIGN), `D15c 文档没有把 SAMPLES 的覆盖跑法写成默认值（那是手工跑的法子，见 verify.sh 注释）`, `命中=${/SAMPLES=/.test(DOCS)}`);

// ---- D16 自数：这道闸自己发出的组数与项数都钉死 —— 删一条 test / 少解析一行就是这里红 ----
const finalRows = rows + 2;
const finalGroups = emitted.size + (emitted.has('D16') ? 0 : 1);
ok(finalGroups === EXPECT_GROUPS, `D16a 本闸发出 ${finalGroups} 组 D 标签（钉在 ${EXPECT_GROUPS}；删一组就是这里红）`,
  [...emitted, 'D16'].sort((a, b) => +a.slice(1) - +b.slice(1)).join(' '));
ok(finalRows === EXPECT_ROWS, `D16b 本闸项数 == 钉的 ${EXPECT_ROWS}（增/删一条 ok() 都要改这里；不改就是这里红）`, `本次累计 ${finalRows} 项`);

console.log(`\n合计 ${rows} 项，${fail.length} 项失败`);
console.log(`GATE_SIZE groups=${finalGroups} rows=${finalRows} fail=${fail.length}`);
console.log(`钉成等式的文档现值：${rows - UNPINNED.length - 1} 项 · 显式 unpinned：${UNPINNED.length + 1} 项`);
if (fail.length) { for (const f of fail) console.log(`  未过：${f}`); process.exit(1); }
process.exit(0);
