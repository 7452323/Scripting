import {
  Button,
  Dialog,
  DocumentPicker,
  HStack,
  List,
  Section,
  Text,
  TextField,
  VStack,
  useEffect,
  useState,
} from "scripting"
import type { MediaItem } from "../types"
import {
  addMediaItem,
  loadLibrary,
  removeMediaItem,
  toggleFavorite,
} from "../storage"
import { presentPlayer } from "../player"
import { loadSourcesConfig } from "../sources/config"
import { embyListLatest } from "../sources/emby"
import { plexListRecent } from "../sources/plex"
import { cloud115GetPlayUrl, cloud115ListVideos } from "../sources/cloud115"
import { loadScriptSource } from "../sources/scriptSource"
import { scrapeTMDB } from "../sources/scrape"

export function LibraryPage() {
  const [items, setItems] = useState<MediaItem[]>(() => loadLibrary())
  const [remote, setRemote] = useState<
    Array<{ id: string; title: string; url: string; poster?: string; sourceName: string; extra?: any; sourceType: string }>
  >([])
  const [urlInput, setUrlInput] = useState("")
  const [titleInput, setTitleInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("")

  const refreshLocal = () => setItems(loadLibrary())

  const refreshRemote = async () => {
    const cfg = loadSourcesConfig()
    const all: typeof remote = []
    setStatus("正在同步源...")
    try {
      if (cfg.emby.enabled && cfg.emby.accessToken) {
        try {
          const list = await embyListLatest(cfg.emby)
          all.push(...list)
        } catch (e: any) {
          console.error("Emby", e)
        }
      }
      if (cfg.plex.enabled && cfg.plex.token) {
        try {
          const list = await plexListRecent(cfg.plex)
          all.push(...list)
        } catch (e: any) {
          console.error("Plex", e)
        }
      }
      if (cfg.cloud115.enabled && cfg.cloud115.cookie) {
        try {
          const list = await cloud115ListVideos(cfg.cloud115)
          all.push(...list)
        } catch (e: any) {
          console.error("115", e)
        }
      }
      for (const s of cfg.scripts.filter(x => x.enabled)) {
        try {
          const list = await loadScriptSource(s)
          all.push(...list)
        } catch (e: any) {
          console.error("script", s.name, e)
        }
      }
      setRemote(all)
      setStatus(all.length ? `已加载 ${all.length} 条远程媒体` : "暂无远程媒体（请先在设置中配置源）")
    } catch (e: any) {
      setStatus(e?.message || "同步失败")
    }
  }

  useEffect(() => {
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
    setStatus("已添加到媒体库")
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
      setStatus("本地视频已添加")
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
      })
    } catch (e: any) {
      await Dialog.alert({ title: "播放失败", message: e?.message || "无法播放" })
    } finally {
      refreshLocal()
    }
  }

  const playRemote = async (item: (typeof remote)[0]) => {
    try {
      let url = item.url
      if (item.sourceType === "115") {
        const cfg = loadSourcesConfig()
        const pick = item.extra?.pickCode
        if (!pick) throw new Error("缺少 pickCode")
        url = await cloud115GetPlayUrl(cfg.cloud115, pick)
      }
      if (!url) throw new Error("无播放地址")
      await presentPlayer({
        url,
        title: item.title,
        poster: item.poster,
        mediaId: item.id,
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

  const favorites = items.filter(i => i.isFavorite)
  const others = items.filter(i => !i.isFavorite)

  return (
    <List navigationTitle="媒体库" navigationBarTitleDisplayMode="large">
      <Section header={<Text textCase={null}>添加媒体</Text>}>
        <TextField
          title="标题（可选）"
          value={titleInput}
          onChanged={setTitleInput}
          prompt="留空则自动提取；配置 TMDB 可刮削"
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
              <HStack spacing={12} padding={{ vertical: 4 }}>
                <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity" }}>
                  <Text fontWeight="medium" lineLimit={2}>
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

      {favorites.length > 0 ? (
        <Section header={<Text textCase={null}>收藏</Text>}>
          {favorites.map(item => (
            <LocalRow
              key={item.id}
              item={item}
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
        header={<Text textCase={null}>{items.length > 0 ? "本地媒体库" : "本地媒体库为空"}</Text>}
        footer={items.length === 0 ? "添加 URL、本地文件，或在设置中配置 Emby/Plex/115/脚本源" : undefined}
      >
        {others.map(item => (
          <LocalRow
            key={item.id}
            item={item}
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
  )
}

function LocalRow({
  item,
  onPlay,
  onDelete,
  onToggleFavorite,
}: {
  item: MediaItem
  onPlay: () => void
  onDelete: () => void
  onToggleFavorite: () => void
}) {
  return (
    <HStack spacing={10} padding={{ vertical: 6 }}>
      <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity" }}>
        <Text fontWeight="medium" lineLimit={2}>
          {item.title}
        </Text>
        <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
          {item.sourceName || item.sourceType}
        </Text>
      </VStack>
      <Button title="播放" systemImage="play.fill" action={onPlay} />
      <Button
        systemImage={item.isFavorite ? "star.fill" : "star"}
        action={onToggleFavorite}
      />
      <Button systemImage="trash" foregroundStyle="systemRed" action={onDelete} />
    </HStack>
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
