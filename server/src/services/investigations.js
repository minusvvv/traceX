import crypto from "node:crypto";
import {Investigation, InvEvent, Product, Complaint, Analysis, Report, Submission, Decision, SampleRequest, LabReport, SupplyRecord, User, nowIso, nextId, tx, up} from "../db.js";
import {audit} from "../audit.js";
import {HttpError} from "../http.js";
import {loadBatch} from "../domain/batches.js";
import {getCategory} from "../domain/categories.js";
import {getSupplyChainProvider, ProviderUnavailableError} from "../providers/supplyChain/index.js";
import {getFssaiAdapter, SubmissionError} from "../providers/fssai/index.js";
import {computeRisk, RISK_METHOD} from "./risk.js";
import {addInvestigationEvent, createSampleRequest} from "./prioritization.js";
import {reportDtos} from "./lab.js";
import {nearestRegion, regionByName} from "../geo.js";

export const REGULATORY_NOTICE = "Regulatory decisions, including any recall, remain the sole responsibility of FSSAI. TraceX provides decision support only; complaints are unverified consumer reports, and only a laboratory-confirmed result is treated as confirmed contamination.";
export const INV_STATUS_LABEL = {open: "Open", awaiting_lab: "Awaiting laboratory", lab_confirmed: "Laboratory confirmed", traced: "Traceability complete", report_ready: "Report generated", closed_unconfirmed: "Closed: not confirmed", closed: "Closed"};
const OPEN = ["open", "awaiting_lab", "lab_confirmed", "traced", "report_ready"];

const mustGet = async id => { const i = await Investigation.findById(id).lean(); if (!i) throw new HttpError(404, `Investigation “${id}” not found.`); return i; };
const userNames = async ids => new Map((await User.find({_id: {$in: [...new Set(ids.filter(Boolean))]}}).select("name").lean().catch(() => [])).map(u => [String(u._id), u.name]));

export async function listInvestigations({status, category, batch} = {}) {
  const rows = await Investigation.find().sort({opened_at: -1}).lean();
  const prods = new Map((await Product.find({_id: {$in: [...new Set(rows.map(i => i.product_id))]}}).lean()).map(p => [p._id, p]));
  return rows.map(i => ({...i, product_name: prods.get(i.product_id)?.name, category: prods.get(i.product_id)?.category}))
    .filter(i => (!batch || (i.batch_id || "").toLowerCase() === batch.toLowerCase()) && (!status || (status === "open" ? OPEN.includes(i.status) : i.status === status)) && (!category || i.category === category))
    .map(i => ({id: i._id, batch: i.batch_id ?? null, product: i.product_name, category: i.category, title: i.title, stage: i.stage || "—", status: INV_STATUS_LABEL[i.status], statusKey: i.status, opened: i.opened_at, owner: i.owner, isOpen: OPEN.includes(i.status)}));
}

export async function getInvestigation(id) {
  const i = await mustGet(id), batch = i.batch_id ? await loadBatch(i.batch_id) : null;
  const product = await Product.findById(i.product_id).lean();
  const labs = i.batch_id ? await reportDtos(await LabReport.find({batch_id: i.batch_id}).sort({submitted_at: -1}).lean()) : [];
  const complaints = (await Complaint.find(i.batch_id ? {batch_id: i.batch_id} : {product_id: i.product_id, batch_id: null}).sort({created_at: -1}).lean()).map(c => ({id: c._id, date: c.created_at, text: c.description, region: c.region ?? null}));
  const a = await Analysis.findById(id).lean();
  const reports = await Promise.all((await Report.find({investigation_id: id}).sort({version: -1}).select("_id").lean()).map(r => reportSummary(r._id)));
  const samples = (await SampleRequest.find({investigation_id: id}).sort({requested_at: -1}).lean()).map(s => ({id: s._id, status: s.status, requested_at: s.requested_at, assigned_lab: s.assigned_lab ?? null, reason: s.reason}));
  const decs = await Decision.find({investigation_id: id}).sort({_id: -1}).lean(), names = await userNames(decs.map(d => d.recorded_by));
  return {
    id: i._id, batch: i.batch_id ?? null, title: i.title, stage: i.stage || "—", status: INV_STATUS_LABEL[i.status], statusKey: i.status, opened: i.opened_at, closedAt: i.closed_at ?? null, closureReason: i.closure_reason ?? null,
    owner: i.owner, summary: i.summary, product: {id: product._id, name: product.name, category: product.category, brand: product.brand ?? null, manufacturer: product.manufacturer}, batchInfo: batch,
    timeline: (await InvEvent.find({investigation_id: id}).sort({at: 1, _id: 1}).lean()).map(e => ({t: e.at, title: e.title, state: e.state, note: e.note ?? null})),
    labs, complaints, sampleRequests: samples,
    labConfirmed: labs.some(l => l.outcome === "confirmed" && l.reportStatus === "submitted"),
    analysis: a ? {trace: a.trace, hotspots: a.hotspots, risk: a.risk, provider: a.provider, warnings: a.warnings || [], computedAt: a.computed_at} : null,
    reports,
    decisions: decs.map(d => ({id: String(d._id), decision: d.decision, authority_ref: d.authority_ref, notes: d.notes ?? null, decided_on: d.decided_on, recorded_at: d.recorded_at, recorded_by: names.get(String(d.recorded_by)) || null})),
    notice: REGULATORY_NOTICE,
  };
}

