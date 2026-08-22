import {
  Script, Navigation, NavigationStack, List, Button, Text,
  Form, Section, VStack, HStack, ProgressView,
  DisclosureGroup, TextField, Picker, Toggle,
  Label, Image, Menu, NavigationLink,
  Link, Markdown,
  useState, useEffect
} from "scripting"

// ─── Types ───────────────────────────────────────────────────────

interface StoryItem {
  title: string
  url: string
}

interface ChapterItem {
  title: string
  url: string
}

interface BookInfo {
  title: string
  url: string
  description?: string
}

// ─── Constants ───────────────────────────────────────────────────

const SHORT_STORY_BASE = "https://blog.xbookcn.net"
const LONG_NOVEL_BASE = "https://book.xbookcn.net"

const SHORT_CATEGORIES = [
  { label: "精选作品", url: `${SHORT_STORY_BASE}/search/label/精选作品` },
  { label: "现代情色", url: `${SHORT_STORY_BASE}/search/label/现代情色` },
  { label: "日本情色", url: `${SHORT_STORY_BASE}/search/label/日本情色` },
  { label: "西洋情色", url: `${SHORT_STORY_BASE}/search/label/西洋情色` },
  { label: "伴侣交换", url: `${SHORT_STORY_BASE}/search/label/伴侣交换` },
  { label: "武侠情色", url: `${SHORT_STORY_BASE}/search/label/武侠情色` },
  { label: "奇幻科幻", url: `${SHORT_STORY_BASE}/search/label/奇幻科幻` },
  { label: "家庭乱伦", url: `${SHORT_STORY_BASE}/search/label/家庭乱伦` },
  { label: "性爱调教", url: `${SHORT_STORY_BASE}/search/label/性爱调教` },
  { label: "粗野性交", url: `${SHORT_STORY_BASE}/search/label/粗野性交` },
  { label: "多人群交", url: `${SHORT_STORY_BASE}/search/label/多人群交` },
  { label: "教师学生", url: `${SHORT_STORY_BASE}/search/label/教师学生` },
  { label: "古典情色", url: `${SHORT_STORY_BASE}/search/label/古典情色` },
  { label: "历史情色", url: `${SHORT_STORY_BASE}/search/label/历史情色` },
  { label: "同性情色", url: `${SHORT_STORY_BASE}/search/label/同性情色` },
  { label: "都市生活", url: `${SHORT_STORY_BASE}/search/label/都市生活` },
  { label: "医生护士", url: `${SHORT_STORY_BASE}/search/label/医生护士` },
  { label: "另类其他", url: `${SHORT_STORY_BASE}/search/label/另类其他` },
]

// ─── Utility ────────────────────────────────────────────────────

const SAFARI_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"

// Shared persistent WebViews — one per domain, reused across all requests.
// This keeps cookies/session alive so Cloudflare only challenges the first request.
const webViewPool = new Map<string, WebViewController>()
const domainWarmedUp = new Set<string>()

function getDomain(url: string): string {
  const m = url.match(/https?:\/\/([^\/]+)/)
  return m ? m[1] : url
}

async function getWebView(domain: string): Promise<WebViewController> {
  let wv = webViewPool.get(domain)
  if (!wv) {
    wv = new WebViewController()
    await wv.setCustomUserAgent(SAFARI_UA)
    webViewPool.set(domain, wv)
  }
  return wv
}

async function warmupDomain(domain: string): Promise<void> {
  if (domainWarmedUp.has(domain)) return
  const wv = await getWebView(domain)
  // Load the root to pass Cloudflare JS challenge once
  await wv.loadURL(`https://${domain}/?m=0`)
  await delay(3000)
  await wv.waitForLoad()
  const html = await wv.getHTML() ?? ''
  if (html.includes('cf-browser-verification') || html.includes('_cf_chl_opt') || html.includes('cf_challenge')) {
    // Cloudflare still challenging — wait longer
    await delay(5000)
    await wv.waitForLoad()
    const retry = await wv.getHTML() ?? ''
    if (retry.includes('cf-browser-verification') || retry.includes('_cf_chl_opt')) {
      throw new Error(`Cloudflare 拦截 ${domain}，请开启代理后重试`)
    }
  }
  domainWarmedUp.add(domain)
}

