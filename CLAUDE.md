# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TIFF ("Todo In Your Face") is a Pomodoro-timer-integrated todo app built with SvelteKit 2, Svelte 5, and TypeScript, deployed to Cloudflare Workers.

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
- `todos:{email}` — todo list (includes archived todos, task logs, and resources inline)
- `pomodoros:{email}` — completed pomodoro session logs
- `timer:{email}` — active timer state (synced from client)
- `settings:{email}` — user settings (timer durations, theme)

**Server actions (`src/routes/+page.server.ts`):** 14 form actions — `create`, `toggle`, `delete`, `update`, `logPomodoro`, `syncTimer`, `archive`, `unarchive`, `saveSettings`, `saveTheme`, `addLog`, `deleteLog`, `addResource`, `deleteResource` — all using SvelteKit's `use:enhance` for progressive enhancement.

**Timer (`src/routes/+page.svelte`):** Pomodoro timer logic is client-side using Svelte 5 runes. Timer state hydrates from server KV on load, then syncs back to server via a hidden form on every change. Completed pomodoros are logged to the server by programmatically submitting a hidden form.

**Types (`src/lib/types.ts`):** Shared interfaces — `Todo`, `TimerState`, `PomodoroLog`, `UserSettings`, `Theme`, `TaskLog`, `Resource`. Also exports `DEFAULT_SETTINGS` and `THEMES`.

**Pomodoro config (`src/lib/pomodoro.ts`):** `nextInterval()` logic (break type based on completed count). Default durations come from `DEFAULT_SETTINGS` in types.

**Calendar (`src/lib/Calendar.svelte`):** Activity heatmap component showing pomodoro counts and deadline markers per day, displayed in the sidebar.

**Three hidden forms** in `+page.svelte` handle background server syncing: `logPomodoro`, `syncTimer`, and `saveTheme` — all submitted programmatically without page invalidation.

## Style Conventions

- Svelte 5 runes API (`$state()`, `$derived`, `$effect`, `$props()`) — not legacy reactive syntax
- Three themes (`signal`, `paper`, `nothing`) controlled by `data-theme` attribute on `<html>`, persisted to KV
- All CSS in `src/app.css` using custom properties (`--bg-deep`, `--bg-panel`, `--bg-surface`, `--bg-elevated`, `--text-primary`, `--text-muted`, `--text-dim`, `--accent`, `--accent-dark`, `--danger`, `--border-color`, `--font`, `--font-display`, `--hero-bg`, `--hero-text`)
- Theme overrides use `[data-theme="paper"]` and `[data-theme="nothing"]` selectors with per-theme clean minimal styling (nothing) and texture/typography effects (paper)
- ALL CAPS text throughout, uppercase letter-spacing on labels and buttons
- Single-page app — all routes live under `src/routes/` with one page
