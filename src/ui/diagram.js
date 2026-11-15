// To-scale drawing of one sheet: pieces, offcuts, waste, kerf-wide cut lines.

import { s } from './dom.js';
import { formatU, unitSuffix } from '../engine/units.js';
import { dims, panelDims } from './text.js';

// light fills with a darker edge, picked to stay readable with dark text
const PALETTE = [
  ['#f9d9a8', '#b9792a'], ['#bfe0c8', '#3f8a5a'], ['#c6dcf5', '#3f6fa8'], ['#f5c9c4', '#b0554c'],
  ['#e0d2f2', '#7658a8'], ['#f4e6a1', '#9a8420'], ['#bfe6e6', '#2f8585'], ['#f7cfe2', '#a8507a'],
  ['#d9e6b0', '#6c8a2a'], ['#e6d5c3', '#8a6a48'], ['#cfd6f7', '#5560b0'], ['#fbd3b5', '#b8672c'],
];
export const panelColor = (code) => PALETTE[(code - 1) % PALETTE.length];

const ra = (r) => ({ x: r.x.toFixed(2), y: r.y.toFixed(2), width: Math.max(0, r.w).toFixed(2), height: Math.max(0, r.h).toFixed(2) });
const CHAR = 0.58; // rough glyph width as a fraction of font size

function fitText(lines, availW, availH, maxFs) {
  const longest = Math.max(...lines.map((l) => l.length));
  return Math.min(maxFs, availH / (lines.length * 1.22), availW / (longest * CHAR));
}

/** Draw centred text in a box, turned on its side if that fits better. Returns false if nothing fits. */
function boxLabel(parent, box, variants, cls) {
  for (const { lines, min } of variants) {
    const flat = fitText(lines, box.w - 6, box.h - 4, 13);
    const tall = fitText(lines, box.h - 6, box.w - 4, 13);
    const turned = tall > flat * 1.15;
    const fs = turned ? tall : flat;
    if (fs < min) continue;
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const g = s('g', { class: cls, transform: turned ? `rotate(-90 ${cx} ${cy})` : null, 'pointer-events': 'none' });
    const lh = fs * 1.22;
    lines.forEach((line, i) => {
      g.append(s('text', {
        x: cx, y: cy + (i - (lines.length - 1) / 2) * lh,
        'font-size': fs.toFixed(2), 'text-anchor': 'middle', 'dominant-baseline': 'central',
        class: i === 0 ? 'l1' : 'l2',
      }, line));
    });
    parent.append(g);
    return true;
  }
  return false;
}

/**
 * opts: { widthPx, vertical, selected, done, showNumbers, zoom, onPickStep }
 * `vertical` draws the sheet's length top-to-bottom (for narrow screens).
 */
