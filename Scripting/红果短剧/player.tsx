import { AVPlayerView, Button, Device, HStack, Image, List, Navigation, NavigationStack, PIPStatus, ProgressView, Section, TapGesture, Text, VStack, ZStack, useEffect, useObservable, useRef, useState } from "scripting"
import { ACCENT } from "./design"

export type PlaylistEntry = { vid: string; label: string }

/** 一集已经准备好的播放资源（本地解密代理地址 + 释放函数）。 */
export type Playable = { url: string; release: () => void; note: string; quality: number }

export type Playlist = {
  title: string
  entries: PlaylistEntry[]
  /** 起始下标（相对 entries，不是集数） */
  startIndex: number
  /**
   * 第一集。**可以直接给一个还没准备好的 Promise**：播放页会立刻推开、在视频区里转圈，
   * 拿到后再装源 —— 这就是「点播放秒进」的来源（详情页不用先等 1~2 秒的接口 + 首包）。
   */
  first: Playable | Promise<Playable>
  /** 按需准备第 index 集（下标跨越所有已加载的季） */
  resolve: (index: number) => Promise<Playable>
  /** 每切到一集回调一次（用于记录播放历史） */
  onSwitch: (index: number, playable: Playable) => void
  autoNext: boolean
  /**
   * 接着上次看：**第一集**从这里（秒）开始播。
   * ⚠️ 只对第一集生效（切集后一律从头），否则下一集的 onReadyToPlay 会把画面又拉回去。
   */
  startPosition?: number
  /**
   * 播放中定期回报「看到第几秒」（约 4 秒一次 + 退出时补一次），
   * 用来把进度存进播放历史 → 下次「继续播放」能接着看。
   */
  onProgress?: (index: number, seconds: number, duration: number) => void
  /**
   * 当前季播完最后一集时调用。返回下一季的条目就会被追加进播放列表；
   * 返回 null / 空数组表示没有下一季（播放器显示「已看完」）。
   */
  extend?: () => Promise<PlaylistEntry[] | null>
}

/** 倒数几秒后自动播放下一集 */
const COUNTDOWN = 4

/** 原生按钮那味：iOS 26 的 Liquid Glass 胶囊 + 白色 SF Symbol。
 *  取不到玻璃（低版本）就退化成半透明黑底圆钮，不至于变成裸图标。
 *  尺寸从用户截图里量出来的：原生「倍速」圆钮直径 82px / 1.84 = 44pt，图标 ~22pt。 */
const BUTTON_GLASS: { glass: UIGlass; shape: "capsule" } | undefined = (() => {
  try { return { glass: UIGlass.regular(), shape: "capsule" as const } } catch { return undefined }
})()

function NativeButton(props: { systemImage: string; label: string; disabled?: boolean; action: () => void }) {
  const dim = props.disabled === true
  // 玻璃本身极透，单靠它在视频上会看不见——原生控件栏也是靠一层暗 scrim 托底的
  return <Button action={props.action} disabled={dim} buttonStyle="plain" contentShape="circle"
    frame={{ width: 42, height: 42 }}
    background="rgba(0,0,0,0.34)"
    clipShape="circle"
    glassEffect={BUTTON_GLASS}
    accessibilityLabel={props.label}>
    <Image systemName={props.systemImage} font="body" fontWeight="semibold" foregroundStyle="white" opacity={dim ? 0.35 : 1} />
  </Button>
}

/**
 * 选集面板。
 *
 * 原生播放器**没有**这个能力：iOS 的 AVKit 没有剧集列表 UI（`AVContentProposal`
 * / `customInfoViewControllers` 都是 tvOS 专属），实测 `AVPlayerViewProps` 里
 * `chapters` / `contentProposal` / `navigationMarkerGroups` 等全不存在，只能自己做。
 *
 * ⚠️ 用**系统 List + Section**而不是自己拼 LazyVGrid：
 *  前几版用 3 列自定义胶囊，宽度被文字撑得长短不一、单行/两行混在一起（用户实报「乱七八糟、不整齐」），
 *  而且不是系统控件的观感。换成 List 后：行高、分割线、选中高亮、分组头全是系统自己的 → 一定整齐。
 *  ⚠️ 长列表必须靠 List 自己的惰性（一季 80~120 集）。
 */
