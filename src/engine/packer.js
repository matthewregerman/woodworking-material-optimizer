// Guillotine packer.
//
// A layout is built by taking pieces in some order and dropping each into a
// free rectangle, which is then split in two by a straight edge-to-edge cut.
// Because free rectangles are never merged, the result is a tree of cuts that
// can always be made on a table saw or with a track saw.
//
// The search tries many piece orders and placement rules (a deterministic
// sweep followed by simulated annealing) and keeps the best layout:
//   1. fewest pieces left unplaced (only happens when stock runs out)
//   2. fewest sheets
//   3. least stock area (matters when sheets come in several sizes)
//   4. leftover gathered into the biggest possible offcuts, fewer cuts

import { orientationMask } from './model.js';

const CHOICES = 4;
const SPLITS = 8;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build the packing problem for one material group. */
export function buildGroupProblem(problem, group) {
  const stocks = group.stocks
    .map((si) => problem.stocks[si])
    .filter((s) => s.qty > 0)
    .map((s) => ({ L: s.UL, W: s.UW, qty: s.qty, area: s.L * s.W, ripAxis: s.ripAxis, ref: s }));
  const types = [];
  const itemType = [];
  for (const pi of group.panels) {
    const p = problem.panels[pi];
    const mask = stocks.map((s) => orientationMask(p, s.ref));
    const t = types.length;
    types.push({ l: p.l, w: p.w, area: p.l * p.w, count: p.qty, panelIdx: p.idx, mask });
    for (let i = 0; i < p.qty; i++) itemType.push(t);
  }
  let refArea = 0;
  for (const s of stocks) refArea = Math.max(refArea, s.L * s.W);
  return { k: problem.kerf, firstCut: problem.firstCut, stocks, types, itemType, refArea };
}

function score(choice, F, dx, dy) {
  const rw = F.w - dx, rh = F.h - dy;
  switch (choice) {
    case 0: return F.w * F.h - dx * dy;
    case 1: return rw < rh ? rw * 1e8 + rh : rh * 1e8 + rw;
    case 2: return rw < rh ? rh * 1e8 + rw : rw * 1e8 + rh;
    default: return F.x * 1e8 + F.y;
  }
}

// true = first cut runs along x (parallel to the sheet length)
function splitHoriz(rule, Fw, Fh, dx, dy) {
  const rw = Fw - dx, rh = Fh - dy;
  switch (rule) {
    case 0: return rw <= rh;
    case 1: return rw > rh;
    case 2: return dx * rh > rw * dy;
    case 3: return dx * rh <= rw * dy;
    case 4: return Fw <= Fh;
    case 5: return Fw > Fh;
    case 6: return true;
    default: return false;
  }
}

const newNode = (x, y, w, h) => ({ x, y, w, h, item: -1, dx: 0, dy: 0, rot: false, splitH: false, right: null, top: null, root: false });

function setChildren(F, k) {
  const rw = F.w - F.dx - k, rh = F.h - F.dy - k;
  if (F.splitH) {
    F.right = rw > 0 ? newNode(F.x + F.dx + k, F.y, rw, F.dy) : null;
    F.top = rh > 0 ? newNode(F.x, F.y + F.dy + k, F.w, rh) : null;
  } else {
    F.right = rw > 0 ? newNode(F.x + F.dx + k, F.y, rw, F.h) : null;
    F.top = rh > 0 ? newNode(F.x, F.y + F.dy + k, F.dx, rh) : null;
  }
}

/** Sum of squared leftover areas for the two ways of splitting around a piece. */
function leftoverOptions(n, k) {
  const rw = Math.max(0, n.w - n.dx - k), rh = Math.max(0, n.h - n.dy - k);
  const hA = rw * n.dy, hB = n.w * rh;
  const vA = rw * n.h, vB = n.dx * rh;
  return { h: hA * hA + hB * hB, v: vA * vA + vB * vB };
}

