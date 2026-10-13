import { HStack, Image, LazyVGrid, ScrollView, Text, VStack, useEffect, useRef, useState } from "scripting"
import { CATEGORIES, category, rank, type CategoryTag, type Drama } from "../client"
import { ACCENT, Chip, gridColumns, LoadingState, PAGE_PADDING, Pagination, SectionHeading, StateCard } from "../design"
import { DramaCard, DramaRowList } from "./components"

/** 一段可分页的内容流：要么是某个频道（带题材筛选），要么是某个榜单。 */
export type FeedTarget = { mode: "category" | "rank"; slug: string; rankKey: string; note: string }

/** 「浏览频道」里代表榜单的伪 slug（榜单不是真频道，但它出现在同一排 chip 里）。 */
export const BROWSE_RANK = "__rank"

export function channelName(slug: string): string {
  return CATEGORIES.find(item => item.slug === slug)?.name ?? "该频道"
}

/** 把「频道 slug / BROWSE_RANK」翻译成内容流目标。 */
export function feedTargetFor(channel: string): FeedTarget {
  return channel === BROWSE_RANK
    // 红果榜单只给 5 页 × 20 条 = 100 部，第 6 页直接 404（实测）
    ? { mode: "rank", slug: "", rankKey: "hot-drama", note: "全类型按站内热度排序 · 红果榜单只提供 5 页共 100 部，第 6 页起 404" }
    : { mode: "category", slug: channel, rankKey: "", note: `${channelName(channel)}频道的全部内容` }
}

/**
 * 频道 / 榜单的完整列表体（不含 ScrollView 与导航栏），
 * 首页频道视图和「更多」页共用同一份实现。
 * 切换频道时请给组件加 `key`，让它重新挂载并重新加载。
 */
export function DramaFeed({ target, onOpen, onCount }: { target: FeedTarget; onOpen: (drama: Drama) => void; onCount?: (totalPages: number) => void }) {
  const [items, setItems] = useState<Drama[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [tags, setTags] = useState<CategoryTag[]>([])
  const [tag, setTag] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const generation = useRef(0)

  async function load(nextTag: string, nextPage: number) {
    const current = ++generation.current
    setLoading(true); setError("")
    try {
      if (target.mode === "rank") {
        const result = await rank(target.rankKey, nextPage)
        if (current !== generation.current) return
        setItems(result.items); setPage(result.page); setTotalPages(result.totalPages); onCount?.(result.totalPages)
      } else {
        const result = await category(target.slug, nextTag, nextPage)
        if (current !== generation.current) return
        setItems(result.items); setPage(result.page); setTotalPages(result.totalPages); setTags(result.tags); onCount?.(result.totalPages)
      }
    } catch (reason) {
      if (current === generation.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }
  useEffect(() => { void load("", 1) }, [])

  return <VStack spacing={16} alignment="leading" frame={{ maxWidth: "infinity" }}>
    <VStack spacing={11} alignment="leading" padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity" }}>
      <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Image systemName={target.mode === "rank" ? "trophy" : "square.stack.3d.up"} font="footnote" foregroundStyle={ACCENT} />
        <Text font="footnote" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }}>{target.note}</Text>
      </HStack>
      {tags.length ? <ScrollView axes="horizontal" scrollIndicator="hidden">
        <HStack spacing={9}>
          <Chip title="全部题材" selected={!tag} secondary disabled={loading} action={() => { setTag(""); void load("", 1) }} />
          {tags.map(item => <Chip key={item.slug} title={item.name} selected={item.slug === tag} secondary disabled={loading}
            action={() => { setTag(item.slug); void load(item.slug, 1) }} />)}
        </HStack>
      </ScrollView> : undefined}
    </VStack>

    {loading && !items.length ? <LoadingState title="正在加载内容" minHeight={360} />
      : error && !items.length ? <VStack padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity" }}><StateCard title="加载失败" description={error} systemImage="wifi.exclamationmark" tint="systemRed" actionTitle="重新加载" action={() => { void load(tag, page) }} /></VStack>
      : !items.length ? <VStack padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity" }}>
        <StateCard title="没有更多内容了" description="已经翻到最后一页。红果返回的总页数是固定值，以实际结果为准。" systemImage="rectangle.stack.badge.minus" actionTitle="回到第 1 页" action={() => { setTag(""); void load("", 1) }} />
      </VStack>
      : target.mode === "rank" ? <VStack spacing={12} alignment="leading" padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity" }}>
        <SectionHeading title="完整榜单" subtitle="按站内热度排序" />
        <DramaRowList items={items} subtitle={drama => drama.rank ? `No.${drama.rank} ${drama.hot}` : drama.hot} onOpen={onOpen} />
      </VStack>
      : <VStack spacing={14} alignment="leading" padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity" }}>
        <LazyVGrid columns={gridColumns()} alignment="leading" spacing={16} frame={{ maxWidth: "infinity", alignment: "leading" }}>
          {items.map(drama => <DramaCard key={drama.id} drama={drama} onOpen={onOpen} />)}
        </LazyVGrid>
      </VStack>}

    {error && items.length ? <VStack padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity" }}><StateCard title="刷新失败" description="正在显示上次成功加载的内容。" systemImage="exclamationmark.arrow.triangle.2.circlepath" tint="systemOrange" actionTitle="重试" action={() => { void load(tag, page) }} /></VStack> : undefined}
    {items.length ? <VStack spacing={2} padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity" }}>
      <Pagination page={page} hasNext={page < totalPages} loading={loading} onPrevious={() => { void load(tag, page - 1) }} onNext={() => { void load(tag, page + 1) }} />
      <Text font="caption" foregroundStyle="tertiaryLabel" frame={{ maxWidth: "infinity" }} multilineTextAlignment="center">{`第 ${page} / ${totalPages} 页`}</Text>
    </VStack> : undefined}
  </VStack>
}
