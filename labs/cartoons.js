/* (v285) Cartoon drawings for the games: the habitat animals, their homes, and faces for the sorter's shapes.
   Flat, round and outlined, with big eyes (like a picture book), drawn in SVG: nothing to download. */
const OL = 'stroke="#2b2440" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"';
const eye = (x, y, r = 3.2) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#1d1a2b"/><circle cx="${x + r * 0.35}" cy="${y - r * 0.35}" r="${r * 0.36}" fill="#fff"/>`;
const eyes = (x1, x2, y, r) => eye(x1, y, r) + eye(x2, y, r);
const cheeks = (x1, x2, y) => `<ellipse cx="${x1}" cy="${y}" rx="3.2" ry="2" fill="#ff8fa3" opacity=".75"/><ellipse cx="${x2}" cy="${y}" rx="3.2" ry="2" fill="#ff8fa3" opacity=".75"/>`;
const smile = (x, y, w = 4) => `<path d="M${x - w} ${y}q${w} ${w * 0.9} ${w * 2} 0" fill="none" stroke="#2b2440" stroke-width="2" stroke-linecap="round"/>`;

// 64 x 64 each
export const ANIMAL_ART = {
  polarbear: `<ellipse cx="32" cy="51" rx="19" ry="10" fill="#f4f1ea" ${OL}/><circle cx="19" cy="16" r="5.5" fill="#f4f1ea" ${OL}/><circle cx="45" cy="16" r="5.5" fill="#f4f1ea" ${OL}/><circle cx="19" cy="16" r="2.4" fill="#d9d1c2"/><circle cx="45" cy="16" r="2.4" fill="#d9d1c2"/>
    <circle cx="32" cy="29" r="16" fill="#f4f1ea" ${OL}/><ellipse cx="32" cy="36" rx="8" ry="6" fill="#fff" ${OL}/><ellipse cx="32" cy="32.5" rx="3.2" ry="2.2" fill="#2b2440"/>${eyes(25.5, 38.5, 26)}${cheeks(21, 43, 33)}${smile(32, 38, 2.5)}`,
  penguin: `<ellipse cx="25" cy="58" rx="5" ry="2.6" fill="#f2a33a" ${OL}/><ellipse cx="39" cy="58" rx="5" ry="2.6" fill="#f2a33a" ${OL}/><path d="M16 34c-5 4-6 10-4 14 3-2 5-6 6-10zM48 34c5 4 6 10 4 14-3-2-5-6-6-10z" fill="#23263a" ${OL}/>
    <ellipse cx="32" cy="34" rx="16" ry="23" fill="#23263a" ${OL}/><path d="M32 18c8 0 12 7 11 16-1 11-5 18-11 18s-10-7-11-18c-1-9 3-16 11-16z" fill="#fff"/>${eyes(27, 37, 26, 3)}<path d="M28.5 31h7l-3.5 4.5z" fill="#f2a33a" ${OL}/>${cheeks(23, 41, 33)}`,
  camel: `<path d="M20 46v13M28 47v12M42 47v12M50 46v13" stroke="#2b2440" stroke-width="6.5" stroke-linecap="round"/><path d="M20 46v12M28 47v11M42 47v11M50 46v12" stroke="#d9a35f" stroke-width="3.6" stroke-linecap="round"/>
    <path d="M16 46c0-8 4-12 10-12 2-8 5-11 8-11s5 5 6 9c1-4 3-7 6-7s6 4 7 11c3 2 4 6 3 10-1 3-4 4-6 4H21c-3 0-5-1-5-4z" fill="#d9a35f" ${OL}/>
    <path d="M20 40c-3-6-4-14-5-20" stroke="#2b2440" stroke-width="9" stroke-linecap="round"/><path d="M20 40c-3-6-4-14-5-20" stroke="#d9a35f" stroke-width="5" stroke-linecap="round"/>
    <ellipse cx="13" cy="17" rx="9" ry="7" fill="#d9a35f" ${OL}/><ellipse cx="7" cy="19" rx="4" ry="3.5" fill="#e8bf86" ${OL}/><path d="M16 10l2-4 2 5" fill="#d9a35f" ${OL}/>${eye(14, 15, 2.6)}<circle cx="5.5" cy="18.5" r=".9" fill="#2b2440"/>`,
  scorpion: `<path d="M38 42c8 0 14-4 15-12s-4-14-10-13" fill="none" stroke="#2b2440" stroke-width="8" stroke-linecap="round"/><path d="M38 42c8 0 14-4 15-12s-4-14-10-13" fill="none" stroke="#e07a3c" stroke-width="4.5" stroke-linecap="round"/><path d="M43 17l-6-1 4-5z" fill="#e07a3c" ${OL}/>
    <path d="M18 50l-6 6M22 52l-3 7M38 50l6 6M34 52l3 7" stroke="#2b2440" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M14 38l-6-7M42 38l6-7" stroke="#2b2440" stroke-width="2.6" stroke-linecap="round"/><path d="M4 26c0-4 6-5 7 0l-3 4zM52 26c0-4-6-5-7 0l3 4z" fill="#e07a3c" ${OL}/>
    <ellipse cx="28" cy="44" rx="15" ry="10" fill="#e07a3c" ${OL}/>${eyes(23, 33, 41, 3)}${cheeks(19, 37, 47)}${smile(28, 47, 2.5)}`,
  monkey: `<path d="M46 52c10 0 12-10 6-12" fill="none" stroke="#2b2440" stroke-width="6" stroke-linecap="round"/><path d="M46 52c10 0 12-10 6-12" fill="none" stroke="#8a5a3b" stroke-width="2.8" stroke-linecap="round"/>
    <ellipse cx="32" cy="54" rx="13" ry="8" fill="#8a5a3b" ${OL}/><circle cx="13" cy="28" r="7" fill="#8a5a3b" ${OL}/><circle cx="51" cy="28" r="7" fill="#8a5a3b" ${OL}/><circle cx="13" cy="28" r="3.5" fill="#f0c9a0"/><circle cx="51" cy="28" r="3.5" fill="#f0c9a0"/>
    <circle cx="32" cy="28" r="17" fill="#8a5a3b" ${OL}/><path d="M32 22c3-4 10-4 11 2 2 6-1 15-11 15S19 30 21 24c1-6 8-6 11-2z" fill="#f0c9a0" ${OL}/>${eyes(26.5, 37.5, 26, 3)}<ellipse cx="32" cy="31" rx="2" ry="1.3" fill="#2b2440"/>${smile(32, 34, 3)}`,
  parrot: `<path d="M6 56h52" stroke="#6b4a2b" stroke-width="5" stroke-linecap="round"/><path d="M30 50l-4 10M38 50l6 9" stroke="#2b2440" stroke-width="3" stroke-linecap="round"/><path d="M30 48c-2 6 0 12 2 14l4-8z" fill="#2f6fd6" ${OL}/>
    <ellipse cx="34" cy="38" rx="13" ry="16" fill="#e5484d" ${OL}/><path d="M38 30c8 2 10 12 6 20-5-1-9-8-6-20z" fill="#2f6fd6" ${OL}/><path d="M41 38c3 2 4 6 3 10" fill="none" stroke="#f2c200" stroke-width="3" stroke-linecap="round"/>
    <circle cx="30" cy="20" r="12" fill="#e5484d" ${OL}/><ellipse cx="27" cy="19" rx="6" ry="5.5" fill="#fff"/>${eye(27, 19, 3)}<path d="M18 21c-4 1-5 6-2 9 2-3 4-3 6-4z" fill="#f2c200" ${OL}/>${cheeks(34, 34, 27)}`,
  whale: `<path d="M6 10c0 4 2 6 4 6M12 6v8M18 10c0 4-2 6-4 6" fill="none" stroke="#7fc7ff" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M50 38c4-6 10-9 12-8-2 5-4 7-7 8 3 1 5 4 6 8-4 0-8-2-11-6z" fill="#4a7fd6" ${OL}/>
    <path d="M4 38c0-12 10-20 24-20s24 8 24 18c0 10-10 18-26 18C12 54 4 48 4 38z" fill="#4a7fd6" ${OL}/><path d="M7 44c6 6 14 8 22 8 10 0 17-3 21-8-6 2-14 3-22 3-8 0-15-1-21-3z" fill="#bfe0ff"/>${eye(18, 34, 3)}${cheeks(12, 26, 40)}${smile(18, 41, 3)}`,
  octopus: `<path d="M14 40c-6 6-8 14-4 16M22 44c-2 8-2 12 2 14M32 45c0 8 0 12 0 14M42 44c2 8 2 12-2 14M50 40c6 6 8 14 4 16" fill="none" stroke="#2b2440" stroke-width="8" stroke-linecap="round"/>
    <path d="M14 40c-6 6-8 14-4 16M22 44c-2 8-2 12 2 14M32 45c0 8 0 12 0 14M42 44c2 8 2 12-2 14M50 40c6 6 8 14 4 16" fill="none" stroke="#9b5ad1" stroke-width="4.4" stroke-linecap="round"/>
    <path d="M10 30C10 16 20 6 32 6s22 10 22 24c0 10-8 16-22 16S10 40 10 30z" fill="#9b5ad1" ${OL}/><circle cx="24" cy="14" r="2.5" fill="#c79cf0"/><circle cx="40" cy="12" r="1.8" fill="#c79cf0"/>${eyes(25, 39, 28, 3.6)}${cheeks(19, 45, 35)}${smile(32, 36, 3)}`,
  lion: `<g fill="#c9762e" ${OL}><circle cx="32" cy="30" r="24"/></g><g fill="#c9762e">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => { const a = (k / 10) * Math.PI * 2; return `<circle cx="${(32 + Math.cos(a) * 22).toFixed(1)}" cy="${(30 + Math.sin(a) * 22).toFixed(1)}" r="6"/>`; }).join('')}</g>
    <circle cx="20" cy="15" r="5" fill="#f2b84b" ${OL}/><circle cx="44" cy="15" r="5" fill="#f2b84b" ${OL}/><circle cx="32" cy="31" r="16" fill="#f2b84b" ${OL}/><ellipse cx="32" cy="38" rx="8" ry="6" fill="#fde3a7"/>${eyes(26, 38, 28, 3)}<path d="M29 34h6l-3 3z" fill="#7a3e2b" ${OL}/>${cheeks(21, 43, 35)}${smile(32, 40, 2.5)}`,
  zebra: `<path d="M22 10l-3-8 7 5M42 10l3-8-7 5" fill="#f7f7f7" ${OL}/><path d="M24 8c2-4 6-6 8-6s6 2 8 6l-4 4h-8z" fill="#2b2440"/>
    <path d="M18 24c0-10 6-16 14-16s14 6 14 16v14H18z" fill="#f7f7f7" ${OL}/><path d="M19 17h6M38 17h6M28 12h8M30 20h4" stroke="#2b2440" stroke-width="3" stroke-linecap="round"/>
    <path d="M18 36c0-4 6-6 14-6s14 2 14 6v8c0 8-6 14-14 14s-14-6-14-14z" fill="#f7f7f7" ${OL}/><path d="M18 40h6M40 40h6" stroke="#2b2440" stroke-width="3" stroke-linecap="round"/>
    <ellipse cx="32" cy="50" rx="11" ry="8" fill="#8f8a96" ${OL}/><ellipse cx="28" cy="50" rx="1.6" ry="2.2" fill="#2b2440"/><ellipse cx="36" cy="50" rx="1.6" ry="2.2" fill="#2b2440"/>${eyes(25, 39, 31, 3)}${cheeks(21, 43, 38)}`,
  frog: `<path d="M12 56c-4 0-6-3-4-5l8-3M52 56c4 0 6-3 4-5l-8-3" fill="#4bb25a" ${OL}/>
    <path d="M8 42c0-12 10-20 24-20s24 8 24 20c0 9-10 16-24 16S8 51 8 42z" fill="#4bb25a" ${OL}/><ellipse cx="32" cy="48" rx="14" ry="7" fill="#b6e6a8"/>
    <circle cx="20" cy="22" r="9" fill="#4bb25a" ${OL}/><circle cx="44" cy="22" r="9" fill="#4bb25a" ${OL}/><circle cx="20" cy="22" r="5.5" fill="#fff"/><circle cx="44" cy="22" r="5.5" fill="#fff"/>${eyes(21, 45, 22, 3.4)}
    ${cheeks(15, 49, 38)}<path d="M20 38q12 9 24 0" fill="none" stroke="#2b2440" stroke-width="2.4" stroke-linecap="round"/>`,
  carabao: `<path d="M18 20C8 20 2 14 4 6c4 6 10 8 16 7M46 20c10 0 16-6 14-14-4 6-10 8-16 7" fill="#efe3c8" ${OL}/>
    <ellipse cx="12" cy="28" rx="7" ry="4" fill="#6f6a73" ${OL} transform="rotate(-20 12 28)"/><ellipse cx="52" cy="28" rx="7" ry="4" fill="#6f6a73" ${OL} transform="rotate(20 52 28)"/>
    <path d="M18 24c0-8 6-12 14-12s14 4 14 12v14c0 10-6 18-14 18s-14-8-14-18z" fill="#6f6a73" ${OL}/><path d="M26 16c2 2 4 3 6 3s4-1 6-3" fill="none" stroke="#2b2440" stroke-width="2" stroke-linecap="round"/>
    <ellipse cx="32" cy="48" rx="11" ry="8" fill="#a8a2ad" ${OL}/><ellipse cx="28" cy="48" rx="1.7" ry="2.3" fill="#2b2440"/><ellipse cx="36" cy="48" rx="1.7" ry="2.3" fill="#2b2440"/>${eyes(25.5, 38.5, 30, 3)}${cheeks(21, 43, 37)}`,
};

