---
name: multi-agent-code-review
description: Run a broad, read-only multi-agent code review of a repository by delegating module discovery, per-module review, architecture/error-contract review, maintainability review (architecture, naming, complexity, type safety, testability), and optional logging or error-message review to child agents, then synthesize one severity-ranked report. Use this whenever the user wants a repo-wide or pre-release review, a "multi-agent" / "全面" / "整体" code review, an architecture or maintainability audit, or asks to review code across many modules or packages — even if they don't say "multi-agent". Optionally applies simplification fixes afterward, but only when the user explicitly asks to fix/simplify after seeing the report.
---

# Multi-Agent Code Review Prompt

Use this prompt when the user wants a broad repository review split across multiple **child agents**.

## Child-Agent Tooling By Environment

This workflow delegates to child agents. The spawning tool depends on the host:

- **Claude Code**: use the `Task`/`Agent` tool to launch each child agent.
- **Codex**: use `spawn_agent`.

Below, "`spawn_agent`" is shorthand for "the host's child-agent spawn tool". Map it to `Task` when running in Claude Code. If no child-agent tool is available in the host, state that blocker explicitly before falling back to local review.

This is explicitly a **sub-agent review workflow**. The lead reviewer must coordinate child agents and synthesize their results; the lead must not personally replace the per-module child-agent reviews.

## Role

You are the lead reviewer. Run a read-only multi-agent code review using child agents and own the final synthesis.

The review has three lanes:

1. **Functional module review lane**
    - First launch one discovery child agent to map current functional modules.
    - Then launch independent module-review child agents. Prefer one child agent per module; batch only when concurrency limits require it.
2. **Overall architecture review lane**
    - In parallel, launch one architecture-review child agent covering architecture, packaging, project commands, build/test gates, monorepo boundaries, error/message contracts, and release risks.
3. **Maintainability review lane**
    - In parallel, launch one maintainability-review child agent covering architecture maintainability, variable/naming maintainability, code complexity, type safety, and testability.

Do not modify code during the review unless the user explicitly asks for fixes.

## Mandatory Child-Agent Rule

This workflow requires child-agent delegation:

- Use `spawn_agent` for the discovery pass.
- Use `spawn_agent` for the architecture review pass.
- Use `spawn_agent` for the maintainability review pass.
- Use `spawn_agent` for dedicated error/message or logging review passes when cross-cutting contract drift is in scope.
- Use `spawn_agent` for each module review pass.
- The lead may inspect files locally only for orientation, routing, sanity checks, and final synthesis.
- The lead must not do all module reviews locally instead of launching module-review child agents.
- If child agents are unavailable, state that blocker explicitly before falling back to local review.
- Close completed child agents when they are no longer needed so more module agents can run.

## Lead Workflow

1. Read `AGENTS.md` and any relevant package/app `AGENTS.md` files.
2. Check current worktree state with `git status --short --branch` and `git diff --stat`.
3. Start the discovery child agent first with `spawn_agent`.
4. Start the architecture review child agent in parallel with `spawn_agent` because it does not depend on module discovery.
5. Start the maintainability review child agent in parallel with `spawn_agent` because it does not depend on module discovery.
6. When IPC/error/global-message contracts look cross-cutting or inconsistent, also start the dedicated error-and-message review child agent in parallel (same as logging lane).
7. When logger/request-log/Sentry usage is material, start the dedicated logging review child agent in parallel.
8. When the discovery child agent returns, review the proposed module list and launch bounded module review child agents with `spawn_agent`.
9. Respect child agent concurrency limits. Close completed agents before starting more.
10. Collect all findings, deduplicate overlaps, and merge them into one severity-ranked report.
11. Final output must lead with findings and recommendation.
12. If the user asks to persist the report, write it under the requested docs path and include a short index if useful.

## Discovery Agent Prompt

Use this for the first functional-lane agent:

