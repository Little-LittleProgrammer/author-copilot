# 两级 AI 工作区与原生工具首版

日期：2026-11-09。对应[工作区与 Skill 规范](../specs/ai-workspaces-and-skills.md)。

## 已实现

- 用户数据下按身份分为 `accounts/local` 或 `accounts/<accountId>`。每个身份有独立 `workspace` 和 `runtime`；作品位于 `workspace/projects/<projectId>`。原有作品无需迁移。
- 首页“全局 AI 助手”使用账号工作区为 cwd，支持持久对话、取消、作品定位、剧情查询和跨作品比较。首版只读；不能修改任何作品，也不能访问其他身份或应用凭据。
- 全局和每本书均有 `.claude/settings.json`、`.claude/skills` 和 Hook 说明目录。实际安全 Hook 是主进程注册的 SDK 回调，来源目录内的任意脚本不会自动执行。
- 使用 Claude 原生 Read、Glob、Grep、Write、Edit、Skill，删除了应用自写的 MCP 文件工具。现有单次任务授权、流式进度、取消、审阅、版本保留和恢复继续使用。
- 大纲、灵感、随记、章节摘要及事实保存在本书 `创作资产/资料.md`，界面与 Skill 共用。正文使用 Markdown；卷/章及幕/场的现有布局继续支持。

## Skill 加载规则

Skill frontmatter 中 `author-copilot-scope` 可设为 `global`、`work` 或 `both`。全局目录省略时默认为 `both`，作品目录省略时默认为 `work`。Skill 的 `name` 必须与目录名一致。

内置全局技能包括 `locate-work`、`compare-works`，通用技能包括 `writing-techniques`、`read-outline`；每部作品提供 `continue-story`。这些是可维护的写作流程说明，具体创作内容仍属于本书资产。

当前锁定的 Claude Code 2.1.207 在同时加载 user/project 配置源时，同名 Skill 可能选中全局版本；不能仅依赖目录优先级。因此首版明确只加载当前 cwd 的 project 配置源。作品任务开始前，将适用于本书的通用 Skill 及资源投射到本书 `.claude/skills`，并在账号私有 runtime 中记录指纹：

- 原始全局 Skill 是共享源；未被本书修改的投射会同步更新，已经移除或不再适用的共享技能会撤下。
- 本书已有的同名 Skill 优先。作者或 AI 修改了投射内容后，它成为本书覆盖版本，后续同步保留该版本。
- 同步在任务快照之前完成；不会把应用的共享技能同步误算作本轮 AI 修改。
- 全局专用 Skill 不投射到书内，不通过开放全局父目录来取得通用技能。

`CLAUDE_CONFIG_DIR` 指向账号的 `runtime/claude`，这是 Claude 引擎的持久运行目录，不是每任务临时目录。创作配置和 Skill 仍位于工作区的 `.claude`。分开这两个目录，避免 SDK 将同一路径同时识别为 user/project 源。

自动祖先 `CLAUDE.md` 加载被排除；应用只把当前工作区的 `CLAUDE.md` 作为文字注入。文件内的 `@` 不是授予目录外读取权限的入口。

## 文件权限与恢复

主进程 Hook 检查固定任务身份、工具白名单及真实路径，拒绝目录穿越、符号链接、硬链接、越界 Glob 和安全配置修改。搜索前检查所搜索的目录树，遇到重定向文件或过大范围时拒绝并要求缩小范围。原生文件写入限定为本书的正文、创作资产和 Skill Markdown。

已有文件必须先读取，写入前重新核对读取基线。PreToolUse 记录 before-image、预期 after-image 和索引状态后才允许原生 Write/Edit；PostToolUse 验证实际结果，取消或缺失后置 Hook 时仍根据持久快照核验。异常结果保留快照并停止，不覆盖未知改动。恢复继续保留用户的历史、暂存状态和非重叠编辑。

资产文档的每条资料带有身份、类型、来源和内容哈希元数据。原生编辑可以修订已有资料内容，但不得新增“作者已确认事实”或伪造来源；新增资料和证据变更仍走作者确认入口。外部正文变化及原生资产编辑会使旧界面修订号失效，防止静默覆盖。

Bash、PowerShell、NotebookEdit、子 Agent、任意 MCP、插件及 Skill 内的可执行 Hook/命令替换保持关闭。本次没有宣布完成操作系统沙箱或四架构发布验证。

账号切换先阻止新 IPC 请求、检查未保存编辑、关闭原作品标签，取消并等待 AI、索引及文件操作结束后再切换命名空间。导入预览 token 也绑定身份。不能用旧任务、旧预览或旧作品 ID 取得新身份之外的数据。

## 验证入口

- `workspace-service.test.ts`：账号目录、Skill 场景和覆盖、资产共享与冲突。
- `native-tool-policy.test.ts`：路径拒绝、读取基线、原生写入归属及恢复。
- `global-assistant.test.ts`：只读查询、持久历史、初始化期间取消、重复请求与参数约束。
- Electron E2E：原生 Read/Write 的保留及取消恢复；全局 Skill 加载与两书查询；工作区外读取拒绝；真实 SDK 同名 Skill 覆盖；本地/账号甲/账号乙切换。

真实 SDK 使用本地模拟 Anthropic 服务验证协议、工具执行及权限行为；它不替代付费真实模型质量、外部网络、平台 Mongo/Redis 或四架构安装包验收。
