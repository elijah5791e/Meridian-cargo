const STATUS_ORDER = ['Label created', 'Picked up', 'In transit', 'Arrived at hub', 'Out for delivery', 'Delivered'];
let adminChecked = false;
let adminIsLoggedIn = false;
let allPkgsCache = [];
let lookupMode = 'tn';

/* ---------------- helpers ---------------- */

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

/* ---------------- nav ---------------- */

function switchView(v) {
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  document.getElementById('view-track').classList.toggle('active', v === 'track');
  document.getElementById('view-ship').classList.toggle('active', v === 'ship');
  if (v === 'ship') initShipView();
}

function setLookupMode(mode) {
  lookupMode = mode;
  document.getElementById('toggleTn').classList.toggle('active', mode === 'tn');
  document.getElementById('toggleEmail').classList.toggle('active', mode === 'email');
  document.getElementById('trackingInput').style.display = mode === 'tn' ? '' : 'none';
  document.getElementById('emailInput').style.display = mode === 'email' ? '' : 'none';
  document.getElementById('trackResult').innerHTML = '';
}

/* ---------------- recent (in-memory only) ---------------- */

function pushRecent(tn) {
  window.__recent = window.__recent || [];
  if (!window.__recent.includes(tn)) {
    window.__recent.unshift(tn);
    window.__recent = window.__recent.slice(0, 3);
  }
  renderRecentHint();
}
function renderRecentHint() {
  const el = document.getElementById('recentHint');
  const list = window.__recent || [];
  if (!list.length) { el.innerHTML = ''; return; }
  el.innerHTML = 'Recently viewed: ' + list.map(tn => `<button type="button" onclick="quickTrack('${tn}')">${tn}</button>`).join(' · ');
}
function quickTrack(tn) {
  setLookupMode('tn');
  document.getElementById('trackingInput').value = tn;
  runTrackByNumber(tn);
}

/* ---------------- TRACK ---------------- */

document.getElementById('trackForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (lookupMode === 'tn') {
    const tn = document.getElementById('trackingInput').value.trim().toUpperCase();
    if (tn) runTrackByNumber(tn);
  } else {
    const email = document.getElementById('emailInput').value.trim().toLowerCase();
    if (email) runTrackByEmail(email);
  }
});

async function runTrackByNumber(tn) {
  const resultEl = document.getElementById('trackResult');
  resultEl.innerHTML = '<div class="not-found"><p style="color:var(--text-faint);font-size:13.5px;">Searching…</p></div>';
  let pkg = null;
  try {
    pkg = await api('/api/track/' + encodeURIComponent(tn));
  } catch (err) { pkg = null; }
  if (!pkg) {
    resultEl.innerHTML = `
      <div class="not-found">
        <div class="stamp">Not found</div>
        <p>We couldn't find a shipment with tracking number <strong style="color:var(--text);font-family:'JetBrains Mono',monospace;">${escapeHtml(tn)}</strong>. Double-check the number on your receipt and try again.</p>
      </div>`;
    return;
  }
  pushRecent(tn);
  renderResult(pkg);
}

async function runTrackByEmail(email) {
  const resultEl = document.getElementById('trackResult');
  resultEl.innerHTML = '<div class="not-found"><p style="color:var(--text-faint);font-size:13.5px;">Searching…</p></div>';
  let matches = [];
  try {
    matches = await api('/api/track-by-email/' + encodeURIComponent(email));
  } catch (err) { matches = []; }
  if (!matches.length) {
    resultEl.innerHTML = `
      <div class="not-found">
        <div class="stamp">No shipments</div>
        <p>We couldn't find any shipments for <strong style="color:var(--text);">${escapeHtml(email)}</strong>. Check the email address and try again.</p>
      </div>`;
    return;
  }
  resultEl.innerHTML = `<div class="email-results">${matches.map(p => `
    <div class="email-result-row" onclick="quickTrack('${p.trackingNumber}')">
      <div>
        <div class="email-result-num">${escapeHtml(p.trackingNumber)}</div>
        <div class="email-result-sub">${escapeHtml(p.origin)} → ${escapeHtml(p.destination)}</div>
      </div>
      <span class="status-badge ${statusBadgeClass(p.status)}"><span class="dot"></span>${escapeHtml(p.status)}</span>
    </div>`).join('')}</div>`;
}

