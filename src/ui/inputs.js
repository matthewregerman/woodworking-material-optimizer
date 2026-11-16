// The "Job" tab: settings, stock sheets and panels, with live validation.

import { h, $, $$, clear } from './dom.js';
import { parseLength, formatLength, unitSuffix } from '../engine/units.js';
import { analyzeJob, materialKey } from '../engine/model.js';
import { blankStock, blankPanel } from './store.js';

const STOCK_FIELDS = [
  { key: 'material', label: 'Material', type: 'text', placeholder: 'e.g. Birch plywood' },
  { key: 'thickness', label: 'Thickness', type: 'len' },
  { key: 'length', label: 'Length', type: 'len', tip: 'The face grain runs along the length unless “Grain runs” says otherwise' },
  { key: 'width', label: 'Width', type: 'len' },
  { key: 'grain', label: 'Grain runs', type: 'select', options: [['length', 'Along length'], ['width', 'Along width'], ['none', 'No grain']] },
  { key: 'faces', label: 'Good faces', type: 'select', numeric: true, options: [[2, 'Both faces'], [1, 'One face + back']] },
  { key: 'qty', label: 'In stock', type: 'int', placeholder: 'any', tip: 'Leave empty to buy as many as needed' },
  { key: 'price', label: 'Price each', type: 'num', placeholder: '—' },
];

const PANEL_FIELDS = [
  { key: 'name', label: 'Panel name', type: 'text', placeholder: 'e.g. Cabinet side' },
  { key: 'length', label: 'Length', type: 'len', tip: 'Finished length of the part' },
  { key: 'width', label: 'Width', type: 'len', tip: 'Finished width of the part' },
  { key: 'qty', label: 'Qty', type: 'int' },
  { key: 'stockId', label: 'Material', type: 'material' },
  { key: 'grain', label: 'Grain', type: 'select', tip: 'Which way the grain should run on the part', options: [['length', 'Along length'], ['width', 'Along width'], ['any', 'Either way']] },
  { key: 'faces', label: 'Faces seen', type: 'select', numeric: true, tip: '“Both faces” needs a sheet with two good faces', options: [[1, 'One face'], [2, 'Both faces'], [0, 'Hidden']] },
  { key: 'bandL', label: 'Band long edges', short: 'Band long', type: 'select', numeric: true, tip: 'How many long edges get edge banding', options: [[0, '0'], [1, '1'], [2, '2']] },
  { key: 'bandW', label: 'Band ends', short: 'Band ends', type: 'select', numeric: true, tip: 'How many ends get edge banding', options: [[0, '0'], [1, '1'], [2, '2']] },
];

const SETTING_FIELDS = {
  kerf: { label: 'Saw kerf' },
  trim: { label: 'Edge trim', hint: 'Off all four edges of every sheet.' },
  bandThickness: { label: 'Edge banding thickness', hint: 'Deducted from the cut size for each banded edge.' },
  minOffcut: { label: 'Smallest offcut worth keeping', hint: 'Narrower leftovers count as waste.' },
};

