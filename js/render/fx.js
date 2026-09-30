// 视觉层的仿真：灯亮起的绽放、提示的呼吸脉冲、放灯与收官的光尘。
//
// 为什么单独一个文件、并且是**定步长**：这一层跑在 rAF 上，帧间隔天然是浮动的
// （60/120Hz、掉帧、切回标签页）。若把位移写成 `x += v * 帧dt`，同一份操作在
// 不同刷新率下会落在不同的像素上——手感就随屏幕而变了。所以这里只有一行吃帧 dt
// （advance 里的 `accum += elapsed`），仿真内部永远只看见恒定的 SIM_STEP。
//
// 随机数也不用 Math.random：绽放的光尘由这条自带的 LCG 决定，同一虚拟时刻
// 在任何帧率下掷出同一个序列，对拍才有可比性。

export const SIM_STEP = 1 / 120;
const MAX_STEPS = 6; // 一次回调最多补 6 步：切回标签页时不追帧，宁可让动画跳一下
const DRAG = 0.86; // 60Hz 下的经验阻尼，按 dt 折算成 Math.pow(DRAG, dt*60)
const GRAVITY = 1.15; // 单位是"格/秒²"——位置全部用格坐标，窗口缩放不会打乱粒子
const TAU = Math.PI * 2;
const BREATH = 2.6; // 灯晕呼吸一轮的秒数
const BLOOM_DUR = 0.42;
const PULSE_DUR = 1.4;

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class Fx {
  constructor(seed = 20260930) {
    this.seed = seed;
    this.rng = lcg(seed);
    this.reset();
    this.reduced = false;
  }

  // 重开/换一局必须走到这里：漏掉任何一个缓冲，上一局的动画就会带着下一局跑。
  reset() {
    this.time = 0;
    this.accum = 0;
    this.steps = 0;
    this.parts = [];
    this.bloom = new Map();
    this.pulse = null;
    this.win = 0;
    this.rng = lcg(this.seed);
  }

  get dirty() {
    return this.parts.length > 0 || !!this.pulse || this.bloom.size > 0 || this.win > 0;
  }

  // 灯晕的呼吸：只要盘上有灯且没开省动效，就每帧都要重画。
  breathing(lampCount) {
    return !this.reduced && lampCount > 0;
  }

  advance(elapsed) {
    if (!(elapsed > 0)) return 0;
    this.accum += elapsed;
    let n = 0;
    while (this.accum >= SIM_STEP && n < MAX_STEPS) {
      this.step(SIM_STEP);
      this.accum -= SIM_STEP;
      n += 1;
    }
    if (n === MAX_STEPS) this.accum = 0;
    this.steps += n;
    return n;
  }

  step(dt) {
    this.time += dt;
    if (this.reduced) {
      // 省动效不是"把动画调快"，是不跑它：粒子清空、脉冲与绽放立即结束。
      if (this.parts.length) this.parts.length = 0;
      this.pulse = null;
      this.bloom.clear();
      this.win = 0;
      return;
    }
    for (let i = this.parts.length - 1; i >= 0; i -= 1) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        const tail = this.parts.pop();
        if (i < this.parts.length) this.parts[i] = tail;
        continue;
      }
      const damp = Math.pow(DRAG, dt * 60);
      p.vx *= damp;
      p.vy = p.vy * damp + GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
    if (this.pulse) {
      this.pulse.t += dt;
      if (this.pulse.t >= this.pulse.dur) this.pulse = null;
    }
    if (this.bloom.size) {
      for (const [cell, t] of this.bloom) {
        const next = t + dt;
        if (next >= BLOOM_DUR) this.bloom.delete(cell);
        else this.bloom.set(cell, next);
      }
    }
    if (this.win > 0) this.win = Math.max(0, this.win - dt);
  }

  // 放下一盏灯：一小簇向上飘的光尘。
  pop(cell, x, y, { count = 12, speed = 2.4, life = 0.62 } = {}) {
    if (this.reduced) return 0;
    this.bloom.set(cell, 0);
    return this.emit(x, y, count, speed, life, { up: -0.55 });
  }

  // 擦掉一盏灯：往下沉的灰屑，和放灯读起来是两件事。
  dust(cell, x, y, { count = 7, speed = 1.5, life = 0.45 } = {}) {
    if (this.reduced) return 0;
    return this.emit(x, y, count, speed, life, { up: 0.35 });
  }

  // 提示点名的那几格：一圈呼吸描边（PULSE_DUR 秒后自动结束）。
  setPulse(cells) {
    if (this.reduced || !cells || !cells.length) {
      this.pulse = null;
      return 0;
    }
    this.pulse = { cells: cells.slice(), t: 0, dur: PULSE_DUR };
    return this.pulse.dur;
  }

  // 收官：整盘亮一次，再从每盏灯喷一轮光尘。points 是格坐标 [{x, y}]。
  celebrate(points) {
    if (this.reduced) return 0;
    this.win = 0.9;
    let n = 0;
    for (const p of points.slice(0, 24)) n += this.emit(p.x, p.y, 10, 3.1, 0.95, { up: -0.9 });
    return n;
  }

  emit(x, y, count, speed, life, { up = 0 } = {}) {
    if (this.reduced) return 0;
    const r = this.rng;
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * TAU + r() * 0.5;
      const v = speed * (0.55 + r() * 0.6);
      this.parts.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v + up * v,
        life: life * (0.7 + r() * 0.5),
        max: life,
        size: 0.1 + r() * 0.16,
        rot: r() * TAU,
        spin: (r() - 0.5) * 7,
      });
    }
    return count;
  }

  // 灯晕呼吸系数：0.88–1.12 的缓慢起伏，用仿真钟而不是 Date.now()，
  // 于是它和粒子处在同一个时间轴上，也对同一虚拟时刻。
  breath() {
    if (this.reduced) return 1;
    return 1 + 0.12 * Math.sin((this.time * TAU) / BREATH);
  }

  pulseAlpha() {
    if (!this.pulse) return 0;
    const k = this.pulse.t / this.pulse.dur;
    return k < 0.25 ? k / 0.25 : 1 - (k - 0.25) / 0.75;
  }

  bloomOf(cell) {
    const t = this.bloom.get(cell);
    return t === undefined ? 0 : 1 - t / BLOOM_DUR;
  }

  summary() {
    return {
      time: this.time,
      steps: this.steps,
      accum: this.accum,
      parts: this.parts.length,
      bloom: this.bloom.size,
      pulse: this.pulse ? this.pulse.t : -1,
      win: this.win,
      // 位置指纹：对拍时看的就是这一串，浮点求和顺序固定才有可比性。
      px: this.parts.reduce((s, p) => s + p.x, 0),
      py: this.parts.reduce((s, p) => s + p.y, 0),
      plife: this.parts.reduce((s, p) => s + p.life, 0),
    };
  }
}