/** Consolidation score of a sheet: sum of squared free-rectangle areas. */
function sheetQ(root, k, forcedRoot) {
  let q = 0;
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (n.item < 0) { const a = n.w * n.h; q += a * a; continue; }
    const r = n.right, t = n.top;
    const rFree = !r || r.item < 0, tFree = !t || t.item < 0;
    if (rFree && tFree && !(n.root && forcedRoot)) {
      const o = leftoverOptions(n, k);
      q += Math.max(o.h, o.v);
      continue;
    }
    if (r) stack.push(r);
    if (t) stack.push(t);
  }
  return q;
}

/** Where both leftovers of a piece are unused, split so the bigger offcut is as big as possible. */
function applyFlips(root, k, forcedRoot) {
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (n.item < 0) continue;
    const r = n.right, t = n.top;
    const rFree = !r || r.item < 0, tFree = !t || t.item < 0;
    if (rFree && tFree) {
      if (!(n.root && forcedRoot)) {
        const o = leftoverOptions(n, k);
        const wantH = o.h >= o.v;
        if (wantH !== n.splitH) { n.splitH = wantH; setChildren(n, k); }
      }
      continue;
    }
    if (r) stack.push(r);
    if (t) stack.push(t);
  }
}

function decode(P, order, prm) {
  const { k, types, itemType, stocks, firstCut } = P;
  const { choice, split, sheetFirst, stockOrder } = prm;
  const forcedRoot = firstCut !== 'auto';
  const sheets = [];
  const used = new Array(stocks.length).fill(0);
  const unplacedItems = [];
  let cuts = 0;

  for (let oi = 0; oi < order.length; oi++) {
    const it = order[oi];
    const T = types[itemType[it]];
    const l = T.l, w = T.w;
    let bF = null, bScore = Infinity, bRot = false, bSheet = null, bIdx = -1;

    for (let s = 0; s < sheets.length; s++) {
      const sh = sheets[s];
      const mask = T.mask[sh.stock];
      if (mask === 0) continue;
      const free = sh.free;
      for (let i = 0; i < free.length; i++) {
        const F = free[i];
        if ((mask & 1) && l <= F.w && w <= F.h) {
          const sc = score(choice, F, l, w);
          if (sc < bScore) { bScore = sc; bF = F; bRot = false; bSheet = sh; bIdx = i; }
        }
        if ((mask & 2) && w <= F.w && l <= F.h) {
          const sc = score(choice, F, w, l);
          if (sc < bScore) { bScore = sc; bF = F; bRot = true; bSheet = sh; bIdx = i; }
        }
      }
      if (sheetFirst && bF) break;
    }

    if (!bF) {
      let opened = -1;
      for (let j = 0; j < stockOrder.length; j++) {
        const si = stockOrder[j];
        if (used[si] < stocks[si].qty && T.mask[si] !== 0) { opened = si; break; }
      }
      if (opened < 0) { unplacedItems.push(it); continue; }
      used[opened]++;
      const st = stocks[opened];
      const root = newNode(0, 0, st.L, st.W);
      root.root = true;
      bSheet = { stock: opened, root, free: [root], area: 0 };
      sheets.push(bSheet);
      bF = root; bIdx = 0;
      const mask = T.mask[opened];
      bRot = mask === 3 ? score(choice, root, w, l) < score(choice, root, l, w) : mask === 2;
    }

    const F = bF;
    const dx = bRot ? w : l, dy = bRot ? l : w;
    F.item = it; F.rot = bRot; F.dx = dx; F.dy = dy;
    if (F.root && forcedRoot) F.splitH = (firstCut === 'rip') === (stocks[bSheet.stock].ripAxis === 'x');
    else F.splitH = splitHoriz(split, F.w, F.h, dx, dy);
    setChildren(F, k);
    const free = bSheet.free;
    free[bIdx] = free[free.length - 1];
    free.pop();
    if (F.right) free.push(F.right);
    if (F.top) free.push(F.top);
    if (F.w > dx) cuts++;
    if (F.h > dy) cuts++;
    bSheet.area += dx * dy;
  }

  const ref2 = P.refArea * P.refArea;
  // Q rewards leftover gathered into big rectangles and sheets filled
  // unevenly (full sheets plus one emptier sheet beat several half-used ones).
  let Q = 0, stockArea = 0;
  for (const sh of sheets) {
    stockArea += stocks[sh.stock].area;
    Q += sheetQ(sh.root, k, forcedRoot) / ref2 + (sh.area * sh.area) / ref2;
  }
  let f;
  if (P.knapsack) {
    // single-sheet mode: get as much (weighted) area as possible onto the sheet
    let left = 0;
    for (const it of unplacedItems) left += types[itemType[it]].value;
    f = 1e3 * left - Q + 0.002 * cuts;
  } else {
    f = 1e6 * unplacedItems.length + 1e4 * sheets.length + 100 * (stockArea / P.refArea) - Q + 0.002 * cuts;
  }
  return { f, sheets, unplacedItems, order, prm, cuts, Q };
}

