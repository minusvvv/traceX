// Single place for API configuration and error handling. There is deliberately NO mock fallback:
// when a request fails, callers receive an ApiError and the UI shows it.
// One browser origin for JSON, cookies, photos and downloads. Vite's dev proxy
// and the production reverse proxy both forward this exact prefix.
const BASE = "/api";
export const apiUrl = path => BASE + path;

export class ApiError extends Error {
  constructor(status, message, data) {
    const fieldMsg = data?.fields && Object.values(data.fields).filter(Boolean).join(". ");
    super(fieldMsg || message);
    this.status = status;
    this.data = data || null;
    this.fields = data?.fields || {};
    this.code = data?.code;
  }
}

export async function request(path, {method = "GET", body, form, headers = {}} = {}) {
  const h = {"X-TraceX-Client": "web", ...headers};
  let payload;
  if (form) payload = form; else if (body !== undefined) { h["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  let res;
  try { res = await fetch(BASE + path, {method, headers: h, body: payload, credentials: "include"}); }
  catch { throw new ApiError(0, "Cannot reach the TraceX server. Check your connection and that the API is running."); }
  let data;
  try { data = await res.json(); }
  catch {
    // A proxy returning HTML must not look like a successful, empty API response.
    throw new ApiError(res.ok ? 502 : res.status, "The TraceX service returned an unexpected response. Please try again.", {code: "INVALID_API_RESPONSE"});
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/login")) window.dispatchEvent(new Event("tracex:unauthorized"));
    throw new ApiError(res.status, data?.error || `Request failed (${res.status}).`, data);
  }
  return data;
}
export const qs = o => { const p = new URLSearchParams(); Object.entries(o || {}).forEach(([k, v]) => v !== undefined && v !== null && v !== "" && p.set(k, v)); const s = p.toString(); return s ? "?" + s : ""; };
