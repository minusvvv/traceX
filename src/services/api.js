// Service layer: every function calls the Express API. Names that existed before (getBatches, getBatchById, getInvestigations, ...) are kept.
import {request, qs, apiUrl} from "./http.js";
export {ApiError} from "./http.js";

// public data; complaint submission requires a signed-in consumer
let metaPromise;
export const getMeta = () => (metaPromise ||= request("/public/meta").catch(e => { metaPromise = null; throw e; }));
export const getPublicBatch = id => request("/public/batches/" + encodeURIComponent(id));
export const getShowcase = () => request("/public/showcase");
export const submitComplaint = (form, key) => request("/public/complaints", {method: "POST", form, headers: {"Idempotency-Key": key}});
export const getComplaintStatus = code => request("/public/complaints/" + encodeURIComponent(code));
export const getPublicHeatmap = f => request("/public/heatmap" + qs(f));

// session
export const login = (email, password) => request("/auth/login", {method: "POST", body: {email, password}});
export const consumerLogin = (email, password) => request("/auth/consumer-login", {method: "POST", body: {email, password}});
export const registerConsumer = body => request("/auth/register", {method: "POST", body});
export const logout = () => request("/auth/logout", {method: "POST", body: {}});
export const getSession = () => request("/auth/me");

// staff
export const getBatches = category => request("/batches" + qs({category}));
export const getBatchById = id => request("/batches/" + encodeURIComponent(id)).catch(e => { if (e.status === 404) return null; throw e; });
export const getBatchLabReports = id => request(`/batches/${encodeURIComponent(id)}/lab-reports`);
export const getDashboard = () => request("/dashboard");
export const getPrioritization = () => request("/prioritization");
export const getComplaints = f => request("/complaints" + qs(f));
export const getAnalytics = f => request("/analytics" + qs(f));
export const getHotspots = f => request("/analytics/hotspots" + qs(f));
export const getInvestigations = f => request("/investigations" + qs(f));
export const getInvestigationById = id => request("/investigations/" + id).catch(e => { if (e.status === 404) return null; throw e; });
export const runTraceability = (id, simulate) => request(`/investigations/${id}/traceability`, {method: "POST", body: {simulate}});
export const generateReport = id => request(`/investigations/${id}/report`, {method: "POST", body: {}});
export const submitReport = (rid, simulate) => request(`/reports/${rid}/submit`, {method: "POST", body: {simulate}});
export const acknowledgeReport = rid => request(`/reports/${rid}/acknowledge`, {method: "POST", body: {}});
export const reportExportUrl = (rid, format) => apiUrl(`/reports/${rid}/export?format=${format}`);
export const attachmentUrl = id => apiUrl("/attachments/" + id);
export const recordDecision = (id, body) => request(`/investigations/${id}/decision`, {method: "POST", body});
export const closeInvestigation = (id, reason) => request(`/investigations/${id}/close`, {method: "POST", body: {reason}});
export const requestSample = (id, body = {}) => request(`/investigations/${id}/sample-request`, {method: "POST", body});

// laboratory
export const getSampleRequests = status => request("/lab/sample-requests" + qs({status}));
export const getSampleRequest = id => request("/lab/sample-requests/" + id);
export const getLaboratoryReports = () => request("/lab/reports");
export const submitLabReport = form => request("/lab/reports", {method: "POST", form});

// administration
export const getUsers = () => request("/admin/users");
export const createUser = body => request("/admin/users", {method: "POST", body});
export const patchUser = (id, body) => request("/admin/users/" + id, {method: "PATCH", body});
export const getThresholds = () => request("/admin/thresholds");
export const setThreshold = (scope, body) => request("/admin/thresholds/" + scope, {method: "PUT", body});
export const removeThreshold = scope => request("/admin/thresholds/" + scope, {method: "DELETE"});
export const getIntegrations = () => request("/admin/integrations");
export const getAudit = f => request("/admin/audit" + qs(f));

// external supply-chain data provider
export const postProviderRecords = (batchId, records) => request(`/provider/supply-chain/${encodeURIComponent(batchId)}/records`, {method: "POST", body: {records}});
