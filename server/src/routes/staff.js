import fs from "node:fs";
import {Router} from "express";
import {db} from "../db.js";
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
import {closeSchema, decisionSchema, labReportSchema, providerRecordsSchema, sampleSchema, simulateSchema} from "../schemas.js";
import {uploader, REPORT_TYPES, filePath} from "../uploads.js";
import {listThresholds} from "../services/thresholds.js";

const STAFF = ["reviewer", "admin"], LAB_VIEW = ["lab", ...STAFF];
const MB = 1024 * 1024;
const labUpload = uploader({types: REPORT_TYPES, maxBytes: 10 * MB, maxFiles: 5}).fields([{name: "report", maxCount: 1}, {name: "supporting", maxCount: 4}]);
const simulate = req => parse(simulateSchema, {simulate: req.body?.simulate || req.get("X-Simulate") || undefined}).simulate;
const r = Router();

// ---- batches (internal view) ----
r.get("/batches", requireRole(...LAB_VIEW), (req, res) => res.json(loadBatches({category: categoryKeys.includes(req.query.category) ? req.query.category : null})));
r.get("/batches/:id", requireRole(...LAB_VIEW), (req, res) => { const b = loadBatch(req.params.id); if (!b) throw new HttpError(404, "Batch not found"); res.json(b); });
r.get("/batches/:id/timeline", requireRole(...LAB_VIEW), (req, res) => { const b = loadBatch(req.params.id); if (!b) throw new HttpError(404, "Batch not found"); res.json(b.route); });
r.get("/batches/:id/lab-reports", requireRole(...LAB_VIEW), (req, res) => res.json(listReports(req.user, {batchId: req.params.id})));

// ---- complaints, prioritisation, dashboard, analytics (reviewers/administrators) ----
r.get("/complaints", requireRole(...STAFF), (req, res) => res.json(listComplaints({batchId: req.query.batch, productId: req.query.product, category: req.query.category, status: req.query.status, from: req.query.from, to: req.query.to})));
r.get("/prioritization", requireRole(...STAFF), (_q, res) => res.json({flagged: rankFlagged(), thresholds: listThresholds()}));
r.get("/dashboard", requireRole(...STAFF), (_q, res) => res.json(dashboardSummary()));
const filters = q => ({category: categoryKeys.includes(q.category) ? q.category : undefined, status: ["safe", "review", "suspicious", "critical"].includes(q.status) ? q.status : undefined,
  from: q.from && !Number.isNaN(Date.parse(q.from)) ? new Date(q.from).toISOString() : undefined, to: q.to && !Number.isNaN(Date.parse(q.to)) ? new Date(q.to + (q.to.length <= 10 ? "T23:59:59Z" : "")).toISOString() : undefined,
  batchId: q.batch || undefined});
r.get("/analytics", requireRole(...STAFF), (req, res) => res.json(analytics(filters(req.query))));
r.get("/analytics/hotspots", requireRole(...STAFF), (req, res) => res.json(internalHotspots(filters(req.query))));

// ---- laboratory ----
r.get("/lab/sample-requests", requireRole(...LAB_VIEW), (req, res) => res.json(listSampleRequests(req.user, {status: req.query.status})));
r.get("/lab/sample-requests/:id", requireRole(...LAB_VIEW), (req, res) => res.json(getSampleRequest(req.user, req.params.id)));
r.get("/lab/reports", requireRole(...LAB_VIEW), (req, res) => res.json(listReports(req.user)));
r.get("/lab/reports/:id", requireRole(...LAB_VIEW), (req, res) => {
  const d = reportDto(req.params.id);
  if (!d || (req.user.role === "lab" && d.lab.toLowerCase() !== (req.user.lab_name || "").toLowerCase())) throw new HttpError(404, "Report not found.");
  res.json(d);
});
r.post("/lab/reports", requireRole("lab"), labUpload, (req, res) => res.status(201).json(submitLabReport(req.user, parse(labReportSchema, req.body), req.files || {})));

