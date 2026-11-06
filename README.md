# TraceX: multi-category food-safety traceability

React (Vite) frontend + Express/MongoDB (Mongoose) backend. Dairy is one category among dairy, packaged beverages, edible oils, packaged snacks, grains and other packaged food. Category stages, lab tests and contamination types live in `server/src/domain/categories.js`; add a category by adding an entry there.

## Run it
```bash
npm run install:all                 # frontend + server dependencies
cp server/.env.example server/.env  # set DEMO_PASSWORD (or leave empty: a random one is printed once)
npm run server:dev                  # API on :5000; requires MongoDB, seeds only when enabled and empty
npm run dev                         # frontend on :5173, /api proxied to :5000
```
Open http://localhost:5173. Demo accounts (password = `DEMO_PASSWORD`): admin@, reviewer@, lab.nashik@, lab.pune@, provider@ `tracex.demo`. Consumer verification, tracking and maps are public; submitting a complaint requires a consumer account (`/consumer`).
Tests: `npm test` (API integration suite on uniquely named temporary MongoDB databases; a local MongoDB must be running). Build: `npm run build`. The `seed` command resets data and must never be used against an existing or production database.

## Production
Use Vercel for the frontend and an HTTPS persistent Node host for the API, with MongoDB Atlas or your existing MongoDB. Preserve the legacy uploads volume; all new files store their bytes in MongoDB. Existing upload limits exceed Vercel Functions' 4.5 MB request limit. See [DEPLOYMENT.md](DEPLOYMENT.md) for the deployment gate, environment scopes, preview checks and rollback.

## Real vs simulated
| Area | Status |
|---|---|
| Auth | Real: bcrypt, signed httpOnly cookie, lockout, server-side role checks. No external IdP. |
| Database | Real MongoDB, persistent. |
| Supply-chain provider | **Mock** behind a provider interface (`providers/supplyChain`), labelled MOCK. |
| FSSAI submission | **Simulated** (`providers/fssai`); nothing is sent to FSSAI; labelled SIMULATED. |
| OCR | **Not available**; upload + manual entry; browser BarcodeDetector tried where supported. |
| Consumer notifications | **Not configured**; sample requests show on the complaint status page. |
| Demo data | Fictional (`is_demo`), dates relative to seeding. |

## Roles
Consumer: public verification, status and map; signed-in complaint submission and personal view. Lab: own/open sample requests + report upload. Reviewer: dashboard, investigations, internal hotspots, risk, reports, FSSAI decision records. Admin: same (except recording decisions) + users, thresholds, integrations, audit. Provider: `POST /api/provider/supply-chain/:batchId/records`.

## Limits
UI was checked in headless Chromium at 1440/834/390 px for the staff pages (no console errors, no horizontal overflow) but has no automated UI tests; no lint config in repo; SRS performance targets untested; complaints without a batch cannot be linked later by staff; no cross-batch product-level flagging; risk weights are demo values.
