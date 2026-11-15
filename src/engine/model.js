// Turns the job a person typed in into a clean, validated problem for the
// packer. Everything that could be wrong with the input is reported here as
// an "issue" tied to the row and field it came from.

import { toU, formatLength, unitSuffix } from './units.js';

export const MAX_PIECES = 1500;

export const materialKey = (material, thicknessU) =>
  `${String(material ?? '').trim().replace(/\s+/g, ' ').toLowerCase()}|${thicknessU}`;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isBlank = (v) => v == null || v === '';

/**
 * Which ways may this panel lie on this stock sheet?
 * bit 1 = panel length runs along the sheet's length (x), bit 2 = turned 90°.
 * Returns 0 when the sheet doesn't have enough good faces for the panel.
 */
export function orientationMask(panel, stock) {
  if (panel.faces > stock.faces) return 0;
  let mask;
  if (!stock.grainAxis || panel.grain === 'any') mask = 3;
  else if ((panel.grain === 'length') === (stock.grainAxis === 'x')) mask = 1;
  else mask = 2;
  let fit = 0;
  if (mask & 1 && panel.l <= stock.UL && panel.w <= stock.UW) fit |= 1;
  if (mask & 2 && panel.w <= stock.UL && panel.l <= stock.UW) fit |= 2;
  if (fit === 3 && panel.l === panel.w) fit = 1;
  return fit;
}

