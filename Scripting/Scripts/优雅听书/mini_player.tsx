import {
  Button,
  HStack,
  Image,
  Spacer,
  Text,
  VStack,
  ZStack,
} from "scripting"
import { player } from "./player"
import { PlayerProgressProvider, PlayerStateProvider, usePlayerState, usePlayerProgress } from "./player_state"
import { ACCENT } from "./theme"

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00"
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

export function MiniPlayerBar({ onTap }: { onTap?: () => void }) {
  const { currentChapter, currentBook, isPlaying } = usePlayerState()
  const { currentTime, duration } = usePlayerProgress()

  const progress = duration > 0 ? currentTime / duration : 0
  const coverUrl = currentBook?.coverUrl

  function handlePlayPause() {
    if (isPlaying) {
      void player.pause()
    } else {
      void player.play()
    }
  }

  return (
    <VStack spacing={0}>
      {/* Progress line at top */}
      <ZStack>
        <VStack
          frame={{ height: 3 }}
          background="systemGray5"
        />
        <HStack>
          <VStack
            frame={{ height: 3, width: Math.round(progress * 100) }}
            background={ACCENT}
          />
          <Spacer />
        </HStack>
      </ZStack>

      <HStack spacing={12} padding={{ horizontal: 12, vertical: 8 }} background="systemBackground">
        <Button
          action={() => {
            onTap?.()
          }}
          background="clear"
          padding={{ horizontal: 0, vertical: 0 }}
        >
          <HStack spacing={12}>
            {/* Cover thumbnail — show real image or placeholder */}
            {coverUrl ? (
              <Image
                imageUrl={coverUrl}
                resizable={true}
                scaleToFill={true}
                frame={{ width: 40, height: 40 }}
                clipShape={{ type: "rect", cornerRadius: 6 }}
              />
            ) : (
              <VStack
                frame={{ width: 40, height: 40 }}
                background="systemGray5"
                clipShape={{ type: "rect", cornerRadius: 6 }}
                alignment="center"
              >
                <Text font="caption2" foregroundStyle="secondaryLabel">
                  ♪
                </Text>
              </VStack>
            )}

            {/* Title and book name - tappable to expand */}
            <VStack alignment="leading" spacing={2}>
              <Text
                font="subheadline"
                fontWeight="medium"
                foregroundStyle="label"
                lineLimit={1}
              >
                {currentChapter?.title ?? "未选择章节"}
              </Text>
              <HStack spacing={4}>
                <Text
                  font="caption2"
                  foregroundStyle="secondaryLabel"
                  lineLimit={1}
                >
                  {currentBook?.title ?? ""}
                </Text>
                <Text font="caption2" foregroundStyle="tertiaryLabel">
                  {isPlaying ? formatTime(currentTime) : ""}
                </Text>
              </HStack>
            </VStack>
          </HStack>
        </Button>

        <Spacer />

        {/* Play/Pause button */}
        <Button
          title=""
          systemImage={isPlaying ? "pause.fill" : "play.fill"}
          font="title2"
          foregroundStyle={ACCENT}
          action={handlePlayPause}
        />

        {/* Next button */}
        <Button
          title=""
          systemImage="forward.end.fill"
          font="subheadline"
          foregroundStyle="label"
          action={() => void player.next()}
        />
      </HStack>
    </VStack>
  )
}

export function MiniPlayer({ onTap }: { onTap?: () => void }) {
  const { currentChapter, currentBook, isPlaying } = usePlayerState()
  const { currentTime, duration } = usePlayerProgress()

  const progress = duration > 0 ? currentTime / duration : 0
  const coverUrl = currentBook?.coverUrl

  return (
    <VStack spacing={0}>
      {/* Progress line at top */}
      <ZStack>
        <VStack
          frame={{ height: 3 }}
          background="systemGray5"
        />
        <HStack>
          <VStack
            frame={{ height: 3, width: Math.round(progress * 100) }}
            background={ACCENT}
          />
          <Spacer />
        </HStack>
      </ZStack>

      <HStack spacing={12} padding={{ horizontal: 12, vertical: 8 }} background="systemBackground">
        <Button
          action={() => {
            onTap?.()
          }}
          background="clear"
          padding={{ horizontal: 0, vertical: 0 }}
        >
          <HStack spacing={12}>
            {/* Cover thumbnail — show real image or placeholder */}
            {coverUrl ? (
              <Image
                imageUrl={coverUrl}
                resizable={true}
                scaleToFill={true}
                frame={{ width: 40, height: 40 }}
                clipShape={{ type: "rect", cornerRadius: 6 }}
              />
            ) : (
              <VStack
                frame={{ width: 40, height: 40 }}
                background="systemGray5"
                clipShape={{ type: "rect", cornerRadius: 6 }}
                alignment="center"
              >
                <Text font="caption2" foregroundStyle="secondaryLabel">
                  ♪
                </Text>
              </VStack>
            )}

            {/* Title and book name */}
            <VStack alignment="leading" spacing={2}>
              <Text
                font="subheadline"
                fontWeight="medium"
                foregroundStyle="label"
                lineLimit={1}
              >
                {currentChapter?.title ?? "未选择章节"}
              </Text>
              <HStack spacing={4}>
                <Text
                  font="caption2"
                  foregroundStyle="secondaryLabel"
                  lineLimit={1}
                >
                  {currentBook?.title ?? ""}
                </Text>
                <Text font="caption2" foregroundStyle="tertiaryLabel">
                  {isPlaying ? formatTime(currentTime) : ""}
                </Text>
              </HStack>
            </VStack>
          </HStack>
        </Button>

        <Spacer />

        {/* Play/Pause button */}
        <Button
          title=""
          systemImage={isPlaying ? "pause.fill" : "play.fill"}
          font="title2"
          foregroundStyle={ACCENT}
          action={() => {
            if (isPlaying) {
              void player.pause()
            } else {
              void player.play()
            }
          }}
        />

        {/* Next button */}
        <Button
          title=""
          systemImage="forward.end.fill"
          font="subheadline"
          foregroundStyle="label"
          action={() => void player.next()}
        />
      </HStack>
    </VStack>
  )
}

export function MiniPlayerWrapped({ onTap }: { onTap?: () => void }) {
  return (
    <PlayerStateProvider>
      <PlayerProgressProvider>
        <MiniPlayer onTap={onTap} />
      </PlayerProgressProvider>
    </PlayerStateProvider>
  )
}
