#!/usr/bin/env node
// 部署集闸：按 pages.yml 用的那份清单真拷一遍产物，然后要求"浏览器会去要的东西"都在产物里。
//
// 这里防的是一整类本地看不见、CI 也不红的坏法：仓里没有构建步骤，index.html 直读仓库根，
// 所以本地永远自洽；上线的站点却是 tools/assemble-site.sh 拷出来的那一份。清单落后于页面
// （加了图标/纹理/SW 却忘了加进 cp），线上就是 404，而引擎测试、文档数字闸、浏览器场景全都
// 跑的是仓库根，一条都不会红——上一轮缺的就是 manifest.webmanifest、sw.js、icons/ 全套和
// CSS 里那张 night-field.png。
//
// 关键形状是**基准目录**：同一个字符串在不同出处指向不同的文件。
//   index.html 的 href/src            → 站点根
//   manifest 的 icons/screenshots      → manifest 自己所在目录（本仓在根）
//   css/*.css 的 url("../assets/…")   → 那支 CSS 文件所在目录
//   js 里 new URL(rel, import.meta.url)→ 那个模块所在目录（js/render/sheets.js 的
//     '../../assets/textures/spark.png' 就是这么落回 /<repo>/assets/… 的）
//   js 里 navigator.serviceWorker.register('sw.js') → 文档基准，也就是站点根
// 全部当成站点根来算，会把越级路径误判成逃逸，也会把真正缺的文件判成存在。
//
// 五段断言，各管一种真实的坏法：
//   A 清单与页面同源（workflow 用的就是这一支脚本）
//   B 引用可达（含"解析不到引用也算红"的反空转）
//   C 不许逃逸/绝对路径（'/sw.js' 与 '../..'<根 都会跳出 Pages 的 /<repo>/ 项目站）
//   D 位图不许说谎（manifest 声明的 sizes 必须等于 PNG IHDR 的真实宽高）
//   E 自钉：引用条数与断言条数都钉在文件里，闸缩水不可能伪装成绿
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSEMBLE = 'tools/assemble-site.sh';
// 绿灯时的两个自钉值。加了引用/断言就一起改，但只能往上加不能往下掉——
// 掉下去必须有理由（删了文件、并了断言），否则就是闸在缩水。
const EXPECT_CHECKS = 24;
const EXPECT_ROWS = 43;

let rows = 0;
const fails = [];
const ok = (cond, label, detail) => {
  rows += 1;
  if (!cond) fails.push(`${label}${detail ? '  ' + detail : ''}`);
};

const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);

// ---- A ----
const wf = readIf(path.join(ROOT, '.github/workflows/pages.yml'));
ok(wf !== null, 'A1 workflow/pages.yml 读得到', wf === null ? '文件不存在' : '');
if (wf !== null) {
  ok(wf.includes(ASSEMBLE), 'A2 pages.yml 用的是 tools/assemble-site.sh 这份清单',
    'workflow 里没有 ' + ASSEMBLE + '，CI 拷的是另一份清单，本闸验的不是上线那份');
}

// ---- 产物 ----
const given = process.argv[2];
let site;
let cleanup = false;
if (given) {
  site = path.resolve(given);
  if (!fs.existsSync(path.join(site, 'index.html'))) {
    console.log('FATAL 传进来的产物目录里没有 index.html：' + site);
    console.log('rows: 0');
    process.exit(1);
  }
} else {
  site = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-deploy-set-'));
  cleanup = true;
  try {
    execFileSync('bash', [path.join(ROOT, ASSEMBLE), site], { stdio: 'pipe' });
  } catch (e) {
    console.log('FATAL assemble 失败：' + (e.stderr || e.message).toString().trim());
    console.log('rows: 0');
    process.exit(1);
  }
}

const strip = (p) => p.split('?')[0].split('#')[0].trim();
// base = 出处文件所在目录（相对站点根）；返回相对站点根的路径，或 null 表示逃逸
const resolveIn = (base, spec) => {
  const joined = path.posix.normalize(path.posix.join(base, spec));
  return joined.startsWith('../') || joined.startsWith('/') ? null : joined;
};
const present = (r) => {
  const f = path.join(site, r);
  return fs.existsSync(f) && fs.statSync(f).size > 0;
};

const refs = []; // [出处, 基准目录, 原始串]
const isExternal = (s) => ['data:', 'mailto:', 'blob:', 'http:', 'https:', '#'].some((p) => s.startsWith(p));

// ---- B：index.html ----
const html = readIf(path.join(ROOT, 'index.html')) || '';
for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
  const s = strip(m[1]);
  if (!s || isExternal(s)) continue;
  refs.push(['index.html', '.', s]);
}

