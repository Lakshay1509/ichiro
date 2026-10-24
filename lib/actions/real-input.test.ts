// Checks I1's real mouse input: the point our content script hands over is checked, and a click is the browser's own
// sequence (move, press, release). Run: npm test
import { checkPoint, checkScriptClick, clickAtPoint, dragAlong, mouseFlags, moveTo, parsePoint, sameLayout, toViewport } from './real-input.ts';

const fail = (what: string): never => {
  throw new Error(what);
};
const throws = (f: () => unknown, what: string) => {
  try {
    f();
  } catch {
    return;
  }
  fail(`${what} should throw`);
};

// A point is CSS pixels in the top page's viewport: two finite numbers, not negative, not absurd. Anything else never
// becomes a click.
if (JSON.stringify(checkPoint({ x: 132.5, y: 394 })) !== '{"x":132.5,"y":394}') fail('a good point');
for (const bad of [null, {}, { x: 1 }, { x: '1', y: 2 }, { x: Number.NaN, y: 2 }, { x: Infinity, y: 2 }, { x: -1, y: 2 }, { x: 2, y: 100_001 }]) {
  throws(() => checkPoint(bad), `point ${JSON.stringify(bad)}`);
}

// A click: the mouse moves there, presses the left button once, releases it.
const click = clickAtPoint({ x: 10, y: 20 });
if (JSON.stringify(click) !== JSON.stringify([
  { type: 'mouseMoved', x: 10, y: 20, button: 'none', buttons: 0, clickCount: 0 },
  { type: 'mousePressed', x: 10, y: 20, button: 'left', buttons: 1, clickCount: 1 },
  { type: 'mouseReleased', x: 10, y: 20, button: 'left', buttons: 0, clickCount: 1 },
])) fail(`click events: ${JSON.stringify(click)}`);
// A hover: only the move.
if (JSON.stringify(moveTo({ x: 10, y: 20 })) !== JSON.stringify([click[0]])) fail('hover events');

// WR1: a double-click is two press-release pairs, the second counting 2; held keys ride on every event.
const dbl = clickAtPoint({ x: 10, y: 20 }, 2, 8);
if (dbl.map((e) => `${e.type}:${e.clickCount}:${e.modifiers}`).join(' ') !== 'mouseMoved:0:8 mousePressed:1:8 mouseReleased:1:8 mousePressed:2:8 mouseReleased:2:8') {
  fail(`double shift-click events: ${JSON.stringify(dbl)}`);
}

// WR1: a drag presses at the first point, moves with the button held, and releases at the last.
const drag = dragAlong([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 10 }]);
const moves = drag.filter((e) => e.type === 'mouseMoved' && e.buttons === 1);
if (drag[1]!.type !== 'mousePressed' || drag[1]!.x !== 0 || drag.at(-1)!.type !== 'mouseReleased' || drag.at(-1)!.x !== 100 || drag.at(-1)!.y !== 10) {
  fail(`drag ends: ${JSON.stringify([drag[1], drag.at(-1)])}`);
}
// 100 px in 20 px steps, then 10 px in one; never more than 10 steps a stretch.
if (moves.length !== 6 || moves[4]!.x !== 100 || moves[4]!.y !== 0) fail(`drag moves: ${JSON.stringify(moves)}`);
if (dragAlong([{ x: 0, y: 0 }, { x: 5000, y: 0 }]).length !== 13) fail('a long stretch should take 10 steps');
throws(() => dragAlong([{ x: 0, y: 0 }]), 'a one-point drag');

// WR1: points are two plain numbers with a comma; anything else isn't one (so click 4 stays element 4).
if (JSON.stringify(parsePoint('640,360.5')) !== '{"x":640,"y":360.5}') fail('point 640,360.5');
for (const bad of ['4', '640, 360', '-1,2', '1,2,3', '640x360', '123456,1', 'a,b']) if (parsePoint(bad)) fail(`${bad} is not a point`);

// WR1: flags after the points: double (clicks only) and held keys; anything else is a usage error.
if (JSON.stringify(mouseFlags(['double', 'shift', 'CTRL'], true, '')) !== '{"clicks":2,"modifiers":10}') fail('double shift ctrl');
throws(() => mouseFlags(['double'], false, ''), 'double on a drag');
throws(() => mouseFlags(['constructor'], true, ''), 'flag constructor');
throws(() => mouseFlags(['enter'], true, ''), 'flag enter');
// Live (draw.io): click 13 shift dropped the shift. A numbered click's script fallback refuses flags instead.
checkScriptClick(1, 0);
throws(() => checkScriptClick(1, mouseFlags(['shift'], true, '').modifiers), 'shift on a script click');
throws(() => checkScriptClick(2, 0), 'double on a script click');

// WR1: a 1280×800 picture of a 1536×960 viewport (a 125% screen, shrunk): pixels scale up by 1.2.
const view = toViewport([{ x: 640, y: 400 }, { x: 0, y: 799 }], { width: 1280, height: 800 }, { width: 1536, height: 960 });
if (JSON.stringify(view) !== '[{"x":768,"y":480},{"x":0,"y":958.8}]') fail(`toViewport: ${JSON.stringify(view)}`);
throws(() => toViewport([{ x: 1280, y: 0 }], { width: 1280, height: 800 }, { width: 1280, height: 800 }), 'a point past the right edge');
throws(() => toViewport([{ x: 10, y: 10 }], { width: 1280, height: 800 }, { width: 1280, height: 1000 }), 'a resized window');
// Seen live (Excalidraw): Chrome's debugging bar took 60 of 1005 picture pixels; a shrunk picture's rounding must pass.
if (sameLayout({ width: 1280, height: 1005 }, { width: 1280, height: 945 })) fail('the debugging bar should change the layout');
if (!sameLayout({ width: 1280, height: 1005 }, { width: 1536, height: 1206.4 })) fail('rounding of a shrunk picture should pass');
