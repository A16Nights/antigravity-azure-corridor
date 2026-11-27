// azure-corridor · 零 LLM 崩溃/卡死抢救简报 & 跨工作区增强交接生成器
// 纯本地快速扫描 transcript.jsonl（<20ms），自动脱敏凭据，支持卡死抢救与无缝续聊。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME_DIR = process.env.USERPROFILE || os.homedir();
const BRAIN_DIR = path.join(HOME_DIR, ".gemini", "antigravity", "brain");
const MAX_TAIL_BYTES = 2 * 1024 * 1024;

const REDACT_RULES = [
  { re: /\b(ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, rep: "[REDACTED_GH_TOKEN]" },
  { re: /\b(sk-[A-Za-z0-9_-]{16,})\b/g, rep: "[REDACTED_API_KEY]" },
  { re: /\b(AIza[0-9A-Za-z_-]{20,})\b/g, rep: "[REDACTED_GOOGLE_KEY]" },
  { re: /(Authorization\s*:\s*(?:Bearer|Basic)\s+)[^\s"'`]+/gi, rep: "$1[REDACTED]" },
  { re: /((?:api[_-]?key|access[_-]?token|secret|password)\s*[=:]\s*["']?)[^\s"'`,;]{8,}/gi, rep: "$1[REDACTED]" }
];

export function redactText(text) {
  let out = String(text || "");
  for (const r of REDACT_RULES) out = out.replace(r.re, r.rep);
  return out;
}

function cleanMessageText(raw) {
  let body = "";
  if (typeof raw === "string") body = raw;
  else if (raw && typeof raw === "object") {
    if (typeof raw.text === "string") body = raw.text;
    else if (Array.isArray(raw.parts)) body = raw.parts.map((p) => p?.text || "").join("\n");
  }
  return redactText(
    body
      .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, "")
      .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/g, "")
      .replace(/<CONTEXT_SUMMARY>[\s\S]*?<\/CONTEXT_SUMMARY>/g, "")
      .replace(/<\/?USER_REQUEST>/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function extractFilePathsFromArgs(args) {
  if (!args || typeof args !== "object") return [];
  const out = [];
  for (const key of ["Path", "path", "TargetFile", "targetFile", "filePath"]) {
    if (typeof args[key] === "string" && args[key].trim()) out.push(args[key].trim());
  }
  if (Array.isArray(args.edits)) {
    for (const e of args.edits) {
      if (typeof e?.path === "string" && e.path.trim()) out.push(e.path.trim());
    }
  }
  return out;
}

/**
 * 扫描指定会话的 transcript.jsonl，提取脱敏后的结构化进度快照。
 */
export function inspectRescueSnapshot(conversationId, { brainDir = BRAIN_DIR } = {}) {
  const cid = String(conversationId || "").trim();
  if (!cid || /[\\/]/.test(cid)) {
    return { found: false, conversationId: cid };
  }
  const tPath = path.join(brainDir, cid, ".system_generated", "logs", "transcript.jsonl");
  if (!fs.existsSync(tPath)) {
    return { found: false, conversationId: cid, transcriptPath: tPath };
  }

  let rawBuf;
  let truncated = false;
  const stat = fs.statSync(tPath);
  if (stat.size > MAX_TAIL_BYTES) {
    truncated = true;
    const fd = fs.openSync(tPath, "r");
    try {
      rawBuf = Buffer.allocUnsafe(MAX_TAIL_BYTES);
      const len = fs.readSync(fd, rawBuf, 0, MAX_TAIL_BYTES, stat.size - MAX_TAIL_BYTES);
      rawBuf = rawBuf.subarray(0, len);
    } finally {
      fs.closeSync(fd);
    }
  } else {
    rawBuf = fs.readFileSync(tPath);
  }

  const lines = rawBuf.toString("utf8").split(/\r?\n/);
  const startIdx = truncated ? 1 : 0;

  let lastCheckpointIdx = -1;
  for (let i = lines.length - 1; i >= startIdx; i -= 1) {
    if (lines[i] && lines[i].includes('"CHECKPOINT"')) {
      try {
        const rec = JSON.parse(lines[i]);
        if (String(rec?.type || "") === "CHECKPOINT") {
          lastCheckpointIdx = i;
          break;
        }
      } catch {}
    }
  }

  let lastModel = "";
  let actualTokens = null;
  let cacheHitRate = null;
  let lastReply = "";
  const recentUsers = [];
  const modifiedFiles = [];
  const seenFiles = new Set();
  const recentCommands = [];
  let totalSteps = 0;

  const scanMin = Math.max(startIdx, lines.length - 900);
  for (let i = lines.length - 1; i >= scanMin; i -= 1) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (!totalSteps && Number.isFinite(Number(rec.step_index))) {
      totalSteps = Number(rec.step_index) + 1;
    }
    const t = String(rec?.type || "");

    if (t === "PLANNER_RESPONSE") {
      if (!lastModel && typeof rec.model === "string" && rec.model.trim()) {
        lastModel = rec.model.trim();
      }
      if (actualTokens === null && i > lastCheckpointIdx) {
        const inp = Number(rec.input_tokens);
        const cache = Number(rec.cache_read_tokens || 0);
        if (Number.isFinite(inp) && inp >= 0 && inp + cache > 0) {
          actualTokens = inp + cache;
          cacheHitRate = Math.round((cache / actualTokens) * 100);
        }
      }
      if (!lastReply) {
        const cleaned = cleanMessageText(rec.content ?? rec.text);
        if (cleaned) lastReply = cleaned.slice(0, 280);
      }
      if (Array.isArray(rec.tool_calls)) {
        for (let j = rec.tool_calls.length - 1; j >= 0; j -= 1) {
          const tc = rec.tool_calls[j];
          const name = String(tc?.name || "");
          const args = tc?.args || tc?.arguments || {};
          if (/edit_file|write_file|replace_file_content|apply_edits/i.test(name) && modifiedFiles.length < 10) {
            for (const fp of extractFilePathsFromArgs(args)) {
              const norm = fp.replace(/\\/g, "/");
              const key = norm.toLowerCase();
              if (!seenFiles.has(key)) {
                seenFiles.add(key);
                modifiedFiles.push(redactText(norm));
              }
            }
          }
          if (/run_command|run_checks/i.test(name) && recentCommands.length < 3) {
            const label = String(args.toolSummary || args.CommandLine || "").trim();
            if (label) {
              const cleanCmd = redactText(label.replace(/\s+/g, " ").slice(0, 100));
              if (!recentCommands.includes(cleanCmd)) recentCommands.push(cleanCmd);
            }
          }
        }
      }
    } else if (t === "USER_INPUT" && recentUsers.length < 3) {
      const cleaned = cleanMessageText(rec.content ?? rec.text);
      if (cleaned && cleaned !== "/compact") {
        recentUsers.push(cleaned.slice(0, 160));
      }
    }
  }

  return {
    found: true,
    conversationId: cid,
    transcriptPath: tPath,
    fileSizeKb: Math.round(stat.size / 1024),
    totalSteps,
    compacted: lastCheckpointIdx >= 0,
    lastModel,
    actualTokens,
    cacheHitRate,
    recentUsers: recentUsers.reverse(),
    modifiedFiles,
    recentCommands: recentCommands.reverse(),
    lastReply
  };
}

/**
 * 生成完整 Markdown 脱敏崩溃/卡死抢救简报（适合直接粘贴到全新对话无缝续接）。
 */
export function buildRescueBrief(conversationId, meta = {}, options = {}) {
  const snap = inspectRescueSnapshot(conversationId, options);
  const title = redactText(String(meta.title || "未命名会话").trim());
  const proj = redactText(String(meta.projectName || "无工作区").trim());
  const cid = String(conversationId || "").trim();

  const lines = [
    `# 会话抢救 / 无缝续接简报`,
    ``,
    `- **原会话标题**：${title}`,
    `- **原会话 ID**：\`${cid}\``,
    `- **所属工作区**：${proj}`
  ];
  if (snap.found) {
    if (snap.lastModel) lines.push(`- **最近使用模型**：\`${snap.lastModel}\``);
    if (snap.actualTokens !== null) {
      const cachePart = typeof snap.cacheHitRate === "number" ? `（缓存命中 ${snap.cacheHitRate}%）` : "";
      lines.push(`- **活跃上下文实测**：约 ${Math.round(snap.actualTokens / 1000)}k tokens${cachePart}`);
    }
    lines.push(`- **日志记录**：${snap.totalSteps || "--"} 步（${snap.fileSizeKb} KB${snap.compacted ? "，含压缩点" : ""}）`);
  }

  if (snap.found && snap.recentUsers.length > 0) {
    lines.push(``, `## 最近核心诉求`);
    snap.recentUsers.forEach((u, idx) => lines.push(`${idx + 1}. ${u}`));
  }

  if (snap.found && snap.modifiedFiles.length > 0) {
    lines.push(``, `## 近期修改 / 新建文件`);
    snap.modifiedFiles.forEach((f) => lines.push(`- \`${f}\``));
  }

  if (snap.found && snap.recentCommands.length > 0) {
    lines.push(``, `## 最近执行与验证线索`);
    snap.recentCommands.forEach((c) => lines.push(`- ${c}`));
  }

  if (snap.found && snap.lastReply) {
    lines.push(``, `## 最近一轮进展摘要`, `> ${snap.lastReply}`);
  }

  lines.push(
    ``,
    `---`,
    `请基于以上脱敏抢救简报接续推进任务；如需回看更早完整细节，可读取 \`~/.gemini/antigravity/brain/${cid}/.system_generated/logs/transcript.jsonl\`。`
  );

  return {
    ok: true,
    found: snap.found,
    brief: lines.join("\n"),
    stats: {
      lastModel: snap.lastModel || "",
      actualTokens: snap.actualTokens ?? null,
      cacheHitRate: snap.cacheHitRate ?? null,
      modifiedCount: snap.modifiedFiles?.length || 0,
      userCount: snap.recentUsers?.length || 0,
      totalSteps: snap.totalSteps || 0
    }
  };
}

/**
 * 为跨工作区转移续聊生成精炼交接段落（控长 <= 600 字符，零 LLM）。
 */
export function buildTransferContextBlock(conversationId, options = {}) {
  const snap = inspectRescueSnapshot(conversationId, options);
  if (!snap.found) return "";
  const parts = [];
  if (snap.recentUsers.length > 0) {
    parts.push(`最近诉求：${snap.recentUsers.slice(-2).join(" → ")}`);
  }
  if (snap.modifiedFiles.length > 0) {
    const shortFiles = snap.modifiedFiles.slice(0, 6).map((f) => {
      const segs = f.split("/").filter(Boolean);
      return segs.length > 2 ? segs.slice(-2).join("/") : f;
    });
    parts.push(`近期改动文件：${shortFiles.join("、")}`);
  }
  if (snap.recentCommands.length > 0) {
    parts.push(`最近校验：${snap.recentCommands[snap.recentCommands.length - 1]}`);
  }
  if (snap.lastReply) {
    parts.push(`最后进展：${snap.lastReply.slice(0, 160)}`);
  }
  let text = parts.join("\n");
  if (text.length > 600) text = text.slice(0, 599) + "…";
  return text;
}
