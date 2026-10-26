/* Every message Cassie shows when something goes wrong lives here, and one helper shows them.
   Each message says what happened, why, and what to do next, in words a Grade 4 student knows.
   No error codes or computer words ever reach the screen.
     CassieErrors.say(key, vars)      → the words for one message ({n} in a message is filled from vars)
     CassieErrors.explain(err, key)   → the words for something that failed: the server's code, no
                                        internet, too slow, too busy… (key: what to say if nothing fits)
     CassieErrors.empty({ title, text, action, onAction }) → a friendly empty list with one next step
     CassieErrors.form(form, rules)   → checks each field as you type and shows the reason under it
                                        rules: { fieldName or selector: (value, form) => '' or a key or [key, vars] }
                                        → { check() → true when every field is fine, show(name, key), clear() } */
(function () {
  const STRINGS = {
    // the internet and Cassie's server
    offline: 'You’re offline, so Cassie can’t reach the internet. Connect to Wi-Fi or mobile data, then try again.',
    network: 'Cassie couldn’t connect. The internet may have dropped for a moment. Check your Wi-Fi or data, then try again.',
    timeout: 'That took too long, so Cassie stopped waiting. Try again in a moment.',
    busy: 'Cassie is very busy right now because lots of people are asking at once. Wait a minute, then try again.',
    unknown: 'Something didn’t work, and it isn’t your fault. Try again. If it keeps happening, tap “Report a problem” in Settings.',
    not_found: 'Cassie couldn’t find that. It may have been removed. Go back and try again.',
    too_big: 'That is too big to save. Make it shorter, then try again.',

    // accounts (the server sends these codes)
    email_taken: 'That email is already signed up. Try signing in instead.',
    email_bad: 'That doesn’t look like an email yet. It needs an @ and a dot, like name@gmail.com.',
    email_disposable: 'That looks like a throwaway email, and those can’t make accounts. Use the email you check every day.',
    wrong_password: 'That email and password don’t match. Check both for typos, then try again.',
    no_account: 'There’s no Cassie account with that email yet. Check the spelling, or tap “Sign up” to make one.',
    google_account: 'This account was made with Google, so it has no password. Tap “Continue with Google” instead.',
    google_failed: 'Google sign-in didn’t finish, so you aren’t signed in yet. Try again, or use your email and password.',
    apple_account: 'This account was made with Apple, so it has no password. Tap “Sign in with Apple” instead.',
    apple_failed: 'Apple sign-in didn’t finish, so you aren’t signed in yet. Try again, or use your email and password.',
    apple_cancelled: 'Apple sign-in was cancelled, so you aren’t signed in yet. Tap Try again to pick your account.',
    google_cancelled: 'Google sign-in was cancelled, so you aren’t signed in yet. Tap Try again to pick your account.',
    signin_mismatch: 'That sign-in didn’t come from this page, so Cassie didn’t use it to keep your account safe. Tap Try again.',
    link_wrong_password: 'That password doesn’t match this email’s Cassie account. Check it for typos, or tap “I don’t know this password”.',
    too_many_tries: 'There were too many tries, so signing in is paused to keep accounts safe. Wait an hour, then try again.',
    signed_out: 'You’ve been signed out, so Cassie can’t save to your account. Sign in again to carry on.',
    password_long: 'That password is too long. Use one with fewer than 200 letters and numbers.',
    bad_request: 'Cassie didn’t understand that request. Close this and try again.',
    nothing_to_save: 'There was nothing to save yet. Change something first, then save.',

    // fields, checked as you type
    need_email: 'Type your email so Cassie knows which account is yours.',
    need_password: 'Type your password to sign in.',
    password_short: 'Your password needs at least 8 letters or numbers so it’s hard to guess. Add {n} more.',
    need_age: 'Type your age so Cassie can explain things at your level.',
    age_range: 'Ages go from 2 to 100. Check the number you typed.',
    need_name: 'Type your name or a nickname so Cassie knows what to call you.',
    need_level: 'Choose your level so Cassie explains things the right way for you.',
    need_gender: 'Choose one so Cassie talks to you the right way, or pick “Prefer not to say”.',
    need_report: 'Tell us what went wrong in a few words, so we can fix it.',
    room_code: 'Room codes have 6 letters and numbers, like K7M2QX. Check the code your classmate shared.',
    card_front: 'Type the front of the card, like a question or a word.',
    card_back: 'Type the back of the card, like the answer.',
    groq_key: 'Groq keys start with “gsk_”, and this one doesn’t. Copy the whole key again from console.groq.com/keys.',
    gemini_key: 'Google keys start with “AIza” or “AQ.”, and this one doesn’t. Copy the whole key again from aistudio.google.com/apikey.',

    // sending things
    report_failed: 'Your report didn’t send because Cassie couldn’t reach the internet. Check your connection, then tap Send again.',
    room_unavailable: 'Study rooms can’t open right now because Cassie’s server isn’t answering. Try again in a moment.',
    room_gone: 'That room has ended, so it can’t be joined. Rooms last one day. Ask for a new code.',
    room_none: 'There’s no room with that code. Rooms last one day, so it may have ended. Check the code, or ask for a new one.',
    room_limit: 'You’ve made 10 rooms today, which is the most for one day. Use one of those, or make a new one tomorrow.',
    room_join_first: 'You aren’t in this room yet, so you can’t draw here. Join with the room code first.',
    room_full_board: 'This board is full, so nothing more fits. Save it, then start a new room.',

    // chat: Cassie's brains (Groq, Gemini) and what she reads
    groq_daily: 'You’ve used today’s free questions on this model, so it’s resting{when}. Switch to another model in Settings, because each one has its own daily limit.',
    groq_minute: 'That was a lot of questions in one minute, so Groq’s free plan asked Cassie to pause. Try again in {wait}.',
    groq_busy: 'Groq’s free plan is busy for a moment because lots of people are asking. Wait a few seconds, then try again.',
    groq_key_bad: 'Your Groq key isn’t working anymore, maybe because it was deleted. Open Settings and paste a new key from console.groq.com/keys.',
    groq_down: 'Groq, which powers Cassie’s answers, is having a problem right now. Try again in a minute.',
    no_answer: 'Cassie couldn’t answer just now because her brain didn’t reply. Try again in a moment.',
    message_too_long: 'That message is too long to send in one go, because the free plan has a size limit. Ask a shorter question, start a new chat, or attach it as a file with the paperclip.',
    unsafe: 'Cassie can’t help with that one because it goes against her safety rules. Try asking it a different way.',
    gemini_busy: 'Google’s Gemini is very busy right now because lots of people are using it. Try again in a minute.',
    gemini_key_bad: 'Google didn’t accept your Gemini key, so Cassie can’t use it. Check it in Settings. It should start with “AIza”.',
    gemini_key_refused: 'Google turned down your Gemini key for this, so Cassie can’t use it here. Make a new key at aistudio.google.com/apikey and paste it in Settings.',
    pictures_busy: 'Everyone who reads pictures for Cassie is busy right now, so she can’t read it yet. Try again in a minute.',
    scanned_file: 'Cassie couldn’t find words to read in {name}, because it looks like scanned pictures. Add your free Gemini key in Settings, and she’ll read the pages directly.',
    file_too_big: '{name} is too big for Cassie to read in one go right now. Wait a minute and try again, ask about one part (like “make a reviewer of pages 1 to 10”), or add your free Gemini key in Settings so she can read all of it.',
    nothing_readable: 'Cassie couldn’t find anything to read in {name}. It may be empty or only pictures. Try another file, or a photo of the page.',
    spreadsheet: 'Cassie can’t read spreadsheets yet. Save it as a PDF, then attach that.',
    file_kind: 'Cassie can’t open {name} because she doesn’t know that kind of file. She reads PDFs, PowerPoint, Word, text files and photos.',
    heic: 'That’s an iPhone HEIC photo, which this browser can’t open. Send a screenshot of it instead, or set iPhone Camera, Formats, Most Compatible.',
    photo_unreadable: 'Cassie couldn’t open {name} as a picture. The file may be damaged. Take a screenshot of it and attach that instead.',
    tab_file: 'Cassie couldn’t open the file from your browser tab because the browser blocked it. Download it, then attach it with the paperclip.',
    file_failed: 'Cassie couldn’t make the {label} file, maybe because the internet dropped. Check your connection, then tap the button again.',
    file_failed_saveas: 'Cassie couldn’t make that file here. Use “Save as” above to save it another way.',
    cards_failed: 'Cassie couldn’t make flashcards from that answer just now. Tap the button to try again.',
    picture_busy: 'The picture makers are busy right now because lots of people are making pictures. Wait a minute, then ask again.',
    picture_busy_free: 'The free picture maker is busy right now, so your picture didn’t come. Wait a minute and ask again, or describe it more simply. Everything else still works.',
    picture_failed: 'Cassie couldn’t make that picture, and it isn’t your fault. Try again, or describe it more simply.',
    picture_save_failed: 'Cassie couldn’t turn this answer into a picture just now. Use “Save as”, then “Image”, under her answer instead.',
    research_unreachable: 'Cassie couldn’t reach the research library, maybe because the internet dropped. Check your connection, then try again.',
    search_busy: 'Google’s free web search is busy right now, so Cassie can’t look it up. Wait a minute, then try again.',
    not_set_up: 'Cassie isn’t set up yet, so she can’t answer. Open Settings to connect her, then try again.',
    webgl: 'This browser can’t show 3D right now because its graphics are turned off. Try Chrome, or turn on “Use graphics acceleration” in its settings.',
    open_3d_failed: 'Cassie couldn’t open the 3D view, maybe because the internet dropped. Check your connection, then try again.',
    open_labs_failed: 'Cassie couldn’t open Labs, maybe because the internet dropped. Check your connection, then try again.',
    voice_unsupported: 'This browser can’t play Cassie’s voice, so she types her answers instead. Try Chrome, Edge or Safari.',
    voice_typing: 'Cassie’s voice isn’t available right now, so she’ll type her answers instead.',
    voice_resting: 'Cassie’s voice is resting until {date}. Until then she types her answers.',
    voice_today: 'You’ve listened to Cassie a lot today, so she’ll type her answers for now. Her voice is back tomorrow.',
    voice_signin: 'Cassie’s studio voice isn’t available for guests. Sign in (it’s free) to hear her.',
    voice_ext_account: 'Cassie’s studio voice is for signed-in Cassie accounts, so here she types her steps instead.',
    voice_mine: 'You’ve used this month’s studio voice, so Cassie types her answers. It comes back on {date}.',
    voice_not_set_up: 'Cassie’s voice isn’t switched on yet, so she types her answers.',
    mic_blocked: 'Cassie can’t hear you because the microphone is blocked for this site. Allow the microphone, then tap the mic.',
    not_heard: 'Cassie couldn’t hear that clearly. Try again, or type it.',
    cant_listen: 'This browser can’t listen here, so talking won’t work. Type your question instead.',
    no_mic_browser: 'This browser can’t use the microphone, so talking won’t work here. Try Chrome, Edge or Safari.',
    mic_here: 'Cassie can’t use the microphone here. Type it instead.',
    voice_no_answer: 'Sorry, Cassie couldn’t answer that just now. Can you say it again?',

    // Labs and the 3D views
    lab_ai_off: 'Cassie can’t help here right now because she isn’t connected. {next}',
    lab_ai_failed: 'Cassie couldn’t answer just now because her brain didn’t reply. {next}',
    lab_start_failed: 'This lab couldn’t start, and it isn’t your fault. Go back to all labs and open it again.',
    lab_3d_failed: 'The 3D view couldn’t load, maybe because the internet dropped. Check your connection, then open it again.',
    lab_map_failed: 'The map couldn’t load, maybe because the internet dropped. Check your connection, then open this again.',
    lab_board_saved_here: 'Solved in {time}! The score board didn’t get it because Cassie’s server didn’t answer, but your finish is kept on this device.',
    atlas_search_offline: 'Searching places needs the internet, and you seem to be offline. Countries still work, so try a country name.',
    atlas_page_failed: 'That page couldn’t load, maybe because the internet dropped. Try another result, or try again in a moment.',
    atlas_history_failed: 'The history couldn’t load, maybe because the internet dropped. Tap Ask Cassie to hear about it instead.',
    cards_no_lines: 'Cassie couldn’t find lines to make cards from. Each card needs a word and its meaning on one line, like “Osmosis: water moving across a membrane”.',
    formula_unreadable: 'Cassie can’t read that formula. Use x, numbers, + − × ÷ ^ and words like sin or sqrt, like 2x + 1.',
    pattern_unreadable: 'Cassie can’t read that pattern. Check that every ( and [ has a partner, then try again.',
    file_unreadable: 'Cassie couldn’t read that file. It may be a kind she doesn’t know. Try a PDF, Word, PowerPoint or text file.',
    tutor_no_brain: 'Cassie couldn’t reach her brain just now, maybe because the internet dropped. Check your connection, then ask again.',
    quiz_failed: 'Cassie couldn’t write a quiz just now because her brain didn’t reply. Try again in a moment.',

    // exam plans (Home)
    exam_plan_failed: 'Cassie couldn’t make your plan just now. Tap Try again.',
    exam_name_needed: 'Give your exam a name, like “Gen Chem finals”.',
    exam_date_needed: 'Pick the day of your exam.',
    exam_date_past: 'That day has already passed. Pick the day of your exam, today or later.',
    exam_date_far: 'That’s more than a year away. Pick a day in the next 12 months.',
    exam_topics_needed: 'Add at least one topic, or tap one you’ve been studying.',
    exam_file_failed: 'Cassie couldn’t read that file. Try a PDF, Word, PowerPoint or text file.',
    // Teach me and Ask Cassie on any web page (the browser extension)
    teach_failed: 'Cassie couldn’t make a lesson for this page just now. Tap Try again.',
    teach_ask_failed: 'Cassie couldn’t answer that just now. Try asking again.',
    teach_no_picture: 'Cassie couldn’t see this tab, so she can’t teach it. Take a screenshot (Win+Shift+S, or Cmd+Shift+4 on a Mac), then open the Board and press Ctrl+V.',
    teach_no_key: 'Cassie needs a free Groq or Gemini key to read your screen. Click the Cassie icon in the toolbar to add one.',
    teach_where_browser: 'This is one of the browser’s own pages, and browsers don’t let extensions draw on those. So Cassie teaches it here, on a picture of the tab.',
    teach_where_pdf: 'This PDF is open in the browser’s own PDF viewer, where extensions can’t draw. So Cassie teaches it here, on a picture of the tab.',
    teach_where_store: 'Extension stores don’t let extensions draw on their pages. So Cassie teaches it here, on a picture of the tab.',
    teach_where_page: 'This page doesn’t let Cassie draw on it. So she teaches it here, on a picture of the tab.',
  };

  const say = (key, vars = {}) => String(STRINGS[key] || STRINGS.unknown).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : '')).replace(/\s+$/, '');

  function explain(err, fallback = 'unknown') {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return say('offline');
    if (err && err.code && STRINGS[err.code]) return say(err.code, err.vars);
    if (err && err.key && STRINGS[err.key]) return say(err.key, err.vars);
    const m = String((err && err.message) || err || '');
    if (/failed to fetch|networkerror|load failed|network request failed|network error/i.test(m)) return say('network');
    if (/timeout|timed out|abort/i.test(m)) return say('timeout');
    if (err && err.friendly && m) return m; // already written for people (by Cassie or her server)
    if (err && err.status === 429) return say('busy');
    if (err && err.status === 401) return say('signed_out');
    return say(fallback);
  }

  // Inline checks: the reason shows under the field as you type (after a short pause, or when you
  // leave the field), and goes away as soon as it's fixed.
  let uid = 0;
  function form(f, rules) {
    const fields = {}, touched = new Set(), timers = {};
    for (const name of Object.keys(rules)) {
      const input = (f.elements && f.elements[name]) || f.querySelector(name); // a field's name, or a CSS selector outside a form
      if (!input) continue;
      const box = input.closest('label, .pf-field, .auth-field, .field') || input.parentElement;
      const p = document.createElement('p');
      p.className = 'field-err'; p.id = 'fe-' + (++uid); p.hidden = true; p.setAttribute('aria-live', 'polite');
      box.appendChild(p);
      input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), p.id].filter(Boolean).join(' '));
      fields[name] = { input, p };
      const run = () => { touched.add(name); check1(name); };
      input.addEventListener('input', () => {
        clearTimeout(timers[name]);
        if (touched.has(name)) check1(name); // already shown once: update right away
        else if (String(input.value || '').trim()) timers[name] = setTimeout(run, 800);
      });
      input.addEventListener('change', () => { if (touched.has(name) || input.tagName === 'SELECT') run(); });
      input.addEventListener('blur', () => { if (String(input.value || '').trim()) run(); });
    }
    function show(name, key, vars) {
      const fld = fields[name];
      if (!fld) return;
      const words = key ? say(key, vars) : '';
      fld.p.textContent = words; fld.p.hidden = !words;
      if (words) fld.input.setAttribute('aria-invalid', 'true'); else fld.input.removeAttribute('aria-invalid');
    }
    function check1(name) {
      const fld = fields[name];
      if (!fld || (fld.input.closest('[hidden]'))) { show(name, ''); return true; }
      let r = rules[name](fld.input.value, f);
      if (Array.isArray(r)) show(name, r[0], r[1]); else show(name, r || '');
      return !r;
    }
    return {
      check() {
        let first = null;
        for (const name of Object.keys(fields)) { touched.add(name); if (!check1(name) && !first) first = fields[name].input; }
        if (first) first.focus();
        return !first;
      },
      show(name, key, vars) { touched.add(name); show(name, key, vars); if (key && fields[name]) fields[name].input.focus(); },
      clear() { touched.clear(); for (const name of Object.keys(fields)) show(name, ''); },
    };
  }

  // An empty list or screen: what's (not) here, and one button for the next step.
  //   empty({ title, text, action, onAction }) → the element (put it where the list would be)
  function empty({ title, text = '', action = '', onAction } = {}) {
    const box = document.createElement('div');
    box.className = 'empty-state';
    box.innerHTML = '<div class="es-mark" aria-hidden="true"></div><p class="es-title"></p><p class="es-text"></p>';
    box.querySelector('.es-title').textContent = title || '';
    const t = box.querySelector('.es-text'); t.textContent = text; t.hidden = !text;
    if (action) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn btn-sm es-go'; b.textContent = action;
      if (onAction) b.addEventListener('click', onAction);
      box.appendChild(b);
    }
    return box;
  }

  window.CassieErrors = { STRINGS, say, explain, form, empty };
})();
