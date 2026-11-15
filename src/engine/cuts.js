// Turns a packing tree into the physical job at the saw: where every piece
// sits on the real sheet, and the ordered list of edge-to-edge cuts that
// produces it.
//
// Coordinates: x runs along the sheet's length, y along its width, origin at
// one corner, all in micrometres. Every cut removes a strip `kerf` wide.
//
// A cut is described by:
//   dir   'x' = the cut line runs along x (it sets a width)
//         'y' = the cut line runs along y (it sets a length)
//   wp    the workpiece being cut (a rectangle that exists at that moment)
//   c0,c1 the strip of material the blade turns to dust (c1 - c0 = kerf)
//   a     the part on the near side of the blade (its size is the measurement
//         to set on the fence / mark from the reference edge), or null
//   b     the part on the far side, or null if the blade runs off the edge

// farTrim { x, y }: also trim that far edge up front, in one pass, instead of
// where each part reaches it (used when favouring fewer cuts).

export function buildCutPlan({ L, W, trim, kerf, root, minOffcut, panelOfItem, farTrim }) {
  const steps = [];
  const placements = [];
  const leftovers = [];

  const cut = (dir, wp, c0, kind, from) => {
    const c1 = c0 + kerf;
    let a = null, b = null;
    if (dir === 'x') {
      const end = wp.y + wp.h;
      if (c0 > wp.y) a = { x: wp.x, y: wp.y, w: wp.w, h: c0 - wp.y };
      if (c1 < end) b = { x: wp.x, y: c1, w: wp.w, h: end - c1 };
    } else {
      const end = wp.x + wp.w;
      if (c0 > wp.x) a = { x: wp.x, y: wp.y, w: c0 - wp.x, h: wp.h };
      if (c1 < end) b = { x: c1, y: wp.y, w: end - c1, h: wp.h };
    }
    const step = {
      n: steps.length + 1, kind, dir, from,
      wp: { x: wp.x, y: wp.y, w: wp.w, h: wp.h },
      c0, c1,
      length: dir === 'x' ? wp.w : wp.h,
      a, b,
    };
    steps.push(step);
    return step;
  };

  const leaf = (part, isTrim) => {
    if (!part) return;
    // strips that lie wholly in the far trim margin are trim waste too
    if (trim > 0 && (part.x >= L - trim || part.y >= W - trim)) isTrim = true;
    part.kind = !isTrim && Math.min(part.w, part.h) >= Math.max(minOffcut, 1) ? 'offcut' : 'waste';
    leftovers.push({ x: part.x, y: part.y, w: part.w, h: part.h, kind: part.kind, trim: !!isTrim });
  };

  // `part` is the record (inside the step that produced it) for workpiece wp.
  const process = (node, wp, from, part) => {
    const dx = node.dx, dy = node.dy;
    let cur = wp, curFrom = from, curPart = part;
    const pending = [];
    for (const dir of node.splitH ? ['x', 'y'] : ['y', 'x']) {
      const needed = dir === 'x' ? cur.h > dy : cur.w > dx;
      if (!needed) continue;
      const step = cut(dir, cur, dir === 'x' ? cur.y + dy : cur.x + dx, 'cut', curFrom);
      if (curPart) { curPart.kind = 'work'; curPart.next = step.n; }
      pending.push({ part: step.b, child: dir === 'x' ? node.top : node.right, n: step.n });
      cur = step.a; curFrom = step.n; curPart = step.a;
    }
    const placement = {
      item: node.item, panelIdx: panelOfItem(node.item),
      x: cur.x, y: cur.y, dx, dy, rotated: node.rot,
    };
    placements.push(placement);
    if (curPart) { curPart.kind = 'panel'; curPart.panelIdx = placement.panelIdx; curPart.placement = placements.length - 1; }

    // finish the strip this piece came from before going back to the rest
    for (let i = pending.length - 1; i >= 0; i--) {
      const { part: far, child, n } = pending[i];
      if (!far) continue;
      if (child && child.item >= 0) process(child, far, n, far);
      else leaf(far, false);
    }
  };

  let wp = { x: 0, y: 0, w: L, h: W };
  let from = 0, part = null;
  if (trim > 0) {
    // Clean up the two reference edges first; everything is measured from them.
    for (const dir of ['x', 'y']) {
      const step = cut(dir, wp, trim - kerf, 'trim', from);
      if (part) { part.kind = 'work'; part.next = step.n; }
      leaf(step.a, true);
      wp = step.b; from = step.n; part = step.b;
    }
    for (const dir of ['y', 'x']) {
      if (!(dir === 'y' ? farTrim?.x : farTrim?.y)) continue;
      const step = cut(dir, wp, (dir === 'y' ? L : W) - trim, 'trim', from);
      part.kind = 'work'; part.next = step.n;
      leaf(step.b, true);
      wp = step.a; from = step.n; part = step.a;
    }
  }
  if (root.item >= 0) process(root, wp, from, part);
  else if (part) leaf(part, false);

  return { steps, placements, leftovers };
}
