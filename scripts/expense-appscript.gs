/**
 * DS Elite — forward receipt emails into HQ as draft expenses.
 *
 * Paste into script.google.com under the Gmail account that receives receipts
 * (drew@dselitevolleyball.com), set TOKEN below, then add a time-driven trigger
 * on captureReceipts — hourly is plenty.
 *
 * What it does: searches for receipt-shaped mail, POSTs each message to
 * /api/expense-inbox, and labels it so it's never sent twice. Everything lands
 * in HQ as PENDING — nothing counts toward the finance totals until approved,
 * so a bad match here costs a click, not a wrong number.
 *
 * Tune SEARCH rather than the parser: it's cheaper to be broad here and reject
 * in review than to miss spend entirely.
 */

var ENDPOINT = 'https://dseliteevals.vercel.app/api/expense-inbox';
var TOKEN    = 'PASTE_EXPENSE_INBOX_TOKEN_HERE';   // must match Vercel's EXPENSE_INBOX_TOKEN
var LABEL    = 'HQ-Expensed';
var MAX_PER_RUN = 25;

var SEARCH = [
  '-label:' + LABEL,
  '-subject:(Re: OR Fwd:)',
  'newer_than:30d',
  '(',
    'subject:(receipt OR invoice OR "order confirmation" OR "payment" OR "purchase" OR "itinerary" OR "confirmation")',
    ' OR from:(sportwrench.com OR advancedeventsystems.com OR usavolleyball.org)',
    ' OR from:(marriott.com OR hilton.com OR hyatt.com OR ihg.com OR booking.com OR expedia.com)',
    ' OR from:(southwest.com OR aa.com OR delta.com OR united.com)',
    ' OR from:(amazon.com OR customink.com OR stickermule.com OR intuit.com OR hudl.com)',
  ')'
].join(' ');

function captureReceipts() {
  var label = GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
  var threads = GmailApp.search(SEARCH, 0, MAX_PER_RUN);
  var sent = 0, skipped = 0, failed = 0;

  for (var t = 0; t < threads.length; t++) {
    // ONE message per thread. A chased invoice or a failed-payment notice runs
    // to nine replies, each quoting the same amount — posting every message
    // booked the same spend nine times. The first message is the original
    // receipt; the rest are conversation about it.
    var msgs = [threads[t].getMessages()[0]];
    for (var m = 0; m < msgs.length; m++) {
      var msg = msgs[m];
      var payload = {
        messageId: msg.getId(),
        from: msg.getFrom(),
        subject: msg.getSubject(),
        text: msg.getPlainBody().slice(0, 20000),
        date: msg.getDate().toISOString()
      };
      try {
        var res = UrlFetchApp.fetch(ENDPOINT + '?token=' + encodeURIComponent(TOKEN), {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        });
        var code = res.getResponseCode();
        if (code >= 200 && code < 300) {
          var body = JSON.parse(res.getContentText() || '{}');
          if (body.skipped) skipped++; else sent++;
        } else {
          failed++;
          Logger.log('HTTP ' + code + ' for "' + payload.subject + '": ' + res.getContentText().slice(0, 200));
          continue;  // leave unlabelled so the next run retries it
        }
      } catch (e) {
        failed++;
        Logger.log('Error on "' + payload.subject + '": ' + e);
        continue;    // ditto — a network blip shouldn't lose a receipt
      }
    }
    threads[t].addLabel(label);
  }
  Logger.log('captured ' + sent + ', skipped ' + skipped + ', failed ' + failed + ' (of ' + threads.length + ' threads)');
}
