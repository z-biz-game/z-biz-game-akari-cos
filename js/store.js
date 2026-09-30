// Persistence. Everything lives under one key so a reset is one line, and a run in progress
// is stored as (origin seed, tier, cell states, what the run has cost) rather than a copy of
// the wall pattern or the solution — the generator is deterministic, so the board never has
// to travel through storage and a save stays a few hundred bytes even on 12×12.

import { TIERS } from './engine/generate.js';

const KEY = 'akari.save.v1';

const defaults = () => ({
  settings: { sound: true, reduceMotion: false, showLight: true },
  best: {},
  resume: null,
  totals: { solved: 0, hints: 0, ms: 0 },
});

// 解码分两段：第一段只管"读得回来"（JSON 没坏），第二段逐字段验明正身。
// 坏一条就丢那一条，其余照用——一坨垃圾 localStorage 不该把整局冻在启动画面。
const MAX_CELLS = 12 * 12; // 最大档位 12×12，超过的一律当噪声
const CELL_STATE = new Set([0, 1, 2]);
// 档位名以生成器为准，不在这里重列一遍。改名/撤档的旧档必须在这里就被认出读不懂，
// 否则 makePuzzle 的 tierById 会悄悄退回第一档，把 12×12 的大师局续成 8×8 的见习局。
const TIER_IDS = new Set(TIERS.map((t) => t.id));

const isInt = (v) => typeof v === 'number' && Number.isFinite(v) && Math.floor(v) === v;

function int(v, { min = 0, max = Number.MAX_SAFE_INTEGER, def = 0 } = {}) {
  return isInt(v) && v >= min && v <= max ? v : def;
}

function bool(v, def) {
  return typeof v === 'boolean' ? v : def;
}

function str(v, max) {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
}

function plain(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// Cell states are 0 undetermined / 1 bulb / 2 pencil mark, and an early board is mostly 0s —
// run-length coding is why a 144-cell save is not a 3 KB JSON array.
function rleEncode(board) {
  const out = [];
  let run = board[0] || 0;
  let n = 1;
  for (let i = 1; i < board.length; i++) {
    if (board[i] === run && n < 255) n++;
    else {
      out.push(run, n);
      run = board[i];
      n = 1;
    }
  }
  out.push(run, n);
  return out;
}

function rleDecode(pairs, len) {
  const b = new Uint8Array(len);
  let i = 0;
  for (let p = 0; p < pairs.length; p += 2) {
    const v = pairs[p];
    const n = pairs[p + 1];
    for (let k = 0; k < n && i < len; k++) b[i++] = v;
  }
  return b;
}

// 一段游程数组要么全合法要么整段丢掉：留一半会让右半边棋盘凭空多出灯泡。
function sanitizeInk(v) {
  if (!Array.isArray(v) || v.length === 0 || v.length % 2 !== 0) return null;
  for (let p = 0; p < v.length; p += 2) {
    if (!CELL_STATE.has(v[p])) return null;
    if (!isInt(v[p + 1]) || v[p + 1] < 1 || v[p + 1] > 255) return null;
  }
  return v;
}

function sanitizeResume(v, junk) {
  if (!plain(v)) {
    if (v != null) junk.push('resume');
    return null;
  }
  const seed = str(v.seed, 64);
  const tier = str(v.tier, 24);
  const cells = v.cells;
  const ink = sanitizeInk(v.ink);
  const badTier = !!tier && !TIER_IDS.has(tier);
  if (!seed || !tier || badTier || !isInt(cells) || cells < 1 || cells > MAX_CELLS || !ink) {
    junk.push(badTier ? 'resume.tier' : 'resume');
    return null;
  }
  return {
    seed,
    tier,
    cells,
    ink,
    elapsedMs: int(v.elapsedMs, { max: 100 * 60 * 60 * 1000 }),
    moves: int(v.moves, { max: 1e6 }),
    hints: int(v.hints, { max: 1e6 }),
    at: int(v.at, { min: 0, max: Number.MAX_SAFE_INTEGER, def: 0 }),
  };
}

function sanitizeBest(v, junk) {
  const out = {};
  if (!plain(v)) {
    if (v != null) junk.push('best');
    return out;
  }
  for (const [tier, rec] of Object.entries(v)) {
    if (!str(tier, 24) || !plain(rec)) {
      junk.push(`best.${tier}`);
      continue;
    }
    const ms = int(rec.ms, { max: 100 * 60 * 60 * 1000, def: -1 });
    if (ms < 0) {
      junk.push(`best.${tier}`);
      continue;
    }
    out[tier] = {
      ms,
      hints: int(rec.hints, { max: 1e6 }),
      moves: int(rec.moves, { max: 1e6 }),
      size: int(rec.size, { min: 1, max: 12, def: 8 }),
      at: int(rec.at, { def: 0 }),
    };
  }
  return out;
}

function sanitize(parsed) {
  const junk = [];
  const base = defaults();
  if (!plain(parsed)) return { data: base, junk: parsed == null ? [] : ['root'] };
  const s = plain(parsed.settings) ? parsed.settings : parsed.settings != null ? (junk.push('settings'), {}) : {};
  const data = {
    settings: {
      sound: bool(s.sound, base.settings.sound),
      reduceMotion: bool(s.reduceMotion, base.settings.reduceMotion),
      showLight: bool(s.showLight, base.settings.showLight),
    },
    best: sanitizeBest(parsed.best, junk),
    totals: {
      solved: int(parsed.totals && parsed.totals.solved, { max: 1e7 }),
      hints: int(parsed.totals && parsed.totals.hints, { max: 1e7 }),
      ms: int(parsed.totals && parsed.totals.ms, { max: 1e7 * 3600 }),
    },
    resume: parsed.resume == null ? null : sanitizeResume(parsed.resume, junk),
  };
  return { data, junk };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { data: defaults(), junk: [] };
    return sanitize(JSON.parse(raw));
  } catch {
    // 连 JSON 都不是：整份当垃圾，但游戏照常开局。
    return { data: defaults(), junk: ['raw'] };
  }
}

