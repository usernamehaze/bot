/* Cassie server — one Cloudflare Worker (free tier) that does three jobs:
 *
 *   GET  /config     tells the app what this server can do (for example, whether Claude is on)
 *   GET  /ask?text=  a quick plain-text answer for the iPhone "Ask Cassie" Shortcut (shown in a
 *                    pop-up over the app the student is in, with no new browser tab)
 *   POST /chat       answers questions for people who haven't added their own Groq key,
 *                    using YOUR Groq key (kept secret here), with Cloudflare Workers AI as
 *                    an automatic backup when Groq is busy or out of free questions
 *   POST /e          anonymous usage counts (no login, no names, no messages)
 *   POST /image      makes a picture with Workers AI when the free picture service is busy
 *   POST /f          "Report a problem" notes
 *   POST /auth/...   Cassie accounts: sign up, sign in (email + password, or Google),
 *                    and the profile / saved mistakes that follow a person to every device
 *   GET  /           your dashboard (asks for your ADMIN_TOKEN)
 *   GET  /stats      the numbers behind the dashboard (needs the token)
 *   GET  /health     the "brain check": asks every AI real questions with known answers (needs
 *                    the token). Also runs once a day with a Cron Trigger (see server/README.md)
 *
 * Bindings (Worker → Settings → Bindings / Variables and Secrets):
 *   DB           a D1 database (tables are created automatically)
 *   ADMIN_TOKEN  secret — a password you choose for the dashboard (16+ characters)
 *   GROQ_KEY     secret — your Groq API key (console.groq.com/keys)
 *   AI           Workers AI binding — the backup brain (optional but recommended)
 *   GOOGLE_CLIENT_ID  (optional) turns on "Continue with Google" — see server/README.md
 *   GEMINI_KEY        (optional) secret — your Google AI Studio key: a second brain for photos and
 *                     text when Groq can't (aistudio.google.com/apikey). With billing on for the key,
 *                     it also makes Cassie's pictures (Gemini's image model; ~$0.07 a picture).
 *                     FREE_PICTURES_WEEK (3) / PLUS_PICTURES_DAY (5) / PRO_PICTURES_DAY (20) set how many;
 *                     GEMINI_PICTURES=off turns pictures off; GEMINI_IMAGE_MODEL picks the model.
 *   ANTHROPIC_KEY     (optional) secret — makes Claude Cassie's brain for the main chat and
 *                     photos (console.anthropic.com → API keys). Groq and Workers AI stay as backup.
 * Optional variables:
 *   FREE_DAILY_QUESTIONS  questions a free student asks a day (default 20; the website says 20)
 *   DAILY_LIMIT      all requests per free student per day, including file sections and helpers
 *                    (default 150 — a ceiling against abuse, not the "questions" students see)
 *   PLUS_DAILY_QUESTIONS / PRO_DAILY_QUESTIONS  fair use on paid plans (default 100 / 150)
 *   MINUTE_LIMIT     questions per person per minute (default 12)
 *   IMAGE_LIMIT      backup pictures per person per day (default 20)
 *   Claude is for paid plans (rows in the plans table — see /admin/plan below):
 *   FREE_CLAUDE_LIMIT   Claude answers a day for free students (default 10, on Haiku: about $0.001 each;
 *                       0 = none, Groq answers)
 *   PLUS_CLAUDE_LIMIT   Claude Haiku answers a day on Plus (default 100)
 *   PRO_CLAUDE_LIMIT    Claude Sonnet answers a day on Pro (default 15), then Haiku (PRO_HAIKU_LIMIT, 100)
 *   CLAUDE_MODEL     one Claude model for everyone (default: the newest Haiku / Sonnet for each
 *                    plan, looked up automatically from the Models API)
 *   CLAUDE_EFFORT    how hard Claude thinks: low, medium or high (default medium)
 *   ASK_LIMIT        Shortcut answers per network per day (default 40)
 *   TRANSCRIBE_DAILY_LIMIT  voice recordings written down per network per day (default 3000)
 *   ELEVENLABS_API_KEY  (secret) Cassie's studio voice: reads answers, quizzes and flashcards aloud
 *   SPEAK_DAILY_CHARS   characters of studio voice per student per day (default 12000, about 15 minutes)
 *   SPEAK_MONTHLY_CHARS characters of studio voice for the whole app per month (default 9500)
 *   ELEVENLABS_VOICE_WOMAN / ELEVENLABS_VOICE_MAN / ELEVENLABS_MODEL  optional voice and model choices
 *   ALLOW_EXTENSION  set to "off" to stop the Chrome / Edge extension using this server
 *   ALLOWED_ORIGINS  comma-separated sites allowed to use this server
 *                    (default: askcassie.study, www.askcassie.study, localhost)
 * Days are counted in Philippine time (UTC+8).
 */

const TZ_OFFSET_H = 8;
/* Cassie's care response (care.js, put here by build.py): a student who says they want to hurt or
   kill themselves gets care before anything else, from any app, the extension or the Shortcut. */
/* Cassie's care response: when a student says they want to hurt or kill themselves, or
   describes hurting themselves, Cassie answers with care before anything else.

   One file for every place a question comes in: the app (chat, Talk with Cassie, Labs and the 3D
   views), the Chrome extension (a copy: extension/care.js) and Cassie's server (server/build.py
   puts this file inside worker.js). It only defines window.CassieCare / globalThis.CassieCare.

     CassieCare.check(text)   → null, or { lang: 'en' | 'fil' } when the words say the student is at risk
     CassieCare.reply(lang)   → the care message as plain text (for the chat history and the extension)
     CassieCare.fromAI(reply) → { aiWords } when the AI's reply starts with MARK, else null
     CassieCare.spoken(lang)  → a short version to say out loud (the numbers go on screen)
     CassieCare.card(lang)    → the message as an element, with the numbers as buttons to call
     CassieCare.MARK          → "[[CARE]]": the AI starts its reply with it when it judges the student
                                is at risk (CassieCare.INSTRUCTION, in every system prompt)
     CassieCare.LINES         → the crisis lines (only numbers checked on the service's own site)

   The word list is careful: it looks for the student talking about themselves (English, Filipino,
   Taglish), so "the character kills himself in the novel" or "cell suicide (apoptosis)" is not
   matched. Anything it misses, the AI's own judgement catches. */
