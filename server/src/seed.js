// Demonstration data. Everything seeded here is FICTIONAL and flagged is_demo: it is not live government data,
// real laboratory verification, or a real regulatory decision. Dates are relative to the moment of seeding.
import fs from "node:fs";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";
import {config} from "./config.js";

const PLACEHOLDER_PDF = Buffer.from("%PDF-1.4\n% TraceX DEMONSTRATION PLACEHOLDER - not a real laboratory report\n%%EOF\n");
const pdf = () => ({report: [{mimetype: "application/pdf", buffer: PLACEHOLDER_PDF, originalname: "demo-placeholder-report.pdf", size: PLACEHOLDER_PDF.length}]});
const at = (daysAgo, hm) => { const [h, m] = hm.split(":").map(Number), t = new Date(); t.setUTCDate(t.getUTCDate() - daysAgo); t.setUTCHours(h, m, 0, 0); return t.toISOString(); };
const G = {fat: 4.2, snf: 8.6, water: "Negative"};

export async function seedDemo() {
  const M = await import("./db.js");
  const {User, Product, Batch, SupplyRecord, Complaint, Investigation, SampleRequest, nowIso, up, bumpCounter} = M;
  const {hashPassword} = await import("./auth.js");
  const {seedThresholds} = await import("./services/thresholds.js");
  const {onComplaintCreated, createSampleRequest, addInvestigationEvent} = await import("./services/prioritization.js");
  const {submitLabReport} = await import("./services/lab.js");
  const {audit} = await import("./audit.js");
  const {regionByName} = await import("./geo.js");

  const generated = !config.demoPassword, password = config.demoPassword || crypto.randomBytes(9).toString("base64url");
  const hash = await hashPassword(password);
  await seedThresholds();
  const users = [
    ["admin@tracex.demo", process.env.ADMIN_NAME || "Vedang Bhukan", "admin"], ["reviewer@tracex.demo", "Demo FSSAI Reviewer", "reviewer"],
    ["lab.nashik@tracex.demo", "Demo Lab Analyst (Nashik)", "lab", "Nashik Lab", "NABL-DEMO-0001"],
    ["lab.pune@tracex.demo", "Demo Lab Analyst (Pune)", "lab", "Pune Reference Lab", "NABL-DEMO-0002"],
    ["provider@tracex.demo", "Demo Supply-Chain Data Provider", "provider"]];
  await User.insertMany(users.map(([email, name, role, lab_name, accreditation_ref]) => ({email, name, role, password_hash: hash, lab_name, accreditation_ref, created_at: nowIso()})));
  await bumpCounter("INV", 15); // demo investigations below use explicit ids up to INV-015; auto-generated ones continue from INV-16

  // ---- products ----
  await Product.insertMany(
[["PRD-MILK-FC", "Full-cream milk", "dairy", "Demo Dairy", "Thane Processing Plant (demo)", "8900000000011", {fatClass: "full cream"}],
   ["PRD-MILK-TN", "Toned milk", "dairy", "Demo Dairy", "Pune Dairy Plant (demo)", "8900000000028", {fatClass: "toned"}],
   ["PRD-MILK-BF", "Buffalo milk", "dairy", "Demo Dairy", "Pune Dairy Plant (demo)", "8900000000035", {animal: "buffalo"}],
   ["PRD-BEV-OJ", "Orange fruit drink 200 ml", "beverage", "Demo Orchard", "Orchard Beverages Pvt Ltd (demo)", "8900000000042", {packSize: "200 ml", carbonated: false}],
   ["PRD-OIL-SF", "Refined sunflower oil 1 L", "edible_oil", "Sunfield", "Sunfield Edible Oils Pvt Ltd (demo)", "8900000000059", {packSize: "1 L"}],
   ["PRD-SNK-CH", "Salted potato chips 52 g", "snack", "Crispo", "Crispo Foods Pvt Ltd (demo)", "8900000000066", {packSize: "52 g"}],
   ["PRD-SNK-CP", "Masala corn puffs 40 g", "snack", "Puffo", "Puffo Snacks Pvt Ltd (demo)", "8900000000073", {packSize: "40 g", allergens: ["may contain peanuts"]}],
   ["PRD-GRN-AT", "Whole wheat atta 5 kg", "grain", "Golden Mill", "Golden Mill Foods (demo)", "8900000000080", {packSize: "5 kg"}]]
    
    .map(([_id, name, category, brand, manufacturer, gtin, attributes]) => ({_id, name, category, brand, manufacturer, gtin, attributes})));

  // ---- batches and journeys ----
  const BATCHES = [], RECS = [];
  const day = n => at(n, "00:00").slice(0, 10);
  const batch = (id, pid, lot, qty, d, shelfDays, facility, temp, dest) => BATCHES.push({_id: id, product_id: pid, lot_number: lot, lot_key: up(lot), quantity: qty, manufactured_on: day(d), expires_on: shelfDays ? day(d - shelfDays) : undefined,
    facility, temperature_c: temp ?? undefined, destination_place: dest?.[0], destination_lat: dest?.[1], destination_lng: dest?.[2], created_at: at(d, "05:00"), is_demo: true});
  const rec = (b, stage, role, place, lat, lng, region, d, hm, readings, notes, qs) => RECS.push({batch_id: b, stage, party_name: place, party_role: role, lat, lng, region: region ?? undefined, occurred_at: at(d, hm),
    readings: readings ?? undefined, notes: notes ?? undefined, quality_score: qs ?? undefined, source: "demo-seed"});

  // dairy
  batch("MILK-2026-001", "PRD-MILK-FC", "L2609A", "5,000 L", 7, 5, "Thane Processing Plant", 5.6, ["Pune Retail Hub", 18.53, 73.87]);
  rec("MILK-2026-001", "Farm", "supplier", "Sinnar Dairy Farmers Co-op", 19.85, 74.0, "Nashik", 7, "05:40", null, "Milk pooled from 42 farms.");
  rec("MILK-2026-001", "Collection", "intake", "Nashik Collection Point", 19.9975, 73.7898, "Nashik", 7, "07:10", G, "Chilled to 4°C on arrival.", 98);
  rec("MILK-2026-001", "Testing", "laboratory", "Nashik Lab", 19.99, 73.78, "Nashik", 7, "08:00", G, "Water adulteration test: negative.", 98);
  rec("MILK-2026-001", "Transport", "logistics", "Refrigerated tanker MH-15-4471", 19.6, 73.2, null, 7, "21:15", {...G}, "Cold chain held between 4–6°C.", 97);
  rec("MILK-2026-001", "Manufacturing", "manufacturer", "Thane Processing Plant", 19.2183, 72.9781, "Thane", 6, "06:30", {fat: 4.1, snf: 8.5, water: "Negative"}, "Pasteurised and packed.", 97);
  rec("MILK-2026-001", "Distribution", "distributor", "Mumbai Central Distributor", 19.076, 72.8777, "Mumbai Suburban", 5, "10:42", {fat: 4.0, snf: 8.4, water: "Negative"}, "Dispatched to Pune.", 94);

  batch("MILK-2026-002", "PRD-MILK-TN", "L2610B", "3,200 L", 6, 5, "Pune Dairy Plant", 4.8, ["Pune Retail Hub", 18.53, 73.87]);
  rec("MILK-2026-002", "Farm", "supplier", "Baramati Dairy Farms", 18.15, 74.58, "Pune", 6, "05:30", null, "Direct farm supply.");
  rec("MILK-2026-002", "Collection", "intake", "Baramati Collection Point", 18.1516, 74.5777, "Pune", 6, "07:00", {fat: 3.6, snf: 8.5, water: "Negative"}, "Chilled on arrival.", 98);
  rec("MILK-2026-002", "Testing", "laboratory", "Pune Lab", 18.5204, 73.8567, "Pune", 6, "10:00", {fat: 3.6, snf: 8.5, water: "Negative"}, "All parameters normal.", 98);
  rec("MILK-2026-002", "Transport", "logistics", "Refrigerated van MH-12-2290", 18.4, 74.2, null, 6, "12:00", {fat: 3.6, snf: 8.5, water: "Negative"}, "Stable.", 97);
  rec("MILK-2026-002", "Manufacturing", "manufacturer", "Pune Dairy Plant", 18.56, 73.91, "Pune", 5, "06:00", {fat: 3.5, snf: 8.4, water: "Negative"}, "Packed.", 97);
  rec("MILK-2026-002", "Distribution", "distributor", "Pune Cold Depot", 18.5204, 73.8567, "Pune", 5, "14:00", {fat: 3.5, snf: 8.4, water: "Negative"}, "Stable.", 96);
  rec("MILK-2026-002", "Retail", "retailer", "Pune Retail Hub", 18.53, 73.87, "Pune", 4, "08:00", {fat: 3.5, snf: 8.4, water: "Negative"}, "On shelf.", 96);

  batch("MILK-2026-003", "PRD-MILK-BF", "L2611C", "2,400 L", 3, 5, "Pune Dairy Plant", 8.1, ["Pune Retail Hub", 18.53, 73.87]);
  rec("MILK-2026-003", "Farm", "supplier", "Kamptee Farmers Group", 21.22, 79.2, "Nagpur", 3, "05:00", null, "Pooled supply.");
  rec("MILK-2026-003", "Collection", "intake", "Nagpur Collection Point", 21.1458, 79.0882, "Nagpur", 3, "07:00", {fat: 6.8, snf: 9.1, water: "Negative"}, "Chilled.", 97);
  rec("MILK-2026-003", "Testing", "laboratory", "Nagpur Lab", 21.15, 79.09, "Nagpur", 3, "09:00", {fat: 6.8, snf: 9.1, water: "Negative"}, "Normal.", 97);
  rec("MILK-2026-003", "Transport", "logistics", "Refrigerated tanker MH-31-1180", 20.0, 76.5, null, 2, "14:00", {fat: 6.8, snf: 9.1, water: "Negative"}, "Temperature above 8°C for 40 minutes.", 90);
  rec("MILK-2026-003", "Manufacturing", "manufacturer", "Pune Dairy Plant", 18.56, 73.91, "Pune", 1, "09:00", {fat: 6.7, snf: 9.0, water: "Negative"}, "Held for review of transit temperature.", 85);

  batch("MILK-2026-004", "PRD-MILK-FC", "L2612D", "4,100 L", 3, 5, "Thane Processing Plant", 9.4, ["Thane Retail Hub", 19.2, 72.97]);
  rec("MILK-2026-004", "Farm", "supplier", "Igatpuri Farmers Co-op", 19.7, 73.56, "Nashik", 3, "05:20", null, "Pooled supply.");
  rec("MILK-2026-004", "Collection", "intake", "Nashik Collection Point", 19.9975, 73.7898, "Nashik", 3, "07:00", {fat: 4.1, snf: 8.6, water: "Negative"}, "Chilled.", 98);
  rec("MILK-2026-004", "Testing", "laboratory", "Nashik Lab", 19.99, 73.78, "Nashik", 3, "08:30", {fat: 4.1, snf: 8.6, water: "Negative"}, "Normal.", 98);
  rec("MILK-2026-004", "Transport", "logistics", "Refrigerated tanker MH-15-3308", 19.6, 73.3, null, 3, "19:00", {fat: 4.1, snf: 8.5, water: "Negative"}, "Cold chain intact.", 97);
  rec("MILK-2026-004", "Manufacturing", "manufacturer", "Thane Processing Plant", 19.2183, 72.9781, "Thane", 2, "06:00", {fat: 4.0, snf: 8.4, water: "Negative"}, "Processing recorded.", 97);
  rec("MILK-2026-004", "Distribution", "distributor", "Thane Distributor", 19.22, 72.98, "Thane", 1, "09:00", {fat: 3.5, snf: 7.9, water: "Suspected"}, "Readings differ from processing stage.", 91);
  rec("MILK-2026-004", "Retail", "retailer", "Thane Retail Hub", 19.2, 72.97, "Thane", 1, "15:00", {fat: 3.4, snf: 7.8, water: "Suspected"}, "Consumer report received.", 89);
  rec("MILK-2026-004", "Retail", "retailer", "Andheri Retail Outlet", 19.119, 72.847, "Mumbai Suburban", 1, "16:30", null, "Received from Thane Distributor.");
  rec("MILK-2026-004", "Retail", "retailer", "Mulund Retail Outlet", 19.172, 72.956, "Mumbai Suburban", 1, "17:10", null, "Received from Thane Distributor.");

  // beverage
  batch("BEV-2026-001", "PRD-BEV-OJ", "OJ-4471", "12,000 packs", 5, 120, "Orchard Beverages Plant, Pune", 7.2, null);
  rec("BEV-2026-001", "Raw material supplier", "supplier", "Nagpur Citrus Growers Co-op (demo)", 21.1, 79.05, "Nagpur", 6, "06:00", null, "Orange juice concentrate lot received.");
  rec("BEV-2026-001", "Manufacturing", "manufacturer", "Orchard Beverages Plant, Pune", 18.56, 73.91, "Pune", 5, "09:00", {ph: 3.6, brix: 11.8, preservative: 120, yeast_mould: "Not detected"}, "Blended, pasteurised and filled.", 96);
  rec("BEV-2026-001", "Testing", "laboratory", "Pune Lab", 18.5204, 73.8567, "Pune", 5, "14:00", {ph: 3.6, brix: 11.8, preservative: 120, yeast_mould: "Not detected"}, "Release test.", 96);
  rec("BEV-2026-001", "Warehouse", "warehouse", "Pune Cold Warehouse", 18.53, 73.85, "Pune", 4, "10:00", {ph: 3.6, brix: 11.7, preservative: 118, yeast_mould: "Not detected"}, "Stored at 6–8°C.", 95);
  rec("BEV-2026-001", "Distribution", "distributor", "Western Distributors, Mumbai", 19.076, 72.8777, "Mumbai Suburban", 3, "11:00", null, "Dispatched to retailers.");
  rec("BEV-2026-001", "Retail", "retailer", "Vashi Supermart", 19.077, 72.998, "Navi Mumbai", 2, "10:00", null, "On shelf.");

  // edible oil
  batch("OIL-2026-001", "PRD-OIL-SF", "SF-0932", "8,000 L", 9, 270, "Sunfield Refinery, Solapur", null, null);
  rec("OIL-2026-001", "Raw material supplier", "supplier", "Latur Oilseed Traders (demo)", 18.4, 76.56, null, 10, "06:00", null, "Crude sunflower oil lot.");
  rec("OIL-2026-001", "Intake", "intake", "Solapur Receiving Yard", 17.6599, 75.9064, "Solapur", 10, "12:00", {peroxide_value: 2.0, acid_value: 0.3, moisture: 0.1, adulterant: "Not detected"}, "Received.", 97);
  rec("OIL-2026-001", "Testing", "laboratory", "Solapur In-house Lab", 17.66, 75.9, "Solapur", 10, "15:00", {peroxide_value: 2.0, acid_value: 0.3, moisture: 0.1, adulterant: "Not detected"}, "Incoming test.", 97);
  rec("OIL-2026-001", "Refining", "manufacturer", "Sunfield Refinery, Solapur", 17.665, 75.91, "Solapur", 9, "09:00", {peroxide_value: 2.1, acid_value: 0.2, moisture: 0.1, adulterant: "Not detected"}, "Refined and deodorised.", 97);
  rec("OIL-2026-001", "Packaging", "packaging", "Sunfield Packing Line 2", 17.665, 75.91, "Solapur", 8, "11:00", {peroxide_value: 2.2, acid_value: 0.3, moisture: 0.1, adulterant: "Not detected"}, "Filled and sealed.", 96);
  rec("OIL-2026-001", "Warehouse", "warehouse", "Pune Central Warehouse", 18.5204, 73.8567, "Pune", 7, "10:00", {peroxide_value: 8.4, acid_value: 0.9, moisture: 0.1, adulterant: "Not detected"}, "Readings differ from packaging stage.", 88);
  rec("OIL-2026-001", "Distribution", "distributor", "Shree Traders, Pune", 18.52, 73.86, "Pune", 6, "09:00", null, "Distributed within Pune.");
  rec("OIL-2026-001", "Distribution", "distributor", "Nashik Agro Distributors", 19.9975, 73.7898, "Nashik", 6, "13:00", null, "Distributed within Nashik.");
  rec("OIL-2026-001", "Retail", "retailer", "Camp Provision Store, Pune", 18.514, 73.88, "Pune", 5, "10:00", null, "On shelf.");
  rec("OIL-2026-001", "Retail", "retailer", "Gangapur Road Mart, Nashik", 20.0, 73.76, "Nashik", 5, "11:00", null, "On shelf.");
  rec("OIL-2026-001", "Retail", "retailer", "Thane Wholesale Mart", 19.2183, 72.9781, "Thane", 4, "12:00", null, "On shelf.");

  // snacks
  batch("SNK-2026-001", "PRD-SNK-CH", "CH-7718", "20,000 packs", 8, 150, "Crispo Plant, Pune", null, null);
  rec("SNK-2026-001", "Raw material supplier", "supplier", "Pune Potato Growers (demo)", 18.7, 73.9, "Pune", 9, "07:00", null, "Potato lot received.");
  rec("SNK-2026-001", "Manufacturing", "manufacturer", "Crispo Plant, Pune", 18.56, 73.85, "Pune", 8, "08:00", {moisture: 1.8, peroxide_value: 1.5, foreign_matter: "Absent", salmonella: "Not detected"}, "Fried and seasoned.", 96);
  rec("SNK-2026-001", "Packaging", "packaging", "Crispo Packing Hall", 18.56, 73.85, "Pune", 8, "14:00", {moisture: 1.9, peroxide_value: 1.6, foreign_matter: "Absent", salmonella: "Not detected"}, "Sealed.", 96);
  rec("SNK-2026-001", "Warehouse", "warehouse", "Pune Dry Warehouse", 18.53, 73.85, "Pune", 7, "10:00", null, "Stored.");
  rec("SNK-2026-001", "Distribution", "distributor", "Pune Snacks Distributor", 18.52, 73.86, "Pune", 6, "10:00", null, "Dispatched.");
  rec("SNK-2026-001", "Retail", "retailer", "Kothrud Mini Mart", 18.5074, 73.8077, "Pune", 5, "10:00", null, "On shelf.");

  batch("SNK-2026-002", "PRD-SNK-CP", "CP-2204", "15,000 packs", 6, 150, "Puffo Plant, Nagpur", null, null);
  rec("SNK-2026-002", "Raw material supplier", "supplier", "Vidarbha Maize Traders (demo)", 21.2, 79.1, "Nagpur", 7, "07:00", null, "Maize grits lot.");
  rec("SNK-2026-002", "Manufacturing", "manufacturer", "Puffo Plant, Nagpur", 21.15, 79.09, "Nagpur", 6, "08:00", {moisture: 2.0, peroxide_value: 1.8, foreign_matter: "Absent", salmonella: "Not detected"}, "Extruded and seasoned.", 95);
  rec("SNK-2026-002", "Packaging", "packaging", "Puffo Packing Hall", 21.15, 79.09, "Nagpur", 6, "15:00", {moisture: 2.1, peroxide_value: 2.0, foreign_matter: "Absent", salmonella: "Not detected"}, "Sealed.", 95);
  rec("SNK-2026-002", "Warehouse", "warehouse", "Nagpur Dry Warehouse", 21.14, 79.08, "Nagpur", 5, "10:00", null, "Stored.");
  rec("SNK-2026-002", "Distribution", "distributor", "Vidarbha Snacks Distributor", 21.14, 79.1, "Nagpur", 4, "10:00", null, "Dispatched.");
  rec("SNK-2026-002", "Retail", "retailer", "Sitabuldi Kirana, Nagpur", 21.14, 79.08, "Nagpur", 4, "15:00", null, "On shelf.");
  rec("SNK-2026-002", "Retail", "retailer", "Pune Station Kiosk", 18.529, 73.874, "Pune", 3, "12:00", null, "On shelf.");

  // grain
  batch("GRN-2026-001", "PRD-GRN-AT", "AT-5530", "10,000 kg", 10, 120, "Golden Mill, Nashik", null, null);
  rec("GRN-2026-001", "Farm or procurement", "supplier", "Sinnar Wheat Growers (demo)", 19.85, 74.0, "Nashik", 12, "06:00", null, "Wheat procured.");
  rec("GRN-2026-001", "Storage silo", "intake", "Golden Mill Silo", 19.99, 73.79, "Nashik", 11, "10:00", {moisture: 11.2, aflatoxin_b1: 1.1, insect_damage: 0.3, foreign_matter: "Absent"}, "Binned.", 97);
  rec("GRN-2026-001", "Milling", "manufacturer", "Golden Mill, Nashik", 19.9975, 73.7898, "Nashik", 10, "09:00", {moisture: 11.0, aflatoxin_b1: 1.0, insect_damage: 0.2, foreign_matter: "Absent"}, "Milled and sieved.", 97);
  rec("GRN-2026-001", "Packaging", "packaging", "Golden Mill Packing", 19.9975, 73.7898, "Nashik", 9, "14:00", {moisture: 11.0, aflatoxin_b1: 1.0, insect_damage: 0.2, foreign_matter: "Absent"}, "Packed in 5 kg bags.", 97);
  rec("GRN-2026-001", "Warehouse", "warehouse", "Nashik Central Warehouse", 20.0, 73.78, "Nashik", 8, "10:00", null, "Stored.");
  rec("GRN-2026-001", "Distribution", "distributor", "Nashik Grain Distributor", 19.99, 73.8, "Nashik", 7, "10:00", null, "Dispatched.");
  rec("GRN-2026-001", "Retail", "retailer", "Nashik Road Supermart", 19.95, 73.83, "Nashik", 6, "10:00", null, "On shelf.");

  await Batch.insertMany(BATCHES);
  await SupplyRecord.insertMany(RECS);

  // ---- complaints (inserted with past dates; the real prioritisation engine then evaluates them) ----
  let seq = 1000, pend = [];
  const code = () => { const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", b = crypto.randomBytes(12); const s = [...b].map(x => a[x % a.length]).join(""); return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`; };
  const complain = (batchId, productId, region, d, hm, text) => {
    const r = regionByName(region), id = `C-${++seq}`;
    pend.push({_id: id, tracking_code: code(), batch_id: batchId ?? undefined, product_id: productId, submitted_identifier: batchId ?? undefined, identifier_source: "manual", description: text, lang: "en", region, lat: r?.lat, lng: r?.lng, created_at: at(d, hm), is_demo: true});
    return {id, batch_id: batchId, product_id: productId};
  };
  const flush = async () => { if (pend.length) { await Complaint.insertMany(pend); pend = []; } };
  // historical, product-level reports for trend charts and the public map (older than every threshold window)
  const hist = [["Mumbai Suburban", 6], ["Thane", 4], ["Pune", 5], ["Nashik", 3], ["Nagpur", 3], ["Navi Mumbai", 3]], prods = ["PRD-MILK-FC", "PRD-MILK-TN", "PRD-BEV-OJ", "PRD-OIL-SF", "PRD-SNK-CH", "PRD-GRN-AT"];
  let k = 0;
  for (const [region, n] of hist) for (let i = 0; i < n; i++, k++) complain(null, prods[k % prods.length], region, 35 + ((k * 11) % 85), "10:00", "Unusual taste or smell reported (historical demonstration record).");

  const lastOf = list => list[list.length - 1];
  const INV = o => Investigation.create({owner: "Quality team", ...o});
  // MILK-003: one complaint (below threshold) + a manually requested sample
  complain("MILK-2026-003", "PRD-MILK-BF", "Pune", 1, "11:00", "Pack felt warm at purchase."); await flush();
  await INV({_id: "INV-013", batch_id: "MILK-2026-003", product_id: "PRD-MILK-BF", title: "Transit temperature excursion", stage: "Transport", status: "open", owner: "Logistics",
    summary: "Temperature exceeded 8 °C for about 40 minutes. Quality readings remain within range.", opened_at: at(1, "09:30")});
  await addInvestigationEvent("INV-013", "Temperature threshold exceeded", "alert", "8.4 °C peak", "temp", at(2, "14:00"));
  await addInvestigationEvent("INV-013", "Batch held at plant", "done", "Pune Dairy Plant", "hold", at(1, "09:00"));
  await createSampleRequest({batchId: "MILK-2026-003", productId: "PRD-MILK-BF", investigationId: "INV-013", reason: "Temperature excursion follow-up (reviewer request)"});

  // MILK-004: four complaints reach the threshold of 3 -> flag, sample request, investigation INV-014
  await INV({_id: "INV-014", batch_id: "MILK-2026-004", product_id: "PRD-MILK-FC", title: "Quality deviation after processing", stage: "Distribution", status: "open",
    summary: "Fat and SNF readings dropped between processing and distribution. Consumer reports were received. Evidence is not yet conclusive.", opened_at: at(1, "10:00")});
  for (const [t, s, n, w] of [["Collection recorded", "done", "Nashik Collection Point · 4,100 L", at(3, "07:00")], ["Quality test completed", "done", "Fat 4.1% · SNF 8.6% · water negative", at(3, "08:30")],
    ["Processing recorded", "done", "Thane Processing Plant · quality 97%", at(2, "06:00")], ["Quality deviation detected", "alert", "Fat 3.5% · SNF 7.9% · quality 91%", at(1, "09:00")]]) await addInvestigationEvent("INV-014", t, s, n, "history", w);
  const m4 = [complain("MILK-2026-004", "PRD-MILK-FC", "Thane", 1, "13:00", "Thin texture and unusual taste."), complain("MILK-2026-004", "PRD-MILK-FC", "Thane", 1, "15:30", "Milk separated quickly after opening."),
    complain("MILK-2026-004", "PRD-MILK-FC", "Mumbai Suburban", 0, "06:20", "Watery milk, tasted different from usual."), complain("MILK-2026-004", "PRD-MILK-FC", "Mumbai Suburban", 0, "08:05", "Very thin; looked bluish.")];
  await flush(); await onComplaintCreated(lastOf(m4));

  // beverage and snack with one or two complaints: counted, but below the threshold
  complain("BEV-2026-001", "PRD-BEV-OJ", "Mumbai Suburban", 1, "09:10", "Slightly fizzy and sour after opening.");
  complain("BEV-2026-001", "PRD-BEV-OJ", "Navi Mumbai", 0, "10:40", "Tasted fermented.");
  complain("SNK-2026-001", "PRD-SNK-CH", "Pune", 2, "12:00", "Found a small piece of plastic in the pack."); await flush();

  // OIL-001: five complaints -> flag -> laboratory CONFIRMS adulteration (analysis not yet run, so the reviewer can try traceability)
  const o = [["Pune", 5, "09:00"], ["Pune", 4, "12:00"], ["Nashik", 3, "10:00"], ["Pune", 2, "16:00"], ["Nashik", 1, "11:30"]]
    .map(([r, d, hm]) => complain("OIL-2026-001", "PRD-OIL-SF", r, d, hm, "Oil smells off and leaves a bitter aftertaste."));
  await flush();
  await INV({_id: "INV-015", batch_id: "OIL-2026-001", product_id: "PRD-OIL-SF", title: "Consumer complaints reached the review threshold", stage: "Warehouse", status: "open",
    summary: "Five consumer complaints about batch OIL-2026-001 were received. These are unverified reports; laboratory verification is required.", opened_at: at(5, "10:00")});
  await onComplaintCreated(lastOf(o));
  const withId = u => ({...u, id: String(u._id)});
  const pune = withId(await User.findOne({email: "lab.pune@tracex.demo"}).lean()), nashik = withId(await User.findOne({email: "lab.nashik@tracex.demo"}).lean());
  const srOil = (await SampleRequest.findOne({batch_id: "OIL-2026-001"}).lean())._id;
  await submitLabReport(pune, {sampleRequestId: srOil, batchId: "OIL-2026-001", accreditationRef: pune.accreditation_ref, outcome: "confirmed", contaminationType: "Adulteration with foreign or mineral oil", severity: "major",
    results: {peroxide_value: 9.1, acid_value: 1.0, moisture: 0.1, adulterant: "Detected"}, notes: "Demonstration record: foreign oil detected."}, pdf());

  // SNK-002: three complaints -> flag -> laboratory does NOT confirm -> investigation closed, complaints remain recorded
  const s2 = [["Nagpur", 4, "10:00"], ["Nagpur", 3, "14:00"], ["Pune", 2, "09:00"]].map(([r, d, hm]) => complain("SNK-2026-002", "PRD-SNK-CP", r, d, hm, "Tasted stale and slightly rancid."));
  await flush(); await onComplaintCreated(lastOf(s2));
  const srSnk = (await SampleRequest.findOne({batch_id: "SNK-2026-002"}).lean())._id;
  await submitLabReport(pune, {sampleRequestId: srSnk, batchId: "SNK-2026-002", accreditationRef: pune.accreditation_ref, outcome: "not_confirmed",
    results: {moisture: 2.2, peroxide_value: 2.3, foreign_matter: "Absent", salmonella: "Not detected"}, notes: "Demonstration record: no contamination found."}, pdf());

  // routine laboratory verifications for clean batches
  await INV({_id: "INV-011", batch_id: "MILK-2026-001", product_id: "PRD-MILK-FC", title: "Routine verification", status: "closed", summary: "Routine cross-check completed. No deviation found.",
    opened_at: at(5, "10:42"), closed_at: at(5, "11:00"), closure_reason: "Routine cross-check completed. No deviation found."});
  await addInvestigationEvent("INV-011", "Verification completed", "done", "All stages consistent", "history", at(5, "10:42"));
  const routine = (u, b, results) => submitLabReport(u, {batchId: b, accreditationRef: u.accreditation_ref, outcome: "not_confirmed", results, notes: "Demonstration record: routine verification."}, pdf());
  await routine(nashik, "MILK-2026-001", G);
  await routine(pune, "MILK-2026-002", {fat: 3.6, snf: 8.5, water: "Negative"});
  await routine(pune, "GRN-2026-001", {moisture: 11.0, aflatoxin_b1: 1.0, insect_damage: 0.2, foreign_matter: "Absent"});
  await bumpCounter("C", seq);
  await audit(null, "seed.completed", "system", "demo", {note: "Demonstration data loaded"});
  return {password, generated, users: users.map(u => u[0])};
}

export async function syncAdminUser({
  email = process.env.ADMIN_EMAIL || "admin@tracex.demo",
  name = process.env.ADMIN_NAME || "Vedang Bhukan",
  password = config.demoPassword
} = {}) {
  const {User, nowIso} = await import("./db.js");
  const {hashPassword} = await import("./auth.js");
  if (!password) throw new Error("DEMO_PASSWORD environment variable is required to set the admin password.");
  const hash = await hashPassword(password);
  const updated = await User.findOneAndUpdate(
    {email: email.toLowerCase()},
    {$set: {password_hash: hash, ...(name ? {name} : {}), failed_logins: 0}, $unset: {locked_until: 1}},
    {new: true}
  );
  if (!updated) {
    return await User.create({
      email: email.toLowerCase(),
      name: name || "Vedang Bhukan",
      role: "admin",
      password_hash: hash,
      created_at: nowIso(),
    });
  }
  return updated;
}

// CLI: node src/seed.js   (drops the configured database first, then loads demo data)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const {connectDb, disconnectDb} = await import("./db.js"), mongoose = (await import("mongoose")).default;
  await connectDb();
  if (process.argv.includes("--admin")) {
    const admin = await syncAdminUser();
    console.log(`[seed] Admin user (${admin.email}) updated with configured password and unlocked.`);
    await disconnectDb();
    process.exit(0);
  }
  if (process.argv.includes("--reset")) { await mongoose.connection.dropDatabase(); fs.rmSync(config.uploadDir, {recursive: true, force: true}); await connectDb(); }
  const {User} = await import("./db.js");
  if (await User.estimatedDocumentCount()) { console.log("Database already has data. Use `npm run seed` (which resets) to start over, or `node src/seed.js --admin` to update the admin account."); await disconnectDb(); process.exit(0); }
  const out = await seedDemo();
  console.log(`Seeded demonstration data. Accounts: ${out.users.join(", ")}`);
  console.log(out.generated ? `Generated demo password (shown once): ${out.password}` : "Password is the DEMO_PASSWORD from your environment.");
  await disconnectDb();
}
