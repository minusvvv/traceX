import fs from "node:fs";
import {Router} from "express";
import {Attachment, Complaint, LabReport, SampleRequest, SrComplaint, SampleCollection, Product, Notification, nowIso, nextId} from "../db.js";
import {ah, HttpError, parse} from "../http.js";
import {requireRole} from "../auth.js";
import {audit} from "../audit.js";
import {categoryKeys} from "../domain/categories.js";
import {loadBatch, loadBatches} from "../domain/batches.js";
import {listComplaints} from "../services/complaints.js";
import {rankFlagged} from "../services/prioritization.js";
import {analytics, dashboardSummary, internalHotspots} from "../services/analytics.js";
import {listSampleRequests, getSampleRequest, listReports, reportDto, submitLabReport} from "../services/lab.js";
import * as inv from "../services/investigations.js";
import {renderReportPdf} from "../services/pdf.js";
import {closeSchema, decisionSchema, labReportSchema, providerRecordsSchema, sampleSchema, simulateSchema, collectionStageSchema, notificationRespondSchema} from "../schemas.js";
import {uploader, REPORT_TYPES, filePath, attachmentData} from "../uploads.js";
import {listThresholds} from "../services/thresholds.js";

const STAFF = ["reviewer", "admin"], LAB_VIEW = ["lab", ...STAFF];
const STAGES = ["collection_scheduled", "collected", "in_transit", "at_lab", "testing", "completed"];
const MB = 1024 * 1024;
const labUpload = uploader({types: REPORT_TYPES, maxBytes: 10 * MB, maxFiles: 5}).fields([{name: "report", maxCount: 1}, {name: "supporting", maxCount: 4}]);
const simulate = req => parse(simulateSchema, {simulate: req.body?.simulate || req.get("X-Simulate") || undefined}).simulate;
const r = Router();

// ---- batches (internal view) ----
r.get("/batches", requireRole(...LAB_VIEW), ah(async (req, res) => res.json(await loadBatches({category: categoryKeys.includes(req.query.category) ? req.query.category : null}))));
r.get("/batches/:id", requireRole(...LAB_VIEW), ah(async (req, res) => { const b = await loadBatch(req.params.id); if (!b) throw new HttpError(404, "Batch not found"); res.json(b); }));
r.get("/batches/:id/timeline", requireRole(...LAB_VIEW), ah(async (req, res) => { const b = await loadBatch(req.params.id); if (!b) throw new HttpError(404, "Batch not found"); res.json(b.route); }));
r.get("/batches/:id/lab-reports", requireRole(...LAB_VIEW), ah(async (req, res) => res.json(await listReports(req.user, {batchId: req.params.id}))));

// ---- complaints, prioritisation, dashboard, analytics (reviewers/administrators) ----
r.get("/complaints", requireRole(...STAFF), ah(async (req, res) => res.json(await listComplaints({batchId: req.query.batch, productId: req.query.product, category: req.query.category, status: req.query.status, from: req.query.from, to: req.query.to}))));
r.get("/complaints/summary", requireRole(...STAFF), ah(async (_q, res) => res.json({total: await Complaint.countDocuments()})));
r.get("/prioritization", requireRole(...STAFF), ah(async (_q, res) => res.json({flagged: await rankFlagged(), thresholds: await listThresholds()})));
r.get("/dashboard", requireRole(...STAFF), ah(async (_q, res) => res.json(await dashboardSummary())));
const filters = q => ({category: categoryKeys.includes(q.category) ? q.category : undefined, status: ["safe", "review", "suspicious", "critical"].includes(q.status) ? q.status : undefined,
  from: q.from && !Number.isNaN(Date.parse(q.from)) ? new Date(q.from).toISOString() : undefined, to: q.to && !Number.isNaN(Date.parse(q.to)) ? new Date(q.to + (q.to.length <= 10 ? "T23:59:59Z" : "")).toISOString() : undefined,
  batchId: q.batch || undefined});
r.get("/analytics", requireRole(...STAFF), ah(async (req, res) => res.json(await analytics(filters(req.query)))));
r.get("/analytics/hotspots", requireRole(...STAFF), ah(async (req, res) => res.json(await internalHotspots(filters(req.query)))));

