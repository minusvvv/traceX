import {db, nowIso, nextId, tx, jparse} from "../db.js";
import {audit} from "../audit.js";
import {HttpError} from "../http.js";
import {getCategory, validateResults} from "../domain/categories.js";
import {loadBatch} from "../domain/batches.js";
import {persistFiles, discardFiles, attachmentDto} from "../uploads.js";
import {addInvestigationEvent, ensureInvestigation} from "./prioritization.js";

export const OUTCOME_LABEL = {confirmed: "Contamination confirmed", not_confirmed: "Not confirmed", inconclusive: "Inconclusive"};
const fieldErr = (msg, fields) => new HttpError(422, msg, {fields});

const srRow = id => db.prepare(`SELECT s.*, p.name product_name, p.category FROM sample_requests s JOIN products p ON p.id=s.product_id WHERE s.id=?`).get(id);
const visibleTo = (user, s) => user.role !== "lab" || !s.assigned_lab || s.assigned_lab.toLowerCase() === (user.lab_name || "").toLowerCase();

// Complaint summaries for a sample request: text, date and coarse region only, never contact details or coordinates.
function complaintSummaries(srId) {
  return db.prepare(`SELECT c.id, c.created_at date, c.description text, c.region FROM sample_request_complaints l JOIN complaints c ON c.id=l.complaint_id
    WHERE l.sample_request_id=? ORDER BY c.created_at DESC`).all(srId);
}
function srDto(s, detail = false) {
  const cat = getCategory(s.category), b = s.batch_id ? loadBatch(s.batch_id) : null;
  const complaints = complaintSummaries(s.id);
  const dto = {id: s.id, status: s.status, batch: s.batch_id, productId: s.product_id, product: s.product_name, category: s.category, categoryLabel: cat.label,
    reason: s.reason, requestedAt: s.requested_at, dueBy: s.due_by, assignedLab: s.assigned_lab, investigationId: s.investigation_id,
    complaintCount: complaints.length, batchIdentified: !!s.batch_id};
  if (detail) Object.assign(dto, {tests: cat.tests, contaminationTypes: cat.contaminationTypes, complaints,
    batchInfo: b && {id: b.id, lot: b.lot, qty: b.qty, brand: b.brand, manufacturer: b.manufacturer, manufacturedOn: b.manufacturedOn, expiresOn: b.expiresOn, facility: b.facility, route: b.route.map(r => ({stage: r.stage, place: r.place, time: r.time, readings: r.readings}))},
    reports: db.prepare("SELECT id FROM lab_reports WHERE sample_request_id=? ORDER BY submitted_at").all(s.id).map(r => reportDto(r.id))});
  return dto;
}

export function listSampleRequests(user, {status} = {}) {
  const rows = db.prepare(`SELECT s.*, p.name product_name, p.category FROM sample_requests s JOIN products p ON p.id=s.product_id ${status ? "WHERE s.status=?" : ""} ORDER BY s.requested_at DESC`).all(...(status ? [status] : []));
  return rows.filter(s => visibleTo(user, s)).map(s => srDto(s));
}
export function getSampleRequest(user, id) {
  const s = srRow(id);
  if (!s || !visibleTo(user, s)) throw new HttpError(404, "Sample request not found.");
  return srDto(s, true);
}

