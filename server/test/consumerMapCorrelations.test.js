import {test, before, after} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tracex-correlations-"));
Object.assign(process.env, {
  MONGO_URI: (process.env.MONGO_URI_TEST || "mongodb://127.0.0.1:27017/").replace(/\/?$/, "") + "/tracex_corr_test_" + Date.now(),
  UPLOAD_DIR: path.join(tmp, "up"),
  RATE_LIMIT: "false",
  DEMO_PASSWORD: "test-Passw0rd-2026",
  JWT_SECRET: "test-secret",
  NODE_ENV: "test",
  ALLOW_SIMULATION: "true",
  MOCK_FSSAI_MODE: "ok",
  MOCK_SUPPLY_CHAIN_MODE: "ok",
});

const PW = process.env.DEMO_PASSWORD;
let server, base, M, consumerCookie, consumerUser;

before(async () => {
  const {seedDemo} = await import("../src/seed.js");
  M = await import("../src/db.js");
  await M.connectDb();
  const {createApp} = await import("../src/app.js");
  const {seedThresholds} = await import("../src/services/thresholds.js");
  await seedThresholds();
  await seedDemo();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;

  // Register consumer
  const reg = await fetch(base + "/auth/register", {
    method: "POST",
    headers: {"Content-Type": "application/json", "X-TraceX-Client": "web"},
    body: JSON.stringify({name: "Map Test User", email: "mapuser@example.com", password: PW}),
  });
  assert.equal(reg.status, 201, "consumer registration");
  consumerCookie = reg.headers.get("set-cookie").split(";")[0];
  const me = await fetch(base + "/auth/me", {
    headers: {"X-TraceX-Client": "web", Cookie: consumerCookie},
  });
  consumerUser = (await me.json()).user;
});

after(async () => {
  if (server) server.close();
  if (M) {
    await M.dropDatabase();
    await M.disconnectDb();
  }
  fs.rmSync(tmp, {recursive: true, force: true});
});

async function call(method, url, {body, form, cookie, headers = {}} = {}) {
  const h = {"X-TraceX-Client": "web", ...headers};
  if (cookie) h.Cookie = cookie;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    h["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + url, {method, headers: h, body: payload});
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return {status: res.status, json, text, headers: res.headers};
}

const complaintForm = (o = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({description: "Testing complaint on map dot and batch correlations.", ...o})) {
    if (v !== undefined) f.append(k, v);
  }
  return f;
};

test("Requirement 1: DO NOT block or restrict users from submitting multiple complaints for the same product or batch", async () => {
  const batchId = "MILK-2026-001";
  
  // Submit first complaint for MILK-2026-001
  const res1 = await call("POST", "/public/complaints", {
    cookie: consumerCookie,
    form: complaintForm({identifier: batchId, regionKey: "pune", description: "First report on MILK-2026-001"}),
  });
  assert.equal(res1.status, 201, "First complaint for batch must succeed");
  assert.ok(res1.json.trackingCode);

  // Submit second complaint for the IDENTICAL batch by the SAME user
  const res2 = await call("POST", "/public/complaints", {
    cookie: consumerCookie,
    form: complaintForm({identifier: batchId, regionKey: "pune", description: "Second report on MILK-2026-001 by same consumer"}),
  });
  assert.equal(res2.status, 201, "Second complaint for same batch by same user MUST succeed with 201 (not blocked)");
  assert.ok(res2.json.trackingCode);
  assert.notEqual(res1.json.trackingCode, res2.json.trackingCode);

  // Submit third complaint for the identical batch
  const res3 = await call("POST", "/public/complaints", {
    cookie: consumerCookie,
    form: complaintForm({identifier: batchId, regionKey: "solapur", description: "Third report on MILK-2026-001 from another region"}),
  });
  assert.equal(res3.status, 201, "Third complaint for same batch by same user MUST also succeed");
});

test("Requirement 2 & 3: /api/public/correlations returns rich node data and dynamic sizing info", async () => {
  const res = await call("GET", "/public/correlations?days=90");
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.json.nodes));
  assert.ok(Array.isArray(res.json.connections));
  assert.ok(Array.isArray(res.json.batches));

  // Check that nodes have all required rich popup fields:
  // Product Name, Batch Identifier / LOT code, Severity level, Number of complaints recorded
  const milkNode = res.json.nodes.find(n => n.batchId === "MILK-2026-001");
  assert.ok(milkNode, "Found node for MILK-2026-001");
  assert.ok(milkNode.productName, "Node must have productName");
  assert.equal(milkNode.batchId, "MILK-2026-001");
  assert.ok(milkNode.lot, "Node must have lot number");
  assert.ok(["safe", "review", "suspicious", "critical"].includes(milkNode.severity.toLowerCase()), "Node must have valid severity level");
  assert.ok(typeof milkNode.count === "number" && milkNode.count >= 1, "Node must report count of complaints recorded");
  assert.ok(milkNode.lat && milkNode.lng, "Node must have coordinates");
});

test("Requirement 4: Categorical & Batch-Specific Color Palette & Network Lines", async () => {
  // All Categories view
  const allRes = await call("GET", "/public/correlations?days=90");
  assert.equal(allRes.status, 200);
  assert.ok(allRes.json.connections.length > 0, "Connections must exist between transit points and complaints");

  for (const conn of allRes.json.connections) {
    assert.ok(conn.batchId, "Connection must have batchId");
    assert.ok(conn.category, "Connection must have category for category coloring in All view");
    assert.ok(conn.points.length >= 2, "Connection must link points across supply chain / regions");
  }

  // Individual category view: Milk / dairy
  const dairyRes = await call("GET", "/public/correlations?category=dairy&days=90");
  assert.equal(dairyRes.status, 200);
  assert.ok(dairyRes.json.nodes.every(n => n.category === "dairy"), "Only dairy complaints returned");
  assert.ok(dairyRes.json.connections.every(c => c.category === "dairy"), "Only dairy connections returned");
  // Connections break down by separate batches
  const batchSet = new Set(dairyRes.json.connections.map(c => c.batchId));
  assert.ok(batchSet.size >= 1, "Dairy batches are separated");
});

test("Requirement 5: Multi-Level Map Views & Filters (City, My Complaints, Category)", async () => {
  // City Filter: Pune
  const puneRes = await call("GET", "/public/correlations?city=Pune");
  assert.equal(puneRes.status, 200);
  for (const n of puneRes.json.nodes) {
    assert.match(n.region.toLowerCase(), /pune/i, "Filtered nodes belong to Pune");
  }

  // My Complaints Filter: userId
  const myRes = await call("GET", `/public/correlations?userId=${consumerUser.id}`);
  assert.equal(myRes.status, 200);
  assert.ok(myRes.json.nodes.length >= 1, "Consumer's own submitted complaints are returned");
  for (const n of myRes.json.nodes) {
    assert.equal(n.isOwn, true, "Nodes are flagged as isOwn");
  }

  // /api/public/complaints endpoint
  const complaintsRes = await call("GET", "/public/complaints?days=90");
  assert.equal(complaintsRes.status, 200);
  assert.ok(Array.isArray(complaintsRes.json.complaints));
  assert.ok(complaintsRes.json.total >= 1);

  // /api/public/heatmap with minReports=1
  const heatRes = await call("GET", "/public/heatmap?minReports=1");
  assert.equal(heatRes.status, 200);
  assert.ok(heatRes.json.cells.length > 0);
  assert.ok(heatRes.json.cells.some(c => c.reports >= 1));
});
