// The saved job file: the job, plus the plan and ticked-off cuts when they are
// still valid. Opening a file must never show a plan that does not match its job.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optimizeSync } from '../src/engine/optimize.js';
import { exampleJob } from '../src/engine/example.js';
import { toJobFile, jobFileText, fromJobFile, jobHash, normalizeJob, store } from '../src/ui/store.js';
import { FAST, kitchenJob, randomJob } from './helpers/jobs.js';

const stateFor = (job) => {
  const result = optimizeSync(structuredClone(job), FAST);
  return { job, result, resultHash: jobHash(job), progress: { 1: [1, 2, 3] } };
};
const roundTrip = (file) => JSON.parse(JSON.stringify(file));

test('a saved file brings back the same job, plan and ticked-off cuts', () => {
  const state = stateFor(exampleJob());
  const loaded = fromJobFile(roundTrip(toJobFile(state)));
  assert.deepEqual(loaded.job, state.job);
  assert.equal(loaded.resultHash, state.resultHash);
  assert.deepEqual(loaded.progress, { 1: [1, 2, 3] });
  assert.equal(loaded.result.totals.sheets, state.result.totals.sheets);
  assert.deepEqual(loaded.result.sheets, state.result.sheets);
});

test('the file text is valid JSON, with the job readable and the plan on one line', () => {
  const state = stateFor(exampleJob());
  const text = jobFileText(state);
  assert.deepEqual(JSON.parse(text), roundTrip(toJobFile(state)));
  assert.ok(text.split('\n').length < 400, 'only the job is spread over many lines');
  assert.ok(text.length < 80_000);
  const noPlan = jobFileText({ ...state, result: null, resultHash: null });
  assert.equal(JSON.parse(noPlan).plan, undefined);
  assert.deepEqual(JSON.parse(noPlan).job, roundTrip(state.job));
});

test('a plan for a job that was edited afterwards is not saved', () => {
  const state = stateFor(exampleJob());
  state.job.panels[0].qty += 1;
  assert.equal(toJobFile(state).plan, undefined);
});

test('a file with no plan opens as a job with no plan', () => {
  const state = stateFor(exampleJob());
  const loaded = fromJobFile({ app: 'cabinet-optimizer', version: 1, job: state.job });
  assert.equal(loaded.result, null);
  assert.deepEqual(loaded.progress, {});
});

test('older job files and bare jobs still open', () => {
  const job = exampleJob();
  assert.equal(fromJobFile({ app: 'cabinet-optimizer', version: 1, job }).job.panels.length, job.panels.length);
  assert.equal(fromJobFile(job).job.panels.length, job.panels.length);
});

test('a plan that does not match its job is dropped', () => {
  const file = roundTrip(toJobFile(stateFor(exampleJob())));
  file.job.panels[0].qty += 1; // job edited by hand after the plan was made
  assert.equal(fromJobFile(file).result, null);
});

test('a plan from a different version of the optimizer is dropped', () => {
  const file = roundTrip(toJobFile(stateFor(exampleJob())));
  file.plan.result.version += 1;
  assert.equal(fromJobFile(file).result, null);
});

test('bad progress data becomes empty progress', () => {
  const file = roundTrip(toJobFile(stateFor(exampleJob())));
  file.plan.progress = [1, 2];
  assert.deepEqual(fromJobFile(file).progress, {});
});

test('a file that is not a job is refused', () => {
  assert.throws(() => fromJobFile({ hello: 'world' }), /does not look like/);
  assert.throws(() => fromJobFile(null), /does not look like/);
});

test('replacing the job keeps an opened plan, and clears it otherwise', () => {
  const store2 = { ...store, fresh: store.fresh, save() {} };
  const state = stateFor(exampleJob());
  store2.replace(state.job, { result: state.result, resultHash: state.resultHash, progress: { 1: [1] } });
  assert.deepEqual(store2.state.progress, { 1: [1] });
  assert.ok(store2.state.result);
  store2.replace(exampleJob());
  assert.equal(store2.state.result, null);
  assert.deepEqual(store2.state.progress, {});
});

// ---- plans read from a file are checked again --------------------------------

const savedFile = (job = exampleJob()) => roundTrip(toJobFile(stateFor(job)));
const rejected = (file) => { const r = fromJobFile(file); return r.result === null && r.rejected === true; };

test('good plans survive saving and opening, including multi-sheet, fewer-cuts and random jobs', () => {
  const jobs = [
    normalizeJob(kitchenJob()),
    normalizeJob(kitchenJob({ favor: 'cuts' })),
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((seed) => normalizeJob(randomJob(seed))),
  ];
  for (const j of jobs) {
    const state = stateFor(j);
    if (!state.result.ok) continue; // a random job that cannot be planned has nothing to save
    const loaded = fromJobFile(roundTrip(toJobFile(state)));
    assert.ok(loaded.result, 'a good plan was refused');
    assert.equal(loaded.rejected, false);
    assert.equal(loaded.result.check.ok, true);
  }
});

test('a plan with a changed part size is refused', () => {
  const file = savedFile();
  file.plan.result.sheets[0].placements[0].dx += 10;
  assert.ok(rejected(file));
});

test('a plan with a cut moved or removed is refused', () => {
  const moved = savedFile();
  moved.plan.result.sheets[0].steps[0].length += 5;
  assert.ok(rejected(moved));
  const removed = savedFile();
  removed.plan.result.sheets[0].steps.pop();
  assert.ok(rejected(removed));
});

test('a plan with a part missing is refused', () => {
  const file = savedFile();
  file.plan.result.sheets[0].placements.pop();
  assert.ok(rejected(file));
});

test('a plan whose panel list does not match the job is refused', () => {
  const file = savedFile();
  file.plan.result.panels[0].l += 1;
  assert.ok(rejected(file));
  const renamed = savedFile();
  renamed.plan.result.panels[0].name = 'Something else';
  assert.ok(rejected(renamed));
});

test('a plan cannot carry its own "passed" check', () => {
  const file = savedFile();
  file.plan.result.sheets[0].placements[0].dy += 10;
  file.plan.result.check = { ok: true, errors: [] };
  assert.ok(rejected(file));
  // and a good plan comes back with a freshly worked-out check, not the one in the file
  const good = savedFile();
  good.plan.result.check = { ok: true, errors: ['left over from the file'] };
  const loaded = fromJobFile(good);
  assert.ok(loaded.result);
  assert.deepEqual(loaded.result.check.errors, []);
});

test('broken plan data is refused instead of crashing', () => {
  for (const damage of [
    (r) => { r.sheets = 'x'; },
    (r) => { r.sheets = null; },
    (r) => { r.panels = null; },
    (r) => { r.stocks = {}; },
    (r) => { r.sheets[0].steps = null; },
    (r) => { r.sheets[0].placements[0] = null; },
    (r) => { delete r.sheets[0].leftovers; },
    (r) => { r.sheets[0].leftovers = 'none'; },
  ]) {
    const file = savedFile();
    damage(file.plan.result);
    assert.doesNotThrow(() => fromJobFile(file));
    assert.ok(rejected(file));
  }
  const noResult = savedFile();
  noResult.plan = { result: 7 };
  assert.ok(rejected(noResult));
});

test('a file with no plan is not reported as having a refused plan', () => {
  const { plan, ...bare } = savedFile();
  assert.equal(fromJobFile(bare).rejected, false);
});
