import { createClient } from "@supabase/supabase-js";
import fs from "fs";
for (const l of fs.readFileSync(".env","utf8").split(/\r?\n/)) { const m=/^([A-Z_]+)=(.*)$/.exec(l); if(m) process.env[m[1]]=m[2].replace(/^"|"$/g,""); }
const sb = createClient(process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: c } = await sb.from("coaches").select("id, display_name, email, is_approved, created_at").or("display_name.ilike.%sam%,email.ilike.%sam%,email.ilike.%robinson%");
console.log(JSON.stringify(c));
const tabs = ["coach_time_off","time_off_requests","coach_requests","absence_requests"];
for (const t of tabs) { const { data, error } = await sb.from(t).select("*").limit(200); if (!error) { console.log(t, Object.keys(data[0]||{}).join(",")); for (const r of data) if (JSON.stringify(r).match(/sam r|robinson/i)) console.log(JSON.stringify(r).slice(0,400)); } }
