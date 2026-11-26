import { Navigation, Script } from "scripting"
import { MainPage } from "./pages/main"

async function main() {
  // 允许最小化到后台继续运行（方便后续扩展）
  Script.enableMinimize()

  const removeResumeListener = Script.onResume(() => {
    // 预留：从其他入口恢复时的处理
  })

  try {
    await Navigation.present({
      element: <MainPage />,
      modalPresentationStyle: "overFullScreen",
    })
  } catch (error) {
    console.error("MediaHub 启动失败:", error)
    await console.present()
  } finally {
    removeResumeListener()
    Script.exit()
  }
}

main()
