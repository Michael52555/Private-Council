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

function isOrderingInfrastructureHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return (
    isGoogleMapsHost(host) ||
    host === "goo.gl" ||
    host === "goo.gle" ||
    host.endsWith(".goo.gl") ||
    host.endsWith(".goo.gle") ||
    host === "googleapis.com" ||
    host.endsWith(".googleapis.com") ||
    host === "googleadservices.com" ||
    host.endsWith(".googleadservices.com") ||
    host === "googlesyndication.com" ||
    host.endsWith(".googlesyndication.com") ||
    host === "doubleclick.net" ||
    host.endsWith(".doubleclick.net") ||
    host === "recaptcha.net" ||
    host.endsWith(".recaptcha.net") ||
    host === "captcha-delivery.com" ||
    host.endsWith(".captcha-delivery.com") ||
    host === "liadm.com" ||
    host.endsWith(".liadm.com")
  );
}

type LinkCandidate = {
  href: string;
  text: string;
};

type ClickableCandidate = {
  locator: Locator;
  label: string;
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

export function scoreGoogleOrderControlLabel(label: string): number {
  if (
    !label ||
    /order history|your orders|reorder|pre-?order|directions|sponsored|广告|立即订餐/i.test(
      label,
    )
  ) {
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

  const consider = async (locator: Locator) => {
    if (!(await locator.isVisible().catch(() => false))) return;
    const label = await locator.evaluate(controlLabel).catch(() => "");
    const score = scoreGoogleOrderControlLabel(label);
    if (score > (best?.score ?? -1)) best = { locator, label, score };
  };

  for (const frame of page.frames()) {
    const textMatches = frame.getByText(broadOrderControlText);
    const textMatchCount = Math.min(
      await textMatches.count().catch(() => 0),
      30,
    );
    for (let index = 0; index < textMatchCount; index += 1) {
      const textMatch = textMatches.nth(index);
      const clickable = textMatch
        .locator(
          "xpath=ancestor-or-self::*[self::button or self::a or @role='button' or @role='link' or @jsaction or @tabindex][1]",
        )
        .first();
      await consider(clickable);
    }

    const controls = frame.locator(
      'button:visible, a:visible, [role="button"]:visible, [role="link"]:visible, [jsaction]:visible, [tabindex]:visible',
    );
    const labels = await controls
      .evaluateAll((elements) =>
        elements.slice(0, 800).map((element) =>
          `${element.getAttribute("aria-label") ?? ""} ${element.textContent ?? ""}`
            .replace(/\s+/g, " ")
            .trim(),
        ),
      )
      .catch(() => [] as string[]);
    for (let index = 0; index < labels.length; index += 1) {
      const label = labels[index];
      const score = scoreGoogleOrderControlLabel(label);
      if (score > (best?.score ?? -1)) {
        best = { locator: controls.nth(index), label, score };
      }
    }
  }

  return best ? { locator: best.locator, label: best.label } : {};
}

async function collectVisibleControlLabels(page: Page): Promise<string[]> {
  const labels: string[] = [];
  for (const frame of page.frames()) {
    const frameLabels = await frame
      .locator(
        'button:visible, a:visible, [role="button"]:visible, [role="link"]:visible, [jsaction]:visible, [tabindex]:visible',
      )
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

function providerControlScore(label: string): number {
  if (
    !label ||
    label.length > 240 ||
    /privacy|terms|help|sign in|log in|directions|save|share|reviews?|photos?/i.test(label)
  ) {
    return -1;
  }
  const domains = label.match(/(?:[a-z0-9-]+\.)+[a-z]{2,}/gi) ?? [];
  if (
    domains.length > 0 &&
    domains.every((domain) => isOrderingInfrastructureHost(domain))
  ) {
    return -1;
  }
  if (domains.length > 0) return 100;
  if (/door\s*dash|uber\s*eats|grubhub|toast|chownow|olo|square|clover/i.test(label)) {
    return 90;
  }
  if (/ordering platform|merchant website|order provider|订餐平台|商家网站/i.test(label)) {
    return 70;
  }
  return -1;
}

async function findProviderControls(
  page: Page,
  baselineLabels: Set<string>,
): Promise<ClickableCandidate[]> {
  const candidates: ClickableCandidate[] = [];
  for (const frame of page.frames()) {
    const controls = frame.locator(
      'a:visible, button:visible, [role="button"]:visible, [role="link"]:visible, [tabindex="0"]:visible',
    );
    const count = Math.min(await controls.count().catch(() => 0), 500);
    for (let index = 0; index < count; index += 1) {
      const locator = controls.nth(index);
      const label = await locator.evaluate(controlLabel).catch(() => "");
      if (baselineLabels.has(label)) continue;
      const score = providerControlScore(label);
      if (score >= 0) candidates.push({ locator, label });
    }
  }

  const seen = new Set<string>();
  return candidates
    .filter((candidate) => {
      const key = candidate.label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
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
    if (isOrderingInfrastructureHost(url.hostname)) return [];
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
    let orderControlActivated = false;

    const recordExternalNavigation = (rawUrl: string, text: string) => {
      if (!orderControlActivated) return;
      try {
        const url = new URL(rawUrl);
        if (url.protocol !== "https:") return;
        if (isOrderingInfrastructureHost(url.hostname)) return;
        const provider = inferProvider(url.toString());
        if (!isGoogleMapsHost(url.hostname) || provider.provider === "google_ordering") {
          navigationCandidates.push({ href: url.toString(), text });
        }
      } catch {
        // Ignore transient browser URLs.
      }
    };

    const recordNavigation = (candidatePage: Page) => {
      if (pages.has(candidatePage)) return;
      pages.add(candidatePage);
      candidatePage.on("framenavigated", (frame) => {
        if (frame !== candidatePage.mainFrame()) return;
        recordExternalNavigation(
          frame.url(),
          "Opened from the Google Maps ordering control",
        );
      });
      void candidatePage
        .waitForLoadState("domcontentloaded", { timeout: 8_000 })
        .catch(() => undefined)
        .then(() =>
          recordExternalNavigation(
            candidatePage.url(),
            "Opened in a new page from the Google Maps ordering control",
          ),
        );
    };

    context.on("page", recordNavigation);
    context.on("request", (request) => {
      if (!request.isNavigationRequest() || request.resourceType() !== "document") return;
      if (request.frame().parentFrame()) return;
      recordExternalNavigation(
        request.url(),
        "Document navigation from the Google Maps ordering control",
      );
    });
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
    let orderControlLayout: "desktop" | "mobile" = "desktop";
    let orderControlMatch = await findOrderControl(page);
    if (!orderControlMatch.locator) {
      await page.setViewportSize({ width: 640, height: 1200 });
      await page.waitForTimeout(1_500);
      orderControlLayout = "mobile";
      orderControlMatch = await findOrderControl(page);
    }

    const visibleControlLabels = await collectVisibleControlLabels(page);
    const baselineLinks = await collectPageLinks(page);
    const baselineHrefs = new Set(
      baselineLinks
        .map((link) => normalizedHref(link.href))
        .filter((href): href is string => Boolean(href)),
    );

    const orderControl = orderControlMatch.locator;
    const orderControlLabel = orderControlMatch.label;
    const orderControlFound = Boolean(orderControl);

    if (!orderControlFound || !orderControl) {
      warnings.push(
        "Google Maps did not expose a detectable Online ordering control in desktop or mobile layout for this place.",
      );
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

    const originalPageDialog = page
      .locator('[role="dialog"]:visible, [aria-modal="true"]:visible')
      .last();
    const dialogPromise = originalPageDialog.waitFor({
      state: "visible",
      timeout: 6_000,
    });
    let popupPage: Page | undefined;
    const popupPromise = context
      .waitForEvent("page", { timeout: 6_000 })
      .then((openedPage) => {
        popupPage = openedPage;
      })
      .catch(() => undefined);
    orderControlActivated = true;
    await orderControl.click({ timeout: 8_000 });
    await Promise.race([
      dialogPromise.catch(() => undefined),
      popupPromise,
      page.waitForTimeout(3_000),
    ]);
    if (
      !popupPage &&
      !(await originalPageDialog.isVisible().catch(() => false))
    ) {
      await popupPromise;
    }

    const orderingPage = popupPage ?? page;
    if (popupPage) {
      await orderingPage
        .waitForLoadState("domcontentloaded", { timeout: 10_000 })
        .catch(() => undefined);
      await dismissGoogleConsent(orderingPage).catch(() => false);
      await orderingPage.waitForTimeout(1_000);
    }

    const visibleDialog = orderingPage
      .locator('[role="dialog"]:visible, [aria-modal="true"]:visible')
      .last();
    const dialogVisible = await visibleDialog.isVisible().catch(() => false);
    const separateOrderingSurface = orderingPage !== page;
    const inspectedLinks = dialogVisible
      ? await collectLinks(visibleDialog).catch(() => [] as LinkCandidate[])
      : await collectPageLinks(orderingPage);
    const selectedLinks = selectGoogleOrderingLinkCandidates(inspectedLinks, {
      baselineHrefs,
      withinDialog: dialogVisible || separateOrderingSurface,
    });
    const primarySelectedLink = selectedLinks[0];

    if (primarySelectedLink) {
      sources.push(
        sourceFromCandidate(
          primarySelectedLink,
          dialogVisible ? "google_maps_dialog" : "google_maps_new_link",
        ),
      );
    }

    const providerControls =
      !primarySelectedLink && navigationCandidates.length === 0
        ? await findProviderControls(orderingPage, new Set(visibleControlLabels))
        : [];
    const primaryProviderControl = providerControls[0];

    if (primaryProviderControl) {
      await primaryProviderControl.locator.click({ timeout: 5_000 }).catch(() => undefined);
      await orderingPage.waitForTimeout(2_500);
    }

    const finalNavigationCandidate = navigationCandidates.at(-1);
    if (!primarySelectedLink && finalNavigationCandidate) {
      sources.push(
        sourceFromCandidate(finalNavigationCandidate, "google_maps_navigation"),
      );
    }

    const dialogControlLabels = dialogVisible
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
    const unresolvedControlLabels = [
      ...new Set([
        ...providerControls.map((candidate) => candidate.label),
        ...dialogControlLabels,
      ]),
    ].slice(0, 20);

    const dedupedSources = dedupeSources(sources).slice(0, 1);
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
        orderControlLayout,
        orderingSurface: separateOrderingSurface ? "new_page" : "same_page",
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
