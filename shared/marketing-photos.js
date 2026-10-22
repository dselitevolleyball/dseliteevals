// The photo library's vocabulary - one list for the AI librarian
// (api/_lib/marketing-photos-ai.js), the marketing machine's photo picker
// (api/_lib/marketing-ai.js) and HQ's Photos tab (src/dssc/DsscMarketingLibrary.jsx).
//
// Tags: the first ten are the website's photos.json tags (the copy writer may
// ask for those); the rest describe what's in the frame so a director can
// search "basketball game action teens".

export const PHOTO_TAGS_CORE = ["volleyball", "basketball", "reach", "kids", "camp", "parties", "facility", "people", "flagship", "community"];
export const PHOTO_TAGS_MORE = ["action", "training", "game", "team", "coach", "celebration", "small_kids", "teens", "adults", "girls", "boys", "group", "close_up", "wide_shot", "candid", "posed"];
export const PHOTO_TAGS_ALL = [...PHOTO_TAGS_CORE, ...PHOTO_TAGS_MORE];

export const PHOTO_USES = ["social_post", "story", "email_banner", "website_hero", "program_card"];
export const USE_LABEL = { social_post: "Social post", story: "Story", email_banner: "Email banner", website_hero: "Website hero", program_card: "Program card" };
export const PEOPLE = ["none", "kids", "teens", "adults", "mixed"];
export const PEOPLE_LABEL = { none: "No people", kids: "Kids", teens: "Teens", adults: "Adults", mixed: "Mixed ages" };
export const SETTINGS = ["court", "gym", "party_room", "outdoor", "facility", "event", "other"];
export const SETTING_LABEL = { court: "On the court", gym: "Training floor", party_room: "Party", outdoor: "Outdoors", facility: "Building", event: "Event", other: "Other" };
export const tagLabel = (t) => String(t || "").replace(/_/g, " ");

// "IMG_4821", "DSC00012", "photo-1700000000" - an alt text nobody wrote.
export const looksLikeFilename = (s) => !String(s || "").trim() || /^(img|dsc|dcim|pxl|photo|image|screenshot)[\s_-]*\d/i.test(String(s).trim()) || /^\d[\d\s_-]{5,}$/.test(String(s).trim());

export const orientationOf = (p) => !p?.width || !p?.height ? null : p.height > p.width * 1.1 ? "portrait" : p.width > p.height * 1.1 ? "landscape" : "square";

// Every word a search box should match for a photo.
export const photoHaystack = (p, lineLabel = (x) => x) => [
  p.description, p.alt, p.filename, lineLabel(p.line), p.line, ...(p.tags || []).map(tagLabel), PEOPLE_LABEL[p.people], SETTING_LABEL[p.setting],
  ...(p.uses || []).map(u => USE_LABEL[u]), orientationOf(p), p.source,
].filter(Boolean).join(" ").toLowerCase();
