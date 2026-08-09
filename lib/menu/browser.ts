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
import {
  activeProviderAdapterForControlLabel,
  activeProviderAdapterForUrl,
  type MenuAdapterId,
} from "@/lib/menu/adapters";
import { assertPublicHttpsUrl } from "@/lib/menu/security";
import type {
  CapturedJsonPayload,
  MenuBrowserDiagnostics,
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

async function openBrowser(headless = true): Promise<{ browser: Browser; remote: boolean }> {
  const wsEndpoint = process.env.PLAYWRIGHT_WS_ENDPOINT ?? process.env.BROWSER_WS_ENDPOINT;
  if (wsEndpoint) {
    return { browser: await chromium.connectOverCDP(wsEndpoint), remote: true };
  }

  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
    systemChromePath();
  if (executablePath) {
    return {
      browser: await chromium.launch({ executablePath, headless }),
      remote: false,
    };
  }

  throw new BrowserNotConfiguredError();
}

async function withPage<T>(
  task: (page: Page, context: BrowserContext) => Promise<T>,
  options: { headless?: boolean } = {},
): Promise<T> {
  const { browser } = await openBrowser(options.headless ?? true);
  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1440, height: 1200 },
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
    },
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

type RenderMenuPageOptions = {
  adapterId?: MenuAdapterId;
  restaurantAddress?: string;
  restaurantName?: string;
  headless?: boolean;
};

export function providerStartUrl(
  rawUrl: string,
  options: RenderMenuPageOptions,
): string {
  if (
    options.adapterId !== "panda_express" ||
    !options.restaurantAddress
  ) {
    return rawUrl;
  }

  const url = new URL(rawUrl);
  if (!/^\/locations?\/?$/i.test(url.pathname)) return rawUrl;
  const parts = options.restaurantAddress.split(",").map((part) => part.trim());
  const city = parts.at(-3);
  const stateMatch = parts.at(-2)?.match(/^([A-Z]{2})\b/i);
  if (!city || !stateMatch) return rawUrl;
  const citySlug = city
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!citySlug) return rawUrl;
  url.pathname = `/locations/${stateMatch[1].toLowerCase()}/${citySlug}/`;
  return url.toString();
}

async function clickFirstVisible(page: Page, names: RegExp[]): Promise<boolean> {
  for (const frame of page.frames()) {
    for (const name of names) {
      const controls = frame.getByRole("button", { name }).or(frame.getByRole("link", { name }));
      const count = Math.min(await controls.count().catch(() => 0), 8);
      for (let index = 0; index < count; index += 1) {
        const control = controls.nth(index);
        if (!(await control.isVisible().catch(() => false))) continue;
        await control.click({ timeout: 3_000 }).catch(() => undefined);
        return true;
      }
    }
  }
  return false;
}

async function dismissOrderingPageConsent(page: Page): Promise<void> {
  await clickFirstVisible(page, [
    /^accept(?: all)?$/i,
    /^agree$/i,
    /^allow all$/i,
    /^continue$/i,
    /^got it$/i,
  ]).catch(() => false);
}

async function findLocationInput(page: Page): Promise<Locator | undefined> {
  const selector = [
    'input[placeholder*="address" i]',
    'input[aria-label*="address" i]',
    'input[placeholder*="location" i]',
    'input[aria-label*="location" i]',
    'input[placeholder*="city" i]',
    'input[placeholder*="zip" i]',
  ].join(",");

  for (const frame of page.frames()) {
    const inputs = frame.locator(selector);
    const count = Math.min(await inputs.count().catch(() => 0), 12);
    for (let index = 0; index < count; index += 1) {
      const input = inputs.nth(index);
      if (await input.isVisible().catch(() => false)) return input;
    }
  }
  return undefined;
}

async function clickMatchingLocationResult(
  page: Page,
  address: string,
): Promise<boolean> {
  const addressStem = address.split(",")[0]?.trim();
  if (!addressStem || addressStem.length < 4) return false;

  for (const frame of page.frames()) {
    const matches = frame.getByText(addressStem, { exact: false });
    const count = Math.min(await matches.count().catch(() => 0), 8);
    for (let index = 0; index < count; index += 1) {
      const match = matches.nth(index);
      if (!(await match.isVisible().catch(() => false))) continue;
      const clickable = match.locator(
        "xpath=ancestor-or-self::*[self::button or self::a or @role='button' or @role='link'][1] | ancestor::*[.//a or .//button][1]//a[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'order') or contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'select')][1] | ancestor::*[.//a or .//button][1]//button[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'order') or contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'select')][1]",
      ).first();
      if (!(await clickable.isVisible().catch(() => false))) continue;
      await clickable.click({ timeout: 3_000 }).catch(() => undefined);
      return true;
    }
  }
  return false;
}

