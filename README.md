# TraceX: multi-category food-safety traceability

React (Vite) frontend + Express/SQLite backend. Dairy is one category among dairy, packaged beverages, edible oils, packaged snacks, grains and other packaged food. Category stages, lab tests and contamination types live in `server/src/domain/categories.js`; add a category by adding an entry there.

## Run it
```bash
npm run install:all                 # frontend + server dependencies
cp server/.env.example server/.env  # set DEMO_PASSWORD (or leave empty: a random one is printed once)
npm run server:dev                  # API on :5000 (creates server/data/tracex.db, seeds demo data when empty)
npm run dev                         # frontend on :5173, /api proxied to :5000
```
Open http://localhost:5173. Demo accounts (password = `DEMO_PASSWORD`): admin@, reviewer@, lab.nashik@, lab.pune@, provider@ `tracex.demo`. Consumers need no account (`/consumer`).
Reset demo data: `npm --prefix server run seed`. Tests: `npm test` (API integration suite on a temp DB). Build: `npm run build`.

## Production
`NODE_ENV=production`, `JWT_SECRET`, `CORS_ORIGIN`, `FORCE_HTTPS=true` behind TLS, `SEED_ON_EMPTY=false`, `ALLOW_SIMULATION=false`, `BOOTSTRAP_ADMIN_EMAIL/PASSWORD` for the first admin. Persist `server/data` and `server/uploads`. See `server/.env.example`.

## Real vs simulated
| Area | Status |
|---|---|
| Auth | Real: bcrypt, signed httpOnly cookie, lockout, server-side role checks. No external IdP. |
| Database | Real SQLite, persistent. |
| Supply-chain provider | **Mock** behind a provider interface (`providers/supplyChain`), labelled MOCK. |
| FSSAI submission | **Simulated** (`providers/fssai`); nothing is sent to FSSAI; labelled SIMULATED. |
| OCR | **Not available**; upload + manual entry; browser BarcodeDetector tried where supported. |
| Consumer notifications | **Not configured**; sample requests show on the complaint status page. |
| Demo data | Fictional (`is_demo`), dates relative to seeding. |

## Roles
Consumer (anonymous): verify, complaint, status, public map. Lab: own/open sample requests + report upload. Reviewer: dashboard, investigations, internal hotspots, risk, reports, FSSAI decision records. Admin: same (except recording decisions) + users, thresholds, integrations, audit. Provider: `POST /api/provider/supply-chain/:batchId/records`.

## Limits
UI was checked in headless Chromium at 1440/834/390 px for the staff pages (no console errors, no horizontal overflow) but has no automated UI tests; no lint config in repo; SRS performance targets untested; complaints without a batch cannot be linked later by staff; no cross-batch product-level flagging; risk weights are demo values.
