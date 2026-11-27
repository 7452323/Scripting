import {
  Button,
  HStack,
  Image,
  List,
  NavigationStack,
  Section,
  Text,
  TextField,
  VStack,
  useEffect,
  useState,
} from "scripting"
import { pageToolbar } from "./chrome"
import type { MediaItem, RemoteMedia } from "../types"
import {
  addMediaItem,
  loadFavoriteGroups,
  loadHistory,
  loadLibrary,
  loadScrapeLibrary,
  removeMediaItem,
  toggleFavorite,
} from "../storage"
import { buildMediaGroups } from "../sources/mediaGroups"
import { presentPlayer } from "../player"
import { loadSourcesConfig } from "../sources/config"
import { embyListLatest } from "../sources/emby"
import { plexListRecent } from "../sources/plex"
import {
  cloud115GetPlayUrl,
  cloud115ListVideos,
  cloud115Space,
  formatSpace,
} from "../sources/cloud115"
import { loadScriptSource } from "../sources/scriptSource"
import { Cloud115Page } from "./cloud115"
import { ScrapePage } from "./scrape"
import { presentDetail } from "./detail"
import { findGroupOfEntry } from "../sources/mediaGroups"
import { RemoteImage } from "../imageLoader"
import { scrapeTMDB } from "../sources/scrape"
import { saveSourcesConfig } from "../sources/config"

