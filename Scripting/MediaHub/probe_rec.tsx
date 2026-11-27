import { Text, VStack, useEffect } from "scripting"
import { fetch } from "scripting"
import { loadSourcesConfig } from "./sources/config"
import { loadScrapeLibrary } from "./storage"
import { buildMediaGroups } from "./sources/mediaGroups"

export default function Probe() {
  useEffect(() => {
    ;(async () => {
      const cfg = loadSourcesConfig()
      const groups = buildMediaGroups(loadScrapeLibrary())
      const g = groups.find(x => x.type === "series" && x.tmdbId) ?? groups.find(x => x.tmdbId)
      if (!g) return console.log("NO_GROUP")
      const path = g.type === "movie" ? "movie" : "tv"
      const url = `https://api.themoviedb.org/3/${path}/${g.tmdbId}/recommendations?api_key=${encodeURIComponent(cfg.tmdbApiKey)}&language=zh-CN&page=1`
      const res = await fetch(url, { timeout: 20 })
      const data = await res.json().catch(() => null)
      const list: any[] = data?.results || []
      console.log("GROUP", g.title, g.tmdbId, g.type)
      console.log("REC status", res.status, "count", list.length)
      for (const r of list.slice(0, 4)) {
        console.log("  REC", r.id, r.title || r.name, (r.release_date || r.first_air_date || "").slice(0, 4), !!r.poster_path)
      }
      // 库里能命中几个
      const ids = new Set(groups.map(x => x.tmdbId))
      console.log("IN_LIBRARY", list.filter(r => ids.has(Number(r.id))).length, "/", list.length)
    })()
  }, [])
  return (
    <VStack>
      <Text>probe</Text>
    </VStack>
  )
}
