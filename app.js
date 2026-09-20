'use strict';

/* ---------- storage ---------- */
const STORE_KEY = 'studybuddy.v1';

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore corrupt state */ }
  return {
    decks: [{ id: 'default', name: 'General' }],
    cards: [],
    tasks: [],
    notes: [],
    focusLog: {},   // { 'YYYY-MM-DD': minutes }
    streak: { count: 0, lastDay: null },
    activeDeck: 'default',
    activeNote: null,
  };
}

let state = loadState();

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/* ---------- navigation ---------- */
const tabbar = document.getElementById('tabbar');
tabbar.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  showView(btn.dataset.view);
});

document.getElementById('views').addEventListener('click', (e) => {
  const goto = e.target.closest('[data-goto]');
  if (goto) showView(goto.dataset.goto);
});

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  const tab = document.querySelector(`.tab[data-view="${name}"]`);
  if (tab) tab.classList.add('active');
  if (name === 'dashboard') renderDashboard();
  if (name === 'cards') renderCards();
  if (name === 'tasks') renderTasks();
  if (name === 'notes') renderNotes();
}

/* ---------- streak ---------- */
function touchStreak() {
  const today = todayKey();
  if (state.streak.lastDay === today) return;
  const yesterday = todayKey(new Date(Date.now() - 86400000));
  state.streak.count = (state.streak.lastDay === yesterday) ? state.streak.count + 1 : 1;
  state.streak.lastDay = today;
  save();
}

/* ---------- dashboard ---------- */
function renderDashboard() {
  document.getElementById('today-label').textContent =
    new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  document.getElementById('stat-streak').textContent = state.streak.count;

  const now = Date.now();
  const due = state.cards.filter(c => c.due <= now).length;
  document.getElementById('stat-due').textContent = due;

  const openTasks = state.tasks.filter(t => !t.done).length;
  document.getElementById('stat-tasks').textContent = openTasks;

  document.getElementById('stat-minutes').textContent = state.focusLog[todayKey()] || 0;

  const list = document.getElementById('dashboard-tasks');
  const upcoming = state.tasks
    .filter(t => !t.done)
    .sort((a, b) => (a.due || '9999') > (b.due || '9999') ? 1 : -1)
    .slice(0, 5);
  list.innerHTML = '';
  if (upcoming.length === 0) {
    list.innerHTML = '<li class="empty">No upcoming tasks. Add one in the Tasks tab.</li>';
  } else {
    upcoming.forEach(t => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${escapeHtml(t.title)}</span><span class="due-date">${t.due ? formatDue(t.due) : ''}</span>`;
      list.appendChild(li);
    });
  }
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function formatDue(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* ---------- flashcards (simplified SM-2) ---------- */
const deckSelect = document.getElementById('deck-select');
const flashcardInner = document.getElementById('flashcard-inner');
const cardFront = document.getElementById('card-front');
const cardBack = document.getElementById('card-back');
const cardProgress = document.getElementById('card-progress');
const gradeRow = document.getElementById('grade-row');

let currentQueue = [];
let currentCard = null;

function deckCards(deckId) {
  return state.cards.filter(c => c.deckId === deckId);
}

function renderDeckSelect() {
  deckSelect.innerHTML = '';
  state.decks.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.name} (${deckCards(d.id).length})`;
    deckSelect.appendChild(opt);
  });
  deckSelect.value = state.activeDeck;
}

deckSelect.addEventListener('change', () => {
  state.activeDeck = deckSelect.value;
  save();
  renderCards();
});

document.getElementById('deck-new').addEventListener('click', () => {
  const name = prompt('Deck name (e.g. Biology Ch.3):');
  if (!name) return;
  const id = uid();
  state.decks.push({ id, name });
  state.activeDeck = id;
  save();
  renderDeckSelect();
  renderCards();
});

document.getElementById('card-new').addEventListener('click', () => {
  const front = prompt('Front of card (question):');
  if (!front) return;
  const back = prompt('Back of card (answer):');
  if (!back) return;
  state.cards.push({
    id: uid(), deckId: state.activeDeck, front, back,
    due: Date.now(), interval: 0, ease: 2.5, reps: 0,
  });
  save();
  renderCards();
});

function buildQueue() {
  const now = Date.now();
  currentQueue = deckCards(state.activeDeck)
    .filter(c => c.due <= now)
    .sort((a, b) => a.due - b.due);
}

function renderCards() {
  renderDeckSelect();
  buildQueue();
  nextCard();
  renderCardList();
}

