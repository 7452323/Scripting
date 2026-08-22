import {
  Button,
  HStack,
  Spacer,
  Text,
} from "scripting"
import { ACCENT } from "./theme"
import { Chapter } from "./models"
import { player } from "./player"
import { usePlayerState } from "./player_state"

/** Format seconds as m:ss or h:mm:ss. */
function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return "0:00"
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
  }
  return `${m}:${s.toString().padStart(2, "0")}`
}

type ChapterRowProps = {
  chapter: Chapter
  /** 0-based index in the chapter list. */
  index: number
}

/**
 * A single row in the chapter list — index, title, duration, tap to play.
 * Highlights when this chapter is currently playing.
 */
export function ChapterRow({ chapter, index }: ChapterRowProps) {
  const { currentChapter, isPlaying } = usePlayerState()
  const isCurrent = currentChapter?.id === chapter.id
  const isActive = isCurrent && isPlaying

  function handleTap() {
    if (isCurrent) {
      if (isPlaying) {
        void player.pause()
      } else {
        void player.play()
      }
    } else {
      void player.playAtIndex(index)
    }
  }

  return (
    <Button action={handleTap}>
      <HStack
        spacing={12}
        padding={{ vertical: 6 }}
      >
        <Text
          font="subheadline"
          fontWeight={isCurrent ? "semibold" : "regular"}
          foregroundStyle={isCurrent ? ACCENT : "secondaryLabel"}
          frame={{ width: 28, alignment: "leading" }}
        >
          {index + 1}
        </Text>
        <Text
          font="subheadline"
          fontWeight={isCurrent ? "semibold" : "regular"}
          foregroundStyle={isCurrent ? ACCENT : "label"}
          lineLimit={1}
          layoutPriority={1}
        >
          {chapter.title}
        </Text>
        <Spacer />
        {isActive ? (
          <Text font="caption" foregroundStyle={ACCENT}>
            ♪ 播放中
          </Text>
        ) : (
          <Text
            font="caption"
            foregroundStyle="tertiaryLabel"
          >
            {formatDuration(chapter.duration)}
          </Text>
        )}
      </HStack>
    </Button>
  )
}
