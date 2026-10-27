import { z } from "zod";
import type { ImageSource } from "../db/schema";

/** `fetch`, injectable: tests answer with canned responses and never reach the stock APIs. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** One stock photo, with what its source's terms require for the caption. */
export interface FoundPhoto {
  source: ImageSource;
  photoId: string;
  url: string;
  width: number;
  height: number;
  authorName: string;
  authorUrl: string;
  pageUrl: string;
  /** Unsplash: the endpoint to call when the photo is used. */
  downloadLocation?: string;
}

/** A stock API that did not answer usefully. Carries the source and status, never the key. */
export class ImageSourceError extends Error {
  override name = "ImageSourceError";
  constructor(
    readonly source: ImageSource,
    readonly status: number | null,
    reason: string,
  ) {
    super(`${source} ${reason}`);
  }
}

export interface PhotoSource {
  readonly name: ImageSource;
  /** The `index`-th photo (from 0) for `query`; undefined when there are not that many. */
  find(query: string, index: number): Promise<FoundPhoto | undefined>;
  /** Tells the source its photo is shown, where its terms ask for it. */
  used(photo: FoundPhoto): Promise<void>;
}

const TIMEOUT_MS = 8_000;

async function getJson<T>(
  source: ImageSource,
  fetchFn: Fetch,
  url: string,
  headers: Record<string, string>,
  schema: z.ZodType<T>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchFn(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new ImageSourceError(source, null, "request failed");
  }
  if (!response.ok) throw new ImageSourceError(source, response.status, "answered an error");
  const parsed = schema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) throw new ImageSourceError(source, response.status, "answered bad JSON");
  return parsed.data;
}

const searchUrl = (base: string, query: string, index: number) => {
  const url = new URL(base);
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", "1");
  url.searchParams.set("page", String(index + 1));
  return url.toString();
};

const PexelsSearch = z.object({
  photos: z.array(
    z.object({
      id: z.number(),
      width: z.number(),
      height: z.number(),
      url: z.string(),
      photographer: z.string(),
      photographer_url: z.string(),
      src: z.object({ large: z.string() }),
    }),
  ),
});

/** Pexels (https://www.pexels.com/api/): the primary source. */
export class PexelsSource implements PhotoSource {
  readonly name = "pexels" as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  async find(query: string, index: number): Promise<FoundPhoto | undefined> {
    const data = await getJson(
      this.name,
      this.fetchFn,
      searchUrl("https://api.pexels.com/v1/search", query, index),
      { Authorization: this.apiKey },
      PexelsSearch,
    );
    const photo = data.photos[0];
    if (!photo) return undefined;
    return {
      source: this.name,
      photoId: String(photo.id),
      url: photo.src.large,
      width: photo.width,
      height: photo.height,
      authorName: photo.photographer,
      authorUrl: photo.photographer_url,
      pageUrl: photo.url,
    };
  }

  async used(): Promise<void> {}
}

const UnsplashSearch = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      width: z.number(),
      height: z.number(),
      urls: z.object({ regular: z.string() }),
      links: z.object({ html: z.string(), download_location: z.string() }),
      user: z.object({ name: z.string(), links: z.object({ html: z.string() }) }),
    }),
  ),
});

/** Unsplash asks every link back to it to carry the app's name. */
export const UNSPLASH_APP_NAME = "english_coach";

export function withUnsplashReferral(link: string): string {
  const url = new URL(link);
  url.searchParams.set("utm_source", UNSPLASH_APP_NAME);
  url.searchParams.set("utm_medium", "referral");
  return url.toString();
}

/** Unsplash (https://unsplash.com/developers): the fallback. */
export class UnsplashSource implements PhotoSource {
  readonly name = "unsplash" as const;

  constructor(
    private readonly accessKey: string,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  private get headers() {
    return { Authorization: `Client-ID ${this.accessKey}`, "Accept-Version": "v1" };
  }

  async find(query: string, index: number): Promise<FoundPhoto | undefined> {
    const data = await getJson(
      this.name,
      this.fetchFn,
      searchUrl("https://api.unsplash.com/search/photos", query, index),
      this.headers,
      UnsplashSearch,
    );
    const photo = data.results[0];
    if (!photo) return undefined;
    return {
      source: this.name,
      photoId: photo.id,
      url: photo.urls.regular,
      width: photo.width,
      height: photo.height,
      authorName: photo.user.name,
      authorUrl: withUnsplashReferral(photo.user.links.html),
      pageUrl: withUnsplashReferral(photo.links.html),
      downloadLocation: photo.links.download_location,
    };
  }

  /** The download endpoint: Unsplash's terms ask for a call each time a photo is put to use. */
  async used(photo: FoundPhoto): Promise<void> {
    if (!photo.downloadLocation) return;
    await getJson(this.name, this.fetchFn, photo.downloadLocation, this.headers, z.unknown());
  }
}