// ---- Traceability (only after a laboratory report confirms contamination) -------------------------------------------
const confirmedReport = batchId => LabReport.findOne({batch_id: batchId, outcome: "confirmed", status: "submitted"}).sort({submitted_at: -1}).lean();

export async function runTraceability(user, id, {simulate} = {}) {
  const inv = await mustGet(id);
  if (!inv.batch_id) throw new HttpError(409, "The affected batch has not been identified yet; traceability needs a batch.", {code: "BATCH_UNKNOWN"});
  if (!OPEN.includes(inv.status)) throw new HttpError(409, "This investigation is closed.", {code: "CLOSED"});
  const lab = await confirmedReport(inv.batch_id);
  if (!lab) throw new HttpError(409, "Traceability starts only after a laboratory report confirms contamination. No confirmed report exists for this batch.", {code: "LAB_NOT_CONFIRMED"});
  const batch = await loadBatch(inv.batch_id), provider = getSupplyChainProvider();
  let chain;
  try { chain = await provider.fetchChain(batch.id, {simulate}); }
  catch (e) {
    const known = e instanceof ProviderUnavailableError;
    console.error(`[traceability] provider ${provider.name} failed for ${batch.id}:`, e.message);
    await audit(user, "traceability.failed", "investigation", id, {provider: provider.name, error: e.message});
    throw new HttpError(502, known ? "The supply-chain data provider is unavailable or has no data for this batch. Traceability could not be completed. Nothing was changed; please try again later." : "Traceability failed unexpectedly. Nothing was changed.", {code: "PROVIDER_UNAVAILABLE", provider: provider.name, mock: provider.mock});
  }
  const trace = buildTrace(batch, chain);
  const complaints = await Complaint.aggregate([{$match: {batch_id: batch.id, region: {$ne: null}}}, {$group: {_id: "$region", n: {$sum: 1}}}]).then(r => r.map(x => ({region: x._id, n: x.n})));
  const total = await Complaint.countDocuments({batch_id: batch.id});
  const hotspots = buildHotspots(batch, trace, complaints);
  const regions = new Set([...trace.summary.regions, ...complaints.map(c => c.region)]);
  const risk = computeRisk({complaintCount: total, distributionNodes: trace.destinations, regionsReached: regions.size, severity: lab.severity});
  const warnings = [...chain.warnings, ...trace.warnings];
  const providerInfo = {name: provider.name, mock: provider.mock, complete: chain.complete};
  await tx(async () => {
    await Analysis.updateOne({_id: id}, {$set: {trace, hotspots, risk, provider: providerInfo, warnings, computed_at: nowIso(), computed_by: user.id}}, {upsert: true});
    if (["lab_confirmed", "traced"].includes(inv.status)) await Investigation.updateOne({_id: id}, {$set: {status: "traced"}});
    await addInvestigationEvent(id, "Traceability and risk assessment completed", warnings.length ? "alert" : "done",
      `${trace.destinations} destination(s), ${trace.backward.length} upstream record(s) · risk ${risk.level} (${risk.score}/100)${warnings.length ? " · incomplete data" : ""}`, "trace");
    await audit(user, "traceability.completed", "investigation", id, {provider: provider.name, mock: provider.mock, complete: chain.complete, warnings, risk: {score: risk.score, level: risk.level}});
  });
  return getInvestigation(id);
}

