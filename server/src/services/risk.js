// Risk assessment for CONFIRMED contamination cases. Weights are demonstration values for FSSAI reviewers to calibrate;
// the output is decision support, not a regulatory determination.
export const RISK_METHOD = {
  version: "demo-1",
  weights: {complaintVolume: 0.3, distributionReach: 0.3, severity: 0.4},
  note: "Demonstration weighting. Calibration and any regulatory decision rest with FSSAI.",
};
const SEVERITY = {minor: 0.4, major: 0.7, critical: 1};
const clamp = x => Math.max(0, Math.min(1, x));
export const levelFor = s => s >= 75 ? "Critical" : s >= 50 ? "High" : s >= 25 ? "Medium" : "Low";

export function computeRisk({complaintCount, distributionNodes, regionsReached, severity}) {
  const w = RISK_METHOD.weights;
  const c = clamp(Math.log2(1 + complaintCount) / Math.log2(21));                   // saturates at ~20 complaints
  const r = clamp(0.5 * (distributionNodes / 15) + 0.5 * (regionsReached / 6));     // saturates at 15 nodes / 6 regions
  const s = SEVERITY[severity] ?? 0;
  const score = Math.round(100 * (w.complaintVolume * c + w.distributionReach * r + w.severity * s));
  return {score, level: levelFor(score), method: RISK_METHOD.version, assessedOn: "confirmed contamination",
    components: [
      {key: "complaintVolume", label: "Complaint volume", input: `${complaintCount} complaint(s)`, factor: +c.toFixed(2), weight: w.complaintVolume},
      {key: "distributionReach", label: "Distribution reach", input: `${distributionNodes} node(s) in ${regionsReached} region(s)`, factor: +r.toFixed(2), weight: w.distributionReach},
      {key: "severity", label: "Confirmed severity", input: severity || "not stated", factor: s, weight: w.severity}],
    note: RISK_METHOD.note};
}
