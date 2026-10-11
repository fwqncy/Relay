// Relay web app. No build step: plain ES modules served by the Go binary.

/* ───────────────────────── Rendering helpers ───────────────────────── */

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = (s) => new Raw(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const part = (v) => v == null || v === false ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join('') : esc(v);
function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += part(vals[i]); });
  return raw(out);
}
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const NBSP = ' ';

/* ───────────────────────── Formatting ───────────────────────── */

const nf = new Intl.NumberFormat();
const nf1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const timeSecFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dateLong = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const dateShort = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' });

function fmtMs(ms) {
  if (ms == null || Number.isNaN(ms)) return '—';
  if (ms < 1) return `<1${NBSP}ms`;
  if (ms < 1000) return `${Math.round(ms)}${NBSP}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1).replace(/\.?0+$/, '')}${NBSP}s`;
}
function msParts(ms) {
  if (ms == null) return ['—', ''];
  if (ms < 1000) return [String(Math.round(ms)), 'ms'];
  return [(ms / 1000).toFixed(2).replace(/\.?0+$/, ''), 's'];
}
function fmtRate(n) {
  if (n == null) return '—';
  return n >= 1000 ? `${nf1.format(n / 1000)}k` : nf.format(Math.round(n));
}
function relTime(date) {
  const s = (new Date(date) - Date.now()) / 1000;
  const a = Math.abs(s);
  if (a < 45) return rtf.format(Math.round(s), 'second');
  if (a < 2700) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}
const fmtTime = (d) => timeFmt.format(new Date(d));
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const plural = (n, one, many = one + 's') => `${nf.format(n)}${NBSP}${n === 1 ? one : many}`;

/* ───────────────────────── Dates ───────────────────────── */

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d) => { const x = startOfDay(d); return addDays(x, -((x.getDay() + 6) % 7)); };
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function parseISODate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(+d) ? null : d;
}
const sameDay = (a, b) => isoDate(a) === isoDate(b);
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
function atTime(day, time) {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(day); d.setHours(h, m, 0, 0); return d;
}

/* ───────────────────────── Icons ───────────────────────── */

const ICONS = {
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  dock: '<path d="M3 21V8l9-5 9 5v13"/><path d="M7 21v-8h10v8M7 17h10"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  play: '<circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4V8Z"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevL: '<path d="m15 18-6-6 6-6"/>',
  chevR: '<path d="m9 18 6-6-6-6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2M15 18H9M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62L18.3 9.38A1 1 0 0 0 17.52 9H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  arrowIn: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  arrowOut: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  tag: '<path d="M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42Z"/><circle cx="7.5" cy="7.5" r=".5"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3Z"/><circle cx="12" cy="13" r="3"/>',
  receipt: '<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 3 2V2l-3 2-3-2-3 2-3-2-3 2Z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7l10-5Z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
};
const icon = (name, size = 16, label) => raw(
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"${label ? ` role="img" aria-label="${esc(label)}"` : ' aria-hidden="true"'}>${ICONS[name] || ''}</svg>`);
const JOB_ICONS = {
  'eta.recompute': 'clock', 'label.print': 'tag', 'notify.driver': 'message', 'pod.upload': 'camera',
  'route.optimize': 'route', 'invoice.sync': 'receipt', 'dock.confirm': 'dock', 'dock.checkin': 'truck', 'shift.publish': 'send',
};

/* ───────────────────────── API ───────────────────────── */

class ApiError extends Error {
  constructor(message, status, field) { super(message); this.status = status; this.field = field; }
}

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'relay', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Can’t reach the Relay server. Check that it’s running, then try again.', 0);
  }
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/login' && state.me) signedOut();
    throw new ApiError(data?.error || `Request failed (${res.status}).`, res.status, data?.field);
  }
  return data;
}

/* ───────────────────────── State ───────────────────────── */

const state = {
  me: null,
  stream: null,
  streamListeners: new Set(),
  lastStream: null,
  cleanup: null,
};
const isManager = () => state.me?.user.role === 'manager';

/* ───────────────────────── Theme & accent ───────────────────────── */

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function themePref() {
  try { return localStorage.getItem('relay-theme') || 'system'; } catch { return 'system'; }
}
function applyTheme(pref = themePref()) {
  try { localStorage.setItem('relay-theme', pref); } catch { /* private mode */ }
  const dark = pref === 'dark' || (pref === 'system' && darkQuery.matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.themePref = pref;
  $('meta[name="theme-color"]').content = getComputedStyle(document.body).getPropertyValue('--bg').trim() || (dark ? '#09090b' : '#fafafa');
  $$('[data-theme-select]').forEach((s) => { s.value = pref; });
  const iconEl = $$('[data-theme-icon]');
  iconEl.forEach((el) => { el.outerHTML = themeIcon(pref).s; });
}
darkQuery.addEventListener('change', () => { if (themePref() === 'system') applyTheme('system'); });

const themeIcon = (pref) => raw(icon(pref === 'dark' ? 'moon' : pref === 'light' ? 'sun' : 'monitor', 15).s.replace('<svg', '<svg data-theme-icon'));
function themePicker(id) {
  const pref = themePref();
  return html`<label class="theme-picker">
    <span class="sr-only">Theme</span>
    ${themeIcon(pref)}
    <select class="select sm" id="${id}" data-theme-select aria-label="Theme">
      <option value="system" ${pref === 'system' ? raw('selected') : ''}>System</option>
      <option value="light" ${pref === 'light' ? raw('selected') : ''}>Light</option>
      <option value="dark" ${pref === 'dark' ? raw('selected') : ''}>Dark</option>
    </select>
  </label>`;
}

function applyAccent(company) {
  const root = document.documentElement.style;
  if (company) {
    root.setProperty('--accent-l', company.accentLight);
    root.setProperty('--accent-d', company.accentDark);
  } else {
    root.removeProperty('--accent-l');
    root.removeProperty('--accent-d');
  }
}

/* ───────────────────────── Feedback ───────────────────────── */

function announce(msg) {
  const el = $('#announcer');
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = msg; });
}

function toast(title, body = '', tone = 'good', timeout = 5000) {
  const el = document.createElement('div');
  el.className = `toast ${tone}`;
  el.innerHTML = html`<span class="t-icon">${icon(tone === 'bad' ? 'alert' : tone === 'info' ? 'zap' : 'checkCircle', 16)}</span>
    <div class="t-body"><strong>${title}</strong>${body ? html`<span>${body}</span>` : ''}</div>
    <button class="btn ghost icon sm" type="button" aria-label="Dismiss notification">${icon('x', 14)}</button>`.s;
  const remove = () => el.remove();
  el.querySelector('button').addEventListener('click', remove);
  $('#toasts').append(el);
  let timer = setTimeout(remove, timeout);
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', () => { timer = setTimeout(remove, 2500); });
}

function setBusy(btn, busy, busyLabel) {
  if (!btn) return;
  if (busy) {
    if (btn.dataset.label == null) btn.dataset.label = btn.innerHTML;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = html`<span class="spinner" aria-hidden="true"></span>${busyLabel || btn.textContent.trim()}`.s;
  } else if (btn.dataset.label != null) {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.innerHTML = btn.dataset.label;
    delete btn.dataset.label;
  }
}

// Keep a spinner up for at least a beat so fast responses don't flicker.
const minDelay = (p, ms = 350) => Promise.all([p, new Promise((r) => setTimeout(r, ms))]).then(([v]) => v);

/* ───────────────────────── Dialogs ───────────────────────── */

function openDialog({ title, description, body, foot, wide = false, onSubmit, onOpen, onClose }) {
  const dlg = document.createElement('dialog');
  dlg.className = `modal${wide ? ' wide' : ''}`;
  const titleId = `dlg-${Math.random().toString(36).slice(2)}`;
  dlg.setAttribute('aria-labelledby', titleId);
  dlg.innerHTML = html`<form novalidate>
    <div class="modal-head"><h2 id="${titleId}">${title}</h2>${description ? html`<p>${description}</p>` : ''}</div>
    <div class="modal-body"><div class="form-error" data-form-error hidden role="alert"></div>${body}</div>
    <div class="modal-foot">${foot ?? html`<button class="btn" type="button" data-close>Close</button>`}</div>
  </form>`.s;
  document.body.append(dlg);
  const form = dlg.querySelector('form');
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) dlg.close();
    else if (e.target === dlg) {
      // Click on the backdrop closes, but not drags that started inside.
      const r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
    }
  });
  dlg.addEventListener('close', () => { onClose?.(); dlg.remove(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!onSubmit) return;
    clearErrors(form);
    const btn = e.submitter || form.querySelector('[type="submit"]');
    setBusy(btn, true);
    try {
      const close = await onSubmit(form, dlg, btn);
      if (close !== false) dlg.close();
    } catch (err) {
      showError(form, err);
    } finally {
      if (dlg.open) setBusy(btn, false);
    }
  });
  dlg.showModal();
  onOpen?.(dlg, form);
  return dlg;
}

function clearErrors(form) {
  $$('[aria-invalid="true"]', form).forEach((el) => { el.removeAttribute('aria-invalid'); el.removeAttribute('aria-describedby'); });
  $$('.field .error', form).forEach((el) => el.remove());
  const fe = $('[data-form-error]', form);
  if (fe) { fe.hidden = true; fe.textContent = ''; }
}

function showError(form, err) {
  const msg = err?.message || 'Something went wrong.';
  const input = err?.field && (form.querySelector(`[name="${err.field}"]`) || form.querySelector(`[data-field="${err.field}"]`));
  if (input) {
    const id = `${input.name || err.field}-error`;
    const el = document.createElement('p');
    el.className = 'error';
    el.id = id;
    el.innerHTML = html`${icon('alert', 14)}<span>${msg}</span>`.s;
    input.closest('.field').append(el);
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', id);
    input.focus();
    return;
  }
  const fe = $('[data-form-error]', form);
  if (fe) {
    fe.innerHTML = html`${icon('alert', 15)}<span>${msg}</span>`.s;
    fe.hidden = false;
  } else {
    toast('Couldn’t complete that', msg, 'bad');
  }
}

function confirmDialog({ title, description, confirmLabel, danger = true }) {
  return new Promise((resolve) => {
    let ok = false;
    openDialog({
      title, description, body: '',
      foot: html`<button class="btn" type="button" data-close>Cancel</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" type="submit">${confirmLabel}</button>`,
      onSubmit: async () => { ok = true; },
      onClose: () => resolve(ok),
    });
  });
}

/* ───────────────────────── Job helpers ───────────────────────── */

const STATUS = {
  queued: { tone: 'info', icon: 'clock', label: 'Queued' },
  running: { tone: 'accent', icon: 'play', label: 'Running' },
  succeeded: { tone: 'good', icon: 'check', label: 'Succeeded' },
  failed: { tone: 'bad', icon: 'alert', label: 'Failed' },
};
const statusBadge = (s) => { const x = STATUS[s] || STATUS.queued; return html`<span class="badge ${x.tone}">${icon(x.icon, 12)}${x.label}</span>`; };
const kindLabel = (type) => state.me?.allKinds.find((k) => k.type === type)?.label || type;

// Poll a job until it finishes. Resolves with the final job row.
async function watchJob(id, timeout = 20000) {
  const until = Date.now() + timeout;
  let delay = 150;
  while (Date.now() < until) {
    const job = await api('GET', `/api/jobs/${id}`);
    if (job.status === 'succeeded' || job.status === 'failed') return job;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 800);
  }
  throw new ApiError('The job is still running. Check the Jobs page for its result.', 0);
}

