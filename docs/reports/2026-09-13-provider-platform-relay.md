# 自定义 Anthropic 供应商与平台中转

## 交付范围

AI 设置支持多个 Anthropic 兼容供应商：名称、Base URL、独立加密 Key、官方 `/v1/models` 分页发现和手填模型。原有官方 Key 由内置配置直接接管，不迁移明文或重复保存。更换自定义供应商地址时需要重新输入 Key，并以独立凭证版本发布配置；正在运行的请求继续使用启动时的配置。

右侧 AI 面板共用供应商和模型选择，覆盖对话、修改提案、原生 Agent。自定义调用直连，不使用平台余额；平台调用通过邮箱密码账号登录和服务端中转，不自动回退到其他供应商。

平台支持注册、登录、刷新令牌轮换及重放撤销、退出、邮件重置密码、模型开放列表、余额和最近 50 条使用记录。Agent 使用绑定用户、会话、任务、模型和期限的短期凭据。服务端上游 Key 不发送至 Desktop；主进程持有 access token，refresh token 加密保存。

支付尚未接入。客户端显示“在线充值暂未开放”，支付适配接口保留支付宝／微信 TODO；没有支付成功模拟或生产发放额度入口。

## 本地服务启动

前置条件：Node 24.16+、pnpm 11.7、Docker。运行以下命令前在当前 shell 设置随机的 `AUTH_SIGNING_SECRET`（至少 32 字符），供 Compose 校验和 API 签名使用。

```sh
pnpm install --frozen-lockfile
docker compose -f infra/docker-compose.yml up -d mongo redis
pnpm --filter @author-copilot/contracts build
```

本地运行 API 时配置以下环境变量：

- `NODE_ENV=development`
- `HOST=127.0.0.1`、`PORT=9191`
- `MONGODB_URI=mongodb://127.0.0.1:27017/author_copilot?replicaSet=rs0&directConnection=true`
- `REDIS_URL=redis://127.0.0.1:6379`
- `AUTH_SIGNING_SECRET`：随机签名密钥，至少 32 字符。
- `RELAY_CONFIG`：上游配置 JSON 的绝对路径，结构参照 `infra/relay.example.json`。
- `ANTHROPIC_API_KEY`：示例配置引用的上游 Key。
- `SMTP_URL`、`SMTP_FROM`：密码找回邮件服务；未配置时邮件重置不可用。

```sh
pnpm --filter @author-copilot/api dev
```

另一终端启动桌面：

```sh
AUTHOR_COPILOT_PLATFORM_URL=http://127.0.0.1:9191 pnpm --filter @author-copilot/desktop dev
```

通过登录页或 AI 设置的“平台账号”注册后，可以显式给开发账号初始化测试额度：

```sh
pnpm --filter @author-copilot/api build
NODE_ENV=development node apps/api/dist/platform/dev-credit.js writer@example.com 1000000
```

该命令沿用上述数据库环境变量；`1000000` 微元等于人民币 1 元。每个开发账号只初始化一次，重复执行不会重复到账；生产环境禁止执行。

也可运行 `docker compose -f infra/docker-compose.yml up --build`，同时启动三个服务。容器 API 使用 production 模式，不发放测试额度。Compose 暴露的数据库和 API 端口只监听本机；公网部署需另行配置 TLS、数据库认证及部署密钥。

## 模型和计费配置

`relay.example.json` 中价格仅是演示数据，不是 Anthropic 官方报价，也不应直接作为商用价格。价格单位是“每百万 token 的微元”，分别为输入、输出、缓存读取和缓存写入；管理员修改配置后重启 API 生效。平台首版仅一个上游，模型 ID 必须出现在配置中，默认模型必须已开放，未配置完整价格的配置拒绝加载。

平台要求上游实现 Anthropic Messages 和 count_tokens。自定义供应商的 models 接口不可用时允许手填，但不假装验证成功。平台只支持客户端定义的工具，不开放额外按次计费的上游服务端工具。

计费先按输入数量、最贵输入/缓存单价和最大输出预占，再根据上游累计 usage 结算；使用整数和一次向上取整。MongoDB 事务保护并发预占和幂等结算。客户端取消、服务断线或上游 usage 不完整时保留预占并标记待核对，不推算最终扣款；超过五分钟未完成的预占在读取账户时恢复为待核对，未发送的请求释放额度。待核对记录不自动释放，后续应按上游账单核对；本次不提供管理员网页。

账本不存储请求正文、提示词或回答，只保存模型、时间、状态、用量、计价快照和金额。请求日志也不输出正文或凭证。

## 验证入口与边界

普通验证：`pnpm verify`。数据库集成与平台桌面流程需显式提供隔离的 MongoDB replica set 和 Redis：

```sh
PLATFORM_INTEGRATION=1 pnpm --filter @author-copilot/api test
pnpm --filter @author-copilot/api build
PLATFORM_INTEGRATION=1 pnpm --filter @author-copilot/desktop test:e2e
```

上述命令沿用 `MONGODB_URI`、`REDIS_URL`；请指向独立测试数据库。未设置 `PLATFORM_INTEGRATION=1` 时，真实数据库集成和平台 E2E 显式跳过；自定义供应商 E2E 始终执行。

支付商户、真实 Anthropic 账户、生产 SMTP 和四架构安装包不属于此次本地模拟上游验证。

## 本次验证结果（2026-09-13）

最终在设置 `PLATFORM_INTEGRATION=1` 并使用隔离 MongoDB replica set / Redis 的情况下，`pnpm verify` 退出码为 0：

- 格式、工作区边界、全仓 lint 和 TypeScript 通过；lint 0 error，保留原有 4 个 Fast Refresh warning。
- Desktop：33 个测试文件，175 项测试通过。
- Contracts：11 个测试文件，48 项测试通过。
- API：3 个测试文件，12 项测试通过，包含 8 项真实 MongoDB/Redis 集成测试，没有跳过数据库验证。
- 所有生产构建通过；Electron E2E 15/15，通过用时 53.2 秒。
- 同一 Anthropic 模拟接口验证自定义和平台路径下的对话、提案应用、原生 Agent 写入及结果保留；平台 UI 验证了真实账户注册、开发充值、计费流水与完整退出。
- 原有 Agent 取消、恢复、主进程强制退出与重启恢复流程继续通过。
- `git diff --check` 和 Docker Compose 配置解析通过；Docker 容器镜像构建、生产 SMTP、真实 Anthropic 账户和支付商户尚未验收。

完整本地验证日志：`/tmp/author-copilot-m7-verify.log`。本次仅修改工作区，没有提交或推送。
