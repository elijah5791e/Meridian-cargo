const STATUS_ORDER = ['Label created', 'Picked up', 'In transit', 'Arrived at hub', 'Out for delivery', 'Delivered'];
let lookupMode = 'tn';
let lastTrackedPkg = null;

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

function setLookupMode(mode) {
  lookupMode = mode;
  document.getElementById('toggleTn').classList.toggle('active', mode === 'tn');
  document.getElementById('toggleEmail').classList.toggle('active', mode === 'email');
  document.getElementById('trackingInput').style.display = mode === 'tn' ? '' : 'none';
  document.getElementById('emailInput').style.display = mode === 'email' ? '' : 'none';
  document.getElementById('trackResult').innerHTML = '';
}

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
  try { pkg = await api('/api/track/' + encodeURIComponent(tn)); } catch (err) { pkg = null; }
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
  try { matches = await api('/api/track-by-email/' + encodeURIComponent(email)); } catch (err) { matches = []; }
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

function copyTrackingNumber() {
  const pkg = lastTrackedPkg;
  if (!pkg) return;
  const btn = document.getElementById('copyTnBtn');
  const done = () => {
    if (!btn) return;
    const original = btn.innerHTML;
    btn.innerHTML = 'Copied!';
    setTimeout(() => { btn.innerHTML = original; }, 1600);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(pkg.trackingNumber).then(done).catch(() => fallbackCopy(pkg.trackingNumber, done));
  } else {
    fallbackCopy(pkg.trackingNumber, done);
  }
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
  document.body.removeChild(ta);
}

function saveTrackedReceipt() {
  if (!lastTrackedPkg) return;
  saveReceipt(lastTrackedPkg, document.getElementById('receiptBtn'));
}

function renderResult(pkg) {
  lastTrackedPkg = pkg;
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

  const senderContact = [pkg.senderPhone, pkg.senderEmail].filter(Boolean).map(escapeHtml).join(' · ');
  const recipContact = [pkg.recipientPhone, pkg.recipientEmail].filter(Boolean).map(escapeHtml).join(' · ');
  const contents = Array.isArray(pkg.contents) ? pkg.contents : (pkg.description ? [pkg.description] : []);

  resultEl.innerHTML = `
    <div class="waybill">
      <div class="waybill-head">
        <div>
          <p class="waybill-num-label">Tracking number</p>
          <div class="waybill-num-row">
            <p class="waybill-num">${escapeHtml(pkg.trackingNumber)}</p>
            <button type="button" class="icon-btn" id="copyTnBtn" onclick="copyTrackingNumber()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
              Copy
            </button>
          </div>
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
          ${senderContact ? `<p class="contact">${senderContact}</p>` : ''}
        </div>
        <div class="party">
          <p class="lbl">To</p>
          <p class="name">${escapeHtml(pkg.recipientName || '—')}</p>
          ${pkg.recipientAddress ? `<p class="addr">${escapeHtml(pkg.recipientAddress)}</p>` : ''}
          ${recipContact ? `<p class="contact">${recipContact}</p>` : ''}
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
        ${contents.length ? `<div><p class="lbl">Contents</p><div class="contents-tags">${contents.map(c => `<span class="contents-tag">${escapeHtml(c)}</span>`).join('')}</div></div>` : ''}
      </div>
      <div class="progress-wrap">
        ${progressHtml}
        ${etaHtml}
      </div>
      <div class="timeline">
        <p class="timeline-title">Route history</p>
        ${timelineHtml}
      </div>
      <div class="receipt-row">
        <button type="button" class="icon-btn" id="receiptBtn" onclick="saveTrackedReceipt()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>
          Save receipt
        </button>
      </div>
    </div>`;
}

renderRecentHint();
