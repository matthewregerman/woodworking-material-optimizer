// Job builders shared by the tests.

import { mulberry32 } from '../../src/engine/packer.js';

export const FAST = { iterations: 250, greedyIterations: 200, pairIterations: 150, drainIterations: 100, polishIterations: 120, maxDrainTries: 10, maxPairTries: 6, greedyRounds: 3 };

let uid = 0;
export const stock = (o = {}) => ({
  id: `s${++uid}`, material: 'Ply', thickness: 18, length: 2440, width: 1220,
  qty: null, faces: 2, grain: 'length', price: null, ...o,
});
export const panel = (name, length, width, qty = 1, o = {}) => ({
  id: `p${++uid}`, name, length, width, qty, material: 'Ply', thickness: 18,
  grain: 'length', faces: 1, bandL: 0, bandW: 0, ...o,
});
export const job = (stocks, panels, o = {}) => ({
  units: 'mm', kerf: 3, trim: 0, bandThickness: 0, minOffcut: 100, firstCut: 'auto',
  stock: stocks, panels, ...o,
});

/**
 * Cut a sheet into pieces with random straight cuts. The pieces are therefore
 * known to fit back onto one sheet (with the kerf).
 */
export function carve(rng, L, W, k, minSide, depth) {
  const out = [];
  const rec = (w, h, d) => {
    const canX = w >= 2 * minSide + k, canY = h >= 2 * minSide + k;
    if (d === 0 || (!canX && !canY) || (d < depth - 1 && rng() < 0.12)) { out.push([w, h]); return; }
    const alongX = canX && (!canY || rng() < w / (w + h));
    if (alongX) {
      const a = minSide + Math.floor(rng() * ((w - k - 2 * minSide) / 10 + 1)) * 10;
      rec(a, h, d - 1); rec(Math.round((w - a - k) * 10) / 10, h, d - 1);
    } else {
      const a = minSide + Math.floor(rng() * ((h - k - 2 * minSide) / 10 + 1)) * 10;
      rec(w, a, d - 1); rec(w, Math.round((h - a - k) * 10) / 10, d - 1);
    }
  };
  rec(L, W, depth);
  return out;
}

/** A random but plausible job exercising every rule the engine has. */
export function randomJob(seed) {
  const rng = mulberry32(seed * 7919 + 13);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const inches = seed % 5 === 0;
  const u = inches ? 25.4 : 1;
  const kerf = inches ? pick([0, 0.125, 0.09375]) * u : pick([0, 1.2, 2.2, 3, 3.2, 4]);
  const trim = inches ? pick([0, 0.25, 0.5]) * u : pick([0, 0, 5, 10, 12.5]);
  const stocks = [];
  const materials = pick([['Birch ply'], ['Birch ply', 'MDF'], ['Birch ply', 'MDF', 'Melamine']]);
  for (const m of materials) {
    const thickness = inches ? pick([0.25, 0.5, 0.75]) * u : pick([6, 12, 18, 19]);
    const sizes = inches ? [[96, 48], [60, 60]] : [[2440, 1220], [1525, 1525], [2800, 2070]];
    const [L, W] = pick(sizes);
    const grain = m === 'Birch ply' ? pick(['length', 'length', 'width']) : 'none';
    stocks.push(stock({ material: m, thickness, length: L * u, width: W * u, faces: pick([1, 2, 2]), grain, qty: rng() < 0.15 ? 1 + Math.floor(rng() * 3) : null }));
    if (rng() < 0.35) {
      // a second sheet type of the same material: different size and face quality
      const [L2, W2] = pick(sizes);
      stocks.push(stock({ material: m.toUpperCase() + ' ', thickness, length: L2 * u, width: W2 * u, faces: pick([1, 2]), grain, qty: rng() < 0.5 ? 1 + Math.floor(rng() * 2) : null }));
    }
  }
  const panels = [];
  const nPanels = 2 + Math.floor(rng() * 14);
  for (let i = 0; i < nPanels; i++) {
    const s = pick(stocks);
    const maxL = s.length - 2 * trim, maxW = s.width - 2 * trim;
    const step = inches ? 25.4 / 8 : 5;
    const len = Math.max(step * 8, Math.floor((rng() * rng() * 0.9 + 0.05) * maxL / step) * step);
    const wid = Math.max(step * 8, Math.floor((rng() * rng() * 0.9 + 0.05) * Math.min(maxW, maxL) / step) * step);
    panels.push(panel(`Part ${i + 1}`, len, wid, 1 + Math.floor(rng() * rng() * 9), {
      material: s.material.trim().toLowerCase(), thickness: s.thickness,
      grain: pick(['length', 'length', 'width', 'any']), faces: pick([0, 1, 1, 2]),
      bandL: pick([0, 0, 1, 2]), bandW: pick([0, 0, 1, 2]),
    }));
  }
  return job(stocks, panels, {
    units: inches ? 'in' : 'mm', kerf, trim,
    bandThickness: pick([0, 0, 0.5, 2]),
    minOffcut: pick([0, 50, 100, 150]),
    firstCut: pick(['auto', 'auto', 'rip', 'cross']),
  });
}

/**
 * A real job: kitchen cabinets and a frame, 36 pieces in two materials on
 * 2438 x 1219 sheets (3 laminate, 2 birch plywood), 3 mm kerf, no trim,
 * everything free to turn. CutList Optimizer cut it from 5 sheets in 55 cuts.
 */
export function kitchenJob(o = {}) {
  const lam = stock({ id: 'lam', material: 'Laminate', length: 2438, width: 1219, qty: 3, grain: 'none' });
  const bb = stock({ id: 'bb', material: 'Birch plywood', length: 2438, width: 1219, qty: 2, grain: 'none' });
  const P = (name, length, width, qty, material) => panel(name, length, width, qty, { material, grain: 'any', faces: 0 });
  const L = 'Laminate', B = 'Birch plywood';
  return job([lam, bb], [
    P('Fridge Big', 1241, 722, 1, L), P('Tallcab Big face', 1521, 454, 1, L), P('Tallcab Small face', 759, 454, 1, L),
    P('Sink Cab Face', 912, 756, 1, L), P('Fridge Small', 722, 475, 1, L), P('Fridge Condenser', 722, 521, 1, L),
    P('Tall Cab End', 2375, 630, 1, L), P('CornerCab Face', 759, 531, 1, L), P('Dishwasher Side', 635, 876, 1, L),
    P('Half Fridge divider', 1381, 641, 1, L), P('SmallCab Face', 759, 302, 1, L), P('3Drawer Small', 607, 124, 2, L),
    P('3Drawer Med', 251, 607, 2, L), P('3Drawer Large', 378, 607, 2, L),
    P('Fridge divider', 2286, 630, 1, B), P('Shelf Back', 1068, 235, 1, B), P('Vertical divider frame', 763, 100, 8, B),
    P('Horizonal divider frame', 430, 100, 8, B), P('Right Upper2', 1222, 100, 1, B),
  ], { kerf: 3, ...o });
}