export function EpisodePicker(props: { entries: PlaylistEntry[]; index: number; onPick: (index: number) => void; onClose: () => void }) {
  const groups = groupEpisodes(props.entries)
  return <NavigationStack>
    <List listStyle="insetGroup" navigationTitle="选集" navigationBarTitleDisplayMode="inline"
      toolbar={{ topBarTrailing: <Button title="完成" action={props.onClose} /> }}>
      {groups.map(group => <Section key={group.title}
        header={<Text font="subheadline" foregroundStyle="secondaryLabel">{`${group.title} · ${group.rows.length} 集`}</Text>}>
        {group.rows.map(row => <Button key={row.index} buttonStyle="plain" action={() => props.onPick(row.index)} accessibilityLabel={row.text}>
          <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
            <Text font="body" fontWeight={row.index === props.index ? "semibold" : "regular"} foregroundStyle={row.index === props.index ? ACCENT : "label"}>{row.text}</Text>
            <Text font="footnote" foregroundStyle="tertiaryLabel" frame={{ maxWidth: "infinity", alignment: "leading" }}>{row.index === props.index ? "正在播放" : ""}</Text>
            {row.index === props.index ? <Image systemName="checkmark" font="subheadline" fontWeight="semibold" foregroundStyle={ACCENT} /> : undefined}
          </HStack>
        </Button>)}
      </Section>)}
    </List>
  </NavigationStack>
}

/** 把 `第2季 · 第12集` 这样的标签按季分组；单季的（`第12集`）归到一组不分季。 */
function groupEpisodes(entries: PlaylistEntry[]): { title: string; rows: { index: number; text: string }[] }[] {
  const groups: { title: string; rows: { index: number; text: string }[] }[] = []
  entries.forEach((entry, index) => {
    const matched = /^第(\d+)季 · (.+)$/.exec(entry.label)
    const title = matched ? `第 ${matched[1]} 季` : "全部剧集"
    const text = matched ? matched[2] : entry.label
    const last = groups[groups.length - 1]
    if (last && last.title === title) last.rows.push({ index, text })
    else groups.push({ title, rows: [{ index, text }] })
  })
  return groups
}

/**
 * 点画面的手势直接挂在 AVPlayerView 上（`simultaneousGesture` = 和原生自己的手势同时识别）。
 * 两个铁律（都是 1.6.x 用户实报踩出来的，别回头）：
 *  1. ❌ 别盖透明视图接点击 —— 遮罩会把触摸从 AVKit 手里抢走，原生栏就不算“用户交互过”；
 *  2. ❌ 别去动 `showsPlaybackControls` 开关 —— 那个属性被按成 false 期间 AVKit 不记交互，
 *     再按回 true 它按旧时间戳一算就立刻把原生栏收回去（症状：控件闪一下就没了）。
 * ✅ 就一句：点击用 `simultaneousGesture` 挂在 AVPlayerView 上（两边同时收，谁也不抢），
 *    原生栏完全交给 AVKit 自己（自己显、自己收、暂停常显），我们这排只跟着同一个点击走。
 */
let playerTapAction: () => void = () => {}
const PLAYER_TAP = (() => {
  try { return TapGesture({ count: 1 }).onEnded(() => playerTapAction()) } catch { return undefined }
})()

/** 我这排按钮的空闲隐藏时间。
 *  ⚠️ 现在原生栏的显隐完全由 AVKit 自己算（不再由我们强制），所以这里只能“跟着节奏”：
 *  iOS 原生大约 4 秒收，我们取 3.5 —— 宁可我们早一点点收，也不要出现「原生没了、自建还杵着」。
 *  如果真机上看到明显不同步，改这一个数字就行。 */
