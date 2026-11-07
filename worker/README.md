# RBMK Bilibili Audio Worker

Thin Cloudflare Worker used by the GitHub Pages frontend.

It has one resolver path:

- `GET /resolve?bvid=BV...&p=1` calls the Squidtail Bili2VRC API and adapts its response to the frontend contract.
- `GET /stream?url=...` is the only media path exposed to the frontend, with restricted host allow-listing plus Range/CORS support.

The Worker does **not** call Bilibili metadata, WBI, pagelist, or playurl APIs directly and does not use Bilibili account cookies. The frontend never receives or plays the raw upstream media URL directly.

Upstream parser:

```
https://api.squidtail.com/bili2vrc/parse/
```

## Deploy

The repository contains `.github/workflows/deploy-bili-worker.yml`.

Repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Run `deploy-bili-worker` manually. The workflow deploys with Wrangler, tests `/health`, and performs a real `/resolve` smoke test.

Production endpoint:

```
https://rbmk-bili-audio-proxy.stanjk24.workers.dev
```