function renderResult(pkg) {
  const resultEl = document.getElementById('trackResult');
  const history = [...pkg.history].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const badgeClass = statusBadgeClass(pkg.status);
  const isException = pkg.status === 'Exception';
  const stepIdx = STATUS_ORDER.indexOf(pkg.status);

  let progressHtml;
  if (isException) {
    progressHtml = `<div class="exception-banner">This shipment has a delivery exception — see the note in the route history below.</div>`;
  } else {
    progressHtml = `<div class="progress-steps">${STATUS_ORDER.map((s, i) => {
      const cls = i < stepIdx ? 'done' : (i === stepIdx ? 'current' : '');
      return `<div class="pstep ${cls}"><div class="bar"></div><div class="pdot"></div><div class="plabel">${s}</div></div>`;
    }).join('')}</div>`;
  }
  const etaStr = fmtDate(pkg.estimatedDelivery);
  const etaHtml = (etaStr && !isException && pkg.status !== 'Delivered') ? `<div class="eta-row">Estimated delivery: <strong>${etaStr}</strong></div>` : '';

  const timelineHtml = history.map((h, i) => {
    const isCurrent = i === 0;
    const isExc = h.status === 'Exception';
    return `
      <div class="tl-item ${isCurrent ? 'current' : 'past'}">
        <div class="rail">
          <div class="node ${isExc ? 'exception' : (isCurrent ? '' : 'past')}"></div>
          <div class="stem"></div>
        </div>
        <div class="content">
          <p class="tl-status">${escapeHtml(h.status)}</p>
          <div class="tl-meta">${escapeHtml(h.location || '')}${h.location ? ' · ' : ''}${fmtDateTime(h.timestamp)}</div>
          ${h.note ? `<p class="tl-note">${escapeHtml(h.note)}</p>` : ''}
        </div>
      </div>`;
  }).join('');

  resultEl.innerHTML = `
    <div class="waybill">
      <div class="waybill-head">
        <div>
          <p class="waybill-num-label">Tracking number</p>
          <p class="waybill-num">${escapeHtml(pkg.trackingNumber)}</p>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;">
          <span class="status-badge ${badgeClass}"><span class="dot"></span>${escapeHtml(pkg.status)}</span>
          ${pkg.serviceLevel ? `<span class="badge-service">${escapeHtml(pkg.serviceLevel)}</span>` : ''}
        </div>
      </div>
      <div class="parties-row">
        <div class="party">
          <p class="lbl">From</p>
          <p class="name">${escapeHtml(pkg.senderName || '—')}</p>
          ${pkg.senderAddress ? `<p class="addr">${escapeHtml(pkg.senderAddress)}</p>` : ''}
        </div>
        <div class="party">
          <p class="lbl">To</p>
          <p class="name">${escapeHtml(pkg.recipientName || '—')}</p>
          ${pkg.recipientAddress ? `<p class="addr">${escapeHtml(pkg.recipientAddress)}</p>` : ''}
        </div>
      </div>
      <div class="route-row">
        <div class="route-pt"><p class="lbl">Origin</p><p class="val">${escapeHtml(pkg.origin)}</p></div>
        <div class="route-line"></div>
        <div class="route-pt" style="text-align:right;"><p class="lbl">Destination</p><p class="val">${escapeHtml(pkg.destination)}</p></div>
      </div>
      <div class="meta-row">
        <div><p class="lbl">Shipped</p>${fmtDateTime(pkg.shippedAt)}</div>
        ${pkg.weight ? `<div><p class="lbl">Weight</p>${escapeHtml(pkg.weight)}</div>` : ''}
        ${pkg.description ? `<div><p class="lbl">Contents</p>${escapeHtml(pkg.description)}</div>` : ''}
      </div>
      <div class="progress-wrap">
        ${progressHtml}
        ${etaHtml}
      </div>
      <div class="timeline">
        <p class="timeline-title">Route history</p>
        ${timelineHtml}
      </div>
    </div>`;
}

/* ---------------- SHIP MANAGER: auth gate ---------------- */

