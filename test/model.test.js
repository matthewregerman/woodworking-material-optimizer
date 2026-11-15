// Bad input must be caught and explained, never silently packed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeJob, MAX_PIECES } from '../src/engine/model.js';
import { optimizeSync } from '../src/engine/optimize.js';
import { exampleJob } from '../src/engine/example.js';
import { stock, panel, job } from './helpers/jobs.js';

const errors = (j) => analyzeJob(j).issues.filter((i) => i.level === 'error');
const warnings = (j) => analyzeJob(j).issues.filter((i) => i.level === 'warning');
const hasError = (j, re, field) => errors(j).some((e) => re.test(e.message) && (!field || e.field === field));

test('the example job is valid', () => {
  const a = analyzeJob(exampleJob());
  assert.equal(a.blocking, false);
  assert.deepEqual(a.issues, []);
  assert.equal(a.problem.groups.length, 4);
  assert.equal(a.problem.pieceCount, 44);
});

test('an empty job asks for stock and panels', () => {
  const j = job([], []);
  assert.ok(hasError(j, /Add at least one stock sheet/));
  assert.ok(hasError(j, /Add at least one panel/));
  assert.equal(optimizeSync(j).ok, false);
});

test('blank rows are ignored rather than reported', () => {
  const j = job([stock(), { id: 'x', material: '', thickness: null, length: null, width: null }],
    [panel('A', 500, 300), { id: 'y', name: '', length: null, width: null, qty: 1 }]);
  assert.deepEqual(errors(j), []);
});

test('missing, zero, negative and unreadable numbers are errors on the right field', () => {
  assert.ok(hasError(job([stock({ length: null })], [panel('A', 500, 300)]), /enter the length/, 'length'));
  assert.ok(hasError(job([stock({ thickness: 0 })], [panel('A', 500, 300)]), /thickness must be a number greater than zero/, 'thickness'));
  assert.ok(hasError(job([stock({ material: '  ' })], [panel('A', 500, 300)]), /enter a material name/, 'material'));
  assert.ok(hasError(job([stock()], [panel('A', NaN, 300)]), /length must be a number greater than zero/, 'length'));
  assert.ok(hasError(job([stock()], [panel('A', 500, -3)]), /width must be a number/, 'width'));
  assert.ok(hasError(job([stock()], [panel('A', 500, 300, 1.5)]), /whole number/, 'qty'));
  assert.ok(hasError(job([stock()], [panel('A', 500, 300, null)]), /enter a quantity/, 'qty'));
  assert.ok(hasError(job([stock({ qty: 2.5 })], [panel('A', 500, 300)]), /whole number/, 'qty'));
  assert.ok(hasError(job([stock()], [panel('A', 500, 300)], { kerf: -1 }), /Saw kerf/, 'kerf'));
  assert.ok(hasError(job([stock()], [panel('A', 500, 300)], { trim: NaN }), /Edge trim/, 'trim'));
});

test('a panel must have a stock sheet of its material and thickness', () => {
  assert.ok(hasError(job([stock()], [panel('A', 500, 300, 1, { material: 'Oak' })]), /no stock sheet of "Oak"/, 'material'));
  assert.ok(hasError(job([stock()], [panel('A', 500, 300, 1, { thickness: 12 })]), /no 12 mm "Ply" stock — only 18 mm/, 'material'));
  assert.ok(hasError(job([stock()], [panel('A', 500, 300, 1, { material: '', stockId: 'gone' })]), /choose which material/, 'material'));
});

test('material names match regardless of case and spacing', () => {
  const j = job([stock({ material: 'Birch  Plywood ' })], [panel('A', 500, 300, 1, { material: 'birch plywood' })]);
  assert.deepEqual(errors(j), []);
});

test('a panel can reference its stock row by id', () => {
  const s = stock({ id: 'sheetA', material: 'Walnut ply' });
  const p = { ...panel('A', 500, 300), material: undefined, thickness: undefined, stockId: 'sheetA' };
  const a = analyzeJob(job([s], [p]));
  assert.equal(a.blocking, false);
  assert.equal(a.problem.panels[0].groupKey, a.problem.stocks[0].groupKey);
});

test('panels that cannot fit are explained', () => {
  assert.ok(hasError(job([stock()], [panel('Big', 2500, 300)]), /larger than the usable sheet area \(2440 mm × 1220 mm\)/));
  assert.ok(hasError(job([stock()], [panel('Trimmed out', 2440, 300)], { trim: 10 }), /2420 mm × 1200 mm after edge trim/));
  // 1300 long across a 1220 sheet would only fit if turned against the grain
  assert.ok(hasError(job([stock()], [panel('Cross', 300, 1300)]), /only fits the sheet if turned against the grain/));
  assert.deepEqual(errors(job([stock()], [panel('Cross', 300, 1300, 1, { grain: 'any' })])), []);
  assert.deepEqual(errors(job([stock({ grain: 'none' })], [panel('Cross', 300, 1300)])), []);
});

test('a panel seen on both faces needs a sheet with two good faces', () => {
  assert.ok(hasError(job([stock({ faces: 1 })], [panel('Door', 700, 400, 1, { faces: 2 })]), /only comes with one good face/, 'faces'));
  assert.deepEqual(errors(job([stock({ faces: 1 }), stock({ faces: 2 })], [panel('Door', 700, 400, 1, { faces: 2 })])), []);
});

test('a sheet that vanishes under the edge trim is an error', () => {
  assert.ok(hasError(job([stock({ length: 100, width: 100 })], [panel('A', 50, 50)], { trim: 50 }), /nothing is left of this sheet/));
});

test('edge banding thickness is deducted from the cut size', () => {
  const j = job([stock()], [panel('Shelf', 800, 300, 1, { bandL: 1, bandW: 2 })], { bandThickness: 2 });
  const p = analyzeJob(j).problem.panels[0];
  assert.equal(p.fl, 800000);
  assert.equal(p.l, 796000); // both ends banded
  assert.equal(p.w, 298000); // one long edge banded
  assert.ok(hasError(job([stock()], [panel('Sliver', 800, 3, 1, { bandL: 2 })], { bandThickness: 2 }), /nothing is left after deducting/));
});

test('warnings do not block: zero quantities, odd grain, missing kerf', () => {
  const j = job([stock({ length: 1220, width: 2440 }), stock({ material: 'Spare', qty: 0 })],
    [panel('A', 500, 300), panel('Skip me', 500, 300, 0)], { kerf: null });
  const a = analyzeJob(j);
  assert.equal(a.blocking, false);
  const w = warnings(j).map((x) => x.message).join('\n');
  assert.match(w, /grain is set to run along the shorter side/);
  assert.match(w, /0 sheets available/);
  assert.match(w, /quantity is 0/);
  assert.match(w, /No saw kerf entered/);
  assert.equal(a.problem.pieceCount, 1);
});

test('absurdly large jobs are refused', () => {
  assert.ok(hasError(job([stock()], [panel('A', 100, 100, MAX_PIECES + 1)]), /limit is/));
});

test('grain direction and rip axis are derived from the stock', () => {
  const a = analyzeJob(job([
    stock({ material: 'A' }), stock({ material: 'B', grain: 'width' }),
    stock({ material: 'C', grain: 'none' }), stock({ material: 'D', grain: 'none', length: 1000, width: 2000 }),
  ], [panel('x', 100, 100, 1, { material: 'A' })]));
  assert.deepEqual(a.problem.stocks.map((s) => [s.grainAxis, s.ripAxis]), [['x', 'x'], ['y', 'y'], [null, 'x'], [null, 'y']]);
});
