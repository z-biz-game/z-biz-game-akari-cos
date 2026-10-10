// Wiring: DOM, pointer gestures, the clock, storage, and the `window.akari` surface the
// verification harness drives. No puzzle rule lives here — every judgement about the board
// comes from js/engine/akari.js through js/ui/game.js.

import { applyThemeVars, setReduceMotion, systemPrefersReducedMotion } from './theme.js';
import { Sound } from './audio/synth.js';
import { Store } from './store.js';
import { TIERS, tierById, makePuzzle } from './engine/generate.js';
import * as Engine from './engine/akari.js';
import { countSolutions } from './engine/count.js';
import { placeBulbs, cluesFrom } from './engine/fill.js';
import { BoardView } from './render/board.js';
import { Fx } from './render/fx.js';
import { Game, OPEN, BULB, MARK } from './ui/game.js';

const VERSION = '1.0.0';

const $ = (sel) => document.querySelector(sel);
const el = {
  viewMenu: $('#view-menu'),
  viewGame: $('#view-game'),
  tiers: $('#tier-list'),
  records: $('#record-list'),
  resumeCard: $('#resume-card'),
  resumeName: $('#resume-name'),
  resumeMeta: $('#resume-meta'),
  name: $('#stat-name'),
  tier: $('#stat-tier'),
  time: $('#stat-time'),
  moves: $('#stat-moves'),
  hints: $('#stat-hints'),
  bulbs: $('#stat-bulbs'),
  conflicts: $('#stat-conflicts'),
  unlit: $('#stat-unlit'),
  score: $('#stat-score'),
  hintRule: $('#hint-rule'),
  hintLine: $('#hint-line'),
  hintCount: $('#hint-count'),
  conflictLine: $('#conflict-line'),
  winVeil: $('#win-veil'),
  winMeta: $('#win-meta'),
  winRecord: $('#win-record'),
  wrap: $('#board-wrap'),
  canvas: $('#board'),
  pause: $('#btn-pause'),
  pauseVeil: $('#pause-veil'),
  fs: $('#btn-fullscreen'),
  help: $('#btn-help'),
  helpView: $('#view-help'),
  helpClose: $('#btn-help-close'),
  helpKeys: $('#help-keys'),
  root: document.documentElement,
};

const view = new BoardView(el.canvas);
const fx = new Fx();
let game = null;
let startedAt = 0;
let baseElapsed = 0;
let stroke = null;
let paused = false;
let helpOpen = false;
let raf = 0;
let lastFrame = 0;
let needsRedraw = true;
let shownTime = '';
const stats = { frames: 0, dtSum: 0, dtMax: 0, steps: 0 };

const clock = () => baseElapsed + (startedAt ? Date.now() - startedAt : 0);
const running = () => !!startedAt;
const markDirty = () => { needsRedraw = true; };

