import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright-core";
import { existsSync } from "node:fs";
import {
  dedupeSources,
  inferProvider,
  makeOrderingSource,
  unwrapGoogleRedirect,
} from "@/lib/menu/providers";
import { assertPublicHttpsUrl } from "@/lib/menu/security";
import type {
  OrderingDiscoveryDiagnostics,
  OrderingSource,
} from "@/lib/menu/types";

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
  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1440, height: 1200 },
  });
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

type LinkCandidate = {
  href: string;
  text: string;
};

export type GoogleOrderingDiscoveryResult = {
  sources: OrderingSource[];
  warnings: string[];
  diagnostics: OrderingDiscoveryDiagnostics;
};

const exactOrderControlText =
  /^(?:order online|online ordering|place an order|order food|在线订餐|线上订餐|网上订餐)$/i;
const broadOrderControlText =
  /order online|online ordering|place an order|order food|在线订餐|线上订餐|网上订餐/i;
const orderingEvidenceText =
  /order|pickup|pick-up|delivery|takeout|door\s*dash|uber\s*eats|grubhub|toast|chownow|olo|square|clover|订餐|外带|外送|自取/i;
const nonProviderText = /privacy|terms|help|learn more|sign in|log in/i;

function controlLabel(element: Element): string {
  return `${element.getAttribute("aria-label") ?? ""} ${element.textContent ?? ""}`
    .replace(/\s+/g, " ")
    .trim();
}

function orderControlScore(label: string): number {
  if (!label || /order history|your orders|reorder|pre-?order|directions/i.test(label)) {
    return -1;
  }
  if (exactOrderControlText.test(label)) return 100;
  if (broadOrderControlText.test(label)) return 90;
  if (/\border(?:ing)?\b|订餐|下单/i.test(label)) return 60;
  return -1;
}

async function findOrderControl(page: Page): Promise<{
  locator?: Locator;
  label?: string;
}> {
  let best: { locator: Locator; label: string; score: number } | undefined;

  for (const frame of page.frames()) {
    const controls = frame.locator(
      'button:visible, a:visible, [role="button"]:visible, [role="link"]:visible',
    );
    const count = Math.min(await controls.count().catch(() => 0), 300);
    for (let index = 0; index < count; index += 1) {
      const locator = controls.nth(index);
      const label = await locator.evaluate(controlLabel).catch(() => "");
      const score = orderControlScore(label);
      if (score > (best?.score ?? -1)) best = { locator, label, score };
    }
  }

  return best ? { locator: best.locator, label: best.label } : {};
}

async function collectVisibleControlLabels(page: Page): Promise<string[]> {
  const labels: string[] = [];
  for (const frame of page.frames()) {
    const frameLabels = await frame
      .locator('button:visible, a:visible, [role="button"]:visible, [role="link"]:visible')
      .evaluateAll((controls) =>
        controls
          .map((control) =>
            `${control.getAttribute("aria-label") ?? ""} ${control.textContent ?? ""}`
              .replace(/\s+/g, " ")
              .trim(),
          )
          .filter((label) => label.length >= 2 && label.length <= 120),
      )
      .catch(() => [] as string[]);
    labels.push(...frameLabels);
  }
  return [...new Set(labels)].slice(0, 40);
}