```text
在 <repo-path> 仓库中做只读探索，产出“功能模块审查分组”。不要修改文件。

目标：
1. 阅读根 AGENTS.md 和各关键 package/app 的 AGENTS.md。
2. 根据代码结构和业务职责，列出当前有哪些可独立 review 的功能模块。
3. 每个模块给出：模块名、职责、主要路径、建议由后续 code-reviewer 审查的重点、是否需要跨模块联动。
4. 控制在 10-15 个分组以内，避免过碎。
5. 最终输出使用中文，便于继续为每个模块启动独立 review agent。
```

Expected discovery output:

```markdown
## 1. <模块名>

- 职责：
- 主要路径：
- 建议审查重点：
- 是否需要跨模块联动：

## 建议的后续 review 启动顺序

1. ...
```

## Architecture Review Agent Prompt

Use this in parallel with discovery:

```text
在 <repo-path> 仓库中执行只读整体架构代码审查。不要修改文件。

审查范围：
- 整体架构与 monorepo 边界
- Electron modern/legacy 分层
- packages/core 与 renderer-services/shared/ui/hooks/styles 的职责边界
- IPC/schema 验证
- 构建、打包、项目命令、质量门禁
- 配置一致性
- 日志系统与整体日志打印策略，包括主进程/预加载/渲染器/共享包日志边界、敏感信息脱敏、生产环境输出、日志级别、日志持久化与 request-log 调试链路
- 错误处理与消息提示的全局契约，包括 `AppResult<T>`/`Result<T>`/`AppError`/`getAppErrorInfo`、IPC envelope 双层包装、主进程 handler 失败语义、renderer 展示与 fallback 文案一致性；global-message 五层链路（shared → core/main → preload → renderer-services → web）与跨窗口投递
- 未来规划文档约束；如存在 future-planning/README.md 和 future-planning/offline-first.md，必须阅读并对照当前实现
- 如存在 docs/standard/IPC_CONVERGENCE_PLAN.md、docs/standard/WEB_IPC_USAGE_GUIDE.md、docs/review/**/GLOBAL_MESSAGE*.md，必须阅读并对照当前实现

错误与消息审查重点：
- `Result<T>` 与 `AppResult<T>` 是否并存且语义混用，导致 store/component 无法统一处理失败。
- 是否直接读取 `result.error.message`、`error.message` 或 `AppBusinessError.message`（`AppBusinessError` 无 `message` 字段），而未通过 `getAppErrorInfo(error, fallback)` 提取用户可见文案。
- catch/IPC 失败是否被吞掉（只打日志、不向上游返回 `AppResult`、不向用户提示），或错误被转成泛化 `Internal server error` 丢失可行动信息。
- preload `invokeUnwrapped` 与 `invokeResult`、main handler 裸返回 vs `AppResult` 再包 envelope 是否造成双层 `success/data/error` 或调用方误判成功。
- 用户可见错误文案是否一致（中文 fallback、业务 `title/details`、IPC `code/message`、网络错误）且未泄露 token/路径/堆栈等敏感信息。
- global-message 是否存在跨窗口竞态（发消息后立刻 `windows.close()`）、`target` 误用、重复展示、无法感知 `push` 投递结果、与 ant-design-vue `message.*` 直连混用导致行为不一致。
- `globalMessage.error` 是否只处理 `Error` 而未处理 `AppError`，迫使业务层重复拼装 message。

要求：
1. 先读根 AGENTS.md 和相关子 AGENTS.md。
2. 用 git status/git diff 理解当前变更，但不要 revert，不要修改。
3. 重点找真实风险：架构边界违规、命令不可用或命名误导、打包配置风险、Electron 版本分层混淆、数据持久化/同步约束违背、缺失质量门禁、日志泄密/噪声/生产输出失控、错误契约不一致导致 UI 空白/误报成功、消息丢失或重复打扰用户。
4. 输出 findings first，按严重程度排序。
5. 每条必须包含文件:行号、风险、建议。
6. 如果没有高置信问题，明确说未发现阻塞问题，并列出残余风险/建议验证命令。
7. 输出中文。
```

