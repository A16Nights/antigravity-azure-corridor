import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";

const DAEMON_DIR = path.join(os.homedir(), ".gemini", "antigravity", "daemon");
const HUB_CACHE_TTL_MS = 5000;
const LIST_CACHE_TTL_MS = 4000;
const MODELS_CACHE_TTL_MS = 60000;

let cachedHub = null;
let cachedHubAt = 0;
let cachedList = null;
let cachedListAt = 0;
let cachedModels = null;
let cachedModelsAt = 0;

function isPidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    return err && err.code === "EPERM";
  }
}

function parseEnvHub() {
  const addr = String(process.env.ANTIGRAVITY_LS_ADDRESS || "").trim();
  const csrfToken = String(process.env.ANTIGRAVITY_CSRF_TOKEN || "").trim();
  if (!addr || !csrfToken) return null;
  const idx = addr.lastIndexOf(":");
  if (idx <= 0) return null;
  const host = addr.slice(0, idx).replace(/^\[|\]$/g, "") || "127.0.0.1";
  const port = Number(addr.slice(idx + 1));
  if (!Number.isInteger(port) || port <= 0) return null;
  return {
    source: "env",
    host,
    httpPort: port,
    httpsPort: 0,
    csrfToken,
    lsVersion: String(process.env.ANTIGRAVITY_LS_VERSION || ""),
    pid: process.pid
  };
}

export function discoverHub({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedHub && now - cachedHubAt < HUB_CACHE_TTL_MS) {
    return cachedHub;
  }

  const fromEnv = parseEnvHub();
  if (fromEnv) {
    cachedHub = fromEnv;
    cachedHubAt = now;
    return cachedHub;
  }

  try {
    if (!fs.existsSync(DAEMON_DIR)) {
      cachedHub = null;
      cachedHubAt = now;
      return null;
    }
    const files = fs
      .readdirSync(DAEMON_DIR)
      .filter((f) => /^hub_.*\.json$/i.test(f))
      .map((f) => {
        const full = path.join(DAEMON_DIR, f);
        try {
          const stat = fs.statSync(full);
          return { full, mtimeMs: stat.mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (const item of files) {
      try {
        const j = JSON.parse(fs.readFileSync(item.full, "utf8"));
        const httpPort = Number(j.httpPort || 0);
        const httpsPort = Number(j.httpsPort || 0);
        if ((httpPort > 0 || httpsPort > 0) && j.csrfToken && isPidAlive(j.pid)) {
          cachedHub = {
            source: "daemon",
            host: "127.0.0.1",
            httpPort,
            httpsPort,
            csrfToken: String(j.csrfToken),
            lsVersion: String(j.lsVersion || ""),
            pid: Number(j.pid)
          };
          cachedHubAt = now;
          return cachedHub;
        }
      } catch {
        // ignore broken hub json
      }
    }
  } catch {
    // ignore fs error
  }

  cachedHub = null;
  cachedHubAt = now;
  return null;
}

function sendConnectRequest({ proto, host, port, csrfToken, method, payload, timeoutMs }) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload || {});
    const mod = proto === "https" ? https : http;
    const req = mod.request(
      {
        hostname: host || "127.0.0.1",
        port,
        path: `/product.v1.ConversationService/${method}`,
        method: "POST",
        rejectUnauthorized: false,
        timeout: timeoutMs,
        headers: {
          "Content-Type": "application/json",
          "Connect-Protocol-Version": "1",
          "Content-Length": Buffer.byteLength(body),
          "x-antigravity-csrf-token": csrfToken
        }
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let data = null;
          try {
            data = raw ? JSON.parse(raw) : {};
          } catch {
            data = { raw };
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, status: res.statusCode, data });
          } else {
            resolve({
              ok: false,
              status: res.statusCode,
              error: data?.message || data?.code || `HTTP ${res.statusCode}`,
              data
            });
          }
        });
      }
    );
    req.on("timeout", () => {
      try {
        req.destroy();
      } catch {}
      resolve({ ok: false, error: "timeout" });
    });
    req.on("error", (err) => {
      resolve({ ok: false, error: err?.message || "request_error" });
    });
    req.write(body);
    req.end();
  });
}

