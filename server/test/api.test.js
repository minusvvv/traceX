// Integration tests: start the real Express app on an ephemeral port against a fresh temp database.
import {test, before, after} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tracex-"));
Object.assign(process.env, {MONGO_URI: (process.env.MONGO_URI_TEST || "mongodb://127.0.0.1:27017/") .replace(/\/?$/, "") + "/tracex_test_" + Date.now(), UPLOAD_DIR: path.join(tmp, "up"), RATE_LIMIT: "false", DEMO_PASSWORD: "test-Passw0rd-2026",
  JWT_SECRET: "test-secret", NODE_ENV: "test", ALLOW_SIMULATION: "true", MOCK_FSSAI_MODE: "ok", MOCK_SUPPLY_CHAIN_MODE: "ok"});
const PW = process.env.DEMO_PASSWORD;
let server, base, M;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const PDF = Buffer.from("%PDF-1.4\n%demo\n%%EOF");

before(async () => {
  const {seedDemo} = await import("../src/seed.js");
  M = await import("../src/db.js");
  await M.connectDb();
  const {createApp} = await import("../src/app.js");
  const {seedThresholds} = await import("../src/services/thresholds.js");
  await seedThresholds(); await seedDemo();
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => { server.close(); await M.dropDatabase(); await M.disconnectDb(); fs.rmSync(tmp, {recursive: true, force: true}); });

async function call(method, url, {body, form, cookie, headers = {}, anonymous = false} = {}) {
  if (!anonymous && !cookie && url === "/public/complaints" && C.consumer) cookie = C.consumer;
  const h = {"X-TraceX-Client": "web", ...headers};
  if (cookie) h.Cookie = cookie;
  let payload;
  if (form) payload = form; else if (body !== undefined) { h["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(base + url, {method, headers: h, body: payload});
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return {status: res.status, json, text, headers: res.headers};
}
async function login(email) {
  const r = await fetch(base + "/auth/login", {method: "POST", headers: {"Content-Type": "application/json", "X-TraceX-Client": "web"}, body: JSON.stringify({email, password: PW})});
  assert.equal(r.status, 200, "login " + email);
  return r.headers.get("set-cookie").split(";")[0];
}
const complaintForm = (o = {}) => { const f = new FormData(); for (const [k, v] of Object.entries({description: "The product smelled strange and tasted bitter.", ...o})) if (v !== undefined) f.append(k, v); return f; };
const png = (name = "x.png", type = "image/png", buf = PNG) => new Blob([buf], {type});
let C = {};

test("authentication and authorization", async () => {
  assert.equal((await call("GET", "/batches")).status, 401, "protected without login");
  assert.equal((await call("POST", "/auth/login", {body: {email: "admin@tracex.demo", password: "wrong"}})).status, 401);
  assert.equal((await call("POST", "/auth/login", {body: {email: "nobody@x.io", password: "x"}})).status, 401);
  const noHeader = await fetch(base + "/auth/login", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({email: "admin@tracex.demo", password: PW})});
  assert.equal(noHeader.status, 403, "client header required");
  C.admin = await login("admin@tracex.demo"); C.rev = await login("reviewer@tracex.demo");
  C.nashik = await login("lab.nashik@tracex.demo"); C.pune = await login("lab.pune@tracex.demo"); C.prov = await login("provider@tracex.demo");
  const registered = await call("POST", "/auth/register", {body: {name: "Sample Consumer", email: " Consumer@Example.com ", password: "consumer-Passw0rd-2026"}});
  assert.equal(registered.status, 201); assert.equal(registered.json.user.role, "consumer"); assert.equal(registered.json.user.email, "consumer@example.com");
  C.consumerUserId = registered.json.user.id;
  assert.equal((await M.User.findById(C.consumerUserId).lean()).role, "consumer", "consumer account is stored in MongoDB");
  assert.equal((await call("POST", "/auth/register", {body: {name: "Duplicate Consumer", email: "consumer@example.com", password: "consumer-Passw0rd-2026"}})).status, 409);
  assert.equal((await call("POST", "/auth/register", {body: {name: "Short Password", email: "short@example.com", password: "short"}})).status, 422);
  const consumerLogin = await call("POST", "/auth/consumer-login", {body: {email: "consumer@example.com", password: "consumer-Passw0rd-2026"}});
  assert.equal(consumerLogin.status, 200); C.consumer = consumerLogin.headers.get("set-cookie").split(";")[0];
  assert.equal((await call("POST", "/auth/consumer-login", {body: {email: "admin@tracex.demo", password: PW}})).status, 401);
  assert.equal((await call("GET", "/investigations", {cookie: C.nashik})).status, 403, "lab cannot read investigations");
  assert.equal((await call("GET", "/analytics/hotspots", {cookie: C.nashik})).status, 403, "lab cannot read internal hotspots");
  assert.equal((await call("GET", "/analytics/hotspots")).status, 401, "anonymous cannot read internal hotspots");
  assert.equal((await call("GET", "/complaints/summary", {cookie: C.nashik})).status, 403, "lab cannot read complaint totals");
  assert.equal((await call("GET", "/complaints/summary")).status, 401, "anonymous cannot read complaint totals");
  assert.equal((await call("GET", "/complaints/summary", {cookie: C.admin})).json.total, await M.Complaint.countDocuments(), "admin sees current complaint total");
  assert.equal((await call("PUT", "/admin/thresholds/global", {cookie: C.rev, body: {count: 2, windowDays: 30}})).status, 403, "reviewer cannot change thresholds");
  assert.equal((await call("GET", "/admin/users", {cookie: C.rev})).status, 403);
  assert.equal((await call("POST", "/investigations/INV-014/decision", {cookie: C.admin, body: {}})).status, 403, "only reviewers record decisions");
  const me = await call("GET", "/auth/me", {cookie: C.rev});
  assert.equal(me.json.user.role, "reviewer"); assert.ok(!JSON.stringify(me.json).includes("password"));
  assert.ok(!(await call("GET", "/admin/users", {cookie: C.admin})).text.includes("hash"), "no password hashes exposed");
});

test("multi-category data model, product-specific tests", async () => {
  const {json: all} = await call("GET", "/batches", {cookie: C.rev});
  const cats = new Set(all.map(b => b.category));
  for (const c of ["dairy", "beverage", "edible_oil", "snack", "grain"]) assert.ok(cats.has(c), "category " + c);
  const milk = all.find(b => b.id === "MILK-2026-004"), oil = all.find(b => b.id === "OIL-2026-001");
  assert.ok(milk.route[1].readings.fat != null && oil.route[1].readings.fat === undefined, "dairy has fat; oil does not");
  assert.ok(oil.route[1].readings.peroxide_value != null);
  assert.equal(milk.anomaly.flagged, "Distribution"); assert.equal(milk.status, "suspicious");
  assert.equal(oil.status, "critical"); assert.equal(oil.labStatus, "confirmed");
  assert.equal(all.find(b => b.id === "MILK-2026-001").status, "safe");
  assert.equal(all.find(b => b.id === "SNK-2026-002").status, "safe", "negative lab result clears suspicion");
  assert.equal(all.find(b => b.id === "SNK-2026-002").complaintCount, 3, "complaints remain recorded");
  assert.equal(oil.recall.status, "none", "no recall without an authority decision");
  assert.equal(oil.risk.assessed, false, "risk not assessed until traceability runs");
});

test("public views expose no internal or personal data", async () => {
  const pub = await call("GET", "/public/batches/OIL-2026-001");
  assert.equal(pub.status, 200); assert.equal(pub.json.status, "review");
  for (const k of ["risk", "complaintCount", "labStatus", "flagged", "anomaly", "threshold"]) assert.ok(!(k in pub.json), "public batch must not include " + k);
  assert.equal((await call("GET", "/public/batches/NOPE-1")).status, 404);
  assert.equal((await call("GET", "/public/batches/L2612D")).json.id, "MILK-2026-004", "lookup by lot number");
  const heat = await call("GET", "/public/heatmap?days=365");
  assert.equal(heat.status, 200); assert.ok(heat.json.cells.length > 0);
  for (const c of heat.json.cells) { assert.ok(c.reports >= 3, "k-anonymity"); assert.deepEqual(Object.keys(c).sort(), ["lat", "lng", "radius", "region", "reports", "severity"]); }
  assert.ok(!heat.text.includes("MILK-") && !heat.text.includes("batch"));
  assert.ok(heat.json.cells.every(c => (c.lat * 10) % 1 < 1e-6 || Math.abs(((c.lat * 100) % 10) - 5) < 1e-6), "cell centres, not exact points");
});

test("complaint submission: validation, privacy, idempotency", async () => {
  assert.equal((await call("POST", "/public/complaints", {form: complaintForm({identifier: "BEV-2026-001"}), anonymous: true})).status, 401, "complaints require a consumer account");
  assert.equal((await call("POST", "/public/complaints", {form: complaintForm({description: undefined, identifier: "BEV-2026-001"})})).status, 422, "description required");
  const short = await call("POST", "/public/complaints", {form: complaintForm({description: "bad", identifier: "BEV-2026-001"})});
  assert.equal(short.status, 422); assert.ok(short.json.fields.description);
  assert.equal((await call("POST", "/public/complaints", {form: complaintForm()})).status, 422, "needs some identification");
  const f1 = complaintForm({identifier: "BEV-2026-001"}); f1.append("photos", png("a.gif", "image/gif"), "a.gif");
  assert.equal((await call("POST", "/public/complaints", {form: f1})).status, 422, "gif rejected");
  const f2 = complaintForm({identifier: "BEV-2026-001"}); f2.append("photos", png("fake.png", "image/png", Buffer.from("not really a png at all")), "fake.png");
  const fake = await call("POST", "/public/complaints", {form: f2});
  assert.equal(fake.status, 422, "magic bytes checked"); assert.match(fake.json.error, /valid PNG/);
  const big = complaintForm({identifier: "BEV-2026-001"}); big.append("photos", png("b.png", "image/png", Buffer.concat([PNG, Buffer.alloc(5.5 * 1024 * 1024)])), "b.png");
  assert.equal((await call("POST", "/public/complaints", {form: big})).status, 413, "size limit");
  const badContact = await call("POST", "/public/complaints", {form: complaintForm({identifier: "BEV-2026-001", contact: "not a contact"})});
  assert.equal(badContact.status, 422);

  const before = await M.Complaint.countDocuments();
  const ok = complaintForm({identifier: "BEV-2026-001", regionKey: "pune", contact: "consumer@example.com"}); ok.append("photos", png("p.png"), "p.png"); ok.append("productImage", png("l.png"), "l.png");
  const key = "idem-key-0001-abcdef";
  const a = await call("POST", "/public/complaints", {form: ok, headers: {"Idempotency-Key": key}});
  assert.equal(a.status, 201); assert.match(a.json.trackingCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/); assert.equal(a.json.matched, "batch"); assert.equal(a.json.attachments, 2);
  assert.equal((await M.Complaint.findById(a.json.complaintId).lean()).submitted_by, C.consumerUserId, "complaint is linked to the signed-in consumer in MongoDB");
  assert.ok(!a.text.includes("consumer@example.com") && !("lat" in a.json) && !("contact" in a.json), "no PII echoed");
  const again = complaintForm({identifier: "BEV-2026-001", regionKey: "pune"});
  const b = await call("POST", "/public/complaints", {form: again, headers: {"Idempotency-Key": key}});
  assert.equal(b.status, 200); assert.equal(b.json.duplicate, true); assert.equal(b.json.trackingCode, a.json.trackingCode);
  assert.equal(await M.Complaint.countDocuments(), before + 1, "duplicate click created one complaint");
  C.beverageTrack = a.json.trackingCode;
  const st = await call("GET", "/public/complaints/" + a.json.trackingCode);
  assert.equal(st.status, 200); assert.equal(st.json.product.name, "Orange fruit drink 200 ml");
  assert.equal((await call("GET", "/public/complaints/AAAA-BBBB-CCCC")).status, 404);
  const staff = await call("GET", "/complaints?batch=BEV-2026-001", {cookie: C.rev});
  const mine = staff.json.find(c => c.id === a.json.complaintId);
  assert.equal(mine.contact, "c***@example.com", "contact masked for staff"); assert.ok(!("lat" in mine));
  assert.equal(mine.attachments.length, 2);
  assert.equal((await call("GET", "/complaints", {cookie: C.nashik})).status, 403);
  assert.equal((await call("GET", "/attachments/" + mine.attachments[0].id)).status, 401, "attachments never public");
  assert.equal((await call("GET", "/attachments/" + mine.attachments[0].id, {cookie: C.pune})).status, 200, "unassigned open sample request: any accredited lab may see its complaint files");
  const lone = complaintForm({identifier: "MILK-2026-002"}); lone.append("photos", png("q.png"), "q.png");
  const loneId = (await call("POST", "/public/complaints", {form: lone})).json.complaintId;
  const loneAtt = (await call("GET", "/complaints?batch=MILK-2026-002", {cookie: C.rev})).json.find(c => c.id === loneId).attachments[0].id;
  assert.equal((await call("GET", "/attachments/" + loneAtt, {cookie: C.pune})).status, 404, "lab cannot fetch files of a complaint unrelated to its sample requests");
  assert.equal((await call("GET", "/attachments/" + loneAtt, {cookie: C.rev})).status, 200);
  const unmatched = await call("POST", "/public/complaints", {form: complaintForm({identifier: "UNKNOWN-123"})});
  assert.equal(unmatched.status, 201); assert.equal(unmatched.json.matched, "none"); assert.equal(unmatched.json.status, "received_unmatched");
  const gtin = await call("POST", "/public/complaints", {form: complaintForm({identifier: "8900000000011"})});
  assert.equal(gtin.json.matched, "product", "GTIN-only resolves to the product");
});

test("same-lot complaints appear together and thresholded complaints reach the public heatmap", async () => {
  await M.Batch.create([
    {_id: "SAMELOT-MILK", product_id: "PRD-MILK-FC", lot_number: "COMMON-LOT-TEST", lot_key: "COMMON-LOT-TEST", created_at: new Date().toISOString()},
    {_id: "SAMELOT-BEV", product_id: "PRD-BEV-OJ", lot_number: "COMMON-LOT-TEST", lot_key: "COMMON-LOT-TEST", created_at: new Date().toISOString()},
  ]);
  for (const [i, productText] of ["Full-cream milk", "Orange fruit drink 200 ml"].entries()) {
    const form = complaintForm({identifier: "COMMON-LOT-TEST", productText});
    if (!i) form.append("photos", png("shared-lot.png"), "shared-lot.png");
    const response = await call("POST", "/public/complaints", {form});
    assert.equal(response.status, 201);
    assert.equal(response.json.matched, "product", "ambiguous lot remains linked to the named product");
  }
  const similar = await call("GET", "/complaints?batch=SAMELOT-MILK", {cookie: C.rev});
  assert.equal(similar.status, 200);
  assert.equal(similar.json.filter(c => c.text === "The product smelled strange and tasted bitter.").length, 2, "complaints using the shared lot number appear in the batch's similar complaints");
  const unresolved = await call("POST", "/public/complaints", {form: complaintForm({identifier: "COMMON-LOT-TEST"})});
  assert.equal(unresolved.status, 201); assert.equal(unresolved.json.status, "received_unmatched");
  const status = await call("GET", "/public/complaints/" + unresolved.json.trackingCode);
  assert.equal(status.status, 200); assert.equal(status.json.similarReports.count, 2);
  assert.deepEqual(new Set(status.json.similarReports.reports.map(m => m.product)), new Set(["Full-cream milk", "Orange fruit drink 200 ml"]));
  assert.ok(status.json.similarReports.reports.every(r => r.description === "The product smelled strange and tasted bitter."), "related report text is available to consumers");
  const imageId = status.json.similarReports.reports.flatMap(r => r.photos).find(p => p.mime === "image/png")?.id;
  assert.ok(imageId, "similar complaint image is included");
  const publicImage = await call("GET", "/public/complaint-attachments/" + imageId, {anonymous: true});
  assert.equal(publicImage.status, 200); assert.match(publicImage.headers.get("content-type"), /image\/png/);
  const {attachmentData, filePath} = await import("../src/uploads.js");
  const attachment = await M.Attachment.findById(imageId).lean(), storedPath = filePath(attachment), hiddenPath = storedPath + ".test-hidden";
  assert.ok(attachment.data, "complaint image bytes are persisted with the attachment");
  fs.renameSync(storedPath, hiddenPath);
  try {
    const fallback = await fetch(base + "/public/complaint-attachments/" + imageId);
    assert.equal(fallback.status, 200, "complaint image is served when its local upload file is unavailable");
    assert.deepEqual(Buffer.from(await fallback.arrayBuffer()), attachmentData(attachment.data));
  } finally { fs.renameSync(hiddenPath, storedPath); }
  assert.ok(!JSON.stringify(status.json.similarReports).includes("consumer@example.com"), "related reports do not expose contact details");
  const unresolvedWithPhoto = complaintForm({identifier: "SHARED-UNMATCHED-TEST"});
  unresolvedWithPhoto.append("photos", png("unmatched.png"), "unmatched.png");
  assert.equal((await call("POST", "/public/complaints", {form: unresolvedWithPhoto})).status, 201);
  const otherUnmatched = await call("POST", "/public/complaints", {form: complaintForm({identifier: "SHARED-UNMATCHED-TEST"})});
  const unresolvedStatus = await call("GET", "/public/complaints/" + otherUnmatched.json.trackingCode);
  assert.equal(unresolvedStatus.json.similarReports.count, 1);
  assert.equal(unresolvedStatus.json.similarReports.reports[0].product, null, "similar unmatched report is still shared");
  assert.equal(unresolvedStatus.json.similarReports.reports[0].photos.length, 1);

  await M.Batch.create({_id: "MAP-THRESHOLD-TEST", product_id: "PRD-MILK-FC", lot_number: "MAP-THRESHOLD-LOT", lot_key: "MAP-THRESHOLD-LOT", created_at: new Date().toISOString()});
  const {config} = await import("../src/config.js"), {regionByKey} = await import("../src/geo.js");
  const threshold = (await M.Threshold.findById("global").lean()).count, reportsToCreate = Math.max(threshold, config.publicMapMinCell);
  for (let i = 0; i < reportsToCreate; i++)
    assert.equal((await call("POST", "/public/complaints", {form: complaintForm({identifier: "MAP-THRESHOLD-TEST", regionKey: "solapur"})})).status, 201);
  assert.ok(await M.Flag.exists({target_type: "batch", target_id: "MAP-THRESHOLD-TEST", status: "open"}), "batch crosses its complaint threshold");
  const heat = await call("GET", "/public/heatmap?days=365");
  const {lat, lng} = regionByKey("solapur"), d = config.publicMapCellDeg;
  const cellLat = +((Math.floor(lat / d) + .5) * d).toFixed(3), cellLng = +((Math.floor(lng / d) + .5) * d).toFixed(3);
  assert.ok(heat.json.cells.some(c => c.lat === cellLat && c.lng === cellLng), "threshold-crossing batch reports are shown on the map when the cell meets privacy minimum");
});

test("threshold flagging, ranking and sample requests reach only related complaints", async () => {
  // BEV-2026-001 now has 3 complaints (2 seeded + 1 above) with a threshold of 3 -> flagged
  const {json: p} = await call("GET", "/prioritization", {cookie: C.rev});
  const bev = p.flagged.find(f => f.batchId === "BEV-2026-001");
  assert.ok(bev, "beverage batch flagged at threshold"); assert.equal(bev.count, 3);
  assert.ok(p.flagged.find(f => f.batchId === "MILK-2026-004") && p.flagged.find(f => f.batchId === "OIL-2026-001"));
  assert.ok(!p.flagged.find(f => f.batchId === "SNK-2026-001"), "below threshold");
  assert.ok(!p.flagged.find(f => f.batchId === "SNK-2026-002"), "cleared after negative lab result");
  assert.deepEqual(p.flagged.map(f => f.rank), p.flagged.map((_, i) => i + 1));
  for (let i = 1; i < p.flagged.length; i++) assert.ok(p.flagged[i - 1].priority >= p.flagged[i].priority, "ranked by recency-weighted volume");
  const rows = (await M.Complaint.find({batch_id: {$ne: null}}).lean()).map(c => ({batch_id: c.batch_id, s: c.sample_requested_at}));
  assert.ok(rows.filter(r => r.batch_id === "BEV-2026-001").every(r => r.s), "related complaints get sample follow-up");
  assert.ok(rows.filter(r => r.batch_id === "SNK-2026-001").every(r => !r.s), "unrelated consumers do not");
  assert.ok(rows.filter(r => r.batch_id === "MILK-2026-002").every(r => !r.s));
  const srm = new Map((await M.SampleRequest.find().lean()).map(x => [x._id, x])), cmm = new Map((await M.Complaint.find().lean()).map(x => [x._id, x]));
  const linked = (await M.SrComplaint.find().lean()).filter(l => (cmm.get(l.complaint_id).batch_id ?? null) !== (srm.get(l.sample_request_id).batch_id ?? null)).length;
  assert.equal(linked, 0, "no sample request links to a complaint about another batch");
  const st = await call("GET", "/public/complaints/" + C.beverageTrack);
  assert.equal(st.json.sampleRequested, true); assert.ok(!JSON.stringify(st.json).includes("flag"));
});

test("administrators configure thresholds (audited, validated, enforced)", async () => {
  assert.equal((await call("PUT", "/admin/thresholds/global", {cookie: C.admin, body: {count: 0, windowDays: 30}})).status, 422);
  assert.equal((await call("PUT", "/admin/thresholds/global", {cookie: C.admin, body: {count: 3, windowDays: 400}})).status, 422);
  assert.equal((await call("PUT", "/admin/thresholds/spaceship", {cookie: C.admin, body: {count: 3, windowDays: 30}})).status, 422);
  const ok = await call("PUT", "/admin/thresholds/snack", {cookie: C.admin, body: {count: 2, windowDays: 14}});
  assert.equal(ok.status, 200); assert.ok(ok.json.find(t => t.scope === "snack" && t.count === 2));
  const log = (await call("GET", "/admin/audit?action=threshold", {cookie: C.admin})).json;
  assert.equal(log.entries[0].action, "threshold.changed"); assert.equal(log.entries[0].details.after.count, 2);
  // SNK-2026-001 has 1 complaint; one more reaches the snack override of 2
  const r = await call("POST", "/public/complaints", {form: complaintForm({identifier: "SNK-2026-001", regionKey: "pune"})});
  assert.equal(r.status, 201);
  assert.ok((await call("GET", "/prioritization", {cookie: C.rev})).json.flagged.find(f => f.batchId === "SNK-2026-001"), "category override applied");
  await call("DELETE", "/admin/thresholds/snack", {cookie: C.admin});
});

test("laboratory workflow: authorization, validation, outcomes, immutability", async () => {
  const srs = (await call("GET", "/lab/sample-requests?status=requested", {cookie: C.nashik})).json;
  const sr4 = srs.find(s => s.batch === "MILK-2026-004"); assert.ok(sr4, "lab sees pending request");
  const det = (await call("GET", "/lab/sample-requests/" + sr4.id, {cookie: C.nashik})).json;
  assert.ok(det.tests.some(t => t.code === "fat") && det.complaints.length === 4 && !JSON.stringify(det).includes("contact"));
  const submit = (cookie, f, files = {report: [PDF]}) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(f)) if (v !== undefined) fd.append(k, typeof v === "object" ? JSON.stringify(v) : v);
    for (const [k, list] of Object.entries(files)) for (const b of list) fd.append(k, new Blob([b], {type: "application/pdf"}), "report.pdf");
    return call("POST", "/lab/reports", {cookie, form: fd});
  };
  const good = {sampleRequestId: sr4.id, batchId: "MILK-2026-004", accreditationRef: "NABL-DEMO-0001", outcome: "confirmed", contaminationType: "Water adulteration", severity: "major", results: {fat: 3.4, snf: 7.8, water: "Positive"}};
  assert.equal((await submit(C.rev, good)).status, 403, "reviewer cannot upload lab reports");
  assert.equal((await call("POST", "/lab/reports", {body: good})).status, 401);
  assert.equal((await submit(C.nashik, {...good, accreditationRef: "NABL-OTHER-9999"})).json.fields.accreditationRef != null, true, "accreditation must match");
  assert.ok((await submit(C.nashik, {...good, batchId: "MILK-2026-003"})).json.fields.batchId, "batch must match the sample request");
  assert.ok((await submit(C.nashik, {...good, results: {fat: 3.4, ph: 3.5}})).json.fields.results, "tests are product-dependent: pH invalid for dairy");
  assert.ok((await submit(C.nashik, {...good, results: {fat: 99}})).json.fields.results, "range check");
  assert.ok((await submit(C.nashik, {...good, contaminationType: undefined})).json.fields.contaminationType);
  assert.ok((await submit(C.nashik, good, {})).json.fields.report, "report file required");
  assert.equal((await call("GET", "/investigations/INV-014", {cookie: C.rev})).json.statusKey, "awaiting_lab", "rejected submissions changed nothing");
  const done = await submit(C.nashik, good);
  assert.equal(done.status, 201, done.text); C.lab4 = done.json.id;
  assert.equal(done.json.outcome, "confirmed"); assert.equal(done.json.submittedBy, "Demo Lab Analyst (Nashik)"); assert.equal(done.json.attachments[0].kind, "report");
  const i = (await call("GET", "/investigations/INV-014", {cookie: C.rev})).json;
  assert.equal(i.statusKey, "lab_confirmed"); assert.equal(i.labConfirmed, true);
  assert.equal((await submit(C.nashik, good)).status, 422, "second report must be an explicit correction");
  await assert.rejects(M.LabReport.updateOne({_id: C.lab4}, {$set: {outcome: "not_confirmed"}}), /immutable/);
  await assert.rejects(M.LabReport.deleteOne({_id: C.lab4}), /immutable and cannot/);
  await assert.rejects(M.Audit.updateMany({}, {$set: {action: "x"}}), /append-only/);
  await assert.rejects(M.Audit.deleteMany({}), /append-only/);
  await assert.rejects(M.Report.updateMany({}, {$set: {version: 9}}), /immutable/);
  const audit = (await call("GET", "/admin/audit?action=lab_report.uploaded", {cookie: C.admin})).json;
  assert.equal(audit.entries[0].details.files[0].sha256.length, 64); assert.equal(audit.entries[0].actor_email, "lab.nashik@tracex.demo");
  // lab scoping: the Pune lab does not see the Nashik lab's report
  assert.ok(!(await call("GET", "/lab/reports", {cookie: C.pune})).json.some(r => r.id === C.lab4));
  assert.equal((await call("GET", "/lab/reports/" + C.lab4, {cookie: C.pune})).status, 404);
  // negative outcome: BEV batch -> not confirmed closes the investigation and clears the flag
  const srBev = srs.find(s => s.batch === "BEV-2026-001");
  const neg = await submit(C.pune, {sampleRequestId: srBev.id, batchId: "BEV-2026-001", accreditationRef: "NABL-DEMO-0002", outcome: "not_confirmed", results: {ph: 3.6, yeast_mould: "Not detected"}});
  assert.equal(neg.status, 201, neg.text);
  const bevInv = (await call("GET", "/investigations", {cookie: C.rev})).json.find(x => x.batch === "BEV-2026-001");
  assert.equal(bevInv.statusKey, "closed_unconfirmed");
  const bevB = (await call("GET", "/batches/BEV-2026-001", {cookie: C.rev})).json;
  assert.equal(bevB.status, "safe"); assert.equal(bevB.flagged, false); assert.equal(bevB.labStatus, "clear");
  assert.equal((await call("GET", "/public/complaints/" + C.beverageTrack)).json.status, "closed_not_confirmed");
  // correction path preserves the original
  const fix = await submit(C.nashik, {...good, outcome: "confirmed", severity: "critical", supersedes: C.lab4, correctionReason: "Severity re-graded after review"});
  assert.equal(fix.status, 201, fix.text); assert.equal(fix.json.supersedes, C.lab4);
  assert.equal((await M.LabReport.findById(C.lab4).lean()).status, "superseded");
  assert.equal((await M.LabReport.findById(C.lab4).lean()).outcome, "confirmed", "original content preserved");
});

