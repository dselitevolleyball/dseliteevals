# Notes for Claude

## Team names in messages

There is only one Rise team per age, so in anything families or coaches read
(emails, texts, SportsYou posts, forms), call them **11 Rise**, **12 Rise**
and **13 Rise**, not "11 Rise 1" (Drew, Oct 23 2026).

The data keeps the "1" ("12 Rise 1" in `players.team_assignment`,
`practice_teams`, `sportsyou_outbox.team_name`, the calendar feed's `?team=`
and the SportsYou join codes). Don't rename it there, since SportsYou calendar
subscriptions and post routing match on it. Change only the words people see,
for example `team.replace(/^(\d+ Rise) 1$/, "$1")`.

## Building names

Since Oct 26 2026 the buildings are **Warehouse I** (Courts 1-4, 15113 Fitzhugh
Rd, Suite 1400, Dripping Springs, TX) and **Warehouse II** (Courts 5-6, 15113
Fitzhugh Rd, Bldg 400, Austin, TX 78736), which used to be called "the Flex".
Say Warehouse I / Warehouse II in anything people read. Playbook and the data
still say "flex" (`venue = 'flex'`, "DSSC Flex" in rentals), so keep parsing
that. The 2027 court planner (src/dssc/DsscPlanner.jsx) has its own separate
one-court "Flex"; leave it.
