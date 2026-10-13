import { Button, HStack, Image, LazyVGrid, ScrollView, Text, VStack, ZStack, useEffect, useObservable, useRef, useState } from "scripting"
import { CATEGORIES, RANKS, category, rank, type CategoryTag, type Drama, type Page } from "../client"
import { ACCENT, Chip, gridColumns, LoadingState, PAGE_BOTTOM_PADDING, PAGE_PADDING, PageBackground, Pagination, SECTION_SPACING, SectionHeading, StateCard } from "../design"
import { CategoryPickerPage } from "./categories"
import { DramaCard, RankRowList } from "./components"
import { DetailPage } from "./detail"
import { BROWSE_RANK } from "./feed"

type Mode = "category" | "rank"
type Query = { mode: Mode; slug: string; tag: string; rankKey: string; page: number }

/**
 * 发现 = 浏览中心。频道 chip 由外层控制（首页的「更多」和顶栏的榜单都跳到这里）。
 * `channel` 为 "" 时落到第一个频道；为 BROWSE_RANK 时是榜单。
 */
export function DiscoverPage({ channel, nonce, onChannelChange, onLibraryChanged }: { channel: string; nonce: number; onChannelChange: (next: string) => void; onLibraryChanged: () => void }) {
  const browsing = channel || CATEGORIES[0].slug
  const mode: Mode = browsing === BROWSE_RANK ? "rank" : "category"
  const slug = mode === "category" ? browsing : CATEGORIES[0].slug

  const [tag, setTag] = useState("")
  const [tags, setTags] = useState<CategoryTag[]>([])
  const [rankKey, setRankKey] = useState(RANKS[0].key)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [items, setItems] = useState<Drama[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Drama | null>(null)
  const presented = useObservable(false)
  const pickerPresented = useObservable(false)
  const generation = useRef(0)
  // 从「全部分类」选中频道+题材时，把题材交给切换频道后的那次加载
  const pendingTag = useRef("")

  async function load(next: Query) {
    const current = ++generation.current
    setLoading(true); setError(null)
    try {
      let result: Page<Drama>
      if (next.mode === "rank") result = await rank(next.rankKey, next.page)
      else result = await category(next.slug, next.tag, next.page)
      if (current !== generation.current) return
      setTags((result as Page<Drama> & { tags?: CategoryTag[] }).tags ?? [])
      setItems(result.items)
      setPage(result.page)
      setTotalPages(result.totalPages)
    } catch (reason) {
      if (current === generation.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }

  // 频道由外层驱动：变了就重置题材、回到第 1 页重新加载。
  // ⚠️ nonce 必须进依赖：点「更多 / 榜单」时目标频道可能和当前一样，光看 browsing 不会重跑，
  //    用户就会停在旧榜单的第 N 页（看起来像按钮坏了）。
  useEffect(() => {
    const initial = pendingTag.current
    pendingTag.current = ""
    setTag(initial)
    const nextRankKey = mode === "rank" ? RANKS[0].key : rankKey
    if (mode === "rank") setRankKey(nextRankKey)
    void load({ mode, slug, tag: initial, rankKey: nextRankKey, page: 1 })
  }, [browsing, nonce])

  function switchTag(nextTag: string) {
    if (nextTag === tag) return
    setTag(nextTag)
    void load({ mode: "category", slug, tag: nextTag, rankKey, page: 1 })
  }
  function switchRank(nextKey: string) {
    if (nextKey === rankKey) return
    setRankKey(nextKey)
    void load({ mode: "rank", slug, tag, rankKey: nextKey, page: 1 })
  }
  function open(drama: Drama) { setSelected(drama); presented.setValue(true) }

  /** 从分类总览选了一个频道 + 题材：切过去并关掉总览页。 */
  function pickFromOverview(nextSlug: string, nextTag: string) {
    pickerPresented.setValue(false)
    if (nextSlug === browsing) {
      setTag(nextTag)
      void load({ mode: "category", slug: nextSlug, tag: nextTag, rankKey, page: 1 })
      return
    }
    pendingTag.current = nextTag
    onChannelChange(nextSlug)
  }

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
    <PageBackground />
    <ScrollView navigationTitle="发现" navigationBarTitleDisplayMode="large"
      refreshable={() => load({ mode, slug, tag, rankKey, page })}
      navigationDestination={{ isPresented: presented, content: selected ? <DetailPage drama={selected} onLibraryChanged={onLibraryChanged} /> : <VStack /> }}>
      <VStack key="discover-top" spacing={SECTION_SPACING} alignment="leading" padding={{ top: 4, bottom: PAGE_BOTTOM_PADDING }}>
        <VStack spacing={11} alignment="leading" frame={{ maxWidth: "infinity" }}>
          <ScrollView axes="horizontal" scrollIndicator="hidden">
            <HStack spacing={9} padding={{ horizontal: PAGE_PADDING }}>
              {CATEGORIES.map(item => <Chip key={item.slug} title={item.name} selected={browsing === item.slug} action={() => onChannelChange(item.slug)} />)}
              <Chip title="榜单" selected={browsing === BROWSE_RANK} action={() => onChannelChange(BROWSE_RANK)} />
            </HStack>
          </ScrollView>
          {mode === "category" ? <>
            <VStack spacing={9} alignment="leading" frame={{ maxWidth: "infinity" }}>
              <HStack spacing={8} padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                <Text font="footnote" fontWeight="semibold" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }}>
                  {tags.length ? "题材分类" : "题材分类（本频道暂无）"}
                </Text>
                <Button buttonStyle="plain" tint={ACCENT} action={() => pickerPresented.setValue(true)}
                  navigationDestination={{ isPresented: pickerPresented, content: <CategoryPickerPage current={{ slug, tag }} onPick={pickFromOverview} /> }}
                  accessibilityLabel="查看全部分类">
                  <HStack spacing={3}>
                    <Text font="footnote" fontWeight="medium">全部分类</Text>
                    <Image systemName="chevron.right" font="caption2" />
                  </HStack>
                </Button>
              </HStack>
              {tags.length ? <ScrollView axes="horizontal" scrollIndicator="hidden">
                <HStack spacing={9} padding={{ horizontal: PAGE_PADDING }}>
                  <Chip title="全部" selected={!tag} secondary disabled={loading} action={() => switchTag("")} />
                  {tags.map(item => <Chip key={item.slug} title={item.name} selected={item.slug === tag} secondary disabled={loading} action={() => switchTag(item.slug)} />)}
                </HStack>
              </ScrollView> : undefined}
            </VStack>
          </> : <ScrollView axes="horizontal" scrollIndicator="hidden">
            <HStack spacing={9} padding={{ horizontal: PAGE_PADDING }}>
              {RANKS.map(item => <Chip key={item.key} title={item.name} selected={item.key === rankKey} secondary disabled={loading} action={() => switchRank(item.key)} />)}
            </HStack>
          </ScrollView>}
        </VStack>

        {loading && !items.length ? <LoadingState title="正在加载内容" minHeight={400} />
          : error && !items.length ? <VStack padding={{ horizontal: PAGE_PADDING }}><StateCard title="加载失败" description={error} systemImage="wifi.exclamationmark" tint="systemRed" actionTitle="重新加载" action={() => { void load({ mode, slug, tag, rankKey, page }) }} /></VStack>
          : !items.length ? <VStack padding={{ horizontal: PAGE_PADDING }}>
            <StateCard title="没有更多内容了" description="已经翻到最后一页。红果返回的总页数是个固定值，以实际结果为准。" systemImage="rectangle.stack.badge.minus" actionTitle="回到第 1 页" action={() => { void load({ mode, slug, tag, rankKey, page: 1 }) }} />
          </VStack>
          : mode === "rank" ? <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity" }} padding={{ horizontal: PAGE_PADDING }}>
            <SectionHeading title={`${RANKS.find(r => r.key === rankKey)?.name ?? ""}榜单`} subtitle="按站内热度排序 · 红果榜单只提供 5 页共 100 部" />
            <RankRowList items={items} onOpen={open} />
          </VStack>
          : <VStack spacing={14} alignment="leading" padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity" }}>
            <LazyVGrid columns={gridColumns()} alignment="leading" spacing={16} frame={{ maxWidth: "infinity", alignment: "leading" }}>
              {items.map(drama => <DramaCard key={drama.id} drama={drama} onOpen={open} />)}
            </LazyVGrid>
          </VStack>}

        {error && items.length ? <VStack padding={{ horizontal: PAGE_PADDING }}><StateCard title="刷新失败" description="正在显示上次成功加载的内容。" systemImage="exclamationmark.arrow.triangle.2.circlepath" tint="systemOrange" actionTitle="重试" action={() => { void load({ mode, slug, tag, rankKey, page }) }} /></VStack> : undefined}
        {items.length && mode === "category" ? <VStack padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity" }}>
          <Pagination page={page} hasNext={page < totalPages} loading={loading} onPrevious={() => { void load({ mode, slug, tag, rankKey, page: page - 1 }) }} onNext={() => { void load({ mode, slug, tag, rankKey, page: page + 1 }) }} />
          <Text font="caption" foregroundStyle="tertiaryLabel" frame={{ maxWidth: "infinity" }} multilineTextAlignment="center">{`共 ${totalPages} 页`}</Text>
        </VStack> : undefined}
      </VStack>
    </ScrollView>
  </ZStack>
}
