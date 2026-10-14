/**
 * 视频解析下载 - Scripting App
 * iOS 去水印解析工具
 * 
 * 用法:
 * 1. 在 Scripting App 中创建新项目
 * 2. 把本文件内容粘贴到 index.tsx
 * 3. 运行即可
 * 
 * 支持: 抖音 / Twitter / 小红书 / Instagram / Bilibili
 *
 * 更新：
 * - 抖音解析/下载改走移动端免签通道（参考「镜花水月」），彻底去掉水印并拿到最高画质
 * - 界面交互与布局对齐「Media Downloader」
 */

import {
  Text, TextField, Button, List, Section, HStack, VStack, ZStack,
  Image, Rectangle, Spacer,
  NavigationStack, Navigation, ScrollView, ScrollViewReader, LazyVGrid,
  ProgressView, Tab, TabView, DirectoryBrowserView,
  fetch, useState, useEffect, useRef, useObservable,
  Script, Intent
} from "scripting"
import {
  DY_DOWNLOAD_UA,
  buildDouyinDownloadCandidates,
  extractDouyinId,
  fetchDouyinDetailMobile,
  parseDouyinViaMobile,
} from "./douyin"
import { IG_PAGE_UA, instagramShortcode, parseInstagramPost } from "./instagram"
import { parseBilibiliVideo, qnLabel } from "./bilibili"
import { parseXhsNote } from "./xiaohongshu"
import { parseYouTubeVideo } from "./youtube"
import { parseKuaishou } from "./kuaishou"
import { parseWeChatArticle } from "./wechat"
import { parseWxChannels } from "./wxchannels"
import { downloadToFile } from "./download"
import { muxVideoAudio, removeQuietly } from "./mux"

declare function alert(message: string): Promise<void>
declare function alert(options: { message: string; title?: string; buttonLabel?: string }): Promise<void>

declare const Pasteboard: {
  getString(): Promise<string | null>
  setString(text: string): void
}
declare const Photos: {
  saveVideo(data_or_path: Data | string, options?: { fileName?: string; shouldMoveFile?: boolean }): Promise<boolean>
  savePhoto(data: Data | string, options?: { fileName?: string; shouldMoveFile?: boolean }): Promise<boolean>
}
declare const FileManager: {
  documentsDirectory: string
  temporaryDirectory: string
  exists(path: string): Promise<boolean>
  remove(path: string): Promise<void>
  readDirectory(path: string, recursive?: boolean): Promise<string[]>
  isFile(path: string): Promise<boolean>
  writeAsBytes(path: string, data: Data): Promise<void>
  removeSync(path: string): void
}
declare const openURL: (url: string) => Promise<boolean>

declare const ShareSheet: {
  present(items: any[]): Promise<boolean>
}

declare const QuickLook: {
  previewURLs(paths: string[], fullscreen?: boolean): Promise<boolean>
  preview(path: string): Promise<boolean>
}

declare const Dialog: {
  actionSheet(options: {
    title: string
    message?: string
    cancelButton?: boolean
    actions: { label: string; destructive?: boolean }[]
  }): Promise<number | null>
  prompt(options: {
    title: string
    message?: string
    defaultValue?: string
    obscureText?: boolean
    selectAll?: boolean
    placeholder?: string
    cancelLabel?: string
    confirmLabel?: string
    keyboardType?: string
  }): Promise<string | null>
}

// ─── 解析器 ────────────────────────────────────────────

interface MediaResult {
  success: boolean
  platform?: string
  title?: string
  author?: string
  video_url?: string | null
  images?: string[]
  imagePreviews?: string[]
  cover_url?: string | null
  link?: string
  error?: string
  videoId?: string
  /** 所有候选视频 URL（多 CDN 镜像），仅抖音使用 */
  videoUrls?: string[]
  /** 抖音视频 URI（play_addr.uri），用于通过 aweme.snssdk.com 获取指定画质 */
  videoUri?: string
  /** 独立音频轨（自适应流；需与视频轨合轨后才有声音） */
  audio_url?: string | null
  debug?: string[]
}

