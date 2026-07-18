import { expect, test } from "bun:test";
import { parseClaudeOutput } from "./claude-output";

test("parses text and session_id from claude -p JSON output", () => {
  const stdout = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Hello from Claude",
    session_id: "4bd33a94-9aa1-4702-9ea4-dbc75e24d3aa",
  });

  const parsed = parseClaudeOutput(stdout);

  expect(parsed.text).toBe("Hello from Claude");
  expect(parsed.sessionId).toBe("4bd33a94-9aa1-4702-9ea4-dbc75e24d3aa");
  expect(parsed.isError).toBe(false);
});

test("flags is_error results as errors but keeps the text", () => {
  const stdout = JSON.stringify({
    type: "result",
    subtype: "error_during_execution",
    is_error: true,
    result: "API Error: overloaded",
    session_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  });

  const parsed = parseClaudeOutput(stdout);

  expect(parsed.isError).toBe(true);
  expect(parsed.text).toBe("API Error: overloaded");
});

test("falls back to raw trimmed text when stdout is not JSON", () => {
  const parsed = parseClaudeOutput("  plain text response\n");

  expect(parsed.text).toBe("plain text response");
  expect(parsed.sessionId).toBeUndefined();
  expect(parsed.isError).toBe(false);
});

test("returns empty text for empty result field", () => {
  const stdout = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "",
    session_id: "11111111-2222-3333-4444-555555555555",
  });

  const parsed = parseClaudeOutput(stdout);

  expect(parsed.text).toBe("");
  expect(parsed.sessionId).toBe("11111111-2222-3333-4444-555555555555");
});

test("handles missing result field without throwing", () => {
  const stdout = JSON.stringify({
    type: "result",
    subtype: "error_max_turns",
    is_error: true,
    session_id: "11111111-2222-3333-4444-555555555555",
  });

  const parsed = parseClaudeOutput(stdout);

  expect(parsed.text).toBe("");
  expect(parsed.isError).toBe(true);
});
