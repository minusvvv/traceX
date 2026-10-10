import {config} from "./src/config.js";
import {db, nowIso} from "./src/db.js";
import {createApp} from "./src/app.js";
import {seedThresholds} from "./src/services/thresholds.js";
import {hashPassword} from "./src/auth.js";

seedThresholds();
if (!db.prepare("SELECT COUNT(*) n FROM users").get().n) {
  if (config.seedOnEmpty) {
    const {seedDemo} = await import("./src/seed.js");
    const out = await seedDemo();
    console.log(`[seed] Demonstration data loaded. Accounts: ${out.users.join(", ")}`);
    console.log(out.generated ? `[seed] Generated demo password (shown once): ${out.password}` : "[seed] Password = DEMO_PASSWORD from your environment.");
  } else if (process.env.BOOTSTRAP_ADMIN_EMAIL && process.env.BOOTSTRAP_ADMIN_PASSWORD) {
    db.prepare("INSERT INTO users(email,name,role,password_hash,created_at) VALUES(?,?,?,?,?)")
      .run(process.env.BOOTSTRAP_ADMIN_EMAIL, "Administrator", "admin", await hashPassword(process.env.BOOTSTRAP_ADMIN_PASSWORD), nowIso());
    console.log("[bootstrap] Created the initial administrator from BOOTSTRAP_ADMIN_* variables.");
  } else console.warn("[warn] No users exist. Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD (or SEED_ON_EMPTY=true for demo data).");
}
createApp().listen(config.port, () => console.log(`TraceX API on :${config.port} (${config.prod ? "production" : "development"}; supply-chain=${config.supplyChainProvider}, fssai=${config.fssaiAdapter})`));
