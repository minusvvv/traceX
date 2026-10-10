import crypto from "node:crypto";
import {db, nowIso, nextId, tx, jparse} from "../db.js";
import {audit} from "../audit.js";
import {HttpError} from "../http.js";
import {loadBatch} from "../domain/batches.js";
import {getCategory} from "../domain/categories.js";
import {getSupplyChainProvider, ProviderUnavailableError} from "../providers/supplyChain/index.js";
import {getFssaiAdapter, SubmissionError} from "../providers/fssai/index.js";
import {computeRisk, RISK_METHOD} from "./risk.js";
import {addInvestigationEvent, createSampleRequest} from "./prioritization.js";
import {reportDto} from "./lab.js";
import {nearestRegion, regionByName} from "../geo.js";

export const REGULATORY_NOTICE = "Regulatory decisions, including any recall, remain the sole responsibility of FSSAI. TraceX provides decision support only; complaints are unverified consumer reports, and only a laboratory-confirmed result is treated as confirmed contamination.";
export const INV_STATUS_LABEL = {open: "Open", awaiting_lab: "Awaiting laboratory", lab_confirmed: "Laboratory confirmed", traced: "Traceability complete", report_ready: "Report generated", closed_unconfirmed: "Closed: not confirmed", closed: "Closed"};
const OPEN = ["open", "awaiting_lab", "lab_confirmed", "traced", "report_ready"];

const invRow = id => db.prepare("SELECT * FROM investigations WHERE id=?").get(id);
function mustGet(id) { const i = invRow(id); if (!i) throw new HttpError(404, `Investigation “${id}” not found.`); return i; }

export function listInvestigations({status, category, batch} = {}) {
  const rows = db.prepare(`SELECT i.*, p.name product_name, p.category FROM investigations i JOIN products p ON p.id=i.product_id ORDER BY i.opened_at DESC`).all();
  return rows.filter(i => (!batch || (i.batch_id || "").toLowerCase() === batch.toLowerCase()) && (!status || (status === "open" ? OPEN.includes(i.status) : i.status === status)) && (!category || i.category === category)).map(i => ({
    id: i.id, batch: i.batch_id, product: i.product_name, category: i.category, title: i.title, stage: i.stage || "—", status: INV_STATUS_LABEL[i.status], statusKey: i.status,
    opened: i.opened_at, owner: i.owner, isOpen: OPEN.includes(i.status)}));
}

export function getInvestigation(id) {
  const i = mustGet(id), batch = i.batch_id ? loadBatch(i.batch_id) : null;
  const product = db.prepare("SELECT id,name,category,brand,manufacturer FROM products WHERE id=?").get(i.product_id);
  const labs = i.batch_id ? db.prepare("SELECT id FROM lab_reports WHERE batch_id=? COLLATE NOCASE ORDER BY submitted_at DESC").all(i.batch_id).map(r => reportDto(r.id)) : [];
  const complaints = db.prepare(`SELECT id, created_at date, description text, region FROM complaints WHERE ${i.batch_id ? "batch_id=? COLLATE NOCASE" : "product_id=? AND batch_id IS NULL"} ORDER BY created_at DESC`)
    .all(i.batch_id || i.product_id);
  const a = db.prepare("SELECT * FROM investigation_analysis WHERE investigation_id=?").get(id);
  const reports = db.prepare("SELECT id FROM reports WHERE investigation_id=? ORDER BY version DESC").all(id).map(r => reportSummary(r.id));
  const samples = db.prepare("SELECT id,status,requested_at,assigned_lab,reason FROM sample_requests WHERE investigation_id=? ORDER BY requested_at DESC").all(id);
  return {
    id: i.id, batch: i.batch_id, title: i.title, stage: i.stage || "—", status: INV_STATUS_LABEL[i.status], statusKey: i.status, opened: i.opened_at, closedAt: i.closed_at, closureReason: i.closure_reason,
    owner: i.owner, summary: i.summary, product, batchInfo: batch,
    timeline: db.prepare("SELECT at t, title, state, note FROM investigation_events WHERE investigation_id=? ORDER BY at, id").all(id),
    labs, complaints, sampleRequests: samples,
    labConfirmed: labs.some(l => l.outcome === "confirmed" && l.reportStatus === "submitted"),
    analysis: a ? {trace: jparse(a.trace), hotspots: jparse(a.hotspots), risk: jparse(a.risk), provider: jparse(a.provider), warnings: jparse(a.warnings, []), computedAt: a.computed_at} : null,
    reports,
    decisions: db.prepare(`SELECT d.id,d.decision,d.authority_ref,d.notes,d.decided_on,d.recorded_at,u.name recorded_by FROM regulatory_decisions d LEFT JOIN users u ON u.id=d.recorded_by WHERE d.investigation_id=? ORDER BY d.id DESC`).all(id),
    notice: REGULATORY_NOTICE,
  };
}

