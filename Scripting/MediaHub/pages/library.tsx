import {
  Button,
  Dialog,
  DocumentPicker,
  HStack,
  List,
  Navigation,
  NavigationStack,
  Section,
  Text,
  TextField,
  VStack,
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
import { buildPageToolbar } from "./toolbar"

export function LibraryPage() {
  const dismiss = Navigation.useDismiss()
  const [items, setItems] = useState<MediaItem[]>(() => loadLibrary())
  const [urlInput, setUrlInput] = useState("")
  const [titleInput, setTitleInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("")

  const refresh = () => setItems(loadLibrary())

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

    addMediaItem({
      title: titleInput.trim() || extractTitleFromUrl(url),
      url,
      sourceType: url.startsWith("file://") ? "local" : "url",
      sourceName: "手动添加",
    })
    setUrlInput("")
    setTitleInput("")
    setStatus("已添加到媒体库")
    refresh()
  }

  const handlePickLocal = async () => {
    if (busy) return
    setBusy(true)
    setStatus("")
    try {
      const paths = await DocumentPicker.pickFiles({
        types: ["public.movie", "public.video", "public.mpeg-4", "public.avi", "public.mpeg"],
        allowsMultipleSelection: false,
        shouldShowFileExtensions: true,
      })
      if (!paths || paths.length === 0) {
        setBusy(false)
        return
      }

      const path = paths[0]
      const fileUrl = path.startsWith("file://") ? path : `file://${path}`
      addMediaItem({
        title: extractTitleFromUrl(path),
        url: fileUrl,
        sourceType: "local",
        sourceName: "本地文件",
      })
      setStatus("本地视频已添加")
      refresh()
    } catch (e) {
      console.error("选择文件失败:", e)
      setStatus(e instanceof Error ? e.message : "无法打开文件选择器")
    } finally {
      setBusy(false)
    }
  }

  const handlePlay = async (item: MediaItem) => {
    try {
      await presentPlayer({
        url: item.url,
        title: item.title,
        poster: item.poster,
        mediaId: item.id,
        startTime: item.playProgress,
      })
    } catch (e) {
      console.error("播放失败:", e)
      await Dialog.alert({
        title: "播放失败",
        message: e instanceof Error ? e.message : "无法播放该媒体",
      })
    } finally {
      refresh()
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
      refresh()
    }
  }

  const handleToggleFavorite = (id: string) => {
    toggleFavorite(id)
    refresh()
  }

  const favorites = items.filter(i => i.isFavorite)
  const others = items.filter(i => !i.isFavorite)

  return (
    <NavigationStack>
      <List
        navigationTitle="媒体库"
        navigationBarTitleDisplayMode="large"
        toolbar={buildPageToolbar(dismiss)}
      >
        <Section header={<Text textCase={null}>添加媒体</Text>}>
          <TextField
            title="标题（可选）"
            value={titleInput}
            onChanged={setTitleInput}
            prompt="留空则自动从链接提取"
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
          {status ? (
            <Text font="caption" foregroundStyle="secondaryLabel">
              {status}
            </Text>
          ) : null}
        </Section>

        {favorites.length > 0 ? (
          <Section header={<Text textCase={null}>收藏</Text>}>
            {favorites.map(item => (
              <MediaRow
                key={item.id}
                item={item}
                onPlay={() => handlePlay(item)}
                onDelete={() => handleDelete(item.id)}
                onToggleFavorite={() => handleToggleFavorite(item.id)}
              />
            ))}
          </Section>
        ) : null}

        <Section
          header={<Text textCase={null}>{items.length > 0 ? "全部媒体" : "暂无媒体"}</Text>}
          footer={items.length === 0 ? "添加远程 URL 或本地视频后会显示在这里" : undefined}
        >
          {others.map(item => (
            <MediaRow
              key={item.id}
              item={item}
              onPlay={() => handlePlay(item)}
              onDelete={() => handleDelete(item.id)}
              onToggleFavorite={() => handleToggleFavorite(item.id)}
            />
          ))}
        </Section>
      </List>
    </NavigationStack>
  )
}

function MediaRow({
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
  const progressText =
    item.playProgress && item.duration
      ? `${formatTime(item.playProgress)} / ${formatTime(item.duration)}`
      : item.sourceName || item.sourceType

  return (
    <HStack spacing={10} padding={{ vertical: 6 }}>
      <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity" }}>
        <Text fontWeight="medium" lineLimit={2}>
          {item.title}
        </Text>
        <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
          {progressText}
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

function formatTime(seconds: number): string {
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
  return `${m}:${String(sec).padStart(2, "0")}`
}
