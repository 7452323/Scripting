# MediaHub

## 用途
全能媒体播放器基础框架（第一阶段）。提供原生 AVPlayer 播放、媒体库管理、搜索与设置，并预留 Emby / Plex / 115 / 脚本源扩展。

## 当前功能（v0.1.2）
- 底部 Tab：首页 / 媒体库 / 搜索 / 设置
- 上滑自动收起 Tab（`tabBarMinimizeBehavior="onScrollDown"`）
- 左上角关闭、右上角最小化（支持时）
- 原生视频播放（AVPlayer + AVPlayerView + PiP）
- 媒体库：远程 URL、本地文件、收藏、删除
- 首页：继续观看 / 收藏 / 最近添加
- 搜索：按标题、来源、链接过滤
- 设置：播放偏好开关（原生 Toggle）

## 首次使用
1. 重新导入或更新脚本后运行。
2. 到「媒体库」添加视频地址或选择本地文件。
3. 在首页或媒体库点击播放。

## 版本更新
### 0.1.2
- 修复空白页面：TextField / Toggle 官方属性名（onChanged、value、prompt）
- Tab 改为：首页、媒体库、搜索、设置
- 每个页面使用 NavigationStack + List
- 顶部关闭 / 最小化；搜索 Tab role=search
- 上滑收起底部 Tab

### 0.1.1
- Storage API 修正

### 0.1.0
- 首个基础框架