async function dismissGoogleConsent(page: Page): Promise<boolean> {
  const pageText = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
  const isConsentPage =
    /consent\.google\./i.test(page.url()) ||
    /before you continue to google|在继续使用 google|同意 google/i.test(pageText);
  if (!isConsentPage) return false;

  const consentText = /accept all|i agree|agree|accept|接受全部|同意/i;
  for (const frame of page.frames()) {
    const control = frame
      .getByRole("button", { name: consentText })
      .or(frame.getByRole("link", { name: consentText }))
      .first();
    if (!(await control.isVisible().catch(() => false))) continue;
    await control.click({ timeout: 5_000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => undefined);
    return true;
  }
  return false;
}

async function collectLinks(locator: Locator): Promise<LinkCandidate[]> {
  return locator.locator("a[href]:visible").evaluateAll((anchors) =>
    anchors.map((anchor) => ({
      href: (anchor as HTMLAnchorElement).href,
      text: `${anchor.textContent ?? ""} ${anchor.getAttribute("aria-label") ?? ""}`
        .replace(/\s+/g, " ")
        .trim(),
    })),
  );
}

async function collectPageLinks(page: Page): Promise<LinkCandidate[]> {
  const links: LinkCandidate[] = [];
  for (const frame of page.frames()) {
    links.push(
      ...(await frame
        .locator("a[href]:visible")
        .evaluateAll((anchors) =>
          anchors.map((anchor) => ({
            href: (anchor as HTMLAnchorElement).href,
            text: `${anchor.textContent ?? ""} ${anchor.getAttribute("aria-label") ?? ""}`
              .replace(/\s+/g, " ")
              .trim(),
          })),
        )
        .catch(() => [] as LinkCandidate[])),
    );
  }
  return links;
}

function normalizedHref(rawUrl: string): string | null {
  try {
    return unwrapGoogleRedirect(rawUrl);
  } catch {
    return null;
  }
}

export function selectGoogleOrderingLinkCandidates(
  links: LinkCandidate[],
  options: {
    baselineHrefs?: Set<string>;
    withinDialog: boolean;
  },
): LinkCandidate[] {
  const seen = new Set<string>();

  return links.flatMap((link) => {
    const href = normalizedHref(link.href);
    if (!href || seen.has(href)) return [];

    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return [];
    }

    if (url.protocol !== "https:") return [];
    const provider = inferProvider(href);
    const isGoogleOrdering = provider.provider === "google_ordering";
    const isExternal = !isGoogleMapsHost(url.hostname);
    if (!isExternal && !isGoogleOrdering) return [];
    if (nonProviderText.test(link.text)) return [];

    if (!options.withinDialog) {
      if (options.baselineHrefs?.has(href)) return [];
      const knownProvider = provider.provider !== "restaurant_website";
      if (!knownProvider && !orderingEvidenceText.test(link.text)) return [];
    }

    seen.add(href);
    return [{ href, text: link.text }];
  });
}

function sourceFromCandidate(
  candidate: LinkCandidate,
  discoveryMethod: NonNullable<OrderingSource["discoveryMethod"]>,
): OrderingSource {
  return makeOrderingSource({
    url: candidate.href,
    text: candidate.text,
    evidenceText: candidate.text || undefined,
    discoveredFrom: "google_maps",
    discoveryMethod,
  });
}

