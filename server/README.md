# Cassie usage stats (Cloudflare Worker + D1)

This shows you **how many people use Cassie, how often they open it, which
features they use most, and the most common topic words** in chats. It runs on
a Cloudflare Worker with a D1 database.

**Free** on Cloudflare's free tier. No credit card.

## What it collects (and what it doesn't)

| Sent | Never sent |
|---|---|
| A random ID made on the user's device | Names, emails, exact ages |
| Each time Cassie is opened | Full messages or Cassie's answers |
| Which feature was used (chat, quiz, graph, picture, research…) | Files, photos, API keys |
| Student or working, school level, age range, phone or computer | Anything from Talk mode |
| Up to 5 topic keywords per message, **adults (18+) who left it on** | Words from anyone under 18 |

Users can switch both off in **Settings → You**. The extension does not send stats.

## Deploy it (about 10 minutes)

1. Go to **dash.cloudflare.com** and log in. You can use the same account as the
   Cassie proxy.
2. **Workers & Pages** → **Create** → **Create Worker**. Name it something like
   `cassie-stats`, then click **Deploy**.
3. Click **Edit code**. Delete everything, paste the contents of
   [`worker.js`](./worker.js), then click **Deploy**.
4. Create the database:
   - Left menu: **Storage & Databases** → **D1 SQL Database** → **Create**.
     Name it `cassie-stats`.
   - Open the Worker → **Settings** → **Bindings** → **Add** → **D1 database**.
   - Variable name: `DB`. Database: `cassie-stats`. **Save**.
   - You don't need to create any tables. The Worker creates them itself.
5. Set your dashboard password:
   - Worker → **Settings** → **Variables and Secrets** → **Add**.
   - Name: `ADMIN_TOKEN`. Value: a long password only you know. Click **Encrypt**,
     then **Save**.
6. Copy the Worker's URL. It looks like
   `https://cassie-stats.<your-subdomain>.workers.dev`.

## Connect Cassie to it

In `app.js`, find this line:

```js
const ANALYTICS_URL = window.CASSIE_ANALYTICS_URL || '';
```

Put your URL in the quotes, with `/e` added to the end:

```js
const ANALYTICS_URL = window.CASSIE_ANALYTICS_URL || 'https://cassie-stats.<your-subdomain>.workers.dev/e';
```

Or send the URL and it will be wired in for you. Until a URL is set, Cassie
sends nothing.

## See your numbers

Open the Worker URL (`https://cassie-stats.<your-subdomain>.workers.dev`) in a
browser and enter your `ADMIN_TOKEN`. The dashboard shows:

- **Total users**, plus active today and this week
- **Opens** and opens per user, with a daily chart of active users and opens
- **New users** per day
- **Most-used features**
- **Top topic words**
- **Who uses Cassie**: student or working, grade level, age range, and device
- **Most active users**: anonymous IDs with their open and use counts

Change the range (7, 30, 90 or 365 days) at the top. Days follow Philippine time.

## Notes

- Only Cassie's own sites can send events: askcassie.pages.dev,
  usernamehaze.github.io and localhost. If you host Cassie elsewhere, add a
  variable `ALLOWED_ORIGINS` with your sites, separated by commas.
- To change the dashboard: edit `dashboard.html` or `worker.src.js`, run
  `python3 build.py` in this folder, then paste the new `worker.js` again.
- D1's free tier allows 5 million reads and 100,000 writes a day. Events are
  sent in batches, so this covers a lot of users.
