# 苍蓝回廊 · Azure Corridor (`antigravity-azure-corridor`)

面向 **Google Antigravity** 的原生会话检索、自定义项目分组、工作区聚合、标签优先级标注与安全归档管理插件（Sidecar + 独立 Web UI）。

100% 只读访问 Antigravity 本地会话数据库（`conversation_summaries.db` 与原生 `conversations_fts` FTS5 全文索引），所有自定义分组、改名、标签、备注与归档状态均独立存储在本地 JSON 中，**绝不改写或破坏 Antigravity 原生二进制 Protobuf 数据**，安全零风险。

---

## ✨ 功能全景

### 1. 原生会话秒切与多维全文检索
- **点击标题原生秒切**：通过 Antigravity Sidecar 原生 `toggle-conversation` 协议直接跳转并激活目标会话，搭配独立的「复制会话 ID」按钮。
- **FTS5 对话正文全文搜索**：基于 Node.js 内置 `node:sqlite` 直接查询 Antigravity 原生 `conversations_fts` 全文索引，毫秒级检索历史对话标题、正文、代码片段、标签与备注。
- **多维组合筛选与排序**：
  - 视图筛选：`全部会话`、`★ 已收藏`、`⏱ 稍后回看`、`P1~P5 优先级`、`官方已归档`、`未分组`；
  - 排序方式：`最近活跃`、`创建时间`、`优先级从高到低`、`标题字母序`。

### 2. 双轨分组体系（自定义分组 + 原生工作区聚合）
- **自定义项目分组**：自由新建、重命名、归档、删除自定义分组，把跨目录或同专题的任意会话归入自己的分类体系，完全不影响 Antigravity 官方工作区。
- **原生工作区自动识别**：自动解析每条会话关联的本地工作区路径（Workspace），支持按工作区快速过滤查看。
- **Antigravity 官方归档自动同步**：自动解析原生数据库中官方已归档（Archived）的会话，在卡片上展示醒目的 **`官方已归档`** 徽标，并提供专属筛选开关。

### 3. 丰富的单会话整理与标注能力
- **行内标题编辑 & 改名高亮**：点击标题旁 `✎` 即可行内改名（`Enter` / 失焦自动保存，`Esc` 取消）；改名后的会话标题自动高亮变色，并可在「设置」中从 7 款预设色板或自由取色器中定制高亮色。
- **置顶 / 收藏 / 稍后回看**：一键置顶重要会话、标记 `★ 收藏` 或 `⏱ 稍后回看`。
- **5 级优先级（P1 ~ P5）**：为任务会话标记紧急程度，支持按优先级配色展示与排序。
- **多标签（Tags）与长备注（Note）**：为会话打上多个检索标签，或记录进度备忘、待办事项与关键结论。

### 4. 高效批量管理与安全独立归档箱
- **整卡点选批量操作**：开启「批量管理」后，点击卡片任意空白处即可勾选，支持一键全选当前筛选结果，批量执行：**移入分组、修改优先级、设为收藏/取消收藏、批量加/删标签、批量归档**。
- **只归档不误删机制**：主列表仅提供「归档」操作，避免手滑丢失记录；已归档的会话或分组统一进入独立的 **「归档箱」** 标签页，可随时一键恢复，或经面板内毛玻璃确认弹窗二次确认后彻底删除自定义标注。

### 5. 苍蓝统一视觉与交互体系
- **Neko Glass 毛玻璃界面**：支持深色 / 浅色双主题、自定义毛玻璃下拉框（`AzureSelect`）、7px 细圆角滚动条与切回面板静默刷新。
- **跨插件共享「苍蓝主题色调中心」**：内置 6 套官方配色预设 + 自定义主副双色取色器 + 4 个自定义保存栏位，与苍蓝全系插件实时联动。
- **左侧栏入口开关、独立 Web UI 与更新检查**：顶栏一键切换左侧栏快捷入口显隐、在系统浏览器全屏打开独立 `Web UI`、点击版本号实时检查 GitHub 最新 Release。

---

## 🚀 安装方式

> 前置要求：**Node.js >= 22.0.0**（使用内置 `node:sqlite`，零第三方 npm 依赖）。

将本仓库克隆或复制到 Antigravity 全局插件目录（目录名固定为 `azure-corridor`）：

```powershell
# Windows (PowerShell)
git clone https://github.com/A16Nights/antigravity-azure-corridor.git "$env:USERPROFILE\.gemini\config\plugins\azure-corridor"

# macOS / Linux
git clone https://github.com/A16Nights/antigravity-azure-corridor.git ~/.gemini/config/plugins/azure-corridor
```

重启或重载 Antigravity（`Ctrl+R`），在 **Plugins** 面板启用 **苍蓝回廊** 即可在左侧栏或右侧辅助面板打开。

---

## 📂 数据与配置存储

- **会话分组、改名、标签、备注与归档数据**：`~/.gemini/azure-corridor/annotations.v1.json`
- **苍蓝套件左侧栏显示配置**：`~/.gemini/azure-sidebar-nav.json`
- **苍蓝套件共享主题配置**：`~/.gemini/azure-theme.json`

不会修改或污染任何 Antigravity 原生数据库文件。

---

## 📄 License

[MIT](./LICENSE)