function jobDialog(id) {
  const dlg = openDialog({
    title: `Job #${id}`,
    wide: true,
    body: html`<div data-job-body style="display:grid;gap:18px"><div class="skeleton" style="height:180px"></div></div>`,
    foot: html`<span class="left" data-job-extra></span><button class="btn" type="button" data-close>Close</button>`,
    onClose: () => {
      const u = new URL(location.href);
      if (u.searchParams.has('job')) { u.searchParams.delete('job'); history.replaceState(history.state, '', u); }
    },
  });
  const load = async () => {
    try {
      const j = await api('GET', `/api/jobs/${id}`);
      if (!dlg.open) return;
      $('[data-job-body]', dlg).innerHTML = html`
        <dl class="kv">
          <dt>Status</dt><dd>${statusBadge(j.status)}</dd>
          <dt>Type</dt><dd><span class="mono">${j.type}</span> <span class="muted">· ${kindLabel(j.type)}</span></dd>
          <dt>Attempts</dt><dd>${j.attempts} of 3</dd>
          <dt>Worker</dt><dd>${j.worker ? html`<span class="mono">${j.worker}</span> ${j.stolen ? html`<span class="tag accent">stolen</span>` : ''}` : '—'}</dd>
          <dt>Queue wait</dt><dd>${fmtMs(j.queueMs)}</dd>
          <dt>Run time</dt><dd>${fmtMs(j.durationMs)}</dd>
          <dt>Enqueued</dt><dd>${dateTimeFmt.format(new Date(j.enqueuedAt))}</dd>
          <dt>Finished</dt><dd>${j.finishedAt ? dateTimeFmt.format(new Date(j.finishedAt)) : '—'}</dd>
          <dt>Submitted by</dt><dd>${j.submittedBy || (j.runId ? 'Load test' : 'Platform traffic')}</dd>
          ${j.error ? html`<dt>Last error</dt><dd style="color:var(--bad)">${j.error}</dd>` : ''}
        </dl>
        <div class="row-2">
          <div><p class="code-label">Payload</p><pre class="json">${JSON.stringify(j.payload, null, 2)}</pre></div>
          <div><p class="code-label">Result</p><pre class="json">${j.result ? JSON.stringify(j.result, null, 2) : j.status === 'failed' ? 'No result — the job failed.' : 'Not finished yet.'}</pre></div>
        </div>`.s;
      const extra = $('[data-job-extra]', dlg);
      if (j.status === 'failed' && isManager()) {
        extra.innerHTML = html`<button class="btn" type="button" data-retry>${icon('refresh', 14)}Retry job</button>`.s;
        $('[data-retry]', dlg).addEventListener('click', async (e) => {
          setBusy(e.currentTarget, true, 'Retrying…');
          try {
            await minDelay(api('POST', `/api/jobs/${id}/retry`));
            toast(`Job #${id} queued again`, 'It’ll run with a fresh retry budget.');
            await watchJob(id).catch(() => {});
            load();
          } catch (err) { toast('Retry failed', err.message, 'bad'); setBusy(e.currentTarget, false); }
        });
      } else extra.innerHTML = '';
      if (j.status === 'queued' || j.status === 'running') setTimeout(() => dlg.open && load(), 700);
    } catch (err) {
      if (dlg.open) $('[data-job-body]', dlg).innerHTML = html`<div class="form-error">${icon('alert', 15)}<span>${err.message}</span></div>`.s;
    }
  };
  load();
}

function newJobDialog(defaultType, onQueued) {
  const kinds = state.me.jobKinds;
  const type = defaultType || kinds[0].type;
  const refHint = { 'label.print': 'Tracking number', 'pod.upload': 'Tracking number', 'invoice.sync': 'Invoice number' };
  openDialog({
    title: 'Run a job',
    description: 'The job is queued on Redis Streams and picked up by the next free worker.',
    body: html`
      <div class="field"><label for="nj-type">Job type</label>
        <select class="select" id="nj-type" name="type">
          ${kinds.map((k) => html`<option value="${k.type}" ${k.type === type ? raw('selected') : ''}>${k.label}</option>`)}
        </select>
        <p class="hint" data-kind-desc>${kinds.find((k) => k.type === type)?.description}</p>
      </div>
      <div class="field"><label for="nj-ref" data-ref-label>${refHint[type] || 'Route'} <span class="subtle">(optional)</span></label>
        <input class="input" id="nj-ref" name="reference" autocomplete="off" spellcheck="false" maxlength="40" placeholder="Leave blank to generate one…">
      </div>`,
    foot: html`<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Queue job</button>`,
    onOpen: (dlg, form) => {
      form.type.addEventListener('change', () => {
        const k = kinds.find((x) => x.type === form.type.value);
        $('[data-kind-desc]', dlg).textContent = k.description;
        $('[data-ref-label]', dlg).firstChild.textContent = `${refHint[k.type] || 'Route'} `;
      });
      form.reference.focus();
    },
    onSubmit: async (form) => {
      const t = form.type.value;
      const { jobId } = await api('POST', '/api/jobs', { type: t, reference: form.reference.value.trim() });
      toast(`${kindLabel(t)} queued`, `Job #${jobId}. You’ll see the result here when it finishes.`, 'info');
      onQueued?.(jobId);
      watchJob(jobId).then((j) => {
        if (j.status === 'succeeded') toast(`Job #${jobId} succeeded`, `${kindLabel(t)} · waited ${fmtMs(j.queueMs)}, ran ${fmtMs(j.durationMs)}`);
        else toast(`Job #${jobId} failed`, j.error || 'See the job for details.', 'bad');
        onQueued?.(jobId);
      }).catch(() => {});
    },
  });
}

/* ───────────────────────── Live stream ───────────────────────── */

function openStream() {
  if (state.stream) return;
  const es = new EventSource('/api/stream');
  es.onmessage = (e) => {
    const d = JSON.parse(e.data);
    state.lastStream = d;
    $$('[data-live]').forEach((el) => el.classList.remove('off'));
    state.streamListeners.forEach((fn) => fn(d));
  };
  es.onerror = () => { $$('[data-live]').forEach((el) => el.classList.add('off')); };
  state.stream = es;
}
function closeStream() { state.stream?.close(); state.stream = null; state.lastStream = null; }
function onStream(fn) { state.streamListeners.add(fn); return () => state.streamListeners.delete(fn); }

/* ───────────────────────── Router ───────────────────────── */

const ROUTES = {
  '/login': { page: loginPage, public: true },
  '/overview': { page: () => (isManager() ? runtimePage() : myDayPage()) },
  '/jobs': { page: jobsPage },
  '/docks': { page: docksPage },
  '/shifts': { page: shiftsPage },
};

function navigate(url, { replace = false } = {}) {
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
  route();
}

async function route() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return navigate('/overview', { replace: true });
  const r = ROUTES[path];
  if (!state.me && !r?.public) {
    try {
      await loadMe();
    } catch {
      const next = path === '/overview' || !r ? '' : `?next=${encodeURIComponent(location.pathname + location.search)}`;
      return navigate(`/login${next}`, { replace: true });
    }
  }
  if (state.me && path === '/login') return navigate('/overview', { replace: true });
  state.cleanup?.();
  state.cleanup = null;
  $('#app').removeAttribute('aria-busy');
  if (!r) return notFound();
  if (!r.public) renderShell(path);
  state.cleanup = r.page() || null;
}

async function loadMe() {
  state.me = await api('GET', '/api/me');
  applyAccent(state.me.company);
  openStream();
}

function signedOut() {
  state.me = null;
  closeStream();
  applyAccent(null);
  $('#app').innerHTML = '';
  navigate('/login', { replace: true });
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (a.target || a.hasAttribute('download') || a.origin !== location.origin || a.dataset.external != null) return;
  e.preventDefault();
  const same = a.pathname === location.pathname;
  navigate(a.pathname + a.search, { replace: same && a.dataset.replace != null });
  if (!same) window.scrollTo(0, 0);
});
window.addEventListener('popstate', route);
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-theme-select]')) applyTheme(e.target.value);
});

function setTitle(t) { document.title = state.me ? `${t} · ${state.me.company.name} · Relay` : `${t} · Relay`; }
const mainEl = () => $('#main');

function notFound() {
  setTitle('Not found');
  const target = state.me ? mainEl() : $('#app');
  if (state.me && !mainEl()) renderShell('');
  (state.me ? mainEl() : target).innerHTML = html`<div class="page"><div class="card empty">
    <div class="icon">${icon('inbox', 20)}</div><strong>This page doesn’t exist</strong>
    <p>Check the address, or head back to your overview.</p>
    <a class="btn" href="/overview">Go to overview</a></div></div>`.s;
}

/* ───────────────────────── Shell ───────────────────────── */

function renderShell(path) {
  const { user, company } = state.me;
  const nav = [
    ['/overview', isManager() ? 'Runtime' : 'My day', isManager() ? 'activity' : 'sun'],
    ['/jobs', isManager() ? 'Jobs' : 'My jobs', 'list'],
    ['/docks', 'Dock schedule', 'dock'],
    ['/shifts', 'Shifts', 'calendar'],
  ];
  if (!$('.shell')) {
    $('#app').innerHTML = html`<div class="shell">
      <header class="topbar">
        <button class="btn ghost icon" type="button" data-nav-toggle aria-label="Open navigation" aria-expanded="false" aria-controls="sidebar">${icon('menu', 18)}</button>
        <span class="org-mark" aria-hidden="true">${company.initials}</span><strong>${company.name}</strong>
      </header>
      <nav id="sidebar" class="sidebar" aria-label="Primary">
        <div class="org"><span class="org-mark" aria-hidden="true">${company.initials}</span>
          <div class="org-name"><strong>${company.name}</strong><span>${company.hub}</span></div></div>
        <div class="nav-label">Workspace</div>
        <div class="nav">${nav.map(([href, label, ic]) => html`<a href="${href}">${icon(ic, 16)}<span>${label}</span></a>`)}</div>
        <div class="sidebar-foot">
          <div class="me"><span class="avatar accent" aria-hidden="true">${initials(user.name)}</span>
            <div class="who"><strong>${user.name}</strong><span>${user.title} · ${user.role === 'manager' ? 'Manager' : 'Employee'}</span></div></div>
          <div class="foot-row">${themePicker('theme-app')}
            <button class="btn ghost sm" type="button" data-logout>${icon('logout', 14)}Sign out</button></div>
        </div>
      </nav>
      <main id="main" tabindex="-1"></main>
    </div>`.s;
    const shell = $('.shell');
    const toggle = $('[data-nav-toggle]');
    const setOpen = (open) => {
      shell.classList.toggle('nav-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
      $('.scrim')?.remove();
      if (open) {
        const scrim = document.createElement('button');
        scrim.className = 'scrim';
        scrim.type = 'button';
        scrim.setAttribute('aria-label', 'Close navigation');
        scrim.addEventListener('click', () => setOpen(false));
        shell.append(scrim);
        $('.nav a', shell).focus();
      }
    };
    toggle.addEventListener('click', () => setOpen(!shell.classList.contains('nav-open')));
    $('#sidebar').addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && shell.classList.contains('nav-open')) { setOpen(false); toggle.focus(); } });
    $('[data-logout]').addEventListener('click', async (e) => {
      setBusy(e.currentTarget, true, 'Signing out…');
      try { await api('POST', '/api/logout'); } catch { /* signing out anyway */ }
      signedOut();
    });
  }
  $$('.nav a').forEach((a) => {
    if (a.getAttribute('href') === path) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

/* ───────────────────────── Login ───────────────────────── */

function loginPage() {
  setTitle('Sign in');
  applyAccent(null);
  $('#app').innerHTML = html`<div class="login">
    <section class="login-panel">
      <div class="login-top">${themePicker('theme-login')}</div>
      <main class="login-form-wrap" id="main" tabindex="-1">
        <div class="wordmark"><span class="mark">${raw('<svg width="16" height="16" viewBox="0 0 32 32" aria-hidden="true"><path d="M9 22V10h7a4 4 0 0 1 0 8h-7m7 0 5 4" stroke="white" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>')}</span>Relay</div>
        <div class="login-intro"><h2>Sign in to Relay</h2>
          <p class="muted">Use your work account, or pick one of the demo accounts below.</p></div>
        <form class="login-form" novalidate>
          <div class="form-error" data-form-error hidden role="alert"></div>
          <div class="field"><label for="email">Work email</label>
            <input class="input" id="email" name="email" type="email" autocomplete="username" inputmode="email"
              spellcheck="false" autocapitalize="off" placeholder="name@company.example" required></div>
          <div class="field"><label for="password">Password</label>
            <input class="input" id="password" name="password" type="password" autocomplete="current-password" required></div>
          <button class="btn primary" type="submit">Sign in</button>
        </form>
        <div class="divider" role="presentation">DEMO ACCOUNTS</div>
        <div class="demo-list" data-demos aria-busy="true">
          ${[0, 1, 2].map(() => html`<div class="skeleton" style="height:118px;border-radius:12px"></div>`)}
        </div>
        <p class="login-foot">Each company has its own accent colour. Every demo account uses the password <code>relay-demo</code>.</p>
      </main>
    </section>
  </div>`.s;

  const form = $('.login-form');
  const params = new URLSearchParams(location.search);
  if (matchMedia('(pointer: fine)').matches) form.email.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const btn = form.dataset.demo ? null : form.querySelector('[type="submit"]');
    delete form.dataset.demo;
    const email = form.email.value.trim();
    if (!email) return showError(form, { field: 'email', message: 'Enter your work email.' });
    if (!form.password.value) return showError(form, { field: 'password', message: 'Enter your password.' });
    setBusy(btn, true, 'Signing in…');
    try {
      await api('POST', '/api/login', { email, password: form.password.value });
      await loadMe();
      const next = params.get('next');
      $('#app').innerHTML = '';
      navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/overview', { replace: true });
    } catch (err) {
      setBusy(btn, false);
      $$('.demo-btn[aria-busy]').forEach((b) => setBusy(b, false));
      showError(form, err);
    }
  });

  api('GET', '/api/demo-accounts').then(({ accounts, password }) => {
    const byCompany = new Map();
    accounts.forEach((a) => {
      if (!byCompany.has(a.company.id)) byCompany.set(a.company.id, { company: a.company, people: [] });
      byCompany.get(a.company.id).people.push(a);
    });
    const list = $('[data-demos]');
    if (!list) return;
    list.removeAttribute('aria-busy');
    list.innerHTML = html`${[...byCompany.values()].map(({ company: c, people }) => html`
      <section class="demo-company" style="--c-l:${c.accentLight};--c-d:${c.accentDark}" aria-label="${c.name} demo accounts">
        <header><span class="org-mark" aria-hidden="true">${c.initials}</span>
          <div class="meta"><strong>${c.name}</strong><span>${c.hub}</span></div>
          <span class="swatch"><i aria-hidden="true"></i><span class="sr-only">Accent colour</span><span class="hex-l">${c.accentLight}</span><span class="hex-d">${c.accentDark}</span></span></header>
        <div class="demo-roles">${people.map((p) => html`
          <button class="demo-btn" type="button" data-email="${p.email}">
            <span class="role">${icon(p.role === 'manager' ? 'layers' : 'user', 12)}${p.role === 'manager' ? 'Manager' : 'Employee'}</span>
            <span class="who">${p.name}</span><span class="email">${p.email}</span>
          </button>`)}</div>
      </section>`)}`.s;
    list.addEventListener('click', (e) => {
      const b = e.target.closest('.demo-btn');
      if (!b || b.disabled) return;
      form.email.value = b.dataset.email;
      form.password.value = password;
      setBusy(b, true, 'Signing in…');
      form.dataset.demo = '1';
      form.requestSubmit();
    });
  }).catch((err) => {
    const list = $('[data-demos]');
    if (list) list.innerHTML = html`<div class="form-error">${icon('alert', 15)}<span>${err.message}</span></div>`.s;
  });
}

