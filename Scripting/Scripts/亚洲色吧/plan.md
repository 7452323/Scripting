# 听书白屏修复 — 2026-05-28

## 根因分析

对比 Audiobook（可正常工作）与 学习资料的差异：

1. **Navigation.present 被 `setTimeout(0)` 包裹** — Audiobook 直接调用，不加延迟；setTimeout 可能打乱了 React 渲染时序导致全白
2. **模块级播放器被改为局部 AVPlayer** — 每组件创建 `new AVPlayer()`，不符合跨导航生命周期的 Semantics
3. **音频 URL 含中文未编码** — AVPlayer.setSource() 收到原始 UTF-8 路径可能无法播放

## 已应用的修复

| # | 修复项 | 详情 |
|---|--------|------|
| 1 | 模块级播放器 | 扩展为 `_modulePlayer*` 完整全局状态，`ensureModulePlayer()` / `disposeModulePlayer()` / `_moduleListeners` |
| 2 | AudioPlayerView | 挂载时 `ensureModulePlayer()` 复用，卸载时不清除；`_moduleListeners` 同步状态 |
| 3 | playTrack | 移除 `setTimeout(0)`，直接调用 `Navigation.present`（对齐 Audiobook） |
| 4 | resolveAudioUrl | URL 路径中的非 ASCII 字符用 `encodeURIComponent` 编码 |

TypeScript: 0 errors

## 测试方法

运行脚本 → 听书 tab → 选择一本书 → 点击任一曲目 → AudioPlayerView 应正常显示并播放
