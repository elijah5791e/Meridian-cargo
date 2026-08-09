const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

let mode = 'file';
let shipmentsCollection = null;

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function init() {
  const uri = process.env.MONGODB_URI;
  if (uri) {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(uri);
    await client.connect();
    const dbName = process.env.MONGODB_DB || 'meridian_cargo';
    shipmentsCollection = client.db(dbName).collection('shipments');
    await shipmentsCollection.createIndex({ trackingNumber: 1 }, { unique: true });
    mode = 'mongo';
    console.log('Storage: connected to MongoDB — shipments will persist permanently.');
  } else {
    mode = 'file';
    console.log('Storage: no MONGODB_URI set — using a local JSON file. On most hosts (including Render) this will NOT survive a redeploy or restart. Set MONGODB_URI for permanent storage.');
  }
}

/* ---------- local JSON-file fallback ---------- */

function readFileDB() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.shipments) parsed.shipments = {};
    return parsed;
  } catch (err) {
    return { shipments: {} };
  }
}
function writeFileDB(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

/* ---------- public API ---------- */

async function getShipment(trackingNumber) {
  if (mode === 'mongo') {
    return shipmentsCollection.findOne({ trackingNumber }, { projection: { _id: 0 } });
  }
  const db = readFileDB();
  return db.shipments[trackingNumber] || null;
}

async function listShipments() {
  if (mode === 'mongo') {
    return shipmentsCollection.find({}, { projection: { _id: 0 } }).toArray();
  }
  const db = readFileDB();
  return Object.values(db.shipments);
}

async function findByEmail(email) {
  const clean = String(email || '').trim();
  if (!clean) return [];
  if (mode === 'mongo') {
    return shipmentsCollection.find(
      { recipientEmail: new RegExp('^' + escapeRegex(clean) + '$', 'i') },
      { projection: { _id: 0 } }
    ).toArray();
  }
  const db = readFileDB();
  return Object.values(db.shipments).filter(p => (p.recipientEmail || '').toLowerCase() === clean.toLowerCase());
}

async function saveShipment(pkg) {
  if (mode === 'mongo') {
    await shipmentsCollection.updateOne(
      { trackingNumber: pkg.trackingNumber },
      { $set: pkg },
      { upsert: true }
    );
    return pkg;
  }
  const db = readFileDB();
  db.shipments[pkg.trackingNumber] = pkg;
  writeFileDB(db);
  return pkg;
}

async function deleteShipment(trackingNumber) {
  if (mode === 'mongo') {
    const r = await shipmentsCollection.deleteOne({ trackingNumber });
    return r.deletedCount > 0;
  }
  const db = readFileDB();
  if (!db.shipments[trackingNumber]) return false;
  delete db.shipments[trackingNumber];
  writeFileDB(db);
  return true;
}

async function shipmentExists(trackingNumber) {
  return !!(await getShipment(trackingNumber));
}

module.exports = { init, getShipment, listShipments, findByEmail, saveShipment, deleteShipment, shipmentExists };
