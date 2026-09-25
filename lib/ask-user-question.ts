import type {
  AskUserQuestion,
  AskUserQuestionAnswer,
  AskUserQuestionOption,
} from "./types";

/**
 * Bridge between the `@juicesharp/rpiv-ask-user-question` extension and Pi Web's
 * questionnaire panel.
 *
 * Pi Web binds extensions in `rpc` mode, so the extension skips its terminal overlay
 * and walks the questions with one native dialog each (its `rpc-fallback.ts`):
 *
 * - single-select: `select("[header] question…", ["1. label — description", …, "N+1. Type something."])`,
 *   followed by `input("[header] question…")` when the last row was picked;
 * - multi-select: `input("[header] question…\n\n1. label — …")` answered with `"1,3"` or free text.
 *
 * One dialog per question hides the rest of the questionnaire and cannot show previews
 * side by side. Instead, the first dialog of a recognized `ask_user_question` call opens
 * the whole questionnaire in the browser; once it is submitted, every dialog in the
 * sequence is answered from that submission, so the extension still builds the result
 * envelope the model sees. Any dialog that does not match the expected sequence ends the
 * bridge for that call and is shown as an ordinary dialog.
 */

export const ASK_USER_QUESTION_TOOL_NAME = "ask_user_question";

const MAX_QUESTIONS = 4;
const MIN_OPTIONS = 2;

export type QuestionnaireDialog =
  | { method: "select"; title: string; options: string[] }
  | { method: "input"; title: string };

export type QuestionnaireDialogResponse = { value: string } | { cancelled: true };

export interface QuestionnaireToolCall {
  toolCallId: string;
  args: unknown;
}

/** Mirrors the extension's line-terminator normalization so titles compare equal. */
function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "");
}

function parseOption(value: unknown): AskUserQuestionOption | null {
  if (!value || typeof value !== "object") return null;
  const option = value as Record<string, unknown>;
  if (typeof option.label !== "string" || typeof option.description !== "string") return null;
  return {
    label: normalizeText(option.label),
    description: normalizeText(option.description),
    ...(typeof option.preview === "string" && option.preview.length > 0
      ? { preview: normalizeText(option.preview) }
      : {}),
  };
}

/**
 * Parse `ask_user_question` arguments. Returns null for anything the extension would
 * reject or render differently, which keeps those calls on the ordinary dialogs.
 */
export function parseAskUserQuestionArgs(args: unknown): AskUserQuestion[] | null {
  if (!args || typeof args !== "object") return null;
  const rawQuestions = (args as { questions?: unknown }).questions;
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0 || rawQuestions.length > MAX_QUESTIONS) return null;

  const questions: AskUserQuestion[] = [];
  for (const raw of rawQuestions) {
    if (!raw || typeof raw !== "object") return null;
    const question = raw as Record<string, unknown>;
    if (typeof question.question !== "string" || typeof question.header !== "string") return null;
    if (!Array.isArray(question.options) || question.options.length < MIN_OPTIONS) return null;
    const options: AskUserQuestionOption[] = [];
    for (const rawOption of question.options) {
      const option = parseOption(rawOption);
      if (!option) return null;
      options.push(option);
    }
    questions.push({
      question: normalizeText(question.question),
      header: normalizeText(question.header),
      multiSelect: question.multiSelect === true,
      options,
    });
  }
  return questions;
}

function titlePrefix(question: AskUserQuestion): string {
  return `${question.header ? `[${question.header}] ` : ""}${question.question}`;
}

type ScriptStep =
  | { method: "select"; question: AskUserQuestion; optionIndex: number }
  | { method: "input"; question: AskUserQuestion; value: string };

function stepMatches(step: { method: string; question: AskUserQuestion }, dialog: QuestionnaireDialog): boolean {
  if (step.method !== dialog.method || !dialog.title.startsWith(titlePrefix(step.question))) return false;
  if (dialog.method === "select") {
    // The extension appends its "Type something." row after the authored options.
    return dialog.options.length === step.question.options.length + 1;
  }
  return true;
}

function firstStepShape(question: AskUserQuestion): { method: "select" | "input"; question: AskUserQuestion } {
  return { method: question.multiSelect ? "input" : "select", question };
}

/** The 1-based index list the extension parses as a multi-select selection. */
function multiSelectIndexes(question: AskUserQuestion, optionIndexes: number[]): string {
  return [...new Set(optionIndexes)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < question.options.length)
    .sort((a, b) => a - b)
    .map((index) => String(index + 1))
    .join(",");
}

/** Expand submitted answers into the exact dialog sequence the extension will open. */
export function buildQuestionnaireScript(
  questions: AskUserQuestion[],
  answers: AskUserQuestionAnswer[],
): ScriptStep[] | null {
  if (answers.length !== questions.length) return null;
  const steps: ScriptStep[] = [];
  for (let index = 0; index < questions.length; index++) {
    const question = questions[index];
    const answer = answers[index];
    if (question.multiSelect) {
      if (answer.kind === "option") return null;
      // Any non-index token makes the extension treat the whole reply as a custom answer.
      const value = answer.kind === "multi" ? multiSelectIndexes(question, answer.optionIndexes) : answer.text.trim();
      steps.push({ method: "input", question, value });
      continue;
    }
    if (answer.kind === "option") {
      if (!Number.isInteger(answer.optionIndex) || answer.optionIndex < 0 || answer.optionIndex >= question.options.length) {
        return null;
      }
      steps.push({ method: "select", question, optionIndex: answer.optionIndex });
    } else if (answer.kind === "custom") {
      steps.push({ method: "select", question, optionIndex: question.options.length });
      steps.push({ method: "input", question, value: answer.text });
    } else {
      return null;
    }
  }
  return steps;
}

