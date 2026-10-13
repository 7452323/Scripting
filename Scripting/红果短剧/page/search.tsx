import { Button, HStack, Image, LazyVGrid, ScrollView, Text, TextField, VStack, ZStack, useObservable, useRef, useState } from "scripting"
import { search, type Drama } from "../client"
import { ACCENT, LoadingState, PAGE_BOTTOM_PADDING, PAGE_PADDING, PageBackground, SectionHeading, StateCard } from "../design"
import { DramaArtwork, DramaRowList } from "./components"
import { DetailPage } from "./detail"

export function SearchPage({ onLibraryChanged }: { onLibraryChanged: () => void }) {
  const [query, setQuery] = useState("")
  const [items, setItems] = useState<Drama[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Drama | null>(null)
  const presented = useObservable(false)
  const generation = useRef(0)

  /** explicit 用于「试试这些」快捷词：以前那条路径不设 loading、也没有 generation 守卫，
   *  连点两个词会先发的慢响应后落（显示错的结果），失败还是静默的。 */
  async function run(explicit?: string) {
    const word = (explicit ?? query).trim()
    if (!word || loading) return
    const token = ++generation.current
    setLoading(true); setSearched(true); setError(null)
    try {
      const result = await search(word)
      if (token !== generation.current) return
      setItems(result)
    } catch (reason) {
      if (token !== generation.current) return
      setError(reason instanceof Error ? reason.message : String(reason))
      setItems([])
    } finally {
      if (token === generation.current) setLoading(false)
    }
  }
  function open(drama: Drama) { setSelected(drama); presented.setValue(true) }

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
    <PageBackground />
    <ScrollView navigationTitle="搜索" navigationBarTitleDisplayMode="large"
      navigationDestination={{ isPresented: presented, content: selected ? <DetailPage drama={selected} onLibraryChanged={onLibraryChanged} /> : <VStack /> }}>
      <VStack spacing={20} alignment="leading" padding={{ horizontal: PAGE_PADDING, top: 8, bottom: PAGE_BOTTOM_PADDING }}>
        <VStack spacing={10} alignment="leading" frame={{ maxWidth: "infinity" }}>
          <SectionHeading title="查找短剧" subtitle="输入剧名关键词，直接从红果站内检索。" />
          <TextField title="搜索短剧" prompt="输入短剧名称" value={query} onChanged={setQuery} onSubmit={() => { void run() }} frame={{ maxWidth: "infinity" }} />
          <Button action={() => { void run() }} disabled={!query.trim() || loading} tint={ACCENT} frame={{ maxWidth: "infinity", minHeight: 44 }} accessibilityLabel={loading ? "正在搜索" : "搜索短剧"}>
            <HStack spacing={8}><Image systemName="magnifyingglass" /><Text fontWeight="semibold">{loading ? "正在搜索" : "搜索"}</Text></HStack>
          </Button>
        </VStack>
        {loading ? <LoadingState title="正在搜索短剧" minHeight={220} />
          : error ? <StateCard title="搜索失败" description={error} systemImage="wifi.exclamationmark" tint="systemRed" actionTitle="重试" action={() => { void run() }} />
          : searched && !items.length ? <StateCard title="没有找到短剧" description="换个关键词，或缩短剧名再试一次。" systemImage="magnifyingglass" />
          : items.length ? <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity" }}>
            <SectionHeading title="搜索结果" subtitle={`找到 ${items.length} 部相关短剧`} />
            <DramaRowList items={items} onOpen={open} />
          </VStack>
          : <VStack spacing={14} alignment="leading" frame={{ maxWidth: "infinity" }}>
            <SectionHeading title="试试这些" subtitle="红果站内热播关键词" />
            <LazyVGrid columns={[{ size: { type: "flexible" }, spacing: 12 }, { size: { type: "flexible" }, spacing: 12 }]} alignment="leading" spacing={12} frame={{ maxWidth: "infinity" }}>
              {["逆袭", "穿越", "萌宝", "豪门", "悬疑", "甜宠"].map(word =>
                <Button key={word} title={word} buttonStyle="bordered" frame={{ maxWidth: "infinity", minHeight: 44 }} action={() => { setQuery(word); void run(word) }} />
              )}
            </LazyVGrid>
            <StateCard title="搜索短剧" description="搜索结果会显示在这里。" systemImage="text.magnifyingglass" />
          </VStack>}
      </VStack>
    </ScrollView>
  </ZStack>
}
