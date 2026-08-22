import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  Script,
  ScrollView,
  Section,
  Slider,
  Spacer,
  Text,
  VStack,
  ZStack,
  useEffect,
  useState,
} from "scripting"
import { player } from "./player"
import { PlayerProgressProvider, PlayerStateProvider, usePlayerState, usePlayerProgress } from "./player_state"
import { ACCENT } from "./theme"
import { Chapter } from "./models"

// ---------------------------------------------------------------------------
// Time formatting helpers
// ---------------------------------------------------------------------------

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00"
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

// ---------------------------------------------------------------------------
// Speed options
// ---------------------------------------------------------------------------

const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 3.0]

const SLEEP_OPTIONS = [
  { label: "关闭", value: 0 },
  { label: "10分钟", value: 10 },
  { label: "20分钟", value: 20 },
  { label: "30分钟", value: 30 },
  { label: "45分钟", value: 45 },
  { label: "60分钟", value: 60 },
  { label: "90分钟", value: 90 },
]

// ---------------------------------------------------------------------------
// Playback progress slider
// ---------------------------------------------------------------------------

function PlaybackSlider() {
  const { currentTime, duration } = usePlayerProgress()
  const [isDragging, setIsDragging] = useState(false)
  const [dragValue, setDragValue] = useState(0)

  const sliderMax = duration > 0 ? duration : 1
  const displayValue = isDragging ? dragValue : currentTime
  const progress = duration > 0 ? currentTime / duration : 0

  return (
    <VStack spacing={8} padding={{ horizontal: 24 }}>
      {/* Custom progress bar background */}
      <VStack spacing={0}>
        <Slider
          min={0}
          max={sliderMax}
          value={Math.min(displayValue, sliderMax)}
          step={1}
          tint={ACCENT}
          onChanged={(val) => {
            setDragValue(val)
          }}
          onEditingChanged={(editing) => {
            if (editing) {
              setIsDragging(true)
              setDragValue(currentTime)
            } else {
              void player.seek(dragValue)
              setIsDragging(false)
            }
          }}
        />
      </VStack>
      {/* Time labels */}
      <HStack>
        <Text font="caption2" foregroundStyle="rgba(255,255,255,0.6)" fontWeight="medium">
          {formatTime(displayValue)}
        </Text>
        <Spacer />
        <Text font="caption2" foregroundStyle="rgba(255,255,255,0.6)" fontWeight="medium">
          -{formatTime(Math.max(0, duration - displayValue))}
        </Text>
      </HStack>
    </VStack>
  )
}

// ---------------------------------------------------------------------------
// Transport controls (prev / play / next)
// ---------------------------------------------------------------------------

function TransportControls() {
  const { isPlaying } = usePlayerState()

  return (
    <HStack spacing={36} alignment="center">
      <Button
        title=""
        systemImage="backward.end.fill"
        font="title2"
        foregroundStyle="white"
        action={() => void player.previous()}
      />
      <Button
        title=""
        systemImage={isPlaying ? "pause.circle.fill" : "play.circle.fill"}
        font="largeTitle"
        foregroundStyle="white"
        action={() => {
          if (isPlaying) {
            void player.pause()
          } else {
            void player.play()
          }
        }}
      />
      <Button
        title=""
        systemImage="forward.end.fill"
        font="title2"
        foregroundStyle="white"
        action={() => void player.next()}
      />
    </HStack>
  )
}

// ---------------------------------------------------------------------------
// Secondary controls (speed, sleep, chapter list)
// ---------------------------------------------------------------------------

function SecondaryControls({
  showSpeed,
  showSleep,
  setShowSpeed,
  setShowSleep,
  onChapterList,
}: {
  showSpeed: boolean
  showSleep: boolean
  setShowSpeed: (v: boolean) => void
  setShowSleep: (v: boolean) => void
  onChapterList?: () => void
}) {
  const { speed, playMode } = usePlayerState()

  function togglePlayMode() {
    void player.setPlayMode(playMode === "sequential" ? "repeat-one" : "sequential")
  }

  return (
    <HStack spacing={20} alignment="center">
      {/* Play mode */}
      <Button
        title=""
        systemImage={playMode === "repeat-one" ? "repeat.1" : "repeat"}
        font="title3"
        foregroundStyle="white"
        action={togglePlayMode}
      />

      {/* Speed */}
      <Button
        title={`${speed}x`}
        font="caption"
        fontWeight="semibold"
        foregroundStyle="white"
        padding={{ horizontal: 10, vertical: 4 }}
        background="rgba(255,255,255,0.2)"
        clipShape={{ type: "rect", cornerRadius: 6 }}
        action={() => setShowSpeed(!showSpeed)}
      />

      {/* Sleep timer */}
      <Button
        title=""
        systemImage="moon.stars.fill"
        font="title3"
        foregroundStyle="white"
        action={() => setShowSleep(!showSleep)}
      />

      {/* Chapter list */}
      <Button
        title=""
        systemImage="list.bullet"
        font="title3"
        foregroundStyle="white"
        action={() => onChapterList?.()}
      />
    </HStack>
  )
}

