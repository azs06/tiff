# TIFF

SvelteKit app deployed to Cloudflare Workers with D1 (primary) + KV (cache/compat) + R2 storage.

## Local development

```sh
npm install
npm run dev
```

`src/hooks.server.ts` bypasses Cloudflare Access in local/dev runtime and uses `dev@localhost`.

## Deploy

```sh
npm run build
npx wrangler deploy
```

## D1 setup

1. Create a D1 database and update `database_id` in `wrangler.toml`.
2. Apply SQL migrations:

```sh
npx wrangler d1 migrations apply tiff --local
npx wrangler d1 migrations apply tiff --remote
```

## Cloudflare Zero Trust Access

Production requests are protected with Cloudflare Access JWT validation.

1. In Cloudflare Zero Trust, create an Access application for your deployed worker hostname.
2. Add at least one `Allow` policy for your identity users/groups.
3. Copy:
   - Team domain, e.g. `https://your-team.cloudflareaccess.com`
   - Application audience (`AUD`) from the Access app.
4. Set both values as Worker secrets:

```sh
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN
npx wrangler secret put CF_ACCESS_AUD
npx wrangler secret put MIGRATION_ADMIN_TOKEN
```

5. Redeploy:

```sh
npm run deploy
```

If either secret is missing, the app returns `500`. If a request does not include a valid Access JWT, the app returns `401/403`.

## Storage rollout flags

Worker vars in `wrangler.toml`:
- `STORAGE_READ_SOURCE` (`kv` or `d1`)
- `STORAGE_DUAL_WRITE` (`true` or `false`)
- `D1_CANARY_EMAILS` (comma-separated canary users)
