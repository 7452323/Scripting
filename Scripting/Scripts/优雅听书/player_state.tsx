import { createContext, useContext, useEffect, useObservable } from "scripting"
import { PlayMode, PlayerState, player } from "./player"
import { Audiobook, Chapter } from "./models"

type PlayerStateData = {
  state: PlayerState
  currentChapter: Chapter | null
  currentBook: Audiobook | null
  chapters: Chapter[]
  isPlaying: boolean
  playMode: PlayMode
  currentIndex: number
  speed: number
}

type PlayerProgressData = {
  currentTime: number
  duration: number
}

const initialState: PlayerStateData = {
  state: "idle",
  currentChapter: null,
  currentBook: null,
  chapters: [],
  isPlaying: false,
  playMode: "sequential",
  currentIndex: -1,
  speed: 1.0,
}

const initialProgress: PlayerProgressData = {
  currentTime: 0,
  duration: 0,
}

const PlayerStateContext = createContext<PlayerStateData>()
const PlayerProgressContext = createContext<PlayerProgressData>()

export function PlayerStateProvider({ children }: { children: JSX.Element }) {
  const state = useObservable<PlayerStateData>(initialState)

  useEffect(() => {
    const currentChapter = player.getCurrentChapter()
    const currentBook = player.getCurrentBook()
    const chapters = player.getQueue()
    if (currentChapter || currentBook || chapters.length > 0) {
      state.setValue({
        state: player.getState(),
        currentChapter,
        currentBook,
        chapters,
        isPlaying: player.getState() === "playing",
        playMode: player.getPlayMode(),
        currentIndex: player.getCurrentIndex(),
        speed: player.getSpeed(),
      })
    }

    let lastErrorAt = 0
    const unsubscribe = player.on({
      onStateChange: (newState) => {
        state.setValue({
          ...state.value,
          state: newState,
          isPlaying: newState === "playing",
        })
      },
      onChapterChange: (chapter, book) => {
        state.setValue({
          ...state.value,
          currentChapter: chapter,
          currentBook: book,
        })
      },
      onQueueChange: (chapters) => {
        state.setValue({
          ...state.value,
          chapters,
          currentIndex: player.getCurrentIndex(),
        })
      },
      onPlayModeChange: (playMode) => {
        state.setValue({
          ...state.value,
          playMode,
        })
      },
      onSpeedChange: (speed) => {
        state.setValue({
          ...state.value,
          speed,
        })
      },
      onError: (message) => {
        const now = Date.now()
        if (now - lastErrorAt < 1200) return
        lastErrorAt = now
        void Dialog.alert({
          title: "播放失败",
          message,
        })
      },
    })

    return unsubscribe
  }, [])

  return <PlayerStateContext.Provider value={state.value}>{children}</PlayerStateContext.Provider>
}

export function PlayerProgressProvider({ children }: { children: JSX.Element }) {
  const progress = useObservable<PlayerProgressData>(initialProgress)

  useEffect(() => {
    const unsubscribe = player.on({
      onChapterChange: (chapter) => {
        progress.setValue({
          currentTime: 0,
          duration: 0,
        })
      },
      onProgressChange: (current, dur) => {
        const validDuration = isFinite(dur) && dur > 0 ? dur : progress.value.duration
        progress.setValue({ currentTime: current, duration: validDuration })
      },
    })
    return unsubscribe
  }, [])

  return (
    <PlayerProgressContext.Provider value={progress.value}>{children}</PlayerProgressContext.Provider>
  )
}

export function usePlayerState(): PlayerStateData {
  return useContext(PlayerStateContext)
}

export function usePlayerProgress(): PlayerProgressData {
  return useContext(PlayerProgressContext)
}
