import {db, nowIso} from "../db.js";
import {config} from "../config.js";
import {categoryKeys} from "../domain/categories.js";
import {audit} from "../audit.js";
import {HttpError} from "../http.js";

export function seedThresholds() {
  if (!db.prepare("SELECT 1 FROM thresholds WHERE scope='global'").get())
    db.prepare("INSERT INTO thresholds(scope,count,window_days,updated_at) VALUES('global',?,?,?)").run(config.defaultThreshold.count, config.defaultThreshold.windowDays, nowIso());
}
// A category override wins over the global default.
export function thresholdFor(category) {
  const r = db.prepare("SELECT * FROM thresholds WHERE scope IN (?, 'global') ORDER BY scope='global'").get(category)
    || {scope: "global", count: config.defaultThreshold.count, window_days: config.defaultThreshold.windowDays};
  return {scope: r.scope, count: r.count, windowDays: r.window_days};
}
export const listThresholds = () => db.prepare("SELECT scope,count,window_days,updated_at,updated_by FROM thresholds ORDER BY scope='global' DESC, scope")
  .all().map(r => ({scope: r.scope, count: r.count, windowDays: r.window_days, updatedAt: r.updated_at}));

export function setThreshold(actor, scope, count, windowDays) {
  if (scope !== "global" && !categoryKeys.includes(scope)) throw new HttpError(422, "Unknown threshold scope.", {fields: {scope: "Use 'global' or a product category"}});
  const before = db.prepare("SELECT count,window_days FROM thresholds WHERE scope=?").get(scope);
  db.prepare(`INSERT INTO thresholds(scope,count,window_days,updated_by,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(scope) DO UPDATE SET count=excluded.count, window_days=excluded.window_days, updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
    .run(scope, count, windowDays, actor.id, nowIso());
  audit(actor, "threshold.changed", "threshold", scope, {before: before ? {count: before.count, windowDays: before.window_days} : null, after: {count, windowDays}});
}
export function removeThreshold(actor, scope) {
  if (scope === "global") throw new HttpError(422, "The global threshold cannot be removed.");
  const r = db.prepare("DELETE FROM thresholds WHERE scope=?").run(scope);
  if (!r.changes) throw new HttpError(404, "No override exists for that category.");
  audit(actor, "threshold.removed", "threshold", scope, {});
}
