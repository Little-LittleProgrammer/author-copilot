# Author Copilot MVP 产品与架构设计

- 日期：2026-07-12
- 状态：已批准
- 对应需求：REQ-001

## 1. 目标

Author Copilot MVP 是一款面向小说作者和编剧的本地优先桌面写作工作台。首版聚焦自由写作，不尝试一次实现完整的创作知识管理系统。

MVP 必须跑通以下闭环：

1. 新建小说或剧本项目，或者导入已有 Markdown 文件夹。
2. 在固定作品结构中导航并编辑 Markdown 正文。
3. 经用户确认后初始化全书 AI 检索索引。
4. 使用 Claude 对话并引用全书相关内容。
5. 让 AI 以提案模式或单次授权的 Agent 模式修改作品。
6. 在变更审阅中查看差异、保留修改或恢复任务前版本。
7. 使用应用内置 Git 管理作品版本，不依赖系统 Git。

## 2. 非目标

以下能力不属于 MVP：

- 人物档案、世界观、剧情线等结构化知识库。
- 自动生成并持续维护书籍记忆、大纲、时间线、角色图谱或人物故事。
- Fountain、专业剧本排版或剧本语义块。
- 作品云同步、跨设备同步、多人协作和冲突合并。
- Word 导入和 PDF、Word 等排版导出。
- Anthropic 以外的模型提供商。
- 服务端保存完整作品或 RAG 索引。

## 3. 产品边界

### 3.1 支持平台

- Windows x64 和 arm64。
- macOS x64 和 arm64。
- 界面支持 i18n，并提供 light 和 dark 主题。

### 3.2 AI 使用模式

桌面端提供两种模式，二者共用同一本地项目、索引和 Git 历史：

1. **登录托管模式**：用户登录 Author Copilot，桌面端经 NestJS 后端调用 Claude。后端负责身份、权限、配额和请求代理。
2. **免登录自带密钥模式**：用户提供 Anthropic API Key，桌面端直接调用 Anthropic。该模式无需业务账号，但调用模型时仍需要网络。

MVP 只支持 Claude。Anthropic API Key 保存在操作系统凭证库中。

## 4. 总体架构

系统采用本地优先的模块化 Electron 架构。

```text
React Renderer
  |
  | typed IPC through Preload
  v
Electron Main Process
  |- Project Service
  |- Git Service
  |- AI Orchestrator
  |- Knowledge Index
  |- Credential Service
  `- Policy and Audit
        |
        |- local project directory
        |- local application data
        |- bundled Git runtime
        |- Anthropic API, BYOK mode
        `- NestJS control plane, managed mode
```

### 4.1 pnpm 与 Turborepo 工作区

仓库使用 pnpm workspace 和 Turborepo。应用实现放在 `apps/`，只有跨应用共享或需要独立测试的稳定契约才放在 `packages/`，避免过早把桌面端内部模块拆成大量 workspace 包。

```text
author-copilot/
  apps/
    desktop/
      src/
        main/
          bootstrap/
          ipc/
          project/
          git/
          ai/
          knowledge/
          credentials/
          policy/
        preload/
        renderer/
          app/
          features/
            project/
            editor/
            assistant/
            change-review/
          components/
          i18n/
          themes/
      resources/
        git/
      electron-builder.yml
      package.json
    api/
      src/
        auth/
        users/
        entitlements/
        quota/
        claude-proxy/
        observability/
        common/
      package.json
  packages/
    contracts/
    project-schema/
    config-eslint/
    config-typescript/
    test-utils/
  tooling/
    scripts/
      fetch-git-runtime.ts
      verify-git-runtime.ts
      package-licenses.ts
    git-runtime-manifest.json
  infra/
    docker-compose.yml
    docker/
  docs/
  pnpm-workspace.yaml
  turbo.json
  package.json
  pnpm-lock.yaml
```

目录边界遵循以下规则：

- `apps/desktop/src/main` 实现本地能力，渲染进程不得直接引用其中模块。
- `apps/desktop/src/preload` 只负责类型化 IPC 桥接，不承载业务逻辑。
- `apps/desktop/src/renderer/features` 按用户能力组织界面，不按页面堆放全局状态。
- `apps/api` 是独立部署的 NestJS 控制面，不读取本地作品目录。
- `packages/contracts` 只包含 IPC、HTTP DTO、错误码和事件，不依赖 Electron 或 NestJS 实现。
- `packages/project-schema` 只定义项目元数据 schema、迁移和校验。
- Project、Git、AI 和 Knowledge 的实现先保留在桌面主进程；出现第二个真实消费者后再抽取 workspace 包。
- Git 二进制不提交仓库。打包任务根据 `git-runtime-manifest.json` 下载固定版本、校验 SHA-256，并复制到 ASAR 外的资源目录。
- 根 `package.json` 通过 `packageManager` 固定 pnpm 版本。Turbo 统一编排 `build`、`lint`、`typecheck`、`test` 和 `package`，各任务只声明真实的输入、输出和依赖。

