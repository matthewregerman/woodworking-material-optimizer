// The "prefer fewer cuts" option: it must save cuts where it can, and it must
// never pay for them with an extra sheet, more stock, or a missing part.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optimizeSync } from '../src/engine/optimize.js';
import { analyzeJob } from '../src/engine/model.js';
import { buildGroupProblem, solveGroupSync, countSheetCuts, farTrimPlan } from '../src/engine/packer.js';
import { buildCutPlan } from '../src/engine/cuts.js';
import { describeStep } from '../src/ui/text.js';
import { normalizeJob, jobHash, blankJob } from '../src/ui/store.js';
import { exampleJob } from '../src/engine/example.js';
import { stock, panel, job, randomJob, kitchenJob, FAST } from './helpers/jobs.js';

const strip = (r) => { const c = structuredClone(r); delete c.elapsedMs; return c; };
const sheetsBy = (r) => Object.fromEntries(r.groups.map((g) => [g.key, g.sheets]));
const stockArea = (r) => r.totals.stockArea;
const unplaced = (r) => r.unplaced.reduce((n, u) => n + u.count, 0);

/** The promises the option makes, checked for one job. Returns [cuts before, cuts after]. */
function checkPair(base, opts, label) {
  const a = optimizeSync({ ...base, favor: 'offcuts' }, opts);
  const b = optimizeSync({ ...base, favor: 'cuts' }, opts);
  assert.equal(a.ok, b.ok, label);
  if (!a.ok) return null;
  assert.deepEqual(a.check.errors, [], label);
  assert.deepEqual(b.check.errors, [], `${label}: fewer-cuts plan failed the independent verifier`);
  assert.ok(unplaced(b) <= unplaced(a), `${label}: more parts left out`);
  assert.equal(b.totals.pieces + unplaced(b), a.totals.pieces + unplaced(a), label);
  const sa = sheetsBy(a), sb = sheetsBy(b);
  for (const key of Object.keys(sa)) assert.ok(sb[key] <= sa[key], `${label}: ${key} went from ${sa[key]} to ${sb[key]} sheets`);
  assert.ok(b.totals.sheets <= a.totals.sheets, `${label}: more sheets`);
  assert.ok(stockArea(b) <= stockArea(a), `${label}: more stock area`);
  assert.ok(b.totals.cuts <= a.totals.cuts, `${label}: more cuts (${b.totals.cuts} > ${a.totals.cuts})`);
  for (const s of b.stocks) assert.ok(s.qty == null || s.used <= s.qty, label);
  // the plan carries the large-offcuts figures it was measured against
  assert.equal(b.favor, 'cuts');
  assert.equal(b.compare.cuts, a.totals.cuts, label);
  assert.equal(b.compare.sheets, a.totals.sheets, label);
  assert.equal(b.compare.offcutArea, a.totals.offcutArea, label);
  assert.equal(a.favor, 'offcuts');
  assert.equal(a.compare, undefined);
  return [a.totals.cuts, b.totals.cuts];
}

test('large offcuts stays the default, and is unaffected by the new option', () => {
  const plain = exampleJob();
  delete plain.favor;
  const a = strip(optimizeSync(plain, FAST));
  const b = strip(optimizeSync({ ...exampleJob(), favor: 'offcuts' }, FAST));
  const c = strip(optimizeSync({ ...exampleJob(), favor: 'something else' }, FAST));
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
  assert.equal(a.favor, 'offcuts');
  assert.equal(analyzeJob(plain).problem.favor, 'offcuts');
  assert.equal(analyzeJob({ ...plain, favor: 'cuts' }).problem.favor, 'cuts');
});

test('kitchen job (3 laminate + 2 birch sheets, 36 pieces): same sheets, fewer cuts', () => {
  const a = optimizeSync(kitchenJob());
  const b = optimizeSync(kitchenJob({ favor: 'cuts' }));
  assert.deepEqual(a.check.errors, []);
  assert.deepEqual(b.check.errors, []);
  for (const r of [a, b]) {
    assert.equal(r.totals.sheets, 5);
    assert.equal(r.totals.pieces, 36);
    assert.deepEqual(r.unplaced, []);
    assert.deepEqual(r.groups.map((g) => [g.label, g.sheets]), [['Laminate · 18 mm', 3], ['Birch plywood · 18 mm', 2]]);
  }
  assert.equal(a.totals.cuts, 61);
  assert.equal(b.compare.cuts, 61);
  // CutList Optimizer needed 55 for the same job
  assert.ok(b.totals.cuts <= 55, `fewer-cuts mode took ${b.totals.cuts} cuts`);
  // per-sheet counts are in the plan and add up to the total
  assert.equal(b.sheets.reduce((n, s) => n + s.steps.length, 0), b.totals.cuts);
  console.log(`    kitchen: ${a.totals.cuts} cuts favouring offcuts [${a.sheets.map((s) => s.steps.length)}], ${b.totals.cuts} favouring fewer cuts [${b.sheets.map((s) => s.steps.length)}]`);
});

test('example job: same five sheets, fewer cuts', () => {
  const r = checkPair(exampleJob(), {}, 'example');
  assert.ok(r[1] < r[0], `expected fewer cuts, got ${r[1]} vs ${r[0]}`);
  console.log(`    example: ${r[0]} -> ${r[1]} cuts`);
});