function baseOrders(P) {
  const { types } = P;
  const idx = types.map((_, i) => i);
  const mx = (t) => Math.max(t.l, t.w), mn = (t) => Math.min(t.l, t.w);
  const cmps = [
    (a, b) => b.area - a.area || mx(b) - mx(a),
    (a, b) => mx(b) - mx(a) || mn(b) - mn(a),
    (a, b) => mn(b) - mn(a) || mx(b) - mx(a),
    (a, b) => b.w - a.w || b.l - a.l,
    (a, b) => b.l - a.l || b.w - a.w,
    (a, b) => (b.l + b.w) - (a.l + a.w) || b.area - a.area,
    (a, b) => b.area * b.count - a.area * a.count || b.area - a.area,
  ];
  const firstItem = [];
  let c = 0;
  for (const t of types) { firstItem.push(c); c += t.count; }
  const seen = new Set();
  const out = [];
  for (const cmp of cmps) {
    const tOrder = idx.slice().sort((a, b) => cmp(types[a], types[b]) || a - b);
    const key = tOrder.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const order = [];
    for (const t of tOrder) for (let i = 0; i < types[t].count; i++) order.push(firstItem[t] + i);
    out.push(order);
  }
  return out;
}

function stockOrders(P) {
  const n = P.stocks.length;
  const base = P.stocks.map((_, i) => i);
  if (n === 1) return [base];
  const byArea = base.slice().sort((a, b) => P.stocks[b].area - P.stocks[a].area || a - b);
  if (n > 3) {
    // too many permutations to sweep: biggest first, smallest first, and rotations
    const out = [byArea, byArea.slice().reverse()];
    for (let i = 1; i < n && out.length < 6; i++) out.push(byArea.slice(i).concat(byArea.slice(0, i)));
    return out;
  }
  const out = [];
  const permute = (arr, m = []) => {
    if (!arr.length) { out.push(m); return; }
    for (let i = 0; i < arr.length; i++) permute(arr.slice(0, i).concat(arr.slice(i + 1)), m.concat(arr[i]));
  };
  permute(byArea);
  return out;
}

function mutateOrder(order, rng, itemType) {
  const n = order.length;
  const o = order.slice();
  const r = rng();
  let i = (rng() * n) | 0, j = (rng() * n) | 0;
  for (let tries = 0; tries < 6 && itemType[o[i]] === itemType[o[j]]; tries++) j = (rng() * n) | 0;
  if (r < 0.4) {
    const t = o[i]; o[i] = o[j]; o[j] = t;
  } else if (r < 0.7) {
    const [v] = o.splice(i, 1);
    o.splice(j, 0, v);
  } else if (r < 0.9) {
    // move the whole run of identical pieces around position i
    const t = itemType[o[i]];
    let a = i, b = i;
    while (a > 0 && itemType[o[a - 1]] === t) a--;
    while (b < n - 1 && itemType[o[b + 1]] === t) b++;
    const run = o.splice(a, b - a + 1);
    const at = Math.min(o.length, (rng() * (o.length + 1)) | 0);
    o.splice(at, 0, ...run);
  } else {
    if (i > j) { const t = i; i = j; j = t; }
    while (i < j) { const t = o[i]; o[i] = o[j]; o[j] = t; i++; j--; }
  }
  return o;
}