(function (root) {
  'use strict';

  // Checked on the service's own site before adding. Add a line only the same way.
  //   NCMH Crisis Hotline: https://ncmh.gov.ph/contact-us/ (24/7, from Services: https://ncmh.gov.ph/services-and-facilities/)
  const LINES = [
    { name: 'NCMH Crisis Hotline', note: { en: 'free, any time, day or night', fil: 'libre, bukas araw at gabi' }, numbers: [
      { label: { en: 'Nationwide', fil: 'Buong bansa' }, show: '1553', tel: '1553' },
      { label: { en: 'Toll free', fil: 'Toll free' }, show: '1800 1888 1553', tel: '180018881553' },
      { label: { en: 'Smart or TNT', fil: 'Smart o TNT' }, show: '0919 057 1553', tel: '09190571553' },
      { label: { en: 'Globe or TM', fil: 'Globe o TM' }, show: '0917 899 8727', tel: '09178998727' },
      { label: { en: 'Globe or TM', fil: 'Globe o TM' }, show: '0966 351 4518', tel: '09663514518' },
    ] },
  ];

  const MARK = '[[CARE]]';

  // The student talking about themselves. (Lower case, apostrophes straightened, spaces squeezed.)
  const AT_RISK = {
    en: [
      /\b(?:kill|killing|end|ending)\s+my\s?self\b(?!\s+laughing)/,
      /\b(?:end|take|ending|taking)\s+my\s+(?:own\s+)?life\b/,
      /\bend\s+it\s+all\b/,
      /\bi\s+(?:really\s+|just\s+|honestly\s+)?(?:want|wanna|wish|need)\s+(?:to\s+)?(?:die|be\s+dead|not\s+(?:be\s+)?(?:alive|here)|disappear\s+forever)\b/,
      /\bi\s+wish\s+i\s+(?:was|were)\s+(?:dead|never\s+born)\b/,
      /\b(?:i\s+(?:don'?t|do\s+not|dont)|i\s+no\s+longer)\s+want\s+to\s+(?:live|be\s+alive|exist|wake\s+up)\b/,
      /\b(?:i'?m|i\s+am|everyone(?:'s|\s+is|\s+would\s+be))\s+better\s+off\s+(?:dead|without\s+me)\b/,
      /\bno\s+(?:reason|point)\s+(?:to|in)\s+(?:live|living|being\s+alive|going\s+on)\b/,
      /\bi\s+can'?t\s+(?:go\s+on|do\s+this)\s+any\s?more\b.*\b(?:die|dead|live|life)\b/,
      /\b(?:i'?m|i\s+am|i\s+feel|i'?ve\s+been|feeling|getting)\s+(?:so\s+|really\s+|very\s+)?suicidal\b/,
      /\b(?:i\s+(?:want|wanna|plan|am\s+going|'?m\s+going|keep\s+thinking|think|thought|tried|attempted)|thinking\s+(?:about|of)|thoughts\s+of)\s+(?:to\s+|about\s+|of\s+)?(?:commit(?:ting)?\s+|attempt(?:ing)?\s+)?suicide\b/,
      /\bhow\s+(?:to|do\s+i|can\s+i)\s+(?:commit\s+suicide|kill\s+my\s?self|end\s+my\s+life|die\s+painlessly)\b/,
      /\bpainless\s+way\s+to\s+die\b/,
      /\bi\s+(?:want|wanna|need|keep\s+wanting|am\s+going|'?m\s+going|'?m\s+gonna|plan|feel\s+like\s+i\s+want)\s+(?:to\s+)?(?:hurt|harm|cut|burn)\s+my\s?self\b/,
      /\bi(?:'?ve|\s+have)?\s+(?:been\s+)?(?:hurting|harming|cutting|burning)\s+my\s?self\b/,
      /\bi\s+(?:hurt|harm|cut|burn)\s+my\s?self\s+(?:on\s+purpose|again|every|when|because|to\s+feel)\b/,
      /\bi\s+(?:self\s?harm|self\s+harm)\b|\bi(?:'?ve|\s+have)\s+been\s+self\s?harming\b/,
      /\b(?:take|took|swallow|swallowed)\s+(?:all\s+)?(?:my|the)\s+pills\s+(?:to\s+die|at\s+once)\b|\bi\s+(?:want|wanna|'?m\s+going)\s+to\s+overdose\b/,
    ],
    fil: [
      /\b(?:gusto|gustong|gusto\s+ko|parang\s+gusto\s+ko)\s+(?:na\s+|nang\s+|ng\s+)?(?:ko\s+)?(?:na\s+|nang\s+)?magpa(?:ka)?matay\b/,
      /\bmagpapakamatay\s+(?:na\s+)?(?:lang\s+)?ako\b|\bako\s+(?:ay\s+)?magpapakamatay\b|\bmagpakamatay\s+na\s+lang\s+(?:ako|kaya)\b/,
      /\b(?:ayoko|ayaw\s+ko|ayaw\s+ko\s+na)\s+(?:na\s+|nang\s+)?(?:ng\s+)?(?:mabuhay|mag\s?live)\b/,
      /\bayoko\s+na\s+sa\s+buhay\b|\bpagod\s+na\s+(?:ako|akong)\s+(?:na\s+)?mabuhay\b/,
      /\bgusto\s+ko\s+(?:na\s+|nang\s+)?(?:lang\s+)?(?:mamatay|mawala\s+na)\b/,
      /\bsana\s+(?:mamatay|patay|mawala)\s+na\s+(?:lang\s+)?ako\b/,
      /\b(?:mas\s+mabuti\s+pang|mas\s+okay\s+pang)\s+(?:patay|mamatay)\s+na\s+(?:lang\s+)?ako\b/,
      /\bwala\s+(?:nang|na|ng)\s+(?:saysay|kwenta|kuwenta)\s+(?:ang\s+)?buhay\s+ko\b/,
      /\b(?:papatayin|patayin)\s+ko\s+(?:na\s+)?(?:lang\s+)?(?:ang\s+)?(?:sarili\s+ko|aking\s+sarili)\b/,
      /\b(?:sasaktan|sinasaktan|saktan|nasasaktan\s+ko\s+ang)\s+ko\s+(?:na\s+)?(?:ulit\s+)?(?:ang\s+)?(?:sarili\s+ko|aking\s+sarili)\b|\bsinasaktan\s+ko\s+ang\s+sarili\s+ko\b/,
      /\b(?:naglalaslas|maglalaslas|naglaslas)\s+(?:na\s+)?(?:ulit\s+)?ako\b|\bnilalaslas\s+ko\b|\bnilaslas\s+ko\s+(?:ang\s+)?(?:pulso|braso)\s+ko\b/,
      /\btapusin\s+(?:ko\s+)?(?:na\s+)?(?:ang\s+)?buhay\s+ko\b/,
    ],
    taglish: [
      /\b(?:gusto\s+ko\s+(?:na\s+|nang\s+)?|parang\s+)mag\s?(?:su-?)?suicide\b|\bmag\s?(?:su-?)?suicide\s+na\s+(?:lang\s+)?(?:ako|ko)\b|\bsuicide\s+na\s+lang\s+(?:ako|ko)\b/,
      /\b(?:i\s+want\s+to\s+die|kill\s+my\s?self|end\s+my\s+life)\s+na\b/,
    ],
  };
  // Studying a story, a poem, history or biology: the words alone don't decide (the AI judges it)
  const STUDYING = /\b(?:novel|story|poem|character|protagonist|narrator|author|chapter|play|hamlet|romeo|juliet|ophelia|macbeth|othello|lyrics|song|movie|film|essay|summar(?:y|ize)|symboli[sz]e|theme|kwento|nobela|tauhan|tula|kabanata|stanza|verse|apoptosis|cell|cells|bomber|squeeze)\b/;
  // …unless the student clearly means themselves
  const SELF = /\b(?:i'?m|i\s+am|i\s+want|i\s+wanna|i\s+feel|i'?ve|i\s+have|ako|ko\s+na|ko\s+nang)\b/;

  const norm = (t) => ' ' + String(t || '').toLowerCase().replace(/[’‘`´]/g, "'").replace(/[^\p{L}\p{N}'\s?.,!]/gu, ' ').replace(/\s+/g, ' ') + ' ';

  function check(text) {
    const t = norm(text);
    if (t.trim().length < 4) return null;
    const hit = (list) => list.some((re) => re.test(t));
    const fil = hit(AT_RISK.fil) || hit(AT_RISK.taglish);
    const en = hit(AT_RISK.en);
    if (!fil && !en) return null;
    // studying: what a character says (in quote marks, or after he / she / they) isn't the student
    if (STUDYING.test(t) && !SELF.test(norm(String(text || '').replace(/["“”«»][^"“”«»]*["“”«»]/g, ' ')).replace(/\b(?:he|she|they|the\s+character)\b[^.?!]*/g, ''))) return null;
    // the language of the reply: Filipino when the student wrote Filipino or Taglish
    return { lang: fil ? 'fil' : langOf(text) };
  }

  const WORDS = {
    en: {
      open: 'I’m really glad you told me. What you’re feeling matters, and you matter.',
      safe: 'Are you safe right now?',
      call: 'If you might hurt yourself, please call someone now. You don’t have to go through this alone.',
      adult: 'Please also tell an adult you trust, like a parent, a teacher or your guidance counselor.',
      stay: 'I’m here, and I’ll keep listening. Do you want to tell me what’s been happening?',
      spoken: 'I’m really glad you told me. You matter. Are you safe right now? I’ve put a free crisis line on your screen. You can call it any time, day or night. And please tell an adult you trust. I’m here, and I’m listening.',
    },
    fil: {
      open: 'Salamat at sinabi mo sa akin. Mahalaga ang nararamdaman mo, at mahalaga ka.',
      safe: 'Ligtas ka ba ngayon?',
      call: 'Kung baka saktan mo ang sarili mo, tumawag ka na ngayon. Hindi mo kailangang harapin ito nang mag isa.',
      adult: 'Sabihin mo rin sa isang nakatatandang pinagkakatiwalaan mo, gaya ng magulang, guro o guidance counselor.',
      stay: 'Nandito lang ako, at makikinig ako. Gusto mo bang ikuwento kung ano ang nangyayari?',
      spoken: 'Salamat at sinabi mo sa akin. Mahalaga ka. Ligtas ka ba ngayon? Nilagay ko sa screen mo ang libreng crisis hotline. Puwede mo itong tawagan kahit kailan, araw o gabi. Sabihin mo rin sa isang nakatatandang pinagkakatiwalaan mo. Nandito lang ako, at nakikinig ako.',
    },
  };
  const w = (lang) => WORDS[lang === 'fil' ? 'fil' : 'en'];

  function linesText(lang) {
    const L = lang === 'fil' ? 'fil' : 'en';
    return LINES.map((l) => `${l.name} (${l.note[L]}):\n` + l.numbers.map((n) => `${n.label[L]}: ${n.show}`).join('\n')).join('\n\n');
  }
  // (aiWords: when it was the AI that noticed, its own warm words open the message)
  function reply(lang, aiWords) {
    const x = w(lang), open = aiWords && String(aiWords).trim();
    return open ? `${open}\n\n${x.call}\n\n${linesText(lang)}\n\n${x.adult}` : `${x.open} ${x.safe}\n\n${x.call}\n\n${linesText(lang)}\n\n${x.adult}\n\n${x.stay}`;
  }
  // a reply the AI started with the mark: { aiWords } (null when it didn't)
  function fromAI(text) {
    const t = String(text || '');
    const i = t.indexOf(MARK);
    if (i < 0 || i > 40) return null;
    return { aiWords: t.slice(i + MARK.length).replace(/^[\s:.-]+/, '').trim() };
  }
  // what Cassie says out loud: her words, and where the numbers are (on the screen)
  const POINT = { en: 'I’ve put a free crisis line on your screen. You can call it any time, day or night. And please tell an adult you trust. I’m here, and I’m listening.', fil: 'Nilagay ko sa screen mo ang libreng crisis hotline. Puwede mo itong tawagan kahit kailan, araw o gabi. Sabihin mo rin sa isang nakatatandang pinagkakatiwalaan mo. Nandito lang ako, at nakikinig ako.' };
  const spoken = (lang, aiWords) => (aiWords && String(aiWords).trim() ? `${String(aiWords).trim()} ${POINT[lang === 'fil' ? 'fil' : 'en']}` : w(lang).spoken);
  // the language to answer in, for a reply the AI flagged
  const langOf = (text) => ((norm(text).match(/\b(?:ako|ko|na|nang|ng|ang|sa|mga|lang|ayoko|gusto|sarili|buhay|talaga|po|kasi|wala|hindi)\b/g) || []).length >= 2 ? 'fil' : 'en');

  // The message as an element: the AI's own warm words (when it was the AI that noticed), or ours,
  // then the lines, each number a button that calls it.
  function card(lang, aiWords) {
    const x = w(lang), L = lang === 'fil' ? 'fil' : 'en';
    const box = document.createElement('div');
    box.className = 'care';
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', L === 'fil' ? 'Tulong ngayon' : 'Help right now');
    const p = (cls, text) => { const e = document.createElement('p'); e.className = cls; e.textContent = text; return e; };
    if (aiWords && String(aiWords).trim()) box.appendChild(p('care-open', String(aiWords).trim()));
    else box.appendChild(p('care-open', `${x.open} ${x.safe}`));
    box.appendChild(p('care-call', x.call));
    for (const l of LINES) {
      const sec = document.createElement('div'); sec.className = 'care-line';
      const h = document.createElement('p'); h.className = 'care-name';
      const b = document.createElement('b'); b.textContent = l.name; h.appendChild(b);
      h.appendChild(document.createTextNode(` · ${l.note[L]}`));
      sec.appendChild(h);
      const nums = document.createElement('div'); nums.className = 'care-nums';
      for (const n of l.numbers) {
        const a = document.createElement('a');
        a.className = 'care-num'; a.href = 'tel:' + n.tel;
        a.setAttribute('aria-label', `${L === 'fil' ? 'Tawagan ang' : 'Call'} ${l.name}, ${n.label[L]}, ${n.show}`);
        const s = document.createElement('small'); s.textContent = n.label[L];
        const v = document.createElement('span'); v.textContent = n.show;
        a.append(s, v);
        nums.appendChild(a);
      }
      sec.appendChild(nums);
      box.appendChild(sec);
    }
    box.appendChild(p('care-adult', x.adult));
    if (!aiWords) box.appendChild(p('care-stay', x.stay));
    return box;
  }

  // For the system prompts: the AI's own judgement, for anything the word list doesn't catch
  const INSTRUCTION = `Safety comes before everything else. If the student says or hints that they want to hurt or kill themselves, or describes hurting themselves (in any language, including Filipino and Taglish), begin your reply with ${MARK} on its own, then answer in two to four short, warm sentences in the student's language: take it seriously, tell them they matter, ask if they are safe right now, and encourage them to tell an adult they trust. Don't lecture, don't change the subject, keep listening. Never write any phone number or hotline name yourself: Cassie shows verified crisis lines under your reply. Do NOT use ${MARK} when they are studying the topic (a character in a story, history, biology such as cell suicide or apoptosis, statistics) and not talking about themselves.`;

  root.CassieCare = { check, fromAI, langOf, reply, spoken, card, LINES, MARK, INSTRUCTION };
})(typeof window !== 'undefined' ? window : globalThis);

const Care = globalThis.CassieCare;
// the student's own words in a question (not a file's text that came with it)
function studentWords(messages) {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  if (!last) return '';
  const t = typeof last.content === 'string' ? last.content : last.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
  return t.replace(/^\[I attached[^\]]*\]\s*/, '').split(/\n\n\(Excerpt from|\n\[Picture from/)[0];
}
/* ------------------------------------------------------------------ reminders (web push)
   A student turns reminders on in Settings. The browser gives a push address, and Cassie keeps it with the hour
   they picked, their time zone, their quiet hours, and two facts the app sends: when their next flashcard is due,
   and their streak (its length and last day). No names and no card words. Once an hour the Cron Trigger sends an
   EMPTY push to anyone whose hour it is: at most once a day, never in quiet hours, and only when a card is due
   today or the streak ends tonight. The phone writes the words itself from what's saved on it.
   Keys (Worker → Settings → Variables and Secrets): VAPID_PUBLIC_KEY (Text) and VAPID_PRIVATE_KEY (Secret);
   scripts/make-vapid-keys.mjs makes a pair. VAPID_SUBJECT (Text, optional): a mailto: for the push services. */
const b64uDec = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (String(s).length % 4)) % 4)), (c) => c.charCodeAt(0)); // (b64u, below, writes it)
// only the browsers' own push services (never any other address)
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;
const pushOn = (env) => !!(env.DB && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
let vapidKey = null;
async function vapidAuth(env, endpoint) {
  if (!vapidKey || vapidKey.pub !== env.VAPID_PUBLIC_KEY) {
    const pub = b64uDec(env.VAPID_PUBLIC_KEY); // (65 bytes: 4, then x and y)
    const jwk = { kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE_KEY, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true };
    vapidKey = { pub: env.VAPID_PUBLIC_KEY, key: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']) };
  }
  const enc = (o) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const head = enc({ typ: 'JWT', alg: 'ES256' });
  const claims = enc({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:askcassie.study@gmail.com' });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapidKey.key, new TextEncoder().encode(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}
const hourIn = (v, d) => (Number.isInteger(+v) && +v >= 0 && +v <= 23 ? +v : d);
const inQuiet = (h, from, to) => (from === to ? false : from < to ? h >= from && h < to : h >= from || h < to);
async function push(request, env, url) {
  const h = allowedOrigin(request, env);
  if (!h) return new Response('forbidden', { status: 403 });
  if (request.method === 'GET' && url.pathname === '/push/key') return json(pushOn(env) ? { on: true, key: env.VAPID_PUBLIC_KEY } : { on: false }, 200, h);
  if (request.method !== 'POST') return new Response('not found', { status: 404, headers: h });
  if (!pushOn(env)) return json({ error: 'Reminders aren’t switched on yet.' }, 503, h);
  let b; try { b = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400, h); }
  const id = /^[\w-]{8,64}$/.test(String(b.id || '')) ? String(b.id) : '';
  if (!id) return json({ error: 'bad id' }, 400, h);
  await ensureSchema(env.DB);
  const facts = [Math.max(0, Math.floor(+b.nextDue || 0)), Math.max(0, Math.min(10000, Math.floor(+b.streak || 0))), /^\d{4}-\d{2}-\d{2}$/.test(String(b.streakDay || '')) ? String(b.streakDay) : ''];
  if (url.pathname === '/push/subscribe') {
    let ep; try { ep = new URL(String(b.endpoint || '')); } catch (e) { return json({ error: 'bad endpoint' }, 400, h); }
    if (ep.protocol !== 'https:' || !PUSH_HOSTS.test(ep.hostname) || ep.href.length > 1000) return json({ error: 'bad endpoint' }, 400, h);
    const tz = Math.max(-840, Math.min(840, Math.round(+b.tz || 0)));
    await env.DB.prepare('INSERT OR REPLACE INTO push_subs (id, endpoint, hour, tz, qfrom, qto, next_due, streak, streak_day, last_sent, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, ep.href, hourIn(b.hour, 19), tz, hourIn(b.quietFrom, 22), hourIn(b.quietTo, 7), ...facts, '', Date.now()).run();
    return json({ on: true }, 200, h);
  }
  if (url.pathname === '/push/state') { await env.DB.prepare('UPDATE push_subs SET next_due = ?, streak = ?, streak_day = ? WHERE id = ?').bind(...facts, id).run(); return json({ ok: true }, 200, h); }
  if (url.pathname === '/push/unsubscribe') { await env.DB.prepare('DELETE FROM push_subs WHERE id = ?').bind(id).run(); return json({ on: false }, 200, h); }
  return new Response('not found', { status: 404, headers: h });
}
// once an hour (the Cron Trigger): the reminders whose hour it is
async function sendReminders(env, now = Date.now()) {
  if (!pushOn(env)) return 0;
  await ensureSchema(env.DB);
  const { results } = await env.DB.prepare('SELECT id, endpoint, hour, tz, qfrom, qto, next_due, streak, streak_day, last_sent FROM push_subs LIMIT 5000').all();
  let sent = 0;
  for (const s of results || []) {
    const local = new Date(now + s.tz * 60e3), hour = local.getUTCHours(), day = local.toISOString().slice(0, 10);
    if (hour !== s.hour || s.last_sent === day || inQuiet(hour, s.qfrom, s.qto)) continue;
    const yesterday = new Date(now + s.tz * 60e3 - 864e5).toISOString().slice(0, 10);
    const dueToday = s.next_due > 0 && s.next_due <= now + (24 - hour) * 3600e3; // (due before the day ends)
    const streakEnds = s.streak > 0 && s.streak_day === yesterday; // (studied yesterday, not yet today)
    if (!dueToday && !streakEnds) continue;
    let r = null;
    try { r = await fetch(s.endpoint, { method: 'POST', headers: { authorization: await vapidAuth(env, s.endpoint), ttl: '14400', urgency: 'normal', 'content-length': '0' } }); } catch (e) { /* tried again next hour */ }
    if (r && (r.status === 404 || r.status === 410)) await env.DB.prepare('DELETE FROM push_subs WHERE id = ?').bind(s.id).run(); // (turned off in the browser)
    else if (r && r.ok) { await env.DB.prepare('UPDATE push_subs SET last_sent = ? WHERE id = ?').bind(day, s.id).run(); sent++; }
  }
  return sent;
}

// counted with nothing else: no words, no id
const countCare = (env, ctx) => ctx.waitUntil(countChat(env, dayOf(Date.now()), 'care').catch(() => {}));

const DEFAULT_ORIGINS = ['https://askcassie.study', 'https://www.askcassie.study', 'http://localhost'];
const EVENTS = new Set(['open', 'feature', 'signup']);

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (uid TEXT PRIMARY KEY, first_day TEXT, last_day TEXT, opens INTEGER DEFAULT 0, uses INTEGER DEFAULT 0,
     role TEXT, grade TEXT, age TEXT, platform TEXT, lang TEXT)`,
  `CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, day TEXT, uid TEXT, event TEXT, name TEXT)`,
  `CREATE INDEX IF NOT EXISTS events_day ON events(day)`,
  `CREATE TABLE IF NOT EXISTS words (day TEXT, word TEXT, n INTEGER, PRIMARY KEY (day, word))`,
  `CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, day TEXT, uid TEXT, kind TEXT, feature TEXT, text TEXT, ctx TEXT)`,
  `CREATE INDEX IF NOT EXISTS feedback_day ON feedback(day)`,
  `CREATE TABLE IF NOT EXISTS quota (k TEXT PRIMARY KEY, day TEXT, n INTEGER)`,
  `CREATE TABLE IF NOT EXISTS chats (day TEXT, src TEXT, n INTEGER, PRIMARY KEY (day, src))`,
  `CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT UNIQUE, pass TEXT, salt TEXT, google TEXT UNIQUE, name TEXT, data TEXT, created INTEGER, updated INTEGER)`,
  `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, account TEXT, created INTEGER, seen INTEGER)`,
  `CREATE TABLE IF NOT EXISTS health (k TEXT PRIMARY KEY, ts INTEGER, data TEXT)`,
  // live board rooms: a code, who's in, and every drawing step in order (rooms last a day)
  `CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, created INTEGER, owner TEXT, title TEXT)`,
  `CREATE TABLE IF NOT EXISTS room_members (code TEXT, uid TEXT, name TEXT, seen INTEGER, PRIMARY KEY (code, uid))`,
  // paid plans: an account's plan and when it ends (written by the owner's /admin/plan, later by payments)
  `CREATE TABLE IF NOT EXISTS plans (account TEXT PRIMARY KEY, plan TEXT, until INTEGER, note TEXT, updated INTEGER)`,
  `CREATE TABLE IF NOT EXISTS room_ops (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, uid TEXT, ts INTEGER, op TEXT)`,
  // where each person's pointer is right now (and their laser pointer's trail) — kept, not logged
  `CREATE TABLE IF NOT EXISTS room_here (code TEXT, uid TEXT, ts INTEGER, p TEXT, PRIMARY KEY (code, uid))`,
  // daily puzzles: each student's first finish of each puzzle, each day (lower value = better)
  `CREATE TABLE IF NOT EXISTS scores (day TEXT, game TEXT, uid TEXT, name TEXT, value REAL, shown TEXT, ts INTEGER, PRIMARY KEY (day, game, uid))`,
  `CREATE INDEX IF NOT EXISTS room_ops_code ON room_ops(code, id)`,
  // sign-in with Google or Apple: which provider and its id for the person (nothing else is kept)
  `CREATE TABLE IF NOT EXISTS identities (provider TEXT, sub TEXT, account TEXT, PRIMARY KEY (provider, sub))`,
  // reminders: a push address and when to use it (no names, no card words)
  `CREATE TABLE IF NOT EXISTS push_subs (id TEXT PRIMARY KEY, endpoint TEXT, hour INTEGER, tz INTEGER, qfrom INTEGER, qto INTEGER, next_due INTEGER, streak INTEGER, streak_day TEXT, last_sent TEXT, at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS identities_account ON identities(account)`,
  `INSERT OR IGNORE INTO identities (provider, sub, account) SELECT 'google', google, id FROM accounts WHERE google IS NOT NULL`,
];
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((q) => db.prepare(q)));
  schemaReady = true;
}

const dayOf = (ms) => new Date(ms + TZ_OFFSET_H * 3600e3).toISOString().slice(0, 10);
// One more use of something counted per period (a day, an hour, a week, a month): adds `by` and
// gives back the new total, in one query. A new period starts the count again.
const QUOTA_SQL = `INSERT INTO quota (k, day, n) VALUES (?1, ?2, ?3)
  ON CONFLICT(k) DO UPDATE SET n = CASE WHEN day = ?2 THEN n + ?3 ELSE ?3 END, day = ?2 RETURNING n`;
const countUseQuery = (db, key, period, by = 1) => db.prepare(QUOTA_SQL).bind(key, period, by);
async function countUse(db, key, period, by = 1) { const r = await countUseQuery(db, key, period, by).first(); return (r && r.n) || 0; }
// …and give uses back (one each) when what was counted didn't happen
const uncountUses = (db, keys) => db.batch(keys.map((k) => db.prepare('UPDATE quota SET n = MAX(0, n - 1) WHERE k = ?').bind(k)));
const clean = (v, n = 40) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, '').slice(0, n);
// feature and event names are short labels like "quiz" or "labs: pendulum" — anything else is dropped
const label = (v, n = 40) => { const t = clean(v, n); return /^[\w .:/+&()'’-]*$/u.test(t) ? t : ''; };

function cors(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()) : DEFAULT_ORIGINS);
  const ok = allowed.some((a) => origin === a || (a === 'http://localhost' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)))
    || (env.ALLOW_EXTENSION !== 'off' && /^chrome-extension:\/\/[a-p]{32}$/.test(origin)); // the Cassie extension (Chrome and Edge)
  return ok ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization', 'access-control-expose-headers': 'retry-after, x-cassie-source, x-cassie-left, x-cassie-plan, x-speak', vary: 'origin' } : {};
}
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra } });
// The dashboard page: only its own script may run (a fresh one-time code each visit), it can't be
// put in another site's frame, and it can only talk to this server.
function dashboard() {
  const nonce = randomToken(16);
  return new Response(DASHBOARD.replace('<script>', `<script nonce="${nonce}">`), { headers: {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
    'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
    'strict-transport-security': 'max-age=31536000',
  } });
}

async function ingest(request, env) {
  const origin = request.headers.get('origin') || '';
  const h = cors(origin, env);
  if (origin && !h['access-control-allow-origin']) return new Response('forbidden', { status: 403 });
  const text = await request.text();
  if (text.length > 16000) return new Response('too big', { status: 413, headers: h });
  let body; try { body = JSON.parse(text); } catch (e) { return new Response('bad json', { status: 400, headers: h }); }
  const uid = clean(body.uid, 64);
  if (!/^[\w-]{8,64}$/.test(uid)) return new Response('bad id', { status: 400, headers: h });
  const ctx = body.ctx || {};
  const now = Date.now(), today = dayOf(now);
  const events = (Array.isArray(body.events) ? body.events : []).slice(0, 50)
    .filter((e) => e && EVENTS.has(e.e))
    .map((e) => ({ e: e.e, n: label(e.n, 40), t: Math.min(now, Math.max(now - 7 * 864e5, +e.t || now)) }));
  const words = (Array.isArray(body.words) ? body.words : []).slice(0, 50)
    .map((w) => clean(w, 24).toLowerCase()).filter((w) => /^\p{L}{4,24}$/u.test(w));
  if (!events.length && !words.length) return new Response(null, { status: 204, headers: h });

  const db = env.DB;
  await ensureSchema(db);
  const opens = events.filter((e) => e.e === 'open').length, uses = events.filter((e) => e.e === 'feature').length;
  const stmts = [
    db.prepare(`INSERT INTO users (uid, first_day, last_day, opens, uses, role, grade, age, platform, lang) VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      ON CONFLICT(uid) DO UPDATE SET last_day = ?2, opens = opens + ?3, uses = uses + ?4,
        role = COALESCE(NULLIF(?5, ''), role), grade = COALESCE(NULLIF(?6, ''), grade), age = COALESCE(NULLIF(?7, ''), age),
        platform = COALESCE(NULLIF(?8, ''), platform), lang = COALESCE(NULLIF(?9, ''), lang)`)
      .bind(uid, today, opens, uses, clean(ctx.role, 12), clean(ctx.grade, 30), clean(ctx.age, 12), clean(ctx.platform, 20), clean(ctx.lang, 8)),
    ...events.map((e) => db.prepare('INSERT INTO events (ts, day, uid, event, name) VALUES (?, ?, ?, ?, ?)').bind(e.t, dayOf(e.t), uid, e.e, e.n)),
    ...words.map((w) => db.prepare('INSERT INTO words (day, word, n) VALUES (?, ?, 1) ON CONFLICT(day, word) DO UPDATE SET n = n + 1').bind(today, w)),
  ];
  await db.batch(stmts);
  return new Response(null, { status: 204, headers: h });
}

/* ------------------------------------------------------------------ chat */
const GROQ = 'https://api.groq.com/openai/v1';
const CHAT_MODELS = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b'];
const BACKUP_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'; // Workers AI
const minuteHits = new Map(); // per-person counts for the current minute (per Worker instance)
// A per-network speed limit for everything that writes to the database, so nobody can flood it.
// (Counted per Worker instance, so it's a guard rail, not an exact number.)
const SPEED = { '/push/': 60, '/e': 400, '/f': 100, '/scores/': 200, '/room/create': 30, '/room': 3000, '/auth/': 200, '/transcribe': 300, '/image': 100, '/speak': 240 };
function tooFast(request, path) {
  const rule = Object.keys(SPEED).find((p) => (p.endsWith('/') ? path.startsWith(p) : path === p || path.startsWith(p + '/')));
  if (!rule) return false;
  const ip = request.headers.get('cf-connecting-ip') || 'unknown', minute = Math.floor(Date.now() / 60e3), k = `s|${rule}|${ip}`;
  const hit = minuteHits.get(k);
  const n = hit && hit.m === minute ? hit.n + 1 : 1;
  minuteHits.set(k, { m: minute, n });
  if (minuteHits.size > 5000) minuteHits.clear();
  return n > SPEED[rule];
}
let vision = { ids: [], at: 0, all: [] };

function allowedOrigin(request, env) {
  const origin = request.headers.get('origin') || '';
  const h = cors(origin, env);
  return h['access-control-allow-origin'] ? h : null;
}
function msUntilMidnightPH(now) {
  const ph = new Date(now + TZ_OFFSET_H * 3600e3);
  return 864e5 - ((ph.getUTCHours() * 3600 + ph.getUTCMinutes() * 60 + ph.getUTCSeconds()) * 1000);
}
function chatError(message, status, h, extra = {}) {
  return json({ error: { message } }, status, { ...h, ...extra });
}
// Groq's picture-reading models change over time — ask Groq which ones it has now, best first.
async function visionModels(env, fresh = false) {
  // an empty answer is remembered too (6 h), so photos don't wait on a fresh search every time
  if (!fresh && vision.at && Date.now() - vision.at < (vision.ids.length ? 3600e3 : 6 * 3600e3)) return vision.ids;
  try {
    const r = await fetch(`${GROQ}/models`, { headers: { authorization: `Bearer ${env.GROQ_KEY}` }, signal: AbortSignal.timeout(10000) });
    const ids = ((await r.json()).data || []).filter((m) => m.active !== false).map((m) => m.id);
    const score = (id) => (/llama-4-scout/i.test(id) ? 0 : /llama-4-maverick/i.test(id) ? 1 : /vision|llava|pixtral|(^|[-/])vl([-/]|$)|-vl-|multimodal|llama-4|gemma-?3/i.test(id) ? 2 : 9);
    let list = ids.filter((id) => !/whisper|tts|guard|playai|orpheus|embed/i.test(id) && score(id) < 9).sort((a, b) => score(a) - score(b));
    if (!list.length) {
      // no name looks like a picture reader (Groq renames them): show each model a tiny picture of 7 × 8 once
      const maybe = ids.filter((id) => !/whisper|tts|guard|playai|orpheus|embed|compound/i.test(id)).slice(0, 8);
      const probe = [{ role: 'user', content: [{ type: 'text', text: 'Read the sum in this picture and work it out. Reply with only the number.' }, { type: 'image_url', image_url: { url: CHECK_PNG } }] }];
      const seen = await Promise.all(maybe.map((m) => groqAsk(env, m, probe, 400).then((t) => (/\b56\b/.test(t) ? m : null), () => null)));
      list = seen.filter(Boolean);
    }
    vision = { ids: list, at: Date.now(), all: ids };
  } catch (e) { /* keep the old list */ }
  return vision.ids;
}

/* Gemini (the owner's optional GEMINI_KEY): a second brain for photos and text.
   Google retires model names often, so the server asks which models this key can use
   (once every 6 hours) and picks the newest Flash ones. GEMINI_MODEL still goes first. */
const GEMINI_FALLBACK = ['gemini-flash-latest', 'gemini-flash-lite-latest'];
let gemini = { ids: [], at: 0, all: [] };
const geminiGone = new Set(); // names Google has retired ("no longer available"): never tried again
// Google refuses its free Gemini API from some places (Cloudflare can run Cassie in Hong Kong,
// for one). When it does, Cassie skips Gemini for a while instead of asking every model in turn.
let geminiBlocked = { until: 0, where: '' };
let lastColo = ''; // the Cloudflare data centre running this request (from request.cf)
const LOCATION_BLOCKED = /location is not supported/i;
function rankGemini(models) {
  const ids = models.filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''))
    .filter((id) => /^gemini-/.test(id) && !/image|tts|audio|live|embed|thinking|computer|robotics|native|aqa|learnlm|banana/i.test(id));
  const ver = (id) => parseFloat((/gemini-(\d+(?:\.\d+)?)/.exec(id) || [0, 0])[1]) || 0;
  const rank = (id) => (/flash-lite/.test(id) ? 2 : /flash/.test(id) ? 0 : /pro/.test(id) ? 4 : 6) + (/preview|exp/.test(id) ? 1 : 0);
  return ids.sort((a, b) => rank(a) - rank(b) || ver(b) - ver(a) || a.length - b.length);
}
async function geminiModels(env) {
  if (gemini.ids.length && Date.now() - gemini.at < 6 * 3600e3) return gemini.ids;
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': env.GEMINI_KEY }, signal: AbortSignal.timeout(10000) });
    if (r.ok) {
      const models = (await r.json()).models || [];
      const ids = rankGemini(models);
      if (ids.length) gemini = { ids: ids.filter((id) => !geminiGone.has(id)).slice(0, 4), at: Date.now(), all: models.map((m) => String(m.name || '').replace(/^models\//, '')) };
    } else {
      let m = ''; try { m = (await r.json()).error?.message || ''; } catch (e) { /* not JSON */ }
      if (LOCATION_BLOCKED.test(m)) geminiBlocked = { until: Date.now() + 10 * 60e3, where: lastColo };
    }
  } catch (e) { /* use the fallback names */ }
  return gemini.ids.length ? gemini.ids : GEMINI_FALLBACK;
}
async function askGemini(env, messages, maxTokens = 2048) {
  if (!env.GEMINI_KEY) return { reply: null, detail: '' };
  const system = messages.filter((m) => m.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n\n');
  const contents = messages.filter((m) => m.role !== 'system').map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content).map((p) => {
      const d = p.type === 'image_url' && /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(p.image_url.url);
      return d ? { inlineData: { mimeType: d[1], data: d[2] } } : { text: p.text || '' };
    }),
  }));
  while (contents.length && contents[0].role !== 'user') contents.shift();
  if (geminiBlocked.until > Date.now()) return { reply: null, detail: geminiBlockedText(), blocked: true };
  let detail = '';
  const list = await geminiModels(env);
  if (geminiBlocked.until > Date.now()) return { reply: null, detail: geminiBlockedText(), blocked: true };
  for (const model of [...new Set(env.GEMINI_MODEL ? [env.GEMINI_MODEL, ...list] : list)].filter((m) => !geminiGone.has(m)).slice(0, 4)) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY }, signal: AbortSignal.timeout(30000),
        body: JSON.stringify({ ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents, generationConfig: { maxOutputTokens: Math.max(4096, maxTokens * 2), temperature: 0.5 } }),
      });
      if (r.ok) {
        const parts = (await r.json()).candidates?.[0]?.content?.parts || [];
        const reply = parts.filter((x) => !x.thought).map((x) => x.text || '').join('').trim();
        if (reply) return { reply, detail: '' };
        detail += `${model}: empty answer · `;
      } else {
        let m = ''; try { m = (await r.json()).error?.message || ''; } catch (e) { /* not JSON */ }
        if (LOCATION_BLOCKED.test(m)) { geminiBlocked = { until: Date.now() + 10 * 60e3, where: lastColo }; return { reply: null, detail: geminiBlockedText(), blocked: true }; }
        if (r.status === 404) { gemini.at = 0; if (/no longer available|not found/i.test(m)) geminiGone.add(model); } // a retired name: never again
        detail += `${model}: ${reasonOf(r.status, m)} · `;
      }
    } catch (e) { detail += `${model}: ${e.name === 'TimeoutError' ? 'no answer in 30 s' : reasonOf(0, e.message)} · `; }
  }
  return { reply: null, detail: detail ? 'Gemini ' + detail.replace(/ · $/, '') : '' };
}

function geminiBlockedText() {
  return `Google doesn't allow its free Gemini API from where Cloudflare is running Cassie right now${geminiBlocked.where ? ` (data centre ${geminiBlocked.where})` : ''}. Groq and Workers AI answer instead. Fix: Cloudflare → Workers & Pages → cassie → Settings → Placement → Smart.`;
}

/* Cloudflare Workers AI picture readers (the AI binding): the last backup for photos, with
   none of Groq's or Google's free-tier limits. */
const AI_VISION = ['@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/google/gemma-3-12b-it'];
async function aiVision(env, messages, maxTokens = 1500) {
  if (!env.AI) return { reply: null, detail: '' };
  let detail = '';
  for (const model of env.AI_VISION_MODEL ? [env.AI_VISION_MODEL, ...AI_VISION] : AI_VISION) {
    try {
      const o = await env.AI.run(model, { messages, max_tokens: Math.min(maxTokens, 2048), temperature: 0.4 });
      const reply = String((o && (o.response ?? o.result?.response)) || '').trim();
      if (reply) return { reply, detail: '' };
      detail += `${model}: empty answer · `;
    } catch (e) { detail += `${model}: ${reasonOf(0, e.message || e)} · `; }
  }
  return { reply: null, detail: 'Workers AI ' + detail.replace(/ · $/, '') };
}

/* Problems the server hit, for the dashboard (a few hundred a day at most, no messages).
   What went wrong at a service is a short reason picked here: a service's own error text is never
   kept, because it can quote the request (a student's question, file or photo). */
function reasonOf(status, msg = '') {
  const m = String(msg || '');
  const why = /timeout|timed out|no answer in/i.test(m) ? 'no answer in time'
    : /location|region|country/i.test(m) && /not supported|allow|available/i.test(m) ? 'not allowed from this location'
    : /billing|payment|credit/i.test(m) ? 'billing'
    : /rate.?limit|too many|resource.?exhausted|quota|limit:/i.test(m) || status === 429 ? 'over its limit'
    : /decommission|no longer|not found|does not exist|unknown model|model_not_found/i.test(m) || status === 404 ? 'model not found'
    : /too large|too long|payload|context length|maximum/i.test(m) || status === 413 ? 'too large'
    : /safety|blocked|policy/i.test(m) ? 'blocked by its safety rules'
    : /api.?key|unauthori|permission|forbidden|invalid.?auth/i.test(m) || status === 401 || status === 403 ? 'key not accepted'
    : /image|vision|picture/i.test(m) ? 'can’t read pictures'
    : status >= 500 ? 'service error' : status ? 'refused' : 'no connection';
  return status ? `${status} ${why}` : why;
}
let problemDay = '', problemCount = 0;
async function logProblem(env, where, detail) {
  try {
    const day = dayOf(Date.now());
    if (day !== problemDay) { problemDay = day; problemCount = 0; }
    if (++problemCount > 300) return;
    await ensureSchema(env.DB);
    await env.DB.prepare('INSERT INTO feedback (ts, day, uid, kind, feature, text, ctx) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(Date.now(), day, 'server', 'error', String(where).slice(0, 40), String(detail || '').slice(0, 600), 'server').run();
  } catch (e) { /* the dashboard is best-effort */ }
}
/* Tidy-up: what is only kept for a while goes when its time is up, whether or not anyone uses the
   feature again: study rooms after a day, the daily and hourly limit counts (they hold IP
   addresses) once their day is over, puzzle scores after 14 days. (Weekly and monthly allowances
   stay until their week or month ends.) Runs every 10 minutes while the server is busy, and from
   the Cron Trigger. */
let tidiedAt = 0;
async function tidy(env) {
  if (!env.DB) return;
  await ensureSchema(env.DB);
  const now = Date.now(), old = now - ROOM_HOURS * 3600e3, today = dayOf(now);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM room_ops WHERE code IN (SELECT code FROM rooms WHERE created < ?)').bind(old),
    env.DB.prepare('DELETE FROM room_members WHERE code IN (SELECT code FROM rooms WHERE created < ?)').bind(old),
    env.DB.prepare('DELETE FROM room_here WHERE ts < ?').bind(old),
    env.DB.prepare('DELETE FROM rooms WHERE created < ?').bind(old),
    // a day (2026-10-14) or an hour (2026-10-14T05) that is over; weeks (gpic:) and months (2026-10) stay
    env.DB.prepare("DELETE FROM quota WHERE day < ? AND length(day) IN (10, 13) AND k NOT LIKE 'gpic:%'").bind(today),
    env.DB.prepare('DELETE FROM scores WHERE day < ?').bind(dayOf(now - 14 * 86400e3)),
  ]);
}
function cleanMessages(list) {
  if (!Array.isArray(list) || !list.length || list.length > 40) return null;
  let chars = 0, image = false;
  const out = [];
  for (const m of list) {
    if (!m || !['system', 'user', 'assistant'].includes(m.role)) return null;
    if (typeof m.content === 'string') { chars += m.content.length; out.push({ role: m.role, content: m.content }); continue; }
    if (!Array.isArray(m.content)) return null;
    const parts = [];
    for (const p of m.content.slice(0, 8)) {
      if (p && p.type === 'text' && typeof p.text === 'string') { chars += p.text.length; parts.push({ type: 'text', text: p.text }); }
      else if (p && p.type === 'image_url' && p.image_url && /^data:image\//.test(p.image_url.url || '')) { image = true; parts.push({ type: 'image_url', image_url: { url: p.image_url.url } }); }
    }
    out.push({ role: m.role, content: parts });
  }
  if (chars > 120000) return null;
  return { messages: out, image };
}
const textOnly = (messages) => messages.map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n') }));

async function countChat(env, day, src) {
  try { await env.DB.prepare('INSERT INTO chats (day, src, n) VALUES (?, ?, 1) ON CONFLICT(day, src) DO UPDATE SET n = n + 1').bind(day, src).run(); } catch (e) { /* stats only */ }
}

/* ------------------------------------------------------------------ Claude
   With an ANTHROPIC_KEY secret, questions from the app's main chat (body.brain === 'claude')
   go to Claude first. Raw HTTP to Anthropic's Messages API: a Worker pasted into the
   dashboard can't load npm packages. Groq and Workers AI stay as the backup. */
const ANTHROPIC = 'https://api.anthropic.com/v1';
let claudeIds = { ids: [], at: 0 };
const anthropicHeaders = (env) => ({ 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' });
// Anthropic's newest model of a family — haiku, sonnet or opus (the Models API lists newest
// first) — unless CLAUDE_MODEL picks one for everyone.
async function claudeModel(env, family = 'opus') {
  if (env.CLAUDE_MODEL) return env.CLAUDE_MODEL;
  if (!claudeIds.ids.length || Date.now() - claudeIds.at > 6 * 3600e3) {
    try {
      const r = await fetch(`${ANTHROPIC}/models?limit=100`, { headers: anthropicHeaders(env), signal: AbortSignal.timeout(10000) });
      const ids = ((await r.json()).data || []).map((m) => m.id);
      if (ids.length) claudeIds = { ids, at: Date.now() };
    } catch (e) { /* keep the old list */ }
  }
  const ids = claudeIds.ids;
  return ids.find((x) => x.toLowerCase().includes(family)) || ids[0] || '';
}
// Groq-style messages → Claude: the system prompt goes on its own, pictures become image blocks,
// and turns alternate user / assistant starting with the user.
function toClaude(messages) {
  const system = messages.filter((m) => m.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n\n');
  const out = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    const blocks = typeof m.content === 'string'
      ? [{ type: 'text', text: m.content }]
      : m.content.map((p) => {
        const d = p.type === 'image_url' && /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(p.image_url.url);
        return d ? { type: 'image', source: { type: 'base64', media_type: d[1], data: d[2] } } : { type: 'text', text: p.text || '' };
      });
    const content = blocks.filter((b) => b.type !== 'text' || b.text.trim());
    if (!content.length) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content.push(...content);
    else out.push({ role: m.role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return { system, messages: out };
}
async function askClaude(env, cleaned, family = 'opus') {
  const model = await claudeModel(env, family);
  if (!model) return null;
  const { system, messages } = toClaude(cleaned.messages);
  if (!messages.length) return null;
  const base = { model, max_tokens: 16000, messages, ...(system ? { system } : {}) };
  const effort = ['low', 'medium', 'high'].includes(env.CLAUDE_EFFORT) ? env.CLAUDE_EFFORT : 'medium';
  // effort, plus a server-side fallback model if a safety check declines a harmless study question
  let r;
  try {
    r = await fetch(`${ANTHROPIC}/messages`, {
      method: 'POST', headers: { ...anthropicHeaders(env), 'anthropic-beta': 'server-side-fallback-2026-07-01' },
      body: JSON.stringify({ ...base, output_config: { effort }, fallbacks: 'default' }), signal: AbortSignal.timeout(120000),
    });
    // a model picked in CLAUDE_MODEL may not take those options: ask it plainly
    if (r.status === 400) r = await fetch(`${ANTHROPIC}/messages`, { method: 'POST', headers: anthropicHeaders(env), body: JSON.stringify(base), signal: AbortSignal.timeout(120000) });
  } catch (e) { return null; } // no answer in 2 minutes: the backup brain answers
  if (!r.ok) return null;
  const data = await r.json();
  if (data.stop_reason === 'refusal') return null; // let the backup brain try
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  return text || null;
}
/* ------------------------------------------------------------------ plans
   Free, Plus or Pro. A plan belongs to an account (sign in to subscribe), so it follows the
   student to every device. The owner can give one with /admin/plan; payments will write here too. */
// (one read on every signed-in question: the session and its plan, not the whole account)
async function planOf(request, env) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!/^[\w-]{20,100}$/.test(token)) return { plan: 'free' };
  try {
    const row = await env.DB.prepare('SELECT s.account, s.created, p.plan, p.until FROM sessions s JOIN accounts a ON a.id = s.account LEFT JOIN plans p ON p.account = s.account AND p.until > ? WHERE s.token = ?')
      .bind(Date.now(), await sha256(token)).first();
    if (!row || Date.now() - row.created > SESSION_DAYS * 864e5) return { plan: 'free' };
    return { ...paidPlan(row), account: row.account };
  } catch (e) { return { plan: 'free' }; }
}
const paidPlan = (row) => (row && ['plus', 'pro'].includes(row.plan) ? { plan: row.plan, until: row.until } : { plan: 'free', until: 0 });
const planQuery = (env, id) => env.DB.prepare('SELECT plan, until FROM plans WHERE account = ? AND until > ?').bind(id, Date.now());
async function accountPlan(env, id) { return paidPlan(await planQuery(env, id).first()); }
// what each plan gets a day: questions the student sees, every request (a ceiling against abuse),
// and Claude answers (family, then a second family once the first runs out)
function limitsFor(env, plan) {
  const n = (v, d) => (v != null && v !== '' && Number.isFinite(+v) ? +v : d);
  if (plan === 'pro') return { questions: n(env.PRO_DAILY_QUESTIONS, 150), all: n(env.PRO_DAILY_LIMIT, 600), claude: [['sonnet', n(env.PRO_CLAUDE_LIMIT, 15)], ['haiku', n(env.PRO_HAIKU_LIMIT, 100)]] };
  if (plan === 'plus') return { questions: n(env.PLUS_DAILY_QUESTIONS, 100), all: n(env.PLUS_DAILY_LIMIT, 400), claude: [['haiku', n(env.PLUS_CLAUDE_LIMIT, 100)]] };
  return { questions: n(env.FREE_DAILY_QUESTIONS, 20), all: n(env.DAILY_LIMIT, 150), claude: [['haiku', n(env.FREE_CLAUDE_LIMIT, 10)]] };
}
// The owner gives (or ends) a plan: POST /admin/plan {"email": "...", "plan": "pro", "days": 30}
// with the dashboard password; GET /admin/plan?email=... shows it.
async function adminPlan(request, env, url) {
  const no = await adminOk(request, env);
  if (no) return json({ error: no.error }, no.status);
  const b = request.method === 'POST' ? await request.json().catch(() => ({})) : { email: url.searchParams.get('email') };
  const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
  const acc = email && await env.DB.prepare('SELECT id, email, name FROM accounts WHERE email = ?').bind(email).first();
  if (!acc) return json({ error: 'No Cassie account with that email. They need to sign up first.' }, 404);
  if (request.method === 'POST') {
    const plan = ['free', 'plus', 'pro'].includes(b.plan) ? b.plan : null;
    if (!plan) return json({ error: 'plan must be free, plus or pro' }, 400);
    const days = Math.max(0, Math.min(3660, +b.days || 30)), until = plan === 'free' ? 0 : Date.now() + days * 864e5;
    await env.DB.prepare('INSERT INTO plans (account, plan, until, note, updated) VALUES (?, ?, ?, ?, ?) ON CONFLICT(account) DO UPDATE SET plan = excluded.plan, until = excluded.until, note = excluded.note, updated = excluded.updated')
      .bind(acc.id, plan, until, String(b.note || 'given by the owner').slice(0, 200), Date.now()).run();
  }
  const row = await env.DB.prepare('SELECT plan, until, note FROM plans WHERE account = ?').bind(acc.id).first();
  const active = row && row.until > Date.now() ? row.plan : 'free';
  return json({ email: acc.email, name: acc.name, plan: active, until: active === 'free' ? null : new Date(row.until).toISOString(), note: row ? row.note : '' });
}

async function config(request, env) {
  const h = allowedOrigin(request, env);
  if (!h) return new Response('forbidden', { status: 403 });
  return json({ claude: !!env.ANTHROPIC_KEY, pictures: geminiPicturesOn(env) }, 200, { ...h, 'cache-control': 'max-age=300' });
}

/* ---------------------------------------------------------------- talking with Cassie
   Voice chat on phones whose browser can't turn speech into text by itself (and on
   Firefox): the app records what the student says and sends it here. Groq's Whisper
   writes it down; Cloudflare's own Whisper is the backup. Nothing is kept. */
const WHISPER = ['whisper-large-v3-turbo', 'whisper-large-v3'];
async function transcribe(request, env, ctx) {
  const h = allowedOrigin(request, env);
  if (!h) return new Response('forbidden', { status: 403 });
  let form;
  try { form = await request.formData(); } catch (e) { return chatError('Send the recording as a form.', 400, h); }
  const file = form.get('file');
  if (!file || typeof file === 'string' || !file.size) return chatError('No recording.', 400, h);
  if (file.size > 8 * 1024 * 1024) return chatError('That recording is too long. Talk in shorter bits.', 413, h);
  const uid = /^[\w-]{8,64}$/.test(String(form.get('uid') || '')) ? String(form.get('uid')) : 'anon';
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const now = Date.now(), minute = Math.floor(now / 60e3), mk = `t|${uid}|${ip}`;
  const hit = minuteHits.get(mk);
  const n = hit && hit.m === minute ? hit.n + 1 : 1;
  minuteHits.set(mk, { m: minute, n });
  if (n > (+env.TRANSCRIBE_MINUTE_LIMIT || 20)) return chatError('Lots of talking! Give me a few seconds.', 429, h, { 'retry-after': '20' });
  if (env.DB) {
    await ensureSchema(env.DB);
    if (await countUse(env.DB, 't:' + ip, dayOf(now)) > (+env.TRANSCRIBE_DAILY_LIMIT || 3000)) return chatError('That’s a lot of voice for today. Type for now, and voice comes back tomorrow.', 429, h);
  }
  const lang = /^[a-z]{2}$/.test(String(form.get('language') || '')) ? String(form.get('language')) : '';
  const hint = String(form.get('prompt') || '').slice(0, 600); // words from the conversation, so Whisper spells them right
  const problems = [];
  if (env.GROQ_KEY) {
    for (const model of WHISPER) {
      const fd = new FormData();
      fd.append('file', file, file.name || 'speech.webm');
      fd.append('model', model);
      fd.append('response_format', 'json');
      if (lang) fd.append('language', lang);
      if (hint) fd.append('prompt', hint);
      try {
        const r = await fetch(`${GROQ}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${env.GROQ_KEY}` }, body: fd, signal: AbortSignal.timeout(30000) });
        if (r.ok) { const text = String((await r.json()).text || '').trim(); ctx.waitUntil(countChat(env, dayOf(now), 'voice')); return json({ text }, 200, h); }
        let m = ''; try { m = (await r.json()).error?.message || ''; } catch (e) { /* not JSON */ }
        problems.push(`Groq ${model}: ${reasonOf(r.status, m)}`);
      } catch (e) { problems.push(`Groq ${model}: ${reasonOf(0, e.message)}`); }
    }
  }
  if (env.AI) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      const o = await env.AI.run('@cf/openai/whisper-large-v3-turbo', { audio: btoa(bin), ...(lang ? { language: lang } : {}), ...(hint ? { initial_prompt: hint } : {}) });
      const text = String((o && (o.text ?? o.result?.text)) || '').trim();
      ctx.waitUntil(countChat(env, dayOf(now), 'voice-backup'));
      return json({ text }, 200, h);
    } catch (e) { problems.push(`Workers AI whisper: ${reasonOf(0, e && e.message || e)}`); }
  }
  ctx.waitUntil(logProblem(env, 'voice: transcribe', problems.join(' | ') || 'no speech-to-text set up'));
  return chatError('I couldn’t hear that clearly. Try again, or type it.', 503, h);
}

/* ---------------------------------------------------------------- the iPhone Shortcut
   GET /ask?text=…  → plain text. Shortcuts shows it in a pop-up over Safari / a PDF, so no new
   browser tab opens. Shortcuts sends no Origin header, so this route has its own small daily
   cap per network instead of the site check. */
const MATH_NOTE = 'The text was copied on a phone, so maths may be flattened: "x2" usually means x², "x3" means x³, a number on the line under another number is often a fraction, and symbols like √, π, ∫ or exponents may be missing or split across lines. Rebuild the intended expression first and say it in one line ("I read this as: …"), then solve it carefully and double-check the result.';
const ASK_SYSTEM = `You are Cassie, a warm, sharp study buddy. A student selected some text on their phone (from a PDF, a document or a web page) and wants help with it. Do what it needs: if it is a question or a problem, solve it, giving the answer first and then the key steps; otherwise explain it simply, with a short example. Keep it under 180 words. Plain text only: no markdown symbols (no **, #, tables) and no LaTeX; write maths with ordinary symbols (x², √, ½, ≤, π). ${MATH_NOTE}` + '\n\n' + Care.INSTRUCTION;
const plainText = (t) => String(t).replace(/<think>[\s\S]*?<\/think>\s*/g, '').replace(/```[\s\S]*?```/g, '').replace(/\*\*|__|`/g, '').replace(/^#{1,6}\s*/gm, '').replace(/^\s*[-*]\s+/gm, '• ').replace(/\n{3,}/g, '\n\n').trim();
async function ask(request, env, ctx) {
  const url = new URL(request.url);
  const out = (t, status = 200) => new Response(t, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  const text = (url.searchParams.get('text') || '').trim().slice(0, 4000);
  if (!text) return out('Select some words first, then Share → Ask Cassie.');
  const now = Date.now(), today = dayOf(now), ip = request.headers.get('cf-connecting-ip') || 'unknown';
  await ensureSchema(env.DB);
  const care = Care.check(text); // safety first
  if (care) { countCare(env, ctx); return out(Care.reply(care.lang)); }
  const used = await countUse(env.DB, 'a:' + ip, today);
  const limit = +env.ASK_LIMIT || 40;
  if (used > limit) return out(`That's today's ${limit} quick answers from this network. Open Cassie for more: askcassie.study`, 429);
  const messages = [{ role: 'system', content: ASK_SYSTEM }, { role: 'user', content: text }];
  let reply = null, src = 'shortcut';
  if (env.ANTHROPIC_KEY) { try { reply = await askClaude(env, { messages }, 'haiku'); } catch (e) { reply = null; } if (reply) src = 'shortcut-claude'; }
  for (const model of env.GROQ_KEY && !reply ? CHAT_MODELS : []) {
    try {
      const r = await fetch(`${GROQ}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_KEY}` }, body: JSON.stringify({ model, messages, max_tokens: 2500, temperature: 0.4 }) });
      if (r.ok) { reply = (await r.json()).choices?.[0]?.message?.content || null; if (reply) break; }
    } catch (e) { /* next model */ }
  }
  if (!reply && env.GEMINI_KEY) { const g = await askGemini(env, messages, 1500); reply = g.reply; if (reply) src = 'shortcut-gemini'; }
  if (!reply && env.AI) {
    try { const o = await env.AI.run(BACKUP_MODEL, { messages, max_tokens: 1200, temperature: 0.4 }); reply = (o && (o.response ?? o.result?.response)) || null; } catch (e) { reply = null; }
  }
  const flagged = reply && Care.fromAI(reply);
  if (flagged) { countCare(env, ctx); return out(Care.reply(Care.langOf(text), flagged.aiWords)); }
  if (!reply) { ctx.waitUntil(logProblem(env, 'iPhone Shortcut', 'no AI answered')); return out('Cassie is very busy right now. Try again in a minute.', 503); }
  ctx.waitUntil(countChat(env, today, src));
  return out(`${plainText(reply)}\n\nCassie · askcassie.study`);
}

async function chat(request, env, ctx) {
  const h = allowedOrigin(request, env);
  if (!h) return new Response('forbidden', { status: 403 });
  const text = await request.text();
  if (text.length > 8e6) return chatError('That photo or file is too big to send. Try a smaller one.', 413, h);
  let body; try { body = JSON.parse(text); } catch (e) { return chatError('Bad request.', 400, h); }
  const cleaned = cleanMessages(body.messages);
  if (!cleaned) return chatError('That message is too long. Try a shorter question or start a new chat.', 413, h);
  // Safety first: before any limit or AI, a student at risk gets care (a question they typed, not a file)
  const care = body.q === 1 || body.q === true ? Care.check(studentWords(cleaned.messages)) : null;
  if (care) {
    if (env.DB) { await ensureSchema(env.DB); countCare(env, ctx); }
    return json({ choices: [{ index: 0, message: { role: 'assistant', content: Care.reply(care.lang) }, finish_reason: 'stop' }] }, 200, { ...h, 'x-cassie-source': 'care', 'access-control-expose-headers': 'x-cassie-source' });
  }

  // Fair use: each person gets a daily allowance through this shared key.
  const now = Date.now(), today = dayOf(now);
  const uid = /^[\w-]{8,64}$/.test(body.uid || '') ? body.uid : 'anon';
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const perMin = +env.MINUTE_LIMIT || 12;
  const minute = Math.floor(now / 60e3), mk = `${uid}|${ip}`;
  const hit = minuteHits.get(mk);
  const n = hit && hit.m === minute ? hit.n + 1 : 1;
  minuteHits.set(mk, { m: minute, n });
  // the whole network too (made-up ids can't get around the minute limit; a classroom shares one address)
  const ipHit = minuteHits.get('ip|' + ip);
  const nIp = ipHit && ipHit.m === minute ? ipHit.n + 1 : 1;
  minuteHits.set('ip|' + ip, { m: minute, n: nIp });
  if (minuteHits.size > 5000) minuteHits.clear();
  if (n > perMin || nIp > perMin * 10) return chatError('Whoa, lots of questions! Give me a few seconds, then ask again.', 429, h, { 'retry-after': String(60 - Math.floor((now / 1000) % 60)) });
  await ensureSchema(env.DB);
  // the student's plan (free unless they're signed in to a paid account) sets their allowance
  const { plan, account } = await planOf(request, env), L = limitsFor(env, plan), perDay = L.all;
  const who = account ? 'a:' + account : uid; // a paid plan counts per account, across devices
  const bump = (k) => countUseQuery(env.DB, k, today);
  // no id → the allowance is per network ("anon" is never one shared pool)
  const question = body.q === 1 || body.q === true; // something the student asked (not a file section)
  const keys = [who === 'anon' ? 'an:' + ip : 'u:' + who, 'i:' + ip, ...(question ? ['q:' + (who === 'anon' ? 'an:' + ip : who)] : [])];
  const counts = (await env.DB.batch(keys.map(bump))).map((r) => r.results?.[0]?.n || 0);
  const [usedU, usedI, usedQ = 0] = counts;
  const refund = () => uncountUses(env.DB, keys);
  if (usedU > perDay || usedI > Math.max(perDay, 150) * 25 || usedQ > L.questions) {
    const secs = Math.ceil(msUntilMidnightPH(now) / 1000), shown = usedQ > L.questions ? L.questions : perDay;
    if (question && usedQ > L.questions) ctx.waitUntil(refund().catch(() => {})); // a refused question isn't counted
    return chatError(plan === 'free'
      ? `You've used today's ${shown} free questions. They come back at midnight, or add your own free Groq key in Settings to carry on right now.`
      : `You've reached today's fair-use limit (${shown}). It resets at midnight. Thanks for studying so hard!`, 429, h, { 'retry-after': String(secs), 'x-cassie-daily': '1' });
  }
  const left = { 'x-cassie-left': String(Math.max(0, question ? L.questions - usedQ : perDay - usedU)), 'x-cassie-plan': plan };

  // Claude first for the main chat: Free gets Haiku for its first answers each day (FREE_CLAUDE_LIMIT),
  // then Groq; Pro gets Sonnet for its first answers each day, then Haiku; Plus gets Haiku
  if (env.ANTHROPIC_KEY && body.brain === 'claude' && uid !== 'anon') {
    let family = null;
    for (const [fam, max] of L.claude) {
      if (!(max > 0)) continue;
      let usedC = Infinity, usedCi = Infinity;
      try { [usedC, usedCi] = (await env.DB.batch([bump('c:' + fam + ':' + who), bump('ci:' + ip)])).map((r) => r.results?.[0]?.n || 0); } catch (e) { /* treat as used up */ }
      if (usedC <= max && usedCi <= Math.max(max, 40) * 25) { family = fam; break; }
    }
    if (family) {
      let reply = null;
      try { reply = await askClaude(env, cleaned, family); } catch (e) { reply = null; }
      if (reply) {
        ctx.waitUntil(countChat(env, today, 'claude'));
        return json({ choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }] }, 200, { ...h, ...left, 'x-cassie-source': 'claude' });
      }
    }
  }

  const maxTokens = Math.min(Math.max(+body.max_tokens || 2048, 64), 4000);
  const temperature = typeof body.temperature === 'number' ? Math.min(Math.max(body.temperature, 0), 1.2) : 0.6;
  let lastStatus = 503, lastDetail = '';
  const problems = [];
  if (env.GROQ_KEY) {
    let models;
    if (cleaned.image || body.model === 'vision') { models = (await visionModels(env)).slice(0, 4); if (!models.length) problems.push('Groq: no picture-reading model on this key'); }
    else models = [CHAT_MODELS.includes(body.model) ? body.model : CHAT_MODELS[0], ...CHAT_MODELS].filter((m, k, a) => a.indexOf(m) === k);
    // stream: true (Talk with Cassie) — the answer comes back word by word, so she starts speaking
    // as soon as the first sentence is written instead of waiting for all of it
    const stream = body.stream === true && !cleaned.image;
    for (const model of models) {
      const payload = { model, messages: cleaned.messages, max_tokens: maxTokens, temperature, ...(stream ? { stream: true } : {}) };
      if (/gpt-oss/.test(model) && ['low', 'medium', 'high'].includes(body.reasoning_effort)) payload.reasoning_effort = body.reasoning_effort;
      let r;
      try {
        r = await fetch(`${GROQ}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_KEY}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
      } catch (e) { lastStatus = 503; problems.push(`Groq ${model}: ${e.name === 'TimeoutError' ? 'no answer in 30 s' : reasonOf(0, e.message)}`); continue; }
      if (r.ok) {
        ctx.waitUntil(countChat(env, today, 'groq'));
        return new Response(r.body, { status: 200, headers: { 'content-type': stream ? 'text/event-stream' : 'application/json', 'cache-control': 'no-store', ...h, ...left, 'x-cassie-source': 'groq' } });
      }
      lastStatus = r.status;
      try { lastDetail = (await r.json()).error?.message || ''; } catch (e) { lastDetail = ''; }
      problems.push(`Groq ${model}: ${reasonOf(r.status, lastDetail)}`);
      // too long: the app trims the chat and retries, so hand it back (a picture the model can't take tries the next one)
      if (r.status === 413 || (r.status === 400 && !cleaned.image && !/model|decommission|not found|does not exist|vision|image/i.test(lastDetail))) return chatError(lastDetail || 'Too long.', r.status, h);
      // 429 / 5xx / retired model / picture refused: try the next model, then the backups
    }
  }
  // Gemini (your GEMINI_KEY): reads pictures and answers text when Groq couldn't
  if (env.GEMINI_KEY) {
    const g = await askGemini(env, cleaned.messages, maxTokens);
    if (g.reply) {
      ctx.waitUntil(countChat(env, today, 'gemini'));
      return json({ choices: [{ index: 0, message: { role: 'assistant', content: g.reply }, finish_reason: 'stop' }] }, 200, { ...h, ...left, 'x-cassie-source': 'gemini' });
    }
    problems.push(g.detail);
  }
  if (env.AI && cleaned.image) {
    const v = await aiVision(env, cleaned.messages, maxTokens);
    if (v.reply) {
      ctx.waitUntil(countChat(env, today, 'backup-picture'));
      return json({ choices: [{ index: 0, message: { role: 'assistant', content: v.reply }, finish_reason: 'stop' }] }, 200, { ...h, ...left, 'x-cassie-source': 'backup-picture' });
    }
    problems.push(v.detail);
  }
  if (env.AI && !cleaned.image) {
    try {
      const out = await env.AI.run(BACKUP_MODEL, { messages: textOnly(cleaned.messages), max_tokens: Math.min(maxTokens, 2048), temperature });
      const reply = (out && (out.response ?? out.result?.response)) || '';
      if (reply) {
        ctx.waitUntil(countChat(env, today, 'backup'));
        return json({ choices: [{ index: 0, message: { role: 'assistant', content: String(reply) }, finish_reason: 'stop' }] }, 200, { ...h, ...left, 'x-cassie-source': 'backup' });
      }
    } catch (e) { lastDetail = lastDetail || String(e && e.message || e); problems.push(`Workers AI: ${reasonOf(0, e && e.message || e)}`); }
  }
  ctx.waitUntil(countChat(env, today, 'failed'));
  ctx.waitUntil(logProblem(env, cleaned.image ? 'chat: picture' : 'chat: text', problems.filter(Boolean).join(' | ') || `status ${lastStatus}`));
  // an unanswered question shouldn't use up the person's daily allowance
  ctx.waitUntil(refund());
  if (cleaned.image && !env.GROQ_KEY && !env.GEMINI_KEY) return chatError('Reading photos needs a Groq or Gemini key. Add one in Settings.', 503, h);
  if (cleaned.image) vision.at = 0; // look again for picture readers next time
  return lastStatus === 429
    ? chatError('Cassie is very busy right now. Try again in a minute.', 429, h, { 'retry-after': '20' })
    : chatError(cleaned.image ? 'I couldn’t read that picture just now. Try again in a minute, or type the question instead.' : 'Cassie can’t reach her brain right now. Try again in a moment.', 503, h);
}

