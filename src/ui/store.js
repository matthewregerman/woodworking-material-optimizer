// App state and where it lives.
//
// Everything is kept in this browser's localStorage. When the page is served
// by the bundled server (npm start) the same state is also saved to a file on
// the computer, so a phone on the same Wi-Fi opens the same job, plan and
// ticked-off cuts. Newest save wins.

import { exampleJob } from '../engine/example.js';
import { newId } from './dom.js';

const KEY = 'cabinet-optimizer/state/v1';
const API = 'api/state';

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

export const store = {
  state: null,
  serverOk: false,
  onExternalChange: null, // called when a newer state arrives from the server
  onStatus: null,
  _timer: null,

  init() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY)); } catch { /* corrupt or unavailable */ }
    if (saved?.job) {
      try { this.state = { ...saved, job: normalizeJob(saved.job) }; } catch { saved = null; }
    }
    if (!saved?.job) this.state = this.fresh(exampleJob(), 0);
    return this.state;
  },

  fresh(job, updatedAt = Date.now()) {
    return { job, result: null, resultHash: null, progress: {}, updatedAt };
  },

  replace(job) {
    this.state = this.fresh(job);
    this.save(true);
  },

  /** Persist after a change. */
  save(now = false) {
    this.state.updatedAt = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch { /* private mode / full */ }
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.push(), now ? 0 : 700);
  },

  async push() {
    if (!this.serverOk) return;
    try {
      const res = await fetch(API, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(this.state) });
      this.onStatus?.(res.ok ? 'synced' : 'local');
    } catch { this.onStatus?.('local'); }
  },

  /** Fetch the server copy; adopt it if it is newer than ours. */
  async pull() {
    if (!location.protocol.startsWith('http')) return false;
    try {
      const res = await fetch(API, { cache: 'no-store' });
      if (!res.ok || res.headers.get('x-cabinet-optimizer') !== '1') return false;
      this.serverOk = true;
      this.onStatus?.('synced');
      if (res.status === 204) { if (this.state.updatedAt > 0) this.push(); return false; }
      const remote = await res.json();
      if (remote?.job && (remote.updatedAt ?? 0) > (this.state.updatedAt ?? 0)) {
        this.state = { ...this.fresh(normalizeJob(remote.job), remote.updatedAt), result: remote.result ?? null, resultHash: remote.resultHash ?? null, progress: remote.progress ?? {} };
        try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch { /* ignore */ }
        this.onExternalChange?.();
        return true;
      }
      if ((this.state.updatedAt ?? 0) > (remote?.updatedAt ?? 0)) this.push();
    } catch { /* offline or static hosting: local only */ }
    return false;
  },
};
