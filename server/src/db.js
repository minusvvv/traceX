// MongoDB data layer (Mongoose). Field names intentionally mirror the API's snake_case row shape.
// Timestamps are stored as ISO-8601 strings so they sort and compare lexicographically and serialise unchanged.
import mongoose from "mongoose";
import {config} from "./config.js";

mongoose.set("strictQuery", true);
mongoose.set("transactionAsyncLocalStorage", true); // lets tx() attach one session to every operation inside it

const {Schema} = mongoose, Mixed = Schema.Types.Mixed;
const opts = {versionKey: false, minimize: false, strict: "throw"};
const make = (name, coll, def, indexes = [], hooks) => {
  const s = new Schema(def, opts);
  for (const [spec, o] of indexes) s.index(spec, o);
  hooks?.(s);
  return mongoose.model(name, s, coll);
};
const WRITE_OPS = ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace"], DELETE_OPS = ["deleteOne", "deleteMany", "findOneAndDelete"];
const blockAll = msg => s => { for (const op of [...WRITE_OPS, ...DELETE_OPS]) s.pre(op, function () { throw new Error(msg); }); s.pre("save", function () { if (!this.isNew) throw new Error(msg); }); };

export const User = make("User", "users", {email: {type: String, required: true, lowercase: true, trim: true}, name: String, role: String, password_hash: String, lab_name: String, accreditation_ref: String,
  active: {type: Boolean, default: true}, failed_logins: {type: Number, default: 0}, locked_until: String, created_at: String}, [[{email: 1}, {unique: true}]]);
export const Product = make("Product", "products", {_id: String, name: String, category: String, brand: String, manufacturer: String, gtin: String, attributes: {type: Mixed, default: {}}}, [[{gtin: 1}, {unique: true, sparse: true}]]);
export const Batch = make("Batch", "batches", {_id: String, product_id: String, lot_number: String, lot_key: String, quantity: String, manufactured_on: String, expires_on: String, facility: String, temperature_c: Number,
  destination_place: String, destination_lat: Number, destination_lng: Number, created_at: String, is_demo: {type: Boolean, default: false}}, [[{lot_key: 1}, {}], [{product_id: 1}, {}]]);
export const SupplyRecord = make("SupplyRecord", "supply_chain_records", {batch_id: String, stage: String, party_name: String, party_role: String, lat: Number, lng: Number, region: String, occurred_at: String,
  readings: Mixed, notes: String, quality_score: Number, source: {type: String, default: "internal"}}, [[{batch_id: 1, occurred_at: 1}, {}]]);
export const Complaint = make("Complaint", "complaints", {_id: String, tracking_code: String, idempotency_key: String, batch_id: String, product_id: String, submitted_identifier: String, identifier_source: String, product_text: String,
  description: String, lang: String, region: String, lat: Number, lng: Number, contact: String, submitted_by: String, sample_requested_at: String, created_at: String, is_demo: {type: Boolean, default: false}},
  [[{tracking_code: 1}, {unique: true}], [{idempotency_key: 1}, {unique: true, sparse: true}], [{batch_id: 1, created_at: 1}, {}], [{product_id: 1, created_at: 1}, {}], [{submitted_by: 1, created_at: -1}, {}]]);
export const Attachment = make("Attachment", "attachments", {_id: String, owner_type: String, owner_id: String, kind: String, original_name: String, mime: String, size: Number, sha256: String, stored_name: String, data: Buffer, uploaded_by: String, uploaded_at: String}, [[{owner_type: 1, owner_id: 1}, {}]]);
export const Threshold = make("Threshold", "thresholds", {_id: String, count: Number, window_days: Number, updated_by: String, updated_at: String});
// open_key is set only while a flag is open; the sparse unique index therefore allows at most one open flag per target.
export const Flag = make("Flag", "flags", {_id: String, target_type: String, target_id: String, status: String, open_key: String, flagged_at: String, complaint_count: Number, threshold: Number, window_days: Number, cleared_at: String, cleared_reason: String},
  [[{open_key: 1}, {unique: true, sparse: true}]]);
