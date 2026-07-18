import { expect, test } from "bun:test";
import { buildPrompt } from "./context";

// Instruction scaffolding must come BEFORE conversation history so that
// deictic user references ("this document", "that file") bind to actual
// conversation content, not to the relay's own instruction blocks.
test("instruction blocks come before conversation history", () => {
  const prompt = buildPrompt(
    "Explain this document please",
    "RELEVANT PAST MESSAGES:\n[assistant]: earlier chat",
    "FACTS:\n- likes brevity",
    "RECENT CONVERSATION:\n[user]: [Document: agreement.pdf]: Analyze\n[assistant]: It is an indemnity agreement."
  );

  const history = prompt.indexOf("RECENT CONVERSATION");
  expect(history).toBeGreaterThan(-1);
  expect(prompt.indexOf("SAFETY RULE")).toBeLessThan(history);
  expect(prompt.indexOf("MEMORY MANAGEMENT")).toBeLessThan(history);
});

test("user message is the last content in the prompt", () => {
  const prompt = buildPrompt(
    "Explain this document please",
    "RELEVANT PAST MESSAGES:\n[assistant]: earlier chat",
    "FACTS:\n- likes brevity",
    "RECENT CONVERSATION:\n[user]: hi"
  );

  expect(prompt.trimEnd().endsWith("User: Explain this document please")).toBe(
    true
  );
});
