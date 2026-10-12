import crypto from "node:crypto";
import {Complaint, Product, Batch, Attachment, Flag, nowIso, nextId, tx} from "../db.js";
import {audit} from "../audit.js";
import {HttpError} from "../http.js";
import {resolveIdentifier, loadBatches, toPublic} from "../domain/batches.js";
import {persistFiles, discardFiles, attachmentDto} from "../uploads.js";
import {regionByKey, nearestRegion} from "../geo.js";
import {onComplaintCreated} from "./prioritization.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const trackingCode = () => {
  const s = [...crypto.randomBytes(12)].map(x => ALPHABET[x % ALPHABET.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
};
export const STATUS_LABEL = {
  received_unmatched: "Received (product not matched)", recorded: "Recorded", under_review: "Under review",
  sample_requested: "Sample requested", lab_confirmed: "Laboratory confirmed an issue", closed_not_confirmed: "Closed: not confirmed by laboratory",
};

// Consumer-facing status is derived from the batch/product state, so it can never disagree with the underlying records.
export function complaintStatus(c, batch, productFlagged) {
  if (!c.batch_id && !c.product_id) return "received_unmatched";
  if (batch?.labStatus === "confirmed") return "lab_confirmed";
  if (batch && !batch.flagged && batch.labStatus === "clear" && c.sample_requested_at) return "closed_not_confirmed";
  if (c.sample_requested_at) return "sample_requested";
  if (batch?.flagged || productFlagged) return "under_review";
  return "recorded";
}

export async function createComplaint(input, files = {}, actor = null) {
  const existing = async () => { const d = await Complaint.findOne({idempotency_key: input.idempotencyKey}).select("tracking_code").lean(); return d ? {...await publicComplaintView(d.tracking_code), duplicate: true} : null; };
  if (input.idempotencyKey) { const d = await existing(); if (d) return d; }
  if (!input.identifier && !input.productText && !(files.productImage || []).length)
    throw new HttpError(422, "Please identify the product: enter a batch code, a product name, or attach a photo of the label.", {fields: {identifier: "Enter a batch or product code, or attach a label photo"}});

  let {batchId, productId} = await resolveIdentifier(input.identifier);
  if (!productId && input.productText) {
    const m = await Product.find({name: new RegExp("^" + input.productText.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i")}).select("_id").lean();
    if (m.length === 1) productId = m[0]._id;
  }
  let region = null, lat = null, lng = null;
  if (input.lat != null && input.lng != null) {
    lat = Math.round(input.lat * 1000) / 1000; lng = Math.round(input.lng * 1000) / 1000;
    region = nearestRegion(lat, lng)?.name || null;
  } else if (input.regionKey) {
    const r = regionByKey(input.regionKey);
    if (!r) throw new HttpError(422, "Unknown region.", {fields: {region: "Choose a region from the list"}});
    region = r.name; lat = r.lat; lng = r.lng;
  }
  const id = await nextId("C", 1000), code = trackingCode(), at = nowIso();
  let written = [], outcome;
  try {
    written = [...persistFiles(files.productImage, {ownerType: "complaint", ownerId: id, kind: "product_image"}), ...persistFiles(files.photos, {ownerType: "complaint", ownerId: id, kind: "photo"})];
    await tx(async () => {
      await Complaint.create({_id: id, tracking_code: code, idempotency_key: input.idempotencyKey || undefined, batch_id: batchId, product_id: productId, submitted_identifier: input.identifier || undefined,
        identifier_source: input.identifierSource || "manual", product_text: input.productText || undefined, description: input.description, lang: input.lang || "en", region, lat, lng, contact: input.contact || undefined,
        submitted_by: actor?.id, created_at: at});
      if (written.length) await Attachment.insertMany(written);
      await audit(actor, "complaint.created", "complaint", id, {batchId, productId, region, attachments: written.length, matched: batchId ? "batch" : productId ? "product" : "none"});
    });
    outcome = await onComplaintCreated({id, batch_id: batchId, product_id: productId});
  } catch (e) {
    if (e.code === 11000 && input.idempotencyKey) { discardFiles(written); const d = await existing(); if (d) return d; }
    if (!(await Complaint.exists({_id: id}))) discardFiles(written);
    throw e;
  }
  return {...await publicComplaintView(code), duplicate: false, _flagged: outcome.flagged};
}

// What the consumer who filed the complaint may see. Never includes contact details, coordinates or internal risk data.
export async function publicComplaintView(code) {
  const c = await Complaint.findOne({tracking_code: String(code || "").toUpperCase()}).lean();
  if (!c) return null;
  const batch = c.batch_id ? (await loadBatches({ids: [c.batch_id]}))[0] : null;
  const prodFlag = !c.batch_id && c.product_id ? !!(await Flag.exists({target_type: "product", target_id: c.product_id, status: "open"})) : false;
  const status = complaintStatus(c, batch, prodFlag), p = c.product_id ? await Product.findById(c.product_id).select("name category brand").lean() : null;
  const pub = batch ? toPublic(batch) : null;
  const relatedTerms = [];
  if (c.batch_id) relatedTerms.push({batch_id: c.batch_id});
  if (c.product_id) relatedTerms.push({product_id: c.product_id});
  if (c.submitted_identifier?.trim()) relatedTerms.push({submitted_identifier: new RegExp("^" + c.submitted_identifier.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i")});
  const similarQuery = relatedTerms.length ? {_id: {$ne: c._id}, $or: relatedTerms} : null;
  const [similarCount, similarRows] = similarQuery
    ? await Promise.all([
      Complaint.countDocuments(similarQuery),
      Complaint.find(similarQuery).select("_id batch_id product_id sample_requested_at created_at description").sort({created_at: -1}).limit(20).lean(),
    ])
    : [0, []];
  const relatedBatchIds = [...new Set(similarRows.map(r => r.batch_id).filter(Boolean))];
  const relatedBatches = new Map((await loadBatches({ids: relatedBatchIds})).map(b => [b.id, b]));
  const relatedProductIds = [...new Set(similarRows.map(r => r.product_id).filter(Boolean))];
  const relatedProducts = new Map((await Product.find({_id: {$in: relatedProductIds}}).select("name category").lean()).map(x => [x._id, x]));
  const relatedProductFlags = new Set((await Flag.find({target_type: "product", target_id: {$in: relatedProductIds}, status: "open"}).select("target_id").lean()).map(x => x.target_id));
  const relatedAttachments = await Attachment.find({owner_type: "complaint", owner_id: {$in: similarRows.map(r => r._id)}, kind: {$in: ["photo", "product_image"]}})
    .select("_id owner_id mime").lean();
  const photosByComplaint = new Map();
  for (const a of relatedAttachments) (photosByComplaint.get(a.owner_id) || photosByComplaint.set(a.owner_id, []).get(a.owner_id)).push({id: String(a._id), mime: a.mime});
  const similarReports = [];
  for (const r of similarRows) {
    const relatedBatch = r.batch_id ? relatedBatches.get(r.batch_id) : null;
    const relatedProductId = relatedBatch?.productId || r.product_id;
    const relatedProduct = relatedProducts.get(relatedProductId);
    const relatedStatus = complaintStatus(r, relatedBatch, relatedProductFlags.has(relatedProductId));
    similarReports.push({product: relatedProduct?.name || null, batchId: relatedBatch?.id || null, status: relatedStatus, receivedAt: r.created_at,
      description: r.description, photos: photosByComplaint.get(r._id) || []});
  }
  return {
    complaintId: c._id, trackingCode: c.tracking_code, receivedAt: c.created_at, description: c.description, status, statusLabel: STATUS_LABEL[status],
    matched: batch ? "batch" : p ? "product" : "none",
    product: p ? {name: p.name, category: p.category, brand: p.brand ?? null, batchId: batch?.id || null, lot: batch?.lot || null, batchStatus: pub?.status || null, regulatory: pub?.regulatory || null} : null,
    similarReports: {count: similarCount, reports: similarReports},
    sampleRequested: !!c.sample_requested_at, locationRecorded: !!c.region || c.lat != null, region: c.region ?? null,
    attachments: await Attachment.countDocuments({owner_type: "complaint", owner_id: c._id}),
  };
}

const maskContact = s => !s ? null : s.includes("@") ? s.replace(/^(.).*(@.*)$/, "$1***$2") : s.length > 4 ? "•".repeat(s.length - 2) + s.slice(-2) : "••••";

// Staff view: complaint text and coarse region only; contact is masked and coordinates are never returned.
export async function listComplaints({batchId, productId, category, status, from, to, limit = 200} = {}) {
  const q = {};
  if (batchId) {
    const id = String(batchId).toUpperCase(), batch = await Batch.findById(id).select("lot_number").lean();
    const identifiers = [id, batch?.lot_number].filter(Boolean).map(s => new RegExp("^" + String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i"));
    q.$or = [{batch_id: id}, {submitted_identifier: {$in: identifiers}}];
  }
  if (productId) q.product_id = productId;
  if (from || to) q.created_at = {...(from && {$gte: from}), ...(to && {$lte: to})};
  let rows = await Complaint.find(q).sort({created_at: -1}).limit(Math.min(limit, 500)).lean();
  const prods = new Map((await Product.find({_id: {$in: [...new Set(rows.map(c => c.product_id).filter(Boolean))]}}).lean()).map(p => [p._id, p]));
  if (category) rows = rows.filter(c => prods.get(c.product_id)?.category === category);
  const batches = new Map((await loadBatches({ids: [...new Set(rows.map(c => c.batch_id).filter(Boolean))]})).map(b => [b.id, b]));
  const prodFlags = new Set((await Flag.find({target_type: "product", status: "open"}).lean()).map(f => f.target_id));
  const atts = await Attachment.find({owner_type: "complaint", owner_id: {$in: rows.map(c => c._id)}}).lean(), byOwner = new Map();
  for (const a of atts) (byOwner.get(a.owner_id) || byOwner.set(a.owner_id, []).get(a.owner_id)).push(attachmentDto(a));
  const out = rows.map(c => {
    const st = complaintStatus(c, c.batch_id ? batches.get(c.batch_id) : null, prodFlags.has(c.product_id)), p = prods.get(c.product_id);
    return {id: c._id, batch: c.batch_id ?? null, productId: c.product_id ?? null, product: p?.name, category: p?.category, date: c.created_at, text: c.description, region: c.region ?? null,
      status: st, statusLabel: STATUS_LABEL[st], sampleRequested: !!c.sample_requested_at, contact: maskContact(c.contact), lang: c.lang, attachments: byOwner.get(c._id) || []};
  });
  return status ? out.filter(c => c.status === status) : out;
}
