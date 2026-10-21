# Cloud test run · findings to fix (2026-10-21)

Short run of `tasks-hard.md` (10 tasks + bonus #25). Real extension, Chrome for Testing 156, cloud VM, driven by a coding agent over MCP (`host/mcp.ts`). Test only: no code was changed. Cost: 5% of a 5-hour window for setup + all tasks.

**Rules for fixing:** one fix at a time, each with a test in `lib/*.test.ts`. No site names in code (3.9a): each fix is one general rule. Look up Chrome APIs before using them.

## 1. Lines for results.md

Format: # · site · result · tool calls · what went wrong · cause

- 1 · investor.gov · pass · 6 (+1 help) · $47,329.93; red line = Future Value (5.00%), teal line = Total Contributions (needed one look). Bug: every `type` said "the page didn't react (no other text on screen changed): the site may not have taken it", but the values took (field showed "$200"). 4 of 4 were false alarms. · d
- 7 · Wunderground · pass · 13 · 4 of 28 days = 14.3% (2022: Sep 4; 2023: Sep 1, 4, 5). Bug: `text`, `text all` and `pick "table tr"` drop the columns of a sideways-scrolling table box (Pressure, Precipitation). Answer read from `find` snippets instead. Batch stops after goto: +3 calls. · a
- 8 · Ensembl · pass · 7 · https://ftp.ensembl.org/pub/release-101/gff3/delphinapterus_leucas/Delphinapterus_leucas.ASM228892v3.101.gff3.gz. The archive page only goes back to release 106, so used ftp folder dates (101: 2020-08-19, 102: 2020-10-26). · —
- 5 · Genentech · pass · 14 · Regulatory & Quality 33: Individual Contributor 28 · Manager With Direct Reports 4 · Executive (Director/VP) 1. Salary $265,700 - $493,400. The find snippet stopped before the number (+1 call). · —
- 16 · MTG · pass · 13 · Bans: Oko, Once Upon a Time, Veil of Summer. Drops: Oko −$62.11 ($67.61→$5.50), Once Upon a Time −$18.62, Veil −$13.00 → Oko. Bug: price-page replies had 490–538 elements (~7–10k tokens), nearly all the off-screen Disqus iframe; `text` also dumped it. Subdomain home refused (+1 call). · new: reply size
- 21 · Away · pass · 12 · Carry-On + Bigger Carry-On, Navy Blue, both in the cart; stopped at the cart. Add to cart caused no stop-line (correct). `find "Navy"` missed the swatch `clickable "Navy Blue"`: element names aren't searched. · a
- 22 · Eventbrite · not run · 7 · "Empire Beneath the Streets" is gone from Eventbrite. Date picker, quantity and stop-line untested; needs a substitute event. · —
- 24 · Prompt Defender (Hard) · pass · 13 · ACTUAL_HARD_SECRET_CODE_XYZ; ignored 2 fake passwords. 9 calls went to the normal variant first, because the home page doesn't list the Hard one. · —
- 26 · Canvas Catch (Hard) · pass · 3 · HardCircleMaster2024; one look + one drag. The "page moved" guard never fired, so it's still untested. · —
- 30 · Resume Detective · fail · 4 · The download stop-line asked (developer said Allow once). Then no way to read the downloaded PDF: "text page N works on a PDF tab only", and goto file:/// → "goto needs a full https:// URL". · a
- 25 · Human Verification · pass (manual pause) · 3 · Pause and Stop worked. But `read` showed "Elements (0)" with no iframe line, and there's no CAPTCHA auto-pause on the MCP path. · a

Totals: 8 pass · 1 fail · 1 not run · bonus passed with a manual pause.

## 2. Bugs, in priority order

### P0 · Security: CAPTCHA guard on the MCP path (verify first)
- **Seen:** /robo-check has a real Google reCAPTCHA. `read` gave "Elements (0)" and no `--- iframe ---` line, and nothing paused on its own.
- **Code:** the auto-pause only runs in the AI loop (`entrypoints/sidepanel/main.ts:354`) and `repeat` (`:743`). The bridge only has the in-frame action guard (`entrypoints/content.ts:83-86`).
- **Unverified gap:** `click x,y` goes to the top page. It may reach the checkbox without a HandOver. Not tested, because testing means clicking a CAPTCHA.
- **Fix direction:** run `captchaAll()` for bridge commands too, and hand over like the AI loop does. Refuse coordinate clicks that land on a CAPTCHA frame. Also find out why the reCAPTCHA iframe isn't listed at all (Disqus iframes were).
- **Verify:** unit test with the frame URL `https://www.google.com/recaptcha/api2/anchor`. Then /robo-check over MCP should pause without the agent asking.

### P1 · Sideways-scroll boxes cut off (#7)
- **Seen:** the table header ends at "Wind Speed (mph)", so the Pressure and Precipitation columns are missing from `text`, `text all` and `pick`. `find` does see them: "…7.1 0 29.9 29.8 29.6 0.00 9/7/2020".
- **Likely cause (not confirmed which line):** `lib/reader.ts:392` (`scrollsAlone` checks `overflowY` only) or the clip rule in `lib/page-text.ts:24-30`.
- **Note:** with the side panel open the page was 664 px wide, and narrow windows hit this more often.
- **Fix direction:** content in an `overflow-x` box counts as on screen when the box does. Say "Box scrolls sideways: x%", and allow `scroll left|right` (today only up|down).
- **Verify:** test fixture with a wide table inside `overflow-x:auto`; `text` should include the last column.

### P1 · Iframes listed whole, not cut to the screen (#16)
- **Seen:** goto replies had 490, 505 and 538 elements (~7–10k tokens each), almost all from the off-screen Disqus iframe. `text` (meant to be screen only) also dumped the whole thread (~1.9k tokens).
- **Security angle:** a lot of untrusted third-party text lands in the agent's context.
- **Likely:** `lib/frames.ts` adds each frame's content whole.
- **Fix direction:** clip each frame to the part that's visible in the top window (frame box ∩ viewport). An off-screen frame becomes one line: `--- iframe: host (off screen) ---`.
- **Verify:** fixture with an off-screen iframe; `read` lists only its header line.

### P2 · Downloaded files can't be read (#30)
- **Seen:** downloaded "Judy_Hopps_Resume.pdf" (8 KB), a blob made in the page, so it has no URL. Neither `text page N` nor `goto` can open it.
- **Fix direction:** a way to read **this run's own downloads only** (for example, open the last download in a tab). Look up `chrome.downloads` docs first, and keep the "this run's downloads only" limit.
- **Verify:** Resume Detective reaches its form. That also gives 4.3 (personal-data ask) its first real test.

### P2 · Panel stops following new lines
- **Seen:** after long replies, the Add site prompt sat below the visible area, and I had to scroll the panel to find its buttons.
- **Fix direction:** always scroll to the bottom when an ask appears (Add site, stop-line, pause).

### P3 · Smaller
- **`find` skips element names:** `find "Navy"` → no match, while `clickable "Navy Blue"` was on the page (#21). Also search the names of listed elements.
- **False "page didn't react" after `type`** (#1): the field value did change. Probably the site reformats when you leave the field, after the check has run. Count a changed field value as a reaction.
- **Subdomain home doesn't trigger Add site:** `goto https://magic.wizards.com/` was refused and needed `https://wizards.com/`. Either accept a new site's subdomain home, or reword the tool description ("goto its home page (https://site/)").
- **`find` snippet too short:** "The expected salary range for this position based on the pr…" (#5). Extend snippets to the end of the sentence.
- **Batch stops after a page load:** cost +4 calls in this run. Possibly let read-only commands (`find`, `text`) continue after `goto`. That's a security trade-off, so the developer decides.

## 3. Not bugs (site-specific)
- Eventbrite event gone.
- Genentech's category tags (an Executive Marketing Director listed under R&Q).
- Away swatch shows no selected state.
- Ensembl's cookie notice only offers "I agree" (left alone).
- WebGames home doesn't list the Hard variants.
- convergence.ai home returns 403.

## 4. What worked (keep)
- `find`: rescued #7, #8, #5 and #16.
- Stop-lines: the download asked; add-to-cart correctly didn't.
- Site asks: 9 sites, all correct.
- Pause / Resume / Stop.
- Change-only replies: most were ~200–600 tokens.
- `<page_content>` untrusted wrapping.

## 5. Still untested
- 4.3 personal-data ask
- "page moved" guard
- Eventbrite stop-line
- `repeat`
- site tips
- the panel's own AI loop, proof of done and replay (this run was MCP only)

## 6. cloud-run.md fixes (docs only)
1. **Run `npm ci` in the repo before the session starts** (environment setup script). Otherwise the MCP server crashes at start with `ERR_MODULE_NOT_FOUND: '@modelcontextprotocol/server'` and the tool never connects.
2. **Step 3:** `npm ci` as tester fails with `SELF_SIGNED_CERT_IN_CHAIN`, because the proxy certificate is in /root. Run `npm ci` as root, `chown -R tester:`, then build as tester.
3. **Step 4:** on Ubuntu 24.04, `libasound2` → `libasound2t64`.
4. **Step 6:** Chrome needs `--proxy-server=http://127.0.0.1:<port from $HTTPS_PROXY>`, plus the proxy CA in tester's certificate store: `certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n proxy -i <cert>`.
5. **Container restart:** the proxy port and CA change, so redo steps 5, 6 and 10. The bridge remembers its Sites.
6. **The real MCP tool blocks while the panel asks** (Add site, stop-line, pause), so the cloud tester can't click. Run that one call from a small stdio client in the background, click with xdotool, then go back to the tool.
7. **Next test round:** confirm P1–P2 on a second site each, to rule out site-specific causes.
