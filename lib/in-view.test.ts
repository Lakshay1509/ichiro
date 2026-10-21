// Checks onScreen: a frame on the top page's screen, one off it, and no answer at all (a hidden tab). Run: npm test
import { onScreen } from './in-view.ts';

const fail = (what: string): never => {
  throw new Error(what);
};

// A stand-in IntersectionObserver: answer() is what the browser calls back with.
let answer: ((entries: unknown[]) => void) | null = null;
let watching = 0;
class FakeObserver {
  constructor(callback: (entries: unknown[]) => void) {
    answer = callback;
  }
  observe() {
    watching++;
  }
  disconnect() {
    watching--;
  }
}
Object.assign(globalThis, { IntersectionObserver: FakeObserver, document: { documentElement: {} } });
const seen = (width: number, height: number) => [{ intersectionRect: { width, height } }];

let shown = onScreen();
answer!(seen(300, 200));
if ((await shown) !== true) fail('a frame partly on screen should count as on screen');
shown = onScreen();
answer!(seen(0, 0));
if ((await shown) !== false) fail('a frame below the screen should count as off screen');
shown = onScreen();
answer!(seen(300, 0)); // touching the screen's edge only
if ((await shown) !== false) fail('a frame touching the edge should count as off screen');
if ((await onScreen(20)) !== null) fail('no answer (a hidden tab) should be null, so the frame is read as before');
if (watching !== 0) fail(`every observer should be disconnected, ${watching} left`);
