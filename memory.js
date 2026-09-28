/* Cassie's memory — privacy-first, on-device.
 *
 * Everything here lives in the student's own browser (localStorage). There is
 * no account and no server: Cassie remembers what you study, notices what you
 * struggle with, schedules spaced-repetition reviews, keeps a study streak, and
 * feeds a short summary into her answers so they feel personal.
 *
 * app.js talks to this through window.CassieMemory (all calls are optional and
 * guarded, so the app works fine even if this file fails to load).
 */
(function () {
  'use strict';
  const KEY = 'cassie.mem.v1';
  const DAY = 86400000;

  const STOP = new Set(('a an the of to in on for and or but with about into from as at by is are was were be been being this that these those it its i you he she they we me my your our their his her them us do does did done can could should would will just please help explain what why how when where who which whose solve answer give tell show find work out step steps using use make made get got need want know understand understood simpler simply again mean means example examples problem question questions').split(/\s+/));

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function blank() {
    return { v: 1, profile: { name: '', goal: '' }, topics: {}, facts: [], streak: { count: 0, lastDay: '' }, focusMinutes: 0 };
  }

  let data = blank();
  let current = null; // topic of the message being handled right now

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        data = Object.assign(blank(), parsed);
        data.profile = Object.assign({ name: '', goal: '' }, parsed.profile || {});
        data.topics = parsed.topics || {};
        data.facts = parsed.facts || [];
        data.streak = Object.assign({ count: 0, lastDay: '' }, parsed.streak || {});
        data.focusMinutes = parsed.focusMinutes || 0;
      }
    } catch (e) { data = blank(); }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* quota */ }
  }

  // --- topic extraction: a short, human label from a question ---
  function normTopic(text) {
    if (!text) return null;
    let t = String(text).toLowerCase();
    // drop attached-doc markers / code
    t = t.replace(/```[\s\S]*?```/g, ' ').replace(/\(attached:[^)]*\)/g, ' ');
    t = t.replace(/[^a-z0-9\s+\-]/g, ' ');
    const words = t.split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
    if (!words.length) return null;
    // keep the first 3 meaningful words, in order (reads like a topic)
    const label = words.slice(0, 3).join(' ');
    return label.length > 40 ? label.slice(0, 40) : label;
  }

  function ensureTopic(name) {
    if (!data.topics[name]) {
      data.topics[name] = { seen: 0, correct: 0, wrong: 0, first: Date.now(), last: Date.now(), ease: 2.3, interval: 1, reps: 0, due: Date.now() + DAY };
    }
    return data.topics[name];
  }

  function bumpStreak() {
    const today = todayStr();
    if (data.streak.lastDay === today) return;
    const y = new Date(Date.now() - DAY);
    const yStr = y.getFullYear() + '-' + String(y.getMonth() + 1).padStart(2, '0') + '-' + String(y.getDate()).padStart(2, '0');
    data.streak.count = data.streak.lastDay === yStr ? (data.streak.count + 1) : 1;
    data.streak.lastDay = today;
  }

  // spaced repetition (SM-2 lite). quality: 'good' | 'again'
  function schedule(topic, quality) {
    topic.ease = topic.ease || 2.3;
    topic.reps = topic.reps || 0;
    topic.interval = topic.interval || 1;
    if (quality === 'again') {
      topic.reps = 0; topic.interval = 0; topic.ease = Math.max(1.3, topic.ease - 0.2);
    } else {
      topic.reps += 1;
      if (topic.reps === 1) topic.interval = 1;
      else if (topic.reps === 2) topic.interval = 3;
      else topic.interval = Math.round(topic.interval * topic.ease);
      topic.ease = Math.min(2.8, topic.ease + 0.05);
    }
    topic.due = Date.now() + topic.interval * DAY;
  }

  // --- public API ---
  const API = {
    get data() { return data; },

    recordQuestion(text) {
      bumpStreak();
      const name = normTopic(text);
      current = name;
      if (name) {
        const t = ensureTopic(name);
        t.seen += 1; t.last = Date.now();
      }
      save();
    },

    // Look at the exchange to update mastery: did they struggle, or nail it?
    scanExchange(userText, reply) {
      if (!current) { save(); return; }
      const t = ensureTopic(current);
      const struggled = /\b(simpler|simplify|i (don'?t|do not) (get|understand)|confus|i'?m lost|still lost|what do you mean|explain again|huh)\b/i.test(userText || '');
      const nailed = /\b(correct!|that'?s right|well done|exactly right|nailed it|spot on|you got it|great job|perfect!)\b/i.test(reply || '');
      if (struggled) { t.wrong += 1; schedule(t, 'again'); }
      else if (nailed) { t.correct += 1; schedule(t, 'good'); }
      save();
    },

    // Called by the Quiz flow / review when we know the outcome.
    markResult(topicName, correct) {
      const name = topicName || current;
      if (!name) return;
      const t = ensureTopic(name);
      if (correct) { t.correct += 1; schedule(t, 'good'); }
      else { t.wrong += 1; schedule(t, 'again'); }
      save();
    },

    dueTopics() {
      const now = Date.now();
      return Object.entries(data.topics)
        .filter(([, t]) => (t.due || 0) <= now)
        .sort((a, b) => (a[1].due || 0) - (b[1].due || 0))
        .map(([name, t]) => ({ name, ...t }));
    },
    weakTopics() {
      return Object.entries(data.topics)
        .filter(([, t]) => t.wrong > 0 && t.wrong >= t.correct)
        .sort((a, b) => (b[1].wrong - b[1].correct) - (a[1].wrong - a[1].correct))
        .map(([name, t]) => ({ name, ...t }));
    },
    recentTopics(n) {
      return Object.entries(data.topics)
        .sort((a, b) => (b[1].last || 0) - (a[1].last || 0))
        .slice(0, n || 6)
        .map(([name, t]) => ({ name, ...t }));
    },

    addFact(text) {
      const t = (text || '').trim();
      if (!t) return;
      data.facts.unshift({ text: t.slice(0, 140), at: Date.now() });
      data.facts = data.facts.slice(0, 40);
      save();
    },
    removeFact(i) { data.facts.splice(i, 1); save(); },
    setProfile(k, v) { data.profile[k] = (v || '').slice(0, 80); save(); },

    // Detect and store an explicit "remember ..." request from the user.
    maybeRememberFrom(text) {
      const m = /(?:^|\b)(?:remember|note|don'?t forget|keep in mind)\s*(?:that|this)?[:,]?\s+(.{3,140})/i.exec(text || '');
      if (m) { API.addFact(m[1].trim()); return m[1].trim(); }
      return null;
    },

    // Compact, token-cheap summary injected into the system prompt.
    summaryForPrompt() {
      const parts = [];
      if (data.profile.name) parts.push(`Name: ${data.profile.name}`);
      if (data.profile.goal) parts.push(`Goal: ${data.profile.goal}`);
      const recent = API.recentTopics(5).map((t) => t.name);
      if (recent.length) parts.push(`Recently studied: ${recent.join(', ')}`);
      const weak = API.weakTopics().slice(0, 4).map((t) => t.name);
      if (weak.length) parts.push(`Seems to struggle with: ${weak.join(', ')}`);
      const due = API.dueTopics().slice(0, 4).map((t) => t.name);
      if (due.length) parts.push(`Due for review: ${due.join(', ')}`);
      const facts = data.facts.slice(0, 5).map((f) => f.text);
      if (facts.length) parts.push(`Notes: ${facts.join('; ')}`);
      if (data.streak.count > 1) parts.push(`Study streak: ${data.streak.count} days`);
      if (!parts.length) return '';
      return (
        '\n\n[Memory of this student — use it to personalize your help; weave it in naturally and do NOT recite this list back verbatim]\n- ' +
        parts.join('\n- ')
      );
    },

    addFocusMinutes(n) {
      bumpStreak(); // a completed focus block counts as studying today
      data.focusMinutes = (data.focusMinutes || 0) + (Number(n) || 0);
      save();
    },
    masteredCount() {
      return Object.values(data.topics).filter((t) => t.correct > 0 && t.correct > t.wrong).length;
    },
    stats() {
      const topics = Object.keys(data.topics).length;
      return {
        topics,
        streak: data.streak.count,
        due: API.dueTopics().length,
        weak: API.weakTopics().length,
        mastered: API.masteredCount(),
        focusHours: Math.round(((data.focusMinutes || 0) / 60) * 10) / 10,
        focusMinutes: data.focusMinutes || 0,
      };
    },

    clearAll() { data = blank(); save(); },

    // Called by app.js so the panel's "Review" buttons can start a quiz.
    onReview: null,
  };

  load();
  window.CassieMemory = API;
})();
