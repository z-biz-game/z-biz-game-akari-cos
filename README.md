# 明路 · Akari（零猜测灯塔推理）

> *灯照亮的不是格子，是推理的下一步。每一局都在出货前被铅笔求解器跑过一遍，唯一解由第二套独立代码复核。*

浏览器原生的 **Akari / 灯塔**：无构建步骤、无打包器、**零美术与音频文件**——棋盘、光束、灯、
铅笔叉全部由 canvas 现画，音效由 WebAudio 合成，界面只有一个 `<canvas>`。

- **核心承诺 1｜零猜测**：出货的每一局都能 **只用六条铅笔规则从空盘推到底**。这不是文案，是准入门槛——
  `solve()` 推不到底的候选盘直接丢弃。
- **核心承诺 2｜唯一解**：`countSolutions()` 是一台**不带任何推理逻辑**的逐格穷举计数器，
  它和铅笔求解器从两个方向回答同一个问题；两者不一致的盘不出货。
- **核心承诺 3｜提示不是答案**：提示走的是**同一个** `nextDeduction()`，所以它必须点名用了哪条规则、
  钉在哪一格；推不出东西时它不收钱，只说"当前没有可推导的格"。
- 难度不是标签：`见习 → 大师` 五档的分数带由求解器**实测**得出（`npm run balance` 打印分位表），
  `TIERS` 里的 `band` 是**选取目标**——每档一直抽盘，直到分数落进自己的区间，`balance` 再盯着这件事不许漂移。
- 规模：14 个 ES Module / 2,846 行 JS + 10 个验证脚本 / 2,870 行 + 758 行 CSS/HTML，**运行时依赖 0 个**。
- **在线试玩**：<https://z-biz-game.github.io/z-biz-game-akari-cos/>（`main` 分支推送即自动部署）

---

## 快速开始

```bash
npm start            # 零依赖静态服务 → http://127.0.0.1:5173
npm run dev          # 本项目专用端口 5247（验证脚本用同一个）
npm run electron     # 桌面壳（electron/main.cjs，同一份代码）
```

```bash
npm run check        # 逐文件 node --check 语法门禁
npm test             # 引擎断言 77 项：规则可靠性 / 生成保证 / 状态机 / 存档形状
npm run balance      # 难度实测台：每档分数分位、入选率、求解代价、档位阶梯门禁
npm run verify       # 无头 Chrome 跑 7 个浏览器场景（需本机 Chrome，见下）
```

`npm run verify` 自己起服务、自己开 Chrome、自己收尾，退出码即结论（共 155 项断言）：

```
=== engine ===   14 checks, 0 failed   {tier: apprentice, score: 12.3}
=== gen ===      39 checks, 0 failed   {perTier: {trainee: 7.3, apprentice: 13.4, regular: 17.7, expert: 22.8, master: 32.1}}
=== play ===     29 checks, 0 failed   {cells: 64, hints: 26}
=== hint ===     16 checks, 0 failed   {boards: 3, hintsGiven: 90, boardsClearedByHints: 3}
=== save ===     20 checks, 0 failed   {storedBytes: 260}
=== resume ===   18 checks, 0 failed   {name: 灯下尽头, tier: apprentice}
=== layout ===   19 checks, 0 failed   {cell: 52, dpr: 1}
=== ALL GREEN ===
```

同一套断言可以直接打线上产物，部署过没部署过不是一句声明：

```bash
BASE_URL=https://z-biz-game.github.io/z-biz-game-akari-cos/ npm run verify
```

---

## 玩法

| 操作 | 行为 |
|---|---|
| 点一个空格 | 放灯（当前模式）。灯沿直线照亮整条走廊，墙挡光 |
| 点在已有的记号上 | 擦掉它——同一条规则同时管两种模式，不用记两套手势 |
| 按住拖过若干格 | 一笔铺满这条线，**算一步**：撤销退的是整笔，不是半笔 |
| 切「画叉」 | 铅笔叉：这里放不下灯。叉**不挡光**，被划掉的格照样要被照亮 |
| `H` / `Z` / `M` | 提示 / 撤销 / 切换模式 |

规则口径（写错任何一条，整个盘面判断都会崩，所以它们同时是 `tools/engine-test.mjs` 的断言）：

1. 一条线上不能有两盏灯；
2. 每个空格必须被至少一盏灯照亮（横照或竖照都算）；
3. 墙上数字 = 它四邻的灯数，**多一个也不行**；
4. 一条线**不要求**有自己的灯——线上的格可以被横着的灯照亮；
5. 铅笔叉是玩家自己的笔记，对灯光是透明的。

