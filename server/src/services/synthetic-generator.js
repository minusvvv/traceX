// Synthetic Outbreak Data Generator for TraceX.
// Generates realistic multi-hop supply chain journeys, cold-chain breakdowns,
// and geographically dispersed consumer complaint clusters.

import crypto from "node:crypto";
import {Batch, SupplyRecord, Complaint, Investigation, SampleRequest, Product, User, nowIso, bumpCounter} from "../db.js";
import {onComplaintCreated, createSampleRequest, addInvestigationEvent} from "./prioritization.js";
import {submitLabReport} from "./lab.js";
import {regionByName} from "../geo.js";

const PLACEHOLDER_PDF = Buffer.from("%PDF-1.4\n% TraceX SYNTHETIC LAB REPORT\n%%EOF\n");
const mockPdf = () => ({report: [{mimetype: "application/pdf", buffer: PLACEHOLDER_PDF, originalname: "synthetic-lab-report.pdf", size: PLACEHOLDER_PDF.length}]});

const makeCode = () => {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = crypto.randomBytes(12);
  const s = [...b].map(x => a[x % a.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
};

const agoIso = (daysAgo, hours = 10, minutes = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hours, minutes, 0, 0);
  return d.toISOString();
};

export async function generateScenario(scenarioType = "dairy_coldchain") {
  if (scenarioType === "dairy_coldchain") {
    // SCENARIO 1: Cold-chain temperature excursion causing multi-city milk spoilage
    const batchId = `MILK-SYNTH-${Date.now().toString().slice(-4)}`;
    const lot = `L-CC-${Math.floor(1000 + Math.random() * 9000)}`;
    const prodId = "PRD-MILK-FC";

    // 1. Create Batch
    await Batch.create({
      _id: batchId,
      product_id: prodId,
      lot_number: lot,
      lot_key: lot.toUpperCase(),
      quantity: "8,500 L",
      manufactured_on: agoIso(5).slice(0, 10),
      expires_on: agoIso(-2).slice(0, 10),
      facility: "Thane Processing Plant",
      temperature_c: 12.4, // Excursion!
      destination_place: "Pune Central Hub",
      destination_lat: 18.5204,
      destination_lng: 73.8567,
      created_at: agoIso(5, 5, 0),
      is_demo: true,
    });

    // 2. Supply chain hops
    const hops = [
      {stage: "Farm", place: "Sangamner Farmers Cooperative", role: "supplier", lat: 19.57, lng: 74.21, region: "Nashik", daysAgo: 5, time: "05:30", qs: 98, readings: {fat: 4.3, snf: 8.7, water: "Negative"}, notes: "Fresh morning collection."},
      {stage: "Collection", place: "Sangamner Chilling Center", role: "intake", lat: 19.58, lng: 74.22, region: "Nashik", daysAgo: 5, time: "07:15", qs: 98, readings: {fat: 4.3, snf: 8.7, water: "Negative"}, notes: "Pre-chilled to 4°C."},
      {stage: "Transport", place: "Refrigerated Tanker MH-15-8899", role: "logistics", lat: 19.45, lng: 73.85, region: "Thane", daysAgo: 5, time: "14:00", qs: 88, readings: {fat: 4.2, snf: 8.6, water: "Negative"}, notes: "Compressor warning logged; temp rose to 12.4°C for 4 hrs."},
      {stage: "Manufacturing", place: "Thane Processing Plant", role: "manufacturer", lat: 19.2183, lng: 72.9781, region: "Thane", daysAgo: 4, time: "06:00", qs: 89, readings: {fat: 4.1, snf: 8.4, water: "Negative"}, notes: "Pasteurized and bottled under Lot " + lot},
      {stage: "Distribution", place: "Navi Mumbai Regional Depot", role: "distributor", lat: 19.033, lng: 73.0297, region: "Navi Mumbai", daysAgo: 3, time: "10:30", qs: 84, readings: {fat: 4.0, snf: 8.3, water: "Negative"}, notes: "Dispatched to Mumbai Suburban & Pune."},
      {stage: "Distribution", place: "Pune Cold Chain Hub", role: "distributor", lat: 18.5204, lng: 73.8567, region: "Pune", daysAgo: 3, time: "18:00", qs: 82, readings: {fat: 3.9, snf: 8.2, water: "Negative"}, notes: "Secondary distribution to retail kiosks."},
      {stage: "Retail", place: "Mumbai Dadar Retail Hub", role: "retailer", lat: 19.0178, lng: 72.8478, region: "Mumbai Suburban", daysAgo: 2, time: "08:00", qs: 80, notes: "Stocked on retail shelves."},
    ];

    for (const h of hops) {
      await SupplyRecord.create({
        batch_id: batchId,
        stage: h.stage,
        party_name: h.place,
        party_role: h.role,
        lat: h.lat,
        lng: h.lng,
        region: h.region,
        occurred_at: agoIso(h.daysAgo, ...h.time.split(":").map(Number)),
        readings: h.readings,
        notes: h.notes,
        quality_score: h.qs,
        source: "synthetic-generator",
      });
    }

    // 3. Clustered complaints across 3 correlated regions
    const complaintSpecs = [
      // Mumbai Suburban (12 complaints)
      {region: "Mumbai Suburban", count: 12, texts: [
        "Milk smelled sour and curdled immediately upon boiling.",
        "Packet had yellowish separation and tasted acidic.",
        "Very bad off-taste; our family could not consume it.",
        "Tasted like curd, packet was slightly bloated.",
      ]},
      // Thane (8 complaints)
      {region: "Thane", count: 8, texts: [
        "Unusual foul smell when opened this morning.",
        "Separated into watery liquid and curdled lumps.",
        "Milk tasted spoiled even before the expiry date.",
      ]},
      // Pune (10 complaints)
      {region: "Pune", count: 10, texts: [
        "Curdled milk purchased from local depot.",
        "Felt warm inside the retail chiller and spoiled rapidly.",
        "Sour taste; children complained of stomach ache.",
        "Bad smell and thick lumps inside the packet.",
      ]},
    ];

    let seq = Math.floor(2000 + Math.random() * 5000);
    const createdComplaints = [];

    for (const spec of complaintSpecs) {
      const reg = regionByName(spec.region);
      for (let i = 0; i < spec.count; i++) {
        const jitterLat = (reg?.lat || 19.0) + (Math.random() - 0.5) * 0.08;
        const jitterLng = (reg?.lng || 73.0) + (Math.random() - 0.5) * 0.08;
        const text = spec.texts[i % spec.texts.length];
        const cId = `C-SYNTH-${++seq}`;
        const c = await Complaint.create({
          _id: cId,
          tracking_code: makeCode(),
          batch_id: batchId,
          product_id: prodId,
          submitted_identifier: batchId,
          identifier_source: "scan",
          description: text,
          lang: "en",
          region: spec.region,
          lat: +jitterLat.toFixed(4),
          lng: +jitterLng.toFixed(4),
          created_at: agoIso(Math.min(2, Math.floor(Math.random() * 3)), Math.floor(8 + Math.random() * 10), Math.floor(Math.random() * 59)),
          is_demo: true,
        });
        createdComplaints.push(c);
      }
    }

    // Evaluate prioritisation on the latest complaint to trigger threshold & sample request
    const lastComplaint = createdComplaints[createdComplaints.length - 1];
    await onComplaintCreated(lastComplaint);

    return {
      scenario: "dairy_coldchain",
      batchId,
      product: "Full-cream milk",
      complaintsGenerated: createdComplaints.length,
      affectedRegions: ["Mumbai Suburban", "Thane", "Pune"],
      excursionTemp: "12.4 °C",
    };
  }

  if (scenarioType === "beverage_microbial") {
    // SCENARIO 2: Beverage Microbial & Preservative Outbreak
    const batchId = `BEV-SYNTH-${Date.now().toString().slice(-4)}`;
    const lot = `B-MB-${Math.floor(1000 + Math.random() * 9000)}`;
    const prodId = "PRD-BEV-OJ";

    await Batch.create({
      _id: batchId,
      product_id: prodId,
      lot_number: lot,
      lot_key: lot.toUpperCase(),
      quantity: "12,000 Bottles",
      manufactured_on: agoIso(7).slice(0, 10),
      expires_on: agoIso(-60).slice(0, 10),
      facility: "Orchard Beverages Plant, Pune",
      temperature_c: 18.0,
      destination_place: "Nagpur Central Logistics",
      destination_lat: 21.1458,
      destination_lng: 79.0882,
      created_at: agoIso(7, 6, 0),
      is_demo: true,
    });

    const hops = [
      {stage: "Raw material supplier", place: "Citrus Growers Co-op", role: "supplier", lat: 21.15, lng: 79.09, region: "Nagpur", daysAgo: 7, time: "08:00", qs: 95, readings: {brix: 11.2, ph: 3.8}},
      {stage: "Manufacturing", place: "Orchard Beverages Plant", role: "manufacturer", lat: 18.5204, lng: 73.8567, region: "Pune", daysAgo: 6, time: "11:00", qs: 87, readings: {brix: 10.5, ph: 3.2, preservative: 80, yeast_mould: "Detected"}, notes: "Bottling tank 3 had seal micro-leakage."},
      {stage: "Warehouse", place: "Pune Regional Hub", role: "storage", lat: 18.53, lng: 73.86, region: "Pune", daysAgo: 5, time: "15:00", qs: 85, readings: {brix: 10.4, ph: 3.1, preservative: 75, yeast_mould: "Detected"}},
      {stage: "Distribution", place: "Nagpur Central Logistics", role: "distributor", lat: 21.1458, lng: 79.0882, region: "Nagpur", daysAgo: 4, time: "10:00", qs: 80},
      {stage: "Distribution", place: "Chhatrapati Sambhajinagar Depot", role: "distributor", lat: 19.8762, lng: 75.3433, region: "Chhatrapati Sambhajinagar", daysAgo: 3, time: "14:00", qs: 78},
    ];

    for (const h of hops) {
      await SupplyRecord.create({
        batch_id: batchId,
        stage: h.stage,
        party_name: h.place,
        party_role: h.role,
        lat: h.lat,
        lng: h.lng,
        region: h.region,
        occurred_at: agoIso(h.daysAgo, ...h.time.split(":").map(Number)),
        readings: h.readings,
        notes: h.notes,
        quality_score: h.qs,
        source: "synthetic-generator",
      });
    }

    const complaintSpecs = [
      {region: "Nagpur", count: 14, texts: ["Drink tasted fermented and was fizzing when opened.", "Bottle was bloated and smelled like alcohol.", "Very sharp chemical and sour taste."]},
      {region: "Chhatrapati Sambhajinagar", count: 11, texts: ["Sour and fizzy orange drink, had white floaters.", "Unpleasant taste and smell; cap puffed up."]},
      {region: "Pune", count: 8, texts: ["Felt nauseous after drinking half bottle; tasted fizzy and strange."]},
    ];

    let seq = Math.floor(6000 + Math.random() * 3000);
    const createdComplaints = [];

    for (const spec of complaintSpecs) {
      const reg = regionByName(spec.region);
      for (let i = 0; i < spec.count; i++) {
        const jitterLat = (reg?.lat || 20.0) + (Math.random() - 0.5) * 0.08;
        const jitterLng = (reg?.lng || 77.0) + (Math.random() - 0.5) * 0.08;
        const text = spec.texts[i % spec.texts.length];
        const c = await Complaint.create({
          _id: `C-SYNTH-${++seq}`,
          tracking_code: makeCode(),
          batch_id: batchId,
          product_id: prodId,
          submitted_identifier: batchId,
          identifier_source: "manual",
          description: text,
          lang: "en",
          region: spec.region,
          lat: +jitterLat.toFixed(4),
          lng: +jitterLng.toFixed(4),
          created_at: agoIso(Math.min(3, Math.floor(Math.random() * 4)), Math.floor(9 + Math.random() * 9), Math.floor(Math.random() * 59)),
          is_demo: true,
        });
        createdComplaints.push(c);
      }
    }

    await onComplaintCreated(createdComplaints[createdComplaints.length - 1]);

    // Submit laboratory confirmation
    const labUser = await User.findOne({role: "lab"}).lean();
    if (labUser) {
      const sr = await SampleRequest.findOne({batch_id: batchId}).lean();
      if (sr) {
        await submitLabReport(
          {...labUser, id: String(labUser._id)},
          {
            sampleRequestId: sr._id,
            batchId,
            accreditationRef: labUser.accreditation_ref || "NABL-SYNTH-001",
            outcome: "confirmed",
            contaminationType: "Microbial contamination or spoilage",
            severity: "critical",
            results: {ph: 3.1, brix: 10.4, preservative: 75, yeast_mould: "Detected"},
            notes: "Synthetic scenario: high yeast and mould colony count confirmed.",
          },
          mockPdf()
        );
      }
    }

    return {
      scenario: "beverage_microbial",
      batchId,
      product: "Orange fruit drink 200 ml",
      complaintsGenerated: createdComplaints.length,
      affectedRegions: ["Nagpur", "Chhatrapati Sambhajinagar", "Pune"],
      labOutcome: "confirmed",
    };
  }

  throw new Error(`Unknown scenario "${scenarioType}". Use "dairy_coldchain" or "beverage_microbial".`);
}

export async function clearSyntheticScenarios() {
  const syntheticBatches = (await Batch.find({_id: /^MILK-SYNTH|^BEV-SYNTH/}).select("_id").lean()).map(b => b._id);
  if (!syntheticBatches.length) return {cleared: 0};

  await Promise.all([
    Batch.deleteMany({_id: {$in: syntheticBatches}}),
    SupplyRecord.deleteMany({batch_id: {$in: syntheticBatches}}),
    Complaint.deleteMany({batch_id: {$in: syntheticBatches}}),
    Investigation.deleteMany({batch_id: {$in: syntheticBatches}}),
    SampleRequest.deleteMany({batch_id: {$in: syntheticBatches}}),
  ]);

  return {cleared: syntheticBatches.length, batchIds: syntheticBatches};
}
