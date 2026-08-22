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
 */

import {
  Text, TextField, Button, List, Section, HStack, VStack, ZStack,
  Image, Rectangle, Spacer,
  NavigationStack, Navigation, ScrollView, ScrollViewReader, LazyVGrid,
  ProgressView, Tab, TabView,
  fetch, useState, useEffect, useRef, useObservable,
  Script, Intent
} from "scripting"

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
  writeAsBytes(path: string, data: Data): Promise<void>
  removeSync(path: string): void
}
declare const openURL: (url: string) => Promise<boolean>

declare const ShareSheet: {
  present(items: any[]): Promise<boolean>
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
  debug?: string[]
}

const PLATFORMS: [string, RegExp[]][] = [
  ['douyin',      [/douyin\.com/i, /iesdouyin/i, /v\.douyin/i]],
  ['twitter',     [/twitter\.com/i, /x\.com\//i]],
  ['xiaohongshu', [/xiaohongshu\.com/i, /xhslink\.com/i]],
  ['instagram',   [/instagram\.com/i]],
  ['bilibili',    [/bilibili\.com/i, /b23\.tv/i]],
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

/** 从抖音 URL 提取视频 ID */
function extractDouyinId(url: string): string | null {
  const patterns = [
    /(?:douyin|iesdouyin)\.com\/(?:share\/)?(?:video|note|slides|playlist)\/([0-9]+)/i,
    /(?:iesdouyin|douyin)\.com\/video\/([0-9]+)/i,
    /aweme_id[=:]([0-9]+)/i,
    /\/video\/([0-9]+)/i,
    /modal_id=([0-9]+)/i,
  ]
  for (const p of patterns) {
    const m = url.match(p)
    if (m && m[1]) return m[1]
  }
  return null
}

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
  // 恢复原版 3 host 策略（snssdk → api.douyin → iesdouyin，各 10s）
  const hosts = [
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
// 多策略解析：WebView JS 注入（主）→ 直接 API fetch（备用）→ HTML 兜底
async function parseDouyin(url: string): Promise<MediaResult> {
  const result: MediaResult = { success: false, error: '' }
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
  result.platform = 'douyin'
  result.link = url

  // 加载 Cookie
  const cookieConfig = await loadCookies()
  const dyCookie = (cookieConfig.douyin || '').trim()

  // 提取视频 ID
  let awemeId = extractDouyinId(url)

  // ── 展开短链接 ──
  let targetUrl = url
  if (url.match(/v\\.douyin\\.com/i) || url.match(/v\\.douyin/i)) {
    try {
      const fetchHeaders: Record<string, string> = { 'User-Agent': UA }
      if (dyCookie) fetchHeaders['Cookie'] = dyCookie
      const resp = await fetch(url, { headers: fetchHeaders, timeout: 8 })
      const finalUrl = (resp as any).url || ''
      if (finalUrl && finalUrl !== url && !finalUrl.match(/v\\.douyin\\.com/i)) {
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
    result.videoId = /^\\d+$/.test(rawVid) ? rawVid : ''
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
  // 策略 1: 直接 API fetch（最快！~1s）→ get1080pUrlFromUri 画质升级
  // ════════════════════════════════════════════════════════
  if (awemeId) {
    // 优先尝试直接 API（无需 WebView，1 次 fetch 即可）
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
    const ssrMatch = html.match(/window\\._SSR_HYDRATADATA\\s*=\\s*({.+?});\\n*<\/script>/s)
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

  if (!result.success && !result.error) result.error = '无法从抖音页面提取视频，请重试'
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
function extractNoteId(url: string): string | null {
  const patterns = [
    /\/explore\/([a-f0-9]{24})/i,
    /\/discovery\/item\/([a-f0-9]{24})/i,
    /\/item\/([a-f0-9]{24})/i,
  ]
  for (const p of patterns) {
    const m = url.match(p)
    if (m && m[1]) return m[1]
  }
  return null
}

/** 绝对 URL 拼接 */
function absolutizeUrl(base: string, maybeRelative: string): string {
  try { return new URL(maybeRelative, base).toString() } catch { return maybeRelative }
}

/** 从文本提取小红书 URL */
function extractXhsUrlFromText(text: string): string {
  if (!text) return ''
  const patterns = [
    /(?:window\.location(?:\.href|\.replace)?\s*=\s*|location\.replace\()\s*[\'"]([^\'"]+)[\'"]/i,
    /https?:\/\/(?:www\.)?xiaohongshu\.com\/(?:explore|discovery\/item|item|sns\/note)\/[a-zA-Z0-9]+[^\s\'"<>]*/i,
  ]
  for (const p of patterns) {
    const m = text.match(p)
    if (m) {
      let v = (m[1] || m[0] || '').trim()
      try { v = decodeURIComponent(v) } catch {}
      if (v.includes('xiaohongshu.com/explore/') || v.includes('xiaohongshu.com/item/') || v.includes('xiaohongshu.com/discovery/')) return v
    }
  }
  return ''
}

/** 解析 HTML 中的 __INITIAL_STATE__ JSON */
function extractInitialState(html: string): Record<string, any> | null {
  const markers = ['window.__INITIAL_STATE__=', 'window.__INITIAL_STATE__ = ', 'window.__INITIAL_SSR_STATE__=']
  for (const marker of markers) {
    const idx = html.indexOf(marker)
    if (idx === -1) continue
    const jsonStart = html.indexOf('{', idx + marker.length)
    if (jsonStart === -1) continue
    let bracketCount = 0, inString = false, escaped = false
    for (let i = jsonStart; i < html.length; i++) {
      const ch = html[i]
      if (escaped) { escaped = false; continue }
      if (ch === '\\') { escaped = true; continue }
      if (ch === '"') { inString = !inString; continue }
      if (inString) continue
      if (ch === '{') { bracketCount++; continue }
      if (ch === '}') {
        bracketCount--
        if (bracketCount === 0) {
          const jsonText = html.slice(jsonStart, i + 1).replace(/:\s*undefined(?=[,}])/g, ':null')
          try { return JSON.parse(jsonText) } catch { continue }
        }
      }
    }
  }
  return null
}

/** 在 __INITIAL_STATE__ 中搜索目标笔记 */
function findNoteData(init: Record<string, any>, noteId: string): Record<string, any> | null {
  // ParseHub 快捷路径：data.note.firstNoteId → noteDetailMap[id].note（直接命中，无需评分）
  const firstNoteId = get(init, ['note', 'firstNoteId'])
  if (firstNoteId && String(firstNoteId).toLowerCase() === noteId.toLowerCase()) {
    const direct = get(init, ['note', 'noteDetailMap', noteId, 'note'])
    if (direct && typeof direct === 'object') return direct
  }
  // 候选搜索（兼容不同数据结构）
  const candidates: any[] = [
    get(init, ['note', 'noteDetailMap', noteId, 'note']),
    get(init, ['note', 'noteDetailMap', noteId, 'note', 'noteCard']),
    get(init, ['note', 'noteDetailMap', noteId]),
    get(init, ['noteData', 'noteData', 'note']),
    get(init, ['noteData', 'data', 'note']),
    get(init, ['note', 'noteData', 'note']),
  ]
  let best: Record<string, any> | null = null, bestScore = 0
  for (const c of candidates) {
    if (!c || typeof c !== 'object') continue
    let score = 0
    const id = c.noteId || c.note_id || c.id
    if (id && String(id).toLowerCase() === noteId.toLowerCase()) score += 6
    if (c.imageList?.length || c.images?.length) score += 4
    if (c.video?.media?.stream || c.video?.url) score += 4
    if (c.title || c.desc) score += 1
    if (c.user || c.nickname) score += 1
    if (c.noteCard) score += 2
    if (score > bestScore) { bestScore = score; best = c }
  }
  return bestScore >= 7 ? best : null
}

function get(obj: any, keys: string[]): any {
  let cur = obj
  for (const k of keys) {
    if (!cur || typeof cur !== 'object' || !(k in cur)) return null
    cur = cur[k]
  }
  return cur
}

function getXhsPreviewImageUrl(rawUrl: string): string {
  return getRawImageUrl(rawUrl)
}

function getRawImageUrl(imgUrl: string): string {
  if (!imgUrl) return ''
  const clean = imgUrl.split('?')[0].split('@')[0].replace(/\\u002F/g, '/')
  const specMatch = clean.match(/\/(spectrum|note_pre_post_uhdr|notes_pre_post|notes_uhdr)\/([^/!]+)(?:!.*)?$/)
  if (specMatch) return `https://sns-img-hw.xhscdn.com/${specMatch[1]}/${specMatch[2]}`
  return clean.replace(/![^/]*$/, '')
}

function isLikelyXhsNoteImageUrl(url: string): boolean {
  if (!/^https?:\/\/[^\s"'<>]+xhscdn\.com\//i.test(url)) return false
  if (/avatar|profile|comment|emoji|sticker|icon|logo/i.test(url)) return false
  return /\/(spectrum|note_pre_post_uhdr|notes_pre_post|notes_uhdr)\//i.test(url)
    || /sns-img-[^/]+\.xhscdn\.com\/[^\s"'<>/]{16,}/i.test(url)
}

function buildXhsImageUrlFromId(value: any): string {
  if (typeof value !== 'string') return ''
  const id = value.trim().replace(/^["']|["']$/g, '')
  if (!/^[a-zA-Z0-9_-]{16,}$/.test(id)) return ''
  return `https://sns-img-hw.xhscdn.com/${id}`
}

function pushXhsImageUrl(set: Set<string>, value: any) {
  if (typeof value !== 'string') return
  const normalized = value.replace(/\\u002F/g, '/').replace(/&amp;/g, '&')
  if (!isLikelyXhsNoteImageUrl(normalized)) return
  const raw = getRawImageUrl(normalized)
  if (raw && /^https?:\/\//i.test(raw)) set.add(raw)
}

function isXhsVideoNote(source: any): boolean {
  if (!source || typeof source !== 'object') return false
  const type = String(source.type || source.noteType || source.note_type || '').toLowerCase()
  if (type === 'video') return true
  if (source.video || source.videoInfo) return true
  const card = source.noteCard || source.note_card
  if (card && (card.video || card.videoInfo || String(card.type || '').toLowerCase() === 'video')) return true
  return false
}

function collectXhsImagesDeep(source: any): string[] {
  const found = new Set<string>()
  const seen = new Set<any>()
  const walk = (node: any, depth: number) => {
    if (!node || depth > 10 || found.size >= 36) return
    if (typeof node === 'string') {
      pushXhsImageUrl(found, node)
      return
    }
    if (typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }
    for (const key of ['urlDefault', 'urlSizeLarge', 'urlPre', 'url', 'src', 'originalUrl', 'traceId', 'trace_id', 'fileId', 'file_id']) {
      if (/^(traceId|trace_id|fileId|file_id)$/.test(key)) {
        const built = buildXhsImageUrlFromId(node[key])
        if (built) found.add(built)
      } else {
        pushXhsImageUrl(found, node[key])
      }
    }
    const infoList = node.infoList || node.info_list
    if (Array.isArray(infoList)) {
      for (const item of infoList) walk(item, depth + 1)
    }
    for (const key of Object.keys(node)) {
      if (/avatar|user|icon|emoji|sticker|comment/i.test(key)) continue
      walk(node[key], depth + 1)
    }
  }
  walk(source, 0)
  return Array.from(found)
}

function extractXhsImagesFromHtml(html: string): string[] {
  const found = new Set<string>()
  const normalizedHtml = html.replace(/\\u002F/g, '/').replace(/\\\//g, '/')
  const re = /https?:\/\/[^\s"'<>]+?xhscdn\.com[^\s"'<>]*/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(normalizedHtml)) && found.size < 36) {
    pushXhsImageUrl(found, m[0])
  }
  return Array.from(found)
}

function extractXhsTitleFromHtml(html: string): string {
  const og = html.match(/<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']+)/i)
    || html.match(/<title>([^<]+)/i)
  return (og?.[1] || '').replace(/&amp;/g, '&').trim().slice(0, 100)
}

async function parseXhsImagesFast(url: string, headers: Record<string, string>): Promise<MediaResult | null> {
  try {
    const resp = await fetch(url, { headers, timeout: 12 } as any)
    const html = await resp.text().catch(() => '')
    if (html.length < 300) return null
    const finalUrl = (resp as any).url || url
    const embeddedUrl = extractXhsUrlFromText(html)
    if (embeddedUrl && embeddedUrl !== url && embeddedUrl !== finalUrl) {
      const nested = await parseXhsImagesFast(embeddedUrl, headers)
      if (nested?.success && nested.images?.length) return nested
    }
    const init = extractInitialState(html)
    const noteId = extractNoteId(finalUrl) || extractNoteId(url) || extractNoteId(extractXhsUrlFromText(html))
    const note = init && noteId ? findNoteData(init, noteId) : null
    if (isXhsVideoNote(note)) return null
    if (!note && /["'](?:type|noteType|note_type)["']\s*:\s*["']video["']/i.test(html)) return null
    const noteImages = note ? collectXhsImagesDeep(note) : []
    const stateImages = init ? collectXhsImagesDeep(init) : []
    const htmlImages = extractXhsImagesFromHtml(html)
    const images = uniqueUrls([...noteImages, ...stateImages, ...htmlImages])
      .filter((imageUrl) => !/avatar|profile|comment|emoji|sticker|icon|logo/i.test(imageUrl))
      .slice(0, 18)
    if (!images.length) return null
    const debug = [
      `小红书图文快速解析：noteId=${noteId || 'unknown'}`,
      `候选图片：note=${noteImages.length} state=${stateImages.length} html=${htmlImages.length}`,
      `最终保留：${images.length} 张`,
      `页面：${finalUrl}`,
    ]
    return {
      success: true,
      platform: 'xiaohongshu',
      title: note ? (note.title || note.desc || extractXhsTitleFromHtml(html) || '').slice(0, 100) : extractXhsTitleFromHtml(html),
      images,
      imagePreviews: images.map(getXhsPreviewImageUrl),
      cover_url: getXhsPreviewImageUrl(images[0]) || images[0] || null,
      link: finalUrl,
      debug,
    }
  } catch {
    return null
  }
}

function collectImages(noteData: Record<string, any>): string[] {
  const rawList: any[] = noteData.imageList || noteData.images || []
  const uniq = new Set<string>()
  for (const img of rawList) {
    if (!img || typeof img !== 'object') continue
    const u = img.urlDefault || img.url || img.urlPre || ''
    if (u && u.includes('xhscdn')) try { uniq.add(new URL(u).toString()) } catch { uniq.add(u) }
  }
  return Array.from(uniq)
}

function collectVideoUrl(noteData: Record<string, any>): string {
  const v = noteData.video || {}
  const media = v.media || {}
  const stm = media.stream || {}
  const candidates: string[] = [
    stm.masterUrl, stm.url,
    stm.av1?.[0]?.masterUrl, stm.av1?.[0]?.url,
    stm.h265?.[0]?.masterUrl, stm.h265?.[0]?.url,
    stm.h264?.[0]?.masterUrl, stm.h264?.[0]?.url,
    media.url, v.url,
  ]
  for (const c of candidates) {
    if (c && typeof c === 'string' && c.startsWith('http')) {
      const clean = c.split('?')[0].split('@')[0]
      if (!clean.includes('.m3u8')) return clean
    }
  }
  return ''
}

async function parseXiaohongshu(url: string): Promise<MediaResult> {
  const result: MediaResult = { success: false, images: [], error: '' }
  // 使用桌面 Chrome UA — 小红书对移动浏览器限制严格（触发"仅支持 APP 内查看"），桌面浏览器直接可访问
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'
  result.platform = 'xiaohongshu'
  result.link = url

  // 加载配置的 Cookie（用于反爬虫，获取最高画质）
  const cookieConfig = await loadCookies()
  const xhsCookie = (cookieConfig.xiaohongshu || '').trim()
  let xhslinkDiag = '' // xhslink 诊断收集

  // xhslink.com 短链：ParseHub 方案 — 桌面 UA + 自动跟随重定向 + INITIAL_STATE 解析
  const fetchHeaders: Record<string, string> = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': 'https://www.xiaohongshu.com/',
  }
  if (xhsCookie) fetchHeaders['Cookie'] = xhsCookie

  // 图文帖走纯 fetch 快速解析，避免进入 WebView 后卡在 35%。如果是视频或没拿到图片，再交给原视频解析链路。
  const fastImageResult = await parseXhsImagesFast(url, fetchHeaders)
  if (fastImageResult?.success && fastImageResult.images?.length) return fastImageResult

  if (url.match(/xhslink\.com/i)) {
    // 策略 A: GET 桌面页面，自动跟随重定向，解析 INITIAL_STATE（纯 fetch 快速路径）
    try {
      const resp = await fetch(url, { headers: fetchHeaders, timeout: 20 } as any)
      const html = await resp.text().catch(() => '')
      if (html.length > 500) {
        const init = extractInitialState(html)
        const embeddedUrl = extractXhsUrlFromText(html)
        const noteId = extractNoteId(resp.url || url) || (embeddedUrl ? extractNoteId(embeddedUrl) : null)
        if (init && noteId) {
          const note = findNoteData(init, noteId)
          if (note) {
            const images = collectImages(note).map(getRawImageUrl).filter(Boolean)
            const videoUrl = collectVideoUrl(note)
            result.title = (note.title || note.desc || '').slice(0, 100)
            result.platform = 'xiaohongshu'
            result.link = resp.url || url
            if (videoUrl) { result.video_url = videoUrl; result.success = true; return result }
            if (images.length) { result.images = images; result.success = true; return result }
          }
        }
      }
    } catch {}
    // 策略 B: 手动跟随重定向（某些 xhslink 链需要多跳）
    try {
      let cur = url
      for (let hop = 0; hop < 5; hop++) {
        const resp = await fetch(cur, { headers: fetchHeaders, redirect: 'manual', timeout: 15 } as any)
        const loc = (resp.headers as any)?.get?.('location') || (resp.headers as any)?.Location
        if (resp.status >= 300 && resp.status < 400 && loc) {
          cur = absolutizeUrl(cur, loc)
          if (cur.includes('xiaohongshu.com/') && !cur.includes('/404/sec_')) {
            // 到达真实 URL → 重新调用自身走完整解析
            return parseXiaohongshu(cur)
          }
          continue
        }
        const html = await resp.text().catch(() => '')
        if (html.length > 500) {
          const init = extractInitialState(html)
          const embeddedUrl = extractXhsUrlFromText(html)
          const noteId = extractNoteId(cur) || (embeddedUrl ? extractNoteId(embeddedUrl) : null)
          if (init && noteId) {
            const note = findNoteData(init, noteId)
            if (note) {
              const images = collectImages(note).map(getRawImageUrl).filter(Boolean)
              const videoUrl = collectVideoUrl(note)
              result.title = (note.title || note.desc || '').slice(0, 100)
              result.platform = 'xiaohongshu'
              result.link = cur
              if (videoUrl) { result.video_url = videoUrl; result.success = true; return result }
              if (images.length) { result.images = images; result.success = true; return result }
            }
          }
          break
        }
      }
    } catch {}
  }
  const webView = new WebViewController({ ephemeral: true })
  try {
    webView.setCustomUserAgent(UA)
    // 注入平台 Cookie（绕过反爬虫，获取最高画质）
    await setPlatformCookies(webView, 'xiaohongshu')
    await webView.loadURL(url)
    await Promise.race([
      webView.waitForLoad().then(() => true),
      sleep(6000).then(() => false),
    ])
    await sleep(800)

    // 获取重定向后的真实 URL（xhslink 可能需要更长时间重定向）
    // 对于 xhslink，轮询等待 JS 跳转完成（最多 8 秒）
    const isXhsLinkSource = url.match(/xhslink\.com/i)
    const redirectTimeout = isXhsLinkSource ? 8000 : 2500
    const pollInterval = 500
    const maxPolls = redirectTimeout / pollInterval
    let actualUrl = url
    for (let poll = 0; poll < maxPolls; poll++) {
      await sleep(pollInterval)
      const loc = await webView.evaluateJavaScript<string>('location.href')
      if (loc && loc !== url && !loc.match(/xhslink\.com/i)) {
        actualUrl = loc
        break
      }
      actualUrl = loc || actualUrl
    }
    if (actualUrl && actualUrl !== url && !actualUrl.match(/xhslink\.com/i)) {
      // 如果被重定向到安全拦截页，直接返回错误
      if (actualUrl.includes('/404/sec_')) {
        result.error = '小红书安全验证拦截：该内容仅支持在 APP 内查看'
        return result
      }
      // 如果跳转到了真正的页面，重新开始解析（因为页面内容不同）
      webView.dispose()
      return parseXiaohongshu(actualUrl)
    }
    // 如果当前在 xhslink 壳页面但有 og:url 等 meta 也可用
    if (isXhsLinkSource && (actualUrl.match(/xhslink\.com/i) || actualUrl === url)) {
      xhslinkDiag += `&webview_final=${encodeURIComponent(actualUrl.slice(0, 80))}`
      const metaUrl = await webView.evaluateJavaScript<string>(`
        (function() {
          try {
            var m = document.querySelector('meta[property="og:url"]') || document.querySelector('meta[name="og:url"]')
            if (m && m.content && !m.content.includes('xhslink.com') && m.content.includes('xiaohongshu')) return m.content
            var c = document.querySelector('link[rel="canonical"]')
            if (c && c.href && !c.href.includes('xhslink.com') && c.href.includes('xiaohongshu')) return c.href
          } catch(e) {}
          return ''
        })()
      `)
      xhslinkDiag += `&meta_url=${metaUrl ? 'found' : 'none'}`
      if (metaUrl) {
        webView.dispose()
        return parseXiaohongshu(metaUrl)
      }
    } else {
      xhslinkDiag += `&webview_final=${encodeURIComponent((actualUrl || '').slice(0, 80))}`
    }

    // 尝试滚动页面加载懒加载内容
    await webView.evaluateJavaScript(`
      window.scrollTo(0, 200)
    `)
    await sleep(1500)

    // 触发视频播放
    await webView.evaluateJavaScript(`
      (() => {
        var v = document.querySelector('video')
        if (v) { try { v.muted = true; v.play() } catch(e) {} }
        try {
          document.querySelectorAll('iframe').forEach(function(f) {
            var doc = f.contentDocument || f.contentWindow?.document
            if (doc) {
              var fv = doc.querySelector('video')
              if (fv) { fv.muted = true; fv.play().catch(function(){}) }
            }
          })
        } catch(e) {}
      })()
    `)

    // 轮询等待异步加载的笔记数据 / video 元素出现（小红书 SSR 只给空壳，实际数据异步加载）
    let hasNoteData = false
    for (let poll = 0; poll < 8; poll++) {
      await sleep(350)
      const ready = await webView.evaluateJavaScript<boolean>(`
        try {
          var init = window.__INITIAL_STATE__
          // 检查笔记数据是否已异步加载完成
          if (init && init.noteData && init.noteData.data) {
            var d = init.noteData.data
            // 有 noteId 或 video 字段说明数据已到位
            if (d.noteId || d.video || d.imageList || d.title) return true
          }
          // 检查 noteDetailMap（旧版结构，异步更新后可能出现）
          if (init && init.note && init.note.noteDetailMap) {
            var keys = Object.keys(init.note.noteDetailMap)
            if (keys.length > 0) return true
          }
          // 最后兜底：video 元素已出现且 src 非 blob
          var v = document.querySelector('video')
          if (v && (v.currentSrc || v.src) && !(v.currentSrc || v.src).startsWith('blob:')) return true
        } catch(e) {}
        return false
      `)
      if (ready) { hasNoteData = true; break }
    }
    // 如果轮询结束数据仍未就绪，轻量滚动一次触发图文懒加载。
    if (!hasNoteData) {
      await webView.evaluateJavaScript('window.scrollTo(0, document.body.scrollHeight)')
      await sleep(700)
      await webView.evaluateJavaScript('window.scrollTo(0, 200)')
      await sleep(700)
      for (let poll = 0; poll < 4; poll++) {
        await sleep(500)
        const ready = await webView.evaluateJavaScript<boolean>(`
          try {
            var init = window.__INITIAL_STATE__
            if (init && init.noteData && init.noteData.data) {
              var d = init.noteData.data
              if (d.noteId || d.video || d.imageList || d.title) return true
            }
            if (init && init.note && init.note.noteDetailMap) {
              var keys = Object.keys(init.note.noteDetailMap)
              if (keys.length > 0) return true
            }
          } catch(e) {}
          return false
        `)
        if (ready) { hasNoteData = true; break }
      }
    }

    // 轻量提取优先：避免把完整 __INITIAL_STATE__ / __NEXT_DATA__ 通过 JS bridge 克隆出来导致图文帖长时间卡住。
    const quickExtract = await Promise.race([
      webView.evaluateJavaScript<any>(`
        (function() {
          try {
            function cleanImageUrl(u) {
              if (!u || typeof u !== 'string') return ''
              var s = u.split('?')[0].split('@')[0]
              if (s.indexOf('/spectrum/') > -1 || s.indexOf('/notes_pre_post/') > -1 || s.indexOf('/note_pre_post_uhdr/') > -1 || s.indexOf('/notes_uhdr/') > -1) {
                var m = s.match(/\/(spectrum|note_pre_post_uhdr|notes_pre_post|notes_uhdr)\/([^\/!]+)$/)
                if (m) return 'https://sns-img-hw.xhscdn.com/' + m[1] + '/' + m[2]
              }
              return s
            }
            function pushImage(arr, u) {
              u = cleanImageUrl(u)
              if (!u || u.indexOf('xhscdn') === -1) return
              if (arr.indexOf(u) === -1) arr.push(u)
            }
            function pushVideo(arr, u) {
              if (!u || typeof u !== 'string') return
              if (u.indexOf('blob:') === 0 || u.indexOf('.m3u8') > -1) return
              if ((u.indexOf('sns-video') > -1 || u.indexOf('xhsvideo') > -1 || u.indexOf('.mp4') > -1) && arr.indexOf(u) === -1) arr.push(u)
            }
            var out = { title: '', author: '', images: [], videoUrls: [], cover: '', hasVideoNote: false }
            var state = window.__INITIAL_STATE__ || {}
            var candidates = []
            var maps = [state.note && state.note.noteDetailMap, state.noteData && state.noteData.noteDetailMap, state.noteDetailMap]
            maps.forEach(function(map) {
              if (!map || typeof map !== 'object') return
              Object.keys(map).forEach(function(k) {
                var item = map[k]
                if (item && item.note) candidates.push(item.note)
                if (item) candidates.push(item)
              })
            })
            if (state.noteData && state.noteData.data) candidates.push(state.noteData.data)
            if (state.note && state.note.noteCard) candidates.push(state.note.noteCard)
            for (var i = 0; i < candidates.length; i++) {
              var n = candidates[i]
              if (!n || typeof n !== 'object') continue
              out.title = out.title || n.title || n.displayTitle || n.desc || ''
              out.author = out.author || (n.user && (n.user.nickname || n.user.nickName)) || ''
              var type = n.type || n.noteType || n.note_type || ''
              if (type === 'video' || n.video || n.videoInfo) out.hasVideoNote = true
              var v = n.video || n.videoInfo || (n.noteCard && n.noteCard.video)
              if (n.videoUrl) pushVideo(out.videoUrls, n.videoUrl)
              if (v) {
                if (v.videoUrl) pushVideo(out.videoUrls, v.videoUrl)
                if (v.mediaUrl) pushVideo(out.videoUrls, v.mediaUrl)
                if (v.consumer && v.consumer.originVideoKey) pushVideo(out.videoUrls, 'https://sns-video-bd.xhscdn.com/' + v.consumer.originVideoKey)
                var stream = (v.media && v.media.stream) || v.stream || {}
                ;['h264','h265','av1'].forEach(function(codec) {
                  var list = stream[codec] || []
                  for (var si = 0; si < list.length; si++) {
                    pushVideo(out.videoUrls, list[si].masterUrl)
                    var bu = list[si].backupUrl || list[si].backup_url
                    if (Array.isArray(bu)) bu.forEach(function(x) { pushVideo(out.videoUrls, x) })
                    else pushVideo(out.videoUrls, bu)
                  }
                })
              }
              if (!out.hasVideoNote && !out.videoUrls.length) {
                var imgs = n.imageList || n.image_list || n.images || []
                for (var j = 0; j < imgs.length; j++) {
                  var img = imgs[j]
                  pushImage(out.images, img.urlDefault || img.urlSizeLarge || img.url || (img.infoList && img.infoList[0] && img.infoList[0].url) || '')
                }
              }
              if (n.cover) out.cover = out.cover || n.cover.urlDefault || n.cover.url || ''
            }
            var videoEl = document.querySelector('video')
            if (videoEl) {
              pushVideo(out.videoUrls, videoEl.currentSrc || videoEl.src || '')
              out.cover = out.cover || videoEl.poster || ''
            }
            if (!out.videoUrls.length && !out.hasVideoNote && !out.images.length) {
              var domImgs = document.querySelectorAll('img')
              for (var di = 0; di < domImgs.length && out.images.length < 18; di++) {
                var src = domImgs[di].src || domImgs[di].getAttribute('data-src') || ''
                if (src.length > 60) pushImage(out.images, src)
              }
            }
            return out
          } catch(e) { return { error: e.message || String(e), images: [], videoUrls: [] } }
        })()
      `),
      sleep(5000).then(() => ({ error: 'quick_extract_timeout', images: [], videoUrls: [] })),
    ])
    if (quickExtract && !quickExtract.error) {
      result.title = quickExtract.title || result.title || ''
      result.author = quickExtract.author || result.author || ''
      result.cover_url = quickExtract.cover || result.cover_url || ''
      const quickVideos = uniqueUrls(quickExtract.videoUrls || []).filter((u) => isValidDownloadUrl(u) || u.startsWith('http'))
      const quickImages = uniqueUrls(quickExtract.images || []).filter((u) => isValidDownloadUrl(u) || u.startsWith('http')).slice(0, 18)
      if (quickVideos.length) {
        result.video_url = removeWatermarkFromUrl(quickVideos[0])
        result.videoUrls = quickVideos.map(removeWatermarkFromUrl)
      }
      if (!result.video_url && quickImages.length) {
        result.images = quickImages.map(removeWatermarkFromUrl)
      }
      result.success = !!(result.video_url || result.images?.length)
      if (result.success) return result
      if (quickExtract.hasVideoNote) {
        const xhsCookie = (cookieConfig.xiaohongshu || '').trim()
        result.error = xhsCookie
          ? '小红书视频笔记未能提取到无水印链接，可能是登录态已过期。'
          : '小红书视频解析需要登录态。请在设置中配置小红书 Cookie（web_session + a1 字段），然后重试。'
        return result
      }
    }

    // 从页面提取数据
    const extracted = await webView.evaluateJavaScript<any>(`
      try {
        // performance 媒体资源（等待更久以捕获视频加载）
        var mediaEntries = performance.getEntriesByType('resource')
          .map(function(e) { return e.name })
          .filter(function(n) {
            return ['xhscdn','sns-video','sns-img','.mp4','video','masterUrl','trace','sns-','.m3u8'].some(function(k) { return n.indexOf(k) > -1 })
          })

        // 额外：从已完成的网络请求中找视频直链（小红书视频 CDN 特征）
        var networkVideos = performance.getEntriesByType('resource')
          .filter(function(e) {
            var n = e.name
            // 小红书视频 CDN 直链模式
            return (n.indexOf('sns-video-hw') > -1 || n.indexOf('sns-video-qc') > -1 || n.indexOf('xhsvideo') > -1)
              && (n.indexOf('.mp4') > -1 || n.indexOf('video') > -1)
          })
          .map(function(e) { return e.name })

        // video 元素 — 当前文档
        var v = document.querySelector('video')
        var videoSrc = v ? (v.currentSrc || v.src || '') : ''
        var poster = v ? v.poster : ''

        // 尝试 video > source 子元素
        var sourceSrc = ''
        if (!videoSrc || videoSrc.startsWith('blob:')) {
          try {
            var srcEl = document.querySelector('video source[src]')
            if (srcEl && srcEl.src) sourceSrc = srcEl.src
          } catch(e) {}
        }

        // iframe 中的 video 元素
        var iframeVideoSrc = ''
        try {
          document.querySelectorAll('iframe').forEach(function(f) {
            try {
              var doc = f.contentDocument || f.contentWindow?.document
              if (doc) {
                var fv = doc.querySelector('video')
                if (fv && (fv.currentSrc || fv.src) && !fv.src.startsWith('blob:')) {
                  iframeVideoSrc = fv.currentSrc || fv.src
                }
              }
            } catch(e) {}
          })
        } catch(e) {}

        // __INITIAL_STATE__（小红书的 SSR 数据，重新读取以获取异步更新后的数据）
        var initState = null
        try { if (window.__INITIAL_STATE__) initState = JSON.parse(JSON.stringify(window.__INITIAL_STATE__)) } catch(e) {}

        // __NEXT_DATA__
        var nextData = null
        try { if (window.__NEXT_DATA__) nextData = JSON.parse(JSON.stringify(window.__NEXT_DATA__)) } catch(e) {}

        // ── Procut 原版：直接在 JS 上下文读取视频 URL（不依赖 JSON clone）──
        // ── Procut 原版提取（精确照搬原始代码）──
        var xhsExtractJson = '{}'
        try {
          var r = {
            title:'', content:'', author:'', avatar:'',
            images:[], imageWidths:[], imageHeights:[],
            videoUrl:'', livePhotoVideoUrls:[],
            hasNoteData:false, time:0
          }
          // 去水印：将 xhscdn URL 转为 sns-img-hw.xhscdn.com 原图
          function getRawImageUrl(imgUrl) {
            if (!imgUrl) return ''
            var specMatch = imgUrl.match(/\/(spectrum|note_pre_post_uhdr|notes_pre_post|notes_uhdr)\/([^\/!]+?)(?:!.*)?$/)
            if (specMatch) return 'http://sns-img-hw.xhscdn.com/' + specMatch[1] + '/' + specMatch[2]
            var generalMatch = imgUrl.match(/\/([^\/!]+?)(?:!.*)?$/)
            if (generalMatch) return 'http://sns-img-hw.xhscdn.com/' + generalMatch[1]
            return imgUrl
          }
          var s = window.__INITIAL_STATE__
          if (s && s.note && s.note.noteDetailMap) {
            var ndm = s.note.noteDetailMap
            var keys = Object.keys(ndm)
            for (var i = 0; i < keys.length; i++) {
              var n = ndm[keys[i]] && ndm[keys[i]].note
              if (n && n.title) {
                r.title = n.title || ''
                r.content = n.desc || ''
                r.hasNoteData = true
                if (n.time) r.time = n.time
                if (n.user) {
                  r.author = n.user.nickname || ''
                  r.avatar = n.user.avatar || ''
                }
                if (n.type === 'video') {
                  r.videoUrls = []
                  if (n.videoUrl) { r.videoUrls.push(n.videoUrl) }
                  // originVideoKey 优先（原始上传文件，画质最高）
                  if (n.video && n.video.consumer && n.video.consumer.originVideoKey) {
                    var ovk = 'https://sns-video-bd.xhscdn.com/' + n.video.consumer.originVideoKey
                    if (r.videoUrls.indexOf(ovk) === -1) r.videoUrls.push(ovk)
                  }
                  // 然后才收集 stream masterUrl（可能只有 720p）
                  if (n.video && n.video.media && n.video.media.stream) {
                    var stm = n.video.media.stream
                    var codecs = ['h264','h265','av1']
                    for (var ci = 0; ci < codecs.length; ci++) {
                      var arr = stm[codecs[ci]]
                      if (arr && arr.length > 0) {
                        for (var si = 0; si < arr.length; si++) {
                          var s = arr[si]
                          if (s.masterUrl && s.masterUrl.indexOf('.m3u8') === -1) {
                            if (r.videoUrls.indexOf(s.masterUrl) === -1) r.videoUrls.push(s.masterUrl)
                          }
                        }
                      }
                    }
                  }
                  if (n.video && n.video.mediaUrl) {
                    if (r.videoUrls.indexOf(n.video.mediaUrl) === -1) r.videoUrls.push(n.video.mediaUrl)
                  }
                  r.videoUrl = r.videoUrls.length > 0 ? r.videoUrls[0] : ''
                }
                // 只有非视频帖才提取 imageList（视频帖有封面图但不应作为图片下载）
                if (n.type !== 'video' && n.imageList && n.imageList.length > 0) {
                  for (var j = 0; j < n.imageList.length; j++) {
                    var img = n.imageList[j]
                    var url = getRawImageUrl(img.urlDefault || img.url || img.urlSizeLarge || '')
                    if (url) {
                      r.images.push(url)
                      r.imageWidths.push(img.width || 0)
                      r.imageHeights.push(img.height || 0)
                    }
                  }
                }
                break
              }
            }
          }
          // __INITIAL_STATE__ 无笔记数据时，从 DOM <img> 元素提取图片URL
          if (!r.hasNoteData) {
            try {
              var imgs = document.querySelectorAll('img')
              for (var ii = 0; ii < imgs.length; ii++) {
                var isrc = imgs[ii].src || imgs[ii].getAttribute('data-src') || ''
                if (isrc.indexOf('xhscdn') > -1 && isrc.indexOf('sns-') > -1 && isrc.length > 60) {
                  // 取原始图（去掉 @ 后缀）
                  var cleanSrc = isrc.split('?')[0].split('@')[0]
                  if (r.images.indexOf(cleanSrc) === -1) r.images.push(cleanSrc)
                }
              }
              if (r.images.length > 0) r.hasNoteData = true
            } catch(e2) {}
          }
          xhsExtractJson = JSON.stringify(r)
        } catch(e) { xhsExtractJson = JSON.stringify({ error: e.message }) }


        // JSON-LD
        var jsonld = null
        try {
          var ld = document.querySelector('script[type="application/ld+json"]')
          if (ld) jsonld = ld.textContent || ''
        } catch(e) {}

        // meta
        var ogTitle = '', ogImage = '', ogVideo = ''
        try { ogTitle = document.querySelector('meta[property="og:title"]').content } catch(e) {}
        try { ogImage = document.querySelector('meta[property="og:image"]').content } catch(e) {}
        try { ogVideo = document.querySelector('meta[property="og:video"]').content } catch(e) {}

        // twitter:player
        var twitterPlayer = ''
        try { twitterPlayer = document.querySelector('meta[name="twitter:player"]').content } catch(e) {}

        // ── 壳页面检测 ──
        // 1. notFoundPage：SSR 标记此内容为 APP 内查看
        var isNotfoundPage = !!(initState && initState.notFoundPage)
        // 2. 页面 body 包含 "APP内查看" 或 "仅支持在小红书 APP"
        var bodyText = (document.body && document.body.innerText || '').slice(0, 300)
        var isAppOnlyPage = bodyText.indexOf('APP内查看') > -1 || bodyText.indexOf('仅支持在小红书 APP') > -1
        // 3. 被安全系统重定向到 /404/sec_ 页面
        var currentUrl = window.location.href || ''
        var isSecRedirect = currentUrl.indexOf('/404/sec_') > -1
        // 4. noteData.data 完全为空（没有异步数据注入）
        var noteDataEmpty = initState && initState.noteData && initState.noteData.data
          && Object.keys(initState.noteData.data).length === 0
        // 5. 没有有效的 video 元素
        var hasValidVideo = !!(v && (v.currentSrc || v.src) && !(v.currentSrc || v.src).startsWith('blob:'))

        return {
          mediaEntries: mediaEntries.slice(0, 30),
          networkVideos: networkVideos.slice(0, 10),
          initState: initState,
          nextData: nextData,
          xhsExtractJson: xhsExtractJson,
          jsonld: jsonld,
          videoSrc: videoSrc,
          sourceSrc: sourceSrc,
          iframeVideoSrc: iframeVideoSrc,
          poster: poster,
          ogTitle: ogTitle,
          ogImage: ogImage,
          ogVideo: ogVideo,
          twitterPlayer: twitterPlayer,
          documentTitle: document.title || '',
          bodyText: bodyText,
          // 壳页面检测标志
          isNotfoundPage: isNotfoundPage,
          isAppOnlyPage: isAppOnlyPage,
          isSecRedirect: isSecRedirect,
          noteDataEmpty: noteDataEmpty,
          hasValidVideo: hasValidVideo,
          currentUrl: currentUrl,
        }
      } catch(e) { return { error: e.message } }
    `)

    if (!extracted || extracted.error) {
      result.error = extracted?.error || 'WebView 提取失败'
      return result
    }

    // ─── 壳页面检测（防止误判为图片）───
    // XHS 对部分视频/内容实施严格反爬，SSR 只返回空壳，WebView 也无法加载真实数据
    if (extracted.isSecRedirect) {
      result.error = '小红书安全验证拦截：该内容需在 APP 内查看（被重定向至安全页面 ' + (extracted.currentUrl || '') + '）'
      return result
    }
    if (extracted.isNotfoundPage && extracted.noteDataEmpty) {
      const noteType = (extracted.initState?.notFoundPage?.noteType) || '未知'
      result.error = '小红书安全策略限制：该' + (noteType === 'video' ? '视频' : noteType === 'image' ? '图文' : '内容') + '仅支持在 APP 内查看，Web 端无法获取数据'
      return result
    }
    if (extracted.isAppOnlyPage && !extracted.hasValidVideo && !extracted.networkVideos?.length) {
      result.error = '小红书限制：该内容仅支持在 APP 内查看，无法通过网页提取视频'
      return result
    }
    // ─── 提取视频 ───
    // -1. Procut 原版提取结果（JSON 字符串，JS 上下文直接读取）
    try {
      const xhsJson = (extracted as any).xhsExtractJson as string | undefined
      if (xhsJson && xhsJson.length > 2) {
        const px = JSON.parse(xhsJson) as {
          title?: string; content?: string; author?: string;
          images?: string[]; videoUrl?: string; hasNoteData?: boolean;
        }
        if (px.hasNoteData) {
          if (!result.video_url && px.videoUrl && px.videoUrl.startsWith('http') && !px.videoUrl.includes('.m3u8')) {
            result.video_url = px.videoUrl
          }
          if (!result.title && px.title) result.title = px.title
          if (!result.author && px.author) result.author = px.author
          if (px.images?.length) {
            for (const img of px.images) {
              const raw = img && img.startsWith('http') && img.includes('xhscdn') ? getRawImageUrl(img) : img
              if (raw && !result.images!.includes(raw)) result.images!.push(raw)
            }
          }
        }
      }
    } catch(e) {}
    // 0. 网络请求中捕获的视频直链（最可靠，小红书异步加载后发出的 XHR）
    if (!result.video_url && extracted.networkVideos?.length) {
      for (const u of extracted.networkVideos) {
        if (u.startsWith('http') && !u.includes('.m3u8')) {
          result.video_url = u
          break
        }
      }
    }
    // 0b. video > source 子元素
    if (!result.video_url && extracted.sourceSrc && !extracted.sourceSrc.startsWith('blob:')) {
      result.video_url = extracted.sourceSrc
    }
    // 1. iframe 中的 video src（可能指向 CDN 直链）
    if (!result.video_url && extracted.iframeVideoSrc && !extracted.iframeVideoSrc.startsWith('blob:')) {
      result.video_url = extracted.iframeVideoSrc
    }
    // 2. 从 performance 媒体资源提取（总是 HTTP URL，非 blob）
    if (extracted.mediaEntries?.length) {
      for (const u of extracted.mediaEntries) {
        if (u.match(/\.mp4(\?|$)/) || u.match(/masterUrl|sns-video|trace/) && !u.includes('.m3u8')) {
          result.video_url = u
          break
        }
      }
    }
    // 2. og:video（跳过 blob）
    if (!result.video_url && extracted.ogVideo && !extracted.ogVideo.startsWith('blob:')) {
      result.video_url = extracted.ogVideo
    }
    // 3. twitter:player（类似 og:video）
    if (!result.video_url && extracted.twitterPlayer && !extracted.twitterPlayer.startsWith('blob:')) {
      result.video_url = extracted.twitterPlayer
    }
    // 4. video src（跳过 blob URL）
    if (!result.video_url && extracted.videoSrc && !extracted.videoSrc.startsWith('blob:')) {
      result.video_url = extracted.videoSrc
    }

    // ─── 提取图片（从 performance 资源）───
    // 仅当 __INITIAL_STATE__ 未加载时（如壳页面兜底）才使用 performance 图片
    // 如果 JS 已成功提取 note 数据，performance 资源可能包含推荐笔记/UI 干扰项
    const jsNoteExtracted = !!(extracted as any).xhsExtractJson && ((extracted as any).xhsExtractJson.includes('"hasNoteData":true'))
    if (!result.video_url && !jsNoteExtracted && !extracted.isNotfoundPage && !extracted.isAppOnlyPage && !extracted.isSecRedirect) {
      for (const u of (extracted.mediaEntries || [])) {
        if (u.match(/sns-img|\.(jpg|jpeg|png|webp)/i)) {
          result.images!.push(u.replace(/\?.*$/, '').split('@')[0])
        }
      }
    }

    // ─── 从 __INITIAL_STATE__ 提取视频和元数据 ───
    const init = extracted.initState
    // 也尝试 __NEXT_DATA__ 的 props
    const nextData = extracted.nextData
    
    // 合并搜索路径（适应小红书的多种数据结构版本）
    const possibleNotes: any[] = []
    
    // __INITIAL_STATE__ 的各种可能路径
    if (init) {
      // 辅助：从 noteDetailMap 取值并展开 .note 里层
      const noteDetailMapValues: any[] = []
      const ndmSources = [
        init?.note?.noteDetailMap,
        init?.noteData?.noteDetailMap,
        init?.noteDetailMap,
      ]
      for (const ndm of ndmSources) {
        if (ndm && typeof ndm === 'object') {
          for (const v of Object.values(ndm)) {
            if (v && typeof v === 'object') {
              // Procut 原版: ndm[key].note — 显式取里层
              if ((v as any).note && typeof (v as any).note === 'object') {
                noteDetailMapValues.push((v as any).note)
              }
              noteDetailMapValues.push(v)
            }
          }
        }
      }

      const searchPaths = [
        init?.noteData?.data,
        init?.note,
        init?.note?.noteList?.[0],
        init?.note?.noteCard,
        init?.noteCard,
        init?.note?.[Object.keys(init.note || {})[0]],
        init?.feed?.[0],
        init?.feeds?.[0],
        ...noteDetailMapValues,
      ]
      for (const p of searchPaths) {
        if (p && typeof p === 'object') possibleNotes.push(p)
      }
    }

    // __NEXT_DATA__ 的路径（SSR 版本）
    if (nextData) {
      const nextState = nextData?.props?.pageProps?.initialState
      const nextDetailMap = nextState?.noteDetailMap || nextData?.props?.pageProps?.noteDetailMap
      const nextNotes: any[] = []
      if (nextDetailMap && typeof nextDetailMap === 'object') {
        for (const v of Object.values(nextDetailMap)) {
          if (v && typeof v === 'object') {
            if ((v as any).note && typeof (v as any).note === 'object') nextNotes.push((v as any).note)
            nextNotes.push(v)
          }
        }
      }
      const nextPaths = [
        nextData?.props?.pageProps?.noteData,
        nextData?.props?.pageProps?.noteDetail,
        nextState?.note,
        ...nextNotes,
      ]
      for (const p of nextPaths) {
        if (p && typeof p === 'object') possibleNotes.push(p)
      }
    }
    
    // 从 JSON-LD 提取
    if (extracted.jsonld) {
      try {
        const ld = JSON.parse(extracted.jsonld as string)
        if (ld?.video) {
          const vUrl = ld.video.contentUrl || ld.video.url || ''
          if (vUrl && !vUrl.startsWith('blob:')) result.video_url = result.video_url || vUrl
        }
      } catch {}
    }

    // 追踪笔记类型：如果任意 note 是 video 类型但没提取到视频 URL，后面不降级到图片
    let hasVideoNote = false

    for (const note of possibleNotes) {
      if (!note || typeof note !== 'object') continue
      const rawNote = note as any
      // 展开 .note 里层（Procut 原版: ndm[key].note）
      const n = (rawNote.note && typeof rawNote.note === 'object') ? rawNote.note : rawNote
      result.title = result.title || n.title || n.displayTitle || ''
      result.author = result.author || n.user?.nickname || n.user?.nickName || n.nickname || ''

      // 检测 note 类型（video / normal / carousel）
      const noteType = n.type || n.noteType || n.note_type || rawNote.type || rawNote.noteType || ''
      if (noteType === 'video') hasVideoNote = true
      // 有 video 数据也标记为视频笔记
      if (n.video || n.videoInfo || n.noteCard?.video) hasVideoNote = true

      // 优先级 0: note 对象的直接 videoUrl 字段（Procut 逆向确认 note 层级也有）
      if (!result.video_url && n.videoUrl && typeof n.videoUrl === 'string') {
        const directVideo = n.videoUrl
        if (directVideo.startsWith('http') && !directVideo.includes('.m3u8')) {
          result.video_url = directVideo
        }
      }

      // 视频数据：尝试 noteCard 包裹层（新版小红书结构）
      const v = n.video || n.media?.video || n.videoInfo || n.noteCard?.video || n.noteCard?.media?.video
      if (v) {
        // 优先级 1: video 对象的 videoUrl 字段
        if (!result.video_url && (v as any).videoUrl && typeof (v as any).videoUrl === 'string') {
          const directVideo = (v as any).videoUrl
          if (directVideo.startsWith('http') && !directVideo.includes('.m3u8')) {
            result.video_url = directVideo
          }
        }

        // 优先级 2: 收集所有视频 URL 候选（originVideoKey 优先）
        const allUrls: string[] = []
        // originVideoKey 优先（原始上传文件，无二压）
        if (v.consumer?.originVideoKey && typeof v.consumer.originVideoKey === 'string') {
          const ovk = 'https://sns-video-bd.xhscdn.com/' + v.consumer.originVideoKey
          if (!allUrls.includes(ovk)) allUrls.push(ovk)
        }
        // 然后 media.stream 各 codec 的 masterUrl
        const streams = v.media?.stream || v.stream || v.videoInfo || v.media?.av1 || {}
        if (streams && typeof streams === 'object') {
          const codecs = ['h264', 'h265', 'av1']
          for (const codec of codecs) {
            const arr = (streams as any)[codec]
            if (!Array.isArray(arr)) continue
            for (const s of arr) {
              if (!s) continue
              if (s.masterUrl && !s.masterUrl.includes('.m3u8') && typeof s.masterUrl === 'string') {
                if (!allUrls.includes(s.masterUrl)) allUrls.push(s.masterUrl)
              }
              const bu = s.backupUrl || s.backup_url
              if (bu) {
                if (typeof bu === 'string' && !bu.includes('.m3u8') && !allUrls.includes(bu)) {
                  allUrls.push(bu)
                } else if (Array.isArray(bu)) {
                  for (const u of bu) {
                    if (typeof u === 'string' && !u.includes('.m3u8') && !allUrls.includes(u)) {
                      allUrls.push(u)
                    }
                  }
                }
              }
            }
          }
          const master = (streams as any).masterUrl || (streams as any).master_url
          if (typeof master === 'string' && !master.includes('.m3u8') && !allUrls.includes(master)) {
            allUrls.push(master)
          }
        }
        // mediaUrl 兜底
        if ((v as any).mediaUrl && typeof (v as any).mediaUrl === 'string') {
          const mu = (v as any).mediaUrl
          if (mu.startsWith('http') && !mu.includes('.m3u8') && !allUrls.includes(mu)) {
            allUrls.push(mu)
          }
        }
        // 去重后赋值
        const deduped = [...new Set(allUrls)]
        if (deduped.length > 0) {
          result.video_url = deduped[0]
          result.videoUrls = deduped
        }

        // 优先级 5: 直接 url / src 兜底
        if (!result.video_url) {
          const directUrl = (v as any).url || (v as any).src || ''
          if (typeof directUrl === 'string' && directUrl.startsWith('http') && !directUrl.includes('.m3u8')) {
            result.video_url = directUrl
          }
        }
      }

      // 图片列表（仅当未找到视频时才提取，防止视频帖封面图被误判为图片帖）
      // 视频笔记（note.type === 'video' 或含 video 数据）不降级提取图片，避免封面图被当成内容
      if (!result.video_url && !hasVideoNote) {
        const imgs = n.imageList || n.image_list || n.images || []
        for (const img of imgs) {
          // urlSizeLarge 是高清原图（Procut 逆向确认优先级）
          const rawUrl = (img as any).urlDefault || (img as any).urlSizeLarge || (img as any).url || (img as any).infoList?.[0]?.url || ''
          if (rawUrl) {
            const deduced = getRawImageUrl(rawUrl)
            result.images!.push(deduced.replace(/\?.*$/, '').split('@')[0])
          }
        }
      }
      if (n.cover?.urlDefault || n.cover?.url) {
        result.cover_url = result.cover_url || n.cover?.urlDefault || n.cover?.url || ''
      }
    }

    // ─── 视频笔记兜底提示 ───
    // 如果 note 类型是 video 但未能提取到 video_url，大概率是登录态不足，引导用户配置 Cookie
    if (hasVideoNote && !result.video_url) {
      const xhsCookie = (cookieConfig.xiaohongshu || '').trim()
      result.error = '该笔记为视频类型但未能提取到无水印视频链接。' +
        (xhsCookie
          ? '可能是登录态已过期，请重新配置小红书 Cookie。'
          : '小红书视频解析需要登录态。请在设置中配置小红书 Cookie（web_session + a1 字段），然后重试。')
      result.success = false
      return result
    }

    // ─── 封面与标题兜底 ───
    result.cover_url = result.cover_url || extracted.poster || extracted.ogImage || ''
    if (!result.title) {
      result.title = extracted.ogTitle || extracted.documentTitle ||
        (extracted.bodyText ? extracted.bodyText.slice(0, 50) : '')
    }

    // ─── 去重图片 ───
    const seen = new Set<string>()
    result.images = (result.images || []).filter(u => {
      const clean = u.replace(/\?.*$/, '').split('@')[0]
      if (seen.has(clean)) return false
      seen.add(clean)
      return true
    }).slice(0, 18)

    // ─── 水印清理 ───
    // 小红书 CDN URL 可能带 /watermark/ 路径或 @ 后缀，清理后才是无水印版本
    if (result.video_url) {
      result.video_url = removeWatermarkFromUrl(result.video_url)
      if (!isValidDownloadUrl(result.video_url)) result.video_url = ''
    }
    if (result.images!.length) {
      result.images = result.images!.map(u => removeWatermarkFromUrl(u)).filter(u => isValidDownloadUrl(u) || u.startsWith('http'))
    }

    result.success = !!(result.video_url || result.images!.length)
    if (!result.success) {
      // 诊断输出：帮助分析失败原因
      const diag: string[] = []
      diag.push(`hasNoteData=${hasNoteData}`)
      diag.push(`hasVideoNote=${hasVideoNote}`)
      diag.push(`xhsJson_len=${((extracted as any).xhsExtractJson || '').length}`)

      diag.push(`isAppOnly=${!!(extracted as any).isAppOnlyPage}`)
      diag.push(`isNotFound=${!!(extracted as any).isNotfoundPage}`)
      diag.push(`isSecRedir=${!!(extracted as any).isSecRedirect}`)
      const bodyLen = ((extracted as any).bodyText || '').length
      diag.push(`bodyLen=${bodyLen}`)
      try {
        const __s = (extracted as any).initState
        if (__s) {
          const topKeys = Object.keys(__s).slice(0, 10).join(',')
          diag.push(`initState_keys=[${topKeys}]`)
          if (__s.note) {
            const noteKeys = Object.keys(__s.note).slice(0, 10).join(',')
            diag.push(`note_keys=[${noteKeys}]`)
            if (__s.note.noteDetailMap) {
              const ndmKeys = Object.keys(__s.note.noteDetailMap)
              diag.push(`ndm_count=${ndmKeys.length}`)
              if (ndmKeys.length > 0) {
                const first = __s.note.noteDetailMap[ndmKeys[0]]
                const firstKeys = Object.keys(first).join(',')
                diag.push(`ndm_first_keys=[${firstKeys}]`)
                const nfm = (first as any).note
                if (nfm && typeof nfm === 'object') {
                  diag.push(`ndm.note_type=${nfm.type}, imgCount=${(nfm.imageList || []).length}, hasVideo=${!!nfm.video}`)
                }
              }
            }
          }
          if (__s.noteData) {
            diag.push(`noteData_keys=[${Object.keys(__s.noteData).join(',')}]`)
          }
        } else {
          diag.push('initState=null')
        }
      } catch(e: any) { diag.push(`diag_err=${e.message}`) }
      if (xhslinkDiag) diag.push(`xhslink=${xhslinkDiag}`)
      result.error = '无法从小红书页面提取内容：未找到视频或图片 | ' + diag.join(' | ')
    }
  } catch (e: any) {
    result.error = e.message || String(e)
  } finally {
    webView.dispose()
  }

  return result
}

// ─── Instagram ─────────────────────────────────────────
async function parseInstagram(url: string): Promise<MediaResult> {
  const result: MediaResult = { success: false, error: '' }
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  result.platform = 'instagram'
  result.link = url

  // 归一化全角问号（Instagram 分享链接有时用 ？代替 ?）
  const normalizedUrl = url.replace(/\uff1f/g, '?')
  const shortcode = normalizedUrl.match(/(?:p|reel|reels|tv)\/([^/?]+)/)?.[1]
  if (!shortcode) { result.error = '无法提取 Instagram ID'; return result }

  // ── Strategy 1: GraphQL API (无需 WebView) ──────────────
  async function graphQLStrategy(): Promise<MediaResult | null> {
    try {
      // 1) 先访问主页获取 csrftoken
      const homeResp = await fetch('https://www.instagram.com/', {
        headers: { 'User-Agent': UA, 'Accept': '*/*' },
        timeout: 15,
      })
      let csrfToken = ''
      // 从 set-cookie 提取 csrftoken
      const setCookie = homeResp.headers?.get?.('set-cookie') || ''
      const csrfMatch = setCookie.match(/csrftoken=([^;]+)/)
      if (csrfMatch) csrfToken = csrfMatch[1]

      // 2) GraphQL POST
      const variables = JSON.stringify({
        shortcode,
        __relay_internal__pv__PolarisAIGMMediaWebLabelEnabledrelayprovider: false,
      })
      const body = `variables=${encodeURIComponent(variables)}&doc_id=27128499623469141&server_timestamps=true`

      const gqlResp = await fetch('https://www.instagram.com/graphql/query', {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Accept': '*/*',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': 'https://www.instagram.com/',
          'x-csrftoken': csrfToken,
          'Cookie': 'csrftoken=' + csrfToken,
        } as Record<string, string>,
        body,
        timeout: 20,
      })
      if (!gqlResp.ok) return null
      const text = await gqlResp.text()
      let data: any
      try { data = JSON.parse(text) } catch { return null }

      const payload = data?.data || data
      if (!payload) return null

      // ── 统一媒体节点提取 ──
      // 将 v1 格式 (xdt_api__v1__media__shortcode__web_info) 规范化为标准格式
      function normalizeMediaNode(raw: any): any {
        if (!raw) return null
        if (raw.__typename || raw.display_url) return raw
        if (raw.media_type != null || raw.video_versions) {
          const isV1Video = raw.media_type === 2
          const isV1Sidecar = raw.media_type === 8
          const videoUrl = raw.video_versions?.[0]?.url || ''
          const imageUrl = raw.image_versions2?.candidates?.[0]?.url || ''
          const v1typename = isV1Video ? 'GraphVideo' : (isV1Sidecar ? 'GraphSidecar' : 'GraphImage')
          return {
            __typename: v1typename,
            video_url: videoUrl,
            display_url: imageUrl,
            is_video: isV1Video,
            edge_sidecar_to_children: isV1Sidecar ? {
              edges: (raw.carousel_media || []).map((item: any) => ({ node: normalizeMediaNode(item) }))
            } : undefined,
            owner: null,
            edge_media_to_caption: { edges: [] },
          }
        }
        if (raw.video_versions || raw.image_versions2) {
          const isV1Video = raw.media_type === 2
          const videoUrl = raw.video_versions?.[0]?.url || ''
          const imageUrl = raw.image_versions2?.candidates?.[0]?.url || raw.display_url || ''
          return {
            __typename: isV1Video ? 'GraphVideo' : 'GraphImage',
            video_url: videoUrl,
            display_url: imageUrl,
            is_video: isV1Video,
          }
        }
        return raw
      }

      let mediaData = payload.xdt_shortcode_media
      if (!mediaData && payload.xdt_api__v1__media__shortcode__web_info?.items?.[0]) {
        mediaData = normalizeMediaNode(payload.xdt_api__v1__media__shortcode__web_info.items[0])
      }

      if (!mediaData) return null

      const typename = mediaData.__typename || ''
      const isVideo = typename === 'XDTGraphVideo' || typename === 'GraphVideo'
      const isSidecar = typename === 'XDTGraphSidecar' || typename === 'GraphSidecar'

      result.title = mediaData.edge_media_to_caption?.edges?.[0]?.node?.text ||
                     mediaData.caption?.text || ''
      result.author = mediaData.owner?.username ||
                      mediaData.owner?.full_name ||
                      mediaData.user?.username || ''

      if (isSidecar) {
        const edges = mediaData.edge_sidecar_to_children?.edges || []
        const images: string[] = []
        for (const edge of edges) {
          const node = edge.node || edge
          const nodeIsVideo = node.is_video ||
            (node.__typename === 'XDTGraphVideo' || node.__typename === 'GraphVideo') ||
            !!(node.video_versions?.length || node.video_url)
          if (nodeIsVideo && (node.video_url || node.video_versions?.[0]?.url)) {
            result.video_url = node.video_url || node.video_versions?.[0]?.url
            result.cover_url = node.display_url || result.cover_url
          } else {
            const imgUrl = node.display_url || node.image_versions2?.candidates?.[0]?.url || ''
            if (imgUrl) images.push(imgUrl)
          }
        }
        if (images.length) result.images = images
        if (result.video_url) result.success = true
        if (!result.video_url && images.length) { result.success = true }
      } else if (isVideo) {
        result.video_url = mediaData.video_url ||
                           mediaData.video_versions?.[0]?.url || ''
        result.cover_url = mediaData.display_url ||
                           mediaData.image_versions2?.candidates?.[0]?.url ||
                           mediaData.thumbnail_src || ''
        if (result.video_url) result.success = true
      } else {
        const imgUrl = mediaData.display_url ||
                       mediaData.image_versions2?.candidates?.[0]?.url || ''
        if (imgUrl) result.images = [imgUrl]
        result.cover_url = imgUrl
        if (imgUrl) result.success = true
      }

      if (result.success) return result
    } catch (e) { /* fallback */ }
    return null
  }

  // 先试 GraphQL
  const gqlResult = await graphQLStrategy()
  if (gqlResult) return gqlResult

  // ── Strategy 2: WebView 兜底（JSON-LD + video + og meta） ──
  const webView = new WebViewController({ ephemeral: true })
  try {
    webView.setCustomUserAgent(UA)
    // 使用 ?l=1 参数绕过 Instagram 登录墙
    const igUrl = normalizedUrl.includes('?') ? normalizedUrl + '&l=1' : normalizedUrl + '?l=1'
    await webView.loadURL(igUrl)
    await webView.waitForLoad()
    await sleep(4000)  // 等待 React JS 渲染完成

    // 提取 video 元素（React 渲染后就有 currentSrc）
    const extracted = await webView.evaluateJavaScript<any>(`
      try {
        var result = {};

        // 1) video 元素 src（?l=1 模式 React 渲染后直接可用）
        var v = document.querySelector('video');
        if (v) {
          var src = v.currentSrc || v.src || '';
          if (src && src.indexOf('blob:') !== 0) result.videoUrl = src;
          if (v.poster) result.poster = v.poster;
        }

        // 4) og:image / og:title
        try { 
          var ogI = document.querySelector('meta[property="og:image"]');
          if (ogI) result.ogImage = ogI.content;
        } catch(e) {}
        try { 
          var ogT = document.querySelector('meta[property="og:title"]');
          if (ogT) result.ogTitle = ogT.content;
        } catch(e) {}

        // 5) document title
        result.documentTitle = document.title || '';

        // 6) 图片元素
        var imgs = [];
        var allImgs = document.querySelectorAll('img[src*="cdninstagram"],img[src*="fbcdn"]');
        for (var k=0; k<allImgs.length; k++) {
          var s = allImgs[k].src;
          if (s && s.indexOf('data:') !== 0) imgs.push(s);
        }
        result.images = imgs.slice(0, 10);

        // 7) performance 媒体资源（兜底）
        if (!result.videoUrl && !result.ogVideo && !result.videoSrc) {
          try {
            var perfEntries = performance.getEntriesByType('resource');
            for (var m=0; m<perfEntries.length; m++) {
              var name = perfEntries[m].name;
              if (name.indexOf('.mp4') > -1 || name.indexOf('/v/') > -1) {
                result.videoUrl = name;
                break;
              }
            }
          } catch(e) {}
        }

        return result;
      } catch(e) { return { error: e.message } }
    `)

    if (!extracted || extracted.error) {
      result.error = extracted?.error || 'WebView 提取失败'
      return result
    }

    // 视频 URL 优先级：JSON-LD contentUrl > og:video > video src > performance
    // Instagram 视频 URL 必须以 .mp4 结尾或包含 /v/ 路径，排除头像/缩略图
    function isInstagramVideoUrl(urlStr: string): boolean {
      return !!urlStr && !urlStr.startsWith('blob:') && (
        urlStr.includes('.mp4') ||
        (/cdninstagram/.test(urlStr) && urlStr.includes('/v/')) ||
        (/fbcdn/.test(urlStr) && urlStr.includes('video'))
      )
    }

    const videoCandidates: string[] = [extracted.videoUrl, extracted.ogVideo, extracted.videoSrc].filter(Boolean) as string[]
    const videoUrl = videoCandidates.find(isInstagramVideoUrl) || ''
    if (videoUrl) {
      result.video_url = videoUrl
      result.success = true
      result.cover_url = result.cover_url || extracted.thumbnailUrl || 
                          extracted.poster || extracted.ogImage || ''
    }

    // 标题
    if (!result.title) {
      result.title = extracted.ogTitle || extracted.documentTitle || ''
    }

    // 图片（仅当没有视频时）
    if (extracted.images?.length && !result.video_url) {
      result.images = extracted.images.map(function(u: any) { return u.replace(/\?.*$/, '') })
      result.success = true
    }

  } finally {
    webView.dispose()
  }

  if (!result.success && !result.error) result.error = '无法从 Instagram 提取内容'
  return result
}

// ─── Bilibili WBI 签名 ───────────────────────────────
// WBI 签名表
const MIXIN_KEY_ENC_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52]

let cachedImgKey = ''
let cachedSubKey = ''
let cachedMixinKey = ''

// WBI 签名使用内置 MD5
function md5hex(content: string): string {
  const data = Data.fromString(content)
  if (!data) return ''
  return Crypto.md5(data).toHexString()
}

function getMixinKey(imgKey: string, subKey: string): string {
  const orig = imgKey + subKey
  let result = ''
  for (let i = 0; i < 32; i++) { result += orig[MIXIN_KEY_ENC_TAB[i]] }
  return result
}

async function ensureWbiKeys(): Promise<void> {
  if (cachedMixinKey) return
  try {
    const navUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
    const resp = await fetch('https://api.bilibili.com/x/web-interface/nav', { headers: { 'User-Agent': navUA }, timeout: 8 })
    const data = await resp.json()
    const imgUrl: string = data?.data?.wbi_img?.img_url || ''
    const subUrl: string = data?.data?.wbi_img?.sub_url || ''
    cachedImgKey = imgUrl.split('/').pop()?.split('.')[0] || ''
    cachedSubKey = subUrl.split('/').pop()?.split('.')[0] || ''
    cachedMixinKey = getMixinKey(cachedImgKey, cachedSubKey)
    console.log('[B站] WBI keys loaded:', cachedImgKey.slice(0,8), cachedSubKey.slice(0,8))
  } catch (e) { console.log('[B站] WBI key fetch failed:', e) }
}

function wbiSign(params: Record<string, string>): Record<string, string> {
  const wts = Math.floor(Date.now() / 1000).toString()
  const filtered: Record<string, string> = { wts }
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string') filtered[k] = v.replace(/[!'()*]/g, '')
    else filtered[k] = String(v).replace(/[!'()*]/g, '')
  }
  const keys = Object.keys(filtered).sort()
  const query = keys.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(filtered[k])}`).join('&')
  const wRid = md5hex(query + cachedMixinKey)
  filtered['w_rid'] = wRid
  filtered['wts'] = wts
  return filtered
}

// ─── Bilibili ──────────────────────────────────────────
async function parseBilibili(url: string): Promise<MediaResult> {
  const result: MediaResult = { success: false, error: '' }
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15'
  const REFERER = 'https://www.bilibili.com/'
  result.platform = 'bilibili'
  result.link = url

  // 加载用户配置的 Cookie（用于 1080p 画质）
  let bilibiliCookie = ''
  let bilibiliLoginStatus = ''
  try {
    const config = await loadCookies()
    const rawCookie = config.bilibili || ''
    if (rawCookie.trim()) {
      // 始终使用用户配置的 Cookie，用于 playurl API
      bilibiliCookie = rawCookie
      // 验证有效性仅用于 UI 显示
      try {
        const navResp = await fetch('https://api.bilibili.com/x/web-interface/nav', {
          headers: { 'User-Agent': UA, 'Cookie': rawCookie },
          timeout: 8
        })
        const navData = await navResp.json()
        if (navData?.data?.isLogin) {
          bilibiliLoginStatus = '✅ 已登录'
        } else {
          bilibiliLoginStatus = '⚠️ Cookie 可能已失效'
        }
      } catch {
        bilibiliLoginStatus = '⚠️ 验证超时'
      }
    }
  } catch {}

  let bvid = url.match(/\/video\/(BV[\w]+)/i)?.[1]
  // b23.tv 短链解析
  if (url.match(/b23\.tv/i) && !bvid) {
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': UA } })
      const html = await resp.text()
      bvid = html.match(/\/video\/(BV[\w]+)/i)?.[1]
    } catch {}
  }
  if (!bvid) { result.error = '无法提取BV号'; return result }

  // 尝试 B 站 API，支持 BV 转 aid
  async function getBilibiliVideo(bvid: string, aid?: string): Promise<boolean> {
    // 视频信息 API
    const infoUrl = aid
      ? `https://api.bilibili.com/x/web-interface/view?aid=${aid}`
      : `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`
    const viewResp = await fetch(infoUrl, {
      headers: { 'User-Agent': UA, 'Referer': REFERER, ...(bilibiliCookie ? { 'Cookie': bilibiliCookie } : {}) },
      timeout: 10
    })
    const viewData = await viewResp.json()
    if (viewData.code !== 0) return false

    result.title = viewData.data.title || ''
    result.author = viewData.data.owner?.name || ''
    result.cover_url = viewData.data.pic || ''
    const cid = viewData.data.cid
    const aidResolved = viewData.data.aid
    if (!cid || !aidResolved) return false

    // B站 playurl — WBI 签名 + 多级画质 fallback
    const cookie = bilibiliCookie || ''
    const playurlHeaders = { 'User-Agent': UA, 'Referer': `https://www.bilibili.com/video/${bvid}/`, ...(cookie ? { 'Cookie': cookie } : {}) }
    
    // 确保 WBI keys 已加载
    await ensureWbiKeys()
    
    // 尝试 DASH 高画质（WBI 签名）
    try {
      const signed1 = wbiSign({ avid: aidResolved, cid: cid, qn: '80', fnval: '4048', fnver: '0', fourk: '1' })
      const params1 = Object.entries(signed1).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&')
      const dashUrl = `https://api.bilibili.com/x/player/playurl?${params1}`
      const playResp = await fetch(dashUrl, { headers: playurlHeaders, timeout: 10 })
      const playData = await playResp.json()
      console.log('[B站] playurl code:', playData.code, 'msg:', playData.message || '', 'durl:', playData.data?.durl?.length || 0, 'dash.video:', playData.data?.dash?.video?.length || 0)
      if (playData.code !== 0) {
        console.log('[B站] playurl failed:', JSON.stringify(playData).slice(0, 200))
      }
      if (playData.code === 0) {
        const dash = playData.data?.dash
        const durl = playData.data?.durl
        
        // 取 DASH 最高画质视频（按 id 降序排序，取第一个）
        let dashVideoUrl = ''
        let dashVideoQuality = 0
        if (dash?.video?.length) {
          const sorted = [...dash.video].sort((a, b) => (b.id || 0) - (a.id || 0))
          const dv = sorted[0]
          dashVideoUrl = dv.baseUrl || dv.backup_url?.[0] || ''
          dashVideoQuality = dv.id || 0
          console.log('[B站] DASH tracks:', sorted.map(v => v.id).join(','), '→ 选择:', dv.id, dv.codecs || '')
        }
        
        if (durl?.length) {
          const durlQuality = durl[0].quality || 0
          console.log('[B站] durl 画质:', durlQuality)
          result.success = true
          if (cookie && dashVideoUrl && dashVideoQuality > durlQuality) {
            result.video_url = dashVideoUrl
            result.videoUrls = [durl[0].url]
          } else {
            result.video_url = durl[0].url
            if (dashVideoUrl) result.videoUrls = [dashVideoUrl]
          }
          return true
        }
        
        if (dashVideoUrl) {
          result.video_url = dashVideoUrl
          result.success = true
          // MP4 1080p 兜底（也加 WBI 签名）
          try {
            const signed2 = wbiSign({ avid: aidResolved, cid: cid, qn: '80', fnval: '1', fnver: '0' })
            const params2 = Object.entries(signed2).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&')
            const mp4Resp = await fetch(`https://api.bilibili.com/x/player/playurl?${params2}`, { headers: playurlHeaders, timeout: 10 })
            const mp4Data = await mp4Resp.json()
            const mp4Durl = mp4Data.data?.durl
            if (mp4Durl?.length && mp4Durl[0].url) {
              result.videoUrls = [mp4Durl[0].url]
            }
          } catch {}
          return true
        }
      }
    } catch {}
    return false
  }

  try {
    if (await getBilibiliVideo(bvid)) return result

    // WebView 兜底
    const webView = new WebViewController({ ephemeral: true })
    try {
      webView.setCustomUserAgent(UA)
      await webView.loadURL(`https://www.bilibili.com/video/${bvid}/`)
      await webView.waitForLoad()
      await sleep(3000)

      await webView.evaluateJavaScript(`
        (() => {
          var v = document.querySelector('video')
          if (v) { v.muted=true; v.play().catch(function(){}) }
        })()
      `)
      await sleep(2000)

      const extracted = await webView.evaluateJavaScript<any>(`
        try {
          var v = document.querySelector('video source[src]')
          if (!v) v = document.querySelector('video[src]')
          if (v && v.src && !v.src.startsWith('blob:')) return { video_url: v.src }
          if (window.__playinfo__) {
            var pi = window.__playinfo__
            var durl = pi.data?.durl || pi.durl || []
            if (durl.length) return { video_url: durl[0].url || durl[0].backup_url?.[0] }
            var dash = pi.data?.dash || pi.dash
            if (dash) {
              var vidArr = dash.video || []
              if (vidArr.length) return { video_url: vidArr[vidArr.length-1].baseUrl }
            }
          }
        } catch(e) {}
        return null
      `)

      if (extracted?.video_url) {
        result.video_url = extracted.video_url; result.success = true
      }
    } finally {
      webView.dispose()
    }

    if (!result.success) result.error = '无法获取B站视频播放地址'
  } catch (e: any) { result.error = e.message || String(e) }
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
async function parseKuaishou(url: string): Promise<MediaResult> {
  const result: MediaResult = { success: false, error: '', platform: 'kuaishou', link: url }
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'

  try {
    // Resolve short links
    let targetUrl = url
    if (url.match(/v\.kuaishou\.com/i)) {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': UA }, timeout: 15 })
        const finalUrl = r.url || ''
        if (finalUrl && finalUrl !== url) targetUrl = finalUrl
      } catch {}
    }

    // Extract photoId
    let photoId = ''
    const pm = targetUrl.match(/\/(short-video|photo|fw\/photo)\/([\w-]+)/)
    if (pm) photoId = pm[2]
    else photoId = targetUrl.split('/').pop()?.split('?')[0] || ''
    if (!photoId) { result.error = '无法提取快手视频ID'; return result }

    // Strategy 1: GraphQL API
    try {
      const resp = await fetch('https://www.kuaishou.com/graphql', {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Content-Type': 'application/json',
          'Referer': 'https://www.kuaishou.com/',
        },
        body: JSON.stringify({
          operationName: 'visionVideoDetail',
          variables: { photoId, page: 'search' },
          query: `query visionVideoDetail($photoId:String,$type:String,$page:String,$webPageArea:String){
            visionVideoDetail(photoId:$photoId,type:$type,page:$page,webPageArea:$webPageArea){
              status
              author{id name}
              photo{id duration caption coverUrl manifestH265 videoResource}
            }
          }`,
        }),
        timeout: 15,
      })
      const gqlData = await resp.json()
      const photo = gqlData.data?.visionVideoDetail?.photo
      if (photo) {
        result.title = photo.caption || ''
        result.author = gqlData.data.visionVideoDetail.author?.name || ''
        result.cover_url = photo.coverUrl || null

        let vr: any = photo.manifestH265
        if (typeof vr === 'string') { try { vr = JSON.parse(vr) } catch { vr = null } }
        if (!vr) {
          let vrRaw: any = photo.videoResource
          if (typeof vrRaw === 'string') { try { vrRaw = JSON.parse(vrRaw) } catch { vrRaw = null } }
          vr = vrRaw?.h264
        }
        const repUrl: string | undefined = vr?.adaptationSet?.[0]?.representation?.[0]?.url
        if (repUrl) { result.video_url = repUrl; result.success = true; return result }
      }
    } catch {}

    // Strategy 2: WebView fallback
    const webView = new WebViewController({ ephemeral: true })
    try {
      webView.setCustomUserAgent(UA)
      await webView.loadURL(targetUrl)
      await webView.waitForLoad()
      await sleep(4000)

      const extracted = await webView.evaluateJavaScript<any>(`
        try {
          var v = document.querySelector('video source[src]')
          if (!v) v = document.querySelector('video[src]')
          if (v && v.src && !v.src.startsWith('blob:')) return { video_url: v.src }
          var scripts = document.querySelectorAll('script')
          for (var s of scripts) {
            var t = s.textContent || ''
            var m = t.match(/"playUrl"\\s*:\\s*"(https?:\\/\\/[^"]+\\.mp4[^"]*)"/)
            if (m) return { video_url: m[1].replace(/\\\\u002F/g, '/') }
          }
        } catch(e) {}
        return null
      `)

      if (extracted?.video_url) { result.video_url = extracted.video_url; result.success = true }
    } finally { webView.dispose() }

    if (!result.success) result.error = '无法获取快手视频播放地址'
  } catch (e: any) { result.error = e.message || String(e) }
  return result
}

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

async function saveVideoToPhotos(
  videoUrl: string,
  title?: string,
  link?: string,
  platform?: string,
  videoId?: string,
  videoUrls?: string[],
  videoUri?: string): Promise<{ msg: string; bytes: number; path?: string }> {
  let downloadedBytes = 0
  // 构建多候选下载列表（抖音走多候选，其他平台走单 URL）
  interface Candidate { url: string; headers: Record<string, string>; label: string }
  const candidates: Candidate[] = []

  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

  // 加载平台 Cookie（用于 CDN 下载）
  let platformCookie = ''
  if (platform) {
    try {
      const config = await loadCookies()
      platformCookie = ((config as any)[platform] || '').trim()
    } catch {}
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
  let lastError = '所有下载候选均失败'
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
      if (effectiveReferer && platform !== 'instagram') headers['Referer'] = effectiveReferer
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
    bilibili: ""
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
  instagram: '📸', bilibili: '📺'
}

const PLATFORM_SYSTEM_ICON: Record<string, string> = {
  douyin: 'play.circle.fill',
  twitter: 'at.circle.fill',
  xiaohongshu: 'book.closed.fill',
  instagram: 'camera.fill',
  bilibili: 'play.tv.fill',
}

const PLATFORM_TINT: Record<string, string> = {
  douyin: 'label',
  twitter: 'label',
  xiaohongshu: 'systemRed',
  instagram: 'systemPink',
  bilibili: 'systemBlue',
}

const PLATFORM_NAME: Record<string, string> = {
  douyin: '抖音', twitter: 'Twitter/X', xiaohongshu: '小红书',
  instagram: 'Instagram', bilibili: 'Bilibili'
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
      const videoResult = await saveVideoToPhotos(r.video_url, r.title, r.link, r.platform, r.videoId, r.videoUrls, r.videoUri)
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

function FloatingAddButton(props: {
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <VStack
      padding={{ trailing: 18, bottom: 72 }}
      frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "bottomTrailing" as any }}
    >
      <Button action={props.onPress} disabled={props.disabled} frame={{ width: 58, height: 58 }} glassEffect>
        <Image systemName="plus" foregroundStyle="label" frame={{ width: 26, height: 26 }} />
      </Button>
    </VStack>
  )
}

function HistoryRow(props: {
  item: HistoryRecord
  onRefresh: () => Promise<void>
  onStatus: (text: string) => void
}) {
  const { item, onRefresh, onStatus } = props

  const openActions = async () => {
    const fileExists = !!item.localFilePath
    const result = await Dialog.actionSheet({
      title: item.title || "(无标题)",
      message: `${formatDate(item.createdAt)} · ${historyMediaSummary(item)}${item.saveSummary ? `\n${item.saveSummary}` : ''}`,
      actions: [
        { label: "分享文件" },
        { label: "保存到相册" },
        { label: "打开原始页面" },
        { label: "复制原始链接" },
        { label: "删除记录", destructive: true },
      ],
      cancelButton: true,
    })

    if (result == null) return

    try {
      if (result === 0) {
        if (!item.localFilePath) throw new Error("本地文件不存在")
        await ShareSheet.present([item.localFilePath])
        onStatus("已打开分享面板。")
        return
      }
      if (result === 1) {
        if (!item.localFilePath) throw new Error("本地文件不存在")
        await Photos.saveVideo(item.localFilePath)
        onStatus("已保存到相册。")
        return
      }
      if (result === 2) {
        await openURL(item.pageURL)
        return
      }
      if (result === 3) {
        await Pasteboard.setString(item.pageURL)
        onStatus("已复制原始链接到剪贴板。")
        return
      }
      if (result === 4) {
        await deleteHistory(item.id)
        await onRefresh()
        onStatus("已删除记录。")
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
        frame={{ width: 56, height: 56, alignment: "center" as any }}
        clipShape={{ type: "rect", cornerRadius: 8 }}
        background={{ style: "tertiarySystemFill", shape: { type: "rect", cornerRadius: 8 } }}
      >
        <Text font="title2">{item.icon || "🔗"}</Text>
      </VStack>
      <VStack alignment="leading" spacing={5} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
        <Text font="headline" lineLimit={2}>{item.title || "(无标题)"}</Text>
        <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{historyMediaSummary(item)}</Text>
        <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{item.pageURL}</Text>
        <HStack>
          <Text font="caption2" foregroundStyle="secondaryLabel">{PLATFORM_NAME[item.platform] || item.platform}</Text>
          <Spacer />
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
  dismiss: () => void
}) {
  const { history, onRefresh, onClear, onStatus, dismiss } = props

  return (
    <NavigationStack>
      <List
        navigationTitle="历史记录"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={dismiss} />,
          topBarTrailing: <Button title="刷新" action={() => void onRefresh()} />,
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
              <Image imageUrl={item.thumbnailUrl} scaleToFit={true} frame={{ width: 128, height: 128 }} />
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
          <Image
            imageUrl={item.thumbnailUrl}
            scaleToFit
            frame={{ width: 88, height: 88 }}
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
  dismiss: () => void
}) {
  const {
    inputURL, parsedResult, mediaItems, selectedMediaIds, loading,
    downloadLogs, downloadProgress, status, logProxyRef,
    onToggleMedia, onSelectAll, onClearSelection, onDownloadSelected, onStopTask, dismiss,
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
        <Section header={<Text>当前链接</Text>}>
          {inputURL ? (
            <Text lineLimit={3}>{inputURL}</Text>
          ) : (
            <Text foregroundStyle="secondaryLabel">点击右下角 + 读取剪贴板链接并解析。</Text>
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

        <Section header={<Text>状态</Text>}>
          {loading ? (
            <VStack alignment="leading" spacing={8}>
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
            <Text foregroundStyle="secondaryLabel">{status}</Text>
          )}
        </Section>

        <Section header={<Text>日志</Text>}>
          <ScrollViewReader>
            {(proxy: any) => {
              logProxyRef.current = proxy
              return (
                <ScrollView frame={{ maxWidth: "infinity", height: 220 }}>
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
  ["twitter", "Twitter/X"],
  ["bilibili", "Bilibili"],
]

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
  return `已配置 ${trimmed.length} 字符。该平台暂未提供在线检测，只做格式保存。`
}

function CookieSettingsRow(props: {
  platform: string
  name: string
  hasCookie: boolean
  cookieLen: number
  onEdit: () => void
  onClear: () => void
  onTest: () => void
}) {
  return (
    <HStack spacing={12} alignment="center">
      <PlatformGlyph platform={props.platform} />
      <VStack spacing={3} alignment="leading" frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
        <Text font="subheadline" fontWeight="medium">{props.name}</Text>
        <Text font="caption" foregroundStyle={props.hasCookie ? "systemGreen" : "secondaryLabel"}>
          {props.hasCookie ? `已配置 · ${props.cookieLen} 字符` : "未配置"}
        </Text>
      </VStack>
      {props.hasCookie ? (
        <Button action={props.onTest} frame={{ width: 34, height: 34 }}>
          <Image systemName="checkmark.shield" foregroundStyle="systemGreen" frame={{ width: 18, height: 18 }} />
        </Button>
      ) : null}
      {props.hasCookie ? (
        <Button action={props.onClear} role="destructive" frame={{ width: 34, height: 34 }}>
          <Image systemName="trash" foregroundStyle="systemRed" frame={{ width: 17, height: 17 }} />
        </Button>
      ) : null}
      <Button action={props.onEdit} frame={{ width: 34, height: 34 }}>
        <Image systemName={props.hasCookie ? "pencil" : "plus.circle"} foregroundStyle="systemBlue" frame={{ width: 18, height: 18 }} />
      </Button>
    </HStack>
  )
}

function SettingsPage(props: {
  saveMode: "ask" | "photos"
  onSaveModeChange: (mode: "ask" | "photos") => void
  cookies: CookieConfig
  onCookiesChange: (config: CookieConfig) => void
  dismiss: () => void
}) {
  const { saveMode, onSaveModeChange, cookies, onCookiesChange, dismiss } = props

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
          header={<Text>平台 Cookie</Text>}
          footer={<Text font="caption" foregroundStyle="secondaryLabel">Cookie 只用于提升解析成功率和画质。未配置时仍会使用基础解析。</Text>}
        >
          {COOKIE_PLATFORM_KEYS.map(([key, name]) => {
            const hasCookie = !!((cookies as any)[key] || "").trim()
            const cookieLen = ((cookies as any)[key] || "").trim().length
            return (
              <CookieSettingsRow
                key={key}
                platform={key}
                name={name}
                hasCookie={hasCookie}
                cookieLen={cookieLen}
                onEdit={() => { void editCookie(key) }}
                onClear={() => { void clearCookie(key) }}
                onTest={() => { void testCookie(key) }}
              />
            )
          })}
        </Section>

        <Section header={<Text>支持的平台</Text>}>
          <VStack alignment="leading" spacing={10} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
            <HStack spacing={10}>
              {Object.entries(PLATFORM_NAME).slice(0, 3).map(([k, v]) => (
                <HStack key={k} spacing={7} alignment="center">
                  <PlatformGlyph platform={k} size={28} />
                  <Text font="caption" foregroundStyle="secondaryLabel">{v}</Text>
                </HStack>
              ))}
            </HStack>
            <HStack spacing={10}>
              {Object.entries(PLATFORM_NAME).slice(3).map(([k, v]) => (
                <HStack key={k} spacing={7} alignment="center">
                  <PlatformGlyph platform={k} size={28} />
                  <Text font="caption" foregroundStyle="secondaryLabel">{v}</Text>
                </HStack>
              ))}
            </HStack>
          </VStack>
        </Section>
      </List>
    </NavigationStack>
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
  const [saveMode, setSaveMode] = useState<"ask" | "photos">("ask")
  const [cookies, setCookies] = useState<CookieConfig>({
    xiaohongshu: "", douyin: "", twitter: "", instagram: "",
    bilibili: ""
  })

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
  }, [])

  const downloadFromClipboard = async () => {
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
    setDownloadProgress({ fraction: 0, stage: "已停止" })
    setStatus("已停止当前任务。")
    appendLog("任务已停止。")
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
        const result = await saveVideoToPhotos(videoItem.url, parsedResult.title, parsedResult.link, platform, parsedResult.videoId, parsedResult.videoUrls, parsedResult.videoUri)
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
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <TabView
        selection={activeTab as any}
        tint="systemPink"
        tabViewStyle="sidebarAdaptable"
        tabBarMinimizeBehavior="onScrollDown"
      >
        <Tab title="历史记录" systemImage="clock.arrow.circlepath" value={HISTORY_TAB}>
          <HistoryPage
            history={history}
            onRefresh={refreshHistory}
            onClear={handleClearHistory}
            onStatus={setStatus}
            dismiss={dismiss}
          />
        </Tab>

        <Tab title="下载" systemImage="arrow.down.circle.fill" value={DOWNLOAD_TAB}>
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
            dismiss={dismiss}
          />
        </Tab>

        <Tab title="设置" systemImage="gearshape.fill" value={SETTINGS_TAB}>
          <SettingsPage
            saveMode={saveMode}
            onSaveModeChange={setSaveMode}
            cookies={cookies}
            onCookiesChange={setCookies}
            dismiss={dismiss}
          />
        </Tab>
      </TabView>
      <FloatingAddButton
        disabled={loading}
        onPress={() => void downloadFromClipboard()}
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