export async function callConversationService(method, payload = {}, { timeoutMs = 3500, forceDiscover = false } = {}) {
  let hub = discoverHub({ force: forceDiscover });
  if (!hub) return { ok: false, unavailable: true, error: "no_alive_hub" };

  const attempts = [];
  if (hub.httpPort > 0) attempts.push({ proto: "http", port: hub.httpPort });
  if (hub.httpsPort > 0) attempts.push({ proto: "https", port: hub.httpsPort });

  let lastErr = { ok: false, error: "no_port" };
  for (const a of attempts) {
    const res = await sendConnectRequest({
      proto: a.proto,
      host: hub.host,
      port: a.port,
      csrfToken: hub.csrfToken,
      method,
      payload,
      timeoutMs
    });
    if (res.ok) return { ...res, lsVersion: hub.lsVersion };
    lastErr = res;
  }

  // 端口失效时强制重发现重试一次
  if (!forceDiscover) {
    const fresh = discoverHub({ force: true });
    if (fresh && (fresh.httpPort !== hub.httpPort || fresh.httpsPort !== hub.httpsPort)) {
      return callConversationService(method, payload, { timeoutMs, forceDiscover: true });
    }
  }

  return lastErr;
}

export function invalidateConversationCache() {
  cachedList = null;
  cachedListAt = 0;
}

export async function listAllNativeConversations({
  includeArchived = true,
  pageSize = 100,
  maxPages = 30,
  force = false
} = {}) {
  const now = Date.now();
  if (!force && cachedList && now - cachedListAt < LIST_CACHE_TTL_MS) {
    return cachedList;
  }

  const all = [];
  let pageToken = "";
  let lsVersion = "";
  let pages = 0;

  while (pages < maxPages) {
    pages += 1;
    const body = { pageSize: Math.min(Math.max(Number(pageSize) || 100, 1), 100), includeArchived };
    if (pageToken) body.pageToken = pageToken;
    const res = await callConversationService("ListConversations", body);
    if (!res.ok) {
      return { ok: false, unavailable: Boolean(res.unavailable), error: res.error, conversations: [] };
    }
    if (res.lsVersion) lsVersion = res.lsVersion;
    const list = Array.isArray(res.data?.conversations) ? res.data.conversations : [];
    for (const c of list) {
      if (c && c.id) all.push(c);
    }
    pageToken = String(res.data?.nextPageToken || "").trim();
    if (!pageToken) break;
  }

  const result = {
    ok: true,
    lsVersion,
    conversations: all,
    truncated: Boolean(pageToken)
  };
  cachedList = result;
  cachedListAt = now;
  return result;
}

export async function getNativeConversation(conversationId) {
  const id = String(conversationId || "").trim();
  if (!id) return { ok: false, error: "empty_id" };
  return callConversationService("GetConversation", { conversationId: id });
}

export async function updateNativeConversation(conversationId, annotations = {}) {
  const id = String(conversationId || "").trim();
  if (!id) return { ok: false, error: "empty_id" };
  const clean = {};
  if (annotations.title !== undefined) clean.title = String(annotations.title || "").trim().slice(0, 160);
  if (annotations.archived !== undefined) clean.archived = Boolean(annotations.archived);
  if (annotations.pinned !== undefined) clean.pinned = Boolean(annotations.pinned);
  if (annotations.starred !== undefined) clean.starred = Boolean(annotations.starred);
  if (Array.isArray(annotations.tags) && annotations.tags.length > 0) {
    clean.tags = annotations.tags.map((t) => String(t || "").trim()).filter(Boolean).slice(0, 20);
  }
  if (annotations.conversationGroupId !== undefined) {
    clean.conversationGroupId = String(annotations.conversationGroupId || "").trim().slice(0, 64);
  }
  if (Object.keys(clean).length === 0) return { ok: true, skipped: true };

  const res = await callConversationService("UpdateConversation", {
    conversationId: id,
    annotations: clean
  });
  if (res.ok) invalidateConversationCache();
  return res;
}

export async function deleteNativeConversation(conversationId) {
  const id = String(conversationId || "").trim();
  if (!id) return { ok: false, error: "empty_id" };
  const res = await callConversationService("DeleteConversation", { conversationId: id });
  if (res.ok) invalidateConversationCache();
  return res;
}