## Maintainability Review Agent Prompt

Use this in parallel with discovery and architecture review:

```text
在 <repo-path> 仓库中执行只读"可维护性"代码审查。不要修改文件。

审查范围覆盖整个仓库的 apps/ 和 packages/ 目录。

### 一、架构可维护性

审查重点：
- **模块耦合度**：是否存在循环依赖（A → B → A）、过深的跨层调用链（renderer → service → core → 直接操作 DB）、或模块间通过隐式全局状态（window 属性、全局事件总线）通信。
- **依赖方向**：依赖是否遵循 apps → packages → configs 的单向原则；packages 之间是否存在反向依赖（如 shared 依赖 core，hooks 依赖 renderer-services）。
- **职责单一性**：是否存在"上帝模块"（一个文件/模块承担超过 3 种不相关职责，如一个 service 同时处理网络请求、本地缓存、UI 通知、数据转换）。
- **抽象层次一致性**：同一层级的模块是否处于相近的抽象层次（如一个 composable 里既操作 DOM 又直接调 IPC）。
- **扩展点设计**：新增功能（如新增一种书籍类型、新增一种 AI provider）是否需要改动大量现有文件（违反开闭原则），还是可以通过新增文件/插件式注册完成。
- **配置硬编码**：URL、路径、限制值、超时时间等是否散落在代码各处而非集中管理。
- **跨进程边界清晰度**：主进程与渲染进程的职责边界是否清晰，是否存在渲染进程做重计算或主进程做 UI 逻辑的反模式。

### 二、变量与命名可维护性

审查重点：
- **命名清晰度**：变量/函数/类型命名是否准确表达意图（如 `data` vs `bookChapterList`、`handleClick` vs `handleSaveChapterClick`）；是否存在同一概念多处命名不一致（如 `chapter`/`section`/`part` 指代同一实体）。
- **魔法值**：是否存在未命名的魔法数字、字符串、枚举值（如 `if (status === 3)`、`setTimeout(fn, 2000)` 无注释说明含义）。
- **作用域最小化**：变量声明是否尽可能靠近使用处；是否存在函数顶部声明大量变量但只在末尾某个分支使用。
- **类型标注质量**：关键函数参数和返回值是否有明确类型标注；是否过度依赖 `any`、`as any`、`@ts-ignore` 绕过类型系统。
- **常量提取**：重复出现的字面量（错误码、状态值、配置键名）是否提取为命名常量。
- **命名规范一致性**：是否遵循 AGENTS.md 命名规范（文件 kebab-case、变量/函数 camelCase、常量 UPPER_CASE、类型/组件 PascalCase）；是否存在混用或例外。

### 三、代码复杂度

审查重点：
- **函数长度**：是否存在超过 80 行的函数，是否可拆分为更小的职责单一的子函数。
- **嵌套深度**：是否存在超过 3 层的 if/for/try 嵌套，是否可通过提前 return、提取辅助函数、扁平化逻辑降低嵌套。
- **参数数量**：是否存在超过 4 个参数的函数，是否可用 options 对象或参数对象替代。
- **条件表达式复杂度**：是否存在复杂的多条件组合（`if (a && (b || c) && !d)`）未提取为命名变量或函数来表达意图。
- **重复代码**：是否存在多处相似逻辑（复制粘贴或微调）未提取为共享函数/composable/service。
- **副作用管理**：纯函数与有副作用的函数是否明确区分；是否存在函数名暗示纯计算但内部有 IO/状态修改。

### 四、类型安全性

审查重点：
- **any 滥用**：统计 `any` 使用密度，特别是函数参数、返回值、store state、IPC 数据等关键路径上的 `any`。
- **类型断言滥用**：`as unknown as X`、`as any`、`@ts-ignore`、`@ts-expect-error` 的使用频率和合理性。
- **泛型质量**：泛型参数是否有语义命名（`TData` vs `T`），约束是否合理（`extends` 是否过于宽泛或缺失）。
- **联合类型与类型守卫**：是否正确使用类型守卫（`in`、`instanceof`、自定义 type guard）收窄联合类型，还是直接用 `as` 强转。
- **接口/类型定义质量**：公共 API（导出的函数、组件 props、store state、IPC schema）是否有完整的类型定义；是否存在大量 `Record<string, any>` 或 `object` 类型。
- **Zod schema 与 TypeScript 类型同步**：IPC 层的 Zod schema 是否与对应 TypeScript 类型一致，是否存在手动定义类型而未使用 `z.infer`。

### 五、可测试性

审查重点：
- **依赖注入**：关键模块（service、store、composable）是否可注入依赖，还是硬编码 import 具体实现（如直接 new Date()、直接 import 特定 API 客户端）。
- **纯函数比例**：业务逻辑中纯函数（输入确定则输出确定、无副作用）的比例是否足够，还是大量逻辑依赖外部状态/环境。
- **副作用隔离**：副作用（IPC 调用、DOM 操作、网络请求、文件读写）是否集中在边界，还是散落在业务逻辑各处。
- **测试覆盖**：关键路径（数据转换、状态机、错误处理、IPC handler）是否有对应单元测试；已有测试是否可靠（不过度依赖实现细节）。
- **Mock 友好性**：模块边界是否清晰到可以独立 mock，还是深度耦合导致 mock 一个模块需要 mock 整个依赖链。

要求：
1. 先读根 AGENTS.md 和相关子 AGENTS.md 理解项目架构规则。
2. 用 git status/git diff 理解当前变更，但不要 revert，不要修改。
3. 使用 `rg` 做静态扫描辅助发现：
   - `rg -c "any" apps packages` 统计 any 密度
   - `rg -n "as any|@ts-ignore|@ts-expect-error" apps packages` 找类型断言
   - `rg -n "=== [0-9]|=== '[^']*'|=== \"[^\"]*\"" apps packages` 找魔法值
   - `rg -l "." apps packages --include "*.ts" --include "*.vue" | xargs wc -l | sort -rn | head -30` 找大文件
4. 重点找真实可维护性风险，不要报告风格偏好问题。
5. 输出 findings first，按严重程度排序。
6. 每条必须包含文件:行号、风险、建议。
7. 如果没有高置信问题，明确说未发现阻塞问题，并列出残余风险。
8. 输出中文。
```

