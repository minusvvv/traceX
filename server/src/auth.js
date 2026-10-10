import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import {config} from "./config.js";
import {db} from "./db.js";
import {HttpError} from "./http.js";

export const COOKIE = "tx_session";
export const ROLES = ["lab", "reviewer", "admin", "provider"];
export const hashPassword = pw => bcrypt.hash(pw, 12);
export const checkPassword = (pw, hash) => bcrypt.compare(pw, hash);
// Used so unknown-email logins cost the same as wrong-password logins (no user enumeration by timing).
export const DUMMY_HASH = bcrypt.hashSync("tracex-dummy-password", 12);

export const publicUser = u => u && ({id: u.id, email: u.email, name: u.name, role: u.role, labName: u.lab_name || null, accreditationRef: u.accreditation_ref || null});

export const issueSession = (res, user) => {
  const token = jwt.sign({sub: user.id, role: user.role}, config.jwtSecret, {expiresIn: `${config.sessionHours}h`});
  res.cookie(COOKIE, token, {httpOnly: true, sameSite: "lax", secure: config.cookieSecure, maxAge: config.sessionHours * 3600e3, path: "/"});
};
export const clearSession = res => res.clearCookie(COOKIE, {httpOnly: true, sameSite: "lax", secure: config.cookieSecure, path: "/"});

// Attaches req.user when a valid session cookie is present. Role/active state is always re-read from the database,
// so deactivating an account or changing its role takes effect immediately.
export function authenticate(req, _res, next) {
  const token = req.cookies?.[COOKIE];
  if (token) {
    try {
      const {sub} = jwt.verify(token, config.jwtSecret);
      const u = db.prepare("SELECT * FROM users WHERE id=? AND active=1").get(sub);
      if (u) req.user = u;
    } catch { /* invalid or expired token: treated as anonymous */ }
  }
  next();
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, "Please sign in to continue."));
  if (roles.length && !roles.includes(req.user.role)) return next(new HttpError(403, "Your role is not permitted to perform this action."));
  next();
};

// State-changing requests must carry a custom header. Browsers cannot add it to cross-site form posts,
// and a cross-origin fetch with it triggers a CORS pre-flight, which only allow-listed origins pass.
export function requireClientHeader(req, _res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("X-TraceX-Client") !== "web") return next(new HttpError(403, "Missing client header."));
  next();
}
