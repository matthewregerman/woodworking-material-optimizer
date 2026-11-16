// App shell: tabs, job file menu, calculate, persistence.

import { store, blankJob, normalizeJob, jobHash } from './store.js';
import { createJobView } from './inputs.js';
import { createResultsView } from './results.js';
import { optimizeAsync, RESULT_VERSION } from '../engine/optimize.js';
import { exampleJob } from '../engine/example.js';
import { $, $$ } from './dom.js';

store.init();
const state = () => store.state;
// a plan saved by an older version of the app is not trusted
if (state().result && state().result.version !== RESULT_VERSION) { state().result = null; state().resultHash = null; }

const stale = () => Boolean(state().result) && state().resultHash !== jobHash(state().job);

// ---- small UI services ----------------------------------------------------
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 3200);
}

function confirmDialog(text, okLabel = 'OK') {
  const dlg = $('#confirm');
  $('#confirm-text').textContent = text;
  $('#confirm-ok').textContent = okLabel;
  if (typeof dlg.showModal !== 'function') return Promise.resolve(window.confirm(text));
  return new Promise((resolve) => {
    dlg.returnValue = 'cancel';
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.showModal();
  });
}

function setTab(name) {
  for (const t of ['job', 'plan']) {
    $(`#tab-${t}`).setAttribute('aria-selected', String(t === name));
    $(`#view-${t}`).hidden = t !== name;
  }
  try { sessionStorage.setItem('tab', name); } catch { /* ignore */ }
  if (name === 'plan') resultsView.render();
  window.scrollTo(0, 0);
}

function updateFlags() {
  $('#plan-flag').hidden = !stale();
}

// ---- views ----------------------------------------------------------------
const jobView = createJobView($('#view-job'), {
  getJob: () => state().job,
  changed: () => { store.save(); updateFlags(); },
  calculate,
});

const resultsView = createResultsView($('#view-plan'), {
  getState: state,
  stale,
  save: () => store.save(),
  goToJob: () => setTab('job'),
  recalc: () => {
    if (jobView.analysis()?.blocking ?? true) { setTab('job'); jobView.tryCalculate(); } else calculate();
  },
});

async function calculate() {
  const busy = $('#busy');
  busy.hidden = false;
  $('#busy-bar').style.width = '0%';
  const job = structuredClone(state().job);
  const started = Date.now();
  let result;
  try {
    result = await optimizeAsync(job, {
      onProgress: (f) => {
        $('#busy-bar').style.width = `${Math.round(f * 100)}%`;
        $('#busy-text').textContent = `Trying thousands of arrangements · ${((Date.now() - started) / 1000).toFixed(1)} s`;
      },
    });
  } catch (err) {
    busy.hidden = true;
    console.error(err);
    toast(`Something went wrong while calculating: ${err.message}`);
    return;
  }
  busy.hidden = true;
  if (!result.ok) { setTab('job'); jobView.tryCalculate(); return; }
  state().result = result;
  state().resultHash = jobHash(job);
  state().progress = {};
  store.save(true);
  updateFlags();
  setTab('plan');
}

function renderAll() {
  $('#job-name').value = state().job.name ?? '';
  jobView.render();
  updateFlags();
  if (!$('#view-plan').hidden) resultsView.render();
}

// ---- header ---------------------------------------------------------------
$('#job-name').addEventListener('input', (e) => { state().job.name = e.target.value; store.save(); });
$('#tab-job').addEventListener('click', () => setTab('job'));
$('#tab-plan').addEventListener('click', () => setTab('plan'));

const menu = $('#menu'), menuBtn = $('#menu-btn');
const closeMenu = () => { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); };
menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  menu.hidden = !menu.hidden;
  menuBtn.setAttribute('aria-expanded', String(!menu.hidden));
});
document.addEventListener('click', (e) => { if (!menu.contains(e.target)) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

const jobHasContent = () => state().job.panels.some((p) => p.name || p.length != null) || state().job.stock.some((s) => s.material);

async function replaceJob(job, what) {
  if (jobHasContent() && !(await confirmDialog(`${what} This replaces the job and plan you have open.`, 'Replace'))) return;
  store.replace(job);
  renderAll();
  setTab('job');
}

menu.addEventListener('click', async (e) => {
  const act = e.target.closest('button')?.dataset.act;
  if (!act) return;
  closeMenu();
  if (act === 'example') replaceJob(exampleJob(), 'Load the example kitchen job?');
  else if (act === 'new') replaceJob(blankJob(state().job.units), 'Start a new empty job?');
  else if (act === 'import') $('#file').click();
  else if (act === 'export') {
    const data = JSON.stringify({ app: 'cabinet-optimizer', version: 1, job: state().job }, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = `${(state().job.name || 'cut-job').replace(/[^\w\- ]+/g, '').trim() || 'cut-job'}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
});

$('#print-btn').addEventListener('click', () => {
  if (!state().result) { toast('Calculate a cutting plan first.'); return; }
  setTab('plan');
  setTimeout(() => window.print(), 150);
});

$('#file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    await replaceJob(normalizeJob(raw.job ?? raw), `Open “${file.name}”?`);
  } catch (err) {
    toast(err instanceof SyntaxError ? 'That file is not a job file (it is not valid JSON).' : err.message);
  }
});

// print with every step list open, drawings laid out for paper
let reopened = [];
window.addEventListener('beforeprint', () => {
  reopened = $$('details.all-steps:not([open])');
  reopened.forEach((d) => { d.open = true; });
});
window.addEventListener('afterprint', () => { reopened.forEach((d) => { d.open = false; }); reopened = []; });

// ---- sync -----------------------------------------------------------------
store.onStatus = (s) => { $('#sync-status').textContent = s === 'synced' ? 'Saved on this computer — open the same address on your phone to see this job' : 'Saved in this browser'; };
store.onExternalChange = () => { renderAll(); toast('Updated with changes made on another device.'); };
const pull = () => { if (document.visibilityState === 'visible' && !document.activeElement?.matches?.('input, select, textarea')) store.pull(); };
document.addEventListener('visibilitychange', pull);
window.addEventListener('focus', pull);
setInterval(pull, 20000);

// ---- go -------------------------------------------------------------------
renderAll();
// Reopen where you left off; with no history, go straight to the plan if there is one.
let remembered = null;
try { remembered = sessionStorage.getItem('tab'); } catch { /* ignore */ }
setTab(state().result && remembered !== 'job' ? 'plan' : 'job');
store.pull().then((changed) => { if (changed && state().result && remembered !== 'job') setTab('plan'); });
