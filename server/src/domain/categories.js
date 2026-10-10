// Product categories: the single place where category-specific behaviour lives.
// Stages, laboratory tests and contamination types are data, so adding a category means adding an entry here
// (no other module assumes dairy). `mfg: true` marks the manufacturer stage used to split backward/forward tracing.
//
// Tests: type "number" has plausibility bounds (min/max) and an optional `anomaly` rule used to spot a change between
// consecutive supply-chain readings ({drop:n} or {rise:n}); type "enum" lists `options` and the `flag` values that
// count as a deviation. Bounds are input-sanity limits only, not regulatory limits.
const S = (name, kind, extra = {}) => ({name, kind, ...extra});
const NEG = ["Negative", "Suspected", "Positive"];
const ND = ["Not detected", "Detected"];
const ABS = ["Absent", "Present"];

export const CATEGORIES = {
  dairy: {
    label: "Dairy products", coldChain: true,
    stages: [S("Farm", "source"), S("Collection", "intake"), S("Testing", "testing", {map: false}), S("Transport", "transport"),
      S("Manufacturing", "processing", {mfg: true}), S("Distribution", "distribution"), S("Retail", "retail")],
    tests: [
      {code: "fat", label: "Fat", unit: "%", type: "number", min: 0, max: 20, anomaly: {drop: 0.5}},
      {code: "snf", label: "SNF", unit: "%", type: "number", min: 0, max: 15, anomaly: {drop: 0.5}},
      {code: "water", label: "Water adulteration", type: "enum", options: NEG, flag: ["Suspected", "Positive"]},
      {code: "urea", label: "Urea", type: "enum", options: ["Negative", "Positive"], flag: ["Positive"]},
    ],
    contaminationTypes: ["Water adulteration", "Chemical adulterant", "Microbial contamination", "Antibiotic residue", "Other"],
  },
  beverage: {
    label: "Packaged beverages", coldChain: true,
    stages: [S("Raw material supplier", "source"), S("Manufacturing", "processing", {mfg: true}), S("Testing", "testing", {map: false}),
      S("Warehouse", "storage"), S("Distribution", "distribution"), S("Retail", "retail")],
    tests: [
      {code: "ph", label: "pH", type: "number", min: 0, max: 14, anomaly: {drop: 0.5}},
      {code: "brix", label: "Brix", unit: "°Bx", type: "number", min: 0, max: 60, anomaly: {drop: 1}},
      {code: "preservative", label: "Preservative", unit: "ppm", type: "number", min: 0, max: 5000, anomaly: {rise: 100}},
      {code: "yeast_mould", label: "Yeast & mould", type: "enum", options: ND, flag: ["Detected"]},
    ],
    contaminationTypes: ["Microbial contamination or spoilage", "Chemical contaminant", "Preservative non-compliance", "Foreign matter", "Other"],
  },
  edible_oil: {
    label: "Edible oils", coldChain: false,
    stages: [S("Raw material supplier", "source"), S("Intake", "intake"), S("Testing", "testing", {map: false}),
      S("Refining", "processing", {mfg: true}), S("Packaging", "packaging"), S("Warehouse", "storage"), S("Distribution", "distribution"), S("Retail", "retail")],
    tests: [
      {code: "peroxide_value", label: "Peroxide value", unit: "meq/kg", type: "number", min: 0, max: 100, anomaly: {rise: 5}},
      {code: "acid_value", label: "Acid value", unit: "mg KOH/g", type: "number", min: 0, max: 30, anomaly: {rise: 1}},
      {code: "moisture", label: "Moisture", unit: "%", type: "number", min: 0, max: 5, anomaly: {rise: 0.2}},
      {code: "adulterant", label: "Foreign oil / adulterant", type: "enum", options: ND, flag: ["Detected"]},
    ],
    contaminationTypes: ["Adulteration with foreign or mineral oil", "Rancidity", "Chemical contaminant", "Foreign matter", "Other"],
  },
  snack: {
    label: "Packaged snacks", coldChain: false,
    stages: [S("Raw material supplier", "source"), S("Manufacturing", "processing", {mfg: true}), S("Testing", "testing", {map: false}),
      S("Packaging", "packaging"), S("Warehouse", "storage"), S("Distribution", "distribution"), S("Retail", "retail")],
    tests: [
      {code: "moisture", label: "Moisture", unit: "%", type: "number", min: 0, max: 20, anomaly: {rise: 1}},
      {code: "peroxide_value", label: "Peroxide value", unit: "meq/kg", type: "number", min: 0, max: 100, anomaly: {rise: 5}},
      {code: "foreign_matter", label: "Foreign matter", type: "enum", options: ABS, flag: ["Present"]},
      {code: "salmonella", label: "Salmonella", type: "enum", options: ND, flag: ["Detected"]},
    ],
    contaminationTypes: ["Foreign matter", "Rancidity", "Microbial contamination", "Allergen mislabelling", "Other"],
  },
  grain: {
    label: "Grains and cereals", coldChain: false,
    stages: [S("Farm or procurement", "source"), S("Storage silo", "intake"), S("Testing", "testing", {map: false}),
      S("Milling", "processing", {mfg: true}), S("Packaging", "packaging"), S("Warehouse", "storage"), S("Distribution", "distribution"), S("Retail", "retail")],
    tests: [
      {code: "moisture", label: "Moisture", unit: "%", type: "number", min: 0, max: 30, anomaly: {rise: 1}},
      {code: "aflatoxin_b1", label: "Aflatoxin B1", unit: "µg/kg", type: "number", min: 0, max: 1000, anomaly: {rise: 5}},
      {code: "insect_damage", label: "Insect damage", unit: "%", type: "number", min: 0, max: 100, anomaly: {rise: 1}},
      {code: "foreign_matter", label: "Foreign matter", type: "enum", options: ABS, flag: ["Present"]},
    ],
    contaminationTypes: ["Mycotoxin (aflatoxin)", "Pesticide residue", "Insect infestation", "Foreign matter", "Other"],
  },
  other: {
    label: "Other packaged food", coldChain: false,
    stages: [S("Supplier", "source"), S("Manufacturing", "processing", {mfg: true}), S("Testing", "testing", {map: false}),
      S("Warehouse", "storage"), S("Distribution", "distribution"), S("Retail", "retail")],
    tests: [
      {code: "microbial", label: "Microbial screen", type: "enum", options: ND, flag: ["Detected"]},
      {code: "foreign_matter", label: "Foreign matter", type: "enum", options: ABS, flag: ["Present"]},
      {code: "chemical", label: "Chemical contaminant", type: "enum", options: ND, flag: ["Detected"]},
    ],
    contaminationTypes: ["Microbial contamination", "Chemical contaminant", "Foreign matter", "Other"],
  },
};

