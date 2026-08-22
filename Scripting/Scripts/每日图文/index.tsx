// 每日图文 — 主页
import {
  Button, Navigation, NavigationStack, List, Section, VStack, HStack, ZStack,
  Text, Image, Widget, fetch, useState, useEffect, Spacer, Script
} from "scripting"

declare function alert(options: { title: string; message: string }): Promise<void>

const IMG_API = "https://imgapi.cn/cos.php"
const HITOKOTO_API = "https://v1.hitokoto.cn"

const FIXED_IMG_KEY = "daily_quote_fixed_img"
const FIXED_HK_KEY = "daily_quote_fixed_hk"
const FIXED_BRIGHT_KEY = "daily_quote_fixed_bright"

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface Hitokoto { hitokoto: string; from_who: string | null; from: string; type: string }

async function fetchHitokoto(): Promise<Hitokoto> {
  const r = await fetch(HITOKOTO_API)
  return JSON.parse(await r.text())
}

const MAX_IMAGE_SIDE = 1200
const JPEG_QUALITY = 0.9

/** 计算图片亮度 */
function brightness(img: UIImage): number | null {
  const t = img.preparingThumbnail({ width: 1, height: 1 }); if (!t) return null
  const png = t.toPNGBase64String(); if (!png) return null
  const px = Data.fromBase64String(png)?.toIntArray(); if (!px || px.length < 4) return null
  return Math.round(0.2126 * px[1] + 0.7152 * px[2] + 0.0722 * px[3])
}

/** 缩放图片到最大边长限制 */
function resizeImage(img: UIImage, maxSide: number): UIImage {
  const w = img.width
  const h = img.height
  if (w <= maxSide && h <= maxSide) return img
  const ratio = Math.min(maxSide / w, maxSide / h)
  const newW = Math.round(w * ratio)
  const newH = Math.round(h * ratio)
  const thumb = img.preparingThumbnail({ width: newW, height: newH })
  return thumb || img
}

/** 自适应文字颜色：深色背景→浅色文字，浅色背景→深色文字 */
function adaptiveTextColor(img: UIImage): { main: string; sub: string } {
  const c = img.averageColor()
  if (!c) return { main: "rgba(255,255,255,0.92)", sub: "rgba(255,255,255,0.55)" }
  const lum = 0.2126 * c.red + 0.7152 * c.green + 0.0722 * c.blue
  if (lum > 0.6) {
    return {
      main: "rgba(0,0,0,0.88)",
      sub: "rgba(0,0,0,0.55)"
    }
  } else if (lum > 0.35) {
    return { main: "rgba(255,255,255,0.92)", sub: "rgba(255,255,255,0.55)" }
  } else {
    return { main: "rgba(255,255,255,0.92)", sub: "rgba(255,255,255,0.55)" }
  }
}

/* ───────── 主页面 ───────── */