type BridgeSession = {
  toolCallId: string;
  questions: AskUserQuestion[];
  /** Resolves with the scripted steps, or null when the questionnaire was dismissed. */
  script: Promise<ScriptStep[] | null>;
  /** The settled script, once the questionnaire has been answered. */
  resolved?: ScriptStep[] | null;
  nextStep: number;
};

export interface QuestionnaireBridgeOptions {
  /** In-flight tool calls, newest last. */
  getToolCalls(): QuestionnaireToolCall[];
  /** Show the questionnaire; resolves with the answers, or undefined when dismissed. */
  ask(toolCallId: string, questions: AskUserQuestion[]): Promise<AskUserQuestionAnswer[] | undefined>;
}

export class QuestionnaireBridge {
  private sessions = new Map<string, BridgeSession>();
  /** Tool calls already handled, so a later dialog cannot reopen their questionnaire. */
  private settledToolCalls = new Set<string>();
  private readonly options: QuestionnaireBridgeOptions;

  constructor(options: QuestionnaireBridgeOptions) {
    this.options = options;
  }

  /**
   * Answer `dialog` from a questionnaire, or return null to show it as an ordinary
   * dialog.
   */
  handleDialog(dialog: QuestionnaireDialog): Promise<QuestionnaireDialogResponse> | null {
    for (const session of this.sessions.values()) {
      const response = this.continueSession(session, dialog);
      if (response) return response;
    }
    const session = this.startSession(dialog);
    return session ? this.continueSession(session, dialog) : null;
  }

  /** Forget a finished tool call. */
  finishToolCall(toolCallId: string): void {
    this.sessions.delete(toolCallId);
    this.settledToolCalls.delete(toolCallId);
  }

  clear(): void {
    this.sessions.clear();
    this.settledToolCalls.clear();
  }

  private startSession(dialog: QuestionnaireDialog): BridgeSession | null {
    const toolCalls = this.options.getToolCalls();
    for (let index = toolCalls.length - 1; index >= 0; index--) {
      const { toolCallId, args } = toolCalls[index];
      if (this.sessions.has(toolCallId) || this.settledToolCalls.has(toolCallId)) continue;
      const questions = parseAskUserQuestionArgs(args);
      if (!questions || !stepMatches(firstStepShape(questions[0]), dialog)) continue;

      const session: BridgeSession = { toolCallId, questions, nextStep: 0, script: Promise.resolve(null) };
      session.script = this.options.ask(toolCallId, questions)
        .then((answers) => answers ? buildQuestionnaireScript(questions, answers) : null)
        .catch(() => null)
        .then((script) => {
          session.resolved = script;
          return script;
        });
      this.sessions.set(toolCallId, session);
      return session;
    }
    return null;
  }

  private continueSession(
    session: BridgeSession,
    dialog: QuestionnaireDialog,
  ): Promise<QuestionnaireDialogResponse> | null {
    const stepIndex = session.nextStep;
    if (stepIndex === 0) {
      if (!stepMatches(firstStepShape(session.questions[0]), dialog)) return null;
    } else {
      // Later dialogs only open after the first one was answered, so the script is
      // known. A dialog outside the sequence belongs to someone else: stop answering
      // for this call and let it through.
      const step = session.resolved?.[stepIndex];
      if (!step || !stepMatches(step, dialog)) {
        this.endSession(session);
        return null;
      }
    }
    session.nextStep += 1;

    return session.script.then((script): QuestionnaireDialogResponse => {
      const step = script?.[stepIndex];
      if (!script || !step || !stepMatches(step, dialog)) {
        // Dismissed, or answers that do not fit the questions: the extension reports
        // a declined questionnaire.
        this.endSession(session);
        return { cancelled: true };
      }
      if (stepIndex === script.length - 1) this.endSession(session);
      if (step.method === "input") return { value: step.value };
      const options = (dialog as Extract<QuestionnaireDialog, { method: "select" }>).options;
      return { value: options[step.optionIndex] };
    });
  }

  private endSession(session: BridgeSession): void {
    if (this.sessions.get(session.toolCallId) !== session) return;
    this.sessions.delete(session.toolCallId);
    this.settledToolCalls.add(session.toolCallId);
  }
}

/** Browser-side draft of one question's answer in the questionnaire panel. */
export interface QuestionDraft {
  /** Single-select: the chosen option. */
  selected: number | null;
  /** Multi-select: the checked options. */
  checked: number[];
  /** The "Type something." row is chosen; on multi-select it excludes the checked options. */
  custom: boolean;
  text: string;
}

export function emptyQuestionDraft(): QuestionDraft {
  return { selected: null, checked: [], custom: false, text: "" };
}

/**
 * The answer a draft submits, or null while the question is unanswered. A multi-select
 * question may be committed with nothing checked, as in the TUI.
 */
export function draftToAnswer(question: AskUserQuestion, draft: QuestionDraft): AskUserQuestionAnswer | null {
  const text = draft.text.trim();
  if (question.multiSelect) {
    if (draft.custom) return text ? { kind: "custom", text } : null;
    return { kind: "multi", optionIndexes: [...draft.checked].sort((a, b) => a - b) };
  }
  if (draft.custom) return text ? { kind: "custom", text } : null;
  return draft.selected === null ? null : { kind: "option", optionIndex: draft.selected };
}
