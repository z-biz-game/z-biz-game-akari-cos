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
};

const view = new BoardView(el.canvas);
let game = null;
let pulse = null;
let startedAt = 0;
let baseElapsed = 0;
let ticker = 0;
let stroke = null;

const clock = () => baseElapsed + (startedAt ? Date.now() - startedAt : 0);
const running = () => !!startedAt;

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

function draw() {
  if (!game) return;
  const { w, h } = availBox();
  view.resize(game, w, h);
  view.draw(game, { pulse });
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
  clearInterval(ticker);
  ticker = setInterval(() => {
    el.time.textContent = fmtMs(clock());
    if (pulse) draw();
  }, 1000);
}

function stopClock() {
  baseElapsed = clock();
  startedAt = 0;
  clearInterval(ticker);
  ticker = 0;
}

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
  pulse = { cells: info.cells };
  setTimeout(() => {
    if (pulse && pulse.cells === info.cells) pulse = null;
    draw();
  }, 1400);
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
  Sound.win();
  renderRecords();
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
  if (!game) return null;
  const step = game.undo();
  if (!step) return null;
  pulse = null;
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
  pulse = null;
  el.winVeil.hidden = true;
  baseElapsed = 0;
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
  return game;
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

function renderMenu() {
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
  Sound.setEnabled(Store.setting('sound'));
  const reduce = !!Store.setting('reduceMotion') || systemPrefersReducedMotion();
  setReduceMotion(!!Store.setting('reduceMotion'));
  document.body.classList.toggle('reduce-motion', reduce);
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
  if (!game || game.status === 'won') return;
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
  afterStep(s.value === BULB ? 'bulb' : s.value === MARK ? 'pencil' : 'erase');
  return step;
}

el.canvas.addEventListener('pointerdown', strokeStart);
el.canvas.addEventListener('pointermove', strokeMove);
el.canvas.addEventListener('pointerup', strokeEnd);
el.canvas.addEventListener('pointercancel', () => {
  if (!stroke) return;
  unpreview();
  stroke = null;
  syncAll();
});
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
$('#btn-again').addEventListener('click', () => begin({ tier: game ? game.puzzle.tier : 'trainee' }));
$('#btn-resume').addEventListener('click', () => {
  const r = Store.resume();
  if (!r) return;
  begin({ tier: r.tier, seed: r.seed, resume: r });
});
$('#btn-sound').addEventListener('click', () => {
  Store.setSetting('sound', !Store.setting('sound'));
  applySettings();
  Sound.bulb();
});
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

window.addEventListener('keydown', (ev) => {
  if (ev.target && /input|textarea/i.test(ev.target.tagName)) return;
  if (ev.key === 'h') useHint();
  else if (ev.key === 'z') undo();
  else if (ev.key === 'm') setMode(game && game.mode === 'mark' ? 'bulb' : 'mark');
});

window.addEventListener('resize', draw);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushResume();
});
window.addEventListener('pagehide', flushResume);

applyThemeVars();
applySettings();
renderMenu();

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
  tap(c, mode) {
    if (!game) return null;
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
  state: () => (game ? { ...game.state(), elapsedMs: clock(), mode: game.mode } : null),
  cellsOf: (x, y) => (game ? game.cellAt(x, y) : -1),
  isLitCell: (c) => (game ? !game.diag.unlit.has(c) : false),
  // Exposed so the browser scenario suite checks the *same* engine the game runs, rather
  // than a second copy that could pass while the shipped app is broken.
  engine: { ...Engine, makePuzzle, countSolutions, placeBulbs, cluesFrom, TIERS, Game, Store, OPEN, BULB, MARK },
};