---

## 五档，量出来的

`npm run balance`（每档 40 局）打印的实测结果，`TIERS` 的 `band` 就照这张表写：

| 档位 | 盘面 | 墙密度 | 留线索 | 目标分 | 实测中位 | 入选 | 唯一光源次数 | 反证次数 |
|---|---|---|---|---|---|---|---|---|
| 见习 | 8×8 | 0.34 | ~65% | 4–10 | 8.5 | 40/40 | 4 | 0 |
| 熟练 | 8×8 | 0.40 | ~45% | 10–15.5 | 12.6 | 40/40 | 6 | 0 |
| 老手 | 10×10 | 0.34 | ~30% | 15.5–21 | 19.1 | 39/40 | 9 | 0 |
| 专家 | 10×10 | 0.40 | ~10% | 21–27 | 23.3 | 40/40 | 11 | 1 |
| 大师 | 12×12 | 0.40 | ~0% | 27–34 | 29.0 | 40/40 | 15 | 0 |

- 出题耗时：最慢档位 **49 ms/局**（大师，含 22 次尝试）——这一列是**本机墙钟**读数、**会随机器漂**，
  所以本仓**不设 `budgetMs` 门禁**，`doctest` 只钉"最慢的是大师"这个方向；桌面端点「换一局」是即时的。
- 穷举复核：**18/18 局**独立计数器与铅笔求解器的唯一解判定一致；五档的复解全部一致。
- 填灯器产出的 60/60 个盘面合法（`placeBulbs` 是唯一允许回溯的地方）。

---

## 目录

```
index.html            两个视图：选档 / 对局（六条规则的入门说明也在这里）
css/game.css          只读 var(--token)，不写颜色字面量
js/theme.js           颜色 / 间距 / 动效的唯一来源，注入为 CSS 自定义属性
js/engine/rng.js      可复现的字符串种子
js/engine/akari.js    棋盘模型 + 铅笔求解器（玩家唯一可走的路）
js/engine/fill.js     出题用的 CSP 填灯器（全项目唯一允许回溯的地方）
js/engine/count.js    逐格穷举解数计数器（独立复核唯一解）
js/engine/generate.js 墙图案 → 线索修剪 → 评分 → 五档表
js/ui/game.js         状态机：点击 / 一笔 / 撤销 / 提示 / 判胜
js/render/board.js    布局 + 命中测试 + canvas 绘制
js/render/fx.js       灯亮的绽放、提示的呼吸脉冲、放灯与收官的光尘
js/render/sheets.js   位图资产加载器：图没到之前画矢量版本，到了之后换成图
js/audio/synth.js     七个合成音效
js/store.js           单键存档：设置 / 纪录 / 续局（游程编码）
js/main.js            接线：DOM、手势、计时、window.akari
js/sw-register.js     注册 Service Worker（离线可开；Pages 上刷新不丢局）
tools/                引擎断言、难度实测台、文档数字闸、破坏试验台账、上线清单与部署集闸、CDP 驱动、浏览器场景、一键验证 / tools/assemble-site / tools/deploy-set / tools/deploy-set-selftest
```

---
tools/assemble-site.sh  部署产物的唯一清单（pages.yml 与本地闸调同一支）
tools/deploy-set.mjs  部署集闸：检查即将上传的那份产物
tools/deploy-set-selftest.mjs  部署集闸的阴性自证（每一类断言当场打红一次）

## 验证在验证什么

`tools/scenarios.js` 只读 **DOM 几何**和 **canvas 像素**，不读 `.hidden` 标志——状态对而画面错、
状态对而点击差一格，是这个游戏真正会犯的错，而标志位看不见它。举几条：

- 逐格往返：渲染器认为某格在哪个点，命中测试就必须把那个点还回同一格（100 格全跑）。
- 留白不属于棋盘：`box.left + 2` 必须返回 `-1`，盘外点击不落子也不记账。
- 窗口变窄时棋盘跟着收缩，且收缩后仍在 18–52 px 的可读区间内。
- 未亮的格比已亮的格更偏蓝、灯是暖色、墙上的数字**真的被画出来了**（数亮像素）。
- 提示写的每一个格都必须等于唯一解的那一格——90 次提示逐格核对，不是聚合统计。
- 满盘涂灯（明亮、非法）不判胜；同线两盏灯判 2 处冲突；撤掉一盏后冲突清零、灯数读数跟着走。
- 撤销提示**不退**求助次数；纪录先比提示次数，再比步数，最后才比时间。
- 总局数那本账按**等式**对：`totals.hints` 等于这一局的提示数、`totals.ms` 等于这一局的用时。
  上一轮这一条写的是 `totals.ms > 0`，而一次性推完整盘时，冷启动要花几十毫秒、页面热过身后
  就能落在同一毫秒里——完整序列读出 `ms: 0` 判红、单跑这一步却是绿的。现在先让计时走出一格
  再收官，正数不再由热身顺序决定，红的時候一定是记账真的错了。
