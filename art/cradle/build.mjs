// Builds the side panel's empty-state picture: a Newton's cradle, one ball swinging in and the other end swinging out, forever.
// node art/cradle/build.mjs <outDir> [--still]  → still.html (a pose and a panel mock-up, for review) or frames.html (every GIF frame).
// GIF: shoot each frame at 2x (anatomy's drive.mjs: eval show(i), shot f00.png…), then `python encode.py <outDir> 96`, copy to public/.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as k from "../../.claude/skills/anatomy/kit/iso-kit.mjs";
import * as G from "../../.claude/skills/anatomy/kit/lathe.mjs";
import { tubePieces, tubeSvg } from "../../.claude/skills/anatomy/kit/tube.mjs";

const OUT = process.argv[2] ?? ".";
const STILL = process.argv.includes("--still");
const WIDTH = 200;
const HEIGHT = 122;

// The model: an ideal cradle. Each end ball swings out on a sine for half a period, then hands the swing back.
const BALL_R = 7.5;
const BALLS = [-30, -15, 0, 15, 30];
const RAIL_Z = 56;
const RAIL_Y = 14;
const POST_X = 56;
const TUBE_R = 1.8;
const COLLAR_R = 2.6;
const PIVOT_Z = RAIL_Z - COLLAR_R;
const REST_Z = 20;
const LENGTH = PIVOT_Z - REST_Z;
const SWING = (25 * Math.PI) / 180;
export const FRAMES = 30;
const START = 0.25;

export function anglesAt(phase) {
  const a = SWING * Math.sin(2 * Math.PI * phase);
  return BALLS.map((_, i) => (i === BALLS.length - 1 ? Math.max(0, a) : i === 0 ? Math.min(0, a) : 0));
}

// The drawing.
const BASE = { x: -64, y: -21, w: 128, d: 42, r: 6 };
const P = k.fitProjection(
  [...k.boxCorners(BASE, -9, 0), [-POST_X, -RAIL_Y, RAIL_Z + TUBE_R], [POST_X, RAIL_Y, RAIL_Z + TUBE_R], [-POST_X, RAIL_Y, RAIL_Z + TUBE_R], [POST_X, -RAIL_Y, RAIL_Z + TUBE_R]],
  WIDTH,
  HEIGHT,
  { pad: 6, azimuth: 90, elevation: 16 },
);
const V = G.viewOf(P);
const L = G.lightOf(P);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const depth = (p) => G.dot3(p, V);
const alongX = (p) => G.frameOf(p, [1, 0, 0], [0, 1, 0], [0, 0, 1]);

const ballAt = (x, angle) => [x + LENGTH * Math.sin(angle), 0, PIVOT_Z - LENGTH * Math.cos(angle)];
const eyeAt = (centre, angle) => [centre[0] - (BALL_R + 0.8) * Math.sin(angle), 0, centre[2] + (BALL_R + 0.8) * Math.cos(angle)];

// No halo or ball shadows: a GIF has no soft alpha, so their blur gets cut into a grey box at its edges.
function base() {
  const out = [];
  const feet = k.corners(BASE, 10).sort((a, b) => depth([...a, 0]) - depth([...b, 0]));
  for (const [x, y] of feet) out.push(S(k.cylinder(x, y, 4, -9, 3, P, 20), { tone: "lo" }));
  out.push(S(k.slabOf(BASE, -6, 6, P, 8, 1.2), { tone: "lo" }));
  out.push(Ln(k.planOutline(k.insetPlan(BASE, 4), 0, P), { tone: "faint" }));
  const screws = k.corners(BASE, 8.5);
  out.push(Ln(screws.map(([x, y]) => k.ring(x, y, 1.6, 0, P, 14)).join(""), { tone: "lo" }));
  out.push(k.dotsSvg(screws.map(([x, y]) => at([x, y, 0])), { size: 0.45 }));
  const sockets = [-POST_X, POST_X].flatMap((x) => [-RAIL_Y, RAIL_Y].map((y) => [x, y])).sort((a, b) => depth([...a, 0]) - depth([...b, 0]));
  for (const [x, y] of sockets) {
    out.push(S(k.cylinder(x, y, 3.2, 0, 2.5, P, 24, 0.4), { tone: "mid" }));
  }
  return out.join("");
}

