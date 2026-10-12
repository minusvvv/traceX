import {SampleRequest, SrComplaint, Complaint, LabReport, Batch, Product, User, Attachment, Flag, Investigation, InvEvent, nowIso, nextId, tx, jparse, up} from "../db.js";
import {audit} from "../audit.js";
import {HttpError} from "../http.js";
import {getCategory, validateResults} from "../domain/categories.js";
import {loadBatch} from "../domain/batches.js";
import {persistFiles, discardFiles, attachmentDto} from "../uploads.js";
import {addInvestigationEvent, ensureInvestigation, clearFlag} from "./prioritization.js";

export const OUTCOME_LABEL = {confirmed: "Contamination confirmed", not_confirmed: "Not confirmed", inconclusive: "Inconclusive"};
const fieldErr = (msg, fields) => new HttpError(422, msg, {fields});
const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();
const visibleTo = (user, s) => user.role !== "lab" || !s.assigned_lab || same(s.assigned_lab, user.lab_name);

async function withProducts(rows) {
  const prods = new Map((await Product.find({_id: {$in: [...new Set(rows.map(r => r.product_id))]}}).lean()).map(p => [p._id, p]));
  return rows.map(r => ({...r, product_name: prods.get(r.product_id)?.name, category: prods.get(r.product_id)?.category}));
}
const srRow = async id => (await withProducts(await SampleRequest.find({_id: id}).lean()))[0] || null;

// Complaint summaries for a sample request: text, date and coarse region only, never contact details or coordinates.
async function complaintSummaries(srId) {
  const ids = (await SrComplaint.find({sample_request_id: srId}).lean()).map(l => l.complaint_id);
  return (await Complaint.find({_id: {$in: ids}}).sort({created_at: -1}).lean()).map(c => ({id: c._id, date: c.created_at, text: c.description, region: c.region ?? null}));
}
async function srDto(s, detail = false) {
  const cat = getCategory(s.category), complaints = await complaintSummaries(s._id), b = s.batch_id ? await loadBatch(s.batch_id) : null;
  const dto = {id: s._id, status: s.status, batch: s.batch_id ?? null, productId: s.product_id, product: s.product_name, category: s.category, categoryLabel: cat.label,
    reason: s.reason, requestedAt: s.requested_at, dueBy: s.due_by, assignedLab: s.assigned_lab ?? null, investigationId: s.investigation_id ?? null, complaintCount: complaints.length, batchIdentified: !!s.batch_id};
  if (detail) {
    const reps = await LabReport.find({sample_request_id: s._id}).sort({submitted_at: 1}).lean();
    Object.assign(dto, {tests: cat.tests, contaminationTypes: cat.contaminationTypes, complaints,
      batchInfo: b && {id: b.id, lot: b.lot, qty: b.qty, brand: b.brand, manufacturer: b.manufacturer, manufacturedOn: b.manufacturedOn, expiresOn: b.expiresOn, facility: b.facility, route: b.route.map(r => ({stage: r.stage, place: r.place, time: r.time, readings: r.readings}))},
      reports: await reportDtos(reps)});
  }
  return dto;
}

export async function listSampleRequests(user, {status} = {}) {
  const rows = await withProducts(await SampleRequest.find(status ? {status} : {}).sort({requested_at: -1}).lean());
  return Promise.all(rows.filter(s => visibleTo(user, s)).map(s => srDto(s)));
}
export async function getSampleRequest(user, id) {
  const s = await srRow(id);
  if (!s || !visibleTo(user, s)) throw new HttpError(404, "Sample request not found.");
  return srDto(s, true);
}