export function reportDto(id) {
  const r = db.prepare(`SELECT r.*, p.name product_name, p.category, u.name submitter FROM lab_reports r JOIN batches b ON b.id=r.batch_id JOIN products p ON p.id=b.product_id LEFT JOIN users u ON u.id=r.submitted_by WHERE r.id=?`).get(id);
  if (!r) return null;
  const cat = getCategory(r.category), results = jparse(r.results, {});
  return {id: r.id, sampleRequestId: r.sample_request_id, batch: r.batch_id, product: r.product_name, category: r.category, lab: r.lab_name, accreditationRef: r.accreditation_ref,
    date: r.submitted_at, outcome: r.outcome, status: r.status === "superseded" ? "Superseded" : OUTCOME_LABEL[r.outcome], reportStatus: r.status,
    contaminationType: r.contamination_type, severity: r.severity, results,
    resultRows: cat.tests.filter(t => results[t.code] != null).map(t => ({code: t.code, label: t.label, unit: t.unit || "", value: results[t.code]})),
    note: r.notes, supersedes: r.supersedes_id, correctionReason: r.correction_reason, submittedBy: r.submitter || null,
    attachments: db.prepare("SELECT * FROM attachments WHERE owner_type='lab_report' AND owner_id=? ORDER BY uploaded_at").all(r.id).map(attachmentDto)};
}
export function listReports(user, {batchId} = {}) {
  const rows = db.prepare(`SELECT id, lab_name FROM lab_reports ${batchId ? "WHERE batch_id=? COLLATE NOCASE" : ""} ORDER BY submitted_at DESC`).all(...(batchId ? [batchId] : []));
  return rows.filter(r => user.role !== "lab" || r.lab_name.toLowerCase() === (user.lab_name || "").toLowerCase()).map(r => reportDto(r.id));
}