export const categoryKeys = Object.keys(CATEGORIES);
export const getCategory = key => CATEGORIES[key] || CATEGORIES.other;
export const mfgIndex = key => Math.max(0, getCategory(key).stages.findIndex(s => s.mfg));
export const stageIndex = (key, stage) => getCategory(key).stages.findIndex(s => s.name === stage);

// Public description for the client (labels, stage lists, test definitions).
export const categoryMeta = () => Object.fromEntries(Object.entries(CATEGORIES).map(([k, c]) => [k, {
  key: k, label: c.label, coldChain: c.coldChain, stages: c.stages, tests: c.tests, contaminationTypes: c.contaminationTypes,
}]));

// Compare consecutive readings along a batch's route and report the first meaningful change.
// Works for any category because the rules come from that category's test definitions.
export function detectAnomaly(categoryKey, route) {
  const cat = getCategory(categoryKey), w = route.filter(r => r.readings && Object.keys(r.readings).length);
  for (let i = 1; i < w.length; i++) {
    const a = w[i - 1].readings, b = w[i].readings, tests = [];
    for (const t of cat.tests) {
      if (a[t.code] == null || b[t.code] == null) continue;
      if (t.type === "number" && t.anomaly) {
        const d = b[t.code] - a[t.code];
        if ((t.anomaly.drop && -d >= t.anomaly.drop) || (t.anomaly.rise && d >= t.anomaly.rise)) tests.push(t.code);
      } else if (t.type === "enum" && t.flag?.includes(b[t.code]) && !t.flag.includes(a[t.code])) tests.push(t.code);
    }
    if (tests.length) return {from: w[i - 1].stage, to: w[i].stage, flagged: w[i].stage, tests};
  }
  return null;
}

// Validate a {code: value} result set against a category's tests. Returns {clean, errors}.
export function validateResults(categoryKey, results) {
  const cat = getCategory(categoryKey), clean = {}, errors = {};
  for (const [code, raw] of Object.entries(results || {})) {
    const t = cat.tests.find(x => x.code === code);
    if (!t) { errors[code] = "Not a recognised test for this product category"; continue; }
    if (raw === "" || raw == null) continue;
    if (t.type === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n)) errors[code] = "Must be a number";
      else if (n < t.min || n > t.max) errors[code] = `Must be between ${t.min} and ${t.max}`;
      else clean[code] = n;
    } else if (!t.options.includes(raw)) errors[code] = `Must be one of: ${t.options.join(", ")}`;
    else clean[code] = raw;
  }
  return {clean, errors};
}
