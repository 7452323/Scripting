// ONE 每日一言 — 主页
import {
  Button, Navigation, NavigationStack, List, Section, VStack, HStack, ZStack,
  Text, Image, Widget, fetch, useState, useEffect, Spacer, Script
} from "scripting"

const WORKER = "https://one.1314k.eu.org/daily"

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface Article { author: string; desc: string; image: string }

async function fetchArticle(): Promise<Article> {
  const r = await fetch(`${WORKER}?date=${today()}`)
  const d = JSON.parse(await r.text())
  if (d.error) throw new Error(d.error)
  return { author: d.author || "", desc: d.desc || "", image: d.image || "" }
}

/* ───────── 主页面 ───────── */

function MainPage() {
  const [article, setArticle] = useState<Article | null>(null)
  const [imgPath, setImgPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const dismiss = Navigation.useDismiss()

  useEffect(() => {
    let active = true
    fetchArticle()
      .then(async (a) => {
        if (!active) return
        setArticle(a)
        // 保存图片用于展示
        if (a.image) {
          const b64 = a.image.split(",")[1] || a.image
          const dir = FileManager.appGroupDocumentsDirectory
          const p = `${dir}/one_preview_bg.jpg`
          const raw = Data.fromBase64String(b64)
          if (raw) {
            try { await FileManager.remove(p) } catch {}
            await FileManager.writeAsData(p, raw)
            if (active) setImgPath(p)
          }
        }
        setLoading(false)
      })
      .catch(e => { if (active) { setError(e instanceof Error ? e.message : String(e)); setLoading(false) } })
    return () => { active = false }
  }, [])

  return (
    <NavigationStack>
      <List
        navigationTitle="ONE · 每日一言"
        navigationBarTitleDisplayMode="large"
        toolbar={{
          cancellationAction: (
            <Button title="关闭" action={dismiss} />
          )
        }}
      >
        {/* 顶部大图卡片 */}
        <Section>
          <VStack spacing={0}>
            {imgPath ? (
              <Image filePath={imgPath} resizable scaleToFill frame={{ maxWidth: "infinity", minHeight: 200, maxHeight: 240 }} />
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

            {/* 引言内容 */}
            {article?.desc ? (() => {
              let mainColor: any = "label"
              let subColor: any = "systemGray"
              if (imgPath) {
                const img = UIImage.fromFile(imgPath)
                if (img) {
                  const c = img.averageColor()
                  if (c) {
                    const lum = 0.2126 * c.red + 0.7152 * c.green + 0.0722 * c.blue
                    if (lum > 0.6) {
                      mainColor = "rgba(0,0,0,0.88)"
                      subColor = "rgba(0,0,0,0.55)"
                    } else {
                      mainColor = "rgba(255,255,255,0.92)"
                      subColor = "rgba(255,255,255,0.55)"
                    }
                  }
                }
              }
              return (
                <VStack padding={{ horizontal: 16, vertical: 14 }} spacing={6}>
                  <Image systemName="quote.opening" font="title3" foregroundStyle={subColor} />
                  <Text font="body" fontWeight="medium" lineSpacing={4} foregroundStyle={mainColor}>
                    {article.desc}
                  </Text>
                  {article.author ? (
                    <HStack>
                      <Text font="caption" foregroundStyle={subColor}>— </Text>
                      <Text font="caption" fontWeight="medium" foregroundStyle={subColor}>
                        {article.author}
                      </Text>
                    </HStack>
                  ) : null}
                </VStack>
              )
            })() : null}
          </VStack>
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
            <Image systemName="icloud.fill" foregroundStyle="systemTeal" />
            <Text font="caption" foregroundStyle="systemGray">数据源</Text>
            <Spacer />
            <Text font="caption" foregroundStyle="secondaryLabel">ONE · 每日一言</Text>
          </HStack>
          <HStack spacing={8}>
            <Image systemName="clock.arrow.circlepath" foregroundStyle="systemOrange" />
            <Text font="caption" foregroundStyle="systemGray">刷新策略</Text>
            <Spacer />
            <Text font="caption" foregroundStyle="secondaryLabel">北京 00:05</Text>
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
