// 「播放页」—— 点播放后进入的**页面**（对齐参考脚本 红果/views/PlayerView.tsx 的做法）：
//
//   ┌──────────────────────────────┐
//   │  视频区 固定 220pt（黑底）      │  ← 原生控件 + 画中画
//   └──────────────────────────────┘
//     剧名 / 第 N 集 / 清晰度 / 共 N 集
//     题材标签
//     选集（**分页**：每页 EPISODE_PAGE_SIZE 集，自动停在当前集那一页）
//     剧情简介
//
// ⚠️⚠️ 五条踩过的坑 / 铁律：
//   1. **画面必须在 `setSource` 成功之后才挂载**（`loaded` 门控）。
//      先渲染 `AVPlayerView`、随后才 setSource 的话，会出现**只有声音没有画面**（黑屏）。
//      挂载之后还要补一次 `play()`（回调可能已经错过 ready 时机）。
//   2. **选集必须分页**：200 集的剧全铺出来要滚好几屏，还会把整页 LazyVGrid 全部构建。
//   3. **收起 / 关掉脚本时必须自己把播放停下来**：播放器是原生对象、不挂 React 树，
//      而音频会话是 playback 类别（允许后台出声）—— 不管的话就是「界面都收起来了，声音还在响」。
//      做法：把 suspend / resume / finish 登记进 `playback.ts`，由 index.tsx 在收起 / 退出时统一叫停。
//   4. **第一集可以是「还没准备好的 Promise」**：详情页不等播放地址就推开本页（= 点播放秒进），
//      这里先显示「正在准备播放…」再自己装源（对齐参考脚本 PlayerView 的做法）。
//   5. **提前准备好下一集**：起播后 + 看过一半时各预取一次（`prefetch`），
//      切集/自动连播就不用再等接口 + 首包（那 1~2 秒就是它）。
//
// 会话所有权与 player.tsx 全屏播放器一致：take 的结果才能 release 上一个；卸载时先摘回调再 release。
import { AVPlayerView, Button, HStack, Image, LazyVGrid, PIPStatus, ProgressView, ScrollView, Text, VStack, ZStack, useEffect, useMemo, useRef, useState, useObservable } from "scripting"
import { ACCENT, GRID_SPACING, PAGE_BOTTOM_PADDING, PAGE_PADDING, PageBackground, SECTION_SPACING, SectionHeading, TagLabel } from "../design"
import type { Playable, Playlist, PlaylistEntry } from "../player"
import { registerPlayback } from "../playback"

/** 视频区高度：和参考脚本一致（不是全屏，下面留给选集与简介）。 */
const PLAYER_HEIGHT = 220
/** 画面挂载后的兜底 play 延迟（正常已在 effect 里立即起播，这里只防回调错过 ready）。 */
const PLAY_AFTER_MOUNT_MS = 150
const REPORT_INTERVAL_MS = 12000
const PREFETCH_TTL_MS = 5 * 60 * 1000
/** 看过这一比例就先把下一集备好（用户要求：超过 50%）—— 起播时已经预取过一次，这里是兜底 + 重试。 */
const PREFETCH_AT = 0.5
/** 进度轮询间隔：只读两个数值（很便宜），3 秒够准了。 */
const PREFETCH_POLL_MS = 3000
/** 选集分页：每页集数（5 列 × 6 行）。 */
const EPISODE_PAGE_SIZE = 30
const EPISODE_COLUMNS = 5