export async function reportDtos(rows) {
  if (!rows.length) return [];
  const batches = new Map((await Batch.find({_id: {$in: [...new Set(rows.map(r => r.batch_id))]}}).lean()).map(b => [b._id, b]));
  const prods = new Map((await Product.find({_id: {$in: [...new Set([...batches.values()].map(b => b.product_id))]}}).lean()).map(p => [p._id, p]));
  const users = new Map((await User.find({_id: {$in: [...new Set(rows.map(r => r.submitted_by).filter(Boolean))]}}).select("name").lean().catch(() => [])).map(u => [String(u._id), u.name]));
  const atts = await Attachment.find({owner_type: "lab_report", owner_id: {$in: rows.map(r => r._id)}}).sort({uploaded_at: 1}).lean(), byOwner = new Map();
  for (const a of atts) (byOwner.get(a.owner_id) || byOwner.set(a.owner_id, []).get(a.owner_id)).push(attachmentDto(a));
  return rows.map(r => {
    const p = prods.get(batches.get(r.batch_id)?.product_id), cat = getCategory(p?.category), results = jparse(r.results, {});
    return {id: r._id, sampleRequestId: r.sample_request_id ?? null, batch: r.batch_id, product: p?.name, category: p?.category, lab: r.lab_name, accreditationRef: r.accreditation_ref,
      date: r.submitted_at, outcome: r.outcome, status: r.status === "superseded" ? "Superseded" : OUTCOME_LABEL[r.outcome], reportStatus: r.status,
      contaminationType: r.contamination_type ?? null, severity: r.severity ?? null, results,
      resultRows: cat.tests.filter(t => results[t.code] != null).map(t => ({code: t.code, label: t.label, unit: t.unit || "", value: results[t.code]})),
      note: r.notes ?? null, supersedes: r.supersedes_id ?? null, correctionReason: r.correction_reason ?? null, submittedBy: users.get(String(r.submitted_by)) || null, attachments: byOwner.get(r._id) || []};
  });
}
export async function reportDto(id) { const r = await LabReport.findById(id).lean(); return r ? (await reportDtos([r]))[0] : null; }
export async function listReports(user, {batchId} = {}) {
  const rows = await LabReport.find(batchId ? {batch_id: up(batchId)} : {}).sort({submitted_at: -1}).lean();
  return reportDtos(rows.filter(r => user.role !== "lab" || same(r.lab_name, user.lab_name)));
}

export async function submitLabReport(user, f, files) {
  if (!user.lab_name || !user.accreditation_ref) throw new HttpError(403, "Your account has no laboratory name or accreditation reference on file. Ask an administrator to complete your laboratory profile.");
  const batch = await loadBatch(f.batchId);
  if (!batch) throw fieldErr("Batch not found.", {batchId: "No batch exists with this identifier"});
  const errors = {};
  if (!same(f.accreditationRef.trim(), user.accreditation_ref)) errors.accreditationRef = "Does not match the accreditation reference registered for your laboratory";

  let sr = null;
  if (f.sampleRequestId) {
    sr = await srRow(f.sampleRequestId);
    if (!sr || !visibleTo(user, sr)) throw new HttpError(404, "Sample request not found.");
    if (sr.batch_id && sr.batch_id !== batch.id) errors.batchId = `This sample request is for batch ${sr.batch_id}, not ${batch.id}`;
    if (!sr.batch_id && sr.product_id !== batch.productId) errors.batchId = "This batch belongs to a different product than the one in the sample request";
  } else {
    const open = await SampleRequest.findOne({status: "requested", batch_id: batch.id}).select("_id").lean();
    if (open) errors.sampleRequestId = `Batch ${batch.id} has an open sample request (${open._id}); submit the report against it`;
  }
  const {clean, errors: rerr} = validateResults(batch.category, f.results);
  if (Object.keys(rerr).length) errors.results = Object.entries(rerr).map(([k, v]) => `${k}: ${v}`).join("; ");
  else if (!Object.keys(clean).length) errors.results = "Record at least one test result";
  if (f.outcome === "confirmed") {
    if (!f.contaminationType) errors.contaminationType = "Required when contamination is confirmed";
    else if (!getCategory(batch.category).contaminationTypes.includes(f.contaminationType)) errors.contaminationType = "Not a recognised type for this product category";
    if (!f.severity) errors.severity = "Required when contamination is confirmed";
  } else if (f.contaminationType || f.severity) errors.outcome = "Contamination type and severity apply only to confirmed contamination";
  if (!(files.report || []).length) errors.report = "Upload the laboratory report (PDF or image)";

  const prior = sr ? await LabReport.findOne({sample_request_id: sr._id, status: "submitted"}).lean() : null;
  const confirmedBefore = await LabReport.findOne({batch_id: batch.id, outcome: "confirmed", status: "submitted"}).lean();
  const mustCorrect = prior || confirmedBefore;
  let superseded = null;
  if (mustCorrect) {
    if (!f.supersedes || f.supersedes !== mustCorrect._id) errors.supersedes = `A report (${mustCorrect._id}) already exists. Submit this as an explicit correction of it`;
    else if (!f.correctionReason || f.correctionReason.trim().length < 10) errors.correctionReason = "Explain the correction (at least 10 characters)";
    else superseded = mustCorrect;
  } else if (f.supersedes) errors.supersedes = "There is no earlier report to correct";
  if (Object.keys(errors).length) throw fieldErr("The report could not be submitted. Please correct the highlighted fields.", errors);

  const id = await nextId("LAB", 2000), at = nowIso();
  let written = [];
  try {
    written = [...persistFiles(files.report, {ownerType: "lab_report", ownerId: id, kind: "report", userId: user.id}), ...persistFiles(files.supporting, {ownerType: "lab_report", ownerId: id, kind: "supporting", userId: user.id})];
    await tx(async () => {
      if (superseded) { // release the one-active-report key first, so the correction can take it
        await LabReport.updateOne({_id: superseded._id}, {$set: {status: "superseded"}, $unset: {active_key: 1}});
        await audit(user, "lab_report.superseded", "lab_report", superseded._id, {by: id, reason: f.correctionReason});
      }
      await LabReport.create({_id: id, sample_request_id: sr?._id, batch_id: batch.id, lab_name: user.lab_name, accreditation_ref: user.accreditation_ref, outcome: f.outcome,
        contamination_type: f.contaminationType || undefined, severity: f.severity || undefined, results: clean, notes: f.notes || undefined, active_key: sr ? sr._id : undefined,
        supersedes_id: superseded?._id, correction_reason: superseded ? f.correctionReason.trim() : undefined, submitted_by: user.id, submitted_at: at});
      await Attachment.insertMany(written);
      await audit(user, "lab_report.uploaded", "lab_report", id, {batchId: batch.id, sampleRequestId: sr?._id || null, outcome: f.outcome, accreditationRef: user.accreditation_ref,
        files: written.map(w => ({name: w.original_name, sha256: w.sha256, size: w.size})), supersedes: superseded?._id || null});
      await applyOutcome({user, id, batch, sr, outcome: f.outcome, at});
    });
  } catch (e) {
    discardFiles(written);
    if (e.code === 11000) throw new HttpError(409, "A report for this sample request was submitted at the same moment. Refresh and submit a correction if needed.");
    throw e;
  }
  return reportDto(id);
}

