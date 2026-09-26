// ONE 每日一言 —— 主屏幕小组件
// 每次运行只做一件事：确认手里有“今天”的内容（能命中缓存就完全不联网），然后渲染。
// 下一次请求新时间线的时刻交给 shared.nextReloadDate：正常情况下每天一次（本地 00:05 后）。
import { Image, Script, Spacer, Text, VStack, Widget, ZStack } from "scripting"
import {
  IMAGE_PATH,
  formatStamp,
  nextReloadDate,
  refreshContent,
  reloadPolicyArgument,
  type Content,
} from "./shared"

const usesSystemBackground = Widget.isTransparentMode || Widget.isBlurMode || Widget.isTransparentBackground

// 点小组件 → 打开本脚本（index.tsx 会立刻刷新内容并让小组件重新加载）
const RUN_URL = Script.createRunURLScheme(Script.name, { action: "refresh" })

function OneWidget(props: { content: Content; hasBackground: boolean }) {
  const size = Widget.displaySize
  const small = Widget.family === "systemSmall"
  const medium = Widget.family === "systemMedium"
  const content = props.content

  return (
    <ZStack widgetURL={RUN_URL}>
      {!usesSystemBackground && props.hasBackground ? (
        <Image
          filePath={IMAGE_PATH}
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
        <Text
          widgetAccentable
          font={small ? 8 : medium ? 9 : 11}
          foregroundStyle={content.subColor as any}
          padding={{ horizontal: small ? 8 : 12, vertical: small ? 4 : 6 }}
        >
          ONE - 每日一言
        </Text>
        <Spacer />
        <VStack padding={{ horizontal: small ? 10 : 14, vertical: small ? 8 : 10 }} spacing={3}>
          <Text
            widgetAccentable
            font={small ? 10 : medium ? 12 : 15}
            foregroundStyle={content.mainColor as any}
            lineLimit={small ? 5 : medium ? 4 : 8}
          >
            {content.desc}
          </Text>
          {content.author ? (
            <Text widgetAccentable font={small ? 9 : medium ? 10 : 12} foregroundStyle={content.subColor as any}>
              -- {content.author}
            </Text>
          ) : null}
          <Text widgetAccentable font={small ? 7 : 8} foregroundStyle={content.subColor as any} opacity={0.75}>
            更新 {formatStamp(content.fetchedAt)}
          </Text>
        </VStack>
      </VStack>
    </ZStack>
  )
}

;(async () => {
  const result = await refreshContent({ source: "widget" })
  const policy = reloadPolicyArgument(nextReloadDate(result))

  if (!result.content) {
    Widget.present(
      <VStack padding={8} widgetBackground="clear" widgetURL={RUN_URL}>
        <Text font="headline">ONE</Text>
        <Spacer />
        <Text font="footnote" opacity={0.6}>加载失败</Text>
        <Text font="caption2" opacity={0.4}>{result.error ?? "未知错误"}</Text>
        <Text font="caption2" opacity={0.4}>点一下打开脚本重试</Text>
      </VStack>,
      policy,
    )
    return
  }

  Widget.present(
    <OneWidget content={result.content} hasBackground={FileManager.existsSync(IMAGE_PATH)} />,
    policy,
  )
})()
