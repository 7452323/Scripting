import {
  Script,
  Navigation,
  NavigationStack,
  List,
  TextField,
  Button,
  Text,
  Section,
  Link,
  Image,
  HStack,
  VStack,
  Spacer,
  Group,
  ProgressView,
  useObservable,
  fetch,
  Response,
} from "scripting"

// Global runtime functions (recognized at runtime, declared here for editor)
declare function openURL(url: string): Promise<boolean>

// ---------- Types ----------

interface HegreResult {
  url: string
  slug: string
  enTitle: string        // Chinese title (for <title>)
  originalTitle: string  // English original (for <originaltitle>)
  releaseDate: string    // YYYY-MM-DD
  runtime: string
  plot: string
  tagline: string        // Short subtitle from page
  genres: string[]       // 1-2 from standard pool
  tags: string[]         // exactly 6 from standard pool
  series: string
  posterUrl: string
  boardUrl: string
}

// ---------- Helper functions ----------

function extractSlugVariations(input: string): string[] {
  const clean = input
    .toLowerCase()
    .replace(/hegre\./g, "")
    .trim()

  // Remove leading date pattern like "25.05.26." -> keep the rest for slug
  const titlePart = clean.replace(/^\d{2}\.\d{2}\.\d{2}\./, "").trim()

  const variations = [
    clean.replace(/[\s.]+/g, "-"),
    titlePart.replace(/[\s.]+/g, "-"),
  ]

  // Deduplicate
  return [...new Set(variations.filter(v => v.length > 0))]
}

// ---------- Standard Tag Library ----------

const GENRE_POOL = ["情色", "艺术", "写真", "生活"] as const

const TAG_CATEGORIES: Record<string, string[]> = {
  behavior:   ["手淫", "潮吹", "内射", "自慰", "插入", "抚摸", "按摩", "挑逗", "口交", "拳交", "肛交"],
  relationship: ["独奏", "情侣", "拉拉", "多人"],
  body:       ["乳房", "阴部", "臀部", "阴茎"],
  style:      ["性感", "诱惑", "温柔", "激烈"],
  theme:      ["生活纪实", "幕后花絮", "摄影主题", "情景演绎"],
}

const ALL_TAGS = Object.values(TAG_CATEGORIES).flat()

// Synonym groups – only pick ONE from each group
const SYNONYM_GROUPS: string[][] = [
  ["手淫", "自慰"],
]

const CATEGORY_PRIORITY: Record<string, number> = {
  behavior: 5, relationship: 4, style: 3, body: 2, theme: 1,
}

function getTagCategory(tag: string): string | null {
  for (const [cat, tags] of Object.entries(TAG_CATEGORIES)) {
    if (tags.includes(tag)) return cat
  }
  return null
}

// ---------- Classification Functions ----------

function classifyGenres(plot: string, title: string): string[] {
  const genres: string[] = ["情色"]
  const text = (plot + " " + title).toLowerCase()

  if (/生活|日常|一天|早餐|瑜伽|野餐|旅行|起居|日常记录/.test(text)) {
    genres.push("生活")
  } else if (/艺术|画廊|美术馆|摄影/.test(text)) {
    genres.push("艺术")
  }

  return genres.slice(0, 2)
}