// 120 x 56 each: the animals' homes
export const HOME_ART = {
  polar: `<rect width="120" height="56" fill="#bfe3ff"/><circle cx="98" cy="13" r="7" fill="#fff6c9"/><path d="M0 40c14-8 30-10 44-4 14-10 34-12 50-4 10-4 20-4 26-2v26H0z" fill="#fff" stroke="#a9c9e6" stroke-width="1.5"/>
    <path d="M10 46l12-14 10 14z M70 44l10-16 12 16z" fill="#dff1ff" stroke="#9cc2e2" stroke-width="1.5" stroke-linejoin="round"/><path d="M24 12l2 2M26 12l-2 2M60 8l2 2M62 8l-2 2M40 20l2 2M42 20l-2 2" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`,
  desert: `<rect width="120" height="56" fill="#ffd9a0"/><circle cx="96" cy="14" r="9" fill="#ffb347" stroke="#f28c28" stroke-width="2"/>
    <path d="M0 40c20-10 40-10 60 0s40 10 60 0v16H0z" fill="#e8b36a"/><path d="M0 48c30-8 50-6 70 0s34 4 50 0v8H0z" fill="#d99a4e"/>
    <path d="M28 44V22c0-4 6-4 6 0v22M28 32h-5c-2 0-3-1-3-3v-5M34 30h5c2 0 3-1 3-3v-4" fill="none" stroke="#2b2440" stroke-width="6" stroke-linecap="round"/><path d="M28 44V22c0-4 6-4 6 0v22M28 32h-5c-2 0-3-1-3-3v-5M34 30h5c2 0 3-1 3-3v-4" fill="none" stroke="#4bb25a" stroke-width="3.4" stroke-linecap="round"/>`,
  forest: `<rect width="120" height="56" fill="#9fd8a8"/><path d="M0 56V30c8-6 14-6 20 0 6-8 16-8 22 0 6-6 14-6 20 0 6-8 16-8 22 0 6-6 14-6 20 0 6-6 12-6 16-2v28z" fill="#2e8a4a"/>
    <path d="M14 56V36M54 56V34M96 56V36" stroke="#6b4a2b" stroke-width="4"/><circle cx="14" cy="30" r="10" fill="#3fa55a"/><circle cx="54" cy="26" r="12" fill="#3fa55a"/><circle cx="96" cy="30" r="10" fill="#3fa55a"/>
    <path d="M34 0c0 10 4 14 2 22M76 0c0 8-4 12-2 18" fill="none" stroke="#2e8a4a" stroke-width="2.4" stroke-linecap="round"/><circle cx="64" cy="38" r="2.4" fill="#ff7a9a"/><circle cx="24" cy="42" r="2.4" fill="#ffcf5a"/>`,
  ocean: `<rect width="120" height="56" fill="#3f7fd1"/><rect width="120" height="14" fill="#9fd4ff"/><path d="M0 14c10-4 20 4 30 0s20 4 30 0 20 4 30 0 20 4 30 0v6H0z" fill="#5c9ae0"/>
    <path d="M0 56v-6c8-4 14-2 20 0s14 2 22-2c10-4 20 0 28 2s16 0 24-2 16 0 26 2v6z" fill="#e8c98e"/><path d="M90 50c-2-8 2-12 0-18M96 50c2-6-2-10 0-14" fill="none" stroke="#2e9e5b" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="22" cy="30" r="2.6" fill="none" stroke="#bfe0ff" stroke-width="1.4"/><circle cx="28" cy="24" r="1.8" fill="none" stroke="#bfe0ff" stroke-width="1.4"/><circle cx="62" cy="34" r="2.2" fill="none" stroke="#bfe0ff" stroke-width="1.4"/>`,
  grass: `<rect width="120" height="56" fill="#ffe2a8"/><circle cx="20" cy="14" r="8" fill="#ffb347"/><path d="M0 38c30-6 70-6 120 0v18H0z" fill="#d8b44a"/><path d="M0 46c40-4 80-4 120 0v10H0z" fill="#c49a32"/>
    <path d="M84 40V24" stroke="#6b4a2b" stroke-width="3.4"/><path d="M84 26c-6-2-10-6-10-8M84 26c6-2 10-6 10-8" stroke="#6b4a2b" stroke-width="2" fill="none"/><ellipse cx="84" cy="16" rx="20" ry="6" fill="#4b8f3a"/>
    <path d="M10 44l2-6 2 6M30 46l2-6 2 6M54 44l2-6 2 6M108 46l2-6 2 6" fill="none" stroke="#a57f22" stroke-width="1.6" stroke-linejoin="round"/>`,
  wet: `<rect width="120" height="56" fill="#cdeccf"/><ellipse cx="60" cy="40" rx="50" ry="13" fill="#4f9bd6" stroke="#2f6fa8" stroke-width="1.6"/><path d="M28 40c6-2 10 2 16 0M66 44c6-2 10 2 16 0" fill="none" stroke="#9fd4ff" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M40 36a7 4 0 1 0 12 0l-6-1z" fill="#3fa55a"/><path d="M74 34a6 3.4 0 1 0 10 0l-5-1z" fill="#3fa55a"/><circle cx="80" cy="33" r="2" fill="#ff8fb3"/>
    <path d="M10 46V18M14 46V22M106 46V16M110 46V24" stroke="#4b8f3a" stroke-width="2.4" stroke-linecap="round"/><ellipse cx="10" cy="18" rx="2.2" ry="5" fill="#7a4e2b"/><ellipse cx="106" cy="16" rx="2.2" ry="5" fill="#7a4e2b"/>`,
};

