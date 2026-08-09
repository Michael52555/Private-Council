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
   Search to return real restaurants. `primaryType` and `types` classify each
   candidate as `fast_food` or `sit_down` before menu enrichment begins. A
   numeric Google `priceRange` is retained only as a final fallback. If only
   `priceLevel` exists, the fallback is a broad low-confidence US-dollar band.
2. `POST /api/restaurants/ordering-sources` opens the restaurant's Google Maps
   listing, targets its **Online ordering** control, and returns only provider
   URLs exposed by that interaction. The ordinary restaurant website is
   returned separately as an explicitly uncounted fallback.
3. Provider URLs, scraper diagnostics, and raw menu items remain central-model
   implementation details. The candidate interface shows only the restaurant,
   score, distance, and estimated per-person price.

Candidate generation can return up to twenty restaurants. Cached menu results
are joined into that initial response in one database query, so known places are
scored immediately and never enter the scraper queue. Two bounded discovery workers
inspect only cache misses. The current focused pipeline opens the Google Maps
ordering panel, explicitly activates Delivery/外送, and accepts only a Grubhub
source. Restaurants without Grubhub remain unresolved for later fallback work.
For a resolved restaurant, extraction is restricted to Grubhub's **Best
Sellers** section (or item-level Best Seller badges), preventing full-menu
sauces, merchandise, modifiers, and unrelated low-price items from distorting
the representative meal estimate.
A successful menu produces a typical per-person meal estimate through one of
two bounded models. Fast-food restaurants use explicit combo/meal/box items
first; otherwise the estimator composes a recognized main, side, and drink
when those roles are available. Individual tacos, wings, nuggets, and similar
unit items cannot become a complete meal by themselves. Sit-down restaurants
use one recognized main entry plus one side and one drink when present. Unknown
items, drinks, desserts, accessories, and unit-priced sushi do not enter a main
price distribution. The estimator never enumerates arbitrary combinations, so
work remains linear in the Best Sellers sample.

Composition confidence affects ranking weight. A reliable Grubhub result is
always authoritative even when it conflicts with Google's price range; Google
pricing is promoted only after Grubhub discovery or estimation fails.

Unrecognized menus leave the Google fallback intact. Temporary provider rate
limits and timeouts do not display a generic Google band as though it were a
completed menu estimate; they leave the price unresolved until a later retry.
Budget
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
  menu data. HTTP 429 failures use a shorter five-minute cooldown.
- Grubhub extraction is serialized by a central provider queue with spacing
  between browser sessions. Clicking **Regenerate options** continues to reuse
  both successful and negative caches instead of producing a full-provider
  request burst.
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
- `RESTAURANT_CACHE_DISABLED`: set to `1` during scraper debugging to bypass
  every restaurant ordering/menu cache read and write. Leave unset in normal
  central-model operation.

To remove all locally stored restaurant ordering and menu results, stop the dev
server first and run `npm run cache:clear`. This deletes the configured SQLite
database together with its `-wal` and `-shm` sidecar files. To run every request
live without recreating cache entries, start development with
`RESTAURANT_CACHE_DISABLED=1 npm run dev`.

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
