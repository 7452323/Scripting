import {
  Button,
  HStack,
  Image,
  List,
  NavigationLink,
  Section,
  Spacer,
  Text,
  VStack,
  useEffect,
  useState,
} from "scripting"
import { Audiobook, Chapter, BookShelfItem } from "./models"
import { isChapterCacheFresh, loadCachedChapters, refreshChaptersCache, removeCachedChapters } from "./chapter_cache"
import { player } from "./player"
import { ACCENT } from "./theme"
import PlayerView from "./player_view"

const SHELF_KEY = "lrts_bookshelf"

function loadShelf(): BookShelfItem[] {
  try {
    const raw = Storage.get<string>("lrts_bookshelf")
    if (!raw) return []
    const items: Array<{ id: string; addedAt: number }> = JSON.parse(raw)
    const result: BookShelfItem[] = []
    for (const item of items) {
      const bookRaw = Storage.get<string>(`lrts_book_${item.id}`)
      if (bookRaw) {
        const book = JSON.parse(bookRaw) as Audiobook
        result.push({
          book,
          lastChapterIndex: 0,
          lastPosition: 0,
          addedAt: item.addedAt,
          updatedAt: item.addedAt,
        })
      }
    }
    return result
  } catch {
    return []
  }
}

function removeFromShelf(bookId: string) {
  try {
    const raw = Storage.get<string>("lrts_bookshelf")
    if (!raw) return
    const items: Array<{ id: string; addedAt: number }> = JSON.parse(raw)
    const next = items.filter((i) => i.id !== bookId)
    Storage.set(SHELF_KEY, JSON.stringify(next))
    Storage.remove(`lrts_book_${bookId}`)
    removeCachedChapters(bookId)
  } catch {
    // ignore
  }
}

export function LibraryView(props: {
  navigationTitle?: string
  navigationBarTitleDisplayMode?: "automatic" | "inline" | "large"
  onExit?: () => void
}) {
  const [items, setItems] = useState<BookShelfItem[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    setItems(loadShelf())
  }, [refreshKey])

  function handleDelete(bookId: string) {
    removeFromShelf(bookId)
    setItems((prev) => prev.filter((i) => i.book.id !== bookId))
  }

  return (
    <List
      listStyle="insetGroup"
      navigationTitle={props.navigationTitle ?? "书架"}
      navigationBarTitleDisplayMode={props.navigationBarTitleDisplayMode}
      toolbar={{
        topBarLeading: props?.onExit
          ? [<Button title="退出" systemImage="xmark" action={props.onExit} />]
          : undefined,
        topBarTrailing: [
          <Button
            title=""
            systemImage="arrow.clockwise"
            action={() => setRefreshKey((k) => k + 1)}
          />,
        ],
      }}
    >
      {items.length === 0 ? (
        <Section>
          <VStack alignment="center" spacing={8} padding={{ vertical: 40 }}>
            <Image
              systemName="books.vertical"
              font="largeTitle"
              foregroundStyle="tertiaryLabel"
            />
            <Text foregroundStyle="secondaryLabel">书架为空</Text>
            <Text font="caption" foregroundStyle="tertiaryLabel">
              去搜索页发现喜欢的有声书吧
            </Text>
          </VStack>
        </Section>
      ) : (
        <Section
          header={<Text>共 {items.length} 本</Text>}
          footer={<Text font="caption" foregroundStyle="tertiaryLabel">
            左滑删除书籍
          </Text>}
        >
          {items.map((item) => (
            <ShelfBookRow
              key={item.book.id}
              item={item}
              onDelete={() => handleDelete(item.book.id)}
            />
          ))}
        </Section>
      )}
    </List>
  )
}

