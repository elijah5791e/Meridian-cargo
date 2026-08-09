const STATUS_ORDER = ['Label created', 'Picked up', 'In transit', 'Arrived at hub', 'Out for delivery', 'Delivered'];
let allPkgsCache = [];
let lastCreatedPkg = null;
let contentRowCount = 0;

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}
function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function fmtDate(isoOrDateStr) {
  if (!isoOrDateStr) return null;
  const d = isoOrDateStr.length <= 10 ? new Date(isoOrDateStr + 'T00:00:00') : new Date(isoOrDateStr);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function statusBadgeClass(status) {
  if (status === 'Delivered') return 'st-delivered';
  if (status === 'Exception') return 'st-exception';
  return 'st-transit';
}
async function api(url, opts) {
  const res = await fetch(url, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  let body = null;
  try { body = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    const err = new Error((body && body.error) || 'Request failed');
    err.status = res.status;
    throw err;
  }
  return body;
}

/* ---------------- auth gate ---------------- */

async function initShipView() {
  const gateWrap = document.getElementById('gateWrap');
  const adminWrap = document.getElementById('adminWrap');

  let session = { isAdmin: false };
  try { session = await api('/api/admin/session'); } catch (err) { /* logged out */ }

  if (session.isAdmin) {
    gateWrap.style.display = 'none';
    adminWrap.style.display = 'block';
    loadShipments();
    return;
  }

  adminWrap.style.display = 'none';
  gateWrap.style.display = 'block';
  gateWrap.innerHTML = `
    <div class="gate">
      <p class="panel-title">Admin access</p>
      <p class="desc">Enter the Ship manager password to create shipments and post updates.</p>
      <form id="loginForm">
        <div class="field">
          <label for="loginpass">Password</label>
          <input type="password" id="loginpass" required placeholder="Enter password">
        </div>
        <button type="submit" class="btn-primary">Unlock</button>
        <p class="gate-error" id="gateError">That password isn't right — try again.</p>
      </form>
    </div>`;
  document.getElementById('loginForm').addEventListener('submit', handleLogin);
}

async function handleLogin(e) {
  e.preventDefault();
  const password = document.getElementById('loginpass').value;
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
    initShipView();
  } catch (err) {
    document.getElementById('gateError').classList.add('show');
  } finally {
    btn.disabled = false;
  }
}

async function handleLogout() {
  try { await api('/api/admin/logout', { method: 'POST' }); } catch (err) { /* ignore */ }
  initShipView();
}

/* ---------------- create form: contents rows ---------------- */

function addContentRow(value) {
  contentRowCount++;
  const id = 'content-row-' + contentRowCount;
  const wrap = document.createElement('div');
  wrap.className = 'contents-row';
  wrap.id = id;
  wrap.innerHTML = `
    <input type="text" placeholder="e.g. 1 box — electronics" value="${escapeHtml(value || '')}">
    <button type="button" class="remove-item" onclick="document.getElementById('${id}').remove()">×</button>
  `;
  document.getElementById('contentsList').appendChild(wrap);
}

function getContentsValues(containerId) {
  return Array.from(document.getElementById(containerId).querySelectorAll('input'))
    .map(i => i.value.trim())
    .filter(Boolean);
}

function onTnModeChange() {
  const mode = document.querySelector('input[name="tnMode"]:checked').value;
  document.getElementById('c-custom-tn').style.display = mode === 'custom' ? '' : 'none';
}

addContentRow();

/* ---------------- create ---------------- */

document.getElementById('createForm').addEventListener('submit', handleCreate);

async function handleCreate(e) {
  e.preventDefault();
  const tnMode = document.querySelector('input[name="tnMode"]:checked').value;
  const payload = {
    senderName: document.getElementById('c-sender-name').value.trim(),
    senderAddress: document.getElementById('c-sender-address').value.trim(),
    senderPhone: document.getElementById('c-sender-phone').value.trim(),
    senderEmail: document.getElementById('c-sender-email').value.trim(),
    recipientName: document.getElementById('c-recipient-name').value.trim(),
    recipientAddress: document.getElementById('c-recipient-address').value.trim(),
    recipientPhone: document.getElementById('c-recipient-phone').value.trim(),
    recipientEmail: document.getElementById('c-email').value.trim(),
    origin: document.getElementById('c-origin').value.trim(),
    destination: document.getElementById('c-destination').value.trim(),
    serviceLevel: document.getElementById('c-service').value,
    weight: document.getElementById('c-weight').value.trim(),
    shippedAt: document.getElementById('c-shipped').value,
    estimatedDelivery: document.getElementById('c-eta').value,
    contents: getContentsValues('contentsList')
  };
  if (tnMode === 'custom') {
    payload.customTrackingNumber = document.getElementById('c-custom-tn').value.trim();
  }
  if (!payload.senderName || !payload.recipientName || !payload.origin || !payload.destination) return;

  const submitBtn = e.target.querySelector('button[type=submit]');
  submitBtn.disabled = true;
  try {
    const pkg = await api('/api/shipments', { method: 'POST', body: JSON.stringify(payload) });
    lastCreatedPkg = pkg;
    document.getElementById('createdNum').textContent = pkg.trackingNumber;
    document.getElementById('createdFlag').classList.add('show');
    e.target.reset();
    document.getElementById('contentsList').innerHTML = '';
    addContentRow();
    onTnModeChange();
    loadShipments();
  } catch (err) {
    alert(err.message || "Couldn't create the shipment — please try again.");
  } finally {
    submitBtn.disabled = false;
  }
}

function copyCreatedNumber() {
  if (!lastCreatedPkg) return;
  const btn = document.getElementById('copyCreatedBtn');
  const original = btn.textContent;
  const done = () => { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = original; }, 1600); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(lastCreatedPkg.trackingNumber).then(done).catch(() => fallbackCopy(lastCreatedPkg.trackingNumber, done));
  } else {
    fallbackCopy(lastCreatedPkg.trackingNumber, done);
  }
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
  document.body.removeChild(ta);
}
function downloadCreatedReceipt() {
  if (!lastCreatedPkg) return;
  saveReceipt(lastCreatedPkg, document.getElementById('receiptCreatedBtn'));
}

