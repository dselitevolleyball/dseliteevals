# Tasks & Projects

DSSC HQ → **Tasks & Projects** (`view=projects`) is where the DSSC team's work is tracked: Jonathan,
Hunter, Adrian, Brandon, and anyone else with a DSSC role. It's built on the earlier Projects screen,
so existing projects and their cards carry over unchanged.

## Tabs

- **Tasks**: every task, whether standalone or a card in a project.
  - **Group by** person, category, department, status, due date, week (a calendar) or project.
  - **Layout**: a board or a list.
  - **Filter** by person, category, department, or a quick filter: overdue, due today, blocked, needs help,
    unassigned or repeating.
  - A task in several departments appears under each one. This is how cross-department work, such as
    program planning, shows up for everyone involved.
  - **Top strip**: open, due today, overdue, blocked, needs help, unassigned, and the 30-day on-time rate.
  - The circle on each task marks it done. The ＋ on a column adds a task there.
- **Projects**: larger one-off items that hold many tasks.
  - Each project has a board and a by-section list, plus a Claude draft from a typed brief.
  - The cards are tasks too, so they also show up in Tasks.
- **Repeating**: daily, weekly and monthly tasks.
  - Each shows when it's next due and how often it was done on time.
  - From here you can edit, pause or stop each one.
- **Scorecard**: by person, category or department, over 7, 30 or 90 days.
  - Shows the on-time %, done, late, missed, average days late, open, overdue, blocked and help.

## A task

- **Fields**: assignee and helpers, due date, priority, category, departments, details and notes, a checklist, files,
  and a comment thread for updates and feedback.
- **Blocked**: asks what it's waiting on, and the blocker shows on the card.
- **Ask for help**: picks one person, or anyone.
  - It emails them (Drew when it's anyone), posts to Slack and flags the task.
  - **Help sorted** clears it.
- **HQ screen**: opens the screen the work happens in, such as Time Cards, Staff Hours, the Clinics & Camps Board,
  the 2027 Planning Calendar, Inbox or Marketing. The list is in `shared/task-meta.js`.
- **Link**: any outside link (a doc, a sheet, a Playbook page).
- **On time** means done by the end of its due date, Central time.

## Repeating tasks

- Each occurrence becomes its own task:
  - **Daily**: on the day.
  - **Weekly**: the coming week's.
  - **Monthly**: two weeks ahead.
- A daily task nobody finishes is closed as **missed** two days later, so old copies don't pile up.
  Weekly and monthly ones stay open until someone deals with them.
- **Skip this one** passes on a single occurrence, and it counts as missed.
- **Editing a repeat** updates the copies that haven't started yet. A new schedule replaces the future ones nobody
  has started.
- **Who can set them**: managers can set repeats for anyone; everyone else can set them for themselves.

## Notifications

- **Slack**: an incoming webhook, set in ⚙ Settings.
  - **What posts**: new tasks, status changes, blockers, assignments, comments, help requests and files, one line each.
  - **@mentions**: add each person's Slack member ID in Settings and posts ping them.
  - **Morning digest**: 7:45am Central, from `api/tasks-daily.js`.
    - Covers each person's tasks due today, overdue (✨ marks newly overdue) and blocked, plus open help requests.
    - The same run makes the repeats and closes missed daily ones.
  - **Monday**: a project check-in, from `api/projects-weekly.js`.
- **Email**:
  - Assigning a task to someone else emails them.
  - A help request emails the person asked.
  - The Monday email lists each person's overdue, due-this-week, blocked and stale tasks.

## Code

| Area | Files |
| --- | --- |
| Data | `migrations/20261106_dssc_tasks.sql`, which extends the Projects tables from `20261014d_dssc_projects.sql` and adds `dssc_task_series` |
| API | `api/projects.js` (all actions), `api/_lib/tasks.js` (repeats, Slack lines, @mentions), `api/tasks-daily.js` (cron, `45 12 * * *`) |
| Shared | `shared/task-recurrence.js` (when repeats fall due), `shared/task-meta.js` (categories, departments, HQ screens, on-time) |
| Screens | `src/dssc/Projects.jsx` (shell, projects, settings), `src/dssc/Tasks.jsx` (views, forms, repeats, scorecard), `src/dssc/taskKit.jsx` (the task window and shared bits) |
| Preview | `npm run dev`, then `/?projectspreview`, with sample data and nothing saved. Set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` to any value. |

Tests: `node scripts/test-task-recurrence.mjs`

## Class Comms

DSSC HQ → Coaches & pay → **Class Comms** (`view=classcomms`, `src/dssc/ClassComms.jsx`) shows whether each
class's families heard from the coach before class and after it. It's worked out automatically from the
classes (`dssc_clinics.sessions`) and the messages sent to a class in HQ (`dssc_class_messages`), so coaches
don't log anything extra. The logic is in `shared/class-comms.js`.

- **Before / after**: whether a message went out before the class started, Central time, or after it started.
- **Who a class belongs to**: its lead coach.
- **Charts**: classes held; % messaged before, after and at all; recaps written; a bar per coach; % by week.
- **Today's list**: today's classes with no message yet, each with "Message the class".
- **Class table**: every class, and it can be filtered to the ones with no message.
- **Slack**: the morning digest adds a line on yesterday's classes, naming the coaches whose classes got no
  message.
