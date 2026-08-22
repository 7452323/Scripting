import { Button, HStack, Image, NavigationLink, NavigationStack, ScrollView, Text, TextField, VStack, useEffect, useRef, useState } from "scripting"
import { moonClient, SearchResult } from "../client"
import { DetailView } from "./home"
import { ACCENT, PAGE_PADDING, PAGE_BOTTOM_PADDING, LoadingState } from "../design"
import { getSearchHistory, addSearchHistory, clearSearchHistory } from "../storage"

// ===== Result Row =====
function ResultRow({ result }: { result: SearchResult }) {
  return (
    <NavigationLink
      destination={<DetailView resource={result} id={result.id} source={result.source} title={result.title} poster={result.poster} />}
    >
      <HStack
        spacing={10}
        padding={10}
        background="secondarySystemBackground"
        clipShape={{ type: "rect", cornerRadius: 12, style: "continuous" }}
      >
        <Image
          imageUrl={moonClient.resolvePosterUrl(result.poster)}
          resizable={true}
          frame={{ width: 70, height: 100 }}
          clipShape={{ type: "rect", cornerRadius: 8, style: "continuous" }}
        />
        <VStack spacing={4} frame={{ maxWidth: "infinity" }}>
          <Text font="subheadline" fontWeight="semibold" lineLimit={2}>
            {result.title}
          </Text>
          <HStack spacing={6}>
            <Text foregroundStyle="secondaryLabel" font="caption">{result.type_name || ""}</Text>
            {result.year ? <Text foregroundStyle="secondaryLabel" font="caption">{result.year}</Text> : null}
          </HStack>
          <Text foregroundStyle={ACCENT} font="caption">{result.source_name}</Text>
        </VStack>
        <Text foregroundStyle="tertiaryLabel" font="body">›</Text>
      </HStack>
    </NavigationLink>
  )
}

// ===== SearchView =====
export default function SearchView() {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState("")
  const [progress, setProgress] = useState({ completed: 0, total: 0 })
  const [history, setHistory] = useState<string[]>(getSearchHistory())
  const searchRequestId = useRef(0)

  const doSearch = async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) return
    const requestId = ++searchRequestId.current
    setLoading(true)
    setError("")
    setResults([])
    setSearched(true)
    setProgress({ completed: 0, total: 0 })
    try {
      await moonClient.searchProgressively(trimmed, (added, completed, total) => {
        if (requestId !== searchRequestId.current) return
        if (added.length > 0) setResults(prev => [...prev, ...added])
        setProgress({ completed, total })
      }, false, () => requestId !== searchRequestId.current)
      if (requestId === searchRequestId.current) {
        addSearchHistory(trimmed)
        setHistory(getSearchHistory())
      }
    } catch (e: any) {
      if (requestId === searchRequestId.current) setError(e.message || "资源查找失败")
    }
    if (requestId === searchRequestId.current) setLoading(false)
  }

  return (
    <NavigationStack>
      <VStack navigationTitle="搜索" navigationBarTitleDisplayMode="large">
        {/* Search Bar */}
        <HStack padding={{ horizontal: PAGE_PADDING, top: 12, bottom: 8 }} spacing={10}>
          <HStack
            spacing={8}
            frame={{ maxWidth: "infinity" }}
            padding={{ vertical: 8, horizontal: 12 }}
            background="secondarySystemBackground"
            clipShape={{ type: "rect", cornerRadius: 12, style: "continuous" }}
          >
            <Text foregroundStyle={ACCENT} font="body">🔍</Text>
            <TextField
              title="搜索"
              value={query}
              prompt="搜索电影、剧集、动漫..."
              onChanged={(value: string) => setQuery(value)}
              onSubmit={() => doSearch(query)}
              frame={{ maxWidth: "infinity" }}
            />
            {query.length > 0 ? (
              <Button
                title="✕"
                action={() => { setQuery(""); setResults([]); setSearched(false) }}
              />
            ) : null}
          </HStack>
          <Button
            title="搜索"
            tint={ACCENT}
            action={() => doSearch(query)}
          />
        </HStack>

        {/* Content */}
        <ScrollView padding={{ horizontal: PAGE_PADDING, bottom: PAGE_BOTTOM_PADDING + 40 }}>
          {error ? (
            <Text foregroundStyle="systemRed" font="subheadline" padding={{ top: 40 }}>{error}</Text>
          ) : loading && results.length === 0 ? (
            <LoadingState title="资源查找中..." />
          ) : searched && results.length === 0 ? (
            <Text foregroundStyle="secondaryLabel" font="subheadline" padding={{ top: 40 }}>
              未找到相关资源
            </Text>
          ) : results.length > 0 ? (
            <VStack padding={{ top: 12 }} spacing={10}>
              {results.map((r, i) => (
                <ResultRow key={`${r.source}-${r.id}-${i}`} result={r} />
              ))}
              {loading ? <Text font="caption" foregroundStyle="secondaryLabel">仍在查找其他资源 · {progress.completed}/{progress.total}</Text> : null}
            </VStack>
          ) : (
            /* Search History */
            <VStack padding={{ top: 16 }} spacing={10}>
              {history.length > 0 ? (
                <>
                  <HStack>
                    <Text font="subheadline" fontWeight="semibold" frame={{ maxWidth: "infinity" }}>搜索历史</Text>
                    <Button
                      title="清除"
                      action={() => { clearSearchHistory(); setHistory([]) }}
                    />
                  </HStack>
                  <HStack spacing={8}>
                    {history.map((h, i) => (
                      <Button
                        key={i}
                        title={h}
                        action={() => { setQuery(h); doSearch(h) }}
                      />
                    ))}
                  </HStack>
                </>
              ) : (
                <Text foregroundStyle="secondaryLabel" font="subheadline" padding={{ top: 20 }}>
                  输入关键词搜索
                </Text>
              )}
            </VStack>
          )}
        </ScrollView>
      </VStack>
    </NavigationStack>
  )
}
