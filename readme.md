# TIFF

SvelteKit app deployed to Cloudflare Workers with KV + R2 storage.

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
```

5. Redeploy:

```sh
npm run deploy
```

If either secret is missing, the app returns `500`. If a request does not include a valid Access JWT, the app returns `401/403`.