// ---- Traceability (only after a laboratory report confirms contamination) -------------------------------------------
function confirmedReport(batchId) {
  return db.prepare("SELECT * FROM lab_reports WHERE batch_id=? COLLATE NOCASE AND outcome='confirmed' AND status='submitted' ORDER BY submitted_at DESC").get(batchId);
}

export async function runTraceability(user, id, {simulate} = {}) {
  const inv = mustGet(id);
  if (!inv.batch_id) throw new HttpError(409, "The affected batch has not been identified yet; traceability needs a batch.", {code: "BATCH_UNKNOWN"});
  if (!OPEN.includes(inv.status)) throw new HttpError(409, "This investigation is closed.", {code: "CLOSED"});
  const lab = confirmedReport(inv.batch_id);
  if (!lab) throw new HttpError(409, "Traceability starts only after a laboratory report confirms contamination. No confirmed report exists for this batch.", {code: "LAB_NOT_CONFIRMED"});
  const batch = loadBatch(inv.batch_id), provider = getSupplyChainProvider();
  let chain;
  try { chain = await provider.fetchChain(batch.id, {simulate}); }
  catch (e) {
    const known = e instanceof ProviderUnavailableError;
    console.error(`[traceability] provider ${provider.name} failed for ${batch.id}:`, e.message);
    audit(user, "traceability.failed", "investigation", id, {provider: provider.name, error: e.message});
    throw new HttpError(502, known ? "The supply-chain data provider is unavailable or has no data for this batch. Traceability could not be completed. Nothing was changed; please try again later." : "Traceability failed unexpectedly. Nothing was changed.", {code: "PROVIDER_UNAVAILABLE", provider: provider.name, mock: provider.mock});
  }
  const trace = buildTrace(batch, chain);
  const complaints = db.prepare("SELECT region, COUNT(*) n FROM complaints WHERE batch_id=? COLLATE NOCASE AND region IS NOT NULL GROUP BY region").all(batch.id);
  const total = db.prepare("SELECT COUNT(*) n FROM complaints WHERE batch_id=? COLLATE NOCASE").get(batch.id).n;
  const hotspots = buildHotspots(batch, trace, complaints);
  const regions = new Set([...trace.summary.regions, ...complaints.map(c => c.region)]);
  const risk = computeRisk({complaintCount: total, distributionNodes: trace.destinations, regionsReached: regions.size, severity: lab.severity});
  const warnings = [...chain.warnings, ...trace.warnings];
  const providerInfo = {name: provider.name, mock: provider.mock, complete: chain.complete};
  tx(() => {
    db.prepare(`INSERT INTO investigation_analysis(investigation_id,trace,hotspots,risk,provider,warnings,computed_at,computed_by) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(investigation_id) DO UPDATE SET trace=excluded.trace,hotspots=excluded.hotspots,risk=excluded.risk,provider=excluded.provider,warnings=excluded.warnings,computed_at=excluded.computed_at,computed_by=excluded.computed_by`)
      .run(id, JSON.stringify(trace), JSON.stringify(hotspots), JSON.stringify(risk), JSON.stringify(providerInfo), JSON.stringify(warnings), nowIso(), user.id);
    if (["lab_confirmed", "traced"].includes(inv.status)) db.prepare("UPDATE investigations SET status='traced' WHERE id=?").run(id);
    addInvestigationEvent(id, "Traceability and risk assessment completed", warnings.length ? "alert" : "done",
      `${trace.destinations} destination(s), ${trace.backward.length} upstream record(s) · risk ${risk.level} (${risk.score}/100)${warnings.length ? " · incomplete data" : ""}`, "trace");
    audit(user, "traceability.completed", "investigation", id, {provider: provider.name, mock: provider.mock, complete: chain.complete, warnings, risk: {score: risk.score, level: risk.level}});
  });
  return getInvestigation(id);
}