export function submitLabReport(user, f, files) {
  if (!user.lab_name || !user.accreditation_ref) throw new HttpError(403, "Your account has no laboratory name or accreditation reference on file. Ask an administrator to complete your laboratory profile.");
  const batch = loadBatch(f.batchId);
  if (!batch) throw fieldErr("Batch not found.", {batchId: "No batch exists with this identifier"});
  const errors = {};
  if (f.accreditationRef.trim().toLowerCase() !== user.accreditation_ref.toLowerCase()) errors.accreditationRef = "Does not match the accreditation reference registered for your laboratory";

  let sr = null;
  if (f.sampleRequestId) {
    sr = srRow(f.sampleRequestId);
    if (!sr || !visibleTo(user, sr)) throw new HttpError(404, "Sample request not found.");
    if (sr.batch_id && sr.batch_id.toLowerCase() !== batch.id.toLowerCase()) errors.batchId = `This sample request is for batch ${sr.batch_id}, not ${batch.id}`;
    if (!sr.batch_id && sr.product_id !== batch.productId) errors.batchId = "This batch belongs to a different product than the one in the sample request";
  } else {
    const open = db.prepare("SELECT id FROM sample_requests WHERE status='requested' AND batch_id=? COLLATE NOCASE").get(batch.id);
    if (open) errors.sampleRequestId = `Batch ${batch.id} has an open sample request (${open.id}); submit the report against it`;
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

  const prior = sr ? db.prepare("SELECT * FROM lab_reports WHERE sample_request_id=? AND status='submitted'").get(sr.id) : null;
  const confirmedBefore = db.prepare("SELECT * FROM lab_reports WHERE batch_id=? COLLATE NOCASE AND outcome='confirmed' AND status='submitted'").get(batch.id);
  const mustCorrect = prior || confirmedBefore;
  let superseded = null;
  if (mustCorrect) {
    if (!f.supersedes || f.supersedes !== mustCorrect.id) errors.supersedes = `A report (${mustCorrect.id}) already exists. Submit this as an explicit correction of it`;
    else if (!f.correctionReason || f.correctionReason.trim().length < 10) errors.correctionReason = "Explain the correction (at least 10 characters)";
    else superseded = mustCorrect;
  } else if (f.supersedes) errors.supersedes = "There is no earlier report to correct";
  if (Object.keys(errors).length) throw fieldErr("The report could not be submitted. Please correct the highlighted fields.", errors);

  const written = [];
  try {
    return tx(() => {
      const id = nextId("lab_reports", "LAB", 2000), at = nowIso();
      db.prepare(`INSERT INTO lab_reports(id,sample_request_id,batch_id,lab_name,accreditation_ref,outcome,contamination_type,severity,results,notes,supersedes_id,correction_reason,submitted_by,submitted_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, sr?.id || null, batch.id, user.lab_name, user.accreditation_ref, f.outcome, f.contaminationType || null, f.severity || null,
        JSON.stringify(clean), f.notes || null, superseded?.id || null, superseded ? f.correctionReason.trim() : null, user.id, at);
      const ins = rec => db.prepare("INSERT INTO attachments VALUES(@id,@owner_type,@owner_id,@kind,@original_name,@mime,@size,@sha256,@stored_name,@uploaded_by,@uploaded_at)").run(rec);
      for (const [kind, list] of [["report", files.report], ["supporting", files.supporting]])
        written.push(...persistFiles(list, {ownerType: "lab_report", ownerId: id, kind, userId: user.id, insert: ins}));
      audit(user, "lab_report.uploaded", "lab_report", id, {batchId: batch.id, sampleRequestId: sr?.id || null, outcome: f.outcome, accreditationRef: user.accreditation_ref,
        files: written.map(w => ({name: w.original_name, sha256: w.sha256, size: w.size})), supersedes: superseded?.id || null});
      if (superseded) { db.prepare("UPDATE lab_reports SET status='superseded' WHERE id=?").run(superseded.id); audit(user, "lab_report.superseded", "lab_report", superseded.id, {by: id, reason: f.correctionReason}); }
      applyOutcome({user, id, batch, sr, outcome: f.outcome, at, f});
      return reportDto(id);
    });
  } catch (e) { discardFiles(written); throw e; }
}

// Moves the sample request, flag and investigation along according to the laboratory outcome.
function applyOutcome({user, id, batch, sr, outcome, at}) {
  let inv = sr?.investigation_id ? db.prepare("SELECT * FROM investigations WHERE id=?").get(sr.investigation_id) : null;
  if (!inv) inv = db.prepare("SELECT * FROM investigations WHERE batch_id=? COLLATE NOCASE AND status NOT IN ('closed','closed_unconfirmed') ORDER BY opened_at DESC").get(batch.id);
  if (inv && !inv.batch_id) db.prepare("UPDATE investigations SET batch_id=? WHERE id=?").run(batch.id, inv.id); // product-level case: laboratory identified the batch
  if (sr) {
    if (!sr.batch_id) db.prepare("UPDATE sample_requests SET batch_id=? WHERE id=?").run(batch.id, sr.id);
    db.prepare("UPDATE sample_requests SET status=? WHERE id=?").run(outcome === "inconclusive" ? "submitted" : "closed", sr.id);
  }
  if (inv) db.prepare("UPDATE investigation_events SET state='done' WHERE investigation_id=? AND kind='sample_request' AND state='pending'").run(inv.id);
  const setStatus = (status, extra = {}) => {
    db.prepare("UPDATE investigations SET status=?, closed_at=?, closure_reason=? WHERE id=?").run(status, extra.closedAt || null, extra.reason || null, inv.id);
    audit(user, "investigation.status_changed", "investigation", inv.id, {from: inv.status, to: status, cause: id});
  };
  if (outcome === "confirmed") {
    if (!inv) inv = db.prepare("SELECT * FROM investigations WHERE id=?").get(ensureInvestigation({batchId: batch.id, productId: batch.productId, title: "Laboratory-confirmed contamination", summary: "A laboratory report confirmed contamination for this batch.", actor: user}).id);
    setStatus("lab_confirmed");
    addInvestigationEvent(inv.id, "Laboratory confirmed contamination", "alert", `${id} · ${user.lab_name}`, "lab", at);
  } else if (outcome === "not_confirmed") {
    if (sr?.flag_id) { db.prepare("UPDATE flags SET status='cleared', cleared_at=?, cleared_reason=? WHERE id=? AND status='open'").run(at, `Laboratory report ${id} did not confirm contamination`, sr.flag_id); audit(user, "flag.cleared", "flag", sr.flag_id, {cause: id}); }
    if (inv) {
      setStatus("closed_unconfirmed", {closedAt: at, reason: `Laboratory report ${id} did not confirm contamination.`});
      addInvestigationEvent(inv.id, "Laboratory result: not confirmed", "done", `${id} · investigation closed. Complaints remain recorded but are not confirmed contamination.`, "lab", at);
    }
  } else if (inv) {
    setStatus("open");
    addInvestigationEvent(inv.id, "Laboratory result inconclusive", "alert", `${id} · a further sample may be requested`, "lab", at);
  }
}
