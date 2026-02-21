# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TIFF ("Todo In Your Face") is a task-focus-first productivity app with optional Pomodoro timer, built with SvelteKit 2, Svelte 5, and TypeScript, deployed to Cloudflare Workers. Designed for multi-task context switching workflows — focus on a task, log progress, switch between tasks without losing context, track how long features take.

## Commands

```bash
npm run dev          # Local dev server (Cloudflare platform proxy persists KV to .wrangler/state/)
npm run build        # Production build for Cloudflare Workers
npm run deploy       # Build + deploy to Cloudflare Workers
npm run check        # Type checking (svelte-kit sync + svelte-check)
npm run check:watch  # Type checking in watch mode
```

No test framework is configured.

## Architecture

**Stack:** SvelteKit 2 + Svelte 5 (runes API) + TypeScript (strict) + Cloudflare Workers + Cloudflare KV

**Auth:** Cloudflare Access JWT parsed in `src/hooks.server.ts`. In dev mode, hardcodes `dev@localhost`. Email is set on `event.locals.userEmail` for per-user data isolation.

**Data layer (`src/lib/kv.ts`):** All persistence is Cloudflare KV via the `TIFF_KV` binding (declared in `wrangler.toml`, typed in `src/app.d.ts`). KV key schema:
- `todos:{email}` — todo list (includes archived todos, task logs, resources, projectId, totalFocusMs inline)
- `pomodoros:{email}` — completed pomodoro session logs
- `focus:{email}` — active focus state (which task is focused + optional pomodoro sub-state)
- `sessions:{email}` — focus session history (auto-tracked start/end times per task)
- `projects:{email}` — user's project list
- `settings:{email}` — user settings (timer durations, theme)

**Focus model:** The primary concept is "focus" not "timer". Focusing a task starts an auto-tracked session. The Pomodoro timer is an optional compact widget within a focus session. `FocusState` contains `activeTaskId`, `focusedAt`, and an optional `pomodoro` sub-object.

**Projects:** Optional grouping. Tasks have an optional `projectId`. Tasks without a project appear under "GLOBAL". Projects are a flat list (no nesting).

**Server actions (`src/routes/+page.server.ts`):** 20 form actions — `create`, `toggle`, `delete`, `update`, `logPomodoro`, `syncFocus`, `focusTask`, `unfocus`, `archive`, `unarchive`, `saveSettings`, `saveTheme`, `addLog`, `deleteLog`, `addResource`, `deleteResource`, `createProject`, `deleteProject`, `setTaskProject` — all using SvelteKit's `use:enhance` for progressive enhancement.

**Focus (`src/routes/+page.svelte`):** Focus state and optional Pomodoro timer logic is client-side using Svelte 5 runes. Focus state hydrates from server KV on load, then syncs back via hidden forms. Session tracking (start/end) happens server-side via `focusTask`/`unfocus` actions.

**Types (`src/lib/types.ts`):** Shared interfaces — `Todo`, `FocusState`, `FocusSession`, `Project`, `PomodoroLog`, `UserSettings`, `Theme`, `TaskLog`, `Resource`, `TimerState` (legacy, kept for migration). Also exports `DEFAULT_SETTINGS` and `THEMES`.

**Pomodoro config (`src/lib/pomodoro.ts`):** `nextInterval()` logic (break type based on completed count). Default durations come from `DEFAULT_SETTINGS` in types.

**Calendar (`src/lib/Calendar.svelte`):** Activity heatmap component showing pomodoro counts and deadline markers per day, displayed in the sidebar.

**Five hidden forms** in `+page.svelte` handle background server syncing: `logPomodoro`, `syncFocus`, `saveTheme`, `focusTask`, `unfocus` — all submitted programmatically without page invalidation.

## Style Conventions

- Svelte 5 runes API (`$state()`, `$derived`, `$effect`, `$props()`) — not legacy reactive syntax
- Three themes (`signal`, `paper`, `nothing`) controlled by `data-theme` attribute on `<html>`, persisted to KV
- All CSS in `src/app.css` using custom properties (`--bg-deep`, `--bg-panel`, `--bg-surface`, `--bg-elevated`, `--text-primary`, `--text-muted`, `--text-dim`, `--accent`, `--accent-dark`, `--danger`, `--border-color`, `--font`, `--font-display`, `--hero-bg`, `--hero-text`)
- Theme overrides use `[data-theme="paper"]` and `[data-theme="nothing"]` selectors with per-theme clean minimal styling (nothing) and texture/typography effects (paper)
- Hero section uses `.hero-focus` class with compact pomodoro pill (`.pomo-pill`), session elapsed counter, and quick log form
- Tasks grouped by project using `.task-group` and `.task-group-header` classes
- ALL CAPS text throughout, uppercase letter-spacing on labels and buttons
- Single-page app — all routes live under `src/routes/` with one page