### 4.2 React 渲染进程

渲染进程只负责界面状态和用户交互，包括作品结构树、Markdown 编辑器、AI 对话和变更审阅。它不能直接访问 Node.js、任意文件、Git、Shell 或凭证。

桌面窗口采用原生多视图结构：唯一的 `BrowserWindow` renderer 只承载登录态和 42px 标签栏；作家中心及每个打开的作品分别运行在独立 `WebContentsView` 中，由主进程通过 `BrowserWindow.contentView.addChildView()` 挂载。每个作品在标签关闭前保留自己的 View，切换标签只改变可见性，因此编辑器内存状态不会因切换而重建。作品内部的正文、AI 对话和变更审阅仍属于同一个作品 renderer 的 React 状态。

主进程 `TabManager` 是标签顺序、激活项、脏状态和 View 生命周期的唯一事实源。所有 renderer 加载同一个受信 URL，并根据发送方 `webContents.id` 通过类型化 IPC 获取 `shell`、`center` 或 `project` 上下文；renderer 不通过 URL 参数声明身份。关闭标签、退出登录和关闭窗口均由主进程检查脏状态，移除 View 后显式关闭对应 `webContents`。

### 4.3 Preload 与 IPC

Preload 通过 `contextBridge` 暴露按业务能力划分的类型化 API。IPC 不提供通用文件系统接口或 `exec(command)`，每个调用都校验来源、项目标识、授权路径和参数。

### 4.4 Electron 主进程模块

- **Project Service**：项目登记、模板创建、导入预览、结构映射和原子文件读写。
- **Tab Manager**：原生标签 View 的创建、去重、布局、激活、脏状态确认和销毁。
- **Git Service**：内置 Git 定位、仓库初始化、状态、差异、提交和 AI 任务回退点。
- **AI Orchestrator**：上下文组装、普通提案、Agent 任务、取消和结果归一化。
- **Knowledge Index**：全书初始化、内容切分、检索、索引状态和增量更新。
- **Credential Service**：操作系统凭证库读写，不向渲染进程返回明文密钥。
- **Policy and Audit**：项目路径授权、Agent 权限、日志脱敏和安全审计事件。

模块通过明确接口协作。具体 RAG 引擎或 Claude plugin 必须位于 `Knowledge Index` 接口之后，不能绕过项目授权、数据存储或日志规则。

### 4.5 NestJS 云端控制面

后端只处理登录托管模式需要的能力：

- 用户、身份认证、JWT 和权限。
- Claude 请求代理、套餐配额和速率限制。
- 脱敏后的业务日志、错误和监控指标。

MVP 使用 MongoDB 保存用户、权限和配额数据，使用 Redis 实现速率限制和短期配额状态。Claude 请求是同步链路，因此 MVP 不引入 RabbitMQ。日志采用结构化输出并接入部署环境的日志采集，完整 ELK 集群不作为本地开发和 MVP 运行的强制依赖。服务通过 Docker Compose 提供可复现部署。

## 5. 项目与文件模型

### 5.1 通用规则

一个作品对应一个普通文件夹。目录和文件名是作品结构的事实来源，不在数据库中维护一份可能与磁盘冲突的重复章节树。

项目根目录只增加一个最小元数据文件 `author-copilot.json`：

```json
{
  "schemaVersion": 1,
  "projectId": "stable-project-id",
  "title": "作品名称",
  "template": "novel",
  "createdAt": "2026-07-12T00:00:00.000Z"
}
```

`template` 只能是 `novel` 或 `screenplay`。API Key、账号信息、本机绝对路径、RAG 索引和临时对话缓存不得写入项目目录。

应用登记项目时必须检测 `projectId` 冲突。如果另一个路径已经登记了相同 ID，当前目录视为项目副本：用户确认后分配新 ID，并为它建立独立索引，不能复用原项目的本地缓存。

### 5.2 小说模板

小说固定使用“作品 -> 卷 -> 章 -> 场景”层级。卷和章是目录，场景是 Markdown 文件。

```text
长夜之后/
  author-copilot.json
  第一卷/
    第一章/
      01-抵达车站.md
      02-雨夜重逢.md
    第二章/
      01-正文.md
  第二卷/
```

