import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const HOME_DIR = os.homedir();
const ANTIGRAVITY_DIR = path.join(HOME_DIR, ".gemini", "antigravity");
const SUMMARIES_DB_PATH = path.join(ANTIGRAVITY_DIR, "conversation_summaries.db");
const ANNOTATIONS_PBTXT_DIR = path.join(ANTIGRAVITY_DIR, "annotations");
const CONVERSATIONS_DIR = path.join(ANTIGRAVITY_DIR, "conversations");
const BRAIN_DIR = path.join(ANTIGRAVITY_DIR, "brain");

const DATA_DIR = path.join(HOME_DIR, ".gemini", "azure-corridor");
const ANNOTATIONS_PATH = path.join(DATA_DIR, "annotations.v1.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function defaultAnnotations() {
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    sessions: {},
    groups: {}
  };
}

function normalizePriority(val) {
  const n = Number(val);
  if (Number.isInteger(n) && n >= 1 && n <= 5) return n;
  return 3;
}

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

export class CorridorStore {
  loadAnnotations() {
    ensureDataDir();
    if (!fs.existsSync(ANNOTATIONS_PATH)) {
      const init = defaultAnnotations();
      this.saveAnnotations(init);
      return init;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(ANNOTATIONS_PATH, "utf8"));
      return {
        version: 2,
        updatedAt: parsed.updatedAt || new Date().toISOString(),
        sessions: parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {},
        groups: parsed.groups && typeof parsed.groups === "object" ? parsed.groups : {}
      };
    } catch {
      try {
        const corruptPath = `${ANNOTATIONS_PATH}.corrupt.${Date.now()}`;
        if (fs.existsSync(ANNOTATIONS_PATH)) fs.copyFileSync(ANNOTATIONS_PATH, corruptPath);
      } catch {}
      return defaultAnnotations();
    }
  }

  saveAnnotations(data) {
    ensureDataDir();
    const payload = {
      version: 2,
      updatedAt: new Date().toISOString(),
      sessions: data.sessions || {},
      groups: data.groups || {}
    };
    const tmp = `${ANNOTATIONS_PATH}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
      fs.renameSync(tmp, ANNOTATIONS_PATH);
    } catch (err) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
      throw err;
    }
    return payload;
  }

  openDbReadOnly() {
    if (!fs.existsSync(SUMMARIES_DB_PATH)) return null;
    try {
      return new DatabaseSync(SUMMARIES_DB_PATH, { readOnly: true });
    } catch {
      return null;
    }
  }

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
        .prepare("SELECT DISTINCT conversation_id FROM conversations_fts WHERE conversations_fts MATCH ? LIMIT 500")
        .all(ftsQuery);
      return new Set(rows.map((r) => String(r.conversation_id)));
    } catch {
      return new Set();
    } finally {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
  }

  readRawSessions() {
    const db = this.openDbReadOnly();
    if (!db) return [];
    try {
      return db
        .prepare(
          `SELECT conversation_id, title, preview, step_count, last_modified_time,
                  status, parent_conversation_id, nesting_depth, not_fully_idle, last_user_input_time
           FROM conversation_summaries
           WHERE (parent_conversation_id IS NULL OR parent_conversation_id = '')
             AND (nesting_depth IS NULL OR nesting_depth = 0)
           ORDER BY last_modified_time DESC`
        )
        .all();
    } catch {
      return [];
    } finally {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
  }

  readOfficialArchivedMap() {
    const map = new Map();
    const seenPbtxt = new Set();

    // 1) 优先读取 ~/.gemini/antigravity/annotations/<id>.pbtxt（官方归档实时落盘）
    try {
      if (fs.existsSync(ANNOTATIONS_PBTXT_DIR)) {
        for (const name of fs.readdirSync(ANNOTATIONS_PBTXT_DIR)) {
          if (!name.endsWith(".pbtxt")) continue;
          const id = name.slice(0, -6);
          seenPbtxt.add(id);
          try {
            const raw = fs.readFileSync(path.join(ANNOTATIONS_PBTXT_DIR, name), "utf8");
            if (/\barchived\s*:\s*true\b/.test(raw)) {
              const tsMatch = raw.match(/archival_status_timestamp\s*:\s*\{\s*seconds\s*:\s*(\d+)/);
              const archivedAt = tsMatch ? new Date(Number(tsMatch[1]) * 1000).toISOString() : null;
              map.set(id, { archived: true, archivedAt });
            }
          } catch {
            // ignore single file read error
          }
        }
      }
    } catch {
      // ignore dir read error
    }

    // 2) 兜底查询 conversation_summaries.db 的 conversations_fts.archived
    const db = this.openDbReadOnly();
    if (db) {
      try {
        const rows = db
          .prepare("SELECT conversation_id, MAX(archived) AS archived FROM conversations_fts GROUP BY conversation_id")
          .all();
        for (const r of rows) {
          const id = String(r.conversation_id || "");
          if (!id || seenPbtxt.has(id)) continue;
          if (Number(r.archived) === 1) {
            map.set(id, { archived: true, archivedAt: null });
          }
        }
      } catch {
        // ignore if fts table unavailable
      } finally {
        try {
          db.close();
        } catch {
          // ignore
        }
      }
    }

    return map;
  }

  buildState({ query = "" } = {}) {
    const annotations = this.loadAnnotations();
    const rawRows = this.readRawSessions();
    const officialArchivedMap = this.readOfficialArchivedMap();
    const ftsMatches = query.trim() ? this.searchFtsIds(query) : null;
    const qLower = query.trim().toLowerCase();

    const groupsMap = new Map();
    for (const [gid, g] of Object.entries(annotations.groups || {})) {
      if (!g || !g.name) continue;
      groupsMap.set(gid, {
        id: gid,
        name: String(g.name).trim(),
        archived: Boolean(g.archived),
        archivedAt: g.archivedAt || null,
        createdAt: g.createdAt || "",
        sessionCount: 0,
        activeSessionCount: 0,
        lastModifiedTime: ""
      });
    }

    const allSessions = [];
    const allTagsSet = new Set();

    for (const row of rawRows) {
      const id = String(row.conversation_id);
      const meta = annotations.sessions[id] || {};
      if (meta.deleted) continue;

      const rawGroupId = String(meta.groupId || "");
      const groupObj = rawGroupId && groupsMap.has(rawGroupId) ? groupsMap.get(rawGroupId) : null;
      const groupId = groupObj ? groupObj.id : "";
      const groupName = groupObj ? groupObj.name : "未分组";
      const isArchived = Boolean(meta.archived || (groupObj && groupObj.archived));

      const tags = normalizeTags(meta.tags);
      for (const t of tags) allTagsSet.add(t);

      const originalTitle = String(row.title || row.preview || "未命名会话").trim();
      const customTitle = String(meta.customTitle || "").trim();
      const displayTitle = customTitle || originalTitle;
      const note = String(meta.note || "").trim();
      const statusRaw = String(row.status || "");
      const isRunning =
        Boolean(row.not_fully_idle) ||
        (statusRaw.includes("RUNNING") && !statusRaw.includes("IDLE"));

      const officialInfo = officialArchivedMap.get(id) || null;
      const officialArchived = Boolean(officialInfo && officialInfo.archived);
      const officialArchivedAt = officialInfo ? officialInfo.archivedAt : null;

      const sessionObj = {
        id,
        title: displayTitle,
        originalTitle,
        customTitle,
        preview: String(row.preview || "").trim(),
        stepCount: Number(row.step_count || 0),
        lastModifiedTime: String(row.last_modified_time || ""),
        lastUserInputTime: String(row.last_user_input_time || ""),
        status: statusRaw,
        isRunning,
        groupId,
        groupName,
        pinned: Boolean(meta.pinned),
        favorite: Boolean(meta.favorite),
        reviewLater: Boolean(meta.reviewLater),
        priority: normalizePriority(meta.priority),
        tags,
        note,
        archived: isArchived,
        archivedByGroup: Boolean(!meta.archived && groupObj && groupObj.archived),
        archivedAt: meta.archivedAt || (groupObj ? groupObj.archivedAt : null) || null,
        officialArchived,
        officialArchivedAt
      };

      if (groupObj) {
        groupObj.sessionCount += 1;
        if (!isArchived) groupObj.activeSessionCount += 1;
        if (!groupObj.lastModifiedTime || sessionObj.lastModifiedTime > groupObj.lastModifiedTime) {
          groupObj.lastModifiedTime = sessionObj.lastModifiedTime;
        }
      }

      if (qLower) {
        const hitLocal =
          sessionObj.title.toLowerCase().includes(qLower) ||
          sessionObj.originalTitle.toLowerCase().includes(qLower) ||
          sessionObj.id.toLowerCase().includes(qLower) ||
          sessionObj.note.toLowerCase().includes(qLower) ||
          sessionObj.groupName.toLowerCase().includes(qLower) ||
          sessionObj.tags.some((t) => t.toLowerCase().includes(qLower));
        const hitFts = ftsMatches ? ftsMatches.has(id) : false;
        if (!hitLocal && !hitFts) continue;
      }

      allSessions.push(sessionObj);
    }

    const groups = Array.from(groupsMap.values()).sort((a, b) => {
      if (a.archived !== b.archived) return a.archived ? 1 : -1;
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });

    const activeSessions = allSessions.filter((s) => !s.archived);
    const archivedSessions = allSessions.filter((s) => s.archived);

    return {
      dbFound: fs.existsSync(SUMMARIES_DB_PATH),
      totalSessions: allSessions.length,
      activeCount: activeSessions.length,
      archivedCount: archivedSessions.length,
      groups,
      sessions: activeSessions,
      archivedSessions,
      allTags: Array.from(allTagsSet).sort((a, b) => a.localeCompare(b, "zh-CN"))
    };
  }

  createGroup(name) {
    const clean = String(name || "").trim().slice(0, 48);
    if (!clean) throw new Error("分组名称不能为空");
    const data = this.loadAnnotations();
    const dup = Object.values(data.groups).find((g) => g && g.name === clean);
    if (dup) throw new Error(`已存在同名分组「${clean}」`);
    const id = `grp_${crypto.randomBytes(4).toString("hex")}`;
    const group = {
      id,
      name: clean,
      archived: false,
      archivedAt: null,
      createdAt: new Date().toISOString()
    };
    data.groups[id] = group;
    this.saveAnnotations(data);
    return { group };
  }

  renameGroup(groupId, name) {
    const gid = String(groupId || "").trim();
    const clean = String(name || "").trim().slice(0, 48);
    if (!gid || !clean) throw new Error("分组 ID 或名称不能为空");
    const data = this.loadAnnotations();
    if (!data.groups[gid]) throw new Error("未找到该分组");
    data.groups[gid].name = clean;
    this.saveAnnotations(data);
    return { group: data.groups[gid] };
  }

  setGroupArchived(groupId, archived) {
    const gid = String(groupId || "").trim();
    const data = this.loadAnnotations();
    if (!data.groups[gid]) throw new Error("未找到该分组");
    data.groups[gid].archived = Boolean(archived);
    data.groups[gid].archivedAt = data.groups[gid].archived ? new Date().toISOString() : null;
    this.saveAnnotations(data);
    return { group: data.groups[gid] };
  }

  deleteGroup(groupId) {
    const gid = String(groupId || "").trim();
    const data = this.loadAnnotations();
    const target = data.groups[gid];
    if (!target) return { deleted: false };
    const wasArchived = Boolean(target.archived);
    delete data.groups[gid];
    for (const meta of Object.values(data.sessions)) {
      if (meta && meta.groupId === gid) {
        meta.groupId = "";
        if (wasArchived && !meta.archived) {
          meta.archived = true;
          meta.archivedAt = target.archivedAt || new Date().toISOString();
        }
      }
    }
    this.saveAnnotations(data);
    return { deleted: true };
  }

  assignSessionsToGroup(ids = [], groupId = "", newGroupName = "") {
    const cleanIds = Array.isArray(ids) ? ids.map((x) => String(x || "").trim()).filter(Boolean) : [];
    if (!cleanIds.length) return { updated: 0 };
    const data = this.loadAnnotations();

    let targetGroupId = String(groupId || "").trim();
    const newName = String(newGroupName || "").trim().slice(0, 48);
    if (newName) {
      const existing = Object.values(data.groups).find((g) => g && g.name === newName);
      if (existing) {
        targetGroupId = existing.id;
      } else {
        const id = `grp_${crypto.randomBytes(4).toString("hex")}`;
        data.groups[id] = {
          id,
          name: newName,
          archived: false,
          archivedAt: null,
          createdAt: new Date().toISOString()
        };
        targetGroupId = id;
      }
    }

    for (const id of cleanIds) {
      const cur = { ...(data.sessions[id] || {}) };
      cur.groupId = targetGroupId;
      data.sessions[id] = cur;
    }

    this.saveAnnotations(data);
    return { updated: cleanIds.length, groupId: targetGroupId };
  }

  updateSessionMeta(id, patch = {}) {
    const cleanId = String(id || "").trim();
    if (!cleanId) throw new Error("会话 ID 不能为空");
    const data = this.loadAnnotations();
    const cur = { ...(data.sessions[cleanId] || {}) };

    if (patch.pinned !== undefined) cur.pinned = Boolean(patch.pinned);
    if (patch.favorite !== undefined) cur.favorite = Boolean(patch.favorite);
    if (patch.reviewLater !== undefined) cur.reviewLater = Boolean(patch.reviewLater);
    if (patch.priority !== undefined) cur.priority = normalizePriority(patch.priority);
    if (patch.tags !== undefined) cur.tags = normalizeTags(patch.tags);
    if (patch.note !== undefined) cur.note = String(patch.note || "").slice(0, 2000);
    if (patch.customTitle !== undefined) cur.customTitle = String(patch.customTitle || "").trim().slice(0, 160);
    if (patch.groupId !== undefined) cur.groupId = String(patch.groupId || "").trim();
    if (patch.archived !== undefined) {
      cur.archived = Boolean(patch.archived);
      cur.archivedAt = cur.archived ? new Date().toISOString() : null;
      // 恢复单条随已归档分组一起归档的会话时，将其移出已归档分组确保真正恢复到活跃回廊
      if (!cur.archived && cur.groupId && data.groups[cur.groupId]?.archived) {
        cur.groupId = "";
      }
    }

    data.sessions[cleanId] = cur;
    this.saveAnnotations(data);
    return { id: cleanId, meta: cur };
  }

  batchUpdateSessions(ids = [], action = "", payload = {}) {
    const cleanIds = Array.isArray(ids) ? ids.map((x) => String(x || "").trim()).filter(Boolean) : [];
    if (!cleanIds.length) return { updated: 0 };
    const data = this.loadAnnotations();
    const now = new Date().toISOString();

    for (const id of cleanIds) {
      const cur = { ...(data.sessions[id] || {}) };
      if (action === "archive") {
        cur.archived = true;
        cur.archivedAt = now;
      } else if (action === "unarchive") {
        cur.archived = false;
        cur.archivedAt = null;
        if (cur.groupId && data.groups[cur.groupId]?.archived) {
          cur.groupId = "";
        }
      } else if (action === "favorite") {
        cur.favorite = Boolean(payload.value ?? true);
      } else if (action === "reviewLater") {
        cur.reviewLater = Boolean(payload.value ?? true);
      } else if (action === "priority") {
        cur.priority = normalizePriority(payload.priority);
      } else if (action === "addTag") {
        const tag = String(payload.tag || "").trim();
        if (tag) cur.tags = normalizeTags([...(cur.tags || []), tag]);
      } else if (action === "removeTag") {
        const tag = String(payload.tag || "").trim().toLowerCase();
        cur.tags = (cur.tags || []).filter((t) => String(t).toLowerCase() !== tag);
      }
      data.sessions[id] = cur;
    }
    this.saveAnnotations(data);
    return { updated: cleanIds.length };
  }

  deleteArchivedSessions(ids = [], purgeDisk = false) {
    const cleanIds = Array.isArray(ids) ? ids.map((x) => String(x || "").trim()).filter(Boolean) : [];
    if (!cleanIds.length) return { deleted: 0, purgedFiles: 0 };
    const data = this.loadAnnotations();
    let deleted = 0;
    let purgedFiles = 0;

    for (const id of cleanIds) {
      const cur = data.sessions[id] || {};
      cur.deleted = true;
      cur.deletedAt = new Date().toISOString();
      data.sessions[id] = cur;
      deleted += 1;

      if (purgeDisk && /^[a-f0-9-]{16,}$/i.test(id)) {
        const targets = [
          path.join(CONVERSATIONS_DIR, `${id}.db`),
          path.join(CONVERSATIONS_DIR, `${id}.db-wal`),
          path.join(CONVERSATIONS_DIR, `${id}.db-shm`),
          path.join(CONVERSATIONS_DIR, `${id}.pb`),
          path.join(BRAIN_DIR, id)
        ];
        for (const t of targets) {
          try {
            if (fs.existsSync(t)) {
              fs.rmSync(t, { recursive: true, force: true });
              purgedFiles += 1;
            }
          } catch {
            // ignore locked files
          }
        }
      }
    }

    this.saveAnnotations(data);
    return { deleted, purgedFiles };
  }
}