async function attemptLocationSelection(
  page: Page,
  address: string,
): Promise<{ attempted: boolean; succeeded: boolean }> {
  const initialUrl = page.url();
  let clickedResult = await clickMatchingLocationResult(page, address);

  const input = clickedResult ? undefined : await findLocationInput(page);
  if (!clickedResult && input) {
    await input.fill(address).catch(() => undefined);
    await page.waitForTimeout(1_000);
    await input.press("ArrowDown").catch(() => undefined);
    await input.press("Enter").catch(() => undefined);
    await page.waitForTimeout(1_500);
    clickedResult = await clickMatchingLocationResult(page, address);
  }

  if (!clickedResult && !input) return { attempted: false, succeeded: false };

  const clickedCta = clickedResult || await clickFirstVisible(page, [
    /select (?:this )?location/i,
    /choose (?:this )?location/i,
    /order from (?:this )?location/i,
    /start (?:an )?order/i,
    /order (?:now|pickup|here)/i,
    /view menu/i,
    /pickup/i,
  ]);
  await page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => undefined);
  await page.waitForTimeout(1_500);
  return {
    attempted: true,
    succeeded: clickedCta || page.url() !== initialUrl,
  };
}

async function triggerLazyMenuLoading(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const heights = [0.35, 0.7, 1];
    for (const ratio of heights) {
      window.scrollTo(0, document.body.scrollHeight * ratio);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    window.scrollTo(0, 0);
  }).catch(() => undefined);
}

function isNonMenuProviderEndpoint(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const target = `${url.hostname}${url.pathname}`.toLowerCase();
    return (
      /cookielaw\.org|cookiebot\.com|onetrust\.com|contentful\.com/.test(target) ||
      /\/auth\/(?:refresh|session)|\/consent\/|\/locales?\/|\/translations?\//.test(target) ||
      /\/(?:en|en-us)\.json$/.test(target) ||
      /\.(?:js|mjs|css|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot)$/.test(url.pathname.toLowerCase())
    );
  } catch {
    return false;
  }
}

