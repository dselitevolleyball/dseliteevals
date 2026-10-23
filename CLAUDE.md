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
