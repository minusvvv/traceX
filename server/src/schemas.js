import {z} from "zod";

const emptyToUndef = v => (v === "" || v === null ? undefined : v);
const opt = s => z.preprocess(emptyToUndef, s.optional());
const num = (min, max) => z.preprocess(v => (v === "" || v == null ? undefined : Number(v)), z.number().finite().min(min).max(max).optional());
const iso = z.string().refine(v => !Number.isNaN(Date.parse(v)), "Must be a valid date/time");

export const loginSchema = z.object({email: z.string().email().max(200), password: z.string().min(1).max(200)});
export const consumerRegisterSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(100),
  email: z.string().trim().email().max(200).transform(v => v.toLowerCase()),
  password: z.string().min(12, "Use at least 12 characters").max(200),
});

export const complaintSchema = z.object({
  identifier: opt(z.string().trim().max(64).regex(/^[\w\-./ ]+$/, "Use letters, numbers, dashes, dots or slashes only")),
  identifierSource: opt(z.enum(["manual", "scan", "image"])),
  productText: opt(z.string().trim().max(120)),
  description: z.string({required_error: "Describe the problem"}).trim().min(10, "Please describe the problem in at least 10 characters").max(2000, "Please keep the description under 2000 characters"),
  lang: opt(z.enum(["en", "hi"])),
  regionKey: opt(z.string().max(40)),
  lat: num(-90, 90), lng: num(-180, 180),
  contact: opt(z.string().trim().max(120).refine(v => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) || /^\+?[0-9 ()-]{7,18}$/.test(v), "Enter a valid email address or phone number")),
}).refine(d => (d.lat == null) === (d.lng == null), {path: ["lat"], message: "Latitude and longitude must be given together"});

export const labReportSchema = z.object({
  sampleRequestId: opt(z.string().max(20)),
  batchId: z.string({required_error: "Batch identifier is required"}).trim().min(3, "Batch identifier is required").max(64),
  accreditationRef: z.string({required_error: "Accreditation reference is required"}).trim().min(3, "Accreditation reference is required").max(60),
  outcome: z.enum(["confirmed", "not_confirmed", "inconclusive"], {errorMap: () => ({message: "Choose an outcome"})}),
  contaminationType: opt(z.string().max(80)),
  severity: opt(z.enum(["minor", "major", "critical"])),
  results: z.preprocess(v => { if (typeof v === "string") { try { return JSON.parse(v); } catch { return null; } } return v; }, z.record(z.union([z.string(), z.number()])).nullable().transform(v => v ?? {})),
  notes: opt(z.string().trim().max(2000)),
  supersedes: opt(z.string().max(20)),
  correctionReason: opt(z.string().trim().max(1000)),
});

export const thresholdSchema = z.object({
  count: z.coerce.number().int("Whole number").min(1, "At least 1").max(10000),
  windowDays: z.coerce.number().int("Whole number").min(1, "At least 1 day").max(365, "At most 365 days"),
});
export const userCreateSchema = z.object({
  email: z.string().email().max(200), name: z.string().trim().min(2).max(100),
  role: z.enum(["lab", "reviewer", "admin", "provider"]),
  password: z.string().min(12, "Use at least 12 characters").max(200),
  labName: opt(z.string().trim().max(120)), accreditationRef: opt(z.string().trim().max(60)),
}).superRefine((u, c) => {
  if (u.role === "lab") { if (!u.labName) c.addIssue({path: ["labName"], code: "custom", message: "Required for laboratory accounts"}); if (!u.accreditationRef) c.addIssue({path: ["accreditationRef"], code: "custom", message: "Required for laboratory accounts"}); }
});
export const userPatchSchema = z.object({active: z.boolean().optional(), role: z.enum(["lab", "reviewer", "admin", "provider"]).optional(), password: z.string().min(12).max(200).optional(),
  labName: z.string().trim().max(120).optional(), accreditationRef: z.string().trim().max(60).optional()});
export const decisionSchema = z.object({
  decision: z.enum(["no_action", "advisory_issued", "recall_ordered", "recall_closed"], {errorMap: () => ({message: "Choose the decision FSSAI made"})}),
  authorityRef: z.string().trim().min(3, "Enter the FSSAI reference for this decision").max(80),
  decidedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"), notes: opt(z.string().trim().max(1000)),
});
export const closeSchema = z.object({reason: z.string().trim().min(10, "Give a reason (at least 10 characters)").max(1000)});
export const sampleSchema = z.object({assignedLab: opt(z.string().trim().max(120)), reason: opt(z.string().trim().max(500))});
export const providerRecordsSchema = z.object({records: z.array(z.object({
  stage: z.string().min(1).max(60), party: z.string().min(1).max(160), role: opt(z.string().max(40)),
  lat: num(-90, 90), lng: num(-180, 180), region: opt(z.string().max(60)), at: iso,
  readings: z.record(z.union([z.string(), z.number()])).optional(), notes: opt(z.string().max(500)), qualityScore: num(0, 100),
})).min(1).max(50)});
export const simulateSchema = z.object({simulate: z.enum(["fail", "flaky", "unavailable", "partial", "ok"]).optional()});
