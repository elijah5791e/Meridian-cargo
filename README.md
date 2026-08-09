# Meridian Cargo

A package tracking site: give a customer a tracking number, and they can look
up their shipment's status and route history. A separate, password-protected
Ship manager page handles creating shipments and posting status updates.

## What's included

- **Public tracking page** (`/`) — look up a shipment by tracking number, or
  by the recipient's email. Shows sender/recipient (with address, phone,
  email), route, ship date, estimated delivery, current status, full history,
  a one-tap copy button for the tracking number, and a downloadable/shareable
  receipt image.
- **Ship manager** (`/admin`) — not linked anywhere on the public site. Behind
  a password. Create shipments (auto-generated or your own custom tracking
  number), add multiple package contents, post status updates, edit shipment
  details, delete shipments, and see summary stats.
- Permanent storage via MongoDB (free tier works fine) — shipments no longer
  disappear on redeploy or restart.

## Run it locally

Requires [Node.js](https://nodejs.org) 18 or later.

```bash
npm install
cp .env.example .env   # then edit .env — see below
npm start
```

Open `http://localhost:3000` for the public site, `http://localhost:3000/admin`
for the ship manager.

## Set up permanent storage (MongoDB Atlas, free)

This is the fix for shipments disappearing. Takes about 5 minutes:

1. Go to [mongodb.com/cloud/atlas/register](https://www.mongodb.com/cloud/atlas/register) and create a free account.
2. Create a new cluster — choose the **M0 Free** tier. Any cloud provider/region is fine.
3. When prompted to create a database user, set a username and password (save these).
4. Under **Network Access**, add IP address `0.0.0.0/0` (allow access from
   anywhere) — Render's IPs aren't static, so this is the simplest option for
   a small project.
5. Click **Connect** on your cluster → **Drivers** → copy the connection
   string. It looks like:
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/
   ```
6. Replace `<username>` and `<password>` with the ones from step 3.
7. Set this as the `MONGODB_URI` environment variable (in your local `.env`,
   and on Render — see below).

That's it — the app automatically uses MongoDB when `MONGODB_URI` is set, and
shipments will persist until you delete them yourself, across restarts and
redeploys. If you skip this step, the app still runs, but falls back to a
local file that most hosts wipe on redeploy.

## Put it on GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

`.env` and the `data/` folder are already excluded via `.gitignore`.

## Deploy it on Render

**Option A — Blueprint (one click):** this repo includes a `render.yaml`. In
Render, choose **New → Blueprint**, point it at your GitHub repo, and it'll
read the file and prompt you for the environment variables below.

**Option B — Manual:**
1. In Render, choose **New → Web Service** (not Static Site — this app needs
   a running server) and connect your repo.
2. Environment: **Node**.
3. Build command: `npm install`
4. Start command: `npm start`
5. Under **Environment**, add:
   - `ADMIN_PASSWORD` — the password for `/admin`.
   - `SESSION_SECRET` — any long random string.
   - `MONGODB_URI` — your MongoDB Atlas connection string (see above).
   - `NODE_ENV` — `production`
6. Deploy. Render gives you a live URL. The Ship manager is at
   `<your-url>/admin` — bookmark it, since it's not linked from the site.

## New in this version

- **Permanent storage** via MongoDB — shipments persist until deleted.
- **Copy button** for the tracking number, both on the tracking page and in
  the ship manager.
- **Ship manager is hidden from customers** — it's now a separate page at
  `/admin` with no link to it anywhere on the public site.
- **Multiple content items per package**, instead of one description field.
- **Sender phone/email** and **recipient phone**, in addition to recipient
  email.
- **Custom tracking numbers** — choose "Auto-generate" or "Choose my own"
  when creating a shipment.
- **Downloadable/shareable receipt** — generates a PNG with the tracking
  number, sender/recipient, route, dates, and contents. On phones that
  support it, this opens the native share sheet (so you can save straight to
  your photo gallery); otherwise it downloads directly.
- Visual refresh: proper logo mark, hero section, and general polish.

## How tracking works, in brief

Each shipment has a unique tracking number, a sender and recipient (name,
address, phone, email), an origin and destination, a ship date, an estimated
delivery date, and a status. Every status change is appended to a history log
rather than overwriting the last one, so the full journey stays visible:
label created → picked up → in transit → arrived at hub → out for delivery →
delivered (or an exception for anything that goes wrong). The customer-facing
page only ever reads this data; only someone with the Ship manager password
can create shipments or add updates.

## Security notes

This is a small/medium-traffic project, not an enterprise system:

- Ship manager access is a single shared password, not per-user accounts.
- Session storage is in-memory — fine for one server instance, won't share
  sessions if you scale to multiple instances.
- `/admin` isn't linked publicly, but the URL itself isn't secret if someone
  guesses it — the password is still the real protection.
- No rate limiting on tracking or login endpoints.

## Project structure

```
meridian-cargo/
├── server.js          Express app: API routes + serves the frontend
├── storage.js         MongoDB (or local JSON file fallback) data layer
├── package.json
├── render.yaml         Render deploy blueprint
├── .env.example
└── public/
    ├── index.html      Public tracking page
    ├── admin.html      Ship manager (not linked from index.html)
    ├── style.css        Shared styles
    ├── app.js           Public page logic
    ├── admin.js         Ship manager logic
    └── receipt.js       Shared receipt-image generator
```
