import { Navigation, Script } from "scripting"
import { HongguoApp } from "./page"
import { resumePlayback, suspendPlayback } from "./playback"

/**
 * 脚本生命周期与播放器的关系（用户实报「收起或者关了脚本后声音还在一直播放」）：
 *  - 本脚本开了 `Script.enableMinimize()`（下拉收起 / 顶栏最小化按钮都走它），
 *    收起后 JS 运行时**还在跑**，而播放器是原生对象 + `playback` 音频类别 ——
 *    不主动暂停的话，界面都不见了声音还照响。所以：收起 → 暂停、恢复 → 重新占住音频会话。
 *  - 关掉页面（present 的 promise 落地 → `Script.exit()`）时同理：
 *    原生播放器不会跟着 JS 运行时一起消失，必须在退出前自己叫停。
 */
async function main() {
  Script.enableMinimize()
  const removeMinimizeListener = Script.onMinimize(() => suspendPlayback())
  const removeResumeListener = Script.onResume(() => resumePlayback())
  try {
    await Navigation.present({ element: <HongguoApp />, modalPresentationStyle: "overFullScreen" })
    removeMinimizeListener()
    removeResumeListener()
    // ⚠️ 先叫停再退出：播放器不挂 React 树，页面关了它不会自己停
    suspendPlayback()
    Script.exit()
  } catch (error) {
    removeMinimizeListener()
    removeResumeListener()
    suspendPlayback()
    console.error(error)
    console.present().then(Script.exit)
  }
}

main()
