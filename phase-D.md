# Phase 1 · D. Acting on the page (the "hands")

Goal: commands that act on elements from the latest `read`: click, type, select, scroll, keys, go to a URL, go back. After each action the extension waits for the page to settle and shows the new state.

**Before you start:** Phase C done (`read` gives a good numbered list, `getElement(n)` works).

**Rules**
- Do steps in order. Don't start the next step until its "Done when" passes.
- No AI/LLM calls anywhere in Phase 1.
- Every action uses `getElement(n)` from step 9. Never act on a stale element.
- Every action returns a clear result: `ok` + what changed, or an error that says why.

**Files**
```
lib/actions.ts   ← steps 12–14 (content script part)
lib/settle.ts    ← step 15
```
`goto` and `back` run in the side panel (they use `chrome.tabs`), not in the page.

**Known limit (read this first):** events created by JavaScript are marked "not real" (`isTrusted = false`). Most sites accept them. Some ignore them, and the browser never runs default actions for fake **key** events (a fake Tab doesn't move focus, a fake letter key doesn't type). When a site ignores an action, write it down; Phase 5 adds real input through `chrome.debugger`. Don't try to work around it here.

## 12. Click

**What:** `click <n>` clicks element n like a person would.

**How:**
1. `getElement(n)`.
2. `el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })`.
3. Re-measure its rect, then check the center point with `elementFromPoint`. If something else is on top (cookie banner, modal), **don't click**. Return `Element [n] is covered by <role> "<name>"` so the caller closes that first.
4. Dispatch, at the center coordinates, with `bubbles: true, composed: true`:
   `pointerover → pointerenter → mouseover → pointerdown → mousedown → focus → pointerup → mouseup → click`.
   Some menus open on `pointerdown` / `mousedown`, not `click`, which is why the full sequence.
5. Result: `ok`, plus `page changed URL` if `location.href` changed, plus `opened new tab` for `target=_blank` links (multiple tabs are handled in Phase 5).

**Done when:**
- `click N` works on 5 sites for links, buttons and checkboxes.
- Clicking an element behind a cookie banner returns the "covered by" error and clicks nothing.

## 13. Type

**What:** `type <n> "text"` puts text into a field so the site notices. `type <n> "text" enter` also presses Enter.

**How:**
- Focus the element and clear what's already there.
- `<input>` / `<textarea>`: React and Vue ignore a plain `el.value = …`. Use the native setter, then fire events:
  ```ts
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  ```
- `contenteditable` (rich editors, chat boxes): focus, select its contents, then `document.execCommand('insertText', false, text)`. It's deprecated but still the most reliable way to make editors notice.
- Slow mode: some autocompletes only react to typing letter by letter. Add `type <n> "text" slow`: for each character fire `keydown → keypress → (set value + input) → keyup`, about 30 ms apart.
- `enter`: fire `keydown` / `keypress` / `keyup` with `key: 'Enter', code: 'Enter', keyCode: 13`. If the field is in a `<form>` and nothing happened after ~300 ms, call `form.requestSubmit()`.
- Note for Phase 3: the safety guard will later block typing into password and card fields. Don't add that here.

**Done when:**
- In the YouTube, Google and Amazon search boxes the text appears **and** the site reacts (suggestions show up, Enter runs the search).
- Typing into a contenteditable box (e.g. a comment box) works.

## 14. The other actions

**What:** the rest of the basic command set.

**How:**
- **`select <n> "option"`** (native `<select>` only): find the option by visible text (case-insensitive, trimmed) or by value, set `el.value`, fire `input` + `change`. Not found → error listing the available options.
  Custom dropdowns made of `<div>`s are not `<select>`s: open with `click`, `read`, `click` the option. No special code.
- **`scroll up|down`**: scroll the window by 80% of the viewport height. If the window didn't move (`scrollY` unchanged), find the largest visible scrollable box (`overflow-y: auto|scroll` and `scrollHeight > clientHeight`) and scroll that instead.
  **`scroll up|down <n>`**: scroll inside element n (for lists inside popups or sidebars).
- **`key <Key>`**: fire `keydown` / `keyup` on the focused element. Support `Enter`, `Escape`, `Tab`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Backspace`.
  Works when the site listens for the key itself (Escape closing a modal, arrows in a menu). Browser defaults like Tab moving focus won't happen (see the known limit above).
- **`goto <url>`** (side panel): `chrome.tabs.update(tabId, { url })`.
  **Security:** only allow `http:` and `https:`. Reject `javascript:`, `data:`, `file:`, `chrome:` and anything else.
- **`back`** (side panel): `chrome.tabs.goBack(tabId)`.

**Done when:**
- Each command works on at least 2 sites.
- `goto javascript:alert(1)` is rejected with an error.
- `scroll down` works on a page that scrolls an inner box (e.g. a chat or mail app's message list).

## 15. Wait until the page settles

**What:** after every action, wait until the page stops changing, then show the new state, so you never act on an old view.

**How:**
- **Full page loads** (side panel): if the tab starts loading, wait for `chrome.tabs.onUpdated` with `status: 'complete'` for that tab. The new page has a fresh content script; `ping` it until it answers (use `sendToTab`, which injects if needed), max 5 s.
- **Same-page changes** (content script, for SPAs like YouTube): a `MutationObserver` on `document` (`subtree`, `childList`, `attributes`, `characterData`). Done when nothing changed for 500 ms.
- Hard cap: 5 s either way. Pages with videos or tickers never go quiet. When the cap hits, carry on and add `(page still changing)` to the result.
- After settling, the console **runs `read` automatically** and prints it. Same loop the AI agent will use: act → settle → read.

**Done when:**
- `click` on a Wikipedia link (full page load) prints the new article's list, not the old page.
- `click` on a YouTube video (SPA, no full load) prints the video page's list.
- On a page with a playing video the action still finishes within ~5 s.
