# AI 角色扮演 - iOS 26 玻璃质感聊天界面

[安装 Scripting App](https://apps.apple.com/app/apple-store/id6479691128) · [一键导入当前脚本](https://scripting.fun/import_scripts?urls=%5B%22https%3A%2F%2Fgithub.com%2F7452323%2FScripting-Script-Library%2Ftree%2Fmain%2FScripting%2FScripts%2F%E8%A7%92%E8%89%B2%E6%89%AE%E6%BC%94%22%5D)

## 需求概述
- iOS 26 原生玻璃质感设计，深色/浅色自动切换
- 使用 `Assistant.startConversation` 做角色扮演聊天
- 3 个预设角色：傲娇女仆、腹黑学姐、温柔青梅
- 角色卡独立 TS 文件管理

## 实现计划

### 1. characters.ts - 角色数据
- 3 个角色数据：id、name、description、systemPrompt、emoji、accentColor

### 2. index.tsx - 主界面
- 玻璃质感角色选择卡片
- 深色/浅色自适应渐变背景
- 选择角色 → Assistant.startConversation → present

### 3. 测试验证
- 检查 TypeScript 诊断
- 运行测试