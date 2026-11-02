import mongoose from "mongoose";
import {Router} from "express";
import {User, nowIso, dbName} from "../db.js";
import {config} from "../config.js";
import {ah, HttpError, parse} from "../http.js";
import {hashPassword, publicUser, requireRole} from "../auth.js";
import {audit, listAudit, verifyAuditChain} from "../audit.js";
import {thresholdSchema, userCreateSchema, userPatchSchema} from "../schemas.js";
import {listThresholds, setThreshold, removeThreshold} from "../services/thresholds.js";
import {providerStatus} from "../providers/supplyChain/index.js";
import {adapterStatus} from "../providers/fssai/index.js";
import {generateScenario, clearSyntheticScenarios} from "../services/synthetic-generator.js";

const r = Router();
r.get("/thresholds", requireRole("admin", "reviewer"), ah(async (_q, res) => res.json(await listThresholds())));
r.put("/thresholds/:scope", requireRole("admin"), ah(async (req, res) => { const t = parse(thresholdSchema, req.body); await setThreshold(req.user, req.params.scope, t.count, t.windowDays); res.json(await listThresholds()); }));
r.delete("/thresholds/:scope", requireRole("admin"), ah(async (req, res) => { await removeThreshold(req.user, req.params.scope); res.json(await listThresholds()); }));

r.get("/users", requireRole("admin"), ah(async (_q, res) => res.json((await User.find().sort({_id: 1}).lean()).map(u => ({...publicUser(u), active: !!u.active, createdAt: u.created_at})))));
r.post("/users", requireRole("admin"), ah(async (req, res) => {
  const u = parse(userCreateSchema, req.body);
  if (await User.exists({email: u.email.toLowerCase()})) throw new HttpError(409, "A user with this email already exists.", {fields: {email: "Already in use"}});
  const doc = await User.create({email: u.email, name: u.name, role: u.role, password_hash: await hashPassword(u.password), lab_name: u.labName || undefined, accreditation_ref: u.accreditationRef || undefined, created_at: nowIso()});
  await audit(req.user, "user.created", "user", String(doc._id), {email: u.email, role: u.role});
  res.status(201).json(publicUser(doc.toObject()));
}));
r.patch("/users/:id", requireRole("admin"), ah(async (req, res) => {
  const p = parse(userPatchSchema, req.body), id = req.params.id;
  const u = mongoose.isValidObjectId(id) ? await User.findById(id).lean() : null;
  if (!u) throw new HttpError(404, "User not found.");
  if (id === req.user.id && (p.active === false || (p.role && p.role !== "admin"))) throw new HttpError(409, "You cannot deactivate or demote your own account.");
  const next = {role: p.role ?? u.role, active: p.active === undefined ? u.active : p.active, lab_name: p.labName ?? u.lab_name, accreditation_ref: p.accreditationRef ?? u.accreditation_ref, password_hash: p.password ? await hashPassword(p.password) : u.password_hash};
  if (next.role === "lab" && (!next.lab_name || !next.accreditation_ref)) throw new HttpError(422, "Laboratory accounts need a laboratory name and accreditation reference.");
  await User.updateOne({_id: id}, {$set: next});
  await audit(req.user, "user.updated", "user", id, {role: next.role, active: !!next.active, passwordChanged: !!p.password});
  res.json(publicUser(await User.findById(id).lean()));
}));

r.post("/scenarios/generate", requireRole("admin"), ah(async (req, res) => {
  const scenario = req.body?.scenario || "dairy_coldchain";
  const result = await generateScenario(scenario);
  await audit(req.user, "scenario.generated", "batch", result.batchId, {scenario, complaints: result.complaintsGenerated});
  res.status(201).json(result);
}));

r.delete("/scenarios", requireRole("admin"), ah(async (_q, res) => {
  const result = await clearSyntheticScenarios();
  await audit(req.user, "scenarios.cleared", "scenario", "all", result);
  res.json(result);
}));

r.get("/integrations", requireRole("admin"), ah(async (_q, res) => res.json({
  supplyChain: await providerStatus(), fssai: adapterStatus(),
  ocr: {available: false, note: "No server-side OCR service is integrated. Client-side Tesseract.js is enabled in the browser."},
  openFoodFacts: {available: true, note: "Open Food Facts API connected for universal barcode/GTIN discovery."},
  reverseGeocode: {available: true, engine: "OpenStreetMap Nominatim", note: "Nominatim connected for reverse geocoding GPS coordinates to districts/pincodes."},
  notifications: {configured: false, note: "Sample requests are shown to consumers on their complaint status page."},
  authentication: {mode: "local", note: "Local accounts (bcrypt) with a signed, httpOnly session cookie."},
  database: {engine: "MongoDB", file: `database “${dbName()}”${config.mongoTransactions ? ", transactions on" : ", transactions off (standalone)"}`},
  simulationEnabled: config.allowSimulation, https: {enforced: config.forceHttps, secureCookies: config.cookieSecure},
})));
r.get("/audit", requireRole("admin"), ah(async (req, res) => res.json({entries: await listAudit({entityType: req.query.entityType, entityId: req.query.entityId, action: req.query.action, limit: Number(req.query.limit) || 100}), chain: await verifyAuditChain()})));
export default r;
