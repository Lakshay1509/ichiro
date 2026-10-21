# Phase 1 · F results

Rules: decide every command from the console text only (overlay off, don't look at the page). Fresh tab per task. Stop before anything irreversible.

Causes: **a** missing from list · **b** unclear name · **c** action failed · **d** timing · **e** needs real input (→ Phase 5 list)

## Run 1 (by Claude, 2026-10-11)

How it ran: Claude's own test browser (no logins, located in India), with the same `lib/` reader + action code injected into each page. Not the real extension: no iframes, no side-panel tab-load wait (waited by hand instead), only open shadow roots.

**Result: 6 pass · 1 partial · 5 fail · 3 not run** (of the 12 runnable: 6 pass).

| # | Site | Pass/Fail | Steps used | Largest read (~tokens) | What went wrong | Cause |
|---|------|-----------|------------|------------------------|-----------------|-------|
| 1 | Wikipedia | Fail | 2 | ~548 | Reached the Alan Turing article, but the birth date is plain text; `read` only lists clickable things (infobox shows link "Maida Vale" only). Also a link with an empty name `""`. | a |
| 2 | Google | Not run | 1 | ~189 | Typing + Enter worked, then Google showed its bot-check (CAPTCHA) page in Claude's test browser. Not an extension problem; re-run in your Chrome. | — |
| 3 | Wikipedia | Pass | 3 | ~973 | — | — |
| 4 | YouTube | Pass | 3 | ~603 | Passed, but: search box is `combobox ""` (no name); every suggestion listed twice (option + button); `key Escape` went to "Guide" instead of the search box. | (b) |
| 5 | TodoMVC | Fail | 3 | ~124 | Todos added fine, but the done-checkboxes are missing: they're `opacity:0` over a custom look (still clickable — hit test lands on them). Also unnamed (label not linked). | a |
| 6 | GitHub | Pass | 2 | ~1053 | Stars 194k from `link "Star194k"`, latest release 1.141.0 from `link "1.141.0 Latest"` after one scroll. | — |
| 7 | YouTube | Fail | 4 | ~537 | Player controls missing: control bar is `opacity:0` (auto-hide) and the player has `tabindex=-1`, so there's nothing to `hover`. Old search dropdown stayed open until Escape on the box. | a |
| 8 | Reddit | Not run | — | — | reddit.com is blocked in Claude's test browser. Run in your Chrome (shadow DOM already passed in step 16). | — |
| 9 | Google Form | Not run | — | — | Needs your own test form. | — |
| 10 | GitHub | Pass* | 4 | ~1057 | *Only with manual waits: twice the read came before GitHub swapped in the new page (URL changes first, content 1–3 s later, no DOM changes meanwhile). Answer: #25843 "[DevTools Bug]: Electron support broken in 4.27". Also: on the unfiltered issue list only the first issue's title link was listed. | d |
| 11 | Amazon | Partial | 6 | ~839 | Search, 4★ filter, price sort, open first non-sponsored product all worked. No "Add to Cart": item can't ship to India (test browser location) — and that reason was plain text, invisible to `read`. Retry on amazon.in. Also 6 unnamed `radio ""` (image thumbnails). | (a) |
| 12 | Google Maps | Fail | 3 | ~322 | Results (L'Opéra Bikaner House, Cafe Lota, The Big Chill Cafe) appeared ~10 s after search — past the 5 s cap. Ratings are plain text, not in any name. | a |
| 13 | Excalidraw | Fail | 1 | ~240 | Toolbar is clear (`button "Rectangle"`), but drawing needs a drag on the canvas: no drag command, and canvas content is invisible to `read`. | e |
| 14 | Booking.com | Pass | 13 | ~921 | Dates 6–8 Nov, 2 adults, Free cancellation (`nflt=fc=2`), sorted Top reviewed (`order=score`). Hiccups: sign-in modal's Dismiss ignored the fake click (Escape worked); "Goa" autocomplete didn't react to fake typing; sort menu appeared after the read (needed one more read). | (d) |
| 15 | Wikipedia + GitHub | Pass | ~12 | ~571 | React 251k > Svelte 88.4k > Vue (vuejs/core) 54.6k. Done one tab at a time (multi-tab is Phase 5). Vue's infobox links to the org, not the repo — one extra hop. | — |

### Causes to fix (a–d), most impact first

1. ✅ **a — No page text.** `read` only lists clickable things, so any answer in plain text is invisible: #1 birth date, #12 ratings, #11 "can't ship here". **Fixed:** new `text` command = visible text on screen (top page only; scroll for more). See re-runs below.
2. ✅ **d — Settle ends too early on SPAs.** GitHub (#10), Google Maps (#12), Booking sort menu (#14): the page shows no DOM change for >500 ms while it fetches, then swaps content. **Fixed (adaptive, no fixed wait):** settle now also waits while the page's own data/script requests are running (`webRequest`, so slow internet waits longer) and while JS tasks of 50 ms+ run (a slow machine waits longer). Caps are only safety nets: 15 s total, 5 s for a DOM that never stops changing (videos). Checked with a fake SPA in a real page: requests of 0.3 / 2.5 / 8 s → settled at 0.8 / 3.1 / 8.6 s with new content; 1.5 / 3 s of busy JS → 2.0 / 3.5 s fully rendered; video-like page → 5.0 s. Old settle returned at ~0.5 s with stale content in both cases. **Not yet re-run in the real extension** (needs your Chrome: #10, #12, #14).
3. ✅ **a — Invisible-but-clickable checkboxes/radios.** `opacity:0` inputs over a custom look are dropped (#5). **Fixed:** checkbox/radio inputs at `opacity:0` are kept when the hit test lands on them; with no linked label they're named from their parent's text. **Re-run #5: Pass** (Claude's test browser, real `lib/` code injected): `checkbox "a"/"b"/"c"` listed → `click` b → `checked` → Active filter shows only a and c, footer "2 items left!".
4. ✅ **a — Auto-hidden controls.** YouTube player controls only appear on hover, and the player isn't listed (#7). Listing `<video>` alone wasn't enough: YouTube's toolbar stays `opacity:0` until a real CSS `:hover`, which fake events can't trigger, but its buttons are still clickable. **Fixed:** `read` no longer drops `opacity:0` elements; the hit test alone decides (this also covers fix 3). Also: `<video>` is listed as `video` (click it to pause), and toggle buttons show `pressed`. Noise check: +15 on a YouTube watch page (the whole player toolbar + 3 hover-only "More actions"), +0 on Amazon search, +0 on a GitHub repo. **Re-run #7: Pass*** (Claude's test browser, real `lib/` code injected): controls hidden while playing → `Pause (k)` listed → paused → Settings → `scroll down` in the menu → Playback speed → `button "1.5"` → rate 1.5; CC button toggles (`aria-pressed`). *Captions were already on in the test browser, so "turn on" = one click when off; the CC button's own label says "unavailable" (YouTube's aria-label bug).
5. ✅ **b — Unnamed / duplicate entries.** `combobox ""` (YouTube search), `link ""` (Wikipedia image), `radio ""` ×6 (Amazon), `button ""` (Booking clear); duplicates like option+button per YouTube suggestion, clickable+button "Dismiss" on Amazon. **Fixed:** names now fall back to an `aria-label` inside the element (icon buttons: Booking `button "Clear"`, Amazon "Go"/"Share", YouTube "Settings"), then to the end of the URL for image links (`link "File:Alan_turing_header.jpg"`). Nested entries with the same name are listed once (outer kept for its state, unless it's a generic `clickable` wrapper). Measured: Amazon product page 52 → 39 elements, unnamed 14 → 6, duplicates 6 → 0; Booking search unnamed 1 → 0. Still unnamed: Amazon's 6 image thumbnails (their label is an image with `alt=""` — nothing to name them from). YouTube's search box already reads `combobox "Search"` now.

### Re-runs after fix 1 (`text` command, by Claude, 2026-10-11)

Same setup as Run 1 (Claude's test browser, India, `lib/page-text.ts` injected). Clicks done with the test browser's own tools.

| # | Site | Pass/Fail | `text` size (~tokens) | Notes |
|---|------|-----------|-----------------------|-------|
| 1 | Wikipedia | Pass | ~483 | First screen shows "Born Alan Mathison Turing / 23 June 1912 / Maida Vale". |
| 12 | Google Maps | Pass* | ~183 | L'Opéra Bikaner House 4.3, Cafe Lota 4.4, The Big Chill Cafe 4.5. *Still needed a manual 10 s wait (fix 2). |
| 11 | Amazon | Partial | ~291 | Reason now readable: "This item cannot be shipped to your selected delivery location." Still no Add to Cart from India; re-run in your Chrome or on amazon.in. |

Found while re-running (both fixed): hidden icon labels glued onto neighbours ("contentMain menu"), and icon-font glyphs showed as blank lines on Google Maps.

### Run 2 — re-run of failed tasks after fixes 1–5 (by Claude, 2026-10-11)

Same setup as Run 1 (Claude's test browser, India, logged out, `lib/` bundled and injected); settle = `waitForQuiet` only (no `webRequest` half); the browser pane was **hidden**, which stalls rendering on some SPAs (see #10, #12).

**Result: 5 of 6 pass** (3 pass · 2 pass* · 1 partial).

| # | Site | Pass/Fail | Steps used | Largest read (~tokens) | What went wrong | Cause |
|---|------|-----------|------------|------------------------|-----------------|-------|
| 1 | Wikipedia | Pass | 2 | ~484 | — `text` shows "Born Alan Mathison Turing / 23 June 1912". Extra `read` check: no unnamed entries, image link is `link "File:Alan_turing_header.jpg"`. | — |
| 5 | TodoMVC | Pass | 10 | ~177 | — `checkbox "a"/"b"/"c"` listed → click b → `checked` → Active → only a and c; `text` "2 items left!". | — |
| 7 | YouTube | Pass | 11 | ~742 | — No ad. `Pause (k)` → Settings → Playback speed → `button "1.5"` (no menu scroll needed) → CC button → `pressed`. Checked after: paused, rate 1.5, captions on screen. Noise: `video ""`, speed `slider ""`, time listed twice (`clickable "0:33 / 3:33"` + `button "0 Minutes 33 Seconds…"`). | (b) |
| 10 | GitHub | Pass* | 19 | ~761 | #25843 "[DevTools Bug]: Electron support broken in 4.27" (same as Run 1). *Quiet-wait came too early on 3 of 4 SPA swaps, one extra `read` fixed each: Issues tab (old page at 0.66 s, new at ~1.2 s; first try >15 s, hidden pane), label filter (empty list at 0.63 s, filled ~1.0 s), sort (empty at 0.63 s, filled ~0.94 s). Opening the issue: quiet-wait was enough (2.3 s). Also: 2-line issue titles missing from `read` (hit test at the box centre lands between the lines). | d, a |
| 11 | Amazon | Partial | 22 | ~774 | Search, 4★ filter, "Price: Low to High" (custom dropdown options listed), first result (no "Sponsored") all worked. No Add to Cart: `text` shows "This item cannot be shipped to your selected delivery location." Not retried on amazon.in. Noise: `dialog ""` + `clickable ""` (popover focus-trap spans, new from fix 4), 6 `radio ""` still. | — (test location), (b) |
| 12 | Google Maps | Pass* | 7 | ~303 | L'Opéra Bikaner House 4.3, Cafe Lota 4.4, The Big Chill Cafe 4.5 (same as Run 1). *Fake Enter changed the title but didn't search; clicking Search did. Results only rendered after I forced frames with screenshots (pane hidden: `visibilityState` hidden, 0 animation frames). Quiet-wait returned at 0.5–0.9 s with no results. Real load time can't be judged here; Run 1's "~10 s" may be the same artifact. Names keep icon glyphs (`button " Price "`); search box becomes `combobox ""` on results. | d (env), e, b |

### Fixes after Run 2 (by Claude, 2026-10-11)

Each checked on the live page in Claude's test browser with the real `lib/` code injected.

1. ✅ **Regression from fix 4** (`dialog ""` / `clickable ""` on Amazon's sort popover): `opacity:0` is now kept only for real controls (buttons, links, inputs, ARIA widgets, video); things picked up just by `tabindex` or the pointer cursor are dropped again when invisible. Amazon sort dropdown open: the 2 focus-trap spans are on the page but not in `read`; 0 unnamed. YouTube player buttons and TodoMVC checkboxes are real controls, so they stay.
2. ✅ **Wrapped links missing (a)**: when the box centre misses, `read` and `click` now try the centre of each line the link wraps onto. GitHub issue list: the three 2-line titles were missing with the old check, now listed; `click` on one opened issue #37727.
3. ✅ **Icon glyphs in names (b)**: `name()` strips them too (one shared regex with `text`). Maps: `button "Price"`, `"Rating"`, `"Hours"`; 0 lines with glyphs.
4. ✅ **Unnamed button inputs (b)**: `<input type=submit|button|image>` with no label is named from its parent's text, like bare checkboxes; duplicate removal then merges it with its wrapper. Amazon search page: `button "Dismiss"`, `button "Change Address"`, 0 unnamed.
5. **Not fixed (no real name exists):** `video ""` (no label on YouTube's `<video>`), Maps search box on results (no label/placeholder/aria at all — its `value=` shows the query), Amazon's 6 thumbnails (`alt=""`), `&amp;` in an Amazon name (site's own text), YouTube's time shown as two different controls (different names, so not duplicates). Speed `slider ""` not looked at.

## Benchmark run 1 — tasks-benchmark.md #1–5 (by Claude, 2026-10-11)

How it ran: Claude's test browser (India, logged out), current `lib/` bundled and injected per page (`browser.dom.openOrClosedShadowRoot` shimmed to `el.shadowRoot`, so open shadow roots only); settle = `waitForQuiet` only. Iframes (#5) were same-origin, so the bundle was injected into every frame and read with continuing offsets, like `lib/frames.ts`. `text` = top page only, like the extension.

**Result: 4 pass · 1 not run** (of the 4 runnable: 4 pass). Every AG action worked first try; no fallback to the browser's own tools needed.

| # | Site | Pass/Fail | Steps used | Largest read (~tokens) | What went wrong | Cause |
|---|------|-----------|------------|------------------------|-----------------|-------|
| 1 | Cambridge Dictionary | Not run | 1 | ~27 | Cloudflare "Verify you are human" check (a CAPTCHA) in Claude's test browser, still there after ~25 s. `read` on it: `Elements (0)`. Re-run in your Chrome. | — |
| 2 | WebGames · Menu Navigator | Pass | 15 | ~640 (challenge list) | — Password `MenuMaster2024`. Fake `hover` opened every menu and submenu; searched File, Edit, View → Security ▶ `button "Show Passwords"`. Noise: submenu item New ▶ File reads `button "File"`, same as the top-level File. | (b) |
| 3 | WebGames · OTP Entry | Pass | 13 | ~640 (challenge list) | — Password `OTP_MASTER_2024`. One digit per box; `Focused:` followed the auto-jump ([1] → [2]). All 6 boxes are `textbox ""`: no label, placeholder or aria on the site at all. | (b) site |
| 4 | WebGames · Popup Chaos | Pass | 11 | ~640 (challenge list) | — Password `PopupSlayer2024`. `text` showed 5 popups; `read` listed only the 3 uncovered `button "✕"` (covered ones correctly left out). Closing one revealed the next; 5 clicks. All close buttons named `"✕"`, nothing says which popup. | (b) |
| 5 | WebGames · Nested Frames | Pass | 8 | ~640 (challenge list) | — Password `NestedVoyager`. 6 nested same-origin frames; top + 5 empty frames skipped, deepest gave `[1] button "Click me to complete!"`, click reached the right frame. Password then showed on the top page. Caveats: before the click, `text` (top only) showed just the instruction line, nothing from inside the frames; every frame is labelled `--- iframe: webgames.convergence.ai ---` (hostname only). | — |

No new cause-e items. Finding a challenge on the WebGames home page took 2–3 `scroll down` + `read` (only on-screen items are listed, 56 links in total).

## Benchmark run 2 — tasks-benchmark.md #6–8 (by Claude, 2026-10-11)

How it ran: same setup as Benchmark run 1 (Claude's test browser, India, logged out, current `lib/` injected per page, open shadow roots only, settle = `waitForQuiet` only). The pane was hidden, so a screenshot was sometimes needed before the page rendered.

**Result: 2 pass · 1 pass\*** (#7 found 4, golden says 3; the golden answer is out of date, see row). Every AG action worked first try. No fallback to the browser's own tools needed.

| # | Site | Pass/Fail | Steps used | Largest read (~tokens) | What went wrong | Cause |
|---|------|-----------|------------|------------------------|-----------------|-------|
| 6 | Allrecipes | Pass | 8 | ~264 | — Best Chocolate Chip Cookies. Recipe page `text`: "4.6 (19,332) 14,911 Reviews". **Stars:** on search cards they're icons only. `text` shows "19,332 Ratings" but no star value, so ≥ 4.5 can only be checked on the recipe page (`clickable "4.6"`; the star icons read `clickable ""`). **Card names** come from the photo's alt text, not the title: `link "a close up view of a pile of best ever chocolate chip cookies with one broken in"`. Had to match titles via `text`. | a (site), b |
| 7 | arXiv | Pass* | 31 | ~1,061 (home) | *Answer **4**, golden 3. Path: Search → Advanced search → "SimCSE", All fields, Date range 2023-10 to 2023-10. "Announcement date" gave 0 results, though the form values reached arXiv fine (its Query line: "date_range: from 2023-10-01 to 2023-10-31"). "Submission date (original)" gave 4, all "originally announced October 2023". The 4th one (2310.10962) only got "SimCSE" in its May 2024 v2 abstract (v1 doesn't mention it), so the answer was 3 in 2023. Also: first 2 reads on the Advanced page were `(0 listed of 0)` with the page still `loading` (hidden pane), until a screenshot. | — (site data changed), d (env) |
| 8 | Hugging Face | Pass | 14 | ~724 | — replit/replit-code-v1-3b, 745 likes (same as the 2023 example). Models → Dismiss promo → `button "Licenses"` → `link "cc-by-sa-4.0"` → `button "Sort: Trending"` → `button "Most likes"` (URL `?license=license:cc-by-sa-4.0&sort=likes`). Noise: likes vs downloads unlabelled ("1.81k • 745", icons); names cut at 80 chars mid-number (`… • 713 • 27` for 276 likes); `text` included HF's screen-reader-only nav (25 lines like "HuggingChat", not on screen); the chosen license has no `selected` state (only `button "Licenses 1"` hints); `button "" collapsed`. | b |

### Bugs found in `lib/` (b), most impact first

1. **Photo alt beats link text** (`lib/reader.ts:166`). A card link with a photo + title gets named after the photo. Every Allrecipes card (above), and home page cards too: `link "Country fried steak with gravy and mashed potatoes served on a plate"`. Idea: use the image alt only when the link has no text of its own (icon links).
2. **Silent cut at 80 chars** (`lib/reader.ts:177`). Can show a wrong number: `link "defog/llama-3-sqlcoder-8b Text Generation • 8B • Updated Jul 24, 2024 • 713 • 27"` (real likes: 276). Idea: add "…" when cut.
3. **Screen-reader-only text in `text`** (`lib/page-text.ts:47`). HF's `nav.sr-only` (1 px box, `overflow:hidden`, `clip-path: inset(50%)`) passes `checkVisibility`, and its text still reports full-size rects. Idea: skip text inside a tiny `overflow:hidden` / clipped box.

No new cause-e items. No page over ~3k tokens.

## Benchmark run 3 — tasks-benchmark.md #9–10 (by Claude, 2026-10-11)

How it ran: same setup as Benchmark runs 1–2 (Claude's test browser, India, logged out, current `lib/` injected per page and re-loaded from sessionStorage after each page load, open shadow roots only, settle = `waitForQuiet` only, pane hidden).

**Result: 1 pass · 1 partial** (#9 found the right tablet, but Amazon hides its price from India, same as task #11). Every AG action did what it should. The one browser-tool retry (#10 Reload) proved a site error, not ours.

| # | Site | Pass/Fail | Steps used | Largest read (~tokens) | What went wrong | Cause |
|---|------|-----------|------------|------------------------|-----------------|-------|
| 9 | Amazon | Partial | 14 | ~704 | **Samsung Galaxy Tab A 10.1 Inch (T510) 3GB, 32GB, WiFi, Silver (2019) (Renewed)**, no price. Path: Dismiss location popover → search "Samsung Android tablet" (goal wording) → `link "Apply 10 to 10.9 Inches filter…"` → `link "Apply Samsung filter…"` (Brands) → `Price: Low to High` → first result (no "Sponsored", URL `ref=sr_1_1`). Product page `text`: "Brand Samsung", "Screen Size 10.1 inches". **No price:** results and product page say "This item cannot be shipped to your selected delivery location". The price isn't in the DOM either, so `read`/`text` didn't miss it. Price sort cut the list from 69 to 30 results (items with no price shown are dropped). Fake Enter didn't search; the built-in form-submit fallback did. Noise: 5 `radio ""` thumbnails (known); `link "INR 53,127.38 INR53,127 . 38"` (hidden screen-reader copy of the price read too, like the known `text` bug). | — (test location), (b) |
| 10 | Google Flights | Pass | 29 | ~704 | — One way, New York → London, `textbox "Departure" value="Sat, Dec 26"` (2026), `button "Nonstop, Stops, Selected"`, 22 results, and all 22 say "Nonstop" (scrolled to the end; JFK/EWR → LHR, from ₹40,791). Fast typing worked for both autocompletes. **Site hiccup:** first search showed "Oops, something went wrong". AG's Reload click sent a new request, and so did the browser's own click, but the server answered with an error both times, so it was a page problem. Reloading the same URL (the extension's `goto` can do this) loaded results. **Calendar:** day cells read `gridcell "1"` … `gridcell "31"` for two months with no month in the name; needed `text` to tell which block was December. `Modal open:` still said "October" after paging to Nov–Dec. Noise: 4 `clickable ""` next to the Stops radios; 2 `button ""` (prev/next-day arrows, `aria-hidden` with no label on the site); flight rows glue airline names (`"Virgin AtlanticAir France"`) and get cut before the price (known 80-char bug). | (b), — (site error) |

### Bugs found in `lib/` (b), most impact first

1. **Calendar days have no month** (`lib/reader.ts:169` wins before `:174`). Google Flights cell: `<div role="gridcell" data-iso="2026-10-26"><div role="button"><div aria-label="Monday, October 26, 2026">26</div>`. `innerText` "26" is used before the nested `aria-label`, so two months read as identical `gridcell "1"` … `"31"`. Idea: use the nested `aria-label` when it contains the element's whole text.
2. **Stale `Modal open:` name** (`lib/reader.ts:257`, which calls `name()`). An unlabelled dialog is named from the first 80 chars of its whole `innerText`, including parts scrolled out of its box: `Modal open: "One way Reset October S M T W T F S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18"` even while Nov–Dec were showing. Idea: name dialogs from their label or first heading only.
3. **Unnamed pointer wrappers next to real controls** (`lib/reader.ts:84`, pointer-cursor rule). Google Flights' Stops popover: `[27] clickable ""`, `[28] radio "Any number of stops" checked`, `[29] clickable ""`, `[30] radio "Nonstop only"` … (4 in total). Not looked into further.

No new cause-e items. No page over ~3k tokens.

### Fixes after benchmark runs 1–3 (by Claude, 2026-10-11)

Checked on a fixture page (one case per bug, copied from the read lines above) with the old code first (all 6 DOM bugs showed), then the fixed code (all gone), in Claude's test browser with `lib/` injected. Unit tests for the new `cut` and `saysMore`. Typecheck, `npm test` (5/5) and build pass.

1. ✅ **Photo alt beat the link's own text (b).** `name()` now uses an inner image's alt only when there's no text (icon buttons keep working: `button "Search"`). Live on Allrecipes search: `link "close up on a plate of shortbread cookies"` → `link "Shortbread Cookies 1,080 Ratings"`; 0 unnamed of 14.
2. ✅ **Names cut with no marker (b).** Cut names, headings and values now end in "…": `… • 713 • 2…` instead of a fake like count `27`.
3. ✅ **Calendar days had no month (b).** If a label inside repeats the visible text and says more, it's used: `gridcell "26"` → `gridcell "Saturday, December 26, 2026"`. Whole-word match, so "A" doesn't match "Archive".
4. ✅ **Stale `Modal open:` (b).** A dialog is named only from its label or first heading, else just `Modal open`. No more "One way Reset October…".
5. ✅ **Unnamed wrapper around a control (b).** A `clickable ""` that holds a listed control is dropped: fixture shows only `radio "Nonstop only"`. *Assumes Google's wrapper contains the radio (the read order says so; DOM not checked) — confirm on Google Flights in your Chrome.
6. ✅ **`text` printed screen-reader-only text (b).** Absolute boxes of ≤ 1 px that clip (`overflow`, `clip`, `clip-path`) are skipped: Hugging Face's `sr-only` menu and Amazon-style hidden price copies. `text` on Allrecipes still 21 ms.
7. ✅ **`text` read the top page only (a).** New `textAll()` in `lib/frames.ts` adds each frame's text under `--- iframe: host ---`, like `read`. **Not tested yet** (needs the real extension): re-run WebGames Nested Frames in your Chrome.
8. **Not fixed:** iframe header shows the host only (never seen misleading in the real extension); duplicate price text inside Amazon link names (the visible copy is `aria-hidden`; skipping it needs a custom text walk); glued names like "Virgin AtlanticAir France", unnamed OTP boxes, "✕" buttons, two "File" buttons (site's own markup).

## Harness Checkpoint A (by the developer, real extension in their Chrome, 2026-10-12)

Labels instead of numbers, stop-lines on.

| # | Site | Pass/Fail | Notes |
|---|------|-----------|-------|
| 1 | Wikipedia | Pass | Search by label, birth date via `text`. |
| 2 | Google | Pass | First run in a real Chrome (Run 1 hit a CAPTCHA in Claude's test browser). |
| 11 | Amazon | Pass | Item in cart; the checkout button stopped and asked. |

## Pages over ~3k tokens

None in this run. Largest: GitHub repo/issue pages ~1,050 tokens. Benchmark run 2: none either (largest: arXiv home ~1,060). Benchmark run 3: none (largest ~700: Amazon filtered search, Google Flights results).

| Page | ~tokens | What bloats it |
|------|---------|----------------|

## Phase 5 list (cause e)

| Site | What happened |
|------|---------------|
| YouTube (#7) | "Skip ad" button ignored the fake click (button exists, click dispatched, ad kept playing). |
| Booking.com (#14) | Sign-in modal "Dismiss" button ignored the fake click (Escape key worked). |
| Booking.com (#14) | Destination autocomplete didn't react to fake typing (search still worked with the typed text). |
| Google Maps (#12) | Fake Enter in the search box didn't search; search button click did (slowly). |
| Excalidraw (#13) | Canvas drawing needs real pointer drag; canvas content can't be read. |
