# PSRD manager — correctness & reliability review (vs real GHL API docs)

Scope: every GHL endpoint the app uses, checked against the **2021-07-28** API docs
(the Version the Worker pins). Sources: official OpenAPI schemas
(marketplace.gohighlevel.com, mirrored verbatim at help.hoopai.com /api-reference/products/openapi.json),
collection docs, media upload docs, and the official request/response examples.

## Documented contracts the app must honor

| Endpoint | Contract per docs |
|---|---|
| `GET /products?locationId=&limit=&offset=` | res `{products:[...], total:[{total:n}]}`; item fields include `description`, `slug`, `availableInStore`, `collectionIds`, `label`, `image`, `name`, `_id` |
| `GET /products/{id}?locationId=` | product object at top level (required `_id, locationId, name, productType, createdAt, updatedAt`) |
| `POST /products` | req: `name`,`locationId`,`productType` required; `medias[]` entries require `id`,`url`,`type`; `seo:{title,description}`; `label:{title(required),startDate,endDate}` in `YYYY-MM-DDTHH:mm:ssZ`; `isLabelEnabled` — "If this is true, label object cannot be empty" |
| `PUT /products/{id}` | same required fields as POST |
| `GET /products/{id}/price?locationId=&limit=&offset=` | res `{prices:[...], total:n}`; docs price fields: `_id, locationId, product, name, type, currency, amount, compareAtPrice, trackInventory, availableQuantity, allowOutOfStockPurchases…` — **`sku` is NOT documented on the price response** (it IS on create/update requests and inventory items) |
| `POST /products/{id}/price` | req required: `name,type,currency,amount,locationId`; optional: `sku, trackInventory, availableQuantity, allowOutOfStockPurchases, compareAtPrice, meta, description…`; res 201 = price object |
| `PUT /products/{id}/price/{priceId}` | same required fields; res 200 = price object |
| `GET /products/collections?altId=&altType=&limit=&offset=` | `altId`,`altType` REQUIRED ("location"); res `{data:[...], total:n}`; item: `_id, altId, name, slug, type, image, seo, createdAt` |
| `POST /products/collections` | req: `altId`,`altType`,`name`,`slug` required; `image`,`seo` optional; res 201 `{data:{_id…}}` |
| `PUT /products/collections/{id}` | req: `altId`,`altType` required; others optional; res `{status,message}` |
| `DELETE /products/collections/{id}?altId=&altType=` | `altId`,`altType` required; res `{status,message}` |
| `POST /medias/upload-file` | multipart; "If hosted is set to true then fileUrl is required. Else file is required."; file ≤ 25 MB; res `{fileId, url}` |

Not in documented schemas: `seo.keywords` (app sends it; tolerated in practice), product `tags`
(UI edits `STATE.productTags`, loads `prod.tags`). No webhook usage exists anywhere in the app.

## Findings (each independently judgeable)

- F1 (HIGH) price PUT drops/replaces loaded price fields. publish sends a fresh payload and hard-codes
  `allowOutOfStockPurchases:false`; and the "don't resend the SKU" logic hinges on the price-list
  response returning `sku` — undocumented, so `STATE._loadedSku=''` makes publish REGENERATE and
  overwrite the real feed ID (directly violates the README contract). FIX: keep
  `STATE._loadedPrice`; build the PUT from it (minus server keys) and let the UI override managed
  fields; assign `sku` only when new/absent/edited.
- F2 (MED) label dates sent date-only; docs demand `YYYY-MM-DDTHH:mm:ssZ`. FIX: convert date-only
  inputs to full ISO (start=T00:00:00.000Z, end=T23:59:59.999Z); leave full ISO untouched.
- F3 (MED) label On + empty title violates "label object cannot be empty"/required title. FIX:
  publish pre-flight blocks with a clear message.
- F4 (MED) product tags never published. New-product tags silently dropped; existing-product tag
  edits silently reverted (raw passthrough only). FIX: assign `payload.tags=STATE.productTags`.
- F5 (LOW/MED) `medias[].priceIds` (a docs field) silently dropped when the editor rebuilds media
  entries. FIX: merge unknown keys from the matching raw media entry (by id, else url).
- F6 (MED) collection semantics: "— none —" leaves the old id in place; empty collIds skips the
  assignment so removal resurrects `raw.collectionIds`; publish brand-fallback re-adds a collection
  after an explicit "none". FIX: explicit pick tracking + swap + always assign collectionIds.
- F7 (MED) footer-note corruption: last no-link note heuristic loads the WARRANTY text as the
  footer whenever the custom footer carries the WA link (only "/Old rack/i" saves the exact
  default). FIX: ignore the five renderer-fixed notes, take the last remaining note.
- F8 (LOW) fitment index re-fetches all products even though the LIST response already carries
  `description` per docs. FIX: track ingested ids (list + cache), skip in buildFitIndex.
- F9 (LOW) collections manager: clearing the image input omits the field, GHL keeps old image.
  FIX: always send `image` (empty clears).
- F10 (HIGH) `loadProduct` never clears `_undoStack/_redoStack` → after loading product B,
  Ctrl+Z applies product A's stored fields with `STATE.current={B}` → publish cross-contaminates.
  FIX: clear both stacks on load.
- F11 (MED) publish allowed after a failed load of an existing product (`_rawProd=null`) → payload
  explicitly sends `medias:[]` and wipes the gallery. FIX: refuse when raw record is missing.
- F12 (MED) duplicateProduct carries per-product GHL data: label state + inventory/stock.
  FIX: reset label + inventory in duplicate like clearForm does.
- F13 (LOW) dirty-flag lies: resetSlug(), toggleSkuLock(), rmImg() never flag; maybeAutoCompat's
  silent drive flip changes SEO/name without dirty; `_applySnap` always marks dirty even when the
  restored snapshot equals the load-time snapshot. FIX each; compute dirty vs load-time snapshot.
- F14 (LOW) after publishing, `_loadedSku/skuLocked/priceId/_priceName/collectionIdsAll` aren't
  re-synced from GHL responses; new-product sku shows unlocked/re-generated after publish.
  FIX: sync from price-save response + product-save response.

## Verified correct (checked against docs — no change)
- Worker: Version + Authorization on each proxied call; multipart boundary preserved; URL mapping
  `/api/ghl/<path>` → `services.leadconnectorhq.com/<path>` + query intact.
- Response-shape tolerance for GET product / GET price matches docs (unwrapped product; `{prices,total}`).
- Endpoint methods/paths and collection `altId`/`altType` params match docs.
- Media upload fields (`file`+`name`; `hosted`+`fileUrl`+`name`) match docs; `{fileId,url}` consumed
  defensively.
- Product PUT overlay starts from the loaded raw record minus server-owned keys — price PUT should
  match (F1).
- Fitment ingest validates every row from every source.

