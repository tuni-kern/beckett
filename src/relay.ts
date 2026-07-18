/**
 * Beckett — Telegram Relay
 *
 * Minimal relay that connects Telegram to Claude Code CLI.
 * Customize this for your own needs.
 *
 * Run: bun run src/relay.ts
 */

import { Bot, Context, InputFile } from "grammy";
import { spawn } from "bun";
import { writeFile, mkdir, readFile, unlink } from "fs/promises";
import { join, dirname } from "path";
import { childClaudeEnv } from "./claude-env.ts";
import { parseClaudeOutput } from "./claude-output.ts";
import { sweepOldUploads } from "./uploads.ts";
import { processMemoryIntents } from "./memory.ts";
import {
  supabase,
  saveMessage,
  gatherContext,
  buildPrompt,
} from "./context.ts";

const PROJECT_ROOT = dirname(dirname(import.meta.path));

// ============================================================
// CONFIGURATION
// ============================================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const ALLOWED_USER_ID = process.env.TELEGRAM_USER_ID || "";
const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";
const PROJECT_DIR = process.env.PROJECT_DIR || "";
const RELAY_DIR = process.env.RELAY_DIR || join(process.env.HOME || "~", ".claude-relay");

// Model routing
const MODELS = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5-20251001",
} as const;

const OPUS_KEYWORDS =
  /\b(refactor|debug|code|implement|fix bug|pull request|merge|commit|deploy|push|PR|github|git\b)/i;

const SONNET_KEYWORDS =
  /\b(analyze|research|compare|explain|review|plan|summarize|write|draft)\b/i;

function pickModel(text: string): string {
  if (OPUS_KEYWORDS.test(text)) return MODELS.opus;
  if (text.length > 500) return MODELS.sonnet;
  if (SONNET_KEYWORDS.test(text)) return MODELS.sonnet;
  return MODELS.haiku;
}

function modelLabel(modelId: string): string {
  if (modelId.includes("opus")) return "Claude Opus 4.8";
  if (modelId.includes("sonnet")) return "Claude Sonnet 5";
  if (modelId.includes("haiku")) return "Claude Haiku 4.5";
  return modelId;
}

// Directories
const TEMP_DIR = join(RELAY_DIR, "temp");
const UPLOADS_DIR = join(RELAY_DIR, "uploads");

// Uploads are kept for follow-up questions and swept by age (see uploads.ts)
const UPLOAD_MAX_AGE_MS = 48 * 60 * 60 * 1000;

// Session tracking for conversation continuity
const SESSION_FILE = join(RELAY_DIR, "session.json");

interface SessionState {
  sessionId: string | null;
  lastActivity: string;
}

// ============================================================
// SESSION MANAGEMENT
// ============================================================

async function loadSession(): Promise<SessionState> {
  try {
    const content = await readFile(SESSION_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return { sessionId: null, lastActivity: new Date().toISOString() };
  }
}

async function saveSession(state: SessionState): Promise<void> {
  await writeFile(SESSION_FILE, JSON.stringify(state, null, 2));
}

let session = await loadSession();

// ============================================================
// LOCK FILE (prevent multiple instances)
// ============================================================

const LOCK_FILE = join(RELAY_DIR, "bot.lock");

async function acquireLock(): Promise<boolean> {
  try {
    const existingLock = await readFile(LOCK_FILE, "utf-8").catch(() => null);

    if (existingLock) {
      const pid = parseInt(existingLock);
      try {
        process.kill(pid, 0); // Check if process exists
        console.log(`Another instance running (PID: ${pid})`);
        return false;
      } catch {
        console.log("Stale lock found, taking over...");
      }
    }

    await writeFile(LOCK_FILE, process.pid.toString());
    return true;
  } catch (error) {
    console.error("Lock error:", error);
    return false;
  }
}

async function releaseLock(): Promise<void> {
  await unlink(LOCK_FILE).catch(() => {});
}

// Cleanup on exit
process.on("exit", () => {
  try {
    require("fs").unlinkSync(LOCK_FILE);
  } catch {}
});
process.on("SIGINT", async () => {
  await releaseLock();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await releaseLock();
  process.exit(0);
});

// ============================================================
// SETUP
// ============================================================

if (!BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN not set!");
  console.log("\nTo set up:");
  console.log("1. Message @BotFather on Telegram");
  console.log("2. Create a new bot with /newbot");
  console.log("3. Copy the token to .env");
  process.exit(1);
}

// Create directories
await mkdir(TEMP_DIR, { recursive: true });
await mkdir(UPLOADS_DIR, { recursive: true });

// Acquire lock
if (!(await acquireLock())) {
  console.error("Could not acquire lock. Another instance may be running.");
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

// ============================================================
// SECURITY: Only respond to authorized user
// ============================================================

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id.toString();

  // If ALLOWED_USER_ID is set, enforce it
  if (ALLOWED_USER_ID && userId !== ALLOWED_USER_ID) {
    console.log(`Unauthorized: ${userId}`);
    await ctx.reply("This bot is private.");
    return;
  }

  await next();
});

