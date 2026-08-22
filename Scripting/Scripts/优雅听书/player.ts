import { Script, Widget } from "scripting"
import { Audiobook, Chapter } from "./models"
import { getAudioUrl } from "./api"

export type PlayMode = "sequential" | "repeat-one"
export type PlayerState = "idle" | "loading" | "playing" | "paused" | "error"

type PlayerEvent = {
  onStateChange?: (state: PlayerState) => void
  onChapterChange?: (chapter: Chapter | null, book: Audiobook | null) => void
  onProgressChange?: (current: number, duration: number) => void
  onQueueChange?: (chapters: Chapter[]) => void
  onPlayModeChange?: (mode: PlayMode) => void
  onSpeedChange?: (speed: number) => void
  onError?: (error: string) => void
}

class Player {
  private player: AVPlayer | null = null
  private currentChapter: Chapter | null = null
  private currentBook: Audiobook | null = null
  private chapters: Chapter[] = []
  private currentIndex = -1
  private playMode: PlayMode = "sequential"
  private state: PlayerState = "idle"
  private listeners: PlayerEvent[] = []
  private progressTimer: number | null = null
  private initialized = false
  private speed = 1.0
  private resolveGeneration = 0
  private sleepTimerMinutes = 0
  private sleepTimerEndsAt = 0
  private restorePosition = -1
  private nowPlayingArtworkUrl: string | null = null
  private nowPlayingArtwork: UIImage | null = null
  private lastNowPlayingInfoAt = 0

  private static readonly STORAGE_BOOK_KEY = "lrts_player_book"
  private static readonly STORAGE_CHAPTERS_KEY = "lrts_player_chapters"
  private static readonly STORAGE_INDEX_KEY = "lrts_player_index"
  private static readonly STORAGE_MODE_KEY = "lrts_player_mode"
  private static readonly STORAGE_SPEED_KEY = "lrts_player_speed"
  private static readonly STORAGE_POSITION_KEY = "lrts_player_position"
  private static readonly STORAGE_SLEEP_KEY = "lrts_player_sleep_minutes"

  async init(): Promise<void> {
    if (this.initialized) return
    this.initialized = true

    this.player = new AVPlayer()
    this.player.rate = this.speed
    this.player.onReadyToPlay = () => {
      this.player!.rate = this.speed
      MediaPlayer.playbackState = MediaPlayerPlaybackState.playing
      this.setState("playing")
      this.player?.play()
      const dur = this.player?.duration ?? 0
      if (isFinite(dur) && dur > 0) {
        this.listeners.forEach((l) => l.onProgressChange?.(0, dur))
      }
      // Restore playback position (from a previous session)
      if (this.restorePosition > 0) {
        const pos = this.restorePosition
        this.restorePosition = -1
        this.seek(pos)
      }
      this.startProgressTimer()
      void this.updateNowPlayingInfo(true)
    }
    this.player.onEnded = () => this.handlePlaybackEnded()
    this.player.onError = (message) => {
      const title = this.currentChapter?.title
      const detail = title ? `「${title}」播放失败：${message}` : `播放失败：${message}`
      this.setState("error")
      this.listeners.forEach((l) => l.onError?.(detail))
    }

    SharedAudioSession.setCategory("playback", ["allowBluetoothA2DP", "allowAirPlay"])
    SharedAudioSession.setActive(true)
    this.configureRemoteCommands()
    this.restoreSession()

    // Continue playback when script is minimized (UI hidden)
    Script.onMinimize(() => {
      void this.updateNowPlayingInfo(true)
    })

    // Restore audio session when the script is resumed
    Script.onResume(() => {
      SharedAudioSession.setActive(true)
    })
  }