export function WatchPage({ playlist, meta }: {
  playlist: Playlist
  meta?: { intro?: string; tags?: string[] }
}) {
  const [player] = useState(() => new AVPlayer())
  const pipStatus = useObservable<PIPStatus>(null)

  const [entries, setEntries] = useState<PlaylistEntry[]>(playlist.entries)
  const [index, setIndex] = useState(playlist.startIndex)
  const [busy, setBusy] = useState("正在准备播放…")
  const [error, setError] = useState("")
  /** 第一集可能是「还在准备中的 Promise」：详情页不等它准备好就把页面推出来（点播放秒进）。 */
  const firstSeed = playlist.first instanceof Promise ? null : playlist.first
  const [quality, setQuality] = useState(firstSeed?.quality ?? 0)
  /** ⚠️ 画面只有在源装载成功后才会被挂载（否则黑屏只有声音）。 */
  const [loaded, setLoaded] = useState(false)

  const entriesRef = useRef<PlaylistEntry[]>(playlist.entries)
  const indexRef = useRef(playlist.startIndex)
  const aliveRef = useRef(true)
  const sessionRef = useRef<Playable | null>(firstSeed)
  const startRef = useRef(playlist.startPosition ?? 0)
  const lastReportRef = useRef(0)
  const goSeqRef = useRef(0)
  const extendingRef = useRef(false)
  const prefetchRef = useRef<{ index: number; at: number; promise: Promise<Playable> } | null>(null)
  const goRef = useRef<(next: number, force?: boolean) => void>(() => { })
  /** 已收起（最小化）/ 已交出音频会话：这段时间里不许自动续播，否则收起来了还在响。 */
  const suspendedRef = useRef(false)

  /** 丢掉预取：⚠️ 必须把它 release 掉 —— 那个解密会话（含整集缓存缓冲）否则没人回收。 */
  function releasePrefetch() {
    const hit = prefetchRef.current
    prefetchRef.current = null
    if (!hit) return
    void hit.promise.then(playable => playable.release()).catch(() => { /* 预取本来就失败了 */ })
  }

  /** 提前把下一集准备好（5 分钟内有效）；失败也不冒泡。 */
  function prefetch(next: number) {
    if (next < 0 || next >= entriesRef.current.length) return
    const now = Date.now()
    const hit = prefetchRef.current
    if (hit && hit.index === next && now - hit.at < PREFETCH_TTL_MS) return
    if (hit) releasePrefetch()
    const promise = playlist.resolve(next)
    // 没人取走时也不能变成「未处理的 Promise 拒绝」（真正取走的那次仍会正常报错）
    promise.catch(() => { /* 真取走时在 go() 里报错 */ })
    prefetchRef.current = { index: next, at: now, promise }
  }

  async function take(next: number): Promise<Playable> {
    const hit = prefetchRef.current
    if (hit && hit.index === next) {
      prefetchRef.current = null
      return await hit.promise
    }
    releasePrefetch()
    return await playlist.resolve(next)
  }

  /** 进度回写（12 秒一次；切集/卸载时 force 补一次）。 */
  function reportProgress(force: boolean) {
    const callback = playlist.onProgress
    if (!callback) return
    const at = Date.now()
    if (!force && at - lastReportRef.current < REPORT_INTERVAL_MS) return
    lastReportRef.current = at
    try {
      callback(indexRef.current, Math.max(0, Math.floor(Number(player.currentTime) || 0)), Math.max(0, Math.floor(Number(player.duration) || 0)))
    } catch { /* 记录进度失败不该影响播放 */ }
  }

  /** 画中画正在放吗？（≈用户在 PiP 里看，那就交给系统继续放，别去暂停） */
  function inPictureInPicture() {
    const status = pipStatus.value
    return status === "didStart" || status === "willStart"
  }

  /**
   * 收起 / 被关掉：暂停并归还音频会话。
   * ⚠️ 播放器是原生对象，页面收起后不会自己停（playback 类别允许后台出声）——
   *    不暂停就是用户实报的「脚本都收起来了声音还在响」。
   */
  function suspendLocal() {
    if (inPictureInPicture()) return
    suspendedRef.current = true
    reportProgress(true)
    try { player.pause() } catch { /* ignore */ }
    SharedAudioSession.setActive(false, ["notifyOthersOnDeactivation"]).catch(() => { /* ignore */ })
  }

  /** 从最小化回来：把音频会话再占回来。**不自动续播** —— 声音突然响起来比多按一下更烦。 */
  function resumeLocal() {
    suspendedRef.current = false
    void SharedAudioSession.setCategory("playback", ["defaultToSpeaker"])
      .catch(() => { /* ignore */ })
      .then(() => SharedAudioSession.setActive(true))
      .catch(() => { /* ignore */ })
  }

  /** 页面离开：停播 + 归还音频会话 + 还掉解密会话。可重复调用（幂等）。 */
  function teardownLocal() {
    if (!aliveRef.current) return
    aliveRef.current = false
    // ⚠️ 必须摘掉回调：卸载后 onReadyToPlay 还会 prefetch → 建一个没人 release 的解密会话（整集缓冲）
    player.onReadyToPlay = () => { }
    player.onError = () => { }
    player.onEnded = () => { }
    reportProgress(true)
    try { player.pause() } catch { /* ignore */ }
    sessionRef.current?.release()
    sessionRef.current = null
    releasePrefetch()
    // 播放页允许横屏，离开就还回去（否则整个脚本都会跟着横）
    Device.supportedInterfaceOrientations = Device.userConfiguredInterfaceOrientations
    // 页面走了就把音频会话还回去，否则别的 App 的音乐一直被我们占着
    SharedAudioSession.setActive(false, ["notifyOthersOnDeactivation"]).catch(() => { /* 失败也不影响退出 */ })
  }

  /** 接着上次看：只对「本来就要续播的那一集」生效（否则切集后会被拉回去）。 */
  function applyStart(clearAfter = false) {
    if (indexRef.current !== playlist.startIndex) { startRef.current = 0; return }
    const seconds = startRef.current
    if (seconds > 3) { try { player.currentTime = seconds } catch { /* 定位失败就从头播 */ } }
    if (clearAfter) startRef.current = 0
  }

  function go(next: number, force = false) {
    if (next < 0 || next >= entriesRef.current.length) return
    if (next === indexRef.current && !force) return
    reportProgress(true)
    setError("")
    setBusy("正在准备下一集…")
    const seq = ++goSeqRef.current
    void take(next).then(playable => {
      // 连点/自动连播撞车时丢弃后到的旧结果，否则会把正在播的新集当 previous 释放掉
      if (seq !== goSeqRef.current) { playable.release(); return }
      if (!aliveRef.current) { playable.release(); return }
      // 先确认新流能加载，再改状态（失败时界面与实际播放才对得上）
      if (!player.setSource(playable.url)) {
        playable.release()
        setBusy("")
        setError("系统无法加载这一集。")
        return
      }
      const previous = sessionRef.current
      sessionRef.current = playable
      indexRef.current = next
      setIndex(next)
      setQuality(playable.quality)
      playlist.onSwitch(next, playable)
      if (previous && previous !== playable) previous.release()
      setBusy("")
      setLoaded(true)
      prefetch(next + 1)
    }).catch((reason: unknown) => {
      if (!aliveRef.current) return
      setBusy("")
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  goRef.current = go

  /** 播完一集：有下一集就接着播；没有就试接下一季（拿到就把条目追加到列表尾）。 */
  function reachNextSeason() {
    if (extendingRef.current) return
    const more = playlist.extend
    if (!more) { setBusy("已经播完全部剧集"); return }
    extendingRef.current = true
    setBusy("正在接上下一季…")
    void more().then(items => {
      extendingRef.current = false
      if (!aliveRef.current) return
      if (!items?.length) { setBusy("已经是最新一季了"); return }
      const appended = [...entriesRef.current, ...items]
      entriesRef.current = appended
      setEntries(appended)
      setBusy("")
      if (playlist.autoNext) goRef.current(indexRef.current + 1)
    }).catch((reason: unknown) => {
      extendingRef.current = false
      if (!aliveRef.current) return
      setBusy("")
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  // ① 初始化：音频会话与「准备第一集」并行 → 两者都好才装源 → 最后才允许挂画面
  useEffect(() => {
    let cancelled = false
    Device.supportedInterfaceOrientations = ["allButUpsideDown"]
    // 登记进脚本级开关：收起（最小化）/ 退出脚本 / 页面被返回时都由外面统一叫停
    const unregister = registerPlayback({ suspend: suspendLocal, resume: resumeLocal, finish: teardownLocal })
    // 两件事**并行**：「音频会话就绪」与「准备第一集」（后者是长杆，先出发）；
    // 两者都好之后才 `setSource` —— 参考脚本也是「先会话说就绪、再装源」的顺序。
    const audioReady = SharedAudioSession.setCategory("playback", ["defaultToSpeaker"])
      .catch(() => { /* 失败也继续，至少能播 */ })
      .then(() => SharedAudioSession.setActive(true))
      .catch(() => { /* ignore */ })
    void Promise.all([audioReady, Promise.resolve(playlist.first)]).then(([, playable]) => {
      // 等到了但页面已经走了 / 已被叫停 → 把会话还回去（否则它带着整集缓冲留在 sessions 里）
      if (cancelled || !aliveRef.current) { playable.release(); return }
      sessionRef.current = playable
      setQuality(playable.quality)
      // ⚠️ 源必须在挂载画面之前装好，否则会有声音没画面
      if (player.setSource(playable.url)) {
        setBusy("")
        setLoaded(true)
      } else {
        sessionRef.current = null
        playable.release()
        setBusy("")
        setError("系统无法加载这一集。")
      }
    }).catch((reason: unknown) => {
      if (cancelled || !aliveRef.current) return
      setBusy("")
      setError(reason instanceof Error ? reason.message : String(reason))
    })

    return () => {
      cancelled = true
      unregister()
      teardownLocal()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ② 画面挂载之后再挂回调（顺序很重要）+ 补一次 play（可能已错过 ready）
  useEffect(() => {
    if (!loaded) return
    player.onReadyToPlay = () => {
      applyStart(true)
      // 收起期间不许续播（音频会话已交出去，播了也是白响）
      if (!suspendedRef.current) player.play()
      prefetch(indexRef.current + 1)
    }
    player.onError = message => setError(message)
    player.onEnded = () => {
      const next = indexRef.current + 1
      if (next < entriesRef.current.length) {
        if (playlist.autoNext) goRef.current(next)
        else setBusy("这一集播完了")
      } else {
        reachNextSeason()
      }
    }
    // effect 在画面挂载（同一次提交）之后才跑 → 这里直接起播，不用再等 150ms
    if (!suspendedRef.current) { try { player.play() } catch { /* ignore */ } }
    const timer = setTimeout(() => {
      if (suspendedRef.current) return
      try { player.play() } catch { /* ignore */ }
    }, PLAY_AFTER_MOUNT_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])

  // ③ 每 3 秒一拍：进度回写（内部 12 秒节流）+ 过半就预取下一集
  // ⚠️ Scripting 只有 `setTimeout`、**没有 `setInterval`** → 自己排下一拍
  useEffect(() => {
    if (!loaded) return
    let stopped = false
    let timer: number | undefined
    const tick = () => {
      if (stopped) return
      if (!suspendedRef.current) {
        // ⚠️ 以前只有「切集 / 离开页面」才写进度：看一半被杀（或刷后台）就丢了接着看的位置
        reportProgress(false)
        const total = Number(player.duration) || 0
        if (total > 0 && (Number(player.currentTime) || 0) / total >= PREFETCH_AT) prefetch(indexRef.current + 1)
      }
      timer = setTimeout(tick, PREFETCH_POLL_MS)
    }
    timer = setTimeout(tick, PREFETCH_POLL_MS)
    return () => { stopped = true; if (timer !== undefined) clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])

  // ---- 选集分页（memo：切集/状态一变就会重渲染 —— 页码数组与格子文案都在这里算好，render 里不再跑正则）----
  const pages = useMemo(() => {
    const out: { entry: PlaylistEntry; text: string }[][] = []
    for (let at = 0; at < entries.length; at += EPISODE_PAGE_SIZE) {
      out.push(entries.slice(at, at + EPISODE_PAGE_SIZE).map((entry, offset) => ({ entry, text: episodeNumber(entry.label, at + offset) })))
    }
    return out
  }, [entries])
  const pageCount = Math.max(1, pages.length)
  const [page, setPage] = useState(() => Math.floor(playlist.startIndex / EPISODE_PAGE_SIZE))
  // 切集（自动连播也算）时自动跟到那一页 —— 和参考脚本一样
  useEffect(() => {
    const target = Math.floor(index / EPISODE_PAGE_SIZE)
    setPage(value => (value === target ? value : target))
  }, [index])
  const safePage = Math.min(page, pageCount - 1)
  const pageEntries = pages[safePage] ?? []
  const pageFrom = safePage * EPISODE_PAGE_SIZE

  const tags = meta?.tags ?? []

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
    <PageBackground />
    <VStack spacing={0} alignment="leading" frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      {/* 视频区：固定高度，黑底。⚠️ 只有 loaded 为真时才挂 AVPlayerView（见文件头注释） */}
      <ZStack frame={{ maxWidth: "infinity", height: PLAYER_HEIGHT }} background="black">
        {loaded ? <AVPlayerView
          player={player}
          pipStatus={pipStatus}
          allowsPictureInPicturePlayback
          canStartPictureInPictureAutomaticallyFromInline
          updatesNowPlayingInfoCenter
          videoGravity="resizeAspect"
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        /> : undefined}
        {!loaded || busy || error ? <VStack spacing={10} frame={{ maxWidth: "infinity", maxHeight: "infinity" }} background="black">
          {error
            ? <Image systemName="exclamationmark.triangle" font="title3" foregroundStyle="white" />
            : <ProgressView progressViewStyle="circular" tint="white" />}
          <Text font="footnote" foregroundStyle="white" multilineTextAlignment="center" lineLimit={3} frame={{ maxWidth: "infinity" }}>
            {error || busy || "正在准备播放…"}
          </Text>
          {error ? <Button title="重试" buttonStyle="bordered" tint="white" action={() => goRef.current(indexRef.current, true)} /> : undefined}
        </VStack> : undefined}
      </ZStack>

      <ScrollView>
        <VStack spacing={SECTION_SPACING} alignment="leading" padding={{ horizontal: PAGE_PADDING, top: 16, bottom: PAGE_BOTTOM_PADDING }} frame={{ maxWidth: "infinity" }}>
          <VStack spacing={7} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
            <Text font="title3" fontWeight="bold" lineLimit={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>{playlist.title}</Text>
            <HStack spacing={10}>
              <Text font="caption" fontWeight="semibold" foregroundStyle={ACCENT}>{entries[index]?.label ?? `第 ${index + 1} 集`}</Text>
              {quality > 0 ? <Text font="caption" foregroundStyle="secondaryLabel">{`${quality}p`}</Text> : undefined}
              <Text font="caption" foregroundStyle="secondaryLabel">{`共 ${entries.length} 集`}</Text>
            </HStack>
          </VStack>

          {tags.length ? <ScrollView axes="horizontal" scrollIndicator="hidden">
            <HStack spacing={8}>
              {tags.slice(0, 6).map(tag => <TagLabel key={tag} text={tag} />)}
            </HStack>
          </ScrollView> : undefined}

          {/* 简介放在选集上面（用户要求）：先读剧情再挑集 */}
          {meta?.intro ? <VStack spacing={8} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>
            <SectionHeading title="剧情简介" />
            <Text font="footnote" foregroundStyle="secondaryLabel" lineSpacing={3} frame={{ maxWidth: "infinity", alignment: "leading" }}>{meta.intro}</Text>
          </VStack> : undefined}

          <VStack spacing={12} alignment="leading" frame={{ maxWidth: "infinity" }}>
            <SectionHeading title="选集" subtitle={pageCount > 1 ? `第 ${pageFrom + 1}-${pageFrom + pageEntries.length} 集 · 共 ${entries.length} 集` : `共 ${entries.length} 集`} />
            <LazyVGrid columns={EPISODE_CELLS} alignment="leading" spacing={10} frame={{ maxWidth: "infinity", alignment: "leading" }}>
              {pageEntries.map((cell, at) => {
                const realIndex = pageFrom + at
                const active = realIndex === index
                return <VStack key={`${cell.entry.vid}-${realIndex}`} spacing={0} padding={{ vertical: 9 }}
                  frame={{ maxWidth: "infinity", minHeight: 38 }}
                  background={active ? ACCENT : "secondarySystemFill"}
                  clipShape={{ type: "rect", cornerRadius: 10, style: "continuous" }}
                  contentShape="rect"
                  onTapGesture={() => goRef.current(realIndex)}>
                  <Text font="footnote" fontWeight={active ? "semibold" : "regular"} lineLimit={1}
                    foregroundStyle={active ? "white" : "label"}
                    frame={{ maxWidth: "infinity" }}>
                    {cell.text}
                  </Text>
                </VStack>
              })}
            </LazyVGrid>

            {pageCount > 1 ? <ScrollView axes="horizontal" scrollIndicator="hidden" frame={{ maxWidth: "infinity" }}>
              <HStack spacing={8}>
                {pages.map((_cells, pageIndex) => {
                  const active = pageIndex === safePage
                  return <Button key={pageIndex} buttonStyle="plain"
                    frame={{ minHeight: 34 }}
                    accessibilityLabel={`第 ${pageIndex + 1} 页选集`}
                    action={() => setPage(pageIndex)}>
                    <Text font="footnote" fontWeight={active ? "semibold" : "regular"}
                      foregroundStyle={active ? "white" : "label"}
                      padding={{ horizontal: 12, vertical: 7 }}
                      background={active ? ACCENT : "secondarySystemFill"}
                      clipShape={{ type: "capsule", style: "continuous" }}>
                      {`${pageIndex + 1}`}
                    </Text>
                  </Button>
                })}
              </HStack>
            </ScrollView> : undefined}
          </VStack>
        </VStack>
      </ScrollView>
    </VStack>
  </ZStack>
}

/** 选集格子只显示集号（多季时 label 是「第2季 · 第5集」，格子放不下）。 */
function episodeNumber(label: string, at: number): string {
  const match = /第(\d+)集/.exec(label)
  return match ? match[1] : String(at + 1)
}

/** 列定义固定（5 列），模块级缓存即可，避免每帧新建数组。 */
const EPISODE_CELLS: { size: { type: "flexible" }; spacing: number }[] = []
for (let at = 0; at < EPISODE_COLUMNS; at++) EPISODE_CELLS.push({ size: { type: "flexible" }, spacing: at === EPISODE_COLUMNS - 1 ? 0 : GRID_SPACING })
