// Supply-chain data provider abstraction.
//
// A provider implements:   async fetchChain(batchId, {simulate}) -> {records, complete, warnings}
// where each record is {stage, party, role, place, lat, lng, region, at, source}.
// Only the "mock" provider exists. It reads TraceX's own demonstration records and presents them through the same
// interface a real external provider would use, so a real provider can be added here without touching the services.
import {config} from "../../config.js";
import {SupplyRecord} from "../../db.js";
import {loadBatch} from "../../domain/batches.js";

export class ProviderUnavailableError extends Error {}

export const mockProvider = {
  name: "mock-supply-chain", mock: true,
  description: "Simulated provider backed by TraceX demonstration records. Not a real external system.",
  async fetchChain(batchId, {simulate} = {}) {
    const mode = (config.allowSimulation && simulate) || config.mockSupplyChainMode;
    if (mode === "unavailable") throw new ProviderUnavailableError("Simulated provider outage (mock mode: unavailable)");
    const batch = await loadBatch(batchId);
    if (!batch) throw new ProviderUnavailableError(`Provider has no record of batch ${batchId}`);
    let records = batch.route.filter(r => r.kind !== "testing").map(r => ({stage: r.stage, kind: r.kind, side: r.side, party: r.place, role: r.role, place: r.place, lat: r.lat, lng: r.lng, region: r.region, at: r.time, source: r.source}));
    const warnings = [];
    let complete = true;
    if (mode === "partial") {
      const kept = records.filter(r => r.side !== "downstream" || !/retail/i.test(r.stage));
      if (kept.length < records.length) { warnings.push("Provider returned incomplete downstream data: retailer records were not supplied (simulated partial response)."); complete = false; }
      records = kept;
    }
    return {records, complete, warnings};
  },
};

export function getSupplyChainProvider() {
  if (config.supplyChainProvider === "mock") return mockProvider;
  throw new Error(`SUPPLY_CHAIN_PROVIDER="${config.supplyChainProvider}" is not implemented. Only "mock" exists; add a provider in providers/supplyChain/.`);
}
export const providerStatus = async () => {
  const p = getSupplyChainProvider();
  return {name: p.name, mock: p.mock, description: p.description, mode: config.mockSupplyChainMode, records: await SupplyRecord.countDocuments()};
};
