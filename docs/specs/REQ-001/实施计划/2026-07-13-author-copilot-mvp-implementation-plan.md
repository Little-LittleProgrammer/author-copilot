# Author Copilot MVP 实施计划

- 日期：2026-07-13
- 状态：待 M0 技术决策门通过后进入开发
- 对应需求：REQ-001
- 依据：[`2026-07-12-author-copilot-mvp-design.md`](../技术方案/2026-07-12-author-copilot-mvp-design.md)
- Git 细则：[`git.md`](../业务需求/sub/git.md)

## 1. 计划结论

MVP 按“先离线写作闭环，再可恢复的 AI 改稿，最后托管模式与跨平台发布”的顺序实施。以 5 名核心工程人员为估算基准，计划为 **12 周开发 + 2 周发布缓冲**。若仅由 2–3 人实施，应保持里程碑顺序不变，将时间放大到 20–24 周。

当前仓库只有需求、技术方案和 README，还没有 `package.json`、`apps/`、`packages/`、测试或 CI。因此本计划按绿地项目编排，不假设已有工程基座。

## 2. 范围与交付结果

MVP 必须交付下列端到端闭环，对应技术方案第 1 节：

1. 新建小说或剧本项目，或导入现有 Markdown 文件夹。
2. 在固定作品结构中导航、编辑、原子保存正文。
3. 由用户确认后初始化全书索引，并能取消、重试和增量更新。
4. 使用 Claude 进行带来源引用的全书对话，索引不可用时明确降级。
5. 支持“提案确认”和“单次授权 Agent”两种改稿模式。
6. 在变更审阅中展示 diff，允许接受、拒绝、保留或恢复。
7. 使用应用内置 Git 管理版本，在未安装系统 Git 的 Windows/macOS x64/arm64 环境中可用。

不将人物档案、世界观、剧情线、长期记忆、Fountain、云同步、多人协作、排版导出、多模型提供商纳入本期，范围以技术方案第 2 节为准。

## 3. 实施原则

1. **本地优先**：编辑和文件保存不依赖 Git、索引、Claude 或 NestJS 成功。
2. **垂直切片**：每个里程碑都必须形成可演示、可自动验证的用户闭环，不先堆积大量无消费者的通用包。
3. **契约先行**：IPC/HTTP DTO、错误码、任务事件、项目 schema 先于 renderer、main 和 API 的并行实现。
4. **权限最小化**：Renderer 不获得 Node、通用文件系统、通用 Git/Shell 或明文密钥能力。Agent 权限仅对单次任务有效。
5. **发布风险前置**：Git runtime、native module、签名/公证和四架构打包在 M0/M1 就做最小安装包验证，不留到功能完成后再处理。

## 4. 人力与排期假设

估算基准：

- 2 名 Electron/React/Node 工程师。
- 1 名 AI/RAG 工程师。
- 1 名 NestJS/平台工程师。
- 1 名 QA/测试开发，DevOps 和产品/设计支持为共享资源。

| 里程碑 | 周期        | 交付主题                               | 主要依赖             |
| ------ | ----------- | -------------------------------------- | -------------------- |
| M0     | 第 1 周     | 技术决策、风险 spike、可验收基准       | 无                   |
| M1     | 第 1–2 周   | Monorepo、安全 Electron 壳、契约和 CI  | M0 的包选型结论      |
| M2     | 第 2–4 周   | 新建/导入/导航/编辑/保存闭环           | M1                   |
| M3     | 第 3–5 周   | 内置 Git、版本与变更审阅基础           | M1，与 M2 后半段并行 |
| M4     | 第 5–7 周   | Knowledge Index 初始化、检索和增量更新 | M0、M1、M2           |
| M5     | 第 6–8 周   | BYOK 对话、引用和提案改稿              | M2、M3、M4           |
| M6     | 第 8–10 周  | 单次授权 Agent、取消和恢复             | M3、M5               |
| M7     | 第 3–10 周  | NestJS 托管模式和 Desktop 接入         | M1，可与 M2–M6 并行  |
| M8     | 第 11–12 周 | 故障注入、安全、四架构打包和发布验收   | M2–M7                |
| 缓冲   | 第 13–14 周 | 仅用于阻断发布的缺陷与平台差异         | M8                   |

