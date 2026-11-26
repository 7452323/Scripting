import {
  Button,
  HStack,
  List,
  Section,
  Text,
  VStack,
  useEffect,
  useState,
} from "scripting"
import type { MediaItem, PlaybackHistory, RemoteMedia } from "../types"
import { loadHistory, loadLibrary } from "../storage"
import { presentPlayer } from "../player"
import { loadSourcesConfig } from "../sources/config"
import { embyListLatest } from "../sources/emby"
import { plexListRecent } from "../sources/plex"

export function HomePage() {
  const [library, setLibrary] = useState<MediaItem[]>(() => loadLibrary())
  const [history, setHistory] = useState<PlaybackHistory[]>(() => loadHistory())
  const [remotePreview, setRemotePreview] = useState<RemoteMedia[]>([])

  const refresh = () => {
    setLibrary(loadLibrary())
    setHistory(loadHistory())
  }

  useEffect(() => {
    const cfg = loadSourcesConfig()
    ;(async () => {
      const all: RemoteMedia[] = []
      try {
        if (cfg.emby.enabled && cfg.emby.accessToken) {
          all.push(...(await embyListLatest(cfg.emby, 10)))
        }
      } catch {}
      try {
        if (cfg.plex.enabled && cfg.plex.token) {
          all.push(...(await plexListRecent(cfg.plex, 10)))
        }
      } catch {}
      setRemotePreview(all.slice(0, 12))
    })()
  }, [])

  const recent = history.slice(0, 8)
  const favorites = library.filter(i => i.isFavorite).slice(0, 8)
  const latest = library.slice(0, 8)

  const playItem = async (opts: {
    url: string
    title: string
    mediaId?: string
    startTime?: number
    headers?: Record<string, string>
  }) => {
    try {
      await presentPlayer(opts)
    } catch (e) {
      console.error(e)
    } finally {
      refresh()
    }
  }

  return (
    <List navigationTitle="MediaHub" navigationBarTitleDisplayMode="large">
      <Section
        header={<Text textCase={null}>继续观看</Text>}
        footer={recent.length === 0 ? "播放后会显示在这里" : undefined}
      >
        {recent.map(entry => (
          <Button
            key={`${entry.mediaId}_${entry.playedAt}`}
            action={() =>
              playItem({
                url: entry.url,
                title: entry.title,
                mediaId: entry.mediaId,
                startTime: entry.progress > 5 ? entry.progress : 0,
                headers: entry.headers,
              })
            }
          >
            <HStack spacing={12} padding={{ vertical: 4 }}>
              <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity" }}>
                <Text fontWeight="medium" lineLimit={1}>
                  {entry.title}
                </Text>
                <Text font="caption" foregroundStyle="secondaryLabel">
                  {formatTime(entry.progress)}
                  {entry.duration > 0 ? ` / ${formatTime(entry.duration)}` : ""}
                </Text>
              </VStack>
              <Text font="caption" foregroundStyle="secondaryLabel">
                继续
              </Text>
            </HStack>
          </Button>
        ))}
      </Section>

      {remotePreview.length > 0 ? (
        <Section header={<Text textCase={null}>服务器最近</Text>}>
          {remotePreview.map(item => (
            <Button
              key={item.id}
              action={() =>
                playItem({
                  url: item.url,
                  title: item.title,
                  mediaId: item.id,
                  headers: item.headers,
                })
              }
            >
              <HStack spacing={12} padding={{ vertical: 4 }}>
                <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity" }}>
                  <Text fontWeight="medium" lineLimit={1}>
                    {item.title}
                  </Text>
                  <Text font="caption" foregroundStyle="secondaryLabel">
                    {item.sourceName}
                  </Text>
                </VStack>
                <Text font="caption" foregroundStyle="secondaryLabel">
                  播放
                </Text>
              </HStack>
            </Button>
          ))}
        </Section>
      ) : null}

      <Section
        header={<Text textCase={null}>收藏</Text>}
        footer={favorites.length === 0 ? "在媒体库中点星标收藏" : undefined}
      >
        {favorites.map(item => (
          <Button
            key={item.id}
            action={() =>
              playItem({
                url: item.url,
                title: item.title,
                mediaId: item.id,
                startTime: item.playProgress,
                headers: item.headers,
              })
            }
          >
            <HStack spacing={12} padding={{ vertical: 4 }}>
              <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity" }}>
                <Text fontWeight="medium" lineLimit={1}>
                  {item.title}
                </Text>
                <Text font="caption" foregroundStyle="secondaryLabel">
                  {item.sourceName || item.sourceType}
                </Text>
              </VStack>
              <Text font="caption" foregroundStyle="secondaryLabel">
                播放
              </Text>
            </HStack>
          </Button>
        ))}
      </Section>

      <Section
        header={<Text textCase={null}>最近添加</Text>}
        footer={latest.length === 0 ? "去「媒体库」添加视频或配置源" : undefined}
      >
        {latest.map(item => (
          <Button
            key={item.id}
            action={() =>
              playItem({
                url: item.url,
                title: item.title,
                mediaId: item.id,
                startTime: item.playProgress,
                headers: item.headers,
              })
            }
          >
            <HStack spacing={12} padding={{ vertical: 4 }}>
              <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity" }}>
                <Text fontWeight="medium" lineLimit={1}>
                  {item.title}
                </Text>
                <Text font="caption" foregroundStyle="secondaryLabel">
                  {item.sourceName || item.sourceType}
                </Text>
              </VStack>
              <Text font="caption" foregroundStyle="secondaryLabel">
                播放
              </Text>
            </HStack>
          </Button>
        ))}
      </Section>
    </List>
  )
}

function formatTime(seconds: number): string {
  const s = Math.floor(seconds || 0)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, "0")}`
}
