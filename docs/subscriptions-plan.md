# Subscriptions plan (Lemon Squeezy)

Status: **plan only, decisions made.** No payment code, screens, server routes or Lemon Squeezy calls are built yet. Building starts when the Lemon Squeezy links arrive.

What already exists and stays:

- Plans are Free, Plus and Pro. Prices are the landing page's (`landing/landing.js`): Plus ₱149 a month, ₱599 a semester, ₱1,490 a year; Pro ₱499, ₱1,999, ₱4,990 (USD prices beside them).
- A plan belongs to an account, so it follows the student to every device. The server keeps it in the `plans` table (`account, plan, until, note, updated`), and `/auth/me` tells the app. The owner's `/admin/plan` stays as it is.
- `terms.html` (Paid plans) promises what this plan delivers:
  - **Cancelling never takes more steps than subscribing.**
  - **A reminder before every automatic renewal**, in the app and by email, about a week before and never less than 3 days before. Yearly plans also get one a month before.
  - **A Semester pass never renews**, and the student is told before it ends.

## Decisions (made 18 Oct 2026)

| # | Question | Decision |
|---|---|---|
| 1 | Does the Semester pass renew by itself? | **No.** It's a one-time payment for 5 months. The student is told before it ends, in the app and by email. |
| 2 | A new database table `subscriptions`. | **Approved.** |
| 3 | Who sends the reminder emails? | **Cassie, from askcassie.study@gmail.com.** Lemon Squeezy's own renewal reminder is turned off, so nobody gets two emails. |
| 4 | Yearly plans: an email reminder a month before too? | **Yes.** |

## 1. Subscribing (the count cancelling must match)

Subscribing needs an account, so the student is signed in.

Shortest path, from a locked extra (the Plus sheet is already open because they tapped something Plus-only):

1. **Get Plus** on the Plus sheet
2. **Monthly** / **Yearly** / **Semester** (one tap picks the period; Monthly is preselected)
3. **Pay** on Lemon Squeezy's checkout (after typing their payment details)

Path from Settings: **Settings**, **Get Plus**, the period, **Pay**: 4 taps.

So the shortest subscribe path is **3 taps**. Cancelling must take 3 or fewer.

Under the Semester button, before paying: "One payment for 5 months. It doesn't renew: we'll remind you before it ends." Under Monthly and Yearly: "Renews automatically until you cancel. Cancel any time in Settings."

## 2. Cancelling: 3 taps, from Settings

1. **Settings** (the tab bar, from any screen)
2. **Cancel plan**: a button right on the plan card at the top of Settings ("Plus · renews 18 Nov 2026 · ₱149"), not inside a submenu
3. **Yes, cancel**: one confirm sheet

Done. The sheet then says: "Your plan is cancelled. You keep Plus until 18 Nov 2026, and you won't be charged again." The plan card shows **Ends 18 Nov 2026** and a **Keep my plan** button (resume, 1 tap).

Rules for this flow:

