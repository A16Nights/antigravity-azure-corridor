<div align="center">

<p>🌐 &nbsp; <strong>简体中文</strong> &nbsp;·&nbsp; <a href="README.en.md">English</a></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme/hero-dark.svg">
  <img src="assets/readme/hero-light.svg" alt="苍蓝回廊 · Azure Corridor" width="100%">
</picture>

<p>
  <a href="https://github.com/A16Nights/antigravity-azure-corridor/releases"><img src="https://img.shields.io/github/v/release/A16Nights/antigravity-azure-corridor?style=flat-square&label=Release&color=3b82f6&labelColor=1e293b" alt="Release"></a>
  <a href="https://github.com/A16Nights/antigravity-azure-corridor/stargazers"><img src="https://img.shields.io/github/stars/A16Nights/antigravity-azure-corridor?style=flat-square&label=Stars&color=f59e0b&labelColor=1e293b" alt="Stars"></a>
  <img src="https://img.shields.io/badge/Google_Antigravity-Native_Plugin-3b82f6?style=flat-square&labelColor=1e293b" alt="Antigravity">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22.0.0-10b981?style=flat-square&labelColor=1e293b" alt="Node.js">
  <img src="https://img.shields.io/badge/Dependencies-Zero-06b6d4?style=flat-square&labelColor=1e293b" alt="Zero Deps">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-6366f1?style=flat-square&labelColor=1e293b" alt="License"></a>
</p>

<p>
  <strong>100% 只读原生会话 FTS5 全文检索、自定义项目分组、工作区聚合、P1~P5 优先级标注与独立安全归档箱</strong>
</p>

<p>
  <a href="#preview">🖼️ 界面预览</a> &nbsp;·&nbsp; <a href="#features">✨ 功能全景</a> &nbsp;·&nbsp; <a href="#architecture">🧩 工作原理</a> &nbsp;·&nbsp; <a href="#installation">🚀 快速安装</a> &nbsp;·&nbsp; <a href="#storage">📂 数据存储</a> &nbsp;·&nbsp; <a href="#azure-suite">🌌 苍蓝全家桶</a>
</p>

</div>

面向 **Google Antigravity** 的原生会话管理增强面板（Sidecar + 独立 Web UI）。100% 只读访问 Antigravity 本地会话数据库（`conversation_summaries.db` 与原生 `conversations_fts` FTS5 索引），所有自定义分组、改名、标签、备注与归档均独立存储在本地 JSON 中，**绝不改写或破坏原生二进制 Protobuf 数据**，安全零风险。

<table>
<tr>
<td width="50%" valign="top">
<h4>⚡ 原生秒切 & FTS5 全文检索</h4>
基于 <code>node:sqlite</code> 直查原生 <code>conversations_fts</code> 索引，毫秒检索标题、正文、代码片段与备注；点击标题通过原生协议秒切会话。
</td>
<td width="50%" valign="top">
<h4>🗂️ 双轨分组与官方归档同步</h4>
支持自定义项目分组与原生工作区自动聚合，自动识别 Antigravity 官方已归档会话并展示醒目徽标与专属筛选。
</td>
</tr>
<tr>
<td width="50%" valign="top">
<h4>🏷️ 行内改名、优先级与长备注</h4>
支持行内改名（7 色预设 + 自由取色高亮）、置顶、<code>★ 收藏</code>、<code>⏱ 稍后回看</code>、P1~P5 优先级、多标签与长备注。
</td>
<td width="50%" valign="top">
<h4>📦 整卡批量操作 & 独立归档箱</h4>
开启批量管理后点选整卡即可批量分组/标星/改优先级/加删标签/归档；主列表只归档不误删，归档箱随时恢复。
</td>
</tr>
</table>

<h2 id="preview">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme/sec-preview-dark.svg">
  <img src="assets/readme/sec-preview-light.svg" alt="界面预览" width="100%">
</picture>
</h2>

<p align="center">
  <a href="assets/readme/preview-panel.png"><img src="assets/readme/preview-panel.png" alt="苍蓝回廊会话管理面板预览" width="90%"></a>
  <br><strong>苍蓝回廊 · FTS5 全文检索、多维筛选与会话整理工作台</strong>
  <br><sub>毫秒级 FTS5 正文搜索、分组/标签/排序组合筛选、官方已归档同步徽标、行内改名与置顶/收藏/回看/归档操作</sub>
</p>

<h2 id="features">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme/sec-features-dark.svg">
  <img src="assets/readme/sec-features-light.svg" alt="功能全景" width="100%">
</picture>
</h2>

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

<h2 id="architecture">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme/sec-arch-dark.svg">
  <img src="assets/readme/sec-arch-light.svg" alt="工作原理与架构" width="100%">
</picture>
</h2>

```mermaid
flowchart LR
  DB["Antigravity 原生 SQLite<br/>conversation_summaries.db<br/>&amp; conversations_fts"] -->|"100% 只读查询 (node:sqlite)"| C["苍蓝回廊 Sidecar"]
  JSON["本地独立标注库<br/>annotations.v1.json"] <-->|"分组 / 改名 / 标签 / 优先级 / 归档"| C
  C -->|"原生 toggle-conversation"| AGY["Antigravity 秒切会话"]
  C -->|"独立标签页"| ARC["安全归档箱<br/>随时恢复 / 二次确认清理"]
```

