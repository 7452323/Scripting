/** 简易刮削：TMDB 搜索标题信息 */

export interface ScrapeResult {
  title: string
  overview?: string
  poster?: string
  year?: string
  tmdbId?: number
}

export async function scrapeTMDB(
  apiKey: string,
  keyword: string
): Promise<ScrapeResult | null> {
  if (!apiKey || !keyword.trim()) return null

  const url =
    `https://api.themoviedb.org/3/search/multi?api_key=${encodeURIComponent(apiKey)}` +
    `&query=${encodeURIComponent(keyword.trim())}&language=zh-CN`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`TMDB 请求失败 (${res.status})`)
  const data = await res.json()
  const item = (data.results || []).find(
    (r: any) => r.media_type === "movie" || r.media_type === "tv"
  )
  if (!item) return null

  const title = item.title || item.name || keyword
  const year = (item.release_date || item.first_air_date || "").slice(0, 4)
  const poster = item.poster_path
    ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
    : undefined

  return {
    title: year ? `${title} (${year})` : title,
    overview: item.overview,
    poster,
    year,
    tmdbId: item.id,
  }
}
