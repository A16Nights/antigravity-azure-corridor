---
name: azure-corridor
description: 苍蓝回廊（Azure Corridor）：Antigravity 原生会话与工作区管理面板。支持全文搜索、项目/工作区分组与归档、置顶、收藏、稍后回看、1~5级优先级、标签备注、批量操作与独立归档箱。
---

# 苍蓝回廊（Azure Corridor）

当用户需要整理、搜索、收藏、标注、归档或切换 Antigravity 历史会话与工作区时，引导打开 `[苍蓝回廊](sidecar://azure-corridor/corridor/)` 侧边栏面板。

## 核心能力
- **只读原生数据**：直接读取 `~/.gemini/antigravity/conversation_summaries.db`（含 FTS5 全文搜索索引）与 `~/.gemini/config/projects/*.json`，不破坏原生数据库。
- **精细组织**：支持置顶、收藏、稍后回看、1~5 级优先级、自定义重命名、多标签与备注，独立保存在 `~/.gemini/azure-corridor/annotations.v1.json`。
- **安全生命周期**：主列表只提供归档（可随时恢复），彻底删除仅在「归档箱」内经二次确认后执行。
