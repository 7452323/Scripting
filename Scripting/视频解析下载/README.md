# 视频解析下载

iOS 去水印解析工具 —— 在 Scripting App 中运行。

支持：抖音 / Twitter-X / 小红书 / Instagram / Bilibili（链接自动识别，无需手动选平台）

## 使用

1. 右下角浮动按钮「+」展开 →「读取剪贴板」或「手动输入链接」
2. 解析完成后勾选要保存的媒体 → 下载已选内容
3. 历史记录支持预览播放、重新下载、保存到相册、导出与删除

## 更新日志

### v1.2.0（2026-10-14）

**新增 4 个平台：YouTube / 快手 / 微信视频号 / 微信公众号**
（主界面与分享面板（intent.tsx）都已接入，设置页可分别填 Cookie + 一键检测）

#### YouTube（`youtube.ts`）
- 抓 watch 页取 `ytInitialPlayerResponse` 的老路子**已失效**：实测 27 条流全部只有 `signatureCipher`（无直链），
  ANDROID 手机端客户端直接 **HTTP 400**。
- ✅ 改用 `youtubei/v1/player` 的 **ANDROID_VR 客户端**（key `AIzaSyA8…M39w`，clientVersion 1.60.19，
  UA `com.google.android.apps.youtube.vr.oculus/…`）：实测 `playabilityStatus=OK`、1 条 progressive + 26 条带直链的自适应档。
- 选流：`avc1`（H.264）优先、跳 `av01`；1080p 以上是自适应（音视频分离）→ 走新的**通用双轨合轨下载通道**
  （分块下载视频轨+音频轨 → `ffmpeg -c copy` 无损合轨 → 存相册）。
- 验证：`dQw4w9WgXcQ` → 1080p 自适应；实测下 360p 视频轨 11.3MB + 音频 3.3MB → 合轨成功且 `hasAudioStream=true`。

#### 快手（`kuaishou.ts`）
- 快手没有可用的公开 JSON 接口，但作品页 HTML 里带 Apollo 缓存：
  `window.__APOLLO_STATE__` → `VisionVideoDetailPhoto:<id>` 下的
  `videoResource.h264.adaptationSet[0].representation[0].url` / `manifestH265.json…`（**优先 H.264**）。
- ⚠️ 这两个字段都包在 `{type:"json", json:{…}}` 里，要拆一层；风控返回 `{"result":2}` 时换路由
  （`/fw/photo/<id>`）与 UA 重试。
- 验证：`short-video/3xj2m5ab2925m4g` → 标题/作者（中国新闻社）/13s + 直链 206。

#### 微信公众号（`wechat.ts`）
- 文章页**免登录**；关键点是正文图片为**懒加载**：真地址在 `<img data-src="…">`，`src` 是占位图。
- 同时提取正文里的 `mpvideo.qpic.cn` / `findermp.video.qq.com` 视频直链；识别异常页（环境异常/已被删除/参数错误）。
- 验证：`mp.weixin.qq.com/s?src=11&...` → 标题《关于爱的测试》/公众号「央视网」+ 26 张原图（全部 206）。

#### 微信视频号（`wxchannels.ts`）
- 两步接口（参考 ParseHub）：
  ① `POST yuanbao.tencent.com/api/weixin/get_parse_result`（body `{type:"video_channel_url", url:"https://weixin.qq.com/sph/<id>", scene:1}`）
  → `data.playable_url`（带 `token`/`eid`）；
  ② `POST channels.weixin.qq.com/finder-preview/api/feed/get_feed_info` → `feedInfo.h264VideoInfo.videoUrl`（H.264）。
- ⚠️ **必须填腾讯元宝登录后的 Cookie**（无 Cookie 实测 401）；没填/失效会返回 `needLogin` 并给出明确提示，
  设置页的「检测」会直接拿该接口验证 Cookie 是否有效。

#### 其他
- 新增**通用双轨合轨下载通道**：任何返回 `audio_url` 的解析结果都会自动拉两条轨并 ffmpeg 无损合轨。
- 设置页 Cookie 列表扩到 9 个平台（新增 快手/视频号/公众号/YouTube），带必填/可选提示。

### v1.1.8（2026-10-14）

**修复小红书短链识别**