test("traceability is gated on laboratory confirmation and survives provider failures", async () => {
  const gated = await call("POST", "/investigations/INV-013/traceability", {cookie: C.rev, body: {}});
  assert.equal(gated.status, 409); assert.equal(gated.json.code, "LAB_NOT_CONFIRMED");
  assert.equal((await call("POST", "/investigations/INV-013/report", {cookie: C.rev, body: {}})).status, 409);
  assert.equal((await call("POST", "/investigations/INV-015/traceability", {cookie: C.nashik, body: {}})).status, 403);
  const down = await call("POST", "/investigations/INV-015/traceability", {cookie: C.rev, body: {simulate: "unavailable"}});
  assert.equal(down.status, 502); assert.equal(down.json.code, "PROVIDER_UNAVAILABLE"); assert.equal(down.json.mock, true);
  assert.equal((await call("GET", "/investigations/INV-015", {cookie: C.rev})).json.analysis, null, "failed run stored nothing and did not fall back to fake data");
  assert.equal((await call("POST", "/investigations/INV-015/report", {cookie: C.rev, body: {}})).status, 409, "no report without traceability");
  const partial = await call("POST", "/investigations/INV-015/traceability", {cookie: C.rev, body: {simulate: "partial"}});
  assert.equal(partial.status, 200); assert.ok(partial.json.analysis.warnings.some(w => /incomplete/i.test(w))); assert.equal(partial.json.analysis.provider.complete, false);
  const ok = await call("POST", "/investigations/INV-015/traceability", {cookie: C.rev, body: {}});
  const a = ok.json.analysis;
  assert.equal(ok.json.statusKey, "traced"); assert.equal(a.trace.backward.length, 3, "manufacturer + intake + supplier (testing excluded)"); assert.equal(a.trace.forward.length, 7); assert.equal(a.trace.destinations, 6, "packaging at the manufacturer is not a destination");
  assert.equal(a.trace.backward[0].stage, "Refining", "backward starts at the manufacturer stage");
  assert.ok(a.trace.forward.every(n => ["Packaging", "Warehouse", "Distribution", "Retail"].includes(n.stage)));
  assert.deepEqual(a.trace.summary.regions.sort(), ["Nashik", "Pune", "Thane"]);
  assert.ok(a.risk.score > 0 && ["Medium", "High", "Critical"].includes(a.risk.level)); assert.equal(a.risk.components.length, 3);
  assert.ok(a.hotspots.some(h => h.region === "Pune" && h.reports >= 3));
  const b = (await call("GET", "/batches/OIL-2026-001", {cookie: C.rev})).json;
  assert.equal(b.risk.assessed, true); assert.equal(b.risk.score, a.risk.score);
  assert.equal((await call("GET", "/public/batches/OIL-2026-001")).json.risk, undefined, "risk stays internal");
});

