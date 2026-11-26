import {
  Button,
  Image,
  Navigation,
  Script,
  Toolbar,
  ToolbarItem,
} from "scripting"

/** 各页面共用的顶部关闭 / 最小化工具栏 */
export function PageToolbar(extraTrailing?: any) {
  const dismiss = Navigation.useDismiss()

  return (
    <Toolbar>
      <ToolbarItem placement="topBarLeading" sharedBackgroundVisibility="visible">
        <Button
          action={() => dismiss()}
          buttonStyle="plain"
          frame={{ width: 44, height: 44 }}
          contentShape="rect"
          accessibilityLabel="关闭"
        >
          <Image systemName="xmark" font="headline" foregroundStyle="label" />
        </Button>
      </ToolbarItem>

      {extraTrailing}

      {Script.supportsMinimization() ? (
        <ToolbarItem placement="topBarTrailing" sharedBackgroundVisibility="visible">
          <Button
            action={() => {
              if (!Script.isMinimized()) {
                Script.minimize().catch(() => {})
              }
            }}
            buttonStyle="plain"
            frame={{ width: 44, height: 44 }}
            contentShape="rect"
            accessibilityLabel="最小化"
          >
            <Image
              systemName="arrow.down.right.and.arrow.up.left"
              font="headline"
              foregroundStyle="label"
            />
          </Button>
        </ToolbarItem>
      ) : null}
    </Toolbar>
  )
}

/** 对象形式 toolbar（部分 List 更稳） */
export function pageToolbarProps(extraTrailing?: any[]) {
  const dismiss = Navigation.useDismiss()
  const trailing: any[] = []

  if (extraTrailing && extraTrailing.length) {
    trailing.push(...extraTrailing)
  }

  if (Script.supportsMinimization()) {
    trailing.push(
      <Button
        key="minimize"
        systemImage="arrow.down.right.and.arrow.up.left"
        action={() => {
          if (!Script.isMinimized()) {
            Script.minimize().catch(() => {})
          }
        }}
      />
    )
  }

  return {
    topBarLeading: [
      <Button
        key="close"
        systemImage="xmark"
        action={() => dismiss()}
      />,
    ],
    topBarTrailing: trailing,
  }
}
