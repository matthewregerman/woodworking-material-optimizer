// Independent check of a finished cutting plan. It shares no logic with the
// packer: it looks only at the problem and the result and re-derives, from
// scratch, whether the plan is physically correct.
//
//  - every panel appears exactly as many times as asked for
//  - each piece has the right size, on a sheet of its material and thickness,
//    with enough good faces, turned the right way for the grain
//  - pieces stay inside the trimmed sheet and never come closer than a kerf
//  - replaying the cut list (each cut straight across one existing workpiece,
//    removing a kerf-wide strip) leaves exactly the pieces in the layout
//  - no more sheets are used than are available

const same = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const R = (r) => `${r.w / 1000}×${r.h / 1000}@${r.x / 1000},${r.y / 1000}`;

export function verifyResult(problem, result) {
  const errors = [];
  const k = problem.kerf, t = problem.trim;
  const placed = new Array(problem.panels.length).fill(0);
  const stockUse = new Array(problem.stocks.length).fill(0);

  result.sheets.forEach((sheet, si) => {
    const tag = `sheet ${si + 1}`;
    const stock = problem.stocks[sheet.stockIdx];
    if (!stock) { errors.push(`${tag}: unknown stock`); return; }
    stockUse[stock.idx]++;

    for (const pl of sheet.placements) {
      const p = problem.panels[pl.panelIdx];
      if (!p) { errors.push(`${tag}: placement of unknown panel`); continue; }
      const name = `${tag}: "${p.name}"`;
      placed[p.idx]++;
      if (p.groupKey !== stock.groupKey) errors.push(`${name} is on the wrong material or thickness`);
      if (p.faces > stock.faces) errors.push(`${name} needs ${p.faces} good faces but the sheet has ${stock.faces}`);
      const sizeOk = pl.rotated ? pl.dx === p.w && pl.dy === p.l : pl.dx === p.l && pl.dy === p.w;
      if (!sizeOk) errors.push(`${name} has the wrong size (${pl.dx / 1000} × ${pl.dy / 1000})`);
      if (stock.grainAxis && p.grain !== 'any') {
        const lengthRunsAlong = pl.rotated ? 'y' : 'x';
        const across = stock.grainAxis === 'x' ? 'y' : 'x';
        const want = p.grain === 'length' ? stock.grainAxis : across;
        if (lengthRunsAlong !== want) errors.push(`${name} is turned against the grain`);
      }
      if (pl.x < t || pl.y < t || pl.x + pl.dx > stock.L - t || pl.y + pl.dy > stock.W - t) {
        errors.push(`${name} is outside the usable area of the sheet`);
      }
    }

    const pls = sheet.placements;
    for (let i = 0; i < pls.length; i++) {
      for (let j = i + 1; j < pls.length; j++) {
        const a = pls[i], b = pls[j];
        const apartX = a.x + a.dx + k <= b.x || b.x + b.dx + k <= a.x;
        const apartY = a.y + a.dy + k <= b.y || b.y + b.dy + k <= a.y;
        if (!apartX && !apartY) {
          errors.push(`${tag}: pieces "${problem.panels[a.panelIdx]?.name}" and "${problem.panels[b.panelIdx]?.name}" overlap or are closer than the kerf`);
        }
      }
    }

    // Replay the cuts on a model of the real sheet.
    const live = [{ x: 0, y: 0, w: stock.L, h: stock.W }];
    sheet.steps.forEach((step, i) => {
      const st = `${tag} cut ${i + 1}`;
      if (step.n !== i + 1) errors.push(`${st}: step numbers are out of order`);
      const at = live.findIndex((r) => same(r, step.wp));
      if (at < 0) { errors.push(`${st}: workpiece ${R(step.wp)} does not exist at this point`); return; }
      const wp = live[at];
      live.splice(at, 1);
      if (step.c1 - step.c0 !== k) errors.push(`${st}: blade width is not the kerf`);
      const alongX = step.dir === 'x';
      const start = alongX ? wp.y : wp.x;
      const end = start + (alongX ? wp.h : wp.w);
      const touches = k > 0 ? step.c1 > start && step.c0 < end : step.c0 > start && step.c0 < end;
      if (!touches) { errors.push(`${st}: the blade misses the workpiece`); live.push(wp); return; }
      const near = step.c0 > start
        ? (alongX ? { x: wp.x, y: start, w: wp.w, h: step.c0 - start } : { x: start, y: wp.y, w: step.c0 - start, h: wp.h })
        : null;
      const far = step.c1 < end
        ? (alongX ? { x: wp.x, y: step.c1, w: wp.w, h: end - step.c1 } : { x: step.c1, y: wp.y, w: end - step.c1, h: wp.h })
        : null;
      if (!near && !far) errors.push(`${st}: the cut leaves nothing`);
      for (const [mine, theirs, side] of [[near, step.a, 'near'], [far, step.b, 'far']]) {
        if (!mine !== !theirs || (mine && !same(mine, theirs))) {
          errors.push(`${st}: ${side} part is recorded as ${theirs ? R(theirs) : 'nothing'} but the cut gives ${mine ? R(mine) : 'nothing'}`);
        }
        if (mine) live.push(mine);
      }
      if (step.length !== (alongX ? wp.w : wp.h)) errors.push(`${st}: cut length is wrong`);
    });

    const unclaimed = live.slice();
    for (const pl of pls) {
      const rect = { x: pl.x, y: pl.y, w: pl.dx, h: pl.dy };
      const at = unclaimed.findIndex((r) => same(r, rect));
      if (at < 0) errors.push(`${tag}: following the cuts does not produce "${problem.panels[pl.panelIdx]?.name}" at ${R(rect)}`);
      else unclaimed.splice(at, 1);
    }
    const left = (sheet.leftovers ?? []).slice();
    for (const r of unclaimed) {
      const at = left.findIndex((o) => same(o, r));
      if (at < 0) errors.push(`${tag}: leftover ${R(r)} is not listed`);
      else left.splice(at, 1);
    }
    if (left.length) errors.push(`${tag}: ${left.length} listed leftover(s) do not exist after the cuts`);
  });

  const unplaced = new Array(problem.panels.length).fill(0);
  for (const u of result.unplaced ?? []) unplaced[u.panelIdx] += u.count;
  for (const p of problem.panels) {
    if (placed[p.idx] + unplaced[p.idx] !== p.qty) {
      errors.push(`"${p.name}": asked for ${p.qty}, plan has ${placed[p.idx]} placed and ${unplaced[p.idx]} reported unplaced`);
    }
  }
  for (const s of problem.stocks) {
    if (stockUse[s.idx] > s.qty) errors.push(`${stockUse[s.idx]} sheets of stock ${s.idx + 1} used but only ${s.qty} available`);
  }
  return { ok: errors.length === 0, errors };
}
