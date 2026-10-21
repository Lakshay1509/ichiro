# Benchmark tasks (round 2)

10 tasks copied from real browser-agent benchmarks, so we're not grading ourselves on tasks we made up.

- **WebVoyager** (rows 1, 6–10): 643 tasks on 15 live sites, the most quoted live-web benchmark. Goal text is verbatim; the task id is the dataset's.
- **WebGames** (rows 2–5): 51 small challenges, built to be easy for people and hard for agents. Each one shows a **password** when you pass, so pass/fail is exact. Open webgames.convergence.ai and click the challenge by name.

Rules: same as `results.md` (console text only, fresh tab, decline cookies). No logins. Amazon = read only, no cart. Google Flights = stop at results.

Answer keys: **golden** = must match. **example** = the benchmark's answer from late 2023; live sites change, so check against the page instead.

| # | Level | Source · id | Goal (verbatim) | Tests | Pass when |
|---|-------|-------------|-----------------|-------|-----------|
| 1 | Simple | WebVoyager · Cambridge Dictionary--42 | "Convert the Cambridge Dictionary homepage from English (UK) to Deutsch." | language menu | Homepage UI is in German (URL has `/de/`). Golden: click English (UK) → Deutsch |
| 2 | Simple | WebGames · Menu Navigator | "Navigate through a menu bar to find the secret option" | hover menus | Password shows in `text` |
| 3 | Medium | WebGames · OTP Entry | "Enter a 6-digit one-time password with auto-focusing inputs" | typing into inputs that jump focus | Password shows in `text` |
| 4 | Medium | WebGames · Popup Chaos | "Close the annoying popup windows to reveal the secret password" | stacked popups, timing | Password shows in `text` |
| 5 | Medium | WebGames · Nested Frames | "Navigate through nested iframes to find the hidden button" | iframes (never tested in the real extension) | Password shows in `text` |
| 6 | Medium | WebVoyager · Allrecipes--12 | "Search for a popular cookie recipe on Allrecipes with more than 1000 reviews and a rating of 4.5 stars or better." | reading star ratings + review counts on cards | Returns a recipe with ≥ 4.5★ and > 1000 reviews, matching its page. Example: Best Chocolate Chip Cookies, 4.6★, 14,493 reviews |
| 7 | Complex | WebVoyager · ArXiv--14 | "On ArXiv, how many articles have 'SimCSE' in the article and are originally announced in October 2023?" | advanced search form, date range | Returns **3** (golden) |
| 8 | Complex | WebVoyager · Huggingface--3 | "Look up a model with a license of cc-by-sa-4.0 with the most likes on Hugging face." | filter sidebar + sort menu | Models list filtered to cc-by-sa-4.0, sorted by likes; returns the top one. Example: replit/replit-code-v1-3b |
| 9 | Complex | WebVoyager · Amazon--8 | "Find the cheapest Samsung-made Android tablet with screen between 10-10.9 inches on Amazon." | brand + size filters, price sort, skip Sponsored | Returns name + price of the cheapest non-sponsored match. Example: Samsung Galaxy Tab S 10.5in (Renewed), $139.94 |
| 10 | Very complex | WebVoyager · Google Flights--4 | "Search for one-way flights from New York to London on Dec. 26th and filter the results to show only non-stop flights." | city autocomplete, date picker, trip-type menu, filter chips | Results show New York → London, One way, Dec 26 2026, Stops = Nonstop, every flight says "Nonstop" |

## How to run in your Chrome

### Setup (once)

1. `chrome://extensions` → reload icon on **Browser Agent** (picks up the latest build).
2. Open a **new tab** for each task.
3. Click the **Browser Agent** toolbar icon → the side panel console opens.
4. Type `overlay off`. Decide every step from the console text only, not by looking at the page.

### How each step works

- Every `click` / `type` / `hover` prints the new page list by itself. Numbers change after every command.
- `click <n>` = the number in `[ ]` in front of the line you want, e.g. `[12] link "Deutsch"` → `click 12`.
- `text` = the words on screen (prices, ratings, passwords). `scroll down` if something isn't listed.
- Cookie banner? Click its **Reject** / **Necessary only** button first.
- Write down: steps used, the biggest `~tokens` number you saw, and anything odd.

### 1 · Cambridge Dictionary

1. `goto https://dictionary.cambridge.org/`
2. Find the language button (named like `English (UK)`) → `click <n>`
3. Find `Deutsch` → `click <n>`
4. `ping` → **Pass** if the URL has `/de/`.

### 2 · WebGames · Menu Navigator

1. `goto https://webgames.convergence.ai`
2. Find `link "Menu Navigator"` → `click <n>`
3. `hover` the menus to open them. The agent's path: `hover` **View** → `hover` **Security** → `click` **Show Passwords**.
4. `text` → **Pass** if a password shows (agent got `MenuMaster2024`).

