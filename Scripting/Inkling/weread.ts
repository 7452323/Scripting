// Inkling 数据层 —— 微信读书官方 Agent API 客户端
// 网关：https://i.weread.qq.com/api/agent/gateway
// 鉴权：Bearer <wrk-...>（在 https://weread.qq.com/r/weread-skills 获取）
import { fetch } from "scripting"

const GATEWAY = "https://i.weread.qq.com/api/agent/gateway"
const SKILL_VERSION = "1.0.5"

export const WEREAD_KEY_URL = "https://weread.qq.com/r/weread-skills"

/** 微信读书 App 深链：直接跳回这本书 */
export function bookLink(bookId: string): string {
  return `weread://reading?bId=${bookId}`
}

/** 微信读书 App 深链：跳到具体划线位置 */
export function highlightLink(bookId: string, chapterUid: number, range: string): string {
  const m = /^(\d+)-(\d+)$/.exec(range || "")
  if (!m) return bookLink(bookId)
  return `weread://bestbookmark?bookId=${bookId}&chapterUid=${chapterUid}&rangeStart=${m[1]}&rangeEnd=${m[2]}`
}

export function getCoverUrl(bookId: string): string {
  const id = String(bookId || "")
  if (/^\d+$/.test(id)) {
    const shard = String(Number(id) % 1000)
    return `https://wfqqreader-1252317822.image.myqcloud.com/cover/${shard}/${id}/t6_${id}.jpg`
  }
  return `https://cdn.weread.qq.com/weread/cover/0/${id}/t6_${id}.jpg`
}

// ===== 类型 =====

export interface WereadBook {
  bookId: string
  title: string
  author: string
  cover: string
  category?: string
  readUpdateTime: number
  finishReading: number
  updateTime: number
  intro?: string
  publisher?: string
  wordCount?: number
  newRating?: number
}

export interface WereadNotebookBook extends WereadBook {
  reviewCount: number
  noteCount: number
  bookmarkCount: number
  readingProgress: number
  markedStatus: number
  sort: number
}

export interface WereadHighlight {
  bookmarkId: string
  bookId: string
  chapterUid: number
  markText: string
  createTime: number
  range: string
  colorStyle: number
}

export interface WereadReview {
  reviewId: string
  content: string
  abstract?: string
  range?: string
  chapterName?: string
  chapterUid?: number
  chapterIdx?: number
  createTime: number
  star: number
}

export interface WereadChapter {
  chapterUid: number
  chapterIdx: number
  title: string
  wordCount: number
  level: number
}

export interface NotebookEntry {
  bookId: string
  title: string
  author: string
  cover: string
  reviewCount: number
  noteCount: number
  bookmarkCount: number
  readingProgress: number
  markedStatus: number
  sort: number
}

export type NoteKind = "highlight" | "review"

export interface Note {
  id: string
  kind: NoteKind
  bookId: string
  bookTitle: string
  bookAuthor: string
  bookCover: string
  sourceText: string
  thoughtText: string
  chapter: string
  chapterUid: number
  content: string
  createTime: number
  range: string
  star: number
}

export interface BookNotes {
  notes: Note[]
  bookTitle: string
  bookAuthor: string
  bookCover: string
}

export interface ReadStats {
  readDays: number
  totalReadTime: number
  booksFinished: number
  booksRead: number
}

export interface BestBookmark {
  bookmarkId: string
  chapterUid: number
  range: string
  markText: string
  totalCount: number
}

export type ReadMode = "weekly" | "monthly" | "annually" | "overall"

// ===== API 调用 =====

async function callAPI(api_name: string, params: Record<string, unknown> = {}, apiKey: string): Promise<any> {
  const body: Record<string, unknown> = {
    api_name,
    skill_version: SKILL_VERSION,
    ...params,
  }
  const resp = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
  // @ts-ignore
  const data = await resp.json()
  // 网关要求升级
  if (data && data.upgrade_info) {
    throw new Error("微信读书 Skill 需要升级，请更新脚本")
  }
  // 401 = Key 无效
  if (!resp.ok) {
    if (resp.status === 401) throw new Error("API Key 无效或已过期")
    throw new Error(`网关 HTTP ${resp.status}`)
  }
  if (data && data.errcode && data.errcode !== 0) {
    throw new Error(data.errmsg || `API error ${data.errcode}`)
  }
  return data
}

/** hasMore 兼容 bool / number / string 三种序列化方式 */
function more(v: unknown): boolean {
  return v === 1 || v === true || v === "1" || v === "true"
}