function mutatePrm(prm, rng, P) {
  const p = { ...prm };
  const r = rng();
  if (r < 0.35) p.choice = (rng() * CHOICES) | 0;
  else if (r < 0.8) p.split = (rng() * SPLITS) | 0;
  else if (r < 0.9 || P.stocks.length < 2) p.sheetFirst = !p.sheetFirst;
  else {
    const so = p.stockOrder.slice();
    const i = (rng() * so.length) | 0, j = (rng() * so.length) | 0;
    const t = so[i]; so[i] = so[j]; so[j] = t;
    p.stockOrder = so;
  }
  return p;
}

/**
 * Search for a good layout. A generator so callers can keep a UI alive:
 * it yields a progress fraction now and then and returns the best decode.
 */
export function* search(P, opts = {}) {
  const iterations = opts.iterations ?? 3000;
  const rng = mulberry32(opts.seed ?? 20240611);
  const deadline = opts.deadline ?? Infinity;
  let best = null;
  const cands = [];
  let n = 0;

  const orders = baseOrders(P);
  const sOrders = stockOrders(P);
  const sweepTotal = orders.length * sOrders.length * CHOICES * SPLITS * 2;
  const total = sweepTotal + iterations;
  sweep:
  for (const order of orders) {
    for (const stockOrder of sOrders) {
      for (let choice = 0; choice < CHOICES; choice++) {
        for (let split = 0; split < SPLITS; split++) {
          for (let sf = 0; sf < 2; sf++) {
            const sol = decode(P, order, { choice, split, sheetFirst: sf === 1, stockOrder });
            if (!best || sol.f < best.f) best = sol;
            cands.push(sol);
            if (++n % 48 === 0) {
              yield n / total;
              if (Date.now() > deadline) break sweep;
            }
          }
        }
      }
    }
  }

  if (P.types.length > 1 && iterations > 0 && Date.now() <= deadline) {
    cands.sort((a, b) => a.f - b.f);
    const starts = [cands[0]];
    for (const c of cands) {
      if (starts.length >= 3) break;
      if (c.f - starts[starts.length - 1].f > 1e-9) starts.push(c);
    }
    const per = Math.ceil(iterations / starts.length);
    const T0 = 0.05, T1 = 0.0005;
    outer:
    for (const st of starts) {
      let cur = st;
      for (let i = 0; i < per; i++) {
        const T = T0 * Math.pow(T1 / T0, i / per);
        let order = cur.order, prm = cur.prm;
        if (rng() < 0.12) prm = mutatePrm(prm, rng, P);
        else order = mutateOrder(order, rng, P.itemType);
        const sol = decode(P, order, prm);
        if (sol.f < best.f) best = sol;
        const d = sol.f - cur.f;
        if (d <= 0 || rng() < Math.exp(-d / T)) cur = sol;
        if (++n % 48 === 0) {
          yield Math.min(1, n / total);
          if (Date.now() > deadline) break outer;
        }
      }
    }
  }
  return best;
}

function runSync(gen) {
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value;
}

function sheetItems(root) {
  const items = [];
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (n.item < 0) continue;
    items.push(n.item);
    if (n.right) stack.push(n.right);
    if (n.top) stack.push(n.top);
  }
  return items;
}

