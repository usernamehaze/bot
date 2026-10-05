/* Cassie's server — see server/README.md.
   Paste your Worker URL between the quotes, e.g. 'https://cassie.yourname.workers.dev'.
   With it, people can use Cassie without their own Groq key, and you get the usage
   dashboard and feedback. Leave it empty and everyone adds their own free key. */
window.CASSIE_SERVER = window.CASSIE_SERVER ?? 'https://cassie.failanzahazel.workers.dev';

/* Optional: "Continue with Google" on the sign-in page. Paste your Google OAuth
   Client ID (ends in .apps.googleusercontent.com) — see server/README.md. */
window.CASSIE_GOOGLE_CLIENT_ID = window.CASSIE_GOOGLE_CLIENT_ID ?? '';