// Moves the sample request, flag and investigation along according to the laboratory outcome.
async function applyOutcome({user, id, batch, sr, outcome, at}) {
  let inv = sr?.investigation_id ? await Investigation.findById(sr.investigation_id).lean() : null;
  if (!inv) inv = await Investigation.findOne({batch_id: batch.id, status: {$nin: ["closed", "closed_unconfirmed"]}}).sort({opened_at: -1}).lean();
  if (inv && !inv.batch_id) await Investigation.updateOne({_id: inv._id}, {$set: {batch_id: batch.id}}); // product-level case: laboratory identified the batch
  if (sr) {
    if (!sr.batch_id) await SampleRequest.updateOne({_id: sr._id}, {$set: {batch_id: batch.id}});
    await SampleRequest.updateOne({_id: sr._id}, {$set: {status: outcome === "inconclusive" ? "submitted" : "closed"}});
  }
  if (inv) await InvEvent.updateMany({investigation_id: inv._id, kind: "sample_request", state: "pending"}, {$set: {state: "done"}});
  const setStatus = async (status, extra = {}) => {
    await Investigation.updateOne({_id: inv._id}, {$set: {status, ...(extra.closedAt && {closed_at: extra.closedAt}), ...(extra.reason && {closure_reason: extra.reason})}});
    await audit(user, "investigation.status_changed", "investigation", inv._id, {from: inv.status, to: status, cause: id});
  };
  if (outcome === "confirmed") {
    if (!inv) inv = await Investigation.findById((await ensureInvestigation({batchId: batch.id, productId: batch.productId, title: "Laboratory-confirmed contamination", summary: "A laboratory report confirmed contamination for this batch.", actor: user})).id).lean();
    await setStatus("lab_confirmed");
    await addInvestigationEvent(inv._id, "Laboratory confirmed contamination", "alert", `${id} · ${user.lab_name}`, "lab", at);
  } else if (outcome === "not_confirmed") {
    if (sr?.flag_id) await clearFlag(sr.flag_id, `Laboratory report ${id} did not confirm contamination`, user, {cause: id});
    if (inv) {
      await setStatus("closed_unconfirmed", {closedAt: at, reason: `Laboratory report ${id} did not confirm contamination.`});
      await addInvestigationEvent(inv._id, "Laboratory result: not confirmed", "done", `${id} · investigation closed. Complaints remain recorded but are not confirmed contamination.`, "lab", at);
    }
  } else if (inv) {
    await setStatus("open");
    await addInvestigationEvent(inv._id, "Laboratory result inconclusive", "alert", `${id} · a further sample may be requested`, "lab", at);
  }
}