// Only places that RECEIVED the batch count towards reach; e.g. packaging at the manufacturer's own site does not.
const isDestination = n => ["storage", "distribution", "retail"].includes(n.kind);
function buildTrace(batch, chain) {
  const place = r => ({stage: r.stage, kind: r.kind, party: r.party, role: r.role, place: r.place, lat: r.lat, lng: r.lng, region: r.region || nearestRegion(r.lat, r.lng)?.name || null, at: r.at});
  const recs = chain.records.map(r => ({...r, ...place(r)}));
  const backward = recs.filter(r => ["manufacturer", "upstream"].includes(r.side)).sort((a, b) => b.at.localeCompare(a.at)).map(place);
  const forward = recs.filter(r => r.side === "downstream").sort((a, b) => a.at.localeCompare(b.at)).map(place);
  const warnings = [];
  if (!recs.some(r => r.side === "manufacturer")) warnings.push("No manufacturer record was found for this batch.");
  if (!forward.length) warnings.push("No downstream (forward) records were found; distribution may be incomplete.");
  if ([...backward, ...forward].some(r => r.lat == null)) warnings.push("Some records have no location and cannot be shown on the map.");
  const mf = backward.find(r => recs.find(x => x.stage === r.stage && x.side === "manufacturer"));
  return {batchId: batch.id, manufacturer: mf?.party || batch.manufacturer, facility: batch.facility, backward, forward,
    destinations: forward.filter(isDestination).length,
    summary: {upstream: backward.length, downstream: forward.length, regions: [...new Set(forward.filter(isDestination).map(n => n.region).filter(Boolean))]}, warnings, fetchedAt: nowIso()};
}

function buildHotspots(batch, trace, complaintRegions) {
  const map = new Map();
  const slot = name => { const r = regionByName(name); if (!r) return null; return map.get(r.name) || map.set(r.name, {region: r.name, lat: r.lat, lng: r.lng, reports: 0, nodes: 0}).get(r.name); };
  for (const c of complaintRegions) { const s = slot(c.region); if (s) s.reports += c.n; }
  for (const n of trace.forward.filter(isDestination)) { const s = slot(n.region); if (s) s.nodes++; }
  const confirmed = batch.labStatus === "confirmed";
  return [...map.values()].map(s => ({region: s.region, lat: s.lat, lng: s.lng, radius: Math.min(26000, 8000 + (s.reports + s.nodes) * 2500),
    severity: s.reports && confirmed ? "critical" : s.reports ? "suspicious" : "review", reports: s.reports, batches: 1, lab: confirmed ? 1 : 0, open: 1, stage: batch.anomaly?.flagged || "—", distributionNodes: s.nodes}))
    .sort((a, b) => b.reports + b.distributionNodes - (a.reports + a.distributionNodes));
}

