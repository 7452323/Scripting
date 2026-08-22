import { Button, HStack, Image, NavigationLink, NavigationStack, ScrollView, TabView, Text, VStack, ZStack, useObservable, useState, useEffect } from "scripting"
import { moonClient, BannerItem, DoubanItem, RichMediaMetadata, SearchResult, UpcomingItem, VideoDetail } from "../client"
import { ACCENT, PAGE_PADDING, SECTION_SPACING, GRID_SPACING, COVER_RADIUS, LoadingState } from "../design"
import { presentPlayer } from "../native-player"

// ========== Native paged Banner ==========
function BannerSlide({ item }: { item: BannerItem }) {
  const tags = (item.tags || item.genres || []).slice(0, 3)
  return (
    <NavigationLink destination={<SearchResultsView query={item.title} title={item.title} />}>
      <ZStack frame={{ maxWidth: "infinity", height: 230 }} background="black" clipShape={{ type: "rect", cornerRadius: 20, style: "continuous" }}>
        <Image imageUrl={moonClient.resolveBannerImage(item.backdrop_path || item.poster_path || "")} resizable={true} scaleToFill={true} frame={{ maxWidth: "infinity", height: 230 }} opacity={0.68} clipShape={{ type: "rect", cornerRadius: 20, style: "continuous" }} />
        <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} padding={{ horizontal: 20, vertical: 22 }}>
          <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} />
          <VStack spacing={7} frame={{ maxWidth: "infinity" }}>
            <Text font="title2" fontWeight="bold" foregroundStyle="white" lineLimit={2}>{item.title}</Text>
            <HStack spacing={7}>
              {item.vote_average && item.vote_average > 0 ? <Text font="caption" fontWeight="bold" foregroundStyle="systemYellow">★ {item.vote_average.toFixed(1)}</Text> : null}
              {item.release_date ? <Text font="caption" foregroundStyle="white">{item.release_date}</Text> : null}
              {tags.map((tag, i) => <Text key={`${tag}-${i}`} font="caption" foregroundStyle="white">{tag}</Text>)}
            </HStack>
            {item.overview ? <Text font="caption" foregroundStyle="white" lineLimit={2}>{item.overview}</Text> : null}
          </VStack>
        </VStack>
      </ZStack>
    </NavigationLink>
  )
}

function HomeBanner() {
  const [items, setItems] = useState<BannerItem[]>([])
  const [error, setError] = useState("")
  const selection = useObservable<number>(0)

  useEffect(() => {
    let cancelled = false
    moonClient.getBannerItems()
      .then(data => { if (!cancelled) setItems(data.list.slice(0, 8)) })
      .catch(e => { if (!cancelled) setError(e.message || "轮播加载失败") })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (items.length < 2) return
    let active = true
    let timer = 0
    const advance = () => {
      timer = setTimeout(() => {
        if (!active) return
        selection.value = (selection.value + 1) % items.length
        advance()
      }, 5000)
    }
    advance()
    return () => { active = false; clearTimeout(timer) }
  }, [items.length])

  if (items.length === 0) return error ? <Text font="caption" foregroundStyle="secondaryLabel" padding={{ horizontal: PAGE_PADDING, top: 10 }}>{error}</Text> : <LoadingState title="加载首页精选..." minHeight={230} />
  return <TabView selection={selection} tabViewStyle="pageAlwaysDisplayIndex" frame={{ height: 250 }} padding={{ horizontal: PAGE_PADDING, top: 8 }}>
    {items.map((item, index) => <BannerSlide key={`${item.id}-${index}`} item={item} tag={index} />)}
  </TabView>
}

// ========== PosterCard ==========
function PosterCard({ item, width }: { item: DoubanItem; width: number }) {
  return (
    <VStack frame={{ width }}>
      <Image
        imageUrl={moonClient.resolvePosterUrl(item.poster)}
        resizable={true}
        scaleToFill={true}
        frame={{ width, height: Math.round(width * 1.42) }}
        clipShape={{ type: "rect", cornerRadius: COVER_RADIUS, style: "continuous" }}
      />
      <Text font="subheadline" fontWeight="medium" lineLimit={1} padding={{ top: 6 }}>{item.title}</Text>
      {item.rate ? (
        <HStack spacing={4}>
          <Text foregroundStyle={ACCENT} font="caption">⭐</Text>
          <Text foregroundStyle="secondaryLabel" font="caption">{item.rate}</Text>
        </HStack>
      ) : null}
    </VStack>
  )
}

