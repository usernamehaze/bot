/* The Cassie bot design page (moved out of bot.html so the site can forbid inline scripts). */
(function () {
  const B = window.CassieBot, C = B.construction;
  const ACCENT = '#d8343c';
  const hero = B.create(document.getElementById('hero'), { accent: ACCENT });
  const nowEl = document.getElementById('now');
  let auto = true;
  const play = (state, acc) => {
    if (state) hero.setState(state);
    if (acc !== undefined) hero.setAccessory(acc);
    nowEl.textContent = `state: ${hero.state}${hero.accessory ? ' · ' + hero.accessory : ''}`;
  };
  // the hero looks at your pointer
  addEventListener('pointermove', (e) => {
    const r = document.getElementById('hero').getBoundingClientRect();
    hero.look((e.clientX - (r.left + r.width / 2)) / 300, (e.clientY - (r.top + r.height / 2)) / 300);
  });

  // --- 01 construction drawing ---
  const svg = document.getElementById('construct');
  const P = C.POINTER;
  const sx = (x) => 170 + (x - 80) * 1.25, sy = (y) => 76 + (y - 60) * 1.25; // drawing space
  const poly = P.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ');
  const scaled = C.roundedPath(P.map(([x, y, r]) => [sx(x), sy(y), r * 1.25]));
  const labels = ['tip r 44', 'wing r 40', 'notch r 16', 'tail r 26', 'tail r 26', 'notch r 16', 'heel r 48'];
  const lblPos = [[26, -4], [24, -10], [22, 18], [24, 14], [-118, 34], [-60, 82], [-138, 26]];
  const eye = (x, y) => `<rect x="${sx(x) - 8}" y="${sy(y) - 28}" width="16" height="56" rx="8" fill="#16131c"/>`;
  svg.innerHTML = `
    <defs><pattern id="g" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="rgba(255,255,255,.05)"/></pattern></defs>
    <rect width="1000" height="590" fill="url(#g)"/>
    <text x="24" y="40" class="mono" fill="#f4f1ea" font-size="19">corner(v) = cubic( v − t·û₁, v + t·û₂ ), t = min(r, |e|/2), k = 0.55</text>
    <text x="24" y="66" class="mono" fill="#9a96a3" font-size="14">the Cassie pointer, 7 points, each with its own radius</text>
    <polygon points="${poly}" fill="none" stroke="#7aa7ff" stroke-width="1.5" stroke-dasharray="6 6"/>
    <path d="${scaled}" fill="#fbfaf7" stroke="#16131c" stroke-width="10" stroke-linejoin="round"/>
    <path d="${scaled}" fill="none" stroke="rgba(122,167,255,.45)" stroke-width="1.5"/>
    ${eye(C.EYES.l[0], C.EYES.l[1])}${eye(C.EYES.r[0], C.EYES.r[1])}
    ${P.map(([x, y], i) => `<line x1="${sx(x)}" y1="${sy(y)}" x2="${sx(x) + lblPos[i][0] + (lblPos[i][0] < 0 ? 96 : -4)}" y2="${sy(y) + lblPos[i][1] - 5}" stroke="rgba(122,167,255,.4)"/><circle cx="${sx(x)}" cy="${sy(y)}" r="4.5" fill="#7aa7ff"/><text x="${sx(x) + lblPos[i][0]}" y="${sy(y) + lblPos[i][1]}" class="mono" fill="#cfd9ff" font-size="14">${labels[i]}</text>`).join('')}
    <circle cx="${sx(C.TAIL_PIVOT[0])}" cy="${sy(C.TAIL_PIVOT[1])}" r="7" fill="none" stroke="#ffb3bd" stroke-width="2.5"/><path d="M${sx(C.TAIL_PIVOT[0]) - 10} ${sy(C.TAIL_PIVOT[1])}h20M${sx(C.TAIL_PIVOT[0])} ${sy(C.TAIL_PIVOT[1]) - 10}v20" stroke="#ffb3bd" stroke-width="2"/>
    <path d="M${sx(350)} ${sy(420)} A 110 110 0 0 0 ${sx(286)} ${sy(436)}" fill="none" stroke="#ffb3bd" stroke-width="2" stroke-dasharray="4 5"/>
    <text x="${sx(300)}" y="${sy(462)}" class="mono" fill="#ffb3bd" font-size="14">tail pivot · wags ±16°</text>
    <line x1="${sx(C.HAT.x) - 70}" y1="${sy(C.HAT.y) + 37}" x2="${sx(C.HAT.x) + 40}" y2="${sy(C.HAT.y) - 22}" stroke="#e8b84a" stroke-width="2" stroke-dasharray="5 5"/>
    <text x="${sx(C.HAT.x) - 250}" y="${sy(C.HAT.y) + 50}" class="mono" fill="#e8b84a" font-size="14">hats sit on the tip · −28°</text>
    <line x1="${sx(C.EYES.r[0]) + 14}" y1="${sy(C.EYES.r[1])}" x2="720" y2="${sy(C.EYES.r[1]) - 40}" stroke="#9a96a3"/>
    <text x="728" y="${sy(C.EYES.r[1]) - 52}" class="mono" fill="#f4f1ea" font-size="15">caret eyes</text>
    <text x="728" y="${sy(C.EYES.r[1]) - 32}" class="mono" fill="#9a96a3" font-size="13">12 × 42 · blink ${C.CARET_BLINK} ms</text>
    <text x="728" y="${sy(C.EYES.r[1]) - 14}" class="mono" fill="#9a96a3" font-size="13">(a real text cursor's rhythm)</text>
    <text x="728" y="${sy(330)}" class="mono" fill="#f4f1ea" font-size="15">ink outline 9 · paper fill</text>
    <text x="728" y="${sy(330) + 20}" class="mono" fill="#9a96a3" font-size="13">the logo's white-and-black</text>
    <text x="728" y="${sy(400)}" class="mono" fill="#ff8fa0" font-size="15">blush &amp; highlighter</text>
    <text x="728" y="${sy(400) + 20}" class="mono" fill="#9a96a3" font-size="13">= your Cassie colour</text>`;

  // variants: how round should a cursor be?
  const vbox = document.getElementById('variants');
  [[0, 'r × 0', 'too sharp'], [0.45, 'r × 0.45', 'too stiff'], [1, 'r × 1', 'Cassie', true], [2.4, 'r × 2.4', 'too blobby']].forEach(([k, b, t, pick]) => {
    const d = C.roundedPath(P.map(([x, y, r]) => [x, y, r * k]));
    vbox.insertAdjacentHTML('beforeend', `<div class="var${pick ? ' pick' : ''}"><svg viewBox="80 60 340 370"><path d="${d}" fill="#fbfaf7" stroke="#16131c" stroke-width="10" stroke-linejoin="round"/><rect x="172" y="211" width="12" height="42" rx="6" fill="#16131c"/><rect x="248" y="211" width="12" height="42" rx="6" fill="#16131c"/></svg><b>${b}</b><span>${t}${pick ? ' ✓' : ''}</span></div>`);
  });

  // live mini bots — paused when off screen
  const io = new IntersectionObserver((es) => es.forEach((e) => e.target._bot && e.target._bot.pause(!e.isIntersecting)), { rootMargin: '100px' });
  function mini(host, state, acc) { const b = B.create(host, { accent: ACCENT, state, accessory: acc }); host._bot = b; io.observe(host); return b; }

  const MOODS = {
    idle: 'caret eyes blink', greeting: 'hello!', listening: 'I-beam eyes', thinking: '… on her wing', writing: 'typing lines', reading: 'eyes scan a page',
    searching: 'lens sweep', highlighting: 'highlighter stripe', snipping: 'marching ants', drawing: 'pencil scribble', done: 'click-bounce ✓', proud: 'star eyes',
    encourage: 'you got this', oops: 'cursor ⊘', busy: 'hourglass', sleeping: 'zz', love: 'heart eyes', surprised: 'whoa', wink: '😉', dizzy: 'spiral eyes', sad: 'aww', talking: 'reads aloud',
  };
  const moods = document.getElementById('moods');
  B.STATES.forEach((s) => {
    const c = document.createElement('div'); c.className = 'cell';
    c.innerHTML = `<div class="bot"></div><b>${s}</b><span>${MOODS[s] || ''}</span>`;
    moods.appendChild(c); mini(c.querySelector('.bot'), s);
    c.onclick = () => { auto = false; play(s); document.querySelectorAll('#moods .cell').forEach((x) => x.classList.toggle('on', x === c)); scrollTo({ top: 0, behavior: 'smooth' }); };
  });
  const ACCS = { gradcap: 'Research & Web', glasses: 'Professional', sunglasses: 'summer', headphones: 'focus timer', beanie: 'rainy days', salakot: 'June 12', party: 'New Year', santa: 'ber months', witch: 'Halloween', crown: 'top streak', bow: 'Talk mode', sampaguita: 'national flower', pencil: 'Quiz me', scarf: 'cold weather' };
  const accs = document.getElementById('accs');
  B.ACCESSORIES.forEach((a) => {
    const c = document.createElement('div'); c.className = 'cell';
    c.innerHTML = `<div class="bot"></div><b>${a}</b><span>${ACCS[a] || ''}</span>`;
    accs.appendChild(c); mini(c.querySelector('.bot'), 'idle', a);
    c.onclick = () => { auto = false; play(null, hero.accessory === a ? null : a); scrollTo({ top: 0, behavior: 'smooth' }); };
  });
  const FLOW = [
    ['You type a question', 'listening'], ['Cassie works on it', 'thinking'], ['The answer arrives', 'proud'], ['You attach a file', 'reading'],
    ['Research or Web', 'searching'], ['You highlight text', 'highlighting'], ['Board or a picture', 'drawing'], ['Free-plan wait', 'busy'],
    ['Something went wrong', 'oops'], ['Quiz: right answer', 'proud'], ['Quiz: missed one', 'encourage'], ['Read aloud', 'talking'], ['Quiet for a while', 'sleeping'],
  ];
  const flow = document.getElementById('flow');
  FLOW.forEach(([what, s]) => {
    const r = document.createElement('div'); r.className = 'row';
    r.innerHTML = `<div class="bot"></div><div><b>${what}</b><span>→ ${s}</span></div>`;
    flow.appendChild(r); mini(r.querySelector('.bot'), s);
    r.onclick = () => { auto = false; play(s); scrollTo({ top: 0, behavior: 'smooth' }); };
  });

  // the hero cycles through a little day in her life until you pick something
  const tour = ['greeting', 'listening', 'thinking', 'reading', 'highlighting', 'proud', 'snipping', 'searching', 'busy', 'oops', 'encourage', 'love', 'dizzy', 'sleeping', 'idle'];
  let i = 0;
  setInterval(() => { if (auto) { play(tour[i % tour.length]); i++; } }, 2600);
  play('greeting');
})();
