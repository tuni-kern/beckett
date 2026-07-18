/**
 * Parser for `claude -p --output-format json` stdout.
 *
 * JSON mode is required to capture the session_id for --resume: text mode
 * prints only the response body, which is why session continuity silently
 * never worked (the old code grepped stdout for "Session ID:" and never
 * matched). Falls back to treating stdout as plain text so a CLI downgrade
 * or stray non-JSON output degrades to the old behavior instead of erroring.
 */

export interface ParsedClaudeOutput {
  text: string;
  sessionId?: string;
  isError: boolean;
}

export function parseClaudeOutput(stdout: string): ParsedClaudeOutput {
  const trimmed = stdout.trim();

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && parsed.type === "result") {
      return {
        text: typeof parsed.result === "string" ? parsed.result.trim() : "",
        sessionId:
          typeof parsed.session_id === "string" ? parsed.session_id : undefined,
        isError: parsed.is_error === true,
      };
    }
  } catch {
    // Not JSON — fall through to plain-text handling
  }

  return { text: trimmed, isError: false };
}
