import crypto from "node:crypto";
import {db, nowIso, nextId, tx} from "../db.js";
import {audit} from "../audit.js";
import {HttpError} from "../http.js";
import {resolveIdentifier, loadBatches, toPublic} from "../domain/batches.js";
import {persistFiles, discardFiles, attachmentDto} from "../uploads.js";
import {regionByKey, nearestRegion} from "../geo.js";
import {onComplaintCreated} from "./prioritization.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const trackingCode = () => {
  const b = crypto.randomBytes(12);
  const s = [...b].map(x => ALPHABET[x % ALPHABET.length]).join("");
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

const productInfo = pid => db.prepare("SELECT id,name,category,brand FROM products WHERE id=?").get(pid);

export function createComplaint(input, files = {}) {
  if (input.idempotencyKey) {
    const dup = db.prepare("SELECT tracking_code FROM complaints WHERE idempotency_key=?").get(input.idempotencyKey);
    if (dup) return {...publicComplaintView(dup.tracking_code), duplicate: true};
  }
  const hasImage = (files.productImage || []).length > 0;
  if (!input.identifier && !input.productText && !hasImage)
    throw new HttpError(422, "Please identify the product: enter a batch code, a product name, or attach a photo of the label.", {fields: {identifier: "Enter a batch or product code, or attach a label photo"}});

  let {batchId, productId} = resolveIdentifier(input.identifier);
  if (!productId && input.productText) {
    const m = db.prepare("SELECT id FROM products WHERE name=? COLLATE NOCASE").all(input.productText.trim());
    if (m.length === 1) productId = m[0].id;
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
  const written = [];
  try {
    return tx(() => {
      const id = nextId("complaints", "C", 1000), code = trackingCode(), at = nowIso();
      db.prepare(`INSERT INTO complaints(id,tracking_code,idempotency_key,batch_id,product_id,submitted_identifier,identifier_source,product_text,description,lang,region,lat,lng,contact,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, code, input.idempotencyKey || null, batchId, productId, input.identifier || null, input.identifierSource || "manual",
        input.productText || null, input.description, input.lang || "en", region, lat, lng, input.contact || null, at);
      const ins = rec => db.prepare("INSERT INTO attachments VALUES(@id,@owner_type,@owner_id,@kind,@original_name,@mime,@size,@sha256,@stored_name,@uploaded_by,@uploaded_at)").run(rec);
      for (const [kind, list] of [["product_image", files.productImage], ["photo", files.photos]])
        written.push(...persistFiles(list, {ownerType: "complaint", ownerId: id, kind, insert: ins}));
      audit(null, "complaint.created", "complaint", id, {batchId, productId, region, attachments: written.length, matched: batchId ? "batch" : productId ? "product" : "none"});
      const outcome = onComplaintCreated({id, batch_id: batchId, product_id: productId});
      return {...publicComplaintView(code), duplicate: false, _flagged: outcome.flagged};
    });
  } catch (e) {
    discardFiles(written);
    if (String(e.message).includes("UNIQUE") && input.idempotencyKey) {
      const dup = db.prepare("SELECT tracking_code FROM complaints WHERE idempotency_key=?").get(input.idempotencyKey);
      if (dup) return {...publicComplaintView(dup.tracking_code), duplicate: true};
    }
    throw e;
  }
}

// What the consumer who filed the complaint may see. Never includes contact details, coordinates or internal risk data.
export function publicComplaintView(code) {
  const c = db.prepare("SELECT * FROM complaints WHERE tracking_code=?").get(String(code || "").toUpperCase());
  if (!c) return null;
  const batch = c.batch_id ? loadBatches({ids: [c.batch_id]})[0] : null;
  const prodFlag = !c.batch_id && c.product_id ? !!db.prepare("SELECT 1 FROM flags WHERE target_type='product' AND target_id=? AND status='open'").get(c.product_id) : false;
  const status = complaintStatus(c, batch, prodFlag), p = c.product_id ? productInfo(c.product_id) : null;
  const pub = batch ? toPublic(batch) : null;
  return {
    complaintId: c.id, trackingCode: c.tracking_code, receivedAt: c.created_at, description: c.description, status, statusLabel: STATUS_LABEL[status],
    matched: batch ? "batch" : p ? "product" : "none",
    product: p ? {name: p.name, category: p.category, brand: p.brand, batchId: batch?.id || null, lot: batch?.lot || null, batchStatus: pub?.status || null, regulatory: pub?.regulatory || null} : null,
    sampleRequested: !!c.sample_requested_at, locationRecorded: !!c.region || c.lat != null, region: c.region,
    attachments: db.prepare("SELECT COUNT(*) n FROM attachments WHERE owner_type='complaint' AND owner_id=?").get(c.id).n,
  };
}

const maskContact = s => !s ? null : s.includes("@") ? s.replace(/^(.).*(@.*)$/, "$1***$2") : s.length > 4 ? "•".repeat(s.length - 2) + s.slice(-2) : "••••";

// Staff view: complaint text and coarse region only; contact is masked and coordinates are never returned.
export function listComplaints({batchId, productId, category, status, from, to, limit = 200} = {}) {
  const w = [], p = [];
  if (batchId) { w.push("c.batch_id=? COLLATE NOCASE"); p.push(batchId); }
  if (productId) { w.push("c.product_id=?"); p.push(productId); }
  if (category) { w.push("pr.category=?"); p.push(category); }
  if (from) { w.push("c.created_at>=?"); p.push(from); }
  if (to) { w.push("c.created_at<=?"); p.push(to); }
  const rows = db.prepare(`SELECT c.*, pr.name pname, pr.category, pr.brand FROM complaints c LEFT JOIN products pr ON pr.id=c.product_id
    ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY c.created_at DESC LIMIT ?`).all(...p, Math.min(limit, 500));
  const batches = new Map(loadBatches().map(b => [b.id.toLowerCase(), b]));
  const prodFlags = new Set(db.prepare("SELECT target_id FROM flags WHERE target_type='product' AND status='open'").all().map(r => r.target_id));
  const out = rows.map(c => {
    const st = complaintStatus(c, c.batch_id ? batches.get(c.batch_id.toLowerCase()) : null, prodFlags.has(c.product_id));
    return {id: c.id, batch: c.batch_id, productId: c.product_id, product: c.pname, category: c.category, date: c.created_at, text: c.description, region: c.region,
      status: st, statusLabel: STATUS_LABEL[st], sampleRequested: !!c.sample_requested_at, contact: maskContact(c.contact), lang: c.lang,
      attachments: db.prepare("SELECT id,kind,original_name,mime,size,sha256,uploaded_at FROM attachments WHERE owner_type='complaint' AND owner_id=?").all(c.id).map(a => attachmentDto({...a, original_name: a.original_name}))};
  });
  return status ? out.filter(c => c.status === status) : out;
}