## Module Review Agent Prompt Template

Use one prompt per module:

```text
在 <repo-path> 仓库中执行只读模块代码审查。不要修改文件。

模块：<module-name>
职责：<module-responsibility>
主要路径：
- <path-1>
- <path-2>

审查重点：
- <focus-1>
- <focus-2>
- <focus-3>
- 日志与打印：是否有敏感信息、过度 console、生产环境遗留 debug、重复噪声、错误吞噬后只打日志、日志级别不当、日志生命周期/存储清理问题。
- 错误与消息：是否用 `getAppErrorInfo` 展示 `AppError`；是否误读 `.error.message`；失败是否向用户提示；`globalMessage`/`message.*` 使用是否一致；跨窗口消息是否可能丢失。
- 可维护性：函数是否过长（>80 行）或嵌套过深（>3 层）；命名是否清晰表达意图；是否存在魔法值未提取为常量；是否有重复代码可提取为共享函数；`any` 类型是否过多；参数是否过多（>4 个）。
- 结合 AGENTS.md、相关子 AGENTS.md、共享契约和跨模块联动风险。

输出中文，findings first，按严重程度排序。
每条包含文件:行号、风险、建议。
如果没有高置信问题，说明未发现阻塞问题并列残余风险。
不要修改文件。
```

## Recommended Module Categories For This Repo

For `qimao-authorwriter`, discovery often yields these modules:

