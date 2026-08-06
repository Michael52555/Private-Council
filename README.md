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

## Restaurant and menu pipeline

The restaurant flow now has three stages:

1. `POST /api/generate-candidates` uses Google Geocoding and Places Nearby
   Search to return real restaurants. Candidates start with no dollar estimate;
   Google price levels are retained only as metadata and never enter scoring.
2. `POST /api/restaurants/ordering-sources` starts from a Google Place ID,
   follows the restaurant website's menu/order links, and—when a browser is
   configured—opens the Google Maps online-order control to collect additional
   providers.
3. `POST /api/restaurants/menu` extracts and normalizes menu items from up to
   five discovered sources. It tries Schema.org JSON-LD, provider application
   JSON, and semantic DOM markup. Dynamic pages are rendered with Playwright
   when a browser is configured.

After candidate generation, the browser automatically enriches every restaurant
with two concurrent workers. Until a menu is read, the card shows **Checking
online menu** and its budget score remains pending. Once prices are available,
the card displays the menu-item 25th–75th percentile range and recomputes its
local score. The card action is retained only for refresh/retry.

## Environment variables

Required:

- `GOOGLE_MAPS_API_KEY`: enables Geocoding, Nearby Search, and Place Details.
- `OPENAI_API_KEY`: used by the existing preference interpretation routes.

Optional browser configuration (choose one):

- `PLAYWRIGHT_WS_ENDPOINT`: a remote Chromium CDP WebSocket endpoint.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`: an installed local Chromium binary.

During local development, an installed macOS/Windows/Linux Chrome or Chromium is
detected automatically. In a hosted environment, set `PLAYWRIGHT_WS_ENDPOINT`.
Without a browser, normal restaurant websites and server-rendered menu pages
still work; Google Maps button interaction and JavaScript-only provider menus
return a warning instead of failing the entire restaurant check.

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
