import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./ask-user-question.ts");
}

const QUESTIONS_ARGS = {
  questions: [
    {
      question: "Which database?",
      header: "DB",
      options: [
        { label: "Postgres", description: "Relational", preview: "CREATE TABLE t ();" },
        { label: "SQLite", description: "Embedded" },
      ],
    },
    {
      question: "Which pets?",
      header: "Pets",
      multiSelect: true,
      options: [
        { label: "Cat", description: "Meow" },
        { label: "Dog", description: "Woof" },
        { label: "Fish", description: "Blub" },
      ],
    },
  ],
};

/**
 * The dialog sequence of `@juicesharp/rpiv-ask-user-question`'s rpc-fallback.ts,
 * reduced to what the bridge relies on.
 */
async function walkLikeExtension(ui, args) {
  const answers = [];
  for (const q of args.questions) {
    const header = q.header ? `[${q.header}] ` : "";
    const lines = q.options.map((o, i) => `${i + 1}. ${o.label} — ${o.description}`);
    if (q.multiSelect) {
      const value = await ui.input(`${header}${q.question}\n\n${lines.join("\n")}\n\nEnter the numbers…`, "1,3");
      if (value == null) return { cancelled: true, answers };
      answers.push({ multi: value });
      continue;
    }
    const options = [...lines, `${q.options.length + 1}. Type something.`];
    const chosen = await ui.select(`${header}${q.question}`, options);
    if (chosen == null) return { cancelled: true, answers };
    const index = Number.parseInt(chosen, 10) - 1;
    if (index < q.options.length) {
      answers.push({ option: q.options[index].label });
      continue;
    }
    const typed = await ui.input(`${header}${q.question}\n\nType your answer:`, "");
    if (typed == null) return { cancelled: true, answers };
    answers.push({ custom: typed });
  }
  return { cancelled: false, answers };
}

function createHarness(QuestionnaireBridge, answers) {
  const asked = [];
  const nativeDialogs = [];
  const bridge = new QuestionnaireBridge({
    getToolCalls: () => [{ toolCallId: "call-1", args: QUESTIONS_ARGS }],
    ask: async (toolCallId, questions) => {
      asked.push({ toolCallId, questions });
      return answers;
    },
  });
  const ui = {
    select: (title, options) => bridge.handleDialog({ method: "select", title, options })
      ?.then((r) => ("value" in r ? r.value : undefined))
      ?? (nativeDialogs.push(title), Promise.resolve(undefined)),
    input: (title) => bridge.handleDialog({ method: "input", title })
      ?.then((r) => ("value" in r ? r.value : undefined))
      ?? (nativeDialogs.push(title), Promise.resolve(undefined)),
  };
  return { asked, nativeDialogs, ui, bridge };
}

test("parses and normalizes ask_user_question arguments", async () => {
  const { parseAskUserQuestionArgs } = await loadSubject();
  const questions = parseAskUserQuestionArgs({
    questions: [{
      question: "A?\r\nB",
      header: "H",
      options: [{ label: "x", description: "d" }, { label: "y", description: "e", preview: "" }],
    }],
  });
  assert.deepEqual(questions, [{
    question: "A?\nB",
    header: "H",
    multiSelect: false,
    options: [{ label: "x", description: "d" }, { label: "y", description: "e" }],
  }]);
  assert.equal(parseAskUserQuestionArgs({ questions: [] }), null);
  assert.equal(parseAskUserQuestionArgs({ questions: [{ question: "q", header: "h", options: [{ label: "a", description: "" }] }] }), null);
  assert.equal(parseAskUserQuestionArgs("nope"), null);
});

test("one questionnaire answers every dialog of the walk", async () => {
  const { QuestionnaireBridge } = await loadSubject();
  const { asked, nativeDialogs, ui } = createHarness(QuestionnaireBridge, [
    { kind: "option", optionIndex: 1 },
    { kind: "multi", optionIndexes: [2, 0] },
  ]);

  const result = await walkLikeExtension(ui, QUESTIONS_ARGS);

  assert.equal(asked.length, 1);
  assert.equal(asked[0].toolCallId, "call-1");
  assert.equal(asked[0].questions[0].options[0].preview, "CREATE TABLE t ();");
  assert.deepEqual(nativeDialogs, []);
  assert.deepEqual(result, { cancelled: false, answers: [{ option: "SQLite" }, { multi: "1,3" }] });
});

