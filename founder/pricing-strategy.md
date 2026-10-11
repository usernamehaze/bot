<!-- /founder:pricing-strategy · 2026-10-11 · input: Cassie, a free AI study buddy PWA + Chrome extension for Filipino students; tier names, prices, features and limits -->
# Cassie pricing strategy

Assumption: ₱58 = $1 (estimate, check before launch).
Assumption: an average answer uses about 3,000 input tokens (system prompt, history, question) and 600 output tokens (estimate; measure it from the server logs).
Assumption: Lemon Squeezy takes 5% + $0.50 per payment ([learnwithhasan](https://learnwithhasan.com/payment-gateways/lemonsqueezy/), [userjot](https://userjot.com/blog/stripe-polar-lemon-squeezy-gumroad-transaction-fees)); extra surcharges may apply.

## Fix before charging anyone
1. The server gives free users up to 40 answers a day from Claude Opus (`CLAUDE_DAILY_LIMIT` default 40) when `ANTHROPIC_KEY` is set. At about $0.024 an answer that is up to $29 a month for one heavy free user. Set Opus to paid plans only.
2. The site promises Free = 20 questions a day; the server default is 150 (`DAILY_LIMIT`). Set it to 20 so the plan means something.
3. "Unlimited voice chat" on Plus must mean Bella (runs on the student's phone, costs ₱0). The studio voice costs about $0.045 a minute.
4. The FAQ says GCash and Maya. Confirm Lemon Squeezy offers them in checkout; if not, change the FAQ.

## 1. Pricing model

| Model | Fit | Pros | Cons |
|---|---|---|---|
| Flat subscription | 4 | Simple for students and parents | Heavy users can cost more than they pay |
| Usage-based | 1 | Matches cost | Students fear surprise bills |
| Per-seat | 2 | Fits schools later | Not how one student buys |
| Freemium | 5 | Students try before paying; word of mouth in class | Free users cost money every day |
| Credits | 3 | Caps expensive features (studio voice, deep answers) | Confusing as the main price |
| One-time | 1 | Liked in PH | AI costs never stop |

Pick: freemium + flat subscription, with soft caps on the 3 costly things (top models, studio voice, big files), because AI costs scale with use and students want one fixed price.

## 2. Tiers (keep the names Free, Plus, Pro: they are already on the site and in Lemon Squeezy)

| | Free | Plus | Pro |
|---|---|---|---|
| Month | ₱0 | ₱149 | ₱499 |
| Semester (5 months) | | ₱599 (20% off) | ₱1,999 (20% off) |
| Year | | ₱1,490 (2 months free, 17% off) | ₱4,990 (17% off) |
| USD month | $0 | $7.99 | $14.99 |
| Brain | Groq, 20 questions a day | Haiku 5.5 / Groq, fair use 100 a day | Sonnet 5.5 for 15 a day, then Haiku; Opus "Deep think" 3 a day |
| File reviewers (PDF, slides, Word) | 3 a month | 30 a month | Fair use 10 a day, whole books |
| Pictures | 10 a month | 100 a month | Fair use 30 a day |
| Research runs | 2 a month | 10 a month | Fair use 5 a day |
| Voice | Bella unlimited, studio 0 min | Bella unlimited, studio 30 min a month | Bella unlimited, studio 60 min a month |
| Labs, 3D, Board, rooms, flashcards, study tools | All | All | All |
| Photo and handwriting reading, Word/PDF export | No | Yes | Yes |

Upgrade triggers: Free → Plus when a student hits 20 questions on an exam night or needs a 4th reviewer. Plus → Pro when they want the best answers on hard subjects (calculus, physics, thesis) and book-length files.

Third tier for later, sales-led: a school plan per class (₱/student/semester), once a teacher asks.

## 3. Competitors (checked 2026-10-11)

| Product | Price | Source | Where Cassie sits |
|---|---|---|---|
| ChatGPT Go | ₱300 a month | [unbox.ph](https://unbox.ph/news/chatgpt-go-philippines/) | Plus at half the price, built for studying |
| ChatGPT Plus | ₱1,100 a month | [unbox.ph](https://unbox.ph/news/chatgpt-go-philippines/) | Pro well below |
| Google AI Plus | Free for 1 year for PH college students, claim by Dec 31, 2026 | [newsbytes.ph](https://newsbytes.ph/2026/09/04/google-offers-pinoy-college-students-free-ai-plus-plan-for-one-year/) | Biggest threat for college; Cassie wins senior high and below |
| Google AI Pro (student) | ₱275 a month | [unbox.ph](https://unbox.ph/news/student-google-ai-plus/) | Pro must show study value Google lacks |
| Quizlet Plus | $7.99 a month or $35.99 a year | [nibble-app.com](https://nibble-app.com/blog/quizlet-cost) (third party) | Plus same USD price, does far more |
| Brainly Plus | about $24 a year (unofficial) | [subger.com](https://subger.com/en/service/brainly) | Plus semester is the comparison |

## 4. Unit economics (estimates)

Cost per answer, from Anthropic's API prices as of 2026-10-06 (Haiku 5.5 $0.10/$0.50, Sonnet 5.5 $2/$10, Opus 5.5 $4/$20 per million tokens) and Groq gpt-oss-120b $0.15/$0.60 ([computeprices](https://computeprices.com/providers/groq/models/gpt-oss-120b)):
- Groq: 3,000 × 0.15/1M + 600 × 0.60/1M = $0.0008
- Haiku 5.5: $0.0003 + $0.0003 = $0.0006
- Sonnet 5.5: $0.006 + $0.006 = $0.012 (about $0.0084 with the system prompt cached)
- Opus 5.5: $0.012 + $0.012 = $0.024 (about $0.016 cached)
- Studio voice: $0.05 per 1,000 characters ([reseller rate](https://wavespeed.ai/es/models/elevenlabs/flash-v2.5), estimate) × 900 characters a minute = $0.045 a minute
- Bella voice, pictures (Pollinations), 3D, Labs, rooms: about $0 per user (estimate)

| | Free | Plus (monthly) | Pro (monthly) |
|---|---|---|---|
| Net after Lemon Squeezy | $0 | $2.57 − $0.63 = $1.94 | $8.60 − $0.93 = $7.67 |
| Typical use | 3 questions a day | 15 answers a day, 20 min studio voice | 6 Sonnet + 1 Opus a day, 25 min studio voice |
| Typical cost | 90 × $0.0008 = $0.07 | $0.27 + $0.90 + $0.12 files = $1.29 | $1.51 + $0.48 + $1.13 + $0.10 = $3.22 |
| Gross margin | | 34% | 58% |
| At every cap | $0.48 | $1.80 + $1.35 + $0.12 = $3.27 (loss) | $3.78 + $1.44 + $2.70 + $0.30 = $8.22 (small loss) |

Plus monthly is thin because the $0.50 fixed fee is 19% of ₱149. The Plus semester nets $9.31 for 5 months ($1.86 a month) but the student pays once, so push Semester and Year.

Break-even (estimate): fixed costs about $30 a month (Cloudflare, domain, voice plan). With 1,000 free users at $0.07 = $70, total $100. Contribution per Plus user about $0.65, per Pro about $4.45; at an 80/20 Plus/Pro mix that is $1.41 per paid user, so about 71 paying students per 1,000 free users (7%). Lower studio voice use is the fastest way to bring that down.

Target blended net ARPU: about $3.08 a month (80% Plus, 20% Pro).

## 5. Pricing psychology
- Anchor: show Pro (₱499) first on wide screens and the month price struck through next to the Semester price, because ₱499 makes ₱149 feel small.
- Decoy: monthly Plus is the decoy; the target is Plus Semester at ₱599, framed "₱120 a month, one payment, nothing charged over the break", because it fits how families budget per term and cuts payment fees.
- Annual framing: "2 months free", not "17% off", because months are easier to picture.

## 6. Launch vs scale
- Launch (first 90 days): keep ₱149 and ₱499 (already public), plus a Founding Semester of ₱499 for Plus for the first 500 buyers, because a real price tells you who values Cassie and the semester format cuts fees.
- Grandfathering: founding buyers keep their price for as long as they renew without a gap.
- Raise prices when any of these is true for 2 straight months: Plus cost per user is above 50% of its net; more than 5% of active free users pay; monthly churn on Semester buyers is under 8%. Raise new signups only (Plus to ₱179), with 30 days' notice in the app.
