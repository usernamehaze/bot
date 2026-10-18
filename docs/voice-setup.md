# Cassie's voice: setup and costs

Cassie speaks only in Bella's studio voice (ElevenLabs, voice `EXAVITQu4vr4xnSDxMaL`, model `eleven_flash_v2_5`). Her server sends the words to ElevenLabs and plays back the sound. When a lesson, a Listen or a voice chat starts, the app asks the server how many characters are left this month. Bella speaks only if that covers the whole session. Otherwise Cassie types her answers and shows one line: "Cassie’s voice isn’t available right now, so she’ll type her answers instead." There is no other voice.

## What uses up characters (measured from the code)

One character is one letter, space or punctuation mark that Bella reads. A sentence Bella has already said is kept in Cloudflare's cache for 30 days, and saying it again costs nothing (`server/worker.src.js`, `speak`).

| What the student does | Where the limit is set in the code | Characters |
|---|---|---|
| One spoken answer in Talk with Cassie | `VOICE_INSTRUCTION` in `app.js`: "one to three sentences, about 60 words at most" | about 150 to 350 |
| Opening Talk with Cassie (her hello) | `VOICE_MODES` in `app.js` | about 40 |
| A voice chat, checked when it opens | `CHAT_CHARS` in `voice.js` | 1,200 needed to start |
| Listen on a typed chat answer | No length limit in the code. The long answer in the voice test is 12 sentences | about 700 (the test). Estimate: 600 to 1,500 for a full answer |
| One flashcard read aloud | `cards.js`: front "a short question or term", back "at most 30 words" | about 200 |
| A flashcard Listen session | `cards.js` reads up to 60 cards per deck | 10 cards: about 2,000. 60 cards: about 12,000 |
| A 7-step Teach me lesson (Labs, 3D, extension) | `labs/tutor.js` and `extension/teach.js`: each step is "one or two short, natural spoken sentences" | about 60 to 160 a step, so 420 to 1,120. Typical: about 700 |

Each student can also use at most `SPEAK_DAILY_CHARS` a day (default 3,000).

With today's default of 9,500 characters a month for the whole app, that is roughly 13 seven-step lessons, or 8 voice chats, or 4 ten-card flashcard sessions. That is for everyone together, not for each student.

## What a month of Bella costs

Checked on 18 October 2026. The ElevenLabs website could not be opened from this session, so these figures come from the sources below, not from elevenlabs.io itself. Check [elevenlabs.io/pricing](https://elevenlabs.io/pricing) and [elevenlabs.io/pricing/api](https://elevenlabs.io/pricing/api) before you pay.

| Plan | Price a month | Credits a month | Set SPEAK_MONTHLY_CHARS to |
|---|---|---|---|
| Free | $0 | 10,000 | 9,500 (today's default) |
| Starter | $6 | 30,000 | 28,500 |
| Creator | $22 (first month $11) | 121,000 | 115,000 |
| Pro | $99 | 600,000 | 570,000 |
| Scale | $299 | Not found | Not found |
| Business | $990 | Not found | Not found |

- One summary says Flash and Turbo models (Cassie uses Flash) cost 0.5 credits a character on these plans, which would double the characters. Other summaries say 0.5 to 1 credit. Until you see it on your own ElevenLabs usage page, count 1 credit per character. The numbers above already do, and keep 5% spare.
- Pay as you go on the API, without a plan: $0.05 per 1,000 characters for Flash ($0.10 for Multilingual), billed in US dollars, not credits. At that rate, 100,000 characters (about 140 seven-step lessons) cost about $5.

Sources:
- [ElevenLabs pricing 2026: plans, credits, and API (Cartesia)](https://www.cartesia.ai/learn/elevenlabs-pricing)
- [ElevenLabs Pricing: All Plans & Costs Explained (2026) (gradually.ai)](https://www.gradually.ai/en/elevenlabs-pricing/)
- [ElevenLabs Pricing 2026: Plans from $6 to $990 a Month (Layer3 Labs)](https://www.layer3labs.io/guides/elevenlabs-pricing)
- [ElevenLabs Pricing 2026: Plans, Credits, and Costs (Activepieces)](https://www.activepieces.com/blog/elevenlabs-pricing-2026-plans-credits-and-costs)
- [eleven_flash_v2_5 (LLM Reference)](https://www.llmreference.com/model/eleven-flash-v2-5)

## After you upgrade: raise the allowance in Cloudflare

1. Cloudflare dashboard, then Workers & Pages, then the Cassie worker, then Settings, then Variables and Secrets.
2. Add or edit the plain variable `SPEAK_MONTHLY_CHARS` (a variable, not a secret). Set it to the number in the table for your plan.
3. Optional: `SPEAK_DAILY_CHARS` is the most one student can use in a day (default 3,000). Raise it if one student's lesson or deck gets cut short.
4. Deploy. The app reads the new number the next time it asks the server (each page load, and each time a voice session starts).

The key stays where it is: `ELEVENLABS_API_KEY` is a Secret in the same place. Never put it in the code, the app or a chat.

The month starts again on the 1st (Philippine time). Settings, Voice and sound shows "Cassie’s voice is resting until 1 November" when it has run out.
