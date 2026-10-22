// Content script: runs inside every web page (and every frame in it) and answers the side panel.
import { HandOver, STALE_MS, StopLine, type Message, type Replies } from '@/lib/messages';
import { aim, aimKey, aimPoints, aimText, click, focusHere, pasteText, clickText, endGuard, hover, pressKey, scroll, selectOption, typeText, watchMouse } from '@/lib/actions';
import { captchaKind, visibleCaptcha } from '@/lib/captcha';
import { onScreen } from '@/lib/in-view';
import { drawForShot, endShot, setOverlay } from '@/lib/overlay';
import { loadPage, withNote } from '@/lib/load-page';
import { findSnippets, findText, pageItems, pageLines, readText, TEXT_CAP, textTargets } from '@/lib/page-text';
import { notAlike, pickAll, pickLike } from '@/lib/pick';
import { getElements, read, secretOnScreen } from '@/lib/reader';
import { waitForQuiet } from '@/lib/settle';

// One handler per message type. The type checks each reply matches lib/messages.ts. Handlers may be async.
// Messages that act on the page. Inside a CAPTCHA's own frame they're refused (4.2).
const ACTIONS = new Set<Message['type']>(['click', 'clickText', 'aim', 'aimPoints', 'aimKey', 'aimText', 'pasteText', 'hover', 'type', 'select', 'scroll', 'key']);

const handlers: {
  [K in Message['type']]: (msg: Extract<Message, { type: K }>) => Replies[K] | Promise<Replies[K]>;
} = {
  ping: () => ({ url: location.href, title: document.title, contentType: document.contentType }),
  // The panel sends its overlay setting with every read, so a page opened since draws the numbers too.
  read: ({ next, overlay }) => {
    const reply = read(next);
    setOverlay(overlay, getElements());
    return { ...reply, page: pageLines(pageItems(getElements(), reply.lines)) };
  },
  // text all and find load a lazy page first (F3d; pick does it inside); plain text reads the screen as it is.
  text: async ({ all }) => {
    if (!all) return readText();
    const { lines, note } = await loadPage(() => readText(true).split('\n'), (l) => l.join('\n').length >= TEXT_CAP);
    return withNote(note, lines.join('\n'));
  },
  // stay: find stops scrolling where the words showed up, so its jump to the match is short.
  find: async ({ query, nth }) => withNote((await loadPage(() => findSnippets(query), (l) => l.length >= nth, true)).note, findText(query, nth)),
  pick: ({ selector }) => pickAll(selector),
  pickLike: ({ n }) => pickLike(n),
  alike: ({ n, items }) => notAlike(n, items),
  click: ({ n, allow }) => click(n, allow),
  textCount: ({ text }) => textTargets(text).length,
  clickText: ({ text, allow }) => clickText(text, allow),
  aim: ({ n, text, allow, hover }) => aim({ n, text }, allow, hover),
  aimDone: () => endGuard(),
  aimPoints: ({ points, shot, allow }) => aimPoints(points, shot, allow),
  aimKey: ({ key, allow }) => aimKey(key, allow),
  focusHere: () => focusHere(),
  aimText: ({ paste, allow }) => aimText(paste, allow),
  pasteText: ({ text, allow }) => pasteText(text, allow),
  hover: ({ n }) => hover(n),
  type: ({ n, text, enter, slow, allow }) => typeText(n, text, enter, slow, allow),
  select: ({ n, option, allow }) => selectOption(n, option, allow),
  scroll: ({ dir, n }) => scroll(dir, n),
  key: ({ key, allow }) => pressKey(key, allow),
  settle: ({ maxMs }) => waitForQuiet(maxMs),
  captcha: () => visibleCaptcha(),
  inView: () => onScreen(),
  overlay: ({ on }) => {
    setOverlay(on, getElements());
    return on ? 'Overlay on (redraws after every read)' : 'Overlay off';
  },
  shot: async ({ on }) => {
    if (on) await drawForShot(getElements());
    else endShot();
    return secretOnScreen();
  },
};

export default defineContentScript({
  matches: ['<all_urls>'],
  // Every frame, including about:blank and srcdoc frames, so iframes get their own reader.
  // Source: https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts
  allFrames: true,
  matchAboutBlank: true,
  matchOriginAsFallback: true,
  // Before any page script, so the click guard's listener is first in line (watchMouse).
  runAt: 'document_start',
  main() {
    watchMouse();
    browser.runtime.onMessage.addListener((msg: Message & { sentAt?: number }, _sender, sendResponse) => {
      // Arrived late (queued behind a browser dialog): the panel already gave up, so acting now would surprise the user.
      if (msg.sentAt && Date.now() - msg.sentAt > STALE_MS) return false;
      // TS can't link msg.type to its handler's parameter type, hence the cast.
      Promise.resolve()
        .then(() => {
          // A CAPTCHA is yours to solve: nothing acts inside one, not even with Allow once. A run pauses and hands over.
          // Frames only: a widget always sits in a frame. Names the frame, so a wrong refusal shows where it came from.
          const kind = ACTIONS.has(msg.type) && window.top !== window ? captchaKind(location.href) : null;
          if (kind) throw new HandOver(`CAPTCHA (${kind}, frame ${location.host}${location.pathname.slice(0, 60)}): solve it yourself on the page.`);
          return (handlers[msg.type] as (m: Message) => unknown)(msg);
        })
        .then(
          (value) => sendResponse({ value }),
          // Thrown errors don't cross the message channel, so send their text. Stop-lines and hand-overs go as their own kind.
          (err) => sendResponse(
            err instanceof StopLine ? { stop: err.message }
            : err instanceof HandOver ? { handOver: err.message }
            : { error: err instanceof Error ? err.message : String(err) },
          ),
        );
      // Keep the channel open for the async reply.
      // Source: https://developer.chrome.com/docs/extensions/develop/concepts/messaging
      return true;
    });
  },
});
