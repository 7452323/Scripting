import { Button, HStack, Image, NavigationLink, NavigationStack, ScrollView, Text, VStack, useState, useEffect } from "scripting"
import { moonClient, PlayRecord, SearchResult } from "../client"
import { ACCENT, PAGE_PADDING, LoadingState } from "../design"
import { getHistoryRevision, getLocalHistory, removeLocalHistory, subscribeHistoryUpdates } from "../storage"
import { DetailView } from "./home"

export default function LibraryView() {
  const [tab, setTab] = useState<"history" | "favorites">("history")
  const [historyRevision, setHistoryRevision] = useState(getHistoryRevision())

  useEffect(() => subscribeHistoryUpdates(setHistoryRevision), [])

  return (
    <NavigationStack>
      <VStack navigationTitle="资料库" navigationBarTitleDisplayMode="large" padding={{ horizontal: PAGE_PADDING }}>
        <HStack spacing={12} padding={{ vertical: 8 }}>
          <Button
            title="观看历史"
            tint={tab === "history" ? ACCENT : undefined}
            action={() => { setTab("history"); setHistoryRevision(Date.now()) }}
          />
          <Button
            title="收藏"
            tint={tab === "favorites" ? ACCENT : undefined}
            action={() => setTab("favorites")}
          />
        </HStack>

        {tab === "history" ? <HistoryTab revision={historyRevision} /> : <FavoritesTab />}
      </VStack>
    </NavigationStack>
  )
}

// ===== History Tab =====
function HistoryTab({ revision }: { revision: number }) {
  const [serverRecords, setServerRecords] = useState<PlayRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const synced: Array<{ id: string; source: string }> = []
      for (const record of getLocalHistory()) {
        try {
          await moonClient.savePlayRecord(
            record.id,
            record.source,
            record.index || 1,
            record.title,
            record.poster,
            record.total_episodes || 1,
            record.play_time || 0,
            record.total_time || 0,
            record.source_name || record.source,
          )
          synced.push({ id: record.id, source: record.source })
        } catch {}
      }
      if (synced.length > 0) removeLocalHistory(synced)
      const records = await moonClient.getPlayRecords()
      if (!cancelled) {
        setServerRecords(records)
        setLoading(false)
      }
    }
    load().catch(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [revision])

  if (loading) return <LoadingState title="正在同步云端记录..." />

  if (serverRecords.length === 0) {
    return <Text font="subheadline" foregroundStyle="secondaryLabel" padding={{ top: 20 }}>暂无云端观看记录</Text>
  }

  return (
    <ScrollView contentMargins={{ edges: "bottom", insets: 0, placement: "scrollContent" }} ignoresSafeArea={{ regions: "container", edges: "bottom" }}>
      <VStack spacing={12} padding={{ top: 8 }}>
        <Text font="subheadline" fontWeight="semibold" foregroundStyle="secondaryLabel">云端记录</Text>
        {serverRecords.map((r, i) => {
              const parts = r.key?.split("+") || []
              return (
                <NavigationLink
                  key={r.key || i}
                  destination={parts.length >= 2 ? <DetailView id={parts[1]} source={parts[0]} title={r.title} poster={r.cover} /> : <Text>无效记录</Text>}
                >
                  <HStack
                    spacing={10}
                    padding={8}
                    background="secondarySystemBackground"
                    clipShape={{ type: "rect", cornerRadius: 10, style: "continuous" }}
                  >
                    <Image
                      imageUrl={moonClient.resolvePosterUrl(r.cover)}
                      resizable={true}
                      frame={{ width: 56, height: 80 }}
                      clipShape={{ type: "rect", cornerRadius: 8, style: "continuous" }}
                    />
                    <VStack spacing={4} frame={{ maxWidth: "infinity" }}>
                      <Text font="subheadline" fontWeight="semibold" lineLimit={2}>{r.title || ""}</Text>
                      <Text foregroundStyle="secondaryLabel" font="caption">{r.source_name || ""}</Text>
                      {r.total_time > 0 ? (
                        <HStack spacing={6}>
                          <VStack
                            frame={{ height: 4 }}
                            background="tertiarySystemBackground"
                            clipShape={{ type: "rect", cornerRadius: 2, style: "continuous" }}
                          >
                            <VStack
                              frame={{
                                width: Math.round(Math.min(r.play_time / r.total_time, 1) * 240),
                                height: 4,
                              }}
                              background="systemBlue"
                              clipShape={{ type: "rect", cornerRadius: 2, style: "continuous" }}
                            />
                          </VStack>
                          <Text foregroundStyle="secondaryLabel" font="caption">
                            {Math.round((r.play_time / r.total_time) * 100)}%
                          </Text>
                        </HStack>
                      ) : null}
                    </VStack>
                  </HStack>
                </NavigationLink>
              )
        })}
      </VStack>
    </ScrollView>
  )
}

// ===== Favorites Tab =====
function FavoritesTab() {
  const [favorites, setFavorites] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    moonClient.getFavorites()
      .then(setFavorites)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingState title="加载中..." />

  if (favorites.length === 0) {
    return <Text font="subheadline" foregroundStyle="secondaryLabel" padding={{ top: 20 }}>暂无收藏</Text>
  }

  return (
    <ScrollView contentMargins={{ edges: "bottom", insets: 0, placement: "scrollContent" }} ignoresSafeArea={{ regions: "container", edges: "bottom" }}>
      <VStack spacing={12} padding={{ top: 8 }}>
        {favorites.map((fav, i) => (
          <HStack
            key={`fav-${i}`}
            spacing={10}
            padding={8}
            background="secondarySystemBackground"
            clipShape={{ type: "rect", cornerRadius: 10, style: "continuous" }}
          >
            <NavigationLink
              destination={<DetailView id={fav.id} source={fav.source} title={fav.title} poster={fav.poster} />}
            >
              <HStack frame={{ maxWidth: "infinity" }}>
                <Image
                  imageUrl={moonClient.resolvePosterUrl(fav.poster)}
                  resizable={true}
                  frame={{ width: 56, height: 80 }}
                  clipShape={{ type: "rect", cornerRadius: 8, style: "continuous" }}
                />
                <VStack spacing={4} padding={{ leading: 10 }} frame={{ maxWidth: "infinity" }}>
                  <Text font="subheadline" fontWeight="semibold" lineLimit={2}>{fav.title}</Text>
                  <Text foregroundStyle="secondaryLabel" font="caption">{fav.type_name || ""}</Text>
                  <Text foregroundStyle={ACCENT} font="caption">{fav.source_name}</Text>
                </VStack>
              </HStack>
            </NavigationLink>
            <Button
              title="取消"
              tint="systemRed"
              action={async () => {
                try {
                  await moonClient.removeFavorite(fav.id, fav.source)
                  setFavorites(prev => prev.filter(f => !(f.id === fav.id && f.source === fav.source)))
                } catch {}
              }}
            />
          </HStack>
        ))}
      </VStack>
    </ScrollView>
  )
}

