import type { Fetch } from "../../src/images";

export const PEXELS_KEY = "pexels-secret-key";
export const UNSPLASH_KEY = "unsplash-secret-key";

type Behaviour = "ok" | "empty" | "error" | "down";

export interface StockCall {
  host: string;
  url: string;
  headers: Record<string, string>;
}

/**
 * The Pexels and Unsplash HTTP APIs in memory: each query has `perQuery` results, page N is the
 * N-th. Records every call, so tests can assert where keys went and that nothing was refetched.
 */
export class FakeStock {
  readonly calls: StockCall[] = [];
  pexels: Behaviour = "ok";
  unsplash: Behaviour = "ok";

  constructor(readonly perQuery = 3) {}

  count(host: "api.pexels.com" | "api.unsplash.com", path = "") {
    return this.calls.filter((call) => call.host === host && call.url.includes(path)).length;
  }

  readonly fetch: Fetch = async (input, init) => {
    const url = new URL(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    this.calls.push({ host: url.host, url: input, headers });
    const query = url.searchParams.get("query") ?? "";
    const page = Number(url.searchParams.get("page") ?? "1");
    const behaviour = url.host === "api.pexels.com" ? this.pexels : this.unsplash;
    if (behaviour === "down") throw new TypeError("fetch failed");
    if (behaviour === "error") return Response.json({ error: "nope" }, { status: 500 });
    const has = behaviour === "ok" && page <= this.perQuery;
    const slug = `${query.replaceAll(" ", "-")}-${page}`;

    if (url.host === "api.pexels.com") {
      if (headers.Authorization !== PEXELS_KEY) return Response.json({}, { status: 401 });
      return Response.json({
        photos: has
          ? [
              {
                id: page,
                width: 1200,
                height: 800,
                url: `https://www.pexels.com/photo/${slug}/`,
                photographer: `Pexels Author ${page}`,
                photographer_url: `https://www.pexels.com/@author${page}`,
                src: { large: `https://images.pexels.com/${slug}.jpg` },
              },
            ]
          : [],
      });
    }
    if (headers.Authorization !== `Client-ID ${UNSPLASH_KEY}`) {
      return Response.json({}, { status: 401 });
    }
    if (url.pathname.endsWith("/download")) return Response.json({ url: "https://dl" });
    return Response.json({
      results: has
        ? [
            {
              id: `u-${slug}`,
              width: 1000,
              height: 700,
              urls: { regular: `https://images.unsplash.com/${slug}.jpg` },
              links: {
                html: `https://unsplash.com/photos/${slug}`,
                download_location: `https://api.unsplash.com/photos/u-${slug}/download?ixid=x`,
              },
              user: { name: `Unsplash Author ${page}`, links: { html: "https://unsplash.com/@u" } },
            },
          ]
        : [],
    });
  };
}
