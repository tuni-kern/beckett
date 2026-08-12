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

export async function saveMessage(
  role: string,
  content: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  if (!supabase) return;

  try {
    await supabase.from("messages").insert({
      role,
      content,
      channel: metadata?.channel || "telegram",
      metadata: metadata || {},
    });
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

  // Instruction blocks go BEFORE conversation history so that deictic user
  // references ("this document", "that file") bind to conversation content,
  // not to these blocks. With this scaffolding adjacent to the user message,
  // "explain this document" after a PDF analysis got the SAFETY RULE/MEMORY
  // blocks described as "the document".
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

  if (memoryContext) parts.push(`\n${memoryContext}`);
  if (relevantContext) parts.push(`\n${relevantContext}`);
  if (recentHistory) parts.push(`\n${recentHistory}`);

  parts.push(`\nUser: ${userMessage}`);

  return parts.join("\n");
}
