// Complaint-based prioritisation (SRS): per-target complaint counts, threshold flagging, recency-weighted ranking,
// and the sample-request workflow. All decisions are made here (server side), never in the UI.
import {db, nowIso, nextId} from "../db.js";
import {config} from "../config.js";
import {audit} from "../audit.js";
import {thresholdFor} from "./thresholds.js";
import {loadBatches, loadBatch} from "../domain/batches.js";

const ago = days => new Date(Date.now() - days * 864e5).toISOString();
export const targetWhere = type => type === "batch" ? "batch_id = ?" : "product_id = ? AND batch_id IS NULL";

export function addInvestigationEvent(invId, title, state, note = null, kind = null, at = nowIso()) {
  db.prepare("INSERT INTO investigation_events(investigation_id,at,title,state,note,kind) VALUES(?,?,?,?,?,?)").run(invId, at, title, state, note, kind);
}

// Complaints counted towards a flag: inside the window and after the last time a negative laboratory result cleared this target.
export function effectiveCount(type, id, windowDays) {
  const cleared = db.prepare("SELECT MAX(cleared_at) c FROM flags WHERE target_type=? AND target_id=? AND status='cleared'").get(type, id)?.c;
  const since = cleared && cleared > ago(windowDays) ? cleared : ago(windowDays);
  return db.prepare(`SELECT COUNT(*) n FROM complaints WHERE ${targetWhere(type)} AND created_at > ?`).get(id, since).n;
}

function eligibleComplaints(type, id, windowDays) {
  const cleared = db.prepare("SELECT MAX(cleared_at) c FROM flags WHERE target_type=? AND target_id=? AND status='cleared'").get(type, id)?.c;
  const since = cleared && cleared > ago(windowDays) ? cleared : ago(windowDays);
  return db.prepare(`SELECT id FROM complaints WHERE ${targetWhere(type)} AND created_at > ? AND sample_requested_at IS NULL`).all(id, since).map(r => r.id);
}

