// Canvas renderer. It reads the Game's board state and paints; it never decides anything —
// no cell is "lit" here, no conflict is judged here, so the picture cannot disagree with the
// engine that the solver, the hints and the win check all use.
//
// Layout lives here too (cell size from the container, board origin, DPR) because hitTest has
// to answer with the *same* numbers draw() used. Those two drifting apart is how a board
// renders correctly but takes clicks one cell off.

import { Palette, Cell, Radius } from '../theme.js';
import { OPEN, BULB, MARK } from '../engine/akari.js';

export function layoutFor(w, h, availW, availH) {
  const pad = 8;
  const size = Math.max(0, Math.min((availW - pad * 2) / w, (availH - pad * 2) / h));
  const cell = Math.max(Cell.min, Math.min(Cell.max, Math.floor(size)));
  return { cell, boardW: cell * w, boardH: cell * h, pad };
}

export class BoardView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.geo = { cell: 0, x: 0, y: 0, w: 0, h: 0, dpr: 1 };
  }

  // The backing buffer is sized in device pixels while every draw call stays in CSS pixels:
  // one ctx.scale at the top is what keeps digits crisp on a Retina display without doubling
  // every constant in this file.
  resize(game, availW, availH) {
    const l = layoutFor(game.w, game.h, availW, availH);
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const size = { w: l.boardW + l.pad * 2, h: l.boardH + l.pad * 2 };
    this.canvas.style.width = `${size.w}px`;
    this.canvas.style.height = `${size.h}px`;
    this.canvas.width = Math.round(size.w * dpr);
    this.canvas.height = Math.round(size.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.geo = { cell: l.cell, x: l.pad, y: l.pad, w: size.w, h: size.h, dpr };
    return this.geo;
  }

  cellRect(i) {
    const { cell, x, y } = this.geo;
    const game = this.game;
    const cx = (i % game.w) * cell + x;
    const cy = (((i / game.w) | 0) * cell) + y;
    return { x: cx, y: cy, size: cell };
  }

  // Pointer position → cell index, or -1 for anything outside the grid. Edge clicks must not
  // land on a cell: the padding is deliberately not part of the board.
  hitTest(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const { cell, x, y } = this.geo;
    const game = this.game;
    if (!cell || !game) return -1;
    const px = clientX - rect.left - x;
    const py = clientY - rect.top - y;
    if (px < 0 || py < 0) return -1;
    const gx = Math.floor(px / cell);
    const gy = Math.floor(py / cell);
    if (gx < 0 || gy < 0 || gx >= game.w || gy >= game.h) return -1;
    return gy * game.w + gx;
  }

  draw(game, { pulse = null } = {}) {
    this.game = game;
    const { ctx, geo } = this;
    const { cell, x: ox, y: oy } = geo;
    const b = game.board;
    const diag = game.diag;
    ctx.clearRect(0, 0, geo.w, geo.h);

    roundRect(ctx, 0, 0, geo.w, geo.h, Radius.card);
    ctx.fillStyle = Palette.surface;
    ctx.fill();

    // Open cells first: the base grid, so light can be painted over it.
    for (const c of b.lightable) {
      const r = this.cellRect(c);
      ctx.fillStyle = diag.unlit.has(c) ? Palette.unlit : Palette.surfaceLift;
      ctx.fillRect(r.x, r.y, cell, cell);
    }

    // Light runs. A beam is drawn along the run that holds the bulb, not around the bulb, so
    // "this cell is lit from there" is visible as a direction rather than a glow blob.
    ctx.save();
    for (let run = 0; run < b.runs.length; run++) {
      const count = diag.tally.bulbs[run];
      if (!count) continue;
      const r = b.runs[run];
      const a = this.cellRect(r.cells[0]);
      const z = this.cellRect(r.cells[r.cells.length - 1]);
      // run.dir: 0 is a column, 1 is a row (see buildRuns) — a horizontal gradient on a
      // column run is a beam that lights the wrong cells.
      const grad = r.dir === 1
        ? ctx.createLinearGradient(a.x, 0, z.x + a.size, 0)
        : ctx.createLinearGradient(0, a.y, 0, z.y + a.size);
      grad.addColorStop(0, 'rgba(255,200,92,0.05)');
      grad.addColorStop(0.5, Palette.glow);
      grad.addColorStop(1, 'rgba(255,200,92,0.05)');
      ctx.fillStyle = grad;
      const thick = Math.max(4, cell * 0.62);
      if (r.dir === 1) ctx.fillRect(a.x, a.y + (cell - thick) / 2, z.x + a.size - a.x, thick);
      else ctx.fillRect(a.x + (cell - thick) / 2, a.y, thick, z.y + a.size - a.y);
    }
    ctx.restore();

    // Grid lines.
    ctx.strokeStyle = Palette.line;
    ctx.lineWidth = 1;
    for (let i = 0; i <= game.w; i++) line(ctx, ox + i * cell, oy, ox + i * cell, oy + game.h * cell);
    for (let j = 0; j <= game.h; j++) line(ctx, ox, oy + j * cell, ox + game.w * cell, oy + j * cell);

    // Walls, with their clues.
    for (let i = 0; i < b.n; i++) {
      if (!b.wall[i]) continue;
      const r = this.cellRect(i);
      ctx.fillStyle = Palette.bgBottom;
      roundRect(ctx, r.x + 1, r.y + 1, cell - 2, cell - 2, Radius.cell);
      ctx.fill();
      ctx.strokeStyle = b.clue[i] >= 0 && diag.clueDone.has(i) ? Palette.success : Palette.lineHeavy;
      ctx.lineWidth = b.clue[i] >= 0 && diag.clueDone.has(i) ? 2 : 1;
      ctx.stroke();
      if (b.clue[i] < 0) continue;
      ctx.font = `700 ${Math.round(cell * Cell.clueScale)}px ${FontStack}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = diag.clueBad.has(i) ? Palette.error : Palette.numbers[Math.min(b.clue[i], Palette.numbers.length - 1)];
      ctx.fillText(String(b.clue[i]), r.x + cell / 2, r.y + cell / 2 + 1);
    }

    // Pencil marks: small, deliberately quiet — they are notes, not decisions.
    for (const c of b.lightable) {
      if (b.open[c] !== MARK) continue;
      const r = this.cellRect(c);
      const k = cell * Cell.pencilScale;
      const cx = r.x + cell / 2;
      const cy = r.y + cell / 2;
      ctx.strokeStyle = Palette.pencil;
      ctx.lineWidth = Math.max(1.5, cell * 0.06);
      line(ctx, cx - k, cy - k, cx + k, cy + k);
      line(ctx, cx + k, cy - k, cx - k, cy + k);
    }

    // Lamps.
    for (const c of b.lightable) {
      if (b.open[c] !== BULB) continue;
      const r = this.cellRect(c);
      const cx = r.x + cell / 2;
      const cy = r.y + cell / 2;
      const rad = cell * Cell.bulbScale;
      const bad = diag.conflict.has(c);
      const halo = ctx.createRadialGradient(cx, cy, rad * 0.4, cx, cy, rad * 2.6);
      halo.addColorStop(0, bad ? 'rgba(255,92,122,0.45)' : Palette.glowCore);
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, rad * 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fillStyle = bad ? Palette.error : Palette.lamp;
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, cell * 0.05);
      ctx.strokeStyle = bad ? Palette.error : Palette.lampEdge;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx - rad * 0.3, cy - rad * 0.35, rad * 0.32, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fill();
    }

    // The cell a hint just named, and the last cell the player touched. Both are transient
    // paint over state the engine already knows.
    const marks = [];
    if (pulse && pulse.cells && pulse.cells.length) marks.push({ cells: pulse.cells, color: Palette.hint });
    if (pulse && pulse.cell != null) marks.push({ cells: [pulse.cell], color: Palette.accent });
    for (const m of marks) {
      for (const c of m.cells) {
        if (c < 0 || b.wall[c]) continue;
        const r = this.cellRect(c);
        ctx.strokeStyle = m.color;
        ctx.lineWidth = Math.max(2, cell * 0.08);
        roundRect(ctx, r.x + 2, r.y + 2, cell - 4, cell - 4, Radius.cell);
        ctx.stroke();
      }
    }
  }
}

const FontStack = "-apple-system, 'SF Pro Text', system-ui, sans-serif";

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}
