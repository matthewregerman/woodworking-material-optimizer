// The correctness rules, checked on hand-made cases with known answers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optimizeSync } from '../src/engine/optimize.js';
import { analyzeJob } from '../src/engine/model.js';
import { exampleJob } from '../src/engine/example.js';
import { stock, panel, job, FAST } from './helpers/jobs.js';

const mm = (u) => u / 1000;
const run = (j, opts = FAST) => {
  const r = optimizeSync(j, opts);
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.deepEqual(r.check.errors, []);
  return r;
};

test('example job: every rule holds and every panel appears exactly as often as asked', () => {
  const j = exampleJob();
  const r = run(j, {});
  const counts = new Map();
  for (const s of r.sheets) for (const pl of s.placements) counts.set(pl.panelIdx, (counts.get(pl.panelIdx) ?? 0) + 1);
  for (const p of r.panels) assert.equal(counts.get(p.idx), p.qty, p.name);
  assert.equal(r.totals.pieces, j.panels.reduce((n, p) => n + p.qty, 0));
  assert.deepEqual(r.unplaced, []);
});

test('kerf decides whether two pieces share a sheet', () => {
  const sheet = stock({ length: 1000, width: 500 });
  // 498 + 4 + 498 = 1000: exactly fits
  let r = run(job([sheet], [panel('Half', 498, 500, 2)], { kerf: 4 }));
  assert.equal(r.totals.sheets, 1);
  // 499 + 4 + 499 = 1002: does not
  r = run(job([sheet], [panel('Half', 499, 500, 2)], { kerf: 4 }));
  assert.equal(r.totals.sheets, 2);
  // with no kerf, two exact halves fit
  r = run(job([sheet], [panel('Half', 500, 500, 2)], { kerf: 0 }));
  assert.equal(r.totals.sheets, 1);
});

test('cut distances account for the kerf', () => {
  const r = run(job([stock({ length: 1000, width: 500 })], [panel('A', 300, 500), panel('B', 400, 500)], { kerf: 4 }));
  assert.equal(r.totals.sheets, 1);
  const [s] = r.sheets;
  // two crosscuts free two full-width pieces; the leftover is 1000 - 300 - 400 - 2 kerfs
  assert.equal(s.steps.length, 2);
  for (const st of s.steps) {
    assert.equal(st.dir, 'y');
    assert.equal(mm(st.c1 - st.c0), 4);
    assert.equal(mm(st.length), 500); // edge to edge across the 500 width
  }
  const off = s.leftovers.filter((o) => o.kind === 'offcut');
  assert.equal(off.length, 1);
  assert.equal(mm(off[0].w), 292);
  // each cut's near part is exactly a finished piece: that is the measurement to set
  const measures = s.steps.map((st) => mm(st.a.w)).sort((a, b) => a - b);
  assert.deepEqual(measures, [300, 400]);
});

test('the cut order starts from the whole sheet and only ever cuts a part that exists', () => {
  const r = run(exampleJob(), {});
  for (const s of r.sheets) {
    const stockRec = r.stocks[s.stockIdx];
    assert.deepEqual(s.steps[0].wp, { x: 0, y: 0, w: stockRec.L, h: stockRec.W });
    s.steps.forEach((st, i) => {
      assert.equal(st.n, i + 1);
      assert.ok(st.from < st.n, 'a cut can only use a part made by an earlier cut');
      if (st.from > 0) {
        const parent = s.steps[st.from - 1];
        const made = [parent.a, parent.b].filter(Boolean);
        assert.ok(made.some((p) => p.x === st.wp.x && p.y === st.wp.y && p.w === st.wp.w && p.h === st.wp.h));
        assert.ok(made.some((p) => p.next === st.n));
      }
      // edge to edge: the cut runs the full length of its workpiece
      assert.equal(st.length, st.dir === 'x' ? st.wp.w : st.wp.h);
    });
    // every piece is the end product of some cut (or is the whole sheet)
    const finished = s.steps.flatMap((st) => [st.a, st.b]).filter((p) => p && p.kind === 'panel');
    assert.equal(finished.length, s.placements.length);
  }
});

