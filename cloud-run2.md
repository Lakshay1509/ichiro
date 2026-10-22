# Cloud run 2 · findings for fixing (2026-10-21)

Test-only run over MCP, Chrome for Testing 156, cloud IP (US). No code was changed.
Follow CLAUDE.md as usual: one fix at a time, test first, tell me which fix you're on.

## Results

1. #2 finred.usalearning.gov · pass · 13 calls · "increase your monthly savings to $645.00" → $395/month more
2. #3 Google Maps · pass · 3 · Manchester Airport→Etihad 10.3 mi; GWB→NYSE 14.0 mi → shorter
3. #4 bklynlibrary.org · blocked · 2 · Cloudflare Turnstile
4. #6 support.microsoft.com · pass · 6 · picture table, header row "Year · Category · Product · Sales · Rating"
5. #14 books, 3 retailers · partial · 10 · Books-A-Million (PB $21 / HC $32) + ThriftBooks (PB $16.41 / HC $22.37 new); B&N and Bookshop.org hit Turnstile
6. #17 Mummers bar · pass · 3 · For Pete's Sake, Maps About tab: "Wheelchair accessible restroom / parking lot"
7. #18 Philadelphia Museum of Art · not a valid result · 2 · I clicked the cookie banner's "I Agree". Its stop-line is by design (full consent; only necessary-only choices are exempt), and the banner didn't block the page. Re-run without touching the banner.
8. #19 martial arts near NYSE · pass (caveat) · 13 · Renzo Gracie Wall Street, 3 min walk; last adult class 6:00–7:30 PM
9. #20 Kroger careers · fail · 2 · stop-line false positive on the job-search city box (bug 1) · cause b
10. #23 Ron's Place · pass · 8 · no online booking; "Lunch Reservations Accepted" → phone (262) 657-5907
11. Bonus #27 Slider symphony · pass · 5 · password SMOOTHSLIDER42 (4 drags)

Total: ~68 browser calls.

## Harness bugs to fix (most important first)

### 1. Location search box treated as personal data
- Seen (Kroger): `Stop-line: type into [329] "City, state, country" (personal data: address). Needs your ok.`
- Cause: `lib/personal.ts` `personalKind` only skips the label-word check when `role === 'searchbox'` (line ~36). Kroger's box is a `combobox` (a search box with suggestions), so "city" matches the address words. Over MCP there's no goal text, so `inGoal` can't exempt it.
- Fix idea: also treat a search combobox (inside a search form or role=search, or with a "Find jobs/location"-style search next to it) as a search box. Still ask when autocomplete says `address-level2` etc.
- Check: a test where a combobox "City, state, country" in a job-search form gives null, while a checkout "City" textbox still says address.

### 2. MCP call times out at 60 s while the panel asks
- Seen: `MCP server "browser-agent-cloud" tool "browser" timed out after 60s`. The ask stays open in the panel, and the agent never gets the reply.
- Cause: Claude Code's MCP client gives up on a tool call after 60 s. `host/mcp.ts` `run()` waits for the panel with no time limit.
- Fix idea: send MCP progress notifications while waiting (if the client resets its timeout on progress; check the SDK docs), or return before 60 s with "waiting for the user: send `read` after they answer".
- Check: hold a stop-line ask for 2 minutes, then answer it. The agent gets a clean reply.

### 3. The CAPTCHA pause fires one call late
- Seen: `goto` onto a Turnstile page returns normally, though the read already shows `--- iframe: challenges.cloudflare.com (Turnstile: only the user may solve it) ---`. The pause only comes on the next command (`CAPTCHA on the page (Turnstile). Solve it yourself, then press Resume.`).
- Fix idea: run the same CAPTCHA check at the end of `goto` and of any action whose reply includes the page.
- Check: `goto` a Turnstile page. That call itself pauses.

### 4. A subdomain's home page is refused
- Seen: `goto https://finred.usalearning.gov/` gave `goto refused: … To use usalearning.gov, goto its home page (goto https://usalearning.gov/)`. usalearning.gov is dead (connection reset), so I lost 15 s. convergence.ai gives a 403.
- Also: approving the main domain opens every subdomain, which is wider than what the user named.
- Fix idea: when the URL is a home page (`/`) on any host, ask "Add <registrable domain>?" and load that exact URL.
- Check: `goto https://sub.example.org/` asks once and lands on sub.example.org.

### 5. Same-page clicks count as "a new page loaded"
- Seen 4× on Google Maps (tabs, place links). The reply says `Stopped: a new page loaded…` and drops the rest of the batch. `goto` + `look` in one batch is refused the same way.
- Fix idea: count it as a new page only on a real document load, not on a URL change from the page's own script (pushState). Allow `read`/`look` right after `goto`.
- Check: on Maps, `click <About tab>` + `find "wheelchair"` runs both.

### 6. Small ones
- `click N` after `find` scrolled away gives `Element [374] is not on screen`. It should scroll the element into view first.
- The Kroger reply said [332]–[334] were "Gone" and also still "Panel on top" (with "its elements: [332]–[334]").
- `key ctrl+=` says "ok" but can't zoom Chrome (page keys can't). It should say so.
- type: typing "18" into a box that already holds 18 says "the site may not have taken it". It should say the value was already there.

## Needs a check first (may be ours or the site's)

- **`back` skipped a page:** philamuseum → goto Maps search → goto Maps directions → `back` landed on philamuseum. Could be Google Maps rewriting its own history, or our `back`.
- **Widget controls missing from `read`** (renzograciewallst.com schedule):
  - "By day / By time" and "All Classes / Adults / Youth" aren't listed.
  - The day buttons show no selected state.
  - `click "By time"` fails though `text` shows those words (they sit inside the line "By day By time").
  - Clicking "Tue" changed the list but replied only `ok — real click` with no changes.
  - Likely cause: plain divs with click handlers and no roles. If the reader misses them, that's cause a.

## Not ours
- Turnstile on bklynlibrary.org, barnesandnoble.com and bookshop.org search: bot walls on the cloud IP. Re-run from home.
- Small screenshots (664×672): my test window was narrow, so that's setup.

## Round 1 fixes seen
- ✅ Panel ask buttons show without scrolling (~15 asks).
- ✅ Off-screen frames stay one line; replies stayed small.
- ✅ CAPTCHA label works. ⚠️ The pause comes late (bug 3).
- ✅ type: no false "didn't react" on 7 of 8 typed fields.
- ✅ find snippets run to the end of the sentence.
- Not seen: wide tables, downloads, find on element names.

## Setup notes
- `npm ci` hadn't run before the session, so the MCP tool didn't connect until a later worker restart.
- Container restart: the proxy port changed. Redoing steps 5, 6 and 10 worked, and the bridge remembered its Sites.
- `deb.deps` doesn't install as-is on Ubuntu 24.04 (`libasound2t64`, the `|` alternatives). The Chrome sandbox stayed on.
