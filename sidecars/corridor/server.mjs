import { checkGithubUpdate } from "../../lib/update-checker.mjs";
import { isLeftSidebarEnabled, setLeftSidebarEnabled, listOwnedPluginsNavState, registerSidecarRuntime, refreshAntigravityMcpServers, injectSidebarToggleWidget } from "../../lib/sidebar-nav.mjs";
import { handleAzureThemeHttp } from "../../lib/azure-theme.mjs";
import { injectAzureUiKit } from "../../lib/azure-ui-kit.mjs";
import { handleAzureOnboardingHttp, injectAzureOnboarding } from "../../lib/azure-onboarding.mjs";
import { CORRIDOR_ONBOARDING_GUIDE } from "./onboarding-guide.mjs";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { CorridorStore } from "../../lib/store.mjs";
import { listOfficialModels, resolveCurrentOfficialModel } from "../../lib/conversation-api.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_HTML_PATH = path.join(__dirname, "index.html");
const PORT = Number(process.env.ANTIGRAVITY_SIDECAR_WEB_PORT || process.env.PORT || 19890);
const HOST = "127.0.0.1";
const TOKEN = (
  process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN ||
  process.env.ANTIGRAVITY_SIDECAR_AUTH_TOKEN ||
  process.env.ANTIGRAVITY_SIDECAR_WEB_TOKEN ||
  ""
).trim();

const store = new CorridorStore();

function isAllowedLocalOrigin(req) {
  const origin = String(req.headers?.origin || "").trim();
  if (!origin || origin === "null") return true;
  try {
    const u = new URL(origin);
    const h = u.hostname.toLowerCase();
    return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
  } catch {
    return false;
  }
}