- 新增 **`xhslink.cn`**（以前只认 `xhslink.com` → `xhslink.cn/o/xxx` 会报「未识别到支持的平台链接」），顺带支持 `xhs.link`。index.tsx 与 intent.tsx 都已改。
- 真机验证：`https://xhslink.cn/o/NKnTBeUcLT` → 跳转到 `…/discovery/item/6ace…`（带 xsec_token）→ SSR 拿到 4 张原图，标题/作者正确。

**调研：第三方「小红书去广告」Surge 模块对我们是否有用**

- 它拦的是 **App 端接口**（`edith` / `rec` / `so` / `ci.xiaohongshu.com`）+ App 内嵌 JS 改写，需 Surge/Loon + MITM，**只在 App 里生效**，对 Safari / 本脚本无效。
- 但有一条信息值得记：它把 `ci.xiaohongshu.com/system_config/watermark`（客户端水印配置）直接 Map Local 成 tiny-gif → 印证了**小红书的图片水印是客户端加的、服务端原文件不带水印** —— 这也正是我们用 trace id 重建原图的依据。
- 它列的 `v10/note/video/save` 等 App 专属接口需要 App 签名（x-s），本项目走的是免签名的网页 SSR 路线，不复用。

### v1.1.7（2026-10-14）

**修复小红书**

- 现状：旧的「签名 API + WebView 抳 DOM」已不可用。实测：
  - 页面内用 `window._webmsxyw` 拿 x-s 签名**本身没问题**（`/api/sns/web/v2/user/me` → `code=0` 拿到昵称）；
  - 但笔记接口 `POST edith.xiaohongshu.com/api/sns/web/v1/feed` **被单独风控** →
    `{"success":false,"code":300011,"msg":"当前账号存在异常，请切换账号后重试"}`；
    改成 same-origin 调 `www…/api/...` 直接 HTTP 500。
- 新路子（**免签名**）：带登录 Cookie 抓笔记页
  `https://www.xiaohongshu.com/explore/{noteId}?xsec_token=…&xsec_source=pc_feed`，
  解析 HTML 里的 `window.__INITIAL_STATE__.note.noteDetailMap[firstNoteId].note`。
  （匿名抓同一页只有 36KB 且**无 noteDetailMap**；SSR 里写了 JS 的 `undefined`，parse 前要换 null。）
- **`xsec_token` 现在是必需的**（分享链接自带）；缺失时给明确提示。
- 视频选档：`stream` 家族名已从 `h264/h265/av1` 改成 **`EF4/EF5/EF6/EF7`**，字段分辨不出编码 →
  用设备自带 **ffprobe 实测** 每个候选的 `codec_name`，挑 iOS 能解码（H.264/HEVC）的最高分辨率档。
  实测：EF4=h264 720p、EF5=hevc 1080p，选中 1080x1920 hevc；直链 http→https 后 Range 实测 206。
- 图文帖：用 trace id 重建**原图**（`https://sns-img-hw.xhscdn.com/{32位hex目录之后的路径}`），预览另用小图；
  小红书 CDN 不再带 Referer。
- 代码：小红书逻辑收进 `xiaohongshu.ts`，index.tsx 删掉 ~1200 行旧 WebView 兜底；分享面板同步走新通道。
- 真机验证：视频笔记（1080p hevc ✓ + 直链 206 ✓）、图文笔记（3 张原图 ✓）、缺 token / 缺 Cookie 的边界提示 ✓。

### v1.1.6（2026-10-14）

**修复 B 站视频没声音（DASH 音视频分离）**

- 根因：B 站高画质走 **DASH**，视频轨与音频轨是**两个文件**（video.m4s / audio.m4s）；
  旧逻辑「DASH 画质更高就用 DASH」→ 只下视频轨 → 成品没声音。
- 新策略（`bilibili.ts` + `download.ts` + `mux.ts`）：
  1. 优先 **progressive 单文件**（`fnval=1` 的 durl，自带声音；登录即 1080P，无需会员）；
  2. 仅当 DASH 画质确实更高（1080P60 / 4K / 番剧等）才下载双轨，并用 **ffmpeg `-c copy` 无损合轨**。
     ⚠️ 关键发现：**脚本里能直接用 `Shell.run` 调设备自带的 ffmpeg n5.0.1**，合轨 0.4 秒；
     `AVMutableComposition` 在 Scripting 里不存在、`AVAssetExportSession` 也没有 Passthrough 预设，
     所以 MediaComposer 重编码只当兜底。
