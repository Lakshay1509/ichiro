// Overlay: draws each element's number on the page, so you can check the read list matches reality.

// Dark enough for white text; neighbours get different colors.
const COLORS = ['#c62828', '#1565c0', '#2e7d32', '#6a1b9a', '#00838f'];

let enabled = false;
let host: HTMLElement | undefined;

function clear() {
  host?.remove();
  host = undefined;
  removeEventListener('scroll', clear, { capture: true });
  removeEventListener('resize', clear);
}

function draw(elements: Map<number, Element>) {
  clear();
  host = document.createElement('div');
  // !important so page CSS can't move it. pointer-events:none lets clicks and elementFromPoint pass through.
  host.style.cssText = 'position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important';
  // Closed shadow root: page CSS can't reach the boxes. Styles go through .style, which strict page CSPs allow.
  const root = host.attachShadow({ mode: 'closed' });
  for (const [n, el] of elements) {
    const r = el.getBoundingClientRect();
    const color = COLORS[n % COLORS.length];
    const box = document.createElement('div');
    box.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;box-sizing:border-box;border:2px solid ${color}`;
    const label = document.createElement('span');
    label.textContent = String(n);
    label.style.cssText = `position:absolute;left:-2px;top:-2px;padding:0 3px;background:${color};color:#fff;font:bold 11px/1.3 monospace`;
    box.append(label);
    root.append(box);
  }
  // Outside <body>, so read never collects it.
  document.documentElement.append(host);
  // Positions go stale when anything scrolls (capture catches inner scroll boxes too) or the window resizes.
  addEventListener('scroll', clear, { capture: true, passive: true });
  addEventListener('resize', clear, { passive: true });
}

export function setOverlay(on: boolean, elements: Map<number, Element>) {
  enabled = on;
  if (on) draw(elements);
  else clear();
}

// F1a: numbers for one screenshot. Resolves once they're painted (two frames); capped, since a hidden frame never paints.
export async function drawForShot(elements: Map<number, Element>) {
  draw(elements);
  await Promise.race([
    new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    new Promise((done) => setTimeout(done, 150)),
  ]);
}

// After the screenshot: back to how you had it (overlay on keeps its numbers).
export function endShot() {
  if (!enabled) clear();
}