function MainPage() {
  const [hitokoto, setHitokoto] = useState<Hitokoto | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshingImg, setRefreshingImg] = useState(false)
  const [refreshingQuote, setRefreshingQuote] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bgImage, setBgImage] = useState<UIImage | null>(null)
  const [bright, setBright] = useState<number | null>(null)
  const [fixedHitokoto, setFixedHitokoto] = useState<Hitokoto | null>(null)

  const dismiss = Navigation.useDismiss()

  useEffect(() => {
    const fixedHkRaw = Storage.get<string>(FIXED_HK_KEY)
    if (fixedHkRaw) {
      try { setFixedHitokoto(JSON.parse(fixedHkRaw)) } catch {}
    }
    loadData()
  }, [])

  /** 从网络获取图片 → 返回 UIImage + 写入共享缓存 */
  async function fetchAndCacheImage(): Promise<{ image: UIImage | null; bright: number | null }> {
    try {
      const dir = FileManager.appGroupDocumentsDirectory
      const day = today()
      const cachePath = `${dir}/daily_quote_bg_${day}.jpg`

      const imgRes = await fetch(IMG_API)
      const imgData = await imgRes.data()
      if (!imgData) return { image: null, bright: null }

      const original = UIImage.fromData(imgData)
      if (!original) return { image: null, bright: null }

      // 缩放到安全尺寸，避免 widget 内存溢出
      const img = resizeImage(original, MAX_IMAGE_SIDE)
      const b = brightness(img)

      // 写入共享缓存（widget.tsx 读取同一文件）
      try {
        const jpg = img.toJPEGData(JPEG_QUALITY)
        if (jpg) {
          try { await FileManager.remove(cachePath) } catch {}
          await FileManager.writeAsData(cachePath, jpg)
        }
      } catch {}

      return { image: img, bright: b }
    } catch {
      return { image: null, bright: null }
    }
  }

  /** 初始化加载 */
  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const dir = FileManager.appGroupDocumentsDirectory
      const day = today()
      const cachePath = `${dir}/daily_quote_bg_${day}.jpg`
      const metaPath = `${dir}/daily_quote_meta_${day}.json`

      // 加载图片
      const fixedImgPath = Storage.get<string>(FIXED_IMG_KEY)
      if (fixedImgPath && await FileManager.exists(fixedImgPath)) {
        setBgImage(UIImage.fromFile(fixedImgPath))
        const b = Storage.get<string>(FIXED_BRIGHT_KEY)
        setBright(b ? Number(b) : null)
      } else if (await FileManager.exists(cachePath)) {
        setBgImage(UIImage.fromFile(cachePath))
        // 从 meta 读取亮度
        if (await FileManager.exists(metaPath)) {
          try {
            const meta = JSON.parse(await FileManager.readAsString(metaPath))
            setBright(meta.bright || null)
          } catch {}
        }
      } else {
        const result = await fetchAndCacheImage()
        setBgImage(result.image)
        setBright(result.bright)
      }

      // 加载一言
      const fixedHkRaw = Storage.get<string>(FIXED_HK_KEY)
      if (fixedHkRaw) {
        try { setHitokoto(JSON.parse(fixedHkRaw)) } catch { setHitokoto(await fetchHitokoto()) }
      } else if (await FileManager.exists(metaPath)) {
        try {
          const meta = JSON.parse(await FileManager.readAsString(metaPath))
          setHitokoto(meta.hitokoto)
        } catch { setHitokoto(await fetchHitokoto()) }
      } else {
        setHitokoto(await fetchHitokoto())
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setLoading(false)
  }

  /** 仅刷新图片 */
  async function handleRefreshImage() {
    setRefreshingImg(true)
    setError(null)
    try {
      // 清除固定状态
      Storage.remove(FIXED_IMG_KEY)
      Storage.remove(FIXED_BRIGHT_KEY)

      const result = await fetchAndCacheImage()
      if (result.image) {
        setBgImage(result.image)
        setBright(result.bright)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setRefreshingImg(false)
  }

  /** 仅刷新一言 */
  async function handleRefreshQuote() {
    setRefreshingQuote(true)
    setError(null)
    try {
      // 清除固定状态
      Storage.remove(FIXED_HK_KEY)
      setFixedHitokoto(null)

      const hk = await fetchHitokoto()
      setHitokoto(hk)

      // 更新 meta 缓存
      const dir = FileManager.appGroupDocumentsDirectory
      const metaPath = `${dir}/daily_quote_meta_${today()}.json`
      const source = hk.from_who || hk.from || ""
      await FileManager.writeAsString(metaPath, JSON.stringify({
        hitokoto: hk,
        source,
        bright
      }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setRefreshingQuote(false)
  }

  /** 固定当前图文 */
  async function handlePin() {
    if (!hitokoto || !bgImage) return
    Storage.set(FIXED_HK_KEY, JSON.stringify(hitokoto))
    // 保存当前图片为固定
    const dir = FileManager.appGroupDocumentsDirectory
    const fixedPath = `${dir}/daily_quote_fixed.jpg`
    try {
      const jpg = bgImage.toJPEGData(JPEG_QUALITY)
      if (jpg) {
        try { await FileManager.remove(fixedPath) } catch {}
        await FileManager.writeAsData(fixedPath, jpg)
        Storage.set(FIXED_IMG_KEY, fixedPath)
      }
    } catch {}
    if (bright != null) Storage.set(FIXED_BRIGHT_KEY, String(bright))
    setFixedHitokoto(hitokoto)
    alert({
      title: "已固定图文",
      message: "当前图片和一言已固定，小组件将永久显示此图文。点击取消固定可恢复自动刷新。"
    })
  }

  /** 取消固定 */
  function handleUnpin() {
    Storage.remove(FIXED_IMG_KEY)
    Storage.remove(FIXED_HK_KEY)
    Storage.remove(FIXED_BRIGHT_KEY)
    setFixedHitokoto(null)
    alert({
      title: "已取消固定",
      message: "已恢复自动刷新行为，小组件将按 4 小时周期获取新图文。"
    })
  }

  const displayHk = fixedHitokoto || hitokoto
  const source = displayHk ? (displayHk.from_who || displayHk.from || "") : ""
  const isPinned = fixedHitokoto != null

  return (
    <NavigationStack>
      <List
        navigationTitle="每日图文"
        navigationBarTitleDisplayMode="large"
        toolbar={{
          cancellationAction: (
            <Button title="关闭" action={dismiss} />
          )
        }}
      >
        {/* 顶部预览图 */}
        <Section>
          <VStack spacing={0}>
            {bgImage ? (
              <Image image={bgImage} resizable scaleToFill frame={{ maxWidth: "infinity", minHeight: 200, maxHeight: 240 }} />
            ) : loading ? (
              <VStack frame={{ maxWidth: "infinity", minHeight: 200, maxHeight: 240 }} background="systemGray6">
                <Image systemName="photo" font="largeTitle" foregroundStyle="systemGray3" />
                <Text font="caption" foregroundStyle="systemGray2">加载中...</Text>
              </VStack>
            ) : (
              <VStack frame={{ maxWidth: "infinity", minHeight: 200, maxHeight: 240 }} background="#fde8e8">
                <Image systemName="exclamationmark.triangle" font="largeTitle" foregroundStyle="systemRed" />
                <Text font="caption" foregroundStyle="systemRed">{error || "加载失败"}</Text>
              </VStack>
            )}
            {isPinned ? (
              <HStack spacing={4} padding={{ horizontal: 12, top: 6 }}>
                <Image systemName="pin.fill" font="caption2" foregroundStyle="systemOrange" />
                <Text font="caption2" foregroundStyle="systemOrange">已固定</Text>
              </HStack>
            ) : null}

            {/* 一言内容 */}
            {displayHk?.hitokoto ? (() => {
              const imgColors = bgImage ? adaptiveTextColor(bgImage) : null
              const mainColor = (imgColors?.main || "label") as any
              const subColor = (imgColors?.sub || "systemGray") as any
              return (
                <VStack padding={{ horizontal: 16, vertical: 14 }} spacing={6}>
                  <Image systemName="quote.opening" font="title3" foregroundStyle={subColor} />
                  <Text font="body" fontWeight="medium" lineSpacing={4} foregroundStyle={mainColor}>
                    {displayHk.hitokoto}
                  </Text>
                  {source ? (
                    <HStack>
                      <Text font="caption" foregroundStyle={subColor}>— </Text>
                      <Text font="caption" fontWeight="medium" foregroundStyle={subColor}>
                        {source}
                      </Text>
                    </HStack>
                  ) : null}
                </VStack>
              )
            })() : loading ? (
              <VStack padding={20}>
                <Text font="caption" foregroundStyle="systemGray">加载中...</Text>
              </VStack>
            ) : (
              <VStack padding={20}>
                <Text font="caption" foregroundStyle="systemRed">{error || "加载失败"}</Text>
              </VStack>
            )}
          </VStack>
        </Section>

        {/* 小组件配置 */}
        <Section header={<Text font="footnote" foregroundStyle="systemGray">小组件配置</Text>}>
          <Button
            title={refreshingImg ? "刷新中..." : "🖼 刷新图片"}
            action={handleRefreshImage}
          />
          <Button
            title={refreshingQuote ? "刷新中..." : "💬 刷新一言"}
            action={handleRefreshQuote}
          />
          <Button
            title="📌 固定图文"
            action={handlePin}
          />
          <Button
            title="❌ 取消固定"
            action={handleUnpin}
          />
        </Section>

        {/* 小组件预览 */}
        <Section header={<Text font="footnote" foregroundStyle="systemGray">小组件预览</Text>}>
          <Button
            title="小号组件"
            action={async () => { await Widget.preview({ family: "systemSmall" }) }}
          />
          <Button
            title="中号组件"
            action={async () => { await Widget.preview({ family: "systemMedium" }) }}
          />
          <Button
            title="大号组件"
            action={async () => { await Widget.preview({ family: "systemLarge" }) }}
          />
        </Section>

        {/* 关于 */}
        <Section header={<Text font="footnote" foregroundStyle="systemGray">关于</Text>}>
          <HStack spacing={8}>
            <Image systemName="calendar" foregroundStyle="systemBlue" />
            <Text font="caption" foregroundStyle="systemGray">日期</Text>
            <Spacer />
            <Text font="caption" foregroundStyle="secondaryLabel">{today()}</Text>
          </HStack>
          <HStack spacing={8}>
            <Image systemName="link" foregroundStyle="systemTeal" />
            <Text font="caption" foregroundStyle="systemGray">数据源</Text>
            <Spacer />
            <Text font="caption" foregroundStyle="secondaryLabel">接口来源于网络</Text>
          </HStack>
          <HStack spacing={8}>
            <Image systemName="clock.arrow.circlepath" foregroundStyle="systemOrange" />
            <Text font="caption" foregroundStyle="systemGray">刷新策略</Text>
            <Spacer />
            <Text font="caption" foregroundStyle="secondaryLabel">每 4 小时</Text>
          </HStack>
          <HStack spacing={8}>
            <Image systemName="pin.fill" foregroundStyle="systemPurple" />
            <Text font="caption" foregroundStyle="systemGray">固定状态</Text>
            <Spacer />
            <Text font="caption" foregroundStyle="secondaryLabel">{isPinned ? "已固定" : "未固定"}</Text>
          </HStack>
        </Section>
      </List>
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present(<MainPage />)
  Script.exit()
}

run()
