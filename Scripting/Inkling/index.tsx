// Inkling —— 微信读书划线回顾
// UI 参考 Booko / 随手摘 / 书影 的真实交互：封面墙 + 卡片回顾 + 翻页器
import {
  VStack, HStack, ZStack, Text, Image, Button, TextField, SecureField,
  Spacer, ProgressView, ScrollView, LazyVGrid, LazyVStack,
  NavigationStack, NavigationLink, Navigation,
  Rectangle, RoundedRectangle,
  TabView, Tab,
  useState, useEffect, useObservable, useRef,
  Script,
} from "scripting"

import * as Weread from "./weread"
import type { Note, NotebookEntry } from "./weread"

// ===== 主题 =====
const ACCENT = "systemIndigo"
const PAGE_BG = "systemGroupedBackground"
const CARD_BG = "secondarySystemGroupedBackground"

const GRID_COLUMNS = [{ size: { type: "adaptive" as const, min: 96, max: 132 } }]

const MODE_LABEL: Record<Weread.ReadMode, string> = {
  weekly: "本周",
  monthly: "本月",
  annually: "今年",
  overall: "全部",
}

// ===== 本地缓存 =====
const K_BOOKS = "inkling_books"
const K_NOTES_PREFIX = "inkling_notes_"
const K_FETCHED = "inkling_fetched"
const K_SYNC = "inkling_lastSync"
const K_CACHE_VER = "inkling_cache_ver"
const CACHE_VERSION = "4"
const KCM_KEY = "inkling_api_key"

function readJSON<T>(key: string, fallback: T): T {
  try {
    const s = Storage.get(key)
    return typeof s === "string" ? (JSON.parse(s) as T) : fallback
  } catch {
    return fallback
  }
}
function loadBooks(): NotebookEntry[] {
  // 缓存结构变更时强制重拉，避免旧数据（无标题）残留
  if (Storage.get(K_CACHE_VER) !== CACHE_VERSION) {
    const old = readJSON<NotebookEntry[]>(K_BOOKS, [])
    for (const b of old) {
      if (b && b.bookId) Storage.remove(K_NOTES_PREFIX + b.bookId)
    }
    Storage.remove(K_BOOKS)
    Storage.remove(K_FETCHED)
    Storage.set(K_CACHE_VER, CACHE_VERSION)
    __allNotesCache = null
    return []
  }
  return readJSON<NotebookEntry[]>(K_BOOKS, [])
}
function saveBooks(b: NotebookEntry[]) {
  Storage.set(K_BOOKS, JSON.stringify(b))
  __allNotesCache = null
}
function loadNotes(bookId: string): Note[] {
  return readJSON<Note[]>(K_NOTES_PREFIX + bookId, [])
}
function saveNotes(bookId: string, notes: Note[]) {
  Storage.set(K_NOTES_PREFIX + bookId, JSON.stringify(notes))
  __allNotesCache = null
}

/** 已拉过的书（即使确实没笔记）—— 避免「还有 N 本未加载」永远不降 */
function loadFetched(): Record<string, 1> {
  return readJSON<Record<string, 1>>(K_FETCHED, {})
}
function markFetched(bookId: string) {
  const f = loadFetched()
  if (f[bookId]) return
  f[bookId] = 1
  Storage.set(K_FETCHED, JSON.stringify(f))
}

let __allNotesCache: Note[] | null = null

function loadAllNotes(): Note[] {
  if (__allNotesCache) return __allNotesCache
  const all: Note[] = []
  for (const b of loadBooks()) all.push(...loadNotes(b.bookId))
  __allNotesCache = all
  return all
}
/** 一本书能真正展示的笔记数（划线 + 想法；bookmarkCount 是页码书签，拉不到内容） */
function noteTotal(b: NotebookEntry): number {
  return b.noteCount + b.reviewCount
}

function uncachedNoteBooks(): NotebookEntry[] {
  const fetched = loadFetched()
  return loadBooks()
    .filter((b) => noteTotal(b) > 0)
    .filter((b) => !fetched[b.bookId])
}

function getApiKey(): string | null {
  return Keychain.get(KCM_KEY)
}
function setApiKey(k: string) {
  Keychain.set(KCM_KEY, k.trim())
}

