import { Button, HStack, Image, NavigationLink, NavigationStack, ScrollView, Text, TextField, VStack, useEffect, useState } from "scripting"
import { DuanjuCategory, DuanjuSource, moonClient, SearchResult } from "../client"
import { ACCENT, COVER_RADIUS, PAGE_PADDING, LoadingState } from "../design"
import { DetailView } from "./home"

export default function FeaturesView() {
  return <NavigationStack>
    <ScrollView navigationTitle="更多" navigationBarTitleDisplayMode="large" padding={{ horizontal: PAGE_PADDING }} contentMargins={{ edges: "bottom", insets: 0, placement: "scrollContent" }} ignoresSafeArea={{ regions: "container", edges: "bottom" }}> 
      <VStack spacing={14} padding={{ top: 12 }}>
        <FeatureLink title="AI 影视助手" subtitle="问剧情、找影片、获取观影建议" icon="sparkles" destination={<AIAssistantView />} />
        <FeatureLink title="独立短剧频道" subtitle="按采集源与短剧分类浏览完整内容" icon="rectangle.stack.fill" destination={<DuanjuBrowserView />} />
      </VStack>
    </ScrollView>
  </NavigationStack>
}

function FeatureLink({ title, subtitle, icon, destination }: { title: string; subtitle: string; icon: string; destination: any }) {
  return <NavigationLink destination={destination}>
    <HStack spacing={14} padding={16} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 16, style: "continuous" }}>
      <Image systemName={icon} font="title2" foregroundStyle={ACCENT} frame={{ width: 42, height: 42 }} />
      <VStack spacing={4} frame={{ maxWidth: "infinity" }}>
        <Text font="headline" fontWeight="semibold">{title}</Text>
        <Text font="subheadline" foregroundStyle="secondaryLabel">{subtitle}</Text>
      </VStack>
      <Text foregroundStyle="tertiaryLabel">›</Text>
    </HStack>
  </NavigationLink>
}

function AIAssistantView() {
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const ask = async () => {
    const value = question.trim()
    if (!value || loading) return
    setLoading(true); setError(""); setAnswer("")
    try { setAnswer(await moonClient.askAI(value)) }
    catch (e: any) { setError(e.message || "AI 请求失败") }
    setLoading(false)
  }
  return <VStack navigationTitle="AI 影视助手" padding={{ horizontal: PAGE_PADDING }} ignoresSafeArea={{ regions: "container", edges: "bottom" }}> 
    <HStack spacing={8} padding={{ vertical: 12 }}>
      <TextField title="问题" value={question} prompt="想看什么，或询问一部影片…" onChanged={setQuestion} onSubmit={ask} frame={{ maxWidth: "infinity" }} />
      <Button title={loading ? "思考中" : "发送"} systemImage="paperplane.fill" tint={ACCENT} action={ask} />
    </HStack>
    <ScrollView>
      {loading ? <LoadingState title="AI 正在整理答案..." /> : error ? <Text foregroundStyle="systemRed" padding={{ top: 20 }}>{error}</Text> : answer ? <Text font="body" padding={16} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 16, style: "continuous" }}>{answer}</Text> : <VStack spacing={12} padding={{ top: 40 }}><Image systemName="sparkles" font="largeTitle" foregroundStyle={ACCENT} /><Text foregroundStyle="secondaryLabel">可以询问推荐、剧情、演员或同类型影片</Text></VStack>}
    </ScrollView>
  </VStack>
}

