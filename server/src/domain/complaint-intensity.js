export const complaintSeverity = reports => {
  if (reports >= 10) return "critical";
  if (reports >= 5) return "suspicious";
  if (reports >= 3) return "review";
  return "safe";
};