export function sheetDiagram(sheet, result, units, opts) {
  const stock = result.stocks[sheet.stockIdx];
  const { widthPx, vertical, selected = 0, done = [], showNumbers = true } = opts;
  const ML = 26, MT = 24, MR = 6, MB = 6;
  const acrossU = vertical ? stock.W : stock.L;
  const downU = vertical ? stock.L : stock.W;
  const k = (widthPx - ML - MR) / acrossU; // px per micrometre
  const heightPx = downU * k + MT + MB;
  const px = (r) => (vertical
    ? { x: ML + r.y * k, y: MT + r.x * k, w: r.h * k, h: r.w * k }
    : { x: ML + r.x * k, y: MT + r.y * k, w: r.w * k, h: r.h * k });
  const u = unitSuffix(units);
  const pid = `hatch-${sheet.n}`;

  const svg = s('svg', {
    class: 'sheet-svg', viewBox: `0 0 ${widthPx} ${heightPx.toFixed(1)}`, width: '100%',
    role: 'img', 'aria-label': `Cutting layout for sheet ${sheet.n}`,
  });
  svg.append(s('defs', null,
    s('pattern', { id: pid, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
      s('rect', { width: 6, height: 6, class: 'hatch-bg' }),
      s('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'hatch-line' }))));

  const whole = px({ x: 0, y: 0, w: stock.L, h: stock.W });
  svg.append(s('rect', { ...ra(whole), class: 'sheet-bg', fill: `url(#${pid})` }));

  // leftovers
  for (const o of sheet.leftovers) {
    const r = px(o);
    if (o.kind === 'offcut') {
      svg.append(s('rect', { ...ra(r), class: 'offcut' }, s('title', null, `Offcut ${dims(o.w, o.h, units)}${u}`)));
      boxLabel(svg, r, [{ lines: [dims(o.w, o.h, units)], min: 8 }], 'offcut-label');
    }
  }

  // pieces
  sheet.placements.forEach((pl, i) => {
    const p = result.panels[pl.panelIdx];
    const r = px({ x: pl.x, y: pl.y, w: pl.dx, h: pl.dy });
    const [fill, stroke] = panelColor(p.code);
    const size = panelDims(p, units);
    const rect = s('rect', { ...ra(r), class: 'piece', fill, stroke, dataset: { placement: i } },
      s('title', null, `${p.name} — ${size}${u}${pl.rotated ? ' (turned 90°)' : ''}`));
    svg.append(rect);
    boxLabel(svg, r, [
      { lines: [p.name, size], min: 8 },
      { lines: [`#${p.code}`, size], min: 7.5 },
      { lines: [p.name], min: 8 },
      { lines: [`#${p.code}`], min: 6.5 },
    ], 'piece-label');
  });

  // cut lines, drawn kerf-wide
  const lineOf = (st) => {
    const mid = (st.c0 + st.c1) / 2;
    const r = st.dir === 'x'
      ? px({ x: st.wp.x, y: mid, w: st.wp.w, h: 0 })
      : px({ x: mid, y: st.wp.y, w: 0, h: st.wp.h });
    return { x1: r.x, y1: r.y, x2: r.x + r.w, y2: r.y + r.h };
  };
  const kerfPx = Math.max(1, result.kerf * k);
  const cuts = s('g', { class: 'cuts' });
  for (const st of sheet.steps) {
    const l = lineOf(st);
    const cls = `cut${done[st.n - 1] ? ' done' : ''}${st.n === selected ? ' sel' : ''}`;
    cuts.append(s('line', { ...l, class: cls, 'stroke-width': kerfPx.toFixed(2) }));
  }
  svg.append(cuts);

  // selected cut: dim everything except its workpiece, outline it, bold line
  const sel = sheet.steps[selected - 1];
  if (sel) {
    const w = px(sel.wp);
    const W = widthPx, H = heightPx;
    const d = `M0 0H${W}V${H}H0Z M${w.x} ${w.y}V${w.y + w.h}H${w.x + w.w}V${w.y}Z`;
    svg.append(s('path', { d, class: 'dim-mask', 'fill-rule': 'evenodd' }));
    svg.append(s('rect', { ...ra(w), class: 'wp-outline' }));
    const l = lineOf(sel);
    svg.append(s('line', { ...l, class: 'cut-hot', 'stroke-width': Math.max(3, kerfPx).toFixed(2) }));
    // dimension arrow: the distance to set, from the near edge to the blade
    if (sel.a && sel.kind !== 'trim') {
      const label = formatU(sel.dir === 'x' ? sel.a.h : sel.a.w, units);
      const bw = label.length * 7.2 + 12;
      const flatCut = Math.abs(l.y1 - l.y2) < 0.01; // the cut line is horizontal on screen
      // run the arrow just inside the workpiece edge, clear of the part names
      const seg = flatCut
        ? { x1: w.x + bw / 2 + 5, y1: w.y, x2: w.x + bw / 2 + 5, y2: l.y1 }
        : { x1: w.x, y1: w.y + 16, x2: l.x1, y2: w.y + 16 };
      const tick = (x, y) => (flatCut ? `M${x - 5} ${y}H${x + 5}` : `M${x} ${y - 5}V${y + 5}`);
      const mx = (seg.x1 + seg.x2) / 2, my = (seg.y1 + seg.y2) / 2;
      svg.append(s('g', { class: 'measure', 'pointer-events': 'none' },
        s('path', { d: `M${seg.x1} ${seg.y1}L${seg.x2} ${seg.y2} ${tick(seg.x1, seg.y1)} ${tick(seg.x2, seg.y2)}` }),
        s('rect', { x: mx - bw / 2, y: my - 10, width: bw, height: 20, rx: 4 }),
        s('text', { x: mx, y: my, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, label)));
    }
  }

  // numbered badges, also the click targets for picking a cut
  const badges = s('g', { class: 'badges' });
  for (const st of sheet.steps) {
    const l = lineOf(st);
    const hit = s('line', { ...l, class: 'cut-hit', dataset: { step: st.n } });
    badges.append(hit);
    if (!showNumbers && st.n !== selected) continue;
    // off-centre, so the number does not sit on top of the part names in narrow strips
    const cx = l.x1 + (l.x2 - l.x1) * 0.78, cy = l.y1 + (l.y2 - l.y1) * 0.78;
    const cls = `badge${done[st.n - 1] ? ' done' : ''}${st.n === selected ? ' sel' : ''}`;
    badges.append(s('g', { class: cls, dataset: { step: st.n } },
      s('circle', { cx, cy, r: st.n > 99 ? 10 : 8 }),
      s('text', { x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, String(st.n))));
  }
  svg.append(badges);

  // outline and overall dimensions
  svg.append(s('rect', { ...ra(whole), class: 'sheet-edge' }));
  const grainAlong = stock.grainAxis ? (stock.grainAxis === 'x') !== vertical : null; // true: grain runs across the screen
  const acrossText = `${formatU(acrossU, units)}${u}${grainAlong === true ? '  ·  grain ⟷' : ''}`;
  const downText = `${formatU(downU, units)}${u}${grainAlong === false ? '  ·  grain ⟷' : ''}`;
  // anchored at the corner so they stay clear of the trim-cut badges on the edge midpoints
  svg.append(s('text', { x: ML + 1, y: MT - 9, class: 'dim-text', 'text-anchor': 'start' }, acrossText));
  const dy = MT + whole.h - 1;
  svg.append(s('text', { x: ML - 9, y: dy, class: 'dim-text', 'text-anchor': 'start', transform: `rotate(-90 ${ML - 9} ${dy})` }, downText));

  // On small screens, close in on the piece being cut (with some of its
  // surroundings for context) so it is readable at arm's length.
  if (opts.zoom && sel) {
    const w = px(sel.wp);
    const vw = Math.min(widthPx, Math.max(w.w + 28, whole.w * 0.55));
    const vh = Math.min(heightPx, Math.max(w.h + 28, whole.h * 0.3));
    const vx = Math.max(0, Math.min(widthPx - vw, w.x + w.w / 2 - vw / 2));
    const vy = Math.max(0, Math.min(heightPx - vh, w.y + w.h / 2 - vh / 2));
    svg.setAttribute('viewBox', `${vx.toFixed(1)} ${vy.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}`);
  }

  svg.addEventListener('click', (e) => {
    const stepEl = e.target.closest('[data-step]');
    if (stepEl) { opts.onPickStep?.(Number(stepEl.dataset.step)); return; }
    const pieceEl = e.target.closest('[data-placement]');
    if (pieceEl) {
      // jump to the cut that frees this piece
      const i = Number(pieceEl.dataset.placement);
      const st = sheet.steps.find((x) => (x.a?.placement === i) || (x.b?.placement === i));
      if (st) opts.onPickStep?.(st.n);
    }
  });
  return svg;
}