- 新增**分块下载器**（`download.ts`）：B 站 CDN 混着 PCDN 节点（`*.mountaintoys.cn:4483`、
  `*.mcdn.bilivideo.cn:8082`），实测**长连接会中途卡死**（单次 fetch 下 3 分半视频卡了 7 分钟）；
  改 4MB 分块（Range + 每块重试）后 20MB/8 秒完成，且每块直接落盘再 `cat` 拼接，不吃内存。
- 选轨按**编码**优先：`avc1`(H.264) > `hev1/hvc1`(HEVC) > `av01`(AV1，iOS 不能解码)；音频优先普通 AAC。
- 真机验证：
  - progressive 路径：49.6MB 下载 26.5s，**输出含音频轨 ✓**（212.3s）
  - DASH+mux 路径：视频 19.9MB + 音频 5.2MB → ffmpeg 合轨 0.4s，**输出含音频轨 ✓**（212.2s）

### v1.1.5（2026-10-14）

**Instagram 画质 + 受限内容（参考你给的两份代码）**

- 视频选档（照搬 `InstagramRestricted.js` 的实战结论）：
  从 `video_versions` 里挑 `type === 101`（progressive）且**排除 DASH 分片**
  （`dashinit` / `bytestart` / `byteend`）的最大宽度档 —— 直接用 `[0]` 可能拿到分片或低清。
- 图片选档：不再用只有 **640px** 的 `display_url`（糊图根因），改为从 `image_versions2.candidates`
  里挑面积最大的原图；UI 网格另传中等尺寸 `imagePreviews`。
- 新增 **web GraphQL 通道**（与 QX 脚本 / ParseHub 同一套配方）：同一个 cookie jar 取 csrftoken →
  `POST /graphql/query`（`doc_id=27128499623469141` + `X-IG-App-ID` + `x-csrftoken`）→
  `xdt_api__v1__media__shortcode__web_info.items[0]`（也兼容 `xdt_shortcode_media`）。
  ⚠️ 匿名调用实测回 `401 {"require_login":true}`，所以它是 **Cookie 通道**。
- 受限内容识别：`xdt_shortcode_media = null`、或内嵌页带 `utm_campaign=invalid` →
  提示「需要登录 / 年龄验证」，而不是默默下错东西。
- 兼容 `XDTGraph*` 前缀类型名（ParseHub `_normalize_typename`）与双层 stringify 的 `contextJSON`；
  caption 为纯字符串也能读。
- 回归测试 13/13 通过（含真机：你那条链接受登录即可正确判为图片帖）。

### v1.1.4（2026-10-14）

**修复 Instagram：不再下错内容 + 免登录 + 支持图片帖**

- 根因一：旧实现硬编码的 GraphQL `doc_id` 已失效（服务端回 `execution error`），代码掉到 WebView 里
  抓 `document.querySelector('video')` —— 页面上的**任意一个视频**都会被当成结果。
- 根因二：用户那条链接 `https://www.instagram.com/p/DecB_btPki-/` 本身就是**图片帖**
  （内嵌页数据：`__typename: GraphImage`、`is_video: false`），而旧实现只找视频 → 随手抓了别人的视频。
- 新通道（**免登录**）：`https://www.instagram.com/p/{短码}/embed/captioned/` 页面里的 `contextJSON`
  就是官方 GraphQL 结果（`gql_data.shortcode_media`），含 `display_url` / `video_url` / 相册子项，
  并且**自带短码可直接核对身份**。已真机验证：上述链接免登录即解析成功，识别为 1 张图片。
- 三个通道（内嵌页 → 私有 API（带 Cookie）→ 帖子页 HTML）**全部强制核对短码**，宁报错也绝不下错内容。
- Instagram 加入设置页可配置 Cookie（公开帖免登录；Cookie 只用于受限/私密帖）。

### v1.1.3（2026-10-14）

**修复：解析后的预览图「超大、发虚」**