<h2 id="installation">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme/sec-install-dark.svg">
  <img src="assets/readme/sec-install-light.svg" alt="快速安装与上手" width="100%">
</picture>
</h2>

> **前置要求**：**Node.js >= 22.0.0**（零第三方 npm 运行时依赖，纯 Node.js 原生 ESM 实现）。

### 方式一 · 一句话让 Antigravity 帮你自动安装（推荐）

直接把下面这句话发给 Antigravity 即可自动完成克隆与核验：

> 帮我把 `https://github.com/A16Nights/antigravity-azure-corridor.git` 克隆到本机 Antigravity 全局插件目录，目录名设为 `azure-corridor`，检查目录无误后告诉我，我再按 `Ctrl+R` 重载生效。

### 方式二 · 命令行手动克隆

```powershell
# Windows (PowerShell)
git clone https://github.com/A16Nights/antigravity-azure-corridor.git "$env:USERPROFILE\.gemini\config\plugins\azure-corridor"

# macOS / Linux
git clone https://github.com/A16Nights/antigravity-azure-corridor.git ~/.gemini/config/plugins/azure-corridor
```

重启或重载 Antigravity（`Ctrl+R`），在 **Plugins** 面板启用 **苍蓝回廊** 即可在左侧栏或右侧辅助面板打开。

<h2 id="storage">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme/sec-storage-dark.svg">
  <img src="assets/readme/sec-storage-light.svg" alt="数据与配置存储" width="100%">
</picture>
</h2>

<details open>
<summary><strong>点击展开查看本机数据目录与苍蓝套件共享配置路径</strong></summary>

<br>

- **会话分组、改名、标签、备注与归档数据**：`~/.gemini/azure-corridor/annotations.v1.json`
- **苍蓝套件左侧栏显示配置**：`~/.gemini/azure-sidebar-nav.json`
- **苍蓝套件共享主题配置**：`~/.gemini/azure-theme.json`

> 绝不修改或污染任何 Antigravity 原生数据库文件。

</details>

<h2 id="azure-suite">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme/sec-suite-dark.svg">
  <img src="assets/readme/sec-suite-light.svg" alt="苍蓝套件全家桶" width="100%">
</picture>
</h2>

**苍蓝套件（Azure Suite）** 9 款插件共享统一的 **Neko Glass 毛玻璃界面**、跨插件同步的 **苍蓝主题色调中心**（`~/.gemini/azure-theme.json`）以及可自由开关的 **左侧栏快捷入口**（`~/.gemini/azure-sidebar-nav.json`）：

| 插件 | 仓库 | 核心能力 |
| --- | --- | --- |
| ✦ **苍蓝协奏台** | [antigravity-external-orchestrator](https://github.com/A16Nights/antigravity-external-orchestrator) | 多渠道外部模型协同调度、自定义调度角色、容灾断路器与全链路实时监控 |
| 🪐 **苍蓝星轨** | [antigravity-azure-orbit](https://github.com/A16Nights/antigravity-azure-orbit) | 将外部大模型直接挂载进 Antigravity 左下角原生模型下拉菜单担任主脑 |
| 🧭 **苍蓝罗盘** | [antigravity-azure-compass](https://github.com/A16Nights/antigravity-azure-compass) | Agent 工作模式预设中心、上下文水位监测与自动 /compact、苍蓝套件左侧栏总控 |
| 🏛️ **苍蓝回廊** &nbsp;`✦ 当前仓库` | [antigravity-azure-corridor](https://github.com/A16Nights/antigravity-azure-corridor) | 只读原生会话 FTS5 全文检索、自定义项目分组、优先级标签与独立安全归档箱 |
| 🌌 **蓝汐 · 潮汐认知图谱** | [antigravity-lanxi-memory](https://github.com/A16Nights/antigravity-lanxi-memory) | 五层纯 Markdown 真源记忆、CJK FTS5、潮汐遗忘曲线与交互式潮汐星海图谱 |
| 💎 **苍蓝魂匣** | [antigravity-soul-md](https://github.com/A16Nights/antigravity-soul-md) | 多人设卡热切换、工作区专属绑定、外接模型智能防掉线锚点与分层文件记忆 |
| 💭 **思语中文** | [antigravity-think-zh](https://github.com/A16Nights/antigravity-think-zh) | 内部思考语言简体中文 / 英文双档热切换、双通道防漂移与实时注入预览 |
| 🔮 **苍蓝棱镜** | [antigravity-azure-prism](https://github.com/A16Nights/antigravity-azure-prism) | 原生 MCP App 思维链实时观测、免密钥零 Token 机翻与外部模型双通道译文 |
| 🪄 **苍蓝魔杖** | [antigravity-azure-wand](https://github.com/A16Nights/antigravity-azure-wand) | Windows 桌面与网页低打扰操控台、独立输入 15 状态 AI 光标、套装画廊混搭与外部光标导入 |

---

<div align="center">

📄 Released under the <a href="./LICENSE"><strong>MIT License</strong></a> · Crafted for <strong>Google Antigravity</strong>

</div>