不需要拆分多个场景的章节仍保留章目录，并使用单个 `01-正文.md` 文件。

### 5.3 剧本模板

剧本固定使用“作品 -> 幕 -> 场”层级。幕是目录，场是普通 Markdown 文件。MVP 不解释专业剧本语义，也不提供 Fountain 或标准剧本排版。

### 5.4 新建与导入

- 新建项目时选择小说或剧本模板，应用创建目录、元数据和 Git 仓库。
- 导入 Markdown 文件夹时先生成只读预览，不静默移动或改写原文件。
- 用户选择目标模板并确认目录到作品层级的映射。
- 无法识别的 Markdown 文件保留并归入“未分类”，不丢弃内容。
- 用户可以选择复制为新项目或就地登记。就地登记前必须展示将新增的元数据和 Git 文件。
- 导入目录已经包含 Git 仓库时直接复用，不重新初始化、不改写历史，也不自动提交导入前已有的工作区变更。

## 6. 核心工作台

桌面端使用两区布局：

- 左侧固定作品结构树。
- 右侧主工作区使用“正文”“AI 对话”“变更审阅”标签页。

正文编辑器默认占据主要空间。AI 修改任务结束后自动打开“变更审阅”，显示变更摘要和逐文件 diff。MVP 不要求正文与 AI 对话长期并排显示。

## 7. AI 初始化与全书检索

### 7.1 初始化

首次进入作品时，应用按 `projectId` 检查本地索引。索引不存在时，应用明确询问用户是否进行 AI 初始化，并说明会扫描全书及占用本机存储空间。

- 用户拒绝后仍能正常编辑和使用当前文档上下文。
- 初始化在后台解析 Markdown，按标题和段落边界切分内容并建立检索数据。
- 界面显示进度，任务可取消，失败后可重试。
- 索引保存在应用数据目录下，以 `projectId` 隔离，不进入项目 Git 仓库。
- 索引是可重建缓存，源文件始终是唯一事实来源。

### 7.2 增量更新

文件成功保存后，Knowledge Index 异步比较内容哈希，只删除和重建发生变化的内容块。索引更新不阻塞正文保存。

索引状态只有以下四种：

- `not_initialized`：尚未初始化。
- `updating`：初始化或增量更新中。
- `ready`：与已保存作品一致。
- `stale`：更新失败或检测到无法增量处理的变化，需要重建。

### 7.3 检索契约

Knowledge Index 返回有来源的相关片段，每个片段至少包含项目内相对路径、标题上下文、文本范围、相关度和索引版本。AI Orchestrator 按以下顺序组装上下文：

1. 当前选区或当前场景。
2. 当前作品结构路径。
3. 全书检索得到的相关片段及来源。
4. 用户指令和本次任务权限。

AI 回复展示引用来源。索引未就绪时，系统明确降级为当前文档上下文，不声称已经理解全书。

具体本地检索引擎和 Claude plugin 需要在实施前进行联网调研与样本基准测试。候选实现必须支持 Electron/Node.js、本地持久化、增量更新、来源定位和接口替换；不满足这些约束的插件不进入候选范围。

## 8. AI 修改模式

### 8.1 提案确认模式

这是默认模式。Claude 可以返回文字答复或结构化文件补丁，但不能立即写入作品。

1. 用户发出指令。
2. AI Orchestrator 组装当前内容、作品结构和检索上下文。
3. Claude 返回答复或文件补丁。
4. 变更审阅展示逐文件 diff。
5. 用户逐项接受或拒绝。
6. 应用只写入已接受的修改，并创建应用管理的 Git 版本。

### 8.2 Agent 模式

Agent 权限只能针对单次任务显式授予，任务结束后立即失效。

1. 开始任务前校验项目路径并创建 Git 回退点。
2. Claude Agent SDK 只能读取和修改已授权项目目录内的文件。
3. 任务支持超时和取消；所有子进程都纳入生命周期管理。
4. 任务结束后自动打开变更审阅，展示摘要、diff、警告和错误。
5. 用户选择保留结果、继续局部编辑或恢复到任务前状态。
6. 用户确认保留后创建应用管理的 Git 版本。

授权不得跨任务保留。失败的 Agent 任务不得自动重试，以免重复写入文件。

## 9. Git 版本策略

- 项目创建或首次登记且目录内没有 Git 仓库时初始化 Git；已有仓库按导入规则复用。
- 用户可以通过“保存版本”显式提交普通手动编辑。
- AI 提案被接受后创建一个版本。
- Agent 任务开始前创建可恢复的回退点；用户确认保留结果后创建结果版本。
- Git 失败不能导致正文保存失败。应用保留工作区变更，标记“版本管理异常”并允许重试。
- Git 运行时、主进程调用约束、凭证和合规要求以 [Git 方案](../业务需求/sub/git.md) 为准。