// ---- laboratory ----
r.get("/lab/sample-requests", requireRole(...LAB_VIEW), ah(async (req, res) => res.json(await listSampleRequests(req.user, {status: req.query.status}))));
r.get("/lab/sample-requests/:id", requireRole(...LAB_VIEW), ah(async (req, res) => res.json(await getSampleRequest(req.user, req.params.id))));
r.get("/lab/reports", requireRole(...LAB_VIEW), ah(async (req, res) => res.json(await listReports(req.user))));
r.get("/lab/reports/:id", requireRole(...LAB_VIEW), ah(async (req, res) => {
  const d = await reportDto(req.params.id);
  if (!d || (req.user.role === "lab" && d.lab.toLowerCase() !== (req.user.lab_name || "").toLowerCase())) throw new HttpError(404, "Report not found.");
  res.json(d);
}));
r.post("/lab/reports", requireRole("lab"), labUpload, ah(async (req, res) => res.status(201).json(await submitLabReport(req.user, parse(labReportSchema, req.body), req.files || {}))));

// ---- sample collections (journey tracking) ----
r.get("/lab/collections", requireRole(...LAB_VIEW), ah(async (req, res) => {
  const q = {};
  if (req.query.sample_request_id) q.sample_request_id = req.query.sample_request_id;
  if (req.query.stage) q.stage = req.query.stage;
  const list = await SampleCollection.find(q).sort({created_at: -1}).lean();

  const srIds = [...new Set(list.map(c => c.sample_request_id).filter(Boolean))];
  const srs = new Map((await SampleRequest.find({_id: {$in: srIds}}).lean()).map(s => [s._id, s]));
  const cIds = [...new Set(list.map(c => c.complaint_id).filter(Boolean))];
  const complaints = new Map((await Complaint.find({_id: {$in: cIds}}).select("_id region product_text batch_id product_id").lean()).map(c => [c._id, c]));
  const pIds = [...new Set([...srs.values()].map(s => s.product_id).concat([...complaints.values()].map(c => c.product_id)).filter(Boolean))];
  const products = new Map((await Product.find({_id: {$in: pIds}}).select("_id name category").lean()).map(p => [p._id, p]));

  const enriched = list.map(item => {
    const sr = srs.get(item.sample_request_id);
    const comp = complaints.get(item.complaint_id);
    const prod = products.get(sr?.product_id || comp?.product_id);
    return {
      ...item,
      id: item._id,
      productName: prod?.name || comp?.product_text || "Unknown Product",
      batchId: sr?.batch_id || comp?.batch_id || null,
      region: comp?.region || null,
    };
  });
  res.json(enriched);
}));

r.patch("/lab/collections/:id/stage", requireRole(...LAB_VIEW), ah(async (req, res) => {
  const {stage, note, lab_report_id} = parse(collectionStageSchema, req.body);
  const col = await SampleCollection.findById(req.params.id);
  if (!col) throw new HttpError(404, "Sample collection not found.");

  const currentIdx = STAGES.indexOf(col.stage);
  const nextIdx = STAGES.indexOf(stage);
  if (nextIdx <= currentIdx) {
    throw new HttpError(400, `Cannot move stage backwards or repeat stage. Current stage: ${col.stage}`);
  }

  const at = nowIso();
  col.stage = stage;
  if (lab_report_id) col.lab_report_id = lab_report_id;
  if (!Array.isArray(col.stage_history)) col.stage_history = [];
  col.stage_history.push({
    stage,
    at,
    note: note || `Stage updated to ${stage.replace(/_/g, " ")}`
  });
  await col.save();

  await audit(req.user, "collection.stage_updated", "sample_collection", col._id, {
    stage,
    previousStage: STAGES[currentIdx],
    lab_report_id: lab_report_id || null
  });

  res.json(col);
}));