test("custom answers go through the Type something row and the follow-up input", async () => {
  const { QuestionnaireBridge } = await loadSubject();
  const { ui } = createHarness(QuestionnaireBridge, [
    { kind: "custom", text: "MySQL" },
    { kind: "multi", optionIndexes: [1], text: "a hamster" },
  ]);

  const result = await walkLikeExtension(ui, QUESTIONS_ARGS);

  assert.deepEqual(result, {
    cancelled: false,
    answers: [{ custom: "MySQL" }, { multi: "Dog; a hamster" }],
  });
});

test("an empty multi-select selection is sent as an empty commit", async () => {
  const { QuestionnaireBridge } = await loadSubject();
  const { ui } = createHarness(QuestionnaireBridge, [
    { kind: "option", optionIndex: 0 },
    { kind: "multi", optionIndexes: [] },
  ]);

  const result = await walkLikeExtension(ui, QUESTIONS_ARGS);

  assert.deepEqual(result.answers[1], { multi: "" });
});

test("dismissing the questionnaire cancels the walk at the first dialog", async () => {
  const { QuestionnaireBridge } = await loadSubject();
  const { nativeDialogs, ui } = createHarness(QuestionnaireBridge, undefined);

  const result = await walkLikeExtension(ui, QUESTIONS_ARGS);

  assert.deepEqual(result, { cancelled: true, answers: [] });
  assert.deepEqual(nativeDialogs, []);
});

test("answers that do not fit the questions decline instead of guessing", async () => {
  const { QuestionnaireBridge } = await loadSubject();
  const { ui } = createHarness(QuestionnaireBridge, [{ kind: "option", optionIndex: 5 }, { kind: "multi", optionIndexes: [] }]);

  const result = await walkLikeExtension(ui, QUESTIONS_ARGS);

  assert.equal(result.cancelled, true);
});

test("dialogs that belong to no ask_user_question call stay native", async () => {
  const { QuestionnaireBridge } = await loadSubject();
  const { asked, ui } = createHarness(QuestionnaireBridge, []);

  await ui.select("Pick a color", ["red", "blue", "green"]);
  await ui.input("Name?");

  assert.equal(asked.length, 0);
});

test("a finished call does not reopen its questionnaire", async () => {
  const { QuestionnaireBridge } = await loadSubject();
  const { asked, nativeDialogs, ui } = createHarness(QuestionnaireBridge, [
    { kind: "option", optionIndex: 0 },
    { kind: "multi", optionIndexes: [0] },
  ]);

  await walkLikeExtension(ui, QUESTIONS_ARGS);
  // Another extension opening a look-alike dialog while the tool call is still active.
  await ui.select("[DB] Which database?", ["1. a", "2. b", "3. c"]);

  assert.equal(asked.length, 1);
  assert.deepEqual(nativeDialogs, ["[DB] Which database?"]);
});

test("drafts turn into answers the bridge accepts", async () => {
  const { buildQuestionnaireScript, draftToAnswer, emptyQuestionDraft, parseAskUserQuestionArgs } = await loadSubject();
  const [single, multi] = parseAskUserQuestionArgs(QUESTIONS_ARGS);

  assert.equal(draftToAnswer(single, emptyQuestionDraft()), null);
  assert.equal(draftToAnswer(single, { ...emptyQuestionDraft(), custom: true, text: "  " }), null);
  assert.deepEqual(draftToAnswer(single, { ...emptyQuestionDraft(), selected: 1 }), { kind: "option", optionIndex: 1 });
  assert.deepEqual(draftToAnswer(single, { ...emptyQuestionDraft(), selected: 1, custom: true, text: "x" }), { kind: "custom", text: "x" });

  assert.deepEqual(draftToAnswer(multi, emptyQuestionDraft()), { kind: "multi", optionIndexes: [] });
  assert.deepEqual(draftToAnswer(multi, { ...emptyQuestionDraft(), checked: [2, 0] }), { kind: "multi", optionIndexes: [0, 2] });
  assert.deepEqual(draftToAnswer(multi, { ...emptyQuestionDraft(), custom: true, text: "y" }), { kind: "custom", text: "y" });

  const answers = [
    draftToAnswer(single, { ...emptyQuestionDraft(), selected: 0 }),
    draftToAnswer(multi, { ...emptyQuestionDraft(), checked: [1], custom: true, text: "z" }),
  ];
  assert.notEqual(buildQuestionnaireScript([single, multi], answers), null);
});
