import { Navigation, Script } from "scripting"
import { MainPage } from "./page/index"

async function main() {
  Script.enableMinimize()
  const removeResumeListener = Script.onResume(() => {})
  try {
    await Navigation.present({ element: <MainPage />, modalPresentationStyle: "overFullScreen" })
    removeResumeListener()
    Script.exit()
  } catch (error) {
    removeResumeListener()
    console.error(error)
    console.present().then(Script.exit)
  }
}

main()
