import { Button, HStack, Image, LazyVGrid, ProgressView, Rectangle, ScrollView, Text, VStack, ZStack, useEffect, useObservable, useRef, useState } from "scripting"
import { MissingError, detail as fetchDetail, discoverSeasons, episodeExtras, findSeason, formatCount, parseSeason, pickStream, repairDrama, streams, webExtras, type Drama, type DramaDetail, type Episode, type EpisodeExtras, type SeasonRecord, type WebExtras } from "../client"
import { ACCENT, Chip, GRID_SPACING, LoadingState, PAGE_BOTTOM_PADDING, PAGE_PADDING, PageBackground, SECTION_SPACING, SectionHeading, StateCard, TagLabel } from "../design"
import { mediaProxy } from "../media-server"
import { formatBytes, hasDownload, filePathOf, loadDownloads, runDownloadQueue } from "../downloads"
import { cacheFileName, cacheFilePath, ensureCacheDir, findCache, pendingCachePath, putCache, touchCache } from "../cache"
import { type Playable, type Playlist, type PlaylistEntry } from "../player"
import { isFavourite, loadHistory, loadSettings, recordPlayback, recordPosition, removeFavourite, removeHistory, replaceFavourite, replaceHistory, toggleFavourite } from "../storage"
import { DramaArtwork } from "./components"
import { WatchPage } from "./watch"
import { finishPlayback } from "../playback"
import { COVER_ASPECT } from "../design"

/** 已经加载进本次播放空间的某一季（offset 是它在扁平下标空间里的起点）。 */
type LoadedSeason = { season: number; id: string; title: string; episodes: Episode[]; offset: number }

type DownloadState = { label: string; ratio: number; index: number; total: number; failed: number }

/** 选集：每页 5 列 × 4 行 = 20 集（一屏能看全，不用翻半天）。
 *  ⚠️ 不学 dookcss 用 `TabView tabIndex` 做翻页 —— 实测 Scripting 里那个绑定不生效。 */
const EPISODE_COLUMNS = 5
const EPISODE_ROWS = 4
const EPISODE_PAGE_SIZE = EPISODE_COLUMNS * EPISODE_ROWS
/** 评论默认只显示几条，展开后才是全部。 */
const REVIEW_PREVIEW = 3

/** 秒 → `12:30` / `1:05:20`（「继续播放」按钮上显示上次看到哪）。 */
function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const pad = (value: number) => String(value).padStart(2, "0")
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`
}

/** 红果评论的 `create_time` 是**秒级**时间戳（字符串形式）→ 换成「x 分钟前」。 */
function relativeTime(value: string): string {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return ""
  const at = seconds < 1e11 ? seconds * 1000 : seconds
  const diff = Date.now() - at
  if (diff < 0 || diff > 1000 * 60 * 60 * 24 * 365 * 5) return ""
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "刚刚"
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} 个月前`
  return `${Math.floor(days / 365)} 年前`
}

/**
 * 「这条记录的 id 在红果已经查不到」专用卡片。
 *
 * 收藏 / 历史 / 下载里存的是**当初那个 id**；剧一下架或换了新 ID，这条记录就永远打不开，
 * 留着只会反复报「服务异常」。所以这里除了重试，直接给出对应的清理按钮。
 */
export function StaleCard(props: { id: string; message: string; onRetry: () => void; onRemoved: () => void }) {
  const [inFavourites, setInFavourites] = useState(() => isFavourite(props.id))
  const [inHistory, setInHistory] = useState(() => loadHistory().some(item => item.drama.id === props.id))
  return <VStack spacing={12} padding={18} frame={{ maxWidth: "infinity", alignment: "leading" }} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 18, style: "continuous" }}>
    <HStack spacing={10}>
      <Image systemName="questionmark.folder" foregroundStyle="systemOrange" frame={{ width: 22 }} />
      <Text font="headline" fontWeight="bold" frame={{ maxWidth: "infinity", alignment: "leading" }}>这部剧在红果已查不到</Text>
    </HStack>
    <Text font="subheadline" foregroundStyle="secondaryLabel" multilineTextAlignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>{props.message}</Text>
    <Text font="caption" foregroundStyle="tertiaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }}>{`记录的 id：${props.id}`}</Text>
    {inFavourites ? <Button title="从收藏里移除" tint="systemRed" frame={{ maxWidth: "infinity" }} action={() => { removeFavourite(props.id); setInFavourites(false); props.onRemoved() }} /> : undefined}
    {inHistory ? <Button title="从播放历史里移除" tint="systemRed" frame={{ maxWidth: "infinity" }} action={() => { removeHistory(props.id); setInHistory(false); props.onRemoved() }} /> : undefined}
    {inFavourites || inHistory ? undefined : <Text font="footnote" foregroundStyle="tertiaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }}>这条记录不在收藏或历史里（可能是从下载页或搜索进来的）。</Text>}
    <Button title="重新加载" tint={ACCENT} frame={{ maxWidth: "infinity" }} action={props.onRetry} />
  </VStack>
}

