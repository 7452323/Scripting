import { Image, Text, VStack } from "scripting"
import type { TelegramAudience } from "./types"
import type { ThemeColors } from "./theme"
import { formatUpdateTime } from "./format"

// ==========================================
// 受众展示卡：头像 + 大数字 + 频道名
// 供 WidgetView 与 App 内预览复用（纯展示，无 state）
// ==========================================
export function AudienceCard({
  data,
  colors,
}: {
  data: TelegramAudience
  colors: ThemeColors
}) {
  return (
    <VStack alignment="center" spacing={4}>
      {/* 1. 头像居中 */}
      {data.avatarURL ? (
        <Image
          imageUrl={data.avatarURL}
          resizable
          scaleToFill
          frame={{ width: 48, height: 48 }}
          clipShape="circle"
          placeholder={
            <Image systemName="paperplane.circle.fill" foregroundStyle={colors.accent} font={48} />
          }
        />
      ) : (
        <Image
          systemName="paperplane.circle.fill"
          foregroundStyle={colors.accent}
          font={48}
        />
      )}

      {/* 2. 粉丝数大字居中 */}
      <VStack alignment="center" spacing={0}>
        <Text
          font={26}
          fontWeight="bold"
          fontDesign="rounded"
          monospacedDigit
          minScaleFactor={0.6}
          lineLimit={1}
          foregroundStyle={colors.accent}
        >
          {data.audienceText}
        </Text>
        {/* 去掉「订阅者/成员」字样，仅显示更新时间 */}
        <Text font={10} fontWeight="medium" foregroundStyle={colors.subText}>
          更新 {formatUpdateTime(data.fetchedAt)}
        </Text>
      </VStack>

      {/* 3. 频道名称居中 */}
      <Text font={11} fontWeight="semibold" lineLimit={1} minScaleFactor={0.7} foregroundStyle={colors.text}>
        {data.title}
      </Text>
    </VStack>
  )
}
