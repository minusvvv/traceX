import PDFDocument from "pdfkit";

const D = d => d ? new Date(d).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—";

export function renderReportPdf(report, res) {
  const c = report.content, doc = new PDFDocument({margin: 48, size: "A4", info: {Title: `TraceX investigation report ${report.id}`, Author: "TraceX"}});
  doc.pipe(res);
  const H = t => { doc.moveDown(.8).font("Helvetica-Bold").fontSize(12).fillColor("#274245").text(t).moveDown(.2); doc.font("Helvetica").fontSize(9.5).fillColor("#203437"); };
  const P = t => doc.font("Helvetica").fontSize(9.5).fillColor("#203437").text(t);
  const KV = (k, v) => doc.font("Helvetica-Bold").fontSize(9.5).text(k + ": ", {continued: true}).font("Helvetica").text(String(v ?? "—"));

  doc.font("Helvetica-Bold").fontSize(18).fillColor("#274245").text("TraceX Investigation Report");
  doc.font("Helvetica").fontSize(10).fillColor("#718080").text(`${report.id} · version ${report.version} · generated ${D(report.generatedAt)}`);
  if (c.demonstrationData) doc.moveDown(.4).font("Helvetica-Bold").fillColor("#B85450").text("DEMONSTRATION DATA: these are not real records, laboratory results or regulatory decisions.");
  const sim = report.submissions.some(s => s.simulated);
  if (sim) doc.font("Helvetica-Bold").fillColor("#B85450").text(`Submission status: ${report.status.toUpperCase()} (SIMULATED: not transmitted to FSSAI).`);
  doc.moveDown(.4).font("Helvetica-Oblique").fontSize(9).fillColor("#203437").text(c.notice);

  H("Investigation"); KV("ID", c.investigation.id); KV("Title", c.investigation.title); KV("Opened", D(c.investigation.openedAt)); KV("Stage requiring investigation", c.investigation.stageRequiringInvestigation);
  H("Product and batch"); KV("Product", `${c.product.name} (${c.product.category})`); KV("Brand", c.product.brand); KV("Manufacturer", c.product.manufacturer);
  KV("Batch", c.batch.id); KV("Lot", c.batch.lot); KV("Quantity", c.batch.quantity); KV("Manufactured", c.batch.manufacturedOn); KV("Expiry / best before", c.batch.expiresOn || "Not applicable"); KV("Facility", c.batch.facility);
  H("Consumer complaints (unverified)"); KV("Total", c.complaints.total); KV("Period", `${D(c.complaints.first)} to ${D(c.complaints.latest)}`);
  KV("By region", c.complaints.byRegion.map(r => `${r.region} ${r.count}`).join(", ") || "—");
  c.complaints.excerpts.slice(0, 6).forEach(x => P(`• ${x.id} (${(x.date || "").slice(0, 10)}, ${x.region || "region n/a"}): ${x.text}`));
  P(c.complaints.caveat);
  H("Laboratory verification"); const l = c.laboratory;
  KV("Report", `${l.reportId} · ${l.laboratory}`); KV("Accreditation reference", l.accreditationRef); KV("Submitted", D(l.submittedAt));
  KV("Outcome", `${l.outcome.replace("_", " ")}${l.contaminationType ? " · " + l.contaminationType : ""}${l.severity ? " · severity " + l.severity : ""}`);
  l.results.forEach(r => P(`• ${r.label}: ${r.value} ${r.unit}`)); if (l.notes) KV("Notes", l.notes);
  H("Traceability"); KV("Supply-chain data source", `${c.traceability.provider.name}${c.traceability.provider.mock ? " (simulated provider)" : ""}`);
  P("Backward (batch → manufacturer → upstream):"); c.traceability.backward.forEach(n => P(`  • ${n.stage}: ${n.party}${n.region ? ", " + n.region : ""} (${(n.at || "").slice(0, 10)})`));
  P("Forward (destinations that received the batch):"); c.traceability.forward.forEach(n => P(`  • ${n.stage}: ${n.party}${n.region ? ", " + n.region : ""} (${(n.at || "").slice(0, 10)})`));
  c.traceability.warnings.forEach(w => P(`⚠ ${w}`));
  H("Hotspot analysis"); c.hotspotAnalysis.forEach(h => P(`• ${h.region}: ${h.reports} complaint(s), ${h.distributionNodes} distribution node(s)`));
  H("Risk assessment"); KV("Score", `${c.riskAssessment.score}/100 (${c.riskAssessment.level})`);
  c.riskAssessment.components.forEach(x => P(`• ${x.label}: ${x.input}, factor ${x.factor} × weight ${x.weight}`)); P(c.riskAssessment.note);
  H("Regulatory status"); KV("Decision", c.regulatoryStatus.decision.replace(/_/g, " ")); if (c.regulatoryStatus.authorityRef) KV("Authority reference", c.regulatoryStatus.authorityRef); if (c.regulatoryStatus.note) P(c.regulatoryStatus.note);
  doc.moveDown(1).fontSize(8).fillColor("#718080").text(`Content SHA-256: ${report.sha256}`);
  doc.end();
}
