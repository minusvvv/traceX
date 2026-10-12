import {Batch, Product, SupplyRecord, Complaint, Flag, Investigation, SampleRequest, LabReport, Decision, Analysis, jparse, up} from "../db.js";
import {getCategory, mfgIndex, stageIndex, detectAnomaly} from "./categories.js";
import {loadThresholds, pickThreshold} from "../services/thresholds.js";

export const LAB_LABEL = {none: "No laboratory report", pending: "Sample requested", clear: "Verified: no contamination confirmed", confirmed: "Contamination confirmed", inconclusive: "Inconclusive"};
export const RECALL_LABEL = {none: "No regulatory action recorded", no_action: "No further action (FSSAI)", advisory_issued: "Advisory issued (FSSAI)", recall_ordered: "Recall ordered (FSSAI)", recall_closed: "Recall closed (FSSAI)"};

// Where a record sits relative to the manufacturer stage; drives backward/forward traceability.
export function sideOf(categoryKey, stage) {
  const cat = getCategory(categoryKey), i = stageIndex(categoryKey, stage), m = mfgIndex(categoryKey);
  if (i < 0) return "unknown";
  if (cat.stages[i].kind === "testing") return "testing";
  return i < m ? "upstream" : i === m ? "manufacturer" : "downstream";
}

export function deriveStatus({lab, flagged, anomaly, openInvestigation, tempExcursion}) {
  if (lab === "confirmed") return "critical";
  if (lab === "clear") return "safe"; // a laboratory-verified negative outweighs earlier suspicion
  if (flagged || anomaly) return "suspicious";
  if (openInvestigation || tempExcursion || lab === "pending" || lab === "inconclusive") return "review";
  return "safe";
}
const group = (rows, key) => { const m = new Map(); for (const r of rows) { const k = key(r); (m.get(k) || m.set(k, []).get(k)).push(r); } return m; };

