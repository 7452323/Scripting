import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  NavigationLink,
  ProgressView,
  Section,
  Spacer,
  Text,
  VStack,
  useEffect,
  useState,
} from "scripting"
import { Audiobook, Chapter } from "./models"
import { isChapterCacheFresh, loadCachedChapters, refreshChaptersCache, removeCachedChapters } from "./chapter_cache"
import { player } from "./player"
import { ACCENT } from "./theme"
import PlayerView from "./player_view"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BookDetailProps = {
  book: Audiobook
  /** Optional initial chapter index to auto-play */
  autoPlayIndex?: number
  /** Optional callback when opening player */
  onOpenPlayer?: (book: Audiobook, chapters: Chapter[], startIndex: number) => void
}

// ---------------------------------------------------------------------------
// Chapter row (detail page variant — larger layout)
// ---------------------------------------------------------------------------

function DetailChapterRow({
  chapter,
  index,
  onPlay,
}: {
  chapter: Chapter
  index: number
  onPlay: (index: number) => void
}) {
  return (
    <Button action={() => onPlay(index)}>
      <HStack spacing={12} padding={{ vertical: 6 }}>
        <Text
          font="subheadline"
          foregroundStyle="secondaryLabel"
          frame={{ width: 32, alignment: "leading" }}
        >
          {index + 1}
        </Text>
        <VStack alignment="leading" spacing={2} layoutPriority={1}>
          <Text font="subheadline" lineLimit={1}>
            {chapter.title}
          </Text>
        </VStack>
        <Spacer />
        <Image
          systemName="play.circle"
          font="title3"
          foregroundStyle={ACCENT}
        />
      </HStack>
    </Button>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function BookDetailPage(props: BookDetailProps) {
  const { book, autoPlayIndex, onOpenPlayer } = props
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [isInShelf, setIsInShelf] = useState(false)
  const [displayCount, setDisplayCount] = useState(100)
  const [isRefreshingChapters, setIsRefreshingChapters] = useState(false)
  const [chaptersFromCache, setChaptersFromCache] = useState(false)

  useEffect(() => {
    // Check if already in shelf
    try {
      const raw = Storage.get("lrts_bookshelf") as string | undefined
      if (raw) {
        const items: Array<{ id: string }> = JSON.parse(raw)
        setIsInShelf(items.some((i) => i.id === book.id))
      }
    } catch {
      // ignore
    }

    let cancelled = false
    setDisplayCount(100)
    setError(null)

    const cached = loadCachedChapters(book)
    if (cached) {
      setChapters(cached.chapters)
      setChaptersFromCache(true)
      setLoading(false)
    } else {
      setChapters([])
      setChaptersFromCache(false)
      setLoading(true)
    }

    const loadChapters = async () => {
      if (cached && isChapterCacheFresh(cached)) return
      setIsRefreshingChapters(Boolean(cached))
      try {
        const result = await refreshChaptersCache(book)
        if (cancelled) return
        setChapters(result.chapters)
        setChaptersFromCache(false)
      } catch (e) {
        if (cancelled) return
        if (!cached) setError(String(e))
      } finally {
        if (!cancelled) {
          setLoading(false)
          setIsRefreshingChapters(false)
        }
      }
    }

    void loadChapters()
    return () => {
      cancelled = true
    }
  }, [book.id, book.source])

  function handleAddToShelf() {
    if (adding) return
    setAdding(true)
    try {
      const SHELF_KEY = "lrts_bookshelf"
      const raw = Storage.get(SHELF_KEY) as string | undefined
      let items: Array<{ id: string; addedAt: number }> = raw ? JSON.parse(raw) : []

      if (isInShelf) {
        // Remove from shelf
        items = items.filter((i) => i.id !== book.id)
        Storage.set(SHELF_KEY, JSON.stringify(items))
        Storage.remove(`lrts_book_${book.id}`)
        removeCachedChapters(book)
        setIsInShelf(false)
      } else {
        // Add to shelf
        if (!items.find((i) => i.id === book.id)) {
          items.unshift({ id: book.id, addedAt: Date.now() })
          Storage.set(SHELF_KEY, JSON.stringify(items))
        }
        Storage.set(`lrts_book_${book.id}`, JSON.stringify(book))
        setIsInShelf(true)
      }
    } catch {
      // ignore
    } finally {
      setAdding(false)
    }
  }

  async function handlePlayChapter(index: number) {
    try {
      await player.init()
      await player.playBook(book, chapters, index)
      if (onOpenPlayer) {
        onOpenPlayer(book, chapters, index)
      } else {
        await Navigation.present({
          element: <PlayerView />,
          modalPresentationStyle: "overFullScreen",
        })
      }
    } catch (e) {
      console.error(e)
    }
  }

  async function handlePlayAll() {
    if (chapters.length === 0) return
    await handlePlayChapter(autoPlayIndex ?? 0)
  }

  return (
    <List
      navigationTitle="书籍详情"
      navigationBarTitleDisplayMode="large"
    >
      {/* Header: cover + meta */}
      <Section padding={{ vertical: 20 }}>
        <VStack alignment="center" spacing={14}>
          {/* Cover */}
          {book.coverUrl ? (
            <Image
              imageUrl={book.coverUrl}
              resizable={true}
              scaleToFill={true}
              frame={{ width: 140, height: 186 }}
              clipShape={{ type: "rect", cornerRadius: 8 }}
            />
          ) : (
            <Image
              systemName="book.closed.fill"
              font="largeTitle"
              foregroundStyle="secondaryLabel"
              frame={{ width: 140, height: 186 }}
              background="secondarySystemFill"
              clipShape={{ type: "rect", cornerRadius: 8 }}
            />
          )}

          {/* Title & author */}
          <VStack alignment="center" spacing={4}>
            <Text font="title3" fontWeight="bold">
              {book.title}
            </Text>
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              {book.author}
            </Text>
          </VStack>

          {/* Tags */}
          <HStack spacing={8}>
            {book.categoryName ? (
              <Text
                font="caption2"
                foregroundStyle={ACCENT}
                padding={{ horizontal: 8, vertical: 3 }}
                background={{ color: ACCENT, opacity: 0.1 }}
                clipShape={{ type: "rect", cornerRadius: 8 }}
              >
                {book.categoryName}
              </Text>
            ) : null}
            <Text
              font="caption2"
              foregroundStyle="secondaryLabel"
              padding={{ horizontal: 8, vertical: 3 }}
              background="secondarySystemFill"
              clipShape={{ type: "rect", cornerRadius: 8 }}
            >
              {book.chapterCount} 章
            </Text>
            <Text
              font="caption2"
              foregroundStyle={book.isFinished ? "green" : ACCENT}
              padding={{ horizontal: 8, vertical: 3 }}
              background={{ color: book.isFinished ? "green" : ACCENT, opacity: 0.1 }}
              clipShape={{ type: "rect", cornerRadius: 8 }}
            >
              {book.isFinished ? "已完结" : "连载中"}
            </Text>
          </HStack>
        </VStack>
      </Section>

      {/* Action buttons — each as a full-width row like chapter list */}
      <Section>
        <Button
          disabled={loading || chapters.length === 0}
          action={() => void handlePlayAll()}
        >
          <HStack spacing={12} padding={{ vertical: 8 }}>
            <Image systemName="play.fill" font={18} foregroundStyle={ACCENT} />
            <Text foregroundStyle={ACCENT}>开始播放</Text>
            <Spacer />
          </HStack>
        </Button>
        <Button
          action={() => handleAddToShelf()}
        >
          <HStack spacing={12} padding={{ vertical: 8 }}>
            <Image
              systemName={isInShelf ? "checkmark.circle.fill" : "plus.circle"}
              font={18}
              foregroundStyle={isInShelf ? "green" : ACCENT}
            />
            <Text foregroundStyle={isInShelf ? "green" : ACCENT}>
              {isInShelf ? "已在书架" : "加入书架"}
            </Text>
            <Spacer />
          </HStack>
        </Button>
      </Section>

      {/* Description */}
      {book.description ? (
        <Section
          header={<Text>简介</Text>}
          footer={
            <Text font="caption2" foregroundStyle="tertiaryLabel">
              点击章节或「开始播放」收听
            </Text>
          }
        >
          <Text font="footnote" foregroundStyle="secondaryLabel">
            {book.description}
          </Text>
        </Section>
      ) : null}

      {/* Chapter list */}
      <Section
        header={
          <HStack>
            <Text>目录</Text>
            <Spacer />
            <Text font="caption" foregroundStyle="tertiaryLabel">
              {loading
                ? "加载中…"
                : isRefreshingChapters
                  ? `共 ${chapters.length} 章 · 刷新中`
                  : chaptersFromCache
                    ? `共 ${chapters.length} 章 · 缓存`
                    : `共 ${chapters.length} 章`}
            </Text>
          </HStack>
        }
      >
        {loading ? (
          <HStack spacing={8} padding={{ vertical: 8 }}>
            <ProgressView />
            <Text font="caption" foregroundStyle="secondaryLabel">
              加载章节列表…
            </Text>
          </HStack>
        ) : error ? (
          <VStack alignment="center" spacing={8} padding={{ vertical: 16 }}>
            <Text font="caption" foregroundStyle="secondaryLabel">
              {error}
            </Text>
            <Button
              title="重试"
              systemImage="arrow.clockwise"
              tint={ACCENT}
              action={() => {
                setLoading(true)
                setError(null)
                setIsRefreshingChapters(false)
                const load = async () => {
                  try {
                    const result = await refreshChaptersCache(book)
                    setChapters(result.chapters)
                    setChaptersFromCache(false)
                  } catch (e) {
                    setError(String(e))
                  } finally {
                    setLoading(false)
                  }
                }
                void load()
              }}
            />
          </VStack>
        ) : chapters.length === 0 ? (
          <Text font="caption" foregroundStyle="secondaryLabel" padding={{ vertical: 8 }}>
            暂无章节信息
          </Text>
        ) : (
          <>
            {chapters.slice(0, displayCount).map((chapter, idx) => (
              <DetailChapterRow
                key={chapter.id}
                chapter={chapter}
                index={idx}
                onPlay={(i) => void handlePlayChapter(i)}
              />
            ))}
            {displayCount < chapters.length ? (
              <Button
                title={`加载更多（${Math.min(displayCount + 100, chapters.length)}/${chapters.length}）`}
                tint={ACCENT}
                action={() => setDisplayCount((prev) => prev + 100)}
              />
            ) : null}
          </>
        )}
      </Section>
    </List>
  )
}

// ---------------------------------------------------------------------------
// Standalone wrapper — used when navigating directly
// ---------------------------------------------------------------------------

export function BookDetailView({ book }: { book: Audiobook }) {
  return <BookDetailPage book={book} />
}
