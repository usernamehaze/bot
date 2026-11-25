// Fig 1: how Cassie draws an answer, as a bench machine (built with the Anatomy skill's kit).
// The question is a card on a carriage. It rides the rail past each station of what Cassie really does:
//   1 the drawing book (a chest of drawers): a subject she has is a drawer that slides out, drawn at once, no AI;
//   2 the AI plotter: a new subject is drawn by the pen on the plate (flat), or built on the turntable (3D);
//   3 the checker: a dial gauge presses on the drawing; a wrong reading sends the card back for one redraw;
//   4 the look: a camera on a stand takes a picture of the drawing and checks every numbered part;
//   5 the screen: the student's drawing, its numbered parts lighting one by one.
// node build.mjs [--light]  writes how-cassie-draws(.html | -light.html) next to this file.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const KIT = "../../../.claude/skills/anatomy/";
const k = await import(new URL(KIT + "kit/iso-kit.mjs", import.meta.url));
const G = await import(new URL(KIT + "kit/lathe.mjs", import.meta.url));
const { kitScript } = await import(new URL(KIT + "scripts/inline-kit.mjs", import.meta.url));

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--light") ? "light" : "dark";
const WIDTH = 760, HEIGHT = 430;

const PLATE = { x: -270, y: -78, w: 540, d: 150, r: 10 }, PLATE_H = 12, FOOT_H = 6;
const RAIL_Y = 46; // the card's rail, along the front
const STOPS = { start: -238, book: -160, plot: -44, check: 92, look: 160, screen: 232 };
const BOOK = { x: -195, y: -62, w: 70, d: 70, r: 3 }, BOOK_H = 70;
const DRAWERS = [[-190, 38], [-190, 22], [-190, 6], [-157, 38], [-157, 22], [-157, 6]]; // [x, z] of each drawer on the front face
const PAPER = { x: -100, y: -52, w: 104, d: 70, r: 2 };
const GANTRY = { y: -60, z: 78, from: -108, to: 12 };
const TABLE = [40, -24], TABLE_R = 20;
const DIAL = [96, -8], DIAL_R = 15, DIAL_Z = 62, DIAL_TOP = DIAL_Z + 7;
const CAM = [160, -34], CAM_Z = 66;
const EASEL = { x: 204, y: -38, w: 58, d: 8, r: 1.5 }, EASEL_Z = 16, EASEL_H = 62;

const P = k.fitProjection([...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [GANTRY.from, GANTRY.y, GANTRY.z + 10], [EASEL.x + EASEL.w, EASEL.y, EASEL_Z + EASEL_H + 4], [BOOK.x, BOOK.y, BOOK_H + 4]], WIDTH, HEIGHT, { pad: 26, azimuth: 40 });
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const screws = (pts, z, size = 0.45) => D(pts.map(([x, y]) => at([x, y, z])), { size });