表中周期是各里程碑子任务的活跃窗口，依赖列表示其退出门。例如 M1 可在 M0 期间先建立无依赖的工作区骨架，但在 M0 的 native module/SDK 结论冻结前不关闭；M5 可先开发 BYOK 传输和对话 UI，但必须等 M4 退出后才能完成全书引用验收。

关键路径为 `M0 -> M1 -> M2 -> (M3 Git || M4 Knowledge) -> M5 -> M6 -> M8`：M3 和 M4 在 M2 的稳定文件/事件契约后并行，二者都是 M5 的退出前置。M7 在 M1 契约稳定后并行，但是 M8 发布验收的强制汇合路径。

## 5. 里程碑实施详情

### M0：技术决策与风险验证

**目标**：在大规模编码前关闭会导致架构返工或无法发布的问题。技术方案第 7.3 节已明确要求实施前完成 RAG 引擎和 Claude plugin 的调研与样本基准。

**任务**：

1. 校准 REQ-001 文档：技术方案第 9 节的 Git 子文档链接应指向当前位置；明确 MVP 不引入 RabbitMQ，本地开发不强制完整 ELK。
2. 完成并记录 ADR：Markdown 编辑器、本地检索引擎与切分策略、系统凭证库适配、托管模式登录流程。
3. 建立 RAG 基准样本：中英文、长/短章节、标题重复、跨文件问题和近义表达；使用同一脚本比较 SQLite FTS5 与 LanceDB 等少量候选的首次索引时间、索引大小、单文件增量更新、top-k 来源命中率和 Electron 打包稳定性。
4. 建立 Claude 验证壳：BYOK 流式响应、取消、超时、限流错误归一化；Agent SDK 的工具限制、目录约束、子进程终止和四架构可分发性。调研时的基线版本为 `@anthropic-ai/sdk@0.111.0` 和 `@anthropic-ai/claude-agent-sdk@0.3.207`，实施时由 lockfile 固定已验证版本。
5. 验证 Git runtime 的 Windows/macOS x64/arm64 来源、SHA-256、目录完整性、许可证义务、macOS 动态库签名与公证。
6. 确定 dirty repository 的 Agent 回退语义：不改写现有历史、不自动提交导入前变更、可区分任务前快照和 Agent 新增变更。
7. 定义性能基线的参考设备与样本规模，在 ADR 中冻结保存、索引、检索和启动的可验证预算。
8. 验证托管模式下的 Agent 凭据链路：本地 Agent SDK 必须能使用任务级短期凭据通过 NestJS 兼容代理完成流式请求、工具轮次、取消和用量归集，且服务端 Anthropic Key 不下发 Desktop。若无法证明，托管模式的 Agent 能力从 MVP 中降级，但托管对话/提案仍按 M7 交付。

**退出门**：

- 上述核心技术选型/契约都有已批准 ADR 或可重复 spike 报告，不存在“实现时再选”的核心依赖。
- 最小 Electron 安装包能携带候选 Git runtime 和所有候选 native module，并在 macOS x64/arm64 与 Windows x64/arm64 四架构真实环境启动。若签名凭据尚未就绪，M0 可用未签名开发包验证架构与资源完整性，但不能缺少任一架构证据。
- RAG 候选引擎有同一数据集下的可重复基准报告，选中方案满足来源定位、增量更新、项目隔离和接口可替换约束。
- RAG 初始基准使用 10 万/100 万/500 万字三档语料和至少 100 条经复核的标注查询；默认由独立人工逐条复核，项目所有者也可明确授权模型辅助复核，但必须在哈希绑定的清单中记录复核方法、身份、授权方、授权上下文和带时区时间。参考设备上的初始工程线为来源路径/范围正确率 100%、Recall@5 不低于 80%、100 万字检索 p95 小于 300 ms，且单文件增量更新不阻塞正文保存。参考设备、复核策略或阈值的调整必须留在 ADR 中。
- Agent SDK 在四架构安装包中均可启动、取消并清理子进程；原生 Windows 环境不依赖不存在的 OS sandbox 承诺。