const PLATFORMS: [string, RegExp[]][] = [
  ['douyin',      [/douyin\.com/i, /iesdouyin/i, /v\.douyin/i]],
  ['twitter',     [/twitter\.com/i, /x\.com\//i]],
  ['xiaohongshu', [/xiaohongshu\.com/i, /xhslink\.(?:com|cn)/i, /xhs\.link/i]],
  ['instagram',   [/instagram\.com/i]],
  ['bilibili',    [/bilibili\.com/i, /b23\.tv/i]],
  ['youtube',     [/youtube\.com/i, /youtu\.be/i]],
  ['kuaishou',    [/kuaishou\.com/i, /chenzhongtech\.com/i]],
  ['wxchannels',  [/weixin\.qq\.com\/sph\//i, /channels\.weixin\.qq\.com/i]],
  ['wechat',      [/mp\.weixin\.qq\.com\/s/i]],
]

function detectPlatform(text: string): { platform: string; url: string } | null {
  for (const [platform, patterns] of PLATFORMS) {
    for (const p of patterns) {
      const m = text.match(p)
      if (m) {
        const start = Math.max(0, (m.index || 0) - 50)
        const urlMatch = text.slice(start).match(/https?:\/\/[^\s<>"']+/)
        if (urlMatch) {
          let clean = urlMatch[0].replace(/[\?&]s=\d+/g, '').replace(/[\?&]$/, '')
          return { platform, url: clean }
        }
      }
    }
  }
  return null
}

// ─── 工具 ──────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// ─── Twitter / X ──────────────────────────────────────
const TWITTER_BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

async function parseTwitter(url: string): Promise<MediaResult> {
  const result: MediaResult = { success: false, error: '' }
  result.platform = 'twitter'
  result.link = url
  try {
    const tweetId = url.match(/status\/(\d+)/)?.[1]
    if (!tweetId) { result.error = '无法提取推文ID'; return result }

    // ─── 策略 1: Twitter GraphQL API ─────────────────────
    try {
      // 获取 guest token
      const guestResp = await fetch('https://x.com/', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
        timeout: 10
      })
      const guestHtml = await guestResp.text()
      const guestToken = guestHtml.match(/cookie="gt=(\d+)/)?.[1]
        || guestHtml.match(/"gt=(\d+)/)?.[1]
        || guestHtml.match(/gt=(\d+)/)?.[1]

      if (guestToken) {
        const features = JSON.stringify({
          creator_subscriptions_tweet_preview_api_enabled: true,
          communities_web_enable_tweet_community_results_fetch: true,
          c9s_tweet_anatomy_moderator_badge_enabled: true,
          tweetypie_unmention_optimization_enabled: true,
          responsive_web_edit_tweet_api_enabled: true,
          graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
          view_counts_everywhere_api_enabled: true,
          longform_notetweets_consumption_enabled: true,
          responsive_web_twitter_article_tweet_consumption_enabled: true,
          tweet_awards_web_tipping_enabled: false,
          creator_subscriptions_quote_tweet_preview_enabled: false,
          freedom_of_speech_not_reach_fetch_enabled: true,
          standardized_nudges_misinfo: true,
          tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
          tweet_with_visibility_results_prefer_gql_media_interstitial_enabled: false,
          rweb_video_timestamps_enabled: true,
          longform_notetweets_rich_text_read_enabled: true,
          longform_notetweets_inline_media_enabled: true,
          rweb_tipjar_consumption_enabled: true,
          responsive_web_graphql_exclude_directive_enabled: true,
          verified_phone_label_enabled: false,
          responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
          responsive_web_graphql_timeline_navigation_enabled: true,
          responsive_web_enhance_cards_enabled: false,
        })
        const variables = JSON.stringify({
          tweetId, withCommunity: false, includePromotedContent: false, withVoice: false
        })
        const fieldToggles = JSON.stringify({ withArticleRichContentState: true, withArticlePlainText: false })

        const gqlUrl = `https://api.twitter.com/graphql/kPLTRmMnzbPTv70___D06w/TweetResultByRestId?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(features)}&fieldToggles=${encodeURIComponent(fieldToggles)}`
        const gqlResp = await fetch(gqlUrl, {
          headers: {
            'authorization': `Bearer ${TWITTER_BEARER}`,
            'x-guest-token': guestToken,
            'x-twitter-active-user': 'yes',
            'x-twitter-client-language': 'zh-cn',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          },
          timeout: 12,
        })
        const gqlData = await gqlResp.json()

        if (!gqlData.errors) {
          const tweetResult = gqlData?.data?.tweetResult?.result
          const tweet = tweetResult?.tweet || tweetResult
          const legacy = tweet?.legacy

          if (legacy) {
            // 提取文本
            const noteTweet = tweet?.note_tweet
            result.title = noteTweet?.note_tweet_results?.result?.text
              || legacy.full_text || ''
            result.title = (result.title || '').replace(/https?:\/\/t\.co\/[^\s,]+$/g, '').trim()

            // 提取媒体
            const mediaEntities = legacy.entities?.media || legacy.extended_entities?.media || []
            for (const m of mediaEntities) {
              if (m.type === 'video' || m.type === 'animated_gif') {
                const variants = m.video_info?.variants || []
                // 选择最高码率的 mp4
                const mp4s = variants.filter((v: any) => v.content_type === 'video/mp4' && v.url)
                if (mp4s.length) {
                  mp4s.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))
                  result.video_url = mp4s[0].url
                  result.cover_url = result.cover_url || m.media_url_https
                }
              }
              if (m.type === 'photo' && m.media_url_https) {
                if (!result.images) result.images = []
                result.images.push(`${m.media_url_https}?name=orig`)
                result.cover_url = result.cover_url || m.media_url_https
              }
            }
            result.author = tweetResult?.core?.user_results?.result?.legacy?.screen_name
              || tweet?.core?.user_results?.result?.legacy?.screen_name || ''
            result.success = !!(result.video_url || result.images?.length)
            if (result.success) return result
          }
        }
      }
    } catch {
      // GraphQL 失败 → 继续 fxtwitter
    }

    // ─── 策略 2: fxtwitter 备用 ──────────────────────────
    try {
      const resp = await fetch(`https://api.fxtwitter.com/status/${tweetId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10,
      })
      const data = await resp.json()
      const tweet = data.tweet || data

      result.title = result.title || tweet.text || ''
      result.author = result.author || tweet.author?.screen_name || tweet.user_screen_name || ''

      const all = tweet.media?.all || tweet.media_extended || []
      for (const m of all) {
        if ((m.type === 'video' || m.type === 'gif') && m.url) {
          result.video_url = result.video_url || m.url.replace(/\?tag=\d+/, '')
          result.cover_url = result.cover_url || m.thumbnail_url
        }
        if (m.type === 'photo' && m.url) {
          if (!result.images) result.images = []
          result.images.push(m.url)
          result.cover_url = result.cover_url || m.url
        }
      }
      if (!result.video_url && tweet.mediaURLs?.length) result.video_url = tweet.mediaURLs[0]
      result.success = !!(result.video_url || result.images?.length)
    } catch {
      // fxtwitter 也失败
    }

    // ─── 策略 3: og:video 兜底 ───────────────────────────
    if (!result.success) {
      try {
        const pageResp = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
          timeout: 10,
        })
        const html = await pageResp.text()
        const ogVideo = html.match(/<meta[^>]*property="og:video"[^>]*content="([^"]+)"/i)
        if (ogVideo) { result.video_url = ogVideo[1]; result.success = true }
      } catch {}
    }
  } catch (e: any) { result.error = e.message || String(e) }
  return result
}

// ─── 抖音辅助函数 ───


/** 抖音内部 API 策略：直接 fetch 调用 /aweme/v1/web/aweme/detail/（比 WebView 更可靠） */
async function douyinDirectAPIStrategy(awemeId: string, cookie: string): Promise<MediaResult | null> {
  const result: MediaResult = { success: false, error: '', platform: 'douyin' }
  const desktopUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'
  try {
    const ts = Date.now()
    const apiUrl = `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${awemeId}&aid=6383&device_platform=webapp&channel=channel_pc_web&pc_client_version=2.0.0&cookie_enabled=true&_t=${ts}`
    const resp = await fetch(apiUrl, {
      headers: {
        'User-Agent': desktopUA,
        'Cookie': cookie,
        'Referer': 'https://www.douyin.com/',
        'Origin': 'https://www.douyin.com',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      timeout: 8,
    })
    const d = await resp.json()
    if (!d || d.status_code !== 0 || !d.aweme_detail) return null

    const detail = d.aweme_detail
    // 实况动态检测：aweme_type===2 但有真实视频 URL → 不是纯图帖
    const hasRealVideo = detail.video?.play_addr?.url_list?.length && detail.video.play_addr.url_list.some(function(u: string) { return u.includes('/play/') || u.includes('playwm'); })
    const isImagePost = (!hasRealVideo && detail.aweme_type === 2) || (detail.images?.length > 0 && !detail.video?.bit_rate?.length) || (detail.video?.play_addr?.url_list?.length && detail.video.play_addr.url_list.every(function(u: string) { return u.includes('douyinpic.com') || u.includes('tos-cn-i') || u.includes('.webp'); }))

    if (isImagePost) {
      // 图集/图片帖：提取图片，不设置视频
      const imageList = (detail.images || []).map((img: any) =>
        (img.url_list || img.urlList || []).slice(-1)[0] || ''
      ).filter(Boolean)
      if (!imageList.length) return null

      result.title = detail.desc || ''
      result.author = detail.author?.nickname || ''
      result.videoId = String(detail.aweme_id || '')
      result.images = imageList
      result.cover_url = imageList[0] || ''
      result.success = true
      result.link = `https://www.douyin.com/video/${awemeId}`
      return result
    }

    const isAudio = (u: string) => u.includes('.mp3') || u.includes('.m4a') || u.includes('.ogg') || u.includes('.wav') || u.includes('.aac') || u.includes('.flac')
    const videoUrls: string[] = []

  const isImageUrl = (u: string) => /\.webp(\?|$)/i.test(u) || u.includes('douyinpic.com') || u.includes('douyincdnpic.com') || !u.includes('/play/') && (u.includes('.jpg') || u.includes('.png') || u.includes('.jpeg') || u.includes('.webp'))
  const isVideoUrl = (u: string) => !isImageUrl(u)

    // 最高画质优先：bit_rate 按分辨率排序
    if (detail.video?.bit_rate?.length) {
      const sorted = [...detail.video.bit_rate].sort((a: any, b: any) => {
        return (b.play_addr?.width || 0) * (b.play_addr?.height || 0) - (a.play_addr?.width || 0) * (a.play_addr?.height || 0)
      })
      const highest = sorted[0]
      if (highest?.play_addr?.url_list) {
        for (const u of highest.play_addr.url_list) {
          if (!isAudio(u) && isVideoUrl(u)) videoUrls.push(u)
        }
      }
    }
    // 然后才是 play_addr 默认画质
    if (detail.video?.play_addr?.url_list) {
      for (const u of detail.video.play_addr.url_list) {
        if (!isAudio(u) && isVideoUrl(u) && !videoUrls.includes(u)) videoUrls.push(u)
      }
    }

    if (!videoUrls.length) {
      // 没有有效视频 URL，但有图片？当作图集处理
      if (detail.images?.length) {
        // 实况动态：检查图片条目的内嵌视频
        for (const img of (detail.images || [])) {
          if (img.video?.play_addr?.url_list) {
            for (const u of img.video.play_addr.url_list) {
              if (!isAudio(u) && isVideoUrl(u) && !videoUrls.includes(u)) videoUrls.push(u)
            }
          }
        }
      }
    }
    if (!videoUrls.length) {
      // 没有有效视频 URL，但有图片？当作图集处理
      if (detail.images?.length) {
        const imageList = detail.images.map(function(img: any) {
          return (img.url_list || img.urlList || []).slice(-1)[0] || ''
        }).filter(Boolean)
        if (imageList.length) {
          result.images = imageList
          result.cover_url = imageList[0] || ''
          result.title = detail.desc || ''
          result.author = detail.author?.nickname || ''
          result.videoId = String(detail.aweme_id || '')
          result.success = true
          result.link = 'https://www.douyin.com/video/' + awemeId
          return result
        }
      }
      return null
    }

    // 提取 play_addr.uri（视频 CDN 标识），用于获取指定画质
    const videoUri = detail.video?.play_addr?.uri || ''

    // 尝试通过 aweme.snssdk.com 获取 1080p 画质（参考 ParseHub _resolve_best_play_url）
    let url1080p: string | null = null
    if (videoUri) {
      url1080p = await get1080pUrlFromUri(videoUri, cookie, '1080p')
      if (url1080p) {
        // 移除水印标记
        const noWm = url1080p.replace(/playwm/g, 'play')
        if (!videoUrls.includes(noWm)) videoUrls.unshift(noWm)
      }
    }

    // 实况动态：也提取图片
    if (detail.images?.length) {
      const imageList = detail.images.map(function(img: any) {
        return (img.url_list || img.urlList || []).slice(-1)[0] || ''
      }).filter(Boolean)
      if (imageList.length) {
        result.images = imageList
      }
    }
    result.title = detail.desc || ''
    result.author = detail.author?.nickname || ''
    result.videoId = String(detail.aweme_id || '')
    result.videoUri = videoUri
    result.videoUrls = videoUrls
    result.video_url = videoUrls[0]
    result.cover_url = detail.video?.cover?.url_list?.[0] || detail.video?.origin_cover?.url_list?.[0] || ''
    result.success = true
    result.link = `https://www.douyin.com/video/${awemeId}`
    return result
  } catch {
    return null
  }
}

/** 抖音内部 API 策略：WebView + JS 注入调用 /aweme/v1/web/aweme/detail/（快速备用） */
async function douyinWebViewAPIStrategy(awemeId: string, originalUrl?: string): Promise<MediaResult | null> {
  const result: MediaResult = { success: false, error: '', platform: 'douyin' }
  const desktopUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'
  const webView = new WebViewController({ ephemeral: true })
  try {
    webView.setCustomUserAgent(desktopUA)
    await setPlatformCookies(webView, 'douyin')
    const loadUrl = awemeId ? `https://www.douyin.com/video/${awemeId}` : (originalUrl || '')
    if (!loadUrl) return null
    await webView.loadURL(loadUrl)
    // waitForLoad 超时改为 8 秒（不需要等全部资源加载）
    const loadResult = await Promise.race([
      webView.waitForLoad().then(() => true),
      new Promise(r => setTimeout(() => r(false), 8000))
    ])
    if (!loadResult) {
      console.log('WebView API 策略加载超时，尝试继续')
    }
    // 等 0.5 秒让页面初始化
    await sleep(500)

    // 注入 JS 调用抖音内部 API（带超时 8 秒）
    const evaluatePromise = webView.evaluateJavaScript<any>(`
      (async () => {
        try {
          // 如果没有 awemeId，先从页面 URL 提取
          var currentUrl = window.location.href;
          var idMatch = currentUrl.match(/\/(?:video|note)\/([0-9]+)/);
          var id = idMatch ? idMatch[1] : '${awemeId}';
          if (!id) return JSON.stringify({ ok: false, reason: 'no_id' });
          var ts = Date.now();
          var apiUrl = 'https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=' + id + '&aid=6383&device_platform=webapp&channel=channel_pc_web&pc_client_version=2.0.0&cookie_enabled=true&_t=' + ts;
          var resp = await fetch(apiUrl, { credentials: 'include' });
          var d = await resp.json();
          if (!d || d.status_code !== 0) return JSON.stringify({ ok: false, reason: 'api_error' });
          var detail = d.aweme_detail;
          if (!detail) return JSON.stringify({ ok: false, reason: 'no_detail' });

          var title = detail.desc || '';
          var author = detail.author ? (detail.author.nickname || '') : '';
          var videoId = detail.aweme_id || '';
          var awemeType = detail.aweme_type || 0;

          // 提取无水印视频 URL（过滤音频）
          var videoUrls = [];
          var isAudio = function(u) { return u.includes('.mp3') || u.includes('.m4a') || u.includes('.ogg') || u.includes('.wav') || u.includes('.aac') || u.includes('.flac'); };
          var isVideoUrl = function(u) { return !isAudio(u) && !/\.webp(\?|$)/i.test(u) && !/douyinpic\.com/i.test(u) && !/douyincdnpic\.com/i.test(u) && !(!u.includes('/play/') && (u.includes('.jpg') || u.includes('.png') || u.includes('.jpeg') || u.includes('.webp'))); };
          if (detail.video) {
            // 最高画质优先：bit_rate 按分辨率排序后取最高
            if (detail.video.bit_rate) {
              var sortedBR = detail.video.bit_rate.slice().sort(function(a, b) {
                return (b.play_addr.width * b.play_addr.height) - (a.play_addr.width * a.play_addr.height);
              });
              var highest = sortedBR[0];
              if (highest && highest.play_addr && highest.play_addr.url_list) {
                for (var i = 0; i < highest.play_addr.url_list.length; i++) {
                  if (isVideoUrl(highest.play_addr.url_list[i])) videoUrls.push(highest.play_addr.url_list[i]);
                }
              }
            }
            // 然后才是 play_addr 默认画质
            if (detail.video.play_addr && detail.video.play_addr.url_list) {
              for (var i = 0; i < detail.video.play_addr.url_list.length; i++) {
                if (isVideoUrl(detail.video.play_addr.url_list[i]) && videoUrls.indexOf(detail.video.play_addr.url_list[i]) === -1) {
                  videoUrls.push(detail.video.play_addr.url_list[i]);
                }
              }
            }
          }

          // 提取图片笔记 URL（图片中的视频也需要过滤音频）
          var imageUrls = [];
          if (detail.images) {
            for (var i = 0; i < detail.images.length; i++) {
              var img = detail.images[i];
              if (img.url_list && img.url_list.length > 0) {
                imageUrls.push(img.url_list[img.url_list.length - 1]);
              }
              if (img.video && img.video.play_addr && img.video.play_addr.url_list) {
                for (var j = 0; j < img.video.play_addr.url_list.length; j++) {
                  if (!isAudio(img.video.play_addr.url_list[j]) && videoUrls.indexOf(img.video.play_addr.url_list[j]) === -1) {
                    videoUrls.push(img.video.play_addr.url_list[j]);
                  }
                }
              }
            }
          }

          // 封面
          var cover = '';
          if (detail.video) {
            if (detail.video.cover && detail.video.cover.url_list && detail.video.cover.url_list[0]) {
              cover = detail.video.cover.url_list[0];
            } else if (detail.video.origin_cover && detail.video.origin_cover.url_list && detail.video.origin_cover.url_list[0]) {
              cover = detail.video.origin_cover.url_list[0];
            }
          }

          // 提取 play_addr.uri（视频 CDN 标识），用于获取指定画质
          var videoUri = '';
          if (detail.video && detail.video.play_addr) {
            videoUri = detail.video.play_addr.uri || '';
          }

          return JSON.stringify({
            ok: true,
            title: title,
            author: author,
            videoId: videoId,
            videoUri: videoUri,
            videoUrls: videoUrls,
            imageUrls: imageUrls,
            cover: cover,
            awemeType: awemeType
          });
        } catch(e) {
          return JSON.stringify({ ok: false, reason: e.message });
        }
      })()
    `)
    const apiResult = await Promise.race([evaluatePromise, new Promise(r => setTimeout(() => r('__TIMEOUT__'), 8000))])
    if (apiResult === '__TIMEOUT__') { webView.dispose(); return null }

    const parsed = tryParseJSON(apiResult)
    if (parsed && parsed.ok) {
      result.title = parsed.title || ''
      result.author = parsed.author || ''
      result.videoId = parsed.videoId || ''
      result.cover_url = parsed.cover || ''
      if (parsed.videoUrls && parsed.videoUrls.length > 0) {
        result.videoUrls = parsed.videoUrls
        result.video_url = parsed.videoUrls[0]
      }
      if (parsed.imageUrls && parsed.imageUrls.length > 0) {
        result.images = parsed.imageUrls
      }
      // 尝试通过 videoUri 获取 1080p 画质（参考 ParseHub）
      if (parsed.videoUri) {
        result.videoUri = parsed.videoUri
        const cookie = await loadPlatformCookieForVideo('douyin').catch(() => '')
        const url1080p = await get1080pUrlFromUri(parsed.videoUri, cookie, '1080p')
        if (url1080p) {
          const noWm = url1080p.replace(/playwm/g, 'play')
          if (!result.videoUrls) result.videoUrls = []
          if (!result.videoUrls.includes(noWm)) result.videoUrls.unshift(noWm)
          result.video_url = noWm
        }
      }
      // 实况动态检测（aweme_type===2 但有真实视频 URL）
      var hasRealVideoLive = parsed.videoUrls?.length > 0 && parsed.videoUrls.some(function(u: string) { return u.includes("/play/") || u.includes("playwm"); });
      // 图集帖（aweme_type === 2 但无视频→纯图）：清掉 video_url
      if ((parsed.awemeType === 2 && !hasRealVideoLive) || (parsed.imageUrls?.length && !parsed.videoUrls?.length)) {
        result.video_url = null as any
        result.videoUrls = []
      }
      result.success = !!(result.video_url || result.images?.length)
      result.link = `https://www.douyin.com/video/${awemeId}`
      if (result.success) return result
    }
    return null
  } catch(e) {
    return null
  } finally {
    webView.dispose()
  }
}

/**
 * 通过抖音视频 URI 获取指定画质的播放 URL（参考 ParseHub 的 _resolve_best_play_url）
 * @param uri 视频 URI，如 v0201ag00000...（来自 play_addr.uri）
 * @param cookie 抖音 Cookie（可选，用于 CDN 下载）
 * @param ratio 画质：'default' | '1080p' | '720p' | '540p' | '480p'
 * @returns 实际 CDN URL，失败返回 null
 */
async function get1080pUrlFromUri(
  uri: string,
  cookie?: string,
  ratio: string = '1080p'
): Promise<string | null> {
  if (!uri) return null
  const PLAY_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  
  const baseHeaders: Record<string, string> = {
    'User-Agent': PLAY_UA,
    'Referer': 'https://www.douyin.com/',
    'Accept': '*/*',
  }
  if (cookie) baseHeaders['Cookie'] = cookie

  const ratios = ['1080p']  // 只试 1080p，不降级
  // 2026-10-13 更新：加回移动端播放主机 api-play（实测 302 到 douyinvod CDN 直链，可用）
  const hosts = [
    { url: (uri: string, r: string) => `https://api-play.amemv.com/aweme/v1/play/?video_id=${uri}&ratio=${r}&line=0`, label: 'api-play' },
    { url: (uri: string, r: string) => `https://aweme.snssdk.com/aweme/v1/play/?video_id=${uri}&ratio=${r}&line=0`, label: 'snssdk' },
    { url: (uri: string, r: string) => `https://api.douyin.com/aweme/v1/play/?video_id=${uri}&ratio=${r}&line=0`, label: 'api.douyin' },
    { url: (uri: string, r: string) => `https://www.iesdouyin.com/aweme/v1/play/?video_id=${uri}&ratio=${r}&line=0&is_play_url=1&watermark=0&source=PackSourceEnum_PUBLISH`, label: 'iesdouyin' },
  ]
  for (const host of hosts) {
    for (const r of ratios) {
      try {
        const api = host.url(uri, r)
        const resp = await fetch(api, {
          method: 'GET',
          headers: { ...baseHeaders, Range: 'bytes=0-0' },
          timeout: 10,
        })
        const finalUrl = resp.url
        if (finalUrl && finalUrl.startsWith('http') && !finalUrl.includes('aweme.snssdk.com') && !finalUrl.includes('iesdouyin.com')) {
          return finalUrl
        }
        if (resp.status >= 300 && resp.status < 400) {
          const location = (resp.headers as any)?.get?.('Location') || (resp.headers as any)?.location || ''
          if (location && location.startsWith('http')) return location
        }
      } catch { continue }
    }
  }
  return null
}

// ─── 抖音 ──────────────────────────────────────────────
// 多策略解析：移动端免签接口（主）→ WebView JS 注入 → 网页 API → HTML 兜底
async function parseDouyin(url: string): Promise<MediaResult> {
  const result: MediaResult = { success: false, error: '' }
  const UA = DY_DOWNLOAD_UA
  result.platform = 'douyin'
  result.link = url

  // 加载 Cookie
  const cookieConfig = await loadCookies()
  const dyCookie = (cookieConfig.douyin || '').trim()

  // 提取视频 ID
  let awemeId = extractDouyinId(url)

  // ── 展开短链接 ──
  let targetUrl = url
  if (url.match(/v\.douyin\.com/i) || url.match(/v\.douyin/i)) {
    try {
      const fetchHeaders: Record<string, string> = { 'User-Agent': UA }
      if (dyCookie) fetchHeaders['Cookie'] = dyCookie
      const resp = await fetch(url, { headers: fetchHeaders, timeout: 8 })
      const finalUrl = (resp as any).url || ''
      if (finalUrl && finalUrl !== url && !finalUrl.match(/v\.douyin\.com/i)) {
        targetUrl = finalUrl
        const newId = extractDouyinId(finalUrl)
        if (newId) awemeId = newId
      }
    } catch {}
  }

  // ── 辅助函数：收集候选 URL（最高画质优先） ──
  function collectAllUrls(videoObj: any): string[] {
    const allUrls: string[] = []
    const pushUrls = (urls: string[] | undefined) => {
      if (!urls?.length) return
      for (const u of urls) {
        if (u.includes('.mp3') || u.includes('.m4a') || u.includes('.ogg') || u.includes('.wav') || u.includes('.aac') || u.includes('.flac')) continue
        if (/\.webp(\?|$)/i.test(u)) continue
        if (/douyinpic\.com/i.test(u) || /douyincdnpic\.com/i.test(u)) continue
        if (!u.includes('/play/') && (u.includes('.jpg') || u.includes('.png') || u.includes('.jpeg') || u.includes('.webp'))) continue
        const noWm = u.replace(/playwm/g, 'play')
        if (noWm && !allUrls.includes(noWm)) allUrls.push(noWm)
        if (u !== noWm && !allUrls.includes(u)) allUrls.push(u)
      }
    }
    // 最高画质优先：bit_rate 按分辨率排序后取最高
    if (videoObj.bit_rate?.length) {
      const sorted = [...videoObj.bit_rate].sort((a: any, b: any) => {
        const resA = (a.play_addr?.width || 0) * (a.play_addr?.height || 0)
        const resB = (b.play_addr?.width || 0) * (b.play_addr?.height || 0)
        return resB - resA
      })
      const highest = sorted[0]
      if (highest?.play_addr?.url_list) {
        pushUrls(highest.play_addr.url_list)
      }
    }
    // 然后才是 play_addr 等默认画质
    for (const key of ['play_addr', 'play_addr_h264', 'play_addr_265', 'download_addr']) {
      pushUrls((videoObj as any)[key]?.url_list)
    }
    return allUrls
  }

  // ── 辅助函数：从 item 提取元数据 ──
  function applyItem(item: any) {
    result.title = result.title || item.desc || ''
    result.author = result.author || item.author?.nickname || ''
    const rawVid = String(item.aweme_id || item.video_id || '')
    result.videoId = /^\d+$/.test(rawVid) ? rawVid : ''
    const hasRealVideo = item.video?.play_addr?.url_list?.length && item.video.play_addr.url_list.some(function(u: string) { return u.includes('/play/') || u.includes('playwm'); })
    const isImagePost = (!hasRealVideo && item.aweme_type === 2) || (item.images?.length > 0 && !item.video?.bit_rate?.length) || (item.video?.play_addr?.url_list?.length && item.video.play_addr.url_list.every(function(u: string) { return u.includes('douyinpic.com') || u.includes('.webp'); }))
    const v = item.video || {}
    result.cover_url = result.cover_url || v.cover?.url_list?.[0] || v.origin_cover?.url_list?.[0] || ''

    if (!isImagePost) {
      if (!result.videoUri && v.play_addr?.uri) {
        result.videoUri = v.play_addr.uri
      }
      const urls = collectAllUrls(v)
      if (urls.length) {
        if (!result.videoUrls) result.videoUrls = []
        for (const u of urls) { if (!result.videoUrls.includes(u)) result.videoUrls.push(u) }
        result.video_url = result.video_url || urls[0]
      }
      // 实况动态：也提取图片
      if (item.images?.length && !result.images?.length) {
        result.images = item.images.map((img: any) => (img.url_list || []).slice(-1)[0] || '').filter(Boolean)
      }
    }
    const imgs = item.images || []
    if (imgs.length) {
      result.images = imgs.map((img: any) => (img.url_list || []).slice(-1)[0] || '').filter(Boolean)
    }
  }

  // ════════════════════════════════════════════════════════
  // 策略 0: 移动端免签通道（主通道：免签名 / 免 Cookie / 无水印直链）
  //   实现与诊断都在 ./douyin 模块里，模块自己会展开短链、多主机重试
  // ════════════════════════════════════════════════════════
  let mobileFailure = ""
  try {
    const mobile = await parseDouyinViaMobile(targetUrl || url, dyCookie)
    if (mobile.success) {
      const mapped: MediaResult = {
        success: true,
        platform: "douyin",
        title: mobile.title,
        author: mobile.author,
        video_url: mobile.video_url,
        videoUrls: mobile.videoUrls,
        videoUri: mobile.videoUri,
        images: mobile.images,
        imagePreviews: mobile.imagePreviews,
        cover_url: mobile.cover_url,
        link: mobile.link,
        videoId: mobile.videoId,
        debug: mobile.debug,
      }
      return mapped
    }
    mobileFailure = mobile.error || "移动端通道未返回可下载内容"
  } catch (error) {
    mobileFailure = error instanceof Error ? error.message : String(error)
  }

  // ════════════════════════════════════════════════════════
  // 策略 1: 网页端 API fetch（2026-10 起常被 Argus 风控拦，仅作兜底）
  // ════════════════════════════════════════════════════════
  if (awemeId) {
    const directResult = await douyinDirectAPIStrategy(awemeId, dyCookie)
    if (directResult && directResult.success) {
      return directResult
    }
  }

  // ════════════════════════════════════════════════════════
  // 策略 2: WebView + JS 注入（Procut 方案，备用）
  // ════════════════════════════════════════════════════════
  const webViewApiResult = await douyinWebViewAPIStrategy(awemeId || '', url)
  if (webViewApiResult && webViewApiResult.success) {
    return webViewApiResult
  }

  // ════════════════════════════════════════════════════════
  // 策略 3: HTML fetch → RENDER_DATA / SSR / OG meta（兜底）
  // ════════════════════════════════════════════════════════
  let fetchSucceeded = false
  try {
    const pageHeaders: Record<string, string> = { 'User-Agent': UA }
    if (dyCookie) pageHeaders['Cookie'] = dyCookie
    const pageResp = await fetch(targetUrl, { headers: pageHeaders, timeout: 10 })
    const html = await pageResp.text()

    // 3a. RENDER_DATA
    const rdMatch = html.match(/<script[^>]*id="RENDER_DATA"[^>]*>([^<]+)<\/script>/)
    if (rdMatch) {
      try {
        const decoded = decodeURIComponent(rdMatch[1])
        const data = JSON.parse(decoded)
        const itemList = data?.app?.videoInfoRes?.item_list
        if (itemList?.[0]) {
          applyItem(itemList[0])
          fetchSucceeded = true
        }
        const imgs = itemList?.[0]?.images || data?.app?.note?.[0]?.image_list
        if (imgs?.length && !result.video_url) {
          result.images = imgs.map((img: any) =>
            (img.url_list || img.urlList || []).slice(-1)[0] || ''
          ).filter(Boolean)
          fetchSucceeded = true
        }
      } catch {}
    }
    if (fetchSucceeded && (result.video_url || result.images?.length)) {
      result.success = true
      result.platform = 'douyin'
      result.link = targetUrl
      return result
    }

    // 3b. SSR 水合数据
    const ssrMatch = html.match(/window\._SSR_HYDRATADATA\s*=\s*({.+?});\n*<\/script>/s)
    if (ssrMatch) {
      try {
        const ssr = JSON.parse(ssrMatch[1])
        const vl = ssr?.initialState?.video?.videoList || ssr?.video?.videoList || {}
        const key = Object.keys(vl)[0]
        if (key && vl[key]) {
          applyItem(vl[key])
          fetchSucceeded = true
        }
      } catch {}
    }
    if (fetchSucceeded && (result.video_url || result.images?.length)) {
      result.success = true
      result.platform = 'douyin'
      result.link = targetUrl
      return result
    }

    // 3c. OG meta 标签
    const ogVideo = html.match(/<meta[^>]*property="og:video(?::url)?"[^>]*content="([^"]+)"/i)
    if (ogVideo) {
      result.video_url = ogVideo[1].replace(/playwm/g, 'play')
      result.success = true
      fetchSucceeded = true
      const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)
      if (ogTitle) result.title = ogTitle[1]
      const ogImage = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i)
      if (ogImage) result.cover_url = ogImage[1]
    }
    if (fetchSucceeded && (result.video_url || result.images?.length)) {
      result.success = true
      result.platform = 'douyin'
      result.link = targetUrl
      return result
    }
  } catch {
    // fetch 失败，静默继续
  }

  // ════════════════════════════════════════════════════════
  // 策略 4: WebViewController 全量提取（最终兜底）
  // ════════════════════════════════════════════════════════
  const webView = new WebViewController({ ephemeral: true })
  try {
    webView.setCustomUserAgent(UA)
    await setPlatformCookies(webView, 'douyin')
    await webView.loadURL(targetUrl)
    const svLoad = webView.waitForLoad().then(() => true)
    const svLoadResult = await Promise.race([svLoad, new Promise(r => setTimeout(() => r(false), 20000))])
    if (!svLoadResult) {
      console.log('WebView 加载超时，尝试继续提取')
    }
    await sleep(4000)

    await Promise.race([
      webView.evaluateJavaScript(`
        (async () => {
          const video = document.querySelector('video')
          if (video) { video.muted = true; await video.play().catch(() => {}) }
        })()
      `),
      new Promise(r => setTimeout(() => r(null), 5000)),
    ])
    await sleep(2500)

    const pageDataRaw = await Promise.race([
      webView.evaluateJavaScript<string>(`
        const mediaEntries = performance.getEntriesByType('resource')
          .map(e => e.name)
          .filter(function(n) { try { var p = new URL(n).pathname; if (p.match(/\.(js|css|webp|svg)$/)) return false; return ['/play/','playwm','mp4','douyinvod','tos-cn'].some(function(t) { return p.includes(t); }); } catch { return false; }})
        const scripts = Array.from(document.scripts)
          .map(s => s.textContent || '')
          .filter(t => ['aweme_detail','play_addr','bit_rate','playwm','video_id','iteminfo','_ROUTER_DATA','videoInfoRes'].some(k => t.includes(k)))
          .slice(0, 8).map(t => t.slice(0, 12000))
        let routerDataJSON = null, videoInfoResJSON = null
        try {
          if (typeof window._ROUTER_DATA !== 'undefined') {
            routerDataJSON = JSON.stringify(window._ROUTER_DATA)
            const loaderValues = Object.values(window._ROUTER_DATA?.loaderData || {})
            for (const v of loaderValues) {
              if (v?.videoInfoRes) { videoInfoResJSON = JSON.stringify(v.videoInfoRes); break }
            }
          }
        } catch(e) {}
        try {
          if (!videoInfoResJSON && typeof window.videoInfoRes !== 'undefined') {
            videoInfoResJSON = JSON.stringify(window.videoInfoRes)
          }
        } catch(e) {}
        return JSON.stringify({
          pageURL: location.href,
          canonical: document.querySelector('link[rel="canonical"]')?.href || null,
          title: document.title || '',
          videoSrc: document.querySelector('video')?.currentSrc || document.querySelector('video')?.src || null,
          routerDataJSON, videoInfoResJSON,
          resourceHints: scripts,
          performanceMedia: mediaEntries,
        })
      `),
      new Promise<string>(r => setTimeout(() => r('__TIMEOUT__'), 10000)),
    ]).then(r => {
      if (r === '__TIMEOUT__') return null
      try { return JSON.parse(r) } catch { return null }
    })
    if (!pageDataRaw) {
      webView.dispose()
      result.success = false
      result.error = '页面数据提取超时，请重试'
      return result
    }
    const pageData: any = pageDataRaw

    let item: any = null
    let bestVideoUrl = ''

    const parsedJsons = [
      tryParseJSON(pageData.videoInfoResJSON),
      tryParseJSON(pageData.routerDataJSON),
    ]
    for (const parsed of parsedJsons) {
      if (!parsed) continue
      const items = parsed?.item_list || []
      if (items?.[0]) { item = items[0]; break }
      if (parsed?.aweme_detail) { item = parsed.aweme_detail; break }
      for (const key of ['videoInfoRes', 'video_info_res', 'aweme', 'data']) {
        const d = (parsed as any)?.[key]
        if (d) {
          const il = d?.item_list || []
          if (il?.[0]) { item = il[0]; break }
          if (d?.aweme_detail) { item = d.aweme_detail; break }
          if (d?.video || d?.aweme_id) { item = d; break }
        }
      }
      if (item) break
    }

    if (item) {
      applyItem(item)
      if (result.videoUrls?.length) bestVideoUrl = result.videoUrls[0]
    }

    if (!item && pageData.resourceHints?.length) {
      for (const script of pageData.resourceHints) {
        if (item) break
        const parsed = tryParseJSON(script)
        if (!parsed) continue
        const stack = [parsed]
        while (stack.length) {
          const obj = stack.pop()
          if (!obj || typeof obj !== 'object') continue
          if ((obj as any).aweme_detail) { item = (obj as any).aweme_detail; break }
          const pushUFrom = (src: any) => {
            const urls = src?.play_addr?.url_list || []
            if (urls.length) {
              const videoOnlyUrls = urls.filter((u: string) => !u.includes('.mp3') && !u.includes('.m4a') && !u.includes('.ogg') && !u.includes('.wav') && !u.includes('.aac') && !u.includes('.flac'))
              if (videoOnlyUrls.length) {
                bestVideoUrl = bestVideoUrl || videoOnlyUrls[0].replace(/playwm/g, 'play')
                const allU = result.videoUrls || []
                for (const u of videoOnlyUrls) {
                  const noWm = u.replace(/playwm/g, 'play')
                  if (noWm && !allU.includes(noWm)) allU.push(noWm)
                  if (u !== noWm && !allU.includes(u)) allU.push(u)
                }
                result.videoUrls = allU
              }
            }
          }
          for (const v of Object.values(obj as any)) {
            if (v && typeof v === 'object') stack.push(v)
          }
          if (stack.length > 200) break
        }
      }
      if (item) applyItem(item)
    }

    if (!bestVideoUrl && pageData.performanceMedia?.length) {
      const mediaUrls = pageData.performanceMedia as string[]
      const videoMediaUrls = mediaUrls.filter(function(m) {
        if (m.includes('.mp3') || m.includes('.m4a') || m.includes('.ogg') || m.includes('.wav') || m.includes('.aac') || m.includes('.flac')) return false;
        if (m.includes('.webp') || m.includes('douyinpic.com') || m.includes('douyincdnpic.com')) return false;
        if (m.match(/\.(js|css|svg)(\?|$)/i)) return false;
        return true;
      })
      for (const m of videoMediaUrls) {
        if (m.includes('/play/') && !m.includes('playwm')) { bestVideoUrl = m; break }
      }
      if (!bestVideoUrl) {
        for (const m of videoMediaUrls) {
          if (m.includes('.mp4') || m.includes('video') || m.includes('douyinvod')) { bestVideoUrl = m; break }
        }
      }
      if (!bestVideoUrl && videoMediaUrls.length) bestVideoUrl = videoMediaUrls[0].replace(/playwm/g, 'play')
      if (videoMediaUrls.length) {
        const allU = result.videoUrls || []
        for (const m of videoMediaUrls) {
          if ((m.includes('.mp4') || m.includes('/play/') || m.includes('video')) && !allU.includes(m)) allU.push(m)
        }
        result.videoUrls = allU
      }
    }

    if (!bestVideoUrl && pageData.videoSrc && !pageData.videoSrc.startsWith('blob:')) {
      const src = pageData.videoSrc
      // 跳过图片 URL（douyinpic.com / .webp / .jpg）
      const isImageUrl = /\.webp(\?|$)/i.test(src) || /douyinpic\.com/i.test(src) || /douyincdnpic\.com/i.test(src) || (!src.includes('/play/') && (src.includes('.jpg') || src.includes('.png') || src.includes('.jpeg')))
      if (!isImageUrl) {
        bestVideoUrl = src.replace(/playwm/g, 'play')
        const allU = result.videoUrls || []
        if (!allU.includes(bestVideoUrl)) allU.push(bestVideoUrl)
        result.videoUrls = allU
      }
    }

    result.video_url = result.video_url || bestVideoUrl || null
    result.success = !!(result.video_url || result.images?.length)
    if (pageData.pageURL?.startsWith('https://')) result.link = pageData.pageURL
    if (pageData.canonical?.startsWith('https://')) result.link = pageData.canonical
    if (!result.title) result.title = pageData.title || ''

  } catch (e: any) {
    result.success = false
    result.error = e?.message || '页面加载失败'
  } finally {
    webView.dispose()
  }

  // 安全兜底：如果 video_url 是图片/JS URL，清除（避免将非视频当视频下载）
  if (result.video_url) {
    const vu = result.video_url
    if (vu.includes('.webp') || vu.includes('douyinpic.com') || vu.includes('douyincdnpic.com') || vu.includes('.js') || vu.includes('.css')) {
      result.video_url = undefined as any
      result.videoUrls = []
    }
  }

  if (!result.success && !result.error) {
    result.error = mobileFailure
      ? `移动端免签通道失败：${mobileFailure}；页面兜底也没有取到地址`
      : "无法从抖音页面提取视频，请重试"
  }
  return result
}

// 安全 JSON 解析（尝试多种清理方式）
function tryParseJSON(text: string | null | undefined): any {
  if (!text) return null
  for (const candidate of [text, text.trim(), text.replace(/\u2028|\u2029/g, ''), text.replace(/\\u002F/g, '/')]) {
    try { return JSON.parse(candidate) } catch {}
  }
  return null
}

// ─── 小红书 ────────────────────────────────────────────

// ─── 小红书辅助函数（参考 Unmark/LZY-Ricardo） ───

/** 从 URL 提取 24 位笔记 ID */
// ─── 小红书 ────────────────────────────────────────────
// 逻辑都在 ./xiaohongshu 模块：
//  · 带登录 Cookie 抓笔记页 SSR（`__INITIAL_STATE__.note.noteDetailMap`）
//  · 视频用 ffprobe 实测编码后挑 iOS 能解的档（stream 家族名现在是 EF4/EF5/…，字段分不出编码）
//  · 图文用 trace id 重建原图（sns-img-hw.xhscdn.com）
// ⚠️ 登录态的签名 API（edith …/v1/feed）会被单独风控（code 300011），所以不走它。
async function parseXiaohongshu(url: string): Promise<MediaResult> {
  const cookie = await loadPlatformCookieForVideo("xiaohongshu").catch(() => "")
  const parsed = await parseXhsNote(url, cookie)

  const result: MediaResult = {
    success: parsed.success,
    platform: "xiaohongshu",
    title: parsed.title,
    author: parsed.author,
    video_url: parsed.video_url,
    videoUrls: parsed.videoUrls,
    images: parsed.images,
    imagePreviews: parsed.imagePreviews,
    cover_url: parsed.cover_url,
    link: parsed.link || url,
    error: parsed.error,
    debug: parsed.debug ? [...parsed.debug] : [],
  }
  if (parsed.videoQuality) result.debug!.push(`视频档位：${parsed.videoQuality}`)
  if (parsed.livePhotoCount) result.debug!.push(`这条笔记含 ${parsed.livePhotoCount} 张动图（本脚本按原图下载）`)
  return result
}

// ─── Instagram ─────────────────────────────────────────
// ─── Instagram ─────────────────────────────────────────
// Instagram 现在基本必须登录才能取到媒体；旧实现（写死 doc_id 的 GraphQL + WebView 乱抓 <video>）
// 会把登录墙 / 推荐流里的**别的视频**当成结果 —— 这就是「下到的不是这个链接的视频」的根因。
// 现在：模块负责「带登录态 + 校验短码」，WebView 仅作兜底且同样强制校验页面身份。
async function parseInstagram(url: string): Promise<MediaResult> {
  const normalized = url.replace(/\uff1f/g, "?")
  const cookie = await loadPlatformCookieForVideo("instagram").catch(() => "")
  const parsed = await parseInstagramPost(normalized, cookie)

  const mapped: MediaResult = {
    success: parsed.success,
    platform: "instagram",
    title: parsed.title,
    author: parsed.author,
    video_url: parsed.video_url,
    videoUrls: parsed.videoUrls,
    images: parsed.images,
    imagePreviews: parsed.imagePreviews,
    cover_url: parsed.cover_url,
    link: parsed.link || normalized,
    error: parsed.error,
    debug: parsed.debug,
  }
  if (parsed.success) return mapped

  const fallback = await instagramWebViewFallback(normalized, cookie)
  if (fallback?.success) {
    return { ...fallback, debug: [...(parsed.debug || []), ...(fallback.debug || [])] }
  }
  if (fallback?.error) return { ...mapped, error: fallback.error }
  return mapped
}

/** Instagram 视频直链判定（排除头像、缩略图、blob） */
function isInstagramVideoUrl(urlStr: string): boolean {
  return !!urlStr && !urlStr.startsWith("blob:") && (
    urlStr.includes(".mp4") ||
    (/cdninstagram/.test(urlStr) && urlStr.includes("/v/")) ||
    (/fbcdn/.test(urlStr) && urlStr.includes("video"))
  )
}

/** WebView 兜底：注入登录态 + 强制校验「页面确实停在这个帖子」 */
async function instagramWebViewFallback(url: string, cookie: string): Promise<MediaResult | null> {
  const shortcode = instagramShortcode(url)
  const result: MediaResult = { success: false, error: "", platform: "instagram", link: url }
  const webView = new WebViewController({ ephemeral: true })
  try {
    // 实测：桌面 UA 的帖子页是空壳，iPhone UA 才会命中具体帖子
    webView.setCustomUserAgent(IG_PAGE_UA)
    await setPlatformCookies(webView, "instagram")
    const igUrl = url.includes("?") ? url + "&l=1" : url + "?l=1"
    await Promise.race([
      webView.loadURL(igUrl),
      new Promise<void>((resolve) => setTimeout(() => resolve(), 15000)),
    ])
    await webView.waitForLoad().then(() => true).catch(() => false)
    await sleep(3500)

    const data = await webView.evaluateJavaScript<any>(`
      (function () {
        var out = { href: location.href, video: null, poster: null, ogTitle: null, ogImage: null };
        try {
          var v = document.querySelector('article video') || document.querySelector('main video') || document.querySelector('video');
          if (v) { out.video = v.currentSrc || v.src || null; out.poster = v.poster || null }
        } catch (e) {}
        try { var t = document.querySelector('meta[property="og:title"]'); if (t) out.ogTitle = t.content } catch (e) {}
        try { var i = document.querySelector('meta[property="og:image"]'); if (i) out.ogImage = i.content } catch (e) {}
        return out;
      })()
    `)

    // ⚠️ 身份校验：页面必须停在目标帖子上，否则宁可失败也不返回别人的视频
    const href = String(data?.href || "")
    if (shortcode && !href.includes(shortcode)) {
      result.error = `页面没有停在目标帖子（落点 ${href.slice(0, 70)}），已放弃以免下错内容`
      return result
    }

    const videoUrl = [data?.video].filter(Boolean).find((u: string) => isInstagramVideoUrl(u)) || ""
    if (videoUrl) {
      result.video_url = videoUrl
      result.videoUrls = [videoUrl]
      result.cover_url = data?.poster || data?.ogImage || null
      result.title = data?.ogTitle || ""
      result.success = true
      result.debug = [`WebView 兜底命中（${href.slice(0, 60)}）`]
      return result
    }
    result.error = "页面已打开帖子，但仍未取到视频地址"
    return result
  } catch (error) {
    result.error = `WebView 兜底失败：${error instanceof Error ? error.message : String(error)}`
    return result
  } finally {
    webView.dispose()
  }
}

// ─── Bilibili ─────────────────────────────────────────
// 逻辑都在 ./bilibili 模块里（WBI 签名、DASH / progressive 双通道、codec 感知选轨）。
// 关键点：B 站高画质是 **DASH 音视频分离** —— 只下视频轨就会「没声音」。
// 下载阶段（saveVideoToPhotos）会重新解析一次拿新鲜地址，必要时下载双轨并 ffmpeg 无损合轨。
async function parseBilibili(url: string): Promise<MediaResult> {
  const cookie = await loadPlatformCookieForVideo("bilibili").catch(() => "")
  const parsed = await parseBilibiliVideo(url, cookie)

  const result: MediaResult = {
    success: parsed.success,
    platform: "bilibili",
    title: parsed.title,
    author: parsed.author,
    cover_url: parsed.cover_url,
    link: parsed.link || url,
    error: parsed.error,
    debug: parsed.debug ? [...parsed.debug] : [],
  }
  if (!parsed.success) return result

  if (parsed.needsMux && parsed.dashVideoUrl) {
    // DASH 画质更高 → 下载阶段会拉视频轨 + 音频轨再合轨
    result.video_url = parsed.dashVideoUrl
    result.videoUrls = [parsed.video_url || ""].filter(Boolean)
    result.debug!.push(`将下载 DASH 音视频（${qnLabel(parsed.dashVideoQuality)}）并本地无损合轨`)
  } else if (parsed.video_url) {
    result.video_url = parsed.video_url
    result.debug!.push(`使用 progressive 单文件（${qnLabel(parsed.progressiveQuality)}，自带声音）`)
  } else {
    result.video_url = parsed.dashVideoUrl || null
    result.debug!.push("只有 DASH 地址，下载阶段会尝试合轨")
  }
  return result
}

// ─── YouTube ───────────────────────────────────────────
// 逻辑在 ./youtube：用 youtubei player 的 **ANDROID_VR 客户端**拿直链
// （实测 WEB/MWEB 只给 signatureCipher 无直链，IOS/ANDROID 手机端直接 400）；
// 1080p 以上是自适应流（视频/音频分离）→ 下载阶段自动与音频轨 ffmpeg 无损合轨。
async function parseYouTube(url: string): Promise<MediaResult> {
  const cookie = await loadPlatformCookieForVideo("youtube").catch(() => "")
  const parsed = await parseYouTubeVideo(url, cookie)

  const result: MediaResult = {
    success: parsed.success,
    platform: "youtube",
    title: parsed.title,
    author: parsed.author,
    video_url: parsed.video_url,
    videoUrls: parsed.videoUrls,
    audio_url: parsed.audio_url,
    cover_url: parsed.cover_url,
    link: parsed.link || url,
    error: parsed.error,
    debug: parsed.debug ? [...parsed.debug] : [],
  }
  if (parsed.quality) result.debug!.push(`画质：${parsed.quality}`)
  if (parsed.durationSeconds) result.debug!.push(`时长：${parsed.durationSeconds}s`)
  return result
}

// ─── 快手 ──────────────────────────────────────────────
// 逻辑在 ./kuaishou：快手没有好用的公开 JSON 接口，但作品页 HTML 里带 Apollo 缓存
// （`window.__APOLLO_STATE__` → `videoResource.h264` / `manifestH265`，脚本里**优先 H.264**）。
// 命中风控（返回 `{"result":2}`）时自动换路由（`/fw/photo/{id}`）与 UA 重试。
async function parseKuaishouLink(url: string): Promise<MediaResult> {
  const cookie = await loadPlatformCookieForVideo("kuaishou").catch(() => "")
  const parsed = await parseKuaishou(url, cookie)
  const result: MediaResult = {
    success: parsed.success,
    platform: "kuaishou",
    title: parsed.title,
    author: parsed.author,
    video_url: parsed.video_url,
    videoUrls: parsed.videoUrls,
    images: parsed.images,
    imagePreviews: parsed.imagePreviews,
    cover_url: parsed.cover_url,
    link: parsed.link || url,
    error: parsed.error,
    debug: parsed.debug ? [...parsed.debug] : [],
  }
  if (parsed.quality) result.debug!.push(`画质：${parsed.quality}`)
  if (parsed.durationSeconds) result.debug!.push(`时长：${parsed.durationSeconds}s`)
  return result
}

// ─── 微信公众号 ────────────────────────────────────────
// 逻辑在 ./wechat：文章页免登录；正文图片是**懒加载**的 `data-src`（`src` 只是占位图），
// 这是拿到原图的关键；正文里的视频号/微信视频直链也一并提取。
async function parseWeChatLink(url: string): Promise<MediaResult> {
  const cookie = await loadPlatformCookieForVideo("wechat").catch(() => "")
  const parsed = await parseWeChatArticle(url, cookie)
  const result: MediaResult = {
    success: parsed.success,
    platform: "wechat",
    title: parsed.title,
    author: parsed.author,
    video_url: parsed.video_url,
    videoUrls: parsed.videoUrls,
    images: parsed.images,
    imagePreviews: parsed.imagePreviews,
    cover_url: parsed.cover_url,
    link: parsed.link || url,
    error: parsed.error,
    debug: parsed.debug ? [...parsed.debug] : [],
  }
  return result
}

// ─── 微信视频号 ────────────────────────────────────────
// 逻辑在 ./wxchannels。⚠️ 视频号**必须**填「腾讯元宝 yuanbao.tencent.com 登录后的 Cookie」：
// 先用元宝的公开解析接口把分享链接换成 channels 预览地址（带 token/eid），
// 再用它换 H.264 直链。没配 Cookie 会直接提示，不会静默失败。
async function parseWxChannelsLink(url: string): Promise<MediaResult> {
  const cookie = await loadPlatformCookieForVideo("wxchannels").catch(() => "")
  const parsed = await parseWxChannels(url, cookie)
  const result: MediaResult = {
    success: parsed.success,
    platform: "wxchannels",
    title: parsed.title,
    author: parsed.author,
    video_url: parsed.video_url,
    videoUrls: parsed.videoUrls,
    cover_url: parsed.cover_url,
    link: parsed.link || url,
    error: parsed.error,
    debug: parsed.debug ? [...parsed.debug] : [],
  }
  if (parsed.quality) result.debug!.push(`画质：${parsed.quality}`)
  if (parsed.durationSeconds) result.debug!.push(`时长：${parsed.durationSeconds}s`)
  return result
}

// ─── TikTok ────────────────────────────────────────────
const TIKTOK_FEED = 'https://api22-normal-c-alisg.tiktokv.com/aweme/v1/feed/'

function tiktokExtractUrls(data: any): string[] {
  if (typeof data === 'string') {
    if (data.startsWith('//')) return [`https:${data}`]
    return data.startsWith('http') ? [data] : []
  }
  if (Array.isArray(data)) {
    const urls: string[] = []
    for (const item of data) urls.push(...tiktokExtractUrls(item))
    return urls
  }
  if (data && typeof data === 'object') {
    for (const key of ['url_list', 'UrlList', 'urlList']) {
      if (data[key]) return tiktokExtractUrls(data[key])
    }
  }
  return []
}

function tiktokBestVideoUrl(data: any): string | undefined {
  const urls = tiktokExtractUrls(data)
  return urls.find(u => u.includes('aweme')) || urls[0]
}

function tiktokPickCover(videoData: any): string | undefined {
  for (const key of ['origin_cover', 'cover', 'dynamic_cover', 'originCover', 'dynamicCover']) {
    const url = tiktokExtractUrls(videoData?.[key])[0]
    if (url) return url
  }
  return undefined
}

function tiktokParseItem(item: any): MediaResult {
  const r: MediaResult = { success: false, error: '', platform: 'tiktok' }
  r.title = item.desc || ''
  r.author = item.author?.nickname || ''

  // Image post
  const imgPost = item.image_post_info || item.imagePost
  if (imgPost?.images?.length) {
    const imgs: string[] = []
    for (const img of imgPost.images) {
      const d = img.display_image || img.displayImage || img.imageURL || img.image || {}
      const url = tiktokExtractUrls(d)[0]
      if (url) imgs.push(url)
    }
    if (imgs.length) { r.images = imgs; r.success = true; return r }
  }

  // Video: prefer bit_rate array for best quality
  const videoData = item.video || {}
  const bitRates: any[] = videoData.bit_rate || videoData.bitrateInfo || []
  let bestUrl = ''
  let bestQ = -1

  for (const br of bitRates) {
    const pa = br.play_addr || br.PlayAddr || {}
    const url = tiktokBestVideoUrl(pa)
    if (!url) continue
    const w = Number(pa.width || videoData.width || 0)
    const h = Number(pa.height || videoData.height || 0)
    const brQ = Number(br.bit_rate || br.Bitrate || br.bitrate || 0)
    const q = w * h * 1000 + brQ
    if (q > bestQ) { bestQ = q; bestUrl = url }
  }

  if (!bestUrl) { const pa = videoData.play_addr || videoData.playAddr || {}; bestUrl = tiktokBestVideoUrl(pa) || '' }
  if (!bestUrl) { const da = videoData.download_addr || videoData.downloadAddr || {}; bestUrl = tiktokBestVideoUrl(da) || '' }

  if (bestUrl) { r.video_url = bestUrl; r.cover_url = tiktokPickCover(videoData) || null; r.success = true }
  return r
}

async function parseTiktok(url: string): Promise<MediaResult> {
  const result: MediaResult = { success: false, error: '', platform: 'tiktok', link: url }
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

  try {
    // Resolve short links
    let targetUrl = url
    if (url.match(/vm\.tiktok\.com/i)) {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': UA }, timeout: 15 })
        const finalUrl = r.url || ''
        if (finalUrl && finalUrl !== url) targetUrl = finalUrl
      } catch {}
    }

    const idMatch = targetUrl.match(/\/(video|photo)\/(\d+)/)
    const awemeId = idMatch?.[2]

    // Strategy 1: App Feed API
    if (awemeId) {
      try {
        const qs = `iid=7318518857994389254&device_id=7318517321748022790&channel=googleplay&app_name=musical_ly&version_code=300904&device_platform=android&device_type=SM-ASUS_Z01QD&os_version=9&aweme_id=${awemeId}`
        const resp = await fetch(`${TIKTOK_FEED}?${qs}`, {
          headers: { 'User-Agent': UA, 'Referer': 'https://www.tiktok.com/' },
          timeout: 15,
        })
        const data = await resp.json()
        const item = (data.aweme_list || []).find((a: any) => String(a.aweme_id) === awemeId)
        if (item) {
          const parsed = tiktokParseItem(item)
          if (parsed.success) { parsed.link = targetUrl; return parsed }
        }
      } catch {}
    }

    // Strategy 2: Web Hydration (__UNIVERSAL_DATA_FOR_REHYDRATION__) — 使用 facebookexternalhit UA 绕过检测
    try {
      const resp = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.tiktok.com/',
        },
        timeout: 15,
      })
      const html = await resp.text()
      const m = html.match(/<script[^>]+id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i)
      if (m) {
        const ud = tryParseJSON(m[1].replace(/\\u002F/g, '/'))
        const item = ud?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct
        if (item) {
          const parsed = tiktokParseItem(item)
          if (parsed.success) { parsed.link = targetUrl; return parsed }
        }
      }
    } catch {}

    // Strategy 3: WebView fallback
    const webView = new WebViewController({ ephemeral: true })
    try {
      webView.setCustomUserAgent(UA)
      await webView.loadURL(targetUrl)
      await webView.waitForLoad()
      await sleep(3000)

      const extracted = await webView.evaluateJavaScript<any>(`
        try {
          var scripts = document.querySelectorAll('script[id="__UNIVERSAL_DATA_FOR_REHYDRATION__"]')
          for (var s of scripts) {
            try {
              var ud = JSON.parse(s.textContent)
              var item = ((ud.__DEFAULT_SCOPE__ || {})['webapp.video-detail'] || {}).itemInfo?.itemStruct
              if (item) return item
            } catch(e) {}
          }
          var v = document.querySelector('video')
          if (v && v.src && !v.src.startsWith('blob:')) {
            return { video: { play_addr: { url_list: [v.src] } }, desc: document.title }
          }
        } catch(e) {}
        return null
      `)

      if (extracted) {
        const parsed = tiktokParseItem(extracted)
        if (parsed.success) { parsed.link = targetUrl; return parsed }
      }
    } finally { webView.dispose() }

    result.error = '无法获取TikTok作品内容'
  } catch (e: any) { result.error = e.message || String(e) }
  return result
}

