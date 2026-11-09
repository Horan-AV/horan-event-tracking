/* Horan Event Tracking — front end. Plain JavaScript, no build step. */
'use strict';

const STATUS = {
  enquiry: 'Enquiry', quote: 'Quotation', provisional: 'Provisional', confirmed: 'Confirmed',
  out: 'On hire', returned: 'Returned', invoiced: 'Invoiced', cancelled: 'Cancelled', lost: 'Lost',
};
const KIND_LABEL = { rental: 'Rental equipment', sale: 'Sales', service: 'Services & labour' };
/* ---- categories › subcategories */
const SUB_SEP = '\u0001';
const catLabel = (p) => [p.category || p.product_category, p.subcategory || p.product_subcategory].filter(Boolean).join(' › ');
function catOptions(list, selected) {
  const cats = {};
  for (const p of list) {
    const c = p.category || 'Uncategorised';
    cats[c] ||= new Set();
    if (p.subcategory) cats[c].add(p.subcategory);
  }
  return '<option value="">All categories</option>' + Object.keys(cats).sort((a, b) => a.localeCompare(b)).map((c) =>
    `<option value="${esc(c)}" ${selected === c ? 'selected' : ''}>${esc(c)}</option>`
    + [...cats[c]].sort((a, b) => a.localeCompare(b)).map((sc) => {
      const v = c + SUB_SEP + sc;
      return `<option value="${esc(v)}" ${selected === v ? 'selected' : ''}>\u00a0\u00a0\u00a0› ${esc(sc)}</option>`;
    }).join('')).join('');
}
function catMatch(p, sel) {
  if (!sel) return true;
  const [c, sc] = sel.split(SUB_SEP);
  return (p.category || 'Uncategorised') === c && (sc === undefined || (p.subcategory || '') === sc);
}
/** Group header rows: a row per category, and a lighter one per subcategory within it. */
function groupRows(list, ncols, rowFn, cls = 'group') {
  let lastCat = null, lastSub = null;
  return list.map((p) => {
    const cat = p.category || 'Uncategorised';
    const sub = p.subcategory || '';
    let r = '';
    if (cat !== lastCat) { r += `<tr class="${cls}"><td colspan="${ncols}">${catIcon(p.category)}${esc(cat)}</td></tr>`; lastCat = cat; lastSub = ''; }
    if (sub !== lastSub) { if (sub) r += `<tr class="${cls} subgroup"><td colspan="${ncols}">› ${esc(sub)}</td></tr>`; lastSub = sub; }
    return r + rowFn(p);
  }).join('');
}

/* ---- sizes: stored in cm, shown in cm or mm (each device remembers) */
const SIZE_UNIT_KEY = 'het-size-unit';
function sizeUnit() { try { return localStorage.getItem(SIZE_UNIT_KEY) === 'mm' ? 'mm' : 'cm'; } catch { return 'cm'; } }
function setSizeUnit(u) { try { localStorage.setItem(SIZE_UNIT_KEY, u); } catch { /* not kept */ } }
const sizeShown = (cm, u = sizeUnit()) => (cm == null || cm === '' ? '' : +(u === 'mm' ? Number(cm) * 10 : Number(cm)).toFixed(2));
const SIZE_KEYS = ['size_w', 'size_d', 'size_h', 'inner_w', 'inner_d', 'inner_h'];
function sizeText(p, pre = 'size') {
  const [w, d, h] = pre === 'inner' ? [p.inner_w, p.inner_d, p.inner_h] : [p.size_w, p.size_d, p.size_h];
  if (!w && !d && !h) return '';
  const u = sizeUnit();
  return `${[w, d, h].map((v) => (v ? num(sizeShown(v, u)) : '?')).join(' × ')} ${u}`;
}

const JOB_FILTERS = [
  ['open', 'Open', 'enquiry,quote,provisional,confirmed,out'],
  ['overdue', 'Overdue', 'provisional,confirmed,out'],
  ['quotes', 'Enquiries & quotes', 'enquiry,quote'],
  ['provisional', 'Provisional', 'provisional'],
  ['confirmed', 'Confirmed', 'confirmed'],
  ['out', 'On hire', 'out'],
  ['done', 'Completed', 'returned,invoiced'],
  ['dead', 'Cancelled / lost', 'cancelled,lost'],
  ['all', 'All', ''],
];

const S = {
  settings: {}, meta: {},
  jobFilter: 'open', jobQuery: '',
  stockQuery: '', stockCat: '', stockBrand: '', stockArchived: false,
  contactQuery: '',
  avail: { start: null, days: 14, cat: '' },
  job: null, jobAvail: [], products: [], pickIdx: 0,
};

/* ---------------------------------------------------------------- utils */

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DEFAULT_APP_NAME = 'Horan Event Tracking';
const appName = (s = S.settings) => (s && s.app_name) || DEFAULT_APP_NAME;

async function api(path, { method = 'GET', body } = {}) {
  const opts = { method, headers: {} };
  if (method !== 'GET') opts.headers['X-Requested-With'] = 'horan-rms';
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch('/api' + path, opts);
  } catch {
    throw new Error(`Can’t reach the ${appName()} server. Is it still running? Re-open it from the app menu.`);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (res.status === 401 && data && data.login && path !== '/login') { location.reload(); throw new Error('Please sign in again'); }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}
const get = (p) => api(p);
const post = (p, b) => api(p, { method: 'POST', body: b ?? {} });
const put = (p, b) => api(p, { method: 'PUT', body: b });
const del = (p) => api(p, { method: 'DELETE' });

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayISO = () => isoOf(new Date());
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return isoOf(d); };
const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);

function fmtDate(s, withDay) {
  if (!s) return '';
  return parseISO(s).toLocaleDateString('en-GB', withDay
    ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtRange(a, b) {
  if (!a) return '';
  if (a === b) return fmtDate(a, true);
  const da = parseISO(a), db = parseISO(b);
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (da.getFullYear() !== db.getFullYear()) opts.year = 'numeric';
  return `${da.toLocaleDateString('en-GB', opts)} – ${fmtDate(b, true)}`;
}

const nf = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function money(n) {
  const v = Number(n || 0);
  return (v < 0 ? '−' : '') + (S.settings.currency ?? '£') + nf.format(Math.abs(v));
}
function num(n) {
  const v = Number(n || 0);
  return Number.isInteger(v) ? String(v) : String(+v.toFixed(2));
}
const plural = (n, word, many) => `${num(n)} ${Number(n) === 1 ? word : (many || word + 's')}`;
function orderItems(items) {
  const kids = {}, top = [], ids = new Set(items.map((i) => i.id));
  for (const it of items) {
    if (it.parent_item_id && ids.has(it.parent_item_id)) (kids[it.parent_item_id] ||= []).push(it);
    else top.push(it);
  }
  const out = [];
  const walk = (x, d) => { x._depth = d; out.push(x); for (const k of kids[x.id] || []) walk(k, d + 1); };
  for (const t of top) walk(t, 0);
  return out;
}
const metaOf = (it) => { try { return it.meta ? JSON.parse(it.meta) : {}; } catch { return {}; } };
const isRun = (it) => ['cable_run', 'stage'].includes(metaOf(it).type);
const isStage = (it) => metaOf(it).type === 'stage';
const groupWord = (it) => (isStage(it) ? 'stage' : 'cable run');

const SIDES = ['front', 'left', 'right', 'back'];
const SIDE_LABEL = { front: 'Front', left: 'Left', right: 'Right', back: 'Back' };

/** Every place two decks meet: one point per started metre of shared edge (same rule as the server). */
function clampPoints(layout) {
  const eps = 1e-6, r3 = (v) => Math.round(v * 1000) / 1000, pts = new Map();
  const add = (x, y) => pts.set(`${r3(x)},${r3(y)}`, [r3(x), r3(y)]);
  (layout || []).forEach((a, i) => {
    for (const b of layout.slice(i + 1)) {
      for (const [l, r] of [[a, b], [b, a]]) {
        if (Math.abs(l.x + l.w - r.x) < eps) {
          const y0 = Math.max(l.y, r.y), y1 = Math.min(l.y + l.d, r.y + r.d);
          if (y1 - y0 > eps) {
            const n = Math.max(1, Math.ceil(r3(y1 - y0) - 1e-9));
            for (let k = 0; k < n; k++) add(r.x, y0 + (y1 - y0) * (k + 0.5) / n);
          }
        }
      }
      for (const [t, u] of [[a, b], [b, a]]) {
        if (Math.abs(t.y + t.d - u.y) < eps) {
          const x0 = Math.max(t.x, u.x), x1 = Math.min(t.x + t.w, u.x + u.w);
          if (x1 - x0 > eps) {
            const n = Math.max(1, Math.ceil(r3(x1 - x0) - 1e-9));
            for (let k = 0; k < n; k++) add(x0 + (x1 - x0) * (k + 0.5) / n, u.y);
          }
        }
      }
    }
  });
  return [...pts.values()];
}
const ptKey = (p) => `${Math.round(p[0] * 1000) / 1000},${Math.round(p[1] * 1000) / 1000}`;

/** Plan view of a stage layout. Front (audience side) is at the bottom.
 *  edit: every joint is a clickable dot (data-clamp) and every side a clickable edge (data-skirt-side). */
function stageSVG(meta, { px = 420, labels = true, edit = false, legend = true } = {}) {
  const W = meta.width, D = meta.depth;
  if (!W || !D || !meta.layout) return '';
  const pad = edit ? 30 : 24, scale = (px - pad * 2) / Math.max(W, D * 1.6);
  const w = W * scale, h = D * scale;
  const sizes = [...new Set(meta.layout.map((l) => l.deck_id))];
  const fills = ['#d9e7de', '#f1e4b8', '#dfe3e8', '#e8d9e7', '#d9e3ef'];
  const name = (l) => (meta.deck_names && meta.deck_names[l.deck_id]) || '';
  const rects = meta.layout.map((l) => {
    const x = pad + l.x * scale, y = pad + l.y * scale, rw = l.w * scale, rh = l.d * scale;
    const txt = name(l).replace(/m$/, '');
    const fs = 10, tw = txt.length * fs * 0.55;
    let label = '';
    if (labels && rw >= tw + 4 && rh >= fs + 4) {
      label = `<text x="${x + rw / 2}" y="${y + rh / 2 + fs / 3}" text-anchor="middle" font-size="${fs}" fill="#334">${esc(txt)}</text>`;
    } else if (labels && rh >= tw + 4 && rw >= fs + 4) {
      const cx = x + rw / 2, cy = y + rh / 2;
      label = `<text x="${cx}" y="${cy + fs / 3}" text-anchor="middle" font-size="${fs}" fill="#334" transform="rotate(-90 ${cx} ${cy})">${esc(txt)}</text>`;
    }
    return `<rect x="${x}" y="${y}" width="${rw}" height="${rh}" fill="${fills[sizes.indexOf(l.deck_id) % fills.length]}" stroke="#1f5c3d" stroke-width="1.2"/>${label}`;
  }).join('');
  // skirts: a thick gold line just outside each skirted side
  const skirted = new Set((meta.skirts && meta.skirts.sides) || []);
  const off = 4, x0 = pad, y0 = pad, x1 = pad + w, y1 = pad + h;
  const edges = { back: [x0, y0 - off, x1, y0 - off], front: [x0, y1 + off, x1, y1 + off],
    left: [x0 - off, y0, x0 - off, y1], right: [x1 + off, y0, x1 + off, y1] };
  const skirtSvg = SIDES.map((sd) => {
    const [ax, ay, bx, by] = edges[sd];
    const on = skirted.has(sd);
    const line = on ? `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#c9a227" stroke-width="5" stroke-linecap="butt"/>` : '';
    if (!edit) return line;
    const hx = Math.min(ax, bx) - (ax === bx ? 7 : 0), hy = Math.min(ay, by) - (ay === by ? 7 : 0);
    const hit = `<rect class="hit" data-skirt-side="${sd}" x="${hx}" y="${hy}" width="${Math.abs(bx - ax) || 14}" height="${Math.abs(by - ay) || 14}" fill="transparent"><title>${on ? 'Remove' : 'Add'} skirt on the ${sd}</title></rect>`;
    const ghost = on ? '' : `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#c9a227" stroke-opacity=".35" stroke-width="3" stroke-dasharray="4 4"/>`;
    return ghost + line + hit;
  }).join('');
  // clamps
  // clamps: numbered front-to-back reading order (back row first, left to right), same numbers in the editor and on paper
  const placedPts = ((meta.clamps && meta.clamps.points) || []).slice().sort((p, q) => p[1] - q[1] || p[0] - q[0]);
  const placed = new Map(placedPts.map((p, i) => [ptKey(p), i + 1]));
  const joints = edit ? clampPoints(meta.layout) : placedPts;
  const numbered = scale >= 40 && placedPts.length < 1000;
  const r = numbered ? 7.5 : (edit ? 6 : Math.max(3, Math.min(5, scale * 0.09)));
  const clampSvg = joints.map((p) => {
    const cx = pad + p[0] * scale, cy = pad + p[1] * scale, n = placed.get(ptKey(p)), on = !!n;
    const fs = n >= 100 ? 6 : n >= 10 ? 7.5 : 8.5;
    const dot = `<circle cx="${cx}" cy="${cy}" r="${on ? r : Math.min(r, 6)}" fill="${on ? '#c0392b' : '#fff'}" stroke="${on ? '#7d1f15' : '#1f5c3d'}" stroke-width="${on ? 1.2 : 1.5}"/>`
      + (on && numbered ? `<text x="${cx}" y="${cy + fs * 0.36}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="#fff">${n}</text>` : '');
    if (!edit) return dot;
    return `<g class="joint${on ? ' on' : ''}" data-clamp="${p[0]},${p[1]}" tabindex="0" role="button" aria-pressed="${on}" aria-label="${on ? `Remove clamp ${n}` : 'Add clamp'}">
      <circle cx="${cx}" cy="${cy}" r="11" fill="transparent"/>${dot}<title>${on ? `Clamp ${n} — click to remove` : 'Add a clamp here'}</title></g>`;
  }).join('');
  const nClamps = placed.size;
  const legendItems = [];
  if (legend && (nClamps || edit)) legendItems.push(`<circle cx="0" cy="-4" r="4" fill="#c0392b" stroke="#7d1f15"/><text x="8" y="0" font-size="10" fill="#555">Clamp${edit ? '' : ` (${nClamps})`}</text>`);
  if (legend && edit) legendItems.push(`<circle cx="0" cy="-4" r="4" fill="#fff" stroke="#1f5c3d" stroke-width="1.5"/><text x="8" y="0" font-size="10" fill="#555">Joint (click to clamp)</text>`);
  if (legend && (skirted.size || edit)) legendItems.push(`<line x1="-4" y1="-4" x2="10" y2="-4" stroke="#c9a227" stroke-width="5"/><text x="16" y="0" font-size="10" fill="#555">Skirt${edit ? ' (click a side)' : ''}</text>`);
  const legY = pad + h + 34;
  let lx = pad;
  const legendSvg = legendItems.map((g) => { const out = `<g transform="translate(${lx + 4} ${legY})">${g}</g>`; lx += edit ? 150 : 90; return out; }).join('');
  const vw = Math.round(Math.max(w + pad * 2, legendItems.length ? lx + 10 : 0)), vh = Math.round(h + pad * 2 + 14 + (legendItems.length ? 16 : 0));
  return `<svg class="stage-svg${edit ? ' editing' : ''}" viewBox="0 0 ${vw} ${vh}" style="width:${vw}px;height:auto;aspect-ratio:${vw}/${vh}" role="img" aria-label="Stage plan ${num(W)} by ${num(D)} metres">
    ${rects}${skirtSvg}${clampSvg}
    <text x="${pad + w / 2}" y="${pad - 10}" text-anchor="middle" font-size="11" fill="#666">${num(W)} m</text>
    <text x="${pad - 10}" y="${pad + h / 2}" text-anchor="middle" font-size="11" fill="#666" transform="rotate(-90 ${pad - 10} ${pad + h / 2})">${num(D)} m</text>
    <text x="${pad + w / 2}" y="${pad + h + 19}" text-anchor="middle" font-size="10" fill="#999" letter-spacing="2">FRONT</text>${legendSvg}</svg>`;
}

/** "Front 2 × 3m · Left 3m + 1m ..." */
function skirtBreakdown(sk) {
  if (!sk || !sk.per_side || !sk.per_side.length) return '';
  return sk.per_side.map((s) => `${SIDE_LABEL[s.side]} ${num(s.length)}m: ${s.pieces.map((p) => `${p.count > 1 ? `${num(p.count)} × ` : ''}${num(p.length)}m`).join(' + ')}`).join(' · ');
}

/* ---- skirt height / style / colour, chosen from what's in Stock ---- */
const SKIRT_KEYS = ['height', 'style', 'colour'];
const SKIRT_KEY_LABEL = { height: 'Height', style: 'Style', colour: 'Colour' };
const skirtVal = (it, k) => (k === 'height' ? (it.skirt_height > 0 ? Number(it.skirt_height) : null) : (it['skirt_' + k] || ''));
const skirtSame = (k, a, b) => (k === 'height' ? a != null && b != null && Math.abs(a - b) < 0.01 : String(a || '').toLowerCase() === String(b || '').toLowerCase());
const skirtShow = (k, v) => (k === 'height' ? `${num(v)} cm` : v);
/** Cascade the choice so it always matches real stock: returns { f, pool, options }. */
function skirtChoice(skirts, want = {}) {
  const f = {}, options = {};
  let pool = skirts;
  for (const k of SKIRT_KEYS) {
    const vals = [];
    for (const it of pool) { const v = skirtVal(it, k); if (v !== null && v !== '' && !vals.some((x) => skirtSame(k, x, v))) vals.push(v); }
    if (k === 'height') vals.sort((a, b) => a - b);
    if (!vals.length) continue;
    options[k] = vals;
    f[k] = vals.find((x) => skirtSame(k, x, want[k])) ?? vals[0];
    pool = pool.filter((it) => skirtSame(k, skirtVal(it, k), f[k]));
  }
  return { f, pool, options };
}
function skirtSelects(choice, attr) {
  const keys = SKIRT_KEYS.filter((k) => choice.options[k]);
  if (!keys.length) return '';
  return `<div class="skirt-selects">${keys.map((k) => `<label class="field"><span>${SKIRT_KEY_LABEL[k]}</span>
    <select ${attr}="${k}">${choice.options[k].map((v) => `<option value="${esc(v)}" ${skirtSame(k, v, choice.f[k]) ? 'selected' : ''}>${esc(skirtShow(k, v))}</option>`).join('')}</select></label>`).join('')}</div>`;
}
const skirtBody = (f) => ({ skirt_height: f.height ?? null, skirt_style: f.style || '', skirt_colour: f.colour || '' });
const skirtDesc = (f) => (f ? [f.height ? `${num(f.height)}cm high` : '', [f.colour, (f.style || '').toLowerCase()].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '');
/** "40cm", "0.4m", "1m", "40" -> centimetres */
function heightCm(text) {
  const m = String(text || '').match(/(\d+(?:\.\d+)?)\s*(cm|mm|m)?\b/i);
  if (!m) return null;
  const v = Number(m[1]), u = (m[2] || '').toLowerCase();
  return u === 'mm' ? v / 10 : u === 'm' ? v * 100 : (u === 'cm' || v >= 10 ? v : v * 100);
}
const isIncluded = (it) => it.parent_item_id && !Number(it.unit_price);
const pill = (s) => `<span class="pill ${esc(s)}">${esc(STATUS[s] || s)}</span>`;
const overdueBadge = (j) => (j.overdue ? ` <span class="pill overdue" title="Due back ${esc(fmtDate(j.due_back))}">Overdue · ${num(j.days_late)} day${j.days_late === 1 ? '' : 's'}</span>` : '');
const contactLabel = (c) => c ? (c.company && c.company !== c.name ? `${c.name} · ${c.company}` : c.name) : '';

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.classList.add('out'), kind === 'error' ? 5200 : 2800);
  setTimeout(() => t.remove(), kind === 'error' ? 5600 : 3200);
}

function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function download(path) {
  const a = document.createElement('a');
  a.href = '/api' + path;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ---------------------------------------------------------------- modals */

function openModal(inner, { wide } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${inner}</div>`;
  $('#modal-root').appendChild(wrap);
  const onKey = (e) => {
    if (e.key === 'Escape' && wrap === $('#modal-root').lastElementChild) wrap.dispatchEvent(new Event('cancel'));
  };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) wrap.dispatchEvent(new Event('cancel')); });
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  return { el: wrap.firstElementChild, wrap, close };
}

function fieldHTML(f, value) {
  if (f.type === 'heading') {
    return `<div class="form-heading ${f.group ? 'grp-' + f.group : ''}"><h3>${esc(f.label)}</h3>${f.help ? `<small>${esc(f.help)}</small>` : ''}</div>`;
  }
  const id = 'f_' + f.name;
  const val = value ?? f.default ?? '';
  if (f.type === 'checkbox') {
    return `<label class="field check-field ${f.group ? 'grp-' + f.group : ''}" for="${id}"><input id="${id}" name="${f.name}" type="checkbox" ${Number(val) ? 'checked' : ''}>
      <span><strong>${esc(f.label)}</strong>${f.help ? `<small>${esc(f.help)}</small>` : ''}</span></label>`;
  }
  const req = (f.required ? 'required' : '') + (f.disabled ? ' disabled' : '');
  let input;
  if (f.type === 'textarea') {
    input = `<textarea id="${id}" name="${f.name}" rows="${f.rows || 3}" ${req}
      ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}>${esc(val)}</textarea>`;
  } else if (f.type === 'select') {
    input = `<select id="${id}" name="${f.name}" ${req}>${f.options.map(([ov, ol]) =>
      `<option value="${esc(ov)}" ${String(ov) === String(val ?? '') ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select>`;
  } else {
    input = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(val)}" ${req}
      ${f.step ? `step="${f.step}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''}
      ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${f.list ? `list="${id}_list"` : ''} autocomplete="off">`;
    if (f.list) input += `<datalist id="${id}_list">${f.list.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>`;
  }
  const cls = ['field', f.half ? 'half' : '', f.third ? 'third' : '', f.group ? 'grp-' + f.group : ''].join(' ');
  return `<label class="${cls}" for="${id}"><span>${esc(f.label)}${f.required ? ' <em>*</em>' : ''}</span>${input}${f.help ? `<small>${esc(f.help)}</small>` : ''}</label>`;
}

/** Show a form. onSubmit(values) may throw to keep the dialog open with an error. */
function formModal({ title, fields, values = {}, submitLabel = 'Save', wide, onSubmit, onInput, intro, extraButton }) {
  return new Promise((resolve) => {
    const m = openModal(`<form novalidate>
        <header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-x aria-label="Close">×</button></header>
        ${intro ? `<p class="muted" style="margin:0;padding:12px 18px 0">${esc(intro)}</p>` : ''}
        <div class="form-grid">${fields.map((f) => fieldHTML(f, values[f.name])).join('')}</div>
        <p class="form-error" hidden></p>
        <footer>${extraButton ? `<button type="button" class="btn danger" data-extra style="margin-right:auto">${esc(extraButton.label)}</button>` : ''}<button type="button" class="btn" data-x>Cancel</button>
          <button type="submit" class="btn primary">${esc(submitLabel)}</button></footer>
      </form>`, { wide });
    const form = $('form', m.el);
    const err = $('.form-error', form);
    let finished = false;
    const done = (v) => { if (finished) return; finished = true; m.close(); resolve(v); };
    m.wrap.addEventListener('cancel', () => done(null));
    $$('[data-x]', form).forEach((b) => (b.onclick = () => done(null)));

    if (onInput) form.addEventListener('input', (e) => onInput(e, form));
    const xb = $('[data-extra]', form);
    if (xb) {
      xb.onclick = async () => {
        xb.disabled = true;
        try { done(await onSubmit({}, extraButton.value)); } catch (ex) { err.textContent = ex.message; err.hidden = false; xb.disabled = false; }
      };
    }
    const sd = form.elements.start_date, ed = form.elements.end_date;
    if (sd && ed) sd.addEventListener('change', () => { if (!ed.value || ed.value < sd.value) ed.value = sd.value; });

    form.onsubmit = async (e) => {
      e.preventDefault();
      err.hidden = true;
      for (const f of fields) {
        if (f.type === 'heading') continue;
        const el = form.elements[f.name];
        if (f.required && !String(el.value).trim()) {
          err.textContent = `${f.label} is required.`;
          err.hidden = false;
          el.focus();
          return;
        }
      }
      const out = {};
      for (const f of fields) {
        if (f.type === 'heading' || f.disabled) continue;
        const el = form.elements[f.name];
        out[f.name] = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value;
      }
      if (!onSubmit) return done(out);
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      try {
        done(await onSubmit(out));
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        btn.disabled = false;
      }
    };
    setTimeout(() => { const first = $('input,select,textarea', form); first && first.focus(); }, 30);
  });
}

function confirmModal(message, { title = 'Are you sure?', okLabel = 'Delete', danger = true } = {}) {
  return new Promise((resolve) => {
    const m = openModal(`<header><h2>${esc(title)}</h2></header>
      <div class="modal-body"><p>${esc(message)}</p></div>
      <footer><button class="btn" data-no>Cancel</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(okLabel)}</button></footer>`);
    const done = (v) => { m.close(); resolve(v); };
    m.wrap.addEventListener('cancel', () => done(false));
    $('[data-no]', m.el).onclick = () => done(false);
    $('[data-yes]', m.el).onclick = () => done(true);
    setTimeout(() => $('[data-yes]', m.el).focus(), 30);
  });
}

/* ---------------------------------------------------------------- shared forms */

async function contactOptions(extraNew = true) {
  const contacts = await get('/contacts');
  const opts = [['', '— No client —'], ...contacts.map((c) => [c.id, contactLabel(c)])];
  if (extraNew) opts.push(['__new__', '+ Add a new client…']);
  return opts;
}

function jobFields(contactOpts, { full } = {}) {
  const f = [
    { name: 'name', label: 'Job name', required: true, placeholder: 'e.g. Awards Dinner' },
    { name: 'contact_id', label: 'Client', type: 'select', options: contactOpts },
    { name: 'start_date', label: 'Start (out) date', type: 'date', required: true, half: true },
    { name: 'end_date', label: 'End (return) date', type: 'date', required: true, half: true },
    { name: 'venue', label: 'Venue', half: true },
    { name: 'reference', label: 'Client reference / PO', half: true },
    { name: 'status', label: 'Status', type: 'select', options: Object.entries(STATUS), half: true },
  ];
  if (full) {
    f.push(
      { name: 'charge_days', label: 'Chargeable days', type: 'number', step: 'any', min: 0, half: true,
        help: 'Leave blank to charge every day of the hire. Set e.g. 3 to charge a week as three days.' },
      { name: 'discount_pct', label: 'Job discount %', type: 'number', step: 'any', min: 0, half: true },
      { name: 'notes', label: 'Notes for the client (on the quote and the Zoho invoice)', type: 'textarea' },
      { name: 'internal_notes', label: 'Internal notes (not printed)', type: 'textarea' },
    );
  } else {
    f.find((x) => x.name === 'status').half = false;
  }
  return f;
}

function jobPayload(v) {
  const out = { ...v };
  out.contact_id = v.contact_id ? Number(v.contact_id) : null;
  if ('charge_days' in v) out.charge_days = v.charge_days === '' ? null : v.charge_days;
  if ('discount_pct' in v) out.discount_pct = v.discount_pct || 0;
  return out;
}

async function resolveNewContact(values) {
  if (values.contact_id !== '__new__') return values;
  const c = await contactModal();
  if (!c) throw new Error('Pick a client, or choose “No client”.');
  return { ...values, contact_id: String(c.id) };
}

async function newJob(prefill = {}) {
  const opts = await contactOptions();
  const today = todayISO();
  const job = await formModal({
    title: 'New job',
    fields: jobFields(opts),
    values: { start_date: today, end_date: today, status: 'enquiry', ...prefill },
    submitLabel: 'Create job',
    onSubmit: async (v) => post('/jobs', jobPayload(await resolveNewContact(v))),
  });
  if (job) { toast(`${job.number} created`, 'ok'); location.hash = `#/job/${job.id}`; }
}

const PLUG_TYPES = ['UK 13A', '16A CEE', '32A CEE', 'IEC C13', 'IEC C19', 'powerCON', 'powerCON TRUE1', 'Schuko', '15A Round Pin'];

const TYPE_LABEL = { equipment: 'Equipment', cable: 'Cables', power: 'Power distribution', package: 'Packages', case: 'Flight cases' };
const TYPE_ONE = { equipment: 'equipment item', cable: 'cable', power: 'lead / distro', package: 'package', case: 'flight case' };
const volts = () => Number(S.settings.mains_voltage) || 230;
const ampsOf = (w) => (Number(w) || 0) / volts();

function subHireFields(vendorOpts) {
  return [
    { type: 'heading', label: 'Sub-hire', help: 'Who you hire this in from. If you own some, a job that needs more than you have can sub-hire the extra from them. Tick the box if you don’t own any at all.' },
    { name: 'sub_hire', label: 'Not owned — always hired in from a vendor', type: 'checkbox' },
    { name: 'vendor_id', label: 'Sub-hire from', type: 'select', options: vendorOpts, half: true },
    { name: 'sub_hire_cost', label: 'Their price per day (what you pay)', type: 'number', min: 0, step: '0.01', half: true },
  ];
}

const EQUIP_KINDS = [
  ['powered', 'Powered equipment — speakers, lighting, video, mixers'],
  ['stand', 'Stand, truss or rigging'],
  ['deck', 'Stage deck'],
  ['skirt', 'Stage skirt'],
  ['staging', 'Staging accessory — legs, clamps, steps'],
  ['general', 'Other — cases, drape, furniture (no power)'],
];
const KIND_SHORT = { powered: 'Powered', stand: 'Stand / truss', deck: 'Stage deck', skirt: 'Stage skirt', staging: 'Staging', general: 'Other' };

/** Show only the fields for the chosen kind of item (and, for stands, the chosen height type). */
function applyKindVisibility(form) {
  const kindEl = form.elements.equip_kind;
  if (!kindEl) return;
  const kind = kindEl.value;
  const mode = form.elements.stand_height_mode ? form.elements.stand_height_mode.value : '';
  for (const el of form.querySelectorAll('[class*="grp-k-"]')) {
    let show = el.classList.contains('grp-k-' + kind);
    for (const m of ['fixed', 'range', 'stepped']) if (el.classList.contains('h-' + m) && mode !== m) show = false;
    el.hidden = !show;
  }
}

/** A stand's height in words, e.g. "1.3–2.1 m", "1.2 / 1.6 / 2 m" or "1.8 m". */
function standHeight(p) {
  if (p.stand_height_mode === 'fixed' && p.stand_h) return `${num(p.stand_h)} m`;
  if (p.stand_height_mode === 'range' && p.stand_h_max) return `${num(p.stand_h_min)}–${num(p.stand_h_max)} m`;
  if (p.stand_height_mode === 'stepped' && p.stand_h_steps) return `${p.stand_h_steps.split(/,\s*/).join(' / ')} m`;
  return '';
}

function productFields(type, { cats, subcats = [], cableTypes, joinerOpts, tracked, units, isNew, brands = [], vendorOpts = [], caseForOpts = [] }) {
  const u = sizeUnit();
  const base = [
    { name: 'name', label: type === 'cable' ? 'Cable name' : 'Name', required: true,
      placeholder: type === 'cable' ? 'e.g. XLR Cable' : type === 'power' ? 'e.g. 4-Way Extension Lead 10m' : '' },
    { name: 'brand', label: 'Brand', list: brands, half: true, placeholder: type === 'cable' ? 'e.g. Van Damme' : 'e.g. QSC' },
    { name: 'category', label: 'Category', list: cats, half: true,
      placeholder: type === 'cable' ? 'e.g. Audio Cables' : type === 'power' ? 'e.g. Power' : 'e.g. Lighting' },
    { name: 'subcategory', label: 'Subcategory (optional)', list: subcats, half: true,
      placeholder: type === 'equipment' ? 'e.g. IP rated, Wash, Hybrid' : 'optional', help: 'Groups items within the category.' },
  ];
  if (type === 'cable') {
    return [...base,
      { name: 'cable_type', label: 'Cable type', list: cableTypes, half: true, placeholder: 'e.g. XLR',
        help: 'Runs are built from every length of this type.' },
      { name: 'day_rate', label: 'Day rate (for new lengths)', type: 'number', min: 0, step: '0.01', half: true },
      { name: 'replacement_value', label: 'Replacement value (for new lengths)', type: 'number', min: 0, step: '0.01', half: true },
      { name: 'joiner_product_id', label: 'To extend it, join with', type: 'select', options: joinerOpts,
        help: 'E.g. an HDMI barrel. A joiner that is itself a cable adds its length to the run; a connector block doesn’t.' },
      { name: 'power_cable', label: 'This is a power cable / extension', type: 'checkbox',
        help: 'Its sockets count towards a job’s power check. In a run of extensions only the sockets on the last one are free.' },
      { name: 'sockets', label: 'Sockets at the end', type: 'number', min: 0, step: 1, third: true, group: 'pc', placeholder: 'e.g. 1 or 4' },
      { name: 'socket_type', label: 'Socket type', list: PLUG_TYPES, third: true, group: 'pc', placeholder: 'e.g. 16A CEE' },
      { name: 'power_rating_a', label: 'Rating (amps)', type: 'number', min: 0, step: 'any', third: true, group: 'pc', placeholder: 'e.g. 16' },
      { name: 'plug_type', label: 'Plugs into', list: PLUG_TYPES, half: true, group: 'pc', placeholder: 'e.g. 16A CEE' },
      ...(isNew ? [{ name: 'lengths', label: 'Lengths you own', placeholder: 'e.g. 3m × 20, 5m × 20, 10m × 40',
        help: 'You can add or change lengths later on the cable’s page.' }] : []),
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 }];
  }
  const stock = [
    { name: 'sku', label: 'Code / barcode', half: true, placeholder: 'Type it or scan a barcode',
      help: 'For items counted by quantity: scanning this code at check-out ticks off one.' },
    { name: 'quantity', label: 'Quantity owned', type: 'number', min: 0, step: 1, third: true, disabled: tracked,
      help: tracked ? `Set by its unit list (${units} unit${units === 1 ? '' : 's'})` : '' },
    { name: 'day_rate', label: 'Day rate', type: 'number', min: 0, step: '0.01', third: true },
    { name: 'replacement_value', label: 'Replacement value', type: 'number', min: 0, step: '0.01', third: true },
    { name: 'weight_kg', label: 'Weight (kg)', type: 'number', min: 0, step: 'any', half: true },
  ];
  const size = [
    { type: 'heading', label: 'Size (for the room planner)', help: 'Roughly — width × depth × height. Used to draw it in room plans. Switch between cm and mm on the right.' },
    { name: 'size_w', label: `Width (${u})`, type: 'number', min: 0, step: 'any', third: true, placeholder: u === 'mm' ? 'e.g. 430' : 'e.g. 43' },
    { name: 'size_d', label: `Depth (${u})`, type: 'number', min: 0, step: 'any', third: true, placeholder: u === 'mm' ? 'e.g. 360' : 'e.g. 36' },
    { name: 'size_h', label: `Height (${u})`, type: 'number', min: 0, step: 'any', third: true, placeholder: u === 'mm' ? 'e.g. 680' : 'e.g. 68' },
    { name: 'plan_shape', label: 'Shape on plans', type: 'select', half: true, options: [['box', 'Box / rectangle'], ['round', 'Round']] },
  ];
  if (type === 'case') {
    return [
      { name: 'name', label: 'Flight case name', required: true, placeholder: 'e.g. SQ5 Flight Case, or Cable Trunk' },
      { name: 'brand', label: 'Brand', list: brands, half: true, placeholder: 'e.g. Flightcase Warehouse' },
      { name: 'category', label: 'Category', list: cats, half: true, placeholder: 'e.g. Flight cases' },
      { name: 'case_for_id', label: 'Made for', type: 'select', options: caseForOpts,
        help: 'Link it to the item it carries, e.g. an SQ5 case to the SQ5. Leave it general (a trunk, a cable case) and scanning it at check-out offers to load it: everything scanned after goes in the case.' },
      { name: 'sku', label: 'Code / barcode', half: true, placeholder: 'Type it or scan a barcode',
        help: 'Give each case its own barcode under Units once it’s saved.' },
      { name: 'quantity', label: 'How many you own', type: 'number', min: 0, step: 1, half: true, disabled: tracked,
        help: tracked ? `Set by its unit list (${units} unit${units === 1 ? '' : 's'})` : '' },
      { name: 'day_rate', label: 'Day rate', type: 'number', min: 0, step: '0.01', third: true },
      { name: 'replacement_value', label: 'Replacement value', type: 'number', min: 0, step: '0.01', third: true },
      { name: 'weight_kg', label: 'Empty weight (kg)', type: 'number', min: 0, step: 'any', third: true,
        help: 'Packed weight adds what’s loaded in it.' },
      { type: 'heading', label: 'Outside size', help: 'Width × depth × height of the case itself. Switch between cm and mm on the right.' },
      { name: 'size_w', label: `Width (${u})`, type: 'number', min: 0, step: 'any', third: true },
      { name: 'size_d', label: `Depth (${u})`, type: 'number', min: 0, step: 'any', third: true },
      { name: 'size_h', label: `Height (${u})`, type: 'number', min: 0, step: 'any', third: true },
      { type: 'heading', label: 'Inside size', help: 'The space inside, so you know what fits.' },
      { name: 'inner_w', label: `Width (${u})`, type: 'number', min: 0, step: 'any', third: true },
      { name: 'inner_d', label: `Depth (${u})`, type: 'number', min: 0, step: 'any', third: true },
      { name: 'inner_h', label: `Height (${u})`, type: 'number', min: 0, step: 'any', third: true },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 }];
  }
  if (type === 'package') {
    return [
      { name: 'name', label: 'Package name', required: true, placeholder: 'e.g. Sennheiser 4-way RF rack' },
      { name: 'brand', label: 'Brand', list: brands, half: true },
      { name: 'category', label: 'Category', list: cats, half: true, placeholder: 'e.g. Audio' },
      { name: 'subcategory', label: 'Subcategory (optional)', list: subcats, half: true },
      { name: 'sku', label: 'Code / barcode', half: true, placeholder: 'e.g. PKG-RF4' },
      { name: 'day_rate', label: 'Package price per day', type: 'number', min: 0, step: '0.01', half: true,
        help: 'Covers everything in it. Leave at 0 to charge each item at its own day rate instead.' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 }];
  }
  if (type === 'power') {
    return [...base, ...stock, ...subHireFields(vendorOpts),
      { type: 'heading', label: 'Sockets', help: 'Jobs check there’s a socket for every powered item.' },
      { name: 'sockets', label: 'Number of sockets', type: 'number', min: 0, step: 1, third: true, required: true },
      { name: 'socket_type', label: 'Socket type', list: PLUG_TYPES, third: true, placeholder: 'UK 13A' },
      { name: 'power_rating_a', label: 'Rating (amps)', type: 'number', min: 0, step: 'any', third: true, placeholder: 'e.g. 13' },
      { name: 'plug_type', label: 'Plugs into', list: PLUG_TYPES, half: true, placeholder: 'e.g. UK 13A or 32A CEE' },
      ...size,
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 }];
  }
  return [
    { name: 'equip_kind', label: 'What kind of item is it?', type: 'select', options: EQUIP_KINDS,
      help: 'Only the details that matter for that kind are shown — a stage deck doesn’t need a power draw, a speaker doesn’t need deck sizes.' },
    ...base, ...stock, ...subHireFields(vendorOpts),
    // stage deck
    { type: 'heading', label: 'Stage deck', help: 'The size of the deck’s top — used by the stage calculator.', group: 'k-deck' },
    { name: 'deck_w', label: 'Deck width (m)', type: 'number', min: 0, step: 'any', half: true, placeholder: 'e.g. 2', group: 'k-deck' },
    { name: 'deck_d', label: 'Deck depth (m)', type: 'number', min: 0, step: 'any', half: true, placeholder: 'e.g. 1', group: 'k-deck' },
    // stage skirt
    { type: 'heading', label: 'Stage skirt', help: 'Used to work out skirts from a stage’s perimeter.', group: 'k-skirt' },
    { name: 'skirt_len', label: 'Skirt length (m)', type: 'number', min: 0, step: 'any', half: true, placeholder: 'e.g. 3', group: 'k-skirt' },
    { name: 'skirt_height', label: 'Skirt height (cm)', type: 'number', min: 0, step: 'any', half: true, placeholder: 'e.g. 40', group: 'k-skirt' },
    { name: 'skirt_style', label: 'Skirt style', list: ['Box pleat', 'Pleated', 'Ruched', 'Flat', 'Valance'], half: true, placeholder: 'e.g. Box pleat', group: 'k-skirt' },
    { name: 'skirt_colour', label: 'Skirt colour', list: ['Black', 'White', 'Navy', 'Grey', 'Red', 'Silver'], half: true, placeholder: 'e.g. Black', group: 'k-skirt' },
    // stand
    { type: 'heading', label: 'Stand', help: 'Heights are in metres. The maximum load is what it can safely hold.', group: 'k-stand' },
    { name: 'stand_height_mode', label: 'Height', type: 'select', half: true, group: 'k-stand',
      options: [['', 'Not set'], ['fixed', 'Fixed height'], ['range', 'Adjustable — lowest to highest'], ['stepped', 'Stepped — set heights only']] },
    { name: 'stand_load_kg', label: 'Maximum load (kg)', type: 'number', min: 0, step: 'any', half: true, placeholder: 'e.g. 50', group: 'k-stand' },
    { name: 'stand_h', label: 'Height (m)', type: 'number', min: 0, step: 'any', half: true, placeholder: 'e.g. 1.8', group: 'k-stand h-fixed' },
    { name: 'stand_h_min', label: 'Lowest (m)', type: 'number', min: 0, step: 'any', half: true, placeholder: 'e.g. 1.3', group: 'k-stand h-range' },
    { name: 'stand_h_max', label: 'Highest (m)', type: 'number', min: 0, step: 'any', half: true, placeholder: 'e.g. 2.1', group: 'k-stand h-range' },
    { name: 'stand_h_steps', label: 'Heights it can be set to (m)', placeholder: 'e.g. 1.2, 1.6, 2.0', group: 'k-stand h-stepped',
      help: 'Separate them with commas.' },
    // powered
    { type: 'heading', label: 'Power', help: `Fill in watts or amps — the other is worked out at ${num(volts())} V.`, group: 'k-powered' },
    { name: 'plugs_in', label: 'Plugs in (needs a mains socket)', type: 'checkbox', group: 'k-powered',
      help: 'Counted when working out how many extension leads and sockets a job needs — even if you don’t know its power draw.' },
    { name: 'power_watts', label: 'Watts', type: 'number', min: 0, step: 'any', half: true, placeholder: 'e.g. 400', group: 'k-powered' },
    { name: 'power_amps', label: 'Amps', type: 'number', min: 0, step: 'any', half: true, placeholder: 'e.g. 1.7', group: 'k-powered' },
    ...size,
    { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 }];
}

function parseLengths(text) {
  const out = [];
  for (const part of String(text || '').split(/[,;\n]+/)) {
    const m = part.match(/(\d+(?:\.\d+)?)\s*m?\s*(?:[x×*]\s*(\d+))?/i);
    if (m && Number(m[1]) > 0) out.push({ length_m: Number(m[1]), quantity: Number(m[2] || 0) });
  }
  return out;
}

async function productModal(product, type, preset = {}) {
  type = (product && product.item_type) || type || 'equipment';
  const [all, flat, vendors] = await Promise.all([get('/products?archived=1'), get('/products?flat=1'), get('/vendors')]);
  const vendorOpts = [['', 'Choose a vendor…'], ...vendors.map((x) => [x.id, x.name]), ['__new', '+ New vendor…']];
  const cats = [...new Set(all.filter((p) => p.item_type === type).map((p) => p.category).filter(Boolean))].sort();
  const subcats = [...new Set(all.map((p) => (p.subcategory || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const brands = [...new Set(all.map((p) => (p.brand || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  let unit = sizeUnit();

  const cableTypes = [...new Set(all.filter((p) => p.item_type === 'cable').map((p) => p.cable_type).filter(Boolean))].sort();
  const joinerOpts = [['', 'Nothing — plugs straight in'], ...flat
    .filter((p) => !product || (p.id !== product.id && p.parent_id !== product.id))
    .map((p) => [p.id, p.name + (p.length_m ? ' (cable — adds its length)' : '')])];
  const units = product ? (product.assets ? product.assets.length : product.asset_count || 0) : 0;
  const v = product ? { ...product } : { quantity: type === 'cable' ? '' : 1, plugs_in: 0, ...preset };
  if (!v.vendor_id) v.vendor_id = '';
  if (!v.sub_hire_cost) v.sub_hire_cost = '';
  if (type === 'equipment' && !v.equip_kind) v.equip_kind = preset.equip_kind || 'powered';
  for (const k of ['stand_h', 'stand_h_min', 'stand_h_max', 'stand_load_kg', ...SIZE_KEYS]) if (v[k] == null) v[k] = '';
  for (const k of SIZE_KEYS) v[k] = sizeShown(v[k], unit);
  if (!v.case_for_id) v.case_for_id = '';
  const caseForOpts = [['', 'Nothing — a general case (load it at check-out)'], ...flat
    .filter((x) => !['case', 'package'].includes(x.item_type) && (!product || x.id !== product.id))
    .map((x) => [x.id, [x.brand, x.name].filter(Boolean).join(' ')])];
  if (v.subcategory == null) v.subcategory = '';
  if (!v.plan_shape) v.plan_shape = 'box';
  if (!v.plugs_in && !product && v.equip_kind === 'powered') v.plugs_in = 1;
  for (const k of ['power_watts', 'sockets', 'power_rating_a', 'deck_w', 'deck_d', 'skirt_len', 'skirt_height']) if (!v[k]) v[k] = '';
  if (v.power_watts) v.power_amps = +ampsOf(v.power_watts).toFixed(2);
  if (!v.joiner_product_id) v.joiner_product_id = '';
  setTimeout(() => {
    const pc = $('.modal [name="power_cable"]');
    if (pc) $$('.modal .grp-pc').forEach((x) => (x.hidden = !pc.checked));
    const sh = $('.modal [name="sub_hire"]');
    if (sh) $$('.modal .grp-sh').forEach((x) => (x.hidden = !sh.checked));
    const fm = $('.modal form');
    if (fm) applyKindVisibility(fm);
    const szh = $$('.modal .form-heading').find((h) => /Size \(for the room planner\)|Outside size/.test(h.textContent));
    if (szh && fm) {
      szh.classList.add('with-switch');
      szh.insertAdjacentHTML('beforeend', `<div class="seg" role="group" aria-label="Size units">
        <button type="button" data-size-u="cm" class="${unit === 'cm' ? 'on' : ''}">cm</button><button type="button" data-size-u="mm" class="${unit === 'mm' ? 'on' : ''}">mm</button></div>`);
      szh.addEventListener('click', (e) => {
        const b = e.target.closest('[data-size-u]');
        if (!b || b.dataset.sizeU === unit) return;
        const to = b.dataset.sizeU;
        for (const [k, lbl] of [['size_w', 'Width'], ['size_d', 'Depth'], ['size_h', 'Height'], ['inner_w', 'Width'], ['inner_d', 'Depth'], ['inner_h', 'Height']]) {
          const el = fm.elements[k];
          if (!el) continue;
          if (el.value !== '') el.value = +(to === 'mm' ? Number(el.value) * 10 : Number(el.value) / 10).toFixed(2);
          const span = el.closest('label') && $('span', el.closest('label'));
          if (span) span.textContent = `${lbl} (${to})`;
        }
        unit = to;
        setSizeUnit(to);
        $$('[data-size-u]', szh).forEach((x) => x.classList.toggle('on', x.dataset.sizeU === to));
      });
    }
  }, 0);
  const res = await formModal({
    title: `${product ? 'Edit' : 'Add'} ${TYPE_ONE[type]}`, wide: true,
    fields: productFields(type, { cats, subcats, cableTypes, joinerOpts, tracked: units > 0, units, isNew: !product, brands, vendorOpts, caseForOpts }),
    values: v,
    onInput: (e, form) => {
      if (e.target.name === 'power_cable') { $$('.grp-pc', form).forEach((x) => (x.hidden = !e.target.checked)); return; }
      if (e.target.name === 'sub_hire') { $$('.grp-sh', form).forEach((x) => (x.hidden = !e.target.checked)); return; }
      if (e.target.name === 'equip_kind' || e.target.name === 'stand_height_mode') {
        applyKindVisibility(form);
        if (e.target.name === 'equip_kind' && e.target.value === 'powered' && form.elements.plugs_in && !form.elements.power_watts.value) form.elements.plugs_in.checked = true;
        return;
      }
      if (e.target.name === 'vendor_id' && e.target.value === '__new') {
        const sel = e.target;
        sel.value = '';
        vendorModal().then((nv) => {
          if (!nv) return;
          sel.insertAdjacentHTML('beforeend', `<option value="${nv.id}">${esc(nv.name)}</option>`);
          sel.value = String(nv.id);
        });
        return;
      }
      const V = volts();
      if (e.target.name === 'power_watts' && Number(e.target.value) > 0 && form.elements.plugs_in) form.elements.plugs_in.checked = true;
      if (e.target.name === 'power_watts' && form.elements.power_amps) {
        form.elements.power_amps.value = e.target.value === '' ? '' : +(Number(e.target.value) / V).toFixed(2);
      } else if (e.target.name === 'power_amps' && form.elements.power_watts) {
        form.elements.power_watts.value = e.target.value === '' ? '' : +(Number(e.target.value) * V).toFixed(1);
      }
    },
    onSubmit: async (vals) => {
      const body = { ...vals, item_type: type };
      if (type === 'equipment') {
        const k = body.equip_kind;
        if (k !== 'powered') { delete body.power_watts; delete body.power_amps; delete body.plugs_in; }
        if (k !== 'stand') { for (const f of ['stand_height_mode', 'stand_h', 'stand_h_min', 'stand_h_max', 'stand_h_steps', 'stand_load_kg']) delete body[f]; }
        if (k !== 'deck') { delete body.deck_w; delete body.deck_d; }
        if (k !== 'skirt') { for (const f of ['skirt_len', 'skirt_height', 'skirt_style', 'skirt_colour']) delete body[f]; }
        for (const f of ['stand_h', 'stand_h_min', 'stand_h_max', 'stand_load_kg', 'deck_w', 'deck_d', 'skirt_len', 'skirt_height']) if (body[f] === '') body[f] = null;
      }
      if ('case_for_id' in body) body.case_for_id = body.case_for_id === '' ? null : Number(body.case_for_id);
      for (const f of SIZE_KEYS) {
        if (!(f in body)) continue;
        if (body[f] === '' || body[f] == null) body[f] = null;
        else if (unit === 'mm') body[f] = +(Number(body[f]) / 10).toFixed(3);
      }
      if ('sub_hire' in body) {
        if (Number(body.sub_hire) && !body.vendor_id) throw new Error('Choose which vendor you sub-hire it from');
        if (body.vendor_id === '' || body.vendor_id === '__new') body.vendor_id = null;
        if (body.sub_hire_cost === '') body.sub_hire_cost = 0;
      }
      const lengths = parseLengths(body.lengths);
      delete body.lengths;
      if (type === 'equipment' && body.power_watts === '' && body.power_amps === '') body.power_watts = 0;
      if (type === 'equipment' && body.power_watts !== '') delete body.power_amps;
      const saved = product ? await put(`/products/${product.id}`, body) : await post('/products', body);
      for (const l of lengths) await post(`/products/${saved.id}/lengths`, l);
      return saved;
    },
  });
  return res;
}

const CONTACT_FIELDS = [
  { name: 'name', label: 'Contact name', required: true },
  { name: 'company', label: 'Company / organisation' },
  { name: 'email', label: 'Email', type: 'email', half: true },
  { name: 'phone', label: 'Phone', half: true },
  { name: 'address', label: 'Address', type: 'textarea', rows: 3 },
  { name: 'account_ref', label: 'Accounts reference (optional)', half: true, placeholder: 'e.g. EXAMPLE01',
    help: 'Their customer account code in Sage 50. Other software matches by company name.' },
  { type: 'heading', label: 'Job numbers (optional)', help: 'Give this client their own job number prefix and count, e.g. ACME-1, ACME-2. Leave blank to use your usual numbering.' },
  { name: 'job_prefix', label: 'Job number prefix', half: true, placeholder: 'e.g. ACME-' },
  { name: 'next_job_number', label: 'Their next job number', type: 'number', min: 1, step: 1, half: true, placeholder: '1' },
  { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
];

const VENDOR_FIELDS = [
  { name: 'name', label: 'Company name', required: true, placeholder: 'e.g. Stage Hire Co' },
  { name: 'contact_name', label: 'Contact person', half: true },
  { name: 'account_ref', label: 'Your account number with them', half: true },
  { name: 'email', label: 'Email', type: 'email', half: true },
  { name: 'phone', label: 'Phone', half: true },
  { name: 'website', label: 'Website', placeholder: 'e.g. stagehire.co.uk' },
  { name: 'address', label: 'Address (collections / returns)', type: 'textarea', rows: 3 },
  { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, placeholder: 'e.g. order by Wednesday for weekend jobs, delivery terms' },
];
function vendorModal(vendor) {
  return formModal({
    title: vendor ? 'Edit vendor' : 'New vendor',
    fields: VENDOR_FIELDS,
    values: vendor || {},
    onSubmit: (v) => vendor ? put(`/vendors/${vendor.id}`, v) : post('/vendors', v),
  });
}

function contactModal(contact) {
  return formModal({
    title: contact ? 'Edit client' : 'New client',
    fields: CONTACT_FIELDS,
    values: { ...(contact || {}), next_job_number: (contact && contact.next_job_number) || '' },
    onSubmit: (v) => {
      const body = { ...v, next_job_number: v.next_job_number === '' || v.next_job_number == null ? null : Number(v.next_job_number) };
      return contact ? put(`/contacts/${contact.id}`, body) : post('/contacts', body);
    },
  });
}

function importModal(kind) {
  const isProducts = kind === 'products';
  return new Promise((resolve) => {
    const m = openModal(`<header><h2>Import ${isProducts ? 'stock' : 'clients'} from CSV</h2>
        <button class="icon-btn" data-x aria-label="Close">×</button></header>
      <div class="modal-body">
        <p>Export a CSV from Current RMS (or save any spreadsheet as CSV) and choose it below.
        Columns are matched by name, so the order doesn’t matter.</p>
        <p class="muted">${isProducts
          ? 'Recognised columns: Name / Product Name, Category / Product Group, Code / SKU / Barcode, Quantity / Quantity Held / Stock, Day Rate / Rental Price, Replacement Value / Replacement Charge, Weight, Notes.'
          : 'Recognised columns: Name (or First Name + Last Name), Company / Organisation, Email, Phone / Telephone / Mobile, Address, Notes.'}
        Rows that match an existing ${isProducts ? 'code or name' : 'email or name'} are updated rather than duplicated.</p>
        <input type="file" accept=".csv,text/csv" data-file>
        <p class="form-error" hidden></p>
      </div>
      <footer><button class="btn" data-x>Close</button></footer>`);
    const done = (v) => { m.close(); resolve(v); };
    m.wrap.addEventListener('cancel', () => done(null));
    $$('[data-x]', m.el).forEach((b) => (b.onclick = () => done(null)));
    $('[data-file]', m.el).onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const err = $('.form-error', m.el);
      try {
        const res = await post(`/import/${kind}`, { csv: await file.text() });
        toast(`Imported: ${res.added} added, ${res.updated} updated${res.skipped ? `, ${res.skipped} skipped` : ''}`, 'ok');
        done(res);
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      }
    };
  });
}

/* ---------------------------------------------------------------- router */

const NAV_OF = { roi: 'stock', plan: 'jobs', job: 'jobs', product: 'stock', contact: 'contacts', print: 'jobs', check: 'jobs', vendor: 'vendors' };

async function router() {
  document.body.classList.remove('printing');
  $('#print-root').innerHTML = '';
  const [page = 'dashboard', a, b] = location.hash.replace(/^#\/?/, '').split('/');
  const nav = NAV_OF[page] || page;
  $$('[data-nav]').forEach((el) => el.classList.toggle('active', el.dataset.nav === nav));
  const view = $('#view');
  view.onclick = view.onchange = view.oninput = view.onkeydown = view.onfocusin = view.onfocusout = null;
  view.onpointerdown = view.onpointermove = view.onpointerup = view.onpointercancel = null;
  try {
    switch (page) {
      case '': case 'dashboard': await renderDashboard(view); break;
      case 'jobs': await renderJobs(view); break;
      case 'job': await renderJob(view, Number(a)); break;
      case 'availability': await renderAvailability(view); break;
      case 'stock': await renderStock(view); break;
      case 'product': await renderProduct(view, Number(a)); break;
      case 'roi': await renderRoi(view); break;
      case 'contacts': await renderContacts(view); break;
      case 'quarantine': await renderQuarantine(view); break;
      case 'activity': await renderActivity(view, a, b); break;
      case 'requests': await renderRequests(view); break;
      case 'changelog': await renderChangelog(view); break;
      case 'scan': await renderScan(view); break;
      case 'plan': await renderPlan(view, Number(a)); break;
      case 'check': await renderCheck(view, Number(a), b === 'in' ? 'in' : 'out'); break;
      case 'contact': await renderContact(view, Number(a)); break;
      case 'vendors': await renderVendors(view); break;
      case 'vendor': await renderVendor(view, Number(a)); break;
      case 'settings': await renderSettings(view, a); break;
      case 'print': await renderPrint(Number(a), b || 'quote'); break;
      default: location.hash = '#/dashboard';
    }
  } catch (e) {
    view.innerHTML = `<div class="page"><div class="card"><div class="body">
      <h2>Something went wrong</h2><p>${esc(e.message)}</p>
      <a class="btn" href="#/dashboard">Back to dashboard</a></div></div></div>`;
  }
}

/* ---------------------------------------------------------------- dashboard */

function jobRow(j, { showStatus = true } = {}) {
  return `<tr class="click" data-href="#/job/${j.id}">
    <td><span class="mono muted">${esc(j.number)}</span><br><strong>${esc(j.name)}</strong></td>
    <td>${esc(j.contact_company || j.contact_name || '')}${j.contact_company && j.contact_name ? `<br><span class="muted">${esc(j.contact_name)}</span>` : ''}</td>
    <td>${esc(fmtRange(j.start_date, j.end_date))}</td>
    ${showStatus ? `<td>${pill(j.status)}</td>` : ''}
    <td class="n">${j.totals ? money(j.totals.net) : ''}</td>
  </tr>`;
}

function rowLinks(view) {
  view.onclick = (e) => {
    const tr = e.target.closest('[data-href]');
    if (tr && !e.target.closest('a,button,input,select')) location.hash = tr.dataset.href;
  };
}

async function renderDashboard(view) {
  const d = await get('/dashboard');
  const fresh = d.product_count === 0 && Object.values(d.counts).every((n) => n === 0);
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  view.innerHTML = `<div class="page">
    <div class="page-head">
      <div><h1>${greet}</h1><div class="sub">${esc(fmtDate(d.today, true))}</div></div>
      <div class="actions"><a class="btn" href="#/availability">Check availability</a>
        <button class="btn primary" data-new-job>New job</button></div>
    </div>
    ${fresh ? `<div class="card welcome"><h2>Welcome to ${esc(appName())}</h2>
      <p class="muted">Everything is stored on this computer. To get going:</p>
      <ol>
        <li><a href="#/stock">Add your stock</a> — or import a CSV exported from Current RMS.</li>
        <li><a href="#/contacts">Add your clients</a> (you can also add them while creating a job).</li>
        <li><a href="#/settings">Open Settings</a> to add your logo and company details, and connect Zoho Books for invoicing.</li>
        <li>Create a job, add equipment, and print the prep list.</li>
      </ol></div><div style="height:16px"></div>` : ''}
    <div class="tiles">
      <div class="card tile"><div class="label">Going out</div><div class="value">${d.going_out.length}</div>
        <div class="note">Jobs starting in the next 7 days</div></div>
      <div class="card tile"><div class="label">On hire now</div><div class="value">${d.out_now.length}</div>
        <div class="note">${plural(d.counts.out || 0, 'job')} dispatched</div></div>
      <div class="card tile ${d.overdue.length ? 'alert' : ''}"><div class="label">Overdue returns</div>
        <div class="value">${d.overdue.length}</div><div class="note">Past their return date</div></div>
      <a class="card tile tile-link ${d.quarantine_units ? 'warn' : ''}" href="#/quarantine"><div class="label">In quarantine</div>
        <div class="value">${num(d.quarantine_units)}</div><div class="note">Units out of service</div></a>
    </div>
    <div class="grid-2">
      <div class="card"><header><h2>Next 14 days</h2><a href="#/jobs">All jobs →</a></header>
        ${d.upcoming.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Job</th><th>Client</th><th>Dates</th><th>Status</th></tr></thead>
          <tbody>${d.upcoming.map((j) => `<tr class="click" data-href="#/job/${j.id}">
            <td><span class="mono muted">${esc(j.number)}</span><br><strong>${esc(j.name)}</strong></td>
            <td>${esc(j.contact_company || j.contact_name || '')}</td>
            <td>${esc(fmtRange(j.start_date, j.end_date))}</td><td>${pill(j.status)}</td></tr>`).join('')}</tbody></table></div>`
          : '<div class="empty">Nothing booked in the next two weeks.</div>'}
      </div>
      <div class="stack">
        ${d.overdue.length ? `<div class="card"><header><h2>Overdue returns</h2></header>
          <table class="table"><tbody>${d.overdue.map((j) => `<tr class="click" data-href="#/job/${j.id}">
            <td><strong>${esc(j.name)}</strong><br><span class="muted">${esc(j.contact_company || j.contact_name || '')}</span></td>
            <td class="n"><span class="badge bad">Due ${esc(fmtDate(j.end_date))}</span>${j.days_late ? `<br><span class="muted small">${plural(j.days_late, 'day')} late</span>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
        <div class="card"><header><h2>Stock warnings</h2><span class="muted">next 90 days</span></header>
          ${d.shortages.length ? `<table class="table"><tbody>${d.shortages.map((s) => `
            <tr class="click" data-href="#/availability/${s.first_date}">
              <td><strong>${esc(s.name)}</strong><br><span class="muted">From ${esc(fmtDate(s.first_date, true))} · own ${num(s.owned)}${s.quarantined ? `, ${num(s.quarantined)} in quarantine` : ''}</span></td>
              <td class="n"><span class="badge ${s.firm ? 'bad' : 'warn'}">${s.firm ? 'Short' : 'Provisional'} ${num(s.short_by)}</span></td>
            </tr>`).join('')}</tbody></table>`
          : '<div class="empty">No shortages — everything booked is covered.</div>'}
        </div>
        <div class="card"><header><h2>Ready to invoice</h2><span class="muted">${d.zoho_connected ? 'send from the job' : '<a href="#/settings/zoho">connect Zoho</a>'}</span></header>
          ${d.ready_to_invoice.length ? `<table class="table"><tbody>${d.ready_to_invoice.map((j) => `
            <tr class="click" data-href="#/job/${j.id}"><td><strong>${esc(j.name)}</strong><br><span class="muted">${esc(j.contact_company || j.contact_name || 'No client')} · back ${esc(fmtDate(j.end_date))}</span></td>
              <td class="n">${money(j.totals.net)}</td></tr>`).join('')}</tbody></table>`
          : '<div class="empty">Nothing waiting. Returned jobs not yet sent to Zoho appear here.</div>'}
        </div>
      </div>
    </div></div>`;
  rowLinks(view);
  $('[data-new-job]', view).onclick = () => newJob();
}

/* ---------------------------------------------------------------- jobs list */

async function renderJobs(view) {
  view.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Jobs &amp; quotes</h1></div>
      <div class="actions"><button class="btn" data-invoices>Invoices…</button><button class="btn" data-export>Export CSV</button>
        <button class="btn primary" data-new-job>New job</button></div></div>
    <div class="toolbar">
      <div class="tabs">${JOB_FILTERS.map(([k, l]) => `<button data-filter="${k}" class="${S.jobFilter === k ? 'active' : ''}">${l}</button>`).join('')}</div>
      <span class="spacer"></span>
      <input class="search" type="search" placeholder="Search jobs, clients, venues…" value="${esc(S.jobQuery)}" data-q>
    </div>
    <div class="card" data-list><div class="empty">Loading…</div></div></div>`;

  const load = async () => {
    const f = JOB_FILTERS.find((x) => x[0] === S.jobFilter);
    const qs = new URLSearchParams();
    if (f[2]) qs.set('status', f[2]);
    if (S.jobFilter === 'overdue') qs.set('overdue', '1');
    if (S.jobQuery) qs.set('q', S.jobQuery);
    const jobs = await get('/jobs?' + qs);
    if (S.jobFilter === 'open' || S.jobFilter === 'quotes' || S.jobFilter === 'provisional' || S.jobFilter === 'confirmed') {
      jobs.sort((a, b) => a.start_date.localeCompare(b.start_date));
    }
    const total = jobs.reduce((s, j) => s + j.totals.net, 0);
    $('[data-list]', view).innerHTML = jobs.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Job</th><th>Client</th><th>Dates</th><th>Venue</th><th>Status</th><th class="n">Net</th></tr></thead>
        <tbody>${jobs.map((j) => `<tr class="click" data-href="#/job/${j.id}">
          <td><span class="mono muted">${esc(j.number)}</span><br><strong>${esc(j.name)}</strong></td>
          <td>${esc(j.contact_company || j.contact_name || '—')}</td>
          <td>${esc(fmtRange(j.start_date, j.end_date))}</td>
          <td>${esc(j.venue)}</td><td>${pill(j.status)}${overdueBadge(j)}${j.zoho_invoice_number ? `<br><span class="muted mono" title="Zoho Books invoice">${esc(j.zoho_invoice_number)}</span>` : ''}</td>
          <td class="n">${money(j.totals.net)}</td></tr>`).join('')}
          <tr><td colspan="5" class="muted">${plural(jobs.length, 'job')}</td><td class="n"><strong>${money(total)}</strong></td></tr>
        </tbody></table></div>`
      : `<div class="empty">No jobs here yet. <a href="#" data-new-job>Create one</a>.</div>`;
  };
  rowLinks(view);
  const baseClick = view.onclick;
  view.onclick = (e) => {
    const fb = e.target.closest('[data-filter]');
    if (fb) { S.jobFilter = fb.dataset.filter; $$('[data-filter]', view).forEach((b) => b.classList.toggle('active', b === fb)); load(); return; }
    if (e.target.closest('[data-new-job]')) { e.preventDefault(); newJob(); return; }
    if (e.target.closest('[data-export]')) { download('/export/jobs.csv'); return; }
    if (e.target.closest('[data-invoices]')) { invoicesModal().then((r) => { if (r) load(); }); return; }
    baseClick(e);
  };
  $('[data-q]', view).oninput = debounce((e) => { S.jobQuery = e.target.value.trim(); load(); }, 220);
  await load();
}

/* ---------------------------------------------------------------- job page */

async function renderJob(view, id) {
  S.job = await get(`/jobs/${id}`);
  if (S.addSectionJob !== id) { S.addSection = null; S.addSectionJob = id; }
  if (S.addSection && !S.job.sections.some((x) => x.id === S.addSection)) S.addSection = null;
  try { S.cableTypes = await get('/cable-types'); } catch { S.cableTypes = []; }
  await refreshJobAvail();
  S.products = S.jobAvail;
  drawJob(view);
  bindJob(view);
}

async function refreshJobAvail() {
  const j = S.job;
  S.jobAvail = await get(`/availability?start=${j.start_date}&end=${j.end_date}&exclude_job=${j.id}`);
}

/** Lines you can swap for an alternative: your own lines, linked items and package contents - not the parts a stage or cable run builds. */
function canSwapLine(job, it) {
  if (!it.parent_item_id) return true;
  const parent = job.items.find((x) => x.id === it.parent_item_id);
  if (parent && isRun(parent)) return false;
  const role = metaOf(it).role;
  return !role || role === 'package';
}

function availBadge(job, it) {
  const a = job.availability[it.product_id];
  if (!a) return '';
  if (a.sub_hire) return `<span class="badge sub" title="Sub-hired — order ${num(a.this_job)} in${a.vendor ? ` from ${esc(a.vendor)}` : ''}">Sub-hire</span>`;
  const tip = `Own ${num(a.owned)} · firm elsewhere ${num(a.booked_elsewhere)} · provisional elsewhere ${num(a.provisional_elsewhere)} · this job ${num(a.this_job)} from stock${a.sub_hired ? ` + ${num(a.sub_hired)} sub-hired` : ''}${a.sub_units ? ` · ${num(a.sub_units)} sub-hired unit${a.sub_units === 1 ? '' : 's'} in stock on these dates` : ''}`;
  const altBtn = a.alternatives && canSwapLine(job, it) ? ` <button type="button" class="btn small alt-btn" data-alts="${it.id}" title="See suitable alternatives">Alternatives</button>` : '';
  const sq = Math.min(it.sub_qty || 0, it.quantity || 0);
  const subBadge = sq > 0 ? ` <button type="button" class="badge sub badge-btn" data-subhire="${it.id}" title="${esc(`${num(it.quantity - sq)} from your stock, ${num(sq)} sub-hired${it.sub_vendor_name ? ` from ${it.sub_vendor_name}` : ''} — click to change`)}">+${num(sq)} sub-hire${it.sub_vendor_name ? ` · ${esc(it.sub_vendor_name)}` : ''}</button>` : '';
  const subBtn = !sq && it.kind === 'rental' ? ` <button type="button" class="btn small alt-btn" data-subhire="${it.id}" title="Hire in the extra from a vendor">Sub-hire</button>` : '';
  if (a.shortage > 0) return `<span class="badge bad" title="${esc(tip)}">Short ${num(a.shortage)}</span>${altBtn}${subBtn}${subBadge}`;
  if (a.provisional_shortage > 0) return `<span class="badge warn" title="${esc(tip)}">Prov. clash ${num(a.provisional_shortage)}</span>${altBtn}${subBtn}${subBadge}`;
  return `<span class="badge ok" title="${esc(tip)}">${num(a.remaining)} spare</span>${subBadge}`;
}

function powerText(pw, { short } = {}) {
  if (!pw || !pw.has_data) return '';
  const bits = [];
  if (pw.watts) {
    bits.push(pw.watts >= 1000 ? `${num(+(pw.watts / 1000).toFixed(2))} kW` : `${num(pw.watts)} W`);
    bits.push(`${num(pw.amps)} A`);
    bits.push(`${pw.supplies_needed} × ${short ? pw.supply.label.replace(/ (wall socket|single-phase|three-phase).*$/, '') : pw.supply.label}`);
  }
  if (pw.sockets_needed || pw.sockets_have) bits.push(`sockets ${num(pw.sockets_needed)} needed / ${num(pw.sockets_have)} packed`);
  return bits.join(' · ');
}

function lineRow(job, it, rental) {
  if (isRun(it)) return runRow(it, rental);
  const cdays = job.totals.charge_days;
  return `<tr data-item="${it.id}" class="${it.parent_item_id ? 'acc' : ''}" style="--depth:${it._depth || 0}">
      <td class="desc">${it.parent_item_id ? '<span class="acc-mark" aria-hidden="true">↳</span>' : ''}<input data-f="description" value="${esc(it.description)}" aria-label="Description">
        <small>${it.added_by && !it.parent_item_id ? `<span class="by-note" title="Added by ${esc(it.added_by)}">${esc(initials(it.added_by))}</span> ` : ''}${it.product_brand ? `<span class="line-brand">${esc(it.product_brand)}</span> · ` : ''}${it.product_id ? `<a href="#/product/${it.product_id}">${esc(it.product_sku || 'View stock item')}</a>` : ''}${it.parent_item_id ? ` <span class="muted">· ${job.items.some((x) => x.id === it.parent_item_id && isRun(x)) ? `part of ${groupWord(job.items.find((x) => x.id === it.parent_item_id))}` : (metaOf(it).role === 'package' ? 'in package' : `linked accessory${isIncluded(it) ? ', included' : ''}`)}</span>` : ''}</small></td>
      <td class="n"><input data-f="quantity" type="number" step="any" min="0" value="${num(it.quantity)}" aria-label="Quantity"></td>
      <td class="n"><input data-f="unit_price" type="number" step="0.01" min="0" value="${num(it.unit_price)}" aria-label="Price"></td>
      ${rental ? `<td class="n"><input data-f="days" type="number" step="any" min="0" placeholder="${num(cdays)}" value="${it.days ?? ''}" aria-label="Days" title="Blank = job's chargeable days"></td>` : ''}
      <td class="n"><input data-f="discount_pct" type="number" step="any" min="0" max="100" placeholder="0" value="${it.discount_pct ? num(it.discount_pct) : ''}" aria-label="Discount"></td>
      <td class="n total">${money(it.line_total)}</td>
      ${rental ? `<td>${availBadge(job, it)}</td>` : ''}
      <td class="nowrap">${rental && !it.parent_item_id && job.sections.length ? `<button class="icon-btn move" data-move-item="${it.id}" title="Move to another section" aria-label="Move to section">⇅</button>` : ''}<button class="icon-btn" data-del-item="${it.id}" title="Remove line" aria-label="Remove line">×</button></td>
    </tr>`;
}

function sectionRow(sec, ncols, level) {
  const pt = powerText(sec.power, { short: true });
  return `<tr class="sec-row lvl${level}" data-sec="${sec.id}"><td colspan="${ncols}"><div class="sec-head">
    <div class="sec-title"><strong>${esc(sec.name)}</strong>${pt ? ` <span class="sec-power" title="Power for this ${level ? 'sub-section' : 'section (including its sub-sections)'}">⚡ ${esc(pt)}</span>` : ''}
      ${sec.notes ? `<div class="sec-notes">${esc(sec.notes)}</div>` : ''}</div>
    <div class="sec-actions">
      <button class="btn small ${S.addSection === sec.id ? 'primary' : ''}" data-sec-target="${sec.id}" title="New equipment goes into this ${level ? 'sub-section' : 'section'}">${S.addSection === sec.id ? 'Adding here' : 'Add here'}</button>
      ${level === 0 ? `<button class="btn small" data-sec-sub="${sec.id}">+ Sub-section</button>` : ''}
      <button class="icon-btn" data-sec-edit="${sec.id}" title="Edit heading" aria-label="Edit heading">✎</button>
      <button class="icon-btn" data-sec-move="${sec.id}:-1" title="Move up" aria-label="Move up">↑</button>
      <button class="icon-btn" data-sec-move="${sec.id}:1" title="Move down" aria-label="Move down">↓</button>
      <button class="icon-btn" data-sec-del="${sec.id}" title="Remove section (its equipment is kept)" aria-label="Remove section">×</button>
    </div></div></td></tr>`;
}

function itemTable(job, kind) {
  const all = job.items.filter((i) => i.kind === kind);
  const rental = kind === 'rental';
  const secs = rental ? job.sections : [];
  if (!all.length && !secs.length) return '';
  const ncols = rental ? 8 : 6;
  let body = '';
  if (!secs.length) {
    body = orderItems(all).map((it) => lineRow(job, it, rental)).join('');
  } else {
    const loose = all.filter((i) => !i.effective_section_id);
    if (loose.length) body += `<tr class="sec-row lvl0 loose"><td colspan="${ncols}"><div class="sec-head"><div class="sec-title"><strong>Not in a section</strong></div>
      <div class="sec-actions"><button class="btn small ${!S.addSection ? 'primary' : ''}" data-sec-target="">${!S.addSection ? 'Adding here' : 'Add here'}</button></div></div></td></tr>`
      + orderItems(loose).map((it) => lineRow(job, it, rental)).join('');
    for (const top of secs.filter((x) => !x.parent_id)) {
      body += sectionRow(top, ncols, 0);
      const mine = all.filter((i) => i.effective_section_id === top.id);
      body += mine.length ? orderItems(mine).map((it) => lineRow(job, it, rental)).join('') : '';
      for (const sub of secs.filter((x) => x.parent_id === top.id)) {
        body += sectionRow(sub, ncols, 1);
        const sm = all.filter((i) => i.effective_section_id === sub.id);
        body += sm.length ? orderItems(sm).map((it) => lineRow(job, it, rental)).join('')
          : `<tr class="sec-empty"><td colspan="${ncols}" class="muted">Empty — choose “Add here”, then add equipment.</td></tr>`;
      }
      if (!mine.length && !secs.some((x) => x.parent_id === top.id)) {
        body += `<tr class="sec-empty"><td colspan="${ncols}" class="muted">Empty — choose “Add here”, then add equipment.</td></tr>`;
      }
    }
  }
  return `<div class="table-wrap"><table class="table items">
    <thead><tr><th>${KIND_LABEL[kind]}</th><th class="n">Qty</th><th class="n">${rental ? 'Day rate' : 'Price'}</th>
      ${rental ? '<th class="n">Days</th>' : ''}<th class="n">Disc %</th><th class="n">Total</th>
      ${rental ? '<th>Stock</th>' : ''}<th></th></tr></thead>
    <tbody>${body}
    <tr class="sub"><td colspan="${rental ? 5 : 4}" class="muted">Subtotal</td><td class="n"><strong>${money(job.totals[kind])}</strong></td>${rental ? '<td></td>' : ''}<td></td></tr>
    </tbody></table></div>`;
}

function runRow(it, rental) {
  const m = metaOf(it);
  const stage = isStage(it);
  return `<tr data-item="${it.id}" class="run">
    <td class="desc"><input data-f="description" value="${esc(it.description)}" aria-label="Description">
      <small><span class="run-tag">${stage ? 'Stage' : 'Cable run'}</span> ${stage ? 'each stage' : 'each run'}: ${esc(m.summary || '')}
        ${stage ? ` · <a href="#" data-stage-plan="${it.id}">plan, clamps &amp; skirts</a>${m.clamps && m.clamps.points && m.clamps.points.length ? ` · ${num(m.clamps.points.length)} clamps` : ''}${m.skirts && m.skirts.sides && m.skirts.sides.length ? ` · skirt ${num(m.skirts.perimeter)}m` : ''}` : ''}</small></td>
    <td class="n"><input data-f="quantity" type="number" step="1" min="1" value="${num(it.quantity)}" aria-label="${stage ? 'Number of stages' : 'Number of runs'}" title="${stage ? 'Number of stages' : 'Number of runs'}"></td>
    <td class="n muted">${stage ? 'stages' : 'runs'}</td>${rental ? '<td></td>' : ''}<td></td><td class="n muted">—</td>${rental ? '<td></td>' : ''}
    <td class="nowrap">${S.job && S.job.sections.length ? `<button class="icon-btn move" data-move-item="${it.id}" title="Move to another section" aria-label="Move to section">⇅</button>` : ''}<button class="icon-btn" data-del-item="${it.id}" title="Remove this ${groupWord(it)} and everything in it" aria-label="Remove">×</button></td></tr>`;
}

function subHireJobCard(j) {
  const list = j.sub_hires || [];
  if (!list.length) return '';
  const total = list.reduce((a, v) => a + v.cost, 0);
  return `<div class="card subhire-card"><header><h2>Sub-hire to order</h2>${total ? `<span class="muted">cost ≈ ${money(total)}</span>` : ''}</header><div class="body">
    ${list.map((v) => `<div class="vendor"><strong>${v.vendor_id ? `<a href="#/vendor/${v.vendor_id}">${esc(v.vendor_name)}</a>` : '<span class="muted">No vendor set</span>'}</strong>${v.cost ? ` <span class="muted small">≈ ${money(v.cost)}</span>` : ''}
      <ul style="margin:4px 0 0;padding-left:18px">${v.items.map((x) => `<li>${num(x.quantity)} × ${esc(x.name)}${x.extra ? ' <span class="muted small">(on top of your own)</span>' : ''}</li>`).join('')}</ul></div>`).join('')}
    <p class="muted small" style="margin:8px 0 0">Out ${esc(fmtDate(j.start_date))}, back ${esc(fmtDate(j.end_date))}. Costs use each item’s “their price per day”.</p>
  </div></div>`;
}

function powerCard(j) {
  const pw = j.power;
  const supplies = (S.meta.power_supplies || []);
  const sel = `<select data-supply aria-label="Venue power supply">${supplies.map((x) =>
    `<option value="${x.key}" ${x.key === pw.supply.key ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>`;
  if (!pw.has_data) {
    return `<div class="card"><header><h2>Power</h2></header><div class="body">
      <p class="muted" style="margin:0">Give equipment a power draw (watts or amps), and give your leads and distros their sockets
      (in Stock), and this job gets a power check: load, supplies needed and socket counts.</p></div></div>`;
  }
  const phase = pw.supply.phases === 3 ? ' (spread across 3 phases)' : '';
  return `<div class="card power"><header><h2>Power</h2>${pw.watts ? `<span class="muted">≈ ${num(pw.watts)} W · ${num(pw.amps)} A</span>` : ''}</header><div class="body">
    <label class="field"><span>Venue supply</span>${sel}</label>
    ${pw.amps ? `<p class="power-need"><strong>${pw.supplies_needed} × ${esc(pw.supply.label)}</strong>${phase}<br>
      <span class="muted">Each safely carries ${num(pw.supply_capacity_amps)} A (${pw.safe_pct}% of ${pw.supply.amps} A${pw.supply.phases === 3 ? ' per phase' : ''}) at ${num(pw.volts)} V.</span></p>`
      : '<p class="muted">No power estimates on the equipment yet.</p>'}
    ${pw.sockets_needed || pw.sockets_have ? `<table class="table compact"><thead><tr><th></th><th class="n">Need</th><th class="n">Packed</th><th></th></tr></thead><tbody>
      <tr><td>Sockets <span class="muted small">(1 per item that plugs in)</span></td><td class="n">${num(pw.sockets_needed)}</td><td class="n">${num(pw.sockets_have)}</td>
        <td>${pw.sockets_short ? `<span class="badge bad">${num(pw.sockets_short)} short</span>` : '<span class="badge ok">OK</span>'}</td></tr>
      </tbody></table>${Object.keys(pw.socket_types || {}).length > 1 ? `<p class="muted small">Packed: ${Object.entries(pw.socket_types).map(([t, n]) => `${num(n)} × ${esc(t)}`).join(', ')}</p>` : ''}` : ''}
    ${j.sections.length && pw.watts ? `<details class="options" open><summary>By section</summary><table class="table compact"><tbody>
      ${j.sections.map((sc) => `<tr class="${sc.parent_id ? 'sub-sec' : ''}"><td>${sc.parent_id ? '↳ ' : ''}${esc(sc.name)}</td><td class="n">${sc.power.watts ? `${num(sc.power.watts)} W · ${num(sc.power.amps)} A` : '—'}</td></tr>`).join('')}
      <tr class="total-row"><td><strong>Whole job</strong></td><td class="n"><strong>${num(pw.watts)} W · ${num(pw.amps)} A</strong></td></tr></tbody></table></details>` : ''}
    ${pw.lead_count ? `<p class="muted small">${plural(pw.lead_count, 'lead/distro', 'leads/distros')} on this job, safe for ${num(pw.lead_capacity_amps)} A in total.</p>` : ''}
    ${pw.warnings.map((w) => `<p class="banner warn">${esc(w)}</p>`).join('')}
    ${pw.suggestions.map((sg) => `<div class="suggest">${sg.product_id
      ? `<span>Add ${num(sg.quantity)} × <strong>${esc(sg.name)}</strong> <span class="muted">— ${esc(sg.why)}</span></span>
         <button class="btn small primary" data-suggest="${sg.product_id}:${sg.quantity}">Add</button>`
      : `<span class="muted">${esc(sg.why)}</span>`}</div>`).join('')}
    ${pw.amps ? `<details class="options"><summary>Compare other supplies</summary><table class="table compact"><tbody>
      ${pw.options.map((o) => `<tr><td>${esc(o.label)}</td><td class="n">${o.needed} needed</td></tr>`).join('')}</tbody></table></details>` : ''}
  </div></div>`;
}

function canEditJob(j) {
  if (!j.edit_lock || !S.meta || !S.meta.users_enabled) return true;
  const me = S.meta.user;
  return !!me && (me.is_admin || me.id === j.created_by_id || (j.editor_ids || []).includes(me.id));
}

async function lockModal(view) {
  const j = S.job;
  const users = (await get('/users')).filter((u) => u.active);
  const m = openModal(`<header><h2>Who can edit ${esc(j.number)}?</h2><button class="icon-btn" data-x aria-label="Close">×</button></header>
    <div class="modal-body">
      <label class="check" style="margin-bottom:10px"><input type="radio" name="lk" value="0" ${j.edit_lock ? '' : 'checked'}> <strong>Anyone</strong> <span class="muted">— everyone who signs in can change it</span></label>
      <label class="check" style="margin-bottom:6px"><input type="radio" name="lk" value="1" ${j.edit_lock ? 'checked' : ''}> <strong>Only these people</strong></label>
      <div class="deck-list" data-ed style="margin-left:24px">${users.map((u) => `<label class="check"><input type="checkbox" value="${u.id}" ${(j.editor_ids || []).includes(u.id) || u.id === j.created_by_id ? 'checked' : ''} ${u.id === j.created_by_id ? 'disabled title="Created this job"' : ''}>
        ${esc(u.name)} ${u.is_admin ? '<span class="muted small">(admin — can always edit)</span>' : ''}${u.id === j.created_by_id ? '<span class="muted small">(created it)</span>' : ''}</label>`).join('')}</div>
      <p class="muted small">Locking stops anyone else changing the job, its items and sections. Everyone can still see it, print it, and check items out and in.</p>
    </div>
    <footer><button class="btn" data-x>Cancel</button><button class="btn primary" data-lock-save>Save</button></footer>`);
  m.wrap.addEventListener('cancel', m.close);
  $$('[data-x]', m.el).forEach((b) => (b.onclick = m.close));
  const sync = () => { const on = $('input[name="lk"]:checked', m.el).value === '1'; $$('[data-ed] input', m.el).forEach((x) => { if (!x.title) x.disabled = !on; }); };
  m.el.addEventListener('change', sync); sync();
  $('[data-lock-save]', m.el).onclick = async () => {
    try {
      const locked = $('input[name="lk"]:checked', m.el).value === '1';
      const editors = $$('[data-ed] input:checked', m.el).map((x) => Number(x.value)).filter((id) => id !== j.created_by_id);
      S.job = await put(`/jobs/${j.id}/lock`, { locked, editors });
      m.close(); drawJob(view);
      toast(locked ? 'Editing locked' : 'Anyone can edit this job', 'ok');
    } catch (ex) { toast(ex.message, 'error'); }
  };
}

function drawJob(view) {
  const j = S.job;
  const t = j.totals;
  const short = Object.values(j.availability).filter((a) => a.shortage > 0).length;
  const prov = Object.values(j.availability).filter((a) => a.shortage === 0 && a.provisional_shortage > 0).length;
  const days = daysBetween(j.start_date, j.end_date) + 1;
  const c = j.contact;

  // Remember focus so inline edits don't lose your place.
  const ae = document.activeElement;
  const focusKey = ae && ae.closest && ae.closest('[data-item]') && ae.dataset.f
    ? `${ae.closest('[data-item]').dataset.item}:${ae.dataset.f}` : (ae && ae.id === 'pick-q' ? 'pick' : null);

  view.innerHTML = `<div class="page">
    <div class="page-head">
      <div>
        <a class="crumb" href="#/jobs">← Jobs &amp; quotes</a>
        <div class="job-title"><span class="job-number">${esc(j.number)}</span><h1>${esc(j.name)}</h1></div>
        <div class="sub">${esc(fmtRange(j.start_date, j.end_date))} · ${plural(days, 'day')} hire · due back ${esc(fmtDate(j.end_date))}${j.venue ? ' · ' + esc(j.venue) : ''}</div>
      </div>
      <div class="actions">
        <select class="status-select" data-status aria-label="Status">${Object.entries(STATUS).map(([k, l]) =>
          `<option value="${k}" ${k === j.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button class="btn" data-edit>Edit details</button>
        <button class="btn" data-dup>Duplicate</button>
        <button class="btn danger" data-delete>Delete</button>
      </div>
    </div>
    ${j.edit_lock && S.meta && S.meta.users_enabled ? `<div class="banner ${canEditJob(j) ? 'info' : 'warn'}">🔒 Editing is locked to ${esc([...(j.created_by ? [j.created_by] : []), ...j.editor_names.filter((n) => n !== j.created_by)].join(', ') || 'its creator')} and admins.
      ${canEditJob(j) ? 'You can edit it.' : 'You can view it, print it and check items out and in, but not change it.'}</div>` : ''}
    ${j.overdue ? `<div class="banner bad overdue-banner"><strong>Overdue.</strong> This ${num(days)}-day hire was due back ${esc(fmtDate(j.due_back))} — ${plural(j.days_late, 'day')} late${j.kit_out ? `, with ${plural(j.kit_out, 'item')} still checked out` : ''}.
      Check the kit in, or change the end date if the hire was extended.</div>` : ''}
    ${short ? `<div class="banner bad">⚠ ${plural(short, 'item')} ${short === 1 ? 'is' : 'are'} short for these dates — you don't own enough once other confirmed jobs are counted.</div>`
      : prov ? `<div class="banner warn">${plural(prov, 'item')} would be short if provisional bookings on other jobs are confirmed.</div>` : ''}
    <div class="grid-2 job">
      <div class="stack">
        <div class="card">
          <div class="add-bar">
            <div class="picker">
              <input id="pick-q" placeholder="${S.addSection ? `Add to ${esc((j.sections.find((x) => x.id === S.addSection) || {}).name || '')} — search stock…` : 'Add equipment — type to search your stock…'}" autocomplete="off" aria-label="Search stock">
              <input id="pick-qty" type="number" min="1" step="1" value="1" aria-label="Quantity to add" title="Quantity">
              <div class="pick-results" hidden></div>
            </div>
            ${j.sections.length ? `<label class="add-to"><span>Add to</span><select data-add-to aria-label="Section new items go into">
              <option value="">No section</option>${j.sections.filter((x) => !x.parent_id).map((top) => `<option value="${top.id}" ${S.addSection === top.id ? 'selected' : ''}>${esc(top.name)}</option>`
                + j.sections.filter((x) => x.parent_id === top.id).map((sub) => `<option value="${sub.id}" ${S.addSection === sub.id ? 'selected' : ''}>— ${esc(sub.name)}</option>`).join('')).join('')}
            </select></label>` : ''}
            <button class="btn small" data-cable-run>+ Cable run</button>
            <button class="btn small" data-stage>+ Stage</button>
            <button class="btn small" data-add-section>+ Section</button>
            <button class="btn small" data-add-line="service">+ Labour / service</button>
            <button class="btn small" data-add-line="sale">+ Sale item</button>
          </div>
          ${j.items.length ? ['rental', 'sale', 'service'].map((k) => itemTable(j, k)).join('')
            : '<div class="items-empty">No items yet. Search your stock above to start building the quote.</div>'}
        </div>
        ${(j.notes || j.internal_notes) ? `<div class="card"><div class="body">
          ${j.notes ? `<h3>Notes for client</h3><p class="notes-text">${esc(j.notes)}</p>` : ''}
          ${j.internal_notes ? `<h3>Internal notes</h3><p class="notes-text muted">${esc(j.internal_notes)}</p>` : ''}
        </div></div>` : ''}
      </div>
      <div class="stack">
        <div class="card"><header><h2>Documents</h2></header><div class="body actions">
          <a class="btn" href="#/print/${j.id}/quote">Quotation</a>
          <a class="btn" href="#/print/${j.id}/picklist">Prep list</a>
          <a class="btn" href="#/print/${j.id}/invoice">Invoice</a>
          <a class="btn" href="#/plan/${j.id}">Room plan</a>
        </div>
        <div class="check-box">
          ${['out', 'in'].map((d) => { const c = j.checks[d]; const pct = c.needed ? Math.round(100 * c.done / c.needed) : 0;
            return `<a class="check-link ${c.needed && c.done >= c.needed ? 'done' : ''}" href="#/check/${j.id}/${d}">
              <span><strong>${d === 'out' ? 'Check out' : 'Check in'}</strong> <span class="muted small">scan or tick</span></span>
              <span class="check-prog"><span class="bar"><i style="width:${pct}%"></i></span><span class="small">${num(c.done)}/${num(c.needed)}</span></span></a>`; }).join('')}
        </div>${zohoJobBox(j)}</div>
        <div class="card"><header><h2>Totals</h2>${pill(j.status)}</header><div class="body">
          <table class="totals"><tbody>
            ${t.rental ? `<tr><td>Rental (${plural(t.charge_days, 'chargeable day')})</td><td>${money(t.rental)}</td></tr>` : ''}
            ${t.sale ? `<tr><td>Sales</td><td>${money(t.sale)}</td></tr>` : ''}
            ${t.service ? `<tr><td>Services &amp; labour</td><td>${money(t.service)}</td></tr>` : ''}
            ${t.discount ? `<tr><td>Discount (${num(j.discount_pct)}%)</td><td>−${money(t.discount)}</td></tr>` : ''}
            ${t.vat_registered === false ? '' : `<tr><td><strong>Net</strong></td><td><strong>${money(t.net)}</strong></td></tr>
            <tr><td>VAT ${num(t.vat_rate)}%</td><td>${money(t.vat)}</td></tr>`}
            <tr class="grand"><td>Total</td><td>${money(t.total)}</td></tr>
          </tbody></table></div></div>
        ${subHireJobCard(j)}
        ${powerCard(j)}
        <div class="card"><header><h2>Details</h2></header><div class="body">
          <dl class="facts">
            <div><dt>Client</dt><dd>${c ? `<a href="#/contact/${c.id}">${esc(c.name)}</a>${c.company ? `<br>${esc(c.company)}` : ''}` : '<span class="muted">None</span>'}</dd></div>
            ${c && (c.email || c.phone) ? `<div><dt>Contact</dt><dd>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a><br>` : ''}${esc(c.phone)}</dd></div>` : ''}
            <div><dt>Out</dt><dd>${esc(fmtDate(j.start_date, true))}</dd></div>
            <div><dt>Return</dt><dd>${esc(fmtDate(j.end_date, true))}</dd></div>
            <div><dt>Venue</dt><dd>${esc(j.venue) || '<span class="muted">—</span>'}</dd></div>
            <div><dt>Reference</dt><dd>${esc(j.reference) || '<span class="muted">—</span>'}</dd></div>
            <div><dt>Charged days</dt><dd>${num(t.charge_days)}${j.charge_days != null ? ' <span class="muted">(custom)</span>' : ''}</dd></div>
            <div><dt>Weight</dt><dd>${num(j.total_weight_kg)} kg</dd></div>
            ${j.created_by ? `<div><dt>Created by</dt><dd>${esc(j.created_by)}</dd></div>` : ''}
            ${S.meta && S.meta.users_enabled ? `<div><dt>Who can edit</dt><dd>${j.edit_lock ? `🔒 ${esc([...(j.created_by ? [j.created_by] : []), ...j.editor_names.filter((n) => n !== j.created_by)].join(', ') || 'Its creator')} <span class="muted">and admins</span>` : 'Anyone'}
              ${canEditJob(j) ? ' <a href="#" data-lock>Change</a>' : ''}</dd></div>` : ''}
          </dl></div></div>
        <div data-job-history>${S.jobHistory && S.jobHistory.id === j.id ? historyCard(S.jobHistory.list, `#/activity/job/${j.id}`) : ''}</div>
      </div>
    </div></div>`;
  if (!canEditJob(j)) {
    const main = $('.grid-2.job > .stack', view);
    if (main) $$('input, select, textarea, button', main).forEach((x) => { x.disabled = true; });
    $$('[data-status], [data-edit], [data-delete]', view).forEach((x) => { x.disabled = true; x.title = 'This job is locked'; });
  }
  clearTimeout(S.histTimer);
  S.histTimer = setTimeout(async () => {
    try {
      const list = await get(`/activity?job=${j.id}&limit=20`);
      S.jobHistory = { id: j.id, list };
      const box = $('[data-job-history]', view);
      if (box && S.job && S.job.id === j.id) box.innerHTML = historyCard(list, `#/activity/job/${j.id}`);
    } catch { /* not essential */ }
  }, 150);

  if (focusKey === 'pick') {
    $('#pick-q').focus();
  } else if (focusKey) {
    const [iid, f] = focusKey.split(':');
    const el = $(`[data-item="${iid}"] [data-f="${f}"]`, view);
    if (el) { el.focus(); if (el.select) el.select(); }
  }
}

function zohoJobBox(j) {
  if (!S.settings.zoho_connected) {
    return `<div class="zoho-box muted"><a href="#/settings/zoho">Connect Zoho Books</a> to send this job as an invoice in one click.</div>`;
  }
  if (j.zoho_invoice_id) {
    const when = j.zoho_synced_at ? new Date(j.zoho_synced_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    return `<div class="zoho-box">
      <div><span class="zoho-tag">Zoho Books</span> Invoice <strong>${esc(j.zoho_invoice_number || '')}</strong>${when ? ` <span class="muted">· sent ${esc(when)}</span>` : ''}</div>
      <div class="actions">
        ${j.zoho_invoice_url ? `<a class="btn small" href="${esc(j.zoho_invoice_url)}" target="_blank" rel="noopener">Open in Zoho ↗</a>` : ''}
        <button class="btn small" data-zoho>Update in Zoho</button>
        <button class="btn small danger" data-zoho-unlink title="Forget the link to this Zoho invoice (it isn't deleted in Zoho)">Unlink</button>
      </div></div>`;
  }
  return `<div class="zoho-box"><button class="btn primary" data-zoho>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M9 13h6M9 17h6"/></svg>
    Create invoice in Zoho Books</button></div>`;
}

async function sendToZoho(view) {
  const j = S.job;
  const updating = !!j.zoho_invoice_id;
  if (!j.contact) { toast('Add a client to this job first — Zoho needs a customer for the invoice.', 'error'); return; }
  const who = j.contact.company || j.contact.name;
  const ok = await confirmModal(updating
    ? `Update Zoho invoice ${j.zoho_invoice_number} with this job's current lines and totals (${money(j.totals.total)}${j.totals.vat_registered === false ? '' : ' inc. VAT'})?`
    : `Create a draft invoice in Zoho Books for ${who} — ${money(j.totals.total)}${j.totals.vat_registered === false ? '' : ' inc. VAT'}? ${who} must already be a customer in Zoho Books; nothing is created on the customer side.`,
  { title: updating ? 'Update Zoho invoice?' : 'Create Zoho invoice?', okLabel: updating ? 'Update invoice' : 'Create invoice', danger: false });
  if (!ok) return;
  const btn = $('[data-zoho]', view);
  if (btn) { btn.disabled = true; btn.textContent = 'Sending to Zoho…'; }
  try {
    S.job = await post(`/jobs/${j.id}/zoho`, {});
    drawJob(view);
    const r = S.job.zoho_result;
    const mismatch = r.total != null && Math.abs(Number(r.total) - S.job.totals.total) > 0.01;
    const m = openModal(`<header><h2>Invoice ${esc(r.invoice_number)} ${esc(r.action)}</h2></header>
      <div class="modal-body">
        <p>It's in Zoho Books as a ${r.action === 'created' ? 'draft' : 'updated invoice'}. Review it there, then send it to the customer from Zoho.</p>
        ${mismatch ? `<p class="banner warn">Zoho's total is ${money(r.total)} but this job's total is ${money(S.job.totals.total)}. Check the VAT/tax choice in Settings → External software → Zoho Books.</p>` : ''}
      </div>
      <footer><button class="btn" data-close>Close</button>
        <a class="btn primary" href="${esc(r.url)}" target="_blank" rel="noopener" data-close>Open in Zoho Books ↗</a></footer>`);
    m.wrap.addEventListener('cancel', m.close);
    $$('[data-close]', m.el).forEach((b) => b.addEventListener('click', () => setTimeout(m.close, 50)));
  } catch (ex) {
    toast(ex.message, 'error');
    if (btn) drawJob(view);
  }
}

async function cableRunModal(view, prefill = {}) {
  const types = S.cableTypes = await get('/cable-types');
  if (!types.length) {
    toast('No cables set up yet. In Stock, give your cables a cable type (e.g. XLR) and a length.', 'error');
    return;
  }
  const type0 = prefill.type && types.some((t) => t.type === prefill.type) ? prefill.type : types[0].type;
  const m = openModal(`<header><h2>Add cable run</h2><button class="icon-btn" data-x aria-label="Close">×</button></header>
    <div class="form-grid">
      <label class="field third"><span>Cable type</span><select data-r="type">${types.map((t) => `<option ${t.type === type0 ? 'selected' : ''}>${esc(t.type)}</option>`).join('')}</select></label>
      <label class="field third"><span>Length needed (m)</span><input data-r="length" type="number" min="0.1" step="any" value="${esc(prefill.length || '')}" placeholder="e.g. 18"></label>
      <label class="field third"><span>Number of runs</span><input data-r="runs" type="number" min="1" step="1" value="1"></label>
      <div class="field"><span>Prefer</span><div class="tabs prefer" role="radiogroup" aria-label="Run preference">
        <button type="button" data-prefer="excess" role="radio">Less excess cable</button>
        <button type="button" data-prefer="joins" role="radio">Fewer joins</button></div></div>
    </div>
    <div class="modal-body"><p class="muted small" data-r="stock"></p><div data-r="preview" class="run-preview muted">Enter a length to see which cables it will use.</div></div>
    <footer><button class="btn" data-x>Cancel</button><button class="btn primary" data-r="add" disabled>Add to job</button></footer>`, { wide: true });
  const el = (k) => $(`[data-r="${k}"]`, m.el);
  const close = () => m.close();
  m.wrap.addEventListener('cancel', close);
  $$('[data-x]', m.el).forEach((b) => (b.onclick = close));
  let prefer = S.settings.cable_run_preference || 'excess';
  const showPrefer = () => $$('[data-prefer]', m.el).forEach((b) => { b.classList.toggle('active', b.dataset.prefer === prefer); b.setAttribute('aria-checked', b.dataset.prefer === prefer); });
  showPrefer();
  m.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-prefer]');
    if (b) { prefer = b.dataset.prefer; showPrefer(); preview(); }
  });
  const body = () => ({ cable_type: el('type').value, length: el('length').value, runs: el('runs').value || 1, prefer });
  const showStock = () => {
    const t = types.find((x) => x.type === el('type').value);
    el('stock').textContent = t ? `In stock: ${t.cables.map((c) => `${num(c.length_m)}m × ${num(c.quantity)}`).join(', ')}` : '';
  };
  const preview = debounce(async () => {
    showStock();
    const b = body();
    if (!(Number(b.length) > 0)) { el('preview').innerHTML = 'Enter a length to see which cables it will use.'; el('add').disabled = true; return; }
    try {
      const plan = await post(`/jobs/${S.job.id}/cable-run`, { ...b, dry_run: true });
      el('preview').innerHTML = `<table class="table compact"><thead><tr><th class="n">Runs</th><th>Each run</th><th>Pulls</th></tr></thead><tbody>
        ${plan.groups.map((g) => `<tr><td class="n"><strong>${g.runs}</strong></td><td><ul class="run-parts">${(g.parts || [g.summary]).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
          <span class="muted small">= ${esc(g.result || '')}</span>${g.short ? ' <span class="badge bad">not enough free</span>' : ''}</td>
          <td>${g.items.map((i) => `${num(i.per_run * g.runs)} × ${esc(i.name)}`).join('<br>')}</td></tr>`).join('')}</tbody></table>
        ${plan.short_runs ? `<p class="banner warn">${plural(plan.short_runs, 'run')} can't be made from free stock on these dates. It will be added anyway and shown as short.</p>` : ''}`;
      el('add').disabled = false;
    } catch (ex) {
      el('preview').innerHTML = `<p class="form-error">${esc(ex.message)}</p>`;
      el('add').disabled = true;
    }
  }, 250);
  m.el.addEventListener('input', preview);
  m.el.addEventListener('change', preview);
  el('add').onclick = async () => {
    el('add').disabled = true;
    try {
      S.job = await post(`/jobs/${S.job.id}/cable-run`, { ...body(), section_id: S.addSection || null });
      close();
      drawJob(view);
      toast('Cable run added', 'ok');
    } catch (ex) { toast(ex.message, 'error'); el('add').disabled = false; }
  };
  showStock();
  preview();
  setTimeout(() => el('length').focus(), 30);
}

async function sectionClick(t, view) {
  const j = S.job;
  const sectionForm = (title, sec) => formModal({
    title, fields: [
      { name: 'name', label: 'Heading', required: true, placeholder: 'e.g. Main stage, FOH, Breakout room 2' },
      { name: 'notes', label: 'Note under the heading (optional)', type: 'textarea', rows: 2, placeholder: 'e.g. Load in via dock 3, power from stage-left distro' }],
    values: sec || {}, submitLabel: sec ? 'Save' : 'Add' });
  if (t.closest('[data-add-section]')) {
    const v = await sectionForm('New section');
    if (v) { S.job = await post(`/jobs/${j.id}/sections`, v); S.addSection = S.job.new_section_id; drawJob(view); toast('Section added — new equipment goes into it', 'ok'); }
    return true;
  }
  const sub = t.closest('[data-sec-sub]');
  if (sub) {
    const parent = j.sections.find((x) => String(x.id) === sub.dataset.secSub);
    const v = await sectionForm(`New sub-section in ${parent.name}`);
    if (v) { S.job = await post(`/jobs/${j.id}/sections`, { ...v, parent_id: parent.id }); S.addSection = S.job.new_section_id; drawJob(view); }
    return true;
  }
  const tg = t.closest('[data-sec-target]');
  if (tg) { S.addSection = tg.dataset.secTarget ? Number(tg.dataset.secTarget) : null; drawJob(view); $('#pick-q').focus(); return true; }
  const ed = t.closest('[data-sec-edit]');
  if (ed) {
    const sec = j.sections.find((x) => String(x.id) === ed.dataset.secEdit);
    const v = await sectionForm('Edit heading', sec);
    if (v) { S.job = await put(`/sections/${sec.id}`, v); drawJob(view); }
    return true;
  }
  const mv = t.closest('[data-sec-move]');
  if (mv) { const [sid, dir] = mv.dataset.secMove.split(':'); S.job = await post(`/sections/${sid}/move`, { dir: Number(dir) }); drawJob(view); return true; }
  const dl = t.closest('[data-sec-del]');
  if (dl) {
    const sec = j.sections.find((x) => String(x.id) === dl.dataset.secDel);
    if (await confirmModal(`Remove the section “${sec.name}”${sec.parent_id ? '' : ' and its sub-sections'}? The equipment in it stays on the job${sec.parent_id ? ' in the parent section' : ''}.`, { okLabel: 'Remove section', title: 'Remove section?' })) {
      S.job = await del(`/sections/${sec.id}`); drawJob(view);
    }
    return true;
  }
  const mi = t.closest('[data-move-item]');
  if (mi) {
    const it = j.items.find((x) => String(x.id) === mi.dataset.moveItem);
    const opts = [['', 'Not in a section']];
    for (const top of j.sections.filter((x) => !x.parent_id)) {
      opts.push([top.id, top.name]);
      for (const sb of j.sections.filter((x) => x.parent_id === top.id)) opts.push([sb.id, `— ${sb.name}`]);
    }
    const v = await formModal({ title: `Move “${it.description}”`, submitLabel: 'Move',
      fields: [{ name: 'section_id', label: 'Section', type: 'select', options: opts }], values: { section_id: it.section_id ?? '' } });
    if (v) { S.job = await put(`/items/${it.id}`, { section_id: v.section_id ? Number(v.section_id) : null }); drawJob(view); }
    return true;
  }
  return false;
}

/** Stage plan editor: click joints to add clamps, click sides (or tick them) for skirts. Saves as you go. */
async function stageEditor(view, itemId) {
  const extras = await get('/stage-extras');
  const item = () => S.job.items.find((x) => x.id === itemId);
  if (!item()) return;
  let meta = metaOf(item());
  let clampId = (meta.clamps && meta.clamps.product_id) || (extras.clamps[0] && extras.clamps[0].id) || null;
  let points = ((meta.clamps && meta.clamps.points) || []).map((p) => [p[0], p[1]]);
  let sides = new Set((meta.skirts && meta.skirts.sides) || []);
  const savedIds = (meta.skirts && meta.skirts.skirt_ids) || [];
  let choice = skirtChoice(extras.skirts, (meta.skirts && meta.skirts.filter) || { height: heightCm(meta.height) });
  let skirtIds = new Set(savedIds.length ? savedIds.filter((id) => choice.pool.some((x) => x.id === id)) : choice.pool.map((x) => x.id));
  if (!skirtIds.size) skirtIds = new Set(choice.pool.map((x) => x.id));
  const joints = clampPoints(meta.layout);
  const m = openModal(`<header><h2>${esc(item().description)}</h2><button class="icon-btn" data-x aria-label="Close">×</button></header>
    <div class="modal-body stage-editor"><div class="stage-plan" data-e="svg"></div><div class="stage-side" data-e="side"></div></div>
    <footer><span class="muted small" data-e="status"></span><button class="btn primary" data-x>Done</button></footer>`, { wide: true });
  m.el.classList.add('xwide');
  const el = (k) => $(`[data-e="${k}"]`, m.el);
  m.wrap.addEventListener('cancel', m.close);
  $$('[data-x]', m.el).forEach((b) => (b.onclick = m.close));

  const kids = () => S.job.items.filter((x) => x.parent_item_id === itemId);
  const draw = () => {
    const live = { ...meta, clamps: { points }, skirts: { ...(meta.skirts || {}), sides: [...sides] } };
    el('svg').innerHTML = stageSVG(live, { px: 700, edit: true });
    const sk = meta.skirts;
    const qty = item().quantity || 1;
    el('side').innerHTML = `
      <h3>Clamps <span class="muted">${num(points.length)} of ${num(joints.length)} joints</span></h3>
      ${extras.clamps.length ? `<label class="field"><span>Clamp item</span><select data-e="clamp">${extras.clamps.map((c) => `<option value="${c.id}" ${c.id === clampId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <p class="muted small">Click a joint on the plan to add or remove a clamp.</p>
        <div class="btn-row"><button class="btn small" data-e="all" ${points.length === joints.length ? 'disabled' : ''}>Clamp every joint</button>
        <button class="btn small" data-e="none" ${points.length ? '' : 'disabled'}>Clear clamps</button></div>`
        : '<p class="banner warn">No clamp items in Stock yet. Add one (with “clamp” in its name, e.g. “Stage Deck Clamp”) to place clamps.</p>'}
      <h3>Skirts ${sk && sk.perimeter ? `<span class="muted">${num(sk.perimeter)} m of ${num(2 * (meta.width + meta.depth))} m perimeter</span>` : ''}</h3>
      ${extras.skirts.length ? `<div class="side-checks">${SIDES.map((sd) => `<label class="check"><input type="checkbox" data-e-side="${sd}" ${sides.has(sd) ? 'checked' : ''}> ${SIDE_LABEL[sd]} <span class="muted">${num(sd === 'front' || sd === 'back' ? meta.width : meta.depth)}m</span></label>`).join('')}</div>
        ${skirtSelects(choice, 'data-e-sk')}
        <div class="field"><span>Skirt lengths to use</span><div class="deck-list">${choice.pool.map((s) => `<label class="check"><input type="checkbox" data-e-skirt="${s.id}" ${skirtIds.has(s.id) ? 'checked' : ''}> ${esc(s.name)} <span class="muted">(${num(s.skirt_len)}m, own ${num(s.quantity)})</span></label>`).join('')}</div></div>
        ${sk ? `<p class="small">${esc(skirtBreakdown(sk))}</p>` : ''}`
        : '<p class="banner warn">No skirts in Stock yet. Open a skirt item in Stock and fill in “Skirt length”.</p>'}
      <h3>On the prep list${qty > 1 ? ` <span class="muted">(${num(qty)} stages)</span>` : ''}</h3>
      <table class="table compact"><tbody>${kids().map((k) => `<tr><td>${esc(k.description)}</td><td class="n"><strong>${num(k.quantity)}</strong></td></tr>`).join('') || '<tr><td class="muted">Nothing yet</td></tr>'}</tbody></table>`;
  };
  let timer, busy = Promise.resolve();
  const save = () => {
    clearTimeout(timer);
    el('status').textContent = 'Saving…';
    timer = setTimeout(() => {
      busy = busy.then(async () => {
        try {
          S.job = await put(`/stages/${itemId}`, {
            clamp_product_id: points.length ? clampId : null, clamp_points: points,
            skirt_sides: [...sides], skirt_ids: skirtIds.size === choice.pool.length ? [] : [...skirtIds], ...skirtBody(choice.f),
          });
          meta = metaOf(item());
          el('status').textContent = 'Saved';
          drawJob(view);
          draw();
        } catch (ex) { el('status').textContent = ''; toast(ex.message, 'error'); }
      });
    }, 250);
  };
  const toggleJoint = (key) => {
    if (!clampId) { toast('Add a clamp item to Stock first (e.g. “Stage Deck Clamp”).', 'error'); return; }
    const i = points.findIndex((p) => ptKey(p) === key);
    if (i >= 0) points.splice(i, 1);
    else points.push(joints.find((p) => ptKey(p) === key));
    draw(); save();
  };
  m.el.addEventListener('click', (e) => {
    const j = e.target.closest('[data-clamp]');
    if (j) { toggleJoint(ptKey(j.dataset.clamp.split(',').map(Number))); return; }
    const sd = e.target.closest('[data-skirt-side]');
    if (sd) {
      if (!extras.skirts.length) { toast('Add a skirt to Stock first (fill in its “Skirt length”).', 'error'); return; }
      const s = sd.dataset.skirtSide;
      sides.has(s) ? sides.delete(s) : sides.add(s);
      draw(); save(); return;
    }
    const b = e.target.closest('[data-e="all"],[data-e="none"]');
    if (b) { points = b.dataset.e === 'all' ? joints.map((p) => [p[0], p[1]]) : []; draw(); save(); }
  });
  m.el.addEventListener('keydown', (e) => {
    const j = e.target.closest && e.target.closest('[data-clamp]');
    if (j && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleJoint(ptKey(j.dataset.clamp.split(',').map(Number))); }
  });
  m.el.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-e="clamp"]')) { clampId = Number(t.value); if (points.length) save(); return; }
    if (t.matches('[data-e-side]')) { t.checked ? sides.add(t.dataset.eSide) : sides.delete(t.dataset.eSide); draw(); save(); return; }
    if (t.matches('[data-e-sk]')) {
      const k = t.dataset.eSk;
      choice = skirtChoice(extras.skirts, { ...choice.f, [k]: k === 'height' ? Number(t.value) : t.value });
      skirtIds = new Set(choice.pool.map((x) => x.id));
      draw(); save(); return;
    }
    if (t.matches('[data-e-skirt]')) {
      const id = Number(t.dataset.eSkirt);
      t.checked ? skirtIds.add(id) : skirtIds.delete(id);
      if (!skirtIds.size) { toast('Keep at least one skirt length ticked.', 'error'); skirtIds.add(id); t.checked = true; return; }
      save();
    }
  });
  draw();
}

async function stageModal(view, prefill = {}) {
  const [decks, flat, extras] = await Promise.all([get('/stage-decks'), get('/products?flat=1'), get('/stage-extras')]);
  if (!decks.length) {
    toast('No stage decks yet. In Stock, open your decks and give them a width and depth (e.g. 2 × 1).', 'error');
    return;
  }
  const legs = flat.filter((p) => p.item_type === 'equipment' && !(p.deck_w > 0) && /leg|foot|feet|riser/i.test(p.name + ' ' + p.category));
  const legOpts = (legs.length ? legs : flat.filter((p) => p.item_type === 'equipment' && !(p.deck_w > 0)));
  const m = openModal(`<header><h2>Add stage</h2><button class="icon-btn" data-x aria-label="Close">×</button></header>
    <div class="form-grid">
      <label class="field third"><span>Width (m)</span><input data-s="width" type="number" min="0.5" step="any" value="${esc(prefill.width || '')}" placeholder="e.g. 6"></label>
      <label class="field third"><span>Depth (m)</span><input data-s="depth" type="number" min="0.5" step="any" value="${esc(prefill.depth || '')}" placeholder="e.g. 4"></label>
      <label class="field third"><span>How many stages</span><input data-s="count" type="number" min="1" step="1" value="1"></label>
      <div class="field"><span>Decks to use</span><div class="deck-list">${decks.map((d) => `<label class="check"><input type="checkbox" data-s-deck="${d.id}" checked> ${esc(d.name)} <span class="muted">(${num(d.deck_w)} × ${num(d.deck_d)}m, own ${num(d.quantity)})</span></label>`).join('')}</div></div>
      <label class="field half"><span>Legs</span><select data-s="legs"><option value="">No legs / add separately</option>
        ${legOpts.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
      <label class="field third"><span>Legs per deck</span><input data-s="per" type="number" min="0" step="any" value="4"></label>
      <label class="field third"><span>Height (for the label)</span><input data-s="height" placeholder="e.g. 40cm"></label>
      <div class="field half"><span>Skirts</span>${extras.skirts.length
        ? `<div class="side-checks">${SIDES.map((sd) => `<label class="check"><input type="checkbox" data-s-side="${sd}" ${sd === 'back' ? '' : 'checked'}> ${SIDE_LABEL[sd]}</label>`).join('')}</div>
           <div data-s="skirtsel"></div>`
        : '<small class="muted">Give a skirt item a “Skirt length” in Stock to work out skirts here.</small>'}</div>
      <div class="field half"><span>Clamps</span>${extras.clamps.length
        ? `<select data-s="clamp">${extras.clamps.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
           <label class="check"><input type="checkbox" data-s="clamp_all"> Clamp every joint now</label>
           <small class="muted">Or pick joints by clicking them on the plan after adding.</small>`
        : '<small class="muted">Add a clamp item to Stock (with “clamp” in its name) to place clamps.</small>'}</div>
    </div>
    <div class="modal-body"><div data-s="preview" class="muted">Enter the stage size to see the deck layout.</div></div>
    <footer><button class="btn" data-x>Cancel</button><button class="btn primary" data-s="add" disabled>Add to job</button></footer>`, { wide: true });
  const el = (k) => $(`[data-s="${k}"]`, m.el);
  const close = () => m.close();
  m.wrap.addEventListener('cancel', close);
  $$('[data-x]', m.el).forEach((b) => (b.onclick = close));
  const legMatch = legOpts.find((p) => /40\s*cm|0\.4/i.test(p.name));
  if (legMatch) el('legs').value = '';
  const body = () => ({
    width: el('width').value, depth: el('depth').value, count: el('count').value || 1,
    deck_ids: $$('[data-s-deck]', m.el).filter((c) => c.checked).map((c) => Number(c.dataset.sDeck)),
    legs_product_id: el('legs').value ? Number(el('legs').value) : null, legs_per_deck: el('per').value || 0,
    height: el('height').value.trim(),
    skirt_sides: $$('[data-s-side]', m.el).filter((c) => c.checked).map((c) => c.dataset.sSide),
    ...skirtBody(sChoice.f),
    clamp_product_id: el('clamp') ? Number(el('clamp').value) : null,
    clamp_all: !!(el('clamp_all') && el('clamp_all').checked),
  });
  let sChoice = skirtChoice(extras.skirts, {});
  let heightPicked = false;  // once you pick a skirt height yourself, the stage height stops changing it
  const drawSkirtSel = () => { if (el('skirtsel')) el('skirtsel').innerHTML = skirtSelects(sChoice, 'data-s-sk') + `<small class="muted">${sChoice.pool.map((x) => esc(num(x.skirt_len)) + 'm').join(', ')} lengths</small>`; };
  drawSkirtSel();
  m.el.addEventListener('change', (e) => {
    const t = e.target;
    if (!t.matches('[data-s-sk]')) return;
    if (t.dataset.sSk === 'height') heightPicked = true;
    sChoice = skirtChoice(extras.skirts, { ...sChoice.f, [t.dataset.sSk]: t.dataset.sSk === 'height' ? Number(t.value) : t.value });
    drawSkirtSel();
  });
  el('height').addEventListener('input', () => {
    const cm = heightCm(el('height').value);
    if (heightPicked || cm == null || !(sChoice.options.height || []).some((h) => Math.abs(h - cm) < 0.01)) return;
    sChoice = skirtChoice(extras.skirts, { ...sChoice.f, height: cm });
    drawSkirtSel();
  });
  const preview = debounce(async () => {
    const b = body();
    if (!(Number(b.width) > 0 && Number(b.depth) > 0)) { el('preview').innerHTML = 'Enter the stage size to see the deck layout.'; el('add').disabled = true; return; }
    if (!b.deck_ids.length) { el('preview').innerHTML = '<p class="form-error">Tick at least one deck size.</p>'; el('add').disabled = true; return; }
    try {
      const plan = await post(`/jobs/${S.job.id}/stage`, { ...b, dry_run: true });
      const meta = { width: plan.width, depth: plan.depth, layout: plan.layout,
        deck_names: Object.fromEntries(plan.items.map((i) => [i.product_id, i.size])),
        skirts: plan.skirts, clamps: { points: b.clamp_all && b.clamp_product_id ? clampPoints(plan.layout) : [] } };
      const clampName = b.clamp_product_id && (extras.clamps.find((c) => c.id === b.clamp_product_id) || {}).name;
      el('preview').innerHTML = `<div class="stage-preview">
        <div class="stage-plan">${stageSVG(meta)}</div>
        <div>
          ${plan.rounded ? `<p class="banner warn">${num(plan.asked_w)} × ${num(plan.asked_d)}m can't be built exactly from these decks — nearest is <strong>${num(plan.width)} × ${num(plan.depth)}m</strong>.</p>` : `<p><strong>${num(plan.width)} × ${num(plan.depth)}m</strong> · ${num(plan.area)} m²</p>`}
          <table class="table compact"><thead><tr><th>Pulls${plan.count > 1 ? ` (${plan.count} stages)` : ''}</th><th class="n">Qty</th><th class="n">Free</th></tr></thead><tbody>
          ${plan.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="n"><strong>${num(i.per_stage * plan.count)}</strong></td>
            <td class="n">${num(i.free)}${i.short ? ` <span class="badge bad">${num(i.short)} short</span>` : ''}</td></tr>`).join('')}
          ${plan.legs ? `<tr><td>${esc(plan.legs.name)}</td><td class="n"><strong>${num(plan.legs.per_stage * plan.count)}</strong></td><td></td></tr>` : ''}
          ${b.clamp_all && clampName ? `<tr><td>${esc(clampName)}</td><td class="n"><strong>${num(plan.joints * plan.count)}</strong></td><td></td></tr>` : ''}
          ${plan.skirts ? plan.skirts.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="n"><strong>${num(i.per_stage * plan.count)}</strong></td><td class="n">${i.per_stage * plan.count > i.owned ? `<span class="badge bad">own ${num(i.owned)}</span>` : ''}</td></tr>`).join('') : ''}
          </tbody></table>
          <p class="muted small">${num(plan.joints)} joints between decks${b.clamp_all ? '' : ' — click them on the plan after adding to place clamps'}.</p>
          ${plan.skirts ? `<p class="small">Skirt ${num(plan.skirts.perimeter)} m (${esc(skirtDesc(plan.skirts.filter))}): ${esc(skirtBreakdown(plan.skirts))}</p>` : ''}
          ${plan.short ? '<p class="banner warn">Not enough decks are free on these dates. It will still be added and shown as short.</p>' : ''}
        </div></div>`;
      el('add').disabled = false;
    } catch (ex) {
      el('preview').innerHTML = `<p class="form-error">${esc(ex.message)}</p>`;
      el('add').disabled = true;
    }
  }, 300);
  m.el.addEventListener('input', preview);
  m.el.addEventListener('change', preview);
  el('add').onclick = async () => {
    el('add').disabled = true;
    try {
      const before = new Set(S.job.items.map((x) => x.id));
      S.job = await post(`/jobs/${S.job.id}/stage`, { ...body(), section_id: S.addSection || null });
      close();
      drawJob(view);
      toast('Stage added', 'ok');
      const added = S.job.items.find((x) => !before.has(x.id) && isStage(x));
      if (added) await stageEditor(view, added.id);
    } catch (ex) { toast(ex.message, 'error'); el('add').disabled = false; }
  };
  preview();
  setTimeout(() => el(prefill.width ? 'count' : 'width').focus(), 30);
}

function pickMatches() {
  const q = ($('#pick-q').value || '').trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const inJob = {};
  for (const it of S.job.items) if (it.kind === 'rental' && it.product_id) inJob[it.product_id] = (inJob[it.product_id] || 0) + it.quantity;
  return S.jobAvail
    .filter((p) => words.every((w) => `${p.name} ${p.brand || ''} ${p.vendor_name || ''} ${p.category} ${p.sku}`.toLowerCase().includes(w)))
    .slice(0, 60)
    .map((p) => ({ ...p, free: p.available - (inJob[p.product_id] || 0), freeProv: p.available_after_provisional - (inJob[p.product_id] || 0) }));
}

function runSuggestion() {
  const q = ($('#pick-q').value || '').trim();
  const st = q.match(/(\d+(?:\.\d+)?)\s*m?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*m?/i);
  if (st && /stage|deck|riser/i.test(q)) {
    return `<button type="button" class="pick-row run" data-stage-pick="${esc(st[1])}x${esc(st[2])}">
      <span class="pn">Build a ${esc(st[1])} × ${esc(st[2])}m stage</span><span class="pr"></span>
      <span class="pa"><span class="badge ok">Stage</span></span>
      <span class="pc">Works out the decks (and legs) from what's free</span></button>`;
  }
  const m = q.match(/(\d+(?:\.\d+)?)\s*m(?:etres?|eters?)?\b/i);
  if (!m || !S.cableTypes || !S.cableTypes.length) return '';
  const rest = q.replace(m[0], ' ').toLowerCase();
  const types = S.cableTypes.map((t) => t.type);
  const hit = types.find((t) => rest.includes(t.toLowerCase())) || (types.length === 1 ? types[0] : null);
  const opts = hit ? [hit] : types;
  return opts.map((t) => `<button type="button" class="pick-row run" data-run="${esc(t)}|${esc(m[1])}">
    <span class="pn">Make a ${esc(m[1])}m ${esc(t)} run</span><span class="pr"></span>
    <span class="pa"><span class="badge ok">Cable run</span></span>
    <span class="pc">Uses your preferred split (less excess or fewer joins)</span></button>`).join('');
}

function drawPicker() {
  const box = $('.pick-results');
  if (!box) return;
  const res = pickMatches();
  const runRows = runSuggestion();
  if (!res.length) {
    box.innerHTML = runRows || `<div class="empty">${S.jobAvail.length ? 'No stock matches.' : 'You haven’t added any stock yet.'} <a href="#/stock">Manage stock</a></div>`;
  } else {
    S.pickIdx = Math.min(S.pickIdx, res.length - 1);
    box.innerHTML = res.map((p, i) => {
      const cls = p.free <= 0 ? 'bad' : p.freeProv <= 0 ? 'warn' : 'ok';
      return `<button type="button" class="pick-row ${i === S.pickIdx ? 'hl' : ''}" data-pick="${p.product_id}">
        <span class="pn">${p.image_id ? `<img class="thumb" src="/img/${p.image_id}/thumb" alt="" loading="lazy">` : catIcon(p.category)}${esc(p.name)}</span>
        <span class="pr">${money(p.day_rate)}/day</span>
        <span class="pa">${p.item_type === 'package' ? '<span class="badge ok" title="Adds everything in the package">Package</span>' : p.sub_hire ? `<span class="badge sub" title="Sub-hired — order it in">Sub-hire${p.vendor_name ? ` · ${esc(p.vendor_name)}` : ''}</span>`
          : `<span class="badge ${cls}" title="Free for these dates after firm bookings${p.freeProv !== p.free ? ` (${num(p.freeProv)} if provisionals confirm)` : ''}">${num(p.free)} of ${num(p.quantity)} free</span>`}</span>
        <span class="pc">${esc([p.brand, catLabel(p), p.sku].filter(Boolean).join(' · '))}${p.accessory_count ? ` · <b>+${p.accessory_count} linked</b>` : ''}${p.quarantined ? ` · ${num(p.quarantined)} in quarantine` : ''}</span>
      </button>`;
    }).join('');
    if (runRows) box.innerHTML = runRows + box.innerHTML;
  }
  box.hidden = false;
}

async function addProduct(pid) {
  const qty = Math.max(1, Number($('#pick-qty').value) || 1);
  S.job = await post(`/jobs/${S.job.id}/items`, { product_id: pid, quantity: qty, section_id: S.addSection || null });
  const q = $('#pick-q');
  q.value = '';
  $('#pick-qty').value = 1;
  q.focus();
  drawJob($('#view'));
  $('#pick-q').focus();
  // Anything short - the item, its linked items, or what's in a package? Offer suitable alternatives one at a time
  // (you choose; nothing changes unless you confirm).
  const line = S.job.items.find((x) => x.product_id === pid && !x.parent_item_id && !x.meta && (x.section_id || null) === (S.addSection || null));
  if (line) await offerShortSwaps(line.id);
}

/** Lines under (and including) a line that are short and have alternatives, top first. */
function shortSwappable(job, rootId) {
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const x of job.items) if (x.parent_item_id && ids.has(x.parent_item_id) && !ids.has(x.id)) { ids.add(x.id); grew = true; }
  }
  return job.items.filter((x) => {
    if (!ids.has(x.id) || !x.product_id || !canSwapLine(job, x)) return false;
    const a = job.availability[x.product_id];
    return a && (a.alternatives || (x.product_vendor_id && !x.sub_qty)) && (a.shortage > 0 || a.provisional_shortage > 0);
  });
}

async function offerShortSwaps(rootId) {
  const seen = new Set();
  for (let guard = 0; guard < 20; guard++) {
    const todo = shortSwappable(S.job, rootId).filter((x) => !seen.has(x.product_id));
    if (!todo.length) break;
    const it = todo[0];
    if (!canSwapLine(S.job, it) && !it.product_vendor_id) { seen.add(it.product_id); continue; }
    seen.add(it.product_id);
    const r = await alternativesModal(it.id, { auto: true, remaining: todo.length - 1 });
    if (r) drawJob($('#view'));
    if (r === false) break; // "Skip the rest"
    if (!S.job.items.some((x) => x.id === rootId)) break;
  }
}

function bindJob(view) {
  view.onclick = async (e) => {
    const t = e.target;
    try {
      if (t.closest('[data-pick]')) { await addProduct(Number(t.closest('[data-pick]').dataset.pick)); return; }
      const altB = t.closest('[data-alts]');
      if (altB) { if (await alternativesModal(Number(altB.dataset.alts))) drawJob(view); return; }
      const subB = t.closest('[data-subhire]');
      if (subB) { if (await subHireModal(Number(subB.dataset.subhire))) drawJob(view); return; }
      if (t.closest('[data-del-item]')) {
        S.job = await del(`/items/${t.closest('[data-del-item]').dataset.delItem}`);
        drawJob(view);
        return;
      }
      const addLine = t.closest('[data-add-line]');
      if (addLine) {
        const kind = addLine.dataset.addLine;
        const v = await formModal({
          title: kind === 'service' ? 'Add labour / service' : 'Add sale item',
          fields: [
            { name: 'description', label: 'Description', required: true,
              placeholder: kind === 'service' ? 'e.g. AV technician (day)' : 'e.g. Gaffer tape' },
            { name: 'quantity', label: 'Quantity', type: 'number', step: 'any', min: 0, half: true },
            { name: 'unit_price', label: 'Unit price', type: 'number', step: '0.01', min: 0, half: true },
          ],
          values: { quantity: 1 },
          submitLabel: 'Add line',
        });
        if (v) { S.job = await post(`/jobs/${S.job.id}/items`, { ...v, kind }); drawJob(view); }
        return;
      }
      if (t.closest('[data-edit]')) {
        const opts = await contactOptions();
        const before = { start: S.job.start_date, end: S.job.end_date };
        const res = await formModal({
          title: `Edit ${S.job.number}`, wide: true,
          fields: jobFields(opts, { full: true }),
          values: { ...S.job, contact_id: S.job.contact_id ?? '', charge_days: S.job.charge_days ?? '', discount_pct: S.job.discount_pct || '' },
          onSubmit: async (v) => put(`/jobs/${S.job.id}`, jobPayload(await resolveNewContact(v))),
        });
        if (res) {
          S.job = res;
          if (res.start_date !== before.start || res.end_date !== before.end) await refreshJobAvail();
          drawJob(view);
          toast('Job updated', 'ok');
        }
        return;
      }
      if (t.closest('[data-lock]')) { e.preventDefault(); await lockModal(view); return; }
      if (t.closest('[data-dup]')) {
        const res = await formModal({
          title: `Duplicate ${S.job.number}`,
          fields: [
            { name: 'name', label: 'New job name', required: true },
            { name: 'start_date', label: 'New start date', type: 'date', required: true,
              help: `The hire length (${plural(daysBetween(S.job.start_date, S.job.end_date) + 1, 'day')}) and every line are copied. The copy starts as an enquiry.` },
          ],
          values: { name: S.job.name, start_date: S.job.start_date },
          submitLabel: 'Duplicate',
          onSubmit: (v) => post(`/jobs/${S.job.id}/duplicate`, v),
        });
        if (res) { toast(`${res.number} created`, 'ok'); location.hash = `#/job/${res.id}`; }
        return;
      }
      if (t.closest('[data-zoho]')) { await sendToZoho(view); return; }
      if (t.closest('[data-cable-run]')) { await cableRunModal(view); return; }
      if (t.closest('[data-stage]')) { await stageModal(view); return; }
      const sp = t.closest('[data-stage-plan]');
      if (sp) {
        e.preventDefault();
        await stageEditor(view, Number(sp.dataset.stagePlan));
        return;
      }
      const stPick = t.closest('[data-stage-pick]');
      if (stPick) { const [w, d] = stPick.dataset.stagePick.split('x'); await stageModal(view, { width: w, depth: d }); return; }
      if (await sectionClick(t, view)) return;
      const runPick = t.closest('[data-run]');
      if (runPick) { const [ct, len] = runPick.dataset.run.split('|'); await cableRunModal(view, { type: ct, length: len }); return; }
      const sg = t.closest('[data-suggest]');
      if (sg) {
        const [pid, qty] = sg.dataset.suggest.split(':').map(Number);
        S.job = await post(`/jobs/${S.job.id}/items`, { product_id: pid, quantity: qty, section_id: S.addSection || null });
        drawJob(view); toast('Added', 'ok'); return;
      }
      if (t.closest('[data-zoho-unlink]')) {
        if (await confirmModal(`Forget the link to Zoho invoice ${S.job.zoho_invoice_number}? The invoice stays in Zoho Books. Use this if it was deleted there or you want to create a fresh one.`, { okLabel: 'Unlink', title: 'Unlink Zoho invoice?' })) {
          S.job = await post(`/jobs/${S.job.id}/zoho/unlink`, {});
          drawJob(view);
        }
        return;
      }
      if (t.closest('[data-delete]')) {
        if (await confirmModal(`Delete ${S.job.number} “${S.job.name}” and all its lines? This can't be undone. (Tip: set the status to Cancelled or Lost to keep a record instead.)`)) {
          await del(`/jobs/${S.job.id}`);
          toast('Job deleted');
          location.hash = '#/jobs';
        }
      }
    } catch (ex) { toast(ex.message, 'error'); }
  };

  view.onchange = async (e) => {
    const t = e.target;
    try {
      if (t.matches('[data-add-to]')) { S.addSection = t.value ? Number(t.value) : null; drawJob(view); return; }
      if (t.matches('[data-supply]')) {
        S.job = await put(`/jobs/${S.job.id}`, { power_supply: t.value });
        drawJob(view);
        return;
      }
      if (t.matches('[data-status]')) {
        S.job = await put(`/jobs/${S.job.id}`, { status: t.value });
        drawJob(view);
        toast(`Status: ${STATUS[t.value]}`, 'ok');
        return;
      }
      if (t.matches('[data-f]')) {
        const id = t.closest('[data-item]').dataset.item;
        let v = t.value;
        if (t.dataset.f === 'days' && v === '') v = null;
        else if (t.type === 'number' && v === '') v = 0;
        S.job = await put(`/items/${id}`, { [t.dataset.f]: v });
        drawJob(view);
      }
    } catch (ex) { toast(ex.message, 'error'); }
  };

  view.oninput = (e) => {
    if (e.target.id === 'pick-q') { S.pickIdx = 0; drawPicker(); }
  };
  view.onfocusin = (e) => {
    if (e.target.id === 'pick-q') drawPicker();
  };
  view.onfocusout = (e) => {
    if (e.target.id === 'pick-q') {
      setTimeout(() => {
        const box = $('.pick-results');
        if (box && !box.contains(document.activeElement) && document.activeElement?.id !== 'pick-q' && document.activeElement?.id !== 'pick-qty') box.hidden = true;
      }, 150);
    }
  };
  view.onkeydown = async (e) => {
    if (e.target.id === 'pick-q' || e.target.id === 'pick-qty') {
      const res = pickMatches();
      if (e.key === 'ArrowDown') { e.preventDefault(); S.pickIdx = Math.min(S.pickIdx + 1, res.length - 1); drawPicker(); scrollPick(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); S.pickIdx = Math.max(S.pickIdx - 1, 0); drawPicker(); scrollPick(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const box = $('.pick-results');
        if (res[S.pickIdx] && box && !box.hidden) {
          try { await addProduct(res[S.pickIdx].product_id); } catch (ex) { toast(ex.message, 'error'); }
        }
      } else if (e.key === 'Escape') { $('.pick-results').hidden = true; }
    } else if (e.key === 'Enter' && e.target.matches('[data-f]')) {
      e.target.blur();
    }
  };
}

function scrollPick() {
  const hl = $('.pick-row.hl');
  if (hl) hl.scrollIntoView({ block: 'nearest' });
}

/* ---------------------------------------------------------------- availability */

async function renderAvailability(view) {
  const fromHash = location.hash.split('/')[2];
  if (fromHash && /^\d{4}-\d{2}-\d{2}$/.test(fromHash)) S.avail.start = fromHash;
  if (!S.avail.start) S.avail.start = todayISO();

  view.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Availability</h1>
      <div class="sub">Numbers show how many you have free each day after confirmed and on-hire jobs.</div></div></div>
    <div class="toolbar">
      <button class="btn" data-shift="-1" aria-label="Earlier">←</button>
      <input type="date" data-start value="${S.avail.start}" style="width:auto">
      <button class="btn" data-shift="1" aria-label="Later">→</button>
      <button class="btn" data-today>Today</button>
      <select data-days style="width:auto">${[7, 14, 28, 42].map((d) => `<option value="${d}" ${S.avail.days === d ? 'selected' : ''}>${d} days</option>`).join('')}</select>
      <select data-cat style="width:auto"><option value="">All categories</option></select>
      <span class="spacer"></span>
      <div class="legend">
        <span><i style="background:var(--ok-bg)"></i>Some booked</span>
        <span><i style="background:color-mix(in srgb,var(--grey) 22%,var(--surface))"></i>None left</span>
        <span><i style="background:var(--warn-bg)"></i>Short if provisionals confirm</span>
        <span><i style="background:var(--danger-bg)"></i>Over-booked</span>
      </div>
    </div>
    <div class="card"><div class="avail-wrap" data-grid><div class="empty">Loading…</div></div></div></div>`;

  const load = async () => {
    const g = await get(`/availability/grid?start=${S.avail.start}&days=${S.avail.days}`);
    const catSel = $('[data-cat]', view);
    catSel.innerHTML = catOptions(g.products, S.avail.cat);
    const today = todayISO();
    const head = g.dates.map((d) => {
      const dt = parseISO(d);
      const wk = dt.getDay() === 0 || dt.getDay() === 6;
      return `<th class="${d === today ? 'today' : ''} ${wk ? 'wk' : ''}">${dt.toLocaleDateString('en-GB', { weekday: 'short' })}<br>${dt.getDate()} ${dt.toLocaleDateString('en-GB', { month: 'short' })}</th>`;
    }).join('');
    const wkClass = g.dates.map((d) => { const x = parseISO(d).getDay(); return x === 0 || x === 6 ? 'wk' : ''; });

    let lastCat = null, lastSub = null;
    const prodRows = g.products.filter((p) => catMatch(p, S.avail.cat)).map((p) => {
      const cat = p.category || 'Uncategorised';
      let row = '';
      if (cat !== lastCat) { row += `<tr class="grp"><td colspan="${g.dates.length + 1}">${esc(cat)}</td></tr>`; lastCat = cat; lastSub = ''; }
      if ((p.subcategory || '') !== lastSub) { if (p.subcategory) row += `<tr class="grp subgroup"><td colspan="${g.dates.length + 1}">› ${esc(p.subcategory)}</td></tr>`; lastSub = p.subcategory || ''; }
      row += `<tr><td class="pname"><a href="#/product/${p.id}">${esc(p.name)}</a><small>${num(p.quantity)}</small></td>` +
        p.days.map(([hard, soft], i) => {
          const extra = p.extra ? p.extra[i] : 0;
          const free = p.quantity + extra - hard;
          const freeProv = free - soft;
          let cls = '';
          if (free < 0) cls = 'short';
          else if (freeProv < 0) cls = 'soft';
          else if (free === 0) cls = 'zero';
          else if (hard > 0 || soft > 0) cls = 'part';
          const tip = `${p.name} — ${fmtDate(g.dates[i], true)}: own ${num(p.quantity)}${extra ? ` + ${num(extra)} sub-hired` : ''}, firm ${num(hard)}, provisional ${num(soft)}`;
          return `<td class="c ${cls} ${wkClass[i]}" title="${esc(tip)}">${num(free)}</td>`;
        }).join('') + '</tr>';
      return row;
    }).join('');

    const jobRows = g.jobs.map((j) => {
      const cells = g.dates.map((d, i) => {
        if (d < j.start_date || d > j.end_date) return `<td class="${wkClass[i]}"></td>`;
        const first = d === j.start_date || i === 0, last = d === j.end_date || i === g.dates.length - 1;
        return `<td class="${wkClass[i]}"><span class="bar st-${j.status} ${first ? 'first' : ''} ${last ? 'last' : ''}" title="${esc(`${j.number} ${j.name} · ${STATUS[j.status]}`)}"></span></td>`;
      }).join('');
      return `<tr><td class="pname"><a href="#/job/${j.id}">${esc(j.name)}</a><small>${esc(j.number)}</small></td>${cells}</tr>`;
    }).join('');

    $('[data-grid]', view).innerHTML = g.products.length ? `<table class="avail">
      <thead><tr><th class="pname">Stock <small>owned</small></th>${head}</tr></thead>
      <tbody>
        ${jobRows ? `<tr class="grp"><td colspan="${g.dates.length + 1}">Jobs in this window</td></tr>${jobRows}` : ''}
        ${prodRows}
      </tbody></table>`
      : '<div class="empty">Add some stock first, then you can see availability here. <a href="#/stock">Go to stock</a></div>';
  };

  view.onclick = (e) => {
    const sh = e.target.closest('[data-shift]');
    if (sh) { S.avail.start = addDays(S.avail.start, Number(sh.dataset.shift) * S.avail.days); $('[data-start]', view).value = S.avail.start; load(); }
    if (e.target.closest('[data-today]')) { S.avail.start = todayISO(); $('[data-start]', view).value = S.avail.start; load(); }
  };
  view.onchange = (e) => {
    if (e.target.matches('[data-start]') && e.target.value) { S.avail.start = e.target.value; load(); }
    if (e.target.matches('[data-days]')) { S.avail.days = Number(e.target.value); load(); }
    if (e.target.matches('[data-cat]')) { S.avail.cat = e.target.value; load(); }
  };
  await load();
}

/* ---------------------------------------------------------------- stock */

async function renderStock(view) {
  S.stockTab = S.stockTab || 'equipment';
  view.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Stock</h1><div class="sub">Everything you hire out.</div></div>
      <div class="actions">
        <button class="btn" data-import>Import CSV</button>
        <button class="btn" data-export>Export CSV</button>
        <a class="btn" href="#/roi">ROI calculator</a>
        <button class="btn" data-print-labels="" data-stock-labels>Print barcodes</button>
        <button class="btn primary" data-add></button></div></div>
    <div class="toolbar">
      <div class="tabs">${Object.entries(TYPE_LABEL).map(([k, l]) => `<button data-tab="${k}" class="${S.stockTab === k ? 'active' : ''}">${l}</button>`).join('')}</div>
      <input class="search" type="search" placeholder="Search, or scan a barcode" value="${esc(S.stockQuery)}" data-q>
      <select data-cat style="width:auto"></select>
      <select data-brand style="width:auto"></select>
      <label class="check"><input type="checkbox" data-arch ${S.stockArchived ? 'checked' : ''}> Show archived</label>
    </div>
    <div class="card" data-list><div class="empty">Loading…</div></div></div>`;

  let all = [];
  const cols = {
    equipment: ['Item', 'Code', 'Owned', 'Power', 'Day rate', 'Replacement'],
    cable: ['Cable', 'Type', 'Lengths', 'Total', 'Joins with'],
    package: ['Package', 'Code', 'Contents', 'Price / day'],
    power: ['Lead / distro', 'Code', 'Owned', 'Sockets', 'Rating', 'Plugs into'],
    case: ['Flight case', 'Code', 'Owned', 'Made for', 'Inside (W × D × H)', 'Empty weight'],
  };
  const brandTag = (p) => (p.brand ? ` <span class="brand-tag">${esc(p.brand)}</span>` : '');
  const owned = (p) => p.sub_hire ? '<span class="muted">sub-hire</span>' : `${num(p.quantity)}${p.asset_count ? ' <span class="muted" title="Tracked by unit">units</span>' : ''}${p.sub_unit_count ? ` <span class="badge sub" title="Sub-hired units in stock or coming">+${num(p.sub_unit_count)} sub</span>` : ''}${p.quarantined ? ` <span class="badge warn" title="In quarantine">${num(p.quarantined)} quar.</span>` : ''}`;
  const row = (p) => {
    const tags = `${p.sub_hire ? ` <span class="badge sub" title="Sub-hired, not owned">Sub-hire${p.vendor_name ? ` · ${esc(p.vendor_name)}` : ''}</span>` : ''}${p.accessory_count ? ` <span class="pill" title="Has linked accessories">+${p.accessory_count} linked</span>` : ''}${p.archived ? ' <span class="pill">Archived</span>' : ''}`;
    if (p.item_type === 'cable') {
      const joiner = all.find((x) => x.id === p.joiner_product_id) || (all.flatMap((x) => x.lengths || []).find((x) => x.id === p.joiner_product_id));
      return `<td>${thumbHTML(p)}<strong>${esc(p.name)}</strong>${brandTag(p)}${tags}${p.power_cable ? ` <span class="pill" title="Power cable">⚡ ${num(p.sockets)} × ${esc(p.socket_type || 'socket')}</span>` : ''}</td><td>${esc(p.cable_type)}</td>
        <td>${(p.lengths || []).filter((l) => !l.archived).map((l) => `<span class="len-chip">${num(l.length_m)}m × ${num(l.quantity)}</span>`).join(' ') || '<span class="muted">No lengths yet</span>'}</td>
        <td class="n">${num(p.quantity)}${p.quarantined ? ` <span class="badge warn">${num(p.quarantined)} quar.</span>` : ''}</td>
        <td class="muted">${joiner ? esc(joiner.name) : '—'}</td>`;
    }
    if (p.item_type === 'package') {
      return `<td>${thumbHTML(p)}<strong>${esc(p.name)}</strong>${brandTag(p)}${tags}</td><td class="mono muted">${esc(p.sku)}</td>
        <td class="small">${(p.contents || []).map((c) => `${num(c.quantity)} × ${esc(c.name)}`).join(', ') || '<span class="muted">Empty — open it to add items</span>'}</td>
        <td class="n">${p.day_rate ? money(p.day_rate) : '<span class="muted">items’ own rates</span>'}</td>`;
    }
    if (p.item_type === 'case') {
      const forP = p.case_for_id && all.find((x) => x.id === p.case_for_id);
      return `<td>${thumbHTML(p)}<strong>${esc(p.name)}</strong>${brandTag(p)}${tags}</td><td class="mono muted">${esc(p.sku)}</td><td class="n">${owned(p)}</td>
        <td class="n">${forP ? esc(forP.name) : '<span class="muted">General — load at check-out</span>'}</td>
        <td class="n">${esc(sizeText(p, 'inner')) || '—'}</td><td class="n">${p.weight_kg ? num(p.weight_kg) + ' kg' : '—'}</td>`;
    }
    if (p.item_type === 'power') {
      return `<td>${thumbHTML(p)}<strong>${esc(p.name)}</strong>${brandTag(p)}${tags}</td><td class="mono muted">${esc(p.sku)}</td><td class="n">${owned(p)}</td>
        <td class="n">${num(p.sockets)} × ${esc(p.socket_type || 'socket')}</td><td class="n">${p.power_rating_a ? num(p.power_rating_a) + ' A' : '—'}</td>
        <td>${esc(p.plug_type || '—')}</td>`;
    }
    return `<td>${thumbHTML(p)}<strong>${esc(p.name)}</strong>${brandTag(p)}${tags}${p.deck_w > 0 ? ` <span class="pill" title="Stage deck">Deck ${num(p.deck_w)} × ${num(p.deck_d)}m</span>` : ''}${p.equip_kind === 'stand' && (standHeight(p) || p.stand_load_kg) ? ` <span class="pill" title="Stand">${esc([standHeight(p), p.stand_load_kg ? `max ${num(p.stand_load_kg)} kg` : ''].filter(Boolean).join(' · '))}</span>` : ''}${p.skirt_len > 0 ? ` <span class="pill" title="Stage skirt">Skirt ${num(p.skirt_len)}m${p.skirt_height > 0 ? ` · ${num(p.skirt_height)}cm` : ''}${p.skirt_colour ? ` · ${esc(p.skirt_colour)}` : ''}</span>` : ''}</td><td class="mono muted">${esc(p.sku)}</td><td class="n">${owned(p)}</td>
      <td class="n">${p.power_watts ? `${num(p.power_watts)} W <span class="muted">${num(+ampsOf(p.power_watts).toFixed(2))} A</span>` : p.plugs_in ? '<span class="muted">plugs in</span>' : '<span class="muted">—</span>'}${p.plugs_in ? ' <span title="Plugs in — needs a socket">🔌</span>' : ''}</td>
      <td class="n">${money(p.day_rate)}</td><td class="n">${money(p.replacement_value)}</td>`;
  };
  const draw = () => {
    const tab = S.stockTab;
    $('[data-add]', view).textContent = `Add ${TYPE_ONE[tab]}`;
    const mine = all.filter((p) => p.item_type === tab);
    $('[data-cat]', view).innerHTML = catOptions(mine, S.stockCat);
    const brands = [...new Set(mine.map((p) => (p.brand || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    if (S.stockBrand && !brands.includes(S.stockBrand)) S.stockBrand = '';
    $('[data-brand]', view).hidden = !brands.length;
    $('[data-brand]', view).innerHTML = `<option value="">All brands</option>` + brands.map((c) => `<option ${c === S.stockBrand ? 'selected' : ''}>${esc(c)}</option>`).join('');
    const q = S.stockQuery.toLowerCase();
    const list = mine.filter((p) => catMatch(p, S.stockCat)
      && (!S.stockBrand || (p.brand || '').trim() === S.stockBrand)
      && (!q || `${p.name} ${p.brand || ''} ${p.vendor_name || ''} ${p.sub_hire ? 'sub-hire subhire' : ''} ${p.sku} ${p.category} ${p.subcategory || ''} ${p.cable_type} ${(p.lengths || []).map((l) => l.sku).join(' ')}`.toLowerCase().includes(q)));
    const n = cols[tab].length;
    const lb = $('[data-stock-labels]', view);
    if (lb) { lb.dataset.printLabels = list.map((p) => p.id).join(','); lb.disabled = !list.length; lb.title = `Barcode labels for the ${plural(list.length, 'item')} listed`; }
    const body = groupRows(list, n, (p) => `<tr class="click" data-href="#/product/${p.id}">${row(p)}</tr>`);
    $('[data-list]', view).innerHTML = mine.length ? `<div class="table-wrap"><table class="table">
      <thead><tr>${cols[tab].map((c, i) => `<th class="${i >= 2 && tab !== 'cable' ? 'n' : ''}">${c}</th>`).join('')}</tr></thead>
      <tbody>${body || `<tr><td colspan="${n}" class="empty">No matches.</td></tr>`}
      <tr><td colspan="${n}" class="muted">${plural(list.length, 'item')}</td></tr></tbody></table></div>`
      : `<div class="empty">No ${TYPE_LABEL[tab].toLowerCase()} yet. <a href="#" data-add>Add ${TYPE_ONE[tab]}</a>${tab === 'equipment' ? ' or <a href="#" data-import>import a CSV from Current RMS</a>' : ''}.</div>`;
  };
  const load = async () => { all = await get('/products' + (S.stockArchived ? '?archived=1' : '')); draw(); };

  rowLinks(view);
  const base = view.onclick;
  view.onclick = async (e) => {
    const tb = e.target.closest('[data-tab]');
    if (tb) { S.stockTab = tb.dataset.tab; S.stockCat = ''; $$('[data-tab]', view).forEach((b) => b.classList.toggle('active', b === tb)); draw(); return; }
    if (e.target.closest('[data-add]')) {
      e.preventDefault();
      const p = await productModal(null, S.stockTab);
      if (p) { toast(`${p.name} added`, 'ok'); if (p.item_type === 'cable') location.hash = `#/product/${p.id}`; else load(); }
      return;
    }
    if (e.target.closest('[data-import]')) { e.preventDefault(); if (await importModal('products')) load(); return; }
    if (e.target.closest('[data-export]')) { download('/export/products.csv'); return; }
    base(e);
  };
  view.oninput = (e) => { if (e.target.matches('[data-q]')) { S.stockQuery = e.target.value.trim(); draw(); } };
  view.onkeydown = async (e) => {  // scan a barcode into the search box and press Enter to open its item
    if (e.key !== 'Enter' || !e.target.matches('[data-q]') || !e.target.value.trim()) return;
    e.preventDefault();
    try {
      const hit = await get('/barcodes/lookup?code=' + encodeURIComponent(e.target.value.trim()));
      S.stockQuery = ''; location.hash = `#/product/${hit.product_id}`;
      if (hit.kind === 'unit') toast(`${hit.code} — ${hit.name}`, 'ok');
    } catch { /* no exact barcode: the search results stay */ }
  };
  view.onchange = (e) => {
    if (e.target.matches('[data-cat]')) { S.stockCat = e.target.value; draw(); }
    if (e.target.matches('[data-brand]')) { S.stockBrand = e.target.value; draw(); }
    if (e.target.matches('[data-arch]')) { S.stockArchived = e.target.checked; load(); }
  };
  await load();
}

/* ---- packages */

function pkgTreeHTML(compId, tree, depth = 1, parentOut = false) {
  return tree.map((t) => {
    const out = t.excluded || parentOut;
    return `<div class="pkg-node ${out ? 'out' : ''}" style="padding-left:${depth * 18}px">
      <label class="check"><input type="checkbox" data-comp-ex="${compId}:${t.product_id}" ${t.excluded ? '' : 'checked'} ${parentOut ? 'disabled' : ''}>
        <span>${num(t.quantity)} × ${esc(t.name)} <span class="muted small">per ${depth === 1 ? 'item' : 'one above'}</span>${t.excluded ? ' <span class="badge warn">left out</span>' : ''}</span></label></div>`
      + pkgTreeHTML(compId, t.includes || [], depth + 1, out);
  }).join('');
}

async function renderPackage(view, p) {
  const id = p.id;
  const flat = await get('/products?flat=1');
  const choices = flat.filter((x) => x.item_type !== 'package' && x.id !== id);
  const byCat = {};
  for (const x of choices) (byCat[x.category || 'Uncategorised'] ||= []).push(x);
  const comps = p.components || [];
  view.innerHTML = `<div class="page">
    <div class="page-head"><div><a class="crumb" href="#/stock">← Stock</a>
      <h1>${esc(p.name)}</h1><div class="sub">${esc(['Package', p.brand, catLabel(p), p.sku].filter(Boolean).join(' · '))}${p.archived ? ' · Archived' : ''}</div></div>
      <div class="actions"><button class="btn" data-print-labels="${p.id}">Print barcodes</button><button class="btn" data-edit>Edit</button>
        ${p.archived ? '<button class="btn" data-unarchive>Restore</button>' : '<button class="btn danger" data-remove>Delete</button>'}</div></div>
    <div class="grid-2">
      <div class="stack">
        <div class="card"><header><h2>In this package</h2><span class="muted">per package</span></header>
          <div class="body" style="padding-bottom:6px"><p class="muted" style="margin:0">Each item brings its linked items, as usual. <strong>Untick</strong> any this package doesn’t need,
            e.g. receiver PSUs when the rack has its own power. They’re then left off the prep list every time the package goes on a job.</p></div>
          ${comps.length ? comps.map((c) => `<div class="pkg-comp" data-comp="${c.id}">
            <div class="pkg-head"><div class="name-cell">${thumbHTML(c)}<div><a href="#/product/${c.product_id}"><strong>${esc(c.name)}</strong></a>${c.archived ? ' <span class="pill">Archived</span>' : ''}
              <br><span class="muted small mono">${esc(c.sku || '')}</span></div></div>
              <span class="nowrap"><input type="number" min="0.01" step="any" value="${num(c.quantity)}" data-comp-qty="${c.id}" style="width:72px;text-align:right" aria-label="Quantity in the package">
              <button class="icon-btn" data-comp-del="${c.id}" title="Take out of the package" aria-label="Remove">×</button></span></div>
            ${c.tree.length ? `<div class="pkg-tree">${pkgTreeHTML(c.id, c.tree)}</div>` : '<div class="muted small" style="padding:0 16px 10px 16px">No linked items.</div>'}
          </div>`).join('') : '<div class="empty">Nothing in this package yet — add items below.</div>'}
          <div class="add-bar" style="border-bottom:0;border-top:1px solid var(--border)">
            <select data-comp-new style="flex:1 1 220px" aria-label="Item to add"><option value="">Choose an item to add…</option>
              ${Object.keys(byCat).sort().map((c) => `<optgroup label="${esc(c)}">${byCat[c].map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</optgroup>`).join('')}
            </select>
            <input type="number" min="0.01" step="any" value="1" data-comp-newqty style="width:72px" aria-label="Quantity" title="Quantity">
            <button class="btn primary small" data-comp-add>Add</button>
          </div></div>
        <div class="card"><header><h2>Upcoming bookings</h2></header>
          ${p.bookings.length ? `<table class="table"><tbody>${p.bookings.map((b) => `<tr class="click" data-href="#/job/${b.id}">
            <td><span class="mono muted">${esc(b.number)}</span> ${esc(b.name)}</td><td>${esc(fmtRange(b.start_date, b.end_date))}</td><td>${pill(b.status)}</td>
            <td class="n">${num(b.quantity)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Not on any upcoming jobs.</div>'}</div>
      </div>
      <div class="stack">${imagesCard(p)}
        <div class="card"><header><h2>Details</h2></header><div class="body"><dl class="kv">
          <dt>Price</dt><dd>${p.day_rate ? `${money(p.day_rate)} / day <span class="muted">for the whole package</span>` : 'Each item at its own day rate'}</dd>
          <dt>Contents</dt><dd>${comps.map((c) => `${num(c.quantity)} × ${esc(c.name)}`).join('<br>') || '—'}</dd>
          ${p.notes ? `<dt>Notes</dt><dd class="notes-text">${esc(p.notes)}</dd>` : ''}
        </dl><p class="muted small" style="margin:10px 0 0">On a job, a package is one line with its contents underneath. Availability and check out / in are done item by item.
          Changes here apply the next time it’s added to a job.</p></div></div>
        <div data-prod-history></div>
      </div>
    </div></div>`;
  get(`/activity?product=${id}&limit=15`).then((list) => { const b = $('[data-prod-history]', view); if (b) b.innerHTML = historyCard(list, `#/activity/product/${id}`); }).catch(() => {});
  const again = () => renderProduct(view, id);
  wireImages(view, p, again);
  rowLinks(view);
  const base = view.onclick;
  view.onclick = async (e) => {
    try {
      if (await imagesClick(e, p, again)) return;
      if (e.target.closest('[data-edit]')) { if (await productModal(p)) again(); return; }
      if (e.target.closest('[data-unarchive]')) { await put(`/products/${id}`, { archived: 0 }); again(); return; }
      if (e.target.closest('[data-comp-add]')) {
        const sel = $('[data-comp-new]', view);
        if (!sel.value) { toast('Choose an item first', 'error'); sel.focus(); return; }
        await post(`/products/${id}/components`, { product_id: Number(sel.value), quantity: $('[data-comp-newqty]', view).value || 1 });
        toast('Added to the package', 'ok'); again(); return;
      }
      const cd = e.target.closest('[data-comp-del]');
      if (cd) { await del(`/components/${cd.dataset.compDel}`); again(); return; }
      if (e.target.closest('[data-remove]')) {
        if (await confirmModal(`Delete the package “${p.name}”? Jobs it’s already on keep their lines.`)) {
          const r = await del(`/products/${id}`); toast(r.archived ? 'Archived (used on past jobs)' : 'Deleted'); location.hash = '#/stock';
        }
        return;
      }
      base(e);
    } catch (ex) { toast(ex.message, 'error'); }
  };
  view.onchange = async (e) => {
    try {
      const ex = e.target.closest('[data-comp-ex]');
      if (ex) {
        const [cid, pid] = ex.dataset.compEx.split(':').map(Number);
        await put(`/components/${cid}`, { exclude: pid, excluded: !ex.checked });
        toast(ex.checked ? 'Back in the package' : 'Left out of the package', 'ok'); again(); return;
      }
      if (e.target.matches('[data-comp-qty]')) { await put(`/components/${e.target.dataset.compQty}`, { quantity: e.target.value }); toast('Saved', 'ok'); again(); }
    } catch (err) { toast(err.message, 'error'); again(); }
  };
}

/** The barcodes of one cable length (shown under the length when "Show barcodes" is on). */
function cableBarcodesRow(p, l) {
  const units = l.units || [];
  return `<tr class="bc-row"><td colspan="6"><div class="bc-box">
    ${units.length ? `<div class="bc-grid">${units.map((u) => `<div class="bc-chip ${u.quarantine_id ? 'quar' : ''}" title="${u.quarantine_id ? `Quarantined: ${esc(u.quarantine_reason || '')}` : ''}">
        <input data-cu-f="${u.id}" value="${esc(u.asset_number)}" aria-label="Barcode" spellcheck="false">
        ${u.quarantine_id ? `<button type="button" class="btn small" data-release="${u.quarantine_id}" title="Return to service">↺</button>`
          : `<button type="button" class="icon-btn" data-cu-q="${l.id}:${u.id}" title="Quarantine this cable" aria-label="Quarantine">⚠</button>`}
        <button type="button" class="icon-btn" data-cu-del="${l.id}:${u.id}" title="Remove this cable" aria-label="Remove">×</button></div>`).join('')}</div>`
      : `<p class="muted small" style="margin:0 0 6px">No barcodes on the ${num(l.length_m)}m cables yet — counted as a quantity (${num(l.quantity)}).</p>`}
    <div class="actions"><button type="button" class="btn small primary" data-len-scan="${l.id}">Scan in ${num(l.length_m)}m cables</button>
      <button type="button" class="btn small" data-len-number="${l.id}">${units.length ? '+ Add numbered' : `Number all ${num(l.quantity)}`}</button>
      ${units.length ? '' : '<span class="muted small">Once a length has barcodes, its owned quantity is the number of barcodes.</span>'}</div>
  </div></td></tr>`;
}

async function renderCable(view, p) {
  const id = p.id;
  const ql = p.quarantine || [];
  const activeLengths = p.lengths.filter((l) => !l.archived);
  view.innerHTML = `<div class="page">
    <div class="page-head"><div><a class="crumb" href="#/stock">← Stock</a>
      <h1>${esc(p.name)}</h1><div class="sub">Cable · ${esc(p.cable_type)}${p.category ? ' · ' + esc(catLabel(p)) : ''}${p.archived ? ' · Archived' : ''}</div></div>
      <div class="actions"><button class="btn" data-print-labels="${p.id}">Print barcodes</button><button class="btn" data-edit>Edit</button>
        ${p.archived ? '<button class="btn" data-unarchive>Restore</button>' : '<button class="btn danger" data-remove>Delete</button>'}</div></div>
    <div class="grid-2">
      <div class="stack">
        <div class="card"><header><h2>Lengths</h2><span class="muted">${num(p.quantity)} cables in total
          <button type="button" class="btn small" data-show-bc style="margin-left:8px">${S.showCableBarcodes ? 'Hide barcodes' : 'Show barcodes'}</button></span></header>
          ${p.lengths.length ? `<div class="table-wrap"><table class="table units">
            <thead><tr><th>Length</th><th>Code</th><th class="n">Owned</th><th class="n">Free today</th><th class="n">Day rate</th><th></th></tr></thead>
            <tbody>${p.lengths.map((l) => `<tr data-len="${l.id}" class="${l.archived ? 'muted' : ''}">
              <td><strong>${num(l.length_m)} m</strong>${l.archived ? ' <span class="pill">Archived</span>' : ''}</td>
              <td><input data-len-f="sku" value="${esc(l.sku)}" placeholder="—" aria-label="Code"></td>
              <td class="n">${(l.units || []).length ? `<strong>${num(l.quantity)}</strong><br><span class="muted small" title="Each has its own barcode">barcoded</span>`
                : `<input data-len-f="quantity" type="number" min="0" step="1" value="${num(l.quantity)}" aria-label="Owned" style="width:70px;text-align:right">`}
                ${l.quarantined ? `<br><span class="badge warn">${num(l.quarantined)} quar.</span>` : ''}</td>
              <td class="n">${l.free_today != null ? num(l.free_today) : '—'}</td>
              <td class="n"><input data-len-f="day_rate" type="number" min="0" step="0.01" value="${num(l.day_rate)}" aria-label="Day rate" style="width:70px;text-align:right"></td>
              <td class="n nowrap">${l.archived ? `<button class="btn small" data-len-restore="${l.id}">Restore</button>`
                : `<button class="btn small" data-len-q="${l.id}">Quarantine…</button>`}
                <button class="icon-btn" data-len-del="${l.id}" title="Remove this length" aria-label="Remove length">×</button></td>
            </tr>${S.showCableBarcodes && !l.archived ? cableBarcodesRow(p, l) : ''}`).join('')}</tbody></table></div>` : '<div class="empty">No lengths yet — add the lengths you own below.</div>'}
          <div class="add-bar" style="border-bottom:0;border-top:1px solid var(--border)">
            <input data-new-len type="number" min="0.1" step="any" placeholder="Length (m)" style="width:110px" aria-label="Length in metres">
            <input data-new-qty type="number" min="0" step="1" placeholder="How many" style="width:100px" aria-label="Quantity">
            <input data-new-rate type="number" min="0" step="0.01" placeholder="Rate ${esc(money(p.day_rate))}" style="width:120px" aria-label="Day rate">
            <button class="btn small primary" data-len-add>Add length</button>
            <span class="muted small">Adding an existing length adds to its quantity.</span>
          </div></div>
        ${ql.length ? `<div class="card"><header><h2>In quarantine</h2></header><table class="table"><tbody>
          ${ql.map((q) => `<tr><td>${num(q.quantity)} × ${num(q.length_m)} m</td><td>${esc(q.reason)}</td><td class="muted">${esc(fmtDate(q.started_at.slice(0, 10)))}</td>
            <td class="n"><button class="btn small" data-release="${q.id}">Return to service</button></td></tr>`).join('')}</tbody></table></div>` : ''}
        <div class="card"><header><h2>Upcoming bookings</h2></header>
          ${p.bookings.length ? `<table class="table"><tbody>${p.bookings.map((b) => `<tr class="click" data-href="#/job/${b.id}">
            <td><span class="mono muted">${esc(b.number)}</span> ${esc(b.name)}<br><span class="muted small">${esc(b.lines || '')}</span></td>
            <td>${esc(fmtRange(b.start_date, b.end_date))}</td><td>${pill(b.status)}</td><td class="n">${num(b.quantity)}</td></tr>`).join('')}</tbody></table>`
            : '<div class="empty">Not on any upcoming jobs.</div>'}</div>
      </div>
      <div class="stack">${imagesCard(p)}
      <div class="card"><header><h2>Details</h2></header><div class="body"><dl class="kv">
        ${p.brand ? `<dt>Brand</dt><dd>${esc(p.brand)}</dd>` : ''}
        <dt>Cable type</dt><dd>${esc(p.cable_type)}</dd>
        <dt>Lengths</dt><dd>${activeLengths.map((l) => `${num(l.length_m)}m`).join(', ') || '—'}</dd>
        <dt>Joins with</dt><dd>${p.joiner ? `<a href="#/product/${p.joiner.id}">${esc(p.joiner.name)}</a>${p.joiner.length_m ? ` <span class="muted">(adds ${num(p.joiner.length_m)}m)</span>` : ' <span class="muted">(connector — no length)</span>'}` : '<span class="muted">Nothing — plugs straight in</span>'}</dd>
        ${p.power_cable ? `<dt>Power cable</dt><dd>${num(p.sockets)} × ${esc(p.socket_type || 'socket')} at the end${p.power_rating_a ? ` · rated ${num(p.power_rating_a)} A` : ''}${p.plug_type ? `<br><span class="muted">Plugs into ${esc(p.plug_type)}</span>` : ''}</dd>` : ''}
        <dt>Default rate</dt><dd>${money(p.day_rate)} / day</dd>
        <dt>Replacement</dt><dd>${money(p.replacement_value)} each</dd>
        ${p.notes ? `<dt>Notes</dt><dd class="notes-text">${esc(p.notes)}</dd>` : ''}
      </dl></div></div></div>
    </div></div>`;
  wireImages(view, p, () => renderProduct(view, id));
  rowLinks(view);
  const base = view.onclick;
  const again = async () => renderCable(view, await get(`/products/${id}`));
  view.onclick = async (e) => {
    const t = e.target;
    try {
      if (await imagesClick(e, p, again)) return;
      if (t.closest('[data-edit]')) { if (await productModal(p)) again(); return; }
      if (t.closest('[data-unarchive]')) { await put(`/products/${id}`, { archived: 0 }); again(); return; }
      if (t.closest('[data-remove]')) {
        if (await confirmModal(`Delete “${p.name}” and all its lengths? If any length has been on a job it's archived instead.`)) {
          const r = await del(`/products/${id}`); toast(r.archived ? 'Archived (used on past jobs)' : 'Deleted'); location.hash = '#/stock';
        }
        return;
      }
      if (t.closest('[data-len-add]')) {
        const len = $('[data-new-len]', view).value;
        if (!(Number(len) > 0)) { toast('Enter the length in metres', 'error'); $('[data-new-len]', view).focus(); return; }
        await post(`/products/${id}/lengths`, { length_m: len, quantity: $('[data-new-qty]', view).value || 0, day_rate: $('[data-new-rate]', view).value });
        toast(`${num(len)}m added`, 'ok'); again(); return;
      }
      if (t.closest('[data-show-bc]')) { S.showCableBarcodes = !S.showCableBarcodes; again(); return; }
      const lsc = t.closest('[data-len-scan]');
      if (lsc) {
        const l = p.lengths.find((x) => String(x.id) === lsc.dataset.lenScan);
        await scanUnitsModal({ id: l.id, name: `${num(l.length_m)}m ${p.name}`, assets: l.units || [], quantity: l.quantity }, again);
        return;
      }
      const lnum = t.closest('[data-len-number]');
      if (lnum) {
        const l = p.lengths.find((x) => String(x.id) === lnum.dataset.lenNumber);
        const have = (l.units || []).length;
        let count = have ? 0 : l.quantity;
        if (!count) {
          const v = await formModal({ title: `Add barcodes — ${num(l.length_m)}m`, fields: [{ name: 'count', label: 'How many cables', type: 'number', min: 1, step: 1, required: true }], values: { count: 1 } });
          if (!v) return;
          count = Number(v.count);
        } else if (!await confirmModal(`Give each of the ${num(count)} × ${num(l.length_m)}m cables its own barcode, numbered from ${l.sku || 'its code'}-001? You can scan over the numbers afterwards.`,
          { title: 'Number them?', okLabel: 'Number them', danger: false })) return;
        await post(`/products/${l.id}/assets`, { count });
        toast('Barcodes added', 'ok'); again(); return;
      }
      const cud = t.closest('[data-cu-del]');
      if (cud) {
        const [lid, aid] = cud.dataset.cuDel.split(':');
        const u = p.lengths.find((x) => String(x.id) === lid).units.find((x) => String(x.id) === aid);
        if (await confirmModal(`Remove cable ${u.asset_number}? Do this when it's lost or written off — that length's owned quantity drops by one.`, { okLabel: 'Remove', title: 'Remove cable?' })) {
          await del(`/assets/${aid}`); again();
        }
        return;
      }
      const cuq = t.closest('[data-cu-q]');
      if (cuq) {
        const [lid, aid] = cuq.dataset.cuQ.split(':');
        const u = p.lengths.find((x) => String(x.id) === lid).units.find((x) => String(x.id) === aid);
        const v = await formModal({ title: `Quarantine ${u.asset_number}`, fields: [{ name: 'reason', label: 'Reason', required: true, placeholder: 'e.g. intermittent pin 2' }],
          submitLabel: 'Quarantine', onSubmit: (vals) => post(`/products/${lid}/quarantine`, { asset_id: Number(aid), reason: vals.reason }) });
        if (v) { toast(`${u.asset_number} quarantined`, 'ok'); again(); }
        return;
      }
      const ld = t.closest('[data-len-del]');
      if (ld) {
        const l = p.lengths.find((x) => String(x.id) === ld.dataset.lenDel);
        if (await confirmModal(`Remove the ${num(l.length_m)}m length? If it's been used on a job it's archived instead.`, { okLabel: 'Remove' })) {
          await del(`/products/${l.id}`); again();
        }
        return;
      }
      const lr = t.closest('[data-len-restore]');
      if (lr) { await put(`/products/${lr.dataset.lenRestore}`, { archived: 0 }); again(); return; }
      const lq = t.closest('[data-len-q]');
      if (lq) {
        const l = p.lengths.find((x) => String(x.id) === lq.dataset.lenQ);
        const v = await formModal({ title: `Quarantine ${num(l.length_m)}m ${p.cable_type}`, fields: [
          { name: 'quantity', label: 'How many', type: 'number', min: 1, step: 1, required: true, half: true },
          { name: 'reason', label: 'Reason', required: true, half: true, placeholder: 'e.g. intermittent pin 2' }],
          values: { quantity: 1 }, submitLabel: 'Quarantine', onSubmit: (vals) => post(`/products/${l.id}/quarantine`, vals) });
        if (v) { toast('Quarantined', 'ok'); again(); }
        return;
      }
      const rel = t.closest('[data-release]');
      if (rel) { await post(`/quarantine/${rel.dataset.release}/release`, {}); toast('Back in service', 'ok'); again(); return; }
      base(e);
    } catch (ex) { toast(ex.message, 'error'); }
  };
  view.onchange = async (e) => {
    if (e.target.matches('[data-cu-f]')) {
      try { await put(`/assets/${e.target.dataset.cuF}`, { asset_number: e.target.value.trim() }); toast('Saved', 'ok'); } catch (ex) { toast(ex.message, 'error'); again(); }
      return;
    }
    if (!e.target.matches('[data-len-f]')) return;
    try {
      await put(`/products/${e.target.closest('[data-len]').dataset.len}`, { [e.target.dataset.lenF]: e.target.value });
      toast('Saved', 'ok');
      if (e.target.dataset.lenF === 'quantity') again();
    } catch (ex) { toast(ex.message, 'error'); again(); }
  };
  view.onkeydown = (e) => { if (e.key === 'Enter' && e.target.closest('.add-bar')) { e.preventDefault(); $('[data-len-add]', view).click(); } };
}

async function renderProduct(view, id) {
  const p = await get(`/products/${id}`);
  if (p.parent_id) { location.replace(`#/product/${p.parent_id}`); return; }
  if (p.item_type === 'cable') { await renderCable(view, p); return; }
  if (p.item_type === 'package') { await renderPackage(view, p); return; }
  const all = await get('/products?flat=1');
  const caseFor = p.case_for_id && all.find((x) => x.id === p.case_for_id);
  const linked = new Set(p.accessories.map((a) => a.accessory_id));
  const choices = all.filter((x) => x.id !== p.id && !linked.has(x.id));
  const byCat = {};
  for (const x of choices) (byCat[x.category || 'Uncategorised'] ||= []).push(x);
  const accCard = `<div class="card"><header><h2>Linked accessories</h2><span class="muted">for prep</span></header>
    <div class="body" style="padding-bottom:6px"><p class="muted" style="margin:0">These are added automatically every time
      <strong>${esc(p.name)}</strong> goes on a job, along with anything linked to them, and scale with its quantity.
      Quantities are per one ${esc(p.name)} and round up to whole items (e.g. 0.5 receivers per mic: 3 mics → 2 receivers).</p></div>
    ${p.accessories.length ? `<table class="table"><thead><tr><th>Accessory</th><th class="n">Per unit</th><th>Pricing</th><th></th></tr></thead>
      <tbody>${p.accessories.map((a) => `<tr>
        <td><a href="#/product/${a.accessory_id}">${esc(a.name)}</a>${a.archived ? ' <span class="pill">Archived</span>' : ''}<br><span class="muted mono">${esc(a.sku)}</span>
          ${a.includes && a.includes.length ? `<div class="includes">which brings: ${incText(a.includes)}</div>` : ''}</td>
        <td class="n"><input type="number" min="0.01" step="any" value="${num(a.quantity)}" data-acc-qty="${a.id}" style="width:72px;text-align:right" aria-label="Quantity per unit"></td>
        <td><label class="check"><input type="checkbox" data-acc-charged="${a.id}" ${a.charged ? 'checked' : ''}> Charge ${money(a.day_rate)}/day</label></td>
        <td><button class="icon-btn" data-acc-del="${a.id}" title="Unlink" aria-label="Unlink">×</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty" style="padding:14px">No accessories linked yet.</div>'}
    <div class="add-bar" style="border-bottom:0;border-top:1px solid var(--border)">
      <select data-acc-new style="flex:1 1 220px" aria-label="Accessory to link"><option value="">Choose a stock item to link…</option>
        ${Object.keys(byCat).sort().map((c) => `<optgroup label="${esc(c)}">${byCat[c].map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</optgroup>`).join('')}
      </select>
      <input type="number" min="0.01" step="any" value="1" data-acc-newqty style="width:72px" aria-label="Quantity per unit" title="Quantity per unit">
      <label class="check"><input type="checkbox" data-acc-newcharged> Charge for it</label>
      <button class="btn primary small" data-acc-add>Link</button>
    </div></div>`;
  view.innerHTML = `<div class="page">
    <div class="page-head"><div><a class="crumb" href="#/stock">← Stock</a>
      <h1>${esc(p.name)}</h1><div class="sub">${esc([TYPE_ONE[p.item_type] ? (p.item_type === 'power' ? 'Power distribution' : p.item_type === 'case' ? 'Flight case' : (KIND_SHORT[p.equip_kind] || 'Equipment')) : '', p.brand, catLabel(p), p.sku].filter(Boolean).join(' · '))}${p.archived ? ' · Archived' : ''}</div></div>
      <div class="actions">
        <a class="btn" href="#/availability">Availability grid</a>
        <button class="btn" data-print-labels="${p.id}">Print barcodes</button><button class="btn" data-edit>Edit</button>
        ${p.archived ? '<button class="btn" data-unarchive>Restore</button>' : '<button class="btn danger" data-remove>Delete</button>'}
      </div></div>
    <div class="grid-2">
      <div class="stack">${p.sub_hire ? subHireCard(p) : unitsCard(p)}${accCard}${altCard(p, all)}
      <div class="card"><header><h2>Upcoming bookings</h2></header>
        ${p.bookings.length ? `<table class="table"><thead><tr><th>Job</th><th>Dates</th><th>Status</th><th class="n">Qty</th></tr></thead>
          <tbody>${p.bookings.map((b) => `<tr class="click" data-href="#/job/${b.id}">
            <td><span class="mono muted">${esc(b.number)}</span> ${esc(b.name)}</td>
            <td>${esc(fmtRange(b.start_date, b.end_date))}</td><td>${pill(b.status)}</td>
            <td class="n">${num(b.quantity)}</td></tr>`).join('')}</tbody></table>`
          : '<div class="empty">Not on any upcoming jobs.</div>'}
      </div></div>
      <div class="stack">${imagesCard(p)}
      <div class="card"><header><h2>Details</h2></header><div class="body">
        <dl class="kv">
          ${p.brand ? `<dt>Brand</dt><dd>${esc(p.brand)}</dd>` : ''}
          ${p.item_type === 'equipment' && p.equip_kind ? `<dt>Kind</dt><dd>${esc(KIND_SHORT[p.equip_kind] || p.equip_kind)}</dd>` : ''}
          ${p.equip_kind === 'stand' ? `<dt>Stand</dt><dd>${standHeight(p) ? `Height ${esc(standHeight(p))}` : '<span class="muted">Height not set</span>'}${p.stand_height_mode === 'range' ? ' <span class="muted">(adjustable)</span>' : p.stand_height_mode === 'stepped' ? ' <span class="muted">(stepped)</span>' : ''}<br>${p.stand_load_kg ? `Max load <strong>${num(p.stand_load_kg)} kg</strong>` : '<span class="muted">Max load not set</span>'}</dd>` : ''}
          ${p.sub_hire ? `<dt>Sub-hired from</dt><dd>${p.vendor ? `<a href="#/vendor/${p.vendor.id}">${esc(p.vendor.name)}</a>` : '<span class="muted">No vendor chosen</span>'}</dd>` : `<dt>Owned</dt><dd>${num(p.quantity)}</dd>`}
          ${!p.sub_hire && p.vendor ? `<dt>Extra from</dt><dd><a href="#/vendor/${p.vendor.id}">${esc(p.vendor.name)}</a>${p.sub_hire_cost ? ` <span class="muted">· ${money(p.sub_hire_cost)}/day</span>` : ''} <span class="muted small">when a job needs more than you own</span></dd>` : ''}
          <dt>Day rate</dt><dd>${money(p.day_rate)}</dd>
          <dt>Replacement</dt><dd>${money(p.replacement_value)} each</dd>
          <dt>${p.item_type === 'case' ? 'Empty weight' : 'Weight'}</dt><dd>${p.weight_kg ? num(p.weight_kg) + ' kg' : '—'}</dd>
          ${p.item_type === 'case' ? `<dt>Made for</dt><dd>${caseFor ? `<a href="#/product/${caseFor.id}">${esc(caseFor.name)}</a>` : '<span class="muted">General — scan it at check-out to load it</span>'}</dd>
            ${sizeText(p, 'inner') ? `<dt>Inside</dt><dd>${esc(sizeText(p, 'inner'))} <span class="muted small">(W × D × H)</span></dd>` : ''}` : ''}
          ${p.category ? `<dt>Category</dt><dd>${esc(catLabel(p))}</dd>` : ''}
          ${sizeText(p) ? `<dt>${p.item_type === 'case' ? 'Outside' : 'Size'}</dt><dd>${esc(sizeText(p))} <span class="muted small">(W × D × H)</span></dd>` : ''}
          ${p.deck_w > 0 ? `<dt>Stage deck</dt><dd>${num(p.deck_w)} × ${num(p.deck_d)} m</dd>` : ''}
          ${p.skirt_len > 0 ? `<dt>Stage skirt</dt><dd>${num(p.skirt_len)} m long${p.skirt_height > 0 ? `, ${num(p.skirt_height)} cm high` : ''}${p.skirt_style || p.skirt_colour ? `<br>${esc([p.skirt_colour, p.skirt_style].filter(Boolean).join(' · '))}` : ''}</dd>` : ''}
          ${p.item_type === 'equipment' && (!p.equip_kind || p.equip_kind === 'powered') ? `<dt>Power</dt><dd>${p.plugs_in ? 'Plugs in — needs a socket' : '<span class="muted">Doesn’t plug in</span>'}${p.power_watts ? `<br>${num(p.power_watts)} W · ${num(+(p.power_watts / (p.volts || 230)).toFixed(2))} A <span class="muted">at ${num(p.volts || 230)} V</span>` : p.plugs_in ? '<br><span class="muted">Power draw not set</span>' : ''}</dd>` : ''}
          ${p.item_type === 'power' ? `<dt>Sockets</dt><dd>${num(p.sockets)} × ${esc(p.socket_type || 'socket')}${p.power_rating_a ? ` · rated ${num(p.power_rating_a)} A` : ''}</dd>
            <dt>Plugs into</dt><dd>${esc(p.plug_type || '—')}</dd>` : ''}
          ${p.notes ? `<dt>Notes</dt><dd class="notes-text">${esc(p.notes)}</dd>` : ''}
          ${p.accessory_of.length ? `<dt>Accessory of</dt><dd>${p.accessory_of.map((x) => `<a href="#/product/${x.product_id}">${esc(x.name)}</a> (${num(x.quantity)} each)`).join('<br>')}</dd>` : ''}
        </dl></div></div>${['equipment', 'power', 'case'].includes(p.item_type) ? `<div class="card" id="roi"><header><h2>Return on investment</h2><span class="muted small">and day rate help</span></header>
          <div class="body" data-roi><p class="muted">Loading…</p></div></div>` : ''}<div data-prod-history></div></div>
    </div></div>`;
  if (['equipment', 'power', 'case'].includes(p.item_type)) {
    get(`/products/${id}/roi`).then((r) => {
      const box = $('[data-roi]', view);
      if (!box) return;
      mountRoi(box, { values: roiStart(p, r.history), history: r.history, benchmark: r.benchmark, product: p,
        onSaveRate: async (rate) => { await put(`/products/${p.id}`, { day_rate: rate }); toast(`Day rate set to ${money(rate)}`, 'ok'); } });
    }).catch((ex) => { const box = $('[data-roi]', view); if (box) box.innerHTML = `<p class="muted">${esc(ex.message)}</p>`; });
  }
  get(`/activity?product=${id}&limit=15`).then((list) => {
    const box = $('[data-prod-history]', view);
    if (box) box.innerHTML = historyCard(list, `#/activity/product/${id}`);
  }).catch(() => {});
  wireImages(view, p, () => renderProduct(view, id));
  rowLinks(view);
  const base = view.onclick;
  view.onclick = async (e) => {
    try {
      if (e.target.closest('[data-edit]')) { if (await productModal(p)) renderProduct(view, id); return; }
      if (e.target.closest('[data-unarchive]')) { await put(`/products/${id}`, { archived: 0 }); renderProduct(view, id); return; }
      if (await unitsClick(e, p, view, id)) return;
      if (await imagesClick(e, p, () => renderProduct(view, id))) return;
      if (e.target.closest('[data-acc-add]')) {
        const sel = $('[data-acc-new]', view);
        if (!sel.value) { toast('Choose an item to link first', 'error'); sel.focus(); return; }
        await post(`/products/${id}/accessories`, {
          accessory_id: Number(sel.value), quantity: $('[data-acc-newqty]', view).value || 1,
          charged: $('[data-acc-newcharged]', view).checked,
        });
        toast('Accessory linked', 'ok');
        renderProduct(view, id);
        return;
      }
      const ad = e.target.closest('[data-acc-del]');
      if (ad) { await del(`/accessories/${ad.dataset.accDel}`); renderProduct(view, id); return; }
      if (e.target.closest('[data-alt-add]')) {
        const sel = $('[data-alt-new]', view);
        if (!sel.value) { toast('Choose an item first', 'error'); sel.focus(); return; }
        await post(`/products/${id}/alternatives`, { alt_id: Number(sel.value), both: $('[data-alt-both]', view).checked });
        toast('Alternative added', 'ok'); renderProduct(view, id); return;
      }
      const altDel = e.target.closest('[data-alt-del]');
      if (altDel) { await del(`/alternatives/${altDel.dataset.altDel}`); renderProduct(view, id); return; }
      if (e.target.closest('[data-remove]')) {
        if (await confirmModal(`Delete “${p.name}”? If it's been used on any job it will be archived instead, so old quotes stay intact.`)) {
          const r = await del(`/products/${id}`);
          toast(r.archived ? 'Archived (it’s used on past jobs)' : 'Deleted');
          location.hash = '#/stock';
        }
        return;
      }
      base(e);
    } catch (ex) { toast(ex.message, 'error'); }
  };
  view.onkeydown = (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-asset-f]')) { e.preventDefault(); e.target.blur(); }
  };
  view.onchange = async (e) => {
    try {
      if (e.target.matches('[data-asset-f]')) {
        await put(`/assets/${e.target.closest('[data-asset]').dataset.asset}`, { [e.target.dataset.assetF]: e.target.value });
        toast('Saved', 'ok');
        return;
      }
      if (e.target.matches('[data-acc-qty]')) {
        await put(`/accessories/${e.target.dataset.accQty}`, { quantity: e.target.value });
        toast('Saved', 'ok');
      } else if (e.target.matches('[data-acc-charged]')) {
        await put(`/accessories/${e.target.dataset.accCharged}`, { charged: e.target.checked });
        toast('Saved', 'ok');
      }
    } catch (ex) { toast(ex.message, 'error'); renderProduct(view, id); }
  };
}

function incText(list) {
  return list.map((x) => `${num(x.quantity)} × ${esc(x.name)}${x.includes.length ? ` (with ${incText(x.includes)})` : ''}`).join(', ');
}

function altCard(p, all) {
  const have = new Set((p.alternatives || []).map((a) => a.alt_id));
  const choices = all.filter((x) => x.id !== p.id && !have.has(x.id) && x.item_type === p.item_type);
  const byCat = {};
  for (const x of choices) (byCat[x.category || 'Uncategorised'] ||= []).push(x);
  return `<div class="card"><header><h2>Suitable alternatives</h2><span class="muted">if it’s short</span></header>
    <div class="body" style="padding-bottom:6px"><p class="muted" style="margin:0">When there aren’t enough <strong>${esc(p.name)}</strong> free for a job,
      these are offered instead. Nothing is ever swapped without you confirming it.</p></div>
    ${(p.alternatives || []).length ? `<table class="table"><tbody>${p.alternatives.map((a) => `<tr>
      <td><div class="name-cell">${thumbHTML(a)}<div><a href="#/product/${a.alt_id}">${esc(a.name)}</a>${a.archived ? ' <span class="pill">Archived</span>' : ''}<br><span class="muted mono small">${esc(a.sku || '')}</span></div></div></td>
      <td class="n muted">own ${num(a.quantity)}</td><td class="n">${money(a.day_rate)}/day</td>
      <td class="n"><button class="icon-btn" data-alt-del="${a.id}" title="Remove" aria-label="Remove">×</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty" style="padding:14px">No alternatives yet.</div>'}
    <div class="add-bar" style="border-bottom:0;border-top:1px solid var(--border)">
      <select data-alt-new style="flex:1 1 220px" aria-label="Alternative item"><option value="">Choose a suitable alternative…</option>
        ${Object.keys(byCat).sort().map((c) => `<optgroup label="${esc(c)}">${byCat[c].map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</optgroup>`).join('')}
      </select>
      <label class="check" title="Also list this item as an alternative for the one you pick"><input type="checkbox" data-alt-both checked> Both ways</label>
      <button class="btn primary small" data-alt-add>Add</button>
    </div></div>`;
}

/** Offer suitable alternatives for a line that's short. Swaps only happen when you press the swap button. */
async function alternativesModal(itemId, { auto = false, remaining = 0 } = {}) {
  const d = await get(`/items/${itemId}/alternatives`);
  const ctx = d.context || {};
  const sub = d.sub || {};
  if (!d.alternatives.length && !sub.can) {
    if (!auto) toast(ctx.swappable === false ? `This is set on ${ctx.parent || 'its stage'} — change it there` : 'No alternatives set up for this item — add some on its stock page');
    return;
  }
  const vendors = sub.can ? await get('/vendors').catch(() => []) : [];
  const subDefault = Math.min(d.item.quantity, (sub.current || 0) + (d.short || d.provisional_short || 0));
  const inPkg = ctx.kind === 'package' || !!ctx.package;
  const where = ctx.kind === 'package' ? `Part of the package <strong>${esc(ctx.parent)}</strong>.`
    : ctx.kind === 'linked' ? `Linked to <strong>${esc(ctx.parent)}</strong>${ctx.package ? ` in the package <strong>${esc(ctx.package)}</strong>` : ''}.` : '';
  const stays = ctx.kind === 'package' || ctx.kind === 'linked'
    ? ` It stays with ${ctx.parent} and follows its quantity${inPkg ? ' (this job only — the package itself isn’t changed)' : ''}.` : '';
  const short = d.short || d.provisional_short;
  const firm = d.short > 0;
  return new Promise((resolve) => {
    const m = openModal(`<header><h2>${firm ? 'Not enough free' : 'Might be short'}: ${esc(d.item.description)}</h2><button class="icon-btn" data-x aria-label="Close">×</button></header>
      <div class="modal-body">
        <p style="margin-top:0">${firm ? `<strong>${num(short)}</strong> of the ${num(d.item.quantity)} on this job aren’t free on these dates.`
          : `<strong>${num(short)}</strong> would be short if provisional bookings on other jobs are confirmed.`}
          You can ${d.alternatives.length ? 'swap some for a suitable alternative' : ''}${d.alternatives.length && sub.can ? ', ' : ''}${sub.can ? 'sub-hire the extra from a vendor' : ''}, or keep it as it is.</p>
        ${where ? `<p class="banner info" style="margin:0 0 12px">${where}</p>` : ''}
        <table class="table"><thead><tr><th></th><th>${d.alternatives.length ? 'Alternative' : 'Option'}</th><th class="n">Free</th><th class="n">How many</th></tr></thead><tbody>
        ${d.alternatives.map((a, i) => `<tr>
          <td style="width:30px"><input type="radio" name="alt" value="${a.product_id}" ${i === 0 && a.free > 0 ? 'checked' : ''} ${a.free > 0 ? '' : 'disabled'} aria-label="Use ${esc(a.name)}"></td>
          <td><div class="name-cell">${thumbHTML(a)}<div><strong>${esc(a.name)}</strong><br><span class="muted small">${money(a.day_rate)}/day${a.sub_hire ? ' · sub-hire' : ''}</span></div></div></td>
          <td class="n">${a.sub_hire ? '<span class="badge sub">Sub-hire</span>' : a.free > 0 ? `<span class="badge ok">${num(a.free)} free</span>` : '<span class="badge bad">none free</span>'}</td>
          <td class="n"><input type="number" min="1" max="${num(Math.min(d.item.quantity, a.sub_hire ? d.item.quantity : a.free))}" step="1" value="${num(Math.max(1, Math.min(short, a.sub_hire ? short : a.free)))}"
            data-alt-qty="${a.product_id}" style="width:70px;text-align:right" ${a.free > 0 ? '' : 'disabled'} aria-label="How many to swap"></td></tr>`).join('')}
        ${sub.can ? `<tr class="sub-row">
          <td style="width:30px"><input type="radio" name="alt" value="sub" ${!d.alternatives.some((a) => a.free > 0) ? 'checked' : ''} aria-label="Sub-hire"></td>
          <td><strong>Sub-hire the extra</strong> <span class="muted small">— keep ${esc(d.item.description)}, hire more in</span><br>
            <select data-sub-vendor aria-label="Vendor" style="margin-top:4px;max-width:260px"><option value="">Choose a vendor…</option>
              ${vendors.map((v) => `<option value="${v.id}" ${v.id === sub.vendor_id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></td>
          <td class="n"><span class="badge sub">Hire in</span></td>
          <td class="n"><input type="number" min="1" max="${num(d.item.quantity)}" step="1" value="${num(Math.max(1, subDefault))}" data-alt-qty="sub" style="width:70px;text-align:right" aria-label="How many to sub-hire"></td></tr>` : ''}
        </tbody></table>
        ${sub.can && !vendors.length ? '<p class="muted small">No vendors yet — add one in <a href="#/vendors">Vendors</a> to sub-hire.</p>' : ''}
        <p class="muted small" data-alt-summary style="margin-bottom:0"></p>
      </div>
      <footer>${remaining > 0 ? `<button class="btn" data-alt-stop title="Don’t ask about the other ${num(remaining)} short item${remaining === 1 ? '' : 's'}" style="margin-right:auto">Skip the rest</button>` : ''}<button class="btn" data-x>Keep as it is</button><button class="btn primary" data-alt-go>Swap</button></footer>`, { wide: true });
    const done = (v) => { m.close(); resolve(v); };
    m.wrap.addEventListener('cancel', () => done(null));
    $$('[data-x]', m.el).forEach((b) => (b.onclick = () => done(null)));
    const stop = $('[data-alt-stop]', m.el);
    if (stop) stop.onclick = () => done(false);
    const summary = () => {
      const r = $('input[name="alt"]:checked', m.el);
      const btn = $('[data-alt-go]', m.el);
      if (!r) { btn.disabled = true; $('[data-alt-summary]', m.el).textContent = 'None of the alternatives are free either.'; return; }
      if (r.value === 'sub') {
        const q = Math.min(d.item.quantity, Number($('[data-alt-qty="sub"]', m.el).value) || 0);
        const vs = $('[data-sub-vendor]', m.el);
        const vn = vs.value ? vs.selectedOptions[0].textContent : '';
        btn.disabled = !(q > 0) || !vs.value;
        btn.textContent = vs.value ? `Sub-hire ${num(q)} from ${vn}` : 'Choose a vendor';
        $('[data-alt-summary]', m.el).textContent = `${num(d.item.quantity - q)} from your own stock, ${num(q)} sub-hired${vn ? ` from ${vn}` : ''}. It’s added to “Sub-hire to order” on this job.`;
        return;
      }
      const a = d.alternatives.find((x) => String(x.product_id) === r.value);
      const q = Number($(`[data-alt-qty="${r.value}"]`, m.el).value) || 0;
      btn.disabled = !(q > 0);
      btn.textContent = `Swap ${num(q)} × ${d.item.description} for ${a.name}`;
      $('[data-alt-summary]', m.el).textContent = `${num(d.item.quantity - q)} × ${d.item.description} stay on the job${q >= d.item.quantity ? ' (the line is replaced)' : ''}; ${num(q)} × ${a.name} are added, with its linked accessories.${stays}`;
    };
    m.el.addEventListener('input', summary);
    m.el.addEventListener('change', summary);
    summary();
    $('[data-alt-go]', m.el).onclick = async () => {
      const r = $('input[name="alt"]:checked', m.el);
      if (!r) return;
      try {
        if (r.value === 'sub') {
          S.job = await put(`/items/${itemId}/subhire`, { quantity: Number($('[data-alt-qty="sub"]', m.el).value), vendor_id: Number($('[data-sub-vendor]', m.el).value) });
          toast(`Sub-hiring ${num(S.job.subhired.quantity)} × ${S.job.subhired.name}`, 'ok');
          done(S.job);
          return;
        }
        S.job = await post(`/items/${itemId}/swap`, { product_id: Number(r.value), quantity: Number($(`[data-alt-qty="${r.value}"]`, m.el).value) });
        toast(`Swapped ${num(S.job.swapped.quantity)} × ${S.job.swapped.from} for ${S.job.swapped.to}`, 'ok');
        done(S.job);
      } catch (ex) { toast(ex.message, 'error'); }
    };
  });
}

/** Sub-hire some of a line from a vendor (on top of your own stock), or change / stop it. */
async function subHireModal(itemId) {
  const [d, vendors] = await Promise.all([get(`/items/${itemId}/alternatives`), get('/vendors')]);
  const sub = d.sub || {};
  if (!sub.can) { toast('This item can’t be sub-hired here'); return; }
  const short = d.short || d.provisional_short || 0;
  const v = await formModal({
    title: `Sub-hire: ${d.item.description}`,
    intro: `${num(d.item.quantity)} on this job.${short ? ` ${num(short)} short of your own stock on these dates.` : ''} Sub-hired units don’t use your own stock, and are listed under “Sub-hire to order”.`,
    fields: [
      { name: 'quantity', label: 'How many to sub-hire', type: 'number', min: 0, max: d.item.quantity, step: 1, half: true,
        help: `The rest (${num(d.item.quantity)} minus this) come from your stock. 0 = none.` },
      { name: 'vendor_id', label: 'From', type: 'select', half: true,
        options: [['', vendors.length ? 'Choose a vendor…' : 'No vendors yet — add one in Vendors'], ...vendors.map((x) => [x.id, x.name])] },
      { name: 'cost', label: 'Their price per day (each)', type: 'number', min: 0, step: '0.01', half: true, help: 'What you pay. For the cost estimate only — your price to the client doesn’t change.' },
    ],
    values: { quantity: sub.current || Math.min(d.item.quantity, short) || 1, vendor_id: sub.vendor_id || '', cost: sub.cost || '' },
    submitLabel: sub.current ? 'Save' : 'Sub-hire',
    extraButton: sub.current ? { label: 'Stop sub-hiring', value: 'stop' } : null,
    onSubmit: async (vals, extra) => {
      if (extra === 'stop') return put(`/items/${itemId}/subhire`, { quantity: 0 });
      return put(`/items/${itemId}/subhire`, { quantity: Number(vals.quantity) || 0, vendor_id: vals.vendor_id ? Number(vals.vendor_id) : null, cost: vals.cost });
    },
  });
  if (v) { S.job = v; toast(v.subhired && v.subhired.quantity ? `Sub-hiring ${num(v.subhired.quantity)} × ${v.subhired.name}` : 'All from your own stock now', 'ok'); }
  return v;
}

function subHireCard(p) {
  const v = p.vendor;
  return `<div class="card"><header><h2>Sub-hire</h2><span class="badge sub">Not owned</span></header><div class="body">
    <p style="margin-top:0">Hired in for each job${v ? ` from <a href="#/vendor/${v.id}"><strong>${esc(v.name)}</strong></a>` : ''}. It never shows as short — jobs list how many to order instead.</p>
    <dl class="kv">
      <dt>Their price</dt><dd>${p.sub_hire_cost ? `${money(p.sub_hire_cost)} / day` : '<span class="muted">Not set</span>'}</dd>
      <dt>Your day rate</dt><dd>${money(p.day_rate)}${p.sub_hire_cost && p.day_rate ? ` <span class="muted">(${money(p.day_rate - p.sub_hire_cost)} margin a day)</span>` : ''}</dd>
      ${v && v.phone ? `<dt>Phone</dt><dd><a href="tel:${esc(v.phone.replace(/\s+/g, ''))}">${esc(v.phone)}</a></dd>` : ''}
      ${v && v.email ? `<dt>Email</dt><dd><a href="mailto:${esc(v.email)}">${esc(v.email)}</a></dd>` : ''}
    </dl></div></div>`;
}

function imagesCard(p) {
  const imgs = p.images || [];
  return `<div class="card" data-images><header><h2>Images</h2><span class="muted">${imgs.length ? plural(imgs.length, 'image') : ''}</span></header><div class="body">
    ${imgs.length ? `<div class="gallery">${imgs.map((im, i) => `<figure class="${i === 0 && imgs.length > 1 ? 'main' : ''}">
      <img src="/img/${im.id}/thumb" alt="${esc(p.name)} image ${i + 1}" data-img-view="${im.id}" loading="lazy">
      <figcaption>${i === 0 ? '<span class="muted">Main</span>' : `<button type="button" class="btn small" data-img-main="${im.id}">Make main</button>`}
        <button type="button" class="icon-btn" data-img-del="${im.id}" title="Remove image" aria-label="Remove image">×</button></figcaption></figure>`).join('')}</div>` : ''}
    <label class="drop-hint" data-img-drop style="display:block;margin-top:${imgs.length ? 10 : 0}px;cursor:pointer">
      <strong>Add images</strong> — drop photos here or click to choose. The main one shows in Stock and when adding to jobs.
      <input type="file" accept="image/png,image/jpeg,image/webp" multiple data-img-file hidden></label>
  </div></div>`;
}

async function uploadImages(p, files, refresh) {
  const list = [...files].filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type));
  if (!list.length) { toast('Choose JPG, PNG or WebP images', 'error'); return; }
  let n = 0;
  for (const f of list) {
    try { await post(`/products/${p.id}/images`, await prepareProductImage(f)); n += 1; } catch (ex) { toast(`${f.name}: ${ex.message}`, 'error'); }
  }
  if (n) { toast(`${plural(n, 'image')} added`, 'ok'); refresh(); }
}

/** Clicks and drops for the Images card. Returns true when it handled the event. */
async function imagesClick(e, p, refresh) {
  const t = e.target;
  const card = t.closest && t.closest('[data-images]');
  if (!card) return false;
  const mainBtn = t.closest('[data-img-main]');
  if (mainBtn) { await post(`/images/${mainBtn.dataset.imgMain}/main`, {}); refresh(); return true; }
  const delBtn = t.closest('[data-img-del]');
  if (delBtn) {
    if (await confirmModal('Remove this image?', { okLabel: 'Remove' })) { await del(`/images/${delBtn.dataset.imgDel}`); refresh(); }
    return true;
  }
  const viewImg = t.closest('[data-img-view]');
  if (viewImg) {
    const m = openModal(`<header><h2>${esc(p.name)}</h2><button class="icon-btn" data-x aria-label="Close">×</button></header>
      <div class="modal-body"><img class="img-view" src="/img/${viewImg.dataset.imgView}" alt="${esc(p.name)}"></div>`, { wide: true });
    m.wrap.addEventListener('cancel', m.close);
    $$('[data-x]', m.el).forEach((b) => (b.onclick = m.close));
    return true;
  }
  return false;
}

/** Wire up the image file picker and drag-and-drop (call after rendering a page with an Images card). */
function wireImages(view, p, refresh) {
  const card = $('[data-images]', view);
  if (!card) return;
  const drop = $('[data-img-drop]', card);
  $('[data-img-file]', card).addEventListener('change', (e) => { if (e.target.files.length) uploadImages(p, e.target.files, refresh); });
  ['dragenter', 'dragover'].forEach((ev) => card.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => card.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  card.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files.length) uploadImages(p, e.dataTransfer.files, refresh); });
}

const SCAN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V4h3M18 4h3v3M21 17v3h-3M6 20H3v-3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 8v8M10 8v8M13 8v8M16 8v8" stroke="currentColor" stroke-width="1.6"/></svg>';

/** Scan one barcode (a scanner types it and presses Enter). Resolves with the code, or null if cancelled. */
function scanOneModal(title, text) {
  return new Promise((resolve) => {
    const m = openModal(`<header><h2>${esc(title)}</h2><button class="icon-btn" data-x aria-label="Close">×</button></header>
      <div class="modal-body"><p class="muted" style="margin-top:0">${esc(text)}</p>
        <input class="scan-input" data-code placeholder="Scan or type, then Enter" autocomplete="off" aria-label="Barcode"></div>
      <footer><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Use this barcode</button></footer>`);
    const done = (v) => { m.close(); resolve(v); };
    m.wrap.addEventListener('cancel', () => done(null));
    $$('[data-x]', m.el).forEach((b) => (b.onclick = () => done(null)));
    const inp = $('[data-code]', m.el);
    const ok = () => { const v = inp.value.trim(); if (v) done(v); else inp.focus(); };
    $('[data-ok]', m.el).onclick = ok;
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
    setTimeout(() => inp.focus(), 30);
  });
}

/** Scan unit after unit: each barcode becomes a new unit of this item. */
async function scanUnitsModal(p, refresh) {
  const counted = !p.assets.length && p.quantity > 0;
  const m = openModal(`<header><h2>Scan in units — ${esc(p.name)}</h2><button class="icon-btn" data-x aria-label="Close">×</button></header>
    <div class="modal-body">
      <p class="muted" style="margin-top:0">Scan the barcode on each unit. Each scan adds one unit with that barcode.
        ${counted ? `<br><strong>You own ${num(p.quantity)} now, counted as a quantity — once you start, owned becomes the number of units scanned.</strong>` : ''}</p>
      <input class="scan-input" data-code placeholder="Scan a barcode…" autocomplete="off" aria-label="Barcode">
      <div class="scan-flash" data-flash aria-live="polite"></div>
      <label class="field" style="margin-top:10px"><span>Serial number for the next scan (optional)</span><input data-serial autocomplete="off"></label>
      <ul class="scan-log" data-log></ul>
    </div>
    <footer><span class="muted small" data-count>0 added</span><button class="btn primary" data-x>Done</button></footer>`);
  let added = 0, chain = Promise.resolve();
  const close = () => { m.close(); if (added) refresh(); };
  m.wrap.addEventListener('cancel', close);
  $$('[data-x]', m.el).forEach((b) => (b.onclick = close));
  const inp = $('[data-code]', m.el), log = $('[data-log]', m.el), flash = $('[data-flash]', m.el), serial = $('[data-serial]', m.el);
  const show = (ok, msg) => {
    flash.className = 'scan-flash ' + (ok ? 'ok' : 'bad');
    flash.textContent = msg;
    log.insertAdjacentHTML('afterbegin', `<li class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} ${esc(msg)}</li>`);
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = inp.value.trim(), sn = serial.value.trim();
    inp.value = ''; serial.value = '';
    if (!code) return;
    chain = chain.then(async () => {
      try {
        await post(`/products/${p.id}/assets`, { asset_number: code, serial_number: sn });
        added += 1;
        $('[data-count]', m.el).textContent = `${num(added)} added`;
        show(true, `${code} added`);
      } catch (ex) { show(false, ex.message); }
    });
    inp.focus();
  });
  serial.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.focus(); } });
  setTimeout(() => inp.focus(), 30);
}

/** Sub-hired units: kit hired in that sits in your stock for a while (with the vendor's barcodes, if you like). */
function subUnitsHTML(p) {
  const list = p.sub_units || [];
  const range = (u) => u.hire_from || u.hire_to
    ? `${u.hire_from ? esc(fmtDate(u.hire_from)) : 'now'} → ${u.hire_to ? esc(fmtDate(u.hire_to)) : 'until removed'}` : 'Until removed';
  const state = (u) => u.quarantine_id ? `<span class="badge warn" title="${esc(u.quarantine_reason || '')}">Quarantined</span>`
    : u.state === 'ended' ? '<span class="badge">Hire ended</span>'
      : u.state === 'upcoming' ? `<span class="badge sub">Arrives ${esc(fmtDate(u.hire_from))}</span>` : '<span class="badge sub">With you</span>';
  return `<div class="sub-units">
    <div class="sub-units-head"><strong>Sub-hired units</strong>
      <span class="muted small">Hired in and added to your stock for their dates. Any job can use them, and they’re not counted as owned.</span></div>
    ${list.length ? `<div class="table-wrap"><table class="table units"><thead><tr><th>Barcode</th><th>From</th><th>Hire dates</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.map((u) => `<tr data-asset="${u.id}" class="${u.state === 'ended' ? 'ended' : ''}">
        <td><div class="scan-cell"><input data-asset-f="asset_number" value="${esc(u.asset_number)}" aria-label="Barcode">
          <button type="button" class="icon-btn" data-rescan="${u.id}" title="Scan their barcode for this unit" aria-label="Scan a barcode for this unit">${SCAN_ICON}</button></div></td>
        <td>${u.vendor_id ? `<a href="#/vendor/${u.vendor_id}">${esc(u.vendor_name || '')}</a>` : '<span class="muted">—</span>'}</td>
        <td class="nowrap">${range(u)}</td>
        <td>${state(u)}</td>
        <td class="n nowrap"><button class="btn small" data-sub-edit="${u.id}">Edit</button>
          <button class="icon-btn" data-sub-del="${u.id}" title="Remove — sent back to the vendor" aria-label="Remove sub-hired unit">×</button></td>
      </tr>`).join('')}</tbody></table></div>` : ''}
    <div class="add-bar" style="border-bottom:0">
      <button class="btn small" data-add-sub>+ Add sub-hire units</button>
      ${list.some((u) => u.state === 'ended') ? '<button class="btn small" data-sub-clear>Remove ended hires</button>' : ''}
    </div></div>`;
}

function unitsHead(p) {
  const subNow = (p.sub_units || []).filter((u) => u.state === 'here' && !u.quarantine_id).length;
  const subLater = (p.sub_units || []).filter((u) => u.state === 'upcoming').length;
  return `${num(p.quantity)} owned · ${num(p.usable)} usable${subNow ? ` · <span class="badge sub">+${num(subNow)} sub-hired</span>` : ''}${subLater ? ` <span class="muted small">(${num(subLater)} coming)</span>` : ''}`;
}

function unitsCard(p) {
  const bulkQ = p.quarantine.filter((q) => !q.asset_id);
  const bulkList = bulkQ.length ? `<table class="table"><thead><tr><th>In quarantine</th><th>Reason</th><th>Since</th><th></th></tr></thead><tbody>
    ${bulkQ.map((q) => `<tr><td>${num(q.quantity)}</td><td>${esc(q.reason)}</td><td>${esc(fmtDate(q.started_at.slice(0, 10)))}</td>
      <td class="n"><button class="btn small" data-release="${q.id}">Return to service</button></td></tr>`).join('')}</tbody></table>` : '';
  if (!p.assets.length) {
    return `<div class="card"><header><h2>Units</h2><span class="muted">${unitsHead(p)}${p.quarantined ? ` · <span class="badge warn">${num(p.quarantined)} in quarantine</span>` : ''}</span></header>
      <div class="body"><p class="muted" style="margin-top:0">Counted as a quantity. Track individual units to give each one its own barcode,
        so you can scan, add, remove or quarantine a specific unit. Scan the labels already on your kit, or let it number them for you.</p>
        <div class="actions"><button class="btn primary" data-scan-units>Scan barcodes to track units</button>
          <button class="btn" data-track>Number them automatically</button>
          ${p.quantity > p.quarantined ? '<button class="btn" data-q-bulk>Quarantine some…</button>' : ''}</div></div>${bulkList}${subUnitsHTML(p)}</div>`;
  }
  return `<div class="card"><header><h2>Units</h2><span class="muted">${unitsHead(p)}</span></header>
    <div class="table-wrap"><table class="table units">
      <thead><tr><th>Barcode / asset no.</th><th>Serial no.</th><th>Status</th><th></th></tr></thead>
      <tbody>${p.assets.map((a) => `<tr data-asset="${a.id}" class="${a.quarantine_id ? 'quarantined' : ''}">
        <td><div class="scan-cell"><input data-asset-f="asset_number" value="${esc(a.asset_number)}" aria-label="Barcode / asset number">
          <button type="button" class="icon-btn" data-rescan="${a.id}" title="Scan a new barcode for this unit" aria-label="Scan a new barcode for this unit">${SCAN_ICON}</button></div></td>
        <td><input data-asset-f="serial_number" value="${esc(a.serial_number)}" placeholder="—" aria-label="Serial number"></td>
        <td>${a.quarantine_id ? `<span class="badge warn" title="Since ${esc(fmtDate(a.quarantined_at.slice(0, 10)))}">Quarantined</span> <span class="muted">${esc(a.quarantine_reason)}</span>`
          : '<span class="badge ok">In service</span>'}</td>
        <td class="n nowrap">${a.quarantine_id ? `<button class="btn small" data-release="${a.quarantine_id}">Return to service</button>`
          : `<button class="btn small" data-q-unit="${a.id}">Quarantine</button>`}
          <button class="icon-btn" data-asset-del="${a.id}" title="Remove this unit" aria-label="Remove unit">×</button></td>
      </tr>`).join('')}</tbody></table></div>
    <div class="add-bar" style="border-bottom:0;border-top:1px solid var(--border)">
      <button class="btn small primary" data-scan-units>Scan in units</button>
      <button class="btn small" data-add-units>+ Add units</button>
      <span class="muted small">Removing a unit (sold, lost, written off) lowers the owned quantity.</span>
    </div>${subUnitsHTML(p)}</div>`;
}

async function unitsClick(e, p, view, id) {
  const t = e.target;
  const refresh = () => renderProduct(view, id);
  if (t.closest('[data-scan-units]')) { await scanUnitsModal(p, refresh); return true; }
  const rs = t.closest('[data-rescan]');
  if (rs) {
    const a = [...p.assets, ...(p.sub_units || [])].find((x) => String(x.id) === rs.dataset.rescan);
    const code = await scanOneModal(`New barcode for ${a.asset_number}`, `Scan the label now on this ${p.name}. It replaces ${a.asset_number}.`);
    if (code && code !== a.asset_number) {
      await put(`/assets/${a.id}`, { asset_number: code });
      toast(`${a.asset_number} is now ${code}`, 'ok'); refresh();
    }
    return true;
  }
  if (t.closest('[data-track]')) {
    let count = p.quantity;
    if (count > 0) {
      if (!await confirmModal(`Create ${num(count)} unit${count === 1 ? '' : 's'} for ${p.name}, numbered ${p.sku || 'ITEM'}-001 onwards? You can scan or type over the numbers afterwards.`,
        { title: 'Track individual units?', okLabel: 'Create units', danger: false })) return true;
    } else {
      const v = await formModal({ title: 'How many units?', fields: [{ name: 'count', label: 'Number of units', type: 'number', min: 1, step: 1, required: true }], values: { count: 1 } });
      if (!v) return true;
      count = v.count;
    }
    await post(`/products/${id}/assets`, { count });
    toast('Units created', 'ok'); refresh(); return true;
  }
  if (t.closest('[data-add-units]')) {
    const v = await formModal({
      title: `Add units — ${p.name}`,
      fields: [
        { name: 'count', label: 'How many', type: 'number', min: 1, step: 1, half: true },
        { name: 'prefix', label: 'Number them with prefix', half: true, placeholder: (p.sku || 'ITEM') + '-' },
        { type: 'heading', label: 'Or add one specific unit', help: 'Fill this in to use your own asset number (e.g. an existing barcode). It overrides “How many”.' },
        { name: 'asset_number', label: 'Asset number / barcode', half: true, placeholder: 'Type or scan' },
        { name: 'serial_number', label: 'Serial number', half: true },
      ],
      values: { count: 1 }, submitLabel: 'Add',
      onSubmit: (vals) => post(`/products/${id}/assets`, vals),
    });
    if (v) { toast('Units added', 'ok'); refresh(); }
    return true;
  }
  const del = t.closest('[data-asset-del]');
  if (del) {
    const a = p.assets.find((x) => String(x.id) === del.dataset.assetDel);
    if (await confirmModal(`Remove unit ${a.asset_number}? Do this when it's sold, lost or written off. The owned quantity drops by one.`, { okLabel: 'Remove unit', title: 'Remove unit?' })) {
      await del_(`/assets/${a.id}`); toast(`${a.asset_number} removed`); refresh();
    }
    return true;
  }
  const qu = t.closest('[data-q-unit]');
  if (qu) {
    const a = p.assets.find((x) => String(x.id) === qu.dataset.qUnit);
    const v = await formModal({ title: `Quarantine ${a.asset_number}`, fields: [{ name: 'reason', label: 'Reason', required: true, placeholder: 'e.g. failed PAT, cracked grille, intermittent' }],
      submitLabel: 'Quarantine', onSubmit: (vals) => post(`/products/${id}/quarantine`, { asset_id: a.id, reason: vals.reason }) });
    if (v) { toast(`${a.asset_number} quarantined`, 'ok'); refresh(); }
    return true;
  }
  if (t.closest('[data-q-bulk]')) {
    const v = await formModal({ title: `Quarantine ${p.name}`, fields: [
      { name: 'quantity', label: 'How many', type: 'number', min: 1, step: 1, required: true, half: true },
      { name: 'reason', label: 'Reason', required: true, half: true, placeholder: 'e.g. damaged connector' }],
      values: { quantity: 1 }, submitLabel: 'Quarantine', onSubmit: (vals) => post(`/products/${id}/quarantine`, vals) });
    if (v) { toast('Quarantined', 'ok'); refresh(); }
    return true;
  }
  const rel = t.closest('[data-release]');
  if (rel) { await post(`/quarantine/${rel.dataset.release}/release`, {}); toast('Back in service', 'ok'); refresh(); return true; }
  if (t.closest('[data-add-sub]')) { if (await subUnitsModal(p)) refresh(); return true; }
  const se = t.closest('[data-sub-edit]');
  if (se) { if (await subUnitsModal(p, p.sub_units.find((u) => String(u.id) === se.dataset.subEdit))) refresh(); return true; }
  const sd = t.closest('[data-sub-del]');
  if (sd) {
    const u = p.sub_units.find((x) => String(x.id) === sd.dataset.subDel);
    if (await confirmModal(`Remove sub-hired unit ${u.asset_number}${u.vendor_name ? ` (from ${u.vendor_name})` : ''}? Do this when it goes back. Your owned quantity doesn’t change.`,
      { okLabel: 'Remove', title: 'Remove sub-hired unit?' })) {
      await del_(`/assets/${u.id}`); toast(`${u.asset_number} removed`); refresh();
    }
    return true;
  }
  if (t.closest('[data-sub-clear]')) {
    const ended = p.sub_units.filter((u) => u.state === 'ended');
    if (await confirmModal(`Remove the ${num(ended.length)} sub-hired unit${ended.length === 1 ? '' : 's'} whose hire has ended?`, { okLabel: 'Remove', title: 'Remove ended hires?' })) {
      for (const u of ended) await del_(`/assets/${u.id}`);
      toast('Removed', 'ok'); refresh();
    }
    return true;
  }
  return false;
}

/** Add sub-hired units (or edit one): which vendor, when it's with you, and its barcodes. */
async function subUnitsModal(p, unit = null) {
  const vendors = await get('/vendors');
  if (!vendors.length) {
    toast('Add the vendor first — in Vendors', 'error');
    location.hash = '#/vendors';
    return null;
  }
  const vOpts = [['', 'Choose a vendor…'], ...vendors.map((v) => [v.id, v.name])];
  const dates = [
    { name: 'hire_from', label: 'Arrives', type: 'date', half: true, help: 'Leave blank if it’s here now.' },
    { name: 'hire_to', label: 'Goes back', type: 'date', half: true, help: 'Leave blank to keep it until you remove it.' },
  ];
  if (unit) {
    return formModal({
      title: `Sub-hired unit ${unit.asset_number}`,
      fields: [{ name: 'vendor_id', label: 'Hired from', type: 'select', options: vOpts, required: true }, ...dates,
        { name: 'serial_number', label: 'Serial number', half: true }],
      values: { vendor_id: unit.vendor_id || '', hire_from: unit.hire_from || '', hire_to: unit.hire_to || '', serial_number: unit.serial_number || '' },
      onSubmit: (v) => put(`/assets/${unit.id}`, { ...v, vendor_id: Number(v.vendor_id) }),
    });
  }
  const r = await formModal({
    title: `Add sub-hire units — ${p.name}`, wide: true,
    intro: 'Kit you’ve hired in that joins your stock for these dates: jobs on those days can use it, and it’s never counted as owned. To hire extra for just one job, use Sub-hire on that job’s line instead.',
    fields: [
      { name: 'vendor_id', label: 'Hired from', type: 'select', options: vOpts, required: true },
      ...dates,
      { name: 'codes', label: 'Their barcodes (optional)', type: 'textarea', rows: 4, help: 'Scan or type each unit’s barcode, one per line. Each line adds one unit.' },
      { name: 'count', label: 'Or just how many', type: 'number', min: 1, step: 1, half: true, help: 'Numbered for you, e.g. ' + (p.sku || 'ITEM') + '-SH-001.' },
    ],
    values: { vendor_id: p.vendor_id || '', count: 1 },
    submitLabel: 'Add units',
    onSubmit: (v) => {
      const codes = (v.codes || '').split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
      return post(`/products/${p.id}/assets`, { sub_hire: 1, vendor_id: Number(v.vendor_id), hire_from: v.hire_from, hire_to: v.hire_to,
        codes, count: codes.length ? undefined : (Number(v.count) || 1) });
    },
  });
  if (r) toast('Sub-hire units added', 'ok');
  return r;
}
const del_ = (p) => del(p);

let audioCtx;
const SOUND_KINDS = [['ok', 'Scan successful', 'Ticked off, or added to a flight case'],
  ['warn', 'Warning', 'Already scanned, all already done, a free scan, or a flight case to load'],
  ['error', 'Scan failed', 'Not on the job, unknown code, or in quarantine']];
// MP3, WAV and open formats (Ogg Vorbis / Opus, FLAC, WebM); some phones send files without a type, so go by the extension too.
const SOUND_EXT = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/opus', flac: 'audio/flac', webm: 'audio/webm' };
const soundCache = {};
function customSounds(s = S.settings) {
  try { const v = JSON.parse((s && s.custom_sounds) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
/** Your own sound for a scan result, loaded once and ready to play. */
function soundFor(kind) {
  const spec = customSounds()[kind];
  if (!spec) return null;
  const src = `/sound?k=${kind}&v=${spec.v || 0}`;
  if (!soundCache[kind] || soundCache[kind].dataset.src !== src) {
    const a = new Audio(src);
    a.preload = 'auto';
    a.dataset.src = src;
    soundCache[kind] = a;
  }
  return soundCache[kind];
}
function beep(kind) {
  const custom = soundFor(kind);
  if (custom) {
    try {
      custom.pause(); custom.currentTime = 0;
      const p = custom.play();
      if (p && p.catch) p.catch(() => tone(kind));  // couldn't play it (e.g. a format this browser can't): beep instead
      return;
    } catch { /* fall back to the beep */ }
  }
  tone(kind);
}
function tone(kind) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = kind === 'ok' ? 'sine' : 'square';
    o.frequency.value = kind === 'ok' ? 1200 : kind === 'warn' ? 520 : 220;
    g.gain.value = 0.08;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + (kind === 'ok' ? 0.08 : 0.25));
  } catch { /* no audio */ }
}

function freeScanOn() { try { return localStorage.getItem('het-free-scan') === '1'; } catch { return false; } }

/** Comment box for one item on the check out / in screen. */
function noteHTML(l) {
  return `${l.note ? '' : '<button type="button" class="link-btn small" data-note-open>+ Add a note</button>'}
    <div class="line-note" ${l.note ? '' : 'hidden'}><input data-note-input value="${esc(l.note || '')}" placeholder="Note, e.g. lens scratched, missing a clip" aria-label="Note for ${esc(l.name)}">
      ${l.note_by ? `<span class="by-note">— ${esc(l.note_by)}</span>` : ''}</div>`;
}

/** Flight case being packed on this device for a job (kept if the page reloads). */
function packingCase(jobId, v) {
  const key = `het-packing-${jobId}`;
  try {
    if (v === undefined) return Number(sessionStorage.getItem(key)) || null;
    if (v) sessionStorage.setItem(key, String(v)); else sessionStorage.removeItem(key);
  } catch { /* storage blocked */ }
  return v || null;
}
function caseName(c) { return [c.label, c.name].filter(Boolean).join(' — ') || c.code; }
function kg(v) { return `${num(Math.round((Number(v) || 0) * 10) / 10)} kg`; }

function casesCardHTML(cases, openId, closeCode) {
  return `<div class="card cases-card"><header><h2>Flight cases</h2>
      <span class="muted small">Scan a general flight case to load it${closeCode ? ` · scan <span class="mono">${esc(closeCode)}</span> to close it` : ''}</span></header>
    ${cases.length ? `<div class="table-wrap"><table class="table check-table cases-table"><tbody>${cases.map((c) => `<tr data-case="${c.id}" class="${c.id === openId ? 'just' : ''}">
      <td><strong>${esc(c.name)}</strong> <span class="mono muted small">${esc(c.code)}</span>
        ${c.id === openId ? '<span class="badge ok">Packing</span>' : c.open ? '<span class="badge warn" title="Open on another device">Open</span>' : '<span class="pill">Closed</span>'}
        <div class="case-fields"><label>Identifier <input data-case-field="label" value="${esc(c.label)}" placeholder="e.g. Case 3, FOH" aria-label="Identifier for ${esc(c.code)}"></label>
          <label>Room <input data-case-field="room" value="${esc(c.room)}" placeholder="e.g. Main hall" aria-label="Room for ${esc(c.code)}"></label></div>
        ${c.items.length ? `<div class="case-items small">${c.items.map((i) => `${num(i.quantity)} × ${esc(i.name)}${i.assets.length ? ` <span class="mono muted">(${i.assets.map((a) => esc(a.asset_number)).join(', ')})</span>` : ''}`).join('<br>')}</div>`
          : '<div class="muted small">Empty — scan items while it’s packing.</div>'}</td>
      <td class="n nowrap"><strong>${kg(c.total_kg)}</strong><br><span class="muted small">${kg(c.empty_kg)} case + ${kg(c.contents_kg)} contents</span></td>
      <td class="n nowrap">${c.id === openId ? '<button class="btn small primary" data-case-close>Close case</button>' : '<button class="btn small" data-case-open>Pack into it</button>'}
        <button class="btn small danger" data-case-unload title="Forget this case — items stay checked out">Unload</button></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">No flight cases loaded yet.</div>'}</div>`;
}

async function renderCheck(view, id, dir) {
  let st = await get(`/jobs/${id}/check?dir=${dir}`);
  const settings = dir === 'out' ? await get('/settings').catch(() => ({})) : {};
  const closeCode = settings.case_close_code || '';
  let packing = dir === 'out' ? packingCase(id) : null;
  if (packing && !(st.cases || []).some((c) => c.id === packing && c.open)) packing = packingCase(id, null);
  const job = st.job;
  const other = dir === 'out' ? 'in' : 'out';
  view.innerHTML = `<div class="page check-page">
    <div class="page-head"><div><a class="crumb" href="#/job/${id}">← ${esc(job.number)} ${esc(job.name)}</a>
      <h1>${dir === 'out' ? 'Check out' : 'Check in'}</h1><div class="sub">${esc(fmtRange(job.start_date, job.end_date))}${job.venue ? ' · ' + esc(job.venue) : ''}</div></div>
      <div class="actions"><a class="btn" href="#/check/${id}/${other}">Switch to check ${other}</a>
        <a class="btn" href="#/print/${id}/picklist">Prep list</a></div></div>
    <div class="card scan-card"><div class="body">
      <label class="scan-label" for="scan">Scan a barcode, or type an asset number / item code and press Enter</label>
      <input id="scan" class="scan-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="e.g. AUD-K12-003">
      <div class="scan-msg" data-msg aria-live="assertive"></div>
      <label class="check free-toggle"><input type="checkbox" data-free-toggle ${freeScanOn() ? 'checked' : ''}>
        <span><strong>Free scan</strong> — also record things that aren’t on this job, in their own section</span></label>
      <div data-packing></div>
    </div></div>
    <div data-body></div></div>`;
  const scan = $('#scan', view);
  const drawPacking = () => {
    const box = $('[data-packing]', view);
    const c = packing && (st.cases || []).find((x) => x.id === packing);
    box.innerHTML = c ? `<div class="banner packing-banner"><span>📦 Packing into <strong>${esc(caseName(c))}</strong>
        <span class="muted">· ${plural(c.item_count, 'item')} · ${kg(c.total_kg)}</span></span>
        <button class="btn small primary" data-case-close>Close case</button></div>` : '';
  };
  const drawBody = () => {
    if (dir === 'out') drawPacking();
    const pct = st.needed ? Math.round(100 * st.done / st.needed) : 0;
    const complete = st.needed && st.done >= st.needed;
    const groups = {};
    for (const l of st.lines) (groups[l.category || 'Other'] ||= []).push(l);
    $('[data-body]', view).innerHTML = `
      <div class="card"><header><h2>${num(st.done)} of ${num(st.needed)} ${dir === 'out' ? 'checked out' : 'checked back in'}</h2>
        <div class="actions"><button class="btn small" data-all>Tick everything</button><button class="btn small danger" data-clear-all>Clear all</button></div></header>
        <div class="body"><div class="bar big"><i style="width:${pct}%"></i></div>
        ${complete ? `<div class="banner ok-banner">✓ Everything is ${dir === 'out' ? 'checked out' : 'back'}.
          ${dir === 'out' && job.status !== 'out' ? '<button class="btn small primary" data-status="out">Mark job as On hire</button>' : ''}
          ${dir === 'in' && !['returned', 'invoiced'].includes(job.status) ? '<button class="btn small primary" data-status="returned">Mark job as Returned</button>' : ''}</div>` : ''}
        </div>
        ${st.lines.length ? `<div class="table-wrap"><table class="table check-table"><tbody>
        ${Object.keys(groups).sort().map((g) => `<tr class="group"><td colspan="4">${esc(g)}</td></tr>` + groups[g].map((l) => {
          const full = l.done >= l.needed;
          return `<tr class="${full ? 'full' : l.done ? 'part' : ''}" data-line="${l.product_id}">
            <td><strong>${esc(l.name)}</strong><br><span class="mono muted small">${esc(l.sku || '')}</span>${l.by && l.by.length ? ` <span class="by-note">· by ${esc(l.by.join(', '))}</span>` : ''}
              ${noteHTML(l)}
              ${l.assets.length ? `<div class="chips">${l.assets.map((a) => `<span class="chip" title="${esc(a.by ? `Scanned by ${a.by}` : 'Scanned')}${a.at ? ` at ${a.at.slice(11, 16)}` : ''}">${esc(a.asset_number)}<button data-undo="${a.check_id}" title="Undo this scan" aria-label="Undo">×</button></span>`).join('')}</div>` : ''}</td>
            <td class="n count"><strong>${num(l.done)}</strong> / ${num(l.needed)}</td>
            <td class="nowrap"><button class="btn small" data-delta="-1" ${l.done ? '' : 'disabled'} aria-label="One less">−</button>
              <button class="btn small" data-delta="1" ${full ? 'disabled' : ''} aria-label="One more">+</button></td>
            <td class="n"><button class="btn small ${full ? '' : 'primary'}" data-tick>${full ? 'Undo' : '✓ All'}</button></td></tr>`;
        }).join('')).join('')}</tbody></table></div>` : '<div class="empty">Nothing on this job to check yet.</div>'}
      </div>
      ${(st.free || []).length || freeScanOn() ? `<div class="card free-card"><header><h2>Free scan <span class="muted">— not on the job</span></h2>
        <span class="muted">${plural((st.free || []).reduce((a, f) => a + f.done, 0), 'item')}</span></header>
        ${(st.free || []).length ? `<div class="table-wrap"><table class="table check-table"><tbody>${st.free.map((f) => `<tr data-line="${f.product_id}" data-free-line>
          <td><strong>${esc(f.name)}</strong><br><span class="mono muted small">${esc(f.sku || '')}</span>${f.by.length ? ` <span class="by-note">· by ${esc(f.by.join(', '))}</span>` : ''}
            ${noteHTML(f)}
            ${f.assets.length ? `<div class="chips">${f.assets.map((a) => `<span class="chip">${esc(a.asset_number)}<button data-undo="${a.check_id}" title="Remove this scan" aria-label="Remove">×</button></span>`).join('')}</div>` : ''}</td>
          <td class="n count"><strong>${num(f.done)}</strong></td>
          <td class="n nowrap"><button class="btn small" data-free-add title="Add these to the job's equipment list">Add to job</button>
            <button class="btn small danger" data-free-remove title="Remove these free scans">Remove</button></td></tr>`).join('')}</tbody></table></div>`
          : '<div class="empty">Scan anything that isn’t on the job and it’s listed here.</div>'}</div>` : ''}
      ${dir === 'out' ? casesCardHTML(st.cases || [], packing, closeCode) : ''}`;
  };
  const setPacking = (c) => { packing = packingCase(id, c ? c.id : null); };
  const show = (kind, msg) => {
    const el = $('[data-msg]', view);
    if (kind === 'case_closed') kind = 'ok';
    if (kind === 'case') kind = 'warn';
    el.className = 'scan-msg ' + kind;
    el.textContent = (kind === 'ok' ? '✓ ' : kind === 'warn' ? '⚠ ' : '✗ ') + msg;
    beep(kind);
    scan.classList.remove('flash-ok', 'flash-warn', 'flash-error');
    void scan.offsetWidth;
    scan.classList.add('flash-' + kind);
  };
  drawBody();
  setTimeout(() => scan.focus(), 50);
  scan.onkeydown = async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = scan.value.trim();
    scan.value = '';
    if (!code) return;
    try {
      const r = await post(`/jobs/${id}/check/scan`, { code, dir, free: freeScanOn(), case_id: packing });
      st = { ...st, ...r };
      if ('open_case' in r) setPacking(r.open_case);
      drawBody();
      show(r.result === 'free' ? 'warn' : r.result, r.message);
      if (r.result === 'case' && r.case_offer) {
        const o = r.case_offer;
        const ok = await confirmModal(`${o.existing_id ? (o.reopen ? 'Open' : 'Carry on packing') : 'Load'} ${o.name} (${o.code})? Everything you scan after this goes in it, until you close it${closeCode ? ` or scan ${closeCode}` : ''}.`,
          { title: 'Load flight case?', okLabel: o.existing_id ? 'Pack into it' : 'Load case', danger: false });
        if (ok) {
          const res = await post(`/jobs/${id}/cases`, { code: o.code });
          st = { ...st, ...res };
          setPacking(res.open_case);
          drawBody();
          show('ok', `Packing into ${caseName(res.open_case)}`);
        }
        scan.focus();
        return;
      }
      const row = r.product_id && $(`[data-line="${r.product_id}"]`, view);
      if (row) { row.classList.add('just'); row.scrollIntoView({ block: 'nearest' }); }
    } catch (ex) { show('error', ex.message); }
  };
  const saveNote = async (inp) => {
    const pid = Number(inp.closest('[data-line]').dataset.line);
    try { st = { ...st, ...await put(`/jobs/${id}/check/note`, { dir, product_id: pid, note: inp.value.trim() }) }; toast(inp.value.trim() ? 'Note saved' : 'Note removed', 'ok'); drawBody(); }
    catch (ex) { toast(ex.message, 'error'); }
  };
  view.onchange = (e) => {
    if (e.target.matches('[data-free-toggle]')) {
      try { localStorage.setItem('het-free-scan', e.target.checked ? '1' : '0'); } catch { /* ignore */ }
      drawBody(); scan.focus();
      toast(e.target.checked ? 'Free scan on — items not on the job go in their own section' : 'Free scan off');
    }
    if (e.target.matches('[data-note-input]')) saveNote(e.target);
    const cf = e.target.closest('[data-case-field]');
    if (cf) {
      const cid = Number(cf.closest('[data-case]').dataset.case);
      put(`/cases/${cid}`, { [cf.dataset.caseField]: cf.value.trim() })
        .then((r) => { st = { ...st, ...r }; drawBody(); toast('Saved', 'ok'); })
        .catch((ex) => toast(ex.message, 'error'));
    }
  };
  view.onkeydown = (e) => {
    if (e.target.matches('[data-note-input]') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  };
  view.onclick = async (e) => {
    const t = e.target;
    const line = t.closest('[data-line]');
    const pid = line ? Number(line.dataset.line) : null;
    if (t.closest('[data-note-open]')) {
      const box = $('.line-note', line);
      box.hidden = false; $('input', box).focus();
      t.closest('[data-note-open]').hidden = true;
      return;
    }
    if (t.closest('[data-note-input]') || t.closest('[data-case-field]')) return;
    const caseRow = t.closest('[data-case]');
    const caseId = caseRow ? Number(caseRow.dataset.case) : packing;
    try {
      if (t.closest('[data-case-close]')) {
        st = { ...st, ...await put(`/cases/${caseId}`, { closed: true }) };
        if (caseId === packing) setPacking(null);
        toast('Flight case closed', 'ok');
      } else if (t.closest('[data-case-open]')) {
        st = { ...st, ...await put(`/cases/${caseId}`, { closed: false }) };
        setPacking({ id: caseId });
        toast('Packing into this case — scan items to add them', 'ok');
      } else if (t.closest('[data-case-unload]')) {
        if (!await confirmModal('Unload this flight case? Its items stay checked out, just not recorded as in a case.', { okLabel: 'Unload' })) return;
        st = { ...st, ...await del(`/cases/${caseId}`) };
        if (caseId === packing) setPacking(null);
      } else if (t.closest('[data-free-add]')) {
        const f = st.free.find((x) => x.product_id === pid);
        await post(`/jobs/${id}/items`, { product_id: pid, quantity: f.done });
        st = await get(`/jobs/${id}/check?dir=${dir}`);
        toast(`${num(f.done)} × ${f.name} added to the job`, 'ok');
      } else if (t.closest('[data-free-remove]')) {
        const f = st.free.find((x) => x.product_id === pid);
        for (const cid of f.check_ids) st = { ...st, ...await del(`/checks/${cid}`) };
      } else if (t.closest('[data-delta]')) st = { ...st, ...await post(`/jobs/${id}/check/adjust`, { dir, product_id: pid, delta: Number(t.closest('[data-delta]').dataset.delta) }) };
      else if (t.closest('[data-tick]')) {
        const l = st.lines.find((x) => x.product_id === pid);
        st = { ...st, ...await post(`/jobs/${id}/check/adjust`, l.done >= l.needed ? { dir, product_id: pid, clear: true } : { dir, product_id: pid, all: true }) };
      } else if (t.closest('[data-undo]')) st = { ...st, ...await del(`/checks/${t.closest('[data-undo]').dataset.undo}`) };
      else if (t.closest('[data-all]')) st = { ...st, ...await post(`/jobs/${id}/check/adjust`, { dir, all: true }) };
      else if (t.closest('[data-clear-all]')) {
        if (!await confirmModal(`Clear every ${dir === 'out' ? 'check-out' : 'check-in'} tick and scan for this job?`, { okLabel: 'Clear all' })) return;
        st = { ...st, ...await post(`/jobs/${id}/check/adjust`, { dir, clear: true }) };
      } else if (t.closest('[data-status]')) {
        await put(`/jobs/${id}`, { status: t.closest('[data-status]').dataset.status });
        job.status = t.closest('[data-status]').dataset.status;
        toast(`Job marked ${STATUS[job.status]}`, 'ok');
      } else { if (!t.closest('a,input,button')) scan.focus(); return; }
      drawBody();
      scan.focus();
    } catch (ex) { toast(ex.message, 'error'); }
  };
}

/* ---------------------------------------------------------------- room planner */
// Everything is in metres. Top-down: the stage end is at the top, the audience at the bottom.
// Stage view: looking from the audience towards the stage, so left/right match the top-down view.

const PLAN_COLOURS = ['#5b8def', '#e07b39', '#3aa676', '#c4529b', '#8f6ad8', '#d4a72c', '#4bb3c4', '#c95d5d', '#7d8b99'];
const planColour = (key) => {
  let h = 0;
  for (const ch of String(key || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PLAN_COLOURS[h % PLAN_COLOURS.length];
};
/** The label that fits in a shape: the full name if it fits, otherwise its initials (e.g. "RMH"). */
function fitLabel(label, w, h, max) {
  const full = (label || '').slice(0, 28);
  const size = (t) => Math.min(max, h * 0.6, (w * 0.92) / Math.max(1, t.length * 0.56));
  if (size(full) >= 0.1) return [full, size(full)];
  const ab = planAbbr(full);
  return [ab, size(ab)];
}
const planAbbr = (t) => (t || '').replace(/[()"]/g, ' ').split(/[\s/×-]+/).filter((w) => /[A-Za-z0-9]/.test(w))
  .map((w) => (/^\d/.test(w) ? w.replace(/\D/g, '').slice(0, 3) : w[0].toUpperCase())).join('').slice(0, 5);
const planId = () => Math.random().toString(36).slice(2, 10);
const r2 = (v) => Math.round(v * 100) / 100;

/** Footprint width along the room's width once rotated (for the stage view). */
function projectedWidth(o) {
  if (o.shape === 'round') return o.w;
  const a = (o.rot || 0) * Math.PI / 180;
  return Math.abs(o.w * Math.cos(a)) + Math.abs(o.d * Math.sin(a));
}

function planObjectFromItem(it) {
  const deck = it.equip_kind === 'deck' && it.deck_w;
  const w = it.size_w ? it.size_w / 100 : deck ? it.deck_w : 0.5;
  const d = it.size_d ? it.size_d / 100 : deck ? it.deck_d : 0.5;
  const h = it.size_h ? it.size_h / 100 : deck ? 0.4 : it.equip_kind === 'stand' ? (it.stand_h || it.stand_h_max || 1.8) : 0.5;
  return { id: planId(), product_id: it.product_id, label: it.name, shape: it.plan_shape === 'round' ? 'round' : 'box', w: r2(w), d: r2(d), h: r2(h),
    z: 0, rot: 0, color: planColour(it.category || it.name), nosize: !it.size_w && !deck };
}

function planObjectFromStage(st) {
  const h = (heightCm(st.height) || 40) / 100;
  return { id: planId(), stage_id: st.id, label: st.description, shape: 'box', w: st.width, d: st.depth, h: r2(h), z: 0, rot: 0, color: '#9a7b4f' };
}

function topSVG(room, { selected = null, edit = false } = {}) {
  const W = room.w, D = room.d, m = 0.6;
  let grid = '';
  for (let x = 0; x <= W + 1e-9; x += 0.5) grid += `<line x1="${x}" y1="0" x2="${x}" y2="${D}" class="${Math.abs(x % 1) < 1e-6 ? 'g1' : 'g2'}"/>`;
  for (let y = 0; y <= D + 1e-9; y += 0.5) grid += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" class="${Math.abs(y % 1) < 1e-6 ? 'g1' : 'g2'}"/>`;
  const objs = (room.objects || []).map((o0) => {
    const o = o0.color ? o0 : { ...o0, color: planColour(o0.label) };
    const sel = o.id === selected;
    const body = o.shape === 'round'
      ? `<ellipse cx="${o.x}" cy="${o.y}" rx="${o.w / 2}" ry="${o.d / 2}" fill="${o.color}" fill-opacity=".35" stroke="${o.color}" stroke-width="${sel ? 0.06 : 0.03}"/>`
      : `<rect x="${o.x - o.w / 2}" y="${o.y - o.d / 2}" width="${o.w}" height="${o.d}" rx="0.03" fill="${o.color}" fill-opacity=".35" stroke="${o.color}" stroke-width="${sel ? 0.06 : 0.03}"/>`;
    const [lab, fs] = fitLabel(o.label, o.w, o.d, 0.3);
    const label = fs >= 0.07 ? `<text x="${o.x}" y="${o.y + fs * 0.35}" font-size="${fs}" text-anchor="middle" class="pl">${esc(lab)}</text>` : '';
    const front = o.shape === 'round' ? '' : `<line x1="${o.x - o.w / 2 + 0.04}" y1="${o.y + o.d / 2 - 0.03}" x2="${o.x + o.w / 2 - 0.04}" y2="${o.y + o.d / 2 - 0.03}" stroke="${o.color}" stroke-width="0.05"/>`;
    return `<g class="po${sel ? ' sel' : ''}" data-obj="${o.id}" transform="rotate(${o.rot || 0} ${o.x} ${o.y})">${body}${front}${label}</g>`;
  }).join('');
  return `<svg class="plan-svg${edit ? ' editing' : ''}" data-view="top" viewBox="${-m} ${-m} ${W + m * 2} ${D + m * 2 + 0.4}" role="img" aria-label="Top-down plan of ${esc(room.name)}">
    <rect x="0" y="0" width="${W}" height="${D}" class="room"/>${grid}
    <text x="${W / 2}" y="${-0.2}" font-size="0.28" text-anchor="middle" class="pmut">STAGE END</text>
    <text x="${W / 2}" y="${D + 0.42}" font-size="0.28" text-anchor="middle" class="pmut">AUDIENCE · ${num(W)} m × ${num(D)} m</text>
    ${objs}</svg>`;
}

function stageSVGView(room, { selected = null, edit = false } = {}) {
  const W = room.w, H = room.h || 4, m = 0.6;
  const objs = [...(room.objects || [])].sort((a, b) => a.y - b.y).map((o0) => {
    const o = o0.color ? o0 : { ...o0, color: planColour(o0.label) };
    const pw = projectedWidth(o);
    const depth = room.d ? Math.min(1, Math.max(0, o.y / room.d)) : 1;   // further back = lighter
    const sel = o.id === selected;
    const top = H - (o.z || 0) - o.h;
    const [lab, fs] = fitLabel(o.label, pw, o.h, 0.28);
    return `<g class="po${sel ? ' sel' : ''}" data-obj="${o.id}">
      <rect x="${o.x - pw / 2}" y="${top}" width="${pw}" height="${o.h}" rx="${o.shape === 'round' ? Math.min(pw, o.h) * 0.15 : 0.02}"
        fill="${o.color}" fill-opacity="${0.25 + depth * 0.45}" stroke="${o.color}" stroke-width="${sel ? 0.06 : 0.025}"/>
      ${fs >= 0.07 ? `<text x="${o.x}" y="${top + o.h / 2 + fs * 0.35}" font-size="${fs}" text-anchor="middle" class="pl">${esc(lab)}</text>` : ''}</g>`;
  }).join('');
  let ticks = '';
  for (let z = 0; z <= H + 1e-9; z += 1) ticks += `<line x1="${-0.15}" y1="${H - z}" x2="0" y2="${H - z}" class="g1"/><text x="${-0.22}" y="${H - z + 0.08}" font-size="0.2" text-anchor="end" class="pmut">${z}m</text>`;
  return `<svg class="plan-svg${edit ? ' editing' : ''}" data-view="stage" viewBox="${-m} ${-0.4} ${W + m * 2} ${H + 1.1}" role="img" aria-label="Stage view of ${esc(room.name)}">
    <rect x="0" y="0" width="${W}" height="${H}" class="room"/>
    <line x1="0" y1="${H}" x2="${W}" y2="${H}" class="floor"/>${ticks}
    <text x="${W / 2}" y="${-0.12}" font-size="0.24" text-anchor="middle" class="pmut">STAGE VIEW — looking from the audience · ceiling ${num(H)} m</text>
    ${objs}</svg>`;
}

async function renderPlan(view, jid) {
  const [job, data] = await Promise.all([get(`/jobs/${jid}`), get(`/jobs/${jid}/plan`)]);
  const plan = data.plan || { rooms: [{ id: planId(), name: job.venue || 'Room 1', w: 20, d: 15, h: 4, objects: [] }] };
  for (const r of plan.rooms) { r.id ||= planId(); r.objects ||= []; r.h ||= 4; }
  let roomIdx = 0, selected = null, dirty = false, saving = null, loud = true;
  const editable = canEditJob(job);
  const room = () => plan.rooms[roomIdx];
  const viewMode = () => S.planView || 'both';

  const placedCount = (pid) => plan.rooms.reduce((a, r) => a + r.objects.filter((o) => o.product_id === pid).length, 0);
  const save = () => {
    if (!editable) return;
    dirty = true;
    $('[data-save-state]', view).textContent = 'Saving…';
    clearTimeout(saving);
    saving = setTimeout(async () => {
      try {
        await put(`/jobs/${jid}/plan`, { plan, quiet: !loud });
        loud = false; dirty = false;
        $('[data-save-state]', view).textContent = 'Saved';
      } catch (ex) { $('[data-save-state]', view).textContent = ''; toast(ex.message, 'error'); }
    }, 700);
  };

  view.innerHTML = `<div class="page plan-page">
    <div class="page-head"><div><a class="crumb" href="#/job/${jid}">← ${esc(job.number)} ${esc(job.name)}</a><h1>Room plan</h1>
      <div class="sub">Drag things to place them. Sizes come from each stock item (Stock → Edit → Size).${editable ? '' : ' <strong>This job is locked — view only.</strong>'}</div></div>
      <div class="actions"><span class="muted small" data-save-state>${data.updated_at ? `Saved${data.updated_by ? ` by ${esc(data.updated_by)}` : ''}` : ''}</span>
        <div class="tabs" role="tablist">${[['top', 'Top down'], ['stage', 'Stage view'], ['both', 'Both']].map(([k, l]) => `<button data-pview="${k}">${l}</button>`).join('')}</div>
        <a class="btn" href="#/print/${jid}/plan">Print</a></div></div>
    <div class="plan-rooms" data-rooms></div>
    <div class="plan-layout">
      <aside class="card plan-palette" data-palette></aside>
      <div class="plan-main"><div class="card plan-canvas" data-canvas></div><div class="card plan-inspector" data-inspector></div></div>
    </div></div>`;

  const drawRooms = () => {
    $('[data-rooms]', view).innerHTML = `${plan.rooms.map((r, i) => `<button class="btn small ${i === roomIdx ? 'primary' : ''}" data-room="${i}">${esc(r.name)}</button>`).join('')}
      ${editable ? '<button class="btn small" data-room-add>+ Room</button>' : ''}
      <span class="plan-room-size">${editable ? `<label>Name <input data-rf="name" value="${esc(room().name)}"></label>
        <label>Width <input data-rf="w" type="number" min="1" max="500" step="0.5" value="${num(room().w)}"> m</label>
        <label>Depth <input data-rf="d" type="number" min="1" max="500" step="0.5" value="${num(room().d)}"> m</label>
        <label>Ceiling <input data-rf="h" type="number" min="1" max="60" step="0.1" value="${num(room().h)}"> m</label>
        ${plan.rooms.length > 1 ? '<button class="btn small danger" data-room-del>Delete room</button>' : ''}` : `${num(room().w)} × ${num(room().d)} m, ceiling ${num(room().h)} m`}</span>`;
  };
  const drawPalette = () => {
    const items = data.items;
    $('[data-palette]', view).innerHTML = `<header><h2>From this job</h2></header>
      <div class="plan-list">${items.length ? items.map((it) => {
        const placed = placedCount(it.product_id);
        return `<button class="plan-add" data-add-item="${it.product_id}" ${editable ? '' : 'disabled'} title="Add one to the room">
          <span class="sw" style="background:${planColour(it.category || it.name)}"></span>
          <span class="nm">${esc(it.name)}${!it.size_w && !(it.equip_kind === 'deck' && it.deck_w) ? ' <span class="muted small">(no size set)</span>' : ''}</span>
          <span class="ct ${placed >= it.quantity ? 'done' : ''}">${num(placed)}/${num(it.quantity)}</span></button>`;
      }).join('') : '<p class="muted small" style="padding:0 14px">Add equipment to the job first.</p>'}
      ${data.stages.map((st) => `<button class="plan-add" data-add-stage="${st.id}" ${editable ? '' : 'disabled'}><span class="sw" style="background:#9a7b4f"></span>
        <span class="nm">${esc(st.description)}</span><span class="ct">${num(st.width)}×${num(st.depth)}m</span></button>`).join('')}</div>
      ${editable ? `<div class="body" style="border-top:1px solid var(--border)"><button class="btn small" data-add-shape>+ Shape (table, bar, screen…)</button>
        ${items.length ? '<button class="btn small" data-add-all style="margin-top:6px">Place everything not yet placed</button>' : ''}</div>` : ''}`;
  };
  const drawCanvas = () => {
    const vm = viewMode();
    $$('[data-pview]', view).forEach((b) => b.classList.toggle('active', b.dataset.pview === vm));
    $('[data-canvas]', view).innerHTML = (vm !== 'stage' ? topSVG(room(), { selected, edit: editable }) : '') + (vm !== 'top' ? stageSVGView(room(), { selected, edit: editable }) : '');
  };
  const drawInspector = () => {
    const o = room().objects.find((x) => x.id === selected);
    const box = $('[data-inspector]', view);
    if (!o) { box.innerHTML = `<div class="body muted small">${editable ? 'Click something to change its size, height off the floor or angle. Arrow keys nudge it, R rotates, Delete removes it.' : 'Click something to see its details.'}</div>`; return; }
    const stageHeights = room().objects.filter((x) => x.stage_id).map((x) => x.h);
    box.innerHTML = `<div class="body plan-insp">
      <label class="wide">Label <input data-of="label" value="${esc(o.label || '')}" ${editable ? '' : 'disabled'}></label>
      <label>Width <input data-of="w" type="number" min="0.05" step="0.05" value="${num(o.w)}" ${editable ? '' : 'disabled'}> m</label>
      <label>Depth <input data-of="d" type="number" min="0.05" step="0.05" value="${num(o.d)}" ${editable ? '' : 'disabled'}> m</label>
      <label>Height <input data-of="h" type="number" min="0.05" step="0.05" value="${num(o.h)}" ${editable ? '' : 'disabled'}> m</label>
      <label>Off the floor <input data-of="z" type="number" min="0" step="0.05" value="${num(o.z || 0)}" ${editable ? '' : 'disabled'}> m</label>
      <label>Angle <input data-of="rot" type="number" step="15" value="${num(o.rot || 0)}" ${editable ? '' : 'disabled'}>°</label>
      <label>Shape <select data-of="shape" ${editable ? '' : 'disabled'}><option value="box" ${o.shape !== 'round' ? 'selected' : ''}>Box</option><option value="round" ${o.shape === 'round' ? 'selected' : ''}>Round</option></select></label>
      <label>Colour <input data-of="color" type="color" value="${esc(o.color)}" ${editable ? '' : 'disabled'}></label>
      ${editable ? `<div class="wide actions">
        <button class="btn small" data-rot="90">Rotate 90°</button>
        ${[...new Set(stageHeights)].map((h) => `<button class="btn small" data-on-stage="${h}">On the stage (${num(h)} m)</button>`).join('')}
        <button class="btn small" data-dup>Duplicate</button><button class="btn small danger" data-del-obj>Remove</button></div>` : ''}
      <p class="wide muted small" style="margin:0">Position ${num(r2(o.x))} m from the left, ${num(r2(o.y))} m from the stage end.${o.nosize ? ' This item has no size in Stock yet, so it’s a 50 cm box — set its size in Stock for a truer plan.' : ''}</p>
    </div>`;
  };
  const drawAll = () => { drawRooms(); drawPalette(); drawCanvas(); drawInspector(); };

  const addObject = (o) => {
    const r = room();
    const n = r.objects.length;
    o.x = r2(Math.min(r.w - o.w / 2, Math.max(o.w / 2, r.w / 2 + ((n % 5) - 2) * 0.6)));
    o.y = r2(Math.min(r.d - o.d / 2, Math.max(o.d / 2, r.d / 2 + ((Math.floor(n / 5) % 5) - 2) * 0.6)));
    r.objects.push(o);
    selected = o.id;
    drawAll(); save();
  };

  // dragging: top view moves x/y, stage view moves x and height off the floor
  let drag = null;
  const svgPoint = (svg, e) => {
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  };
  view.onpointerdown = (e) => {
    const g = e.target.closest('[data-obj]');
    const svg = e.target.closest('svg.plan-svg');
    if (!svg) return;
    if (!g) { selected = null; drawCanvas(); drawInspector(); return; }
    selected = g.dataset.obj;
    const o = room().objects.find((x) => x.id === selected);
    if (!editable || !o) { drawCanvas(); drawInspector(); return; }
    const p0 = svgPoint(svg, e);
    drag = { o, kind: svg.dataset.view, sx: p0.x, sy: p0.y, ox: o.x, oy: o.y, oz: o.z || 0, moved: false, svgView: svg.dataset.view };
    e.preventDefault();
    drawCanvas(); drawInspector();
  };
  view.onpointermove = (e) => {
    if (!drag) return;
    const svg = $(`svg.plan-svg[data-view="${drag.svgView}"]`, view);
    if (!svg) return;
    const p = svgPoint(svg, e);
    const snap = e.altKey ? 0.01 : 0.05;
    const r = room(), o = drag.o;
    o.x = r2(Math.round(Math.min(r.w, Math.max(0, drag.ox + p.x - drag.sx)) / snap) * snap);
    if (drag.kind === 'top') o.y = r2(Math.round(Math.min(r.d, Math.max(0, drag.oy + p.y - drag.sy)) / snap) * snap);
    else o.z = r2(Math.max(0, Math.round((drag.oz - (p.y - drag.sy)) / snap) * snap));
    drag.moved = true;
    drawCanvas();
  };
  const endDrag = () => { if (drag && drag.moved) { drawInspector(); save(); } drag = null; };
  view.onpointerup = endDrag;
  view.onpointercancel = endDrag;

  view.onclick = async (e) => {
    const t = e.target;
    const pv = t.closest('[data-pview]');
    if (pv) { S.planView = pv.dataset.pview; drawCanvas(); return; }
    const rb = t.closest('[data-room]');
    if (rb) { roomIdx = Number(rb.dataset.room); selected = null; drawAll(); return; }
    if (!editable) return;
    if (t.closest('[data-room-add]')) {
      plan.rooms.push({ id: planId(), name: `Room ${plan.rooms.length + 1}`, w: 10, d: 8, h: 3, objects: [] });
      roomIdx = plan.rooms.length - 1; selected = null; drawAll(); save(); return;
    }
    if (t.closest('[data-room-del]')) {
      if (!await confirmModal(`Delete ${room().name} and everything placed in it?`, { okLabel: 'Delete room' })) return;
      plan.rooms.splice(roomIdx, 1); roomIdx = 0; selected = null; drawAll(); save(); return;
    }
    const ai = t.closest('[data-add-item]');
    if (ai) { addObject(planObjectFromItem(data.items.find((x) => String(x.product_id) === ai.dataset.addItem))); return; }
    const as = t.closest('[data-add-stage]');
    if (as) { addObject(planObjectFromStage(data.stages.find((x) => String(x.id) === as.dataset.addStage))); return; }
    if (t.closest('[data-add-all]')) {
      // lay them out in rows from the stage end, a gap between each, grouped by item
      const r = room();
      let x = 0.4, y = 0.6, rowH = 0, added = 0;
      for (const it of data.items) {
        const left = Math.max(0, Math.min(60, it.quantity - placedCount(it.product_id)));
        for (let i = 0; i < left; i++) {
          const o = planObjectFromItem(it);
          if (x + o.w > r.w - 0.2 && x > 0.4) { x = 0.4; y += rowH + 0.4; rowH = 0; }
          if (y + o.d > r.d) y = 0.6;  // room's full: start overlapping from the top again
          o.x = r2(x + o.w / 2); o.y = r2(y + o.d / 2);
          x += o.w + 0.2; rowH = Math.max(rowH, o.d);
          r.objects.push(o); added += 1;
        }
        if (left) { x += 0.4; }
      }
      selected = null; drawAll(); save();
      toast(added ? `${plural(added, 'thing')} placed — drag them where they go` : 'Everything is already placed', 'ok');
      return;
    }
    if (t.closest('[data-add-shape]')) {
      const v = await formModal({
        title: 'Add a shape', fields: [
          { name: 'label', label: 'Label', required: true, placeholder: 'e.g. Round table, Bar, FOH desk' },
          { name: 'w', label: 'Width (m)', type: 'number', min: 0.05, step: 'any', third: true },
          { name: 'd', label: 'Depth (m)', type: 'number', min: 0.05, step: 'any', third: true },
          { name: 'h', label: 'Height (m)', type: 'number', min: 0.05, step: 'any', third: true },
          { name: 'shape', label: 'Shape', type: 'select', half: true, options: [['box', 'Box / rectangle'], ['round', 'Round']] }],
        values: { w: 1.5, d: 1.5, h: 0.75, shape: 'round' }, submitLabel: 'Add',
      });
      if (v) addObject({ id: planId(), label: v.label, shape: v.shape, w: Number(v.w) || 1, d: Number(v.d) || 1, h: Number(v.h) || 0.75, z: 0, rot: 0, color: planColour(v.label) });
      return;
    }
    const o = room().objects.find((x) => x.id === selected);
    if (!o) return;
    if (t.closest('[data-rot]')) { o.rot = ((o.rot || 0) + 90) % 360; drawCanvas(); drawInspector(); save(); return; }
    const os = t.closest('[data-on-stage]');
    if (os) { o.z = Number(os.dataset.onStage); drawCanvas(); drawInspector(); save(); return; }
    if (t.closest('[data-dup]')) { addObject({ ...o, id: planId() }); return; }
    if (t.closest('[data-del-obj]')) { room().objects = room().objects.filter((x) => x.id !== o.id); selected = null; drawAll(); save(); }
  };
  view.oninput = (e) => {
    if (!editable) return;
    const rf = e.target.dataset.rf;
    if (rf) {
      const r = room();
      if (rf === 'name') { r.name = e.target.value || 'Room'; $(`[data-room="${roomIdx}"]`, view).textContent = r.name; }
      else { const v = Number(e.target.value); if (v > 0) r[rf] = v; drawCanvas(); }
      save(); return;
    }
    const of = e.target.dataset.of;
    if (of) {
      const o = room().objects.find((x) => x.id === selected);
      if (!o) return;
      if (of === 'label' || of === 'color' || of === 'shape') o[of] = e.target.value;
      else { const v = Number(e.target.value); if (Number.isFinite(v) && (of === 'rot' || of === 'z' || v > 0)) o[of] = of === 'rot' ? ((v % 360) + 360) % 360 : v; }
      if (of !== 'label') delete o.nosize;
      drawCanvas(); save();
    }
  };
  view.onkeydown = (e) => {
    if (!editable || !selected || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const o = room().objects.find((x) => x.id === selected);
    if (!o) return;
    const step = e.shiftKey ? 0.5 : 0.1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) { e.preventDefault(); o.x = r2(o.x + moves[e.key][0]); o.y = r2(o.y + moves[e.key][1]); }
    else if (e.key === 'r' || e.key === 'R') o.rot = ((o.rot || 0) + (e.shiftKey ? -15 : 15) + 360) % 360;
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); room().objects = room().objects.filter((x) => x.id !== o.id); selected = null; drawAll(); save(); return; }
    else return;
    drawCanvas(); drawInspector(); save();
  };
  const leave = () => { if (dirty) put(`/jobs/${jid}/plan`, { plan, quiet: !loud }).catch(() => {}); window.removeEventListener('hashchange', leave); };
  window.addEventListener('hashchange', leave);
  drawAll();
  view.tabIndex = -1;
}

/* ---------------------------------------------------------------- Scan page: check in from any job, or look up */

async function renderScan(view) {
  const mode = () => S.scanMode || 'in';
  view.innerHTML = `<div class="page check-page">
    <div class="page-head"><div><h1>Scan</h1><div class="sub">Check things back in without opening the job, or look up where something is.</div></div></div>
    <div class="card scan-card"><div class="body">
      <div class="tabs scan-modes" role="tablist">
        <button type="button" data-mode="in" role="tab">Check in</button>
        <button type="button" data-mode="lookup" role="tab">Look up only</button>
      </div>
      <label class="scan-label" for="scan" data-mode-help></label>
      <input id="scan" class="scan-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Scan a barcode…">
      <div class="scan-msg" data-msg aria-live="assertive"></div>
      <div data-choose></div>
    </div></div>
    <div data-result></div>
    <div class="card" data-log-card hidden><header><h2>This session</h2><button class="btn small" data-clear-log>Clear</button></header><ul class="act-list" data-log></ul></div>
  </div>`;
  const scan = $('#scan', view);
  const setMode = (m) => {
    S.scanMode = m;
    $$('[data-mode]', view).forEach((b) => { b.classList.toggle('active', b.dataset.mode === m); b.setAttribute('aria-selected', String(b.dataset.mode === m)); });
    $('[data-mode-help]', view).textContent = m === 'in'
      ? 'Scan an item and it’s checked back in to the job it went out on — no need to open the job.'
      : 'Scan an item to see what it is and which job it’s on. Nothing is checked in or out.';
    scan.focus();
  };
  const flashKind = (k) => (k === 'info' ? 'ok' : k === 'choose' ? 'warn' : k);
  const show = (kind, msg) => {
    const el = $('[data-msg]', view);
    el.className = 'scan-msg ' + flashKind(kind);
    el.textContent = (kind === 'ok' ? '✓ ' : kind === 'warn' || kind === 'choose' ? '⚠ ' : kind === 'info' ? '' : '✗ ') + msg;
    beep(flashKind(kind));
    scan.classList.remove('flash-ok', 'flash-warn', 'flash-error');
    void scan.offsetWidth;
    scan.classList.add('flash-' + flashKind(kind));
  };
  const jobRow = (j) => `<tr class="click" data-href="#/job/${j.id}"><td><span class="mono muted">${esc(j.number)}</span> <strong>${esc(j.name)}</strong> ${pill(j.status)}
      ${j.current ? '<span class="badge ok">on now</span>' : ''}<br><span class="muted small">${esc(fmtRange(j.start_date, j.end_date))}${j.venue ? ' · ' + esc(j.venue) : ''}</span></td>
    <td class="n">${num(j.quantity)} on job</td><td class="n">${num(j.out)} out · ${num(j.in)} back</td>
    <td class="n"><a class="btn small" href="#/check/${j.id}/in">Check in</a></td></tr>`;
  const drawResult = (r) => {
    const p = r.product;
    $('[data-result]', view).innerHTML = `<div class="card"><header><h2>${esc(p.name)}</h2><a class="btn small" href="#/product/${p.parent_id || p.id}">Open stock item</a></header>
      <div class="body"><div class="name-cell">${p.image_id ? `<img class="thumb" style="width:72px;height:72px" src="/img/${p.image_id}/thumb" alt="">` : ''}
        <dl class="kv" style="margin:0">
          ${r.asset ? `<dt>Unit</dt><dd class="mono">${esc(r.asset.asset_number)}${r.asset.serial_number ? ` <span class="muted">· serial ${esc(r.asset.serial_number)}</span>` : ''}</dd>` : `<dt>Code</dt><dd class="mono">${esc(r.code)}</dd>`}
          ${p.brand ? `<dt>Brand</dt><dd>${esc(p.brand)}</dd>` : ''}
          <dt>Category</dt><dd>${esc(catLabel(p) || '—')}</dd>
          ${r.quarantine ? `<dt>Status</dt><dd><span class="badge warn">In quarantine</span> ${esc(r.quarantine.reason || '')}</dd>` : ''}
          <dt>Where</dt><dd>${r.out_on ? `<strong>Out on <a href="#/job/${r.out_on.id}">${esc(r.out_on.number)} ${esc(r.out_on.name)}</a></strong>
            <span class="muted">since ${esc(fmtDate(r.out_on.since.slice(0, 10)))} ${esc(r.out_on.since.slice(11, 16))}${r.out_on.by ? ` · by ${esc(r.out_on.by)}` : ''}</span>`
            : r.asset ? 'In the store (not checked out on any job)' : (() => { const n = r.jobs.reduce((a, j) => a + Math.max(0, j.out - j.in), 0); return n ? `${num(n)} ${n === 1 ? 'is' : 'are'} out on ${r.jobs.filter((j) => j.out > j.in).length === 1 ? 'a job' : 'jobs'}` : 'None are out on jobs right now'; })()}</dd>
        </dl></div></div>
      ${r.jobs.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Booked on</th><th class="n">Qty</th><th class="n">Checked</th><th></th></tr></thead>
        <tbody>${r.jobs.map(jobRow).join('')}</tbody></table></div>` : '<div class="empty">Not booked on any current or upcoming job.</div>'}</div>`;
  };
  const log = (kind, msg) => {
    $('[data-log-card]', view).hidden = false;
    $('[data-log]', view).insertAdjacentHTML('afterbegin', `<li><span class="t">${new Date().toTimeString().slice(0, 5)}</span><span class="${kind === 'error' ? 'form-error' : ''}">${kind === 'ok' ? '✓' : kind === 'error' ? '✗' : '•'} ${esc(msg)}</span></li>`);
  };
  const send = async (code, jobId) => {
    $('[data-choose]', view).innerHTML = '';
    try {
      const r = await post('/scan', { code, mode: mode(), job_id: jobId || null });
      drawResult(r);
      if (r.result === 'info') { show('info', `${r.product.name}${r.out_on ? ` — out on ${r.out_on.number}` : ''}`); return; }
      if (r.result === 'choose') {
        show('choose', r.message);
        $('[data-choose]', view).innerHTML = `<div class="actions" style="margin-top:10px">${r.choices.map((j) => `<button class="btn" data-pick-job="${j.id}" data-code="${esc(code)}">${esc(j.number)} ${esc(j.name)} <span class="muted">(${num(j.out - j.in)} out)</span></button>`).join('')}</div>`;
        return;
      }
      show(r.result, r.job ? `${r.message} — ${r.job.number} ${r.job.name} (${num(r.job_progress.done)}/${num(r.job_progress.needed)} back)` : r.message);
      log(r.result, r.job ? `${r.message} → ${r.job.number}` : r.message);
    } catch (ex) { show('error', ex.message); log('error', `${code}: ${ex.message}`); }
    scan.focus();
  };
  scan.onkeydown = async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = scan.value.trim();
    scan.value = '';
    if (code) await send(code);
  };
  rowLinks(view);
  const base = view.onclick;
  view.onclick = async (e) => {
    const m = e.target.closest('[data-mode]');
    if (m) { setMode(m.dataset.mode); return; }
    const pj = e.target.closest('[data-pick-job]');
    if (pj) { await send(pj.dataset.code, Number(pj.dataset.pickJob)); return; }
    if (e.target.closest('[data-clear-log]')) { $('[data-log]', view).innerHTML = ''; $('[data-log-card]', view).hidden = true; scan.focus(); return; }
    if (!e.target.closest('a,button,input,tr.click')) scan.focus();
    if (base) base(e);
  };
  setMode(mode());
}

async function renderQuarantine(view) {
  const q = await get('/quarantine');
  view.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Quarantine</h1><div class="sub">Equipment out of service. It isn't counted as available until it's returned to service.</div></div></div>
    <div class="card"><header><h2>Currently in quarantine</h2><span class="muted">${plural(q.active.reduce((s, x) => s + x.quantity, 0), 'unit')}</span></header>
      ${q.active.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Item</th><th>Unit</th><th class="n">Qty</th><th>Reason</th><th>Since</th><th></th></tr></thead><tbody>
      ${q.active.map((x) => `<tr><td><a href="#/product/${x.product_id}"><strong>${esc(x.product_name)}</strong></a><br><span class="muted">${esc(x.category)}</span></td>
        <td class="mono">${esc(x.asset_number || '—')}</td><td class="n">${num(x.quantity)}</td><td>${esc(x.reason)}</td>
        <td>${esc(fmtDate(x.started_at.slice(0, 10)))}</td>
        <td class="n"><button class="btn small" data-release="${x.id}">Return to service</button></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">Nothing in quarantine. To quarantine something, open it in Stock.</div>'}</div>
    ${q.recent.length ? `<div class="card"><header><h2>Recently returned to service</h2></header><div class="table-wrap"><table class="table"><tbody>
      ${q.recent.map((x) => `<tr><td><a href="#/product/${x.product_id}">${esc(x.product_name)}</a></td><td class="mono">${esc(x.asset_number || '')}</td>
        <td class="n">${num(x.quantity)}</td><td class="muted">${esc(x.reason)}</td><td class="muted">back ${esc(fmtDate(x.released_at.slice(0, 10)))}</td></tr>`).join('')}
      </tbody></table></div></div>` : ''}</div>`;
  view.onclick = async (e) => {
    const rel = e.target.closest('[data-release]');
    if (rel) {
      try { await post(`/quarantine/${rel.dataset.release}/release`, {}); toast('Back in service', 'ok'); renderQuarantine(view); }
      catch (ex) { toast(ex.message, 'error'); }
    }
  };
}

/* ---------------------------------------------------------------- contacts */

async function renderContacts(view) {
  view.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Clients</h1></div>
      <div class="actions"><button class="btn" data-import>Import CSV</button>
        <button class="btn" data-export>Export CSV</button>
        <button class="btn primary" data-add>New client</button></div></div>
    <div class="toolbar"><input class="search" type="search" placeholder="Search clients…" value="${esc(S.contactQuery)}" data-q></div>
    <div class="card" data-list><div class="empty">Loading…</div></div></div>`;
  let all = [];
  const draw = () => {
    const q = S.contactQuery.toLowerCase();
    const list = all.filter((c) => !q || `${c.name} ${c.company} ${c.email} ${c.phone}`.toLowerCase().includes(q));
    $('[data-list]', view).innerHTML = all.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Name</th><th>Company</th><th>Email</th><th>Phone</th><th class="n">Jobs</th></tr></thead>
      <tbody>${list.map((c) => `<tr class="click" data-href="#/contact/${c.id}">
        <td><strong>${esc(c.name)}</strong></td><td>${esc(c.company)}</td>
        <td>${esc(c.email)}</td><td>${esc(c.phone)}</td><td class="n">${c.job_count}</td></tr>`).join('')
        || '<tr><td colspan="5" class="empty">No matches.</td></tr>'}</tbody></table></div>`
      : `<div class="empty">No clients yet. <a href="#" data-add>Add one</a> or <a href="#" data-import>import a CSV</a>.</div>`;
  };
  const load = async () => { all = await get('/contacts'); draw(); };
  rowLinks(view);
  const base = view.onclick;
  view.onclick = async (e) => {
    if (e.target.closest('[data-add]')) { e.preventDefault(); const c = await contactModal(); if (c) { toast(`${c.name} added`, 'ok'); load(); } return; }
    if (e.target.closest('[data-import]')) { e.preventDefault(); if (await importModal('contacts')) load(); return; }
    if (e.target.closest('[data-export]')) { download('/export/contacts.csv'); return; }
    base(e);
  };
  view.oninput = (e) => { if (e.target.matches('[data-q]')) { S.contactQuery = e.target.value.trim(); draw(); } };
  await load();
}

async function renderContact(view, id) {
  const c = await get(`/contacts/${id}`);
  const spend = c.jobs.filter((j) => ['confirmed', 'out', 'returned', 'invoiced'].includes(j.status)).reduce((s, j) => s + j.totals.net, 0);
  view.innerHTML = `<div class="page">
    <div class="page-head"><div><a class="crumb" href="#/contacts">← Clients</a>
      <h1>${esc(c.name)}</h1><div class="sub">${esc(c.company)}</div></div>
      <div class="actions"><button class="btn" data-edit>Edit</button>
        <button class="btn danger" data-remove>Delete</button>
        <button class="btn primary" data-new-job>New job for ${esc(c.name.split(' ')[0])}</button></div></div>
    <div class="grid-2">
      <div class="card"><header><h2>Jobs</h2><span class="muted">${money(spend)} confirmed net</span></header>
        ${c.jobs.length ? `<table class="table"><thead><tr><th>Job</th><th>Dates</th><th>Status</th><th class="n">Net</th></tr></thead>
          <tbody>${c.jobs.map((j) => `<tr class="click" data-href="#/job/${j.id}">
            <td><span class="mono muted">${esc(j.number)}</span><br><strong>${esc(j.name)}</strong></td>
            <td>${esc(fmtRange(j.start_date, j.end_date))}</td><td>${pill(j.status)}</td>
            <td class="n">${money(j.totals.net)}</td></tr>`).join('')}</tbody></table>`
          : '<div class="empty">No jobs yet.</div>'}
      </div>
      <div class="card"><header><h2>Details</h2></header><div class="body"><dl class="kv">
        ${c.email ? `<dt>Email</dt><dd><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></dd>` : ''}
        ${c.phone ? `<dt>Phone</dt><dd>${esc(c.phone)}</dd>` : ''}
        ${c.address ? `<dt>Address</dt><dd class="notes-text">${esc(c.address)}</dd>` : ''}
        ${c.job_prefix ? `<dt>Job numbers</dt><dd><span class="mono">${esc(c.job_prefix)}${num(c.next_job_number || 1)}</span> <span class="muted small">next</span></dd>` : ''}
        ${c.notes ? `<dt>Notes</dt><dd class="notes-text">${esc(c.notes)}</dd>` : ''}
      </dl>${!c.email && !c.phone && !c.address ? '<p class="muted">No contact details yet.</p>' : ''}</div></div>
    </div></div>`;
  rowLinks(view);
  const base = view.onclick;
  view.onclick = async (e) => {
    try {
      if (e.target.closest('[data-edit]')) { if (await contactModal(c)) renderContact(view, id); return; }
      if (e.target.closest('[data-new-job]')) { newJob({ contact_id: c.id }); return; }
      if (e.target.closest('[data-remove]')) {
        if (await confirmModal(`Delete ${c.name}? If they have jobs they'll be archived instead.`)) {
          const r = await del(`/contacts/${id}`);
          toast(r.archived ? 'Archived (they have jobs on record)' : 'Deleted');
          location.hash = '#/contacts';
        }
        return;
      }
      base(e);
    } catch (ex) { toast(ex.message, 'error'); }
  };
}

/* ---------------------------------------------------------------- activity (who did what) */

const initials = (name) => (name || '').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const KIND_LABEL_ACT = { job: 'Jobs', item: 'Job lines', scan: 'Check out / in', stock: 'Stock', contact: 'Clients', vendor: 'Vendors', settings: 'Settings', user: 'Sign-ins & users' };

function activityHTML(list, { showJob = true, showProduct = false } = {}) {
  if (!list.length) return '<div class="empty">Nothing recorded yet.</div>';
  let day = null, out = '<ul class="act-list">';
  for (const a of list) {
    const d = a.at.slice(0, 10);
    if (d !== day) { out += `</ul><div class="act-day">${esc(fmtDate(d, true))}</div><ul class="act-list">`; day = d; }
    out += `<li><span class="t">${esc(a.at.slice(11, 16))}</span><span><span class="kind-dot ${esc(a.kind)}" title="${esc(KIND_LABEL_ACT[a.kind] || a.kind)}"></span><span class="who">${esc(a.user_name || 'This computer')}</span>
      <span class="what">${esc(a.summary)}</span>
      ${(showJob && a.job_id && a.job_number) || (showProduct && a.product_id) ? `<span class="meta">${showJob && a.job_id && a.job_number ? `<a href="#/job/${a.job_id}">${esc(a.job_number)} ${esc(a.job_name || '')}</a>` : ''}${showProduct && a.product_id ? ` <a href="#/product/${a.product_id}">View item</a>` : ''}</span>` : ''}</span></li>`;
  }
  return out + '</ul>';
}

function historyCard(list, link) {
  return `<div class="card"><header><h2>History</h2>${link && list.length ? `<a class="small" href="${link}">See all</a>` : ''}</header>${activityHTML(list, { showJob: false })}</div>`;
}

async function renderActivity(view, scope, scopeId) {
  const users = await get('/users').catch(() => []);
  const f = (S.actFilter ||= { user: '', kind: '', q: '' });
  // #/activity/job/12 or #/activity/product/34: only that job's (or item's) history
  const only = (scope === 'job' || scope === 'product') && Number(scopeId) ? { key: scope, id: Number(scopeId) } : null;
  let title = 'Activity', sub = 'Who created jobs, added kit, scanned items out and in, and changed stock or settings.', crumb = '';
  if (only) {
    try {
      const o = await get(`/${only.key === 'job' ? 'jobs' : 'products'}/${only.id}`);
      title = `History — ${only.key === 'job' ? `${o.number} ${o.name}` : o.name}`;
      crumb = `<a class="crumb" href="#/${only.key}/${only.id}">← ${esc(only.key === 'job' ? `${o.number} ${o.name}` : o.name)}</a>`;
    } catch { title = 'History'; }
    sub = `Only what happened on this ${only.key === 'job' ? 'job' : 'item'}. <a href="#/activity">See all activity</a>`;
  }
  view.innerHTML = `<div class="page">
    <div class="page-head"><div>${crumb}<h1>${esc(title)}</h1><div class="sub">${sub}</div></div></div>
    <div class="toolbar">
      <input class="search" type="search" placeholder="Search activity…" value="${esc(f.q)}" data-q>
      <select data-user style="width:auto"><option value="">Everyone</option>${users.map((u) => `<option value="${u.id}" ${String(u.id) === f.user ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
      <select data-kind style="width:auto"><option value="">Everything</option>${Object.entries(KIND_LABEL_ACT).map(([k, l]) => `<option value="${k}" ${k === f.kind ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
    </div>
    <div class="card" data-list><div class="empty">Loading…</div></div>
    <div class="actions" style="margin-top:12px"><button class="btn" data-more hidden>Show older</button></div></div>`;
  let list = [];
  const qs = (extra = '') => `/activity?limit=150${only ? `&${only.key}=${only.id}` : ''}${f.user ? `&user=${f.user}` : ''}${f.kind ? `&kind=${f.kind}` : ''}${f.q ? `&q=${encodeURIComponent(f.q)}` : ''}${extra}`;
  const load = async (more) => {
    const got = await get(qs(more && list.length ? `&before=${list[list.length - 1].id}` : ''));
    list = more ? list.concat(got) : got;
    $('[data-list]', view).innerHTML = activityHTML(list, { showJob: !only || only.key !== 'job', showProduct: !only || only.key !== 'product' });
    $('[data-more]', view).hidden = got.length < 150;
  };
  view.onclick = (e) => { if (e.target.closest('[data-more]')) load(true); };
  view.onchange = (e) => {
    if (e.target.matches('[data-user]')) { f.user = e.target.value; load(); }
    if (e.target.matches('[data-kind]')) { f.kind = e.target.value; load(); }
  };
  view.oninput = debounce((e) => { if (e.target.matches('[data-q]')) { f.q = e.target.value.trim(); load(); } }, 300);
  await load();
}

/* ---------------------------------------------------------------- vendors (sub-hire suppliers) */

const webLink = (w) => (w ? `<a href="${esc(/^https?:\/\//i.test(w) ? w : 'https://' + w)}" target="_blank" rel="noopener">${esc(w.replace(/^https?:\/\//i, ''))}</a>` : '');

async function renderVendors(view) {
  view.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Vendors</h1><div class="sub">Who you sub-hire from. Link sub-hire stock to a vendor and each job shows what to order from them.</div></div>
      <div class="actions"><button class="btn primary" data-add>New vendor</button></div></div>
    <div class="toolbar"><input class="search" type="search" placeholder="Search vendors…" value="${esc(S.vendorQuery || '')}" data-q>
      <label class="check"><input type="checkbox" data-arch ${S.vendorArchived ? 'checked' : ''}> Show archived</label></div>
    <div class="card" data-list><div class="empty">Loading…</div></div></div>`;
  let all = [];
  const draw = () => {
    const q = (S.vendorQuery || '').toLowerCase();
    const list = all.filter((v) => !q || `${v.name} ${v.contact_name} ${v.email} ${v.phone} ${v.notes}`.toLowerCase().includes(q));
    $('[data-list]', view).innerHTML = all.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Vendor</th><th>Contact</th><th>Email</th><th>Phone</th><th class="n">Sub-hire items</th></tr></thead>
      <tbody>${list.map((v) => `<tr class="click" data-href="#/vendor/${v.id}">
        <td><strong>${esc(v.name)}</strong>${v.archived ? ' <span class="pill">Archived</span>' : ''}</td><td>${esc(v.contact_name)}</td>
        <td>${esc(v.email)}</td><td>${esc(v.phone)}</td><td class="n">${num(v.item_count)}</td></tr>`).join('')
        || '<tr><td colspan="5" class="empty">No matches.</td></tr>'}</tbody></table></div>`
      : '<div class="empty">No vendors yet. <a href="#" data-add>Add the first company you sub-hire from</a>.</div>';
  };
  const load = async () => { all = await get('/vendors' + (S.vendorArchived ? '?archived=1' : '')); draw(); };
  rowLinks(view);
  const base = view.onclick;
  view.onclick = async (e) => {
    if (e.target.closest('[data-add]')) { e.preventDefault(); const v = await vendorModal(); if (v) { toast(`${v.name} added`, 'ok'); location.hash = `#/vendor/${v.id}`; } return; }
    base(e);
  };
  view.oninput = (e) => { if (e.target.matches('[data-q]')) { S.vendorQuery = e.target.value.trim(); draw(); } };
  view.onchange = (e) => { if (e.target.matches('[data-arch]')) { S.vendorArchived = e.target.checked; load(); } };
  await load();
}

async function renderVendor(view, id) {
  const v = await get(`/vendors/${id}`);
  view.innerHTML = `<div class="page">
    <div class="page-head"><div><a class="crumb" href="#/vendors">← Vendors</a>
      <h1>${esc(v.name)}</h1><div class="sub">${esc([v.contact_name, v.account_ref ? `Account ${v.account_ref}` : ''].filter(Boolean).join(' · '))}${v.archived ? ' · Archived' : ''}</div></div>
      <div class="actions"><button class="btn" data-edit>Edit</button>
        <button class="btn danger" data-remove>Delete</button>
        <button class="btn primary" data-add-item>Add sub-hire item</button></div></div>
    <div class="grid-2">
      <div>
        <div class="card"><header><h2>Sub-hire stock</h2><span class="muted">${plural(v.items.length, 'item')}</span></header>
          ${v.items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Item</th><th class="n">Their price / day</th><th class="n">Your day rate</th></tr></thead>
            <tbody>${v.items.map((p) => `<tr class="click" data-href="#/product/${p.id}"><td><div class="name-cell">${thumbHTML(p)}<div><strong>${esc(p.name)}</strong>${p.brand ? ` <span class="brand-tag">${esc(p.brand)}</span>` : ''}${p.archived ? ' <span class="pill">Archived</span>' : ''}<br><span class="muted small">${esc(p.category)}</span></div></div></td>
              <td class="n">${p.sub_hire_cost ? money(p.sub_hire_cost) : '—'}</td><td class="n">${money(p.day_rate)}</td></tr>`).join('')}</tbody></table></div>`
            : '<div class="empty">Nothing linked yet. <a href="#" data-add-item>Add a sub-hire item</a>, or open any stock item, tick “Sub-hired” and pick this vendor.</div>'}
        </div>
        <div class="card"><header><h2>Coming up</h2><span class="muted">jobs using their kit</span></header>
          ${v.upcoming.length ? `<table class="table"><thead><tr><th>Job</th><th>Dates</th><th>Item</th><th class="n">Qty</th></tr></thead><tbody>
            ${v.upcoming.map((j) => `<tr class="click" data-href="#/job/${j.id}"><td><span class="mono muted">${esc(j.number)}</span><br><strong>${esc(j.name)}</strong> ${pill(j.status)}</td>
              <td>${esc(fmtRange(j.start_date, j.end_date))}</td><td>${esc(j.item)}</td><td class="n"><strong>${num(j.quantity)}</strong></td></tr>`).join('')}</tbody></table>`
            : '<div class="empty">Nothing booked from them yet.</div>'}
        </div>
      </div>
      <div class="card"><header><h2>Details</h2></header><div class="body"><dl class="kv">
        ${v.contact_name ? `<dt>Contact</dt><dd>${esc(v.contact_name)}</dd>` : ''}
        ${v.email ? `<dt>Email</dt><dd><a href="mailto:${esc(v.email)}">${esc(v.email)}</a></dd>` : ''}
        ${v.phone ? `<dt>Phone</dt><dd><a href="tel:${esc(v.phone.replace(/\s+/g, ''))}">${esc(v.phone)}</a></dd>` : ''}
        ${v.website ? `<dt>Website</dt><dd>${webLink(v.website)}</dd>` : ''}
        ${v.account_ref ? `<dt>Account no.</dt><dd class="mono">${esc(v.account_ref)}</dd>` : ''}
        ${v.address ? `<dt>Address</dt><dd class="notes-text">${esc(v.address)}</dd>` : ''}
        ${v.notes ? `<dt>Notes</dt><dd class="notes-text">${esc(v.notes)}</dd>` : ''}
      </dl>${!v.email && !v.phone && !v.address && !v.contact_name ? '<p class="muted">No contact details yet. <a href="#" data-edit>Add them</a>.</p>' : ''}</div></div>
    </div></div>`;
  rowLinks(view);
  const base = view.onclick;
  view.onclick = async (e) => {
    try {
      if (e.target.closest('[data-edit]')) { e.preventDefault(); if (await vendorModal(v)) renderVendor(view, id); return; }
      if (e.target.closest('[data-add-item]')) {
        e.preventDefault();
        const p = await productModal(null, 'equipment', { sub_hire: 1, vendor_id: v.id });
        if (p) renderVendor(view, id);
        return;
      }
      if (e.target.closest('[data-remove]')) {
        if (await confirmModal(`Delete ${v.name}? If stock is linked to them they'll be archived instead.`)) {
          const r = await del(`/vendors/${id}`);
          toast(r.archived ? 'Archived (stock is linked to them)' : 'Deleted');
          location.hash = '#/vendors';
        }
        return;
      }
      base(e);
    } catch (ex) { toast(ex.message, 'error'); }
  };
}

const thumbHTML = (p, cls = 'thumb') => (p.image_id ? `<img class="${cls}" src="/img/${p.image_id}/thumb" alt="" loading="lazy">` : '');

/* ---------------------------------------------------------------- settings */

/* ---- invoices: PDF and accounting software exports */
const ACCOUNTING = {
  quickbooks: { label: 'QuickBooks Online', tax: '20.0% S', account: '',
    how: 'In QuickBooks Online: Settings ⚙ → Import data → Invoices. Tick “add new customers” if needed, map the columns, choose D/M/YYYY and VAT exclusive. Turn on custom transaction numbers so your invoice numbers are kept. Up to 100 invoices per file.' },
  xero: { label: 'Xero', tax: '20% (VAT on Income)', account: '200',
    how: 'In Xero: Business → Invoices → Import, choose the file, and pick “Tax exclusive”.' },
  zoho: { label: 'Zoho Books', tax: 'Standard Rate', account: '',
    how: 'In Zoho Books: Sales → Invoices → ⋯ → Import Invoices, then map the fields (dates are YYYY-MM-DD). Or connect Zoho Books below to send each job in one click.' },
  sage50: { label: 'Sage 50 Accounts', tax: 'T1', account: '4000',
    how: 'In Sage 50: File → Import → Audit Trail Transactions. Each client needs an account in Sage: set its Accounts reference on the client (otherwise the first 8 letters of the company name are used).' },
  sagecloud: { label: 'Sage Accounting', tax: 'Standard 20%', account: '',
    how: 'In Sage Accounting: Sales → Quick Entries → Import, then check the column mapping. Client names must match your Sage customers.' },
  generic: { label: 'Other software (generic CSV)', tax: '', account: '',
    how: 'A plain CSV, one row per invoice line: invoice number, dates (DD/MM/YYYY), customer, description, quantity, unit price, net, VAT and gross. Use it with FreeAgent, KashFlow, Clear Books, QuickFile or any other software whose importer lets you match columns. Fill in the VAT code and nominal code above if your software needs them.' },
};
const accDefault = (k, f) => (ACCOUNTING[k] ? ACCOUNTING[k][f] : '');
const accHow = (k) => (ACCOUNTING[k] ? esc(ACCOUNTING[k].how) : 'Choose the software you use, and invoices can be exported as a file it imports.');

/** The light logo as a JPEG on white, for PDFs (works for SVG, PNG and WebP logos). */
async function logoJpeg() {
  if (!S.settings || !S.settings.has_logo) return null;
  try {
    const img = new Image();
    img.src = `/logo?variant=light&v=${S.logoVersion || 0}`;
    await img.decode();
    const w0 = img.naturalWidth || 600, h0 = img.naturalHeight || 200;
    const scale = Math.min(1, 900 / w0);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * scale)); c.height = Math.max(1, Math.round(h0 * scale));
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.92);
  } catch { return null; }
}

/** POST, then save the file the server sends back (a PDF or CSV). */
async function postDownload(path, body, fallbackName) {
  const res = await fetch('/api' + path, { method: 'POST', headers: { 'X-Requested-With': 'horan-rms', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  const cd = res.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename="([^"]+)"/);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = (m && m[1]) || fallbackName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function downloadPdf(ids, doc = 'invoice', opts = {}) {
  if (docLayout(doc).method === 'html') { await printTemplateDocs(ids, doc, opts); return; }
  await postDownload('/invoices/pdf', { ids, doc, logo: await logoJpeg(), mark_invoiced: !!opts.markInvoiced }, `${doc}.pdf`);
}

async function exportAccounts(ids, format, opts = {}) {
  await postDownload('/invoices/export', { ids, format, mark_invoiced: !!opts.markInvoiced }, 'invoices.csv');
}

/** Choose jobs, then download their invoices as one PDF or export them for accounting software. */
async function invoicesModal(preselect = null) {
  const all = await get('/jobs?status=confirmed,out,returned,invoiced');
  const sw = (S.settings && S.settings.accounting_software) || '';
  const def = (j) => (preselect ? preselect.includes(j.id) : ['returned', 'out'].includes(j.status) && !j.exported_at);
  all.sort((a, b) => b.end_date.localeCompare(a.end_date));
  return new Promise((resolve) => {
    const m = openModal(`<header><h2>Invoices</h2><button class="icon-btn" data-x aria-label="Close">×</button></header>
      <div class="modal-body">
        <p class="muted" style="margin-top:0">Choose jobs, then download their invoices as one PDF, or export them as a file your accounting software imports.
          Each invoice’s number and date are fixed the first time it leaves the app.</p>
        <div class="inv-tools"><label class="check"><input type="checkbox" data-all> All</label>
          <span class="muted small">Ticked to start: on hire or returned, and not exported yet.</span></div>
        <div class="inv-list">${all.length ? all.map((j) => `<label class="inv-row"><input type="checkbox" value="${j.id}" ${def(j) ? 'checked' : ''}>
          <span><span class="mono muted">${esc(j.number)}</span> <strong>${esc(j.name)}</strong><br><span class="muted small">${esc(j.contact_company || j.contact_name || 'No client')} · ${esc(fmtRange(j.start_date, j.end_date))}</span></span>
          <span class="n">${pill(j.status)}${j.exported_at ? `<br><span class="muted small" title="${esc(fmtDate(j.exported_at.slice(0, 10)))}">exported to ${esc((ACCOUNTING[j.exported_to] || {}).label || j.exported_to)}</span>` : ''}<br><strong>${money(j.totals.total)}</strong></span></label>`).join('')
          : '<div class="empty">No confirmed, on-hire, returned or invoiced jobs.</div>'}</div>
        <div class="form-grid" style="padding:12px 0 0">
          <label class="field half"><span>Accounting software</span><select data-fmt>
            <option value="">Choose…</option>${Object.entries(ACCOUNTING).map(([k, a]) => `<option value="${k}" ${k === sw ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}</select></label>
          <label class="check half" style="align-self:end"><input type="checkbox" data-mark> Mark them as Invoiced</label>
        </div>
        <p class="muted small" data-how style="margin:6px 0 0">${accHow(sw)}</p>
      </div>
      <footer><span class="muted small" data-count style="margin-right:auto"></span><button class="btn" data-pdf>Download PDF</button><button class="btn primary" data-csv>Export file</button></footer>`, { wide: true });
    const done = (v) => { m.close(); resolve(v); };
    m.wrap.addEventListener('cancel', () => done(null));
    $$('[data-x]', m.el).forEach((b) => (b.onclick = () => done(null)));
    const picked = () => $$('.inv-row input:checked', m.el).map((x) => Number(x.value));
    const update = () => {
      const n = picked().length;
      $('[data-count]', m.el).textContent = `${n} chosen`;
      $('[data-pdf]', m.el).disabled = !n;
      const f = $('[data-fmt]', m.el).value;
      $('[data-csv]', m.el).disabled = !n || !f;
      $('[data-csv]', m.el).textContent = f ? `Export for ${ACCOUNTING[f].label}` : 'Export file';
      $('[data-how]', m.el).textContent = ACCOUNTING[f] ? ACCOUNTING[f].how : 'Choose your accounting software to export a file it can import.';
    };
    m.el.addEventListener('change', (e) => {
      if (e.target.matches('[data-all]')) $$('.inv-row input', m.el).forEach((x) => (x.checked = e.target.checked));
      update();
    });
    update();
    const run = async (btn, fn) => {
      btn.disabled = true;
      const old = btn.textContent; btn.textContent = 'Working…';
      try { await fn(); toast('Downloaded', 'ok'); done(true); } catch (ex) { toast(ex.message, 'error'); btn.disabled = false; btn.textContent = old; }
    };
    $('[data-pdf]', m.el).onclick = (e) => run(e.target, () => downloadPdf(picked(), 'invoice', { markInvoiced: $('[data-mark]', m.el).checked }));
    $('[data-csv]', m.el).onclick = (e) => run(e.target, () => exportAccounts(picked(), $('[data-fmt]', m.el).value, { markInvoiced: $('[data-mark]', m.el).checked }));
  });
}

/* ---- your details (optional), change log, requests */

const C128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 '
  + '123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 '
  + '111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 '
  + '231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 '
  + '141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 '
  + '124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 '
  + '311141 411131 211412 211214 211232').split(' ');
/** A Code 128 barcode as SVG (printable characters only), with the text underneath. */
function barcodeSVG(text) {
  const chars = [...String(text)].filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) <= 126);
  const vals = [104, ...chars.map((ch) => ch.charCodeAt(0) - 32)];
  vals.push(vals.reduce((sum, v, i) => sum + v * (i || 1), 0) % 103);
  const widths = vals.map((v) => C128[v]).join('') + '2331112';
  let x = 10, bars = '';
  [...widths].forEach((w, i) => { if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${w}" height="50"/>`; x += Number(w); });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x + 10} 66" role="img" aria-label="Barcode ${esc(chars.join(''))}">
    <rect width="100%" height="100%" fill="#fff"/><g fill="#000">${bars}</g>
    <text x="${(x + 10) / 2}" y="63" font-family="monospace" font-size="11" text-anchor="middle" fill="#000">${esc(chars.join(''))}</text></svg>`;
}
function printCloseCode(code) {
  const w = window.open('', '_blank', 'width=420,height=320');
  if (!w) { toast('Allow pop-ups to print the label', 'error'); return; }
  w.document.write(`<!doctype html><meta charset="utf-8"><title>Close flight case</title>
    <style>body{font-family:system-ui,sans-serif;text-align:center;margin:24px}svg{width:320px;height:auto}h1{font-size:18px;margin:0 0 10px}</style>
    <h1>CLOSE FLIGHT CASE</h1>${barcodeSVG(code)}<p style="font-size:12px">Scan at check-out to close the case being packed</p>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 200);
}

/** Automatic updates (Software update card). */
async function drawAutoUpdate(view) {
  const box = $('[data-auto-update]', view);
  if (!box) return;
  let a;
  try { a = await get('/update/auto'); } catch (ex) { box.innerHTML = `<p class="muted small">${esc(ex.message)}</p>`; return; }
  box.innerHTML = `<div class="form-grid" style="padding:0">
      <label class="field half"><span>Automatic updates</span><select data-au-mode ${a.can_change ? '' : 'disabled'}>
        <option value="none" ${a.mode === 'none' ? 'selected' : ''}>None — I’ll check myself</option>
        <option value="check" ${a.mode === 'check' ? 'selected' : ''}>Check at a set time, and ask me</option>
        <option value="install" ${a.mode === 'install' ? 'selected' : ''}>Install automatically at a set time</option></select>
        <small>${a.mode === 'check' ? 'If there’s a new version, admins are asked to install it the next time they open a page.' : a.mode === 'install' ? 'Your data and the current version are backed up first, then the app restarts on the new version.' : 'Use Check for updates below whenever you like.'}</small></label>
      <label class="field half" ${a.mode === 'none' ? 'hidden' : ''} data-au-time-wrap><span>Time (on this computer)</span><input type="time" data-au-time value="${esc(a.time)}" ${a.can_change ? '' : 'disabled'}>
        <small>Once a day. If the app is off then, it runs as soon as it’s next started that day.</small></label>
    </div>
    <div class="actions"><button type="button" class="btn small" data-au-save ${a.can_change ? '' : 'disabled'}>Save automatic updates</button></div>
    ${a.last_result ? `<p class="muted small" style="margin:6px 0 0">${esc(a.last_result)}</p>` : ''}`;
}

/** "Check at a set time" found a new version: ask an admin on the next page load. */
async function offerScheduledUpdate() {
  let a;
  try { a = await get('/update/auto'); } catch { return; }
  if (!a.available || !a.can_install || a.mode !== 'check') return;
  try { if (sessionStorage.getItem('het-update-later') === a.available) return; } catch { /* ignore */ }
  const ok = await confirmModal(`Version ${a.available} is available (you’re on ${a.current}). Install it now? Your data and the current version are backed up first, then the app restarts.`,
    { title: 'Update available', okLabel: `Install ${a.available}`, danger: false });
  if (!ok) { try { sessionStorage.setItem('het-update-later', a.available); } catch { /* ignore */ } return; }
  try { const info = await post('/update/github', {}); waitForRestart(info.new); } catch (ex) { toast(ex.message, 'error'); }
}

/** "From GitHub" in Software update: is there a newer release, and install it. */
async function drawGithub(view, fresh = false) {
  const box = $('[data-gh]', view);
  if (!box) return;
  box.innerHTML = '<p class="muted small" style="margin:0">Checking GitHub…</p>';
  let r;
  try { r = await get(`/update/github${fresh ? '?fresh=1' : ''}`); } catch (ex) {
    box.innerHTML = `<p class="muted small" style="margin:0 0 8px">${esc(ex.message)}</p><button type="button" class="btn small" data-gh-check>Check again</button>`;
    return;
  }
  const when = r.published_at ? fmtDate(r.published_at.slice(0, 10)) : '';
  box.innerHTML = r.newer ? `<div class="banner info" style="margin:0 0 8px"><span><strong>Version ${esc(r.version)} is available</strong>${when ? ` · released ${esc(when)}` : ''}. You’re on ${esc(r.current)}.</span></div>
      ${r.notes ? `<details class="gh-notes"><summary>What’s new</summary><div class="notes-text">${esc(r.notes)}</div></details>` : ''}
      <div class="actions" style="margin-top:8px"><button type="button" class="btn primary" data-gh-install="${esc(r.version)}">Install ${esc(r.version)} from GitHub</button>
        <a class="btn small" href="${esc(r.url)}" target="_blank" rel="noopener">View on GitHub</a></div>
      <p class="muted small" style="margin:6px 0 0">Downloads ${esc(r.asset)} from github.com/${esc(r.repo)}. Your data and the current version are backed up first.</p>`
    : `<p class="small" style="margin:0 0 8px"><span class="badge ok">Up to date</span> The latest release on github.com/${esc(r.repo)} is ${esc(r.version || r.tag)}${when ? ` (${esc(when)})` : ''}.</p>
      <button type="button" class="btn small" data-gh-check>Check again</button>`;
}

async function drawMeCard(view) {
  const card = $('[data-me-card]', view);
  if (!card) return;
  const me = await get('/me/identity');
  $('.body', card).innerHTML = `<p class="muted" style="margin-top:0">Both optional. They’re added to <a href="#/requests">requests</a> you make,
      so you can be credited in the change log when your idea is built. ${S.meta && S.meta.users_enabled ? `These are <strong>${esc(me.who)}</strong>’s details.` : ''}</p>
    <div class="form-grid" style="padding:0">
      <label class="field half"><span>Name / alias</span><input data-me-alias value="${esc(me.alias)}" maxlength="80" placeholder="e.g. Jess, or SoundGuy"></label>
      <label class="field half"><span>Company</span><input data-me-company value="${esc(me.company)}" maxlength="120" placeholder="e.g. Smith Events Ltd"></label>
    </div>
    <div class="actions" style="margin-top:10px"><button type="button" class="btn small" data-me-save>Save my details</button></div>`;
  $('[data-me-save]', card).onclick = async () => {
    try {
      await put('/me/identity', { alias: $('[data-me-alias]', card).value.trim(), company: $('[data-me-company]', card).value.trim() });
      toast('Your details are saved', 'ok');
    } catch (ex) { toast(ex.message, 'error'); }
  };
}

function changeHTML(c) {
  const text = typeof c === 'string' ? c : c.text;
  const credit = typeof c === 'object' && c.credit ? ` <span class="credit">💡 Idea from ${esc(c.credit)}</span>` : '';
  return `<li>${esc(text)}${credit}</li>`;
}

function versionHTML(v, current) {
  return `<div class="cl-version ${v.version === current ? 'current' : ''}">
    <div class="cl-head"><strong>${esc(v.version)}</strong>${v.version === current ? ' <span class="badge ok">Installed</span>' : ''}
      <span class="muted small">${v.date ? esc(fmtDate(v.date)) : ''}</span>${v.title ? ` <span class="cl-title">${esc(v.title)}</span>` : ''}</div>
    <ul>${(v.changes || []).map(changeHTML).join('')}</ul>
    ${v.ai ? `<div class="cl-ai muted small" title="How this version was made">🤖 ${esc(v.ai)}</div>` : ''}</div>`;
}

async function drawChangelogCard(view) {
  const card = $('[data-changelog-card]', view);
  if (!card) return;
  const cl = await get('/changelog');
  const cur = cl.versions.find((v) => v.version === cl.current) || cl.versions[0];
  $('.body', card).innerHTML = `${cur ? versionHTML(cur, cl.current) : '<p class="muted">No change log.</p>'}
    <div class="actions" style="margin-top:10px"><a class="btn small" href="#/changelog">Every version (${num(cl.versions.length)})</a>
      <a class="btn small" href="#/requests">Requests</a></div>`;
}

async function renderChangelog(view) {
  const cl = await get('/changelog');
  view.innerHTML = `<div class="page">
    <div class="page-head"><div><a class="crumb" href="#/settings">← Settings</a><h1>Change log</h1>
      <div class="sub">Everything that’s changed in each version of ${esc(appName())}. You’re on ${esc(cl.current)}.</div></div>
      <div class="actions"><a class="btn" href="#/requests">Make a request</a></div></div>
    <div class="card"><div class="body changelog">${cl.versions.map((v) => versionHTML(v, cl.current)).join('')}</div></div></div>`;
}

async function renderRequests(view) {
  const d = await get('/requests');
  const kinds = d.kinds;
  const me = d.me;
  const mine = (r) => !S.meta.users_enabled || S.meta.is_admin || (S.meta.user && S.meta.user.id === r.user_id);
  const who = (r) => [r.submitted_by, r.alias && r.alias !== r.submitted_by ? r.alias : '', r.company].filter(Boolean).join(' · ');
  view.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Requests</h1>
      <div class="sub">Ideas for new features, changes, and problems to fix. Export them and send the file in; when an update delivers one, it’s marked done here.</div></div>
      <div class="actions"><button class="btn" data-export ${d.open.length ? '' : 'disabled'}>Export requests (CSV)</button></div></div>
    <div class="grid-2">
      <div class="stack">
        <div class="card"><header><h2>New request</h2></header>
          <form class="form-grid" data-new novalidate>
            <label class="field half"><span>Type</span><select name="kind">${Object.entries(kinds).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>
            <label class="field"><span>Title</span><input name="title" maxlength="200" required placeholder="e.g. Subcategories for lighting"></label>
            <label class="field"><span>Details</span><textarea name="details" rows="5" maxlength="5000" placeholder="What would you like, and why? An example helps."></textarea></label>
            <p class="muted small" style="margin:0;flex-basis:100%">From <strong>${esc(me.who)}</strong>${me.alias || me.company ? ` (${esc([me.alias, me.company].filter(Boolean).join(', '))})` : ''}.
              ${me.alias || me.company ? '' : 'Add your name / alias and company in <a href="#/settings/me">Settings → Updates → Your details</a> to be credited.'}</p>
            <div class="actions" style="flex-basis:100%"><button class="btn primary" type="submit">Add request</button></div>
          </form></div>
        <div class="card"><header><h2>About exporting</h2></header><div class="body">
          <p class="muted" style="margin-top:0">Each request gets an ID made from this install’s ID <span class="mono">${esc(d.instance_id)}</span> and a number, e.g.
            <span class="mono">${esc(d.instance_id)}-0001</span>. <strong>Export requests</strong> downloads the open ones as a CSV file to send in.</p>
          <p class="muted" style="margin-bottom:0">When an update includes a request, installing it moves that request to <strong>Done</strong> with the version it arrived in,
            and credits the person in the <a href="#/changelog">change log</a> if they gave their details.</p></div></div>
      </div>
      <div class="stack">
        <div class="card"><header><h2>Open</h2><span class="muted">${num(d.open.length)}</span></header>
          ${d.open.length ? `<div class="req-list">${d.open.map((r) => `<div class="req" data-req="${r.id}">
            <div class="req-head"><span class="mono muted">${esc(r.ref)}</span> <span class="pill">${esc(kinds[r.kind] || r.kind)}</span>
              <span class="spacer"></span>${mine(r) ? `<button class="btn small" data-req-edit="${r.id}">Edit</button>
              <button class="icon-btn" data-req-del="${r.id}" title="Withdraw this request" aria-label="Withdraw">×</button>` : ''}</div>
            <strong>${esc(r.title)}</strong>${r.details ? `<p class="notes-text" style="margin:4px 0 0">${esc(r.details)}</p>` : ''}
            <div class="muted small">${esc(who(r))} · ${esc(fmtDate(r.created_at.slice(0, 10)))}</div></div>`).join('')}</div>`
            : '<div class="empty">No open requests.</div>'}</div>
        ${d.done.length ? `<details class="card"><summary class="card-sum"><h2>Done</h2><span class="muted">${num(d.done.length)}</span></summary>
          <div class="req-list">${d.done.map((r) => `<div class="req done"><div class="req-head"><span class="mono muted">${esc(r.ref)}</span>
            <span class="badge ok">In ${esc(r.done_version)}</span></div><strong>${esc(r.title)}</strong>
            <div class="muted small">${esc(who(r))}</div></div>`).join('')}</div></details>` : ''}
      </div>
    </div></div>`;
  const again = () => renderRequests(view);
  $('[data-new]', view).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!f.title.value.trim()) { toast('Give it a short title', 'error'); f.title.focus(); return; }
    try {
      const r = await post('/requests', { kind: f.kind.value, title: f.title.value.trim(), details: f.details.value.trim() });
      toast(`Request ${r.added} added`, 'ok'); again();
    } catch (ex) { toast(ex.message, 'error'); }
  };
  view.onclick = async (e) => {
    try {
      if (e.target.closest('[data-export]')) { download('/export/requests.csv'); return; }
      const ed = e.target.closest('[data-req-edit]');
      if (ed) {
        const r = d.open.find((x) => String(x.id) === ed.dataset.reqEdit);
        const v = await formModal({ title: `Edit ${r.ref}`, fields: [
          { name: 'kind', label: 'Type', type: 'select', options: Object.entries(kinds), half: true },
          { name: 'title', label: 'Title', required: true },
          { name: 'details', label: 'Details', type: 'textarea', rows: 5 }],
        values: r, onSubmit: (vals) => put(`/requests/${r.id}`, vals) });
        if (v) again();
        return;
      }
      const dl = e.target.closest('[data-req-del]');
      if (dl) {
        const r = d.open.find((x) => String(x.id) === dl.dataset.reqDel);
        if (await confirmModal(`Withdraw request ${r.ref} “${r.title}”?`, { okLabel: 'Withdraw', title: 'Withdraw request?' })) { await del(`/requests/${r.id}`); again(); }
      }
    } catch (ex) { toast(ex.message, 'error'); }
  };
}

const SETTINGS_TABS = [
  { key: 'users', label: 'Users', cards: ['users', 'network'], admin: true, save: false,
    sub: 'Who can sign in, and using the app from other devices.' },
  { key: 'customise', label: 'Customisation', cards: ['logo', 'appearance', 'icons', 'sounds', 'doc-layout'], admin: true,
    sub: 'Logos, app icon, colours, light and dark mode, fonts, icons, scan sounds and the layout of quotes and invoices.' },
  { key: 'company', label: 'Company information', cards: ['company', 'invoicing', 'money', 'jobs-settings', 'documents'], admin: true,
    sub: 'Your details, invoices, VAT and numbering, jobs and documents.' },
  { key: 'electrical', label: 'Electrical', cards: ['power'], admin: true, sub: 'Venue supplies, voltage, safe load and cable runs.' },
  { key: 'external', label: 'External software', cards: ['zoho', 'accounting'], admin: true,
    sub: 'Zoho Books, and invoice exports for QuickBooks, Xero, Sage and other accounting / MTD software.' },
  { key: 'updates', label: 'Updates', cards: ['me', 'update', 'changelog', 'data'], adminCards: ['update', 'data'],
    sub: 'Your details, software updates, the change log and your data.' },
];
// Old links to a card (e.g. #/settings/zoho) open the tab it's on.
const SETTINGS_CARD_TAB = Object.fromEntries(SETTINGS_TABS.flatMap((t) => t.cards.map((c) => [c, t.key])));

/** Put the settings cards into tabs. Tabs (and cards) that only hold admin settings are hidden from everyone else. */
function arrangeSettingsTabs(view, meta, want) {
  const admin = !!meta.is_admin;
  const tabs = SETTINGS_TABS.filter((t) => admin || !t.admin);
  const form = $('[data-form]', view);
  const grid = $('.grid-2', form);
  for (const t of tabs) {
    const panel = document.createElement('div');
    panel.className = 'settings-panel';
    panel.dataset.panel = t.key;
    panel.setAttribute('role', 'tabpanel');
    for (const id of t.cards) {
      const card = $(`#${CSS.escape(id)}`, form);
      if (!card) continue;
      if (!admin && (t.adminCards || []).includes(id)) { card.remove(); continue; }
      panel.appendChild(card);
    }
    form.appendChild(panel);
  }
  // Whatever's left over belongs to a hidden (admin-only) tab: take it off the page so nothing of it is sent on save.
  grid.remove();
  let key = SETTINGS_CARD_TAB[want] || want;
  if (!tabs.some((t) => t.key === key)) key = tabs[0].key;
  const bar = $('[data-settings-tabs]', view);
  bar.innerHTML = tabs.map((t) => `<button type="button" role="tab" data-settings-tab="${t.key}">${esc(t.label)}</button>`).join('');
  const show = (k) => {
    const t = tabs.find((x) => x.key === k);
    for (const b of $$('[data-settings-tab]', bar)) { const on = b.dataset.settingsTab === k; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); }
    for (const p of $$('.settings-panel', form)) p.hidden = p.dataset.panel !== k;
    $('[data-settings-sub]', view).textContent = t.sub;
    const sv = $('[data-save]', view);
    if (sv) sv.hidden = !admin || t.save === false;
    // Keep the tab in the address without reloading the page (unsaved changes on other tabs are kept).
    history.replaceState(null, '', `#/settings/${k}`);
  };
  bar.addEventListener('click', (e) => { const b = e.target.closest('[data-settings-tab]'); if (b) show(b.dataset.settingsTab); });
  show(key);
  if (want && SETTINGS_CARD_TAB[want] && want !== key) setTimeout(() => $(`#${CSS.escape(want)}`, form)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 100);
}

async function renderSettings(view, tab = location.hash.split('/')[2] || '') {
  try { S.fonts = await get('/fonts'); } catch { S.fonts = []; }
  const [st, meta] = await Promise.all([get('/settings'), get('/meta')]);
  const s = S.settings = st;
  S.meta = meta;
  const F = (name, label, opts = {}) => fieldHTML({ name, label, ...opts }, s[name]);
  const backups = meta.app_backups || [];
  view.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Settings</h1><div class="sub" data-settings-sub></div></div>
      <div class="actions"><button class="btn primary" data-save>Save settings</button></div></div>
    <div class="tabs settings-tabs" role="tablist" aria-label="Settings sections" data-settings-tabs></div>
    <form data-form novalidate>
    <div class="grid-2">
      <div>
        <div class="card settings-section" id="logo"><header><h2>Logo &amp; app icon</h2></header><div class="body">
          <p class="muted" style="margin-top:0">PNG, JPG, WebP or SVG. It’s scaled to fit — never cropped — and empty see-through edges are trimmed so it fills the space.
            The sidebar shows the version for the current mode; printed quotes and prep lists always use the light one.</p>
          <p class="small" style="margin:0 0 12px"><strong>Best size:</strong> a wide logo about 3 : 1, e.g. <strong>1200 × 400 px</strong> (at least 600 px wide), or an SVG.
            It’s shown up to <strong>200 × 96 px</strong> in the sidebar, <strong>220 × 64 px</strong> on documents and <strong>160 × 40 px</strong> on phones. Square logos work but show smaller.</p>
          <div class="logo-pair">
            ${['light', 'dark'].map((vr) => { const has = vr === 'light' ? s.has_logo : s.has_logo_dark; return `<div class="logo-slot">
              <h3>${vr === 'light' ? 'Light mode logo' : 'Dark mode logo'}</h3>
              <div class="logo-preview ${vr}">${has ? `<img src="/logo?variant=${vr}&v=${S.logoVersion || 0}" alt="${vr} mode logo">` : (vr === 'dark' && s.has_logo ? `<img src="/logo?variant=light&v=${S.logoVersion || 0}" alt="" style="opacity:.45">` : 'No logo yet')}</div>
              ${vr === 'dark' && !has ? `<p class="muted small" style="margin:6px 0 0">${s.has_logo ? 'Using the light logo. Add a version that reads well on dark backgrounds.' : 'Optional.'}</p>` : ''}
              ${has ? `<p class="muted small" style="margin:6px 0 0" data-logo-size="${vr}">&nbsp;</p>` : ''}
              <div class="actions"><label class="btn ${vr === 'light' ? 'primary' : ''} small">${has ? 'Replace' : 'Add'}<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" data-logo="${vr}" hidden></label>
                ${has ? `<button type="button" class="btn small" data-logo-refit="${vr}" title="Re-fit the saved logo so nothing is cut off">Fit to box</button>
                <button type="button" class="btn danger small" data-logo-remove="${vr}">Remove</button>` : ''}</div></div>`; }).join('')}
          </div>
          <h3 class="net-h">App icon</h3>
          <div class="logo-row" style="padding:0;align-items:center">
            <div class="icon-preview"><img src="/app-icon-192.png?v=${S.logoVersion || 0}" alt="App icon"></div>
              <div><p class="muted small" style="margin:0 0 8px">Used for the browser tab, a phone’s home screen (“Add to Home Screen”), and the app menu on Bazzite / Dock on a Mac.
              <strong>Best size: square, 512 × 512 px or larger.</strong> Other shapes are fitted into a square with see-through edges.</p>
              <div class="actions"><label class="btn small">${s.has_icon ? 'Replace icon' : 'Choose icon'}<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" data-icon hidden></label>
                ${s.has_icon ? '<button type="button" class="btn danger small" data-icon-remove>Use the standard icon</button>' : ''}</div></div>
          </div>
          <h3 class="net-h">Brand colours</h3>
          <div class="swatches">
            <label><input type="color" name="brand_primary" value="${esc(s.brand_primary)}"> Primary (green)</label>
            <label><input type="color" name="brand_accent" value="${esc(s.brand_accent)}"> Accent (gold)</label>
            <label><input type="color" name="brand_grey" value="${esc(s.brand_grey)}"> Grey</label>
          </div>
        </div></div>
        <div class="card settings-section" id="appearance"><header><h2>Appearance</h2></header><div class="body">
          <label class="field"><span>Light or dark</span><select name="theme_default">
            <option value="system" ${s.theme_default === 'system' ? 'selected' : ''}>Follow each device’s setting</option>
            <option value="light" ${s.theme_default === 'light' ? 'selected' : ''}>Always light</option>
            <option value="dark" ${s.theme_default === 'dark' ? 'selected' : ''}>Always dark</option></select>
            <small>The default for every device. Anyone can still switch their own device with the moon button at the bottom of the sidebar.</small></label>
          <div class="theme-cols">
            ${['light', 'dark'].map((mode) => `<div class="theme-col ${mode}-col"><h3>${mode === 'light' ? 'Light mode' : 'Dark mode'}</h3>
              ${THEME_KEYS.map((k) => `<label class="colour-row"><span>${THEME_LABEL[k]}</span><input type="color" name="${mode}_${k}" value="${esc(themeColours(s)[mode][k])}" data-theme-col></label>`).join('')}
              <button type="button" class="btn small" data-theme-reset="${mode}" style="margin-top:6px">Reset ${mode}</button></div>`).join('')}
          </div>
          <h3 class="net-h">Fonts</h3>
          <div class="font-pick">
            ${['body', 'heading'].map((k) => fontPickHTML(k, s[`font_${k}`], S.fonts || [])).join('')}
          </div>
          <div class="font-sample" data-font-sample><div class="h">Annual Awards Dinner — Prep list</div><div class="b">4 × QSC K12.2 Speaker · 2 × 16A Extension Cable 10m · Stage 6m × 4m</div></div>
          <p class="muted small" style="margin:10px 0 4px">Add your own font files (.woff2, .woff, .ttf or .otf). They’re saved with your data, so every device and printed document uses them.</p>
          <label class="btn small">Add font file…<input type="file" accept=".woff2,.woff,.ttf,.otf,font/*" data-font-upload hidden></label>
          ${(S.fonts || []).length ? `<ul class="font-list">${S.fonts.map((f) => `<li><span style="font-family:'HET Font ${f.id}'">${esc(f.name)}</span>
            <button type="button" class="btn small danger" data-font-del="${f.id}">Remove</button></li>`).join('')}</ul>` : ''}
          <style>${fontFaces((S.fonts || []).map((f) => `upload:${f.id}`))}</style>
        </div></div>
        <div class="card settings-section" id="sounds" data-sounds-card><header><h2>Scan sounds</h2></header><div class="body"><p class="muted">Loading…</p></div></div>
        <div class="card settings-section" id="icons" data-icons-card><header><h2>Icons</h2></header><div class="body"><p class="muted">Loading…</p></div></div>
        <div class="card settings-section wide-card" id="doc-layout" data-layout-card><header><h2>Quote &amp; invoice layout</h2><span class="muted small">for printing and PDFs</span></header><div class="body"><p class="muted">Loading…</p></div></div>
        <div class="card settings-section" id="company"><header><h2>Company</h2></header><div class="form-grid">
          ${F('app_name', 'App name', { help: 'What this app is called in the sidebar, the browser tab, the sign-in page and on phones’ home screens. Your documents use the company name below.' })}
          ${F('company_name', 'Company name (printed on documents)')}
          ${F('company_address', 'Address', { type: 'textarea', rows: 3 })}
          ${F('company_email', 'Email', { half: true })}${F('company_phone', 'Phone', { half: true })}
          ${F('company_website', 'Website', { half: true })}${F('company_number', 'Company number', { half: true })}
          ${F('vat_number', 'VAT number', { half: true })}
        </div></div>
        <div class="card settings-section" id="documents"><header><h2>Documents</h2></header><div class="form-grid">
          ${F('quote_terms', 'Quotation terms', { type: 'textarea', rows: 4 })}
          <label class="check"><input type="checkbox" name="show_included_accessories" ${s.show_included_accessories === '1' ? 'checked' : ''}>
            List free (included) linked accessories on quotations. They always appear on the prep list.</label>
        </div></div>
        <div class="card settings-section" id="invoicing"><header><h2>Invoices</h2></header><div class="form-grid">
          ${F('invoice_prefix', 'Invoice number prefix', { half: true, placeholder: 'e.g. INV-', help: 'Invoice numbers are this plus the job number, e.g. INV-HAV-1001.' })}
          ${F('payment_terms_days', 'Payment terms (days)', { type: 'number', min: 0, max: 365, step: 1, half: true, help: 'Sets each invoice’s due date.' })}
          ${F('payment_details', 'Payment details (printed on invoices)', { type: 'textarea', rows: 3, placeholder: 'Bank, sort code, account number…' })}
          ${F('invoice_terms', 'Invoice terms', { type: 'textarea', rows: 2 })}
        </div></div>
        <div class="card settings-section" id="accounting"><header><h2>Accounting software</h2><span class="muted small">invoice exports</span></header><div class="form-grid">
          <p class="muted small" style="flex-basis:100%;margin:0">Export invoices as a file your accounting or Making Tax Digital software imports — from <strong>Jobs → Invoices…</strong> or an invoice’s print page. Zoho Books can also be connected directly (above).</p>
          <label class="field half"><span>Accounting software</span><select name="accounting_software" data-acc-sw>
            <option value="">Not set</option>${Object.entries(ACCOUNTING).map(([k, a]) => `<option value="${k}" ${s.accounting_software === k ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}</select>
            <small>The format used by default. You can still choose another when exporting.</small></label>
          <label class="field half"><span>Item names in the export</span><select name="acc_item_names">
            <option value="kind" ${s.acc_item_names !== 'item' ? 'selected' : ''}>By type: Equipment hire, Sales, Services</option>
            <option value="item" ${s.acc_item_names === 'item' ? 'selected' : ''}>Each item’s own name</option></select>
            <small>“By type” matches three products/services you set up once in your accounts.</small></label>
          ${F('acc_tax_code', 'VAT code', { half: true, placeholder: accDefault(s.accounting_software, 'tax'), help: 'Leave blank for the usual code for your software (shown greyed out).' })}
          ${F('acc_sales_account', 'Sales account / nominal code', { half: true, placeholder: accDefault(s.accounting_software, 'account') || 'not used', help: 'Xero account code (e.g. 200), or Sage nominal code (e.g. 4000).' })}
          <p class="muted small" data-acc-how style="flex-basis:100%;margin:0">${accHow(s.accounting_software)}</p>
        </div></div>
        <div class="card settings-section" id="jobs-settings"><header><h2>Jobs</h2></header><div class="form-grid">
          ${F('overdue_grace_days', 'Days’ grace before a hire is overdue', { type: 'number', min: 0, max: 60, step: 1, half: true,
            help: 'A job with kit still out after its return date goes Overdue after this many days. 0 = the day after it’s due back.' })}
          ${F('case_close_code', 'Flight case close code', { half: true,
            help: 'Scanning this at check-out closes whichever flight case is being packed. One code works for every case.' })}
          <div class="field" style="flex-basis:100%"><div class="close-code-label" data-close-preview>${barcodeSVG(s.case_close_code || 'CLOSE-CASE')}</div>
            <div class="actions" style="margin-top:6px"><button type="button" class="btn small" data-print-close>Print close-code label</button></div></div>
        </div></div>
        <div class="card settings-section" id="power"><header><h2>Power &amp; cable runs</h2></header><div class="form-grid">
          <label class="field half"><span>Default venue supply</span><select name="default_supply">${(meta.power_supplies || []).map((x) =>
            `<option value="${x.key}" ${x.key === s.default_supply ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>
            <small>Each job can choose its own supply on its Power card.</small></label>
          ${F('mains_voltage', 'Mains voltage', { type: 'number', min: 100, step: 1, half: true })}
          <label class="field half"><span>Cable runs — default preference</span><select name="cable_run_preference">
            <option value="excess" ${s.cable_run_preference !== 'joins' ? 'selected' : ''}>Less excess cable</option>
            <option value="joins" ${s.cable_run_preference === 'joins' ? 'selected' : ''}>Fewer joins</option></select>
            <small>You can still switch for each run when adding it.</small></label>
          ${F('safe_load_pct', 'Safe load (% of rating)', { type: 'number', min: 10, max: 100, step: 1, half: true, help: 'Plan to use at most this much of any supply or lead. 80% is a common rule of thumb.' })}
        </div></div>
      </div>
      <div>
        <div class="card settings-section" id="me" data-me-card><header><h2>Your details</h2><span class="muted small">optional</span></header><div class="body"><p class="muted">Loading…</p></div></div>
        <div class="card settings-section" id="changelog" data-changelog-card><header><h2>Change log</h2><span class="pill">Version ${esc(meta.version)}</span></header><div class="body"><p class="muted">Loading…</p></div></div>
        <div class="card settings-section" id="users" data-users-card><header><h2>Users</h2></header><div class="body"><p class="muted">Loading…</p></div></div>
        <div class="card settings-section" id="network" data-net-card><header><h2>Network access</h2></header><div class="body"><p class="muted">Loading…</p></div></div>
        <div class="card settings-section" id="update"><header><h2>Software update</h2><span class="pill">Version ${esc(meta.version)}</span></header>
          ${!meta.can_update ? `<div class="body"><p class="muted" style="margin:0">Updates are installed on the computer running ${esc(appName())} (${esc(meta.server_name)}).</p>
            <p class="muted small" style="margin:8px 0 0">If that’s a server with no screen, turn on server mode there once and admins can update it from here: run <code>horan-rms headless on</code>.</p></div>`
            : !meta.is_admin ? '<div class="body"><p class="muted" style="margin:0">Only an admin can install updates.</p></div>' : `<div class="body">
            ${meta.headless && meta.remote ? `<p class="small" style="margin-top:0"><span class="badge ok">Server</span> This installs the update on the server <strong>${esc(meta.server_name)}</strong>, so every device gets it.</p>` : ''}
            <p class="muted" style="margin-top:0">Choose the new ${esc(appName())} <code>.zip</code> file. Your data and the
              current version are backed up first, then the app restarts on the new version. Nothing needs to be re-installed.</p>
            <div class="actions">
              <label class="btn primary">Install update from file…<input type="file" accept=".zip,application/zip" data-update hidden></label>
              ${backups.length ? '<button type="button" class="btn" data-rollback>Roll back to previous version</button>' : ''}
            </div>
            <h3 class="net-h">From GitHub</h3>
            <div class="form-grid" style="padding:0">${F('update_repo', 'GitHub repository', { placeholder: meta.github_repo || 'owner/name, e.g. horanav/horan-event-tracking',
              help: meta.github_repo ? `Leave blank to use ${meta.github_repo}. Press Save settings after changing it.` : 'The public repository that publishes releases (owner/name). Press Save settings after changing it.' })}</div>
            <div class="gh-box" data-gh><button type="button" class="btn" data-gh-check>Check for updates</button></div>
            <h3 class="net-h">Automatic updates</h3>
            <div data-auto-update><p class="muted small">Loading…</p></div>
            ${backups.length ? `<p class="muted" style="margin-bottom:0;font-size:12px">Previous version available: ${esc(backupLabel(backups[0]))}</p>` : ''}
          </div>`}</div>
        <div class="card settings-section" id="zoho" data-zoho-card><header><h2>Zoho Books</h2></header><div class="body"><p class="muted">Loading…</p></div></div>
        <div class="card settings-section" id="money"><header><h2>Money &amp; numbering</h2></header><div class="form-grid">
          <label class="check" style="flex-basis:100%"><input type="checkbox" name="vat_registered" data-vat-reg ${s.vat_registered !== '0' ? 'checked' : ''}>
            <span><strong>VAT registered</strong> — add VAT to quotes and invoices. Untick it if your business isn’t registered for VAT: no VAT is added or shown, and your VAT number is left off documents.</span></label>
          ${F('currency', 'Currency symbol', { half: true })}<div class="field half" data-vat-rate-wrap ${s.vat_registered === '0' ? 'hidden' : ''} style="padding:0">${F('vat_rate', 'VAT rate %', { type: 'number', step: 'any', min: 0 })}</div>
          ${F('job_prefix', 'Job number prefix', { half: true })}${F('next_job_number', 'Next job number', { type: 'number', min: 1, step: 1, half: true })}
        </div></div>

        <div class="card settings-section" id="data"><header><h2>Your data</h2></header><div class="body">
          <p class="muted" style="margin-top:0">Everything lives on this computer. A snapshot is saved automatically each day the app runs (the last 14 are kept in the <code>backups</code> folder), and before every update.
            To move to another computer (e.g. Bazzite → Mac), download a backup here and use <strong>Restore from backup</strong> there.</p>
          <dl class="kv"><dt>Data folder</dt><dd class="mono">${esc(meta.data_dir)}</dd></dl>
          <div class="actions" style="margin-top:12px">
            <button type="button" class="btn" data-dl="/backup.db">Download database backup</button>
            <button type="button" class="btn" data-dl="/export.json">Export everything (JSON)</button>
            ${meta.can_update && meta.is_admin ? '<label class="btn">Restore from backup…<input type="file" accept=".db,application/octet-stream" data-restore hidden></label>' : ''}
          </div></div></div>
      </div>
    </div></form></div>`;

  arrangeSettingsTabs(view, meta, tab);
  drawZohoCard(view);
  drawIconsCard(view);
  drawSoundsCard(view);
  drawLayoutCard(view, s);
  drawNetworkCard(view);
  drawUsersCard(view);
  drawMeCard(view);
  drawChangelogCard(view);
  if (meta.can_update && meta.is_admin && (s.update_repo || meta.github_repo)) drawGithub(view, false);
  if (meta.can_update && meta.is_admin) drawAutoUpdate(view);
  const accSel = $('[data-acc-sw]', view);
  if (accSel) {
    accSel.addEventListener('change', () => {
      const k = accSel.value;
      $('[data-acc-how]', view).innerHTML = accHow(k);
      const f = $('form [name="acc_tax_code"]', view); if (f) f.placeholder = accDefault(k, 'tax');
      const a = $('form [name="acc_sales_account"]', view); if (a) a.placeholder = accDefault(k, 'account') || 'not used';
    });
  }
  for (const vr of ['light', 'dark']) {
    const cap = $(`[data-logo-size="${vr}"]`, view);
    if (!cap) continue;
    const im = new Image();
    im.onload = () => { cap.textContent = `Saved at ${im.naturalWidth} × ${im.naturalHeight} px (${(im.naturalWidth / Math.max(1, im.naturalHeight)).toFixed(1)} : 1)`; };
    im.src = `/logo?variant=${vr}&v=${S.logoVersion || 0}`;
  }
  if (!meta.is_admin) {  // only their own details and the change log are shown; the rest is for admins
    const sv = $('[data-save]', view); if (sv) sv.disabled = true;
  }

  const save = async () => {
    const form = $('[data-form]', view);
    const data = {};
    for (const el of form.elements) {
      if (!el.name || el.closest('[data-zoho-card]')) continue;
      data[el.name] = el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value;
    }
    try {
      S.settings = await put('/settings', data);
      applyBrand();
      const lost = Object.keys(data).filter((k) => !(k in S.settings));
      if (lost.length) {
        toast(`Some settings weren’t saved (${lost.join(', ')}). The app may need restarting after an update — quit it and open it again.`, 'error');
      } else toast('Settings saved', 'ok');
    } catch (ex) { toast(ex.message, 'error'); }
  };
  view.onclick = async (e) => {
    try {
      if (e.target.closest('[data-save]')) return save();
      const dl = e.target.closest('[data-dl]');
      if (dl) return download(dl.dataset.dl);
      const rf = e.target.closest('[data-logo-refit]');
      if (rf) {
        const vr = rf.dataset.logoRefit;
        const res = await fetch(`/logo?variant=${vr}&v=${Date.now()}`);
        if (!res.ok) throw new Error('Couldn’t load the saved logo');
        const blob = await res.blob();
        const lg = await prepareLogo(new File([blob], `logo-${vr}`, { type: blob.type }));
        await post('/logo', { data_url: lg.data_url, variant: vr });
        S.settings = await get('/settings'); S.logoVersion = Date.now();
        applyBrand(); renderSettings(view);
        if (lg.warning) toast(lg.warning, 'error'); else toast(`Logo fitted (${lg.width} × ${lg.height} px)`, 'ok');
        return;
      }
      const lr = e.target.closest('[data-logo-remove]');
      if (lr) {
        const vr = lr.dataset.logoRemove;
        if (!await confirmModal(vr === 'dark' ? 'Remove the dark mode logo? Dark mode will use your light logo.' : 'Remove your logo? The sidebar and documents will show your company name instead.', { okLabel: 'Remove' })) return;
        await del(`/logo?variant=${vr}`);
        S.settings = await get('/settings'); S.logoVersion = Date.now();
        applyBrand(); renderSettings(view);
        return;
      }
      if (e.target.closest('[data-icon-remove]')) {
        const r = await del('/icon');
        S.settings = await get('/settings'); S.logoVersion = Date.now();
        applyBrand(); renderSettings(view);
        toast(r.desktop || 'Back to the standard icon', 'ok');
        return;
      }
      if (e.target.closest('[data-gh-check]')) { drawGithub(view, true); return; }
      const st = e.target.closest('[data-sound-test]');
      if (st) { beep(st.dataset.soundTest); return; }
      const sr = e.target.closest('[data-sound-remove]');
      if (sr) {
        const r = await put('/sounds', { kind: sr.dataset.soundRemove });
        S.settings.custom_sounds = JSON.stringify(r.custom_sounds);
        drawSoundsCard(view); toast('Back to the standard beep', 'ok'); return;
      }
      const ip = e.target.closest('[data-icon-pick]');
      if (ip) { if (await iconPickerModal(ip.dataset.iconPick, ip.dataset.iconLabel, ip.dataset.iconDef)) drawIconsCard(view); return; }
      if (e.target.closest('[data-au-save]')) {
        await put('/update/auto', { mode: $('[data-au-mode]', view).value, time: $('[data-au-time]', view).value });
        toast('Automatic updates saved', 'ok');
        drawAutoUpdate(view);
        return;
      }
      if (e.target.closest('[data-print-close]')) { printCloseCode($('[name="case_close_code"]', view).value.trim() || s.case_close_code); return; }
      const ghi = e.target.closest('[data-gh-install]');
      if (ghi) {
        const v = ghi.dataset.ghInstall;
        if (!await confirmModal(`Download and install version ${v} from GitHub? Your data and the current version are backed up first, then the app restarts.`,
          { title: 'Install update?', okLabel: `Install ${v}`, danger: false })) return;
        ghi.disabled = true; ghi.textContent = 'Downloading…';
        try { const info = await post('/update/github', {}); waitForRestart(info.new); } catch (ex) { toast(ex.message, 'error'); ghi.disabled = false; ghi.textContent = `Install ${v} from GitHub`; }
        return;
      }
      const tr = e.target.closest('[data-theme-reset]');
      if (tr) {
        const mode = tr.dataset.themeReset;
        for (const k of THEME_KEYS) {
          const el = $(`[name="${mode}_${k}"]`, view);
          el.value = THEME_DEFAULTS[mode][k];
          el.dispatchEvent(new Event('input', { bubbles: true })); // updates its hex box too
        }
        previewLook(view);
        return;
      }
      const fd = e.target.closest('[data-font-del]');
      if (fd) {
        if (!await confirmModal('Remove this font? Anything using it goes back to the standard font.', { okLabel: 'Remove' })) return;
        await del(`/fonts/${fd.dataset.fontDel}`);
        S.settings = await get('/settings'); applyBrand(); renderSettings(view);
        return;
      }
      if (e.target.closest('[data-z-copy]')) {
        try { await navigator.clipboard.writeText(e.target.closest('[data-z-copy]').dataset.zCopy); toast('Scope copied', 'ok'); }
        catch { toast('Couldn’t copy — select the text and copy it instead', 'error'); }
        return;
      }
      if (e.target.closest('[data-z-connect]')) return zohoConnect(view);
      if (e.target.closest('[data-z-save]')) return zohoSave(view);
      if (e.target.closest('[data-z-disconnect]')) {
        if (!await confirmModal('Disconnect Zoho Books? Invoices already in Zoho are not affected. You can reconnect any time.', { okLabel: 'Disconnect', title: 'Disconnect Zoho Books?' })) return;
        await post('/zoho/disconnect', {});
        S.settings.zoho_connected = false;
        toast('Zoho Books disconnected');
        drawZohoCard(view);
        return;
      }
      if (e.target.closest('[data-rollback]')) {
        const target = backupVersion(backups[0]);
        if (!await confirmModal(`Go back to ${backupLabel(backups[0])}? Your data stays as it is. The app restarts.`,
          { title: 'Roll back?', okLabel: 'Roll back', danger: false })) return;
        await post('/update/rollback', {});
        waitForRestart(target);
      }
    } catch (ex) { toast(ex.message, 'error'); }
  };
  view.onchange = async (e) => {
    try {
      if (e.target.matches('[data-sound-file]')) {
        const f = e.target.files[0];
        e.target.value = '';
        if (!f) return;
        await uploadSound(e.target.dataset.soundFile, f);
        drawSoundsCard(view);
        beep(e.target.dataset.soundFile);
        toast('Sound saved', 'ok');
        return;
      }
      if (e.target.matches('[data-logo]')) {
        const file = e.target.files[0];
        if (!file) return;
        const lg = await prepareLogo(file);
        await post('/logo', { data_url: lg.data_url, variant: e.target.dataset.logo, name: file.name });
        S.settings = await get('/settings'); S.logoVersion = Date.now();
        applyBrand(); renderSettings(view);
        if (lg.warning) toast(lg.warning, 'error'); else toast(`Logo saved (${lg.width} × ${lg.height} px)`, 'ok');
        return;
      }
      if (e.target.matches('[data-icon]')) {
        const file = e.target.files[0];
        if (!file) return;
        const r = await post('/icon', await prepareIcon(file));
        S.settings = await get('/settings'); S.logoVersion = Date.now();
        applyBrand(); renderSettings(view);
        toast(r.desktop || 'App icon saved', 'ok');
        return;
      }
      if (e.target.matches('[data-font-upload]')) {
        const file = e.target.files[0];
        if (!file) return;
        const f = await post('/fonts', { data_url: await fileToDataURL(file), name: file.name });
        await save();  // keep any other unsaved changes
        S.fonts = await get('/fonts');
        renderSettings(view);
        toast(`${f.name} added — choose it under Text or Headings`, 'ok');
        return;
      }
      if (e.target.matches('[data-font-select]')) {
        const w = e.target.dataset.fontSelect, loc = $(`[data-font-local="${w}"]`, view);
        loc.hidden = e.target.value !== 'local:';
        $(`[name="font_${w}"]`, view).value = e.target.value === 'local:' ? (loc.value.trim() ? 'local:' + loc.value.trim() : '') : e.target.value;
        if (!loc.hidden) loc.focus();
        previewLook(view);
        return;
      }
      if (e.target.matches('[data-restore]')) {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        const db = await fileToDataURL(file);
        const chk = await post('/restore', { db_base64: db, dry_run: true });
        if (!await confirmModal(`Replace everything in this app with “${file.name}”? It has ${chk.counts.products} stock items, ${chk.counts.jobs} jobs and ${chk.counts.contacts} clients. A copy of what's here now is saved in the backups folder first. Your logo isn't part of backups — add it again in Logo & branding if needed.`,
          { title: 'Restore from backup?', okLabel: 'Restore', danger: true })) return;
        await post('/restore', { db_base64: db });
        waitForRestart(null, { title: 'Restoring…', text: 'Restoring your backup and restarting. This takes a few seconds.', done: 'Backup restored' });
        return;
      }
      if (e.target.matches('[data-update]')) {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        const zip = await fileToDataURL(file);
        const info = await post('/update', { zip_base64: zip, dry_run: true });
        const msg = info.newer
          ? `Install version ${info.new}? You're on ${info.current}. Your data is backed up first and the app restarts.`
          : `This file is version ${info.new}, which isn't newer than the installed ${info.current}. Install it anyway?`;
        if (!await confirmModal(msg, { title: 'Install update?', okLabel: 'Install update', danger: !info.newer })) return;
        await post('/update', { zip_base64: zip, force: !info.newer });
        waitForRestart(info.new);
        return;
      }
      if (e.target.matches('[data-z="region"]')) {
        const custom = e.target.value === 'other';
        $('[data-z="custom"]', view).hidden = !custom;
        const url = custom ? '' : safeHttpsURL(e.target.value.replace('://accounts.', '://api-console.'));
        const link = $('[data-z-console]', view);
        if (link && url) link.href = url;
        return;
      }
      if (e.target.matches('[data-z="org"]')) { zohoSave(view, true); return; }
      if (e.target.type === 'color' || e.target.name === 'theme_default') previewLook(view);
    } catch (ex) { toast(ex.message, 'error'); }
  };
  view.onkeydown = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); } };
  view.oninput = (e) => {
    if (e.target.type === 'color') previewLook(view);
    if (e.target.matches('[data-vat-reg]')) { const w = $('[data-vat-rate-wrap]', view); if (w) w.hidden = !e.target.checked; }
    if (e.target.matches('[data-au-mode]')) { const tw = $('[data-au-time-wrap]', view); if (tw) tw.hidden = e.target.value === 'none'; }
    if (e.target.name === 'case_close_code') { const pv = $('[data-close-preview]', view); if (pv) pv.innerHTML = barcodeSVG(e.target.value.trim() || 'CLOSE-CASE'); }
    if (e.target.matches('[data-font-local]')) {
      const w = e.target.dataset.fontLocal;
      $(`[name="font_${w}"]`, view).value = e.target.value.trim() ? 'local:' + e.target.value.trim() : '';
      previewLook(view);
    }
  };
}

/** Show colour and font changes straight away (they're kept when you press Save settings). */
function previewLook(view) {
  const form = $('[data-form]', view);
  const draft = { ...S.settings };
  for (const el of form.elements) if (el.name && (el.type === 'color' || el.name.startsWith('font_') || el.name === 'theme_default')) draft[el.name] = el.value;
  applyBrand(draft);
}

function fontPickHTML(which, value, fonts) {
  const kind = value ? value.split(':')[0] : '';
  const opts = [['', 'Standard (Myanmar MN)'], ...Object.entries(FONT_STACKS).map(([k, v]) => [`stack:${k}`, v[0]]),
    ...fonts.map((f) => [`upload:${f.id}`, `${f.name} (added)`]), ['local:', 'A font installed on this computer…']];
  const sel = kind === 'local' ? 'local:' : (value || '');
  return `<div class="field"><span>${which === 'body' ? 'Text' : 'Headings'}</span>
    <select data-font-select="${which}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
    <input data-font-local="${which}" placeholder="Font name, e.g. Myanmar MN" value="${kind === 'local' ? esc(value.slice(6)) : ''}" ${kind === 'local' ? '' : 'hidden'} style="margin-top:6px">
    <input type="hidden" name="font_${which}" value="${esc(value || '')}"></div>`;
}

async function drawUsersCard(view) {
  const card = $('[data-users-card]', view);
  if (!card) return;
  const users = await get('/users');
  const me = S.meta.user;
  const canEdit = !users.length || (me && me.is_admin);
  const active = users.filter((u) => u.active);
  $('.body', card).innerHTML = !users.length
    ? `<p style="margin-top:0">Add the people who use ${esc(appName())}. Each gets a <strong>PIN</strong>, and the app records who creates jobs, adds kit, and scans items out and in (see <a href="#/activity">Activity</a>).</p>
       <p class="muted small">Once there’s a user, everyone signs in with their name and PIN, on this computer too. Start with yourself. The first person is an admin, who can change settings and manage users.</p>
       <button type="button" class="btn primary" data-user-add>Add the first user (you)</button>`
    : `<ul class="user-list">${users.map((u) => `<li><span class="u"><span class="avatar" style="${u.active ? '' : 'opacity:.4'}">${esc(initials(u.name))}</span>
        <span><strong>${esc(u.name)}</strong>${u.is_admin ? ' <span class="badge ok">Admin</span>' : ''}${u.active ? '' : ' <span class="pill">Disabled</span>'}${me && me.id === u.id ? ' <span class="muted small">(you)</span>' : ''}
        <br><span class="muted small">${u.last_activity ? `${esc(u.last_activity.summary)} · ${esc(fmtDate(u.last_activity.at.slice(0, 10)))} ${esc(u.last_activity.at.slice(11, 16))}` : 'No activity yet'}</span></span></span>
        ${canEdit ? `<button type="button" class="btn small" data-user-edit="${u.id}">Edit</button>` : ''}</li>`).join('')}</ul>
       ${canEdit ? '<div class="actions" style="margin-top:10px"><button type="button" class="btn primary small" data-user-add>Add user</button></div>' : ''}
       <p class="muted small" style="margin-bottom:0">${num(active.length)} active. Disabling someone signs them out and keeps their history. Forgotten the only admin PIN? On the computer running it: <code>horan-rms reset-pin "Name" --admin</code>.</p>`;
  card.onclick = async (e) => {
    try {
      if (e.target.closest('[data-user-add]')) {
        const first = !users.length;
        const v = await formModal({
          title: first ? 'Add yourself' : 'Add user',
          fields: [
            { name: 'name', label: 'Name', required: true, placeholder: first ? 'e.g. Alex Smith' : 'e.g. Sam' },
            { name: 'pin', label: 'PIN', type: 'password', required: true, half: true, placeholder: 'At least 4 characters' },
            ...(first ? [] : [{ name: 'is_admin', label: 'Admin — can change settings and manage users', type: 'checkbox' }]),
          ],
          submitLabel: 'Add',
          onSubmit: (vals) => post('/users', { ...vals, is_admin: !!Number(vals.is_admin) }),
        });
        if (!v) return;
        if (first) { toast(`Welcome, ${v.name} — you’re signed in`, 'ok'); location.reload(); return; }
        toast(`${v.name} added`, 'ok'); drawUsersCard(view);
        return;
      }
      const ed = e.target.closest('[data-user-edit]');
      if (ed) {
        const u = users.find((x) => String(x.id) === ed.dataset.userEdit);
        const v = await formModal({
          title: `Edit ${u.name}`,
          fields: [
            { name: 'name', label: 'Name', required: true },
            { name: 'pin', label: 'New PIN', type: 'password', half: true, placeholder: 'Leave blank to keep it' },
            { name: 'is_admin', label: 'Admin — can change settings and manage users', type: 'checkbox' },
            { name: 'active', label: 'Can sign in (untick to disable — their history is kept)', type: 'checkbox' },
          ],
          values: { name: u.name, is_admin: u.is_admin, active: u.active },
          onSubmit: (vals) => put(`/users/${u.id}`, { name: vals.name, pin: vals.pin || undefined, is_admin: !!Number(vals.is_admin), active: !!Number(vals.active) }),
        });
        if (v) { toast('Saved', 'ok'); if (me && me.id === u.id && !v.active) location.reload(); else drawUsersCard(view); }
      }
    } catch (ex) { toast(ex.message, 'error'); }
  };
}

function deviceLabel(agent) {
  const a = agent || '';
  const os = /iPhone/.test(a) ? 'iPhone' : /iPad/.test(a) ? 'iPad' : /Android/.test(a) ? 'Android' : /Mac OS X|Macintosh/.test(a) ? 'Mac'
    : /Windows/.test(a) ? 'Windows' : /CrOS/.test(a) ? 'Chromebook' : /Linux/.test(a) ? 'Linux' : 'Device';
  const br = /Edg\//.test(a) ? 'Edge' : /Firefox\//.test(a) ? 'Firefox' : /Chrome\//.test(a) ? 'Chrome' : /Safari\//.test(a) ? 'Safari' : 'browser';
  return `${os} · ${br}`;
}

async function drawNetworkCard(view) {
  const card = $('[data-net-card]', view);
  if (!card) return;
  let n;
  try { n = await get('/network'); } catch (ex) { $('.body', card).innerHTML = `<p class="form-error">${esc(ex.message)}</p>`; return; }
  const when = (iso) => `${fmtDate(iso.slice(0, 10))} ${iso.slice(11, 16)}`;
  const urls = n.urls.length ? `<div class="net-urls">${n.urls.map((u) => `<div class="net-url"><a class="mono" href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>
      <button type="button" class="btn small" data-copy="${esc(u)}">Copy</button></div>`).join('')}</div>` : '';
  const devices = n.devices.length ? `<h3 class="net-h">Signed-in devices <span class="muted">(${num(n.devices.length)})</span></h3>
    <ul class="net-devices">${n.devices.map((d) => `<li><strong>${esc(d.user_name ? `${d.user_name} · ` : '')}${esc(deviceLabel(d.agent))}</strong>${d.current ? ' <span class="badge ok">this device</span>' : ''}
      <span class="muted small">${esc(d.ip)} · last used ${esc(when(d.last_seen))}</span></li>`).join('')}</ul>
    ${n.devices.some((d) => !d.current) ? '<button type="button" class="btn small" data-net-signout-all>Sign out all other devices</button>' : ''}` : '';
  let body;
  if (!n.is_local) {
    body = `<p style="margin-top:0">You're connected over the network to <strong>${esc(S.meta.server_name)}</strong>. ${S.meta.headless
      ? 'It’s running as a server: change network access and the passcode over SSH with <code>horan-rms network on|off</code> and <code>horan-rms passcode</code>.'
      : 'Network settings and the passcode can only be changed on that computer.'}</p>
      ${devices}<div class="actions" style="margin-top:12px"><button type="button" class="btn" data-net-logout>Sign out this device</button></div>`;
  } else {
    const on = n.enabled && n.listening;
    body = `${n.fixed_host ? '<p class="banner warn">This copy was started with a fixed <code>--host</code>, so that setting decides who can connect.</p>' : ''}
      <p class="net-status ${on ? 'on' : ''}"><span class="dot"></span>${on ? `On — phones, tablets and other computers on this network can use ${esc(appName())}.` : `Off — only this computer can use ${esc(appName())}.`}</p>
      ${on ? `<p class="muted small" style="margin:0 0 6px">On another device connected to the same Wi-Fi or network, open:</p>${urls}` : ''}
      <label class="check" style="margin:12px 0 8px"><input type="checkbox" data-net-on ${n.enabled ? 'checked' : ''}> Let other devices on this network connect</label>
      ${n.users ? `<p class="muted small" style="margin:4px 0 0">Everyone signs in with their own name and PIN (see Users), so no shared passcode is needed.</p><input type="hidden" data-net-pass value="">`
        : `<label class="field"><span>${n.has_passcode ? 'Change passcode' : 'Passcode'}</span><input type="password" data-net-pass autocomplete="new-password"
        placeholder="${n.has_passcode ? 'Leave blank to keep the current one' : 'At least 6 characters'}"></label>
      <p class="muted small" style="margin:4px 0 0">Other devices enter this once to sign in. This computer never needs it. Changing it signs every device out.</p>`}
      <div class="actions" style="margin-top:12px"><button type="button" class="btn primary" data-net-save>Save network access</button></div>
      ${on ? `<details class="net-help"><summary>A device can't connect?</summary>
        <ul><li>Make sure it's on the same Wi-Fi or network as this computer, not mobile data or a guest network.</li>
        <li><strong>Bazzite / Linux:</strong> allow the port through the firewall. Open a terminal and run<br><code>sudo firewall-cmd --permanent --add-port=${num(n.port)}/tcp &amp;&amp; sudo firewall-cmd --reload</code></li>
        <li><strong>Mac:</strong> if asked whether “python3” can accept incoming connections, click <strong>Allow</strong>. If you missed it, see System Settings → Network → Firewall → Options.</li>
        <li>This computer needs to be on and awake, with ${esc(appName())} running.</li></ul></details>` : ''}
      ${devices}`;
  }
  $('.body', card).innerHTML = body;
  card.onclick = async (e) => {
    try {
      const cp = e.target.closest('[data-copy]');
      if (cp) {
        try { await navigator.clipboard.writeText(cp.dataset.copy); toast('Copied', 'ok'); } catch { toast(cp.dataset.copy); }
        return;
      }
      if (e.target.closest('[data-net-save]')) {
        const enabled = $('[data-net-on]', card).checked, passcode = $('[data-net-pass]', card).value;
        const res = await put('/network', { enabled, passcode });
        if (res.restarting) {
          waitForRestart(null, { title: enabled ? 'Turning on network access…' : 'Turning off network access…',
            text: `Restarting ${appName()}. This takes a few seconds.`, done: enabled ? 'Network access is on' : 'Network access is off' });
          return;
        }
        toast(passcode ? 'Passcode saved — other devices need to sign in again' : 'Saved', 'ok');
        drawNetworkCard(view);
        return;
      }
      if (e.target.closest('[data-net-signout-all]')) {
        if (!await confirmModal('Sign out every other device? They’ll need the passcode to get back in.', { okLabel: 'Sign them out', title: 'Sign out devices?' })) return;
        await del('/network/devices'); toast('Other devices signed out', 'ok'); drawNetworkCard(view); return;
      }
      if (e.target.closest('[data-net-logout]')) { await post('/logout'); location.reload(); }
    } catch (ex) { toast(ex.message, 'error'); }
  };
}

async function drawZohoCard(view) {
  const card = $('[data-zoho-card]', view);
  if (!card) return;
  let z;
  try { z = await get('/zoho'); } catch (ex) { card.querySelector('.body').innerHTML = `<p class="form-error">${esc(ex.message)}</p>`; return; }
  S.settings.zoho_connected = z.connected;
  if (!z.connected) {
    const cur = z.accounts_url || 'https://accounts.zoho.eu';
    const known = z.regions.some((r) => r.url === cur);
    card.innerHTML = `<header><h2>Zoho Books</h2><span class="pill">Not connected</span></header><div class="body">
      <p class="muted" style="margin-top:0">Connect once, then turn any job into a draft Zoho Books invoice with one click. The client is matched to an existing Zoho customer by email or name. Customers are never created from here.</p>
      <ol class="steps">
        <li><b>Your Zoho region</b>: it matches the address you sign in at (e.g. books.zoho.<b>eu</b>).
          <select data-z="region">${z.regions.map((r) => `<option value="${esc(r.url)}" ${r.url === cur ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}
            <option value="other" ${known ? '' : 'selected'}>Other…</option></select>
          <input data-z="custom" placeholder="https://accounts.zoho.…" value="${known ? '' : esc(cur)}" ${known ? 'hidden' : ''} style="margin-top:6px"></li>
        <li>Open the <a data-z-console href="${esc(cur.replace('://accounts.', '://api-console.'))}" target="_blank" rel="noopener">Zoho API Console ↗</a>,
          click <b>Add Client → Self Client → Create</b>, then copy the <b>Client ID</b> and <b>Client Secret</b> into the boxes below.</li>
        <li>On the <b>Generate Code</b> tab, paste this scope, set the time to <b>10 minutes</b>, click <b>Create</b>, choose your Zoho Books organisation and copy the code:
          <div class="scope-box"><code>${esc(z.scopes)}</code><button type="button" class="btn small" data-z-copy="${esc(z.scopes)}">Copy</button></div></li>
        <li>Paste the code below and click <b>Connect</b> straight away (the code expires).</li>
      </ol>
      <div class="form-grid" style="padding:0">
        <label class="field half"><span>Client ID</span><input data-z="client_id" value="${esc(z.client_id || '')}" autocomplete="off"></label>
        <label class="field half"><span>Client Secret</span><input data-z="client_secret" type="password" autocomplete="off"></label>
        <label class="field"><span>Code</span><input data-z="code" autocomplete="off" placeholder="1000.xxxxxxxx…"></label>
      </div>
      <p class="form-error" data-z-error hidden></p>
      <div class="actions" style="margin-top:12px"><button type="button" class="btn primary" data-z-connect>Connect Zoho Books</button></div>
    </div>`;
    return;
  }
  card.innerHTML = `<header><h2>Zoho Books</h2><span class="pill confirmed">Connected</span></header><div class="body">
    <div class="form-grid" style="padding:0">
      <label class="field"><span>Organisation</span><select data-z="org"><option>${esc(z.org_name || 'Loading…')}</option></select></label>
      <label class="field"><span>Tax on invoice lines</span><select data-z="tax"><option>${esc(z.tax_name || 'Loading…')}</option></select>
        <small>Pick your standard VAT rate (e.g. Standard Rate 20%) so Zoho's totals match this app's.</small></label>
      <label class="check"><input type="checkbox" data-z="mark" ${z.mark_invoiced ? 'checked' : ''}> Mark the job as <b>Invoiced</b> when its Zoho invoice is created</label>
    </div>
    <p class="form-error" data-z-error hidden></p>
    <div class="actions" style="margin-top:12px">
      <button type="button" class="btn primary" data-z-save>Save Zoho settings</button>
      <button type="button" class="btn danger" data-z-disconnect>Disconnect</button>
    </div></div>`;
  try {
    const o = await get('/zoho/options');
    const orgSel = $('[data-z="org"]', card), taxSel = $('[data-z="tax"]', card);
    if (!orgSel) return;
    orgSel.innerHTML = o.organizations.map((x) => `<option value="${esc(x.id)}" ${x.id === z.org_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    const vatGuess = !z.tax_id && o.taxes.find((t) => Number(t.rate) === Number(S.settings.vat_rate));
    taxSel.innerHTML = `<option value="">No tax</option>` + o.taxes.map((t) => {
      const sel = z.tax_id ? t.id === z.tax_id : vatGuess && t.id === vatGuess.id;
      return `<option value="${esc(t.id)}" ${sel ? 'selected' : ''}>${esc(t.name)}${t.rate != null ? ` (${num(t.rate)}%)` : ''}</option>`;
    }).join('');
    if (vatGuess) {
      const err = $('[data-z-error]', card);
      err.textContent = `We've picked “${vatGuess.name}” to match your ${num(S.settings.vat_rate)}% VAT. Click Save Zoho settings to keep it.`;
      err.className = 'banner warn'; err.hidden = false;
    }
  } catch (ex) {
    const err = $('[data-z-error]', card);
    if (err) { err.textContent = ex.message; err.hidden = false; }
  }
}

async function zohoConnect(view) {
  const card = $('[data-zoho-card]', view);
  const v = (k) => ($(`[data-z="${k}"]`, card)?.value || '').trim();
  const err = $('[data-z-error]', card);
  err.hidden = true;
  const btn = $('[data-z-connect]', card);
  btn.disabled = true; btn.textContent = 'Connecting…';
  try {
    const region = v('region');
    await post('/zoho/connect', {
      accounts_url: region === 'other' ? v('custom') : region,
      client_id: v('client_id'), client_secret: v('client_secret'), code: v('code'),
    });
    S.settings.zoho_connected = true;
    toast('Zoho Books connected', 'ok');
    drawZohoCard(view);
  } catch (ex) {
    err.textContent = ex.message; err.hidden = false;
    btn.disabled = false; btn.textContent = 'Connect Zoho Books';
  }
}

async function zohoSave(view, orgChanged) {
  const card = $('[data-zoho-card]', view);
  const org = $('[data-z="org"]', card), tax = $('[data-z="tax"]', card);
  try {
    const body = {
      org_id: org.value, org_name: org.selectedOptions[0]?.textContent || '',
      mark_invoiced: $('[data-z="mark"]', card).checked,
    };
    if (!orgChanged) { body.tax_id = tax.value; body.tax_name = tax.value ? tax.selectedOptions[0]?.textContent || '' : ''; }
    await put('/zoho', body);
    toast(orgChanged ? 'Organisation changed — now choose its tax rate' : 'Zoho settings saved', 'ok');
    drawZohoCard(view);
  } catch (ex) { toast(ex.message, 'error'); }
}

function fileToDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error('Couldn’t read that file'));
    r.readAsDataURL(file);
  });
}

const backupVersion = (name) => (name.match(/-v([\d.]+)$/) || [])[1] || '';
function backupLabel(name) {
  const m = name.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})\d{2}-v(.+)$/);
  return m ? `version ${m[6]} (replaced ${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]})` : name;
}

function waitForRestart(version, { title = 'Updating…', text = `Installing and restarting ${appName()}. This takes a few seconds.`, done } = {}) {
  openModal(`<header><h2>${esc(title)}</h2></header><div class="modal-body"><p data-msg>${esc(text)}</p></div><footer></footer>`);
  const started = Date.now();
  const tick = async () => {
    try {
      const m = await get('/meta');
      if (!version || m.version === version) {
        try { sessionStorage.setItem('het-updated', done || `Now running version ${m.version}`); } catch { /* ignore */ }
        location.reload();
        return;
      }
    } catch { /* server restarting */ }
    if (Date.now() - started > 40000) {
      const el = $('[data-msg]');
      if (el) el.textContent = `This is taking longer than expected. Close this window and re-open ${appName()} from your app menu.`;
      return;
    }
    setTimeout(tick, 1000);
  };
  setTimeout(tick, 1500);
}

/* ---------------------------------------------------------------- look: theme, colours, fonts, logo */

const THEME_KEYS = ['bg', 'surface', 'text', 'sidebar', 'sidebar_text'];
const THEME_LABEL = { bg: 'Background', surface: 'Cards & panels', text: 'Text', sidebar: 'Sidebar', sidebar_text: 'Sidebar text' };
const THEME_DEFAULTS = {
  light: { bg: '#f3f4f1', surface: '#ffffff', text: '#1b201e', sidebar: '#ffffff', sidebar_text: '#1b201e' },
  dark: { bg: '#121514', surface: '#1b1f1d', text: '#e8ebe9', sidebar: '#0e1311', sidebar_text: '#e8ebe9' },
};
const FONT_STACKS = {
  system: ['System', 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif'],
  humanist: ['Humanist sans', '"Gill Sans", "Gill Sans MT", Seravek, "Segoe UI", "Noto Sans", sans-serif'],
  rounded: ['Rounded', 'ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", system-ui, sans-serif'],
  serif: ['Serif', 'Charter, "Bitstream Charter", Georgia, "Noto Serif", "Times New Roman", serif'],
  slab: ['Slab serif', 'Rockwell, "Roboto Slab", "DejaVu Serif", Georgia, serif'],
  mono: ['Monospace', 'ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace'],
};
const DEFAULT_FONT = '"Myanmar MN", "Myanmar Sangam MN", "Noto Sans", "Inter", "Cantarell", system-ui, sans-serif';

function themePref() { try { return localStorage.getItem('het-theme') || 'device-default'; } catch { return 'device-default'; } }
function effectiveTheme() {
  let pref = themePref();
  if (pref === 'device-default') pref = (S.settings && S.settings.theme_default) || 'system';
  if (pref === 'system') return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return pref;
}
function applyTheme() {
  document.documentElement.setAttribute('data-theme', effectiveTheme());
  const t = $('#theme-toggle');
  if (t) {
    const pref = themePref();
    const label = pref === 'light' ? 'Light' : pref === 'dark' ? 'Dark' : pref === 'system' ? 'Auto' : `Default (${({ system: 'auto', light: 'light', dark: 'dark' })[(S.settings && S.settings.theme_default) || 'system']})`;
    t.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z"/></svg>${esc(label)}`;
    t.title = 'Light or dark for this device — click to change';
  }
}
function cycleTheme() {
  const order = ['device-default', 'light', 'dark', 'system'];
  const next = order[(order.indexOf(themePref()) + 1) % order.length];
  try { if (next === 'device-default') localStorage.removeItem('het-theme'); else localStorage.setItem('het-theme', next); } catch { /* private mode */ }
  applyTheme();
  toast({ 'device-default': 'Using the default look from Settings', light: 'Light mode on this device', dark: 'Dark mode on this device', system: 'Following this device’s light/dark setting' }[next]);
}
if (window.matchMedia) {
  const mq = matchMedia('(prefers-color-scheme: dark)');
  (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(() => applyTheme());
}

/** CSS for one mode's colours; the softer shades (borders, muted text) are mixed from them. */
function themeVars(mode, c) {
  const mix = (a, pct, b) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;
  return `:root[data-theme="${mode}"]{--bg:${c.bg};--surface:${c.surface};--text:${c.text};--sidebar-bg:${c.sidebar};--sidebar-text:${c.sidebar_text};`
    + `--surface-2:${mix(c.text, mode === 'dark' ? 5 : 3, c.surface)};--border:${mix(c.text, mode === 'dark' ? 13 : 12, c.surface)};`
    + `--border-strong:${mix(c.text, mode === 'dark' ? 21 : 20, c.surface)};--muted:${mix(c.text, 62, c.surface)};}`;
}
function themeColours(src = S.settings) {
  const out = {};
  for (const mode of ['light', 'dark']) {
    out[mode] = {};
    for (const k of THEME_KEYS) out[mode][k] = (src && src[`${mode}_${k}`]) || THEME_DEFAULTS[mode][k];
  }
  return out;
}
function fontStack(choice) {
  if (!choice) return null;
  const [kind, val] = [choice.split(':')[0], choice.slice(choice.indexOf(':') + 1)];
  if (kind === 'stack' && FONT_STACKS[val]) return FONT_STACKS[val][1];
  if (kind === 'local') return `"${val.replace(/["\\]/g, '')}", ${DEFAULT_FONT}`;
  if (kind === 'upload') return `"HET Font ${Number(val)}", ${DEFAULT_FONT}`;
  return null;
}
function fontFaces(choices) {
  return [...new Set(choices.filter((c) => c && c.startsWith('upload:')).map((c) => Number(c.split(':')[1])))]
    .map((id) => `@font-face{font-family:"HET Font ${id}";src:url(/font/${id});font-display:swap;}`).join('');
}

function applyBrand(src = S.settings) {
  const s = src;
  const root = document.documentElement.style;
  if (s.brand_primary) root.setProperty('--brand', s.brand_primary);
  if (s.brand_accent) root.setProperty('--accent', s.brand_accent);
  if (s.brand_grey) root.setProperty('--grey', s.brand_grey);
  const cols = themeColours(s);
  $('#theme-vars').textContent = themeVars('light', cols.light) + themeVars('dark', cols.dark);
  $('#font-faces').textContent = fontFaces([s.font_body, s.font_heading]);
  const body = fontStack(s.font_body), head = fontStack(s.font_heading);
  if (body) root.setProperty('--font', body); else root.removeProperty('--font');
  if (head) root.setProperty('--font-heading', head); else root.removeProperty('--font-heading');
  if (src === S.settings) { try { localStorage.setItem('het-theme-default', s.theme_default || 'system'); } catch { /* ignore */ } }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = s.brand_primary || '#1f5c3d';
  applyTheme();
  document.title = appName(s);
  const custom = appName(s) !== DEFAULT_APP_NAME;
  $('#brand-name').textContent = custom ? appName(s) : 'Horan';
  $('.brand-sub').textContent = custom ? (s.has_logo ? appName(s) : '') : 'Event Tracking';
  $('.brand-sub').hidden = custom && !s.has_logo;
  applyNavIcons();
  const wrap = $('#brand-logo-wrap');
  const v = S.logoVersion || (S.logoVersion = Date.now());
  // No uploaded logo and the app isn't renamed: show the app's own logo (it has a light and a dark version).
  const builtIn = !s.has_logo && !custom;
  if (s.has_logo || builtIn) {
    $('#brand-logo').src = `/logo?variant=light&v=${v}`;
    $('#brand-logo-dark').src = s.has_logo_dark || builtIn ? `/logo?variant=dark&v=${v}` : '';
    wrap.classList.toggle('has-dark', !!s.has_logo_dark || builtIn);
    wrap.hidden = false;
  } else wrap.hidden = true;
  for (const img of [$('#brand-logo'), $('#brand-logo-dark')]) img.alt = appName(s);
  $('#brand-name').hidden = !!s.has_logo || builtIn;
  if (builtIn) $('.brand-sub').hidden = true;
  if (s.has_icon !== undefined) {
    $('#fav').href = `/favicon?v=${v}`;
    $('#touch-icon').href = `/apple-touch-icon.png?v=${v}`;
  }
}

/* ---- image helpers (all done in the browser, so nothing extra is needed on the computer) */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That image couldn’t be opened')); };
    img.src = url;
  });
}
/** SVG logos: make the drawing area fit everything that's drawn, so nothing outside it gets cut off. */
/** Only http(s) links may be used as an href (blocks javascript:, data: and the like). */
function safeHttpsURL(value) {
  try {
    const u = new URL(String(value), location.href);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch { return ''; }
}
/** Strip anything from a parsed SVG that could run script or pull in other content
 *  (scripts, embedded HTML, event handlers, javascript:/external links). */
function sanitizeSVG(svg) {
  const BAD_TAGS = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'animate', 'set', 'animatemotion', 'animatetransform', 'handler', 'listener']);
  for (const el of [svg, ...svg.querySelectorAll('*')]) {
    if (el !== svg && BAD_TAGS.has(el.localName.toLowerCase())) { el.remove(); continue; }
    for (const a of [...el.attributes]) {
      const name = a.name.toLowerCase();
      const val = a.value.replace(/[\s\u0000-\u001f]+/g, '').toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(a.name);
      else if ((name === 'href' || name.endsWith(':href') || name === 'src') && !val.startsWith('#') && !/^data:image\/(png|jpe?g|gif|webp);/.test(val)) el.removeAttribute(a.name);
      else if (/javascript:|vbscript:/.test(val)) el.removeAttribute(a.name);
    }
  }
  return svg;
}
/** Read an SVG file straight into an inert XML document (nothing in it runs; it isn't attached to the page). */
function loadSVGDocument(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([file], { type: 'image/svg+xml' }));
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'document';
    xhr.overrideMimeType('image/svg+xml');
    xhr.onload = () => { URL.revokeObjectURL(url); resolve(xhr.responseXML); };
    xhr.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That SVG file couldn’t be read')); };
    xhr.send();
  });
}
async function fitSVG(file) {
  const doc = await loadSVGDocument(file);
  const svg = doc && doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) throw new Error('That SVG file couldn’t be read');
  sanitizeSVG(svg);
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-10000px;top:0;width:4000px;height:4000px;visibility:hidden;overflow:hidden';
  const live = document.importNode(svg, true);
  live.removeAttribute('width'); live.removeAttribute('height');
  live.setAttribute('width', '4000'); live.setAttribute('height', '4000');
  live.style.overflow = 'visible';
  host.appendChild(live); document.body.appendChild(host);
  let box;
  try { box = live.getBBox(); } finally { host.remove(); }
  if (!box || !(box.width > 0 && box.height > 0)) return { text: new XMLSerializer().serializeToString(svg), width: 0, height: 0 };
  const pad = Math.max(box.width, box.height) * 0.02;
  const vb = [box.x - pad, box.y - pad, box.width + pad * 2, box.height + pad * 2].map((v) => +v.toFixed(3));
  svg.setAttribute('viewBox', vb.join(' '));
  const k = 1200 / Math.max(vb[2], vb[3]);
  svg.setAttribute('width', String(Math.round(vb[2] * k)));
  svg.setAttribute('height', String(Math.round(vb[3] * k)));
  svg.removeAttribute('x'); svg.removeAttribute('y');
  if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return { text: new XMLSerializer().serializeToString(svg), width: Math.round(vb[2] * k), height: Math.round(vb[3] * k) };
}

/** Logo: fits it to its content (trims empty see-through edges; for SVGs, widens the drawing area so nothing is cut off).
 *  Returns { data_url, width, height, warning }. */
async function prepareLogo(file) {
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name || '')) {
    const fit = await fitSVG(file);
    const b64 = btoa(unescape(encodeURIComponent(fit.text)));
    return { data_url: `data:image/svg+xml;base64,${b64}`, width: fit.width, height: fit.height, warning: '' };
  }
  const { img, url } = await loadImage(file);
  try {
    const w = img.naturalWidth, h = img.naturalHeight;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1, see = false;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = d[(y * w + x) * 4 + 3];
      if (a > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } else see = true;
    }
    if (x1 < 0) throw new Error('That logo looks completely transparent');
    const touches = see && (y0 === 0 || x0 === 0 || y1 === h - 1 || x1 === w - 1);
    const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.02);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const k = Math.min(1, 1600 / Math.max(cw + pad * 2, ch + pad * 2));
    const out = document.createElement('canvas'); out.width = Math.round((cw + pad * 2) * k); out.height = Math.round((ch + pad * 2) * k);
    const og = out.getContext('2d'); og.imageSmoothingQuality = 'high';
    og.drawImage(c, x0, y0, cw, ch, Math.round(pad * k), Math.round(pad * k), Math.round(cw * k), Math.round(ch * k));
    return {
      data_url: out.toDataURL('image/png'), width: out.width, height: out.height,
      warning: touches ? 'Part of the logo reaches the edge of the image file, so it may already be cut off in the file itself. If it looks cropped, re-export it with some space around it.' : '',
    };
  } finally { URL.revokeObjectURL(url); }
}
/** Square PNG at `size`, the image centred and scaled to fit. */
function squarePNG(img, size, background) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
  if (background) { g.fillStyle = background; g.fillRect(0, 0, size, size); }
  const k = Math.min(size / img.naturalWidth, size / img.naturalHeight);
  const w = img.naturalWidth * k, h = img.naturalHeight * k;
  g.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return c.toDataURL('image/png');
}
async function prepareIcon(file) {
  const { img, url } = await loadImage(file);
  try {
    return { png512: squarePNG(img, 512), png192: squarePNG(img, 192), png180: squarePNG(img, 180, '#ffffff'), png32: squarePNG(img, 32) };
  } finally { URL.revokeObjectURL(url); }
}
/** Stock photo: at most 1600px (JPEG, or PNG if it has see-through parts) plus a 240px thumbnail. */
async function prepareProductImage(file) {
  const { img, url } = await loadImage(file);
  try {
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, c.width, c.height);
    const keepAlpha = file.type === 'image/png' || file.type === 'image/webp';
    let data_url = keepAlpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.86);
    if (keepAlpha && data_url.length > 6e6) data_url = c.toDataURL('image/jpeg', 0.86);
    const t = document.createElement('canvas'); const tk = 240 / Math.max(c.width, c.height);
    t.width = Math.max(1, Math.round(c.width * Math.min(1, tk))); t.height = Math.max(1, Math.round(c.height * Math.min(1, tk)));
    const tg = t.getContext('2d'); tg.fillStyle = '#ffffff'; tg.fillRect(0, 0, t.width, t.height); tg.drawImage(c, 0, 0, t.width, t.height);
    return { data_url, thumb_url: t.toDataURL('image/jpeg', 0.8) };
  } finally { URL.revokeObjectURL(url); }
}

/* ---------------------------------------------------------------- icons you can change (sidebar and stock categories) */

// Built-in icons: 24 × 24 line drawings, drawn with the text colour so they suit light and dark mode.
const ICON_LIB = {
  dashboard: ['Dashboard', '<path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z"/>'],
  list: ['List', '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>'],
  calendar: ['Calendar', '<path d="M4 7h16v13H4zM4 11h16M9 4v6M15 4v6"/>'],
  barcode: ['Barcode', '<path d="M3 7V4h3M18 4h3v3M21 17v3h-3M6 20H3v-3M7 8v8M10 8v8M13 8v8M16 8v8"/>'],
  box: ['Box', '<path d="M3 8l9-5 9 5-9 5zM3 8v8l9 5 9-5V8M12 13v8"/>'],
  shield: ['Shield', '<path d="M12 3l9 4v6c0 4.5-3.8 7.7-9 8-5.2-.3-9-3.5-9-8V7z"/><path d="M9 9l6 6M15 9l-6 6"/>'],
  store: ['Shop', '<path d="M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6"/>'],
  users: ['People', '<path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.9M16 3.1a3.5 3.5 0 0 1 0 6.8"/>'],
  activity: ['Activity', '<path d="M3 12h4l3-8 4 16 3-8h4"/>'],
  bulb: ['Idea', '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.9V16h5v-.2c0-.8.4-1.5 1-1.9A6 6 0 0 0 12 3z"/>'],
  gear: ['Settings', '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'],
  plus: ['Plus', '<path d="M12 5v14M5 12h14"/>'],
  speaker: ['Speaker', '<rect x="6" y="2" width="12" height="20" rx="2"/><circle cx="12" cy="14" r="4"/><path d="M12 6h.01"/>'],
  mic: ['Microphone', '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8"/>'],
  headphones: ['Headphones', '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/>'],
  music: ['Music', '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'],
  sliders: ['Mixer', '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'],
  radio: ['Radio / RF', '<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5"/>'],
  lamp: ['Light', '<path d="M8 2h8l3 8H5zM12 10v8M8 22h8M12 18v4"/>'],
  sun: ['Wash / sun', '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'],
  cloud: ['Haze / smoke', '<path d="M18 10h-1.3A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>'],
  monitor: ['Monitor', '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>'],
  tv: ['Screen', '<rect x="2" y="7" width="20" height="13" rx="2"/><path d="M17 2l-5 5-5-5"/>'],
  projector: ['Projector', '<rect x="2" y="8" width="20" height="9" rx="2"/><circle cx="16" cy="12.5" r="2.5"/><path d="M6 12h4M5 17v2M19 17v2"/>'],
  pscreen: ['Projection screen', '<path d="M3 4h18M4 4v11h16V4M12 15v5M8 21l4-1 4 1"/>'],
  camera: ['Camera', '<path d="M23 7l-7 5 7 5z"/><rect x="1" y="5" width="15" height="14" rx="2"/>'],
  laptop: ['Laptop', '<rect x="4" y="4" width="16" height="11" rx="1"/><path d="M2 19h20"/>'],
  wifi: ['Network', '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0M12 20h.01"/>'],
  cable: ['Cable', '<path d="M7 3v4M11 3v4M5 7h8v4a4 4 0 0 1-8 0zM9 15v2a4 4 0 0 0 4 4h2a4 4 0 0 0 4-4V3"/>'],
  plug: ['Plug', '<path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0zM12 17v5"/>'],
  bolt: ['Power', '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'],
  battery: ['Battery', '<rect x="2" y="7" width="18" height="10" rx="2"/><path d="M22 11v2M6 11v2"/>'],
  truss: ['Truss', '<path d="M2 6h20M2 18h20M2 6l4 12 4-12 4 12 4-12 4 12"/>'],
  ladder: ['Rigging', '<path d="M7 2v20M17 2v20M7 6h10M7 11h10M7 16h10"/>'],
  stage: ['Stage', '<path d="M2 10h20v5H2zM4 15v6M20 15v6M2 10l3-4h14l3 4"/>'],
  drape: ['Drape', '<path d="M3 3h18M5 3v18M19 3v18M5 3c2 6 2 12 0 18M19 3c-2 6-2 12 0 18M12 3v18"/>'],
  fcase: ['Flight case', '<rect x="2" y="6" width="20" height="13" rx="1"/><path d="M2 10h20M7 6v4M17 6v4M5 19v2M19 19v2"/>'],
  truck: ['Truck', '<path d="M1 4h14v12H1zM15 9h4l3 4v3h-7"/><circle cx="5.5" cy="18.5" r="2"/><circle cx="18.5" cy="18.5" r="2"/>'],
  tent: ['Marquee', '<path d="M12 3L2 20h20zM12 3v17M8 20l4-7 4 7"/>'],
  chair: ['Chair', '<path d="M6 3h12v8H6zM5 11h14v3H5zM7 14v7M17 14v7"/>'],
  table: ['Table', '<path d="M2 8h20M4 8v12M20 8v12M2 8l2-4h16l2 4"/>'],
  tool: ['Tools', '<path d="M14 7l3-3 3 3-3 3M14 7l-9 9 3 3 9-9"/>'],
  layers: ['Layers', '<path d="M12 2l10 5-10 5L2 7zM2 17l10 5 10-5M2 12l10 5 10-5"/>'],
  grid: ['Grid', '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>'],
  folder: ['Folder', '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'],
  clipboard: ['Clipboard', '<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 2h6v4H9zM9 12h6M9 16h6"/>'],
  file: ['Document', '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>'],
  tag: ['Tag', '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><path d="M7 7h.01"/>'],
  chart: ['Chart', '<path d="M3 3v18h18M7 15l4-4 3 3 5-6"/>'],
  pound: ['Money', '<path d="M17 20H7c2-1 3-3 3-6V8a4 4 0 0 1 7-2.6M6 13h8"/>'],
  clock: ['Clock', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>'],
  bell: ['Bell', '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>'],
  search: ['Search', '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/>'],
  home: ['Home', '<path d="M3 10l9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>'],
  user: ['Person', '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>'],
  flag: ['Flag', '<path d="M4 22V3M4 4h13l-2 4 2 4H4"/>'],
  star: ['Star', '<path d="M12 2l3 7h7l-5.5 4.5 2 7.5L12 17l-6.5 4 2-7.5L2 9h7z"/>'],
  heart: ['Heart', '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/>'],
  check: ['Tick', '<path d="M20 6L9 17l-5-5"/>'],
};
// The sidebar, in order, with each item's own icon.
const NAV_ICONS = [['new_job', 'New job', 'plus'], ['dashboard', 'Dashboard', 'dashboard'], ['jobs', 'Jobs & quotes', 'list'],
  ['availability', 'Availability', 'calendar'], ['scan', 'Scan', 'barcode'], ['stock', 'Stock', 'box'], ['quarantine', 'Quarantine', 'shield'],
  ['vendors', 'Vendors', 'store'], ['contacts', 'Clients', 'users'], ['activity', 'Activity', 'activity'], ['requests', 'Requests', 'bulb'],
  ['settings', 'Settings', 'gear']];

function customIcons(s = S.settings) {
  try { const v = JSON.parse((s && s.custom_icons) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
const libSVG = (name, cls = '') => (ICON_LIB[name] ? `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON_LIB[name][1]}</svg>` : '');
/** An icon as HTML: a chosen built-in, an uploaded file (coloured to match the text, or as it is), or the fallback. */
function iconHTML(target, fallback = '', cls = '') {
  const spec = customIcons()[target];
  if (spec && spec.file) {
    const url = `/uicon?t=${encodeURIComponent(target)}&v=${spec.v || 0}`;
    return spec.tint ? `<span class="uicon tint ${cls}" style="--u:url('${url}')" aria-hidden="true"></span>`
      : `<img class="uicon ${cls}" src="${url}" alt="" aria-hidden="true">`;
  }
  return libSVG((spec && spec.lib) || fallback, cls);
}
const catTarget = (cat) => `cat:${String(cat || '').trim().toLowerCase()}`;
/** A stock category's icon, if one has been chosen. */
function catIcon(cat, cls = 'cat-icon') { return cat && customIcons()[catTarget(cat)] ? iconHTML(catTarget(cat), '', cls) : ''; }

/** Put the chosen icons in the sidebar. */
function applyNavIcons() {
  for (const [key, , def] of NAV_ICONS) {
    const host = key === 'new_job' ? $('#nav-new-job') : $(`[data-nav="${key}"]`);
    if (!host) continue;
    const old = host.querySelector('svg, .uicon');
    const html = iconHTML(`nav:${key}`, def);
    if (old) old.outerHTML = html; else host.insertAdjacentHTML('afterbegin', html);
  }
}

/** Settings → Customisation → Scan sounds. */
function drawSoundsCard(view) {
  const card = $('[data-sounds-card]', view);
  if (!card) return;
  const cs = customSounds();
  $('.body', card).innerHTML = `<p class="muted" style="margin-top:0">Use your own sounds when scanning at check out, check in and on the Scan page.
      MP3, WAV, Ogg (Vorbis or Opus), FLAC or WebM, up to 2 MB — short clips (under a second) work best. Without one, the app beeps.</p>
    <ul class="icon-list sound-list">${SOUND_KINDS.map(([k, label, help]) => `<li>
      <span class="icon-name"><strong>${esc(label)}</strong><br><span class="muted small">${esc(help)}</span>
        ${cs[k] ? `<br><span class="small">🎵 ${esc(cs[k].name || 'your sound')}</span>` : '<br><span class="muted small">Standard beep</span>'}</span>
      <button type="button" class="btn small" data-sound-test="${k}" aria-label="Play the ${esc(label)} sound">▶ Test</button>
      <label class="btn small">${cs[k] ? 'Replace' : 'Upload'}…<input type="file" accept=".mp3,.wav,.ogg,.oga,.opus,.flac,.webm,audio/*" data-sound-file="${k}" hidden></label>
      ${cs[k] ? `<button type="button" class="btn small danger" data-sound-remove="${k}">Use the beep</button>` : ''}</li>`).join('')}</ul>`;
}
async function uploadSound(kind, file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const type = SOUND_EXT[ext] || (/^audio\//.test(file.type) ? file.type : '');
  if (!type) throw new Error('Choose an MP3, WAV, Ogg, Opus, FLAC or WebM sound file');
  if (file.size > 2 * 1024 * 1024) throw new Error('That sound is over 2 MB — use a shorter clip');
  // Check this browser can play it before saving.
  const url = URL.createObjectURL(file);
  try {
    await new Promise((res, rej) => {
      const a = new Audio();
      a.oncanplaythrough = res; a.onerror = () => rej(new Error('This browser can’t play that file — try MP3 or WAV'));
      a.src = url; a.load();
      setTimeout(res, 3000);
    });
  } finally { URL.revokeObjectURL(url); }
  const raw = await fileToDataURL(file);
  const dataUrl = raw.replace(/^data:[^;,]*;/, `data:${type};`);
  const r = await put('/sounds', { kind, data_url: dataUrl, name: file.name });
  S.settings.custom_sounds = JSON.stringify(r.custom_sounds);
}

/** Settings → Customisation → Icons. */
async function drawIconsCard(view) {
  const card = $('[data-icons-card]', view);
  if (!card) return;
  let cats = [];
  try { cats = [...new Set((await get('/products?archived=1')).map((p) => (p.category || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)); } catch { /* ignore */ }
  const ci = customIcons();
  const row = (target, label, def) => `<li><span class="icon-cur">${iconHTML(target, def) || '<span class="muted small">none</span>'}</span>
      <span class="icon-name">${esc(label)}</span>${ci[target] ? '<span class="pill">changed</span>' : ''}
      <button type="button" class="btn small" data-icon-pick="${esc(target)}" data-icon-def="${esc(def)}" data-icon-label="${esc(label)}">Change…</button></li>`;
  $('.body', card).innerHTML = `<p class="muted" style="margin-top:0">Pick one of the built-in icons or upload your own (SVG or PNG, square works best). Icons follow light and dark mode unless you upload a coloured one and keep its colours.</p>
    <h3 class="net-h">Sidebar</h3><ul class="icon-list">${NAV_ICONS.map(([k, l, d]) => row(`nav:${k}`, l, d)).join('')}</ul>
    <h3 class="net-h">Stock categories</h3>
    ${cats.length ? `<ul class="icon-list">${cats.map((c) => row(catTarget(c), c, '')).join('')}</ul>
      <p class="muted small">Category icons show in the stock list and when adding items to a job.</p>` : '<p class="muted small">Add stock with categories first, then give each category an icon here.</p>'}`;
}

function iconPickerModal(target, label, def) {
  return new Promise((resolve) => {
    const spec = customIcons()[target] || {};
    const m = openModal(`<header><h2>Icon for ${esc(label)}</h2><button class="icon-btn" data-x aria-label="Close">×</button></header>
      <div class="modal-body">
        <div class="icon-grid" role="listbox" aria-label="Built-in icons">${Object.entries(ICON_LIB).map(([k, [name, svg]]) => `<button type="button" class="icon-opt ${(spec.lib || (!spec.file && def)) === k ? 'on' : ''}" data-lib="${k}" title="${esc(name)}" aria-label="${esc(name)}">
          <svg viewBox="0 0 24 24" aria-hidden="true">${svg}</svg></button>`).join('')}</div>
        <h3 class="net-h">Your own</h3>
        <div class="actions"><label class="btn small">Upload SVG or PNG…<input type="file" accept="image/svg+xml,image/png,image/webp" data-icon-file hidden></label>
          <label class="check"><input type="checkbox" data-icon-tint ${spec.file ? (spec.tint ? 'checked' : '') : 'checked'}> Colour it to match the text (best for single-colour icons)</label></div>
        ${spec.file ? `<p class="small">Using your uploaded icon: ${iconHTML(target, def, 'big-icon')}</p>` : ''}
        <p class="form-error" data-err></p>
      </div>
      <footer>${def || spec.lib || spec.file ? `<button class="btn" data-reset>${def ? 'Back to the original' : 'Remove icon'}</button>` : ''}<button class="btn" data-x>Close</button></footer>`);
    const done = async (body) => {
      try {
        const r = await put('/icons', { target, ...body });
        S.settings.custom_icons = JSON.stringify(r.custom_icons);
        applyNavIcons();
        m.close(); resolve(true);
      } catch (ex) { $('[data-err]', m.el).textContent = ex.message; }
    };
    m.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-lib]');
      if (b) done({ lib: b.dataset.lib });
      if (e.target.closest('[data-reset]')) done({});
      if (e.target.closest('[data-x]')) { m.close(); resolve(false); }
    });
    m.wrap.addEventListener('cancel', () => { m.close(); resolve(false); });
    m.el.addEventListener('change', async (e) => {
      if (e.target.matches('[data-icon-tint]') && spec.file) { done({ tint: e.target.checked }); return; }
      if (!e.target.matches('[data-icon-file]')) return;
      const f = e.target.files[0];
      if (!f) return;
      try {
        let dataUrl;
        if (f.type === 'image/svg+xml' || /\.svg$/i.test(f.name)) {
          const svg = sanitizeSVG((await loadSVGDocument(f)).documentElement);
          if (!svg || svg.nodeName.toLowerCase() !== 'svg') throw new Error('That SVG file couldn’t be read');
          dataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(svg))));
        } else {
          const { img, url } = await loadImage(f);
          dataUrl = squarePNG(img, 128); URL.revokeObjectURL(url);
        }
        done({ data_url: dataUrl, name: f.name, tint: $('[data-icon-tint]', m.el).checked });
      } catch (ex) { $('[data-err]', m.el).textContent = ex.message; }
    });
  });
}

/* ---------------------------------------------------------------- return on investment & day rate */

const ROI_RULE = [0.03, 0.05];  // rough guide: an AV hire day rate is often about 3–5% of the purchase price

function roiNumber(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }

/** All the sums, from the calculator's inputs. Prices are per unit; results are for all units. */
function roiCalc(v) {
  const price = Math.max(0, roiNumber(v.price)), units = Math.max(1, roiNumber(v.units, 1));
  const rate = Math.max(0, roiNumber(v.rate)), days = Math.max(0, roiNumber(v.days));
  const keep = 1 - Math.min(100, Math.max(0, roiNumber(v.disc))) / 100;
  const costPct = Math.max(0, roiNumber(v.costs)) / 100, life = Math.max(0.5, roiNumber(v.life, 5));
  const months = Math.max(1, roiNumber(v.payback, 12));
  const outlay = price * units;
  const revenue = units * rate * days * keep;
  const running = outlay * costPct;
  const profit = revenue - running;
  const paybackMonths = profit > 0 ? (outlay / profit) * 12 : null;
  const lifeProfit = profit * life - outlay;
  const perUnitDay = rate * keep;
  return {
    outlay, revenue, running, profit, paybackMonths, lifeProfit,
    roiPct: outlay > 0 ? (lifeProfit / outlay) * 100 : null,
    // hire days per unit each year to pay for itself (and its running costs) within its life / the target time
    breakEvenDays: perUnitDay > 0 ? (price * (1 + costPct * life)) / (life * perUnitDay) : null,
    targetDays: perUnitDay > 0 ? (price * (1 + costPct * months / 12)) / ((months / 12) * perUnitDay) : null,
    // the day rate that pays it back in the target time at this many hire days
    rateForTarget: days > 0 && keep > 0 ? (price * (1 + costPct * months / 12)) / ((months / 12) * days * keep) : null,
    utilisation: days / 365 * 100,
  };
}

function roiSuggestions(v, benchmark) {
  const c = roiCalc(v);
  const price = roiNumber(v.price);
  const out = [];
  if (c.rateForTarget) {
    out.push({ key: 'target', rate: c.rateForTarget, title: `Pays back in ${num(roiNumber(v.payback, 12))} months`,
      why: `At ${num(roiNumber(v.days))} hire days a year per unit${roiNumber(v.disc) ? `, ${num(roiNumber(v.disc))}% average discount` : ''} and ${num(roiNumber(v.costs))}% a year running costs.` });
  }
  if (benchmark && price > 0) {
    out.push({ key: 'stock', rate: benchmark.ratio * price,
      title: benchmark.scope === 'category' ? `Like your other ${benchmark.category}` : 'Like the rest of your stock',
      why: `Your ${plural(benchmark.count, 'item')} ${benchmark.scope === 'category' ? 'in this category ' : ''}charge a median ${num(+(benchmark.ratio * 100).toFixed(2))}% of their purchase price per day.` });
  }
  if (price > 0) {
    out.push({ key: 'rule', rate: price * (ROI_RULE[0] + ROI_RULE[1]) / 2, range: [price * ROI_RULE[0], price * ROI_RULE[1]],
      title: 'Rule of thumb', why: 'AV hire day rates are often about 3–5% of the purchase price — a starting point, not a rule. Check what others charge locally.' });
  }
  return out;
}

const roiRound = (r) => (r >= 100 ? Math.round(r) : r >= 10 ? Math.round(r * 2) / 2 : Math.round(r * 100) / 100);

/**
 * The calculator, drawn into `el`. opts: { values, history, benchmark, product, onSaveRate(rate), getBenchmark(category) }.
 * It looks after its own events, so it can sit on any page.
 */
function mountRoi(el, opts) {
  const v = { price: '', units: 1, rate: '', days: 40, disc: 0, costs: 5, life: 5, payback: 12, category: '', ...opts.values };
  let benchmark = opts.benchmark || null;
  const h = opts.history;
  const field = (name, label, attrs, help) => `<label class="field third"><span>${label}</span>
      <input type="number" name="${name}" value="${esc(v[name])}" ${attrs}>${help ? `<small>${help}</small>` : ''}</label>`;
  const histHTML = () => {
    if (!h) return '';
    const y = h.year, a = h.all;
    const ahead = h.ahead && h.ahead.jobs ? `<dt>Booked ahead</dt><dd><strong>${money(h.ahead.revenue)}</strong> from ${plural(h.ahead.jobs, 'confirmed job')} not started yet</dd>` : '';
    if (!a.jobs) return `<div class="roi-hist">${ahead ? `<dl class="kv">${ahead}</dl>` : ''}<p class="muted small">No hires have started yet, so there’s no history to go on — the hire days below are a guess to change.</p></div>`;
    const owned = Math.max(1, roiNumber(opts.product && opts.product.quantity, 1));
    const price = roiNumber(opts.product && opts.product.replacement_value);
    return `<div class="roi-hist"><h3>What it’s earned</h3><dl class="kv">
      <dt>Last 12 months</dt><dd><strong>${money(y.revenue)}</strong> from ${plural(y.jobs, 'job')} · ${num(Math.round(y.unit_days))} unit-days out
        <span class="muted">(${num(Math.round(y.unit_days / owned))} days each, ${num(Math.round(100 * y.unit_days / owned / 365))}% of the year)</span></dd>
      <dt>Since ${esc(fmtDate(h.first_hire))}</dt><dd><strong>${money(a.revenue)}</strong> from ${plural(a.jobs, 'job')}${price > 0 ? ` <span class="muted">— ${num(Math.round(100 * a.revenue / (price * owned)))}% of what ${owned > 1 ? `the ${num(owned)} units` : 'it'} cost</span>` : ''}</dd>
      ${ahead}
      ${a.avg_discount_pct != null ? `<dt>Average discount</dt><dd>${num(a.avg_discount_pct)}% off the list rate <span class="muted small">(line and job discounts, and free days)</span></dd>` : ''}
    </dl><p class="muted small">From confirmed, on-hire, returned and invoiced jobs. Package prices count towards the package, not the items in it.</p></div>`;
  };
  el.innerHTML = `<div class="roi">
    ${histHTML()}
    <form class="form-grid roi-inputs" onsubmit="return false">
      ${opts.product ? '' : `<label class="field third"><span>Category</span><input name="category" list="roi-cats" value="${esc(v.category)}" placeholder="e.g. Audio">
        <datalist id="roi-cats">${(opts.categories || []).map((c) => `<option value="${esc(c)}">`).join('')}</datalist><small>To compare with your stock.</small></label>`}
      ${field('price', 'Purchase price (each)', 'min="0" step="0.01"')}
      ${field('units', 'Units', 'min="1" step="1"')}
      ${field('rate', 'Day rate', 'min="0" step="0.01"', 'What you charge per unit per day.')}
      ${field('days', 'Hire days a year (per unit)', 'min="0" max="365" step="1"', h && h.all.jobs >= 3 ? (h.window_days < 365 ? `From its hires since ${esc(fmtDate(h.first_hire))}, scaled to a year.` : 'From the last 12 months.') : h && h.all.jobs ? `Only ${plural(h.all.jobs, 'hire')} so far, so 40 is a guess (about one weekend in six) — change it.` : 'A guess — 40 is about one weekend in six.')}
      ${field('disc', 'Average discount %', 'min="0" max="100" step="0.5"', 'Discounts and free days, on average.')}
      ${field('costs', 'Running costs a year %', 'min="0" max="100" step="0.5"', 'Of the price: servicing, PAT, insurance, repairs.')}
      ${field('life', 'Useful life (years)', 'min="0.5" max="30" step="0.5"')}
      ${field('payback', 'Pay back within (months)', 'min="1" max="120" step="1"', 'Used to suggest a day rate.')}
    </form>
    <div data-roi-out></div></div>`;
  const out = $('[data-roi-out]', el);
  const draw = () => {
    const c = roiCalc(v);
    const good = c.paybackMonths != null && c.paybackMonths <= roiNumber(v.payback, 12);
    const sug = roiSuggestions(v, benchmark);
    out.innerHTML = `<div class="roi-results">
        <div class="roi-stat"><span>Revenue a year</span><strong>${money(c.revenue)}</strong><small>${num(Math.round(c.utilisation))}% of days out</small></div>
        <div class="roi-stat"><span>Profit a year</span><strong>${money(c.profit)}</strong><small>after ${money(c.running)} running costs</small></div>
        <div class="roi-stat ${c.paybackMonths == null ? 'bad' : good ? 'ok' : 'warn'}"><span>Pays for itself in</span><strong>${c.paybackMonths == null ? 'Never' : c.paybackMonths < 24 ? `${num(Math.ceil(c.paybackMonths))} months` : `${num(+(c.paybackMonths / 12).toFixed(1))} years`}</strong><small>${money(c.outlay)} to buy</small></div>
        <div class="roi-stat ${c.roiPct == null ? '' : c.roiPct >= 0 ? 'ok' : 'bad'}"><span>Return over ${num(roiNumber(v.life, 5))} years</span><strong>${c.roiPct == null ? '—' : `${num(Math.round(c.roiPct))}%`}</strong><small>${money(c.lifeProfit)} ${c.lifeProfit >= 0 ? 'profit' : 'loss'}</small></div>
      </div>
      <p class="small roi-break">${c.breakEvenDays != null ? `To pay for itself within its life it needs <strong>${num(Math.ceil(c.breakEvenDays))} hire days a year</strong> per unit; within ${num(roiNumber(v.payback, 12))} months, <strong>${num(Math.ceil(c.targetDays))}</strong>${c.targetDays > 365 ? ' — more days than a year has, so raise the rate or the time' : ''}.` : 'Enter a day rate to see how many hire days it needs.'}</p>
      ${sug.length ? `<h3>Suggested day rate</h3><div class="roi-sugs">${sug.map((x) => `<div class="roi-sug">
          <div><strong>${money(roiRound(x.rate))}</strong>${x.range ? ` <span class="muted small">(${money(roiRound(x.range[0]))}–${money(roiRound(x.range[1]))})</span>` : ''}<br><span class="small">${esc(x.title)}</span>
            <div class="muted small">${esc(x.why)}</div>
            ${x.key === 'target' && roiNumber(v.price) > 0 && x.rate > roiNumber(v.price) * ROI_RULE[1] * 2 ? '<div class="small" style="color:var(--warn)">⚠ Much higher than usual for kit at this price — it may not win work. More hire days or a longer payback is probably more realistic.</div>' : ''}</div>
          <button type="button" class="btn small" data-roi-use="${roiRound(x.rate)}">Use</button></div>`).join('')}</div>` : '<p class="muted small">Enter a purchase price to get day rate suggestions.</p>'}
      ${opts.onSaveRate ? `<div class="actions" style="margin-top:10px"><button type="button" class="btn primary small" data-roi-save ${roiNumber(v.rate) === roiNumber(opts.product.day_rate) ? 'disabled' : ''}>Save ${money(roiNumber(v.rate))} as the day rate</button>
        <span class="muted small">Changes the rate for new quotes; quotes already made keep theirs.</span></div>` : ''}`;
  };
  let catTimer = null;
  el.addEventListener('input', (e) => {
    const n = e.target.name;
    if (!n || !(n in v)) return;
    v[n] = e.target.value;
    if (n === 'category' && opts.getBenchmark) {
      clearTimeout(catTimer);
      catTimer = setTimeout(async () => { benchmark = await opts.getBenchmark(v.category.trim()); draw(); }, 300);
    }
    draw();
  });
  el.addEventListener('click', async (e) => {
    const use = e.target.closest('[data-roi-use]');
    if (use) {
      v.rate = use.dataset.roiUse;
      $('[name="rate"]', el).value = v.rate;
      draw();
      return;
    }
    if (e.target.closest('[data-roi-save]') && opts.onSaveRate) {
      try { await opts.onSaveRate(roiNumber(v.rate)); opts.product.day_rate = roiNumber(v.rate); draw(); } catch (ex) { toast(ex.message, 'error'); }
    }
  });
  draw();
}

/** Values to start the calculator with, for an item in stock. */
function roiStart(p, history) {
  const owned = Math.max(1, roiNumber(p.quantity, 1));
  const y = history && history.year;
  const enough = history && history.all.jobs >= 3;  // one or two hires say little about a whole year
  return {
    price: p.replacement_value || '', units: owned, rate: p.day_rate || '',
    days: enough && y.jobs ? Math.min(365, Math.round(y.unit_days / owned * 365 / (history.window_days || 365))) : 40,
    disc: history && history.all.avg_discount_pct != null ? Math.max(0, Math.round(history.all.avg_discount_pct)) : 0,
  };
}

async function renderRoi(view) {
  const [prods, b] = await Promise.all([get('/products'), get('/roi/benchmark')]);
  const cats = [...new Set(prods.filter((p) => ['equipment', 'power', 'case'].includes(p.item_type)).map((p) => p.category).filter(Boolean))].sort((x, y) => x.localeCompare(y));
  view.innerHTML = `<div class="page">
    <div class="page-head"><div><a class="crumb" href="#/stock">← Stock</a><h1>ROI calculator</h1>
      <div class="sub">Is it worth buying? What should it hire for? For something already in stock, open it and use its <strong>Return on investment</strong> card — it uses its real hire history.</div></div></div>
    <div class="card"><div class="body" data-roi></div></div></div>`;
  mountRoi($('[data-roi]', view), {
    values: { price: '', units: 1, rate: '' }, benchmark: b.benchmark, categories: cats,
    getBenchmark: async (cat) => (await get('/roi/benchmark?category=' + encodeURIComponent(cat))).benchmark,
  });
}

/* ---------------------------------------------------------------- quote & invoice layouts */

const DOC_LAYOUT_DEFAULT = {
  method: 'options', logo_position: 'left', logo_size: 'medium', colour: '', font_size: 'normal',
  title: '', header_text: '', footer_text: '',
  show_company_details: true, show_client_contact: true, show_job: true,
  show_codes: false, show_brand: true, show_rate: true, show_days: true, show_discount: true,
  show_line_totals: true, show_subtotals: true, show_notes: true, show_payment: true, show_terms: true,
  block_order: ['notes', 'payment', 'terms'], html: '',
};
const DOC_BLOCK_LABEL = { notes: 'Job notes', payment: 'Payment details (invoices)', terms: 'Terms' };

function parseLayout(raw) {
  try { const v = JSON.parse(raw || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
/** The layout a quote or invoice uses: the shared one, or the document's own. */
function docLayout(doc, s = S.settings) {
  const own = s.doc_layout_shared === '0' && doc === 'invoice' && (s.doc_layout_invoice || '').trim();
  return { ...DOC_LAYOUT_DEFAULT, ...parseLayout(own ? s.doc_layout_invoice : s.doc_layout_quote) };
}

/** A quote or invoice drawn with the layout options. */
function optionsDocHTML(job, s, doc, L) {
  const c = job.contact;
  const t = job.totals;
  const inv = doc === 'invoice';
  const title = (L.title || '').trim() || (inv ? 'Invoice' : 'Quotation');
  const colour = /^#[0-9a-f]{6}$/i.test(L.colour || '') ? L.colour : (s.brand_primary || '#1f5c3d');
  const details = L.show_company_details
    ? [s.company_address, [s.company_phone, s.company_email].filter(Boolean).join(' · '), s.company_website].filter(Boolean).join('\n') : '';
  const registered = t.vat_registered !== false && s.vat_registered !== '0';
  const head = `<div class="doc-head lp-${L.logo_position}">
      <div class="doc-logo">${s.has_logo ? `<img src="/logo?v=1" alt="${esc(s.company_name)}">` : `<div class="wordmark">${esc(s.company_name)}</div>`}</div>
      <div class="doc-company">${L.logo_position === 'center' && !s.has_logo ? esc(details) : `<strong>${esc(s.company_name)}</strong>${details ? `\n${esc(details)}` : ''}`}</div>
    </div>
    <div class="doc-title"><h1>${esc(title)}</h1>
      <div class="meta">${inv && job.invoice ? `<b>${esc(job.invoice.number)}</b><br>Date: ${esc(fmtDate(job.invoice.date))}<br>Due: ${esc(fmtDate(job.invoice.due))}<br>Job: ${esc(job.number)}${job.invoice.issued ? '' : '<br><span class="no-print muted small">Not issued yet — the date is fixed when it’s downloaded, printed or exported</span>'}`
        : `<b>${esc(job.number)}</b><br>Date: ${esc(fmtDate(todayISO()))}<br>Status: ${esc(STATUS[job.status])}`}${job.reference ? `<br>Your ref: ${esc(job.reference)}` : ''}</div></div>
    ${(L.header_text || '').trim() ? `<div class="doc-block doc-header-text"><p>${esc(L.header_text)}</p></div>` : ''}
    <div class="doc-parties ${L.show_job ? '' : 'one'}">
      <div><h3>${inv ? 'Invoice to' : 'Prepared for'}</h3>
        <p>${c ? `<strong>${esc(c.company || c.name)}</strong>${c.company ? `\n${esc(c.name)}` : ''}${L.show_client_contact && c.address ? `\n${esc(c.address)}` : ''}${L.show_client_contact && c.email ? `\n${esc(c.email)}` : ''}` : '—'}</p></div>
      ${L.show_job ? `<div><h3>Job</h3><p><strong>${esc(job.name)}</strong>${job.venue ? `\n${esc(job.venue)}` : ''}
${esc(fmtRange(job.start_date, job.end_date))}
Hire period: ${plural(job.hire_days || daysBetween(job.start_date, job.end_date) + 1, 'day')}</p></div>` : ''}
    </div>`;

  const anyDisc = L.show_discount && job.items.some((i) => i.discount_pct);
  const hasRental = job.items.some((i) => i.kind === 'rental');
  const showRate = L.show_rate, showDays = L.show_days && hasRental, showTot = L.show_line_totals;
  const cols = 2 + (L.show_codes ? 1 : 0) + (showRate ? 1 : 0) + (showDays ? 1 : 0) + (anyDisc ? 1 : 0) + (showTot ? 1 : 0);
  const desc = (it) => (L.show_brand ? brandedDesc(it) : esc(it.description || ''));
  const cells = (it, k, { included = false, run = false } = {}) => `${L.show_codes ? `<td class="mono small">${run ? '' : esc(it.product_sku || '')}</td>` : ''}<td class="n">${num(it.quantity)}</td>
      ${showRate ? `<td class="n">${run || included ? '' : money(it.unit_price)}</td>` : ''}
      ${showDays ? `<td class="n">${run || included || k !== 'rental' ? '' : num(it.effective_days)}</td>` : ''}
      ${anyDisc ? `<td class="n">${!run && !included && it.discount_pct ? num(it.discount_pct) + '%' : ''}</td>` : ''}
      ${showTot ? `<td class="n">${run ? '' : included ? 'Included' : money(it.line_total)}</td>` : ''}`;
  const sections = ['rental', 'sale', 'service'].map((k) => {
    const showIncl = s.show_included_accessories === '1';
    const its = orderItems(job.items.filter((i) => i.kind === k)).filter((it) => showIncl || !isIncluded(it));
    if (!its.length) return '';
    return `<tr class="grp"><td colspan="${cols}">${KIND_LABEL[k]}</td></tr>` + its.map((it) => isRun(it)
      ? `<tr class="run-row"><td><strong>${esc(it.description)}</strong> <span class="muted">(${isStage(it) ? 'each stage' : 'each'}: ${esc(metaOf(it).summary || '')})</span></td>${cells(it, k, { run: true })}</tr>`
      : isIncluded(it) ? `<tr class="acc"><td><span class="acc-mark">↳</span>${desc(it)}</td>${cells(it, k, { included: true })}</tr>`
        : `<tr class="${it.parent_item_id ? 'acc' : ''}"><td>${it.parent_item_id ? '<span class="acc-mark">↳</span>' : ''}${desc(it)}</td>${cells(it, k)}</tr>`).join('') +
      (L.show_subtotals ? `<tr class="sub"><td colspan="${cols - 1}" class="n">${KIND_LABEL[k]} subtotal</td><td class="n">${money(t[k])}</td></tr>` : '');
  }).join('');
  const blockHTML = {
    notes: L.show_notes && job.notes ? `<div class="doc-block"><h3>Notes</h3><p>${esc(job.notes)}</p></div>` : '',
    payment: L.show_payment && inv && s.payment_details ? `<div class="doc-block"><h3>Payment details</h3><p>${esc(s.payment_details)}</p></div>` : '',
    terms: L.show_terms && (inv ? s.invoice_terms : s.quote_terms) ? `<div class="doc-block"><h3>Terms</h3><p>${esc(inv ? s.invoice_terms : s.quote_terms)}</p></div>` : '',
  };
  const order = Array.isArray(L.block_order) && L.block_order.length === 3 ? L.block_order : DOC_LAYOUT_DEFAULT.block_order;
  return `<div class="doc-layout fs-${esc(L.font_size)} ls-${esc(L.logo_size)}" style="--brand:${colour}">${head}
    <table class="doc-table"><thead><tr><th>Description</th>${L.show_codes ? '<th>Code</th>' : ''}<th class="n">Qty</th>
      ${showRate ? `<th class="n">${hasRental ? 'Rate' : 'Price'}</th>` : ''}${showDays ? '<th class="n">Days</th>' : ''}${anyDisc ? '<th class="n">Disc</th>' : ''}${showTot ? '<th class="n">Total</th>' : ''}</tr></thead>
      <tbody>${sections || `<tr><td colspan="${cols}">No items.</td></tr>`}</tbody></table>
    <div class="doc-totals"><table><tbody>
      ${t.discount ? `<tr><td>Subtotal</td><td>${money(t.gross)}</td></tr><tr><td>Discount (${num(job.discount_pct)}%)</td><td>−${money(t.discount)}</td></tr>` : ''}
      ${registered ? `<tr><td>Net</td><td>${money(t.net)}</td></tr><tr><td>VAT ${num(t.vat_rate)}%</td><td>${money(t.vat)}</td></tr>` : ''}
      <tr class="grand"><td>Total</td><td>${money(t.total)}</td></tr>
    </tbody></table></div>
    ${order.map((b) => blockHTML[b] || '').join('')}
    <div class="doc-foot">${(L.footer_text || '').trim() ? `<div class="doc-foot-text">${esc(L.footer_text)}</div>` : ''}${esc([s.company_name, s.company_number ? `Company no. ${s.company_number}` : '', s.vat_number && registered ? `VAT no. ${s.vat_number}` : ''].filter(Boolean).join(' · '))}</div></div>`;
}

/* ---- HTML templates: {{name}} (escaped), {{{name}}} (as HTML), {{#list}}…{{/list}}, {{^name}}…{{/name}} */

function tplLookup(stack, path) {
  if (path === '.') return stack[stack.length - 1];
  const parts = path.split('.');
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    let v = stack[i];
    if (v == null || typeof v !== 'object' || !(parts[0] in v)) continue;
    for (const k of parts) { v = v == null ? undefined : v[k]; }
    return v;
  }
  return undefined;
}
function renderTemplate(tpl, data) {
  const run = (src, stack) => {
    let out = '', i = 0;
    const re = /\{\{(\{?)\s*([#^/]?)\s*([\w.]+)\s*\}?\}\}/g;
    let m;
    while ((m = re.exec(src))) {
      out += src.slice(i, m.index);
      i = re.lastIndex;
      const [, triple, kind, name] = m;
      if (kind === '#' || kind === '^') {
        // find the matching close tag, allowing the same section to nest
        const open = new RegExp(`\\{\\{\\s*[#^]\\s*${name.replace('.', '\\.')}\\s*\\}\\}|\\{\\{\\s*/\\s*${name.replace('.', '\\.')}\\s*\\}\\}`, 'g');
        open.lastIndex = i;
        let depth = 1, end = -1, after = i, mm;
        while ((mm = open.exec(src))) {
          if (/\{\{\s*\//.test(mm[0])) depth -= 1; else depth += 1;
          if (!depth) { end = mm.index; after = open.lastIndex; break; }
        }
        if (end < 0) throw new Error(`The template has {{${kind}${name}}} without a matching {{/${name}}}`);
        const inner = src.slice(i, end);
        const v = tplLookup(stack, name);
        const truthy = Array.isArray(v) ? v.length > 0 : !!v;
        if (kind === '^') { if (!truthy) out += run(inner, stack); } else if (Array.isArray(v)) out += v.map((x) => run(inner, [...stack, x])).join('');
        else if (truthy) out += run(inner, typeof v === 'object' ? [...stack, v] : stack);
        i = re.lastIndex = after;
      } else if (kind === '/') {
        // a stray close tag: ignore it
      } else {
        const v = tplLookup(stack, name);
        out += v == null ? '' : triple ? String(v) : esc(String(v));
      }
    }
    return out + src.slice(i);
  };
  return run(String(tpl || ''), [data]);
}

/** Everything a template can use. */
function templateData(job, s, doc) {
  const c = job.contact || {};
  const t = job.totals;
  const inv = doc === 'invoice';
  const registered = t.vat_registered !== false && s.vat_registered !== '0';
  const showIncl = s.show_included_accessories === '1';
  const groups = ['rental', 'sale', 'service'].map((k) => {
    const its = orderItems(job.items.filter((i) => i.kind === k)).filter((it) => showIncl || !isIncluded(it));
    return its.length ? {
      label: KIND_LABEL[k], subtotal: money(t[k]),
      items: its.map((it) => ({
        description: it.description || '', brand: it.product_brand || '', code: it.product_sku || '', quantity: num(it.quantity),
        rate: isRun(it) ? '' : money(it.unit_price), days: k === 'rental' && !isRun(it) ? num(it.effective_days) : '',
        discount: it.discount_pct ? `${num(it.discount_pct)}%` : '', total: isRun(it) ? '' : isIncluded(it) ? 'Included' : money(it.line_total),
        is_accessory: !!it.parent_item_id, is_included: isIncluded(it), summary: isRun(it) ? (metaOf(it).summary || '') : '',
      })),
    } : null;
  }).filter(Boolean);
  return {
    doc: { title: inv ? 'Invoice' : 'Quotation', is_invoice: inv, is_quote: !inv,
      number: inv && job.invoice ? job.invoice.number : job.number, date: fmtDate(inv && job.invoice ? job.invoice.date : todayISO()),
      due: inv && job.invoice ? fmtDate(job.invoice.due) : '' },
    company: { name: s.company_name || '', address: s.company_address || '', email: s.company_email || '', phone: s.company_phone || '',
      website: s.company_website || '', number: s.company_number || '', vat_number: registered ? (s.vat_number || '') : '' },
    logo: s.has_logo ? '/logo?v=1' : '', colour: s.brand_primary || '#1f5c3d', accent: s.brand_accent || '#c9a227',
    client: { name: c.name || '', company: c.company || '', display: c.company || c.name || '', address: c.address || '', email: c.email || '', phone: c.phone || '' },
    job: { number: job.number, name: job.name, venue: job.venue || '', reference: job.reference || '', status: STATUS[job.status] || job.status,
      dates: fmtRange(job.start_date, job.end_date), start: fmtDate(job.start_date), end: fmtDate(job.end_date),
      hire_days: num(job.hire_days || daysBetween(job.start_date, job.end_date) + 1), notes: job.notes || '' },
    groups,
    totals: { gross: money(t.gross), discount: t.discount ? money(t.discount) : '', discount_pct: job.discount_pct ? num(job.discount_pct) : '',
      net: money(t.net), vat: money(t.vat), vat_rate: num(t.vat_rate), total: money(t.total), vat_registered: registered },
    payment_details: inv ? (s.payment_details || '') : '', terms: (inv ? s.invoice_terms : s.quote_terms) || '',
  };
}

const DEFAULT_DOC_TEMPLATE = `<style>
  body { font-family: Helvetica, Arial, sans-serif; font-size: 12px; color: #1d1f1e; margin: 0; }
  .page { padding: 16mm 15mm; }
  header { display: flex; justify-content: space-between; border-bottom: 3px solid {{colour}}; padding-bottom: 12px; }
  header img { max-height: 64px; max-width: 220px; }
  .company { text-align: right; white-space: pre-line; font-size: 11px; color: #555; }
  h1 { color: {{colour}}; text-transform: uppercase; letter-spacing: .08em; margin: 20px 0 10px; }
  .parties { display: flex; gap: 40px; margin-bottom: 16px; white-space: pre-line; }
  .parties h3 { font-size: 10px; text-transform: uppercase; color: #777; margin: 0 0 4px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: {{colour}}; color: #fff; text-align: left; padding: 6px 8px; font-size: 10px; text-transform: uppercase; }
  td { padding: 6px 8px; border-bottom: 1px solid #e3e5e2; }
  .n { text-align: right; white-space: nowrap; }
  .grp td { background: #f1f3f0; font-weight: bold; font-size: 10px; text-transform: uppercase; color: #666; }
  .acc td:first-child { padding-left: 24px; color: #555; }
  .totals { width: 260px; margin: 12px 0 18px auto; }
  .totals .grand td { background: {{colour}}; color: #fff; font-weight: bold; font-size: 14px; }
  .block { white-space: pre-line; margin-bottom: 12px; }
  .block h3 { font-size: 10px; text-transform: uppercase; color: #777; margin: 0 0 4px; }
  footer { border-top: 1px solid #ddd; margin-top: 24px; padding-top: 8px; font-size: 10px; color: #777; text-align: center; }
</style>
<div class="page">
  <header>
    <div>{{#logo}}<img src="{{logo}}" alt="{{company.name}}">{{/logo}}{{^logo}}<strong style="font-size:24px;color:{{colour}}">{{company.name}}</strong>{{/logo}}</div>
    <div class="company"><strong>{{company.name}}</strong>
{{company.address}}
{{company.phone}} {{company.email}}</div>
  </header>
  <h1>{{doc.title}} {{doc.number}}</h1>
  <p>Date: {{doc.date}}{{#doc.is_invoice}} · Due: {{doc.due}}{{/doc.is_invoice}}</p>
  <div class="parties">
    <div><h3>{{#doc.is_invoice}}Invoice to{{/doc.is_invoice}}{{^doc.is_invoice}}Prepared for{{/doc.is_invoice}}</h3><strong>{{client.display}}</strong>
{{client.address}}</div>
    <div><h3>Job</h3><strong>{{job.name}}</strong>
{{job.venue}}
{{job.dates}} ({{job.hire_days}} days)</div>
  </div>
  <table>
    <thead><tr><th>Description</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Days</th><th class="n">Total</th></tr></thead>
    <tbody>
    {{#groups}}
      <tr class="grp"><td colspan="5">{{label}}</td></tr>
      {{#items}}<tr class="{{#is_accessory}}acc{{/is_accessory}}"><td>{{#brand}}<b>{{brand}}</b> {{/brand}}{{description}}</td><td class="n">{{quantity}}</td><td class="n">{{rate}}</td><td class="n">{{days}}</td><td class="n">{{total}}</td></tr>{{/items}}
      <tr><td colspan="4" class="n"><b>{{label}} subtotal</b></td><td class="n"><b>{{subtotal}}</b></td></tr>
    {{/groups}}
    </tbody>
  </table>
  <table class="totals">
    {{#totals.discount}}<tr><td>Discount ({{totals.discount_pct}}%)</td><td class="n">−{{totals.discount}}</td></tr>{{/totals.discount}}
    {{#totals.vat_registered}}<tr><td>Net</td><td class="n">{{totals.net}}</td></tr><tr><td>VAT {{totals.vat_rate}}%</td><td class="n">{{totals.vat}}</td></tr>{{/totals.vat_registered}}
    <tr class="grand"><td>Total</td><td class="n">{{totals.total}}</td></tr>
  </table>
  {{#job.notes}}<div class="block"><h3>Notes</h3>{{job.notes}}</div>{{/job.notes}}
  {{#payment_details}}<div class="block"><h3>Payment details</h3>{{payment_details}}</div>{{/payment_details}}
  {{#terms}}<div class="block"><h3>Terms</h3>{{terms}}</div>{{/terms}}
  <footer>{{company.name}}{{#company.number}} · Company no. {{company.number}}{{/company.number}}{{#company.vat_number}} · VAT no. {{company.vat_number}}{{/company.vat_number}}</footer>
</div>`;

const TEMPLATE_HELP = `<details class="tpl-help"><summary>What you can use in a template</summary><div class="small">
  <p><code>{{name}}</code> puts in a value (made safe), <code>{{#name}}…{{/name}}</code> repeats for each item in a list or shows only if it has a value, <code>{{^name}}…{{/name}}</code> shows only when it’s empty. Scripts don’t run.</p>
  <p><b>doc</b>: title, number, date, due, is_invoice, is_quote · <b>company</b>: name, address, email, phone, website, number, vat_number · <b>logo</b> (image address) · <b>colour</b>, <b>accent</b><br>
  <b>client</b>: display, name, company, address, email, phone · <b>job</b>: number, name, venue, reference, status, dates, start, end, hire_days, notes<br>
  <b>groups</b> (Equipment hire / Sales / Labour): label, subtotal, <b>items</b>: description, brand, code, quantity, rate, days, discount, total, summary, is_accessory, is_included<br>
  <b>totals</b>: gross, discount, discount_pct, net, vat, vat_rate, total, vat_registered · <b>payment_details</b> (invoices) · <b>terms</b></p></div></details>`;

/** A full page for a template, shown in a sandboxed frame (nothing in it can run scripts). */
function templatePage(bodies) {
  return `<!doctype html><html><head><meta charset="utf-8"><base href="${esc(location.origin)}/">
    <style>@page { size: A4; margin: 0; } .doc-page { page-break-after: always; break-after: page; } .doc-page:last-child { page-break-after: auto; break-after: auto; }</style></head>
    <body>${bodies.map((b) => `<div class="doc-page">${b}</div>`).join('')}</body></html>`;
}
function templateFrame(html, cls = 'tpl-frame') {
  const f = document.createElement('iframe');
  f.className = cls;
  f.setAttribute('sandbox', 'allow-same-origin allow-modals');  // no allow-scripts: a template can't run code
  f.setAttribute('title', 'Document');
  f.srcdoc = html;
  const fit = () => { try { f.style.height = `${f.contentDocument.documentElement.scrollHeight + 4}px`; } catch { /* ignore */ } };
  f.addEventListener('load', () => { fit(); setTimeout(fit, 300); });
  return f;
}
function printFrame(f) {
  return new Promise((resolve) => {
    const go = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (ex) { toast(ex.message, 'error'); } resolve(); };
    if (f.contentDocument && f.contentDocument.readyState === 'complete' && f.contentDocument.body && f.contentDocument.body.childElementCount) go();
    else f.addEventListener('load', () => setTimeout(go, 150), { once: true });
  });
}
/** Print (or save as PDF) quotes/invoices that use an HTML template, several at once with a page each. */
async function printTemplateDocs(ids, doc, opts = {}) {
  if (doc === 'invoice') await post('/invoices/issue', { ids, mark_invoiced: !!opts.markInvoiced });
  const s = S.settings;
  const jobs = await Promise.all(ids.map((id) => get(`/jobs/${id}`)));
  const L = docLayout(doc, s);
  const html = templatePage(jobs.map((j) => renderTemplate(L.html || DEFAULT_DOC_TEMPLATE, templateData(j, s, doc))));
  const f = templateFrame(html, 'tpl-print-frame');
  document.body.appendChild(f);
  await printFrame(f);
  setTimeout(() => f.remove(), 60000);
}

/** Settings → Customisation → Quote & invoice layout. Edits go into hidden fields, saved by Save settings. */
async function drawLayoutCard(view, s) {
  const card = $('[data-layout-card]', view);
  if (!card) return;
  const state = {
    shared: s.doc_layout_shared !== '0',
    quote: { ...DOC_LAYOUT_DEFAULT, ...parseLayout(s.doc_layout_quote) },
    invoice: { ...DOC_LAYOUT_DEFAULT, ...parseLayout(s.doc_layout_invoice || s.doc_layout_quote) },
    editing: 'quote', previewDoc: 'quote', job: null,
  };
  try {
    const jobs = await get('/jobs');
    const pick = jobs.find((j) => (j.totals || {}).total > 0) || jobs[0];
    if (pick) state.job = await get(`/jobs/${pick.id}`);
  } catch { /* no preview */ }
  const cur = () => state[state.shared ? 'quote' : state.editing];
  const sync = () => {
    $('[name="doc_layout_shared"]', card).value = state.shared ? '1' : '0';
    $('[name="doc_layout_quote"]', card).value = JSON.stringify(state.quote);
    $('[name="doc_layout_invoice"]', card).value = state.shared ? '' : JSON.stringify(state.invoice);
  };
  const chk = (k, label) => `<label class="check"><input type="checkbox" data-lay="${k}" ${cur()[k] ? 'checked' : ''}> ${label}</label>`;
  const sel = (k, label, opts) => `<label class="field third"><span>${label}</span><select data-lay="${k}">${opts.map(([v, l]) => `<option value="${v}" ${cur()[k] === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
  const form = () => {
    const L = cur();
    const order = L.block_order && L.block_order.length === 3 ? L.block_order : DOC_LAYOUT_DEFAULT.block_order;
    return `<div class="seg lay-method" role="group" aria-label="How to lay it out">
        <button type="button" data-lay-method="options" class="${L.method !== 'html' ? 'on' : ''}">Layout options</button>
        <button type="button" data-lay-method="html" class="${L.method === 'html' ? 'on' : ''}">HTML template</button></div>
      ${L.method === 'html' ? `
        <p class="muted small">Write the document in HTML and CSS. Your logo, company, client, items and totals go in with placeholders like <code>{{company.name}}</code>.
          It prints, or saves as a PDF, from your browser’s print window.</p>
        ${TEMPLATE_HELP}
        <textarea class="tpl-edit mono" data-lay-html rows="16" spellcheck="false" aria-label="HTML template">${esc(L.html || DEFAULT_DOC_TEMPLATE)}</textarea>
        <div class="actions"><button type="button" class="btn primary small" data-lay-refresh>Refresh preview</button>
          <button type="button" class="btn small" data-lay-reset-html>Start again from the standard template</button></div>`
      : `<div class="form-grid" style="padding:0">
          ${sel('logo_position', 'Logo', [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']])}
          ${sel('logo_size', 'Logo size', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']])}
          ${sel('font_size', 'Text size', [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large']])}
          <label class="field third"><span>Colour</span><input type="color" data-lay="colour" value="${esc(L.colour || s.brand_primary || '#1f5c3d')}">
            <small><a href="#" data-lay-colour-reset>Use the brand colour</a></small></label>
          <label class="field third"><span>Title</span><input data-lay="title" value="${esc(L.title)}" placeholder="${state.shared ? 'Quotation / Invoice' : state.editing === 'invoice' ? 'Invoice' : 'Quotation'}"></label>
          <label class="field"><span>Text under the title</span><textarea data-lay="header_text" rows="2" placeholder="e.g. Thank you for choosing us.">${esc(L.header_text)}</textarea></label>
          <label class="field"><span>Footer text</span><textarea data-lay="footer_text" rows="2" placeholder="e.g. Registered office: …">${esc(L.footer_text)}</textarea></label>
        </div>
        <h3 class="net-h">Show</h3>
        <div class="lay-checks">${chk('show_company_details', 'Company address and contact details')}${chk('show_client_contact', 'Client’s address and email')}
          ${chk('show_job', 'Job details (name, venue, dates)')}${chk('show_brand', 'Brand before item names')}${chk('show_codes', 'Item codes')}
          ${chk('show_rate', 'Rate')}${chk('show_days', 'Days')}${chk('show_discount', 'Line discounts')}${chk('show_line_totals', 'Line totals')}
          ${chk('show_subtotals', 'Subtotals')}${chk('show_notes', 'Job notes')}${chk('show_payment', 'Payment details (invoices)')}${chk('show_terms', 'Terms')}</div>
        <h3 class="net-h">Order at the bottom</h3>
        <ol class="lay-order">${order.map((b, i) => `<li><span>${DOC_BLOCK_LABEL[b]}</span>
          <button type="button" class="icon-btn" data-lay-up="${i}" ${i ? '' : 'disabled'} aria-label="Move up">↑</button>
          <button type="button" class="icon-btn" data-lay-down="${i}" ${i < 2 ? '' : 'disabled'} aria-label="Move down">↓</button></li>`).join('')}</ol>
        <div class="actions"><button type="button" class="btn small" data-lay-pdf>Preview PDF</button>
          <button type="button" class="btn small" data-lay-reset>Reset to the standard layout</button></div>`}`;
  };
  const preview = () => {
    const box = $('[data-lay-preview]', card);
    if (!state.job) { box.innerHTML = '<p class="muted">Make a job with some items to see a preview here.</p>'; return; }
    const doc = state.shared ? state.previewDoc : state.editing;
    const L = cur();
    const j = { ...state.job, invoice: state.job.invoice || { number: `INV-${state.job.number}`, date: todayISO(), due: todayISO(), issued: false } };
    box.innerHTML = '';
    if (L.method === 'html') {
      try {
        box.appendChild(templateFrame(templatePage([renderTemplate(L.html || DEFAULT_DOC_TEMPLATE, templateData(j, s, doc))]), 'tpl-frame preview'));
      } catch (ex) { box.innerHTML = `<p class="form-error">${esc(ex.message)}</p>`; }
    } else {
      box.innerHTML = `<div class="sheet">${optionsDocHTML(j, s, doc, L)}</div>`;
    }
  };
  const draw = () => {
    card.querySelector('.body').innerHTML = `
      <input type="hidden" name="doc_layout_shared"><input type="hidden" name="doc_layout_quote"><input type="hidden" name="doc_layout_invoice">
      <div class="lay-top">
        <label class="field half"><span>Quotes and invoices</span><select data-lay-shared>
          <option value="1" ${state.shared ? 'selected' : ''}>Share one layout</option><option value="0" ${state.shared ? '' : 'selected'}>Each has its own layout</option></select></label>
        ${state.shared ? `<label class="field half"><span>Preview as</span><select data-lay-preview-doc><option value="quote" ${state.previewDoc === 'quote' ? 'selected' : ''}>Quotation</option><option value="invoice" ${state.previewDoc === 'invoice' ? 'selected' : ''}>Invoice</option></select></label>`
          : `<div class="field half"><span>Editing</span><div class="tabs prefer">${['quote', 'invoice'].map((d) => `<button type="button" data-lay-edit="${d}" class="${state.editing === d ? 'active' : ''}">${d === 'quote' ? 'Quotation' : 'Invoice'}</button>`).join('')}</div></div>`}
      </div>
      <div class="lay-grid"><div class="lay-form">${form()}</div>
        <div class="lay-preview-wrap"><div class="muted small">Preview${state.job ? ` — ${esc(state.job.number)} ${esc(state.job.name)}` : ''}</div><div class="lay-preview" data-lay-preview></div></div></div>
      <p class="muted small" style="margin-bottom:0">Press <strong>Save settings</strong> to keep your changes. The prep list keeps its own layout.</p>`;
    sync();
    preview();
  };
  card.addEventListener('input', (e) => {
    const k = e.target.dataset.lay;
    if (k) {
      cur()[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      sync(); preview();
    } else if (e.target.matches('[data-lay-html]')) { cur().html = e.target.value; sync(); }
  });
  card.addEventListener('change', (e) => {
    if (e.target.matches('[data-lay-shared]')) { state.shared = e.target.value === '1'; if (!state.shared) state.invoice = { ...state.quote }; draw(); }
    if (e.target.matches('[data-lay-preview-doc]')) { state.previewDoc = e.target.value; preview(); }
  });
  card.addEventListener('click', async (e) => {
    const t = e.target;
    const L = cur();
    const ed = t.closest('[data-lay-edit]');
    if (ed) { state.editing = ed.dataset.layEdit; draw(); return; }
    const m = t.closest('[data-lay-method]');
    if (m) { L.method = m.dataset.layMethod; if (L.method === 'html' && !L.html) L.html = DEFAULT_DOC_TEMPLATE; draw(); return; }
    if (t.closest('[data-lay-refresh]')) { preview(); return; }
    if (t.closest('[data-lay-reset-html]')) {
      if (!await confirmModal('Replace your template with the standard one?', { okLabel: 'Replace' })) return;
      L.html = DEFAULT_DOC_TEMPLATE; draw(); return;
    }
    if (t.closest('[data-lay-reset]')) { Object.assign(L, { ...DOC_LAYOUT_DEFAULT, html: L.html }); draw(); return; }
    if (t.closest('[data-lay-colour-reset]')) { e.preventDefault(); L.colour = ''; draw(); return; }
    const up = t.closest('[data-lay-up]'), down = t.closest('[data-lay-down]');
    if (up || down) {
      const order = [...(L.block_order && L.block_order.length === 3 ? L.block_order : DOC_LAYOUT_DEFAULT.block_order)];
      const i = Number((up || down).dataset[up ? 'layUp' : 'layDown']), j = up ? i - 1 : i + 1;
      [order[i], order[j]] = [order[j], order[i]];
      L.block_order = order; draw(); return;
    }
    if (t.closest('[data-lay-pdf]')) {
      if (!state.job) { toast('Make a job first to preview', 'error'); return; }
      const doc = state.shared ? state.previewDoc : state.editing;
      try { await postDownload('/invoices/pdf', { ids: [state.job.id], doc, logo: await logoJpeg(), layout: L }, 'preview.pdf'); } catch (ex) { toast(ex.message, 'error'); }
    }
  });
  draw();
}

/* ---------------------------------------------------------------- printable barcode labels */

// Label stock, in mm. Sheets: page, label size, gaps (pitch) and margins of the common A4 sizes. Rolls: one label per page.
const LABEL_FORMATS = {
  'a4-65': { label: 'A4 sheet, 65 per page — 38.1 × 21.2 mm (e.g. Avery L7651)', w: 38.1, h: 21.2, cols: 5, rows: 13, left: 4.7, top: 10.7, px: 40.6, py: 21.2 },
  'a4-24': { label: 'A4 sheet, 24 per page — 63.5 × 33.9 mm (e.g. Avery L7159)', w: 63.5, h: 33.9, cols: 3, rows: 8, left: 7.2, top: 12.9, px: 66.0, py: 33.9 },
  'a4-21': { label: 'A4 sheet, 21 per page — 63.5 × 38.1 mm (e.g. Avery L7160)', w: 63.5, h: 38.1, cols: 3, rows: 7, left: 7.2, top: 15.1, px: 66.0, py: 38.1 },
  'a4-14': { label: 'A4 sheet, 14 per page — 99.1 × 38.1 mm (e.g. Avery L7163)', w: 99.1, h: 38.1, cols: 2, rows: 7, left: 4.65, top: 15.1, px: 101.6, py: 38.1 },
  'roll-62x29': { label: 'Label printer — 62 × 29 mm (e.g. Brother DK-11209)', w: 62, h: 29, roll: true },
  'roll-50x25': { label: 'Label printer — 50 × 25 mm', w: 50, h: 25, roll: true },
  'roll-57x32': { label: 'Label printer — 57 × 32 mm (e.g. Dymo 11354)', w: 57, h: 32, roll: true },
};
const LABEL_PREF = 'het-label-format';

function labelHTML(l, opts, f) {
  const small = f.h < 25;
  return `<div class="lbl" style="width:${f.w}mm;height:${f.h}mm">
    ${opts.company && S.settings.company_name && !small ? `<div class="co">${esc(S.settings.company_name)}</div>` : ''}
    <div class="bc">${barcodeSVG(l.code)}</div>
    ${opts.name ? `<div class="nm">${esc(l.name)}</div>` : ''}</div>`;
}

/** The label pages, ready to print in a sandboxed frame. */
function labelsPage(labels, format, opts) {
  const f = LABEL_FORMATS[format] || LABEL_FORMATS['a4-65'];
  const css = `* { box-sizing: border-box; } body { margin: 0; font-family: Helvetica, Arial, sans-serif; color: #000; }
    .lbl { overflow: hidden; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1.2mm 2mm; text-align: center; }
    .lbl .bc { width: 100%; flex: 1 1 auto; min-height: 0; display: flex; }
    .lbl .bc svg { width: 100%; height: 100%; }
    .lbl .nm { font-size: ${f.h < 25 ? 5.5 : 7}pt; line-height: 1.25; max-height: 2.6em; overflow: hidden; width: 100%; flex: none; padding-bottom: .3mm; }
    .lbl .co { font-size: 6pt; font-weight: bold; }
    ${f.roll ? `@page { size: ${f.w}mm ${f.h}mm; margin: 0; } .lbl { page-break-after: always; break-after: page; }`
      : `@page { size: A4; margin: 0; } .sheet { position: relative; width: 210mm; height: 297mm; page-break-after: always; break-after: page; }
         .sheet .lbl { position: absolute; }`}`;
  let body = '';
  if (f.roll) {
    body = labels.map((l) => labelHTML(l, opts, f)).join('');
  } else {
    const per = f.cols * f.rows;
    const slots = [...Array(Math.max(0, opts.skip || 0)).fill(null), ...labels];
    for (let i = 0; i < slots.length; i += per) {
      body += `<div class="sheet">${slots.slice(i, i + per).map((l, k) => (l ? `<div style="position:absolute;left:${f.left + (k % f.cols) * f.px}mm;top:${f.top + Math.floor(k / f.cols) * f.py}mm">${labelHTML(l, opts, f)}</div>` : '')).join('')}</div>`;
    }
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`;
}

/** Choose what to print for some stock items, and print it. */
async function labelsModal(productIds) {
  let items = await get(`/barcodes?ids=${productIds.join(',')}`);
  let format = 'a4-65';
  try { format = localStorage.getItem(LABEL_PREF) || format; } catch { /* ignore */ }
  if (!LABEL_FORMATS[format]) format = 'a4-65';
  const multi = items.length > 1;
  const m = openModal(`<header><h2>Print barcodes${multi ? '' : ` — ${esc(items[0] ? items[0].name : '')}`}</h2><button class="icon-btn" data-x aria-label="Close">×</button></header>
    <div class="modal-body" data-lbl-body></div>
    <footer><span class="muted small" data-lbl-count></span><button class="btn" data-x>Cancel</button><button class="btn primary" data-lbl-print>Print labels</button></footer>`, { wide: true });
  const st = { units: true, item: true, copies: 1, name: true, company: false, skip: 0 };
  const list = () => {
    const out = [];
    for (const it of items) {
      const label = [it.brand && !it.name.toLowerCase().startsWith(it.brand.toLowerCase()) ? it.brand : '', it.name].filter(Boolean).join(' ');
      if (st.units) for (const u of it.units) out.push({ code: u, name: label });
      if (st.item && it.sku && (!it.units.length || !st.units)) for (let i = 0; i < st.copies; i += 1) out.push({ code: it.sku, name: label });
    }
    return out;
  };
  const draw = () => {
    const f = LABEL_FORMATS[format];
    const none = items.filter((it) => !it.sku && !it.units.length);
    const hasUnits = items.some((it) => it.units.length);
    $('[data-lbl-body]', m.el).innerHTML = `
      <div class="form-grid" style="padding:0">
        <label class="field"><span>Labels</span><select data-lbl-format>${Object.entries(LABEL_FORMATS).map(([k, x]) => `<option value="${k}" ${k === format ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>
          <small>Print at 100% / “Actual size”, with no margins or headers.</small></label>
        ${hasUnits ? `<label class="check" style="flex-basis:100%"><input type="checkbox" data-lbl="units" ${st.units ? 'checked' : ''}> A label for each unit (its own barcode)</label>` : ''}
        <label class="check"><input type="checkbox" data-lbl="item" ${st.item ? 'checked' : ''}> ${hasUnits ? 'Items with no units: a' : 'A'} label with the item code</label>
        <label class="field third"><span>Copies of each item code</span><input type="number" min="1" max="500" step="1" value="${st.copies}" data-lbl-copies></label>
        ${f.roll ? '' : `<label class="field third"><span>Skip labels already used</span><input type="number" min="0" max="${f.cols * f.rows - 1}" step="1" value="${st.skip}" data-lbl-skip><small>On a part-used sheet.</small></label>`}
        <label class="check"><input type="checkbox" data-lbl="name" ${st.name ? 'checked' : ''}> Item name under the barcode</label>
        <label class="check"><input type="checkbox" data-lbl="company" ${st.company ? 'checked' : ''}> Company name</label>
      </div>
      ${none.length ? `<div class="banner warn" style="margin-top:10px"><span>${none.length === 1 ? `${esc(none[0].name)} has` : `${num(none.length)} items have`} no code or units yet, so ${none.length === 1 ? 'it has' : 'they have'} nothing to print.</span>
        <button type="button" class="btn small" data-lbl-make>Create ${none.length === 1 ? 'a code' : 'codes'}</button></div>` : ''}
      <div class="lbl-preview" data-lbl-preview></div>`;
    const labels = list();
    const per = f.roll ? 1 : f.cols * f.rows;
    $('[data-lbl-count]', m.el).textContent = labels.length ? `${plural(labels.length, 'label')} · ${plural(Math.ceil((labels.length + (f.roll ? 0 : st.skip)) / per), f.roll ? 'label' : 'sheet')}` : 'Nothing to print';
    $('[data-lbl-print]', m.el).disabled = !labels.length;
    $('[data-lbl-preview]', m.el).innerHTML = labels.slice(0, 6).map((l) => `<div class="lbl-sample" style="width:${f.w * 2.2}px;height:${f.h * 2.2}px">${barcodeSVG(l.code)}${st.name ? `<div class="small">${esc(l.name)}</div>` : ''}</div>`).join('')
      + (labels.length > 6 ? `<span class="muted small">+ ${num(labels.length - 6)} more</span>` : '');
  };
  m.el.addEventListener('input', (e) => {
    if (e.target.matches('[data-lbl]')) st[e.target.dataset.lbl] = e.target.checked;
    if (e.target.matches('[data-lbl-copies]')) st.copies = Math.max(1, Math.min(500, Number(e.target.value) || 1));
    if (e.target.matches('[data-lbl-skip]')) st.skip = Math.max(0, Number(e.target.value) || 0);
    if (e.target.matches('[data-lbl-format]')) { format = e.target.value; try { localStorage.setItem(LABEL_PREF, format); } catch { /* ignore */ } draw(); return; }
    if (e.target.matches('[data-lbl], [data-lbl-copies], [data-lbl-skip]')) {
      const keep = e.target.matches('[data-lbl-copies], [data-lbl-skip]') ? e.target : null;
      const pos = keep && keep.selectionStart;
      draw();
      if (keep) { const el = $(`[${keep.matches('[data-lbl-copies]') ? 'data-lbl-copies' : 'data-lbl-skip'}]`, m.el); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { /* number inputs */ } } }
    }
  });
  m.el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-x]')) { m.close(); return; }
    if (e.target.closest('[data-lbl-make]')) {
      try {
        for (const it of items.filter((x) => !x.sku && !x.units.length)) it.sku = (await post(`/products/${it.product_id}/make-code`, {})).sku;
        toast('Codes created — they’re on each item’s page', 'ok');
        draw();
      } catch (ex) { toast(ex.message, 'error'); }
      return;
    }
    if (e.target.closest('[data-lbl-print]')) {
      const f = templateFrame(labelsPage(list(), format, st), 'tpl-print-frame');
      document.body.appendChild(f);
      await printFrame(f);
      setTimeout(() => f.remove(), 60000);
    }
  });
  m.wrap.addEventListener('cancel', () => m.close());
  draw();
}

/* ---------------------------------------------------------------- print */

async function renderPrint(id, doc) {
  const [job, s] = await Promise.all([get(`/jobs/${id}`), get('/settings')]);
  S.settings = s;
  document.body.classList.add('printing');
  const root = $('#print-root');
  const titles = { quote: 'Quotation', invoice: 'Invoice', picklist: 'Prep list', plan: 'Room plan' };
  if (!titles[doc]) doc = 'quote';
  const sw = s.accounting_software;
  const planData = doc === 'plan' ? await get(`/jobs/${id}/plan`) : null;
  // A quote or invoice with an HTML template is shown in a sandboxed frame and printed from there.
  const tpl = (doc === 'quote' || doc === 'invoice') && docLayout(doc, s).method === 'html';
  root.innerHTML = `<div class="print-toolbar">
      <a class="btn small" href="#/job/${job.id}">← Back to job</a>
      <div class="tabs">${Object.entries(titles).map(([k, l]) => `<button data-doc="${k}" class="${k === doc ? 'active' : ''}">${l}</button>`).join('')}</div>
      <span class="spacer"></span>
      ${(doc === 'quote' || doc === 'invoice') && !tpl ? `<button class="btn small" data-pdf>Download PDF</button>` : '<span style="opacity:.8;font-size:12px">Use “Save to PDF” in the print dialog to email it.</span>'}
      ${doc === 'invoice' ? `<button class="btn small" data-acc>${sw ? `Export for ${esc(ACCOUNTING[sw].label)}` : 'Export for accounts…'}</button>` : ''}
      <button class="btn accent" data-print>Print</button>
    </div>
    <div class="sheet ${tpl ? 'tpl-sheet' : ''}">${tpl ? '' : docHTML(job, s, doc, titles[doc] || 'Quotation', planData)}</div>`;
  let frame = null;
  if (tpl) {
    try {
      frame = templateFrame(templatePage([renderTemplate(docLayout(doc, s).html || DEFAULT_DOC_TEMPLATE, templateData(job, s, doc))]));
      $('.sheet', root).appendChild(frame);
    } catch (ex) { $('.sheet', root).innerHTML = `<p class="form-error">The HTML template has a problem: ${esc(ex.message)}. Fix it in Settings → Customisation → Quote &amp; invoice layout.</p>`; }
  }
  root.onclick = (e) => {
    const d = e.target.closest('[data-doc]');
    if (d) { location.hash = `#/print/${job.id}/${d.dataset.doc}`; return; }
    if (e.target.closest('[data-print]')) {
      if (!frame) { window.print(); return; }
      (doc === 'invoice' && !job.invoice.issued ? post('/invoices/issue', { ids: [job.id] }) : Promise.resolve())
        .then(() => printFrame(frame)).then(() => { if (doc === 'invoice' && !job.invoice.issued) renderPrint(id, doc); })
        .catch((ex) => toast(ex.message, 'error'));
      return;
    }
    const pb = e.target.closest('[data-pdf]');
    if (pb) {
      pb.disabled = true;
      downloadPdf([job.id], doc).then(() => { toast('PDF downloaded', 'ok'); if (doc === 'invoice' && !job.invoice.issued) renderPrint(id, doc); })
        .catch((ex) => toast(ex.message, 'error')).finally(() => { pb.disabled = false; });
    }
    if (e.target.closest('[data-acc]')) {
      if (sw) exportAccounts([job.id], sw).then(() => { toast(`Exported for ${ACCOUNTING[sw].label}`, 'ok'); renderPrint(id, doc); }).catch((ex) => toast(ex.message, 'error'));
      else invoicesModal([job.id]);
    }
  };
  document.title = `${titles[doc]} ${job.number} - ${job.name}`;
}

function planDocBody(data) {
  if (!data || !data.plan || !data.plan.rooms.length) return '<div class="doc-block"><p>No room plan yet. Open the job and choose <strong>Room plan</strong> to draw one.</p></div>';
  return data.plan.rooms.map((r) => {
    const counts = {};
    for (const o of r.objects) counts[o.label] = (counts[o.label] || 0) + 1;
    return `<div class="doc-block doc-plan"><h3>${esc(r.name)} <span class="muted">· ${num(r.w)} × ${num(r.d)} m, ceiling ${num(r.h || 4)} m</span></h3>
      <div class="doc-plan-svg">${topSVG(r)}</div>
      <div class="doc-plan-svg">${stageSVGView(r)}</div>
      ${Object.keys(counts).length ? `<p class="small">${Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])).map(([l, n]) => `${num(n)} × ${esc(l)} <span class="muted">(${esc(planAbbr(l))})</span>`).join(' · ')}</p>` : ''}</div>`;
  }).join('') + (data.updated_at ? `<p class="muted small">Plan last changed ${esc(fmtDate(data.updated_at.slice(0, 10)))} ${esc(data.updated_at.slice(11, 16))}${data.updated_by ? ` by ${esc(data.updated_by)}` : ''}.</p>` : '');
}

/** A line's description for quotes and invoices, with its brand in front (unless it already starts with it). */
function brandedDesc(it) {
  const b = (it.product_brand || '').trim();
  const d = it.description || '';
  return b && !d.toLowerCase().startsWith(b.toLowerCase()) ? `<span class="doc-brand">${esc(b)}</span> ${esc(d)}` : esc(d);
}

function docHTML(job, s, doc, title, planData) {
  if (doc === 'quote' || doc === 'invoice') return optionsDocHTML(job, s, doc, docLayout(doc, s));
  const c = job.contact;
  const t = job.totals;
  const company = [s.company_address, [s.company_phone, s.company_email].filter(Boolean).join(' · '), s.company_website].filter(Boolean).join('\n');
  const head = `<div class="doc-head">
      <div class="doc-logo">${s.has_logo ? `<img src="/logo?v=1" alt="${esc(s.company_name)}">` : `<div class="wordmark">${esc(s.company_name)}</div>`}</div>
      <div class="doc-company"><strong>${esc(s.company_name)}</strong>\n${esc(company)}</div>
    </div>
    <div class="doc-title"><h1>${esc(title)}</h1>
      <div class="meta">${doc === 'invoice' && job.invoice ? `<b>${esc(job.invoice.number)}</b><br>Date: ${esc(fmtDate(job.invoice.date))}<br>Due: ${esc(fmtDate(job.invoice.due))}<br>Job: ${esc(job.number)}${job.invoice.issued ? '' : '<br><span class="no-print muted small">Not issued yet — the date is fixed when it’s downloaded or exported</span>'}`
        : `<b>${esc(job.number)}</b><br>${doc === 'picklist' ? 'Printed' : 'Date'}: ${esc(fmtDate(todayISO()))}${doc === 'quote' ? `<br>Status: ${esc(STATUS[job.status])}` : ''}`}</div></div>
    <div class="doc-parties">
      <div><h3>${doc === 'invoice' ? 'Invoice to' : doc === 'picklist' ? 'Client' : 'Prepared for'}</h3>
        <p>${c ? `<strong>${esc(c.company || c.name)}</strong>${c.company ? `\n${esc(c.name)}` : ''}${c.address ? `\n${esc(c.address)}` : ''}${c.email ? `\n${esc(c.email)}` : ''}${doc === 'picklist' && c.phone ? `\n${esc(c.phone)}` : ''}` : '—'}</p></div>
      <div><h3>Job</h3><p><strong>${esc(job.name)}</strong>${job.venue ? `\n${esc(job.venue)}` : ''}
${esc(fmtRange(job.start_date, job.end_date))}
Hire period: ${plural(job.hire_days || daysBetween(job.start_date, job.end_date) + 1, 'day')} · back by ${esc(fmtDate(job.end_date))}${job.reference ? `\nYour ref: ${esc(job.reference)}` : ''}</p></div>
    </div>${doc === 'picklist' && job.overdue ? `<div class="doc-overdue">OVERDUE — due back ${esc(fmtDate(job.due_back))}, ${plural(job.days_late, 'day')} late</div>` : ''}`;

  if (doc === 'plan') return head + planDocBody(planData);
  if (doc === 'picklist') {
    const items = job.items.filter((i) => i.kind !== 'service');
    const ids = new Set(items.map((i) => i.id));
    const kids = {};
    for (const it of items) if (it.parent_item_id && ids.has(it.parent_item_id)) (kids[it.parent_item_id] ||= []).push(it);
    const groups = {};
    const secs = job.sections || [];
    for (const it of items) {
      if (it.parent_item_id && ids.has(it.parent_item_id)) continue;
      const key = secs.length ? `s${it.effective_section_id || 0}` : (isRun(it) ? (isStage(it) ? 'Staging' : 'Cable runs') : catLabel(it) || (it.kind === 'sale' ? 'Sales / consumables' : 'Other'));
      (groups[key] ||= []).push(it);
    }
    const line = (it, child, depth = child ? 1 : 0) => `<tr class="${child ? 'acc' : ''}"><td class="n">${child ? num(it.quantity) : `<strong>${num(it.quantity)}</strong>`}</td>
      <td style="padding-left:${8 + Math.max(0, depth - 1) * 14}px">${child ? '<span class="acc-mark">↳</span>' : ''}${esc(it.description)}${it.product_sub_hire ? ` <span class="doc-sub">SUB-HIRE${it.vendor_name ? ` · ${esc(it.vendor_name)}` : ''}</span>` : ''}${!it.product_sub_hire && it.sub_qty > 0 ? ` <span class="doc-sub">${num(Math.min(it.sub_qty, it.quantity))} SUB-HIRED${it.sub_vendor_name ? ` · ${esc(it.sub_vendor_name)}` : ''}</span>` : ''}${isRun(it) ? `<br><span class="muted small">${isStage(it) ? 'each stage' : 'each run'}: ${esc(metaOf(it).summary || '')}</span>` : ''}</td>
      <td class="mono">${esc(it.product_sku || '')}</td><td class="box"><span></span></td><td class="box"><span></span></td></tr>`;
    const tree = (it, d) => line(it, d > 0, d) + (kids[it.id] || []).map((k) => tree(k, d + 1)).join('');
    const block = (g) => (groups[g] || []).map((it) => tree(it, 0)).join('');
    let rows;
    if (secs.length) {
      const secHead = (sc, lvl) => `<tr class="${lvl ? 'subsec' : 'sec'}"><td colspan="5"><div class="doc-sec"><span>${esc(sc.name)}</span>${sc.power && sc.power.has_data ? `<span class="doc-sec-power">⚡ ${esc(powerText(sc.power))}</span>` : ''}</div>${sc.notes ? `<div class="doc-sec-notes">${esc(sc.notes)}</div>` : ''}</td></tr>`;
      rows = (groups.s0 ? `<tr class="sec"><td colspan="5"><div class="doc-sec"><span>General</span></div></td></tr>` + block('s0') : '');
      for (const top of secs.filter((x) => !x.parent_id)) {
        rows += secHead(top, 0) + block('s' + top.id);
        for (const sb of secs.filter((x) => x.parent_id === top.id)) rows += secHead(sb, 1) + block('s' + sb.id);
      }
    } else {
      rows = Object.keys(groups).sort().map((g) => `<tr class="grp"><td colspan="5">${esc(g)}</td></tr>` + block(g)).join('');
    }
    // Totals to pull: the same item can appear under several parents (e.g. XLRs).
    let totals = '';
    if (Object.keys(kids).length) {
      const agg = {};
      for (const it of items) {
        if (isRun(it)) continue;
        const key = it.product_id ? 'p' + it.product_id : 'd' + it.description;
        const a = (agg[key] ||= { qty: 0, name: it.product_name || it.description, sku: it.product_sku || '', cat: it.product_category || 'Other' });
        a.qty += Number(it.quantity) || 0;
      }
      const list = Object.values(agg).sort((a, b) => a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name));
      let last = null;
      totals = `<div class="doc-block" style="margin-top:18px"><h3>Totals to pull (including accessories)</h3></div>
        <table class="doc-table"><thead><tr><th class="n" style="width:50px">Qty</th><th>Item</th><th>Code</th><th class="box">Pulled</th></tr></thead><tbody>
        ${list.map((a) => { let r = ''; if (a.cat !== last) { r = `<tr class="grp"><td colspan="4">${esc(a.cat)}</td></tr>`; last = a.cat; }
          return r + `<tr><td class="n"><strong>${num(a.qty)}</strong></td><td>${esc(a.name)}</td><td class="mono">${esc(a.sku)}</td><td class="box"><span></span></td></tr>`; }).join('')}
        </tbody></table>`;
    }
    const stages = items.filter(isStage);
    const plans = stages.length ? `<div class="doc-block doc-stage-head"><h3>Stage plans</h3></div>
      ${stages.map((st) => {
        const sm = metaOf(st);
        const pulls = items.filter((x) => x.parent_item_id === st.id);
        const nClamp = sm.clamps && sm.clamps.points ? sm.clamps.points.length : 0;
        return `<figure class="doc-stage">
          <figcaption><strong>${esc(st.description)}</strong>${st.quantity > 1 ? ` × ${num(st.quantity)}` : ''}
            <span>${esc(sm.summary || '')}${st.quantity > 1 ? ' — each stage' : ''}</span></figcaption>
          <div class="doc-stage-body">${stageSVG(sm, { px: 560 })}
            <div class="doc-stage-info">
              <table class="doc-table"><thead><tr><th class="n">Qty</th><th>For this stage${st.quantity > 1 ? `s (${num(st.quantity)})` : ''}</th><th class="box">Out</th></tr></thead><tbody>
                ${pulls.map((k) => `<tr><td class="n"><strong>${num(k.quantity)}</strong></td><td>${esc(k.product_name || k.description)}</td><td class="box"><span></span></td></tr>`).join('')}
              </tbody></table>
              <p>${nClamp ? `<strong>${num(nClamp)}</strong> clamp${nClamp === 1 ? '' : 's'} per stage — fit one at each numbered red dot (1–${num(nClamp)}).` : 'No clamps placed.'}</p>
              ${sm.skirts && sm.skirts.per_side ? `<p><strong>Skirt ${num(sm.skirts.perimeter)} m</strong> (gold sides)${skirtDesc(sm.skirts.filter) ? `<br>${esc(skirtDesc(sm.skirts.filter))}` : ''}<br>${sm.skirts.per_side.map((x) => `${SIDE_LABEL[x.side]} ${num(x.length)}m: ${x.pieces.map((pc) => `${pc.count > 1 ? `${num(pc.count)} × ` : ''}${num(pc.length)}m`).join(' + ')}`).join('<br>')}</p>` : '<p>No skirts.</p>'}
            </div></div></figure>`;
      }).join('')}` : '';
    return head + `<table class="doc-table"><thead><tr><th class="n" style="width:50px">Qty</th><th>Item</th><th>Code</th><th class="box">Out</th><th class="box">Back</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">No equipment on this job.</td></tr>'}</tbody></table>
      ${(job.sub_hires || []).length ? `<div class="doc-block" style="margin-top:18px"><h3>Sub-hire — order in</h3>
        <table class="doc-table"><thead><tr><th class="n" style="width:50px">Qty</th><th>Item</th><th>From</th><th class="box">In</th><th class="box">Back</th></tr></thead><tbody>
        ${job.sub_hires.map((v) => v.items.map((x) => `<tr><td class="n"><strong>${num(x.quantity)}</strong></td><td>${esc(x.name)}</td><td>${esc(v.vendor_name || '—')}</td><td class="box"><span></span></td><td class="box"><span></span></td></tr>`).join('')).join('')}
        </tbody></table></div>` : ''}
      ${plans}
      ${totals}
      <div class="doc-block"><p><strong>Total weight:</strong> ${num(job.total_weight_kg)} kg${(job.cases || []).some((c) => !c.on_job) ? (() => {
        const extra = job.cases.filter((c) => !c.on_job).reduce((a, c) => a + c.empty_kg, 0);
        return ` + ${kg(extra)} of flight cases = <strong>${kg(job.total_weight_kg + extra)}</strong>`;
      })() : ''}</p></div>
      ${job.power && job.power.has_data ? `<div class="doc-block doc-power"><h3>Power — whole sheet</h3>
        ${(job.sections || []).some((x) => x.power.has_data) ? `<table class="doc-table"><tbody>${job.sections.map((sc) => `<tr><td>${sc.parent_id ? '<span class="acc-mark">↳</span>' : '<strong>'}${esc(sc.name)}${sc.parent_id ? '' : '</strong>'}</td><td class="n">${sc.power.watts ? `${num(sc.power.watts)} W · ${num(sc.power.amps)} A` : '—'}</td></tr>`).join('')}</tbody></table>` : ''}
        <p><strong>Total ≈ ${num(job.power.watts)} W (${num(job.power.amps)} A)</strong> — needs ${job.power.supplies_needed} × ${esc(job.power.supply.label)} at ${job.power.safe_pct}% load.
        Sockets: ${num(job.power.sockets_needed)} needed, ${num(job.power.sockets_have)} packed${job.power.sockets_short ? ` — ${num(job.power.sockets_short)} SHORT` : ''}.</p></div>` : ''}
      ${job.internal_notes ? `<div class="doc-block"><h3>Crew notes</h3><p>${esc(job.internal_notes)}</p></div>` : ''}
      ${job.notes ? `<div class="doc-block"><h3>Job notes</h3><p>${esc(job.notes)}</p></div>` : ''}
      <div class="doc-sign"><div>Prepped by</div><div>Checked out</div><div>Returned &amp; checked</div></div>
      ${(job.cases || []).length ? `<div class="doc-block doc-cases" style="margin-top:18px"><h3>Flight cases <span class="muted">· ${plural(job.cases.length, 'case')} · ${kg(job.cases.reduce((a, c) => a + c.total_kg, 0))} packed</span></h3>
        ${job.cases.map((c) => `<div class="doc-case"><table class="doc-table"><thead><tr><th colspan="2">${c.label ? `<strong>${esc(c.label)}</strong> · ` : ''}${esc(c.name)} <span class="mono">${esc(c.code)}</span>${c.room ? ` · Room: <strong>${esc(c.room)}</strong>` : ''}</th>
          <th class="n" style="width:150px">${kg(c.total_kg)} <span style="font-weight:400">(case ${kg(c.empty_kg)})</span></th></tr></thead><tbody>
          ${c.items.map((i) => `<tr><td class="n" style="width:50px"><strong>${num(i.quantity)}</strong></td><td>${esc(i.name)}${i.assets.length ? ` <span class="mono muted small">${i.assets.map((a) => esc(a.asset_number)).join(', ')}</span>` : ''}</td><td class="n">${i.weight_kg ? kg(i.weight_kg) : ''}</td></tr>`).join('')}
          </tbody></table></div>`).join('')}</div>` : ''}`;
  }

  const anyDisc = job.items.some((i) => i.discount_pct);
  const hasRental = job.items.some((i) => i.kind === 'rental');
  const cols = 4 + (hasRental ? 1 : 0) + (anyDisc ? 1 : 0);
  const sections = ['rental', 'sale', 'service'].map((k) => {
    const showIncl = s.show_included_accessories === '1';
    const its = orderItems(job.items.filter((i) => i.kind === k)).filter((it) => showIncl || !isIncluded(it));
    if (!its.length) return '';
    return `<tr class="grp"><td colspan="${cols}">${KIND_LABEL[k]}</td></tr>` + its.map((it) => isRun(it) ? `<tr class="run-row">
      <td><strong>${esc(it.description)}</strong> <span class="muted">(${isStage(it) ? 'each stage' : 'each'}: ${esc(metaOf(it).summary || '')})</span></td><td class="n">${num(it.quantity)}</td><td class="n"></td>
      ${hasRental ? '<td class="n"></td>' : ''}${anyDisc ? '<td class="n"></td>' : ''}<td class="n"></td></tr>` : isIncluded(it) ? `<tr class="acc">
      <td><span class="acc-mark">↳</span>${brandedDesc(it)}</td><td class="n">${num(it.quantity)}</td><td class="n"></td>
      ${hasRental ? '<td class="n"></td>' : ''}${anyDisc ? '<td class="n"></td>' : ''}<td class="n">Included</td></tr>` : `<tr class="${it.parent_item_id ? 'acc' : ''}">
      <td>${it.parent_item_id ? '<span class="acc-mark">↳</span>' : ''}${brandedDesc(it)}</td><td class="n">${num(it.quantity)}</td><td class="n">${money(it.unit_price)}</td>
      ${hasRental ? `<td class="n">${k === 'rental' ? num(it.effective_days) : ''}</td>` : ''}
      ${anyDisc ? `<td class="n">${it.discount_pct ? num(it.discount_pct) + '%' : ''}</td>` : ''}
      <td class="n">${money(it.line_total)}</td></tr>`).join('') +
      `<tr class="sub"><td colspan="${cols - 1}" class="n">${KIND_LABEL[k]} subtotal</td><td class="n">${money(t[k])}</td></tr>`;
  }).join('');

  return head + `<table class="doc-table"><thead><tr><th>Description</th><th class="n">Qty</th><th class="n">${hasRental ? 'Rate' : 'Price'}</th>
      ${hasRental ? '<th class="n">Days</th>' : ''}${anyDisc ? '<th class="n">Disc</th>' : ''}<th class="n">Total</th></tr></thead>
      <tbody>${sections || `<tr><td colspan="${cols}">No items.</td></tr>`}</tbody></table>
    <div class="doc-totals"><table><tbody>
      ${t.discount ? `<tr><td>Subtotal</td><td>${money(t.gross)}</td></tr><tr><td>Discount (${num(job.discount_pct)}%)</td><td>−${money(t.discount)}</td></tr>` : ''}
      ${t.vat_registered === false ? '' : `<tr><td>Net</td><td>${money(t.net)}</td></tr>
      <tr><td>VAT ${num(t.vat_rate)}%</td><td>${money(t.vat)}</td></tr>`}
      <tr class="grand"><td>Total</td><td>${money(t.total)}</td></tr>
    </tbody></table></div>
    ${job.notes ? `<div class="doc-block"><h3>Notes</h3><p>${esc(job.notes)}</p></div>` : ''}
    ${doc === 'invoice' && s.payment_details ? `<div class="doc-block"><h3>Payment details</h3><p>${esc(s.payment_details)}</p></div>` : ''}
    ${(doc === 'invoice' ? s.invoice_terms : s.quote_terms) ? `<div class="doc-block"><h3>Terms</h3><p>${esc(doc === 'invoice' ? s.invoice_terms : s.quote_terms)}</p></div>` : ''}
    <div class="doc-foot">${esc([s.company_name, s.company_number ? `Company no. ${s.company_number}` : '', s.vat_number && s.vat_registered !== '0' ? `VAT no. ${s.vat_number}` : ''].filter(Boolean).join(' · '))}</div>`;
}

/* ---- colour pickers: a hex box next to every one, kept in step both ways */
const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
function normHex(v) {
  const m = String(v || '').trim().match(HEX_RE);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return '#' + h.toLowerCase();
}
function addHexBox(inp) {
  if (inp.dataset.hexed) return;
  inp.dataset.hexed = '1';
  const hx = document.createElement('input');
  hx.type = 'text';
  hx.className = 'hex-input';
  hx.value = inp.value;
  hx.maxLength = 7;
  hx.spellcheck = false;
  hx.autocomplete = 'off';
  hx.placeholder = '#1f5c3d';
  hx.disabled = inp.disabled;
  hx.title = 'Hex colour code, e.g. #1f5c3d';
  hx.setAttribute('aria-label', 'Hex colour code');
  inp.after(hx);
  const fromPicker = () => { hx.value = inp.value; hx.classList.remove('bad'); };
  inp.addEventListener('input', fromPicker);
  inp.addEventListener('change', fromPicker);
  hx.addEventListener('input', (e) => {
    e.stopPropagation(); // only the colour picker itself reports changes
    const h = normHex(hx.value);
    hx.classList.toggle('bad', !h && hx.value.trim() !== '');
    if (h && h !== inp.value) { inp.value = h; inp.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  hx.addEventListener('change', (e) => {
    e.stopPropagation();
    const h = normHex(hx.value);
    if (h) { hx.value = h; inp.dispatchEvent(new Event('change', { bubbles: true })); } else { hx.value = inp.value; hx.classList.remove('bad'); }
  });
  hx.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); hx.blur(); } });
  hx.addEventListener('focus', () => { if (normHex(hx.value) !== inp.value) hx.value = inp.value; hx.select(); });
  hx.addEventListener('click', (e) => e.preventDefault()); // don't let a surrounding label open the picker
}
function watchColourPickers() {
  const run = () => document.querySelectorAll('input[type="color"]:not([data-hexed])').forEach(addHexBox);
  run();
  new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
}

/* ---------------------------------------------------------------- boot */

async function boot() {
  watchColourPickers();
  try {
    [S.meta, S.settings] = await Promise.all([get('/meta'), get('/settings')]);
  } catch (e) {
    $('#view').innerHTML = `<div class="page"><div class="card"><div class="body"><h2>Can't start</h2><p>${esc(e.message)}</p></div></div></div>`;
    return;
  }
  applyBrand();
  $('#theme-toggle').onclick = cycleTheme;
  $('#version').innerHTML = `<a href="#/changelog" title="What’s changed">Version ${esc(S.meta.version)}</a>${appName() === DEFAULT_APP_NAME ? ' · Horan AV' : ''}`;
  if (S.meta.user || S.meta.remote) {
    $('#version').insertAdjacentHTML('beforebegin', `<div class="whoami">${S.meta.user ? `<strong>${esc(S.meta.user.name)}</strong>${S.meta.user.is_admin ? ' <span class="muted">· admin</span>' : ''}<br>` : ''}
      ${S.meta.remote ? `<span title="Connected over the network">⇄ ${esc(S.meta.server_name)}</span> · ` : ''}<a href="#" id="sign-out">${S.meta.user ? 'Switch user' : 'Sign out'}</a></div>`);
    $('#sign-out').onclick = async (e) => { e.preventDefault(); await post('/logout'); location.reload(); };
  }
  $('#nav-new-job').onclick = () => newJob();
  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); router(); });
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || $('#modal-root').children.length;
    if (!typing && e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); newJob(); }
  });
  router();
  // "Print barcodes" buttons anywhere: data-print-labels="id,id,…"
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-print-labels]');
    if (!b || !b.dataset.printLabels) return;
    e.preventDefault(); e.stopPropagation();
    labelsModal(b.dataset.printLabels.split(',').map(Number).filter(Boolean)).catch((ex) => toast(ex.message, 'error'));
  }, true);
  if (S.meta.is_admin && S.meta.can_update) offerScheduledUpdate();
  try {
    const upd = sessionStorage.getItem('het-updated');
    if (upd) { sessionStorage.removeItem('het-updated'); toast(/^[0-9.]+$/.test(upd) ? `Now running version ${upd}` : upd, 'ok'); }
  } catch { /* storage unavailable */ }
}

boot();