function nextCard() {
  flashcardInner.classList.remove('flipped');
  currentCard = currentQueue.shift() || null;
  if (!currentCard) {
    cardFront.textContent = deckCards(state.activeDeck).length
      ? 'All caught up! No cards due right now.'
      : 'Add a card to get started';
    cardBack.textContent = '';
    cardProgress.textContent = '';
    gradeRow.hidden = true;
    return;
  }
  cardFront.textContent = currentCard.front;
  cardBack.textContent = currentCard.back;
  cardProgress.textContent = `${currentQueue.length} more due after this`;
  gradeRow.hidden = false;
}

flashcardInner.addEventListener('click', () => {
  if (currentCard) flashcardInner.classList.toggle('flipped');
});

gradeRow.addEventListener('click', (e) => {
  const btn = e.target.closest('.grade');
  if (!btn || !currentCard) return;
  const grade = Number(btn.dataset.grade); // 0 again, 1 hard, 2 good, 3 easy
  applyGrade(currentCard, grade);
  save();
  touchStreak();
  renderDashboard();
  renderDeckSelect();
  renderCardList();
  nextCard();
});

function applyGrade(card, grade) {
  const MINUTE = 60 * 1000, DAY = 24 * 60 * MINUTE;
  if (grade === 0) {
    card.reps = 0;
    card.interval = 0;
    card.ease = Math.max(1.3, card.ease - 0.2);
    card.due = Date.now() + 10 * MINUTE;
    return;
  }
  card.reps += 1;
  if (grade === 1) card.ease = Math.max(1.3, card.ease - 0.15);
  if (grade === 3) card.ease += 0.15;

  if (card.reps === 1) card.interval = 1;
  else if (card.reps === 2) card.interval = 3;
  else card.interval = Math.round(card.interval * card.ease);

  card.due = Date.now() + card.interval * DAY;
}

function renderCardList() {
  const ul = document.getElementById('card-list');
  const cards = deckCards(state.activeDeck);
  ul.innerHTML = '';
  if (!cards.length) {
    ul.innerHTML = '<li class="empty">No cards yet in this deck.</li>';
    return;
  }
  cards.forEach(c => {
    const li = document.createElement('li');
    const status = c.due <= Date.now() ? 'due now' : `due ${formatDue(new Date(c.due).toISOString().slice(0, 10))}`;
    li.innerHTML = `<span>${escapeHtml(c.front)}</span><span class="due-date">${status}</span>`;
    ul.appendChild(li);
  });
}

/* ---------- tasks ---------- */
document.getElementById('task-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const title = document.getElementById('task-title').value.trim();
  const due = document.getElementById('task-due').value;
  if (!title) return;
  state.tasks.push({ id: uid(), title, due, done: false });
  save();
  e.target.reset();
  renderTasks();
  renderDashboard();
});

function renderTasks() {
  const ul = document.getElementById('task-list');
  ul.innerHTML = '';
  const sorted = [...state.tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return (a.due || '9999') > (b.due || '9999') ? 1 : -1;
  });
  if (!sorted.length) {
    ul.innerHTML = '<li class="mini-list empty">No tasks yet.</li>';
    return;
  }
  const today = todayKey();
  sorted.forEach(t => {
    const li = document.createElement('li');
    li.className = 'task-item' + (t.done ? ' done' : '');
    const overdue = t.due && t.due < today && !t.done;
    li.innerHTML = `
      <input type="checkbox" ${t.done ? 'checked' : ''}>
      <div class="task-body">
        <div class="task-title">${escapeHtml(t.title)}</div>
        ${t.due ? `<div class="task-due${overdue ? ' overdue' : ''}">${overdue ? 'Overdue: ' : 'Due '}${formatDue(t.due)}</div>` : ''}
      </div>
      <button class="icon-btn" data-action="delete">✕</button>
    `;
    li.querySelector('input').addEventListener('change', () => {
      t.done = !t.done;
      save();
      renderTasks();
      renderDashboard();
    });
    li.querySelector('[data-action="delete"]').addEventListener('click', () => {
      state.tasks = state.tasks.filter(x => x.id !== t.id);
      save();
      renderTasks();
      renderDashboard();
    });
    ul.appendChild(li);
  });
}

/* ---------- notes ---------- */
const noteSelect = document.getElementById('note-select');
const noteTitle = document.getElementById('note-title');
const noteBody = document.getElementById('note-body');

function renderNoteSelect() {
  noteSelect.innerHTML = '';
  if (!state.notes.length) {
    const opt = document.createElement('option');
    opt.textContent = 'No notes yet';
    noteSelect.appendChild(opt);
    noteTitle.value = '';
    noteBody.value = '';
    noteTitle.disabled = noteBody.disabled = true;
    return;
  }
  noteTitle.disabled = noteBody.disabled = false;
  state.notes.forEach(n => {
    const opt = document.createElement('option');
    opt.value = n.id;
    opt.textContent = n.title || 'Untitled';
    noteSelect.appendChild(opt);
  });
  if (!state.notes.find(n => n.id === state.activeNote)) {
    state.activeNote = state.notes[0].id;
  }
  noteSelect.value = state.activeNote;
  loadActiveNote();
}