// ---------------------------------------------------------------------------
// Speed picker popover
// ---------------------------------------------------------------------------

function SpeedPicker({ onClose }: { onClose: () => void }) {
  const { speed } = usePlayerState()

  return (
    <VStack
      spacing={0}
      background="rgba(28,28,30,0.92)"
      clipShape={{ type: "rect", cornerRadius: 14 }}
      padding={{ vertical: 6 }}
      frame={{ width: 112 }}
    >
      {SPEED_OPTIONS.map((s) => (
        <Button
          key={s}
          title={`${s}x`}
          foregroundStyle={s === speed ? ACCENT : "white"}
          fontWeight={s === speed ? "semibold" : "regular"}
          padding={{ horizontal: 18, vertical: 8 }}
          frame={{ width: 112 }}
          action={() => {
            void player.setSpeed(s)
            onClose()
          }}
        />
      ))}
    </VStack>
  )
}

// ---------------------------------------------------------------------------
// Sleep timer picker
// ---------------------------------------------------------------------------

function SleepPicker({ onClose }: { onClose: () => void }) {
  return (
    <VStack
      spacing={0}
      background="rgba(28,28,30,0.92)"
      clipShape={{ type: "rect", cornerRadius: 14 }}
      padding={{ vertical: 6 }}
      frame={{ width: 112 }}
    >
      {SLEEP_OPTIONS.map((opt) => (
        <Button
          key={opt.value}
          title={opt.label}
          foregroundStyle="white"
          padding={{ horizontal: 18, vertical: 8 }}
          frame={{ width: 112 }}
          action={() => {
            void player.setSleepTimer(opt.value)
            onClose()
          }}
        />
      ))}
    </VStack>
  )
}

// ---------------------------------------------------------------------------
// Chapter list sheet (inline — used by player)
// ---------------------------------------------------------------------------

function ChapterListSheet() {
  const { chapters, currentChapter, isPlaying } = usePlayerState()
  const [filter, setFilter] = useState("")
  const dismiss = Navigation.useDismiss()

  const filteredChapters = filter
    ? chapters.filter(
        (ch) =>
          ch.title.includes(filter) ||
          String(ch.index + 1).includes(filter)
      )
    : chapters

  return (
    <List
      listStyle="insetGroup"
      navigationTitle="播放列表"
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        topBarLeading: [
          <Button title="关闭" action={() => dismiss()} />,
        ],
        topBarTrailing: [
          <Text font="caption" foregroundStyle="secondaryLabel">
            共 {chapters.length} 章
          </Text>,
        ],
      }}
      searchable={{
        value: filter,
        onChanged: setFilter,
        placement: "navigationBarDrawer",
        prompt: "搜索章节",
      }}
    >
      <Section>
        {filteredChapters.map((chapter) => {
          const isCurrent = currentChapter?.id === chapter.id
          return (
            <Button
              key={chapter.id}
              action={() => {
                void player.playAtIndex(chapter.index)
              }}
            >
              <HStack spacing={12} padding={{ vertical: 4 }}>
                <Text
                  font="subheadline"
                  foregroundStyle={isCurrent ? ACCENT : "secondaryLabel"}
                  fontWeight={isCurrent ? "semibold" : "regular"}
                  frame={{ width: 28, alignment: "leading" }}
                >
                  {chapter.index + 1}
                </Text>
                <Text
                  font="subheadline"
                  foregroundStyle={isCurrent ? ACCENT : "label"}
                  fontWeight={isCurrent ? "semibold" : "regular"}
                  lineLimit={1}
                  layoutPriority={1}
                >
                  {chapter.title}
                </Text>
                <Spacer />
                {isCurrent && isPlaying ? (
                  <Text font="caption" foregroundStyle={ACCENT}>
                    ♪ 播放中
                  </Text>
                ) : null}
              </HStack>
            </Button>
          )
        })}
      </Section>
    </List>
  )
}

/**
 * ChapterListSheet wrapped with providers for modal presentation.
 */
