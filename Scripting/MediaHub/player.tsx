import {
  AVPlayerView,
  Button,
  Device,
  HStack,
  Navigation,
  PIPStatus,
  Text,
  VStack,
  ZStack,
  useEffect,
  useObservable,
  useState,
  SharedAudioSession,
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

  const recordProgress = () => {
    if (!options.mediaId) return
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
    })

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
    SharedAudioSession.setCategory("playback", ["defaultToSpeaker"])
    SharedAudioSession.setActive(true)

    const ok = player.setSource(options.url, {
      headers: options.headers,
    })
    if (!ok) {
      throw new Error("无法加载当前视频源，请检查链接或格式。")
    }

    player.onReadyToPlay = () => {
      if (settings.rememberProgress && options.startTime && options.startTime > 5) {
        const duration = mediaSeconds(player.duration)
        if (!duration || options.startTime < duration * 0.95) {
          player.currentTime = options.startTime
        }
      }
      player.play()
      recordProgress()
    }

    player.onTimeControlStatusChanged = status => {
      // status: playing / paused / waitingToPlayAtSpecifiedRate
      if (status === 0 /* paused */) {
        recordProgress()
      }
    }

    player.onEnded = () => {
      recordProgress()
      options.onEnded?.()
    }

    player.onError = message => {
      console.error("MediaHub 播放错误:", message)
    }

    scheduleCheckpoint()

    await Navigation.present({
      element: (
        <PlayerPage
          player={player}
          title={options.title || "正在播放"}
        />
      ),
      modalPresentationStyle: "fullScreen",
    })
  } finally {
    active = false
    clearTimeout(checkpointTimer)
    recordProgress()
    player.stop()
    player.dispose()
  }
}

function PlayerPage({
  player,
  title,
}: {
  player: AVPlayer
  title: string
}) {
  const pipStatus = useObservable<PIPStatus>()
  const [showTitle, setShowTitle] = useState(true)

  useEffect(() => {
    Device.supportedInterfaceOrientations = ["allButUpsideDown"]
    const timer = setTimeout(() => setShowTitle(false), 3500)
    return () => {
      clearTimeout(timer)
      Device.supportedInterfaceOrientations = Device.userConfiguredInterfaceOrientations
    }
  }, [])

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

      {showTitle ? (
        <VStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          padding={{ top: 56, horizontal: 20 }}
          alignment="leading"
        >
          <HStack
            spacing={10}
            padding={{ horizontal: 14, vertical: 10 }}
            background="black"
            opacity={0.72}
            clipShape={{ type: "capsule", style: "continuous" }}
          >
            <Text
              font="subheadline"
              fontWeight="semibold"
              foregroundStyle="white"
              lineLimit={1}
            >
              {title}
            </Text>
          </HStack>
          <VStack frame={{ maxHeight: "infinity" }} />
        </VStack>
      ) : null}
    </ZStack>
  )
}
