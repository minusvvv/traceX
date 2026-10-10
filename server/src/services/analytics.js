import {db} from "../db.js";
import {config} from "../config.js";
import {loadBatches} from "../domain/batches.js";
import {getCategory, categoryKeys, CATEGORIES} from "../domain/categories.js";
import {REGIONS} from "../geo.js";

const radiusFor = n => Math.min(26000, 8000 + n * 2500);

// Internal hotspot map (reviewers/administrators only): complaints grouped by region, plus where affected batches were distributed.
export function internalHotspots({category, batchId, productId, status, from, to} = {}) {
  const batches = new Map(loadBatches().map(b => [b.id.toLowerCase(), b]));
  const w = ["c.region IS NOT NULL"], p = [];
  if (batchId) { w.push("c.batch_id=? COLLATE NOCASE"); p.push(batchId); }
  if (productId) { w.push("c.product_id=?"); p.push(productId); }
  if (category) { w.push("pr.category=?"); p.push(category); }
  if (from) { w.push("c.created_at>=?"); p.push(from); }
  if (to) { w.push("c.created_at<=?"); p.push(to); }
  const rows = db.prepare(`SELECT c.batch_id, c.region, c.lat, c.lng FROM complaints c LEFT JOIN products pr ON pr.id=c.product_id WHERE ${w.join(" AND ")}`).all(...p);
  const invs = db.prepare("SELECT batch_id, stage, status FROM investigations WHERE batch_id IS NOT NULL").all();
  const groups = new Map();
  for (const r of rows) {
    const b = r.batch_id ? batches.get(r.batch_id.toLowerCase()) : null;
    if (status && (b?.status || "safe") !== status) continue;
    const g = groups.get(r.region) || groups.set(r.region, {region: r.region, lat: 0, lng: 0, reports: 0, bset: new Set(), labSet: new Set(), sev: 0}).get(r.region);
    g.reports++; g.lat += r.lat; g.lng += r.lng;
    if (b) { g.bset.add(b.id); if (b.labStatus === "confirmed") g.labSet.add(b.id); g.sev = Math.max(g.sev, {safe: 0, review: 1, suspicious: 2, critical: 3}[b.status]); }
  }
  return [...groups.values()].map(g => {
    const ids = [...g.bset], open = invs.filter(i => ids.some(x => x.toLowerCase() === i.batch_id.toLowerCase()) && !["closed", "closed_unconfirmed"].includes(i.status));
    const stages = open.map(i => i.stage).filter(Boolean), top = stages.sort((a, b) => stages.filter(x => x === b).length - stages.filter(x => x === a).length)[0];
    return {region: g.region, lat: g.lat / g.reports, lng: g.lng / g.reports, radius: radiusFor(g.reports), severity: ["safe", "review", "suspicious", "critical"][g.sev],
      reports: g.reports, batches: ids.length, lab: g.labSet.size, open: open.length, stage: top || "—"};
  }).sort((a, b) => b.reports - a.reports);
}

// Public heat map: coarse grid cells only. Cells under the minimum count are suppressed so a single complaint can never be located.
export function publicHeatmap({category, days = 90} = {}) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const w = ["c.lat IS NOT NULL", "c.created_at>=?"], p = [since];
  if (category) { w.push("pr.category=?"); p.push(category); }
  const rows = db.prepare(`SELECT c.lat, c.lng FROM complaints c LEFT JOIN products pr ON pr.id=c.product_id WHERE ${w.join(" AND ")}`).all(...p);
  const d = config.publicMapCellDeg, cells = new Map();
  for (const r of rows) {
    const key = Math.floor(r.lat / d) + ":" + Math.floor(r.lng / d);
    cells.set(key, (cells.get(key) || 0) + 1);
  }
  const out = [];
  for (const [key, n] of cells) {
    if (n < config.publicMapMinCell) continue;
    const [i, j] = key.split(":").map(Number);
    out.push({region: "Area with reports", lat: +((i + .5) * d).toFixed(3), lng: +((j + .5) * d).toFixed(3), radius: Math.round(d * 111000 * 0.6),
      reports: n, severity: n >= config.publicMapMinCell * 3 ? "review" : "safe"});
  }
  return {cells: out.sort((a, b) => b.reports - a.reports), cellSizeKm: Math.round(d * 111), minReportsPerCell: config.publicMapMinCell, days,
    notice: "Counts are unverified consumer reports grouped into large areas. They are not findings of contamination, and small clusters are hidden to protect privacy."};
}

function bucket(iso, by) {
  const d = new Date(iso);
  return by === "week" ? `${d.getUTCFullYear()}-W${String(Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7)).padStart(2, "0")}` : d.toLocaleString("en", {month: "short", timeZone: "UTC"});
}

