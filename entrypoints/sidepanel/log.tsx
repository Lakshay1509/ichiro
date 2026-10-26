// Side panel log: Preact draws the background's log (lines, asks, agent calls, tip and site lists) above the command box.
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { apply, type FromPanel, type Item, type Log, type LogOp } from '@/lib/panel/panel-port';
import { stepStatus } from '@/lib/panel/readable-log';
import { deleteSite, deleteTip } from '@/lib/memory/site-store';
import { MAX_TIPS } from '@/lib/memory/site-tips';
import { CopyPrompt } from './onboarding';

const out = document.querySelector<HTMLElement>('#out')!;
let log: Log = { items: [], open: null };
let send: (msg: FromPanel) => void = () => {};

// shortcut: every change redraws the whole log (quick up to a few thousand lines); cache entries if long sessions lag.
// Keyed by id, so a Tips box keeps its state when older entries drop off the top.
const draw = () => render(<>{log.items.map((item) => <Entry key={item.id} item={item} />)}</>, out);

// hello: the whole log at once, and where your button presses go.
export function load(next: Log, post: (msg: FromPanel) => void) {
  log = next;
  send = post;
  draw();
  out.scrollTop = out.scrollHeight;
}

// One change, the same the background made to its copy. A new item scrolls to it.
export function change(op: LogOp) {
  apply(log, op);
  draw();
  if (op.type === 'show' || op.type === 'open') out.scrollTop = out.scrollHeight;
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
  // An ask's words: its first line is the headline (always ours, asks.ts writes it), the rest the detail.
  if (item.kind === 'line' && item.className === 'stop') {
    const [head, ...detail] = item.text.split('\n');
    return (
      <div class="stop">
        <div class="stop-head">{head}</div>
        {detail.length > 0 && <div>{detail.join('\n')}</div>}
      </div>
    );
  }
  if (item.kind === 'line') {
    return (
      <>
        <div class={item.className}>{item.text}</div>
        {item.more && (
          <details>
            <summary>Details</summary>
            <div class="well">{item.more}</div>
          </details>
        )}
      </>
    );
  }
  // The background decides what a press does; a press on an ask it already closed does nothing there.
  if (item.kind === 'ask') {
    return (
      <div class="ask">
        {item.buttons.map((label, button) => (
          <button type="button" onClick={() => send({ type: 'press', id: item.id, button })}>
            {label}
          </button>
        ))}
      </div>
    );
  }
  if (item.kind === 'step') {
    const status = stepStatus({ ended: item.ended, asking: item.items.some((i) => i.kind === 'ask') });
    // The agent's replies are for the agent: they wait in Details with its commands as sent. A one-action step's title
    // already says its action, so that line goes too.
    const lineOf = (i: Item, className: string) => i.kind === 'line' && i.className === className;
    const replies = item.items.flatMap((i) => (i.kind === 'line' && i.className === 'reply' ? [[i.text, i.more].filter(Boolean).join('\n')] : []));
    const shown = item.items.filter((i) => !lineOf(i, 'reply') && !(item.raw.length === 1 && lineOf(i, 'cmd')));
    return (
      <div class="step">
        <div class="step-head">
          <span class={`status ${STATUS_CLASS[status]}`}>{status}</span>
          <span class="step-title">{item.title}</span>
          <span class="step-n">Step {item.n}</span>
        </div>
        {shown.map((i) => <Entry key={i.id} item={i} />)}
        {/* RL3: closed until you open it; redraws leave its open state alone (no open prop). Source:
            https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details */}
        <details>
          <summary>Details</summary>
          <div class="well">{`The agent sent:\n${item.raw.join('\n')}${replies.length ? `\n\nIt got back:\n${replies.join('\n\n')}` : ''}`}</div>
        </details>
      </div>
    );
  }
  if (item.kind === 'sites') return <Sites sites={item.sites} />;
  // /update: Copy isn't autofocused, so focus stays in the command box.
  if (item.kind === 'prompt') {
    return (
      <div class="tips copy">
        <div class="tips-head">
          <span class="tips-site">Paste this into your coding agent</span>
        </div>
        <CopyPrompt text={item.text} />
      </div>
    );
  }
  return <Tips site={item.site} tips={item.tips} />;
}

// /sites: the bridge's Sites with Delete buttons, in the tips box. A Delete sends /sites remove <site>, as if you typed
// it: the background changes the live list and the saved one, and its reply line says how it went.
function Sites({ sites }: { sites: string[] }) {
  const [gone, setGone] = useState<string[]>([]);
  return (
    <div class="tips">
      <div class="tips-head">
        <span>
          <span class="tips-site">Trusted sites</span> · the agent works on these without asking you
        </span>
      </div>
      <ul>
        {sites.map((s) =>
          gone.includes(s) ? (
            <li class="gone">Removed: {s}</li>
          ) : (
            <li>
              <span>{s}</span>
              <button
                type="button"
                class="small danger"
                onClick={() => {
                  send({ type: 'line', text: `/sites remove ${s}` });
                  setGone((g) => [...g, s]);
                }}
              >
                Delete
              </button>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

// /tips: one site's saved tips with Delete buttons. Once a delete worked, its line says what went. Tips go by their
// text (deleteTip), so an old list is safe. A failed delete says so inside the box: only the background adds log lines.
function Tips({ site, tips }: { site: string; tips: string[] }) {
  const [allGone, setAllGone] = useState(false);
  const [gone, setGone] = useState<string[]>([]);
  const [error, setError] = useState('');
  const deleter = (label: string, job: () => Promise<void>, done: () => void) => (
    <button
      type="button"
      class="small danger"
      onClick={() => {
        setError('');
        job().then(done, (err: Error) => setError(`Not deleted: ${err.message}`));
      }}
    >
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
      {error && <div class="error">{error}</div>}
    </div>
  );
}
