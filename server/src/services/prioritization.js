// Complaint-based prioritisation (SRS): per-target complaint counts, threshold flagging, recency-weighted ranking,
// and the sample-request workflow. All decisions are made here (server side), never in the UI.
import {Flag, Complaint, Investigation, InvEvent, SampleRequest, SrComplaint, Product, nowIso, nextId} from "../db.js";
import {config} from "../config.js";
import {audit} from "../audit.js";
import {thresholdFor} from "./thresholds.js";
import {loadBatches, loadBatch} from "../domain/batches.js";

const ago = days => new Date(Date.now() - days * 864e5).toISOString();
export const targetFilter = (type, id) => type === "batch" ? {batch_id: id} : {product_id: id, batch_id: null};

export const addInvestigationEvent = (invId, title, state, note = null, kind = null, at = nowIso()) =>
  InvEvent.create({investigation_id: invId, at, title, state, note, kind});

// Complaints counted towards a flag: inside the window and after the last time a negative laboratory result cleared this target.
async function since(type, id, windowDays) {
  const c = await Flag.findOne({target_type: type, target_id: id, status: "cleared"}).sort({cleared_at: -1}).select("cleared_at").lean(), w = ago(windowDays);
  return c?.cleared_at && c.cleared_at > w ? c.cleared_at : w;
}
export async function effectiveCount(type, id, windowDays) {
  return Complaint.countDocuments({...targetFilter(type, id), created_at: {$gt: await since(type, id, windowDays)}});
}

// Creates a laboratory sample request and marks ONLY complaints about the same batch/product as eligible for consumer sample follow-up.
export async function createSampleRequest({batchId = null, productId, flagId = null, investigationId = null, reason, actor = null, assignedLab = null}) {
  const prod = await Product.findById(productId).select("category").lean(), th = await thresholdFor(prod.category);
  const id = await nextId("SR", 2000), at = nowIso();
  await SampleRequest.create({_id: id, batch_id: batchId, product_id: productId, flag_id: flagId, investigation_id: investigationId, assigned_lab: assignedLab, reason, requested_at: at, due_by: new Date(Date.now() + 7 * 864e5).toISOString()});
  const type = batchId ? "batch" : "product", tid = batchId || productId;
  const eligible = (await Complaint.find({...targetFilter(type, tid), created_at: {$gt: await since(type, tid, th.windowDays)}, sample_requested_at: null}).select("_id").lean()).map(c => c._id);
  if (eligible.length) {
    await SrComplaint.insertMany(eligible.map(c => ({sample_request_id: id, complaint_id: c})), {ordered: false}).catch(e => { if (e.code !== 11000 && !e.writeErrors) throw e; });
    await Complaint.updateMany({_id: {$in: eligible}, sample_requested_at: null}, {$set: {sample_requested_at: at}});
  }
  await audit(actor, "sample_request.created", "sample_request", id, {batchId, productId, flagId, reason, complaintsNotified: eligible.length});
  if (investigationId) {
    await addInvestigationEvent(investigationId, "Laboratory sample requested", "pending", `${id} · awaiting laboratory result`, "sample_request", at);
    await Investigation.updateOne({_id: investigationId, status: "open"}, {$set: {status: "awaiting_lab"}});
  }
  return {id, eligibleComplaints: eligible.length};
}

// Reuse an open investigation for the batch when there is one; otherwise open a new one.
export async function ensureInvestigation({batchId = null, productId, flagId = null, title, summary, actor = null}) {
  if (batchId) {
    const open = await Investigation.findOne({batch_id: batchId, status: {$nin: ["closed", "closed_unconfirmed"]}}).sort({opened_at: -1}).lean();
    if (open) { if (flagId && !open.flag_id) await Investigation.updateOne({_id: open._id}, {$set: {flag_id: flagId}}); return {id: open._id, created: false}; }
  }
  const id = await nextId("INV", 10), at = nowIso();
  const stage = batchId ? (await loadBatch(batchId))?.anomaly?.flagged || null : null;
  await Investigation.create({_id: id, batch_id: batchId, product_id: productId, flag_id: flagId, title, stage, status: "open", owner: "Quality team", summary, opened_at: at});
  await addInvestigationEvent(id, "Investigation opened", "done", title, "opened", at);
  await audit(actor, "investigation.opened", "investigation", id, {batchId, productId, flagId});
  return {id, created: true};
}

