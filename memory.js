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

  // Sparks (XP): points for real study, a daily goal, and the streak counts a
  // day only when the goal is met. All on-device, synced with the account as
  // plain numbers (never what was studied).
  const SPARK = { ask: 10, card: 5, focus: 15, lesson: 20, quiz: 10, mock: 40 };
  const SPARK_CAP = { card: 100, quiz: 100 }; // most you can earn from one kind in a day
  const GOALS = [30, 50, 80, 120]; // Casual / Regular / Serious / Intense
  const DEFAULT_GOAL = 50;
  const FREEZE_EVERY = 5; // earn one freeze each 5 on-goal days

  function blankSparks() {
    return { today: 0, day: '', goal: DEFAULT_GOAL, goalSet: false, lifetime: 0, freezes: 2, onGoalDays: 0, byReason: {}, comeback: false };
  }
  // Awards (school medals): what each needs, kept as plain numbers. `got` is id -> the day it was earned.
  function blankAwards() {
    return { got: {}, quiz: '', lessons: 0, bestMock: 0, early: [], improved: false };
  }
  const QUIZ_WINDOW = 50; // Best in Quiz: 90% right across the last 50 quiz answers
  const AWARD_RULES = {
    hon: (a) => a.bestMock >= 85,
    hhon: (a) => a.bestMock >= 90,
    xhon: (a) => a.bestMock >= 95,
    att: () => data.streak.count >= 30 && data.streak.lastDay === todayStr(),
    quiz: (a) => a.quiz.length >= QUIZ_WINDOW && (a.quiz.match(/1/g) || []).length >= QUIZ_WINDOW * 0.9,
    imp: (a) => a.improved,
    book: (a) => a.lessons >= 20,
    early: (a) => a.early.length >= 5,
    dean: () => false, // (comes with the weekly leagues)
  };

  function blank() {
    return { v: 1, profile: { name: '', goal: '' }, topics: {}, facts: [], streak: { count: 0, lastDay: '' }, focusMinutes: 0, sparks: blankSparks(), awards: blankAwards() };
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
        if (parsed.sparks && typeof parsed.sparks === 'object') {
          data.sparks = Object.assign(blankSparks(), parsed.sparks);
          data.sparks.byReason = parsed.sparks.byReason || {};
        } else {
          // Grandfather an existing user onto Sparks without breaking a live
          // streak: if they already studied today under the old rules, count
          // today's goal as met so the streak carries on. Keep 2 starter freezes.
          data.sparks = blankSparks();
          if (data.streak.lastDay === todayStr()) {
            data.sparks.day = todayStr();
            data.sparks.today = data.sparks.goal;
          }
        }
        const aw = parsed.awards && typeof parsed.awards === 'object' ? parsed.awards : {};
        data.awards = Object.assign(blankAwards(), aw);
        data.awards.got = aw.got && typeof aw.got === 'object' ? aw.got : {};
        data.awards.early = Array.isArray(aw.early) ? aw.early.slice(-10) : [];
        data.awards.quiz = typeof aw.quiz === 'string' ? aw.quiz.replace(/[^01]/g, '').slice(-QUIZ_WINDOW) : '';
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

  function dayStr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  // whole days from a yyyy-mm-dd to b yyyy-mm-dd (b later); 0 if same/invalid
  function daysBetween(a, b) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return 0;
    const ms = Date.parse(b + 'T00:00:00') - Date.parse(a + 'T00:00:00');
    return Math.round(ms / DAY);
  }

  function rollSparkDay() {
    const today = todayStr();
    if (data.sparks.day !== today) {
      data.sparks.day = today;
      data.sparks.today = 0;
      data.sparks.byReason = {};
      data.sparks.comeback = false;
    }
  }

  // The streak counts a day only when the goal is met. A banked freeze covers a
  // missed day so one slip doesn't erase the streak.
  function reachGoalToday() {
    const today = todayStr();
    if (data.streak.lastDay === today) return false; // already counted today
    const prev = data.streak.lastDay;
    data.sparks.comeback = false;
    if (!prev) {
      data.streak.count = 1;
    } else {
      const gap = daysBetween(prev, today); // >= 1 when prev is an earlier day
      if (gap <= 1) {
        data.streak.count += 1;
      } else {
        const missed = gap - 1;
        if ((data.sparks.freezes || 0) >= missed) {
          data.sparks.freezes -= missed;
          data.streak.count += 1;
          data.sparks.comeback = true;
        } else {
          data.streak.count = 1;
        }
      }
    }
    data.streak.lastDay = today;
    data.sparks.onGoalDays = (data.sparks.onGoalDays || 0) + 1;
    // earn a freeze every FREEZE_EVERY on-goal days (capped so it can't hoard)
    if (data.sparks.onGoalDays % FREEZE_EVERY === 0) {
      data.sparks.freezes = Math.min(5, (data.sparks.freezes || 0) + 1);
    }
    return true;
  }

  // Check every award; the ones earned just now are saved with today's date and handed to the UI.
  function checkAwards() {
    const a = data.awards, won = [];
    Object.keys(AWARD_RULES).forEach((id) => {
      if (!a.got[id] && AWARD_RULES[id](a)) { a.got[id] = todayStr(); won.push(id); }
    });
    if (won.length) {
      save();
      if (typeof API.onAward === 'function') { try { API.onAward(won); } catch (e) { /* UI is optional */ } }
    }
    return won;
  }

  // Award Sparks for a kind of study. Returns what happened so the UI can show
  // a "+N" and celebrate the moment the goal is reached.
  function addSparks(reason) {
    rollSparkDay();
    // Early Bird: a day with study before 7 in the morning
    if (new Date().getHours() < 7 && data.awards.early.indexOf(todayStr()) === -1) data.awards.early = data.awards.early.concat(todayStr()).slice(-10);
    const base = SPARK[reason] || 0;
    let n = base;
    const cap = SPARK_CAP[reason];
    if (cap != null) {
      const used = data.sparks.byReason[reason] || 0;
      n = Math.max(0, Math.min(base, cap - used));
    }
    const wasMet = data.sparks.today >= data.sparks.goal;
    if (n > 0) {
      data.sparks.byReason[reason] = (data.sparks.byReason[reason] || 0) + n;
      data.sparks.today += n;
      data.sparks.lifetime += n;
    }
    let goalJustMet = false;
    if (!wasMet && data.sparks.today >= data.sparks.goal) goalJustMet = reachGoalToday();
    save();
    const res = { gained: n, today: data.sparks.today, goal: data.sparks.goal, goalJustMet: goalJustMet, comeback: data.sparks.comeback, streak: data.streak.count };
    if (typeof API.onSpark === 'function') { try { API.onSpark(res, reason); } catch (e) { /* UI is optional */ } }
    checkAwards();
    return res;
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
      addSparks('ask');
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
      if (correct) { t.correct += 1; schedule(t, 'good'); addSparks('quiz'); }
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
        '\n\n[Memory of this student. Use it to personalize your help; weave it in naturally and do NOT recite this list back verbatim. Never put these details into a paper or essay written for them unless they ask.]\n- ' +
        parts.join('\n- ')
      );
    },

    addFocusMinutes(n) {
      data.focusMinutes = (data.focusMinutes || 0) + (Number(n) || 0);
      addSparks('focus'); // a completed focus block earns Sparks (saves too)
    },

    // Award Sparks for a kind of study (lesson/mock/card/...). Public so app.js
    // can credit lessons, labs and mock exams. Returns the award result.
    award(reason) { return addSparks(reason); },

    // Every quiz answer (chat, board, labs) comes through here: Sparks for a right one, the last 50
    // for Best in Quiz, and a topic that was weak becoming strong for Most Improved.
    quizAnswer(right, question) {
      const a = data.awards;
      a.quiz = (a.quiz + (right ? '1' : '0')).slice(-QUIZ_WINDOW);
      const name = normTopic(question);
      if (name) {
        const t = ensureTopic(name);
        if (right) { t.correct += 1; schedule(t, 'good'); } else { t.wrong += 1; schedule(t, 'again'); }
        t.last = Date.now();
        // weak on an earlier day, strong now: improvement over time, not a slip and a fix in one sitting
        if (t.wrong > 0 && t.wrong >= t.correct && !t.weakDay) t.weakDay = todayStr();
        if (t.weakDay && t.weakDay < todayStr() && t.correct >= t.wrong + 2) a.improved = true;
      }
      if (right) addSparks('quiz'); else { save(); checkAwards(); }
    },
    // a lesson finished (a board topic's quiz passed for the first time)
    lessonDone() { data.awards.lessons += 1; return addSparks('lesson'); },
    // a mock exam scored (0 to 100)
    mockScored(score) {
      const s = Math.max(0, Math.min(100, Math.round(+score || 0)));
      data.awards.bestMock = Math.max(data.awards.bestMock || 0, s);
      return addSparks('mock');
    },
    // the awards for the shelf: which are earned (and the day), and how far along the rest are
    awards() {
      const a = data.awards, right = (a.quiz.match(/1/g) || []).length;
      return {
        got: Object.assign({}, a.got),
        progress: {
          hon: [a.bestMock, 85], hhon: [a.bestMock, 90], xhon: [a.bestMock, 95],
          att: [Math.min(data.streak.count, 30), 30], quiz: [a.quiz.length, QUIZ_WINDOW, right],
          imp: [a.improved ? 1 : 0, 1], book: [Math.min(a.lessons, 20), 20], early: [Math.min(a.early.length, 5), 5], dean: [0, 1],
        },
      };
    },
    onAward: null,

    // A snapshot for the UI: today's Sparks against the goal, lifetime, freezes.
    sparks() {
      rollSparkDay();
      const s = data.sparks;
      return {
        today: s.today, goal: s.goal, goalSet: !!s.goalSet,
        pct: Math.max(0, Math.min(1, s.goal ? s.today / s.goal : 0)),
        met: s.today >= s.goal, lifetime: s.lifetime, freezes: s.freezes || 0,
      };
    },
    goals() { return GOALS.slice(); },
    setGoal(v) {
      const g = Math.round(+v || 0);
      if (GOALS.indexOf(g) === -1) return false;
      data.sparks.goal = g; data.sparks.goalSet = true;
      // reaching a lowered goal with today's Sparks counts the day at once
      if (!(/* already counted */ data.streak.lastDay === todayStr()) && data.sparks.today >= g) reachGoalToday();
      save();
      return true;
    },

    // A hook app.js sets to show the "+N Sparks" float and goal-met moment.
    onSpark: null,
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
        sparksToday: (rollSparkDay(), data.sparks.today),
        sparksGoal: data.sparks.goal,
        sparksLifetime: data.sparks.lifetime,
        freezes: data.sparks.freezes || 0,
      };
    },

    clearAll() { data = blank(); save(); },

    // the study streak, focus time and Sparks go with an account (numbers and a
    // date only, never what was studied)
    streakData() {
      rollSparkDay();
      const s = data.sparks;
      return {
        count: data.streak.count, lastDay: data.streak.lastDay, focusMinutes: data.focusMinutes || 0,
        sparkDay: s.day, sparkToday: s.today, sparkGoal: s.goal, sparkGoalSet: !!s.goalSet,
        sparkLifetime: s.lifetime, onGoalDays: s.onGoalDays || 0, freezes: s.freezes || 0,
        awards: Object.assign({}, data.awards.got), awardLessons: data.awards.lessons, awardMock: data.awards.bestMock,
        awardEarly: data.awards.early.slice(), awardImproved: !!data.awards.improved,
      };
    },
    // back from the account on this device: the later streak wins (the same day: the longer one); focus time, the larger
    mergeStreak(s) {
      if (!s || typeof s !== 'object') return;
      const day = /^\d{4}-\d{2}-\d{2}$/.test(s.lastDay || '') ? s.lastDay : '', n = Math.max(0, Math.round(+s.count || 0));
      if (day && (day > data.streak.lastDay || (day === data.streak.lastDay && n > data.streak.count))) data.streak = { count: n, lastDay: day };
      data.focusMinutes = Math.max(data.focusMinutes || 0, Math.max(0, +s.focusMinutes || 0));
      // Sparks: lifetime/onGoalDays/freezes take the larger; a set goal carries
      // across devices; today's count merges only within the same calendar day.
      const sp = data.sparks;
      sp.lifetime = Math.max(sp.lifetime || 0, Math.max(0, +s.sparkLifetime || 0));
      sp.onGoalDays = Math.max(sp.onGoalDays || 0, Math.max(0, +s.onGoalDays || 0));
      sp.freezes = Math.max(sp.freezes || 0, Math.min(5, Math.max(0, +s.freezes || 0)));
      if (s.sparkGoalSet && GOALS.indexOf(Math.round(+s.sparkGoal)) !== -1) { sp.goal = Math.round(+s.sparkGoal); sp.goalSet = true; }
      if (/^\d{4}-\d{2}-\d{2}$/.test(s.sparkDay || '') && s.sparkDay === todayStr()) {
        rollSparkDay();
        sp.today = Math.max(sp.today || 0, Math.max(0, +s.sparkToday || 0));
      }
      // awards: an award earned on any device counts on every device (the earlier day wins)
      const aw = data.awards, isDay = /^\d{4}-\d{2}-\d{2}$/;
      if (s.awards && typeof s.awards === 'object') Object.keys(s.awards).forEach((id) => {
        if (AWARD_RULES[id] && isDay.test(s.awards[id] || '') && (!aw.got[id] || s.awards[id] < aw.got[id])) aw.got[id] = s.awards[id];
      });
      aw.lessons = Math.max(aw.lessons || 0, Math.max(0, Math.round(+s.awardLessons || 0)));
      aw.bestMock = Math.max(aw.bestMock || 0, Math.max(0, Math.min(100, Math.round(+s.awardMock || 0))));
      if (Array.isArray(s.awardEarly)) aw.early = [...new Set(aw.early.concat(s.awardEarly.filter((d) => isDay.test(d))))].sort().slice(-10);
      if (s.awardImproved === true) aw.improved = true;
      save();
    },

    // Called by app.js so the panel's "Review" buttons can start a quiz.
    onReview: null,
  };

  load();
  window.CassieMemory = API;
})();
