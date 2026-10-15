# Judy's API (Cloudflare Worker)

`https://judysvb.com` is static GitHub Pages, so `/api/*` does not work until this Worker is deployed and routed.

## One-time setup

```bash
cd worker
npx wrangler login
npx wrangler kv namespace create SUBSCRIBERS
```

Paste the KV `id` into `wrangler.toml`, then:

```bash
npx wrangler secret put ADMIN_PASSWORD
# enter: judys-admin   (or a stronger password)

npx wrangler deploy
```

## Attach to your domain

Cloudflare Dashboard → **Workers & Pages** → **judys-api** → **Triggers** → **Add route**:

- Route: `judysvb.com/api/*`
- Also add: `www.judysvb.com/api/*` if you use www

After that:

- Signup on https://judysvb.com works (same-origin `/api`)
- Admin: https://judysvb.com/admin/ (password from `ADMIN_PASSWORD` secret)
- Health check: https://judysvb.com/api/health

Campaign email sending still needs the Node + SMTP server later; subscriber storage works on the Worker.
