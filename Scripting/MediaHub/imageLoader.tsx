import { Image, fetch, useEffect, useState } from "scripting"

/**
 * 远程图片：Scripting 的 <Image imageUrl> 在当前运行时不出图（实测 5s 仍空白），
 * 所以自己 fetch 字节 → 落临时文件 → UIImage.fromFile，再用 <Image image> 渲染。
 */
const imageCache = new Map<string, UIImage>()

function hashKey(value: string): string {
  let h = 5381
  for (let i = 0; i < value.length; i++) h = ((h << 5) + h + value.charCodeAt(i)) | 0
  return `${h >>> 0}_${value.length}`
}

export function useRemoteImage(url?: string): UIImage | null {
  const [image, setImage] = useState<UIImage | null>(() =>
    url ? imageCache.get(url) ?? null : null
  )

  useEffect(() => {
    if (!url) {
      setImage(null)
      return
    }

    const cached = imageCache.get(url)
    if (cached) {
      setImage(cached)
      return
    }

    let alive = true
    ;(async () => {
      try {
        const res = await fetch(url, { timeout: 20 })
        if (!res.ok) return
        const bytes = await res.bytes()
        if (!bytes || bytes.length === 0) return

        const path = `${FileManager.temporaryDirectory}/mediahub_img_${hashKey(url)}`
        FileManager.writeAsBytesSync(path, bytes)
        const decoded = UIImage.fromFile(path)
        if (!decoded) return

        imageCache.set(url, decoded)
        if (alive) setImage(decoded)
      } catch {}
    })()

    return () => {
      alive = false
    }
  }, [url])

  return image
}

export function RemoteImage({
  url,
  width,
  height,
  radius,
}: {
  url?: string
  width?: number
  height?: number
  radius?: number
}) {
  const image = useRemoteImage(url)
  if (!image) return null

  // 直接在 Image 上裁剪：不依赖父容器 clipShape，圆角一定生效
  return (
    <Image
      image={image}
      resizable
      scaleToFill={true}
      frame=
        {width && height
          ? { width, height }
          : { maxWidth: "infinity", maxHeight: "infinity" }}
      clipShape={
        radius
          ? { type: "rect", cornerRadius: radius, style: "continuous" }
          : undefined
      }
    />
  )
}