export const animalSvg = (id) => `<svg class="cartoon" viewBox="0 0 64 64" aria-hidden="true">${ANIMAL_ART[id] || ''}</svg>`;
export const homeSvg = (id) => `<svg class="cartoon-home" viewBox="0 0 120 56" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${HOME_ART[id] || ''}</svg>`;

// a happy face for each sorter shape (48 x 48), sitting where the shape is widest
const FACE_AT = { circle: [24, 24, 1], square: [24, 24, 1], triangle: [24, 30, 0.8], star: [24, 25, 0.75], heart: [24, 21, 1], rectangle: [24, 24, 0.9], diamond: [24, 24, 0.9], oval: [24, 24, 1] };
export function shapeFace(k) {
  const [x, y, s] = FACE_AT[k] || [24, 24, 1], d = 5 * s;
  return `<g class="shape-face" stroke="none">${eye(x - d, y - 2 * s, 2.6 * s)}${eye(x + d, y - 2 * s, 2.6 * s)}<ellipse cx="${x - d - 3 * s}" cy="${y + 2.5 * s}" rx="${2.4 * s}" ry="${1.5 * s}" fill="#fff" opacity=".45"/><ellipse cx="${x + d + 3 * s}" cy="${y + 2.5 * s}" rx="${2.4 * s}" ry="${1.5 * s}" fill="#fff" opacity=".45"/></g><path d="M${x - 3.2 * s} ${y + 2.2 * s}q${3.2 * s} ${3.4 * s} ${6.4 * s} 0" fill="none" stroke="#1d1a2b" stroke-width="${1.8 * s}" stroke-linecap="round"/>`;
}