// Creates a laboratory sample request and marks ONLY complaints about the same batch/product as eligible for consumer sample follow-up.
export function createSampleRequest({batchId = null, productId, flagId = null, investigationId = null, reason, actor = null, assignedLab = null}) {
  const cat = db.prepare("SELECT category FROM products WHERE id=?").get(productId).category;
  const th = thresholdFor(cat), id = nextId("sample_requests", "SR", 2000), at = nowIso();
  db.prepare("INSERT INTO sample_requests(id,batch_id,product_id,flag_id,investigation_id,assigned_lab,reason,requested_at,due_by) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(id, batchId, productId, flagId, investigationId, assignedLab, reason, at, new Date(Date.now() + 7 * 864e5).toISOString());
  const targetType = batchId ? "batch" : "product", targetId = batchId || productId;
  const eligible = eligibleComplaints(targetType, targetId, th.windowDays);
  const link = db.prepare("INSERT OR IGNORE INTO sample_request_complaints(sample_request_id,complaint_id) VALUES(?,?)");
  const mark = db.prepare("UPDATE complaints SET sample_requested_at=? WHERE id=? AND sample_requested_at IS NULL");
  for (const c of eligible) { link.run(id, c); mark.run(at, c); }
  audit(actor, "sample_request.created", "sample_request", id, {batchId, productId, flagId, reason, complaintsNotified: eligible.length});
  if (investigationId) {
    addInvestigationEvent(investigationId, "Laboratory sample requested", "pending", `${id} · awaiting laboratory result`, "sample_request", at);
    db.prepare("UPDATE investigations SET status='awaiting_lab' WHERE id=? AND status='open'").run(investigationId);
  }
  return {id, eligibleComplaints: eligible.length};
}

// Reuse an open investigation for the batch when there is one; otherwise open a new one.
export function ensureInvestigation({batchId = null, productId, flagId = null, title, summary, actor = null}) {
  if (batchId) {
    const open = db.prepare("SELECT id FROM investigations WHERE batch_id=? AND status NOT IN ('closed','closed_unconfirmed') ORDER BY opened_at DESC").get(batchId);
    if (open) { if (flagId) db.prepare("UPDATE investigations SET flag_id=COALESCE(flag_id,?) WHERE id=?").run(flagId, open.id); return {id: open.id, created: false}; }
  }
  const id = nextId("investigations", "INV", 10), at = nowIso();
  const stage = batchId ? loadBatch(batchId)?.anomaly?.flagged || null : null;
  db.prepare("INSERT INTO investigations(id,batch_id,product_id,flag_id,title,stage,status,owner,summary,opened_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(id, batchId, productId, flagId, title, stage, "open", "Quality team", summary, at);
  addInvestigationEvent(id, "Investigation opened", "done", title, "opened", at);
  audit(actor, "investigation.opened", "investigation", id, {batchId, productId, flagId});
  return {id, created: true};
}

// Called inside the complaint-creation transaction.
export function onComplaintCreated(c) {
  const type = c.batch_id ? "batch" : c.product_id ? "product" : null;
  if (!type) return {flagged: false};
  const id = c.batch_id || c.product_id, category = db.prepare("SELECT category, name FROM products WHERE id=?").get(c.product_id);
  const th = thresholdFor(category.category);
  const open = db.prepare("SELECT * FROM flags WHERE target_type=? AND target_id=? AND status='open'").get(type, id);
  if (open) {
    // Already flagged: a new complaint about the same target joins the existing sample request.
    const sr = db.prepare("SELECT id FROM sample_requests WHERE flag_id=? AND status='requested' ORDER BY requested_at DESC").get(open.id);
    if (sr) {
      db.prepare("INSERT OR IGNORE INTO sample_request_complaints VALUES(?,?)").run(sr.id, c.id);
      db.prepare("UPDATE complaints SET sample_requested_at=? WHERE id=?").run(nowIso(), c.id);
    }
    db.prepare("UPDATE flags SET complaint_count=? WHERE id=?").run(effectiveCount(type, id, th.windowDays), open.id);
    return {flagged: true, flagId: open.id, existing: true};
  }
  const n = effectiveCount(type, id, th.windowDays);
  if (n < th.count) return {flagged: false, count: n, threshold: th.count};
  const at = nowIso();
  const flagId = db.prepare("INSERT INTO flags(target_type,target_id,flagged_at,complaint_count,threshold,window_days) VALUES(?,?,?,?,?,?)")
    .run(type, id, at, n, th.count, th.windowDays).lastInsertRowid;
  audit(null, "flag.raised", "flag", flagId, {targetType: type, targetId: id, complaintCount: n, threshold: th.count, windowDays: th.windowDays});
  const inv = ensureInvestigation({batchId: c.batch_id, productId: c.product_id, flagId,
    title: "Consumer complaints reached the review threshold",
    summary: `${n} consumer complaints about ${type === "batch" ? "batch " + id : category.name} were received within ${th.windowDays} days (threshold ${th.count}). These are unverified consumer reports; laboratory verification is required before any conclusion.`});
  addInvestigationEvent(inv.id, "Complaint threshold reached", "alert", `${n} complaints in ${th.windowDays} days (threshold ${th.count})`, "flag", at);
  const sr = createSampleRequest({batchId: c.batch_id, productId: c.product_id, flagId, investigationId: inv.id, reason: "Complaint threshold reached"});
  return {flagged: true, flagId, investigationId: inv.id, sampleRequestId: sr.id};
}

// Open flags ranked by complaint volume weighted by recency (half-life from config).
export function rankFlagged() {
  const flags = db.prepare("SELECT * FROM flags WHERE status='open'").all();
  if (!flags.length) return [];
  const batches = new Map(loadBatches().map(b => [b.id.toLowerCase(), b]));
  const now = Date.now(), hl = config.recencyHalfLifeDays;
  const out = flags.map(f => {
    const cs = db.prepare(`SELECT created_at FROM complaints WHERE ${targetWhere(f.target_type)} AND created_at > ? ORDER BY created_at DESC`)
      .all(f.target_id, ago(f.window_days));
    const priority = cs.reduce((s, c) => s + Math.pow(0.5, (now - Date.parse(c.created_at)) / 864e5 / hl), 0);
    const b = f.target_type === "batch" ? batches.get(f.target_id.toLowerCase()) : null;
    const p = f.target_type === "product" ? db.prepare("SELECT name, category FROM products WHERE id=?").get(f.target_id) : null;
    const inv = db.prepare("SELECT id,status FROM investigations WHERE flag_id=? ORDER BY opened_at DESC").get(f.id);
    return {flagId: f.id, targetType: f.target_type, targetId: f.target_id, batchId: b?.id || null, product: b?.product || p?.name, category: b?.category || p?.category,
      count: cs.length, threshold: f.threshold, windowDays: f.window_days, priority: +priority.toFixed(2), lastComplaintAt: cs[0]?.created_at || null,
      flaggedAt: f.flagged_at, investigationId: inv?.id || null, status: b?.status || "suspicious", labStatus: b?.labStatus || "none"};
  });
  return out.sort((a, b) => b.priority - a.priority || b.count - a.count).map((r, i) => ({rank: i + 1, ...r}));
}

export function clearFlagsForBatch(batchId, reason, actor) {
  for (const f of db.prepare("SELECT * FROM flags WHERE target_type='batch' AND target_id=? AND status='open'").all(batchId)) {
    db.prepare("UPDATE flags SET status='cleared', cleared_at=?, cleared_reason=? WHERE id=?").run(nowIso(), reason, f.id);
    audit(actor, "flag.cleared", "flag", f.id, {batchId, reason});
  }
}
