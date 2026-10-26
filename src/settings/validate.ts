import { isIP } from "node:net";
import tzLookup from "@photostructure/tz-lookup";

/** Checks of free text the user types into settings. Each returns undefined for unusable input. */

function isBlockedIpv4(address: string): boolean {
  const [a = 0, b = 0] = address.split(".").map(Number);
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast and reserved
  );
}

function isBlockedIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  // IPv4-mapped (::ffff:a.b.c.d); the URL parser writes the tail as hex groups.
  const mapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapped) {
    const high = Number.parseInt(mapped[1] ?? "0", 16);
    const low = Number.parseInt(mapped[2] ?? "0", 16);
    return isBlockedIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  if (lower.startsWith("::ffff:")) return true;
  const first = Number.parseInt(lower.split(":")[0] || "0", 16);
  return (
    (first & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (first & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (first & 0xff00) === 0xff00 // multicast
  );
}

/**
 * A base URL for an OpenAI-compatible router. The server calls it with the user's key, so it must
 * be `https://`, carry no credentials, and not point at this host or a private network by IP
 * literal. Host names are not resolved here: DNS that points a public name at a private address is
 * out of scope for v1.
 */
export function parseBaseUrl(input: string): string | undefined {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.username || url.password) return undefined;

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return undefined;
  const bare = host.startsWith("[") ? host.slice(1, -1) : host;
  const family = isIP(bare);
  if (family === 4 && isBlockedIpv4(bare)) return undefined;
  if (family === 6 && isBlockedIpv6(bare)) return undefined;

  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}

/**
 * An IANA time zone name, returned in its canonical spelling (`europe/kyiv` → `Europe/Kyiv`).
 * Fixed offsets (`+03:00`) are refused: they ignore daylight saving.
 */
export function parseTimezone(input: string): string | undefined {
  const name = input.trim();
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(name)) return undefined;
  if (!name.includes("/") && name.toUpperCase() !== "UTC") return undefined;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** The time zone at a shared location. */
export function timezoneAt(latitude: number, longitude: number): string | undefined {
  try {
    return parseTimezone(tzLookup(latitude, longitude));
  } catch {
    return undefined;
  }
}

/** A model ID as providers spell them: `claude-sonnet-5-5`, `openai/gpt-6:free`, `org/model@v2`. */
export function parseModelId(input: string): string | undefined {
  const id = input.trim();
  return /^[\w.:/@-]{1,200}$/.test(id) ? id : undefined;
}

/** An API key as pasted: one token, no whitespace inside. Its validity is checked with the provider. */
export function parseApiKey(input: string): string | undefined {
  const key = input.trim();
  return /^\S{8,512}$/.test(key) ? key : undefined;
}
