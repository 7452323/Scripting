import {
  Button,
  Dialog,
  HStack,
  List,
  Section,
  Text,
  VStack,
  useState,
} from "scripting"
import type { PlaybackHistory } from "../types"
import { clearHistory, loadHistory } from "../storage"
import { presentPlayer } from "../player"

export function HistoryPage() {
  const [items, setItems] = useState<PlaybackHistory[]>(() => loadHistory())

  const refresh = () => setItems(loadHistory())

  const handlePlay = async (entry: PlaybackHistory) => {
    try {
      await presentPlayer({
        url: entry.url,
        title: entry.title,
        poster: entry.poster,
        mediaId: entry.mediaId,
        startTime: entry.progress > 5 ? entry.progress : 0,
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

  const handleClear = async () => {
    const ok = await Dialog.confirm({
      title: "清空历史",
      message: "确定要清空全部播放历史吗？",
      confirmLabel: "清空",
      cancelLabel: "取消",
    })
    if (ok) {
      clearHistory()
      refresh()
    }
  }

  return (
    <List
      navigationTitle="播放历史"
      navigationBarTitleDisplayMode="large"
    >
      <Section
        header="最近播放"
        footer={items.length === 0 ? "暂无播放记录，播放媒体后会出现在这里" : undefined}
      >
        {items.length > 0 ? (
          <Button
            title="清空历史"
            systemImage="trash"
            tint="systemRed"
            action={handleClear}
          />
        ) : null}

        {items.map(entry => (
          <HStack
            key={`${entry.mediaId}_${entry.playedAt}`}
            spacing={12}
            padding={{ vertical: 6 }}
          >
            <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity" }}>
              <Text font="body" fontWeight="medium" lineLimit={2}>
                {entry.title}
              </Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                {formatTime(entry.progress)}
                {entry.duration > 0 ? ` / ${formatTime(entry.duration)}` : ""}
                {" · "}
                {formatDate(entry.playedAt)}
              </Text>
            </VStack>
            <Button title="继续" systemImage="play.fill" action={() => handlePlay(entry)} />
          </HStack>
        ))}
      </Section>
    </List>
  )
}

function formatTime(seconds: number): string {
  const s = Math.floor(seconds)
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