function fmtMs(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function availBox() {
  const narrow = window.innerWidth <= 900;
  const w = narrow ? window.innerWidth - 60 : el.viewGame.clientWidth - 340;
  return {
    w: Math.max(240, w),
    h: Math.max(240, window.innerHeight - 240),
  };
}

function draw({ resize = true } = {}) {
  if (!game) return;
  if (resize) {
    const { w, h } = availBox();
    view.resize(game, w, h);
  }
  view.draw(game, { fx });
  needsRedraw = false;
}

// One place writes the readouts, so a stat can never be updated by half the file.
function syncStats() {
  if (!game) return;
  const st = game.state();
  el.name.textContent = `${game.puzzle.name} · ${game.w}×${game.h}`;
  el.tier.textContent = tierById(game.puzzle.tier).label;
  el.tier.dataset.tier = game.puzzle.tier;
  el.time.textContent = fmtMs(clock());
  el.moves.textContent = st.moves;
  el.hints.textContent = st.hints;
  el.hintCount.textContent = st.hints;
  el.bulbs.textContent = st.bulbs;
  el.conflicts.textContent = st.conflicts;
  el.unlit.textContent = st.unlit;
  el.score.textContent = game.puzzle.score.toFixed(1);
  el.conflicts.closest('.stat').classList.toggle('bad', st.conflicts > 0);
  el.unlit.closest('.stat').classList.toggle('bad', st.status !== 'won' && st.unlit > 0);
  el.conflictLine.textContent = st.conflicts
    ? `冲突 ${st.conflicts} 处：同一条线上不能有两盏灯，数字也不能被超过。`
    : '';
}

function syncAll() {
  syncStats();
  draw();
}

function flushResume() {
  if (!game || game.status === 'won') return;
  Store.saveResume(game.puzzle, game.board.open, clock(), { moves: game.moves, hints: game.hints });
}

function startClock() {
  startedAt = Date.now();
}

function stopClock() {
  baseElapsed = clock();
  startedAt = 0;
  shownTime = '';
}

// 暂停 = 表停下来 + 仿真不再被喂步 + 盘面挡住不接受输入。三件事缺一件都是假暂停。
function setPaused(next) {
  const want = !!next && !!game && game.status !== 'won';
  if (want === paused) return paused;
  paused = want;
  if (paused) {
    if (stroke) {
      unpreview();
      stroke = null;
    }
    stopClock();
  } else {
    startClock();
  }
  fx.accum = 0;
  el.pauseVeil.hidden = !paused;
  el.pause.textContent = paused ? '已暂停' : '暂停';
  el.pause.setAttribute('aria-pressed', String(paused));
  el.viewGame.classList.toggle('paused', paused);
  markDirty();
  return paused;
}

const isPaused = () => paused;

function setMode(mode) {
  if (!game) return;
  game.mode = mode;
  $('#btn-mode-bulb').setAttribute('aria-pressed', String(mode === 'bulb'));
  $('#btn-mode-mark').setAttribute('aria-pressed', String(mode === 'mark'));
}

// The engine wrote a cell for us; say which rule earned it, in the player's words.
function showHint(info) {
  if (!info) return;
  if (info.stalled) {
    el.hintRule.textContent = '推不动了';
    el.hintLine.textContent = info.text;
    return;
  }
  if (info.conflict) {
    el.hintRule.textContent = '盘面矛盾';
    el.hintLine.textContent = info.conflict;
    return;
  }
  el.hintRule.textContent = `规则：${info.rule}`;
  el.hintLine.textContent = `${Engine.at(game.w, info.cells[0])}${info.cells.length > 1 ? ` 等 ${info.cells.length} 格` : ''} — ${info.why}`;
  fx.setPulse(info.cells);
  markDirty();
  Sound.hint();
}

function onWin() {
  stopClock();
  const ms = clock();
  const better = Store.recordBest(game.puzzle.tier, {
    ms,
    hints: game.hints,
    moves: game.moves,
    size: `${game.w}×${game.h}`,
  });
  Store.recordSolve(ms, game.hints);
  Store.clearResume();
  el.winMeta.textContent = `${game.puzzle.name} · ${game.w}×${game.h} · ${fmtMs(ms)} · ${game.moves} 步 · 提示 ${game.hints} 次`;
  el.winRecord.textContent = better ? '新纪录：这一局比存档里的更不求人。' : '未破纪录：同档先比提示次数。';
  el.winVeil.hidden = false;
  const points = [];
  for (const c of game.board.lightable) if (game.board.open[c] === BULB) points.push(view.cellPos(c));
  fx.celebrate(points);
  Sound.win();
  renderRecords();
  markDirty();
}

function afterStep(soundKey) {
  syncAll();
  if (game.status === 'won') onWin();
  else {
    flushResume();
    if (soundKey) Sound[soundKey]();
    if (game.diag.conflict.size) Sound.conflict();
  }
}

function useHint() {
  if (!game || game.status === 'won') return null;
  const info = game.hint();
  // An unproductive hint is not a purchase: nothing was written, nothing is charged.
  if (info && (info.stalled || info.conflict)) {
    showHint(info);
    return info;
  }
  if (!info || !info.cells || !info.cells.length) {
    showHint({ stalled: true, text: '这一处已经写好了，换格想想要往哪推。' });
    return { stalled: true };
  }
  showHint(info);
  afterStep(null);
  return info;
}

function undo() {
  if (!game || paused) return null;
  const step = game.undo();
  if (!step) return null;
  fx.pulse = null;
  markDirty();
  Sound.undo();
  syncAll();
  flushResume();
  return step;
}

function begin({ tier = 'trainee', seed = null, resume = null } = {}) {
  const origin = seed || `s${Math.floor(Math.random() * 1e9)}`;
  const puzzle = makePuzzle(origin, tier);
  if (!puzzle) return null;
  game = new Game(puzzle);
  // 复位到"这一局还没开始过"：在途手势、动画缓冲、暂停态、表、读数，一样都不带走。
  stroke = null;
  fx.reset();
  paused = false;
  el.pauseVeil.hidden = true;
  el.viewGame.classList.remove('paused');
  el.pause.setAttribute('aria-pressed', 'false');
  el.pause.textContent = '暂停';
  baseElapsed = 0;
  shownTime = '';
  setHelp(false);
  if (resume && resume.cells !== puzzle.w * puzzle.h) {
    // 盘面是从 seed + tier 重新长出来的。存档格数与长出来的对不上时，墨点索引会落在
    // 错的格子上——宁可不继续，也不能摆错一子。
    Store.junk.push('resume.geometry');
    resume = null;
  }
  if (resume) {
    game.moves = resume.moves || 0;
    game.hints = resume.hints || 0;
    baseElapsed = resume.elapsedMs || 0;
    game.load(resume.board);
  }
  setMode('bulb');
  show('game');
  startClock();
  el.hintRule.textContent = '提示理由';
  el.hintLine.textContent = '按 提示 会说出当前能推的一步，以及它依据哪条规则。';
  syncAll();
  flushResume();
  renderResumeCard();
  markDirty();
  return game;
}

// 重开本局：还是同一张盘面（生成器按 origin seed 决定，所以墙与数字一模一样），
// 但落子、步数、提示、用时、动画全部归零。与"换一局"是两件事。
function restart() {
  if (!game) return null;
  const { tier, originSeed } = game.puzzle;
  return begin({ tier, seed: originSeed });
}

function show(which) {
  el.viewMenu.hidden = which !== 'menu';
  el.viewGame.hidden = which !== 'game';
  if (which === 'menu') {
    stopClock();
    renderMenu();
  }
  if (which === 'game') draw();
  return which;
}

// 教学页里的键盘表由这一张表渲染：键位改在 KEYS 上，忘了改这里就会说谎。
const KEY_LABELS = [
  ['Enter', '菜单里开始 / 有存档就继续；暂停中恢复'],
  ['空格', '暂停 · 继续（菜单里是开始）'],
  ['P', '暂停 · 继续'],
  ['H 或 ?', '打开/关闭玩法教学'],
  ['I', '提示：说出当前能推的一步'],
  ['Z', '撤销一步（一次拖动算一步）'],
  ['B / X', '切到放灯 / 画叉'],
  ['R', '重开本局：同一张盘面，落子与计时归零'],
  ['N', '换一局：重新出题'],
  ['M', '音效开 / 关'],
  ['F', '全屏'],
  ['Esc', '关教学，或在盘面外回选档'],
];

function renderKeys() {
  el.helpKeys.innerHTML = KEY_LABELS.map(
    ([k, v]) => `<dt class="mono">${k}</dt><dd>${v}</dd>`
  ).join('');
}

function renderMenu() {
  renderKeys();
  renderTiers();
  renderRecords();
  renderResumeCard();
}

const TIER_NOTE = {
  trainee: '线索几乎给满，靠数字就能收尾',
  apprentice: '要开始用“这条线已经有灯了”',
  regular: '数字会断档，唯一光源接手',
  expert: '大半线索被撤，靠覆盖与成组',
  master: '会用到反证：假设一下，看哪里矛盾',
};

function renderTiers() {
  el.tiers.innerHTML = '';
  for (const t of TIERS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tier';
    b.dataset.tier = t.id;
    b.innerHTML =
      `<span class="tier-name">${t.label}</span>` +
      `<span class="tier-note">${TIER_NOTE[t.id] || ''}</span>` +
      `<span class="tier-size mono">${t.size}×${t.size} · 实测 ${t.band[0]}–${t.band[1]}</span>`;
    b.addEventListener('click', () => begin({ tier: t.id }));
    el.tiers.appendChild(b);
  }
}

function renderRecords() {
  el.records.innerHTML = '';
  for (const t of TIERS) {
    const li = document.createElement('li');
    const best = Store.best(t.id);
    li.dataset.tier = t.id;
    li.innerHTML =
      `<b>${t.label}</b>` +
      (best
        ? `<span class="mono">${fmtMs(best.ms)}</span> · 提示 ${best.hints} · ${best.moves} 步<br><span>${best.size}</span>`
        : '<span>还没有纪录</span>');
    el.records.appendChild(li);
  }
}

function renderResumeCard() {
  const r = Store.resume();
  // Do not offer "继续" for the board already on screen.
  const live = game && game.status !== 'won' && running();
  if (!r || (live && r.seed === game.puzzle.originSeed && r.tier === game.puzzle.tier)) {
    el.resumeCard.hidden = true;
    return;
  }
  el.resumeCard.hidden = false;
  el.resumeName.textContent = `继续 ${tierById(r.tier).label} 的一局`;
  el.resumeMeta.textContent = `${fmtMs(r.elapsedMs || 0)} · ${r.moves || 0} 步 · 提示 ${r.hints || 0} 次`;
}

function applySettings() {
  // 静音交给 Sound 去真停 AudioContext；动效开关交给 fx，它决定仿真跑不跑粒子。
  Sound.setEnabled(Store.setting('sound'));
  const reduce = !!Store.setting('reduceMotion') || systemPrefersReducedMotion();
  setReduceMotion(!!Store.setting('reduceMotion'));
  document.body.classList.toggle('reduce-motion', reduce);
  fx.reduced = reduce;
  $('#btn-sound').setAttribute('aria-pressed', String(!!Store.setting('sound')));
  $('#btn-sound').textContent = Store.setting('sound') ? '音效 开' : '音效 关';
  $('#btn-motion').setAttribute('aria-pressed', String(!!Store.setting('reduceMotion')));
  $('#btn-motion').textContent = reduce ? '动效 省' : '动效 全';
}

// ---- pointer gestures: down decides the value for the whole stroke, up commits one step ----

// During a drag the cells are painted ahead of the commit so the picture follows the finger.
// Each preview remembers the state the cell had *before* the gesture, because the committed
// step has to record that as its undo target — restoring to OPEN instead would quietly eat
// the lamp an erase gesture was about to remove.
function preview(c, value) {
  stroke.items.push({ cell: c, from: game.board.open[c] });
  game.board.open[c] = value;
  game.recompute();
}

function unpreview() {
  for (const it of stroke.items) game.board.open[it.cell] = it.from;
  game.recompute();
}

function strokeStart(ev) {
  if (!game || game.status === 'won' || paused || helpOpen) return;
  const c = view.hitTest(ev.clientX, ev.clientY);
  if (c < 0 || !game.isLightable(c)) return;
  ev.preventDefault();
  el.canvas.setPointerCapture?.(ev.pointerId);
  const want = game.valueFor(game.mode);
  // Starting on a cell that already holds this mode's mark makes the gesture an eraser.
  stroke = { items: [], value: game.board.open[c] === want ? OPEN : want };
  preview(c, stroke.value);
  syncAll();
}

function strokeMove(ev) {
  if (!stroke || !game) return;
  const c = view.hitTest(ev.clientX, ev.clientY);
  if (c < 0 || !game.isLightable(c)) return;
  if (stroke.items.some((it) => it.cell === c) || game.board.open[c] === stroke.value) return;
  preview(c, stroke.value);
  draw();
}

function strokeEnd() {
  if (!stroke || !game) return null;
  const s = stroke;
  const cells = s.items.map((it) => it.cell);
  unpreview();
  stroke = null;
  const step = game.stroke(cells, s.value);
  if (!step) {
    syncAll();
    return null;
  }
  // 落子的反馈来自这一层，不参与判定：引擎说改了什么，这里只负责让人看见。
  for (const w of step.writes) {
    const q = view.cellPos(w.cell);
    if (s.value === BULB) fx.pop(w.cell, q.x, q.y);
    else fx.dust(w.cell, q.x, q.y);
  }
  markDirty();
  afterStep(s.value === BULB ? 'bulb' : s.value === MARK ? 'pencil' : 'erase');
  return step;
}

function cancelStroke() {
  if (!stroke) return;
  unpreview();
  stroke = null;
  syncAll();
}

el.canvas.addEventListener('pointerdown', strokeStart);
el.canvas.addEventListener('pointermove', strokeMove);
el.canvas.addEventListener('pointerup', strokeEnd);
el.canvas.addEventListener('pointercancel', cancelStroke);
// 老 Safari（iOS 12 及以前）没有 PointerEvent，touch 是唯一有的输入。门控而不是并行注册：
// 两边都挂的话，同一次触摸会被算成两笔。
if (!('PointerEvent' in window)) {
  // strokeStart/strokeMove 读 clientX/clientY 并调 preventDefault，而 Touch 对象没有
  // 后者——包一层，把取消默认动作交还给事件本身。
  const asPoint = (ev) => {
    const t = (ev.touches && ev.touches[0]) || (ev.changedTouches && ev.changedTouches[0]) || ev;
    return { clientX: t.clientX, clientY: t.clientY, pointerId: 1, preventDefault: () => ev.preventDefault() };
  };
  const noScroll = { passive: false };
  el.canvas.addEventListener('touchstart', (ev) => strokeStart(asPoint(ev)), noScroll);
  el.canvas.addEventListener('touchmove', (ev) => strokeMove(asPoint(ev)), noScroll);
  el.canvas.addEventListener('touchend', strokeEnd);
  el.canvas.addEventListener('touchcancel', cancelStroke);
  // 老桌面 Safari（12 及以前）既没有 PointerEvent 也不能触摸，鼠标是它唯一的输入。
  // 按"有没有触摸能力"二选一：两个都挂的话，触摸结束后补发的 compatibility mousedown
  // 会把同一笔触摸算成两笔。move/up 挂 window——鼠标没有 setPointerCapture，
  // 只在画布内监听的话，拖出格子再在画布外松手就永远落不下去。
  const hasTouch = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
  if (!hasTouch) {
    el.canvas.addEventListener('mousedown', (ev) => strokeStart(asPoint(ev)));
    window.addEventListener('mousemove', (ev) => strokeMove(asPoint(ev)));
    window.addEventListener('mouseup', strokeEnd);
  }
}
el.canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

$('#btn-mode-bulb').addEventListener('click', () => setMode('bulb'));
$('#btn-mode-mark').addEventListener('click', () => setMode('mark'));
$('#btn-hint').addEventListener('click', useHint);
$('#btn-undo').addEventListener('click', undo);
$('#btn-new').addEventListener('click', () => begin({ tier: game ? game.puzzle.tier : 'trainee' }));
$('#btn-menu').addEventListener('click', () => {
  flushResume();
  show('menu');
});
$('#btn-menu-2').addEventListener('click', () => show('menu'));
$('#btn-resume-play').addEventListener('click', () => setPaused(false));
$('#btn-restart').addEventListener('click', () => restart());
$('#btn-restart-2').addEventListener('click', () => restart());
el.pause.addEventListener('click', () => setPaused(!paused));
el.help.addEventListener('click', () => setHelp(!helpOpen));
el.helpClose.addEventListener('click', () => setHelp(false));
el.fs.addEventListener('click', () => toggleFullscreen());
$('#btn-again').addEventListener('click', () => begin({ tier: game ? game.puzzle.tier : 'trainee' }));
$('#btn-resume').addEventListener('click', () => {
  const r = Store.resume();
  if (!r) return;
  begin({ tier: r.tier, seed: r.seed, resume: r });
});
$('#btn-sound').addEventListener('click', () => toggleMute());
$('#btn-motion').addEventListener('click', () => {
  Store.setSetting('reduceMotion', !Store.setting('reduceMotion'));
  applySettings();
});
$('#btn-reset').addEventListener('click', () => {
  Store.reset();
  applySettings();
  game = null;
  show('menu');
});

// 键盘全集：开始/暂停/重开/换一局/静音/全屏/教学都在手上，指针不是唯一入口。
// 焦点在按钮上时让按钮自己吃掉 Enter/Space，否则一次按键会既触发按钮又触发这里。
const KEYS = {
  h: () => setHelp(!helpOpen),
  '?': () => setHelp(true),
  i: () => useHint(),
  z: () => undo(),
  r: () => restart(),
  n: () => begin({ tier: game ? game.puzzle.tier : 'trainee' }),
  m: () => toggleMute(),
  p: () => setPaused(!paused),
  f: () => toggleFullscreen(),
  b: () => setMode('bulb'),
  x: () => setMode('mark'),
  Escape: () => (helpOpen ? setHelp(false) : show('menu')),
};

function onKeyDown(ev) {
  if (ev.target && /input|textarea|select/i.test(ev.target.tagName)) return;
  const onButton = ev.target && ev.target.tagName === 'BUTTON';
  const key = ev.key;
  if (key === ' ' || key === 'Spacebar') {
    if (onButton) return;
    ev.preventDefault();
    if (game && game.status !== 'won') setPaused(!paused);
    else if (!game) startFromMenu();
    return;
  }
  if (key === 'Enter') {
    if (onButton) return;
    ev.preventDefault();
    if (!game || el.viewMenu.hidden === false) startFromMenu();
    else if (paused) setPaused(false);
    return;
  }
  const hit = KEYS[key] || KEYS[String(key).toLowerCase()];
  if (!hit) return;
  if (key !== 'Escape') ev.preventDefault();
  hit();
}

// 从菜单开局：有存档中的牌局就先继续，否则开新手档。
function startFromMenu() {
  const r = Store.resume();
  if (r) {
    begin({ tier: r.tier, seed: r.seed, resume: r });
    return game;
  }
  return begin({ tier: 'trainee' });
}

function setHelp(next) {
  helpOpen = !!next;
  el.helpView.hidden = !helpOpen;
  el.help.setAttribute('aria-pressed', String(helpOpen));
  if (helpOpen && game) setPaused(true);
  if (helpOpen) el.helpClose.focus?.();
  markDirty();
  return helpOpen;
}

function toggleMute() {
  Store.setSetting('sound', !Store.setting('sound'));
  applySettings();
  if (Store.setting('sound')) Sound.bulb();
  return !!Store.setting('sound');
}

// 全屏绑到 HUD 上真实存在的那个按钮（#btn-fullscreen），不引用不存在的 id。
// iOS Safari 没有 requestFullscreen：那种情况下把按钮禁掉并说明原因，而不是默默没反应。
function fullscreenSupported() {
  const root = el.root;
  return !!(root.requestFullscreen || root.webkitRequestFullscreen);
}

// 禁掉要说为什么：只把按钮变灰，玩家会以为是没做完的活。
function markFullscreenUnsupported() {
  el.fs.disabled = true;
  el.fs.title = '这个浏览器不提供元素全屏（iOS Safari 走主屏添加的独立模式）';
}

const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;

function toggleFullscreen(next) {
  const root = el.root;
  if (!fullscreenSupported()) {
    markFullscreenUnsupported();
    return false;
  }
  const want = next === undefined ? !fsElement() : !!next;
  if (want) {
    const req = root.requestFullscreen || root.webkitRequestFullscreen;
    const done = req.call(root);
    if (done && done.catch) done.catch(() => {});
  } else {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    const done = exit && exit.call(document);
    if (done && done.catch) done.catch(() => {});
  }
  return want;
}

function syncFullscreen() {
  const on = !!fsElement();
  el.fs.setAttribute('aria-pressed', String(on));
  el.fs.textContent = on ? '退出全屏' : '全屏';
  document.body.classList.toggle('fullscreen', on);
  markDirty();
  return on;
}

window.addEventListener('keydown', onKeyDown);

window.addEventListener('resize', () => {
  markDirty();
  draw();
});
window.addEventListener('fullscreenchange', syncFullscreen);
window.addEventListener('webkitfullscreenchange', syncFullscreen);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushResume();
    if (game && game.status !== 'won' && !paused) setPaused(true);
  }
});
window.addEventListener('pagehide', flushResume);