/* ------------------------------------------------------------------ pictures */
const IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell'; // Workers AI, fast and free-tier friendly
/* Gemini pictures (Google's image model, "Nano Banana"), with the owner's GEMINI_KEY. Google only
   makes pictures for a key with billing on, so this is tried first and anything else falls back.
   It can start from the student's own photo ("a photo of the answer": their slide, redrawn with the
   answer marked on it). A plan gets so many: Free a few a week, Plus and Pro a few a day.
   GEMINI_PICTURES=off turns it off; GEMINI_IMAGE_MODEL picks the model;
   FREE_PICTURES_WEEK / PLUS_PICTURES_DAY / PRO_PICTURES_DAY set the numbers. */
const geminiPicturesOn = (env) => !!env.GEMINI_KEY && env.GEMINI_PICTURES !== 'off';
let geminiPicGone = false, geminiPicGoneAt = 0; // a key without billing: don't ask again for a while
function pictureAllowance(env, plan) {
  const n = (v, d) => (v != null && v !== '' && Number.isFinite(+v) ? +v : d);
  if (plan === 'pro') return { per: 'day', n: n(env.PRO_PICTURES_DAY, 20) };
  if (plan === 'plus') return { per: 'day', n: n(env.PLUS_PICTURES_DAY, 5) };
  return { per: 'week', n: n(env.FREE_PICTURES_WEEK, 3) };
}
const weekOf = (ms) => { const d = new Date(ms + TZ_OFFSET_H * 3600e3); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
function geminiImageModels(env) {
  if (env.GEMINI_IMAGE_MODEL) return [env.GEMINI_IMAGE_MODEL];
  const ver = (id) => parseFloat((/gemini-(\d+(?:\.\d+)?)/.exec(id) || [0, 0])[1]) || 0;
  const found = (gemini.all || []).filter((id) => /^gemini-.*image/.test(id) && !/pro|tts|audio/.test(id))
    .sort((a, b) => ver(b) - ver(a) || (/preview/.test(a) ? 1 : 0) - (/preview/.test(b) ? 1 : 0) || (/lite/.test(a) ? 1 : 0) - (/lite/.test(b) ? 1 : 0));
  return [...new Set([...found, 'gemini-3.1-flash-image-preview', 'gemini-2.5-flash-image'])].slice(0, 3);
}
async function geminiPicture(env, prompt, ref) {
  await geminiModels(env); // learns the model names this key can use
  const parts = [];
  if (ref) parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
  parts.push({ text: prompt });
  let last = '';
  for (const model of geminiImageModels(env)) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY }, signal: AbortSignal.timeout(90000),
        body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: '4:3' } } }),
      });
      if (!r.ok) {
        let m = ''; try { m = (await r.json()).error?.message || ''; } catch (e) { /* not JSON */ }
        last = `${model}: ${reasonOf(r.status, m)}`;
        if (r.status === 429 && /limit:\s*0|billing|free tier/i.test(m)) { geminiPicGone = true; geminiPicGoneAt = Date.now(); return { error: 'no-billing', detail: last }; }
        continue;
      }
      const got = ((await r.json()).candidates?.[0]?.content?.parts || []).find((p) => p.inlineData && p.inlineData.data);
      if (got) return { image: got.inlineData.data, mimeType: got.inlineData.mimeType || 'image/png', model };
      last = `${model}: no picture came back`;
    } catch (e) { last = `${model}: ${reasonOf(0, e.message)}`; }
  }
  return { error: 'failed', detail: last };
}

