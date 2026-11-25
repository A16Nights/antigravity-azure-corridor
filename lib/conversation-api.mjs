import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";

const DAEMON_DIR = path.join(os.homedir(), ".gemini", "antigravity", "daemon");
const HUB_CACHE_TTL_MS = 5000;
const LIST_CACHE_TTL_MS = 4000;

let cachedHub = null;
let cachedHubAt = 0;
let cachedList = null;
let cachedListAt = 0;

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
