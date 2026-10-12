# Github上传

把 iOS 本地文件（单个/多个文件，或整个文件夹）直接上传到 GitHub 仓库的 Scripting 脚本。

## 首次使用

1. 需要 **Scripting PRO**。
2. 在 App 的「设置 → GitHub」中配置 Personal Access Token，权限勾选：
   - `read_profile`
   - `read_repos`
   - `read_contents`
   - `write_contents`
3. 打开脚本 → 底部「设置」Tab → 在「仓库配置」的「仓库链接」里粘贴任意 GitHub 链接（如 `https://github.com/7452323/Scripting/main/Scripting`），Owner / Repo / 分支 / 仓库内路径会自动填好；也可以手动逐项填写。
4. 回到「主页」Tab → 「选择文件」或「选择文件夹」→ 「上传到 GitHub」。

## 功能

- **选择文件**：多选文件上传，保留文件名。
- **选择文件夹**：递归读取所有子目录，保留完整相对路径（目录结构原样传到仓库）。
- **自动新建 / 更新**：同名文件先查 SHA 再更新，不存在的文件新建，进度里标注 🆕/🔄。
- **上传路径**：仓库内路径 + 自动创建文件夹（可选）组合成最终目标路径。
- **链接复制**：上传成功后自动复制 GitHub 文件夹链接到剪贴板。
- **上传历史**：保留最近 50 条记录，成功项可点击在 Safari 打开 raw 链接。

## 注意事项

- 单文件需 ≤ 25MB（GitHub Contents API 限制）。
- 上传依赖网络，失败会在历史里标红并显示原因。
- 「选择文件夹」使用目录 Bookmark 授权，脚本关闭后需重新选择。

## 更新日志

### 1.2.0 — 2026-10-12
- 设置页「仓库配置」新增「仓库链接」输入框：粘贴 GitHub 链接即自动解析并填入 Owner / Repo / 分支 / 仓库内路径，并实时显示解析结果。
- 支持四类链接：
  - `https://github.com/owner/repo`
  - `https://github.com/owner/repo/tree|blob/分支/路径`
  - `https://github.com/owner/repo/分支/路径`（省略 `tree` 的简写，例如 `https://github.com/7452323/Scripting/main/Scripting`）
  - `https://raw.githubusercontent.com/owner/repo/分支/路径`
- 会跳过 `.git` 后缀、`?query`、尾部斜杠；`releases` / `issues` 等仓库页面路径不会被误当成分支。
- 授权新增 `read_contents`：上传前能正确读取远端文件列表，同名文件判定为 🔄 更新（之前权限不足时会全部当成 🆕 新建）。

### 1.1.0 — 2026-10-12
- 主页「选择文件」区域精简：只保留「选择文件」与「选择文件夹」两个操作。
- 删除「单个或多个文件」「整个文件夹」等冗余分组标题与重复说明文字。
- 「清除全部」移到已选文件列表末尾，仅在已有选中文件时出现。
- 修复 `alert(...)` 未定义的问题，统一改用全局 `Dialog.alert(...)`（原先上传完成等提示会直接抛错）。
- 修复顶部「关闭」按钮不显示：`Toolbar` 改为通过 `toolbar={...}` 挂在根视图上。

### 1.0.0
- 首个版本：文件/文件夹选择、递归读取、SHA 自动更新、进度显示、上传历史。