function selectTags(plot: string, title: string): string[] {
  const text = plot + " " + title
  const tagScores = new Map<string, number>()

  // Keyword → tag rules (order matters: more specific first)
  const rules: { re: RegExp; tags: string[] }[] = [
    { re: /潮吹|喷水|潮喷/, tags: ["潮吹"] },
    { re: /内射|体内射/, tags: ["内射"] },
    { re: /肛交|肛门|anal|后庭/, tags: ["肛交"] },
    { re: /口交|口活|oral/i, tags: ["口交"] },
    { re: /拳交|fisting/i, tags: ["拳交"] },
    { re: /插入|进入|抽插/, tags: ["插入"] },
    { re: /自慰|手淫|自我刺激|自我触摸|触摸自己|自摸|masturbat/i, tags: ["自慰", "抚摸"] },
    { re: /按摩|精油|spa|放松|massage/i, tags: ["按摩", "抚摸"] },
    { re: /挑逗|撩人|勾引|脱衣舞|脱衣|剥[离落]/, tags: ["挑逗", "诱惑"] },
    { re: /抚摸|触摸|抚弄|爱抚|抚摩/, tags: ["抚摸"] },
    { re: /乳房|胸部|奶子|乳头|breast/i, tags: ["乳房"] },
    { re: /阴部|小穴|阴道|阴蒂|pussy/i, tags: ["阴部"] },
    { re: /臀部|屁股|翘臀|臀|ass|butt/i, tags: ["臀部"] },
    { re: /阴茎|肉棒|鸡巴|阳具|cock|dick/i, tags: ["阴茎"] },
    { re: /拉拉|女女|lesbian|两位女性|女性互动/i, tags: ["拉拉"] },
    { re: /多人|群交|group|三人|3p|群/i, tags: ["多人"] },
    { re: /情侣|男女|couple|互动|两人|对方|伴侣/i, tags: ["情侣"] },
    { re: /独奏|solo|单人|独自|单独/i, tags: ["独奏"] },
    { re: /幕后|花絮|拍摄过程|behind|制作过程|录制过程/i, tags: ["幕后花絮"] },
    { re: /摄影|写真|拍摄|照片|photo/i, tags: ["摄影主题"] },
    { re: /情景|演绎|故事|剧情|角色扮演/i, tags: ["情景演绎"] },
    { re: /生活|日常|一天|day|早餐|瑜伽|野餐|旅行|画廊|轮滑|溜冰|起居|日常记录|纪实/i, tags: ["生活纪实"] },
    { re: /性感|sexy|火辣/i, tags: ["性感"] },
    { re: /诱惑|seductiv/i, tags: ["诱惑"] },
    { re: /温柔|柔和|soft|轻柔/i, tags: ["温柔"] },
    { re: /激烈|猛烈|intense|狂野/i, tags: ["激烈"] },
  ]

  for (const { re, tags } of rules) {
    if (re.test(text)) {
      for (const t of tags) {
        tagScores.set(t, (tagScores.get(t) || 0) + 1)
      }
    }
  }

  // Collect matched tags, dedup synonyms
  const matched = new Set<string>()
  const usedSynGroups = new Set<number>()

  for (const [tag] of [...tagScores.entries()].sort((a, b) => b[1] - a[1])) {
    if (!ALL_TAGS.includes(tag)) continue

    // Check synonym conflicts
    let synGroupIdx = -1
    for (let i = 0; i < SYNONYM_GROUPS.length; i++) {
      if (SYNONYM_GROUPS[i].includes(tag)) { synGroupIdx = i; break }
    }
    if (synGroupIdx >= 0 && usedSynGroups.has(synGroupIdx)) continue
    if (synGroupIdx >= 0) usedSynGroups.add(synGroupIdx)

    matched.add(tag)
    if (matched.size >= 12) break
  }

  // Sort by category priority, then by original score
  const sorted = [...matched].sort((a, b) => {
    const catA = CATEGORY_PRIORITY[getTagCategory(a) || ""] || 0
    const catB = CATEGORY_PRIORITY[getTagCategory(b) || ""] || 0
    if (catB !== catA) return catB - catA
    return (tagScores.get(b) || 0) - (tagScores.get(a) || 0)
  })

  // Pick 6, ensuring at least 1 behavior + 1 style + 1 relationship if available
  const result: string[] = []
  const cats = { behavior: 0, style: 0, relationship: 0 }
  const remaining: typeof sorted = []

  for (const t of sorted) {
    const cat = getTagCategory(t)
    if (cat === "behavior" && cats.behavior === 0) { result.push(t); cats.behavior++ }
    else if (cat === "style" && cats.style === 0) { result.push(t); cats.style++ }
    else if (cat === "relationship" && cats.relationship === 0) { result.push(t); cats.relationship++ }
    else { remaining.push(t) }
  }

  for (const t of remaining) {
    if (result.length >= 6) break
    result.push(t)
  }

  // Pad if fewer than 6
  const fallbacks = ["性感", "诱惑", "独奏", "抚摸", "挑逗", "温柔"]
  for (const fb of fallbacks) {
    if (result.length >= 6) break
    if (!result.includes(fb) && !result.some(r =>
      SYNONYM_GROUPS.some(g => g.includes(r) && g.includes(fb))
    )) {
      result.push(fb)
    }
  }

  return result.slice(0, 6)
}