export async function createNativeConversation({ title = "", prompt = "", model = "", tags = [], projectId = "" } = {}) {
  const payload = {};
  if (String(title || "").trim()) payload.title = String(title).trim().slice(0, 160);
  if (String(model || "").trim()) payload.model = String(model).trim();
  if (String(projectId || "").trim()) payload.projectId = String(projectId).trim();
  if (Array.isArray(tags) && tags.length > 0) {
    payload.tags = tags.map((t) => String(t || "").trim()).filter(Boolean).slice(0, 20);
  }
  const promptText = String(prompt || "").trim();
  if (promptText) {
    payload.prompt = [{ text: promptText }];
  }
  const res = await callConversationService("CreateConversation", payload, { timeoutMs: 8000 });
  if (res.ok) invalidateConversationCache();
  return res;
}

export function getNativeHubInfo() {
  const hub = discoverHub();
  if (!hub) return { connected: false, lsVersion: "", source: "none" };
  return {
    connected: true,
    lsVersion: hub.lsVersion || "",
    source: hub.source
  };
}

function sendLsRequest({ proto, host, port, csrfToken, endpoint, payload, timeoutMs }) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload || {});
    const mod = proto === "https" ? https : http;
    const req = mod.request(
      {
        hostname: host || "127.0.0.1",
        port,
        path: endpoint,
        method: "POST",
        rejectUnauthorized: false,
        timeout: timeoutMs,
        headers: {
          "Content-Type": "application/json",
          "Connect-Protocol-Version": "1",
          "Content-Length": Buffer.byteLength(body),
          "x-codeium-csrf-token": csrfToken,
          "x-antigravity-csrf-token": csrfToken
        }
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let data = null;
          try {
            data = raw ? JSON.parse(raw) : {};
          } catch {
            data = null;
          }
          if (res.statusCode >= 200 && res.statusCode < 300 && data) {
            resolve({ ok: true, data });
          } else {
            resolve({ ok: false, status: res.statusCode });
          }
        });
      }
    );
    req.on("timeout", () => {
      try { req.destroy(); } catch {}
      resolve({ ok: false, error: "timeout" });
    });
    req.on("error", (err) => resolve({ ok: false, error: err?.message || "request_error" }));
    req.write(body);
    req.end();
  });
}

/**
 * 从本机运行中的 Antigravity Language Server 实时获取官方内置模型列表（自动过滤外部自定义挂载模型）
 */
export async function listOfficialModels({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedModels && now - cachedModelsAt < MODELS_CACHE_TTL_MS) {
    return cachedModels;
  }

  const hub = discoverHub({ force });
  if (!hub) return { ok: false, models: [], defaultModelId: "" };

  const attempts = [];
  if (hub.httpsPort > 0) attempts.push({ proto: "https", port: hub.httpsPort });
  if (hub.httpPort > 0) attempts.push({ proto: "http", port: hub.httpPort });

  for (const a of attempts) {
    const res = await sendLsRequest({
      proto: a.proto,
      host: hub.host,
      port: a.port,
      csrfToken: hub.csrfToken,
      endpoint: "/exa.language_server_pb.LanguageServerService/GetUserStatus",
      payload: {},
      timeoutMs: 4000
    });
    if (!res.ok || !res.data) continue;
    const cfgData = res.data?.userStatus?.cascadeModelConfigData || {};
    const defaultEnum = cfgData.defaultOverrideModelConfig?.modelOrAlias?.model
      || cfgData.defaultOverrideModelConfig?.modelOrAlias?.alias
      || "";
    const configs = Array.isArray(cfgData.clientModelConfigs) ? cfgData.clientModelConfigs : [];
    const seen = new Set();
    const models = [];
    let defaultModelId = "";
    for (const c of configs) {
      const label = String(c?.label || "").trim();
      const modelId = String(c?.modelId || "").trim();
      const enumVal = String(c?.modelOrAlias?.model || c?.modelOrAlias?.alias || "").trim();
      if (!label || !modelId) continue;
      if (modelId.startsWith("custom-")) continue;
      if (seen.has(modelId)) continue;
      seen.add(modelId);
      const isDefault = Boolean(defaultEnum && enumVal && enumVal === defaultEnum);
      if (isDefault) defaultModelId = modelId;
      models.push({
        modelId,
        label,
        tag: String(c?.tagTitle || "").trim(),
        isDefault
      });
    }
    cachedModels = { ok: true, models, defaultModelId };
    cachedModelsAt = now;
    return cachedModels;
  }

  return cachedModels || { ok: false, models: [], defaultModelId: "" };
}

