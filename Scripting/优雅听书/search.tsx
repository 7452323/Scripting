import {
  Button,
  HStack,
  Image,
  List,
  NavigationLink,
  ProgressView,
  Section,
  Spacer,
  Text,
  VStack,
  useEffect,
  useState,
} from "scripting"
import { Audiobook } from "./models"
import { lrtsAPI } from "./api"
import { ACCENT } from "./theme"
import { BookDetailPage } from "./book_detail"

const HISTORY_KEY = "lrts_search_history"
const MAX_HISTORY = 20

export function SearchView(props?: { onExit?: () => void }) {
  const [keyword, setKeyword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<Audiobook[]>([])
  const [history, setHistory] = useState<string[]>([])
  const [hasSearched, setHasSearched] = useState(false)

  useEffect(() => {
    loadHistory()
  }, [])

  function loadHistory() {
    try {
      const raw = Storage.get(HISTORY_KEY)
      if (raw) {
        const arr = JSON.parse(raw as string)
        setHistory(arr)
      }
    } catch {
      // ignore
    }
  }

  function saveHistory(item: string) {
    let next = [item, ...history.filter((h) => h !== item)]
    if (next.length > MAX_HISTORY) next = next.slice(0, MAX_HISTORY)
    setHistory(next)
    Storage.set(HISTORY_KEY, JSON.stringify(next))
  }

  function clearHistory() {
    setHistory([])
    Storage.remove(HISTORY_KEY)
  }

  async function runSearch(query?: string) {
    const q = (query ?? keyword).trim()
    if (!q) return
    setKeyword(q)
    setLoading(true)
    setError(null)
    setHasSearched(true)
    try {
      saveHistory(q)
      const result = await lrtsAPI.searchBooks(q)
      setResults(result.books)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <List
      navigationTitle="搜索"
      navigationBarTitleDisplayMode="large"
      toolbar={
        props?.onExit
          ? {
              topBarLeading: [
                <Button title="退出" systemImage="xmark" action={props.onExit} />,
              ],
            }
          : undefined
      }
      searchable={{
        value: keyword,
        onChanged: setKeyword,
        placement: "navigationBarDrawer",
        prompt: "搜索有声书 / 小说",
      }}
      onSubmit={{
        triggers: "search",
        action: () => {
          void runSearch()
        },
      }}
    >
      <Section>
        <Button
          title="搜索"
          systemImage="magnifyingglass"
          tint={ACCENT}
          action={() => void runSearch()}
        />
      </Section>

      {history.length > 0 ? (
        <Section
          header={<Text>搜索历史</Text>}
          footer={
            <Button
              title="清空历史"
              role="destructive"
              action={() => clearHistory()}
            />
          }
        >
          {history.map((item) => (
            <Button
              key={item}
              title={item}
              systemImage="clock.arrow.circlepath"
              action={() => void runSearch(item)}
            />
          ))}
        </Section>
      ) : null}

      {loading ? (
        <Section>
          <HStack spacing={8}>
            <ProgressView />
            <Text foregroundStyle="secondaryLabel">搜索中...</Text>
          </HStack>
        </Section>
      ) : null}

      {error ? (
        <Section>
          <Text foregroundStyle={ACCENT}>{error}</Text>
        </Section>
      ) : null}

      {!loading && hasSearched && results.length === 0 ? (
        <Section>
          <Text foregroundStyle="secondaryLabel">未找到相关结果</Text>
        </Section>
      ) : null}

      {results.length > 0 ? (
        <Section header={<Text>搜索结果 ({results.length})</Text>}>
          {results.map((book) => (
            <BookRow key={book.id} book={book} />
          ))}
        </Section>
      ) : null}
    </List>
  )
}

function BookRow({ book }: { book: Audiobook }) {
  const placeholder = (
    <Image
      systemName="book.closed"
      font="title2"
      foregroundStyle="secondaryLabel"
      frame={{ width: 56, height: 72 }}
      background="secondarySystemFill"
      clipShape={{ type: "rect", cornerRadius: 4 }}
    />
  )

  const cover = book.coverUrl ? (
    <Image
      imageUrl={book.coverUrl}
      resizable={true}
      scaleToFill={true}
      frame={{ width: 56, height: 72 }}
      clipShape={{ type: "rect", cornerRadius: 4 }}
      placeholder={placeholder}
    />
  ) : (
    placeholder
  )

  return (
    <NavigationLink
      destination={
        <BookDetailPage book={book} />
      }
    >
      <HStack spacing={12}>
        {cover}
        <VStack alignment="leading" spacing={2}>
          <Text lineLimit={1} fontWeight="medium">
            {book.title}
          </Text>
          <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
            {book.author}
          </Text>
          <HStack spacing={6}>
            {book.categoryName ? (
              <Text font="caption2" foregroundStyle="tertiaryLabel">
                {book.categoryName}
              </Text>
            ) : null}
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