- 真因：图片选择网格（`ImageSelectionTile`）与视频行（`MediaSelectionRow`）里的网络图**缺少 `resizable`**，
  SwiftUI 就按图片**自身像素尺寸**铺开（例如 1600×2133 的封面 = 1600pt 宽），
  屏幕里只截到中间一小块、而且被放大约 3 倍 → 看着又大又糊。
- 现改为 `resizable` + `scaleToFill` + 圆角裁剪，缩略图填满卡片且清晰；
  历史记录的封面也统一成同一套写法。
- 已用真实组件渲染截图对比验证（修复前＝放大裁切，修复后＝整图铺满）。

### v1.1.2（2026-10-14）

**修复：分享短链（v.douyin.com）解析失败**

- 真因：旧代码里 `v.douyin.com` 的判断正则被**多转义了一层**，
  导致短链永远匹配不上、拿不到作品 ID，于是绕开移动端通道去跑网页兜底，
  约 37 秒后才报「无法从抖音页面提取视频」——与 Cookie 无关。
  同时修掉了另外 3 处同样被多转义的正则（作品 ID 校验、SSR 水合数据、短链二次判断）。
- 抖音逻辑收拢到独立模块 **`douyin.ts`**，`index.tsx` 与 `intent.tsx` 共用一份：
  自带短链展开、双主机重试与逐步诊断；日志里现在能看到「短链展开 / 详情状态 / 无水印候选数」。
- 解析失败时不再只报一句无用提示，而是写出真因
  （如被平台过滤 `filter_reason`、主机 HTTP 状态、无作品 ID），便于定位。

### v1.1.1（2026-10-13）

**设置页改版（去掉图标）**

- 「平台 Cookie」不再用平台图标 + 一排小图标按钮：改为
  **平台主色细色条 + 状态点 + 文字入口**（已配置亮起平台色，未配置为淡色）；
  整行点按弹出管理菜单：填写 / 修改、检测可用性、清除。
- section 标题带进度：`平台 Cookie · 已配置 1/4`。
- 「支持的平台」改为**等宽胶囊标签**，用各平台主色写字
  （抖音粉 / 小红书红 / Instagram 紫 / Bilibili 青 / Twitter 蓝），一眼区分；section 标题带总数。

### v1.1.0（2026-10-13）

**抖音去水印修复（本轮重点）**

- 抖音解析/下载改走**移动端免签通道**（算法参考本项目 `镜花水月`）：
  `api5-normal-c-lq.amemv.com/aweme/v1/aweme/detail/`，带真实 `iid` / `device_id`，**免签名 / 免 Cookie / 免 uifid**。
- 真机实测依据：网页端 `/aweme/v1/web/aweme/detail/` 已被风控拦死（`403 Blocked by ArgusSecurityPlugin / Uifid Not Found`），
  这正是旧版本抖音“能解析但下不了 / 下到带水印 / 存相册失败”的根因。
- 无水印处理：`playwm → play` 自动替换，并按**短边**（竖屏横屏通用）挑最高画质；
  标准档命中 1440p / 1080p CDN 直链，首选 `douyinvod` / `video/tos` 直链。
- 自动避开抖音自研编码（`fourcc=bvc2`）档位 —— iOS 既不能解码也不能存相册；
  需要那个分辨率时改用 `play` 接口 `ratio` 参数拿同分辨率的标准编码版本。
- 下载候选多级回退：CDN 直链 → `play` 接口倍率（api-play / api5）→ `iesdouyin` 保底；
  Share Sheet（`intent.tsx`）同步修复，并支持多候选逐个尝试。

**界面交互与布局对齐 `Media Downloader`**

- 右下角浮动按钮组：`+` 展开为「读取剪贴板 / 手动输入链接」，任务进行中变为「停止」。
- Toast 轻提示；点按「状态」或「日志」即可复制到剪贴板。
- 历史记录：封面缩略图、文件大小、预览播放、重新下载、保存到相册、导出文件、删除记录（可选删文件）。
- 新增「已保存文件」浏览器（文件夹图标入口）。
- 默认保存方式持久化到 Storage，重启脚本不再丢失。
- 底部 Tab 去掉文字，只保留图标。
- 首次使用 / 版本更新时弹出底部更新说明 Sheet（可拖拽的半高面板）；设置页「关于」可重新查看。
