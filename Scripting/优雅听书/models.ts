export type Platform = "lrts" | "ximalaya" | "novelfm"

export type Audiobook = {
  id: string
  title: string
  author: string
  coverUrl?: string
  description?: string
  categoryName?: string
  chapterCount: number
  isFinished: boolean
  source: Platform
  // Platform-specific metadata
  albumId?: string      // Ximalaya album ID
  bookId?: string       // Novelfm book ID
}

export type Chapter = {
  id: string
  bookId: string
  title: string
  audioUrl?: string
  tmeId?: string        // LRTS track ID
  trackId?: number      // Ximalaya track ID
  duration: number
  index: number
  section?: number      // LRTS section number
  // Platform-specific
  isPaid?: boolean      // Ximalaya paid flag
}

export type BookShelfItem = {
  book: Audiobook
  lastChapterIndex: number
  lastPosition: number
  addedAt: number
  updatedAt: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function audiobookIdFromLrts(id: number | string): string {
  return `lrts:${id}`
}

export function lrtsIdFromBookId(id: string): string {
  if (id.startsWith("lrts:")) return id.slice("lrts:".length)
  return id
}

export function ximalayaAlbumId(id: string): string {
  if (id.startsWith("xm:")) return id.slice("xm:".length)
  return id
}

export function novelfmBookId(id: string): string {
  if (id.startsWith("fq:")) return id.slice("fq:".length)
  return id
}
