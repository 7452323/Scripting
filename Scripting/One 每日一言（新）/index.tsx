// ONE 每日一言 — 主页
// 打开脚本时会主动刷新一次内容（写进 App Group 缓存），再让小组件按新缓存重画，
// 所以「打开脚本 = 小组件立刻是新的」；平时小组件自己每天 00:05 后刷新一次。
import {
  Button, HStack, Image, List, Navigation, NavigationStack, Script, ScrollView, Section,
  Spacer, Text, VStack, Widget, useEffect, useState,
} from "scripting"
import { IMAGE_PATH, cleanupLegacyFiles, formatStamp, refreshContent, type Content } from "./shared"

const VERSION = "1.2.0"
const ACK_KEY = "one_daily_ack_version"

// 与 README 的 1.2.0 更新日志保持一致
const UPDATE_NOTES = [
  "小组件改为每天刷新一次，请求时间紧跟服务器发布当天内容（本地 00:05 之后），不再每 4 小时空跑，避免被 iOS 削减后台刷新预算。",
  "打开脚本会立刻刷新内容，并让桌面小组件同步重画；点击小组件也能打开脚本刷新。",
  "拉取失败时保留上一次的内容并在 20 分钟后重试，不再整天停在「加载失败」。",
  "缓存改为单一文件槽，不再把 base64 图片写进 JSON，并自动清理旧版遗留的多日缓存。",
  "小组件底部「更新」标签补上日期，方便一眼看出内容是否过期。",
]

/* ───────── 更新说明 ───────── */

function UpdateNotes({ onClose }: { onClose: () => void }) {
  return (
    <VStack
      alignment="leading"
      spacing={16}
      padding={20}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      presentationDetents={["medium"]}
      presentationDragIndicator="visible"
    >
      <Text font="headline">更新到 {VERSION}</Text>
      <ScrollView axes="vertical">
        <VStack alignment="leading" spacing={12}>
          {UPDATE_NOTES.map(note => (
            <HStack key={note} alignment="top" spacing={8}>
              <Image systemName="checkmark.circle.fill" foregroundStyle="systemGreen" />
              <Text font="subheadline">{note}</Text>
            </HStack>
          ))}
        </VStack>
      </ScrollView>
      <Button title="知道了" action={onClose} buttonStyle="borderedProminent" frame={{ maxWidth: "infinity" }} />
    </VStack>
  )
}

/* ───────── 主页面 ───────── */

