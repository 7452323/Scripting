/** 把刮削条目聚合成「影视」（电影 / 剧集+季+集），供详情页使用（对齐 SenPlayer 的详情页模型） */
import type { ScrapeEntry } from "../storage"

export interface MediaSeason {
  season: number
  episodes: ScrapeEntry[]
}

export interface MediaGroup {
  key: string
  title: string
  poster?: string
  backdrop?: string
  overview?: string
  year?: string
  rating?: number
  category?: string
  tmdbId?: number
  type: "movie" | "series"
  entries: ScrapeEntry[]
  seasons: MediaSeason[]
  episodeCount: number
}

function normTitle(title: string): string {
  return (title || "").trim().toLowerCase().replace(/\s+/g, " ")
}

export function groupKeyOf(entry: ScrapeEntry): string {
  if (entry.tmdbId) return `tmdb_${entry.tmdbId}`
  return `title_${normTitle(entry.title)}`
}

function isSeriesEntry(entry: ScrapeEntry): boolean {
  if (entry.episode != null || entry.season != null) return true
  const c = entry.category || ""
  return c.includes("剧") || c === "综艺" || c === "新闻"
}

export function buildMediaGroups(entries: ScrapeEntry[]): MediaGroup[] {
  const buckets = new Map<string, ScrapeEntry[]>()
  for (const entry of entries) {
    const key = groupKeyOf(entry)
    const list = buckets.get(key) || []
    list.push(entry)
    buckets.set(key, list)
  }

  const groups: MediaGroup[] = []
  for (const [key, list] of buckets) {
    const sorted = [...list].sort(
      (a, b) => (a.season ?? 1) - (b.season ?? 1) || (a.episode ?? 0) - (b.episode ?? 0)
    )
    const first = sorted[0]
    const type: "movie" | "series" = sorted.some(isSeriesEntry) ? "series" : "movie"

    const seasonMap = new Map<number, ScrapeEntry[]>()
    for (const entry of sorted) {
      const s = entry.season ?? 1
      const arr = seasonMap.get(s) || []
      arr.push(entry)
      seasonMap.set(s, arr)
    }
    const seasons: MediaSeason[] = [...seasonMap.entries()]
      .map(([season, eps]) => ({
        season,
        episodes: eps.sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0)),
      }))
      .sort((a, b) => a.season - b.season)

    groups.push({
      key,
      title: first.title,
      poster: first.poster,
      backdrop: first.backdrop,
      overview: first.overview,
      year: first.year,
      rating: first.rating,
      category: first.category,
      tmdbId: first.tmdbId,
      type,
      entries: sorted,
      seasons,
      episodeCount: sorted.length,
    })
  }

  groups.sort(
    (a, b) =>
      Number(b.year || 0) - Number(a.year || 0) || a.title.localeCompare(b.title, "zh-Hans-CN")
  )
  return groups
}

export function findGroupByPickCode(entries: ScrapeEntry[], pickCode: string): MediaGroup | null {
  const target = entries.find(e => e.refId === pickCode)
  if (!target) return null
  const key = groupKeyOf(target)
  return buildMediaGroups(entries).find(g => g.key === key) ?? null
}

export function findGroupOfEntry(entries: ScrapeEntry[], entry: ScrapeEntry): MediaGroup | null {
  const key = groupKeyOf(entry)
  return buildMediaGroups(entries).find(g => g.key === key) ?? null
}

/** 剧集里「接着看」的那一集：有进度且未看完的，否则第一集 */
export function resumeEpisode(
  group: MediaGroup,
  progressOf: (entry: ScrapeEntry) => number
): { entry: ScrapeEntry; progress: number } | null {
  if (group.type === "movie") {
    const entry = group.entries[0]
    return entry ? { entry, progress: progressOf(entry) } : null
  }
  let best: { entry: ScrapeEntry; progress: number } | null = null
  for (const season of group.seasons) {
    for (const entry of season.episodes) {
      const p = progressOf(entry)
      if (p > 0.02 && p < 0.98) {
        if (!best || p > best.progress) best = { entry, progress: p }
      }
    }
  }
  if (best) return best
  const firstEpisode = group.seasons[0]?.episodes[0]
  return firstEpisode ? { entry: firstEpisode, progress: progressOf(firstEpisode) } : null
}

/** 按季/集展平（跨季的「下一集」用） */
export function flattenEpisodes(group: MediaGroup): ScrapeEntry[] {
  const out: ScrapeEntry[] = []
  for (const season of group.seasons) for (const entry of season.episodes) out.push(entry)
  return out
}

/** 某一集的下一集（跨季），没有则 null */
export function nextEpisodeOf(group: MediaGroup, entry: ScrapeEntry): ScrapeEntry | null {
  const list = flattenEpisodes(group)
  const index = list.findIndex(e => e.id === entry.id)
  if (index < 0) return null
  return list[index + 1] ?? null
}

/** 第一个未看过的集（配合已看标记） */
export function firstUnwatched(group: MediaGroup, isWatched: (id: string) => boolean): ScrapeEntry | null {
  for (const entry of flattenEpisodes(group)) if (!isWatched(entry.id)) return entry
  return null
}
