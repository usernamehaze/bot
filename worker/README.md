# Cassie proxy (Cloudflare Worker)

This tiny server lets people use Cassie **without their own Groq key**. It holds
one Groq key as a secret and forwards Cassie's questions to Groq, with rate
limiting so the shared key can't be drained or abused.

**Free** on Cloudflare's Workers free tier (100,000 requests/day). No credit card.

## Before you start

**Rotate your key first.** At [console.groq.com/keys](https://console.groq.com/keys),
delete any key that has been shared and create a fresh one. Copy the new key —
you'll paste it in step 4.

## Deploy it (about 5 minutes)

1. Go to **dash.cloudflare.com** and sign up / log in (free).
2. In the left menu: **Workers & Pages** → **Create** → **Create Worker**.
3. Give it a name (e.g. `cassie-proxy`) → **Deploy** (it deploys a placeholder).
4. Click **Edit code**. Delete everything in the editor, paste the contents of
   [`worker.js`](./worker.js), then **Deploy**.
5. Add your key as a secret:
   - Open the Worker → **Settings** → **Variables and Secrets**.
   - **Add** a variable, name it exactly `GROQ_KEY`, paste your fresh Groq key,
     click **Encrypt**, then **Save**.
6. (Recommended) Turn on rate limiting so one person can't hog the key:
   - **Workers & Pages** → **KV** → **Create a namespace** (e.g. `cassie-rl`).
   - Back in the Worker → **Settings** → **Bindings** → **Add** → **KV namespace**.
   - Variable name: `RL`. Namespace: the one you just made. **Save**.
7. Copy the Worker's URL — it looks like
   `https://cassie-proxy.<your-subdomain>.workers.dev`.

## Test it

Replace the URL below with yours and run it (or just open the URL in a browser —
a GET returns "Use POST.", which means it's live):

```bash
curl -X POST https://cassie-proxy.<your-subdomain>.workers.dev \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"say hi"}]}'
```

You should get a JSON reply from Groq.

## Then

Send that Worker URL back and Cassie will be wired to use it, so users need no
key. Anyone who prefers to use their own key can still paste one — Cassie will
use their key instead of the proxy when they do.

## Notes

- The key lives only in the Worker secret — it is never in Cassie's code or
  visible to users.
- The proxy only allows Cassie's chat request and a fixed list of models, and
  caps response length, so it can't be repurposed.
- All users share this one key's Groq limits. Fine for small groups; heavy public
  use may hit the free daily cap (then you'd raise limits on a paid Groq plan).