export async function renderPublicPage(rawUrl: string, options: RenderMenuPageOptions = {}): Promise<{
  html: string;
  finalUrl: string;
  jsonPayloads: CapturedJsonPayload[];
  diagnostics: MenuBrowserDiagnostics;
}> {
  const url = await assertPublicHttpsUrl(providerStartUrl(rawUrl, options));
  return withPage(async (page, context) => {
    const jsonPayloads: CapturedJsonPayload[] = [];
    const pendingCaptures = new Set<Promise<void>>();
    let capturedBytes = 0;
    let blockedResponseCount = 0;
    let rateLimitedResponseCount = 0;
    const capturedJsonEndpoints = new Set<string>();
    const blockedResponseEndpoints = new Set<string>();

    const safeEndpoint = (rawResponseUrl: string) => {
      try {
        const responseUrl = new URL(rawResponseUrl);
        return `${responseUrl.hostname}${responseUrl.pathname}`.slice(0, 240);
      } catch {
        return "unknown endpoint";
      }
    };

    context.on("response", (response) => {
      const ignoredEndpoint = isNonMenuProviderEndpoint(response.url());
      if (!ignoredEndpoint && [401, 403, 429].includes(response.status())) {
        blockedResponseCount += 1;
        if (response.status() === 429) {
          rateLimitedResponseCount += 1;
        }
        if (blockedResponseEndpoints.size < 8) {
          blockedResponseEndpoints.add(safeEndpoint(response.url()));
        }
      }
      if (jsonPayloads.length >= 60 || capturedBytes >= 12_000_000) return;
      const capture = (async () => {
        if (ignoredEndpoint) return;
        const contentType = (await response.headerValue("content-type")) ?? "";
        if (!/json/i.test(contentType)) return;
        const declaredLength = Number(
          (await response.headerValue("content-length")) ?? "0",
        );
        if (Number.isFinite(declaredLength) && declaredLength > 2_500_000) return;

        const text = await response.text();
        if (!text || text.length > 2_500_000) return;
        if (!/"(?:menu|menus|item|items|product|products|categor(?:y|ies)|price|amount)"\s*:/i.test(text)) {
          return;
        }
        capturedBytes += text.length;
        if (capturedBytes > 12_000_000) return;
        try {
          jsonPayloads.push({
            url: response.url(),
            status: response.status(),
            contentType,
            data: JSON.parse(text) as unknown,
          });
          if (capturedJsonEndpoints.size < 8) {
            capturedJsonEndpoints.add(safeEndpoint(response.url()));
          }
        } catch {
          // Ignore non-JSON responses with an inaccurate content type.
        }
      })().catch(() => undefined);
      pendingCaptures.add(capture);
    });

    const navigationResponse = await page.goto(url.toString(), {
      waitUntil: "domcontentloaded",
      timeout: 25_000,
    });
    if (navigationResponse && navigationResponse.status() >= 400) {
      await Promise.allSettled([...pendingCaptures]);
      return {
        html: await page.content(),
        finalUrl: page.url(),
        jsonPayloads,
        diagnostics: {
          navigationStatus: navigationResponse.status(),
          finalUrl: page.url(),
          locationSelectionAttempted: false,
          locationSelectionSucceeded: false,
          capturedJsonResponseCount: jsonPayloads.length,
          blockedResponseCount,
          rateLimitedResponseCount,
          capturedJsonEndpoints: [...capturedJsonEndpoints],
          blockedResponseEndpoints: [...blockedResponseEndpoints],
        },
      };
    }
    await dismissOrderingPageConsent(page);
    await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => undefined);
    let locationResult = options.restaurantAddress
      ? await attemptLocationSelection(page, options.restaurantAddress)
      : { attempted: false, succeeded: false };
    await page.waitForTimeout(500);
    let activePage = context.pages().at(-1) ?? page;
    activePage.setDefaultTimeout(8_000);
    await activePage.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => undefined);
    await dismissOrderingPageConsent(activePage);
    if (activePage !== page && options.restaurantAddress) {
      const popupLocationResult = await attemptLocationSelection(
        activePage,
        options.restaurantAddress,
      );
      locationResult = {
        attempted: locationResult.attempted || popupLocationResult.attempted,
        succeeded: locationResult.succeeded || popupLocationResult.succeeded,
      };
      await activePage.waitForTimeout(500);
      activePage = context.pages().at(-1) ?? activePage;
      activePage.setDefaultTimeout(8_000);
    }
    await triggerLazyMenuLoading(activePage);
    await activePage.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => undefined);
    await Promise.allSettled([...pendingCaptures]);
    return {
      html: await activePage.content(),
      finalUrl: activePage.url(),
      jsonPayloads,
      diagnostics: {
        navigationStatus: navigationResponse?.status(),
        finalUrl: activePage.url(),
        locationSelectionAttempted: locationResult.attempted,
        locationSelectionSucceeded: locationResult.succeeded,
        capturedJsonResponseCount: jsonPayloads.length,
        blockedResponseCount,
        rateLimitedResponseCount,
        capturedJsonEndpoints: [...capturedJsonEndpoints],
        blockedResponseEndpoints: [...blockedResponseEndpoints],
      },
    };
  }, { headless: options.headless });
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
const nonProviderText =
  /privacy|terms|help|learn more|sign in|log in|sponsored|广告主|claim \$/i;

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

const deliveryOrderingModeText = /^(?:delivery|外送|外卖|送餐)$/i;

export function isDeliveryOrderingModeLabel(label: string): boolean {
  return deliveryOrderingModeText.test(
    label.replace(/[×✕]/g, "").replace(/\s+/g, " ").trim(),
  );
}

async function activateDeliveryOrderingMode(
  page: Page,
  surface: Locator,
): Promise<boolean> {
  const roleCandidates = surface
    .getByRole("button", { name: deliveryOrderingModeText })
    .or(surface.getByRole("tab", { name: deliveryOrderingModeText }))
    .or(surface.getByRole("radio", { name: deliveryOrderingModeText }));
  const roleCount = Math.min(await roleCandidates.count().catch(() => 0), 8);
  for (let index = 0; index < roleCount; index += 1) {
    const candidate = roleCandidates.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) continue;
    await candidate.click({ timeout: 3_000 });
    await page.waitForTimeout(1_000);
    return true;
  }

  const textMatches = surface.getByText(deliveryOrderingModeText, {
    exact: true,
  });
  const textCount = Math.min(await textMatches.count().catch(() => 0), 12);
  for (let index = 0; index < textCount; index += 1) {
    const textMatch = textMatches.nth(index);
    if (!(await textMatch.isVisible().catch(() => false))) continue;
    const clickable = textMatch
      .locator(
        "xpath=ancestor-or-self::*[self::button or self::a or @role='button' or @role='tab' or @role='radio' or @jsaction or @tabindex][1]",
      )
      .first();
    if (!(await clickable.isVisible().catch(() => false))) continue;
    await clickable.click({ timeout: 3_000 });
    await page.waitForTimeout(1_000);
    return true;
  }
  return false;
}

