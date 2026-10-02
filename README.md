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
- 规模：14 个 ES Module / 2,846 行 JS + 7 个验证脚本 / 2,013 行 + 734 行 CSS/HTML，**运行时依赖 0 个**。
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

`npm run verify` 自己起服务、自己开 Chrome、自己收尾，退出码即结论（共 154 项断言）：

```
=== engine ===   14 checks, 0 failed   {tier: apprentice, score: 12.3}
=== gen ===      39 checks, 0 failed   {perTier: {trainee: 7.3, apprentice: 13.4, regular: 17.7, expert: 22.8, master: 32.1}}
=== play ===     29 checks, 0 failed   {cells: 64, hints: 26}
=== hint ===     16 checks, 0 failed   {boards: 3, hintsGiven: 90, boardsClearedByHints: 3}
=== save ===     20 checks, 0 failed   {storedBytes: 260}
=== resume ===   17 checks, 0 failed   {name: 灯下尽头, tier: apprentice}
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
tools/                引擎断言、难度实测台、文档数字闸、破坏试验台账、CDP 驱动、浏览器场景、一键验证
```

---

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
- 存档不含解也不含墙：盘面由种子重新生成，260 字节能装下 10×10 的一局。

---

## 文档数字闸（doctest）与破坏试验台账（sabotage）

上面每一处数字都由 `tools/doctest.mjs` 现算对表：档位与 band 读 `js/engine/generate.js:15-21` 的 `TIERS`
现值，六条铅笔规则读 `js/engine/akari.js:19-26` 的 `Rules` 现值，成组枚举上限读 `js/engine/akari.js:214`
那一行的 `open.length > 12`，分位与入选是现场跑一遍 `tools/balance.mjs`（每档张数由
`tools/balance.mjs:13` 的 `SAMPLES` 决定），77 项引擎断言是现场跑一遍 `tools/engine-test.mjs`，
端口对 `tools/verify.sh:17` 与 `package.json` 的 dev，CI 的接线对 `.github/workflows/ci.yml:35`
（同一个 check job 里 40–44 行就是这两道文档闸自己的步骤）。**代码是真相**：文档与代码不一致时改文档，不许把断言改松。

- 本闸 16 组 / 165 项等式的体量自钉在 `tools/doctest.mjs:33-34`（`EXPECT_GROUPS` / `EXPECT_ROWS`）：
  明天删掉 20 条断言，`rc=0` 也救不了这一行——闸变窄就是红。`tools/verify.sh` 的 `LOGIC_EXPECTS` 钉的是
  同一组数，两处必须一致。
- `tools/sabotage.mjs:30` 的破坏试验台账（5 把刀）把「文档抄了一个已经不存在的数」逐类塞回代码：
  K1 改 band、K2 改铅笔规则名、K3 改 `server.cjs` 的默认端口、K4 从浏览器场景注册表里摘掉一个场景、K5 抬走格子下限；
  每把刀都必须把**它点名的那一条**断言逼红，只红在别处不算逼到，复原只认内存里的原始字节。
- 只有本机墙钟那一类读数不参与等式（见上一节的 ms 说明）：钉不住 ≠ 可以删，文档里删掉它台账就红。

```bash
npm run doctest   # 文档 == 代码 / balance / engine-test 现跑（不开浏览器，秒级）
npm run sabotage  # 破坏试验台账：五把刀各自逼红点名的断言
```

## 部署

`main` 分支推送 → `.github/workflows/pages.yml` 把 `index.html` + `css` + `js` 复制成静态站点
（无打包器，也就不用打包器），再发布到 Pages。`.github/workflows/ci.yml` 在没有浏览器的情况下
把引擎的三条承诺全部跑一遍。

## 许可

MIT。
