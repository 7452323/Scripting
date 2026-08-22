import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  NavigationLink,
  NavigationStack,
  ProgressView,
  ScrollView,
  Section,
  Spacer,
  Text,
  VStack,
  useEffect,
  useState,
} from "scripting"
import { Audiobook, Chapter } from "./models"
import { lrtsAPI } from "./api"
import { player } from "./player"
import { ACCENT } from "./theme"
import PlayerView from "./player_view"
import { BookDetailPage } from "./book_detail"

// ---------------------------------------------------------------------------
// Category page — full list of books for a discover category
// ---------------------------------------------------------------------------

function CategoryPage({ category, onExit }: { category: DiscoverCategory; onExit: () => void }) {
  const [books, setBooks] = useState<Audiobook[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setPage(1)
    lrtsAPI
      .searchBooks(category.query)
      .then((result) => {
        if (cancelled) return
        setBooks(result.books)
        setTotalCount(result.totalCount)
        setHasMore(result.hasMore)
        setLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setError(String(e))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [category.query])

  async function loadMore() {
    const nextPage = page + 1
    setLoadingMore(true)
    try {
      const result = await lrtsAPI.searchBooks(category.query, nextPage)
      setBooks((prev) => [...prev, ...result.books])
      setPage(nextPage)
      setHasMore(result.hasMore)
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <List
      listStyle="insetGroup"
      navigationTitle={category.title}
      navigationBarTitleDisplayMode="large"
      toolbar={{
        topBarLeading: [
          <Button title="返回" systemImage="chevron.left" action={onExit} />,
        ],
      }}
    >
      {loading ? (
        <Section>
          <HStack spacing={8} alignment="center">
            <ProgressView />
            <Text foregroundStyle="secondaryLabel">加载中...</Text>
          </HStack>
        </Section>
      ) : error ? (
        <Section>
          <Text foregroundStyle="secondaryLabel">加载失败：{error}</Text>
        </Section>
      ) : (
        <Section header={<Text>共 {totalCount} 本</Text>}>
          {books.map((book) => (
            <NavigationLink
              key={book.id}
              destination={
                <BookDetailPage book={book} onOpenPlayer={openPlayer} />
              }
            >
              <HStack spacing={12} padding={{ vertical: 4 }}>
                {book.coverUrl ? (
                  <Image
                    imageUrl={book.coverUrl}
                    resizable={true}
                    scaleToFill={true}
                    frame={{ width: 48, height: 64 }}
                    clipShape={{ type: "rect", cornerRadius: 4 }}
                  />
                ) : (
                  <Image
                    systemName="book.closed"
                    font="title2"
                    foregroundStyle="secondaryLabel"
                    frame={{ width: 48, height: 64 }}
                    background="secondarySystemFill"
                    clipShape={{ type: "rect", cornerRadius: 4 }}
                  />
                )}
                <VStack alignment="leading" spacing={2} layoutPriority={1}>
                  <Text lineLimit={1} fontWeight="medium">
                    {book.title}
                  </Text>
                  <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
                    {book.author}
                  </Text>
                  <Text font="caption2" foregroundStyle="tertiaryLabel">
                    {book.chapterCount} 章 · {book.isFinished ? "已完结" : "连载中"}
                  </Text>
                </VStack>
                <Spacer />
                <Image systemName="chevron.right" font="footnote" foregroundStyle="tertiaryLabel" />
              </HStack>
            </NavigationLink>
          ))}
          {hasMore ? (
            <Button
              title={loadingMore ? "加载中…" : "加载更多"}
              tint={ACCENT}
              disabled={loadingMore}
              action={loadMore}
            />
          ) : null}
        </Section>
      )}
    </List>
  )
}

// ---------------------------------------------------------------------------
// Mock category data for discover rails
// ---------------------------------------------------------------------------

type DiscoverCategory = {
  title: string
  /** Search query used to fetch rail content */
  query: string
}

const DISCOVER_CATEGORIES: DiscoverCategory[] = [
  { title: "热门推荐", query: "热门" },
  { title: "玄幻修真", query: "玄幻" },
  { title: "都市情感", query: "都市" },
  { title: "悬疑推理", query: "悬疑" },
  { title: "言情", query: "言情" },
  { title: "武侠", query: "武侠" },
  { title: "仙侠", query: "仙侠" },
  { title: "科幻", query: "科幻" },
  { title: "历史军事", query: "历史" },
  { title: "评书", query: "评书" },
  { title: "恐怖灵异", query: "恐怖灵异" },
  { title: "文学", query: "文学" },
  { title: "生活", query: "生活" },
  { title: "情感", query: "情感" },
  { title: "儿童故事", query: "儿童故事" },
  { title: "军事", query: "军事" },
  { title: "官场", query: "官场" },
  { title: "财经", query: "财经" },
  { title: "成功励志", query: "成功励志" },
]

// ---------------------------------------------------------------------------
// Helper: open the full-screen player
// ---------------------------------------------------------------------------

async function openPlayer(book: Audiobook, chapters: Chapter[], startIndex: number) {
  try {
    await player.init()
    await player.playBook(book, chapters, startIndex)
    await Navigation.present({
      element: <PlayerView />,
      modalPresentationStyle: "overFullScreen",
    })
  } catch (e) {
    console.error(e)
  }
}

// ---------------------------------------------------------------------------
// Rail component — horizontal scrolling row of book cards
// ---------------------------------------------------------------------------

function BookRail({ category }: { category: DiscoverCategory }) {
  const [books, setBooks] = useState<Audiobook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    lrtsAPI
      .searchBooks(category.query)
      .then((result) => {
        if (cancelled) return
        setBooks(result.books.slice(0, 20))
      })
      .catch((e) => {
        if (cancelled) return
        setError(String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [category.query])

  const dismiss = Navigation.useDismiss()

  return (
    <VStack alignment="leading" spacing={6}>
      {/* Rail header */}
      <HStack padding={{ horizontal: 14 }}>
        <Text font="subheadline" fontWeight="semibold">
          {category.title}
        </Text>
        <Spacer />
        <Button
          title="更多"
          systemImage="chevron.right"
          tint={ACCENT}
          action={() => {
            void Navigation.present({
              element: (
                <NavigationStack>
                  <CategoryPage category={category} onExit={() => dismiss()} />
                </NavigationStack>
              ),
              modalPresentationStyle: "pageSheet",
            })
          }}
        />
      </HStack>

      {/* Horizontal scrolling cards */}
      {loading ? (
        <HStack spacing={10} padding={{ horizontal: 14 }}>
          {new Array(4).fill(0).map((_, i) => (
            <PlaceholderCard key={i} />
          ))}
        </HStack>
      ) : error ? (
        <VStack padding={{ horizontal: 16 }}>
          <Text font="caption" foregroundStyle="tertiaryLabel">
            加载失败：{error}
          </Text>
        </VStack>
      ) : (
        <ScrollView
          axes="horizontal"
          scrollIndicator={{ visibility: "never", axes: "horizontal" }}
        >
          <HStack spacing={10} padding={{ horizontal: 14, vertical: 2 }}>
            {books.map((book) => (
              <BookCard key={book.id} book={book} />
            ))}
          </HStack>
        </ScrollView>
      )}
    </VStack>
  )
}

// ---------------------------------------------------------------------------
// Book card — vertical card for horizontal rail
// ---------------------------------------------------------------------------

function BookCard({ book }: { book: Audiobook }) {
  const placeholder = (
    <Image
      systemName="book.closed.fill"
      font="title"
      foregroundStyle="secondaryLabel"
      frame={{ width: 96, height: 128 }}
      background="secondarySystemFill"
      clipShape={{ type: "rect", cornerRadius: 8 }}
    />
  )

  const cover = book.coverUrl ? (
    <Image
      imageUrl={book.coverUrl}
      resizable={true}
      scaleToFill={true}
      frame={{ width: 96, height: 128 }}
      clipShape={{ type: "rect", cornerRadius: 8 }}
      placeholder={placeholder}
    />
  ) : (
    placeholder
  )

  return (
    <NavigationLink
      destination={
        <BookDetailPage
          book={book}
          onOpenPlayer={openPlayer}
        />
      }
      frame={{ width: 96 }}
    >
      <VStack alignment="leading" spacing={4}>
        {cover}
        <Text font="caption" fontWeight="medium" lineLimit={1}>
          {book.title}
        </Text>
        <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>
          {book.author}
        </Text>
      </VStack>
    </NavigationLink>
  )
}

// ---------------------------------------------------------------------------
// Placeholder card — skeleton while loading
// ---------------------------------------------------------------------------

function PlaceholderCard() {
  return (
    <VStack alignment="leading" spacing={4}>
      <Image
        systemName="book.closed"
        font="title"
        foregroundStyle="tertiaryLabel"
        frame={{ width: 96, height: 128 }}
        background="secondarySystemFill"
        clipShape={{ type: "rect", cornerRadius: 8 }}
      />
      <Image
        systemName="rectangle.fill"
        font="caption"
        foregroundStyle="secondarySystemFill"
        frame={{ width: 78, height: 10 }}
        background="secondarySystemFill"
        clipShape={{ type: "rect", cornerRadius: 3 }}
      />
      <Image
        systemName="rectangle.fill"
        font="caption2"
        foregroundStyle="secondarySystemFill"
        frame={{ width: 54, height: 9 }}
        background="secondarySystemFill"
        clipShape={{ type: "rect", cornerRadius: 3 }}
      />
    </VStack>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DiscoverView(props?: { onExit?: () => void }) {
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <List
      key={refreshKey}
      listStyle="insetGroup"
      navigationTitle=""
      navigationBarTitleDisplayMode="inline"
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
      {/* Category rails */}
      <Section padding={{ vertical: 0 }}>
        <VStack alignment="leading" spacing={10}>
          {DISCOVER_CATEGORIES.map((cat) => (
            <BookRail key={cat.query} category={cat} />
          ))}
        </VStack>
      </Section>
    </List>
  )
}
