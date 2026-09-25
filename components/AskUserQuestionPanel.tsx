"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { MarkdownBody } from "./MarkdownBody";
import { useI18n } from "@/hooks/useI18n";
import { draftToAnswer, emptyQuestionDraft, type QuestionDraft } from "@/lib/ask-user-question";
import type { AskUserQuestion, AskUserQuestionAnswer, ExtensionUiRequest } from "@/lib/types";

type QuestionnaireRequest = Extract<ExtensionUiRequest, { method: "questionnaire" }>;

export type QuestionnaireResponse = { answers: AskUserQuestionAnswer[] } | { cancelled: true };

/**
 * The browser form for an `ask_user_question` call (`@juicesharp/rpiv-ask-user-question`),
 * modelled on the extension's terminal overlay: one tab per question plus a review tab,
 * option rows with descriptions, a "Type something." row, and a preview pane.
 */
export function AskUserQuestionPanel({
  request,
  onRespond,
}: {
  request: QuestionnaireRequest;
  onRespond: (request: QuestionnaireRequest, response: QuestionnaireResponse) => void;
}) {
  const { t } = useI18n();
  const { questions } = request;
  const multipleQuestions = questions.length > 1;
  const reviewTab = questions.length;
  const [drafts, setDrafts] = useState<QuestionDraft[]>(() => questions.map(() => emptyQuestionDraft()));
  const [tab, setTab] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const answers = useMemo(() => questions.map((question, index) => draftToAnswer(question, drafts[index])), [drafts, questions]);
  const answeredCount = answers.filter((answer, index) => answer !== null && isTouched(questions[index], drafts[index])).length;
  const complete = answers.every((answer) => answer !== null);

  const submit = useCallback(() => {
    if (!answers.every((answer): answer is AskUserQuestionAnswer => answer !== null)) return;
    onRespond(request, { answers });
  }, [answers, onRespond, request]);
  const cancel = useCallback(() => onRespond(request, { cancelled: true }), [onRespond, request]);

  const updateDraft = useCallback((index: number, update: (draft: QuestionDraft) => QuestionDraft) => {
    setDrafts((current) => current.map((draft, i) => i === index ? update(draft) : draft));
  }, []);

  const goTo = useCallback((next: number) => {
    setTab(next);
    setPreviewIndex(null);
  }, []);

  const advance = useCallback(() => {
    if (!multipleQuestions) {
      submit();
      return;
    }
    goTo(Math.min(tab + 1, reviewTab));
  }, [goTo, multipleQuestions, reviewTab, submit, tab]);

  const title = t("chat.questionnaireTitle");

  return (
    <div
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 90,
        display: "flex",
        alignItems: collapsed ? "flex-start" : "center",
        justifyContent: "center",
        padding: 20,
        pointerEvents: "none",
      }}
    >
      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          style={{
            pointerEvents: "auto",
            display: "flex",
            alignItems: "center",
            gap: 10,
            maxWidth: "min(720px, 100%)",
            width: "100%",
            padding: "10px 12px",
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--bg)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
            color: "var(--text)",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 650, color: "var(--accent)", flexShrink: 0 }}>
            {t("chat.extensionPending")}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
            {questions[Math.min(tab, questions.length - 1)].question}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-dim)", flexShrink: 0 }}>
            {t("chat.questionnaireProgress", { answered: answeredCount, total: questions.length })}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>
            {t("chat.extensionExpand")}
          </span>
        </button>
      ) : (
        <div
          role="dialog"
          aria-label={title}
          data-testid="ask-user-question-panel"
          style={{
            pointerEvents: "auto",
            width: "min(720px, 100%)",
            maxHeight: "min(820px, 100%)",
            display: "flex",
            flexDirection: "column",
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--bg)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
            overflow: "hidden",
          }}
        >
          <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ color: "var(--text)", fontSize: 14, fontWeight: 650 }}>{title}</span>
              <span style={{ color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
                {t("chat.questionnaireProgress", { answered: answeredCount, total: questions.length })}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              aria-expanded={true}
              title={t("chat.extensionCollapse")}
              aria-label={t("chat.extensionCollapse")}
              style={{
                display: "grid",
                placeItems: "center",
                width: 28,
                height: 28,
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text-muted)",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="2 3.5 5 6.5 8 3.5" />
              </svg>
            </button>
          </div>

          {multipleQuestions && (
            <div role="tablist" style={{ flexShrink: 0, display: "flex", flexWrap: "wrap", gap: 6, padding: "8px 14px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
              {questions.map((question, index) => (
                <TabChip
                  key={index}
                  active={tab === index}
                  done={answers[index] !== null && isTouched(question, drafts[index])}
                  label={question.header || `Q${index + 1}`}
                  onClick={() => goTo(index)}
                />
              ))}
              <TabChip active={tab === reviewTab} done={false} label={t("chat.questionnaireReview")} onClick={() => goTo(reviewTab)} />
            </div>
          )}

          <div style={{ padding: 14, flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
            {tab < questions.length ? (
              <QuestionView
                key={tab}
                question={questions[tab]}
                draft={drafts[tab]}
                previewIndex={previewIndex}
                onPreview={setPreviewIndex}
                onChange={(update) => updateDraft(tab, update)}
                onCommit={advance}
              />
            ) : (
              <ReviewView questions={questions} answers={answers} onEdit={goTo} />
            )}
          </div>

          <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderTop: "1px solid var(--border)", background: "var(--bg-panel)" }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: "var(--text-dim)" }}>
              {!complete && (tab === reviewTab || !multipleQuestions) ? t("chat.questionnaireAnswerAll") : ""}
            </span>
            <button type="button" onClick={cancel} style={secondaryButtonStyle}>
              {t("chat.cancel")}
            </button>
            {multipleQuestions && tab > 0 && (
              <button type="button" onClick={() => goTo(tab - 1)} style={secondaryButtonStyle}>
                {t("chat.questionnaireBack")}
              </button>
            )}
            {multipleQuestions && tab < reviewTab ? (
              <button type="button" onClick={() => goTo(tab + 1)} style={primaryButtonStyle(true)}>
                {t("chat.questionnaireNext")}
              </button>
            ) : (
              <button type="button" onClick={submit} disabled={!complete} style={primaryButtonStyle(complete)}>
                {t("chat.submit")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Whether the user has done anything on this question; untouched multi-selects are not "answered" yet. */
function isTouched(question: AskUserQuestion, draft: QuestionDraft): boolean {
  return question.multiSelect ? draft.checked.length > 0 || (draft.custom && draft.text.trim().length > 0) : true;
}

function TabChip({ active, done, label, onClick }: { active: boolean; done: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 9px",
        borderRadius: 999,
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
        background: active ? "var(--accent)" : "var(--bg)",
        color: active ? "var(--accent-contrast)" : "var(--text-muted)",
        fontSize: 12,
        fontWeight: active ? 650 : 500,
        cursor: "pointer",
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 10 }}>{done ? "✓" : "○"}</span>
      {label}
    </button>
  );
}

function QuestionView({
  question,
  draft,
  previewIndex,
  onPreview,
  onChange,
  onCommit,
}: {
  question: AskUserQuestion;
  draft: QuestionDraft;
  previewIndex: number | null;
  onPreview: (index: number | null) => void;
  onChange: (update: (draft: QuestionDraft) => QuestionDraft) => void;
  onCommit: () => void;
}) {
  const { t } = useI18n();
  const listRef = useRef<HTMLDivElement>(null);
  const customRowIndex = question.options.length;
  const hasPreviews = question.options.some((option) => option.preview);
  const shownPreviewIndex = previewIndex ?? (question.multiSelect ? null : draft.selected);
  const shownPreview = shownPreviewIndex !== null ? question.options[shownPreviewIndex]?.preview : undefined;

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>("[data-question-option]")?.focus({ preventScroll: true });
  }, []);

  const isChosen = (index: number) => {
    if (index === customRowIndex) return draft.custom;
    return question.multiSelect ? draft.checked.includes(index) : !draft.custom && draft.selected === index;
  };

  const choose = (index: number) => {
    if (index === customRowIndex) {
      // On multi-select the typed answer replaces the checked options instead of joining
      // them: the extension reads any non-index reply as one custom answer.
      onChange((current) => question.multiSelect && current.custom
        ? { ...current, custom: false }
        : { ...current, custom: true, checked: [] });
      return;
    }
    if (question.multiSelect) {
      onChange((current) => ({
        ...current,
        custom: false,
        checked: current.checked.includes(index)
          ? current.checked.filter((value) => value !== index)
          : [...current.checked, index],
      }));
      return;
    }
    onChange((current) => ({ ...current, selected: index, custom: false }));
  };

  return (
    <div>
      <div style={{ color: "var(--text)", fontSize: 14, fontWeight: 600, lineHeight: 1.45, marginBottom: 4 }}>
        <MarkdownBody>{question.question}</MarkdownBody>
      </div>
      {question.multiSelect && (
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 8 }}>{t("chat.questionnaireMultiHint")}</div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
        <div
          ref={listRef}
          role={question.multiSelect ? "group" : "radiogroup"}
          onKeyDown={(event) => {
            if (event.target instanceof HTMLInputElement) return;
            const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-question-option]"));
            const index = rows.indexOf(event.target as HTMLElement);
            if (index < 0) return;
            if (/^[1-9]$/.test(event.key) && Number(event.key) <= rows.length) {
              event.preventDefault();
              const target = Number(event.key) - 1;
              choose(target);
              rows[target].focus({ preventScroll: true });
              return;
            }
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === "Home" ? 0
              : event.key === "End" ? rows.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
            rows[next].focus({ preventScroll: true });
            rows[next].scrollIntoView({ block: "nearest" });
          }}
          style={{ flex: hasPreviews ? "1 1 300px" : "1 1 100%", minWidth: 0, display: "grid", gap: 6, alignContent: "start" }}
        >
          {question.options.map((option, index) => (
            <OptionRow
              key={index}
              index={index}
              multiSelect={question.multiSelect}
              chosen={isChosen(index)}
              label={option.label}
              description={option.description}
              onFocus={() => option.preview && onPreview(index)}
              onChoose={() => choose(index)}
              onCommit={() => {
                if (question.multiSelect) choose(index);
                else {
                  choose(index);
                  onCommit();
                }
              }}
            />
          ))}
          <OptionRow
            index={customRowIndex}
            multiSelect={false}
            chosen={draft.custom}
            label={t("chat.questionnaireTypeSomething")}
            onFocus={() => onPreview(null)}
            onChoose={() => choose(customRowIndex)}
            onCommit={() => choose(customRowIndex)}
          />
          {draft.custom && (
            <input
              autoFocus
              value={draft.text}
              placeholder={t("chat.questionnaireTypePlaceholder")}
              onChange={(event) => {
                const text = event.target.value;
                onChange((current) => ({ ...current, text }));
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing && draft.text.trim()) {
                  event.preventDefault();
                  onCommit();
                }
              }}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 7,
                border: "1px solid var(--accent)",
                background: "var(--bg-panel)",
                color: "var(--text)",
                outline: "none",
                fontSize: 13,
              }}
            />
          )}
        </div>

        {hasPreviews && (
          <div
            aria-label={t("chat.questionnairePreview")}
            style={{
              flex: "1 1 280px",
              minWidth: 0,
              maxHeight: 360,
              overflow: "auto",
              border: "1px solid var(--border)",
              borderRadius: 7,
              background: "var(--bg-panel)",
              padding: "8px 10px",
            }}
          >
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--text-dim)", marginBottom: 6 }}>
              {t("chat.questionnairePreview")}
              {shownPreviewIndex !== null && shownPreview ? ` · ${question.options[shownPreviewIndex].label}` : ""}
            </div>
            {shownPreview ? (
              <div style={{ fontSize: 12 }}>
                <MarkdownBody>{shownPreview}</MarkdownBody>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "var(--text-dim)" }}>—</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function OptionRow({
  index,
  multiSelect,
  chosen,
  label,
  description,
  onFocus,
  onChoose,
  onCommit,
}: {
  index: number;
  multiSelect: boolean;
  chosen: boolean;
  label: string;
  description?: string;
  onFocus: () => void;
  onChoose: () => void;
  onCommit: () => void;
}) {
  return (
    <div
      role={multiSelect ? "checkbox" : "radio"}
      aria-checked={chosen}
      tabIndex={0}
      data-question-option
      onFocus={onFocus}
      onMouseEnter={onFocus}
      onClick={onChoose}
      onKeyDown={(event) => {
        if (event.key === " ") {
          event.preventDefault();
          onChoose();
        } else if (event.key === "Enter") {
          event.preventDefault();
          onCommit();
        }
      }}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 7,
        border: `1px solid ${chosen ? "var(--accent)" : "var(--border)"}`,
        background: "var(--bg-panel)",
        color: "var(--text)",
        cursor: "pointer",
        fontSize: 13,
        overflowWrap: "anywhere",
        scrollMargin: 14,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          marginTop: 2,
          width: 14,
          height: 14,
          display: "grid",
          placeItems: "center",
          borderRadius: multiSelect ? 3 : 999,
          border: `1.5px solid ${chosen ? "var(--accent)" : "var(--text-dim)"}`,
          background: chosen ? "var(--accent)" : "transparent",
          color: "var(--accent-contrast)",
          fontSize: 9,
          lineHeight: 1,
        }}
      >
        {chosen ? (multiSelect ? "✓" : "●") : ""}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 600 }}>
          <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontWeight: 400, marginRight: 6 }}>{index + 1}.</span>
          {label}
        </span>
        {description && (
          <span style={{ display: "block", marginTop: 2, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>{description}</span>
        )}
      </span>
    </div>
  );
}

