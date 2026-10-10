// Canvas renderer. It reads the Game's board state and paints; it never decides anything —
// no cell is "lit" here, no conflict is judged here, so the picture cannot disagree with the
// engine that the solver, the hints and the win check all use.
//
// Layout lives here too (cell size from the container, board origin, DPR) because hitTest has
// to answer with the *same* numbers draw() used. Those two drifting apart is how a board
// renders correctly but takes clicks one cell off.

import { Palette, Cell, Radius } from '../theme.js';
import { OPEN, BULB, MARK } from '../engine/akari.js';
import { Sheets } from './sheets.js';

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

  // 指针位置 → 格索引，盘外一律 -1。边缘点击不能落到格上：留白故意不属于棋盘。
  //
  // 先按 rect 的实际宽高折算一次：geo 记的是我们设定给 canvas 的 CSS 尺寸，而页面缩放、
  // 窄屏 flex 收缩、或将来给 #board 加 max-width 都会让 rect 与它脱钩。不折算的话，
  // 手机上"点 A 打 B"就是这么来的。
  hitTest(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const { cell, x, y } = this.geo;
    const game = this.game;
    if (!cell || !game || !rect.width || !rect.height) return -1;
    const kx = this.geo.w / rect.width;
    const ky = this.geo.h / rect.height;
    const px = (clientX - rect.left) * kx - x;
    const py = (clientY - rect.top) * ky - y;
    if (px < 0 || py < 0) return -1;
    const gx = Math.floor(px / cell);
    const gy = Math.floor(py / cell);
    if (gx < 0 || gy < 0 || gx >= game.w || gy >= game.h) return -1;
    return gy * game.w + gx;
  }

  // 格心在"格坐标"下的位置（不是像素）：fx 的粒子存在这一坐标系里，
  // 于是窗口大小变化、DPR 变化都不会把已经飞出去的光尘挪位。
  cellPos(i) {
    const game = this.game;
    if (!game) return { x: 0, y: 0 };
    return { x: (i % game.w) + 0.5, y: (((i / game.w) | 0)) + 0.5 };
  }

  draw(game, { fx = null } = {}) {
    this.game = game;
    const { ctx, geo } = this;
    const { cell, x: ox, y: oy } = geo;
    const b = game.board;
    const diag = game.diag;
    // 呼吸系数来自 fx 的仿真钟：动画的一切时间量都从那条时间轴上取，
    // 于是同一虚拟时刻在任何刷新率下画出同一张图。
    const breath = fx ? fx.breath() : 1;
    const win = fx ? fx.win : 0;
    ctx.clearRect(0, 0, geo.w, geo.h);

    roundRect(ctx, 0, 0, geo.w, geo.h, Radius.card);
    ctx.fillStyle = Palette.surface;
    ctx.fill();
    // 夜色纹理铺在底面之下当"纸"：它是美术资产，不是 CSS 装饰，所以随棋盘一起缩放。
    const field = Sheets.pattern(ctx, 'field');
    if (field) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = field;
      ctx.fillRect(0, 0, geo.w, geo.h);
      ctx.restore();
    }

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
      // 灯晕呼吸时整条光带跟着明暗一次，盘面才像"这一盏灯在亮着"而不是贴了张渐变图。
      grad.addColorStop(0, rgba(255, 200, 92, 0.05 * breath));
      grad.addColorStop(0.5, rgba(255, 200, 92, 0.2 * breath));
      grad.addColorStop(1, rgba(255, 200, 92, 0.05 * breath));
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
      // 刚放下的一盏灯开得更亮一些（bloom 从 1 衰减到 0），这是"你按下的这一下"的反馈。
      const bloom = fx ? fx.bloomOf(c) : 0;
      const haloScale = breath * (1 + bloom * 0.55);
      const haloR = rad * 2.6 * haloScale;
      const sheet = Sheets.get(bad ? 'haloBad' : 'halo');
      if (sheet) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, 0.9 * haloScale);
        ctx.drawImage(sheet, cx - haloR, cy - haloR, haloR * 2, haloR * 2);
        ctx.restore();
      } else {
        const halo = ctx.createRadialGradient(cx, cy, rad * 0.4, cx, cy, haloR);
        halo.addColorStop(0, bad ? rgba(255, 92, 122, 0.45) : rgba(255, 200, 92, 0.42));
        halo.addColorStop(1, rgba(0, 0, 0, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
        ctx.fill();
      }
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

    // 提示点名的那几格：描边随脉冲寿命淡出。它是盖在引擎已知状态上的一层临时画法。
    const pulse = fx ? fx.pulse : null;
    if (pulse && pulse.cells.length) {
      const a = Math.max(0, fx.pulseAlpha());
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = Palette.hint;
      ctx.lineWidth = Math.max(2, cell * 0.08);
      for (const c of pulse.cells) {
        if (c < 0 || b.wall[c]) continue;
        const r = this.cellRect(c);
        roundRect(ctx, r.x + 2, r.y + 2, cell - 4, cell - 4, Radius.cell);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 光尘。位置存在格坐标里，所以这里只做一次"格 → 像素"的乘法。
    if (fx && fx.parts.length) {
      const spark = Sheets.get('spark');
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const q of fx.parts) {
        const px = ox + q.x * cell;
        const py = oy + q.y * cell;
        const s = q.size * cell * 2;
        ctx.globalAlpha = Math.max(0, Math.min(1, q.life / q.max)) * 0.85;
        if (spark) {
          ctx.translate(px, py);
          ctx.rotate(q.rot);
          ctx.drawImage(spark, -s / 2, -s / 2, s, s);
          ctx.rotate(-q.rot);
          ctx.translate(-px, -py);
        } else {
          ctx.fillStyle = Palette.lampEdge;
          ctx.beginPath();
          ctx.arc(px, py, s / 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // 收官那一下：整盘压一层暖白，0.9 秒内退掉（省动效时 fx.win 恒为 0）。
    if (win > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.5, win * 0.5);
      ctx.fillStyle = Palette.lampEdge;
      roundRect(ctx, 0, 0, geo.w, geo.h, Radius.card);
      ctx.fill();
      ctx.restore();
    }
  }
}

// canvas 的渐变端点只吃字符串，而 alpha 要随仿真变——留一个拼接点，别得到处写模板字符串。
function rgba(r, g, b, a) {
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(4)})`;
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