async function image(request, env, ctx) {
  const h = allowedOrigin(request, env);
  if (!h) return new Response('forbidden', { status: 403 });
  let body; try { body = JSON.parse(await request.text()); } catch (e) { return chatError('Bad request.', 400, h); }
  const prompt = String(body.prompt || '').replace(/\s+/g, ' ').trim().slice(0, body.gemini ? 6000 : 1500);
  if (prompt.length < 2) return chatError('What should the picture show?', 400, h);
  await ensureSchema(env.DB);
  const today = dayOf(Date.now());
  // Gemini first, when asked ("gemini": true). If it can't (no billing, none left, a hiccup), say so: the app has other ways.
  if (body.gemini) {
    const no = (msg, extra = {}) => json({ error: { message: msg }, fallback: true, ...extra }, 503, { ...h, 'access-control-expose-headers': 'x-cassie-left' });
    if (!geminiPicturesOn(env) || (geminiPicGone && Date.now() - geminiPicGoneAt < 30 * 60e3)) return no('Gemini pictures aren’t on.');
    const { plan, account } = await planOf(request, env);
    const allow = pictureAllowance(env, plan);
    const uid = /^[\w-]{8,64}$/.test(body.uid || '') ? body.uid : '';
    const who = account ? 'a:' + account : uid ? 'u:' + uid : 'ip:' + (request.headers.get('cf-connecting-ip') || 'unknown');
    const period = allow.per === 'week' ? weekOf(Date.now()) : today, key = `gpic:${who}`;
    const usedPics = await countUse(env.DB, key, period);
    if (usedPics > allow.n) {
      await uncountUses(env.DB, [key]);
      return no(allow.per === 'week' ? `You’ve made this week’s ${allow.n} Gemini pictures.` : `You’ve made today’s ${allow.n} Gemini pictures.`, { used: true, per: allow.per, plan });
    }
    const ref = typeof body.ref === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(body.ref) && body.ref.length < 7e6
      ? { mimeType: /^data:(image\/\w+)/.exec(body.ref)[1], data: body.ref.split(',')[1] } : null;
    const out = await geminiPicture(env, prompt, ref);
    if (!out.image) {
      await uncountUses(env.DB, [key]);
      ctx.waitUntil(logProblem(env, 'gemini-picture', out.detail || out.error));
      return no('Gemini couldn’t make that picture.');
    }
    ctx.waitUntil(countChat(env, today, ref ? 'gemini-picture-photo' : 'gemini-picture'));
    return json({ image: out.image, mimeType: out.mimeType, source: 'gemini', left: Math.max(0, allow.n - usedPics), per: allow.per }, 200, h);
  }
  if (!env.AI) return chatError('Pictures aren’t set up on this server.', 503, h);
  const uid = /^[\w-]{8,64}$/.test(body.uid || '') ? body.uid : 'anon';
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const perDay = +env.IMAGE_LIMIT || 20;
  const bump = (k) => countUseQuery(env.DB, k, today);
  const mine = uid === 'anon' ? 'img:an:' + ip : 'img:u:' + uid; // (counted per network without an id)
  const [u, i] = await env.DB.batch([bump(mine), bump('img:i:' + ip)]);
  if ((u.results?.[0]?.n || 0) > perDay || (i.results?.[0]?.n || 0) > perDay * 25) {
    return chatError(`You've made today's ${perDay} pictures. More tomorrow, or add a free Gemini key in Settings for your own picture allowance.`, 429, h);
  }
  try {
    const out = await env.AI.run(IMAGE_MODEL, { prompt, steps: 6 });
    const b64 = out && (out.image || out.result?.image);
    if (!b64) throw new Error('empty');
    ctx.waitUntil(countChat(env, today, 'image'));
    return json({ image: b64, mimeType: 'image/jpeg' }, 200, h);
  } catch (e) {
    ctx.waitUntil(uncountUses(env.DB, [mine, 'img:i:' + ip])); // (given back to the one it was counted to)
    return chatError('Couldn’t make that picture right now. Try again in a minute, or describe it more simply.', 503, h);
  }
}

/* ------------------------------------------------------------------ feedback */
const FEEDBACK = new Set(['up', 'down', 'report', 'auto']); // auto: an error the app hit (the message only)
async function feedback(request, env) {
  const h = allowedOrigin(request, env);
  if (!h) return new Response('forbidden', { status: 403 });
  const text = await request.text();
  if (text.length > 8000) return new Response('too big', { status: 413, headers: h });
  let b; try { b = JSON.parse(text); } catch (e) { return new Response('bad json', { status: 400, headers: h }); }
  const uid = clean(b.uid, 64);
  if (!/^[\w-]{8,64}$/.test(uid) || !FEEDBACK.has(b.kind)) return new Response('bad', { status: 400, headers: h });
  const c = b.ctx || {};
  const ctxText = [c.role, c.grade, c.age, c.platform, c.version].map((v) => clean(v, 30)).filter(Boolean).join(' · ');
  await ensureSchema(env.DB);
  const now = Date.now();
  await env.DB.prepare('INSERT INTO feedback (ts, day, uid, kind, feature, text, ctx) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(now, dayOf(now), uid, b.kind, label(b.feature, 40), b.kind === 'auto' ? autoCode(b.text) : String(b.text || '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, 1500), ctxText).run();
  return new Response(null, { status: 204, headers: h });
}

// An automatic error report keeps only which message the app showed ("file_kind", "network"):
// the words themselves can hold a file's name or a service's reply.
const autoCode = (t) => (/^[a-z][a-z0-9_]{0,39}$/.test(String(t || '')) ? String(t) : 'other');

/* ------------------------------------------------------------------ Cassie's studio voice */
// Reads text aloud with ElevenLabs when the secret ELEVENLABS_API_KEY is set (Cloudflare → the
// worker → Settings → Variables and Secrets; never in the app). GET /speak?uid=… says whether it's
// on, how many studio characters are left (this month's, or this student's today if that is less),
// and the day the allowance comes back; POST /speak { text, voice: 'woman' | 'man', uid } answers with an MP3.
// Credits cost money, so: each student gets SPEAK_DAILY_CHARS a day (default 12000, about 15 minutes of talk), the whole app
// SPEAK_MONTHLY_CHARS a month (default 9500, under ElevenLabs' free 10,000), and the same words
// (a flashcard, a quiz question) are kept in Cloudflare's cache for 30 days, so they're paid for
// once. When it's off or used up, the app types instead: Cassie never speaks in another voice.
const ELEVEN = 'https://api.elevenlabs.io/v1/text-to-speech';
// Sarah, and Daniel for the man's voice: calm, precise, British — an "AI butler" feel (ElevenLabs' own voices;
// George is the spare if Daniel ever isn't there)
// ElevenLabs' standard voices (every account has them): Jessica (bright, warm) and Chris (down-to-earth); George if Chris is missing
const ELEVEN_VOICES = { woman: 'cgSgspJ2msm6clMCkdW9', man: 'iP95p4xoKVk53GoZ742B', manSpare: 'JBFqnCBsd6RMkjVDRZzb' };
// What's left of the studio voice, read without counting a use: the app decides at the start of a
// lesson, a Listen or a voice chat whether Bella can say all of it. Only numbers and a date go back.
/* What the ElevenLabs account itself has left (its credits) and the day they come back: asked at most every
   10 minutes per server copy, and set to none at once when ElevenLabs says the credits are gone. Cassie's
   own counts (SPEAK_MONTHLY_CHARS) can't see credits used elsewhere (the ElevenLabs website, another app,
   a plan change), so without this she kept asking a voice with nothing left. A key that can't read its
   subscription leaves only Cassie's own counts. */