const CONTROLS_IDLE_MS = 3500

import { registerPlayback } from "./playback"

/** 位置/状态的轮询间隔：用来把「播放/暂停、位置跳动」这些原生侧的可见变化同步给这排按钮。
 *  ⚠️ 这个轮询**只读不写**——以前它会顺手把原生 ± 的 10 秒“纠正”成 30 秒，
 *  但原生按钮的图标（backward.10 / goforward.10）是系统素材改不了，光改行为就成了
 *  「图标 10、实际 30」。现在图标与行为都交给系统原生（10 秒）；
 *  顺带把「在进度条上点一下跳 6~22 秒被误当成跳过而补成 30」这个隐患一并消掉了。 */
/** 播放状态轮询间隔。原来 120ms（8 次/秒）跨桥读 rate/currentTime，暂停时也照跑 →
 *  换 350ms：进度记录本来就只精确到秒，人眼也感知不到差别，但桥接调用少了一大半。 */
const SYNC_POLL_MS = 350

function haptic() { try { HapticFeedback.selection() } catch { /* 触感不可用不该带崩脚本 */ } }

export async function presentPlayer(playlist: Playlist): Promise<void> {
  const player = new AVPlayer()
  let presented = false
  // 全屏模态这条路是自己先备好源再 present，所以这里得先把第一集等到手
  const first = await playlist.first
  try {
    player.onReadyToPlay = () => player.play()
    if (!player.setSource(first.url)) throw new Error("系统无法加载当前视频流。")
    SharedAudioSession.setCategory("playback", ["defaultToSpeaker"])
    SharedAudioSession.setActive(true)
    presented = true
    await Navigation.present({
      element: <PlayerModal player={player} playlist={playlist} first={first} />,
      modalPresentationStyle: "fullScreen",
    })
  } finally {
    // ⚠️ 模态没挂上（setSource 失败 / present 抛错）时组件 cleanup 根本不会跑，
    // 得自己把解密会话还回去，否则它带整集预分配缓冲（上限 160MB）一直留在 sessions 里。
    if (!presented) first.release()
    try { player.stop(); player.dispose() } catch { /* ignore */ }
    // 关掉播放器就把音频会话还回去，否则别的 App 的音乐会一直被我们占着（不会自动恢复）
    SharedAudioSession.setActive(false, ["notifyOthersOnDeactivation"]).catch(() => { /* 失败也不影响退出 */ })
  }
}