// ========== Section Header ==========
function HomeSectionHeader({ title }: { title: string }) {
  return <Text font="title3" fontWeight="bold" padding={{ horizontal: PAGE_PADDING, top: 20, bottom: 8 }}>{title}</Text>
}

// ========== Horizontal Section ==========
function MediaSection({ header, load }: { header: string; load: () => Promise<DoubanItem[]> }) {
  const [items, setItems] = useState<DoubanItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    load()
      .then(list => { if (!cancelled) setItems(list.filter(item => Boolean(item.id && item.title && item.poster))) })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : `加载${header}失败`) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading) return <VStack><HomeSectionHeader title={header} /><LoadingState title={`加载${header}...`} minHeight={220} /></VStack>
  return <VStack>
    <HomeSectionHeader title={header} />
    {error ? <Text font="caption" foregroundStyle="systemRed" padding={{ horizontal: PAGE_PADDING }}>{error}</Text> : items.length === 0 ? <Text font="caption" foregroundStyle="secondaryLabel" padding={{ horizontal: PAGE_PADDING }}>暂无内容</Text> : <ScrollView axes="horizontal" padding={{ horizontal: PAGE_PADDING }}>
      <HStack spacing={GRID_SPACING}>{items.map((item, i) => <NavigationLink key={`${item.id}-${i}`} destination={<SearchResultsView query={item.title} title={item.title} />}><PosterCard item={item} width={140} /></NavigationLink>)}</HStack>
    </ScrollView>}
  </VStack>
}

function UpcomingSection() {
  const [items, setItems] = useState<UpcomingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  useEffect(() => {
    let cancelled = false
    moonClient.getUpcomingContent().then(list => { if (!cancelled) setItems(list) }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "加载即将上映失败") }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])
  if (loading) return <VStack><HomeSectionHeader title="即将上映" /><LoadingState title="加载即将上映..." minHeight={220} /></VStack>
  return <VStack>
    <HomeSectionHeader title="即将上映" />
    {error ? <Text font="caption" foregroundStyle="systemRed" padding={{ horizontal: PAGE_PADDING }}>{error}</Text> : items.length === 0 ? <Text font="caption" foregroundStyle="secondaryLabel" padding={{ horizontal: PAGE_PADDING }}>暂无即将上映内容</Text> : <ScrollView axes="horizontal" padding={{ horizontal: PAGE_PADDING }}><HStack spacing={GRID_SPACING}>{items.map(item => {
      const poster = moonClient.resolveBannerImage(item.poster_path || "")
      const card = { id: String(item.id), title: item.title, poster, rate: item.vote_average > 0 ? item.vote_average.toFixed(1) : "", year: item.release_date?.split("-")?.[0] || "" }
      return <NavigationLink key={`${item.media_type}-${item.id}`} destination={<SearchResultsView query={item.title} title={item.title} />}>{poster ? <PosterCard item={card} width={140} /> : <VStack frame={{ width: 140 }}><Image systemName="film.fill" font="largeTitle" foregroundStyle="secondaryLabel" frame={{ width: 140, height: 199 }} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: COVER_RADIUS, style: "continuous" }} /><Text font="subheadline" fontWeight="medium" lineLimit={1} padding={{ top: 6 }}>{item.title}</Text><Text font="caption" foregroundStyle="secondaryLabel">{card.year}</Text></VStack>}</NavigationLink>
    })}</HStack></ScrollView>}
  </VStack>
}

