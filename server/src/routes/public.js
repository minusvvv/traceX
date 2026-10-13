import {Router} from "express";
import rateLimit from "express-rate-limit";
import {config} from "../config.js";
import fs from "node:fs";
import {Attachment, Batch} from "../db.js";
import {ah, HttpError, parse} from "../http.js";
import {complaintSchema} from "../schemas.js";
import {requireRole} from "../auth.js";
import {categoryMeta, categoryKeys} from "../domain/categories.js";
import {loadBatch, loadBatches, resolveIdentifier, toPublic} from "../domain/batches.js";
import {createComplaint, publicComplaintView} from "../services/complaints.js";
import {publicHeatmap} from "../services/analytics.js";
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
  res.json(await publicHeatmap({category, days}));
}));
export default r;
