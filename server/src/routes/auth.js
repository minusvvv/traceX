import {Router} from "express";
import {User, nowIso} from "../db.js";
import {ah, HttpError, parse} from "../http.js";
import {loginSchema, consumerRegisterSchema} from "../schemas.js";
import {checkPassword, DUMMY_HASH, hashPassword, issueSession, clearSession, publicUser, requireRole} from "../auth.js";
import {audit} from "../audit.js";
import {limiter} from "./public.js";

const r = Router(), actorOf = u => ({id: String(u._id), email: u.email, role: u.role});
const signIn = consumerOnly => ah(async (req, res) => {
  const {email, password} = parse(loginSchema, req.body);
  const u = await User.findOne({email: email.toLowerCase()}).lean();
  const generic = new HttpError(401, "Email or password is incorrect.");
  if (u?.locked_until && u.locked_until > nowIso()) throw new HttpError(423, "This account is temporarily locked after repeated failed sign-ins. Try again later.");
  const ok = await checkPassword(password, u?.password_hash || DUMMY_HASH);
  if (!u || !u.active || !ok) {
    if (u) {
      const n = (u.failed_logins || 0) + 1, lock = n >= 5;
      await User.updateOne({_id: u._id}, {$set: {failed_logins: lock ? 0 : n, ...(lock && {locked_until: new Date(Date.now() + 15 * 60e3).toISOString()})}});
      await audit(null, lock ? "auth.locked" : "auth.failed", "user", String(u._id), {});
    }
    throw generic;
  }
  if (consumerOnly && u.role !== "consumer") throw generic;
  await User.updateOne({_id: u._id}, {$set: {failed_logins: 0}, $unset: {locked_until: 1}});
  issueSession(res, u);
  await audit(actorOf(u), "auth.login", "user", String(u._id), {});
  res.json({user: publicUser(u)});
});
r.post("/login", limiter(15 * 60e3, 20, "Too many sign-in attempts. Try again in a few minutes."), signIn(false));
r.post("/consumer-login", limiter(15 * 60e3, 20, "Too many sign-in attempts. Try again in a few minutes."), signIn(true));
r.post("/register", limiter(60 * 60e3, 10, "Too many account creation attempts. Try again later."), ah(async (req, res) => {
  const input = parse(consumerRegisterSchema, req.body);
  let user;
  try {
    user = await User.create({email: input.email, name: input.name, role: "consumer", password_hash: await hashPassword(input.password), created_at: nowIso()});
  } catch (e) {
    if (e.code === 11000) throw new HttpError(409, "An account with this email already exists. Please sign in instead.");
    throw e;
  }
  const doc = user.toObject();
  issueSession(res, doc);
  await audit(actorOf(doc), "auth.register", "user", String(doc._id), {});
  res.status(201).json({user: publicUser(doc)});
}));
r.post("/logout", ah(async (req, res) => { if (req.user) await audit(req.user, "auth.logout", "user", req.user.id, {}); clearSession(res); res.json({ok: true}); }));
r.get("/me", requireRole(), (req, res) => res.json({user: publicUser(req.user)}));
export default r;
