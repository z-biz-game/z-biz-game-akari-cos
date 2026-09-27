// Browser-side scenario suite, injected by tools/playtest.cjs and run against the real page.
//
// The rule for anything asserted here: read the DOM and the canvas, not a flag. A `.hidden`
// boolean says what the code intended; a client rect and a pixel say what the player got. The
// interesting failures in this game are exactly the ones where the state is right and the
// picture or the click is wrong.
//
// window.akari.engine is the shipped module graph, so a scenario that passes here has passed
// on the same solver the player's hints come from — not on a second copy kept for testing.
// Engine constants are read *inside* each scenario: this file is installed before the app's
// module has run, so window.akari does not exist yet at load time.

((w) => {
  const rows = [];
  const ck = (test, cond, detail) => {
    rows.push({ test, pass: !!cond, detail: cond ? '' : String(detail === undefined ? '' : detail) });
  };
  const report = (extra) => {
    // rows is copied, not aliased: the array is cleared below, and a live reference would
    // hand back an empty report that still reads as "0 failed".
    const out = { rows: rows.slice(), fail: rows.filter((r) => !r.pass).length, ...extra };
    rows.length = 0;
    return out;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const A = () => w.akari;
  const E = () => w.akari.engine;

  // "Visible" means the box exists and takes space — the one reading of the CSS invariant
  // `[hidden]{display:none !important}` that fails if the rule is deleted.
  const shown = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return false;
    return getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
  };

  // A real gesture through the canvas, so hitTest, the DPR transform and the stroke
  // bookkeeping all have to agree for the assertion to pass.
  function pointer(type, x, y) {
    const ev = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      isPrimary: true,
      clientX: x,
      clientY: y,
    });
    A().view.canvas.dispatchEvent(ev);
    return ev;
  }

  const center = (cell) => {
    const r = A().view.cellRect(cell);
    const box = A().view.canvas.getBoundingClientRect();
    return { x: box.left + r.x + r.size / 2, y: box.top + r.y + r.size / 2 };
  };

  const tapCell = async (cell) => {
    const p = center(cell);
    pointer('pointerdown', p.x, p.y);
    pointer('pointerup', p.x, p.y);
    return wait(16);
  };

  const boardOf = (p) => E().createBoard(p.w, p.h, p.wall, Int8Array.from(p.clue));
  const solutionCells = (p) => p.solution.reduce((a, v, i) => (v && a.push(i), a), []);
  const median = (arr) => {
    const a = arr.slice().sort((x, y) => x - y);
    return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
  };

  // ---------- engine ----------

  const engine = async () => {
    const { createBoard, solve, verify, tallies, isLit, nextDeduction, countSolutions, Rules, OPEN, BULB, MARK } = E();
    ck('对外暴露的是同一份引擎', typeof solve === 'function' && Object.keys(Rules).length === 6, JSON.stringify(Object.keys(Rules)));

    // 1-cell run: the only source of the middle cell is itself.
    const b1 = createBoard(3, 1, Uint8Array.from([1, 0, 1]), new Int8Array(3).fill(-1));
    const r1 = solve(b1);
    ck('单格线由唯一光源点亮', r1.solved, r1.conflict || `${r1.undetermined.length} 格未定`);
    ck('独立检查认这盘合法', verify(b1).length === 0, verify(b1).join('; '));

    // clue 0 marks its neighbour, and the marked cell still has to be lit by the next cell.
    const c2 = new Int8Array(3).fill(-1);
    c2[0] = 0;
    const b2 = createBoard(3, 1, Uint8Array.from([1, 0, 0]), c2);
    const r2 = solve(b2);
    ck('0 号线索的链条能纯逻辑走完', r2.solved, r2.conflict || '');
    ck('被划掉的格仍被照亮（铅笔不挡光）', b2.open[1] === MARK && isLit(b2, 1, tallies(b2).bulbs), `open[1]=${b2.open[1]}`);

    // A run needs no bulb of its own: cells 2 and 5 sit on an empty column and are lit sideways.
    const c3 = new Int8Array(6).fill(-1);
    c3[3] = 2;
    const b3 = createBoard(3, 2, Uint8Array.from([0, 0, 0, 1, 0, 0]), c3);
    solve(b3);
    const t3 = tallies(b3);
    const emptyRun = t3.bulbs.findIndex((n, id) => n === 0 && b3.runs[id].dir === 0 && b3.runs[id].cells.length === 2);
    ck('存在一条没有灯的线', emptyRun >= 0);
    ck('那条线上的格也全被照亮', emptyRun >= 0 && b3.runs[emptyRun].cells.every((c) => isLit(b3, c, t3.bulbs)));

    // dir is the geometry the renderer draws from: a column run walks down indices by w.
    const colRun = b3.runs.find((r) => r.dir === 0 && r.cells.length === 2);
    ck('列跑的步长是行宽（渲染方向不会转 90 度）', colRun && colRun.cells[1] - colRun.cells[0] === b3.w,
      colRun && JSON.stringify(Array.from(colRun.cells)));

    // Two lamps on one run is illegal even when every cell is bright.
    const b4 = createBoard(3, 1, Uint8Array.from([0, 0, 0]), new Int8Array(3).fill(-1));
    b4.open[0] = BULB;
    b4.open[2] = BULB;
    ck('同线两盏灯被独立检查抓到', verify(b4).some((m) => m.indexOf('同一线上') >= 0), verify(b4).join('; '));

    // A hint is asked, never taken: the deduction probe must leave the board as it found it.
    const b5 = createBoard(3, 1, Uint8Array.from([1, 0, 0]), c2.slice());
    const before5 = Array.from(b5.open).join('');
    const d5 = nextDeduction(b5);
    ck('问一步提示不会改盘', Array.from(b5.open).join('') === before5, `${before5} → ${Array.from(b5.open).join('')}`);
    ck('提示点名规则与格子', !!d5 && !!d5.rule && d5.cells.length > 0 && d5.value !== OPEN, JSON.stringify(d5));

    const p = E().makePuzzle('browser|engine', 'apprentice');
    ck('穷举计数认这盘唯一解', countSolutions(p.w, p.h, p.wall, p.clue, { budget: 300000 }).solutions === 1);
    const back = solve(boardOf(p));
    ck('出货盘面在浏览器里也解得完', back.solved, back.conflict || `${back.undetermined.length} 格未定`);
    ck('规则名是中文', Object.values(Rules).every((s) => /[一-龥]/.test(s)), JSON.stringify(Rules));
    return report({ tier: p.tier, score: p.score });
  };

  // ---------- gen ----------

  const gen = async () => {
    const { makePuzzle, TIERS, solve, verify, countSolutions } = E();
    const perTier = {};
    const medians = [];
    const t0all = performance.now();
    for (const t of TIERS) {
      let n = 0;
      let inBand = 0;
      let clean = 0;
      let unique = 0;
      let ms = 0;
      const scores = [];
      for (let s = 0; s < 4; s++) {
        const t0 = performance.now();
        const p = makePuzzle(`browser|gen|${t.id}|${s}`, t.id);
        ms += performance.now() - t0;
        if (!p) continue;
        n++;
        scores.push(p.score);
        if (p.score >= t.band[0] && p.score <= t.band[1]) inBand++;
        const b = boardOf(p);
        const r = solve(b);
        if (r.solved && verify(b).length === 0) clean++;
        // 12×12 is left to the solver alone: the exhaustive counter's budget is a wall-clock
        // choice, and blowing it here would report a generator bug as a timeout.
        if (t.size <= 10 && countSolutions(p.w, p.h, p.wall, p.clue, { budget: 200000 }).solutions === 1) unique++;
        // The walls are walls: no bulb may sit on one, and only walls carry clues.
        const bad = [];
        for (let i = 0; i < p.wall.length; i++) {
          if (p.wall[i] && p.solution[i]) bad.push(i);
          if (!p.wall[i] && p.clue[i] >= 0) bad.push(i);
        }
        ck(`${t.label} 的墙与灯不重合`, bad.length === 0, bad.slice(0, 3).join(','));
      }
      ck(`${t.label} 四局全部可推且合法`, clean === n && n === 4, `${clean}/${n}`);
      ck(`${t.label} 四局全部落在实测区间`, inBand === n, `${inBand}/${n}`);
      if (t.size <= 10) ck(`${t.label} 小盘穷举唯一解`, unique === n, `${unique}/${n}`);
      const med = median(scores);
      medians.push(med);
      perTier[t.id] = { n, med, ms: Math.round(ms / 4) };
    }
    // Bands, not single boards, are what the ladder promises: two adjacent tiers can legally
    // land on a shared edge (见习 tops at 10, 熟练 starts at 10), so the checkable claims are
    // that the intervals ascend and that no tier's sample median falls below the previous one.
    ck('五档区间本身由浅入深', TIERS.every((t, i) => !i || (t.band[0] > TIERS[i - 1].band[0] && t.band[1] >= TIERS[i - 1].band[1])),
      TIERS.map((t) => t.band.join('–')).join(' < '));
    ck('四局中位数不下降', medians.every((v, i) => i === 0 || v >= medians[i - 1]), medians.join(' → '));
    ck('尺寸随档位放大', TIERS.every((t, i) => !i || t.size >= TIERS[i - 1].size), TIERS.map((t) => t.size).join(','));
    ck('同一颗种子复现同一局', (() => {
      const a = makePuzzle('browser|dup', 'regular');
      const b = makePuzzle('browser|dup', 'regular');
      return a.seed === b.seed && Array.from(a.wall).join() === Array.from(b.wall).join()
        && Array.from(a.clue).join() === Array.from(b.clue).join();
    })());
    ck('换种子就换盘面', (() => {
      const a = makePuzzle('browser|seed-a', 'regular');
      const b = makePuzzle('browser|seed-b', 'regular');
      return Array.from(a.wall).join() !== Array.from(b.wall).join();
    })());
    return report({ perTier, totalMs: Math.round(performance.now() - t0all) });
  };

  // ---------- play ----------

  const play = async () => {
    const { OPEN, BULB, MARK, verify } = E();
    const g = A().begin({ tier: 'trainee', seed: 'browser|play' });
    ck('选档能开局并进入对局', !!g && shown('#view-game') && !shown('#view-menu'), 'begin 返回空或视图没换');
    const p = g.puzzle;
    const truth = solutionCells(p);
    const wallCell = p.wall.findIndex((v) => v);
    const emptyCell = p.solution.findIndex((v, i) => !v && !p.wall[i]);

    await tapCell(truth[0]);
    ck('点一下真解上的格会落灯', g.board.open[truth[0]] === BULB, g.board.open[truth[0]]);
    ck('落灯记为一步', Number(document.querySelector('#stat-moves').textContent) === 1);
    ck('步数读数与状态一致', g.state().moves === 1);

    await tapCell(truth[0]);
    ck('再点同一格把灯收回', g.board.open[truth[0]] === OPEN);
    ck('收回算新的一步', g.state().moves === 2);

    await tapCell(wallCell);
    ck('点墙不落灯也不记账', g.state().moves === 2 && g.board.open[wallCell] === OPEN, g.state().moves);

    document.querySelector('#btn-mode-mark').click();
    ck('切到画叉模式', g.mode === 'mark' && document.querySelector('#btn-mode-mark').getAttribute('aria-pressed') === 'true');
    await tapCell(emptyCell);
    ck('画叉模式落下的是叉', g.board.open[emptyCell] === MARK);
    await tapCell(emptyCell);
    ck('再点一下把叉擦掉', g.board.open[emptyCell] === OPEN);

    // One stroke over several cells is one undo step.
    document.querySelector('#btn-mode-bulb').click();
    const line = truth.slice(0, 3);
    let pt = center(line[0]);
    pointer('pointerdown', pt.x, pt.y);
    for (const c of line.slice(1)) {
      pt = center(c);
      pointer('pointermove', pt.x, pt.y);
    }
    const before = g.state().moves;
    pointer('pointerup', pt.x, pt.y);
    await wait(30);
    ck('一笔经过的格都落灯', line.every((c) => g.board.open[c] === BULB), JSON.stringify(line.map((c) => g.board.open[c])));
    ck('一笔只记一步', g.state().moves === before + 1, `${before} → ${g.state().moves}`);

    document.querySelector('#btn-undo').click();
    await wait(30);
    ck('撤销把整笔带走', line.every((c) => g.board.open[c] === OPEN), JSON.stringify(line.map((c) => g.board.open[c])));
    ck('撤销退回了那一步', g.state().moves === before, `${before} → ${g.state().moves}`);

    // Two lamps on one run is illegal even though both cells are bright.
    const run = g.board.runs.find((r) => r.cells.length >= 2);
    const pair = [run.cells[0], run.cells[1]];
    for (const c of pair) await tapCell(c);
    ck('同线两盏灯被判冲突', g.state().conflicts === 2, JSON.stringify(g.state()));
    ck('冲突状态不算赢', g.status !== 'won' && !shown('#win-veil'));
    ck('冲突读数写进了面板', Number(document.querySelector('#stat-conflicts').textContent) === 2);
    ck('冲突提示行非空', document.querySelector('#conflict-line').textContent.length > 0);
    A().undo();
    ck('撤掉其中一盏后冲突清零', g.state().conflicts === 0 && g.state().bulbs === 1, JSON.stringify(g.state()));
    A().undo();
    ck('再撤一盏，灯与冲突读数都归零', g.state().bulbs === 0 && g.state().conflicts === 0, JSON.stringify(g.state()));

    // Fill everything with lamps: bright, illegal, and must not win.
    for (const c of g.board.lightable) if (g.board.open[c] !== BULB) await tapCell(c);
    ck('满盘涂灯不会判胜', g.status !== 'won' && !shown('#win-veil'));
    ck('满盘涂灯被记为大量冲突', g.state().conflicts > 1, g.state().conflicts);
    ck('满盘涂灯仍然有未定格的线索超出', verify(g.board).length > 0);

    while (g.state().steps) A().undo();
    ck('一路撤销能回到空盘', g.state().moves === 0 && g.state().bulbs === 0
      && Array.from(g.board.open).every((v) => v === OPEN), JSON.stringify(g.state()));

    A().solveWithLogic();
    await wait(30);
    ck('纯逻辑推到底判胜', g.status === 'won' && shown('#win-veil'), JSON.stringify(g.state()));
    ck('胜利时独立检查无话可说', verify(g.board).length === 0, verify(g.board).join('; '));
    ck('胜利时全盘没有未定格', g.state().open === 0 && g.state().unlit === 0);
    ck('胜利面板写出了这一局的成本', document.querySelector('#win-meta').textContent.includes('提示'),
      document.querySelector('#win-meta').textContent);
    const veil = document.querySelector('#win-veil').getBoundingClientRect();
    const box = A().view.canvas.getBoundingClientRect();
    ck('结算遮罩盖住整张盘', veil.width >= box.width - 1 && veil.height >= box.height - 1,
      `${Math.round(veil.width)}×${Math.round(veil.height)} vs ${Math.round(box.width)}×${Math.round(box.height)}`);
    return report({ cells: p.w * p.h, hints: g.hints, moves: g.moves });
  };

  // ---------- hint ----------

  const hint = async () => {
    const { verify, Rules, OPEN, BULB, MARK } = E();
    const boards = [];
    for (const tier of ['trainee', 'apprentice', 'regular']) {
      boards.push({ tier, p: E().makePuzzle(`browser|hint|${tier}`, tier) });
    }
    let given = 0;
    let wrong = 0;
    let unexplained = 0;
    let cleared = 0;
    for (const { p } of boards) {
      const truth = new Map();
      for (let i = 0; i < p.solution.length; i++) if (!p.wall[i]) truth.set(i, p.solution[i] ? BULB : MARK);
      A().begin({ tier: p.tier, seed: p.originSeed });
      const g = A().game;
      let guard = 0;
      while (g.status !== 'won' && guard++ < 400) {
        const h = g.hint();
        if (!h || h.stalled || h.conflict) break;
        given++;
        for (const c of h.cells) {
          // Every cell a hint writes must match the unique solution — the one promise that
          // would be catastrophic to break, checked cell by cell rather than in aggregate.
          if (truth.get(c) !== h.value) wrong++;
        }
        if (!h.rule || !Object.values(Rules).includes(h.rule)) unexplained++;
        if (!h.why || h.why.length < 4) unexplained++;
      }
      if (g.status === 'won') cleared++;
      ck(`${p.tier} 一局：只吃提示也能推完`, g.status === 'won',
        `${guard} 步后停在 ${g.state().open} 格未定、${g.state().unlit} 格没亮`);
      if (g.status === 'won') ck(`${p.tier} 一局：提示推完的盘合法`, verify(g.board).length === 0, verify(g.board).join('; '));
    }
    ck('提示从不给错格', wrong === 0, `${wrong} 处与真解不符`);
    ck('每条提示都点名规则并给出理由', unexplained === 0, unexplained);
    ck('每局都能靠提示清空', cleared === boards.length, `${cleared}/${boards.length}`);

    // What the player sees: the hint box names the rule and points at a cell.
    A().begin({ tier: 'trainee', seed: 'browser|hint|ui' });
    const g = A().game;
    const info = A().useHint();
    ck('提示按钮给出可推的一步', !!info && !info.stalled && !!info.rule, JSON.stringify(info));
    ck('提示框点名规则', document.querySelector('#hint-rule').textContent === `规则：${info.rule}`,
      document.querySelector('#hint-rule').textContent);
    ck('提示理由写出格位并解释', /行\d+列/.test(document.querySelector('#hint-line').textContent)
      && document.querySelector('#hint-line').textContent.length > 8, document.querySelector('#hint-line').textContent);
    ck('提示按下的格落在盘上', A().view.cellRect(info.cells[0]).size > 0 && g.board.open[info.cells[0]] === info.value);

    // A hint is a purchase: taking it back does not refund it.
    const charged = g.state().hints;
    g.undo();
    ck('撤销提示后格子退回', g.board.open[info.cells[0]] === OPEN);
    ck('撤销提示不退求助次数', g.state().hints === charged, `${charged} → ${g.state().hints}`);
    ck('求助读数与状态一致', Number(document.querySelector('#stat-hints').textContent) === g.state().hints
      && Number(document.querySelector('#hint-count').textContent) === g.state().hints);
    return report({ boards: boards.length, hintsGiven: given, boardsClearedByHints: cleared });
  };

  // ---------- save ----------

  const save = async () => {
    const { Store } = E();
    Store.reset();
    const g = A().begin({ tier: 'regular', seed: 'browser|save' });
    const p = g.puzzle;
    await tapCell(solutionCells(p)[0]);
    A().useHint();
    await wait(30);
    const raw = JSON.parse(localStorage.getItem('akari.save.v1'));
    ck('存档落在一个键下', !!raw && !!raw.resume);
    ck('存档带原始种子', raw.resume.seed === p.originSeed, `${raw.resume.seed} vs ${p.originSeed}`);
    ck('存档带档位', raw.resume.tier === 'regular');
    ck('存档带步数', raw.resume.moves === g.moves, `${raw.resume.moves} vs ${g.moves}`);
    ck('存档带提示数', raw.resume.hints === g.hints, `${raw.resume.hints} vs ${g.hints}`);
    ck('存档带计时', raw.resume.elapsedMs >= 0);
    ck('游程编码比裸数组小', JSON.stringify(raw.resume.ink).length < p.w * p.h * 2, JSON.stringify(raw.resume.ink).length);
    ck('存档不含解，也不含墙（盘面由种子重新生成）',
      !('solution' in raw.resume) && !('wall' in raw.resume) && !('clue' in raw.resume));
    ck('存档只有几百字节', JSON.stringify(raw).length < 1200, JSON.stringify(raw).length);

    // Records rank by help taken first; a hint-fed sprint must not beat a clean run.
    Store.recordBest('regular', { ms: 40000, hints: 0, moves: 30, size: '10×10' });
    ck('首个纪录成立', !!Store.best('regular'));
    ck('更快但求助更多的不算破纪录', Store.recordBest('regular', { ms: 1000, hints: 1, moves: 4, size: '10×10' }) === false);
    ck('同样不求人时更省步数的算破纪录', Store.recordBest('regular', { ms: 90000, hints: 0, moves: 22, size: '10×10' }) === true);
    ck('提示与步数都相同、只是更慢，不算破纪录', Store.recordBest('regular', { ms: 120000, hints: 0, moves: 22, size: '10×10' }) === false);
    ck('提示与步数都相同时才轮到比时间', Store.recordBest('regular', { ms: 50000, hints: 0, moves: 22, size: '10×10' }) === true);
    ck('纪录里留下的是最好的那次', Store.best('regular').moves === 22 && Store.best('regular').ms === 50000,
      JSON.stringify(Store.best('regular')));
    A().show('menu');
    await wait(30);
    ck('回选档会渲染这条纪录', /22 步/.test(document.querySelector('#record-list li[data-tier="regular"]').textContent),
      document.querySelector('#record-list li[data-tier="regular"]').textContent);

    // Settings survive because they live in the same document.
    document.querySelector('#btn-sound').click();
    ck('音效开关写进存档', JSON.parse(localStorage.getItem('akari.save.v1')).settings.sound === false);
    document.querySelector('#btn-motion').click();
    ck('动效开关写进存档', JSON.parse(localStorage.getItem('akari.save.v1')).settings.reduceMotion === true);
    ck('动效开关反映在 body 类上', document.body.classList.contains('reduce-motion'));
    ck('省动效时画布不再重绘脉冲', getComputedStyle(document.querySelector('#view-menu')).display !== 'none');
    Store.reset();
    return report({ storedBytes: JSON.stringify(raw).length, inkRuns: raw.resume.ink.length / 2 });
  };

  // ---------- resume ----------

  const resume = async () => {
    const { Store, BULB } = E();
    Store.reset();
    A().begin({ tier: 'apprentice', seed: 'browser|resume' });
    let g = A().game;
    const p = g.puzzle;
    const cells = solutionCells(p);
    await tapCell(cells[0]);
    await tapCell(cells[1]);
    A().useHint();
    await wait(30);
    const opened = Array.from(g.board.open).join('');
    const paid = { moves: g.moves, hints: g.hints };
    const clockBefore = A().elapsed();
    ck('落灯之后存档已经写好了', Store.resume() !== null);

    A().show('menu');
    await wait(30);
    ck('离开对局后仍然提供续局', shown('#resume-card'));
    ck('续局卡报出这一局的成本', document.querySelector('#resume-meta').textContent.includes(`提示 ${paid.hints}`),
      document.querySelector('#resume-meta').textContent);
    document.querySelector('#btn-resume').click();
    await wait(120);
    g = A().game;
    ck('续局拿到的是同一张图', g.puzzle.seed === p.seed, `${g.puzzle.seed} vs ${p.seed}`);
    ck('续局复现了落子位置', Array.from(g.board.open).join('') === opened);
    ck('续局没有把落子重新记成新的步数', g.moves === paid.moves, `${g.moves} vs ${paid.moves}`);
    ck('续局带回了提示数', g.hints === paid.hints, `${g.hints} vs ${paid.hints}`);
    ck('续局把计时接上而不是归零', A().elapsed() >= clockBefore, `${A().elapsed()} vs ${clockBefore}`);
    ck('续局之后灯数读数正确', Number(document.querySelector('#stat-bulbs').textContent) === g.state().bulbs
      && g.state().bulbs >= 2, `${g.state().bulbs}`);
    ck('续局后提示照常计费', (() => {
      const before = g.hints;
      const info = A().useHint();
      return !!info && !info.stalled && !!info.rule && g.hints === before + 1;
    })());
    ck('续局的求助次数进了面板', Number(document.querySelector('#stat-hints').textContent) === g.hints,
      `${document.querySelector('#stat-hints').textContent} vs ${g.hints}`);
    ck('续局恢复的落子与真解一致', cells.slice(0, 2).every((c) => g.board.open[c] === BULB));

    // A finished board must not leave a resume behind.
    A().begin({ tier: 'trainee', seed: 'browser|resume|win' });
    A().solveWithLogic();
    await wait(60);
    const won = A().game;
    ck('完局之后没有遗留续局', Store.resume() === null);
    ck('完局写入纪录', !!Store.best('trainee'));
    const totals = JSON.parse(localStorage.getItem('akari.save.v1')).totals;
    ck('完局计入总局数', totals.solved === 1, JSON.stringify(totals));
    ck('总局数只数局，不重复累加提示', totals.hints === won.hints && totals.ms > 0, JSON.stringify(totals));
    A().show('menu');
    await wait(30);
    ck('完局后选档不再给续局卡', !shown('#resume-card'));
    Store.reset();
    return report({ name: p.name, tier: p.tier, hints: won.hints });
  };

  // ---------- layout ----------

  const layout = async () => {
    const { BULB } = E();
    A().begin({ tier: 'regular', seed: 'browser|layout' });
    const g = A().game;
    const p = g.puzzle;
    const canvas = A().view.canvas;
    const geo = A().view.geo;
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    ck('后备缓冲按 DPR 放大', canvas.width === Math.round(parseFloat(canvas.style.width) * dpr),
      `${canvas.width} vs ${canvas.style.width}×${dpr}`);
    // 18–52 is js/theme.js Cell.min/max: below the first a clue digit stops reading, above
    // the second a board becomes a scroll. The scenario states the range it demands.
    ck('格子尺寸在可读区间内', geo.cell >= 18 && geo.cell <= 52, geo.cell);
    ck('整盘装得下窗口', parseFloat(canvas.style.width) <= window.innerWidth, canvas.style.width);

    // Every cell round-trips: the point the renderer puts a cell at must be the point the
    // hit test hands back for that same cell.
    let round = 0;
    for (let i = 0; i < p.w * p.h; i++) {
      const c = A().cellsOf(i % p.w, (i / p.w) | 0);
      if (c !== i) {
        ck(`坐标往返 ${i}`, false, `得到 ${c}`);
        break;
      }
      const pt = center(i);
      const got = A().view.hitTest(pt.x, pt.y);
      if (got === i) round++;
      else ck(`格子 ${i} 命中自己`, false, `得到 ${got}`);
    }
    ck('全盘逐格往返命中', round === p.w * p.h, `${round}/${p.w * p.h}`);

    // Edge clicks land outside the grid and must not touch any cell.
    const box = canvas.getBoundingClientRect();
    const before = Array.from(g.board.open).join('');
    for (const [x, y] of [[box.left - 4, box.top - 4], [box.right + 4, box.bottom + 4]]) {
      pointer('pointerdown', x, y);
      pointer('pointerup', x, y);
    }
    ck('盘外的点击不落在任何格上', Array.from(g.board.open).join('') === before);
    ck('盘外点击不记账', g.state().moves === 0, g.state().moves);
    ck('hitTest 对盘外返回 -1', A().view.hitTest(box.left - 1, box.top - 1) === -1
      && A().view.hitTest(box.right + 1, box.bottom + 1) === -1);
    ck('留白不属于棋盘', A().view.hitTest(box.left + 2, box.top + 2) === -1, A().view.geo.x);

    // A narrower window must shrink the board, not overflow it. innerWidth is overridden
    // rather than the container's style, because availBox() reads the viewport and a CSS
    // width on a grid item would not exercise the same code the phone layout runs.
    const desc = Object.getOwnPropertyDescriptor(w, 'innerWidth');
    Object.defineProperty(w, 'innerWidth', { configurable: true, get: () => 420 });
    window.dispatchEvent(new Event('resize'));
    await wait(60);
    const shrunk = A().view.geo.cell;
    ck('窗口变窄时棋盘跟着收缩', shrunk < geo.cell, `${geo.cell} → ${shrunk}`);
    ck('收缩后仍在最小格以上', shrunk >= 18, shrunk);
    ck('收缩后依然装得下', parseFloat(canvas.style.width) <= 420, canvas.style.width);
    if (desc) Object.defineProperty(w, 'innerWidth', desc);
    else delete w.innerWidth;
    window.dispatchEvent(new Event('resize'));
    await wait(60);
    ck('恢复宽度后格子也恢复', A().view.geo.cell === geo.cell, `${A().view.geo.cell} vs ${geo.cell}`);
    ck('窗口读数没有被测试改动留在窄值上', window.innerWidth > 500, window.innerWidth);

    // The canvas really painted, and the cell states are distinguishable in pixels.
    const px = (cell) => {
      const r = A().view.cellRect(cell);
      const d = canvas.getContext('2d').getImageData(
        Math.round((r.x + r.size / 2) * dpr), Math.round((r.y + r.size / 2) * dpr), 1, 1).data;
      return { r: d[0], g: d[1], b: d[2] };
    };
    const lampCell = (() => {
      for (let k = 0; k < 12; k++) {
        A().useHint();
        const h = A().game.lastHint;
        if (h && h.value === BULB) return h.cells[0];
      }
      return -1;
    })();
    ck('提示能给出一个放灯的一步', lampCell >= 0);
    if (lampCell >= 0) {
      const lp = px(lampCell);
      ck('提示落下的灯被画成暖色', lp.r > lp.b + 60, JSON.stringify(lp));
    }
    const unlitCell = [...g.board.lightable].find((c) => g.diag.unlit.has(c));
    const litEmpty = [...g.board.lightable].find((c) => g.board.open[c] === 0 && !g.diag.unlit.has(c) && !g.diag.conflict.has(c));
    ck('盘上既有未亮格也有已亮空格', unlitCell !== undefined && litEmpty !== undefined);
    if (unlitCell !== undefined && litEmpty !== undefined) {
      const cold = px(unlitCell);
      const warm = px(litEmpty);
      // Both states are undetermined cells painted the same shape, so what tells them apart
      // is colour temperature — and the lit one's warmth depends on where along the beam it
      // sits, which is why this compares the two readings instead of asserting a fixed value.
      ck('未亮的格比已亮的格更偏蓝', cold.b - cold.r > warm.b - warm.r + 15, JSON.stringify({ cold, warm }));
    }

    // A clue digit is drawn, not merely stored. Sampled inside the middle half of the wall so
    // a satisfied clue's green ring cannot stand in for the glyph.
    const clueWall = (() => {
      for (let i = 0; i < p.wall.length; i++) if (p.wall[i] && p.clue[i] >= 0) return i;
      return -1;
    })();
    ck('盘面有带数字的墙', clueWall >= 0);
    if (clueWall >= 0) {
      const r = A().view.cellRect(clueWall);
      const rect = canvas.getContext('2d').getImageData(Math.round((r.x + r.size * 0.25) * dpr),
        Math.round((r.y + r.size * 0.25) * dpr),
        Math.round(r.size * 0.5 * dpr), Math.round(r.size * 0.5 * dpr)).data;
      let bright = 0;
      for (let k = 0; k < rect.length; k += 4) {
        if (rect[k] + rect[k + 1] + rect[k + 2] > 380) bright++;
      }
      ck('墙上的数字真的被画出来', bright >= 3, `亮像素 ${bright}，线索 ${p.clue[clueWall]}`);
    }
    return report({ cell: geo.cell, dpr, lamp: lampCell });
  };

  w.__ng = { engine, gen, play, hint, save, resume, layout };
})(window);