// ---- 主循环 ----
//
// 这是全仓唯一读帧间隔的地方：`now - lastFrame` 只喂给 fx.advance 的累加器，
// 仿真内部永远只看见恒定的 SIM_STEP。所以刷新率是 30、60 还是 120，同一虚拟
// 时刻落在同一个仿真步上，画出来的也是同一张图。
function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = lastFrame ? Math.min(0.25, (now - lastFrame) / 1000) : 0;
  lastFrame = now;
  if (dt > 0) {
    stats.frames += 1;
    stats.dtSum += dt;
    stats.dtMax = Math.max(stats.dtMax, dt);
  }
  if (!game) return;
  if (paused) {
    // 暂停期间不喂步，并把余量清掉：恢复时不会把停住的那段时间一次补跑。
    fx.accum = 0;
  } else {
    stats.steps += fx.advance(dt);
  }
  const time = fmtMs(clock());
  if (time !== shownTime) {
    shownTime = time;
    el.time.textContent = time;
  }
  if (needsRedraw || fx.dirty || fx.breathing(game.diag.bulbs)) draw({ resize: false });
}

// 快捷方式（manifest.shortcuts）带着 #resume / #tier=expert 进来，这里接住它。
function routeHash() {
  const h = String(location.hash || '');
  if (!h) return null;
  const tier = (h.match(/tier=([a-z]+)/) || [])[1];
  let started = null;
  if (h.includes('resume')) {
    const r = Store.resume();
    if (r) started = begin({ tier: r.tier, seed: r.seed, resume: r });
  } else if (tier && TIERS.some((t) => t.id === tier)) {
    started = begin({ tier });
  }
  // 用完就擦掉：否则刷新一次会再开一局，把玩家刚下的棋冲掉。
  if (started && history.replaceState) history.replaceState(null, '', location.pathname + location.search);
  return started;
}

