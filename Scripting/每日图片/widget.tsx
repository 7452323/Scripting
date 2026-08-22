// 每日一言一图 — 小组件（优化内存版）
import { VStack, ZStack, Text, Image, Spacer, Widget, fetch } from "scripting"

const IMG_API = "https://imgapi.cn/cos.php"
const HITOKOTO_API = "https://v1.hitokoto.cn"
const MAX_IMAGE_SIDE = 1200 // 限制最长边，覆盖 @3x 大屏需求，避免 widget 内存溢出
const JPEG_QUALITY = 0.9    // 高质量缓存，接近无损

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface Hitokoto { hitokoto: string; from_who: string | null; from: string; type: string }

async function fetchHitokoto(): Promise<Hitokoto> {
  const r = await fetch(HITOKOTO_API)
  return JSON.parse(await r.text())
}

/** 计算图片亮度 */
function brightness(img: UIImage): number | null {
  const c = img.averageColor()
  if (!c) return null
  return 0.2126 * c.red + 0.7152 * c.green + 0.0722 * c.blue
}

/** 自适应文字颜色：深色背景 → 浅色文字，浅色背景 → 深色文字 */
function adaptiveTextColor(img: UIImage): { main: string; sub: string } {
  const c = img.averageColor()
  if (!c) return { main: "rgba(255,255,255,0.92)", sub: "rgba(255,255,255,0.55)" }

  // 感知亮度 (0-1)
  const lum = 0.2126 * c.red + 0.7152 * c.green + 0.0722 * c.blue

  if (lum > 0.6) {
    // 浅色背景 → 深色文字
    return {
      main: `rgba(${Math.round(c.red * 120)}, ${Math.round(c.green * 120)}, ${Math.round(c.blue * 120)}, 0.92)`,
      sub: `rgba(${Math.round(c.red * 180)}, ${Math.round(c.green * 180)}, ${Math.round(c.blue * 180)}, 0.6)`
    }
  } else if (lum > 0.35) {
    // 中等亮度 → 白色文字（更通用）
    return { main: "rgba(255,255,255,0.92)", sub: "rgba(255,255,255,0.55)" }
  } else {
    // 深色背景 → 浅色文字
    return { main: "rgba(255,255,255,0.92)", sub: "rgba(255,255,255,0.55)" }
  }
}

/** 缩放图片到最大边长限制，减少内存占用 */
function resizeImage(img: UIImage, maxSide: number): UIImage {
  const w = img.width
  const h = img.height
  if (w <= maxSide && h <= maxSide) return img

  const ratio = Math.min(maxSide / w, maxSide / h)
  const newW = Math.round(w * ratio)
  const newH = Math.round(h * ratio)

  const thumb = img.preparingThumbnail({ width: newW, height: newH })
  return thumb || img  // 缩放失败则返回原图
}

function DailyWidget(props: { text: string; source: string; bgImage: UIImage | null; textColor: string; subColor: string }) {
  const f = Widget.family
  const s = Widget.displaySize
  const sm = f === "systemSmall"
  const md = f === "systemMedium"
  const tc = props.textColor as any
  const sc = props.subColor as any
  return (
    <ZStack>
      {props.bgImage ? <Image image={props.bgImage} widgetAccentedRenderingMode="desaturated" resizable scaleToFill frame={{ width: s.width, height: s.height }} /> : null}
      <VStack>
        <Text widgetAccentable font={sm ? 8 : md ? 9 : 11} foregroundStyle={sc} padding={{ horizontal: sm ? 8 : 12, vertical: sm ? 4 : 6 }}>每日一言一图</Text>
        <Spacer />
        <VStack padding={{ horizontal: sm ? 10 : 14, vertical: sm ? 8 : 10 }}>
          <Text widgetAccentable font={sm ? 10 : md ? 12 : 15} foregroundStyle={tc} lineLimit={sm ? 5 : md ? 4 : 8}>{props.text}</Text>
          {props.source ? <Text widgetAccentable font={sm ? 9 : md ? 10 : 12} foregroundStyle={sc}>—— {props.source}</Text> : null}
        </VStack>
      </VStack>
    </ZStack>
  )
}

