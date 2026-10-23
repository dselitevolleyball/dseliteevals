// The tests staff added in HQ (stat_metrics), joined to the shared METRICS list
// (shared/stat-report.js setCustomMetrics) before any stats are worked out.
// A missing table (migration not run yet) just means no extra tests.
import { setCustomMetrics } from "../../shared/stat-report.js";

export async function loadCustomMetrics(sb) {
  const { data, error } = await sb.from("stat_metrics").select("*").order("sort").order("label");
  const defs = error ? [] : (data || []);
  setCustomMetrics(defs);
  return defs;
}