### M1：Monorepo、契约与安全基线

**目标**：建立可编译、可测试、可打包的绿地工程基座。

**主要文件/目录**：

- 根目录：`package.json`、`pnpm-workspace.yaml`、`turbo.json`、`pnpm-lock.yaml`。
- 应用：`apps/desktop`、`apps/api`。
- 共享契约：`packages/contracts`、`packages/project-schema`、`packages/test-utils`。
- 工程配置：`packages/config-eslint`、`packages/config-typescript`。
- 发布与本地环境：`tooling/`、`infra/`、`.github/workflows/`。

**任务**：

1. 固定 Node、pnpm 和 TypeScript 版本，Turbo 统一编排 `build`、`lint`、`typecheck`、`test`、`package`。
2. 创建 Electron main/preload/renderer 应用壳，默认启用 `contextIsolation`、关闭 renderer Node 能力并配置 CSP。
3. 定义项目元数据 schema 与迁移，以及 IPC/HTTP DTO、结构化错误、索引四态、长任务进度/取消事件。
4. Preload 只暴露按业务能力命名的类型化 API，主进程集中做调用来源、参数和路径授权校验。
5. 建立单元测试、Node 集成测试、Electron E2E 和契约测试运行器。
6. CI 至少执行 lint、typecheck、unit/integration test 和 desktop/api build；打包矩阵从 M1 开始每日运行。

**退出门**：一条命令可完成安装和全库质量检查；Electron 安全边界的负向测试已存在；macOS x64/arm64 与 Windows x64/arm64 四架构都产出可启动的开发安装包。

### M2：本地写作闭环

**目标**：在不启用 AI、索引或 Git 的情况下，用户仍能安全创建、导入和编辑作品。

**实现位置**：

- `apps/desktop/src/main/project/`
- `apps/desktop/src/main/ipc/`
- `apps/desktop/src/preload/`
- `apps/desktop/src/renderer/features/project/`
- `apps/desktop/src/renderer/features/editor/`
- `apps/desktop/src/renderer/i18n/`
- `apps/desktop/src/renderer/themes/`

**任务**：

1. 实现项目登记库，只保存本机路径与 `projectId` 关系，不在项目内复制章节树。
2. 实现小说/剧本模板创建、`author-copilot.json` 校验与迁移、重复 `projectId` 副本确认。
3. 实现 Markdown 目录的只读导入预览、结构映射、“未分类”保留、复制为新项目/就地登记。
4. 从磁盘实时构建小说“卷-章-场景”和剧本“幕-场”结构树。
5. 实现 Markdown 编辑、同目录临时文件 + 原子替换保存、基于版本/哈希的外部修改冲突检测。
6. 建立两区工作台和“正文 / AI 对话 / 变更审阅”标签容器，提供中英文基础词条和 light/dark 主题。
7. 保存成功后发出不阻塞的领域事件，为后续 Git 状态与索引增量更新接入。

**退出门**：新建小说/剧本、导入复杂 Markdown 文件夹、导航与保存均通过 Electron E2E；空格、中文、特殊字符路径和外部编辑冲突通过集成测试；异常退出后没有半写文件。

### M3：内置 Git 与变更审阅基础

**目标**：完成不依赖系统 Git 的版本管理，并为 AI 任务提供可评审、可恢复的基础。

**实现位置**：

- `apps/desktop/src/main/git/`
- `apps/desktop/src/main/credentials/`
- `apps/desktop/src/main/policy/`
- `apps/desktop/src/renderer/features/change-review/`
- `apps/desktop/resources/git/`
- `tooling/scripts/fetch-git-runtime.ts`
- `tooling/scripts/verify-git-runtime.ts`
- `tooling/git-runtime-manifest.json`