/* ───────────────────────── Chart ───────────────────────── */

// A single-series line/area chart over a fixed time window with a
// crosshair tooltip, keyboard scrubbing, and dashed event markers.
class TimeChart {
  constructor(el, { value, format, label, windowMs = 300_000, empty }) {
    Object.assign(this, { el, value, format, label, windowMs, empty });
    this.points = [];
    this.markers = [];
    this.hover = null;
    el.classList.add('chart');
    el.tabIndex = 0;
    el.setAttribute('role', 'img');
    el.innerHTML = html`<svg class="plot" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
        <g class="grid"></g><path class="area"></path><path class="line"></path></svg>
      <div class="y-labels" aria-hidden="true"></div><div class="x-labels" aria-hidden="true"></div>
      <div class="markers" aria-hidden="true"></div>
      <div class="cursor" aria-hidden="true"></div><div class="dot" aria-hidden="true"></div>
      <div class="tip" aria-hidden="true"></div><div class="chart-empty" hidden></div>`.s;
    el.addEventListener('pointermove', (e) => this.pointer(e));
    el.addEventListener('pointerleave', () => this.setHover(null));
    el.addEventListener('blur', () => this.setHover(null));
    el.addEventListener('keydown', (e) => this.key(e));
  }
  set(points, markers = this.markers) { this.points = points; this.markers = markers; this.render(); }
  config(opts) { Object.assign(this, opts); this.render(); }
  domain() {
    const t1 = this.points.at(-1)?.t ?? Date.now();
    return [t1 - this.windowMs, t1];
  }
  render() {
    const [t0, t1] = this.domain();
    const pts = this.points.filter((p) => p.t >= t0);
    const vals = pts.map(this.value).filter((v) => v != null);
    const maxV = Math.max(...vals, 0);
    const yMax = niceMax(maxV * 1.15 || 1);
    this.scale = { t0, t1, yMax };
    const X = (t) => ((t - t0) / (t1 - t0)) * 1000;
    const Y = (v) => 100 - (v / yMax) * 100;

    // Break the line wherever a sample has no value.
    let line = '', area = '', seg = [];
    const flush = () => {
      if (!seg.length) return;
      line += seg.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(2)},${Y(this.value(p)).toFixed(2)}`).join('');
      area += `M${X(seg[0].t).toFixed(2)},100` + seg.map((p) => `L${X(p.t).toFixed(2)},${Y(this.value(p)).toFixed(2)}`).join('') + `L${X(seg.at(-1).t).toFixed(2)},100Z`;
      seg = [];
    };
    pts.forEach((p) => { if (this.value(p) == null) flush(); else seg.push(p); });
    flush();
    $('.line', this.el).setAttribute('d', line);
    $('.area', this.el).setAttribute('d', area);

    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
    $('.grid', this.el).innerHTML = ticks.map((v) => `<line x1="0" x2="1000" y1="${Y(v)}" y2="${Y(v)}"/>`).join('');
    $('.y-labels', this.el).innerHTML = ticks.map((v) => `<span style="top:${Y(v)}%">${esc(this.format(v, true))}</span>`).join('');
    const mins = this.windowMs / 60000;
    $('.x-labels', this.el).innerHTML = Array.from({ length: mins + 1 }, (_, i) => {
      const ago = mins - i;
      return `<span style="left:${(i / mins) * 100}%">${ago ? `−${ago}${NBSP}min` : 'now'}</span>`;
    }).join('');
    const shown = this.markers.filter((m) => m.t > t0 && m.t <= t1).map((m) => ({ ...m, left: X(m.t) / 10 }));
    $('.markers', this.el).innerHTML = shown.map((m, i) => {
      // Only the latest of markers that sit close together keeps its label.
      const crowded = shown[i + 1] && shown[i + 1].left - m.left < 16;
      return `<div class="marker${m.left > 70 ? ' flip' : ''}" style="left:${m.left}%">${crowded ? '' : `<span>${esc(m.label)}</span>`}</div>`;
    }).join('');

    const empty = $('.chart-empty', this.el);
    empty.hidden = vals.length > 0;
    empty.textContent = this.empty || 'Waiting for data…';
    const latest = [...pts].reverse().find((p) => this.value(p) != null);
    this.el.setAttribute('aria-label', `${this.label} over the last ${mins} minutes. ${latest ? `Latest ${this.format(this.value(latest))}, peak ${this.format(maxV)}.` : 'No data yet.'} Use the arrow keys to read individual samples.`);
    this.visible = pts;
    if (this.hover != null) this.setHover(this.hover);
  }
  pointer(e) {
    const r = this.el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const t = this.scale.t0 + f * (this.scale.t1 - this.scale.t0);
    let best = null, bestD = Infinity;
    this.visible.forEach((p, i) => { const d = Math.abs(p.t - t); if (d < bestD && this.value(p) != null) { best = i; bestD = d; } });
    this.setHover(best == null ? null : this.visible[best].t);
  }
  key(e) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(e.key)) return;
    e.preventDefault();
    const withVal = this.visible.filter((p) => this.value(p) != null);
    if (!withVal.length) return;
    if (e.key === 'Escape') return this.setHover(null);
    let i = this.hover == null ? withVal.length - 1 : withVal.findIndex((p) => p.t === this.hover);
    if (e.key === 'ArrowLeft') i = Math.max(0, i - 1);
    if (e.key === 'ArrowRight') i = Math.min(withVal.length - 1, i + 1);
    if (e.key === 'Home') i = 0;
    if (e.key === 'End') i = withVal.length - 1;
    this.setHover(withVal[i].t);
    announce(`${timeSecFmt.format(new Date(withVal[i].t))}: ${this.format(this.value(withVal[i]))}`);
  }
  setHover(t) {
    this.hover = t;
    const p = t == null ? null : this.visible?.find((x) => x.t === t);
    this.el.classList.toggle('hovering', !!p && this.value(p) != null);
    if (!p || this.value(p) == null) return;
    const { t0, t1, yMax } = this.scale;
    const left = ((p.t - t0) / (t1 - t0)) * 100;
    const top = 100 - (this.value(p) / yMax) * 100;
    $('.cursor', this.el).style.left = `${left}%`;
    Object.assign($('.dot', this.el).style, { left: `${left}%`, top: `${top}%` });
    const tip = $('.tip', this.el);
    tip.innerHTML = `<b>${esc(this.format(this.value(p)))}</b><span>${esc(timeSecFmt.format(new Date(p.t)))}</span><span>${esc(p.mode === 'single-queue' ? 'Single-queue' : 'Work-stealing')} · ${esc(fmtRate(p.throughput))}/s</span>`;
    const w = this.el.clientWidth;
    const px = (left / 100) * w;
    tip.style.left = `${Math.min(Math.max(px + 12, 0), w - tip.offsetWidth - 4)}px`;
    if (px + 12 + tip.offsetWidth > w) tip.style.left = `${Math.max(0, px - tip.offsetWidth - 12)}px`;
  }
}
function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 8 ? 8 : 10) * p;
}

/* ───────────────────────── Runtime (manager overview) ───────────────────────── */

const MODE_LABEL = { 'work-stealing': 'Work-stealing', 'single-queue': 'Single-queue' };

function runtimePage() {
  setTitle('Runtime');
  const { company } = state.me;
  const metric = new URLSearchParams(location.search).get('metric') === 'throughput' ? 'throughput' : 'p95';
  mainEl().innerHTML = html`<div class="page">
    <div class="page-head">
      <div class="titles"><span class="eyebrow">${company.hub}</span><h1>Runtime</h1>
        <p>Jobs for ${company.name} run on a shared pool of work-stealing workers fed by Redis Streams. Latency is measured from enqueue to the moment a worker starts the job.</p></div>
      <div class="actions">
        <div class="segmented" aria-label="Scheduling mode" data-mode>
          <button type="button" data-set-mode="work-stealing">${icon('zap', 14)}Work-stealing</button>
          <button type="button" data-set-mode="single-queue">${icon('list', 14)}Single-queue</button>
        </div>
        <button class="btn primary" type="button" data-burst>${icon('layers', 15)}Run burst…</button>
      </div>
    </div>

    <div class="kpis">
      <div class="card kpi"><span class="k"><span class="live-dot off" data-live aria-hidden="true"></span>p95 queue latency</span>
        <span class="v" data-kpi="p95">—</span><span class="d" data-kpi-d="p95">Last 5 seconds</span></div>
      <div class="card kpi"><span class="k">Throughput</span>
        <span class="v" data-kpi="tput">—</span><span class="d">Jobs finished per second</span></div>
      <div class="card kpi"><span class="k">Backlog</span>
        <span class="v" data-kpi="queued">—</span><span class="d" data-kpi-d="queued">Jobs waiting in the stream</span></div>
      <div class="card kpi"><span class="k">Steals</span>
        <span class="v" data-kpi="steals">—</span><span class="d">Jobs reclaimed from stalled peers</span></div>
    </div>

    <div class="grid-2 runtime-row">
      <section class="card chart-card" aria-labelledby="chart-title">
        <div><div class="card-head">
          <div><h2 id="chart-title">${metric === 'p95' ? 'p95 queue latency' : 'Throughput'}</h2>
            <p class="sub">Last 5 minutes · dashed lines mark mode changes</p></div>
          <nav class="segmented" aria-label="Chart metric">
            <a href="?metric=p95" data-replace ${metric === 'p95' ? raw('aria-current="page"') : ''}>Latency</a>
            <a href="?metric=throughput" data-replace ${metric === 'throughput' ? raw('aria-current="page"') : ''}>Throughput</a>
          </nav>
        </div>
        <div class="chart-wrap"><div data-chart></div></div></div>
        <details class="samples"><summary class="muted" style="cursor:pointer;font-size:12.5px">Show recent samples as a table</summary>
          <div class="table-wrap" style="max-height:220px;margin-top:8px" data-chart-table></div></details>
      </section>
      <section class="card workers-card" aria-labelledby="workers-title">
        <div class="card-head"><div><h2 id="workers-title">Work-stealing workers</h2>
          <p class="sub">Share of the last second each worker spent running jobs</p></div></div>
        <div class="card-body"><div class="workers" data-workers>
          ${Array.from({ length: 8 }, () => html`<div class="skeleton" style="height:14px"></div>`)}</div>
          <div class="worker-meta" data-worker-meta></div></div>
      </section>
      <section class="card runs-card" aria-labelledby="runs-title">
        <div class="card-head"><div><h2 id="runs-title">Burst comparison</h2>
          <p class="sub">p95 queue latency of the latest burst in each mode</p></div></div>
        <div class="card-body" data-runs><div class="skeleton" style="height:120px"></div></div>
      </section>
      <div class="mix-slot"><section class="card mix-card" aria-labelledby="mix-title">
        <div class="card-head"><div><h2 id="mix-title">Job mix</h2><p class="sub">Operational traffic, last 15 minutes</p></div>
          <a class="btn sm" href="/jobs">View jobs</a></div>
        <div class="table-wrap" data-mix style="padding-top:8px"><div class="card-body"><div class="skeleton" style="height:160px"></div></div></div>
      </section></div>
    </div>
  </div>`.s;

  let series = [], changes = [], runs = [], active = [], mode = null;
  const chart = new TimeChart($('[data-chart]'), metric === 'p95'
    ? { value: (p) => p.p95, format: (v, axis) => axis ? (v >= 1000 ? `${nf1.format(v / 1000)}s` : `${nf1.format(v)}ms`) : fmtMs(v), label: 'p95 queue latency', empty: 'No jobs finished in this window.' }
    : { value: (p) => p.throughput, format: (v, axis) => axis ? fmtRate(v) : `${fmtRate(v)} jobs/s`, label: 'Throughput', empty: 'No jobs finished in this window.' });
  const markers = () => changes.slice(1).map((c) => ({ t: new Date(c.at).getTime(), label: `→ ${MODE_LABEL[c.mode]}` }));

  const renderMode = () => {
    $$('[data-set-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setMode === mode)));
    $('#workers-title').textContent = mode === 'single-queue' ? 'Worker pool (single queue)' : 'Work-stealing workers';
  };

  const renderKpis = (p) => {
    if (!p) return;
    const [v, u] = msParts(p.p95);
    $('[data-kpi="p95"]').innerHTML = p.p95 == null ? '—' : html`${v}<small>${u}</small>`.s;
    $('[data-kpi="tput"]').innerHTML = html`${fmtRate(p.throughput)}<small>/s</small>`.s;
    $('[data-kpi="queued"]').textContent = nf.format(p.queued);
    const baseline = runs.find((r) => r.mode === 'single-queue');
    const latest = runs.find((r) => r.mode === 'work-stealing');
    const d = $('[data-kpi-d="p95"]');
    if (baseline && latest && latest.p95 < baseline.p95) {
      d.className = 'd good';
      d.textContent = `Burst ${fmtMs(latest.p95)}, from ${fmtMs(baseline.p95)} single-queue`;
    } else {
      d.className = 'd';
      d.textContent = `Last 5 seconds · ${MODE_LABEL[p.mode]}`;
    }
  };

  const renderTable = () => {
    const rows = series.slice(-30).reverse();
    $('[data-chart-table]').innerHTML = html`<table class="data"><thead><tr><th>Time</th><th class="r">p50</th><th class="r">p95</th><th class="r">Jobs/s</th><th class="r">Backlog</th><th>Mode</th></tr></thead>
      <tbody>${rows.map((p) => html`<tr><td class="num">${timeSecFmt.format(new Date(p.t))}</td><td class="r">${fmtMs(p.p50)}</td><td class="r">${fmtMs(p.p95)}</td>
        <td class="r">${fmtRate(p.throughput)}</td><td class="r">${nf.format(p.queued)}</td><td>${MODE_LABEL[p.mode]}</td></tr>`)}</tbody></table>`.s;
  };

  const renderWorkers = (ws) => {
    if (!ws?.length) return;
    const box = $('[data-workers]');
    if (box.children.length !== ws.length || !box.querySelector('.worker')) {
      box.innerHTML = html`${ws.map((w) => html`<div class="worker" data-w="${w.id}">
        <span class="id">${w.id}</span>
        <span class="bar" role="meter" aria-label="${w.id} utilisation" aria-valuemin="0" aria-valuemax="100"><i style="transform:scaleX(0)"></i></span>
        <span class="pct">0%</span></div>`)}`.s;
    }
    ws.forEach((w) => {
      const row = box.querySelector(`[data-w="${w.id}"]`);
      const pct = Math.round(w.utilization * 100);
      row.querySelector('i').style.transform = `scaleX(${w.utilization})`;
      row.querySelector('.bar').setAttribute('aria-valuenow', pct);
      row.querySelector('.pct').textContent = `${pct}%`;
      row.title = `${w.id}: ${nf.format(w.processed)} jobs run, ${nf.format(w.steals)} stolen, ${w.local} prefetched`;
    });
    const steals = ws.reduce((a, w) => a + w.steals, 0);
    const processed = ws.reduce((a, w) => a + w.processed, 0);
    const local = ws.reduce((a, w) => a + w.local, 0);
    $('[data-kpi="steals"]').textContent = nf.format(steals);
    $('[data-worker-meta]').innerHTML = html`<span>${nf.format(processed)} jobs since start</span><span>${nf.format(local)} prefetched in local deques</span>`.s;
  };

  const renderRuns = () => {
    const box = $('[data-runs]');
    const ws = runs.find((r) => r.mode === 'work-stealing');
    const sq = runs.find((r) => r.mode === 'single-queue');
    const max = Math.max(ws?.p95 || 0, sq?.p95 || 0) || 1;
    const row = (r, cls, name) => html`<div class="compare-row ${cls}">
      <span class="name">${name}</span>
      <span class="track"><i style="width:${r ? (r.p95 / max) * 100 : 0}%"></i></span>
      <span class="val">${r ? fmtMs(r.p95) : '—'}</span></div>`;
    box.innerHTML = html`
      ${active.map((a) => html`<div style="display:grid;gap:6px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;font-size:12.5px"><span><span class="spinner" aria-hidden="true" style="width:10px;height:10px;margin-right:6px"></span>Burst draining · ${MODE_LABEL[a.mode]}</span>
          <span class="num muted">${nf.format(a.done)} / ${nf.format(a.total)}</span></div>
        <div class="progress" role="progressbar" aria-label="Burst progress" aria-valuemin="0" aria-valuemax="${a.total}" aria-valuenow="${a.done}"><i style="transform:scaleX(${a.done / a.total})"></i></div></div>`)}
      ${!ws && !sq && !active.length ? html`<div class="empty" style="padding:20px 8px">
          <div class="icon">${icon('layers', 18)}</div><strong>No bursts yet</strong>
          <p>Run a burst in each mode to compare p95 latency under the same load.</p>
          <button class="btn sm" type="button" data-burst>Run burst…</button></div>`
        : html`<div class="compare" role="list">
          <div role="listitem">${row(sq, 'sq', 'Single-queue')}</div>
          <div role="listitem">${row(ws, 'ws', 'Work-stealing')}</div>
          <p class="compare-note">${ws && sq
            ? (ws.p95 < sq.p95 ? `Work-stealing p95 is ${nf1.format(sq.p95 / ws.p95)}× lower (${nf.format(ws.jobs)} vs ${nf.format(sq.jobs)} jobs).` : 'Work-stealing isn’t ahead in the latest pair — try a larger burst.')
            : `Run a burst in ${ws ? 'single-queue' : 'work-stealing'} mode to complete the comparison.`}</p></div>`}
      ${runs.length ? html`<div class="table-wrap" style="margin:14px -16px -16px;border-top:1px solid var(--border)"><table class="data">
        <thead><tr><th>Mode</th><th class="r">Jobs</th><th class="r">p50</th><th class="r">p95</th><th class="r">p99</th><th class="r">Jobs/s</th><th>When</th></tr></thead>
        <tbody>${runs.map((r) => html`<tr><td><span class="badge ${r.mode === 'work-stealing' ? 'accent' : ''}">${MODE_LABEL[r.mode]}</span></td>
          <td class="r">${nf.format(r.jobs)}</td><td class="r">${fmtMs(r.p50)}</td><td class="r"><strong>${fmtMs(r.p95)}</strong></td><td class="r">${fmtMs(r.p99)}</td>
          <td class="r">${fmtRate(r.throughput)}</td><td class="muted" title="${dateTimeFmt.format(new Date(r.finishedAt))}">${relTime(r.finishedAt)}</td></tr>`)}</tbody></table></div>` : ''}`.s;
  };

  const renderMix = (types) => {
    $('[data-mix]').innerHTML = types?.length ? html`<table class="data"><thead><tr><th>Type</th><th class="r">Jobs</th><th class="r">Avg run</th><th class="r">Failed</th><th class="r">Stolen</th></tr></thead>
      <tbody>${types.map((t) => html`<tr class="clickable" data-href="/jobs?type=${encodeURIComponent(t.type)}">
        <td><span style="display:inline-flex;gap:8px;align-items:center">${icon(JOB_ICONS[t.type] || 'zap', 14)}<a class="rowlink" href="/jobs?type=${encodeURIComponent(t.type)}">${t.type}</a></span></td>
        <td class="r">${nf.format(t.total)}</td><td class="r">${fmtMs(t.avgMs)}</td>
        <td class="r">${t.failed ? html`<span style="color:var(--bad)">${nf.format(t.failed)}</span>` : '0'}</td><td class="r">${nf.format(t.stolen)}</td></tr>`)}</tbody></table>`.s
      : html`<div class="empty"><div class="icon">${icon('inbox', 18)}</div><strong>No jobs in the last 15 minutes</strong><p>Operational jobs show up here as they run.</p></div>`.s;
  };

  const load = async () => {
    const d = await api('GET', '/api/runtime');
    series = d.history || []; changes = d.changes || []; runs = d.runs || []; active = d.activeRuns || []; mode = d.mode;
    renderMode(); chart.set(series, markers()); renderKpis(series.at(-1)); renderWorkers(d.workerStats); renderRuns(); renderMix(d.types); renderTable();
  };
  const refreshSide = async () => {
    const d = await api('GET', '/api/runtime');
    runs = d.runs || []; active = d.activeRuns || []; changes = d.changes || [];
    renderRuns(); renderMix(d.types); chart.set(series, markers());
  };
  load().catch((err) => toast('Couldn’t load the runtime', err.message, 'bad'));

  const off = onStream((d) => {
    if (d.point && d.point.t !== series.at(-1)?.t) {
      series.push(d.point);
      if (series.length > 300) series.shift();
      chart.set(series, markers());
      renderKpis(d.point);
      if ($('[data-chart-table]').closest('details').open) renderTable();
    }
    renderWorkers(d.workers);
    if (d.mode !== mode) { mode = d.mode; renderMode(); refreshSide(); }
    const before = active.map((a) => a.id).join();
    active = d.activeRuns || [];
    if (before !== active.map((a) => a.id).join()) {
      if (before && active.length < before.split(',').length) {
        refreshSide().then(() => {
          const r = runs[0];
          if (r) { toast('Burst finished', `${MODE_LABEL[r.mode]}: p95 ${fmtMs(r.p95)} across ${nf.format(r.jobs)} jobs`); announce(`Burst finished. p95 ${fmtMs(r.p95)}.`); }
        });
      } else renderRuns();
    } else if (active.length) renderRuns();
  });
  const mixTimer = setInterval(() => api('GET', '/api/runtime').then((d) => renderMix(d.types)).catch(() => {}), 15000);

  const root = mainEl();
  const onClick = async (e) => {
    const modeBtn = e.target.closest('[data-set-mode]');
    if (modeBtn && modeBtn.dataset.setMode !== mode) {
      const prev = mode;
      mode = modeBtn.dataset.setMode;
      renderMode();
      try {
        const r = await api('PUT', '/api/runtime/mode', { mode });
        changes = r.changes; chart.set(series, markers());
        toast(`Switched to ${MODE_LABEL[mode]}`, mode === 'single-queue'
          ? 'One poller now reads and claims every job before handing it to the pool.'
          : 'Each worker prefetches its own jobs and steals from stalled peers.', 'info');
      } catch (err) { mode = prev; renderMode(); toast('Couldn’t switch mode', err.message, 'bad'); }
    }
    if (e.target.closest('[data-burst]')) burstDialog(mode, () => refreshSide());
    const tr = e.target.closest('tr[data-href]');
    if (tr && !e.target.closest('a')) navigate(tr.dataset.href);
  };
  root.addEventListener('click', onClick);
  return () => { off(); clearInterval(mixTimer); root.removeEventListener('click', onClick); };
}

function burstDialog(mode, onStarted) {
  const sizes = [[2000, 'Quick check'], [5000, 'Shift change'], [12000, 'Dispatch wave'], [20000, 'Peak season']];
  openDialog({
    title: 'Run a burst',
    description: html`Enqueues a dispatch wave all at once — mostly ETA recomputes and labels, plus driver messages and route optimisations. It runs in the current mode: <strong>${MODE_LABEL[mode]}</strong>.`,
    body: html`<fieldset style="border:0;padding:0;margin:0;display:grid;gap:8px" data-field="jobs">
      <legend class="label" style="margin-bottom:8px">Burst size</legend>
      <div class="choice-grid">${sizes.map(([n, label]) => html`<label class="choice">
        <input type="radio" name="jobs" value="${n}" ${n === 12000 ? raw('checked') : ''}><strong>${nf.format(n)}</strong><span>${label}</span></label>`)}</div>
      <p class="hint muted" style="font-size:12.5px">Results are added to the burst comparison when every job has run.</p>
    </fieldset>`,
    foot: html`<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">${icon('layers', 14)}Start burst</button>`,
    onSubmit: async (form) => {
      const jobs = Number(new FormData(form).get('jobs'));
      await api('POST', '/api/runtime/burst', { jobs });
      toast('Burst started', `${nf.format(jobs)} jobs queued in ${MODE_LABEL[mode]} mode.`, 'info');
      onStarted?.();
    },
  });
}

