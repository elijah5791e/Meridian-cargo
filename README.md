# Meridian Cargo

A package tracking site: give a customer a tracking number, and they can look up
their shipment's status and route history. Includes a password-protected
"Ship manager" page for creating shipments and posting status updates.

## What's included

- **Track tab** — look up a shipment by tracking number, or by the recipient's
  email (shows every shipment sent to that address). Displays sender/recipient,
  route, ship date, estimated delivery, current status, and full history.
- **Ship manager tab** — behind a single shared password. Create shipments
  (auto-generates a tracking number), post status updates, edit shipment
  details, delete shipments, and see summary stats.
- A small Node/Express backend with a JSON file as the database — no external
  database to set up.

## Run it locally

Requires [Node.js](https://nodejs.org) 18 or later.

```bash
npm install
cp .env.example .env   # then edit .env and set ADMIN_PASSWORD
npm start
```

Open `http://localhost:3000`. Use the password you set in `.env` to get into
the Ship manager tab.

## Put it on GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

(`.env` and the `data/` folder are already excluded via `.gitignore` — you
don't want your admin password or shipment data in the repo.)

## Deploy it on Render

**Option A — Blueprint (one click):**
This repo includes a `render.yaml`. In Render, choose **New > Blueprint**,
point it at your GitHub repo, and Render will read `render.yaml` and set
everything up. It'll prompt you for `ADMIN_PASSWORD` during setup.

**Option B — Manual:**
1. In Render, choose **New > Web Service** and connect your GitHub repo.
2. Environment: **Node**.
3. Build command: `npm install`
4. Start command: `npm start`
5. Under **Environment**, add:
   - `ADMIN_PASSWORD` — the password for the Ship manager tab.
   - `SESSION_SECRET` — any long random string (keeps admin logins from
     resetting on redeploy).
   - `NODE_ENV` — `production`
6. Deploy. Render gives you a URL like `https://meridian-cargo.onrender.com` —
   that's your live tracking site.

### About data persistence on Render

This app stores shipments in a JSON file (`data/db.json`) on disk. Render's
**free** web services have an *ephemeral* filesystem — anything written to
disk is wiped on every redeploy or restart. That's fine for trying things out,
but for real use you have two options:

1. **Add a Render Disk** (small paid add-on) mounted at, say, `/var/data`,
   then set the environment variable `DATA_DIR=/var/data`. The app already
   reads this variable, so no code changes needed.
2. **Move to a real database** (e.g. Render's managed Postgres) if you expect
   real traffic — `db.js` is the only file that would need to change, since
   everything else calls `readDB()` / `writeDB()`.

## How tracking works, in brief

Each shipment has a unique tracking number (e.g. `MC-4821903`), a sender and
recipient (name + address), an origin and destination, a ship date, an
estimated delivery date, and a status. Every status change is appended to a
history log rather than overwriting the last one, so the full journey stays
visible: label created → picked up → in transit → arrived at hub → out for
delivery → delivered (or an exception, for anything that goes wrong — a
failed delivery attempt, damage, a customs hold, etc.). The customer-facing
page only ever reads this data; only someone with the Ship manager password
can create shipments or add updates.

## Security notes

This is a small/medium-traffic prototype, not an enterprise system:

- Ship manager access is a single shared password, not per-user accounts.
- Session storage is in-memory, which works fine for a single server instance
  but won't share sessions across multiple instances if you scale up.
- There's no rate limiting on the tracking or login endpoints.

All reasonable to harden later (per-user auth, a real database, rate
limiting) if this grows into something with real customers.

## Project structure

```
meridian-cargo/
├── server.js         Express app: API routes + serves the frontend
├── db.js             Reads/writes data/db.json
├── package.json
├── render.yaml        Render deploy blueprint
├── .env.example
└── public/
    ├── index.html
    ├── style.css
    └── app.js
```
