/**
 * DS Elite — SportsYou → app ingester (Google Apps Script)
 * Runs inside the sportsyou@dselitevolleyball.com Google account.
 * No App Password, no IMAP, no admin settings — Google runs it as you.
 *
 * SETUP (one time):
 *   1. Go to https://script.google.com  (signed in as sportsyou@dselitevolleyball.com).
 *   2. New project → delete the sample code → paste this whole file → Save (disk icon).
 *   3. In the function dropdown pick `installTrigger` → click Run.
 *   4. Approve the permission prompts (it needs Gmail read/modify + external requests).
 *      If you see "Google hasn't verified this app," click Advanced → "Go to <project> (unsafe)"
 *      — it's your own script, that's expected.
 *   5. Done. It runs every 15 minutes, and also ran once just now.
 *
 * To check it's working: Executions (left sidebar, clock icon) shows each run;
 * View → Logs shows "posted=N".
 */

// The DS Elite app's inbound endpoint + shared secret (matches SPORTSYOU_INBOX_TOKEN in Vercel).
const WEBHOOK_URL   = 'https://dseliteevals.vercel.app/api/sportsyou-inbox';
const INBOX_TOKEN   = '1BtMOz0LuvXJlUZqsdLRqRaFuSlPjsED';

// Which emails to ingest, and how many per run. Already-ingested emails get a
// label so they're skipped next time; the app also de-dupes as a safety net.
const SEARCH_QUERY    = 'from:sportsyou.com -label:SportsYou-Ingested newer_than:30d';
const INGESTED_LABEL  = 'SportsYou-Ingested';
const MAX_PER_RUN     = 40;

function pollSportsYou() {
  const label = GmailApp.getUserLabelByName(INGESTED_LABEL) || GmailApp.createLabel(INGESTED_LABEL);
  const threads = GmailApp.search(SEARCH_QUERY, 0, MAX_PER_RUN);
  let posted = 0, failed = 0;

  for (const thread of threads) {
    let allOk = true;
    for (const m of thread.getMessages()) {
      const payload = {
        from: m.getFrom(),
        subject: m.getSubject(),
        text: m.getPlainBody(),
        date: m.getDate().toISOString(),
        messageId: m.getId(),
      };
      try {
        const res = UrlFetchApp.fetch(WEBHOOK_URL + '?token=' + encodeURIComponent(INBOX_TOKEN), {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify(payload),
          muteHttpExceptions: true,
        });
        if (res.getResponseCode() === 200) {
          posted++;
        } else {
          failed++; allOk = false;
          Logger.log('POST failed (%s): %s', res.getResponseCode(), res.getContentText());
        }
      } catch (e) {
        failed++; allOk = false;
        Logger.log('POST error: %s', e.message);
      }
    }
    // Label the thread only if every message in it posted OK, so failures retry next run.
    if (allOk) thread.addLabel(label);
  }
  Logger.log('SportsYou ingest: posted=%s failed=%s', posted, failed);
}

function installTrigger() {
  // Clear any old triggers for this handler, then create a fresh 15-minute one.
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'pollSportsYou')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('pollSportsYou').timeBased().everyMinutes(15).create();
  pollSportsYou(); // run once immediately so you see results now
}
