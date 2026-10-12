import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import {config} from "./config.js";
import {HttpError} from "./http.js";

fs.mkdirSync(config.uploadDir, {recursive: true});

const SIGS = {
  "image/jpeg": b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": b => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": b => b.length > 12 && b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP",
  "application/pdf": b => b.subarray(0, 5).toString() === "%PDF-",
};
const EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf"};
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const REPORT_TYPES = [...IMAGE_TYPES, "application/pdf"];

// multer instance bound to a type allow-list and size limit; files stay in memory until validated.
export const uploader = ({types, maxBytes, maxFiles}) => multer({
  storage: multer.memoryStorage(),
  limits: {fileSize: maxBytes, files: maxFiles, fields: 30, fieldSize: 20_000},
  fileFilter: (_req, file, cb) => types.includes(file.mimetype) ? cb(null, true)
    : cb(new HttpError(422, `“${file.originalname}” is not an allowed file type. Allowed: ${types.map(t => EXT[t].slice(1).toUpperCase()).join(", ")}.`)),
});

// The declared MIME type is not trusted: the file's leading bytes must match it.
export function persistFiles(files = [], {ownerType, ownerId, kind, userId = null}) {
  for (const f of files) if (!SIGS[f.mimetype]?.(f.buffer)) throw new HttpError(422, `“${f.originalname}” does not look like a valid ${EXT[f.mimetype]?.slice(1).toUpperCase() || "file"}.`);
  const saved = []; // validate everything first so a bad later file cannot leave earlier files orphaned on disk
  for (const f of files) {
    const id = crypto.randomUUID(), stored = id + EXT[f.mimetype];
    fs.writeFileSync(path.join(config.uploadDir, stored), f.buffer, {flag: "wx"}); // never overwrites
    saved.push({_id: id, owner_type: ownerType, owner_id: ownerId, kind, original_name: path.basename(f.originalname).slice(0, 120), mime: f.mimetype, size: f.size,
      sha256: crypto.createHash("sha256").update(f.buffer).digest("hex"), stored_name: stored, uploaded_by: userId, uploaded_at: new Date().toISOString()});
  }
  return saved;
}
export const filePath = rec => path.join(config.uploadDir, rec.stored_name);
export const attachmentDto = a => ({id: String(a._id ?? a.id), kind: a.kind, name: a.original_name, mime: a.mime, size: a.size, sha256: a.sha256, uploadedAt: a.uploaded_at});
// Remove files that were written when the surrounding DB transaction later fails.
export const discardFiles = recs => recs.forEach(r => fs.rmSync(path.join(config.uploadDir, r.stored_name), {force: true}));
