import { AVPlayerView, Button, Device, HStack, Navigation, PIPStatus, Text, VStack, ZStack, useEffect, useObservable, useState } from "scripting"
import { moonClient } from "./client"
import { addLocalHistory, removeLocalHistory } from "./storage"

export interface PlayerOptions {
  url: string
  fallbackUrl?: string
  episodeUrls?: string[]
  episodeTitles?: string[]
  headers?: Record<string, string>
  title?: string
  cover?: string
  episodeTitle?: string
  id?: string
  source?: string
  sourceName?: string
  episodeIndex?: number
  totalEpisodes?: number
  typeName?: string
  year?: string
}

function mediaSeconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

export async function presentPlayer(options: PlayerOptions): Promise<void> {
  const player = new AVPlayer()
  const episodeUrls = options.episodeUrls?.length ? options.episodeUrls : [options.url]
  let episodeIndex = Math.min(Math.max(options.episodeIndex || 0, 0), episodeUrls.length - 1)
  let usingFallback = false
  let pendingResumeTime = 0
  let checkpointTimer = 0
  let active = true

  const recordProgress = async (upload: boolean) => {
    if (!options.id || !options.source || !options.title) return
    const playTime = mediaSeconds(player.currentTime)
    const totalTime = mediaSeconds(player.duration)
    const index = episodeIndex + 1
    const totalEpisodes = options.totalEpisodes || episodeUrls.length || 1
    const sourceName = options.sourceName || options.source
    addLocalHistory({
      id: options.id,
      source: options.source,
      title: options.title,
      poster: options.cover || "",
      type_name: options.typeName || "",
      year: options.year || "",
      timestamp: Date.now(),
      source_name: sourceName,
      index,
      total_episodes: totalEpisodes,
      play_time: playTime,
      total_time: totalTime,
    })
    if (!upload) return
    try {
      await moonClient.savePlayRecord(options.id, options.source, index, options.title, options.cover || "", totalEpisodes, playTime, totalTime, sourceName)
      removeLocalHistory([{ id: options.id, source: options.source }])
    } catch (error) {
      console.error("MoonTVPlus 云端进度保存失败:", error)
    }
  }

  const scheduleCheckpoint = () => {
    checkpointTimer = setTimeout(() => {
      if (!active) return
      recordProgress(false).catch(() => {})
      scheduleCheckpoint()
    }, 20000)
  }

  const loadEpisode = (nextIndex: number, resumeTime = 0): boolean => {
    if (nextIndex < 0 || nextIndex >= episodeUrls.length) return false
    episodeIndex = nextIndex
    pendingResumeTime = resumeTime
    usingFallback = false
    player.pause()
    return player.setSource(episodeUrls[nextIndex], { headers: options.headers })
  }

  const switchEpisode = async (nextIndex: number): Promise<boolean> => {
    if (nextIndex < 0 || nextIndex >= episodeUrls.length || nextIndex === episodeIndex) return false
    await recordProgress(true)
    const loaded = loadEpisode(nextIndex)
    if (!loaded) console.error("系统无法切换到目标剧集")
    return loaded
  }

  try {
    if (options.id && options.source) {
      const record = await moonClient.getPlayRecord(options.id, options.source)
      if (record && record.index === episodeIndex + 1 && record.play_time > 5) {
        const nearEnd = record.total_time > 0 && record.play_time / record.total_time >= 0.95
        if (!nearEnd) pendingResumeTime = record.play_time
      }
    }

    player.onReadyToPlay = () => {
      const duration = mediaSeconds(player.duration)
      if (pendingResumeTime > 0 && (!duration || pendingResumeTime < duration)) player.currentTime = pendingResumeTime
      pendingResumeTime = 0
      player.play()
      recordProgress(false).catch(() => {})
    }
    player.onTimeControlStatusChanged = status => {
      if (status === TimeControlStatus.paused && player.currentTime > 0) recordProgress(false).catch(() => {})
    }
    player.onEnded = () => {
      recordProgress(true).catch(() => {})
      if (episodeIndex + 1 < episodeUrls.length) loadEpisode(episodeIndex + 1)
    }
    player.onError = message => {
      console.error("MoonTVPlus 播放失败:", message)
      if (!usingFallback && options.fallbackUrl && episodeUrls.length === 1 && options.fallbackUrl !== options.url) {
        usingFallback = true
        player.stop()
        player.setSource(options.fallbackUrl, { headers: options.headers })
      }
    }

    if (!loadEpisode(episodeIndex, pendingResumeTime)) {
      if (!options.fallbackUrl || !player.setSource(options.fallbackUrl, { headers: options.headers })) throw new Error("系统无法加载当前视频格式。")
      usingFallback = true
    }

    SharedAudioSession.setCategory("playback", ["defaultToSpeaker"])
    SharedAudioSession.setActive(true)
    scheduleCheckpoint()

    await Navigation.present({
      element: <PlayerModal player={player} initialEpisodeIndex={episodeIndex} episodeTitles={options.episodeTitles || []} episodeCount={episodeUrls.length} onSwitch={switchEpisode} />,
      modalPresentationStyle: "fullScreen",
    })
  } finally {
    active = false
    clearTimeout(checkpointTimer)
    await recordProgress(true)
    player.stop()
    player.dispose()
  }
}

function PlayerModal({ player, initialEpisodeIndex, episodeTitles, episodeCount, onSwitch }: { player: AVPlayer; initialEpisodeIndex: number; episodeTitles: string[]; episodeCount: number; onSwitch: (index: number) => Promise<boolean> }) {
  const pipStatus = useObservable<PIPStatus>()
  const [current, setCurrent] = useState(initialEpisodeIndex)
  const switchTo = async (index: number) => {
    if (await onSwitch(index)) setCurrent(index)
  }
  useEffect(() => {
    Device.supportedInterfaceOrientations = ["allButUpsideDown"]
    return () => { Device.supportedInterfaceOrientations = Device.userConfiguredInterfaceOrientations }
  }, [])
  return <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} background="black">
    <AVPlayerView player={player} pipStatus={pipStatus} allowsPictureInPicturePlayback canStartPictureInPictureAutomaticallyFromInline updatesNowPlayingInfoCenter videoGravity="resizeAspect" frame={{ maxWidth: "infinity", maxHeight: "infinity" }} ignoresSafeArea />
    {episodeCount > 1 ? <VStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }} padding={{ horizontal: 18, vertical: 16 }}>
      <HStack spacing={10} padding={10} background="black" opacity={0.82} clipShape={{ type: "capsule", style: "continuous" }}>
        <Button title="上一集" systemImage="backward.end.fill" disabled={current <= 0} action={() => switchTo(current - 1)} />
        <Text font="caption" foregroundStyle="white" lineLimit={1}>{episodeTitles[current] || `第 ${current + 1} 集`}</Text>
        <Button title="下一集" systemImage="forward.end.fill" disabled={current >= episodeCount - 1} action={() => switchTo(current + 1)} />
      </HStack>
      <VStack frame={{ maxHeight: "infinity" }} />
    </VStack> : null}
  </ZStack>
}
