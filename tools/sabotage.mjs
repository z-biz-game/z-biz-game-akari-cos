// 破坏试验台账：把「文档可能抄的是一个已经不存在的数」这件事，一类谎一类谎地塞回代码里，
// 证明 tools/doctest.mjs 真的会红，而且红的就是文档点名的那一条断言 —— 不是随便一条别的红。
//
// 为什么要这道闸：doctest 是绿的，但「绿」有两种：一种是被断言真的守住了，一种是解析器集体扑空
// （正则改了形状、锚点被删空、balance 没跑起来）。前者绿是成绩，后者绿是假账。唯一的分辨办法是
// 主动把代码改坏，看这道闸是不是立刻变红并且报出对应的那一条。这里就把每一类谎固化成一把刀。
//
// 六条规矩：
//   1. 每把刀改一个真实的代码文件（不是改文档），当场跑 node tools/doctest.mjs，读回真实 rc；
//   2. rc 必须 != 0，而且日志里必须出现「文档点名的那条断言」的 FAIL 行 —— 只红在别处不算逼到；
//   3. 复原只用内存里读回来的原始字节 writeFileSync，绝不借 git 命令复原；复原后再读回逐字节比对；
//   4. 开工前要求**被切的这几个文件**是干净的（git status 只查这几条路径）：树已经是脏的，
//      刀落在哪一档上就说不清了；
//   5. 台账的 rc 一格是「从脚本读回来的真实读数」，第一版没跑过的用 '?'，跑成功后自钉成数字；
//      自钉必须幂等：干净树上重跑，刀数与 rc 都不变，闸依旧是绿的；
//   6. 最后跑一遍「对照」：不带任何破坏的 doctest + engine-test 必须都是绿的，证明台账不是靠
//      把闸改坏来让自己变绿。跑子集（KNIVES=K1,K3）会打 NOTE，不会静默当成全量通过。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (rel) => join(ROOT, rel);