// ---- Reports ------------------------------------------------------------------------------------------------------
function buildReportContent(inv) {
  const d = getInvestigation(inv.id), b = d.batchInfo, lab = d.labs.find(l => l.outcome === "confirmed" && l.reportStatus === "submitted");
  const byRegion = {}; for (const c of d.complaints) if (c.region) byRegion[c.region] = (byRegion[c.region] || 0) + 1;
  const dec = d.decisions[0];
  return {
    schema: "tracex.investigation-report.v1", demonstrationData: !!b.isDemo, notice: REGULATORY_NOTICE,
    investigation: {id: d.id, title: d.title, openedAt: d.opened, stageRequiringInvestigation: d.stage}, // status omitted on purpose: it changes after generation and would defeat de-duplication
    product: {name: b.product, category: b.categoryLabel, brand: b.brand, manufacturer: b.manufacturer},
    batch: {id: b.id, lot: b.lot, quantity: b.qty, manufacturedOn: b.manufacturedOn, expiresOn: b.expiresOn, facility: b.facility, destination: b.destination?.place || null},
    complaints: {total: d.complaints.length, byRegion: Object.entries(byRegion).map(([region, count]) => ({region, count})),
      first: d.complaints.at(-1)?.date || null, latest: d.complaints[0]?.date || null,
      excerpts: d.complaints.slice(0, 10).map(c => ({id: c.id, date: c.date, region: c.region, text: c.text.slice(0, 300)})),
      caveat: "Consumer complaints are unverified. Contact details and precise locations are excluded from this report."},
    laboratory: {reportId: lab.id, laboratory: lab.lab, accreditationRef: lab.accreditationRef, submittedAt: lab.date, outcome: lab.outcome, contaminationType: lab.contaminationType, severity: lab.severity,
      results: lab.resultRows, notes: lab.note, attachments: lab.attachments.map(a => ({name: a.name, sha256: a.sha256}))},
    traceability: {provider: d.analysis.provider, backward: d.analysis.trace.backward, forward: d.analysis.trace.forward, warnings: d.analysis.warnings},
    hotspotAnalysis: d.analysis.hotspots, riskAssessment: d.analysis.risk,
    regulatoryStatus: dec ? {decision: dec.decision, authorityRef: dec.authority_ref, decidedOn: dec.decided_on} : {decision: "none", note: "No regulatory decision has been recorded in TraceX."},
  };
}

export function generateReport(user, id) {
  const inv = mustGet(id);
  if (!OPEN.includes(inv.status)) throw new HttpError(409, "This investigation is closed.", {code: "CLOSED"});
  const missing = [];
  if (!inv.batch_id || !confirmedReport(inv.batch_id)) missing.push("a laboratory report confirming contamination");
  const a = db.prepare("SELECT 1 FROM investigation_analysis WHERE investigation_id=?").get(id);
  if (!a) missing.push("completed traceability, hotspot analysis and risk assessment");
  if (missing.length) throw new HttpError(409, `A report cannot be generated yet. Still required: ${missing.join(" and ")}.`, {code: "PREREQUISITES_MISSING", missing});
  const content = buildReportContent(inv), hash = crypto.createHash("sha256").update(JSON.stringify(content)).digest("hex");
  const latest = db.prepare("SELECT * FROM reports WHERE investigation_id=? ORDER BY version DESC").get(id);
  if (latest && latest.content_sha256 === hash) return {...reportSummary(latest.id), unchanged: true};
  return tx(() => {
    const rid = nextId("reports", "RPT", 1000), version = (latest?.version || 0) + 1, at = nowIso();
    db.prepare("INSERT INTO reports(id,investigation_id,version,content,content_sha256,generated_by,generated_at) VALUES(?,?,?,?,?,?,?)").run(rid, id, version, JSON.stringify(content), hash, user.id, at);
    db.prepare("UPDATE investigations SET status='report_ready' WHERE id=? AND status IN ('lab_confirmed','traced','report_ready')").run(id);
    addInvestigationEvent(id, `Investigation report ${rid} generated (v${version})`, "done", "Not yet submitted", "report", at);
    audit(user, "report.generated", "report", rid, {investigationId: id, version, sha256: hash});
    return {...reportSummary(rid), unchanged: false};
  });
}

