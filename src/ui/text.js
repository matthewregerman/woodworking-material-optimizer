// Wording for cuts and parts. Kept free of DOM code so it can be tested.

import { formatU, unitSuffix } from '../engine/units.js';

export const GRAIN_LABEL = { length: 'along length', width: 'along width', any: 'either way' };
export const FACES_LABEL = { 0: 'hidden', 1: 'one face seen', 2: 'both faces seen' };

/** "720 × 560" for a rectangle measured along the sheet (length-direction first). */
export const dims = (w, h, units) => `${formatU(w, units)} × ${formatU(h, units)}`;

/** A panel's own cut size, always length × width whichever way it lies on the sheet. */
export const panelDims = (p, units) => `${formatU(p.l, units)} × ${formatU(p.w, units)}`;

export function stockTitle(stock, units) {
  const u = unitSuffix(units);
  return `${stock.material} · ${formatU(stock.thickness, units)}${u} · ${formatU(stock.L, units)} × ${formatU(stock.W, units)}${u}`;
}

export function partText(part, result, units) {
  if (!part) return null;
  if (part.kind === 'panel') {
    const p = result.panels[part.panelIdx];
    return { kind: 'panel', text: `${p.name}`, detail: panelDims(p, units), done: true };
  }
  const size = dims(part.w, part.h, units);
  if (part.kind === 'work') return { kind: 'work', text: `${size} piece`, detail: `goes on to cut ${part.next}` };
  if (part.kind === 'offcut') return { kind: 'offcut', text: `${size} offcut`, detail: 'keep' };
  return { kind: 'waste', text: `${size} waste`, detail: '' };
}

/**
 * Everything needed to say one cut out loud.
 * Rip = along the grain (or along the sheet's long side if it has no grain).
 */
export function describeStep(step, sheet, result, units) {
  const stock = result.stocks[sheet.stockIdx];
  const u = unitSuffix(units);
  const rip = step.dir === stock.ripAxis;
  const verb = rip ? 'Rip' : 'Crosscut';
  const source = step.from === 0 ? `the full sheet (${dims(step.wp.w, step.wp.h, units)})` : `the ${dims(step.wp.w, step.wp.h, units)} piece from cut ${step.from}`;
  const a = partText(step.a, result, units);
  const b = partText(step.b, result, units);
  const kerf = formatU(result.kerf, units) + u;

  if (step.kind === 'trim') {
    const off = formatU(result.trim, units) + u;
    const long = (step.dir === 'x') === (stock.L >= stock.W);
    // the two reference edges come off first (the waste is the near part); a
    // far edge is only trimmed up front when several parts end on it
    const far = Boolean(step.a) && step.a.kind !== 'waste';
    if (far) {
      const kept = formatU(step.dir === 'x' ? step.a.h : step.a.w, units) + u;
      return {
        verb, rip, isTrim: true,
        title: `Trim ${off} off the opposite ${long ? 'long' : 'short'} edge`,
        measure: null,
        take: `Take ${source}.`,
        how: `${verb} at ${kept} from the reference edge, removing ${off} in total (blade included). Several parts end on this edge, so it is trimmed once for all of them.`,
        a, b,
      };
    }
    return {
      verb, rip, isTrim: true,
      title: `Trim ${off} off one ${long ? 'long' : 'short'} edge`,
      measure: null,
      take: `Take ${source}.`,
      how: `${verb} a clean edge, removing ${off} in total (blade included). This becomes a reference edge: later cuts are measured from it.`,
      a, b,
    };
  }

  const size = step.dir === 'x' ? step.a.h : step.a.w;
  const across = formatU(step.dir === 'x' ? step.wp.h : step.wp.w, units);
  const along = formatU(step.length, units);
  const measure = formatU(size, units);
  let how = `Measure ${measure}${u} along its ${across}${u} side and cut straight across — a ${along}${u} long cut. `
    + `The ${measure}${u} part is ${a.kind === 'panel' ? 'a finished panel' : 'exact'}; the ${kerf} kerf comes out of the other part.`;
  if (!step.b) how = `Measure ${measure}${u} along its ${across}${u} side and cut straight across. This is a skim cut: the blade only takes the last sliver off the edge.`;
  return {
    verb, rip, isTrim: false,
    title: `${verb} at ${measure}${u}`,
    measure,
    take: `Take ${source}.`,
    how, a, b,
  };
}
