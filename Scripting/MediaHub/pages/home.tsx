import {
  Button,
  Circle,
  HStack,
  Image,
  NavigationStack,
  ProgressView,
  Rectangle,
  ScrollView,
  Spacer,
  Text,
  VStack,
  ZStack,
  gradient,
  useEffect,
  useMemo,
  useState,
} from "scripting"
import type { Color, LinearGradient } from "scripting"
import { pageToolbar } from "./chrome"
import { RemoteImage } from "../imageLoader"
import { presentPlayer } from "../player"
import {
  loadSourcesConfig,
  saveSourcesConfig,
  type HomeSource,
} from "../sources/config"
import type { HomeShelf } from "../types"
import {
  embyHome,
  embyPlaybackUrl,
  embyReportProgress,
  embySeriesNextEpisode,
  type EmbyCard,
} from "../sources/emby"
import { plexHome } from "../sources/plex"
import { cloud115GetPlayUrl, cloud115Home } from "../sources/cloud115"
import { buildMediaGroups, findGroupByPickCode } from "../sources/mediaGroups"
import { loadScrapeLibrary } from "../storage"
import { presentDetail } from "./detail"

const AUTO_ROTATE_MS = 5000
const HERO_HEIGHT = 232
const PAGE_PADDING = 16
const ROW_GAP = 12

const ROUND_HERO = { type: "rect", cornerRadius: 20, style: "continuous" } as const
const CARD_RADIUS = 16
const ROUND_CARD = { type: "rect", cornerRadius: CARD_RADIUS, style: "continuous" } as const
const CAPSULE = { type: "capsule", style: "continuous" } as const

const SOURCE_META: Record<HomeSource, { label: string; icon: string; hint: string; empty: string }> = {
  emby: {
    label: "Emby",
    icon: "play.tv.fill",
    hint: "去「设置」→ 添加媒体源 → Emby，填好地址并登录后，这里会变成你的媒体库首页。",
    empty: "Emby 已连接，但这个库里还没有可显示的影片。",
  },
  plex: {
    label: "Plex",
    icon: "play.rectangle.fill",
    hint: "去「设置」→ Plex → 登录，登录后会自动发现服务器。",
    empty: "Plex 已登录，但还没有媒体库内容。",
  },
  "115": {
    label: "115 网盘",
    icon: "cloud.fill",
    hint: "去「设置」→ 115 网盘 → 扫码登录，再到「媒体库」→「115 网盘」刮削一个文件夹。",
    empty: "115 已登录。去「媒体库」→「115 网盘」进入文件夹点「刮削此文件夹」，这里就会出现海报墙。",
  },
}

/** 页面可用宽度：取窗口宽与屏宽的较小值，再扣掉左右安全区 */
function pageContentWidth(): number {
  const scene = Device.sceneBounds?.width ?? Device.screen.width
  const insets = Device.safeAreaInsets
  const usable =
    Math.min(scene, Device.screen.width) -
    (insets?.leading ?? 0) -
    (insets?.trailing ?? 0)
  return Math.max(320, Math.round(usable))
}

const PALETTES: [Color, Color][] = [
  ["#1f1c4b", "#5b6ff0"],
  ["#2b1055", "#7597de"],
  ["#0f2027", "#2c5364"],
  ["#3a1c71", "#c76b98"],
  ["#141e30", "#243b55"],
  ["#232526", "#414345"],
]

function paletteFor(seed: string): [Color, Color] {
  let h = 7
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 9973
  return PALETTES[h % PALETTES.length]
}

function posterBackground(seed: string): LinearGradient {
  const [a, b] = paletteFor(seed)
  return gradient("linear", {
    colors: [a, b],
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 1, y: 1 },
  })
}

const HERO_SCRIM = gradient("linear", {
  colors: ["rgba(0,0,0,0)", "rgba(0,0,0,0.35)", "rgba(0,0,0,0.9)"],
  startPoint: { x: 0.5, y: 0.1 },
  endPoint: { x: 0.5, y: 1 },
})

