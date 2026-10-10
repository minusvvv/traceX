import {db, jparse} from "../db.js";
import {getCategory, mfgIndex, stageIndex, detectAnomaly} from "./categories.js";
import {thresholdFor} from "../services/thresholds.js";

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

const BASE = `SELECT b.*, p.name AS product_name, p.category, p.brand, p.manufacturer, p.gtin, p.attributes, p.id AS pid
  FROM batches b JOIN products p ON p.id = b.product_id`;

export function loadBatches({ids = null, category = null} = {}) {
  let rows = db.prepare(BASE + " ORDER BY b.created_at, b.id").all();
  if (ids) { const s = new Set(ids.map(i => i.toLowerCase())); rows = rows.filter(r => s.has(r.id.toLowerCase())); }
  if (category) rows = rows.filter(r => r.category === category);
  if (!rows.length) return [];
  const records = new Map();
  for (const r of db.prepare("SELECT * FROM supply_chain_records ORDER BY occurred_at, id").all()) (records.get(r.batch_id) || records.set(r.batch_id, []).get(r.batch_id)).push(r);
  const totals = new Map(db.prepare("SELECT batch_id, COUNT(*) n FROM complaints WHERE batch_id IS NOT NULL GROUP BY batch_id").all().map(r => [r.batch_id, r.n]));
  const windowCache = new Map();
  const windowCounts = days => {
    if (!windowCache.has(days)) {
      const since = new Date(Date.now() - days * 864e5).toISOString();
      windowCache.set(days, new Map(db.prepare("SELECT batch_id, COUNT(*) n FROM complaints WHERE batch_id IS NOT NULL AND created_at>=? GROUP BY batch_id").all(since).map(r => [r.batch_id, r.n])));
    }
    return windowCache.get(days);
  };
  const openFlags = new Map(db.prepare("SELECT * FROM flags WHERE target_type='batch' AND status='open'").all().map(f => [f.target_id.toLowerCase(), f]));
  const invs = new Map();
  for (const i of db.prepare("SELECT id,batch_id,status,opened_at FROM investigations WHERE batch_id IS NOT NULL ORDER BY opened_at").all()) (invs.get(i.batch_id.toLowerCase()) || invs.set(i.batch_id.toLowerCase(), []).get(i.batch_id.toLowerCase())).push(i);
  const labs = new Map();
  for (const l of db.prepare("SELECT batch_id,outcome,severity,id,submitted_at FROM lab_reports WHERE status='submitted' ORDER BY submitted_at").all()) labs.set(l.batch_id.toLowerCase(), l); // latest wins
  const pending = new Set(db.prepare("SELECT batch_id FROM sample_requests WHERE status='requested' AND batch_id IS NOT NULL").all().map(r => r.batch_id.toLowerCase()));
  const decisions = new Map();
  for (const d of db.prepare("SELECT * FROM regulatory_decisions WHERE batch_id IS NOT NULL ORDER BY id").all()) decisions.set(d.batch_id.toLowerCase(), d);
  const risks = new Map();
  for (const a of db.prepare("SELECT i.batch_id, a.risk FROM investigation_analysis a JOIN investigations i ON i.id=a.investigation_id WHERE i.batch_id IS NOT NULL ORDER BY a.computed_at").all()) risks.set(a.batch_id.toLowerCase(), jparse(a.risk));

  return rows.map(b => {
    const k = b.id.toLowerCase(), cat = getCategory(b.category), th = thresholdFor(b.category);
    const route = (records.get(b.id) || []).map(r => ({
      id: r.id, stage: r.stage, kind: cat.stages[stageIndex(b.category, r.stage)]?.kind || "unknown", side: sideOf(b.category, r.stage),
      place: r.party_name, role: r.party_role, lat: r.lat, lng: r.lng, region: r.region, time: r.occurred_at,
      readings: jparse(r.readings), notes: r.notes, qs: r.quality_score, source: r.source,
    }));
    const anomaly = detectAnomaly(b.category, route);
    const lastLab = labs.get(k);
    const lab = lastLab ? (lastLab.outcome === "confirmed" ? "confirmed" : lastLab.outcome === "not_confirmed" ? "clear" : "inconclusive") : pending.has(k) ? "pending" : "none";
    const labState = pending.has(k) && lab !== "confirmed" && lab !== "clear" ? "pending" : lab;
    const bi = invs.get(k) || [], openInv = bi.find(i => !["closed", "closed_unconfirmed"].includes(i.status));
    const flagged = openFlags.has(k);
    const dec = decisions.get(k);
    const stageIdx = route.reduce((m, r) => Math.max(m, stageIndex(b.category, r.stage)), -1);
    const withQs = route.filter(r => r.qs != null), last = route[route.length - 1];
    const tempExcursion = cat.coldChain && b.temperature_c != null && b.temperature_c > 8;
    const rk = risks.get(k);
    const dest = b.destination_lat != null ? {place: b.destination_place, lat: b.destination_lat, lng: b.destination_lng} : null;
    return {
      id: b.id, product: b.product_name, productId: b.pid, category: b.category, categoryLabel: cat.label, brand: b.brand, manufacturer: b.manufacturer,
      lot: b.lot_number, qty: b.quantity, created: b.created_at, manufacturedOn: b.manufactured_on, expiresOn: b.expires_on, facility: b.facility,
      attributes: jparse(b.attributes, {}), stages: cat.stages.map(s => s.name), cur: Math.max(stageIdx, 0), origin: route[0]?.place || null,
      status: deriveStatus({lab: labState, flagged, anomaly, openInvestigation: openInv, tempExcursion}),
      score: withQs.length ? withQs[withQs.length - 1].qs : null, temp: b.temperature_c, destination: dest, route, anomaly,
      complaintCount: totals.get(b.id) || 0, complaintWindowCount: windowCounts(th.windowDays).get(b.id) || 0, threshold: th,
      flagged, labStatus: labState, labLabel: LAB_LABEL[labState], latestLabReport: lastLab?.id || null,
      openInvestigationId: openInv?.id || null, investigationIds: bi.map(i => i.id),
      recall: {status: dec?.decision || "none", label: RECALL_LABEL[dec?.decision || "none"], reference: dec?.authority_ref || null, decidedOn: dec?.decided_on || null},
      risk: rk ? {assessed: true, level: rk.level, score: rk.score} : {assessed: false, level: null, score: null},
      lastUpdate: last?.time || b.created_at, isDemo: !!b.is_demo,
    };
  });
}

export const loadBatch = id => loadBatches({ids: [id]})[0] || null;

// Resolve a consumer-supplied identifier: batch id, manufacturer lot number, or product GTIN.
export function resolveIdentifier(text) {
  const t = String(text || "").trim();
  if (!t) return {batchId: null, productId: null};
  const b = db.prepare("SELECT id, product_id FROM batches WHERE id=? COLLATE NOCASE OR lot_number=? COLLATE NOCASE").all(t, t);
  if (b.length === 1) return {batchId: b[0].id, productId: b[0].product_id};
  if (b.length === 0) { const p = db.prepare("SELECT id FROM products WHERE gtin=?").get(t); if (p) return {batchId: null, productId: p.id}; }
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
