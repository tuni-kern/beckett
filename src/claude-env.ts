/**
 * Environment for `claude` subprocesses the relay spawns.
 *
 * If the relay itself gets started from inside a Claude Code session (common
 * during setup, since Claude Code walks you through it), that session's
 * execution context leaks into the relay's env: CLAUDE_CODE_TMPDIR, TMPDIR,
 * CLAUDE_CODE_SESSION_ID, AI_AGENT, and friends. The spawned `claude` child
 * then inherits a temp dir it may not be able to write to (EACCES on every
 * Bash tool call) and other context that belongs to the parent session, not
 * the bot.
 *
 * Also stripped:
 *  - CLAUDECODE: marks a process as running under Claude Code.
 *  - ANTHROPIC_API_KEY: leaking an API key into the child flips it from
 *    subscription/OAuth auth to direct API auth, which changes billing and
 *    can break newer models on older CLI builds.
 *
 * CLAUDE_PATH is intentionally preserved (it does not start with the
 * CLAUDE_CODE_ prefix and is relay configuration, not leaked context).
 */
const STRIP_EXACT = new Set([
  "CLAUDECODE",
  "ANTHROPIC_API_KEY",
  "AI_AGENT",
  "TMPDIR",
  "TMPPREFIX",
]);

export function childClaudeEnv(
  source: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined) continue;
    if (STRIP_EXACT.has(k)) continue;
    if (k.startsWith("CLAUDE_CODE_")) continue;
    out[k] = v;
  }
  return out;
}