- 存档不含解也不含墙：盘面由种子重新生成，260 字节能装下 10×10 的一局。

---

## 文档数字闸（doctest）与破坏试验台账（sabotage）

上面每一处数字都由 `tools/doctest.mjs` 现算对表：档位与 band 读 `js/engine/generate.js:15-21` 的 `TIERS`
现值，六条铅笔规则读 `js/engine/akari.js:19-26` 的 `Rules` 现值，成组枚举上限读 `js/engine/akari.js:214`
那一行的 `open.length > 12`，分位与入选是现场跑一遍 `tools/balance.mjs`（每档张数由
`tools/balance.mjs:13` 的 `SAMPLES` 决定），77 项引擎断言是现场跑一遍 `tools/engine-test.mjs`，
端口对 `tools/verify.sh:17` 与 `package.json` 的 dev，CI 的接线对 `.github/workflows/ci.yml:35`
（同一个 check job 里 40–44 行就是这两道文档闸自己的步骤）。**代码是真相**：文档与代码不一致时改文档，不许把断言改松。

- 本闸 16 组 / 174 项等式的体量自钉在 `tools/doctest.mjs:33-34`（`EXPECT_GROUPS` / `EXPECT_ROWS`）：
  明天删掉 20 条断言，`rc=0` 也救不了这一行——闸变窄就是红。`tools/verify.sh` 的 `LOGIC_EXPECTS` 钉的是
  同一组数，两处必须一致。
- `tools/sabotage.mjs:33` 的破坏试验台账（16 把刀）把「文档抄了一个已经不存在的数」逐类塞回代码，doctest 的 16 个组一组一把：
  K1 改 band、K2 改铅笔规则名、K3 改 `server.cjs` 的默认端口、K4 从浏览器场景注册表里摘掉一个场景、K5 抬走格子下限、
  K6 改 balance 表头那句留线索百分比的换算、K7 把填灯器样本量偷偷加一局、K8 把一条引擎断言的期望从 0 改成 1、
  K9 往 index.html 顶上塞一行注释、K10 把成组上限那行与下一行换位（行为一字不差，只有引用的行号漂到隔壁）、
  K11 改掉 `npm run doctest` 这个入口、K12 让两把刀打同一组、K13 在 balance 的头注释里写出 budgetMs 这个词、
  K14 把 unpinned 清单的 needle 改成一个文档里根本没有的数、K15 把本闸钉的项数悄悄改小 1、
  K16 把 balance 顶部的空行挪到下一句之后（总行数一字不差，只有引用落到空行上）；
  每把刀都必须把**它点名的那一条**断言逼红，只红在别处不算逼到，复原只认内存里的原始字节。
- 只有本机墙钟那一类读数不参与等式（见上一节的 ms 说明）：钉不住 ≠ 可以删，文档里删掉它台账就红。

```bash
npm run doctest    # 文档 == 代码 / balance / engine-test 现跑（不开浏览器，秒级）
npm run sabotage   # 破坏试验台账：十六把刀各自逼红点名的断言
npm run deploy-set # 部署集闸：按上线那份清单拷一遍产物，再逐条核对页面会要的路径
```

## 上线的到底是哪一批文件（部署集闸）

本地没有构建步骤：`index.html` 直读仓库根，所以本地永远自洽。而 Pages 上跑的
是 `tools/assemble-site.sh` 拷出来的那一份产物。这两份东西一旦分家，坏法是**静默**的——
引擎断言、文档数字闸、浏览器场景全都在仓库根上跑，一条都不会红，线上却是 404。
这一轮就是它：`sw.js`、`manifest.webmanifest`、`icons/` 全套、CSS 里那张
`assets/textures/night-field.png` 与 `js/render/sheets.js` 要的两张纹理，线上全部 404
（`css/game.css` 是唯一还 200 的），而 workflow 里那句注释还写着「只有 index.html / css / js 可达」。

