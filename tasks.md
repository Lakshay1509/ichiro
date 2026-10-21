# Test tasks

Ordered simple → very complex. No logins needed except #9. Never go past cart (#11) or results (#14). Decline cookie banners.

| # | Level | Site | Goal | Pass when |
|---|-------|------|------|-----------|
| 1 | Simple | Wikipedia | Open the "Alan Turing" article, read his birth date from the infobox | Returns "23 June 1912" |
| 2 | Simple | Google | Search "wxt framework", open the first non-ad result | Active tab is on wxt.dev |
| 3 | Simple | Wikipedia | From the main page, search "Python (programming language)", jump to the "History" section | URL ends in `#History` and that heading is on screen |
| 4 | Medium | YouTube | Search "lofi hip hop", open the first result that is not an ad or a Short | URL is `/watch?v=…` and the video is playing |
| 5 | Medium | TodoMVC (SPA) — todomvc.com/examples/react/dist/ | Add todos "a", "b", "c", mark "b" done, click the "Active" filter | List shows only "a" and "c"; footer says "2 items left" |
| 6 | Medium | GitHub | On github.com/microsoft/vscode, read the star count and latest release tag | Both values match the page |
| 7 | Medium | YouTube | On a playing video: pause, set speed to 1.5× via the settings menu, turn captions on | Video paused, speed 1.5×, CC button active |
| 8 | Complex | Reddit | Open r/programming, sort Top → This Week, return the top 3 post titles | 3 titles match the page, in order |
| 9 | Complex | Google Form (your own test form) | Fill short text, multiple choice, checkboxes, dropdown and date fields, then submit | "Your response has been recorded" shows, and the Responses tab has the exact values |
| 10 | Complex | GitHub | In facebook/react, filter open issues by label "Type: Bug", sort by recently updated, open the top one | Returns its title and #number, matching the issue page |
| 11 | Complex | Amazon | Search "USB-C cable 2m", filter 4★ & up, sort price low → high, add the first non-sponsored result to cart. **Stop at cart.** | Cart shows that item, qty 1; checkout never opened |
| 12 | Very complex | Google Maps (SPA) | Search "coffee near India Gate, Delhi", return name + rating of the first 3 results rated ≥ 4.3 | 3 names and ratings match the side list (needs scrolling a lazy list) |
| 13 | Very complex | Excalidraw (canvas SPA) — excalidraw.com | Draw a rectangle, put the text "hello" inside it, set its stroke to red | Canvas shows a red rectangle containing "hello" |
| 14 | Very complex | Booking.com | Search Goa, check-in = first Friday of next month, 2 nights, 2 adults, 1 room; filter "Free cancellation"; sort by review score. **Stop at results.** | Results page shows those dates and guests, filter active, sort applied |
| 15 | Very complex | Wikipedia + GitHub, multi-tab | Open the Wikipedia articles "React (software)", "Vue.js", "Svelte"; from each infobox's Repository link open the GitHub repo in a new tab; return which has the most stars | Correct star count for all 3 and the right winner; each repo tab was opened from the infobox link |