let elevenCredits = null;
const SPEAK_DAY = 12000; // (3000 ran out after about 5 minutes of voice chat)
async function elevenLeft(env) {
  if (elevenCredits && Date.now() - elevenCredits.at < 10 * 60e3) return elevenCredits;
  try {
    const r = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': env.ELEVENLABS_API_KEY }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const d = await r.json();
    if (!Number.isFinite(+d.character_limit) || !Number.isFinite(+d.character_count)) return null;
    const reset = +d.next_character_count_reset_unix;
    elevenCredits = { at: Date.now(), left: Math.max(0, +d.character_limit - +d.character_count), back: reset > 0 ? dayOf(reset * 1000) : '' };
    return elevenCredits;
  } catch (e) { return null; }
}
async function speakLeft(env, uidRaw) {
  if (!env.ELEVENLABS_API_KEY) return { on: false, left: 0 };
  const monthMax = +env.SPEAK_MONTHLY_CHARS || 9500, dayMax = +env.SPEAK_DAILY_CHARS || SPEAK_DAY;
  const now = Date.now(), day = dayOf(now), month = day.slice(0, 7);
  const uid = /^[\w-]{8,64}$/.test(String(uidRaw || '')) ? String(uidRaw) : 'anon';
  let usedMonth = 0, usedDay = 0;
  if (env.DB) {
    await ensureSchema(env.DB);
    const read = (k, period) => env.DB.prepare('SELECT n FROM quota WHERE k = ? AND day = ?').bind(k, period).first().then((r) => (r && r.n) || 0);
    [usedMonth, usedDay] = await Promise.all([read('SP:month', month), read('sp:' + uid, day)]);
  }
  const monthLeft = Math.max(0, monthMax - usedMonth), dayLeft = Math.max(0, dayMax - usedDay);
  const [y, m] = month.split('-').map(Number);
  const nextMonth = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
  const tomorrow = dayOf(now + 864e5);
  const mine = { on: true, left: Math.min(monthLeft, dayLeft), back: monthLeft <= dayLeft ? nextMonth : tomorrow };
  // the account's own credits, when they're the smaller (back: the day ElevenLabs renews them)
  const credits = await elevenLeft(env);
  return credits && credits.left < mine.left ? { on: true, left: credits.left, back: credits.back || nextMonth } : mine; // (a key that can't say when: the 1st)
}
async function speak(request, env, ctx) {
  const h = allowedOrigin(request, env);
  if (!h) return new Response('forbidden', { status: 403 });
  if (request.method === 'GET') return json(await speakLeft(env, new URL(request.url).searchParams.get('uid')), 200, h);
  if (request.method !== 'POST') return new Response('not found', { status: 404, headers: h });
  if (!env.ELEVENLABS_API_KEY) return chatError('Cassie’s studio voice isn’t set up.', 503, h, { 'x-speak': 'off' });
  let b; try { b = await request.json(); } catch (e) { return chatError('bad json', 400, h); }
  const text = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, 700);
  if (!text) return chatError('Nothing to say.', 400, h);
  const uid = /^[\w-]{8,64}$/.test(String(b.uid || '')) ? String(b.uid) : 'anon';
  const voice = b.voice === 'man' ? (env.ELEVENLABS_VOICE_MAN || ELEVEN_VOICES.man) : (env.ELEVENLABS_VOICE_WOMAN || ELEVEN_VOICES.woman);
  const model = env.ELEVENLABS_MODEL || 'eleven_flash_v2_5';
  const audio = (body, extra = {}) => new Response(body, { status: 200, headers: { ...h, 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=86400', ...extra } });
  // said before? then it's free
  const key = new Request('https://speak.cassie/' + (await sha256(`${voice}|${model}|${text}`)));
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return audio(hit.body, { 'x-speak': 'cache' });
  const now = Date.now(), day = dayOf(now), month = day.slice(0, 7);
  if (elevenCredits && elevenCredits.left < text.length && Date.now() - elevenCredits.at < 10 * 60e3) return chatError('Cassie’s studio voice is resting until its credits come back.', 429, h, { 'x-speak': 'month' });
  if (env.DB) {
    await ensureSchema(env.DB);
    const [mine, all] = await Promise.all([countUse(env.DB, 'sp:' + uid, day, text.length), countUse(env.DB, 'SP:month', month, text.length)]);
    if (all > (+env.SPEAK_MONTHLY_CHARS || 9500)) return chatError('Cassie’s studio voice is resting until next month.', 429, h, { 'x-speak': 'month' });
    if (mine > (+env.SPEAK_DAILY_CHARS || SPEAK_DAY)) return chatError('That’s a lot of listening today. Cassie types her answers until tomorrow.', 429, h, { 'x-speak': 'day' });
  }
  let r;
  // the man's voice is steady and measured; Cassie's own stays lively
  // (Eleven v4 takes only stability and similarity: no style)
  const settings = b.voice === 'man' ? { stability: 0.72, similarity_boost: 0.8, ...(/^eleven_v4/.test(model) ? {} : { style: 0.05 }) } : { stability: 0.5, similarity_boost: 0.75 };
  const say = (v) => fetch(`${ELEVEN}/${v}?output_format=mp3_44100_64`, {
    method: 'POST', headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: model, voice_settings: settings }), signal: AbortSignal.timeout(20000),
  });
  try {
    r = await say(voice);
    if ((r.status === 404 || r.status === 400) && voice === ELEVEN_VOICES.man) r = await say(ELEVEN_VOICES.manSpare);
  } catch (e) { ctx.waitUntil(logProblem(env, 'voice: elevenlabs', reasonOf(0, e && e.message || e)).catch(() => {})); return chatError('The studio voice didn’t answer.', 502, h); }
  if (!r.ok) {
    let m = ''; try { m = JSON.stringify(await r.json()).slice(0, 300); } catch (e) { /* not JSON */ }
    // the account's credits are gone: resting until they come back (said once, not asked again and again)
    if (/quota_exceeded|credits remaining/i.test(m)) {
      if (!elevenCredits || elevenCredits.left > 0) ctx.waitUntil(logProblem(env, 'voice: elevenlabs', 'out of credits').catch(() => {}));
      elevenCredits = { at: Date.now(), left: 0, back: (elevenCredits && elevenCredits.back) || '' };
      return chatError('Cassie’s studio voice is resting until its credits come back.', 429, h, { 'x-speak': 'month' });
    }
    ctx.waitUntil(logProblem(env, 'voice: elevenlabs', reasonOf(r.status, m)).catch(() => {}));
    return chatError('The studio voice didn’t work just now.', 502, h, { 'x-speak': 'error' });
  }
  const buf = await r.arrayBuffer();
  ctx.waitUntil(cache.put(key, new Response(buf, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=2592000' } })));
  ctx.waitUntil(countChat(env, day, 'speak').catch(() => {}));
  return audio(buf, { 'x-speak': 'new' });
}

/* ------------------------------------------------------------------ live board rooms */
// A study room is a shared drawing board. Someone creates it and gets a 6-letter code; up
// to ROOM_MAX classmates join with the code (or the link) and everyone's strokes appear on
// everyone's board. Clients send their strokes and ask for new ones about once a second.
// Rooms and their drawings are deleted after a day. Only drawings are shared — no chat.
const ROOM_MAX = 12, ROOM_HOURS = 24, ROOM_OPS_MAX = 6000, ROOM_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
// studying together in a room (app.js / study-room.js): chat, Cassie's answers shared with the
// group, shared flashcards, a group quiz, pinned notes and a shared timer — steps like the drawing's
const STUDY_OPS = ['msg', 'share', 'deck', 'card', 'grade', 'quiz', 'ans', 'note', 'unnote', 'timer'];
async function room(request, env, url) {
  const h = allowedOrigin(request, env);
  if (!h) return new Response('forbidden', { status: 403 });
  if (!env.DB) return json({ error: 'Study rooms can’t open right now because Cassie’s server isn’t answering. Try again in a moment.', code: 'room_unavailable' }, 503, h);
  await ensureSchema(env.DB);
  const db = env.DB, now = Date.now();
  const okUid = (u) => /^[\w-]{8,64}$/.test(u);
  const okCode = (c) => /^[A-Z0-9]{6}$/.test(c);
  const liveQuery = (code) => db.prepare('SELECT code, title, created FROM rooms WHERE code = ? AND created > ?').bind(code, now - ROOM_HOURS * 3600e3);
  const membersQuery = (code) => db.prepare('SELECT uid, name FROM room_members WHERE code = ? AND seen > ? ORDER BY name').bind(code, now - 25000);
  const live = async (code) => liveQuery(code).first();
  const members = async (code) => (await membersQuery(code).all()).results || [];

  if (request.method === 'GET' && url.pathname === '/room/poll') {
    const code = clean(url.searchParams.get('code'), 6).toUpperCase(), uid = clean(url.searchParams.get('uid'), 64);
    const since = Math.max(0, parseInt(url.searchParams.get('since'), 10) || 0);
    if (!okCode(code) || !okUid(uid)) return json({ error: 'bad request' }, 400, h);
    // the pointer: where you are and what you're doing (a cursor, a laser trail), replaced each time
    let p = url.searchParams.get('p');
    try { if (!p || p.length > 4000 || typeof JSON.parse(p) !== 'object') p = null; } catch (e) { p = null; }
    // everything in one trip to the database (a room polls about once a second per person)
    const [room, , , ops, here, people] = await db.batch([
      liveQuery(code),
      // "I'm still here" at most every 10 s (a write only when it's due)
      db.prepare('UPDATE room_members SET seen = ? WHERE code = ? AND uid = ? AND seen < ?').bind(now, code, uid, now - 10000),
      // (only a member's pointer is kept)
      p ? db.prepare('INSERT INTO room_here (code, uid, ts, p) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM room_members WHERE code = ? AND uid = ?) ON CONFLICT(code, uid) DO UPDATE SET ts = excluded.ts, p = excluded.p').bind(code, uid, now, p, code, uid)
        : db.prepare('SELECT 1'),
      db.prepare('SELECT id, uid, ts, op FROM room_ops WHERE code = ? AND id > ? ORDER BY id LIMIT 400').bind(code, since),
      db.prepare('SELECT uid, ts, p FROM room_here WHERE code = ? AND uid != ? AND ts > ?').bind(code, uid, now - 6000),
      membersQuery(code),
    ]);
    // (a room that has ended: what was written above is about a room nobody can open, and the tidy-up removes it)
    if (!(room.results || []).length) return json({ error: 'That room has ended, so it can’t be joined. Rooms last one day. Ask for a new code.', code: 'room_gone', gone: true }, 404, h);
    const rows = ops.results || [];
    return json({ ops: rows.map((r) => ({ id: r.id, uid: r.uid, ts: r.ts, op: JSON.parse(r.op) })), members: people.results || [], here: (here.results || []).map((r) => ({ uid: r.uid, ts: r.ts, p: JSON.parse(r.p) })), more: rows.length === 400, now }, 200, h);
  }
  if (request.method !== 'POST') return new Response('not found', { status: 404, headers: h });
  const text = await request.text();
  if (text.length > 200000) return json({ error: 'Too much at once.' }, 413, h);
  let b; try { b = JSON.parse(text); } catch (e) { return json({ error: 'bad json' }, 400, h); }
  const uid = clean(b.uid, 64), name = clean(b.name, 30).trim() || 'Classmate';
  if (!okUid(uid)) return json({ error: 'bad request' }, 400, h);

  if (url.pathname === '/room/create') {
    // (rooms older than a day, and their drawings, go in tidy(): every 10 minutes and each night)
    const old = now - ROOM_HOURS * 3600e3;
    const mine = await db.prepare('SELECT COUNT(*) AS n FROM rooms WHERE owner = ? AND created > ?').bind(uid, old).first();
    if (mine && mine.n >= 10) return json({ error: 'You’ve made 10 rooms today, which is the most for one day. Use one of those, or make a new one tomorrow.', code: 'room_limit' }, 429, h);
    let code = '';
    for (let i = 0; i < 5 && !code; i++) {
      const c = Array.from(crypto.getRandomValues(new Uint8Array(6)), (x) => ROOM_LETTERS[x % ROOM_LETTERS.length]).join('');
      if (!(await db.prepare('SELECT 1 FROM rooms WHERE code = ?').bind(c).first())) code = c;
    }
    if (!code) return json({ error: 'Study rooms can’t open right now because Cassie’s server isn’t answering. Try again in a moment.', code: 'room_unavailable' }, 503, h);
    await db.batch([
      db.prepare('INSERT INTO rooms (code, created, owner, title) VALUES (?, ?, ?, ?)').bind(code, now, uid, clean(b.title, 60) || `${name}’s study room`),
      db.prepare('INSERT INTO room_members (code, uid, name, seen) VALUES (?, ?, ?, ?)').bind(code, uid, name, now),
    ]);
    return json({ code, title: clean(b.title, 60) || `${name}’s study room` }, 200, h);
  }
  const code = clean(b.code, 6).toUpperCase();
  if (!okCode(code)) return json({ error: 'Room codes have 6 letters and numbers, like K7M2QX. Check the code your classmate shared.', code: 'room_code' }, 400, h);
  const r = await live(code);
  if (!r) return json({ error: 'There’s no room with that code. Rooms last one day, so it may have ended. Check the code, or ask for a new one.', code: 'room_none', gone: true }, 404, h);

  if (url.pathname === '/room/join') {
    const here = await members(code);
    if (here.length >= ROOM_MAX && !here.some((m) => m.uid === uid)) return json({ error: `The room is full (${ROOM_MAX} people).` }, 409, h);
    await db.prepare('INSERT INTO room_members (code, uid, name, seen) VALUES (?, ?, ?, ?) ON CONFLICT(code, uid) DO UPDATE SET name = excluded.name, seen = excluded.seen').bind(code, uid, name, now).run();
    return json({ code, title: r.title, members: await members(code) }, 200, h);
  }
  if (url.pathname === '/room/ops') {
    const ops = Array.isArray(b.ops) ? b.ops.slice(0, 40) : [];
    if (!ops.length) return json({ ok: true }, 200, h);
    const [inRoom, counted] = await db.batch([db.prepare('SELECT 1 FROM room_members WHERE code = ? AND uid = ?').bind(code, uid), db.prepare('SELECT COUNT(*) AS n FROM room_ops WHERE code = ?').bind(code)]);
    if (!(inRoom.results || []).length) return json({ error: 'You aren’t in this room yet, so you can’t draw here. Join with the room code first.', code: 'room_join_first' }, 403, h);
    const count = (counted.results || [])[0];
    if (count && count.n + ops.length > ROOM_OPS_MAX) return json({ error: 'This board is full, so nothing more fits. Save it, then start a new room.', code: 'room_full_board', full: true }, 409, h);
    const rows = [];
    for (const op of ops) {
      if (!op || !(['add', 'del', 'clearmine'].includes(op.t) || STUDY_OPS.includes(op.t))) continue;
      const t = JSON.stringify(op);
      if (t.length > (STUDY_OPS.includes(op.t) ? 24000 : 60000)) continue; // one huge step is dropped, not the room
      rows.push(db.prepare('INSERT INTO room_ops (code, uid, ts, op) VALUES (?, ?, ?, ?)').bind(code, uid, now, t));
    }
    if (rows.length) await db.batch(rows);
    return json({ ok: true, n: rows.length }, 200, h);
  }
  return new Response('not found', { status: 404, headers: h });
}

/* ------------------------------------------------------------------ daily puzzle score board */
// Everyone gets the same puzzles each day (a "puzzle day" starts at midnight Philippine time).
// A student's first finish of each puzzle counts; places earn points (1st 100, 2nd 80, 3rd 65,
// then 50, 45, 40… down to 10 just for finishing). The board shows today's top three.
const PUZZLES = { sudoku: 20, nonogram: 15, hashi: 15, pipes: 10, mirrors: 8, equation: 1, geography: 1 }; // fastest believable finish, in seconds (or points)
const puzzleDay = (ms) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);
const placePoints = (rank) => (rank === 1 ? 100 : rank === 2 ? 80 : rank === 3 ? 65 : Math.max(10, 50 - (rank - 4) * 5));
async function scores(request, env, url) {
  const h = allowedOrigin(request, env);
  if (!h) return new Response('forbidden', { status: 403 });
  if (!env.DB) return json({ error: 'The score board needs the server database.' }, 503, h);
  await ensureSchema(env.DB);
  const db = env.DB, now = Date.now(), today = puzzleDay(now);
  const okUid = (u) => /^[\w-]{8,64}$/.test(u);
  let me = clean(url.searchParams.get('uid'), 64), day = clean(url.searchParams.get('day'), 10) || today;
  if (request.method === 'POST' && url.pathname === '/scores/submit') {
    const text = await request.text();
    if (text.length > 2000) return json({ error: 'too big' }, 413, h);
    let b; try { b = JSON.parse(text); } catch (e) { return json({ error: 'bad json' }, 400, h); }
    const uid = clean(b.uid, 64), game = clean(b.game, 20), name = clean(b.name, 24).trim() || 'Student';
    const value = Number(b.value);
    if (!okUid(uid) || !(game in PUZZLES) || !Number.isFinite(value)) return json({ error: 'bad request' }, 400, h);
    // only today's puzzle (a finish just after midnight still counts for the day it started)
    if (b.day !== today && b.day !== puzzleDay(now - 10 * 60e3)) return json({ error: 'That was another day’s puzzle.' }, 409, h);
    if (value < PUZZLES[game] || value > 86400 * 1000) return json({ error: 'That result doesn’t look right.' }, 422, h);
    await db.prepare('INSERT OR IGNORE INTO scores (day, game, uid, name, value, shown, ts) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(b.day, game, uid, name, value, clean(b.shown, 40), now).run();
    // (old days go after two weeks, in tidy())
    me = uid; day = b.day;
  } else if (!(request.method === 'GET' && url.pathname === '/scores/today')) return new Response('not found', { status: 404, headers: h });
  if (!/^\d{4}-\d\d-\d\d$/.test(day)) return json({ error: 'bad day' }, 400, h);
  // every player's points in each game (by where they placed), and their total
  const tally = (rows) => {
    const players = new Map();
    let lastKey = '', rank = 0;
    for (const r of rows) {
      const key = (r.day || '') + '|' + r.game;
      if (key !== lastKey) { lastKey = key; rank = 0; }
      rank++;
      const p = placePoints(rank);
      const pl = players.get(r.uid) || { uid: r.uid, name: r.name, games: {}, total: 0, played: 0 };
      pl.name = r.name; pl.total += p; pl.played++;
      pl.games[r.game] = (pl.games[r.game] || 0) + p;
      if (r.uid === me && (!r.day || r.day === day)) pl.mine = { ...(pl.mine || {}), [r.game]: { rank, points: p, shown: r.shown } };
      players.set(r.uid, pl);
    }
    return [...players.values()].sort((a, b) => b.total - a.total || b.played - a.played);
  };
  // the week's results in one read, newest day first (so a limit would leave out the oldest day, never today);
  // today's board is the day's part of it
  const weekFrom = puzzleDay(Date.parse(day + 'T12:00:00Z') - 6 * 86400e3);
  const weekRows = (await db.prepare('SELECT day, game, uid, name, value, shown FROM scores WHERE day >= ? AND day <= ? ORDER BY day DESC, game, value, ts LIMIT 50000').bind(weekFrom, day).all()).results || [];
  const board = tally(weekRows.filter((r) => r.day === day));
  const at = board.findIndex((p) => p.uid === me);
  const week = tally(weekRows);
  const wAt = week.findIndex((p) => p.uid === me);
  // the top 50, plus your own row if you're further down
  const list = (all, i, row) => { const out = all.slice(0, 50).map((p, k) => row(p, k)); if (i >= 50) out.push(row(all[i], i)); return out; };
  return json({
    day, players: board.length,
    top: board.slice(0, 3).map((p) => ({ name: p.name, points: p.total, me: p.uid === me })),
    me: at >= 0 ? { rank: at + 1, points: board[at].total, games: board[at].mine || {} } : null,
    table: list(board, at, (p, k) => ({ rank: k + 1, name: p.name, me: p.uid === me, games: p.games, total: p.total })),
    week: { from: weekFrom, players: week.length, table: list(week, wAt, (p, k) => ({ rank: k + 1, name: p.name, me: p.uid === me, games: p.games, played: p.played, total: p.total })) },
  }, 200, h);
}

/* ------------------------------------------------------------------ accounts */
// Passwords are never stored: only a salted PBKDF2 hash. Sessions are random
// tokens; only their SHA-256 is stored, so a leaked database can't sign anyone in.
const SESSION_DAYS = 90;
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomToken = (n = 32) => b64u(crypto.getRandomValues(new Uint8Array(n)));
async function sha256(text) { return b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))); }
async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256);
  return b64u(bits);
}
function sameText(a, b) { // compare without leaking timing
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
// an account as the app sees it, with the ways it can sign in
const providersQuery = (env, id) => env.DB.prepare('SELECT provider FROM identities WHERE account = ?').bind(id);
const providerList = (r) => ((r && r.results) || []).map((x) => x.provider).sort();
async function providersOf(env, id) { return providerList(await providersQuery(env, id).all()); }
async function publicAccount(env, a, providers) {
  if (!providers) providers = await providersOf(env, a.id);
  return { email: a.email || '', name: a.name || '', password: !!a.pass, providers, google: providers.includes('google'), apple: providers.includes('apple'), data: a.data ? JSON.parse(a.data) : null };
}
const freePlan = { plan: 'free', until: 0 };
async function signedInReply(env, acc, isNew) {
  // the new session, the ways to sign in and the plan: one trip to the database
  const token = randomToken(), now = Date.now();
  const [, ways, plan] = await env.DB.batch([sessionInsert(env, await sha256(token), acc.id, now), providersQuery(env, acc.id), planQuery(env, acc.id)]);
  return { token, account: await publicAccount(env, acc, providerList(ways)), isNew, plan: paidPlan((plan.results || [])[0]) };
}

const sessionInsert = (env, hash, accountId, now) => env.DB.prepare('INSERT INTO sessions (token, account, created, seen) VALUES (?, ?, ?, ?)').bind(hash, accountId, now, now);
async function newSession(env, accountId) {
  const token = randomToken();
  await sessionInsert(env, await sha256(token), accountId, Date.now()).run();
  return token;
}
// full: the whole account (its saved data, up to 250 KB); otherwise only who it is
async function accountFromRequest(request, env, full = false) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!/^[\w-]{20,100}$/.test(token)) return null;
  const hash = await sha256(token);
  const row = await env.DB.prepare(`SELECT ${full ? 'a.*' : 'a.id, a.name'}, s.created AS s_created FROM sessions s JOIN accounts a ON a.id = s.account WHERE s.token = ?`).bind(hash).first();
  if (!row || Date.now() - row.s_created > SESSION_DAYS * 864e5) return null;
  return { ...row, sessionHash: hash };
}
// Slow down password guessing: at most 15 password tries per account per hour (from anywhere),
// and 100 sign-in attempts per address per hour (a whole class can share one school address).
async function authAllowed(request, env, key, max = 100) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const hour = new Date().toISOString().slice(0, 13);
  return (await countUse(env.DB, key || 'auth:' + ip, hour)) <= max;
}
// Throwaway inboxes, used to make account after account for more free questions.
const DISPOSABLE_RE = /@(mailinator|guerrillamail|guerrillamailblock|sharklasers|grr|10minutemail|10minemail|tempmail|temp-mail|tempmailo|tempail|yopmail|trashmail|getnada|nada|dispostable|maildrop|throwawaymail|mintemail|mohmal|emailondeck|fakeinbox|spamgourmet|moakt|tmpmail|tmail|burnermail|inboxkitten|mailnesia|mytemp|emailfake|fakemail|discard|mailcatch|spambox|33mail)\./i;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
/* Sign in with Google and Apple. Their ID tokens are checked here against their own public keys
   (signature, who it's for, who made it, when it ends); the client IDs come from the server's
   variables GOOGLE_CLIENT_ID and APPLE_SERVICES_ID, and a provider without one is simply off. */
