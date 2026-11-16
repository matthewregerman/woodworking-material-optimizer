// The "Cutting plan" tab.

import { h, $, clear } from './dom.js';
import { formatU, formatArea, formatRun, unitSuffix } from '../engine/units.js';
import { sheetDiagram, panelColor } from './diagram.js';
import { describeStep, dims, panelDims, stockTitle, GRAIN_LABEL, FACES_LABEL } from './text.js';

const pct = (x) => `${(x * 100).toFixed(x >= 0.995 || x < 0.1 ? 1 : 0)}%`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const money = (v) => v.toLocaleString(undefined, { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });

export function createResultsView(root, ctx) {
  // ctx: { getState(), stale(), recalc(), goToJob(), save() }
  const ui = { selected: {}, numbers: true, zoom: true, print: false };
  // Drawings for paper are laid out at this width and scaled by the page. It is
  // narrower than a page, so the scaling makes labels bigger, never smaller.
  const PRINT_WIDTH = 640;
  const sheetViews = [];
  let lastWidth = 0;

  const units = () => ctx.getState().job.units;

  function part(p) {
    if (!p) return h('li', { class: 'part none' }, 'nothing — the blade runs off the edge');
    return h('li', { class: `part ${p.kind}` },
      h('span', { class: 'part-name' }, p.text),
      p.detail ? h('span', { class: 'part-detail' }, p.kind === 'panel' ? `${p.detail} — finished` : p.detail) : null);
  }

  // ---- summary ------------------------------------------------------------
  function summary(result) {
    const u = units();
    const t = result.totals;
    const yieldPct = t.stockArea ? t.partsArea / t.stockArea : 0;
    const offcuts = result.sheets.flatMap((s) => s.leftovers.filter((o) => o.kind === 'offcut'));
    const biggest = offcuts.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0];
    const allAtFloor = result.groups.every((g) => g.sheets === g.lowerBound && !g.unplaced);

    const fewerCuts = result.favor === 'cuts' && result.compare;
    const saved = fewerCuts ? result.compare.cuts - t.cuts : 0;
    const cutsNote = fewerCuts && saved > 0 ? `${saved} fewer than with large offcuts · ${formatRun(t.cutLength, u)} of sawing` : `${formatRun(t.cutLength, u)} of sawing`;
    const offcutText = (area, big) => `${formatArea(area, u)}${big && big.w ? `, largest ${dims(big.w, big.h, u)}${unitSuffix(u)}` : ''}`;

    const stat = (value, label, note) => h('div', { class: 'stat' },
      h('div', { class: 'stat-value' }, value), h('div', { class: 'stat-label' }, label), note ? h('div', { class: 'stat-note' }, note) : null);

    const groupRows = result.groups.map((g) => {
      const verdict = g.unplaced ? h('span', { class: 'bad' }, `${g.unplaced} not placed — out of stock`)
        : g.sheets === g.lowerBound ? h('span', { class: 'good' }, '✓ fewest possible')
          : h('span', { class: 'meh' }, `area alone needs ${g.lowerBound}; no layout found with fewer than ${g.sheets}`);
      return h('tr', null,
        h('td', null, g.label), h('td', { class: 'num' }, String(g.sheets)), h('td', { class: 'num' }, String(g.pieces - g.unplaced)),
        h('td', { class: 'num' }, pct(g.stockArea ? g.placedArea / g.stockArea : 0)), h('td', null, verdict));
    });

    const buy = result.stocks.filter((s) => s.used > 0).map((s) => h('tr', null,
      h('td', null, stockTitle(s, u)),
      h('td', null, s.faces === 2 ? 'both faces good' : 'one good face'),
      h('td', { class: 'num' }, `${s.used}${s.qty != null ? ` of ${s.qty}` : ''}`),
      h('td', { class: 'num' }, s.price != null ? money(s.price * s.used) : '—')));

    return h('section', { class: 'card', id: 'res-summary' },
      h('h2', null, 'Summary'),
      h('div', { class: 'stats' },
        stat(String(t.sheets), t.sheets === 1 ? 'sheet' : 'sheets', allAtFloor ? 'the fewest possible' : null),
        stat(pct(yieldPct), 'of the stock becomes parts', `${formatArea(t.partsArea, u)} of ${formatArea(t.stockArea, u)}`),
        stat(formatArea(t.offcutArea, u), 'reusable offcuts', biggest ? `largest ${dims(biggest.w, biggest.h, u)}${unitSuffix(u)}` : 'none worth keeping'),
        stat(String(t.cuts), 'cuts', cutsNote),
        t.cost != null ? stat(money(t.cost), 'sheet cost', 'for sheets with a price') : null),
      h('h3', null, 'How well it did'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, 'Material'), h('th', { class: 'num' }, 'Sheets'), h('th', { class: 'num' }, 'Parts'), h('th', { class: 'num' }, 'Used'), h('th', null, 'Sheet count'))),
        h('tbody', null, groupRows))),
      h('h3', null, 'Cuts'),
      fewerCuts && saved > 0 ? h('div', { class: 'favor-note' }, h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
            h('thead', null, h('tr', null, h('th', null, 'Favouring'), h('th', { class: 'num' }, 'Cuts'), h('th', { class: 'num' }, 'Sawing'), h('th', null, 'Reusable offcuts'))),
            h('tbody', null,
              h('tr', null, h('td', { class: 'strong' }, 'Fewer cuts (this plan)'), h('td', { class: 'num strong' }, String(t.cuts)), h('td', { class: 'num' }, formatRun(t.cutLength, u)), h('td', null, offcutText(t.offcutArea, biggest))),
              h('tr', null, h('td', null, 'Large offcuts'), h('td', { class: 'num' }, String(result.compare.cuts)), h('td', { class: 'num' }, formatRun(result.compare.cutLength, u)), h('td', null, offcutText(result.compare.offcutArea, result.compare.largestOffcut))))))) : null,
      fewerCuts && saved <= 0 ? h('p', { class: 'favor-note' }, 'No layout with fewer cuts was found; this is the same plan as with large offcuts.') : null,
      h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, 'Sheet'), h('th', null, 'Material'), h('th', { class: 'num' }, 'Parts'), h('th', { class: 'num' }, 'Cuts'), h('th', { class: 'num' }, 'Used'))),
        h('tbody', null,
          result.sheets.map((s) => {
            const st = result.stocks[s.stockIdx];
            return h('tr', null, h('td', { class: 'nowrap' }, h('a', { href: `#sheet-${s.n}` }, `Sheet ${s.n}`)), h('td', null, st.material),
              h('td', { class: 'num' }, String(s.placements.length)), h('td', { class: 'num' }, String(s.steps.length)), h('td', { class: 'num' }, pct(s.partsArea / (st.L * st.W))));
          }),
          h('tr', { class: 'total-row' }, h('td', { colspan: 2 }, 'Total'), h('td', { class: 'num' }, String(t.pieces)), h('td', { class: 'num' }, String(t.cuts)), h('td', { class: 'num' }, pct(yieldPct)))))),
      h('h3', null, 'Sheets to pull or buy'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, 'Sheet'), h('th', null, 'Faces'), h('th', { class: 'num' }, 'Needed'), h('th', { class: 'num' }, 'Cost'))),
        h('tbody', null, buy))),
      t.bandingLength > 0 ? h('p', { class: 'fine' }, h('strong', null, 'Edge banding: '), `${formatRun(t.bandingLength, u)} needed — allow about ${formatRun(t.bandingLength * 1.1 + 2 * 1e6 * 0.15, u)} with trimming waste.`) : null);
  }

  // ---- one sheet ----------------------------------------------------------
  function sheetCard(sheet, result) {
    const state = ctx.getState();
    const u = units();
    const stock = result.stocks[sheet.stockIdx];
    const total = sheet.steps.length;
    const done = () => (state.progress[sheet.n] ??= []);
    const sel = () => ui.selected[sheet.n] ?? 0;

    const figure = h('div', { class: 'figure' });
    const zoomBtn = h('button', { class: 'link zoom-btn', type: 'button', hidden: true, onclick: () => { ui.zoom = !ui.zoom; sheetViews.forEach((v) => v.drawFigure()); } });
    const stepper = h('div', { class: 'stepper' });
    const list = h('ol', { class: 'steps' });
    const progress = h('span', { class: 'progress' });
    const used = sheet.partsArea / (stock.L * stock.W);
    const offcuts = sheet.leftovers.filter((o) => o.kind === 'offcut').sort((a, b) => b.w * b.h - a.w * a.h);

    const pick = (n) => { ui.selected[sheet.n] = n === sel() ? 0 : n; update(); };
    const go = (n) => { ui.selected[sheet.n] = Math.max(1, Math.min(total, n)); update(); };
    const setDone = (n, v) => { done()[n - 1] = v; ctx.save(); update(); };

    function drawFigure() {
      const longAlongX = stock.L >= stock.W;
      if (ui.print) {
        // on paper: the whole sheet, long side across, every cut numbered, nothing highlighted
        clear(figure).append(sheetDiagram(sheet, result, u, {
          widthPx: PRINT_WIDTH, vertical: !longAlongX, selected: 0, done: done(), showNumbers: true, zoom: false,
        }));
        return;
      }
      const width = Math.max(240, Math.floor(figure.clientWidth || root.clientWidth - 40));
      const narrow = width < 520;
      const zoom = narrow && ui.zoom && sel() > 0;
      clear(figure).append(sheetDiagram(sheet, result, u, {
        widthPx: width, vertical: narrow ? longAlongX : !longAlongX,
        selected: sel(), done: done(), showNumbers: ui.numbers, zoom, onPickStep: pick,
      }));
      zoomBtn.hidden = !(narrow && sel() > 0);
      zoomBtn.textContent = ui.zoom ? 'Show the whole sheet' : 'Zoom in on this cut';
    }

    function drawStepper() {
      clear(stepper);
      const n = sel();
      const nDone = done().filter(Boolean).length;
      progress.textContent = total ? `${nDone} of ${total} cuts done` : '';
      if (!total) { stepper.append(h('p', { class: 'fine' }, 'No cuts needed: the panel is the whole sheet.')); return; }
      const st = sheet.steps[n - 1];
      const nav = h('div', { class: 'stepper-nav' },
        h('button', { class: 'btn', type: 'button', disabled: n <= 1, onclick: () => go(n - 1), 'aria-label': 'Previous cut' }, '◀'),
        h('div', { class: 'stepper-pos' }, st ? `Cut ${n} of ${total}` : `${total} cuts`),
        h('button', { class: 'btn', type: 'button', disabled: n >= total, onclick: () => go(n + 1), 'aria-label': 'Next cut' }, n ? '▶' : 'Start ▶'));
      stepper.append(nav);
      if (!st) {
        stepper.append(h('p', { class: 'fine' }, 'Step through the cuts in order, or tap a numbered cut or a part on the drawing.'));
        return;
      }
      const d = describeStep(st, sheet, result, u);
      stepper.append(
        h('div', { class: 'step-title' }, h('span', { class: `tag ${d.isTrim ? 'trim' : d.rip ? 'rip' : 'cross'}` }, d.isTrim ? 'Trim' : d.verb), d.title),
        h('p', { class: 'step-how' }, d.take, ' ', d.how),
        h('ul', { class: 'parts' }, part(d.a), part(d.b)),
        h('label', { class: 'done-toggle' },
          h('input', { type: 'checkbox', checked: Boolean(done()[n - 1]), onchange: (e) => { setDone(n, e.target.checked); if (e.target.checked && n < total) go(n + 1); } }),
          ' Done — next cut'));
    }

    function drawList() {
      clear(list);
      for (const st of sheet.steps) {
        const d = describeStep(st, sheet, result, u);
        const gives = [[d.a, st.a], [d.b, st.b]].filter(([p]) => p)
          .map(([p, raw]) => (p.kind === 'panel' ? `${p.text} (${p.detail})` : p.kind === 'work' ? `${p.text} → cut ${raw.next}` : p.text)).join('  +  ');
        list.append(h('li', { class: `step${st.n === sel() ? ' sel' : ''}${done()[st.n - 1] ? ' done' : ''}`, dataset: { n: st.n } },
          h('input', { type: 'checkbox', checked: Boolean(done()[st.n - 1]), 'aria-label': `Cut ${st.n} done`, onchange: (e) => setDone(st.n, e.target.checked) }),
          h('button', { type: 'button', class: 'step-body', onclick: () => pick(st.n) },
            h('span', { class: 'step-n' }, String(st.n)),
            h('span', { class: 'step-text' },
              h('strong', null, d.title),
              h('span', { class: 'step-from' }, st.from ? ` — piece from cut ${st.from} (${dims(st.wp.w, st.wp.h, u)})` : ' — full sheet'),
              h('span', { class: 'step-gives' }, gives)))));
      }
    }

    function update() { drawFigure(); drawStepper(); drawList(); }

    const el = h('section', { class: 'card sheet-card', id: `sheet-${sheet.n}` },
      h('div', { class: 'sheet-head' },
        h('h3', null, `Sheet ${sheet.n} of ${result.sheets.length}`),
        h('div', { class: 'sheet-meta' }, stockTitle(stock, u)),
        h('div', { class: 'sheet-facts' },
          h('span', null, `${pct(used)} used`), h('span', null, plural(sheet.placements.length, 'part')), h('span', null, plural(total, 'cut')), progress)),
      stock.faces === 1 ? h('p', { class: 'face-note' }, h('strong', null, 'One good face: '), 'up on a table saw, down under a circular or track saw.') : null,
      h('div', { class: 'sheet-body' },
        stepper,
        h('div', { class: 'sheet-figure' },
          figure,
          zoomBtn,
          offcuts.length ? h('p', { class: 'fine offcut-list' }, h('strong', null, 'Offcuts to keep: '), offcuts.map((o) => dims(o.w, o.h, u)).join(',  ') + unitSuffix(u)) : null),
        h('details', { class: 'all-steps', open: window.matchMedia('(min-width: 900px)').matches },
          h('summary', null, `All ${total} cuts in order`),
          list)));
    return { el, update, drawFigure };
  }

  // ---- cut list -----------------------------------------------------------
  function cutList(result) {
    const u = units();
    const where = new Map();
    for (const s of result.sheets) for (const pl of s.placements) {
      if (!where.has(pl.panelIdx)) where.set(pl.panelIdx, new Map());
      const m = where.get(pl.panelIdx);
      m.set(s.n, (m.get(s.n) ?? 0) + 1);
    }
    const banded = result.panels.some((p) => p.l !== p.fl || p.w !== p.fw);
    const groups = result.groups.map((g) => {
      const rows = result.panels.filter((p) => p.groupKey === g.key).map((p) => {
        const [fill, stroke] = panelColor(p.code);
        const band = p.bandL || p.bandW ? `${p.bandL} long, ${p.bandW} end` : '—';
        const sheets = [...(where.get(p.idx) ?? new Map()).entries()].map(([n, c]) => (c > 1 ? `${n} (×${c})` : String(n))).join(', ');
        return h('tr', null,
          h('td', null, h('span', { class: 'swatch', style: { background: fill, borderColor: stroke } }, `#${p.code}`)),
          h('td', null, p.name),
          h('td', { class: 'num' }, p.placed === p.qty ? String(p.qty) : h('span', { class: 'bad' }, `${p.placed} of ${p.qty}`)),
          h('td', { class: 'num strong' }, panelDims(p, u)),
          banded ? h('td', { class: 'num' }, p.l !== p.fl || p.w !== p.fw ? dims(p.fl, p.fw, u) : '') : null,
          h('td', { class: 'wide-only' }, GRAIN_LABEL[p.grain]),
          h('td', { class: 'wide-only' }, FACES_LABEL[p.faces]),
          h('td', { class: 'wide-only' }, band),
          h('td', null, sheets || '—'));
      });
      return [h('tr', { class: 'group-row' }, h('td', { colspan: banded ? 9 : 8 }, g.label)), ...rows];
    });
    return h('section', { class: 'card', id: 'res-cutlist' },
      h('h2', null, 'Cut list'),
      h('p', { class: 'sub' }, `Length × width, in ${u === 'in' ? 'inches' : 'millimetres'}.`),
      h('div', { class: 'table-wrap' }, h('table', { class: 'tbl cutlist' },
        h('thead', null, h('tr', null,
          h('th', null, '#'), h('th', null, 'Panel'), h('th', { class: 'num' }, 'Qty'), h('th', { class: 'num' }, 'Cut size'),
          banded ? h('th', { class: 'num' }, 'Finished') : null,
          h('th', { class: 'wide-only' }, 'Grain'), h('th', { class: 'wide-only' }, 'Faces'), h('th', { class: 'wide-only' }, 'Banded edges'), h('th', null, 'On sheet'))),
        h('tbody', null, groups))));
  }

  // ---- whole view ---------------------------------------------------------
  function render() {
    const state = ctx.getState();
    const result = state.result;
    clear(root);
    sheetViews.length = 0;
    if (!result) {
      root.append(h('section', { class: 'card empty' },
        h('h2', null, 'No cutting plan yet'),
        h('p', null, 'Enter your stock sheets and panels on the Job tab, then calculate.'),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.recalc() }, 'Calculate cutting plan'),
          h('button', { class: 'btn', type: 'button', onclick: () => ctx.goToJob() }, 'Go to the job'))));
      return;
    }
    const u = units();
    if (ctx.stale()) {
      root.append(h('div', { class: 'banner warn' },
        h('span', null, 'The job has changed since this plan was calculated.'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.recalc() }, 'Recalculate')));
    }
    if (!result.check.ok) {
      root.append(h('div', { class: 'banner bad' },
        h('div', null, h('strong', null, 'Do not cut from this plan. '), 'It failed its own safety check — this is a bug in the optimizer, not in your job.'),
        h('ul', null, result.check.errors.slice(0, 5).map((e) => h('li', null, e)))));
    }
    if (result.unplaced.length) {
      root.append(h('div', { class: 'banner bad' },
        h('div', null, h('strong', null, 'Not enough stock. '), 'These parts could not be placed on the sheets you have:'),
        h('ul', null, result.unplaced.map((x) => {
          const p = result.panels[x.panelIdx];
          return h('li', null, `${x.count} × ${p.name} (${panelDims(p, u)}${unitSuffix(u)})`);
        })),
        h('div', null, 'Add sheets or raise “In stock” on the Job tab.')));
    }
    for (const w of result.issues ?? []) root.append(h('div', { class: 'banner note' }, w.message));

    root.append(
      h('nav', { class: 'jump', 'aria-label': 'Sections' },
        h('a', { href: '#res-summary' }, 'Summary'),
        result.sheets.map((s) => h('a', { href: `#sheet-${s.n}` }, `Sheet ${s.n}`)),
        h('a', { href: '#res-cutlist' }, 'Cut list')),
      summary(result),
      h('div', { class: 'sheets-head' },
        h('h2', null, 'Layouts and cutting order'),
        h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: ui.numbers, onchange: (e) => { ui.numbers = e.target.checked; sheetViews.forEach((v) => v.drawFigure()); } }), ' Show cut numbers')));
    for (const sheet of result.sheets) {
      const view = sheetCard(sheet, result);
      sheetViews.push(view);
      root.append(view.el);
    }
    root.append(cutList(result));
    sheetViews.forEach((v) => v.update());
    lastWidth = root.clientWidth;
  }

  // redraw the drawings when the available width changes (rotation, window resize)
  let timer = 0;
  new ResizeObserver(() => {
    if (ui.print || !root.clientWidth || Math.abs(root.clientWidth - lastWidth) < 8) return;
    clearTimeout(timer);
    timer = setTimeout(() => { lastWidth = root.clientWidth; sheetViews.forEach((v) => v.drawFigure()); }, 120);
  }).observe(root);

  /** Switch the drawings between their screen and paper versions (called around printing). */
  function setPrint(on) {
    if (ui.print === on) return;
    ui.print = on;
    if (on && ctx.getState().result && !sheetViews.length) render(); // printing straight from the Job tab
    sheetViews.forEach((v) => v.drawFigure());
  }

  return { render, redraw: () => sheetViews.forEach((v) => v.drawFigure()), setPrint };
}
