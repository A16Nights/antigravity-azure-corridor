import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  listAllNativeConversations,
  getNativeConversation,
  updateNativeConversation,
  deleteNativeConversation,
  createNativeConversation,
  getNativeHubInfo,
  resolveCurrentOfficialModel
} from "./conversation-api.mjs";

const HOME_DIR = os.homedir();
const ANTIGRAVITY_DIR = path.join(HOME_DIR, ".gemini", "antigravity");
const PROJECTS_DIR = path.join(HOME_DIR, ".gemini", "config", "projects");
const SUMMARIES_DB_PATH = path.join(ANTIGRAVITY_DIR, "conversation_summaries.db");

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const out = [];
  for (const t of tags) {
    const clean = String(t || "").trim().slice(0, 32);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= 20) break;
  }
  return out;
}

function decodeFolderUri(uri) {
  const raw = String(uri || "").trim();
  if (!raw) return "";
  if (raw.startsWith("file://")) {
    try {
      return fileURLToPath(raw);
    } catch {
      return decodeURIComponent(raw.replace(/^file:\/\/\/?/, ""));
    }
  }
  return raw;
}

export class CorridorStore {
  /**
   * 读取 Antigravity 官方工作区/项目配置（~/.gemini/config/projects/*.json），
   * 自动过滤掉插件内部 sidecar 项目。
   */
  loadOfficialProjects() {
    const projects = [];
    if (!fs.existsSync(PROJECTS_DIR)) return projects;
    try {
      for (const name of fs.readdirSync(PROJECTS_DIR)) {
        if (!name.endsWith(".json")) continue;
        try {
          const j = JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, name), "utf8"));
          if (!j || !j.id) continue;
          // 排除内置 sidecar 虚拟项目
          if (j.sidecar && j.sidecar.sidecarId) continue;
          const resources = Array.isArray(j.projectResources?.resources) ? j.projectResources.resources : [];
          const folders = resources
            .map((r) => decodeFolderUri(r?.folderUri))
            .filter(Boolean);
          projects.push({
            id: String(j.id),
            name: String(j.name || path.basename(folders[0] || j.id)).trim(),
            folders,
            activeCount: 0,
            archivedCount: 0,
            totalCount: 0,
            lastModifiedTime: ""
          });
        } catch {
          // ignore broken project file
        }
      }
    } catch {
      // ignore fs error
    }
    return projects.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }

  openDbReadOnly() {
    if (!fs.existsSync(SUMMARIES_DB_PATH)) return null;
    try {
      return new DatabaseSync(SUMMARIES_DB_PATH, { readOnly: true });
    } catch {
      return null;
    }
  }

  /**
   * 只读 FTS5 正文全文索引检索（仅用于加速搜索，不写任何非官方状态）。
   */
  searchFtsIds(query) {
    const q = String(query || "").trim();
    if (!q) return null;
    const db = this.openDbReadOnly();
    if (!db) return new Set();
    try {
      const tokens = q
        .split(/\s+/)
        .map((t) => t.replace(/["*^():+\-]/g, "").trim())
        .filter(Boolean);
      if (!tokens.length) return null;
      const ftsQuery = tokens.map((t) => `"${t}"*`).join(" AND ");
      const rows = db
        .prepare("SELECT DISTINCT conversation_id FROM conversations_fts WHERE conversations_fts MATCH ? LIMIT 5000")
        .all(ftsQuery);
      return new Set(rows.map((r) => String(r.conversation_id)));
    } catch {
      return new Set();
    } finally {
      try { db.close(); } catch {}
    }
  }

  /**
   * 只读读取 SQLite 里的 step_count / preview 补充信息（仅作元数据辅助与离线降级）。
   */
  readSqliteSupplementalMap() {
    const map = new Map();
    const db = this.openDbReadOnly();
    if (!db) return map;
    try {
      const rows = db
        .prepare(
          `SELECT conversation_id, title, preview, step_count, last_modified_time,
                  status, project_id, group_id, parent_conversation_id, nesting_depth,
                  not_fully_idle, last_user_input_time
           FROM conversation_summaries
           WHERE (parent_conversation_id IS NULL OR parent_conversation_id = '')
             AND (nesting_depth IS NULL OR nesting_depth = 0)
           ORDER BY last_modified_time DESC`
        )
        .all();
      for (const r of rows) {
        map.set(String(r.conversation_id), r);
      }
    } catch {
      // ignore
    } finally {
      try { db.close(); } catch {}
    }
    return map;
  }

  /**
   * 以 Antigravity 2.35+ 官方 ConversationService 为唯一真源构建状态。
   * 全部标题、置顶、收藏、归档、标签、分组 ID、工作区归属与运行状态均严格同步官方。
   */
  async buildState({ query = "", forceNative = false } = {}) {
    const projects = this.loadOfficialProjects();
    const projectMap = new Map(projects.map((p) => [p.id, p]));
    const standaloneProject = {
      id: "outside-of-project",
      name: "无工作区（独立会话）",
      folders: [],
      activeCount: 0,
      archivedCount: 0,
      totalCount: 0,
      lastModifiedTime: "",
      isStandalone: true
    };

    const sqlMap = this.readSqliteSupplementalMap();
    const ftsMatches = query.trim() ? this.searchFtsIds(query) : null;
    const qLower = query.trim().toLowerCase();

    let nativeRes = { ok: false, conversations: [], lsVersion: "" };
    try {
      nativeRes = await listAllNativeConversations({ includeArchived: true, force: forceNative });
    } catch {
      nativeRes = { ok: false, conversations: [], lsVersion: "" };
    }

    const allSessions = [];
    const allTagsSet = new Set();
    const allGroupsSet = new Set();

    const pushSession = (s) => {
      for (const t of s.tags) allTagsSet.add(t);
      if (s.conversationGroupId) allGroupsSet.add(s.conversationGroupId);

      const projTarget = projectMap.get(s.projectId) || standaloneProject;
      projTarget.totalCount += 1;
      if (s.archived) projTarget.archivedCount += 1;
      else projTarget.activeCount += 1;
      if (s.lastModifiedTime && (!projTarget.lastModifiedTime || s.lastModifiedTime > projTarget.lastModifiedTime)) {
        projTarget.lastModifiedTime = s.lastModifiedTime;
      }

      if (qLower) {
        const hitLocal =
          s.title.toLowerCase().includes(qLower) ||
          s.summary.toLowerCase().includes(qLower) ||
          s.id.toLowerCase().includes(qLower) ||
          s.projectName.toLowerCase().includes(qLower) ||
          s.conversationGroupId.toLowerCase().includes(qLower) ||
          s.tags.some((t) => t.toLowerCase().includes(qLower));
        const hitFts = ftsMatches ? ftsMatches.has(s.id) : false;
        if (!hitLocal && !hitFts) return;
      }
      allSessions.push(s);
    };

    if (nativeRes.ok && Array.isArray(nativeRes.conversations)) {
      for (const nc of nativeRes.conversations) {
        if (!nc || !nc.id) continue;
        if (nc.metadata?.parentConversationId) continue;
        const id = String(nc.id);
        const ann = nc.annotations || {};
        const st = nc.state || {};
        const md = nc.metadata || {};
        const sqlRow = sqlMap.get(id) || null;

        const rawProjectId = String(md.projectId || sqlRow?.project_id || "").trim();
        const proj = projectMap.get(rawProjectId) || null;
        const projectId = proj ? proj.id : "outside-of-project";
        const projectName = proj ? proj.name : standaloneProject.name;
        const projectFolders = proj ? proj.folders : [];

        const title = String(ann.title || st.summary || sqlRow?.title || sqlRow?.preview || "未命名会话").trim();
        const summary = String(st.summary || sqlRow?.preview || "").trim();
        const tags = normalizeTags([...(ann.tags || []), ...(md.tags || [])]);
        const conversationGroupId = String(ann.conversationGroupId || "").trim();
        const runState = String(st.runState || "");
        const isRunning = runState === "RUN_STATE_RUNNING" || runState === "RUN_STATE_CANCELLING";
        const lastModifiedTime = String(st.updateTime || sqlRow?.last_modified_time || md.createTime || "");

        pushSession({
          id,
          title,
          summary,
          hasCustomTitle: Boolean(ann.title),
          stepCount: Number(sqlRow?.step_count || 0),
          createTime: String(md.createTime || ""),
          lastModifiedTime,
          runState,
          isRunning,
          projectId,
          projectName,
          projectFolders,
          conversationGroupId,
          pinned: Boolean(ann.pinned),
          starred: Boolean(ann.starred),
          archived: Boolean(ann.archived),
          tags
        });
      }
    } else {
      // 原生服务未就绪时的只读兜底
      for (const [id, row] of sqlMap.entries()) {
        const rawProjectId = String(row.project_id || "").trim();
        const proj = projectMap.get(rawProjectId) || null;
        const projectId = proj ? proj.id : "outside-of-project";
        const projectName = proj ? proj.name : standaloneProject.name;
        const statusRaw = String(row.status || "");
        pushSession({
          id,
          title: String(row.title || row.preview || "未命名会话").trim(),
          summary: String(row.preview || "").trim(),
          hasCustomTitle: false,
          stepCount: Number(row.step_count || 0),
          createTime: "",
          lastModifiedTime: String(row.last_modified_time || ""),
          runState: statusRaw,
          isRunning: Boolean(row.not_fully_idle) || (statusRaw.includes("RUNNING") && !statusRaw.includes("IDLE")),
          projectId,
          projectName,
          projectFolders: proj ? proj.folders : [],
          conversationGroupId: String(row.group_id || "").trim(),
          pinned: false,
          starred: false,
          archived: false,
          tags: []
        });
      }
    }

    const projectList = [...projects];
    if (standaloneProject.totalCount > 0) {
      projectList.push(standaloneProject);
    }

    const activeSessions = allSessions.filter((s) => !s.archived);
    const archivedSessions = allSessions.filter((s) => s.archived);

    return {
      dbFound: fs.existsSync(SUMMARIES_DB_PATH),
      nativeApi: {
        connected: Boolean(nativeRes.ok),
        lsVersion: nativeRes.lsVersion || getNativeHubInfo().lsVersion || "",
        count: nativeRes.ok ? nativeRes.conversations.length : 0
      },
      totalSessions: allSessions.length,
      activeCount: activeSessions.length,
      archivedCount: archivedSessions.length,
      projects: projectList,
      sessions: activeSessions,
      archivedSessions,
      allTags: Array.from(allTagsSet).sort((a, b) => a.localeCompare(b, "zh-CN")),
      allGroups: Array.from(allGroupsSet).sort((a, b) => a.localeCompare(b, "zh-CN"))
    };
  }

  /**
   * 直写官方原生 ConversationService/UpdateConversation。
   */
  async updateSession(id, patch = {}) {
    const cleanId = String(id || "").trim();
    if (!cleanId) throw new Error("会话 ID 不能为空");

    const annotations = {};
    if (patch.title !== undefined) annotations.title = String(patch.title || "").trim().slice(0, 160);
    if (patch.pinned !== undefined) annotations.pinned = Boolean(patch.pinned);
    if (patch.starred !== undefined) annotations.starred = Boolean(patch.starred);
    if (patch.archived !== undefined) annotations.archived = Boolean(patch.archived);
    if (patch.tags !== undefined) {
      const cleanTags = normalizeTags(patch.tags);
      if (cleanTags.length > 0) annotations.tags = cleanTags;
    }
    if (patch.conversationGroupId !== undefined) {
      annotations.conversationGroupId = String(patch.conversationGroupId || "").trim().slice(0, 64);
    }

    const res = await updateNativeConversation(cleanId, annotations);
    if (!res.ok) {
      throw new Error(res.error || "同步官方 ConversationService 失败，请确认 Antigravity 2.35+ 正在运行");
    }
    return { id: cleanId, conversation: res.data || null, nativeSynced: true };
  }

  /**
   * 批量直写官方原生 ConversationService/UpdateConversation。
   */
  async batchUpdateSessions(ids = [], action = "", payload = {}) {
    const cleanIds = Array.isArray(ids) ? ids.map((x) => String(x || "").trim()).filter(Boolean) : [];
    if (!cleanIds.length) return { updated: 0 };

    const results = await Promise.all(
      cleanIds.map(async (id) => {
        const annotations = {};
        if (action === "archive") annotations.archived = true;
        else if (action === "unarchive") annotations.archived = false;
        else if (action === "pin") annotations.pinned = Boolean(payload.value ?? true);
        else if (action === "star") annotations.starred = Boolean(payload.value ?? true);
        else if (action === "setGroup") annotations.conversationGroupId = String(payload.conversationGroupId || "").trim();
        else if (action === "addTag") {
          const tag = String(payload.tag || "").trim();
          if (!tag) return { ok: false };
          const cur = await getNativeConversation(id);
          const curTags = Array.isArray(cur.data?.annotations?.tags) ? cur.data.annotations.tags : [];
          annotations.tags = normalizeTags([...curTags, tag]);
        } else {
          return { ok: false, error: `不支持的批量操作: ${action}` };
        }
        return updateNativeConversation(id, annotations);
      })
    );

    const updated = results.filter((r) => r && r.ok).length;
    if (updated === 0 && cleanIds.length > 0) {
      const firstErr = results.find((r) => r && r.error)?.error || "官方接口调用失败";
      throw new Error(firstErr);
    }
    return { updated, total: cleanIds.length };
  }

  /**
   * 永久删除会话：直接调用官方 ConversationService/DeleteConversation。
   */
  async deleteSessions(ids = []) {
    const cleanIds = Array.isArray(ids) ? ids.map((x) => String(x || "").trim()).filter(Boolean) : [];
    if (!cleanIds.length) return { deleted: 0 };

    const results = await Promise.all(cleanIds.map((id) => deleteNativeConversation(id)));
    const deleted = results.filter((r) => r && r.ok).length;
    if (deleted === 0 && cleanIds.length > 0) {
      const firstErr = results.find((r) => r && r.error)?.error || "官方永久删除失败";
      throw new Error(firstErr);
    }
    return { deleted, total: cleanIds.length };
  }

  /**
   * 在指定官方工作区（projectId）创建原生会话。
   */
  async createNativeSession({ title = "", prompt = "", model = "", tags = [], projectId = "", sourceConversationId = "" } = {}) {
    const cleanProjectId = projectId === "outside-of-project" ? "" : String(projectId || "").trim();
    let effectiveModel = String(model || "").trim();
    if (!effectiveModel || effectiveModel === "__current__") {
      const resolved = await resolveCurrentOfficialModel({ sessionId: sourceConversationId });
      effectiveModel = resolved.modelId || "";
    }
    const res = await createNativeConversation({
      title,
      prompt,
      model: effectiveModel,
      tags: normalizeTags(tags),
      projectId: cleanProjectId
    });
    if (!res.ok) {
      throw new Error(res.error || "创建原生会话失败，请确认 Antigravity 2.35+ 正在运行");
    }
    return { conversation: res.data?.conversation || null, usedModel: effectiveModel };
  }

  /**
   * 跨工作区转移续聊（纯官方接口实现）：
   * Antigravity 2.35+ 将已有会话的 metadata.projectId 设为不可变创建属性，
   * 因此在目标工作区通过 CreateConversation 拉起续接会话（继承标题/标签/分组并附带原会话信息），
   * 并按选项通过 UpdateConversation 将原会话归档。
   */
  async transferSessionToProject({ sourceId = "", targetProjectId = "", archiveSource = true, model = "", note = "", sendPrompt = true } = {}) {
    const sid = String(sourceId || "").trim();
    if (!sid) throw new Error("原会话 ID 不能为空");

    const cur = await getNativeConversation(sid);
    if (!cur.ok || !cur.data) {
      throw new Error(cur.error || "无法读取原会话信息");
    }
    const src = cur.data;
    const srcTitle = String(src.annotations?.title || src.state?.summary || "未命名会话").trim();
    const srcSummary = String(src.state?.summary || "").trim();
    const srcTags = normalizeTags([...(src.annotations?.tags || []), ...(src.metadata?.tags || [])]);
    const srcGroup = String(src.annotations?.conversationGroupId || "").trim();

    const projects = this.loadOfficialProjects();
    const srcProj = projects.find((p) => p.id === src.metadata?.projectId);
    const dstProj = projects.find((p) => p.id === targetProjectId);
    const dstProjectId = targetProjectId === "outside-of-project" ? "" : String(targetProjectId || "").trim();

    const promptLines = [
      `此会话从工作区「${srcProj ? srcProj.name : "无工作区"}」转移至「${dstProj ? dstProj.name : "无工作区"}」继续推进。`,
      `原会话标题：${srcTitle}`,
      `原会话 ID：${sid}`,
      srcSummary ? `原会话摘要：${srcSummary}` : "",
      String(note || "").trim() ? `补充说明：${String(note).trim()}` : "",
      `请先了解上述背景（如需回看原会话详细记录，可直接读取 ~/.gemini/antigravity/brain/${sid}/.system_generated/logs/transcript.jsonl），准备好后告诉我继续处理。`
    ].filter(Boolean);

    let effectiveModel = String(model || "").trim();
    if (!effectiveModel || effectiveModel === "__current__") {
      const resolved = await resolveCurrentOfficialModel({ sessionId: sid });
      effectiveModel = resolved.modelId || "";
    }

    const created = await createNativeConversation({
      title: srcTitle,
      projectId: dstProjectId,
      model: effectiveModel,
      tags: srcTags,
      prompt: sendPrompt ? promptLines.join("\n") : ""
    });
    if (!created.ok || !created.data?.conversation?.id) {
      throw new Error(created.error || "在目标工作区创建续接会话失败");
    }

    const newConv = created.data.conversation;
    // 若原会话有置顶/收藏/分组，也同步到新会话
    const inheritAnn = {};
    if (src.annotations?.pinned) inheritAnn.pinned = true;
    if (src.annotations?.starred) inheritAnn.starred = true;
    if (srcGroup) inheritAnn.conversationGroupId = srcGroup;
    if (Object.keys(inheritAnn).length > 0) {
      await updateNativeConversation(newConv.id, inheritAnn).catch(() => {});
    }

    let sourceArchived = false;
    if (archiveSource) {
      const archRes = await updateNativeConversation(sid, { archived: true });
      sourceArchived = Boolean(archRes.ok);
    }

    return {
      conversation: newConv,
      sourceId: sid,
      sourceArchived,
      usedModel: effectiveModel
    };
  }

  getNativeStatus() {
    return getNativeHubInfo();
  }
}
