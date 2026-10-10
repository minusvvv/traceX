// Integration tests: start the real Express app on an ephemeral port against a fresh temp database.
import {test, before, after} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tracex-"));
Object.assign(process.env, {DB_PATH: path.join(tmp, "t.db"), UPLOAD_DIR: path.join(tmp, "up"), RATE_LIMIT: "false", DEMO_PASSWORD: "test-Passw0rd-2026",
  JWT_SECRET: "test-secret", NODE_ENV: "test", ALLOW_SIMULATION: "true", MOCK_FSSAI_MODE: "ok", MOCK_SUPPLY_CHAIN_MODE: "ok"});
const PW = process.env.DEMO_PASSWORD;
let server, base, db;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const PDF = Buffer.from("%PDF-1.4\n%demo\n%%EOF");

before(async () => {
  const {seedDemo} = await import("../src/seed.js");
  ({db} = await import("../src/db.js"));
  const {createApp} = await import("../src/app.js");
  const {seedThresholds} = await import("../src/services/thresholds.js");
  seedThresholds(); await seedDemo();
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); fs.rmSync(tmp, {recursive: true, force: true}); });

async function call(method, url, {body, form, cookie, headers = {}} = {}) {
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
  assert.equal((await call("GET", "/investigations", {cookie: C.nashik})).status, 403, "lab cannot read investigations");
  assert.equal((await call("GET", "/analytics/hotspots", {cookie: C.nashik})).status, 403, "lab cannot read internal hotspots");
  assert.equal((await call("GET", "/analytics/hotspots")).status, 401, "anonymous cannot read internal hotspots");
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

  const before = db.prepare("SELECT COUNT(*) n FROM complaints").get().n;
  const ok = complaintForm({identifier: "BEV-2026-001", regionKey: "pune", contact: "consumer@example.com"}); ok.append("photos", png("p.png"), "p.png"); ok.append("productImage", png("l.png"), "l.png");
  const key = "idem-key-0001-abcdef";
  const a = await call("POST", "/public/complaints", {form: ok, headers: {"Idempotency-Key": key}});
  assert.equal(a.status, 201); assert.match(a.json.trackingCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/); assert.equal(a.json.matched, "batch"); assert.equal(a.json.attachments, 2);
  assert.ok(!a.text.includes("consumer@example.com") && !("lat" in a.json) && !("contact" in a.json), "no PII echoed");
  const again = complaintForm({identifier: "BEV-2026-001", regionKey: "pune"});
  const b = await call("POST", "/public/complaints", {form: again, headers: {"Idempotency-Key": key}});
  assert.equal(b.status, 200); assert.equal(b.json.duplicate, true); assert.equal(b.json.trackingCode, a.json.trackingCode);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM complaints").get().n, before + 1, "duplicate click created one complaint");
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
  const rows = db.prepare("SELECT batch_id, sample_requested_at s FROM complaints WHERE batch_id IS NOT NULL").all();
  assert.ok(rows.filter(r => r.batch_id === "BEV-2026-001").every(r => r.s), "related complaints get sample follow-up");
  assert.ok(rows.filter(r => r.batch_id === "SNK-2026-001").every(r => !r.s), "unrelated consumers do not");
  assert.ok(rows.filter(r => r.batch_id === "MILK-2026-002").every(r => !r.s));
  const linked = db.prepare("SELECT COUNT(*) n FROM sample_request_complaints l JOIN sample_requests s ON s.id=l.sample_request_id JOIN complaints c ON c.id=l.complaint_id WHERE c.batch_id IS NOT s.batch_id").get().n;
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
  assert.throws(() => db.prepare("UPDATE lab_reports SET outcome='not_confirmed' WHERE id=?").run(C.lab4), /immutable/);
  assert.throws(() => db.prepare("DELETE FROM lab_reports WHERE id=?").run(C.lab4), /cannot be deleted/);
  assert.throws(() => db.prepare("UPDATE audit_log SET action='x'").run(), /append-only/);
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
  assert.equal(db.prepare("SELECT status FROM lab_reports WHERE id=?").get(C.lab4).status, "superseded");
  assert.equal(db.prepare("SELECT outcome FROM lab_reports WHERE id=?").get(C.lab4).outcome, "confirmed", "original content preserved");
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
  assert.equal(db.prepare("SELECT COUNT(*) n FROM reports WHERE investigation_id='INV-015'").get().n, 1, "no duplicate report");
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
  assert.equal(db.prepare("SELECT COUNT(*) n FROM reports WHERE investigation_id='INV-015'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM investigations WHERE batch_id='OIL-2026-001'").get().n, 1, "no duplicate investigation");
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
  const dash = (await call("GET", "/dashboard", {cookie: C.rev})).json;
  assert.ok(dash.events.length > 3 && dash.network.openInvestigations >= 1);
  const ig = (await call("GET", "/admin/integrations", {cookie: C.admin})).json;
  assert.equal(ig.supplyChain.mock, true); assert.equal(ig.fssai.simulated, true); assert.equal(ig.ocr.available, false);
  assert.equal((await call("GET", "/public/meta")).json.capabilities.ocr, false);
});