function DuanjuSection() {
  const [items, setItems] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  useEffect(() => {
    let cancelled = false
    moonClient.getDuanjuRecommendations()
      .then(list => { if (!cancelled) setItems(list.filter(item => Boolean(item.id && item.title && item.poster))) })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "加载热播短剧失败") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])
  if (loading) return <VStack><HomeSectionHeader title="热播短剧" /><LoadingState title="加载热播短剧..." minHeight={220} /></VStack>
  return <VStack>
    <HomeSectionHeader title="热播短剧" />
    {error ? <Text font="caption" foregroundStyle="systemRed" padding={{ horizontal: PAGE_PADDING }}>{error}</Text> : items.length === 0 ? <Text font="caption" foregroundStyle="secondaryLabel" padding={{ horizontal: PAGE_PADDING }}>暂无短剧内容</Text> : <ScrollView axes="horizontal" padding={{ horizontal: PAGE_PADDING }}>
      <HStack spacing={GRID_SPACING}>{items.map((item, i) => <NavigationLink key={`${item.source}-${item.id}-${i}`} destination={<DetailView resource={item} id={item.id} source={item.source} title={item.title} poster={item.poster} />}><PosterCard item={{ id: item.id, title: item.title, poster: item.poster, rate: "", year: item.year }} width={140} /></NavigationLink>)}</HStack>
    </ScrollView>}
  </VStack>
}

// ========== Search Results ==========
function SearchResultsView({ query, title }: { query: string; title: string }) {
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [progress, setProgress] = useState({ completed: 0, total: 0 })

  useEffect(() => {
    moonClient.searchProgressively(query, (added, completed, total) => {
      if (added.length > 0) setResults(prev => [...prev, ...added])
      setProgress({ completed, total })
    }, true)
      .catch(e => { setError(e.message || "资源查找失败") })
      .finally(() => setLoading(false))
  }, [])

  return (
    <NavigationStack>
      <ScrollView navigationTitle={title} padding={{ horizontal: PAGE_PADDING, top: 12, bottom: 60 }}>
        {error ? <Text foregroundStyle="systemRed" font="subheadline" padding={{ top: 20 }}>{error}</Text> :
         results.length === 0 && loading ? <LoadingState title="资源查找中..." /> :
         results.length === 0 ? <Text font="subheadline" foregroundStyle="secondaryLabel" padding={{ top: 20 }}>暂无资源</Text> :
         <VStack spacing={12}>
           {results.map((r, i) => <ResultRow key={`${r.source}-${r.id}-${i}`} result={r} />)}
           {loading ? <Text font="caption" foregroundStyle="secondaryLabel">仍在查找其他资源 · {progress.completed}/{progress.total}</Text> : null}
         </VStack>}
      </ScrollView>
    </NavigationStack>
  )
}

// ========== Result Row ==========
function ResultRow({ result }: { result: SearchResult }) {
  return (
    <NavigationLink
      destination={<DetailView resource={result} id={result.id} source={result.source} title={result.title} poster={result.poster} />}
    >
      <HStack spacing={10} padding={10} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 12, style: "continuous" }}>
        <Image imageUrl={moonClient.resolvePosterUrl(result.poster)} resizable={true} scaleToFill={true} frame={{ width: 70, height: 100 }} clipShape={{ type: "rect", cornerRadius: 8, style: "continuous" }} />
        <VStack spacing={4} frame={{ maxWidth: "infinity" }}>
          <Text font="subheadline" fontWeight="semibold" lineLimit={2}>{result.title}</Text>
          <HStack spacing={6}>
            <Text foregroundStyle="secondaryLabel" font="caption">{result.type_name || ""}</Text>
            {result.year ? <Text foregroundStyle="secondaryLabel" font="caption">{result.year}</Text> : null}
          </HStack>
          <Text foregroundStyle={ACCENT} font="caption">{result.source_name}</Text>
        </VStack>
      </HStack>
    </NavigationLink>
  )
}

