# TraceX production deployment

## Owner deployment target

The requested production target is the owner's existing `https://tracex-beta-six.vercel.app` deployment. The authenticated Vercel account can access only the separate `tracex7` team, not that project or the owner's backend deployment. Production changes to the owner's projects require an owner-granted collaborator role. Do not deploy this repair through the separately created verification project as a replacement without owner authorization.

The browser client always uses same-origin `/api`. Stale `VITE_API_URL` hostnames are ignored; authentication, attachments and exports share the same prefix. HTML proxy responses produce an explicit API error. The root configuration is intentionally owner-neutral: run the existing `configure:vercel` command with the owner's verified HTTPS backend origin only after project access is granted. No separately created Render service is hardcoded. Vercel builds refuse to proceed while the API rewrite is unconfigured.

Local regressions pass 33/33, including the laboratory-assignment restrictions on collection listing, both journey endpoint aliases and stage updates. Source inventory identifies 20 frontend route patterns plus the wildcard and 65 API endpoints. Separate staging verification completed 86 HTTP checks, including secure cookies, all four staff roles, consumer registration/login/logout, complaints, investigation exports, audit integrity, five near-10 MiB PDF uploads and matching download SHA-256. Those results concern isolated demonstration data, not the owner's production data. Browser automation was stopped by its URL-confidence safety check; no new browser-console verification is claimed.

The separate Vercel/Render/Atlas verification resources are not the owner's deployment. They remain unchanged, with no paid resources provisioned, and their staging configuration was removed from the repair branch. No original deployment, user record or upload was deleted or migrated. Their existence does not grant access to the original production database or permission to change the owner's hosting architecture.

## Architecture and current status

Frontend: Vite static output on Vercel. Backend: persistent Node 24 / Express process on an HTTPS Node or container host. Database: retain the existing MongoDB, preferably an Atlas replica set. Browser calls remain same-origin `/api`; Vercel rewrites them to the API host. No frontend appearance, page source, route or upload contract was changed.

Option A (Express in Vercel Functions) is unsuitable for the existing API: complaints allow five 5 MiB images, and lab reports allow five 10 MiB files per request. Vercel Functions cap requests at 4.5 MB. A real 6 MiB lab upload passes the local integration suite. Preserving that contract on Functions would require a separate direct-upload protocol and storage infrastructure. Option B preserves the UI and multipart endpoints. Vercel external rewrites proxy requests without putting Express in a Function. Verify the chosen origin and proxy accept at least 55 MiB request bodies and 10 MiB downloads before promotion.