async function initShipView() {
  const gateWrap = document.getElementById('gateWrap');
  const adminWrap = document.getElementById('adminWrap');

  let session = { isAdmin: false };
  try { session = await api('/api/admin/session'); } catch (err) { /* treat as logged out */ }
  adminIsLoggedIn = !!session.isAdmin;

  if (adminIsLoggedIn) {
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

/* ---------------- SHIP MANAGER: create ---------------- */

document.getElementById('createForm').addEventListener('submit', handleCreate);

async function handleCreate(e) {
  e.preventDefault();
  const payload = {
    senderName: document.getElementById('c-sender-name').value.trim(),
    senderAddress: document.getElementById('c-sender-address').value.trim(),
    recipientName: document.getElementById('c-recipient-name').value.trim(),
    recipientAddress: document.getElementById('c-recipient-address').value.trim(),
    recipientEmail: document.getElementById('c-email').value.trim(),
    origin: document.getElementById('c-origin').value.trim(),
    destination: document.getElementById('c-destination').value.trim(),
    serviceLevel: document.getElementById('c-service').value,
    weight: document.getElementById('c-weight').value.trim(),
    shippedAt: document.getElementById('c-shipped').value,
    estimatedDelivery: document.getElementById('c-eta').value,
    description: document.getElementById('c-description').value.trim()
  };
  if (!payload.senderName || !payload.recipientName || !payload.origin || !payload.destination) return;

  const submitBtn = e.target.querySelector('button[type=submit]');
  submitBtn.disabled = true;
  try {
    const pkg = await api('/api/shipments', { method: 'POST', body: JSON.stringify(payload) });
    document.getElementById('createdNum').textContent = pkg.trackingNumber;
    document.getElementById('createdFlag').classList.add('show');
    e.target.reset();
    loadShipments();
  } catch (err) {
    alert(err.message || "Couldn't create the shipment — please try again.");
  } finally {
    submitBtn.disabled = false;
  }
}

/* ---------------- SHIP MANAGER: list + filters ---------------- */

async function loadShipments() {
  const listEl = document.getElementById('shipList');
  listEl.innerHTML = '<div class="empty-list">Loading shipments…</div>';
  try {
    allPkgsCache = await api('/api/shipments');
  } catch (err) {
    allPkgsCache = [];
  }
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
  try {
    pkg = await api('/api/track/' + encodeURIComponent(tn));
  } catch (err) { pkg = null; }
  if (!pkg) { detailEl.innerHTML = '<div class="empty-list">Couldn\'t load this shipment.</div>'; return; }

  const history = [...pkg.history].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const miniTl = history.map(h => `
    <div class="mini-tl-item">
      <div class="mdot"></div>
      <div>${escapeHtml(h.status)}${h.location ? ' — ' + escapeHtml(h.location) : ''}</div>
      <div class="mini-tl-time">${fmtDateTime(h.timestamp)}</div>
    </div>`).join('');

  const statusOptions = [...STATUS_ORDER, 'Exception'].map(s => `<option value="${s}">${s}</option>`).join('');

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
          <div class="field"><label>Recipient</label><input type="text" name="recipientName" value="${escapeHtml(pkg.recipientName || '')}"></div>
          <div class="field"><label>Recipient address</label><input type="text" name="recipientAddress" value="${escapeHtml(pkg.recipientAddress || '')}"></div>
        </div>
        <div class="field-row" style="margin-bottom:10px;">
          <div class="field"><label>Email</label><input type="email" name="recipientEmail" value="${escapeHtml(pkg.recipientEmail || '')}"></div>
          <div class="field"><label>Weight</label><input type="text" name="weight" value="${escapeHtml(pkg.weight || '')}"></div>
        </div>
        <div class="field-row" style="margin-bottom:10px;">
          <div class="field"><label>Origin</label><input type="text" name="origin" value="${escapeHtml(pkg.origin || '')}"></div>
          <div class="field"><label>Destination</label><input type="text" name="destination" value="${escapeHtml(pkg.destination || '')}"></div>
        </div>
        <div class="field-row" style="margin-bottom:10px;">
          <div class="field"><label>Estimated delivery</label><input type="date" name="estimatedDelivery" value="${escapeHtml(pkg.estimatedDelivery || '')}"></div>
          <div class="field"><label>Contents</label><input type="text" name="description" value="${escapeHtml(pkg.description || '')}"></div>
        </div>
        <button type="submit" class="btn-primary" style="width:auto;">Save changes</button>
      </form>
    </div>
  `;

  document.getElementById('updateForm-' + tn).addEventListener('submit', (e) => handleAddUpdate(e, tn));
  document.getElementById('editForm-' + tn).addEventListener('submit', (e) => handleEditSave(e, tn));
}

function toggleEditForm(tn) {
  document.getElementById('editform-' + tn).classList.toggle('show');
}

async function handleEditSave(e, tn) {
  e.preventDefault();
  const form = e.target;
  const payload = {
    senderName: form.senderName.value.trim(),
    senderAddress: form.senderAddress.value.trim(),
    recipientName: form.recipientName.value.trim(),
    recipientAddress: form.recipientAddress.value.trim(),
    recipientEmail: form.recipientEmail.value.trim(),
    weight: form.weight.value.trim(),
    origin: form.origin.value.trim(),
    destination: form.destination.value.trim(),
    estimatedDelivery: form.estimatedDelivery.value,
    description: form.description.value.trim()
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

document.getElementById('searchBox') && document.getElementById('searchBox').addEventListener('input', renderShipList);
document.getElementById('statusFilter') && document.getElementById('statusFilter').addEventListener('change', renderShipList);
document.getElementById('sortOrder') && document.getElementById('sortOrder').addEventListener('change', renderShipList);

renderRecentHint();
