// URL slug for a person on the public website (/coaches/<slug>):
// lowercase, accents stripped, anything else non-alphanumeric → '-', dashes
// collapsed and trimmed. 'Mia De la Rosa' → 'mia-de-la-rosa'.
// Pure (no Node APIs): api/site-data.js, scripts/seed-site-staff.mjs and the
// HQ Website screen all use it, so a slug is the same everywhere.
// Team slugs are different on purpose — slugOf() in api/hub-data.js, which
// /hub?team= already uses ('14 Diamond' → '14-diamond').
export const personSlug = (name) => String(name || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