/** 获取有笔记的书籍（多游标兜底，以 totalBookCount 为基准） */
export async function getAllNotebooks(apiKey: string): Promise<{ books: NotebookEntry[]; expected: number }> {
  const seen = new Map<string, NotebookEntry>()
  let expected = 0

  const absorb = (books: any[]): number => {
    let added = 0
    for (const raw of books) {
      if (!raw) continue
      const info: any = raw.book || raw
      const bookId = info.bookId || raw.bookId
      if (!bookId) continue
      if (!seen.has(bookId)) added++
      seen.set(bookId, {
        bookId,
        title: info.title || raw.title || "",
        author: info.author || raw.author || "",
        cover: info.cover || raw.cover || "",
        reviewCount: raw.reviewCount || 0,
        noteCount: raw.noteCount || 0,
        bookmarkCount: raw.bookmarkCount || 0,
        readingProgress: raw.readingProgress || 0,
        markedStatus: raw.markedStatus || 0,
        sort: raw.sort || 0,
      })
    }
    return added
  }

  // 游标候选：不同版本回包可能用 sort / updateTime / readUpdateTime
  const cursorGetters: ((b: any) => number | undefined)[] = [
    (b) => b.sort,
    (b) => b.updateTime,
    (b) => b.readUpdateTime,
  ]

  for (const getCursor of cursorGetters) {
    let cursor: number | undefined
    let guard = 0
    while (guard < 60) {
      guard++
      const params: Record<string, unknown> = { count: 100 }
      if (cursor !== undefined) params.lastSort = cursor
      const data = await callAPI("/user/notebooks", params, apiKey)
      const books: any[] = data.books || []
      if (typeof data.totalBookCount === "number") expected = data.totalBookCount
      const added = absorb(books)
      if (!more(data.hasMore)) break
      if (books.length === 0) break
      if (added === 0) break // 游标没前进
      const next = getCursor(books[books.length - 1])
      if (typeof next !== "number" || next === cursor) break
      cursor = next
    }
    if (expected > 0 && seen.size >= expected) break
  }

  // 最后一搏：offset 分页（部分网关版本支持）
  if (expected > 0 && seen.size < expected) {
    let offset = 0
    let guard = 0
    while (guard < 60 && seen.size < expected) {
      guard++
      const data = await callAPI("/user/notebooks", { count: 100, offset }, apiKey).catch(() => null)
      if (!data) break
      const books: any[] = data.books || []
      const added = absorb(books)
      if (added === 0 || books.length === 0) break
      offset += books.length
      if (!more(data.hasMore)) break
    }
  }

  return { books: Array.from(seen.values()), expected }
}

/** 获取单本书划线（服务端只返回划线，不返回书签内容） */
export async function getBookmarklist(apiKey: string, bookId: string): Promise<{
  updated: WereadHighlight[]
  chapters: WereadChapter[]
  book: WereadBook | null
}> {
  const data = await callAPI("/book/bookmarklist", { bookId }, apiKey)
  return {
    updated: data.updated || [],
    chapters: data.chapters || [],
    book: data.book || null,
  }
}

/** 获取单本书个人想法与点评（游标分页，自动翻完） */
export async function getAllReviews(apiKey: string, bookId: string): Promise<WereadReview[]> {
  const seen = new Map<string, WereadReview>()
  let synckey: number | undefined
  let guard = 0
  while (guard < 30) {
    guard++
    const params: Record<string, unknown> = { bookid: bookId, count: 100 }
    if (synckey !== undefined) params.synckey = synckey
    const data = await callAPI("/review/list/mine", params, apiKey)
    const reviews = data.reviews || []
    for (const item of reviews) {
      if (item && item.review) {
        const r = item.review
        const id = r.reviewId || `${r.createTime}-${(r.content || "").slice(0, 8)}`
        seen.set(id, {
          reviewId: id,
          content: r.content || "",
          abstract: r.abstract,
          range: r.range,
          chapterName: r.chapterName,
          chapterUid: r.chapterUid,
          chapterIdx: r.chapterIdx,
          createTime: r.createTime || 0,
          star: r.star || 0,
        })
      }
    }
    if (!more(data.hasMore)) break
    if (reviews.length === 0) break
    const next = data.synckey
    if (typeof next !== "number" || next === synckey) break
    synckey = next
  }
  return Array.from(seen.values())
}

