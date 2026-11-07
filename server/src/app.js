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

  if (config.prod) app.set("trust proxy", 1);
  if (config.forceHttps) app.use((req, res, next) => req.secure ? next() : res.redirect(308, `https://${req.headers.host}${req.originalUrl}`));
  app.use(helmet({
    hsts: config.forceHttps,
    contentSecurityPolicy: {directives: {defaultSrc: ["'none'"], frameAncestors: ["'none'"]}},
    crossOriginResourcePolicy: {policy: "cross-origin"},
  }));
  app.use(cors({origin: (o, cb) => cb(null, !o || config.corsOrigins.includes(o)), credentials: true, allowedHeaders: ["Content-Type", "Idempotency-Key", "X-TraceX-Client", "X-Simulate"]}));
  app.use(express.json({limit: "100kb"}), cookieParser(), authenticate, requireClientHeader);

  // Auto-connect to MongoDB on incoming serverless request
  app.use(async (_req, _res, next) => {
    try {
      await connectDb();
      next();
    } catch (err) {
      next(err);
    }
  });

  // Root & Health check
  app.get("/", (_q, res) => res.json({status: "ok", service: "TraceX API", time: new Date().toISOString()}));
  app.get("/api/health", (_q, res) => res.json({ok: true}));

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