/** A sub-problem over some of the items and some of the sheets. */
function subProblem(P, items, stockCounts, extra = {}) {
  const sIdx = [...stockCounts.keys()];
  const typeMap = new Map();
  const types = [];
  const itemType = [];
  for (const it of items) {
    const t = P.itemType[it];
    if (!typeMap.has(t)) {
      typeMap.set(t, types.length);
      const T = P.types[t];
      types.push({ l: T.l, w: T.w, area: T.area, count: 0, panelIdx: T.panelIdx, mask: sIdx.map((si) => T.mask[si]) });
    }
    const lt = typeMap.get(t);
    types[lt].count++;
    itemType.push(lt);
  }
  // items must be grouped by type for baseOrders(); sort and remember the mapping
  const perm = items.map((_, i) => i).sort((a, b) => itemType[a] - itemType[b] || a - b);
  const sub = {
    k: P.k, firstCut: P.firstCut,
    stocks: sIdx.map((si) => ({ ...P.stocks[si], qty: stockCounts.get(si) })),
    types, itemType: perm.map((i) => itemType[i]),
    refArea: P.refArea,
    ...extra,
  };
  const back = (subItem) => items[perm[subItem]];
  const liftSheets = (sol) => sol.sheets.map((sh) => {
    const stack = [sh.root];
    while (stack.length) {
      const n = stack.pop();
      if (n.item < 0) continue;
      n.item = back(n.item);
      if (n.right) stack.push(n.right);
      if (n.top) stack.push(n.top);
    }
    return { stock: sIdx[sh.stock], root: sh.root, area: sh.area };
  });
  return { sub, back, liftSheets };
}

/**
 * Lay out exactly these items on the given sheets (Map: stock index -> how
 * many of that stock may be used). Returns null if they do not all fit.
 */
function repack(P, items, stockCounts, iterations, seed) {
  const { sub, liftSheets } = subProblem(P, items, stockCounts);
  const sol = runSync(search(sub, { iterations, seed }));
  if (sol.unplacedItems.length) return null;
  return { sheets: liftSheets(sol) };
}

/**
 * Alternative construction: fill one sheet at a time as full as possible
 * from whatever is still left, then move on. `power` > 1 makes big pieces
 * worth more than their area so they are not all left for the last sheets.
 */
function* fillGreedy(P, opts) {
  const { stocks } = P;
  const iterations = opts.iterations ?? 1200;
  const power = opts.power ?? 1;
  const deadline = opts.deadline ?? Infinity;
  let remaining = P.itemType.map((_, i) => i);
  const used = new Array(stocks.length).fill(0);
  const sheets = [];
  while (remaining.length) {
    let pick = null;
    for (let si = 0; si < stocks.length; si++) {
      if (used[si] >= stocks[si].qty) continue;
      const { sub, back, liftSheets } = subProblem(P, remaining, new Map([[si, 1]]), { knapsack: true });
      for (const T of sub.types) T.value = Math.pow(T.area / P.refArea, power) * (opts.weights ? opts.weights[T.panelIdx] ?? 1 : 1);
      const quick = Date.now() > deadline;
      const sol = runSync(search(sub, { iterations: quick ? 0 : iterations, seed: (opts.seed ?? 1) + sheets.length * 31 + si }));
      if (!sol.sheets.length) continue;
      const fill = sol.sheets[0].area / stocks[si].area;
      if (!pick || fill > pick.fill + 1e-12) pick = { fill, si, sheet: liftSheets(sol)[0], left: sol.unplacedItems.map(back) };
    }
    if (!pick) break;
    used[pick.si]++;
    sheets.push(pick.sheet);
    remaining = pick.left;
    yield 1 - remaining.length / P.itemType.length;
  }
  return { sheets, unplacedItems: remaining };
}

/**
 * Second phase of the search. The first phase is good at filling sheets but
 * can leave a few pieces stranded on an extra sheet. Here the emptiest sheets
 * are pooled with each other sheet in turn and the pair is re-packed from
 * scratch, keeping the result when it frees a whole sheet or shifts material
 * from the emptier sheet to the fuller one. Small two-sheet problems are
 * solved far more thoroughly than the whole job can be.
 */