// ---- direct notification routes on /api/notifications ----
r.get("/notifications", requireRole(), ah(async (req, res) => {
  const userKeys = [String(req.user.id), req.user.email].filter(Boolean);
  const rows = await Notification.find({consumer_id: {$in: userKeys}}).sort({created_at: -1}).limit(50).lean();

  const srIds = [...new Set(rows.map(n => n.sample_request_id).filter(Boolean))];
  const srs = new Map((await SampleRequest.find({_id: {$in: srIds}}).lean()).map(s => [s._id, s]));
  const cIds = [...new Set(rows.map(n => n.complaint_id).filter(Boolean))];
  const complaints = new Map((await Complaint.find({_id: {$in: cIds}}).select("_id batch_id product_id product_text description region").lean()).map(c => [c._id, c]));
  const pIds = [...new Set([...srs.values()].map(s => s.product_id).concat([...complaints.values()].map(c => c.product_id)).filter(Boolean))];
  const products = new Map((await Product.find({_id: {$in: pIds}}).select("_id name category").lean()).map(p => [p._id, p]));
  const collections = new Map((await SampleCollection.find({notification_id: {$in: rows.map(n => n._id)}}).lean()).map(c => [c.notification_id, c]));

  const enriched = rows.map(n => {
    const sr = srs.get(n.sample_request_id);
    const c = complaints.get(n.complaint_id);
    const prod = products.get(sr?.product_id || c?.product_id);
    const col = collections.get(n._id);
    return {
      id: n._id,
      consumerId: n.consumer_id,
      complaintId: n.complaint_id,
      sampleRequestId: n.sample_request_id,
      type: n.type,
      status: n.status,
      createdAt: n.created_at,
      readAt: n.read_at,
      respondedAt: n.responded_at,
      productName: prod?.name || c?.product_text || "Reported Product",
      batchId: sr?.batch_id || c?.batch_id || null,
      region: c?.region || null,
      collectionId: col?._id || null,
      collectionStage: col?.stage || null,
    };
  });

  const unreadCount = rows.filter(n => !n.read_at && n.status === "pending").length;
  res.json({notifications: enriched, unreadCount});
}));

r.post("/notifications/:id/read", requireRole(), ah(async (req, res) => {
  const userKeys = [String(req.user.id), req.user.email].filter(Boolean);
  const n = await Notification.findOne({_id: req.params.id, consumer_id: {$in: userKeys}});
  if (!n) throw new HttpError(404, "Notification not found.");
  if (!n.read_at) {
    n.read_at = nowIso();
    await n.save();
  }
  res.json({ok: true, readAt: n.read_at});
}));

r.post("/notifications/:id/respond", requireRole(), ah(async (req, res) => {
  const userKeys = [String(req.user.id), req.user.email].filter(Boolean);
  const n = await Notification.findOne({_id: req.params.id, consumer_id: {$in: userKeys}});
  if (!n) throw new HttpError(404, "Notification not found.");
  if (n.status !== "pending") {
    throw new HttpError(400, `You have already ${n.status} this request.`);
  }

  const {decision, address} = parse(notificationRespondSchema, req.body);
  const at = nowIso();
  n.status = decision;
  n.responded_at = at;
  n.read_at = n.read_at || at;
  await n.save();

  let collection = null;
  if (decision === "accepted") {
    collection = await SampleCollection.findOne({complaint_id: n.complaint_id});
    if (!collection) {
      collection = await SampleCollection.create({
        _id: await nextId("COL", 3000),
        sample_request_id: n.sample_request_id,
        complaint_id: n.complaint_id,
        consumer_id: String(req.user.id),
        notification_id: n._id,
        collection_address: address || "Address provided during confirmation",
        scheduled_at: at,
        stage: "collection_scheduled",
        stage_history: [{
          stage: "collection_scheduled",
          at,
          note: "Consumer accepted sample testing. Collection pickup scheduled."
        }],
        created_at: at,
      });
      await audit(req.user, "sample_collection.created", "sample_collection", collection._id, {
        notificationId: n._id,
        sampleRequestId: n.sample_request_id
      });
    }
  }

  res.json({
    ok: true,
    status: n.status,
    collectionId: collection?._id || null,
  });
}));

r.get("/notifications/collections/:id", requireRole(), ah(async (req, res) => {
  const col = await SampleCollection.findById(req.params.id).lean();
  if (!col) throw new HttpError(404, "Sample collection journey not found.");

  const isStaff = ["lab", "reviewer", "admin"].includes(req.user.role);
  const userKeys = [String(req.user.id), req.user.email].filter(Boolean);
  if (!isStaff && !userKeys.includes(col.consumer_id)) {
    throw new HttpError(403, "You are not authorized to view this sample journey.");
  }

  const sr = col.sample_request_id ? await SampleRequest.findById(col.sample_request_id).lean() : null;
  const comp = col.complaint_id ? await Complaint.findById(col.complaint_id).select("product_id batch_id product_text region").lean() : null;
  const prodId = sr?.product_id || comp?.product_id;
  const prod = prodId ? await Product.findById(prodId).select("name category brand").lean() : null;

  res.json({
    id: col._id,
    stage: col.stage,
    scheduledAt: col.scheduled_at,
    collectionAddress: isStaff ? col.collection_address : undefined,
    stageHistory: col.stage_history || [],
    labReportId: col.lab_report_id || null,
    productName: prod?.name || comp?.product_text || "Reported Product",
    batchId: sr?.batch_id || comp?.batch_id || null,
    region: comp?.region || null,
    createdAt: col.created_at,
  });
}));