function determineSeries(plot: string, title: string): string {
  const text = (plot + " " + title).toLowerCase()

  // Priority order (highest first)
  // 1. 三人及以上 → 多人运动 系列
  if (/三人|多人|群交|3p|三人及以上/.test(text)) return "多人运动 系列"

  // 2. 有明确性行为但无互动 → 手淫 系列
  //    (sexual keywords present AND no partner/interaction keywords)
  const hasSexAct = /性行为|做爱|插入|进入|抽插|自慰|手淫|自摸|masturbat/i.test(text)
  const hasInteraction = /情侣|男女|互动|两人|对方|伴侣|拉拉|couple|and/.test(text)
  if (hasSexAct && !hasInteraction) return "手淫 系列"

  // 3. 幕后花絮
  if (/幕后|花絮|拍摄过程|behind|制作过程|录制过程/.test(text)) return "幕后花絮 系列"

  // 4. 拉拉
  if (/拉拉|女女|lesbian|两位女性|女性互动/i.test(text)) return "拉拉 系列"

  // 5. 情侣
  if (/情侣|男女|couple|互动|两人|对方|伴侣|and/.test(text)) return "情侣 系列"

  // 6. 肛交
  if (/肛交|肛门|anal|后庭/i.test(text)) return "肛交 系列"

  // 7. 口交
  if (/口交|口活|oral/i.test(text)) return "口交 系列"

  // 8. 阴茎刺激 (has penis keywords but no specific act)
  if (/阴茎刺激|肉棒|鸡巴|阳具|cock|dick/i.test(text)) return "阴茎刺激 系列"

  // 9. 手交 (female hand stimulates male)
  if (/手交|打飞机|用手.*刺激/.test(text)) return "手交 系列"

  // 10. 按摩
  if (/按摩|精油|spa|放松|massage/i.test(text)) return "按摩 系列"

  // 11. 生活纪实
  if (/生活|日常|一天|day|早餐|瑜伽|野餐|旅行|画廊|轮滑|溜冰|起居|记录|纪实/.test(text)) return "生活纪实 系列"

  // 12. 自慰/自我刺激
  if (/自慰|手淫|自我刺激|自我触摸|自摸|masturbat/i.test(text)) return "手淫 系列"

  // 13. 默认
  return "独奏 系列"
}