function MainPage() {
  const [content, setContent] = useState<Content | null>(null)
  const [hasImage, setHasImage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showNotes, setShowNotes] = useState(false)

  const dismiss = Navigation.useDismiss()

  async function load(force: boolean) {
    setBusy(true)
    try {
      const result = await refreshContent({ force, source: "app" })
      setContent(result.content)
      setError(result.error ?? null)
    } finally {
      setHasImage(FileManager.existsSync(IMAGE_PATH))
      setLoading(false)
      setBusy(false)
    }
    // 内容已经写进 App Group 缓存，让小组件立刻重新加载（此时是缓存命中，不再重复联网）。
    // 用 reloadAll：用户小组件和测试小组件都覆盖到，否则加错种类时这里会白刷。
    Widget.reloadAll()
  }

  useEffect(() => {
    let active = true
    void (async () => {
      const removed = await cleanupLegacyFiles()
      if (!active) return
      if (removed > 0) console.log(`已清理 ${removed} 个旧版缓存文件`)
      await load(true)
      if (!active) return
      if (Storage.get<string>(ACK_KEY) !== VERSION) setShowNotes(true)
    })()
    const offResume = Script.onResume(() => { void load(true) })
    return () => {
      active = false
      offResume()
    }
  }, [])

  // foregroundStyle 接受颜色字符串，但 TS 声明只认 ShapeStyle，这里放宽类型
  const colors: { main: any; sub: any } = content
    ? { main: content.mainColor, sub: content.subColor }
    : { main: "label", sub: "systemGray" }

  return (
    <NavigationStack
      sheet={{
        isPresented: showNotes,
        onChanged: (presented: boolean) => {
          setShowNotes(presented)
          // 用户真的关掉之后才记住版本号
          if (!presented) Storage.set(ACK_KEY, VERSION)
        },
        content: <UpdateNotes onClose={() => setShowNotes(false)} />,
      }}
    >
      <List
        navigationTitle="ONE · 每日一言"
        navigationBarTitleDisplayMode="large"
        toolbar={{
          cancellationAction: <Button title="关闭" action={dismiss} />,
        }}
      >
        {/* 顶部大图卡片 */}
        <Section>
          <VStack spacing={0}>
            {hasImage ? (
              <Image
                filePath={IMAGE_PATH}
                resizable
                scaleToFill
                frame={{ maxWidth: "infinity", minHeight: 200, maxHeight: 240 }}
              />
            ) : (
              <VStack frame={{ maxWidth: "infinity", minHeight: 200, maxHeight: 240 }} background="systemGray6">
                <Image
                  systemName={loading ? "photo" : "exclamationmark.triangle"}
                  font="largeTitle"
                  foregroundStyle="systemGray3"
                />
                <Text font="caption" foregroundStyle="systemGray2">
                  {loading ? "加载中..." : error || "暂无配图"}
                </Text>
              </VStack>
            )}

            {content?.desc ? (
              <VStack padding={{ horizontal: 16, vertical: 14 }} spacing={6}>
                <Image systemName="quote.opening" font="title3" foregroundStyle={colors.sub} />
                <Text font="body" fontWeight="medium" lineSpacing={4} foregroundStyle={colors.main}>
                  {content.desc}
                </Text>
                {content.author ? (
                  <HStack>
                    <Text font="caption" foregroundStyle={colors.sub}>— </Text>
                    <Text font="caption" fontWeight="medium" foregroundStyle={colors.sub}>
                      {content.author}
                    </Text>
                  </HStack>
                ) : null}
              </VStack>
            ) : null}
          </VStack>
        </Section>

        {/* 刷新 */}
        <Section
          header={<Text font="footnote" foregroundStyle="systemGray">刷新</Text>}
          footer={
            <Text font="caption" foregroundStyle="systemGray">
              小组件平时自己每天刷新一次；打开脚本或点击小组件也会立刻刷新。
            </Text>
          }
        >
          <HStack spacing={8}>
            <Image systemName="clock.arrow.circlepath" foregroundStyle="systemOrange" />
            <Text font="caption" foregroundStyle="systemGray">最近更新</Text>
            <Spacer />
            <Text font="caption" foregroundStyle="secondaryLabel">
              {content ? formatStamp(content.fetchedAt) : "—"}
            </Text>
          </HStack>
          <Button
            title={busy ? "刷新中..." : "刷新内容与小组件"}
            action={() => { void load(true) }}
            disabled={busy}
          />
        </Section>

        {/* 小组件预览 */}
        <Section header={<Text font="footnote" foregroundStyle="systemGray">小组件预览</Text>}>
          <Button title="小号组件" action={async () => { await Widget.preview({ family: "systemSmall" }) }} />
          <Button title="中号组件" action={async () => { await Widget.preview({ family: "systemMedium" }) }} />
          <Button title="大号组件" action={async () => { await Widget.preview({ family: "systemLarge" }) }} />
        </Section>

        {/* 关于 */}
        <Section header={<Text font="footnote" foregroundStyle="systemGray">关于</Text>}>
          <HStack spacing={8}>
            <Image systemName="calendar" foregroundStyle="systemBlue" />
            <Text font="caption" foregroundStyle="systemGray">内容日期</Text>
            <Spacer />
            <Text font="caption" foregroundStyle="secondaryLabel">{content?.dataDate ?? "—"}</Text>
          </HStack>
          <HStack spacing={8}>
            <Image systemName="icloud.fill" foregroundStyle="systemTeal" />
            <Text font="caption" foregroundStyle="systemGray">数据源</Text>
            <Spacer />
            <Text font="caption" foregroundStyle="secondaryLabel">ONE · 每日一言</Text>
          </HStack>
          <HStack spacing={8}>
            <Image systemName="rectangle.stack.badge.plus" foregroundStyle="systemPurple" />
            <Text font="caption" foregroundStyle="systemGray">小组件刷新</Text>
            <Spacer />
            <Text font="caption" foregroundStyle="secondaryLabel">每天 00:05 后 + 打开脚本时</Text>
          </HStack>
          <HStack spacing={8}>
            <Image systemName="number" foregroundStyle="systemGray" />
            <Text font="caption" foregroundStyle="systemGray">版本</Text>
            <Spacer />
            <Text font="caption" foregroundStyle="secondaryLabel">{VERSION}</Text>
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