### 3 · WebGames · OTP Entry

1. `goto https://webgames.convergence.ai` → click **OTP Entry**
2. `text` → find the 6-digit code on screen.
3. Type one digit per box: `type <box 1> "4"`, then the next box, and so on. Watch `Focused: [n]` jump to the next box.
4. If there's a submit button, click it. `text` → **Pass** if a password shows (agent got `OTP_MASTER_2024`).

### 4 · WebGames · Popup Chaos

1. `goto https://webgames.convergence.ai` → click **Popup Chaos**
2. `click` the `button "✕"`, repeat until none is left (agent needed 5).
3. `text` → **Pass** if a password shows (agent got `PopupSlayer2024`).

### 5 · WebGames · Nested Frames (also checks the new iframe `text`)

1. `goto https://webgames.convergence.ai` → click **Nested Frames**
2. `text` → **new check:** lines under `--- iframe: … ---` should appear now.
3. `read` → under an `--- iframe ---` line, find `button "Click me to complete!"` → `click <n>`
4. `text` → **Pass** if a password shows (agent got `NestedVoyager`).

### 6 · Allrecipes

1. `goto https://www.allrecipes.com/`
2. Find the search box → `type <n> "cookie" enter`
3. Card links now read like `link "Shortbread Cookies 1,080 Ratings"`. Pick one with **over 1,000 ratings** → `click <n>`
4. `text` → **Pass** if the rating is **4.5 or more** and reviews are **over 1,000** (stars show as a number only on the recipe page).

### 7 · ArXiv

1. `goto https://arxiv.org/`
2. Find `Advanced Search` → `click <n>`
3. Search term box → `type <n> "SimCSE"`. Field → `select <n> "All fields"`.
4. Click the **Date range** radio → From `type <n> "2023-10"` → To `type <n> "2023-10"`.
5. Click the **Submission date (original)** radio → click **Search**.
6. `text` → look for "Showing 1–N of N results". The benchmark says **3**; the agent found **4** live (one paper added "SimCSE" in 2024).

### 8 · Hugging Face

1. `goto https://huggingface.co/` → click `link "Models"`. Close any promo popup.
2. Click the **Licenses** tab → find `cc-by-sa-4.0` → `click <n>`
3. Click the sort button → **Most likes**.
4. **Pass** if the URL ends `?license=license:cc-by-sa-4.0&sort=likes` and you return the top model (agent: `replit/replit-code-v1-3b`).

### 9 · Amazon (read only — never Add to Cart)

1. `goto https://www.amazon.com/` → location prompt: click **Dismiss**.
2. Search box → `type <n> "Samsung Android tablet" enter`
3. Left side: click **10 to 10.9 Inches**, then Brands **Samsung** (`scroll down` if not listed).
4. Sort → **Price: Low to High**.
5. `text` → skip results marked "Sponsored" → click the first other one.
6. `text` → **Pass** if it shows Brand Samsung, screen 10–10.9", and a price. "Cannot be shipped to your location" with no price = **Partial** (India).

### 10 · Google Flights (stop at results)

1. `goto https://www.google.com/travel/flights/` → reject cookies if asked.
2. Click the trip-type button (`Round trip`) → click `One way`.
3. Origin box → `type <n> "New York"` → click the New York suggestion. Destination → `type <n> "London"` → click the London suggestion.
4. Click **Departure** → click `Next` until December 2026 → click `gridcell "Saturday, December 26, 2026"` (days show the month now) → click **Done**.
5. Click **Search**. Then click **Stops** → click `radio "Nonstop only"`.
6. `text` → **Pass** if it shows New York → London, one way, Dec 26, and every flight says "Nonstop". Also check: no `clickable ""` next to the Stops radios.

### When you're done

Tell Claude your results (pass/fail + notes per task) and it'll add a "Benchmark run 4 — your Chrome" section to `results.md`.

## Not used (and why)

- **Online-Mind2Web** (300 tasks, 136 sites): task list is gated; needs a Hugging Face login + agreement.
- **WebArena / VisualWebArena**: self-hosted sites in Docker, too heavy for this PC.
- **BrowseComp**: hours-long research questions; needs AI to plan, Phase 1 has none.

## Sources

- WebVoyager tasks: https://github.com/MinorJerry/WebVoyager/blob/main/data/WebVoyager_data.jsonl
- WebVoyager answers: https://github.com/MinorJerry/WebVoyager/blob/main/data/reference_answer.json
- WebGames paper (task list, password scoring): https://arxiv.org/html/2502.18356
- WebGames challenge names: https://github.com/convergence-ai/webgames/blob/main/webgames/src/router/routes.ts
- Online-Mind2Web: https://huggingface.co/datasets/osunlp/Online-Mind2Web
