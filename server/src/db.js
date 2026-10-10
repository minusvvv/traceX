import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {config} from "./config.js";

if (config.dbPath !== ":memory:") fs.mkdirSync(path.dirname(config.dbPath), {recursive: true});
export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('lab','reviewer','admin','provider')),
  password_hash TEXT NOT NULL,
  lab_name TEXT, accreditation_ref TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0, locked_until TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL, category TEXT NOT NULL,
  brand TEXT, manufacturer TEXT NOT NULL,
  gtin TEXT UNIQUE,
  attributes TEXT NOT NULL DEFAULT '{}'      -- optional, product-specific attributes (JSON)
);
CREATE TABLE IF NOT EXISTS batches(
  id TEXT PRIMARY KEY COLLATE NOCASE,
  product_id TEXT NOT NULL REFERENCES products(id),
  lot_number TEXT COLLATE NOCASE,
  quantity TEXT NOT NULL,
  manufactured_on TEXT NOT NULL,
  expires_on TEXT,                            -- NULL when expiry/best-before does not apply
  facility TEXT NOT NULL,
  temperature_c REAL,                         -- latest cold-chain reading, only where relevant
  destination_place TEXT, destination_lat REAL, destination_lng REAL,
  created_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  UNIQUE(product_id, lot_number)
);
CREATE TABLE IF NOT EXISTS supply_chain_records(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL REFERENCES batches(id),
  stage TEXT NOT NULL,
  party_name TEXT NOT NULL, party_role TEXT,
  lat REAL, lng REAL, region TEXT,
  occurred_at TEXT NOT NULL,
  readings TEXT, notes TEXT, quality_score INTEGER,
  source TEXT NOT NULL DEFAULT 'internal'
);
CREATE INDEX IF NOT EXISTS idx_scr_batch ON supply_chain_records(batch_id, occurred_at);
CREATE TABLE IF NOT EXISTS complaints(
  id TEXT PRIMARY KEY,
  tracking_code TEXT NOT NULL UNIQUE,
  idempotency_key TEXT UNIQUE,
  batch_id TEXT REFERENCES batches(id),
  product_id TEXT REFERENCES products(id),
  submitted_identifier TEXT, identifier_source TEXT, product_text TEXT,
  description TEXT NOT NULL, lang TEXT,
  region TEXT, lat REAL, lng REAL,            -- coordinates rounded to ~100 m; never returned individually
  contact TEXT,                               -- optional; never exposed publicly, masked for staff
  sample_requested_at TEXT,
  created_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cmp_batch ON complaints(batch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cmp_product ON complaints(product_id, created_at);
CREATE TABLE IF NOT EXISTS attachments(
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK(owner_type IN ('complaint','lab_report')),
  owner_id TEXT NOT NULL, kind TEXT NOT NULL,
  original_name TEXT, mime TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL,
  stored_name TEXT NOT NULL, uploaded_by INTEGER, uploaded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_att_owner ON attachments(owner_type, owner_id);
CREATE TABLE IF NOT EXISTS thresholds(
  scope TEXT PRIMARY KEY,                      -- 'global' or a category key
  count INTEGER NOT NULL CHECK(count >= 1),
  window_days INTEGER NOT NULL CHECK(window_days BETWEEN 1 AND 365),
  updated_by INTEGER, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS flags(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL CHECK(target_type IN ('batch','product')),
  target_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','cleared')),
  flagged_at TEXT NOT NULL, complaint_count INTEGER NOT NULL, threshold INTEGER NOT NULL, window_days INTEGER NOT NULL,
  cleared_at TEXT, cleared_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_flag ON flags(target_type, target_id) WHERE status = 'open';
CREATE TABLE IF NOT EXISTS investigations(
  id TEXT PRIMARY KEY,
  batch_id TEXT REFERENCES batches(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  flag_id INTEGER REFERENCES flags(id),
  title TEXT NOT NULL, stage TEXT,
  status TEXT NOT NULL CHECK(status IN ('open','awaiting_lab','lab_confirmed','traced','report_ready','closed_unconfirmed','closed')),
  owner TEXT, summary TEXT,
  opened_at TEXT NOT NULL, closed_at TEXT, closure_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_inv_batch ON investigations(batch_id);
CREATE TABLE IF NOT EXISTS investigation_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  investigation_id TEXT NOT NULL REFERENCES investigations(id),
  at TEXT NOT NULL, title TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('done','alert','pending')),
  note TEXT, kind TEXT
);
CREATE TABLE IF NOT EXISTS sample_requests(
  id TEXT PRIMARY KEY,
  batch_id TEXT REFERENCES batches(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  flag_id INTEGER REFERENCES flags(id),
  investigation_id TEXT REFERENCES investigations(id),
  assigned_lab TEXT,                           -- NULL = open to any accredited lab
  status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','submitted','closed','cancelled')),
  reason TEXT, requested_at TEXT NOT NULL, due_by TEXT
);
CREATE TABLE IF NOT EXISTS sample_request_complaints(
  sample_request_id TEXT NOT NULL REFERENCES sample_requests(id),
  complaint_id TEXT NOT NULL REFERENCES complaints(id),
  PRIMARY KEY(sample_request_id, complaint_id)
);
CREATE TABLE IF NOT EXISTS lab_reports(
  id TEXT PRIMARY KEY,
  sample_request_id TEXT REFERENCES sample_requests(id),
  batch_id TEXT NOT NULL REFERENCES batches(id),
  lab_name TEXT NOT NULL, accreditation_ref TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('confirmed','not_confirmed','inconclusive')),
  contamination_type TEXT, severity TEXT CHECK(severity IN ('minor','major','critical')),
  results TEXT NOT NULL, notes TEXT,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','superseded')),
  supersedes_id TEXT REFERENCES lab_reports(id), correction_reason TEXT,
  submitted_by INTEGER, submitted_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS investigation_analysis(
  investigation_id TEXT PRIMARY KEY REFERENCES investigations(id),
  trace TEXT NOT NULL, hotspots TEXT NOT NULL, risk TEXT NOT NULL,
  provider TEXT NOT NULL, warnings TEXT, computed_at TEXT NOT NULL, computed_by INTEGER
);
CREATE TABLE IF NOT EXISTS reports(
  id TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL REFERENCES investigations(id),
  version INTEGER NOT NULL,
  content TEXT NOT NULL, content_sha256 TEXT NOT NULL,
  generated_by INTEGER, generated_at TEXT NOT NULL,
  UNIQUE(investigation_id, version)
);
CREATE TABLE IF NOT EXISTS report_submissions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id TEXT NOT NULL REFERENCES reports(id),
  attempt INTEGER NOT NULL,
  adapter TEXT NOT NULL, simulated INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('sent','acknowledged','failed')),
  external_ref TEXT, error TEXT,
  attempted_at TEXT NOT NULL, attempted_by INTEGER,
  UNIQUE(report_id, attempt, status)
);
CREATE TABLE IF NOT EXISTS regulatory_decisions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  investigation_id TEXT NOT NULL REFERENCES investigations(id),
  batch_id TEXT REFERENCES batches(id),
  decision TEXT NOT NULL CHECK(decision IN ('no_action','advisory_issued','recall_ordered','recall_closed')),
  authority_ref TEXT NOT NULL, notes TEXT, decided_on TEXT NOT NULL,
  recorded_by INTEGER, recorded_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL, actor_id INTEGER, actor_email TEXT, actor_role TEXT,
  action TEXT NOT NULL, entity_type TEXT, entity_id TEXT, details TEXT NOT NULL DEFAULT '{}',
  prev_hash TEXT NOT NULL, hash TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT,'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT,'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS lab_report_immutable BEFORE UPDATE OF results, outcome, batch_id, lab_name, accreditation_ref, submitted_at, submitted_by, contamination_type, severity, notes ON lab_reports
  BEGIN SELECT RAISE(ABORT,'lab report content is immutable; submit a correction instead'); END;
CREATE TRIGGER IF NOT EXISTS lab_report_no_delete BEFORE DELETE ON lab_reports BEGIN SELECT RAISE(ABORT,'lab reports cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS report_immutable BEFORE UPDATE ON reports BEGIN SELECT RAISE(ABORT,'generated reports are immutable'); END;
`);

export const nowIso = () => new Date().toISOString();
export const jparse = (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };
// Sequential human-readable ids ("C-1183"); safe because better-sqlite3 is synchronous.
export function nextId(table, prefix, base = 1000) {
  const r = db.prepare(`SELECT MAX(CAST(SUBSTR(id, ?) AS INTEGER)) m FROM ${table} WHERE id LIKE ?`).get(prefix.length + 2, prefix + "-%");
  return `${prefix}-${Math.max(base, r.m || 0) + 1}`;
}
export const tx = fn => db.transaction(fn)();
