// Entry point of the engine: job in, verified cutting plan out.

import { analyzeJob } from './model.js';
import { buildGroupProblem, solveGroup, farTrimPlan } from './packer.js';
import { buildCutPlan } from './cuts.js';
import { verifyResult } from './verify.js';

export const RESULT_VERSION = 1;

function defaultIterations(nItems) {
  return Math.max(400, Math.min(6000, Math.round(3e7 / (nItems * nItems + 400))));
}

/**
 * Generator form: yields progress (0..1) and returns the result.
 * opts: { iterations, seed, timeLimitMs } plus the packer's tuning knobs.
 * The job's own `favor` setting ('offcuts' or 'cuts') picks the objective.
 */
export function* optimizeGen(job, opts = {}) {
  const { issues, problem, blocking } = analyzeJob(job);
  if (blocking) return { ok: false, issues };

  const totalPieces = problem.pieceCount || 1;
  const sheets = [];
  const unplaced = [];
  const groups = [];
  let donePieces = 0;
  const started = Date.now();
  const baseline = { favor: 'offcuts', sheets: 0, cuts: 0, cutLength: 0, offcutArea: 0, largestOffcut: { w: 0, h: 0 } };

  for (const group of problem.groups) {
    const P = buildGroupProblem(problem, group);
    const n = P.itemType.length;
    const share = n / totalPieces;
    const gen = solveGroup(P, {
      ...opts,
      iterations: opts.iterations ?? defaultIterations(n),
      timeLimitMs: opts.timeLimitMs ? Math.max(300, opts.timeLimitMs * share) : undefined,
    });
    let r = gen.next();
    while (!r.done) {
      yield (donePieces + r.value * n) / totalPieces;
      r = gen.next();
    }
    const sol = r.value;
    donePieces += n;

    let partsArea = 0;
    for (const pi of group.panels) partsArea += problem.panels[pi].l * problem.panels[pi].w * problem.panels[pi].qty;
    const usable = Math.max(...P.stocks.map((s) => s.L * s.W));
    const planFor = (sh, isBaseline) => {
      const stock = P.stocks[sh.stock].ref;
      const plan = buildCutPlan({
        L: stock.L, W: stock.W, trim: problem.trim, kerf: problem.kerf,
        root: sh.root, minOffcut: problem.minOffcut,
        farTrim: isBaseline === true ? null : farTrimPlan(P, sh),
        panelOfItem: (it) => P.types[P.itemType[it]].panelIdx,
      });
      let area = 0;
      for (const pl of plan.placements) area += pl.dx * pl.dy;
      let offcutArea = 0;
      for (const o of plan.leftovers) if (o.kind === 'offcut') offcutArea += o.w * o.h;
      let cutLength = 0;
      for (const s of plan.steps) cutLength += s.length;
      return { stockIdx: stock.idx, groupKey: group.key, ...plan, partsArea: area, offcutArea, cutLength };
    };
    const groupSheets = sol.sheets.map((sh) => planFor(sh, false));
    // In fewer-cuts mode the solver also hands back the large-offcuts layout it
    // started from, so the two can be compared without a second run.
    if (sol.baseline) {
      for (const sh of sol.baseline.map((b) => planFor(b, true))) {
        baseline.sheets++;
        baseline.cuts += sh.steps.length;
        baseline.cutLength += sh.cutLength;
        baseline.offcutArea += sh.offcutArea;
        for (const o of sh.leftovers) {
          if (o.kind === 'offcut' && o.w * o.h > baseline.largestOffcut.w * baseline.largestOffcut.h) baseline.largestOffcut = { w: o.w, h: o.h };
        }
      }
    }
    groupSheets.sort((a, b) => a.stockIdx - b.stockIdx || b.partsArea - a.partsArea);
    sheets.push(...groupSheets);

    const counts = new Map();
    for (const it of sol.unplacedItems) {
      const pi = P.types[P.itemType[it]].panelIdx;
      counts.set(pi, (counts.get(pi) ?? 0) + 1);
    }
    for (const [panelIdx, count] of counts) unplaced.push({ panelIdx, count });

    let stockArea = 0, placedArea = 0;
    for (const sh of groupSheets) {
      stockArea += problem.stocks[sh.stockIdx].L * problem.stocks[sh.stockIdx].W;
      placedArea += sh.partsArea;
    }
    groups.push({
      key: group.key, label: group.label,
      sheets: groupSheets.length,
      // no layout can use fewer sheets than the parts' total area needs
      lowerBound: Math.ceil(partsArea / usable),
      pieces: n, partsArea, placedArea, stockArea,
      unplaced: sol.unplacedItems.length,
    });
  }
  sheets.forEach((s, i) => { s.n = i + 1; });

  const placedCount = new Array(problem.panels.length).fill(0);
  const stockUse = new Array(problem.stocks.length).fill(0);
  const totals = { sheets: sheets.length, pieces: 0, partsArea: 0, stockArea: 0, offcutArea: 0, cuts: 0, cutLength: 0, cost: null, bandingLength: 0 };
  for (const s of sheets) {
    const stock = problem.stocks[s.stockIdx];
    stockUse[s.stockIdx]++;
    totals.pieces += s.placements.length;
    totals.partsArea += s.partsArea;
    totals.stockArea += stock.L * stock.W;
    totals.offcutArea += s.offcutArea;
    totals.cuts += s.steps.length;
    totals.cutLength += s.cutLength;
    for (const pl of s.placements) placedCount[pl.panelIdx]++;
    if (stock.price != null) totals.cost = (totals.cost ?? 0) + stock.price;
  }
  for (const p of problem.panels) totals.bandingLength += placedCount[p.idx] * (p.bandL * p.fl + p.bandW * p.fw);

  const result = {
    ok: true,
    version: RESULT_VERSION,
    issues: issues.filter((i) => i.level === 'warning'),
    units: problem.units, kerf: problem.kerf, trim: problem.trim, minOffcut: problem.minOffcut, band: problem.band,
    panels: problem.panels.map((p) => ({ ...p, placed: placedCount[p.idx] })),
    stocks: problem.stocks.map((s) => ({ ...s, qty: Number.isFinite(s.qty) ? s.qty : null, used: stockUse[s.idx] })),
    groups, sheets, unplaced, totals,
    elapsedMs: Date.now() - started,
    favor: problem.favor,
  };
  if (problem.favor === 'cuts') result.compare = baseline;
  result.check = verifyResult(problem, result);
  return result;
}

export function optimizeSync(job, opts = {}) {
  const gen = optimizeGen(job, opts);
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value;
}

// Hand control back to the browser for a moment. A message channel is used
// rather than a timer because browsers slow timers to one a second in
// background tabs, which would eat the time limit without doing any work.
function breathe() {
  return new Promise((resolve) => {
    if (typeof MessageChannel === 'undefined') { setTimeout(resolve, 0); return; }
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
    ch.port2.postMessage(0);
  });
}

/** Runs in slices so the page stays responsive; onProgress gets 0..1. */
export async function optimizeAsync(job, opts = {}) {
  const gen = optimizeGen(job, { timeLimitMs: 6000, ...opts });
  let r = gen.next();
  let last = Date.now();
  while (!r.done) {
    if (Date.now() - last > 40) {
      opts.onProgress?.(r.value);
      await breathe();
      last = Date.now();
    }
    r = gen.next();
  }
  return r.value;
}