export async function discoverGoogleOrderingLinks(
  googleMapsUrl: string,
): Promise<GoogleOrderingDiscoveryResult> {
  const safeUrl = await assertPublicHttpsUrl(googleMapsUrl);

  return withPage(async (page, context) => {
    const sources: OrderingSource[] = [];
    const warnings: string[] = [];
    const navigationCandidates: LinkCandidate[] = [];
    const pages = new Set<Page>();

    const recordNavigation = (candidatePage: Page) => {
      if (pages.has(candidatePage)) return;
      pages.add(candidatePage);
      candidatePage.on("framenavigated", (frame) => {
        if (frame !== candidatePage.mainFrame()) return;
        try {
          const url = new URL(frame.url());
          if (url.protocol !== "https:") return;
          const provider = inferProvider(url.toString());
          if (!isGoogleMapsHost(url.hostname) || provider.provider === "google_ordering") {
            navigationCandidates.push({
              href: url.toString(),
              text: "Opened from the Google Maps ordering control",
            });
          }
        } catch {
          // The page may briefly navigate through non-URL states.
        }
      });
    };

    context.on("page", recordNavigation);
    recordNavigation(page);

    await page.goto(safeUrl.toString(), { waitUntil: "domcontentloaded", timeout: 25_000 });
    await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => undefined);
    const consentHandled = await dismissGoogleConsent(page);
    if (consentHandled) {
      await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => undefined);
    }
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
    await page.waitForTimeout(1_000);

    const finalGoogleMapsUrl = page.url();
    const pageTitle = await page.title().catch(() => "");
    const visibleControlLabels = await collectVisibleControlLabels(page);
    const baselineLinks = await collectPageLinks(page);
    const baselineHrefs = new Set(
      baselineLinks
        .map((link) => normalizedHref(link.href))
        .filter((href): href is string => Boolean(href)),
    );

    const orderControlMatch = await findOrderControl(page);
    const orderControl = orderControlMatch.locator;
    const orderControlLabel = orderControlMatch.label;
    const orderControlFound = Boolean(orderControl);

    if (!orderControlFound || !orderControl) {
      warnings.push("Google Maps did not expose a visible Online ordering control for this place.");
      return {
        sources: [],
        warnings,
        diagnostics: {
          browserConfigured: true,
          orderControlFound: false,
          finalGoogleMapsUrl,
          ...(pageTitle ? { pageTitle } : {}),
          consentHandled,
          resultScope: "none",
          inspectedLinkCount: 0,
          visibleControlLabels,
          unresolvedControlLabels: [],
        },
      };
    }

    const visibleDialog = page.locator('[role="dialog"]:visible, [aria-modal="true"]:visible').last();
    const dialogPromise = visibleDialog.waitFor({ state: "visible", timeout: 6_000 });
    await orderControl.click({ timeout: 8_000 });
    await Promise.race([
      dialogPromise.catch(() => undefined),
      page.waitForTimeout(2_500),
    ]);

    const dialogVisible = await visibleDialog.isVisible().catch(() => false);
    const inspectedLinks = dialogVisible
      ? await collectLinks(visibleDialog).catch(() => [] as LinkCandidate[])
      : await collectPageLinks(page);
    const selectedLinks = selectGoogleOrderingLinkCandidates(inspectedLinks, {
      baselineHrefs,
      withinDialog: dialogVisible,
    });

    for (const candidate of selectedLinks) {
      sources.push(
        sourceFromCandidate(
          candidate,
          dialogVisible ? "google_maps_dialog" : "google_maps_new_link",
        ),
      );
    }

    for (const candidate of navigationCandidates) {
      sources.push(sourceFromCandidate(candidate, "google_maps_navigation"));
    }

    const unresolvedControlLabels = dialogVisible
      ? await visibleDialog
          .locator('button, [role="button"]')
          .evaluateAll((controls) =>
            controls
              .map((control) =>
                `${control.getAttribute("aria-label") ?? ""} ${control.textContent ?? ""}`
                  .replace(/\s+/g, " ")
                  .trim(),
              )
              .filter(
                (label, index, labels) =>
                  label.length >= 2 &&
                  label.length <= 100 &&
                  !/close|back|cancel|关闭|返回|取消/i.test(label) &&
                  labels.indexOf(label) === index,
              ),
          )
          .catch(() => [] as string[])
      : [];

    const dedupedSources = dedupeSources(sources);
    if (dedupedSources.length === 0) {
      warnings.push(
        dialogVisible
          ? "The Online ordering panel opened, but it did not expose a resolvable HTTPS provider link."
          : "The Online ordering control was clicked, but no new ordering-provider link appeared.",
      );
    }

    const resultScope: OrderingDiscoveryDiagnostics["resultScope"] =
      selectedLinks.length > 0
        ? dialogVisible
          ? "dialog"
          : "new_links"
        : navigationCandidates.length > 0
          ? "navigation"
          : "none";

    return {
      sources: dedupedSources,
      warnings,
      diagnostics: {
        browserConfigured: true,
        orderControlFound: true,
        ...(orderControlLabel ? { orderControlLabel } : {}),
        finalGoogleMapsUrl,
        ...(pageTitle ? { pageTitle } : {}),
        consentHandled,
        resultScope,
        inspectedLinkCount: inspectedLinks.length,
        visibleControlLabels,
        unresolvedControlLabels,
      },
    };
  });
}
