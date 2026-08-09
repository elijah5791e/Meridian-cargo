require('dotenv').config();

const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');
const { readDB, writeDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const IS_PROD = process.env.NODE_ENV === 'production';

const STATUS_ORDER = ['Label created', 'Picked up', 'In transit', 'Arrived at hub', 'Out for delivery', 'Delivered'];
const REQUIRED_CREATE_FIELDS = ['senderName', 'recipientName', 'origin', 'destination'];
const EDITABLE_FIELDS = [
  'senderName', 'senderAddress',
  'recipientName', 'recipientEmail', 'recipientAddress',
  'origin', 'destination', 'description', 'weight', 'serviceLevel', 'estimatedDelivery'
];

if (IS_PROD) app.set('trust proxy', 1);

app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: 1000 * 60 * 60 * 8
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

function normalizeTN(raw) {
  return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
}

function genTrackingNumber(db) {
  let tn;
  do {
    tn = 'MC-' + Math.floor(1000000 + Math.random() * 8999999);
  } while (db.shipments[tn]);
  return tn;
}

/* ---------------- public tracking ---------------- */

app.get('/api/track/:trackingNumber', (req, res) => {
  const db = readDB();
  const tn = normalizeTN(req.params.trackingNumber);
  const pkg = db.shipments[tn];
  if (!pkg) return res.status(404).json({ error: 'No shipment found with that tracking number.' });
  res.json(pkg);
});

app.get('/api/track-by-email/:email', (req, res) => {
  const db = readDB();
  const email = String(req.params.email || '').trim().toLowerCase();
  const matches = Object.values(db.shipments)
    .filter(p => (p.recipientEmail || '').toLowerCase() === email)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(matches);
});

/* ---------------- admin auth ---------------- */

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password && password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: "That password isn't right." });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/session', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

/* ---------------- admin: shipments ---------------- */

app.get('/api/shipments', requireAdmin, (req, res) => {
  const db = readDB();
  const list = Object.values(db.shipments).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(list);
});

app.post('/api/shipments', requireAdmin, (req, res) => {
  const b = req.body || {};
  const missing = REQUIRED_CREATE_FIELDS.filter(f => !b[f] || !String(b[f]).trim());
  if (missing.length) {
    return res.status(400).json({ error: 'Missing required fields: ' + missing.join(', ') });
  }

  const db = readDB();
  const tn = genTrackingNumber(db);
  const now = new Date().toISOString();
  const shippedAt = b.shippedAt ? new Date(b.shippedAt).toISOString() : now;

  const pkg = {
    trackingNumber: tn,
    senderName: b.senderName.trim(),
    senderAddress: (b.senderAddress || '').trim(),
    recipientName: b.recipientName.trim(),
    recipientEmail: (b.recipientEmail || '').trim(),
    recipientAddress: (b.recipientAddress || '').trim(),
    origin: b.origin.trim(),
    destination: b.destination.trim(),
    description: (b.description || '').trim(),
    weight: (b.weight || '').trim(),
    serviceLevel: b.serviceLevel === 'Express' ? 'Express' : 'Standard',
    shippedAt,
    estimatedDelivery: b.estimatedDelivery || '',
    status: 'Label created',
    createdAt: now,
    updatedAt: now,
    history: [{
      status: 'Label created',
      location: b.origin.trim(),
      timestamp: shippedAt,
      note: 'Shipment created and label printed.'
    }]
  };

  db.shipments[tn] = pkg;
  writeDB(db);
  res.status(201).json(pkg);
});

app.patch('/api/shipments/:trackingNumber', requireAdmin, (req, res) => {
  const db = readDB();
  const tn = normalizeTN(req.params.trackingNumber);
  const pkg = db.shipments[tn];
  if (!pkg) return res.status(404).json({ error: 'Not found' });

  EDITABLE_FIELDS.forEach(f => {
    if (req.body[f] !== undefined) pkg[f] = req.body[f];
  });
  pkg.updatedAt = new Date().toISOString();
  writeDB(db);
  res.json(pkg);
});

app.post('/api/shipments/:trackingNumber/events', requireAdmin, (req, res) => {
  const db = readDB();
  const tn = normalizeTN(req.params.trackingNumber);
  const pkg = db.shipments[tn];
  if (!pkg) return res.status(404).json({ error: 'Not found' });

  const { status, location, note } = req.body || {};
  if (!status || ![...STATUS_ORDER, 'Exception'].includes(status)) {
    return res.status(400).json({ error: 'Valid status required' });
  }

  const now = new Date().toISOString();
  pkg.history.push({ status, location: (location || '').trim(), timestamp: now, note: (note || '').trim() });
  pkg.status = status;
  pkg.updatedAt = now;
  writeDB(db);
  res.json(pkg);
});

app.delete('/api/shipments/:trackingNumber', requireAdmin, (req, res) => {
  const db = readDB();
  const tn = normalizeTN(req.params.trackingNumber);
  if (!db.shipments[tn]) return res.status(404).json({ error: 'Not found' });
  delete db.shipments[tn];
  writeDB(db);
  res.json({ ok: true });
});

/* ---------------- fallback to SPA ---------------- */

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Meridian Cargo listening on port ${PORT}`);
  if (ADMIN_PASSWORD === 'changeme') {
    console.warn('WARNING: using default admin password — set ADMIN_PASSWORD in your environment.');
  }
});