export function analytics({category, status, from, to} = {}) {
  let batches = loadBatches({category});
  if (status) batches = batches.filter(b => b.status === status);
  const ids = new Set(batches.map(b => b.id.toLowerCase()));
  const inRange = iso => (!from || iso >= from) && (!to || iso <= to);
  const rangeDays = ((to ? Date.parse(to) : Date.now()) - (from ? Date.parse(from) : Date.now() - 365 * 864e5)) / 864e5;
  const by = rangeDays <= 120 ? "week" : "month";
  const order = [], seen = new Set();
  const note = k => { if (!seen.has(k)) { seen.add(k); order.push(k); } return k; };

  const q = new Map();
  for (const b of batches) for (const r of b.route) if (r.qs != null && inRange(r.time)) { const k = note(bucket(r.time, by)); (q.get(k) || q.set(k, []).get(k)).push(r.qs); }
  const cRows = db.prepare(`SELECT c.created_at, c.batch_id, pr.category FROM complaints c LEFT JOIN products pr ON pr.id=c.product_id ORDER BY c.created_at`).all()
    .filter(c => inRange(c.created_at) && (!category || c.category === category) && (!status || (c.batch_id && ids.has(c.batch_id.toLowerCase()))));
  const cm = new Map(); for (const c of cRows) { const k = note(bucket(c.created_at, by)); cm.set(k, (cm.get(k) || 0) + 1); }
  const inc = new Map();
  for (const i of db.prepare("SELECT stage, batch_id, opened_at FROM investigations WHERE stage IS NOT NULL").all())
    if (inRange(i.opened_at) && (!i.batch_id || ids.has(i.batch_id.toLowerCase()))) inc.set(i.stage, (inc.get(i.stage) || 0) + 1);
  const avg = a => Math.round(a.reduce((s, x) => s + x, 0) / a.length);
  const allQ = [...q.values()].flat();
  const topStage = [...inc.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    bucket: by,
    qualityTrend: [...q.entries()].map(([m, a]) => ({m, q: avg(a)})),
    complaintTrend: [...cm.entries()].map(([m, n]) => ({m, n})),
    incidentsByStage: [...inc.entries()].map(([stage, n]) => ({stage, n})).sort((a, b) => b.n - a.n),
    statusCounts: ["safe", "review", "suspicious", "critical"].map(s => ({s, n: batches.filter(b => b.status === s).length})),
    byCategory: categoryKeys.map(k => ({category: k, label: CATEGORIES[k].label, batches: batches.filter(b => b.category === k).length})).filter(c => c.batches),
    summary: {averageQuality: allQ.length ? avg(allQ) : null, complaints: cRows.length, batches: batches.length, mostAffectedStage: topStage?.[0] || null},
  };
}

export function dashboardSummary() {
  const batches = loadBatches();
  const active = batches.filter(b => b.cur < getCategory(b.category).stages.length - 1 || b.status !== "safe");
  const events = [];
  for (const c of db.prepare("SELECT id,batch_id,created_at,region FROM complaints WHERE batch_id IS NOT NULL ORDER BY created_at DESC LIMIT 8").all())
    events.push({at: c.created_at, batch: c.batch_id, text: `Consumer complaint ${c.id} recorded${c.region ? " · " + c.region : ""}`, tone: "warn"});
  for (const f of db.prepare("SELECT * FROM flags ORDER BY flagged_at DESC LIMIT 6").all())
    events.push({at: f.flagged_at, batch: f.target_type === "batch" ? f.target_id : null, text: `Complaint threshold reached (${f.complaint_count} in ${f.window_days} days)`, tone: "alert"});
  for (const l of db.prepare("SELECT id,batch_id,outcome,submitted_at FROM lab_reports ORDER BY submitted_at DESC LIMIT 6").all())
    events.push({at: l.submitted_at, batch: l.batch_id, text: `Laboratory report ${l.id}: ${l.outcome.replace("_", " ")}`, tone: l.outcome === "confirmed" ? "alert" : l.outcome === "not_confirmed" ? "ok" : "warn"});
  for (const r of db.prepare("SELECT batch_id,stage,occurred_at,party_name FROM supply_chain_records ORDER BY occurred_at DESC LIMIT 6").all())
    events.push({at: r.occurred_at, batch: r.batch_id, text: `${r.stage} recorded · ${r.party_name}`, tone: "ok"});
  const pending = db.prepare("SELECT COUNT(*) n FROM sample_requests WHERE status IN ('requested','submitted')").get().n;
  return {
    network: {active: active.length, inTransit: batches.filter(b => b.cur < getCategory(b.category).stages.length - 1).length,
      alerts: batches.filter(b => b.status === "suspicious" || b.status === "critical").length, labReports: db.prepare("SELECT COUNT(*) n FROM lab_reports WHERE status='submitted'").get().n,
      openInvestigations: db.prepare("SELECT COUNT(*) n FROM investigations WHERE status NOT IN ('closed','closed_unconfirmed')").get().n, pendingSamples: pending},
    events: events.filter(e => e.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10),
  };
}