/* ───────────────────────── My day (employee overview) ───────────────────────── */

function myDayPage() {
  setTitle('My day');
  const { user, company } = state.me;
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const quick = state.me.jobKinds.filter((k) => k.submit === 'all');
  mainEl().innerHTML = html`<div class="page">
    <div class="page-head"><div class="titles"><span class="eyebrow">${dateLong.format(now)}</span>
      <h1>${greeting}, ${user.name.split(' ')[0]}</h1><p>${user.title} at ${company.name} · ${company.hub}</p></div>
      <div class="actions"><span class="badge" data-runtime-pill><span class="live-dot off" data-live aria-hidden="true"></span>Runtime connecting…</span></div>
    </div>
    <div class="grid-2">
      <div style="display:grid;gap:16px;align-content:start">
        <section class="card" aria-labelledby="shift-title"><div class="card-head"><h2 id="shift-title">Today’s shift</h2><a class="btn sm" href="/shifts">Full schedule</a></div>
          <div data-shift><div class="card-body"><div class="skeleton" style="height:56px"></div></div></div></section>
        <section class="card" aria-labelledby="appts-title"><div class="card-head"><div><h2 id="appts-title">Your dock appointments</h2>
          <p class="sub">Assigned to you over the next few days. Checking in runs a job on the runtime.</p></div><a class="btn sm" href="/docks">Dock schedule</a></div>
          <div class="list" data-appts style="margin-top:8px"><div class="card-body"><div class="skeleton" style="height:120px"></div></div></div></section>
      </div>
      <div style="display:grid;gap:16px;align-content:start">
        <section class="card" aria-labelledby="quick-title"><div class="card-head"><h2 id="quick-title">Quick actions</h2></div>
          <div class="quick">${quick.map((k) => html`<button type="button" data-quick="${k.type}">
            <span class="ico">${icon(JOB_ICONS[k.type], 16)}</span><span><strong>${k.label}…</strong><span>${k.description}</span></span></button>`)}</div></section>
        <section class="card" aria-labelledby="recent-title"><div class="card-head"><h2 id="recent-title">Your recent jobs</h2><a class="btn sm" href="/jobs">View all</a></div>
          <div class="list" data-recent style="margin-top:8px"><div class="card-body"><div class="skeleton" style="height:120px"></div></div></div></section>
      </div>
    </div>
  </div>`.s;

  const day0 = startOfDay(now);
  const range = `from=${encodeURIComponent(day0.toISOString())}&to=${encodeURIComponent(addDays(day0, 3).toISOString())}`;

  const loadShift = async () => {
    const week0 = startOfWeek(now);
    const d = await api('GET', `/api/shifts?from=${encodeURIComponent(week0.toISOString())}&to=${encodeURIComponent(addDays(week0, 7).toISOString())}`);
    const mine = d.shifts.filter((s) => s.userId === user.id);
    const today = mine.find((s) => sameDay(new Date(s.startsAt), now));
    const next = mine.find((s) => new Date(s.startsAt) > now && !sameDay(new Date(s.startsAt), now));
    const hours = mine.reduce((a, s) => a + (new Date(s.endsAt) - new Date(s.startsAt)) / 3.6e6, 0);
    const box = $('[data-shift]');
    if (!box) return;
    box.innerHTML = today ? html`<div class="shift-hero">
        <div><div class="when">${fmtTime(today.startsAt)} – ${fmtTime(today.endsAt)}</div>
          <p class="muted">${today.position} · ${today.location}</p></div>
        <div style="margin-left:auto;display:grid;gap:6px;justify-items:end">
          ${new Date(today.startsAt) <= now && new Date(today.endsAt) > now ? html`<span class="badge good">${icon('play', 12)}On shift now</span>`
            : new Date(today.endsAt) <= now ? html`<span class="badge">${icon('check', 12)}Shift finished</span>` : html`<span class="badge info">${icon('clock', 12)}Starts ${relTime(today.startsAt)}</span>`}
          <span class="subtle num" style="font-size:12.5px">${nf1.format(hours)}${NBSP}h scheduled this week</span></div></div>`.s
      : html`<div class="empty" style="padding:24px"><strong>You’re not scheduled today</strong>
          <p>${next ? `Next shift: ${dateLong.format(new Date(next.startsAt))}, ${fmtTime(next.startsAt)} – ${fmtTime(next.endsAt)}.` : 'No more published shifts this week.'}</p></div>`.s;
  };

  const loadAppts = async () => {
    const d = await api('GET', `/api/docks?${range}`);
    const docks = new Map(d.docks.map((x) => [x.id, x.name]));
    const cutoff = Date.now() - 3600e3;
    const mine = d.appointments.filter((a) => a.assignedTo === user.id && (new Date(a.endsAt) > cutoff || a.status === 'checked_in')).slice(0, 6);
    const chip = (t) => sameDay(new Date(t), now) ? fmtTime(t) : `${weekdayShort.format(new Date(t))} ${fmtTime(t)}`;
    const box = $('[data-appts]');
    if (!box) return;
    box.innerHTML = mine.length ? html`${mine.map((a) => html`<div class="list-item">
        <span class="time-chip">${chip(a.startsAt)}</span>
        <div class="body"><strong>${a.carrier} · ${a.reference}</strong>
          <span>${docks.get(a.dockId)} · ${a.direction === 'inbound' ? 'Inbound' : 'Outbound'} · ${plural(a.pallets, 'pallet')}</span></div>
        ${a.status === 'confirmed' ? html`<button class="btn sm primary" type="button" data-checkin="${a.id}" data-carrier="${a.carrier}" data-dock="${docks.get(a.dockId)}">${icon('truck', 14)}Check in</button>` : apptBadge(a.status)}
      </div>`)}`.s
      : html`<div class="empty" style="padding:24px"><div class="icon">${icon('dock', 18)}</div><strong>No upcoming appointments</strong><p>Nothing is assigned to you for the next few days. Your manager assigns slots from the dock schedule.</p></div>`.s;
  };

  const loadRecent = async () => {
    const d = await api('GET', '/api/jobs?limit=6');
    const box = $('[data-recent]');
    if (!box) return;
    box.innerHTML = d.jobs.length ? html`${d.jobs.map((j) => html`<div class="list-item">
        <span class="ico" style="color:var(--text-2)">${icon(JOB_ICONS[j.type] || 'zap', 16)}</span>
        <div class="body"><strong><a class="rowlink" href="/jobs?job=${j.id}" style="text-decoration:none">${kindLabel(j.type)}</a></strong>
          <span class="num">#${j.id} · ${relTime(j.enqueuedAt)}${j.durationMs != null ? ` · ran ${fmtMs(j.durationMs)}` : ''}</span></div>
        ${statusBadge(j.status)}</div>`)}`.s
      : html`<div class="empty" style="padding:24px"><strong>No jobs yet</strong><p>Use a quick action to run your first job.</p></div>`.s;
  };

  Promise.all([loadShift(), loadAppts(), loadRecent()]).catch((err) => toast('Couldn’t load your day', err.message, 'bad'));
  const off = onStream((d) => {
    const pill = $('[data-runtime-pill]');
    if (!pill || !d.point) return;
    pill.innerHTML = html`<span class="live-dot" data-live aria-hidden="true"></span>${MODE_LABEL[d.mode]} · p95 ${fmtMs(d.point.p95)}`.s;
  });
  const timer = setInterval(() => loadRecent().catch(() => {}), 4000);

  const root = mainEl();
  const onClick = async (e) => {
    const q = e.target.closest('[data-quick]');
    if (q) newJobDialog(q.dataset.quick, () => loadRecent().catch(() => {}));
    const c = e.target.closest('[data-checkin]');
    if (c) {
      setBusy(c, true, 'Checking in…');
      try {
        const { jobId } = await api('POST', `/api/appointments/${c.dataset.checkin}/checkin`);
        const j = await watchJob(jobId);
        if (j.status === 'succeeded') toast(`${c.dataset.carrier} checked in`, `${c.dataset.dock} · job #${jobId} waited ${fmtMs(j.queueMs)}`);
        else toast('Check-in failed', j.error, 'bad');
        await Promise.all([loadAppts(), loadRecent()]);
      } catch (err) { setBusy(c, false); toast('Couldn’t check in', err.message, 'bad'); }
    }
  };
  root.addEventListener('click', onClick);
  return () => { off(); clearInterval(timer); root.removeEventListener('click', onClick); };
}

