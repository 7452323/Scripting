import {
  Button,
  Form,
  HStack,
  Image,
  List,
  Section,
  Text,
  TextField,
  VStack,
  useState,
  DocumentPicker,
  Dialog,
} from "scripting"
import type { MediaItem } from "../types"
import {
  addMediaItem,
  loadLibrary,
  removeMediaItem,
  toggleFavorite,
  updateMediaItem,
} from "../storage"
import { presentPlayer } from "../player"

export function LibraryPage() {
  const [items, setItems] = useState<MediaItem[]>(() => loadLibrary())
  const [urlInput, setUrlInput] = useState("")
  const [titleInput, setTitleInput] = useState("")

  const refresh = () => setItems(loadLibrary())

  const handleAddUrl = () => {
    const url = urlInput.trim()
    if (!url) {
      Dialog.alert({ title: "提示", message: "请输入有效的视频地址" })
      return
    }
    if (!/^https?:\/\//i.test(url) && !url.startsWith("file://")) {
      Dialog.alert({ title: "提示", message: "目前仅支持 http(s) 或 file:// 链接" })
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
    refresh()
  }

  const handlePickLocal = async () => {
    try {
      const result = await DocumentPicker.pick({
        type: ["public.movie", "public.video", "public.mpeg-4", "public.avi"],
        allowMultiple: false,
      })
      if (!result || result.length === 0) return
      const file = result[0]
      const path = file.path || file.url
      if (!path) return

      addMediaItem({
        title: file.name || extractTitleFromUrl(path),
        url: path.startsWith("file://") ? path : `file://${path}`,
        sourceType: "local",
        sourceName: "本地文件",
      })
      refresh()
    } catch (e) {
      console.error("选择文件失败:", e)
    }
  }

  const handlePlay = async (item: MediaItem) => {
    await presentPlayer({
      url: item.url,
      title: item.title,
      poster: item.poster,
      mediaId: item.id,
      startTime: item.playProgress,
    })
    refresh()
  }

  const handleDelete = (id: string) => {
    Dialog.confirm({
      title: "删除媒体",
      message: "确定要从媒体库中移除吗？",
      confirmTitle: "删除",
      cancelTitle: "取消",
    }).then(ok => {
      if (ok) {
        removeMediaItem(id)
        refresh()
      }
    })
  }

  const handleToggleFavorite = (id: string) => {
    toggleFavorite(id)
    refresh()
  }

  const favorites = items.filter(i => i.isFavorite)
  const others = items.filter(i => !i.isFavorite)

  return (
    <List navigationTitle="媒体库">
      <Section header="添加媒体">
        <TextField
          title="标题（可选）"
          value={titleInput}
          onChange={setTitleInput}
          placeholder="留空则自动从链接提取"
        />
        <TextField
          title="视频地址"
          value={urlInput}
          onChange={setUrlInput}
          placeholder="https://... 或选择本地文件"
        />
        <Button title="添加远程链接" systemImage="link.badge.plus" action={handleAddUrl} />
        <Button title="选择本地视频" systemImage="folder.badge.plus" action={handlePickLocal} />
      </Section>

      {favorites.length > 0 && (
        <Section header="收藏">
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
      )}

      <Section header={others.length > 0 ? "全部媒体" : "暂无媒体"}>
        {others.length === 0 && favorites.length === 0 ? (
          <Text foregroundStyle="secondary">添加远程 URL 或本地视频后会显示在这里</Text>
        ) : (
          others.map(item => (
            <MediaRow
              key={item.id}
              item={item}
              onPlay={() => handlePlay(item)}
              onDelete={() => handleDelete(item.id)}
              onToggleFavorite={() => handleToggleFavorite(item.id)}
            />
          ))
        )}
      </Section>
    </List>
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
    <HStack spacing={12} padding={{ vertical: 4 }}>
      <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity" }}>
        <Text font="body" fontWeight="medium" lineLimit={1}>
          {item.title}
        </Text>
        <Text font="caption" foregroundStyle="secondary" lineLimit={1}>
          {progressText}
        </Text>
      </VStack>
      <Button systemImage="play.fill" action={onPlay} />
      <Button
        systemImage={item.isFavorite ? "star.fill" : "star"}
        action={onToggleFavorite}
      />
      <Button systemImage="trash" role="destructive" action={onDelete} />
    </HStack>
  )
}

function extractTitleFromUrl(url: string): string {
  try {
    const name = decodeURIComponent(url.split("/").pop() || "")
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
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
  }
  return `${m}:${String(sec).padStart(2, "0")}`
}