// Called after a complaint is stored.
export async function onComplaintCreated(c) {
  const type = c.batch_id ? "batch" : c.product_id ? "product" : null;
  if (!type) return {flagged: false};
  const id = c.batch_id || c.product_id, prod = await Product.findById(c.product_id).select("name category").lean(), th = await thresholdFor(prod.category);
  const open = await Flag.findOne({target_type: type, target_id: id, status: "open"}).lean();
  if (open) {
    // Already flagged: a new complaint about the same target joins the existing sample request.
    const sr = await SampleRequest.findOne({flag_id: open._id, status: "requested"}).sort({requested_at: -1}).lean();
    if (sr) {
      await SrComplaint.updateOne({sample_request_id: sr._id, complaint_id: c.id}, {$set: {sample_request_id: sr._id, complaint_id: c.id}}, {upsert: true});
      await Complaint.updateOne({_id: c.id}, {$set: {sample_requested_at: nowIso()}});
    }
    await Flag.updateOne({_id: open._id}, {$set: {complaint_count: await effectiveCount(type, id, th.windowDays)}});
    return {flagged: true, flagId: open._id, existing: true};
  }
  const n = await effectiveCount(type, id, th.windowDays);
  if (n < th.count) return {flagged: false, count: n, threshold: th.count};
  const at = nowIso(), flagId = await nextId("FLG", 0);
  try { await Flag.create({_id: flagId, target_type: type, target_id: id, status: "open", open_key: `${type}:${id}`, flagged_at: at, complaint_count: n, threshold: th.count, window_days: th.windowDays}); }
  catch (e) { if (e.code === 11000) return {flagged: true, existing: true}; throw e; } // another request flagged it first
  await audit(null, "flag.raised", "flag", flagId, {targetType: type, targetId: id, complaintCount: n, threshold: th.count, windowDays: th.windowDays});
  const inv = await ensureInvestigation({batchId: c.batch_id, productId: c.product_id, flagId, title: "Consumer complaints reached the review threshold",
    summary: `${n} consumer complaints about ${type === "batch" ? "batch " + id : prod.name} were received within ${th.windowDays} days (threshold ${th.count}). These are unverified consumer reports; laboratory verification is required before any conclusion.`});
  await addInvestigationEvent(inv.id, "Complaint threshold reached", "alert", `${n} complaints in ${th.windowDays} days (threshold ${th.count})`, "flag", at);
  const sr = await createSampleRequest({batchId: c.batch_id, productId: c.product_id, flagId, investigationId: inv.id, reason: "Complaint threshold reached"});
  return {flagged: true, flagId, investigationId: inv.id, sampleRequestId: sr.id};
}

// Open flags ranked by complaint volume weighted by recency (half-life from config).
export async function rankFlagged() {
  const flags = await Flag.find({status: "open"}).lean();
  if (!flags.length) return [];
  const batches = new Map((await loadBatches({ids: flags.filter(f => f.target_type === "batch").map(f => f.target_id)})).map(b => [b.id, b]));
  const now = Date.now(), hl = config.recencyHalfLifeDays;
  const out = await Promise.all(flags.map(async f => {
    const cs = await Complaint.find({...targetFilter(f.target_type, f.target_id), created_at: {$gt: ago(f.window_days)}}).sort({created_at: -1}).select("created_at").lean();
    const priority = cs.reduce((s, c) => s + Math.pow(0.5, (now - Date.parse(c.created_at)) / 864e5 / hl), 0);
    const b = f.target_type === "batch" ? batches.get(f.target_id) : null;
    const p = f.target_type === "product" ? await Product.findById(f.target_id).select("name category").lean() : null;
    const inv = await Investigation.findOne({flag_id: f._id}).sort({opened_at: -1}).select("_id").lean();
    return {flagId: f._id, targetType: f.target_type, targetId: f.target_id, batchId: b?.id || null, product: b?.product || p?.name, category: b?.category || p?.category,
      count: cs.length, threshold: f.threshold, windowDays: f.window_days, priority: +priority.toFixed(2), lastComplaintAt: cs[0]?.created_at || null,
      flaggedAt: f.flagged_at, investigationId: inv?._id || null, status: b?.status || "suspicious", labStatus: b?.labStatus || "none"};
  }));
  return out.sort((a, b) => b.priority - a.priority || b.count - a.count).map((r, i) => ({rank: i + 1, ...r}));
}

export async function clearFlag(flagId, reason, actor, extra = {}) {
  const r = await Flag.updateOne({_id: flagId, status: "open"}, {$set: {status: "cleared", cleared_at: nowIso(), cleared_reason: reason}, $unset: {open_key: 1}});
  if (r.modifiedCount) await audit(actor, "flag.cleared", "flag", flagId, {reason, ...extra});
}
