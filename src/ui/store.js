// App state and where it lives.
//
// The job, its plan and the ticked-off cuts are kept in this browser's
// localStorage and saved after every change. To keep a copy or move a job to
// another device, the user saves it to a job file (toJobFile / fromJobFile).

import { exampleJob } from '../engine/example.js';
import { RESULT_VERSION } from '../engine/optimize.js';
import { analyzeJob } from '../engine/model.js';
import { verifyResult } from '../engine/verify.js';
import { newId } from './dom.js';

const KEY = 'cabinet-optimizer/state/v1';

export const blankStock = () => ({ id: newId('s'), material: '', thickness: null, length: null, width: null, qty: null, faces: 2, grain: 'length', price: null });
export const blankPanel = (like) => ({
  id: newId('p'), name: '', length: null, width: null, qty: 1,
  stockId: like?.stockId ?? null, grain: like?.grain ?? 'length', faces: like?.faces ?? 1, bandL: 0, bandW: 0,
});

export function blankJob(units = 'mm') {
  const stock = blankStock();
  return {
    version: 1, name: '', units,
    kerf: units === 'in' ? 3.175 : 4, trim: 0, bandThickness: 0,
    minOffcut: units === 'in' ? 101.6 : 100, firstCut: 'auto', favor: 'offcuts',
    stock: [stock], panels: [blankPanel({ stockId: stock.id })],
  };
}

/** Accept a job from storage or an imported file, filling in anything missing. */
export function normalizeJob(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.stock) || !Array.isArray(raw.panels)) {
    throw new Error('This file does not look like a cabinet-optimizer job.');
  }
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const job = {
    version: 1,
    name: typeof raw.name === 'string' ? raw.name : '',
    units: raw.units === 'in' ? 'in' : 'mm',
    kerf: num(raw.kerf), trim: num(raw.trim) ?? 0, bandThickness: num(raw.bandThickness) ?? 0,
    minOffcut: num(raw.minOffcut) ?? 100,
    firstCut: ['rip', 'cross'].includes(raw.firstCut) ? raw.firstCut : 'auto',
    // jobs saved before this setting existed get the behaviour they always had
    favor: raw.favor === 'cuts' ? 'cuts' : 'offcuts',
    stock: raw.stock.map((s) => ({
      id: String(s.id ?? newId('s')), material: String(s.material ?? ''),
      thickness: num(s.thickness), length: num(s.length), width: num(s.width),
      qty: num(s.qty), faces: s.faces === 1 ? 1 : 2,
      grain: ['width', 'none'].includes(s.grain) ? s.grain : 'length', price: num(s.price),
    })),
    panels: [],
  };
  const keyOf = (s) => `${s.material.trim().replace(/\s+/g, ' ').toLowerCase()}|${s.thickness}`;
  job.panels = raw.panels.map((p) => {
    let stockId = p.stockId != null ? String(p.stockId) : null;
    if (!job.stock.some((s) => s.id === stockId)) {
      // files written by hand may name the material instead of pointing at a row
      const want = `${String(p.material ?? '').trim().replace(/\s+/g, ' ').toLowerCase()}|${num(p.thickness)}`;
      stockId = job.stock.find((s) => keyOf(s) === want)?.id ?? null;
    }
    return {
      id: String(p.id ?? newId('p')), name: String(p.name ?? ''),
      length: num(p.length), width: num(p.width), qty: num(p.qty) ?? 1, stockId,
      grain: ['width', 'any'].includes(p.grain) ? p.grain : 'length',
      faces: [0, 2].includes(p.faces) ? p.faces : 1,
      bandL: [1, 2].includes(p.bandL) ? p.bandL : 0, bandW: [1, 2].includes(p.bandW) ? p.bandW : 0,
    };
  });
  return job;
}

/** Only what affects the plan: renaming the job or switching display units does not make a plan stale. */
export function jobHash(job) {
  const { name, units, favor, ...rest } = job;
  // the default is left out so plans saved before the setting existed still count as up to date
  return JSON.stringify(favor === 'cuts' ? { ...rest, favor } : rest);
}

/**
 * The saved job file: the job, plus the cutting plan and ticked-off cuts when
 * the plan is up to date with the job. A plan for an edited job is left out.
 */
export function toJobFile(state) {
  const { job, result, resultHash, progress } = state;
  const file = { app: 'cabinet-optimizer', version: 1, job };
  if (result && resultHash === jobHash(job)) file.plan = { result, resultHash, progress: progress ?? {} };
  return file;
}

/** The file as text: the job laid out so it can be read and edited, the plan on one line to keep the file small. */
export function jobFileText(state) {
  const { plan, ...head } = toJobFile(state);
  const text = JSON.stringify(head, null, 2);
  return plan ? `${text.slice(0, -2)},\n  "plan": ${JSON.stringify(plan)}\n}\n` : `${text}\n`;
}

/**
 * True if a plan read from a file is really a plan for this job: the same
 * panels and stock, and it passes the independent checker that every new plan
 * goes through. Anything odd, including a plan that makes the checker throw, is refused.
 */
function planHolds(job, result) {
  try {
    const { problem, blocking } = analyzeJob(job);
    if (blocking) return false;
    const same = (a, b, keys) => a.length === b.length && a.every((x, i) => keys.every((k) => x[k] === b[i][k]));
    if (!same(result.panels, problem.panels, ['name', 'l', 'w', 'qty', 'groupKey'])) return false;
    if (!same(result.stocks, problem.stocks, ['L', 'W', 'groupKey', 'faces'])) return false;
    const check = verifyResult(problem, result);
    result.check = check; // never trust a "passed" that came from the file
    return check.ok;
  } catch { return false; }
}

/**
 * Read a job file. The plan is kept only if it matches the job, was made by this
 * version of the optimizer and passes the checker again. `rejected` is true when
 * the file had a plan that was left out.
 */
export function fromJobFile(raw) {
  const job = normalizeJob(raw?.job ?? raw);
  const plan = raw?.plan;
  const none = { job, result: null, resultHash: null, progress: {}, rejected: Boolean(plan) };
  const usable = plan?.result?.version === RESULT_VERSION && plan.resultHash === jobHash(job) && planHolds(job, plan.result);
  if (!usable) return none;
  const progress = plan.progress && typeof plan.progress === 'object' && !Array.isArray(plan.progress) ? plan.progress : {};
  return { job, result: plan.result, resultHash: plan.resultHash, progress, rejected: false };
}

export const store = {
  state: null,
  saved: true, // false when the browser refused the last save (private mode, storage full or blocked)
  onStatus: null, // called with `saved` after every save

  init() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY)); } catch { /* corrupt or unavailable */ }
    if (saved?.job) {
      try {
        this.state = { job: normalizeJob(saved.job), result: saved.result ?? null, resultHash: saved.resultHash ?? null, progress: saved.progress ?? {} };
      } catch { saved = null; }
    }
    if (!saved?.job) this.state = this.fresh(exampleJob());
    return this.state;
  },

  fresh(job) {
    return { job, result: null, resultHash: null, progress: {} };
  },

  /** Start from a job, and optionally its plan and progress (from an opened file). */
  replace(job, plan = {}) {
    this.state = { ...this.fresh(job), ...plan };
    this.save();
  },

  /** Persist after a change. */
  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.state)); this.saved = true; } catch { this.saved = false; }
    this.onStatus?.(this.saved);
  },
};