function* improvePairs(P, sheets, opts) {
  const { k } = P;
  const forcedRoot = P.firstCut !== 'auto';
  const ref2 = P.refArea * P.refArea;
  const iterations = opts.pairIterations ?? 700;
  const maxTries = opts.maxPairTries ?? 8 * sheets.length + 8;
  const deadline = opts.deadline ?? Infinity;
  const scoreOf = (sh) => sheetQ(sh.root, k, forcedRoot) / ref2 + (sh.area * sh.area) / ref2;
  let nextId = 1;
  for (const sh of sheets) sh.id = nextId++;
  const tried = new Set();
  let tries = 0, improved = true;
  while (improved && sheets.length > 1) {
    improved = false;
    const byFill = sheets.slice().sort((a, b) => a.area - b.area);
    scan:
    for (const weak of byFill.slice(0, 2)) {
      const others = sheets.filter((s) => s !== weak)
        .sort((a, b) => (P.stocks[b.stock].L * P.stocks[b.stock].W - b.area) - (P.stocks[a.stock].L * P.stocks[a.stock].W - a.area));
      for (const other of others) {
        const key = weak.id < other.id ? `${weak.id}|${other.id}` : `${other.id}|${weak.id}`;
        if (tried.has(key)) continue;
        if (tries >= maxTries || Date.now() > deadline) return;
        tried.add(key);
        tries++;
        const counts = new Map([[weak.stock, 1]]);
        counts.set(other.stock, (counts.get(other.stock) ?? 0) + 1);
        const items = sheetItems(weak.root).concat(sheetItems(other.root));
        const re = repack(P, items, counts, iterations, 5000 + tries);
        yield tries / maxTries;
        if (!re) continue;
        let fresh = 0;
        for (const sh of re.sheets) fresh += scoreOf(sh);
        if (re.sheets.length < 2 || fresh > scoreOf(weak) + scoreOf(other) + 1e-9) {
          sheets.splice(sheets.indexOf(weak), 1);
          sheets.splice(sheets.indexOf(other), 1);
          for (const sh of re.sheets) { sh.id = nextId++; sheets.push(sh); }
          improved = true;
          break scan;
        }
      }
    }
  }
}

/**
 * Third phase: empty the least-used sheet piece by piece. Each of its pieces
 * (largest first) is offered to every other sheet by re-packing that sheet
 * with the extra piece; failing that, it is swapped for a smaller piece.
 * Every accepted move makes the weakest sheet emptier, so this either frees
 * the sheet entirely or leaves it with the biggest possible offcut.
 */
