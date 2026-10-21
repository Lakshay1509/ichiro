# Phase 1 · E. Hard cases

Goal: make `read` and the actions work on the three page patterns that break simple readers: web components (shadow DOM), embedded frames (iframes), and things that only appear after a click or hover (menus, popups, modals).

**Before you start:** Phase D done (actions work, the console auto-reads after each action).

**Rules**
- Do steps in order. Don't start the next step until its "Done when" passes.
- No AI/LLM calls anywhere in Phase 1.
- After each step, re-test 3 sites that already worked. Don't break them.

**Files:** mostly changes to `lib/reader.ts`, `lib/actions.ts`, and the side panel's `sendToTab`.

## 16. Shadow DOM

**What:** some sites build their UI from web components. Their buttons live inside a hidden sub-tree (a "shadow root") that a normal `querySelectorAll` can't see. Reddit is a good test site.

**How:**
- Replace the single `querySelectorAll` with a walk: query the selector in a root, and for every element that has a shadow root, query inside that too (recursively).
- Get the shadow root with `chrome.dom.openOrClosedShadowRoot(el)`. Content scripts can use it, and unlike `el.shadowRoot` it also opens **closed** shadow roots.
- Covered check (step 7): `document.elementFromPoint` returns the outer component, not the button inside. Drill down: if the hit has a shadow root, call `elementFromPoint` on that shadow root, repeat until there's no deeper root.
- Names (step 8): `aria-labelledby` IDs belong to the element's own shadow root. Look them up in `el.getRootNode()`, not `document`.
- Clicks and typing need no change. Events are dispatched with `composed: true` already, so they cross the shadow boundary.

**Done when:**
- On Reddit, the vote, comment and share buttons of a post show up in `read` with sensible names.
- `click` on one of them works.

## 17. iframes

**What:** pages embed other pages in frames (forms, editors, video players, payment boxes). Each frame needs its own reader, and numbers must stay unique across all frames.

**How:**
- Content script options: `allFrames: true`, `matchAboutBlank: true`, `matchOriginAsFallback: true`. The script now runs in every frame, including blank and `srcdoc` frames.
- Add the `webNavigation` permission. In the side panel, `chrome.webNavigation.getAllFrames({ tabId })` lists frames. Send `read` to each with `chrome.tabs.sendMessage(tabId, msg, { frameId })`.
- Each frame reads only itself (its own viewport, its own map). Skip frames whose viewport is smaller than 50×50 (tracking pixels, hidden helper frames).
  `shortcut: a large but hidden iframe is still read; upgrade by having the parent frame report which iframe elements are visible`.
- **Numbering moves to the side panel:** the top frame's elements get 1..k, the next frame continues at k+1, and so on. The panel keeps `global number → { frameId, localNumber }` and sends actions to the right frame.
- Output: each frame's elements go under a line like `--- iframe: forms.example.com ---`.
- Expect noise from ad frames. Don't filter them yet; write down how bad it is in step 19.

**Done when:**
- On a page with an iframe (e.g. the w3schools "Try it" editor), elements inside the iframe show up with unique numbers.
- `click` and `type` on an element inside the iframe work.
- Top-page elements still work as before.

## 18. Popups, menus and modals

**What:** elements that only exist after an interaction. Most of this already works thanks to step 15 (act → settle → auto-read). This step fills the gaps.

**How:**
- **Click menus** (open on click): nothing new. Click, the auto-read shows the menu items, click one.
- **Hover menus:** add `hover <n>`: fire `pointerover → pointerenter → mouseover → mouseenter → pointermove → mousemove` at the element's center, then settle + read.
  Menus that open via JavaScript will work. Menus driven purely by CSS `:hover` won't (fake events don't trigger CSS hover); log these for Phase 5.
- **Modals:** step 7's covered check already hides what's behind them, and step 10's header shows `Modal open: "…"`. Check the modal's own buttons and close button are listed.
- **Cookie / consent banners:** these are normal elements. Make sure "Reject" / "Necessary only" buttons get clear names. Later the agent should prefer the most private option.
- **Native browser dialogs** (`alert`, `confirm`, `prompt`) block the page, and a content script can't see or close them. Detect it by the page not answering for 5 s, and print `page blocked — maybe a browser dialog is open`. Real handling is Phase 5.

**Done when:**
- On GitHub, opening a dropdown menu (e.g. the green "Code" button) shows its items in the auto-read, and clicking one works.
- One hover menu is tested: it works, or it's logged for Phase 5 with the site name.
- A cookie banner on a news site is listed and can be closed with `click`.
