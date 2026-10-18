# Subscriptions plan (Lemon Squeezy)

Status: **plan only.** No payment code, screens, server routes or Lemon Squeezy calls are built yet. Building starts after the Lemon Squeezy links arrive and the open decisions below are answered.

What already exists and stays:

- Plans are Free, Plus and Pro. Prices are the landing page's (`landing/landing.js`): Plus ₱149 a month, ₱599 a semester, ₱1,490 a year; Pro ₱499, ₱1,999, ₱4,990 (USD prices beside them).
- A plan belongs to an account, so it follows the student to every device. The server keeps it in the `plans` table (`account, plan, until, note, updated`), and `/auth/me` tells the app. The owner's `/admin/plan` stays as it is.
- `terms.html` (Paid plans) now promises two things this plan delivers: **cancelling never takes more steps than subscribing**, and **a reminder before every automatic renewal, in the app and by email, about a week before and never less than 3 days before.**

## Decisions needed from you first

| # | Question | My recommendation |
|---|---|---|
| 1 | Does the **Semester** pass renew by itself? | **No.** Make it a one-time payment for 5 months. Students buy it per term, nothing renews by surprise, and it needs no renewal reminder (only an "ends soon" note). Monthly and Yearly renew automatically. |
| 2 | A new database table `subscriptions` (see "Server" below). Changing tables needs your OK. | Yes, a new table. The existing `plans` table stays the one place the app reads the plan from. |
| 3 | The reminder **email**: Lemon Squeezy's own renewal reminder, or one Cassie sends? | **Lemon Squeezy's own** (turned on in its Recovery settings). Cassie's server can't send email today, and adding an email service would be a new dependency. |
| 4 | Yearly plans: a second email reminder 30 days before? | Not at launch. It needs Cassie to send email (decision 3). The in-app note covers the 30-day point for Yearly instead. |

## 1. Subscribing (the count cancelling must match)

Subscribing needs an account, so the student is signed in.

Shortest path, from a locked extra (the Plus sheet is already open because they tapped something Plus-only):

1. **Get Plus** on the Plus sheet
2. **Monthly** / **Yearly** / **Semester** (one tap picks the period; Monthly is preselected)
3. **Pay** on Lemon Squeezy's checkout (after typing their payment details)

Path from Settings: **Settings**, **Get Plus**, the period, **Pay**: 4 taps.

So the shortest subscribe path is **3 taps**. Cancelling must take 3 or fewer.

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
- Lemon Squeezy's own customer portal and emails also let the student cancel; that's a second way, never the only one.

**What the server does:** `POST /billing/cancel` (signed in). The server finds the account's subscription and calls Lemon Squeezy `DELETE https://api.lemonsqueezy.com/v1/subscriptions/{id}` with the API key. The answer comes back with `cancelled: true` and an `ends_at` date. The server sets `plans.until = ends_at` straight away, without waiting for the webhook, and replies to the app. Resume is `POST /billing/resume`: a `PATCH` to the same address with `cancelled: false`. This only works before `ends_at`.

**Test (built with the flow):** a smoke test counts taps. It goes from the home screen to "Your plan is cancelled" with the server faked, and from the Plus sheet to the checkout opening. It fails if cancelling takes more taps than the shortest subscribe path.

## 3. The renewal reminder

Applies to plans that renew automatically: Monthly and Yearly. The renewal date is `renews_at`, which Lemon Squeezy sends in every subscription webhook. The server keeps it.

**In the app (Cassie builds this):**

- **When:** the note shows from 7 days before `renews_at` until the renewal. It appears again 1 day before, even if it was dismissed. For Yearly it also shows once 30 days before.
- **Where:** a small note at the top of Home, and on the plan card in Settings. It's dismissible, and dismissing it is remembered per renewal date.
- **Words:** "Your Plus plan renews on 18 Nov 2026 for ₱149. Want to stop it? **Cancel plan**." The Cancel plan button opens the same confirm sheet, so cancelling from the note is 2 taps.
- **Data:** `/auth/me` adds `renews_at`, `ends_at`, `status`, `cancelled` and the price shown, all from the server. The app never decides a renewal date itself.
- **Not shown** once cancelled, for Semester passes (they get "Your Semester pass ends on …" 7 days before instead), or on Free.

**By email (Lemon Squeezy sends it):**

- Turn on Lemon Squeezy's **subscription renewal reminder** email in the store's **Settings → Recovery** (the dunning page). Its docs say it goes out **7 days before the renewal date** and that the text and timing can be edited there. Their docs page is old, so please check the setting yourself in the dashboard.
- Edit the email to include the date, the amount and the customer portal link to cancel. That matches the terms promise.
- Keep the timing at 7 days. The terms promise "about a week, never less than 3 days".
- If that setting no longer exists, Cassie must send the email herself. That needs an email service (a new dependency), so I'll stop and ask before adding one.

## 4. Lemon Squeezy settings it will need

You set these in the Lemon Squeezy dashboard. Secrets go into Cloudflare as **Secrets**, never into chat or files.