/* ---------------- list + filters ---------------- */

async function loadShipments() {
  const listEl = document.getElementById('shipList');
  listEl.innerHTML = '<div class="empty-list">Loading shipments…</div>';
  try { allPkgsCache = await api('/api/shipments'); } catch (err) { allPkgsCache = []; }
  renderStats();
  renderShipList();
}

function renderStats() {
  const total = allPkgsCache.length;
  const delivered = allPkgsCache.filter(p => p.status === 'Delivered').length;
  const exceptions = allPkgsCache.filter(p => p.status === 'Exception').length;
  const active = total - delivered - exceptions;
  document.getElementById('statGrid').innerHTML = `
    <div class="stat-card"><div class="snum">${total}</div><div class="slbl">Total shipments</div></div>
    <div class="stat-card c-amber"><div class="snum">${active}</div><div class="slbl">Active</div></div>
    <div class="stat-card c-green"><div class="snum">${delivered}</div><div class="slbl">Delivered</div></div>
    <div class="stat-card c-red"><div class="snum">${exceptions}</div><div class="slbl">Exceptions</div></div>
  `;
}

function renderShipList() {
  const listEl = document.getElementById('shipList');
  const q = (document.getElementById('searchBox').value || '').trim().toLowerCase();
  const statusFilter = document.getElementById('statusFilter').value;
  const sortOrder = document.getElementById('sortOrder').value;

  let pkgs = [...allPkgsCache];
  if (q) {
    pkgs = pkgs.filter(p =>
      (p.trackingNumber || '').toLowerCase().includes(q) ||
      (p.recipientName || '').toLowerCase().includes(q) ||
      (p.recipientEmail || '').toLowerCase().includes(q) ||
      (p.senderName || '').toLowerCase().includes(q) ||
      (p.destination || '').toLowerCase().includes(q) ||
      (p.origin || '').toLowerCase().includes(q)
    );
  }
  if (statusFilter === 'active') {
    pkgs = pkgs.filter(p => p.status !== 'Delivered' && p.status !== 'Exception');
  } else if (statusFilter !== 'all') {
    pkgs = pkgs.filter(p => p.status === statusFilter);
  }
  pkgs.sort((a, b) => sortOrder === 'newest' ? new Date(b.createdAt) - new Date(a.createdAt) : new Date(a.createdAt) - new Date(b.createdAt));

  if (!pkgs.length) {
    listEl.innerHTML = `<div class="empty-list">${allPkgsCache.length ? 'No shipments match your filters.' : 'No shipments yet — create one on the left.'}</div>`;
    return;
  }

  listEl.innerHTML = '';
  pkgs.forEach(pkg => {
    const row = document.createElement('div');
    row.className = 'ship-row';
    row.id = 'row-' + pkg.trackingNumber;
    const eta = fmtDate(pkg.estimatedDelivery);
    row.innerHTML = `
      <div class="ship-row-top" onclick="toggleRow('${pkg.trackingNumber}')">
        <div>
          <div class="ship-row-num">${escapeHtml(pkg.trackingNumber)}</div>
          <div class="ship-row-sub">${escapeHtml(pkg.senderName)} → ${escapeHtml(pkg.recipientName)} · ${escapeHtml(pkg.origin)} → ${escapeHtml(pkg.destination)}${eta ? ' · ETA ' + eta : ''}</div>
        </div>
        <div class="ship-row-badges">
          ${pkg.serviceLevel ? `<span class="badge-service">${escapeHtml(pkg.serviceLevel)}</span>` : ''}
          <span class="status-badge ${statusBadgeClass(pkg.status)}"><span class="dot"></span>${escapeHtml(pkg.status)}</span>
        </div>
      </div>
      <div class="ship-row-detail" id="detail-${pkg.trackingNumber}"></div>
    `;
    listEl.appendChild(row);
  });
}