**任务**：

1. 按平台/架构下载固定 Git runtime，验证 SHA-256 和完整目录，通过 `extraResources` 放入 ASAR 外。
2. 只使用 `spawn(executable, args, { shell: false })`，统一处理超时、取消、输出上限、退出码和日志脱敏。
3. 实现 `init`、`status`、`add`、`diff`、`commit`、`log`、分支切换、任务前快照和恢复等精确能力，不暴露通用命令 IPC。
4. 导入已有仓库时保留历史和工作区；导入前已有变更不进入应用自动提交。
5. 实现“保存版本”、Git 异常状态与重试；Git 失败不回滚已保存正文。
6. 实现通用 diff 数据模型和变更审阅基础 UI，供提案和 Agent 共用。
7. 对固定 runtime 建立非 UI 的资格验证套件：`clone`、`status`、`add`、`commit`、`diff`、`log`、分支切换、HTTPS 和 SSH 拉取。这些资格用例不等于向 Renderer 开放通用远程 Git UI。
8. HTTPS 凭证保存到系统凭证库；SSH 仅使用用户显式授权的私钥，首次主机指纹可视化确认；支持显式企业 CA 配置，不允许关闭 TLS/`known_hosts` 校验。Renderer 不获得凭证、私钥明文或远程命令参数。
9. 生成 Git 及附带组件许可证清单，在 About/开源许可中展示版本和版权。

**退出门**：在未安装系统 Git 的四架构环境中通过 init/status/add/commit/diff/log/分支切换/恢复和 HTTPS/SSH 拉取资格套件；dirty repo 和中文/空格/特殊字符路径集成测试通过；凭证、主机指纹和企业 CA 的成功/拒绝路径有自动化证据；Renderer 无法执行白名单外命令。

### M4：Knowledge Index

**目标**：建立可重建、可取消、可增量更新且来源可追溯的本地全书检索。

**实现位置**：

- `apps/desktop/src/main/knowledge/`
- `apps/desktop/src/renderer/features/assistant/`
- `packages/contracts/`

**任务**：

1. 在应用数据目录中按 `projectId` 隔离索引和状态，项目目录只保留 Markdown 和最小元数据。
2. 实现用户确认、后台扫描、按标题/段落切分、进度、取消、失败重试和完整重建。
3. 实现 `not_initialized -> updating -> ready/stale` 状态机和异常退出恢复。
4. 消费 M2 保存事件，异步比较内容哈希，只删除/重建改变文件的内容块；不阻塞文件保存。
5. 检索结果统一返回项目内相对路径、标题上下文、文本范围、相关度和索引版本。
6. 项目启动和外部文件变化时执行廉价完整性检查，无法安全增量处理时进入 `stale`。

**退出门**：初始化、取消、重试、单文件更新和全量重建都有集成测试；两个相同 `projectId` 副本不共享索引；所有命中片段都可定位到当前磁盘文件。

### M5：BYOK 对话与提案改稿

**目标**：先交付无业务账号的 Claude 对话和可审阅改稿，打通第一个 AI 端到端闭环。

**实现位置**：

- `apps/desktop/src/main/credentials/`
- `apps/desktop/src/main/ai/`
- `apps/desktop/src/main/policy/`
- `apps/desktop/src/renderer/features/assistant/`
- `apps/desktop/src/renderer/features/change-review/`

**任务**：

1. 通过系统凭证库保存 Anthropic API Key，Renderer 只能获知“已配置/未配置”，不得取回明文。
2. AI Orchestrator 按“当前选区/场景 -> 作品结构路径 -> 全书检索片段 -> 用户指令与权限”组装上下文。
3. 实现流式响应、取消、超时、限流/断网错误归一化和来源引用展示。
4. Knowledge Index 未 `ready` 时只使用当前文档上下文，UI 和响应元数据都不得声称已检索全书。
5. 定义结构化补丁契约，校验相对路径、项目边界、基线内容哈希、文本范围和大小上限。
6. 提案只生成 diff，未经用户接受不写磁盘；允许按文件/变更项接受或拒绝。
7. 只对已接受内容做原子写入，成功后创建应用管理的 Git 版本；Git 失败时保留内容并显示版本异常。

