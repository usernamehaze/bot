/* Every message Cassie shows when something goes wrong lives here, and one helper shows them.
   Each message says what happened, why, and what to do next, in words a Grade 4 student knows.
   No error codes or computer words ever reach the screen.
     CassieErrors.say(key, vars)      → the words for one message ({n} in a message is filled from vars)
     CassieErrors.explain(err, key)   → the words for something that failed: the server's code, no
                                        internet, too slow, too busy… (key: what to say if nothing fits)
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
    too_many_tries: 'There were too many tries, so signing in is paused to keep accounts safe. Wait an hour, then try again.',
    signed_out: 'You’ve been signed out, so Cassie can’t save to your account. Sign in again to keep going.',
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
  };

  const say = (key, vars = {}) => String(STRINGS[key] || STRINGS.unknown).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

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

  window.CassieErrors = { STRINGS, say, explain, form };
})();
