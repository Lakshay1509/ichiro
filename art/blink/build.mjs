// Builds the side panel's MCP-on empty-state picture: the Ichiro symbol on a plinth, blinking and looking around like a person, forever.
// node art/blink/build.mjs [outDir=public]  → blink.svg (blinks and looks around, SMIL) and blink-still.svg (eyes open, for prefers-reduced-motion).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as k from "../../.claude/skills/anatomy/kit/iso-kit.mjs";
import * as G from "../../.claude/skills/anatomy/kit/lathe.mjs";

const OUT = process.argv[2] ?? "public";
const WIDTH = 104;
const HEIGHT = 100;

// The symbol at half the size of art/logo/build.py's 256 grid: R = 44, RING, PUPIL, LOOK = 0.45, 0.31, 0.12 (× R).
const EYE_R = 22;
const EYE_IN = EYE_R * (1 - 0.45);
const PUPIL_R = EYE_R * 0.31;
const LOOK = EYE_R * 0.12;
const EYE_Z = 72;
const STEM = { w: 20, h: 40 };
const I_X = [-25, 25];

// The model: a person's spontaneous blinks, about 15–18 a minute at uneven gaps, now and then a double. Each closes in about 0.1 s,
// stays shut a few hundredths and opens in about 0.2 s. SMIL has no random, so one LOOP-second schedule is drawn from a fixed seed and repeats.
const LOOP = 41;
const SEED = 13;
const HOLD = "0 0 1 1";
const SHUTTING = "0.45 0 0.8 1";
const OPENING = "0.2 0 0.3 1";
const SACCADE = "0.4 0 0.2 1";

const randomFrom = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// keyTimes for one LOOP. SMIL drops the whole animation on a bad list, so check it here.
function keyTimesOf(times, splines) {
  const keyTimes = times.map((t) => (t / LOOP).toFixed(5));
  if (!(keyTimes.every((t, i) => i === 0 || t > keyTimes[i - 1]) && keyTimes.at(-1) === "1.00000" && splines.length === times.length - 1)) throw new Error("bad schedule");
  return keyTimes.join(";");
}

const animate = (values, plan) =>
  `<animateTransform attributeName="transform" type="translate" dur="${LOOP}s" repeatCount="indefinite" calcMode="spline" values="${values}" keyTimes="${plan.keyTimes}" keySplines="${plan.splines}"/>`;

function schedule() {
  const rand = randomFrom(SEED);
  const times = [0];
  const shut = [false];
  const splines = [];
  const key = (t, closed, spline) => (times.push(t), shut.push(closed), splines.push(spline));
  for (let t = 1.2; ; ) {
    const close = 0.09 + 0.03 * rand();
    const rest = 0.02 + 0.03 * rand();
    const open = 0.18 + 0.06 * rand();
    if (t + close + rest + open > LOOP - 1) break;
    key(t, false, HOLD);
    key(t + close, true, SHUTTING);
    key(t + close + rest, true, HOLD);
    key((t += close + rest + open), false, OPENING);
    t += rand() < 0.12 ? 0.15 + 0.15 * rand() : 1.2 + 5 * rand() ** 1.8;
  }
  key(LOOP, false, HOLD);
  return { keyTimes: keyTimesOf(times, splines), shut, splines: splines.join(";") };
}
const BLINKS = schedule();

