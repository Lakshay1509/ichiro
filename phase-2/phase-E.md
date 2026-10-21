# Phase 2 · E. The agent screen

Goal: turn the side panel into the real product screen. Type a task, watch progress, answer the agent's questions, see the result. The Phase 1 console stays, as a dev-only tab.

**Before you start:** Section D done (the agent works from the console with `agent "task"`).

**Rules**
- Do steps in order. Don't start the next step until its "Done when" passes.
- The UI must never get stuck showing "running". Every end reason and every error lands back in a usable state.

**Files**
```
entrypoints/sidepanel/   ← React app: Agent, Settings, Console tabs
```

## 14. Panel layout

**What:** three tabs: **Agent**, **Settings**, **Console** (dev only).

**How:**
- Switch the panel to React using WXT's React module. Phases 3–4 add confirmation dialogs and a planner view, which get messy in plain DOM code.
- Move the Phase 1 console into a component. Its command map stays exactly as it is.
- Show the Console tab only in dev builds (`import.meta.env.DEV`).
- With no API key saved, the Agent tab shows "Add your API key in Settings to start" and a button that opens Settings.

**Done when:**
- All three tabs work in dev.
- The production build (`npm run build`) has no Console tab.
- Every Phase 1 and Phase 2 console command still works in dev.

## 15. Task input and live progress

**What:** the main flow a user sees.

**How:**
- **Input:** a text box with the placeholder "What should I do on this page?" and a Start button (Enter also starts). Both are disabled while a task runs.
- **Which tab:** show the favicon and title of the tab the agent is working on.
- **One row per step:**
  - main text: the AI's `note`
  - small text: the action in plain words ("Click [4] Search", "Type "lofi" into [2]")
  - status icon: running / ok / error / skipped
  - usage: "3.1k tokens · 2.4 s"
- **Top bar:** total tokens for this task, and a **Stop** button that's always visible while running.
- **Step mode:** Approve / Skip / Stop buttons on the pending step's row.
- **ask_user:** the question appears as a message bubble with a reply box. Send continues the loop.
- **done:** the final answer in a highlighted box. `success=false` shows as "Couldn't finish: …".
- **End reasons** (stuck, step limit, error, refused, stopped) appear as one plain sentence. Key errors include a "Check Settings" link.
- **New task:** after a task ends, the input is enabled again and the old steps stay visible until the next Start.

**Done when:**
- A full task runs from the Agent tab and shows every step.
- An `ask_user` round trip works (the agent asks, you reply, it continues).
- Stop during a request stops within about 1 second and the input is usable again.
- A wrong key shows the error with the Settings link.

## 16. Edge cases

**What:** things users do in the middle of a task.

**How:**
- **Panel closed:** the task stops, because the loop lives in the panel. That's intended. Show "Keep this panel open while the agent works" under the input.
- **User switches tabs:** a "Paused — go back to the tab to continue" banner (from step 11). The task resumes when they return.
- **Page the extension can't read:** the agent gets the "can't read this page" text (step 10) and can go back or goto.
- **Two browser windows:** each window has its own side panel and runs its own task on its own tab. Settings are shared; task state is not. Keep task state inside the panel, never in a global store.
- **Settings changed mid-task:** the running task keeps the settings it started with. Changes apply to the next task.

**Done when:**
- Each case above behaves as described.
- None of them leaves the screen frozen in "running".
