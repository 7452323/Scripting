import { Navigation, Script } from "scripting"
import { AppRoot } from "./shared"
import { player } from "./player"

async function main() {
  try {
    await Navigation.present({
      element: <AppRoot mode="standalone" />,
      modalPresentationStyle: "overFullScreen",
    })

    const st = player.getState()
    if ((st === "playing" || st === "loading") && Script.supportsMinimization()) {
      Script.minimize()
    } else {
      Script.exit()
    }
  } catch (e) {
    console.error(String(e))
    Script.exit()
  }
}

void main()