test("investigation reports: generation, idempotency, failed/retried submission, export, audit", async () => {
  const g1 = await call("POST", "/investigations/INV-015/report", {cookie: C.rev, body: {}});
  assert.equal(g1.status, 201, g1.text); assert.equal(g1.json.status, "generated");
  const g2 = await call("POST", "/investigations/INV-015/report", {cookie: C.rev, body: {}});
  assert.equal(g2.status, 200); assert.equal(g2.json.id, g1.json.id); assert.equal(g2.json.unchanged, true);
  assert.equal(await M.Report.countDocuments({investigation_id: "INV-015"}), 1, "no duplicate report");
  const rid = g1.json.id;
  const rep = (await call("GET", "/reports/" + rid, {cookie: C.rev})).json;
  assert.match(rep.content.notice, /FSSAI/); assert.equal(rep.content.demonstrationData, true);
  for (const k of ["complaints", "laboratory", "traceability", "hotspotAnalysis", "riskAssessment", "regulatoryStatus"]) assert.ok(rep.content[k], k);
  assert.ok(!JSON.stringify(rep.content).includes("@") && !JSON.stringify(rep.content).includes('"lat":18.5204,"lng":73.8567,"contact"'), "no contact details in report");
  assert.equal((await call("GET", "/reports/" + rid, {cookie: C.nashik})).status, 403);
  const fail = await call("POST", `/reports/${rid}/submit`, {cookie: C.rev, body: {simulate: "fail"}});
  assert.equal(fail.status, 502); assert.equal(fail.json.code, "SUBMISSION_FAILED"); assert.equal(fail.json.canRetry, true); assert.equal(fail.json.report.status, "failed");
  const retry = await call("POST", `/reports/${rid}/submit`, {cookie: C.rev, body: {}});
  assert.equal(retry.status, 200); assert.equal(retry.json.status, "sent"); assert.equal(retry.json.simulated, true); assert.equal(retry.json.submissions.length, 2);
  assert.match(retry.json.submissions[1].externalRef, /^SIM-/);
  assert.equal((await call("POST", `/reports/${rid}/submit`, {cookie: C.rev, body: {}})).status, 409, "cannot double-submit");
  assert.equal(await M.Report.countDocuments({investigation_id: "INV-015"}), 1);
  assert.equal(await M.Investigation.countDocuments({batch_id: "OIL-2026-001"}), 1, "no duplicate investigation");
  assert.equal((await call("POST", `/reports/${rid}/acknowledge`, {cookie: C.rev, body: {}})).json.status, "acknowledged");
  const js = await call("GET", `/reports/${rid}/export?format=json`, {cookie: C.rev});
  assert.equal(js.status, 200); assert.equal(JSON.parse(js.text).report.investigation.id, "INV-015");
  const pdf = await fetch(`${base}/reports/${rid}/export?format=pdf`, {headers: {Cookie: C.rev, "X-TraceX-Client": "web"}});
  const bytes = Buffer.from(await pdf.arrayBuffer());
  assert.equal(pdf.headers.get("content-type"), "application/pdf"); assert.equal(bytes.subarray(0, 5).toString(), "%PDF-"); assert.ok(bytes.length > 1500);
  const actions = (await call("GET", "/admin/audit?limit=500", {cookie: C.admin})).json;
  for (const a of ["report.generated", "report.submission_failed", "report.submission_sent", "report.exported", "traceability.failed", "traceability.completed"]) assert.ok(actions.entries.some(e => e.action === a), "audited " + a);
  assert.deepEqual(actions.chain.ok, true, "audit hash chain intact");
});

