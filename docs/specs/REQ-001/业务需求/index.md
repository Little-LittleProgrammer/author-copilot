# 需求-mvp

## 概览

### 需求

1. 这是一款面向全球作者、小说家、编剧和长篇内容创作者的 AI 超级工作站，它将灵感捕捉、故事规划、正文写作、修改润色和创作知识管理整合到同一个工作空间中，帮助作者把零散的想法逐步转化为结构清晰、可持续推进的作品。

### 架构

1. 需要支持多语言 i18n
2. 需要支持多主题 dark/light
3. 内置 Git 运行时，不依赖用户预装 Git，详见 [Git 方案](./sub/git.md)
4. 使用 Git 对书籍、小说等创作项目进行版本管理
5. Windows 端内置 Git Bash 用于经验证的运行流程；Agent Shell 的开放以实际沙箱隔离能力为前提，不把 Git Bash 当作文件权限边界。
6. 建立账号全局工作区和单部作品工作区，两级均有 `.claude`，分别维护全局与本书 Skill。
7. 首页全局 AI 助手服务当前账号，支持全局问题、查询某书剧情、比较多部作品关联；作品助手的文件访问限定当前作品。
8. 大纲与创作资产的读取、维护及写作技巧以 Skill 组织；作品正文、专属 Skill 和资产保存在作品目录，界面与技能使用同一份资产。
9. 目标采用 Claude 原生工具，通过 Settings、Hooks 与必要的 Shell 沙箱约束访问；权限配置由应用保护。已实现首版（全局助手只读，Shell 关闭），不要求旧作品迁移，详见[工作区与 Skill 规范](../../ai-workspaces-and-skills.md)。

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