// Extract release date from filename. Supports:
//   Hegre.25.05.26.Title  → 2025-05-26
//   2025.05.26.Title      → 2025-05-26
//   2025-05-26 Title      → 2025-05-26
//   Hegre.25.5.26.Title   → 2025-05-26
function guessDateFromFilename(input: string): string | null {
  // Pattern 1: YYYY.MM.DD or YYYY-MM-DD (full year)
  let m = input.match(/(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})/)
  if (m) {
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`
  }
  // Pattern 2: YY.MM.DD or YY-MM-DD (short year, most common for Hegre)
  m = input.match(/(\d{2})[.\-](\d{1,2})[.\-](\d{1,2})/)
  if (m) {
    const yy = parseInt(m[1])
    const century = yy <= 50 ? "20" : "19"
    return `${century}${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`
  }
  return null
}

// ---------- CDN Timestamp Extraction ----------

// Extract Unix timestamps from Hegre CDN URLs (v= parameter)
// These are cache-busting timestamps; the earliest indicates approximate release date
function extractCDNTimestamps(html: string): number[] {
  const timestamps: number[] = []
  const regex = /[?&]v=(\d{9,11})(?:[&"']|$)/g
  let match
  while ((match = regex.exec(html)) !== null) {
    const ts = parseInt(match[1])
    // Filter: Unix timestamps between 2010-01-01 and 2030-01-01
    if (ts > 1262304000 && ts < 1893456000) {
      timestamps.push(ts)
    }
  }
  return timestamps
}

// Convert Unix timestamp to approximate year/month
function timestampToYearMonth(ts: number): { year: number; month: number } {
  const date = new Date(ts * 1000)
  return { year: date.getFullYear(), month: date.getMonth() + 1 }
}

// ---------- thenude.com Date Extraction ----------

// Fetch the thenude.com monthly cover listing page
async function fetchThenudeMonthly(year: number, month: number): Promise<string | null> {
  const mm = String(month).padStart(2, "0")
  const url = `https://www.thenude.com/covers/hegre-art-video/${year}/${mm}/`
  try {
    const res = await fetchWithTimeout(url, 15)
    if (res.status !== 200) return null
    return await res.text()
  } catch {
    return null
  }
}

// Extract release date from thenude.com monthly page by matching film title
function findDateInThenudeHtml(html: string, filmTitle: string): string | null {
  // Normalize: remove punctuation, lowercase
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")
  const normalizedTitle = normalize(filmTitle)

  // Find all figcaption blocks
  const figRegex = /<figcaption>\s*([\s\S]*?)\s*<\/figcaption>/gs
  let figMatch
  while ((figMatch = figRegex.exec(html)) !== null) {
    const block = figMatch[1].replace(/<[^>]+>/g, "").trim()

    // Extract date (first line: "DD Month YYYY" or "D Month YYYY")
    const dateMatch = block.match(/^(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/)
    if (!dateMatch) continue

    // Extract title from quotes after "in "
    const titleMatch = block.match(/"([^"]+)"/)
    if (!titleMatch) continue

    const blockTitle = normalize(titleMatch[1])

    // Match: exact or substring
    if (blockTitle === normalizedTitle ||
        blockTitle.includes(normalizedTitle) ||
        normalizedTitle.includes(blockTitle)) {
      // Parse date
      const months: Record<string, string> = {
        January: "01", February: "02", March: "03", April: "04",
        May: "05", June: "06", July: "07", August: "08",
        September: "09", October: "10", November: "11", December: "12"
      }
      return `${dateMatch[3]}-${months[dateMatch[2]]}-${dateMatch[1].padStart(2, "0")}`
    }
  }

  return null
}

// Main date lookup: use CDN timestamps to find the right thenude.com month, then match the title
async function getDateFromThenude(filmTitle: string, cdnTimestamps: number[]): Promise<string | null> {
  if (cdnTimestamps.length === 0) return null

  const earliest = Math.min(...cdnTimestamps)
  const { year, month } = timestampToYearMonth(earliest)

  // Try estimated month, then adjacent months (±1, ±2)
  const monthOffsets = [0, -1, 1, -2, 2]

  for (const offset of monthOffsets) {
    let m = month + offset
    let y = year
    while (m < 1) { m += 12; y-- }
    while (m > 12) { m -= 12; y++ }

    const html = await fetchThenudeMonthly(y, m)
    if (!html) continue

    const date = findDateInThenudeHtml(html, filmTitle)
    if (date) return date
  }

  return null
}

// Fallback: use the earliest CDN timestamp as approximate date
function getDateFromCDN(cdnTimestamps: number[]): string | null {
  if (cdnTimestamps.length === 0) return null
  const earliest = Math.min(...cdnTimestamps)
  const d = new Date(earliest * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

async function fetchWithTimeout(url: string, timeout = 10): Promise<Response> {
  return await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
    },
    timeout,
  })
}