function* drainWeakest(P, sheets, opts) {
  const iterations = opts.drainIterations ?? 300;
  const maxTries = opts.maxDrainTries ?? 60;
  const deadline = opts.deadline ?? Infinity;
  const areaOf = (it) => P.types[P.itemType[it]].area;
  const usable = (sh) => P.stocks[sh.stock].L * P.stocks[sh.stock].W;
  const allowed = (it, sh) => P.types[P.itemType[it]].mask[sh.stock] !== 0;
  const one = (items, stock, seed) => {
    const re = repack(P, items, new Map([[stock, 1]]), iterations, seed);
    return re && re.sheets.length === 1 ? re.sheets[0] : null;
  };
  let tries = 0;
  const failed = new Set(); // "piece type | sheet contents" combinations already known not to work
  const sig = (items) => items.map((it) => P.itemType[it]).sort((x, y) => x - y).join(',');
  const out = () => tries >= maxTries || Date.now() > deadline;

  progress:
  while (sheets.length > 1 && !out()) {
    let weak = sheets[0];
    for (const sh of sheets) if (sh.area < weak.area) weak = sh;
    const wItems = sheetItems(weak.root).sort((x, y) => areaOf(y) - areaOf(x));
    const others = sheets.filter((sh) => sh !== weak).sort((x, y) => (usable(y) - y.area) - (usable(x) - x.area));

    const commit = (target, newTarget, x, y) => {
      // weak sheet loses x (and gains y when swapping)
      const rest = wItems.filter((it) => it !== x);
      if (y != null) rest.push(y);
      let newWeak = null;
      if (rest.length) {
        newWeak = one(rest, weak.stock, 900 + tries);
        if (!newWeak) return false;
      }
      target.root = newTarget.root; target.area = newTarget.area;
      if (newWeak) { weak.root = newWeak.root; weak.area = newWeak.area; }
      else sheets.splice(sheets.indexOf(weak), 1);
      return true;
    };

    for (const x of wItems) {
      for (const target of others) {
        if (!allowed(x, target) || usable(target) - target.area < areaOf(x)) continue;
        const tItems = sheetItems(target.root);
        const key = `${P.itemType[x]}+${sig(tItems)}`;
        if (failed.has(key)) continue;
        if (out()) return;
        tries++;
        const re = one(tItems.concat(x), target.stock, 700 + tries);
        yield tries / maxTries;
        if (re && commit(target, re, x, null)) continue progress;
        failed.add(key);
      }
    }
    for (const x of wItems) {
      for (const target of others) {
        if (!allowed(x, target)) continue;
        const tItems = sheetItems(target.root);
        const need = areaOf(x) - (usable(target) - target.area);
        const seenTypes = new Set();
        const swaps = tItems
          .filter((y) => areaOf(y) < areaOf(x) && areaOf(y) >= need && allowed(y, weak))
          .sort((p, q) => areaOf(p) - areaOf(q))
          .filter((y) => !seenTypes.has(P.itemType[y]) && seenTypes.add(P.itemType[y]))
          .slice(0, 3);
        for (const y of swaps) {
          const key = `${P.itemType[x]}-${P.itemType[y]}+${sig(tItems)}`;
          if (failed.has(key)) continue;
          if (out()) return;
          tries++;
          const re = one(tItems.filter((it) => it !== y).concat(x), target.stock, 800 + tries);
          yield tries / maxTries;
          if (re && commit(target, re, x, y)) continue progress;
          failed.add(key);
        }
      }
    }
    break;
  }
}

/**
 * Full solve for one material group: broad search, pair improvement, then
 * polish (smaller stock where possible, biggest offcuts, final split
 * directions). A generator yielding progress 0..1; returns
 * { sheets: [{ stock, root, area }], unplacedItems }.
 */