**退出门**：BYOK 能完成带来源问答和多文件提案；未确认提案不产生文件变化；基线 hash 不匹配、路径穿越、超时、限流、断网和 Git 失败都通过自动化故障测试。

### M6：单次授权 Agent

**目标**：允许 Claude Agent SDK 在一次明确授权内改写项目，并能取消、审阅和恢复。

**实现位置**：

- `apps/desktop/src/main/ai/agent/`
- `apps/desktop/src/main/policy/`
- `apps/desktop/src/main/git/`
- `apps/desktop/src/renderer/features/assistant/`
- `apps/desktop/src/renderer/features/change-review/`

**任务**：

1. 定义任务级 capability：授权项目、可读/可写文件类型、允许工具、超时、任务 ID 和创建时间。
2. 启动前重新验证登记路径、解析真实路径并阻断符号链接/路径穿越，然后创建 Git 任务前快照。
3. 将 SDK 工具限制、主进程 Policy 校验和子进程环境限制组合使用，不将 prompt/cwd 当作安全边界。MVP 只开放实施所需的受控文件工具，默认禁用 Bash、PowerShell、WebFetch/WebSearch、任意 MCP 和子 Agent。
4. 内置 Git Bash 只用于已经 M0 证明必要且有额外隔离的受控流程，不作为 Agent 的默认工具或 Windows 安全沙箱。两端都将所有 SDK 子进程纳入任务生命周期。
5. 实现进度事件、超时、取消、进程树终止和结果归一化；失败的写文件任务不自动重试。
6. 任务结束后展示摘要、diff、警告和错误，用户可保留、继续局部编辑或恢复到任务前。
7. 用户确认保留结果后创建应用管理的 Git 结果版本；Git 失败不丢弃 Agent 修改，而是标记版本异常并允许重试。未确认保留前不创建结果版本。
8. 任务结束或应用重启后授权均不延续；审计事件不记录正文、密钥和敏感绝对路径。

**退出门**：成功、失败、超时、取消、部分修改、应用崩溃恢复和 dirty repo 都有集成/E2E 证据；“保留 -> 创建结果版本”及结果版本失败/重试通过故障测试；取消后无残留 SDK 子进程；项目外路径、符号链接/junction、Windows UNC/盘符/设备路径和未授权工具的负向测试全部通过。

### M7：托管模式控制面

**目标**：提供登录、权益、配额和 Claude 代理，不将完整作品或索引持久化到服务端。

**实现位置**：

- `apps/api/src/auth/`
- `apps/api/src/users/`
- `apps/api/src/entitlements/`
- `apps/api/src/quota/`
- `apps/api/src/claude-proxy/`
- `apps/api/src/observability/`
- `apps/api/src/common/`
- `infra/docker-compose.yml`

**任务**：

1. M0 冻结登录流程；当前排期假设为最小邮箱/密码 + access/refresh JWT，不含 SSO、组织管理或复杂账单。
2. Desktop 将 refresh token 保存到系统凭证库，access token 只在主进程必要内存中持有；Renderer 只通过受控 IPC 发起登录/登出和查询会话状态，不获得任一 token 明文。
3. 服务端对 refresh token 实施旋转、重放检测、单会话撤销和全账号登出；Desktop 清理凭证库失败时必须进入显式异常状态，不假装已登出。
4. MongoDB 仅保存用户、凭证摘要/会话状态、权益和配额数据；Redis 实现速率限制和短期配额状态。
5. Claude 代理复用 `packages/contracts` 的归一化请求/响应/错误契约，支持流式传输和客户端取消。
6. 日志仅记录请求 ID、模型、耗时、token 计数、状态码和脱敏错误类别；不持久化提示词、正文、检索片段或模型响应正文。
7. Docker Compose 只编排 API、MongoDB 和 Redis；MVP 不引入 RabbitMQ，完整 ELK 不是本地启动前置。
8. Desktop 实现登录、登出、托管 provider 和 BYOK 切换；NestJS 不可用时不影响编辑、Git 和索引。
9. 使用同一套 Claude 模拟服务契约测试 BYOK 与 managed 模式，防止两条链路行为漂移。

