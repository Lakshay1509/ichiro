# Phase 1 · C. Reading the page (the "eyes")

Goal: one command, `read`, turns any page into a short numbered list of the things you can click or type into. This list is exactly what the AI will see later, so it must be enough to understand the page **without looking at it**.

Example output at the end of this section:
```
URL: https://www.youtube.com/
Title: YouTube
Scroll: 0% — more content below
Focused: [2]
Headings: H1 "Home"
Elements (31):
[1] button "Guide"
[2] searchbox "Search" value="python tutorial"
[3] button "Search"
[4] link "Python Full Course for Beginners"
[5] checkbox "Autoplay" checked
```

**Before you start:** Phase B done (`sendToTab` helper and the console work).

**Rules**
- Do steps in order. Don't start the next step until its "Done when" passes.
- No AI/LLM calls anywhere in Phase 1.
- Reading must never change the page (no clicks, no focus changes, no scrolling).

**Files**
```
lib/reader.ts    ← steps 6–10 (runs in the content script)
lib/overlay.ts   ← step 11
```
Add `read` and `overlay` to `lib/messages.ts` and the console commands.

## 6. Find interactive elements

**What:** collect every element a person could click or type into.

**How:**
- Query this selector on `document`:
  ```
  a[href], button, input:not([type=hidden]), select, textarea, summary,
  [role=button], [role=link], [role=checkbox], [role=radio], [role=switch],
  [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio],
  [role=option], [role=textbox], [role=searchbox], [role=combobox],
  [role=slider], [role=spinbutton], [role=treeitem],
  [contenteditable=""], [contenteditable=true], [tabindex]:not([tabindex="-1"]), [onclick]
  ```
- Many modern sites make `<div>`s clickable with JavaScript and no markup hint. Second pass: elements whose computed `cursor` is `pointer`. Keep only the **outermost** one (a pointer `<div>` containing a pointer `<span>` counts once).
- Remove duplicates: if an element is inside another collected element of the same kind (e.g. `<span>` inside a `<button>`), keep the outer one.
- Keep DOM order. Order is what the numbers follow.
- Speed matters: `getComputedStyle` is slow on huge pages. Time it.

**Done when:**
- `read` prints a count, e.g. `142 elements`.
- Count is above 0 on all 15 task sites from `tasks.md`.
- `read` takes under 300 ms on the Amazon homepage (print the time).

## 7. Keep only visible ones

**What:** drop everything you can't actually see or click right now.

**How:**
- Size: `el.getBoundingClientRect()` width and height > 0.
- CSS: `el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })` drops `display:none`, `visibility:hidden` and `opacity:0` (including hidden parents).
- Viewport only: the rect must overlap the visible window. Elements further down appear after scrolling (step 10 tells the reader there's more).
- Not covered: take the element's center point, call `document.elementFromPoint(x, y)`. Visible only if the hit is the element itself or something inside it. This drops page content behind cookie banners and modals.
- Disabled: keep it, but mark it (`el.disabled` or `aria-disabled="true"`).

**Done when:**
- The count drops to roughly what you can see on screen.
- With a modal or cookie banner open, elements behind it are **not** listed; the banner's buttons **are**.
- Disabled buttons show as disabled.

## 8. Role + name for each element

**What:** each line says what the element is and what it's called, like a screen reader would.

**How:**
- **Role:** explicit `role` attribute first. Otherwise from the tag:
  - `a[href]` → link; `button`, `summary`, `input[type=submit|button|reset]` → button
  - `input` text/email/tel/url/password → textbox; `input[type=search]` → searchbox
  - `checkbox` → checkbox; `radio` → radio; `range` → slider; `number` → spinbutton
  - `select` → combobox; `textarea` / `contenteditable` → textbox
  - anything else (pointer `<div>`s) → clickable
- **Name:** first non-empty of:
  1. `aria-labelledby` (text of the referenced elements, joined)
  2. `aria-label`
  3. for form fields: `el.labels` (the connected `<label>`)
  4. `alt` of the element, or of an `<img>` inside it (icon buttons)
  5. `title`
  6. `placeholder`
  7. visible text (`innerText`, whitespace collapsed)
  8. `value` for `input[type=submit|button]`
  
  Cut names to 80 characters.
- **State** (only when present): `value="…"` (text fields, cut to 40 chars), `checked`, `expanded` / `collapsed` (`aria-expanded`), `selected`, `disabled`.
- **Security:** never print the value of password fields or card fields (`type=password`, or `autocomplete` starting with `cc-`). Print `value=•••` instead.
- Line format: `[n] role "name" state…`

**Done when:**
- `read` on 3 sites gives lines like `[4] button "Search"`.
- You can describe each page correctly from the output alone, without looking.
- Icon-only buttons (YouTube's search icon, hamburger menus) have a real name, not `""`.
- A password field with text in it shows `value=•••`.

## 9. Number map

**What:** the page script remembers which number belongs to which element, so `click 4` later hits the right thing, and safely fails if the page changed.

**How:**
- In the content script: `let elements = new Map<number, Element>()`. Rebuilt from scratch on every `read`. Numbers start at 1, in DOM order.
- Export one function `getElement(n)` for the action steps:
  - not in the map → error `Element [n] not found — run read again`
  - `!el.isConnected` (removed from page) → error `Element [n] is gone — run read again`
- After a full page load the content script is brand new and the map is empty. That gives the same "run read again" error automatically.
- Numbers are **not** stable across reads; that's fine. Always act on the latest `read`.

**Done when:**
- `read`, then change the page (open a menu, go to another page), then a temporary `check 4` command returns the "gone / not found" error instead of pointing at a different element.

## 10. Page header

**What:** a few lines above the list so the reader knows where they are.

**How:**
- `URL:` and `Title:`
- `Scroll:` percentage from `window.scrollY`, `innerHeight` and `document.documentElement.scrollHeight`, plus `more content above` / `more content below`.
  - Some apps scroll an inner box, not the window (Gmail, many dashboards); the window shows 0%. Fine for now. Step 14's `scroll` handles inner boxes.
- `Focused:` the number of `document.activeElement` if it's in the list.
- `Modal open: "name"` if a visible `<dialog open>` or `[role=dialog][aria-modal=true]` exists.
- `Headings:` up to 10 visible `h1`–`h3` / `[role=heading]`, each cut to 60 chars.
- `Elements (N):` then the list.
- Also print an approximate size: `~N tokens` (characters ÷ 4). The AI pays per token later.

**Done when:**
- On 3 sites the header alone tells you which page you're on and whether there's more to scroll.
- `~N tokens` shows and is under ~3k on a normal page (Amazon may be higher. Note it, step 19 deals with it).

## 11. Numbered boxes overlay

**What:** draw each element's number on the page itself, so you can check the list matches reality. Your main debugging tool.

**How:**
- One container `<div>` attached to `document.documentElement`, with styles: `position: fixed; inset: 0; pointer-events: none; z-index: 2147483647`.
- Put it inside a **closed shadow root** so page CSS can't break it and it doesn't mess with the page.
- For each element: a box with a colored border at its `getBoundingClientRect()` position, and its number in a small label at the top-left corner. Cycle a few colors so neighbours differ.
- `pointer-events: none` matters: `elementFromPoint` ignores the overlay, so it doesn't break step 7.
- Never collect the overlay itself in `read`.
- Commands: `overlay on` (draw after every read), `overlay off` (remove).
- Positions go stale on scroll/resize: remove the boxes then; they come back on the next `read`.

**Done when:**
- Boxes line up with the right elements on 5 sites, including one with a sticky header.
- Clicking the page still works normally while the overlay is on.
- `overlay off` removes everything.