/* ───────────────────────── Jobs ───────────────────────── */

function jobsPage() {
  const manager = isManager();
  setTitle(manager ? 'Jobs' : 'My jobs');
  const params = () => new URLSearchParams(location.search);
  const p = params();
  const status = ['queued', 'running', 'succeeded', 'failed'].includes(p.get('status')) ? p.get('status') : '';
  const type = p.get('type') || '';
  const includeLoad = p.get('load') === '1';
  const tabs = [['', 'All'], ['queued', 'Queued'], ['running', 'Running'], ['succeeded', 'Succeeded'], ['failed', 'Failed']];
  const withParam = (k, v) => { const u = params(); if (v) u.set(k, v); else u.delete(k); u.delete('job'); const s = u.toString(); return `/jobs${s ? `?${s}` : ''}`; };
  let live = true;
  try { live = sessionStorage.getItem('relay-jobs-live') !== '0'; } catch { /* default on */ }

  mainEl().innerHTML = html`<div class="page">
    <div class="page-head"><div class="titles"><span class="eyebrow">Redis stream · relay:jobs</span><h1>${manager ? 'Jobs' : 'My jobs'}</h1>
      <p>${manager ? 'Every job your company has run in the last two hours. Select a job to see its payload and result.' : 'Jobs you’ve started, newest first. Select a job to see its result.'}</p></div>
      <div class="actions"><button class="btn primary" type="button" data-new-job>${icon('plus', 15)}Run a job…</button></div></div>
    <section class="card" aria-label="Job list">
      <div class="toolbar">
        <nav class="segmented" aria-label="Filter by status" style="overflow-x:auto;max-width:100%">
          ${tabs.map(([v, label]) => html`<a href="${withParam('status', v)}" data-replace data-status-tab="${v}" ${v === status ? raw('aria-current="page"') : ''}>${label} <span class="count" data-count="${v || 'all'}"></span></a>`)}
        </nav>
        <span class="grow"></span>
        <label class="search"><span class="sr-only">Search jobs</span>${icon('search', 15)}
          <input class="input" type="search" name="q" value="${p.get('q') || ''}" placeholder="Search ID, payload, error…" autocomplete="off" spellcheck="false"></label>
        <label><span class="sr-only">Job type</span><select class="select sm" name="type" style="width:auto">
          <option value="">All types</option>
          ${state.me.allKinds.map((k) => html`<option value="${k.type}" ${k.type === type ? raw('selected') : ''}>${k.type}</option>`)}
        </select></label>
        ${manager ? html`<label class="check"><input type="checkbox" name="load" ${includeLoad ? raw('checked') : ''}>Include load tests</label>` : ''}
        <label class="check"><input type="checkbox" name="live" ${live ? raw('checked') : ''}><span class="live-dot ${live ? '' : 'off'}" aria-hidden="true" data-live-ind></span>Live</label>
      </div>
      <div class="table-wrap" data-table><div class="card-body"><div class="skeleton" style="height:320px"></div></div></div>
      <div class="table-foot" data-foot hidden></div>
    </section>
  </div>`.s;

  let jobs = [], loadedMore = false, busy = false;
  const row = (j) => html`<tr class="clickable" data-job="${j.id}">
    <td><a class="rowlink" href="${withParam('job', String(j.id))}" data-replace data-open-job="${j.id}">#${j.id}</a></td>
    <td><span style="display:inline-flex;gap:8px;align-items:center">${icon(JOB_ICONS[j.type] || 'zap', 14)}<span class="mono">${j.type}</span></span></td>
    <td>${statusBadge(j.status)}${j.attempts > 1 ? html` <span class="tag" title="Attempts">×${j.attempts}</span>` : ''}</td>
    <td class="r">${fmtMs(j.queueMs)}</td>
    <td class="r">${fmtMs(j.durationMs)}</td>
    <td>${j.worker ? html`<span class="mono">${j.worker}</span>${j.stolen ? html` <span class="tag accent" title="Reclaimed from a stalled worker">stolen</span>` : ''}` : html`<span class="subtle">—</span>`}</td>
    ${manager ? html`<td class="trunc">${j.submittedBy || html`<span class="subtle">${j.runId ? 'Load test' : 'Platform'}</span>`}</td>` : ''}
    <td class="muted" title="${dateTimeFmt.format(new Date(j.enqueuedAt))}">${relTime(j.enqueuedAt)}</td></tr>`;

  const render = (counts) => {
    if (counts) {
      const all = Object.values(counts).reduce((a, b) => a + b, 0);
      $$('[data-count]').forEach((el) => { el.textContent = nf.format(el.dataset.count === 'all' ? all : counts[el.dataset.count] || 0); });
    }
    const box = $('[data-table]');
    if (!jobs.length) {
      const filtered = status || type || params().get('q');
      box.innerHTML = html`<div class="empty"><div class="icon">${icon('inbox', 20)}</div>
        <strong>${filtered ? 'No jobs match these filters' : 'No jobs yet'}</strong>
        <p>${filtered ? 'Try another status or clear the search.' : 'Jobs appear here as soon as they’re queued.'}</p>
        ${filtered ? html`<a class="btn sm" href="/jobs" data-replace>Clear filters</a>` : ''}</div>`.s;
      $('[data-foot]').hidden = true;
      return;
    }
    box.innerHTML = html`<table class="data"><thead><tr><th>ID</th><th>Type</th><th>Status</th><th class="r">Queue wait</th><th class="r">Run time</th><th>Worker</th>
      ${manager ? html`<th>Submitted by</th>` : ''}<th>Enqueued</th></tr></thead><tbody>${jobs.map(row)}</tbody></table>`.s;
    const foot = $('[data-foot]');
    foot.hidden = false;
    foot.innerHTML = html`<span class="num">Showing ${plural(jobs.length, 'job')}</span>
      ${jobs.length % 50 === 0 ? html`<button class="btn sm" type="button" data-more>Load more</button>` : html`<span class="subtle">End of list</span>`}`.s;
  };

  const query = (extra = '') => {
    const u = params();
    u.delete('job');
    return `/api/jobs?${u.toString()}${extra}`;
  };
  const load = async () => {
    if (busy) return;
    busy = true;
    try {
      const d = await api('GET', query());
      jobs = d.jobs; loadedMore = false;
      render(d.counts);
    } catch (err) {
      $('[data-table]').innerHTML = html`<div class="empty"><div class="icon">${icon('alert', 20)}</div><strong>Couldn’t load jobs</strong><p>${err.message}</p>
        <button class="btn sm" type="button" data-retry-load>Try again</button></div>`.s;
    } finally { busy = false; }
  };
  load();
  const timer = setInterval(() => { if (live && !loadedMore && !document.hidden && !$('dialog[open]')) load(); }, 3000);

  const jobParam = params().get('job');
  if (jobParam && /^\d+$/.test(jobParam)) jobDialog(Number(jobParam));

  const root = mainEl();
  let searchTimer;
  const replaceParam = (k, v) => { history.replaceState({}, '', withParam(k, v)); load(); refreshTabs(); };
  const refreshTabs = () => $$('[data-status-tab]').forEach((a) => { a.href = withParam('status', a.dataset.statusTab); });
  const onInput = (e) => {
    if (e.target.name === 'q') { clearTimeout(searchTimer); searchTimer = setTimeout(() => replaceParam('q', e.target.value.trim()), 250); }
  };
  const onChange = (e) => {
    if (e.target.name === 'type') replaceParam('type', e.target.value);
    if (e.target.name === 'load') replaceParam('load', e.target.checked ? '1' : '');
    if (e.target.name === 'live') {
      live = e.target.checked;
      try { sessionStorage.setItem('relay-jobs-live', live ? '1' : '0'); } catch { /* ignore */ }
      $('[data-live-ind]').classList.toggle('off', !live);
      if (live) load();
    }
  };
  const onClick = async (e) => {
    const open = e.target.closest('[data-open-job]');
    if (open) { e.preventDefault(); history.replaceState({}, '', open.getAttribute('href')); jobDialog(Number(open.dataset.openJob)); return; }
    const tr = e.target.closest('tr[data-job]');
    if (tr && !e.target.closest('a')) { history.replaceState({}, '', withParam('job', tr.dataset.job)); jobDialog(Number(tr.dataset.job)); }
    if (e.target.closest('[data-new-job]')) newJobDialog(null, () => load());
    if (e.target.closest('[data-retry-load]')) load();
    const more = e.target.closest('[data-more]');
    if (more) {
      setBusy(more, true, 'Loading…');
      try {
        const d = await api('GET', query(`&before=${jobs.at(-1).id}`));
        jobs = jobs.concat(d.jobs); loadedMore = true; render();
      } catch (err) { setBusy(more, false); toast('Couldn’t load more jobs', err.message, 'bad'); }
    }
  };
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('click', onClick);
  return () => { clearInterval(timer); clearTimeout(searchTimer); root.removeEventListener('input', onInput); root.removeEventListener('change', onChange); root.removeEventListener('click', onClick); };
}

