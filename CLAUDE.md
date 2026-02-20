# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TIFF ("Todo In Your Face") is a Pomodoro-timer-integrated todo app built with SvelteKit 2, Svelte 5, and TypeScript, deployed to Cloudflare Workers.

## Commands

```bash
npm run dev          # Local dev server (Cloudflare platform proxy persists KV to .wrangler/state/)
npm run build        # Production build for Cloudflare Workers
npm run check        # Type checking (svelte-kit sync + svelte-check)
npm run check:watch  # Type checking in watch mode
npx wrangler deploy  # Deploy to Cloudflare Workers
```

No test framework is configured.

## Architecture

**Stack:** SvelteKit 2 + Svelte 5 (runes API) + TypeScript (strict) + Cloudflare Workers + Cloudflare KV

**Auth:** Cloudflare Access JWT parsed in `src/hooks.server.ts`. In dev mode, hardcodes `dev@localhost`. Email is set on `event.locals.userEmail` for per-user data isolation.

**Data layer (`src/lib/kv.ts`):** All persistence is Cloudflare KV via the `TIFF_KV` binding (declared in `wrangler.toml`, typed in `src/app.d.ts`). Todos stored at key `todos:{email}`, pomodoro logs at `pomodoros:{email}`.

**Server actions (`src/routes/+page.server.ts`):** Four form actions — `create`, `toggle`, `delete`, `logPomodoro` — using SvelteKit's `use:enhance` for progressive enhancement.

**Timer (`src/routes/+page.svelte`):** All Pomodoro timer logic is client-side using Svelte 5 runes (`$state`, `$derived`, `$effect`). Timer state persists to localStorage key `tiff-timer`. Completed pomodoros are logged to the server by programmatically submitting a hidden form.

**Types (`src/lib/types.ts`):** Shared interfaces — `Todo`, `TimerState`, `PomodoroLog`.

**Pomodoro config (`src/lib/pomodoro.ts`):** Constants (25min work, 5min short break, 15min long break) and `nextInterval()` logic.

## Style Conventions

- Svelte 5 runes API (`$state()`, `$derived`, `$effect`, `$props()`) — not legacy reactive syntax
- Brutalist visual design: black/white/red palette, JetBrains Mono font, ALL CAPS text
- All CSS in `src/app.css` using custom properties (`--black`, `--white`, `--red`, `--border`, `--border-heavy`)
- Single-page app — all routes live under `src/routes/` with one page
