// Hundreds of random jobs (metric and imperial, several materials and sheet
// sizes, limited stock, trim, banding, every grain and face setting): the
// plan must pass the independent verifier every time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optimizeSync } from '../src/engine/optimize.js';
import { analyzeJob } from '../src/engine/model.js';
import { randomJob, FAST } from './helpers/jobs.js';

test('300 random jobs all produce verified plans', () => {
  let solved = 0, rejected = 0, withUnplaced = 0, pieces = 0, sheets = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const j = randomJob(seed);
    const r = optimizeSync(j, FAST);
    if (!r.ok) {
      // the random generator sometimes asks for the impossible; that must be
      // reported as input errors, not crash
      assert.ok(r.issues.some((i) => i.level === 'error'), `seed ${seed}`);
      rejected++;
      continue;
    }
    assert.deepEqual(r.check.errors, [], `seed ${seed}`);
    // belt and braces, straight from the job: nothing lost, nothing invented
    const want = analyzeJob(j).problem.panels.reduce((n, p) => n + p.qty, 0);
    const unplaced = r.unplaced.reduce((n, u) => n + u.count, 0);
    assert.equal(r.totals.pieces + unplaced, want, `seed ${seed}`);
    for (const g of r.groups) assert.ok(g.unplaced > 0 || g.sheets >= g.lowerBound, `seed ${seed}`);
    solved++;
    if (unplaced) withUnplaced++;
    pieces += r.totals.pieces;
    sheets += r.totals.sheets;
  }
  // make sure the generator is really exercising the engine
  assert.ok(solved >= 150, `only ${solved} solvable jobs`);
  assert.ok(withUnplaced >= 3, 'limited-stock shortfalls should occur');
  assert.ok(pieces > 3000 && sheets > 300);
  console.log(`    ${solved} solved (${pieces} pieces on ${sheets} sheets, ${withUnplaced} with stock shortfalls), ${rejected} rejected as invalid input`);
});

test('full default effort also verifies on a sample of random jobs', () => {
  for (let seed = 301; seed <= 312; seed++) {
    const r = optimizeSync(randomJob(seed), {});
    if (r.ok) assert.deepEqual(r.check.errors, [], `seed ${seed}`);
  }
});
