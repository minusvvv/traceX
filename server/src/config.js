// Central configuration. Every secret/URL comes from environment variables (see .env.example).
import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env;
const prod = env.NODE_ENV === "production";
const bool = (v, d) => (v === undefined || v === "" ? d : ["1", "true", "yes"].includes(String(v).toLowerCase()));
const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

let jwtSecret = env.JWT_SECRET;
if (!jwtSecret) {
  if (prod) throw new Error("JWT_SECRET must be set when NODE_ENV=production");
  jwtSecret = crypto.randomBytes(32).toString("hex");
  console.warn("[config] JWT_SECRET not set: using an ephemeral secret, so sessions reset on every restart.");
}

export const config = {
  root,
  prod,
  port: int(env.PORT, 5000),
  jwtSecret,
  sessionHours: int(env.SESSION_HOURS, 8),
  cookieSecure: bool(env.COOKIE_SECURE, prod),
  forceHttps: bool(env.FORCE_HTTPS, false),
  corsOrigins: (env.CORS_ORIGIN || "http://localhost:5173").split(",").map(s => s.trim()).filter(Boolean),
  mongoUri: env.MONGO_URI || "mongodb://127.0.0.1:27017/tracex",
  // Multi-document transactions need a replica set (Atlas always is one). Leave false for a standalone mongod.
  mongoTransactions: bool(env.MONGO_TRANSACTIONS, false),
  uploadDir: env.UPLOAD_DIR || path.join(root, "uploads"),
  seedOnEmpty: bool(env.SEED_ON_EMPTY, !prod),
  demoPassword: env.DEMO_PASSWORD || "",
  // Integrations. "mock" adapters are explicitly labelled as simulated everywhere they surface.
  supplyChainProvider: env.SUPPLY_CHAIN_PROVIDER || "mock",
  fssaiAdapter: env.FSSAI_ADAPTER || "mock",
  mockSupplyChainMode: env.MOCK_SUPPLY_CHAIN_MODE || "ok", // ok | unavailable | partial
  mockFssaiMode: env.MOCK_FSSAI_MODE || "ok",              // ok | fail | flaky
  allowSimulation: bool(env.ALLOW_SIMULATION, !prod),      // lets authorised users trigger mock failures per request
  // Public heat-map privacy controls.
  publicMapCellDeg: Number(env.PUBLIC_MAP_CELL_DEG) || 0.1, // ~11 km grid
  publicMapMinCell: int(env.PUBLIC_MAP_MIN_CELL, 3),        // cells with fewer reports are suppressed
  // Default prioritisation thresholds (admins override in the database).
  defaultThreshold: {count: int(env.DEFAULT_THRESHOLD_COUNT, 3), windowDays: int(env.DEFAULT_THRESHOLD_WINDOW_DAYS, 30)},
  recencyHalfLifeDays: 7,
  rateLimit: bool(env.RATE_LIMIT, true),
};
