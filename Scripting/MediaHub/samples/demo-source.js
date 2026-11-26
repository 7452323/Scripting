/**
 * MediaHub 脚本源示例
 * 在设置里添加脚本地址指向本文件的 raw URL，或任意返回相同结构的远程脚本。
 *
 * 约定：
 * function main(query) {
 *   return { list: [{ title, url, poster?, headers? }] }
 * }
 */

async function main(query) {
  // 示例：返回几条公开测试流（可按 query 过滤）
  const all = [
    {
      title: "Big Buck Bunny",
      url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
      poster: "https://peach.blender.org/wp-content/uploads/title_anouncement.jpg",
    },
    {
      title: "Elephant Dream",
      url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
    },
    {
      title: "Sintel",
      url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
    },
  ]

  const q = (query || "").trim().toLowerCase()
  const list = q ? all.filter(i => i.title.toLowerCase().includes(q)) : all
  return { list }
}