async function scrapeHegrePage(slug: string): Promise<{ html: string; finalUrl: string } | null> {
  const url = `https://www.hegre.com/films/${slug}?locale=zh`
  try {
    const res = await fetchWithTimeout(url)
    if (res.status !== 200) return null
    // Check that the response URL still contains /films/ (i.e. not redirected)
    if (!res.url.includes("/films/")) return null
    const html = await res.text()
    return { html, finalUrl: res.url }
  } catch {
    return null
  }
}

function extractMetaFromHtml(html: string, slug: string) {
  // Title from <title> (may be Chinese when locale=zh)
  const titleMatch = html.match(/<title>(.*?)<\/title>/)
  const rawTitle = titleMatch ? titleMatch[1].trim() : slug
  const pageTitle = rawTitle.split(" - Hegre.com")[0]?.split(" – Hegre.com")[0]?.trim() || slug

  // English original title from <h1 class="original-text">
  let originalTitle = pageTitle
  const origMatch = html.match(/<h1 class="original-text">(.*?)<\/h1>/)
  if (origMatch) {
    originalTitle = origMatch[1].trim()
  }

  // Chinese title: use pageTitle if it contains Chinese, otherwise keep as-is
  const enTitle = pageTitle

  // Release date from HTML
  let releaseDate: string | null = null
  const datePatterns = [
    /"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})"/,
    /"uploadDate"\s*:\s*"(\d{4}-\d{2}-\d{2})"/,
    /(\d{4}-\d{2}-\d{2})/,
  ]
  for (const pat of datePatterns) {
    const m = html.match(pat)
    if (m) {
      releaseDate = m[1]
      break
    }
  }

  // Runtime
  let runtime = "29"
  const runtimeMatch = html.match(/(\d+)\s*min/i)
  if (runtimeMatch) runtime = runtimeMatch[1]

  // Plot / description — prefer Chinese translated text, fall back to English original
  let plot = ""
  // 1. Chinese description from <div class="massage-copy translated-text">
  const zhMatch = html.match(/<div class="massage-copy translated-text">([\s\S]*?)<\/div>/)
  if (zhMatch) {
    plot = zhMatch[1].replace(/<[^>]+>/g, "").trim()
  }
  // 2. English description from <div class="massage-copy original-text">
  if (!plot) {
    const enMatch = html.match(/<div class="massage-copy original-text">([\s\S]*?)<\/div>/)
    if (enMatch) {
      plot = enMatch[1].replace(/<[^>]+>/g, "").trim()
    }
  }
  // 3. Fall back to <p class="description"> (old pattern)
  if (!plot) {
    const pMatch = html.match(/<p class="description">([\s\S]*?)<\/p>/)
    if (pMatch) plot = pMatch[1].trim()
  }
  // 4. Last resort: meta description
  if (!plot) {
    const metaDesc = html.match(/<meta\s+name="description"\s+content="(.*?)"/i)
    if (metaDesc) plot = metaDesc[1].trim()
  }

  // Tagline — short subtitle before the description, e.g. "阿利亚扩展。快乐扩大"
  let tagline = ""
  const tagMatch = html.match(/<div class="record-description-content[^"]*">\s*([\s\S]*?)\s*<div/)
  if (tagMatch) {
    const raw = tagMatch[1].replace(/<[^>]+>/g, "").trim()
    tagline = raw.split(/\n/)[0].trim()
  }
  // Fallback: meta description
  if (!tagline) {
    const metaDesc = html.match(/<meta\s+name="description"\s+content="(.*?)"/i)
    if (metaDesc) tagline = metaDesc[1].trim()
  }

  // Extract CDN timestamps for date estimation
  const cdnTimestamps = extractCDNTimestamps(html)

  return { enTitle, originalTitle, releaseDate, runtime, plot, tagline, cdnTimestamps }
}