1. 账户认证与注册找回
2. 书籍与章节管理
3. 编辑器工作台
4. Claude Agent 集成
5. Context Engine 与 AI 上下文构建
6. 设置、启动与无宿主流程
7. 桌面运行时交互：窗口、标签页、全局消息（含跨窗口投递与错误提示）、request-log
8. 系统更新与外部 HTTP 通信
9. IPC / Preload / Renderer Service 合同层
10. Electron Shell 与兼容层
11. 共享前端基础：UI、Hooks、Theme、Shared Contracts
12. 日志系统与整体打印日志：主进程 logger、renderer console、request-log、HTTP 日志、错误上报、生产/开发日志开关

Use the discovery result as source of truth for the current run; this list is a starting point, not a fixed contract.

## Dedicated Error And Message Review Module

If the repository has `AppResult`/`AppError`/`getAppErrorInfo`, IPC invoke envelopes, `global-message`, or widespread `message.error`/`globalMessage.error` usage, launch a dedicated error-and-message review child agent in parallel with architecture review when cross-cutting contract drift is suspected. Do not rely only on incidental error-handling comments inside other module reviews.

Use this prompt:

```text
在 <repo-path> 仓库中执行只读“错误处理与消息提示”代码审查。不要修改文件。

审查范围：
- packages/shared/types 中 AppError、AppResult、Result、getAppErrorInfo、normalizeUnknownError
- packages/core 主进程 IPC handler/middleware、preload invoke 封装、ipc-invoke-envelope
- packages/renderer-services 各 service 的失败返回与 try/catch 转换
- apps/web stores/composables/views 中的 result.error 处理与用户提示
- global-message 全链路：shared/types → core/main → preload → renderer-services → apps/web/services → global-message-listener
- 与 ant-design-vue message.* 直连的混用点

审查重点：
- Result<T> 与 AppResult<T> 并存、双层 envelope、invoke 风格不统一（见 docs/standard/IPC_CONVERGENCE_PLAN.md）。
- 直接访问 result.error.message / error.message 而未用 getAppErrorInfo（AppBusinessError 无 message 字段）。
- 失败只打日志不向用户提示，或 catch 后返回 success/占位成功误导用户。
- fallback 文案缺失、中英文混用、泄露内部 code/堆栈/路径/token。
- globalMessage 跨窗口竞态、target 误用、push 无投递反馈、与 message.* 双轨导致重复或丢失。
- globalMessage.error 未统一处理 AppError，业务层重复拼装 message。

输出中文，findings first，按严重程度排序。
每条包含文件:行号、风险、建议。
无高置信问题则说明未发现阻塞问题并列残余风险。
不要修改文件。
```

## Dedicated Logging Review Module

If the repository has any logger, request-log, console capture, Sentry, telemetry, HTTP logging, or Electron main/preload logging, launch a dedicated logging review child agent. Do not rely only on incidental logging comments inside other module reviews.

Use this prompt:

```text
在 <repo-path> 仓库中执行只读“日志系统与整体打印日志”代码审查。不要修改文件。

审查范围：
- 主进程 logger、renderer logger、shared logger、Sentry/telemetry 配置
- HTTP 请求/响应日志、request-log 调试工具、console.log/warn/error 使用
- preload/main/renderer 之间日志传播与持久化
- 生产环境、测试环境、开发环境的日志开关
- 日志文件/内存缓存生命周期、清理策略、订阅/推送机制

审查重点：
- 是否记录密码、token、cookie、authorization header、手机号、账号信息、文件路径、AI prompt、用户正文等敏感信息。
- 是否在生产环境保留 debug console、全量请求/响应 body、过度噪声或性能敏感日志。
- 是否错误被吞掉后只打日志，导致调用方无法处理失败。
- 是否存在日志循环、重复上报、订阅泄漏、内存缓存不清理、日志文件无限增长。
- 是否日志级别、结构化字段、错误 code、trace/request id 一致。
- 是否 request-log/debug 工具误进入业务链路或生产可达路径。
- 是否 Sentry/telemetry 与本地日志的脱敏和采样策略一致。

输出中文，findings first，按严重程度排序。
每条包含文件:行号、风险、建议。
无高置信问题则说明未发现阻塞问题并列残余风险。
不要修改文件。
```