const BRAIN_ROOT_DIR = path.join(os.homedir(), ".gemini", "antigravity", "brain");

/**
 * 从指定会话的 transcript.jsonl 尾部快速解析最近一次实际使用的模型 ID（仅保留官方模型，忽略外部 custom- 挂载模型）。
 */
export function detectSessionLastModel(conversationId) {
  const id = String(conversationId || "").trim();
  if (!id || /[\\/]/.test(id)) return "";
  const tPath = path.join(BRAIN_ROOT_DIR, id, ".system_generated", "logs", "transcript.jsonl");
  try {
    if (!fs.existsSync(tPath)) return "";
    const st = fs.statSync(tPath);
    if (!st.isFile() || st.size <= 0) return "";
    const readLen = Math.min(st.size, 65536);
    const buf = Buffer.alloc(readLen);
    const fd = fs.openSync(tPath, "r");
    try {
      fs.readSync(fd, buf, 0, readLen, st.size - readLen);
    } finally {
      fs.closeSync(fd);
    }
    const tail = buf.toString("utf8");
    const matches = [...tail.matchAll(/"model"\s*:\s*"([^"]+)"/g)];
    for (let i = matches.length - 1; i >= 0; i -= 1) {
      const m = String(matches[i][1] || "").trim();
      if (!m || m.startsWith("custom-")) continue;
      return m;
    }
  } catch {}
  return "";
}

/**
 * 扫描最近活跃的若干会话日志，推断客户端当前正在使用的官方模型 ID。
 */
export function detectRecentActiveOfficialModel(officialIdSet = null) {
  try {
    if (!fs.existsSync(BRAIN_ROOT_DIR)) return "";
    const entries = fs.readdirSync(BRAIN_ROOT_DIR, { withFileTypes: true });
    const recent = [];
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const tPath = path.join(BRAIN_ROOT_DIR, ent.name, ".system_generated", "logs", "transcript.jsonl");
      try {
        const st = fs.statSync(tPath);
        if (st.isFile() && st.size > 0) {
          recent.push({ id: ent.name, mtimeMs: st.mtimeMs });
        }
      } catch {}
    }
    recent.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const item of recent.slice(0, 8)) {
      const m = detectSessionLastModel(item.id);
      if (!m) continue;
      if (officialIdSet && officialIdSet.size > 0 && !officialIdSet.has(m)) continue;
      return m;
    }
  } catch {}
  return "";
}

/**
 * 解析“默认（当前使用模型）”应落地的具体官方模型：
 * 1) 若指定了 sessionId，优先沿用该源会话最近使用的官方模型；
 * 2) 否则/未命中时，沿用本机最近活跃会话使用的官方模型；
 * 3) 再回退到 Antigravity 客户端当前官方默认模型（defaultModelId）。
 */
export async function resolveCurrentOfficialModel({ sessionId = "", force = false } = {}) {
  const info = await listOfficialModels({ force });
  const list = Array.isArray(info?.models) ? info.models : [];
  const byId = new Map(list.map((m) => [m.modelId, m]));
  const idSet = new Set(byId.keys());

  const sid = String(sessionId || "").trim();
  if (sid) {
    const sessModel = detectSessionLastModel(sid);
    if (sessModel && (idSet.size === 0 || idSet.has(sessModel))) {
      return {
        modelId: sessModel,
        label: byId.get(sessModel)?.label || sessModel,
        source: "session"
      };
    }
  }

  const activeModel = detectRecentActiveOfficialModel(idSet);
  if (activeModel) {
    return {
      modelId: activeModel,
      label: byId.get(activeModel)?.label || activeModel,
      source: "active"
    };
  }

  const fallbackId = String(info?.defaultModelId || "").trim();
  if (fallbackId) {
    return {
      modelId: fallbackId,
      label: byId.get(fallbackId)?.label || fallbackId,
      source: "default"
    };
  }

  return { modelId: "", label: "", source: "" };
}