function toggleRow(tn) {
  const row = document.getElementById('row-' + tn);
  const wasExpanded = row.classList.contains('expanded');
  document.querySelectorAll('.ship-row.expanded').forEach(r => r.classList.remove('expanded'));
  if (wasExpanded) return;
  row.classList.add('expanded');
  renderRowDetail(tn);
}

async function renderRowDetail(tn) {
  const detailEl = document.getElementById('detail-' + tn);
  detailEl.innerHTML = '<div class="empty-list">Loading…</div>';
  let pkg;
  try { pkg = await api('/api/track/' + encodeURIComponent(tn)); } catch (err) { pkg = null; }
  if (!pkg) { detailEl.innerHTML = '<div class="empty-list">Couldn\'t load this shipment.</div>'; return; }

  const history = [...pkg.history].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const miniTl = history.map(h => `
    <div class="mini-tl-item">
      <div class="mdot"></div>
      <div>${escapeHtml(h.status)}${h.location ? ' — ' + escapeHtml(h.location) : ''}</div>
      <div class="mini-tl-time">${fmtDateTime(h.timestamp)}</div>
    </div>`).join('');

  const statusOptions = [...STATUS_ORDER, 'Exception'].map(s => `<option value="${s}">${s}</option>`).join('');
  const contents = Array.isArray(pkg.contents) ? pkg.contents : (pkg.description ? [pkg.description] : []);
  const contentsRowsHtml = (contents.length ? contents : ['']).map((c, i) => `
    <div class="edit-contents-row" id="edit-content-${tn}-${i}">
      <input type="text" value="${escapeHtml(c)}" placeholder="e.g. 1 box — electronics">
      <button type="button" class="remove-item" onclick="document.getElementById('edit-content-${tn}-${i}').remove()">×</button>
    </div>`).join('');

  detailEl.innerHTML = `
    <div class="mini-tl">${miniTl}</div>
    <form class="update-form" id="updateForm-${tn}">
      <div class="field">
        <label>New status</label>
        <select name="status">${statusOptions}</select>
      </div>
      <div class="field">
        <label>Location</label>
        <input type="text" name="location" placeholder="Kano hub">
      </div>
      <div class="field" style="flex:2;min-width:180px;">
        <label>Note (optional)</label>
        <input type="text" name="note" placeholder="Departed facility">
      </div>
      <button type="submit" class="btn-primary" style="width:auto;">Post update</button>
    </form>
    <div class="row-actions">
      <button type="button" class="icon-btn" onclick="copyRowNumber('${tn}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
        Copy tracking #
      </button>
      <button type="button" class="icon-btn" onclick='downloadRowReceipt(${JSON.stringify(tn)})'>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>
        Save receipt
      </button>
      <button type="button" class="btn-secondary" onclick="toggleEditForm('${tn}')">Edit details</button>
      <button type="button" class="btn-danger" onclick="handleDelete('${tn}')">Delete shipment</button>
    </div>
    <div class="edit-form" id="editform-${tn}">
      <form id="editForm-${tn}">
        <div class="field-row" style="margin-bottom:10px;">
          <div class="field"><label>Sender</label><input type="text" name="senderName" value="${escapeHtml(pkg.senderName || '')}"></div>
          <div class="field"><label>Sender address</label><input type="text" name="senderAddress" value="${escapeHtml(pkg.senderAddress || '')}"></div>
        </div>
        <div class="field-row" style="margin-bottom:10px;">
          <div class="field"><label>Sender phone</label><input type="tel" name="senderPhone" value="${escapeHtml(pkg.senderPhone || '')}"></div>
          <div class="field"><label>Sender email</label><input type="email" name="senderEmail" value="${escapeHtml(pkg.senderEmail || '')}"></div>
        </div>
        <div class="field-row" style="margin-bottom:10px;">
          <div class="field"><label>Recipient</label><input type="text" name="recipientName" value="${escapeHtml(pkg.recipientName || '')}"></div>
          <div class="field"><label>Recipient address</label><input type="text" name="recipientAddress" value="${escapeHtml(pkg.recipientAddress || '')}"></div>
        </div>
        <div class="field-row" style="margin-bottom:10px;">
          <div class="field"><label>Recipient phone</label><input type="tel" name="recipientPhone" value="${escapeHtml(pkg.recipientPhone || '')}"></div>
          <div class="field"><label>Recipient email</label><input type="email" name="recipientEmail" value="${escapeHtml(pkg.recipientEmail || '')}"></div>
        </div>
        <div class="field-row" style="margin-bottom:10px;">
          <div class="field"><label>Origin</label><input type="text" name="origin" value="${escapeHtml(pkg.origin || '')}"></div>
          <div class="field"><label>Destination</label><input type="text" name="destination" value="${escapeHtml(pkg.destination || '')}"></div>
        </div>
        <div class="field-row" style="margin-bottom:10px;">
          <div class="field"><label>Estimated delivery</label><input type="date" name="estimatedDelivery" value="${escapeHtml(pkg.estimatedDelivery || '')}"></div>
          <div class="field"><label>Weight</label><input type="text" name="weight" value="${escapeHtml(pkg.weight || '')}"></div>
        </div>
        <div class="field">
          <label>Contents</label>
          <div id="editContentsList-${tn}">${contentsRowsHtml}</div>
          <button type="button" class="btn-add-item" onclick="addEditContentRow('${tn}')">+ Add item</button>
        </div>
        <button type="submit" class="btn-primary" style="width:auto;margin-top:14px;">Save changes</button>
      </form>
    </div>
  `;

  document.getElementById('updateForm-' + tn).addEventListener('submit', (e) => handleAddUpdate(e, tn));
  document.getElementById('editForm-' + tn).addEventListener('submit', (e) => handleEditSave(e, tn));
}

