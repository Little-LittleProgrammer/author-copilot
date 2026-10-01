# 创作资料：大纲、灵感与随记

## 用户行为

编辑器工具栏新增“创作资料”面板，按作品保存大纲、灵感和随记。用户可以筛选类型、新建、编辑和删除资料；切换作品或重启应用后，资料仍然保留。

资料编辑采用标题和正文两个字段，更新时带有时间戳校验，避免旧面板覆盖较新的修改。读取或保存失败会显示错误，不影响正文编辑。

## 实现边界

- 新增 `creative-notes:list`、`creative-notes:create`、`creative-notes:update` 和 `creative-notes:delete` 类型化 IPC。
- 资料保存在 `userData/creative-notes/<projectId>.json`，主进程使用原子写入和 `0600` 权限；不写入作品目录、Git 或服务端。
- IPC 只允许活动作品标签访问对应 `projectId`，Renderer 不获得通用文件系统能力。
- 单条资料标题最多 200 字符，正文最多 100,000 字符，每个作品最多 500 条资料。

## 验证

- Contracts：52 项通过，覆盖类型、严格字段和 IPC 白名单。
- Desktop：241 项通过，覆盖资料创建、更新、删除、隔离、损坏文件保护、冲突检测和 IPC 权限校验。
- Electron：创作资料新增、编辑、重载恢复和删除场景通过。
- Desktop TypeScript、构建、格式检查和 `git diff --check` 通过；lint 无 error，保留仓库已有 4 条 Fast Refresh warning。
