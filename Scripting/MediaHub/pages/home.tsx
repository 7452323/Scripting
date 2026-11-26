import {
  Button,
  HStack,
  List,
  Navigation,
  NavigationStack,
  Section,
  Text,
  VStack,
  useState,
} from "scripting"
import type { MediaItem, PlaybackHistory } from "../types"
import { loadHistory, loadLibrary } from "../storage"
import { presentPlayer } from "../player"
import { buildPageToolbar } from "./toolbar"

export function HomePage() {
  const dismiss = Navigation.useDismiss()
  const [library, setLibrary] = useState<MediaItem[]>(() => loadLibrary())
  const [history, setHistory] = useState<PlaybackHistory[]>(() => loadHistory())

  const refresh = () => {
    setLibrary(loadLibrary())
    setHistory(loadHistory())
  }

  const recent = history.slice(0, 8)
  const favorites = library.filter(i => i.isFavorite).slice(0, 8)
  const latest = library.slice(0, 8)

  const playItem = async (
    url: string,
    title: string,
    mediaId?: string,
    startTime?: number
  ) => {
    try {
      await presentPlayer({ url, title, mediaId, startTime })
    } catch (e) {
      console.error(e)
    } finally {
      refresh()
    }
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="MediaHub"
        navigationBarTitleDisplayMode="large"
        toolbar={buildPageToolbar(dismiss, [
          <Button key="refresh" systemImage="arrow.clockwise" action={refresh} />,
        ])}
      >
        <Section
          header={<Text textCase={null}>继续观看</Text>}
          footer={recent.length === 0 ? "播放后会显示在这里" : undefined}
        >
          {recent.map(entry => (
            <Button
              key={`${entry.mediaId}_${entry.playedAt}`}
              action={() =>
                playItem(
                  entry.url,
                  entry.title,
                  entry.mediaId,
                  entry.progress > 5 ? entry.progress : 0
                )
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

        <Section
          header={<Text textCase={null}>收藏</Text>}
          footer={favorites.length === 0 ? "在媒体库中点星标收藏" : undefined}
        >
          {favorites.map(item => (
            <Button
              key={item.id}
              action={() => playItem(item.url, item.title, item.id, item.playProgress)}
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
          footer={latest.length === 0 ? "去「媒体库」添加视频" : undefined}
        >
          {latest.map(item => (
            <Button
              key={item.id}
              action={() => playItem(item.url, item.title, item.id, item.playProgress)}
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

        <Section header={<Text textCase={null}>快捷说明</Text>}>
          <VStack alignment="leading" spacing={6} padding={{ vertical: 8 }}>
            <Text font="subheadline">1. 在「媒体库」添加远程 URL 或本地视频</Text>
            <Text font="subheadline">2. 在「搜索」里按标题快速查找</Text>
            <Text font="subheadline">3. 点击条目即可用系统播放器播放</Text>
            <Text font="caption" foregroundStyle="secondaryLabel" padding={{ top: 4 }}>
              后续版本将接入 Emby / Plex / 115 / 脚本源
            </Text>
          </VStack>
        </Section>
      </List>
    </NavigationStack>
  )
}

function formatTime(seconds: number): string {
  const s = Math.floor(seconds || 0)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, "0")}`
}
