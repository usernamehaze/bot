/* The Museum of Famous Arts: masterpieces by Filipino artists and from around the world —
   who made each one, when, what it is made of, where it is now, and the story behind it.
   Pictures come from Wikipedia (Wikimedia Commons) for works that are free to show; works
   still under copyright show their details and a link instead of a copy of the picture. */
import { el, esc, group, seg, button, row, stats, shuffle, plusOnly, errorWords, errorWordsFor } from './kit.js';

// [id, title, artist, year, medium, where it is, the story, Wikipedia article, free to show?]
const PH = [
  ['spoliarium', 'Spoliarium', 'Juan Luna', '1884', 'Oil on canvas', 'National Museum of Fine Arts, Manila',
    'Dying gladiators are dragged from a Roman arena into the spoliarium, where their bodies were stripped. It won a gold medal at the 1884 National Exposition of Fine Arts in Madrid, a Filipino beating Spain’s best painters. At about 4.2 by 7.7 metres, it is the largest painting in the Philippines.', 'Spoliarium', true],
  ['virgenes', 'Las Vírgenes Cristianas Expuestas al Populacho', 'Félix Resurrección Hidalgo', '1884', 'Oil on canvas', '',
    'Early Christian women are shown being mocked by a Roman crowd. It won a silver medal at the same 1884 Madrid exposition where Luna’s Spoliarium won gold. José Rizal gave a famous toast in Madrid to celebrate the two Filipino winners.', 'Las Vírgenes Cristianas Expuestas al Populacho', true],
  ['pacto', 'The Blood Compact (El Pacto de Sangre)', 'Juan Luna', '1886', 'Oil on canvas', 'Malacañang Palace, Manila',
    'It shows the 1565 blood compact between the Spanish explorer Miguel López de Legazpi and Datu Sikatuna of Bohol, a pact of friendship sealed with drops of blood mixed in wine.', 'The Blood Compact (painting)', true],
  ['espana', 'España y Filipinas', 'Juan Luna', '1886', 'Oil on canvas', '',
    'Two women climb a staircase together: Spain, guiding, and the Philippines. It stood for the hope that the two would be partners, not ruler and ruled.', 'España y Filipinas', true],
  ['parisian', 'Parisian Life (Interior d’un Café)', 'Juan Luna', '1892', 'Oil on canvas', 'GSIS Museum of Art, Pasay',
    'A woman sits alone in a Paris café while three men watch her from a corner. In 2002 the Philippine government pension fund (GSIS) bought it at auction for about ₱46 million.', 'Parisian Life', true],
  ['tipos', 'Tipos del País (watercolours of Filipino people)', 'Damián Domingo', '1820s', 'Watercolour on paper', '',
    'Domingo painted Filipinos of every walk of life in their everyday clothes, as careful records of how people looked and dressed. In 1821 he opened the first school of fine arts in the Philippines in his home in Tondo, Manila.', 'Damián Domingo', true],
  ['amorsolo', 'Rice Planting', 'Fernando Amorsolo', '1920s to 1950s (many versions)', 'Oil on canvas', '',
    'Farmers plant rice in a sunny field. Amorsolo painted country life again and again, famous for his glowing backlight, the sun shining from behind his figures. He became the first National Artist of the Philippines in 1972.', 'Fernando Amorsolo', false],
  ['builders', 'The Builders', 'Victorio Edades', '1928', 'Oil on canvas', '',
    'Rough, muscular workers fill the canvas in dark, earthy colours. Nothing like the pretty country scenes people expected. Its 1928 showing shocked Manila and started modern art in the Philippines; Edades is called its father.', 'Victorio Edades', false],
  ['madonna', 'Madonna of the Slums', 'Vicente Manansala', '1950', 'Oil on canvas', '',
    'A mother and child from a poor neighbourhood are painted like a holy Madonna. Manansala’s style, “transparent cubism”, layers see-through shapes like sheets of coloured glass.', 'Vicente Manansala', false],
  ['medicine', 'The Progress of Medicine in the Philippines', 'Carlos “Botong” Francisco', '1953', 'Oil murals (four panels)', 'National Museum of Fine Arts, Manila',
    'Four huge panels tell the story of healing in the Philippines, from early healers to modern hospitals. They were painted for the Philippine General Hospital. Botong is the great muralist of Philippine history.', 'Carlos Francisco', false],
  ['arabesque', 'Granadean Arabesque', 'José Joya', '1958', 'Oil on canvas', '',
    'Bold strokes and drips of paint, inspired by the Moorish designs Joya saw in Granada, Spain. It is a landmark of Filipino abstract expressionism.', 'José Joya', false],
  ['genesis', 'Genesis', 'Hernando R. Ocampo', '1968', 'Design for a theatre curtain', 'Cultural Center of the Philippines, Manila',
    'Its swirling shapes and hot tropical colours became the great curtain of the CCP’s main theatre. Ocampo was named a National Artist in 1991.', 'H. R. Ocampo', false],
  ['sabel', 'Sabel (series)', 'Benedicto “BenCab” Cabrera', 'from 1965', 'Oil, acrylic and prints', '',
    'Sabel was a woman BenCab saw gathering scraps, wrapped in plastic sheets. He has painted her for decades, as a symbol of the dignity of the poor. BenCab was named a National Artist in 2006.', 'BenCab', false],
];
const WORLD = [
  ['monalisa', 'Mona Lisa', 'Leonardo da Vinci', 'c. 1503 to 1519', 'Oil on poplar wood', 'Louvre, Paris', 'A woman with a famously mysterious smile, painted with soft, smoky blending (“sfumato”). It is probably the most famous painting in the world.', 'Mona Lisa', true],
  ['supper', 'The Last Supper', 'Leonardo da Vinci', 'c. 1495 to 1498', 'Mural (tempera and oil on plaster)', 'Santa Maria delle Grazie, Milan', 'Jesus has just said one of his apostles will betray him, and each one reacts. The lines of the room all point to Jesus’s head.', 'The Last Supper (Leonardo)', true],
  ['venus', 'The Birth of Venus', 'Sandro Botticelli', 'c. 1484 to 1486', 'Tempera on canvas', 'Uffizi Gallery, Florence', 'The goddess Venus arrives on the shore standing on a shell, blown by the winds. A symbol of the Italian Renaissance.', 'The Birth of Venus', true],
  ['delights', 'The Garden of Earthly Delights', 'Hieronymus Bosch', 'c. 1490 to 1510', 'Oil on oak panels (triptych)', 'Museo del Prado, Madrid', 'Three panels, paradise, a strange garden of pleasures, and hell, filled with hundreds of tiny, dreamlike figures.', 'The Garden of Earthly Delights', true],
  ['adam', 'The Creation of Adam', 'Michelangelo', 'c. 1508 to 1512', 'Fresco', 'Sistine Chapel, Vatican City', 'God reaches out to give life to Adam; their fingers almost touch. Part of the ceiling Michelangelo painted standing on scaffolding, with his head bent back (not lying down, as many people think).', 'The Creation of Adam', true],
  ['athens', 'The School of Athens', 'Raphael', 'c. 1509 to 1511', 'Fresco', 'Apostolic Palace, Vatican City', 'The great thinkers of ancient Greece, Plato and Aristotle in the middle, gather in a grand hall drawn in perfect perspective.', 'The School of Athens', true],
  ['nightwatch', 'The Night Watch', 'Rembrandt', '1642', 'Oil on canvas', 'Rijksmuseum, Amsterdam', 'A city militia company bursts into action. Rembrandt’s dramatic light and shadow make a group portrait feel like a moment in a story.', 'The Night Watch', true],
  ['meninas', 'Las Meninas', 'Diego Velázquez', '1656', 'Oil on canvas', 'Museo del Prado, Madrid', 'The young Spanish princess and her maids, and Velázquez himself, painting. A mirror at the back shows the king and queen, as if they stand where you stand.', 'Las Meninas', true],
  ['pearl', 'Girl with a Pearl Earring', 'Johannes Vermeer', 'c. 1665', 'Oil on canvas', 'Mauritshuis, The Hague', 'A girl in a blue and yellow turban turns to look at us. The earring is just a few strokes of white paint.', 'Girl with a Pearl Earring', true],
  ['liberty', 'Liberty Leading the People', 'Eugène Delacroix', '1830', 'Oil on canvas', 'Louvre, Paris', 'Liberty, as a woman holding the French flag, leads people of every class over a barricade in the July Revolution of 1830.', 'Liberty Leading the People', true],
  ['wave', 'The Great Wave off Kanagawa', 'Katsushika Hokusai', 'c. 1831', 'Woodblock print', 'Many copies (e.g. The Met, New York)', 'A giant wave curls over boats, with Mount Fuji small in the distance. It was printed from carved wood blocks, so many copies exist.', 'The Great Wave off Kanagawa', true],
  ['sunrise', 'Impression, Sunrise', 'Claude Monet', '1872', 'Oil on canvas', 'Musée Marmottan Monet, Paris', 'The harbour of Le Havre in morning mist, in quick loose strokes. A critic mocked its title, and gave the Impressionists their name.', 'Impression, Sunrise', true],
  ['jatte', 'A Sunday Afternoon on the Island of La Grande Jatte', 'Georges Seurat', '1884 to 1886', 'Oil on canvas', 'Art Institute of Chicago', 'Parisians relax by the river, painted entirely in tiny dots of colour that mix in your eye, pointillism.', 'A Sunday Afternoon on the Island of La Grande Jatte', true],
  ['sunflowers', 'Sunflowers', 'Vincent van Gogh', '1888', 'Oil on canvas (series)', 'National Gallery, London (one version)', 'Van Gogh painted sunflowers in a vase many times to decorate a friend’s room, in thick, bright yellows.', 'Sunflowers (Van Gogh series)', true],
  ['starry', 'The Starry Night', 'Vincent van Gogh', '1889', 'Oil on canvas', 'Museum of Modern Art, New York', 'A swirling night sky over a quiet village, painted from memory while Van Gogh stayed at an asylum in Saint-Rémy.', 'The Starry Night', true],
  ['scream', 'The Scream', 'Edvard Munch', '1893', 'Tempera and crayon on cardboard (one of several versions)', 'National Museum, Oslo', 'A figure on a bridge clutches its face under a blood-red sky, an image of anxiety known all over the world.', 'The Scream', true],
  ['lilies', 'Water Lilies', 'Claude Monet', '1896 to 1926', 'Oil on canvas (about 250 paintings)', 'Many museums (e.g. Musée de l’Orangerie, Paris)', 'Monet painted the lily pond in his garden at Giverny again and again, in every light and season.', 'Water Lilies (Monet series)', true],
  ['kiss', 'The Kiss', 'Gustav Klimt', '1907 to 1908', 'Oil and gold leaf on canvas', 'Belvedere, Vienna', 'Two lovers wrapped in robes of gold patterns, from Klimt’s “golden period”.', 'The Kiss (Klimt)', true],
  ['gothic', 'American Gothic', 'Grant Wood', '1930', 'Oil on beaverboard', 'Art Institute of Chicago', 'A stern farmer with a pitchfork and a woman stand before a house with a Gothic window. One of the most copied images in America.', 'American Gothic', true],
  ['memory', 'The Persistence of Memory', 'Salvador Dalí', '1931', 'Oil on canvas', 'Museum of Modern Art, New York', 'Soft, melting pocket watches in a dream landscape, the best-known Surrealist painting.', 'The Persistence of Memory', false],
  ['guernica', 'Guernica', 'Pablo Picasso', '1937', 'Oil on canvas', 'Museo Reina Sofía, Madrid', 'Picasso’s huge black, white and grey protest against the bombing of the town of Guernica in the Spanish Civil War.', 'Guernica (Picasso)', false],
  ['fridas', 'The Two Fridas', 'Frida Kahlo', '1939', 'Oil on canvas', 'Museo de Arte Moderno, Mexico City', 'Two Frida Kahlos sit holding hands, their hearts showing, one in European dress, one in Mexican dress.', 'The Two Fridas', false],
].map((x) => [...x.slice(0, 9)]);
const ALL = [...PH.map((x) => ({ from: 'ph', x })), ...WORLD.map((x) => ({ from: 'world', x }))].map(({ from, x }) => ({ from, id: x[0], title: x[1], artist: x[2], year: x[3], medium: x[4], where: x[5], story: x[6], wiki: x[7], free: x[8] }));

