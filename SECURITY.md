# Cassie security notes

What protects Cassie, what the owner has to do, and what to re-check after big changes.
Last full audit: October 2026.

## Where the secrets live

- **All API keys (Groq, Gemini, Anthropic) and `ADMIN_TOKEN` live only in the Cloudflare
  Worker's settings** (Settings → Variables and Secrets, type **Secret**). None are in this
  repository, the website, or the extension, and the git history was scanned for leaked keys
  (none found).
- `config.js` holds only the server's public address. That is not a secret.
- Students can add their *own* free Groq/Gemini keys in Settings. Those stay in their browser
  (localStorage) and go straight to Groq/Google, never to Cassie's server.
- `.gitignore` refuses `.env`, `.dev.vars`, `*.pem` and `*.key` files, so a key file can't be
  committed by accident.

## The website (Cloudflare Pages)

`_headers` sends these on every page:

| Header | What it stops |
|---|---|
| `Content-Security-Policy` | Injected scripts: only Cassie's own files run (no inline scripts, no `eval`), and the page may only talk to the services it uses. **If Cassie starts using a new service, add it to `connect-src`, or it will be blocked.** |
| `X-Frame-Options: DENY` + `frame-ancestors 'none'` | Other sites putting Cassie in a hidden frame (clickjacking) |
| `X-Content-Type-Options: nosniff` | A file being treated as a script because of what's inside it |
| `Referrer-Policy` | Other sites seeing full Cassie page addresses |
| `Permissions-Policy` | Anything but the microphone being asked for |
| `Strict-Transport-Security` | Plain-http connections |

The tests serve the site with the same headers and **fail if the security policy blocks
anything**, so a new feature that needs a new service is caught before it ships.

Third-party libraries are served from `vendor/` (not a CDN), pinned to patched versions:
pdf.js 4.10.38 (with `isEvalSupported: false`, the fix for CVE-2024-4367), jsPDF 4.2.1,
Mammoth 1.13.0, JSZip 3.10.2. Licences are in `vendor/licenses/`.

## The server (Cloudflare Worker)

- **Admin routes** (`/stats`, `/health`, the dashboard) need `ADMIN_TOKEN`, compared in
  constant time. It must be at least 16 characters; 10 wrong tries locks that network out for
  an hour. The dashboard page only runs its own script (a fresh nonce each visit) and can't be
  framed.
- **Accounts:** passwords are stored only as salted PBKDF2-SHA256 hashes (100,000 rounds, the
  most Cloudflare Workers allow). Sign-in tokens are random; only their SHA-256 is stored.
  Password tries are limited per account (15/hour) and per network (100/hour). Signing in with
  Google to an email that already had a password account removes that password and signs out
  its old sessions (stops someone pre-registering another person's email).
- **Each user only reaches their own data:** `/auth/me` and `/auth/save` work only with that
  account's own sign-in token. Study rooms are joined by code; a classmate can only erase their
  own strokes.
- **Rate limits:** questions, pictures, voice and Claude answers have daily allowances per
  person *and* per network (so made-up ids don't get around them), plus per-minute limits on
  every route that writes to the database.
- **Database:** every query uses bound parameters (no SQL built from user text).
- **Errors:** visitors get a plain message; details go to the dashboard's problem list.
- **CORS** only lets Cassie's own sites and the extension call the server from a browser.
  This is not a lock (scripts outside a browser can ignore it); the rate limits are what
  protect the keys.

## What only the owner can do

1. **Paste the new `server/worker.js` into the Worker** after any server change.
2. **Set a strong `ADMIN_TOKEN`** (20+ random characters, e.g. from a password manager).
3. **Set spending limits** in the Groq, Google AI Studio and Anthropic consoles, so even a
   determined abuser can't run up a bill.
4. Optional: in Cloudflare → Security, turn on Bot Fight Mode and a rate-limiting rule for the
   Worker.
5. Use two-factor sign-in on GitHub, Cloudflare and every AI provider account.

## Known limits (honest)

- No audit makes a site un-hackable; this one covers the common, known kinds of attack.
- Anyone can still use the free allowance from many networks; the per-network limits and the
  provider spending caps are what bound the cost.
- The per-minute limits are counted per Worker instance, so they're a guard rail, not exact.
