// FSSAI submission adapter abstraction.
//
// An adapter implements: async submit(report, {attempt, simulate}) -> {externalRef}   (throws on failure)
// The only adapter is the simulator below. NOTHING is ever transmitted to FSSAI; every result is labelled simulated.
import {config} from "../../config.js";

export class SubmissionError extends Error {}

export const mockFssai = {
  name: "mock-fssai", simulated: true,
  description: "Simulated FSSAI submission channel. Reports are NOT transmitted to FSSAI.",
  async submit(report, {attempt, simulate} = {}) {
    const mode = (config.allowSimulation && simulate) || config.mockFssaiMode;
    if (mode === "fail" || (mode === "flaky" && attempt === 1)) throw new SubmissionError("Simulated FSSAI channel failure (mock mode). The report was not sent; you can retry.");
    return {externalRef: `SIM-${report.id}-${attempt}`};
  },
};
export function getFssaiAdapter() {
  if (config.fssaiAdapter === "mock") return mockFssai;
  throw new Error(`FSSAI_ADAPTER="${config.fssaiAdapter}" is not implemented. Only "mock" exists; add an adapter in providers/fssai/.`);
}
export const adapterStatus = () => { const a = getFssaiAdapter(); return {name: a.name, simulated: a.simulated, description: a.description, mode: config.mockFssaiMode}; };
