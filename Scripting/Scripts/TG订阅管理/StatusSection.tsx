import { Label, Section, Text, VStack } from "scripting"
import type { TelegramAudience } from "./types"
import { TELEGRAM_BLUE } from "./theme"

// ==========================================
// 状态 + 结果摘要 Section
// ==========================================
export function StatusSection({
  status,
  result,
}: {
  status: string
  result: TelegramAudience | null
}) {
  const isSuccess = status.includes("成功")
  return (
    <Section header={<Text>状态</Text>}>
      <Label
        title={status}
        systemImage={isSuccess ? "checkmark.circle.fill" : "info.circle"}
        foregroundStyle={isSuccess ? "green" : "secondaryLabel"}
      />
      {result ? (
        <VStack alignment="leading" spacing={6} padding={{ vertical: 4 }}>
          <Text fontWeight="semibold">{result.title}</Text>
          <Text font={28} bold monospacedDigit foregroundStyle={TELEGRAM_BLUE}>
            {result.audienceText}
          </Text>
        </VStack>
      ) : null}
    </Section>
  )
}