| Where in Lemon Squeezy | Setting |
|---|---|
| Store | Test mode on until everything passes end to end. Check whether one store can show both ₱ and $ prices, or which currency it charges in. |
| Products | **Cassie Plus** and **Cassie Pro**. Each has variants **Monthly** (subscription, every 1 month) and **Yearly** (subscription, every 12 months), plus **Semester** (single payment, if decision 1 is "no renewal"). That makes 6 variants. |
| Checkout | The redirect after payment goes to `https://askcassie.pages.dev/app.html#plan=thanks`. Allow buying only 1 of each. Pass the account with custom data (`checkout[custom][account]`), so the webhook knows whose plan it is. |
| Settings → Recovery | Renewal reminder email **on**, 7 days before (see section 3). Failed payment emails **on**. |
| Customer portal | On. Lets the customer cancel, resume and update the payment method (second way to cancel). |
| Pausing | Off. There are fewer states to explain, and cancelling covers it. |
| Settings → API | One API key. In Cloudflare as Secret **`LEMON_API_KEY`**. Used only by the server, for cancel, resume and checkout. |
| Settings → Webhooks | Callback URL `https://cassie.failanzahazel.workers.dev/billing/webhook`, a signing secret (Cloudflare Secret **`LEMON_WEBHOOK_SECRET`**), and the events below. |
| Not secrets (plain Cloudflare variables) | `LEMON_STORE_ID` and the 6 variant IDs (`LEMON_PLUS_MONTHLY`, `LEMON_PLUS_YEARLY`, `LEMON_PLUS_SEMESTER`, `LEMON_PRO_MONTHLY`, `LEMON_PRO_YEARLY`, `LEMON_PRO_SEMESTER`). The server maps a variant to Plus or Pro. |

## 5. Webhooks

Every request is checked first. `X-Signature` must equal the HMAC SHA256 of the raw body with `LEMON_WEBHOOK_SECRET`, compared in constant time. Anything else gets a 401 and is ignored. `X-Event-Name` names the event. The server answers 200 quickly. Webhooks can arrive out of order, so an event older than the stored `updated_at` for that subscription is ignored. The plan is always decided by the server from signed webhooks or Lemon Squeezy's API, never by the app.

| Event | What Cassie does |
|---|---|
| `subscription_created` | Links the subscription to the account in `custom_data.account`. Stores the variant (Plus or Pro), `status` and `renews_at`. Sets `plans.until` = `renews_at` plus 3 days of slack. |
| `subscription_updated` | The catch-all sync: status, `renews_at`, `ends_at`, a change of plan (Plus to Pro). Updates `plans.until`. |
| `subscription_payment_success` | A renewal went through (it also fires for the first payment). Moves `plans.until` to the new `renews_at` plus slack. Clears any payment problem note. |
| `subscription_payment_failed` | Shows an in-app note: "Your payment didn't go through. Update your card to keep Plus." It links to the update payment method page. Access stays on while Lemon Squeezy retries. |
| `subscription_payment_recovered` | Clears that note. |
| `subscription_cancelled` | Keeps the plan until `ends_at`. The plan card shows "Ends …" and **Keep my plan**. No more renewal reminders. |
| `subscription_resumed` | Back to renewing: "Renews …", and reminders return. |
| `subscription_expired` | The plan ends (`plans.until` = now). The student is back on Free with everything they saved. |
| `order_created` | For Semester passes (single payment): `plans.until` = now plus 5 months. |
| `order_refunded`, `subscription_payment_refunded` | Ends the plan, or shortens it to match the refund. |
| `subscription_paused`, `subscription_unpaused` | Only if pausing is ever turned on. They're logged and treated like cancelled and resumed. |

## 6. Server changes (later, in `server/worker.src.js`, then `python3 build.py`)

- A new table (needs your OK, decision 2): `subscriptions (id TEXT PRIMARY KEY, account TEXT, variant TEXT, plan TEXT, status TEXT, renews_at INTEGER, ends_at INTEGER, cancelled INTEGER, portal TEXT, updated_at INTEGER)`. It holds only what Lemon Squeezy sends about the subscription. Card details never reach Cassie.
- Routes: `POST /billing/webhook`, `POST /billing/cancel`, `POST /billing/resume`. `/auth/me` gains the plan's dates.
- `plans` stays the single answer to "what plan is this account on". The owner's `/admin/plan` keeps working beside it.
- You'll get the new `worker.js` to paste into Cloudflare, plus the two Secrets and the variables to add.

## 7. When it launches, also

- `privacy.html`: name Lemon Squeezy as the seller of record. Say what it receives (email, payment details it collects itself) and what Cassie receives (the subscription's status and dates, never card numbers).
- `terms.html`: name Lemon Squeezy as the seller of record, add the refund policy, and keep the cancel and reminder promises.
- If Cassie is ever listed in the Google Play Store or Apple App Store as an app: their rules about selling digital subscriptions inside apps must be checked first. Buying through Lemon Squeezy is fine on the website and the installed web app.

## 8. Tests that come with the build

- Cancelling takes no more taps than the shortest subscribe path (section 2).
- The renewal note shows 7 days before and 1 day before, not after cancelling, and not for Semester passes.
- A webhook with a wrong signature changes nothing. A good `subscription_created` gives the account Plus. `subscription_expired` takes it away. An older event arriving late is ignored.
- Cancel and resume with Lemon Squeezy faked, including a failure that shows `cancel_failed` with Try again.

Sources for the Lemon Squeezy details: [Event Types](https://docs.lemonsqueezy.com/help/webhooks/event-types), [Webhook Requests (X-Signature)](https://docs.lemonsqueezy.com/help/webhooks/webhook-requests), [Cancel a Subscription](https://docs.lemonsqueezy.com/api/subscriptions/cancel-subscription), [Update a Subscription (resume)](https://docs.lemonsqueezy.com/api/subscriptions/update-subscription), [The Subscription Object (renews_at, ends_at, urls.customer_portal)](https://docs.lemonsqueezy.com/api/subscriptions/the-subscription-object), [Recovery and Dunning (renewal reminder email)](https://docs.lemonsqueezy.com/help/online-store/recovery-dunning).
