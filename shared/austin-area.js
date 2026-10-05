// Austin-area tournaments. A coach who has two teams and is at an Austin-area
// tournament with one of them still makes the other team's Sunday practice
// (3-5, 5-7 or 7-9pm) — Drew, 5 Oct 2026: "they aren't going to miss their
// practice and we don't need a sub for them". So these never count as the
// coach being away from practice. The TEAM at the tournament still skips its
// own practice when the event is multi-day — that's a separate rule.
export const AUSTIN_AREA = /austin|buda|round rock|pflugerville|cedar park|leander|georgetown|hutto|manor|kyle|san marcos|dripping springs|lakeway|bee cave|wimberley/i;
export const isAustinArea = (t) => !!t && AUSTIN_AREA.test(String(t.location || ""));
