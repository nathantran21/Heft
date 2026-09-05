# Heft v2 — UI redesign + 10-persona UX research

**Date:** July 13, 2026 · **Base:** heft-latest (v0.15.1, from heft-mauve.vercel.app) · **Output:** heft-v2 (v0.16.0-v2)

heft-latest was never modified. heft-v2 is a full copy with the redesign applied. Real data is safe: v2 in normal mode uses the same localStorage key + Supabase state as v1; in `?sandbox=1` mode it uses a separate key and never touches Supabase or auth.

## How to run

```
cd heft && npm install && npm run dev
```
- Test safely: http://localhost:5173/?sandbox=1 (isolated data, no login)
- Real mode: http://localhost:5173/ (your live tasks, synced)

Production build: `npm run build` (Vercel uses this; output is `dist/`).

## The redesign

- **Liquid glass + gaussian blur** — ambient gradient mesh background; frosted translucent surfaces (top bars, sidebar, columns, modals) with `backdrop-filter` blur+saturate; light & dark variants with auto + manual toggle. Cards are translucent without their own blur (perf).
- **Completion system (the addictive loop)** — springy check pop + ripple ring; radial "exhale" glow; confetti at the checkbox (theme-aware colors); card settle animation; rotating encouragement toasts; **day-complete moment** (full-screen breathe + big burst, fires once per day) when the last task closes; always-visible **day progress ring** in the top bar; haptics on mobile. Celebrations preference: Full / Subtle / Off. Everything respects `prefers-reduced-motion`.
- **Onboarding (new)** — 4 steps: welcome → create a real first task with weight explanation → add a habit → tips. Creates real data, skippable at every step, never shows for accounts with existing data.

## Research method

10 simulated personas each performed a code-grounded cognitive walkthrough of 8 scenarios (onboarding, capture, organizing, completing, carry-over, personalizing, habits, archive recovery): Maya (iPhone-first photographer), Dev (keyboard power user), Linda (58, low tech confidence), Carlos (GTD/Todoist migrant), Amara (ADHD, reward-driven), Tom (contractor, phone in sunlight), Priya (night-time planner), Jae (first-time freelancer), Nadia (low vision + vestibular), Marcus (studio owner, 20+ tasks/day). ~120 friction findings deduped; convergent ones fixed.

## Fixed in v2 (verified in browser)

**Bugs (several exist in live v1 too):**
1. Theme choice never persisted — `dark` missing from the save blob; reset to light on every reload
2. Calendar "day has tasks" dots never rendered (`t.day` vs `t.date` mismatch)
3. Tags created inside the task editor never reached the sidebar filter list
4. Tag rename/delete orphaned tasks (kept invisible dead tags) — now cascades
5. Check ripple animation clipped by `overflow:hidden` (never visible)
6. Checkbox aria-label said "Reset to to-do" but action goes to In Progress
7. "Syncing…" pill lingered forever after banner-driven moves

**UX (top persona findings):**
8. **Stranded tasks rescue** — unfinished tasks on ANY past day now surface a banner on today's board ("N unfinished from earlier days — bring them to today?") with one-tap move + Undo. Previously invisible unless you navigated back day by day — the #1 finding (7/10 personas).
9. Carrying over from a past day now targets **today**, not past-day+1
10. Undo added to the carry-over confirm path (was banner-only)
11. Carry-over pill no longer shows at 9am ("give up on today?" effect) — past days always, today from 5pm
12. **Kanban/Weight toggle restored to the top bar** (desktop segmented control + mobile button) — the flagship Weight view was buried in Settings
13. Templates now work on mobile (render was gated `!isMobile` — dead Settings row)
14. First-tap coach toast: "In progress — tap the circle again to complete" (3-state checkbox was never taught in-product)
15. Habit **streak is now a true consecutive-day streak** from full history (was a Sun–Sat count that reset every week)
16. Drag-to-Done now celebrates like the checkbox; completing the last subtask of a checked task celebrates too
17. Day-complete moment fires once per day (was re-triggerable by uncheck/recheck)
18. Settings: removed dead controls (Change password / Export / Delete account / Week starts on); "Habit archive" renamed "Archive"; Cancel now reverts live theme/accent/typeface previews; new Celebrations setting
19. New-task modal: "Move to" quick-dates hidden on create; "Other date" → "Date"; saving to another day shows "Added to <day> — View" toast
20. Onboarding step-0 skip no longer fires confetti; final copy fixed for mobile
21. Splash minimum 1.8s → 0.9s
22. Escape closes all modals/dialogs; cards keyboard-focusable (Enter opens) with full aria-labels; role=dialog/aria-modal on modals; switch semantics on toggles; labels on all nav arrows/habit dots
23. Pinch-zoom re-enabled (`user-scalable=no` removed) — WCAG 1.4.4
24. Contrast pass: faint-text tokens darkened/lightened, 8.5–11px labels bumped, dark-mode borders made visible, dark mesh saturation raised
25. Weight badge now shown on desktop cards (was color-only 4px rail); tag chip added to cards
26. Blanket `prefers-reduced-motion` rule covering structural animations (modals, springs, hovers), not just celebrations
27. Mobile: date label shortened (was overlapping buttons at 375px); offline/sync pill moved above the FAB and made click-through
28. Post-drag click no longer opens the task editor

## Roadmap (found, not built — bigger than a reskin)

- **Cross-day review surface** ("all open tasks" list) and cross-day search — search currently only scans the focused day (Carlos, Linda, Marcus)
- **Backlog / someday list** — every task requires a date today (Carlos)
- Multi-select bulk move with target-date picker (`moveDayBulk` already exists) (Marcus)
- Rapid entry: "Save & add another" keeping last tag/weight (Marcus)
- Multi-tag per task + multi-select tag filter (Marcus)
- Per-column sort (all three columns share one sort state today)
- Sync: whole-blob last-writer-wins can drop edits made on two devices within the 5s window — per-collection merge before multi-device use grows (Marcus)
- Password reset flow + Sign in with Apple/Google; "Forgot password" doesn't exist (Jae)
- Board-spawned recurring invoices (weighted kanban cards on a schedule) stay out of scope — weekly/monthly habits cover the repeat need; templates remain the manual reuse path (Carlos, Marcus)
- High-contrast / reduced-transparency option for the glass (Nadia, Tom)
- Auto theme should track OS changes live (currently sampled once)

## Deploying v2

When happy with sandbox testing, deploy the Vite build (`npm run build` → `dist/`, which Vercel already uses). Data migrates automatically — same localStorage key and Supabase row; the onboarding will not appear for the existing account.