- **One** confirm step and nothing else: no "Are you sure?" chain, no discount offer, no required reason. An optional "Tell us why" link may sit under the done message, after the cancel has happened.
- The confirm sheet says plainly what happens: "You keep Plus until 18 Nov 2026. You won't be charged again." The buttons are **Yes, cancel** and **Keep my plan**, both 44px.
- Cancelling takes effect at the end of the period already paid for, never immediately, so the student loses nothing they paid for.
- A Semester pass has nothing to cancel (it doesn't renew). Its card says **Ends 18 Mar 2027 · doesn't renew**.
- Errors (offline, Lemon Squeezy down) go through `CassieErrors` with **Try again**, plus the Lemon Squeezy customer portal link as a second way to cancel. New keys: `cancel_failed`, `resume_failed`.
- Lemon Squeezy's customer portal also lets the student cancel; that's a second way, never the only one.

**What the server does:** `POST /billing/cancel` (signed in). The server finds the account's subscription and calls Lemon Squeezy `DELETE https://api.lemonsqueezy.com/v1/subscriptions/{id}` with the API key. The answer comes back with `cancelled: true` and an `ends_at` date. The server sets `plans.until = ends_at` straight away, without waiting for the webhook, and replies to the app. Resume is `POST /billing/resume`: a `PATCH` to the same address with `cancelled: false`. This only works before `ends_at`.

**Test (built with the flow):** a smoke test counts taps. It goes from the home screen to "Your plan is cancelled" with the server faked, and from the Plus sheet to the checkout opening. It fails if cancelling takes more taps than the shortest subscribe path.

## 3. Reminders before a renewal or an ending

Dates come from the server. For Monthly and Yearly the renewal date is `renews_at`, which Lemon Squeezy sends in every subscription webhook. For a Semester pass the end date is the payment date plus 5 months. The app never works out a date itself.

| Plan | Email from askcassie.study@gmail.com | Note in the app |
|---|---|---|
| Monthly (renews) | **7 days before** the renewal | From 7 days before until the renewal; again 1 day before, even if dismissed |
| Yearly (renews) | **30 days before** and **7 days before** the renewal | Once 30 days before; then from 7 days before, and again 1 day before |
| Semester pass (one time, ends) | **7 days before** it ends | From 7 days before until it ends; again 1 day before |
| Cancelled plan | None (it won't renew) | "You keep Plus until 18 Nov 2026" on the plan card only |

The email goes 7 days before, so the terms' "never less than 3 days before" has 4 days to spare. If an email fails to send, the server tries again each run. It gives up only once the date is less than 3 days away. The in-app note still shows either way.

**The words.**

- Renewing, in the app: "Your Plus plan renews on 18 Nov 2026 for ₱149. Want to stop it? **Cancel plan**." Cancel plan opens the same confirm sheet, so cancelling from the note is 2 taps.
- Renewing, by email:
  - Subject: "Your Cassie Plus renews on 18 Nov 2026"
  - Body: the date, the amount, "Nothing to do if you want to keep it", and how to cancel: "Open Cassie, then Settings, then Cancel plan". The body also includes the Lemon Squeezy customer portal link.
- Semester ending, in the app: "Your Semester pass ends on 18 Mar 2027. You won't be charged. Want to keep Plus? **See plans**."
- Semester ending, by email:
  - Subject: "Your Cassie Semester pass ends on 18 Mar 2027"
  - Body: the date, "you won't be charged", and that everything they saved stays when they're back on Free.

Emails are plain text and short, with no tracking pixels. They go only to the account's email address.

**How the email is sent:**

- A scheduled run of the Cassie server (a Cloudflare Cron Trigger), once a day at 9:00 Manila time, finds every plan whose 30-day, 7-day or end reminder is due and not yet sent.
- It sends each one from **askcassie.study@gmail.com** through the **Gmail API** (`users.messages.send`), using plain `fetch`: no library.
- It records each send in the `subscriptions` table, so a reminder never goes twice.
- The Gmail API is a new outside service. `privacy.html` must name it before the first email (section 7).
- Gmail lets a normal account send about 500 emails a day. That is plenty at launch. If Cassie ever has more than about 400 reminders on one day, the server spreads them over the next days, still never later than 3 days before the date. At that size it's time to move to a real email service, with your OK.

**What you set up for it (later, when we build):**

- In the same Google Cloud project as Google sign in, turn on the Gmail API.
- Make an OAuth client with only the `gmail.send` permission.
- Sign in once as askcassie.study@gmail.com to allow it.
- I'll give you the exact steps then. The client ID, client secret and refresh token go into Cloudflare as Secrets: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`. They never go in chat or files.
- Google calls `gmail.send` a sensitive permission. Since only Cassie's own account grants it, Google's app review isn't needed, but the consent screen must be set to **In production**: in Testing mode the permission stops working after 7 days.

## 4. Lemon Squeezy settings it will need

You set these in the Lemon Squeezy dashboard. Secrets go into Cloudflare as **Secrets**, never into chat or files.

| Where in Lemon Squeezy | Setting |
|---|---|
| Store | Test mode on until everything passes end to end. Support and reply email: **askcassie.study@gmail.com**. Check whether one store can show both ₱ and $ prices, or which currency it charges in. |
| Products | **Cassie Plus** and **Cassie Pro**. Each has 3 variants: **Monthly** (subscription, every 1 month), **Yearly** (subscription, every 12 months) and **Semester** (single payment). That makes 6 variants. |
| Checkout | The redirect after payment goes to `https://askcassie.pages.dev/app.html#plan=thanks`. Allow buying only 1 of each. Pass the account with custom data (`checkout[custom][account]`), so the webhook knows whose plan it is. |
| Settings → Recovery | Renewal reminder email **off**, because Cassie sends her own (decision 3). Failed payment emails **on**. |
| Customer portal | On. Lets the customer cancel, resume and update the payment method (second way to cancel). |
| Pausing | Off. There are fewer states to explain, and cancelling covers it. |
| Settings → API | One API key. In Cloudflare as Secret **`LEMON_API_KEY`**. Used only by the server, for cancel, resume and checkout. |
| Settings → Webhooks | Callback URL `https://cassie.failanzahazel.workers.dev/billing/webhook`, a signing secret (Cloudflare Secret **`LEMON_WEBHOOK_SECRET`**), and the events below. |
| Not secrets (plain Cloudflare variables) | `LEMON_STORE_ID` and the 6 variant IDs (`LEMON_PLUS_MONTHLY`, `LEMON_PLUS_YEARLY`, `LEMON_PLUS_SEMESTER`, `LEMON_PRO_MONTHLY`, `LEMON_PRO_YEARLY`, `LEMON_PRO_SEMESTER`). The server maps a variant to Plus or Pro, and to renewing or one time. |

## 5. Webhooks

Every request is checked first. `X-Signature` must equal the HMAC SHA256 of the raw body with `LEMON_WEBHOOK_SECRET`, compared in constant time. Anything else gets a 401 and is ignored. `X-Event-Name` names the event. The server answers 200 quickly. Webhooks can arrive out of order, so an event older than the stored `updated_at` for that subscription is ignored. The plan is always decided by the server from signed webhooks or Lemon Squeezy's API, never by the app.

| Event | What Cassie does |
|---|---|
| `subscription_created` | Links the subscription to the account in `custom_data.account`. Stores the variant (Plus or Pro), `status` and `renews_at`. Sets `plans.until` = `renews_at` plus 3 days of slack. |
| `subscription_updated` | The catch-all sync: status, `renews_at`, `ends_at`, a change of plan (Plus to Pro). Updates `plans.until`. A new `renews_at` resets which reminders were sent. |
| `subscription_payment_success` | A renewal went through (it also fires for the first payment). Moves `plans.until` to the new `renews_at` plus slack. Clears any payment problem note. |
| `subscription_payment_failed` | Shows an in-app note: "Your payment didn't go through. Update your card to keep Plus." It links to the update payment method page. Access stays on while Lemon Squeezy retries. |
| `subscription_payment_recovered` | Clears that note. |
| `subscription_cancelled` | Keeps the plan until `ends_at`. The plan card shows "Ends …" and **Keep my plan**. No more renewal reminders. |
| `subscription_resumed` | Back to renewing: "Renews …", and reminders return. |
| `subscription_expired` | The plan ends (`plans.until` = now). The student is back on Free with everything they saved. |
| `order_created` | A Semester pass (single payment variant): `plans.until` = the payment date plus 5 months. Its end reminders are scheduled. |
| `order_refunded`, `subscription_payment_refunded` | Ends the plan, or shortens it to match the refund. Unsent reminders are dropped. |
| `subscription_paused`, `subscription_unpaused` | Only if pausing is ever turned on. They're logged and treated like cancelled and resumed. |

## 6. Server changes (later, in `server/worker.src.js`, then `python3 build.py`)

- **New table (approved):**
  `subscriptions (id TEXT PRIMARY KEY, account TEXT, variant TEXT, plan TEXT, kind TEXT, status TEXT, renews_at INTEGER, ends_at INTEGER, cancelled INTEGER, portal TEXT, reminded TEXT, updated_at INTEGER)`.
  - `kind` is `renewing` or `pass`.
  - `reminded` lists the reminders already emailed for the current date, such as `30,7`.
  - The table holds only what Lemon Squeezy sends about the subscription. Card details never reach Cassie.
- **Routes:** `POST /billing/webhook`, `POST /billing/cancel`, `POST /billing/resume`.
- **`/auth/me`** gains the plan's dates, kind, status, the price shown, and which in-app note is due.
- **A daily scheduled run** (Cron Trigger) sends the reminder emails (section 3).
- **`plans`** stays the single answer to "what plan is this account on". The owner's `/admin/plan` keeps working beside it.
- **For you to do in Cloudflare:** paste the new `worker.js`, add the Secrets (`LEMON_API_KEY`, `LEMON_WEBHOOK_SECRET`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`) and the variables, and turn on the Cron Trigger.

## 7. When it launches, also

- `privacy.html`:
  - Name Lemon Squeezy as the seller of record, with what it receives (email, and the payment details it collects itself) and what Cassie receives (the subscription's status and dates, never card numbers).
  - Name Gmail (Google) as the service that sends reminder emails, with what it gets: the student's email address, plan, date and amount.
- `terms.html`:
  - Name Lemon Squeezy as the seller of record and add the refund policy.
  - Say that Cassie's emails come only from askcassie.study@gmail.com.
  - Keep the cancel and reminder promises.
- If Cassie is ever listed in the Google Play Store or Apple App Store as an app, check their rules about selling digital subscriptions inside apps first. Buying through Lemon Squeezy is fine on the website and the installed web app.

## 8. Tests that come with the build

- **Cancel taps:** cancelling takes no more taps than the shortest subscribe path (section 2).
- **Reminder timing:**
  - Monthly: the note and email come 7 days before, and the note again 1 day before.
  - Yearly: the email comes 30 days and 7 days before.
  - Semester: the "ends soon" email and note come 7 days before.
  - Nothing is sent after cancelling, and nothing is sent twice.
  - A failed email is retried, but never inside the last 3 days.
- **Emails:** sent from askcassie.study@gmail.com to the account's email only, with the date, the amount and how to cancel. The Gmail API is faked in tests.
- **Webhooks:** a wrong signature changes nothing. A good `subscription_created` gives the account Plus. `order_created` for a Semester pass gives 5 months. `subscription_expired` takes the plan away. An older event arriving late is ignored.
- **Cancel and resume:** tested with Lemon Squeezy faked, including a failure that shows `cancel_failed` with Try again.

Sources for the Lemon Squeezy details: [Event Types](https://docs.lemonsqueezy.com/help/webhooks/event-types), [Webhook Requests (X-Signature)](https://docs.lemonsqueezy.com/help/webhooks/webhook-requests), [Cancel a Subscription](https://docs.lemonsqueezy.com/api/subscriptions/cancel-subscription), [Update a Subscription (resume)](https://docs.lemonsqueezy.com/api/subscriptions/update-subscription), [The Subscription Object (renews_at, ends_at, urls.customer_portal)](https://docs.lemonsqueezy.com/api/subscriptions/the-subscription-object), [Recovery and Dunning (renewal reminder email)](https://docs.lemonsqueezy.com/help/online-store/recovery-dunning).