const first = load();

export const Store = {
  data: first.data,
  // 上次解码丢掉了哪些字段。留在原地是为了能被量到，而不是写进下一次存档。
  junk: first.junk.slice(),

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* private mode / quota — the game is still playable, just forgetful */
    }
  },

  setting(name) {
    return this.data.settings[name];
  },
  setSetting(name, value) {
    this.data.settings[name] = value;
    this.save();
  },

  best(tier) {
    return this.data.best[tier] || null;
  },
  // Best time is decided by *least help taken* first: a record must mean "I lit this board
  // myself", and a fast run built on six hints is not that.
  recordBest(tier, { ms, hints, moves, size }) {
    const cur = this.data.best[tier];
    const better =
      !cur ||
      hints < cur.hints ||
      (hints === cur.hints && (moves < cur.moves || (moves === cur.moves && ms < cur.ms)));
    if (better) this.data.best[tier] = { ms, hints, moves, size, at: Date.now() };
    this.save();
    return better;
  },

  recordSolve(ms, hints) {
    const t = this.data.totals;
    t.solved++;
    t.hints += hints;
    t.ms += ms;
    this.save();
  },

  saveResume(puzzle, state, elapsedMs, run) {
    this.data.resume = {
      // The generator derives an internal seed from what it is handed, so a resume has to
      // store the *origin* seed or the rebuilt board would not be the same one.
      seed: puzzle.originSeed || puzzle.seed,
      tier: puzzle.tier,
      elapsedMs,
      cells: puzzle.w * puzzle.h,
      ink: rleEncode(state),
      // The cost of the run travels with the board. Without it a player could take six
      // hints, close the tab, come back, and finish with a clean 提示 0 record — the score
      // that decides the best time is counted from actions, and actions are not saved.
      moves: run.moves,
      hints: run.hints,
      at: Date.now(),
    };
    this.save();
  },

  resume() {
    const r = this.data.resume;
    if (!r) return null;
    return { ...r, board: rleDecode(r.ink, r.cells) };
  },

  clearResume() {
    this.data.resume = null;
    this.save();
  },

  reset() {
    this.data = defaults();
    this.junk = [];
    this.save();
  },
};