// ---- investigations & reports ----
r.get("/investigations", requireRole(...STAFF), ah(async (req, res) => res.json(await inv.listInvestigations({status: req.query.status, category: req.query.category, batch: req.query.batch}))));
r.get("/investigations/:id", requireRole(...STAFF), ah(async (req, res) => res.json(await inv.getInvestigation(req.params.id))));
r.post("/investigations/:id/traceability", requireRole(...STAFF), ah(async (req, res) => res.json(await inv.runTraceability(req.user, req.params.id, {simulate: simulate(req)}))));
r.post("/investigations/:id/report", requireRole(...STAFF), ah(async (req, res) => { const out = await inv.generateReport(req.user, req.params.id); res.status(out.unchanged ? 200 : 201).json(out); }));
r.post("/investigations/:id/close", requireRole(...STAFF), ah(async (req, res) => res.json(await inv.closeInvestigation(req.user, req.params.id, parse(closeSchema, req.body).reason))));
r.post("/investigations/:id/decision", requireRole("reviewer"), ah(async (req, res) => res.status(201).json(await inv.recordDecision(req.user, req.params.id, parse(decisionSchema, req.body)))));
r.post("/investigations/:id/sample-request", requireRole(...STAFF), ah(async (req, res) => res.status(201).json(await inv.requestSample(req.user, req.params.id, parse(sampleSchema, req.body || {})))));

r.get("/reports/:id", requireRole(...STAFF), ah(async (req, res) => res.json(await inv.getReport(req.params.id))));
r.get("/reports/:id/export", requireRole(...STAFF), ah(async (req, res) => {
  const rep = await inv.getReport(req.params.id), format = req.query.format === "pdf" ? "pdf" : "json";
  await audit(req.user, "report.exported", "report", rep.id, {format});
  res.setHeader("Content-Disposition", `attachment; filename="${rep.id}-v${rep.version}.${format}"`);
  if (format === "pdf") { res.type("application/pdf"); return renderReportPdf(rep, res); }
  res.type("application/json").send(JSON.stringify({id: rep.id, version: rep.version, generatedAt: rep.generatedAt, status: rep.status, submissions: rep.submissions, sha256: rep.sha256, report: rep.content}, null, 2));
}));
r.post("/reports/:id/submit", requireRole(...STAFF), ah(async (req, res) => res.json(await inv.submitReport(req.user, req.params.id, {simulate: simulate(req)}))));
r.post("/reports/:id/acknowledge", requireRole(...STAFF), ah(async (req, res) => res.json(await inv.simulateAcknowledgement(req.user, req.params.id))));

// ---- attachments (never public) ----
r.get("/attachments/:id", requireRole(...LAB_VIEW), ah(async (req, res) => {
  const a = await Attachment.findById(req.params.id).lean();
  if (!a || (!a.data && !fs.existsSync(filePath(a)))) throw new HttpError(404, "File not found.");
  if (req.user.role === "lab") {
    const mine = (req.user.lab_name || "").toLowerCase();
    let ok = false;
    if (a.owner_type === "lab_report") { const lr = await LabReport.findById(a.owner_id).select("lab_name").lean(); ok = !!lr && lr.lab_name.toLowerCase() === mine; }
    else {
      const links = await SrComplaint.find({complaint_id: a.owner_id}).lean();
      const srs = await SampleRequest.find({_id: {$in: links.map(l => l.sample_request_id)}}).select("assigned_lab").lean();
      ok = srs.some(s => !s.assigned_lab || s.assigned_lab.toLowerCase() === mine);
    }
    if (!ok) throw new HttpError(404, "File not found.");
  }
  await audit(req.user, "attachment.downloaded", a.owner_type, a.owner_id, {attachment: a._id});
  res.setHeader("Content-Disposition", `attachment; filename="${a.original_name.replace(/[^\w.\- ]/g, "_")}"`);
  res.type(a.mime);
  if (fs.existsSync(filePath(a))) res.sendFile(filePath(a));
  else res.send(attachmentData(a.data));
}));

// ---- external supply-chain data provider ----
r.post("/provider/supply-chain/:batchId/records", requireRole("provider", "admin"), ah(async (req, res) => res.status(201).json(await inv.addProviderRecords(req.user, req.params.batchId, parse(providerRecordsSchema, req.body).records))));
export default r;
