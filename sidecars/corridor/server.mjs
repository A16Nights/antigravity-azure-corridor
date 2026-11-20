import { checkGithubUpdate } from "../../lib/update-checker.mjs";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CorridorStore } from "../../lib/store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_HTML_PATH = path.join(__dirname, "index.html");
const PORT = Number(process.env.ANTIGRAVITY_SIDECAR_WEB_PORT || process.env.PORT || 19890);
const HOST = "127.0.0.1";

const store = new CorridorStore();

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
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > 256 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
    const pathname = url.pathname;

    if (req.method === "GET" && pathname === "/api/check-update") {
      const force = new URL(req.url, "http://127.0.0.1").searchParams.get("force") === "1";
      const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
      const info = await checkGithubUpdate({ pluginRoot, repo: "A16Nights/antigravity-azure-corridor", force });
      sendJson(res, 200, info);
      return;
    }

    if (req.method === "GET" && pathname === "/healthz") {
      return sendJson(res, 200, { ok: true, service: "azure-corridor" });
    }

    if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      const html = fs.readFileSync(INDEX_HTML_PATH, "utf8");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(html);
      return;
    }

    if (req.method === "GET" && pathname === "/api/state") {
      const q = url.searchParams.get("q") || "";
      const state = store.buildState({ query: q });
      return sendJson(res, 200, { ok: true, ...state });
    }

    if (req.method === "POST" && pathname === "/api/session/update") {
      const body = await readBody(req);
      const result = store.updateSessionMeta(body.id, body.patch || {});
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (req.method === "POST" && pathname === "/api/session/batch") {
      const body = await readBody(req);
      const result = store.batchUpdateSessions(body.ids || [], body.action || "", body.payload || {});
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (req.method === "POST" && pathname === "/api/session/group") {
      const body = await readBody(req);
      const result = store.assignSessionsToGroup(body.ids || [], body.groupId || "", body.newGroupName || "");
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (req.method === "POST" && pathname === "/api/group/create") {
      const body = await readBody(req);
      const result = store.createGroup(body.name);
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (req.method === "POST" && pathname === "/api/group/rename") {
      const body = await readBody(req);
      const result = store.renameGroup(body.groupId, body.name);
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (req.method === "POST" && pathname === "/api/group/archive") {
      const body = await readBody(req);
      const result = store.setGroupArchived(body.groupId, Boolean(body.archived));
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (req.method === "POST" && pathname === "/api/group/delete") {
      const body = await readBody(req);
      const result = store.deleteGroup(body.groupId);
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (req.method === "POST" && pathname === "/api/archive/delete") {
      const body = await readBody(req);
      const result = store.deleteArchivedSessions(body.ids || [], Boolean(body.purgeDisk));
      return sendJson(res, 200, { ok: true, ...result });
    }

    sendJson(res, 404, { ok: false, error: "Not Found" });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err?.message || err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[azure-corridor] listening on http://${HOST}:${PORT}`);
});
