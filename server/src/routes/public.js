import {Router} from "express";
import rateLimit from "express-rate-limit";
import {config} from "../config.js";
import fs from "node:fs";
import {Attachment, Batch, Product} from "../db.js";
import {ah, HttpError, parse} from "../http.js";
import {complaintSchema} from "../schemas.js";
import {requireRole} from "../auth.js";
import {categoryMeta, categoryKeys} from "../domain/categories.js";
import {loadBatch, loadBatches, resolveIdentifier, toPublic} from "../domain/batches.js";
import {createComplaint, publicComplaintView, listMyComplaints} from "../services/complaints.js";
import {publicHeatmap, issueCorrelations} from "../services/analytics.js";
import {lookupOpenFoodFacts} from "../services/openfoodfacts.js";
import {uploader, IMAGE_TYPES, filePath, attachmentData} from "../uploads.js";
import {REGIONS, reverseGeocodeNominatim} from "../geo.js";

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
  capabilities: {
    ocr: false,
    openFoodFacts: true,
    reverseGeocode: true,
    correlations: true,
    barcodeNote: "Automatic reading of label text (OCR) uses client-side browser Tesseract.js. Open Food Facts integration provides global GTIN lookup.",
  },
  simulation: config.allowSimulation,
  uploads: {complaintMaxMB: 5, complaintMaxPhotos: 4, allowed: ["JPEG", "PNG", "WebP"]},
})));

r.get("/batches/:identifier", ah(async (req, res) => {
  const {batchId, productId} = await resolveIdentifier(req.params.identifier);
  const b = batchId && await loadBatch(batchId);
  if (b) return res.json(toPublic(b));

  if (productId) {
    const prod = await Product.findById(productId).lean();
    if (prod) {
      return res.json({
        id: prod.gtin || prod._id,
        product: prod.name,
        category: prod.category,
        brand: prod.brand,
        manufacturer: prod.manufacturer,
        status: "safe",
        score: null,
        route: [],
        stages: [],
        isProductOnly: true,
        notice: "Product verified in catalog. No active batch recall or incident reported.",
      });
    }
  }

  // Fallback: check Open Food Facts for universal GTINs
  const off = await lookupOpenFoodFacts(req.params.identifier);
  if (off) {
    return res.json({
      id: off.gtin,
      product: off.name,
      category: off.category,
      brand: off.brand,
      manufacturer: off.brand,
      status: "safe",
      score: null,
      route: [],
      stages: [],
      isOpenFoodFacts: true,
      imageUrl: off.imageUrl,
      ingredients: off.ingredients,
      nutriscore: off.nutriscore,
      notice: "Product verified in Open Food Facts global registry. No regulatory action recorded.",
    });
  }

  throw new HttpError(404, "We couldn't find that batch.");
}));

r.get("/barcode-lookup/:code", ah(async (req, res) => {
  const code = String(req.params.code || "").trim();
  const {batchId, productId} = await resolveIdentifier(code);

  if (batchId) {
    const b = await loadBatch(batchId);
    if (b) return res.json({found: true, source: "tracex_batch", batchId: b.id, name: b.product, brand: b.brand, category: b.category});
  }

  if (productId) {
    const p = await Product.findById(productId).lean();
    if (p) return res.json({found: true, source: "tracex_product", productId: p._id, name: p.name, brand: p.brand, category: p.category});
  }

  const off = await lookupOpenFoodFacts(code);
  if (off) return res.json({found: true, ...off});

  res.json({found: false, gtin: code});
}));

r.get("/reverse-geocode", ah(async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new HttpError(400, "Valid latitude and longitude are required.");
  const loc = await reverseGeocodeNominatim(lat, lng);
  res.json({ok: true, location: loc});
}));

r.get("/correlations", ah(async (req, res) => {
  const category = categoryKeys.includes(req.query.category) ? req.query.category : undefined;
  const batchId = req.query.batchId || undefined;
  res.json(await issueCorrelations({category, batchId}));
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
  res.json(await publicHeatmap({category, days}));
}));

export default r;