**退出门**：登录、token 刷新/旋转/重放拒绝、单会话撤销、全账号登出、权益拒绝、限流、配额耗尽、上游超时、客户端取消和服务端断线通过集成测试；Renderer 无法读取 access/refresh token；从凭证库外的客户端状态、日志和 MongoDB 样本中无法恢复作品正文或明文密钥。

### M8：跨平台收口与发布

**目标**：将功能验证提升为可安装、可升级、可诊断的 MVP 发布候选版。

**任务**：

1. 建立 Windows x64/arm64 和 macOS x64/arm64 打包矩阵，每个安装包只带对应架构 Git runtime 和 native module。
2. 完成 Windows 签名、macOS 签名/notarization，验证 Git 可执行文件、动态库和 CA 资源在安装后仍可用。
3. 在无系统 Git 的干净 VM/真机上执行安装、启动、新建/导入、保存版本和 Agent 恢复冒烟。
4. 对 Git、RAG、Anthropic、NestJS、Redis/MongoDB 做断网、超时、崩溃和磁盘异常注入，验证正文不丢失。
5. 执行 Renderer 越权、IPC 参数污染、路径穿越、符号链接逃逸、命令注入、密钥/正文日志泄漏等负向测试。
6. 对四架构安装包重跑 Git runtime 资格套件，包含分支切换、HTTPS/SSH 拉取、主机指纹拒绝、企业 CA 成功/失败和凭证脱敏。
7. 保存 SBOM/开源许可、安装包校验和测试证据；发布说明明确已知限制和非目标。

**退出门**：第 7 节的全部验收用例通过；四个架构都有可安装产物和冒烟证据；无未处理 P0/P1 缺陷。

## 6. 测试与验证计划

### 6.1 分层测试

| 层级         | 必要覆盖                                                                                      | 运行时机                        |
| ------------ | --------------------------------------------------------------------------------------------- | ------------------------------- |
| 单元测试     | 目录树映射、schema 迁移、路径授权、索引状态/hash、上下文组装、补丁校验、Agent 授权失效        | PR 必跑                         |
| 契约测试     | preload IPC、main handler、认证会话/凭证边界、BYOK/managed Claude 归一化响应与错误            | PR 必跑                         |
| 集成测试     | 临时项目目录、临时 Git 仓库、Git HTTPS/SSH 服务、真实索引存储、Claude 模拟服务、MongoDB/Redis | PR 必跑，平台用例每日跑         |
| Electron E2E | 新建、导入、编辑、保存版本、索引、问答、提案、Agent 取消/恢复/保留结果版本、模式切换          | 主分支每日跑，RC 必跑           |
| 安全负向测试 | 任意 IPC/Git/Shell、路径穿越、符号链接、命令注入、密钥和正文日志泄漏                          | PR 中跑快速集，RC 跑完整集      |
| 安装包冒烟   | 无系统 Git、四架构、签名/公证、中文/空格路径、内置 Git Bash                                   | 每日构建启动冒烟，RC 跑完整闭环 |

### 6.2 故障矩阵

每个可恢复子系统都要验证“失败不扩散”：

- 文件保存成功 + Git 失败：正文保留，版本状态异常，可重试。
- 文件保存成功 + 索引失败：正文保留，索引进入 `stale`，可重建。
- Claude 超时/限流/断网：返回结构化错误，未确认提案不写文件。
- Agent 取消/崩溃：子进程退出，快照保留，用户决定保留部分变更或恢复。
- Agent 保留结果 + Git 结果版本失败：保留 Agent 修改和任务记录，标记版本异常，不自动重跑 Agent，只允许重试提交。
- NestJS/MongoDB/Redis 不可用：托管模式报错，本地编辑、Git 和索引仍可用；已配置 BYOK 时可显式切换。

