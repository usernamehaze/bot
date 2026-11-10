# Cassie gamification — design (Duolingo, Cassie's way)

Status: **v267 built: Sparks, the daily goal, the streak flame and the school medals (see the end). Leagues and freeze nudges are next.** Four mechanics, in Cassie's
voice and colors, built on machinery that already exists. Read the "Decisions I
need" box at the end — a few choices change the build.

## The idea in one line

Turn studying into a daily loop you don't want to break: **do a little every
day, watch a number go up, and Cassie keeps you honest.** Not a game with
Cassie's logo on it — the same calm study app, with a reason to come back
tomorrow.

## What already exists (so we extend, not rebuild)

| Piece | Where | What it gives us for free |
|---|---|---|
| Daily streak | `memory.js` `bumpStreak()`, `data.streak{count,lastDay}` | The streak itself, bumped once/day by a question or a focus block |
| Streak sync per account | `memory.js` `streakData()` / `mergeStreak()`; server `accounts.data` blob | Streak already follows the account across devices (latest day wins) |
| Streak-ending push | `server/worker.src.js` `push_subs` table + hourly Cron | A notification already fires when "studied yesterday, not today" — the nudge is half-built |
| Milestone lines | `app.js` `STREAK_MILESTONES`, `streakChat()` | Cassie already congratulates 3/5/7/…/365 days, once each |
| Home "Today" + bell | `app.js` `hubReminders()`, hub widgets | A place the goal ring and league chip slot into |
| Accounts + sign-in gate | server auth, `guestNudge()` | Leagues can ride the account model we already gate on |

So: XP and achievements are new client state next to `streak`; leagues are the
one genuinely new server surface; freeze + nudges mostly reuse `push_subs`.

---

## 1. XP + daily goal — the core loop