export function createJobView(root, ctx) {
  // ctx: { getJob(), changed(structural), calculate(), showAllErrors }
  let analysis = null;
  let showAll = false;
  let raf = 0;

  const job = () => ctx.getJob();
  const units = () => job().units;

  const fmt = (mm) => (typeof mm === 'number' && Number.isFinite(mm) ? formatLength(mm, units()) : '');

  // ---- material choices for panels ---------------------------------------
  function materialGroups() {
    const seen = new Map();
    for (const st of job().stock) {
      const name = String(st.material ?? '').trim();
      if (!name || !(st.thickness > 0)) continue;
      const key = materialKey(name, Math.round(st.thickness * 1000));
      if (!seen.has(key)) seen.set(key, { key, id: st.id, label: `${name} · ${fmt(st.thickness)}${unitSuffix(units())}`, ids: [] });
      seen.get(key).ids.push(st.id);
    }
    return [...seen.values()];
  }

  function fillMaterialSelect(sel, panel) {
    const groups = materialGroups();
    clear(sel);
    const current = groups.find((g) => g.ids.includes(panel.stockId));
    if (!current) sel.append(h('option', { value: '', selected: true }, groups.length ? 'Choose…' : 'Add stock first'));
    for (const g of groups) sel.append(h('option', { value: g.id, selected: g === current }, g.label));
  }

  // ---- generic field ------------------------------------------------------
  function field(kind, row, f) {
    let input;
    const common = { dataset: { kind, id: row.id, field: f.key, type: f.type }, 'aria-label': f.label };
    if (f.type === 'select') {
      input = h('select', common, f.options.map(([v, text]) => h('option', { value: v, selected: row[f.key] === v }, text)));
    } else if (f.type === 'material') {
      input = h('select', common);
      fillMaterialSelect(input, row);
    } else {
      const v = row[f.key];
      const value = f.type === 'len' ? fmt(v) : v == null || Number.isNaN(v) ? '' : String(v);
      input = h('input', {
        ...common, type: 'text', value, placeholder: f.placeholder ?? '',
        inputmode: f.type === 'int' ? 'numeric' : f.type === 'text' ? null : 'decimal',
        autocomplete: 'off', spellcheck: 'false',
        list: kind === 'stock' && f.key === 'material' ? 'material-names' : null,
      });
    }
    return h('label', { class: `f f-${f.key}`, ...(f.tip ? { dataset: { tip: f.tip } } : {}) }, h('span', { class: 'lbl' }, f.short ?? f.label), input);
  }

  function rowEl(kind, row, index, fields) {
    return h('div', { class: `row ${kind}-row`, dataset: { row: row.id } },
      h('div', { class: 'row-num', 'aria-hidden': 'true' }, kind === 'panel' ? `#${index + 1}` : String(index + 1)),
      fields.map((f) => field(kind, row, f)),
      h('button', { class: 'icon-btn del', type: 'button', title: 'Remove this row', 'aria-label': 'Remove this row', dataset: { del: kind, id: row.id } }, '✕'),
      h('div', { class: 'row-msgs' }));
  }

  function headerEl(kind, fields) {
    return h('div', { class: `row row-head ${kind}-row`, 'aria-hidden': 'true' },
      h('div', { class: 'row-num' }, '#'),
      fields.map((f) => h('div', { class: `f f-${f.key}${f.tip ? ' has-tip' : ''}`, ...(f.tip ? { tabindex: '0', dataset: { tip: f.tip } } : {}) }, f.short ?? f.label)),
      h('div'));
  }

  // ---- sections -----------------------------------------------------------
  function settingsSection() {
    const j = job();
    const lenSetting = (key) => {
      const f = SETTING_FIELDS[key];
      return h('label', { class: 'setting' },
        h('span', { class: 'setting-label' }, f.label),
        h('span', { class: 'with-unit' },
          h('input', { type: 'text', inputmode: 'decimal', value: fmt(j[key]), autocomplete: 'off', dataset: { kind: 'settings', field: key, type: 'len' }, 'aria-label': f.label }),
          h('span', { class: 'unit' }, units() === 'in' ? 'in' : 'mm')),
        f.hint ? h('span', { class: 'hint' }, f.hint) : null,
        h('span', { class: 'field-msg', dataset: { msgFor: key } }));
    };
    return h('section', { class: 'card', id: 'sec-settings' },
      h('h2', null, 'Saw & settings'),
      h('div', { class: 'settings-grid' },
        h('div', { class: 'setting' },
          h('span', { class: 'setting-label' }, 'Units'),
          h('div', { class: 'seg', role: 'group', 'aria-label': 'Units' },
            ['mm', 'in'].map((u) => h('button', { type: 'button', class: j.units === u ? 'on' : '', 'aria-pressed': String(j.units === u), dataset: { units: u } }, u === 'mm' ? 'Millimetres' : 'Inches'))),
          units() === 'in' ? h('span', { class: 'hint' }, 'Fractions are fine: 23 1/2, 3/4.') : null),
        lenSetting('kerf'),
        lenSetting('trim')),
      h('fieldset', { class: 'choice' },
        h('legend', { class: 'setting-label' }, 'Secondary optimization'),
        h('div', { class: 'choice-opts' },
          [
            ['offcuts', 'Large offcuts', 'Keeps leftover in the biggest pieces. May take more cuts.'],
            ['cuts', 'Fewer cuts', 'Leftover may end up in smaller pieces.'],
          ].map(([value, title, text]) => h('label', { class: 'choice-opt' },
            h('input', { type: 'radio', name: 'favor', value, checked: (j.favor === 'cuts' ? 'cuts' : 'offcuts') === value, dataset: { kind: 'settings', field: 'favor', type: 'radio' } }),
            h('span', { class: 'choice-text' }, h('strong', null, title), h('span', { class: 'hint' }, text)))))),
      h('details', { class: 'more', open: Boolean(j.bandThickness) || j.firstCut !== 'auto' },
        h('summary', null, 'More options'),
        h('div', { class: 'settings-grid' },
          lenSetting('bandThickness'),
          lenSetting('minOffcut'),
          h('label', { class: 'setting' },
            h('span', { class: 'setting-label' }, 'First cuts on a full sheet'),
            h('select', { dataset: { kind: 'settings', field: 'firstCut', type: 'select' } },
              [['auto', 'Whatever wastes least'], ['rip', 'Rip lengthwise first'], ['cross', 'Crosscut first']].map(([v, t]) => h('option', { value: v, selected: j.firstCut === v }, t)))))));
  }

  function stockSection() {
    const list = h('div', { class: 'rows', id: 'stock-rows' }, headerEl('stock', STOCK_FIELDS), job().stock.map((r, i) => rowEl('stock', r, i, STOCK_FIELDS)));
    return h('section', { class: 'card', id: 'sec-stock' },
      h('div', { class: 'card-head' }, h('h2', null, 'Stock sheets')),
      list,
      h('datalist', { id: 'material-names' }, [...new Set(job().stock.map((x) => x.material.trim()).filter(Boolean))].map((m) => h('option', { value: m }))),
      h('button', { class: 'btn add', type: 'button', dataset: { add: 'stock' } }, '+ Add stock sheet'));
  }

  function panelSection() {
    const list = h('div', { class: 'rows', id: 'panel-rows' }, headerEl('panel', PANEL_FIELDS), job().panels.map((r, i) => rowEl('panel', r, i, PANEL_FIELDS)));
    return h('section', { class: 'card', id: 'sec-panels' },
      h('div', { class: 'card-head' }, h('h2', null, 'Panels')),
      list,
      h('button', { class: 'btn add', type: 'button', dataset: { add: 'panel' } }, '+ Add panel'));
  }

  function footer() {
    return h('div', { class: 'calc-bar' },
      h('div', { class: 'calc-info' },
        h('div', { id: 'job-summary', class: 'job-summary' }),
        h('button', { id: 'issue-count', class: 'issue-count', type: 'button', hidden: true })),
      h('button', { class: 'btn primary big', id: 'calc-btn', type: 'button' }, 'Calculate cutting plan'));
  }

  function render() {
    clear(root);
    root.append(
      settingsSection(), stockSection(), panelSection(),
      h('div', { id: 'job-issues', class: 'issues', hidden: true }),
      footer());
    validate();
  }

  // ---- validation ---------------------------------------------------------
  function validate() {
    analysis = analyzeJob(job());
    const active = document.activeElement?.closest?.('.row')?.dataset.row;
    const byRow = new Map();
    const general = [];
    for (const is of analysis.issues) {
      if (is.scope === 'panel' || is.scope === 'stock') {
        if (!byRow.has(is.id)) byRow.set(is.id, []);
        byRow.get(is.id).push(is);
      } else general.push(is);
    }
    for (const row of $$('.row[data-row]', root)) {
      const id = row.dataset.row;
      const issues = byRow.get(id) ?? [];
      // don't nag about a row that is still being typed into
      const quiet = !showAll && id === active;
      const shown = quiet ? issues.filter((i) => i.level === 'error' && !/enter (the|a)/.test(i.message)) : issues;
      for (const lab of $$('.f', row)) lab.classList.remove('invalid', 'warned');
      for (const is of shown) {
        const lab = $(`.f-${is.field === 'material' && row.classList.contains('panel-row') ? 'stockId' : is.field}`, row);
        lab?.classList.add(is.level === 'error' ? 'invalid' : 'warned');
      }
      const box = $('.row-msgs', row);
      clear(box);
      for (const is of shown) box.append(h('div', { class: `msg ${is.level}` }, rowText(is.message)));
      row.classList.toggle('has-error', shown.some((i) => i.level === 'error'));
    }
    for (const el of $$('[data-msg-for]', root)) {
      const is = general.filter((g) => g.scope === 'settings' && g.field === el.dataset.msgFor);
      el.textContent = is.map((x) => x.message).join(' ');
      el.className = `field-msg ${is.some((x) => x.level === 'error') ? 'error' : is.length ? 'warning' : ''}`;
    }
    const box = $('#job-issues', root);
    const jobLevel = general.filter((g) => g.scope === 'job');
    const errors = analysis.issues.filter((i) => i.level === 'error');
    clear(box);
    if (showAll && errors.length) {
      box.hidden = false;
      box.append(h('strong', null, errors.length === 1 ? 'One thing to fix before calculating:' : `${errors.length} things to fix before calculating:`),
        h('ul', null, errors.map((e) => h('li', null, h('button', { type: 'button', class: 'link', dataset: { goto: e.id ?? '', scope: e.scope, field: e.field } }, e.message)))));
    } else if (jobLevel.length && showAll) {
      box.hidden = false;
      box.append(...jobLevel.map((e) => h('div', null, e.message)));
    } else box.hidden = true;

    const p = analysis.problem;
    const rows = job().panels.filter((x) => String(x.name ?? '').trim() || x.length != null || x.width != null).length;
    $('#job-summary', root).textContent = p.pieceCount
      ? `${p.pieceCount} piece${p.pieceCount === 1 ? '' : 's'} · ${rows} panel row${rows === 1 ? '' : 's'} · ${p.groups.length} material${p.groups.length === 1 ? '' : 's'}`
      : 'No panels yet';
    const ic = $('#issue-count', root);
    ic.hidden = errors.length === 0;
    ic.textContent = errors.length === 1 ? '1 problem to fix' : `${errors.length} problems to fix`;
  }

  // inside its own row a message does not need to repeat which row it is about
  function rowText(message) {
    const t = message.replace(/^(Stock row \d+|Panel "[^"]*"): /, '');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  const queueValidate = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(validate); };

  function refreshMaterialSelects() {
    for (const sel of $$('select[data-type="material"]', root)) {
      const p = job().panels.find((x) => x.id === sel.dataset.id);
      if (p) fillMaterialSelect(sel, p);
    }
    const dl = $('#material-names', root);
    if (dl) { clear(dl); for (const m of new Set(job().stock.map((x) => x.material.trim()).filter(Boolean))) dl.append(h('option', { value: m })); }
  }

  function focusIssue(scope, id, field) {
    let el = null;
    if (scope === 'panel' || scope === 'stock') {
      const row = $(`.row[data-row="${CSS.escape(id)}"]`, root);
      const key = scope === 'panel' && field === 'material' ? 'stockId' : field;
      el = row && ($(`[data-field="${key}"]`, row) ?? $('input,select', row));
    } else if (scope === 'settings') {
      el = $(`[data-kind="settings"][data-field="${field}"]`, root);
      el?.closest('details')?.setAttribute('open', '');
    } else {
      el = $(field === 'stock' ? '[data-add="stock"]' : '[data-add="panel"]', root);
    }
    if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.focus({ preventScroll: true }); }
  }

  // ---- events -------------------------------------------------------------
  function readInput(el) {
    const type = el.dataset.type;
    const raw = el.value;
    if (type === 'len') return parseLength(raw, units());
    if (type === 'int') { const t = raw.trim(); return t === '' ? null : /^\d+$/.test(t) ? Number(t) : NaN; }
    if (type === 'num') { const t = raw.trim().replace(',', '.'); return t === '' ? null : /^\d*\.?\d+$/.test(t) ? Number(t) : NaN; }
    if (type === 'select') { const f = el.closest('.f'); return /f-(faces|bandL|bandW)/.test(f?.className ?? '') ? Number(raw) : raw; }
    if (type === 'material') return raw || null;
    if (type === 'radio') return raw;
    return raw;
  }

  root.addEventListener('input', (e) => {
    const el = e.target.closest('[data-field]');
    if (!el) return;
    const { kind, id, field: key } = el.dataset;
    const value = readInput(el);
    if (kind === 'settings') job()[key] = value;
    else {
      const row = (kind === 'stock' ? job().stock : job().panels).find((r) => r.id === id);
      if (!row) return;
      row[key] = value;
      if (kind === 'stock' && (key === 'material' || key === 'thickness')) refreshMaterialSelects();
    }
    ctx.changed();
    queueValidate();
  });

  // tidy what was typed once the field is left ("596,5" -> "596.5", "23.5" -> "23 1/2")
  root.addEventListener('focusout', (e) => {
    const el = e.target.closest('[data-field]');
    if (el && el.dataset.type === 'len') {
      const v = parseLength(el.value, units());
      if (typeof v === 'number' && Number.isFinite(v)) el.value = formatLength(v, units());
    }
    queueValidate();
  });
  root.addEventListener('focusin', queueValidate);

  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    const row = e.target.closest('.row[data-row]');
    if (!row) return;
    e.preventDefault();
    const kind = row.classList.contains('panel-row') ? 'panel' : 'stock';
    const rows = $$(`.${kind}-row[data-row]`, root);
    if (row === rows[rows.length - 1]) addRow(kind);
    else $('input', rows[rows.indexOf(row) + 1])?.focus();
  });

  function addRow(kind) {
    const j = job();
    let row;
    if (kind === 'stock') { row = blankStock(); j.stock.push(row); }
    else {
      const last = j.panels[j.panels.length - 1];
      row = blankPanel(last ?? { stockId: materialGroups()[0]?.id ?? null });
      j.panels.push(row);
    }
    const list = $(kind === 'stock' ? '#stock-rows' : '#panel-rows', root);
    const el = rowEl(kind, row, (kind === 'stock' ? j.stock : j.panels).length - 1, kind === 'stock' ? STOCK_FIELDS : PANEL_FIELDS);
    list.append(el);
    ctx.changed();
    $('input', el)?.focus();
    queueValidate();
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const j = job();
    if (t.dataset.add) addRow(t.dataset.add);
    else if (t.dataset.del) {
      const kind = t.dataset.del, id = t.dataset.id;
      if (kind === 'stock') {
        const gone = j.stock.find((r) => r.id === id);
        j.stock = j.stock.filter((r) => r.id !== id);
        // panels pointing at the removed row move to another sheet of the same material, if any
        const key = gone && gone.thickness > 0 ? materialKey(gone.material, Math.round(gone.thickness * 1000)) : null;
        const twin = key && j.stock.find((r) => r.thickness > 0 && materialKey(r.material, Math.round(r.thickness * 1000)) === key);
        for (const p of j.panels) if (p.stockId === id) p.stockId = twin ? twin.id : null;
      } else j.panels = j.panels.filter((r) => r.id !== id);
      ctx.changed();
      render();
    } else if (t.dataset.units) {
      if (j.units !== t.dataset.units) { j.units = t.dataset.units; ctx.changed(); ctx.unitsChanged?.(); render(); }
    } else if (t.id === 'calc-btn') {
      api.tryCalculate();
    } else if (t.id === 'issue-count') {
      showAll = true; validate();
      $('#job-issues', root).scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (t.dataset.scope) {
      focusIssue(t.dataset.scope, t.dataset.goto, t.dataset.field);
    }
  });

  const api = {
    render() { showAll = false; render(); },
    analysis: () => analysis,
    tryCalculate() {
      validate();
      if (analysis.blocking) {
        showAll = true; validate();
        const first = analysis.issues.find((i) => i.level === 'error');
        $('#job-issues', root).scrollIntoView({ block: 'center', behavior: 'smooth' });
        if (first && (first.scope === 'panel' || first.scope === 'stock' || first.scope === 'settings')) focusIssue(first.scope, first.id, first.field);
        return false;
      }
      ctx.calculate();
      return true;
    },
  };
  return api;
}
