import {Router} from "express";
import {db, nowIso} from "../db.js";
import {config} from "../config.js";
import {ah, HttpError, parse} from "../http.js";
import {hashPassword, publicUser, requireRole} from "../auth.js";
import {audit, listAudit, verifyAuditChain} from "../audit.js";
import {thresholdSchema, userCreateSchema, userPatchSchema} from "../schemas.js";
import {listThresholds, setThreshold, removeThreshold} from "../services/thresholds.js";
import {providerStatus} from "../providers/supplyChain/index.js";
import {adapterStatus} from "../providers/fssai/index.js";

const r = Router();
r.get("/thresholds", requireRole("admin", "reviewer"), (_q, res) => res.json(listThresholds()));
r.put("/thresholds/:scope", requireRole("admin"), (req, res) => { const t = parse(thresholdSchema, req.body); setThreshold(req.user, req.params.scope, t.count, t.windowDays); res.json(listThresholds()); });
r.delete("/thresholds/:scope", requireRole("admin"), (req, res) => { removeThreshold(req.user, req.params.scope); res.json(listThresholds()); });

r.get("/users", requireRole("admin"), (_q, res) => res.json(db.prepare("SELECT * FROM users ORDER BY id").all().map(u => ({...publicUser(u), active: !!u.active, createdAt: u.created_at}))));
r.post("/users", requireRole("admin"), ah(async (req, res) => {
  const u = parse(userCreateSchema, req.body);
  if (db.prepare("SELECT 1 FROM users WHERE email=?").get(u.email)) throw new HttpError(409, "A user with this email already exists.", {fields: {email: "Already in use"}});
  const id = db.prepare("INSERT INTO users(email,name,role,password_hash,lab_name,accreditation_ref,created_at) VALUES(?,?,?,?,?,?,?)")
    .run(u.email, u.name, u.role, await hashPassword(u.password), u.labName || null, u.accreditationRef || null, nowIso()).lastInsertRowid;
  audit(req.user, "user.created", "user", id, {email: u.email, role: u.role});
  res.status(201).json(publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(id)));
}));
r.patch("/users/:id", requireRole("admin"), ah(async (req, res) => {
  const p = parse(userPatchSchema, req.body), id = Number(req.params.id);
  const u = db.prepare("SELECT * FROM users WHERE id=?").get(id);
  if (!u) throw new HttpError(404, "User not found.");
  if (id === req.user.id && (p.active === false || (p.role && p.role !== "admin"))) throw new HttpError(409, "You cannot deactivate or demote your own account.");
  const next = {role: p.role ?? u.role, active: p.active === undefined ? u.active : p.active ? 1 : 0, lab_name: p.labName ?? u.lab_name, accreditation_ref: p.accreditationRef ?? u.accreditation_ref,
    password_hash: p.password ? await hashPassword(p.password) : u.password_hash};
  if (next.role === "lab" && (!next.lab_name || !next.accreditation_ref)) throw new HttpError(422, "Laboratory accounts need a laboratory name and accreditation reference.");
  db.prepare("UPDATE users SET role=@role, active=@active, lab_name=@lab_name, accreditation_ref=@accreditation_ref, password_hash=@password_hash WHERE id=@id").run({...next, id});
  audit(req.user, "user.updated", "user", id, {role: next.role, active: !!next.active, passwordChanged: !!p.password});
  res.json(publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(id)));
}));

r.get("/integrations", requireRole("admin"), (_q, res) => res.json({
  supplyChain: providerStatus(), fssai: adapterStatus(),
  ocr: {available: false, note: "No OCR service is integrated. Consumers use manual entry; a browser barcode reader is used where the browser supports it."},
  notifications: {configured: false, note: "No email/SMS provider is configured. Sample requests are shown to consumers on their complaint status page only."},
  authentication: {mode: "local", note: "Local accounts (bcrypt) with a signed, httpOnly session cookie. No external identity provider is configured."},
  database: {engine: "SQLite", file: config.dbPath === ":memory:" ? "in-memory" : "server data directory"},
  simulationEnabled: config.allowSimulation, https: {enforced: config.forceHttps, secureCookies: config.cookieSecure},
}));
r.get("/audit", requireRole("admin"), (req, res) => res.json({entries: listAudit({entityType: req.query.entityType, entityId: req.query.entityId, action: req.query.action, limit: Number(req.query.limit) || 100}), chain: verifyAuditChain()}));
export default r;
