// 每日图文 — 桌面小组件
// v1.1.0（2026-09-06）：重构对齐「One 每日一言」的稳定渲染实现
//   - 缓存优先：命中当日共享缓存直接渲染，避免冷启动联网拖垮 WidgetKit
//   - 网络请求带超时 + 并行，任何一步失败都有兜底，不会整块空白
//   - 图片先按小组件实际尺寸压缩再渲染/缓存，降低 30MB 内存限制风险
//   - 任意分支都保证调用 Widget.present（图片 / 纯文字 / 错误卡）
//   - 支持 App 内「固定图文」：固定后小组件优先展示固定内容
import { VStack, ZStack, Text, Image, Spacer, Widget, Device, fetch } from "scripting"

const IMG_API = "https://imgapi.cn/cos.php"
const HITOKOTO_API = "https://v1.hitokoto.cn"
const REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000 // 刷新窗口 4 小时
const NETWORK_TIMEOUT_MS = 7000                // 网络超时，避免超出小组件执行窗口
const JPEG_QUALITY = 0.85

const FIXED_IMG_KEY = "daily_quote_fixed_img"
const FIXED_HK_KEY = "daily_quote_fixed_hk"

// 透明/毛玻璃背景模式下背景由系统绘制，内容需保持透明
const usesSystemBackground =
  Widget.isTransparentMode || Widget.isBlurMode || Widget.isTransparentBackground

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

interface Hitokoto {
  hitokoto: string
  from_who: string | null
  from: string
  type: string
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("网络超时")), ms),
    ),
  ])
}

async function fetchHitokoto(): Promise<Hitokoto> {
  const response = await withTimeout(fetch(HITOKOTO_API), NETWORK_TIMEOUT_MS)
  if (!response.ok) throw new Error(`请求失败（${response.status}）`)
  return JSON.parse(await response.text())
}

async function fetchQuoteSafely(): Promise<{ quote: Hitokoto; source: string } | null> {
  try {
    const quote = await fetchHitokoto()
    return { quote, source: quote.from_who || quote.from || "" }
  } catch {
    return null
  }
}

/** 下载随机背景图 → 压缩到当前小组件实际尺寸 → 返回（失败/超时返回 null） */
async function fetchBackgroundImage(): Promise<UIImage | null> {
  try {
    const response = await withTimeout(fetch(IMG_API), NETWORK_TIMEOUT_MS)
    if (!response.ok) return null
    const data = await response.data()
    if (!data) return null

    const original = UIImage.fromData(data)
    if (!original) return null

    // 只保留当前尺寸需要的像素，避免把原图塞进 30MB 限制的小组件
    const scale = Device.screen.scale
    const size = Widget.displaySize
    const thumbnail = original.preparingThumbnail({
      width: Math.round(size.width * scale),
      height: Math.round(size.height * scale),
    })
    return thumbnail || original
  } catch {
    return null
  }
}

/** 自适应文字颜色：亮图 → 深色字，暗图 → 白色字 */
function adaptiveTextColor(image: UIImage | null): { main: string; sub: string } {
  const c = image?.averageColor()
  if (!c) return { main: "rgba(255,255,255,0.92)", sub: "rgba(255,255,255,0.6)" }
  const lum = 0.2126 * c.red + 0.7152 * c.green + 0.0722 * c.blue
  if (lum > 0.6) {
    return { main: "rgba(0,0,0,0.88)", sub: "rgba(0,0,0,0.55)" }
  }
  return { main: "rgba(255,255,255,0.92)", sub: "rgba(255,255,255,0.6)" }
}

function storageGet(key: string): string {
  try {
    const value = Storage.get(key) as string | undefined
    return typeof value === "string" ? value : ""
  } catch {
    return ""
  }
}

function parseHitokoto(raw: string): Hitokoto | null {
  try {
    return JSON.parse(raw) as Hitokoto
  } catch {
    return null
  }
}

async function readJsonFile(path: string): Promise<any | null> {
  try {
    if (!(await FileManager.exists(path))) return null
    return JSON.parse(await FileManager.readAsString(path))
  } catch {
    return null
  }
}

async function writeJpeg(image: UIImage, path: string): Promise<void> {
  try {
    const jpeg = image.toJPEGData(JPEG_QUALITY)
    if (jpeg) {
      if (await FileManager.exists(path)) {
        try { await FileManager.remove(path) } catch {}
      }
      await FileManager.writeAsData(path, jpeg)
    }
  } catch {}
}

/* ───────── 图片 + 文字组件（默认形态） ───────── */

function PhotoWidget(props: { quote: string; source: string; image: UIImage }) {
  const size = Widget.displaySize
  const small = Widget.family === "systemSmall"
  const medium = Widget.family === "systemMedium"
  const colors = adaptiveTextColor(props.image)
  const main = colors.main as any
  const sub = colors.sub as any

  return (
    <ZStack>
      {!usesSystemBackground ? (
        <Image
          image={props.image}
          resizable
          scaleToFill
          widgetBackground="clear"
          widgetAccentedRenderingMode="desaturated"
          frame={{ width: size.width, height: size.height }}
        />
      ) : (
        <VStack frame={{ width: size.width, height: size.height }} widgetBackground="clear" />
      )}
      <VStack>
        <Text widgetAccentable font={small ? 8 : medium ? 9 : 11} foregroundStyle={sub} padding={{ horizontal: small ? 8 : 12, vertical: small ? 4 : 6 }}>
          每日图文
        </Text>
        <Spacer />
        <VStack padding={{ horizontal: small ? 10 : 14, vertical: small ? 8 : 10 }} spacing={3}>
          <Text widgetAccentable font={small ? 10 : medium ? 12 : 15} foregroundStyle={main} lineLimit={small ? 5 : medium ? 4 : 8}>
            {props.quote}
          </Text>
          {props.source ? (
            <Text widgetAccentable font={small ? 9 : medium ? 10 : 12} foregroundStyle={sub}>
              —— {props.source}
            </Text>
          ) : null}
        </VStack>
      </VStack>
    </ZStack>
  )
}

