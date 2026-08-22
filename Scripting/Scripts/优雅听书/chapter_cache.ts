import { Audiobook, Chapter } from "./models"
import { lrtsAPI, ximalayaAPI, novelfmAPI } from "./api"

const CHAPTER_CACHE_PREFIX = "yating_chapters_"
const CHAPTER_CACHE_INDEX_KEY = "yating_chapter_cache_index"
const CHAPTER_CACHE_TTL = 7 * 24 * 60 * 60 * 1000

export type ChapterCacheEntry = {
  chapters: Chapter[]
  updatedAt: number
}

export type ChapterLoadResult = {
  chapters: Chapter[]
  fromCache: boolean
  updatedAt?: number
}

function cacheKey(book: Audiobook): string {
  return `${CHAPTER_CACHE_PREFIX}${book.id}`
}

function loadCacheIndex(): string[] {
  try {
    const raw = Storage.get<string>(CHAPTER_CACHE_INDEX_KEY)
    const ids = raw ? JSON.parse(raw) : []
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : []
  } catch {
    return []
  }
}

function saveCacheIndex(ids: string[]): void {
  Storage.set(CHAPTER_CACHE_INDEX_KEY, JSON.stringify(Array.from(new Set(ids))))
}

function addCacheIndex(bookId: string): void {
  saveCacheIndex([...loadCacheIndex(), bookId])
}

function removeCacheIndex(bookId: string): void {
  saveCacheIndex(loadCacheIndex().filter((id) => id !== bookId))
}

export function loadCachedChapters(book: Audiobook): ChapterLoadResult | null {
  try {
    const raw = Storage.get<string>(cacheKey(book))
    if (!raw) return null
    const data = JSON.parse(raw) as ChapterCacheEntry
    if (!Array.isArray(data.chapters) || data.chapters.length === 0) return null
    return {
      chapters: data.chapters,
      fromCache: true,
      updatedAt: data.updatedAt,
    }
  } catch {
    return null
  }
}

export function saveCachedChapters(book: Audiobook, chapters: Chapter[]): void {
  if (chapters.length === 0) return
  const data: ChapterCacheEntry = {
    chapters,
    updatedAt: Date.now(),
  }
  Storage.set(cacheKey(book), JSON.stringify(data))
  addCacheIndex(book.id)
}

export function removeCachedChapters(bookOrId: Audiobook | string): void {
  const bookId = typeof bookOrId === "string" ? bookOrId : bookOrId.id
  Storage.remove(`${CHAPTER_CACHE_PREFIX}${bookId}`)
  removeCacheIndex(bookId)
}

export function clearCachedChapters(): void {
  for (const bookId of loadCacheIndex()) {
    Storage.remove(`${CHAPTER_CACHE_PREFIX}${bookId}`)
  }
  Storage.remove(CHAPTER_CACHE_INDEX_KEY)
}

export function isChapterCacheFresh(result: ChapterLoadResult | null): boolean {
  if (!result?.updatedAt) return false
  return Date.now() - result.updatedAt < CHAPTER_CACHE_TTL
}

export async function fetchChapters(book: Audiobook): Promise<Chapter[]> {
  if (book.source === "ximalaya" || book.id.startsWith("xm:")) {
    const albumId = book.albumId || book.id.replace("xm:", "")
    return ximalayaAPI.getAllTracks(albumId)
  }
  if (book.source === "novelfm" || book.id.startsWith("fq:")) {
    const bookId = book.bookId || book.id.replace("fq:", "")
    const itemIds = await novelfmAPI.getDirectory(bookId)
    return novelfmAPI.getChapterInfo(bookId, itemIds)
  }
  return lrtsAPI.getAllChapters(book.id)
}

export async function refreshChaptersCache(book: Audiobook): Promise<ChapterLoadResult> {
  const chapters = await fetchChapters(book)
  saveCachedChapters(book, chapters)
  return {
    chapters,
    fromCache: false,
    updatedAt: Date.now(),
  }
}