/* ───────────────────────── Dock schedule ───────────────────────── */

const APPT = {
  requested: { tone: 'warn', icon: 'clock', label: 'Requested' },
  confirmed: { tone: 'info', icon: 'check', label: 'Confirmed' },
  checked_in: { tone: 'accent', icon: 'truck', label: 'Checked in' },
  completed: { tone: 'good', icon: 'checkCircle', label: 'Completed' },
};
const apptBadge = (s) => html`<span class="badge ${APPT[s].tone}">${icon(APPT[s].icon, 12)}${APPT[s].label}</span>`;
const CARRIERS = ['Blue Ridge Haulage', 'Coastline Carriers', 'Summit Transport', 'Delta Line Trucking', 'Ironbridge Logistics', 'Prairie Express', 'Northgate Freight', 'Lakeshore Cartage'];
const DAY_START = 5, DAY_END = 21; // hours shown on the dock grid

function docksPage() {
  setTitle('Dock schedule');
  const manager = isManager();
  const { user, company } = state.me;
  const day = parseISODate(new URLSearchParams(location.search).get('date')) || startOfDay(new Date());
  const today = startOfDay(new Date());
  const href = (d) => `/docks?date=${isoDate(d)}`;

  mainEl().innerHTML = html`<div class="page">
    <div class="page-head"><div class="titles"><span class="eyebrow">${company.hub}</span><h1>Dock schedule</h1>
      <p>${manager ? 'Book carrier slots per door. New bookings are confirmed with the carrier by a job on the runtime.' : 'Appointments at every door. Ones assigned to you are outlined — check carriers in as they arrive.'}</p></div>
      ${manager ? html`<div class="actions"><button class="btn primary" type="button" data-new-appt>${icon('plus', 15)}New appointment…</button></div>` : ''}</div>
    <section class="card" aria-label="Dock appointments">
      <div class="toolbar">
        <div class="datebar">
          <a class="btn icon sm" href="${href(addDays(day, -1))}" aria-label="Previous day">${icon('chevL', 16)}</a>
          <a class="btn sm" href="${href(today)}" ${sameDay(day, today) ? raw('aria-current="date"') : ''}>Today</a>
          <a class="btn icon sm" href="${href(addDays(day, 1))}" aria-label="Next day">${icon('chevR', 16)}</a>
          <label><span class="sr-only">Go to date</span><input class="input" type="date" value="${isoDate(day)}" data-date style="height:30px;width:auto"></label>
          <h2 class="date-title">${dateLong.format(day)}</h2>
        </div>
        <span class="grow"></span>
        <div class="legend" data-summary></div>
      </div>
      <div class="dock-scroll" data-grid><div class="card-body"><div class="skeleton" style="height:400px"></div></div></div>
    </section>
  </div>`.s;

  let data = null;
  const load = async () => {
    const from = new Date(day), to = addDays(day, 1);
    data = await api('GET', `/api/docks?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`);
    render();
  };
  const slotPx = 30;
  const minsFromStart = (d) => (d.getHours() - DAY_START) * 60 + d.getMinutes() + (sameDay(d, day) ? 0 : d < day ? -1e4 : 1e4);

  const render = () => {
    const { docks, appointments } = data;
    const inbound = appointments.filter((a) => a.direction === 'inbound');
    const pallets = (list) => list.reduce((s, a) => s + a.pallets, 0);
    $('[data-summary]').innerHTML = html`<span><i class="in"></i>Inbound · ${plural(inbound.length, 'slot')} · ${nf.format(pallets(inbound))} pallets</span>
      <span><i class="out"></i>Outbound · ${plural(appointments.length - inbound.length, 'slot')} · ${nf.format(pallets(appointments) - pallets(inbound))} pallets</span>
      ${!manager ? html`<span><i style="outline:2px solid var(--accent);outline-offset:1px;background:transparent"></i>Assigned to you</span>` : ''}`.s;
    const hours = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);
    const slots = (DAY_END - DAY_START) * 2;
    const label = (h) => hhmm(atTime(day, `${h}:00`));
    const grid = $('[data-grid]');
    grid.innerHTML = html`<div class="dock-grid" style="--cols:${docks.length};--slot:${slotPx}px">
      <div class="dock-corner"></div>
      ${docks.map((d) => html`<div class="dock-col-head">${d.name}<span class="tag">${d.kind}</span></div>`)}
      <div class="dock-times" aria-hidden="true">${hours.map((h) => html`<div>${h === DAY_START ? '' : label(h)}</div>`)}</div>
      ${docks.map((d) => html`<div class="dock-col" style="height:${slots * slotPx}px" aria-label="${d.name}">
        ${manager ? Array.from({ length: slots }, (_, i) => {
          const t = new Date(day); t.setHours(DAY_START, i * 30, 0, 0);
          return html`<button type="button" class="slot-btn" style="top:${i * slotPx}px" data-book="${d.id}" data-time="${hhmm(t)}" aria-label="Book ${d.name} at ${fmtTime(t)}">${icon('plus', 12)}Book ${hhmm(t)}</button>`;
        }) : ''}
        ${appointments.filter((a) => a.dockId === d.id).map((a) => {
          const s = new Date(a.startsAt), e = new Date(a.endsAt);
          const top = Math.max(0, minsFromStart(s)) / 30 * slotPx;
          const bottom = Math.min(slots * 30, minsFromStart(e)) / 30 * slotPx;
          if (bottom <= 0 || top >= slots * slotPx) return '';
          const mine = a.assignedTo === user.id;
          return html`<button type="button" class="appt ${a.direction === 'inbound' ? 'in' : 'out'} ${a.status} ${mine ? 'mine' : ''}" style="top:${top + 1}px;height:${bottom - top - 2}px" data-appt="${a.id}"
            aria-label="${a.carrier}, ${a.reference}, ${fmtTime(s)} to ${fmtTime(e)}, ${APPT[a.status].label}${mine ? ', assigned to you' : ''}">
            <strong>${a.carrier}</strong>
            <span class="line">${fmtTime(s)}–${fmtTime(e)} · ${a.reference}</span>
            ${bottom - top > 64 ? html`<span class="line">${a.direction === 'inbound' ? '↓ In' : '↑ Out'} · ${plural(a.pallets, 'pallet')}</span>` : ''}
            ${bottom - top > 82 ? html`<span class="st">${icon(APPT[a.status].icon, 11)}${APPT[a.status].label}</span>` : ''}
          </button>`;
        })}
      </div>`)}
      ${sameDay(day, today) ? html`<div class="now-line" data-now aria-hidden="true"></div>` : ''}
    </div>`.s;
    placeNow();
  };
  const placeNow = () => {
    const el = $('[data-now]');
    if (!el) return;
    const m = minsFromStart(new Date());
    const headH = $('.dock-col-head')?.offsetHeight || 40;
    el.hidden = m < 0 || m > (DAY_END - DAY_START) * 60;
    el.style.top = `${headH + (m / 30) * slotPx}px`;
  };

  let scrolled = false;
  load().then(() => {
    if (scrolled) return;
    scrolled = true;
    const target = sameDay(day, today) ? Math.max(0, minsFromStart(new Date()) / 30 * slotPx - 120) : (8 - DAY_START) * 2 * slotPx;
    $('[data-grid]').scrollTop = target;
  }).catch((err) => {
    $('[data-grid]').innerHTML = html`<div class="empty"><div class="icon">${icon('alert', 20)}</div><strong>Couldn’t load the schedule</strong><p>${err.message}</p></div>`.s;
  });
  const timer = setInterval(() => { if (!document.hidden && !$('dialog[open]')) load().catch(() => {}); else placeNow(); }, 15000);

  const root = mainEl();
  const onChange = (e) => { if (e.target.matches('[data-date]') && parseISODate(e.target.value)) navigate(href(parseISODate(e.target.value)), { replace: true }); };
  const onClick = (e) => {
    const a = e.target.closest('[data-appt]');
    if (a) return apptDialog(data, Number(a.dataset.appt), load);
    const b = e.target.closest('[data-book]');
    if (b) return newApptDialog(data, day, Number(b.dataset.book), b.dataset.time, load);
    if (e.target.closest('[data-new-appt]') && data) newApptDialog(data, day, data.docks[0]?.id, '09:00', load);
  };
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  return () => { clearInterval(timer); root.removeEventListener('click', onClick); root.removeEventListener('change', onChange); };
}