## 7. MVP 验收追踪

| 编号 | 可测试的验收标准                                                           | 实现里程碑     | 验证证据                                    |
| ---- | -------------------------------------------------------------------------- | -------------- | ------------------------------------------- |
| A1   | 无系统 Git 的 Windows/macOS 可新建/导入、编辑、diff、提交和恢复 Agent 任务 | M2、M3、M6、M8 | 四架构安装包 E2E/冒烟记录                   |
| A2   | 小说和剧本按固定层级导航，项目文件可由普通文本编辑器读取                   | M2             | 模板/导入 E2E 与磁盘断言                    |
| A3   | AI 初始化可确认、取消和重试，单文件变化只更新对应索引块                    | M4             | 索引集成测试与基准报告                      |
| A4   | BYOK 和托管模式均能对话、展示全书引用并生成提案                            | M5、M7         | 共享 fixture 契约测试与 E2E                 |
| A5   | 提案未确认不写文件；Agent 不可访问项目外路径，授权不跨任务/重启保留        | M5、M6         | 磁盘断言、路径逃逸负向测试、重启 E2E        |
| A6   | Git、RAG、Claude 或 NestJS 任一单点失败均不丢失已保存正文                  | M2–M8          | 故障注入矩阵                                |
| A7   | 空格、中文和特殊字符路径通过项目、Git、索引和 Agent 集成测试               | M2–M6          | 跨平台参数化集成测试                        |
| A8   | Renderer 无法读取明文密钥、任意文件，也无法执行任意 Git/Shell              | M1、M3、M5、M6 | IPC 契约测试、渗透型负向用例                |
| A9   | 内置 Git 通过分支、HTTPS/SSH、凭证、主机指纹、企业 CA 和许可证资格验证     | M3、M8         | 四架构 runtime 资格报告、凭证与网络负向用例 |
| A10  | 用户确认保留 Agent 结果后创建 Git 结果版本，提交失败不丢失 Agent 修改      | M6             | 保留/提交 E2E 与 Git 故障注入               |

## 8. 关键风险与缓解

| 风险                                                     | 影响                                            | 缓解与停损点                                                                                                         |
| -------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| RAG 效果不达标或 native module 无法四架构打包            | 全书问答无法验收或发布延误                      | M0 同数据集基准 + 最小安装包；保留 Knowledge Index 接口，选型未通过不进入 M4                                         |
| 语义检索缺少可发布的 embedding 方案                      | 引用质量不稳定、包体增大                        | M0 比较 FTS/BM25、混合或本地 embedding；基准不支持语义方案时，以有来源的 FTS 作为可发布降级，不虚假声称语义理解      |
| Agent 目录约束被 shell、子进程或符号链接绕过             | 本机数据泄漏/损坏                               | SDK 工具限制 + 主进程真实路径校验 + 子进程限制 + 负向用例；无法建立有效边界时不发布 Agent 模式                       |
| 原生 Windows 不支持 Claude sandbox                       | 误将 Git Bash/cwd 当成安全隔离，导致项目外访问  | MVP Agent 禁用 shell/Web/MCP/子 Agent，只开放受控文件工具；若必须执行 Shell，另立隔离方案和需求，不在本 MVP 隐式开放 |
| 托管模式的本地 Agent 无法安全通过 NestJS 代理            | 服务端密钥下发或托管 Agent 到后期才被证明不可行 | M0 必须完成短期任务凭据的端到端 spike；失败时明确降级托管 Agent，保留托管对话/提案和 BYOK Agent                      |
| dirty repo 快照/恢复覆盖用户原有变更                     | 作品丢失，违反不自动提交原变更的契约            | M0 ADR 先冻结可逆算法，集成测试覆盖 staged/unstaged/untracked/部分失败；未通过时禁用 Agent 写入                      |
| Git runtime 来源、ARM64、CA、签名或 GPL 义务在发布前失败 | 无法生成合规安装包                              | M0 验证来源/许可证，M1 起每日打包，M3 开始保存 SBOM 和签名证据                                                       |
| Windows 原子替换、长路径和文件占用行为与 macOS 不同      | 正文保存失败或损坏                              | M2 开始在 Windows 真实文件系统跑集成测试，保留临时文件诊断但不静默覆盖                                               |
| BYOK 和 managed 模式行为漂移                             | 错误处理、引用或提案在两模式不一致              | 共用 AI Orchestrator 领域契约和同一组模拟响应 fixture，provider 只实现传输差异                                       |
| 范围漂移到 README 的长期能力                             | 12 周无法收口                                   | 所有新需求对照第 2 节非目标；不影响 A1–A8 的需求转独立 REQ                                                           |

