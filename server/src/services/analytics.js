import {Complaint, Investigation, Flag, LabReport, SupplyRecord, SampleRequest, Product, Batch} from "../db.js";
import {config} from "../config.js";
import {loadBatches} from "../domain/batches.js";
import {getCategory, categoryKeys, CATEGORIES} from "../domain/categories.js";
import {complaintSeverity} from "../domain/complaint-intensity.js";
import {regionByName} from "../geo.js";

const radiusFor = n => Math.min(26000, 8000 + n * 2500);
const categoryOf = async rows => new Map((await Product.find({_id: {$in: [...new Set(rows.map(r => r.product_id).filter(Boolean))]}}).select("category").lean()).map(p => [p._id, p.category]));

// Internal hotspot map (reviewers/administrators only): complaints grouped by region, plus where affected batches were distributed.
export async function internalHotspots({category, batchId, productId, status, from, to} = {}) {
  const q = {region: {$ne: null}};
  if (batchId) q.batch_id = String(batchId).toUpperCase();
  if (productId) q.product_id = productId;
  if (from || to) q.created_at = {...(from && {$gte: from}), ...(to && {$lte: to})};
  let rows = await Complaint.find(q).select("batch_id product_id region lat lng").lean();
  if (category) { const cm = await categoryOf(rows); rows = rows.filter(r => cm.get(r.product_id) === category); }
  const batches = new Map((await loadBatches({ids: [...new Set(rows.map(r => r.batch_id).filter(Boolean))]})).map(b => [b.id, b]));
  const invs = await Investigation.find({batch_id: {$ne: null}}).select("batch_id stage status").lean();
  const groups = new Map();
  for (const r of rows) {
    const b = r.batch_id ? batches.get(r.batch_id) : null;
    if (status && (b?.status || "safe") !== status) continue;
    const g = groups.get(r.region) || groups.set(r.region, {region: r.region, lat: 0, lng: 0, reports: 0, bset: new Set(), labSet: new Set()}).get(r.region);
    g.reports++; g.lat += r.lat; g.lng += r.lng;
    if (b) { g.bset.add(b.id); if (b.labStatus === "confirmed") g.labSet.add(b.id); }
  }
  return [...groups.values()].map(g => {
    const ids = [...g.bset], open = invs.filter(i => ids.includes(i.batch_id) && !["closed", "closed_unconfirmed"].includes(i.status));
    const stages = open.map(i => i.stage).filter(Boolean), top = [...stages].sort((a, b) => stages.filter(x => x === b).length - stages.filter(x => x === a).length)[0];
    return {region: g.region, lat: g.lat / g.reports, lng: g.lng / g.reports, radius: radiusFor(g.reports), severity: complaintSeverity(g.reports),
      reports: g.reports, batches: ids.length, lab: g.labSet.size, open: open.length, stage: top || "—"};
  }).sort((a, b) => b.reports - a.reports);
}

// Public heat map: coarse grid cells only. Cells under the minimum count are suppressed so a single complaint can never be located.
export async function publicHeatmap({category, days = 90, minReports} = {}) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  let rows = await Complaint.find({created_at: {$gte: since}}).select("lat lng product_id region").lean();
  for (const r of rows) {
    if ((r.lat == null || r.lng == null) && r.region) {
      const reg = regionByName(r.region);
      if (reg) { r.lat = reg.lat; r.lng = reg.lng; }
    }
  }
  rows = rows.filter(r => r.lat != null && r.lng != null);
  if (category) { const cm = await categoryOf(rows); rows = rows.filter(r => cm.get(r.product_id) === category); }
  const d = config.publicMapCellDeg, cells = new Map();
  for (const r of rows) { const key = Math.floor(r.lat / d) + ":" + Math.floor(r.lng / d); cells.set(key, (cells.get(key) || 0) + 1); }
  const threshold = minReports != null ? minReports : config.publicMapMinCell;
  const out = [];
  for (const [key, n] of cells) {
    if (n < threshold) continue;
    const [i, j] = key.split(":").map(Number);
    out.push({region: "Area with reports", lat: +((i + .5) * d).toFixed(3), lng: +((j + .5) * d).toFixed(3), radius: Math.round(d * 111000 * 0.6),
      reports: n, severity: complaintSeverity(n)});
  }
  return {cells: out.sort((a, b) => b.reports - a.reports), cellSizeKm: Math.round(d * 111), minReportsPerCell: threshold, days,
    notice: "Counts include reported complaints whether or not a product has reached its review threshold. They are unverified reports, not findings of contamination; small clusters are hidden to protect privacy."};
}