// Where the pupils look, both always the same way: they hold still 0.6–3 s, then jump (a saccade, about 0.05 s plus a little
// per unit of travel). Every third look comes home to the logo's glance right, as does the loop's start and end.
// Moving the pupils bends art/logo/GUIDE.md's rule 7; the developer asked for it in this picture only (2026-10-23).
const REACH = EYE_IN - PUPIL_R - 0.8; // the farthest a pupil's centre goes from the eye's centre
function gaze() {
  const rand = randomFrom(SEED + 1);
  const home = [LOOK, 0];
  const apart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const spot = () => {
    const x = (2 * rand() - 1) * REACH;
    const z = (2 * rand() - 1) * REACH * 0.6; // people look around more side to side than up and down
    const fit = Math.min(1, REACH / Math.hypot(x, z));
    return [x * fit, z * fit];
  };
  const times = [0];
  const spots = [home];
  const splines = [];
  const look = (t, from, to) => {
    const jump = 0.05 + 0.01 * apart(from, to);
    times.push(t, t + jump);
    spots.push(from, to);
    splines.push(HOLD, SACCADE);
    return t + jump;
  };
  let now = home;
  let t = 2.4;
  for (let n = 1; t < LOOP - 3.5; n++) {
    let next = home;
    if (n % 3) do next = spot(); while (apart(next, now) < 1.5);
    t = look(t, now, next) + 0.6 + 2.4 * rand();
    now = next;
  }
  if (now !== home) look(Math.min(t, LOOP - 0.5), now, home);
  times.push(LOOP);
  spots.push(home);
  splines.push(HOLD);
  return { keyTimes: keyTimesOf(times, splines), spots, splines: splines.join(";") };
}
const GAZE = gaze();
const LID_S = 2.6; // the lids slide between the pupil's face (2.3) and the ring's (3)
// Shut, the two lids meet on a shallow arc a little below the middle, a closed eye's ‿.
const MEET = EYE_Z - 0.2 * EYE_IN;
const BEND = EYE_R * 1.1; // the arc's radius; it must exceed the plates' half-width
const edgeZ = (u) => MEET + BEND - Math.sqrt(BEND * BEND - u * u);
// How far each lid slides away to clear the opening, with 0.6 to spare.
const ACROSS = Array.from({ length: 49 }, (_, i) => -EYE_IN + (EYE_IN * i) / 24);
const hole = (u) => Math.sqrt(Math.max(0, EYE_IN * EYE_IN - u * u));
const RISE = Math.max(...ACROSS.map((u) => EYE_Z + hole(u) - edgeZ(u))) + 0.6;
const DROP = Math.max(...ACROSS.map((u) => edgeZ(u) - EYE_Z + hole(u))) + 0.6;

// The drawing.
const BASE = { x: -56, y: -13, w: 112, d: 26, r: 6 };
const P = k.fitProjection(
  [...k.boxCorners(BASE, -10, 0), ...[-47, 47].flatMap((x) => [-3, 3].map((y) => [x, y, EYE_Z])), [0, -3, EYE_Z + EYE_R]],
  WIDTH,
  HEIGHT,
  { pad: 4, azimuth: 90, elevation: 18 },
);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const facing = (o) => G.frameOf(o, [0, 1, 0], [1, 0, 0], [0, 0, 1]);
const pathOf = (points) => points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join("");

function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BASE, -10, 10, P)}"/>`];
  for (const [x, y] of k.corners(BASE, 8)) out.push(S(k.cylinder(x, y, 3.5, -10, 3, P, 20), { tone: "lo" }));
  out.push(S(k.slabOf(BASE, -7, 7, P, 8, 1.2), { tone: "lo" }));
  // The name plate on the front face, held by two screws.
  const plate = { x: -14, y: BASE.y + BASE.d, w: 28, d: 0.5, r: 0.2 };
  out.push(S(k.slabOf(plate, -5.4, 3.8, P, 2), { tone: "lo" }));
  out.push(k.dotsSvg([-11.5, 11.5].map((x) => at([x, plate.y + 0.5, -3.5])), { size: 0.4 }));
  const screws = k.corners(BASE, 5.5);
  out.push(Ln(screws.map(([x, y]) => k.ring(x, y, 1.6, 0, P, 14)).join(""), { tone: "lo" }));
  out.push(k.dotsSvg(screws.map(([x, y]) => at([x, y, 0])), { size: 0.45 }));
  return out.join("");
}

