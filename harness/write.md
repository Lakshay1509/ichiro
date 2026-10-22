# Write: design and draw on any site

**Goal:** the agent can build things on canvas apps (slides, whiteboards, diagram tools) with **generic hands only**. No per-site code, no per-app APIs (developer, 2026-10-20). Built ahead of `why-it-loops.md`, like MCP was.

- Do the **first unticked slice**. One at a time.
- Tick a box only when its **Done when** is verified (test, build or a live check you actually ran).
- Every guard a slice adds ships finished and tested in that slice (`CLAUDE.md` → Security).

**Why these hands:** screen-only agents fail most at drag precision and at planning (PPT-Eval, Cua-Bench, DragOn). So: precise hands, structured paste, sharper eyes, plan first.

## Slices

- [x] **WR1 · point, drag, keys.** `click x,y [double] [shift|ctrl|alt|meta]`, `drag x,y x,y …`, `key` with combos and letters (real events through `chrome.debugger`). Points are pixels in the last screenshot.
  - Guards: stop-lines at press and release points; no points inside frames; no letters into fields (use `type`); no `ctrl+v` (your clipboard); save/print/open and ctrl+Enter ask first; Enter/Space checked on what they'd press.
  - Done when: tests + build pass ✅, and live ✅ (excalidraw.com via MCP): Start → End flowchart drawn (two boxes, an arrow, double-click + type labels), pixel-exact; `ctrl+z` undoes; a point click on "Delete" stops; `ctrl+v` refused, `ctrl+s` stops, a letter into the text box refused; `ctrl+t` does nothing (Chrome's shortcuts are inert to debugger keys).
  - Found live: Chrome's "debugging this browser" bar (global, stays 5 s after detach: `kAutoCloseDelay` in Chromium's `extension_dev_tools_infobar_delegate.h`) shrinks the page 60 px, so screenshots now attach first and point actions wait for the picture's layout.
- [ ] **WR2 · paste + type at the cursor.** `paste <text>` sends a paste event carrying the rest of the line, as is. **No clipboard**: yours is never read or replaced, so nothing you copied can reach a page, and no new permission. `type here <text>` types where the cursor is (`Input.insertText`). The model knows the format (e.g. Excalidraw's `excalidraw-api/clipboard` JSON); our code doesn't.
  - Guards: runs in the frame focus is really in (same-site frames check themselves; another site's frame is refused); secret field → hand over; personal-data field → asks (same check as `type`); `type here` needs a field.
  - Also: MCP line limit 2,000 → 20,000 (a drawing's JSON); a step's history shows at most 300 characters of its command; Escape in a text field stays in the field (Excalidraw's text box).
  - Done when: tests + build pass ✅; live ✅ one `paste` drew Idea → Good? → Ship it with bound arrows; `type here` typed into a text box; Escape finished editing. **Open:** live check that `type here` / `paste` into a name or email field stops (needs a test page with such a field).
  - Later: HTML and image paste (needs a sanitizer: pasted HTML can load images from any host).
- [ ] **WR3 · zoom for look.** A full-resolution crop of one area, so small targets are hit.
- [ ] **WR4 · plan first, check after.** The MCP tool's description only (`host/mcp.ts`; the panel has no prompt since 2026-10-22): write the layout (boxes, sizes, arrows) before acting; screenshot and compare after each chunk.
- Later: drop a file onto the page (`Input.dispatchDragEvent`, experimental).

## Log

- 2026-10-20: research done; WR1 built (tests + build pass), live check next.
- 2026-10-20: WR1 live check passed after the debugging-bar fix. Next: WR2.
- 2026-10-20: WR2 built; paste, type here and Escape passed live on Excalidraw. Open: the personal-data stop on a real name/email field. MCP's goto https://httpbin.org/ was refused without the Add-site ask (bridge issue, not WR2).