// ---- B：manifest ----
const mfText = readIf(path.join(ROOT, 'manifest.webmanifest'));
ok(mfText !== null, 'B1 manifest.webmanifest 在仓库根', '');
let mf = null;
if (mfText !== null) {
  try { mf = JSON.parse(mfText); } catch (e) { ok(false, 'B2 manifest 解析得了', String(e.message)); }
}
if (mf) {
  for (const k of ['icons', 'screenshots']) {
    for (const i of mf[k] || []) if (i.src) refs.push(['manifest.' + k, '.', strip(i.src)]);
  }
  for (const s of mf.shortcuts || []) if (s.url) refs.push(['manifest.shortcuts', '.', strip(s.url)]);
  const missing = ['name', 'short_name', 'start_url', 'scope', 'display', 'theme_color',
    'background_color'].filter((k) => !mf[k]);
  ok(missing.length === 0, 'B3 manifest 七个必填字段都在', '缺 ' + missing.join(','));
  const big = (mf.icons || []).filter((i) => parseInt(String(i.sizes || '0x0'), 10) >= 512);
  ok(big.length > 0, 'B5 manifest 有 >=512 的图标（Chrome 否则不给安装提示）', '');
}

// ---- B：CSS 的 url() —— 基准是这支 CSS 自己的目录 ----
for (const f of fs.readdirSync(path.join(ROOT, 'css'))) {
  if (!f.endsWith('.css')) continue;
  const css = readIf(path.join(ROOT, 'css', f)) || '';
  for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
    const s = strip(m[1]);
    if (!s || isExternal(s)) continue;
    refs.push(['css/' + f, 'css', s]);
  }
}

// ---- B：JS —— new URL(spec, import.meta.url) 以模块目录为基准；SW 注册以站点根为基准 ----
const jsFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(path.join(dir, e.name));
    else if (e.name.endsWith('.js')) jsFiles.push(path.relative(ROOT, path.join(dir, e.name)).split(path.sep).join('/'));
  }
})(path.join(ROOT, 'js'));
for (const f of jsFiles) {
  const src = readIf(path.join(ROOT, f)) || '';
  const dir = path.posix.dirname(f);
  for (const m of src.matchAll(/new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g)) {
    refs.push([f, dir, strip(m[1])]);
  }
  for (const m of src.matchAll(/serviceWorker\.register\(\s*['"]([^'"]+)['"]/g)) {
    refs.push([f + '(SW注册)', '.', strip(m[1])]);
  }
}

// ---- B/C：逐条判定 ----
let checks = 0;
const seen = new Set();
for (const [from, base, spec] of refs) {
  if (spec.startsWith('/')) {
    checks += 1;
    ok(false, `C1 绝对路径 ${spec} 会在 Pages 的 /<repo>/ 前缀下跳出项目站`, '出处 ' + from);
    continue;
  }
  const r = resolveIn(base, spec);
  checks += 1;
  if (r === null) {
    ok(false, `C2 ${spec} 相对出处 ${from}（基准 ${base || '.'}）逃逸出站点根`, '');
    continue;
  }
  if (seen.has(r)) continue; // 同一目标从 CSS 与 JS 各指一次，只算一次存在性
  seen.add(r);
  ok(present(r), `B8 ${r} 在部署产物里且非 0 字节`, '出处 ' + from + '（基准 ' + (base || '.') + '）');
}
ok(checks > 0, 'B9 至少解析出一条引用（0 条=引用没被读到，不是全都齐）', '实际 ' + checks + ' 条');
ok(checks === EXPECT_CHECKS, `B10 引用条数等于钉在文件里的 EXPECT_CHECKS（${EXPECT_CHECKS}）`,
  '实际 ' + checks + ' 条：改了页面就把 EXPECT_CHECKS 一起改，别让它默默变少');

// ---- D ----
let bitmaps = 0;
if (mf) {
  for (const i of mf.icons || []) {
    if (!i.src || !/\.png$/.test(i.src)) continue;
    const r = resolveIn('.', strip(i.src));
    if (!r) continue; // C2 已经报过
    bitmaps += 1;
    const f = path.join(site, r);
    if (!fs.existsSync(f)) continue; // B8 已经报过缺文件
    const head = fs.readFileSync(f).subarray(0, 24);
    const isPng = head.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
    ok(isPng, `D1 ${r} 是真 PNG 容器`, '不是 PNG 签名');
    if (!isPng) continue;
    const [dw, dh] = String(i.sizes || '').split('x').map(Number);
    if (dw) ok(head.readUInt32BE(16) === dw && head.readUInt32BE(20) === dh,
      `D2 ${r} 实际 ${head.readUInt32BE(16)}x${head.readUInt32BE(20)} 等于 manifest 声明的 ${i.sizes}`, '');
  }
}

if (cleanup) fs.rmSync(site, { recursive: true, force: true });

// 比较发生在计数之前，所以这里比的是"含这一条"的总数
ok(rows + 1 === EXPECT_ROWS, `E1 这一次跑出的断言条数（含这一条）等于钉在文件里的 EXPECT_ROWS（${EXPECT_ROWS}）`,
  '实际 ' + (rows + 1) + ' 条');

for (const f of fails) console.log('  FAIL ' + f);
console.log(`部署集：${checks} 条引用（去重后 ${seen.size} 个目标，含 ${bitmaps} 张位图尺寸核对），失败 ${fails.length} 项`);
console.log(`rows: ${rows} fail: ${fails.length}`);
process.exit(fails.length === 0 && rows > 0 ? 0 : 1);