// The lids, drawn shut on the meeting arc: the upper one carries the lash line and a fold above it. The ring in front hides all but the opening.
function lids(x, moving) {
  const arc = (lift) => Array.from({ length: 25 }, (_, i) => {
    const u = -EYE_R + (2 * EYE_R * i) / 24;
    return at([x + u, LID_S, edgeZ(u) + lift]);
  });
  const far = (z) => [at([x + EYE_R, LID_S, z]), at([x - EYE_R, LID_S, z])];
  const slide = (dz, body) => {
    const open = `0,${(at([0, 0, dz])[1] - at([0, 0, 0])[1]).toFixed(2)}`;
    const motion = moving ? animate(BLINKS.shut.map((closed) => (closed ? "0,0" : open)).join(";"), BLINKS) : "";
    return `<g transform="translate(${open.replace(",", " ")})">${motion}${body}</g>`;
  };
  const lower = `<path class="iso-shade" data-shade="1" d="${pathOf([...arc(0), ...far(EYE_Z - EYE_R - 4)])}Z"/>` + Ln(pathOf(arc(0)), { tone: "lo" });
  const upper = `<path class="iso-shade" data-shade="1" d="${pathOf([...arc(0), ...far(EYE_Z + EYE_R + 4)])}Z"/>` +
    Ln(pathOf(arc(3.2)), { tone: "faint" }) +
    Ln(pathOf(arc(0)), { tone: "hi" });
  const id = `bl-lid-${x < 0 ? "l" : "r"}`;
  return `<clipPath id="${id}"><path d="${G.circleOf(facing([x, 0, EYE_Z]), LID_S, EYE_R - 0.5, P, 64)}"/></clipPath>` +
    `<g clip-path="url(#${id})">${slide(-DROP, lower)}${slide(RISE, upper)}</g>`;
}

// The pupil, drawn at home and slid in its own plane to each spot; an orthographic disc looks the same wherever it sits.
function pupil(x, moving) {
  const [ox, oy] = at([0, 0, 0]);
  const offset = ([dx, dz]) => at([dx - LOOK, 0, dz]).map((v, i) => (v - [ox, oy][i]).toFixed(2)).join(",");
  const motion = moving ? animate(GAZE.spots.map(offset).join(";"), GAZE) : "";
  return `<g>${motion}${S(G.disc(1.5, 2.3, PUPIL_R, facing([x + LOOK, 0, EYE_Z]), P), { tone: "hi", className: "bl-pupil" })}</g>`;
}

// One i: a stem, a pin up to the eye, and the eye: a ring around a recessed white with a blue pupil.
function letter(x, moving) {
  const stem = { x: x - STEM.w / 2, y: -4, w: STEM.w, d: 8, r: 1 };
  const eye = facing([x, 0, EYE_Z]);
  return [
    S(k.slabOf(stem, 0, STEM.h, P, 3, 0.6), { tone: "hi" }),
    S(k.cylinder(x, 0, 1.6, STEM.h, EYE_Z - EYE_R - STEM.h + 0.3, P, 16), { tone: "mid" }),
    S(G.disc(-3, 1.5, EYE_IN, eye, P), { tone: "mid" }),
    pupil(x, moving),
    lids(x, moving),
    S(G.ringBand(-3, 3, EYE_IN, EYE_R, eye, P, { hole: [3, EYE_IN] }), { tone: "hi" }),
  ].join("");
}

const CSS = `<style>
.iso[data-theme="light"]{--anatomy-page:#f6f5f4;--anatomy-hi:#615d59}
.bl-pupil>.iso-fill,.bl-pupil>.iso-shade,.bl-pupil>.iso-top{fill:#0075de;stroke:#0075de}
.bl-pupil>.iso-edge{stroke:#005bab}
</style>`;

const svg = (moving) =>
  k.figureSvg({
    width: WIDTH,
    height: HEIGHT,
    standalone: "light",
    label: "The Ichiro symbol, two letter i with eyes for dots, stands on a small plinth blinks now and then and looks around here and there, the way a person does.",
    body: [CSS, base(), ...I_X.map((x) => letter(x, moving))],
  });

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "blink.svg"), svg(true));
writeFileSync(join(OUT, "blink-still.svg"), svg(false));
console.log("wrote blink.svg and blink-still.svg to", OUT, "scale", P.scale.toFixed(3));