test("regulatory decisions come only from the authority record, via reviewers", async () => {
  assert.equal((await call("POST", "/investigations/INV-015/decision", {cookie: C.rev, body: {decision: "recall_ordered"}})).status, 422, "authority reference required");
  assert.equal((await call("POST", "/investigations/INV-015/decision", {cookie: C.admin, body: {decision: "recall_ordered", authorityRef: "FSSAI-DEMO-1", decidedOn: "2026-10-01"}})).status, 403);
  const r = await call("POST", "/investigations/INV-015/decision", {cookie: C.rev, body: {decision: "recall_ordered", authorityRef: "FSSAI-DEMO-0001", decidedOn: "2026-10-01"}});
  assert.equal(r.status, 201); assert.equal(r.json.decisions[0].authority_ref, "FSSAI-DEMO-0001");
  const pub = (await call("GET", "/public/batches/OIL-2026-001")).json;
  assert.equal(pub.regulatory.status, "recall_ordered");
  assert.equal((await call("GET", "/public/batches/MILK-2026-004")).json.regulatory, null, "flagged batch is not shown as recalled");
});

test("users, provider role, analytics and simulation guards", async () => {
  const bad = await call("POST", "/admin/users", {cookie: C.admin, body: {email: "x@y.io", name: "Xy", role: "lab", password: "short"}});
  assert.equal(bad.status, 422);
  const created = await call("POST", "/admin/users", {cookie: C.admin, body: {email: "new.lab@tracex.demo", name: "New Lab", role: "lab", password: "a-long-password-123", labName: "New Lab", accreditationRef: "NABL-NEW-1"}});
  assert.equal(created.status, 201);
  assert.equal((await call("PATCH", `/admin/users/${(await call("GET", "/auth/me", {cookie: C.admin})).json.user.id}`, {cookie: C.admin, body: {active: false}})).status, 409, "no self-lockout");
  const rec = {records: [{stage: "Retail", party: "Provider Retail Node", at: new Date().toISOString(), lat: 18.5, lng: 73.85}]};
  assert.equal((await call("POST", "/provider/supply-chain/OIL-2026-001/records", {cookie: C.nashik, body: rec})).status, 403);
  assert.equal((await call("POST", "/provider/supply-chain/OIL-2026-001/records", {cookie: C.prov, body: {records: [{...rec.records[0], stage: "Farm"}]}})).status, 422, "stage must exist for the category");
  assert.equal((await call("POST", "/provider/supply-chain/OIL-2026-001/records", {cookie: C.prov, body: rec})).status, 201);
  const an = (await call("GET", "/analytics?category=edible_oil", {cookie: C.rev})).json;
  assert.ok(an.summary.batches === 1 && an.summary.complaints >= 5);
  assert.ok((await call("GET", "/analytics", {cookie: C.rev})).json.byCategory.length >= 5);
  const hs = (await call("GET", "/analytics/hotspots?category=dairy", {cookie: C.rev})).json;
  assert.ok(hs.length && hs.every(h => ["region", "lat", "lng", "radius", "severity", "reports", "batches", "lab", "open", "stage"].every(k => k in h)));
  assert.ok(hs.every(h => h.severity === (h.reports >= 10 ? "critical" : h.reports >= 5 ? "suspicious" : h.reports >= 3 ? "review" : "safe")), "map alert level is derived from report count, not batch status");
  const dash = (await call("GET", "/dashboard", {cookie: C.rev})).json;
  assert.ok(dash.events.length > 3 && dash.network.openInvestigations >= 1);
  const ig = (await call("GET", "/admin/integrations", {cookie: C.admin})).json;
  assert.equal(ig.supplyChain.mock, true); assert.equal(ig.fssai.simulated, true); assert.equal(ig.ocr.available, false);
  assert.equal((await call("GET", "/public/meta")).json.capabilities.ocr, false);
});