// ─── 快手 ──────────────────────────────────────────────

// ─── YouTube ───────────────────────────────────────────
function extractYoutubeId(url: string): string | null {
  return url.match(/[?&]v=([\w-]{11})/)?.[1]
    || url.match(/youtu\.be\/([\w-]{11})/)?.[1]
    || url.match(/\/embed\/([\w-]{11})/)?.[1]
    || url.match(/\/shorts\/([\w-]{11})/)?.[1]
    || null
}

async function parseYoutube(url: string): Promise<MediaResult> {
  const result: MediaResult = { success: false, error: '', platform: 'youtube', link: url }
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

  let targetUrl = url
  const vid = extractYoutubeId(url)
  if (!vid) { result.error = '无法提取YouTube视频ID'; return result }
  if (url.match(/youtu\.be/i)) targetUrl = `https://www.youtube.com/watch?v=${vid}`

  // Strategy 1: oEmbed for metadata
  try {
    const resp = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${vid}`)}&format=json`,
      { timeout: 10 }
    )
    if (resp.ok) {
      const oe = await resp.json()
      if (oe.title) result.title = oe.title
      if (oe.author_name) result.author = oe.author_name
    }
  } catch {}
  result.cover_url = `https://img.youtube.com/vi/${vid}/maxresdefault.jpg`

  // Strategy 2: fetch HTML → ytInitialPlayerResponse (server-rendered, no JS needed)
  try {
    const htmlResp = await fetch(`https://www.youtube.com/watch?v=${vid}`, {
      headers: {
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 15,
    })
    const html = await htmlResp.text()

    // 提取 ytInitialPlayerResponse JSON
    const ytMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{[^\n]+)/)
    if (ytMatch) {
      // 需要完整的 JSON 块 — 从匹配位置找到完整的 {}
      const idx = html.indexOf(ytMatch[0])
      let startBrace = html.indexOf('{', idx)
      if (startBrace !== -1) {
        let depth = 0, end = startBrace
        for (let i = startBrace; i < html.length && i < startBrace + 200000; i++) {
          if (html[i] === '{') depth++
          if (html[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } }
        }
        try {
          const player = JSON.parse(html.slice(startBrace, end))
          const sd = player.streamingData || {}
          const formats = sd.formats || []
          let best: any = null
          for (const f of formats) {
            if (f.url && (!best || (f.height || 0) > (best.height || 0))) best = f
          }
          if (best?.url) {
            result.video_url = best.url
            result.success = true
            result.title = result.title || player.videoDetails?.title || ''
            result.author = result.author || player.videoDetails?.author || ''
            return result
          }
          // adaptiveFormats fallback
          const adaptive = sd.adaptiveFormats || []
          for (const af of adaptive) {
            if (af.url && af.mimeType?.includes('video/mp4')) {
              result.video_url = af.url
              result.success = true
              return result
            }
          }
        } catch {}
      }
    }
  } catch {}
  // Strategy 3: WebView + ytInitialPlayerResponse (兜底)
  const webView = new WebViewController({ ephemeral: true })
  try {
    webView.setCustomUserAgent(UA)
    await webView.loadURL(`https://m.youtube.com/watch?v=${vid}`)
    await webView.waitForLoad()
    await sleep(5000)

    const extracted = await webView.evaluateJavaScript<any>(`
      try {
        var scripts = document.querySelectorAll('script')
        for (var s of scripts) {
          var t = s.textContent || ''
          if (t.indexOf('ytInitialPlayerResponse') === -1) continue
          var start = t.indexOf('ytInitialPlayerResponse')
          var eq = t.indexOf('=', start)
          if (eq === -1) continue
          var i = eq + 1
          while (i < t.length && t[i] === ' ') i++
          if (t[i] !== '{') continue
          var depth = 0, end = i
          for (var j = i; j < t.length; j++) {
            if (t[j] === '{') depth++
            if (t[j] === '}') { depth--; if (depth === 0) { end = j + 1; break } }
          }
          try {
            var player = JSON.parse(t.slice(i, end))
            var sd = player.streamingData || {}
            var formats = sd.formats || []
            var best = null
            for (var f of formats) {
              if (f.url && (!best || ((f.height||0) > (best.height||0)))) best = f
            }
            if (best && best.url) {
              return {
                video_url: best.url,
                title: (player.videoDetails||{}).title||'',
                author: (player.videoDetails||{}).author||'',
                cover: ((player.videoDetails||{}).thumbnail||{}).thumbnails
                  ? player.videoDetails.thumbnail.thumbnails.slice(-1)[0].url : ''
              }
            }
            var adaptive = sd.adaptiveFormats || []
            for (var af of adaptive) {
              if (af.url && af.mimeType && af.mimeType.indexOf('video/mp4') !== -1) {
                return {
                  video_url: af.url,
                  title: (player.videoDetails||{}).title||'',
                  author: (player.videoDetails||{}).author||''
                }
              }
            }
          } catch(e) {}
        }
        var v = document.querySelector('video')
        if (v && v.src && !v.src.startsWith('blob:')) return { video_url: v.src }
      } catch(e) {}
      return null
    `)

    if (extracted) {
      if (extracted.video_url) { result.video_url = extracted.video_url; result.success = true }
      if (extracted.title && !result.title) result.title = extracted.title
      if (extracted.author && !result.author) result.author = extracted.author
      if (extracted.cover && !result.cover_url) result.cover_url = extracted.cover
    }
  } finally { webView.dispose() }

  if (!result.success) result.error = '无法获取YouTube视频播放地址（可能需要登录或有地区限制）'
  return result
}

