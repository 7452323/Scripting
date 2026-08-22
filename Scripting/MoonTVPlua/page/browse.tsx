import { Button, HStack, Image, NavigationLink, NavigationStack, Picker, ScrollView, Section, Text, VStack, useEffect, useState } from "scripting"
import { DoubanItem, moonClient, SearchResult } from "../client"
import { ACCENT, COVER_RADIUS, PAGE_BOTTOM_PADDING, PAGE_PADDING, LoadingState } from "../design"
import { DetailView } from "./home"

type MediaType = "movie" | "tv" | "anime" | "show"
type SortValue = "T" | "U" | "R" | "S"

const MOVIE_TYPES = ["全部", "喜剧", "爱情", "动作", "科幻", "悬疑", "犯罪", "惊悚", "冒险", "音乐", "历史", "奇幻", "恐怖", "战争", "传记", "歌舞", "武侠", "情色", "灾难", "西部", "纪录片", "短片"]
const TV_TYPES = ["全部", "喜剧", "爱情", "悬疑", "武侠", "古装", "家庭", "犯罪", "科幻", "恐怖", "历史", "战争", "动作", "冒险", "传记", "剧情", "奇幻", "惊悚", "灾难", "歌舞", "音乐"]
const SHOW_TYPES = ["全部", "真人秀", "脱口秀", "音乐", "歌舞"]
const ANIME_TV_LABELS = ["全部", "黑色幽默", "历史", "歌舞", "励志", "恶搞", "治愈", "运动", "后宫", "情色", "国漫", "人性", "悬疑", "恋爱", "魔幻", "科幻"]
const ANIME_MOVIE_LABELS = ["全部", "定格动画", "传记", "美国动画", "爱情", "黑色幽默", "歌舞", "儿童", "二次元", "动物", "青春", "历史", "励志", "恶搞", "治愈", "运动", "后宫", "情色", "人性", "悬疑", "恋爱", "魔幻", "科幻"]
const MOVIE_REGIONS = ["全部", "华语", "欧美", "韩国", "日本", "中国大陆", "美国", "中国香港", "中国台湾", "英国", "法国", "德国", "意大利", "西班牙", "印度", "泰国", "俄罗斯", "加拿大", "澳大利亚", "爱尔兰", "瑞典", "巴西", "丹麦"]
const TV_REGIONS = ["全部", "华语", "欧美", "国外", "韩国", "日本", "中国大陆", "中国香港", "美国", "英国", "泰国", "中国台湾", "意大利", "法国", "德国", "西班牙", "俄罗斯", "瑞典", "巴西", "丹麦", "印度", "加拿大", "爱尔兰", "澳大利亚"]
const PLATFORMS = ["全部", "腾讯视频", "爱奇艺", "优酷", "湖南卫视", "Netflix", "HBO", "BBC", "NHK", "CBS", "NBC", "tvN"]
const WEEKDAYS = [{ n: "周一", v: "Mon" }, { n: "周二", v: "Tue" }, { n: "周三", v: "Wed" }, { n: "周四", v: "Thu" }, { n: "周五", v: "Fri" }, { n: "周六", v: "Sat" }, { n: "周日", v: "Sun" }]

function years(): string[] {
  const current = new Date().getFullYear()
  const decade = Math.floor(current / 10) * 10
  const result = ["全部", `${decade}年代`]
  for (let y = current; y >= decade; y--) result.push(String(y))
  for (let d = decade - 10; d >= 1960; d -= 10) result.push(`${d}年代`)
  result.push("更早")
  return result
}

function options(values: string[]) { return values.map(value => <Text key={value} tag={value}>{value}</Text>) }

function Poster({ item }: { item: DoubanItem }) {
  return <VStack frame={{ width: 104 }} spacing={5}>
    <Image imageUrl={moonClient.resolvePosterUrl(item.poster)} resizable={true} scaleToFill={true} frame={{ width: 104, height: 150 }} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: COVER_RADIUS, style: "continuous" }} />
    <Text font="caption" fontWeight="medium" lineLimit={2}>{item.title}</Text>
    <HStack spacing={4}>
      {item.rate ? <Text font="caption" foregroundStyle={ACCENT}>★ {item.rate}</Text> : null}
      {item.year ? <Text font="caption" foregroundStyle="secondaryLabel">{item.year}</Text> : null}
    </HStack>
  </VStack>
}

function PosterGrid({ items }: { items: DoubanItem[] }) {
  const rows: DoubanItem[][] = []
  for (let i = 0; i < items.length; i += 3) rows.push(items.slice(i, i + 3))
  return <VStack spacing={18}>
    {rows.map((row, r) => <HStack key={r} spacing={14}>
      {row.map((item, i) => <NavigationLink key={`${item.id}-${i}`} destination={<ResourceResults title={item.title} />}><Poster item={item} /></NavigationLink>)}
    </HStack>)}
  </VStack>
}

