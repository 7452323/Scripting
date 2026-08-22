import {
  Button,
  List,
  Navigation,
  NavigationStack,
  Section,
  Text,
  TextField,
  useState,
  Widget,
} from "scripting"
import type { TelegramAudience, ThemeMode } from "./types"
import { getCache, getSource, getTheme, setCache, setSource, setTheme } from "./store"
import { fetchTelegramAudience } from "./telegram"
import { ThemePicker } from "./ThemePicker"
import { StatusSection } from "./StatusSection"
import { WidgetPreviewCard } from "./WidgetPreviewCard"

// ==========================================
// 配置页面：组合数据配置 / 主题 / 状态 / 预览各 Section
// ==========================================
export function SettingsView() {
  const dismiss = Navigation.useDismiss()
  const savedSource = getSource() ?? ""

  const [source, setSourceInput] = useState(savedSource)
  const [result, setResult] = useState<TelegramAudience | null>(getCache())
  const [themeMode, setThemeMode] = useState<ThemeMode>(getTheme())
  const [status, setStatus] = useState(savedSource ? "已读取配置" : "等待配置")
  const [isLoading, setIsLoading] = useState(false)

  const save = async () => {
    if (isLoading) return
    setIsLoading(true)
    setStatus("正在查询 Telegram...")
    try {
      const data = await fetchTelegramAudience(source)
      setSource(data.source)
      setCache(data)
      setSourceInput(data.source)
      setResult(data)
      setStatus("保存成功，小组件已刷新")
      Widget.reloadAll()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsLoading(false)
    }
  }

  const handleThemeChange = (mode: ThemeMode) => {
    setThemeMode(mode)
    setTheme(mode)
    Widget.reloadAll()
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="TG 订阅配置"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={dismiss} />,
        }}
      >
        <Section header={<Text>数据配置</Text>}>
          <TextField
            title="链接或 ID"
            prompt="例如 @telegram"
            value={source}
            onChanged={setSourceInput}
            textInputAutocapitalization="never"
            autocorrectionDisabled
            keyboardType="URL"
            submitLabel="done"
            onSubmit={save}
          />
          <Button
            title={isLoading ? "查询中..." : "查询并保存"}
            systemImage="square.and.arrow.down"
            action={save}
            disabled={isLoading || !source.trim()}
          />
        </Section>

        <ThemePicker value={themeMode} onChanged={handleThemeChange} />

        <StatusSection status={status} result={result} />

        <WidgetPreviewCard data={result} theme={themeMode} />
      </List>
    </NavigationStack>
  )
}