// 十六把刀，doctest 的十六个组一组一把：D1 档位 band、D2 铅笔规则名、D3 balance 表头百分比、
// D4 填灯器样本量、D5 引擎断言的期望值、D6 端口默认号、D7 HTML 行数、D8 场景注册表、D9 渲染常量、
// D10 符号锚点的行号、D11 引用落点、D12 npm 接线、D13 台账自己、D14 budgetMs 那句承诺、
// D15 unpinned 的 needle、D16 本闸项数。全是纯逻辑的最小扰动 —— 不动浏览器、不动端口，也不切
// verify.sh / ci.yml 本身（本闸就跑在 verify.sh 里，切它等于改一条正在执行的脚本）。
// K12/K14/K15 三把切的是闸自己的两个文件：闸进程已经把源码读进内存，落刀只影响**当场那一趟 doctest**，
// 而且因为规矩 4 要求被切文件在 git 里干净，所以自钉落盘后必须先提交再重跑（第二趟才是幂等证据）。
const KNIVES = [
  {
    id: 'K1', group: 'D1', file: 'js/engine/generate.js',
    from: 'band: [10, 15.5] }', to: 'band: [10, 15.4] }',
    breaks: '把「熟练」档的 band 上限从 15.5 改成 15.4（文档难度表写的是 10–15.5）',
    assert: /FAIL D1e 熟练 的目标分 .* == TIERS 现值 band/m,
    rc: '1',
  },
  {
    id: 'K2', group: 'D2', file: 'js/engine/akari.js',
    from: "  clueCluster: '线索成组',", to: "  clueCluster: '线索成堆',",
    breaks: '把第 3 条铅笔规则改名（README 的「六条铅笔规则」与 index.html 的规则说明都写「线索成组」）',
    assert: /FAIL D2c 第 3 条规则「线索成堆」/m,
    rc: '1',
  },
  {
    id: 'K3', group: 'D6', file: 'server.cjs',
    from: 'Number(process.env.PORT) || 5173;', to: 'Number(process.env.PORT) || 5174;',
    breaks: '把 server.cjs 的默认端口从 5173 改成 5174（README 的 npm start 那一行写的是 127.0.0.1:5173）',
    assert: /FAIL D6c README 那句「npm start → 127\.0\.0\.1:5173」/m,
    rc: '1',
  },
  {
    id: 'K4', group: 'D8', file: 'tools/scenarios.js',
    from: 'w.__ng = { engine, gen, play, hint, save, resume, layout };', to: 'w.__ng = { engine, gen, play, hint, save, resume };',
    breaks: '从浏览器场景注册表里摘掉 layout（verify.sh 默认还要跑 7 个场景，文档也写 7 个）',
    assert: /FAIL D8a 场景集解析到 7（verify\.sh 默认）\/ 6/m,
    rc: '1',
  },
  {
    id: 'K5', group: 'D9', file: 'js/theme.js',
    from: 'export const Cell = { min: 18, max: 52,', to: 'export const Cell = { min: 20, max: 52,',
    breaks: '把可读格子的下限从 18 px 抬到 20 px（README 与 DESIGN §7 都写「18–52 px」）',
    assert: /FAIL D9f 文档两处「18–52 px」== theme\.js 的 Cell\.min\/max = 20\/52/m,
    rc: '1',
  },
  {
    id: 'K6', group: 'D3', file: 'tools/balance.mjs',
    from: '留线索约 ${Math.round((1 - tier.prune) * 100)}%', to: '留线索约 ${Math.round((1 - tier.prune) * 99)}%',
    breaks: '把 balance 表头里「留线索约 X%」的换算从 ×100 改成 ×99（文档难度表抄的是这一行打出来的百分数）',
    assert: /^.*FAIL .*D3g .*的盘面.*$/m,
    rc: '?',
  },
  {
    id: 'K7', group: 'D4', file: 'tools/balance.mjs',
    from: '  for (let s = 0; s < 60; s++) {', to: '  for (let s = 0; s < 61; s++) {',
    breaks: '把填灯器样本量从 60 局偷偷加到 61 局（README 那句「填灯器产出的 60/60 个盘面合法」抄的是上一次跑的数）',
    assert: /^.*FAIL .*D4e README「填灯器产出的/m,
    rc: '?',
  },
  {
    id: 'K8', group: 'D5', file: 'tools/engine-test.mjs',
    from: "  eq('填出来的灯盘通过独立检查', verify(b).length, 0);", to: "  eq('填出来的灯盘通过独立检查', verify(b).length, 1);",
    breaks: '把一条引擎断言的期望从 0 改成 1（文档那句「77 项引擎断言全过」是从绿的那次抄来的）',
    assert: /^.*FAIL .*D5a engine-test 现场跑 rc=/m,
    rc: '?',
  },
  {
    id: 'K9', group: 'D7', file: 'index.html',
    from: '<!DOCTYPE html>', to: '<!DOCTYPE html>\n<!-- 台账：这一行让 HTML 的行数比文档多 1 -->',
    breaks: '往 index.html 顶上塞一行注释（README 的规模表里 CSS/HTML 行数是上一次数的）',
    assert: /^.*FAIL .*D7f CSS\/HTML 行数.*$/m,
    rc: '?',
  },
  {
    id: 'K10', group: 'D10', file: 'js/engine/akari.js',
    from: "    if (!open.length || open.length > 12) continue;\n    const targets = [];", to: "    const targets = [];\n    if (!open.length || open.length > 12) continue;",
    breaks: '把成组枚举上限那行与下一行换个位置（行为逐位相同，只有文档引用的 `akari.js:214` 漂到了隔壁行）',
    assert: /^.*FAIL .*D10 文档为 js\/engine\/akari\.js 写的某处.*$/m,
    rc: '?',
  },
  {
    id: 'K11', group: 'D12', file: 'package.json',
    from: '"doctest": "node tools/doctest.mjs",', to: '"doctest-legacy": "node tools/doctest.mjs",',
    breaks: '把 npm run doctest 这个入口改名（文档与 verify 的接线说明还写着它存在）',
    assert: /^.*FAIL .*D12a package\.json 有 doctest 这条 script/m,
    rc: '?',
  },
  {
    id: 'K12', group: 'D13', file: 'tools/sabotage.mjs',
    // 靶面是本文件自己的 KNIVES 数组，所以针必须拆成两段写：连着写的话这一把的 from 字面量里也有一份
    // 同样的文本，前置的「恰好命中一次」就会拒落这把刀（masyu 试过，报的是命中 3 次）。
    from: "    id: 'K11', group: 'D12', " + "file: 'package.json',",
    to: "    id: 'K11', group: 'D13', " + "file: 'package.json',",
    breaks: '让两把刀打同一组（K11 的组名改成 D13，与 K12 撞车）——「一组一把」是这一组唯一的判据',
    assert: /^.*FAIL .*D13c 每把刀打的是不同的组.*$/m,
    rc: '?',
  },
  {
    id: 'K13', group: 'D14', file: 'tools/balance.mjs',
    from: '// 难度实测台. Reads the difficulty of each tier off generated boards — it does not set it.',
    to: '// 难度实测台. Reads the difficulty of each tier off generated boards — it does not set it（budgetMs）.',
    breaks: '在 balance 的头注释里写出 budgetMs 这个词（D14b 核的是「代码里没有这个 token」，不是语义）',
    assert: /^.*FAIL .*D14b balance\.mjs 里没有任何 budgetMs.*$/m,
    rc: '?',
  },
  {
    id: 'K14', group: 'D15', file: 'tools/doctest.mjs',
    from: '/14 checks, 0 failed/],', to: '/140 checks, 0 failed/],',
    breaks: '把 unpinned 清单里 U1 的 needle 改成一个文档里根本不存在的数（反空转那一条就不再逐条找 needle 了）',
    assert: /^.*FAIL .*D15 U1「.*$/m,
    rc: '?',
  },
  {
    id: 'K15', group: 'D16', file: 'tools/doctest.mjs',
    from: 'const EXPECT_ROWS = 174;', to: 'const EXPECT_ROWS = 173;',
    breaks: '把本闸自己钉的项数悄悄改小 1（删一条断言不改锁，就是这一把的形状）',
    assert: /^.*FAIL .*D16b 本闸项数.*$/m,
    rc: '?',
  },
  {
    id: 'K16', group: 'D11', file: 'tools/balance.mjs',
    from: "import { countSolutions, UNIQUE } from '../js/engine/count.js';\n\nconst N = Number(process.env.SAMPLES || 40);",
    to: "import { countSolutions, UNIQUE } from '../js/engine/count.js';\nconst N = Number(process.env.SAMPLES || 40);\n",
    breaks: '把 balance 顶部那个空行挪到下一句之后（总行数一字不差，只有 README 引用的 `balance.mjs:13` 落到空行上）',
    assert: /^.*FAIL .*D11b 每一条 path:NN 引用都落在含字母的那一行/m,
    rc: '?',
  },
];