/** 获取一本书的完整笔记（划线 + 想法），汇总为统一 Note 模型 */
export async function getBookNotes(apiKey: string, bookId: string): Promise<BookNotes> {
  const [bookmarkResp, reviewResp] = await Promise.all([
    getBookmarklist(apiKey, bookId),
    getAllReviews(apiKey, bookId),
  ])

  const rawBook: any = bookmarkResp.book || {}
  const book: any = rawBook.book || rawBook
  const bookTitle = book.title || ""
  const bookAuthor = book.author || ""
  const bookCover = book.cover || getCoverUrl(bookId)

  const chapterMap = new Map<number, string>()
  for (const c of bookmarkResp.chapters) chapterMap.set(c.chapterUid, c.title)

  const notes: Note[] = []

  // 划线
  for (const h of bookmarkResp.updated) {
    notes.push({
      id: `${h.bookmarkId}`,
      kind: "highlight",
      bookId,
      bookTitle,
      bookAuthor,
      bookCover,
      sourceText: h.markText || "",
      thoughtText: "",
      chapter: chapterMap.get(h.chapterUid) || "",
      chapterUid: h.chapterUid,
      content: h.markText || "",
      createTime: h.createTime || 0,
      range: h.range || "",
      star: 0,
    })
  }

  // 想法
  for (const r of reviewResp) {
    notes.push({
      id: `${r.reviewId}`,
      kind: "review",
      bookId,
      bookTitle,
      bookAuthor,
      bookCover,
      sourceText: r.abstract || "",
      thoughtText: r.content || "",
      chapter: r.chapterName || "",
      chapterUid: r.chapterUid || 0,
      content: r.content || "",
      createTime: r.createTime || 0,
      range: r.range || "",
      star: r.star || 0,
    })
  }

  notes.sort((a, b) => b.createTime - a.createTime)

  return { notes, bookTitle, bookAuthor, bookCover }
}

/** 阅读统计 */
export async function getReadStats(apiKey: string): Promise<ReadStats> {
  return getReadStatsByMode(apiKey, "overall")
}

/** 按周期取阅读统计（weekly / monthly / annually / overall） */
export async function getReadStatsByMode(apiKey: string, mode: ReadMode): Promise<ReadStats> {
  try {
    const data = await callAPI("/readdata/detail", { mode }, apiKey)
    return {
      readDays: data.readDays || 0,
      totalReadTime: data.totalReadTime || 0,
      booksFinished: data.booksFinished || 0,
      booksRead: data.booksRead || 0,
    }
  } catch {
    return { readDays: 0, totalReadTime: 0, booksFinished: 0, booksRead: 0 }
  }
}

/** 热门划线：全站被划次数最多的句子（固定前 20 条，不支持分页） */
export async function getBestBookmarks(apiKey: string, bookId: string): Promise<BestBookmark[]> {
  try {
    const data = await callAPI("/book/bestbookmarks", { bookId, chapterUid: 0, synckey: 0 }, apiKey)
    const items = data.items || []
    return items
      .map((it: any) => ({
        bookmarkId: it.bookmarkId || "",
        chapterUid: it.chapterUid || 0,
        range: it.range || "",
        markText: it.markText || it.text || it.content || it.abstract || "",
        totalCount: it.totalCount || it.count || 0,
      }))
      .filter((x: { markText: string }) => x.markText.length > 0)
  } catch {
    return []
  }
}

// ===== 书籍详情 / 搜索 / 公开点评 =====

export interface BookDetail {
  bookId: string
  title: string
  author: string
  intro: string
  category: string
  publisher: string
  publishTime: string
  isbn: string
  wordCount: number
  newRating: number
  newRatingCount: number
}

export interface SearchItem {
  bookId: string
  title: string
  author: string
  cover: string
  intro: string
  readingCount: number
  newRating: number
  searchIdx: number
}

export interface PublicReview {
  reviewId: string
  content: string
  star: number
  authorName: string
  createTime: number
  chapterName: string
  idx: number
}

/** 书籍详情（评分 / 字数 / ISBN / 简介） */
export async function getBookInfo(apiKey: string, bookId: string): Promise<BookDetail | null> {
  try {
    const d = await callAPI("/book/info", { bookId }, apiKey)
    return {
      bookId: d.bookId || bookId,
      title: d.title || "",
      author: d.author || "",
      intro: d.intro || "",
      category: d.category || "",
      publisher: d.publisher || "",
      publishTime: d.publishTime || "",
      isbn: d.isbn || "",
      wordCount: d.wordCount || 0,
      newRating: d.newRating || 0,
      newRatingCount: d.newRatingCount || 0,
    }
  } catch {
    return null
  }
}

