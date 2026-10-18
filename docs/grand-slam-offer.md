# Cassie's Grand Slam Offer

Value = (Dream Outcome × Perceived Likelihood of Achievement) ÷ (Time Delay × Effort and Sacrifice).
Everything below is built from what the code does today (named per claim) or marked **to build**. Prices checked 18 Oct 2026. Nothing here changes the site yet.

## 1. What Cassie gives today

| Plan | Feature | Limit in the code | File |
|---|---|---|---|
| Free | Questions to Cassie | 20 a day | `server/worker.src.js` `limitsFor()` |
| Free | Smarter answers (Claude Haiku) | first 10 a day | `server/worker.src.js` `limitsFor()` |
| Free | Pictures Cassie makes (Gemini) | 3 a week | `server/worker.src.js` `pictureAllowance()` |
| Free | 3D body, cells, solar system, globe, Real 3D in labs | 2 views of each a week | `app.js` `freeTake()`, `labs/kit.js`, `labs/bench3d.js`, `labs/atlas.js`, `labs/space3d.js` |
| Free | Quiz me, Review my mistakes, Teach Cassie | no limit | `app.js` `startQuizOn()`, `reviewMistakes()`, Teach Cassie mode |
| Free | Flashcards with spaced repetition | no limit | `cards.js` |
| Free | Labs, puzzles, games, study tools, Teach me tutor | no limit | `labs/` |
| Free | Board, shared board rooms | no limit | `sketch.js`, `study-room.js` |
| Free | Voice chat; studio voice | studio voice shared by everyone, 9,500 characters a month | `voice.js`, `server/worker.src.js` (`SPEAK_MONTHLY_CHARS`) |
| Free | Chrome extension: highlight, snip, Teach me on any page | no limit | `extension/` |
| Free | Lite mode for slow phones and Data Saver | no limit | `app.js` (Lite mode) |
| Free | Unlimited use with your own free key | no limit | `index.html` FAQ |
| Plus | Questions | 100 a day (page says "Unlimited*") | `server/worker.src.js` `limitsFor()` |
| Plus | Claude Haiku answers | 100 a day | `server/worker.src.js` `limitsFor()` |
| Plus | Pictures | 5 a day | `server/worker.src.js` `pictureAllowance()` |
| Plus | All 3D and Real 3D, any time | no limit | `app.js` `isSubscriber()`, `labs/kit.js` |
| Plus | Museum quiz; save, print, copy references in study tools | no limit | `labs/museum.js`, `labs/tools.js` `plusOnly()` |
| Pro | Questions | 150 a day | `server/worker.src.js` `limitsFor()` |
| Pro | Claude Sonnet, then Haiku | 15 + 100 a day | `server/worker.src.js` `limitsFor()` |
| Pro | Pictures | 20 a day | `server/worker.src.js` `pictureAllowance()` |

**On the pricing page but not in the code:** monthly limits on file reviewers and research runs, "30 minutes of listening a month", "Refer a classmate", and Pro's "Priority when Cassie is busy". Picture limits on the page ("10 a month", "100 a month") differ from the code (3 a week, 5 a day). Fixing this mismatch is change 1 in section 7: a promise that doesn't match the product lowers trust.

## 2. Dream outcomes by audience

- **Grade school (the parent buys):** "My child does homework without crying, and I don't have to know the lesson to help." "Their grades go up and they like learning."
- **High school:** "I pass Gen Chem and Pre-Calc." "I understand it before the quiz, not after." "I stop cramming at 2am." "I can answer when the teacher calls on me."
- **College or board exam reviewee:** "I pass the board exam on the first try." "I turn 300 pages of slides into something I can review on the jeep." "I don't pay ₱20,000 for a review centre I can't afford."
- **Working learner:** "I learn the new tool for my job in a weekend." "I finish my master's papers after work without burning out."

The common thread: **pass, with less stress, in less time, and look smart doing it.**

## 3. Value equation scores

Higher is better on every row: for Time Delay and Effort, 10 means fast and easy.

| Plan | Dream Outcome | Likelihood | Time Delay | Effort and Sacrifice | Biggest lever |
|---|---|---|---|---|---|
| Free | 6: real help with any subject (chat, quizzes, labs) | 5: no proof it works, no progress shown, terms say AI can be wrong | 8: answers in seconds, but the grade comes weeks later | 9: no card, works on a phone, Lite mode | Likelihood |
| Plus | 7: adds all 3D and saving, but most core help is already free | 5: same lack of proof; "Unlimited*" is really 100 a day | 8: same speed | 6: needs a card, a monthly bill, and you can't pay yet ("Join the waitlist") | Likelihood, then Effort |
| Pro | 7: smarter answers, more pictures | 6: a stronger model helps hard subjects | 8: same | 4: ₱499 a month is a lot for a student | Effort (price) |