const IDP = {
  google: { keys: 'https://www.googleapis.com/oauth2/v3/certs', iss: ['https://accounts.google.com', 'accounts.google.com'], aud: (env) => env.GOOGLE_CLIENT_ID },
  apple: { keys: 'https://appleid.apple.com/auth/keys', iss: ['https://appleid.apple.com'], aud: (env) => env.APPLE_SERVICES_ID },
};
const idpKeys = {}; // provider → { at, keys }, kept for an hour (fetched again when a new key id shows up)
const b64urlBytes = (t) => { const s2 = String(t).replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(s2 + '='.repeat((4 - (s2.length % 4)) % 4)), (c) => c.charCodeAt(0)); };
const b64urlJson = (t) => JSON.parse(new TextDecoder().decode(b64urlBytes(t)));
async function providerKeys(name, fresh) {
  const c = idpKeys[name];
  if (!fresh && c && Date.now() - c.at < 3600e3) return c.keys;
  const r = await fetch(IDP[name].keys, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('no keys');
  const keys = ((await r.json()).keys || []).filter((k) => k.kty === 'RSA');
  idpKeys[name] = { at: Date.now(), keys };
  return keys;
}
async function verifyIdToken(name, token, env, nonce) {
  const aud = IDP[name].aud(env);
  if (!aud) throw new Error('off');
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || token.length > 8000) throw new Error('shape');
  let head, claims;
  try { head = b64urlJson(parts[0]); claims = b64urlJson(parts[1]); } catch (e) { throw new Error('shape'); }
  if (head.alg !== 'RS256' || !head.kid) throw new Error('alg');
  let jwk = (await providerKeys(name)).find((k) => k.kid === head.kid);
  if (!jwk) jwk = (await providerKeys(name, true)).find((k) => k.kid === head.kid); // keys rotate
  if (!jwk) throw new Error('key');
  const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1])))) throw new Error('signature');
  const now = Date.now() / 1000, auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(aud) || !IDP[name].iss.includes(claims.iss) || !(+claims.exp > now - 60) || (claims.iat && +claims.iat > now + 300) || !claims.sub) throw new Error('claims');
  if (nonce !== undefined && claims.nonce !== nonce) throw new Error('nonce');
  return { sub: String(claims.sub).slice(0, 255), email: String(claims.email || '').toLowerCase().slice(0, 254), verified: claims.email_verified === true || claims.email_verified === 'true', name: String(claims.given_name || claims.name || '').slice(0, 40) };
}
// Who this Google or Apple person is in Cassie: their linked account, or the account with the same
// email (only when the provider says the email is verified), or a new account. Linking to an account
// that has a password asks for that password once, so someone who signed up with another person's
// email can't keep a way in; a person who doesn't know it can let it go ({ forget: true }).
async function signInWith(env, provider, id, { password = '', forget = false, name = '' } = {}) {
  const now = Date.now();
  const linked = await env.DB.prepare('SELECT a.* FROM identities i JOIN accounts a ON a.id = i.account WHERE i.provider = ? AND i.sub = ?').bind(provider, id.sub).first();
  let acc = linked, isNew = false;
  if (!acc && id.verified && id.email) {
    const same = await env.DB.prepare('SELECT * FROM accounts WHERE email = ?').bind(id.email).first();
    if (same && same.pass && forget) {
      await env.DB.batch([
        env.DB.prepare('UPDATE accounts SET pass = NULL, salt = NULL, updated = ? WHERE id = ?').bind(now, same.id),
        env.DB.prepare('DELETE FROM sessions WHERE account = ?').bind(same.id),
      ]);
      same.pass = null;
    } else if (same && same.pass) {
      if (!password) return { needsPassword: true, email: same.email };
      const tried = await hashPassword(String(password).slice(0, 200), same.salt);
      if (!sameText(tried, same.pass)) return { wrongPassword: true };
    }
    acc = same;
  }
  if (!acc) {
    acc = { id: randomToken(12), email: id.verified && id.email ? id.email : null, name: String(name || id.name || '').slice(0, 40), data: null };
    await env.DB.prepare('INSERT INTO accounts (id, email, name, created, updated) VALUES (?, ?, ?, ?, ?)').bind(acc.id, acc.email, acc.name, now, now).run();
    isNew = true;
  }
  if (!linked) await env.DB.prepare('INSERT OR IGNORE INTO identities (provider, sub, account) VALUES (?, ?, ?)').bind(provider, id.sub, acc.id).run();
  return signedInReply(env, acc, isNew || !acc.data);
}
// Apple sends its answer here (a form post from appleid.apple.com), and this page hands it to the
// app: to the window that opened it, or back to the app's page when there's no such window. Only an
// app address this server already allows can receive it, and the app checks its own one-time nonce.
async function appleReturn(request, env) {
  await ensureSchema(env.DB);
  const form = await request.formData().catch(() => null);
  const get = (k) => String((form && form.get(k)) || '');
  let st = {};
  try { st = b64urlJson(get('state')); } catch (e) { /* no state */ }
  const origin = String(st.o || ''), back = /^\/[\w/.-]{0,80}$/.test(String(st.p || '')) ? st.p : '/app.html', nonce = String(st.n || '');
  const okOrigin = !!cors(origin, env)['access-control-allow-origin'] && !origin.startsWith('chrome-extension:') && /^[\w-]{16,64}$/.test(nonce);
  let out = { code: 'apple_failed' };
  if (okOrigin) {
    if (get('error')) out = { code: get('error') === 'user_cancelled_authorize' ? 'apple_cancelled' : 'apple_failed' };
    else if (!(await authAllowed(request, env))) out = { code: 'too_many_tries' };
    else {
      try {
        const id = await verifyIdToken('apple', get('id_token'), env, nonce);
        let name = '';
        try { const u = JSON.parse(get('user') || '{}'); name = String((u.name && u.name.firstName) || '').slice(0, 40); } catch (e) { /* no name */ }
        const r = await signInWith(env, 'apple', id, { name });
        out = r.needsPassword ? { needsPassword: true, email: r.email, credential: get('id_token'), name } : r;
      } catch (e) { out = { code: 'apple_failed' }; }
    }
  }
  const msg = JSON.stringify({ type: 'cassie-auth', provider: 'apple', nonce, ...out }).replace(/</g, '\\u003c');
  const to = okOrigin ? JSON.stringify(origin).replace(/</g, '\\u003c') : 'null', home = okOrigin ? JSON.stringify(origin + back).replace(/</g, '\\u003c') : 'null';
  const sn = randomToken(16);
  const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cassie</title>
<body style="font:17px -apple-system,system-ui,sans-serif;margin:0;padding:32px;background:#f2f0ec;color:#1b1b1d"><p>Going back to Cassie…</p>
<script nonce="${sn}">(function () { var to = ${to}, home = ${home}, msg = ${msg};
if (!to) { document.body.innerHTML = '<p>Apple sign-in didn’t finish, so you aren’t signed in yet. Close this window and try again.</p>'; return; }
if (window.opener) { window.opener.postMessage(msg, to); setTimeout(function () { window.close(); }, 60); }
else location.replace(home + '#cassie-auth=' + encodeURIComponent(JSON.stringify(msg))); })();</script></body></html>`;
  return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
    'content-security-policy': `default-src 'none'; script-src 'nonce-${sn}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` } });
}

async function auth(request, env, path) {
  if (path === '/auth/apple/callback' && request.method === 'POST') return appleReturn(request, env);
  const h = allowedOrigin(request, env);
  if (!h) return new Response('forbidden', { status: 403 });
  await ensureSchema(env.DB);
  const fail = (message, status = 400, code = '') => json(code ? { error: message, code } : { error: message }, status, h);
  const ok = (data) => json(data, 200, h);
  let body = {};
  if (request.method === 'POST') {
    const text = await request.text();
    if (text.length > 300000) return fail('That is too big to save. Make it shorter, then try again.', 413, 'too_big');
    try { body = JSON.parse(text || '{}'); } catch (e) { return fail('Cassie didn’t understand that request. Close this and try again.', 400, 'bad_request'); }
  }

  // which sign-in buttons the app shows: only providers with a client ID set on this server
  if (path === '/auth/providers') {
    return ok({
      google: env.GOOGLE_CLIENT_ID ? { clientId: env.GOOGLE_CLIENT_ID } : null,
      apple: env.APPLE_SERVICES_ID ? { clientId: env.APPLE_SERVICES_ID, redirectURI: new URL('/auth/apple/callback', request.url).href } : null,
    });
  }
  if (path === '/auth/google' || path === '/auth/apple') {
    if (!(await authAllowed(request, env))) return fail('There were too many tries, so signing in is paused to keep accounts safe. Wait an hour, then try again.', 429, 'too_many_tries');
    const provider = path.slice(6), code = provider + '_failed';
    const words = provider === 'google' ? 'Google sign-in didn’t finish, so you aren’t signed in yet. Try again, or use your email and password.' : 'Apple sign-in didn’t finish, so you aren’t signed in yet. Try again, or use your email and password.';
    let id;
    // the one-time code the app made for this sign-in must be inside the token (Apple always; Google from the app's own page)
    const nonce = body.nonce ? String(body.nonce) : provider === 'apple' ? '' : undefined;
    try { id = await verifyIdToken(provider, String(body.credential || ''), env, nonce); } catch (e) { return fail(words, 401, code); }
    if (body.password && id.email && !(await authAllowed(request, env, 'authm:' + (await sha256(id.email)), 15))) return fail('There were too many tries, so signing in is paused to keep accounts safe. Wait an hour, then try again.', 429, 'too_many_tries');
    const r = await signInWith(env, provider, id, { password: String(body.password || ''), forget: body.forget === true, name: String(body.name || '') });
    if (r.wrongPassword) return fail('That password doesn’t match this email’s Cassie account. Check it for typos, or tap “I don’t know this password”.', 401, 'link_wrong_password');
    return ok(r);
  }
  if (path === '/auth/signup' || path === '/auth/login') {
    if (!(await authAllowed(request, env))) return fail('There were too many tries, so signing in is paused to keep accounts safe. Wait an hour, then try again.', 429, 'too_many_tries');
    const now = Date.now();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!EMAIL_RE.test(email)) return fail('That doesn’t look like an email yet. It needs an @ and a dot, like name@gmail.com.', 400, 'email_bad');
    if (path === '/auth/signup') {
      if (!(+body.age >= 2 && +body.age <= 100)) return fail('Ages go from 2 to 100. Check the number you typed.', 400, 'age_range'); // every age is welcome
      if (DISPOSABLE_RE.test(email)) return fail('That looks like a throwaway email, and those can’t make accounts. Use the email you check every day.', 400, 'email_disposable');
      if (password.length < 8) return fail('Your password needs at least 8 letters or numbers so it’s hard to guess.', 400, 'password_short');
      if (password.length > 200) return fail('That password is too long. Use one with fewer than 200 letters and numbers.', 400, 'password_long');
      const exists = await env.DB.prepare('SELECT id FROM accounts WHERE email = ?').bind(email).first();
      if (exists) return fail('That email is already signed up. Try signing in instead.', 409, 'email_taken');
      const salt = randomToken(16);
      const acc = { id: randomToken(12), email, name: String(body.name || '').trim().slice(0, 40), data: null };
      await env.DB.prepare('INSERT INTO accounts (id, email, pass, salt, name, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(acc.id, email, await hashPassword(password, salt), salt, acc.name, now, now).run();
      return ok({ token: await newSession(env, acc.id), account: await publicAccount(env, acc), isNew: true, plan: freePlan });
    }
    if (!(await authAllowed(request, env, 'authm:' + (await sha256(email)), 15))) return fail('There were too many tries, so signing in is paused to keep accounts safe. Wait an hour, then try again.', 429, 'too_many_tries');
    if (password.length > 200) return fail('That email and password don’t match. Check both for typos, then try again.', 401, 'wrong_password');
    const acc = await env.DB.prepare('SELECT * FROM accounts WHERE email = ?').bind(email).first();
    const tried = await hashPassword(password, (acc && acc.salt) || 'no-account-salt'); // always hash, so a wrong email takes as long as a wrong password
    const good = !!(acc && acc.pass && sameText(tried, acc.pass));
    if (!good) {
      if (acc && !acc.pass) { // made with Google or Apple: point to the right button
        const ways = await providersOf(env, acc.id);
        if (ways.includes('google')) return fail('This account was made with Google, so it has no password. Tap “Continue with Google” instead.', 401, 'google_account');
        if (ways.includes('apple')) return fail('This account was made with Apple, so it has no password. Tap “Sign in with Apple” instead.', 401, 'apple_account');
      }
      return fail('That email and password don’t match. Check both for typos, then try again.', 401, 'wrong_password');
    }
    return ok(await signedInReply(env, acc, !acc.data));
  }

  const acc = await accountFromRequest(request, env, path === '/auth/me'); // (only /auth/me sends the saved data back)
  if (!acc) return fail('You’ve been signed out, so Cassie can’t save to your account. Sign in again to carry on.', 401, 'signed_out');
  if (path === '/auth/me') {
    const [, ways, plan] = await env.DB.batch([env.DB.prepare('UPDATE sessions SET seen = ? WHERE token = ?').bind(Date.now(), acc.sessionHash), providersQuery(env, acc.id), planQuery(env, acc.id)]);
    return ok({ account: await publicAccount(env, acc, providerList(ways)), plan: paidPlan((plan.results || [])[0]) });
  }
  if (path === '/auth/save') {
    const data = body.data && typeof body.data === 'object' ? JSON.stringify(body.data) : null;
    if (!data || data.length > 250000) return fail('There was nothing to save yet. Change something first, then save.', 400, 'nothing_to_save');
    const name = String((body.data.profile && body.data.profile.name) || acc.name || '').slice(0, 40);
    await env.DB.prepare('UPDATE accounts SET data = ?, name = ?, updated = ? WHERE id = ?').bind(data, name, Date.now(), acc.id).run();
    return ok({ saved: true });
  }
  if (path === '/auth/logout') {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(acc.sessionHash).run();
    return ok({ signedOut: true });
  }
  if (path === '/auth/delete') { // "Delete my account" — removes everything about it (its plan too)
    await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE account = ?').bind(acc.id), env.DB.prepare('DELETE FROM identities WHERE account = ?').bind(acc.id), env.DB.prepare('DELETE FROM plans WHERE account = ?').bind(acc.id), env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(acc.id)]);
    return ok({ deleted: true });
  }
  return fail('Cassie couldn’t find that. It may have been removed. Go back and try again.', 404, 'not_found');
}

/* ------------------------------------------------------------------ brain check
   Real questions with known answers, through every AI the server can use. Run it from the
   dashboard ("Run brain check") or daily with a Cron Trigger; the latest result is kept. */
