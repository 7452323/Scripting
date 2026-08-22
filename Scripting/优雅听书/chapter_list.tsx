import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  ProgressView,
  Section,
  Spacer,
  Text,
  VStack,
  useEffect,
  useState,
} from "scripting"
import { Chapter } from "./models"
import { player } from "./player"
import { usePlayerState } from "./player_state"
import { ACCENT } from "./theme"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChapterListProps = {
  /** Optional: if provided, shows book header */
  bookTitle?: string
  bookAuthor?: string
  coverUrl?: string
  /** Called when a chapter is selected */
  onSelect?: (index: number) => void
  /** Called when the sheet is dismissed */
  onDismiss?: () => void
}

// ---------------------------------------------------------------------------
// Chapter row
// ---------------------------------------------------------------------------

function ChapterListItem({
  chapter,
  index,
  isCurrent,
  isPlaying,
  onTap,
}: {
  chapter: Chapter
  index: number
  isCurrent: boolean
  isPlaying: boolean
  onTap: () => void
}) {
  return (
    <Button action={onTap}>
      <HStack spacing={12} padding={{ vertical: 6 }}>
        {/* Index */}
        <Text
          font="subheadline"
          fontWeight={isCurrent ? "semibold" : "regular"}
          foregroundStyle={isCurrent ? ACCENT : "secondaryLabel"}
          frame={{ width: 28, alignment: "leading" }}
        >
          {index + 1}
        </Text>

        {/* Title */}
        <VStack alignment="leading" spacing={1} layoutPriority={1}>
          <Text
            font="subheadline"
            fontWeight={isCurrent ? "semibold" : "regular"}
            foregroundStyle={isCurrent ? ACCENT : "label"}
            lineLimit={1}
          >
            {chapter.title}
          </Text>
          {isCurrent ? (
            <Text font="caption2" foregroundStyle={ACCENT}>
              {isPlaying ? "♪ 播放中" : "已暂停"}
            </Text>
          ) : null}
        </VStack>

        <Spacer />

        {/* Status indicator */}
        {isCurrent && isPlaying ? (
          <Image
            systemName="speaker.wave.2.fill"
            font="caption"
            foregroundStyle={ACCENT}
          />
        ) : null}
      </HStack>
    </Button>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ChapterListSheet(props: ChapterListProps) {
  const { chapters, currentChapter, currentBook, isPlaying } = usePlayerState()
  const [filter, setFilter] = useState("")
  const dismiss = Navigation.useDismiss()

  // Filter chapters based on search text
  const filteredChapters = filter
    ? chapters.filter(
        (ch) =>
          ch.title.toLowerCase().includes(filter.toLowerCase()) ||
          String(ch.index + 1).includes(filter)
      )
    : chapters

  // Current index for display
  const currentIndex = currentChapter
    ? chapters.findIndex((ch) => ch.id === currentChapter.id)
    : -1

  function handleChapterTap(index: number) {
    void player.playAtIndex(index)
    if (props.onSelect) {
      props.onSelect(index)
    }
  }

  function handleDismiss() {
    if (props.onDismiss) {
      props.onDismiss()
    } else {
      dismiss()
    }
  }

  return (
    <List
      listStyle="insetGroup"
      navigationTitle="播放列表"
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        topBarLeading: [
          <Button title="关闭" action={handleDismiss} />,
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
      {/* Book info header */}
      {(props.bookTitle || currentBook) ? (
        <Section>
          <HStack spacing={12}>
            {(props.coverUrl || currentBook?.coverUrl) ? (
              <Image
                imageUrl={props.coverUrl || currentBook?.coverUrl || ""}
                resizable={true}
                scaleToFill={true}
                frame={{ width: 48, height: 48 }}
                clipShape={{ type: "rect", cornerRadius: 6 }}
              />
            ) : (
              <Image
                systemName="book.closed.fill"
                font="footnote"
                foregroundStyle="secondaryLabel"
                frame={{ width: 48, height: 48 }}
                background="secondarySystemFill"
                clipShape={{ type: "rect", cornerRadius: 6 }}
              />
            )}
            <VStack alignment="leading" spacing={2}>
              <Text font="subheadline" fontWeight="medium" lineLimit={1}>
                {(props.bookTitle || currentBook?.title) ?? ""}
              </Text>
              <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
                {(props.bookAuthor || currentBook?.author) ?? ""}
              </Text>
            </VStack>
            <Spacer />
            {currentIndex >= 0 ? (
              <VStack alignment="trailing" spacing={1}>
                <Text font="caption2" foregroundStyle="tertiaryLabel">
                  当前
                </Text>
                <Text font="caption" fontWeight="semibold" foregroundStyle={ACCENT}>
                  第 {currentIndex + 1} 章
                </Text>
              </VStack>
            ) : null}
          </HStack>
        </Section>
      ) : null}

      {/* Chapter list */}
      <Section>
        {filteredChapters.length === 0 ? (
          <VStack alignment="center" spacing={8} padding={{ vertical: 24 }}>
            <Image
              systemName="magnifyingglass"
              font="title"
              foregroundStyle="tertiaryLabel"
            />
            <Text font="caption" foregroundStyle="secondaryLabel">
              {filter ? "未找到匹配章节" : "暂无章节"}
            </Text>
          </VStack>
        ) : (
          filteredChapters.map((chapter) => {
            const isCurrent = currentChapter?.id === chapter.id
            return (
              <ChapterListItem
                key={chapter.id}
                chapter={chapter}
                index={chapter.index}
                isCurrent={isCurrent}
                isPlaying={isPlaying}
                onTap={() => handleChapterTap(chapter.index)}
              />
            )
          })
        )}
      </Section>

      {/* Footer */}
      <Section
        footer={
          <VStack alignment="center" spacing={4}>
            <Text font="caption2" foregroundStyle="tertiaryLabel">
              点击章节开始播放
            </Text>
          </VStack>
        }
      />
    </List>
  )
}

// ---------------------------------------------------------------------------
// Standalone wrapper for direct navigation
// ---------------------------------------------------------------------------

export function ChapterListPage() {
  return <ChapterListSheet />
}
