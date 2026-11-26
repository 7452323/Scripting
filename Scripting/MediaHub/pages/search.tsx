import {
  Button,
  HStack,
  List,
  Navigation,
  NavigationStack,
  Section,
  Text,
  TextField,
  VStack,
  useMemo,
  useState,
} from "scripting"
import type { MediaItem } from "../types"
import { loadLibrary } from "../storage"
import { presentPlayer } from "../player"
import { buildPageToolbar } from "./toolbar"

export function SearchPage() {
  const dismiss = Navigation.useDismiss()
  const [query, setQuery] = useState("")
  const [library, setLibrary] = useState<MediaItem[]>(() => loadLibrary())

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return library.filter(item => {
      const title = (item.title || "").toLowerCase()
      const source = (item.sourceName || item.sourceType || "").toLowerCase()
      const url = (item.url || "").toLowerCase()
      return title.includes(q) || source.includes(q) || url.includes(q)
    })
  }, [query, library])

  const handlePlay = async (item: MediaItem) => {
    try {
      await presentPlayer({
        url: item.url,
        title: item.title,
        mediaId: item.id,
        startTime: item.playProgress,
      })
    } catch (e) {
      console.error(e)
    } finally {
      setLibrary(loadLibrary())
    }
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="搜索"
        navigationBarTitleDisplayMode="large"
        toolbar={buildPageToolbar(dismiss)}
      >
        <Section header={<Text textCase={null}>关键词</Text>}>
          <TextField
            title="搜索"
            value={query}
            onChanged={setQuery}
            prompt="按标题、来源或链接搜索"
          />
        </Section>

        <Section
          header={
            <Text textCase={null}>
              {query.trim() ? `结果 ${results.length}` : "输入关键词开始搜索"}
            </Text>
          }
          footer={
            query.trim() && results.length === 0
              ? "媒体库中没有匹配的内容"
              : undefined
          }
        >
          {results.map(item => (
            <Button key={item.id} action={() => handlePlay(item)}>
              <HStack spacing={12} padding={{ vertical: 4 }}>
                <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity" }}>
                  <Text fontWeight="medium" lineLimit={2}>
                    {item.title}
                  </Text>
                  <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
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
    </NavigationStack>
  )
}
