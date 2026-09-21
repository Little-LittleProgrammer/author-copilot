
## 内置 Git 方案

### 目标与范围

- 仅支持 Windows 和 macOS。
- 应用安装后即可使用 Git，不要求用户单独安装或配置 Git。
- 应用使用固定且经过验证的 Git 版本，避免系统 Git 缺失或版本差异导致行为不一致。
- Git 仅由 Electron 主进程调用，渲染进程不能直接执行任意命令。

### 平台实现

#### Windows

- 内置 Git for Windows 官方发布的 MinGit，按 `x64` 和 `arm64` 分别打包。
- 必须保留完整目录结构，至少包含 `cmd`、`mingw64`（或对应架构目录）、`usr`、`etc` 等运行时资源，不能只复制 `git.exe`。
- Git 命令使用 `cmd/git.exe`，Claude Agent SDK 需要 Bash 时使用 `bin/bash.exe`。
- 应用不得修改系统 `PATH`；只在创建子进程时补充当前进程所需的环境变量。

#### macOS

- 分别内置 `arm64` 和 `x64` 版本的便携 Git 运行时，不能依赖 Xcode Command Line Tools 提供的系统 Git。
- 必须保留 `bin/git`、`libexec/git-core`、`share/git-core/templates`、CA 证书及其依赖库。
- Git 可执行文件和动态库必须随 Electron 应用完成代码签名，并通过 macOS notarization 验证。
- Claude Agent SDK 使用系统 `/bin/zsh` 或 `/bin/bash`，无需额外内置 Git Bash。

### 资源目录

构建产物中的 Git 运行时放在 Electron `resources/git` 下，并位于 ASAR 包之外：

```text
resources/
  git/
    bin/                  # macOS: git、bash 等入口
    cmd/                  # Windows: git.exe 入口
    libexec/git-core/     # Git 子命令
    share/git-core/       # templates 等资源
    mingw64/              # Windows x64 运行时
    usr/                  # Windows Git Bash 运行时
```

构建系统应根据目标平台和架构，只把对应的 Git 运行时复制到最终安装包。使用 `electron-builder` 时通过 `extraResources` 配置该目录，不得将可执行文件打入 `app.asar`。

### 调用约束

- 使用 Node.js `child_process.spawn` 调用 Git，并设置 `shell: false`。
- Git 参数必须以字符串数组传递，禁止拼接 shell 命令，避免路径、分支名或提交信息造成命令注入。
- Git 路径在开发环境从项目资源目录解析，在生产环境从 `process.resourcesPath` 解析。
- 按运行时目录设置 `GIT_EXEC_PATH`、`GIT_TEMPLATE_DIR` 和 CA 证书路径。
- 默认设置 `GIT_TERMINAL_PROMPT=0`，避免后台 Git 进程因等待终端输入而挂起。
- 每次执行必须支持超时、取消、退出码检查，以及标准输出和错误输出的大小限制。
- 路径参数必须经过规范化和授权校验，只允许操作用户已选择或应用已登记的创作项目目录。

### Electron 安全边界

- Git 能力封装在 Electron 主进程的独立服务中。
- Preload 通过 `contextBridge` 暴露 `status`、`commit`、`log`、`diff` 等明确操作，不暴露通用的 `exec(command)` 接口。
- IPC 主进程处理器必须校验调用来源、仓库路径和参数白名单。
- 渲染进程不直接接触 Git 可执行文件路径、系统 shell 或用户凭证。

### 凭证与网络

- HTTPS 凭证存入操作系统凭证库，禁止写入项目文件、日志或命令行参数。
- SSH 私钥沿用用户明确授权的密钥；首次连接需要可视化确认服务器指纹，不能静默关闭 `known_hosts` 校验。
- 内置受信任 CA 证书集合，并允许企业环境显式配置额外 CA；禁止通过关闭 TLS 校验解决证书问题。
- Git 日志输出在进入应用日志系统前必须脱敏 URL、令牌、用户名和本地敏感路径。

### 版本与合规

- Git 运行时版本在构建配置中固定，并记录来源地址、版本号和 SHA-256 校验值。
- Windows 与 macOS 的 Git 运行时升级需要分别执行 `clone`、`status`、`add`、`commit`、`diff`、`log`、分支切换、HTTPS 和 SSH 拉取测试。
- 安装包需要包含 Git 及其附带组件的许可证文本，并满足对应的源码提供和版权声明要求。
- 应用“关于”或“开源许可”页面应展示当前内置 Git 版本及第三方许可信息。

### 验收标准

1. 在未安装系统 Git 的 Windows 和 macOS 设备上，应用仍能完成仓库初始化、提交、查看历史和分支切换。
2. Windows 端 Claude Agent SDK 能通过内置 Git Bash 正常执行所需脚本。
3. macOS `arm64` 和 `x64` 安装包均能调用对应架构的 Git，且通过签名和 notarization 检查。
4. 带空格、中文和特殊字符的项目路径能够正常工作。
5. Git 执行失败、超时或被取消时，子进程能够退出，并向界面返回结构化错误。
6. 渲染进程无法通过 IPC 执行白名单之外的命令或访问未授权目录。