const CHECK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAWgAAAB4CAAAAAD6LzcmAAAHDklEQVR42u2deXAURRSHv9nsJiQEAuEQBYKUlFgIRkoQkKNQPFBABYkoUIIH5VEKChouUaxStAKIHBaXEOQQVBDEQiTciCCHgFUiIGchEG6yCUkIOdo/BpLsZsnMUDs7SXy/v7Kv53XPfNPb/fp1p1ZTiEIhlyAQ0AJaJKAFtIAWCWgBLRLQAlpAiwS0gBYJaAEtoEUCWkCLBLSAFtAiAS2gRQJaQAtokYAW0CIBLaAFtEhAC2iRgBbQ/1+5y+yd5a7auuNomtdTLbZZy073hKTJrLXbdhy76I2MbdS2S8tgV65K0dQbejVWNuvi0NrF27t/gbJd6/tGF2uxzabg1l5GQS+t49/io8ftbXFDB/9BdWRZAN3O3qeerpVssv4RW5sMK9niu8Gs/yYnw762jpVLX1MAsYlrTuekH5zfRQP4t1OG7YN0XGJK6lXv7qQ4AMYtDtUYHUCZVQAi0+zsXBl1AUjwXjds0g2Dbe7Rdy/Kv/6UfQBokBOioSOA5uod2tZv8TgAuhcUWfZVA3CfsxN07Jz8ok/5jwGw0jnQDwKwzlbQrQGizxY3fQHALBsbTTjt8/EvAN5yDPQxDaBhgZ2cMzWAfr62CPu/SL5qCNDFsclwjgJ4UTO8cND0GxSM+cjI9bQC8I22ou4DOBXC9VJdgPNOrQz1IdrV3/DCoZM014BABZ+NJGJY6b76093qa7wtyM9tqPMANZzKdWw8AvBwfaPrRiehXp0doGDscBg+oXTnqBuWVA4d59SDAA2dAj0HgJcN73ICoF6ZU6Lg80SATy6W6l1fA0j1qxIgLnSgp+QDdHcojs6oDBB7xfDC36IBXF/7mfXYofouA+/4G02GU0I2Fe7xANxR4FDUMdt0zLOpMoBrno9xMgAxO4ycxwNE+wTNkwAqnQ0V5+P1APhJOQS6PQC7TaXCogDCiifdvgSg6jZD3/R6AD2LdacDsUHPPZSm03cBMFA5BPqQBtDc3MVrKgGELSo0TNMAqmwx4bvWA/B8euFIVB8gPrtUp0vGw2SYuVs/0wSArnlOgX4fgMkmr14VARD27bWPMzSA6M2mfJdEAtQctu7M1cuHv+mmAcQbDBxBA32uKQCPZCuHQBfEAURcNHv9inAA92KllFKzNICojSZ997bzYxQx2Oi5gwX6UnOdc5ZyCvRqAJ4z77DcA+BeopRKdgFEWciRbBwQXkTo9o9PGgMKDujcTrZwtgK6NwApFir/wQ3gWabmugAi15h3PfiGzx5Li0lZIQKtj48dg83ZAmhvJEBcvpXav9dJD3IBRKwy7Zf1ZokNjzrLQhJwHHYDxKcr50DrWaIPrFW/sAhYxM+mvc7qm961hq89ecV7aEEvffk6KhSghwBEH1UOgm4DoFm9hXnX1/jh5qP/DJ3zO5mFef94AJJCALopQKJyEPR+AB6y3ECynlL1WPjmvw7AhOIr8DYA7l22c85zB3ljxXo+Ws8QvWQ5l1JVHzzCok17/DMNIOHt4gm9JTFAXqLtuaRzeQCN7Kja5AvJrwsQY3kyXuq51k6k6dBuEIBrv69xFAD7bJ8L9VShgz065SRA70iLr3H5s7nX/sruutGkzy8ALRsHOt+QYnePLrDtnJxZ0Mk3NXKsSMgFPANdQFaXX035pB8AaO9nvfMWgO2l+KVphnLyoKFJ0Jd+BGjWwlrlK5+5Cni+m5jsAjKf2GzG6Yye/fc31ysqK5cyCXphzk106JTuOYB70dO8MEsDLj++xcyRTn0O9TfHAGRWeNDJAOHWDoKteSoHcC/sAfSfqQGXO281dquuDyD+Zm9RmY1qpJRSqqZjoPfuBOhm6QbWPXkFCFvQU99nnK4BGZ23GfrVAuCEv/kEQM3y26PNhXdD9KnNSjizQd9iWVhomKoBxGw39KwD0Crgemm0KrcyBTq3DkBdKzsO+qZhgK2sajuNXPsAuA74GkcAsLmCg14OwAgL1W6ODrA5O0kfg/8w8NXPUSb42E5UBYjJtRvHUgDWOwW6BwAHzde6pUrA4wb6yZlYg93dK/VK5DoutwpR/s5Z0OfDATqYr/RUVQBtdomC8QDUuFC6+0x99hhcmL37u5n+htIqOOiJ1843mteHgPZVgIIkgPFGm5N6oELtEetSczIOL0jQQyP3SlXBQd8LUCXTSrXvoc0IWPApjDH0zu4YKBCdpcozaBPL/z/3APSKshI0JuU0CXiYlGH5ecMNvSutHv1Zvp+twfx2lGuZTFuyRYVUu/tFFL/LhmO9IWnWvh6tldlff7uw9vedqWleT/XqjVo/0Lbc/yu1Jj+zV6aSSiIBLaBFAlpAC2iRgBbQIgEtoAW0SEALaJGAFtACWiSgBbRIQAtoAS0S0AJaJKAFtIAWCWgBLRLQAlpAiwS0gBYJaAEtoEUCWkCLBLSAroD6D5J5FbIksIGiAAAAAElFTkSuQmCC';
async function groqAsk(env, model, messages, maxTokens = 1500) {
  const r = await fetch(`${GROQ}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_KEY}` }, body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.2 }), signal: AbortSignal.timeout(30000) });
  if (!r.ok) { let m = ''; try { m = (await r.json()).error?.message || ''; } catch (e) { /* not JSON */ } throw new Error(`${r.status} ${m}`.slice(0, 200)); }
  return ((await r.json()).choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>\s*/g, '');
}
async function runHealth(env) {
  geminiBlocked = { until: 0, where: '' }; // a check asks Google again, now
  const textQ = [{ role: 'user', content: 'What is 17 × 23? Reply with only the number.' }];
  const picQ = [{ role: 'user', content: [{ type: 'text', text: 'Read the sum in this picture and work it out. Reply with only the number.' }, { type: 'image_url', image_url: { url: CHECK_PNG } }] }];
  const graphQ = [{ role: 'system', content: 'When asked to graph, reply with exactly one fenced code block tagged cassie-board holding minified JSON like {"type":"graph","title":"…","fn":"…","xrange":[a,b]}. fn uses * and ^.' }, { role: 'user', content: 'graph y = x^2 - 4' }];
  const graphOk = (t) => { const m = /```cassie-board\s*([\s\S]*?)```/.exec(t || ''); try { const o = JSON.parse(m[1]); return o.type === 'graph' && /x/.test(o.fn); } catch (e) { return false; } };
  const checks = [], jobs = [];
  // every check runs at the same time, and none may take longer than 45 s, so the whole check is quick
  const run = (name, fn, ok) => { const i = checks.push(null) - 1; jobs.push((async () => {
    const t0 = Date.now();
    let timer;
    const late = new Promise((_, no) => { timer = setTimeout(() => no(new Error('no answer in 45 s (too slow)')), 45000); });
    try { const out = await Promise.race([fn(), late]); checks[i] = { name, ok: !!ok(out), ms: Date.now() - t0, detail: String(out || '').replace(/\s+/g, ' ').slice(0, 160) }; }
    catch (e) { checks[i] = { name, ok: false, warn: !!e.warn, ms: Date.now() - t0, detail: String(e.message || e).slice(0, 600) }; }
    finally { clearTimeout(timer); }
  })()); };
  if (env.GROQ_KEY) {
    run('Groq: text maths', () => groqAsk(env, CHAT_MODELS[0], textQ), (t) => /\b391\b/.test(t));
    run('Groq: graph on the board', () => groqAsk(env, CHAT_MODELS[0], graphQ), graphOk);
    run('Groq: read a picture', async () => {
      const models = await visionModels(env, true);
      if (!models.length) throw new Error(`no picture-reading model on this Groq key. Groq has: ${(vision.all || []).join(', ') || 'nothing (key problem?)'}`);
      let last;
      for (const m of models.slice(0, 3)) { try { return `${m}: ${await groqAsk(env, m, picQ, 300)}`; } catch (e) { last = e; } }
      throw last;
    }, (t) => /\b56\b/.test(t));
  } else checks.push({ name: 'Groq', ok: false, ms: 0, detail: 'GROQ_KEY is not set' });
  if (env.GEMINI_KEY) {
    // a place Google blocks is shown as a warning with the fix, not as a broken brain
    const gem = (q) => async () => { const g = await askGemini(env, q, 300); if (g.blocked) { const e = new Error(g.detail); e.warn = true; throw e; } if (!g.reply) throw new Error(g.detail); return g.reply; };
    run('Gemini: text maths', gem(textQ), (t) => /\b391\b/.test(t));
    run('Gemini: read a picture', gem(picQ), (t) => /\b56\b/.test(t));
  }
  if (env.ANTHROPIC_KEY) {
    run('Claude: text maths', () => askClaude(env, { messages: textQ }, 'haiku'), (t) => /\b391\b/.test(t));
    run('Claude: read a picture', () => askClaude(env, { messages: picQ }, 'haiku'), (t) => /\b56\b/.test(t));
  }
  if (env.AI) run('Workers AI (backup): read a picture', async () => { const v = await aiVision(env, picQ, 300); if (!v.reply) throw new Error(v.detail); return v.reply; }, (t) => /\b56\b/.test(t));
  if (env.AI) run('Workers AI (backup): text maths', async () => { const o = await env.AI.run(BACKUP_MODEL, { messages: textQ, max_tokens: 200 }); return (o && (o.response ?? o.result?.response)) || ''; }, (t) => /\b391\b/.test(t));
  await Promise.all(jobs);
  const canPictures = checks.some((c) => c.ok && /picture/.test(c.name));
  const canText = checks.some((c) => c.ok && /text maths/.test(c.name));
  const result = { ts: Date.now(), ok: canText && canPictures, canText, canPictures, checks };
  try {
    await ensureSchema(env.DB);
    await env.DB.prepare('INSERT INTO health (k, ts, data) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET ts = ?2, data = ?3').bind('last', result.ts, JSON.stringify(result)).run();
    if (!result.ok) await logProblem(env, 'brain check', checks.filter((c) => !c.ok && !c.warn).map((c) => `${c.name}: ${c.detail}`).join(' | '));
  } catch (e) { /* still return it */ }
  return result;
}
// The dashboard's password (ADMIN_TOKEN). It must be at least 16 characters; wrong guesses are
// limited to 10 an hour per network, so it can't be guessed by trying many.
async function adminOk(request, env) {
  const given = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.ADMIN_TOKEN || String(env.ADMIN_TOKEN).length < 16) return { error: 'Set an ADMIN_TOKEN of at least 16 characters in the Worker settings first.', status: 503 };
  await ensureSchema(env.DB);
  const ip = request.headers.get('cf-connecting-ip') || 'unknown', hour = new Date().toISOString().slice(0, 13);
  const tries = await env.DB.prepare('SELECT n FROM quota WHERE k = ? AND day = ?').bind('adm:' + ip, hour).first();
  if (tries && tries.n >= 10) return { error: 'Too many wrong tries. Wait an hour.', status: 429 };
  if (given && sameText(given, String(env.ADMIN_TOKEN))) return null;
  await countUse(env.DB, 'adm:' + ip, hour);
  return { error: 'wrong token', status: 401 };
}
async function health(request, env) {
  const no = await adminOk(request, env);
  if (no) return json({ error: no.error }, no.status);
  return json(await runHealth(env));
}

async function stats(request, env) {
  const url = new URL(request.url);
  const no = await adminOk(request, env);
  if (no) return json({ error: no.error }, no.status);
  const days = Math.min(365, Math.max(1, +url.searchParams.get('days') || 30));
  const db = env.DB;
  await ensureSchema(db);
  const now = Date.now(), today = dayOf(now), since = dayOf(now - (days - 1) * 864e5), week = dayOf(now - 6 * 864e5);
  const all = (q, ...b) => db.prepare(q).bind(...b).all().then((r) => r.results || []);
  const one = (q, ...b) => db.prepare(q).bind(...b).first();
  const [totals, todayRow, weekRow, rangeRow, daily, newDaily, features, words, roles, grades, ages, platforms, top] = await Promise.all([
    one(`SELECT COUNT(*) AS users, COALESCE(SUM(opens),0) AS opens, COALESCE(SUM(uses),0) AS uses, SUM(CASE WHEN last_day > first_day THEN 1 ELSE 0 END) AS came_back FROM users`),
    one(`SELECT COUNT(DISTINCT uid) AS active, SUM(event = 'open') AS opens FROM events WHERE day = ?`, today),
    one(`SELECT COUNT(DISTINCT uid) AS active FROM events WHERE day >= ?`, week),
    one(`SELECT COUNT(DISTINCT uid) AS active, SUM(event = 'open') AS opens, SUM(event = 'feature') AS uses FROM events WHERE day >= ?`, since),
    all(`SELECT day, COUNT(DISTINCT uid) AS active, SUM(event = 'open') AS opens, SUM(event = 'feature') AS uses FROM events WHERE day >= ? GROUP BY day ORDER BY day`, since),
    all(`SELECT first_day AS day, COUNT(*) AS n FROM users WHERE first_day >= ? GROUP BY first_day ORDER BY first_day`, since),
    all(`SELECT name, COUNT(*) AS n, COUNT(DISTINCT uid) AS users FROM events WHERE event = 'feature' AND day >= ? GROUP BY name ORDER BY n DESC LIMIT 40`, since),
    all(`SELECT word, SUM(n) AS n FROM words WHERE day >= ? GROUP BY word ORDER BY n DESC LIMIT 50`, since),
    all(`SELECT COALESCE(NULLIF(role,''),'unknown') AS k, COUNT(*) AS n FROM users GROUP BY k ORDER BY n DESC`),
    all(`SELECT COALESCE(NULLIF(grade,''),'-') AS k, COUNT(*) AS n FROM users WHERE role = 'student' GROUP BY k ORDER BY n DESC`),
    all(`SELECT COALESCE(NULLIF(age,''),'unknown') AS k, COUNT(*) AS n FROM users GROUP BY k ORDER BY n DESC`),
    all(`SELECT COALESCE(NULLIF(platform,''),'unknown') AS k, COUNT(*) AS n FROM users GROUP BY k ORDER BY n DESC`),
    all(`SELECT substr(uid,1,8) AS id, opens, uses, first_day, last_day, role, grade, age FROM users ORDER BY opens + uses DESC LIMIT 25`),
  ]);
  const [ratings, reports, chats, accountsRow] = await Promise.all([
    all(`SELECT COALESCE(NULLIF(feature,''),'chat') AS name, SUM(kind = 'up') AS up, SUM(kind = 'down') AS down FROM feedback WHERE day >= ? AND kind IN ('up','down') GROUP BY name ORDER BY up + down DESC LIMIT 20`, since),
    all(`SELECT ts, kind, feature, text, ctx FROM feedback WHERE day >= ? AND text != '' ORDER BY ts DESC LIMIT 60`, since),
    all(`SELECT src, SUM(n) AS n FROM chats WHERE day >= ? GROUP BY src ORDER BY n DESC`, since),
    one(`SELECT (SELECT COUNT(*) FROM accounts) AS n, (SELECT COUNT(DISTINCT account) FROM identities WHERE provider = 'google') AS google, (SELECT COUNT(DISTINCT account) FROM identities WHERE provider = 'apple') AS apple`),
  ]);
  const [healthRow, problems] = await Promise.all([
    one(`SELECT data FROM health WHERE k = 'last'`),
    all(`SELECT feature AS k, COUNT(*) AS n, MAX(ts) AS last FROM feedback WHERE day >= ? AND kind = 'error' GROUP BY feature ORDER BY n DESC LIMIT 12`, since),
  ]);
  let healthData = null; try { healthData = healthRow ? JSON.parse(healthRow.data) : null; } catch (e) { healthData = null; }
  return json({ days, today, since, totals, today_: todayRow, week: weekRow, range: rangeRow, daily, newDaily, features, words, roles, grades, ages, platforms, top, ratings, reports, chats, accounts: accountsRow, health: healthData, problems });
}

export default {
  // Cron Trigger (Worker → Settings → Triggers), every hour (0 * * * *): reminders whose hour it is, the tidy-up,
  // and at 22:00 UTC (6 a.m. in the Philippines) the daily brain check (a daily-only trigger still works: it runs then)
  async scheduled(event, env, ctx) {
    const at = (event && event.scheduledTime) || Date.now();
    if (new Date(at).getUTCHours() === 22) ctx.waitUntil(runHealth(env));
    ctx.waitUntil(tidy(env).catch(() => {}));
    ctx.waitUntil(sendReminders(env, at).catch((e) => logProblem(env, 'reminders', String(e && e.message || e).slice(0, 200)).catch(() => {})));
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (env.DB && Date.now() - tidiedAt > 10 * 60e3) { tidiedAt = Date.now(); ctx.waitUntil(tidy(env).catch(() => {})); }
    if (request.cf && request.cf.colo) lastColo = request.cf.colo;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request.headers.get('origin') || '', env) });
    try {
      if (tooFast(request, url.pathname)) return json({ error: 'Cassie is very busy right now because lots of people are asking at once. Wait a minute, then try again.', code: 'busy' }, 429, { ...cors(request.headers.get('origin') || '', env), 'retry-after': '60' });
      if (request.method === 'GET' && url.pathname === '/config') return await config(request, env);
      if (url.pathname === '/admin/plan' && (request.method === 'GET' || request.method === 'POST')) return await adminPlan(request, env, url);
      if (request.method === 'GET' && url.pathname === '/ask') return await ask(request, env, ctx);
      if (request.method === 'POST' && url.pathname === '/chat') return await chat(request, env, ctx);
      if (request.method === 'POST' && url.pathname === '/image') return await image(request, env, ctx);
      if (request.method === 'POST' && url.pathname === '/transcribe') return await transcribe(request, env, ctx);
      if (url.pathname === '/speak') return await speak(request, env, ctx);
      if (request.method === 'POST' && url.pathname === '/e') return await ingest(request, env);
      if (request.method === 'POST' && url.pathname === '/f') return await feedback(request, env);
      if (request.method === 'POST' && url.pathname === '/care') { const h = allowedOrigin(request, env); if (!h) return new Response('forbidden', { status: 403 }); if (env.DB) { await ensureSchema(env.DB); countCare(env, ctx); } return new Response(null, { status: 204, headers: h }); }
      if (url.pathname.startsWith('/auth/')) return await auth(request, env, url.pathname);
      if (url.pathname.startsWith('/room')) return await room(request, env, url);
      if (url.pathname.startsWith('/push/')) return await push(request, env, url);
      if (url.pathname.startsWith('/scores/')) return await scores(request, env, url);
      if (request.method === 'GET' && url.pathname === '/stats') return await stats(request, env);
      if (request.method === 'GET' && url.pathname === '/health') return await health(request, env);
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard')) return dashboard();
      return new Response('not found', { status: 404 });
    } catch (e) {
      // where it broke, not what it said: an error's message can quote the request (a bad JSON body, say)
      const where = String(e && e.stack || '').split('\n').filter((l) => /^\s*at /.test(l)).slice(0, 6).join('\n');
      ctx.waitUntil(logProblem(env, 'server: ' + url.pathname.slice(0, 30), `${(e && e.name) || 'Error'}\n${where}`.slice(0, 600)).catch(() => {}));
      return json({ error: 'Something went wrong on Cassie’s server. Please try again.' }, 500, cors(request.headers.get('origin') || '', env));
    }
  },
};