test('edge trim keeps pieces off the factory edges and adds trim cuts', () => {
  const r = run(job([stock({ length: 1000, width: 500 })], [panel('Full', 980, 480)], { kerf: 4, trim: 10 }));
  const [s] = r.sheets;
  assert.deepEqual([mm(s.placements[0].x), mm(s.placements[0].y)], [10, 10]);
  // two reference-edge trims, then the far edges because the piece reaches them
  assert.equal(s.steps.length, 4);
  assert.deepEqual(s.steps.map((st) => st.kind), ['trim', 'trim', 'cut', 'cut']);
  assert.deepEqual(s.steps.map((st) => [mm(st.c0), mm(st.c1)]), [[6, 10], [6, 10], [490, 494], [990, 994]]);
  assert.ok(s.leftovers.every((o) => o.kind === 'waste'));
});

test('a trim narrower than the blade is a skim cut with nothing falling off', () => {
  const r = run(job([stock({ length: 1000, width: 500 })], [panel('A', 600, 300)], { kerf: 3, trim: 1 }));
  const [first] = r.sheets[0].steps;
  assert.equal(first.kind, 'trim');
  assert.equal(first.a, null);
  assert.equal(mm(first.b.h), 499);
});

test('with no trim, pieces may use the factory edge and need no cut there', () => {
  const r = run(job([stock({ length: 1000, width: 500 })], [panel('Whole', 1000, 500)], { kerf: 3, trim: 0 }));
  assert.equal(r.sheets[0].steps.length, 0);
  assert.equal(r.totals.sheets, 1);
});

test('grain: panels are turned only the way their grain setting allows', () => {
  const sheet = stock({ length: 1000, width: 500 });
  let r = run(job([sheet], [panel('Along', 400, 300, 2), panel('Across', 400, 300, 2, { grain: 'width' })]));
  for (const s of r.sheets) {
    for (const pl of s.placements) {
      const p = r.panels[pl.panelIdx];
      assert.equal(pl.rotated, p.name === 'Across');
      assert.deepEqual([mm(pl.dx), mm(pl.dy)], p.name === 'Across' ? [300, 400] : [400, 300]);
    }
  }
  // grain running across the sheet flips the requirement
  r = run(job([stock({ length: 1000, width: 500, grain: 'width' })], [panel('Along', 400, 300, 2)]));
  assert.ok(r.sheets.every((s) => s.placements.every((pl) => pl.rotated)));
  // three 600 x 300 pieces fit a 900 x 600 sheet only if one is turned
  const free = [panel('Free', 600, 300, 3, { grain: 'any' })];
  const fixed = [panel('Fixed', 600, 300, 3)];
  const small = (o) => stock({ length: 900, width: 600, ...o });
  r = run(job([small()], free, { kerf: 0 }), {});
  assert.equal(r.totals.sheets, 1);
  assert.ok(r.sheets[0].placements.some((pl) => pl.rotated) && r.sheets[0].placements.some((pl) => !pl.rotated));
  r = run(job([small()], fixed, { kerf: 0 }), {});
  assert.equal(r.totals.sheets, 2);
  r = run(job([small({ grain: 'none' })], fixed, { kerf: 0 }), {});
  assert.equal(r.totals.sheets, 1, 'no grain on the sheet means panels may turn freely');
});

test('material and thickness: panels only come from matching sheets', () => {
  const r = run(job(
    [stock({ material: 'Birch', thickness: 18 }), stock({ material: 'Birch', thickness: 6 }), stock({ material: 'MDF', thickness: 18 })],
    [
      panel('Side', 700, 500, 4, { material: 'Birch', thickness: 18 }),
      panel('Back', 700, 500, 4, { material: 'Birch', thickness: 6 }),
      panel('Shelf', 700, 500, 4, { material: 'MDF', thickness: 18 }),
    ]));
  assert.equal(r.totals.sheets, 3);
  for (const s of r.sheets) {
    const st = r.stocks[s.stockIdx];
    for (const pl of s.placements) {
      assert.equal(r.panels[pl.panelIdx].groupKey, st.groupKey);
    }
  }
});