## 10. 数据流与隐私

作品 Markdown、Git 历史和 RAG 索引默认留在用户电脑。调用 Claude 时只发送当前请求所需的当前内容和检索片段。

登录托管模式的数据流：

```text
Desktop -> NestJS auth and quota -> Claude -> NestJS -> Desktop
```

免登录模式的数据流：

```text
Desktop credential service -> Anthropic API -> Desktop
```

NestJS 不持久化完整提示词、正文或模型响应正文。诊断日志仅保留请求标识、模型、耗时、令牌计数、状态码和脱敏错误类别。

## 11. 错误处理

- 正文保存使用同目录临时文件写入后原子替换。
- 检测到文件被外部程序修改时停止覆盖，要求用户比较磁盘版本与编辑器版本。
- Git 操作失败不回滚已经成功保存的正文，只将版本状态标记为异常。
- RAG 失败只影响全书检索，编辑器继续工作，AI 明确显示降级上下文。
- Claude 超时、限流或断网时返回结构化错误；普通只读请求可由用户重试，写文件的 Agent 任务不自动重试。
- Agent 取消时终止相关子进程并保留任务前回退点，由用户决定保留部分修改还是完整恢复。
- NestJS 不可用时，本地编辑、Git 和索引继续可用；已配置自有密钥时可切换到免登录模式。

## 12. 安全约束

- Electron 启用 `contextIsolation`，禁用渲染进程 Node 能力并配置严格 CSP。
- 文件、Git 和 Agent 操作只能作用于已登记的项目根目录。
- Git 使用参数数组和 `shell: false`，不暴露任意命令执行 IPC。
- API Key 只存在于操作系统凭证库和发起请求所需的主进程内存中。
- 日志脱敏 API Key、远程凭证、作品正文和本机敏感路径。
- Windows 内置 Git Bash 仅供受控的 Claude Agent SDK 任务使用，不能作为渲染进程通用终端。

## 13. 测试策略

### 13.1 单元测试

- 小说和剧本目录到结构树的映射。
- 导入预览与未分类文件处理。
- IPC 参数和项目路径授权。
- 索引状态转换、内容哈希和增量更新判断。
- 上下文组装、来源保留和补丁应用。
- Agent 单次授权的建立与失效。

### 13.2 集成测试

- 在临时目录中创建、导入和编辑项目。
- 使用临时 Git 仓库验证版本、diff、回退点和失败恢复。
- 使用 Claude 模拟服务验证成功、限流、超时、断网和取消。
- 验证索引初始化、取消、重试、单文件增量更新和完整重建。
- 覆盖空格、中文和特殊字符路径。

### 13.3 Electron 端到端测试

- 新建小说和剧本项目。
- 导入 Markdown 文件夹并确认结构映射。
- 编辑场景并保存版本。
- 初始化全书索引并进行带来源的问答。
- 审阅并接受 AI 提案。
- 运行、取消和回退 Agent 任务。
- 在登录托管模式与免登录模式之间切换。

端到端流程必须在 Windows 和 macOS 的受支持架构上执行安装包冒烟测试。

## 14. MVP 验收标准

1. 未安装系统 Git 的 Windows 和 macOS 设备可以创建或导入项目、编辑 Markdown、查看 diff、保存版本并恢复 Agent 任务。
2. 小说按卷、章、场景导航；剧本按幕、场导航，磁盘内容始终可由普通文本编辑器读取。
3. AI 初始化可确认、取消和重试；单个文件变化只更新相关索引内容。
4. 登录托管模式和免登录自带密钥模式都能完成对话、引用全书内容并生成修改提案。
5. 普通模式未经确认不能修改文件；Agent 模式不能访问项目外路径，授权不会跨任务延续。
6. Git、RAG、Claude 或 NestJS 单点失败不会导致已保存正文丢失。
7. 空格、中文和特殊字符路径通过自动化集成测试。
8. 渲染进程无法访问明文密钥、任意文件、任意 Git 命令或系统 Shell。

## 15. 后续独立需求

以下能力应分别进入新的需求、设计和实施计划：

1. 书籍长期记忆与作者可修订的事实库。
2. 自动大纲与正文结构同步。
3. 故事时间线抽取和冲突检查。
4. 角色图谱与人物故事抽取。
5. Fountain 或其他专业剧本格式。
6. 作品云同步、跨设备和协作。
7. 多模型提供商与自定义兼容接口。
