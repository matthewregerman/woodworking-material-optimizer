// The verifier is what every other test (and the app itself) leans on, so
// it must actually catch broken plans. Take a good plan, break it in one way
// at a time, and make sure each kind of damage is noticed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optimizeSync } from '../src/engine/optimize.js';
import { analyzeJob } from '../src/engine/model.js';
import { verifyResult } from '../src/engine/verify.js';
import { exampleJob } from '../src/engine/example.js';
import { FAST } from './helpers/jobs.js';

const job = exampleJob();
const problem = analyzeJob(job).problem;
const good = optimizeSync(job, FAST);
const fresh = () => structuredClone(good);
const check = (result, prob = problem) => verifyResult(prob, result);
const expectError = (result, re, prob) => {
  const v = check(result, prob);
  assert.equal(v.ok, false, 'damage was not detected');
  assert.ok(v.errors.some((e) => re.test(e)), `expected ${re}, got:\n${v.errors.join('\n')}`);
};

test('the untouched plan passes', () => {
  assert.deepEqual(check(fresh()), { ok: true, errors: [] });
});

test('a piece moved by one millimetre is caught', () => {
  const r = fresh();
  r.sheets[0].placements[0].x += 1000;
  expectError(r, /following the cuts does not produce/);
});

test('overlapping pieces are caught', () => {
  const r = fresh();
  const [a, b] = r.sheets[0].placements;
  b.x = a.x + 5000; b.y = a.y + 5000;
  expectError(r, /overlap or are closer than the kerf/);
});

test('pieces closer together than the kerf are caught', () => {
  const thicker = structuredClone(problem);
  thicker.kerf += 500; // pretend the blade is 0.5 mm thicker than the plan assumed
  expectError(fresh(), /closer than the kerf|blade width is not the kerf/, thicker);
});

test('a missing piece is caught', () => {
  const r = fresh();
  r.sheets[1].placements.pop();
  expectError(r, /asked for \d+, plan has \d+ placed/);
});

test('an extra piece is caught', () => {
  const r = fresh();
  const s = r.sheets.find((x) => x.leftovers.some((o) => o.kind === 'offcut'));
  const o = s.leftovers.find((x) => x.kind === 'offcut');
  s.placements.push({ ...s.placements[0], x: o.x, y: o.y });
  expectError(r, /asked for \d+, plan has \d+ placed/);
});

test('a piece with the wrong size is caught', () => {
  const r = fresh();
  r.sheets[0].placements[0].dx -= 2000;
  expectError(r, /wrong size/);
});

test('a piece turned against the grain is caught', () => {
  const r = fresh();
  const pl = r.sheets[0].placements.find((p) => problem.panels[p.panelIdx].grain !== 'any');
  pl.rotated = !pl.rotated;
  [pl.dx, pl.dy] = [pl.dy, pl.dx];
  expectError(r, /turned against the grain/);
});

test('a piece on the wrong material is caught', () => {
  const r = fresh();
  const from = r.sheets[0];
  const to = r.sheets.find((s) => s.groupKey !== from.groupKey);
  to.placements.push(from.placements.pop());
  expectError(r, /wrong material or thickness/);
});

test('a two-face panel on a one-face sheet is caught', () => {
  const oneFace = structuredClone(problem);
  for (const s of oneFace.stocks) s.faces = 1;
  expectError(fresh(), /needs 2 good faces/, oneFace);
});

test('a piece outside the trimmed area is caught', () => {
  const wider = structuredClone(problem);
  wider.trim += 5000;
  expectError(fresh(), /outside the usable area/, wider);
});

test('a cut that does not match the layout is caught', () => {
  const r = fresh();
  const st = r.sheets[0].steps.find((s) => s.kind === 'cut');
  st.c0 += 1000; st.c1 += 1000;
  expectError(r, /part is recorded as/);
});

test('a cut on a workpiece that does not exist is caught', () => {
  const r = fresh();
  const steps = r.sheets[0].steps;
  [steps[2], steps[steps.length - 1]] = [steps[steps.length - 1], steps[2]];
  expectError(r, /does not exist at this point|out of order/);
});

test('a skipped cut is caught', () => {
  const r = fresh();
  r.sheets[0].steps.pop();
  expectError(r, /following the cuts does not produce|is not listed|do not exist after the cuts/);
});

test('using more sheets than are in stock is caught', () => {
  const limited = structuredClone(problem);
  limited.stocks[0].qty = 1;
  expectError(fresh(), /used but only 1 available/, limited);
});