function PlayerModal({ player, playlist, first }: { player: AVPlayer; playlist: Playlist; first: Playable }) {
  const dismiss = Navigation.useDismiss()
  const pipStatus = useObservable<PIPStatus>()

  const [entries, setEntries] = useState<PlaylistEntry[]>(playlist.entries)
  const [index, setIndex] = useState(playlist.startIndex)
  const [busy, setBusy] = useState("")
  const [landscape, setLandscape] = useState(false)
  const [error, setError] = useState("")
  const [countdown, setCountdown] = useState(0)
  const [finished, setFinished] = useState(false)
  /** 自建按钮跟随原生控件栏一起自动隐藏 / 点击重新出现 */
  const [controlsShown, setControlsShown] = useState(true)
  /** 选集面板 */
  const [pickerOpen, setPickerOpen] = useState(false)
  const hideTimer = useRef<any>(null)
  /** 轮询里要调 showControls（跳 effect 边界，用 ref 拿最新的） */
  const showControlsRef = useRef<() => void>(() => {})
  /** 手势回调里读当前显隐（模块级手势单例拿不到渲染闭包） */
  const shownRef = useRef(true)
  shownRef.current = controlsShown
  /** 推迟到 180ms 后才真隐（按原生控件引起的点击不该把所有控件都收起来） */
  const hideSoonTimer = useRef<any>(null)
  /** 有弹窗或没在播时，原生控件栏是常显的，我们也不隐藏 */
  const keepVisibleRef = useRef(false)

  const total = entries.length
  const indexRef = useRef(index)
  indexRef.current = index
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const sessionRef = useRef<Playable | null>(first)
  const prefetchRef = useRef<{ index: number; promise: Promise<Playable>; at: number } | null>(null)
  const goRef = useRef<(next: number) => void>(() => {})
  const extendRef = useRef<() => void>(() => {})
  const aliveRef = useRef(true)
  const extendingRef = useRef(false)

  /** 提前把下一集的头部与密钥准备好，切集时就不用再等 ~0.7s。 */
  function prefetch(next: number) {
    if (next < 0 || next >= entriesRef.current.length) return
    if (prefetchRef.current?.index === next) return
    releasePrefetch()
    const promise = playlist.resolve(next)
    promise.catch(() => { /* 真正用到时再报错 */ })
    prefetchRef.current = { index: next, promise, at: Date.now() }
  }
  function releasePrefetch() {
    const cached = prefetchRef.current
    if (!cached) return
    prefetchRef.current = null
    cached.promise.then(item => item.release()).catch(() => { /* ignore */ })
  }
  async function take(next: number): Promise<Playable> {
    const cached = prefetchRef.current
    // CDN 直链约 5 分钟过期，过期的地址会挂住连接，所以太旧就丢弃重取
    if (cached && cached.index === next && Date.now() - cached.at < 150000) {
      prefetchRef.current = null
      return await cached.promise
    }
    releasePrefetch()
    return await playlist.resolve(next)
  }

  function go(next: number) {
    if (next < 0 || next >= entriesRef.current.length || next === indexRef.current) { setCountdown(0); return }
    setCountdown(0)
    setFinished(false)
    setError("")
    // 切集会让 currentTime 归 0，轮询里早就不再拿它当异常了
    setBusy("正在准备下一集…")
    const seq = ++goSeqRef.current
    void take(next).then(playable => {
      // ⚠️ 倒数自动切集与手动点「下一集」可能同帧发生：后到的旧结果必须丢弃，
      // 否则它会把正在播的新集当成 previous 释放掉（后续 Range 全 404）。
      if (seq !== goSeqRef.current) { playable.release(); return }
      if (!aliveRef.current) { playable.release(); return }
      // ⚠️ 先确认新流能加载，再改状态：若改完状态才失败，界面会显示新集、实际还在放旧流，
      // 而旧会话又没人 release（泄漏一整集的预分配缓冲）。
      if (!player.setSource(playable.url)) {
        playable.release()
        setBusy("")
        setError("系统无法加载下一集。")
        return
      }
      const previous = sessionRef.current
      sessionRef.current = playable
      indexRef.current = next
      setIndex(next)
      playlist.onSwitch(next, playable)
      if (previous) previous.release()
      setBusy("")
      prefetch(next + 1)
    }).catch((reason: unknown) => {
      if (!aliveRef.current) return
      setBusy("")
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  goRef.current = go

  /** 当前季播完 → 去要下一季；拿到就把条目追加到列表尾部并继续倒数。 */
  function reachNextSeason() {
    if (extendingRef.current) return
    const more = playlist.extend
    if (!more) { setFinished(true); return }
    extendingRef.current = true
    setBusy("正在接上下一季…")
    void more().then(added => {
      extendingRef.current = false
      if (!aliveRef.current) return
      setBusy("")
      if (!added || !added.length) { setFinished(true); return }
      setEntries(current => {
        const merged = [...current, ...added]
        entriesRef.current = merged
        return merged
      })
      if (playlist.autoNext) setCountdown(COUNTDOWN)
      else prefetch(indexRef.current + 1)
    }).catch((reason: unknown) => {
      extendingRef.current = false
      if (!aliveRef.current) return
      setBusy("")
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  extendRef.current = reachNextSeason

  /** 起始定位只在第一集生效；在第一次 ready 后清零（后面切集都是从头播）。 */
  const startRef = useRef(playlist.startPosition ?? 0)
  const lastReportRef = useRef(0)
  /** 切集序号：连点/自动倒数撞车时，丢弃后到的旧结果。 */
  const goSeqRef = useRef(0)

  /**
   * 定位到上次的进度。
   * ⚠️ AVPlayer 的 `currentTime` 是**可写**的（代码里「重播本集」就是写 0），所以不需要额外 seek API。
   * 挂载时试一次（可能已 ready）、每次 ready 时再来一次（这时肯定生效），ready 那次应用完就清零。
   */
  function applyStart(clearAfter = false) {
    // ⚠️ 只对「本来就要接着上次进度播的那一集」生效：第一集始终加载不出来、用户手动切到别集时，
    // 别把上一集的进度 seek 到这一集上（那也是「切集被拉回」的一种）。
    if (indexRef.current !== playlist.startIndex) { startRef.current = 0; return }
    const seconds = startRef.current
    if (seconds > 3) {
      try { player.currentTime = seconds } catch { /* 定位失败就从头播，不要因此报错 */ }
    }
    if (clearAfter) startRef.current = 0
  }

  /** 把当前进度交给调用方（节流：默认 12 秒一次；退出/切集时 force）。
   *  原来 4 秒一次：每次都要「读全表 + 重写整张历史」（含 intro，上百条时是周期性落盘）。
   *  进度只精确到秒 + 退出/暂停/切集都有 force flush，所以拉到 12 秒感知不到差别。 */
  function reportProgress(force: boolean) {
    const callback = playlist.onProgress
    if (!callback) return
    const at = Date.now()
    if (!force && at - lastReportRef.current < 12000) return
    lastReportRef.current = at
    try {
      callback(indexRef.current, Math.max(0, Math.floor(Number(player.currentTime) || 0)), Math.max(0, Math.floor(Number(player.duration) || 0)))
    } catch { /* 记录进度失败不该影响播放 */ }
  }

  /** 收起 / 被关掉：暂停并归还音频会话（否则「界面都收起来了声音还在响」）。 */
  function suspendLocal() {
    try { player.pause() } catch { /* ignore */ }
    SharedAudioSession.setActive(false, ["notifyOthersOnDeactivation"]).catch(() => { /* ignore */ })
  }

  /** 从最小化回来：把音频会话再占回来（不自动续播）。 */
  function resumeLocal() {
    void SharedAudioSession.setCategory("playback", ["defaultToSpeaker"])
      .catch(() => { /* ignore */ })
      .then(() => SharedAudioSession.setActive(true))
      .catch(() => { /* ignore */ })
  }

  useEffect(() => {
    player.onReadyToPlay = () => {
      applyStart(true)
      player.play()
      prefetch(indexRef.current + 1)
    }
    player.onError = message => setError(message)
    player.onEnded = () => {
      const list = entriesRef.current
      const next = indexRef.current + 1
      if (next < list.length) {
        if (playlist.autoNext) setCountdown(COUNTDOWN)
        else prefetch(next)
      } else {
        extendRef.current()
      }
    }
    Device.supportedInterfaceOrientations = ["allButUpsideDown"]
    // 登记进脚本级开关：收起（最小化）/ 退出脚本时由 index.tsx 统一叫停
    const unregister = registerPlayback({ suspend: suspendLocal, resume: resumeLocal })
    showControls()
    applyStart()
    return () => {
      aliveRef.current = false
      unregister()
      // ⚠️ 必须把回调摘掉：卸载后 onReadyToPlay 仍会跑 prefetch → 建一个**没人 release** 的解密会话
      // （整集预分配缓冲，上限 160MB），onEnded 会发 extend、onError 会 setState。
      player.onReadyToPlay = () => { }
      player.onError = () => { }
      player.onEnded = () => { }
      // 退出（含切后台被回收）前把最后的进度存下来
      reportProgress(true)
      if (hideTimer.current) clearTimeout(hideTimer.current)
      if (hideSoonTimer.current) clearTimeout(hideSoonTimer.current)
      playerTapAction = () => {}
      Device.supportedInterfaceOrientations = Device.userConfiguredInterfaceOrientations
      sessionRef.current?.release()
      sessionRef.current = null
      releasePrefetch()
    }
    // 只挂载一次：所有依赖都通过 ref 读取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 自动连播倒数
  useEffect(() => {
    if (countdown <= 0) return
    if (countdown === 1) { goRef.current(indexRef.current + 1); return }
    const timer = setTimeout(() => setCountdown(value => (value > 0 ? value - 1 : 0)), 1000)
    return () => clearTimeout(timer)
  }, [countdown])

  const current = entries[index]
  keepVisibleRef.current = !!busy || countdown > 0 || finished || !!error || pickerOpen

  /** 亮起自建按钮，并从现在开始计自动隐藏（和原生控件栏一个节奏）。
   *  ⚠️ `timeControlStatus` 是**数值 enum**（paused=0 / waitingToPlayAtSpecifiedRate=1 /
   *  playing=2），不是字符串——之前用 `String(...).includes("playing")` 判断永远为假，
   *  结果按钮一直显示不隐藏。现在用 `rate > 0` + 枚举值双重判断。 */
  function isPlaying(): boolean {
    if (Number(player.rate) > 0) return true
    return (player.timeControlStatus as unknown as number) === 2
  }

  function showControls() {
    cancelHideSoon()
    setControlsShown(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null
      // 暂停中 / 有状态弹窗时原生也是常显的，就继续亮着
      if (keepVisibleRef.current || !isPlaying()) { showControls(); return }
      setControlsShown(false)
    }, CONTROLS_IDLE_MS)
  }
  showControlsRef.current = showControls

  /** 立刻收起我这排（原生栏不碰，它由 AVKit 自己管） */
  function hideControls() {
    cancelHideSoon()
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null }
    setControlsShown(false)
  }
  function cancelHideSoon() {
    if (hideSoonTimer.current) { clearTimeout(hideSoonTimer.current); hideSoonTimer.current = null }
  }

  /** 按钮动作统一入口：先亮控件再执行（等价于原生里「一碰就亮」） */
  function act(action: () => void): () => void {
    return () => { showControls(); action() }
  }

  /** 点画面：原生栏由 AVKit 自己管，我们这排跟着同一个点击一起进/出。
   *  ⚠️ 隐藏推迟 180ms：如果这一下其实是按在原生控件上（暂停 / ⏪⏩），
   *     轮询会在 120ms 内报一次“状态变了”并 showControls()，这次隐藏就被取消
   *     ——否则会先隐一下再亮回来，看着像抽筋。 */
  function toggleControls() {    if (!shownRef.current) { cancelHideSoon(); showControls(); return }
    cancelHideSoon()
    hideSoonTimer.current = setTimeout(() => { hideSoonTimer.current = null; hideControls() }, 180)
  }
  playerTapAction = toggleControls

  /**
   * 只做「跟着亮」的同步（**绝不写回任何时间**）：
   *  · 播放/暂停切换 → 原生暂停时控件栏常显，我们跟着亮；
   *  · 位置突然跳（原生 ±10 秒 / 拖进度条 / 点进度条 / 切集）→ 原生栏这时也是亮的，我们跟着亮。
   * ⚠️ 以前这里会把这个跳变“纠正”成 ±30 秒，已移除：原生那对按钮的图标（backward.10/goforward.10）
   *  是系统素材改不了，光改行为就成了「图标 10、实际 30」。现在**只读不写**，
   *  「进度条拖多少就是多少」也从“靠 rate 判断拖着呢”变成了结构性保证。
   */
  useEffect(() => {
    let last = Number(player.currentTime) || 0
    let timer: any = null
    let stopped = false
    let wasPlaying = false
    const tick = () => {
      if (stopped) return
      const playing = Number(player.rate) > 0
      const now = Number(player.currentTime) || 0
      // 一帧（120ms）内正常只会走 0.12s；超过 1.2s 就是跳了
      const jumped = Math.abs(now - last) > 1.2
      if (playing !== wasPlaying || jumped) { wasPlaying = playing; showControlsRef.current() }
      last = now
      reportProgress(false)
      timer = setTimeout(tick, SYNC_POLL_MS)
    }
    // ⚠️ Scripting 里没有 setInterval，只能用 setTimeout 自链
    timer = setTimeout(tick, SYNC_POLL_MS)
    return () => { stopped = true; if (timer) clearTimeout(timer) }
    // 只挂载一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 下一集：已经是本季最后一集时，改成试着接下一季。 */
  function nextEpisode() {
    const next = indexRef.current + 1
    if (next < entriesRef.current.length) { go(next); return }
    extendRef.current()
  }

  /** 选集面板里点某一集：先关面板再切，避免两个呈现打架 */
  function pickEpisode(next: number) {
    setPickerOpen(false)
    haptic()
    go(next)
  }

  /** 横竖屏切换：没有强制旋转的系统接口，只能收窄支持的方向让系统自己转过去。 */
  function toggleOrientation() {
    const next = !landscape
    setLandscape(next)
    Device.supportedInterfaceOrientations = next ? ["landscapeLeft", "landscapeRight"] : ["portrait"]
    haptic()
  }
  const card = (children: any) => <VStack spacing={12} padding={{ horizontal: 22, vertical: 18 }} background="rgba(0,0,0,0.74)" clipShape={{ type: "rect", cornerRadius: 18, style: "continuous" }} frame={{ maxWidth: 300 }}>
    {children}
  </VStack>

  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} background="black"
    sheet={{ isPresented: pickerOpen, onChanged: setPickerOpen, content: pickerOpen ? <EpisodePicker entries={entries} index={index} onPick={pickEpisode} onClose={() => setPickerOpen(false)} /> : <VStack /> }}>
    {/*
      ❌❌ 千万别再动 `showsPlaybackControls` 这个开关（1.6.4 用户实报「控件出现一瞬间就消失」的真因）。
         AVKit 是靠「上次交互时间」+ 自己的超时逻辑决定原生栏什么时候收的；
         一旦这个属性被按成 false，它就不再把点击算成交互，时间戳停在过去；
         等我们再按回 true，它按旧时间戳一算「早该收了」，于是**闪一下就收回去**。
         （上一版那层抢触摸的遮罩之所以只能冒出三个按钮，也是同一个原因。）
      ✅ 所以：开关不碰，原生栏 100% 交给 AVKit 自己管（自己显、自己收、暂停时常显）；
         我们这排只跟着“同一批信号”走：同一个点击（simultaneousGesture）与轮询到的
         播放/暂停、跳过、切集——不再去猜原生栏在不在。
      ⚠️ 因此两边的**自动**隐藏各算各的（我们 3.5s 略早于原生 ~4s）：宁可我们早一点点收，
         也不要出现「原生没了、自建还杵在那」。
    */}
    <AVPlayerView
      player={player}
      pipStatus={pipStatus}
      allowsPictureInPicturePlayback
      canStartPictureInPictureAutomaticallyFromInline
      updatesNowPlayingInfoCenter
      videoGravity="resizeAspect"
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      ignoresSafeArea
      simultaneousGesture={PLAYER_TAP}
    />

    {/*
      原生控件栏没有注入/替换单个按钮的接口（AVPlayerViewProps 只有 showsPlaybackControls 、
      renderingMode 这些整体开关），所以这排自建按钮要对齐原生控件栏里「倍速」的高度。
      ✅ 数值是从用户真机截图的像素里量出来的（不是估的）：
         原生「倍速」直径 88px、中心离屏底 207px；
         比例用「我自己 36pt 的钮量到 66~71px」反推得 ≈1.82 px/pt；
         本层在安全区内（安全区底边 ~34pt）→ 留 59 才能让 42pt 钮中心落同一高度：
         34 + 59 + 21 = 114pt ✅
    */}
    <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottom" }} padding={{ bottom: 59, horizontal: 18 }}>
      <HStack spacing={9} frame={{ maxWidth: "infinity", alignment: "leading" }}
        opacity={controlsShown ? 1 : 0}
        allowsHitTesting={controlsShown}
        animation={{ animation: Animation.easeOut(0.25), value: controlsShown }}>
        <NativeButton systemImage="backward.end.fill" label="上一集" disabled={index <= 0 || !!busy} action={act(() => go(index - 1))} />
        <NativeButton systemImage="forward.end.fill" label="下一集" disabled={!!busy} action={act(nextEpisode)} />
        <NativeButton systemImage="list.bullet.rectangle" label="选集" disabled={!!busy} action={act(() => setPickerOpen(true))} />
        <NativeButton systemImage={landscape ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right"} label="横竖屏切换" action={act(toggleOrientation)} />
      </HStack>
    </VStack>

    {/** 状态弹窗（原生控件不具备的状态） */}
    <VStack spacing={14} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "center" }}>
      {busy ? card(<>
        <ProgressView progressViewStyle="circular" tint="white" />
        <Text font="subheadline" foregroundStyle="white" frame={{ maxWidth: "infinity" }} multilineTextAlignment="center">{busy}</Text>
      </>) : undefined}

      {countdown > 0 ? card(<>
        <Text font="headline" fontWeight="bold" foregroundStyle="white" frame={{ maxWidth: "infinity" }} multilineTextAlignment="center">
          {`即将播放 ${entries[index + 1]?.label ?? ""}`}
        </Text>
        <Text font="subheadline" foregroundStyle="white" opacity={0.8} frame={{ maxWidth: "infinity" }} multilineTextAlignment="center">
          {`${Math.max(1, countdown - 1)} 秒后自动开始`}
        </Text>
        <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
          <Button title="立即播放" tint="white" frame={{ maxWidth: "infinity" }} action={() => go(index + 1)} />
          <Button title="取消" frame={{ maxWidth: "infinity" }} action={() => setCountdown(0)} />
        </HStack>
      </>) : undefined}

      {finished ? card(<>
        <Text font="headline" fontWeight="bold" foregroundStyle="white" frame={{ maxWidth: "infinity" }} multilineTextAlignment="center">已看完 {total} 集</Text>
        <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
          <Button title="重播本集" tint="white" frame={{ maxWidth: "infinity" }} action={() => { player.currentTime = 0; player.play() }} />
          <Button title="关闭" frame={{ maxWidth: "infinity" }} action={() => dismiss()} />
        </HStack>
      </>) : undefined}

      {error ? card(<>
        <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
          <Image systemName="exclamationmark.triangle.fill" foregroundStyle="systemOrange" />
          <Text font="headline" fontWeight="bold" foregroundStyle="white" frame={{ maxWidth: "infinity", alignment: "leading" }}>{current?.label ? `${current.label} 播放失败` : "播放失败"}</Text>
        </HStack>
        <Text font="footnote" foregroundStyle="white" opacity={0.8} lineLimit={4} multilineTextAlignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" }}>{error}</Text>
        <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
          {index + 1 < total ? <Button title="下一集" tint="white" frame={{ maxWidth: "infinity" }} action={() => go(index + 1)} /> : undefined}
          <Button title="关闭" frame={{ maxWidth: "infinity" }} action={() => dismiss()} />
        </HStack>
      </>) : undefined}
    </VStack>
  </ZStack>
}
