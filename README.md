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
| `wrangler.jsonc` | Deploy config. `name` must stay `psrd-manager` — it has to match the Worker in the dashboard or the build is rejected. |
| `package.json` | Pins Wrangler and provides `npm run build` / `check` / `deploy`. |

`psrd-worker.js` remains a single paste-and-deploy file. It just isn't hand-edited any more —
the UI lives in `psrd-app.html` so changes are reviewable as an ordinary diff.

## Making a change

```bash
# 1. edit psrd-app.html
# 2. regenerate the worker (verifies the literal round-trips back to the HTML)
node build.js
# 3. deploy (either one)
npx wrangler deploy               # from the command line
#   ...or paste psrd-worker.js into the Cloudflare Worker editor
```

Never edit the `APP_HTML` literal in `psrd-worker.js` by hand — `build.js` overwrites it.
`node build.js --check` fails if `psrd-worker.js` was left stale; run it before committing.

## Deploy / setup

1. Cloudflare dashboard → Workers & Pages → Create → Worker → paste `psrd-worker.js` → Deploy
2. Worker → Settings → Variables and Secrets → add two secrets:
   - `GHL_TOKEN` — the GHL Private Integration Token (`pit-…`)
   - `APP_PASS` — the password typed at the app's gate
3. Open the Worker URL and sign in.

Secrets are never removed by a deploy, so they only need setting once.

### Deploying from GitHub (Workers Builds)

If the Worker is connected to this repository under **Settings → Builds**:

| Setting | Value |
|---|---|
| Git branch | `main` |
| Build command | `node build.js` |
| Deploy command | `npx wrangler deploy` |

The build fails without `wrangler.jsonc`, and it fails again if the `name` in that file
does not match the Worker's name in the dashboard. Both are correct in this repo.
Pushing to the watched branch is what triggers a deploy — work sitting on another branch
is never built.

## Routes

| Route | Purpose |
|---|---|
| `GET /` | the app |
| `POST /api/login` | verifies the gate password against `APP_PASS` |
| `GET /api/fetch?url=…` | server-side image fetch, so pasted image URLs aren't blocked by CORS |
| `* /api/ghl/<path>` | proxied to `services.leadconnectorhq.com` with auth headers injected |

Everything under `/api/` except `/api/login` requires the `X-PSRD-Key` header.

## How the app decides things

**SEO** is generated from the product fields only — deliberately not from the compatibility
table, so editing fitments can never rewrite your listing:

- Title — `[Make] [Models] OEM [Part type in full] [MPN] [yyyy] [RHD|LHD]`, capped at 70
  characters. Models come from the Model field and are dropped from the end until it fits.
- Description — `Genuine [Brand] [Part type] for [left|right]-hand drive models from [yyyy]
  onwards. Ref: [cross-references and module numbers]`, capped at 150 characters.
  Reference numbers are dropped from the end until it fits.

Editing either field by hand sets `seoManual` and the generator stops overwriting it;
**Re-generate** resumes automatic mode.

**Vehicle compatibility** fills itself from what you type. As you enter Brand, Model,
Year range and Driver side, the table mirrors them — no button, never empty. Separate models
with a comma or a slash (`Q5, SQ5`) to get one row each; a plain space is left alone so
`Crafter II` stays one model.

The moment you edit any cell, add a row or remove one, it stops following and the rows are
yours. **Rebuild from the fields above** appears at that point if you want to hand it back.
A product loaded from GHL keeps its saved table and never follows the fields.

**Add matches from catalog** is optional and only ever *adds*. If this part number, or one of
its cross-references, is already on another product in your store, it brings those vehicles in
alongside your rows. It resolves in confidence order:

1. `exact` — this part number is already in the catalog
2. `cross-ref` — one of this product's own OE numbers is in the catalog
3. `platform` — the hand-curated `PLATFORM_DB` table, keyed by part-number family
4. `family` — inferred from catalog siblings sharing a family prefix

The catalog index is built in the background by reading each product individually (GHL's
list endpoint omits `description`), preferring the structured compatibility rows and falling
back to scraping the rendered table for older products. It is cached in `localStorage` for
24 hours. Every row from every source must pass `validateFitmentRow()`: a known make, a real
4-digit year or year range, a plausible model, and a valid drive side. Rows that fail are
dropped, never inserted.

Compatibility feeds nothing else — not the product name, not the SKU, not the SEO fields.

**Top badges** are edited as one list in the order the product page renders them — tax,
condition, quality, warranty, driver side — with each badge's live chip on the same row as the
control that sets it. Condition is derived from the Condition buttons and has no input of its
own. Quality and driver side show their derived default as a *placeholder*, so an empty box
means "use the default" and a filled one is your override. The returns window lives in
**Delivery & returns**, next to the paragraph it is written into.

**SKU** is your product feed ID, so the app treats it as the product's identity rather than
something to regenerate. On an existing product it is read from the GHL price record and
shown locked; publishing does **not** send it back unless you unlock the field and change it
yourself. New products and duplicates get a freshly generated, editable SKU.
