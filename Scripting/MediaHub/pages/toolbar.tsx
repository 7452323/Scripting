import { Button, Script } from "scripting"

/**
 * 构建 List 可用的 toolbar 对象。
 * dismiss 必须由页面组件顶层通过 Navigation.useDismiss() 取得后再传入。
 */
export function buildPageToolbar(
  dismiss: () => void,
  extraTrailing: any[] = []
) {
  const trailing: any[] = [...extraTrailing]

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
      <Button key="close" systemImage="xmark" action={() => dismiss()} />,
    ],
    topBarTrailing: trailing,
  }
}