function apptDialog(data, id, reload) {
  const a = data.appointments.find((x) => x.id === id);
  if (!a) return;
  const { user } = state.me;
  const manager = isManager();
  const dock = data.docks.find((d) => d.id === a.dockId);
  const action = a.status === 'requested' && manager ? ['confirm', 'Confirm with carrier', 'Confirming…', 'dock']
    : a.status === 'confirmed' && (manager || a.assignedTo === user.id) ? ['checkin', 'Check in carrier', 'Checking in…', 'truck']
    : a.status === 'checked_in' && manager ? ['complete', 'Mark completed', 'Completing…', 'checkCircle'] : null;
  openDialog({
    title: `${a.carrier}`,
    description: html`${a.reference} · ${dock?.name} · ${dateLong.format(new Date(a.startsAt))}`,
    body: html`<dl class="kv">
      <dt>Status</dt><dd data-appt-status>${apptBadge(a.status)}</dd>
      <dt>Time</dt><dd>${fmtTime(a.startsAt)} – ${fmtTime(a.endsAt)}</dd>
      <dt>Direction</dt><dd>${a.direction === 'inbound' ? 'Inbound (receiving)' : 'Outbound (shipping)'}</dd>
      <dt>Load</dt><dd>${plural(a.pallets, 'pallet')}</dd>
      <dt>Assigned to</dt><dd>${a.assignee ? (a.assignedTo === user.id ? `${a.assignee} (you)` : a.assignee) : 'Unassigned'}</dd>
      ${a.checkedInAt ? html`<dt>Checked in</dt><dd>${fmtTime(a.checkedInAt)}</dd>` : ''}
    </dl><p class="muted" data-appt-progress style="font-size:12.5px" aria-live="polite"></p>`,
    foot: html`<button class="btn" type="button" data-close>Close</button>
      ${action ? html`<button class="btn primary" type="submit">${icon(action[3], 14)}${action[1]}</button>` : ''}`,
    onSubmit: async (form, dlg, btn) => {
      const [verb, , busyLabel] = action;
      setBusy(btn, true, busyLabel);
      if (verb === 'complete') {
        await api('POST', `/api/appointments/${id}/complete`);
        toast(`${a.carrier} completed`, `${dock?.name} is free.`);
        await reload();
        return;
      }
      const { jobId } = await api('POST', `/api/appointments/${id}/${verb}`);
      $('[data-appt-progress]', dlg).textContent = `Running job #${jobId} on the runtime…`;
      const j = await watchJob(jobId);
      if (j.status !== 'succeeded') throw new ApiError(j.error || `Job #${jobId} failed.`);
      if (j.result?.skipped) throw new ApiError(`Nothing to do — ${j.result.reason}.`);
      toast(verb === 'confirm' ? `${a.carrier} confirmed` : `${a.carrier} checked in`,
        `${dock?.name} · job #${jobId} waited ${fmtMs(j.queueMs)}, ran ${fmtMs(j.durationMs)}`);
      await reload();
    },
  });
}

function newApptDialog(data, day, dockId, time, reload) {
  const employees = data.staff.filter((s) => s.role === 'employee');
  const times = [];
  for (let m = DAY_START * 60; m < DAY_END * 60; m += 30) times.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  const durations = [[30, '30 min'], [60, '1 hour'], [90, '1.5 hours'], [120, '2 hours'], [180, '3 hours'], [240, '4 hours']];
  openDialog({
    title: 'New dock appointment',
    description: 'The slot is saved as requested, then a dock.confirm job confirms it with the carrier.',
    body: html`
      <div class="row-2">
        <div class="field"><label for="na-dock">Door</label><select class="select" id="na-dock" name="dockId">
          ${data.docks.map((d) => html`<option value="${d.id}" ${d.id === dockId ? raw('selected') : ''}>${d.name} · ${d.kind}</option>`)}</select></div>
        <fieldset class="field" style="border:0;padding:0;margin:0" data-field="direction"><legend class="label" style="margin-bottom:6px">Direction</legend>
          <div class="segmented" style="width:100%">
            <label style="flex:1;justify-content:center" class="check"><input type="radio" name="direction" value="inbound" checked>Inbound</label>
            <label style="flex:1;justify-content:center" class="check"><input type="radio" name="direction" value="outbound">Outbound</label></div></fieldset>
      </div>
      <div class="field"><label for="na-carrier">Carrier</label>
        <input class="input" id="na-carrier" name="carrier" list="carrier-list" autocomplete="off" maxlength="60" placeholder="e.g. Summit Transport…" required>
        <datalist id="carrier-list">${CARRIERS.map((c) => html`<option value="${c}">`)}</datalist></div>
      <div class="row-2">
        <div class="field"><label for="na-ref">PO / SO reference</label>
          <input class="input mono" id="na-ref" name="reference" autocomplete="off" spellcheck="false" autocapitalize="characters" maxlength="30" placeholder="PO-48211…" required></div>
        <div class="field"><label for="na-pallets">Pallets</label>
          <input class="input" id="na-pallets" name="pallets" type="number" inputmode="numeric" min="1" max="60" value="12" required></div>
      </div>
      <div class="row-3">
        <div class="field"><label for="na-date">Date</label><input class="input" id="na-date" name="date" type="date" value="${isoDate(day)}" required></div>
        <div class="field"><label for="na-start">Start</label><select class="select" id="na-start" name="start">
          ${times.map((t) => html`<option ${t === time ? raw('selected') : ''}>${t}</option>`)}</select></div>
        <div class="field"><label for="na-dur">Duration</label><select class="select" id="na-dur" name="duration">
          ${durations.map(([m, l]) => html`<option value="${m}" ${m === 60 ? raw('selected') : ''}>${l}</option>`)}</select></div>
      </div>
      <div class="field"><label for="na-assignee">Assign to</label><select class="select" id="na-assignee" name="assignedTo">
        <option value="">Unassigned</option>${employees.map((s) => html`<option value="${s.id}">${s.name} · ${s.title}</option>`)}</select>
        <p class="hint">The assignee can check the carrier in from their phone.</p></div>`,
    foot: html`<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Request slot</button>`,
    onOpen: (dlg, form) => form.carrier.focus(),
    onSubmit: async (form) => {
      const day2 = parseISODate(form.date.value);
      if (!day2) throw new ApiError('Choose a date.', 0, 'date');
      const start = atTime(day2, form.start.value);
      const end = new Date(start.getTime() + Number(form.duration.value) * 60000);
      const body = {
        dockId: Number(form.dockId.value), carrier: form.carrier.value.trim(), reference: form.reference.value.trim(),
        direction: form.direction.value, pallets: Number(form.pallets.value) || 0,
        startsAt: start.toISOString(), endsAt: end.toISOString(), assignedTo: form.assignedTo.value ? Number(form.assignedTo.value) : null,
      };
      if (!body.carrier) throw new ApiError('Enter the carrier name.', 0, 'carrier');
      if (!body.reference) throw new ApiError('Enter a PO or SO reference.', 0, 'reference');
      const { jobId } = await api('POST', '/api/appointments', body);
      toast('Slot requested', `Confirming with ${body.carrier} — job #${jobId}.`, 'info');
      if (!sameDay(day2, day)) navigate(`/docks?date=${isoDate(day2)}`);
      else await reload();
      watchJob(jobId).then((j) => {
        if (j.status === 'succeeded') toast(`${body.carrier} confirmed`, `Job #${jobId} waited ${fmtMs(j.queueMs)}, ran ${fmtMs(j.durationMs)}.`);
        return reload();
      }).catch(() => {});
    },
  });
}