let editRowCounters = {};
function addEditContentRow(tn) {
  editRowCounters[tn] = (editRowCounters[tn] || 0) + 1;
  const id = `edit-content-${tn}-new-${editRowCounters[tn]}`;
  const wrap = document.createElement('div');
  wrap.className = 'edit-contents-row';
  wrap.id = id;
  wrap.innerHTML = `
    <input type="text" placeholder="e.g. 1 box — electronics">
    <button type="button" class="remove-item" onclick="document.getElementById('${id}').remove()">×</button>
  `;
  document.getElementById('editContentsList-' + tn).appendChild(wrap);
}

function toggleEditForm(tn) {
  document.getElementById('editform-' + tn).classList.toggle('show');
}

function copyRowNumber(tn) {
  const done = () => {};
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(tn).catch(() => fallbackCopy(tn, done));
  } else {
    fallbackCopy(tn, done);
  }
}

async function downloadRowReceipt(tn) {
  let pkg;
  try { pkg = await api('/api/track/' + encodeURIComponent(tn)); } catch (err) { return; }
  if (pkg) saveReceipt(pkg, null);
}

async function handleEditSave(e, tn) {
  e.preventDefault();
  const form = e.target;
  const contentsValues = Array.from(document.getElementById('editContentsList-' + tn).querySelectorAll('input'))
    .map(i => i.value.trim()).filter(Boolean);
  const payload = {
    senderName: form.senderName.value.trim(),
    senderAddress: form.senderAddress.value.trim(),
    senderPhone: form.senderPhone.value.trim(),
    senderEmail: form.senderEmail.value.trim(),
    recipientName: form.recipientName.value.trim(),
    recipientAddress: form.recipientAddress.value.trim(),
    recipientPhone: form.recipientPhone.value.trim(),
    recipientEmail: form.recipientEmail.value.trim(),
    weight: form.weight.value.trim(),
    origin: form.origin.value.trim(),
    destination: form.destination.value.trim(),
    estimatedDelivery: form.estimatedDelivery.value,
    contents: contentsValues
  };
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await api('/api/shipments/' + encodeURIComponent(tn), { method: 'PATCH', body: JSON.stringify(payload) });
    await loadShipments();
    const row = document.getElementById('row-' + tn);
    if (row) { row.classList.add('expanded'); renderRowDetail(tn); }
  } catch (err) {
    alert(err.message || "Couldn't save changes — please try again.");
  } finally {
    btn.disabled = false;
  }
}

async function handleDelete(tn) {
  if (!confirm(`Delete shipment ${tn}? This can't be undone.`)) return;
  try {
    await api('/api/shipments/' + encodeURIComponent(tn), { method: 'DELETE' });
    loadShipments();
  } catch (err) {
    alert(err.message || "Couldn't delete the shipment — please try again.");
  }
}

async function handleAddUpdate(e, tn) {
  e.preventDefault();
  const form = e.target;
  const payload = {
    status: form.status.value,
    location: form.location.value.trim(),
    note: form.note.value.trim()
  };
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await api('/api/shipments/' + encodeURIComponent(tn) + '/events', { method: 'POST', body: JSON.stringify(payload) });
    await loadShipments();
    const row = document.getElementById('row-' + tn);
    if (row) { row.classList.add('expanded'); renderRowDetail(tn); }
  } catch (err) {
    alert(err.message || "Couldn't post the update — please try again.");
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('searchBox').addEventListener('input', renderShipList);
document.getElementById('statusFilter').addEventListener('change', renderShipList);
document.getElementById('sortOrder').addEventListener('change', renderShipList);

initShipView();
