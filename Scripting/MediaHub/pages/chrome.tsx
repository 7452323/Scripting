import { Button, Image, Script } from "scripting"

/**
 * 页面级顶部工具栏：左侧关闭、右侧最小化。
 * 需要每个页面各自持有 NavigationStack，因此工具栏也下沉到页面。
 */
export function pageToolbar(onClose: () => void) {
  return {
    topBarLeading: (
      <Button
        action={() => onClose()}
        buttonStyle="plain"
        frame={{ width: 44, height: 44 }}
        contentShape="rect"
        accessibilityLabel="关闭"
      >
        <Image systemName="xmark" font="headline" foregroundStyle="label" />
      </Button>
    ),
    topBarTrailing: Script.supportsMinimization() ? (
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
    ) : undefined,
  }
}