export function LibraryPage({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<MediaItem[]>(() => loadLibrary())
  const [remote, setRemote] = useState<RemoteMedia[]>([])
  const [urlInput, setUrlInput] = useState("")
  const [titleInput, setTitleInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("")
  const [spaceText, setSpaceText] = useState("")
  const [showSheet, setShowSheet] = useState(false)
  const [sheetMode, setSheetMode] = useState<"115" | "scrape">("115")
  const [scraped, setScraped] = useState(() => loadScrapeLibrary())

  const refreshLocal = () => setItems(loadLibrary())

  const refreshRemote = async () => {
    const cfg = loadSourcesConfig()
    const all: RemoteMedia[] = []
    const errors: string[] = []
    setStatus("正在同步源...")

    if (cfg.emby.enabled && cfg.emby.accessToken) {
      try {
        all.push(...(await embyListLatest(cfg.emby)))
      } catch (e: any) {
        errors.push(`Emby: ${e?.message || e}`)
      }
    }
    if (cfg.plex.enabled && cfg.plex.token) {
      try {
        all.push(...(await plexListRecent(cfg.plex)))
      } catch (e: any) {
        errors.push(`Plex: ${e?.message || e}`)
      }
    }
    if (cfg.cloud115.enabled && cfg.cloud115.cookie) {
      try {
        all.push(...(await cloud115ListVideos(cfg.cloud115)))
        try {
          const sp = await cloud115Space(cfg.cloud115)
          cfg.cloud115.spaceUsed = sp.used
          cfg.cloud115.spaceTotal = sp.total
          saveSourcesConfig(cfg)
          setSpaceText(`${formatSpace(sp.used)}/${formatSpace(sp.total)}`)
        } catch {}
      } catch (e: any) {
        errors.push(`115: ${e?.message || e}`)
      }
    }
    for (const s of cfg.scripts.filter(x => x.enabled)) {
      try {
        all.push(...(await loadScriptSource(s)))
      } catch (e: any) {
        errors.push(`${s.name}: ${e?.message || e}`)
      }
    }

    setRemote(all)
    if (all.length) {
      setStatus(
        errors.length
          ? `远程 ${all.length} · ${errors[0]}`
          : `远程 ${all.length} 条`
      )
    } else {
      setStatus(errors[0] || "暂无远程媒体")
    }
  }

  useEffect(() => {
    const cfg = loadSourcesConfig()
    if (cfg.cloud115.spaceTotal) {
      setSpaceText(
        `${formatSpace(cfg.cloud115.spaceUsed || 0)}/${formatSpace(cfg.cloud115.spaceTotal)}`
      )
    }
    refreshRemote().catch(() => {})
  }, [])

  const handleAddUrl = async () => {
    const url = urlInput.trim()
    if (!url) {
      setStatus("请输入有效的视频地址")
      return
    }
    if (!/^https?:\/\//i.test(url) && !url.startsWith("file://")) {
      setStatus("目前仅支持 http(s) 或 file:// 链接")
      return
    }

    let title = titleInput.trim() || extractTitleFromUrl(url)
    let poster: string | undefined
    const cfg = loadSourcesConfig()
    if (cfg.tmdbApiKey && title) {
      try {
        const scraped = await scrapeTMDB(cfg.tmdbApiKey, title)
        if (scraped) {
          title = scraped.title
          poster = scraped.poster
        }
      } catch {}
    }

    addMediaItem({
      title,
      url,
      poster,
      sourceType: url.startsWith("file://") ? "local" : "url",
      sourceName: "手动添加",
    })
    setUrlInput("")
    setTitleInput("")
    setStatus("已添加到媒体库（首页将自动刷新）")
    refreshLocal()
  }

  const handlePickLocal = async () => {
    if (busy) return
    setBusy(true)
    try {
      const paths = await DocumentPicker.pickFiles({
        types: ["public.movie", "public.video", "public.mpeg-4", "public.avi", "public.mpeg"],
        allowsMultipleSelection: false,
        shouldShowFileExtensions: true,
      })
      if (!paths || paths.length === 0) return
      const path = paths[0]
      const fileUrl = path.startsWith("file://") ? path : `file://${path}`
      addMediaItem({
        title: extractTitleFromUrl(path),
        url: fileUrl,
        sourceType: "local",
        sourceName: "本地文件",
      })
      setStatus("本地视频已添加（首页将自动刷新）")
      refreshLocal()
    } catch (e: any) {
      setStatus(e?.message || "选择失败")
    } finally {
      setBusy(false)
    }
  }

  const playLocal = async (item: MediaItem) => {
    try {
      await presentPlayer({
        url: item.url,
        title: item.title,
        poster: item.poster,
        mediaId: item.id,
        startTime: item.playProgress,
        headers: item.headers,
      })
    } catch (e: any) {
      await Dialog.alert({ title: "播放失败", message: e?.message || "无法播放" })
    } finally {
      refreshLocal()
    }
  }

  const playRemote = async (item: RemoteMedia) => {
    try {
      let url = item.url
      let playHeaders = item.headers
      if (item.sourceType === "115") {
        const cfg = loadSourcesConfig()
        const pick = item.extra?.pickCode
        if (!pick) throw new Error("缺少 pickCode")
        const got = await cloud115GetPlayUrl(cfg.cloud115, pick)
        url = got.url
        playHeaders = got.headers
      }
      if (!url) throw new Error("无播放地址")
      await presentPlayer({
        url,
        title: item.title,
        poster: item.poster,
        mediaId: item.id,
        headers: playHeaders,
      })
    } catch (e: any) {
      await Dialog.alert({ title: "播放失败", message: e?.message || "无法播放" })
    } finally {
      refreshLocal()
    }
  }

  const handleDelete = async (id: string) => {
    const ok = await Dialog.confirm({
      title: "删除媒体",
      message: "确定要从媒体库中移除吗？",
      confirmLabel: "删除",
      cancelLabel: "取消",
    })
    if (ok) {
      removeMediaItem(id)
      refreshLocal()
    }
  }

  const history = loadHistory()
  const lastMap = new Map(history.map(h => [h.mediaId, h.playedAt]))
  const favorites = items.filter(i => i.isFavorite)
  const others = items.filter(i => !i.isFavorite)

  const favGroupKeys = new Set(loadFavoriteGroups())
  const scrapeGroups = buildMediaGroups(scraped)
  const favGroups = favGroupKeys.size === 0 ? [] : scrapeGroups.filter(g => favGroupKeys.has(g.key))

  return (
    <NavigationStack>
      <List
        navigationTitle="媒体库"
        navigationBarTitleDisplayMode="large"
        toolbar={pageToolbar(onClose)}
        sheet={{
          isPresented: showSheet,
          onChanged: v => {
            setShowSheet(v)
            if (!v) setScraped(loadScrapeLibrary())
          },
          content:
            sheetMode === "115" ? (
              <Cloud115Page onClose={() => setShowSheet(false)} />
            ) : (
              <ScrapePage onClose={() => setShowSheet(false)} />
            ),
        }}
      >
        <Section header={<Text textCase={null}>概览</Text>}>
          <HStack spacing={10} padding={{ vertical: 4 }}>
            <StatCard title="本地资源" value={`${items.length}`} />
            <StatCard title="收藏" value={`${favorites.length}`} />
          </HStack>
          <HStack spacing={10} padding={{ vertical: 4 }}>
            <StatCard title="远程" value={`${remote.length}`} />
            <StatCard
              title="115 空间"
              value={spaceText || (loadSourcesConfig().cloud115.enabled ? "—" : "未启用")}
            />
          </HStack>
        </Section>

        {favGroups.length > 0 ? (
          <Section header={<Text textCase={null}>收藏的影视 ({favGroups.length})</Text>}>
            {favGroups.map(group => (
              <Button
                key={group.key}
                action={async () => {
                  await presentDetail(group)
                  setScraped(loadScrapeLibrary())
                }}
              >
                <HStack spacing={10} frame={{ maxWidth: "infinity" }} contentShape="rect">
                  <VStack
                    frame={{ width: 42, height: 62 }}
                    clipShape={{ type: "rect", cornerRadius: 8, style: "continuous" }}
                  >
                    <RemoteImage url={group.poster} width={42} height={62} radius={8} />
                  </VStack>
                  <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity" }}>
                    <Text font="subheadline" fontWeight="medium" lineLimit={1}>
                      {group.title}
                    </Text>
                    <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                      {[
                        group.year,
                        group.type === "series" ? `${group.episodeCount} 集` : group.category,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "已收藏"}
                    </Text>
                  </VStack>
                  <Image systemName="chevron.right" font="caption" foregroundStyle="secondaryLabel" />
                </HStack>
              </Button>
            ))}
          </Section>
        ) : null}

        <Section header={<Text textCase={null}>刮削库 ({scrapeGroups.length})</Text>}>
          {scrapeGroups.length === 0 ? (
            <Text font="caption" foregroundStyle="secondaryLabel">
              打开「115 网盘」进入一个文件夹，点「刮削此文件夹」即可生成海报墙。
            </Text>
          ) : (
            scrapeGroups.slice(0, 12).map(group => (
              <Button
                key={group.key}
                action={async () => {
                  await presentDetail(group)
                  setScraped(loadScrapeLibrary())
                }}
              >
                <HStack spacing={10} frame={{ maxWidth: "infinity" }} contentShape="rect">
                  <VStack
                    frame={{ width: 42, height: 62 }}
                    clipShape={{ type: "rect", cornerRadius: 8, style: "continuous" }}
                  >
                    <RemoteImage url={group.poster} width={42} height={62} radius={8} />
                  </VStack>
                  <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity" }}>
                    <Text font="subheadline" fontWeight="medium" lineLimit={1}>
                      {group.title}
                    </Text>
                    <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                      {[
                        group.year,
                        group.type === "series" ? `${group.episodeCount} 集` : group.category,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "115"}
                    </Text>
                  </VStack>
                  <Image systemName="chevron.right" font="caption" foregroundStyle="secondaryLabel" />
                </HStack>
              </Button>
            ))
          )}
          <Button
            title="管理刮削库"
            systemImage="sparkles.tv"
            action={() => {
              setSheetMode("scrape")
              setShowSheet(true)
            }}
          />
        </Section>

        <Section header={<Text textCase={null}>添加媒体</Text>}>
          <TextField
            title="标题（可选）"
            value={titleInput}
            onChanged={setTitleInput}
            prompt="留空自动提取"
          />
          <TextField
            title="视频地址"
            value={urlInput}
            onChanged={setUrlInput}
            prompt="https://..."
          />
          <Button title="添加远程链接" systemImage="link.badge.plus" action={handleAddUrl} />
          <Button
            title={busy ? "选择中..." : "选择本地视频"}
            systemImage="folder.badge.plus"
            action={handlePickLocal}
          />
          <Button title="刷新远程源" systemImage="arrow.clockwise" action={refreshRemote} />
          <Button
            title="115 网盘"
            systemImage="cloud.fill"
            action={() => {
              setSheetMode("115")
              setShowSheet(true)
            }}
          />
          <Button
            title="海报刮削"
            systemImage="sparkles.tv"
            action={() => {
              setSheetMode("scrape")
              setShowSheet(true)
            }}
          />
          {status ? (
            <Text font="caption" foregroundStyle="secondaryLabel">
              {status}
            </Text>
          ) : null}
        </Section>

        {remote.length > 0 ? (
          <Section header={<Text textCase={null}>远程源 ({remote.length})</Text>}>
            {remote.map(item => (
              <Button key={item.id} action={() => playRemote(item)}>
                <MediaCard
                  title={item.title}
                  meta={item.sourceName}
                  extra={item.extra?.size ? formatSpace(Number(item.extra.size)) : undefined}
                />
              </Button>
            ))}
          </Section>
        ) : null}

        {favorites.length > 0 ? (
          <Section header={<Text textCase={null}>收藏</Text>}>
            {favorites.map(item => (
              <MediaCardRow
                key={item.id}
                item={item}
                lastPlayed={lastMap.get(item.id) || item.lastPlayedAt}
                onPlay={() => playLocal(item)}
                onDelete={() => handleDelete(item.id)}
                onToggleFavorite={() => {
                  toggleFavorite(item.id)
                  refreshLocal()
                }}
              />
            ))}
          </Section>
        ) : null}

        <Section
          header={<Text textCase={null}>全部媒体 ({others.length})</Text>}
          footer={
            items.length === 0 ? (
              <Text font="caption">添加 URL、本地文件或配置媒体源</Text>
            ) : undefined
          }
        >
          {others.map(item => (
            <MediaCardRow
              key={item.id}
              item={item}
              lastPlayed={lastMap.get(item.id) || item.lastPlayedAt}
              onPlay={() => playLocal(item)}
              onDelete={() => handleDelete(item.id)}
              onToggleFavorite={() => {
                toggleFavorite(item.id)
                refreshLocal()
              }}
            />
          ))}
        </Section>
      </List>
    </NavigationStack>
  )
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <VStack
      alignment="leading"
      spacing={4}
      padding={12}
      frame={{ maxWidth: "infinity" }}
      background="secondarySystemBackground"
      clipShape={{ type: "rect", cornerRadius: 12, style: "continuous" }}
    >
      <Text font="caption" foregroundStyle="secondaryLabel">
        {title}
      </Text>
      <Text fontWeight="bold" font="title3">
        {value}
      </Text>
    </VStack>
  )
}

function MediaCard({
  title,
  meta,
  extra,
}: {
  title: string
  meta: string
  extra?: string
}) {
  return (
    <VStack
      alignment="leading"
      spacing={4}
      padding={12}
      frame={{ maxWidth: "infinity" }}
      background="secondarySystemBackground"
      clipShape={{ type: "rect", cornerRadius: 12, style: "continuous" }}
    >
      <Text fontWeight="semibold" lineLimit={2}>
        {title}
      </Text>
      <Text font="caption" foregroundStyle="secondaryLabel">
        {meta}
        {extra ? ` · ${extra}` : ""}
      </Text>
    </VStack>
  )
}

function MediaCardRow({
  item,
  lastPlayed,
  onPlay,
  onDelete,
  onToggleFavorite,
}: {
  item: MediaItem
  lastPlayed?: number
  onPlay: () => void
  onDelete: () => void
  onToggleFavorite: () => void
}) {
  return (
    <VStack
      alignment="leading"
      spacing={8}
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
        {lastPlayed ? ` · 上次 ${formatDate(lastPlayed)}` : " · 未播放"}
      </Text>
      <HStack spacing={10}>
        <Button title="播放" systemImage="play.fill" action={onPlay} />
        <Button
          title={item.isFavorite ? "取消收藏" : "收藏"}
          systemImage={item.isFavorite ? "star.fill" : "star"}
          action={onToggleFavorite}
        />
        <Button
          title="删除"
          systemImage="trash"
          foregroundStyle="systemRed"
          action={onDelete}
        />
      </HStack>
    </VStack>
  )
}

function extractTitleFromUrl(url: string): string {
  try {
    const cleaned = url.replace(/^file:\/\//, "")
    const name = decodeURIComponent(cleaned.split("/").pop() || "")
    return name.replace(/\.[a-z0-9]{2,5}$/i, "") || "未命名视频"
  } catch {
    return "未命名视频"
  }
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}