function ResourceResults({ title }: { title: string }) {
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [progress, setProgress] = useState({ completed: 0, total: 0 })
  useEffect(() => {
    moonClient.searchProgressively(title, (added, completed, total) => {
      if (added.length > 0) setResults(prev => [...prev, ...added])
      setProgress({ completed, total })
    }, true).catch(e => setError(e.message || "资源查找失败")).finally(() => setLoading(false))
  }, [])
  return <ScrollView navigationTitle={title} padding={{ horizontal: PAGE_PADDING, bottom: PAGE_BOTTOM_PADDING }}>
    {error ? <Text foregroundStyle="systemRed">{error}</Text> : results.length === 0 && loading ? <LoadingState title="资源查找中..." /> : results.length === 0 ? <Text foregroundStyle="secondaryLabel" padding={{ top: 30 }}>暂无可播放资源</Text> : <VStack spacing={10} padding={{ top: 12 }}>
      {results.map((r, i) => <NavigationLink key={`${r.source}-${r.id}-${i}`} destination={<DetailView resource={r} id={r.id} source={r.source} title={r.title} poster={r.poster} />}> 
        <HStack spacing={10} padding={10} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 12, style: "continuous" }}>
          <Image imageUrl={moonClient.resolvePosterUrl(r.poster)} resizable={true} scaleToFill={true} frame={{ width: 58, height: 82 }} clipShape={{ type: "rect", cornerRadius: 8, style: "continuous" }} />
          <VStack frame={{ maxWidth: "infinity" }} spacing={4}>
            <Text font="subheadline" fontWeight="semibold">{r.title}</Text>
            <Text font="caption" foregroundStyle={ACCENT}>{r.source_name}</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">{r.year || ""} · {r.type_name || ""} · {r.episodes?.length || 0} 集</Text>
          </VStack>
        </HStack>
      </NavigationLink>)}
      {loading ? <Text font="caption" foregroundStyle="secondaryLabel">仍在查找其他资源 · {progress.completed}/{progress.total}</Text> : null}
    </VStack>}
  </ScrollView>
}

