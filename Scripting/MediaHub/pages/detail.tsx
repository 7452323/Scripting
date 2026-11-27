import {
  Button,
  Device,
  HStack,
  Image,
  Navigation,
  NavigationStack,
  Picker,
  ProgressView,
  Rectangle,
  ScrollView,
  Spacer,
  Text,
  VStack,
  ZStack,
  fetch,
  gradient,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "scripting"
import type { Color, LinearGradient } from "scripting"
import { pageToolbar } from "./chrome"
import { RemoteImage } from "../imageLoader"
import { presentPlayer } from "../player"
import { loadSourcesConfig } from "../sources/config"
import { cloud115GetPlayUrl } from "../sources/cloud115"
import {
  isFavoriteGroup,
  loadHistory,
  loadScrapeLibrary,
  loadSettings,
  loadWatched,
  markWatched,
  toggleFavoriteGroup,
  toggleWatched,
  type ScrapeEntry,
} from "../storage"
import {
  buildMediaGroups,
  firstUnwatched,
  nextEpisodeOf,
  resumeEpisode,
  type MediaGroup,
  type MediaSeason,
} from "../sources/mediaGroups"

const PAD = 16
const POSTER_W = 108
const POSTER_H = 162
const HERO_H = 236
const ROUND_HERO = { type: "rect", cornerRadius: 18, style: "continuous" } as const
const ROUND_POSTER = { type: "rect", cornerRadius: 12, style: "continuous" } as const
const ROUND_CARD = { type: "rect", cornerRadius: 14, style: "continuous" } as const

const HERO_SCRIM = gradient("linear", {
  colors: ["rgba(0,0,0,0)", "rgba(0,0,0,0.45)", "rgba(0,0,0,0.9)"],
  startPoint: { x: 0.5, y: 0.05 },
  endPoint: { x: 0.5, y: 1 },
})

function contentWidth(): number {
  const scene = Device.sceneBounds?.width ?? Device.screen.width
  const insets = Device.safeAreaInsets
  const usable =
    Math.min(scene, Device.screen.width) - (insets?.leading ?? 0) - (insets?.trailing ?? 0)
  return Math.max(320, Math.round(usable))
}

function posterFallback(seed: string): LinearGradient {
  let h = 7
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 9973
  const palettes: [Color, Color][] = [
    ["#1f1c4b", "#5b6ff0"],
    ["#2b1055", "#7597de"],
    ["#0f2027", "#2c5364"],
    ["#3a1c71", "#c76b98"],
  ]
  const [a, b] = palettes[h % palettes.length]
  return gradient("linear", {
    colors: [a, b],
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 1, y: 1 },
  })
}

