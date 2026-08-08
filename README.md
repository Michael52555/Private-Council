# Private Council

Private Council lets participants share planning constraints privately and ranks
restaurant candidates without exposing the underlying reasons.

## Local development

Node.js 22.5 or newer is required because the central cache uses Node&apos;s
built-in SQLite module.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Restaurant ordering-source discovery

The current restaurant flow deliberately separates provider discovery from menu
extraction:

1. `POST /api/generate-candidates` uses Google Geocoding and Places Nearby
   Search to return real restaurants. A numeric Google `priceRange` becomes a
   medium-confidence budget fallback. If only `priceLevel` exists, the app uses
   a broad, explicitly low-confidence US-dollar band.
2. `POST /api/restaurants/ordering-sources` opens the restaurant's Google Maps
   listing, targets its **Online ordering** control, and returns only provider
   URLs exposed by that interaction. The ordinary restaurant website is
   returned separately as an explicitly uncounted fallback.
3. Provider URLs, scraper diagnostics, and raw menu items remain central-model
   implementation details. The candidate interface shows only the restaurant,
   score, distance, and estimated per-person price.

Candidate generation can return up to twenty restaurants. Cached menu results
are joined into that initial response in one database query, so known places are
scored immediately and never enter the scraper queue. Three bounded workers
inspect only cache misses. Discovery preserves the Google Maps panel's visual
order but accepts only reusable major-provider integrations such as DoorDash,
Uber Eats, Grubhub, Toast, Olo, ChowNow, Square, and Clover. Restaurant-owned
ordering sites are skipped, so the first matching major-provider link becomes
primary and up to two later matches remain available as runtime fallbacks.
A successful menu can replace the Google fallback with a typical per-person
meal estimate. The estimator classifies raw menu items into complete meals,
mains, shared mains, small plates, sides, drinks, desserts, unit-priced items,
and accessories. It then applies one bounded composition template: a direct
combo price, one main with an optional side and drink, two to three small
plates, or several shared dishes divided across the party. It never enumerates
arbitrary item combinations, so work remains linear in menu size. Family and
catering packages are excluded from single-person templates. Unit-priced sushi
pieces are not mistaken for a full meal unless the menu also exposes enough
complete meals.

Composition confidence affects ranking weight: direct meals and clear mains
carry more weight than inferred shared-plate baskets. A menu estimate that is
implausibly far outside Google's numeric range is rejected in favor of the
Google fallback.

Blocked or unrecognized menus leave the Google fallback intact. Budget
compatibility is continuous: it combines the representative meal price with
the overlap between the restaurant and requested ranges. Google numeric ranges
receive less scoring weight than menu data, and coarse Google price levels
receive still less. If neither source provides numeric prices, the overall
score remains pending and the UI reports how many preferences have enough
evidence; it does not present a distance-only result as a complete score.

## Central restaurant cache

Ordering discovery and menu extraction are cached on the server rather than in
each participant's browser. The API routes use a shared SQLite database at
`.data/restaurant-cache.sqlite` by default:

- Successful Google ordering-source discovery is cached for 14 days. Empty
  discovery results are cached for only five minutes because Google Maps controls
  and browser rendering can be transient.
- Extracted raw menu items and their derived meal estimate have separate cache
  semantics. Raw items are retained, but a result that no longer produces a
  reliable estimate remains eligible for another provider attempt. The first
  reliable result for the current menu schema is then reused permanently.
- Failed or price-less menu attempts are cached for three hours so many local
  agents do not repeatedly hit the same blocked provider. Negative entries are
  versioned and fingerprinted by their provider inputs, so a changed adapter or
  provider list invalidates only the affected failures without deleting useful
  menu data.
- Clicking **Regenerate options** bypasses negative ordering and menu caches for
  unresolved restaurants while continuing to reuse successful menu results.
- Incrementing `menuSchemaVersion` starts a clean generation when the extraction
  or meal-estimation algorithm changes.

Cached successful results retain the extracted raw menu items. Derived price
quartiles, median, and confidence are recomputed from those items when the cache
is read, so estimator improvements do not require another provider scrape.

The SQLite file belongs to the central service, so all local agents connected to
that service reuse the same restaurant data. In a hosted environment,
`RESTAURANT_CACHE_DB_PATH` must point to a persistent volume. A future Postgres
adapter can replace SQLite behind the same cache boundary when the central model
runs across multiple server instances.

## Environment variables

Required:

- `GOOGLE_MAPS_API_KEY`: enables Geocoding, Nearby Search, and Place Details.
- `OPENAI_API_KEY`: used by the existing preference interpretation routes.

Optional browser configuration (choose one):

- `PLAYWRIGHT_WS_ENDPOINT`: a remote Chromium CDP WebSocket endpoint.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`: an installed local Chromium binary.

Optional central cache configuration:

- `RESTAURANT_CACHE_DB_PATH`: persistent SQLite path. Defaults to
  `.data/restaurant-cache.sqlite` for local development.

During local development, an installed macOS/Windows/Linux Chrome or Chromium is
detected automatically. In a hosted environment, set `PLAYWRIGHT_WS_ENDPOINT`.
Without a browser, Google Maps interaction fails quietly behind the central API
and the candidate falls back to available Google price evidence.

## Quality checks

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

The fetcher accepts only public HTTPS destinations, validates every redirect,
blocks private-network addresses, caps response size, and limits one restaurant
request to five menu sources.
