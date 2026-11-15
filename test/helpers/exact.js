// Exact (exhaustive) guillotine solver for tiny instances, used only by the
// tests to check that the heuristic packer finds the true minimum number of
// sheets. It is written independently of the packer.
//
// pieces: [{ l, w, mask }]  mask bit 1 = may lie with l along x, bit 2 = turned
// A set of pieces fits a w×h rectangle if it is one piece that fits, or if
// the set can be divided in two by a straight cut (losing `k` to the blade)
// so that both halves fit their side.

export function makeExact(pieces, k) {
  const n = pieces.length;
  const memo = new Map();
  const candCache = new Map();

  // Every width a left-justified block made of pieces in `mask` could have.
  function cands(mask, axis) {
    const key = axis + mask;
    let out = candCache.get(key);
    if (out) return out;
    let cur = new Set([0]); // encoded sum * 16 + count
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue;
      const p = pieces[i];
      const ext = new Set();
      if (p.mask & 1) ext.add(axis === 'x' ? p.l : p.w);
      if (p.mask & 2) ext.add(axis === 'x' ? p.w : p.l);
      const next = new Set(cur);
      for (const e of cur) for (const d of ext) next.add((Math.floor(e / 16) + d) * 16 + (e % 16) + 1);
      cur = next;
    }
    const vals = new Set();
    for (const e of cur) {
      const count = e % 16;
      if (count > 0) vals.add(Math.floor(e / 16) + k * (count - 1));
    }
    out = [...vals].sort((a, b) => a - b);
    candCache.set(key, out);
    return out;
  }

  function fits(mask, w, h) {
    if (w <= 0 || h <= 0) return false;
    const key = `${mask}|${w}|${h}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let ok = false;
    if ((mask & (mask - 1)) === 0) {
      const p = pieces[31 - Math.clz32(mask)];
      ok = ((p.mask & 1) !== 0 && p.l <= w && p.w <= h) || ((p.mask & 2) !== 0 && p.w <= w && p.l <= h);
    } else {
      let area = 0;
      for (let i = 0; i < n; i++) if (mask & (1 << i)) area += pieces[i].l * pieces[i].w;
      if (area <= w * h) {
        const low = mask & -mask;
        search:
        for (let sub = (mask - 1) & mask; sub > 0; sub = (sub - 1) & mask) {
          if (!(sub & low)) continue;
          const rest = mask ^ sub;
          for (const x of cands(sub, 'x')) {
            if (x + k >= w) break;
            if (fits(sub, x, h)) { if (fits(rest, w - x - k, h)) { ok = true; break search; } break; }
          }
          for (const y of cands(sub, 'y')) {
            if (y + k >= h) break;
            if (fits(sub, w, y)) { if (fits(rest, w, h - y - k)) { ok = true; break search; } break; }
          }
        }
      }
    }
    memo.set(key, ok);
    return ok;
  }

  /** Fewest w×h sheets that hold every piece (Infinity if a piece fits none). */
  function minSheets(w, h) {
    const best = new Map();
    const go = (mask) => {
      if (mask === 0) return 0;
      const hit = best.get(mask);
      if (hit !== undefined) return hit;
      let res = Infinity;
      if (fits(mask, w, h)) res = 1;
      else {
        const low = mask & -mask;
        for (let sub = mask; sub > 0; sub = (sub - 1) & mask) {
          if (!(sub & low) || sub === mask) continue;
          if (!fits(sub, w, h)) continue;
          const r = 1 + go(mask ^ sub);
          if (r < res) res = r;
          if (res === 2) break;
        }
      }
      best.set(mask, res);
      return res;
    };
    return go((1 << n) - 1);
  }

  return { fits, minSheets };
}