// the painting's picture from its Wikipedia article — only when the article is really about an artwork
const picCache = new Map();
function picture(a) {
  if (!a.free) return Promise.resolve(null);
  if (!picCache.has(a.id)) {
    picCache.set(a.id, fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(a.wiki.replace(/ /g, '_'))}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d && /\b(paintings?|frescos?|murals?|prints?|artwork|triptych|watercolou?rs?)\b/i.test(d.description || '') && d.thumbnail ? { thumb: d.thumbnail.source, big: (d.originalimage || d.thumbnail).source, page: d.content_urls && d.content_urls.desktop && d.content_urls.desktop.page } : null))
      .catch(() => null));
  }
  return picCache.get(a.id);
}
const wikiLink = (a) => `https://en.wikipedia.org/wiki/${encodeURIComponent(a.wiki.replace(/ /g, '_'))}`;

const museumLab = {
  id: 'museum', name: 'Museum of Famous Arts', subject: 'tools', wide: true,
  blurb: 'Walk through masterpieces by Filipino artists, Luna, Hidalgo, Amorsolo, Botong, BenCab, and the world’s most famous paintings: who made them, when, and the story behind each.',
  words: 'art museum painting artist filipino juan luna spoliarium amorsolo national artist mona lisa starry night van gogh gallery history arts',
  topic: 'famous paintings and artists, Filipino and world',
  icon: '<rect x="6" y="9" width="36" height="28" rx="1"/><rect x="11" y="14" width="26" height="18"/><path d="M11 29l7-7 5 5 4-4 10 9"/><circle cx="30" cy="19" r="2"/><path d="M14 41h20"/>',
  about: 'Thirty-five famous works, from Damián Domingo’s 1820s watercolours to BenCab’s Sabel, and from Botticelli to Frida Kahlo. Every card says who made it, when, what it is made of, and where it is now. The pictures load from Wikipedia for works that are free to show (their artists died long ago); works still under copyright show a framed card and a link to see them. “Who painted it?” is a quick game with the same works.',
  mount({ stage, panel, api }) {
    let wing = 'all', open = null, game = null, seen = new Set();
    const page = el('div', 'tl-sheet tl-museum'); stage.appendChild(page);
    seg(group(panel, 'Gallery'), { options: [['all', 'All'], ['ph', 'Filipino artists'], ['world', 'Around the world']], value: wing, onChange: (v) => { wing = v; game = null; open = null; draw(); } });
    const search = el('input', 'tl-input'); search.placeholder = 'Find a work or an artist…'; search.setAttribute('aria-label', 'Find a work or an artist');
    group(panel, 'Search').appendChild(search);
    search.addEventListener('input', () => { open = null; game = null; draw(); });
    const r = row(panel);
    button(r, 'Play “Who painted it?”', plusOnly('The “Who painted it?” quiz', () => startGame()), 'main');
    button(r, 'Surprise me', () => { const list = shown(); show(list[Math.floor(Math.random() * list.length)].id); });
    const st = stats(panel);
    const shown = () => { const q = search.value.trim().toLowerCase(); return ALL.filter((a) => (wing === 'all' || a.from === wing) && (!q || (a.title + ' ' + a.artist + ' ' + a.year).toLowerCase().includes(q))); };
    function frame(a, big = false) {
      return `<div class="tl-frame${big ? ' tl-big' : ''}" data-pic="${a.id}"><div class="tl-canvas tl-ph-${a.from}"><span>${esc(a.title)}</span><small>${esc(a.artist)}</small></div></div>`;
    }
    // fill in pictures as they arrive
    function hydrate() {
      page.querySelectorAll('[data-pic]').forEach((f) => {
        const a = ALL.find((x) => x.id === f.dataset.pic);
        picture(a).then((p) => {
          if (!p || !f.isConnected || f.querySelector('img')) return;
          const img = new Image(); img.alt = `${a.title} by ${a.artist}`; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
          img.onload = () => f.classList.add('tl-loaded'); img.src = f.classList.contains('tl-big') ? p.big : p.thumb;
          f.querySelector('.tl-canvas').appendChild(img);
        });
      });
    }
    function draw() {
      if (game) { drawGame(); return; }
      if (open) { drawOne(); return; }
      const list = shown();
      page.innerHTML = `<p class="tl-hint">${list.length} works · tap one to read its story</p><div class="tl-gallery">${list.map((a) => `<button type="button" class="tl-work" data-open="${a.id}">${frame(a)}<b>${esc(a.title)}</b><span>${esc(a.artist)} · ${esc(a.year)}</span></button>`).join('')}</div>`;
      hydrate();
      st.set([['Works', String(list.length)], ['Viewed', `${seen.size}/${ALL.length}`]]);
    }
    function drawOne() {
      const a = ALL.find((x) => x.id === open);
      page.innerHTML = `<div class="tl-one"><button type="button" class="lab-btn" data-close>‹ Back to the gallery</button>
        ${frame(a, true)}
        <h3>${esc(a.title)}</h3>
        <dl class="tl-facts"><div><dt>Artist</dt><dd>${esc(a.artist)}</dd></div><div><dt>Year</dt><dd>${esc(a.year)}</dd></div><div><dt>Medium</dt><dd>${esc(a.medium)}</dd></div>${a.where ? `<div><dt>Where it is</dt><dd>${esc(a.where)}</dd></div>` : ''}<div><dt>Gallery</dt><dd>${a.from === 'ph' ? 'Filipino artists' : 'Around the world'}</dd></div></dl>
        <p class="tl-story">${esc(a.story)}</p>
        ${a.free ? '' : '<p class="tl-hint">This work is still under copyright, so it isn’t copied here. See it on Wikipedia or in a museum.</p>'}
        <p class="tl-onebtns"><a class="lab-btn" href="${wikiLink(a)}" target="_blank" rel="noopener">Read more on Wikipedia ↗</a><button type="button" class="lab-btn" data-askart>Ask Cassie about it</button></p>
        <p class="tl-msg" hidden></p></div>`;
      hydrate();
      seen.add(a.id);
      if (seen.size >= 1) api.check(0);
      if (new Set([...seen].map((id) => ALL.find((x) => x.id === id).from)).size === 2) api.check(1);
    }
    function show(id) { open = id; game = null; draw(); page.scrollTop = 0; }
    function startGame() {
      const pool = shuffle(shown().length >= 4 ? shown() : ALL, Math.random).slice(0, 8);
      game = { pool, i: 0, score: 0, picked: null };
      draw();
    }
    function drawGame() {
      const g = game;
      if (g.i >= g.pool.length) {
        page.innerHTML = `<div class="tl-empty"><b>${g.score} of ${g.pool.length} right!</b><p>${g.score === g.pool.length ? 'A perfect round. You know your art! 🎨' : 'Tap a work in the gallery to read its story, then play again.'}</p><p><button type="button" class="lab-btn main" data-again>Play again</button> <button type="button" class="lab-btn" data-close>Back to the gallery</button></p></div>`;
        if (g.score >= 6) api.check(2);
        api.best(g.score, `${g.score}/${g.pool.length} in “Who painted it?”`);
        return;
      }
      const a = g.pool[g.i];
      if (!g.opts) { const artists = [...new Set(ALL.map((x) => x.artist).filter((n) => n !== a.artist))]; g.opts = shuffle([a.artist, ...shuffle(artists, Math.random).slice(0, 3)], Math.random); }
      page.innerHTML = `<div class="tl-one"><p class="tl-hint">Work ${g.i + 1} of ${g.pool.length} · score ${g.score}</p>${frame(a, true)}<h3>${esc(a.title)} <small>(${esc(a.year)})</small></h3><p>Who made it?</p>
        <div class="tl-opts">${g.opts.map((o) => `<button type="button" class="lab-btn${g.picked ? (o === a.artist ? ' tl-right' : o === g.picked ? ' tl-wrong' : '') : ''}" data-guess="${esc(o)}" ${g.picked ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div>
        ${g.picked ? `<p class="tl-story">${esc(a.story)}</p><button type="button" class="lab-btn main" data-next>Next ›</button>` : ''}</div>`;
      hydrate();
    }
    page.addEventListener('click', async (e) => {
      const o = e.target.closest('[data-open]'); if (o) { show(o.dataset.open); return; }
      if (e.target.closest('[data-close]')) { open = null; game = null; draw(); return; }
      if (e.target.closest('[data-again]')) { startGame(); return; }
      const gu = e.target.closest('[data-guess]');
      if (gu && game && !game.picked) { game.picked = gu.dataset.guess; if (game.picked === game.pool[game.i].artist) game.score++; seen.add(game.pool[game.i].id); drawGame(); return; }
      if (e.target.closest('[data-next]') && game) { game.i++; game.picked = null; game.opts = null; drawGame(); return; }
      const ask = e.target.closest('[data-askart]');
      if (ask && open) {
        const a = ALL.find((x) => x.id === open), out = page.querySelector('.tl-one .tl-msg');
        if (!api.canAsk()) { out.hidden = false; out.textContent = errorWords('lab_ai_off', { next: 'Read the notes about this work below.' }); return; }
        ask.disabled = true; out.hidden = false; out.className = 'tl-msg muted'; out.textContent = 'Cassie is looking…';
        try { const t = await api.ask(`Tell a student about "${a.title}" by ${a.artist} (${a.year}). In under 120 words: what to look for in it (composition, colour, technique), why it matters in art history${a.from === 'ph' ? ' and to Filipinos' : ''}, and one surprising fact. Only facts you are sure of. Plain text, no markdown.`); out.className = 'tl-msg'; out.textContent = String(t || '').replace(/[*#`_]/g, '').trim(); }
        catch (err) { out.textContent = errorWordsFor(err, 'lab_ai_failed'); }
        finally { ask.disabled = false; }
      }
    });
    draw();
    return { state: () => (game ? `playing “Who painted it?”: ${game.score} right so far` : open ? `looking at ${ALL.find((x) => x.id === open).title} by ${ALL.find((x) => x.id === open).artist}` : `browsing the ${wing === 'ph' ? 'Filipino' : wing === 'world' ? 'world' : 'whole'} gallery`), destroy() {} };
  },
  tries: ['Open a work and read its story', 'Visit both galleries: Filipino and world', 'Get 6 or more right in “Who painted it?”'],
  hints: ['Tap any work in the gallery.', 'Switch the Gallery to “Filipino artists”, then to “Around the world”.', 'Read a few stories first: the artists’ styles give them away.'],
};
export const MUSEUM = [museumLab];
export { ALL as ARTWORKS };
