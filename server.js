require('dotenv').config();

const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');
const storage = require('./storage');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const IS_PROD = process.env.NODE_ENV === 'production';

const STATUS_ORDER = ['Label created', 'Picked up', 'In transit', 'Arrived at hub', 'Out for delivery', 'Delivered'];
const REQUIRED_CREATE_FIELDS = ['senderName', 'recipientName', 'origin', 'destination'];
const EDITABLE_FIELDS = [
  'senderName', 'senderAddress', 'senderPhone', 'senderEmail',
  'recipientName', 'recipientEmail', 'recipientPhone', 'recipientAddress',
  'origin', 'destination', 'weight', 'serviceLevel', 'estimatedDelivery'
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
function cleanContents(input, fallbackDescription) {
  if (Array.isArray(input)) {
    return input.map(s => String(s).trim()).filter(Boolean);
  }
  if (fallbackDescription) return [String(fallbackDescription).trim()].filter(Boolean);
  return [];
}
async function genTrackingNumber() {
  let tn;
  do {
    tn = 'MC-' + Math.floor(1000000 + Math.random() * 8999999);
  } while (await storage.shipmentExists(tn));
  return tn;
}

/* ---------------- admin page (not linked from the public site) ---------------- */

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

/* ---------------- public tracking ---------------- */

app.get('/api/track/:trackingNumber', async (req, res) => {
  const tn = normalizeTN(req.params.trackingNumber);
  const pkg = await storage.getShipment(tn);
  if (!pkg) return res.status(404).json({ error: 'No shipment found with that tracking number.' });
  res.json(pkg);
});

app.get('/api/track-by-email/:email', async (req, res) => {
  const matches = (await storage.findByEmail(req.params.email))
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

app.get('/api/shipments', requireAdmin, async (req, res) => {
  const list = (await storage.listShipments()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(list);
});

app.post('/api/shipments', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const missing = REQUIRED_CREATE_FIELDS.filter(f => !b[f] || !String(b[f]).trim());
  if (missing.length) {
    return res.status(400).json({ error: 'Missing required fields: ' + missing.join(', ') });
  }

  let tn;
  if (b.customTrackingNumber && String(b.customTrackingNumber).trim()) {
    tn = normalizeTN(b.customTrackingNumber);
    if (!/^[A-Z0-9-]{4,32}$/.test(tn)) {
      return res.status(400).json({ error: 'Custom tracking numbers can only use letters, numbers, and dashes (4-32 characters).' });
    }
    if (await storage.shipmentExists(tn)) {
      return res.status(409).json({ error: 'That tracking number is already in use — pick another.' });
    }
  } else {
    tn = await genTrackingNumber();
  }

  const now = new Date().toISOString();
  const shippedAt = b.shippedAt ? new Date(b.shippedAt).toISOString() : now;

  const pkg = {
    trackingNumber: tn,
    senderName: b.senderName.trim(),
    senderAddress: (b.senderAddress || '').trim(),
    senderPhone: (b.senderPhone || '').trim(),
    senderEmail: (b.senderEmail || '').trim(),
    recipientName: b.recipientName.trim(),
    recipientEmail: (b.recipientEmail || '').trim(),
    recipientPhone: (b.recipientPhone || '').trim(),
    recipientAddress: (b.recipientAddress || '').trim(),
    origin: b.origin.trim(),
    destination: b.destination.trim(),
    contents: cleanContents(b.contents, b.description),
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

  await storage.saveShipment(pkg);
  res.status(201).json(pkg);
});

app.patch('/api/shipments/:trackingNumber', requireAdmin, async (req, res) => {
  const tn = normalizeTN(req.params.trackingNumber);
  const pkg = await storage.getShipment(tn);
  if (!pkg) return res.status(404).json({ error: 'Not found' });

  EDITABLE_FIELDS.forEach(f => {
    if (req.body[f] !== undefined) pkg[f] = req.body[f];
  });
  if (req.body.contents !== undefined) {
    pkg.contents = cleanContents(req.body.contents);
  }
  pkg.updatedAt = new Date().toISOString();
  await storage.saveShipment(pkg);
  res.json(pkg);
});

app.post('/api/shipments/:trackingNumber/events', requireAdmin, async (req, res) => {
  const tn = normalizeTN(req.params.trackingNumber);
  const pkg = await storage.getShipment(tn);
  if (!pkg) return res.status(404).json({ error: 'Not found' });

  const { status, location, note } = req.body || {};
  if (!status || ![...STATUS_ORDER, 'Exception'].includes(status)) {
    return res.status(400).json({ error: 'Valid status required' });
  }

  const now = new Date().toISOString();
  pkg.history.push({ status, location: (location || '').trim(), timestamp: now, note: (note || '').trim() });
  pkg.status = status;
  pkg.updatedAt = now;
  await storage.saveShipment(pkg);
  res.json(pkg);
});

app.delete('/api/shipments/:trackingNumber', requireAdmin, async (req, res) => {
  const tn = normalizeTN(req.params.trackingNumber);
  const ok = await storage.deleteShipment(tn);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

/* ---------------- fallback to the public site ---------------- */

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

storage.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Meridian Cargo listening on port ${PORT}`);
      if (ADMIN_PASSWORD === 'changeme') {
        console.warn('WARNING: using the default admin password — set ADMIN_PASSWORD in your environment.');
      }
    });
  })
  .catch(err => {
    console.error('Failed to initialize storage:', err);
    process.exit(1);
  });
