import {Router} from "express";
import rateLimit from "express-rate-limit";
import {config} from "../config.js";
import fs from "node:fs";
import {Attachment, Batch, Complaint, Notification, SampleCollection, SampleRequest, Product, nowIso, nextId} from "../db.js";
import {ah, HttpError, parse} from "../http.js";
import {complaintSchema, notificationRespondSchema} from "../schemas.js";
import {requireRole} from "../auth.js";
import {audit} from "../audit.js";
import {categoryMeta, categoryKeys} from "../domain/categories.js";
import {loadBatch, loadBatches, resolveIdentifier, toPublic} from "../domain/batches.js";
import {createComplaint, publicComplaintView, listMyComplaints} from "../services/complaints.js";
import {publicHeatmap, enhancedComplaintMap, publicCorrelations, publicComplaintsList} from "../services/analytics.js";
import {uploader, IMAGE_TYPES, filePath, attachmentData} from "../uploads.js";
import {REGIONS} from "../geo.js";

export const limiter = (windowMs, max, message) => config.rateLimit
  ? rateLimit({windowMs, max, standardHeaders: true, legacyHeaders: false, handler: (_q, _s, next) => next(new HttpError(429, message))})
  : (_q, _s, next) => next();

const r = Router();
const MB = 1024 * 1024;
const complaintUpload = uploader({types: IMAGE_TYPES, maxBytes: 5 * MB, maxFiles: 5}).fields([{name: "productImage", maxCount: 1}, {name: "photos", maxCount: 4}]);

r.use(limiter(60e3, 120, "Too many requests. Please slow down."));

r.get("/meta", ah(async (_q, res) => res.json({
  categories: categoryMeta(), regions: REGIONS.map(({key, name}) => ({key, name})), languages: ["en", "hi"],
  demoData: !!(await Batch.exists({is_demo: true})),
  capabilities: {ocr: false, barcodeNote: "Automatic reading of label text (OCR) is not available. A browser barcode reader is used where supported; otherwise enter the code manually."},
  simulation: config.allowSimulation,
  uploads: {complaintMaxMB: 5, complaintMaxPhotos: 4, allowed: ["JPEG", "PNG", "WebP"]},
})));

r.get("/batches/:identifier", ah(async (req, res) => {
  const {batchId} = await resolveIdentifier(req.params.identifier);
  const b = batchId && await loadBatch(batchId);
  if (!b) throw new HttpError(404, "We couldn't find that batch.");
  res.json(toPublic(b));
}));
r.get("/showcase", ah(async (_q, res) => res.json((await loadBatches()).filter(b => b.isDemo).map(toPublic))));

r.post("/complaints", limiter(3600e3, 20, "Too many complaints from this connection. Please try again later."), requireRole("consumer"), complaintUpload, ah(async (req, res) => {
  const input = parse(complaintSchema, req.body);
  const key = req.get("Idempotency-Key");
  if (key && /^[\w-]{8,64}$/.test(key)) input.idempotencyKey = key;
  const out = await createComplaint(input, req.files || {}, req.user);
  const {_flagged, ...body} = out;
  res.status(out.duplicate ? 200 : 201).json(body);
}));
r.get("/complaints/:code", ah(async (req, res) => {
  const v = await publicComplaintView(req.params.code);
  if (!v) throw new HttpError(404, "No complaint found for that tracking code.");
  res.json(v);
}));
r.get("/my-complaints", requireRole("consumer"), ah(async (req, res) => res.json(await listMyComplaints(req.user.id))));
r.get("/complaint-attachments/:id", ah(async (req, res) => {
  const a = await Attachment.findOne({_id: req.params.id, owner_type: "complaint", kind: {$in: ["photo", "product_image"]}}).select("mime stored_name data").lean();
  if (!a || !IMAGE_TYPES.includes(a.mime) || (!a.data && !fs.existsSync(filePath(a)))) throw new HttpError(404, "Image not found.");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.setHeader("Content-Disposition", "inline");
  res.type(a.mime);
  if (fs.existsSync(filePath(a))) res.sendFile(filePath(a));
  else res.send(attachmentData(a.data));
}));
r.get("/heatmap", ah(async (req, res) => {
  const category = categoryKeys.includes(req.query.category) ? req.query.category : undefined;
  const days = [7, 30, 90, 365].includes(+req.query.days) ? +req.query.days : 90;
  const minReports = req.query.minReports ? +req.query.minReports : undefined;
  res.json(await publicHeatmap({category, days, minReports}));
}));
r.get("/complaints", ah(async (req, res) => {
  const category = categoryKeys.includes(req.query.category) ? req.query.category : undefined;
  const days = [7, 30, 90, 365].includes(+req.query.days) ? +req.query.days : 90;
  const batchId = req.query.batchId ? String(req.query.batchId).toUpperCase() : undefined;
  const userId = req.query.userId || undefined;
  const city = req.query.city || undefined;
  const viewerUserId = req.user?.id || req.query.viewerUserId || undefined;
  res.json(await publicComplaintsList({category, days, batchId, userId, city, viewerUserId}));
}));
r.get("/correlations", ah(async (req, res) => {
  const category = categoryKeys.includes(req.query.category) ? req.query.category : undefined;
  const days = [7, 30, 90, 365].includes(+req.query.days) ? +req.query.days : 90;
  const batchId = req.query.batchId ? String(req.query.batchId).toUpperCase() : undefined;
  const userId = req.query.userId || undefined;
  const city = req.query.city || undefined;
  const viewerUserId = req.user?.id || req.query.viewerUserId || undefined;
  res.json(await publicCorrelations({category, days, batchId, userId, city, viewerUserId}));
}));
r.get("/complaint-map", ah(async (req, res) => {
  const category = categoryKeys.includes(req.query.category) ? req.query.category : undefined;
  const days = [7, 30, 90, 365].includes(+req.query.days) ? +req.query.days : 90;
  const batchId = req.query.batchId ? String(req.query.batchId).toUpperCase() : undefined;
  const userId = req.query.userId || undefined;
  const city = req.query.city || undefined;
  const viewerUserId = req.user?.id || req.query.viewerUserId || undefined;
  res.json(await enhancedComplaintMap({category, days, batchId, userId, city, viewerUserId}));
}));

// ---- notifications (consumer alerts) ----
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

// ---- sample journey tracking (consumer / shared view) ----
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

export default r;