export function HomePage({ onClose }: { onClose: () => void }) {
  const [source, setSource] = useState<HomeSource>(() => loadSourcesConfig().homeSource)
  const [shelves, setShelves] = useState<HomeShelf[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [switcher, setSwitcher] = useState(false)

  const meta = SOURCE_META[source]

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    setShelves([])

    ;(async () => {
      try {
        const cfg = loadSourcesConfig()
        const ready =
          source === "emby"
            ? !!(cfg.emby.enabled && cfg.emby.accessToken && cfg.emby.userId)
            : source === "plex"
              ? !!(cfg.plex.token && cfg.plex.server)
              : !!cfg.cloud115.cookie

        if (!ready) {
          if (alive) {
            setShelves([])
            setLoading(false)
          }
          return
        }

        let next: HomeShelf[] = []

        if (source === "emby") {
          const home = await embyHome(cfg.emby)
          if (home.resume.length > 0) {
            next.push({ key: "resume", title: "继续观看", cards: home.resume, landscape: true })
          }
          if (home.latest.length > 0) {
            next.push({ key: "latest", title: "最近加入", cards: home.latest, landscape: false })
          }
          for (const section of home.sections) {
            next.push({
              key: `v_${section.key}`,
              title: section.title,
              cards: section.cards,
              landscape: false,
            })
          }
        } else if (source === "plex") {
          next = await plexHome(cfg.plex)
        } else {
          next = await cloud115Home(cfg.cloud115)
        }

        if (alive) setShelves(next)
      } catch (e: any) {
        if (alive) setError(e?.message || `${SOURCE_META[source].label} 加载失败`)
      } finally {
        if (alive) setLoading(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [source, tick])

  const switchSource = (next: HomeSource) => {
    if (next === source) return
    setSource(next)
    const cfg = loadSourcesConfig()
    saveSourcesConfig({ ...cfg, homeSource: next })
  }

  const configured = useMemo(() => {
    const cfg = loadSourcesConfig()
    return {
      emby: !!(cfg.emby.enabled && cfg.emby.accessToken && cfg.emby.userId),
      plex: !!(cfg.plex.token && cfg.plex.server),
      "115": !!cfg.cloud115.cookie,
    } as Record<HomeSource, boolean>
  }, [source, tick])

  const playCard = async (card: EmbyCard) => {
    try {
      const cfg = loadSourcesConfig()

      // Plex：卡片自带直链
      if (card.id.startsWith("plex_")) {
        if (!card.url) throw new Error("这个条目没有可直接播放的文件（请点分栏里的具体集数）")
        await presentPlayer({
          url: card.url,
          title: card.subtitle ? `${card.title} · ${card.subtitle}` : card.title,
          poster: card.poster,
          headers: card.headers,
          mediaId: card.id,
          startTime: card.positionSeconds > 5 ? card.positionSeconds : 0,
        })
        setTick(t => t + 1)
        return
      }

      // 影视聚合卡（一部剧一张卡）：直接进详情页选季/集
      if (card.groupKey) {
        const group = buildMediaGroups(loadScrapeLibrary()).find(g => g.key === card.groupKey)
        if (!group) throw new Error("找不到这部影视的刮削数据，请重新刮削")
        await presentDetail(group)
        setTick(t => t + 1)
        return
      }

      // 115：已刮削的走详情页（电影→详情→播放；剧集→季/集），否则直接取直链
      if (card.id.startsWith("115_")) {
        const pick = card.pickCode || card.id.slice(4)
        const group = pick ? findGroupByPickCode(loadScrapeLibrary(), pick) : null
        if (group) {
          await presentDetail(group)
          setTick(t => t + 1)
          return
        }
        if (!pick) throw new Error("缺少 pickCode，无法取 115 播放直链")
        const got = await cloud115GetPlayUrl(cfg.cloud115, pick)
        await presentPlayer({
          url: got.url,
          title: card.title,
          poster: card.poster,
          headers: got.headers,
          mediaId: card.id,
        })
        return
      }

      // Emby
      const activeConfig = cfg.emby
      if (!activeConfig.accessToken || !activeConfig.userId) {
        throw new Error("还没有登录 Emby")
      }

      let selected: EmbyCard | null = card
      if (card.kind === "series") {
        selected = await embySeriesNextEpisode(activeConfig, card.id)
        if (!selected) throw new Error("这个剧还没有可播放的剧集")
      }

      const target = selected
      const playback = await embyPlaybackUrl(activeConfig, target.id)
      if (!playback) throw new Error("无法获取播放地址")

      let lastPosition = target.positionSeconds
      let lastDuration = target.durationSeconds
      let lastReportAt = 0

      embyReportProgress(
        activeConfig,
        target.id,
        lastPosition,
        lastDuration,
        "start",
        playback.mediaSourceId,
        playback.playSessionId
      )

      await presentPlayer({
        url: playback.url,
        title:
          target.kind === "episode"
            ? `${target.title} · ${target.subtitle}`
            : target.title,
        poster: target.poster,
        headers: playback.headers,
        mediaId: `emby_${target.id}`,
        startTime: target.positionSeconds > 5 ? target.positionSeconds : 0,
        onProgress: (progress, duration) => {
          lastPosition = progress
          if (duration > 0) lastDuration = duration
          const now = Date.now()
          if (now - lastReportAt < 20000) return
          lastReportAt = now
          embyReportProgress(
            activeConfig,
            target.id,
            lastPosition,
            lastDuration,
            "progress",
            playback.mediaSourceId,
            playback.playSessionId
          )
        },
      })

      await embyReportProgress(
        activeConfig,
        target.id,
        lastPosition,
        lastDuration,
        "stop",
        playback.mediaSourceId,
        playback.playSessionId
      )
    } catch (e: any) {
      console.error(e)
      setError(e?.message || "播放失败")
    } finally {
      setTick(t => t + 1)
    }
  }

  const heroes = useMemo<EmbyCard[]>(() => {
    const list: EmbyCard[] = []
    const seen = new Set<string>()
    for (const shelf of shelves) {
      for (const card of shelf.cards) {
        if (seen.has(card.id)) continue
        if (card.kind === "series") continue
        if (!card.poster && !card.backdrop) continue
        seen.add(card.id)
        list.push(card)
        if (list.length >= 6) break
      }
      if (list.length >= 6) break
    }
    return list
  }, [shelves])

  return (
    <NavigationStack>
      <ZStack alignment="bottom">
        <ScrollView
          navigationTitle="MediaHub"
          navigationBarTitleDisplayMode="large"
          toolbar={pageToolbar(onClose)}
          scrollIndicator="never"
        >
        <VStack
          alignment="leading"
          spacing={20}
          padding={{ top: 2, bottom: 36 }}
          onLongPressGesture={{ minDuration: 450, perform: () => setSwitcher(true) }}
        >
          <VStack alignment="leading" spacing={6} padding={{ horizontal: PAGE_PADDING }}>
            <Button
              action={() => setSwitcher(true)}
              buttonStyle="plain"
              contentShape="rect"
              confirmationDialog={{
                title: "选择媒体库",
                isPresented: switcher,
                onChanged: setSwitcher,
                actions: (
                  <VStack>
                    {(Object.keys(SOURCE_META) as HomeSource[]).map(key => (
                      <Button
                        key={key}
                        title={`${SOURCE_META[key].label}${configured[key] ? "" : "（未配置）"}`}
                        action={() => {
                          setSwitcher(false)
                          switchSource(key)
                        }}
                      />
                    ))}
                    <Button
                      title="取消"
                      action={() => setSwitcher(false)}
                    />
                  </VStack>
                ),
              }}
            >
              <HStack
                spacing={6}
                padding={{ horizontal: 12, vertical: 7 }}
                background="secondarySystemBackground"
                clipShape={CAPSULE}
              >
                <Image systemName={meta.icon} font="caption" foregroundStyle="systemIndigo" />
                <Text font="subheadline" fontWeight="semibold">
                  {meta.label}
                </Text>
                <Image
                  systemName="chevron.down"
                  font="caption2"
                  foregroundStyle="secondaryLabel"
                />
              </HStack>
            </Button>
            <Text font="caption2" foregroundStyle="secondaryLabel">
              长按首页任意位置可切换媒体库
            </Text>
          </VStack>

          {loading && shelves.length === 0 ? (
            <VStack
              alignment="center"
              spacing={10}
              padding={{ horizontal: PAGE_PADDING, vertical: 60 }}
            >
              <ProgressView />
              <Text font="footnote" foregroundStyle="secondaryLabel">
                正在加载 {meta.label}…
              </Text>
            </VStack>
          ) : null}

          {!loading && shelves.length === 0 && !error ? (
            <VStack padding={{ horizontal: PAGE_PADDING }}>
              <VStack
                alignment="leading"
                spacing={10}
                padding={20}
                frame={{ width: pageContentWidth() - 72 }}
                background="secondarySystemBackground"
                clipShape={ROUND_HERO}
              >
                <Image systemName={meta.icon} font="title" foregroundStyle="systemIndigo" />
                <Text font="headline">
                  {configured[source] ? `${meta.label} 暂无内容` : `还没有连接 ${meta.label}`}
                </Text>
                <Text font="subheadline" foregroundStyle="secondaryLabel">
                  {configured[source] ? meta.empty : meta.hint}
                </Text>
              </VStack>
            </VStack>
          ) : null}

          {heroes.length > 0 ? (
            <HeroCarousel items={heroes} label={meta.label} onPlay={playCard} />
          ) : null}

          {shelves.map(shelf => (
            <Shelf
              key={shelf.key}
              title={shelf.title}
              cards={shelf.cards}
              landscape={shelf.landscape}
              onPlay={playCard}
            />
          ))}

          {!loading && shelves.length > 0 ? (
            <VStack padding={{ horizontal: PAGE_PADDING }}>
              <Text font="caption2" foregroundStyle="secondaryLabel">
                数据来自 {meta.label} · 长按页面可切换
              </Text>
            </VStack>
          ) : null}
        </VStack>
        </ScrollView>

        {error ? (
          <VStack
            alignment="leading"
            spacing={10}
            padding={{ top: 14, leading: 14, trailing: 14, bottom: 26 }}
            frame={{ width: pageContentWidth() - 60 }}
            background="regularMaterial"
            clipShape={ROUND_CARD}
          >
            <Text font="footnote" foregroundStyle="systemRed">
              {error}
            </Text>
            <HStack spacing={8}>
              <Button
                title="重试"
                systemImage="arrow.clockwise"
                buttonStyle="bordered"
                action={() => {
                  setError(null)
                  setTick(t => t + 1)
                }}
              />
              <Button title="关闭" buttonStyle="bordered" action={() => setError(null)} />
            </HStack>
          </VStack>
        ) : null}
      </ZStack>
    </NavigationStack>
  )
}

/* ------------------------------ 顶部轮播 ------------------------------ */

const HERO_IMAGE_HEIGHT = 196

function heroCardWidth(): number {
  return pageContentWidth() - PAGE_PADDING * 2
}

export function HeroCarousel({
  items,
  label,
  onPlay,
}: {
  items: EmbyCard[]
  label: string
  onPlay: (card: EmbyCard) => void
}) {
  const count = items.length
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (count <= 1) return
    const timer = setInterval(() => setIndex(i => (i + 1) % count), AUTO_ROTATE_MS)
    return () => clearInterval(timer)
  }, [count])

  const current = count > 0 ? index % count : 0
  const card = items[current]

  return (
    <VStack
      alignment="leading"
      spacing={8}
      padding={{ horizontal: PAGE_PADDING }}
    >
      <ZStack frame={{ width: heroCardWidth(), height: HERO_IMAGE_HEIGHT }} clipShape={ROUND_HERO}>
        <Rectangle fill="secondarySystemBackground" frame={{ maxWidth: "infinity", maxHeight: "infinity" }} />
        {items.map((item, i) => (
          <HeroCard
            key={item.id}
            item={item}
            active={i === current}
            index={current}
            onPlay={onPlay}
          />
        ))}
        <VStack
          frame={{ width: heroCardWidth(), maxHeight: "infinity" }}
          alignment="center"
        >
          <Spacer />
          <HStack spacing={5} padding={{ bottom: 10 }}>
            {items.map((item, i) => (
              <Circle
                key={`dot_${item.id}`}
                fill="white"
                opacity={i === current ? 1 : 0.35}
                frame={{ width: 6, height: 6 }}
              />
            ))}
          </HStack>
        </VStack>
      </ZStack>

      {card ? (
        <Text font="title3" fontWeight="bold" lineLimit={2}>
          {card.title}
        </Text>
      ) : null}
      {card ? (
        <HStack spacing={6}>
          <Text
            font="caption2"
            fontWeight="semibold"
            foregroundStyle="systemIndigo"
          >
            {card.progress > 0.02 ? "继续观看" : label}
          </Text>
          <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
            {card.progress > 0.02
              ? `${card.subtitle} · 已看 ${Math.round(card.progress * 100)}%`
              : card.subtitle}
          </Text>
        </HStack>
      ) : null}
    </VStack>
  )
}

export function HeroCard({
  item,
  active,
  index,
  onPlay,
}: {
  item: EmbyCard
  active: boolean
  index: number
  onPlay: (card: EmbyCard) => void
}) {
  return (
    <Button
      action={() => onPlay(item)}
      buttonStyle="plain"
      contentShape="rect"
      allowsHitTesting={active}
      opacity={active ? 1 : 0}
      animation={{ animation: Animation.easeOut(0.55), value: index }}
    >
      <ZStack
        frame={{ width: heroCardWidth(), height: HERO_IMAGE_HEIGHT }}
        clipShape={ROUND_HERO}
      >
        <Rectangle
          fill={posterBackground(item.title)}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        />
        {item.backdrop ?? item.poster ? (
          <RemoteImage
            url={item.backdrop ?? item.poster}
            width={heroCardWidth()}
            height={HERO_IMAGE_HEIGHT}
            radius={20}
          />
        ) : null}
        <Rectangle fill={HERO_SCRIM} frame={{ maxWidth: "infinity", maxHeight: "infinity" }} />

        <VStack
          alignment="trailing"
          frame={{ width: heroCardWidth(), height: HERO_IMAGE_HEIGHT }}
        >
          <Spacer />
          <Image
            systemName="play.circle.fill"
            font="title2"
            foregroundStyle="white"
            offset={{ x: -16, y: -14 }}
          />
        </VStack>
      </ZStack>
    </Button>
  )
}

/* ------------------------------- 分栏 ------------------------------- */

/** 固定栅格（不横滑）：宽度按屏宽算，保证绝不超出屏幕 */
export function Shelf({
  title,
  cards,
  landscape,
  maxRows = 2,
  onPlay,
}: {
  title: string
  cards: EmbyCard[]
  landscape: boolean
  maxRows?: number
  onPlay: (card: EmbyCard) => void
}) {
  const sceneWidth = pageContentWidth()
  const columns = landscape ? 2 : 3
  const rowWidth = sceneWidth - PAGE_PADDING * 2
  // 预留 12pt 余量，避免不同内边距/间距下最后一列被切
  const cardWidth = Math.floor(
    (rowWidth - ROW_GAP * (columns - 1) - 12) / columns
  )
  const visible = cards.slice(0, columns * maxRows)
  const rows: EmbyCard[][] = []
  for (let i = 0; i < visible.length; i += columns) {
    rows.push(visible.slice(i, i + columns))
  }

  return (
    <VStack alignment="leading" spacing={10}>
      <Text font="title3" fontWeight="bold" padding={{ horizontal: PAGE_PADDING }}>
        {title}
      </Text>
      <VStack alignment="leading" spacing={ROW_GAP} padding={{ horizontal: PAGE_PADDING }}>
        {rows.map((row, rowIndex) => (
          <HStack
            key={`${title}_${rowIndex}`}
            spacing={ROW_GAP}
            alignment="top"
            frame={{ width: rowWidth, alignment: "leading" }}
          >
            {row.map(card =>
              landscape ? (
                <LandscapeCard
                  key={card.id}
                  card={card}
                  width={cardWidth}
                  onPlay={() => onPlay(card)}
                />
              ) : (
                <PosterCard
                  key={card.id}
                  card={card}
                  width={cardWidth}
                  onPlay={() => onPlay(card)}
                />
              )
            )}
          </HStack>
        ))}
      </VStack>
    </VStack>
  )
}

export function PosterCard({
  card,
  width,
  onPlay,
}: {
  card: EmbyCard
  width: number
  onPlay: () => void
}) {
  const height = Math.round(width * 1.5)
  return (
    <Button action={onPlay} buttonStyle="plain" contentShape="rect">
      <VStack alignment="leading" spacing={6} frame={{ width }}>
        <ZStack frame={{ width, height }} clipShape={ROUND_CARD}>
          <Rectangle
            fill={posterBackground(card.title)}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          />
          {card.poster ? (
            <RemoteImage url={card.poster} width={width} height={height} radius={CARD_RADIUS} />
          ) : (
            <Text font="title2" fontWeight="bold" foregroundStyle="rgba(255,255,255,0.9)">
              {card.title.slice(0, 2)}
            </Text>
          )}
          {card.progress > 0.02 ? (
            <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} alignment="leading">
              <Spacer />
              <ZStack alignment="leading" frame={{ maxWidth: "infinity", height: 3 }}>
                <Rectangle fill="rgba(0,0,0,0.45)" frame={{ maxWidth: "infinity", height: 3 }} />
                <Rectangle
                  fill="systemIndigo"
                  frame={{ width: Math.max(2, width * card.progress), height: 3 }}
                />
              </ZStack>
            </VStack>
          ) : null}
        </ZStack>
        <Text
          font="caption"
          fontWeight="medium"
          lineLimit={2}
          frame={{ width, height: 32, alignment: "leading" }}
        >
          {card.title}
        </Text>
      </VStack>
    </Button>
  )
}

export function LandscapeCard({
  card,
  width,
  onPlay,
}: {
  card: EmbyCard
  width: number
  onPlay: () => void
}) {
  const height = Math.round(width * 0.5625)
  const remain =
    card.durationSeconds > card.positionSeconds
      ? card.durationSeconds - card.positionSeconds
      : 0
  return (
    <Button action={onPlay} buttonStyle="plain" contentShape="rect">
      <VStack alignment="leading" spacing={6} frame={{ width }}>
        <ZStack frame={{ width, height }} clipShape={ROUND_CARD}>
          <Rectangle
            fill={posterBackground(card.title)}
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          />
          {card.backdrop ?? card.poster ? (
            <RemoteImage
              url={card.backdrop ?? card.poster}
              width={width}
              height={height}
              radius={CARD_RADIUS}
            />
          ) : null}
          {card.progress > 0.02 ? (
            <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} alignment="leading">
              <Spacer />
              <ZStack alignment="leading" frame={{ maxWidth: "infinity", height: 3 }}>
                <Rectangle fill="rgba(255,255,255,0.3)" frame={{ maxWidth: "infinity", height: 3 }} />
                <Rectangle
                  fill="systemIndigo"
                  frame={{ width: Math.max(2, width * card.progress), height: 3 }}
                />
              </ZStack>
            </VStack>
          ) : null}
        </ZStack>
        <Text
          font="footnote"
          fontWeight="medium"
          lineLimit={1}
          frame={{ width, alignment: "leading" }}
        >
          {card.title}
        </Text>
        <Text
          font="caption2"
          foregroundStyle="secondaryLabel"
          lineLimit={1}
          frame={{ width, alignment: "leading" }}
        >
          {remain > 0 ? `剩余 ${remainTime(remain)} · ${card.subtitle}` : card.subtitle}
        </Text>
      </VStack>
    </Button>
  )
}

function remainTime(seconds: number): string {
  const m = Math.round(seconds / 60)
  if (m >= 60) return `${Math.floor(m / 60)} 小时 ${m % 60} 分`
  return `${m} 分钟`
}
