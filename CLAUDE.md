# CLAUDE.md

Guidance for AI coding assistants working in this repository.

## Project overview

TIFF is a shared, Todoist-style task manager with an MCP server, built with SvelteKit 2, Svelte 5 and TypeScript, deployed to Cloudflare Workers with D1 and R2.

## Commands

```bash
npm run dev          # Applies local D1 migrations, then starts Vite (state persists in .wrangler/state/)
npm run build        # Production build
npm run deploy       # Build + wrangler deploy
npm run check        # svelte-kit sync + svelte-check
```

No test framework is configured.

## Architecture

**Auth (`src/hooks.server.ts`):**
- `/mcp` uses `Authorization: Bearer tiff_...` personal API tokens (`src/lib/server/tokens.ts`), even in dev.
- Everything else uses the Cloudflare Access JWT. Dev mode signs in as `dev@localhost`.
- Emails are lowercased and stored on `event.locals.userEmail`.

**Service layer (`src/lib/server/`):** all business rules and access checks live here. Form actions and MCP tools both call it; never query D1 from routes or components.
- `context.ts` builds a per-request `ServiceContext` (`db`, `user`, `today` in the user's time zone) and creates the user and their Inbox on first visit.
- `projects.ts` covers projects, sections, members and permissions (`requireEditor`, `requireOwner`).
- `tasks.ts` covers tasks, labels, comments, completion and recurrence, and quick add.
- `attachments.ts` handles R2 uploads and downloads.
- `actions.ts` holds every form action. Each `+page.server.ts` re-exports `sharedActions`, so any form can post to `?/actionName`.
- `mcp.ts` defines the MCP server and tools. `src/routes/mcp/+server.ts` serves it with `createMcpHandler`.
- Throw `ServiceError` (`errors.ts`) for user-facing failures. Actions turn it into `fail()`, and MCP turns it into `isError` results.

**Access model:** every query joins `project_members` on the current user's email. Owners and editors can edit tasks, sections, comments and attachments. Only owners can archive or delete a project or manage members. The Inbox (`projects.is_inbox = 1`) can't be shared, renamed or deleted.

**Data model (`migrations/0005_task_app.sql`):** `users`, `projects`, `project_members`, `sections`, `tasks` (with `parent_id` for one level of subtasks), `task_labels`, `comments`, `attachments` and `api_tokens`. Due dates are floating local dates (`YYYY-MM-DD`) plus an optional `HH:MM`. D1 enforces foreign keys, and deletes cascade.

**Shared pure modules (client and server):**
- `src/lib/dates.ts`: date arithmetic on UTC midnights.
- `src/lib/recurrence.ts`: parses and advances rules like "every mon, fri".
- `src/lib/quickadd.ts`: natural-language parser, used for the live preview and on the server.

**UI:** `src/routes/+layout.svelte` holds the sidebar, the task detail modal (opened by the `?task=<id>` query param on any page), the global quick add and toasts. Components are in `src/lib/components/`. `src/lib/ui.ts` has `enhanced()` for `use:enhance` with error toasts, and `postAction()` for formless action calls.

## Conventions

- Svelte 5 runes only (`$state`, `$derived`, `$effect`, `$props`).
- Edit forms use `enhanced()` (no reset) and autosave with `onchange` + `requestSubmit()`.
- All CSS is in `src/app.css`. Themes (`signal`, `paper`, `nothing`) are set by `data-theme` on `<html>`.
- Add schema changes as new migration files. Never edit an applied migration.
