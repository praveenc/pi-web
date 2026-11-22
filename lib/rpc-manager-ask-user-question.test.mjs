import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// The wrapper feeds the questionnaire bridge its running ask_user_question calls
// from the tool events it tracks for reconnects. When that bookkeeping changes
// shape, the bridge must still find the call, or the panel never opens and the
// extension falls back to one dialog per question.

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

const ARGS = {
  questions: [{
    question: "Which database?",
    header: "DB",
    options: [
      { label: "Postgres", description: "Relational" },
      { label: "SQLite", description: "Embedded" },
    ],
  }],
};
const OPTIONS = ["1. Postgres — Relational", "2. SQLite — Embedded", "3. Type something."];

function setup(t) {
  let emitAgentEvent = () => {};
  const inner = {
    sessionId: "ask-user-question-bridge",
    isStreaming: false, isCompacting: false, isBashRunning: false, isIdle: true,
    sessionManager: { getCwd: () => "/tmp" },
    agent: { state: {}, abort() {} },
    subscribe(listener) {
      emitAgentEvent = listener;
      return () => {};
    },
    clearQueue: () => ({ steering: [], followUp: [] }),
    dispose() {},
  };
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  wrapper.start();
  const ui = wrapper.createExtensionUiContext();
  const requests = (method) => events.filter((event) => event.type === "extension_ui_request" && event.method === method);
  return { wrapper, ui, requests, emit: (event) => emitAgentEvent(event) };
}

test("a running ask_user_question call's first dialog opens the questionnaire and is answered from it", async (t) => {
  const { wrapper, ui, requests, emit } = setup(t);
  emit({ type: "tool_execution_start", toolCallId: "call-1", toolName: "ask_user_question", args: ARGS });

  const answer = ui.select("[DB] Which database?", OPTIONS);
  const [questionnaire] = requests("questionnaire");
  assert.ok(questionnaire, "the questionnaire request was emitted");
  assert.equal(questionnaire.toolCallId, "call-1");
  assert.equal(questionnaire.questions[0].question, "Which database?");
  assert.equal(requests("select").length, 0, "the extension's own select stays hidden");

  await wrapper.send({ type: "extension_ui_response", id: questionnaire.id, answers: [{ kind: "option", optionIndex: 1 }] });
  assert.equal(await answer, OPTIONS[1]);
});

test("a select outside an ask_user_question call stays an ordinary dialog", async (t) => {
  const { ui, requests, emit } = setup(t);
  emit({ type: "tool_execution_start", toolCallId: "call-2", toolName: "bash", args: { command: "ls" } });

  void ui.select("[DB] Which database?", OPTIONS);
  assert.equal(requests("questionnaire").length, 0);
  assert.equal(requests("select").length, 1);
});