## 9. 前置决策清单

以下决策不需要在本计划评审时立即选定，但都必须在 M0 退出前有 ADR：

1. Markdown 编辑器及大文件/中英文 IME 验收基准。
2. 本地检索引擎、切分策略、是否使用 embedding 及模型发布方式。
3. 凭证库实现与 Electron ABI/四架构打包方案。
4. 已有 dirty repo 的 Agent 快照、保留和恢复语义。
5. Windows/macOS 各架构 Git runtime 来源、更新和许可证履约。
6. 托管模式的最小登录流程、账号恢复和 refresh token 策略。
7. 签名证书、macOS notarization、Windows 签名和四架构 CI runner 的负责人与可用日期。
8. 托管模式下 Agent SDK 使用任务级短期凭据访问 NestJS 代理的协议与降级语义。

## 10. 每个里程碑的完成定义

任一里程碑只有同时满足以下条件才能关闭：

1. 对应退出门的用户闭环可从干净环境重复执行。
2. 新增行为有单元/契约/集成/E2E 中与风险相匹配的自动化证据。
3. lint、typecheck、相关测试、desktop/api build 全部通过，打包相关变更还需通过对应平台冒烟。
4. 无已知数据丢失、路径越界、密钥泄漏或任意命令执行风险。
5. 新的架构/安全决策已记录 ADR，用户可见行为、限制和恢复方法已更新文档。
6. 未处理缺陷已分级；P0/P1 为 0，任一接受的 P2 都有明确所有者和修复版本。

## 11. 建议的第一批执行任务

计划批准后，先拆分并并行执行以下任务，不直接全面开工：

1. `M0-01` REQ-001 文档口径和链接校准。
2. `M0-02` RAG 候选选型、样本集和 benchmark harness。
3. `M0-03` Claude TypeScript SDK / Agent SDK Electron 验证壳。
4. `M0-04` 四架构 Git runtime、签名与许可证验证。
5. `M0-05` dirty repository 任务快照/恢复 ADR 与原型测试。
6. `M1-01` pnpm/Turbo 工作区和质量脚本。
7. `M1-02` Electron 安全壳与 typed IPC 最小契约。
8. `M1-03` 项目 schema、错误码、任务事件和测试基础。
9. `M1-04` CI 质量门与 macOS x64/arm64、Windows x64/arm64 四架构最小打包。

第一批任务的停止条件是 M0 退出门全部满足；在此之前不承诺 M4–M8 的具体依赖库实现。

## 12. M0 官方调研入口

以下资料作为 M0 spike 的上游事实来源；实施时需再核对已锁定版本的 API 与发行说明：

- [Claude Agent SDK TypeScript](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Claude Agent SDK permissions](https://platform.claude.com/docs/en/agent-sdk/permissions)
- [Claude Code platform setup](https://code.claude.com/docs/en/setup)
- [Anthropic TypeScript SDK](https://platform.claude.com/docs/en/api/sdks/typescript)
- [Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [SQLite FTS5](https://www.sqlite.org/fts5.html)
- [LanceDB full-text search](https://docs.lancedb.com/search/full-text-search)
- [LanceDB hybrid search](https://docs.lancedb.com/search/hybrid-search)