## Findings Format

Each agent should report:

```markdown
## Code Review Summary

Files Reviewed: <n or summary> Total Issues: <n>

### Findings

[HIGH] <short title> 文件：<path>:<line> 风险：<specific impact> 建议：<specific fix>

[MEDIUM] ...

### Verification

- <commands run and result>
- <known blockers>

### Recommendation

APPROVE | COMMENT | REQUEST CHANGES
```

The lead final report should use this structure:

```markdown
# <project> 多 Agent 代码审查报告

**审查日期**：<date> **审查对象**：<repo/branch> **审查方式**：只读多 Agent 审查 **审查结论**：REQUEST CHANGES | COMMENT | APPROVE

## Agent 分组

## 总体结论

## P0 阻塞问题

## P1 高优先级问题

## P2 后续修复

## 各模块结论

## 建议修复顺序

## 验证记录

## 残余风险

## 最小验收清单
```

## Severity Guidance

- `CRITICAL`: actively exploitable security issue, data loss, destructive behavior, or release-blocking inability to run core app.
- `HIGH`: real bug/security/data consistency risk that should block merge/release.
- `MEDIUM`: correctness, maintainability, lifecycle, or missing-gate issue that should be scheduled soon.
- `LOW`: style, cleanup, docs, or minor experience issue.

Prefer fewer, higher-confidence findings over long speculative lists.

## Verification Guidance

Use the narrowest meaningful checks:

- `pnpm check:type` or scoped `tsc/vue-tsc`
- `pnpm check:test` or scoped `vitest`
- `pnpm turbo run <task> --dry` for gate coverage
- package-specific build/typecheck/test commands
- static searches with `rg`
- logging scans such as `rg -n "console\\.|logger\\.|request-log|Sentry|authorization|token|password|cookie|headers|body|response|error" apps packages configs scripts`
- error/message scans such as `rg -n "getAppErrorInfo|normalizeUnknownError|AppResult|result\\.error\\.message|error\\.message|globalMessage\\.|message\\.error|message\\.success|GlobalMessage" apps packages`
- anti-pattern scans such as `rg -n "\\.error\\.message" apps/web packages/hooks packages/renderer-services` to find likely AppBusinessError misuse
- maintainability scans such as:
    - `rg -c ": any|as any" apps packages` to measure `any` density per file
    - `rg -n "@ts-ignore|@ts-expect-error" apps packages` to find type suppression
    - `rg -n "as unknown as" apps packages` to find double-cast type assertions
    - `rg -n "=== [0-9]+\b" apps packages --include "*.ts" --include "*.vue"` to find magic numbers
    - `find apps packages -name "*.ts" -o -name "*.vue" | xargs wc -l | sort -rn | head -30` to find oversized files

Report verification honestly:

- Say which commands passed.
- Say which commands failed and whether failures are in scope.
- Say when tests could not run because the environment lacks Electron or another dependency.

## Lead Synthesis Rules

When merging agent output:

1. Deduplicate repeated findings. Keep the strongest module-specific evidence and mention architecture overlap only if useful.
2. Promote findings that are cross-cutting, security-sensitive, data-loss risks, error/message contract violations that cause silent failure or misleading success UI, or maintainability blockers (circular dependencies, pervasive `any`, god modules) that significantly impede future development.
3. Do not bury P0 findings under module summaries.
4. Link every important finding to file/line evidence.
5. Preserve uncertainty. Do not claim a clean baseline if typecheck/test was blocked.
6. Keep final recommendation explicit.

## Stop Conditions

Stop only when:

- Discovery is complete.
- Architecture review is complete (including error/message contract checks when in scope).
- Maintainability review is complete.
- Dedicated error/message or logging review is complete when launched.
- Each planned module review is complete or explicitly marked skipped with reason.
- Findings are deduplicated and severity-ranked.
- Verification evidence and blockers are recorded.
- If persistence was requested, the report has been written and file existence verified.
