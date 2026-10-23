# Reach Stats

Coach Brandon (and any DSSC director) records Reach Performance testing in HQ.
Every result feeds the public board at www.drippingsportsclub.com/reach.

## Where it lives

- **DSSC HQ → Reach Performance → Reach Stats** (`view=reachstats`), for DSSC
  directors and the emails in `REACH_COACH_EMAILS` (src/App.jsx).
- **DS Elite app → Reach home → 🏃 Reach Stats** tab, for Reach-only coaches.

## Tabs

- **Test day**: pick a date and a group (Reach athletes, a DS Elite team, or
  everyone), turn tests on or off, type results, and press Save. The grey number
  is the last result. Vertical is worked out from the approach and the latest
  stand & reach. Clearing a box removes that number. After a save, "Check these
  numbers" lists likely typos, using the same rules as Testing Reports.
- **Athletes**: add a Reach athlete who isn't a DS Elite player. If the name
  matches a DS Elite player, the form points to that player instead. You can
  also see each athlete's history, delete a test day, or archive them.
- **Tests**: the built-in tests, plus any tests you add (label, unit, which way
  is better, and whether it's ranked on the board).

## Tests and units

| Key | Test | Unit |
| --- | --- | --- |
| stand_reach | Stand & reach | in |
| approach_touch | Jump approach | in |
| standing_touch | Standing jump | in |
| vertical | Vertical (auto) | in |
| broad_jump | Broad jump | in |
| dash_10y | 10-yard | sec (lower is better) |
| sprint_mph | Sprint speed (top speed) | mph |

Heights accept `8'4`, `8-4`, `8ft 4in`, or `100`. Sprint speed is tracked for
DS Elite too: in the tryout card, team testing links, player cards, Testing
Reports, and the Stats Board.

## Data

The schema is in `migrations/20261028_reach_stats.sql`:

- `reach_athletes` and `reach_athlete_tests` hold Reach athletes and their
  results. There is one row per athlete per date.
- DS Elite results go to `player_stat_tests`, as they always have.
- `stat_metrics` holds the tests added in HQ. Their values live in the `extra`
  jsonb column on test rows.

The code:

- `api/reach-stats.js` is the API, director only.
- `api/leaderboard.js` (`boardData`) merges Reach athletes into the public
  board. It shows first name plus last initial, and only for athletes marked
  public.
- `shared/stat-report.js` defines the metrics, parsing, and typo flags, and
  must stay in step with `public/stats-sheet.js`.

Tests: `node scripts/test-reach-stats.mjs`