  private restoreSession() {
    const bookRaw = Storage.get<string>(Player.STORAGE_BOOK_KEY)
    const chaptersRaw = Storage.get<string>(Player.STORAGE_CHAPTERS_KEY)
    const indexRaw = Storage.get<string>(Player.STORAGE_INDEX_KEY)
    const modeRaw = Storage.get<string>(Player.STORAGE_MODE_KEY)
    const speedRaw = Storage.get<string>(Player.STORAGE_SPEED_KEY)
    const sleepRaw = Storage.get<string>(Player.STORAGE_SLEEP_KEY)
    const positionRaw = Storage.get<string>(Player.STORAGE_POSITION_KEY)

    if (speedRaw) {
      try { this.speed = JSON.parse(speedRaw) as number } catch { /* ignore */ }
    }
    if (sleepRaw) {
      try { this.sleepTimerMinutes = JSON.parse(sleepRaw) as number } catch { /* ignore */ }
    }
    if (bookRaw && chaptersRaw) {
      try {
        const book = JSON.parse(bookRaw) as Audiobook
        const chapters = JSON.parse(chaptersRaw) as Chapter[]
        const index = indexRaw ? JSON.parse(indexRaw) as number : 0
        this.currentBook = book
        this.chapters = chapters
        this.currentIndex = Math.max(0, Math.min(index, chapters.length - 1))
        this.currentChapter = chapters[this.currentIndex] ?? null
        if (positionRaw) {
          try { this.restorePosition = JSON.parse(positionRaw) as number } catch { /* ignore */ }
        }
        if (modeRaw) this.playMode = JSON.parse(modeRaw) as PlayMode
        this.listeners.forEach((l) => l.onChapterChange?.(this.currentChapter, book))
        this.listeners.forEach((l) => l.onQueueChange?.(chapters))
        this.listeners.forEach((l) => l.onSpeedChange?.(this.speed))
      } catch { /* ignore */ }
    }
  }

