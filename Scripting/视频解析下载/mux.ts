/**
 * 音视频合轨工具
 *
 * 背景：B 站高画质是 **DASH 音视频分离**（video.m4s + audio.m4s），只下视频轨就会「没声音」。
 * 这里把两条轨合成一个带声音的 mp4：
 *
 *  ① **首选 ffmpeg `-c copy`**（无损、秒级）：Scripting 脚本里可以直接 `Shell.run`，
 *     实测设备自带 `ffmpeg n5.0.1`（`--enable-videotoolbox --disable-gpl`），
 *     所以不用重编码就能把 DASH 两条轨 remux 成一个 mp4。
 *  ② 兜底 `MediaComposer`（AVMutableComposition + AVAssetExportSession）：会重编码、慢，
 *     但能吃下 ffmpeg 不认的组合。⚠️ Scripting 里没有 `AVMutableComposition`，
 *     也没有 Passthrough 预设，所以这条路的本质是重新编码。
 */

export interface MuxResult {
  ok: boolean
  outPath: string
  duration: number
  /** 实际用了哪条路：ffmpeg / MediaComposer */
  via: string
  note: string
}

/** 用 ffmpeg 把纯视频轨 + 纯音频轨无损合成（`-c copy`） */
async function muxWithFfmpeg(videoPath: string, audioPath: string, outPath: string): Promise<{ ok: boolean; note: string }> {
  try {
    const cmd = [
      "ffmpeg -y -hide_banner -loglevel error",
      `-i "${videoPath}"`,
      `-i "${audioPath}"`,
      "-c copy -map 0:v:0 -map 1:a:0 -shortest",
      `"${outPath}"`,
    ].join(" ")
    const r = await Shell.run(cmd, { timeout: 600 })
    const exists = await FileManager.exists(outPath)
    if (r.exitCode === 0 && exists) return { ok: true, note: "ffmpeg -c copy（无损）" }
    return { ok: false, note: `ffmpeg 退出码 ${r.exitCode}${r.timedOut ? "（超时）" : ""}：${(r.output || "").slice(0, 200)}` }
  } catch (error) {
    return { ok: false, note: `ffmpeg 调用异常：${error instanceof Error ? error.message : String(error)}` }
  }
}

/** 兜底：MediaComposer 合成（会重编码） */
async function muxWithComposer(videoPath: string, audioPath: string, outPath: string): Promise<{ ok: boolean; note: string; duration: number }> {
  try {
    if (await FileManager.exists(outPath)) {
      try { await FileManager.remove(outPath) } catch {}
    }
    const result = await MediaComposer.composeAndExport({
      exportPath: outPath,
      timeline: {
        videoItems: [{ videoPath, keepOriginalAudio: false }],
        audioClips: [{ path: audioPath, volume: 1 }],
      },
      exportOptions: { presetName: "HighestQuality" },
      overwrite: true,
    })
    const duration = result?.duration?.getSeconds?.() || 0
    const exists = await FileManager.exists(outPath)
    return { ok: exists, note: exists ? "MediaComposer 重编码" : "合成后文件不存在", duration }
  } catch (error) {
    return { ok: false, note: `MediaComposer 失败：${error instanceof Error ? error.message : String(error)}`, duration: 0 }
  }
}

/** 把「纯视频轨」与「纯音频轨」合成为一个带声音的 mp4 */
export async function muxVideoAudio(videoPath: string, audioPath: string, outPath: string): Promise<MuxResult> {
  if (await FileManager.exists(outPath)) {
    try { await FileManager.remove(outPath) } catch {}
  }

  const fast = await muxWithFfmpeg(videoPath, audioPath, outPath)
  if (fast.ok) {
    return { ok: true, outPath, duration: await probeDuration(outPath), via: "ffmpeg", note: fast.note }
  }

  const slow = await muxWithComposer(videoPath, audioPath, outPath)
  if (slow.ok) {
    return { ok: true, outPath, duration: slow.duration || (await probeDuration(outPath)), via: "MediaComposer", note: `${fast.note} → 改用 ${slow.note}` }
  }

  return { ok: false, outPath, duration: 0, via: "none", note: `${fast.note}；${slow.note}` }
}

/** 用 ffprobe 读时长（失败返回 0） */
export async function probeDuration(path: string): Promise<number> {
  try {
    const r = await Shell.run(`ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${path}"`, { timeout: 60 })
    const value = parseFloat((r.output || "").trim())
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

/** 检查文件里是否有音频轨（用于自检 / 诊断） */
export async function hasAudioStream(path: string): Promise<boolean> {
  try {
    const r = await Shell.run(`ffprobe -v error -select_streams a -show_entries stream=codec_name -of default=nw=1:nk=1 "${path}"`, { timeout: 60 })
    return !!((r.output || "").trim())
  } catch {
    return false
  }
}

/** 删除临时文件（不抛错） */
export async function removeQuietly(path?: string | null): Promise<void> {
  if (!path) return
  try {
    if (await FileManager.exists(path)) await FileManager.remove(path)
  } catch {}
}