// ============================================================
// CORE: Call Claude CLI
// ============================================================

async function callClaude(
  prompt: string,
  options?: { resume?: boolean; imagePath?: string; model?: string }
): Promise<string> {
  const args = [
    CLAUDE_PATH,
    "-p",
    prompt,
    "--allowedTools",
    "Bash",
    "Read",
    "Glob",
    "Grep",
    "Edit",
    "Write",
    "WebFetch",
    "WebSearch",
    "mcp__*",
  ];

  // Model selection
  if (options?.model) {
    args.push("--model", options.model);

    // Adaptive-thinking-only models (Opus 4.7+, Sonnet 5) reject
    // thinking.type.enabled (the CLI default). Force adaptive thinking via
    // --effort, which maps to thinking.type.adaptive + effort. Haiku 4.5 still
    // uses extended thinking and errors on --effort, so it is excluded.
    if (options.model.includes("opus") || options.model.includes("sonnet-5")) {
      args.push("--effort", "high");
    }
  }

  // Resume previous session if available and requested
  if (options?.resume && session.sessionId) {
    args.push("--resume", session.sessionId);
  }

  // JSON output is required to capture session_id for --resume; text mode
  // prints only the response body, so session continuity silently never
  // worked (the old "Session ID:" regex never matched anything).
  args.push("--output-format", "json");

  const modelInfo = options?.model || "default";
  console.log(`Calling Claude (${modelInfo}): ${prompt.substring(0, 50)}...`);

  try {
    const proc = spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
      cwd: PROJECT_DIR || undefined,
      // childClaudeEnv strips leaked Claude-Code context (CLAUDE_CODE_*,
      // TMPDIR, AI_AGENT, ...), CLAUDECODE, and ANTHROPIC_API_KEY. See
      // src/claude-env.ts for why each matters.
      env: childClaudeEnv(),
    });

    const output = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.error("Claude error:", stderr);
      return `Error: ${stderr || "Claude exited with code " + exitCode}`;
    }

    const parsed = parseClaudeOutput(output);

    if (parsed.isError) {
      console.error("Claude reported error result:", parsed.text.slice(0, 500));
      return `Error: ${parsed.text || "Claude reported an error"}`;
    }

    if (parsed.sessionId) {
      session.sessionId = parsed.sessionId;
      session.lastActivity = new Date().toISOString();
      await saveSession(session);
    }

    return parsed.text;
  } catch (error) {
    console.error("Spawn error:", error);
    return `Error: Could not run Claude CLI`;
  }
}

// ============================================================
// MESSAGE HANDLERS
// ============================================================

// Text messages
bot.on("message:text", async (ctx) => {
  let text = ctx.message.text;
  console.log(`Message: ${text.substring(0, 50)}...`);

  await ctx.replyWithChatAction("typing");

  // Command override: /opus, /sonnet, /haiku
  let model: string | undefined;
  const commandMatch = text.match(/^\/(opus|sonnet|haiku)\s+([\s\S]+)/i);
  if (commandMatch) {
    const cmd = commandMatch[1].toLowerCase() as keyof typeof MODELS;
    model = MODELS[cmd];
    text = commandMatch[2];
  } else {
    model = pickModel(text);
  }

  await saveMessage("user", text);

  let response = "";

  try {
    const { recentHistory, relevantContext, memoryContext } =
      await gatherContext(text, 20);

    const enrichedPrompt = buildPrompt(text, relevantContext, memoryContext, recentHistory, model ? modelLabel(model) : undefined);
    const rawResponse = await callClaude(enrichedPrompt, { resume: true, model });

    // Parse and save any memory intents, strip tags from response
    response = await processMemoryIntents(supabase, rawResponse);
  } catch (err: any) {
    console.error("Message handling error:", err);
    response = "Sorry, something went wrong.";
  }

  await saveMessage("assistant", response);
  await sendResponse(ctx, response);
});

// Voice messages — placeholder for V2 (voice transcription add-on)
bot.on("message:voice", async (ctx) => {
  await ctx.reply(
    "Voice transcription is not set up yet. " +
      "See the setup guide to enable voice support (Groq or local Whisper)."
  );
});

