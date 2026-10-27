import { describe, expect, test } from "bun:test";
import { ImageSourceError, PexelsSource, UnsplashSource } from "../../src/images";
import { FakeStock, PEXELS_KEY, UNSPLASH_KEY } from "./fake-stock";

describe("stock photo sources over a mocked HTTP API", () => {
  test("Pexels: the n-th result of the query, the key only in the Authorization header", async () => {
    const stock = new FakeStock();
    const photo = await new PexelsSource(PEXELS_KEY, stock.fetch).find("red apple", 1);
    expect(photo).toEqual({
      source: "pexels",
      photoId: "2",
      url: "https://images.pexels.com/red-apple-2.jpg",
      width: 1200,
      height: 800,
      authorName: "Pexels Author 2",
      authorUrl: "https://www.pexels.com/@author2",
      pageUrl: "https://www.pexels.com/photo/red-apple-2/",
    });
    const [call] = stock.calls;
    expect(call?.url).toContain("per_page=1");
    expect(call?.url).toContain("page=2");
    expect(call?.url).not.toContain(PEXELS_KEY);
    expect(call?.headers.Authorization).toBe(PEXELS_KEY);
  });

  test("past the last result there is no photo", async () => {
    const stock = new FakeStock(1);
    expect(await new PexelsSource(PEXELS_KEY, stock.fetch).find("apple", 1)).toBeUndefined();
  });

  test("Unsplash: links carry the referral, `used` calls the download endpoint", async () => {
    const stock = new FakeStock();
    const source = new UnsplashSource(UNSPLASH_KEY, stock.fetch);
    const photo = await source.find("apple", 0);
    expect(photo?.authorUrl).toBe(
      "https://unsplash.com/@u?utm_source=english_coach&utm_medium=referral",
    );
    expect(photo?.pageUrl).toContain("utm_medium=referral");
    if (!photo) throw new Error("no photo");
    await source.used(photo);
    expect(stock.count("api.unsplash.com", "/download")).toBe(1);
    expect(stock.calls.every((call) => !call.url.includes(UNSPLASH_KEY))).toBe(true);
    expect(stock.calls.at(-1)?.headers.Authorization).toBe(`Client-ID ${UNSPLASH_KEY}`);
  });

  test("errors name the source and status, never the key", async () => {
    const stock = new FakeStock();
    stock.pexels = "error";
    const error = await new PexelsSource(PEXELS_KEY, stock.fetch).find("apple", 0).catch((e) => e);
    expect(error).toBeInstanceOf(ImageSourceError);
    expect(error).toMatchObject({ source: "pexels", status: 500 });
    expect(String(error.message)).not.toContain(PEXELS_KEY);

    stock.unsplash = "down";
    const down = await new UnsplashSource(UNSPLASH_KEY, stock.fetch).find("a", 0).catch((e) => e);
    expect(down).toMatchObject({ source: "unsplash", status: null });
  });

  test("a wrong key is an error, not an empty result", async () => {
    const stock = new FakeStock();
    const error = await new PexelsSource("wrong", stock.fetch).find("apple", 0).catch((e) => e);
    expect(error).toMatchObject({ source: "pexels", status: 401 });
  });
});
