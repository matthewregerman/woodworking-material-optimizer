// Are the layouts good, not just legal?

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optimizeSync } from '../src/engine/optimize.js';
import { mulberry32 } from '../src/engine/packer.js';
import { exampleJob } from '../src/engine/example.js';
import { makeExact } from './helpers/exact.js';
import { stock, panel, job, carve } from './helpers/jobs.js';

test('example job uses the fewest sheets that the material area allows', () => {
  const r = optimizeSync(exampleJob());
  assert.equal(r.totals.sheets, 5);
  for (const g of r.groups) assert.equal(g.sheets, g.lowerBound, g.label);
});

test('matches an exhaustive search on 60 small random jobs', () => {
  let checked = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const rng = mulberry32(seed);
    const n = 4 + Math.floor(rng() * 4);
    const L = 1000, W = 600, kerf = [0, 3, 3.2][seed % 3];
    const panels = [];
    for (let i = 0; i < n; i++) {
      const grain = ['length', 'any', 'width'][Math.floor(rng() * 3)];
      let l = 100 + Math.floor(rng() * 80) * 10, w = 100 + Math.floor(rng() * 45) * 10;
      if (grain === 'width' && l > W) l = W;
      if (grain === 'any' && Math.min(l, w) > W) w = 500;
      panels.push(panel(`P${i}`, l, w, 1, { grain }));
    }
    const r = optimizeSync(job([stock({ length: L, width: W })], panels, { kerf }));
    assert.equal(r.ok, true);
    assert.deepEqual(r.check.errors, []);
    const pieces = panels.map((p) => ({ l: p.length * 1000, w: p.width * 1000, mask: p.grain === 'any' ? 3 : p.grain === 'length' ? 1 : 2 }));
    const best = makeExact(pieces, kerf * 1000).minSheets(L * 1000, W * 1000);
    assert.equal(r.totals.sheets, best, `seed ${seed}: optimizer used ${r.totals.sheets}, the true minimum is ${best}`);
    checked++;
  }
  assert.equal(checked, 60);
});

test('the exhaustive reference solver itself is sane', () => {
  const ex = makeExact([{ l: 498, w: 500, mask: 1 }, { l: 498, w: 500, mask: 1 }], 4);
  assert.equal(ex.minSheets(1000, 500), 1);
  assert.equal(ex.minSheets(999, 500), 2);
  const turn = makeExact([{ l: 600, w: 300, mask: 3 }, { l: 600, w: 300, mask: 3 }, { l: 600, w: 300, mask: 3 }], 0);
  assert.equal(turn.minSheets(900, 600), 1);
  const noTurn = makeExact([{ l: 600, w: 300, mask: 1 }, { l: 600, w: 300, mask: 1 }, { l: 600, w: 300, mask: 1 }], 0);
  assert.equal(noTurn.minSheets(900, 600), 2);
});

test('re-assembles a sheet that was cut into 8–16 random pieces (100% full)', () => {
  for (let seed = 1; seed <= 8; seed++) {
    const rng = mulberry32(seed * 977 + 1);
    const panels = carve(rng, 2440, 1220, 3, 150, 4).map(([w, h], i) => panel(`P${i}`, w, h));
    const r = optimizeSync(job([stock()], panels, { kerf: 3 }));
    assert.deepEqual(r.check.errors, []);
    assert.equal(r.totals.sheets, 1, `seed ${seed}: ${panels.length} pieces`);
  }
});

test('multi-sheet jobs with a known answer: never more than one sheet over, usually spot on', () => {
  // 4 sheets cut up at random, ~15% of the pieces thrown away
  let exact = 0;
  const runs = 8;
  for (let seed = 1; seed <= runs; seed++) {
    const rng = mulberry32(seed * 131 + 7);
    const panels = [];
    for (let s = 0; s < 4; s++) {
      for (const [w, h] of carve(rng, 2440, 1220, 3, 150, 4)) {
        if (rng() < 0.15) continue;
        panels.push(panel(`P${panels.length}`, w, h));
      }
    }
    const r = optimizeSync(job([stock()], panels, { kerf: 3 }));
    assert.deepEqual(r.check.errors, []);
    assert.ok(r.totals.sheets <= 5, `seed ${seed}: used ${r.totals.sheets} sheets, 4 is known to be possible`);
    if (r.totals.sheets <= 4) exact++;
  }
  assert.ok(exact >= runs - 2, `only ${exact} of ${runs} matched the known answer`);
});

test('never worse than simple shelf packing', () => {
  // baseline: sort by height, fill rows left to right, new row / sheet when full
  const shelf = (pieces, L, W, k) => {
    const sorted = pieces.slice().sort((a, b) => b[1] - a[1]);
    let sheets = 1, x = 0, y = 0, rowH = 0;
    for (const [l, w] of sorted) {
      if (x > 0 && x + k + l > L) { y += rowH + k; x = 0; rowH = 0; }
      if (y + w > W) { sheets++; x = 0; y = 0; rowH = 0; }
      x += (x > 0 ? k : 0) + l;
      rowH = Math.max(rowH, w);
    }
    return sheets;
  };
  for (let seed = 1; seed <= 15; seed++) {
    const rng = mulberry32(seed * 4409);
    const panels = [];
    const pieces = [];
    for (let i = 0; i < 6 + Math.floor(rng() * 8); i++) {
      const l = 200 + Math.floor(rng() * 180) * 10, w = 100 + Math.floor(rng() * 50) * 10, q = 1 + Math.floor(rng() * 5);
      panels.push(panel(`P${i}`, l, w, q));
      for (let n = 0; n < q; n++) pieces.push([l, w]);
    }
    const r = optimizeSync(job([stock()], panels, { kerf: 3.2 }));
    assert.deepEqual(r.check.errors, []);
    const base = shelf(pieces, 2440, 1220, 3.2);
    assert.ok(r.totals.sheets <= base, `seed ${seed}: ${r.totals.sheets} sheets vs ${base} for shelf packing`);
  }
});

test('leftover is gathered into one large offcut rather than scattered', () => {
  // three identical parts fill half a sheet; the other half should stay whole
  const r = optimizeSync(job([stock()], [panel('Side', 800, 600, 3)], { kerf: 3 }));
  assert.equal(r.totals.sheets, 1);
  const offcuts = r.sheets[0].leftovers.filter((o) => o.kind === 'offcut').sort((a, b) => b.w * b.h - a.w * a.h);
  const biggest = offcuts[0].w * offcuts[0].h;
  const free = 2440e3 * 1220e3 - r.sheets[0].partsArea;
  assert.ok(biggest / free > 0.8, `largest offcut is only ${(biggest / free * 100).toFixed(0)}% of the leftover`);
});
