// Synthesised feedback, no sample files. A puzzle game's sound is a *state* readout —
// "a lamp came on", "that lamp is illegal", "the board is solved" — and each of those is
// one short envelope, so a synth keeps the artifact small and the vocabulary honest.

let ctx = null;
let master = null;
let enabled = true;
// 建过多少个振荡器节点，是要被实测的数：静音态下它必须一动不动。
let nodes = 0;

// 真静音 = 声卡上不再有任何东西在跑，而不是把 master 增益调到 0。
// 只设 gain 的话，振荡器照建、音频线程照占，任何一处忘了乘增益就漏声。
// 所以静音时 suspend()，并且 audio() 直接不返回上下文——连节点都不再新建。
function muteContext() {
  if (!ctx) return;
  try {
    if (ctx.state === 'running' && ctx.suspend) ctx.suspend().catch(() => {});
  } catch {
    /* 老 Safari 没有 suspend：不再新建节点这一点仍然成立 */
  }
}

function audio() {
  if (!enabled) return null;
  if (typeof AudioContext === 'undefined' && typeof webkitAudioContext === 'undefined') return null;
  if (!ctx) {
    const Ctor = typeof AudioContext !== 'undefined' ? AudioContext : webkitAudioContext;
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// One oscillator with a two-point pitch glide and an exponential decay. Everything below is
// a call to this; adding a second voice shape is how a game ends up with sounds that do not
// belong to the same instrument.
function tone({ f0, f1 = f0, dur = 0.12, type = 'sine', gain = 0.22, delay = 0 }) {
  const ac = audio();
  if (!ac || !enabled) return;
  const t = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const vol = ac.createGain();
  nodes += 1;
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
  vol.gain.setValueAtTime(0.0001, t);
  vol.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  vol.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(vol).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const Sound = {
  setEnabled(v) {
    const next = !!v;
    if (next === enabled) return next;
    enabled = next;
    if (!enabled) {
      muteContext();
      return enabled;
    }
    // 取消静音才把上下文叫醒——这一步得发生在用户手势里（浏览器不许自动播放），
    // 而 setEnabled 正是由"音效"按钮或 M 键触发的。
    if (ctx && ctx.resume) ctx.resume().catch(() => {});
    return enabled;
  },
  enabled: () => enabled,
  // 供实测：静音态下 contextState 必须是 'suspended'，且 nodes 不再增长。
  contextState: () => (ctx ? ctx.state : 'none'),
  nodeCount: () => nodes,

  bulb() {
    tone({ f0: 520, f1: 880, dur: 0.14, type: 'triangle', gain: 0.2 });
  },
  pencil() {
    tone({ f0: 300, f1: 240, dur: 0.07, type: 'square', gain: 0.07 });
  },
  erase() {
    tone({ f0: 240, f1: 180, dur: 0.08, type: 'sine', gain: 0.1 });
  },
  undo() {
    tone({ f0: 420, f1: 300, dur: 0.11, type: 'triangle', gain: 0.13 });
  },
  // Two detuned voices: an interval that is deliberately unpleasant, for the one thing the
  // player must notice without looking.
  conflict() {
    tone({ f0: 200, f1: 150, dur: 0.16, type: 'sawtooth', gain: 0.11 });
    tone({ f0: 214, f1: 158, dur: 0.16, type: 'sawtooth', gain: 0.09, delay: 0.01 });
  },
  hint() {
    tone({ f0: 760, f1: 1020, dur: 0.16, type: 'sine', gain: 0.16 });
    tone({ f0: 1140, dur: 0.1, type: 'sine', gain: 0.07, delay: 0.06 });
  },
  win() {
    [523, 659, 784, 1046].forEach((f, i) => tone({ f0: f, dur: 0.26, type: 'triangle', gain: 0.17, delay: i * 0.09 }));
  },
};
