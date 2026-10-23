// The tests staff added in HQ (stat_metrics, Reach Stats → Tests) joined to the
// shared METRICS list in the browser, once per page load, before any testing
// screen works its numbers out (shared/stat-report.js setCustomMetrics).
import { supabase } from "./supabase";
import { setCustomMetrics } from "../shared/stat-report.js";

let pending = null;
export function loadStatMetrics({ fresh = false } = {}) {
  if (!pending || fresh) pending = supabase.from("stat_metrics").select("*").order("sort").order("label")
    .then(({ data, error }) => { const defs = error ? [] : (data || []); setCustomMetrics(defs); return defs; });
  return pending;
}
