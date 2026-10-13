/**
 * 「正在播放」登记处 —— 全局唯一的播放叫停开关。
 *
 * 为什么需要它（用户实报：**脚本收起 / 关掉之后声音还在一直响**）：
 *   1. 播放器是**原生对象**（`new AVPlayer()`），不挂在 React 树上 ——
 *      页面被收起（最小化）时 React 树不会卸载，清理函数自然也不会跑；
 *   2. 音频会话是 `playback` 类别（本来就允许在后台出声），
 *      于是「界面都不见了，声音还在放」。
 *   3. 脚本被关掉（present 的 promise 落地 → `Script.exit()`）时也一样：
 *      原生播放器不会跟着 JS 运行时一起消失，得在退出前自己叫停。
 *
 * 所以：谁建播放器，谁就在这里登记一组 suspend / resume，
 * 脚本被收起（`Script.onMinimize`）、被关掉（页面的 present promise 落地）、
 * 或被点了「关闭红果短剧」时，统一走 `suspendPlayback()`。
 */
export type PlaybackHandle = {
  /** 收起 / 被关掉：暂停并归还音频会话（还能恢复，但不自动续播）。 */
  suspend: () => void
  /** 重新显示（从最小化回来）：把音频会话再占回来。 */
  resume: () => void
  /** 页面真的被「返回」掉了（比 suspend 彻底：停播 + 解开会话），缺省就退化成 suspend。 */
  finish?: () => void
}

const handles = new Set<PlaybackHandle>()

/** 登记一个播放器，返回注销函数（页面卸载时调用）。 */
export function registerPlayback(handle: PlaybackHandle): () => void {
  handles.add(handle)
  return () => { handles.delete(handle) }
}

/** 叫停所有正在播放的播放器（收起脚本 / 退出脚本 / 关闭播放页时调用）。 */
export function suspendPlayback() {
  for (const handle of Array.from(handles)) {
    // 单个播放器叫停失败不该带崩「退出 / 收起」这条主线
    try { handle.suspend() } catch { /* ignore */ }
  }
}

/** 恢复：重新占住音频会话（仅在 resume-from-minimized 时有用）。 */
export function resumePlayback() {
  for (const handle of Array.from(handles)) {
    try { handle.resume() } catch { /* ignore */ }
  }
}

/**
 * 页面被「返回 / 关掉」了：彻底收摊。
 * ⚠️ 不能只靠 React 卸载：播放器是原生对象，而 `navigationDestination` 的内容
 * 不保证每次都会走卸载清理（详 [[scripting-native-playback-lifecycle]]）。
 */
export function finishPlayback() {
  for (const handle of Array.from(handles)) {
    try { (handle.finish ?? handle.suspend)() } catch { /* ignore */ }
  }
}