export const Investigation = make("Investigation", "investigations", {_id: String, batch_id: String, product_id: String, flag_id: String, title: String, stage: String, status: String, owner: String, summary: String, opened_at: String, closed_at: String, closure_reason: String}, [[{batch_id: 1}, {}]]);
export const InvEvent = make("InvEvent", "investigation_events", {investigation_id: String, at: String, title: String, state: String, note: String, kind: String}, [[{investigation_id: 1, at: 1}, {}]]);
export const SampleRequest = make("SampleRequest", "sample_requests", {_id: String, batch_id: String, product_id: String, flag_id: String, investigation_id: String, assigned_lab: String, status: {type: String, default: "requested"}, reason: String, requested_at: String, due_by: String});
export const SrComplaint = make("SrComplaint", "sample_request_complaints", {sample_request_id: String, complaint_id: String}, [[{sample_request_id: 1, complaint_id: 1}, {unique: true}]]);
// Lab reports are evidence: content can never change or be deleted; the only permitted update is marking a report superseded by a correction.
export const LabReport = make("LabReport", "lab_reports", {_id: String, sample_request_id: String, batch_id: String, lab_name: String, accreditation_ref: String, outcome: String, contamination_type: String, severity: String,
  results: Mixed, notes: String, active_key: String, status: {type: String, default: "submitted"}, supersedes_id: String, correction_reason: String, submitted_by: String, submitted_at: String}, [[{batch_id: 1, submitted_at: 1}, {}], [{active_key: 1}, {unique: true, sparse: true}]],
  s => {
    for (const op of ["updateOne", "updateMany", "findOneAndUpdate"]) s.pre(op, function () {
      // The only permitted change: mark superseded (and release the one-active-report-per-request key).
      const u = this.getUpdate() || {}, set = u.$set || {}, uns = u.$unset || {};
      const ok = Object.keys(u).every(k => ["$set", "$unset"].includes(k)) && Object.keys(set).length === 1 && set.status === "superseded" && Object.keys(uns).every(k => k === "active_key");
      if (!ok) throw new Error("lab report content is immutable; submit a correction instead");
    });
    for (const op of ["replaceOne", "findOneAndReplace", ...DELETE_OPS]) s.pre(op, function () { throw new Error("lab reports are immutable and cannot be replaced or deleted"); });
    s.pre("save", function () { if (!this.isNew) throw new Error("lab report content is immutable; submit a correction instead"); });
  });
export const Analysis = make("Analysis", "investigation_analysis", {_id: String, trace: Mixed, hotspots: Mixed, risk: Mixed, provider: Mixed, warnings: Mixed, computed_at: String, computed_by: String});
export const Report = make("Report", "reports", {_id: String, investigation_id: String, version: Number, content: Mixed, content_sha256: String, generated_by: String, generated_at: String},
  [[{investigation_id: 1, version: 1}, {unique: true}]], blockAll("generated reports are immutable"));
export const Submission = make("Submission", "report_submissions", {report_id: String, attempt: Number, adapter: String, simulated: Boolean, status: String, external_ref: String, error: String, attempted_at: String, attempted_by: String},
  [[{report_id: 1, attempt: 1, status: 1}, {unique: true}]]);
export const Decision = make("Decision", "regulatory_decisions", {investigation_id: String, batch_id: String, decision: String, authority_ref: String, notes: String, decided_on: String, recorded_by: String, recorded_at: String});
export const Audit = make("Audit", "audit_log", {seq: Number, at: String, actor_id: String, actor_email: String, actor_role: String, action: String, entity_type: String, entity_id: String, details: String, prev_hash: String, hash: String},
  [[{seq: 1}, {unique: true}], [{entity_type: 1, entity_id: 1}, {}]], blockAll("audit_log is append-only"));
const Counter = make("Counter", "counters", {_id: String, seq: Number});

export async function connectDb(uri = config.mongoUri) {
  await mongoose.connect(uri, {serverSelectionTimeoutMS: 8000});
  await Promise.all(Object.values(mongoose.models).map(m => m.init().catch(e => { console.error(`[db] index build failed for ${m.modelName}:`, e.message); throw e; })));
  return mongoose.connection;
}
export const disconnectDb = () => mongoose.disconnect();
export const dbName = () => mongoose.connection.name;

export const nowIso = () => new Date().toISOString();
export const jparse = (v, d = null) => v == null ? d : typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return d; } })() : v;
export const up = s => String(s ?? "").trim().toUpperCase();

// Atomic sequential ids ("C-1183"). The counter document is created on first use, then incremented atomically.
export async function nextId(prefix, base = 1000) {
  try { await Counter.updateOne({_id: prefix}, {$setOnInsert: {seq: base}}, {upsert: true}); } catch (e) { if (e.code !== 11000) throw e; }
  return `${prefix}-${(await Counter.findOneAndUpdate({_id: prefix}, {$inc: {seq: 1}}, {new: true})).seq}`;
}
export const bumpCounter = (prefix, n) => Counter.updateOne({_id: prefix}, {$max: {seq: n}}, {upsert: true});

// Runs fn atomically when MONGO_TRANSACTIONS=true (requires a replica set); otherwise just runs it.
// Without transactions every operation is still individually atomic and validation always happens before writes.
export const tx = fn => config.mongoTransactions ? mongoose.connection.transaction(fn) : fn();
export const dropDatabase = () => mongoose.connection.dropDatabase();