async function collectOrderingModeLinks(
  page: Page,
  dialogVisible: boolean,
): Promise<{
  links: LinkCandidate[];
  deliveryModeActivated: boolean;
}> {
  const surface = dialogVisible
    ? page.locator('[role="dialog"]:visible, [aria-modal="true"]:visible').last()
    : page.locator("body");
  const collected = await (dialogVisible
    ? collectLinks(surface).catch(() => [] as LinkCandidate[])
    : collectPageLinks(page));

  const deliveryModeActivated = await activateDeliveryOrderingMode(
    page,
    surface,
  ).catch(() => false);
  if (deliveryModeActivated) {
    const deliveryLinks = dialogVisible
      ? await collectLinks(surface).catch(() => [] as LinkCandidate[])
      : await collectPageLinks(page);
    collected.push(
      ...deliveryLinks.map((link) => ({
        ...link,
        text: `${link.text} Delivery`.trim(),
      })),
    );
  }
  return { links: collected, deliveryModeActivated };
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

export function selectFirstSupportedOrderingLink(
  links: LinkCandidate[],
): LinkCandidate | undefined {
  return links.find((candidate) =>
    Boolean(activeProviderAdapterForUrl(candidate.href)),
  );
}

export function selectSupportedOrderingLinks(
  links: LinkCandidate[],
): LinkCandidate[] {
  return links.filter((candidate) =>
    Boolean(activeProviderAdapterForUrl(candidate.href)),
  );
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
    const orderingModeResult = await collectOrderingModeLinks(
      orderingPage,
      dialogVisible,
    );
    const inspectedLinks = orderingModeResult.links;
    const selectedLinks = selectGoogleOrderingLinkCandidates(inspectedLinks, {
      baselineHrefs,
      withinDialog: dialogVisible || separateOrderingSurface,
    });
    const supportedSelectedLinks = selectSupportedOrderingLinks(selectedLinks);
    const primarySelectedLink = supportedSelectedLinks[0];
    const skippedUnsupportedProviders = selectedLinks
      .slice(
        0,
        primarySelectedLink
          ? selectedLinks.indexOf(primarySelectedLink)
          : selectedLinks.length,
      )
      .filter((candidate) => !activeProviderAdapterForUrl(candidate.href))
      .map((candidate) => candidate.text || new URL(candidate.href).hostname);

    if (primarySelectedLink) {
      sources.push(
        sourceFromCandidate(
          primarySelectedLink,
          dialogVisible ? "google_maps_dialog" : "google_maps_new_link",
        ),
      );
    }

    const providerControls = !primarySelectedLink
      ? await findProviderControls(orderingPage, new Set(visibleControlLabels))
      : [];
    const primaryProviderControl = providerControls.find((candidate) =>
      Boolean(activeProviderAdapterForControlLabel(candidate.label)),
    );
    const skippedUnsupportedControls = providerControls
      .slice(
        0,
        primaryProviderControl
          ? providerControls.indexOf(primaryProviderControl)
          : providerControls.length,
      )
      .filter((candidate) => !activeProviderAdapterForControlLabel(candidate.label))
      .map((candidate) => candidate.label);

    if (primaryProviderControl) {
      await primaryProviderControl.locator.click({ timeout: 5_000 }).catch(() => undefined);
      await orderingPage.waitForTimeout(2_500);
    }

    const supportedNavigationCandidates = selectSupportedOrderingLinks(
      navigationCandidates,
    );
    if (!primarySelectedLink && supportedNavigationCandidates.length > 0) {
      sources.push(
        sourceFromCandidate(
          supportedNavigationCandidates[0],
          "google_maps_navigation",
        ),
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

    // Use the first supported result in Google Maps' delivery ordering list.
    // The supported set is intentionally small (Grubhub and DoorDash), and
    // duplicate pickup/tracking variants do not improve a restaurant estimate.
    const dedupedSources = dedupeSources(sources).slice(0, 1);
    if (dedupedSources.length === 0) {
      if (!orderingModeResult.deliveryModeActivated) {
        warnings.push(
          "The Delivery/外送 ordering mode could not be activated.",
        );
      }
      if (
        skippedUnsupportedProviders.length > 0 ||
        skippedUnsupportedControls.length > 0
      ) {
        warnings.push(
          "Google Maps exposed ordering providers, but no supported Grubhub or DoorDash delivery source was found.",
        );
      }
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
        deliveryModeActivated: orderingModeResult.deliveryModeActivated,
        finalGoogleMapsUrl,
        ...(pageTitle ? { pageTitle } : {}),
        consentHandled,
        resultScope,
        inspectedLinkCount: inspectedLinks.length,
        visibleControlLabels,
        unresolvedControlLabels,
        skippedUnsupportedProviders: [
          ...new Set([
            ...skippedUnsupportedProviders,
            ...skippedUnsupportedControls,
          ]),
        ].slice(0, 20),
      },
    };
  });
}