/* ------------------------------------------------------------------ dashboard */
const DASHBOARD = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cassie Usage</title>
<style>
  :root {
    color-scheme: light;
    --page: #f4f3f1; --surface-1: #fcfcfb; --border: #e6e4df;
    --text-primary: #0b0b0b; --text-secondary: #52514e; --text-muted: #8a8984;
    --grid: #ecebe7; --axis: #c9c7c1;
    --series-1: #2a78d6; --series-2: #eb6834;
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) {
      color-scheme: dark;
      --page: #111110; --surface-1: #1a1a19; --border: #2c2c2a;
      --text-primary: #ffffff; --text-secondary: #c3c2b7; --text-muted: #8f8e86;
      --grid: #262624; --axis: #4a4945;
      --series-1: #3987e5; --series-2: #d95926;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --page: #111110; --surface-1: #1a1a19; --border: #2c2c2a;
    --text-primary: #ffffff; --text-secondary: #c3c2b7; --text-muted: #8f8e86;
    --grid: #262624; --axis: #4a4945;
    --series-1: #3987e5; --series-2: #d95926;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--page); color: var(--text-primary); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 20px 16px 48px; }
  header { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 18px; }
  header h1 { margin: 0; font-size: 22px; letter-spacing: -.02em; }
  .big { margin: 6px 0 0; font-size: 34px; font-weight: 700; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
  header .sp { flex: 1; }
  select, button, input { font: inherit; color: var(--text-primary); background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px; padding: 8px 12px; }
  button { cursor: pointer; font-weight: 600; }
  .muted { color: var(--text-muted); }
  .grid { display: grid; gap: 14px; }
  .kpis { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); margin-bottom: 14px; }
  .tile, .card { background: var(--surface-1); border: 1px solid var(--border); border-radius: 16px; padding: 16px; min-width: 0; }
  .tile .k { font-size: 13px; color: var(--text-secondary); }
  .tile .v { font-size: 30px; font-weight: 750; letter-spacing: -.03em; margin-top: 2px; }
  .tile .s { font-size: 12.5px; color: var(--text-muted); }
  .two { grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); margin-bottom: 14px; }
  .card h2 { margin: 0 0 2px; font-size: 16px; }
  .card .sub { margin: 0 0 12px; font-size: 13px; color: var(--text-muted); }
  .legend { display: flex; gap: 16px; font-size: 13px; color: var(--text-secondary); margin-bottom: 6px; }
  .legend i { display: inline-block; width: 14px; height: 3px; border-radius: 2px; vertical-align: middle; margin-right: 6px; }
  svg { display: block; width: 100%; height: auto; overflow: visible; }
  .bars { display: flex; flex-direction: column; gap: 6px; }
  .bar { display: grid; grid-template-columns: minmax(90px, 38%) 1fr auto; align-items: center; gap: 10px; font-size: 13.5px; }
  .bar .lbl { color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar .trk { height: 14px; position: relative; }
  .bar .fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--series-1); border-radius: 0 4px 4px 0; min-width: 2px; }
  .bar .val { color: var(--text-primary); font-variant-numeric: tabular-nums; font-weight: 600; }
  .bar:hover .fill { filter: brightness(1.12); }
  .reports { display: flex; flex-direction: column; gap: 10px; max-height: 520px; overflow: auto; }
  .rep { border: 1px solid var(--grid); border-radius: 10px; padding: 10px 12px; font-size: 14px; }
  .rep .meta { color: var(--text-secondary); font-size: 12.5px; margin-bottom: 4px; }
  .rep .txt { white-space: pre-wrap; overflow-wrap: anywhere; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--border); white-space: nowrap; }
  th { color: var(--text-secondary); font-weight: 600; }
  .scroll { overflow-x: auto; }
  td.detail { white-space: normal; word-break: break-word; min-width: 260px; } /* the whole message, wrapped */
  details summary { cursor: pointer; color: var(--text-secondary); font-size: 13px; margin-top: 10px; }
  #tip { position: fixed; pointer-events: none; background: var(--surface-1); color: var(--text-primary); border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; font-size: 13px; box-shadow: 0 8px 24px rgba(0,0,0,.18); display: none; z-index: 9; }
  #tip b { display: block; margin-bottom: 2px; }
  .gate { max-width: 420px; margin: 12vh auto; }
  .gate .card { display: flex; flex-direction: column; gap: 10px; }
  .err { color: #d03b3b; font-size: 13px; }
  .empty { color: var(--text-muted); font-size: 13.5px; padding: 18px 0; text-align: center; }
</style></head>
<body>
<div id="tip"></div>
<div class="wrap" id="app"></div>
<script>
(() => {
  const app = document.getElementById('app'), tip = document.getElementById('tip');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => (n == null ? '-' : Number(n).toLocaleString());
  let token = ''; try { token = localStorage.getItem('cassie.stats.token') || ''; } catch (e) {}
  let days = 30;

  const FEATURE_NAMES = {
    chat: 'Chat', hint: 'Hint', quiz: 'Quiz me', talk: 'Talk', photo: 'Read a photo', research: 'Research', web: 'Web',
    image: 'Generate an image', graph: 'Graph on the board', board: 'Open the board', timer: 'Focus timer',
    'voice-in': 'Ask by voice', 'voice-out': 'Read answers aloud', colour: 'Change colour',
    'mode:pro': 'Switch to Professional', 'mode:student': 'Switch to Student',
    'highlight:explain': 'Highlight → Explain', 'highlight:answer': 'Highlight → Answer', 'highlight:code': 'Highlight → Code',
    'save:docx': 'Save as Word', 'save:pdf': 'Save as PDF', 'save:png': 'Save as image', 'save:txt': 'Save as text',
    'island-drop': 'Drop on Cassie', popout: 'Pop Cassie out', explore: 'Explore 3D', voice: 'Talk with Cassie (voice)',
    'file:pdf': 'Read a PDF', 'file:pptx': 'Read PowerPoint', 'file:docx': 'Read a Word file', 'file:text': 'Read a text file', 'file:image': 'Read an image file',
  };
  const fname = (n) => FEATURE_NAMES[n] || n;

  function gate(msg) {
    app.innerHTML = \`<div class="gate"><div class="card"><h2>Cassie usage</h2><p class="muted" style="margin:0">Enter the ADMIN_TOKEN you set on the Worker.</p>
      <input id="tok" type="password" placeholder="Admin token" autocomplete="current-password"><button id="go">Open dashboard</button>\${msg ? \`<div class="err">\${esc(msg)}</div>\` : ''}</div></div>\`;
    const go = () => { token = document.getElementById('tok').value.trim(); try { localStorage.setItem('cassie.stats.token', token); } catch (e) {} load(); };
    document.getElementById('go').onclick = go;
    document.getElementById('tok').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  }

  async function load() {
    if (!token) return gate('');
    app.innerHTML = '<p class="muted">Loading…</p>';
    let r;
    try { r = await fetch('stats?days=' + days, { headers: { authorization: 'Bearer ' + token } }); } catch (e) { return gate('Could not reach the Worker.'); }
    if (r.status === 401) return gate('That token is wrong.');
    const d = await r.json();
    if (d.error) return gate(d.error);
    render(d);
  }

  function tile(k, v, s) { return \`<div class="tile"><div class="k">\${k}</div><div class="v">\${v}</div>\${s ? \`<div class="s">\${s}</div>\` : ''}</div>\`; }
  function bars(rows, label, value, extra, o = {}) {
    if (!rows.length) return '<div class="empty">No data yet</div>';
    const max = o.max || Math.max(...rows.map(value), 1);
    return \`<div class="bars">\${rows.map((r) => \`<div class="bar" data-tip="\${esc(label(r))}|\${esc(extra ? extra(r) : fmt(value(r)))}"><span class="lbl">\${esc(label(r))}</span><span class="trk"><span class="fill" style="width:\${(value(r) / max * 100).toFixed(1)}%"></span></span><span class="val">\${fmt(value(r))}\${o.suffix || ''}</span></div>\`).join('')}</div>\`;
  }
  // every day in the range, zero-filled
  function series(d) {
    const map = Object.fromEntries(d.daily.map((x) => [x.day, x]));
    const nmap = Object.fromEntries(d.newDaily.map((x) => [x.day, x.n]));
    const out = [];
    const end = new Date(d.today + 'T00:00:00Z');
    for (let i = d.days - 1; i >= 0; i--) {
      const day = new Date(end - i * 864e5).toISOString().slice(0, 10);
      const x = map[day] || {};
      out.push({ day, active: x.active || 0, opens: x.opens || 0, uses: x.uses || 0, fresh: nmap[day] || 0 });
    }
    return out;
  }
  function lineChart(rows) {
    const W = 640, H = 240, L = 36, R = 64, T = 12, B = 26;
    const max = Math.max(1, ...rows.map((r) => Math.max(r.active, r.opens)));
    const step = Math.pow(10, Math.floor(Math.log10(max))) * (max / Math.pow(10, Math.floor(Math.log10(max))) > 5 ? 2 : 1);
    const top = Math.ceil(max / step) * step || 1;
    const X = (i) => L + (rows.length < 2 ? 0 : i / (rows.length - 1)) * (W - L - R);
    const Y = (v) => T + (1 - v / top) * (H - T - B);
    const ticks = []; for (let v = 0; v <= top; v += step) ticks.push(v);
    const path = (k) => rows.map((r, i) => \`\${i ? 'L' : 'M'}\${X(i).toFixed(1)} \${Y(r[k]).toFixed(1)}\`).join('');
    const every = Math.max(1, Math.ceil(rows.length / 7));
    const last = rows[rows.length - 1];
    return \`<svg viewBox="0 0 \${W} \${H}" role="img" aria-label="Active users and opens per day" id="lc">
      \${ticks.map((v) => \`<line x1="\${L}" x2="\${W - R}" y1="\${Y(v)}" y2="\${Y(v)}" stroke="var(--grid)"/><text x="\${L - 6}" y="\${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--text-muted)">\${v}</text>\`).join('')}
      <line x1="\${L}" x2="\${W - R}" y1="\${Y(0)}" y2="\${Y(0)}" stroke="var(--axis)"/>
      \${rows.map((r, i) => (i % every === 0 || i === rows.length - 1) ? \`<text x="\${X(i)}" y="\${H - 6}" text-anchor="middle" font-size="11" fill="var(--text-muted)">\${r.day.slice(5)}</text>\` : '').join('')}
      <path d="\${path('opens')}" fill="none" stroke="var(--series-2)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <path d="\${path('active')}" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <text x="\${X(rows.length - 1) + 8}" y="\${Y(last.opens) + 4}" font-size="12" fill="var(--text-secondary)">Opens</text>
      <text x="\${X(rows.length - 1) + 8}" y="\${Y(last.active) + (Math.abs(Y(last.active) - Y(last.opens)) < 14 ? 16 : 4)}" font-size="12" fill="var(--text-secondary)">Active</text>
      <line id="xh" y1="\${T}" y2="\${H - B}" stroke="var(--axis)" stroke-dasharray="3 3" visibility="hidden"/>
      <circle id="d1" r="5" fill="var(--series-1)" stroke="var(--surface-1)" stroke-width="2" visibility="hidden"/>
      <circle id="d2" r="5" fill="var(--series-2)" stroke="var(--surface-1)" stroke-width="2" visibility="hidden"/>
      <rect x="\${L}" y="\${T}" width="\${W - L - R}" height="\${H - T - B}" fill="transparent" id="hit"/>
    </svg>\`;
  }
  function wireLine(rows) {
    const svg = document.getElementById('lc'); if (!svg) return;
    const W = 640, L = 36, R = 64, T = 12, B = 26, H = 240;
    const max = Math.max(1, ...rows.map((r) => Math.max(r.active, r.opens)));
    const step = Math.pow(10, Math.floor(Math.log10(max))) * (max / Math.pow(10, Math.floor(Math.log10(max))) > 5 ? 2 : 1);
    const top = Math.ceil(max / step) * step || 1;
    const X = (i) => L + (rows.length < 2 ? 0 : i / (rows.length - 1)) * (W - L - R);
    const Y = (v) => T + (1 - v / top) * (H - T - B);
    const hit = svg.querySelector('#hit'), xh = svg.querySelector('#xh'), d1 = svg.querySelector('#d1'), d2 = svg.querySelector('#d2');
    hit.addEventListener('mousemove', (e) => {
      const b = svg.getBoundingClientRect(); const px = (e.clientX - b.left) / b.width * W;
      const i = Math.max(0, Math.min(rows.length - 1, Math.round((px - L) / (W - L - R) * (rows.length - 1)))); const r = rows[i];
      [xh].forEach((n) => { n.setAttribute('x1', X(i)); n.setAttribute('x2', X(i)); n.setAttribute('visibility', 'visible'); });
      d1.setAttribute('cx', X(i)); d1.setAttribute('cy', Y(r.active)); d1.setAttribute('visibility', 'visible');
      d2.setAttribute('cx', X(i)); d2.setAttribute('cy', Y(r.opens)); d2.setAttribute('visibility', 'visible');
      showTip(e, \`<b>\${r.day}</b>Active users: \${fmt(r.active)}<br>Opens: \${fmt(r.opens)}<br>Features used: \${fmt(r.uses)}<br>New users: \${fmt(r.fresh)}\`);
    });
    hit.addEventListener('mouseleave', () => { [xh, d1, d2].forEach((n) => n.setAttribute('visibility', 'hidden')); hideTip(); });
  }
  function colChart(rows) {
    const W = 640, H = 150, L = 30, R = 8, T = 10, B = 24;
    const max = Math.max(1, ...rows.map((r) => r.fresh));
    const bw = (W - L - R) / rows.length;
    const every = Math.max(1, Math.ceil(rows.length / 7));
    const Y = (v) => T + (1 - v / max) * (H - T - B);
    return \`<svg viewBox="0 0 \${W} \${H}" role="img" aria-label="New users per day">
      <line x1="\${L}" x2="\${W - R}" y1="\${Y(0)}" y2="\${Y(0)}" stroke="var(--axis)"/>
      <text x="\${L - 6}" y="\${Y(max) + 4}" text-anchor="end" font-size="11" fill="var(--text-muted)">\${max}</text>
      \${rows.map((r, i) => { const h = Y(0) - Y(r.fresh); const x = L + i * bw + 1; const w = Math.max(1, bw - 2);
        return \`<g class="col" data-tip="\${esc(r.day)}|\${r.fresh} new user\${r.fresh === 1 ? '' : 's'}"><rect x="\${x}" y="\${T}" width="\${w}" height="\${H - T - B}" fill="transparent"/>\${r.fresh ? \`<path d="M\${x} \${Y(0)}V\${Y(r.fresh) + Math.min(4, h)}q0 -\${Math.min(4, h)} \${Math.min(4, w / 2)} -\${Math.min(4, h)}H\${x + w - Math.min(4, w / 2)}q\${Math.min(4, w / 2)} 0 \${Math.min(4, w / 2)} \${Math.min(4, h)}V\${Y(0)}Z" fill="var(--series-1)"/>\` : ''}</g>\`; }).join('')}
      \${rows.map((r, i) => (i % every === 0 || i === rows.length - 1) ? \`<text x="\${L + (i + 0.5) * bw}" y="\${H - 6}" text-anchor="middle" font-size="11" fill="var(--text-muted)">\${r.day.slice(5)}</text>\` : '').join('')}
    </svg>\`;
  }
  function showTip(e, html) { tip.innerHTML = html; tip.style.display = 'block'; const x = Math.min(window.innerWidth - tip.offsetWidth - 8, e.clientX + 14); tip.style.left = x + 'px'; tip.style.top = (e.clientY + 14) + 'px'; }
  function hideTip() { tip.style.display = 'none'; }

  // The brain check: real questions with known answers through every AI the server uses.
  function brainCard(d) {
    const h = d.health;
    const rows = h ? h.checks.map((c) => \`<tr><td>\${c.ok ? '✅' : c.warn ? '⚠️' : '❌'}</td><td>\${esc(c.name)}</td><td>\${(c.ms / 1000).toFixed(1)}s</td><td class="muted detail">\${esc(c.detail || '')}</td></tr>\`).join('') : '';
    const status = !h ? 'Not run yet.' : h.ok ? '✅ Text and pictures both work.' : \`⚠️ \${!h.canText ? 'Text answers are failing. ' : ''}\${!h.canPictures ? 'Pictures (photos, snips, board) are failing. ' : ''}See the ❌ rows.\`;
    const probs = (d.problems || []).length ? \`<p class="muted" style="margin:12px 0 4px">Problems Cassie hit (last \${d.days} days)</p>\${bars(d.problems, (r) => r.k, (r) => r.n, (r) => \`\${fmt(r.n)} · last \${esc(new Date(r.last).toLocaleString())}\`)}\` : '<p class="muted" style="margin-top:10px">No problems logged.</p>';
    return \`<div class="card" style="margin-bottom:14px"><h2>Brain check</h2><p class="sub">Asks every AI real questions with known answers (17 × 23, a picture of 7 × 8, a graph). \${h ? 'Last run ' + esc(new Date(h.ts).toLocaleString()) : ''}</p>
      <p><b>\${status}</b></p>\${rows ? \`<div class="scroll"><table>\${rows}</table></div>\` : ''}
      <button id="brain">Run brain check now</button> <span id="brain-msg" class="muted"></span>\${probs}</div>\`;
  }
  function render(d) {
    const rows = series(d);
    const t = d.totals || {};
    const avg = t.users ? (t.opens / t.users) : 0;
    app.innerHTML = \`
      <header><h1>Cassie usage</h1><span class="muted">Philippine time · \${esc(d.since)} → \${esc(d.today)}</span><span class="sp"></span>
        <select id="range">\${[7, 30, 90, 365].map((n) => \`<option value="\${n}" \${n === d.days ? 'selected' : ''}>Last \${n} days</option>\`).join('')}</select>
        <button id="refresh">Refresh</button><button id="logout" title="Forget the token on this device">Sign out</button></header>
      <div class="grid kpis">
        \${tile('Total users', fmt(t.users), \`\${fmt(t.came_back)} came back on another day\`)}
        \${tile('Active today', fmt(d.today_ && d.today_.active), \`\${fmt(d.today_ && d.today_.opens)} opens today\`)}
        \${tile('Active this week', fmt(d.week && d.week.active), 'last 7 days')}
        \${tile('Opens', fmt(d.range && d.range.opens), \`last \${d.days} days\`)}
        \${tile('Opens per user', avg.toFixed(1), 'average, all time')}
        \${tile('Features used', fmt(d.range && d.range.uses), \`last \${d.days} days\`)}
      </div>
      \${brainCard(d)}
      <div class="card" style="margin-bottom:14px"><h2>Plans</h2><p class="sub">Give an account Plus or Pro (or take it back). They sign in to Cassie with that email, then reopen the app. Give yourself Pro to try every Plus extra.</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
          <input id="plan-email" type="email" placeholder="Their Cassie email" autocomplete="off" style="flex:1 1 220px">
          <select id="plan-kind"><option value="pro">Pro</option><option value="plus">Plus</option><option value="free">Free (end it)</option></select>
          <select id="plan-days">\${[[30, '30 days'], [365, '1 year'], [3660, '10 years']].map(([n, t]) => \`<option value="\${n}">\${t}</option>\`).join('')}</select>
          <button id="plan-give">Save</button><button id="plan-look">Look up</button>
        </div><p id="plan-msg" class="muted" style="margin:10px 0 0"></p></div>
      <div class="card" style="margin-bottom:14px"><h2>Active users and opens per day</h2><p class="sub">How many people used Cassie each day, and how many times the app was opened</p>
        <div class="legend"><span><i style="background:var(--series-1)"></i>Active users</span><span><i style="background:var(--series-2)"></i>Opens</span></div>
        \${lineChart(rows)}
        <details><summary>Show as a table</summary><div class="scroll"><table><tr><th>Day</th><th>Active users</th><th>Opens</th><th>Features used</th><th>New users</th></tr>\${rows.slice().reverse().map((r) => \`<tr><td>\${r.day}</td><td>\${r.active}</td><td>\${r.opens}</td><td>\${r.uses}</td><td>\${r.fresh}</td></tr>\`).join('')}</table></div></details>
      </div>
      <div class="grid two">
        <div class="card"><h2>New users per day</h2><p class="sub">First time someone opened Cassie</p>\${colChart(rows)}</div>
        <div class="card"><h2>Most-used features</h2><p class="sub">Times used in the last \${d.days} days (people in brackets)</p>\${bars(d.features.slice(0, 14), (r) => fname(r.name), (r) => r.n, (r) => \`\${fmt(r.n)} uses · \${fmt(r.users)} \${r.users === 1 ? 'person' : 'people'}\`)}</div>
      </div>
      <div class="grid two">
        <div class="card"><h2>Top topic words</h2><p class="sub">Single keywords from adults who allowed it. Never full messages</p>\${bars(d.words.slice(0, 20), (r) => r.word, (r) => r.n)}</div>
        <div class="card"><h2>Who uses Cassie</h2><p class="sub">From the sign-up (all users)</p>
          <p class="muted" style="margin:4px 0">Student or professional</p>\${bars(d.roles, (r) => r.k === 'pro' ? 'Professional' : r.k === 'student' ? 'Student' : r.k, (r) => r.n)}
          <p class="muted" style="margin:12px 0 4px">Students by level</p>\${bars(d.grades, (r) => r.k, (r) => r.n)}
          <p class="muted" style="margin:12px 0 4px">Age</p>\${bars(d.ages, (r) => r.k, (r) => r.n)}
          <p class="muted" style="margin:12px 0 4px">Device</p>\${bars(d.platforms, (r) => r.k, (r) => r.n)}
        </div>
      </div>
      <div class="grid two">
        <div class="card"><h2>Care shown</h2><p class="sub">Times a student said they want to hurt or kill themselves and Cassie answered with care and the crisis lines, last \${d.days} days. Counted with nothing else: no words, no id.</p><p class="big">\${((d.chats || []).find((r) => r.src === 'care') || { n: 0 }).n}</p></div>
        <div class="card"><h2>Questions answered through your server</h2><p class="sub">People without their own key, last \${d.days} days</p>\${bars((d.chats || []).filter((r) => r.src !== 'care'), (r) => ({ claude: 'Claude', gemini: 'Gemini (your key)', 'shortcut-gemini': 'iPhone Shortcut (Gemini)', shortcut: 'iPhone Shortcut', 'shortcut-claude': 'iPhone Shortcut (Claude)', groq: 'Groq', backup: 'Workers AI (backup)', 'backup-picture': 'Pictures (Workers AI backup)', failed: 'Could not answer', voice: 'Voice chat: speech to text (Groq)', 'voice-backup': 'Voice chat: speech to text (Workers AI)', image: 'Pictures (Workers AI)', 'gemini-picture': 'Pictures (Gemini)', 'gemini-picture-photo': 'Answer pictures from a photo (Gemini)' }[r.src] || r.src), (r) => r.n)}</div>
        <div class="card"><h2>Problem reports</h2><p class="sub">What users wrote in “Report a problem”</p>
          \${(d.reports || []).length ? \`<div class="reports">\${d.reports.map((r) => \`<div class="rep"><div class="meta">\${esc(new Date(r.ts).toLocaleString())} · \${r.kind === 'report' ? 'Report' : r.kind === 'down' ? '👎 ' + esc(fname(r.feature)) : r.kind === 'error' ? '⚠️ ' + esc(r.feature || 'Server problem') : r.kind === 'auto' ? '⚠️ App error · ' + esc(fname(r.feature)) : esc(r.kind)}\${r.ctx ? ' · ' + esc(r.ctx) : ''}</div><div class="txt">\${esc(r.text)}</div></div>\`).join('')}</div>\` : '<div class="empty">No reports yet</div>'}</div>
      </div>
      <div class="card"><h2>Most active users</h2><p class="sub">Anonymous: a random id per device, never a name</p><div class="scroll"><table>
        <tr><th>User</th><th>Opens</th><th>Features used</th><th>First seen</th><th>Last seen</th><th>Who</th></tr>
        \${d.top.length ? d.top.map((u) => \`<tr><td>#\${esc(u.id)}</td><td>\${fmt(u.opens)}</td><td>\${fmt(u.uses)}</td><td>\${esc(u.first_day)}</td><td>\${esc(u.last_day)}</td><td>\${esc([u.role === 'pro' ? 'Professional' : u.role === 'student' ? 'Student' : '', u.grade, u.age].filter(Boolean).join(' · '))}</td></tr>\`).join('') : '<tr><td colspan="6" class="empty">No users yet</td></tr>'}
      </table></div></div>\`;
    document.getElementById('range').onchange = (e) => { days = +e.target.value; load(); };
    document.getElementById('refresh').onclick = load;
    document.getElementById('brain').onclick = async () => {
      const m = document.getElementById('brain-msg'); m.textContent = 'Checking every AI… (about 10 to 45 seconds)';
      try { const r = await fetch('health', { headers: { authorization: 'Bearer ' + token } }); if (!r.ok) throw new Error('HTTP ' + r.status); load(); }
      catch (e) { m.textContent = 'Could not run it: ' + e.message; }
    };
    const planCall = async (give) => {
      const m = document.getElementById('plan-msg'), email = document.getElementById('plan-email').value.trim();
      if (!email) { m.textContent = 'Type the email they signed up to Cassie with.'; return; }
      m.textContent = give ? 'Saving…' : 'Looking…';
      try {
        const r = give
          ? await fetch('admin/plan', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ email, plan: document.getElementById('plan-kind').value, days: +document.getElementById('plan-days').value }) })
          : await fetch('admin/plan?email=' + encodeURIComponent(email), { headers: { authorization: 'Bearer ' + token } });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
        const name = j.name ? j.name + ' (' + j.email + ')' : j.email;
        m.textContent = j.plan === 'free' ? \`\${name} is on Free.\` : \`\${name} has \${j.plan === 'pro' ? 'Pro' : 'Plus'} until \${new Date(j.until).toLocaleDateString()}.\`;
      } catch (e) { m.textContent = 'Couldn’t do it: ' + e.message; }
    };
    document.getElementById('plan-give').onclick = () => planCall(true);
    document.getElementById('plan-look').onclick = () => planCall(false);
    document.getElementById('logout').onclick = () => { try { localStorage.removeItem('cassie.stats.token'); } catch (e) {} token = ''; gate(''); };
    wireLine(rows);
    app.querySelectorAll('[data-tip]').forEach((n) => {
      // dataset gives the text back un-escaped, so it is escaped again before it becomes HTML
      n.addEventListener('mousemove', (e) => { const t = n.dataset.tip, i = t.lastIndexOf('|'); showTip(e, \`<b>\${esc(t.slice(0, i))}</b>\${esc(t.slice(i + 1))}\`); });
      n.addEventListener('mouseleave', hideTip);
    });
  }
  load();
})();
</script>
</body></html>
`;
