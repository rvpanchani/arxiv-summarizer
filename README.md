## arXiv Summarizer (Vite + React)

Single-page app that summarizes arXiv papers by passing a URL parameter like:

`?paper=https://arxiv.org/abs/2506.01667`

The frontend is a static site (ideal for GitHub Pages). Summarization is handled server-side through a lightweight API so API keys stay secret.

Features:

### Local dev

```
npm install
npm run dev
```

Minimal arXiv summarizer with a structured, practical summary format. Backend is a Cloudflare Worker using Gemini; frontend is Vite + React.

The summary is returned as a compact JSON that the UI renders into clearly labeled sections with copy/share options.

## Structured API

Endpoint:

- `GET {VITE_API_BASE}/api/summarize?paper=<arxiv_url>`

Response shape:

```
{
	"title": string | undefined,
	"arxiv_id": string | null,
	"arxiv_abs_url": string | null,
	"arxiv_pdf_url": string | null,
	"one_liner": string,
	"problems_solved": string[],
	"key_innovations": string[],
	"collaboration_type": "Academia-only" | "Industry-only" | "Academia-Industry" | "Unknown",
	"total_authors": number,
	"authors": string[] | undefined,
	"takeaways": string[],
	"notes": string[] | undefined
}
```

Notes:

- The Worker fetches metadata (title, authors, abstract) from the arXiv API/HTML.
- Gemini is prompted to return strict JSON (no prose). If JSON parsing fails, a best-effort fallback is produced.
- CORS allowed origins are controlled with `ALLOWED_ORIGINS` in `worker/wrangler.toml`.

## Frontend UX

- Pass an arXiv URL via `?paper=` param (abs or pdf).
- Renders sections:
	- One-line Summary
	- Problems Solved
	- Key Innovations
	- Collaboration Type (+ expandable Authors)
	- Takeaways
	- Things to Note (optional)
- Copy/share:
	- Copy: one-tap clipboard of a concise, readable summary block
	- Email: prefilled `mailto:` including the summary text
	- LinkedIn: share the arXiv link

## Quickstart (local)

Prereqs: Node 18+, Cloudflare Wrangler, a Google Generative Language API key.

1) Install deps

```bash
npm i
```

2) Set your Worker secrets

```bash
cd worker
wrangler secret put GOOGLE_API_KEY
```

3) Dev servers

```bash
# Frontend
npm run dev

# Backend (Cloudflare Worker)
npm run worker:dev
```

4) Open the app and test

```text
http://localhost:5173/?paper=https://arxiv.org/abs/2506.01667
```

By default, `.env` points `VITE_API_BASE` to the deployed workers.dev URL. For local Worker, set `VITE_API_BASE=http://localhost:8787` in `.env.local`.

## Deploy

```bash
npm run build
npm run worker:deploy
```

Ensure `ALLOWED_ORIGINS` includes your production site (e.g., GitHub Pages origin) in `worker/wrangler.toml`.

## Roadmap

- Add more share targets (X, WhatsApp, Slack)
- Add explicit "Copy JSON" and export as `.md`
- Improve collaboration inference using arXiv affiliations
- Optional PDF parsing fallback for non-arXiv sources
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