function bench() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of k.corners(PLATE, 24).sort((a, b) => k.depthOf([...a, 0], P) - k.depthOf([...b, 0], P))) {
    out.push(S(k.cylinder(x, y, 8, -PLATE_H - FOOT_H, 1.8, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 6, -PLATE_H - FOOT_H + 1.8, FOOT_H - 1.8, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
  const cs = k.corners(PLATE, 11);
  out.push(L(cs.map(([x, y]) => k.ring(x, y, 2.4, 0, P, 16)).join(""), { tone: "lo" }), screws(cs, 0, 0.55));
  // a label plate with three rule lines, front left
  const lab = { x: -258, y: 58, w: 34, d: 9, r: 1 };
  out.push(S(k.slabOf(lab, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  out.push(L([1, 2, 3].map((n) => k.lineOnTop([lab.x + 4, lab.y + n * 2.2], [lab.x + (n === 3 ? 18 : 30), lab.y + n * 2.2], 0.6, P)).join(""), { tone: "faint", free: true }));
  return out.join("");
}

function book() { // the drawing book: a chest of six drawers, each a subject she has drawn and checked
  const out = [S(k.slabOf(BOOK, 0, BOOK_H, P, 4, 1), { tone: "mid" })];
  out.push(L(k.planOutline(k.insetPlan(BOOK, 4), BOOK_H, P, 4), { tone: "faint" }));
  out.push(k.faceTextSvg(k.topMatrix([BOOK.x + BOOK.w / 2, BOOK.y + BOOK.d / 2], BOOK_H, P, "x"), "BOOK", { size: 5, tone: "lo", anchor: "middle" }));
  out.push(screws(k.corners(BOOK, 5), BOOK_H));
  DRAWERS.forEach(([x, z], i) => {
    const d = { x, y: BOOK.y + BOOK.d - 1, w: 30, d: 4, r: 0.8 };
    const g = [S(k.slabOf(d, z, 13, P, 2, 0.4), { tone: "hi", crease: "lo" }), S(k.cylinder(x + 15, d.y + 5.2, 1.6, z + 5, 3, P, 14), { tone: "mid" })];
    out.push(`<g data-part="drawer${i}">${g.join("")}</g>`);
  });
  return out.join("");
}

function plotter() { // the AI: a gantry plotter, its pen drawing on the plate; a turntable beside it for 3D
  const out = [];
  out.push(S(k.slabOf(k.insetPlan(PAPER, -4), 0, 2, P, 3, 0.4), { tone: "lo" }));
  out.push(S(k.slabOf(PAPER, 2, 0.8, P, 2), { tone: "hi", crease: "none" }));
  // what the pen has drawn: a part outline and two label lines (revealed as it draws)
  const strokes = [
    k.onTop([[-78, -30], [-60, -40], [-40, -34], [-36, -16], [-52, -4], [-72, -10], [-78, -30]], 2.9, P),
    k.onTop([[-58, -24], [-46, -26], [-44, -16]], 2.9, P),
    k.onTop([[-30, -26], [-10, -26]], 2.9, P),
    k.onTop([[-30, -12], [-14, -12]], 2.9, P),
  ];
  out.push(`<g data-part="strokes">${strokes.map((d, i) => `<path class="iso-line" data-tone="hi" data-stroke="${i}" d="${d}" pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:1"/>`).join("")}</g>`);
  out.push(D([at([-10, -26, 2.9]), at([-14, -12, 2.9])], { size: 0.9, tone: "hi" }));
  for (const x of [GANTRY.from, GANTRY.to]) {
    out.push(S(k.slabOf({ x: x - 5, y: GANTRY.y - 5, w: 10, d: 10, r: 1.5 }, 0, 4, P, 3, 0.5), { tone: "mid" }));
    out.push(S(k.cylinder(x, GANTRY.y, 3.2, 4, GANTRY.z - 4, P, 24), { tone: "mid", crease: "none" }));
    out.push(screws([[x - 3, GANTRY.y - 3], [x + 3, GANTRY.y + 3]], 4));
  }
  out.push(S(k.slabOf({ x: GANTRY.from - 5, y: GANTRY.y - 4, w: GANTRY.to - GANTRY.from + 10, d: 8, r: 2 }, GANTRY.z, 7, P, 4, 0.6), { tone: "mid" }));
  const t = k.topTicks(GANTRY.from + 4, GANTRY.to - 4, 4, 5, GANTRY.y - 3.5, GANTRY.z + 7, [1.6, 3], P);
  out.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }));
  return out.join("");
}
function penHead() { // moves along the gantry (x) and in and out (its arm), and down to draw
  const out = [S(k.slabOf({ x: -8, y: GANTRY.y - 6, w: 16, d: 12, r: 2 }, GANTRY.z - 2, 12, P, 3, 0.5), { tone: "mid" })];
  out.push(S(k.slabOf({ x: -3, y: GANTRY.y + 6, w: 6, d: 40, r: 1 }, GANTRY.z + 2, 4, P, 2, 0.3), { tone: "mid" }));
  out.push(S(k.cylinder(0, -16, 3, 20, GANTRY.z - 14, P, 20), { tone: "hi", crease: "none", lit: true }));
  out.push(S(G.solidOf([[0, 0.2], [6, 2.6]], G.frameAlong([0, -16, 14], [0, 0, 1]), P), { tone: "hi", lit: true }));
  out.push(S(k.cylinder(0, -16, 4.2, 44, 5, P, 20), { tone: "mid" }));
  return out.join("");
}
function turntable() { // 3D: the model is built on a turntable that turns it for the student
  const [x, y] = TABLE, out = [];
  out.push(S(k.cylinder(x, y, TABLE_R + 3, 0, 5, P, 56, 0.6), { tone: "mid" }));
  out.push(S(k.cylinder(x, y, TABLE_R, 5, 4, P, 56, 0.8), { tone: "hi", crease: "lo" }));
  const ticks = k.radialTicks(x, y, TABLE_R - 2, 36, 6, 9, [1.2, 2.6], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  // the little model on it: a body, a nose cone and a fin
  out.push(S(G.solidOf([[0, 5, 1], [4, 6.5, 1], [16, 6.5], [22, 0.4]], G.frameAlong([x - 10, y, 15.5], [1, 0, 0]), P), { tone: "hi" }));
  out.push(S(k.slabOf({ x: x - 9, y: y - 0.8, w: 6, d: 1.6, r: 0.3 }, 20, 8, P, 2), { tone: "mid" }));
  out.push(S(k.cylinder(x, y, 2, 9, 3, P, 14), { tone: "mid" }));
  return out.join("");
}
function checker() { // her checks: a dial gauge on a post; the plunger presses the drawing, the needle reads it
  const [x, y] = DIAL, out = [];
  out.push(S(k.slabOf({ x: x - 12, y: y - 12, w: 24, d: 24, r: 3 }, 0, 9, P, 5, 0.7), { tone: "mid" }));
  out.push(S(k.cylinder(x - 6, y - 6, 3, 9, DIAL_Z + 12 - 9, P, 24), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf({ x: x - 9, y: y - 9, w: 9, d: 7, r: 1.5 }, DIAL_Z + 6, 6, P, 3, 0.4), { tone: "mid" }));
  out.push(S(k.cylinder(x, y, 2.4, 20, DIAL_Z - 20, P, 18), { tone: "mid" }));
  out.push(S(k.cylinder(x, y, DIAL_R, DIAL_Z, 7, P, 56, 0.8), { tone: "hi", crease: "lo" }));
  out.push(L(k.knurl(x, y, DIAL_R, DIAL_TOP - 2.6, DIAL_TOP, 64, P, 0.3), { tone: "lo" }));
  out.push(L(k.ring(x, y, DIAL_R - 2, DIAL_TOP, P, 48), { tone: "lo" }));
  const t = k.radialTicks(x, y, DIAL_R - 2.6, 40, 5, DIAL_TOP, [1.1, 2.4], P);
  out.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }));
  out.push(L(k.ring(x, y, 1.2, DIAL_TOP, P, 12), { tone: "mid" }));
  return out.join("");
}
const needleAt = (turn) => { const a = turn * Math.PI * 2, [x, y] = DIAL; return k.lineOnTop([x - Math.sin(a) * 2.6, y + Math.cos(a) * 2.6], [x + Math.sin(a) * (DIAL_R - 3.5), y - Math.cos(a) * (DIAL_R - 3.5)], DIAL_TOP + 0.2, P); };
function camera() { // her look: a camera on a stand takes a picture of the drawing
  const [x, y] = CAM, out = [];
  out.push(S(k.cylinder(x, y, 10, 0, 3, P, 32, 0.5), { tone: "mid" }));
  out.push(S(k.cylinder(x, y, 2.2, 3, CAM_Z - 3, P, 16), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf({ x: x - 12, y: y - 8, w: 24, d: 16, r: 2.5 }, CAM_Z, 16, P, 4, 0.7), { tone: "mid" }));
  out.push(S(G.solidOf([[0, 7], [3, 7], [3, 5.6], [10, 5.4]], G.frameAlong([x, y + 8, CAM_Z + 8], [0, 1, 0]), P), { tone: "hi" }));
  out.push(`<g data-part="lamp">${S(k.cylinder(x + 7, y - 4, 1.8, CAM_Z + 16, 1.6, P, 12), { tone: "hi" })}</g>`);
  out.push(screws([[x - 9, y - 5], [x + 9, y + 5]], CAM_Z + 16));
  return out.join("");
}
function easel() { // the student's screen: the drawing's numbered parts light one by one
  const out = [S(k.slabOf({ x: EASEL.x - 4, y: EASEL.y - 10, w: EASEL.w + 8, d: 24, r: 3 }, 0, 6, P, 5, 0.7), { tone: "mid" })];
  for (const x of [EASEL.x + 6, EASEL.x + EASEL.w - 6]) out.push(S(k.slabOf({ x: x - 2, y: EASEL.y - 1, w: 4, d: 4, r: 0.8 }, 6, EASEL_Z - 6 + 8, P, 2), { tone: "mid" }));
  out.push(S(k.slabOf(EASEL, EASEL_Z, EASEL_H, P, 3, 0.8), { tone: "mid" }));
  const face = EASEL.y + EASEL.d;
  const lamps = [];
  for (let i = 0; i < 6; i++) {
    const cx = EASEL.x + 12 + (i % 3) * 17, cz = EASEL_Z + EASEL_H - 16 - Math.floor(i / 3) * 22;
    lamps.push(`<g data-part="pin${i}">${S(G.disc(0, 1.6, 4, G.frameAlong([cx, face, cz], [0, 1, 0]), P), { tone: "lo" })}</g>`);
  }
  out.push(lamps.join(""));
  out.push(L([0, 1].map((r) => k.segment([EASEL.x + 8, face + 0.2, EASEL_Z + 8 + r * 4], [EASEL.x + (r ? 34 : 48), face + 0.2, EASEL_Z + 8 + r * 4], P)).join(""), { tone: "faint", free: true }));
  return out.join("");
}
function rail() {
  const out = [S(k.slabOf({ x: -258, y: RAIL_Y - 4, w: 516, d: 8, r: 1.5 }, 0, 3, P, 3, 0.4), { tone: "mid" })];
  for (const x of [-262, 254]) out.push(S(k.slabOf({ x, y: RAIL_Y - 7, w: 8, d: 14, r: 1.5 }, 0, 8, P, 3, 0.5), { tone: "mid" }), screws([[x + 4, RAIL_Y - 4], [x + 4, RAIL_Y + 4]], 8));
  const t = k.topTicks(-250, 250, 5, 5, RAIL_Y + 4, 3, [1.4, 2.8], P);
  out.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }));
  return out.join("");
}
function card() { // the question: a card on its carriage
  const out = [`<path class="iso-halo" d="${k.haloOf({ x: -13, y: RAIL_Y - 9, w: 26, d: 18, r: 2 }, 3, 0.1, P)}" style="filter:blur(4px)"/>`];
  out.push(S(k.slabOf({ x: -13, y: RAIL_Y - 9, w: 26, d: 18, r: 2 }, 3, 5, P, 3, 0.5), { tone: "mid" }));
  out.push(screws([[-9, RAIL_Y - 5], [9, RAIL_Y + 5]], 8));
  const c = { x: -11, y: RAIL_Y - 7, w: 22, d: 14, r: 1 };
  out.push(S(k.slabOf(c, 8, 1.2, P, 2), { tone: "hi", lit: true }));
  out.push(L([0, 1, 2].map((n) => k.lineOnTop([c.x + 3, c.y + 3 + n * 3.6], [c.x + (n === 2 ? 12 : 19), c.y + 3 + n * 3.6], 9.2, P)).join(""), { tone: "lo", free: true }));
  out.push(k.faceTextSvg(k.topMatrix([c.x + 17, c.y + 11], 9.2, P, "x"), "?", { size: 5, tone: "hi", anchor: "middle" }));
  return out.join("");
}