const runGate = () => {
  const r = spawnSync('node', ['tools/doctest.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
  return { rc: r.status === null ? -1 : r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const runEngine = () => {
  const r = spawnSync('node', ['tools/engine-test.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  return { rc: r.status === null ? -1 : r.status, out: (r.stdout || '') + (r.stderr || '') };
};

const wanted = (process.env.KNIVES || '').split(/[\s,]+/).filter(Boolean);
const subset = wanted.length > 0;
const picked = subset ? KNIVES.filter((k) => wanted.includes(k.id)) : KNIVES;
if (subset) {
  console.log(`NOTE 只跑台账子集 KNIVES=${wanted.join(',')}（${picked.length}/${KNIVES.length} 把刀）—— 这不是全量通过，` +
    `自钉只写这几格，台账的 rc 列仍有未跑到的刀`);
  const unknown = wanted.filter((w) => !KNIVES.some((k) => k.id === w));
  if (unknown.length) { console.log(`NOTE 子集里有不存在的刀：${unknown.join(',')} —— 直接判红，不静默忽略`); process.exit(1); }
}

const problems = [];
const ledger = [];

// 先立「干净树」这个前提：被切的每一条代码路径在 git 里必须是干净的（本闸自己的两个文件
// 允许还没提交 —— 台账要先把真实 rc 钉进 sabotage.mjs 才能提交，这一条会打 NOTE 说明）；
// 而且每把刀的 from 必须恰好命中一次 —— 命中 0 次说明树已经不是钉住的那个形状，命中多次说明改错地方。
const touched = [...new Set(picked.map((k) => k.file))];
const st = spawnSync('git', ['status', '--porcelain', '--', ...touched], { cwd: ROOT, encoding: 'utf8' });
if (st.status !== 0) { console.log(`前置：git status 失败（rc=${st.status}）—— 不敢在读不到树状态的仓库里动刀`); process.exit(1); }
const dirty = (st.stdout || '').split('\n').filter(Boolean);
if (dirty.length) {
  console.log('前置不干净：以下被切路径有未提交的改动，台账拒绝动刀（复原就没法只认原始字节）：');
  for (const d of dirty) console.log(`  ${d}`);
  process.exit(1);
}
const gateSelf = spawnSync('git', ['status', '--porcelain', '--', 'tools/doctest.mjs', 'tools/sabotage.mjs'], { cwd: ROOT, encoding: 'utf8' });
if ((gateSelf.stdout || '').trim()) console.log(`NOTE 闸自身的文件尚未提交（${(gateSelf.stdout || '').trim().replace(/\n/g, ' ')}）：台账只对被切的代码文件要求干净树`);
for (const k of picked) {
  if (!existsSync(p(k.file))) { problems.push(`${k.id}: 目标文件不存在 ${k.file}`); continue; }
  const src = readFileSync(p(k.file), 'utf8');
  const nFrom = src.split(k.from).length - 1;
  if (nFrom !== 1) problems.push(`${k.id}: ${k.file} 里 from 命中 ${nFrom} 次（必须恰好 1 次才敢改）`);
}
if (problems.length) { for (const x of problems) console.log(`  前置不干净：${x}`); process.exit(1); }

for (const k of picked) {
  const original = readFileSync(p(k.file), 'utf8'); // 原始字节进内存，复原只认这份
  const sabotaged = original.replace(k.from, k.to);
  if (sabotaged === original) { problems.push(`${k.id}: 替换没生效（from 与 to 相同？）`); continue; }
  writeFileSync(p(k.file), sabotaged, 'utf8');
  let gate;
  try {
    gate = runGate();
  } finally {
    // 无论闸跑成什么、有没有抛，都必须用内存里的原始字节写回去
    writeFileSync(p(k.file), original, 'utf8');
  }
  const back = readFileSync(p(k.file), 'utf8');
  const restored = back === original; // 复原后逐字节回读校验
  const tripped = gate.rc !== 0 && k.assert.test(gate.out);
  const named = (gate.out.match(k.assert) || ['(日志里没有点名的那条 FAIL)'])[0].trim();
  k.rc = String(gate.rc);
  ledger.push({ id: k.id, group: k.group, breaks: k.breaks, rc: gate.rc, tripped, restored, named });
  console.log(`  [${tripped ? '逼红' : '未逼红'}] ${k.id} → ${k.group} · 破坏「${k.breaks}」 · doctest rc=${gate.rc}`);
  console.log(`      点名的断言：${named}`);
  if (!restored) problems.push(`${k.id}: 复原后逐字节不一致（还原没做到）`);
  if (gate.rc === 0) problems.push(`${k.id}: 塞了这类谎 doctest 却还是 rc=0 —— 这一类谎没人守`);
  else if (!k.assert.test(gate.out)) problems.push(`${k.id}: doctest 红了但不是红在点名的那条（${k.group}）`);
}

// 自钉：把读回来的真实 rc 写进本文件的台账（幂等 —— 同样的刀只会得到同样的 rc）。
// 必须在对照跑之前落盘：doctest 的 D13d 会读这个文件，rc 若还是 '?' 对照就红。
const selfPath = fileURLToPath(import.meta.url);
const selfSrc = readFileSync(selfPath, 'utf8');
let stamped = selfSrc;
for (const k of picked) {
  const re = new RegExp(`(id: '${k.id}'[\\s\\S]*?rc: ')[^']*(')`);
  if (!re.test(stamped)) { problems.push(`自钉：找不到 ${k.id} 的 rc 槽`); continue; }
  stamped = stamped.replace(re, `$1${k.rc}$2`);
}
if (stamped !== selfSrc) writeFileSync(selfPath, stamped, 'utf8'); // 幂等：干净重跑时这里 no-op

// 对照跑：不带任何破坏，doctest 与 engine-test 都必须绿 —— 证明台账不是靠改坏闸来绿。
const ctl = runGate();
const eng = runEngine();
console.log(`\n对照（干净树）：doctest rc=${ctl.rc} · engine-test rc=${eng.rc}`);
if (ctl.rc !== 0) console.log(ctl.out.split('\n').filter((l) => l.includes('FAIL')).slice(0, 20).join('\n'));
if (eng.rc !== 0) console.log(eng.out.split('\n').filter((l) => l.includes('FAIL')).slice(0, 10).join('\n'));

console.log('\n== 破坏试验台账（rc 均为本次从脚本读回的真实读数）==');
console.log('| 刀 | 打哪组 | 破坏 | 逼到的断言 | 真实 rc |');
console.log('|---|---|---|---|---|');
for (const r of ledger) console.log(`| ${r.id} | ${r.group} | ${r.breaks} | ${r.named.slice(0, 46)} | ${r.rc} |`);
const allRc = KNIVES.map((k) => k.rc);
console.log(`GATE_SIZE knives=${ledger.length} groups=${new Set(ledger.map((r) => r.group)).size} rc=${allRc.join(',')} full=${subset ? 0 : 1}`);
if (subset) console.log('NOTE 本轮是子集：台账未全量逼红，不宣布全绿');

if (problems.length) { console.log('\n台账不绿：'); for (const x of problems) console.log(`  - ${x}`); process.exit(1); }
if (subset) { console.log(`\n子集 ${ledger.length} 把刀各自逼红了点名的断言（全量请不带 KNIVES 再跑）。`); process.exit(0); }
if (ctl.rc !== 0 || eng.rc !== 0) { console.log('对照不绿：闸在干净树上是红的'); process.exit(1); }
console.log(`\n台账全绿：${ledger.length} 把刀各自逼红了点名的断言，复原逐字节一致，干净树对照 doctest+engine-test 双绿。`);
process.exit(0);
