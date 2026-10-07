# M5 BYOK 对话与提案改稿交付报告

- 日期：2026-08-24
- 基线提交：`ce7ed31 feat: apply accepted AI patches`
- 范围：Anthropic BYOK、上下文与来源、结构化多文件提案、变更审阅、选择性原子写入和 Git 版本
- 状态：完成；M5 本地退出门已通过

## 已交付能力

- Anthropic API Key 通过操作系统凭证能力加密保存。Renderer 只能读取“已配置/未配置”和更新时间，无法取回明文密钥。
- AI Orchestrator 按当前选区或文档、作品结构路径、全书检索结果、用户指令与任务权限组装上下文。
- BYOK Claude 对话支持流式输出、取消、超时，以及限流、断网、凭证和上游错误归一化。回复携带可导航的项目相对路径和来源行号。
- Knowledge Index 未就绪、无权限或检索失败时，上下文和界面都明确降级为当前文档，不声称已使用全书知识。
- Claude 提案通过强制工具调用返回结构化补丁。契约限制项目相对路径、SHA-256 基线、变更 ID、偏移范围、文件数、每文件变更数和文本总量。
- Main 进程重新读取真实文档并校验项目授权、基线 hash、来源文本、Unicode 边界、范围重叠、重复路径/ID、空操作和大小预算。验证阶段不写入磁盘。
- 变更审阅按文件和变更项展示结构化 diff。用户可以逐项、逐文件或全部接受，也可以拒绝整份提案；未执行“应用已接受项”前项目文件保持不变。
- 已验证提案只保存在 Main 进程内，具有项目所有权、容量上限、30 分钟有效期和单次消费语义。Renderer 只持有审阅数据和提案 ID。
- 应用时只组合用户接受的变更，再次校验所有文件的基线 hash，并在项目级串行队列内执行逐文件原子替换。后续文件写入失败时回滚此前已经替换的文件。
- 写入成功后仅为本次涉及的文件创建应用管理的 Git 版本，不会夹带用户的其他 staged、dirty 或 untracked 内容。
- Git 版本创建失败不会撤销用户已接受的正文；接口返回 `version_failed`，界面保留内容并显示版本异常。

## 自动化证据

在 macOS arm64、Node.js 24.16.0、pnpm 11.7.0 环境下，提交 `ce7ed31` 的完整命令

```sh
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm verify
```

通过以下检查：

- Prettier 格式检查和 workspace 边界检查通过。
- ESLint 为 0 error；保留 4 个既有 Fast Refresh warning。
- 所有 workspace TypeScript typecheck 和生产构建通过。
- Contracts：39/39 测试通过。
- Desktop：117/117 测试通过。
- Electron E2E：11/11 流程通过。
- Git runtime 辅助测试和 RAG benchmark 9/9 测试通过。

关键测试证据包括：

- `secure-credential-store.test.ts` 和 `ai-credential-handlers.test.ts`：密钥加密、Renderer 不可回读、损坏/符号链接/加密不可用时 fail closed。
- `ai-context-assembler.test.ts`：上下文顺序、选区、全书来源、未初始化/无权限/检索失败降级。
- `anthropic-transport.test.ts`、`ai-errors.test.ts` 和 `ai-orchestrator.test.ts`：真实 SSE 流、强制结构化工具调用、取消、超时、429、断网和凭证错误归一化。
- `ai-patch-contracts.test.ts` 和 `ai-patch-validator.test.ts`：多文件契约、路径穿越、非法 hash/range、基线不匹配、来源不匹配、重叠、重复、Unicode 和预算拒绝。
- `ai-patch-review.test.ts`：逐文件、逐变更的有界 diff，不向 Renderer 发送完整原始/提议文档。
- `ai-patch-application.test.ts`：只应用接受项、多文件应用、提案过期/丢弃/单次消费、冲突重试和 Git 失败保留内容。
- `project-service.test.ts`：多文件批量写入、基线冲突与后续写入失败时回滚。
- `git-service.test.ts`：精确路径版本不会提交其他用户修改。
- `writing-flow.test.ts`：真实 Electron 中完成 BYOK 来源问答；生成并审阅 Claude 提案；在应用前断言磁盘未变化；仅应用选中变更；刷新编辑器并验证 Git 提交说明。

## 退出门核对

| 退出条件 | 证据 | 结论 |
| --- | --- | --- |
| BYOK 完成带来源问答 | SSE loopback + Electron 来源导航流程 | 通过 |
| 支持结构化多文件提案 | 多文件 Zod 契约、Validator、Application 与批量写入测试 | 通过 |
| 未确认提案不改变文件 | Validator 无写入 API；Electron 在 Apply 前直接断言磁盘内容 | 通过 |
| 基线 hash 不匹配 | Validator 与 Application 冲突测试 | 通过 |
| 路径穿越和项目外路径 | Contracts、Project path policy 与 Validator 负向测试 | 通过 |
| 超时、限流、断网 | Orchestrator、transport 和错误归一化测试 | 通过 |
| Git 失败 | `version_failed` 测试验证内容保留且错误可见 | 通过 |

## 边界与后续

- 本报告记录的是提交 `ce7ed31` 的本地完整验证结果，没有在 2026-08-24 重新查询 GitHub Actions，因此不把远端 CI 状态写成当前已确认事实。
- M5 只交付提案确认模式。单次授权 Agent、任务级路径权限、执行中工具轮次、任务前快照和结束后恢复属于 M6。
- 托管账号模式和服务端 Claude 代理属于 M7，不属于 M5 退出门。
- M2 的原生 Windows 文件系统闭环和 M3 的远程 Git/发布合规缺口由各自里程碑继续跟踪，不影响 M5 已实现能力，但仍会影响整体 MVP 发布状态。

## 结论

M5 已形成完整的安全闭环：`BYOK 对话与来源 -> 结构化提案 -> Main 校验 -> 逐项审阅 -> 显式接受 -> 多文件原子应用 -> 精确路径 Git 版本`。计划定义的全部 M5 任务和故障退出条件均有自动化证据，M5 可以正式关闭；下一开发里程碑进入 M6 单次授权 Agent。
