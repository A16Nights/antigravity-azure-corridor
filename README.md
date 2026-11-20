# 苍蓝回廊（Azure Corridor）

> Google Antigravity 原生会话与自定义分组管理面板（Sidecar 插件）。

## 核心特性

- **100% 只读原生数据库**：使用 Node.js 内置 `node:sqlite` 只读访问 Antigravity `conversation_summaries.db` 与原生 `conversations_fts` FTS5 全文索引，绝不改写原生二进制 Protobuf 数据，安全零风险。
- **点击标题原生秒切**：通过 Antigravity Sidecar 原生 `toggle-conversation` 协议直接切换会话，复制 ID 独立按钮互不干扰。
- **标题行内编辑 & 改名变色**：标题旁 `✎` 一键行内改名（回车/失焦保存，`Esc` 取消）；改过名的标题自动高亮变色，并可在「设置」标签页通过 7 款预设色板或自由取色器自定义颜色。
- **自定义分组（不影响官方工作区）**：自由新建、重命名、归档、删除自定义分组，把任意会话归类到你自己的分类体系中。
- **丰富的会话整理能力**：置顶、★ 收藏、稍后回看、P1~P5 优先级、标签、备注、FTS5 对话正文全文检索。
- **批量管理**：支持整卡点选、全选当前、批量分组、批量改优先级、批量收藏、批量加/移标签、批量归档/恢复/删除。
- **安全独立归档箱**：主列表默认仅归档不删除；彻底删除仅在「归档箱」内经二次确认弹窗后执行。
- **精致交互细节**：全按钮悬停反馈、太阳/月亮纯图标明暗主题切换、旋转动效刷新图标、切回面板自动静默刷新。

## 安装方式

将本仓库克隆或复制到 Antigravity 插件目录：

```bash
# Windows
git clone https://github.com/A16Nights/antigravity-azure-corridor.git "$HOME/.gemini/config/plugins/azure-corridor"

# macOS / Linux
git clone https://github.com/A16Nights/antigravity-azure-corridor.git ~/.gemini/config/plugins/azure-corridor
```

重启或重载 Antigravity（`Ctrl+R`），在右侧栏打开 **苍蓝回廊** 即可使用。

## 数据存储

所有自定义分组、改名、标签、备注、优先级与归档状态均独立保存在：

```text
~/.gemini/azure-corridor/annotations.v1.json
```

不会污染或修改任何 Antigravity 原生会话数据。

## License

MIT