async function scrapeAndVerify(input: string): Promise<{
  result: HegreResult | null
  error?: string
}> {
  // Step 1: Try to extract date from filename (last-resort fallback)
  const dateFromFilename = guessDateFromFilename(input)

  // Step 2: Generate slug variations and try to scrape Hegre page
  const variations = extractSlugVariations(input)
  let lastError = ""

  for (const slug of variations) {
    const page = await scrapeHegrePage(slug)
    if (!page) {
      lastError = `未能找到匹配的 Hegre 页面: ${slug}`
      continue
    }

    const { enTitle, originalTitle, releaseDate, runtime, plot, tagline, cdnTimestamps } = extractMetaFromHtml(page.html, slug)

    // Step 3: Get release date — priority order:
    //   1. thenude.com (most accurate)
    //   2. CDN timestamps from Hegre page (approximate)
    //   3. Filename date (user-provided)
    let realDate: string | null = null

    // Try thenude.com first — use original title for matching
    if (originalTitle && cdnTimestamps.length > 0) {
      realDate = await getDateFromThenude(originalTitle, cdnTimestamps)
    }

    // Fallback to CDN timestamp
    if (!realDate && cdnTimestamps.length > 0) {
      realDate = getDateFromCDN(cdnTimestamps)
    }

    // Last resort: filename date
    if (!realDate && dateFromFilename) {
      realDate = dateFromFilename
    }

    // If still no date after all attempts, try next slug
    if (!realDate) {
      lastError = `找到了 Hegre 页面但无法获取发布日期: ${slug}`
      continue
    }

    const series = determineSeries(plot, enTitle)
    const genres = classifyGenres(plot, enTitle)
    const tags = selectTags(plot, enTitle)

    // Build Chinese title (replace "And" with "和")
    const cnTitle = enTitle
      .replace(/\bAnd\b/g, "和")
      .replace(/\band\b/g, "和")

    const posterUrl = `https://pp.hegre.com/films/${slug}/${slug}-poster-image-1440x.jpg`
    const boardUrl = `https://pp.hegre.com/films/${slug}/${slug}-board-image-3840x.jpg`

    // Generate plot if empty
    const finalPlot = plot || `HEGRE ${realDate} 上线经典作品《${enTitle}》。`

    return {
      result: {
        url: page.finalUrl,
        slug,
        enTitle: cnTitle,
        originalTitle,
        releaseDate: realDate,
        runtime,
        plot: finalPlot,
        tagline,
        genres,
        tags,
        series,
        posterUrl,
        boardUrl,
      },
    }
  }

  return { result: null, error: lastError || "未能找到匹配的 Hegre 页面。请检查文件名是否正确（如 Hegre.A.Day.In.The.Life）。" }
}