function safeTokenEqual(a, b) {
  const ba = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function checkAuth(req, url) {
  if (!isAllowedLocalOrigin(req)) return false;
  if (!TOKEN) return true;
  const hdr = req.headers["x-codeium-sidecar-token"] || req.headers["x-sidecar-token"];
  const q = url.searchParams.get("token");
  return safeTokenEqual(hdr, TOKEN) || safeTokenEqual(q, TOKEN);
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > 256 * 1024) {
        settled = true;
        req.destroy();
        const err = new Error("Request body too large");
        err.statusCode = 413;
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        const err = new Error("Invalid JSON");
        err.statusCode = 400;
        reject(err);
      }
    });
    req.on("error", (e) => {
      if (settled) return;
      settled = true;
      reject(e);
    });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
    const pathname = url.pathname;

    if (req.method === "GET" && pathname === "/healthz") {
      return sendJson(res, 200, { ok: true, service: "azure-corridor" });
    }

    if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      const html = fs.readFileSync(INDEX_HTML_PATH, "utf8");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(
        injectAzureOnboarding(
          injectAzureUiKit(injectSidebarToggleWidget(html, "azure-corridor"), "azure-corridor"),
          "azure-corridor",
          CORRIDOR_ONBOARDING_GUIDE
        )
      );
      return;
    }

    if (pathname.startsWith("/api/")) {
      if (!checkAuth(req, url)) {
        return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      }
    }

    if (req.method === "GET" && pathname === "/api/check-update") {
      const force = url.searchParams.get("force") === "1";
      const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
      const info = await checkGithubUpdate({ pluginRoot, repo: "A16Nights/antigravity-azure-corridor", force });
      sendJson(res, 200, info);
      return;
    }

    if (await handleAzureThemeHttp(req, res)) return;
    if (await handleAzureOnboardingHttp(req, res, "azure-corridor", CORRIDOR_ONBOARDING_GUIDE.version)) return;
    if (req.method === "GET" && pathname === "/api/sidebar-nav") {
      sendJson(res, 200, {
        ok: true,
        pluginId: "azure-corridor",
        showInLeftSidebar: isLeftSidebarEnabled("azure-corridor"),
        plugins: listOwnedPluginsNavState()
      });
      return;
    }
    if (req.method === "POST" && pathname === "/api/sidebar-nav") {
      const body = await readBody(req);
      const targetId = String(body.pluginId || "azure-corridor").trim();
      const nextVal = Boolean(body.showInLeftSidebar);
      setLeftSidebarEnabled(targetId, nextVal);
      const rf = await refreshAntigravityMcpServers();
      sendJson(res, 200, {
        ok: true,
        pluginId: targetId,
        showInLeftSidebar: nextVal,
        refreshed: Boolean(rf?.ok),
        plugins: listOwnedPluginsNavState()
      });
      return;
    }
    if (req.method === "GET" && pathname === "/api/native-status") {
      return sendJson(res, 200, { ok: true, ...store.getNativeStatus() });
    }

    if (req.method === "GET" && pathname === "/api/models") {
      const force = url.searchParams.get("force") === "1";
      const sessionId = String(url.searchParams.get("sessionId") || "").trim();
      const info = await listOfficialModels({ force });
      const current = await resolveCurrentOfficialModel({ sessionId, force: false });
      return sendJson(res, 200, {
        ok: true,
        models: info.models || [],
        defaultModelId: info.defaultModelId || "",
        currentModelId: current.modelId || "",
        currentModelLabel: current.label || "",
        currentModelSource: current.source || ""
      });
    }

    if (req.method === "GET" && pathname === "/api/state") {
      const q = url.searchParams.get("q") || "";
      const forceNative = url.searchParams.get("force") === "1";
      const state = await store.buildState({ query: q, forceNative });
      return sendJson(res, 200, { ok: true, ...state });
    }

    if (req.method === "POST" && pathname === "/api/prefs") {
      const body = await readBody(req);
      const uiPrefs = store.saveUiPrefs({
        pinnedFilterTags: Array.isArray(body.pinnedFilterTags) ? body.pinnedFilterTags : undefined
      });
      return sendJson(res, 200, { ok: true, uiPrefs });
    }

    if (req.method === "POST" && pathname === "/api/session/create") {
      const body = await readBody(req);
      const result = await store.createNativeSession({
        title: body.title || "",
        prompt: body.prompt || "",
        model: body.model || "",
        tags: Array.isArray(body.tags) ? body.tags : [],
        projectId: body.projectId || "",
        sourceConversationId: body.sourceConversationId || ""
      });
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (req.method === "POST" && pathname === "/api/session/transfer") {
      const body = await readBody(req);
      const result = await store.transferSessionToProject({
        sourceId: body.sourceId || "",
        targetProjectId: body.targetProjectId || "",
        archiveSource: body.archiveSource !== false,
        model: body.model || "",
        note: body.note || ""
      });
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (req.method === "POST" && pathname === "/api/session/update") {
      const body = await readBody(req);
      const result = await store.updateSession(body.id, body.patch || {});
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (req.method === "POST" && pathname === "/api/session/batch") {
      const body = await readBody(req);
      const result = await store.batchUpdateSessions(body.ids || [], body.action || "", body.payload || {});
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (req.method === "POST" && pathname === "/api/session/delete") {
      const body = await readBody(req);
      const result = await store.deleteSessions(body.ids || []);
      return sendJson(res, 200, { ok: true, ...result });
    }

    sendJson(res, 404, { ok: false, error: "Not Found" });
  } catch (err) {
    sendJson(res, err?.statusCode || 500, { ok: false, error: String(err?.message || err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[azure-corridor] listening on http://${HOST}:${PORT}`);
  try {
    const __a = server.address();
    const __p = (__a && typeof __a === "object" && __a.port) ? __a.port : Number(PORT) || 0;
    const __t = (process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN || process.env.ANTIGRAVITY_SIDECAR_AUTH_TOKEN || process.env.ANTIGRAVITY_SIDECAR_WEB_TOKEN || "").trim();
    const __u = __t ? `http://127.0.0.1:${__p}/?token=${encodeURIComponent(__t)}` : `http://127.0.0.1:${__p}/`;
    registerSidecarRuntime("azure-corridor", { port: __p, url: __u });
  } catch {}
});
