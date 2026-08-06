import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { existsSync } from "node:fs";
import { dedupeSources, inferProvider, makeOrderingSource } from "@/lib/menu/providers";
import { assertPublicHttpsUrl } from "@/lib/menu/security";
import type { OrderingSource } from "@/lib/menu/types";

export class BrowserNotConfiguredError extends Error {
  constructor() {
    super(
      "Dynamic ordering-page discovery needs PLAYWRIGHT_WS_ENDPOINT or PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.",
    );
    this.name = "BrowserNotConfiguredError";
  }
}

function systemChromePath(): string | undefined {
  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
      : process.platform === "win32"
        ? [
            `${process.env.PROGRAMFILES ?? "C:\\Program Files"}\\Google\\Chrome\\Application\\chrome.exe`,
            `${process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)"}\\Google\\Chrome\\Application\\chrome.exe`,
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
          ];

  return candidates.find((candidate) => existsSync(candidate));
}

export function isBrowserConfigured(): boolean {
  return Boolean(
      process.env.PLAYWRIGHT_WS_ENDPOINT ||
      process.env.BROWSER_WS_ENDPOINT ||
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      systemChromePath(),
  );
}

async function openBrowser(): Promise<{ browser: Browser; remote: boolean }> {
  const wsEndpoint = process.env.PLAYWRIGHT_WS_ENDPOINT ?? process.env.BROWSER_WS_ENDPOINT;
  if (wsEndpoint) {
    return { browser: await chromium.connectOverCDP(wsEndpoint), remote: true };
  }

  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
    systemChromePath();
  if (executablePath) {
    return {
      browser: await chromium.launch({ executablePath, headless: true }),
      remote: false,
    };
  }

  throw new BrowserNotConfiguredError();
}

async function withPage<T>(task: (page: Page, context: BrowserContext) => Promise<T>): Promise<T> {
  const { browser } = await openBrowser();
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);

  try {
    return await task(page, context);
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

export async function renderPublicPage(rawUrl: string): Promise<{
  html: string;
  finalUrl: string;
}> {
  const url = await assertPublicHttpsUrl(rawUrl);
  return withPage(async (page) => {
    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => undefined);
    return { html: await page.content(), finalUrl: page.url() };
  });
}

function isGoogleMapsHost(hostname: string): boolean {
  return (
    hostname === "google.com" ||
    hostname.endsWith(".google.com") ||
    hostname === "googleusercontent.com" ||
    hostname.endsWith(".googleusercontent.com") ||
    hostname === "gstatic.com" ||
    hostname.endsWith(".gstatic.com")
  );
}

export async function discoverGoogleOrderingLinks(googleMapsUrl: string): Promise<OrderingSource[]> {
  const safeUrl = await assertPublicHttpsUrl(googleMapsUrl);

  return withPage(async (page, context) => {
    const sources: OrderingSource[] = [];
    const pages = new Set<Page>([page]);
    const orderText = /order online|place an order|order food|pickup|delivery|在线订餐|订餐|外带|外送/i;

    const recordNavigation = (candidatePage: Page) => {
      pages.add(candidatePage);
      candidatePage.on("framenavigated", (frame) => {
        if (frame !== candidatePage.mainFrame()) return;
        try {
          const url = new URL(frame.url());
          if (url.protocol !== "https:") return;
          const provider = inferProvider(url.toString());
          if (!isGoogleMapsHost(url.hostname) || provider.provider === "google_ordering") {
            sources.push(makeOrderingSource({
              url: url.toString(),
              discoveredFrom: "google_maps",
            }));
          }
        } catch {
          // The page may briefly navigate through non-URL states.
        }
      });
    };

    context.on("page", recordNavigation);
    recordNavigation(page);

    await page.goto(safeUrl.toString(), { waitUntil: "domcontentloaded", timeout: 25_000 });
    await page.waitForTimeout(1_500);

    const orderControl = page
      .getByRole("button", { name: orderText })
      .or(page.getByRole("link", { name: orderText }))
      .or(page.locator("button, a").filter({ hasText: orderText }))
      .first();
    if (await orderControl.count()) {
      await orderControl.click({ timeout: 8_000 }).catch(() => undefined);
      await page.waitForTimeout(2_000);
    }

    for (const candidatePage of pages) {
      await candidatePage.waitForLoadState("domcontentloaded", { timeout: 4_000 }).catch(() => undefined);
      for (const frame of candidatePage.frames()) {
        const links = await frame
          .locator("a[href]")
          .evaluateAll((anchors) =>
            anchors.map((anchor) => ({
              href: (anchor as HTMLAnchorElement).href,
              text: `${anchor.textContent ?? ""} ${anchor.getAttribute("aria-label") ?? ""}`.trim(),
            })),
          )
          .catch(() => [] as Array<{ href: string; text: string }>);

        for (const link of links) {
          try {
            const url = new URL(link.href);
            if (url.protocol !== "https:") continue;
            const provider = inferProvider(url.toString());
            const isKnownProvider = provider.provider !== "restaurant_website";
            if (!isKnownProvider && (!orderText.test(link.text) || isGoogleMapsHost(url.hostname))) continue;
            sources.push(
              makeOrderingSource({
                url: url.toString(),
                text: link.text,
                discoveredFrom: "google_maps",
              }),
            );
          } catch {
            // Ignore malformed anchor URLs.
          }
        }
      }
    }

    return dedupeSources(sources);
  });
}