**Biggest lever overall: Perceived Likelihood.** Cassie is fast and easy already. What's missing is the feeling that "this will make me pass": proof, progress, and a promise.

## 4. Obstacles to solutions

| Obstacle | Solution | Delivery vehicle | Cost | Keep or cut |
|---|---|---|---|---|
| "I don't know what to study" | Turn my file into a reviewer and quiz | File reviewer + Quiz me (exist) | S | Keep |
| "I'm not sure the answer is right" | Show work step by step; check my answer | Check my work on the board (exists) | S | Keep |
| "I forget it by the exam" | Mistakes and cards come back on time | Review my mistakes, flashcards (exist) | S | Keep |
| "I can't see if I'm getting better" | A weekly progress card: mistakes fixed, cards mastered, streak | Home screen card (**to build**) | M | Keep |
| "My exam is in 3 weeks and I'm lost" | Tell Cassie the exam date and topics; she makes a day by day plan | Exam plan + reminders (**to build**) | M | Keep |
| "My parents won't pay for apps" | One payment per semester, a parent summary, a refund promise | Semester pass (decided), parent email (**to build**) | M | Keep |
| "Monthly bills scare me" | No renewal on the Semester pass | Semester pass (decided) | S | Keep |
| "Data is expensive" | Lite mode, short answers | Lite mode (exists) | S | Keep |
| "Science is hard to picture" | Real 3D body, cells, labs | 3D and labs (exist) | S | Keep |
| "Studying alone is boring" | Shared boards and quizzes with classmates | Board rooms (exist), referral (**to build**) | M | Keep board rooms; referral later |
| "I want a human tutor" | Cassie as the always there tutor, plus Teach Cassie | Voice chat, Teach me (exist) | S | Keep |
| "I'm scared to waste money" | 7 day full refund, cancel in 3 taps | Lemon Squeezy refund + cancel flow (planned) | S | Keep |
| "I need certificates or a grade guarantee" | None we can honestly promise | None | L | Cut |

## 5. The offer

**Name: "Pasado Pass".** One semester of Cassie Plus, from first day to finals. "Pasado" is what every student wants to hear. Alternatives: "Finals Ready Pass", "Buong Sem Pass".

**Core:** Plus for 5 months, **one payment of ₱599, never renews** (the Semester pass already decided in `docs/subscriptions-plan.md`). Monthly Plus at ₱149 stays for those who want it.

**Bonus stack** (the value is what a student would otherwise pay; each is real or marked to build):

