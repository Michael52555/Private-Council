# Private Council

Private Council lets participants share planning constraints privately and ranks
restaurant candidates without exposing the underlying reasons.

## Local development

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
3. The candidate lab lists each provider, domain, final URL, discovery method,
   unresolved controls, and every warning. It also aggregates provider counts
   across the current ten restaurants so the next extraction adapters can be
   chosen from observed data.

After candidate generation, two workers inspect all ten restaurants. Exact menu
extraction remains optional: the registered provider adapters try up to three
Google-listed sources in order and stop at the first reliable priced menu. A
successful menu replaces the Google fallback with a high-confidence estimate;
blocked or unrecognized menus leave the Google fallback intact. If neither
source provides numeric prices, budget scoring remains pending.

## Environment variables

Required:

- `GOOGLE_MAPS_API_KEY`: enables Geocoding, Nearby Search, and Place Details.
- `OPENAI_API_KEY`: used by the existing preference interpretation routes.

Optional browser configuration (choose one):

- `PLAYWRIGHT_WS_ENDPOINT`: a remote Chromium CDP WebSocket endpoint.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`: an installed local Chromium binary.

During local development, an installed macOS/Windows/Linux Chrome or Chromium is
detected automatically. In a hosted environment, set `PLAYWRIGHT_WS_ENDPOINT`.
Without a browser, Google Maps button interaction returns a visible diagnostic;
the restaurant website is shown only as an uncounted fallback.

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
