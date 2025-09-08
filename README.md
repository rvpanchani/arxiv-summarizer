## arXiv Summarizer (Vite + React)

Single-page app that summarizes arXiv papers by passing a URL parameter like:

`?paper=https://arxiv.org/abs/2506.01667`

The frontend is a static site (ideal for GitHub Pages). Summarization is handled server-side through a lightweight API so API keys stay secret.

Features:
- URL param parsing for `paper`
- Calls backend `/api/summarize` to generate summaries via Gemini 2.5 Flash
- Ready-to-deploy GitHub Pages workflow

### Local dev

```
npm install
npm run dev
```

Open the URL printed by Vite and append `?paper=<arxiv-url>`.

### Build

```
npm run build
npm run preview
```

### GitHub Pages

This repo includes a workflow at `.github/workflows/deploy.yml`.

Steps:
- Set repository Settings > Pages > Build and deployment > Source: GitHub Actions
- Push to `main` to trigger deployment

### Backend (serverless)

You need a small backend to call Gemini securely. Example option:
- Cloudflare Worker (free tier): store `GOOGLE_API_KEY` as an encrypted secret; expose `GET /api/summarize?paper=...`.
	- Local dev: `npm run worker:dev` (requires `wrangler`)
	- Deploy: `npm run worker:deploy` then note the `*.workers.dev` URL

- GitHub Actions + GitHub Pages static alone cannot hide keys. Do NOT call LLMs directly from the browser.

Frontend expects an environment variable `VITE_API_BASE` at build time. Set a repo Secret named `VITE_API_BASE` to your Worker URL (e.g. `https://your-worker.workers.dev`). If unset, the frontend uses relative `/api`, which only works if you proxy the backend under the same origin.

### Security

Never embed API keys in the static site. Keep keys on the serverless backend in environment secrets. The browser calls your backend only.
