import {
  Button,
  List,
  Section,
  Text,
  HStack,
  VStack,
  useState,
  Dialog,
} from "scripting"
import type { PlaybackHistory } from "../types"
import { clearHistory, loadHistory } from "../storage"
import { presentPlayer } from "../player"

export function HistoryPage() {
  const [items, setItems] = useState<PlaybackHistory[]>(() => loadHistory())

  const refresh = () => setItems(loadHistory())

  const handlePlay = async (entry: PlaybackHistory) => {
    await presentPlayer({
      url: entry.url,
      title: entry.title,
      poster: entry.poster,
      mediaId: entry.mediaId,
      startTime: entry.progress > 5 ? entry.progress : 0,
    })
    refresh()
  }

  const handleClear = () => {
    Dialog.confirm({
      title: "清空历史",
      message: "确定要清空全部播放历史吗？",
      confirmTitle: "清空",
      cancelTitle: "取消",
    }).then(ok => {
      if (ok) {
        clearHistory()
        refresh()
      }
    })
  }

  return (
    <List navigationTitle="播放历史">
      <Section
        header="最近播放"
        footer={items.length === 0 ? "暂无播放记录" : undefined}
      >
        {items.length > 0 && (
          <Button
            title="清空历史"
            systemImage="trash"
            role="destructive"
            action={handleClear}
          />
        )}
        {items.map(entry => (
          <HStack
            key={`${entry.mediaId}_${entry.playedAt}`}
            spacing={12}
            padding={{ vertical: 4 }}
          >
            <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity" }}>
              <Text font="body" fontWeight="medium" lineLimit={1}>
                {entry.title}
              </Text>
              <Text font="caption" foregroundStyle="secondary">
                {formatTime(entry.progress)}
                {entry.duration > 0 ? ` / ${formatTime(entry.duration)}` : ""}
                {" · "}
                {formatDate(entry.playedAt)}
              </Text>
            </VStack>
            <Button systemImage="play.fill" action={() => handlePlay(entry)} />
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
  if (sameDay) {
    return `今天 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}
