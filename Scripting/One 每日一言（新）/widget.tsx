// ONE 每日一言 - Worker API
import { VStack, ZStack, Text, Image, Spacer, Widget, Device, fetch } from "scripting"

const WORKER = "https://one.1314k.eu.org/daily"
const REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000
const usesSystemBackground = Widget.isTransparentMode || Widget.isBlurMode || Widget.isTransparentBackground

function today(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

type Article = { author: string; desc: string; image: string }
type CachedArticle = { article: Article; fetchedAt?: number }

async function fetchArticle(): Promise<Article> {
  const response = await fetch(`${WORKER}?date=${today()}`)
  if (!response.ok) throw new Error(`请求失败（${response.status}）`)
  const data = JSON.parse(await response.text())
  if (data.error) throw new Error(data.error)
  return { author: data.author || "", desc: data.desc || "", image: data.image || "" }
}

function adaptiveTextColor(image: UIImage | null): { main: string; sub: string } {
  const color = image?.averageColor()
  if (!color) return { main: "rgba(255,255,255,0.92)", sub: "rgba(255,255,255,0.62)" }
  const brightness = 0.2126 * color.red + 0.7152 * color.green + 0.0722 * color.blue
  return brightness > 0.6
    ? { main: "rgba(0,0,0,0.88)", sub: "rgba(0,0,0,0.56)" }
    : { main: "rgba(255,255,255,0.92)", sub: "rgba(255,255,255,0.62)" }
}

function OneWidget(props: {
  desc: string
  author: string
  bgImage: UIImage | null
  textColor: string
  subColor: string
  updatedAt: Date
}) {
  const size = Widget.displaySize
  const small = Widget.family === "systemSmall"
  const medium = Widget.family === "systemMedium"

  return (
    <ZStack>
      {!usesSystemBackground && props.bgImage ? (
        <Image
          image={props.bgImage}
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
        <Text widgetAccentable font={small ? 8 : medium ? 9 : 11} foregroundStyle={props.subColor as any} padding={{ horizontal: small ? 8 : 12, vertical: small ? 4 : 6 }}>
          ONE - 每日一言
        </Text>
        <Spacer />
        <VStack padding={{ horizontal: small ? 10 : 14, vertical: small ? 8 : 10 }} spacing={3}>
          <Text widgetAccentable font={small ? 10 : medium ? 12 : 15} foregroundStyle={props.textColor as any} lineLimit={small ? 5 : medium ? 4 : 8}>
            {props.desc}
          </Text>
          {props.author ? <Text widgetAccentable font={small ? 9 : medium ? 10 : 12} foregroundStyle={props.subColor as any}>-- {props.author}</Text> : null}
          <Text widgetAccentable font={small ? 7 : 8} foregroundStyle={props.subColor as any} opacity={0.75}>
            更新 {props.updatedAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          </Text>
        </VStack>
      </VStack>
    </ZStack>
  )
}

async function readCachedArticle(path: string): Promise<CachedArticle | null> {
  if (!(await FileManager.exists(path))) return null
  try {
    return JSON.parse(await FileManager.readAsString(path)) as CachedArticle
  } catch {
    return null
  }
}

async function saveBackground(article: Article, path: string): Promise<UIImage | null> {
  if (!article.image) return null
  const raw = Data.fromBase64String(article.image.split(",")[1] || article.image)
  const image = raw ? UIImage.fromData(raw) : null
  if (!image) return null

  const scale = Device.screen.scale
  const size = Widget.displaySize
  const thumbnail = image.preparingThumbnail({
    width: Math.round(size.width * scale),
    height: Math.round(size.height * scale),
  })
  const jpeg = thumbnail?.toJPEGData(0.8)
  if (jpeg) await FileManager.writeAsData(path, jpeg)
  return thumbnail || image
}

;(async () => {
  const dir = FileManager.appGroupDocumentsDirectory
  const day = today()
  const imagePath = `${dir}/one_bg_${day}.jpg`
  const metadataPath = `${dir}/one_meta_${day}.json`

  try {
    const cached = await readCachedArticle(metadataPath)
    const isFresh = !!cached?.fetchedAt && Date.now() - cached.fetchedAt < REFRESH_INTERVAL_MS
    let article: Article
    let image: UIImage | null
    let updatedAt: Date

    if (isFresh && await FileManager.exists(imagePath)) {
      article = cached!.article
      image = UIImage.fromFile(imagePath)
      updatedAt = new Date(cached!.fetchedAt!)
    } else {
      try {
        article = await fetchArticle()
        image = await saveBackground(article, imagePath)
        updatedAt = new Date()
        await FileManager.writeAsString(metadataPath, JSON.stringify({ article, fetchedAt: updatedAt.getTime() }))
      } catch (error) {
        if (!cached?.article) throw error
        article = cached.article
        image = await FileManager.exists(imagePath) ? UIImage.fromFile(imagePath) : null
        updatedAt = cached.fetchedAt ? new Date(cached.fetchedAt) : new Date()
      }
    }

    const colors = adaptiveTextColor(image)
    Widget.present(
      <OneWidget desc={article.desc} author={article.author} bgImage={image} textColor={colors.main} subColor={colors.sub} updatedAt={updatedAt} />,
      { policy: "after", date: new Date(Date.now() + REFRESH_INTERVAL_MS) },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    Widget.present(
      <VStack padding={8} widgetBackground="clear">
        <Text font="headline">ONE</Text><Spacer />
        <Text font="footnote" opacity={0.6}>加载失败</Text>
        <Text font="caption2" opacity={0.4}>{message}</Text>
      </VStack>,
      { policy: "after", date: new Date(Date.now() + REFRESH_INTERVAL_MS) },
    )
  }
})()