export function reportSummary(rid) {
  const r = db.prepare("SELECT r.id,r.investigation_id,r.version,r.generated_at,r.content_sha256,u.name generated_by FROM reports r LEFT JOIN users u ON u.id=r.generated_by WHERE r.id=?").get(rid);
  if (!r) throw new HttpError(404, "Report not found.");
  const subs = db.prepare("SELECT attempt,adapter,simulated,status,external_ref,error,attempted_at FROM report_submissions WHERE report_id=? ORDER BY id").all(rid)
    .map(s => ({attempt: s.attempt, adapter: s.adapter, simulated: !!s.simulated, status: s.status, externalRef: s.external_ref, error: s.error, at: s.attempted_at}));
  const last = subs.at(-1);
  return {id: r.id, investigationId: r.investigation_id, version: r.version, generatedAt: r.generated_at, generatedBy: r.generated_by, sha256: r.content_sha256,
    status: last ? last.status : "generated", submissions: subs, simulated: subs.some(s => s.simulated)};
}
export function getReport(rid) {
  const r = db.prepare("SELECT content FROM reports WHERE id=?").get(rid);
  if (!r) throw new HttpError(404, "Report not found.");
  return {...reportSummary(rid), content: JSON.parse(r.content)};
}

export async function submitReport(user, rid, {simulate} = {}) {
  const sum = reportSummary(rid), adapter = getFssaiAdapter();
  if (["sent", "acknowledged"].includes(sum.status)) throw new HttpError(409, `This report was already ${sum.status === "sent" ? "sent" : "acknowledged"} (${adapter.simulated ? "simulated" : "live"}). It cannot be submitted again.`, {code: "ALREADY_SUBMITTED"});
  const attempt = (sum.submissions.filter(s => s.status !== "acknowledged").length) + 1;
  const full = getReport(rid);
  let result = null, error = null;
  try { result = await adapter.submit({id: rid, content: full.content}, {attempt, simulate}); }
  catch (e) { error = e instanceof SubmissionError ? e.message : "Unexpected submission error."; if (!(e instanceof SubmissionError)) console.error("[submit]", e); }
  tx(() => {
    db.prepare("INSERT INTO report_submissions(report_id,attempt,adapter,simulated,status,external_ref,error,attempted_at,attempted_by) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(rid, attempt, adapter.name, adapter.simulated ? 1 : 0, error ? "failed" : "sent", result?.externalRef || null, error, nowIso(), user.id);
    audit(user, error ? "report.submission_failed" : "report.submission_sent", "report", rid, {attempt, adapter: adapter.name, simulated: adapter.simulated, error});
    addInvestigationEvent(sum.investigationId, error ? `Report submission attempt ${attempt} failed${adapter.simulated ? " (simulated)" : ""}` : `Report marked as sent${adapter.simulated ? " (SIMULATED: not transmitted to FSSAI)" : ""}`,
      error ? "alert" : "done", error || result.externalRef, "submission");
  });
  const out = reportSummary(rid);
  if (error) throw new HttpError(502, `${error}`, {code: "SUBMISSION_FAILED", report: out, canRetry: true});
  return out;
}

export function simulateAcknowledgement(user, rid) {
  const adapter = getFssaiAdapter(), sum = reportSummary(rid);
  if (!adapter.simulated) throw new HttpError(409, "Acknowledgements come from the real channel.");
  if (sum.status !== "sent") throw new HttpError(409, sum.status === "acknowledged" ? "Already acknowledged." : "Only a sent report can be acknowledged.");
  const sent = sum.submissions.filter(s => s.status === "sent").at(-1);
  tx(() => {
    db.prepare("INSERT INTO report_submissions(report_id,attempt,adapter,simulated,status,external_ref,attempted_at,attempted_by) VALUES(?,?,?,?,?,?,?,?)").run(rid, sent.attempt, adapter.name, 1, "acknowledged", sent.externalRef, nowIso(), user.id);
    audit(user, "report.acknowledged_simulated", "report", rid, {externalRef: sent.externalRef});
    addInvestigationEvent(sum.investigationId, "Acknowledgement received (SIMULATED)", "done", "Simulated acknowledgement; no real FSSAI response", "submission");
  });
  return reportSummary(rid);
}

// ---- Reviewer actions ---------------------------------------------------------------------------------------------
export function recordDecision(user, id, d) {
  const inv = mustGet(id);
  tx(() => {
    db.prepare("INSERT INTO regulatory_decisions(investigation_id,batch_id,decision,authority_ref,notes,decided_on,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(id, inv.batch_id, d.decision, d.authorityRef, d.notes || null, d.decidedOn, user.id, nowIso());
    audit(user, "regulatory_decision.recorded", "investigation", id, {decision: d.decision, authorityRef: d.authorityRef, decidedOn: d.decidedOn});
    addInvestigationEvent(id, `FSSAI decision recorded: ${d.decision.replace(/_/g, " ")}`, "done", `Authority reference ${d.authorityRef}. Recorded by a reviewer; TraceX does not make this decision.`, "decision");
  });
  return getInvestigation(id);
}

export function closeInvestigation(user, id, reason) {
  const inv = mustGet(id);
  if (!OPEN.includes(inv.status)) throw new HttpError(409, "This investigation is already closed.");
  tx(() => {
    db.prepare("UPDATE investigations SET status='closed', closed_at=?, closure_reason=? WHERE id=?").run(nowIso(), reason, id);
    audit(user, "investigation.status_changed", "investigation", id, {from: inv.status, to: "closed", reason});
    addInvestigationEvent(id, "Investigation closed", "done", reason, "closed");
  });
  return getInvestigation(id);
}

export function requestSample(user, id, {assignedLab, reason}) {
  const inv = mustGet(id);
  if (!OPEN.includes(inv.status)) throw new HttpError(409, "This investigation is closed.");
  const open = db.prepare("SELECT id FROM sample_requests WHERE investigation_id=? AND status IN ('requested')").get(id);
  if (open) throw new HttpError(409, `Sample request ${open.id} is already open for this investigation.`);
  return tx(() => createSampleRequest({batchId: inv.batch_id, productId: inv.product_id, flagId: inv.flag_id, investigationId: id, reason: reason || "Requested by reviewer", actor: user, assignedLab: assignedLab || null}));
}

// ---- Provider-supplied records (external supply-chain data provider role) ----------------------------------------
export function addProviderRecords(user, batchId, records) {
  const b = loadBatch(batchId);
  if (!b) throw new HttpError(404, "Batch not found.");
  const cat = getCategory(b.category), errors = {};
  records.forEach((r, i) => { if (!cat.stages.some(s => s.name === r.stage)) errors[`records.${i}.stage`] = `Not a stage for ${cat.label}: use one of ${cat.stages.map(s => s.name).join(", ")}`; });
  if (Object.keys(errors).length) throw new HttpError(422, "Some records are invalid.", {fields: errors});
  return tx(() => {
    const ins = db.prepare("INSERT INTO supply_chain_records(batch_id,stage,party_name,party_role,lat,lng,region,occurred_at,readings,notes,quality_score,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)");
    for (const r of records) ins.run(b.id, r.stage, r.party, r.role || null, r.lat ?? null, r.lng ?? null, r.region || nearestRegion(r.lat, r.lng)?.name || null, r.at, r.readings ? JSON.stringify(r.readings) : null, r.notes || null, r.qualityScore ?? null, `provider:${user.email}`);
    audit(user, "provider.records_added", "batch", b.id, {count: records.length});
    return {added: records.length};
  });
}
