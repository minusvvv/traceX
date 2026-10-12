import {config} from "./src/config.js";
import {connectDb, User, nowIso} from "./src/db.js";
import {createApp} from "./src/app.js";
import {seedThresholds} from "./src/services/thresholds.js";
import {hashPassword} from "./src/auth.js";

try { await connectDb(); }
catch (e) { console.error(`Cannot connect to MongoDB at ${config.mongoUri.replace(/\/\/[^@]*@/, "//***@")}\n${e.message}\nStart MongoDB (or set MONGO_URI to an Atlas connection string) and try again.`); process.exit(1); }
await seedThresholds();
if (!await User.estimatedDocumentCount()) {
  if (config.seedOnEmpty) {
    const {seedDemo} = await import("./src/seed.js");
    const out = await seedDemo();
    console.log(`[seed] Demonstration data loaded. Accounts: ${out.users.join(", ")}`);
    console.log(out.generated ? `[seed] Generated demo password (shown once): ${out.password}` : "[seed] Password = DEMO_PASSWORD from your environment.");
  } else if (process.env.BOOTSTRAP_ADMIN_EMAIL && process.env.BOOTSTRAP_ADMIN_PASSWORD) {
    await User.create({email: process.env.BOOTSTRAP_ADMIN_EMAIL, name: "Administrator", role: "admin", password_hash: await hashPassword(process.env.BOOTSTRAP_ADMIN_PASSWORD), created_at: nowIso()});
    console.log("[bootstrap] Created the initial administrator from BOOTSTRAP_ADMIN_* variables.");
  } else console.warn("[warn] No users exist. Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD (or SEED_ON_EMPTY=true for demo data).");
}
createApp().listen(config.port, () => console.log(`TraceX API on :${config.port} (${config.prod ? "production" : "development"}; MongoDB; supply-chain=${config.supplyChainProvider}, fssai=${config.fssaiAdapter})`));
