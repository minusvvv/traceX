import {Threshold, nowIso} from "../db.js";
import {config} from "../config.js";
import {categoryKeys} from "../domain/categories.js";
import {audit} from "../audit.js";
import {HttpError} from "../http.js";

export async function seedThresholds() {
  if (!await Threshold.exists({_id: "global"}))
    await Threshold.create({_id: "global", count: config.defaultThreshold.count, window_days: config.defaultThreshold.windowDays, updated_at: nowIso()});
}
const dto = r => ({scope: r._id, count: r.count, windowDays: r.window_days});
// A category override wins over the global default. Pure helper so callers can load thresholds once and reuse them.
export function pickThreshold(rows, category) {
  const r = rows.find(x => x._id === category) || rows.find(x => x._id === "global") || {_id: "global", count: config.defaultThreshold.count, window_days: config.defaultThreshold.windowDays};
  return dto(r);
}
export const loadThresholds = () => Threshold.find().lean();
export async function thresholdFor(category) { return pickThreshold(await loadThresholds(), category); }
export async function listThresholds() {
  const rows = await Threshold.find().lean();
  return rows.sort((a, b) => (a._id === "global" ? -1 : b._id === "global" ? 1 : a._id.localeCompare(b._id))).map(r => ({...dto(r), updatedAt: r.updated_at}));
}
export async function setThreshold(actor, scope, count, windowDays) {
  if (scope !== "global" && !categoryKeys.includes(scope)) throw new HttpError(422, "Unknown threshold scope.", {fields: {scope: "Use 'global' or a product category"}});
  const before = await Threshold.findById(scope).lean();
  await Threshold.updateOne({_id: scope}, {$set: {count, window_days: windowDays, updated_by: actor.id, updated_at: nowIso()}}, {upsert: true});
  await audit(actor, "threshold.changed", "threshold", scope, {before: before ? {count: before.count, windowDays: before.window_days} : null, after: {count, windowDays}});
}
export async function removeThreshold(actor, scope) {
  if (scope === "global") throw new HttpError(422, "The global threshold cannot be removed.");
  const r = await Threshold.deleteOne({_id: scope});
  if (!r.deletedCount) throw new HttpError(404, "No override exists for that category.");
  await audit(actor, "threshold.removed", "threshold", scope, {});
}