| Bonus | Why it matters | Stated value |
|---|---|---|
| Finals Reviewer Kit: any PDF or slides become a reviewer, a quiz and flashcards | Replaces buying reviewer books | ₱500 to ₱1,200 per book ([LET guide](https://supertutor.ph/blog/let-cost-2026-prc-fees-review-centres/)) |
| All the 3D and Real 3D labs, any time | Seeing it is how science sticks | Estimate: one ₱400 tutor hour per topic it saves ([tutor listing](https://www.myprivatetutor.co.za/teacher/39948/marvin-james-a-experienced-math-teacher-and-tutor-for-high-school)) |
| Exam plan: a day by day plan to your exam date (**to build**) | Turns "I'm lost" into "today, do this" | Estimate: what a tutor charges to plan, 1 hour, ₱400 |
| Weekly progress card, and a parent summary email if the student turns it on (**to build**) | Proof it's working, for the student and the one paying | Hard to price; this is the trust bonus |
| Save and print your notes, maps and boards | Bring your notes to class and to group study | Plus only today (`labs/tools.js`) |

**Guarantee: "7 day no questions refund".** If Cassie isn't helping in the first 7 days, one message to askcassie.study@gmail.com gets every peso back. Lemon Squeezy can refund an order from its dashboard, and its `order_refunded` webhook ends the plan (planned in `docs/subscriptions-plan.md`). No conditions a student can't meet: no "must use it 30 days", no "must show your grades". Pair it with what's already promised: cancel in 3 taps, a reminder before any renewal.

**Honest urgency:**
- **The school calendar is the deadline.** "Get the Pasado Pass before your first quiz" at the start of each semester, and a finals reminder. These dates are real and never reset.
- **Founding price:** the first price is kept for as long as a student keeps buying passes back to back. It's a true promise, written in the terms when payments launch.
- No countdown timers, no "only 3 left", no fake demand.

**Anchoring** (all per student, checked 18 Oct 2026):

| What students pay today | Price | Source |
|---|---|---|
| Private tutor, high school | about ₱400 an hour (one listing) | [MyPrivateTutor listing](https://www.myprivatetutor.co.za/teacher/39948/marvin-james-a-experienced-math-teacher-and-tutor-for-high-school) |
| LET review centre | ₱5,000 to ₱25,000 a cycle | [Super Tutor LET guide](https://supertutor.ph/blog/let-cost-2026-prc-fees-review-centres/) |
| NLE (nursing) review centre | ₱8,000 to ₱15,000 classroom | [Super Tutor NLE guide](https://supertutor.ph/blog/nle-cost-2026-fees-and-review-centres/) |
| ChatGPT Plus | ₱999 a month (App Store tracker) | [OpenTheRank](https://opentherank.com/ai-pricing/chatgpt/philippines/) |
| ChatGPT Go | ₱300 a month (news report) | [NoypiGeeks](https://www.noypigeeks.com/?p=256526) |

Estimate: ₱599 ÷ about 150 days = **about ₱4 a day**, less than one tutor hour (₱400) plus one jeep ride, for a whole semester. The review centre sources are a competing app's marketing pages, so use them as ranges, not facts to quote on the page.

## 6. Copy ready to paste

For use only when payments are live. Until then, keep "Join the waitlist" and "Paid plans are launching soon".

**Pricing section (`index.html` #pricing)**

- Headline: **Pasado ka dito.**
- Sub: Free forever, no card needed. When you want more, one payment covers your whole semester.
- Free tagline: Everything you need to study, free. Best for trying Cassie.
- Plus tagline: All of Cassie for the whole semester. Best for everyday school.
- Pro tagline: The smartest answers for the hardest subjects. Best for board exams.
- Plus bullets (Semester shown):
  - Everything in Free
  - Up to 100 questions a day, every day
  - 5 pictures a day, and photos of your notes read for you
  - All the 3D and Real 3D labs, any time
  - Save and print your notes, maps and boards
  - Your exam plan and weekly progress card *(after they're built)*
- Plus button: **Get the Pasado Pass**
- Small print under it: One payment of ₱599 for 5 months. Never renews. 7 days to change your mind.
- Monthly small print: ₱149 a month. Renews until you cancel, in 3 taps in Settings. We remind you before each renewal.
- Pro bullets:
  - Everything in Plus
  - Up to 150 questions a day
  - 15 answers a day from Cassie's smartest model
  - 20 pictures a day
- Footer: "Up to" numbers are fair use for one person. Cassie uses AI and can be wrong, so check what matters.

**Plus sheet (`app.js` `plusSheet()`)**

- Title: *{what} comes with Plus* (keep as is)
- List:
  - All the 3D, any time: body, cells, space and the globe
  - Real 3D in every lab, and the Museum quiz
  - Save or print your notes, maps and boards
- Footer: One payment of ₱599 covers your whole semester. It never renews, and you have 7 days to change your mind.
- Button: **Get the Pasado Pass** (keep **Not now** beside it, same size)

## 7. Changes ranked by impact

| Change | Driver it moves | Effort | Files | Needs code |
|---|---|---|---|---|
| Make the pricing page match the code (pictures, "up to 100 a day", remove what isn't built) | Likelihood (trust) | S | `index.html` | No (copy) |
| Make the Semester pass the main Plus offer, named Pasado Pass | Effort (no bill, one payment) | S | `index.html`, `landing/landing.js` | Yes, small |
| 7 day refund promise | Likelihood, Effort | S | `terms.html`, `index.html`, Lemon Squeezy dashboard | No |
| Weekly progress card | Likelihood | M | `app.js` | Yes |
| Exam plan to a date, with reminders | Time Delay, Likelihood | M | `app.js` | Yes |
| Parent summary email (opt in, from askcassie.study@gmail.com) | Likelihood for the buyer | M | `server/worker.src.js`, `app.js`, `privacy.html` | Yes |
| Build "Refer a classmate" or remove it from the page | Likelihood (trust) | S to remove, M to build | `index.html`, server | Remove: no |
| Build "Priority when busy" or remove it | Likelihood (trust) | S to remove | `index.html` | No |
| Founding price promise | Honest urgency | S | `terms.html` | No |

## 8. What not to do, and why

- **No grade or pass guarantee.** Cassie can't control the exam, and the terms say AI can be wrong. A promise she can't keep is a refund and a broken trust.
- **No fake urgency** (resetting timers, "only 3 left"). Students share screenshots; one fake timer undoes every true claim.
- **No invented proof.** Use placeholders until real quotes exist: [Quote from a Grade 10 student about passing Chemistry], [Quote from a parent about homework time].
- **Don't take things away from Free.** It's promised "free forever" on the page; the offer adds to it.
- **No free trial that turns into a bill.** It breaks the spirit of "cancel no harder than subscribing". The 7 day refund does the same job honestly.
- **Don't sell Pro as "cheaper ChatGPT".** Cassie mostly runs on free models; the honest pitch is study help made for Filipino students, not model size.
- **Don't add more tiers.** Free, Plus and Pro with three periods is already 7 prices; the Pasado Pass makes one of them the obvious pick.