// Photos/Images
bot.on("message:photo", async (ctx) => {
  console.log("Image received");
  await ctx.replyWithChatAction("typing");

  const caption = ctx.message.caption || "Analyze this image.";

  try {
    const photos = ctx.message.photo;
    const photo = photos[photos.length - 1];
    const file = await ctx.api.getFile(photo.file_id);

    const timestamp = Date.now();
    const filePath = join(UPLOADS_DIR, `image_${timestamp}.jpg`);

    const response = await fetch(
      `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`
    );
    const buffer = await response.arrayBuffer();
    await writeFile(filePath, Buffer.from(buffer));

    // Keep the file for follow-up questions; sweep old uploads by age
    // instead of unlinking immediately.
    await sweepOldUploads(UPLOADS_DIR, UPLOAD_MAX_AGE_MS);

    const prompt = `The user sent an image. Use your Read tool to view it at: ${filePath}\n\nThen respond to their message: ${caption}`;

    await saveMessage("user", `[Image saved at ${filePath}]: ${caption}`);

    const claudeResponse = await callClaude(prompt, { resume: true, model: MODELS.sonnet });

    const cleanResponse = await processMemoryIntents(supabase, claudeResponse);
    await saveMessage("assistant", cleanResponse);
    await sendResponse(ctx, cleanResponse);
  } catch (error: any) {
    console.error("Image error:", error);
    await ctx.reply("Could not process image.");
  }
});

// Documents
bot.on("message:document", async (ctx) => {
  const doc = ctx.message.document;
  console.log(`Document: ${doc.file_name}`);
  await ctx.replyWithChatAction("typing");

  const caption = ctx.message.caption || `Analyze: ${doc.file_name}`;

  try {
    const file = await ctx.getFile();
    const timestamp = Date.now();
    const fileName = doc.file_name || `file_${timestamp}`;
    const filePath = join(UPLOADS_DIR, `${timestamp}_${fileName}`);

    const response = await fetch(
      `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`
    );
    const buffer = await response.arrayBuffer();
    await writeFile(filePath, Buffer.from(buffer));

    // Keep the file for follow-up questions ("explain this document") — the
    // resumed session and the path in saved history both depend on it still
    // existing. Old uploads are swept by age instead of unlinked immediately.
    await sweepOldUploads(UPLOADS_DIR, UPLOAD_MAX_AGE_MS);

    const prompt = `The user sent a document. Use your Read tool to view it at: ${filePath}\n\nThen respond to their message: ${caption}`;

    await saveMessage("user", `[Document: ${doc.file_name} saved at ${filePath}]: ${caption}`);

    const claudeResponse = await callClaude(prompt, { resume: true, model: MODELS.sonnet });

    const cleanResponse = await processMemoryIntents(supabase, claudeResponse);
    await saveMessage("assistant", cleanResponse);
    await sendResponse(ctx, cleanResponse);
  } catch (error: any) {
    console.error("Document error:", error);
    await ctx.reply("Could not process document.");
  }
});

// ============================================================
// HELPERS
// ============================================================

async function sendResponse(ctx: Context, response: string): Promise<void> {
  // Telegram has a 4096 character limit
  const MAX_LENGTH = 4000;

  if (response.length <= MAX_LENGTH) {
    await ctx.reply(response);
  } else {
    // Split long responses
    const chunks = [];
    let remaining = response;

    while (remaining.length > 0) {
      if (remaining.length <= MAX_LENGTH) {
        chunks.push(remaining);
        break;
      }

      // Try to split at a natural boundary
      let splitIndex = remaining.lastIndexOf("\n\n", MAX_LENGTH);
      if (splitIndex === -1) splitIndex = remaining.lastIndexOf("\n", MAX_LENGTH);
      if (splitIndex === -1) splitIndex = remaining.lastIndexOf(" ", MAX_LENGTH);
      if (splitIndex === -1) splitIndex = MAX_LENGTH;

      chunks.push(remaining.substring(0, splitIndex));
      remaining = remaining.substring(splitIndex).trim();
    }

    for (const chunk of chunks) {
      await ctx.reply(chunk);
    }
  }
}

// ============================================================
// START
// ============================================================

console.log("Starting Beckett...");
console.log(`Authorized user: ${ALLOWED_USER_ID || "ANY (not recommended)"}`);
console.log(`Project directory: ${PROJECT_DIR || "(relay working directory)"}`);

bot.start({
  onStart: () => {
    console.log("Bot is running!");
  },
});