export function analyzeJob(job) {
  const issues = [];
  const units = job.units === 'in' ? 'in' : 'mm';
  const f = (mm) => formatLength(mm, units) + unitSuffix(units);
  const err = (scope, id, field, message) => issues.push({ level: 'error', scope, id, field, message });
  const warn = (scope, id, field, message) => issues.push({ level: 'warning', scope, id, field, message });

  // ---- settings -----------------------------------------------------------
  const setting = (field, label, fallback) => {
    const v = job[field];
    if (isBlank(v)) return fallback;
    if (!isNum(v) || v < 0) {
      err('settings', null, field, `${label} must be zero or a positive number.`);
      return fallback;
    }
    return v;
  };
  const kerfMm = setting('kerf', 'Saw kerf', 0);
  const trimMm = setting('trim', 'Edge trim', 0);
  const bandMm = setting('bandThickness', 'Edge banding thickness', 0);
  const minOffcutMm = setting('minOffcut', 'Smallest offcut worth keeping', 0);
  if (kerfMm > 12) warn('settings', null, 'kerf', `A kerf of ${f(kerfMm)} is unusually wide — check the units.`);
  if (isBlank(job.kerf)) warn('settings', null, 'kerf', 'No saw kerf entered — cuts are treated as zero width.');

  const kerf = toU(kerfMm);
  const trim = toU(trimMm);
  const band = toU(bandMm);

  // ---- stock sheets -------------------------------------------------------
  const stocks = [];
  const stockById = new Map();
  const groups = new Map();
  (job.stock ?? []).forEach((s, i) => {
    const rowBlank = isBlank(s.material?.trim?.() ?? s.material) && isBlank(s.thickness) && isBlank(s.length) && isBlank(s.width);
    if (rowBlank) return;
    const label = `Stock row ${i + 1}`;
    let ok = true;
    const need = (field, name) => {
      const v = s[field];
      if (isBlank(v)) { err('stock', s.id, field, `${label}: enter the ${name}.`); ok = false; }
      else if (!isNum(v) || v <= 0) { err('stock', s.id, field, `${label}: ${name} must be a number greater than zero.`); ok = false; }
    };
    if (isBlank(String(s.material ?? '').trim())) { err('stock', s.id, 'material', `${label}: enter a material name.`); ok = false; }
    need('thickness', 'thickness');
    need('length', 'length');
    need('width', 'width');
    let qty = Infinity;
    if (!isBlank(s.qty)) {
      if (!isNum(s.qty) || s.qty < 0 || !Number.isInteger(s.qty)) {
        err('stock', s.id, 'qty', `${label}: sheets available must be a whole number, or blank for "as many as needed".`);
        ok = false;
      } else qty = s.qty;
    }
    if (!isBlank(s.price) && (!isNum(s.price) || s.price < 0)) {
      err('stock', s.id, 'price', `${label}: price must be a positive number or blank.`);
      ok = false;
    }
    if (!ok) return;

    const L = toU(s.length), W = toU(s.width);
    const UL = L - 2 * trim, UW = W - 2 * trim;
    if (UL <= 0 || UW <= 0) {
      err('stock', s.id, 'length', `${label}: nothing is left of this sheet after trimming ${f(trimMm)} off every edge.`);
      return;
    }
    const grainAxis = s.grain === 'none' ? null : s.grain === 'width' ? 'y' : 'x';
    if (grainAxis === 'x' && L < W) {
      warn('stock', s.id, 'grain', `${label}: the grain is set to run along the shorter side (${f(s.length)}). If it runs the long way, swap length and width or change the grain setting.`);
    }
    const thickness = toU(s.thickness);
    const key = materialKey(s.material, thickness);
    const stock = {
      idx: stocks.length, id: s.id, material: String(s.material).trim(), thickness,
      L, W, UL, UW, faces: s.faces === 1 ? 1 : 2, grainAxis,
      ripAxis: grainAxis ?? (L >= W ? 'x' : 'y'),
      qty, price: isNum(s.price) ? s.price : null, groupKey: key,
    };
    stockById.set(s.id, stock);
    if (qty === 0) {
      warn('stock', s.id, 'qty', `${label}: 0 sheets available, so it will not be used.`);
    }
    stocks.push(stock);
    if (!groups.has(key)) {
      groups.set(key, {
        key, material: stock.material, thickness,
        label: `${stock.material} · ${f(s.thickness)}`,
        stocks: [], panels: [],
      });
    }
    groups.get(key).stocks.push(stock.idx);
  });
  if (stocks.length === 0 && !issues.some((x) => x.scope === 'stock' && x.level === 'error')) {
    err('job', null, 'stock', 'Add at least one stock sheet.');
  }

  // ---- panels -------------------------------------------------------------
  const panels = [];
  let pieceCount = 0;
  let anyPanelRow = false;
  (job.panels ?? []).forEach((p, i) => {
    const rowBlank = isBlank(String(p.name ?? '').trim()) && isBlank(p.length) && isBlank(p.width);
    if (rowBlank) return;
    anyPanelRow = true;
    const name = String(p.name ?? '').trim() || `Panel ${i + 1}`;
    const label = `Panel "${name}"`;
    let ok = true;
    const need = (field, what) => {
      const v = p[field];
      if (isBlank(v)) { err('panel', p.id, field, `${label}: enter the ${what}.`); ok = false; }
      else if (!isNum(v) || v <= 0) { err('panel', p.id, field, `${label}: ${what} must be a number greater than zero.`); ok = false; }
    };
    need('length', 'length');
    need('width', 'width');
    let qty = 1;
    if (isBlank(p.qty)) { err('panel', p.id, 'qty', `${label}: enter a quantity.`); ok = false; }
    else if (!isNum(p.qty) || p.qty < 0 || !Number.isInteger(p.qty)) {
      err('panel', p.id, 'qty', `${label}: quantity must be a whole number.`); ok = false;
    } else qty = p.qty;

    // Which material? Either a reference to a stock row, or material + thickness.
    let group = null;
    const ref = p.stockId != null ? stockById.get(p.stockId) : null;
    if (ref) group = groups.get(ref.groupKey);
    else if (!isBlank(p.material) && isNum(p.thickness)) {
      group = groups.get(materialKey(p.material, toU(p.thickness))) ?? null;
      if (!group) {
        const sameName = stocks.filter((s) => materialKey(s.material, 0) === materialKey(p.material, 0));
        if (sameName.length) {
          err('panel', p.id, 'material', `${label}: there is no ${f(p.thickness)} "${p.material}" stock — only ${[...new Set(sameName.map((s) => f(s.thickness / 1000)))].join(', ')}.`);
        } else {
          err('panel', p.id, 'material', `${label}: there is no stock sheet of "${p.material}" ${f(p.thickness)}.`);
        }
        ok = false;
      }
    } else if (p.stockId != null && (job.stock ?? []).some((s) => s.id === p.stockId)) {
      err('panel', p.id, 'material', `${label}: its stock sheet has a problem — fix that row first.`);
      ok = false;
    } else {
      err('panel', p.id, 'material', `${label}: choose which material it is cut from.`);
      ok = false;
    }
    if (!ok) return;
    if (qty === 0) {
      warn('panel', p.id, 'qty', `${label}: quantity is 0, so it is left out.`);
      return;
    }

    const bandL = Math.min(2, Math.max(0, p.bandL | 0));
    const bandW = Math.min(2, Math.max(0, p.bandW | 0));
    const fl = toU(p.length), fw = toU(p.width);
    // Banding on the two long edges makes the panel wider; on the ends, longer.
    const l = fl - bandW * band, w = fw - bandL * band;
    if (l <= 0 || w <= 0) {
      err('panel', p.id, 'length', `${label}: nothing is left after deducting the edge banding thickness.`);
      return;
    }
    const panel = {
      idx: panels.length, id: p.id, code: i + 1, name, l, w, fl, fw, qty,
      grain: p.grain === 'width' ? 'width' : p.grain === 'any' ? 'any' : 'length',
      faces: p.faces === 2 ? 2 : p.faces === 0 ? 0 : 1,
      bandL, bandW, groupKey: group.key,
    };

    // Can it be cut from any sheet of its material at all?
    const gStocks = group.stocks.map((si) => stocks[si]).filter((s) => s.qty > 0);
    if (gStocks.length === 0) {
      err('panel', p.id, 'material', `${label}: no sheets of ${group.label} are available.`);
      return;
    }
    const faceOk = gStocks.filter((s) => s.faces >= panel.faces);
    if (faceOk.length === 0) {
      err('panel', p.id, 'faces', `${label}: both faces will be seen, but ${group.label} only comes with one good face. Add a sheet with two good faces or change the panel.`);
      return;
    }
    if (!faceOk.some((s) => orientationMask(panel, s) !== 0)) {
      const s = faceOk[0];
      const usable = `${f(s.UL / 1000)} × ${f(s.UW / 1000)}`;
      const size = `${f(l / 1000)} × ${f(w / 1000)}`;
      const wouldFitTurned = faceOk.some((st) => orientationMask({ ...panel, grain: 'any' }, st) !== 0);
      err('panel', p.id, 'length', wouldFitTurned
        ? `${label}: ${size} only fits the sheet if turned against the grain. Change its grain setting or use a bigger sheet.`
        : `${label}: ${size} is larger than the usable sheet area (${usable}${trim ? ' after edge trim' : ''}).`);
      return;
    }
    pieceCount += qty;
    panels.push(panel);
    group.panels.push(panel.idx);
  });
  if (!anyPanelRow) err('job', null, 'panels', 'Add at least one panel.');
  if (pieceCount > MAX_PIECES) {
    err('job', null, 'panels', `This job has ${pieceCount} pieces; the limit is ${MAX_PIECES}. Split it into smaller jobs.`);
  }

  const problem = {
    units, kerf, trim, band,
    minOffcut: toU(minOffcutMm),
    firstCut: job.firstCut === 'rip' || job.firstCut === 'cross' ? job.firstCut : 'auto',
    stocks, panels,
    groups: [...groups.values()].filter((g) => g.panels.length > 0),
    pieceCount,
  };
  return { issues, problem, blocking: issues.some((x) => x.level === 'error') };
}
