import { Section, Text, VStack } from "scripting"
import type { TelegramAudience, ThemeMode } from "./types"
import { WidgetView } from "./WidgetView"

// ==========================================
// App 内实时小组件预览
// 直接还原小组件样式（比 Widget.preview() 稳定精准）。
// 修复原 VStack.cornerRadius（不存在）导致的圆角 bug：改用 clipShape。
// ==========================================
export function WidgetPreviewCard({
  data,
  theme,
}: {
  data: TelegramAudience | null
  theme: ThemeMode
}) {
  return (
    <Section header={<Text>實時小組件預覽</Text>}>
      <VStack alignment="center" frame={{ maxWidth: Infinity }} padding={{ vertical: 12 }}>
        <VStack
          frame={{ width: 155, height: 155 }}
          clipShape={{ type: "rect", cornerRadius: 22 }}
          shadow={{ color: "rgba(0,0,0,0.15)", radius: 10, x: 0, y: 4 }}
        >
          <WidgetView data={data} error={undefined} theme={theme} interactive={false} />
        </VStack>
      </VStack>
    </Section>
  )
}
