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

Optionally add a third secret to switch on **Look up online** in the compatibility table:

- `ANTHROPIC_API_KEY` — a key from [console.anthropic.com](https://console.anthropic.com)

Everything else works without it; the button just reports that the key is missing. Each
lookup is one billed Claude request with web search, so it is a button you press rather than
something that runs on its own.

## Routes

| Route | Purpose |
|---|---|
| `GET /` | the app |
| `POST /api/login` | verifies the gate password against `APP_PASS` |
| `GET /api/fetch?url=…` | server-side image fetch, so pasted image URLs aren't blocked by CORS |
| `POST /api/verify-mpn` | web search for a part number's vehicle fitments (needs `ANTHROPIC_API_KEY`) |
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

**Vehicle compatibility** auto-fill is fully deterministic — no AI — and always leaves the
table populated. It resolves in confidence order and never discards rows you typed:

1. `exact` — this part number is already in the catalog
2. `cross-ref` — one of this product's own OE numbers is in the catalog
3. `platform` — the hand-curated `PLATFORM_DB` table, keyed by part-number family
4. `family` — inferred from catalog siblings sharing a family prefix
5. seed — a single row built from Brand / Model / Year, flagged for you to check

The catalog index is built in the background by reading each product individually (GHL's
list endpoint omits `description`), preferring the structured compatibility rows and falling
back to scraping the rendered table for older products. It is cached in `localStorage` for
24 hours. Every row from every source must pass `validateFitmentRow()`: a known make, a real
4-digit year or year range, a plausible model, and a valid drive side. Rows that fail are
dropped and reported, never inserted.

Compatibility feeds nothing else — not the product name, not the SKU, not the SEO fields.

**Look up online** covers the case the list above cannot: a part number that is genuinely new,
so it is in no catalog and no cross-reference table. It sends the number to the Worker, which
asks Claude to search the web for it and return structured fitment rows with their sources.

It behaves differently from **Auto-fill from MPN** on purpose:

- Nothing is written into the table. Results appear as a proposal with the pages they came
  from, and you choose **Replace table**, **Add missing** or **Dismiss**.
- Every row still goes through `validateFitmentRow()` first. Rows with an unknown make, prose
  in the model field or a vague year ("around 2010") are dropped, and the count is shown so a
  quiet drop can't be mistaken for a complete answer.
- If the number isn't found, it says so rather than offering a near-miss.

It costs one Claude request per press, so it is a deliberate action, never automatic.

**SKU** is your product feed ID, so the app treats it as the product's identity rather than
something to regenerate. On an existing product it is read from the GHL price record and
shown locked; publishing does **not** send it back unless you unlock the field and change it
yourself. New products and duplicates get a freshly generated, editable SKU.