applyThemeVars();
applySettings();
renderMenu();
if (!fullscreenSupported()) markFullscreenUnsupported();
syncFullscreen();
routeHash();
raf = requestAnimationFrame(frame);

window.akari = {
  version: VERSION,
  view,
  get game() {
    return game;
  },
  show,
  begin,
  useHint,
  undo,
  setMode,
  fx,
  paused: () => paused,
  help: () => helpOpen,
  setPaused,
  setHelp,
  restart,
  toggleMute,
  toggleFullscreen,
  fullscreenSupported,
  fmtMs,
  // 挂出来给验证闸实测"真静音"：静音态下 nodeCount 不许涨、contextState 必须是 suspended。
  sound: Sound,
  // 主循环自己的读数：帧数、平均帧间隔、以及仿真一共走了多少步。
  // 帧率对拍要的就是这几个数——它们不挂在 window 上，任何探针都复验不了。
  stats: () => ({
    ...stats,
    avgDt: stats.frames ? stats.dtSum / stats.frames : 0,
    fps: stats.dtSum ? stats.frames / stats.dtSum : 0,
    simTime: fx.time,
    simSteps: fx.steps,
    accum: fx.accum,
    parts: fx.parts.length,
  }),
  tap(c, mode) {
    if (!game || paused) return null;
    const step = mode === undefined ? game.tap(c) : game.tap(c, mode);
    if (step) afterStep(step.writes[0].to === BULB ? 'bulb' : step.writes[0].to === MARK ? 'pencil' : 'erase');
    return step;
  },
  solveWithLogic() {
    if (!game) return null;
    const r = game.solveWithLogic();
    syncAll();
    if (game.status === 'won') onWin();
    return r;
  },
  elapsed: clock,
  state: () => (game ? { ...game.state(), elapsedMs: clock(), mode: game.mode, paused, fx: fx.summary() } : null),
  cellsOf: (x, y) => (game ? game.cellAt(x, y) : -1),
  isLitCell: (c) => (game ? !game.diag.unlit.has(c) : false),
  // Exposed so the browser scenario suite checks the *same* engine the game runs, rather
  // than a second copy that could pass while the shipped app is broken.
  engine: { ...Engine, makePuzzle, countSolutions, placeBulbs, cluesFrom, TIERS, Game, Store, OPEN, BULB, MARK },
};