**XP** ("points" in Cassie's words — see Decisions) is earned for real study,
never for just opening the app:

| Action | XP | Source hook |
|---|---|---|
| Ask Cassie a study question | 10 | `recordQuestion()` |
| Review a flashcard | 5 (max 100/day) | `cards.js` review |
| Finish a focus block | 15 | `addFocusMinutes()` |
| Finish a lesson / lab | 20 | lesson complete |
| Answer a quiz question right | 10 | quiz grade |
| Pass a mock exam section | 40 | board/exam flow |

Daily caps on the cheap repeatable ones (flashcards) so the goal means
*studying*, not farming.

**Daily goal.** The user picks a target when they first see it — Casual 30 /
Regular 50 / Serious 80 / Intense 120 XP a day (Duolingo's four-tier framing,
Cassie-named). Shown as a **ring on Home's "Today" section**: fills as XP comes
in, Cassie says one line when it closes ("Goal done, [Name] — that's today.").

**The important design choice: streak = goal met, not app opened.** Today the
streak bumps on *any* question. Duolingo's streak means you hit your goal. I
recommend we move to goal-met so the streak means something — but grandfather
existing streaks (never reset someone to 0 on the day we ship) and keep the bar
reachable (Casual 30 = ~3 questions). This is a behavior change, so it's a
Decision below.

Data: add `xp: { today, day, goal, lifetime }` to `memory.js` next to `streak`,
same save/sync path (extend `streakData`/`mergeStreak`). Fully offline.

---

## 2. Leagues / leaderboard — the social pull

Weekly competition. Your week's XP ranks you in a league of ~30 learners; top
finishers promote, bottom demote. Tiers in Cassie's world, e.g. **Study Buddy →
Scholar → Honor → Dean's List → Topnotcher** (Topnotcher = the PH board-exam
word for #1, lands for our audience).

**This is the one that needs the server and a hard privacy stance.** Cassie's
promise is "your data is private, never sold." A leaderboard shows *something*
about you to strangers, so:

- **Opt-in only.** You're not in a league until you tap "Join the weekly board."
  Off = you never appear, and nobody's XP shows to you.
- **A handle, never your identity.** You pick a display handle (or Cassie gives
  a random one like "Quiet Comet"). Never email, never real name, never grade or
  school. The board shows handle + weekly XP, nothing else.
- **Numbers only leave the device.** Same rule as streak sync: weekly XP total
  and handle go up; what you studied never does.

Server (new, read-only sketch — worker is edit-with-permission):
- Table `league_members(account, league_id, week, xp, handle, joined)`.
- `POST /league/xp` — add this week's XP delta (rate-limited, clamped).
- `GET /league/board` — your league's 30 rows for the current week.
- Assignment: on first join or new week, drop you into any open league for your
  current tier (simple fill-to-30; no matchmaking cleverness in v1).
- Weekly rollover in the existing Cron: close the week, promote/demote, seed next.

Needs sign-in → reuses `guestNudge()` ("Join the board — it's free, sign in to
keep your rank"). Biggest build of the four; I'd ship it last.

---

## 3. Achievements & badges — the collection

Unlockable badges for milestones. Fully offline, pure client state. A **trophy
shelf** in You / profile; a small toast + Cassie line on unlock.

Starter set (each a tier you can level: bronze/silver/gold):
- **On a roll** — 7 / 30 / 100-day streak
- **Curious** — 100 / 500 / 2,000 questions asked
- **Sharp** — 50 / 250 / 1,000 cards mastered
- **Focused** — 5 / 25 / 100 focus hours
- **Ready** — first mock passed / full plan done / exam marked taken
- **Night owl / Early bird** — studied after 10pm / before 7am
- **Comeback** — used a streak freeze and kept going

Data: `badges: { id: tier }` in `memory.js`; a pure function
`evaluateBadges(stats)` run after any XP event. Syncs with the account like the
rest. No server.

---

## 4. Streak freeze + Cassie nudges — don't lose the habit

**Freeze.** One missed day shouldn't erase 40. A **freeze** auto-saves a missed
day. Earn one every N on-goal days (or hand Plus/Pro a small stock as a perk —
Decision). Show "❄ 2 freezes" by the streak; spend automatically; "Comeback"
badge when a freeze saves you. Change is local to `bumpStreak()`: if yesterday
was missed but a freeze is banked, consume it and keep the count.

**Nudges.** Mostly already built — `push_subs` fires when the streak is about to
end. We make it feel like Cassie:
- Better copy in her voice ("One question keeps your [N]-day streak, [Name].").
- Fire on **goal-at-risk** (goal not yet met today), not just streak-ends.
- Respect the existing Notifications settings page and quiet hours already there.
- A gentle in-app banner in the evening if goal's not met and app is open.

No "Cassie is sad" guilt-trips — encouragement only, matching the brand.

---

## How it looks (placement, not new screens)

- **Home "Today":** goal ring replaces/【wraps】 the plain streak number; freeze
  count + league chip sit beside it. One row, no new page.
- **You / profile:** trophy shelf + lifetime XP + current league tier.
- **The bell/reminders:** "40 XP to your goal," "Board resets in 2 days."
- **On earning:** tiny "+10" that floats and fades — the only new motion.

All in existing tokens/glass; dark + light; phone and desktop. No mascot
required on these surfaces (keeps the v262 onboarding decision).

---

## Build order (phases, each shippable + tested alone)

1. **XP engine + daily goal + ring** (client only). The loop, offline. Redefine
   streak to goal-met with grandfathering.
2. **Achievements** (client only). Shelf + unlock toasts. Cheap, high delight.
3. **Freeze + better nudges** (client + reuse `push_subs`). Protects the habit.
4. **Leagues** (new server surface + opt-in + handles). The big one, last.

Each phase: tests that fail on the old build, a version bump, screenshots for
you, fast suite, and no push until you say go — same as always.

## Risks / things I'll watch

- **Streak redefinition** must never reset a real user to 0 on ship day.
- **XP caps** so flashcard-spam can't trivialize the goal.
- **Leaderboard privacy** — opt-in, handle-only, numbers-only; auditable against
  the privacy promise before it ships.
- **Not punishing.** No hearts/lives that block studying, no guilt copy. Cassie
  stays the calm tutor, just with a streak worth keeping.

---

## Decisions — LOCKED (2026-11-10)

1. **XP is called "Sparks."** Warm, Cassie's voice.
2. **Streak = goal met**, with grandfathering (never reset a real user to 0 on
   ship day; easy goal stays ~3 questions).
3. **Freezes earned by everyone** through on-goal days. A paid starting stock can
   be added later if we want it to nudge upgrades.
4. **All four**, in the phase order above — leagues ship last within the batch,
   opt-in, handle-only, numbers-only, privacy-reviewed.


## Built in v267

- **Sparks and the daily goal** (`memory.js`): 10 a question, 10 a right quiz answer, 5 a flashcard (100 a day at most), 15 a focus block, 20 a lesson, 40 a mock. Goals 30, 50, 80, 120. The streak counts a day only when the goal is met; a banked freeze covers a missed day (one earned every 5 goal days, 5 at most, 2 to start). Old memories keep their streak (studied today counts as met).
- **The streak flame** (`rewards.js`, `rewards.css`): Ember from day 1, Gold at 7, Rose at 14, Violet at 30, Mint at 60, Sky at 100, a little bigger every day. A normal goal day is a toast (day 1 too); a new flame is the full moment: the flame pops up alone and grows, then the panel. Drag to spin. It waits while Cassie is still answering.
- **School medals**: With Honors (85% mock, bronze), With High Honors (90%, silver), With Highest Honors (95%, gold), Perfect Attendance (goal 30 days in a row), Best in Quiz (90% of the last 50), Most Improved (a weak topic made strong), Bookworm (20 lessons), Early Bird (before 7am on 5 days), Dean's Lister (with the leagues). Each drops in on its ribbon, one at a time; drag to flip to the engraved back (name and date). My awards is on Home (phone) and the dashboard's streak card (computer).
- **Sync**: Sparks and awards ride with the account's streak record (numbers and dates only).
- **Still to do**: weekly leagues (server), freeze earning shown on Home, nudges in Cassie's voice.