test("concurrency: simultaneous requests cannot create duplicates (no SQL constraints, so these guards matter)", async () => {
  // 1. double-click on the complaint form: same Idempotency-Key sent twice at once
  const before = await M.Complaint.countDocuments(), key = "race-key-0001-abcdef";
  const mk = () => call("POST", "/public/complaints", {form: complaintForm({identifier: "MILK-2026-002"}), headers: {"Idempotency-Key": key}});
  const [a, b] = await Promise.all([mk(), mk()]);
  assert.ok([a.status, b.status].every(s => s === 200 || s === 201), `statuses ${a.status}/${b.status}`);
  assert.equal(a.json.trackingCode, b.json.trackingCode, "both responses refer to the same complaint");
  assert.equal(await M.Complaint.countDocuments(), before + 1, "exactly one complaint stored");

  // 2. two lab uploads for the same open sample request at the same moment
  const srs = (await call("GET", "/lab/sample-requests?status=requested", {cookie: C.pune})).json, sr3 = srs.find(s => s.batch === "MILK-2026-003");
  assert.ok(sr3, "open sample request for MILK-2026-003");
  const labForm = () => { const fd = new FormData(); for (const [k, v] of Object.entries({sampleRequestId: sr3.id, batchId: "MILK-2026-003", accreditationRef: "NABL-DEMO-0002", outcome: "not_confirmed", results: JSON.stringify({fat: 6.7, snf: 9.0, water: "Negative"})})) fd.append(k, v); fd.append("report", new Blob([PDF], {type: "application/pdf"}), "r.pdf"); return fd; };
  const [l1, l2] = await Promise.all([call("POST", "/lab/reports", {cookie: C.pune, form: labForm()}), call("POST", "/lab/reports", {cookie: C.pune, form: labForm()})]);
  assert.deepEqual([l1.status, l2.status].sort(), [201, 409], "one wins, the other is told to submit a correction");
  assert.equal(await M.LabReport.countDocuments({sample_request_id: sr3.id, status: "submitted"}), 1, "one active report per sample request");

  // 3. two simultaneous submissions of the same investigation report
  await call("POST", "/investigations/INV-014/traceability", {cookie: C.rev, body: {}});
  const gen = await call("POST", "/investigations/INV-014/report", {cookie: C.rev, body: {}});
  assert.equal(gen.status, 201, gen.text);
  const [s1, s2] = await Promise.all([call("POST", `/reports/${gen.json.id}/submit`, {cookie: C.rev, body: {}}), call("POST", `/reports/${gen.json.id}/submit`, {cookie: C.rev, body: {}})]);
  assert.deepEqual([s1.status, s2.status].sort(), [200, 409], "exactly one submission goes through");
  assert.equal(await M.Submission.countDocuments({report_id: gen.json.id, status: "sent"}), 1, "sent exactly once");

  // 4. parallel generation of the same report returns one report
  const [g1, g2] = await Promise.all([call("POST", "/investigations/INV-014/report", {cookie: C.rev, body: {}}), call("POST", "/investigations/INV-014/report", {cookie: C.rev, body: {}})]);
  assert.ok([g1, g2].every(g => g.status === 200 || g.status === 201));
  assert.equal(await M.Report.countDocuments({investigation_id: "INV-014"}), 1);
  // 5. a lab report can never be rewritten through the model either
  await assert.rejects(M.LabReport.updateOne({_id: l1.status === 201 ? l1.json.id : l2.json.id}, {$set: {notes: "tampered"}}), /immutable/);
});