// One side of the frame: a bent tube from the base, up, along the top, and down again, with a collar over each ball.
function frameSide(y) {
  const route = G.fillet([[-POST_X, y, 2.5], [-POST_X, y, RAIL_Z], [POST_X, y, RAIL_Z], [POST_X, y, 2.5]], 7, 7, { P, tube: TUBE_R });
  const out = tubePieces(route, TUBE_R, P, { maxLength: 400, caps: false }).map((piece) => tubeSvg(piece, { tone: "mid" }));
  const collars = [...BALLS].sort((a, b) => depth([a, y, 0]) - depth([b, y, 0]));
  for (const x of collars) out.push(S(G.disc(-1.1, 1.1, COLLAR_R, alongX([x, y, RAIL_Z]), P), { tone: "mid" }));
  return out.join("");
}

function strings(side, centres, angles) {
  return Ln(centres.map((c, i) => k.segment(eyeAt(c, angles[i]), [BALLS[i], side, PIVOT_Z], P)).join(""), { tone: "lo" });
}

function balls(centres, angles) {
  return centres
    .map((c, i) => ({ c, i, key: depth(c) }))
    .sort((a, b) => a.key - b.key)
    .map(({ c, i }) => {
      const glint = G.add3(c, G.mul3(G.unit3(G.add3(L, V)), BALL_R * 0.98));
      const [gx, gy] = at(glint);
      return S(G.sphereOf(c, BALL_R, P), { tone: "hi" }) +
        `<circle class="cr-glint" cx="${gx.toFixed(1)}" cy="${gy.toFixed(1)}" r="0.9"/>` +
        S(G.sphereOf(eyeAt(c, angles[i]), 1.1, P), { tone: "hi" });
    })
    .join("");
}

export function frameSvg(phase) {
  const angles = anglesAt(phase);
  const centres = BALLS.map((x, i) => ballAt(x, angles[i]));
  return k.figureSvg({
    width: WIDTH,
    height: HEIGHT,
    label: "A Newton's cradle: five steel balls hang in a row from a bent-tube frame. One end ball swings in and strikes, and the ball at the other end swings out, over and over.",
    body: [base(), frameSide(-RAIL_Y), strings(-RAIL_Y, centres, angles), balls(centres, angles), strings(RAIL_Y, centres, angles), frameSide(RAIL_Y)],
  });
}

const CSS = `${k.ISO_CSS}
html,body{margin:0;background:#f6f5f4}
.iso[data-theme="light"]{--anatomy-lit:#0075de;--anatomy-page:#f6f5f4;--anatomy-hi:#615d59}
#stage svg{display:block;width:${WIDTH}px;height:${HEIGHT}px;background:#f6f5f4}
.cr-glint{fill:#fff;stroke:none}
.mock{width:520px;padding:40px 0 48px;display:flex;flex-direction:column;align-items:center;gap:16px;font:13px/1.5 'Inter Variable',system-ui,'Segoe UI',sans-serif;color:#615d59;text-align:center}
.mock p{margin:0;max-width:250px}
.big svg{width:${WIDTH * 3}px!important;height:${HEIGHT * 3}px!important}`;

const page = (body, script = "") => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body class="iso" data-theme="light">${body}${script}</body></html>`;

mkdirSync(OUT, { recursive: true });
if (STILL) {
  const svg = frameSvg(START);
  writeFileSync(join(OUT, "still.html"), page(`<div class="mock" id="stage">${svg}<p>When a coding agent uses the browser, its steps show here.</p></div>`));
  writeFileSync(join(OUT, "big.html"), page(`<div class="big" id="stage">${svg}</div>`));
  console.log("wrote still.html and big.html to", OUT);
} else {
  const frames = Array.from({ length: FRAMES }, (_, f) => frameSvg(START + f / FRAMES));
  writeFileSync(join(OUT, "frames.html"), page(`<div id="stage" style="zoom:2"></div>`, `<script>const FRAMES=${JSON.stringify(frames)};window.show=(i)=>{document.getElementById("stage").innerHTML=FRAMES[i]};show(0)</script>`));
  console.log("wrote", frames.length, "frames to", join(OUT, "frames.html"));
}
