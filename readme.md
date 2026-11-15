# TIFF

TIFF is a shared task manager in the style of Todoist and Wunderlist, with a built-in MCP server so AI assistants can read and manage your tasks. It is built with SvelteKit and runs on Cloudflare Workers with D1 and R2.

## Features

- **Views:** Inbox, Today (with overdue), Upcoming (next 14 days), Completed, per-project, per-label, and search.
- **Quick add** with natural language, parsed live as you type:
  `Pay rent every month on 1 dec p1 #Home @bills`
  - `#Project` picks the project (multi-word names work when the project exists)
  - `@label` adds labels
  - `p1`–`p4` sets priority
  - dates: `today`, `tomorrow`, `fri`, `next week`, `weekend`, `in 3 days`, `jan 5`, `2027-01-05`
  - times: `5pm`, `17:30`, `noon`
  - recurrence: `daily`, `every 2 weeks`, `every other month`, `every weekday`, `every mon, wed and fri`
- **Tasks:** notes, priority, due date and time, recurrence, labels, one level of subtasks, comments, assignee.
- **Recurring tasks:** completing one moves it to its next date and resets its subtasks.
- **Projects:** colors, notes, sections, drag-and-drop ordering, file attachments (R2), archive.
- **Sharing:** the owner shares a project by email. Members can edit tasks, sections, comments and files; only the owner can archive, delete or manage members.
- **MCP server** at `/mcp`, authenticated with personal API tokens.
- **Keyboard:** `q` opens quick add, `/` focuses search, `Esc` closes dialogs.
- Three themes: signal, paper, nothing.

## Stack

- SvelteKit 2 + Svelte 5 on Cloudflare Workers
- Cloudflare D1 for all data
- Cloudflare R2 for project attachments
- Cloudflare Access for web sign-in
- `@modelcontextprotocol/server` (MCP SDK v2) for the MCP endpoint

## Local development

```sh
npm install
npm run dev
```

`npm run dev` applies pending local D1 migrations before starting Vite. In development the web app signs you in as `dev@localhost`. The `/mcp` endpoint still requires an API token, which you can create on the Settings page.

## Cloudflare setup

1. Create a D1 database and set `database_id` in `wrangler.toml`.
2. Create an R2 bucket and set `bucket_name` for `TIFF_ATTACHMENTS`.
3. Apply migrations:

   ```sh
   npx wrangler d1 migrations apply tiff --remote
   ```

   Migration `0005_task_app.sql` drops every table from the earlier focus-tracker version of TIFF. Existing data is deleted.

4. Deploy:

   ```sh
   npm run deploy
   ```

## Cloudflare Access

The web app requires a valid Cloudflare Access JWT in production.

1. In Cloudflare Zero Trust, create an Access application for the Worker hostname.
2. Add an `Allow` policy for everyone who should use TIFF, including people you share projects with.
3. Save the team domain and the application audience (`AUD`) as Worker secrets:

   ```sh
   npx wrangler secret put CF_ACCESS_TEAM_DOMAIN   # e.g. https://your-team.cloudflareaccess.com
   npx wrangler secret put CF_ACCESS_AUD
   ```

4. **Exclude `/mcp` from Access.** MCP clients authenticate with Bearer tokens and cannot complete an Access login. Add a second Access application for the path `your-host/mcp` with a `Bypass` policy for `Everyone`. TIFF still rejects any `/mcp` request without a valid token.

If either secret is missing, the app returns `500`. Requests without a valid Access JWT get `401` or `403`.

## Sharing

Project owners add members by email in the project's **Share & details** panel. The person sees the project the next time they sign in with that email through Cloudflare Access. There is no invitation step, so the Access policy decides who can sign in at all.

## MCP

Create a token under **Settings → API tokens & MCP**. The token is shown once and is stored only as a SHA-256 hash. Each token acts as you, with full access to everything you can see.

Claude Code:

```sh
claude mcp add --transport http tiff https://your-host/mcp --header "Authorization: Bearer tiff_..."
```

Other clients (Cursor, VS Code and similar):

```json
{
  "mcpServers": {
    "tiff": {
      "url": "https://your-host/mcp",
      "headers": { "Authorization": "Bearer tiff_..." }
    }
  }
}
```

Tools: `get_context`, `list_projects`, `get_project`, `create_project`, `update_project`, `create_section`, `share_project`, `list_tasks`, `get_task`, `quick_add_task`, `create_task`, `update_task`, `complete_task`, `reopen_task`, `move_task`, `delete_task`, `add_comment`, `list_labels`.

The endpoint is stateless Streamable HTTP. It serves both the 2025-era protocol that current clients use and the newer per-request protocol.
