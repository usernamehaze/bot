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