// ─── 微博 ──────────────────────────────────────────────
const WEIBO_SUB = '_2AkMR47Mlf8NxqwFRmfocxG_lbox2wg7EieKnv0L-JRMxHRl-yT9yqhFdtRB6OmOdyoia9pKPkqoHRRmSBA_WNPaHuybH'

function extractWeiboBid(url: string): string | null {
  const pm = url.match(/\/status\/([^/?#]+)/)
  if (pm) return pm[1]
  const bid = url.split('/').pop()?.split('?')[0]
  if (bid && (bid.match(/^\d+$/) || bid.length === 9)) return bid
  return null
}

function weiboCleanText(text: string): string {
  return text
    .replace(/<a[^>]*>.*?的微博视频.*?<\/a>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/ ?#[^#]+# ?/g, m => ` ${m.replace(/#/g, '').trim()} `)
    .replace(/\s+/g, ' ')
    .trim()
}

async function parseWeibo(url: string): Promise<MediaResult> {
  const result: MediaResult = { success: false, error: '', platform: 'weibo', link: url }
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'

  // 加载用户配置的 Cookie（优先使用用户 Cookie，否则用默认 SUB）
  const cookieConfig = await loadCookies()
  const userCookie = ((cookieConfig as any).weibo || '').trim()
  const cookieHeader = userCookie || `SUB=${WEIBO_SUB}`

  try {
    // Resolve mapp.fx links
    let targetUrl = url
    if (url.includes('mapp.api.weibo.cn')) {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': UA }, timeout: 15 })
        const finalUrl = r.url || ''
        if (finalUrl && finalUrl !== url) targetUrl = finalUrl
      } catch {}
    }

    const bid = extractWeiboBid(targetUrl)
    if (!bid) { result.error = '无法提取微博ID'; return result }

    // Strategy 1: Ajax API
    try {
      const resp = await fetch(
        `https://weibo.com/ajax/statuses/show?id=${bid}&isGetLongText=true`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Referer': 'https://weibo.com/',
            'Cookie': cookieHeader,
          },
          timeout: 15,
        }
      )
      const data = await resp.json()
      if (data.error) { result.error = String(data.error); return result }

      result.title = weiboCleanText(data.text_raw || data.text || '').slice(0, 200)
      result.author = data.user?.screen_name || ''

      const src = data.retweeted_status || data

      // Video via page_info
      if (!src.pic_infos && src.page_info?.object_type === 'video') {
        const mi = src.page_info.media_info
        const pb = mi?.playback_list?.[0]?.play_info
        if (pb?.url) {
          result.video_url = pb.url; result.cover_url = src.page_info.page_pic || null
          result.success = true; return result
        }
        if (mi?.mp4_hd_url || mi?.mp4_sd_url) {
          result.video_url = mi.mp4_hd_url || mi.mp4_sd_url
          result.cover_url = src.page_info.page_pic || null
          result.success = true; return result
        }
      }

      // Images from pic_infos
      const images: string[] = []
      if (src.pic_infos) {
        for (const pic of Object.values<any>(src.pic_infos)) {
          if (pic.largest?.url) images.push(pic.largest.url)
          else if (pic.large?.url) images.push(pic.large.url)
        }
      }

      // Mix media
      if (!images.length && src.mix_media_info?.items) {
        for (const item of src.mix_media_info.items) {
          if (item.type === 'video') {
            const d = item.data; const mi = d?.media_info
            const pb = mi?.playback_list?.[0]?.play_info
            if (pb?.url) {
              result.video_url = pb.url; result.cover_url = d?.page_pic || null
              result.success = true; return result
            }
            if (mi?.mp4_hd_url || mi?.mp4_sd_url) {
              result.video_url = mi.mp4_hd_url || mi.mp4_sd_url
              result.success = true; return result
            }
          }
          if (item.type === 'pic') {
            const d = item.data
            if (d?.largest?.url) images.push(d.largest.url)
            else if (d?.large?.url) images.push(d.large.url)
          }
        }
      }

      if (images.length) { result.images = images; result.success = true; return result }
    } catch {}

    // Strategy 2: WebView fallback (m.weibo.cn)
    const webView = new WebViewController({ ephemeral: true })
    try {
      webView.setCustomUserAgent(UA)
      await webView.loadURL(`https://m.weibo.cn/detail/${bid}`)
      await webView.waitForLoad()
      await sleep(3000)

      const extracted = await webView.evaluateJavaScript<any>(`
        try {
          var scripts = document.querySelectorAll('script')
          for (var s of scripts) {
            var t = s.textContent || ''
            var m = t.match(/var \\$render_data = \\[([\\s\\S]*?)\\]\\[0\\]/)
            if (m) {
              try {
                var rd = JSON.parse('[' + m[1] + ']')[0]
                var status = rd.status || rd
                if (status.page_info && status.page_info.type === 'video') {
                  var mi = status.page_info.media_info || {}
                  return { video_url: mi.mp4_hd_url || mi.mp4_sd_url || '' }
                }
                var pics = status.pics || []
                var imgs = pics.map(function(p) { return p.large ? p.large.url : p.url }).filter(Boolean)
                if (imgs.length) return { images: imgs }
              } catch(e) {}
            }
          }
          var v = document.querySelector('video')
          if (v && v.src && !v.src.startsWith('blob:')) return { video_url: v.src }
        } catch(e) {}
        return null
      `)

      if (extracted) {
        if (extracted.video_url) { result.video_url = extracted.video_url; result.success = true }
        if (extracted.images?.length) { result.images = extracted.images; result.success = true }
      }
    } finally { webView.dispose() }

    if (!result.success) result.error = '无法获取微博内容'
  } catch (e: any) { result.error = e.message || String(e) }
  return result
}

// ─── 路由 ──────────────────────────────────────────────
const PARSERS: Record<string, (url: string) => Promise<MediaResult>> = {
  douyin: parseDouyin,
  twitter: parseTwitter,
  xiaohongshu: parseXiaohongshu,
  instagram: parseInstagram,
  bilibili: parseBilibili,
  youtube: parseYouTube,
  kuaishou: parseKuaishouLink,
  wechat: parseWeChatLink,
  wxchannels: parseWxChannelsLink,
}

async function parseGeneric(url: string): Promise<MediaResult> {
  const result: MediaResult = { success: false, error: '' }
  try {
    const pageResp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone) Mobile/15E148' } })
    const html = await pageResp.text()
    const ogVideo = html.match(/<meta[^>]*property="og:video(?::url)?"[^>]*content="([^"]+)"/i)
    if (ogVideo) { result.video_url = ogVideo[1]; result.success = true }
    const ogImage = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i)
    if (ogImage) result.cover_url = ogImage[1]
    const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)
    if (ogTitle) result.title = ogTitle[1]
    // 从 PLATFORMS 数组中直接查找匹配的平台
    for (const [platform, patterns] of PLATFORMS) {
      for (const p of patterns) {
        if (url.match(p)) { result.platform = platform; break }
      }
      if (result.platform) break
    }
    result.platform = result.platform || 'unknown'
    result.link = url
  } catch (e: any) { result.error = e.message || String(e) }
  return result
}

async function parseDetected(detected: { platform: string; url: string }): Promise<MediaResult> {
  const parser = PARSERS[detected.platform]
  if (!parser) return { success: false, error: `平台 "${detected.platform}" 暂不支持` }
  const result = await parser(detected.url)
  result.platform = result.platform || detected.platform
  result.link = result.link || detected.url
  return result
}

async function parseAll(url: string): Promise<MediaResult> {
  const detected = detectPlatform(url)
  if (!detected) return { success: false, error: '未识别到支持的平台链接' }
  return await parseDetected(detected)
}

// ─── 下载保存 ──────────────────────────────────────────