function ReviewView({
  questions,
  answers,
  onEdit,
}: {
  questions: AskUserQuestion[];
  answers: (AskUserQuestionAnswer | null)[];
  onEdit: (index: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {questions.map((question, index) => {
        const answer = answers[index];
        const summary = answerSummary(question, answer, t("chat.questionnaireNoneSelected"));
        return (
          <button
            key={index}
            type="button"
            onClick={() => onEdit(index)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "8px 10px",
              borderRadius: 7,
              border: `1px solid ${answer ? "var(--border)" : "var(--accent)"}`,
              background: "var(--bg-panel)",
              color: "var(--text)",
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
              {question.header ? `[${question.header}] ` : ""}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{question.question}</div>
            <div style={{ fontSize: 12, marginTop: 4, color: answer ? "var(--text-muted)" : "var(--accent)" }}>
              {summary ?? t("chat.questionnaireUnanswered")}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function answerSummary(question: AskUserQuestion, answer: AskUserQuestionAnswer | null, noneSelected: string): string | null {
  if (!answer) return null;
  if (answer.kind === "option") return question.options[answer.optionIndex]?.label ?? null;
  if (answer.kind === "custom") return `“${answer.text}”`;
  const labels = answer.optionIndexes.map((index) => question.options[index]?.label).filter(Boolean);
  return labels.length > 0 ? labels.join(", ") : noneSelected;
}

const secondaryButtonStyle: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text-muted)",
  cursor: "pointer",
};

function primaryButtonStyle(enabled: boolean): CSSProperties {
  return {
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid var(--accent)",
    background: "var(--accent)",
    color: "var(--accent-contrast)",
    cursor: enabled ? "pointer" : "not-allowed",
    opacity: enabled ? 1 : 0.5,
  };
}
