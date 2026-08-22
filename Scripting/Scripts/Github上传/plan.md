# Github上传 - Upload Files to GitHub

## 项目状态

- [x] 编写 `index.tsx` — GitHub 文件上传完整脚本
- [x] 同名文件自动检测并用 SHA 更新（进度显示 🆕 新建 / 🔄 更新）

## 项目结构

```
Github上传/
├── index.tsx     # 主脚本 — GitHub 文件上传设置界面
├── script.json   # 项目配置
└── plan.md       # 本文件
```

## 功能说明

使用脚本内置的 `GitHub` API（无需手动配 Token 以外的操作）将文件上传到 GitHub 仓库。

### 使用条件
- 需 Scripting PRO
- 需在「设置 → GitHub」中配置 Personal Access Token
- 需要授予 `read_profile`、`read_repos`、`write_contents` 权限

### index.tsx 功能

1. **仓库配置**：填写 Owner、Repo、Branch（默认 main）、上传路径
2. **提交信息**：自定义 Commit Message
3. **文件选择**：支持多选文件，或通过目录 Bookmark 选择整个文件夹
4. **递归读取**：手动递归所有子目录，保留相对路径和目录结构
5. **文件管理**：显示相对路径和大小，自动去重，可单个移除或清除全部
6. **上传**：自动检测文件是否存在（存在则更新），逐文件上传并显示进度
7. **链接复制**：成功后自动复制 GitHub 文件夹链接
8. **上传历史**：保存最近 50 条记录，可清空
9. **设置持久化**：仓库配置和提交信息自动保存

### 技术要点
- `GitHub` API 为全局命名空间，无需 import
- `alert()` 为全局函数
- `Storage` 持久化配置和历史记录
- 使用 Scripting.app 标准 UI 组件（NavigationStack + List + Section）
