# AI 角色扮演 - iOS 26 玻璃质感聊天界面

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