export default function BrowseView() {
  const [media, setMedia] = useState<MediaType>("movie")
  const [primary, setPrimary] = useState("热门")
  const [secondary, setSecondary] = useState("全部")
  const [category, setCategory] = useState("全部")
  const [region, setRegion] = useState("全部")
  const [year, setYear] = useState("全部")
  const [platform, setPlatform] = useState("全部")
  const [sort, setSort] = useState<SortValue>("T")
  const [weekday, setWeekday] = useState(WEEKDAYS[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1].v)
  const [items, setItems] = useState<DoubanItem[]>([])
  const [start, setStart] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState("")

  const resetMedia = (value: MediaType) => {
    setMedia(value); setCategory("全部"); setRegion("全部"); setYear("全部"); setPlatform("全部"); setSort("T")
    if (value === "movie") { setPrimary("热门"); setSecondary("全部") }
    else if (value === "tv") { setPrimary("最近热门"); setSecondary("tv") }
    else if (value === "show") { setPrimary("最近热门"); setSecondary("show") }
    else { setPrimary("每日放送"); setSecondary("全部") }
  }

  const load = async (offset: number, append: boolean) => {
    append ? setLoadingMore(true) : setLoading(true)
    setError("")
    try {
      let list: DoubanItem[] = []
      if (media === "anime" && primary === "每日放送") {
        const data = await moonClient.getBangumiCalendar()
        const day = data.find((x: any) => x.weekday?.en === weekday)
        list = (day?.items || []).filter((x: any) => x.images).map((x: any) => ({ id: String(x.id || ""), title: x.name_cn || x.name, poster: x.images.large || x.images.common || x.images.medium || x.images.small || x.images.grid, rate: x.rating?.score ? Number(x.rating.score).toFixed(1) : "", year: x.air_date?.split("-")?.[0] || "" }))
      } else if ((media === "movie" && primary !== "全部") || ((media === "tv" || media === "show") && primary === "最近热门")) {
        const kind = media === "movie" ? "movie" : "tv"
        const cat = media === "movie" ? primary : media
        list = await moonClient.getDoubanCategories(kind, cat, secondary, offset, 25)
      } else {
        const anime = media === "anime"
        const kind = anime ? (primary === "番剧" ? "tv" : "movie") : (media === "movie" ? "movie" : "tv")
        list = await moonClient.getDoubanRecommends({ kind, category: anime ? "动画" : category, format: anime ? (primary === "番剧" ? "电视剧" : "") : media === "tv" ? "电视剧" : media === "show" ? "综艺" : "", label: anime ? category : "", region, year, platform: kind === "tv" ? platform : "全部", sort, start: offset, limit: 25 })
      }
      setItems(old => append ? [...old, ...list] : list)
      setStart(offset)
      setHasMore(!(media === "anime" && primary === "每日放送") && list.length >= 25)
    } catch (e: any) { setError(e.message || "加载分类失败"); if (!append) setItems([]) }
    setLoading(false); setLoadingMore(false)
  }

  useEffect(() => { setItems([]); setStart(0); load(0, false) }, [media, primary, secondary, category, region, year, platform, sort, weekday])

  const advanced = (media === "movie" && primary === "全部") || ((media === "tv" || media === "show") && primary === "全部") || (media === "anime" && primary !== "每日放送")
  const categoryValues = media === "movie" ? MOVIE_TYPES : media === "tv" ? TV_TYPES : media === "show" ? SHOW_TYPES : primary === "番剧" ? ANIME_TV_LABELS : ANIME_MOVIE_LABELS
  const regionValues = media === "movie" || (media === "anime" && primary === "剧场版") ? MOVIE_REGIONS : TV_REGIONS

  return <NavigationStack>
    <ScrollView navigationTitle="分类" navigationBarTitleDisplayMode="large" padding={{ horizontal: PAGE_PADDING }} contentMargins={{ edges: "bottom", insets: 0, placement: "scrollContent" }} ignoresSafeArea={{ regions: "container", edges: "bottom" }}>
      <VStack spacing={14} padding={{ top: 8 }}>
        <Picker title="频道" value={media} onChanged={(v: string | number) => resetMedia(String(v) as MediaType)} pickerStyle="segmented">
          <Text tag="movie">电影</Text><Text tag="tv">剧集</Text><Text tag="anime">动漫</Text><Text tag="show">综艺</Text>
        </Picker>

        <Section>
          <HStack spacing={12} frame={{ maxWidth: "infinity" }}>
            <Picker title="分类" value={primary} onChanged={(v: string) => { setPrimary(v); if (media === "tv") setSecondary("tv"); if (media === "show") setSecondary("show") }} pickerStyle="menu" frame={{ maxWidth: "infinity" }}>
              {options(media === "movie" ? ["全部", "热门", "最新", "豆瓣高分", "冷门佳片"] : media === "anime" ? ["每日放送", "番剧", "剧场版"] : ["全部", "最近热门"])}
            </Picker>

            {media === "movie" && primary !== "全部" ? <Picker title="地区" value={secondary} onChanged={setSecondary} pickerStyle="menu" frame={{ maxWidth: "infinity" }}>{options(["全部", "华语", "欧美", "韩国", "日本"])}</Picker> : null}
            {media === "tv" && primary === "最近热门" ? <Picker title="类型" value={secondary} onChanged={setSecondary} pickerStyle="menu" frame={{ maxWidth: "infinity" }}>
              <Text tag="tv">全部</Text><Text tag="tv_domestic">国产</Text><Text tag="tv_american">欧美</Text><Text tag="tv_japanese">日本</Text><Text tag="tv_korean">韩国</Text><Text tag="tv_animation">动漫</Text><Text tag="tv_documentary">纪录片</Text>
            </Picker> : null}
            {media === "show" && primary === "最近热门" ? <Picker title="类型" value={secondary} onChanged={setSecondary} pickerStyle="menu" frame={{ maxWidth: "infinity" }}>
              <Text tag="show">全部</Text><Text tag="show_domestic">国内</Text><Text tag="show_foreign">国外</Text>
            </Picker> : null}
            {media === "anime" && primary === "每日放送" ? <Picker title="星期" value={weekday} onChanged={setWeekday} pickerStyle="menu" frame={{ maxWidth: "infinity" }}>{WEEKDAYS.map(x => <Text key={x.v} tag={x.v}>{x.n}</Text>)}</Picker> : null}
          </HStack>

          {advanced ? <>
            <Picker title={media === "anime" ? "标签" : "类型"} value={category} onChanged={setCategory} pickerStyle="menu">{options(categoryValues)}</Picker>
            <Picker title="地区" value={region} onChanged={setRegion} pickerStyle="menu">{options(regionValues)}</Picker>
            <Picker title="年代" value={year} onChanged={setYear} pickerStyle="menu">{options(years())}</Picker>
            {(media === "tv" || media === "show" || (media === "anime" && primary === "番剧")) ? <Picker title="平台" value={platform} onChanged={setPlatform} pickerStyle="menu">{options(PLATFORMS)}</Picker> : null}
            <Picker title="排序" value={sort} onChanged={(v: string | number) => setSort(String(v) as SortValue)} pickerStyle="menu"><Text tag="T">综合排序</Text><Text tag="U">近期热度</Text><Text tag="R">{media === "movie" ? "首映时间" : "首播时间"}</Text><Text tag="S">高分优先</Text></Picker>
          </> : null}
        </Section>

        {loading ? <LoadingState title="加载分类内容..." /> : error ? <Text foregroundStyle="systemRed">{error}</Text> : items.length === 0 ? <Text foregroundStyle="secondaryLabel" padding={{ top: 30 }}>暂无相关内容</Text> : <PosterGrid items={items} />}
        {hasMore && !loading ? <Button title={loadingMore ? "加载中..." : "加载更多"} action={() => { if (!loadingMore) load(start + 25, true) }} /> : null}
      </VStack>
    </ScrollView>
  </NavigationStack>
}
