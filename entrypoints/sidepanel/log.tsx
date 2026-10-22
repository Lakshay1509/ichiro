// Side panel log: Preact draws the lines, asks and tip lists above the command box. main.ts says what to show.
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { stepStatus } from '@/lib/readable-log';
import { deleteSite, deleteTip } from '@/lib/site-store';
import { MAX_TIPS } from '@/lib/site-tips';

// RL2: one agent call, its lines inside. raw: its commands as sent (RL3). ended: set once the call has replied.
export type Step = { kind: 'step'; title: string; raw: string[]; items: Item[]; ended?: 'Done' | 'Stopped' };
// One thing in the log. Its text is often page or agent text: JSX shows it as text, never as HTML.
export type Item =
  | { kind: 'line'; text: string; className?: string; more?: string } // more: behind a click (RL4)
  | { kind: 'ask'; buttons: { label: string; onClick: () => void }[] }
  | { kind: 'tips'; site: string; tips: string[] }
  | Step;

const out = document.querySelector<HTMLElement>('#out')!;
let items: Item[] = [];
let open: Step | null = null; // the agent call that new items go into

// shortcut: every change redraws the whole log (quick up to a few thousand lines); cache entries if long sessions lag.
const draw = () => render(<>{items.map((item) => <Entry item={item} />)}</>, out);

// Adds an item at the bottom (inside the open agent call, if any) and scrolls to it. Returns it, for swap.
export function show<T extends Item>(item: T): T {
  (open ? open.items : items).push(item);
  draw();
  out.scrollTop = out.scrollHeight;
  return item;
}

// Puts item where old is (an ask becomes what you chose). Nothing if /clear took old away.
export function swap(old: Item, item: Item) {
  for (const list of [items, ...items.flatMap((i) => (i.kind === 'step' ? [i.items] : []))]) {
    const i = list.indexOf(old);
    if (i < 0) continue;
    list[i] = item;
    return draw();
  }
}

export function clearLog() {
  items = [];
  open = null;
  draw();
}

// RL2: an agent call's block; what prints until it ends goes inside it.
export function openStep(title: string, raw: string[]): Step {
  open = null; // a call never nests in another
  return (open = show<Step>({ kind: 'step', title, raw, items: [] }));
}

export function closeStep(step: Step, ended: 'Done' | 'Stopped') {
  step.ended = ended;
  if (open === step) open = null;
  draw();
}

// Your own commands print outside the agent's block (its status still updates when it ends).
export function leaveStep() {
  open = null;
}

// While you're at the bottom, the log stays there when the panel gets shorter or narrower (Chrome's debugging bar
// coming in, a resize): else an ask's buttons slide below the visible area. Only the scroll changes, so no resize loop.
// Source: https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver
let atBottom = true;
out.addEventListener('scroll', () => (atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 8));
new ResizeObserver(() => {
  if (atBottom) out.scrollTop = out.scrollHeight;
}).observe(out);

// Color is only a second cue: the status word says it. Same colors as errors and asks elsewhere in the log.
const STATUS_CLASS: Record<ReturnType<typeof stepStatus>, string> = { Running: 'running', Done: 'done', Stopped: 'stopped', 'Waiting for you': 'waiting' };

function Entry({ item }: { item: Item }) {
  if (item.kind === 'line') {
    return (
      <>
        <div class={item.className}>{item.text}</div>
        {item.more && (
          <details>
            <summary>What the agent got</summary>
            <div class="well">{item.more}</div>
          </details>
        )}
      </>
    );
  }
  if (item.kind === 'ask') return <div class="ask">{item.buttons.map((b) => <button type="button" onClick={b.onClick}>{b.label}</button>)}</div>;
  if (item.kind === 'step') {
    const status = stepStatus({ ended: item.ended, asking: item.items.some((i) => i.kind === 'ask') });
    return (
      <div class="step">
        <div class="step-head">
          <span class={`status ${STATUS_CLASS[status]}`}>{status}</span>
          <span class="step-title">{item.title}</span>
        </div>
        {item.items.map((i) => <Entry item={i} />)}
        {/* RL3: closed until you open it; redraws leave its open state alone (no open prop). Source:
            https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details */}
        <details>
          <summary>Commands as sent</summary>
          <div class="well">{item.raw.join('\n')}</div>
        </details>
      </div>
    );
  }
  return <Tips site={item.site} tips={item.tips} />;
}

// /tips: one site's saved tips with Delete buttons. Once a delete worked, its line says what went. Tips go by their
// text (deleteTip), so an old list is safe.
function Tips({ site, tips }: { site: string; tips: string[] }) {
  const [allGone, setAllGone] = useState(false);
  const [gone, setGone] = useState<string[]>([]);
  const deleter = (label: string, job: () => Promise<void>, done: () => void) => (
    <button type="button" class="small danger" onClick={() => job().then(done, (err: Error) => void show({ kind: 'line', text: `Not deleted: ${err.message}`, className: 'error' }))}>
      {label}
    </button>
  );
  if (allGone) return <div class="tips">{site}: all tips deleted.</div>;
  return (
    <div class="tips">
      <div class="tips-head">
        <span>
          <span class="tips-site">{site}</span> · {tips.length} of {MAX_TIPS} tips
        </span>
        {deleter('Delete all', () => deleteSite(site), () => setAllGone(true))}
      </div>
      <ul>
        {tips.map((t) =>
          gone.includes(t) ? (
            <li class="gone">Deleted: {t}</li>
          ) : (
            <li>
              <span>{t}</span>
              {deleter('Delete', () => deleteTip(site, t), () => setGone((g) => [...g, t]))}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
