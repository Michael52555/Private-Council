import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_HTML_BYTES = 5_000_000;
const MAX_REDIRECTS = 5;

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return true;
}

export async function assertPublicHttpsUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("The menu source URL is invalid.");
  }

  if (url.protocol !== "https:") {
    throw new Error("Menu sources must use HTTPS.");
  }

  if (url.username || url.password || url.port) {
    throw new Error("Menu source URLs cannot contain credentials or custom ports.");
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("The menu source does not resolve to a public address.");
  }

  return url;
}

export async function fetchPublicHtml(rawUrl: string): Promise<{
  html: string;
  finalUrl: string;
}> {
  let currentUrl = await assertPublicHttpsUrl(rawUrl);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (compatible; PrivateCouncilMenuBot/0.1; +https://github.com/Michael52555/Private-Council)",
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("The menu source returned an invalid redirect.");
      currentUrl = await assertPublicHttpsUrl(new URL(location, currentUrl).toString());
      continue;
    }

    if (!response.ok) {
      throw new Error(`The menu source returned HTTP ${response.status}.`);
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_HTML_BYTES) throw new Error("The menu page is too large to process.");

    const html = await response.text();
    if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
      throw new Error("The menu page is too large to process.");
    }

    return { html, finalUrl: currentUrl.toString() };
  }

  throw new Error("The menu source redirected too many times.");
}