/* 纯文字 fallback（图片渲染失败时显示） */
function TextOnlyWidget(props: { text: string; source: string }) {
  const f = Widget.family
  const sm = f === "systemSmall"
  const md = f === "systemMedium"
  return (
    <VStack padding={{ horizontal: sm ? 10 : 14, vertical: sm ? 8 : 10 }} widgetBackground="#1a1a2e">
      <Text widgetAccentable font={sm ? 8 : md ? 9 : 11} foregroundStyle="rgba(255,255,255,0.55)" padding={{ horizontal: sm ? 8 : 12, vertical: sm ? 4 : 6 }}>每日一言一图</Text>
      <Spacer />
      <Text widgetAccentable font={sm ? 10 : md ? 12 : 15} foregroundStyle="rgba(255,255,255,0.92)" fontWeight="medium" lineLimit={sm ? 5 : md ? 4 : 8}>{props.text}</Text>
      {props.source ? <Text widgetAccentable font={sm ? 9 : md ? 10 : 12} foregroundStyle="rgba(255,255,255,0.55)">—— {props.source}</Text> : null}
    </VStack>
  )
}

;(async () => {
  try {
    const dir = FileManager.appGroupDocumentsDirectory
    const day = today()
    const cachePath = `${dir}/daily_quote_bg_${day}.jpg`
    const metaPath = `${dir}/daily_quote_meta_${day}.json`

    let bgImage: UIImage | null = null
    let hitokoto: Hitokoto | null = null
    let source: string = ""

    // 1. 读取共享缓存
    if (await FileManager.exists(cachePath)) {
      bgImage = UIImage.fromFile(cachePath)
    }
    if (await FileManager.exists(metaPath)) {
      try {
        const meta = JSON.parse(await FileManager.readAsString(metaPath))
        hitokoto = meta.hitokoto
        source = meta.source || ""
      } catch {}
    }

    // 2. 缓存缺失 → 网络获取
    if (!bgImage || !hitokoto) {
      const [img, hk] = await Promise.all([
        (async () => {
          try {
            const r = await fetch(IMG_API)
            const d = await r.data()
            if (!d) return null
            const original = UIImage.fromData(d)
            if (!original) return null
            // 缩放到安全尺寸，避免 widget 内存溢出
            return resizeImage(original, MAX_IMAGE_SIDE)
          } catch { return null }
        })(),
        fetchHitokoto()
      ])

      if (img && !bgImage) {
        bgImage = img
        try {
          const jpg = img.toJPEGData(JPEG_QUALITY)
          if (jpg) {
            try { await FileManager.remove(cachePath) } catch {}
            await FileManager.writeAsData(cachePath, jpg)
          }
        } catch {}
      }

      if (!hitokoto && hk) {
        hitokoto = hk
        source = hk.from_who || hk.from || ""
        try {
          await FileManager.writeAsString(metaPath, JSON.stringify({ hitokoto: hk, source }))
        } catch {}
      }
    } else {
      // 缓存命中时，如果图片太大也缩放（兼容旧缓存）
      if (bgImage && (bgImage.width > MAX_IMAGE_SIDE || bgImage.height > MAX_IMAGE_SIDE)) {
        const resized = resizeImage(bgImage, MAX_IMAGE_SIDE)
        if (resized) bgImage = resized
      }
    }

    if (!hitokoto) throw new Error("无可用数据")

    // 尝试渲染带图片的 widget，失败则 fallback 到纯文字
    try {
      if (!bgImage) throw new Error("无图片")
      const colors = adaptiveTextColor(bgImage)
      Widget.present(
        <DailyWidget text={hitokoto.hitokoto} source={source} bgImage={bgImage} textColor={colors.main} subColor={colors.sub} />,
        { policy: "after", date: new Date(Date.now() + 4 * 3600 * 1000) }
      )
    } catch {
      // 图片渲染失败 → fallback 到纯文字模式
      Widget.present(
        <TextOnlyWidget text={hitokoto.hitokoto} source={source} />,
        { policy: "after", date: new Date(Date.now() + 4 * 3600 * 1000) }
      )
    }
  } catch (e: unknown) {
    const m = e instanceof Error ? e.message : String(e)
    Widget.present(
      <VStack padding={8}>
        <Text font="headline">每日一言一图</Text><Spacer />
        <Text font="footnote" opacity={0.6}>加载失败</Text>
        <Text font="caption2" opacity={0.4}>{m}</Text>
      </VStack>
    )
  }
})()