function loadActiveNote() {
  const n = state.notes.find(x => x.id === state.activeNote);
  if (!n) return;
  noteTitle.value = n.title;
  noteBody.value = n.body;
}

function renderNotes() {
  renderNoteSelect();
}

noteSelect.addEventListener('change', () => {
  state.activeNote = noteSelect.value;
  save();
  loadActiveNote();
});

document.getElementById('note-new').addEventListener('click', () => {
  const id = uid();
  state.notes.push({ id, title: 'New note', body: '' });
  state.activeNote = id;
  save();
  renderNoteSelect();
});

document.getElementById('note-delete').addEventListener('click', () => {
  if (!state.activeNote) return;
  if (!confirm('Delete this note?')) return;
  state.notes = state.notes.filter(n => n.id !== state.activeNote);
  state.activeNote = null;
  save();
  renderNoteSelect();
});

let noteSaveTimer = null;
function scheduleNoteSave() {
  clearTimeout(noteSaveTimer);
  noteSaveTimer = setTimeout(() => {
    const n = state.notes.find(x => x.id === state.activeNote);
    if (!n) return;
    n.title = noteTitle.value;
    n.body = noteBody.value;
    save();
    renderNoteSelect === renderNoteSelect && updateNoteOptionLabel();
  }, 300);
}
function updateNoteOptionLabel() {
  const opt = noteSelect.querySelector(`option[value="${state.activeNote}"]`);
  if (opt) opt.textContent = noteTitle.value || 'Untitled';
}
noteTitle.addEventListener('input', scheduleNoteSave);
noteBody.addEventListener('input', scheduleNoteSave);

/* ---------- focus timer ---------- */
const timerDisplay = document.getElementById('timer-display');
const timerMode = document.getElementById('timer-mode');
const timerRing = document.getElementById('timer-ring');
const timerStartBtn = document.getElementById('timer-start');
const lenFocus = document.getElementById('len-focus');
const lenBreak = document.getElementById('len-break');

let timerState = {
  mode: 'focus',       // 'focus' | 'break'
  remaining: 25 * 60,
  running: false,
  intervalId: null,
  focusedSecondsThisSession: 0,
};

function renderTimer() {
  const m = String(Math.floor(timerState.remaining / 60)).padStart(2, '0');
  const s = String(timerState.remaining % 60).padStart(2, '0');
  timerDisplay.textContent = `${m}:${s}`;
  timerMode.textContent = timerState.mode === 'focus' ? 'Focus' : 'Break';
  timerRing.classList.toggle('running', timerState.running);
  timerStartBtn.textContent = timerState.running ? 'Pause' : 'Start';
}

function tick() {
  timerState.remaining -= 1;
  if (timerState.mode === 'focus') {
    timerState.focusedSecondsThisSession += 1;
    if (timerState.focusedSecondsThisSession % 60 === 0) logFocusMinute();
  }
  if (timerState.remaining <= 0) {
    switchMode();
  }
  renderTimer();
}

function logFocusMinute() {
  const key = todayKey();
  state.focusLog[key] = (state.focusLog[key] || 0) + 1;
  save();
  touchStreak();
}

function switchMode() {
  if (timerState.mode === 'focus') {
    timerState.mode = 'break';
    timerState.remaining = Math.max(1, Number(lenBreak.value) || 5) * 60;
    notifyUser('Focus session done', 'Time for a short break.');
  } else {
    timerState.mode = 'focus';
    timerState.remaining = Math.max(1, Number(lenFocus.value) || 25) * 60;
    notifyUser('Break over', 'Back to focus.');
  }
}

function notifyUser(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body }); } catch (e) { /* ignore */ }
  }
}

timerStartBtn.addEventListener('click', () => {
  timerState.running = !timerState.running;
  if (timerState.running) {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    timerState.intervalId = setInterval(tick, 1000);
  } else {
    clearInterval(timerState.intervalId);
  }
  renderTimer();
});

document.getElementById('timer-reset').addEventListener('click', () => {
  clearInterval(timerState.intervalId);
  timerState.running = false;
  timerState.mode = 'focus';
  timerState.remaining = Math.max(1, Number(lenFocus.value) || 25) * 60;
  timerState.focusedSecondsThisSession = 0;
  renderTimer();
});

lenFocus.addEventListener('change', () => {
  if (!timerState.running && timerState.mode === 'focus') {
    timerState.remaining = Math.max(1, Number(lenFocus.value) || 25) * 60;
    renderTimer();
  }
});

/* ---------- init ---------- */
renderTimer();
showView('dashboard');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline install still works without SW */ });
  });
}
