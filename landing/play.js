// "Meet Cassie": tap a mood and Cursor Cassie acts it out.
(() => {
  const stage = document.getElementById('play-stage');
  if (!stage || !window.CassieBot) return;
  const MOODS = [
    ['greeting', 'Greeting', 'Hi! I’m Cassie.', 'When you open Cassie'],
    ['listening', 'Listening', 'I’m listening…', 'While you type a question'],
    ['thinking', 'Thinking', 'Hmm, let me think.', 'Working out the answer'],
    ['upload', 'Upload', 'Got your file!', 'When you drop in a PDF, slides or a photo'],
    ['reading', 'Reading', 'Reading pages 3–8…', 'Taking notes on every page'],
    ['searching', 'Searching', 'Looking it up…', 'Research mode checks the web'],
    ['highlighting', 'Highlight', 'Ooh, this part matters.', 'When you highlight text on any site'],
    ['drawing', 'Drawing', 'Drawing your graph…', 'Graphs and pictures on the board'],
    ['busy', 'Busy', 'Lots of students right now.', 'She waits and tries again for you'],
    ['oops', 'Oops', 'That didn’t work.', 'She tells you what went wrong, in plain words'],
    ['done', 'Done', 'All done!', 'Your answer is ready'],
    ['proud', 'Proud', 'You got it right!', 'When you ace a quiz question'],
    ['encourage', 'You got this', 'Almost! Let’s try again.', 'When a quiz answer is wrong'],
    ['dizzy', 'Dizzy', 'Whoa, that was a lot.', 'After a 49-page reading'],
    ['love', 'Love', 'Thanks for studying with me!', ''],
    ['sleeping', 'Sleeping', 'Zzz…', 'When you leave her alone for a while'],
    ['dance', 'Dance', 'Study break!', ''],
  ];
  const colors = CassieBot.COLORS || {};
  const bot = CassieBot.create(stage, { state: 'greeting', glow: true, pokeable: true, accessory: CassieBot.seasonal() });
  const say = document.getElementById('play-say');
  const row = document.getElementById('moods');
  let touched = false, tour = 0, i = 0;

  function show(name, byUser) {
    const m = MOODS.find((x) => x[0] === name);
    if (!m) return;
    bot.setState(name);
    say.innerHTML = '';
    say.append(m[2]);
    if (m[3]) { const s = document.createElement('small'); s.textContent = m[3]; say.append(s); }
    row.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === name));
    if (byUser) { touched = true; clearInterval(tour); }
  }
  for (const [name, label] of MOODS) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.m = name; b.textContent = label;
    b.style.setProperty('--c', colors[name] || '#fff');
    b.addEventListener('click', () => show(name, true));
    row.append(b);
  }
  show('greeting');
  // A gentle tour until someone picks a mood themselves.
  const step = () => { if (touched) return; i = (i + 1) % MOODS.length; show(MOODS[i][0]); };
  const startTour = () => { clearInterval(tour); if (!touched) tour = setInterval(step, 2600); };
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => {
      bot.pause(!e.isIntersecting);
      if (e.isIntersecting) startTour(); else clearInterval(tour);
    }).observe(stage);
  } else startTour();
})();