const station = (name, html) => `<g data-station="${name}">${html}</g>`;
const svg = k.figureSvg({
  width: WIDTH, height: HEIGHT,
  label: "How Cassie draws an answer, as a bench machine. A question card rides a rail past a chest of drawers (her drawing book), a gantry plotter with a turntable (the AI drawing it flat or building it in 3D), a dial gauge (her checks), a camera on a stand (her look at the drawing) and an easel whose numbered lamps light one by one (the drawing on the student's screen).",
  body: [
    bench(),
    station("book", book()),
    station("plot", plotter() + `<g data-part="pen" transform="${k.translateAlong(P, [-60, 0, 0])}">${penHead()}</g>` + turntable()),
    station("check", checker() + `<path data-part="needle" class="iso-line" data-tone="lit" data-free="start" d="${needleAt(0)}" style="stroke-width:1.1"/>`),
    station("look", camera()),
    station("screen", easel()),
    rail(),
    `<g data-part="card" transform="${k.translateAlong(P, [STOPS.start, 0, 0])}">${card()}</g>`,
  ],
});

const live = `
const P = ${JSON.stringify(P)}, STOPS = ${JSON.stringify(STOPS)}, DIAL = ${JSON.stringify(DIAL)}, DIAL_R = ${DIAL_R}, DIAL_TOP = ${DIAL_TOP};
const stage = document.querySelector(".iso-stage"), svg = stage.querySelector("svg"), readout = document.querySelector("[data-readout]");
const q = (s) => svg.querySelector(s), card = q('[data-part="card"]'), pen = q('[data-part="pen"]'), needle = q('[data-part="needle"]');
const drawers = [...svg.querySelectorAll('[data-part^="drawer"]')], strokes = [...svg.querySelectorAll('[data-stroke]')], pins = [...svg.querySelectorAll('[data-part^="pin"]')], lamp = q('[data-part="lamp"] .iso-solid');
const stations = [...svg.querySelectorAll('[data-station]')];
const still = matchMedia("(prefers-reduced-motion: reduce)");
const needleAt = ${needleAt.toString().replace(/k\.lineOnTop/g, "lineOnTop")};
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const lerp = (a, b, t) => a + (b - a) * ease(t);
let inBook = false, apart = 0, apartTo = 0;
// one run of the machine, second by second: [from, to, what happens, what the readout says]
const PLAN_NEW = [[0, 1.4, "ride", "start", "book", "A question comes in"], [1.4, 2.6, "peek", "book", "book", "Is it in her drawing book? No"], [2.6, 3.8, "ride", "book", "plot", "To the AI"], [3.8, 7.2, "draw", "plot", "plot", "The AI draws it, flat or in 3D"], [7.2, 8.2, "ride", "plot", "check", "To her checks"], [8.2, 9.8, "check", "check", "check", "Every part checked"], [9.8, 10.6, "ride", "check", "look", "To her look"], [10.6, 11.8, "look", "look", "look", "She looks at a picture of it"], [11.8, 12.6, "ride", "look", "screen", "To the student"], [12.6, 15.8, "show", "screen", "screen", "Drawn part by part"]];
const PLAN_BOOK = [[0, 1.4, "ride", "start", "book", "A question comes in"], [1.4, 3.0, "hit", "book", "book", "In her drawing book: no AI"], [3.0, 5.4, "ride", "book", "screen", "Straight to the student"], [5.4, 8.6, "show", "screen", "screen", "Drawn part by part, at once"]];
let clock = 0, last = 0, frame = 0, visible = false;
function pose(t) {
  const plan = inBook ? PLAN_BOOK : PLAN_NEW, end = plan[plan.length - 1][1] + 1.2;
  t = t % end;
  let step = plan.find((s) => t >= s[0] && t < s[1]) || plan[plan.length - 1];
  const f = Math.min(1, (t - step[0]) / (step[1] - step[0]));
  const x = step[2] === "ride" ? lerp(STOPS[step[3]], STOPS[step[4]], f) : STOPS[step[3]];
  card.setAttribute("transform", translateAlong(P, [x, 0, 0]));
  // the drawer: peeks and shuts (not in the book), or slides right out (in the book)
  const dr = step[2] === "peek" ? Math.sin(f * Math.PI) * 6 : step[2] === "hit" ? ease(f * 1.6) * 16 : 0;
  drawers.forEach((d, i) => d.setAttribute("transform", i === 2 ? translateAlong(P, [0, dr, 0]) : ""));
  // the pen: along the gantry while it draws; the strokes appear
  const drawing = step[2] === "draw" ? f : plan.indexOf(step) > plan.findIndex((s) => s[2] === "draw") && !inBook ? 1 : 0;
  pen.setAttribute("transform", translateAlong(P, [-60 + Math.sin(drawing * Math.PI * 3) * 22, 0, step[2] === "draw" ? -Math.abs(Math.sin(f * 20)) * 1.5 : 4]));
  strokes.forEach((s, i) => s.style.strokeDashoffset = String(1 - Math.min(1, Math.max(0, drawing * strokes.length - i))));
  // the needle: swings to the reading while it checks
  needle.setAttribute("d", needleAt(step[2] === "check" ? Math.sin(f * Math.PI * 2.5) * 0.18 + f * 0.25 : step[2] === "ride" && step[3] !== "check" ? 0 : 0.25 * (plan.indexOf(step) > 5 && !inBook ? 1 : 0)));
  if (lamp) { if (step[2] === "look" && (f * 6) % 2 < 1) lamp.setAttribute("data-lit", ""); else lamp.removeAttribute("data-lit"); }
  const shown = step[2] === "show" ? Math.floor(f * 7) : 0;
  pins.forEach((p, i) => { const s = p.querySelector(".iso-solid"); if (s) { if (i < shown) s.setAttribute("data-lit", ""); else s.removeAttribute("data-lit"); } });
  if (readout.textContent !== step[5]) readout.textContent = step[5];
}
function lift() { stations.forEach((g, i) => g.setAttribute("transform", apart ? translateAlong(P, [0, -apart * 12 * (i % 2 ? 1 : -0.4), apart * (26 + i * 8)]) : "")); }
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60; last = now;
  clock += dt; apart += (apartTo - apart) * (1 - Math.exp(-dt / 0.25)); if (Math.abs(apartTo - apart) < 0.001) apart = apartTo;
  pose(clock); lift();
  frame = visible ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible && !still.matches) { last = 0; frame = requestAnimationFrame(tick); } };
new IntersectionObserver((e) => { visible = e[e.length - 1].isIntersecting; run(); }, { rootMargin: "120px 0px" }).observe(stage);
stage.addEventListener("click", () => { inBook = !inBook; clock = 0; if (still.matches) pose(6); });
stage.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); inBook = !inBook; clock = 0; } if (e.key === "a" || e.key === "A") { apartTo = apartTo ? 0 : 1; if (still.matches) { apart = apartTo; lift(); } } });
document.querySelector("[data-apart]")?.addEventListener("click", (e) => { apartTo = apartTo ? 0 : 1; e.currentTarget.textContent = apartTo ? "Put it back" : "Take it apart"; if (still.matches) { apart = apartTo; lift(); } });
window.__pose = (t, book, ap) => { inBook = !!book; apart = apartTo = ap || 0; pose(t); lift(); };
pose(still.matches ? 13 : 0);
`;