/* ───────── 纯文字兜底组件（无图/图片加载失败时） ───────── */

function TextOnlyWidget(props: { quote: string; source: string }) {
  const small = Widget.family === "systemSmall"
  const medium = Widget.family === "systemMedium"
  return (
    <VStack
      padding={{ horizontal: small ? 10 : 14, vertical: small ? 8 : 10 }}
      widgetBackground={usesSystemBackground ? "clear" : "#141830"}
    >
      <Text widgetAccentable font={small ? 8 : medium ? 9 : 11} foregroundStyle="rgba(255,255,255,0.55)" padding={{ horizontal: small ? 8 : 12, vertical: small ? 4 : 6 }}>
        每日图文
      </Text>
      <Spacer />
      <Text widgetAccentable font={small ? 11 : medium ? 13 : 16} foregroundStyle="rgba(255,255,255,0.92)" fontWeight="medium" lineLimit={small ? 6 : medium ? 5 : 10}>
        {props.quote}
      </Text>
      {props.source ? (
        <Text widgetAccentable font={small ? 9 : medium ? 10 : 12} foregroundStyle="rgba(255,255,255,0.55)">
          —— {props.source}
        </Text>
      ) : null}
    </VStack>
  )
}

/* ───────── 错误兜底组件 ───────── */

function ErrorWidget(props: { message: string }) {
  return (
    <VStack padding={10} widgetBackground={usesSystemBackground ? "clear" : "#141830"}>
      <Text font="headline" foregroundStyle="white">每日图文</Text>
      <Spacer />
      <Text font="footnote" opacity={0.85} foregroundStyle="white">加载失败</Text>
      <Text font="caption2" opacity={0.6} foregroundStyle="white" lineLimit={3}>{props.message}</Text>
    </VStack>
  )
}

/* ───────── 主流程 ───────── */

async function main(): Promise<void> {
  const dir = FileManager.appGroupDocumentsDirectory
  const day = today()
  const imagePath = `${dir}/daily_quote_bg_${day}.jpg`
  const metaPath = `${dir}/daily_quote_meta_${day}.json`

  // 1) 固定图文优先（App 里点过 📌 固定图文）
  let image: UIImage | null = null
  let quote: Hitokoto | null = null
  let source = ""

  const pinnedPath = storageGet(FIXED_IMG_KEY)
  if (pinnedPath && (await FileManager.exists(pinnedPath))) {
    image = UIImage.fromFile(pinnedPath)
    const pinned = parseHitokoto(storageGet(FIXED_HK_KEY))
    if (pinned) {
      quote = pinned
      source = pinned.from_who || pinned.from || ""
    }
  }

  // 2) 今日共享缓存（index.tsx 每次打开/刷新都会写入）
  if (!image && (await FileManager.exists(imagePath))) {
    image = UIImage.fromFile(imagePath)
  }
  if (!quote) {
    const meta = await readJsonFile(metaPath)
    if (meta?.hitokoto) {
      quote = meta.hitokoto
      source = meta.source || ""
    }
  }

  // 3) 缓存不完整 → 联网补齐（并行 + 超时，失败走兜底，不让组件空白）
  let newQuote: { quote: Hitokoto; source: string } | null = null
  let newImage: UIImage | null = null
  if (!quote || !image) {
    const results = await Promise.all([
      quote ? Promise.resolve(null) : fetchQuoteSafely(),
      image ? Promise.resolve(null) : fetchBackgroundImage(),
    ])
    newQuote = results[0]
    newImage = results[1]
    if (newQuote) {
      quote = newQuote.quote
      source = newQuote.source
    }
    if (newImage) image = newImage
  }

  // 4) 写回当日缓存，下次渲染直接命中
  if (newQuote) {
    try {
      await FileManager.writeAsString(metaPath, JSON.stringify({ hitokoto: newQuote.quote, source: newQuote.source }))
    } catch {}
  }
  if (newImage) {
    await writeJpeg(newImage, imagePath)
  }

  const nextRefresh = new Date(Date.now() + REFRESH_INTERVAL_MS)
  if (!quote) {
    // 彻底没有内容：给出一个能看的默认句 + 提示
    quote = { hitokoto: "愿今天的一切都恰到好处。", from_who: null, from: "", type: "daily" }
    source = "每日图文"
  }

  if (image && quote) {
    Widget.present(
      <PhotoWidget quote={quote.hitokoto} source={source} image={image} />,
      { policy: "after", date: nextRefresh },
    )
  } else {
    Widget.present(
      <TextOnlyWidget quote={quote.hitokoto} source={source} />,
      { policy: "after", date: nextRefresh },
    )
  }
}

;(async () => {
  try {
    await main()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      Widget.present(
        <ErrorWidget message={message} />,
        { policy: "after", date: new Date(Date.now() + REFRESH_INTERVAL_MS) },
      )
    } catch {}
  }
})()