test('100 random jobs: never more sheets, stock, missing parts or cuts; always verified', () => {
  let solved = 0, improved = 0, before = 0, after = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const r = checkPair(randomJob(seed), FAST, `seed ${seed}`);
    if (!r) continue;
    solved++;
    before += r[0]; after += r[1];
    if (r[1] < r[0]) improved++;
  }
  assert.ok(solved >= 50, `only ${solved} solvable jobs`);
  assert.ok(improved >= 15, `only ${improved} jobs improved`);
  console.log(`    ${solved} jobs: ${before} cuts favouring offcuts, ${after} favouring fewer cuts; ${improved} jobs improved`);
});

test('default effort keeps the same promises on a sample of random jobs', () => {
  for (let seed = 200; seed <= 210; seed++) checkPair(randomJob(seed), {}, `seed ${seed}`);
});

test('parts that tile a sheet exactly are cut with the theoretical minimum of cuts', () => {
  // 8 squares fill the sheet 4 x 2: each cut makes one more piece, so 7 cuts
  const r = optimizeSync(job([stock({ length: 1200, width: 600 })], [panel('Square', 300, 300, 8)], { kerf: 0, favor: 'cuts' }));
  assert.deepEqual(r.check.errors, []);
  assert.equal(r.totals.sheets, 1);
  assert.equal(r.totals.cuts, 7);
});

test('with edge trim, a far edge that several parts end on is trimmed once', () => {
  // usable area 1200 x 600 holds the same 8 squares; all four edges need trimming
  const mk = (favor) => job([stock({ length: 1220, width: 620 })], [panel('Square', 300, 300, 8)], { kerf: 0, trim: 10, favor });
  const a = optimizeSync(mk('offcuts'));
  const b = optimizeSync(mk('cuts'));
  assert.deepEqual(b.check.errors, []);
  assert.equal(b.totals.sheets, 1);
  // 4 trims + 7 cuts between the squares is the fewest possible
  assert.equal(b.totals.cuts, 11);
  assert.ok(a.totals.cuts > 11);
  const [sheet] = b.sheets;
  const trims = sheet.steps.filter((s) => s.kind === 'trim');
  assert.equal(trims.length, 4);
  assert.deepEqual(sheet.steps.slice(0, 4).map((s) => s.kind), ['trim', 'trim', 'trim', 'trim']);
  const titles = trims.map((s) => describeStep(s, sheet, b, 'mm').title);
  assert.deepEqual(titles, [
    'Trim 10 mm off one long edge', 'Trim 10 mm off one short edge',
    'Trim 10 mm off the opposite short edge', 'Trim 10 mm off the opposite long edge',
  ]);
  // every part still sits inside the trimmed area
  for (const pl of sheet.placements) {
    assert.ok(pl.x >= 10000 && pl.y >= 10000 && pl.x + pl.dx <= 1210000 && pl.y + pl.dy <= 610000);
  }
});

test('the cut count the search minimises is exactly the number of steps in the cutting order', () => {
  let checked = 0;
  for (let seed = 1; seed <= 30; seed++) {
    for (const favor of ['offcuts', 'cuts']) {
      const { problem, blocking } = analyzeJob({ ...randomJob(seed), favor });
      if (blocking) continue;
      for (const group of problem.groups) {
        const P = buildGroupProblem(problem, group);
        const sol = solveGroupSync(P, { ...FAST, iterations: 150 });
        for (const sh of sol.sheets) {
          const st = P.stocks[sh.stock].ref;
          const plan = buildCutPlan({
            L: st.L, W: st.W, trim: problem.trim, kerf: problem.kerf, root: sh.root, minOffcut: problem.minOffcut,
            farTrim: farTrimPlan(P, sh), panelOfItem: (it) => P.types[P.itemType[it]].panelIdx,
          });
          assert.equal(countSheetCuts(P, sh), plan.steps.length, `seed ${seed} ${favor}`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 80, `only ${checked} sheets checked`);
});

test('limited stock: fewer-cuts mode leaves out no more parts than the default', () => {
  const base = job([stock({ length: 1000, width: 500, qty: 2 })], [panel('A', 480, 240, 6), panel('B', 300, 150, 9)], { kerf: 3 });
  const r = checkPair(base, {}, 'limited');
  assert.ok(r);
  const b = optimizeSync({ ...base, favor: 'cuts' });
  assert.ok(b.stocks[0].used <= 2);
});

test('fewer-cuts mode is repeatable', () => {
  const j = kitchenJob({ favor: 'cuts' });
  const a = strip(optimizeSync(structuredClone(j), FAST));
  const b = strip(optimizeSync(structuredClone(j), FAST));
  assert.deepEqual(a, b);
});

test('saved jobs: older files load with the old behaviour and their plans stay current', () => {
  const old = exampleJob();
  delete old.favor; // a job saved before the option existed
  const loaded = normalizeJob(JSON.parse(JSON.stringify(old)));
  assert.equal(loaded.favor, 'offcuts');
  // the hash stored with an old plan was made from a job with no such field
  const { name, units, ...rest } = normalizeJob(old);
  delete rest.favor;
  const oldHash = JSON.stringify(rest);
  assert.equal(jobHash(loaded), oldHash);
  // switching the option makes the plan out of date; switching back does not
  assert.notEqual(jobHash({ ...loaded, favor: 'cuts' }), oldHash);
  assert.equal(jobHash({ ...loaded, favor: 'offcuts' }), oldHash);
  // the setting survives a save and reload, and junk falls back to the default
  assert.equal(normalizeJob(JSON.parse(JSON.stringify({ ...loaded, favor: 'cuts' }))).favor, 'cuts');
  assert.equal(normalizeJob({ ...loaded, favor: 42 }).favor, 'offcuts');
  assert.equal(blankJob().favor, 'offcuts');
});
