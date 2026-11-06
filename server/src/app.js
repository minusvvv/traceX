import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import {config} from "./config.js";
import {connectDb} from "./db.js";
import {authenticate, requireClientHeader} from "./auth.js";
import {errorHandler, HttpError} from "./http.js";
import publicRoutes from "./routes/public.js";
import authRoutes from "./routes/auth.js";
import staffRoutes from "./routes/staff.js";
import adminRoutes from "./routes/admin.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");

  if (config.prod) app.set("trust proxy", config.trustProxy);
  if (config.forceHttps) app.use((req, res, next) => req.secure ? next() : res.redirect(308, `https://${req.headers.host}${req.originalUrl}`));
  app.use(helmet({hsts: config.forceHttps, contentSecurityPolicy: {directives: {defaultSrc: ["'none'"], frameAncestors: ["'none'"]}}}));
  app.use(cors({origin: (o, cb) => cb(null, !o || config.corsOrigins.includes(o)), credentials: true, allowedHeaders: ["Content-Type", "Idempotency-Key", "X-TraceX-Client", "X-Simulate"]}));
  app.use(express.json({limit: "100kb"}), cookieParser(), requireClientHeader);
  app.use("/api", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

  // Auto-connect to MongoDB on incoming serverless request
  app.use(async (_req, _res, next) => {
    try {
      await connectDb();
      next();
    } catch (err) {
      // Driver errors can contain connection details. Keep the client response and logs secret-free.
      next(new HttpError(503, "Database temporarily unavailable. Please try again."));
    }
  });

  // Root & Health check
  app.get("/", (_q, res) => res.json({status: "ok", service: "TraceX API", time: new Date().toISOString()}));
  app.get("/api/health", (_q, res) => res.json({ok: true}));

  // A cold instance must connect before session middleware performs its first query.
  app.use(authenticate);

  // Route registration
  app.use("/api/public", publicRoutes);
  app.use("/api/auth", authRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api", staffRoutes);
  app.use("/api", (_q, _s, next) => next(new HttpError(404, "Not found.")));
  app.use(errorHandler);

  return app;
}

// Required by Vercel Serverless Functions
const app = createApp();
export default app;
