import {Router} from "express";
import {db, nowIso} from "../db.js";
import {ah, HttpError, parse} from "../http.js";
import {loginSchema} from "../schemas.js";
import {checkPassword, DUMMY_HASH, issueSession, clearSession, publicUser, requireRole} from "../auth.js";
import {audit} from "../audit.js";
import {limiter} from "./public.js";

const r = Router();
r.post("/login", limiter(15 * 60e3, 20, "Too many sign-in attempts. Try again in a few minutes."), ah(async (req, res) => {
  const {email, password} = parse(loginSchema, req.body);
  const u = db.prepare("SELECT * FROM users WHERE email=?").get(email);
  const generic = new HttpError(401, "Email or password is incorrect.");
  if (u?.locked_until && u.locked_until > nowIso()) throw new HttpError(423, "This account is temporarily locked after repeated failed sign-ins. Try again later.");
  const ok = await checkPassword(password, u?.password_hash || DUMMY_HASH);
  if (!u || !u.active || !ok) {
    if (u) {
      const n = u.failed_logins + 1;
      db.prepare("UPDATE users SET failed_logins=?, locked_until=? WHERE id=?").run(n >= 5 ? 0 : n, n >= 5 ? new Date(Date.now() + 15 * 60e3).toISOString() : null, u.id);
      audit(null, n >= 5 ? "auth.locked" : "auth.failed", "user", u.id, {});
    }
    throw generic;
  }
  db.prepare("UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=?").run(u.id);
  issueSession(res, u);
  audit(u, "auth.login", "user", u.id, {});
  res.json({user: publicUser(u)});
}));
r.post("/logout", (req, res) => { if (req.user) audit(req.user, "auth.logout", "user", req.user.id, {}); clearSession(res); res.json({ok: true}); });
r.get("/me", requireRole(), (req, res) => res.json({user: publicUser(req.user)}));
export default r;
