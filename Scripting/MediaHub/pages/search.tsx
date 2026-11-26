import {
  Button,
  HStack,
  List,
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
import { loadSourcesConfig } from "../sources/config"
import { embySearch } from "../sources/emby"
import { plexSearch } from "../sources/plex"
import { loadScriptSource } from "../sources/scriptSource"
import { cloud115GetPlayUrl } from "../sources/cloud115"

export function SearchPage() {
  const [query, setQuery] = useState("")
  const [library, setLibrary] = useState<MediaItem[]>(() => loadLibrary())
  const [remote, setRemote] = useState<
    Array<{ id: string; title: string; url: string; sourceName: string; sourceType: string; extra?: any }>
  >([])
  const [searching, setSearching] = useState(false)
  const [status, setStatus] = useState("")

  const localResults = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return library.filter(item => {
      const title = (item.title || "").toLowerCase()
      const source = (item.sourceName || item.sourceType || "").toLowerCase()
      const url = (item.url || "").toLowerCase()
      return title.includes(q) || source.includes(q) || url.includes(q)
    })
  }, [query, library])

  const runSearch = async () => {
    const q = query.trim()
    if (!q) {
      setStatus("请输入关键词")
      return
    }
    setSearching(true)
    setStatus("搜索中...")
    const cfg = loadSourcesConfig()
    const all: typeof remote = []
    try {
      if (cfg.emby.enabled && cfg.emby.accessToken) {
        try {
          all.push(...(await embySearch(cfg.emby, q)))
        } catch (e) {
          console.error(e)
        }
      }
      if (cfg.plex.enabled && cfg.plex.token) {
        try {
          all.push(...(await plexSearch(cfg.plex, q)))
        } catch (e) {
          console.error(e)
        }
      }
      for (const s of cfg.scripts.filter(x => x.enabled)) {
        try {
          all.push(...(await loadScriptSource(s, q)))
        } catch (e) {
          console.error(e)
        }
      }
      setRemote(all)
      setStatus(`本地 ${localResults.length} · 远程 ${all.length}`)
    } finally {
      setSearching(false)
      setLibrary(loadLibrary())
    }
  }

  const playLocal = async (item: MediaItem) => {
    await presentPlayer({
      url: item.url,
      title: item.title,
      mediaId: item.id,
      startTime: item.playProgress,
    })
    setLibrary(loadLibrary())
  }

  const playRemote = async (item: (typeof remote)[0]) => {
    try {
      let url = item.url
      if (item.sourceType === "115") {
        const cfg = loadSourcesConfig()
        url = await cloud115GetPlayUrl(cfg.cloud115, item.extra?.pickCode)
      }
      await presentPlayer({ url, title: item.title, mediaId: item.id })
    } catch (e: any) {
      setStatus(e?.message || "播放失败")
    }
  }

  return (
    <List navigationTitle="搜索" navigationBarTitleDisplayMode="large">
      <Section header={<Text textCase={null}>关键词</Text>}>
        <TextField
          title="搜索"
          value={query}
          onChanged={setQuery}
          prompt="标题 / Emby / Plex / 脚本源"
        />
        <Button
          title={searching ? "搜索中..." : "搜索全部源"}
          systemImage="magnifyingglass"
          action={runSearch}
        />
        {status ? (
          <Text font="caption" foregroundStyle="secondaryLabel">
            {status}
          </Text>
        ) : null}
      </Section>

      <Section header={<Text textCase={null}>本地结果 ({localResults.length})</Text>}>
        {localResults.map(item => (
          <Button key={item.id} action={() => playLocal(item)}>
            <HStack spacing={12} padding={{ vertical: 4 }}>
              <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity" }}>
                <Text fontWeight="medium" lineLimit={2}>
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

      <Section header={<Text textCase={null}>远程结果 ({remote.length})</Text>}>
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
    </List>
  )
}
