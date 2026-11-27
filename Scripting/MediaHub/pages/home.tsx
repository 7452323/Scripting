import {
  Button,
  HStack,
  List,
  NavigationStack,
  Section,
  Text,
  VStack,
  useEffect,
  useState,
} from "scripting"
import { pageToolbar } from "./chrome"
import type { MediaItem, PlaybackHistory, RemoteMedia } from "../types"
import {
  getLibraryRevision,
  loadHistory,
  loadLibrary,
} from "../storage"
import { presentPlayer } from "../player"
import { loadSourcesConfig } from "../sources/config"
import { embyListLatest } from "../sources/emby"
import { plexListRecent } from "../sources/plex"
import { formatSpace } from "../sources/cloud115"

export function HomePage({ onClose }: { onClose: () => void }) {
  const [library, setLibrary] = useState<MediaItem[]>(() => loadLibrary())
  const [history, setHistory] = useState<PlaybackHistory[]>(() => loadHistory())
  const [remotePreview, setRemotePreview] = useState<RemoteMedia[]>([])
  const [rev, setRev] = useState(() => getLibraryRevision())
  const [sourcesTick, setSourcesTick] = useState(0)

  const refresh = () => {
    setLibrary(loadLibrary())
    setHistory(loadHistory())
  }

  // 修复：媒体库添加后首页不更新
  useEffect(() => {
    const timer = setInterval(() => {
      const r = getLibraryRevision()
      if (r !== rev) {
        setRev(r)
        refresh()
      }
    }, 600)
    return () => clearInterval(timer)
  }, [rev])

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
  }, [sourcesTick, rev])

  const cfg = loadSourcesConfig()
  const recent = history.slice(0, 10)
  const favorites = library.filter(i => i.isFavorite)
  const latest = library.slice(0, 12)

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
      setRev(getLibraryRevision())
    }
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="MediaHub"
        navigationBarTitleDisplayMode="large"
        toolbar={pageToolbar(onClose)}
      >
        {/* 媒体源概览卡片 — Infuse / SenPlayer 风格 */}
        <Section header={<Text textCase={null}>媒体源</Text>}>
          <HStack spacing={10} padding={{ vertical: 6 }}>
            <SourceCard
              title="Emby"
              subtitle={
                cfg.emby.enabled && cfg.emby.accessToken
                  ? cfg.emby.host || "已登录"
                  : "未配置"
              }
              badge={cfg.emby.enabled && cfg.emby.accessToken ? "在线" : "—"}
              tint="systemIndigo"
            />
            <SourceCard
              title="Plex"
              subtitle={
                cfg.plex.enabled && cfg.plex.token
                  ? cfg.plex.host || "已登录"
                  : "未配置"
              }
              badge={cfg.plex.enabled && cfg.plex.token ? "在线" : "—"}
              tint="systemOrange"
            />
          </HStack>
          <HStack spacing={10} padding={{ vertical: 6 }}>
            <SourceCard
              title="115"
              subtitle={
                cfg.cloud115.enabled
                  ? cfg.cloud115.spaceTotal
                    ? `${formatSpace(cfg.cloud115.spaceUsed || 0)}/${formatSpace(cfg.cloud115.spaceTotal)}`
                    : "已启用"
                  : "未配置"
              }
              badge={cfg.cloud115.enabled ? "网盘" : "—"}
              tint="systemBlue"
            />
            <SourceCard
              title="本地库"
              subtitle={`${library.length} 个资源`}
              badge={favorites.length ? `${favorites.length} 收藏` : "媒体"}
              tint="systemGreen"
            />
          </HStack>
          <Button
            title="刷新首页"
            systemImage="arrow.clockwise"
            action={() => {
              refresh()
              setSourcesTick(t => t + 1)
              setRev(getLibraryRevision())
            }}
          />
        </Section>

        <Section
          header={<Text textCase={null}>继续观看</Text>}
          footer={recent.length === 0 ? "播放后会出现在这里" : undefined}
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
              <VStack
                alignment="leading"
                spacing={4}
                padding={12}
                frame={{ maxWidth: "infinity" }}
                background="secondarySystemBackground"
                clipShape={{ type: "rect", cornerRadius: 12, style: "continuous" }}
              >
                <Text fontWeight="semibold" lineLimit={1}>
                  {entry.title}
                </Text>
                <Text font="caption" foregroundStyle="secondaryLabel">
                  {formatTime(entry.progress)}
                  {entry.duration > 0 ? ` / ${formatTime(entry.duration)}` : ""}
                  {" · "}
                  {formatDate(entry.playedAt)}
                </Text>
              </VStack>
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
                <VStack
                  alignment="leading"
                  spacing={4}
                  padding={12}
                  frame={{ maxWidth: "infinity" }}
                  background="secondarySystemBackground"
                  clipShape={{ type: "rect", cornerRadius: 12, style: "continuous" }}
                >
                  <Text fontWeight="semibold" lineLimit={2}>
                    {item.title}
                  </Text>
                  <Text font="caption" foregroundStyle="secondaryLabel">
                    {item.sourceName}
                  </Text>
                </VStack>
              </Button>
            ))}
          </Section>
        ) : null}

        <Section
          header={<Text textCase={null}>我的媒体库 ({library.length})</Text>}
          footer={library.length === 0 ? "在「媒体库」添加视频后会显示在这里" : undefined}
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
              <VStack
                alignment="leading"
                spacing={4}
                padding={12}
                frame={{ maxWidth: "infinity" }}
                background="secondarySystemBackground"
                clipShape={{ type: "rect", cornerRadius: 12, style: "continuous" }}
              >
                <Text fontWeight="semibold" lineLimit={2}>
                  {item.title}
                </Text>
                <Text font="caption" foregroundStyle="secondaryLabel">
                  {item.sourceName || item.sourceType}
                  {item.lastPlayedAt ? ` · ${formatDate(item.lastPlayedAt)}` : ""}
                  {item.isFavorite ? " · 收藏" : ""}
                </Text>
              </VStack>
            </Button>
          ))}
        </Section>
      </List>
    </NavigationStack>
  )
}

function SourceCard({
  title,
  subtitle,
  badge,
  tint,
}: {
  title: string
  subtitle: string
  badge: string
  tint: string
}) {
  return (
    <VStack
      alignment="leading"
      spacing={6}
      padding={12}
      frame={{ maxWidth: "infinity" }}
      background="secondarySystemBackground"
      clipShape={{ type: "rect", cornerRadius: 14, style: "continuous" }}
    >
      <Text fontWeight="bold" foregroundStyle={tint}>
        {title}
      </Text>
      <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
        {subtitle}
      </Text>
      <Text font="caption2" foregroundStyle="tertiaryLabel">
        {badge}
      </Text>
    </VStack>
  )
}

function formatTime(seconds: number): string {
  const s = Math.floor(seconds || 0)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, "0")}`
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  if (sameDay) return `今天 ${hm}`
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}
