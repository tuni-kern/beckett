/**
 * Shared Context Module
 *
 * Provides context-gathering and prompt-building functions
 * used by the Telegram relay.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  getMemoryContext,
  getRelevantContext,
  getRecentHistory,
} from "./memory.ts";

const PROJECT_ROOT = dirname(dirname(import.meta.path));

// ============================================================
// SUPABASE
// ============================================================

export const supabase: SupabaseClient | null =
  process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
    : null;

// Session boundary detection for conversation chunking
const SESSION_GAP_MS = 2 * 60 * 60 * 1000; // 2 hours
const FORCE_CLOSE_MS = 24 * 60 * 60 * 1000; // 24 hours
let lastMessageTime: string | null = null;
let sessionStartTime: string | null = null;

/**
 * Initialize session tracking from the most recent message in DB.
 * Called once on startup so we know where the last session left off.
 */
async function initSessionTracking(): Promise<void> {
  if (!supabase || lastMessageTime !== null) return;
  try {
    const { data } = await supabase
      .from("messages")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1);
    if (data?.[0]) {
      lastMessageTime = data[0].created_at;
      sessionStartTime = lastMessageTime;
    }
  } catch {
    // Non-critical — we'll pick it up on first message
  }
}

/**
 * Trigger chunking of a completed session via the Edge Function.
 * Fire-and-forget — does not block message handling.
 */
function triggerSessionChunking(sessionStart: string, sessionEnd: string): void {
  if (!supabase) return;
  console.log(`[chunking] Session boundary detected. Chunking ${sessionStart} → ${sessionEnd}`);
  supabase.functions
    .invoke("chunk-conversation", {
      body: { session_start: sessionStart, session_end: sessionEnd },
    })
    .then(({ data, error }) => {
      if (error) {
        console.error("[chunking] Edge Function error:", error);
      } else {
        console.log("[chunking] Result:", JSON.stringify(data));
      }
    })
    .catch((err) => {
      console.error("[chunking] Invocation failed:", err);
    });
}

export async function saveMessage(
  role: string,
  content: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  if (!supabase) return;

  // Initialize session tracking on first call
  await initSessionTracking();

  const now = new Date().toISOString();

  try {
    // Check for session boundary before saving
    if (lastMessageTime) {
      const gap = Date.now() - new Date(lastMessageTime).getTime();

      if (gap >= SESSION_GAP_MS && sessionStartTime) {
        // Session gap detected — chunk the previous session
        triggerSessionChunking(sessionStartTime, lastMessageTime);
        sessionStartTime = now; // new session starts with this message
      } else if (gap >= FORCE_CLOSE_MS && sessionStartTime) {
        // Force-close: been over 24 hours
        triggerSessionChunking(sessionStartTime, lastMessageTime);
        sessionStartTime = now;
      }
    } else {
      // First message ever
      sessionStartTime = now;
    }

    await supabase.from("messages").insert({
      role,
      content,
      channel: metadata?.channel || "telegram",
      metadata: metadata || {},
    });

    lastMessageTime = now;
  } catch (error) {
    console.error("Supabase save error:", error);
  }
}

// ============================================================
// PROFILE & CONFIG
// ============================================================

let profileContext = "";
try {
  profileContext = readFileSync(join(PROJECT_ROOT, "config", "profile.md"), "utf-8");
} catch {
  // No profile yet — that's fine
}

const USER_NAME = process.env.USER_NAME || "";
const USER_TIMEZONE =
  process.env.USER_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;

// ============================================================
// CONTEXT GATHERING
// ============================================================

export interface GatheredContext {
  recentHistory: string;
  relevantContext: string;
  memoryContext: string;
}

export async function gatherContext(
  userMessage: string,
  historyLimit: number = 10
): Promise<GatheredContext> {
  const [recentHistory, relevantContext, memoryContext] = await Promise.all([
    getRecentHistory(supabase, historyLimit),
    getRelevantContext(supabase, userMessage),
    getMemoryContext(supabase),
  ]);
  return { recentHistory, relevantContext, memoryContext };
}

// ============================================================
// PROMPT BUILDING
// ============================================================

export function buildPrompt(
  userMessage: string,
  relevantContext?: string,
  memoryContext?: string,
  recentHistory?: string,
  modelName?: string
): string {
  const now = new Date();
  const timeStr = now.toLocaleString("en-US", {
    timeZone: USER_TIMEZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const assistantName = process.env.ASSISTANT_NAME || "Beckett";

  const parts = [
    `You are ${assistantName}, a personal AI assistant. You respond via Telegram. Keep responses concise and conversational.`,
    "You have access to the full server environment — you can run commands, read/write files, deploy code, and manage services.",
  ];

  if (modelName) parts.push(`You are currently running on ${modelName}.`);
  if (USER_NAME) parts.push(`You are speaking with ${USER_NAME}.`);
  parts.push(`Current time: ${timeStr}`);
  if (profileContext) parts.push(`\nProfile:\n${profileContext}`);
  if (memoryContext) parts.push(`\n${memoryContext}`);
  if (recentHistory) parts.push(`\n${recentHistory}`);
  if (relevantContext) parts.push(`\n${relevantContext}`);

  parts.push(
    "\nSAFETY RULE:" +
      "\nNEVER make changes to repositories, websites, files, or any live systems without explicitly asking the user for confirmation first." +
      "\nYou may freely read, search, and explore — but before editing files, committing, pushing, deploying, or running any destructive commands, " +
      "describe what you plan to do and wait for the user to approve."
  );

  parts.push(
    "\nMEMORY MANAGEMENT:" +
      "\nWhen the user shares something worth remembering, sets goals, or completes goals, " +
      "include these tags in your response (they are processed automatically and hidden from the user):" +
      "\n[REMEMBER: fact to store]" +
      "\n[GOAL: goal text | DEADLINE: optional date]" +
      "\n[DONE: search text for completed goal]"
  );

  parts.push(`\nUser: ${userMessage}`);

  return parts.join("\n");
}
