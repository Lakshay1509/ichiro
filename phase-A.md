# Phase 1 · A. Setup

Goal of Phase 1: an extension that can **read** any page and **act** on it via typed commands. No AI yet.

## 1. Write the 15 test tasks (before any code)

- Create `tasks.md`: one line per task — site, goal, what "success" looks like.
- Mix of site types: YouTube, Google, Amazon (stop at cart), Booking (stop at results), Wikipedia, a Google Form, GitHub, Reddit, a few single-page apps.

**Done when:** list exists and every task has a clear pass/fail.

## 2. Empty extension

- Create a WXT + TypeScript project.
- Load it unpacked in Chrome.
- Side panel opens and shows "hello".

**Done when:** the side panel opens on any site.

## 3. Permissions

- Only: `sidePanel`, `tabs`, `scripting`, `storage`, plus access to all sites.

**Done when:** the extension loads with no warnings.