function bucket(iso, by) {
  const d = new Date(iso);
  return by === "week" ? `${d.getUTCFullYear()}-W${String(Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7)).padStart(2, "0")}` : d.toLocaleString("en", {month: "short", timeZone: "UTC"});
}

export async function analytics({category, status, from, to} = {}) {
  let batches = await loadBatches({category});
  if (status) batches = batches.filter(b => b.status === status);
  const ids = new Set(batches.map(b => b.id));
  const inRange = iso => (!from || iso >= from) && (!to || iso <= to);
  const rangeDays = ((to ? Date.parse(to) : Date.now()) - (from ? Date.parse(from) : Date.now() - 365 * 864e5)) / 864e5;
  const by = rangeDays <= 120 ? "week" : "month";
  const order = [], seen = new Set();
  const note = k => { if (!seen.has(k)) { seen.add(k); order.push(k); } return k; };

  const q = new Map();
  for (const b of batches) for (const r of b.route) if (r.qs != null && inRange(r.time)) { const k = note(bucket(r.time, by)); (q.get(k) || q.set(k, []).get(k)).push(r.qs); }
  const raw = await Complaint.find().sort({created_at: 1}).select("created_at batch_id product_id").lean(), cm0 = await categoryOf(raw);
  const cRows = raw.filter(c => inRange(c.created_at) && (!category || cm0.get(c.product_id) === category) && (!status || (c.batch_id && ids.has(c.batch_id))));
  const cm = new Map(); for (const c of cRows) { const k = note(bucket(c.created_at, by)); cm.set(k, (cm.get(k) || 0) + 1); }
  const inc = new Map();
  for (const i of await Investigation.find({stage: {$ne: null}}).select("stage batch_id opened_at").lean())
    if (inRange(i.opened_at) && (!i.batch_id || ids.has(i.batch_id))) inc.set(i.stage, (inc.get(i.stage) || 0) + 1);
  const avg = a => Math.round(a.reduce((s, x) => s + x, 0) / a.length);
  const allQ = [...q.values()].flat(), topStage = [...inc.entries()].sort((a, b) => b[1] - a[1])[0];
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

export async function dashboardSummary() {
  const batches = await loadBatches();
  const lastIdx = b => getCategory(b.category).stages.length - 1;
  const [cs, fl, ls, rs, pending, labCount, openInv] = await Promise.all([
    Complaint.find({batch_id: {$ne: null}}).sort({created_at: -1}).limit(8).select("batch_id created_at region").lean(),
    Flag.find().sort({flagged_at: -1}).limit(6).lean(),
    LabReport.find().sort({submitted_at: -1}).limit(6).select("batch_id outcome submitted_at").lean(),
    SupplyRecord.find().sort({occurred_at: -1}).limit(6).lean(),
    SampleRequest.countDocuments({status: {$in: ["requested", "submitted"]}}),
    LabReport.countDocuments({status: "submitted"}),
    Investigation.countDocuments({status: {$nin: ["closed", "closed_unconfirmed"]}}),
  ]);
  const events = [
    ...cs.map(c => ({at: c.created_at, batch: c.batch_id, text: `Consumer complaint ${c._id} recorded${c.region ? " · " + c.region : ""}`, tone: "warn"})),
    ...fl.map(f => ({at: f.flagged_at, batch: f.target_type === "batch" ? f.target_id : null, text: `Complaint threshold reached (${f.complaint_count} in ${f.window_days} days)`, tone: "alert"})),
    ...ls.map(l => ({at: l.submitted_at, batch: l.batch_id, text: `Laboratory report ${l._id}: ${l.outcome.replace("_", " ")}`, tone: l.outcome === "confirmed" ? "alert" : l.outcome === "not_confirmed" ? "ok" : "warn"})),
    ...rs.map(r => ({at: r.occurred_at, batch: r.batch_id, text: `${r.stage} recorded · ${r.party_name}`, tone: "ok"})),
  ];
  const active = batches.filter(b => b.cur < lastIdx(b) || b.status !== "safe");
  return {
    network: {active: active.length, inTransit: batches.filter(b => b.cur < lastIdx(b)).length, alerts: batches.filter(b => b.status === "suspicious" || b.status === "critical").length,
      labReports: labCount, openInvestigations: openInv, pendingSamples: pending},
    events: events.filter(e => e.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10),
  };
}

// Enhanced public complaint map: returns individual complaints as points grouped by batch for connections
// Returns real lat/lng as coarsened grid cell centers (privacy preservation)
export async function publicCorrelations({category, days = 90, batchId, userId, city} = {}) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const q = {created_at: {$gte: since}};
  if (batchId) q.batch_id = batchId;
  if (userId) q.submitted_by = userId;
  let rows = await Complaint.find(q).select("_id tracking_code lat lng product_id batch_id created_at submitted_by region description").lean();

  for (const r of rows) {
    if ((r.lat == null || r.lng == null) && r.region) {
      const reg = regionByName(r.region);
      if (reg) { r.lat = reg.lat; r.lng = reg.lng; }
    }
  }
  rows = rows.filter(r => r.lat != null && r.lng != null);

  if (category) {
    const cm = await categoryOf(rows);
    rows = rows.filter(r => cm.get(r.product_id) === category);
  }
  if (city) {
    rows = rows.filter(r => r.region && r.region.toLowerCase().includes(city.toLowerCase()));
  }

  const d = config.publicMapCellDeg;
  const coarsen = (lat, lng) => ({
    lat: +((Math.floor(lat / d) + 0.5) * d).toFixed(3),
    lng: +((Math.floor(lng / d) + 0.5) * d).toFixed(3),
  });

  const batchIds = [...new Set(rows.map(r => r.batch_id).filter(Boolean))];
  const productIds = [...new Set(rows.map(r => r.product_id).filter(Boolean))];

  const [products, batchList] = await Promise.all([
    Product.find({_id: {$in: productIds}}).select("_id name category brand").lean(),
    loadBatches({ids: batchIds}),
  ]);

  const prodMap = new Map(products.map(p => [p._id, p]));
  const batchMap = new Map(batchList.map(b => [b.id, b]));

  const complaintRecords = rows.map(r => {
    const prod = prodMap.get(r.product_id);
    const batch = r.batch_id ? batchMap.get(r.batch_id) : null;
    return {
      id: r._id,
      trackingCode: r.tracking_code || r._id,
      batchId: r.batch_id || null,
      lot: batch?.lot || null,
      productId: r.product_id || null,
      productName: prod?.name || "Product",
      category: prod?.category || batch?.category || "other",
      brand: prod?.brand || null,
      region: r.region || "Reported Area",
      createdAt: r.created_at,
      description: r.description || "Unusual condition reported.",
      severity: batch?.status || "safe",
      isOwn: userId ? r.submitted_by === userId : false,
    };
  });

  // Query supply chain transit records for these batches
  const supplyRecs = batchIds.length ? await SupplyRecord.find({batch_id: {$in: batchIds}}).sort({occurred_at: 1}).lean() : [];
  const supplyByBatch = new Map();
  for (const rec of supplyRecs) {
    let lat = rec.lat, lng = rec.lng;
    if ((lat == null || lng == null) && rec.region) {
      const reg = regionByName(rec.region);
      if (reg) { lat = reg.lat; lng = reg.lng; }
    }
    if (lat != null && lng != null) {
      const list = supplyByBatch.get(rec.batch_id) || [];
      list.push({
        stage: rec.stage,
        place: rec.party_name,
        role: rec.party_role,
        region: rec.region,
        lat,
        lng,
        time: rec.occurred_at,
      });
      supplyByBatch.set(rec.batch_id, list);
    }
  }

  // Aggregate complaints into location nodes per batch
  const nodeKey = (r) => {
    const c = coarsen(r.lat, r.lng);
    return `${c.lat},${c.lng}:${r.batch_id || "nobatch"}:${r.product_id || "noprod"}`;
  };

  const nodeMap = new Map();
  for (const r of rows) {
    const k = nodeKey(r);
    const coords = coarsen(r.lat, r.lng);
    const prod = prodMap.get(r.product_id);
    const batch = r.batch_id ? batchMap.get(r.batch_id) : null;
    let node = nodeMap.get(k);
    if (!node) {
      node = {
        id: r._id,
        lat: coords.lat,
        lng: coords.lng,
        region: r.region || "Reported Area",
        batchId: r.batch_id || null,
        lot: batch?.lot || null,
        productId: r.product_id || null,
        productName: prod?.name || "Product",
        category: prod?.category || batch?.category || "other",
        brand: prod?.brand || null,
        count: 0,
        severity: batch?.status || "safe",
        complaintIds: [],
        createdAt: r.created_at,
        isOwn: userId ? r.submitted_by === userId : false,
      };
      nodeMap.set(k, node);
    }
    node.count++;
    node.complaintIds.push(r._id);
    if (userId && r.submitted_by === userId) node.isOwn = true;
  }

  // Calculate severity on nodes based on count if batch is safe
  for (const node of nodeMap.values()) {
    if (node.severity === "safe" && node.count >= 3) {
      node.severity = complaintSeverity(node.count);
    }
  }

  const nodes = [...nodeMap.values()];

  // Build connections for each batch linking transit points and complaints across regions
  const batchCorrelations = [];
  const connections = [];

  for (const bid of batchIds) {
    const batch = batchMap.get(bid);
    const bTransits = supplyByBatch.get(bid) || [];
    const bComplaints = nodes.filter(n => n.batchId === bid);
    const distinctRegions = new Set([
      ...bTransits.map(t => t.region).filter(Boolean),
      ...bComplaints.map(c => c.region).filter(Boolean),
    ]);
    const interRegional = distinctRegions.size > 1;

    // Ordered path coordinates: transit points followed by complaint nodes
    const pointsList = [];
    for (const t of bTransits) {
      pointsList.push([t.lat, t.lng]);
    }
    for (const c of bComplaints) {
      pointsList.push([c.lat, c.lng]);
    }

    // Deduplicate consecutive identical coordinates
    const uniquePoints = [];
    for (const pt of pointsList) {
      const last = uniquePoints[uniquePoints.length - 1];
      if (!last || last[0] !== pt[0] || last[1] !== pt[1]) {
        uniquePoints.push(pt);
      }
    }

    if (uniquePoints.length > 1) {
      connections.push({
        batchId: bid,
        lot: batch?.lot || null,
        category: batch?.category || bComplaints[0]?.category || "other",
        productName: batch?.product?.name || bComplaints[0]?.productName || "Product",
        severity: batch?.status || bComplaints[0]?.severity || "safe",
        interRegional,
        regions: [...distinctRegions],
        points: uniquePoints,
      });
    }

    batchCorrelations.push({
      batchId: bid,
      lot: batch?.lot || null,
      category: batch?.category || bComplaints[0]?.category || "other",
      productName: batch?.product?.name || bComplaints[0]?.productName || "Product",
      severity: batch?.status || "safe",
      complaintCount: bComplaints.reduce((acc, c) => acc + c.count, 0),
      interRegional,
      regions: [...distinctRegions],
      transitPoints: bTransits,
      complaintNodes: bComplaints,
      complaints: complaintRecords.filter(c => c.batchId === bid),
    });
  }

  return {
    nodes,
    connections,
    batches: batchCorrelations,
    complaints: complaintRecords,
    summary: {
      totalComplaints: rows.length,
      nodeCount: nodes.length,
      batchCount: batchIds.length,
      days,
    },
    cellSizeKm: Math.round(d * 111),
  };
}

export async function enhancedComplaintMap(params = {}) {
  const result = await publicCorrelations(params);
  return {
    points: result.nodes,
    connections: result.connections,
    batches: result.batches,
    cellSizeKm: result.cellSizeKm,
    days: params.days || 90,
  };
}

export async function publicComplaintsList(params = {}) {
  const result = await publicCorrelations(params);
  return {
    complaints: result.nodes,
    connections: result.connections,
    total: result.summary.totalComplaints,
    summary: result.summary,
  };
}
