import { Button, DragGesture, HStack, Image, LazyHStack, Rectangle, ScrollView, Text, VStack, ZStack, useEffect, useObservable, useRef, useState } from "scripting"
import { homeFeed, type Banner, type Drama, type HomeSection } from "../client"
import { ACCENT, LoadingState, PAGE_BOTTOM_PADDING, PAGE_PADDING, PageBackground, SECTION_SPACING, SHELF_CARD_WIDTH, SHELF_COVER_HEIGHT, SectionHeading, StateCard } from "../design"
import { loadSettings, nextBannerIndex } from "../storage"
import { DramaCard } from "./components"
import { DetailPage } from "./detail"
import { BROWSE_RANK } from "./feed"

/** 首页板块（tab_type）→ 对应的频道；没有对应频道的（全部类型）去榜单。 */
const CHANNEL_OF_SECTION: Record<string, string> = {
  human: "real-drama",
  comic: "comic-drama",
  ai: "ai-drama",
}

function sectionChannel(section: HomeSection): string {
  return CHANNEL_OF_SECTION[section.tabType] ?? BROWSE_RANK
}

/** 卡片高度。官方移动端是把 1170×2160 的竖版海报**不裁切**铺满整宽（≈720pt），
 *  放进首页信息流里太高了，这里改成固定高度 + fill 居中裁切，保持和其他卡片同一节奏。 */
const BANNER_HEIGHT = 220
/** 页码点占的底部空带高度 */
const BANNER_STRIP = 24
/** 交叉淡入淡出时长（秒） */
const BANNER_FADE = 0.45

/** 触感：裸调会带崩脚本，统一包起来 */
function bump() { try { HapticFeedback.selection() } catch { /* 触感不可用不该带崩脚本 */ } }

/** 左右滑动换页的手势。
 *  ⚠️ `DragGesture` 的参数名是 **`minDistance`**（默认 10），不是 minimumDistance；
 *  事件里给的是 `translation / velocity / predictedEndTranslation`。
 *  手势对象要稳定存在，所以做成模块级单例 + 一个可变回调（和 player.tsx 的 PLAYER_TAP 同一套做法）。 */
let bannerSwipeAction: (delta: number) => void = () => {}
const BANNER_SWIPE = (() => {
  try {
    return DragGesture({ minDistance: 24 }).onEnded(event => {
      const dx = event.translation.width
      const dy = event.translation.height
      // 横着划够远才算翻页（竖着划是页面滚动，别抢）
      if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return
      bannerSwipeAction(dx < 0 ? 1 : -1)
    })
  } catch { return undefined }
})()

/**
 * 首页顶部轮播（手写，不用原生分页 TabView）。
 * ⚠️ 为何不直接用 `TabView tabViewStyle="page"`？—— 实测（preview_ui + 纯色页截图判定）：
 *  Scripting 里分页样式的**选中项绑定失效**：把 `selection`(Observable) 或 `tabIndex` 设成 2，
 *  画面依旧停在第 1 页、页码点也高亮第一个（截图里标签写着 index=2、页面还是第一页的颜色）。
 *  所以这里自己记下标 + 定时推进 + 交叉淡入淡出 + 自绘页码点。
 */
