// Shared HTTP helpers: typed errors, async wrapper, and zod validation that returns field-level messages.
export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
export const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const fields = {};
  for (const i of r.error.issues) fields[i.path.join(".") || "_"] ??= i.message;
  throw new HttpError(422, "Please correct the highlighted fields.", {fields});
}
export const errorHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({error: err.message, ...err.extra});
  if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({error: "A file is larger than the allowed size."});
  if (err?.code?.startsWith?.("LIMIT_")) return res.status(422).json({error: "Too many files or unexpected file field."});
  if (err?.type === "entity.parse.failed") return res.status(400).json({error: "Request body is not valid JSON."});
  if (err?.type === "entity.too.large") return res.status(413).json({error: "Request body is too large."});
  console.error("[error]", req.method, req.originalUrl, err);
  res.status(500).json({error: "Something went wrong on the server. Please try again."});
};