  on(events: PlayerEvent): () => void {
    this.listeners.push(events)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== events)
    }
  }

  async play(): Promise<void> {
    if (this.state === "paused" && this.player) {
      this.player.play()
      MediaPlayer.playbackState = MediaPlayerPlaybackState.playing
      this.setState("playing")
      this.startProgressTimer()
      void this.updateNowPlayingInfo(true)
    } else if (this.currentChapter) {
      await this.playChapter(this.currentChapter)
    }
  }

  async pause(): Promise<void> {
    this.player?.pause()
    this.setState("paused")
    this.stopProgressTimer()
    MediaPlayer.playbackState = MediaPlayerPlaybackState.paused
    // Save playback position
    const time = this.player?.currentTime ?? 0
    Storage.set(Player.STORAGE_POSITION_KEY, JSON.stringify(time))
    void this.updateNowPlayingInfo(true)
  }

  stop(): void {
    this.player?.stop()
    this.setState("idle")
    this.stopProgressTimer()
    this.chapters = []
    this.currentIndex = -1
    this.currentChapter = null
    this.currentBook = null
    this.sleepTimerEndsAt = 0
    this.listeners.forEach((l) => l.onChapterChange?.(null, null))
    this.listeners.forEach((l) => l.onQueueChange?.([]))
    MediaPlayer.playbackState = MediaPlayerPlaybackState.stopped
    MediaPlayer.nowPlayingInfo = null
    this.nowPlayingArtworkUrl = null
    this.nowPlayingArtwork = null
  }

  async next(): Promise<void> {
    const nextIndex = this.getNextIndex()
    if (nextIndex !== -1) await this.playAtIndex(nextIndex)
  }

  async previous(): Promise<void> {
    if (this.getCurrentTime() > 5) {
      this.seek(0)
      return
    }
    const prevIndex = this.getPreviousIndex()
    if (prevIndex !== -1) await this.playAtIndex(prevIndex)
  }

  seek(time: number): void {
    if (!this.player) return
    this.stopProgressTimer()
    const duration = this.player.duration
    const nextTime = duration > 0 ? Math.max(0, Math.min(time, duration)) : Math.max(0, time)
    this.player.currentTime = nextTime
    Storage.set(Player.STORAGE_POSITION_KEY, JSON.stringify(nextTime))
    this.listeners.forEach((l) => l.onProgressChange?.(nextTime, duration))
    void this.updateNowPlayingInfo(true)
    if (this.state === "playing") this.startProgressTimer()
  }

  setSpeed(rate: number): void {
    this.speed = Math.max(0.5, Math.min(3.0, rate))
    if (this.player && this.state === "playing") {
      this.player.rate = this.speed
    }
    Storage.set(Player.STORAGE_SPEED_KEY, JSON.stringify(this.speed))
    this.listeners.forEach((l) => l.onSpeedChange?.(this.speed))
    void this.updateNowPlayingInfo(true)
  }

  getSpeed(): number {
    return this.speed
  }

  setSleepTimer(minutes: number): void {
    this.sleepTimerMinutes = minutes
    this.sleepTimerEndsAt = minutes > 0 ? Date.now() + minutes * 60 * 1000 : 0
    Storage.set(Player.STORAGE_SLEEP_KEY, JSON.stringify(minutes))
  }

  getSleepTimer(): number {
    return this.sleepTimerMinutes
  }

  setPlayMode(mode: PlayMode): void {
    this.playMode = mode
    Storage.set(Player.STORAGE_MODE_KEY, JSON.stringify(mode))
    this.listeners.forEach((l) => l.onPlayModeChange?.(mode))
  }

  async playBook(book: Audiobook, chapters: Chapter[], startIndex = 0): Promise<void> {
    this.currentBook = book
    this.chapters = chapters
    this.currentIndex = startIndex
    this.persistSession()
    this.listeners.forEach((l) => l.onQueueChange?.(chapters))
    await this.playAtIndex(startIndex)
  }

  async playAtIndex(index: number): Promise<void> {
    if (index < 0 || index >= this.chapters.length) return
    this.currentIndex = index
    await this.playChapter(this.chapters[index])
  }

  removeFromQueue(index: number): void {
    if (index < 0 || index >= this.chapters.length) return
    const removingCurrent = index === this.currentIndex
    this.chapters.splice(index, 1)
    if (this.chapters.length === 0) {
      this.currentIndex = -1
      this.persistSession()
      this.stop()
      return
    }
    if (index < this.currentIndex) {
      this.currentIndex -= 1
    } else if (removingCurrent) {
      if (this.currentIndex >= this.chapters.length) this.currentIndex = this.chapters.length - 1
      this.persistSession()
      void this.playAtIndex(this.currentIndex)
      return
    }
    this.persistSession()
  }

  clearQueue(): void {
    this.chapters = []
    this.currentIndex = -1
    this.stop()
    this.persistSession()
  }

  private persistSession() {
    Storage.set(Player.STORAGE_BOOK_KEY, JSON.stringify(this.currentBook))
    Storage.set(Player.STORAGE_CHAPTERS_KEY, JSON.stringify(this.chapters))
    Storage.set(Player.STORAGE_INDEX_KEY, JSON.stringify(this.currentIndex))
    this.listeners.forEach((l) => l.onQueueChange?.(this.chapters))
  }

  private async playChapter(chapter: Chapter): Promise<void> {
    this.setState("loading")
    this.currentChapter = chapter
    this.listeners.forEach((l) => l.onChapterChange?.(chapter, this.currentBook))
    this.persistSession()

    const generation = ++this.resolveGeneration
    let audioUrl: string | undefined

    if (chapter.audioUrl) {
      audioUrl = chapter.audioUrl
    } else {
      try {
        audioUrl = await getAudioUrl(chapter.bookId, chapter.id, chapter.tmeId, this.currentBook?.source, chapter.section)
        if (generation !== this.resolveGeneration) return
        chapter.audioUrl = audioUrl
      } catch (e) {
        if (generation !== this.resolveGeneration) return
        this.setState("error")
        this.listeners.forEach((l) => l.onError?.(String(e)))
        return
      }
    }

    if (generation !== this.resolveGeneration) return

    try {
      this.stopProgressTimer()
      this.player?.stop()
      this.player!.rate = this.speed
      this.player?.setSource(audioUrl)
      this.player?.play()
    } catch (e) {
      if (generation !== this.resolveGeneration) return
      this.setState("error")
      this.listeners.forEach((l) => l.onError?.(`无法加载音频：${String(e)}`))
    }
  }

  private handlePlaybackEnded() {
    if (this.playMode === "repeat-one") {
      this.seek(0)
      this.player?.play()
      return
    }
    const nextIndex = this.getNextIndex()
    if (nextIndex !== -1) {
      void this.playAtIndex(nextIndex)
    } else {
      // End of playlist — go to idle so next play() re-enters via playChapter
      this.setState("idle")
      this.seek(0)
      MediaPlayer.playbackState = MediaPlayerPlaybackState.paused
      void this.updateNowPlayingInfo(true)
    }
  }

  private getNextIndex(): number {
    if (this.chapters.length === 0) return -1
    if (this.playMode === "sequential") {
      return this.currentIndex < this.chapters.length - 1 ? this.currentIndex + 1 : -1
    }
    return this.currentIndex
  }

  private getPreviousIndex(): number {
    if (this.chapters.length === 0) return -1
    return this.currentIndex > 0 ? this.currentIndex - 1 : -1
  }

  private setState(newState: PlayerState) {
    if (this.state === newState) return
    this.state = newState
    this.listeners.forEach((l) => l.onStateChange?.(newState))
  }

  private startProgressTimer() {
    this.stopProgressTimer()
    const tick = () => {
      if (!this.player) return
      const current = this.player.currentTime
      const duration = this.player.duration
      this.listeners.forEach((l) => l.onProgressChange?.(current, duration))
      if (Math.floor(current) % 10 === 0) {
        Storage.set(Player.STORAGE_POSITION_KEY, JSON.stringify(current))
      }
      this.updateNowPlayingInfoThrottled()
      if (this.sleepTimerEndsAt > 0 && Date.now() >= this.sleepTimerEndsAt) {
        this.setSleepTimer(0)
        void this.pause()
        this.sleepTimerEndsAt = 0
      }
      // Schedule next tick
      this.progressTimer = setTimeout(tick, 500) as number
    }
    this.progressTimer = setTimeout(tick, 500) as number
  }

  private stopProgressTimer() {
    if (this.progressTimer !== null) {
      clearTimeout(this.progressTimer)
      this.progressTimer = null
    }
  }

  private configureRemoteCommands() {
    MediaPlayer.setAvailableCommands([
      "play",
      "pause",
      "togglePausePlay",
      "stop",
      "nextTrack",
      "previousTrack",
      "changePlaybackPosition",
    ])

    ;(MediaPlayer as any).commandHandler = (command: MediaPlayerRemoteCommand, event: MediaPlayerRemoteCommandEvent) => {
      switch (command) {
        case "play":
          void this.play()
          break
        case "pause":
          void this.pause()
          break
        case "togglePausePlay":
          if (this.state === "playing") void this.pause()
          else void this.play()
          break
        case "stop":
          this.stop()
          break
        case "nextTrack":
          void this.next()
          break
        case "previousTrack":
          void this.previous()
          break
        case "changePlaybackPosition": {
          const position = (event as MediaPlayerChangePlaybackPositionCommandEvent).positionTime
          if (isFinite(position)) this.seek(position)
          break
        }
      }
    }
  }

  private updateNowPlayingInfoThrottled() {
    const now = Date.now()
    if (now - this.lastNowPlayingInfoAt < 3000) return
    this.lastNowPlayingInfoAt = now
    void this.updateNowPlayingInfo()
  }

  private async loadNowPlayingArtwork(url?: string): Promise<UIImage | undefined> {
    if (!url) {
      this.nowPlayingArtworkUrl = null
      this.nowPlayingArtwork = null
      return undefined
    }
    if (this.nowPlayingArtworkUrl === url) {
      return this.nowPlayingArtwork ?? undefined
    }
    this.nowPlayingArtworkUrl = url
    this.nowPlayingArtwork = (await UIImage.fromURL(url).catch(() => null)) ?? null
    return this.nowPlayingArtwork ?? undefined
  }

  private async updateNowPlayingInfo(force = false) {
    if (!this.currentChapter) {
      MediaPlayer.nowPlayingInfo = null
      return
    }

    if (force) this.lastNowPlayingInfoAt = Date.now()
    const chapterId = this.currentChapter.id
    const artwork = await this.loadNowPlayingArtwork(this.currentBook?.coverUrl)
    if (this.currentChapter?.id !== chapterId) return

    const duration = this.player?.duration ?? 0
    MediaPlayer.nowPlayingInfo = {
      title: this.currentChapter.title,
      artist: this.currentBook?.author || "未知作者",
      albumTitle: this.currentBook?.title,
      artwork,
      mediaType: MediaType.audio,
      elapsedPlaybackTime: this.player?.currentTime ?? 0,
      playbackDuration: isFinite(duration) && duration > 0 ? duration : 0,
      playbackRate: this.state === "playing" ? this.speed : 0,
      isLiveStream: false,
    }
    void this.saveNowPlayingToStorage()
  }

  private async saveNowPlayingToStorage() {
    if (!this.currentChapter) return
    const data = {
      chapter: this.currentChapter,
      book: this.currentBook,
      index: this.currentIndex,
      state: this.state,
    }
    Storage.set("lrts_now_playing", JSON.stringify(data))
    try { Widget.reloadAll() } catch { /* ignore */ }
  }

  // ─── Getters ─────────────────────────────────────────
  getState(): PlayerState { return this.state }
  getCurrentChapter(): Chapter | null { return this.currentChapter }
  getCurrentBook(): Audiobook | null { return this.currentBook }
  getQueue(): Chapter[] { return this.chapters }
  getPlayMode(): PlayMode { return this.playMode }
  getCurrentIndex(): number { return this.currentIndex }
  getCurrentTime(): number { return this.player?.currentTime ?? 0 }
  getDuration(): number { return this.player?.duration ?? 0 }
}

export const player = new Player()
