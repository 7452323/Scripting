import { Button, HStack, Image, Spacer, Text, VStack } from "scripting"
import type { TelegramAudience, ThemeMode } from "./types"
import { resolveTheme } from "./theme"
import { AudienceCard } from "./AudienceCard"
import { RefreshAudienceIntent } from "./app_intents"

// ==========================================
// 小组件根视图（纯展示，无 state）
// - 顶部左：圈底 Telegram 飞机图标
// - 顶部右：原生刷新按钮（Button + AppIntent），点击后台即时刷新
// - transparentBackground：当 Widget.isTransparentBackground 为 true 时使用透明背景
// 布局约束：small widget 可用区约 130×130，内容须紧凑，避免固定元素溢出边界。
// ==========================================

/** 点击小组件空白区域触发的 deep link（进入配置页 / 兜底刷新） */
export const REFRESH_URL = "scripting://run?action=refresh"

export function WidgetView({
  data,
  error,
  theme,
  interactive = true,
  transparentBackground = false,
}: {
  data: TelegramAudience | null
  error?: string
  theme: ThemeMode
  /** 是否启用交互按钮。widget 环境为 true；App 内预览传 false 渲染纯图标 */
  interactive?: boolean
  /** 是否使用透明背景（读取 Widget.isTransparentBackground） */
  transparentBackground?: boolean
}) {
  const colors = resolveTheme(theme)
  const bg = transparentBackground ? "clear" : colors.background

  // 未配置 / 无缓存：引导态
  if (!data) {
    return (
      <VStack
        alignment="center"
        spacing={10}
        padding={14}
        frame={{ maxWidth: Infinity, maxHeight: Infinity, alignment: "center" }}
        background={bg}
        widgetURL={REFRESH_URL}
      >
        <Image
          systemName="paperplane.circle.fill"
          foregroundStyle={colors.accent}
          font={34}
        />
        <Text font={15} fontWeight="semibold" foregroundStyle={colors.text}>
          尚未配置
        </Text>
        <Text
          font="caption2"
          foregroundStyle={colors.subText}
          multilineTextAlignment="center"
        >
          {error ?? "点击此处运行脚本配置"}
        </Text>
      </VStack>
    )
  }

  // 正常态：紧凑纵向布局，工具栏固定在顶部，内容用单个 Spacer 居中
  return (
    <VStack
      alignment="center"
      spacing={4}
      padding={{ horizontal: 12, top: 10, bottom: 12 }}
      frame={{ maxWidth: Infinity, maxHeight: Infinity, alignment: "top" }}
      background={bg}
      widgetURL={REFRESH_URL}
    >
      {/* 顶部工具列：左 圈底飞机，右 原生刷新按钮 */}
      <HStack frame={{ maxWidth: Infinity }} alignment="center">
        <Image
          systemName="paperplane.circle.fill"
          foregroundStyle={colors.accent}
          font={16}
        />
        <Spacer />
        {error ? (
          <Text font="caption2" foregroundStyle="orange">⚠️</Text>
        ) : null}
        {interactive ? (
          <Button
            intent={RefreshAudienceIntent(undefined)}
            buttonStyle="plain"
          >
            <Image
              systemName="arrow.clockwise"
              font={12}
              fontWeight="bold"
              foregroundStyle={colors.accent}
              frame={{ width: 26, height: 26 }}
              background={{ style: colors.controlBackground, shape: "circle" }}
              clipShape="circle"
            />
          </Button>
        ) : (
          <Image
            systemName="arrow.clockwise"
            font={12}
            fontWeight="bold"
            foregroundStyle={colors.accent}
            frame={{ width: 26, height: 26 }}
            background={{ style: colors.controlBackground, shape: "circle" }}
            clipShape="circle"
          />
        )}
      </HStack>

      <Spacer />

      <AudienceCard data={data} colors={colors} />

      <Spacer />
    </VStack>
  )
}