// ---- investigations & reports ----
r.get("/investigations", requireRole(...STAFF), (req, res) => res.json(inv.listInvestigations({status: req.query.status, category: req.query.category, batch: req.query.batch})));
r.get("/investigations/:id", requireRole(...STAFF), (req, res) => res.json(inv.getInvestigation(req.params.id)));
r.post("/investigations/:id/traceability", requireRole(...STAFF), ah(async (req, res) => res.json(await inv.runTraceability(req.user, req.params.id, {simulate: simulate(req)}))));
r.post("/investigations/:id/report", requireRole(...STAFF), (req, res) => { const out = inv.generateReport(req.user, req.params.id); res.status(out.unchanged ? 200 : 201).json(out); });
r.post("/investigations/:id/close", requireRole(...STAFF), (req, res) => res.json(inv.closeInvestigation(req.user, req.params.id, parse(closeSchema, req.body).reason)));
r.post("/investigations/:id/decision", requireRole("reviewer"), (req, res) => res.status(201).json(inv.recordDecision(req.user, req.params.id, parse(decisionSchema, req.body))));
r.post("/investigations/:id/sample-request", requireRole(...STAFF), (req, res) => res.status(201).json(inv.requestSample(req.user, req.params.id, parse(sampleSchema, req.body || {}))));

r.get("/reports/:id", requireRole(...STAFF), (req, res) => res.json(inv.getReport(req.params.id)));
r.get("/reports/:id/export", requireRole(...STAFF), (req, res) => {
  const rep = inv.getReport(req.params.id), format = req.query.format === "pdf" ? "pdf" : "json";
  audit(req.user, "report.exported", "report", rep.id, {format});
  res.setHeader("Content-Disposition", `attachment; filename="${rep.id}-v${rep.version}.${format}"`);
  if (format === "pdf") { res.type("application/pdf"); return renderReportPdf(rep, res); }
  res.type("application/json").send(JSON.stringify({id: rep.id, version: rep.version, generatedAt: rep.generatedAt, status: rep.status, submissions: rep.submissions, sha256: rep.sha256, report: rep.content}, null, 2));
});
r.post("/reports/:id/submit", requireRole(...STAFF), ah(async (req, res) => res.json(await inv.submitReport(req.user, req.params.id, {simulate: simulate(req)}))));
r.post("/reports/:id/acknowledge", requireRole(...STAFF), (req, res) => res.json(inv.simulateAcknowledgement(req.user, req.params.id)));

// ---- attachments (never public) ----
r.get("/attachments/:id", requireRole(...LAB_VIEW), (req, res) => {
  const a = db.prepare("SELECT * FROM attachments WHERE id=?").get(req.params.id);
  if (!a || !fs.existsSync(filePath(a))) throw new HttpError(404, "File not found.");
  if (req.user.role === "lab") {
    const ok = a.owner_type === "lab_report"
      ? db.prepare("SELECT 1 FROM lab_reports WHERE id=? AND lab_name=? COLLATE NOCASE").get(a.owner_id, req.user.lab_name || "")
      : db.prepare(`SELECT 1 FROM sample_request_complaints l JOIN sample_requests s ON s.id=l.sample_request_id WHERE l.complaint_id=? AND (s.assigned_lab IS NULL OR s.assigned_lab=? COLLATE NOCASE)`).get(a.owner_id, req.user.lab_name || "");
    if (!ok) throw new HttpError(404, "File not found.");
  }
  audit(req.user, "attachment.downloaded", a.owner_type, a.owner_id, {attachment: a.id});
  res.setHeader("Content-Disposition", `attachment; filename="${a.original_name.replace(/[^\w.\- ]/g, "_")}"`);
  res.type(a.mime).sendFile(filePath(a));
});

// ---- external supply-chain data provider ----
r.post("/provider/supply-chain/:batchId/records", requireRole("provider", "admin"), (req, res) => res.status(201).json(inv.addProviderRecords(req.user, req.params.batchId, parse(providerRecordsSchema, req.body).records)));
export default r;
