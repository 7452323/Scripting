import {
  AVPlayerView,
  Device,
  Navigation,
  PIPStatus,
  ProgressView,
  VStack,
  ZStack,
  useEffect,
  useObservable,
  useState,
} from "scripting"
import type { PlayerOptions } from "./types"
import { addHistory, loadSettings, updateMediaItem } from "./storage"

function mediaSeconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

export async function presentPlayer(options: PlayerOptions): Promise<void> {
  const player = new AVPlayer()
  const settings = loadSettings()
  let active = true
  let checkpointTimer = 0
  let ready = false

  const recordProgress = () => {
    if (!options.mediaId || !ready) return
    const progress = mediaSeconds(player.currentTime)
    const duration = mediaSeconds(player.duration)
    if (progress <= 0) return

    addHistory({
      mediaId: options.mediaId,
      title: options.title || "未知标题",
      url: options.url,
      poster: options.poster,
      progress,
      duration,
      playedAt: Date.now(),
      headers: options.headers,
    })

    // 仅当本地库存在该 id 时更新进度
    updateMediaItem(options.mediaId, {
      lastPlayedAt: Date.now(),
      playProgress: progress,
      duration,
    })

    options.onProgress?.(progress, duration)
  }

  const scheduleCheckpoint = () => {
    checkpointTimer = setTimeout(() => {
      if (!active) return
      recordProgress()
      scheduleCheckpoint()
    }, 15000)
  }

  try {
    try {
      SharedAudioSession.setCategory("playback", ["defaultToSpeaker"])
      SharedAudioSession.setActive(true)
    } catch (e) {
      console.warn("AudioSession 配置失败", e)
    }

    const sourceOptions = options.headers ? { headers: options.headers } : undefined
    const ok = sourceOptions
      ? player.setSource(options.url, sourceOptions)
      : player.setSource(options.url)

    if (ok === false) {
      throw new Error("无法加载当前视频源，请检查链接或格式。")
    }

    player.onReadyToPlay = () => {
      ready = true
      if (settings.rememberProgress && options.startTime && options.startTime > 5) {
        const duration = mediaSeconds(player.duration)
        if (!duration || options.startTime < duration * 0.95) {
          player.currentTime = options.startTime
        }
      }
      player.play()
      recordProgress()
    }

    player.onTimeControlStatusChanged = (status: any) => {
      // 兼容枚举或数值：paused
      const paused =
        status === 0 ||
        status === "paused" ||
        status === "Paused" ||
        String(status).toLowerCase().includes("pause")
      if (paused) recordProgress()
    }

    player.onEnded = () => {
      recordProgress()
      options.onEnded?.()
    }

    player.onError = (message: string) => {
      console.error("MediaHub 播放错误:", message)
    }

    scheduleCheckpoint()

    await Navigation.present({
      element: <PlayerPage player={player} />,
      modalPresentationStyle: "fullScreen",
    })
  } finally {
    active = false
    clearTimeout(checkpointTimer)
    try {
      recordProgress()
    } catch {}
    try {
      player.stop()
    } catch {}
    try {
      player.dispose()
    } catch {}
  }
}

function PlayerPage({ player }: { player: AVPlayer }) {
  const pipStatus = useObservable<PIPStatus>()
  const [buffering, setBuffering] = useState(true)

  useEffect(() => {
    const timer = setInterval(() => {
      if (player.currentTime > 0.2) setBuffering(false)
    }, 400)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    Device.supportedInterfaceOrientations = ["allButUpsideDown"]
    return () => {
      Device.supportedInterfaceOrientations = Device.userConfiguredInterfaceOrientations
    }
  }, [])

  // 关闭完全交给 AVPlayerView 的原生控件，不再自绘任何按钮
  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      background="black"
    >
      <AVPlayerView
        player={player}
        pipStatus={pipStatus}
        allowsPictureInPicturePlayback
        canStartPictureInPictureAutomaticallyFromInline
        updatesNowPlayingInfoCenter
        videoGravity="resizeAspect"
        showsPlaybackControls
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        ignoresSafeArea
      />

      {buffering ? (
        <VStack allowsHitTesting={false}>
          <ProgressView tint="white" />
        </VStack>
      ) : null}
    </ZStack>
  )
}