function pad2(n?: number): string {
  if (n == null) return "--"
  return n < 10 ? `0${n}` : `${n}`
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/* ------------------------------ 演职人员 ------------------------------ */

const creditsCache = new Map<string, { director: string[]; cast: string[] }>()

async function fetchCredits(
  apiKey: string,
  tmdbId: number,
  type: "movie" | "series"
): Promise<{ director: string[]; cast: string[] } | null> {
  const cacheKey = `${type}_${tmdbId}`
  const cached = creditsCache.get(cacheKey)
  if (cached) return cached
  try {
    const path = type === "movie" ? "movie" : "tv"
    const res = await fetch(
      `https://api.themoviedb.org/3/${path}/${tmdbId}/credits?api_key=${encodeURIComponent(apiKey)}&language=zh-CN`,
      { timeout: 20 }
    )
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    const crew: any[] = data?.crew || []
    const castRaw: any[] = data?.cast || []
    const director =
      type === "movie"
        ? crew.filter(c => c?.job === "Director").map(c => String(c.name)).slice(0, 2)
        : crew
            .filter(c => c?.job === "Executive Producer" || c?.job === "Director")
            .map(c => String(c.name))
            .slice(0, 2)
    const cast = castRaw.map(c => String(c.name)).slice(0, 6)
    const value = { director, cast }
    creditsCache.set(cacheKey, value)
    return value
  } catch {
    return null
  }
}

/* ------------------------------ 相似推荐 ------------------------------ */

export interface TmdbRec {
  tmdbId: number
  title: string
  poster?: string
  year?: string
}

const recCache = new Map<string, TmdbRec[]>()

/** TMDB /recommendations（SenPlayer 的“相似推荐”同源） */
async function fetchRecommendations(
  apiKey: string,
  tmdbId: number,
  type: "movie" | "series"
): Promise<TmdbRec[]> {
  const cacheKey = `${type}_${tmdbId}`
  const cached = recCache.get(cacheKey)
  if (cached) return cached
  try {
    const path = type === "movie" ? "movie" : "tv"
    const res = await fetch(
      `https://api.themoviedb.org/3/${path}/${tmdbId}/recommendations?api_key=${encodeURIComponent(apiKey)}&language=zh-CN&page=1`,
      { timeout: 20 }
    )
    if (!res.ok) return []
    const data = await res.json().catch(() => null)
    const list: any[] = data?.results || []
    const out: TmdbRec[] = list.slice(0, 12).map(item => ({
      tmdbId: Number(item.id),
      title: String(item.title || item.name || "未知"),
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : undefined,
      year: String(item.release_date || item.first_air_date || "").slice(0, 4) || undefined,
    }))
    recCache.set(cacheKey, out)
    return out
  } catch {
    return []
  }
}

/* ------------------------------ 详情页 ------------------------------ */

export async function presentDetail(group: MediaGroup): Promise<void> {
  await Navigation.present({
    element: <DetailPage group={group} />,
    modalPresentationStyle: "fullScreen",
  })
}

/** 外层：支持在详情页内切换影视（点相似推荐）而不嵌套 modal */
export function DetailPage({ group }: { group: MediaGroup }) {
  const [active, setActive] = useState<MediaGroup>(group)
  return <DetailBody key={active.key} group={active} onOpenGroup={setActive} />
}

export function DetailBody({
  group,
  onOpenGroup,
}: {
  group: MediaGroup
  onOpenGroup: (group: MediaGroup) => void
}) {
  const dismiss = Navigation.useDismiss()
  const [tick, setTick] = useState(0)
  const [playing, setPlaying] = useState<string | null>(null)
  const [status, setStatus] = useState("")
  const [credits, setCredits] = useState<{ director: string[]; cast: string[] } | null>(null)
  const [recommendations, setRecommendations] = useState<TmdbRec[]>([])
  /** 播放结束后待播的下一集（自动连播用，避免在异步回调里直接 present） */
  const nextRef = useRef<ScrapeEntry | null>(null)
  const [season, setSeason] = useState<number>(() => group.seasons[0]?.season ?? 1)
  const [fav, setFav] = useState<boolean>(() => isFavoriteGroup(group.key))
  const [watched, setWatched] = useState<string[]>(() => loadWatched())
  const [versionPick, setVersionPick] = useState<number | null>(null)

  const watchedSet = useMemo(() => new Set(watched), [watched])

  // 播放进度表（pickCode → 0~1）与秒数（继续播放用）
  const { progressMap, secondsMap } = useMemo(() => {
    const progress = new Map<string, number>()
    const seconds = new Map<string, number>()
    for (const h of loadHistory()) {
      if (!h.mediaId.startsWith("115_") || h.duration <= 0) continue
      const pick = h.mediaId.slice(4)
      progress.set(pick, Math.min(1, h.progress / h.duration))
      seconds.set(pick, h.progress)
    }
    return { progressMap: progress, secondsMap: seconds }
  }, [tick])

  const progressOf = (entry: ScrapeEntry) => progressMap.get(entry.refId) ?? 0

  useEffect(() => {
    const cfg = loadSourcesConfig()
    if (!cfg.tmdbApiKey || !group.tmdbId) return
    let alive = true
    fetchCredits(cfg.tmdbApiKey, group.tmdbId, group.type).then(v => {
      if (alive && v) setCredits(v)
    })
    fetchRecommendations(cfg.tmdbApiKey, group.tmdbId, group.type).then(v => {
      if (alive) setRecommendations(v)
    })
    return () => {
      alive = false
    }
  }, [group.key])

  const playEntry = async (entry: ScrapeEntry, fromStart = false) => {
    if (playing) return
    try {
      let current: ScrapeEntry | null = entry
      let startFromBeginning = fromStart

      while (current) {
        const target: ScrapeEntry = current
        setPlaying(target.id)
        setStatus(`正在获取播放地址：${target.title}`)

        const cfg = loadSourcesConfig()
        const got = await cloud115GetPlayUrl(cfg.cloud115, target.refId)
        setStatus("")
        const epLabel =
          target.episode != null
            ? `${group.title} S${pad2(target.season ?? 1)}E${pad2(target.episode)}`
            : group.title

        nextRef.current = null
        await presentPlayer({
          url: got.url,
          title: epLabel,
          poster: target.poster ?? group.poster,
          headers: got.headers,
          mediaId: target.id,
          startTime: startFromBeginning ? 0 : secondsMap.get(target.refId) ?? 0,
          onEnded: () => {
            markWatched([target.id], true)
            // 记下下一集，等播放器关掉后再起播（不在异步回调里 present）
            if (group.type === "series" && loadSettings().autoPlayNext) {
              nextRef.current = nextEpisodeOf(group, target)
            }
          },
        })

        setWatched(loadWatched())
        setTick(t => t + 1)

        const next = nextRef.current
        nextRef.current = null
        current = next
        startFromBeginning = false
      }
    } catch (e: any) {
      setStatus(e?.message || "播放失败")
    } finally {
      setPlaying(null)
    }
  }

  const resume = resumeEpisode(group, progressOf)
  const nextUp = group.type === "series" ? firstUnwatched(group, id => watchedSet.has(id)) : null
  const primaryEntry =
    group.type === "movie"
      ? resume?.entry ?? null
      : resume && resume.progress > 0.02
        ? resume.entry
        : nextUp ?? resume?.entry ?? null
  const primaryFromStart = false
  const playLabel =
    group.type === "movie"
      ? resume && resume.progress > 0.02
        ? "继续播放"
        : "播放"
      : resume && resume.progress > 0.02
        ? `继续观看 · S${pad2(resume.entry.season ?? 1)}E${pad2(resume.entry.episode)}`
        : nextUp
          ? `播放 · S${pad2(nextUp.season ?? 1)}E${pad2(nextUp.episode)}`
          : "重新播放"

  const activeSeason: MediaSeason | undefined =
    group.seasons.find(s => s.season === season) ?? group.seasons[0]

  const versionList =
    versionPick == null
      ? []
      : (activeSeason?.episodes ?? []).filter(e => (e.episode ?? 0) === versionPick)

  const recWidth = Math.floor((contentWidth() - PAD * 2 - 20) / 3)

  const metaParts = [
    group.year,
    group.category,
    group.type === "series" ? `${group.episodeCount} 集` : undefined,
    group.seasons.length > 1 ? `${group.seasons.length} 季` : undefined,
  ].filter(Boolean) as string[]

  return (
    <NavigationStack>
      <ScrollView
        navigationTitle={group.title}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          ...pageToolbar(() => dismiss()),
          topBarTrailing: (
            <HStack spacing={0}>
              <Button
                action={() => setFav(toggleFavoriteGroup(group.key))}
                buttonStyle="plain"
                frame={{ width: 44, height: 44 }}
                contentShape="rect"
                accessibilityLabel={fav ? "取消收藏" : "收藏"}
              >
                <Image
                  systemName={fav ? "heart.fill" : "heart"}
                  font="headline"
                  foregroundStyle={fav ? "systemRed" : "label"}
                />
              </Button>
              {pageToolbar(() => dismiss()).topBarTrailing}
            </HStack>
          ),
        }}
        scrollIndicator="never"
      >
        <VStack alignment="leading" spacing={16} padding={{ bottom: 40 }}>
          {/* 背景大图 */}
          <ZStack frame={{ width: contentWidth(), height: HERO_H }}>
            <Rectangle
              fill={posterFallback(group.title)}
              frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            />
            {group.backdrop || group.poster ? (
              <RemoteImage
                url={group.backdrop ?? group.poster}
                width={contentWidth()}
                height={HERO_H}
              />
            ) : null}
            <Rectangle fill={HERO_SCRIM} frame={{ maxWidth: "infinity", maxHeight: "infinity" }} />
          </ZStack>

          {/* 海报 + 基本信息 + 播放按钮 */}
          <HStack alignment="top" spacing={14} padding={{ horizontal: PAD }}>
            <ZStack frame={{ width: POSTER_W, height: POSTER_H }} clipShape={ROUND_POSTER}>
              <Rectangle
                fill={posterFallback(group.title)}
                frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
              />
              {group.poster ? (
                <RemoteImage url={group.poster} width={POSTER_W} height={POSTER_H} radius={12} />
              ) : (
                <Text font="title2" fontWeight="bold" foregroundStyle="rgba(255,255,255,0.9)">
                  {group.title.slice(0, 2)}
                </Text>
              )}
            </ZStack>

            <VStack alignment="leading" spacing={8} frame={{ maxWidth: "infinity" }}>
              <Text font="title3" fontWeight="bold" lineLimit={2}>
                {group.title}
              </Text>
              <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>
                {metaParts.join(" · ") || "115 网盘"}
              </Text>
              {group.rating ? (
                <HStack spacing={4}>
                  <Image systemName="star.fill" font="caption" foregroundStyle="systemOrange" />
                  <Text font="caption" fontWeight="semibold">
                    {group.rating.toFixed(1)}
                  </Text>
                </HStack>
              ) : null}
              <Button
                title={playLabel}
                systemImage="play.fill"
                buttonStyle="borderedProminent"
                disabled={!primaryEntry}
                action={() => {
                  if (primaryEntry) playEntry(primaryEntry, primaryFromStart)
                }}
              />
              {resume && resume.progress > 0.02 ? (
                <Button
                  title="从头播放"
                  systemImage="gobackward"
                  buttonStyle="bordered"
                  action={() => {
                    if (resume) playEntry(resume.entry, true)
                  }}
                />
              ) : null}
              {status ? (
                <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={2}>
                  {status}
                </Text>
              ) : null}
            </VStack>
          </HStack>

          {/* 简介 */}
          {group.overview ? (
            <VStack alignment="leading" spacing={6} padding={{ horizontal: PAD }}>
              <Text font="headline">简介</Text>
              <Text font="subheadline" foregroundStyle="secondaryLabel" lineLimit={8}>
                {group.overview}
              </Text>
            </VStack>
          ) : null}

          {/* 演职人员 */}
          {credits && (credits.director.length > 0 || credits.cast.length > 0) ? (
            <VStack alignment="leading" spacing={6} padding={{ horizontal: PAD }}>
              <Text font="headline">演职人员</Text>
              {credits.director.length > 0 ? (
                <Text font="subheadline" foregroundStyle="secondaryLabel" lineLimit={2}>
                  导演：{credits.director.join(" / ")}
                </Text>
              ) : null}
              {credits.cast.length > 0 ? (
                <Text font="subheadline" foregroundStyle="secondaryLabel" lineLimit={2}>
                  演员：{credits.cast.join(" / ")}
                </Text>
              ) : null}
            </VStack>
          ) : null}

          {/* 相似推荐（TMDB recommendations，对齐 SenPlayer） */}
          {recommendations.length > 0 ? (
            <VStack alignment="leading" spacing={8} padding={{ horizontal: PAD }}>
              <Text font="headline">相似推荐</Text>
              <VStack alignment="leading" spacing={12}>
                {chunk(recommendations, 3).map((row, rowIndex) => (
                  <HStack key={`rec_${rowIndex}`} spacing={10} alignment="top">
                    {row.map(rec => (
                      <Button
                        key={rec.tmdbId}
                        buttonStyle="plain"
                        contentShape="rect"
                        action={() => {
                          const local = buildMediaGroups(loadScrapeLibrary()).find(
                            g => g.tmdbId === rec.tmdbId
                          )
                          if (local) onOpenGroup(local)
                          else setStatus(`「${rec.title}」不在你的刮削库里`)
                        }}
                      >
                        <VStack alignment="leading" spacing={4} frame={{ width: recWidth }}>
                          <ZStack
                            frame={{ width: recWidth, height: Math.round(recWidth * 1.5) }}
                            clipShape={ROUND_POSTER}
                          >
                            <Rectangle
                              fill={posterFallback(rec.title)}
                              frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
                            />
                            {rec.poster ? (
                              <RemoteImage
                                url={rec.poster}
                                width={recWidth}
                                height={Math.round(recWidth * 1.5)}
                                radius={12}
                              />
                            ) : null}
                          </ZStack>
                          <Text
                            font="caption2"
                            lineLimit={2}
                            frame={{ width: recWidth, height: 28, alignment: "leading" }}
                          >
                            {rec.title}
                          </Text>
                        </VStack>
                      </Button>
                    ))}
                    {row.length < 3 ? <VStack frame={{ width: recWidth }} /> : null}
                  </HStack>
                ))}
              </VStack>
            </VStack>
          ) : null}

          {/* 剧集：季 + 集 */}
          {group.type === "series" && activeSeason ? (
            <VStack
              alignment="leading"
              spacing={10}
              padding={{ horizontal: PAD }}
              confirmationDialog={{
                title: "选择版本",
                isPresented: versionPick != null,
                onChanged: v => {
                  if (!v) setVersionPick(null)
                },
                actions: (
                  <VStack>
                    {versionList.map((e, i) => (
                      <Button
                        key={e.id}
                        title={`版本 ${i + 1}`}
                        action={() => {
                          setVersionPick(null)
                          playEntry(e)
                        }}
                      />
                    ))}
                    <Button
                      title="取消"
                      action={() => setVersionPick(null)}
                    />
                  </VStack>
                ),
              }}
            >
              <Text font="headline">剧集</Text>
              {group.seasons.length > 1 ? (
                <Picker
                  title="季"
                  value={String(season)}
                  onChanged={(v: string) => setSeason(Number(v))}
                  pickerStyle="segmented"
                >
                  {group.seasons.map(s => (
                    <Text key={String(s.season)} tag={String(s.season)}>
                      第{s.season}季
                    </Text>
                  ))}
                </Picker>
              ) : null}

              <VStack alignment="leading" spacing={6}>
                <Button
                  title="全部标记已看"
                  systemImage="checkmark.circle"
                  buttonStyle="bordered"
                  action={() => {
                    if (!activeSeason) return
                    markWatched(activeSeason.episodes.map(e => e.id), true)
                    setWatched(loadWatched())
                  }}
                />
                {activeSeason.episodes.map(entry => {
                  const p = progressOf(entry)
                  const busy = playing === entry.id
                  const seen = watchedSet.has(entry.id)
                  const versions = activeSeason.episodes.filter(
                    e => (e.episode ?? 0) === (entry.episode ?? 0)
                  )
                  if (versions.length > 1 && versions[0].id !== entry.id) return null
                  return (
                    <HStack key={entry.id} spacing={6} frame={{ maxWidth: "infinity" }}>
                    <Button action={() => playEntry(entry)}>
                      <HStack
                        spacing={10}
                        padding={{ vertical: 6 }}
                        frame={{ maxWidth: "infinity" }}
                        contentShape="rect"
                      >
                        <Text
                          font="caption"
                          fontWeight="semibold"
                          foregroundStyle="secondaryLabel"
                          fixedSize={{ horizontal: true, vertical: false }}
                        >
                          {`E${pad2(entry.episode)}`}
                        </Text>
                        <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity" }}>
                          <Text font="subheadline" lineLimit={1}>
                            {entry.title === group.title
                              ? `第${entry.episode ?? 1}集`
                              : entry.title}
                          </Text>
                          <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                            {p > 0.02 ? `已看 ${Math.round(p * 100)}%` : entry.fileName}
                          </Text>
                        </VStack>
                        {busy ? (
                          <ProgressView />
                        ) : (
                          <Image
                            systemName="play.circle.fill"
                            font="title3"
                            foregroundStyle="systemIndigo"
                          />
                        )}
                      </HStack>
                    </Button>
                    {versions.length > 1 ? (
                      <Button
                        action={() => setVersionPick(entry.episode ?? 0)}
                        buttonStyle="plain"
                        contentShape="rect"
                        accessibilityLabel="选择版本"
                      >
                        <Text
                          font="caption2"
                          fontWeight="semibold"
                          foregroundStyle="systemIndigo"
                          fixedSize={{ horizontal: true, vertical: false }}
                        >
                          {versions.length} 版
                        </Text>
                      </Button>
                    ) : null}
                    <Button
                      action={() => {
                        toggleWatched(entry.id)
                        setWatched(loadWatched())
                      }}
                      buttonStyle="plain"
                      frame={{ width: 34, height: 34 }}
                      contentShape="rect"
                      accessibilityLabel={seen ? "标记为未观看" : "标记为已观看"}
                    >
                      <Image
                        systemName={seen ? "checkmark.circle.fill" : "circle"}
                        font="body"
                        foregroundStyle={seen ? "systemGreen" : "secondaryLabel"}
                      />
                    </Button>
                    </HStack>
                  )
                })}
              </VStack>
            </VStack>
          ) : null}

          {/* 电影：同一条目只有一个文件，播放按钮已在上方 */}
          {group.type === "movie" ? (
            <VStack alignment="leading" spacing={6} padding={{ horizontal: PAD }}>
              <Text font="headline">文件</Text>
              <VStack
                alignment="leading"
                spacing={4}
                padding={12}
                background="secondarySystemBackground"
                clipShape={ROUND_CARD}
              >
                <Text font="subheadline" lineLimit={2}>
                  {group.entries[0]?.fileName}
                </Text>
                <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                  {group.entries[0]?.folderPath}
                </Text>
              </VStack>
            </VStack>
          ) : null}
        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}