export function DetailPage({ drama, onLibraryChanged }: { drama: Drama; onLibraryChanged: () => void }) {
  const [activeId, setActiveId] = useState(drama.id)
  const [info, setInfo] = useState<DramaDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** 错误是「这个 id 在红果查不到了」（剧已下架 / 换了新 ID），提示与界面不一样 */
  const [missing, setMissing] = useState(false)
  /** 切季失败时的内联提示（**不把整页清掉**） */
  const [switchError, setSwitchError] = useState("")
  /** 自动修复过记录时的说明（老版本存下的坏 id 被接回来了） */
  const [healed, setHealed] = useState("")
  /** 官网的补充信息（评分 / 收藏 / 榜单 / 演员 / 热门评论）——纯展示 */
  const [extras, setExtras] = useState<WebExtras | null>(null)
  /** 下拉刷新时 +1，用于强制重拿官网补充信息（详情本身用 `{ fresh: true }` 穿透缓存）。 */
  const [extrasNonce, setExtrasNonce] = useState(0)
  /**
   * 播放页（WatchPage）：点播放后**压进导航栈的页面**（上面 220pt 视频 + 下面选集/简介），
   * 不是以前那种全屏模态 —— 对齐参考脚本的做法，好处是能返回手势回家、也能边看边翻选集。
   */
  const [watch, setWatch] = useState<Playlist | null>(null)
  /** 每次打开播放页都换一个 key：返回后再点别的集，拿到的一定是全新实例（不靠对方卸载）。 */
  const [watchNonce, setWatchNonce] = useState(0)
  const watchPresented = useObservable(false)
  /** 本集评论（每集不一样）；存 vid 避免显示到上一集的数据 */
  const [episodeReviews, setEpisodeReviews] = useState<{ vid: string; index: number; data: EpisodeExtras | null } | null>(null)
  /** 评论看「整剧精选」还是「本集」 */
  const [commentTab, setCommentTab] = useState<"series" | "episode">("series")
  const [reviewsExpanded, setReviewsExpanded] = useState(false)
  /** 选集翻页（每页 5×4=20 集） */
  const [episodePage, setEpisodePage] = useState(0)
  /** 焦点集（正在看的那集）→ 决定「本集评论」看哪一集 */
  const [focusVid, setFocusVid] = useState("")
  const [favourite, setFavourite] = useState(() => isFavourite(drama.id))
  const [seasons, setSeasons] = useState<SeasonRecord[]>([])
  const [job, setJob] = useState<DownloadState | null>(null)
  const [downloadedCount, setDownloadedCount] = useState(0)
  const cancelRef = useRef(false)
  const loadedRef = useRef<LoadedSeason[]>([])
  const generation = useRef(0)
  /** 镜像「当前真正加载成功的是哪一季」（切季失败时要留住它） */
  const infoRef = useRef<DramaDetail | null>(null)
  infoRef.current = info

  /** 某个 id 对应的标题（修复旧记录时要拿它去站内重搜）。 */
  function titleFor(id: string): string {
    if (id === drama.id) return drama.title
    return seasons.find(item => item.id === id)?.title ?? infoRef.current?.title ?? drama.title
  }

  async function load(id: string, force = false) {
    const current = ++generation.current
    // 下拉刷新要能穿透缓存（否则刷了“没反应”）：同时让官网补充信息也重拿
    if (force) setExtrasNonce(value => value + 1)
    setLoading(true); setError(null); setMissing(false); setSwitchError("")
    try {
      const result = await fetchDetail(id, { fresh: force })
      if (current !== generation.current) return
      setInfo(result)
      loadedRef.current = []
      rebuild([{ season: parseSeason(result.title).season, id: result.id, title: result.title, episodes: result.episodes, offset: 0 }])
      setFavourite(isFavourite(result.id))
      setDownloadedCount(loadDownloads().filter(item => item.dramaId === result.id).length)
    } catch (reason) {
      if (current !== generation.current) return
      const message = reason instanceof Error ? reason.message : String(reason)
      // ⚠️ 老版本把 19 位 id 当 JS 数字解析过（被四舍五入，见 client.ts 的 parseJsonSafe），
      //   存进收藏 / 历史的 id 在红果是「查不到」的 → 一点开就「服务异常」。
      //   所以先按剧名回站内重新定位一次；能修就顺手把收藏 / 历史里的记录换成新 id。
      if (reason instanceof MissingError) {
        const fixed = await repairDrama({ id, title: titleFor(id) })
        if (current !== generation.current) return
        if (fixed) {
          replaceFavourite(id, fixed)
          replaceHistory(id, fixed)
          setHealed(`原记录里的 id 已经失效（是被四舍五入过的数字），已按剧名重新定位到《${fixed.title}》并把记录修正好了。`)
          onLibraryChanged()
          setActiveId(fixed.id)
          return
        }
      }
      const loaded = infoRef.current
      // ⚠️ 切季失败时**留住原来那一季**，只在「季」那排下面提示一下：
      //  否则换到一个没内容的季就把整页变成错误卡（用户实报的就是这种）。
      if (loaded && loaded.id !== id) {
        const seasonNo = seasons.find(item => item.id === id)?.season
        setSwitchError(`${seasonNo ? `第${seasonNo}季` : "这一季"}打不开：${message}`)
        setMissing(false)
        setError(null)
      } else {
        setInfo(null)
        setMissing(reason instanceof MissingError)
        setError(message)
      }
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }

  function rebuild(items: LoadedSeason[]) {
    let offset = 0
    for (const item of items) { item.offset = offset; offset += item.episodes.length }
    loadedRef.current = items
    return offset
  }

  useEffect(() => { setActiveId(drama.id) }, [drama.id])
  useEffect(() => { void load(activeId) }, [activeId])

  // 季链发现放在后台做，不阻塞播放（失败也不影响单季使用）
  useEffect(() => {
    if (!info) return
    let cancelled = false
    void discoverSeasons(info.title, info.id)
      .then(chain => { if (!cancelled) setSeasons(chain) })
      .catch(() => { if (!cancelled) setSeasons([]) })
    return () => { cancelled = true }
  }, [info?.id])

  // 详情页的补充信息（评分 / 收藏 / 榜单 / 演员 / 热门评论）：
  // ⚠️ 这些字段**App 接口没有**，得读官网 `/detail?series_id=` 的 SSR 页。
  // 纯展示用途，所以失败就静静算了，绝不影响播放。
  // ⚡ 用「请求的 id」而不是「已拿到的 info.id」做依赖：这样两个请求**并行**发，
  //   评分/演员/评论不用等主详情回来（实测省 ~700ms）。
  useEffect(() => {
    let cancelled = false
    setExtras(null)
    void webExtras(activeId, { fresh: extrasNonce > 0 })
      .then(value => { if (!cancelled) setExtras(value) })
      .catch(() => { /* 纯展示，失败忽略 */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, extrasNonce])

  // 本集评论：官网播放页的 `episodeSocialInfo`（每集不一样，各自有总数）
  useEffect(() => {
    if (!info) return
    const saved = loadHistory().find(item => item.drama.id === info.id)?.index
    const target = (focusVid ? info.episodes.find(item => item.vid === focusVid) : undefined)
      ?? (saved ? info.episodes.find(item => item.index === saved) : undefined)
      ?? info.episodes[0]
    if (!target) { setEpisodeReviews(null); return }
    if (!focusVid && saved) {
      const flat = shown.episodes.findIndex(item => item.vid === target.vid)
      if (flat >= 0) setEpisodePage(Math.floor(flat / EPISODE_PAGE_SIZE))
    }
    let cancelled = false
    setEpisodeReviews(null)
    void episodeExtras(info.id, target.vid)
      .then(data => { if (!cancelled) setEpisodeReviews({ vid: target.vid, index: target.index, data }) })
      .catch(() => { if (!cancelled) setEpisodeReviews({ vid: target.vid, index: target.index, data: null }) })
    return () => { cancelled = true }
  }, [info?.id, focusVid])

  const shown: Drama & { episodes: Episode[] } = info
    ? { ...drama, ...info, cover: info.id === drama.id ? (drama.cover || info.cover) : info.cover }
    : { ...drama, episodes: [] }
  const plain: Drama = {
    id: shown.id, title: shown.title, cover: shown.cover, intro: shown.intro,
    episodeCount: shown.episodeCount, episodeLabel: shown.episodeLabel,
    tags: shown.tags, hot: shown.hot, rank: shown.rank,
  }

  function episodeAt(index: number): Episode | null {
    for (const item of loadedRef.current) {
      if (index >= item.offset && index < item.offset + item.episodes.length) return item.episodes[index - item.offset]
    }
    return null
  }

  /** 按扁平下标准备某一集（下标可以落到后面才追加进来的季）。 */
  async function resolveAt(index: number): Promise<Playable> {
    const episode = episodeAt(index)
    if (!episode) throw new Error("没有这一集")

    // ① 手动下载过 → 直接播本地文件（不联网、不再解密）
    const download = hasDownload(episode.vid)
    if (download) {
      const path = filePathOf(download)
      if (FileManager.existsSync(path)) {
        return { url: path, release: () => { }, note: `已下载 · ${download.quality}p`, quality: download.quality }
      }
    }

    // ② 自动缓存命中 → 同上：看过的第二次再看就是秒开，没网也能看
    const cached = findCache(episode.vid)
    if (cached) {
      const path = cacheFilePath(cached)
      if (FileManager.existsSync(path)) {
        touchCache(cached.vid)
        return { url: path, release: () => { }, note: `本地缓存 · ${cached.quality}p`, quality: cached.quality }
      }
    }

    // ③ 本地没有 → 在线流式解密（开着自动缓存时，顺手把这一集攒下来）
    const options = await streams(episode.vid)
    const best = pickStream(options, loadSettings().quality)
    let cache: { path: string; onSaved: (bytes: number) => void } | undefined
    if (loadSettings().autoCache) {
      ensureCacheDir()
      const vid = episode.vid
      cache = {
        path: pendingCachePath(vid),
        onSaved: bytes => putCache({
          vid, dramaId: plain.id, title: plain.title, episodeIndex: episode.index,
          quality: best.quality, fileName: cacheFileName(vid), bytes,
          savedAt: Date.now(), lastUsedAt: Date.now(),
        }),
      }
    }
    const prepared = await mediaProxy.prepare(best.url, best.spade, 0, cache ? { cache } : {})
    return { url: prepared.url, release: prepared.release, note: `${best.quality}p · 在线解密`, quality: best.quality }
  }

  /** 当前季播完时调用：找到并加载下一季，把它的分集追加到播放列表。 */
  async function extend(): Promise<PlaylistEntry[] | null> {
    if (!info || !loadSettings().crossSeason) return null
    const loaded = loadedRef.current
    const last = loaded[loaded.length - 1]
    if (!last) return null
    const record = await findSeason(info.title, info.id, last.season + 1)
    if (!record) return null
    if (loaded.some(item => item.id === record.id)) return null
    const next = await fetchDetail(record.id)
    rebuild([...loaded, { season: record.season, id: next.id, title: next.title, episodes: next.episodes, offset: 0 }])
    return next.episodes.map(item => ({ vid: item.vid, label: `第${record.season}季 · 第${item.index}集` }))
  }

  async function startDownload(count: number) {
    const first = loadedRef.current[0]
    if (!info || job || !first) return
    const picked = first.episodes.slice(0, Math.max(1, Math.min(count, first.episodes.length)))
    cancelRef.current = false
    setJob({ label: "准备中…", ratio: 0, index: 0, total: picked.length, failed: 0 })
    try {
      const result = await runDownloadQueue(
        picked.map(episode => ({ drama: plain, episode })),
        loadSettings().quality,
        event => setJob({ label: event.label, ratio: event.ratio, index: event.index + 1, total: event.total, failed: 0 }),
        () => cancelRef.current,
      )
      setJob(current => current ? { ...current, label: "已完成", ratio: 1, failed: result.failed } : current)
      onLibraryChanged()
      setDownloadedCount(loadDownloads().filter(item => item.dramaId === plain.id).length)
      // 让「已完成」停留一瞬再收起，避免进度卡一闪而过
      await new Promise(resolve => setTimeout(() => resolve(undefined), 900))
    } catch (reason) {
      console.error("红果下载失败", String(reason))
    } finally {
      setJob(null)
    }
  }

  async function chooseDownload() {
    const first = loadedRef.current[0]
    if (!first || job) return
    const plans = [1, 5, 10, 20].filter(count => count <= first.episodes.length)
    if (first.episodes.length > 20) plans.push(0) // 0 = 全部
    const labels = plans.map(count => count === 0 ? `下载全部 ${first.episodes.length} 集` : count === 1 ? "只下载第 1 集" : `下载前 ${count} 集`)
    const index = await Dialog.actionSheet({
      title: "离线下载",
      message: `《${plain.title}》共 ${first.episodes.length} 集，按默认清晰度 ${loadSettings().quality}p 解密后存到本机（不进 iCloud）。`,
      actions: labels.map(label => ({ label })),
    })
    if (index === null) return
    const picked = plans[index]
    void startDownload(picked === 0 ? first.episodes.length : picked)
  }

  // 播放页被「返回」掉时，原生播放器 / 解密会话不会自己收（它不挂 React 树）—— 立刻停掉。
  // （也兑底「返回不一定会触发组件卸载」：播放页是原生对象在放声音，不能赌。）
  useEffect(() => {
    let shown = false
    const listener = (presented: boolean) => {
      // 订阅时的首次回调不算「刚被返回」（否则会在挂载白刷一次列表）
      if (presented === shown) return
      shown = presented
      if (presented) return
      finishPlayback()
      onLibraryChanged()
    }
    watchPresented.subscribe(listener)
    return () => { watchPresented.unsubscribe(listener) }
  }, [watchPresented, onLibraryChanged])

  /**
   * 点播放：**不在这里等播放地址**（那 1~2 秒的等待就是它）——
   * 把「还在准备中的第一集」直接交给播放页，页面立刻推开、视频区里自己转圈，
   * 对齐参考脚本 PlayerView 的做法（它也是页面先出现、内部再 loading）。
   */
  function play(episode: Episode, startPosition = 0) {
    if (!info) return
    // 焦点跟过去：评论区切到「本集」，选集也翻到它所在的那一页
    setFocusVid(episode.vid)
    const flat = shown.episodes.findIndex(item => item.vid === episode.vid)
    if (flat >= 0) setEpisodePage(Math.floor(flat / EPISODE_PAGE_SIZE))
    const first = loadedRef.current[0]
    if (!first) return
    const start = first.offset + first.episodes.findIndex(item => item.vid === episode.vid)
    if (start < first.offset) return
    const preparing = resolveAt(start)
    // 播放历史要等清晰度出来才写得对；失败交给播放页显示（这里吞掉，避免未处理的拒绝）
    void preparing.then(playable => {
      recordPlayback(plain, episode.index, playable.quality, startPosition)
      onLibraryChanged()
    }).catch(() => { /* 播放页里会显示错误 + 重试按钮 */ })
    const multi = seasons.length > 1
    const label = (seasonNo: number, episodeNo: number) => multi ? `第${seasonNo}季 · 第${episodeNo}集` : `第${episodeNo}集`
    setWatch({
      title: multi ? parseSeason(shown.title).base || shown.title : shown.title,
      entries: first.episodes.map(item => ({ vid: item.vid, label: label(first.season, item.index) })),
      startIndex: start,
      first: preparing,
      resolve: resolveAt,
      autoNext: loadSettings().autoNext,
      extend,
      startPosition,
      onProgress: (_index, seconds) => recordPosition(plain.id, seconds),
      onSwitch: (index, item) => {
        const ep = episodeAt(index)
        if (!ep) return
        recordPlayback(plain, ep.index, item.quality)
        onLibraryChanged()
      },
    })
    setWatchNonce(value => value + 1)
    watchPresented.setValue(true)
  }

  function changeFavourite() {
    const next = toggleFavourite(plain)
    setFavourite(next)
    onLibraryChanged()
  }

  /** 顶栏那排标签里排第一的**评分**：官网补充信息优先（实时），榜单自带的 score 兜底。 */
  const ratingLabel = extras?.rating ? `${extras.rating} 分` : shown.score ? `${shown.score} 分` : ""

  /** 顶部数据条（收藏 / 点赞 / 热度 / 榜单）。评分已经做成顶部的醒目标签，这里不再重复。 */
  const stats = (extras
    ? [
      extras.favourites ? { label: "收藏", value: formatCount(extras.favourites) } : null,
      extras.likes ? { label: "点赞", value: formatCount(extras.likes) } : null,
      extras.hotText && !shown.hot ? { label: "热度", value: extras.hotText } : null,
      extras.rankLabel ? { label: "榜单", value: extras.rankLabel } : null,
    ].filter(Boolean) as { label: string; value: string }[]
    : [])

  // ---- 评论：整剧精选（9 条）+ 本集精选（15 条，每集不同） ----
  const seriesReviews = extras?.reviews ?? []
  const episodeReviewList = episodeReviews?.data?.reviews ?? []
  const useEpisodeReviews = commentTab === "episode" && episodeReviewList.length > 0
  const activeReviews = useEpisodeReviews ? episodeReviewList : seriesReviews
  const activeTotal = useEpisodeReviews ? episodeReviews?.data?.total : extras?.reviewTotal
  const visibleReviews = reviewsExpanded ? activeReviews : activeReviews.slice(0, REVIEW_PREVIEW)
  const commentSubtitle = episodeReviewList.length
    ? `精选 ${seriesReviews.length} 条 · 本集 ${episodeReviewList.length} 条（切一下看）`
    : extras?.reviewTotal ? `精选 · 共 ${formatCount(extras.reviewTotal)} 条` : undefined

  // ---- 选集分页 ----
  const episodeCount = shown.episodes.length
  const pageCount = Math.max(1, Math.ceil(episodeCount / EPISODE_PAGE_SIZE))
  const safePage = Math.min(episodePage, pageCount - 1)
  const pageEpisodes = shown.episodes.slice(safePage * EPISODE_PAGE_SIZE, safePage * EPISODE_PAGE_SIZE + EPISODE_PAGE_SIZE)
  const pageFrom = episodeCount ? safePage * EPISODE_PAGE_SIZE + 1 : 0
  const pageTo = Math.min(episodeCount, (safePage + 1) * EPISODE_PAGE_SIZE)

  /**
   * 上次看到哪一集 / 第几秒（详情页进来就标出来 + 「继续播放」接着看）
   *
   * ⚠️ 以前是**在 render 里**直接 `loadHistory()` / `loadDownloads()`：前者要 parse + 排序整张历史表，
   *   后者还要逐条 `existsSync` 扫磁盘；而详情页在播放/下载时会频繁 setState
   *   （下载进度每 2MB 一次）→ 每帧同步文件 IO，就是刷屏时“卡一下”的来源。
   *   现在只挂载时读一次，并在「剧变 / 下载数变」时刷新。
   */
  const [resume, setResume] = useState<{ episode: Episode | null; position: number }>(() => readResume())
  const [downloadedVids, setDownloadedVids] = useState<Set<string>>(() => readDownloaded())
  function readResume(): { episode: Episode | null; position: number } {
    const record = loadHistory().find(item => item.drama.id === shown.id)
    if (!record) return { episode: null, position: 0 }
    return {
      episode: shown.episodes.find(item => item.index === record.index) ?? null,
      position: Math.max(0, Math.floor(record.position ?? 0)),
    }
  }
  function readDownloaded(): Set<string> {
    return new Set(loadDownloads().filter(item => item.dramaId === shown.id).map(item => item.vid))
  }
  useEffect(() => {
    setResume(readResume())
    setDownloadedVids(readDownloaded())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.id, downloadedCount, info])
  const historyEpisode = resume.episode
  const resumePosition = resume.position

/** 选集网格的列定义：列数固定，提到模块级，避免每次 render 都新建一个数组（SwiftUI 会当成“列变了”重算）。 */
const episodeCells: { size: { type: "flexible" }; spacing: number }[] = []
for (let index = 0; index < EPISODE_COLUMNS; index++) episodeCells.push({ size: { type: "flexible" }, spacing: GRID_SPACING })

  const reviewRow = (review: { user: string; avatar: string; time: string; content: string; likes: string }, key: string) => <HStack key={key} spacing={10} alignment="top" frame={{ maxWidth: "infinity" }}>
    {review.avatar
      ? <Image imageUrl={review.avatar} frame={{ width: 34, height: 34 }} clipShape="circle" resizable={true} scaleToFill={true} />
      : <Rectangle frame={{ width: 34, height: 34 }} foregroundStyle="tertiarySystemFill" clipShape="circle" />}
    <VStack spacing={4} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
      <HStack spacing={8} alignment="center" frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Text font="caption" fontWeight="medium" foregroundStyle="secondaryLabel" lineLimit={1}>{review.user}</Text>
        {relativeTime(review.time) ? <Text font="caption2" foregroundStyle="tertiaryLabel">{relativeTime(review.time)}</Text> : undefined}
      </HStack>
      <Text font="footnote" lineLimit={reviewsExpanded ? undefined : 3} multilineTextAlignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>{review.content}</Text>
      {review.likes && review.likes !== "0" ? <HStack spacing={4} alignment="center" frame={{ maxWidth: "infinity", alignment: "leading" }}>
        <Image systemName="hand.thumbsup" font="caption2" foregroundStyle="tertiaryLabel" />
        <Text font="caption2" foregroundStyle="tertiaryLabel">{formatCount(review.likes)}</Text>
      </HStack> : undefined}
    </VStack>
  </HStack>

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
    <PageBackground />
    <ScrollView navigationTitle="短剧详情" navigationBarTitleDisplayMode="inline" refreshable={() => load(activeId, true)}
      navigationDestination={{ isPresented: watchPresented, content: watch ? <WatchPage key={watchNonce} playlist={watch} meta={{ intro: shown.intro, tags: shown.tags }} /> : <VStack /> }}>
      <VStack spacing={22} alignment="leading" padding={{ horizontal: PAGE_PADDING, top: 10, bottom: PAGE_BOTTOM_PADDING }}>
        <HStack spacing={16} alignment="top" frame={{ maxWidth: "infinity" }}>
          <DramaArtwork drama={shown} width={126} height={Math.round(126 * COVER_ASPECT)} />
          <VStack spacing={8} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
            <Text font="title2" fontWeight="bold" lineLimit={5} multilineTextAlignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>{shown.title}</Text>
            <HStack spacing={6} alignment="center" frame={{ maxWidth: "infinity", alignment: "leading" }}>
              {ratingLabel ? <TagLabel text={ratingLabel} highlighted /> : undefined}
              {shown.statusTag ? <TagLabel text={shown.statusTag} /> : undefined}
              {shown.hot ? <TagLabel text={shown.hot} /> : undefined}
            </HStack>
            <ScrollView axes="horizontal" scrollIndicator="hidden">
              <HStack spacing={6} alignment="center">
                {ratingLabel && extras?.ratingCount ? <TagLabel text={`${formatCount(extras.ratingCount)} 人评`} /> : undefined}
                {(shown.tags.length ? shown.tags : ["短剧"]).slice(0, 6).map(tag => <TagLabel key={tag} text={tag} />)}
              </HStack>
            </ScrollView>
            <VStack spacing={9} alignment="leading" frame={{ maxWidth: "infinity" }}>
              <HStack spacing={9} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                <Button title={favourite ? "已收藏" : "收藏"} systemImage={favourite ? "heart.fill" : "heart"} tint={favourite ? "systemRed" : ACCENT} frame={{ minHeight: 40 }} action={changeFavourite} />
                <Button title="下载" systemImage="arrow.down.circle" frame={{ minHeight: 40 }} disabled={job !== null} action={() => { void chooseDownload() }} />
                {downloadedCount ? <Text font="caption" foregroundStyle="secondaryLabel">{`已离线 ${downloadedCount} 集`}</Text> : undefined}
              </HStack>
              {shown.episodes.length ? <Button
                title={historyEpisode ? `继续播放 · 第 ${historyEpisode.index} 集${resumePosition > 3 ? ` · ${formatDuration(resumePosition)}` : ""}` : "从第 1 集播放"}
                systemImage={historyEpisode ? "play.circle.fill" : "play.fill"}
                tint={ACCENT} frame={{ maxWidth: "infinity", minHeight: 40 }}
                action={() => play(historyEpisode ?? shown.episodes[0], historyEpisode ? resumePosition : 0)} /> : undefined}
            </VStack>
          </VStack>
        </HStack>

        {stats.length ? <ScrollView axes="horizontal" scrollIndicator="hidden" frame={{ maxWidth: "infinity" }}>
          <HStack spacing={10}>
            {stats.map(item => <VStack key={item.label} spacing={3} padding={{ horizontal: 14, vertical: 10 }} background="secondarySystemFill" clipShape={{ type: "rect", cornerRadius: 14, style: "continuous" }} frame={{ minWidth: 84 }}>
              <Text font="subheadline" fontWeight="semibold" lineLimit={1}>{item.value}</Text>
              <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>{item.label}</Text>
            </VStack>)}
          </HStack>
        </ScrollView> : undefined}

        {extras?.celebrities.length ? <VStack spacing={10} alignment="leading" frame={{ maxWidth: "infinity" }}>
          <SectionHeading title="演员" subtitle={`共 ${extras.celebrities.length} 位`} />
          <ScrollView axes="horizontal" scrollIndicator="hidden">
            <HStack spacing={16}>
              {extras.celebrities.map((person, index) => <VStack key={`${person.name}-${index}`} spacing={6} frame={{ width: 76 }}>
                {person.avatar
                  ? <Image imageUrl={person.avatar} frame={{ width: 76, height: 76 }} clipShape="circle" resizable={true} scaleToFill={true} />
                  : <Rectangle frame={{ width: 76, height: 76 }} foregroundStyle="tertiarySystemFill" clipShape="circle" />}
                <Text font="caption" fontWeight="medium" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "center" }}>{person.name}</Text>
                {person.role ? <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "center" }}>{person.role}</Text> : undefined}
              </VStack>)}
            </HStack>
          </ScrollView>
        </VStack> : undefined}

        {job ? <VStack spacing={8} padding={14} frame={{ maxWidth: "infinity", alignment: "leading" }} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 16, style: "continuous" }}>
          <HStack spacing={9} frame={{ maxWidth: "infinity" }}>
            {job.label === "已完成" ? <Image systemName="checkmark.circle.fill" foregroundStyle="systemGreen" /> : <ProgressView progressViewStyle="circular" tint={ACCENT} />}
            <Text font="subheadline" fontWeight="medium" lineLimit={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
              {job.label === "已完成" ? `已下载 ${job.total - job.failed}/${job.total} 集，可在右上角「下载」里离线看` : `正在下载 ${job.index}/${job.total} · ${Math.round(job.ratio * 100)}%`}
            </Text>
            {job.label === "已完成" ? undefined : <Button title="取消" tint="systemRed" action={() => { cancelRef.current = true }} />}
          </HStack>
          <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" }}>{job.label}</Text>
        </VStack> : undefined}

        {seasons.length > 1 ? <VStack spacing={10} alignment="leading" frame={{ maxWidth: "infinity" }}>
          <SectionHeading title="季" subtitle={`${seasons.length} 季（每个都确认过能打开）· 一季播完会自动接下一季`} />
          <ScrollView axes="horizontal" scrollIndicator="hidden">
            <HStack spacing={9}>
              {seasons.map(item => <Chip key={item.id} title={`第${item.season}季`} selected={item.id === (info?.id ?? activeId)} secondary disabled={loading}
                action={() => { if (item.id !== activeId) setActiveId(item.id) }} />)}
            </HStack>
          </ScrollView>
          {switchError ? <HStack spacing={8} padding={12} frame={{ maxWidth: "infinity", alignment: "leading" }} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 14, style: "continuous" }}>
            <Image systemName="exclamationmark.triangle.fill" foregroundStyle="systemOrange" />
            <Text font="footnote" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }}>{switchError}</Text>
          </HStack> : undefined}
        </VStack> : undefined}

        {shown.intro ? <VStack spacing={8} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
          <SectionHeading title="剧情简介" />
          <Text font="body" foregroundStyle="secondaryLabel" multilineTextAlignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>{shown.intro}</Text>
        </VStack> : undefined}

        {healed ? <HStack spacing={8} padding={12} frame={{ maxWidth: "infinity", alignment: "leading" }} background="secondarySystemBackground" clipShape={{ type: "rect", cornerRadius: 14, style: "continuous" }}>
          <Image systemName="wand.and.stars" foregroundStyle={ACCENT} />
          <Text font="footnote" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }}>{healed}</Text>
        </HStack> : undefined}

        {loading ? <LoadingState title="正在读取剧集" minHeight={180} />
          : error ? (missing ? <StaleCard id={activeId} message={error} onRetry={() => { void load(activeId) }} onRemoved={onLibraryChanged} />
            : <StateCard title="详情加载失败" description={error} systemImage="wifi.exclamationmark" tint="systemRed" actionTitle="重新加载" action={() => { void load(activeId) }} />)
          : <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity" }}>
            <SectionHeading title="选集" subtitle={episodeCount ? `共 ${episodeCount} 集 · 本页第 ${pageFrom}–${pageTo} 集` : undefined} />
            <LazyVGrid columns={episodeCells} alignment="leading" spacing={10} frame={{ maxWidth: "infinity" }}>
              {pageEpisodes.map(episode => {
                const isFocus = episode.vid === focusVid || (!focusVid && episode.index === historyEpisode?.index)
                const isDownloaded = downloadedVids.has(episode.vid)
                return <Button key={episode.vid} action={() => play(episode)} buttonStyle="plain" frame={{ maxWidth: "infinity", minHeight: 46 }} accessibilityLabel={`第 ${episode.index} 集${isDownloaded ? "（已下载）" : ""}，播放`}>
                  <Text font="subheadline" fontWeight={isFocus ? "semibold" : "medium"} foregroundStyle={isFocus ? "black" : isDownloaded ? "systemGreen" : ACCENT} frame={{ maxWidth: "infinity", minHeight: 46 }}
                    background={isFocus ? ACCENT : "secondarySystemFill"} clipShape={{ type: "rect", cornerRadius: 11, style: "continuous" }}>{String(episode.index)}</Text>
                </Button>
              })}
            </LazyVGrid>
            {pageCount > 1 ? <VStack spacing={10} alignment="leading" frame={{ maxWidth: "infinity" }}>
              <HStack spacing={9} frame={{ maxWidth: "infinity", alignment: "center" }}>
                <Button title="上一页" systemImage="chevron.left" disabled={safePage === 0} frame={{ minHeight: 38 }} action={() => setEpisodePage(Math.max(0, safePage - 1))} />
                <Text font="subheadline" fontWeight="medium" frame={{ maxWidth: "infinity", alignment: "center" }}>{`第 ${safePage + 1} / ${pageCount} 页`}</Text>
                <Button title="下一页" systemImage="chevron.right" disabled={safePage >= pageCount - 1} frame={{ minHeight: 38 }} action={() => setEpisodePage(Math.min(pageCount - 1, safePage + 1))} />
              </HStack>
              <ScrollView axes="horizontal" scrollIndicator="hidden">
                <HStack spacing={8}>
                  {Array.from({ length: pageCount }, (_, index) => <Chip key={`page-${index}`} title={`${index * EPISODE_PAGE_SIZE + 1}-${Math.min(episodeCount, (index + 1) * EPISODE_PAGE_SIZE)}`} selected={index === safePage} secondary action={() => setEpisodePage(index)} />)}
                </HStack>
              </ScrollView>
            </VStack> : undefined}
            {!episodeCount ? <StateCard title="暂无剧集" description="当前短剧没有返回可分集，下拉刷新后再试。" systemImage="rectangle.stack.badge.minus" actionTitle="刷新" action={() => { void load(activeId) }} /> : undefined}
          </VStack>}

        {activeReviews.length ? <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity" }}>
          <SectionHeading title="评论" subtitle={commentSubtitle} />
          {episodeReviewList.length ? <HStack spacing={9}>
            <Chip title={`精选 ${seriesReviews.length}`} selected={!useEpisodeReviews} action={() => { setCommentTab("series"); setReviewsExpanded(false) }} />
            <Chip title={`第 ${episodeReviews?.index ?? 1} 集 ${episodeReviewList.length}`} selected={useEpisodeReviews} secondary action={() => { setCommentTab("episode"); setReviewsExpanded(false) }} />
          </HStack> : undefined}
          {visibleReviews.map((review, index) => reviewRow(review, `${review.user}-${index}`))}
          {activeReviews.length > REVIEW_PREVIEW ? <Button title={reviewsExpanded ? "收起" : `展开全部 ${activeReviews.length} 条`} systemImage={reviewsExpanded ? "chevron.up" : "chevron.down"} tint={ACCENT} frame={{ maxWidth: "infinity", minHeight: 40 }} action={() => setReviewsExpanded(!reviewsExpanded)} /> : undefined}
          {activeTotal ? <Text font="caption2" foregroundStyle="tertiaryLabel" multilineTextAlignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>{`红果上${useEpisodeReviews ? "这一集" : "这部剧"}共有 ${formatCount(activeTotal)} 条评论；网页端只放出精选的这几条，完整列表在红果 App 里。`}</Text> : undefined}
        </VStack> : undefined}

      </VStack>
    </ScrollView>
  </ZStack>
}
