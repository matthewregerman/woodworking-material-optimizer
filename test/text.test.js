// The words a person reads at the saw must match the geometry of the cut.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optimizeSync } from '../src/engine/optimize.js';
import { describeStep } from '../src/ui/text.js';
import { exampleJob } from '../src/engine/example.js';
import { stock, panel, job, FAST } from './helpers/jobs.js';

test('a cut is described by the size of the part kept and what it yields', () => {
  const r = optimizeSync(job([stock({ length: 1000, width: 500 })], [panel('Left', 300, 500), panel('Right', 400, 500)], { kerf: 4 }), FAST);
  const [sheet] = r.sheets;
  const texts = sheet.steps.map((st) => describeStep(st, sheet, r, 'mm'));
  // both cuts go across the grain of a 1000 x 500 sheet
  assert.ok(texts.every((t) => t.verb === 'Crosscut' && !t.isTrim));
  assert.deepEqual(texts.map((t) => t.measure).sort(), ['300', '400']);
  const first = texts[0];
  assert.match(first.take, /full sheet \(1000 × 500\)/);
  assert.match(first.how, /along its 1000 mm side/);
  assert.match(first.how, /4 mm kerf comes out of the other part/);
  assert.equal(first.a.kind, 'panel');
  const second = texts[1];
  assert.match(second.take, /piece from cut 1/);
  // 1000 - 300 - 400 - two 4 mm kerfs
  assert.equal(second.b.text, '292 × 500 offcut');
});

test('rip and crosscut follow the grain, and trims are called trims', () => {
  const r = optimizeSync(exampleJob(), FAST);
  for (const sheet of r.sheets) {
    const st = r.stocks[sheet.stockIdx];
    for (const step of sheet.steps) {
      const d = describeStep(step, sheet, r, 'mm');
      assert.equal(d.rip, step.dir === st.ripAxis);
      assert.equal(d.verb, d.rip ? 'Rip' : 'Crosscut');
      assert.equal(d.isTrim, step.kind === 'trim');
      if (d.isTrim) assert.match(d.title, /^Trim 10 mm off one (long|short) edge$/);
      else {
        const kept = step.dir === 'x' ? step.a.h : step.a.w;
        assert.equal(d.title, `${d.verb} at ${kept / 1000} mm`);
      }
      // every part that carries on names the cut it carries on to
      for (const [part, raw] of [[d.a, step.a], [d.b, step.b]]) {
        if (part?.kind === 'work') assert.equal(part.detail, `goes on to cut ${raw.next}`);
      }
    }
  }
});

test('inch jobs are worded in fractions', () => {
  const inch = 25.4;
  const r = optimizeSync(job([stock({ thickness: 0.75 * inch, length: 96 * inch, width: 48 * inch })],
    [panel('Side', 30.5 * inch, 48 * inch, 2, { thickness: 0.75 * inch })], { units: 'in', kerf: 0.125 * inch }), FAST);
  const d = describeStep(r.sheets[0].steps[0], r.sheets[0], r, 'in');
  assert.equal(d.title, 'Crosscut at 30 1/2″');
  assert.match(d.how, /1\/8″ kerf/);
});