async function fetchHTML(url: string): Promise<string> {
  const domain = getDomain(url)
  await warmupDomain(domain)
  const wv = await getWebView(domain)

  const cleanUrl = encodeURI(url.includes('?') ? url : url + '?m=1')
  await wv.loadURL(cleanUrl)
  await delay(2000)
  await wv.waitForLoad()
  const html = await wv.getHTML()
  if (!html || html.length < 200) throw new Error('页面加载失败')

  // CF should be resolved by warmup, but retry just in case
  if (html.includes('cf-browser-verification') || html.includes('_cf_chl_opt') || html.includes('cf_challenge')) {
    await delay(5000)
    await wv.waitForLoad()
    const retryHtml = await wv.getHTML()
    if (!retryHtml || retryHtml.length < 200) throw new Error('页面加载失败')
    if (retryHtml.includes('cf-browser-verification') || retryHtml.includes('_cf_chl_opt')) {
      throw new Error('被 Cloudflare 拦截，请开启代理后重试')
    }
    return retryHtml
  }
  return html
}

function disposeWebViews(): void {
  webViewPool.forEach(wv => wv.dispose())
  webViewPool.clear()
  domainWarmedUp.clear()
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function toError(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  try { return JSON.stringify(e) } catch (_) { return String(e) }
}

function extractTitle(html: string): string {
  const m = html.match(/<title>([^<]*)<\/title>/i)
  return m ? m[1].trim() : '无标题'
}

function extractStoryContent(html: string): { title: string; author: string; content: string } {
  let title = extractTitle(html)
    .replace(/\s*[-|]\s*短篇成人情色小说$/, '')
    .replace(/\s*[-|]\s*长篇成人情色小说$/, '')
    .replace(/\s*[-|]\s*长篇小说$/, '')
    .trim()

  let author = ''
  const am = html.match(/作者[：:]\s*([^<]*?)(?:<|$)/i)
  if (am) author = am[1].trim()

  let raw = ''
  // try post-body
  const pb = html.match(/<div[^>]*class=["'][^"']*post-body[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i)
  if (pb) raw = pb[1]
  else {
    const art = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    if (art) raw = art[1]
    else {
      const ec = html.match(/<div[^>]*class=["'][^"']*entry-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
      if (ec) raw = ec[1]
    }
  }

  let text = raw
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<div[^>]*>/gi, '')
    .replace(/<\/div>/gi, '\n')
    .replace(/<h[1-6][^>]*>/gi, '')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/?ul>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/gm, '').trim()

  return { title, author, content: text }
}

function extractStoryList(html: string): StoryItem[] {
  const items: StoryItem[] = [], seen = new Set<string>()
  const re = /<a\s+href=["'](https:\/\/blog\.xbookcn\.net\/\d{4}\/\d{2}\/[^"']+)["'][^>]*>([^<]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const url = m[1].trim(), title = m[2].trim()
    if (title.length < 2 || title === '主页' || title === '下一页' || title === '上一页') continue
    if (seen.has(url) || url.includes('/p/')) continue
    seen.add(url)
    items.push({ title, url })
  }
  return items
}

function extractBookList(html: string): BookInfo[] {
  const items: BookInfo[] = [], seen = new Set<string>()
  const re = /<a\s+href=["'](https:\/\/book\.xbookcn\.net\/search\/label\/[^"']+)["'][^>]*>([^<]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const url = m[1].trim(), title = m[2].trim()
    if (title.length < 2 || title === '主页' || title === '下一页' || title === '上一页') continue
    if (seen.has(url) || url.includes('/p/') || url.includes('/2000/')) continue
    seen.add(url)
    items.push({ title, url })
  }
  return items
}

function extractChapterList(html: string): ChapterItem[] {
  const items: ChapterItem[] = [], seen = new Set<string>()
  const re = /<a\s+href=["'](https:\/\/book\.xbookcn\.net\/\d{4}\/\d{2}\/[^"']+)["'][^>]*>([^<]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const url = m[1].trim(), title = m[2].trim()
    if (title.length < 2 || title === '主页' || title === '下一页' || title === '上一页') continue
    // Exclude index/static pages (list.html, site.html, contact.html, etc.)
    if (seen.has(url) || url.includes('/2000/01/')) continue
    seen.add(url)
    items.push({ title, url })
  }
  return items
}

function getNextPageUrl(html: string): string | null {
  const m = html.match(/<a\s+href=["']([^"']+\/search\/[^"']*?updated-max[^"']+)["'][^>]*>下一页<\/a>/i)
  if (m) {
    let url = m[1].trim()
    if (url.startsWith('/')) url = 'https://blog.xbookcn.net' + url
    if (!url.startsWith('http')) url = 'https://blog.xbookcn.net/' + url.replace(/^\//, '')
    return url
  }
  return null
}

function getMainPageNextUrl(html: string): string | null {
  // Matches the main page "下一页" link: /search?updated-max=...&max-results=...
  const m = html.match(/<a\s+href=["']([^"']+updated-max[^"']+)["'][^>]*>下一页<\/a>/i)
  if (m) {
    let url = m[1].trim()
    if (url.startsWith('/')) url = 'https://book.xbookcn.net' + url
    if (!url.startsWith('http')) url = 'https://book.xbookcn.net/' + url.replace(/^\//, '')
    return url
  }
  return null
}

function filterChaptersByBookTitle(chapters: ChapterItem[], bookTitle: string): ChapterItem[] {
  const key = bookTitle.trim().toLowerCase()
  if (!key) return chapters
  return chapters.filter(ch => {
    const ct = ch.title.trim().toLowerCase()
    if (ct.includes(key)) return true
    // Also match after stripping chapter number suffix (e.g. "书名 第一章" -> "书名")
    const stripped = ct.replace(/[ 　]*第[一二三四五六七八九十百千万\d]+[章节回篇].*$/, '').trim()
    return stripped === key || key.includes(stripped) || stripped.includes(key)
  })
}

// ─── Components ─────────────────────────────────────────────────

function MainView() {
  const dismiss = Navigation.useDismiss()
  return (
    <NavigationStack>
      <List navigationTitle="xbookcn 下载器"
        toolbar={{ cancellationAction: <Button title="关闭" action={dismiss} /> }}
      >
        <Section title="选择下载来源">
          <NavigationLink destination={<ShortStoryCategoriesView />}>
            <HStack>
              <Image systemName="book.fill" />
              <VStack>
                <Text>短篇情色小说</Text>
                <Text foregroundStyle="gray">16,100+ 篇</Text>
              </VStack>
            </HStack>
          </NavigationLink>
          <NavigationLink destination={<LongNovelListView />}>
            <HStack>
              <Image systemName="books.vertical.fill" />
              <VStack>
                <Text>长篇情色小说</Text>
                <Text foregroundStyle="gray">37,100+ 章</Text>
              </VStack>
            </HStack>
          </NavigationLink>
        </Section>
      </List>
    </NavigationStack>
  )
}

function ShortStoryCategoriesView() {
  const dismiss = Navigation.useDismiss()
  return (
    <NavigationStack>
      <List navigationTitle="短篇情色小说"
        toolbar={{ cancellationAction: <Button title="返回" action={dismiss} /> }}
      >
        <Section title="分类浏览">
          {SHORT_CATEGORIES.map(cat => (
            <NavigationLink key={cat.url} destination={<StoryListView url={cat.url} title={cat.label} />}>
              <Text>{cat.label}</Text>
            </NavigationLink>
          ))}
        </Section>
      </List>
    </NavigationStack>
  )
}

function StoryListView({ url, title }: { url: string; title: string }) {
  const [stories, setStories] = useState<StoryItem[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [message, setMessage] = useState<string>("正在加载...")
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [downloading, setDownloading] = useState(false)
  const [dlProgress, setDlProgress] = useState(0)
  const [dlTotal, setDlTotal] = useState(0)
  const [nextUrl, setNextUrl] = useState<string | null>(null)
  const dismiss = Navigation.useDismiss()

  useEffect(() => { loadStories(url) }, [url])

  async function loadStories(pageUrl: string) {
    try {
      setMessage("正在获取列表...")
      const html = await fetchHTML(pageUrl)
      const items = extractStoryList(html)
      if (!items.length) { setError("未找到小说"); setLoading(false); return }
      setStories(prev => [...prev, ...items])
      setNextUrl(getNextPageUrl(html))
      setLoading(false)
    } catch (e: unknown) { setError(`失败: ${toError(e)}`); setLoading(false) }
  }

  function toggle(i: number) {
    setSelected(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n })
  }

  function selectAll() {
    if (selected.size === stories.length) setSelected(new Set())
    else setSelected(new Set(stories.map((_, i) => i)))
  }

  async function downloadSelected() {
    const indices = Array.from(selected)
    if (!indices.length) return
    setDownloading(true); setDlProgress(0); setDlTotal(indices.length)
    const files: { data: Data; name: string }[] = []
    for (let i = 0; i < indices.length; i++) {
      const story = stories[indices[i]]
      try {
        setDlProgress(i); setMessage(`下载: ${story.title}`)
        const html = await fetchHTML(story.url)
        const ext = extractStoryContent(html)
        const text = `标题: ${ext.title}\n${ext.author ? `作者: ${ext.author}\n` : ''}来源: ${story.url}\n${'─'.repeat(40)}\n\n${ext.content}`
        const data = Data.fromString(text)
        if (data) files.push({ data, name: `${ext.title.replace(/[\\/:*?"<>|]/g, '_').substring(0, 100)}.txt` })
      } catch (e: unknown) { console.log(`失败: ${story.title} - ${toError(e)}`) }
    }
    setDownloading(false)
    if (files.length) {
      setMessage("正在导出...")
      try { await DocumentPicker.exportFiles({ files }) } catch (e: unknown) { setError(`导出失败: ${toError(e)}`) }
    }
  }

  return (
    <NavigationStack>
      <List navigationTitle={title}
        toolbar={{ cancellationAction: <Button title="返回" action={dismiss} /> }}
      >
        {loading && !stories.length ? (
          <Section><Text>{message}</Text><ProgressView /></Section>
        ) : error ? (
          <Section><Text>{error}</Text>
            <Button title="重试" action={() => { setError(null); setLoading(true); loadStories(url) }} />
          </Section>
        ) : (
          <>
            <Section header={<HStack><Text>共 {stories.length} 篇{nextUrl ? ' (可加载更多)' : ''}</Text></HStack>}>
              <HStack>
                <Button title={selected.size === stories.length ? "取消全选" : "全选"} action={selectAll} />
                {selected.size > 0 && <Button title={`下载所选 (${selected.size})`} action={downloadSelected} />}
              </HStack>
            </Section>
            <Section header={<Text>小说列表</Text>}>
              {stories.map((story, i) => (
                <Button key={story.url} action={() => toggle(i)}>
                  <HStack>
                    <Image systemName={selected.has(i) ? "checkmark.circle.fill" : "circle"} />
                    <VStack>
                      <Text>{story.title}</Text>
                      <Text foregroundStyle="gray">{story.url.split('/').pop() ?? ''}</Text>
                    </VStack>
                  </HStack>
                </Button>
              ))}
            </Section>
            {nextUrl && !loading && (
              <Section><Button title="加载更多..." action={() => { setLoading(true); loadStories(nextUrl) }} /></Section>
            )}
            {loading && stories.length > 0 && (
              <Section><ProgressView /><Text>{message}</Text></Section>
            )}
          </>
        )}
        {downloading && (
          <Section><Text>{message}</Text><ProgressView value={dlProgress} total={dlTotal} /></Section>
        )}
      </List>
    </NavigationStack>
  )
}

function LongNovelListView() {
  const [books, setBooks] = useState<BookInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const dismiss = Navigation.useDismiss()

  useEffect(() => { loadBooks() }, [])

  async function loadBooks() {
    try {
      let html = await fetchHTML(`${LONG_NOVEL_BASE}/p/all.html?m=0`)
      let items = extractBookList(html)
      if (!items.length) {
        html = await fetchHTML(`${LONG_NOVEL_BASE}?m=0`)
        items = extractBookList(html)
      }
      setBooks(items)
      setLoading(false)
    } catch (e: unknown) { setError(`失败: ${toError(e)}`); setLoading(false) }
  }

  return (
    <NavigationStack>
      <List navigationTitle="长篇情色小说"
        toolbar={{ cancellationAction: <Button title="返回" action={dismiss} /> }}
      >
        {loading ? (
          <Section><Text>正在加载...</Text><ProgressView /></Section>
        ) : error ? (
          <Section><Text>{error}</Text>
            <Button title="重试" action={() => { setError(null); setLoading(true); loadBooks() }} />
          </Section>
        ) : books.length === 0 ? (
          <Section><Text>未加载到小说列表。</Text></Section>
        ) : (
          <Section title="全部小说">
            {books.map(book => (
              <NavigationLink key={book.url} destination={<NovelChapterListView url={book.url} title={book.title} />}>
                <Text>{book.title}</Text>
              </NavigationLink>
            ))}
          </Section>
        )}
      </List>
    </NavigationStack>
  )
}

function NovelChapterListView({ url, title }: { url: string; title: string }) {
  const [chapters, setChapters] = useState<ChapterItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [downloading, setDownloading] = useState(false)
  const [dlProgress, setDlProgress] = useState(0)
  const [dlTotal, setDlTotal] = useState(0)
  const [nextUrl, setNextUrl] = useState<string | null>(null)
  const [message, setMessage] = useState("正在加载...")
  const dismiss = Navigation.useDismiss()

  // Load chapters from the book's search/label page (with ?m=0 for desktop mode,
  // which statically renders all chapter links).
  useEffect(() => { loadChapters(url) }, [url])

  function prepChapterUrl(u: string): string {
    // book.xbookcn.net needs ?m=0 (desktop) for static chapter links
    return u.includes('?m=') ? u : (u.includes('?') ? u + '&m=0' : u + '?m=0')
  }

  async function loadChapters(pageUrl: string) {
    try {
      setMessage("正在获取章节...")
      const html = await fetchHTML(prepChapterUrl(pageUrl))
      const items = extractChapterList(html)
      if (!items.length) { setError("未找到章节"); setLoading(false); return }
      setNextUrl(getMainPageNextUrl(html))
      setChapters(prev => [...prev, ...items])
      setLoading(false)
    } catch (e: unknown) { setError(`失败: ${toError(e)}`); setLoading(false) }
  }

  function toggle(i: number) {
    setSelected(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n })
  }

  function selectAll() {
    if (selected.size === chapters.length) setSelected(new Set())
    else setSelected(new Set(chapters.map((_, i) => i)))
  }

  async function downloadSelected() {
    const indices = Array.from(selected)
    if (!indices.length) return
    setDownloading(true); setDlProgress(0); setDlTotal(indices.length)
    const bn = title.replace(/[\\/:*?"<>|]/g, '_')
    const files: { data: Data; name: string }[] = []
    for (let i = 0; i < indices.length; i++) {
      const ch = chapters[indices[i]]
      try {
        setDlProgress(i); setMessage(`下载: ${ch.title}`)
        const html = await fetchHTML(ch.url)
        const ext = extractStoryContent(html)
        const ct = ch.title || ext.title || `第${indices[i] + 1}章`
        const text = `${bn}\n${'═'.repeat(40)}\n\n${ct}\n\n${'─'.repeat(40)}\n\n${ext.content}`
        const data = Data.fromString(text)
        if (data) files.push({ data, name: `${bn}_${String(indices[i] + 1).padStart(2, '0')}_${ct.replace(/[\\/:*?"<>|]/g, '_').substring(0, 80)}.txt` })
      } catch (e: unknown) { console.log(`失败: ${ch.title} - ${toError(e)}`) }
    }
    setDownloading(false)
    if (files.length) {
      setMessage("正在导出...")
      try { await DocumentPicker.exportFiles({ files }) } catch (e: unknown) { setError(`导出失败: ${toError(e)}`) }
    }
  }

  async function downloadAllAsSingleFile() {
    if (!chapters.length) return
    setDownloading(true); setDlProgress(0); setDlTotal(chapters.length)
    const bn = title.replace(/[\\/:*?"<>|]/g, '_')
    let full = `《${title}》\n${'═'.repeat(40)}\n\n`
    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i]
      try {
        setDlProgress(i); setMessage(`下载: ${ch.title}`)
        const html = await fetchHTML(ch.url)
        const ext = extractStoryContent(html)
        const ct = ch.title || ext.title || `第${i + 1}章`
        full += `\n\n${ct}\n${'─'.repeat(40)}\n\n${ext.content}\n\n`
      } catch (e: unknown) {
        full += `\n\n[下载失败: ${ch.title}]\n\n`
      }
    }
    setDownloading(false)
    setMessage("正在导出...")
    try {
      const data = Data.fromString(full)
      if (data) await DocumentPicker.exportFiles({ files: [{ data, name: `${bn}_完整版.txt` }] })
    } catch (e: unknown) { setError(`导出失败: ${toError(e)}`) }
  }

  return (
    <NavigationStack>
      <List navigationTitle={title}
        toolbar={{ cancellationAction: <Button title="返回" action={dismiss} /> }}
      >
        {loading && !chapters.length ? (
          <Section><Text>{message}</Text><ProgressView /></Section>
        ) : error ? (
          <Section><Text>{error}</Text>
            <Button title="重试" action={() => { setError(null); setLoading(true); loadChapters(url) }} />
          </Section>
        ) : (
          <>
            <Section header={<Text>共 {chapters.length} 章</Text>}>
              <VStack>
                <HStack>
                  <Button title={selected.size === chapters.length ? "取消全选" : "全选"} action={selectAll} />
                  {selected.size > 0 && <Button title={`下载所选 (${selected.size})`} action={downloadSelected} />}
                </HStack>
                <Button title="下载全部（合并为单个文件）" action={downloadAllAsSingleFile} />
              </VStack>
            </Section>
            <Section header={<Text>章节列表</Text>}>
              {chapters.map((ch, i) => (
                <Button key={ch.url} action={() => toggle(i)}>
                  <HStack>
                    <Image systemName={selected.has(i) ? "checkmark.circle.fill" : "circle"} />
                    <Text>{ch.title || `第${i + 1}章`}</Text>
                  </HStack>
                </Button>
              ))}
            </Section>
            {nextUrl && !loading && (
              <Section><Button title="加载更多章节..." action={() => { setLoading(true); loadChapters(nextUrl) }} /></Section>
            )}
            {loading && chapters.length > 0 && (
              <Section><ProgressView /><Text>{message}</Text></Section>
            )}
          </>
        )}
        {downloading && (
          <Section><Text>{message}</Text><ProgressView value={dlProgress} total={dlTotal} /></Section>
        )}
      </List>
    </NavigationStack>
  )
}

// ─── Entry ──────────────────────────────────────────────────────

async function run() {
  await Navigation.present(<MainView />)
  disposeWebViews()
  Script.exit()
}

run()
