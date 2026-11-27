import {
  Button,
  HStack,
  List,
  NavigationStack,
  Section,
  Text,
  TextField,
  VStack,
  useMemo,
  useState,
} from "scripting"
import { pageToolbar } from "./chrome"
import type { MediaItem, RemoteMedia } from "../types"
import { loadLibrary } from "../storage"
import { presentPlayer } from "../player"
import { loadSourcesConfig } from "../sources/config"
import { embySearch } from "../sources/emby"
import { plexSearch } from "../sources/plex"
import { loadScriptSource } from "../sources/scriptSource"
import { cloud115GetPlayUrl } from "../sources/cloud115"

export function SearchPage({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("")
  const [library, setLibrary] = useState<MediaItem[]>(() => loadLibrary())
  const [remote, setRemote] = useState<RemoteMedia[]>([])
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
    const all: RemoteMedia[] = []
    const errors: string[] = []

    try {
      if (cfg.emby.enabled && cfg.emby.accessToken) {
        try {
          all.push(...(await embySearch(cfg.emby, q)))
        } catch (e: any) {
          errors.push(`Emby: ${e?.message || e}`)
        }
      }
      if (cfg.plex.enabled && cfg.plex.token) {
        try {
          all.push(...(await plexSearch(cfg.plex, q)))
        } catch (e: any) {
          errors.push(`Plex: ${e?.message || e}`)
        }
      }
      for (const s of cfg.scripts.filter(x => x.enabled)) {
        try {
          all.push(...(await loadScriptSource(s, q)))
        } catch (e: any) {
          errors.push(`${s.name}: ${e?.message || e}`)
        }
      }
      setRemote(all)
      setStatus(
        errors.length
          ? `本地 ${localResults.length} · 远程 ${all.length}（${errors[0]}）`
          : `本地 ${localResults.length} · 远程 ${all.length}`
      )
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
      headers: item.headers,
    })
    setLibrary(loadLibrary())
  }

  const playRemote = async (item: RemoteMedia) => {
    try {
      let url = item.url
      let playHeaders = item.headers
      if (item.sourceType === "115") {
        const cfg = loadSourcesConfig()
        const got = await cloud115GetPlayUrl(cfg.cloud115, item.extra?.pickCode)
        url = got.url
        playHeaders = got.headers
      }
      await presentPlayer({
        url,
        title: item.title,
        mediaId: item.id,
        headers: playHeaders,
      })
    } catch (e: any) {
      setStatus(e?.message || "播放失败")
    }
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="搜索"
        navigationBarTitleDisplayMode="large"
        toolbar={pageToolbar(onClose)}
      >
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
    </NavigationStack>
  )
}
