import type { Db } from "../db/client";
import { getWordImage, saveWordImage, type WordImageValues } from "../db/repositories/images";
import type { WordImageRow } from "../db/schema";
import type { Logger } from "../log";
import {
  type Fetch,
  type FoundPhoto,
  ImageSourceError,
  PexelsSource,
  type PhotoSource,
  UnsplashSource,
} from "./sources";

/** A word's picture that can be shown: a stored row with a photo. */
export type WordImage = WordImageRow & { url: string; source: NonNullable<WordImageRow["source"]> };

const hasPhoto = (row: WordImageRow | undefined): row is WordImage =>
  Boolean(row?.url && row.source);

export interface WordImagesDeps {
  db: Db;
  log: Logger;
  /** In order of preference: Pexels, then Unsplash. */
  sources: PhotoSource[];
  now?: () => Date;
}

/** `PEXELS_API_KEY` and `UNSPLASH_ACCESS_KEY`; both optional. */
export interface ImageKeys {
  PEXELS_API_KEY?: string;
  UNSPLASH_ACCESS_KEY?: string;
}

/** The sources whose keys are set; with neither, there are no pictures and this is undefined. */
export function createWordImages(
  keys: ImageKeys,
  deps: Omit<WordImagesDeps, "sources">,
  fetchFn?: Fetch,
): WordImages | undefined {
  const sources: PhotoSource[] = [];
  if (keys.PEXELS_API_KEY) sources.push(new PexelsSource(keys.PEXELS_API_KEY, fetchFn));
  if (keys.UNSPLASH_ACCESS_KEY) sources.push(new UnsplashSource(keys.UNSPLASH_ACCESS_KEY, fetchFn));
  return sources.length ? new WordImages({ ...deps, sources }) : undefined;
}

/** Every source failed: nothing is known about the query, so nothing is stored. */
class SearchFailed extends Error {}

/**
 * Pictures of dictionary words from the stock APIs: fetched once per word and shared by every
 * learner. Failures are logged (source and status only) and leave the card without a picture.
 */
export class WordImages {
  constructor(private readonly deps: WordImagesDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /**
   * The word's picture: stored, or searched for `query` once and stored — a search that finds
   * nothing is stored too. Undefined when there is none or the sources failed.
   */
  async forWord(wordId: number, query: string): Promise<WordImage | undefined> {
    const stored = await getWordImage(this.deps.db, wordId);
    if (stored) return hasPhoto(stored) ? stored : undefined;
    return this.select(wordId, query, 0);
  }

  /**
   * "Another picture": the next result for the word's query, saved for the word. Undefined when
   * the results ran out or the sources failed; the stored picture then stays.
   */
  async next(wordId: number, query: string): Promise<WordImage | undefined> {
    const stored = await getWordImage(this.deps.db, wordId);
    if (stored && !hasPhoto(stored)) return undefined;
    return this.select(wordId, stored?.query ?? query, stored ? stored.resultIndex + 1 : 0, {
      keepEmpty: Boolean(stored),
    });
  }

  private async select(
    wordId: number,
    query: string,
    index: number,
    { keepEmpty = false } = {},
  ): Promise<WordImage | undefined> {
    let photo: FoundPhoto | undefined;
    try {
      photo = await this.search(query, index);
    } catch (error) {
      if (!(error instanceof SearchFailed)) throw error;
      return undefined;
    }
    if (!photo) {
      // A word with a picture keeps it when the results run out.
      if (!keepEmpty) await saveWordImage(this.deps.db, emptyRow(wordId, query), this.now());
      return undefined;
    }
    const saved = await saveWordImage(
      this.deps.db,
      photoRow(wordId, query, index, photo),
      this.now(),
    );
    await this.markUsed(photo);
    return hasPhoto(saved) ? saved : undefined;
  }

  /** The first source with a photo at `index`; throws `SearchFailed` when none of them answered. */
  private async search(query: string, index: number): Promise<FoundPhoto | undefined> {
    let answered = false;
    for (const source of this.deps.sources) {
      try {
        const photo = await source.find(query, index);
        answered = true;
        if (photo) return photo;
      } catch (error) {
        this.logFailure("image search failed", error);
      }
    }
    if (!answered) throw new SearchFailed();
    return undefined;
  }

  private async markUsed(photo: FoundPhoto): Promise<void> {
    const source = this.deps.sources.find((candidate) => candidate.name === photo.source);
    await source
      ?.used(photo)
      .catch((error: unknown) => this.logFailure("image use ping failed", error));
  }

  private logFailure(message: string, error: unknown) {
    // The error never carries a key; log only what it says about the source.
    if (error instanceof ImageSourceError) {
      this.deps.log.warn(message, {
        source: error.source,
        status: error.status,
        reason: error.message,
      });
    } else {
      this.deps.log.warn(message, { reason: error instanceof Error ? error.name : "unknown" });
    }
  }
}

function emptyRow(wordId: number, query: string): WordImageValues {
  return {
    wordId,
    query,
    resultIndex: 0,
    source: null,
    photoId: null,
    url: null,
    width: null,
    height: null,
    authorName: null,
    authorUrl: null,
    pageUrl: null,
  };
}

function photoRow(
  wordId: number,
  query: string,
  index: number,
  photo: FoundPhoto,
): WordImageValues {
  return {
    wordId,
    query,
    resultIndex: index,
    source: photo.source,
    photoId: photo.photoId,
    url: photo.url,
    width: photo.width,
    height: photo.height,
    authorName: photo.authorName,
    authorUrl: photo.authorUrl,
    pageUrl: photo.pageUrl,
  };
}
