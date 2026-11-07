# RBMK Bilibili Audio Worker

Thin Cloudflare Worker used by the GitHub Pages frontend.

It does two things:

- `GET /resolve?bvid=BV...&p=1`: resolves a public Bilibili video/page to a DASH audio track (with MP4 fallback).
- `GET /stream?url=...`: proxies only allow-listed Bilibili CDN hosts, preserves HTTP Range, adds the headers Bilibili CDN expects, and returns permissive CORS headers for Web Audio.

No Bilibili account cookies or login tokens are used.

## Deploy

### Cloudflare CLI

```bash
cd worker
npx wrangler deploy
```

Copy the resulting `https://...workers.dev` URL into the Bilibili panel in the site. It is saved locally in the browser.

### GitHub Actions

The repository also contains `.github/workflows/deploy-bili-worker.yml`.

Add these repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Then manually run the `deploy-bili-worker` workflow. The workflow prints the stable deployment URL in the job summary and performs a `/health` smoke test before reporting success.

For a fixed production endpoint you can additionally set a Pages build environment variable:

```
VITE_BILIBILI_WORKER_URL=https://your-worker.workers.dev
```

The UI input remains useful for development and endpoint changes.