function fmtDate(ts: number): string {
  if (!ts) return ""
  const d = new Date(ts * 1000)
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}.${mm}.${dd}`
}
function fmtDur(sec: number): string {
  if (!sec) return "0 分钟"
  let h = Math.floor(sec / 3600)
  let m = Math.round((sec % 3600) / 60)
  if (m >= 60) { h += 1; m = 0 }
  return h > 0 ? `${h} 小时${m > 0 ? ` ${m} 分钟` : ""}` : `${m} 分钟`
}

/** 紧凑时长：1234h / 12h30m / 45m，避免几千小时把卡片撑开 */
function fmtDurShort(sec: number): string {
  if (!sec) return "0m"
  let h = Math.floor(sec / 3600)
  let m = Math.round((sec % 3600) / 60)
  if (m >= 60) { h += 1; m = 0 }
  if (h >= 100) return `${h}h`
  if (h > 0) return m > 0 ? `${h}h${m}m` : `${h}h`
  return `${m}m`
}
function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = a[i]
    a[i] = a[j]
    a[j] = t
  }
  return a
}
function copyText(t: string) {
  try {
    Pasteboard.setString(t)
  } catch {
    // ignore
  }
}

/** 字数：不足 1 万按千字保留一位小数 */
function fmtWord(w: number): string {
  if (!w) return ""
  if (w < 9950) return `${Math.round(w / 100) / 10} 千字`
  return `${Math.round(w / 10000)} 万字`
}

/** 毫秒时间戳 → 10-21 19:20 */
function fmtStamp(ms: number): string {
  if (!ms) return ""
  const d = new Date(ms)
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  const hh = String(d.getHours()).padStart(2, "0")
  const mi = String(d.getMinutes()).padStart(2, "0")
  return `${mm}-${dd} ${hh}:${mi}`
}

// ===== 首次使用 / 更新说明 =====
const __rnVersion = "0.5.0"
const __rnKey = "inkling_release_notes_version"
const __rnItems = [
  "新增：书架搜不到的书可直接跳去书城搜索",
  "新增：我的页展示读过 / 读完本数与阅读天数",
  "新增：书架显示上次同步时间",
  "修复：同步失败时会把书架缓存覆盖成只剩有笔记的书",
  "修复：目录里的热门划线会显示成串数字",
  "修复：只打分没写字的想法会变成空白卡片",
  "优化：帖子/搜索结果显示被居中、加载更多会重复插入同一条",
]

function ReleaseNotesGate({ children }: { children: any }) {
  const [show, setShow] = useState(() => Storage.get<string>(__rnKey) !== __rnVersion)
  const [title] = useState(() => (Storage.contains(__rnKey) ? "本次更新" : "首次使用"))
  const close = () => {
    Storage.set(__rnKey, __rnVersion)
    setShow(false)
  }
  return (
    <VStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      sheet={
        show
          ? {
              isPresented: true,
              onChanged: (v: boolean) => {
                if (!v) close()
              },
              content: (
                <VStack alignment="leading" spacing={16} padding={22} presentationDetents={[380]} presentationDragIndicator="visible">
                  <Text font={20} fontWeight="bold">
                    {title} · v{__rnVersion}
                  </Text>
                  {title === "首次使用" ? (
                    <Text font={15} lineSpacing={4}>
                      在微信读书官方页面扫码登录，拿到 wrk- 开头的 API Key 粘进来即可。Inkling 只读取你自己的划线、想法和阅读数据，全部缓存在本机。
                    </Text>
                  ) : null}
                  <VStack alignment="leading" spacing={10}>
                    {__rnItems.map((it, i) => (
                      <Text key={i} font={14} lineSpacing={4}>
                        • {it}
                      </Text>
                    ))}
                  </VStack>
                  <Button title="开始使用" systemImage="arrow.right.circle.fill" buttonStyle="borderedProminent" action={close} />
                </VStack>
              ),
            }
          : undefined
      }
    >
      {children}
    </VStack>
  )
}

// ===== 通用部件 =====

function Chip({ label, active, onTap }: { label: string; active: boolean; onTap: () => void }) {
  return (
    <Button action={onTap}>
      <Text
        font={14}
        fontWeight={active ? "semibold" : "regular"}
        foregroundStyle={active ? "label" : "secondaryLabel"}
        padding={{ horizontal: 12, vertical: 6 }}
        background={active ? "tertiarySystemFill" : undefined}
        clipShape={{ type: "capsule", style: "continuous" }}
      >
        {label}
      </Text>
    </Button>
  )
}

function Cover({ bookId, url, width, height, radius = 8 }: { bookId: string; url?: string; width?: number; height?: number; radius?: number }) {
  const src = url && url.length > 0 ? url : Weread.getCoverUrl(bookId)
  if (width && height) {
    return (
      <ZStack frame={{ width, height }} background="tertiarySystemFill" clipShape={{ type: "rect", cornerRadius: radius }}>
        <Image imageUrl={src} resizable scaleToFill frame={{ width, height }} />
      </ZStack>
    )
  }
  return (
    <ZStack frame={{ maxWidth: "infinity" }} background="tertiarySystemFill" clipShape={{ type: "rect", cornerRadius: radius }}>
      <Image
        imageUrl={src}
        resizable
        scaleToFill
        frame={{ maxWidth: "infinity" }}
        aspectRatio={{ value: 0.7, contentMode: "fit" }}
      />
    </ZStack>
  )
}

function PageShell({ children }: { children: any }) {
  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <Rectangle fill={PAGE_BG} ignoresSafeArea />
      {children}
    </ZStack>
  )
}

function CloseButton({ onTap }: { onTap: () => void }) {
  return (
    <Button action={onTap}>
      <Image systemName="xmark" />
    </Button>
  )
}

function Notice({ icon, title, message, action }: { icon: string; title: string; message: string; action?: any }) {
  return (
    <VStack spacing={14} padding={{ vertical: 64, horizontal: 32 }} alignment="center" frame={{ maxWidth: "infinity" }}>
      <Image systemName={icon} font={52} foregroundStyle="tertiaryLabel" />
      <Text font={19} fontWeight="bold">{title}</Text>
      <Text font={14} foregroundStyle="secondaryLabel" multilineTextAlignment="center" lineSpacing={3}>
        {message}
      </Text>
      {action}
    </VStack>
  )
}

function PrimaryButton({ title, icon, busy, onTap }: { title: string; icon?: string; busy?: boolean; onTap: () => void }) {
  return (
    <Button action={onTap}>
      <HStack frame={{ maxWidth: "infinity" }} padding={{ vertical: 13 }} background={ACCENT} clipShape={{ type: "rect", cornerRadius: 14 }} alignment="center" spacing={6}>
        {busy ? <ProgressView tint="white" /> : icon ? <Image systemName={icon} font={15} foregroundStyle="white" /> : null}
        <Text font={16} fontWeight="semibold" foregroundStyle="white">{title}</Text>
      </HStack>
    </Button>
  )
}

// ===== App =====

function App() {
  const [hasKey, setHasKey] = useState(() => !!getApiKey())
  return <MainApp hasKey={hasKey} setHasKey={setHasKey} />
}

function MainApp({ hasKey, setHasKey }: { hasKey: boolean; setHasKey: (b: boolean) => void }) {
  const dismiss = Navigation.useDismiss()
  const selection = useObservable<number>(0)

  if (!hasKey) {
    return (
      <NavigationStack>
        <SetupPage onDone={() => setHasKey(true)} dismiss={dismiss} />
      </NavigationStack>
    )
  }

  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <Rectangle fill={PAGE_BG} ignoresSafeArea />
      <TabView selection={selection} tint={ACCENT}>
        <Tab title="重温" systemImage="quote.opening" value={0}>
          <NavigationStack><RevisitPage /></NavigationStack>
        </Tab>
        <Tab title="书架" systemImage="books.vertical" value={1}>
          <NavigationStack><ShelfPage /></NavigationStack>
        </Tab>
        <Tab title="我的" systemImage="person.crop.circle" value={2}>
          <NavigationStack><ProfilePage onLogout={() => setHasKey(false)} dismiss={dismiss} /></NavigationStack>
        </Tab>
      </TabView>
    </ZStack>
  )
}

// ===== 连接页 =====

function SetupPage({ onDone, dismiss }: { onDone: () => void; dismiss: () => void }) {
  const [key, setKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    if (!key.trim()) {
      setErr("请输入 API Key")
      return
    }
    setBusy(true)
    setErr(null)
    try {
      await Weread.validateKey(key.trim())
      setApiKey(key)
      onDone()
    } catch (e: any) {
      setErr(e?.message || "验证失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageShell>
      <ScrollView>
        <VStack alignment="leading" spacing={20} padding={{ horizontal: 20, vertical: 28 }}>
          <VStack alignment="leading" spacing={6}>
            <Text font={34} fontWeight="bold">Inkling</Text>
            <Text font={15} foregroundStyle="secondaryLabel" lineSpacing={3}>
              把微信读书里划过的句子，放回眼前。
            </Text>
          </VStack>

          <VStack alignment="leading" spacing={14} padding={18} background={CARD_BG} clipShape={{ type: "rect", cornerRadius: 20 }}>
            <HStack spacing={8}>
              <Image systemName="key.fill" font={14} foregroundStyle={ACCENT} />
              <Text font={15} fontWeight="semibold">微信读书 API Key</Text>
            </HStack>
            <SecureField title="API Key" prompt="wrk-…" value={key} onChanged={setKey} />
            {err ? <Text font={13} foregroundStyle="systemRed">{err}</Text> : null}
            <PrimaryButton title={busy ? "验证中…" : "保存并连接"} busy={busy} onTap={save} />
          </VStack>

          <Button action={() => Safari.openURL(Weread.WEREAD_KEY_URL)}>
            <HStack spacing={6}>
              <Image systemName="arrow.up.right.square" font={14} foregroundStyle={ACCENT} />
              <Text font={15} foregroundStyle={ACCENT}>去微信读书获取 Key</Text>
            </HStack>
          </Button>

          <VStack alignment="leading" spacing={8} padding={16} background={CARD_BG} clipShape={{ type: "rect", cornerRadius: 16 }}>
            <Text font={13} fontWeight="semibold" foregroundStyle="secondaryLabel">怎么拿 Key</Text>
            <Text font={13} foregroundStyle="secondaryLabel" lineSpacing={5}>
              1. 打开 weread.qq.com/r/weread-skills{"\n"}
              2. 用微信读书账号扫码登录{"\n"}
              3. 复制 wrk- 开头的 Key，回到这里粘贴
            </Text>
          </VStack>
        </VStack>
      </ScrollView>
    </PageShell>
  )
}

// ===== 重温 =====

function RevisitPage() {
  const dismiss = Navigation.useDismiss()
  const [all, setAll] = useState<Note[]>(() => loadAllNotes())
  const [filter, setFilter] = useState<"all" | "highlight" | "review">("all")
  const [deck, setDeck] = useState<Note[]>(() => shuffle(loadAllNotes()))
  const [idx, setIdx] = useState(0)
  const [loadingNotes, setLoadingNotes] = useState(false)
  const busyRef = useRef(false)
  const filterRef = useRef(filter)
  useEffect(() => {
    filterRef.current = filter
  }, [filter])
  const [noteProgress, setNoteProgress] = useState("")
  const [remaining, setRemaining] = useState(0)

  useEffect(() => {
    const cached = loadAllNotes()
    if (cached.length > 0) {
      setAll(cached)
      setRemaining(uncachedNoteBooks().length)
    } else {
      void loadBatch()
    }
  }, [])

  async function loadBatch() {
    const key = getApiKey()
    if (!key || busyRef.current) return
    busyRef.current = true
    const missing = uncachedNoteBooks()
    setRemaining(missing.length)
    if (missing.length === 0) {
      setAll(loadAllNotes())
      busyRef.current = false
      return
    }
    setLoadingNotes(true)
    const slice = missing.slice(0, 12)
    let i = 0
    for (const b of slice) {
      i++
      setNoteProgress(`${i}/${slice.length}`)
      try {
        const r = await Weread.getBookNotes(key, b.bookId)
        saveNotes(b.bookId, r.notes)
        if (!r.reviewsFailed) markFetched(b.bookId)
      } catch {
        // 单本失败不中断
      }
      if (i % 3 === 0) await new Promise<void>((res) => { setTimeout(() => res(), 1) })
    }
    const fresh = loadAllNotes()
    setAll(fresh)
    // 把新拉到的笔记并进牌堆，但不打断当前正在看的卡片
    setDeck((prev) => {
      const ids = new Set(prev.map((n) => n.id))
      const pool = filterRef.current === "all" ? fresh : fresh.filter((n) => n.kind === filterRef.current)
      const extra = pool.filter((n) => !ids.has(n.id))
      return extra.length > 0 ? prev.concat(shuffle(extra)) : prev
    })
    setLoadingNotes(false)
    setNoteProgress("")
    setRemaining(uncachedNoteBooks().length)
    busyRef.current = false
  }

  useEffect(() => {
    const list = filter === "all" ? all : all.filter((n) => n.kind === filter)
    setDeck(shuffle(list))
    setIdx(0)
  }, [filter])

  const current = deck.length > 0 ? deck[Math.min(idx, deck.length - 1)] : null

  function step(delta: number) {
    if (deck.length === 0) return
    setIdx((i) => (i + delta + deck.length) % deck.length)
  }
  function reshuffle() {
    setDeck((d) => shuffle(d))
    setIdx(0)
  }

  const hCount = all.filter((n) => n.kind === "highlight").length
  const rCount = all.filter((n) => n.kind === "review").length

  return (
    <PageShell>
      <ScrollView
        toolbar={{
          topBarLeading: <CloseButton onTap={dismiss} />,
          topBarTrailing: (
            <Button action={reshuffle}>
              <Image systemName="shuffle" />
            </Button>
          ),
        }}
      >
        <VStack alignment="leading" spacing={0} padding={{ bottom: 32 }}>
          <HStack padding={{ horizontal: 20, bottom: 12 }}>
            <Text font={13} foregroundStyle="secondaryLabel">
              {deck.length > 0 ? `${idx + 1} / ${deck.length} 条` : "还没有笔记"}
            </Text>
            <Spacer />
          </HStack>

          <HStack spacing={8} padding={{ horizontal: 20, bottom: 16 }}>
            <Chip label={`全部 ${all.length}`} active={filter === "all"} onTap={() => setFilter("all")} />
            <Chip label={`划线 ${hCount}`} active={filter === "highlight"} onTap={() => setFilter("highlight")} />
            <Chip label={`想法 ${rCount}`} active={filter === "review"} onTap={() => setFilter("review")} />
          </HStack>

          {remaining > 0 && all.length > 0 ? (
            <Button action={() => loadBatch()}>
              <HStack spacing={4} padding={{ horizontal: 20, bottom: 12 }}>
                <Image systemName="arrow.down.circle" font={12} foregroundStyle={ACCENT} />
                <Text font={12} foregroundStyle={ACCENT}>
                  {loadingNotes ? `正在加载 ${noteProgress}…` : `还有 ${remaining} 本笔记未加载，点此继续`}
                </Text>
              </HStack>
            </Button>
          ) : null}

          {all.length === 0 ? (
            loadingNotes ? (
              <VStack frame={{ maxWidth: "infinity" }} padding={{ vertical: 60 }} alignment="center" spacing={12}>
                <ProgressView />
                <Text font={14} fontWeight="medium">正在读取笔记 {noteProgress}</Text>
                <Text font={12} foregroundStyle="secondaryLabel">首次进入需要先下载你的划线</Text>
              </VStack>
            ) : (
              <Notice
                icon="quote.opening"
                title="还没有笔记"
                message={"从你的微信读书里拉一批划线回来"}
                action={<PrimaryButton title="加载笔记" icon="arrow.down.circle" busy={loadingNotes} onTap={() => loadBatch()} />}
              />
            )
          ) : current ? (
            <VStack alignment="leading" spacing={0} padding={{ horizontal: 16 }}>
              <NoteCard note={current} hero />

              <HStack spacing={10} padding={{ top: 16 }} alignment="center">
                <Button action={() => step(-1)}>
                  <Image systemName="chevron.up" font={16} foregroundStyle="label" frame={{ width: 44, height: 44 }} background={CARD_BG} clipShape={{ type: "capsule", style: "continuous" }} />
                </Button>
                <Button action={() => step(1)}>
                  <Image systemName="chevron.down" font={16} foregroundStyle="label" frame={{ width: 44, height: 44 }} background={CARD_BG} clipShape={{ type: "capsule", style: "continuous" }} />
                </Button>
                <Spacer />
                <Button action={() => copyText(current.content)}>
                  <HStack spacing={6} padding={{ horizontal: 16, vertical: 10 }} background={CARD_BG} clipShape={{ type: "capsule", style: "continuous" }}>
                    <Image systemName="doc.on.doc" font={13} foregroundStyle={ACCENT} />
                    <Text font={14} fontWeight="medium" foregroundStyle={ACCENT}>复制</Text>
                  </HStack>
                </Button>
              </HStack>
            </VStack>
          ) : (
            <Notice icon="line.3.horizontal.decrease.circle" title="没有可翻的内容" message="换一个筛选看看" />
          )}
        </VStack>
      </ScrollView>
    </PageShell>
  )
}

// ===== 笔记卡片 =====

function NoteCard({ note, hero }: { note: Note; hero?: boolean }) {
  const isReview = note.kind === "review"
  return (
    <VStack alignment="leading" spacing={0} padding={hero ? 22 : 18} frame={{ maxWidth: "infinity" }} background={CARD_BG} clipShape={{ type: "rect", cornerRadius: 22 }}>
      <HStack spacing={8} padding={{ bottom: 12 }}>
        <Text
          font={11}
          fontWeight="semibold"
          foregroundStyle={isReview ? "systemOrange" : ACCENT}
          padding={{ horizontal: 8, vertical: 3 }}
          background="tertiarySystemFill"
          clipShape={{ type: "capsule", style: "continuous" }}
        >
          {isReview ? "想法" : "划线"}
        </Text>
        <Text font={12} foregroundStyle="tertiaryLabel">{fmtDate(note.createTime)}</Text>
        <Spacer />
      </HStack>

      {isReview && note.sourceText ? (
        <Text font={13} foregroundStyle="secondaryLabel" lineSpacing={4} padding={{ bottom: 12 }}>
          「{note.sourceText}」
        </Text>
      ) : null}

      <Text font={hero ? 21 : 17} lineSpacing={hero ? 9 : 7} foregroundStyle="label">
        {note.content || note.sourceText || "（这条想法没有正文）"}
      </Text>

      {note.chapter ? (
        <Text font={12} foregroundStyle="tertiaryLabel" padding={{ top: 12 }}>
          {note.chapter}
        </Text>
      ) : null}

      <NavigationLink destination={<BookDetailPage bookId={note.bookId} title={note.bookTitle} author={note.bookAuthor} />}>
        <HStack spacing={10} padding={{ top: 16 }}>
          <Cover bookId={note.bookId} url={note.bookCover} width={26} height={36} radius={3} />
          <VStack alignment="leading" spacing={1} frame={{ maxWidth: "infinity", alignment: "leading" }}>
            <Text font={13} fontWeight="medium" lineLimit={1} foregroundStyle="label">{note.bookTitle}</Text>
            <Text font={11} foregroundStyle="secondaryLabel" lineLimit={1}>{note.bookAuthor}</Text>
          </VStack>
          <Image systemName="chevron.right" font={12} foregroundStyle="tertiaryLabel" />
        </HStack>
      </NavigationLink>
    </VStack>
  )
}

// ===== 书架 =====

function ShelfPage() {
  const dismiss = Navigation.useDismiss()
  const [books, setBooks] = useState<NotebookEntry[]>(() => loadBooks())
  const [search, setSearch] = useState("")
  const [syncing, setSyncing] = useState(false)
  const syncingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [showSearch, setShowSearch] = useState(false)
  const [onlyNotes, setOnlyNotes] = useState(false)
  const [lastSync, setLastSync] = useState(() => {
    const s = Storage.get(K_SYNC)
    return typeof s === "string" ? Number(s) : 0
  })

  async function sync(full = false) {
    const key = getApiKey()
    if (!key || syncingRef.current) return
    syncingRef.current = true
    setSyncing(true)
    setError(null)
    setMsg("正在获取书目…")
    try {
      setMsg("正在获取书架与笔记…")
      const [shelf, nbResult] = await Promise.all([
        Weread.getShelf(key),
        Weread.getAllNotebooks(key),
      ])
      if (shelf.length === 0 && loadBooks().length > 0) {
        throw new Error("书架获取失败（返回为空），已保留本地数据")
      }
      const prevById = new Map(loadBooks().map((b) => [b.bookId, b]))
      const nbMap = new Map(nbResult.books.map((b) => [b.bookId, b]))

      // 以完整书架为底，合并笔记计数；笔记里多出来的书也保留
      const merged: NotebookEntry[] = []
      const seen = new Set<string>()
      for (const s of shelf) {
        seen.add(s.bookId)
        const nb = nbMap.get(s.bookId)
        merged.push({
          bookId: s.bookId,
          title: s.title || nb?.title || "",
          author: s.author || nb?.author || "",
          cover: s.cover || nb?.cover || "",
          reviewCount: nb ? nb.reviewCount : prevById.get(s.bookId)?.reviewCount || 0,
          noteCount: nb ? nb.noteCount : prevById.get(s.bookId)?.noteCount || 0,
          bookmarkCount: nb ? nb.bookmarkCount : prevById.get(s.bookId)?.bookmarkCount || 0,
          readingProgress: nb?.readingProgress || 0,
          markedStatus: s.finishReading ? 1 : nb?.markedStatus || 0,
          sort: nb && nb.sort ? nb.sort : s.readUpdateTime,
        })
      }
      for (const nb of nbResult.books) {
        if (seen.has(nb.bookId)) continue
        merged.push(nb)
      }

      merged.sort((a, b) => (b.sort || 0) - (a.sort || 0))
      saveBooks(merged)
      setBooks(merged)
      const now = Date.now()
      setLastSync(now)
      Storage.set(K_SYNC, String(now))
      const withNotes = merged.filter((b) => noteTotal(b) > 0).length
      setMsg(`书架 ${merged.length} 本 · 有笔记 ${withNotes} 本`)
      if (full) {
        // 后台预下载（不阻塞界面）
        preload(merged.filter((b) => noteTotal(b) > 0).slice(0, 40))
      }
    } catch (e: any) {
      setError(e?.message || "同步失败")
    } finally {
      syncingRef.current = false
      setSyncing(false)
    }
  }

  async function preload(list: NotebookEntry[]) {
    const key = getApiKey()
    if (!key) return
    let i = 0
    for (const b of list) {
      i++
      try {
        if (loadNotes(b.bookId).length === 0 && !loadFetched()[b.bookId]) {
          const r = await Weread.getBookNotes(key, b.bookId)
          saveNotes(b.bookId, r.notes)
          if (!r.reviewsFailed) markFetched(b.bookId)
        }
      } catch {
        // 单本失败不中断
      }
      if (i % 3 === 0) {
        setMsg(`后台缓存笔记 ${i}/${list.length}`)
        await new Promise<void>((res) => { setTimeout(() => res(), 1) })
      }
    }
    setMsg(`笔记缓存完成（最近 ${list.length} 本）`)
  }

  const hasN = (b: NotebookEntry) => noteTotal(b) > 0
  const withNotesCount = books.filter(hasN).length
  const filtered = books
    .filter((b) => (onlyNotes ? hasN(b) : true))
    .filter((b) => {
      const q = search.trim().toLowerCase()
      if (!q) return true
      return b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q)
    })
  const totalNotes = books.reduce((s, b) => s + noteTotal(b), 0)


  return (
    <PageShell>
      <ScrollView
        toolbar={{
          topBarLeading: <CloseButton onTap={dismiss} />,
          topBarTrailing: (
            <Button action={() => sync(true)}>
              {syncing ? <ProgressView /> : <Image systemName="arrow.clockwise" />}
            </Button>
          ),
        }}
      >
        <VStack
          alignment="leading"
          spacing={0}
          padding={{ bottom: 32 }}
          sheet={
            showSearch
              ? {
                  isPresented: true,
                  onChanged: (v: boolean) => setShowSearch(v),
                  content: <SearchPage initialKeyword={search} onClose={() => setShowSearch(false)} />,
                }
              : undefined
          }
        >
          <Text font={13} foregroundStyle="secondaryLabel" padding={{ horizontal: 20, top: 4, bottom: 10 }}>
            {books.length} 本 · 有笔记 {withNotesCount} 本 · {totalNotes} 条
            {lastSync > 0 ? ` · 上次同步 ${fmtStamp(lastSync)}` : ""}
          </Text>

          <HStack spacing={8} padding={{ horizontal: 20, bottom: 12 }}>
            <Chip label={`全部 ${books.length}`} active={!onlyNotes} onTap={() => setOnlyNotes(false)} />
            <Chip label={`有笔记 ${withNotesCount}`} active={onlyNotes} onTap={() => setOnlyNotes(true)} />
          </HStack>

          <VStack padding={{ horizontal: 20, bottom: 14 }}>
            <HStack spacing={8} padding={{ horizontal: 12, vertical: 10 }} background={CARD_BG} clipShape={{ type: "rect", cornerRadius: 12 }} frame={{ maxWidth: "infinity" }}>
              <Image systemName="magnifyingglass" font={15} foregroundStyle="tertiaryLabel" />
              <TextField title="搜索" prompt="搜索书名或作者" value={search} onChanged={setSearch} frame={{ maxWidth: "infinity" }} />
            </HStack>
          </VStack>

          {error ? (
            <Text font={13} foregroundStyle="systemRed" padding={{ horizontal: 20, top: 8 }}>{error}</Text>
          ) : null}
          {msg ? (
            <Text font={12} foregroundStyle="secondaryLabel" padding={{ horizontal: 20, top: 8 }}>{msg}</Text>
          ) : null}

          {books.length > 0 && !onlyNotes && filtered.length === 0 && search.trim().length > 0 ? (
            <Notice
              icon="magnifyingglass"
              title="书架里没有"
              message={`“${search.trim()}”不在你的书架上，试试在书城搜`}
              action={<PrimaryButton title="在书城搜索" icon="text.magnifyingglass" onTap={() => setShowSearch(true)} />}
            />
          ) : null}

          {books.length === 0 && !syncing ? (
            <Notice
              icon="books.vertical"
              title="书架是空的"
              message={"点右上角同步，\n把微信读书的笔记拉下来"}
              action={<PrimaryButton title="同步" icon="arrow.clockwise" onTap={() => sync(true)} />}
            />
          ) : (
            <VStack padding={{ horizontal: 16 }}>
              <LazyVGrid columns={GRID_COLUMNS} spacing={18} alignment="center">
              {filtered.map((b) => {
                const total = noteTotal(b)
                return (
                  <NavigationLink key={b.bookId} destination={<BookDetailPage bookId={b.bookId} title={b.title} author={b.author} />}>
                    <VStack alignment="leading" spacing={6}>
                      <Cover bookId={b.bookId} url={b.cover} width={96} height={136} radius={6} />
                      <Text font={13} fontWeight="medium" lineLimit={2} foregroundStyle="label" multilineTextAlignment="leading" frame={{ width: 96 }}>{b.title || "未命名"}</Text>
                      <Text font={11} foregroundStyle={total > 0 ? "tertiaryLabel" : "quaternaryLabel"}>
                        {total > 0 ? `${total} 条` : "无笔记"}
                      </Text>
                    </VStack>
                  </NavigationLink>
                )
              })}
            </LazyVGrid>
            </VStack>
          )}
        </VStack>
      </ScrollView>
    </PageShell>
  )
}

// ===== 书详情 =====

function BookDetailPage({ bookId, title, author }: { bookId: string; title: string; author: string }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<"all" | "highlight" | "review">("all")
  const [best, setBest] = useState<Weread.BestBookmark[]>([])
  const [info, setInfo] = useState<Weread.BookDetail | null>(null)
  const [showIntro, setShowIntro] = useState(false)
  const [progress, setProgress] = useState<Weread.BookProgress | null>(null)
  const [similar, setSimilar] = useState<Weread.RecommendItem[]>([])
  const [showChapters, setShowChapters] = useState(false)
  const [hot, setHot] = useState<Weread.BestBookmark | null>(null)

  useEffect(() => {
    let alive = true
    async function load() {
      const key = getApiKey()
      if (!key) {
        setLoading(false)
        return
      }

      const cached = loadNotes(bookId)
      if (cached.length > 0) {
        if (alive) {
          setNotes(cached)
          setLoading(false)
        }
      } else {
        try {
          const r = await Weread.getBookNotes(key, bookId)
          saveNotes(bookId, r.notes)
          if (!r.reviewsFailed) markFetched(bookId)
          if (alive) setNotes(r.notes)
        } catch (e: any) {
          if (alive) setError(e?.message || "加载失败")
        } finally {
          if (alive) setLoading(false)
        }
      }

      // 热门划线：全站被划次数最多的句子
      try {
        const b = await Weread.getBestBookmarks(key, bookId)
        if (alive) setBest(b)
      } catch {
        // ignore
      }

      // 书籍详情
      try {
        const i = await Weread.getBookInfo(key, bookId)
        if (alive) setInfo(i)
      } catch {
        // ignore
      }

      // 阅读进度 + 相似书
      try {
        const p = await Weread.getProgress(key, bookId)
        if (alive) setProgress(p)
      } catch {
        // ignore
      }
      try {
        const s = await Weread.getSimilar(key, bookId, 12, 0)
        if (alive) setSimilar(s.filter((x) => x.bookId))
      } catch {
        // ignore
      }
    }
    load()
    return () => {
      alive = false
    }
  }, [bookId])

  const hCount = notes.filter((n) => n.kind === "highlight").length
  const rCount = notes.filter((n) => n.kind === "review").length
  const shownTitle = title || (info && info.title) || "未命名"
  const shownAuthor = author || (info && info.author) || ""
  const shown = filter === "all" ? notes : notes.filter((n) => n.kind === filter)
  const intro = (info && info.intro ? info.intro : "").trim()
  const chapterNames: Record<number, string> = {}
  for (const n of notes) {
    if (n.chapter && n.chapterUid && !chapterNames[n.chapterUid]) chapterNames[n.chapterUid] = n.chapter
  }

  return (
    <PageShell>
      <ScrollView>
        <VStack
          alignment="leading"
          spacing={0}
          padding={{ bottom: 32 }}
          sheet={
            showChapters
              ? {
                  isPresented: true,
                  onChanged: (v: boolean) => setShowChapters(v),
                  content: <ChapterSheet bookId={bookId} notes={notes} onClose={() => setShowChapters(false)} />,
                }
              : hot
              ? {
                  isPresented: true,
                  onChanged: (v: boolean) => {
                    if (!v) setHot(null)
                  },
                  content: (
                    <HotThoughtsSheet
                      bookId={bookId}
                      chapterUid={hot.chapterUid}
                      range={hot.range}
                      markText={hot.markText}
                      total={hot.totalCount}
                      onClose={() => setHot(null)}
                    />
                  ),
                }
              : undefined
          }
        >
          <HStack spacing={14} padding={{ horizontal: 20, top: 10, bottom: 18 }}>
            <Cover bookId={bookId} width={78} height={110} radius={8} />
            <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" }}>
              <Text font={19} fontWeight="bold" lineLimit={3}>{shownTitle}</Text>
              <Text font={13} foregroundStyle="secondaryLabel">{shownAuthor}</Text>
              <HStack spacing={10} padding={{ top: 4 }}>
                <Text font={12} foregroundStyle={ACCENT}>{hCount} 划线</Text>
                <Text font={12} foregroundStyle="systemOrange">{rCount} 想法</Text>
              </HStack>
              <Button action={() => Safari.openURL(Weread.bookLink(bookId))}>
                <HStack spacing={4} padding={{ top: 6 }}>
                  <Image systemName="arrow.up.forward.app" font={12} foregroundStyle={ACCENT} />
                  <Text font={12} foregroundStyle={ACCENT}>在微信读书打开</Text>
                </HStack>
              </Button>
            </VStack>
          </HStack>

          {info ? (
            <VStack padding={{ horizontal: 16, bottom: 16 }}>
              <VStack alignment="leading" spacing={10} padding={14} background={CARD_BG} clipShape={{ type: "rect", cornerRadius: 18 }}>
                <HStack spacing={16}>
                  {info.newRating > 0 ? (
                    <VStack alignment="leading" spacing={1}>
                      <Text font={17} fontWeight="bold" foregroundStyle="systemOrange">{(info.newRating / 10).toFixed(1)}%</Text>
                      <Text font={10} foregroundStyle="tertiaryLabel">推荐值</Text>
                    </VStack>
                  ) : null}
                  {info.wordCount > 0 ? (
                    <VStack alignment="leading" spacing={1}>
                      <Text font={17} fontWeight="bold">{fmtWord(info.wordCount)}</Text>
                      <Text font={10} foregroundStyle="tertiaryLabel">篇幅</Text>
                    </VStack>
                  ) : null}
                  {info.newRatingCount > 0 ? (
                    <VStack alignment="leading" spacing={1}>
                      <Text font={17} fontWeight="bold">{info.newRatingCount}</Text>
                      <Text font={10} foregroundStyle="tertiaryLabel">人点评</Text>
                    </VStack>
                  ) : null}
                  <Spacer />
                </HStack>
                {intro.length > 0 ? (
                  <Text font={12} foregroundStyle="secondaryLabel" lineSpacing={4} lineLimit={showIntro ? undefined : 3}>
                    {intro}
                  </Text>
                ) : null}
                {intro.length > 60 ? (
                  <Button action={() => setShowIntro(!showIntro)}>
                    <Text font={12} foregroundStyle={ACCENT}>{showIntro ? "收起" : "展开简介"}</Text>
                  </Button>
                ) : null}
                <NavigationLink destination={<ReviewsPage bookId={bookId} title={shownTitle} />}>
                  <HStack spacing={4} padding={{ top: 2 }}>
                    <Image systemName="text.bubble" font={12} foregroundStyle={ACCENT} />
                    <Text font={12} foregroundStyle={ACCENT}>看读者点评</Text>
                    <Image systemName="chevron.right" font={9} foregroundStyle={ACCENT} />
                  </HStack>
                </NavigationLink>
                {progress && progress.progress > 0 ? (
                  <HStack spacing={8} padding={{ top: 2 }}>
                    <Image systemName="book.pages" font={12} foregroundStyle="secondaryLabel" />
                    <Text font={12} foregroundStyle="secondaryLabel">阅读进度 {progress.progress}%</Text>
                    {progress.recordReadingTime > 0 ? (
                      <Text font={12} foregroundStyle="tertiaryLabel">· {fmtDur(progress.recordReadingTime)}</Text>
                    ) : null}
                    <Spacer />
                    <Button action={() => setShowChapters(true)}>
                      <HStack spacing={3}>
                        <Text font={12} foregroundStyle={ACCENT}>目录</Text>
                        <Image systemName="chevron.right" font={9} foregroundStyle={ACCENT} />
                      </HStack>
                    </Button>
                  </HStack>
                ) : (
                  <HStack spacing={4} padding={{ top: 2 }}>
                    <Button action={() => setShowChapters(true)}>
                      <HStack spacing={3}>
                        <Image systemName="list.bullet" font={11} foregroundStyle={ACCENT} />
                        <Text font={12} foregroundStyle={ACCENT}>目录</Text>
                      </HStack>
                    </Button>
                    <Spacer />
                  </HStack>
                )}
              </VStack>
            </VStack>
          ) : null}

          {!info ? (
            <VStack padding={{ horizontal: 16, bottom: 16 }}>
              <HStack spacing={20} padding={14} background={CARD_BG} clipShape={{ type: "rect", cornerRadius: 18 }}>
                <Button action={() => setShowChapters(true)}>
                  <HStack spacing={4}>
                    <Image systemName="list.bullet" font={12} foregroundStyle={ACCENT} />
                    <Text font={13} foregroundStyle={ACCENT}>目录</Text>
                  </HStack>
                </Button>
                <NavigationLink destination={<ReviewsPage bookId={bookId} title={shownTitle} />}>
                  <HStack spacing={4}>
                    <Image systemName="text.bubble" font={12} foregroundStyle={ACCENT} />
                    <Text font={13} foregroundStyle={ACCENT}>读者点评</Text>
                  </HStack>
                </NavigationLink>
                <Spacer />
              </HStack>
            </VStack>
          ) : null}

          <HStack spacing={8} padding={{ horizontal: 20, bottom: 16 }}>
            <Chip label="全部" active={filter === "all"} onTap={() => setFilter("all")} />
            <Chip label="划线" active={filter === "highlight"} onTap={() => setFilter("highlight")} />
            <Chip label="想法" active={filter === "review"} onTap={() => setFilter("review")} />
          </HStack>

          <HotSection
            best={best}
            chapterNames={chapterNames}
            onOpen={(b) => setHot(b)}
            onExternal={(b) => Safari.openURL(Weread.highlightLink(bookId, b.chapterUid, b.range))}
          />

          {loading ? (
            <VStack frame={{ maxWidth: "infinity" }} padding={{ vertical: 50 }} alignment="center" spacing={10}>
              <ProgressView />
              <Text font={13} foregroundStyle="secondaryLabel">加载笔记…</Text>
            </VStack>
          ) : error && notes.length === 0 ? (
            <Text font={13} foregroundStyle="systemRed" padding={{ horizontal: 20 }}>{error}</Text>
          ) : shown.length === 0 ? (
            <Notice icon="quote.opening" title="没有内容" message="这本书还没有划线或想法" />
          ) : (
            <LazyVStack alignment="leading" spacing={12}>
              {shown.map((n) => (
                <VStack key={n.id} alignment="leading" spacing={0} padding={{ horizontal: 16 }}>
                  <NoteCard note={n} />
                </VStack>
              ))}
            </LazyVStack>
          )}

          {similar.length > 0 ? (
            <VStack alignment="leading" spacing={10} padding={{ horizontal: 16, top: 22 }}>
              <HStack spacing={6} padding={{ horizontal: 4 }}>
                <Image systemName="sparkles" font={12} foregroundStyle={ACCENT} />
                <Text font={13} fontWeight="semibold" foregroundStyle="secondaryLabel">相似的书</Text>
              </HStack>
              <ScrollView axes="horizontal">
                <HStack spacing={12}>
                  {similar.map((s) => (
                    <NavigationLink key={s.bookId} destination={<BookDetailPage bookId={s.bookId} title={s.title} author={s.author} />}>
                      <VStack alignment="leading" spacing={5} frame={{ width: 84 }}>
                        <Cover bookId={s.bookId} url={s.cover} width={84} height={120} radius={6} />
                        <Text font={11} lineLimit={2} foregroundStyle="label">{s.title}</Text>
                        <Text font={10} lineLimit={1} foregroundStyle="tertiaryLabel">{s.author}</Text>
                      </VStack>
                    </NavigationLink>
                  ))}
                </HStack>
              </ScrollView>
            </VStack>
          ) : null}
        </VStack>
      </ScrollView>
    </PageShell>
  )
}

// ===== 我的 =====

function ProfilePage({ onLogout, dismiss }: { onLogout: () => void; dismiss: () => void }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [stats, setStats] = useState<Weread.ReadStats | null>(null)
  const [mode, setMode] = useState<Weread.ReadMode>("monthly")
  const [counts, setCounts] = useState(() => {
    const books = loadBooks()
    return {
      books: books.length,
      notes: books.reduce((s, b) => s + noteTotal(b), 0),
    }
  })
  const [showRecommend, setShowRecommend] = useState(false)
  const [showDiag, setShowDiag] = useState(false)

  useEffect(() => {
    loadStats()
  }, [mode])

  async function loadStats() {
    const books = loadBooks()
    setCounts({
      books: books.length,
      notes: books.reduce((s, b) => s + noteTotal(b), 0),
    })
    const k = getApiKey()
    if (!k) return
    try {
      setStats(await Weread.getReadStatsByMode(k, mode))
    } catch {
      // ignore
    }
  }

  async function save() {
    if (busy) return
    const input = await Dialog.prompt({
      title: "更换 API Key",
      message: "粘贴从微信读书获取的 wrk- 开头的 Key",
      placeholder: "wrk-…",
      confirmLabel: "验证",
      cancelLabel: "取消",
    })
    if (!input || !input.trim()) return
    setBusy(true)
    setMsg(null)
    try {
      await Weread.validateKey(input.trim())
      setApiKey(input)
      setMsg("已保存并验证通过")
      loadStats()
    } catch (e: any) {
      setMsg(e?.message || "验证失败")
    } finally {
      setBusy(false)
    }
  }

  function clearCache() {
    for (const b of loadBooks()) Storage.remove(K_NOTES_PREFIX + b.bookId)
    Storage.remove(K_BOOKS)
    Storage.remove(K_FETCHED)
    Storage.remove(K_SYNC)
    __allNotesCache = null
    setCounts({ books: 0, notes: 0 })
    setMsg("缓存已清空")
  }

  function logout() {
    Keychain.remove(KCM_KEY)
    clearCache()
    onLogout()
  }

  const statItems = [
    { label: "书目", value: `${counts.books}`, unit: "本" },
    { label: "笔记", value: `${counts.notes}`, unit: "条" },
    { label: MODE_LABEL[mode], value: stats ? fmtDurShort(stats.totalReadTime) : "—", unit: "" },
  ]

  return (
    <PageShell>
      <ScrollView toolbar={{ topBarLeading: <CloseButton onTap={dismiss} /> }}>
        <VStack
          alignment="leading"
          spacing={16}
          padding={{ horizontal: 20, top: 6, bottom: 32 }}
          sheet={
            showRecommend
              ? {
                  isPresented: true,
                  onChanged: (v: boolean) => setShowRecommend(v),
                  content: <RecommendPage onClose={() => setShowRecommend(false)} />,
                }
              : showDiag
              ? {
                  isPresented: true,
                  onChanged: (v: boolean) => setShowDiag(v),
                  content: <ApiDiagPage onClose={() => setShowDiag(false)} />,
                }
              : undefined
          }
        >
          <HStack spacing={8} padding={{ top: 2 }}>
            <Chip label="本周" active={mode === "weekly"} onTap={() => setMode("weekly")} />
            <Chip label="本月" active={mode === "monthly"} onTap={() => setMode("monthly")} />
            <Chip label="今年" active={mode === "annually"} onTap={() => setMode("annually")} />
            <Chip label="全部" active={mode === "overall"} onTap={() => setMode("overall")} />
          </HStack>

          <HStack spacing={10}>
            {statItems.map((s) => (
              <VStack key={s.label} alignment="leading" spacing={3} padding={14} frame={{ maxWidth: "infinity", alignment: "leading" }} background={CARD_BG} clipShape={{ type: "rect", cornerRadius: 16 }}>
                <Text font={11} foregroundStyle="secondaryLabel">{s.label}</Text>
                <HStack spacing={2} alignment="firstTextBaseline">
                  <Text font={16} fontWeight="bold" lineLimit={1}>{s.value}</Text>
                  {s.unit ? <Text font={11} foregroundStyle="tertiaryLabel">{s.unit}</Text> : null}
                </HStack>
              </VStack>
            ))}
          </HStack>

          {mode === "overall" && stats ? (
            <Text font={11} foregroundStyle="tertiaryLabel" padding={{ top: -6 }}>
              读过 {stats.booksRead} 本 · 读完 {stats.booksFinished} 本 · 阅读 {stats.readDays} 天
              {stats.preferWord ? ` · ${stats.preferWord}` : ""}
            </Text>
          ) : null}

          <VStack alignment="leading" spacing={12} padding={16} background={CARD_BG} clipShape={{ type: "rect", cornerRadius: 18 }}>
            <HStack spacing={8}>
              <Image systemName="key.fill" font={13} foregroundStyle={ACCENT} />
              <Text font={14} fontWeight="semibold">微信读书连接</Text>
              <Spacer />
              <Text font={12} foregroundStyle="systemGreen">已连接</Text>
            </HStack>
            <HStack spacing={18}>
              <Button action={save}>
                <HStack spacing={5} padding={{ vertical: 4 }}>
                  {busy ? <ProgressView /> : null}
                  <Text font={14} fontWeight="medium" foregroundStyle={ACCENT}>{busy ? "验证中…" : "更换 Key"}</Text>
                </HStack>
              </Button>
              <Button action={() => Safari.openURL(Weread.WEREAD_KEY_URL)}>
                <Text font={14} fontWeight="medium" foregroundStyle={ACCENT}>获取 Key →</Text>
              </Button>
              <Spacer />
            </HStack>
            {msg ? (
              <Text font={12} foregroundStyle={msg.includes("通过") ? "systemGreen" : "systemRed"}>{msg}</Text>
            ) : null}
          </VStack>

          <VStack alignment="leading" spacing={0} background={CARD_BG} clipShape={{ type: "rect", cornerRadius: 18 }}>
            <Button action={() => setShowRecommend(true)}>
              <HStack frame={{ maxWidth: "infinity" }} padding={{ horizontal: 16, vertical: 14 }}>
                <Image systemName="sparkles" font={13} foregroundStyle={ACCENT} />
                <Text font={15} padding={{ leading: 8 }}>为你推荐</Text>
                <Spacer />
                <Image systemName="chevron.right" font={11} foregroundStyle="tertiaryLabel" />
              </HStack>
            </Button>
            <Rectangle fill="systemGray5" frame={{ height: 0.5, maxWidth: "infinity" }} padding={{ horizontal: 16 }} />
            <Button action={() => setShowDiag(true)}>
              <HStack frame={{ maxWidth: "infinity" }} padding={{ horizontal: 16, vertical: 14 }}>
                <Image systemName="bolt.horizontal.circle" font={13} foregroundStyle={ACCENT} />
                <Text font={15} padding={{ leading: 8 }}>接口诊断</Text>
                <Spacer />
                <Image systemName="chevron.right" font={11} foregroundStyle="tertiaryLabel" />
              </HStack>
            </Button>
          </VStack>

          <VStack alignment="leading" spacing={0} background={CARD_BG} clipShape={{ type: "rect", cornerRadius: 18 }}>
            <Button action={clearCache}>
              <HStack frame={{ maxWidth: "infinity" }} padding={{ horizontal: 16, vertical: 14 }}>
                <Text font={15}>清空本地缓存</Text>
                <Spacer />
                <Image systemName="trash" font={13} foregroundStyle="tertiaryLabel" />
              </HStack>
            </Button>
            <Rectangle fill="systemGray4" frame={{ height: 1, maxWidth: "infinity" }} padding={{ horizontal: 16 }} />
            <Button action={logout}>
              <HStack frame={{ maxWidth: "infinity" }} padding={{ horizontal: 16, vertical: 14 }}>
                <Text font={15} foregroundStyle="systemRed">退出登录</Text>
                <Spacer />
                <Image systemName="rectangle.portrait.and.arrow.right" font={13} foregroundStyle="systemRed" />
              </HStack>
            </Button>
          </VStack>

          <Text font={11} foregroundStyle="tertiaryLabel" padding={{ top: 4 }} lineSpacing={3}>
            Inkling v{__rnVersion} · 数据来源：微信读书官方 API{"\n"}所有笔记只保存在本机
          </Text>
        </VStack>
      </ScrollView>
    </PageShell>
  )
}

// ===== 热门划线区块 =====

function HotSection({
  best,
  chapterNames,
  onOpen,
  onExternal,
}: {
  best: Weread.BestBookmark[]
  chapterNames: Record<number, string>
  onOpen: (b: Weread.BestBookmark) => void
  onExternal: (b: Weread.BestBookmark) => void
}) {
  if (best.length === 0) return null
  return (
    <VStack alignment="leading" spacing={0} padding={{ horizontal: 20, bottom: 16 }} frame={{ maxWidth: "infinity" }}>
      <HStack spacing={6} padding={{ bottom: 4 }}>
        <Image systemName="flame.fill" font={11} foregroundStyle="systemOrange" />
        <Text font={12} fontWeight="semibold" foregroundStyle="secondaryLabel">大家都在划</Text>
        <Spacer />
        <Text font={11} foregroundStyle="tertiaryLabel">{best.length} 条</Text>
      </HStack>

      {best.map((b, i) => (
        <VStack
          key={b.bookmarkId || i}
          alignment="leading"
          spacing={5}
          padding={{ vertical: 12 }}
          frame={{ maxWidth: "infinity", alignment: "leading" }}
        >
          <HStack alignment="top" spacing={8} frame={{ maxWidth: "infinity" }} onTapGesture={() => onOpen(b)}>
            <Text font={12} fontWeight="medium" foregroundStyle={i === 0 ? "systemOrange" : "tertiaryLabel"} frame={{ width: 16 }} lineLimit={1}>
              {i + 1}
            </Text>
            <Text font={14} lineSpacing={6} foregroundStyle="label" frame={{ maxWidth: "infinity", alignment: "leading" }}>
              {b.markText}
            </Text>
          </HStack>

          <HStack spacing={6} padding={{ leading: 24 }} frame={{ maxWidth: "infinity" }}>
            <Text font={11} foregroundStyle="tertiaryLabel" lineLimit={1} frame={{ maxWidth: "infinity", alignment: "leading" }}>
              {chapterNames[b.chapterUid] || ""}
            </Text>
            <Text font={11} foregroundStyle="systemOrange">{b.totalCount} 人</Text>
            <Button action={() => onExternal(b)}>
              <Image systemName="arrow.up.right" font={9} foregroundStyle={ACCENT} frame={{ width: 20, height: 20 }} />
            </Button>
          </HStack>

          {i < best.length - 1 ? (
            <Rectangle fill="systemGray5" frame={{ height: 0.5, maxWidth: "infinity" }} padding={{ leading: 24, top: 6 }} />
          ) : null}
        </VStack>
      ))}
    </VStack>
  )
}

// ===== 读者点评 =====

const REVIEW_TYPES: { key: number; label: string }[] = [
  { key: 0, label: "全部" },
  { key: 1, label: "推荐" },
  { key: 4, label: "一般" },
  { key: 2, label: "不行" },
  { key: 3, label: "最新" },
]

function Stars({ n }: { n: number }) {
  if (n <= 0) return null
  return (
    <Text font={11} foregroundStyle="systemOrange">{"★".repeat(Math.max(1, Math.round(n))) + "☆".repeat(Math.max(0, 5 - Math.round(n)))}</Text>
  )
}

function ReviewsPage({ bookId, title }: { bookId: string; title: string }) {
  const [type, setType] = useState(0)
  const [items, setItems] = useState<Weread.PublicReview[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    async function load() {
      const key = getApiKey()
      if (!key) {
        setLoading(false)
        return
      }
      setLoading(true)
      setErr(null)
      try {
        const r = await Weread.getPublicReviews(key, bookId, type, 0)
        if (!alive) return
        setItems(r.items)
        setMore(r.hasMore)
        setTotal(r.total)
      } catch (e: any) {
        if (alive) setErr(e?.message || "加载失败")
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => {
      alive = false
    }
  }, [bookId, type])

  async function loadMore() {
    const key = getApiKey()
    if (!key || items.length === 0 || loading) return
    const lastIdx = items[items.length - 1].idx
    if (!lastIdx) {
      setMore(false)
      return
    }
    setLoading(true)
    try {
      const r = await Weread.getPublicReviews(key, bookId, type, lastIdx)
      setItems((prev) => {
        const seen = new Set(prev.map((x) => x.reviewId || x.idx))
        return prev.concat(r.items.filter((x) => !seen.has(x.reviewId || x.idx)))
      })
      setMore(r.hasMore)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  return (
    <PageShell>
      <ScrollView>
        <VStack alignment="leading" spacing={0} padding={{ bottom: 32 }}>
          <HStack spacing={8} padding={{ horizontal: 20, top: 6, bottom: 12 }}>
            <VStack alignment="leading" spacing={2}>
              <Text font={20} fontWeight="bold" lineLimit={1}>{title}</Text>
              <Text font={12} foregroundStyle="secondaryLabel">{total > 0 ? `${total} 条读者点评` : "读者点评"}</Text>
            </VStack>
            <Spacer />
            <Button action={() => Safari.openURL(Weread.bookLink(bookId))}>
              <Image systemName="arrow.up.forward.app" font={15} foregroundStyle={ACCENT} frame={{ width: 34, height: 34 }} background={CARD_BG} clipShape={{ type: "capsule", style: "continuous" }} />
            </Button>
          </HStack>

          <ScrollView axes="horizontal">
            <HStack spacing={8} padding={{ horizontal: 20, bottom: 14 }}>
              {REVIEW_TYPES.map((t) => (
                <Chip key={t.key} label={t.label} active={type === t.key} onTap={() => setType(t.key)} />
              ))}
            </HStack>
          </ScrollView>

          {loading && items.length === 0 ? (
            <VStack frame={{ maxWidth: "infinity" }} padding={{ vertical: 50 }} alignment="center" spacing={10}>
              <ProgressView />
              <Text font={13} foregroundStyle="secondaryLabel">加载点评…</Text>
            </VStack>
          ) : err ? (
            <Text font={13} foregroundStyle="systemRed" padding={{ horizontal: 20 }}>{err}</Text>
          ) : items.length === 0 ? (
            <Notice icon="text.bubble" title="没有点评" message="换个筛选条件看看" />
          ) : (
            <LazyVStack alignment="leading" spacing={12}>
              {items.map((r) => (
                <VStack key={r.reviewId || r.idx} alignment="leading" spacing={8} padding={{ horizontal: 16 }}>
                  <VStack alignment="leading" spacing={8} padding={16} frame={{ maxWidth: "infinity", alignment: "leading" }} background={CARD_BG} clipShape={{ type: "rect", cornerRadius: 18 }}>
                    <HStack spacing={8}>
                      <Text font={12} fontWeight="semibold">{r.authorName}</Text>
                      <Stars n={r.star} />
                      <Spacer />
                      <Text font={11} foregroundStyle="tertiaryLabel">{fmtDate(r.createTime)}</Text>
                    </HStack>
                    {r.chapterName ? <Text font={11} foregroundStyle="tertiaryLabel">{r.chapterName}</Text> : null}
                    <Text font={14} lineSpacing={6} foregroundStyle="label">{r.content}</Text>
                    <HStack spacing={6}>
                      <Spacer />
                      <Button action={() => copyText(r.content)}>
                        <HStack spacing={3}>
                          <Image systemName="doc.on.doc" font={10} foregroundStyle={ACCENT} />
                          <Text font={11} foregroundStyle={ACCENT}>复制</Text>
                        </HStack>
                      </Button>
                    </HStack>
                  </VStack>
                </VStack>
              ))}
              {more ? (
                <VStack padding={{ horizontal: 16 }}>
                  <Button action={loadMore}>
                    <HStack frame={{ maxWidth: "infinity" }} padding={{ vertical: 12 }} background={CARD_BG} clipShape={{ type: "rect", cornerRadius: 14 }} alignment="center" spacing={6}>
                      {loading ? <ProgressView /> : null}
                      <Text font={13} foregroundStyle={ACCENT}>{loading ? "加载中…" : "加载更多"}</Text>
                    </HStack>
                  </Button>
                </VStack>
              ) : null}
            </LazyVStack>
          )}
        </VStack>
      </ScrollView>
    </PageShell>
  )
}

// ===== 搜索 =====

function SearchPage({ onClose, initialKeyword }: { onClose: () => void; initialKeyword?: string }) {
  const [kw, setKw] = useState(initialKeyword || "")
  const [scope, setScope] = useState<10 | 12>(10)
  const [items, setItems] = useState<Weread.SearchItem[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const lastQuery = useState<{ v: string }>(() => ({ v: "" }))[0]

  useEffect(() => {
    if ((initialKeyword || "").trim()) void run()
  }, [])

  async function run() {
    const q = kw.trim()
    if (!q) return
    const key = getApiKey()
    if (!key) return
    lastQuery.v = q
    setLoading(true)
    setErr(null)
    setSearched(true)
    try {
      const r = await Weread.searchBooks(key, q, scope)
      setItems(r.items)
    } catch (e: any) {
      setErr(e?.message || "搜索失败")
    } finally {
      setLoading(false)
    }
  }

  return (
    <NavigationStack>
      <PageShell>
        <ScrollView toolbar={{ cancellationAction: <Button title="关闭" action={onClose} /> }}>
          <VStack alignment="leading" spacing={0} padding={{ bottom: 32 }} navigationTitle="搜索" navigationBarTitleDisplayMode="inline">
            <VStack padding={{ horizontal: 20, top: 10, bottom: 12 }}>
              <HStack spacing={8} padding={{ horizontal: 12, vertical: 10 }} background={CARD_BG} clipShape={{ type: "rect", cornerRadius: 12 }} frame={{ maxWidth: "infinity" }}>
                <Image systemName="magnifyingglass" font={15} foregroundStyle="tertiaryLabel" />
                <TextField title="关键词" prompt={scope === 10 ? "搜书名或作者" : "搜书里的句子"} value={kw} onChanged={setKw} onBlur={() => { if (kw.trim() && kw.trim() !== lastQuery.v) void run() }} frame={{ maxWidth: "infinity" }} />
                <Button action={run}>
                  <Text font={13} fontWeight="semibold" foregroundStyle={ACCENT}>搜索</Text>
                </Button>
              </HStack>
            </VStack>

            <HStack spacing={8} padding={{ horizontal: 20, bottom: 14 }}>
              <Chip label="书名" active={scope === 10} onTap={() => { setScope(10); setItems([]); setSearched(false) }} />
              <Chip label="全文" active={scope === 12} onTap={() => { setScope(12); setItems([]); setSearched(false) }} />
            </HStack>

            {loading ? (
              <VStack frame={{ maxWidth: "infinity" }} padding={{ vertical: 40 }} alignment="center" spacing={10}>
                <ProgressView />
                <Text font={13} foregroundStyle="secondaryLabel">搜索中…</Text>
              </VStack>
            ) : err ? (
              <Text font={13} foregroundStyle="systemRed" padding={{ horizontal: 20 }}>{err}</Text>
            ) : !searched ? (
              <Notice icon="magnifyingglass" title="搜点什么" message={scope === 10 ? "输入书名或作者，从书城找书" : "输入一句话，找到划过它的人"} />
            ) : items.length === 0 ? (
              <Notice icon="magnifyingglass" title="没有结果" message="换个关键词试试" />
            ) : (
              <LazyVStack alignment="leading" spacing={10}>
                {items.map((it) => (
                  <NavigationLink key={it.bookId} destination={<BookDetailPage bookId={it.bookId} title={it.title} author={it.author} />}>
                    <HStack spacing={12} padding={{ horizontal: 16, vertical: 6 }}>
                      <Cover bookId={it.bookId} url={it.cover} width={44} height={62} radius={5} />
                      <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                        <Text font={14} fontWeight="medium" lineLimit={1} foregroundStyle="label">{it.title}</Text>
                        <Text font={12} foregroundStyle="secondaryLabel" lineLimit={1}>{it.author}</Text>
                        <HStack spacing={8}>
                          {it.newRating > 0 ? <Text font={11} foregroundStyle="systemOrange">{(it.newRating / 10).toFixed(1)}%</Text> : null}
                          {it.readingCount > 0 ? <Text font={11} foregroundStyle="tertiaryLabel">{it.readingCount} 人在读</Text> : null}
                        </HStack>
                      </VStack>
                      <Image systemName="chevron.right" font={11} foregroundStyle="tertiaryLabel" />
                    </HStack>
                  </NavigationLink>
                ))}
              </LazyVStack>
            )}
          </VStack>
        </ScrollView>
      </PageShell>
    </NavigationStack>
  )
}

// ===== 目录 / 划线想法 / 推荐 / 接口诊断 =====

function SheetHeader({ title, sub, onClose }: { title: string; sub?: string; onClose: () => void }) {
  return (
    <HStack spacing={10} padding={{ horizontal: 18, top: 18, bottom: 12 }}>
      <VStack alignment="leading" spacing={2}>
        <Text font={18} fontWeight="bold" lineLimit={1}>{title}</Text>
        {sub ? <Text font={12} foregroundStyle="secondaryLabel" lineLimit={1}>{sub}</Text> : null}
      </VStack>
      <Spacer />
      <Button action={onClose}>
        <Image systemName="xmark" font={12} fontWeight="semibold" foregroundStyle="secondaryLabel" frame={{ width: 28, height: 28 }} background="tertiarySystemFill" clipShape={{ type: "capsule", style: "continuous" }} />
      </Button>
    </HStack>
  )
}

function ChapterSheet({ bookId, notes, onClose }: { bookId: string; notes: Note[]; onClose: () => void }) {
  const [chapters, setChapters] = useState<Weread.ChapterItem[]>([])
  const [loading, setLoading] = useState(true)
  const [openUid, setOpenUid] = useState<number | null>(null)
  const [heat, setHeat] = useState<Weread.UnderlineItem[]>([])
  const [heatLoading, setHeatLoading] = useState(false)

  useEffect(() => {
    let alive = true
    async function load() {
      const key = getApiKey()
      if (!key) {
        setLoading(false)
        return
      }
      const c = await Weread.getChapters(key, bookId)
      if (alive) {
        setChapters(c)
        setLoading(false)
      }
    }
    load()
    return () => {
      alive = false
    }
  }, [bookId])

  async function toggle(uid: number) {
    if (openUid === uid) {
      setOpenUid(null)
      return
    }
    setOpenUid(uid)
    setHeat([])
    const key = getApiKey()
    if (!key) return
    setHeatLoading(true)
    try {
      const u = await Weread.getChapterUnderlines(key, bookId, uid)
      setHeat(u.slice(0, 8))
    } finally {
      setHeatLoading(false)
    }
  }

  const countOf = (uid: number) => {
    const list = notes.filter((n) => n.chapterUid === uid)
    return { h: list.filter((n) => n.kind === "highlight").length, r: list.length - list.filter((n) => n.kind === "highlight").length }
  }

  return (
    <VStack alignment="leading" spacing={0} presentationDetents={[620]} presentationDragIndicator="visible" background={PAGE_BG}>
      <SheetHeader title="目录" sub={chapters.length > 0 ? `${chapters.length} 章` : "加载中…"} onClose={onClose} />
      {loading ? (
        <VStack frame={{ maxWidth: "infinity" }} padding={{ vertical: 40 }} alignment="center"><ProgressView /></VStack>
      ) : chapters.length === 0 ? (
        <Notice icon="list.bullet" title="没有目录" message="这本书可能没有获取到章节信息" />
      ) : (
        <ScrollView>
          <LazyVStack alignment="leading" spacing={0}>
            {chapters.map((c) => {
              const cnt = countOf(c.chapterUid)
              const open = openUid === c.chapterUid
              return (
                <VStack key={c.chapterUid} alignment="leading" spacing={0} padding={{ horizontal: 18 }}>
                  <HStack spacing={8} padding={{ vertical: 12 }} onTapGesture={() => toggle(c.chapterUid)}>
                    <Text font={14} lineLimit={1} foregroundStyle="label" frame={{ maxWidth: "infinity" }}>{c.title}</Text>
                    {cnt.h + cnt.r > 0 ? (
                      <Text font={11} foregroundStyle={ACCENT}>{cnt.h} 划 · {cnt.r} 想</Text>
                    ) : null}
                    <Image systemName={open ? "chevron.up" : "chevron.down"} font={10} foregroundStyle="tertiaryLabel" />
                  </HStack>
                  {open ? (
                    <VStack alignment="leading" spacing={6} padding={{ bottom: 12 }}>
                      {heatLoading ? <ProgressView /> : heat.length === 0 ? (
                        <Text font={12} foregroundStyle="tertiaryLabel">该章暂无热门划线数据</Text>
                      ) : (
                        heat.map((u, i) => (
                          <HStack key={u.range + i} spacing={8}>
                            <Text font={11} foregroundStyle="tertiaryLabel" frame={{ width: 22 }}>{i + 1}</Text>
                            <Text font={11} foregroundStyle="secondaryLabel">第 {i + 1} 处划得最多</Text>
                            <Spacer />
                            <Text font={11} foregroundStyle="systemOrange">{u.count} 人</Text>
                            <Button action={() => Safari.openURL(Weread.highlightLink(bookId, c.chapterUid, u.range))}>
                              <Text font={11} foregroundStyle={ACCENT}>去原文</Text>
                            </Button>
                          </HStack>
                        ))
                      )}
                    </VStack>
                  ) : null}
                  <Rectangle fill="systemGray5" frame={{ height: 0.5, maxWidth: "infinity" }} />
                </VStack>
              )
            })}
          </LazyVStack>
        </ScrollView>
      )}
    </VStack>
  )
}

function HotThoughtsSheet({
  bookId,
  chapterUid,
  range,
  markText,
  total,
  onClose,
}: {
  bookId: string
  chapterUid: number
  range: string
  markText: string
  total: number
  onClose: () => void
}) {
  const [items, setItems] = useState<Weread.ReadReviewItem[]>([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<Weread.SingleReview | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    let alive = true
    async function load() {
      const key = getApiKey()
      if (!key) {
        setLoading(false)
        return
      }
      const r = await Weread.getReadReviews(key, bookId, chapterUid, range)
      if (alive) {
        setItems(r)
        setLoading(false)
      }
    }
    load()
    return () => {
      alive = false
    }
  }, [bookId, chapterUid, range])

  async function openSingle(id: string) {
    const key = getApiKey()
    if (!key || !id) return
    setDetailLoading(true)
    try {
      const d = await Weread.getReviewSingle(key, id)
      setDetail(d)
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <VStack alignment="leading" spacing={0} presentationDetents={[620]} presentationDragIndicator="visible" background={PAGE_BG}>
      <SheetHeader title={detail ? "想法详情" : "划线下的想法"} sub={detail ? detail.authorName : `${total} 人划过这句`} onClose={onClose} />
      <ScrollView>
        <VStack alignment="leading" spacing={14} padding={{ horizontal: 18, bottom: 28 }}>
          <VStack alignment="leading" spacing={6} padding={14} background={CARD_BG} clipShape={{ type: "rect", cornerRadius: 14 }}>
            <Text font={14} lineSpacing={6} foregroundStyle="label">{markText}</Text>
          </VStack>

          {detail ? (
            <VStack alignment="leading" spacing={8} padding={14} background={CARD_BG} clipShape={{ type: "rect", cornerRadius: 14 }}>
              <HStack spacing={8}>
                <Text font={13} fontWeight="semibold">{detail.authorName}</Text>
                {detail.star > 0 ? <Stars n={detail.star / 20} /> : null}
                <Spacer />
                <Text font={11} foregroundStyle="tertiaryLabel">{fmtDate(detail.createTime)}</Text>
              </HStack>
              <Text font={14} lineSpacing={6}>{detail.content}</Text>
              <Button action={() => setDetail(null)}>
                <Text font={12} foregroundStyle={ACCENT}>返回列表</Text>
              </Button>
            </VStack>
          ) : detailLoading ? (
            <ProgressView />
          ) : loading ? (
            <VStack frame={{ maxWidth: "infinity" }} padding={{ vertical: 30 }} alignment="center"><ProgressView /></VStack>
          ) : items.length === 0 ? (
            <Notice icon="text.bubble" title="还没有人留言" message="这句还很安静" />
          ) : (
            items.map((it) => (
              <VStack
                key={it.reviewId || it.createTime}
                alignment="leading"
                spacing={6}
                padding={14}
                frame={{ maxWidth: "infinity" }}
                background={CARD_BG}
                clipShape={{ type: "rect", cornerRadius: 14 }}
                onTapGesture={() => openSingle(it.reviewId)}
              >
                <HStack spacing={8}>
                  <Text font={12} fontWeight="semibold">{it.authorName}</Text>
                  <Spacer />
                  <Text font={11} foregroundStyle="tertiaryLabel">{fmtDate(it.createTime)}</Text>
                </HStack>
                <Text font={13} lineSpacing={5} foregroundStyle="label">{it.content}</Text>
              </VStack>
            ))
          )}
        </VStack>
      </ScrollView>
    </VStack>
  )
}

function RecommendPage({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Weread.RecommendItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    async function load() {
      const key = getApiKey()
      if (!key) {
        setLoading(false)
        return
      }
      const r = await Weread.getRecommend(key, 20, 0)
      if (alive) {
        setItems(r.filter((x) => x.bookId))
        setLoading(false)
      }
    }
    load()
    return () => {
      alive = false
    }
  }, [])

  return (
    <NavigationStack>
      <PageShell>
        <ScrollView toolbar={{ cancellationAction: <Button title="关闭" action={onClose} /> }}>
          <VStack alignment="leading" spacing={12} padding={{ horizontal: 16, top: 10, bottom: 32 }} navigationTitle="为你推荐">
            {loading ? (
              <VStack frame={{ maxWidth: "infinity" }} padding={{ vertical: 40 }} alignment="center"><ProgressView /></VStack>
            ) : items.length === 0 ? (
              <Notice icon="sparkles" title="暂无推荐" message="多看几本书再回来看看" />
            ) : (
              items.map((b) => (
                <NavigationLink key={b.bookId} destination={<BookDetailPage bookId={b.bookId} title={b.title} author={b.author} />}>
                  <HStack spacing={12} padding={{ vertical: 4 }}>
                    <Cover bookId={b.bookId} url={b.cover} width={54} height={76} radius={5} />
                    <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                      <Text font={14} fontWeight="medium" lineLimit={1} foregroundStyle="label">{b.title}</Text>
                      <Text font={12} foregroundStyle="secondaryLabel" lineLimit={1}>{b.author}</Text>
                      {b.reason ? <Text font={11} foregroundStyle="tertiaryLabel" lineLimit={2}>{b.reason}</Text> : null}
                    </VStack>
                  </HStack>
                </NavigationLink>
              ))
            )}
          </VStack>
        </ScrollView>
      </PageShell>
    </NavigationStack>
  )
}

function ApiDiagPage({ onClose }: { onClose: () => void }) {
  const [names, setNames] = useState<string[]>([])
  const [raw, setRaw] = useState("")
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    async function load() {
      const key = getApiKey()
      if (!key) {
        setLoading(false)
        return
      }
      try {
        const d = await Weread.getApiList(key)
        const list: string[] = []
        const walk = (v: any, depth: number) => {
          if (depth > 3 || !v) return
          if (Array.isArray(v)) {
            for (const it of v) {
              if (typeof it === "string" && it.startsWith("/")) list.push(it)
              else if (it && typeof it === "object") {
                const n = it.api_name || it.name || it.path || it.api
                if (typeof n === "string") list.push(n)
                else walk(it, depth + 1)
              }
            }
            return
          }
          if (typeof v === "object") {
            for (const k of Object.keys(v)) {
              if (k.startsWith("/")) list.push(k)
              else walk((v as any)[k], depth + 1)
            }
          }
        }
        walk(d, 0)
        if (alive) {
          setNames(Array.from(new Set(list)))
          setRaw(JSON.stringify(d).slice(0, 1200))
          setLoading(false)
        }
      } catch (e: any) {
        if (alive) {
          setErr(e?.message || "获取失败")
          setLoading(false)
        }
      }
    }
    load()
    return () => {
      alive = false
    }
  }, [])

  return (
    <NavigationStack>
      <PageShell>
        <ScrollView toolbar={{ cancellationAction: <Button title="关闭" action={onClose} /> }}>
          <VStack alignment="leading" spacing={10} padding={{ horizontal: 16, top: 10, bottom: 32 }} navigationTitle="接口诊断">
            {loading ? (
              <VStack frame={{ maxWidth: "infinity" }} padding={{ vertical: 40 }} alignment="center"><ProgressView /></VStack>
            ) : err ? (
              <Text font={13} foregroundStyle="systemRed">{err}</Text>
            ) : (
              <>
                <Text font={13} foregroundStyle="secondaryLabel">
                  Key 可调用的接口：{names.length} 个
                </Text>
                {names.map((n) => (
                  <Text key={n} font={12} foregroundStyle="label">{n}</Text>
                ))}
                {names.length === 0 ? (
                  <VStack alignment="leading" spacing={6} padding={14} background={CARD_BG} clipShape={{ type: "rect", cornerRadius: 12 }}>
                    <Text font={12} foregroundStyle="secondaryLabel">未解析出接口名，原始返回：</Text>
                    <Text font={10} foregroundStyle="tertiaryLabel" lineSpacing={3}>{raw}</Text>
                  </VStack>
                ) : null}
              </>
            )}
          </VStack>
        </ScrollView>
      </PageShell>
    </NavigationStack>
  )
}

// ===== 入口 =====
async function run() {
  await Navigation.present({
    element: (
      <ReleaseNotesGate>
        <App />
      </ReleaseNotesGate>
    ),
    modalPresentationStyle: "fullScreen",
  })
  Script.exit()
}

run()