export function* solveGroup(P, opts = {}) {
  const { k, stocks } = P;
  const forcedRoot = P.firstCut !== 'auto';
  const polish = opts.polishIterations ?? 400;
  const ref2 = P.refArea * P.refArea;
  const start = Date.now();
  const limit = opts.timeLimitMs ?? Infinity;

  const scoreOf = (sh) => sheetQ(sh.root, k, forcedRoot) / ref2 + (sh.area * sh.area) / ref2;
  const rank = (sol) => {
    let area = 0, sc = 0;
    for (const sh of sol.sheets) { area += stocks[sh.stock].area; sc += scoreOf(sh); }
    return [sol.unplacedItems.length, sol.sheets.length, area, -sc];
  };
  const better = (a, b) => {
    const ra = rank(a), rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] < rb[i];
    return false;
  };

  // A: whole-job search over piece orders
  const gen = search(P, { iterations: opts.iterations, seed: opts.seed, deadline: start + limit * 0.4 });
  let r = gen.next();
  while (!r.done) { yield r.value * 0.4; r = gen.next(); }
  let best = {
    sheets: r.value.sheets.map((sh) => ({ stock: sh.stock, root: sh.root, area: sh.area })),
    unplacedItems: r.value.unplacedItems.slice(),
  };

  // B: sheet-by-sheet fill. After each attempt, the pieces that ended up
  // stranded on the last sheet are given more weight so the next attempt
  // deals with them first ("squeaky wheel").
  if (P.itemType.length > 1 && opts.greedy !== false) {
    let partsArea = 0;
    for (const t of P.itemType) partsArea += P.types[t].area;
    const floor = Math.ceil(partsArea / P.refArea); // can't do better than this
    const powers = opts.greedyPowers ?? [1, 1.25, 1.6];
    const rounds = opts.greedyRounds ?? 6;
    const weights = {};
    for (let v = 0; v < rounds; v++) {
      if (v >= powers.length && (best.sheets.length <= floor || best.unplacedItems.length || Date.now() > start + limit * 0.7)) break;
      const fg = fillGreedy(P, {
        iterations: opts.greedyIterations, power: powers[v % powers.length], seed: 300 + v * 17,
        weights: v >= powers.length ? weights : null, deadline: start + limit * 0.7,
      });
      let fr = fg.next();
      while (!fr.done) { yield 0.4 + 0.2 * ((v + fr.value) / rounds); fr = fg.next(); }
      const sol = fr.value;
      if (better(sol, best)) best = sol;
      if (sol.sheets.length > floor) {
        let last = sol.sheets[0];
        for (const sh of sol.sheets) if (sh.area < last.area) last = sh;
        for (const it of sheetItems(last.root)) {
          const pi = P.types[P.itemType[it]].panelIdx;
          weights[pi] = (weights[pi] ?? 1) * 1.6;
        }
      }
    }
  }
  const sheets = best.sheets;

  if (opts.pairs !== false && sheets.length > 1) {
    const phases = [
      [drainWeakest, start + limit * 0.85, 0.6, 0.15],
      [improvePairs, start + limit * 0.95, 0.75, 0.1],
      [drainWeakest, start + limit, 0.85, 0.1],
    ];
    for (const [phase, deadline, from, span] of phases) {
      if (sheets.length < 2) break;
      const pg = phase(P, sheets, { ...opts, deadline });
      let pr = pg.next();
      while (!pr.done) { yield from + span * Math.min(1, pr.value); pr = pg.next(); }
    }
  }

  const used = new Array(stocks.length).fill(0);
  for (const sh of sheets) used[sh.stock]++;

  // downsize to smaller stock where everything still fits: emptiest sheets first
  if (stocks.length > 1) {
    const byFill = sheets.slice().sort((a, b) => a.area - b.area);
    for (const sh of byFill) {
      const items = sheetItems(sh.root);
      const smaller = stocks
        .map((s, i) => i)
        .filter((i) => i !== sh.stock && stocks[i].area < stocks[sh.stock].area && used[i] < stocks[i].qty
          && stocks[i].L * stocks[i].W >= sh.area
          && items.every((it) => P.types[P.itemType[it]].mask[i] !== 0))
        .sort((a, b) => stocks[a].area - stocks[b].area);
      for (const si of smaller) {
        const re = repack(P, items, new Map([[si, 1]]), polish, 7 + si);
        if (re) {
          used[sh.stock]--; used[si]++;
          sh.stock = si; sh.root = re.sheets[0].root;
          break;
        }
      }
    }
  }
  yield 0.97;

  // re-pack each sheet on its own to gather its leftover into bigger offcuts
  if (polish > 0) {
    sheets.forEach((sh, i) => {
      const items = sheetItems(sh.root);
      if (items.length < 2) return;
      const oldQ = sheetQ(sh.root, k, forcedRoot) / ref2;
      const re = repack(P, items, new Map([[sh.stock, 1]]), polish, 101 + i);
      if (re && sheetQ(re.sheets[0].root, k, forcedRoot) / ref2 > oldQ + 1e-9) sh.root = re.sheets[0].root;
    });
  }

  for (const sh of sheets) { sh.root.root = true; applyFlips(sh.root, k, forcedRoot); }
  return { sheets, unplacedItems: best.unplacedItems.slice() };
}

/** Convenience for tests and non-UI callers. */
export function solveGroupSync(P, opts = {}) {
  return runSync(solveGroup(P, opts));
}
