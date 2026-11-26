import { Navigation, Script } from "scripting"
import { MainPage } from "./pages/main"

async function main() {
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
    try {
      await console.present()
    } catch {}
  } finally {
    removeResumeListener()
    Script.exit()
  }
}

main()