export function ChapterListSheetWrapped() {
  return (
    <PlayerStateProvider>
      <PlayerProgressProvider>
        <ChapterListSheet />
      </PlayerProgressProvider>
    </PlayerStateProvider>
  )
}

// ---------------------------------------------------------------------------
// Main player page
// ---------------------------------------------------------------------------

export function PlayerPage() {
  const { currentChapter, currentBook, isPlaying, playMode, speed } = usePlayerState()
  const { currentTime, duration } = usePlayerProgress()
  const [showSpeed, setShowSpeed] = useState(false)
  const [showSleep, setShowSleep] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const dismiss = Navigation.useDismiss()

  // Listen for errors
  useEffect(() => {
    const unsub = player.on({
      onError: (msg) => {
        setErrorMsg(msg)
      },
      onStateChange: (s) => {
        if (s === "playing") setErrorMsg(null)
      },
    })
    return unsub
  }, [])

  // Background cover URL
  const coverUrl = currentBook?.coverUrl

  // calculate art size like MeloX
  const artSide = Math.min(Device.screen.width - 96, 280)

  function openChapterList() {
    Navigation.present({
      element: <ChapterListSheetWrapped />,
    })
  }

  return (
    <ZStack
      alignment="top"
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
    >
      {/* Blurred cover backdrop — fills entire ZStack */}
      {coverUrl ? (
        <Image
          imageUrl={coverUrl}
          resizable={true}
          scaleToFill={true}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          blur={40}
          clipped={true}
          ignoresSafeArea={{ regions: "all", edges: "all" }}
        />
      ) : (
        <VStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          background="systemBackground"
          ignoresSafeArea={{ regions: "all", edges: "all" }}
        />
      )}

      {/* Dimming scrim — gradient from light to dark so top drag area stays visible */}
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        background={{
          colors: ["rgba(0,0,0,0.2)", "rgba(0,0,0,0.5)", "rgba(0,0,0,0.85)"],
          startPoint: "top",
          endPoint: "bottom",
        }}
        ignoresSafeArea={{ regions: "all", edges: "all" }}
      />

      {/* Foreground content — fixed size so sheet drag area at top is NOT covered */}
      <VStack
        spacing={0}
        frame={{ width: Device.screen.width, height: Device.screen.height - 120 }}
      >
        {/* Header row */}
        <HStack padding={{ horizontal: 24, vertical: 12 }}>
          <Button action={() => dismiss()}>
            <Image systemName="chevron.down" font={20} foregroundStyle="white" />
          </Button>
          <Spacer />
          <Text font="headline" foregroundStyle="white" lineLimit={1}>
            {currentBook?.title ?? ""}
          </Text>
          <Spacer />
          <Button
            action={() => {
              void (async () => {
                await dismiss()
                Script.minimize()
              })()
            }}
          >
            <Image systemName="chevron.down.circle" font={20} foregroundStyle="white" />
          </Button>
        </HStack>

        {/* Push content down (2 spacers = ~2:1 free space above art) */}
        <Spacer />
        <Spacer />

        {/* Inner content column with horizontal insets */}
        <VStack
          spacing={0}
          frame={{ width: Device.screen.width - 56 }}
        >
          {/* Cover art */}
          <VStack
            frame={{ maxWidth: "infinity", height: artSide + 16 }}
            alignment="center"
            padding={{ vertical: 8 }}
          >
            {coverUrl ? (
              <Image
                imageUrl={coverUrl}
                resizable={true}
                scaleToFill={true}
                frame={{ width: artSide, height: artSide }}
                clipShape={{ type: "rect", cornerRadius: 18 }}
                shadow={{ color: "rgba(0,0,0,0.5)", radius: 18, y: 8 }}
              />
            ) : (
              <VStack
                frame={{ width: artSide, height: artSide }}
                background="rgba(255,255,255,0.1)"
                clipShape={{ type: "rect", cornerRadius: 18 }}
                alignment="center"
              >
              <Text font={48} foregroundStyle="rgba(255,255,255,0.4)">
                ♪
              </Text>
              </VStack>
            )}
          </VStack>

          <Spacer />

          {/* Title & author */}
          <HStack spacing={12} frame={{ maxWidth: "infinity" }} padding={{ top: 8, bottom: 6 }}>
            <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
              <Text font="title2" bold={true} foregroundStyle="white" lineLimit={1}>
                {currentChapter?.title ?? "未选择章节"}
              </Text>
              <Text font="headline" foregroundStyle="rgba(255,255,255,0.7)" lineLimit={1}>
                {currentBook?.title ?? ""}
              </Text>
            </VStack>
          </HStack>

          {/* Error message */}
          {errorMsg ? (
            <VStack
              background="rgba(255,80,80,0.15)"
              padding={{ horizontal: 16, vertical: 12 }}
              clipShape={{ type: "rect", cornerRadius: 10 }}
              spacing={8}
            >
              <Text
                font="caption"
                foregroundStyle="rgba(255,200,200,0.9)"
                lineLimit={3}
              >
                {errorMsg}
              </Text>
              <Button
                title="重试"
                systemImage="arrow.clockwise"
                tint="rgba(255,200,200,0.9)"
                action={() => {
                  setErrorMsg(null)
                  const chapter = player.getCurrentChapter()
                  if (chapter) {
                    chapter.audioUrl = undefined
                    void player.playAtIndex(chapter.index)
                  }
                }}
              />
            </VStack>
          ) : null}

          {/* Progress slider */}
          <VStack spacing={2} frame={{ maxWidth: "infinity" }} padding={{ top: 6 }}>
            <Slider
              value={Math.min(currentTime, duration || 0)}
              min={0}
              max={Math.max(duration || 1, 1)}
              step={0.1}
              tint="rgba(255,255,255,0.9)"
              onChanged={(value: number) => player.seek(value)}
            />
            <HStack>
              <Text font="caption2" foregroundStyle="rgba(255,255,255,0.6)">
                {formatTime(currentTime)}
              </Text>
              <Spacer />
              <Text font="caption2" foregroundStyle="rgba(255,255,255,0.6)">
                -{formatTime(Math.max(0, duration - currentTime))}
              </Text>
            </HStack>
          </VStack>

          {/* Transport controls */}
          <HStack spacing={0} frame={{ maxWidth: "infinity" }} padding={{ top: 16, bottom: 12 }}>
            <Spacer />
            <Button action={() => void player.previous()}>
              <Image systemName="backward.fill" font={30} foregroundStyle="white" />
            </Button>
            <Spacer />
            <Button
              action={() => {
                if (isPlaying) void player.pause()
                else void player.play()
              }}
            >
              <Image
                systemName={isPlaying ? "pause.fill" : "play.fill"}
                font={44}
                foregroundStyle="white"
              />
            </Button>
            <Spacer />
            <Button action={() => void player.next()}>
              <Image systemName="forward.fill" font={30} foregroundStyle="white" />
            </Button>
            <Spacer />
          </HStack>

          {/* Secondary controls row */}
          <HStack spacing={0} frame={{ maxWidth: "infinity" }} padding={{ top: 10 }}>
            {/* Play mode */}
            <Button
              action={() => player.setPlayMode(playMode === "sequential" ? "repeat-one" : "sequential")}
            >
              <Image
                systemName={playMode === "repeat-one" ? "repeat.1" : "repeat"}
                font={20}
                foregroundStyle="rgba(255,255,255,0.85)"
              />
            </Button>
            <Spacer />
            {/* Speed */}
            <Button
              title={`${speed}x`}
              font="caption"
              fontWeight="semibold"
              foregroundStyle="white"
              padding={{ horizontal: 10, vertical: 4 }}
              background="rgba(255,255,255,0.2)"
              clipShape={{ type: "rect", cornerRadius: 6 }}
              action={() => setShowSpeed(!showSpeed)}
            />
            <Spacer />
            {/* Sleep timer */}
            <Button action={() => setShowSleep(!showSleep)}>
              <Image
                systemName="moon.stars.fill"
                font={20}
                foregroundStyle="rgba(255,255,255,0.85)"
              />
            </Button>
            <Spacer />
            {/* Chapter list */}
            <Button action={() => openChapterList()}>
              <Image
                systemName="list.bullet"
                font={20}
                foregroundStyle="rgba(255,255,255,0.85)"
              />
            </Button>
          </HStack>
        </VStack>

        {/* Bottom spacer */}
        <VStack frame={{ height: 24 }} />
      </VStack>

      {/* Speed picker overlay */}
      {showSpeed ? (
        <VStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          padding={{ bottom: 120 }}
        >
          <Spacer />
          <SpeedPicker onClose={() => setShowSpeed(false)} />
        </VStack>
      ) : null}

      {/* Sleep picker overlay */}
      {showSleep ? (
        <VStack
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          padding={{ bottom: 120 }}
        >
          <Spacer />
          <SleepPicker onClose={() => setShowSleep(false)} />
        </VStack>
      ) : null}
    </ZStack>
  )
}

export default function PlayerView() {
  return (
    <PlayerStateProvider>
      <PlayerProgressProvider>
        <PlayerPage />
      </PlayerProgressProvider>
    </PlayerStateProvider>
  )
}
