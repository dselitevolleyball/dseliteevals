// Instagram's media_publish, tried again when Instagram says the container
// isn't ready yet ("Media ID is not available") - which it can say even after
// the container reports FINISHED (Oct 30 2026, DSSC's "Tiny Hitters, Big
// Fun"). Used by DSSC Marketing (marketing-publish.js) and DS Elite Social
// (dse-social-meta.js).
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export async function igPublish(fn, { waits = [4000, 8000, 12000] } = {}) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) { if (i >= waits.length || !/not available|not ready|9007|2207027/i.test(e.message)) throw e; await sleep(waits[i]); }
  }
}
