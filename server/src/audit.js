import crypto from "node:crypto";
import {Audit} from "./db.js";

const sha = s => crypto.createHash("sha256").update(s).digest("hex");
const material = (prev, r) => prev + JSON.stringify([r.at, r.actor_id, r.actor_role, r.action, r.entity_type, r.entity_id, r.details]);
let chain = Promise.resolve(); // serialises appends inside this process; the unique `seq` index catches races between processes

// Append-only, hash-chained audit trail. `actor` is req.user, or null for public/system actions.
export function audit(actor, action, entityType, entityId, details = {}) {
  const run = async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const last = await Audit.findOne().sort({seq: -1}).lean();
      const prev = last?.hash || "GENESIS", seq = (last?.seq || 0) + 1;
      const row = {at: new Date().toISOString(), actor_id: actor?.id ?? null, actor_email: actor?.email ?? null, actor_role: actor?.role ?? "system",
        action, entity_type: entityType, entity_id: entityId == null ? null : String(entityId), details: JSON.stringify(details)};
      try { await Audit.create({...row, seq, prev_hash: prev, hash: sha(material(prev, row))}); return; }
      catch (e) { if (e.code !== 11000) throw e; }
    }
    throw new Error("audit log append failed after retries");
  };
  const p = chain.then(run); chain = p.catch(() => {});
  return p;
}

export async function verifyAuditChain() {
  let prev = "GENESIS", n = 0;
  for await (const r of Audit.find().sort({seq: 1}).lean().cursor()) {
    if (r.prev_hash !== prev || sha(material(prev, r)) !== r.hash) return {ok: false, brokenAt: r.seq, checked: n};
    prev = r.hash; n++;
  }
  return {ok: true, checked: n};
}

export async function listAudit({entityType, entityId, action, limit = 100} = {}) {
  const q = {};
  if (entityType) q.entity_type = entityType;
  if (entityId) q.entity_id = entityId;
  if (action) q.action = {$regex: "^" + String(action).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")};
  const rows = await Audit.find(q).sort({seq: -1}).limit(Math.min(limit, 500)).lean();
  return rows.map(r => ({id: r.seq, at: r.at, actor_email: r.actor_email, actor_role: r.actor_role, action: r.action, entity_type: r.entity_type, entity_id: r.entity_id, details: JSON.parse(r.details)}));
}