function generateNfoContent(result: HegreResult, fname: string): string {
  const year = result.releaseDate.substring(0, 4)
  const actorName = result.originalTitle.split(/\s+/)[0] || "未知"
  const sortTitle = `Hegre.${result.releaseDate.substring(2, 4)}.${result.releaseDate.substring(5, 7)}.${result.releaseDate.substring(8, 10)}.${result.originalTitle.replace(/[\s\-]+/g, ".")}`

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<movie>
    <title>${result.enTitle}</title>
    <originaltitle>${result.originalTitle}</originaltitle>
    <sorttitle>${sortTitle}</sorttitle>
    <year>${year}</year>
    <releasedate>${result.releaseDate}</releasedate>
    <runtime>${result.runtime}</runtime>
    <mpaa>XXX</mpaa>
    <country>挪威</country>
    <language>英语</language>

    <tmdbid></tmdbid>
    <uniqueid type="imdb" default="true"></uniqueid>

    <plot>${result.plot}</plot>
    <tagline>${result.tagline}</tagline>

    <genre>${result.genres.join("</genre>\n    <genre>")}</genre>

    <tag>${result.tags.join("</tag>\n    <tag>")}</tag>

    <director>Petter Hegre</director>
    <writer>Petter Hegre</writer>

    <actor>
        <name>${actorName}</name>
        <role>独奏女神</role>
        <thumb>${result.posterUrl}</thumb>
    </actor>

    <thumb aspect="poster">${result.posterUrl}</thumb>
    <thumb aspect="fanart">${result.boardUrl}</thumb>

    <rating>9.8</rating>
    <votes>1248</votes>

    <studio>Hegre.com / Petter Hegre</studio>
</movie>`
}

// ---------- Main UI ----------

function MainView() {
  const inputText = useObservable("")
  const isLoading = useObservable(false)
  const scrapedResult = useObservable<HegreResult | null>(null)
  const errorMessage = useObservable("")
  const nfoContent = useObservable("")

  async function handleFetch() {
    const text = inputText.value.trim()
    if (!text) {
      errorMessage.setValue("请输入文件名")
      return
    }

    isLoading.setValue(true)
    errorMessage.setValue("")
    scrapedResult.setValue(null)
    nfoContent.setValue("")

    const { result: r, error } = await scrapeAndVerify(text)

    isLoading.setValue(false)

    if (r) {
      scrapedResult.setValue(r)
      const fname = text.replace(/\.(mp4|mkv|avi|mov|wmv|flv)$/i, "").trim()
      nfoContent.setValue(generateNfoContent(r, fname))
    } else {
      errorMessage.setValue(error || "未知错误")
    }
  }

  async function handleExportNfo() {
    const nfo = nfoContent.value
    if (!nfo) return

    const data = Data.fromRawString(nfo, "utf8")
    if (!data) return

    const fname = inputText.value
      .replace(/\.(mp4|mkv|avi|mov|wmv|flv)$/i, "")
      .trim()
      .replace(/[\s.]+/g, ".")

    await DocumentPicker.exportFiles({
      files: [
        {
          data,
          name: `${fname}.nfo`,
        },
      ],
    })
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="Hegre NFO Generator"
        navigationBarTitleDisplayMode="large"
      >
        {/* Input Section */}
        <Section title="文件名输入">
          <TextField
            title="文件名"
            prompt="例如: Hegre.A.Day.In.The.Alya"
            value={inputText}
            autofocus
          />
          <Button
            title={isLoading.value ? "正在获取…" : "获取"}
            systemImage="magnifyingglass"
            action={handleFetch}
          />
        </Section>

        {/* Loading */}
        {isLoading.value && (
          <Section title="正在刮削…">
            <HStack alignment="center" spacing={12}>
              <ProgressView />
              <Text font="body">正在从 Hegre 官网获取数据，并验证日期…</Text>
            </HStack>
          </Section>
        )}

        {/* Error */}
        {errorMessage.value !== "" && (
          <Section title="错误">
            <Text>{errorMessage.value}</Text>
          </Section>
        )}

        {/* Result */}
        {scrapedResult.value && (
          <>
            <Section title="基本信息">
              <VStack alignment="leading" spacing={4}>
                <HStack spacing={4}>
                  <Text font="caption">中文标题：</Text>
                  <Text font={12}>{scrapedResult.value.enTitle}</Text>
                </HStack>
                <HStack spacing={4}>
                  <Text font="caption">原标题 (EN)：</Text>
                  <Text font={12}>{scrapedResult.value.originalTitle}</Text>
                </HStack>
                <HStack spacing={4}>
                  <Text font="caption">日期：</Text>
                  <Text font={12}>{scrapedResult.value.releaseDate}</Text>
                </HStack>
                <HStack spacing={4}>
                  <Text font="caption">时长：</Text>
                  <Text font={12}>{scrapedResult.value.runtime} min</Text>
                </HStack>
                <HStack spacing={4}>
                  <Text font="caption">系列：</Text>
                  <Text font={12}>{scrapedResult.value.series}</Text>
                </HStack>
                <HStack spacing={4}>
                  <Text font="caption">分类：</Text>
                  <Text font={12}>{scrapedResult.value.genres.join(" / ")}</Text>
                </HStack>
                <HStack spacing={4}>
                  <Text font="caption">标签：</Text>
                  <Text font={12}>{scrapedResult.value.tags.join(" · ")}</Text>
                </HStack>
                <Link url={scrapedResult.value.url}>
                  <Text font="subheadline">打开 Hegre 页面 ↗</Text>
                </Link>
              </VStack>
            </Section>

            <Section title="海报 Poster">
              {(() => {
                const url = scrapedResult.value!.posterUrl
                const linkMenu = (
                  <Group>
                    <Button title="打开链接" systemImage="safari" action={() => { openURL(url) }} />
                    <Button title="拷贝链接" systemImage="doc.on.doc" action={() => { Pasteboard.setURL(url) }} />
                    <Button title="共享..." systemImage="square.and.arrow.up" action={() => { ShareSheet.present([url]) }} />
                  </Group>
                )
                return (
              <VStack alignment="leading" spacing={8}>
                <Text font="caption">竖版 (1440x)：</Text>
                <Text font={12} contextMenu={{ menuItems: linkMenu }}>{url}</Text>
                <Image
                  imageUrl={url}
                  resizable
                  scaleToFit
                  frame={{ maxHeight: 200 }}
                  contextMenu={{ menuItems: linkMenu }}
                />
              </VStack>
                )
              })()}
            </Section>

            <Section title="封面 Board">
              {(() => {
                const url = scrapedResult.value!.boardUrl
                const linkMenu = (
                  <Group>
                    <Button title="打开链接" systemImage="safari" action={() => { openURL(url) }} />
                    <Button title="拷贝链接" systemImage="doc.on.doc" action={() => { Pasteboard.setURL(url) }} />
                    <Button title="共享..." systemImage="square.and.arrow.up" action={() => { ShareSheet.present([url]) }} />
                  </Group>
                )
                return (
              <VStack alignment="leading" spacing={8}>
                <Text font="caption">横版 (3840x)：</Text>
                <Text font={12} contextMenu={{ menuItems: linkMenu }}>{url}</Text>
                <Image
                  imageUrl={url}
                  resizable
                  scaleToFit
                  frame={{ maxHeight: 150 }}
                  contextMenu={{ menuItems: linkMenu }}
                />
              </VStack>
                )
              })()}
            </Section>

            <Section title="📁 文件夹名">
              {(() => {
                const r = scrapedResult.value!
                const yy = r.releaseDate.substring(2, 4)
                const mm = r.releaseDate.substring(5, 7)
                const dd = r.releaseDate.substring(8, 10)
                const name = `Hegre.${yy}.${mm}.${dd}.${r.enTitle}`
                return (
              <HStack spacing={8}>
                <Text font={12}>{name}</Text>
                <Spacer />
                <Button
                  title=""
                  systemImage="doc.on.doc"
                  controlSize="small"
                  action={() => { Pasteboard.setString(name) }}
                />
              </HStack>
                )
              })()}
            </Section>

            <Section title="📄 文件名">
              {(() => {
                const r = scrapedResult.value!
                const yy = r.releaseDate.substring(2, 4)
                const mm = r.releaseDate.substring(5, 7)
                const dd = r.releaseDate.substring(8, 10)
                const name = `Hegre.${yy}.${mm}.${dd}.${r.originalTitle.replace(/[\s\-]+/g, ".")}`
                return (
              <HStack spacing={8}>
                <Text font={12}>{name}</Text>
                <Spacer />
                <Button
                  title=""
                  systemImage="doc.on.doc"
                  controlSize="small"
                  action={() => { Pasteboard.setString(name) }}
                />
              </HStack>
                )
              })()}
            </Section>

            <Section title="NFO 文件">
              <VStack alignment="leading" spacing={8}>
                <Button
                  title="导出 NFO 文件"
                  systemImage="square.and.arrow.up"
                  action={handleExportNfo}
                />
                <Text font="caption" >点击后将生成 .nfo 文件并通过系统分享导出。</Text>
              </VStack>
            </Section>

            <Section title="NFO 预览">
              <Text font={10}>{nfoContent.value}</Text>
            </Section>
          </>
        )}
      </List>
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present(<MainView />)
  Script.exit()
}

run()