/** 书城搜索（scope: 10 电子书 / 16 网文 / 14 听书 / 6 作者 / 12 全文 / 2 公众号 / 4 文章） */
export async function searchBooks(
  apiKey: string,
  keyword: string,
  scope: number = 10,
  maxIdx?: number
): Promise<{ items: SearchItem[]; hasMore: boolean }> {
  const params: Record<string, unknown> = { keyword, scope, count: 20 }
  if (maxIdx !== undefined) params.maxIdx = maxIdx
  const d = await callAPI("/store/search", params, apiKey)
  const groups = d.results || []
  const items: SearchItem[] = []
  for (const g of groups) {
    for (const it of g.books || []) {
      const b = it.bookInfo || {}
      if (!b.bookId) continue
      items.push({
        bookId: b.bookId,
        title: b.title || "",
        author: b.author || "",
        cover: b.cover || "",
        intro: b.intro || "",
        readingCount: it.readingCount || 0,
        newRating: it.newRating || 0,
        searchIdx: it.searchIdx || 0,
      })
    }
  }
  return { items, hasMore: more(d.hasMore) }
}

/** 公开书评（type: 0 全部 / 1 推荐 / 2 不行 / 3 最新 / 4 一般） */
export async function getPublicReviews(
  apiKey: string,
  bookId: string,
  type: number = 0,
  maxIdx: number = 0
): Promise<{ items: PublicReview[]; hasMore: boolean; total: number }> {
  try {
    const d = await callAPI("/review/list", { bookId, reviewListType: type, count: 20, maxIdx }, apiKey)
    const items: PublicReview[] = []
    for (const wrap of d.reviews || []) {
      const r = wrap && wrap.review && wrap.review.review ? wrap.review.review : null
      if (!r) continue
      items.push({
        reviewId: r.reviewId || "",
        content: r.content || "",
        star: (r.star || 0) / 20,
        authorName: (r.author && r.author.name) || "匿名",
        createTime: r.createTime || 0,
        chapterName: r.chapterName || "",
        idx: wrap.idx || 0,
      })
    }
    return { items, hasMore: more(d.reviewsHasMore), total: d.reviewsCnt || 0 }
  } catch {
    return { items: [], hasMore: false, total: 0 }
  }
}

// ===== 目录 / 进度 / 推荐 / 单条想法 / 元接口 =====

export interface ChapterItem {
  chapterUid: number
  chapterIdx: number
  title: string
  wordCount: number
  level: number
}

export interface BookProgress {
  progress: number
  chapterUid: number
  chapterOffset: number
  updateTime: number
  recordReadingTime: number
  finishTime: number
}

export interface UnderlineItem {
  range: string
  count: number
  score: number
}

export interface ReadReviewItem {
  reviewId: string
  content: string
  abstract: string
  range: string
  authorName: string
  createTime: number
}

export interface SingleReview {
  reviewId: string
  content: string
  htmlContent: string
  authorName: string
  createTime: number
  star: number
}

export interface RecommendItem {
  bookId: string
  title: string
  author: string
  cover: string
  intro: string
  reason: string
  readingCount: number
  newRating: number
  searchIdx: number
}

/** 元接口：列出网关所有可用接口与参数定义 */
export async function getApiList(apiKey: string): Promise<any> {
  return await callAPI("/_list", {}, apiKey)
}

/** 目录（chapterUid 是 underlines / bestbookmarks 的必要参数） */
export async function getChapters(apiKey: string, bookId: string): Promise<ChapterItem[]> {
  try {
    const d = await callAPI("/book/chapterinfo", { bookId }, apiKey)
    return (d.chapters || []).map((c: any) => ({
      chapterUid: c.chapterUid,
      chapterIdx: c.chapterIdx || 0,
      title: c.title || "",
      wordCount: c.wordCount || 0,
      level: c.level || 1,
    }))
  } catch {
    return []
  }
}

/** 阅读进度（progress 是 0-100 整数，1 表示 1%） */
export async function getProgress(apiKey: string, bookId: string): Promise<BookProgress | null> {
  try {
    const d = await callAPI("/book/getprogress", { bookId }, apiKey)
    const b = d.book || {}
    return {
      progress: b.progress || 0,
      chapterUid: b.chapterUid || 0,
      chapterOffset: b.chapterOffset || 0,
      updateTime: b.updateTime || 0,
      recordReadingTime: b.recordReadingTime || 0,
      finishTime: b.finishTime || 0,
    }
  } catch {
    return null
  }
}