// ========== Native episode grid ==========
function EpisodeGrid({ detail }: { detail: VideoDetail }) {
  const episodes = detail.episodes || []
  const rows: number[][] = []
  for (let i = 0; i < episodes.length; i += 4) rows.push([i, i + 1, i + 2, i + 3].filter(i => i < episodes.length))
  return (
    <VStack spacing={10}>
      <Text font="title3" fontWeight="bold">选集 ({episodes.length})</Text>
      {rows.map((row, r) => (
        <HStack key={r} spacing={10}>
          {row.map(i => (
            <Button
              key={i}
              title={detail.episodes_titles?.[i] || `${i + 1}`}
              action={() => presentPlayer({ url: moonClient.resolvePlayUrl(detail, i), episodeUrls: detail.episodes.map((_: string, index: number) => moonClient.resolvePlayUrl(detail, index)), episodeTitles: detail.episodes_titles, title: detail.title, cover: detail.poster, episodeTitle: detail.episodes_titles?.[i], headers: moonClient.playbackHeaders(), id: detail.id, source: detail.source, sourceName: detail.source_name, episodeIndex: i, totalEpisodes: detail.episodes.length, typeName: detail.type_name, year: detail.year })}
              frame={{ width: 72, height: 42 }}
            />
          ))}
        </HStack>
      ))}
    </VStack>
  )
}

// ========== DetailView ==========
export function DetailView({ resource, id, source, title, poster }: { resource?: SearchResult; id: string; source: string; title: string; poster: string }) {
  const [detail, setDetail] = useState<VideoDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [favorite, setFavorite] = useState(false)
  const [favoriteBusy, setFavoriteBusy] = useState(false)
  const [favoriteStatus, setFavoriteStatus] = useState("")
  const [metadata, setMetadata] = useState<RichMediaMetadata | null>(null)

  useEffect(() => {
    const request = resource
      ? moonClient.resolveResourceDetail(resource)
      : moonClient.getDetail(id, source)
    request
      .then(d => {
        setDetail(d)
        setLoading(false)
        moonClient.isFavorite(d.id, d.source).then(setFavorite).catch(() => {})
        moonClient.getRichMetadata(d.title, d.type_name).then(setMetadata).catch(() => {})
      })
      .catch(e => { setError(e.message || "获取资源详情失败"); setLoading(false) })
  }, [])

  return (
    <NavigationStack>
      <ScrollView navigationTitle={title} padding={{ horizontal: PAGE_PADDING, bottom: 60 }}>
        {loading ? <LoadingState title="正在获取资源详情..." /> :
         error ? <Text foregroundStyle="systemRed" font="subheadline" padding={{ top: 40 }}>{error}</Text> :
         detail ? (
          <VStack spacing={SECTION_SPACING} padding={{ top: 12 }}>
            {/* Poster */}
            <Image
              imageUrl={moonClient.resolvePosterUrl(detail.poster || poster)}
              resizable={true}
              scaleToFill={true}
              frame={{ width: 180, height: 260 }}
              background="secondarySystemBackground"
              clipShape={{ type: "rect", cornerRadius: COVER_RADIUS, style: "continuous" }}
            />
            {/* Info */}
            <VStack spacing={6}>
              <Text font="title2" fontWeight="bold">{detail.title}</Text>
              <HStack spacing={8}>
                {detail.year ? <Text foregroundStyle="secondaryLabel" font="subheadline">{detail.year}</Text> : null}
                <Text foregroundStyle={ACCENT} font="subheadline">{detail.source_name}</Text>
              </HStack>
              {detail.desc ? <Text foregroundStyle="secondaryLabel" font="subheadline" lineLimit={8}>{detail.desc}</Text> : null}
            </VStack>
            <Button
              title={favoriteBusy ? "处理中..." : favorite ? "取消收藏" : "加入收藏"}
              systemImage={favorite ? "heart.fill" : "heart"}
              tint={favorite ? "systemRed" : ACCENT}
              action={async () => {
                if (favoriteBusy) return
                setFavoriteBusy(true); setFavoriteStatus("")
                try {
                  if (favorite) await moonClient.removeFavorite(detail.id, detail.source)
                  else await moonClient.addFavorite(detail as SearchResult)
                  setFavorite(!favorite)
                } catch (e: any) { setFavoriteStatus(e.message || "收藏操作失败") }
                setFavoriteBusy(false)
              }}
            />
            {favoriteStatus ? <Text font="caption" foregroundStyle="systemRed">{favoriteStatus}</Text> : null}
            {metadata ? <VStack spacing={10} frame={{ maxWidth: "infinity" }}>
              <Text font="title3" fontWeight="bold">影片资料</Text>
              <HStack spacing={8}>
                {metadata.rating > 0 ? <Text font="subheadline" foregroundStyle={ACCENT}>★ {metadata.rating.toFixed(1)}</Text> : null}
                {metadata.runtime > 0 ? <Text font="subheadline" foregroundStyle="secondaryLabel">{metadata.runtime} 分钟</Text> : null}
                {metadata.status ? <Text font="subheadline" foregroundStyle="secondaryLabel">{metadata.status}</Text> : null}
              </HStack>
              {metadata.genres.length ? <Text font="subheadline" foregroundStyle="secondaryLabel">{metadata.genres.join(" · ")}</Text> : null}
              {metadata.tagline ? <Text font="subheadline" foregroundStyle="secondaryLabel">“{metadata.tagline}”</Text> : null}
              {metadata.cast.length ? <ScrollView axes="horizontal"><HStack spacing={12}>{metadata.cast.map(person => <VStack key={person.id} frame={{ width: 76 }} spacing={5}>
                {person.profile_path ? <Image imageUrl={moonClient.resolveBannerImage(person.profile_path)} resizable={true} scaleToFill={true} frame={{ width: 64, height: 64 }} clipShape={{ type: "capsule", style: "continuous" }} /> : <Image systemName="person.crop.circle.fill" font="title" foregroundStyle="secondaryLabel" frame={{ width: 64, height: 64 }} />}
                <Text font="caption" fontWeight="medium" lineLimit={1}>{person.name}</Text>
                {person.character ? <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>{person.character}</Text> : null}
              </VStack>)}</HStack></ScrollView> : null}
              {metadata.images.length ? <ScrollView axes="horizontal"><HStack spacing={10}>{metadata.images.filter(image => image.imageType !== "poster").slice(0, 8).map((image, i) => <Image key={`${image.file_path}-${i}`} imageUrl={moonClient.resolveBannerImage(image.file_path)} resizable={true} scaleToFill={true} frame={{ width: 220, height: 124 }} clipShape={{ type: "rect", cornerRadius: 10, style: "continuous" }} />)}</HStack></ScrollView> : null}
            </VStack> : null}
            {detail.episodes?.length ? <EpisodeGrid detail={detail} /> : <Text foregroundStyle="secondaryLabel" font="subheadline">暂无剧集</Text>}
          </VStack>
         ) : <Text foregroundStyle="secondaryLabel" font="subheadline" padding={{ top: 40 }}>无法加载视频信息</Text>}
      </ScrollView>
    </NavigationStack>
  )
}