function safeFileName(input: string | undefined, fallback: string): string {
  const raw = (input || fallback).trim()
  return raw.replace(/[\/:*?"<>|\n\r]+/g, '_').slice(0, 80) || fallback
}

function ensureExt(fileName: string, ext: string): string {
  return fileName.toLowerCase().endsWith(ext.toLowerCase()) ? fileName : `${fileName}${ext}`
}

// 检查 URL 是否是有效的可下载 URL
function isValidDownloadUrl(url: string): boolean {
  if (!url) return false
  if (/^blob:/i.test(url) || /^data:/i.test(url)) return false
  if (/\.(mp3|m4a|ogg|wav|aac|flac)(\?|$)/i.test(url)) return false
  if (/\.(js|css|webp|svg)(\?|$)/i.test(url)) return false
  if (!/^https?:\/\//i.test(url)) {
    if (/^\/\//i.test(url)) return true
    return false
  }
  return true
}

// 归一化 URL：处理协议相对路径
function normalizeUrl(url: string): string {
  if (/^\/\//i.test(url)) return 'https:' + url
  return url
}

// 移除小红书 CDN URL 中的水印路径
// 有水印: https://sns-video-bd.xhscdn.com/v1/abc.mp4/watermark/xxx
// 无水印: https://sns-video-bd.xhscdn.com/v1/abc.mp4
function removeWatermarkFromUrl(url: string): string {
  if (!url) return url
  // 删除 /watermark/ 及之后的所有路径
  const wmIndex = url.indexOf('/watermark/')
  if (wmIndex > 0) return url.slice(0, wmIndex)
  // 也处理 @ 后缀（小红书图片 CDN 的裁剪/水印参数如 @750w_750h_!webp_watermark）
  const atIndex = url.indexOf('@')
  if (atIndex > url.indexOf('/')) return url.slice(0, atIndex)
  return url
}

function rawUrlsContain(candidates: {url:string}[], url: string): boolean {
  const normal = url.split('?')[0].replace(/playwm/g, 'play')
  return candidates.some(c => c.url.split('?')[0] === normal)
}

/** 获取平台域名 Referer（CDN 校验 Referer 时使用） */
function getPlatformReferer(platform?: string, link?: string): string {
  // 优先使用页面 URL 的域名（如果是真实平台页面）
  if (link) {
    try {
      const u = new URL(link)
      // 跳过 xhslink/douyin short links，直接用平台域名
      if (platform === 'xiaohongshu' && !u.hostname.includes('xhslink')) {
        return 'https://www.xiaohongshu.com/'
      }
      if (platform === 'douyin' && !u.hostname.includes('douyin.cn')) {
        return 'https://www.douyin.com/'
      }
      if (['instagram.com', 'bilibili.com', 'youtube.com', 'tiktok.com', 'kuaishou.com', 'weibo.com', 'twitter.com', 'x.com'].some(d => u.hostname.includes(d))) {
        return `${u.protocol}//${u.hostname}/`
      }
    } catch {}
  }
  // fallback：直接用平台域名
  const map: Record<string, string> = {
    xiaohongshu: 'https://www.xiaohongshu.com/',
    instagram: 'https://www.instagram.com/',
    bilibili: 'https://www.bilibili.com/',
    youtube: 'https://www.youtube.com/',
    tiktok: 'https://www.tiktok.com/',
    kuaishou: 'https://www.kuaishou.com/',
    weibo: 'https://weibo.com/',
    twitter: 'https://twitter.com/',
  }
  return platform ? (map[platform] || '') : ''
}

/** 加载平台 Cookie（视频 CDN 需要登录态） */
async function loadPlatformCookieForVideo(platform?: string): Promise<string> {
  if (!platform) return ''
  try {
    const config = await loadCookies()
    const key = platform === 'twitter' ? 'twitter' : platform
    return (config as any)?.[key] || ''
  } catch {
    return ''
  }
}

/**
 * B 站下载：高画质是 DASH（音视频分离），所以要按情况处理：
 *  · progressive 单文件（自带声音）够好 → 直接下（快）
 *  · DASH 画质更高 → 分块下载视频轨 + 音频轨，再用 ffmpeg `-c copy` **无损合轨**
 * ⚠️ CDN 里混着 PCDN 节点（长连接会中途卡死），所以一律走分块下载。
 */
async function downloadBilibiliMedia(
  input: string,
  title: string | undefined,
  cookie: string
): Promise<{ ok: true; msg: string; bytes: number; path: string } | { ok: false; note: string }> {
  const parsed = await parseBilibiliVideo(input, cookie)
  if (!parsed.success) return { ok: false, note: parsed.error || "B站解析失败" }

  const headers = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    "Referer": "https://www.bilibili.com/",
    ...(cookie ? { Cookie: cookie } : {}),
  }
  const stamp = Date.now()
  const dir = FileManager.documentsDirectory
  const fileName = ensureExt(safeFileName(title || parsed.title, `bili_${stamp}.mp4`), ".mp4")
  const finalPath = dir + fileName
  const tempVideo = `${dir}bili_v_${stamp}.mp4`
  const tempAudio = `${dir}bili_a_${stamp}.m4s`
  const tempMux = `${dir}bili_mux_${stamp}.mp4`

  try {
    let bytes = 0
    let how = ""

    if (parsed.needsMux && parsed.dashVideoUrl && parsed.dashAudioUrl) {
      const v = await downloadToFile(parsed.dashVideoUrl, tempVideo, { headers })
      if (!v.ok) throw new Error(`视频轨下载失败：${v.note}`)
      const a = await downloadToFile(parsed.dashAudioUrl, tempAudio, { headers, directThreshold: 1024 * 1024 })
      if (!a.ok) throw new Error(`音频轨下载失败：${a.note}`)
      const muxed = await muxVideoAudio(tempVideo, tempAudio, tempMux)
      if (!muxed.ok) throw new Error(`合轨失败：${muxed.note}`)
      await Shell.run(`mv -f "${tempMux}" "${finalPath}"`, { timeout: 60 })
      bytes = v.bytes + a.bytes
      how = `DASH ${qnLabel(parsed.dashVideoQuality)} 音视频合轨（${muxed.via === "ffmpeg" ? "无损" : "重编码"}，${(muxed.duration || 0).toFixed(0)}s）`
    } else if (parsed.video_url) {
      const d = await downloadToFile(parsed.video_url, finalPath, { headers })
      if (!d.ok) throw new Error(`下载失败：${d.note}`)
      bytes = d.bytes
      how = `progressive ${qnLabel(parsed.progressiveQuality)} 单文件（自带声音）`
    } else if (parsed.dashVideoUrl) {
      throw new Error("只有 DASH 视频轨且没有音频轨，无法合成带声音的视频")
    } else {
      throw new Error("没有拿到播放地址")
    }

    if (!(await FileManager.exists(finalPath))) throw new Error("下载后文件不存在")
    let saved = await Photos.saveVideo(finalPath, { shouldMoveFile: false })
    if (!saved) saved = await Photos.saveVideo(finalPath)
    if (!saved) throw new Error("保存到相册失败")

    return {
      ok: true,
      msg: `视频已保存到系统相册（B站 ${how}，${formatBytes(bytes)}）`,
      bytes,
      path: finalPath,
    }
  } catch (error) {
    return { ok: false, note: error instanceof Error ? error.message : String(error) }
  } finally {
    await removeQuietly(tempVideo)
    await removeQuietly(tempAudio)
    await removeQuietly(tempMux)
  }
}

async function saveVideoToPhotos(
  videoUrl: string,
  title?: string,
  link?: string,
  platform?: string,
  videoId?: string,
  videoUrls?: string[],
  videoUri?: string,
  audioUrl?: string): Promise<{ msg: string; bytes: number; path?: string }> {
  let downloadedBytes = 0
  // 构建多候选下载列表（抖音走多候选，其他平台走单 URL）
  interface Candidate { url: string; headers: Record<string, string>; label: string }
  const candidates: Candidate[] = []
  /** 提前声明：B 站分支需要在候选循环之前写失败原因 */
  let lastError = '所有下载候选均失败'

  const UA = DY_DOWNLOAD_UA

  // 加载平台 Cookie（用于 CDN 下载）
  let platformCookie = ''
  if (platform) {
    try {
      const config = await loadCookies()
      platformCookie = ((config as any)[platform] || '').trim()
    } catch {}
  }

  // ─── 通用双轨合轨：视频轨 + 独立音频轨（YouTube 自适应流等）───
  // 先试这条路：成功就直接返回；失败才继续走下面的候选逻辑（至少存下视频轨）
  if (videoUrl && audioUrl && isValidDownloadUrl(videoUrl) && isValidDownloadUrl(audioUrl)) {
    const stamp = Date.now()
    const dir = FileManager.documentsDirectory
    const finalPath = dir + ensureExt(safeFileName(title, `video_${stamp}.mp4`), '.mp4')
    const tempVideo = `${dir}av_v_${stamp}.mp4`
    const tempAudio = `${dir}av_a_${stamp}.m4a`
    const tempMux = `${dir}av_m_${stamp}.mp4`
    const trackHeaders: Record<string, string> = { 'User-Agent': UA, 'Accept': '*/*' }
    if (platform === 'youtube') trackHeaders['Referer'] = 'https://www.youtube.com/'
    try {
      const v = await downloadToFile(videoUrl, tempVideo, { headers: trackHeaders })
      if (!v.ok) throw new Error(`视频轨下载失败：${v.note}`)
      const a = await downloadToFile(audioUrl, tempAudio, { headers: trackHeaders, directThreshold: 4 * 1024 * 1024 })
      if (!a.ok) throw new Error(`音频轨下载失败：${a.note}`)
      const muxed = await muxVideoAudio(tempVideo, tempAudio, tempMux)
      if (!muxed.ok) throw new Error(`合轨失败：${muxed.note}`)
      await Shell.run(`mv -f "${tempMux}" "${finalPath}"`, { timeout: 60 })
      let saved = await Photos.saveVideo(finalPath, { shouldMoveFile: false })
      if (!saved) saved = await Photos.saveVideo(finalPath)
      if (!saved) throw new Error('保存到相册失败')
      return {
        msg: `视频已保存到系统相册（音视频合轨：${muxed.via === 'ffmpeg' ? '无损' : '重编码'}，${formatBytes(v.bytes + a.bytes)}）`,
        bytes: v.bytes + a.bytes,
        path: finalPath,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    } finally {
      await removeQuietly(tempVideo)
      await removeQuietly(tempAudio)
      await removeQuietly(tempMux)
    }
  }

  if (platform === 'douyin') {
    // ─── 抖音多候选 ────────────────────────────────────
    // 画质优先级：snssdk 1080p > iesdouyin v1/play > CDN 镜像
    const pageRef = link && !link.startsWith('blob:') && link.startsWith('https://') ? link : 'https://www.douyin.com/'
    const useCookie = platformCookie ? {
      'User-Agent': UA,
      'Accept': '*/*',
      'Origin': 'https://www.douyin.com',
      Cookie: platformCookie,
    } : {
      'User-Agent': UA,
      'Accept': '*/*',
      'Origin': 'https://www.douyin.com',
    }

    // 0. 移动端免签通道：现场重取详情（60s 缓存），按短边选最高画质无水印直链
    if (videoId) {
      try {
        const { detail } = await fetchDouyinDetailMobile(videoId)
        if (detail?.video) {
          for (const c of buildDouyinDownloadCandidates(detail.video)) {
            candidates.push({ url: c.url, headers: { ...useCookie, Referer: pageRef } as Record<string, string>, label: `移动端${c.label}` })
          }
        }
      } catch {}
    }

    // 1. snssdk 1080p 画质升级（下载时重新获取新鲜 CDN 直链，15s）
    if (videoUri) {
      const url = await get1080pUrlFromUri(videoUri, platformCookie, '1080p')
      if (url) {
        const noWm = normalizeUrl(url.replace(/playwm/g, 'play'))
        candidates.push({ url: noWm, headers: { ...useCookie, Referer: pageRef } as Record<string, string>, label: 'snssdk 1080p' })
      }
    }

    // 2. video_url（parseDouyin 的 1080p 直链，可能已过期，做兜底）
    if (isValidDownloadUrl(videoUrl) && videoUrl.startsWith('http')) {
      candidates.push({ url: videoUrl, headers: { ...useCookie, Referer: pageRef } as Record<string, string>, label: 'video_url' })
    }

    // 3. CDN 镜像候选（videoUrls 中的 play_addr 直链）
    if (videoUrls?.length) {
      for (const raw of videoUrls) {
        if (!isValidDownloadUrl(raw)) continue
        // 跳过和 videoUrl 相同的 URL（已在候选 1）
        if (normalizeUrl(raw) === videoUrl || raw === videoUrl) continue
        const normalized = normalizeUrl(raw)
        const noWm = normalized.replace(/playwm/g, 'play')
        if (noWm !== normalized && isValidDownloadUrl(noWm)) {
          candidates.push({ url: noWm, headers: { ...useCookie, Referer: pageRef } as Record<string, string>, label: `CDN无水印_${candidates.length}` })
        }
        candidates.push({ url: normalized, headers: { ...useCookie, Referer: pageRef } as Record<string, string>, label: `CDN原始_${candidates.length}` })
      }
    }

    // 3. iesdouyin v1/play 候选（720p 兜底）
    const vid = videoId || videoUrl.match(/[?&]video_id=([^&]+)/)?.[1] || ''
    if (vid && /^\d+$/.test(vid)) {
      candidates.push({
        url: `https://www.iesdouyin.com/aweme/v1/play/?video_id=${vid}&ratio=720p&line=0&is_play_url=1&watermark=0&source=PackSourceEnum_PUBLISH`,
        headers: { ...useCookie, Referer: pageRef } as Record<string, string>,
        label: 'iesdouyin v1/play 720p',
      })
    }

    // 4. videoSrc 候选兜底
    if (isValidDownloadUrl(videoUrl) && !candidates.some(c => c.url === videoUrl || c.url === normalizeUrl(videoUrl))) {
      candidates.push({ url: normalizeUrl(videoUrl), headers: { ...useCookie, Referer: pageRef } as Record<string, string>, label: 'videoSrc' })
    }
  } else if (platform === 'bilibili') {
    // ─── B站：DASH 音视频分离 → 该合轨就合轨（无损 -c copy） ───
    const biliCookie = platformCookie || ''
    const biliNote: string[] = []
    const done = await downloadBilibiliMedia(link || videoUrl, title, biliCookie)
    if (done.ok) return { msg: done.msg, bytes: done.bytes, path: done.path }
    biliNote.push(done.note)
    // 兜底：把已知地址塞进通用候选，让下面那段多候选逻辑再试一次
    const fallbackHeaders = {
      'User-Agent': UA,
      'Referer': 'https://www.bilibili.com/',
      ...(biliCookie ? { Cookie: biliCookie } : {}),
    }
    for (const u of [videoUrl, ...(videoUrls || [])]) {
      if (isValidDownloadUrl(u)) candidates.push({ url: normalizeUrl(u), headers: fallbackHeaders as Record<string, string>, label: 'B站兜底' })
    }
    lastError = `B站专用通道失败：${biliNote.join("；")}`
  } else {
    // ─── 非抖音平台：多策略（ParseHub 方案 + CDN 轮换）──
    // 收集所有候选 URL（从 videoUrl 和 videoUrls）
    const allSrcUrls: string[] = []
    if (isValidDownloadUrl(videoUrl)) allSrcUrls.push(videoUrl)
    if (videoUrls?.length) {
      for (const u of videoUrls) {
        if (isValidDownloadUrl(u) && !allSrcUrls.includes(u)) allSrcUrls.push(u)
      }
    }
    if (allSrcUrls.length === 0) {
      throw new Error(`不支持的URL: ${(videoUrl || '').slice(0, 80)} — 请尝试重新解析`)
    }
    const pf: string = platform || 'default'
    const desktopUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'
    const mobileUA = UA
    
    // 按平台决定下载 headers
    const buildHeaders = (u: string): Record<string, string> => {
      const base: Record<string, string> = { 'User-Agent': desktopUA, 'Accept': '*/*' }
      // Bilibili CDN 需要 Referer 校验，可选 Cookie 用于高画质
      if (pf === 'bilibili') {
        base['Referer'] = 'https://www.bilibili.com/'
        if (platformCookie) base['Cookie'] = platformCookie
      }
      // 小红书/Instagram 等不要加 Referer/Cookie（防 403）
      return base
    }
    
    const cdnNodes = ['hw', 'qc', 'bd', 'hz']
    // ParseHub 方案：不加任何自定义 headers，仅 User-Agent + Accept
    for (const srcUrl of allSrcUrls) {
      const secureUrl = srcUrl.startsWith('http://') ? 'https://' + srcUrl.slice(7) : srcUrl
      const currentMatch = secureUrl.match(/sns-video-([a-z0-9]{2})\.xhscdn\.com/)
      const currentNode = currentMatch ? currentMatch[1] : null
      const rotatedUrls: string[] = [secureUrl]
      if (currentNode) {
        for (const node of cdnNodes) {
          if (node !== currentNode) {
            rotatedUrls.push(secureUrl.replace(`sns-video-${currentNode}.xhscdn.com`, `sns-video-${node}.xhscdn.com`))
          }
        }
      }
      for (const u of rotatedUrls) {
        const h = buildHeaders(u)
        candidates.push({ url: normalizeUrl(u), headers: h, label: `${pf}_${currentNode || 'cdn'}_desktop` })
      }
    }
  }

  // 拒绝 m3u8 的 URL
  for (const c of candidates) {
    if (c.url.match(/\.m3u8/i)) {
      throw new Error(`不支持的URL: HLS 播放列表(m3u8)无法直接保存 — 下载地址不是视频直链`)
    }
  }

  // ─── 依次尝试每个候选 ──────────────────────────────────
  const maxAttempts = Math.min(candidates.length, 10) // 最多试前10个
  let attemptCount = 0
  for (const c of candidates) {
    attemptCount++
    if (attemptCount > maxAttempts) {
      lastError = `已试前${maxAttempts}个候选均失败`
      break
    }
    const downloadTimeout = attemptCount <= 5 ? 10 : 20 // 前5个10s，后续20s
    try {
      const resp = await fetch(c.url, { method: 'GET', timeout: downloadTimeout, headers: c.headers })
      if (!resp.ok) {
        lastError = `${c.label}: HTTP ${resp.status}`
        continue
      }

      // 检查重定向到登录/拒绝页
      const responseUrl = (resp as any).url || ''
      if (responseUrl && responseUrl !== c.url) {
        if (responseUrl.match(/\.html?$/i) || responseUrl.match(/login|signin|auth/i)) {
          lastError = `${c.label}: 被重定向到 ${responseUrl.slice(0, 60)}`
          continue
        }
      }

      // 检查 MIME — 拒绝文本/JSON/m3u/JS等非媒体类型
      const mime = (resp as any).mimeType || ''
      if (mime && !mime.startsWith('video/') && mime !== 'application/octet-stream' && mime !== 'application/octet-stream;charset=UTF-8') {
        if (mime.startsWith('text/') || mime === 'application/json' || mime.includes('javascript') || mime.includes('ecmascript') || mime.includes('xml') || mime.includes('m3u') || mime.includes('vnd.apple')) {
          lastError = `${c.label}: 不支持的响应类型 ${mime}`
          continue
        }
      }

      const videoData = await (resp as any).bytes()
      if (!videoData || (videoData as any).byteLength === 0) {
        lastError = `${c.label}: 下载数据为空`
        continue
      }
      if ((videoData as any).byteLength < 1024) {
        lastError = `${c.label}: 返回内容过小（${(videoData as any).byteLength} 字节）`
        continue
      }
      downloadedBytes = (videoData as any).byteLength

      // 成功！写入文件后让 Photos 移动文件
      const fileName = ensureExt(safeFileName(title, `video_${Date.now()}.mp4`), '.mp4')
      const destPath = FileManager.documentsDirectory + fileName
      try { FileManager.removeSync(destPath) } catch {}
      await FileManager.writeAsBytes(destPath, videoData)

      // 用 shouldMoveFile: false 保留本地副本，支持分享和重新保存
      let saved = await Photos.saveVideo(destPath, { shouldMoveFile: false })
      if (saved) return { msg: '视频已保存到系统相册', bytes: downloadedBytes, path: destPath }

      // 兜底：不传 options
      saved = await Photos.saveVideo(destPath)
      if (saved === true || saved == null) return { msg: '视频已保存到系统相册', bytes: downloadedBytes, path: destPath }

      // 兜底：B站 DASH 视频（无音轨）→ AVAssetExportSession 转封装为标准 MP4
      if (platform === 'bilibili') {
        try {
          const asset = new AVAsset(destPath)
          const exportSession = new AVAssetExportSession(asset, 'HighestQuality')
          exportSession.outputFileType = 'mp4'
          const exportPath = FileManager.documentsDirectory + 'bili_export_' + Date.now() + '.mp4'
          await exportSession.exportTo(exportPath)
          const exported = await Photos.saveVideo(exportPath, { shouldMoveFile: false })
          try { FileManager.removeSync(destPath) } catch {}
          if (exported) return { msg: '视频已保存到系统相册（B站转码）', bytes: downloadedBytes, path: exportPath }
        } catch {}
      }

      // 如果视频保存失败，检查是否是图片 -> 尝试存为照片
      if (mime.startsWith('image/')) {
        const imgFilename = ensureExt(safeFileName(title, `photo_${Date.now()}`), '.jpg')
        const imgPath = FileManager.documentsDirectory + imgFilename
        try { FileManager.removeSync(imgPath) } catch {}
        await FileManager.writeAsBytes(imgPath, videoData)
        const imgSaved = await (Photos.savePhoto as any)(imgPath, { shouldMoveFile: false })
        if (imgSaved) return { msg: '图片已保存到系统相册', bytes: downloadedBytes, path: imgPath }
      }

      throw new Error('保存到相册失败')
    } catch (e) {
      lastError = `${c.label}: ${e instanceof Error ? e.message : String(e)}`
      continue
    }
  }

  // 兜底：原生 download() API（如果可用）
  try {
    const gmDownload = (globalThis as any).download
    if (typeof gmDownload === 'function') {
      const dl = await gmDownload(videoUrl)
      if (dl && (dl as any).data) {
        const fileName = ensureExt(safeFileName(title, `video_${Date.now()}.mp4`), '.mp4')
        const destPath = FileManager.documentsDirectory + fileName
        try { FileManager.removeSync(destPath) } catch {}
        await FileManager.writeAsBytes(destPath, (dl as any).data)
        const saved = await Photos.saveVideo(destPath, { shouldMoveFile: false })
        if (saved) return { msg: '视频已保存到系统相册（原生下载）', bytes: downloadedBytes, path: destPath }
        const savedSimple = await Photos.saveVideo(destPath, { shouldMoveFile: false })
        if (savedSimple === true || savedSimple == null) return { msg: '视频已保存到系统相册（原生下载）', bytes: downloadedBytes, path: destPath }
      }
    }
  } catch (e: any) {
    lastError = `原生download(): ${e.message || String(e)}`
  }
  throw new Error(`下载失败: ${lastError}`)
}

type ImageSaveResult = { msg: string; bytes: number; path?: string; total: number; saved: number; failed: number }

async function saveImagesToPhotos(imageUrls: string[], title?: string, referer?: string, platform?: string): Promise<ImageSaveResult> {
  let totalBytes = 0
  const desktopUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'
  let count = 0
  let lastError = ''
  // 去重：同一 CDN 路径（忽略 !suffix 和 query）只保留一次
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const url of imageUrls) {
    try {
      const u = new URL(url)
      const key = u.protocol + '//' + u.hostname + u.pathname.replace(/![^/]*$/, '').split('?')[0]
      if (!seen.has(key)) { seen.add(key); deduped.push(url) }
    } catch { deduped.push(url) }
  }
  // 使用平台域名 Referer（非 xhslink 短链）
  const effectiveReferer = getPlatformReferer(platform, referer)
  for (let i = 0; i < deduped.length; i++) {
    try {
      const headers: Record<string, string> = {
        'User-Agent': desktopUA,
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      }
      // Instagram CDN 不能带 Referer，否则 403
      // Instagram / 小红书 CDN 都不要带 Referer，否则可能 403
      if (effectiveReferer && platform !== 'instagram' && platform !== 'xiaohongshu') headers['Referer'] = effectiveReferer
      const resp = await fetch(deduped[i], { method: 'GET', timeout: 60, headers })
      if (!resp.ok) { lastError = `HTTP ${resp.status}`; continue }
      const bytes = await (resp as any).bytes()
      if (!bytes || (bytes as any).byteLength < 1024) { lastError = '数据过小或为空'; continue }
      const fileName = ensureExt(safeFileName(title, `img_${Date.now()}_${i}`), '.jpg')
      const destPath = FileManager.documentsDirectory + fileName
      try { FileManager.removeSync(destPath) } catch {}
      await FileManager.writeAsBytes(destPath, bytes as any)
      const ok = await (Photos.savePhoto as any)(destPath, { shouldMoveFile: true })
      try { FileManager.removeSync(destPath) } catch {}
      if (ok) { count += 1; totalBytes += (bytes as any).byteLength || 0 }
    } catch (e: any) {
      lastError = e.message || String(e)
    }
  }
  if (count === 0) throw new Error(`保存图片到相册失败：${lastError || '未知错误'}`)
  const failed = Math.max(0, deduped.length - count)
  return {
    msg: failed > 0 ? `图片已保存 ${count}/${deduped.length} 张，失败 ${failed} 张` : `图片已保存到系统相册，共 ${count} 张`,
    bytes: totalBytes,
    total: deduped.length,
    saved: count,
    failed,
  }
}

// ─── Cookie 管理 ──────────────────────────────────────

interface CookieConfig {
  xiaohongshu: string
  douyin: string
  twitter: string
  instagram: string
  bilibili: string
  youtube: string
  kuaishou: string
  wechat: string
  wxchannels: string
}

function cookieStorageKey(): string {
  return "clearmark_cookies_v1"
}

async function loadCookies(): Promise<CookieConfig> {
  try {
    const raw = Storage.get<string>(cookieStorageKey())
    if (raw) return JSON.parse(raw)
  } catch {}
  return {
    xiaohongshu: "", douyin: "", twitter: "", instagram: "",
    bilibili: "", youtube: "", kuaishou: "", wechat: "", wxchannels: ""
  }
}

async function saveCookies(config: CookieConfig): Promise<void> {
  try {
    Storage.set(cookieStorageKey(), JSON.stringify(config))
  } catch {}
}

function parseCookieString(cookieStr: string, domain: string): Array<{ name: string; value: string; domain: string; path: string; isSecure: boolean; isHTTPOnly: boolean; isSessionOnly: boolean; expiresDate: Date }> {
  if (!cookieStr.trim()) return []
  const result: Array<{ name: string; value: string; domain: string; path: string; isSecure: boolean; isHTTPOnly: boolean; isSessionOnly: boolean; expiresDate: Date }> = []
  const pairs = cookieStr.split(';')
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=')
    if (eqIdx < 0) continue
    const name = pair.slice(0, eqIdx).trim()
    const value = pair.slice(eqIdx + 1).trim()
    if (!name || !value) continue
    result.push({
      name,
      value,
      domain: domain,
      path: "/",
      isSecure: true,
      isHTTPOnly: false,
      isSessionOnly: false,
      expiresDate: new Date(Date.now() + 365 * 86400_000),
    })
  }
  return result
}

const COOKIE_DOMAIN_MAP: Record<string, string> = {
  xiaohongshu: "xiaohongshu.com",
  douyin: "douyin.com",
  twitter: "x.com",
  instagram: "instagram.com",
  bilibili: "bilibili.com",
}

async function setPlatformCookies(webView: WebViewController, platform: string): Promise<void> {
  const config = await loadCookies()
  const cookieStr = (config as any)[platform] || ""
  if (!cookieStr.trim()) return

  const domain = COOKIE_DOMAIN_MAP[platform] || ""
  if (!domain) return

  const cookieObjs = parseCookieString(cookieStr, domain)
  for (const c of cookieObjs) {
    await webView.setCookie(c)
  }
}

// ─── UI ────────────────────────────────────────────────

const PLATFORM_ICON: Record<string, string> = {
  douyin: '🎵', twitter: '🐦', xiaohongshu: '📕',
  instagram: '📸', bilibili: '📺',
  youtube: '▶️',
  kuaishou: '⚡️',
  wxchannels: '🎥',
  wechat: '💬'
}

const PLATFORM_SYSTEM_ICON: Record<string, string> = {
  douyin: 'play.circle.fill',
  twitter: 'at.circle.fill',
  xiaohongshu: 'book.closed.fill',
  instagram: 'camera.fill',
  bilibili: 'play.tv.fill',
  youtube: 'play.rectangle.fill',
  kuaishou: 'bolt.circle.fill',
  wxchannels: 'video.circle.fill',
  wechat: 'bubble.left.and.text.bubble.right.fill',
}

const PLATFORM_TINT: Record<string, string> = {
  douyin: 'label',
  twitter: 'label',
  xiaohongshu: 'systemRed',
  instagram: 'systemPink',
  bilibili: 'systemBlue',
  youtube: 'systemRed',
  kuaishou: 'systemOrange',
  wxchannels: 'systemGreen',
  wechat: 'systemGreen',
}

const PLATFORM_NAME: Record<string, string> = {
  douyin: '抖音', twitter: 'Twitter/X', xiaohongshu: '小红书',
  instagram: 'Instagram', bilibili: 'Bilibili',
  youtube: 'YouTube',
  kuaishou: '快手',
  wxchannels: '微信视频号',
  wechat: '微信公众号'
}

/**
 * 平台主色 —— 去掉平台图标后改用它做视觉锚点（只用文字与细色条，不用图标）。
 * 颜色与各平台品牌色大致对应，方便一眼区分。
 */
const PLATFORM_ACCENT: Record<string, string> = {
  douyin: 'systemPink',
  twitter: 'systemBlue',
  xiaohongshu: 'systemRed',
  instagram: 'systemPurple',
  bilibili: 'systemTeal',
  youtube: 'systemRed',
  kuaishou: 'systemOrange',
  wxchannels: 'systemGreen',
  wechat: 'systemGreen',
}

function platformAccent(platform: string): string {
  return PLATFORM_ACCENT[platform] || 'secondaryLabel'
}

async function getClipboardText(): Promise<string> {
  const text = (await Pasteboard.getString()) || ''
  return text.trim()
}

// ─── 工具 ──────────────────────────────────────────────

function extractFirstURL(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"']+/)
  return m ? m[0] : null
}

function formatBytes(size: number): string {
  return size > 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${(size / 1024).toFixed(1)} KB`
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
}

function failureAdvice(message: string, platform?: string): string {
  const lower = message.toLowerCase()
  if (/未识别|unsupported|支持的平台/.test(message)) return "请确认剪贴板里包含完整分享链接，而不是纯文案或被截断的短链。"
  if (/未找到|媒体|图片|video|image/.test(message)) return platform === "xiaohongshu"
    ? "如果原帖确实有内容，通常是页面返回不完整、Cookie 过期，或该笔记需要登录后才能看到完整图片。"
    : "可以尝试复制 App 分享出的原始链接，或在设置里补充对应平台 Cookie。"
  if (/403|401|登录|cookie|captcha|安全验证|forbidden/.test(lower + message)) return "平台可能要求登录或安全验证。请在设置里更新 Cookie 后重试。"
  if (/timeout|timed out|网络|network|请求失败/.test(lower + message)) return "网络请求超时或被拦截，可以稍后重试，或切换网络后再解析。"
  if (/保存|相册|photo|photos/.test(lower + message)) return "请确认相册权限可用；如果只失败部分图片，通常是个别 CDN 链接临时不可访问。"
  return "可以查看日志里的平台、候选数量和 HTTP 状态，优先确认链接是否需要登录或 Cookie。"
}

function historyMediaSummary(item: HistoryRecord): string {
  const kind = item.mediaKind || (item.videoUrl ? "video" : "image")
  const count = item.mediaCount || 1
  const saved = item.savedCount
  const failed = item.failedCount || 0
  const typeText = kind === "mixed" ? "视频+图片" : kind === "video" ? "视频" : "图片合集"
  const countText = kind === "video" ? "1 项" : kind === "mixed" ? `${count} 项` : `${count} 张`
  const saveText = typeof saved === "number"
    ? failed > 0 ? `已保存 ${saved}/${count}` : `已保存 ${saved}`
    : item.bytesWritten > 0 ? formatBytes(item.bytesWritten) : "已保存到相册"
  return `${typeText} · ${countText} · ${saveText}`
}

// ─── Intent URL 解析 ──────────────────────────────────

function resolveIntentURL(): string | null {
  if (Intent.urlsParameter?.length) {
    return Intent.urlsParameter[0]
  }
  if (Intent.textsParameter?.length) {
    for (const text of Intent.textsParameter) {
      const found = extractFirstURL(text)
      if (found) return found
    }
  }
  const shortcut = Intent.shortcutParameter
  if (shortcut?.type === "fileURL" && typeof shortcut.value === "string") {
    return shortcut.value
  }
  if (shortcut?.type === "text" && typeof shortcut.value === "string") {
    return extractFirstURL(shortcut.value)
  }
  return null
}

async function runIntentDownload(url: string) {
  try {
    const logs: string[] = []
    const appendLog = (msg: string) => {
      const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
      logs.push(`[${ts}] ${msg}`)
    }

    appendLog(`收到 Intent URL：${url}`)
    const r = await parseAll(url)

    if (!r.success) {
      Script.exit(Intent.text(`解析失败：${r.error || "未知错误"}`))
      return
    }

    appendLog(`解析成功：${r.platform} - ${r.title || "(无标题)"}`)

    if (r.video_url) {
      appendLog("正在下载视频...")
      const videoResult = await saveVideoToPhotos(r.video_url, r.title, r.link, r.platform, r.videoId, r.videoUrls, r.videoUri, r.audio_url || undefined)
      appendLog(videoResult.msg)
    } else if (r.images?.length) {
      appendLog("正在保存图片...")
      const imgResult = await saveImagesToPhotos(r.images, r.title, r.link, r.platform)
      appendLog(imgResult.msg)
    }

    Script.exit(Intent.json({
      ok: true,
      platform: r.platform,
      title: r.title,
      videoUrl: r.video_url,
      images: r.images,
      coverUrl: r.cover_url,
      pageURL: r.link,
      logs,
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await Pasteboard.setString(message)
    await alert({
      title: "下载失败",
      message: `${message}\n\n错误信息已复制到剪贴板。`,
      buttonLabel: "好",
    })
    Script.exit(Intent.text(`下载失败：${message}`))
  }
}

// ─── 历史记录 ──────────────────────────────────────────

interface HistoryRecord {
  id: string
  platform: string
  icon: string
  title: string
  videoUrl: string | null
  thumbnailUrl: string | null
  pageURL: string
  createdAt: number
  localFilePath: string | null
  bytesWritten: number
  mediaKind?: "video" | "image" | "mixed"
  mediaCount?: number
  savedCount?: number
  failedCount?: number
  saveSummary?: string
}

type MediaKind = "video" | "image"

interface SelectableMediaItem {
  id: string
  kind: MediaKind
  url: string
  title: string
  thumbnailUrl: string | null
  index: number
}

function uniqueUrls(urls: string[] | undefined): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of urls || []) {
    const url = normalizeUrl((raw || '').trim())
    if (!url || !isValidDownloadUrl(url)) continue
    const key = url.replace(/playwm/g, 'play').split('?')[0]
    if (seen.has(key)) continue
    seen.add(key)
    result.push(url)
  }
  return result
}

function buildSelectableMediaItems(result: MediaResult): SelectableMediaItem[] {
  const items: SelectableMediaItem[] = []
  const title = result.title || "未命名内容"

  if (result.video_url && isValidDownloadUrl(result.video_url)) {
    items.push({
      id: "video_0",
      kind: "video",
      url: normalizeUrl(result.video_url),
      title: `${title} · 视频`,
      thumbnailUrl: result.cover_url || null,
      index: 0,
    })
  }

  uniqueUrls(result.images).forEach((url, index) => {
    const previewUrl = result.imagePreviews?.[index] || url
    items.push({
      id: `image_${index}`,
      kind: "image",
      url,
      title: `${title} · 图片 ${index + 1}`,
      thumbnailUrl: previewUrl,
      index,
    })
  })

  return items
}

function selectedMediaItems(items: SelectableMediaItem[], selectedIds: string[]): SelectableMediaItem[] {
  const selected = new Set(selectedIds)
  return items.filter((item) => selected.has(item.id))
}

function historyKey(): string {
  return "clearmark_history_v1"
}

async function loadHistory(): Promise<HistoryRecord[]> {
  try {
    const raw = Storage.get<string>(historyKey())
    if (raw) return JSON.parse(raw)
  } catch {}
  return []
}

async function saveHistory(records: HistoryRecord[]): Promise<void> {
  try {
    Storage.set(historyKey(), JSON.stringify(records))
  } catch {}
}

async function insertHistory(record: Omit<HistoryRecord, "id">): Promise<HistoryRecord> {
  const list = await loadHistory()
  const entry: HistoryRecord = { ...record, id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }
  list.unshift(entry)
  saveHistory(list.slice(0, 200))
  return entry
}

async function deleteHistory(id: string): Promise<void> {
  const list = await loadHistory()
  saveHistory(list.filter((r) => r.id !== id))
}

function clearAllHistory(): void {
  saveHistory([])
}

// ─── UI 组件 ──────────────────────────────────────────

function PlatformGlyph(props: {
  platform: string
  size?: number
}) {
  const size = props.size || 34
  return (
    <VStack
      frame={{ width: size, height: size, alignment: "center" as any }}
      clipShape={{ type: "rect", cornerRadius: 7 }}
      background={{ style: (PLATFORM_TINT[props.platform] || "tertiarySystemFill") as any, shape: { type: "rect", cornerRadius: 7 } }}
    >
      <Image
        systemName={PLATFORM_SYSTEM_ICON[props.platform] || "link"}
        foregroundStyle={props.platform === "douyin" || props.platform === "twitter" ? "white" : "white"}
        frame={{ width: Math.max(14, size - 16), height: Math.max(14, size - 16) }}
      />
    </VStack>
  )
}

function FloatingIconButton(props: {
  systemImage: string
  onPress: () => void
  iconSize?: number
  disabled?: boolean
}) {
  const iconSize = props.iconSize ?? 26
  return (
    <Button action={props.onPress} disabled={props.disabled} frame={{ width: 58, height: 58 }} glassEffect>
      <Image systemName={props.systemImage} foregroundStyle="label" frame={{ width: iconSize, height: iconSize }} />
    </Button>
  )
}

/**
 * 右下角浮动按钮组（交互与布局对齐 Media Downloader）：
 * - 收起时只显示「+」，展开后显示「读取剪贴板」「手动输入链接」
 * - 任务进行中只显示「停止」按钮
 */
function AddButtonCluster(props: {
  visible: boolean
  loading: boolean
  onToggle: () => void
  onPaste: () => void
  onManual: () => void
  onCancel: () => void
}) {
  if (props.loading) {
    return (
      <VStack
        spacing={10}
        padding={{ trailing: 18, bottom: 72 }}
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottomTrailing" as any }}
      >
        <FloatingIconButton systemImage="xmark.circle.fill" iconSize={36} onPress={props.onCancel} />
      </VStack>
    )
  }

  return (
    <VStack
      spacing={10}
      padding={{ trailing: 18, bottom: 72 }}
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottomTrailing" as any }}
    >
      {props.visible ? (
        <>
          <FloatingIconButton systemImage="doc.on.clipboard" onPress={props.onPaste} />
          <FloatingIconButton systemImage="square.and.pencil" onPress={props.onManual} />
        </>
      ) : null}
      <FloatingIconButton systemImage={props.visible ? "xmark" : "plus"} onPress={props.onToggle} />
    </VStack>
  )
}

function HistoryRow(props: {
  item: HistoryRecord
  onRefresh: () => Promise<void>
  onStatus: (text: string) => void
  onRedownload: (url: string) => void
}) {
  const { item, onRefresh, onStatus, onRedownload } = props

  const openActions = async () => {
    let hasFile = false
    if (item.localFilePath) {
      try { hasFile = await FileManager.exists(item.localFilePath) } catch { hasFile = false }
    }
    const isImagePost = item.mediaKind === "image"
    const actions: { label: string; destructive?: boolean }[] = [
      ...(hasFile ? [{ label: isImagePost ? "预览图片" : "播放视频" }] : []),
      { label: "重新下载" },
      ...(hasFile ? [{ label: "分享文件" }, { label: "保存到相册" }] : []),
      { label: "打开原始页面" },
      { label: "复制原始链接" },
      { label: hasFile ? "删除记录并删除文件" : "删除记录", destructive: true },
    ]

    const result = await Dialog.actionSheet({
      title: item.title || "(无标题)",
      message: `${PLATFORM_NAME[item.platform] || item.platform} · ${formatDate(item.createdAt)} · ${formatBytes(item.bytesWritten)} · ${historyMediaSummary(item)}${item.saveSummary ? `\n${item.saveSummary}` : ""}`,
      actions,
      cancelButton: true,
    })

    if (result == null) return
    const label = actions[result]?.label

    try {
      if (label === "播放视频" || label === "预览图片") {
        if (!item.localFilePath) throw new Error("本地文件不存在")
        await QuickLook.previewURLs([item.localFilePath], true)
        return
      }
      if (label === "重新下载") {
        onRedownload(item.pageURL)
        return
      }
      if (label === "分享文件") {
        if (!item.localFilePath) throw new Error("本地文件不存在")
        await ShareSheet.present([item.localFilePath])
        onStatus("已打开分享面板。")
        return
      }
      if (label === "保存到相册") {
        if (!item.localFilePath) throw new Error("本地文件不存在")
        if (isImagePost) await (Photos.savePhoto as any)(item.localFilePath)
        else await Photos.saveVideo(item.localFilePath)
        onStatus("已保存到相册。")
        return
      }
      if (label === "打开原始页面") {
        await openURL(item.pageURL)
        return
      }
      if (label === "复制原始链接") {
        await Pasteboard.setString(item.pageURL)
        onStatus("已复制原始链接到剪贴板。")
        return
      }
      if (label === "删除记录并删除文件" || label === "删除记录") {
        if (label === "删除记录并删除文件" && item.localFilePath) {
          try { await FileManager.remove(item.localFilePath) } catch {}
        }
        await deleteHistory(item.id)
        await onRefresh()
        onStatus(label === "删除记录并删除文件" ? "已删除记录和本地文件。" : "已删除记录。")
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      onStatus(`操作失败：${message}`)
      await alert({ title: "操作失败", message })
    }
  }

  return (
    <HStack
      key={item.id}
      alignment="top"
      spacing={12}
      onTapGesture={openActions}
      trailingSwipeActions={{
        allowsFullSwipe: false,
        actions: [
          <Button
            title="删除"
            role="destructive"
            action={async () => {
              await deleteHistory(item.id)
              await onRefresh()
              onStatus("已删除历史记录。")
            }}
          />,
        ],
      }}
    >
      <VStack
        frame={{ width: 72, height: 96, alignment: "center" as any }}
        clipShape={{ type: "rect", cornerRadius: 8 }}
        background={{ style: "tertiarySystemFill", shape: { type: "rect", cornerRadius: 8 } }}
      >
        {item.thumbnailUrl ? (
          <Image
            imageUrl={item.thumbnailUrl}
            resizable
            scaleToFill
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            clipShape={{ type: "rect", cornerRadius: 8 }}
            placeholder={<PlatformGlyph platform={item.platform} size={34} />}
          />
        ) : (
          <PlatformGlyph platform={item.platform} size={34} />
        )}
      </VStack>
      <VStack alignment="leading" spacing={5} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
        <Text font="headline" lineLimit={2}>{item.title || "(无标题)"}</Text>
        <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{historyMediaSummary(item)}</Text>
        <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>{item.pageURL}</Text>
        <HStack>
          <Text font="caption2" foregroundStyle="secondaryLabel">{PLATFORM_NAME[item.platform] || item.platform}</Text>
          <Spacer />
          <Text font="caption2" foregroundStyle="secondaryLabel">{formatBytes(item.bytesWritten)}</Text>
          <Text font="caption2" foregroundStyle="secondaryLabel">{formatDate(item.createdAt)}</Text>
        </HStack>
      </VStack>
    </HStack>
  )
}

// ─── 历史记录页 ──────────────────────────────────────

function HistoryPage(props: {
  history: HistoryRecord[]
  onRefresh: () => Promise<void>
  onClear: () => Promise<void>
  onStatus: (text: string) => void
  onRedownload: (url: string) => void
  onOpenSavedFiles: () => void
  dismiss: () => void
}) {
  const { history, onRefresh, onClear, onStatus, onRedownload, onOpenSavedFiles, dismiss } = props

  return (
    <NavigationStack>
      <List
        navigationTitle="历史记录"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={dismiss} />,
          topBarTrailing: (
            <HStack spacing={10}>
              <Button title="" systemImage="folder" action={onOpenSavedFiles} />
              <Button title="刷新" action={() => void onRefresh()} />
            </HStack>
          ),
        }}
      >
        <Section
          header={<Text>{`下载历史 (${history.length})`}</Text>}
          footer={<Text font="caption" foregroundStyle="secondaryLabel">点击记录可打开操作菜单；记录会显示媒体类型、数量和保存结果，左滑可快速删除。</Text>}
        >
          {history.length === 0 ? (
            <Text foregroundStyle="secondaryLabel">还没有下载历史。可以先输入一个链接试试。</Text>
          ) : (
            history.map((item) => (
              <HistoryRow
                key={item.id}
                item={item}
                onRefresh={onRefresh}
                onStatus={onStatus}
                onRedownload={onRedownload}
              />
            ))
          )}
        </Section>

        <Section title="更多操作">
          <Button title="清空历史记录" role="destructive" action={() => void onClear()} />
        </Section>
      </List>
    </NavigationStack>
  )
}

// ─── 下载页 ──────────────────────────────────────────

function ImageSelectionTile(props: {
  item: SelectableMediaItem
  selected: boolean
  disabled: boolean
  onToggle: (id: string) => void
}) {
  const { item, selected, disabled, onToggle } = props
  return (
    <Button action={() => onToggle(item.id)} disabled={disabled}>
      <ZStack frame={{ maxWidth: "infinity", minHeight: 170, alignment: "topTrailing" as any }}>
        <VStack
          spacing={6}
          padding={6}
          frame={{ maxWidth: "infinity", minHeight: 170, alignment: "top" as any }}
          clipShape={{ type: "rect", cornerRadius: 8 }}
          background={{ style: selected ? "systemPink" : "tertiarySystemFill", shape: { type: "rect", cornerRadius: 8 } }}
        >
          <VStack
            frame={{ maxWidth: "infinity", height: 128, alignment: "center" as any }}
            clipShape={{ type: "rect", cornerRadius: 6 }}
            background={{ style: "systemBackground", shape: { type: "rect", cornerRadius: 6 } }}
          >
            {item.thumbnailUrl ? (
              // ⚠️ 必须 resizable + 显式 frame：否则网络图片会按自身像素尺寸铺开（超大且发虚）
              <Image
                imageUrl={item.thumbnailUrl}
                resizable
                scaleToFill
                frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
                clipShape={{ type: "rect", cornerRadius: 6 }}
              />
            ) : (
              <Image systemName="photo.fill" foregroundStyle="secondaryLabel" frame={{ width: 26, height: 26 }} />
            )}
          </VStack>
          <Text font="caption" foregroundStyle={selected ? "white" : "secondaryLabel"} lineLimit={1}>{`图片 ${item.index + 1}`}</Text>
        </VStack>
        <Image
          systemName={selected ? "checkmark.circle.fill" : "circle"}
          foregroundStyle={selected ? "white" : "secondaryLabel"}
          frame={{ width: 24, height: 24 }}
          padding={{ top: 8, trailing: 8 }}
        />
      </ZStack>
    </Button>
  )
}

function MediaSelectionRow(props: {
  item: SelectableMediaItem
  selected: boolean
  disabled: boolean
  onToggle: (id: string) => void
}) {
  const { item, selected, disabled, onToggle } = props
  return (
    <HStack spacing={12} alignment="center">
      <Button
        action={() => onToggle(item.id)}
        disabled={disabled}
        frame={{ width: 34, height: 34 }}
      >
        <Image
          systemName={selected ? "checkmark.circle.fill" : "circle"}
          foregroundStyle={selected ? "systemPink" : "secondaryLabel"}
          frame={{ width: 24, height: 24 }}
        />
      </Button>
      <VStack
        frame={{ width: 88, height: 88, alignment: "center" as any }}
        clipShape={{ type: "rect", cornerRadius: 8 }}
        background={{ style: "tertiarySystemFill", shape: { type: "rect", cornerRadius: 8 } }}
      >
        {item.thumbnailUrl ? (
          // ⚠️ 同样必须 resizable，否则缩略图会被放大成一整块糊图
          <Image
            imageUrl={item.thumbnailUrl}
            resizable
            scaleToFill
            frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
            clipShape={{ type: "rect", cornerRadius: 8 }}
          />
        ) : (
          <Image systemName={item.kind === "video" ? "play.rectangle.fill" : "photo.fill"} foregroundStyle="secondaryLabel" />
        )}
      </VStack>
      <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
        <Text font="subheadline" fontWeight="medium" lineLimit={2}>{item.title}</Text>
        <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{item.kind === "video" ? "视频" : `图片 ${item.index + 1}`}</Text>
      </VStack>
    </HStack>
  )
}

function DownloadPage(props: {
  inputURL: string
  parsedResult: MediaResult | null
  mediaItems: SelectableMediaItem[]
  selectedMediaIds: string[]
  loading: boolean
  downloadLogs: string[]
  downloadProgress: { fraction: number; stage: string }
  status: string
  logProxyRef: any
  onToggleMedia: (id: string) => void
  onSelectAll: () => void
  onClearSelection: () => void
  onDownloadSelected: () => void
  onStopTask: () => void
  onCopyStatus: () => void
  onCopyLogs: () => void
  onRetry: () => void
  dismiss: () => void
}) {
  const {
    inputURL, parsedResult, mediaItems, selectedMediaIds, loading,
    downloadLogs, downloadProgress, status, logProxyRef,
    onToggleMedia, onSelectAll, onClearSelection, onDownloadSelected, onStopTask,
    onCopyStatus, onCopyLogs, onRetry, dismiss,
  } = props
  const selectedCount = selectedMediaIds.length
  const videoItems = mediaItems.filter((item) => item.kind === "video")
  const imageItems = mediaItems.filter((item) => item.kind === "image")

  return (
    <NavigationStack>
      <List
        navigationTitle="下载"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={dismiss} />,
        }}
      >
        <Section
          header={<Text>当前链接</Text>}
          footer={<Text font="caption" foregroundStyle="secondaryLabel">点按链接可重新解析。也可以点右下角「+」展开按钮读取剪贴板或手动输入。 </Text>}
        >
          {inputURL ? (
            <Text lineLimit={3} onTapGesture={loading ? undefined : onRetry}>{inputURL}</Text>
          ) : (
            <Text foregroundStyle="secondaryLabel">点右下角「+」读取剪贴板链接，或手动输入链接后解析。</Text>
          )}
        </Section>

        <Section header={<Text>解析结果</Text>}>
          {parsedResult ? (
            <VStack alignment="leading" spacing={6}>
              <HStack spacing={8}>
                <PlatformGlyph platform={parsedResult.platform || "unknown"} />
                <VStack alignment="leading" spacing={2}>
                  <Text font="headline" lineLimit={2}>{parsedResult.title || "(无标题)"}</Text>
                  <Text font="caption" foregroundStyle="secondaryLabel">
                    {(PLATFORM_NAME[parsedResult.platform || ""] || parsedResult.platform || "未知平台")}
                    {parsedResult.author ? ` · ${parsedResult.author}` : ""}
                  </Text>
                </VStack>
              </HStack>
            </VStack>
          ) : (
            <Text foregroundStyle="secondaryLabel">解析成功后会在这里显示可下载内容。</Text>
          )}
        </Section>

        {mediaItems.length > 0 ? (
          <Section
            header={<Text>{`选择下载内容 (${selectedCount}/${mediaItems.length})`}</Text>}
            footer={<Text font="caption" foregroundStyle="secondaryLabel">先勾选需要保存的视频或图片，再点击下载已选内容。</Text>}
          >
            <HStack>
              <Button title="全选" disabled={loading || selectedCount === mediaItems.length} action={onSelectAll} />
              <Spacer />
              <Button title="清空" disabled={loading || selectedCount === 0} action={onClearSelection} />
            </HStack>
            {videoItems.length > 0 ? (
              <VStack spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                {videoItems.map((item) => (
                  <MediaSelectionRow
                    key={item.id}
                    item={item}
                    selected={selectedMediaIds.includes(item.id)}
                    disabled={loading}
                    onToggle={onToggleMedia}
                  />
                ))}
              </VStack>
            ) : null}
            {imageItems.length > 0 ? (
              <ScrollView frame={{ maxWidth: "infinity", height: imageItems.length > 2 ? 388 : 190 }}>
                <LazyVGrid
                  columns={[{ size: { type: "flexible", min: 130, max: "infinity" } }, { size: { type: "flexible", min: 130, max: "infinity" } }]}
                  spacing={10}
                >
                  {imageItems.map((item) => (
                    <ImageSelectionTile
                      key={item.id}
                      item={item}
                      selected={selectedMediaIds.includes(item.id)}
                      disabled={loading}
                      onToggle={onToggleMedia}
                    />
                  ))}
                </LazyVGrid>
              </ScrollView>
            ) : null}
            <Button
              title={loading ? "处理中…" : `下载已选内容 (${selectedCount})`}
              disabled={loading || selectedCount === 0}
              action={onDownloadSelected}
            />
          </Section>
        ) : null}

        <Section header={<Text>状态</Text>} footer={<Text font="caption" foregroundStyle="secondaryLabel">点按状态可复制当前进度文本。</Text>}>
          {loading ? (
            <VStack alignment="leading" spacing={8} onTapGesture={onCopyStatus}>
              <ProgressView value={downloadProgress.fraction} total={1} />
              <HStack spacing={10} alignment="center">
                <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                  <Text>{downloadProgress.stage}</Text>
                  <Text font="caption" foregroundStyle="secondaryLabel">{loading ? "当前任务运行中，可随时停止。" : status}</Text>
                </VStack>
                <Button role="destructive" action={onStopTask} frame={{ width: 38, height: 34 }}>
                  <Image systemName="stop.fill" foregroundStyle="systemRed" frame={{ width: 16, height: 16 }} />
                </Button>
              </HStack>
            </VStack>
          ) : (
            <Text foregroundStyle="secondaryLabel" onTapGesture={onCopyStatus}>{status}</Text>
          )}
        </Section>

        <Section
          header={<Text>日志</Text>}
          footer={<Text font="caption" foregroundStyle="secondaryLabel">点按日志可复制全部内容。</Text>}
        >
          <ScrollViewReader>
            {(proxy: any) => {
              logProxyRef.current = proxy
              return (
                <ScrollView frame={{ maxWidth: "infinity", height: 220 }} onTapGesture={onCopyLogs}>
                  <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
                    {downloadLogs.length === 0 ? (
                      <Text foregroundStyle="secondaryLabel">暂无日志。</Text>
                    ) : (
                      downloadLogs.map((log, index) => (
                        <Text key={`${index}-${log}`} font="caption" foregroundStyle="secondaryLabel">{log}</Text>
                      ))
                    )}
                    <Rectangle
                      key="downloadLogBottom"
                      foregroundStyle="clear"
                      frame={{ maxWidth: "infinity", height: 1 }}
                    />
                  </VStack>
                </ScrollView>
              )
            }}
          </ScrollViewReader>
        </Section>
      </List>
    </NavigationStack>
  )
}

// ─── 设置页 ──────────────────────────────────────────

const COOKIE_PLATFORM_KEYS: [string, string][] = [
  ["douyin", "抖音"],
  ["xiaohongshu", "小红书"],
  ["bilibili", "Bilibili"],
  ["kuaishou", "快手"],
  ["wxchannels", "微信视频号"],
  ["wechat", "微信公众号"],
  ["youtube", "YouTube"],
  ["instagram", "Instagram"],
  ["twitter", "Twitter/X"],
]

/** 未配置 Cookie 时的提示（Instagram 现在基本必须登录，不能再说「不影响」） */
const COOKIE_EMPTY_HINT: Record<string, string> = {
  instagram: "未配置 · 公开帖子免登录可用，填 Cookie 可提升受限帖成功率",
  wxchannels: "必填 · 视频号需要腾讯元宝（yuanbao.tencent.com）登录后的 Cookie",
  kuaishou: "可选 · 命中风控（解析失败）时填上可提高成功率",
  wechat: "可选 · 文章页免登录，一般不用填",
  youtube: "可选 · 仅年龄限制视频需要",
}

function cookieEmptyHint(platform: string): string {
  return COOKIE_EMPTY_HINT[platform] || "未配置 · 不影响基础解析"
}

function SettingsIcon(props: {
  systemName: string
  tint: string
}) {
  return (
    <VStack
      frame={{ width: 34, height: 34, alignment: "center" as any }}
      clipShape={{ type: "rect", cornerRadius: 7 }}
      background={{ style: props.tint as any, shape: { type: "rect", cornerRadius: 7 } }}
    >
      <Image systemName={props.systemName} foregroundStyle="white" frame={{ width: 18, height: 18 }} />
    </VStack>
  )
}

function SettingsInfoRow(props: {
  icon: string
  tint: string
  title: string
  subtitle: string
  value?: string
  onPress?: () => void
}) {
  const content = (
    <HStack spacing={12} alignment="center">
      <SettingsIcon systemName={props.icon} tint={props.tint} />
      <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
        <Text font="subheadline" fontWeight="medium">{props.title}</Text>
        <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>{props.subtitle}</Text>
      </VStack>
      {props.value ? <Text font="caption" foregroundStyle="secondaryLabel">{props.value}</Text> : null}
      {props.onPress ? <Image systemName="chevron.right" foregroundStyle="tertiaryLabel" frame={{ width: 12, height: 12 }} /> : null}
    </HStack>
  )
  if (!props.onPress) return content
  return <Button action={props.onPress}>{content}</Button>
}

async function testPlatformCookie(platform: string, cookieValue: string): Promise<string> {
  const trimmed = cookieValue.trim()
  if (!trimmed) return "未配置 Cookie。"
  if (platform === "xiaohongshu") {
    const missing: string[] = []
    if (!/(^|;\s*)web_session=/i.test(trimmed)) missing.push("web_session")
    if (!/(^|;\s*)a1=/i.test(trimmed)) missing.push("a1")
    try {
      const resp = await fetch("https://www.xiaohongshu.com/explore", {
        timeout: 10,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Cookie": trimmed,
        },
      } as any)
      const html = await resp.text().catch(() => "")
      const notes: string[] = []
      notes.push(`HTTP ${resp.status}`)
      if (missing.length) notes.push(`缺少关键字段：${missing.join(", ")}`)
      if (/登录|login|captcha|安全验证|sec_/i.test(html)) notes.push("页面疑似要求登录或安全验证")
      if (!missing.length && resp.ok && !/登录|login|captcha|安全验证|sec_/i.test(html)) notes.push("Cookie 状态看起来可用")
      return notes.join("\n")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return `检测失败：${message}`
    }
  }
  if (platform === "wxchannels") {
    // 视频号靠腾讯元宝的公开接口解析：直接拿这个接口试一把，最准
    try {
      const resp = await fetch("https://yuanbao.tencent.com/api/weixin/get_parse_result", {
        method: "POST",
        timeout: 15,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
          Origin: "https://yuanbao.tencent.com",
          Referer: "https://yuanbao.tencent.com/",
          Cookie: trimmed,
        },
        body: JSON.stringify({ type: "video_channel_url", url: "https://weixin.qq.com/sph/AP07qUn2N0", scene: 1 }),
      } as any)
      if (resp.status === 401) return "HTTP 401 · Cookie 无效或未登录腾讯元宝（请先在 yuanbao.tencent.com 登录）"
      const json: any = await resp.json().catch(() => null)
      const code = json?.error ? String(json.error.code ?? "") : String(json?.code ?? "")
      if (json?.error) {
        if (code === "20000") return "接口返回 20000 · Cookie 无效或已过期（需重新登录元宝）"
        return `接口返回错误：${json.error.message || code}`
      }
      if (json?.code === 0 || json?.data) return "Cookie 可用（元宝解析接口返回正常）"
      return `HTTP ${resp.status} · 返回内容异常：${JSON.stringify(json).slice(0, 80)}`
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return `检测失败：${message}`
    }
  }
  if (platform === "kuaishou") {
    const notes = [`已配置 ${trimmed.length} 字符`]
    if (!/(^|;\s*)did=/i.test(trimmed)) notes.push("提示：快手风控主要靠 did 等字段，未包含 did 可能无效")
    return notes.join("\n")
  }
  if (platform === "wechat") {
    return `已配置 ${trimmed.length} 字符。公众号文章页免登录，一般不需要填 Cookie。`
  }
  if (platform === "youtube") {
    return `已配置 ${trimmed.length} 字符。YouTube 仅在年龄限制视频时需要 Cookie。`
  }
  return `已配置 ${trimmed.length} 字符。该平台暂未提供在线检测，只做格式保存。`
}

/**
 * 平台 Cookie 行（无图标版）：
 * 左侧细色条 = 平台主色（已配置时亮起，未配置为淡色），下方状态点 + 文案，右侧文字入口。
 * 整行点按弹出管理菜单（填写 / 检测 / 清除）。
 */
function CookieSettingsRow(props: {
  platform: string
  name: string
  hasCookie: boolean
  cookieLen: number
  emptyHint: string
  onManage: () => void
}) {
  const accent = props.hasCookie ? platformAccent(props.platform) : 'quaternaryLabel'
  return (
    <Button action={props.onManage}>
      <HStack spacing={12} alignment="center">
        <Rectangle
          foregroundStyle={accent as any}
          frame={{ width: 4, height: 40 }}
          clipShape={{ type: "capsule", style: "continuous" }}
        />
        <VStack alignment="leading" spacing={5} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          <Text
            font="subheadline"
            fontWeight="semibold"
            foregroundStyle={(props.hasCookie ? platformAccent(props.platform) : "label") as any}
          >
            {props.name}
          </Text>
          <HStack spacing={6} alignment="center">
            <Rectangle
              foregroundStyle={(props.hasCookie ? "systemGreen" : "tertiaryLabel") as any}
              frame={{ width: 7, height: 7 }}
              clipShape={{ type: "capsule", style: "continuous" }}
            />
            <Text font="caption" foregroundStyle={props.hasCookie ? "systemGreen" : "secondaryLabel"}>
              {props.hasCookie ? `已配置 · ${props.cookieLen} 字符` : props.emptyHint}
            </Text>
          </HStack>
        </VStack>
        <Text
          font="caption"
          fontWeight="medium"
          foregroundStyle={(props.hasCookie ? platformAccent(props.platform) : "secondaryLabel") as any}
        >
          {props.hasCookie ? "管理" : "填写"}
        </Text>
      </HStack>
    </Button>
  )
}

/** 支持的平台（无图标版）：等宽胶囊标签，用平台主色写字 */
function SupportedPlatformsGrid() {
  const entries = Object.entries(PLATFORM_NAME)
  return (
    <LazyVGrid
      columns={[
        { size: { type: "flexible", min: 86, max: "infinity" } },
        { size: { type: "flexible", min: 86, max: "infinity" } },
        { size: { type: "flexible", min: 86, max: "infinity" } },
      ]}
      spacing={8}
      frame={{ maxWidth: "infinity" }}
    >
      {entries.map(([key, name]) => (
        <Text
          key={key}
          font="caption"
          fontWeight="medium"
          foregroundStyle={platformAccent(key) as any}
          frame={{ maxWidth: "infinity", alignment: "center" as any }}
          padding={{ top: 8, bottom: 8 }}
          background={{ style: "tertiarySystemFill", shape: { type: "capsule", style: "continuous" } }}
        >
          {name}
        </Text>
      ))}
    </LazyVGrid>
  )
}

function SettingsPage(props: {
  saveMode: "ask" | "photos"
  onSaveModeChange: (mode: "ask" | "photos") => void
  cookies: CookieConfig
  onCookiesChange: (config: CookieConfig) => void
  onShowReleaseNotes: () => void
  dismiss: () => void
}) {
  const { saveMode, onSaveModeChange, cookies, onCookiesChange, onShowReleaseNotes, dismiss } = props

  const chooseSaveMode = async () => {
    const result = await Dialog.actionSheet({
      title: "默认保存方式",
      message: "下载成功后默认如何处理文件？",
      actions: [
        { label: "每次询问" },
        { label: "自动保存到相册" },
      ],
      cancelButton: true,
    })
    if (result == null) return
    onSaveModeChange(result === 1 ? "photos" : "ask")
  }


  const editCookie = async (platform: string) => {
    const current = (cookies as any)[platform] || ""
    const platformName = PLATFORM_NAME[platform] || platform
    // 使用 Promise + 多行编辑器页面
    const result = await new Promise<string | null>((resolve) => {
      let resolveFn: (v: string | null) => void
      const CookieEditPage = () => {
        const [text, setText] = useState(current)
        const pageDismiss = Navigation.useDismiss()
        // 保存 resolve 函数到外部
        if (!resolveFn) {
          resolveFn = (v: string | null) => {
            pageDismiss()
            resolve(v)
          }
        }
        return (
          <NavigationStack>
            <List
              navigationTitle={`${platformName} Cookie`}
              navigationBarTitleDisplayMode="inline"
              toolbar={{
                cancellationAction: <Button title="取消" action={() => resolveFn(null)} />,
                topBarTrailing: <Button
                  title="保存"
                  action={() => resolveFn(text.trim())}
                />,
              }}
            >
              <Section
                header={<Text>Cookie 字符串</Text>}
                footer={<Text font="caption" foregroundStyle="secondaryLabel">从浏览器开发者工具复制 Cookie 字符串（格式：name1=value1; name2=value2），支持长文本。</Text>}
              >
                <TextField
                  label={<Text>Cookie</Text>}
                  value={text}
                  onChanged={(v: string) => setText(v)}
                  prompt="粘贴 Cookie 字符串..."
                  axis="vertical"
                />
                <Text font="caption" foregroundStyle="secondaryLabel">长度：{text.trim().length} 字符</Text>
              </Section>
            </List>
          </NavigationStack>
        )
      }
      Navigation.present(<CookieEditPage />)
    })
    if (result == null) return  // 取消
    const updated = { ...cookies }
    ;(updated as any)[platform] = result
    onCookiesChange(updated)
    await saveCookies(updated)
  }

  const testCookie = async (platform: string) => {
    const platformName = PLATFORM_NAME[platform] || platform
    const cookieValue = (cookies as any)[platform] || ""
    const message = await testPlatformCookie(platform, cookieValue)
    await alert({ title: `${platformName} Cookie 检测`, message })
  }

  const clearCookie = async (platform: string) => {
    const updated = { ...cookies }
    ;(updated as any)[platform] = ""
    onCookiesChange(updated)
    await saveCookies(updated)
  }

  /** 点按平台行 → 管理菜单（因此不再需要图标按钮） */
  const manageCookie = async (platform: string) => {
    const platformName = PLATFORM_NAME[platform] || platform
    const hasCookie = !!((cookies as any)[platform] || "").trim()
    const actions: { label: string; destructive?: boolean }[] = [
      { label: hasCookie ? "修改 Cookie" : "填写 Cookie" },
    ]
    if (hasCookie) {
      actions.push({ label: "检测 Cookie 可用性" }, { label: "清除 Cookie", destructive: true })
    }

    const result = await Dialog.actionSheet({
      title: `${platformName} Cookie`,
      message: hasCookie
        ? "已配置 Cookie。解析失败或画质偏低时可重新检测一次。"
        : "未配置也能解析，填上 Cookie 后成功率与画质更稳（小红书 / Instagram 尤其明显）。",
      actions,
      cancelButton: true,
    })
    if (result == null) return

    const label = actions[result]?.label
    if (label === "填写 Cookie" || label === "修改 Cookie") {
      await sleep(250)
      await editCookie(platform)
    } else if (label === "检测 Cookie 可用性") {
      await testCookie(platform)
    } else if (label === "清除 Cookie") {
      await clearCookie(platform)
    }
  }

  const configuredCount = COOKIE_PLATFORM_KEYS.filter(([key]) => !!((cookies as any)[key] || "").trim()).length

  return (
    <NavigationStack>
      <List
        navigationTitle="设置"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={dismiss} />,
        }}
      >
        <Section header={<Text>下载</Text>}>
          <SettingsInfoRow
            icon="square.and.arrow.down"
            tint="systemBlue"
            title="默认保存方式"
            subtitle={saveMode === "ask" ? "下载完成后弹出操作菜单" : "下载完成后直接保存到系统相册"}
            value={saveMode === "ask" ? "每次询问" : "相册"}
            onPress={() => void chooseSaveMode()}
          />
        </Section>

        <Section
          header={<Text>{`平台 Cookie · 已配置 ${configuredCount}/${COOKIE_PLATFORM_KEYS.length}`}</Text>}
          footer={<Text font="caption" foregroundStyle="secondaryLabel">Cookie 只用于提升解析成功率和画质，未配置时仍会使用基础解析。点按平台即可填写、检测或清除。</Text>}
        >
          {COOKIE_PLATFORM_KEYS.map(([key, name]) => {
            const value = ((cookies as any)[key] || "").trim()
            return (
              <CookieSettingsRow
                key={key}
                platform={key}
                name={name}
                hasCookie={!!value}
                cookieLen={value.length}
                emptyHint={cookieEmptyHint(key)}
                onManage={() => { void manageCookie(key) }}
              />
            )
          })}
        </Section>

        <Section
          header={<Text>{`支持的平台 · ${Object.keys(PLATFORM_NAME).length}`}</Text>}
          footer={<Text font="caption" foregroundStyle="secondaryLabel">自动识别分享链接所属平台，解析后可自选要保存的视频与图片。</Text>}
        >
          <SupportedPlatformsGrid />
        </Section>

        <Section header={<Text>关于</Text>}>
          <SettingsInfoRow
            icon="info.circle"
            tint="systemPurple"
            title="视频解析下载"
            subtitle="抖音解析/下载已改走移动端免签通道，无水印、最高画质"
            value={`v${SCRIPT_VERSION}`}
          />
          <SettingsInfoRow
            icon="wand.and.stars"
            tint="systemPink"
            title="更新说明"
            subtitle="查看本次版本的改动内容"
            onPress={onShowReleaseNotes}
          />
        </Section>
      </List>
    </NavigationStack>
  )
}

// ─── 版本与更新说明 ──────────────────────────────

const SCRIPT_VERSION = "1.2.0"
const SAVE_MODE_KEY = "video-parser:save-mode"
const RELEASE_NOTES_SEEN_KEY = "video-parser:release-notes:seen-version"

const RELEASE_NOTES: string[] = [
  "新增 4 个平台：**YouTube / 快手 / 微信视频号 / 微信公众号**（主界面与分享面板都支持）。",
  "**YouTube**：用 youtubei player 的 **ANDROID_VR 客户端**拿直链（实测 WEB/MWEB 只给 signatureCipher、IOS 与 ANDROID 手机端直接 400）；1080p 以上是自适应流（音视频分离）→ 自动下载两条轨并 **ffmpeg 无损合轨**。",
  "**快手**：解析作品页 HTML 里的 Apollo 缓存（`window.__APOLLO_STATE__` → `videoResource.h264` / `manifestH265`），**优先 H.264**；命中风控会自动换路由与 UA 重试。",
  "**微信公众号**：文章页免登录；正文图片是**懒加载**的 `data-src`（`src` 只是占位图）→ 这才是原图；正文里的视频号/微信视频直链也一并提取。",
  "**微信视频号**：⚠️ **必须**在设置里填「腾讯元宝（yuanbao.tencent.com）登录后的 Cookie」；没填会明确提示，设置里可一键检测 Cookie 是否有效。",
  "修复小红书短链识别：新增 **`xhslink.cn`**（以前只认 `xhslink.com`，所以 `xhslink.cn/o/xxx` 会报「未识别到支持的平台链接」）；顺带支持 `xhs.link`。",
  "真机验证：`https://xhslink.cn/o/NKnTBeUcLT` → 跳转到带 xsec_token 的笔记页 → SSR 拿到 4 张原图（标题/作者均正确）。",
  "修复小红书：改走**免签名 API 的笔记页 SSR**（`__INITIAL_STATE__.note.noteDetailMap`）—— 原来那套「签名 API + WebView 抓 DOM」已不可用（feed 接口被单独风控，实测 `code=300011 当前账号存在异常`）。",
  "小红书现在必须带 `xsec_token`（分享链接自带）；缺了会直接提示「请从 App 分享→复制链接拿完整链接」，不再默默失败。",
  "小红书视频选档改为**实测编码**：`stream` 家族名已从 h264/h265/av1 改成 `EF4/EF5/…`，字段分辨不出编码，于是用设备自带 ffprobe 实测每个候选，挑 iOS 能解码（H.264/HEVC）的最高分辨率档（实测选中 EF5 = 1080x1920 HEVC）。",
  "图文帖用 trace id 重建**原图**地址（`sns-img-hw.xhscdn.com/{trace}`），预览另用小图；小红书 CDN 也不再带 Referer（防 403）。",
  "顺带把小红书逻辑收进独立模块 `xiaohongshu.ts`（index.tsx 删掉 ~1200 行旧 WebView 兜底代码），分享面板同步走新通道。",
  "修复 B 站视频「没声音」：B 站高画质是 **DASH 音视频分离**（video.m4s + audio.m4s），旧版只下视频轨。现在优先用 progressive 单文件（自带声音；登录即 1080P），DASH 画质更高时下载双轨并用 **ffmpeg `-c copy` 无损合轨**（实测 0.4 秒）。",
  "新增分块下载器：B 站 CDN 里混着 PCDN 节点（`*.mountaintoys.cn:4483` / `*.mcdn.bilivideo.cn:8082`），长连接会中途卡死 —— 实测单次 fetch 下 3 分半的视频卡了 7 分钟没完，改 4MB 分块后 20MB/8 秒下完。",
  "B 站选轨现在看**编码**：videos 里 avc1(H.264) > hev1/hvc1(HEVC) > av01(AV1，iOS 不能解码)，音频优先普通 AAC。",
  "Instagram 画质升级（借鉴你那份 QX 脚本的实战结论）：视频从 `video_versions` 里挑 `type=101`（progressive）且**排除 DASH 分片**（`dashinit`/`bytestart`/`byteend`）的最大宽度档；图片不再用只有 640px 的 `display_url`，而是从 `image_versions2.candidates` 里挑面积最大的原图，网格预览另走中等尺寸。",
  "Instagram 受限内容补救：新增 web GraphQL 通道（与 QX 脚本/ParseHub 同一套配方：同一 cookie jar 取 csrftoken + `X-IG-App-ID` + `x-csrftoken`）；并识别 `xdt_shortcode_media=null` / `utm_campaign=invalid` 这类受限标记，给出「需要登录/年龄验证」的明确提示。",
  "Instagram 兼容性：支持 `XDTGraph*` 前缀类型名（XDTGraphVideo/Sidecar）与双层 stringify 的 `contextJSON`，caption 为纯字符串也能读。",
  "修复 Instagram：改用**免登录的内嵌页通道**（`/p/{短码}/embed/captioned/` 里的 `contextJSON`），并支持图片帖与相册帖。",
  "旧版 IG 的真因：写死的 GraphQL doc_id 已失效，于是掉到 WebView 里抓“页面上的第一个 video” —— 不是这个链接的视频；而且你这个链接本身就是**图片帖**（GraphImage），旧版只会找视频，于是随手抓了别人的视频。",
  "现在每次命中都会**核对短码**（内嵌页、私有 API、帖子页三个通道都一样），宁可报错也绝不下错内容。",
  "Instagram 加入设置页可配置 Cookie（公开帖子其实免登录就能解析，Cookie 只用于受限/私密帖）。",
  "修复预览图「超大、发虚」：图片选择网格与视频行里的网络图少了 resizable —— 于是它按自身像素尺寸铺开，屏幕里只截到中间一小块并被放大（所以又大又糊）。现改为 resizable + scaleToFill + 圆角裁剪，缩略图填满卡片且清晰。",
  "修复短链解析失败的根因：旧代码里 v.douyin.com 的判断正则被多转义了一层，导致分享短链永远匹配不上、拿不到作品 ID，于是绕开移动端通道去跑网页兜底，37 秒后才报「无法从抖音页面提取视频」。现已修正。",
  "抖音逻辑收拢到独立模块 `douyin.ts`（index.tsx 与 intent.tsx 共用），自带短链展开、双主机重试与逐步诊断；日志里现在能看到「短链展开 / 详情状态 / 无水印候选数」。",
  "解析失败时不再只报一句没用的提示，而是写出真因（如被平台过滤 filter_reason、主机 HTTP 状态、无作品 ID）。",
  "设置页改版：平台 Cookie 与「支持的平台」全部去掉图标 —— Cookie 改用平台主色细色条 + 状态点，点按平台弹出「填写 / 检测 / 清除」菜单。",
  "「支持的平台」改成等宽胶囊标签，用各平台主色写字（抖音粉 / 小红书红 / Instagram 紫 / Bilibili 青 / Twitter 蓝），一眼区分。",
  "抖音解析/下载改走移动端免签通道（参考「镜花水月」）：网页接口被风控拦死后，移动端接口免签名、免 Cookie、免 uifid 就能直接拿无水印 CDN 直链。",
  "去水印更彻底：playwm 自动转 play，并按短边（竖屏横屏通用）挑最高画质，直接命中 1440p / 1080p 标准编码档。",
  "自动避开抖音自研编码（fourcc=bvc2）档位 —— 那是 iOS 既不能播也不能存相册的坑；需要那个分辨率时改用 play 接口 ratio 拿标准编码版本。",
  "界面交互与布局对齐「Media Downloader」：右下角浮动按钮组（读取剪贴板 / 手动输入 / 停止）、Toast 提示、点按状态或日志即可复制。",
  "历史记录支持封面缩略图、文件大小、预览播放、重新下载、删除文件，并新增「已保存文件」浏览器。",
  "底部 Tab 去掉文字，只保留图标。",
]

/** 首次使用或版本变化时弹出底部更新说明（带拖拽条的半高 Sheet） */
function useReleaseNotesSheet() {
  const [presented, setPresented] = useState(false)

  useEffect(() => {
    let seen: string | null = null
    try { seen = Storage.get<string>(RELEASE_NOTES_SEEN_KEY) } catch {}
    if (seen !== SCRIPT_VERSION) setPresented(true)
  }, [])

  const onChanged = (next: boolean) => {
    if (!next) {
      try { Storage.set(RELEASE_NOTES_SEEN_KEY, SCRIPT_VERSION) } catch {}
    }
    setPresented(next)
  }

  return {
    isPresented: presented,
    onChanged,
    content: <ReleaseNotesSheet onClose={() => onChanged(false)} />,
  }
}

function ReleaseNotesSheet(props: { onClose: () => void }) {
  return (
    <VStack
      spacing={16}
      padding={{ top: 22, leading: 20, bottom: 24, trailing: 20 }}
      presentationDetents={[380]}
      presentationDragIndicator="visible"
      frame={{ maxWidth: "infinity", alignment: "top" as any }}
    >
      <VStack spacing={6} alignment="center" frame={{ maxWidth: "infinity", alignment: "center" as any }}>
        <Image systemName="wand.and.stars" foregroundStyle="systemPink" frame={{ width: 30, height: 30 }} />
        <Text font="title3" bold>更新说明 · v{SCRIPT_VERSION}</Text>
      </VStack>
      <ScrollView frame={{ maxWidth: "infinity", maxHeight: 220 }}>
        <VStack alignment="leading" spacing={10} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
          {RELEASE_NOTES.map((line, index) => (
            <HStack key={`note-${index}`} spacing={8} alignment="top">
              <Text font="caption" foregroundStyle="systemPink">●</Text>
              <Text font="subheadline" lineSpacing={4} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>{line}</Text>
            </HStack>
          ))}
        </VStack>
      </ScrollView>
      <Button title="知道了" buttonStyle="borderedProminent" tint="systemPink" action={props.onClose} frame={{ maxWidth: "infinity" }} />
    </VStack>
  )
}

// ─── 主 View ─────────────────────────────────────────

const HISTORY_TAB = 0
const DOWNLOAD_TAB = 1
const SETTINGS_TAB = 2

type ContentTab = typeof HISTORY_TAB | typeof DOWNLOAD_TAB | typeof SETTINGS_TAB

function View() {
  const dismiss = Navigation.useDismiss()
  const activeTab = useObservable<ContentTab>(DOWNLOAD_TAB)
  const activeTaskRef = useRef(0)
  const logProxyRef = useRef<any>()
  const [inputURL, setInputURL] = useState("")
  const [parsedResult, setParsedResult] = useState<MediaResult | null>(null)
  const [mediaItems, setMediaItems] = useState<SelectableMediaItem[]>([])
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState("准备就绪。粘贴链接后会先解析，再选择下载内容。")
  const [downloadProgress, setDownloadProgress] = useState<{ fraction: number; stage: string }>({
    fraction: 0,
    stage: "未开始",
  })
  const [downloadLogs, setDownloadLogs] = useState<string[]>([])
  const [history, setHistory] = useState<HistoryRecord[]>([])
  const [saveMode, setSaveModeState] = useState<"ask" | "photos">("ask")
  const [cookies, setCookies] = useState<CookieConfig>({
    xiaohongshu: "", douyin: "", twitter: "", instagram: "",
    bilibili: "", youtube: "", kuaishou: "", wechat: "", wxchannels: ""
  })
  const [showAddActions, setShowAddActions] = useState(false)
  const [toastMessage, setToastMessage] = useState("")
  const [toastPresented, setToastPresented] = useState(false)
  const releaseNotes = useReleaseNotesSheet()

  const showToast = (message: string) => {
    setToastMessage(message)
    setToastPresented(false)
    setTimeout(() => setToastPresented(true), 40)
  }

  const copyText = async (text: string, message: string) => {
    await Pasteboard.setString(text)
    showToast(message)
  }

  const setSaveMode = (mode: "ask" | "photos") => {
    setSaveModeState(mode)
    try { Storage.set(SAVE_MODE_KEY, mode) } catch {}
  }

  const refreshHistory = async () => {
    const list = await loadHistory()
    setHistory(list)
  }

  const appendLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    setDownloadLogs((current) => [...current, `[${timestamp}] ${message}`].slice(-60))
  }

  useEffect(() => {
    const scrollLatest = () => {
      try {
        logProxyRef.current?.scrollTo?.("downloadLogBottom", "bottom")
      } catch {}
    }
    scrollLatest()
    const timer = setTimeout(scrollLatest, 120)
    return () => clearTimeout(timer)
  }, [downloadLogs.length])

  useEffect(() => {
    loadHistory()
      .then(setHistory)
      .catch(() => {})
    loadCookies()
      .then(setCookies)
      .catch(() => {})
    try {
      if (Storage.get<string>(SAVE_MODE_KEY) === "photos") setSaveModeState("photos")
    } catch {}
  }, [])

  const downloadFromClipboard = async () => {
    setShowAddActions(false)
    const clipboardText = await getClipboardText()
    if (!clipboardText) {
      setStatus("剪贴板中没有文本内容。")
      activeTab.setValue(DOWNLOAD_TAB)
      return
    }
    const nextInput = clipboardText
    setInputURL(nextInput)
    activeTab.setValue(DOWNLOAD_TAB)
    await parseFromInput(nextInput)
  }

  const stopCurrentTask = () => {
    activeTaskRef.current += 1
    setLoading(false)
    setShowAddActions(false)
    setDownloadProgress({ fraction: 0, stage: "已停止" })
    setStatus("已停止当前任务。")
    appendLog("任务已停止。")
    showToast("已停止当前任务")
  }

  const toggleAddActions = () => {
    setShowAddActions((current) => !current)
  }

  /** 手动输入链接（对齐 Media Downloader 的「手动输入」入口） */
  const openManualAddDialog = async () => {
    setShowAddActions(false)
    const text = await Dialog.prompt({
      title: "手动输入链接",
      message: "支持抖音 / Twitter(X) / 小红书 / Instagram / Bilibili / 微博 等分享链接或分享文案。",
      placeholder: "粘贴或输入链接…",
      cancelLabel: "取消",
      confirmLabel: "开始解析",
      selectAll: true,
    })
    if (text == null) return
    const nextInput = text.trim()
    if (!nextInput) {
      setStatus("没有输入内容。")
      activeTab.setValue(DOWNLOAD_TAB)
      return
    }
    setInputURL(nextInput)
    activeTab.setValue(DOWNLOAD_TAB)
    await parseFromInput(nextInput)
  }

  const copyDownloadLogs = async () => {
    const logs = downloadLogs
    await copyText(logs.length ? logs.join("\n") : "暂无日志。", "已复制日志到剪贴板。")
  }

  const copyDownloadStatus = async () => {
    const text = loading ? `${downloadProgress.stage}（${Math.round(downloadProgress.fraction * 100)}%）` : (status || "准备就绪。")
    await copyText(text, "已复制状态到剪贴板。")
  }

  const openSavedFiles = async () => {
    await Navigation.present({
      element: (
        <NavigationStack>
          <DirectoryBrowserView title="已保存文件" directoryPath={FileManager.documentsDirectory} />
        </NavigationStack>
      ),
    })
  }

  const redownloadFromHistory = (url: string) => {
    setInputURL(url)
    activeTab.setValue(DOWNLOAD_TAB)
    void parseFromInput(url)
  }

  const parseFromInput = async (overrideInput?: string) => {
    const rawInput = (overrideInput ?? inputURL).trim()
    const url = extractFirstURL(rawInput) || rawInput
    if (!url) {
      setStatus("请先输入分享链接。")
      return
    }

    const taskId = activeTaskRef.current + 1
    activeTaskRef.current = taskId
    const isCurrentTask = () => activeTaskRef.current === taskId

    setLoading(true)
    setDownloadLogs([])
    setParsedResult(null)
    setMediaItems([])
    setSelectedMediaIds([])
    setDownloadProgress({ fraction: 0.12, stage: "准备解析" })
    setStatus("正在分析链接…")
    appendLog(`收到解析任务：${url}`)
    if (url !== rawInput) {
      appendLog("已从分享文本中自动提取 URL。")
    }

    let detectedPlatform: string | undefined

    try {
      const detected = detectPlatform(url)
      detectedPlatform = detected?.platform
      if (!detected) {
        throw new Error("未识别到支持的平台链接")
      }
      const name = PLATFORM_NAME[detected.platform] || detected.platform

      setDownloadProgress({ fraction: 0.2, stage: `检测到 ${name}，正在获取页面` })
      appendLog(`检测到平台：${name}`)
      appendLog("正在获取页面数据…")

      const r = await parseDetected(detected)
      if (!isCurrentTask()) return
      if (!r.success) {
        throw new Error(r.error || "解析失败")
      }

      const items = buildSelectableMediaItems(r)
      setDownloadProgress({ fraction: 0.72, stage: "正在提取可下载媒体" })
      if (!items.length) {
        throw new Error("未找到可下载的媒体")
      }

      setParsedResult(r)
      setMediaItems(items)
      setSelectedMediaIds(items.map((item) => item.id))
      setDownloadProgress({ fraction: 1, stage: "解析完成，等待选择" })
      appendLog(`解析成功：${r.title || "(无标题)"}，找到 ${items.length} 个媒体。`)
      if (r.images?.length && items.filter((item) => item.kind === "image").length < r.images.length) {
        appendLog("提示：部分图片 URL 被去重或过滤，下载列表只显示最终可用项。")
      }
      if (r.debug?.length) {
        for (const line of r.debug) appendLog(line)
      }
      setStatus(`解析完成：已默认全选 ${items.length} 个媒体，可取消不需要的项目。`)
    } catch (error) {
      if (!isCurrentTask()) return
      const message = error instanceof Error ? error.message : String(error)
      const advice = failureAdvice(message, detectedPlatform)
      appendLog(`解析失败：${message}`)
      appendLog(`建议：${advice}`)
      setStatus(`解析失败：${message}`)
      await alert({ title: "解析失败", message: `${message}\n\n建议：${advice}` })
    } finally {
      if (isCurrentTask()) setLoading(false)
    }
  }

  const toggleMediaSelection = (id: string) => {
    setSelectedMediaIds((current) => current.includes(id) ? current.filter((itemId) => itemId !== id) : [...current, id])
  }

  const selectAllMedia = () => {
    setSelectedMediaIds(mediaItems.map((item) => item.id))
  }

  const clearMediaSelection = () => {
    setSelectedMediaIds([])
  }

  const downloadSelectedMedia = async () => {
    if (!parsedResult) {
      setStatus("请先解析链接。")
      return
    }
    const selectedItems = selectedMediaItems(mediaItems, selectedMediaIds)
    if (!selectedItems.length) {
      setStatus("请至少勾选一个要下载的媒体。")
      return
    }

    const taskId = activeTaskRef.current + 1
    activeTaskRef.current = taskId
    const isCurrentTask = () => activeTaskRef.current === taskId

    const platform = parsedResult.platform || "unknown"
    const icon = PLATFORM_ICON[platform] || "🔗"
    const name = PLATFORM_NAME[platform] || platform
    let downloadedBytes = 0
    let savedLocalPath: string | null = null
    let primaryVideoUrl: string | null = null
    let savedCount = 0
    let failedCount = 0
    let saveSummary = ""

    setLoading(true)
    setDownloadProgress({ fraction: 0.1, stage: "准备下载，正在整理已选内容" })
    setStatus(`正在下载 ${selectedItems.length} 个已选媒体…`)
    appendLog(`开始下载已选内容：${selectedItems.length} 个。`)

    try {
      const videoItem = selectedItems.find((item) => item.kind === "video")
      const imageItems = selectedItems.filter((item) => item.kind === "image")

      if (videoItem) {
        setDownloadProgress({ fraction: 0.3, stage: "正在下载视频文件" })
        appendLog(`开始下载视频：${videoItem.url}`)
        primaryVideoUrl = videoItem.url
        const result = await saveVideoToPhotos(videoItem.url, parsedResult.title, parsedResult.link, platform, parsedResult.videoId, parsedResult.videoUrls, parsedResult.videoUri, parsedResult.audio_url || undefined)
        if (!isCurrentTask()) return
        appendLog(result.msg)
        downloadedBytes += result.bytes
        savedLocalPath = result.path || null
        savedCount += 1
        saveSummary = result.msg
      }

      if (imageItems.length) {
        setDownloadProgress({ fraction: videoItem ? 0.65 : 0.35, stage: `正在保存图片到相册（${imageItems.length} 张）` })
        appendLog(`开始保存 ${imageItems.length} 张图片…`)
        const imageResult = await saveImagesToPhotos(imageItems.map((item) => item.url), parsedResult.title, parsedResult.link, platform)
        if (!isCurrentTask()) return
        appendLog(imageResult.msg)
        downloadedBytes += imageResult.bytes
        savedCount += imageResult.saved
        failedCount += imageResult.failed
        saveSummary = saveSummary ? `${saveSummary}；${imageResult.msg}` : imageResult.msg
        if (imageResult.failed > 0) appendLog(`提示：有 ${imageResult.failed} 张图片保存失败，通常是个别 CDN 链接临时不可访问。`)
      }

      if (!isCurrentTask()) return
      setDownloadProgress({ fraction: 0.95, stage: "正在写入历史记录" })
      const imageCount = imageItems.length
      const mediaKind: "video" | "image" | "mixed" = videoItem && imageCount ? "mixed" : videoItem ? "video" : "image"
      const mediaCount = selectedItems.length
      await insertHistory({
        platform,
        icon,
        title: selectedItems.length > 1 ? `${parsedResult.title || "(无标题)"}（${selectedItems.length}项）` : parsedResult.title || "(无标题)",
        videoUrl: primaryVideoUrl,
        thumbnailUrl: parsedResult.cover_url || selectedItems[0]?.thumbnailUrl || null,
        pageURL: parsedResult.link || inputURL,
        createdAt: Date.now(),
        localFilePath: savedLocalPath,
        bytesWritten: downloadedBytes,
        mediaKind,
        mediaCount,
        savedCount,
        failedCount,
        saveSummary,
      })
      await refreshHistory()
      appendLog("历史记录已写入。")

      setDownloadProgress({ fraction: 1, stage: "全部完成" })
      setStatus(failedCount > 0 ? `下载完成：${savedCount}/${selectedItems.length} 个媒体成功（${name}）` : `下载成功：${selectedItems.length} 个媒体（${name}）`)
    } catch (error) {
      if (!isCurrentTask()) return
      const message = error instanceof Error ? error.message : String(error)
      const advice = failureAdvice(message, platform)
      appendLog(`下载失败：${message}`)
      appendLog(`建议：${advice}`)
      setStatus(`下载失败：${message}`)
      await alert({ title: "下载失败", message: `${message}\n\n建议：${advice}` })
    } finally {
      if (isCurrentTask()) setLoading(false)
    }
  }

  const handleClearHistory = async () => {
    if (!history.length) {
      setStatus("当前没有历史记录可清空。")
      return
    }
    const result = await Dialog.actionSheet({
      title: "清空历史记录",
      message: "仅删除历史记录，不删除本地下载文件。",
      actions: [{ label: "清空", destructive: true }],
      cancelButton: true,
    })
    if (result !== 0) return
    await clearAllHistory()
    await refreshHistory()
    setStatus("已清空历史记录。")
  }

  return (
    <ZStack
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      sheet={releaseNotes as any}
      toast={toastMessage ? {
        message: toastMessage,
        isPresented: toastPresented,
        onChanged: setToastPresented,
        position: "top",
        duration: 2,
      } : undefined}
    >
      <TabView
        selection={activeTab as any}
        tint="systemPink"
        tabViewStyle="sidebarAdaptable"
        tabBarMinimizeBehavior="onScrollDown"
      >
        {/* 底部 Tab 只留图标，不显示文字 */}
        <Tab title="" systemImage="clock.arrow.circlepath" value={HISTORY_TAB}>
          <HistoryPage
            history={history}
            onRefresh={refreshHistory}
            onClear={handleClearHistory}
            onStatus={setStatus}
            onRedownload={redownloadFromHistory}
            onOpenSavedFiles={() => void openSavedFiles()}
            dismiss={dismiss}
          />
        </Tab>

        <Tab title="" systemImage="arrow.down.circle.fill" value={DOWNLOAD_TAB}>
          <DownloadPage
            inputURL={inputURL}
            parsedResult={parsedResult}
            mediaItems={mediaItems}
            selectedMediaIds={selectedMediaIds}
            loading={loading}
            downloadLogs={downloadLogs}
            downloadProgress={downloadProgress}
            status={status}
            logProxyRef={logProxyRef}
            onToggleMedia={toggleMediaSelection}
            onSelectAll={selectAllMedia}
            onClearSelection={clearMediaSelection}
            onDownloadSelected={() => void downloadSelectedMedia()}
            onStopTask={stopCurrentTask}
            onCopyStatus={() => void copyDownloadStatus()}
            onCopyLogs={() => void copyDownloadLogs()}
            onRetry={() => void parseFromInput(inputURL)}
            dismiss={dismiss}
          />
        </Tab>

        <Tab title="" systemImage="gearshape.fill" value={SETTINGS_TAB}>
          <SettingsPage
            saveMode={saveMode}
            onSaveModeChange={setSaveMode}
            cookies={cookies}
            onCookiesChange={setCookies}
            onShowReleaseNotes={() => releaseNotes.onChanged(true)}
            dismiss={dismiss}
          />
        </Tab>
      </TabView>
      <AddButtonCluster
        visible={showAddActions}
        loading={loading}
        onToggle={toggleAddActions}
        onPaste={() => void downloadFromClipboard()}
        onManual={() => void openManualAddDialog()}
        onCancel={stopCurrentTask}
      />
    </ZStack>
  )
}

// ─── 入口 ──────────────────────────────────────────────

async function run() {
  const intentURL = resolveIntentURL()
  if (intentURL) {
    await runIntentDownload(intentURL)
    return
  }

  await Navigation.present({
    element: <View />,
  })
  Script.exit()
}

run()
