/* Cassie's drawing book (v310): hand-checked drawings and 3D models of the subjects students ask about most.
   One of these shows at once (no waiting, no AI, and offline too), and it is right every time: every part in its real
   place, with its real name. A follow-up question still goes to the AI, which answers on top of the checked drawing.
   Anything that is not in the book is drawn by the AI as before. Shared by the app and the extension (a copy of this
   file sits in extension/; a test checks the two are the same). */

// a question is about the book's subject when it names it and asks for little else ("draw a bicycle", "how does a
// bicycle work in 3D"); a narrow question ("how do a bicycle's gears shift") is the AI's, which can focus on that
const ASKING = /\b(draw|sketch|show|build|make|create|model|diagram|illustrate|explain|teach|how|what|does|do|is|are|works?|working|parts?|label(?:led|ed)?|the|an?|of|me|us|please|pls|po|in|3d|2d|three[\s-]?d|picture|drawing|simple|whole|full|real|realistic|for|with|its|it|and|can|you|i|want|need|see|look|like|naman|paano|ano|ang|ng|mo|ko|gumagana|iguhit|ipakita|human|structure|detailed|basic|quick|nice|cool|cute|step|steps|by|our|this|that|again|now|then|kindly|work|function|functions|looks|inside)\b/gi;

const BOOK = [
  {
    key: 'bicycle', is: /\b(bicycles?|bikes?|cycling|bisikleta)\b/i, not: /\b(motor ?bikes?|motorcycles?|e-?bikes?|dirt ?bikes?)\b/i,
    '3d': {
      title: 'How a bicycle works', mode: '3d', axis: 'x',
      intro: 'A bicycle turns the push of your legs into turning wheels: pedals, cranks, chain, rear wheel.',
      summary: 'You push the pedals, the chainring pulls the chain, the chain turns the rear gear, and the rear wheel rolls the bike forward.',
      photo: 'a real city bicycle standing on a road, side view, steel frame, two spoked wheels, chain and pedals',
      next: ['How does the chain turn the rear wheel?', 'What do the brakes press on to stop the bike?'],
      parts: [
        { id: 'frame', label: 'Frame', say: 'The diamond shaped frame of steel tubes holds every part together and carries your weight.', color: '#c0392b', finish: 'metal', size: 0.7, attached: ['fork', 'saddle', 'crank', 'rearw'],
          shapes: [
            { t: 'pipe', r: 0.045, pts: [[-1.7, 0, 0], [0, -0.1, 0]] },
            { t: 'pipe', r: 0.045, pts: [[0, -0.1, 0], [-0.4, 1.15, 0]] },
            { t: 'pipe', r: 0.04, pts: [[-1.7, 0, 0], [-0.4, 1.15, 0]] },
            { t: 'pipe', r: 0.05, pts: [[-0.4, 1.15, 0], [1.18, 1.18, 0]] },
            { t: 'pipe', r: 0.055, pts: [[1.28, 0.9, 0], [0, -0.1, 0]] },
            { t: 'cylinder', r: 0.06, len: 0.32, axis: 'y', pos: [1.24, 1.04, 0] },
          ] },
        { id: 'frontw', label: 'Front wheel', say: 'The front wheel steers: a rubber tyre on a metal rim, held to the hub by thin spokes.', color: '#2c2c34', finish: 'rubber', spin: true, size: 0.3, attached: ['fork'],
          shapes: [
            { t: 'torus', r: 0.95, tube: 0.07, axis: 'z', pos: [1.7, 0, 0] },
            { t: 'torus', r: 0.87, tube: 0.025, axis: 'z', pos: [1.7, 0, 0], color: '#b8bcc4' },
            { t: 'blades', n: 16, len: 0.78, width: 0.012, hub: 0.07, axis: 'z', pos: [1.7, 0, 0], color: '#c8ccd4' },
            { t: 'cylinder', r: 0.07, len: 0.16, axis: 'z', pos: [1.7, 0, 0], color: '#9aa0aa' },
          ] },
        { id: 'rearw', label: 'Rear wheel', say: 'The rear wheel drives the bike: the chain turns it, and it pushes the bike forward.', color: '#2c2c34', finish: 'rubber', spin: true, size: 0.3, attached: ['frame', 'cog'],
          shapes: [
            { t: 'torus', r: 0.95, tube: 0.07, axis: 'z', pos: [-1.7, 0, 0] },
            { t: 'torus', r: 0.87, tube: 0.025, axis: 'z', pos: [-1.7, 0, 0], color: '#b8bcc4' },
            { t: 'blades', n: 16, len: 0.78, width: 0.012, hub: 0.07, axis: 'z', pos: [-1.7, 0, 0], color: '#c8ccd4' },
            { t: 'cylinder', r: 0.07, len: 0.16, axis: 'z', pos: [-1.7, 0, 0], color: '#9aa0aa' },
          ] },
        { id: 'fork', label: 'Fork', say: 'The fork holds the front wheel and turns with the handlebars to steer.', color: '#9aa0aa', finish: 'metal', size: 0.2, attached: ['frame', 'frontw', 'bars'],
          shapes: [
            { t: 'pipe', r: 0.035, pts: [[1.28, 0.88, 0.06], [1.5, 0.4, 0.07], [1.7, 0, 0.07]] },
            { t: 'pipe', r: 0.035, pts: [[1.28, 0.88, -0.06], [1.5, 0.4, -0.07], [1.7, 0, -0.07]] },
          ] },
        { id: 'bars', label: 'Handlebars', say: 'You hold the handlebars to steer and to reach the brake levers.', color: '#3a3a42', finish: 'rubber', size: 0.15, attached: ['fork'],
          shapes: [
            { t: 'pipe', r: 0.035, pts: [[1.22, 1.2, 0], [1.14, 1.42, 0]], color: '#9aa0aa' },
            { t: 'cylinder', r: 0.03, len: 0.62, axis: 'z', pos: [1.1, 1.44, 0], color: '#9aa0aa' },
            { t: 'cylinder', r: 0.045, len: 0.14, axis: 'z', pos: [1.1, 1.44, 0.26] },
            { t: 'cylinder', r: 0.045, len: 0.14, axis: 'z', pos: [1.1, 1.44, -0.26] },
          ] },
        { id: 'saddle', label: 'Saddle', say: 'You sit on the saddle; its post slides up and down to fit your legs.', color: '#3a2a24', finish: 'plastic', size: 0.1, attached: ['frame'],
          shapes: [
            { t: 'pipe', r: 0.03, pts: [[-0.4, 1.15, 0], [-0.47, 1.38, 0]], color: '#9aa0aa' },
            { t: 'capsule', r: 0.075, len: 0.32, axis: 'x', pos: [-0.47, 1.45, 0] },
          ] },
        { id: 'crank', label: 'Pedals and cranks', say: 'Your feet push the pedals round; the crank arms turn the chainring.', color: '#5a5a64', finish: 'metal', spin: true, size: 0.15, attached: ['frame', 'ring'],
          shapes: [
            { t: 'cylinder', r: 0.05, len: 0.34, axis: 'z', pos: [0, -0.1, 0] },
            { t: 'pipe', r: 0.025, pts: [[0, -0.1, 0.17], [0.12, -0.45, 0.17]] },
            { t: 'pipe', r: 0.025, pts: [[0, -0.1, -0.17], [-0.12, 0.25, -0.17]] },
            { t: 'box', size: [0.18, 0.04, 0.12], pos: [0.12, -0.47, 0.25], color: '#2c2c34' },
            { t: 'box', size: [0.18, 0.04, 0.12], pos: [-0.12, 0.27, -0.25], color: '#2c2c34' },
          ] },
        { id: 'ring', label: 'Chainring', say: 'The big front gear: each turn of the pedals pulls the chain a long way.', color: '#b8bcc4', finish: 'metal', spin: true, size: 0.1, attached: ['crank', 'chain'],
          shapes: [
            { t: 'torus', r: 0.26, tube: 0.025, axis: 'z', pos: [0, -0.1, 0.12] },
            { t: 'disc', r: 0.24, thick: 0.015, axis: 'z', pos: [0, -0.1, 0.12] },
          ] },
        { id: 'chain', label: 'Chain', say: 'The chain carries the pull from the chainring back to the rear gear.', color: '#6a6a74', finish: 'metal', size: 0.4, attached: ['ring', 'cog'],
          shapes: [
            { t: 'pipe', r: 0.018, pts: [[0, 0.16, 0.12], [-1.7, 0.12, 0.12]] },
            { t: 'pipe', r: 0.018, pts: [[0, -0.36, 0.12], [-1.7, -0.12, 0.12]] },
          ] },
        { id: 'cog', label: 'Rear gear', say: 'The small rear gear turns the rear wheel; a smaller gear makes the wheel spin faster.', color: '#d0d4dc', finish: 'metal', spin: true, size: 0.06, attached: ['chain', 'rearw'],
          shapes: [{ t: 'disc', r: 0.12, thick: 0.05, axis: 'z', pos: [-1.7, 0, 0.12] }] },
        { id: 'brakes', label: 'Brakes', say: 'Squeezing the brake lever presses rubber pads on the rims, and the bike slows down.', color: '#e0a030', finish: 'plastic', size: 0.55, attached: ['fork', 'frame'], // (size: a front and a rear brake, across the bike)
          shapes: [
            { t: 'box', size: [0.1, 0.08, 0.2], pos: [1.53, 0.86, 0] },
            { t: 'box', size: [0.1, 0.08, 0.2], pos: [-1.38, 0.82, 0] },
          ] },
      ],
    },
    '2d': {
      title: 'How a bicycle works', mode: '2d', layout: 'side view; the rear wheel on the left, the front wheel on the right; the ground at y 236',
      intro: 'A bicycle turns the push of your legs into turning wheels: pedals, cranks, chain, rear wheel.',
      summary: 'You push the pedals, the chainring pulls the chain, the chain turns the rear gear, and the rear wheel rolls the bike forward.',
      photo: 'a real city bicycle standing on a road, side view, steel frame, two spoked wheels, chain and pedals',
      next: ['How does the chain turn the rear wheel?', 'What do the brakes press on to stop the bike?'],
      parts: [
        { id: 'rearw', label: 'Rear wheel', say: 'The rear wheel drives the bike: the chain turns it.', color: '#7fb0ff', box: [36, 118, 120, 120], anchor: [96, 120],
          shapes: [{ t: 'circle', cx: 96, cy: 178, r: 58 }, { t: 'circle', cx: 96, cy: 178, r: 52 }, { t: 'line', x1: 96, y1: 126, x2: 96, y2: 230 }, { t: 'line', x1: 44, y1: 178, x2: 148, y2: 178 }, { t: 'line', x1: 59, y1: 141, x2: 133, y2: 215 }, { t: 'line', x1: 133, y1: 141, x2: 59, y2: 215 }] },
        { id: 'frontw', label: 'Front wheel', say: 'The front wheel steers the bike.', color: '#7fb0ff', box: [244, 118, 120, 120], anchor: [304, 120],
          shapes: [{ t: 'circle', cx: 304, cy: 178, r: 58 }, { t: 'circle', cx: 304, cy: 178, r: 52 }, { t: 'line', x1: 304, y1: 126, x2: 304, y2: 230 }, { t: 'line', x1: 252, y1: 178, x2: 356, y2: 178 }, { t: 'line', x1: 267, y1: 141, x2: 341, y2: 215 }, { t: 'line', x1: 341, y1: 141, x2: 267, y2: 215 }] },
        { id: 'frame', label: 'Frame', say: 'The diamond shaped frame of tubes holds every part together.', color: '#ff8a8a', box: [92, 84, 196, 102], anchor: [188, 86],
          shapes: [{ t: 'line', x1: 96, y1: 178, x2: 190, y2: 182 }, { t: 'line', x1: 190, y1: 182, x2: 160, y2: 88 }, { t: 'line', x1: 96, y1: 178, x2: 160, y2: 88 }, { t: 'line', x1: 160, y1: 88, x2: 270, y2: 86 }, { t: 'line', x1: 274, y1: 100, x2: 190, y2: 182 }, { t: 'line', x1: 270, y1: 80, x2: 276, y2: 104 }] },
        { id: 'fork', label: 'Fork', say: 'The fork holds the front wheel and turns with the handlebars.', color: '#c9a7ff', box: [268, 98, 40, 82], anchor: [288, 140],
          shapes: [{ t: 'path', d: 'M276 102 Q284 140 304 178' }] },
        { id: 'bars', label: 'Handlebars', say: 'You hold the handlebars to steer and to brake.', color: '#ffd29e', box: [254, 56, 46, 30], anchor: [276, 62],
          shapes: [{ t: 'line', x1: 270, y1: 80, x2: 266, y2: 64 }, { t: 'path', d: 'M256 62 L276 62 Q292 62 292 74' }] },
        { id: 'saddle', label: 'Saddle', say: 'You sit on the saddle; its post fits your height.', color: '#ffb067', box: [132, 62, 52, 28], anchor: [156, 68],
          shapes: [{ t: 'line', x1: 160, y1: 88, x2: 156, y2: 72 }, { t: 'path', d: 'M136 70 Q156 60 180 68 Q160 74 136 70 Z', fill: true }] },
        { id: 'crank', label: 'Pedals and cranks', say: 'Your feet push the pedals round; the cranks turn the chainring.', color: '#8fe0b0', box: [170, 158, 50, 58], anchor: [204, 208],
          shapes: [{ t: 'line', x1: 190, y1: 182, x2: 204, y2: 208 }, { t: 'rect', x: 196, y: 208, w2: 18, h: 6, fill: true }, { t: 'line', x1: 190, y1: 182, x2: 178, y2: 160 }] },
        { id: 'ring', label: 'Chainring', say: 'The big front gear pulls the chain a long way with each turn.', color: '#7ee0e0', box: [170, 162, 40, 40], anchor: [190, 166],
          shapes: [{ t: 'circle', cx: 190, cy: 182, r: 16 }, { t: 'circle', cx: 190, cy: 182, r: 4, fill: true }] },
        { id: 'chain', label: 'Chain', say: 'The chain carries the pull back to the rear gear.', color: '#e8e8ee', box: [96, 164, 96, 36], anchor: [140, 170],
          shapes: [{ t: 'line', x1: 190, y1: 166, x2: 96, y2: 170, dash: true }, { t: 'line', x1: 190, y1: 198, x2: 96, y2: 186, dash: true }] },
        { id: 'cog', label: 'Rear gear', say: 'The small rear gear turns the rear wheel.', color: '#f7a8c8', box: [84, 166, 24, 24], anchor: [96, 178],
          shapes: [{ t: 'circle', cx: 96, cy: 178, r: 8 }, { t: 'circle', cx: 96, cy: 178, r: 3, fill: true }] },
        { id: 'brakes', label: 'Brakes', say: 'Squeezing a brake lever presses rubber pads on the rim, and the bike slows down.', color: '#e0a030', box: [120, 112, 176, 26], anchor: [130, 130],
          shapes: [{ t: 'rect', x: 124, y: 124, w2: 12, h: 10, fill: true }, { t: 'rect', x: 278, y: 118, w2: 12, h: 10, fill: true }, { t: 'path', d: 'M286 62 Q296 66 298 72' }] },
      ],
    },
  },
  {
    key: 'solar', is: /\b(solar system|sistemang solar|planets? (of|in) (the|our) solar system|the planets)\b/i,
    '3d': {
      title: 'The solar system', mode: '3d', axis: 'x',
      intro: 'Eight planets go round the Sun, each on its own orbit; the four rocky ones are closest.',
      summary: 'Mercury, Venus, Earth and Mars are small and rocky; Jupiter, Saturn, Uranus and Neptune are giants far out. Sizes and distances are not to scale.',
      photo: 'a real telescope photograph of the planets of the solar system',
      next: ['Why is Venus hotter than Mercury?', 'What are Saturn’s rings made of?'],
      parts: [
        { id: 'sun', label: 'Sun', say: 'The Sun is a star: a huge ball of hot gas that gives light and heat to every planet.', color: '#ffb020', glow: true, size: 0.25, shapes: [{ t: 'sphere', r: 0.6, pos: [0, 0, 0] }] },
        { id: 'orbit', label: 'Orbits', say: 'Each planet travels round the Sun on its own path, its orbit. These are not to scale.', color: '#6a6a7a', size: 1, shapes: [0.95, 1.3, 1.65, 2.0, 2.6, 3.15, 3.65, 4.1].map((r) => ({ t: 'torus', r, tube: 0.006, axis: 'y', pos: [0, 0, 0] })) },
        { id: 'mercury', label: 'Mercury', say: 'Mercury is the smallest planet and the closest to the Sun.', color: '#a8a49c', size: 0.02, shapes: [{ t: 'sphere', r: 0.06, pos: [0.95, 0, 0] }] },
        { id: 'venus', label: 'Venus', say: 'Venus is the hottest planet, wrapped in thick clouds.', color: '#e8c27a', size: 0.03, shapes: [{ t: 'sphere', r: 0.1, pos: [0, 0, 1.3] }] },
        { id: 'earth', label: 'Earth', say: 'Earth, our home, the only planet we know has life.', color: '#3f86d6', size: 0.03, shapes: [{ t: 'sphere', r: 0.11, pos: [-1.65, 0, 0] }] },
        { id: 'mars', label: 'Mars', say: 'Mars is the red planet, with rusty dust on its ground.', color: '#c4532f', size: 0.02, shapes: [{ t: 'sphere', r: 0.08, pos: [0, 0, -2.0] }] },
        { id: 'jupiter', label: 'Jupiter', say: 'Jupiter is the biggest planet, a giant ball of gas with a great red storm.', color: '#d8a878', size: 0.1, shapes: [{ t: 'sphere', r: 0.3, pos: [2.6, 0, 0] }] },
        { id: 'saturn', label: 'Saturn', say: 'Saturn is a gas giant with wide rings of ice and rock.', color: '#e4cf94', size: 0.09, shapes: [{ t: 'sphere', r: 0.24, pos: [0, 0, 3.15] }, { t: 'torus', r: 0.4, tube: 0.05, axis: 'y', pos: [0, 0, 3.15], color: '#cdb98a' }] },
        { id: 'uranus', label: 'Uranus', say: 'Uranus is an ice giant that spins on its side.', color: '#8fd8e0', size: 0.05, shapes: [{ t: 'sphere', r: 0.17, pos: [-3.65, 0, 0] }] },
        { id: 'neptune', label: 'Neptune', say: 'Neptune is the farthest planet, a cold, windy ice giant.', color: '#4a6fe0', size: 0.05, shapes: [{ t: 'sphere', r: 0.16, pos: [0, 0, -4.1] }] },
      ],
    },
  },
  {
    key: 'atom', is: /\b(atoms?|atomic structure|parts of an atom|atomo)\b/i, not: /\b(atomic bomb|atom bomb)\b/i,
    '3d': {
      title: 'Inside an atom', mode: '3d', axis: 'x',
      intro: 'An atom has a tiny nucleus of protons and neutrons, with electrons moving around it in shells.',
      summary: 'Protons (positive) and neutrons (no charge) sit in the nucleus; electrons (negative) move in shells around it. This is carbon: 6 of each.',
      photo: 'a scientific model of a carbon atom',
      next: ['Why do electrons stay near the nucleus?', 'What makes one element different from another?'],
      parts: [
        { id: 'protons', label: 'Protons', say: 'Protons have a positive charge. Their number decides which element it is: carbon has 6.', color: '#e05555', size: 0.06, inside: 'nucleus',
          shapes: [[0.09, 0.05, 0.04], [-0.08, 0.09, -0.03], [0.02, -0.1, 0.07], [-0.06, -0.05, -0.09], [0.07, 0.08, -0.09], [-0.1, 0, 0.08]].map((p) => ({ t: 'sphere', r: 0.085, pos: p })) },
        { id: 'neutrons', label: 'Neutrons', say: 'Neutrons have no charge. They sit with the protons in the nucleus.', color: '#9aa0aa', size: 0.06, inside: 'nucleus',
          shapes: [[-0.02, 0.1, 0.1], [0.1, -0.07, -0.04], [-0.09, -0.09, 0.03], [0.03, 0.02, -0.12], [0.11, 0.06, 0.08], [-0.04, 0.04, -0.01]].map((p) => ({ t: 'sphere', r: 0.085, pos: p })) },
        { id: 'shells', label: 'Electron shells', say: 'Electrons move in shells around the nucleus: 2 in the first, 4 in the second for carbon.', color: '#6a8ad0', size: 1, spin: true,
          shapes: [{ t: 'torus', r: 0.9, tube: 0.008, axis: 'y', pos: [0, 0, 0] }, { t: 'torus', r: 1.7, tube: 0.008, axis: 'y', pos: [0, 0, 0] }] },
        { id: 'electrons', label: 'Electrons', say: 'Electrons have a negative charge and are about 2000 times lighter than a proton.', color: '#4ad0ff', glow: true, size: 0.03,
          shapes: [[0.9, 0, 0], [-0.9, 0, 0], [1.7, 0, 0], [-1.7, 0, 0], [0, 0, 1.7], [0, 0, -1.7]].map((p) => ({ t: 'sphere', r: 0.06, pos: p })) },
        { id: 'nucleus', label: 'Nucleus', say: 'The nucleus is the tiny, heavy centre of the atom. Almost all its mass is here.', color: '#f0c060', size: 0.1, shell: true,
          shapes: [{ t: 'sphere', r: 0.26, pos: [0, 0, 0] }] },
      ],
    },
  },
  {
    key: 'heart', is: /\b(heart|hearts|puso)\b/i, not: /\b(valentine|symbol|emoji|love|card|heart ?rate|heartbeat on)\b/i,
    '2d': {"answer": "The heart is a muscle that pumps blood in two loops, to the lungs and around the body. Blood comes in through the top chambers and leaves through the bottom ones.", "about": [0.03, 0.13, 0.56, 0.08], "title": "How the human heart works", "mode": "2d", "layout": "a large front view of the heart in the middle; the top chambers at the top, the big left ventricle on the right of the picture, the right ventricle on the left; the vessels rise from the top; names on both sides", "intro": "A heart is soft and alive, so I drew it flat instead of in 3D. Let's trace the blood through it.", "summary": "Blood enters the atria, the ventricles pump it out, and the great vessels carry it to the lungs and the body.", "parts": [{"id": "wall", "label": "Heart wall", "say": "This is the outer wall of the heart. It is a strong muscle that keeps working all your life.", "color": "#e8a0a0", "box": [130, 56, 164, 180], "anchor": [132, 130], "shapes": [{"t": "path", "d": "M200 232 C150 216 130 172 132 130 C134 90 160 62 190 58 C210 56 222 66 230 72 C246 60 270 58 282 80 C294 104 292 150 270 186 C252 214 226 232 200 232 Z", "fill": true}, {"t": "path", "d": "M150 170 Q200 182 262 166"}, {"t": "path", "d": "M268 120 Q262 150 256 170"}, {"t": "path", "d": "M140 130 Q146 150 152 166"}]}, {"id": "atria", "label": "Atria", "say": "The two top chambers, the atria, receive blood coming back to the heart through the vena cava.", "color": "#c9a7ff", "box": [146, 62, 122, 40], "anchor": [174, 82], "shapes": [{"t": "path", "d": "M150 82 C160 66 186 66 194 80 C186 96 162 98 150 82 Z", "fill": true}, {"t": "path", "d": "M214 78 C224 64 252 64 260 80 C250 94 224 94 214 78 Z", "fill": true}, {"t": "path", "d": "M170 74 Q180 82 192 76"}, {"t": "path", "d": "M150 90 Q146 80 156 72"}, {"t": "path", "d": "M262 86 Q268 96 262 100"}]}, {"id": "rv", "label": "Right ventricle", "say": "The right ventricle pumps blood to the lungs to pick up oxygen.", "color": "#7fb0ff", "box": [142, 92, 56, 128], "anchor": [160, 150], "shapes": [{"t": "path", "d": "M160 96 C146 120 144 160 150 190 C158 210 178 216 196 218 C196 180 190 130 160 96 Z", "fill": true}, {"t": "path", "d": "M170 130 Q176 150 168 180"}, {"t": "path", "d": "M152 150 Q170 160 186 150"}, {"t": "path", "d": "M160 200 Q176 206 192 202"}]}, {"id": "lv", "label": "Left ventricle", "say": "The left ventricle has the thickest wall and pumps blood to the whole body.", "color": "#ff8a8a", "box": [208, 88, 62, 136], "anchor": [246, 150], "shapes": [{"t": "path", "d": "M230 90 C262 100 272 150 262 190 C254 214 230 220 210 224 C214 190 216 130 230 90 Z", "fill": true}, {"t": "path", "d": "M236 110 Q240 150 232 190"}, {"t": "path", "d": "M250 130 Q246 160 252 186"}, {"t": "path", "d": "M226 170 Q240 176 252 168"}]}, {"id": "septum", "label": "Septum", "say": "The septum is the wall that keeps the left and right sides apart.", "color": "#ffb067", "box": [196, 88, 16, 134], "anchor": [202, 150], "shapes": [{"t": "path", "d": "M198 92 C194 140 200 180 206 220 L212 220 C206 180 204 130 206 92 Z", "fill": true}, {"t": "path", "d": "M202 96 C198 140 204 180 209 218"}, {"t": "path", "d": "M196 92 Q202 84 210 90"}]}, {"id": "vessels", "label": "Great vessels", "say": "The aorta carries oxygen rich blood out to the body. The pulmonary artery carries blood to the lungs.", "color": "#ff5a5a", "box": [136, 26, 134, 58], "anchor": [236, 38], "shapes": [{"t": "path", "d": "M212 72 C214 40 232 28 248 32 C262 36 266 56 262 72"}, {"t": "path", "d": "M200 66 C196 40 184 34 166 30"}, {"t": "path", "d": "M152 78 L138 44"}, {"t": "path", "d": "M250 34 L252 18"}]}, {"id": "flow", "label": "Blood flow", "say": "Arrows show the path. Blood enters the right atrium, goes to the lungs, comes back to the left atrium, then leaves through the aorta. Valves between the chambers keep it flowing one way.", "color": "#5ac8fa", "box": [116, 14, 178, 98], "anchor": [120, 70], "shapes": [{"t": "arrow", "x1": 120, "y1": 70, "x2": 148, "y2": 86}, {"t": "arrow", "x1": 176, "y1": 100, "x2": 178, "y2": 62}, {"t": "arrow", "x1": 168, "y1": 40, "x2": 146, "y2": 22}, {"t": "arrow", "x1": 250, "y1": 30, "x2": 290, "y2": 16}, {"t": "arrow", "x1": 242, "y1": 90, "x2": 242, "y2": 112}, {"t": "arrow", "x1": 172, "y1": 88, "x2": 172, "y2": 112}]}], "next": ["Why is the left ventricle wall the thickest?", "What do the valves stop the blood from doing?"]},
  },
  {
    key: 'water', is: /\bwater cycle\b|\bhydrologic(al)? cycle\b|\bsiklo ng tubig\b/i,
    '2d': {"title": "The water cycle", "mode": "2d", "layout": "the sea along the bottom, a hill on the right, the sun top right, a cloud in the middle top", "intro": "Water keeps moving between the sea, the sky and the land.", "summary": "Evaporate, condense, fall, collect, and it starts again.", "photo": "a real landscape with the sea, a hill, clouds and rain falling, on a sunny day", "parts": [{"id": "sea", "label": "Ocean", "say": "Most water is in the oceans, lakes and rivers.", "color": "#7fb0ff", "box": [10, 206, 380, 46], "shapes": [{"t": "path", "d": "M10 222 Q60 210 110 222 T210 222 T310 222 T390 222", "fill": false}, {"t": "path", "d": "M10 222 L10 250 L390 250 L390 222", "fill": false}], "anchor": [200, 236]}, {"id": "sun", "label": "Sun", "say": "The sun heats the water.", "color": "#ffd29e", "box": [318, 24, 64, 64], "shapes": [{"t": "circle", "cx": 350, "cy": 56, "r": 20, "fill": true}, {"t": "line", "x1": 350, "y1": 28, "x2": 350, "y2": 20}, {"t": "line", "x1": 322, "y1": 56, "x2": 314, "y2": 56}, {"t": "line", "x1": 330, "y1": 36, "x2": 324, "y2": 30}], "anchor": [350, 56]}, {"id": "evap", "label": "Evaporation", "say": "Warm water turns into vapour and rises.", "color": "#8fe0b0", "box": [100, 110, 70, 96], "shapes": [{"t": "arrow", "x1": 112, "y1": 204, "x2": 112, "y2": 116}, {"t": "arrow", "x1": 136, "y1": 204, "x2": 136, "y2": 116}, {"t": "arrow", "x1": 160, "y1": 204, "x2": 160, "y2": 116}], "anchor": [136, 160]}, {"id": "cloud", "label": "Condensation", "say": "High up the vapour cools into tiny drops: clouds.", "color": "#a3a3ad", "box": [150, 40, 124, 48], "shapes": [{"t": "path", "d": "M154 84 Q150 62 172 62 Q178 42 202 48 Q222 36 238 54 Q264 54 266 72 Q272 86 254 86 Z", "fill": true}, {"t": "path", "d": "M182 70 Q194 62 206 70"}], "anchor": [210, 66]}, {"id": "rain", "label": "Precipitation", "say": "When the drops get heavy they fall as rain.", "color": "#7ee0e0", "box": [176, 92, 80, 40], "shapes": [{"t": "line", "x1": 190, "y1": 94, "x2": 184, "y2": 124, "dash": true}, {"t": "line", "x1": 214, "y1": 94, "x2": 208, "y2": 124, "dash": true}, {"t": "line", "x1": 238, "y1": 94, "x2": 232, "y2": 124, "dash": true}], "anchor": [214, 108]}, {"id": "runoff", "label": "Runoff", "say": "Rain runs down the land back to the sea.", "color": "#c9a7ff", "box": [240, 140, 140, 82], "shapes": [{"t": "path", "d": "M244 220 L300 148 L372 220"}, {"t": "arrow", "x1": 326, "y1": 190, "x2": 272, "y2": 216}], "anchor": [330, 190]}], "next": ["Why does the water vapour cool into clouds?", "Where does the rain go after it falls?"]},
  },
  {
    key: 'photosynthesis', is: /\bphotosynthesis\b|\bpotosintesis\b/i,
    '2d': {"title": "How photosynthesis works", "mode": "2d", "layout": "a leaf in the middle on its stem; the sun top left; CO2 coming in from the left; water rising from the roots; O2 leaving top right; glucose bottom right", "intro": "A leaf makes its own food from light, air and water.", "summary": "Light, carbon dioxide and water make glucose and release oxygen in the chloroplast.", "photo": "a real green leaf on a plant in bright sunlight, close up, showing its veins", "parts": [{"id": "sun", "label": "Sunlight", "say": "Sunlight gives the leaf the energy it needs.", "color": "#ffd29e", "box": [30, 30, 126, 78], "anchor": [54, 54], "shapes": [{"t": "circle", "cx": 54, "cy": 54, "r": 18, "fill": true}, {"t": "line", "x1": 54, "y1": 28, "x2": 54, "y2": 20}, {"t": "line", "x1": 28, "y1": 54, "x2": 20, "y2": 54}, {"t": "line", "x1": 36, "y1": 36, "x2": 30, "y2": 30}, {"t": "arrow", "x1": 76, "y1": 66, "x2": 152, "y2": 104}]}, {"id": "leaf", "label": "Leaf", "say": "The leaf is a thin green blade with veins that carry water and food.", "color": "#8fe0b0", "box": [136, 70, 200, 170], "anchor": [214, 170], "shapes": [{"t": "path", "d": "M150 190 C170 120 250 70 330 80 C320 150 250 200 150 190 Z", "fill": true}, {"t": "path", "d": "M150 190 Q240 140 330 80"}, {"t": "line", "x1": 200, "y1": 160, "x2": 204, "y2": 132}, {"t": "line", "x1": 200, "y1": 160, "x2": 226, "y2": 178}, {"t": "line", "x1": 250, "y1": 128, "x2": 252, "y2": 100}, {"t": "line", "x1": 250, "y1": 128, "x2": 282, "y2": 146}, {"t": "line", "x1": 150, "y1": 190, "x2": 140, "y2": 236}]}, {"id": "chloro", "label": "Chloroplast", "say": "Inside the leaf cells, chloroplasts catch the light with green chlorophyll.", "color": "#7ee0e0", "box": [244, 108, 36, 24], "anchor": [262, 120], "shapes": [{"t": "ellipse", "cx": 262, "cy": 120, "rx": 16, "ry": 9, "fill": true}, {"t": "path", "d": "M251 117 L273 117"}, {"t": "path", "d": "M251 123 L273 123"}]}, {"id": "co2", "label": "Carbon dioxide in", "say": "Carbon dioxide from the air enters through tiny holes called stomata.", "color": "#a3a3ad", "box": [16, 130, 148, 40], "anchor": [90, 152], "shapes": [{"t": "text", "x": 20, "y": 142, "text": "CO2"}, {"t": "arrow", "x1": 20, "y1": 152, "x2": 160, "y2": 152}, {"t": "arrow", "x1": 20, "y1": 164, "x2": 154, "y2": 164}]}, {"id": "water", "label": "Water from roots", "say": "The roots take in water, and it travels up the stem to the leaf.", "color": "#7fb0ff", "box": [118, 196, 48, 60], "anchor": [147, 216], "shapes": [{"t": "path", "d": "M140 236 L124 252"}, {"t": "path", "d": "M140 236 L156 252"}, {"t": "path", "d": "M140 236 L140 254"}, {"t": "arrow", "x1": 147, "y1": 234, "x2": 147, "y2": 198}, {"t": "text", "x": 152, "y": 230, "text": "H2O"}]}, {"id": "o2", "label": "Oxygen out", "say": "Oxygen is made and leaves the leaf into the air.", "color": "#c9a7ff", "box": [296, 20, 92, 80], "anchor": [360, 34], "shapes": [{"t": "arrow", "x1": 300, "y1": 96, "x2": 352, "y2": 44}, {"t": "circle", "cx": 360, "cy": 34, "r": 6}, {"t": "circle", "cx": 374, "cy": 30, "r": 6}, {"t": "text", "x": 352, "y": 58, "text": "O2"}]}, {"id": "gluc", "label": "Glucose", "say": "Glucose, a sugar, is the food the plant makes and uses to grow.", "color": "#ffb067", "box": [268, 126, 100, 104], "anchor": [330, 193], "shapes": [{"t": "arrow", "x1": 270, "y1": 128, "x2": 318, "y2": 182}, {"t": "poly", "pts": [[318, 186], [330, 180], [342, 186], [342, 200], [330, 206], [318, 200], [318, 186]], "fill": true}, {"t": "text", "x": 296, "y": 226, "text": "C6H12O6"}]}], "next": ["What does the chloroplast do with the light?", "Why does the plant need carbon dioxide?"]},
  },
  {
    key: 'volcano', is: /\bvolcano(es)?\b|\bbulkan\b|\berupt(s|ion)?\b/i,
    '2d': {"answer": "A volcano erupts when hot magma from deep underground rises through a vent, and gas pushes it out as lava, ash and steam.", "about": null, "title": "How a volcano erupts", "mode": "2d", "layout": "a volcano cross section in the middle on the ground line at y 242; the magma chamber deep below the vent; lava flowing down the right slope; the ash cloud and gas rising above the crater", "intro": "Let's look at the inside of a volcano to see how it erupts.", "summary": "Magma gathers in the chamber, rises through the vent, and erupts as lava, gas and ash.", "parts": [{"id": "cone", "label": "Volcano cone", "say": "The cone is built up from layers of hardened lava and ash.", "color": "#b07a5a", "box": [60, 108, 280, 134], "anchor": [200, 180], "shapes": [{"t": "path", "d": "M60 242 L170 110 L230 110 L340 242 Z", "fill": true}, {"t": "path", "d": "M60 242 Q120 200 170 110"}, {"t": "path", "d": "M340 242 Q280 200 230 110"}, {"t": "line", "x1": 40, "y1": 242, "x2": 360, "y2": 242}, {"t": "path", "d": "M96 242 Q150 214 200 226 Q250 214 304 242"}, {"t": "path", "d": "M130 200 Q160 190 180 204"}, {"t": "path", "d": "M262 196 Q290 186 306 206"}, {"t": "path", "d": "M100 228 Q120 222 140 228"}, {"t": "path", "d": "M250 226 Q270 220 290 228"}, {"t": "path", "d": "M180 170 Q196 164 212 170"}]}, {"id": "vent", "label": "Vent and crater", "say": "The vent is a pipe that carries magma up to the crater at the top.", "color": "#ff9f5a", "box": [176, 106, 48, 110], "anchor": [200, 130], "shapes": [{"t": "poly", "pts": [[170, 110], [178, 122], [190, 116], [200, 124], [210, 116], [222, 122], [230, 110]], "fill": true}, {"t": "line", "x1": 192, "y1": 124, "x2": 192, "y2": 200}, {"t": "line", "x1": 208, "y1": 124, "x2": 208, "y2": 200}, {"t": "path", "d": "M192 200 Q200 206 208 200"}, {"t": "arrow", "x1": 200, "y1": 196, "x2": 200, "y2": 130}]}, {"id": "chamber", "label": "Magma chamber", "say": "Deep underground, a pool of hot melted rock called magma builds up.", "color": "#ff8a5b", "box": [156, 190, 88, 42], "anchor": [200, 210], "shapes": [{"t": "ellipse", "cx": 200, "cy": 210, "rx": 44, "ry": 20, "fill": true}, {"t": "path", "d": "M170 210 Q200 198 230 210"}, {"t": "path", "d": "M172 218 Q200 226 228 218"}]}, {"id": "lava", "label": "Lava flow", "say": "Melted rock pours out of the crater and runs down the slope as lava.", "color": "#ff6a3d", "box": [226, 116, 96, 126], "anchor": [262, 184], "shapes": [{"t": "path", "d": "M230 118 Q250 140 246 166 Q262 182 262 200 Q280 214 294 240 L306 240 Q290 206 274 194 Q270 176 256 164 Q262 140 240 116 Z", "fill": true}, {"t": "arrow", "x1": 260, "y1": 150, "x2": 276, "y2": 176}, {"t": "arrow", "x1": 286, "y1": 200, "x2": 300, "y2": 224}]}, {"id": "ash", "label": "Ash cloud", "say": "Tiny bits of ash are blown high into the sky and spread out like a cloud.", "color": "#a3a3ad", "box": [130, 22, 150, 52], "anchor": [210, 50], "shapes": [{"t": "path", "d": "M140 70 Q132 52 152 48 Q156 26 180 30 Q196 20 214 32 Q238 26 246 44 Q270 46 268 66 Q272 74 256 74 Z", "fill": true}, {"t": "path", "d": "M166 52 Q180 42 196 52"}, {"t": "path", "d": "M222 58 Q238 50 252 60"}, {"t": "path", "d": "M150 62 Q160 56 170 62"}]}, {"id": "gas", "label": "Gas and steam", "say": "Gases like steam push upward and help force the magma out of the vent.", "color": "#7fb0ff", "box": [146, 70, 110, 36], "anchor": [200, 84], "shapes": [{"t": "arrow", "x1": 200, "y1": 104, "x2": 200, "y2": 74}, {"t": "arrow", "x1": 186, "y1": 104, "x2": 166, "y2": 80}, {"t": "arrow", "x1": 214, "y1": 104, "x2": 236, "y2": 80}, {"t": "circle", "cx": 252, "cy": 92, "r": 4, "fill": true}, {"t": "circle", "cx": 150, "cy": 98, "r": 5, "fill": true}]}], "next": ["What is inside the magma chamber?", "Why do some volcanoes explode and others ooze lava?"]},
  },
  {
    key: 'jet', is: /\bjet engines?\b|\bjet works?\b|\bturbofan\b|\bhow (does|do) (a )?jets? work/i,
    '3d': {"answer": "A jet engine pulls air in, squeezes it, burns fuel in it and shoots the hot gas out the back.", "about": [0.02, 0.2, 0.24, 0.42], "title": "How a jet engine works", "mode": "3d", "axis": "x", "intro": "I can see pictures of jets. This page does not explain their engines, so here is one, built part by part.", "summary": "Air in, squeeze, burn, spin, push.", "parts": [{"id": "case", "label": "Casing", "say": "The casing holds everything and guides the air.", "color": "#b9bec8", "shell": true, "size": 1, "inside": null, "attached": [], "shapes": [{"t": "cylinder", "r": 1.05, "r2": 0.92, "len": 5.4, "axis": "x", "pos": [0, 0, 0], "open": true}, {"t": "torus", "r": 1.05, "tube": 0.07, "axis": "x", "pos": [-2.7, 0, 0]}]}, {"id": "fan", "label": "Fan", "say": "The big fan at the front pulls air in.", "color": "#7fb0ff", "spin": true, "size": 0.35, "inside": "case", "attached": [], "shapes": [{"t": "blades", "n": 18, "len": 0.85, "width": 0.22, "hub": 0.12, "axis": "x", "pos": [-2.3, 0, 0]}, {"t": "cone", "r": 0.3, "len": 0.6, "axis": "x", "dir": -1, "pos": [-2.5, 0, 0]}]}, {"id": "comp", "label": "Compressor", "say": "Rows of small blades squeeze the air tight.", "color": "#a3c9ff", "spin": true, "size": 0.3, "inside": "case", "attached": [], "shapes": [{"t": "disc", "r": 0.78, "thick": 0.08, "axis": "x", "pos": [-1.5, 0, 0]}, {"t": "disc", "r": 0.71, "thick": 0.08, "axis": "x", "pos": [-1.3, 0, 0]}, {"t": "disc", "r": 0.64, "thick": 0.08, "axis": "x", "pos": [-1.1, 0, 0]}, {"t": "disc", "r": 0.57, "thick": 0.08, "axis": "x", "pos": [-0.9, 0, 0]}, {"t": "disc", "r": 0.5, "thick": 0.08, "axis": "x", "pos": [-0.7, 0, 0]}]}, {"id": "comb", "label": "Combustor", "say": "Fuel sprays into the squeezed air and burns.", "color": "#ffb067", "glow": true, "size": 0.25, "inside": "case", "attached": [], "shapes": [{"t": "torus", "r": 0.5, "tube": 0.2, "axis": "x", "pos": [0.1, 0, 0]}, {"t": "cone", "r": 0.28, "len": 0.9, "axis": "x", "pos": [0.55, 0, 0], "color": "#ff7a59"}]}, {"id": "turb", "label": "Turbine", "say": "The hot gas spins the turbine, which turns the fan.", "color": "#ffd29e", "spin": true, "size": 0.25, "inside": "case", "attached": [], "shapes": [{"t": "disc", "r": 0.6, "thick": 0.09, "axis": "x", "pos": [1.1, 0, 0]}, {"t": "disc", "r": 0.65, "thick": 0.09, "axis": "x", "pos": [1.32, 0, 0]}, {"t": "disc", "r": 0.7, "thick": 0.09, "axis": "x", "pos": [1.54, 0, 0]}]}, {"id": "noz", "label": "Nozzle", "say": "The gas shoots out the back and pushes the plane forward.", "color": "#c8ccd4", "size": 0.2, "inside": "case", "attached": [], "shapes": [{"t": "cone", "r": 0.42, "len": 1, "axis": "x", "pos": [2.3, 0, 0]}]}, {"id": "gas", "label": "Hot gas out", "say": "That push is called thrust.", "color": "#e5484d", "size": 0.22, "inside": null, "attached": ["noz"], "shapes": [{"t": "arrow", "pts": [[2.85, 0, 0], [4.0, 0, 0]], "r": 0.07}]}], "next": ["How does the compressor squeeze the air?", "What turns the turbine?"]},
  },
];

const words = (q) => String(q || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(ASKING, ' ').split(/\s+/).filter(Boolean);

// the book's drawing for a question, or null. want3d: the student asked for 3D (a 3D model when the book has one,
// else its flat drawing); otherwise a flat drawing, or the model when the book only has the model.
export function fromBook(question, want3d = false) {
  const q = String(question || '');
  if (q.length > 160) return null;
  for (const e of BOOK) {
    if (!e.is.test(q) || (e.not && e.not.test(q))) continue;
    const left = words(q.replace(new RegExp(e.is.source, 'gi'), ' ')).filter((w) => w.length > 2);
    if (left.length) return null; // (a narrow question, about one part or for a project: the AI's, which can focus on it)
    const spec = (want3d && e['3d']) || e['2d'] || e['3d'];
    return spec ? JSON.parse(JSON.stringify({ ...spec, book: e.key })) : null;
  }
  return null;
}
export const bookKeys = () => BOOK.map((e) => e.key);
