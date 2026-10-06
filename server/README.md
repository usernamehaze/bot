# Cassie server (one Cloudflare Worker)

One small server that does four jobs (five with Claude):

1. **No keys needed.** People can use Cassie without making a Groq account. The
   server answers with *your* Groq key, which stays secret here.
2. **Backup brain.** When Groq is busy or out of free questions, Cloudflare
   Workers AI answers instead, so users don't see an error.
3. **Usage dashboard.** How many people use Cassie, how often they open it, the
   most-used features, and common topic words.
4. **Feedback.** Thumbs up/down on answers, plus "Report a problem" messages.

It runs on Cloudflare's free tier. No credit card is needed to start.

## Before you start

Get a Groq key at [console.groq.com/keys](https://console.groq.com/keys). Use a
**new** key that you have never shared or pasted anywhere public.

## Deploy it (about 10 minutes)

1. Go to **dash.cloudflare.com** and sign up or log in.
2. **Workers & Pages** → **Create** → **Create Worker**. Name it `cassie`, then
   click **Deploy**.
3. Click **Edit code**. Delete everything, paste the whole of
   [`worker.js`](./worker.js), then click **Deploy**.
4. **Database** (for the dashboard, fair-use limits and feedback):
   - Left menu: **Storage & Databases** → **D1 SQL Database** → **Create**.
     Name it `cassie`.
   - Open your Worker → **Settings** → **Bindings** → **Add** → **D1 database**.
     Variable name: `DB`. Database: `cassie`. **Save**.
   - You don't need to make any tables. The server creates them itself.
5. **Backup brain:** in the same **Bindings** → **Add** → **Workers AI**.
   Variable name: `AI`. **Save**.
6. **Secrets:** go to **Settings** → **Variables and Secrets** → **Add**, and add
   both of these as type **Secret**:
   - `GROQ_KEY`: your Groq key.
   - `ADMIN_TOKEN`: a long password only you know. It opens the dashboard.
7. Copy the Worker's URL. It looks like `https://cassie.<your-name>.workers.dev`.

## Connect Cassie to it

Open [`config.js`](../config.js) and paste the URL between the quotes:

```js
window.CASSIE_SERVER = window.CASSIE_SERVER || 'https://cassie.<your-name>.workers.dev';
```

Or send the URL and it will be done for you. After that:

- New users can chat straight away, with no key.
- Users who add their own key still use it. If their key runs out, the server
  takes over.
- Usage counts and feedback start appearing on your dashboard.

## Check it works

Open your Worker URL in a browser and enter your `ADMIN_TOKEN`. That's your
dashboard. Then ask Cassie something on a phone that has no key. On the
dashboard, the **Questions answered through your server** row should go up.

## Accounts and "Continue with Google" (optional)

Once Cassie is connected to this server, a sign-in page opens first. People can
create an account with an email and password, or tap **Continue without an
account**. An account keeps their name, grade, settings and saved quiz mistakes
on every device. Chats and API keys never leave their device.

To add **Continue with Google**:

1. Go to **console.cloud.google.com** → create a project, for example `Cassie`.
2. **APIs & Services** → **OAuth consent screen**: choose **External**, enter the
   app name `Cassie` and your email, and save.
3. **APIs & Services** → **Credentials** → **Create credentials** → **OAuth
   client ID** → **Web application**.
   - Under **Authorized JavaScript origins**, add `https://askcassie.pages.dev`
     and `https://usernamehaze.github.io`.
   - Click **Create**, then copy the **Client ID**. It ends in
     `.apps.googleusercontent.com`.
4. In this Worker → **Settings** → **Variables and Secrets** → add a **Text**
   variable named `GOOGLE_CLIENT_ID` with that Client ID.
5. Send the Client ID to be put in `config.js`, or paste it there yourself.

There's no "reset password" email yet. People who forget their password can
use Continue with Google with the same email, which signs them into the same
account.

## Make pictures reliable: add your Gemini key (free, recommended)

Photos, snips and the board need an AI that can read pictures. Groq's picture
models come and go, so give the server a second one:

1. Go to **aistudio.google.com/apikey** → **Create API key**, and copy it.
2. In this Worker → **Settings** → **Variables and Secrets** → **Add** → type
   **Secret**, name `GEMINI_KEY`, paste the key → **Deploy**.

## The brain check (do this before you launch)

Your dashboard has a **Brain check** card. **Run brain check now** asks every AI the
server uses real questions with known answers: 17 × 23, a picture of 7 × 8, and
"graph y = x² − 4". Each row shows ✅ or ❌ with the reason. If anything is ❌,
students would hit it too.

To run it by itself every day: Worker → **Settings** → **Triggers** → **Cron
Triggers** → **Add** → `0 22 * * *` (6 a.m. in the Philippines) → **Add**. The
dashboard then always shows this morning's result.

The same card lists **Problems Cassie hit**: every time the server couldn't
answer, and errors the app ran into (only the error message, never what the
student asked).

## Make Claude Cassie's brain (optional, costs money)

With this on, the main chat and photos are answered by Claude, Anthropic's AI. Groq
and Workers AI stay as the backup, so Cassie still answers if Claude is busy or a
person runs out of Claude answers for the day.

1. Go to **console.anthropic.com**, sign up, and add a payment method under
   **Billing**. Claude has no free tier.
2. Still in the console: **Limits** → set a **monthly spend limit** you're
   comfortable with, so you can never get a surprise bill.
3. **API keys** → **Create key**. Copy it (it starts with `sk-ant-`).
4. In this Worker → **Settings** → **Variables and Secrets** → **Add** → type
   **Secret**, name `ANTHROPIC_KEY`, paste the key → **Deploy**.

That's all. The app notices within a few minutes. Your dashboard's "Questions
answered through your server" card then shows a **Claude** row.

Optional variables (type **Text**):

- `CLAUDE_DAILY_LIMIT`: Claude answers per person per day (default 40). After
  that, Groq answers. This is your main cost control.
- `CLAUDE_MODEL`: which Claude model to use. By default Cassie picks Anthropic's
  newest Opus model (its most capable everyday model) automatically. To use a
  cheaper one, put its model ID here (listed at docs.anthropic.com → Models).
- `CLAUDE_EFFORT`: `low`, `medium` (default) or `high`, how long Claude thinks
  before answering. `low` is faster and cheaper; `high` is best for hard maths.

**Rough cost:** a typical question with Opus is around one to three US cents;
a photo question costs a little more. Check current prices at
anthropic.com/pricing. Watch the Claude row on your dashboard and the spending
page in the Anthropic console.

## The iPhone "Ask Cassie" Shortcut

`GET /ask?text=…` returns a short plain-text answer. The iPhone Shortcut (steps in
Cassie → Settings → Use Cassie in other apps) shows it in a pop-up over the app the
student is in, so no new browser tab opens. Each network gets 40 of these a day;
change that with a `ASK_LIMIT` variable. They show on the dashboard as
**iPhone Shortcut**.

## Fair use and cost

- Each person can ask **150 questions a day** through your key, and at most 12
  a minute. To change this, add variables `DAILY_LIMIT` and `MINUTE_LIMIT`
  under **Settings** → **Variables and Secrets**.
- The Groq free plan has daily limits, and every user shares them. When the
  dashboard shows lots of **Workers AI (backup)** answers, Groq is running out.
  Then either:
  - upgrade Groq to pay-as-you-go at console.groq.com → Settings → Billing, and
    set a **monthly spending limit** there so you can't get a surprise bill; or
  - tell heavy users to add their own free key in Settings.
- Workers AI includes a free daily amount. After that it charges small amounts
  per question, but only if you've added a paid Cloudflare plan. Otherwise it
  stops and Cassie shows "very busy, try again".
- Photos are read with your Groq key (Llama 4 Scout). If Groq is down, photo
  questions can't use the backup.

## What it stores

| Stored | Never stored |
|---|---|
| A random ID per device, how many questions it asked today | Chat messages or answers (they pass through to Groq and are not saved) |
| Open and feature counts; student or working, grade group, age range, device | Names, emails, exact ages, files, photos |
| Topic keywords from adults who allowed it | Anything from Talk mode |
| Feedback and reports that users choose to send | |
| Accounts: email, a scrambled (hashed) password, profile, settings, saved quiz mistakes | Chats, files, API keys, or the password itself |

## Changing the server

Edit `worker.src.js` or `dashboard.html`, run `python3 build.py` in this folder,
then paste the new `worker.js` into Cloudflare again. Your data is kept.

Only Cassie's own sites can use the server: askcassie.pages.dev,
usernamehaze.github.io and localhost. If you host Cassie somewhere else, add a
variable `ALLOWED_ORIGINS` listing your sites, separated by commas.