// Loads batches with all derived fields using a fixed number of bulk queries (no per-batch round trips).
export async function loadBatches({ids = null, category = null} = {}) {
  const idList = ids ? ids.map(up) : null;
  let rows = await Batch.find(idList ? {_id: {$in: idList}} : {}).sort({created_at: 1, _id: 1}).lean();
  if (!rows.length) return [];
  const prods = new Map((await Product.find({_id: {$in: [...new Set(rows.map(b => b.product_id))]}}).lean()).map(p => [p._id, p]));
  if (category) rows = rows.filter(b => prods.get(b.product_id)?.category === category);
  if (!rows.length) return [];
  const bids = rows.map(b => b._id), inB = {$in: bids};
  const ths = await loadThresholds(), windows = [...new Set(rows.map(b => pickThreshold(ths, prods.get(b.product_id).category).windowDays))];
  const [recs, totals, openFlags, invs, labsAll, pend, decs, anas, ...winCounts] = await Promise.all([
    SupplyRecord.find({batch_id: inB}).sort({occurred_at: 1, _id: 1}).lean(),
    Complaint.aggregate([{$match: {batch_id: inB}}, {$group: {_id: "$batch_id", n: {$sum: 1}}}]),
    Flag.find({target_type: "batch", target_id: inB, status: "open"}).lean(),
    Investigation.find({batch_id: inB}).sort({opened_at: 1}).lean(),
    LabReport.find({batch_id: inB, status: "submitted"}).sort({submitted_at: 1}).lean(),
    SampleRequest.find({batch_id: inB, status: "requested"}).lean(),
    Decision.find({batch_id: inB}).sort({_id: 1}).lean(),
    Analysis.find().lean(),
    ...windows.map(d => Complaint.aggregate([{$match: {batch_id: inB, created_at: {$gte: new Date(Date.now() - d * 864e5).toISOString()}}}, {$group: {_id: "$batch_id", n: {$sum: 1}}}])),
  ]);
  const records = group(recs, r => r.batch_id), totalMap = new Map(totals.map(t => [t._id, t.n])), flagSet = new Set(openFlags.map(f => f.target_id)), invMap = group(invs, i => i.batch_id);
  const labs = new Map(labsAll.map(l => [l.batch_id, l])), pendSet = new Set(pend.map(r => r.batch_id)), decMap = new Map(decs.map(d => [d.batch_id, d]));
  const winMap = new Map(windows.map((d, i) => [d, new Map(winCounts[i].map(t => [t._id, t.n]))]));
  const invById = new Map(invs.map(i => [i._id, i])), risks = new Map();
  for (const a of anas.sort((x, y) => (x.computed_at || "").localeCompare(y.computed_at || ""))) { const i = invById.get(a._id); if (i) risks.set(i.batch_id, a.risk); }

  return rows.map(b => {
    const p = prods.get(b.product_id), cat = getCategory(p.category), th = pickThreshold(ths, p.category);
    const route = (records.get(b._id) || []).map(r => ({
      id: String(r._id), stage: r.stage, kind: cat.stages[stageIndex(p.category, r.stage)]?.kind || "unknown", side: sideOf(p.category, r.stage),
      place: r.party_name, role: r.party_role, lat: r.lat ?? null, lng: r.lng ?? null, region: r.region ?? null, time: r.occurred_at,
      readings: jparse(r.readings), notes: r.notes ?? null, qs: r.quality_score ?? null, source: r.source,
    }));
    const anomaly = detectAnomaly(p.category, route);
    const lastLab = labs.get(b._id);
    const lab = lastLab ? (lastLab.outcome === "confirmed" ? "confirmed" : lastLab.outcome === "not_confirmed" ? "clear" : "inconclusive") : pendSet.has(b._id) ? "pending" : "none";
    const labState = pendSet.has(b._id) && lab !== "confirmed" && lab !== "clear" ? "pending" : lab;
    const bi = invMap.get(b._id) || [], openInv = bi.find(i => !["closed", "closed_unconfirmed"].includes(i.status));
    const flagged = flagSet.has(b._id), dec = decMap.get(b._id);
    const stageIdx = route.reduce((m, r) => Math.max(m, stageIndex(p.category, r.stage)), -1);
    const withQs = route.filter(r => r.qs != null), last = route[route.length - 1];
    const tempExcursion = cat.coldChain && b.temperature_c != null && b.temperature_c > 8;
    const rk = risks.get(b._id), dest = b.destination_lat != null ? {place: b.destination_place, lat: b.destination_lat, lng: b.destination_lng} : null;
    return {
      id: b._id, product: p.name, productId: p._id, category: p.category, categoryLabel: cat.label, brand: p.brand ?? null, manufacturer: p.manufacturer,
      lot: b.lot_number ?? null, qty: b.quantity, created: b.created_at, manufacturedOn: b.manufactured_on, expiresOn: b.expires_on ?? null, facility: b.facility,
      attributes: jparse(p.attributes, {}), stages: cat.stages.map(s => s.name), cur: Math.max(stageIdx, 0), origin: route[0]?.place || null,
      status: deriveStatus({lab: labState, flagged, anomaly, openInvestigation: openInv, tempExcursion}),
      score: withQs.length ? withQs[withQs.length - 1].qs : null, temp: b.temperature_c ?? null, destination: dest, route, anomaly,
      complaintCount: totalMap.get(b._id) || 0, complaintWindowCount: winMap.get(th.windowDays)?.get(b._id) || 0, threshold: th,
      flagged, labStatus: labState, labLabel: LAB_LABEL[labState], latestLabReport: lastLab?._id || null,
      openInvestigationId: openInv?._id || null, investigationIds: bi.map(i => i._id),
      recall: {status: dec?.decision || "none", label: RECALL_LABEL[dec?.decision || "none"], reference: dec?.authority_ref || null, decidedOn: dec?.decided_on || null},
      risk: rk ? {assessed: true, level: rk.level, score: rk.score} : {assessed: false, level: null, score: null},
      lastUpdate: last?.time || b.created_at, isDemo: !!b.is_demo,
    };
  });
}

export const loadBatch = async id => (await loadBatches({ids: [id]}))[0] || null;

// Resolve a consumer-supplied identifier: batch id, manufacturer lot number, or product GTIN.
export async function resolveIdentifier(text) {
  const t = String(text || "").trim();
  if (!t) return {batchId: null, productId: null};
  const b = await Batch.find({$or: [{_id: up(t)}, {lot_key: up(t)}]}).select("_id product_id").lean();
  if (b.length === 1) return {batchId: b[0]._id, productId: b[0].product_id};
  if (b.length === 0) { const p = await Product.findOne({gtin: t}).select("_id").lean(); if (p) return {batchId: null, productId: p._id}; }
  return {batchId: null, productId: null}; // not found, or ambiguous lot number shared by several products
}

// What an unauthenticated consumer may see. No risk, no complaint counts, no internal status wording.
export function toPublic(b) {
  const regulatory = b.recall.status === "none" ? null : {status: b.recall.status, label: b.recall.label, reference: b.recall.reference};
  return {
    id: b.id, product: b.product, category: b.category, categoryLabel: b.categoryLabel, brand: b.brand, lot: b.lot, qty: b.qty,
    manufacturedOn: b.manufacturedOn, expiresOn: b.expiresOn, stages: b.stages, cur: b.cur, origin: b.origin,
    status: b.status === "safe" ? "safe" : "review", score: b.score, temp: b.temp, destination: b.destination, regulatory, isDemo: b.isDemo,
    route: b.route.map(r => ({id: r.id, stage: r.stage, kind: r.kind, side: r.side, place: r.place, lat: r.lat, lng: r.lng, time: r.time, qs: r.qs})),
  };
}