`tools/deploy-set.mjs` 先把产物真拷一遍（不带参数就自己拷到临时目录，带参数就检查 CI 那份
`_site`——**检查的就是即将上传的那一批文件**），再把页面会去要的每个字符串解析成一条路径。
这里的关键是**基准目录**：同一个字符串在不同出处指向不同文件，全部当成站点根来算，
既会把越级路径误判成逃逸，也会把真正缺的文件判成存在。

| 出处 | 基准 | 这一仓里的实例 |
|---|---|---|
| `index.html` 的 `href` / `src` | 站点根 | `icons/favicon-16.png`、`manifest.webmanifest` |
| `manifest.webmanifest` 的 `icons` / `screenshots` / `shortcuts` | manifest 自己所在目录 | 根，故直接落在 `icons/*` |
| `css/*.css` 的 `url()` | 那支 CSS 文件所在目录 | `../assets/textures/night-field.png` → `assets/textures/…` |
| `js/**/*.js` 的 `new URL(rel, import.meta.url)` | 那个模块所在目录 | `js/render/sheets.js` 的 `../../assets/…` |
| `navigator.serviceWorker.register('sw.js')` | 文档基准（站点根） | HTML 里搜不到它，只看 `href` 的检查看不见这一条 |

三段断言各管一种真实的坏法：W 清单与页面同源（`pages.yml` 里必须真有 `run: bash tools/assemble-site.sh <dir>`
那一行、`ci.yml` 里必须真有 `run: node tools/deploy-set.mjs`——认的是调用那一行，不是文件里出现过这个路径，
否则一句散文就能把它喂绿）、R 引用可达（从 `index.html` 的 `href/src` 出发，凡解析出来是 `.js`/`.css` 的
就把那一站也扫一遍，manifest 的 icons/screenshots/shortcuts 各自的 `src` 也算引用；含「一条引用都没解析到
也算红」的反空转，以及「不许绝对路径与逃逸」——`/sw.js` 在 Pages 的 `/<repo>/` 前缀下会跳出项目站）、
P 位图不许说谎（manifest 声明的 `sizes` 必须等于 PNG 头部 IHDR 的真实宽高：文件图标读文件头，
内联成 base64 的图标先解码再读同一段——本仓那枚分发母本就是内联的，只筛文件名的话它一路不被核）。

- 本闸 85 条断言 / 51 条引用的体量钉在 `tools/deploy-set.mjs:34-38`（`EXPECT_CHECKS` / `EXPECT_ROWS`）：
  一个是引用条数、一个是断言条数。删掉一段断言、或者把页面里的一条引用改到闸读不到的写法上，`rc=0` 都救不了。
  `tools/verify.sh` 的 `DEPLOY_SET_ROWS_WANT` 是同一颗钉的第二份抄本，doctest 的 D12k 要求两处相等，
  D12q 要求文档上面那句也等于代码里的现值。
- 接线同样有闸：D12l–D12q 逐条核对 `package.json` 有这条 script、`verify.sh` 接了它且 rc 与条数都折进
  `FAILED`、它排在启动 Chrome 之前、`ci.yml` 的 check job 里有它、`pages.yml` 拷的就是那支清单。
  这六条各自做过盲测（把对应文件改坏一处，看是不是**只有点名的那条**红）：六条都能红，复原逐字节一致；
  其中 D12m 与 D12n 读的是同一个调用点，所以改坏调用点时两条一起红。少掉任何一侧都会红——
  这道闸防的就是「CI 绿而线上 404」，它自己绝不能只在一侧跑。
- 阴性对照两次（把刀落在**产物**上，仓库根一个字节都不动，`bash tools/assemble-site.sh _site` 先拷出
  一份干净的）：从 `_site` 删掉 `sw.js` → `FAIL R10 sw.js 在部署产物里且非 0 字节 · 出处 js/sw-register.js`，
  `rc=1`，`rows: 85` 一条不少（那条引用还在，只是判红）；换一份干净产物只挪走 `icons/icon-192.png` →
  `FAIL R10 icons/icon-192.png …` **两条**（同一张图分别被 `index.html` 与 `manifest.icons` 要）
  并且**多红一条 R13**（那张图的 P1/P2 两条尺寸核对因文件不在而没有发出来，这一跑的 rows 于是比钉的少两条，
  实际 83 条）。原字节放回去之后 `rc` 回到 0，`rows: 85`。

`server.cjs` / `electron/` / `tools/` / 三份文档都不进站——`tools/` 里全是开发期的闸，
把它们放进去只是把 `node_modules` 大小的东西推到公网。
`.github/workflows/ci.yml` 在没有浏览器的情况下把引擎的三条承诺与这道部署集闸全部跑一遍。

## 许可

MIT。