function ShelfBookRow({
  item,
  onDelete,
}: {
  item: BookShelfItem
  onDelete: () => void
}) {
  const { book } = item
  const placeholder = (
    <Image
      systemName="book.closed"
      font="title2"
      foregroundStyle="secondaryLabel"
      frame={{ width: 48, height: 64 }}
      background="secondarySystemFill"
      clipShape={{ type: "rect", cornerRadius: 4 }}
    />
  )

  const cover = book.coverUrl ? (
    <Image
      imageUrl={book.coverUrl}
      resizable={true}
      scaleToFill={true}
      frame={{ width: 48, height: 64 }}
      clipShape={{ type: "rect", cornerRadius: 4 }}
      placeholder={placeholder}
    />
  ) : (
    placeholder
  )

  return (
    <NavigationLink
      destination={<ShelfBookDetailPage book={book} />}
      trailingSwipeActions={{
        allowsFullSwipe: true,
        actions: [
          <Button
            title="删除"
            role="destructive"
            systemImage="trash"
            action={onDelete}
          />,
        ],
      }}
    >
      <HStack spacing={12} padding={{ vertical: 4 }}>
        {cover}
        <VStack alignment="leading" spacing={2}>
          <Text lineLimit={1} fontWeight="medium">
            {book.title}
          </Text>
          <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
            {book.author}
          </Text>
          <HStack spacing={6}>
            <Text font="caption2" foregroundStyle="tertiaryLabel">
              {book.chapterCount} 章
            </Text>
            <Text font="caption2" foregroundStyle="tertiaryLabel">
              {book.isFinished ? "已完结" : "连载中"}
            </Text>
          </HStack>
        </VStack>
        <Spacer />
        <Image systemName="chevron.right" font="footnote" foregroundStyle="tertiaryLabel" />
      </HStack>
    </NavigationLink>
  )
}

// ---------------------------------------------------------------------------
// Shelf Book Detail Page — full chapter list with play functionality
// ---------------------------------------------------------------------------

function ShelfBookDetailPage({ book }: { book: Audiobook }) {
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [displayCount, setDisplayCount] = useState(100)
  const [isRefreshingChapters, setIsRefreshingChapters] = useState(false)
  const [chaptersFromCache, setChaptersFromCache] = useState(false)

  useEffect(() => {
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

  async function handlePlayChapter(index: number) {
    try {
      await player.init()
      await player.playBook(book, chapters, index)
      const { Navigation } = await import("scripting")
      await Navigation.present({
        element: <PlayerView />,
        modalPresentationStyle: "overFullScreen",
      })
    } catch (e) {
      console.error(e)
    }
  }

  async function handlePlayAll() {
    if (chapters.length === 0) return
    await handlePlayChapter(0)
  }

  const placeholder = (
    <Image
      systemName="book.closed.fill"
      font="largeTitle"
      foregroundStyle="secondaryLabel"
      frame={{ width: 90, height: 120 }}
      background="secondarySystemFill"
      clipShape={{ type: "rect", cornerRadius: 6 }}
    />
  )

  const cover = book.coverUrl ? (
    <Image
      imageUrl={book.coverUrl}
      resizable={true}
      scaleToFill={true}
      frame={{ width: 90, height: 120 }}
      clipShape={{ type: "rect", cornerRadius: 6 }}
      placeholder={placeholder}
    />
  ) : (
    placeholder
  )

  return (
    <List
      navigationTitle="书籍详情"
      navigationBarTitleDisplayMode="large"
    >
      {/* Header */}
      <Section>
        <HStack spacing={14}>
          {cover}
          <VStack alignment="leading" spacing={4}>
            <Text font="headline" fontWeight="semibold" lineLimit={2}>
              {book.title}
            </Text>
            <Text font="subheadline" foregroundStyle="secondaryLabel">
              {book.author}
            </Text>
            <HStack spacing={8}>
              <Text font="caption" foregroundStyle="tertiaryLabel">
                {book.chapterCount} 章
              </Text>
              <Text font="caption" foregroundStyle={book.isFinished ? "green" : ACCENT}>
                {book.isFinished ? "已完结" : "连载中"}
              </Text>
            </HStack>
          </VStack>
        </HStack>
      </Section>

      {/* Play Button */}
      <Section>
        <Button
          disabled={loading || chapters.length === 0}
          action={() => void handlePlayAll()}
        >
          <HStack spacing={12} padding={{ vertical: 8 }}>
            <Image systemName="play.fill" font={18} foregroundStyle={ACCENT} />
            <Text foregroundStyle={ACCENT}>
              {loading ? "加载中…" : "开始播放"}
            </Text>
            <Spacer />
          </HStack>
        </Button>
      </Section>

      {/* Description — above chapter list */}
      {book.description ? (
        <Section header={<Text>简介</Text>}>
          <Text font="footnote" foregroundStyle="secondaryLabel">
            {book.description}
          </Text>
        </Section>
      ) : null}

      {/* Chapter List */}
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
              <Button
                key={chapter.id}
                action={() => void handlePlayChapter(idx)}
              >
                <HStack spacing={12} padding={{ vertical: 6 }}>
                  <Text
                    font="subheadline"
                    foregroundStyle="secondaryLabel"
                    frame={{ width: 32, alignment: "leading" }}
                  >
                    {idx + 1}
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
