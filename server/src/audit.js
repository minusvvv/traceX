import crypto from "node:crypto";
import {db, nowIso} from "./db.js";

const sha = s => crypto.createHash("sha256").update(s).digest("hex");
const material = (prev, r) => prev + JSON.stringify([r.at, r.actor_id, r.actor_role, r.action, r.entity_type, r.entity_id, r.details]);

// Append-only, hash-chained audit trail. `actor` is req.user, or null for public/system actions.
export function audit(actor, action, entityType, entityId, details = {}) {
  const last = db.prepare("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1").get();
  const prev = last?.hash || "GENESIS";
  const row = {at: nowIso(), actor_id: actor?.id ?? null, actor_email: actor?.email ?? null, actor_role: actor?.role ?? "system",
    action, entity_type: entityType, entity_id: entityId == null ? null : String(entityId), details: JSON.stringify(details)};
  const hash = sha(material(prev, row));
  db.prepare(`INSERT INTO audit_log(at,actor_id,actor_email,actor_role,action,entity_type,entity_id,details,prev_hash,hash)
    VALUES(@at,@actor_id,@actor_email,@actor_role,@action,@entity_type,@entity_id,@details,@prev,@hash)`).run({...row, prev, hash});
}

export function verifyAuditChain() {
  let prev = "GENESIS", n = 0;
  for (const r of db.prepare("SELECT * FROM audit_log ORDER BY id").iterate()) {
    if (r.prev_hash !== prev || sha(material(prev, r)) !== r.hash) return {ok: false, brokenAt: r.id, checked: n};
    prev = r.hash; n++;
  }
  return {ok: true, checked: n};
}

export const listAudit = ({entityType, entityId, action, limit = 100} = {}) => {
  const w = [], p = [];
  if (entityType) { w.push("entity_type=?"); p.push(entityType); }
  if (entityId) { w.push("entity_id=?"); p.push(entityId); }
  if (action) { w.push("action LIKE ?"); p.push(action + "%"); }
  return db.prepare(`SELECT id,at,actor_email,actor_role,action,entity_type,entity_id,details FROM audit_log ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`)
    .all(...p, Math.min(limit, 500)).map(r => ({...r, details: JSON.parse(r.details)}));
};