export function BannerCarousel({ items, onOpen }: { items: Banner[]; onOpen: (banner: Banner) => void }) {
  const [index, setIndex] = useState(0)
  const count = items.length
  const active = count ? Math.min(index, count - 1) : 0

  // 自动切换：下标一变就重新起表（节奏稳定）。
  // ⚠️ 秒数**每次现读设置**：在设置页改完，下一张就按新速度走。
  useEffect(() => {
    if (count <= 1) return
    const seconds = Math.max(1, loadSettings().bannerSeconds)
    const timer = setTimeout(() => setIndex(previous => nextBannerIndex(previous, count)), seconds * 1000)
    return () => clearTimeout(timer)
  }, [active, count])

  // 左右滑动换一张（手势是模块级单例，拿不到渲染闭包 → 每轮渲染把最新动作挂上去）
  bannerSwipeAction = delta => {
    if (count <= 1) return
    bump()
    setIndex(previous => {
      const base = Math.min(previous, count - 1)
      return (((base + delta) % count) + count) % count
    })
  }

  if (!count) return <VStack spacing={0} />
  // ⚠️ 必须「固定顺序挂满 + 只改 opacity」，不能把「当前 + 相邻」重新组成数组：
  //   上一版 layers = [active, active+1, active-1]，active 一变数组就重排
  //   （同一个 id 在 ZStack 里换了位置）→ SwiftUI 当成结构性变化直接重排、不做补间，
  //   于是完全没有淡入淡出（用户实报「没有淡出淡入的效果」就是这里）。
  //   固定顺序后每张卡片的身份不变，只有 opacity 在变 → 才会真的交叉淡入。
  //   图片只在「当前 ±1」这三张里真挂载（banner 是 1170×2160 大图，全挂太吃内存）。
  const near = (i: number) => count <= 3 || i === active || i === (active + 1) % count || i === (active - 1 + count) % count

  return <VStack spacing={0} frame={{ maxWidth: "infinity" }}>
    <ZStack frame={{ maxWidth: "infinity", height: BANNER_HEIGHT }} gesture={BANNER_SWIPE}>
      {items.map((item, i) => <VStack key={item.id} padding={{ horizontal: PAGE_PADDING }}
        frame={{ maxWidth: "infinity", height: BANNER_HEIGHT }}
        opacity={i === active ? 1 : 0}
        animation={{ animation: Animation.easeOut(BANNER_FADE), value: active }}
        allowsHitTesting={i === active}
        contentShape="rect"
        accessibilityLabel={item.title}
        onTapGesture={() => onOpen(item)}>
        <ZStack frame={{ maxWidth: "infinity", height: BANNER_HEIGHT }} clipShape={{ type: "rect", cornerRadius: 20, style: "continuous" }} background="secondarySystemBackground">
          {near(i) && item.cover ? <Image imageUrl={item.cover} resizable aspectRatio={{ contentMode: "fill" }} frame={{ maxWidth: "infinity", height: BANNER_HEIGHT }} clipped /> : undefined}
          <VStack spacing={6} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottomLeading" }} padding={16}
            background={{ colors: ["rgba(0,0,0,0)", "rgba(0,0,0,0.78)"], startPoint: "top", endPoint: "bottom" }}>
            <Text font="title3" fontWeight="bold" foregroundStyle="white" lineLimit={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>{item.title}</Text>
            {item.tags.length ? <Text font="caption" foregroundStyle="white" opacity={0.85} lineLimit={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>{item.tags.join(" · ")}</Text> : undefined}
          </VStack>
        </ZStack>
      </VStack>)}
    </ZStack>
    <HStack spacing={6} frame={{ maxWidth: "infinity", minHeight: BANNER_STRIP }}>
      {items.map((item, i) => <Rectangle key={item.id} clipShape="circle"
        fill={i === active ? "label" : "tertiaryLabel"}
        opacity={i === active ? 1 : 0.5}
        frame={{ width: 7, height: 7 }}
        animation={{ animation: Animation.easeOut(BANNER_FADE), value: active }} />)}
    </HStack>
  </VStack>
}

/**
 * 首页 = 纯精选橱窗（hero + 各频道横滑）。
 * 频道/榜单的完整列表在「发现」Tab，这里点「更多」只负责跳过去。
 */
export function HomePageContent({ onLibraryChanged, onBrowse }: { onLibraryChanged: () => void; onBrowse: (channel: string) => void }) {
  const [sections, setSections] = useState<HomeSection[]>([])
  const [banners, setBanners] = useState<Banner[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Drama | null>(null)
  const [nonce, setNonce] = useState(0)
  const presented = useObservable(false)
  const generation = useRef(0)

  async function load() {
    const current = ++generation.current
    setLoading(true); setError(null)
    try {
      const result = await homeFeed()
      if (current === generation.current) { setSections(result.sections); setBanners(result.banners) }
    } catch (reason) {
      if (current === generation.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }
  useEffect(() => { void load() }, [])

  function open(drama: Drama) { setSelected(drama); presented.setValue(true) }
  /** 轮播卡片点进详情：详情页只用得上 id，其余字段加载后会被真实数据覆盖。 */
  function openBanner(banner: Banner) {
    open({ id: banner.id, title: banner.title, cover: banner.cover, intro: banner.intro, episodeCount: 0, episodeLabel: "", tags: banner.tags, hot: "", rank: 0 })
  }

  const hero = sections[0]?.items[0]
  // 轮播取不到（离线 / 接口变了）时退回「第一段第一条」，至少不是空白
  const carouselItems: Banner[] = banners.length ? banners : hero ? [{
    id: hero.id, title: hero.title, cover: hero.cover, intro: hero.hot,
    tags: [hero.episodeLabel].concat(hero.tags).filter(Boolean).slice(0, 2) as string[],
  }] : []

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
    <PageBackground />
    <ScrollView navigationTitle="红果短剧" navigationBarTitleDisplayMode="large"
      refreshable={async () => { setNonce(value => value + 1); await load() }}
      navigationDestination={{ isPresented: presented, content: selected ? <DetailPage drama={selected} onLibraryChanged={onLibraryChanged} /> : <VStack /> }}>
      <VStack key={`home-${nonce}`} spacing={SECTION_SPACING} alignment="leading" padding={{ top: 4, bottom: PAGE_BOTTOM_PADDING }}>
        {loading && !sections.length ? <LoadingState title="正在加载首页" minHeight={420} />
          : error && !sections.length ? <VStack padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity" }}><StateCard title="首页加载失败" description={error} systemImage="wifi.exclamationmark" tint="systemRed" actionTitle="重新加载" action={() => { void load() }} /></VStack>
          : <>
            {carouselItems.length ? <BannerCarousel items={carouselItems} onOpen={openBanner} /> : undefined}
            {sections.map(section => <VStack key={section.key} spacing={12} alignment="leading" frame={{ maxWidth: "infinity" }}>
              <VStack padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity" }}>
                <SectionHeading title={section.title} subtitle={`精选 ${section.items.length} 部`} trailing={
                  <Button action={() => onBrowse(sectionChannel(section))} buttonStyle="plain" tint={ACCENT} accessibilityLabel={`到发现页查看${section.title}的全部内容`}>
                    <HStack spacing={2}><Text font="subheadline">更多</Text><Image systemName="chevron.right" font="caption2" /></HStack>
                  </Button>} />
              </VStack>
              <ScrollView axes="horizontal" scrollIndicator="hidden">
                <LazyHStack spacing={14} alignment="top" padding={{ horizontal: PAGE_PADDING }}>
                  {section.items.map(drama => <VStack key={drama.id} frame={{ width: SHELF_CARD_WIDTH }}>
                    <DramaCard drama={drama} width={SHELF_CARD_WIDTH} coverHeight={SHELF_COVER_HEIGHT} contentMode="fill" onOpen={open} />
                  </VStack>)}
                </LazyHStack>
              </ScrollView>
            </VStack>)}
            {error && sections.length ? <VStack padding={{ horizontal: PAGE_PADDING }} frame={{ maxWidth: "infinity" }}><StateCard title="刷新失败" description="正在显示上次成功加载的内容。" systemImage="exclamationmark.arrow.triangle.2.circlepath" tint="systemOrange" actionTitle="重试" action={() => { void load() }} /></VStack> : undefined}
          </>}
      </VStack>
    </ScrollView>
  </ZStack>
}