/* ───────────────────────── Shifts ───────────────────────── */

function shiftsPage() {
  setTitle('Shifts');
  const manager = isManager();
  const { user } = state.me;
  const week = startOfWeek(parseISODate(new URLSearchParams(location.search).get('week')) || new Date());
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const today = startOfDay(new Date());
  const href = (d) => `/shifts?week=${isoDate(d)}`;
  const rangeLabel = `${dateShort.format(week)} – ${dateShort.format(addDays(week, 6))}`;

  mainEl().innerHTML = html`<div class="page">
    <div class="page-head"><div class="titles"><span class="eyebrow">Week of ${rangeLabel}</span><h1>Shifts</h1>
      <p>${manager ? 'Plan the team’s week. Drafts stay private until you publish — each one sends a shift.publish job that notifies the employee.' : 'Your published shifts and the rest of the team’s.'}</p></div>
      <div class="actions" data-shift-actions></div></div>
    <section class="card" aria-label="Weekly schedule">
      <div class="toolbar">
        <div class="datebar">
          <a class="btn icon sm" href="${href(addDays(week, -7))}" aria-label="Previous week">${icon('chevL', 16)}</a>
          <a class="btn sm" href="${href(today)}">This week</a>
          <a class="btn icon sm" href="${href(addDays(week, 7))}" aria-label="Next week">${icon('chevR', 16)}</a>
          <h2 class="date-title">${rangeLabel}</h2>
        </div>
        <span class="grow"></span>
        <div class="legend"><span><i style="background:var(--surface-2);border:1px solid var(--border);border-left:3px solid var(--accent)"></i>Published</span>
          ${manager ? html`<span><i style="border:1px dashed var(--border-strong);border-left:3px solid var(--accent)"></i>Draft</span>` : ''}</div>
      </div>
      <div class="shift-scroll" data-shifts><div class="card-body"><div class="skeleton" style="height:420px"></div></div></div>
    </section>
  </div>`.s;

  let data = null;
  const hrs = (s) => (new Date(s.endsAt) - new Date(s.startsAt)) / 3.6e6;
  const load = async () => {
    data = await api('GET', `/api/shifts?from=${encodeURIComponent(week.toISOString())}&to=${encodeURIComponent(addDays(week, 7).toISOString())}`);
    render();
  };
  const render = () => {
    const staff = [...data.staff].sort((a, b) => (b.id === user.id) - (a.id === user.id));
    const drafts = data.shifts.filter((s) => !s.published);
    const mine = data.shifts.filter((s) => s.userId === user.id);
    $('[data-shift-actions]').innerHTML = manager
      ? (drafts.length ? html`<button class="btn primary" type="button" data-publish>${icon('send', 14)}Publish ${plural(drafts.length, 'draft')}</button>`
        : html`<span class="badge good">${icon('check', 12)}Everything published</span>`).s
      : html`<span class="badge accent num">${icon('clock', 12)}You’re scheduled for ${nf1.format(mine.reduce((a, s) => a + hrs(s), 0))}${NBSP}h</span>`.s;
    const cells = (p, d) => data.shifts.filter((s) => s.userId === p.id && sameDay(new Date(s.startsAt), d));
    $('[data-shifts]').innerHTML = html`<div class="shift-grid">
      <div class="corner day-head"><strong>Team</strong>${plural(staff.length, 'person', 'people')}</div>
      ${days.map((d) => html`<div class="day-head ${sameDay(d, today) ? 'today' : ''}"><span>${weekdayShort.format(d)}</span><strong>${dateShort.format(d)}</strong></div>`)}
      ${staff.map((p) => {
        const total = data.shifts.filter((s) => s.userId === p.id).reduce((a, s) => a + hrs(s), 0);
        const you = p.id === user.id;
        return html`<div class="person ${you ? 'you row-you' : ''}"><span class="avatar ${you ? 'accent' : ''}" aria-hidden="true">${initials(p.name)}</span>
          <div class="who"><strong>${p.name}</strong><span>${p.title}</span></div><span class="hours" title="Hours this week">${nf1.format(total)}h</span></div>
        ${days.map((d) => html`<div class="cell ${sameDay(d, today) ? 'today' : ''} ${you ? 'row-you' : ''}">
          ${cells(p, d).map((s) => html`<button type="button" class="pill ${s.published ? '' : 'draft'}" data-shift="${s.id}"
              aria-label="${p.name}, ${fmtTime(s.startsAt)} to ${fmtTime(s.endsAt)}, ${s.position}${s.published ? '' : ', draft'}">
            <strong>${fmtTime(s.startsAt)}–${fmtTime(s.endsAt)}</strong><span>${s.position}</span>
            ${s.published ? '' : html`<em>Draft</em>`}</button>`)}
          ${manager ? html`<button type="button" class="add-shift" data-add="${p.id}" data-day="${isoDate(d)}" aria-label="Add shift for ${p.name} on ${dateLong.format(d)}">${icon('plus', 12)}Add</button>` : ''}
        </div>`)}`;
      })}
      <div class="foot person"><span class="muted">Coverage</span></div>
      ${days.map((d) => html`<div class="foot">${plural(data.shifts.filter((s) => sameDay(new Date(s.startsAt), d)).length, 'shift')}</div>`)}
    </div>`.s;
  };
  load().catch((err) => {
    $('[data-shifts]').innerHTML = html`<div class="empty"><div class="icon">${icon('alert', 20)}</div><strong>Couldn’t load shifts</strong><p>${err.message}</p></div>`.s;
  });

  const root = mainEl();
  const onClick = async (e) => {
    const pill = e.target.closest('[data-shift]');
    if (pill) return shiftDialog(data, Number(pill.dataset.shift), load);
    const add = e.target.closest('[data-add]');
    if (add) return newShiftDialog(data, Number(add.dataset.add), parseISODate(add.dataset.day), load);
    const pub = e.target.closest('[data-publish]');
    if (pub) {
      setBusy(pub, true, 'Publishing…');
      try {
        const r = await api('POST', '/api/shifts/publish', { from: week.toISOString(), to: addDays(week, 7).toISOString() });
        toast(`Publishing ${plural(r.jobs, 'shift')}`, `${plural(r.jobs, 'shift.publish job')} queued. Employees are notified as each one runs.`, 'info');
        await Promise.all(r.jobIds.map((id) => watchJob(id).catch(() => null)));
        await load();
        toast('Week published', `${plural(r.jobs, 'employee notification')} sent.`);
      } catch (err) { setBusy(pub, false); toast('Couldn’t publish', err.message, 'bad'); }
    }
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}

function shiftDialog(data, id, reload) {
  const s = data.shifts.find((x) => x.id === id);
  if (!s) return;
  const p = data.staff.find((x) => x.id === s.userId);
  openDialog({
    title: `${p?.name}`,
    description: html`${dateLong.format(new Date(s.startsAt))}`,
    body: html`<dl class="kv">
      <dt>Time</dt><dd>${fmtTime(s.startsAt)} – ${fmtTime(s.endsAt)} <span class="muted">(${nf1.format((new Date(s.endsAt) - new Date(s.startsAt)) / 3.6e6)}${NBSP}h)</span></dd>
      <dt>Position</dt><dd>${s.position}</dd><dt>Location</dt><dd>${s.location}</dd>
      <dt>Status</dt><dd>${s.published ? html`<span class="badge good">${icon('check', 12)}Published</span>` : html`<span class="badge warn">${icon('clock', 12)}Draft</span>`}</dd></dl>`,
    foot: html`${isManager() ? html`<button class="btn danger left" type="button" data-delete>${icon('trash', 14)}Delete shift…</button>` : ''}<button class="btn" type="button" data-close>Close</button>`,
    onOpen: (dlg) => {
      $('[data-delete]', dlg)?.addEventListener('click', async () => {
        dlg.close();
        const ok = await confirmDialog({ title: 'Delete this shift?', description: `${p?.name}’s ${fmtTime(s.startsAt)}–${fmtTime(s.endsAt)} shift on ${dateLong.format(new Date(s.startsAt))} will be removed${s.published ? '. They’ve already been notified about it' : ''}.`, confirmLabel: 'Delete shift' });
        if (!ok) return;
        try {
          await api('DELETE', `/api/shifts/${id}`);
          toast('Shift deleted', `${p?.name} · ${dateShort.format(new Date(s.startsAt))}`);
          await reload();
        } catch (err) { toast('Couldn’t delete shift', err.message, 'bad'); }
      });
    },
  });
}

function newShiftDialog(data, userId, day, reload) {
  const positions = [...new Set(data.shifts.map((s) => s.position))];
  const locations = [...new Set(data.shifts.map((s) => s.location))];
  const last = data.shifts.find((s) => s.userId === userId);
  openDialog({
    title: 'Add shift',
    description: 'New shifts start as drafts. Publish the week to notify the team.',
    body: html`
      <div class="row-2">
        <div class="field"><label for="ns-user">Team member</label><select class="select" id="ns-user" name="userId">
          ${data.staff.map((s) => html`<option value="${s.id}" ${s.id === userId ? raw('selected') : ''}>${s.name}</option>`)}</select></div>
        <div class="field"><label for="ns-date">Date</label><input class="input" id="ns-date" name="date" type="date" value="${isoDate(day)}" required></div>
      </div>
      <div class="row-2">
        <div class="field"><label for="ns-start">Start</label><input class="input" id="ns-start" name="start" type="time" step="900" value="${last ? hhmm(new Date(last.startsAt)) : '08:00'}" required></div>
        <div class="field" data-field="end"><label for="ns-end">End</label><input class="input" id="ns-end" name="end" type="time" step="900" value="${last ? hhmm(new Date(last.endsAt)) : '16:30'}" required>
          <p class="hint">Ends before the start? It runs past midnight.</p></div>
      </div>
      <div class="row-2">
        <div class="field"><label for="ns-pos">Position</label><input class="input" id="ns-pos" name="position" list="pos-list" value="${last?.position || positions[0] || ''}" maxlength="40" autocomplete="off" required>
          <datalist id="pos-list">${positions.map((v) => html`<option value="${v}">`)}</datalist></div>
        <div class="field"><label for="ns-loc">Location</label><input class="input" id="ns-loc" name="location" list="loc-list" value="${last?.location || locations[0] || ''}" maxlength="40" autocomplete="off" required>
          <datalist id="loc-list">${locations.map((v) => html`<option value="${v}">`)}</datalist></div>
      </div>`,
    foot: html`<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Add draft shift</button>`,
    onOpen: (dlg, form) => form.start.focus(),
    onSubmit: async (form) => {
      const d = parseISODate(form.date.value);
      if (!d) throw new ApiError('Choose a date.', 0, 'date');
      if (!form.start.value) throw new ApiError('Choose a start time.', 0, 'start');
      if (!form.end.value) throw new ApiError('Choose an end time.', 0, 'end');
      const start = atTime(d, form.start.value);
      let end = atTime(d, form.end.value);
      if (end <= start) end = addDays(end, 1);
      await api('POST', '/api/shifts', {
        userId: Number(form.userId.value), startsAt: start.toISOString(), endsAt: end.toISOString(),
        position: form.position.value.trim(), location: form.location.value.trim(),
      });
      const who = data.staff.find((s) => s.id === Number(form.userId.value));
      toast('Draft shift added', `${who?.name} · ${dateShort.format(d)}, ${hhmm(start)}–${hhmm(end)}`);
      await reload();
    },
  });
}

/* ───────────────────────── Boot ───────────────────────── */

applyTheme(themePref());
route();