References: [Function limits](https://vercel.com/docs/functions/limitations), [external rewrites](https://vercel.com/docs/routing/rewrites), [Mongoose connections](https://mongoosejs.com/docs/connections.html).

The API code was also verified on separate staging resources, but the owner's original deployment remains unmodified and unverified after repair. Earlier failed Git-triggered checks and staging results are historical evidence, not production completion. Owner-granted project access and the owner's actual backend/database configuration remain required. No existing production database or uploads were changed.

## Environment scopes

Enter backend secrets only in the Node host's secret/environment settings. Never put them in `VITE_*`, source files or frontend Vercel variables.

| Variable | Backend production value / requirement |
| --- | --- |
| `NODE_ENV` | `production` |
| `MONGO_URI` | Existing database URI, including database name. Required in production. Keep credentials secret. |
| `MONGO_TRANSACTIONS` | `true` on a verified replica set / Atlas; `false` for standalone MongoDB. Transaction mode was not exercised against Atlas here. |
| `MONGO_AUTO_INDEX` | `false` (production default). Verify existing declared unique indexes before serving writes. |
| `MONGO_MAX_POOL_SIZE` | `10` default per process; size total replicas against Atlas limits. |
| `JWT_SECRET` | Stable cryptographically random secret, at least 32 bytes; preserve the existing secret to preserve sessions. Required in production. |
| `CORS_ORIGIN` | Exact approved frontend origins, comma separated; include the specific preview origin when testing. Do not use `*`. |
| `FORCE_HTTPS` | `true` behind a correctly configured TLS proxy. Health probes must use HTTPS or pass trusted forwarded protocol. |
| `COOKIE_SECURE` | `true`; sessions remain HttpOnly, SameSite=Lax, host-only, path `/`. |
| `TRUST_PROXY` | Trusted IP ranges or verified proxy-hop count; default `1`. With Vercel plus an origin load balancer the chain may contain more hops. Verify client-IP handling with the actual provider; do not enable unrestricted proxy trust. |
| `SEED_ON_EMPTY` | `false`; never seed or reset production. |
| `ALLOW_SIMULATION` | `false`; mock provider labels remain visible. Only mock supply-chain/FSSAI integrations currently exist. |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` | Optional initial administrator only when users are empty. Omit on an existing database. Remove after intentional bootstrap. |
| `UPLOAD_DIR` | Mount the existing legacy upload directory at this path. New uploads need MongoDB storage only. |
| `PORT` | Host-assigned port; defaults to 5000. |
| `RATE_LIMIT` | `true`; in-memory limits apply per process. Start with one API replica or use a provider-level shared limiter before scaling. |

Retain other application settings from `server/.env.example` as applicable. Demo passwords and bootstrap passwords are server-only. The server loads `server/.env` in local development regardless of launch directory; host environment variables take precedence.

Vercel frontend: project root is repository root, framework Vite, install `npm ci`, build `npm run build`, output `dist`. Leave `VITE_API_URL` unset so cookies, links, photos and downloads all use same-origin `/api`. No backend secrets are needed in Vercel for this architecture. Never set `NODE_ENV=production` during dependency installation if that would omit Vite's development build dependencies.

`BACKEND_ORIGIN` is a local configuration input, an HTTPS origin with no path or credentials. It is not a runtime interpolation in vercel.json and is not a browser variable. Configure routing **before** uploading/committing the deployment:

```powershell
$env:BACKEND_ORIGIN = 'https://your-existing-api-host.example'
npm run configure:vercel
git diff -- vercel.json
```

Commit the reviewed generated `vercel.json` for Git deployments. The checked-in baseline intentionally has no invented origin, and Vercel builds fail explicitly until the real API rewrite exists. The `/api` rewrite precedes the SPA fallback, preserves `/api` and query strings, and disables external rewrite caching. Static assets use Vercel's normal filesystem routing. Unknown API routes return JSON 404s rather than index.html.

## Backend and data preparation

1. Back up the existing MongoDB and the legacy upload volume using the owner's established backup procedure. Verify restore access. Do not reset data, run the seed command or switch database names.
2. Run the API from `server/` with install `npm ci --omit=dev`, start `npm start`, Node 24. Alternatively build the provided container from repository root with `docker build -f server/Dockerfile .`. Container builds were not run here because Docker's daemon was unavailable.
3. Transfer/mount the existing legacy uploads volume readably at `UPLOAD_DIR` before cutover. Disk-only historical lab evidence is not automatically migrated. Missing old bytes cannot be reconstructed from metadata. New complaint and lab attachment bytes are stored in MongoDB with their existing SHA-256 and unchanged metadata. Each file remains under MongoDB's per-document limit.
4. Check declared indexes from `server/src/db.js` against the existing database. With owner approval and a backup, `npm --prefix server run db:indexes` creates declared indexes without dropping indexes or documents. Review duplicate-key failures instead of deleting records. This command was not run against existing data.
5. Configure HTTPS, verified proxy trust, network access to Atlas, secrets and a readiness probe at `/api/health`. A healthy response is `200 {"ok":true}`; unavailable MongoDB returns a generic 503 after the bounded connection attempt. Driver secrets are not logged.
6. Confirm origin limits preserve the 50 MiB multipart lab contract plus overhead, PDF generation, and authenticated downloads. Provision a shared rate-limit layer before multiple replicas if globally enforced limits are required.

No schema migration or production index mutation was executed. The new application adds no indexes or collections for upload storage; it uses the pre-existing Attachment.data field. All immutable evidence and append-only audit hooks remain enforced. Default production startup does no demonstration seeding. Threshold initialization and explicitly configured first-admin bootstrap retain their previous behavior on backend startup.

## Preview, production and rollback

After backend preparation, authenticate the Vercel CLI (`npx vercel login`) or connect Vercel in Codex, select the correct existing project/team, and configure the API rewrite above. A new backend service or paid plan needs the owner's explicit approval.

```powershell
npm run install:all
npm test
npm run build
npx vercel link
npx vercel                     # preview first; do not add --prod yet
npm run smoke -- https://actual-preview-url.vercel.app
```

The smoke script is read-only and checks database-backed health, public metadata, anonymous access rejection, API 404 behavior, frontend load and direct-route HTML. Set `SMOKE_BATCH_ID` to an existing safe batch ID to include consumer verification. If deployment protection intercepts requests, use the owner's approved authenticated preview access.

In the preview browser verify secure cookies, login/logout for safe test accounts, dashboards, consumer verification/tracking, and lab reports/downloads using an isolated staging database. Test non-destructive submission workflows there, including a valid 6 MiB report and instance restart. Verify the full multipart limit through Vercel and the actual backend host. Do not submit test complaints/reports or seed data against production. Review network/console errors and mobile layouts. Local preview proxy checks do not prove Vercel's live routing or Atlas connectivity.

Only after smoke tests pass and the owner authorizes promotion: `npx vercel --prod`, then repeat `npm run smoke -- https://actual-production-url`. Preserve existing `JWT_SECRET`, database name and legacy volume to retain sessions/data. Record both verified deployment URLs and the deployed Git commit.

Rollback uses the prior Vercel deployment and prior API image/commit with the same secrets, database and mounted legacy files. No destructive migration is part of this repair. Reverting code does not require deleting data. Keep backups and preserve the new Attachment.data bytes.

## Local verification and limits

Baseline: backend tests 19/19; root dependency installation failed with an incompatible Vite 8 / React plugin 4 peer range, so the frontend could not build. After the repair: 29 tests pass, production build succeeds, frontend and backend dependency audits report zero vulnerabilities. Existing Zod was upgraded to the patched version with explicit record key schemas and equivalent validation messages; no validation was removed.

New regressions cover concurrent connection initialization, retry after connection failure, API-before-SPA routing, configuration validation, bounded lab-list queries, a 6 MiB lab report, and a fresh production-mode process reusing the existing test session and retrieving identical report bytes with no local upload directory. Legacy disk-only downloads and generic outage 503 responses also pass. Test URI parsing preserves connection options while replacing database names, and cleanup refuses non-test databases. Browser checks passed for 13 routes with refreshes, reviewer login/logout and dashboard widths 1440/834/390, with no page exceptions or dashboard horizontal overflow. Tests create uniquely named disposable local databases; only those are dropped during cleanup. Production data/Atlas access was unavailable and was not inspected or modified. Existing simulation/audit/permission tests still pass.

The chart vendor bundle still triggers the pre-existing 500 kB Vite warning; no visual or chart-library changes were made. Production provider integrations remain mocks. Live TLS/proxy behavior, global throttling, Atlas transaction mode, historical upload-volume mounting, real preview/production requests and hosting failover still require the configured environment.
