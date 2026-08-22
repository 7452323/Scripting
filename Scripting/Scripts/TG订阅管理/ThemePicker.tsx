import { Picker, Section, Text } from "scripting"
import type { ThemeMode } from "./types"

// ==========================================
// 主题选择（segmented Picker）
// 取代原先 HStack 内三个并排 Button —— 修复 List/Section 内整行命中冲突，
// 语义即单选，命中独立。
// ==========================================
export function ThemePicker({
  value,
  onChanged,
}: {
  value: ThemeMode
  onChanged: (mode: ThemeMode) => void
}) {
  return (
    <Section header={<Text>小组件外观</Text>}>
      <Picker
        title="外观模式"
        value={value}
        onChanged={(next: string) => onChanged(next as ThemeMode)}
        pickerStyle="segmented"
      >
        <Text tag="auto">跟随系统</Text>
        <Text tag="light">浅色</Text>
        <Text tag="dark">深色</Text>
      </Picker>
    </Section>
  )
}