// Only places that RECEIVED the batch count towards reach; e.g. packaging at the manufacturer's own site does not.
const isDestination = n => ["storage", "distribution", "retail"].includes(n.kind);
function buildTrace(batch, chain) {
  const place = r => ({stage: r.stage, kind: r.kind, party: r.party, role: r.role ?? null, place: r.place, lat: r.lat ?? null, lng: r.lng ?? null, region: r.region || nearestRegion(r.lat, r.lng)?.name || null, at: r.at});
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
async function buildReportContent(inv) {
  const d = await getInvestigation(inv._id), b = d.batchInfo, lab = d.labs.find(l => l.outcome === "confirmed" && l.reportStatus === "submitted");
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

export async function generateReport(user, id) {
  const inv = await mustGet(id);
  if (!OPEN.includes(inv.status)) throw new HttpError(409, "This investigation is closed.", {code: "CLOSED"});
  const missing = [];
  if (!inv.batch_id || !await confirmedReport(inv.batch_id)) missing.push("a laboratory report confirming contamination");
  if (!await Analysis.exists({_id: id})) missing.push("completed traceability, hotspot analysis and risk assessment");
  if (missing.length) throw new HttpError(409, `A report cannot be generated yet. Still required: ${missing.join(" and ")}.`, {code: "PREREQUISITES_MISSING", missing});
  const content = JSON.parse(JSON.stringify(await buildReportContent(inv))), hash = crypto.createHash("sha256").update(JSON.stringify(content)).digest("hex");
  const latest = await Report.findOne({investigation_id: id}).sort({version: -1}).lean();
  if (latest && latest.content_sha256 === hash) return {...await reportSummary(latest._id), unchanged: true};
  const rid = await nextId("RPT", 1000), version = (latest?.version || 0) + 1, at = nowIso();
  try {
    await tx(async () => {
      await Report.create({_id: rid, investigation_id: id, version, content, content_sha256: hash, generated_by: user.id, generated_at: at});
      await Investigation.updateOne({_id: id, status: {$in: ["lab_confirmed", "traced", "report_ready"]}}, {$set: {status: "report_ready"}});
      await addInvestigationEvent(id, `Investigation report ${rid} generated (v${version})`, "done", "Not yet submitted", "report", at);
      await audit(user, "report.generated", "report", rid, {investigationId: id, version, sha256: hash});
    });
  } catch (e) { // a concurrent request produced the same version first: return that one instead of duplicating
    if (e.code === 11000) { const l = await Report.findOne({investigation_id: id}).sort({version: -1}).lean(); return {...await reportSummary(l._id), unchanged: true}; }
    throw e;
  }
  return {...await reportSummary(rid), unchanged: false};
}

export async function reportSummary(rid) {
  const r = await Report.findById(rid).select("-content").lean();
  if (!r) throw new HttpError(404, "Report not found.");
  const subs = (await Submission.find({report_id: rid}).sort({_id: 1}).lean()).map(s => ({attempt: s.attempt, adapter: s.adapter, simulated: !!s.simulated, status: s.status, externalRef: s.external_ref ?? null, error: s.error ?? null, at: s.attempted_at}));
  const last = subs.at(-1), names = await userNames([r.generated_by]);
  return {id: r._id, investigationId: r.investigation_id, version: r.version, generatedAt: r.generated_at, generatedBy: names.get(String(r.generated_by)) || null, sha256: r.content_sha256,
    status: last ? last.status : "generated", submissions: subs, simulated: subs.some(s => s.simulated)};
}
export async function getReport(rid) {
  const r = await Report.findById(rid).select("content").lean();
  if (!r) throw new HttpError(404, "Report not found.");
  return {...await reportSummary(rid), content: r.content};
}

export async function submitReport(user, rid, {simulate} = {}) {
  let sum = await reportSummary(rid);
  const adapter = getFssaiAdapter(), last = sum.submissions.at(-1);
  if (last?.status === "sending") {
    if (Date.now() - Date.parse(last.at) < 120000) throw new HttpError(409, "A submission for this report is already in progress.", {code: "IN_PROGRESS"});
    await Submission.updateOne({report_id: rid, attempt: last.attempt, status: "sending"}, {$set: {status: "failed", error: "Interrupted: no result was recorded"}}); // stale reservation
    sum = await reportSummary(rid);
  }
  if (["sent", "acknowledged"].includes(sum.status)) throw new HttpError(409, `This report was already ${sum.status === "sent" ? "sent" : "acknowledged"} (${adapter.simulated ? "simulated" : "live"}). It cannot be submitted again.`, {code: "ALREADY_SUBMITTED"});
  const attempt = sum.submissions.filter(s => s.status !== "acknowledged").length + 1;
  // Reserve the attempt BEFORE calling the channel: the unique (report, attempt, status) index means two simultaneous clicks cannot both send.
  try { await Submission.create({report_id: rid, attempt, adapter: adapter.name, simulated: adapter.simulated, status: "sending", attempted_at: nowIso(), attempted_by: user.id}); }
  catch (e) { if (e.code === 11000) throw new HttpError(409, "A submission for this report is already in progress.", {code: "IN_PROGRESS"}); throw e; }
  const full = await getReport(rid);
  let result = null, error = null;
  try { result = await adapter.submit({id: rid, content: full.content}, {attempt, simulate}); }
  catch (e) { error = e instanceof SubmissionError ? e.message : "Unexpected submission error."; if (!(e instanceof SubmissionError)) console.error("[submit]", e); }
  await Submission.updateOne({report_id: rid, attempt, status: "sending"}, {$set: {status: error ? "failed" : "sent", external_ref: result?.externalRef, error: error || undefined, attempted_at: nowIso()}});
  await audit(user, error ? "report.submission_failed" : "report.submission_sent", "report", rid, {attempt, adapter: adapter.name, simulated: adapter.simulated, error});
  await addInvestigationEvent(sum.investigationId, error ? `Report submission attempt ${attempt} failed${adapter.simulated ? " (simulated)" : ""}` : `Report marked as sent${adapter.simulated ? " (SIMULATED: not transmitted to FSSAI)" : ""}`,
    error ? "alert" : "done", error || result.externalRef, "submission");
  const out = await reportSummary(rid);
  if (error) throw new HttpError(502, `${error}`, {code: "SUBMISSION_FAILED", report: out, canRetry: true});
  return out;
}

export async function simulateAcknowledgement(user, rid) {
  const adapter = getFssaiAdapter(), sum = await reportSummary(rid);
  if (!adapter.simulated) throw new HttpError(409, "Acknowledgements come from the real channel.");
  if (sum.status !== "sent") throw new HttpError(409, sum.status === "acknowledged" ? "Already acknowledged." : "Only a sent report can be acknowledged.");
  const sent = sum.submissions.filter(s => s.status === "sent").at(-1);
  await Submission.create({report_id: rid, attempt: sent.attempt, adapter: adapter.name, simulated: true, status: "acknowledged", external_ref: sent.externalRef, attempted_at: nowIso(), attempted_by: user.id});
  await audit(user, "report.acknowledged_simulated", "report", rid, {externalRef: sent.externalRef});
  await addInvestigationEvent(sum.investigationId, "Acknowledgement received (SIMULATED)", "done", "Simulated acknowledgement; no real FSSAI response", "submission");
  return reportSummary(rid);
}

// ---- Reviewer actions ---------------------------------------------------------------------------------------------
export async function recordDecision(user, id, d) {
  const inv = await mustGet(id);
  await Decision.create({investigation_id: id, batch_id: inv.batch_id, decision: d.decision, authority_ref: d.authorityRef, notes: d.notes || undefined, decided_on: d.decidedOn, recorded_by: user.id, recorded_at: nowIso()});
  await audit(user, "regulatory_decision.recorded", "investigation", id, {decision: d.decision, authorityRef: d.authorityRef, decidedOn: d.decidedOn});
  await addInvestigationEvent(id, `FSSAI decision recorded: ${d.decision.replace(/_/g, " ")}`, "done", `Authority reference ${d.authorityRef}. Recorded by a reviewer; TraceX does not make this decision.`, "decision");
  return getInvestigation(id);
}

export async function closeInvestigation(user, id, reason) {
  const inv = await mustGet(id);
  if (!OPEN.includes(inv.status)) throw new HttpError(409, "This investigation is already closed.");
  await Investigation.updateOne({_id: id}, {$set: {status: "closed", closed_at: nowIso(), closure_reason: reason}});
  await audit(user, "investigation.status_changed", "investigation", id, {from: inv.status, to: "closed", reason});
  await addInvestigationEvent(id, "Investigation closed", "done", reason, "closed");
  return getInvestigation(id);
}

export async function requestSample(user, id, {assignedLab, reason}) {
  const inv = await mustGet(id);
  if (!OPEN.includes(inv.status)) throw new HttpError(409, "This investigation is closed.");
  const open = await SampleRequest.findOne({investigation_id: id, status: "requested"}).select("_id").lean();
  if (open) throw new HttpError(409, `Sample request ${open._id} is already open for this investigation.`);
  return createSampleRequest({batchId: inv.batch_id, productId: inv.product_id, flagId: inv.flag_id, investigationId: id, reason: reason || "Requested by reviewer", actor: user, assignedLab: assignedLab || null});
}

// ---- Provider-supplied records (external supply-chain data provider role) ----------------------------------------
export async function addProviderRecords(user, batchId, records) {
  const b = await loadBatch(batchId);
  if (!b) throw new HttpError(404, "Batch not found.");
  const cat = getCategory(b.category), errors = {};
  records.forEach((r, i) => { if (!cat.stages.some(s => s.name === r.stage)) errors[`records.${i}.stage`] = `Not a stage for ${cat.label}: use one of ${cat.stages.map(s => s.name).join(", ")}`; });
  if (Object.keys(errors).length) throw new HttpError(422, "Some records are invalid.", {fields: errors});
  await SupplyRecord.insertMany(records.map(r => ({batch_id: b.id, stage: r.stage, party_name: r.party, party_role: r.role || undefined, lat: r.lat, lng: r.lng, region: r.region || nearestRegion(r.lat, r.lng)?.name || undefined,
    occurred_at: r.at, readings: r.readings, notes: r.notes || undefined, quality_score: r.qualityScore, source: `provider:${user.email}`})));
  await audit(user, "provider.records_added", "batch", b.id, {count: records.length});
  return {added: records.length};
}
