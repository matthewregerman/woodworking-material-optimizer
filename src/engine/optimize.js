// Entry point of the engine: job in, verified cutting plan out.

import { analyzeJob } from './model.js';
import { buildGroupProblem, solveGroup } from './packer.js';
import { buildCutPlan } from './cuts.js';
import { verifyResult } from './verify.js';

export const RESULT_VERSION = 1;

function defaultIterations(nItems) {
  return Math.max(400, Math.min(6000, Math.round(3e7 / (nItems * nItems + 400))));
}

/**
 * Generator form: yields progress (0..1) and returns the result.
 * opts: { iterations, polishIterations, seed, timeLimitMs }
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

  for (const group of problem.groups) {
    const P = buildGroupProblem(problem, group);
    const n = P.itemType.length;
    const share = n / totalPieces;
    const gen = solveGroup(P, {
      iterations: opts.iterations ?? defaultIterations(n),
      polishIterations: opts.polishIterations,
      pairIterations: opts.pairIterations,
      seed: opts.seed,
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
    const groupSheets = sol.sheets.map((sh) => {
      const stock = P.stocks[sh.stock].ref;
      const plan = buildCutPlan({
        L: stock.L, W: stock.W, trim: problem.trim, kerf: problem.kerf,
        root: sh.root, minOffcut: problem.minOffcut,
        panelOfItem: (it) => P.types[P.itemType[it]].panelIdx,
      });
      let area = 0;
      for (const pl of plan.placements) area += pl.dx * pl.dy;
      let offcutArea = 0;
      for (const o of plan.leftovers) if (o.kind === 'offcut') offcutArea += o.w * o.h;
      let cutLength = 0;
      for (const s of plan.steps) cutLength += s.length;
      return { stockIdx: stock.idx, groupKey: group.key, ...plan, partsArea: area, offcutArea, cutLength };
    });
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
  };
  result.check = verifyResult(problem, result);
  return result;
}

export function optimizeSync(job, opts = {}) {
  const gen = optimizeGen(job, opts);
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value;
}

/** Runs in slices so the page stays responsive; onProgress gets 0..1. */
export async function optimizeAsync(job, opts = {}) {
  const gen = optimizeGen(job, { timeLimitMs: 6000, ...opts });
  let r = gen.next();
  let last = Date.now();
  while (!r.done) {
    if (Date.now() - last > 40) {
      opts.onProgress?.(r.value);
      await new Promise((res) => setTimeout(res, 0));
      last = Date.now();
    }
    r = gen.next();
  }
  return r.value;
}