function DuanjuBrowserView() {
  const [sources, setSources] = useState<DuanjuSource[]>([])
  const [categories, setCategories] = useState<DuanjuCategory[]>([])
  const [source, setSource] = useState("")
  const [category, setCategory] = useState("")
  const [items, setItems] = useState<SearchResult[]>([])
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    moonClient.getDuanjuSources().then(list => {
      setSources(list)
      if (list[0]) selectSource(list[0].key)
      else setLoading(false)
    }).catch(e => { setError(e.message || "加载短剧源失败"); setLoading(false) })
  }, [])

  const selectSource = async (key: string) => {
    setSource(key); setCategory(""); setItems([]); setLoading(true); setError("")
    try {
      const list = await moonClient.getDuanjuCategories(key)
      setCategories(list)
      if (list[0]) await selectCategory(key, list[0].id)
      else setLoading(false)
    } catch (e: any) { setError(e.message || "加载分类失败"); setLoading(false) }
  }

  const selectCategory = async (sourceKey: string, categoryId: string) => {
    setCategory(categoryId); setItems([]); setLoading(true); setError("")
    try {
      const result = await moonClient.getDuanjuVideos(sourceKey, categoryId, 1)
      setItems(result.items); setPage(result.page); setPageCount(result.pageCount)
    } catch (e: any) { setError(e.message || "加载短剧失败") }
    setLoading(false)
  }

  const loadMore = async () => {
    if (loading || page >= pageCount) return
    setLoading(true)
    try { const result = await moonClient.getDuanjuVideos(source, category, page + 1); setItems(prev => [...prev, ...result.items]); setPage(result.page); setPageCount(result.pageCount) }
    catch (e: any) { setError(e.message || "加载更多失败") }
    setLoading(false)
  }

  return <ScrollView navigationTitle="独立短剧" contentMargins={{ edges: "bottom", insets: 0, placement: "scrollContent" }} ignoresSafeArea={{ regions: "container", edges: "bottom" }}>
    <Text font="headline" padding={{ horizontal: PAGE_PADDING, top: 12 }}>采集源</Text>
    <ScrollView axes="horizontal" padding={{ horizontal: PAGE_PADDING, vertical: 8 }}><HStack spacing={8}>{sources.map(item => <Button key={item.key} title={item.name} tint={source === item.key ? ACCENT : undefined} action={() => selectSource(item.key)} />)}</HStack></ScrollView>
    {categories.length ? <><Text font="headline" padding={{ horizontal: PAGE_PADDING, top: 8 }}>分类</Text><ScrollView axes="horizontal" padding={{ horizontal: PAGE_PADDING, vertical: 8 }}><HStack spacing={8}>{categories.map(item => <Button key={item.id} title={item.name} tint={category === item.id ? ACCENT : undefined} action={() => selectCategory(source, item.id)} />)}</HStack></ScrollView></> : null}
    {error ? <Text foregroundStyle="systemRed" padding={{ horizontal: PAGE_PADDING, top: 20 }}>{error}</Text> : items.length === 0 && loading ? <LoadingState title="加载短剧频道..." /> : <DuanjuGrid items={items} />}
    {items.length > 0 && page < pageCount ? <Button title={loading ? "加载中..." : "加载更多"} action={loadMore} padding={{ vertical: 18 }} /> : null}
  </ScrollView>
}

function DuanjuGrid({ items }: { items: SearchResult[] }) {
  const rows: SearchResult[][] = []
  for (let i = 0; i < items.length; i += 3) rows.push(items.slice(i, i + 3))
  return <VStack spacing={16} padding={{ horizontal: PAGE_PADDING, top: 10 }}>
    {rows.map((row, r) => <HStack key={r} spacing={12}>{row.map(item => <NavigationLink key={`${item.source}-${item.id}`} destination={<DetailView resource={item} id={item.id} source={item.source} title={item.title} poster={item.poster} />}><VStack frame={{ width: 104 }} spacing={6}><Image imageUrl={moonClient.resolvePosterUrl(item.poster)} resizable={true} scaleToFill={true} frame={{ width: 104, height: 150 }} clipShape={{ type: "rect", cornerRadius: COVER_RADIUS, style: "continuous" }} /><Text font="caption" fontWeight="medium" lineLimit={2}>{item.title}</Text><Text font="caption2" foregroundStyle="secondaryLabel">{item.episodes.length} 集</Text></VStack></NavigationLink>)}</HStack>)}
  </VStack>
}
