# psrd-manager

Power Steering Rack Direct product manager app for internal use only.

A single Cloudflare Worker that serves the product manager UI and proxies the GoHighLevel
API, so the GHL private token never reaches the browser.

## Files

| File | Purpose |
|---|---|
| `psrd-app.html` | **The source for everything the browser sees** — markup, styles and app JS. Edit this. |
| `build.js` | Inlines `psrd-app.html` into the `APP_HTML` literal at the bottom of `psrd-worker.js`. |
| `psrd-worker.js` | The deployable Worker: routes, GHL proxy, and the generated `APP_HTML`. |

`psrd-worker.js` remains a single paste-and-deploy file. It just isn't hand-edited any more —
the UI lives in `psrd-app.html` so changes are reviewable as an ordinary diff.

## Making a change

```bash
# 1. edit psrd-app.html
# 2. regenerate the worker (verifies the literal round-trips back to the HTML)
node build.js
# 3. paste psrd-worker.js into the Cloudflare Worker editor and deploy
```

Never edit the `APP_HTML` literal in `psrd-worker.js` by hand — `build.js` overwrites it.

## Deploy / setup

1. Cloudflare dashboard → Workers & Pages → Create → Worker → paste `psrd-worker.js` → Deploy
2. Worker → Settings → Variables and Secrets → add two secrets:
   - `GHL_TOKEN` — the GHL Private Integration Token (`pit-…`)
   - `APP_PASS` — the password typed at the app's gate
3. Open the Worker URL and sign in.

## Routes

| Route | Purpose |
|---|---|
| `GET /` | the app |
| `POST /api/login` | verifies the gate password against `APP_PASS` |
| `GET /api/fetch?url=…` | server-side image fetch, for agent-generated URLs (no CORS) |
| `* /api/ghl/<path>` | proxied to `services.leadconnectorhq.com` with auth headers injected |

Everything under `/api/` except `/api/login` requires the `X-PSRD-Key` header.

## How the app decides things

**SEO** is generated from the product fields and the compatibility table:

- Title — `[Brand] [models] [part-type-short] OEM [MPN] [RHD|LHD]`, capped at 70 characters.
  Models come from the compatibility rows (falling back to the Model field) and are dropped
  from the end until the title fits.
- Description — `Genuine [Brand] part [MPN] OEM [part-type-short] Cross-ref: [r1, r2, r3] fits
  [left|right]-hand drive models from [yyyy] onwards.`, capped at 150 characters. The start
  year is the earliest across the compatibility rows.

Editing either field by hand sets `seoManual` and the generator stops overwriting it;
**Re-generate** resumes automatic mode.

**Vehicle compatibility** auto-fill resolves in confidence order and never silently
overwrites rows you typed:

1. `exact` — this part number is already in the catalog
2. `cross-ref` — one of this product's own OE numbers is in the catalog
3. `platform` — the hand-curated `PLATFORM_DB` table, keyed by part-number family
4. `family` — inferred from catalog siblings sharing a family prefix
5. AI agent — last resort

The catalog index is built from every product's `psrd-meta` JSON blob (falling back to
scraping the rendered compatibility table for older products) and cached in `localStorage`
for 24 hours. Every row from every source — including the agent — must pass
`validateFitmentRow()`: a known make, a real 4-digit year or year range, a plausible model,
and a valid drive side. Rows that fail are dropped and reported, never inserted.

Anything short of a high-confidence hit into an empty table lands in a review strip with
**Replace table** / **Add missing** / **Dismiss**.