const body = k.plateHtml({
  fig: "Fig 1",
  title: "How Cassie draws an answer",
  hint: "Tap: a subject in her book, or a new one",
  readout: "A question comes in",
  keys: [
    { mark: "lit", label: "The question card, the pen, the needle and the lamps: what moves at each step" },
    { mark: "raised", label: "Drawers: her drawing book of checked drawings" },
  ],
  caption: "A question rides the rail. If her drawing book has the subject, its drawer slides out and the drawing goes straight to the student, with no AI. If not, the AI draws it (the pen, flat) or builds it (the turntable, 3D); the dial gauge checks every part and a wrong reading sends it back for one redraw; the camera looks at a picture of it; then the easel shows it, its numbered parts lighting one by one.",
  body: `<div class="iso-stage" tabindex="0" role="img" aria-label="How Cassie draws an answer. Space or tap switches between a subject in her book and a new one; A takes it apart.">${svg}</div><button type="button" data-apart style="margin:10px 0 0;min-height:44px;padding:0 18px;border-radius:999px;border:1px solid var(--anatomy-lo);background:transparent;color:var(--anatomy-strong);font:600 14px system-ui">Take it apart</button>`,
});
const name = theme === "light" ? "how-cassie-draws-light.html" : "how-cassie-draws.html";
writeFileSync(join(HERE, name), k.pageHtml({ title: "How Cassie draws an answer", theme, body, script: kitScript() + live, width: 820 }));
console.log("wrote", name);