/** 章节划线热度（不包含划线原文） */
export async function getChapterUnderlines(
  apiKey: string,
  bookId: string,
  chapterUid: number
): Promise<UnderlineItem[]> {
  try {
    const d = await callAPI("/book/underlines", { bookId, chapterUid, synckey: 0 }, apiKey)
    return (d.underlines || []).map((u: any) => ({
      range: u.range || "",
      count: u.count || 0,
      score: u.score || 0,
    }))
  } catch {
    return []
  }
}

/** 指定划线范围下的想法 */
export async function getReadReviews(
  apiKey: string,
  bookId: string,
  chapterUid: number,
  range: string
): Promise<ReadReviewItem[]> {
  try {
    const d = await callAPI(
      "/book/readreviews",
      { bookId, chapterUid, reviews: [{ range, count: 20, maxIdx: 0, synckey: 0 }] },
      apiKey
    )
    const out: ReadReviewItem[] = []
    for (const g of d.reviews || []) {
      for (const pr of g.pageReviews || []) {
        const r = pr.review || {}
        out.push({
          reviewId: pr.reviewId || "",
          content: r.content || "",
          abstract: r.abstract || "",
          range: r.range || range,
          authorName: (r.author && r.author.name) || "读者",
          createTime: r.createTime || 0,
        })
      }
    }
    return out
  } catch {
    return []
  }
}

/** 单条想法详情 */
export async function getReviewSingle(apiKey: string, reviewId: string): Promise<SingleReview | null> {
  try {
    const d = await callAPI("/review/single", { reviewId, commentsCount: 10, likesCount: 10 }, apiKey)
    const r = d.review || {}
    return {
      reviewId: d.reviewId || reviewId,
      content: r.content || "",
      htmlContent: d.htmlContent || "",
      authorName: (r.author && r.author.name) || "读者",
      createTime: r.createTime || 0,
      star: r.star || 0,
    }
  } catch {
    return null
  }
}

/** 为你推荐 */
export async function getRecommend(
  apiKey: string,
  count: number = 20,
  maxIdx: number = 0
): Promise<RecommendItem[]> {
  try {
    const d = await callAPI("/book/recommend", { count, maxIdx }, apiKey)
    return (d.books || []).map((b: any) => ({
      bookId: b.bookId,
      title: b.title || "",
      author: b.author || "",
      cover: b.cover || "",
      intro: b.intro || "",
      reason: b.reason || "",
      readingCount: b.readingCount || 0,
      newRating: b.newRating || 0,
      searchIdx: b.searchIdx || 0,
    }))
  } catch {
    return []
  }
}

/** 相似书推荐 */
export async function getSimilar(
  apiKey: string,
  bookId: string,
  count: number = 12,
  maxIdx: number = 0,
  sessionId?: string
): Promise<RecommendItem[]> {
  try {
    const params: Record<string, unknown> = { bookId, count, maxIdx }
    if (sessionId) params.sessionId = sessionId
    const d = await callAPI("/book/similar", params, apiKey)
    const list = (d.booksimilar && d.booksimilar.books) || []
    return list.map((s: any) => {
      const bi = (s.book && s.book.bookInfo) || {}
      return {
        bookId: bi.bookId || "",
        title: bi.title || "",
        author: bi.author || "",
        cover: bi.cover || "",
        intro: "",
        reason: "",
        readingCount: 0,
        newRating: 0,
        searchIdx: s.idx || 0,
      }
    })
  } catch {
    return []
  }
}

// ===== 书架 =====

export interface ShelfBook {
  bookId: string
  title: string
  author: string
  cover: string
  readUpdateTime: number
  finishReading: number
}

/** 完整书架（含没有笔记的书） */
export async function getShelf(apiKey: string): Promise<ShelfBook[]> {
  try {
    const d = await callAPI("/shelf/sync", {}, apiKey)
    const out: ShelfBook[] = []
    for (const b of d.books || []) {
      if (!b || !b.bookId) continue
      out.push({
        bookId: b.bookId,
        title: b.title || "",
        author: b.author || "",
        cover: b.cover || "",
        readUpdateTime: b.readUpdateTime || 0,
        finishReading: b.finishReading || 0,
      })
    }
    return out
  } catch {
    return []
  }
}

/** 校验 API Key 是否可用（拉一次书架即可） */
export async function validateKey(apiKey: string): Promise<void> {
  await callAPI("/shelf/sync", {}, apiKey)
}