// ========== Login Prompt ==========
function LoginPrompt() {
  return (
    <VStack frame={{ maxWidth: "infinity", minHeight: 320 }} spacing={16} padding={32}>
      <Image systemName="person.crop.circle.badge.questionmark" font="largeTitle" foregroundStyle={ACCENT} frame={{ width: 60, height: 60 }} />
      <Text font="title2" fontWeight="bold">需要登录</Text>
      <Text foregroundStyle="secondaryLabel" font="subheadline" multilineTextAlignment="center">请先在「设置」页登录 MoonTVPlus 账号</Text>
    </VStack>
  )
}

// ========== Main Home View ==========
export default function HomeView() {
  const loggedIn = moonClient.isLoggedIn()
  if (!loggedIn) return <LoginPrompt />

  return (
    <NavigationStack>
      <ScrollView navigationTitle="MoonTVPlus" navigationBarTitleDisplayMode="large" contentMargins={{ edges: "bottom", insets: 0, placement: "scrollContent" }} ignoresSafeArea={{ regions: "container", edges: "bottom" }}>
        <HomeBanner />
        <MediaSection header="热门电影" load={() => moonClient.getDoubanCategories("movie", "热门", "全部", 0, 25)} />
        <DuanjuSection />
        <MediaSection header="新番放送" load={() => moonClient.getTodayBangumi()} />
        <MediaSection header="热门剧集" load={() => moonClient.getDoubanCategories("tv", "tv", "tv", 0, 25)} />
        <MediaSection header="热门综艺" load={() => moonClient.getDoubanCategories("tv", "show", "show", 0, 25)} />
        <UpcomingSection />
      </ScrollView>
    </NavigationStack>
  )
}
