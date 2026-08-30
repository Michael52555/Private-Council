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

## Restaurant profiling

`POST /api/generate-candidates` uses Google Geocoding and Places Nearby Search
to define the restaurant set. Every valid Google place stays in the result even
when later enrichment is incomplete.

Candidate metadata is normalized by the OpenAI Responses API in batches of up
to eight restaurants, with at most two batches in flight. One structured result
contains:

- zero or more tags from the fixed cuisine and food/style vocabulary;
- an independent confidence level for those tags;
- a conservative USD range for one typical complete meal before tax and tip;
- an independent confidence level for that range.

Country cuisines are not inferred from dining styles alone. For example, hot
pot does not imply Chinese unless the restaurant metadata supports both tags.
Missing facet evidence remains neutral rather than becoming a false mismatch.

API failures are isolated by batch and never fail candidate generation. The
existing Google type vector supplies the food fallback. Google numeric pricing
or its broad price-level band supplies the first budget fallback; if neither is
available, a deliberately broad category-based range completes the profile at
low confidence. Ranking weights all evidence by its source and confidence.

The old ordering-source and menu routes remain in the codebase for diagnostics,
but current candidate generation does not invoke the Grubhub or DoorDash
scraper pipeline.

## Central restaurant cache

Restaurant profiles are cached on the server rather than in each participant's
browser. The API routes use a shared SQLite database at
`.data/restaurant-cache.sqlite` by default:

- Each restaurant is stored independently for 30 days.
- Cache identity includes the Google place ID, profile schema version, prompt
  version, and exact model name.
- A fingerprint of stable restaurant metadata invalidates a profile when the
  place name, address, website, or Google types change.
- Invalid, incomplete, or failed API responses are not cached; deterministic
  fallbacks remain immediately available.

The SQLite file belongs to the central service, so all local agents connected to
that service reuse the same restaurant data. In a hosted environment,
`RESTAURANT_CACHE_DB_PATH` must point to a persistent volume. A future Postgres
adapter can replace SQLite behind the same cache boundary when the central model
runs across multiple server instances.

## Environment variables

Required:

- `GOOGLE_MAPS_API_KEY`: enables Geocoding, Nearby Search, and Place Details.
- `OPENAI_API_KEY`: used by restaurant profiling and preference interpretation.

Optional profiler configuration:

- `RESTAURANT_PROFILE_MODEL`: exact OpenAI model name. Defaults to
  `gpt-5-mini`; changing it automatically selects a separate cache generation.

Optional central cache configuration:

- `RESTAURANT_CACHE_DB_PATH`: persistent SQLite path. Defaults to
  `.data/restaurant-cache.sqlite` for local development.
- `RESTAURANT_CACHE_DISABLED`: set to `1` to bypass restaurant profile cache
  reads and writes. Leave unset in normal operation.

To remove all locally stored restaurant results, stop the dev
server first and run `npm run cache:clear`. This deletes the configured SQLite
database together with its `-wal` and `-shm` sidecar files. To run every request
live without recreating cache entries, start development with
`RESTAURANT_CACHE_DISABLED=1 npm run dev`.

## Quality checks

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```