test('faces: panels seen on both sides only come from sheets with two good faces', () => {
  const oneFace = stock({ id: 'one', faces: 1 });
  const twoFace = stock({ id: 'two', faces: 2 });
  const r = run(job([oneFace, twoFace], [
    panel('Door', 700, 400, 6, { faces: 2 }),
    panel('Side', 700, 500, 6, { faces: 1 }),
    panel('Rail', 700, 100, 6, { faces: 0 }),
  ]), {});
  let doors = 0;
  for (const s of r.sheets) {
    for (const pl of s.placements) {
      const p = r.panels[pl.panelIdx];
      assert.ok(p.faces <= r.stocks[s.stockIdx].faces, p.name);
      if (p.name === 'Door') doors++;
    }
  }
  assert.equal(doors, 6);
});

test('limited stock: what cannot be cut is reported, never dropped or squeezed in', () => {
  const r = run(job([stock({ length: 1000, width: 500, qty: 1 })], [panel('A', 480, 480, 5)], { kerf: 3 }));
  assert.equal(r.totals.sheets, 1);
  assert.equal(r.totals.pieces, 2);
  assert.deepEqual(r.unplaced, [{ panelIdx: 0, count: 3 }]);
  assert.equal(r.groups[0].unplaced, 3);
});

test('limited stock is used alongside unlimited stock without exceeding it', () => {
  const r = run(job(
    [stock({ id: 'offcut', length: 800, width: 600, qty: 1 }), stock({ id: 'full' })],
    [panel('A', 700, 500, 7)]), {});
  assert.deepEqual(r.unplaced, []);
  const used = r.stocks.find((s) => s.id === 'offcut').used;
  assert.ok(used <= 1);
  assert.equal(r.totals.pieces, 7);
});

test('smaller stock is chosen when it saves material at the same sheet count', () => {
  const r = run(job([stock({ id: 'big' }), stock({ id: 'small', length: 1220, width: 1220 })], [panel('A', 600, 500, 2)]), {});
  assert.equal(r.totals.sheets, 1);
  assert.equal(r.stocks[r.sheets[0].stockIdx].id, 'small');
});

test('first-cut preference is honoured', () => {
  const mk = (firstCut) => job([stock({ length: 1000, width: 500 })], [panel('A', 400, 200, 4)], { firstCut });
  assert.equal(run(mk('rip')).sheets[0].steps[0].dir, 'x');
  assert.equal(run(mk('cross')).sheets[0].steps[0].dir, 'y');
});

test('inch jobs with fractional sizes are exact', () => {
  const inch = 25.4;
  const r = run(job(
    [stock({ thickness: 0.75 * inch, length: 96 * inch, width: 48 * inch })],
    [panel('Side', 30.5 * inch, 23.25 * inch, 4, { thickness: 0.75 * inch }), panel('Shelf', 22.125 * inch, 11.0625 * inch, 4, { thickness: 0.75 * inch })],
    { units: 'in', kerf: 0.125 * inch, trim: 0.25 * inch }), {});
  assert.equal(r.totals.sheets, 1);
  for (const pl of r.sheets[0].placements) {
    const p = r.panels[pl.panelIdx];
    assert.equal(pl.dx * pl.dy, p.l * p.w);
  }
});

test('the same job always gives the same plan', () => {
  const a = optimizeSync(exampleJob(), FAST);
  const b = optimizeSync(exampleJob(), FAST);
  delete a.elapsedMs; delete b.elapsedMs;
  assert.deepEqual(a, b);
});

test('totals add up: parts + offcuts + waste + sawdust = stock', () => {
  const r = run(exampleJob(), {});
  let area = 0;
  for (const s of r.sheets) {
    const st = r.stocks[s.stockIdx];
    const left = s.leftovers.reduce((n, o) => n + o.w * o.h, 0);
    const dust = s.steps.reduce((n, c) => {
      // the part of the blade's path that is actually inside the workpiece
      const lo = Math.max(c.c0, c.dir === 'x' ? c.wp.y : c.wp.x);
      const hi = Math.min(c.c1, c.dir === 'x' ? c.wp.y + c.wp.h : c.wp.x + c.wp.w);
      return n + (hi - lo) * c.length;
    }, 0);
    assert.equal(s.partsArea + left + dust, st.L * st.W, `sheet ${s.n}`);
    area += st.L * st.W;
  }
  assert.equal(area, r.totals.stockArea);
  const problem = analyzeJob(exampleJob()).problem;
  assert.equal(r.totals.partsArea, problem.panels.reduce((n, p) => n + p.l * p.w * p.qty, 0));
});
