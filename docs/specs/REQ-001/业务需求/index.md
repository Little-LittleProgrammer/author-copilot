# 需求-mvp

## 概览

### 需求

1. 这是一款面向全球作者、小说家、编剧和长篇内容创作者的 AI 超级工作站，它将灵感捕捉、故事规划、正文写作、修改润色和创作知识管理整合到同一个工作空间中，帮助作者把零散的想法逐步转化为结构清晰、可持续推进的作品。

### 架构

1. 需要支持多语言 i18n
2. 需要支持多主题 dark/light
3. 内置 Git 运行时，不依赖用户预装 Git，详见 [Git 方案](./sub/git.md)
4. 使用 Git 对书籍、小说等创作项目进行版本管理
5. Windows 端内置 Git Bash，供 Claude Agent SDK 使用

#### 技术栈

- 编程语言: typescript
- 架构: turborepo + pnpm
- 前端: react + electron
  - Ai Agent: Claude Agent SDk
- 后端 node.js + nestjs,后端只处理一下功能
  - LLM provider 的请求和响应，
  - 用户管理、权限管理、日志管理、监控管理等业务逻辑。
- 数据库 mongodb
- 缓存 redis
- 消息队列: MVP 不引入 RabbitMQ，Claude 请求使用同步链路
- 日志: 使用结构化日志并接入部署环境的日志采集，完整 ELK 不作为本地开发和 MVP 运行的强制依赖
- 安全 jwt
- 部署 docker compose
